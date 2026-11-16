import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as bench from '../../src/review/bench.ts';
import { renderCard } from '../../src/artifacts/card.ts';
import { buildReviewPrompt } from '../../src/review/pre-review.ts';
import { runSync, scriptedRunner, type ExecReceipt, type Runner } from '../../src/probes/exec.ts';
import { tmpDir } from '../infra/helpers.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const FIXED = '2026-11-16T10:00:00Z';
const CARD_ID = 'T1-ROUNDS-FIX';
const CARD_PATH = `specs/tasks/${CARD_ID}.md`;

function git(cwd: string, args: string[]): string {
  const r = runSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: FIXED, GIT_COMMITTER_DATE: FIXED } });
  assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const calc = (change: Record<number, string> = {}) => Array.from({ length: 30 }, (_, i) => change[i + 1] ?? `export const v${i + 1} = ${i + 1};`).join('\n') + '\n';
const cardText = renderCard({ id: CARD_ID, title: 'fix calc', allowPaths: ['src/calc.ts', CARD_PATH], dodCommand: 'npm test', acceptance: ['1. calc returns the right values'], deliverable: 'calc' });

interface Fixture {
  root: string;
  tmpRoot: string;
  base: string;
  c1: string;
  c2: string;
  cleanup: () => void;
}

