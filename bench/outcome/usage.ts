// Card T1-OUTCOME-USAGE: one usage row per model request, from Claude Code session logs, Codex session logs and reviewer logs.
// Files are read, never written. Only the fields of USAGE_COLUMNS (ingest.ts) leave a log: no message text, prompt, tool input or tool output.
import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { USAGE_COLUMNS, type Row, type Tables } from './ingest.ts';

export type Usage = { rows: Row[]; errors: Row[] };
/** USD per million tokens of each kind, by model id: `cacheWrite` is the shorter cache-write tier and `cacheWriteLong` the long one, each with its duration; with the page the numbers were read from and the date they were read. */
export type Prices = Record<string, { input: number; cacheRead: number; cacheWrite: number; cacheWriteLong: number; output: number; cacheWriteTier: string; cacheWriteLongTier: string; source: string; date: string; note?: string }>;

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const num = (value: unknown): number | null => (typeof value === 'number' ? value : null);
const obj = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const cause = (err: unknown): string => `unreadable: ${String((err as NodeJS.ErrnoException).code ?? (err as Error).message)}`;

/** The entries of a directory. The one filesystem call a caller can replace, so a listing that fails can be tested on every platform. */
export type List = (dir: string) => Dirent[];
const listDir: List = (dir) => readdirSync(dir, { withFileTypes: true });

/** The readers of one source. Each entry that cannot be read becomes a row of `errors` naming it and yields nothing; no filesystem error leaves a reader. */
function reader(source: string, errors: Row[], list: List = listDir) {
  const problem = (file: string, what: string): void => void errors.push({ source, path: file, problem: what });
  /** The content of `file`; undefined, with an error row, when it cannot be read. With `absentOk` a file that does not exist gives no error row. */
  const read = (file: string, absentOk = false): string | undefined => {
    try {
      return readFileSync(file, 'utf8');
    } catch (err) {
      if (!(absentOk && (err as NodeJS.ErrnoException).code === 'ENOENT')) problem(file, cause(err));
      return undefined;
    }
  };
  /**
   * The entries at any depth under `dir` whose name matches, in path order. A directory with such a name is returned as one
   * (reading it gives its error row) and is not walked into. A directory that cannot be listed is its own error row, and its
   * siblings are still walked. Links are not followed.
   */
  const files = (dir: string, name: RegExp): string[] => {
    const walk = (at: string): string[] => {
      let entries: Dirent[];
      try {
        entries = list(at);
      } catch (err) {
        return problem(at, cause(err)), [];
      }
      return entries.flatMap((e) => {
        const entry = path.join(at, e.name);
        if (name.test(e.name)) return e.isFile() || e.isDirectory() ? [entry] : [];
        return e.isDirectory() ? walk(entry) : [];
      });
    };
    try {
      if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return problem(dir, 'missing directory'), [];
    } catch (err) {
      return problem(dir, cause(err)), [];
    }
    return walk(dir).sort();
  };
  /** Calls `each` with every line of `file` that is a JSON value, as an object, and its number counted from 1. Blank lines are skipped. False when the file cannot be read. */
  const jsonLines = (file: string, each: (line: Record<string, unknown>, n: number) => void): boolean => {
    const content = read(file);
    (content ?? '').split('\n').forEach((text, index) => {
      if (text.trim() === '') return;
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        return problem(file, `not JSON (line ${index + 1})`);
      }
      each(obj(value), index + 1);
    });
    return content !== undefined;
  };
  return { problem, read, files, jsonLines };
}

/** True when `text` holds `id` with no letter, digit, `_` or `-` directly before or after it. */
function holdsToken(text: string, id: string): boolean {
  const part = /[A-Za-z0-9_-]/;
  for (let at = id === '' ? -1 : text.indexOf(id); at !== -1; at = text.indexOf(id, at + 1)) {
    if (!part.test(text.charAt(at - 1)) && !part.test(text.charAt(at + id.length))) return true;
  }
  return false;
}

