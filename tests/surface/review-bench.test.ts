import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ReviewBenchCase } from '../../src/core/types.ts';
import { formatBenchReport, loadBenchCases, runReviewBench, type ReviewBenchOptions } from '../../src/review/bench.ts';
import { loadEvals } from '../../src/evals/runner.ts';
import { renderCard } from '../../src/artifacts/card.ts';
import { runSync, scriptedRunner, type ExecReceipt, type Runner } from '../../src/probes/exec.ts';
import { tmpDir } from '../infra/helpers.ts';
import { changelogSince010 } from '../infra/changelog.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string) => readFileSync(path.join(repoRoot, rel), 'utf8');
const SHA = (c: string) => c.repeat(40);
const FIXED = '2026-10-23T10:00:00Z';
const CARD_ID = 'T1-BENCH-FIX';
const CARD_PATH = `specs/tasks/${CARD_ID}.md`;
const LESSON = '- 2026-10-01 T0-BENCH-LESSON: NEVER return a value off by one from calc (source: bench fixture)';

function git(cwd: string, args: string[]): string {
  const r = runSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: FIXED, GIT_COMMITTER_DATE: FIXED } });
  assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const calc = (change: Record<number, string> = {}) => Array.from({ length: 30 }, (_, i) => change[i + 1] ?? `export const v${i + 1} = ${i + 1};`).join('\n') + '\n';
const cardText = renderCard({ id: CARD_ID, title: 'fix calc', allowPaths: ['src/calc.ts', CARD_PATH], dodCommand: 'npm test', acceptance: ['1. calc returns the right values'], deliverable: 'calc' });

interface Fixture {
  dir: string;
  root: string;
  tmpRoot: string;
  base: string;
  heads: { c1: string; c2: string; c3: string; c4: string };
  cleanup: () => void;
}

