// Card T1-OUTCOME-INGEST: the outcome tables read from the state directory (card runs, goal journals) and the card registry.
// Dev-only measurement: files are read, never written, and each record that cannot be read becomes an `ingest_errors` row.
import { mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseCardText } from '../../src/artifacts/card.ts';
import { CardRun } from '../../src/core/types.ts';

/** Every table with its columns, in the key order `writeTables` writes. */
export const COLUMNS = {
  cards: ['id', 'status', 'superseded_by', 'depends_on', 'tdd', 'budget'],
  card_runs: ['goalId', 'cardId', 'startedAt', 'state', 'mergeVerified', 'prNumber', 'stopReason', 'stopDetail', 'substantiveDecisions', 'substantiveBlocks', 'updatedAt'],
  review_decisions: ['goalId', 'cardId', 'stage', 'outcome', 'mergeBlocking', 'reviewer', 'requestedAt', 'candidateSha', 'secondPass', 'baseSync', 'stopReview', 'decision', 'round', 'cycle', 'angles'],
  findings: ['goalId', 'cardId', 'id', 'stage', 'round', 'cycle', 'perspective', 'file', 'class', 'candidateSha', 'raisedAt', 'disposition', 'disputes', 'reraises', 'resolvedAt', 'advisory', 'outsideDelta', 'reason'],
  state_spans: ['goalId', 'cardId', 'state', 'startTs', 'endTs'],
  attempts: ['goalId', 'cardId', 'outcome', 'endTs', 'startTs'],
  ingest_errors: ['source', 'path', 'line', 'problem'],
} as const;
/** The tables of bench/outcome/usage.ts (card T1-OUTCOME-USAGE). `writeTables` writes each one it is given. */
export const USAGE_COLUMNS = {
  usage: ['source', 'sessionId', 'ts', 'model', 'cwd', 'sidechain', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'cacheWrite1hTokens', 'totalTokens', 'durationMs', 'invocation', 'agentId', 'agentType', 'agentCard', 'goalId', 'cardId', 'stage', 'costUsd'],
  usage_errors: ['source', 'path', 'problem'],
} as const;
export type TableName = keyof typeof COLUMNS;
export type Row = Record<string, unknown>;
export type Tables = Record<TableName, Row[]>;

/** The tables of bench/outcome/github.ts (card T1-OUTCOME-GITHUB) with their columns. `writeTables` writes each one it is given. */
export const GITHUB_COLUMNS = {
  prs: ['number', 'headRef', 'baseRef', 'state', 'createdAt', 'mergedAt', 'closedAt', 'mergeCommitSha', 'headSha'],
  checks: ['sha', 'name', 'status', 'conclusion', 'startedAt', 'completedAt', 'runAttempt'],
  reverts: ['sha', 'date', 'revertedSha', 'daysAfter'],
  branch_commits: ['number', 'sha', 'date', 'merge', 'modelCoAuthor'],
  github_errors: ['command', 'exit', 'stderr', 'problem'],
  required_checks: ['name'],
} as const;
export type GithubTable = keyof typeof GITHUB_COLUMNS;

/** The entries of `dir` in name order: its directories, or its files ending in `suffix`. Undefined when `dir` is absent or not a directory. */
function entries(dir: string, suffix?: string): string[] | undefined {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return undefined;
  const all = readdirSync(dir, { withFileTypes: true });
  return all.filter((e) => (suffix === undefined ? e.isDirectory() : e.isFile() && e.name.endsWith(suffix))).map((e) => e.name).sort();
}

function parseJson(text: string): { value: unknown } | undefined {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return undefined;
  }
}