/** R1. Rows are in the order their (`message.id`, `requestId`) first appears: directories as given, files in path order. */
export function claudeUsage(dirs: string[], cardIds: string[], list?: List): Usage {
  const errors: Row[] = [];
  const r = reader('claude-code', errors, list);
  const rows = new Map<string, Row>();
  for (const dir of dirs) {
    for (const file of r.files(dir, /\.jsonl$/)) {
      const agentId = /^agent-(.+)\.jsonl$/.exec(path.basename(file))?.[1] ?? null;
      let agentType: string | null = null;
      let agentCard: string | null = null;
      const metaFile = file.replace(/\.jsonl$/, '.meta.json');
      // An absent meta file is a normal result; one that cannot be read is an error row. Of its description only a card id is kept.
      const metaText = agentId === null ? undefined : r.read(metaFile, true);
      if (metaText !== undefined) {
        try {
          const meta = obj(JSON.parse(metaText));
          agentType = str(meta['agentType']);
          agentCard = cardIds.find((id) => holdsToken(str(meta['description']) ?? '', id)) ?? null;
        } catch {
          r.problem(metaFile, 'not JSON');
        }
      }
      r.jsonLines(file, (line, n) => {
        const message = obj(line['message']);
        if (line['type'] !== 'assistant' || typeof message['usage'] !== 'object' || message['usage'] === null) return;
        const usage = obj(message['usage']);
        // Without a message id the request cannot be told from another, so the line is counted as an error, not merged.
        if (str(message['id']) === null) return r.problem(file, `usage line without message.id (line ${n})`);
        // A line without a requestId is a request of its own, keyed by where it stands.
        const requestId = str(line['requestId']);
        rows.set(JSON.stringify(requestId === null ? [message['id'], null, file, n] : [message['id'], requestId]), {
          source: 'claude-code', sessionId: str(line['sessionId']), ts: str(line['timestamp']), model: str(message['model']), cwd: str(line['cwd']), sidechain: line['isSidechain'] === true,
          inputTokens: num(usage['input_tokens']), outputTokens: num(usage['output_tokens']), cacheReadTokens: num(usage['cache_read_input_tokens']), cacheWriteTokens: num(usage['cache_creation_input_tokens']), cacheWrite1hTokens: num(obj(usage['cache_creation'])['ephemeral_1h_input_tokens']) ?? 0,
          agentId, agentType, agentCard,
        });
      });
    }
  }
  return { rows: [...rows.values()], errors };
}

/**
 * R2. A `token_count` line counts when it carries `info.total_token_usage`, and a `turn_context` line when it names a model,
 * so a later line without the field changes nothing. The session id and cwd are those of the first `session_meta` line.
 */
export function codexUsage(dir: string): Usage {
  const usage: Usage = { rows: [], errors: [] };
  const r = reader('codex', usage.errors);
  for (const file of r.files(dir, /^rollout-.*\.jsonl$/)) {
    let meta: Record<string, unknown> | undefined;
    let model: string | null = null;
    let last: { ts: string | null; total: Record<string, unknown> } | undefined;
    const readable = r.jsonLines(file, (line) => {
      const payload = obj(line['payload']);
      const total = obj(payload['info'])['total_token_usage'];
      if (line['type'] === 'session_meta') meta ??= payload;
      else if (line['type'] === 'turn_context') model = str(payload['model']) ?? model;
      else if (line['type'] === 'event_msg' && payload['type'] === 'token_count' && typeof total === 'object' && total !== null) last = { ts: str(line['timestamp']), total: obj(total) };
    });
    if (!last) {
      // A file that could not be read already has its error row.
      if (readable) r.problem(file, 'no token_count line');
      continue;
    }
    const [input, cached] = [num(last.total['input_tokens']), num(last.total['cached_input_tokens'])];
    usage.rows.push({ source: 'codex', sessionId: str(meta?.['id']), cwd: str(meta?.['cwd']), ts: last.ts, model, inputTokens: input === null || cached === null ? null : input - cached, cacheReadTokens: cached, cacheWriteTokens: num(last.total['cache_write_input_tokens']), outputTokens: num(last.total['output_tokens']) });
  }
  return usage;
}

