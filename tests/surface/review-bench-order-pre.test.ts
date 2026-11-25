import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as bench from '../../src/review/bench.ts';
import { renderCard } from '../../src/artifacts/card.ts';
import { COVERAGE_CONTRACT, VERDICT_CONTRACT, VERDICT_SCHEMA } from '../../src/review/pre-review.ts';
import { runSync, scriptedRunner, type ExecReceipt, type Runner } from '../../src/probes/exec.ts';
import { tmpDir } from '../infra/helpers.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const FIXED = '2026-11-16T10:00:00Z';
const CARD_ID = 'T1-ORDER-FIX';
const CARD_PATH = `specs/tasks/${CARD_ID}.md`;

function git(cwd: string, args: string[]): string {
  const r = runSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: FIXED, GIT_COMMITTER_DATE: FIXED } });
  assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const calc = (change: Record<number, string> = {}) => Array.from({ length: 30 }, (_, i) => change[i + 1] ?? `export const v${i + 1} = ${i + 1};`).join('\n') + '\n';
const cardText = renderCard({ id: CARD_ID, title: 'fix calc', allowPaths: ['src/calc.ts', CARD_PATH], dodCommand: 'npm test', acceptance: ['1. calc returns the right values', '2. calc stays exported'], deliverable: 'calc' });

const FORMAL = { command: ['reviewer', '{head}', '--schema', '{schema}'], reviewer: 'bench-r3', shell: false };
/** R2 off, as in this repository: an empty command, with the angles, rounds, coverage, marker and timeout a pre-command keeps or falls back to. */
const PRE_OFF = { command: [], reviewer: 'cfg-r2', shell: false, perspectives: ['bugs', 'ac-coverage'], rounds: 3, coverage: 'shadow', answerMarker: '=== answer ===', timeoutMs: 7654 };

interface Fixture {
  root: string;
  tmpRoot: string;
  dir: string;
  candidate: string;
  cleanup: () => void;
}