/** One base commit and four candidates, each changing one line of src/calc.ts and adding the card file. */
function fixture(): Fixture {
  const dir = realpathSync.native(tmpDir('aidlc-rbench-'));
  const root = path.join(dir, 'repo');
  const tmpRoot = path.join(dir, 'tmp');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(path.join(root, 'docs'));
  mkdirSync(tmpRoot);
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(path.join(root, 'src', 'calc.ts'), calc());
  writeFileSync(path.join(root, 'REVIEW.md'), '# Review policy\n\nBlock on wrong values.\n');
  writeFileSync(path.join(root, 'docs', 'LESSONS.md'), `# Lessons\n\n${LESSON}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  const candidate = (line: number, text: string): string => {
    git(root, ['checkout', '-q', '--detach', base]);
    writeFileSync(path.join(root, 'src', 'calc.ts'), calc({ [line]: text }));
    mkdirSync(path.join(root, 'specs', 'tasks'), { recursive: true });
    writeFileSync(path.join(root, CARD_PATH), cardText);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', `change line ${line}`]);
    return git(root, ['rev-parse', 'HEAD']);
  };
  const heads = { c1: candidate(13, 'export const v13 = 14;'), c2: candidate(5, 'export const v5 = 5 as const;'), c3: candidate(20, 'export const v20 = 20 as const;'), c4: candidate(8, 'export const v8 = 9;') };
  git(root, ['checkout', '-q', 'main']);
  return { dir, root, tmpRoot, base, heads, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const verdict = (v: 'pass' | 'block', reasons: string[] = []) => JSON.stringify({ verdict: v, reasons, axes: { spec: { verdict: v, reasons: [] }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';
const HIT_REASON = '[spec] 2 wrong value @ src/calc.ts:13: v13 is 14 -> restore 13';
const RANGE_REASON = '[spec] 2 values drift @ src/calc.ts:2-4: the first values are unchecked -> add a check';

function replies(fx: Fixture): Record<string, Partial<ExecReceipt>> {
  return {
    [fx.heads.c1]: { stdout: verdict('block', [HIT_REASON, RANGE_REASON]) },
    [fx.heads.c2]: { stdout: verdict('pass') },
    [fx.heads.c3]: { stdout: verdict('block', ['[standards] 6 needless cast @ src/calc.ts:20: the cast adds nothing -> remove it']) },
    [fx.heads.c4]: { exitCode: 1, stdout: 'I could not finish the review.\n' },
  };
}

interface Call {
  args: string[];
  cwd: string;
  input: string;
  checkoutHead: string;
}

/** The scripted reviewer, keyed on the {head} argument; each call records the HEAD of the checkout it ran in. */
function reviewer(fx: Fixture, calls: Call[]): Runner {
  const table = replies(fx);
  return async (command, args, options = {}) => {
    calls.push({ args, cwd: options.cwd ?? '', input: options.input ?? '', checkoutHead: git(options.cwd ?? '', ['rev-parse', 'HEAD']) });
    const head = args.find((a) => /^[0-9a-f]{40}$/.test(a)) ?? '';
    return scriptedRunner({ [command]: table[head] ?? { exitCode: 2 } })(command, args, options);
  };
}

const formalConfig = (extra: Record<string, unknown> = {}) => ({ formalReview: { command: ['reviewer', '{head}', '--schema', '{schema}', '--cwd', '{cwd}', '--effort', '{effort}'], reviewer: 'bench-r3', shell: false, effort: { default: 'high' }, ...extra } });
const writeConfig = (fx: Fixture, config: unknown) => writeFileSync(path.join(fx.root, 'aidlc.config.json'), JSON.stringify(config));

function writeCase(fx: Fixture, dirRel: string, c: Record<string, unknown>, name = `${String(c['id'])}.json`): void {
  mkdirSync(path.join(fx.root, dirRel), { recursive: true });
  writeFileSync(path.join(fx.root, dirRel, name), JSON.stringify(c));
}

const card = { id: CARD_ID, path: CARD_PATH };
const site = (line: number, window: number) => ({ file: 'src/calc.ts', line, window, class: 'dim-2' });
const bugCase = (fx: Fixture, id: string, candidate: string, line: number, window: number, extra: Record<string, unknown> = {}) => ({ kind: 'bug', id, candidate, base: fx.base, card, confirmed: true, confirmedBy: 't', origin: 'fixture', expected: [site(line, window)], ...extra });
const cleanCase = (fx: Fixture, id: string, candidate: string, extra: Record<string, unknown> = {}) => ({ kind: 'clean', id, candidate, base: fx.base, card, confirmed: true, confirmedBy: 't', origin: 'fixture', ...extra });

/** The six cases of acceptance item 3 under evals/review. */
function writeItem3Cases(fx: Fixture): void {
  writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 12, 2));
  writeCase(fx, 'evals/review', bugCase(fx, 'b-miss', fx.heads.c1, 25, 2));
  writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
  writeCase(fx, 'evals/review', cleanCase(fx, 'd-false-block', fx.heads.c3));
  writeCase(fx, 'evals/review', bugCase(fx, 'e-no-verdict', fx.heads.c4, 8, 1));
  writeCase(fx, 'evals/review', bugCase(fx, 'f-unconfirmed', fx.heads.c1, 13, 0, { confirmed: false, confirmedBy: undefined }));
}

const bench = (fx: Fixture, runner: Runner, extra: Partial<ReviewBenchOptions> = {}) => runReviewBench({ root: fx.root, stage: 'formal', runner, tmpRoot: fx.tmpRoot, ...extra });

/** No checkout and no worktree entry remains: git lists the fixture repository alone and the temp root is empty. */
function assertNoCheckoutLeft(fx: Fixture): void {
  const worktrees = git(fx.root, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree '));
  assert.deepEqual(worktrees.map((l) => path.resolve(l.slice('worktree '.length))), [path.resolve(fx.root)]);
  assert.deepEqual(readdirSync(fx.tmpRoot), []);
}

test('T1-REVIEW-BENCH acceptance 1: ReviewBenchCase accepts a bug case with two sites and a clean case, and refuses each malformed case [R1]', () => {
  const bug = { kind: 'bug', id: 'x.1', candidate: SHA('a'), base: SHA('b'), card, confirmed: true, confirmedBy: 'reviewer', origin: 'T1-X R3 decision 1 F1', note: 'n', expected: [site(12, 2), { file: 'src/b.ts', line: 1, window: 50, class: 'dim-9' }] };
  const clean = { kind: 'clean', id: 'y', candidate: SHA('c'), base: SHA('d'), card, confirmed: false, origin: 'hand' };
  assert.deepEqual(ReviewBenchCase.parse(bug), bug);
  assert.deepEqual(ReviewBenchCase.parse(clean), clean);
  const refused: Array<[string, unknown]> = [
    ['confirmed without confirmedBy', { ...clean, confirmed: true }],
    ['an unknown key', { ...clean, extra: 1 }],
    ['a 7-character candidate', { ...clean, candidate: 'abcdef0' }],
    ['a window of 51', { ...bug, expected: [site(12, 51)] }],
    ['a class of Dim 9', { ...bug, expected: [{ ...site(12, 2), class: 'Dim 9' }] }],
    ['a clean case with expected', { ...clean, expected: [site(12, 2)] }],
  ];
  for (const [name, value] of refused) assert.equal(ReviewBenchCase.safeParse(value).success, false, name);
});

test('T1-REVIEW-BENCH acceptance 2: loadBenchCases reads the JSON files of the directory in name order and names a file it refuses [R2]', () => {
  const dir = tmpDir('aidlc-rbench-load-');
  try {
    const one = (id: string) => ({ kind: 'clean', id, candidate: SHA('a'), base: SHA('b'), card, confirmed: false, origin: 'hand' });
    writeFileSync(path.join(dir, 'b.json'), JSON.stringify(one('b')));
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify(one('a')));
    writeFileSync(path.join(dir, 'README.md'), '# cases\n');
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'c.json'), JSON.stringify(one('c')));
    assert.deepEqual(loadBenchCases(dir).map((c) => c.id), ['a', 'b']);
    for (const [name, text] of [['notjson.json', '{'], ['schema.json', JSON.stringify({ ...one('schema'), kind: 'other' })], ['a.json', JSON.stringify(one('b'))]] as const) {
      const bad = tmpDir('bad-', dir);
      writeFileSync(path.join(bad, name), text);
      assert.throws(() => loadBenchCases(bad), (err: Error) => err.message.includes(name), name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T1-REVIEW-BENCH acceptance 3: the formal bench scores hit, miss, pass, false block and no verdict, one review per candidate [R3] [R6] [R7]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeItem3Cases(fx);
    const calls: Call[] = [];
    const report = await bench(fx, reviewer(fx, calls));
    const byId = new Map(report.cases.map((c) => [c.id, c]));
    assert.deepEqual(report.cases.map((c) => [c.id, c.outcome]), [['a-hit', 'hit'], ['b-miss', 'miss'], ['c-pass', 'pass'], ['d-false-block', 'false-block'], ['e-no-verdict', 'no-verdict']]);
    assert.deepEqual(byId.get('a-hit')!.matched, { reason: HIT_REASON, file: 'src/calc.ts', line: 12 });
    assert.deepEqual(byId.get('b-miss')!.cited, [HIT_REASON, RANGE_REASON]);
    assert.equal(byId.get('e-no-verdict')!.runStatus, 'tool_error');
    assert.deepEqual(report.totals, { bugCases: 3, hits: 1, misses: 1, recall: 0.5, cleanCases: 2, cleanPasses: 1, falseBlocks: 1, falseBlockRate: 0.5, noVerdict: 1, errors: 0, skippedUnconfirmed: 1 });
    assert.deepEqual(calls.map((c) => c.checkoutHead), [fx.heads.c1, fx.heads.c2, fx.heads.c3, fx.heads.c4], 'four calls, one per distinct candidate, each in a checkout of it');
    assert.equal(report.stage, 'formal');
    assert.equal(report.reviewer, 'bench-r3');
    assert.ok(byId.get('a-hit')!.verdictRef && existsSync(byId.get('a-hit')!.verdictRef!), 'the verdict is retained');
    assert.ok(byId.get('a-hit')!.logRef!.startsWith(path.join(fx.root, '.review', 'bench')), 'under .review/bench of the checkout root');

    const all: Call[] = [];
    const wide = await bench(fx, reviewer(fx, all), { includeUnconfirmed: true });
    assert.equal(wide.cases.find((c) => c.id === 'f-unconfirmed')?.outcome, 'hit');
    assert.equal(wide.totals.skippedUnconfirmed, 0);
    assert.equal(all.length, 4);

    const one = await bench(fx, reviewer(fx, []), { caseId: 'c-pass' });
    assert.deepEqual(one.cases.map((c) => [c.id, c.outcome]), [['c-pass', 'pass']]);
    await assert.rejects(bench(fx, reviewer(fx, []), { caseId: 'zz' }), /zz/);

    // The window edges: line 6 window 2 starts at 4, where the range 2-4 ends; line 11 window 2 ends at 13, the cited line.
    writeCase(fx, 'evals/edges', bugCase(fx, 'edge-low', fx.heads.c1, 6, 2));
    writeCase(fx, 'evals/edges', bugCase(fx, 'edge-high', fx.heads.c1, 11, 2));
    writeCase(fx, 'evals/edges', bugCase(fx, 'edge-out', fx.heads.c1, 7, 2));
    // Another changed file at the cited line is no hit: the file must match too.
    writeCase(fx, 'evals/edges', bugCase(fx, 'edge-other-file', fx.heads.c1, 13, 0, { expected: [{ ...site(13, 0), file: CARD_PATH }] }));
    const edges = await bench(fx, reviewer(fx, []), { dir: 'evals/edges' });
    assert.deepEqual(edges.cases.map((c) => [c.id, c.outcome, c.matched?.reason]), [['edge-high', 'hit', HIT_REASON], ['edge-low', 'hit', RANGE_REASON], ['edge-other-file', 'miss', undefined], ['edge-out', 'miss', undefined]]);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-BENCH acceptance 4: no checkout and no worktree entry remains after a scored run, a missing card file, a throwing runner and a diff above the cap [R4] [R6]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeItem3Cases(fx);
    const reports = [await bench(fx, reviewer(fx, []))];
    assertNoCheckoutLeft(fx);

    writeCase(fx, 'evals/missing', cleanCase(fx, 'g-missing-card', fx.heads.c2, { card: { id: 'T1-BENCH-GONE', path: 'specs/tasks/T1-BENCH-GONE.md' } }));
    const missing = await bench(fx, reviewer(fx, []), { dir: 'evals/missing' });
    assert.equal(missing.cases[0]!.outcome, 'error');
    assert.match(missing.cases[0]!.detail ?? '', /specs\/tasks\/T1-BENCH-GONE\.md/);
    reports.push(missing);
    assertNoCheckoutLeft(fx);

    const throwing: Runner = async () => {
      throw new Error('spawn failed');
    };
    const thrown = await bench(fx, throwing, { caseId: 'c-pass' });
    assert.equal(thrown.cases[0]!.outcome, 'no-verdict');
    reports.push(thrown);
    assertNoCheckoutLeft(fx);

    writeConfig(fx, formalConfig({ maxDiffBytes: 10 }));
    const calls: Call[] = [];
    const capped = await bench(fx, reviewer(fx, calls), { caseId: 'c-pass' });
    assert.equal(capped.cases[0]!.outcome, 'error');
    assert.match(capped.cases[0]!.detail ?? '', /formalReview\.maxDiffBytes \(10\)/);
    assert.equal(calls.length, 0, 'no reviewer call above the cap');
    reports.push(capped);
    assertNoCheckoutLeft(fx);

    // A failed git worktree remove falls back to deleting the directory and git worktree prune.
    writeConfig(fx, formalConfig());
    const refusing = (command: string, args: string[], options?: Parameters<typeof runSync>[2]) => (args[0] === 'worktree' && args[1] === 'remove' ? { ...runSync(command, ['--version'], options), exitCode: 1 } : runSync(command, args, options));
    const fallback = await bench(fx, reviewer(fx, []), { caseId: 'c-pass', git: refusing });
    assert.equal(fallback.cases[0]!.outcome, 'pass');
    reports.push(fallback);
    assertNoCheckoutLeft(fx);
    for (const r of reports) assert.deepEqual(r.leftCheckouts, []);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-BENCH acceptance 5: the bench sends the loop prompt of a first R3 decision and of a first R2 round [R5]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 12, 2));
    const calls: Call[] = [];
    const report = await bench(fx, reviewer(fx, calls));
    const hash = createHash('sha256').update(readFileSync(path.join(fx.root, 'REVIEW.md'), 'utf8'), 'utf8').digest('hex');
    assert.equal(report.policyHash, hash);
    assert.equal(calls.length, 1);
    const [call] = calls as [Call];
    const prompt = call.input;
    for (const text of ['decision 1 of 2', `card ${CARD_ID}`, `## Review policy (REVIEW.md, sha256 ${hash})`, '- none (first round of this cycle)', '+export const v13 = 14;']) assert.ok(prompt.includes(text), `the prompt carries ${text}`);
    assert.match(prompt, new RegExp(`## Learned invariants\\n[^\\n]*\\n- ${JSON.stringify(LESSON).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`));
    assert.match(prompt, /## Pre-review advisory notes\n[^\n]*\n- none\n/);
    const at = (flag: string) => call.args[call.args.indexOf(flag) + 1]!;
    assert.equal(at('--effort'), 'high');
    assert.equal(path.basename(at('--schema')), 'verdict.schema.json');
    assert.ok(existsSync(at('--schema')), 'the schema file exists');
    assert.equal(at('--cwd'), call.cwd);
    assert.equal(path.dirname(path.dirname(at('--cwd'))), fx.tmpRoot, 'the checkout lies in a fresh directory under the temp root');
    assert.ok(call.args.every((a) => !a.includes('{')), call.args.join(' '));

    writeConfig(fx, { preReview: { command: ['reviewer', '{perspective}', '{head}'], reviewer: 'bench-r2', perspectives: ['bugs', 'security'], rounds: 1, shell: false } });
    const pre: Call[] = [];
    const preReport = await bench(fx, reviewer(fx, pre), { stage: 'pre' });
    assert.equal(preReport.policyHash, hash);
    assert.deepEqual(pre.map((c) => c.args[0]).sort(), ['bugs', 'security']);
    for (const c of pre) {
      assert.ok(c.input.includes('round 1 of 1'), 'a first round of one');
      assert.ok(c.input.includes(`## This pass: ${c.args[0]}`), `the ${c.args[0]} angle`);
    }
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-BENCH acceptance 6: the CLI prints the report and writes no state, and a refused case file exits 1 naming it [R7] [R8] [R9]', () => {
  const fx = fixture();
  try {
    writeFileSync(path.join(fx.root, 'reviewer.mjs'), `process.stdout.write(${JSON.stringify(verdict('pass'))});\n`);
    writeConfig(fx, { formalReview: { command: [process.execPath, path.join(fx.root, 'reviewer.mjs'), '{head}'], reviewer: 'node-pass', shell: false } });
    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    const state = path.join(fx.dir, 'state-never');
    // No session variable, as on a CI runner: a CLI that resolves the default session writes it under the state directory.
    const { AIDLC_SESSION: _session, CLAUDE_CODE_SESSION_ID: _claude, ...env } = process.env;
    const cli = (args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'run', '--stage', 'formal', '--json', ...args], { cwd: fx.root, encoding: 'utf8', env: { ...env, AIDLC_STATE_DIR: state, TMPDIR: fx.tmpRoot, TEMP: fx.tmpRoot, TMP: fx.tmpRoot }, windowsHide: true });
    const ok = cli([]);
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(ok.stdout) as { totals: { cleanCases: number; falseBlocks: number }; leftCheckouts: string[] };
    assert.equal(report.totals.cleanCases, 1);
    assert.equal(report.totals.falseBlocks, 0);
    assert.deepEqual(existsSync(state) ? [state, ...filesUnder(state)] : [], [], 'nothing under the state directory');

    writeCase(fx, 'evals/bad', cleanCase(fx, 'y', fx.heads.c2), 'x.json');
    const refused = cli(['--dir', 'evals/bad']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /x\.json/);
    assert.equal(refused.stdout, '');
  } finally {
    fx.cleanup();
  }
});

