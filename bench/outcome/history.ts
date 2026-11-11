// Card T1-OUTCOME-HISTORY: the ruling set, the repeat-block classification and the findings followed by a change, read
// from git on an injected runner. Read-only: every git call is `rev-parse`, `log`, `grep`, `blame`, `merge-base` or `diff --quiet`.
// The base follows `--end-of-options`, a commit id from the state reaches git only when it is 40 hex characters, lowered first,
// and a file from a finding follows `--`. No git failure leaves a function: it is one `history_errors` row.
// R6: each call passes the options that fix its output and its answer, so no git configuration changes a result: `log`
// prints no signature lines and the message in UTF-8; `grep` counts with the basic pattern type, no colour, no submodule
// and `-z`, which prints the path unquoted; `blame` ignores no revision, runs no textconv and fixes the diff algorithm;
// `diff --quiet` runs no external diff and no textconv and ignores no submodule change.
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
/** A commit id from the state: 40 hex characters in either case are lowered, the form git prints and `SHA` tests; any other value is as stored. */
const sha = (value: unknown): string | null => (typeof value === 'string' && /^[0-9a-fA-F]{40}$/.test(value) ? value.toLowerCase() : text(value));
/** R3: the first `@ <path>[:<line>]` of a reason, the path read and normalised as `findingLocation` of src/core/review-policy.ts does. */
const CITED = /@\s*([^\s@:]+)(?::(\d+))?/u;
/**
 * R3: a path as git names it, relative to the repository root: `/` for `\`, with `.`, empty and `..` segments resolved (the
 * root itself is `.`). Null for a path that leaves the repository or is absolute; nothing is resolved against a directory.
 */
function repoPath(file: string): string | null {
  const kept: string[] = [];
  const segments = file.replace(/\\/g, '/').split('/');
  if (segments[0] === '' || /^[A-Za-z]:/.test(file)) return null;
  for (const segment of segments) {
    if (segment === '..' && kept.pop() === undefined) return null;
    if (segment !== '..' && segment !== '.' && segment !== '') kept.push(segment);
  }
  return kept.join('/') || '.';
}
const decided = (entry: Row): boolean => entry['outcome'] === 'pass' || entry['outcome'] === 'block';

/** `exit` is the exit code when it is one of the answers the caller named, else undefined, with one `history_errors` row. */
type Git = (args: string[], answers?: number[]) => { exit: number | undefined; out: string };