/** One base commit and one candidate changing line 13 of src/calc.ts, with one confirmed bug case at that line. */
function fixture(preReview: Record<string, unknown> = PRE_OFF): Fixture {
  const tmp = tmpDir('aidlc-order-pre-');
  const root = path.join(tmp, 'repo');
  const tmpRoot = path.join(tmp, 'tmp');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(tmpRoot);
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(path.join(root, 'src', 'calc.ts'), calc());
  writeFileSync(path.join(root, 'REVIEW.md'), '# Review policy\n\nBlock on wrong values.\n');
  writeFileSync(path.join(root, 'aidlc.config.json'), JSON.stringify({ formalReview: FORMAL, preReview }, null, 2) + '\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', '--detach', base]);
  writeFileSync(path.join(root, 'src', 'calc.ts'), calc({ 13: 'export const v13 = 14;' }));
  mkdirSync(path.join(root, 'specs', 'tasks'), { recursive: true });
  writeFileSync(path.join(root, CARD_PATH), cardText);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change line 13']);
  const candidate = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'main']);
  const dir = path.join('evals', 'cases');
  mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, dir, 'a-bug.json'), JSON.stringify({ kind: 'bug', id: 'a-bug', candidate, base, card: { id: CARD_ID, path: CARD_PATH }, confirmed: true, confirmedBy: 't', origin: 'fixture', expected: [{ file: 'src/calc.ts', line: 13, window: 0, class: 'dim-2' }] }));
  return { root, tmpRoot, dir, candidate, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

const HIT = '[spec] [P0] 2 wrong value @ src/calc.ts:13: v13 is 14 -> restore 13';
const BLOCK_JSON = JSON.stringify({ verdict: 'block', reasons: [HIT], axes: { spec: { verdict: 'block', reasons: [] }, standards: { verdict: 'pass', reasons: [] } } });

interface Call {
  command: string;
  args: string[];
  input: string;
  timeoutMs?: number;
}

/** Every call gets the same reply. */
function replying(reply: Partial<ExecReceipt>, calls: Call[]): Runner {
  return async (command, args, options = {}) => {
    calls.push({ command, args, input: options.input ?? '', timeoutMs: options.timeoutMs });
    return scriptedRunner({ [command]: reply })(command, args, options);
  };
}

async function runBench(fx: Fixture, stage: 'pre' | 'formal', extra: Record<string, unknown> = {}, reply: Partial<ExecReceipt> = { stdout: `${BLOCK_JSON}\n` }) {
  const calls: Call[] = [];
  const report = await bench.runReviewBench({ root: fx.root, stage, dir: fx.dir, runner: replying(reply, calls), tmpRoot: fx.tmpRoot, ...extra } as bench.ReviewBenchOptions);
  return { report, calls };
}

/** The contract line with the reasons and axes before the verdict, written out as R2 states it. */
const ANALYSIS_FIRST_CONTRACT =
  '{"reasons":["[spec|standards] [P0|P1|P2] <dimension> @ <file:line>: <why> -> <fix>"],"axes":{"spec":{"verdict":"pass|block","reasons":[]},"standards":{"verdict":"pass|block","reasons":[]}},"verdict":"pass|block"}';
const REASONS_FIRST = 'Write the reasons before the verdict.';
const MAIN_SCHEMA_TEXT = JSON.stringify(VERDICT_SCHEMA, null, 2) + '\n';
const schemaArg = (c: Call) => c.args[c.args.indexOf('--schema') + 1]!;
const optionsOf = (r: unknown) => (r as { options?: unknown }).options;

test('T1-BENCH-ORDER-PRE acceptance 1: analysis-first writes the schema and contract with reasons before verdict, and the default writes them as on main', async () => {
  const fx = fixture({ command: ['pre-reviewer', '{head}'], reviewer: 'bench-r2', shell: false });
  try {
    const plain = await runBench(fx, 'formal');
    const first = await runBench(fx, 'formal', { order: 'verdict-first' });
    const analysis = await runBench(fx, 'formal', { order: 'analysis-first' });
    for (const run of [plain, first, analysis]) assert.equal(run.calls.length, 1);

    // The default: the schema file and contract of main, byte for byte.
    const plainSchema = schemaArg(plain.calls[0]!);
    assert.equal(path.basename(plainSchema), 'verdict.schema.json');
    assert.equal(readFileSync(plainSchema, 'utf8'), MAIN_SCHEMA_TEXT);
    assert.ok(plain.calls[0]!.input.split('\n').includes(VERDICT_CONTRACT));
    assert.ok(!plain.calls[0]!.input.includes(REASONS_FIRST));
    assert.equal(first.calls[0]!.input, plain.calls[0]!.input, '--order verdict-first prompts as a run without --order');
    assert.equal(schemaArg(first.calls[0]!), plainSchema);
    assert.equal(plain.report.cases[0]!.outcome, 'hit');
    assert.equal(first.report.cases[0]!.outcome, 'hit');

    // analysis-first: its own schema file through {schema}, reasons and axes before verdict in properties and required.
    const analysisSchema = schemaArg(analysis.calls[0]!);
    assert.equal(path.basename(analysisSchema), 'verdict.schema.analysis-first.json');
    const parsed = JSON.parse(readFileSync(analysisSchema, 'utf8')) as typeof VERDICT_SCHEMA;
    assert.deepEqual(Object.keys(parsed.properties), ['reasons', 'axes', 'verdict']);
    assert.deepEqual(parsed.required, ['reasons', 'axes', 'verdict']);
    assert.deepEqual(Object.keys(parsed), ['type', 'properties', 'required', 'additionalProperties']);
    // deepEqual ignores key order but not array order, so `required` is compared as a set.
    const asSet = (s: { required: readonly string[] }) => ({ ...s, required: [...s.required].sort() });
    assert.deepEqual(asSet(parsed), asSet(VERDICT_SCHEMA) as unknown, 'the reordered schema accepts the same documents');
    assert.equal(readFileSync(plainSchema, 'utf8'), MAIN_SCHEMA_TEXT, 'the default schema file keeps its bytes');
    // The contract line moves the verdict last and is followed by the added sentence; the rest of the prompt is unchanged.
    assert.equal(analysis.calls[0]!.input, plain.calls[0]!.input.replace(`\n${VERDICT_CONTRACT}\n`, `\n${ANALYSIS_FIRST_CONTRACT}\n${REASONS_FIRST}\n`));
    assert.notEqual(analysis.calls[0]!.input, plain.calls[0]!.input);
    assert.equal(analysis.report.cases[0]!.outcome, 'hit');

    // The pre stage accepts it too.
    const prePlain = await runBench(fx, 'pre');
    const preAnalysis = await runBench(fx, 'pre', { order: 'analysis-first' });
    assert.equal(preAnalysis.calls[0]!.input, prePlain.calls[0]!.input.replace(`\n${VERDICT_CONTRACT}\n`, `\n${ANALYSIS_FIRST_CONTRACT}\n${REASONS_FIRST}\n`));
    assert.notEqual(preAnalysis.calls[0]!.input, prePlain.calls[0]!.input);

    assert.deepEqual(optionsOf(plain.report), { rounds: 1, order: 'verdict-first', preCommand: null });
    assert.deepEqual(optionsOf(analysis.report), { rounds: 1, order: 'analysis-first', preCommand: null });
    assert.deepEqual(optionsOf(preAnalysis.report), { rounds: 1, order: 'analysis-first', preCommand: null });
    assert.equal(plain.report.reviewer, 'bench-r3');

    // The CLI passes --order through: a run that selects no case reviews nothing and still reports its options.
    mkdirSync(path.join(fx.root, 'evals', 'empty'));
    const cli = spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), '-C', fx.root, 'review', 'bench', 'run', '--dir', path.join('evals', 'empty'), '--stage', 'formal', '--order', 'analysis-first', '--json'], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr);
    assert.deepEqual(optionsOf(JSON.parse(cli.stdout)), { rounds: 1, order: 'analysis-first', preCommand: null });
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-ORDER-PRE acceptance 2: --pre-command runs R2 with the given argv and reviewer while preReview.command is empty and writes no configuration', async () => {
  const fx = fixture();
  try {
    const configBefore = readFileSync(path.join(fx.root, 'aidlc.config.json'));
    // Without --pre-command the empty preReview.command still refuses the run.
    await assert.rejects(runBench(fx, 'pre'), /preReview\.command is not configured/);

    mkdirSync(path.join(fx.root, 'bench'));
    const own = { command: ['deepseek', '--model', 'v4', '{head}'], reviewer: 'ds-r2', answerMarker: '', timeoutMs: 4321 };
    writeFileSync(path.join(fx.root, 'bench', 'own.json'), JSON.stringify(own));
    writeFileSync(path.join(fx.root, 'bench', 'kept.json'), JSON.stringify({ command: ['deepseek', '{head}'], reviewer: 'ds-kept' }));
    writeFileSync(path.join(fx.root, 'bench', 'small.json'), JSON.stringify({ command: ['deepseek', '{head}'], reviewer: 'ds-small', maxDiffBytes: 10 }));
    const fileBytes = ['own', 'kept', 'small'].map((n) => readFileSync(path.join(fx.root, 'bench', `${n}.json`)));
    // A verdict line, then the marker and no JSON: read whole it is a block, read after the marker it is no verdict.
    const reply = { stdout: `${BLOCK_JSON}\n=== answer ===\nno more to say\n` };

    const ownRun = await runBench(fx, 'pre', { preCommand: path.join('bench', 'own.json') }, reply);
    assert.equal(ownRun.calls.length, 2, "preReview's two perspectives each run once");
    for (const call of ownRun.calls) {
      assert.equal(call.command, 'deepseek');
      assert.deepEqual(call.args, ['--model', 'v4', fx.candidate]);
      assert.equal(call.timeoutMs, 4321, "the file's timeoutMs");
      assert.match(call.input, /round 1 of 3\./, "preReview's rounds");
    }
    assert.equal(ownRun.calls.filter((c) => c.input.includes(COVERAGE_CONTRACT)).length, 1, "preReview's coverage reaches its ac-coverage angle");
    assert.equal(ownRun.report.cases[0]!.outcome, 'hit', "the file's empty answerMarker reads the whole reply");
    assert.equal(ownRun.report.reviewer, 'ds-r2');
    assert.equal(ownRun.report.stage, 'pre');
    assert.deepEqual(optionsOf(ownRun.report), { rounds: 1, order: 'verdict-first', preCommand: own.command });

    // Keys the file leaves out fall back to preReview's.
    const keptRun = await runBench(fx, 'pre', { preCommand: path.join('bench', 'kept.json') }, reply);
    assert.equal(keptRun.calls.length, 2);
    for (const call of keptRun.calls) assert.equal(call.timeoutMs, 7654, "preReview's timeoutMs");
    assert.equal(keptRun.report.cases[0]!.outcome, 'no-verdict', "preReview's answerMarker");
    assert.equal(keptRun.report.reviewer, 'ds-kept');
    assert.deepEqual(optionsOf(keptRun.report), { rounds: 1, order: 'verdict-first', preCommand: ['deepseek', '{head}'] });

    const smallRun = await runBench(fx, 'pre', { preCommand: path.join('bench', 'small.json') }, reply);
    assert.equal(smallRun.calls.length, 0, "the file's maxDiffBytes refuses the diff");
    assert.equal(smallRun.report.cases[0]!.outcome, 'error');
    assert.match(smallRun.report.cases[0]!.detail ?? '', /\(10\)/);

    // An absolute path is used as given.
    const absolute = await runBench(fx, 'pre', { preCommand: path.join(fx.root, 'bench', 'own.json') }, reply);
    assert.equal(absolute.report.reviewer, 'ds-r2');

    // The CLI passes --pre-command through: a run that selects no case reviews nothing and still reports its options and reviewer.
    mkdirSync(path.join(fx.root, 'evals', 'empty'));
    const cli = spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), '-C', fx.root, 'review', 'bench', 'run', '--dir', path.join('evals', 'empty'), '--stage', 'pre', '--pre-command', path.join('bench', 'own.json'), '--json'], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr);
    const cliReport = JSON.parse(cli.stdout) as bench.ReviewBenchReport;
    assert.deepEqual(optionsOf(cliReport), { rounds: 1, order: 'verdict-first', preCommand: own.command });
    assert.equal(cliReport.reviewer, 'ds-r2');

    assert.deepEqual(readFileSync(path.join(fx.root, 'aidlc.config.json')), configBefore, 'aidlc.config.json is byte-identical after the runs');
    assert.deepEqual(['own', 'kept', 'small'].map((n) => readFileSync(path.join(fx.root, 'bench', `${n}.json`))), fileBytes, 'the pre-command files keep their bytes');
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-ORDER-PRE acceptance 3: a missing or malformed --pre-command file, --pre-command with --stage formal, and an unknown --order are refused before any review', async () => {
  const fx = fixture();
  try {
    mkdirSync(path.join(fx.root, 'bench'));
    const good = path.join('bench', 'good.json');
    writeFileSync(path.join(fx.root, good), JSON.stringify({ command: ['deepseek', '{head}'], reviewer: 'ds-r2' }));
    const malformed: Record<string, string> = {
      'not-json.json': '{"command": [',
      'array.json': JSON.stringify([]),
      'no-command.json': JSON.stringify({ reviewer: 'ds' }),
      'empty-command.json': JSON.stringify({ command: [], reviewer: 'ds' }),
      'blank-arg.json': JSON.stringify({ command: ['deepseek', ' '], reviewer: 'ds' }),
      'no-reviewer.json': JSON.stringify({ command: ['deepseek'] }),
      'blank-reviewer.json': JSON.stringify({ command: ['deepseek'], reviewer: '  ' }),
      'bad-timeout.json': JSON.stringify({ command: ['deepseek'], reviewer: 'ds', timeoutMs: 0 }),
      'bad-diff.json': JSON.stringify({ command: ['deepseek'], reviewer: 'ds', maxDiffBytes: 1.5 }),
      'bad-marker.json': JSON.stringify({ command: ['deepseek'], reviewer: 'ds', answerMarker: 7 }),
      'unknown-key.json': JSON.stringify({ command: ['deepseek'], reviewer: 'ds', shell: true }),
    };
    for (const [name, text] of Object.entries(malformed)) writeFileSync(path.join(fx.root, 'bench', name), text);

    const refused = async (stage: 'pre' | 'formal', extra: Record<string, unknown>, pattern: RegExp) => {
      const calls: Call[] = [];
      await assert.rejects(bench.runReviewBench({ root: fx.root, stage, dir: fx.dir, runner: replying({ stdout: `${BLOCK_JSON}\n` }, calls), tmpRoot: fx.tmpRoot, ...extra } as bench.ReviewBenchOptions), pattern, JSON.stringify(extra));
      assert.equal(calls.length, 0, `no review: ${JSON.stringify(extra)}`);
    };
    await refused('pre', { preCommand: path.join('bench', 'absent.json') }, /--pre-command .*absent\.json: no such file/);
    for (const name of Object.keys(malformed)) await refused('pre', { preCommand: path.join('bench', name) }, new RegExp(`--pre-command .*${name.replace('.', '\\.')}`));
    await refused('formal', { preCommand: good }, /--pre-command needs --stage pre/);
    await refused('pre', { order: 'reasons-first' }, /--order must be verdict-first or analysis-first, not reasons-first/);
    await refused('formal', { order: '' }, /--order must be verdict-first or analysis-first/);

    const cli = (...args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), '-C', fx.root, 'review', 'bench', 'run', '--dir', fx.dir, ...args], { encoding: 'utf8', windowsHide: true });
    const order = cli('--stage', 'formal', '--order', 'reasons-first');
    assert.notEqual(order.status, 0);
    assert.match(order.stderr, /--order must be verdict-first or analysis-first, not reasons-first/);
    const formal = cli('--stage', 'formal', '--pre-command', good);
    assert.notEqual(formal.status, 0);
    assert.match(formal.stderr, /--pre-command needs --stage pre/);
    const absent = cli('--stage', 'pre', '--pre-command', path.join('bench', 'absent.json'));
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /--pre-command .*absent\.json/);
  } finally {
    fx.cleanup();
  }
});