const isSha = (a: string) => /^[0-9a-f]{40}$/.test(a);
/** A reviewer whose verdict carries the binding `bindingFor` gives the head: c1 blocks at the hit line, every other head passes. */
const boundReviewer = (fx: Fixture, bindingFor: (head: string) => Record<string, string>): Runner => async (command, args, options) => {
  const head = args.find(isSha) ?? '';
  const doc = { ...(JSON.parse(head === fx.heads.c1 ? verdict('block', [HIT_REASON]) : verdict('pass')) as object), ...bindingFor(head) };
  return scriptedRunner({ [command]: { stdout: `${JSON.stringify(doc)}\n` } })(command, args, options);
};

test('T1-REVIEW-BENCH R3 decision 1 F1: a verdict bound to another sha or branch is a no-verdict on the formal stage, as the loop R3 reads it, and scores by its verdict on the pre stage, single and panel, as the loop R2 records it [R5] [R6]', async () => {
  const fx = fixture();
  try {
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 12, 2));
    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    const pre = (perspectives: string[]) => ({ preReview: { command: ['reviewer', '{perspective}', '{head}'], reviewer: 'bench-r2', perspectives, shell: false } });
    const stages: Array<[string, 'pre' | 'formal', unknown]> = [['formal', 'formal', formalConfig()], ['pre single', 'pre', pre([])], ['pre panel', 'pre', pre(['bugs', 'security'])]];
    // [binding, formal outcomes, pre outcomes]: the loop's R2 records a round's outcome without reading its binding.
    const bindings: Array<[string, (head: string) => Record<string, string>, string[], string[]]> = [
      ['absent', () => ({}), ['hit', 'pass'], ['hit', 'pass']],
      ['own', (head) => ({ sha: head, branch: CARD_ID }), ['hit', 'pass'], ['hit', 'pass']],
      ['wrong sha', () => ({ sha: fx.base }), ['no-verdict', 'no-verdict'], ['hit', 'pass']],
      ['wrong branch', () => ({ branch: 'T1-OTHER' }), ['no-verdict', 'no-verdict'], ['hit', 'pass']],
    ];
    for (const [stageName, stage, config] of stages) {
      writeConfig(fx, config);
      for (const [name, bindingFor, formal, pre] of bindings) {
        const report = await bench(fx, boundReviewer(fx, bindingFor), { stage });
        assert.deepEqual(report.cases.map((c) => c.outcome), stage === 'formal' ? formal : pre, `${stageName}, ${name} binding`);
      }
    }
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-BENCH R3 decision 1 F2: a checkout git still lists, or one the listing cannot confirm gone, is reported in leftCheckouts even when its directory is deleted [R4]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    const failing = (fail: (args: string[]) => boolean) => (command: string, args: string[], options?: Parameters<typeof runSync>[2]) => (fail(args) ? { ...runSync(command, ['--version'], options), exitCode: 1 } : runSync(command, args, options));
    const stuck = await bench(fx, reviewer(fx, []), { caseId: 'c-pass', git: failing((a) => a[0] === 'worktree' && (a[1] === 'remove' || a[1] === 'prune')) });
    assert.equal(stuck.cases[0]!.outcome, 'pass');
    assert.deepEqual(readdirSync(fx.tmpRoot), [], 'the directory itself is deleted');
    assert.equal(stuck.leftCheckouts.length, 1, 'git still lists the checkout, so it is reported');
    assert.equal(path.dirname(path.dirname(stuck.leftCheckouts[0]!)), fx.tmpRoot);
    assert.equal(git(fx.root, ['worktree', 'list', '--porcelain']).split('\n').filter((l) => l.startsWith('worktree ')).length, 2);
    git(fx.root, ['worktree', 'prune']);
    assertNoCheckoutLeft(fx);

    const unlisted = await bench(fx, reviewer(fx, []), { caseId: 'c-pass', git: failing((a) => a[0] === 'worktree' && a[1] === 'list') });
    assert.equal(unlisted.leftCheckouts.length, 1, 'a listing that fails cannot confirm the checkout is gone');
    assertNoCheckoutLeft(fx);

    // Each receipt counts on its own: a prune that reports success while git still lists the checkout, and a failed
    // prune under a listing that names only the repository, are both reported.
    const scripted = (answers: Record<string, Partial<ExecReceipt>>) => (command: string, args: string[], options?: Parameters<typeof runSync>[2]) => {
      const answer = args[0] === 'worktree' ? answers[args[1]!] : undefined;
      return answer ? { ...runSync(command, ['--version'], options), ...answer } : runSync(command, args, options);
    };
    const silentPrune = await bench(fx, reviewer(fx, []), { caseId: 'c-pass', git: scripted({ remove: { exitCode: 1 }, prune: { exitCode: 0 } }) });
    assert.equal(silentPrune.leftCheckouts.length, 1, 'git still lists the checkout after a prune that did nothing');
    git(fx.root, ['worktree', 'prune']);
    const failedPrune = await bench(fx, reviewer(fx, []), { caseId: 'c-pass', git: scripted({ remove: { exitCode: 1 }, prune: { exitCode: 1 }, list: { exitCode: 0, stdout: `worktree ${fx.root}\n` } }) });
    assert.equal(failedPrune.leftCheckouts.length, 1, 'a failed prune is reported whatever the listing says');
    git(fx.root, ['worktree', 'prune']);
    assertNoCheckoutLeft(fx);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-BENCH R3 decision 1 advisories: an unconfirmed --case is refused naming --include-unconfirmed, a run that selects no case says so, and a class outside kebab-case is refused [R1] [R3] [R7] [R8]', async () => {
  const bug = { kind: 'bug', id: 'x', candidate: SHA('a'), base: SHA('b'), card, confirmed: false, origin: 'hand' };
  for (const cls of ['dim_9', '-dim', 'dim-', 'dim--9']) assert.equal(ReviewBenchCase.safeParse({ ...bug, expected: [{ ...site(1, 0), class: cls }] }).success, false, cls);
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', bugCase(fx, 'f-unconfirmed', fx.heads.c1, 13, 0, { confirmed: false, confirmedBy: undefined }));
    const calls: Call[] = [];
    await assert.rejects(bench(fx, reviewer(fx, calls), { caseId: 'f-unconfirmed' }), /f-unconfirmed is not confirmed.*--include-unconfirmed/);
    assert.equal(calls.length, 0, 'refused before any review');
    assert.equal((await bench(fx, reviewer(fx, calls), { caseId: 'f-unconfirmed', includeUnconfirmed: true })).cases[0]?.outcome, 'hit');
    const empty = await bench(fx, reviewer(fx, []));
    assert.deepEqual([empty.cases, empty.leftCheckouts, empty.totals.skippedUnconfirmed], [[], [], 1]);
    assert.equal(empty.note, 'no case selected: the case directory holds no confirmed case (1 unconfirmed left out; --include-unconfirmed scores them); nothing was scored');
    assert.equal(formatBenchReport(empty).split('\n')[0], empty.note);
  } finally {
    fx.cleanup();
  }
});