/** Git through the runner. A command line runs once: every call only reads, so a second one is answered from the first. */
function gitOn(runner: SyncRunner, errors: Row[]): Git {
  const done = new Map<string, ReturnType<Git>>();
  return (args, answers = [0]) => {
    const key = JSON.stringify(args);
    const known = done.get(key);
    if (known) return known;
    // R6: no git child fetches a missing object. The variable is set, not the option: a git that does not know it ignores it.
    const r = runner('git', args, { timeoutMs: TIMEOUT_MS, env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } });
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
  const exit = git(['--literal-pathspecs', 'diff', '--quiet', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--end-of-options', from, to, '--', file], [0, 1]).exit;
  return exit === undefined ? undefined : exit === 0;
}

/** The review entries of the finding's run and of one stage, in the order the run stores them. */
const entriesOf = (tables: Tables, finding: Row, stage: unknown): Row[] => tables.review_decisions.filter((d) => d['goalId'] === finding['goalId'] && d['cardId'] === finding['cardId'] && d['stage'] === stage);

/**
 * R1: the first-parent commits of `base` whose message holds the ruling match, in the order git lists them (newest first).
 * `base` is first resolved to a commit; one that does not resolve is one error row and no further git call. `date` is the
 * commit date as UTC ISO, `cards` the card ids of the subject, `on` the subject text after the first `ruling on ` that starts a word.
 */
export function rulings(runner: SyncRunner, base: string): Read {
  const errors: Row[] = [];
  const git = gitOn(runner, errors);
  const tip = baseCommit(git, base, errors);
  return { rows: tip === undefined ? [] : rulingsOf(git, tip), errors };
}

/** The commit of `base`. Undefined when it does not resolve, which is one error row: a failed `rev-parse`, or one that printed no commit id. */
function baseCommit(git: Git, base: string, errors: Row[]): string | undefined {
  const args = ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`];
  const resolved = git(args);
  const tip = resolved.out.trim();
  if (SHA.test(tip)) return tip;
  if (resolved.exit === 0) errors.push({ command: ['git', ...args].join(' '), exit: 0, stderr: '' });
  return undefined;
}

function rulingsOf(git: Git, tip: string): Row[] {
  const rows: Row[] = [];
  for (const record of git(['log', '--first-parent', '--no-show-signature', '--no-color', '--encoding=UTF-8', '--format=%H %cI%n%B%x00', '--end-of-options', tip, '--']).out.split('\0')) {
    const m = /^\n?([0-9a-f]{40}) (\S+)\n([^\r\n]*)([\s\S]*)$/.exec(record);
    if (!m || !RULING.test(m[3]! + m[4]!)) continue;
    const [subject, time] = [m[3]!, Date.parse(m[2]!)];
    const replaces = REPLACES.exec(subject);
    rows.push({ sha: m[1]!, date: Number.isNaN(time) ? null : new Date(time).toISOString(), subject, cards: subject.match(CARD) ?? [], successor: replaces?.[1] ?? null, predecessor: replaces?.[2] ?? null, on: /\bruling on (.+)$/i.exec(subject)?.[1]!.trim() ?? null });
  }
  return rows;
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
      candidateSha: sha(entry?.['candidateSha']),
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
  // The line count of the file in `at`: `grep -c -z` exits 0 and prints `<at>:<file>`, a NUL and the count, and exits 1 for a file that
  // has no line or is not in the commit. A line past the end is therefore `unknown` before any blame, and no error.
  const counted = git(['--literal-pathspecs', 'grep', '-a', '-c', '-z', '--basic-regexp', '--no-color', '--no-recurse-submodules', '-e', '$', at, '--', file], [0, 1]);
  // The output must be that one line: a `file` that names a directory lists the files under it, and no count of those is used.
  const count = counted.out.startsWith(`${at}:${file}\0`) ? counted.out.slice(at.length + file.length + 2).trim() : '';
  if (counted.exit !== 0 || !/^\d+$/.test(count) || line < 1 || line > Number(count)) return 'unknown';
  const named = /^([0-9a-f]{40}) /.exec(git(['blame', '--porcelain', '--ignore-revs-file=', '--no-textconv', '--diff-algorithm=myers', '--indent-heuristic', '-L', `${line},${line}`, at, '--', file]).out)?.[1];
  if (named === undefined) return 'unknown';
  if (named === first) return 'true';
  // `merge-base --is-ancestor` exits 0 for an ancestor and 1 for a commit that is none.
  const exit = git(['merge-base', '--is-ancestor', named, first], [0, 1]).exit;
  return exit === undefined ? 'unknown' : exit === 0 ? 'true' : 'false';
}

/**
 * R3: one row per formal finding of round 2 or later, in the order of `tables.findings`. `first` is the `candidateSha` of
 * the first formal entry the run (goal and card) stores with outcome `pass` or `block`; `line` is that of the first citation
 * of the reason when its path is the finding's `file`, both normalised alike, and null otherwise: no later citation is read.
 */
export function repeatBlocks(runner: SyncRunner, tables: Tables): Read {
  const errors: Row[] = [];
  return { rows: blocksOf(gitOn(runner, errors), tables), errors };
}

function blocksOf(git: Git, tables: Tables): Row[] {
  const rows: Row[] = [];
  for (const f of tables.findings) {
    if (f['stage'] !== 'formal' || !(Number(f['round']) >= 2)) continue;
    const [stored, cited] = [text(f['file']), CITED.exec(text(f['reason']) ?? '')];
    // `stored` is written to the row; `file` is its repository path, which is compared and given to git.
    const file = stored === null ? null : repoPath(stored);
    const line = file !== null && cited?.[2] !== undefined && repoPath(cited[1]!) === file ? Number(cited[2]) : null;
    const first = sha(entriesOf(tables, f, 'formal').find(decided)?.['candidateSha']);
    rows.push({ goalId: f['goalId'], cardId: f['cardId'], id: f['id'], file: stored, line, outsideDelta: f['outsideDelta'] ?? null, predates: predates(git, file, first, sha(f['candidateSha']), line) });
  }
  return rows;
}

/**
 * R5: one row per finding with a `file` and a `candidateSha`, in the order of `tables.findings`. The finding's entry is
 * the entry of its run and stage that raised it: the formal entry whose `decision` is the finding's `round`, or the pre
 * round with its `round` and `cycle`; of several stored with that number, the last. When no entry of the stage records
 * it, as in records written before entries held a decision, it is the one `block` entry of the stage with the finding's
 * `candidateSha`, and there is none when no such entry or more than one exists: it is never the first of several entries
 * with that `candidateSha`. The next one is the first later entry with outcome `pass` or `block` and another
 * `candidateSha`. No raising entry, no next one, a sha that is not 40 hex or a commit the repository lacks: `unknown`.
 */
export function findingFixes(runner: SyncRunner, tables: Tables): Read {
  const errors: Row[] = [];
  return { rows: fixesOf(gitOn(runner, errors), tables), errors };
}

function fixesOf(git: Git, tables: Tables): Row[] {
  const rows: Row[] = [];
  for (const f of tables.findings) {
    const [file, at] = [text(f['file']), sha(f['candidateSha'])];
    if (file === null || at === null) continue;
    const entries = entriesOf(tables, f, f['stage']);
    const recorded = entries.findLastIndex((d) => (f['stage'] === 'formal' ? d['decision'] === f['round'] : d['round'] === f['round'] && (d['cycle'] ?? null) === (f['cycle'] ?? null)));
    const blocks = entries.flatMap((d, index) => (d['outcome'] === 'block' && sha(d['candidateSha']) === at ? [index] : []));
    const own = recorded >= 0 ? recorded : blocks.length === 1 ? blocks[0]! : -1;
    const next = own < 0 ? null : sha(entries.slice(own + 1).find((d) => decided(d) && sha(d['candidateSha']) !== null && sha(d['candidateSha']) !== at)?.['candidateSha']);
    const inRepo = repoPath(file);
    const same = inRepo !== null && next !== null && SHA.test(at) && SHA.test(next) && holds(git, at) === true && holds(git, next) === true ? sameFile(git, at, next, inRepo) : undefined;
    rows.push({ goalId: f['goalId'], cardId: f['cardId'], id: f['id'], file, candidateSha: at, changedAfter: same === undefined ? 'unknown' : same ? 'false' : 'true' });
  }
  return rows;
}

/**
 * R7: the five tables for one base, on one git, so a command line runs once in the run. R6: when the base does not
 * resolve, that one `rev-parse` is the only git call: there is no ruling, and every `predates` and `changedAfter` is `unknown`.
 */
export function historyTables(runner: SyncRunner, base: string, tables: Tables): Record<HistoryTable, Row[]> {
  const errors: Row[] = [];
  const onRunner = gitOn(runner, errors);
  const tip = baseCommit(onRunner, base, errors);
  const git: Git = tip === undefined ? () => ({ exit: undefined, out: '' }) : onRunner;
  const found = tip === undefined ? [] : rulingsOf(git, tip);
  return { rulings: found, ruling_set: rulingSet(found, tables), repeat_blocks: blocksOf(git, tables), finding_fixes: fixesOf(git, tables), history_errors: errors };
}
