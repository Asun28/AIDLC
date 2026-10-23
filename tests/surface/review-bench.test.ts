import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ReviewBenchCase } from '../../src/core/types.ts';
import { loadBenchCases, runReviewBench, type ReviewBenchOptions } from '../../src/review/bench.ts';
import { loadEvals } from '../../src/evals/runner.ts';
import { renderCard } from '../../src/artifacts/card.ts';
import { runSync, scriptedRunner, type ExecReceipt, type Runner } from '../../src/probes/exec.ts';

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
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-rbench-')));
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
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-rbench-load-'));
  try {
    const one = (id: string) => ({ kind: 'clean', id, candidate: SHA('a'), base: SHA('b'), card, confirmed: false, origin: 'hand' });
    writeFileSync(path.join(dir, 'b.json'), JSON.stringify(one('b')));
    writeFileSync(path.join(dir, 'a.json'), JSON.stringify(one('a')));
    writeFileSync(path.join(dir, 'README.md'), '# cases\n');
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'c.json'), JSON.stringify(one('c')));
    assert.deepEqual(loadBenchCases(dir).map((c) => c.id), ['a', 'b']);
    for (const [name, text] of [['notjson.json', '{'], ['schema.json', JSON.stringify({ ...one('schema'), kind: 'other' })], ['a.json', JSON.stringify(one('b'))]] as const) {
      const bad = mkdtempSync(path.join(dir, 'bad-'));
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
    const cli = (args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), 'review', 'bench', 'run', '--stage', 'formal', '--json', ...args], { cwd: fx.root, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: state, TMPDIR: fx.tmpRoot, TEMP: fx.tmpRoot, TMP: fx.tmpRoot }, windowsHide: true });
    const ok = cli([]);
    assert.equal(ok.status, 0, ok.stderr);
    const report = JSON.parse(ok.stdout) as { totals: { cleanCases: number; falseBlocks: number }; leftCheckouts: string[] };
    assert.equal(report.totals.cleanCases, 1);
    assert.equal(report.totals.falseBlocks, 0);
    assert.equal(existsSync(state), false, 'nothing under the state directory');

    writeCase(fx, 'evals/bad', cleanCase(fx, 'y', fx.heads.c2), 'x.json');
    const refused = cli(['--dir', 'evals/bad']);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /x\.json/);
    assert.equal(refused.stdout, '');
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
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-rbench-evals-'));
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
  '`aidlc review bench run --stage <pre|formal> [--dir <path>] [--case <id>] [--include-unconfirmed]` scores the stage\'s configured primary reviewer on the cases in `evals/review/` (`--dir` names another directory, resolved against the root of the checkout the command runs in). It reads `REVIEW.md`, `aidlc.config.json` and `docs/LESSONS.md` from that root, so a run with `npm run dev -- review bench run` in a card worktree scores that worktree\'s policy, prompts and configuration. It selects the confirmed cases, every case with `--include-unconfirmed`, or the one case `--case` names, and counts the unconfirmed cases it left out.',
  'A case is one JSON file named after its `id` (`ReviewBenchCase` in `src/core/types.ts`; `evals/review/README.md` describes each field): `kind` `bug` or `clean`, the `candidate` and `base` commits, the card\'s `id` and its `path` at the candidate, `confirmed`, `confirmedBy`, `origin`, an optional `note`, and for a bug case the `expected` sites, each a `file`, a `line`, a `window` and a `class`.',
  'The reviewer bench reviews each distinct candidate, base and card path once, one review after another, in a detached checkout of the candidate that `git worktree add --detach` creates in a fresh directory under the OS temp directory. That checkout is the reviewer\'s working directory and `{cwd}`, and it is removed after every review, with the directory deleted and `git worktree prune` run when `git worktree remove --force` fails. The review is the loop\'s first R2 round or first R3 decision, built by the loop\'s own functions: the card parsed from `card.path` in the checkout, the diff from `collectCandidateDiff` under the stage\'s `maxDiffBytes`, the prompt from `buildReviewPrompt` with no prior findings, no delta and no advisory notes, and the run from `runReviewPanel` with the stage\'s primary `command` (with the R2 perspectives and coverage request, or the R3 `{schema}` and `{effort}`) and no fallback. Logs and verdicts go to `.review/bench/` of the checkout root.',
  'A bug case is a `hit` when a cited reason of a block names an expected `file` with a line or line range that overlaps `line - window` to `line + window`, and a `miss` otherwise, a pass included. A clean case is a `false-block` when the review blocks and a `pass` when it passes. A review that ends without a verdict or on a quota hold makes its cases `no-verdict`, and a case that could not be reviewed (no checkout, a card file missing, unparseable or naming another id, an empty diff, a diff above the cap, an expected file the diff does not change) is an `error`; neither counts as a hit, a miss, a pass or a false block.',
  'The report gives `stage`, `reviewer`, `policyHash`, `leftCheckouts`, one entry per case (`outcome`, `runStatus`, the cited reasons, `matched` with the reason and the expected file and line for a hit, `detail`, `verdictRef`, `logRef`, `durationMs`) and `totals`. In the totals `recall` is hits / (hits + misses) and `falseBlockRate` is false blocks / (clean passes + false blocks), each `null` when its denominator is 0, beside `noVerdict`, `errors` and `skippedUnconfirmed`. The report is JSON with `--json` or when stdout is not a TTY, and one line per case and a totals line otherwise. The command exits 0 after a report whose `leftCheckouts` is empty, whatever the scores, and 1 when it refuses before any review (no `REVIEW.md`, an empty stage `command`, a missing case directory, a case file that does not load, an unknown `--case`) or leaves a checkout behind.',
  'The reviewer bench stays outside the loop: no workflow names it, so it never runs in CI, and it reads no goal, card run, journal or review queue and writes nothing under the state directory, so it never changes a card run and never blocks a card. Before a change to `REVIEW.md`, a review perspective, a review prompt or a reviewer model, run it for both stages from a checkout of the version before and a checkout of the version after the change, and keep the change only when recall does not drop. This is a documented practice and no gate enforces it.',
];
const ARCHITECTURE_SENTENCE = '`src/review/bench.ts` is the reviewer bench (`aidlc review bench run`): it scores a stage\'s primary reviewer on the confirmed cases under `evals/review/`, each candidate reviewed once in a detached temporary checkout through the loop\'s own prompt and panel functions, and it imports nothing from `src/state/`, `src/coordination/` or `src/loop/` (docs/OPERATIONS.md, Reviewer bench).';
const CHANGELOG_ENTRY = '- T1-REVIEW-BENCH: `aidlc review bench run --stage pre|formal` (the reviewer bench, `src/review/bench.ts`) scores the stage\'s primary reviewer on the confirmed cases under `evals/review/`, reviewing each candidate once, as the loop reviews a first R2 round or a first R3 decision, in a detached temporary checkout that is always removed. A bug case is a hit when a cited block reason lands inside its expected window and a miss otherwise, a clean case is a pass or a false block, and the report gives recall, the false-block rate and the no-verdict and error counts; the exit code never depends on the scores. Cases can be drafted from the 330 R3 and 134 R2 findings the card runs record (the export and the candidate pins are card T1-REVIEW-BENCH-EXPORT); the bench never runs in CI and never reads or writes a card run.';
const EVALS_SENTENCE = '- `aidlc evals run` reads only `evals/*.json`, so the reviewer bench cases under `evals/review/` (`aidlc review bench run`) never reach it.';
/** evals/review/README.md, paragraph by paragraph (a list is one paragraph). */
const CASES_README = [
  '# evals/review/ (reviewer bench cases)',
  '`aidlc review bench run --stage pre|formal` scores a stage\'s configured reviewer on the confirmed cases in this directory (docs/OPERATIONS.md, Reviewer bench). Each case is one JSON file named `<id>.json`, and `aidlc evals run` never reads it.',
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
  'The `class` is `dim-<n>`, where `<n>` is the REVIEW.md dimension number the finding\'s reason cites.',
  'The `base` is `git merge-base <base> <candidate>`, where `<base>` is the card run\'s `base.oid`, else its `base.ref`; read both, and the candidate, with `aidlc card status <card> --json`.',
  'A hand-written case pins its candidate so that git never collects it: `git update-ref refs/aidlc/bench/<id> <candidate>`.',
  'To confirm a case, check out the candidate (`git worktree add --detach <dir> <candidate>`), find the defect at the expected lines (for a clean case, check that the candidate has none), then set `confirmed` to true and `confirmedBy` to your name.',
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
  const start = changelog.indexOf('## Unreleased');
  if (!changelog.slice(start, changelog.indexOf('\n## ', start + 1)).split('\n').includes(CHANGELOG_ENTRY)) return false;
  if (!flat(evals).includes(EVALS_SENTENCE)) return false;
  return JSON.stringify(cases.trim().split('\n\n')) === JSON.stringify(CASES_README);
}

test('T1-REVIEW-BENCH acceptance 9: the docs carry the reviewer bench whole, and removing any sentence of it fails [R11] [R12]', () => {
  const docs = [read('docs/OPERATIONS.md'), read('docs/ARCHITECTURE.md'), read('CHANGELOG.md'), read('evals/README.md'), read('evals/review/README.md')] as const;
  assert.ok(docsHold(...docs), 'the doc texts this card adds are present whole');
  const [ops, architecture, changelog, evals, cases] = docs;
  const section = flat(OPERATIONS_SECTION.join(' '));
  for (const needle of ['aidlc review bench run --stage', '--include-unconfirmed', 'recall does not drop', 'no gate']) assert.ok(section.includes(needle), needle);
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