/** Every file under a directory, recursively; a missing directory has none. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('T1-REVIEW-BENCH acceptance 7: no workflow names the reviewer bench, and only the CLI imports it, which imports nothing of the loop [R9]', () => {
  for (const file of [...filesUnder(path.join(repoRoot, '.github', 'workflows')), ...filesUnder(path.join(repoRoot, 'templates', 'github', 'workflows'))]) assert.ok(!readFileSync(file, 'utf8').includes('review bench'), file);
  const benchText = read('src/review/bench.ts');
  assert.doesNotMatch(benchText, /(?:from\s+|import\(\s*)['"]\.\.\/(?:state|coordination|loop)\//);
  const target = path.join(repoRoot, 'src', 'review', 'bench.ts');
  const importers = filesUnder(path.join(repoRoot, 'src')).filter((file) => [...readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)].some((m) => path.resolve(path.dirname(file), m[1]!) === target));
  assert.deepEqual(importers.map((f) => path.relative(repoRoot, f).split(path.sep).join('/')), ['src/cli/main.ts']);
});

test('T1-REVIEW-BENCH acceptance 8: loadEvals reads only the JSON files directly inside the evals directory [R10]', () => {
  const dir = tmpDir('aidlc-rbench-evals-');
  try {
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ ...JSON.parse(read('evals/example-regression.json')), id: 'a' }));
    mkdirSync(path.join(dir, 'review'));
    writeFileSync(path.join(dir, 'review', 'x.json'), JSON.stringify({ kind: 'clean', id: 'x', candidate: SHA('a'), base: SHA('b'), card, confirmed: false, origin: 'hand' }));
    assert.deepEqual(loadEvals(dir).map((c) => c.id), ['a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The `### Reviewer bench` section of docs/OPERATIONS.md, paragraph by paragraph. */
const OPERATIONS_SECTION = [
  '`aidlc review bench run --stage <pre|formal> [--dir <path>] [--case <id>] [--include-unconfirmed]` scores the stage\'s configured primary reviewer on the cases in `evals/review/` (`--dir` names another directory, resolved against the root of the checkout the command runs in). It reads `REVIEW.md`, `aidlc.config.json` and `docs/LESSONS.md` from that root, so a run with `npm run dev -- review bench run` in a card worktree scores that worktree\'s policy, prompts and configuration. It selects the confirmed cases, every case with `--include-unconfirmed`, or the one case `--case` names, and counts the unconfirmed cases it left out. A `--case` that names an unconfirmed case is refused unless `--include-unconfirmed` is given, and a run that selects no case says so in the report (`note`) and on the first line of its line form.',
  'A case is one JSON file named after its `id` (`ReviewBenchCase` in `src/core/types.ts`; `evals/review/README.md` describes each field): `kind` `bug` or `clean`, the `candidate` and `base` commits, the card\'s `id` and its `path` at the candidate, `confirmed`, `confirmedBy`, `origin`, an optional `note`, and for a bug case the `expected` sites, each a `file`, a `line`, a `window` and a `class`.',
  'The reviewer bench reviews each distinct candidate, base and card path once, one review after another, in a detached checkout of the candidate that `git worktree add --detach` creates in a fresh directory under the OS temp directory. That checkout is the reviewer\'s working directory and `{cwd}`, and it is removed after every review, with the directory deleted and `git worktree prune` run when `git worktree remove --force` fails. A checkout is listed in `leftCheckouts` unless its directory is gone, any prune it needed exited 0, and `git worktree list --porcelain` exited 0 without naming it. The review is the loop\'s first R2 round or first R3 decision, built by the loop\'s own functions: the card parsed from `card.path` in the checkout, the diff from `collectCandidateDiff` under the stage\'s `maxDiffBytes`, the prompt from `buildReviewPrompt` with no prior findings, no delta and no advisory notes, and the run from `runReviewPanel` with the stage\'s primary `command` (with the R2 perspectives and coverage request, or the R3 `{schema}` and `{effort}`) and no fallback. Logs and verdicts go to `.review/bench/` of the checkout root.',
  'A bug case is a `hit` when a cited reason of a block names an expected `file` with a line or line range that overlaps `line - window` to `line + window`, and a `miss` otherwise, a pass included. A clean case is a `false-block` when the review blocks and a `pass` when it passes. A review that ends without a verdict or on a quota hold makes its cases `no-verdict`, and a case that could not be reviewed (no checkout, a card file missing, unparseable or naming another id, an empty diff, a diff above the cap, an expected file the diff does not change) is an `error`; neither counts as a hit, a miss, a pass or a false block. A quota hold also stops the run: no later review runs in any trial, and every case of every trial not yet reviewed is a `no-verdict` with the detail `not reviewed: a quota hold stopped the run`. On the formal stage a verdict bound to another commit (`sha`) or another card (`branch`) is a `no-verdict`, as the R3 classification of the loop reads it (`classifyVerdict`); the pre stage scores a verdict as the loop records an R2 round, which reads no binding.',
  'The report gives `stage`, `reviewer`, `policyHash`, `leftCheckouts`, one entry per case (`outcome`, `runStatus`, the cited reasons, `matched` with the reason and the expected file and line for a hit, `detail`, `verdictRef`, `logRef`, `durationMs`) and `totals`. In the totals `recall` is hits / (hits + misses) and `falseBlockRate` is false blocks / (clean passes + false blocks), each `null` when its denominator is 0, beside `noVerdict`, `errors` and `skippedUnconfirmed`. The report is JSON with `--json` or when stdout is not a TTY, and one line per case and a totals line otherwise. The command exits 0 after a report whose `leftCheckouts` is empty, whatever the scores, and 1 when it refuses before any review (no `REVIEW.md`, an empty stage `command`, a missing case directory, a case file that does not load, an unknown `--case`, an unconfirmed `--case` without `--include-unconfirmed`) or leaves a checkout behind.',
  '`--trials <n>` (an integer from 1 to 20, default 1; any other value is refused before a review) reviews every selected case n times, one review after another. The report then also gives `trialResults`, the cases and totals of every trial, and `summary`: `trials`, the `median`, `min` and `max` of `recall` and of `falseBlockRate` over the trials (`null` when any trial has `null`), and `noVerdict` and `errors` summed over the trials; `cases` and `totals` are those of the first trial, so a run of one trial keeps every field and value a report had before. `aidlc review bench compare <before.json> <after.json>` reads two saved JSON reports and prints a verdict and its reason (`src/core/trial-compare.ts`), as JSON with `--json` or when stdout is not a TTY. The verdict is `inconclusive` when the two reports score different case ids, when either has fewer than 3 trials, or when either has a no-verdict or an error in any trial, and the reason names each cause. Otherwise recall decides when the two recall ranges (minimum to maximum) do not overlap, the higher being `better`, then the false-block rate when its ranges do not overlap, the lower being `better`, and else the verdict is `no-measurable-difference`. The command exits 0 for any verdict. It exits 1, naming the file and the rule, when a file is missing or is not JSON, or when a report breaks one of these rules, and for no other cause: (a) a report field (`stage`, `reviewer`, `rules`, `policyHash`, `leftCheckouts`, `cases`, `totals`, `trialResults` with 1 to 20 trials, `summary`) or a case field is missing or of the wrong type, a rate is outside 0 to 1, or a count is negative; (b) a case id appears twice in one list; (c) a bug case has outcome `pass` or `false-block`, or a clean case has `hit` or `miss`; (d) a `hit`, `miss`, `pass` or `false-block` has a `runStatus` other than `success`; (e) a `pass`, `no-verdict` or `error` cites a reason; (f) a case other than a `hit` has `matched`, a `hit` has none, or its `matched.reason` is not one of its `cited` or cites a file other than `matched.file`; (g) a trial lists other case ids than `cases`, or gives a case another `kind` or `confirmed` than `cases` does; (h) a trial\'s totals differ from the totals the bench computes from its cases; (i) `cases` and `totals` differ from those of the first trial; (j) `summary` differs from the one its `trialResults` give. These rules show that a report is complete and consistent with its own cases; they do not authenticate it, so a hand-edited report that keeps every rule is compared as given.',
  'The reviewer bench stays outside the loop: no workflow names it, so it never runs in CI, and it reads no goal, card run, journal or review queue and writes nothing under the state directory, so it never changes a card run and never blocks a card. Before a change to `REVIEW.md`, a review perspective, a review prompt or a reviewer model, run `aidlc review bench run --stage <pre|formal> --trials 3 --json` for both stages from a checkout of the version before and a checkout of the version after the change, save each report, run `aidlc review bench compare <before.json> <after.json>` on each pair, and keep the change only when the verdict is `better` or `no-measurable-difference`. This is a documented practice and no gate enforces it.',
  '`aidlc review bench export --card <id> [--goal <id>] [--clean] [--dir <path>]` drafts cases from the review ledgers into `evals/review/` (`--dir` names another directory, resolved against the root of the checkout the command runs in). It drafts one bug case per finding of stage `formal` in the card\'s runs, in every goal or in the one `--goal` names, and nothing from an R2 finding. The case id is `<card id>.<goal id>.<finding id>`, or `<card id>.<goal id>.clean` for a clean case: six cards ran in more than one goal and finding ids restart per run, so the id carries the goal id. A draft has `confirmed` false and no `confirmedBy`, the finding\'s `candidateSha` as `candidate`, `<cardsDir>/<card id>.md` as the card path, an `origin` naming the card, the finding and the goal, a `note` giving the R3 decision, the disposition and the reason, and one `expected` site at the file and first line the reason cites, with a `window` of 5, or the cited range when that is longer, at most 50. The `class` is the reason\'s `(class: <slug>)` tag case folded, else `dim-<n>` for the REVIEW.md dimension number after the `[spec]` or `[standards]` tag, else `unclassified`, read from the reason text alone. The `base` is `git merge-base <base> <candidate>`, with `<base>` the run\'s `base.oid`, else its `base.ref`, else the configured `base`. With `--clean` the export drafts no bug case and one clean case per card run whose first R3 invocation with outcome `pass` or `block` passed and records a `candidateSha`, over the runs of `--card`, or over every card run of the selected goals when `--card` is left out; at 597e9a2 that selects 49 of 157 card runs, so `--clean` over every goal drafts 47 and skips the 2 that record no `candidateSha`. Each written case\'s candidate is pinned by a ref `refs/aidlc/bench/<id>` that the export creates and never moves, so garbage collection keeps the commit; these are local refs that `git push` sends only when named or mirrored, and `git update-ref -d refs/aidlc/bench/<id>` drops one. The export never overwrites a case: an existing file keeps its bytes and gets no ref, and a write that fails removes the partial file. A ref that names another commit, or a symbolic ref, dangling or not, is a pin conflict, which writes no case, and an `update-ref` that fails removes the file it just created and is listed the same way, so a later export can write the case. A finding or run with no `candidateSha`, a candidate missing from the object store or with no diff from its base, a reason with no `:n` line, no card file in the candidate, or a draft `ReviewBenchCase` refuses goes under `skipped` with its cause. The report gives `written`, `existing`, `skipped` and `pinConflicts`, as JSON with `--json` or when stdout is not a TTY and as one line per entry otherwise. The command exits 1 on a pin conflict, when `--card` is missing without `--clean`, when `--goal` names no goal, when the selected goals hold no run of the `--card` card, when the case directory is missing or resolves, links followed, to the state directory or under it, when the state directory and the repository\'s refs directory overlap, and when a write fails, and 0 otherwise. The export is the one bench command that reads goals and card runs, and it writes only new case files and refs under `refs/aidlc/bench/`, with nothing under the state directory. It writes through the case directory it resolved at the start. Each of its git calls sets `GIT_NO_LAZY_FETCH=1` and an empty `GIT_ALLOW_PROTOCOL`, which allows no protocol, so a partial clone fetches nothing for it, whether or not that git honours the first variable. Its `update-ref` runs with `core.hooksPath=/dev/null` and with `hook.<name>.enabled=false` for each `hook.<name>.event` the config lists, given as `-c` options, so no hook runs and no config file changes; a hook name that holds `=` ends the export, since `-c` cannot name it. The directory and overlap refusals catch a mistaken path; they do not stop a process of the same user that changes those directories during the export, since whoever runs the export controls the checkout and the state directory. `aidlc review bench run` leaves a draft out until a person confirms it, unless `--include-unconfirmed` is given.',
  'A `[pre-existing]` reason on lines the candidate did not change stays advisory, as it does in the loop, so it neither blocks a clean case nor hits a bug case. A card path that resolves outside the temporary checkout is an `error`, and the bench never reads that file.',
];
const ARCHITECTURE_SENTENCE = '`src/review/bench.ts` is the reviewer bench (`aidlc review bench run` and `aidlc review bench export`): the run scores a stage\'s primary reviewer on the confirmed cases under `evals/review/`, each candidate reviewed once in a detached temporary checkout through the loop\'s own prompt and panel functions, the export drafts unconfirmed cases from the card runs `src/cli/main.ts` hands it and pins each candidate under `refs/aidlc/bench/`, and the module imports nothing from `src/state/`, `src/coordination/` or `src/loop/` (docs/OPERATIONS.md, Reviewer bench).';
const CHANGELOG_ENTRY = '- T1-REVIEW-BENCH: `aidlc review bench run --stage pre|formal` (the reviewer bench, `src/review/bench.ts`) scores the stage\'s primary reviewer on the confirmed cases under `evals/review/`, reviewing each candidate once, as the loop reviews a first R2 round or a first R3 decision, in a detached temporary checkout that is always removed. A bug case is a hit when a cited block reason lands inside its expected window and a miss otherwise, a clean case is a pass or a false block, and the report gives recall, the false-block rate and the no-verdict and error counts; the exit code never depends on the scores. Cases can be drafted from the 330 R3 and 134 R2 findings the card runs record (the export and the candidate pins are card T1-REVIEW-BENCH-EXPORT); the bench never runs in CI and never reads or writes a card run.';
const EVALS_SENTENCE = '- `aidlc evals run` reads only `evals/*.json`, so the reviewer bench cases under `evals/review/` (`aidlc review bench run`) never reach it.';
/** evals/review/README.md, paragraph by paragraph (a list is one paragraph). */
const CASES_README = [
  '# evals/review/ (reviewer bench cases)',
  '`aidlc review bench run --stage pre|formal` scores a stage\'s configured reviewer on the confirmed cases in this directory (docs/OPERATIONS.md, Reviewer bench). Each case is one JSON file named `<id>.json`, and `aidlc evals run` never reads it. Every case file of the directory is loaded and checked on each run, `--case` included, so one file that does not load refuses the run.',
  '`--trials <n>` reviews every selected case n times and adds the median and range of recall and of the false-block rate; `aidlc review bench compare <before.json> <after.json>` says whether a change to the review made the scores `better`, `worse`, `no-measurable-difference` or `inconclusive` (docs/OPERATIONS.md, Reviewer bench).',
  [
    'Fields (`ReviewBenchCase` in `src/core/types.ts`; an unknown key is refused):',
    '- `kind`: `bug` (the candidate has a defect at the expected sites) or `clean` (the candidate is correct and a review should pass it).',
    '- `id`: the file name without `.json`; letters, digits, dot, underscore and dash.',
    '- `candidate`: the reviewed commit, 40 lowercase hex characters.',
    '- `base`: the commit the candidate\'s diff starts from, 40 lowercase hex characters.',
    '- `card`: `id`, the card id, and `path`, the card file\'s repository path at the candidate commit.',
    '- `confirmed`: true once a person has checked the case; only confirmed cases are scored by default.',
    '- `confirmedBy`: who confirmed the case, required when `confirmed` is true.',
    '- `origin`: where the case came from (a card run and finding id, an incident, a hand-written defect).',
    '- `note`: optional free text.',
    '- `expected` (bug cases only): one or more sites, each a repository `file`, a positive `line`, a `window` of 0 to 50 lines on either side of it, and a `class`.',
  ].join('\n'),
  'The `class` is any lowercase kebab-case name (lowercase letters and digits joined by single dashes); by convention it is `dim-<n>`, where `<n>` is the REVIEW.md dimension number the finding\'s reason cites.',
  'The `base` is `git merge-base <base> <candidate>`, where `<base>` is the card run\'s `base.oid`, else its `base.ref`; read both, and the candidate, with `aidlc card status <card> --json`.',
  'A hand-written case pins its candidate so that git never collects it: `git update-ref refs/aidlc/bench/<id> <candidate>`.',
  'To confirm a case, check out the candidate (`git worktree add --detach <dir> <candidate>`), find the defect at the expected lines (for a clean case, check that the candidate has none), then set `confirmed` to true and `confirmedBy` to your name.',
  '## Drafting cases with the export',
  '`aidlc review bench export --card <id>` drafts one unconfirmed bug case per R3 finding of that card\'s runs, and `aidlc review bench export --clean` drafts one unconfirmed clean case per card run whose first R3 decision passed (docs/OPERATIONS.md, Reviewer bench). The export fills in every field above, sets `confirmed` to false and pins each candidate with a ref under `refs/aidlc/bench/`, so a drafted case needs no pin command.',
  'A draft comes from the finding\'s reason alone, so check it as you would a hand-written case: find the defect at the expected lines and narrow the `window` to it. Running the export again after a card gains findings is safe, since a case that exists keeps its bytes.',
  '`.gitignore` lists `/evals/review/*.json`, so plain `git status` leaves out a case file that is not tracked and `git add` adds it only with `-f`: commit a confirmed case with `git add -f evals/review/<id>.json`. A case file that is tracked stays tracked, and `git status` shows a change to it as before.',
];

