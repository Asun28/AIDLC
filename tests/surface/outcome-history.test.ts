// Card T1-OUTCOME-HISTORY: the ruling set, the repeat blocks against decision 1 and the findings followed by a change (bench/outcome/history.ts), and their views.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findingFixes, historyTables, repeatBlocks, rulingSet, rulings } from '../../bench/outcome/history.ts';
import { ingestState, type Row, type Tables } from '../../bench/outcome/ingest.ts';
import { runSync, scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const temps: string[] = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temporary directory by its canonical path, removed after the tests. */
function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'aidlc-outcome-history-')));
  temps.push(dir);
  return dir;
}

function put(file: string, text: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/** `2026-<month>-<day>T<hh:mm>:00Z`. */
const at = (month: number, day: number, time = '00:00'): string => `2026-0${month}-${String(day).padStart(2, '0')}T${time}:00Z`;
const GONE = 'f'.repeat(40);
const HISTORY_FILES = ['rulings', 'ruling_set', 'repeat_blocks', 'finding_fixes', 'history_errors'].map((name) => `${name}.jsonl`);

const gitIn = (dir: string): SyncRunner => (command, args, options) => runSync(command, args, { ...options, cwd: dir });
const recordingGit = (dir: string): { runner: SyncRunner; calls: string[] } => {
  const calls: string[] = [];
  return { calls, runner: (command, args, options) => (calls.push([command, ...args].join(' ')), runSync(command, args, { ...options, cwd: dir })) };
};
let built: { dir: string; sha: Record<string, string> } | undefined;

/**
 * A real repository, built once. main: `c0` adds a.ts (three lines), b.ts and c.ts; `k1`, the first reviewed commit, changes
 * line 3 of a.ts; `k2`, the repair, changes line 2 of a.ts and b.ts; `k3` changes c.ts. Then ruling `r1` (January), a commit
 * that holds only `ruling`, a merge of branch side, whose one commit is a ruling main reaches through the second parent
 * only, and rulings `r2` (`USER RULING` in the body) and `r3` (`user ruling` in the subject), both in February.
 */
function repo(): { dir: string; sha: Record<string, string> } {
  if (built) return built;
  const dir = tempDir();
  const sha: Record<string, string> = {};
  const git = (args: string[], date = at(1, 1)): string => {
    const r = spawnSync('git', args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (name: string, date: string, message: string, files: Record<string, string> = {}): void => {
    for (const [file, text] of Object.entries(files)) put(path.join(dir, file), text);
    git(['add', '-A']);
    git(['commit', '-q', '--allow-empty', '-m', message], date);
    sha[name] = git(['rev-parse', 'HEAD']);
  };
  git(['init', '-q', '-b', 'main']);
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false'], ['core.autocrlf', 'false']]) git(['config', key!, value!]);
  put(path.join(dir, '.gitignore'), 'aidlc.config.json\nsub/\nx\n');
  commit('c0', at(1, 1), 'init', { 'a.ts': 'one\ntwo\nthree\n', 'b.ts': 'b\n', 'c.ts': 'c\n' });
  commit('k1', at(1, 2), 'first reviewed', { 'a.ts': 'one\ntwo\nthree by k1\n' });
  commit('k2', at(1, 3), 'repair', { 'a.ts': 'one\ntwo by k2\nthree by k1\n', 'b.ts': 'b by k2\n' });
  commit('k3', at(1, 4), 'second repair', { 'c.ts': 'c by k3\n' });
  commit('r1', at(1, 5), "card: T1-A-2 replaces T1-A by the user's ruling on R3 decision 4");
  commit('n1', at(1, 7), 'card: T1-C takes the ruling of the reviewer');
  git(['checkout', '-q', '-b', 'side']);
  commit('sideRuling', at(1, 8), "card: T1-S-2 replaces T1-S by the user's ruling on R3 decision 2");
  git(['checkout', '-q', 'main']);
  git(['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'], at(1, 8));
  commit('r2', at(2, 6), 'card: T1-B is bounded before it starts\n\nDecided by USER RULING.');
  commit('r3', at(2, 7), 'card: T1-D-2 replaces T1-D by the user ruling on R3 decision 4');
  put(path.join(dir, 'aidlc.config.json'), JSON.stringify({ base: 'main' }));
  mkdirSync(path.join(dir, 'sub'));
  return (built = { dir, sha });
}

const ruling = (s: string, date: string, subject: string, cards: string[], successor: string | null, predecessor: string | null, on: string | null): Row => ({ sha: s, date, subject, cards, successor, predecessor, on });
function expectedRulings(sha: Record<string, string>): [Row, Row, Row] {
  return [
    ruling(sha['r3']!, '2026-02-07T00:00:00.000Z', 'card: T1-D-2 replaces T1-D by the user ruling on R3 decision 4', ['T1-D-2', 'T1-D'], 'T1-D-2', 'T1-D', 'R3 decision 4'),
    ruling(sha['r2']!, '2026-02-06T00:00:00.000Z', 'card: T1-B is bounded before it starts', ['T1-B'], null, null, null),
    ruling(sha['r1']!, '2026-01-05T00:00:00.000Z', "card: T1-A-2 replaces T1-A by the user's ruling on R3 decision 4", ['T1-A-2', 'T1-A'], 'T1-A-2', 'T1-A', 'R3 decision 4'),
  ];
}

const cardText = (id: string, extra = ''): string => `---\nid: ${id}\ntitle: ${id}\nstatus: todo\nallow_paths:\n  - src/x.ts\ndod_command: npm test\n${extra}---\n\n# ${id}\n`;

/**
 * The registry: T1-A (superseded, the predecessor of ruling r1), T1-A-2, T1-B and T1-E (superseded, in no ruling). The state:
 * - `g-1/T1-A`, the last run of T1-A though it is read first: formal entries no-verdict on `c0`, then blocks on `k1`, `k2`,
 *   `k2` again and `k3`; pre rounds on `k1` twice; findings F1 to F9 and the pre finding F11, all resolved but F9.
 * - `g-2/T1-A`, an earlier run with another stop. `g-3/T1-A-2`, merged: pre rounds on `k1` and `k2`, its own findings F1 to F3.
 */
function fixture(sha: Record<string, string>): { stateDir: string; cardsDir: string } {
  const dir = tempDir();
  const [stateDir, cardsDir] = [path.join(dir, 'state'), path.join(dir, 'tasks')];
  for (const id of ['T1-A-2', 'T1-B']) put(path.join(cardsDir, `${id}.md`), cardText(id));
  put(path.join(cardsDir, 'T1-A.md'), cardText('T1-A', 'superseded_by: T1-A-2\n'));
  put(path.join(cardsDir, 'T1-E.md'), cardText('T1-E', 'superseded_by: T1-X\n'));
  const run = (goalId: string, cardId: string, startedAt: string, extra: object): string => put(path.join(stateDir, 'cards', goalId, `${cardId}.json`), JSON.stringify({ goalId, cardId, cardRevision: 0, goalGeneration: 0, state: 'STOP', startedAt, deadline: at(3, 1), updatedAt: at(1, 9), ...extra }));
  const formal = (n: number, outcome: string, candidateSha: string, extra: object = {}): object => ({ invocationId: `i${n}`, candidateDigest: `d${n}`, base: 'main', policyVersion: '1', reviewer: 'codex', requestedAt: at(1, 3, `0${n}:00`), outcome, candidateSha, ...extra });
  const round = (n: number, outcome: string, candidateSha: string): object => ({ round: n, cycle: 0, reviewer: 'deepseek', candidateDigest: `p${n}`, candidateSha, requestedAt: at(1, 2, `0${n}:00`), outcome });
  const resolvedAt = at(1, 4, '06:00');
  const f = (id: string, round: number, reason: string, extra: object): object => ({ id, stage: 'formal', round, reason, raisedAt: at(1, 3, '05:00'), resolvedAt, ...extra });
  const [k1, k2, k3] = [sha['k1']!, sha['k2']!, sha['k3']!];
  const stop = (reason: string, detail: string): object => ({ reason, detail, nextAction: 'rule', global: false, at: at(1, 4, '07:00') });
  run('g-1', 'T1-A', at(1, 3), {
    stop: stop('review', 'review stopped for a ruling'),
    review: { substantiveDecisions: 4, substantiveBlocks: 4, invocations: [formal(0, 'no-verdict', sha['c0']!), formal(1, 'block', k1, { decision: 1 }), formal(2, 'block', k2, { decision: 2 }), formal(3, 'block', k2, { decision: 3 }), formal(4, 'block', k3, { decision: 4, stopReview: 'F9 raised again' })] },
    preReview: { rounds: [round(1, 'block', k1), round(2, 'pass', k1)] },
    findings: [
      f('F1', 1, 'first @ a.ts:1', { file: 'a.ts', candidateSha: k1 }),
      f('F2', 2, 'old line @ a.ts:1', { file: 'a.ts', candidateSha: k2, outsideDelta: true, reraised: [{ stage: 'formal', round: 3, at: at(1, 3, '08:00'), reason: 'again' }] }),
      f('F3', 2, 'repaired lines @ a.ts:2-3', { file: 'a.ts', candidateSha: k2, outsideDelta: false, disputes: [{ at: at(1, 3, '06:00'), note: 'intended' }] }),
      f('F4', 2, 'past the end @ a.ts:9', { file: 'a.ts', candidateSha: k2 }),
      f('F5', 2, 'whole file @ c.ts', { file: 'c.ts', candidateSha: k2 }),
      f('F6', 2, 'whole file @ b.ts', { file: 'b.ts', candidateSha: k2, outsideDelta: true }),
      f('F7', 3, 'gone @ a.ts:1', { file: 'a.ts', candidateSha: GONE }),
      f('F8', 3, 'names no file', { candidateSha: k2 }),
      f('F9', 4, 'still there @ a.ts:3', { file: 'a.ts', candidateSha: k3, outsideDelta: true, class: 'off-by-one', resolvedAt: undefined }),
      f('F11', 1, 'pre @ a.ts:1', { stage: 'pre', perspective: 'bugs', file: 'a.ts', candidateSha: k1 }),
    ],
  });
  run('g-2', 'T1-A', at(1, 2), { stop: stop('time', 'an earlier stop') });
  run('g-3', 'T1-A-2', at(1, 5), {
    state: 'DONE',
    mergeVerified: true,
    review: { substantiveDecisions: 1, invocations: [formal(1, 'pass', k2, { decision: 1 })] },
    preReview: { rounds: [round(1, 'block', k1), round(2, 'pass', k2)] },
    findings: [
      f('F1', 1, 'fixed @ a.ts:2', { stage: 'pre', perspective: 'bugs', file: 'a.ts', candidateSha: k1 }),
      f('F2', 1, 'left alone @ c.ts:1', { stage: 'pre', perspective: 'bugs', file: 'c.ts', candidateSha: k1 }),
      f('F3', 1, 'not resolved @ a.ts:2', { stage: 'pre', perspective: 'security', file: 'a.ts', candidateSha: k1, resolvedAt: undefined, disputes: [{ at: at(1, 2, '06:00'), note: 'intended' }] }),
    ],
  });
  mkdirSync(path.join(stateDir, 'journal'));
  return { stateDir, cardsDir };
}

const block = (id: string, file: string | null, line: number | null, outsideDelta: boolean | null, predates: string): Row => ({ goalId: 'g-1', cardId: 'T1-A', id, file, line, outsideDelta, predates });
/** The repeat blocks of the fixture: `first` is `k1`, the earliest formal entry with a pass or a block, not `c0`. */
const BLOCKS: Row[] = [
  block('F2', 'a.ts', 1, true, 'true'), // line 1 is from c0, an ancestor of k1
  block('F3', 'a.ts', 2, false, 'false'), // the first line of the range; k2 changed it
  block('F4', 'a.ts', 9, null, 'unknown'),
  block('F5', 'c.ts', null, null, 'true'),
  block('F6', 'b.ts', null, true, 'file-changed'),
  block('F7', 'a.ts', 1, null, 'unknown'),
  block('F8', null, null, null, 'unknown'),
  block('F9', 'a.ts', 3, true, 'true'), // line 3 is from k1 itself
];

test("T1-OUTCOME-HISTORY acceptance 1: rulings returns the first-parent commits that hold user's ruling or user ruling in any letter case, with the cards, successor, predecessor and on of the subject [R1]", () => {
  const { dir, sha } = repo();
  assert.deepEqual(rulings(gitIn(dir), 'main'), { rows: expectedRulings(sha), errors: [] });
});

test('T1-OUTCOME-HISTORY acceptance 2: rulingSet joins a ruling to the last run of its predecessor, the last formal entry, the finding still open and successorMerged, and gives null fields for a ruling whose card has no run [R2]', () => {
  const { sha } = repo();
  const [r3, r2, r1] = expectedRulings(sha);
  const none = { stopReason: null, stopDetail: null, candidateSha: null, outcome: null, decision: null, findings: null, successorMerged: null };
  assert.deepEqual(rulingSet([r3, r2, r1], ingestState(fixture(sha))), [
    { ...r3, ...none },
    { ...r2, ...none },
    { ...r1, stopReason: 'review', stopDetail: 'review stopped for a ruling', candidateSha: sha['k3'], outcome: 'block', decision: 4, findings: [{ id: 'F9', class: 'off-by-one', file: 'a.ts', reason: 'still there @ a.ts:3' }], successorMerged: true },
  ]);
});

test('T1-OUTCOME-HISTORY acceptance 3: repeatBlocks classifies each formal finding of round 2 or later by whether its cited line, or its file, predates the first reviewed commit, and gives no row for round 1 [R3] [R4]', () => {
  const { dir, sha } = repo();
  assert.deepEqual(repeatBlocks(gitIn(dir), ingestState(fixture(sha))), { rows: BLOCKS, errors: [] });
});

test('T1-OUTCOME-HISTORY acceptance 4: findingFixes is true for a file the next reviewed commit of the same run and stage changed, false for one it left alone, unknown for the last reviewed commit and for an entry that repeats the commit [R5]', () => {
  const { dir, sha } = repo();
  const fix = (cardId: string, id: string, file: string, commit: string, changedAfter: string): Row => ({ goalId: cardId === 'T1-A' ? 'g-1' : 'g-3', cardId, id, file, candidateSha: commit === 'gone' ? GONE : sha[commit], changedAfter });
  assert.deepEqual(findingFixes(gitIn(dir), ingestState(fixture(sha))), {
    rows: [
      fix('T1-A', 'F1', 'a.ts', 'k1', 'true'),
      fix('T1-A', 'F2', 'a.ts', 'k2', 'false'), // the next formal entry repeats k2; the one after it is k3, which left a.ts alone
      fix('T1-A', 'F3', 'a.ts', 'k2', 'false'),
      fix('T1-A', 'F4', 'a.ts', 'k2', 'false'),
      fix('T1-A', 'F5', 'c.ts', 'k2', 'true'),
      fix('T1-A', 'F6', 'b.ts', 'k2', 'false'),
      fix('T1-A', 'F7', 'a.ts', 'gone', 'unknown'),
      fix('T1-A', 'F9', 'a.ts', 'k3', 'unknown'), // the last reviewed commit
      fix('T1-A', 'F11', 'a.ts', 'k1', 'unknown'), // the only later pre round repeats k1; the formal entries are another stage
      fix('T1-A-2', 'F1', 'a.ts', 'k1', 'true'),
      fix('T1-A-2', 'F2', 'c.ts', 'k1', 'false'),
      fix('T1-A-2', 'F3', 'a.ts', 'k1', 'true'),
    ],
    errors: [],
  });
});

test('T1-OUTCOME-HISTORY acceptance 5: a blame that exits 128 on an existing line is one history_errors row with the first line of its stderr and predates unknown for that finding, the other findings still classified [R6]', () => {
  const { dir, sha } = repo();
  const failing = scriptedRunner({ git: { exitCode: 128, stderr: 'fatal: boom\nsecond line' } });
  const runner: SyncRunner = (command, args, options) => (args.includes('blame') && args.includes('1,1') ? failing(command, args, options) : gitIn(dir)(command, args, options));
  const read = repeatBlocks(runner, ingestState(fixture(sha)));
  assert.deepEqual(read.rows, BLOCKS.map((row) => (row['id'] === 'F2' ? { ...row, predates: 'unknown' } : row)));
  assert.deepEqual(read.errors.map((e) => [String(e['command']).split(' ').slice(0, 2).join(' '), e['exit'], e['stderr']]), [['git blame', 128, 'fatal: boom']]);
});

test('T1-OUTCOME-HISTORY acceptance 9: a base of --output=x writes no file and is one history_errors row, and a finding whose candidateSha is --output=x is unknown with no git call [R6]', () => {
  const { dir, sha } = repo();
  const { runner, calls } = recordingGit(dir);
  const read = rulings(runner, '--output=x');
  assert.deepEqual([read.rows, read.errors.map((e) => e['command']), calls], [[], ['git rev-parse --verify --end-of-options --output=x^{commit}'], ['git rev-parse --verify --end-of-options --output=x^{commit}']]);
  // The entry after the finding's has a commit the repository holds, so only the 40-hex check keeps git from being called.
  const entry = (candidateSha: string): Row => ({ goalId: 'g', cardId: 'T1-A', stage: 'formal', outcome: 'block', candidateSha });
  const tables: Tables = { cards: [], card_runs: [], state_spans: [], attempts: [], ingest_errors: [], review_decisions: [entry(sha['k1']!), entry('--output=x'), entry(sha['k2']!)], findings: [{ goalId: 'g', cardId: 'T1-A', id: 'F1', stage: 'formal', round: 2, file: 'a.ts', candidateSha: '--output=x', outsideDelta: null, reason: 'x @ a.ts:1' }] };
  assert.deepEqual(repeatBlocks(runner, tables), { rows: [{ goalId: 'g', cardId: 'T1-A', id: 'F1', file: 'a.ts', line: 1, outsideDelta: null, predates: 'unknown' }], errors: [] });
  assert.deepEqual(findingFixes(runner, tables), { rows: [{ goalId: 'g', cardId: 'T1-A', id: 'F1', file: 'a.ts', candidateSha: '--output=x', changedAfter: 'unknown' }], errors: [] });
  assert.equal(calls.length, 1, 'a git call was made for a candidateSha that is not 40 hex');
  assert.equal(existsSync(path.join(dir, 'x')), false, 'git wrote the file the value names');
});

/** One run `g/T1-A` with formal block entries on the given commits, decisions 1, 2, 3 in that order, and the given formal findings. */
function oneRun(commits: string[], findings: [id: string, round: number, file: string, candidateSha: string, reason: string][]): Tables {
  const review_decisions = commits.map((candidateSha, index): Row => ({ goalId: 'g', cardId: 'T1-A', stage: 'formal', outcome: 'block', candidateSha, decision: index + 1 }));
  return { cards: [], card_runs: [], state_spans: [], attempts: [], ingest_errors: [], review_decisions, findings: findings.map(([id, round, file, candidateSha, reason]): Row => ({ goalId: 'g', cardId: 'T1-A', id, stage: 'formal', round, file, candidateSha, outsideDelta: null, reason })) };
}
const values = (rows: Row[], column: string): unknown[] => rows.map((row) => [row['id'], row[column]]);

test('T1-OUTCOME-HISTORY acceptance 11, base: with a base that is not a revision and tables that hold findings, the tables of the run hold one history_errors row and git was called once [R6]', () => {
  const { dir, sha } = repo();
  const { runner, calls } = recordingGit(dir);
  const t = historyTables(runner, 'no-such-base', ingestState(fixture(sha)));
  assert.deepEqual([t.history_errors.map((e) => e['command']), calls.length, t.rulings], [['git rev-parse --verify --end-of-options no-such-base^{commit}'], 1, []]);
});

test('T1-OUTCOME-HISTORY acceptance 11, entry: for entries on the commits A, B, A a finding raised at the third is unknown, and one raised at the first is compared with B [R3] [R5]', () => {
  const { dir, sha } = repo();
  const [a, b] = [sha['k1']!, sha['k2']!];
  const read = findingFixes(gitIn(dir), oneRun([a, b, a], [['F1', 1, 'a.ts', a, 'first @ a.ts:1'], ['F2', 3, 'a.ts', a, 'third @ a.ts:1']]));
  assert.deepEqual([values(read.rows, 'changedAfter'), read.errors], [[['F1', 'true'], ['F2', 'unknown']], []]);
});

test('T1-OUTCOME-HISTORY acceptance 11, citation: a reason x @ a.ts: see @ b.ts:1 with file a.ts gives a null line, and a first citation ./a.ts:2 gives line 2 [R3]', () => {
  const { dir, sha } = repo();
  const read = repeatBlocks(gitIn(dir), oneRun([sha['k1']!, sha['k2']!], [['F1', 2, 'a.ts', sha['k2']!, 'x @ a.ts: see @ b.ts:1'], ['F2', 2, 'a.ts', sha['k2']!, 'y @ ./a.ts:2 and @ a.ts:1']]));
  assert.deepEqual([values(read.rows, 'line'), values(read.rows, 'predates')], [[['F1', null], ['F2', 2]], [['F1', 'file-changed'], ['F2', 'false']]]);
});

test('T1-OUTCOME-HISTORY acceptance 11, case: a candidateSha in upper case and one in mixed case are classified as the same commit in lower case is, in repeatBlocks and in findingFixes [R6]', () => {
  const { dir, sha } = repo();
  const upper = (name: string): string => sha[name]!.toUpperCase();
  const mixed = (name: string): string => [...sha[name]!].map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c)).join('');
  const findings = (k2: string[]): Parameters<typeof oneRun>[1] => [['F1', 2, 'c.ts', k2[0]!, 'whole file @ c.ts'], ['F2', 2, 'a.ts', k2[1]!, 'repaired @ a.ts:2']];
  const expected = [[['F1', 'true'], ['F2', 'false']], [['F1', 'true'], ['F2', 'false']]];
  for (const tables of [oneRun([sha['k1']!, sha['k2']!, sha['k3']!], findings([sha['k2']!, sha['k2']!])), oneRun([upper('k1'), mixed('k2'), upper('k3')], findings([upper('k2'), mixed('k2')]))]) {
    assert.deepEqual([values(repeatBlocks(gitIn(dir), tables).rows, 'predates'), values(findingFixes(gitIn(dir), tables).rows, 'changedAfter')], expected);
  }
});

const duckdb = process.env['DUCKDB_BIN'] ?? (spawnSync('duckdb', ['--version'], { windowsHide: true }).status === 0 ? 'duckdb' : undefined);

test('T1-OUTCOME-HISTORY acceptance 6: run.ts prints the repeat blocks per predates value, the true-defect proxy per stage and perspective and the ruling figures of the fixture, and --no-history writes none of the five files [R7] [R8]', { skip: duckdb === undefined ? 'no duckdb binary' : false }, () => {
  const { dir, sha } = repo();
  const { stateDir, cardsDir } = fixture(sha);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(AIDLC_.*|NODE_OPTIONS)$/i.test(k)));
  /** `node bench/outcome/run.ts` started in a subdirectory of the fixture repository, without the usage and GitHub stages. */
  const outcome = (...more: string[]): { status: number | null; stderr: string; out: string; views: Map<string, Row[]> } => {
    const out = path.join(tempDir(), 'out');
    const r = spawnSync(process.execPath, [path.join(root, 'bench', 'outcome', 'run.ts'), '--state', stateDir, '--cards', cardsDir, '--out', out, '--duckdb', duckdb!, '--no-usage', '--no-github', ...more], { cwd: path.join(dir, 'sub'), env, encoding: 'utf8', windowsHide: true });
    return { status: r.status, stderr: r.stderr, out, views: new Map(r.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { view: string; rows: Row[] }).map((v) => [v.view, v.rows])) };
  };
  const r = outcome();
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(HISTORY_FILES.filter((name) => existsSync(path.join(r.out, name))), HISTORY_FILES);
  // Eight repeat blocks. Against outsideDelta: F5 predates and has no outsideDelta; F6 has outsideDelta and its file changed.
  assert.deepEqual(r.views.get('summary_repeat_blocks'), [
    { predates: 'false', n: 1, share: 0.125, differs_from_outsideDelta: 0 },
    { predates: 'file-changed', n: 1, share: 0.125, differs_from_outsideDelta: 1 },
    { predates: 'true', n: 3, share: 0.375, differs_from_outsideDelta: 1 },
    { predates: 'unknown', n: 3, share: 0.375, differs_from_outsideDelta: 0 },
  ]);
  // fixed: F1 of T1-A-2 alone; its F3 is not resolved and its F2 was left alone. F1 and F5 of T1-A are resolved and changed after, on a card without a merged run.
  assert.deepEqual(r.views.get('summary_true_defects'), [
    { stage: 'formal', perspective: null, raised: 9, disputed: 1, reraised: 1, fixed: 0 },
    { stage: 'pre', perspective: 'bugs', raised: 3, disputed: 0, reraised: 0, fixed: 1 },
    { stage: 'pre', perspective: 'security', raised: 1, disputed: 1, reraised: 0, fixed: 0 },
  ]);
  // Two cards have a run and there are three rulings: 2 / 3. T1-A and T1-E are superseded and only T1-A is a predecessor: 1 / 2.
  assert.deepEqual(r.views.get('summary_rulings')?.map((row) => ({ ...row, value: Math.round(Number(row['value']) * 1000) / 1000 })), [
    { metric: 'card_attempts_per_ruling', key: null, value: 0.667 },
    { metric: 'rulings_per_month', key: '2026-01', value: 1 },
    { metric: 'rulings_per_month', key: '2026-02', value: 2 },
    { metric: 'rulings_per_on', key: 'R3 decision 4', value: 2 },
    { metric: 'rulings_per_on', key: null, value: 1 },
    { metric: 'superseded_predecessor_share', key: null, value: 0.5 },
  ]);

  const off = outcome('--no-history');
  assert.equal(off.status, 0, off.stderr);
  assert.deepEqual(HISTORY_FILES.filter((name) => existsSync(path.join(off.out, name))), []);
  assert.equal(existsSync(path.join(off.out, 'cards.jsonl')), true);
  assert.deepEqual([...off.views.keys()].filter((name) => /repeat_blocks|true_defects|rulings/.test(name)), []);
});
