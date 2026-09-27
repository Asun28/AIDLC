import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewerEnv, runPreReview, runReviewPanel } from '../../src/review/pre-review.ts';
import { run, scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { makeFixture, writeCard } from '../scenarios/_harness.ts';

const OURS = { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
const PASS = '{"verdict":"pass","reasons":[]}\n';

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-reviewer-env-'));
  mkdirSync(path.join(dir, '.review'), { recursive: true });
  return dir;
}

test('T0-REVIEWER-UTF8 acceptance 1: reviewerEnv adds PYTHONUTF8=1 and PYTHONIOENCODING=utf-8 where the environment gives them no value, and a value the user set wins [R1]', () => {
  const base = { PATH: '/bin', HOME: '/home/u' };
  const frozen = structuredClone(base);
  for (const platform of ['win32', 'linux'] as const) {
    assert.deepEqual(reviewerEnv(base, platform), { ...base, ...OURS }, `${platform}: both added, every other key kept`);
    const user = { PATH: '/bin', PYTHONUTF8: '0', PYTHONIOENCODING: 'cp1252' };
    assert.deepEqual(reviewerEnv(user, platform), user, `${platform}: a user value wins`);
    assert.deepEqual(reviewerEnv({ PATH: '/bin', PYTHONUTF8: '', PYTHONIOENCODING: '' }, platform), { PATH: '/bin', ...OURS }, `${platform}: an empty value, which Python ignores, is replaced`);
    assert.deepEqual(reviewerEnv({ PATH: '/bin', PYTHONUTF8: undefined }, platform), { PATH: '/bin', ...OURS }, `${platform}: an undefined value is no value`);
  }
  assert.deepEqual(base, frozen, 'the input is never mutated');
  // Windows reads a variable in any letter case: a user value spelled otherwise wins, an empty one is dropped for ours.
  const cased = { Path: 'C:\\bin', PythonUtf8: '0', pythonioencoding: 'cp1252' };
  assert.deepEqual(reviewerEnv(cased, 'win32'), cased);
  assert.deepEqual(reviewerEnv({ Path: 'C:\\bin', PythonUtf8: '', pythonioencoding: '' }, 'win32'), { Path: 'C:\\bin', ...OURS });
  // Elsewhere only the exact name is the variable Python reads.
  assert.deepEqual(reviewerEnv({ PATH: '/bin', pythonutf8: '0', pythonioencoding: 'cp1252' }, 'linux'), { PATH: '/bin', pythonutf8: '0', pythonioencoding: 'cp1252', ...OURS });
  assert.deepEqual(reviewerEnv(), reviewerEnv(process.env, process.platform), 'the defaults are the process environment and platform');
  // The default platform is the process's own: on Windows a spelling in another case is the user's value.
  const lower = { Path: 'C:\\bin', pythonutf8: '0' };
  assert.deepEqual(reviewerEnv(lower), reviewerEnv(lower, process.platform));
  if (process.platform === 'win32') assert.equal(reviewerEnv(lower)['PYTHONUTF8'], undefined, 'on Windows the lower-case spelling is the user value');
  // Each variable is decided on its own: a user PYTHONUTF8=0 alone still gets PYTHONIOENCODING=utf-8, which sets the
  // reviewer's stdin encoding (the R2 cycle 0 round 1 advisory).
  for (const platform of ['win32', 'linux'] as const) {
    assert.deepEqual(reviewerEnv({ PATH: '/bin', PYTHONUTF8: '0' }, platform), { PATH: '/bin', PYTHONUTF8: '0', PYTHONIOENCODING: 'utf-8' }, `${platform}: PYTHONUTF8=0 alone`);
  }
});

test('T0-REVIEWER-UTF8 acceptance 2: runPreReview and every angle of runReviewPanel spawn the reviewer with reviewerEnv() [R2]', async () => {
  const dir = tempDir();
  try {
    const envs: Array<[string, NodeJS.ProcessEnv | undefined]> = [];
    const script = scriptedRunner({ 'fake-reviewer': { stdout: PASS } });
    const recording: SyncRunner = (command, args, options) => {
      envs.push([args.join(' '), options?.env]);
      return script(command, args, options);
    };
    const common = { cwd: dir, timeoutMs: 1000, shell: false, reviewDir: path.join(dir, '.review'), head: 'abc123', reviewer: 'fake' };
    runPreReview({ ...common, runner: recording, command: ['fake-reviewer', '--stdin'], prompt: 'P', fileStem: 'T0-RU.pre.0.1' });
    runPreReview({ ...common, runner: recording, command: ['fake-reviewer', '{instructions}'], prompt: 'argv', fileStem: 'T0-RU.pre.0.2' });
    await runReviewPanel({ ...common, runner: async (c, a, o) => recording(c, a, o), command: ['fake-reviewer', '--focus', '{perspective}'], perspectives: ['bugs', 'security', 'compliance'], promptFor: (p) => `P ${p}`, vars: {}, fileStem: 'T0-RU.pre.0.3' });
    const expected = reviewerEnv();
    assert.deepEqual(envs.map(([key]) => key).sort(), ['--focus bugs', '--focus compliance', '--focus security', '--stdin', 'argv'].sort());
    for (const [key, env] of envs) assert.deepEqual(env, expected, `${key}: the reviewer environment`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T0-REVIEWER-UTF8 acceptance 3: on Windows a Python probe spawned through runReviewPanel with the real runner reads ✖ 码 再 运 intact and reports utf-8 [R3]', { skip: process.platform !== 'win32' ? 'Windows only: the code-page decoding of issue 99 is Windows behaviour' : false }, async () => {
  const dir = tempDir();
  try {
    const probe = path.join(dir, 'probe.py');
    writeFileSync(probe, ['import json, sys', 'text = sys.stdin.read()', 'print(json.dumps({"encoding": sys.stdin.encoding, "read": text}))', `print(json.dumps({"verdict": "pass", "reasons": []}))`, ''].join('\n'), 'utf8');
    const panel = await runReviewPanel({ runner: run, command: ['python', probe], perspectives: [], promptFor: () => 'PROMPT ✖ 码 再 运', vars: {}, cwd: dir, timeoutMs: 60_000, reviewDir: path.join(dir, '.review'), fileStem: 'T0-RU.pre.0.4', head: 'abc123', reviewer: 'probe' });
    assert.equal(panel.outcome, 'pass', JSON.stringify(panel.reasons));
    const line = readFileSync(panel.logRef!, 'utf8').split(/\r?\n/).find((l) => l.startsWith('{"encoding"'));
    assert.ok(line, 'the probe printed what it read');
    const seen = JSON.parse(line) as { encoding: string; read: string };
    assert.equal(seen.encoding.toLowerCase().replace('_', '-'), 'utf-8', 'the probe reads its stdin as UTF-8');
    assert.equal(seen.read.trim(), 'PROMPT ✖ 码 再 运', 'every character arrives intact');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The UTF-8 bytes the Windows ANSI code page (cp1252) leaves undefined: `surrogateescape` turns each into a lone surrogate. */
const UNDEFINED_IN_CP1252 = new Set([0x81, 0x8d, 0x8f, 0x90, 0x9d]);
/** The stderr of every angle of R2 round 1 of T0-SHIP-FAILING-LINE (candidate a1efe1a), issue 99. */
const ISSUE_99 = 'ERROR 400: Failed to parse the request body as JSON: messages[0].content: lone leading surrogate in hex escape at line 1 column 31249\n';

/** Python's UTF-8 mode as the child sees its environment. */
function utf8Mode(env: NodeJS.ProcessEnv | undefined): boolean {
  const get = (name: string) => Object.entries(env ?? {}).find(([k]) => k.toUpperCase() === name)?.[1];
  return get('PYTHONUTF8') === '1' || /^utf-?8$/i.test(get('PYTHONIOENCODING') ?? '');
}

/** A reviewer that reads its piped prompt as the DeepSeek CLI does: without UTF-8 mode, a lone surrogate the API refuses. */
function pythonLikeReviewer(command: string): SyncRunner {
  return (cmd, args, options = {}) => {
    if (cmd !== command) return scriptedRunner({})(cmd, args, options);
    const refused = !utf8Mode(options.env) && [...Buffer.from(options.input ?? '', 'utf8')].some((b) => UNDEFINED_IN_CP1252.has(b));
    return scriptedRunner({ [command]: refused ? { exitCode: 1, stderr: ISSUE_99 } : { stdout: PASS } })(cmd, args, options);
  };
}

test('T0-REVIEWER-UTF8 acceptance 4: the receipt shape of issue 99 is a no-verdict; the replaying reviewer refuses a prompt without the reviewer environment and passes with it [R4]', () => {
  const dir = tempDir();
  try {
    const common = { cwd: dir, timeoutMs: 1000, shell: false, reviewDir: path.join(dir, '.review'), head: 'abc123', reviewer: 'deepseek' };
    const shape = runPreReview({ ...common, runner: scriptedRunner({ 'py-reviewer': { exitCode: 1, stderr: ISSUE_99 } }), command: ['py-reviewer'], prompt: 'P', fileStem: 'T0-RU.pre.0.5' });
    assert.deepEqual([shape.outcome, shape.runStatus], ['no-verdict', 'tool_error']);
    const reviewer = pythonLikeReviewer('py-reviewer');
    const prompt = 'DoD 未通过（退出码 1）。修绿再 ship。 运行: node --test';
    assert.equal(reviewer('py-reviewer', [], { input: prompt }).stderr, ISSUE_99, 'the replay refuses the prompt without UTF-8 mode');
    assert.equal(reviewer('py-reviewer', [], { input: prompt, env: { PYTHONUTF8: '0' } }).stderr, ISSUE_99, 'and with UTF-8 mode off');
    assert.equal(reviewer('py-reviewer', [], { input: 'ascii only' }).exitCode, 0, 'an ASCII prompt never carries such a byte');
    const passed = runPreReview({ ...common, runner: reviewer, command: ['py-reviewer'], prompt, fileStem: 'T0-RU.pre.0.6' });
    assert.equal(passed.outcome, 'pass', 'spawned with the reviewer environment, the same prompt passes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('T0-REVIEWER-UTF8 acceptance 4: through the card runner an R2 round on a diff carrying 码 再 运 passes with the replaying reviewer [R4]', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['py-reviewer'], reviewer: 'deepseek', rounds: 2, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const git = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t0-ru.ts\u0000' },
      'git diff': { stdout: 'diff --git a/src/t0-ru.ts b/src/t0-ru.ts\n@@ -1 +1 @@\n-export const dod = 0;\n+export const dod = "DoD 未通过（退出码 1）。修绿再 ship。 运行";\n' },
    });
    const reviewer = pythonLikeReviewer('py-reviewer');
    const runner: SyncRunner = (command, args, options) => (command === 'py-reviewer' ? reviewer : git)(command, args, options);
    const cards = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner });
    writeCard(fx, { id: 'T0-RU', title: 'a diff with CJK text', allowPaths: ['src/t0-ru.ts'] });
    const goal = fx.controller.createGoal({ text: 'implement T0-RU', source: 'card', ref: 'T0-RU', affectedSurfaces: [] }, { cards: ['T0-RU'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T0-RU'] } });
    const card = fx.card('T0-RU');
    const r = cards.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T0-RU'));
    const run = cards.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: 'sha-1' });
    const gate = cards.next(fx.goal(goal.id), card, run);
    assert.equal(gate.directive.kind, 'pre-review', gate.directive.narration);
    const reviewed = await cards.preReview(fx.goal(goal.id), card, gate.run);
    assert.equal(reviewed.result.outcome, 'pass', JSON.stringify(reviewed.result.reasons));
    assert.deepEqual(reviewed.run.preReview.rounds.map((round) => [round.reviewer, round.outcome]), [['deepseek', 'pass']]);
  } finally {
    fx.cleanup();
  }
});

/** The sentences card T0-REVIEWER-UTF8 adds to docs/OPERATIONS.md, after the pre-review command paragraph. */
const DOC_SENTENCES = [
  'Every reviewer process, R2 and R3, their fallbacks and the base-sync reviewer, runs with the process environment plus `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8`, each only when the environment gives that variable no non-empty value (on Windows in any letter case), so a Python reviewer reads the prompt piped to it as UTF-8 (card T0-REVIEWER-UTF8, issue 99).',
  'Without them Python on Windows decodes a piped stdin with the ANSI code page: every non-ASCII character reaches the reviewer garbled, and a UTF-8 byte the code page leaves undefined becomes a lone surrogate the API refuses, a round with no verdict.',
  "A value the user set wins for that variable, so a `PYTHONIOENCODING` naming another encoding keeps that failure (a user `PYTHONUTF8=0` alone does not, since the added `PYTHONIOENCODING=utf-8` still sets the reviewer's stdin encoding); a reviewer that is not Python, such as `claude` or `codex`, ignores both variables.",
];
const CHANGELOG_SENTENCE =
  '- Reviewer UTF-8, card T0-REVIEWER-UTF8 (issue 99): every reviewer process runs with `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` unless the environment sets them, so the DeepSeek reviewer on Windows reads its piped prompt as UTF-8; a prompt with non-ASCII text used to reach it garbled, and one whose UTF-8 bytes the code page leaves undefined got no verdict on every angle.';

test('T0-REVIEWER-UTF8 acceptance 5: docs/OPERATIONS.md and the CHANGELOG Unreleased section state the rule and its limit [R5]', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  for (const sentence of DOC_SENTENCES) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  assert.ok(unreleased.includes(CHANGELOG_SENTENCE), `CHANGELOG.md Unreleased states: ${CHANGELOG_SENTENCE}`);
});