const sentences = (paragraph: string): string[] => paragraph.split(/(?<=\.)\s+(?=[A-Z`])|\n/);
const flat = (text: string) => text.replace(/\s+/g, ' ');

/** Whether every doc text this card adds is present whole. */
function docsHold(ops: string, architecture: string, changelog: string, evals: string, cases: string): boolean {
  const at = ops.indexOf('\n### Reviewer bench\n');
  const stats = ops.indexOf('\n### Review statistics\n');
  const end = ops.indexOf('\n## Evals\n');
  if (!(stats >= 0 && at > stats && end > at)) return false;
  if (JSON.stringify(ops.slice(at + '\n### Reviewer bench\n'.length, end).trim().split('\n\n')) !== JSON.stringify(OPERATIONS_SECTION)) return false;
  if (!architecture.split('\n').includes(ARCHITECTURE_SENTENCE)) return false;
  if (!changelogSince010(changelog).split('\n').includes(CHANGELOG_ENTRY)) return false;
  if (!flat(evals).includes(EVALS_SENTENCE)) return false;
  return JSON.stringify(cases.trim().split('\n\n')) === JSON.stringify(CASES_README);
}

test('T1-REVIEW-BENCH acceptance 9: the docs carry the reviewer bench whole, and removing any sentence of it fails [R11] [R12]', () => {
  const docs = [read('docs/OPERATIONS.md'), read('docs/ARCHITECTURE.md'), read('CHANGELOG.md'), read('evals/README.md'), read('evals/review/README.md')] as const;
  assert.ok(docsHold(...docs), 'the doc texts this card adds are present whole');
  const [ops, architecture, changelog, evals, cases] = docs;
  const section = flat(OPERATIONS_SECTION.join(' '));
  for (const needle of ['aidlc review bench run --stage', '--include-unconfirmed', '`better` or `no-measurable-difference`', 'no gate']) assert.ok(section.includes(needle), needle);
  for (const key of ['kind', 'id', 'candidate', 'base', 'card', 'path', 'confirmed', 'confirmedBy', 'origin', 'note', 'expected', 'file', 'line', 'window', 'class']) assert.ok(cases.includes(`\`${key}\``), key);
  for (const needle of ['git merge-base', 'git update-ref refs/aidlc/bench/']) assert.ok(cases.includes(needle), needle);
  assert.ok(evals.includes('evals/review/'));
  const removals: Array<[string, () => boolean]> = [
    ...OPERATIONS_SECTION.flatMap(sentences).map((s): [string, () => boolean] => [s, () => docsHold(ops.replace(s, ''), architecture, changelog, evals, cases)]),
    [ARCHITECTURE_SENTENCE, () => docsHold(ops, architecture.replace(ARCHITECTURE_SENTENCE, ''), changelog, evals, cases)],
    ...sentences(CHANGELOG_ENTRY).map((s): [string, () => boolean] => [s, () => docsHold(ops, architecture, changelog.replace(s, ''), evals, cases)]),
    [EVALS_SENTENCE, () => docsHold(ops, architecture, changelog, flat(evals).replace(EVALS_SENTENCE, ''), cases)],
    ...CASES_README.flatMap(sentences).map((s): [string, () => boolean] => [s, () => docsHold(ops, architecture, changelog, evals, cases.replace(s, ''))]),
  ];
  assert.ok(removals.length >= 40, `${removals.length} removals`);
  for (const [sentence, holds] of removals) assert.equal(holds(), false, `removing this text still passes: ${sentence}`);
});