/** R3. Reads `evidence/<goal>/review/<card>/**.log`; a log directly under `review` has a null card. The last `tokens used` line that a number line follows counts. */
export function reviewLogUsage(stateDir: string): Usage {
  const usage: Usage = { rows: [], errors: [] };
  const r = reader('review-log', usage.errors);
  const evidence = path.join(stateDir, 'evidence');
  for (const file of r.files(evidence, /\.log$/)) {
    const [goalId, review, ...below] = path.relative(evidence, file).split(path.sep);
    if (review !== 'review') continue;
    const lines = (r.read(file) ?? '').split(/\r?\n/);
    const at = lines.findLastIndex((line, i) => line === 'tokens used' && /^\d[\d,]*$/.test(lines[i + 1] ?? ''));
    if (at === -1) continue;
    const duration = /^# review .*\bdurationMs=(\d+)\b/.exec(lines[0] ?? '');
    const model = lines.map((line) => /^model: (\S+)$/.exec(line)).find((match) => match !== null);
    usage.rows.push({ source: 'review-log', goalId: goalId ?? null, cardId: below.length > 1 ? below[0] : null, invocation: path.basename(file, '.log'), totalTokens: Number(lines[at + 1]!.replaceAll(',', '')), durationMs: duration ? Number(duration[1]) : null, model: model?.[1] ?? null });
  }
  return usage;
}

/**
 * R6. Returns each row with `cardId`, `goalId` and `stage` set. An attempt or a state span holds a `ts` when
 * `startTs <= ts < endTs`, so one without both ends (the open last span of a card) holds nothing. A returned row is built
 * from the usage columns the given row carries, so no other field of a caller's row comes back.
 */
export function attribute(rows: Row[], tables: Pick<Tables, 'card_runs' | 'attempts' | 'state_spans'>, worktreeRoot: string): Row[] {
  const time = (value: unknown): number => (typeof value === 'string' ? Date.parse(value) : NaN);
  const only = (spans: Row[], ts: number): string | null => {
    const held = spans.filter((s) => time(s['startTs']) <= ts && ts < time(s['endTs']));
    return held.length === 1 ? str(held[0]!['cardId']) : null;
  };
  const goalOf = (cardId: string, ts: number): string | null => {
    const earlier = tables.card_runs.filter((run) => run['cardId'] === cardId && time(run['startedAt']) <= ts).sort((a, b) => time(a['startedAt']) - time(b['startedAt']));
    return str((earlier.findLast((run) => ts <= time(run['updatedAt'])) ?? earlier.at(-1))?.['goalId']);
  };
  const named = (row: Row, set: Row): Row => Object.assign(Object.fromEntries(USAGE_COLUMNS.usage.filter((key) => key in row).map((key) => [key, row[key]])), set);
  return rows.map((row) => {
    if (row['source'] === 'review-log') return named(row, { stage: 'review' });
    const ts = time(row['ts']);
    let cardId: string | null = null;
    let stage = 'unattributed';
    if (row['source'] === 'codex') {
      // The first segment of the cwd below the worktree root; only the segment `..` leads outside. A cwd that is
      // empty or relative stays unattributed: path.relative would resolve it against the invocation directory.
      const cwd = str(row['cwd']) ?? '';
      const rel = path.isAbsolute(cwd) ? path.relative(worktreeRoot, cwd) : '';
      const first = rel.split(path.sep)[0]!;
      if (first !== '' && first !== '..' && !path.isAbsolute(rel)) [cardId, stage] = [first, 'review'];
    } else if (row['agentId'] !== null) {
      cardId = str(row['agentCard']) ?? only(tables.attempts, ts);
      if (cardId !== null) stage = row['agentType'] === 'implementer' ? 'implement' : 'subagent';
    } else {
      cardId = only(tables.state_spans, ts);
      if (cardId !== null) stage = 'coordinate';
    }
    return named(row, { cardId, goalId: cardId === null ? null : goalOf(cardId, ts), stage });
  });
}

/**
 * R7. List-price cost in USD; null for a model without an entry and for a row without `inputTokens`. A token kind the row
 * lacks counts as 0. `cacheWrite1hTokens` take the long cache-write price and the rest of `cacheWriteTokens` the shorter one,
 * which is every cache-write token of a Codex row, since its log names no duration.
 */
export function priceOf(row: Row, prices: Prices): number | null {
  const model = String(row['model']);
  if (!Object.hasOwn(prices, model) || typeof row['inputTokens'] !== 'number') return null;
  const p = prices[model]!;
  const oneHour = num(row['cacheWrite1hTokens']) ?? 0;
  const kinds: [unknown, number][] = [[row['inputTokens'], p.input], [row['cacheReadTokens'], p.cacheRead], [(num(row['cacheWriteTokens']) ?? 0) - oneHour, p.cacheWrite], [oneHour, p.cacheWriteLong], [row['outputTokens'], p.output]];
  return kinds.reduce((sum, [tokens, perMillion]) => sum + (num(tokens) ?? 0) * perMillion, 0) / 1e6;
}