/** A field the record does not carry is written as null, never as a default. */
const orNull = <T>(value: T | undefined): T | null => value ?? null;
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** Rows are returned in read order: files in name order, and the entries of a file in the order it stores them. */
export function ingestState(input: { stateDir: string; cardsDir: string }): Tables {
  const t: Tables = { cards: [], card_runs: [], review_decisions: [], findings: [], state_spans: [], attempts: [], ingest_errors: [] };
  const problem = (source: string, file: string, what: string, line: number | null = null): void => void t.ingest_errors.push({ source, path: file, line, problem: what });
  /** The entries of a source directory; one that is absent or not a directory is an error row and no entries. */
  const source = (name: string, dir: string, suffix?: string): string[] => entries(dir, suffix) ?? (problem(name, dir, 'missing directory'), []);

  for (const name of source('card', input.cardsDir, '.md')) {
    if (name.startsWith('_')) continue;
    const file = path.join(input.cardsDir, name);
    const parsed = parseCardText(readFileSync(file, 'utf8'), file);
    if ('error' in parsed) problem('card', file, `${parsed.error}: ${parsed.findings.map((f) => f.message).join('; ')}`);
    else t.cards.push({ id: parsed.card.id, status: parsed.card.status, superseded_by: orNull(parsed.card.superseded_by), depends_on: parsed.card.depends_on, tdd: parsed.card.tdd, budget: orNull(parsed.card.budget) });
  }

  const runsDir = path.join(input.stateDir, 'cards');
  for (const goal of source('card_run', runsDir)) {
    // A goal directory without card-run files is a normal empty result.
    for (const name of entries(path.join(runsDir, goal), '.json') ?? []) {
      const file = path.join(runsDir, goal, name);
      const raw = parseJson(readFileSync(file, 'utf8'));
      const parsed = raw && CardRun.safeParse(raw.value);
      if (!parsed) problem('card_run', file, 'not JSON');
      else if (!parsed.success) problem('card_run', file, `CardRun: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      else addRun(t, parsed.data);
    }
  }

  // The latest CARD_STATE row and ATTEMPT_STARTED timestamp of each goal and card, by position in the journal.
  const openSpan = new Map<string, Row>();
  const started = new Map<string, string | null>();
  const journalDir = path.join(input.stateDir, 'journal');
  for (const name of source('journal', journalDir, '.jsonl')) {
    const file = path.join(journalDir, name);
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      if (line.trim() === '') return;
      const parsed = parseJson(line);
      if (!parsed) return problem('journal', file, 'not JSON', index + 1);
      const e = (parsed.value ?? {}) as { type?: unknown; ts?: unknown; goalId?: unknown; cardId?: unknown; data?: Record<string, unknown> };
      const [goalId, cardId, ts] = [text(e.goalId), text(e.cardId), text(e.ts)];
      const key = JSON.stringify([goalId, cardId]);
      if (e.type === 'CARD_STATE') {
        const previous = openSpan.get(key);
        if (previous) previous['endTs'] = ts;
        const row: Row = { goalId, cardId, state: text(e.data?.['to']), startTs: ts, endTs: null };
        openSpan.set(key, row);
        t.state_spans.push(row);
      } else if (e.type === 'ATTEMPT_STARTED') started.set(key, ts);
      else if (e.type === 'ATTEMPT_FINISHED') t.attempts.push({ goalId, cardId, outcome: text(e.data?.['outcome']), endTs: ts, startTs: started.get(key) ?? null });
    });
  }
  return t;
}

/** The card-run row, then one review row per formal invocation and per pre round, then one row per finding. */
function addRun(t: Tables, run: CardRun): void {
  const { goalId, cardId } = run;
  t.card_runs.push({ goalId, cardId, startedAt: run.startedAt, state: run.state, mergeVerified: run.mergeVerified, prNumber: orNull(run.pr?.number), stopReason: orNull(run.stop?.reason), stopDetail: orNull(run.stop?.detail), substantiveDecisions: run.review.substantiveDecisions, substantiveBlocks: run.review.substantiveBlocks, updatedAt: run.updatedAt });
  for (const i of run.review.invocations) {
    t.review_decisions.push({ goalId, cardId, stage: 'formal', outcome: i.outcome, mergeBlocking: orNull(i.mergeBlocking), reviewer: i.reviewer, requestedAt: i.requestedAt, candidateSha: orNull(i.candidateSha), secondPass: orNull(i.secondPass), baseSync: orNull(i.baseSync), stopReview: i.stopReview !== undefined, decision: orNull(i.decision), round: null, cycle: null, angles: [] });
  }
  for (const r of run.preReview.rounds) {
    const angles = (r.perspectives ?? []).map((p) => ({ angle: p.name, outcome: p.outcome }));
    t.review_decisions.push({ goalId, cardId, stage: 'pre', outcome: r.outcome, mergeBlocking: null, reviewer: r.reviewer, requestedAt: r.requestedAt, candidateSha: orNull(r.candidateSha), secondPass: null, baseSync: null, stopReview: false, decision: null, round: r.round, cycle: r.cycle, angles });
  }
  for (const f of run.findings) {
    t.findings.push({ goalId, cardId, id: f.id, stage: f.stage, round: f.round, cycle: orNull(f.cycle), perspective: orNull(f.perspective), file: orNull(f.file), class: orNull(f.class), candidateSha: orNull(f.candidateSha), raisedAt: f.raisedAt, disposition: f.disposition, disputes: f.disputes.length, reraises: f.reraised.length, resolvedAt: orNull(f.resolvedAt), advisory: orNull(f.advisory), outsideDelta: orNull(f.outsideDelta), reason: f.reason });
  }
}

/**
 * The canonical path of `p`: its nearest ancestor that `resolve` resolves through every link, then the remainder. An entry
 * that is absent or cannot be resolved for any other reason (EACCES on it or on an ancestor) is part of the remainder, so
 * a directory that cannot be reached is still compared, by the path it would have. With no ancestor that resolves (a drive
 * that is gone) the path is compared as given, so this never throws.
 */
function canonicalPath(p: string, resolve: (p: string) => string): string {
  let head = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(resolve(head), ...rest);
    } catch {
      if (path.dirname(head) === head) return path.resolve(p);
    }
    rest.unshift(path.basename(head));
    head = path.dirname(head);
  }
}

/** Throws when `outDir` is one of the `readOnly` directories or under one, by canonical path. The one place that decides where output may be written. */
function assertWritable(outDir: string, readOnly: string[], resolve: (p: string) => string): void {
  const target = canonicalPath(outDir, resolve);
  for (const dir of readOnly) {
    const rel = path.relative(canonicalPath(dir, resolve), target);
    const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
    if (!outside) throw new Error(`refusing to write to ${outDir}: it is inside ${dir}, which the outcome scripts only read`);
  }
}

/**
 * Writes `<table>.jsonl` under `outDir`, one row per line: the keys in the order of `COLUMNS` (a missing one as null) and
 * the lines sorted by UTF-16 code unit, so the order the rows are given in changes no byte. An empty table is an empty file.
 * A table of `USAGE_COLUMNS` or `GITHUB_COLUMNS` is written the same way when `tables` holds it, and no file of its name is touched when it does not.
 * `outDir` is checked against `readOnly` before anything is created. Each file replaces the entry of its name: the entry is
 * removed and the file created exclusively, so a symbolic or hard link at that name is never written through.
 */
export function writeTables(tables: Tables & Partial<Record<keyof typeof USAGE_COLUMNS | GithubTable, Row[]>>, outDir: string, readOnly: string[] = [], resolve: (p: string) => string = realpathSync.native): void {
  assertWritable(outDir, readOnly, resolve);
  mkdirSync(outDir, { recursive: true });
  for (const [name, columns] of Object.entries({ ...COLUMNS, ...USAGE_COLUMNS, ...GITHUB_COLUMNS })) {
    const rows = tables[name as keyof typeof tables];
    if (rows === undefined) continue;
    const lines = rows.map((row) => JSON.stringify(Object.fromEntries(columns.map((column) => [column, row[column] ?? null])))).sort();
    const file = path.join(outDir, `${name}.jsonl`);
    rmSync(file, { force: true });
    writeFileSync(file, lines.map((line) => `${line}\n`).join(''), { flag: 'wx' });
  }
}