const PRE_EXISTING_REASON = '[standards] 6 old drift @ src/calc.ts:28: [pre-existing] v28 was already unchecked -> check it';
const PRE_EXISTING_CHANGED = '[standards] 6 old drift @ src/calc.ts:8: [pre-existing] v8 was already unchecked -> check it';
const UNTAGGED_REASON = '[standards] 6 old drift @ src/calc.ts:28: v28 was already unchecked -> check it';

test('T1-REVIEW-BENCH-2 acceptance 13: a [pre-existing] reason on an unchanged line stays advisory, as in the loop [R13]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', cleanCase(fx, 'a-clean-tagged', fx.heads.c2));
    writeCase(fx, 'evals/review', cleanCase(fx, 'b-clean-untagged', fx.heads.c3));
    writeCase(fx, 'evals/review', bugCase(fx, 'c-bug-tagged', fx.heads.c2, 28, 0));
    writeCase(fx, 'evals/review', bugCase(fx, 'd-bug-untagged', fx.heads.c3, 28, 0));
    writeCase(fx, 'evals/review', bugCase(fx, 'e-bug-mixed', fx.heads.c1, 28, 0));
    writeCase(fx, 'evals/review', bugCase(fx, 'f-bug-tagged-changed-line', fx.heads.c4, 8, 0));
    const table: Record<string, Partial<ExecReceipt>> = {
      [fx.heads.c1]: { stdout: verdict('block', [PRE_EXISTING_REASON, HIT_REASON]) },
      [fx.heads.c2]: { stdout: verdict('block', [PRE_EXISTING_REASON]) },
      [fx.heads.c3]: { stdout: verdict('block', [UNTAGGED_REASON]) },
      [fx.heads.c4]: { stdout: verdict('block', [PRE_EXISTING_CHANGED]) },
    };
    const runner: Runner = async (command, args, options = {}) => scriptedRunner({ [command]: table[args.find(isSha) ?? ''] ?? { exitCode: 2 } })(command, args, options);
    const report = await bench(fx, runner);
    assert.deepEqual(report.cases.map((c) => [c.id, c.outcome]), [['a-clean-tagged', 'pass'], ['b-clean-untagged', 'false-block'], ['c-bug-tagged', 'miss'], ['d-bug-untagged', 'hit'], ['e-bug-mixed', 'miss'], ['f-bug-tagged-changed-line', 'hit']]);
    assert.deepEqual(report.cases.find((c) => c.id === 'e-bug-mixed')!.cited, [HIT_REASON]);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-BENCH-2 acceptance 14: intent new takes the session as its author in the action, and an explicit author wins [R14]', () => {
  const fx = fixture();
  try {
    const { AIDLC_SESSION: _session, CLAUDE_CODE_SESSION_ID: _claude, ...env } = process.env;
    const cli = (slug: string, extra: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'intent', 'new', '--title', slug, ...extra], { cwd: fx.root, encoding: 'utf8', env: { ...env, AIDLC_SESSION: 'sess-x', AIDLC_STATE_DIR: path.join(fx.dir, 'state') } });
    const session = cli('x', []);
    assert.equal(session.status, 0, session.stderr);
    assert.ok(readFileSync(path.join(fx.root, 'intent', 'x.md'), 'utf8').includes('Author: sess-x.'));
    const named = cli('y', ['--author', 'someone']);
    assert.equal(named.status, 0, named.stderr);
    assert.ok(readFileSync(path.join(fx.root, 'intent', 'y.md'), 'utf8').includes('Author: someone.'));
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-BENCH-2 acceptance 15: the Reviewer bench section ends with the sentence of the card and the changelog carries its entry [R15]', () => {
  const lf = (text: string) => text.replace(/\r\n/g, '\n');
  const body = lf(read('specs/tasks/T1-REVIEW-BENCH-2.md'));
  const sentence = /OPERATIONS sentence:\n\n(.+)\n/.exec(body)![1]!;
  const entry = /CHANGELOG entry:\n\n(.+)\n/.exec(body)![1]!;
  const ops = lf(read('docs/OPERATIONS.md'));
  const from = ops.indexOf('### Reviewer bench');
  const section = ops.slice(from, ops.indexOf('\n## ', from)).trimEnd();
  assert.ok(section.endsWith(sentence), 'the section ends with the sentence');
  assert.ok(read('CHANGELOG.md').includes(entry), 'the changelog carries the entry');
});

type GitOption = NonNullable<ReviewBenchOptions['git']>;

/** The real git, with `after` run on the new checkout as soon as `worktree add` has made it. */
const gitThen = (after: (checkout: string) => void): GitOption => (command, args, options) => {
  const receipt = runSync(command, args, options);
  if (args[0] === 'worktree' && args[1] === 'add') after(args[3]!);
  return receipt;
};

test('T1-REVIEW-BENCH-2 acceptance 16: a card path that resolves outside the checkout is an error and no reviewer runs, and a link inside it is followed [R16]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    const outside = path.join(fx.dir, 'outside');
    const outsideCard = path.join(outside, `${CARD_ID}.md`);
    mkdirSync(outside);
    writeFileSync(outsideCard, cardText);
    const tasksOf = (checkout: string) => path.join(checkout, 'specs', 'tasks');

    const calls: Call[] = [];
    const refused = await bench(fx, reviewer(fx, calls), {
      git: gitThen((checkout) => {
        rmSync(tasksOf(checkout), { recursive: true });
        symlinkSync(outside, tasksOf(checkout), linkType);
      }),
    });
    assert.equal(refused.cases[0]!.outcome, 'error');
    assert.ok(refused.cases[0]!.detail?.includes(`card file ${CARD_PATH} resolves outside the checkout`), refused.cases[0]!.detail);
    assert.equal(calls.length, 0, 'no reviewer ran on a card read from outside the checkout');
    assertNoCheckoutLeft(fx);

    const followed = await bench(fx, reviewer(fx, calls), {
      git: gitThen((checkout) => {
        const kept = path.join(checkout, 'specs', 'kept');
        renameSync(tasksOf(checkout), kept);
        symlinkSync(kept, tasksOf(checkout), linkType);
      }),
    });
    assert.equal(followed.cases[0]!.outcome, 'pass');
    assert.equal(calls.length, 1, 'a link inside the checkout is followed and reviewed');
    assertNoCheckoutLeft(fx);

    let filesLink = true;
    try {
      symlinkSync(outsideCard, path.join(fx.dir, 'probe'), 'file');
    } catch {
      filesLink = false;
    }
    if (filesLink) {
      const atFile = await bench(fx, reviewer(fx, calls), {
        git: gitThen((checkout) => {
          const file = path.join(tasksOf(checkout), `${CARD_ID}.md`);
          rmSync(file);
          symlinkSync(outsideCard, file, 'file');
        }),
      });
      assert.equal(atFile.cases[0]!.outcome, 'error');
      assert.equal(calls.length, 1, 'no reviewer ran for the file link');
      assertNoCheckoutLeft(fx);
    }
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-BENCH-2 acceptance 17: a cleanup step that throws counts as failing, the later steps run and the report is returned [R17]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    const throwing = (steps: string[]): GitOption => (command, args, options) => {
      if (args[0] === 'worktree' && steps.includes(args[1]!)) throw new Error(`injected ${args[1]} failure`);
      return runSync(command, args, options);
    };

    const remove = await bench(fx, reviewer(fx, []), { git: throwing(['remove']) });
    assert.equal(remove.cases[0]!.outcome, 'pass');
    assert.deepEqual(remove.leftCheckouts, [], 'the directory went and the prune and the listing confirm it');
    assertNoCheckoutLeft(fx);

    const removePrune = await bench(fx, reviewer(fx, []), { git: throwing(['remove', 'prune']) });
    assert.equal(removePrune.cases[0]!.outcome, 'pass');
    assert.deepEqual(readdirSync(fx.tmpRoot), [], 'the directory is deleted after the throw');
    assert.equal(removePrune.leftCheckouts.length, 1, 'nothing confirms the removal');
    git(fx.root, ['worktree', 'prune']);
    assertNoCheckoutLeft(fx);

    const list = await bench(fx, reviewer(fx, []), { git: throwing(['list']) });
    assert.equal(list.cases[0]!.outcome, 'pass');
    assert.equal(list.leftCheckouts.length, 1, 'a listing that throws cannot confirm the checkout is gone');
    assertNoCheckoutLeft(fx);
  } finally {
    fx.cleanup();
  }
});

