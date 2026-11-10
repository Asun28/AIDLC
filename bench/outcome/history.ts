// Card T1-OUTCOME-HISTORY: the ruling set, the repeat-block classification and the findings followed by a change, read
// from git on an injected runner. Read-only: every git call is `rev-parse`, `log`, `grep`, `blame`, `merge-base` or `diff --quiet`.
// The base follows `--end-of-options`, a commit id from the state reaches git only when it is 40 lower-case hex characters,
// and a file from a finding follows `--`. No git failure leaves a function: it is one `history_errors` row.
import type { SyncRunner } from '../../src/probes/exec.ts';
import type { HistoryTable, Row, Tables } from './ingest.ts';

/** The rows a reader returns and one `history_errors` row per git command that failed. */
export type Read = { rows: Row[]; errors: Row[] };

const TIMEOUT_MS = 120_000;
const SHA = /^[0-9a-f]{40}$/;
/** R1: the ruling match, anywhere in the commit message. */
const RULING = /user(?:'s)? ruling/i;
const ID = 'T\\d+-[A-Z0-9]+(?:-[A-Z0-9]+)*';
const CARD = new RegExp(`\\b${ID}\\b`, 'g');
const REPLACES = new RegExp(`\\b(${ID}) replaces (${ID})\\b`);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const decided = (entry: Row): boolean => entry['outcome'] === 'pass' || entry['outcome'] === 'block';

/** `exit` is the exit code when it is one of the answers the caller named, else undefined, with one `history_errors` row. */
type Git = (args: string[], answers?: number[]) => { exit: number | undefined; out: string };

/** Git through the runner. A command line runs once per reader: every call only reads, so a second one is answered from the first. */
function gitOn(runner: SyncRunner, errors: Row[]): Git {
  const done = new Map<string, ReturnType<Git>>();
  return (args, answers = [0]) => {
    const key = JSON.stringify(args);
    const known = done.get(key);
    if (known) return known;
    const r = runner('git', args, { timeoutMs: TIMEOUT_MS });
    const answered = !r.timedOut && r.exitCode !== null && answers.includes(r.exitCode);
    if (!answered) errors.push({ command: ['git', ...args].join(' '), exit: r.exitCode, stderr: r.stderr.trim().split(/\r?\n/)[0] ?? '' });
    const result = answered ? { exit: r.exitCode ?? undefined, out: r.stdout } : { exit: undefined, out: '' };
    done.set(key, result);
    return result;
  };
}

/** Whether the repository holds the commit: `rev-parse --verify --quiet` exits 0 when it does and 1 when it does not. Undefined after any other exit. */
function holds(git: Git, sha: string): boolean | undefined {
  const exit = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${sha}^{commit}`], [0, 1]).exit;
  return exit === undefined ? undefined : exit === 0;
}

/** Whether `file` is the same in both commits: `diff --quiet` exits 0 when it is and 1 when it differs. Undefined after any other exit. */
function sameFile(git: Git, from: string, to: string, file: string): boolean | undefined {
  const exit = git(['--literal-pathspecs', 'diff', '--quiet', '--no-ext-diff', '--end-of-options', from, to, '--', file], [0, 1]).exit;
  return exit === undefined ? undefined : exit === 0;
}

/** The review entries of the finding's run and of one stage, in the order the run stores them. */
const entriesOf = (tables: Tables, finding: Row, stage: unknown): Row[] => tables.review_decisions.filter((d) => d['goalId'] === finding['goalId'] && d['cardId'] === finding['cardId'] && d['stage'] === stage);

/**
 * R1: the first-parent commits of `base` whose message holds the ruling match, in the order git lists them (newest first).
 * `base` is first resolved to a commit; one that does not resolve is one error row and no further git call. `date` is the
 * commit date as UTC ISO, `cards` the card ids of the subject, `on` the subject text after the first `ruling on `.
 */
export function rulings(runner: SyncRunner, base: string): Read {
  const read: Read = { rows: [], errors: [] };
  const git = gitOn(runner, read.errors);
  const tip = git(['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).out.trim();
  if (!SHA.test(tip)) return read;
  for (const record of git(['log', '--first-parent', '--format=%H %cI%n%B%x00', '--end-of-options', tip, '--']).out.split('\0')) {
    const m = /^\n?([0-9a-f]{40}) (\S+)\n([^\r\n]*)([\s\S]*)$/.exec(record);
    if (!m || !RULING.test(m[3]! + m[4]!)) continue;
    const [subject, time] = [m[3]!, Date.parse(m[2]!)];
    const replaces = REPLACES.exec(subject);
    read.rows.push({ sha: m[1]!, date: Number.isNaN(time) ? null : new Date(time).toISOString(), subject, cards: subject.match(CARD) ?? [], successor: replaces?.[1] ?? null, predecessor: replaces?.[2] ?? null, on: /ruling on (.+)$/i.exec(subject)?.[1]!.trim() ?? null });
  }
  return read;
}

/**
 * R2: each ruling with the last run of its `predecessor`, else of its first card: the run with the latest `startedAt`, of
 * equal ones the one read last. The last formal entry is the last one the run stores, and a finding is open when the run
 * holds no `resolvedAt` for it. `successorMerged`: a run of the `successor` has `mergeVerified`; null without a successor.
 * A ruling whose card has no run, or that names no card, has null in every joined field.
 */
export function rulingSet(rulings: Row[], tables: Tables): Row[] {
  return rulings.map((ruling) => {
    const card = ruling['predecessor'] ?? (Array.isArray(ruling['cards']) ? ruling['cards'][0] : undefined);
    const run = tables.card_runs.filter((r) => r['cardId'] === card).reduce<Row | undefined>((last, r) => (last === undefined || Date.parse(String(r['startedAt'])) >= Date.parse(String(last['startedAt'])) ? r : last), undefined);
    if (run === undefined) return { ...ruling, stopReason: null, stopDetail: null, candidateSha: null, outcome: null, decision: null, findings: null, successorMerged: null };
    const entry = entriesOf(tables, run, 'formal').at(-1);
    const open = tables.findings.filter((f) => f['goalId'] === run['goalId'] && f['cardId'] === run['cardId'] && (f['resolvedAt'] ?? null) === null);
    return {
      ...ruling,
      stopReason: run['stopReason'] ?? null,
      stopDetail: run['stopDetail'] ?? null,
      candidateSha: entry?.['candidateSha'] ?? null,
      outcome: entry?.['outcome'] ?? null,
      decision: entry?.['decision'] ?? null,
      findings: open.map((f) => ({ id: f['id'], class: f['class'] ?? null, file: f['file'] ?? null, reason: f['reason'] })),
      successorMerged: text(ruling['successor']) === null ? null : tables.card_runs.some((r) => r['cardId'] === ruling['successor'] && r['mergeVerified'] === true),
    };
  });
}

/** R4. Every exit code read as an answer is named where the command is given; any other exit is an error row and `unknown`. */
function predates(git: Git, file: string | null, first: string | null, at: string | null, line: number | null): string {
  if (file === null || first === null || at === null || !SHA.test(first) || !SHA.test(at)) return 'unknown';
  if (holds(git, first) !== true || holds(git, at) !== true) return 'unknown';
  if (line === null) {
    const same = sameFile(git, first, at, file);
    return same === undefined ? 'unknown' : same ? 'true' : 'file-changed';
  }
  // The line count of the file in `at`: `grep -c` exits 0 and prints `<at>:<file>:<count>`, and exits 1 for a file that
  // has no line or is not in the commit. A line past the end is therefore `unknown` before any blame, and no error.
  const counted = git(['--literal-pathspecs', 'grep', '-a', '-c', '-e', '$', at, '--', file], [0, 1]);
  if (counted.exit !== 0 || line < 1 || line > Number(/:(\d+)\s*$/.exec(counted.out)?.[1] ?? 0)) return 'unknown';
  const named = /^([0-9a-f]{40}) /.exec(git(['blame', '--porcelain', '-L', `${line},${line}`, at, '--', file]).out)?.[1];
  if (named === undefined) return 'unknown';
  if (named === first) return 'true';
  // `merge-base --is-ancestor` exits 0 for an ancestor and 1 for a commit that is none.
  const exit = git(['merge-base', '--is-ancestor', named, first], [0, 1]).exit;
  return exit === undefined ? 'unknown' : exit === 0 ? 'true' : 'false';
}

/**
 * R3: one row per formal finding of round 2 or later, in the order of `tables.findings`. `first` is the `candidateSha` of
 * the first formal entry the run stores with outcome `pass` or `block`; `line` is the first number after `@ <file>:`.
 */
export function repeatBlocks(runner: SyncRunner, tables: Tables): Read {
  const read: Read = { rows: [], errors: [] };
  const git = gitOn(runner, read.errors);
  for (const f of tables.findings) {
    if (f['stage'] !== 'formal' || !(Number(f['round']) >= 2)) continue;
    const cited = /@ [^\s:]+:(\d+)/.exec(text(f['reason']) ?? '')?.[1];
    const [file, line] = [text(f['file']), cited === undefined ? null : Number(cited)];
    const first = text(entriesOf(tables, f, 'formal').find(decided)?.['candidateSha']);
    read.rows.push({ goalId: f['goalId'], cardId: f['cardId'], id: f['id'], file, line, outsideDelta: f['outsideDelta'] ?? null, predates: predates(git, file, first, text(f['candidateSha']), line) });
  }
  return read;
}

/**
 * R5: one row per finding with a `file` and a `candidateSha`, in the order of `tables.findings`. The finding's entry is
 * the first entry of its run and stage with its `candidateSha`; the next one is the first later entry with outcome `pass`
 * or `block` and another `candidateSha`. No such entry, a sha that is not 40 hex or a commit the repository lacks: `unknown`.
 */
export function findingFixes(runner: SyncRunner, tables: Tables): Read {
  const read: Read = { rows: [], errors: [] };
  const git = gitOn(runner, read.errors);
  for (const f of tables.findings) {
    const [file, at] = [text(f['file']), text(f['candidateSha'])];
    if (file === null || at === null) continue;
    const entries = entriesOf(tables, f, f['stage']);
    const own = entries.findIndex((d) => d['candidateSha'] === at);
    const next = own < 0 ? null : text(entries.slice(own + 1).find((d) => decided(d) && typeof d['candidateSha'] === 'string' && d['candidateSha'] !== at)?.['candidateSha']);
    const same = next !== null && SHA.test(at) && SHA.test(next) && holds(git, at) === true && holds(git, next) === true ? sameFile(git, at, next, file) : undefined;
    read.rows.push({ goalId: f['goalId'], cardId: f['cardId'], id: f['id'], file, candidateSha: at, changedAfter: same === undefined ? 'unknown' : same ? 'false' : 'true' });
  }
  return read;
}

/** R7: the five tables for one base. */
export function historyTables(runner: SyncRunner, base: string, tables: Tables): Record<HistoryTable, Row[]> {
  const [found, blocks, fixes] = [rulings(runner, base), repeatBlocks(runner, tables), findingFixes(runner, tables)];
  return { rulings: found.rows, ruling_set: rulingSet(found.rows, tables), repeat_blocks: blocks.rows, finding_fixes: fixes.rows, history_errors: [...found.errors, ...blocks.errors, ...fixes.errors] };
}