/** One base commit and two candidates, each changing one line of src/calc.ts and adding the card file. */
function fixture(): Fixture {
  const dir = realpathSync.native(tmpDir('aidlc-rounds-'));
  const root = path.join(dir, 'repo');
  const tmpRoot = path.join(dir, 'tmp');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(tmpRoot);
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(path.join(root, 'src', 'calc.ts'), calc());
  writeFileSync(path.join(root, 'REVIEW.md'), '# Review policy\n\nBlock on wrong values.\n');
  writeFileSync(path.join(root, 'aidlc.config.json'), JSON.stringify({ formalReview: { command: ['reviewer', '{head}', '--schema', '{schema}', '--cwd', '{cwd}'], reviewer: 'bench-r3', shell: false }, preReview: { command: ['pre-reviewer', '{head}'], reviewer: 'bench-r2', shell: false } }));
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
  const c1 = candidate(13, 'export const v13 = 14;');
  const c2 = candidate(5, 'export const v5 = 6;');
  git(root, ['checkout', '-q', 'main']);
  return { root, tmpRoot, base, c1, c2, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

const card = { id: CARD_ID, path: CARD_PATH };
const bugCase = (fx: Fixture, id: string, candidate: string, line: number) => ({ kind: 'bug', id, candidate, base: fx.base, card, confirmed: true, confirmedBy: 't', origin: 'fixture', expected: [{ file: 'src/calc.ts', line, window: 0, class: 'dim-2' }] });
const cleanCase = (fx: Fixture, id: string, candidate: string) => ({ kind: 'clean', id, candidate, base: fx.base, card, confirmed: true, confirmedBy: 't', origin: 'fixture' });

/** Write the cases into `evals/<dirName>` and return that directory relative to the root. */
function writeCases(fx: Fixture, dirName: string, cases: Array<Record<string, unknown>>): string {
  const rel = path.join('evals', dirName);
  mkdirSync(path.join(fx.root, rel), { recursive: true });
  for (const c of cases) writeFileSync(path.join(fx.root, rel, `${String(c['id'])}.json`), JSON.stringify(c));
  return rel;
}

const verdict = (v: 'pass' | 'block', reasons: string[] = []) => ({ stdout: JSON.stringify({ verdict: v, reasons, axes: { spec: { verdict: v, reasons: [] }, standards: { verdict: 'pass', reasons: [] } } }) + '\n' });
const block = (...reasons: string[]) => verdict('block', reasons);
const NO_VERDICT: Partial<ExecReceipt> = { exitCode: 1, stdout: 'I could not finish the review.\n' };
const QUOTA: Partial<ExecReceipt> = { exitCode: 1, stderr: 'usage limit reached\n' };

/** A P1 at line 20 (a miss for the line-13 case), and the same site, dimension and lines in other words. */
const MISS = '[spec] [P1] 2 wrong value @ src/calc.ts:20: v20 is unchecked -> check it';
const MISS_REWORDED = '[spec] [P1] 2 value drift @ src/calc.ts:20: other words for the same defect -> another fix';
const HIT = '[spec] [P0] 2 wrong value @ src/calc.ts:13: v13 is 14 -> restore 13';
const P2_NEW = '[spec] [P2] 6 needless form @ src/calc.ts:7: v7 could be shorter -> shorten it';
/** Line 99 is past the end of the file, so these reasons have no identity. */
const NO_ID = '[spec] [P1] 2 wrong value @ src/calc.ts:99: past the end -> fix it';
const NO_ID_OTHER = '[spec] [P1] 2 other value @ src/calc.ts:99: another defect past the end -> fix that';

interface Call {
  args: string[];
  cwd: string;
  input: string;
}

/** The scripted reviewer: the n-th call gets the n-th reply, and a call past the list gets exit 2. */
function queued(replies: Array<Partial<ExecReceipt>>, calls: Call[]): Runner {
  return async (command, args, options = {}) => {
    calls.push({ args, cwd: options.cwd ?? '', input: options.input ?? '' });
    // Each review reports a wall time of its own (10, 20, 30 ms...), so a sum over rounds differs from one round's time.
    return scriptedRunner({ [command]: { durationMs: calls.length * 10, ...(replies[calls.length - 1] ?? { exitCode: 2 }) } })(command, args, options);
  };
}

async function runRounds(fx: Fixture, dir: string, replies: Array<Partial<ExecReceipt>>, extra: Partial<bench.ReviewBenchOptions> = {}) {
  const calls: Call[] = [];
  const report = await bench.runReviewBench({ root: fx.root, stage: 'formal', dir, runner: queued(replies, calls), tmpRoot: fx.tmpRoot, ...extra });
  return { report, calls };
}

const SECTION_HEAD = '## Found earlier in this decision\nThese defects are already reported for this candidate in this decision. Do not report them again and do not re-raise them with re:F<n>. Review the whole diff for defects they do not cover. Block only on a defect not listed here; pass when you find none.\n';
const section = (reasons: string[]) => `${SECTION_HEAD}${reasons.map((r) => `- ${JSON.stringify(r)}\n`).join('')}\n## Pre-review advisory notes`;
const roundsOf = (c: bench.BenchCaseResult | undefined) => (c as { rounds?: Array<{ outcome: string; durationMs: number; cited: number }> } | undefined)?.rounds?.map((r) => ({ outcome: r.outcome, durationMs: typeof r.durationMs, cited: r.cited }));

test('T1-BENCH-ROUNDS acceptance 1: rounds run while a block adds a new P0 or P1 reason and the found reasons reach the next prompt', async () => {
  const fx = fixture();
  try {
    const dir = writeCases(fx, 'one', [bugCase(fx, 'a-bug', fx.c1, 13)]);
    const { report, calls } = await runRounds(fx, dir, [block(MISS), block(HIT), block('[spec] [P0] 2 third @ src/calc.ts:2: v2 -> fix')], { rounds: 2 });
    assert.equal(calls.length, 2, 'round 3 is not run at --rounds 2');
    assert.equal(calls[1]!.cwd, calls[0]!.cwd, 'round 2 runs on the checkout of round 1');
    assert.ok(!calls[0]!.input.includes('## Found earlier in this decision'), 'round 1 prompts as main does');
    assert.ok(calls[1]!.input.includes(`## Prior findings\n- none (first round of this cycle)\n\n${section([MISS])}`), 'round 2 holds round 1 reason directly after Prior findings');
    const c = report.cases[0]!;
    assert.equal(c.outcome, 'hit');
    assert.deepEqual(c.matched, { reason: HIT, file: 'src/calc.ts', line: 13, severity: 'P0' });
    assert.deepEqual(c.cited, [MISS, HIT]);
    assert.deepEqual(roundsOf(c), [{ outcome: 'miss', durationMs: 'number', cited: 1 }, { outcome: 'hit', durationMs: 'number', cited: 1 }]);
    assert.deepEqual((report as { options?: unknown }).options, { rounds: 2 });
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-ROUNDS acceptance 2: no further round after a pass, after a block with only repeated or only P2 new reasons, or after no verdict', async () => {
  const fx = fixture();
  try {
    const dir = writeCases(fx, 'one', [bugCase(fx, 'a-bug', fx.c1, 13)]);
    const third = block(HIT);
    const scenarios: Array<[string, Array<Partial<ExecReceipt>>, number]> = [
      ['a pass in round 1', [verdict('pass'), block(MISS), third], 1],
      ['no verdict in round 1', [NO_VERDICT, block(MISS), third], 1],
      ['the same identity in other words', [block(MISS), block(MISS_REWORDED), third], 2],
      ['the same text with no identity', [block(NO_ID), block(` ${NO_ID} `), third], 2],
      ['other text with no identity is new', [block(NO_ID), block(NO_ID_OTHER), third], 3],
      ['a repeated P1 and a new P2 only', [block(MISS), block(MISS, P2_NEW), third], 2],
      ['a new P1 beside a new P2', [block(MISS), block(NO_ID, P2_NEW), third], 3],
      ['no verdict in round 2', [block(MISS), NO_VERDICT, third], 2],
    ];
    for (const [name, replies, expected] of scenarios) {
      const { calls } = await runRounds(fx, dir, replies, { rounds: 3 });
      assert.equal(calls.length, expected, name);
    }
    // A repeated reason is listed again: the next prompt holds every cited reason of the rounds before it.
    const reworded = await runRounds(fx, dir, [block(MISS), block(MISS_REWORDED, HIT), verdict('pass')], { rounds: 3 });
    assert.ok(reworded.calls[2]!.input.includes(section([MISS, MISS_REWORDED, HIT])));
    // A round 2 without a verdict leaves the case scored on round 1.
    const { report } = await runRounds(fx, dir, [block(MISS), NO_VERDICT], { rounds: 3 });
    assert.deepEqual([report.cases[0]!.outcome, report.cases[0]!.runStatus], ['miss', 'success']);
    assert.deepEqual(roundsOf(report.cases[0]), [{ outcome: 'miss', durationMs: 'number', cited: 1 }, { outcome: 'miss', durationMs: 'number', cited: 0 }]);
    // A quota hold in round 2 stops the rounds and holds the rest of the run.
    const two = writeCases(fx, 'two', [bugCase(fx, 'a-bug', fx.c1, 13), cleanCase(fx, 'b-clean', fx.c2)]);
    const held = await runRounds(fx, two, [block(MISS), QUOTA, verdict('pass')], { rounds: 3 });
    assert.equal(held.calls.length, 2);
    assert.equal(held.report.cases[1]!.detail, 'not reviewed: a quota hold stopped the run');

    // The working-tree reader gives no lines, and never throws, for a path it must not read.
    const tree = realpathSync.native(tmpDir('aidlc-rounds-tree-'));
    const checkout = path.join(tree, 'checkout');
    mkdirSync(path.join(checkout, 'src'), { recursive: true });
    writeFileSync(path.join(checkout, 'src', 'a.ts'), 'one\ntwo\nthree\n');
    writeFileSync(path.join(tree, 'outside.ts'), 'secret\n');
    const read = bench.checkoutLines(checkout);
    assert.deepEqual(read('src/a.ts', 2, 3), ['two', 'three']);
    const refused = ['src/a\0.ts', '../outside.ts', path.join(tree, 'outside.ts'), 'src', 'src/missing.ts'];
    let linked = false;
    try {
      symlinkSync(path.join(tree, 'outside.ts'), path.join(checkout, 'src', 'link.ts'), 'file');
      linked = true;
    } catch {
      // a Windows account without the symlink privilege cannot create the link; the other paths still run
    }
    if (linked) refused.push('src/link.ts');
    for (const file of refused) assert.equal(read(file, 1, 1), undefined, JSON.stringify(file));
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-ROUNDS acceptance 3: rounds and roundTotals score each round on the union of cited reasons, and a clean case blocked in round 2 is a false block', async () => {
  const fx = fixture();
  try {
    const dir = writeCases(fx, 'three', [bugCase(fx, 'a-hit', fx.c1, 13), bugCase(fx, 'b-miss', fx.c1, 25), cleanCase(fx, 'c-clean', fx.c2), cleanCase(fx, 'd-clean', fx.c1)]);
    // c1: round 1 misses, round 2 hits with a new P0 beside a new P2, round 3 passes. c2: round 2 repeats round 1, so no round 3.
    const replies = [block(MISS), block(HIT, P2_NEW), verdict('pass'), block(MISS), block(MISS_REWORDED)];
    const { report, calls } = await runRounds(fx, dir, replies, { rounds: 3 });
    assert.equal(calls.length, 5);
    assert.ok(calls[2]!.input.includes(section([MISS, HIT, P2_NEW])), 'round 3 holds every cited reason of rounds 1 and 2 in order');
    const byId = new Map(report.cases.map((c) => [c.id, c]));
    assert.deepEqual(report.cases.map((c) => [c.id, c.outcome]), [['a-hit', 'hit'], ['b-miss', 'miss'], ['c-clean', 'false-block'], ['d-clean', 'false-block']]);
    assert.deepEqual(byId.get('a-hit')!.cited, [MISS, HIT, P2_NEW]);
    assert.equal(byId.get('a-hit')!.matched?.reason, HIT);
    assert.deepEqual(roundsOf(byId.get('a-hit')), [{ outcome: 'miss', durationMs: 'number', cited: 1 }, { outcome: 'hit', durationMs: 'number', cited: 2 }, { outcome: 'hit', durationMs: 'number', cited: 0 }]);
    const a = byId.get('a-hit')!;
    assert.equal(a.durationMs, a.rounds!.reduce((sum, r) => sum + r.durationMs, 0), 'the case wall time is the sum over its rounds');
    assert.deepEqual(roundsOf(byId.get('d-clean'))!.map((r) => r.outcome), ['false-block', 'false-block', 'false-block'], 'a pass in round 3 leaves the false block');
    assert.deepEqual(roundsOf(byId.get('c-clean'))!.map((r) => r.outcome), ['false-block', 'false-block']);
    const totals = (hits: number, misses: number) => ({ bugCases: 2, hits, misses, recall: hits / (hits + misses), cleanCases: 2, cleanPasses: 0, falseBlocks: 2, falseBlockRate: 1, noVerdict: 0, errors: 0, skippedUnconfirmed: 0 });
    assert.deepEqual((report as { roundTotals?: unknown }).roundTotals, [totals(0, 2), totals(1, 1), totals(1, 1)], 'c-clean keeps its round 2 score in round 3');
    assert.deepEqual(report.totals, totals(1, 1));
    assert.deepEqual((report as { options?: unknown }).options, { rounds: 3 });
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-ROUNDS acceptance 4: --rounds outside 1 to 3, or above 1 with --stage pre, is refused before any review, and --rounds 1 prompts as main does', async () => {
  const fx = fixture();
  try {
    const dir = writeCases(fx, 'one', [bugCase(fx, 'a-bug', fx.c1, 13)]);
    for (const rounds of [0, 4, 1.5, Number.NaN]) {
      const calls: Call[] = [];
      await assert.rejects(bench.runReviewBench({ root: fx.root, stage: 'formal', dir, rounds, runner: queued([], calls), tmpRoot: fx.tmpRoot }), /--rounds must be an integer from 1 to 3/, String(rounds));
      assert.equal(calls.length, 0);
    }
    const calls: Call[] = [];
    await assert.rejects(bench.runReviewBench({ root: fx.root, stage: 'pre', dir, rounds: 2, runner: queued([], calls), tmpRoot: fx.tmpRoot }), /--rounds above 1 needs --stage formal/);
    assert.equal(calls.length, 0);
    const cli = (...args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), '-C', fx.root, 'review', 'bench', 'run', '--dir', dir, ...args], { encoding: 'utf8', windowsHide: true });
    for (const args of [['--stage', 'formal', '--rounds', '4'], ['--stage', 'formal', '--rounds', 'two'], ['--stage', 'pre', '--rounds', '2']]) {
      const r = cli(...args);
      assert.notEqual(r.status, 0, args.join(' '));
      assert.match(r.stderr, /--rounds (must be an integer from 1 to 3|above 1 needs --stage formal)/, args.join(' '));
    }
    assert.match(cli('--stage', 'formal', '--rounds', 'two').stderr, /--rounds must be an integer from 1 to 3, not "two"/, 'the CLI names the value it refuses');

    const one = await runRounds(fx, dir, [block(MISS), block(HIT)], { rounds: 1 });
    const plain = await runRounds(fx, dir, [block(MISS), block(HIT)]);
    assert.equal(one.calls.length, 1, '--rounds 1 reviews once even after a block with a new P1');
    assert.equal(one.calls[0]!.input, plain.calls[0]!.input, '--rounds 1 prompts as a run without --rounds');
    assert.ok(!one.calls[0]!.input.includes('## Found earlier in this decision'));
    assert.equal(roundsOf(one.report.cases[0]), undefined, 'a case of one round carries no rounds');
    assert.equal((one.report as { roundTotals?: unknown }).roundTotals, undefined);
    assert.deepEqual((plain.report as { options?: unknown }).options, { rounds: 1 });
    // An absent or empty list leaves the prompt byte for byte as it was.
    const input = { stage: 'formal' as const, includeDiff: true, reviewPolicy: 'p', card: { id: 'X', title: 't', allow_paths: ['a'], dod_command: 'd', tdd: true, acceptance: ['1. a'] } as never, base: 'b', head: 'h', changedPaths: ['a'], diff: 'd', priorFindings: [], round: 1, maxRounds: 4 };
    assert.equal(buildReviewPrompt({ ...input, foundInDecision: [] } as Parameters<typeof buildReviewPrompt>[0]), buildReviewPrompt(input));
  } finally {
    fx.cleanup();
  }
});