const MATCHED_RULE = '- 2026-01-01 T1-OLD-MATCH: ALWAYS check the value of `v13` against its name (source: PR 1)';
/** A file over the cap of newer rules that match nothing, with the one rule that matches candidate c1 as its oldest. */
function writeLessonsOverCap(fx: Fixture): void {
  const newer = Array.from({ length: 30 }, (_, i) => `- 2026-02-${String((i % 28) + 1).padStart(2, '0')} T1-NEW-${i}: ALWAYS keep unrelated rule ${i} ${'z'.repeat(200)} (source: PR 2)`);
  writeFileSync(path.join(fx.root, 'docs', 'LESSONS.md'), `# Lessons\n\n${[MATCHED_RULE, ...newer].join('\n')}\n`);
}

test('T1-LESSON-MATCH acceptance 6: --rules matched puts the matching rule in the prompt and names the choice in the report [R6]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeLessonsOverCap(fx);
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 13, 2));
    const matched: Call[] = [];
    const report = await bench(fx, reviewer(fx, matched), { rules: 'matched' });
    assert.equal(report.rules, 'matched');
    assert.ok(formatBenchReport(report).includes('bench-r3 (matched rules): recall'), 'the text report names the choice too');
    assert.equal(matched.length, 1);
    assert.ok(matched[0]!.input.includes('T1-OLD-MATCH'), 'the old matching rule is sent');
    assert.ok(matched[0]!.input.includes('other lessons omitted at the byte cap; the rules that best match this diff are above.'));

    const newest: Call[] = [];
    const plain = await bench(fx, reviewer(fx, newest));
    assert.equal(plain.rules, 'newest', 'newest is the default');
    assert.ok(formatBenchReport(plain).includes('bench-r3: recall'), 'the text report of the default is unchanged');
    assert.ok(!newest[0]!.input.includes('T1-OLD-MATCH'), 'the newest rules fill the cap');
    assert.ok(newest[0]!.input.includes('older lessons omitted at the byte cap; the newest rules are above.'));
  } finally {
    fx.cleanup();
  }
});

test('T1-LESSON-MATCH acceptance 6: --rules other exits non-zero with no review run [R6]', () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    const refused = spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'run', '--stage', 'formal', '--json', '--rules', 'other'], { cwd: fx.root, encoding: 'utf8' });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /--rules must be newest or matched, not other/);
    assert.equal(refused.stdout, '');
    assert.equal(existsSync(path.join(fx.root, '.review', 'bench')), false, 'no review ran');
  } finally {
    fx.cleanup();
  }
});

