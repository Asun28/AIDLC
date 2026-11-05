/**
 * T1-REVIEW-BENCH-EXPORT: `aidlc review bench export` drafts unconfirmed cases from the card-run ledgers and pins each
 * candidate under `refs/aidlc/bench/`, in a fixture repository with fixed commit dates and fixed ISO timestamps.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mock, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ReviewBenchCase, ReviewFinding, ReviewLedger, type CardRun } from '../../src/core/types.ts';
import { runSync, type SyncRunner } from '../../src/probes/exec.ts';
import { exportBenchCases, formatBenchExport, loadBenchCases, type BenchExportOptions } from '../../src/review/bench.ts';
import { makeCardRun, makeGoal } from '../infra/helpers.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');

const GOAL = 'g-20261019000000-aaaaaa';
const GOAL_2 = 'g-20261020000000-bbbbbb';
const CARD = 'T1-BENCH-FIX';
const CARD_A = 'T1-BENCH-A';
const AT = '2026-10-19T00:00:00.000Z';
const ABSENT = 'a'.repeat(40);
const F2 = '[standards] 9 error handling @ src/calc.ts:12: the throw is lost -> keep it';
const F3 = '[spec] 14 scope fidelity (class: Missing-Guard) @ src/calc.ts:20-40: no guard -> add one';
const F4 = '[standards] nit @ src/calc.ts:7: a name -> rename it';

const gitEnv = { ...process.env, GIT_AUTHOR_DATE: '2026-10-19T00:00:00Z', GIT_COMMITTER_DATE: '2026-10-19T00:00:00Z' };

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: gitEnv, windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const commitAll = (root: string, message: string): string => {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
};

interface Repo {
  dir: string;
  root: string;
  caseDir: string;
  base: string;
  candidate: string;
  /** A commit off the base whose tree has no card file. */
  noCard: string;
  cleanup: () => void;
}

