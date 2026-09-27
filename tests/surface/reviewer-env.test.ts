import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reviewerEnv, runPreReview, runReviewPanel } from '../../src/review/pre-review.ts';
import { scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';

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

/**
 * The environment of the child that runs the default-environment scenarios (reviewer-env.child.ts): a copy of `base`
 * without PYTHONUTF8 and PYTHONIOENCODING in any letter case, and without the test runner's own context, so the child is
 * a top-level run whose reviewerEnv() adds both variables whatever the developer set (T0-REVIEWER-UTF8 R3 decision 1).
 */
function childEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(base).filter(([k]) => !['PYTHONUTF8', 'PYTHONIOENCODING', 'NODE_TEST_CONTEXT'].includes(k.toUpperCase())));
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Run reviewer-env.child.ts with the environment childEnv makes of `base`; its output on failure. */
function runChild(base: NodeJS.ProcessEnv, label: string): void {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join('tests', 'surface', 'reviewer-env.child.ts')], { cwd: ROOT, env: childEnv(base), encoding: 'utf8', timeout: 300_000 });
  const output = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  assert.equal(r.status, 0, `${label}: the child passes\n${output}`);
  assert.match(output, /^# fail 0$/m, `${label}: no child test failed\n${output}`);
  // Four tests: the guard, the Windows probe (skipped elsewhere) and the two replays of issue 99.
  const windows = process.platform === 'win32';
  assert.match(output, new RegExp(`^# pass ${windows ? 4 : 3}$`, 'm'), `${label}: every child test ran\n${output}`);
  assert.match(output, new RegExp(`^# skipped ${windows ? 0 : 1}$`, 'm'), `${label}: only the probe is skipped, and only off Windows\n${output}`);
}

test('T0-REVIEWER-UTF8 acceptance 3 and 4: the default-environment scenarios run in a child with both variables removed in any letter case, from the process environment and from a user PYTHONUTF8=0 and PYTHONIOENCODING=cp1252 [R3] [R4]', () => {
  const hostile = { ...process.env, PYTHONUTF8: '0', PYTHONIOENCODING: 'cp1252', pythonioencoding: 'cp1252' };
  assert.deepEqual(Object.keys(childEnv(hostile)).filter((k) => ['PYTHONUTF8', 'PYTHONIOENCODING', 'NODE_TEST_CONTEXT'].includes(k.toUpperCase())), []);
  assert.equal(childEnv(hostile)['PATH'] ?? childEnv(hostile)['Path'], process.env['PATH'], 'every other variable is kept');
  runChild(process.env, 'from the process environment');
  runChild(hostile, 'from a user cp1252 environment');
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