test('T1-LESSON-MATCH acceptance 6: the bench reads the commit history at the case base, so a rule matches by the files of its card [R6]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeLessonsOverCap(fx);
    // The base commit's subject is `base`, so a rule of the card `base` has src/calc.ts as a path. Its text names no term of the diff.
    const lessons = path.join(fx.root, 'docs', 'LESSONS.md');
    writeFileSync(lessons, readFileSync(lessons, 'utf8').replace(MATCHED_RULE, '- 2026-01-01 base: ALWAYS keep the path rule first (source: PR 1)'));
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 13, 2));
    const calls: Call[] = [];
    await bench(fx, reviewer(fx, calls), { rules: 'matched' });
    assert.ok(calls[0]!.input.includes('keep the path rule first'), 'the rule is chosen by its path alone');
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-TRIALS-2 acceptance 2: --trials 3 reviews each case 3 times and reports the median and range of recall; 0 and 21 are refused before any review [R1] [R2]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 12, 2));
    let calls = 0;
    // The reviewer hits the case on its first two reviews and passes it on the third.
    const twoOfThree: Runner = async (command, args, options) => scriptedRunner({ [command]: { stdout: verdict(++calls <= 2 ? 'block' : 'pass', calls <= 2 ? [HIT_REASON] : []) } })(command, args, options);
    const report = await bench(fx, twoOfThree, { trials: 3 });
    assert.equal(calls, 3);
    assert.deepEqual(report.trialResults.map((t) => t.cases.map((c) => c.outcome)), [['hit'], ['hit'], ['miss']]);
    assert.deepEqual(report.trialResults.map((t) => t.totals.recall), [1, 1, 0]);
    assert.deepEqual(report.summary, { trials: 3, recall: { median: 1, min: 0, max: 1 }, falseBlockRate: null, noVerdict: 0, errors: 0 });
    assert.match(formatBenchReport(report), /3 trials: recall median 1\.00 \(0\.00 to 1\.00\)/);
    for (const trials of [0, 21, 1.5]) await assert.rejects(bench(fx, twoOfThree, { trials }), /--trials must be an integer from 1 to 20/, String(trials));
    assert.equal(calls, 3, 'no review ran for a refused --trials');
    assertNoCheckoutLeft(fx);
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-TRIALS-2 acceptance 3: a --trials 1 report keeps every field and value a report had before the card [R2]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeItem3Cases(fx);
    const report = await bench(fx, reviewer(fx, []), { trials: 1 });
    assert.deepEqual(Object.keys(report), ['stage', 'reviewer', 'rules', 'policyHash', 'leftCheckouts', 'cases', 'totals', 'trialResults', 'summary']);
    assert.deepEqual(report.cases.map((c) => [c.id, c.outcome]), [['a-hit', 'hit'], ['b-miss', 'miss'], ['c-pass', 'pass'], ['d-false-block', 'false-block'], ['e-no-verdict', 'no-verdict']]);
    assert.deepEqual(report.totals, { bugCases: 3, hits: 1, misses: 1, recall: 0.5, cleanCases: 2, cleanPasses: 1, falseBlocks: 1, falseBlockRate: 0.5, noVerdict: 1, errors: 0, skippedUnconfirmed: 1 });
    assert.deepEqual(report.trialResults, [{ cases: report.cases, totals: report.totals }]);
    assert.deepEqual(report.summary, { trials: 1, recall: { median: 0.5, min: 0.5, max: 0.5 }, falseBlockRate: { median: 0.5, min: 0.5, max: 0.5 }, noVerdict: 1, errors: 0 });
    assert.ok(!formatBenchReport(report).includes('trial'), 'the line form of one trial is unchanged');
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-TRIALS-2 acceptance 4: bench compare prints the verdict of two saved reports, and a missing file or a JSON file that is not a report exits 1 [R6]', () => {
  const dir = tmpDir('aidlc-rbench-compare-');
  try {
    // A saved report of three trials of two bug cases, each trial with `hits` hits.
    const saved = (name: string, hits: number) => {
      const file = path.join(dir, name);
      const reason = (id: string) => `[spec] 1 defect @ src/${id}.ts:1: x -> y`;
      const cases = ['a', 'b'].map((id, i) => ({ id, kind: 'bug', confirmed: true, outcome: i < hits ? 'hit' : 'miss', runStatus: 'success', cited: [reason(id)], ...(i < hits ? { matched: { reason: reason(id), file: `src/${id}.ts`, line: 1 } } : {}), durationMs: 0 }));
      const totals = { bugCases: 2, hits, misses: 2 - hits, recall: hits / 2, cleanCases: 0, cleanPasses: 0, falseBlocks: 0, falseBlockRate: null, noVerdict: 0, errors: 0, skippedUnconfirmed: 0 };
      const recall = { median: hits / 2, min: hits / 2, max: hits / 2 };
      writeFileSync(file, JSON.stringify({ stage: 'formal', reviewer: 'r', rules: 'newest', policyHash: 'p', leftCheckouts: [], cases, totals, trialResults: [1, 2, 3].map(() => ({ cases, totals })), summary: { trials: 3, recall, falseBlockRate: null, noVerdict: 0, errors: 0 } }));
      return file;
    };
    const before = saved('before.json', 1);
    const after = saved('after.json', 2);
    writeFileSync(path.join(dir, 'other.json'), '{"verdict":"pass"}');
    const cli = (args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'compare', ...args], { cwd: dir, encoding: 'utf8', windowsHide: true });
    const ok = cli([before, after, '--json']);
    assert.equal(ok.status, 0, ok.stderr);
    assert.deepEqual(JSON.parse(ok.stdout), { verdict: 'better', reason: 'recall 1.00 to 1.00 after, 0.50 to 0.50 before: the ranges do not overlap' });
    assert.equal(JSON.parse(cli([after, before]).stdout).verdict, 'worse', 'JSON when stdout is not a TTY');
    for (const [args, name] of [[[before, path.join(dir, 'missing.json')], 'missing.json'], [[path.join(dir, 'other.json'), after], 'other.json']] as const) {
      const refused = cli([...args]);
      assert.equal(refused.status, 1, name);
      assert.match(refused.stderr, new RegExp(name.replace('.', '\.')));
      assert.equal(refused.stdout, '');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T1-BENCH-TRIALS-2 acceptance 7: a quota hold stops the run, and every case and trial not yet reviewed is a no-verdict [R1] [R2]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 12, 2));
    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    let calls = 0;
    const held: Runner = async (command, args, options) => (++calls, scriptedRunner({ [command]: { exitCode: 1, stderr: 'usage limit reached\n' } })(command, args, options));
    const report = await bench(fx, held, { trials: 3 });
    assert.equal(calls, 1, 'no review after the hold');
    assert.deepEqual(report.trialResults.map((t) => t.cases.map((c) => [c.id, c.outcome])), Array.from({ length: 3 }, () => [['a-hit', 'no-verdict'], ['c-pass', 'no-verdict']]));
    const stopped = report.trialResults.flatMap((t) => t.cases).filter((c) => c.detail === 'not reviewed: a quota hold stopped the run');
    assert.equal(stopped.length, 5, 'the five pairs after the held review');
    assert.equal(report.summary.noVerdict, 6);
    assertNoCheckoutLeft(fx);
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-TRIALS-2 acceptance 8: bench compare accepts a report a run wrote and refuses an incomplete one, a rate outside 0 to 1 and a summary its trials do not give [R6]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 12, 2));
    const report = await bench(fx, reviewer(fx, []), { trials: 3 });
    const save = (name: string, doc: unknown) => (writeFileSync(path.join(fx.dir, name), JSON.stringify(doc)), path.join(fx.dir, name));
    const cli = (a: string, b: string) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'compare', a, b, '--json'], { cwd: fx.dir, encoding: 'utf8', windowsHide: true });
    const run = save('run.json', report);
    const ok = cli(run, run);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).verdict, 'no-measurable-difference');
    const { trialResults: _t, ...partial } = report;
    const recall2 = { ...report, summary: { ...report.summary, recall: { median: 2, min: 2, max: 2 } }, trialResults: report.trialResults.map((t) => ({ ...t, totals: { ...t.totals, recall: 2 } })) };
    const mismatch = { ...report, summary: { ...report.summary, recall: { median: 0.5, min: 0.5, max: 0.5 } } };
    for (const [name, doc] of [['partial.json', partial], ['recall2.json', recall2], ['mismatch.json', mismatch]] as const) {
      const refused = cli(run, save(name, doc));
      assert.equal(refused.status, 1, name);
      assert.match(refused.stderr, new RegExp(name.replace('.', '\.')), name);
      assert.equal(refused.stdout, '', name);
    }
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-TRIALS-2 acceptance 8: bench compare refuses a report that breaks any rule (a) to (j), each made from a real report by one change, and accepts a run stopped by a quota hold [R6]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 12, 2));
    const valid = JSON.stringify(await bench(fx, reviewer(fx, []), { trials: 3 }));
    const save = (name: string, doc: unknown) => (writeFileSync(path.join(fx.dir, name), JSON.stringify(doc)), path.join(fx.dir, name));
    const cli = (a: string, b: string) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'compare', a, b, '--json'], { cwd: fx.dir, encoding: 'utf8', windowsHide: true });
    const run = save('run.json', JSON.parse(valid));
    assert.equal(cli(run, run).status, 0);
    type Case = Record<string, unknown> & { matched?: Record<string, unknown> };
    type Doc = Record<string, unknown> & { cases: Case[]; totals: Record<string, unknown>; summary: Record<string, unknown>; trialResults: Array<{ cases: Case[]; totals: Record<string, unknown> }> };
    // [file name with the rule letter, the one change, the letter, the cause]
    const rows: Array<[string, (d: Doc) => void, string, RegExp]> = [
      ['a-no-policy-hash.json', (d) => delete d['policyHash'], 'a', /policyHash/],
      ['a-no-outcome.json', (d) => delete d.cases[0]!['outcome'], 'a', /cases\.0\.outcome/],
      ['a-rate.json', (d) => void (d.trialResults[0]!.totals['falseBlockRate'] = 1.5), 'a', /trialResults\.0\.totals\.falseBlockRate/],
      ['a-negative.json', (d) => void (d.totals['errors'] = -1), 'a', /totals\.errors/],
      // The duplicate in every list of the report, so the case ids of the trials still agree.
      ['b-duplicate.json', (d) => [d.cases, ...d.trialResults.map((t) => t.cases)].forEach((cases) => cases.push({ ...cases[0]! })), 'b', /case "a-hit" appears twice in cases/],
      ['c-bug-pass.json', (d) => void (d.cases[0]!['outcome'] = 'pass'), 'c', /bug case "a-hit" has outcome pass/],
      ['d-timeout-hit.json', (d) => void (d.cases[0]!['runStatus'] = 'timeout'), 'd', /case "a-hit" has outcome hit with runStatus timeout: a scored outcome needs runStatus success/],
      ['e-no-verdict-cited.json', (d) => void (d.cases[0]!['outcome'] = 'no-verdict'), 'e', /case "a-hit": outcome no-verdict cites no reason/],
      ['f-hit-unmatched.json', (d) => void delete d.cases[0]!.matched, 'f', /case "a-hit": only a hit has matched, and its matched reason is one of its cited/],
      ['f-matched-file.json', (d) => void (d.cases[0]!.matched!['file'] = 'src/other.ts'), 'f', /case "a-hit": its matched reason cites src\/calc\.ts, not its matched file src\/other\.ts/],
      ['g-confirmed.json', (d) => void (d.trialResults[1]!.cases[0]!['confirmed'] = false), 'g', /trial 2 gives case "a-hit" another kind or confirmed than cases/],
      // A clean pass as the bench writes one, in place of the bug hit in trial 2.
      ['g-kind.json', (d) => void Object.assign(d.trialResults[1]!.cases[0]!, { kind: 'clean', outcome: 'pass', cited: [], matched: undefined }), 'g', /trial 2 gives case "a-hit" another kind or confirmed than cases/],
      ['h-recall-1-of-0.json', (d) => void Object.assign(d.trialResults[0]!.totals, { hits: 0, misses: 1, recall: 1 }), 'h', /trial 1 totals differ from its cases/],
      // A no-verdict record as the bench writes one (nothing cited, nothing matched), while the totals still count a hit.
      ['h-no-verdict-hit.json', (d) => void Object.assign(d.trialResults[1]!.cases[0]!, { outcome: 'no-verdict', cited: [], matched: undefined }), 'h', /trial 2 totals differ from its cases/],
      ['i-top-totals.json', (d) => void (d.totals['skippedUnconfirmed'] = 4), 'i', /cases and totals differ from trial 1/],
      ['j-summary.json', (d) => void (d.summary['noVerdict'] = 1), 'j', /the summary differs from the one its trialResults give/],
    ];
    assert.deepEqual([...new Set(rows.map((r) => r[2]))], ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'], 'one row or more per rule');
    for (const [name, change, letter, cause] of rows) {
      const doc = JSON.parse(valid) as Doc;
      change(doc);
      const refused = cli(run, save(name, doc));
      assert.equal(refused.status, 1, name);
      assert.ok(refused.stderr.includes(`${name}: rule (${letter}): `), `${name}: ${refused.stderr}`);
      assert.match(refused.stderr, cause, name);
      assert.equal(refused.stdout, '', name);
    }

    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    const held: Runner = async (command, args, options) => scriptedRunner({ [command]: { exitCode: 1, stderr: 'usage limit reached\n' } })(command, args, options);
    const stopped = save('held.json', await bench(fx, held, { trials: 3 }));
    const ok = cli(stopped, stopped);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).verdict, 'inconclusive');
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-TRIALS-2 acceptance 8: case order is no rule, so a report with the cases of a trial or of the report reordered compares with exit 0 [R6]', async () => {
  const fx = fixture();
  try {
    writeConfig(fx, formalConfig());
    writeCase(fx, 'evals/review', bugCase(fx, 'a-hit', fx.heads.c1, 12, 2));
    writeCase(fx, 'evals/review', cleanCase(fx, 'c-pass', fx.heads.c2));
    const valid = JSON.stringify(await bench(fx, reviewer(fx, []), { trials: 3 }));
    const save = (name: string, doc: unknown) => (writeFileSync(path.join(fx.dir, name), JSON.stringify(doc)), path.join(fx.dir, name));
    const cli = (a: string, b: string) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'compare', a, b, '--json'], { cwd: fx.dir, encoding: 'utf8', windowsHide: true });
    const run = save('run.json', JSON.parse(valid));
    type Doc = { cases: unknown[]; trialResults: Array<{ cases: unknown[] }> };
    for (const [name, reorder] of [['trial-2-reordered.json', (d: Doc) => d.trialResults[1]!.cases.reverse()], ['cases-reordered.json', (d: Doc) => d.cases.reverse()]] as const) {
      const doc = JSON.parse(valid) as Doc;
      reorder(doc);
      const ok = cli(run, save(name, doc));
      assert.equal(ok.status, 0, `${name}: ${ok.stderr}`);
      assert.equal(JSON.parse(ok.stdout).verdict, 'no-measurable-difference', name);
    }
  } finally {
    fx.cleanup();
  }
});