function repo(): Repo {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-bench-export-')));
  const root = path.join(dir, 'repo');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  git(root, ['init', '-q', '-b', 'main']);
  const lines = Array.from({ length: 45 }, (_, i) => `export const v${i + 1} = ${i + 1};`);
  writeFileSync(path.join(root, 'src', 'calc.ts'), lines.join('\n') + '\n');
  const base = commitAll(root, 'base');
  git(root, ['checkout', '-q', '-b', 'no-card']);
  writeFileSync(path.join(root, 'src', 'calc.ts'), lines.join('\n') + '\nexport const v46 = 46;\n');
  const noCard = commitAll(root, 'no card');
  git(root, ['checkout', '-q', '-b', CARD, base]);
  mkdirSync(path.join(root, 'specs', 'tasks'), { recursive: true });
  for (const id of [CARD, CARD_A]) writeFileSync(path.join(root, 'specs', 'tasks', `${id}.md`), `# ${id}\n`);
  writeFileSync(path.join(root, 'src', 'calc.ts'), lines.join('\n') + '\nexport const v46 = 47;\n');
  const candidate = commitAll(root, 'candidate');
  git(root, ['checkout', '-q', 'main']);
  const caseDir = path.join(root, 'evals', 'review');
  mkdirSync(caseDir, { recursive: true });
  return { dir, root, caseDir, base, candidate, noCard, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const finding = (id: string, reason: string, candidateSha: string | undefined, over: Record<string, unknown> = {}): ReviewFinding => ReviewFinding.parse({ id, stage: 'formal', round: 1, reason, raisedAt: AT, candidateSha, ...over });

const fixRun = (candidate: string, goal = GOAL): CardRun =>
  makeCardRun(goal, CARD, {
    base: { ref: 'main' },
    findings: [
      finding('F1', '[spec] 2 pre @ src/calc.ts:3: an R2 finding -> ignore it', candidate, { stage: 'pre' }),
      finding('F2', F2, candidate),
      finding('F3', F3, candidate, { round: 2, resolvedAt: AT }),
      finding('F4', F4, candidate, { disposition: 'disputed' }),
    ],
  });

const caseId = (finding: string, goal = GOAL, card = CARD) => `${card}.${goal}.${finding}`;
const ids = ['F2', 'F3', 'F4'].map((f) => caseId(f));
const options = (r: Repo, runs: CardRun[], over: Partial<BenchExportOptions> = {}): BenchExportOptions => ({ root: r.root, runs, cardId: CARD, ...over });
const caseFile = (r: Repo, id: string) => path.join(r.caseDir, `${id}.json`);
const benchRefs = (r: Repo) => git(r.root, ['for-each-ref', '--format=%(refname)', 'refs/aidlc/bench/']).split('\n').filter(Boolean);

test('T1-REVIEW-BENCH-EXPORT acceptance 1: one bug draft per formal finding, in the schema key order, with the id, class, site and base rules [R1] [R2] [R3]', () => {
  const r = repo();
  try {
    const report = exportBenchCases(options(r, [fixRun(r.candidate)]));
    assert.deepEqual(readdirSync(r.caseDir).sort(), ids.map((id) => `${id}.json`).sort());
    const base = git(r.root, ['merge-base', 'main', r.candidate]);
    const expected = (id: string, note: string, site: Record<string, unknown>) => ({ kind: 'bug', id: caseId(id), candidate: r.candidate, base, card: { id: CARD, path: `specs/tasks/${CARD}.md` }, confirmed: false, origin: `${CARD} ${id} (goal ${GOAL})`, note, expected: [site] });
    const want = {
      F2: expected('F2', `R3 decision 1, open: ${F2}`, { file: 'src/calc.ts', line: 12, window: 5, class: 'dim-9' }),
      F3: expected('F3', `R3 decision 2, open, resolved: ${F3}`, { file: 'src/calc.ts', line: 20, window: 20, class: 'missing-guard' }),
      F4: expected('F4', `R3 decision 1, disputed: ${F4}`, { file: 'src/calc.ts', line: 7, window: 5, class: 'unclassified' }),
    };
    for (const [id, value] of Object.entries(want)) {
      const text = readFileSync(caseFile(r, caseId(id)), 'utf8');
      const parsed = JSON.parse(text);
      assert.deepEqual(parsed, value);
      assert.deepEqual(Object.keys(parsed), ['kind', 'id', 'candidate', 'base', 'card', 'confirmed', 'origin', 'note', 'expected']);
      assert.equal(text, JSON.stringify(ReviewBenchCase.parse(parsed), null, 2) + '\n');
    }
    assert.deepEqual(report.written.map((w) => w.id), ids);
    assert.deepEqual(report.written[0], { id: ids[0], file: caseFile(r, ids[0]!), kind: 'bug', candidate: r.candidate, base, ref: `refs/aidlc/bench/${ids[0]}` });
    assert.deepEqual(loadBenchCases(r.caseDir).map((c) => c.id), [...ids].sort());
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R1: runs are read in goal-id order and then in finding order, and cardId keeps that card', () => {
  const r = repo();
  try {
    const other = makeCardRun(GOAL, CARD_A, { base: { ref: 'main' }, findings: [finding('F9', F2, r.candidate)] });
    const report = exportBenchCases(options(r, [fixRun(r.candidate, GOAL_2), other, fixRun(r.candidate, GOAL)]));
    assert.deepEqual(report.written.map((w) => w.id), [...ids, ...['F2', 'F3', 'F4'].map((f) => caseId(f, GOAL_2))]);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R3 and R2: a malformed tag falls to the dimension, an upper-case axis tag still gives it, and the window is 5 up to a range of 5 and at most 50', () => {
  const r = repo();
  try {
    const run = makeCardRun(GOAL, CARD, {
      base: { ref: 'main' },
      findings: [
        finding('F1', '[spec] 3 scope (class: not a slug) @ src/calc.ts:2-4: x -> y', r.candidate),
        finding('F2', '[STANDARDS] 11 tests @ src/calc.ts:2-8: x -> y', r.candidate),
        finding('F3', '[standards] 6 needless @ src/calc.ts:2-100: x -> y', r.candidate),
        finding('F4', 'prose with no axis tag (class: _bad) @ src/calc.ts:2: x -> y', r.candidate),
      ],
    });
    exportBenchCases(options(r, [run]));
    const site = (id: string) => (JSON.parse(readFileSync(caseFile(r, caseId(id)), 'utf8')) as { expected: Array<{ line: number; window: number; class: string }> }).expected[0];
    assert.deepEqual(site('F1'), { file: 'src/calc.ts', line: 2, window: 5, class: 'dim-3' });
    assert.deepEqual(site('F2'), { file: 'src/calc.ts', line: 2, window: 6, class: 'dim-11' });
    assert.deepEqual(site('F3'), { file: 'src/calc.ts', line: 2, window: 50, class: 'dim-6' });
    assert.deepEqual(site('F4'), { file: 'src/calc.ts', line: 2, window: 5, class: 'unclassified' });
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R3: the class is read from the reason text and never from ReviewFinding.class', () => {
  const r = repo();
  try {
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate, { class: 'from-the-field' })] });
    exportBenchCases(options(r, [run]));
    assert.match(readFileSync(caseFile(r, caseId('F1')), 'utf8'), /"class": "dim-9"/);
  } finally {
    r.cleanup();
  }
});

/** A fork point A, main advanced to M, and a second candidate C2 on a branch that merged M. */
function advanced(r: Repo): { a: string; m: string; c2: string } {
  git(r.root, ['checkout', '-q', 'main']);
  writeFileSync(path.join(r.root, 'other.txt'), 'm\n');
  const m = commitAll(r.root, 'main moves');
  git(r.root, ['checkout', '-q', CARD]);
  git(r.root, ['merge', '-q', '--no-edit', 'main']);
  writeFileSync(path.join(r.root, 'src', 'calc.ts'), readFileSync(path.join(r.root, 'src', 'calc.ts'), 'utf8') + 'export const v47 = 47;\n');
  const c2 = commitAll(r.root, 'second candidate');
  git(r.root, ['checkout', '-q', 'main']);
  return { a: r.base, m, c2 };
}

test('T1-REVIEW-BENCH-EXPORT acceptance 2: the base is the merge base with base.oid, else base.ref [R4]', () => {
  const r = repo();
  try {
    const { a, m, c2 } = advanced(r);
    const baseOf = (dir: string, base: CardRun['base']) => {
      const run = makeCardRun(GOAL, CARD, { base, findings: [finding('F1', F2, c2)] });
      const report = exportBenchCases(options(r, [run], { dir }));
      return report.written[0]?.base;
    };
    mkdirSync(path.join(r.root, 'one'));
    mkdirSync(path.join(r.root, 'two'));
    assert.equal(baseOf('one', { ref: 'main', oid: a }), a);
    git(r.root, ['update-ref', '-d', `refs/aidlc/bench/${caseId('F1')}`]);
    assert.equal(baseOf('two', { ref: 'main' }), m);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R4 and R2: a run with no base uses the configured base, and the card path uses the configured cardsDir', () => {
  const r = repo();
  try {
    const { a, c2 } = advanced(r);
    git(r.root, ['branch', 'trunk', a]);
    writeFileSync(path.join(r.root, 'aidlc.config.json'), JSON.stringify({ base: 'trunk' }));
    const run = makeCardRun(GOAL, CARD, { findings: [finding('F1', F2, c2)] });
    assert.equal(exportBenchCases(options(r, [run])).written[0]?.base, a);
    writeFileSync(path.join(r.root, 'aidlc.config.json'), JSON.stringify({ cardsDir: 'plans' }));
    const moved = makeCardRun(GOAL, CARD, { findings: [finding('F2', F2, c2)] });
    assert.match(exportBenchCases(options(r, [moved])).skipped[0]?.detail ?? '', /plans\/T1-BENCH-FIX\.md/);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 3: a finding that gives no reviewable case is skipped with its cause, with no file and no ref [R5]', () => {
  const r = repo();
  try {
    const run = makeCardRun(GOAL, CARD, {
      base: { ref: 'main' },
      findings: [
        finding('F1', F2, ABSENT),
        finding('F2', '[standards] 9 errors @ src/calc.ts: no line -> add one', r.candidate),
        finding('F3', F2, r.noCard),
        finding('F4', F2, r.base),
        finding('F5', F2, undefined),
        finding('F6', '[standards] 9 errors @ src/calc.ts:0: line zero -> add one', r.candidate),
      ],
    });
    const report = exportBenchCases(options(r, [run]));
    const causes = new Map(report.skipped.map((s) => [s.source, s.detail]));
    assert.deepEqual(report.skipped.map((s) => [s.card, s.goal, s.source]), ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'].map((f) => [CARD, GOAL, f]));
    assert.match(causes.get('F1')!, /not in the object store/);
    assert.match(causes.get('F2')!, /no :n line/);
    assert.match(causes.get('F3')!, /no card file specs\/tasks\/T1-BENCH-FIX\.md/);
    assert.match(causes.get('F4')!, /ancestor/);
    assert.match(causes.get('F5')!, /no candidateSha/);
    assert.match(causes.get('F6')!, /expected\.0\.line/);
    assert.deepEqual(readdirSync(r.caseDir), []);
    assert.deepEqual(benchRefs(r), []);
    assert.deepEqual(report.written, []);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R5: a merge base that fails skips the finding', () => {
  const r = repo();
  try {
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'no-such-ref' }, findings: [finding('F1', F2, r.candidate)] });
    assert.match(exportBenchCases(options(r, [run])).skipped[0]?.detail ?? '', /merge-base no-such-ref/);
    assert.deepEqual(readdirSync(r.caseDir), []);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 4: an existing case keeps its bytes, gets no ref and the rest still export [R6]', () => {
  const r = repo();
  try {
    writeFileSync(caseFile(r, ids[0]!), 'other text');
    const report = exportBenchCases(options(r, [fixRun(r.candidate)]));
    assert.equal(readFileSync(caseFile(r, ids[0]!), 'utf8'), 'other text');
    assert.deepEqual(report.existing, [ids[0]]);
    assert.deepEqual(benchRefs(r), [ids[1], ids[2]].map((id) => `refs/aidlc/bench/${id}`));
    assert.deepEqual(report.written.map((w) => w.id), [ids[1], ids[2]]);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R6: an existing case is listed as existing whatever its ref names and even when its finding could give no case', () => {
  const r = repo();
  try {
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate), finding('F2', '[standards] 9 errors @ src/calc.ts: no line -> add one', r.candidate)] });
    for (const id of ['F1', 'F2']) writeFileSync(caseFile(r, caseId(id)), 'mine');
    git(r.root, ['update-ref', `refs/aidlc/bench/${caseId('F1')}`, r.base]);
    const report = exportBenchCases(options(r, [run]));
    assert.deepEqual(report, { written: [], existing: [caseId('F1'), caseId('F2')], skipped: [], pinConflicts: [] });
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R6: a file that appears after the first check keeps its bytes and gets no ref', () => {
  const r = repo();
  try {
    const racing: SyncRunner = (command, args, opts) => {
      const receipt = runSync(command, args, opts);
      if (args[0] === 'rev-parse') writeFileSync(caseFile(r, caseId('F1')), 'theirs');
      return receipt;
    };
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    const report = exportBenchCases(options(r, [run], { git: racing }));
    assert.equal(readFileSync(caseFile(r, caseId('F1')), 'utf8'), 'theirs');
    assert.deepEqual(report.existing, [caseId('F1')]);
    assert.deepEqual(report.written, []);
    assert.deepEqual(benchRefs(r), []);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 5: a written case pins its candidate, a re-export accepts that pin, and a ref naming another commit is a pin conflict [R7]', () => {
  const r = repo();
  try {
    exportBenchCases(options(r, [fixRun(r.candidate)]));
    for (const id of ids) assert.equal(git(r.root, ['rev-parse', `refs/aidlc/bench/${id}`]), r.candidate);
    for (const id of ids) rmSync(caseFile(r, id));
    const again = exportBenchCases(options(r, [fixRun(r.candidate)]));
    assert.deepEqual(again.written.map((w) => w.id), ids);
    assert.deepEqual(again.pinConflicts, []);
    for (const id of ids) rmSync(caseFile(r, id));
    git(r.root, ['update-ref', `refs/aidlc/bench/${ids[0]}`, r.base]);
    const report = exportBenchCases(options(r, [fixRun(r.candidate)]));
    assert.deepEqual(report.pinConflicts.map((c) => [c.id, c.ref, c.candidate]), [[ids[0], `refs/aidlc/bench/${ids[0]}`, r.candidate]]);
    assert.match(report.pinConflicts[0]!.detail, new RegExp(`names ${r.base}`));
    assert.equal(existsSync(caseFile(r, ids[0]!)), false);
    assert.equal(git(r.root, ['rev-parse', `refs/aidlc/bench/${ids[0]}`]), r.base);
    assert.deepEqual(report.written.map((w) => w.id), [ids[1], ids[2]]);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R7: the absent ref is created with the zero old value, so a ref that appears meanwhile stays', () => {
  const r = repo();
  try {
    const calls: string[][] = [];
    const racing: SyncRunner = (command, args, opts) => {
      if (args[0] === 'update-ref') {
        calls.push(args);
        git(r.root, ['update-ref', `refs/aidlc/bench/${caseId('F1')}`, r.base]);
      }
      return runSync(command, args, opts);
    };
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    const report = exportBenchCases(options(r, [run], { git: racing }));
    assert.deepEqual(calls, [['update-ref', '--no-deref', `refs/aidlc/bench/${caseId('F1')}`, r.candidate, '0'.repeat(40)]]);
    assert.equal(git(r.root, ['rev-parse', `refs/aidlc/bench/${caseId('F1')}`]), r.base);
    assert.equal(report.pinConflicts.length, 1);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R7: a failed update-ref removes the file it just wrote, is listed with the git error, and a later export writes the case', () => {
  const r = repo();
  try {
    const failing: SyncRunner = (command, args, opts) => (args[0] === 'update-ref' ? { ...runSync(command, ['--version'], opts), exitCode: 1, stderr: 'fatal: no\nlock held\n' } : runSync(command, args, opts));
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    const report = exportBenchCases(options(r, [run], { git: failing }));
    assert.deepEqual(report.written, []);
    assert.equal(report.pinConflicts.length, 1);
    assert.match(report.pinConflicts[0]!.detail, /update-ref failed: fatal: no lock held/);
    assert.equal(existsSync(caseFile(r, caseId('F1'))), false);
    assert.equal(exportBenchCases(options(r, [run])).written.length, 1);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R7: an update-ref runner that throws counts as a failed ref write, and a file it cannot remove is named', () => {
  const r = repo();
  try {
    const throwing: SyncRunner = (command, args, opts) => {
      if (args[0] !== 'update-ref') return runSync(command, args, opts);
      rmSync(caseFile(r, caseId('F1')));
      mkdirSync(caseFile(r, caseId('F1')));
      throw new Error('spawn died');
    };
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    const report = exportBenchCases(options(r, [run], { git: throwing }));
    assert.equal(report.pinConflicts.length, 1);
    assert.match(report.pinConflicts[0]!.detail, /update-ref failed: git did not run/);
    assert.ok(report.pinConflicts[0]!.detail.includes(`${caseFile(r, caseId('F1'))} stays unpinned`), report.pinConflicts[0]!.detail);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R7: a symbolic-ref that errors is not an absent ref: no file and no pin', () => {
  const r = repo();
  try {
    const broken: SyncRunner = (command, args, opts) => (args[0] === 'symbolic-ref' ? { ...runSync(command, ['--version'], opts), exitCode: 128, stdout: '', stderr: 'fatal: bad\n' } : runSync(command, args, opts));
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    const report = exportBenchCases(options(r, [run], { git: broken }));
    assert.match(report.pinConflicts[0]?.detail ?? '', /symbolic-ref failed: fatal: bad/);
    assert.deepEqual(readdirSync(r.caseDir), []);
    assert.deepEqual(benchRefs(r), []);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R7: a rev-parse that errors is not an absent ref: no file and no pin', () => {
  const r = repo();
  try {
    const broken: SyncRunner = (command, args, opts) => (args[0] === 'rev-parse' ? { ...runSync(command, ['--version'], opts), exitCode: 128, stdout: '', stderr: 'fatal: bad\n' } : runSync(command, args, opts));
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    const report = exportBenchCases(options(r, [run], { git: broken }));
    assert.match(report.pinConflicts[0]?.detail ?? '', /rev-parse failed: fatal: bad/);
    assert.deepEqual(readdirSync(r.caseDir), []);
    assert.deepEqual(benchRefs(r), []);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 6: every git call is cat-file, merge-base, rev-parse, symbolic-ref -q or update-ref --no-deref under refs/aidlc/bench/ with lazy fetch off, and no other ref appears [R8]', () => {
  const r = repo();
  try {
    const before = git(r.root, ['for-each-ref', '--format=%(refname)']).split('\n');
    const calls: Array<{ command: string; args: string[]; cwd?: string; noLazyFetch?: string }> = [];
    const recorder: SyncRunner = (command, args, opts) => {
      calls.push({ command, args, cwd: opts?.cwd, noLazyFetch: opts?.env?.['GIT_NO_LAZY_FETCH'] });
      return runSync(command, args, opts);
    };
    exportBenchCases(options(r, [fixRun(r.candidate)], { git: recorder }));
    assert.ok(calls.length >= 12, `${calls.length} calls`);
    for (const c of calls) {
      assert.equal(c.command, 'git');
      assert.equal(c.cwd, r.root);
      assert.equal(c.noLazyFetch, '1', c.args.join(' '));
      assert.ok(['cat-file', 'merge-base', 'rev-parse', 'symbolic-ref', 'update-ref'].includes(c.args[0]!), c.args.join(' '));
      if (c.args[0] === 'symbolic-ref') assert.deepEqual(c.args.slice(0, -1), ['symbolic-ref', '-q']);
      if (c.args[0] === 'update-ref') {
        assert.equal(c.args[1], '--no-deref');
        assert.ok(c.args[2]!.startsWith('refs/aidlc/bench/'), c.args.join(' '));
      }
    }
    const after = git(r.root, ['for-each-ref', '--format=%(refname)']).split('\n');
    assert.deepEqual(after.sort(), [...before, ...ids.map((id) => `refs/aidlc/bench/${id}`)].sort());
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 12: a symbolic pin, dangling or resolved, is a pin conflict with no file and no write through it [R7]', () => {
  const r = repo();
  try {
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate), finding('F2', F3, r.candidate)] });
    const dangling = `refs/aidlc/bench/${caseId('F1')}`;
    const resolved = `refs/aidlc/bench/${caseId('F2')}`;
    git(r.root, ['symbolic-ref', dangling, 'refs/heads/nope']);
    git(r.root, ['branch', 'at-candidate', r.candidate]);
    git(r.root, ['symbolic-ref', resolved, 'refs/heads/at-candidate']);
    const report = exportBenchCases(options(r, [run]));
    assert.deepEqual(report.pinConflicts.map((c) => c.id), [caseId('F1'), caseId('F2')]);
    assert.match(report.pinConflicts[0]!.detail, /is a symbolic ref to refs\/heads\/nope/);
    assert.deepEqual(report.written, []);
    assert.deepEqual(readdirSync(r.caseDir), []);
    assert.equal(git(r.root, ['symbolic-ref', dangling]), 'refs/heads/nope');
    assert.equal(git(r.root, ['symbolic-ref', resolved]), 'refs/heads/at-candidate');
    assert.equal(git(r.root, ['for-each-ref', 'refs/heads/nope']), '');
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 12: a symbolic ref that appears after the checks fails the no-deref create, which removes the file and writes no branch [R7]', () => {
  const r = repo();
  try {
    const ref = `refs/aidlc/bench/${caseId('F1')}`;
    const late: SyncRunner = (command, args, opts) => {
      if (args[0] === 'update-ref') git(r.root, ['symbolic-ref', ref, 'refs/heads/nope']);
      return runSync(command, args, opts);
    };
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    const report = exportBenchCases(options(r, [run], { git: late }));
    assert.equal(report.pinConflicts.length, 1);
    assert.deepEqual(readdirSync(r.caseDir), []);
    assert.equal(git(r.root, ['symbolic-ref', ref]), 'refs/heads/nope');
    assert.equal(git(r.root, ['for-each-ref', 'refs/heads/nope']), '');
  } finally {
    r.cleanup();
  }
});

const gitVersion = /(\d+)\.(\d+)/.exec(git(tmpdir(), ['--version']))!;
const hasNoLazyFetch = Number(gitVersion[1]) > 2 || Number(gitVersion[2]) >= 45;

test('T1-REVIEW-BENCH-EXPORT acceptance 13: in a partial clone a blob the clone lacks is skipped and never fetched [R8]', { skip: hasNoLazyFetch ? false : 'git before 2.45 ignores GIT_NO_LAZY_FETCH' }, () => {
  const r = repo();
  try {
    git(r.root, ['config', 'uploadpack.allowFilter', 'true']);
    const clone = path.join(r.dir, 'partial');
    git(r.dir, ['clone', '-q', '--filter=blob:none', '--no-checkout', pathToFileURL(r.root).href, clone]);
    mkdirSync(path.join(clone, 'evals', 'review'), { recursive: true });
    const blob = git(r.root, ['rev-parse', `${r.candidate}:specs/tasks/${CARD}.md`]);
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'origin/main' }, findings: [finding('F1', F2, r.candidate)] });
    const report = exportBenchCases({ root: clone, runs: [run], cardId: CARD });
    assert.match(report.skipped[0]?.detail ?? '', /no card file/);
    const stillMissing = spawnSync('git', ['cat-file', '-e', blob], { cwd: clone, encoding: 'utf8', env: { ...gitEnv, GIT_NO_LAZY_FETCH: '1' }, windowsHide: true });
    assert.notEqual(stillMissing.status, 0, 'the export fetched the blob');
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 14: a link retargeted during the export changes nothing, and a resolved directory replaced by a link ends the export [R10]', () => {
  const r = repo();
  try {
    const state = path.join(r.dir, 'state');
    const cases = path.join(r.dir, 'cases');
    const link = path.join(r.root, 'link');
    mkdirSync(state);
    mkdirSync(cases);
    symlinkSync(cases, link, 'junction');
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    let moved = false;
    const retarget: SyncRunner = (command, args, opts) => {
      if (!moved) {
        moved = true;
        rmSync(link);
        symlinkSync(state, link, 'junction');
      }
      return runSync(command, args, opts);
    };
    const report = exportBenchCases(options(r, [run], { dir: 'link', stateDir: state, git: retarget }));
    assert.deepEqual(readdirSync(state), []);
    assert.deepEqual(report.written.map((w) => w.file), [path.join(cases, `${caseId('F1')}.json`)]);
    assert.ok(existsSync(path.join(cases, `${caseId('F1')}.json`)));
    git(r.root, ['update-ref', '-d', `refs/aidlc/bench/${caseId('F1')}`]);
    rmSync(path.join(cases, `${caseId('F1')}.json`));
    const replace: SyncRunner = (command, args, opts) => {
      if (args[0] === 'rev-parse' && args[1] === '--verify') {
        rmSync(cases, { recursive: true });
        symlinkSync(state, cases, 'junction');
      }
      return runSync(command, args, opts);
    };
    assert.throws(() => exportBenchCases(options(r, [run], { dir: cases, stateDir: state, git: replace })), /no longer resolves/);
    assert.deepEqual(readdirSync(state), []);
    assert.deepEqual(benchRefs(r), []);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 15: a state directory that overlaps the refs directory is refused before any draft, and one beside it exports [R10]', () => {
  const r = repo();
  try {
    const cases = path.join(r.dir, 'cases');
    const gitDir = path.join(r.root, '.git');
    mkdirSync(cases);
    mkdirSync(path.join(gitDir, 'refs', 'aidlc'));
    mkdirSync(path.join(gitDir, 'aidlc'));
    for (const stateDir of [gitDir, path.join(gitDir, 'refs', 'aidlc')]) assert.throws(() => exportBenchCases(options(r, [fixRun(r.candidate)], { dir: cases, stateDir })), /refs directory/, stateDir);
    assert.deepEqual(readdirSync(cases), []);
    assert.deepEqual(benchRefs(r), []);
    const broken: SyncRunner = (command, args, opts) => (args[1] === '--git-common-dir' ? { ...runSync(command, ['--version'], opts), exitCode: 128, stderr: 'fatal: no\n' } : runSync(command, args, opts));
    assert.throws(() => exportBenchCases(options(r, [fixRun(r.candidate)], { dir: cases, stateDir: path.join(gitDir, 'aidlc'), git: broken })), /--git-common-dir failed: fatal: no/);
    assert.equal(exportBenchCases(options(r, [fixRun(r.candidate)], { dir: cases, stateDir: path.join(gitDir, 'aidlc') })).written.length, 3);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 16: a write that fails partway leaves no file and no ref, the error surfaces, and the next export writes the case [R6]', () => {
  const r = repo();
  const real = fs.writeFileSync;
  const partial = mock.method(fs, 'writeFileSync', (target: fs.PathOrFileDescriptor, data: string, opts?: fs.WriteFileOptions) => {
    if (typeof target === 'number') fs.writeSync(target, data.slice(0, 10));
    else if (String(target).startsWith(r.caseDir)) real(target, data.slice(0, 10), opts);
    else return real(target, data, opts);
    throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' });
  });
  syncBuiltinESMExports();
  try {
    const run = makeCardRun(GOAL, CARD, { base: { ref: 'main' }, findings: [finding('F1', F2, r.candidate)] });
    assert.throws(() => exportBenchCases(options(r, [run])), /ENOSPC/);
    partial.mock.restore();
    syncBuiltinESMExports();
    assert.deepEqual(readdirSync(r.caseDir), []);
    assert.deepEqual(benchRefs(r), []);
    assert.equal(exportBenchCases(options(r, [run])).written.length, 1);
    assert.ok(JSON.parse(readFileSync(caseFile(r, caseId('F1')), 'utf8')));
  } finally {
    partial.mock.restore();
    syncBuiltinESMExports();
    r.cleanup();
  }
});

let invocations = 0;
const invocation = (outcome: string, over: Record<string, unknown> = {}) => ({ invocationId: `i-${++invocations}`, candidateDigest: 'd', base: 'main', policyVersion: 'v1', reviewer: 'bench-r3', requestedAt: AT, outcome, ...over });
const ledger = (...entries: Array<ReturnType<typeof invocation>>) => ReviewLedger.parse({ invocations: entries });

test('T1-REVIEW-BENCH-EXPORT acceptance 7: --clean drafts one clean case per run whose first decided R3 invocation passed with a candidateSha, and no bug case [R9]', () => {
  const r = repo();
  try {
    const runs = [
      makeCardRun(GOAL, CARD_A, { base: { ref: 'main' }, review: ledger(invocation('pending'), invocation('no-verdict'), invocation('pass', { candidateSha: r.candidate })), findings: [finding('F1', F2, r.candidate)] }),
      makeCardRun(GOAL, 'T1-BENCH-B', { base: { ref: 'main' }, review: ledger(invocation('block', { candidateSha: r.candidate }), invocation('pass', { candidateSha: r.candidate })) }),
      makeCardRun(GOAL, 'T1-BENCH-C', { base: { ref: 'main' }, review: ledger(invocation('pass')) }),
      makeCardRun(GOAL, 'T1-BENCH-D', { base: { ref: 'main' }, review: ledger(invocation('pending')) }),
      makeCardRun(GOAL, 'T1-BENCH-E', { base: { ref: 'main' }, review: ledger(invocation('pass', { candidateSha: ABSENT })) }),
    ];
    const report = exportBenchCases({ root: r.root, runs, clean: true });
    const base = git(r.root, ['merge-base', 'main', r.candidate]);
    assert.deepEqual(readdirSync(r.caseDir), [`${caseId('clean', GOAL, CARD_A)}.json`]);
    const text = readFileSync(caseFile(r, caseId('clean', GOAL, CARD_A)), 'utf8');
    assert.deepEqual(JSON.parse(text), { kind: 'clean', id: caseId('clean', GOAL, CARD_A), candidate: r.candidate, base, card: { id: CARD_A, path: `specs/tasks/${CARD_A}.md` }, confirmed: false, origin: `${CARD_A} clean (goal ${GOAL})`, note: 'R3 decision 1 passed (bench-r3)' });
    assert.equal(text, JSON.stringify(ReviewBenchCase.parse(JSON.parse(text)), null, 2) + '\n');
    assert.deepEqual(report.written.map((w) => [w.id, w.kind]), [[caseId('clean', GOAL, CARD_A), 'clean']]);
    assert.deepEqual(report.skipped.map((s) => [s.card, s.source]), [['T1-BENCH-C', 'clean'], ['T1-BENCH-E', 'clean']]);
    assert.match(report.skipped[0]!.detail, /no candidateSha/);
    assert.equal(git(r.root, ['rev-parse', `refs/aidlc/bench/${caseId('clean', GOAL, CARD_A)}`]), r.candidate);
    rmSync(caseFile(r, caseId('clean', GOAL, CARD_A)));
    const one = exportBenchCases({ root: r.root, runs, clean: true, cardId: CARD_A });
    assert.deepEqual(one.written.map((w) => w.id), [caseId('clean', GOAL, CARD_A)]);
    assert.deepEqual(one.skipped, []);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R10: bug drafts need a card, and a missing case directory refuses', () => {
  const r = repo();
  try {
    assert.throws(() => exportBenchCases({ root: r.root, runs: [] }), /--card/);
    assert.throws(() => exportBenchCases(options(r, [fixRun(r.candidate)], { dir: 'nowhere' })), /no case directory/);
    writeFileSync(path.join(r.root, 'a-file'), '');
    assert.throws(() => exportBenchCases(options(r, [fixRun(r.candidate)], { dir: 'a-file' })), /no case directory/);
    assert.deepEqual(benchRefs(r), []);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 11: a case directory at or under the state directory is refused, through a link too, with no file and no ref [R8] [R10]', () => {
  const r = repo();
  try {
    const state = path.join(r.dir, 'state');
    const cards = path.join(state, 'cards');
    mkdirSync(cards, { recursive: true });
    symlinkSync(cards, path.join(r.root, 'link'), 'junction');
    for (const dir of [state, cards, 'link']) assert.throws(() => exportBenchCases(options(r, [fixRun(r.candidate)], { dir, stateDir: state })), /under the state directory/, dir);
    assert.deepEqual(readdirSync(cards), []);
    assert.deepEqual(benchRefs(r), []);
    const beside = path.join(r.dir, 'state-2');
    mkdirSync(beside);
    assert.equal(exportBenchCases(options(r, [fixRun(r.candidate)], { dir: beside, stateDir: state })).written.length, 3);
    assert.equal(exportBenchCases(options(r, [fixRun(r.candidate)], { stateDir: path.join(r.dir, 'no-state') })).written.length, 3);
    assert.equal(exportBenchCases(options(r, [fixRun(r.candidate)], { dir: r.dir, stateDir: state })).written.length, 3);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R10: the line form gives one line per entry', () => {
  const r = repo();
  try {
    writeFileSync(caseFile(r, ids[0]!), 'other text');
    git(r.root, ['update-ref', `refs/aidlc/bench/${ids[1]}`, r.base]);
    const run = fixRun(r.candidate);
    run.findings.push(finding('F5', F2, ABSENT));
    const report = exportBenchCases(options(r, [run]));
    assert.deepEqual(formatBenchExport(report).split('\n'), [`written ${ids[2]} bug ${r.candidate} ${caseFile(r, ids[2]!)}`, `existing ${ids[0]}`, `skipped ${CARD} ${GOAL} F5: ${report.skipped[0]!.detail}`, `pin conflict ${ids[1]}: ${report.pinConflicts[0]!.detail}`]);
    assert.equal(formatBenchExport({ written: [], existing: [], skipped: [], pinConflicts: [] }), 'nothing to export');
  } finally {
    r.cleanup();
  }
});

function filesUnder(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile()) continue;
    const file = path.join(e.parentPath, e.name);
    out.set(path.relative(dir, file), createHash('sha256').update(readFileSync(file)).digest('hex'));
  }
  return out;
}

test('T1-REVIEW-BENCH-EXPORT acceptance 8: the command prints the report, writes nothing under the state directory, and exits 1 on each refusal [R8] [R10]', () => {
  const r = repo();
  try {
    const state = path.join(r.dir, 'state');
    mkdirSync(path.join(state, 'goals'), { recursive: true });
    mkdirSync(path.join(state, 'cards', GOAL), { recursive: true });
    writeFileSync(path.join(state, 'goals', `${GOAL}.json`), JSON.stringify(makeGoal(GOAL)));
    writeFileSync(path.join(state, 'goals', `${GOAL_2}.json`), JSON.stringify(makeGoal(GOAL_2)));
    writeFileSync(path.join(state, 'cards', GOAL, `${CARD}.json`), JSON.stringify(fixRun(r.candidate)));
    const before = filesUnder(state);
    const { AIDLC_SESSION: _session, CLAUDE_CODE_SESSION_ID: _claude, ...env } = process.env;
    const cli = (...args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'export', ...args], { cwd: r.root, encoding: 'utf8', env: { ...env, AIDLC_STATE_DIR: state }, windowsHide: true });
    const first = cli('--card', CARD, '--json');
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual((JSON.parse(first.stdout) as { written: Array<{ id: string }> }).written.map((w) => w.id), ids);
    const second = cli('--card', CARD, '--json');
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual((JSON.parse(second.stdout) as { existing: string[] }).existing, ids);
    assert.deepEqual([...filesUnder(state)], [...before]);
    assert.equal(cli('--card', CARD, '--goal', GOAL_2).status, 1);
    assert.equal(cli('--card', 'T1-NO-RUN').status, 1);
    assert.equal(cli().status, 1);
    assert.equal(cli('--clean', '--goal', 'g-20261021000000-cccccc').status, 1);
    assert.equal(cli('--card', CARD, '--dir', 'nowhere').status, 1);
    assert.equal(cli('--card', CARD, '--dir', path.join(state, 'cards')).status, 1);
    assert.equal(cli('--clean', '--goal', GOAL_2).status, 0);
    for (const id of ids) rmSync(caseFile(r, id));
    git(r.root, ['update-ref', '-d', `refs/aidlc/bench/${ids[0]}`]);
    git(r.root, ['update-ref', `refs/aidlc/bench/${ids[0]}`, r.base]);
    const conflict = cli('--card', CARD, '--json');
    assert.equal(conflict.status, 1);
    assert.deepEqual((JSON.parse(conflict.stdout) as { pinConflicts: Array<{ id: string }> }).pinConflicts.map((c) => c.id), [ids[0]]);
    assert.deepEqual([...filesUnder(state)], [...before]);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT R10: in a linked worktree the case directory is the one under that checkout, and the state stays in the main one', () => {
  const r = repo();
  try {
    const state = path.join(r.dir, 'state');
    mkdirSync(path.join(state, 'goals'), { recursive: true });
    mkdirSync(path.join(state, 'cards', GOAL), { recursive: true });
    writeFileSync(path.join(state, 'goals', `${GOAL}.json`), JSON.stringify(makeGoal(GOAL)));
    writeFileSync(path.join(state, 'cards', GOAL, `${CARD}.json`), JSON.stringify(fixRun(r.candidate)));
    const linked = path.join(r.dir, 'linked');
    git(r.root, ['worktree', 'add', '-q', '--detach', linked, 'main']);
    mkdirSync(path.join(linked, 'evals', 'review'), { recursive: true });
    const done = spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'export', '--card', CARD, '--json'], { cwd: linked, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: state }, windowsHide: true });
    assert.equal(done.status, 0, done.stderr);
    assert.equal(readdirSync(path.join(linked, 'evals', 'review')).length, 3);
    assert.deepEqual(readdirSync(r.caseDir), []);
    assert.equal(benchRefs(r).length, 3);
  } finally {
    r.cleanup();
  }
});

test('T1-REVIEW-BENCH-EXPORT acceptance 10: the docs describe the export and keep the hand-written route [R11]', () => {
  const ops = read('docs/OPERATIONS.md');
  const from = ops.indexOf('\n### Reviewer bench\n');
  const section = ops.slice(from, ops.indexOf('\n## ', from + 1));
  for (const needle of ['aidlc review bench export --card', '--clean', 'refs/aidlc/bench/', 'git update-ref -d']) assert.ok(section.includes(needle), needle);
  const cases = read('evals/review/README.md');
  for (const needle of ['aidlc review bench export', 'git update-ref refs/aidlc/bench/']) assert.ok(cases.includes(needle), needle);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  assert.ok(changelog.slice(start, changelog.indexOf('\n## ', start + 1)).includes('- T1-REVIEW-BENCH-EXPORT:'));
});
