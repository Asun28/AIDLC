// Card T0-EVAL-TEST-TEMP: the eval tests remove every temporary directory they create.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup } from '../infra/helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Runs `fn` with a new empty temporary directory (canonical path) and removes that directory afterwards, also when `fn` throws. */
function inTemp<T>(fn: (temp: string) => T): T {
  // The prefix must not start with `aidlc-eval`, which the leak check looks for.
  const temp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-evtemp-')));
  try {
    return fn(temp);
  } finally {
    cleanup(temp);
  }
}

interface Run { exit: number | null; pass: number; fail: number; leftover: string[] }

/** `node --test` on `file` with one `--test-name-pattern` per pattern, TEMP, TMP and TMPDIR set to `temp`; reports the tap counts and the `aidlc-eval*` entries left in `temp`. */
function runTests(temp: string, file: string, patterns: string[]): Run & { output: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp };
  // A nested `node --test` that inherits this runner's context reports to it and exits 0 whatever its tests do.
  delete env['NODE_TEST_CONTEXT'];
  const args = ['--test', '--test-reporter=tap', ...patterns.map((p) => `--test-name-pattern=${p}`), file];
  const r = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 300_000, windowsHide: true });
  const count = (name: string): number => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(r.stdout ?? '')?.[1] ?? -1);
  const leftover = readdirSync(temp).filter((name) => name.startsWith('aidlc-eval'));
  return { exit: r.status, pass: count('pass'), fail: count('fail'), leftover, output: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-4000) };
}

test('T0-EVAL-TEST-TEMP acceptance 1: the four evals.test.ts tests that reach its mkdtempSync sites pass and leave no aidlc-eval* entry in the temporary directory [R1]', () => {
  const patterns = [
    'loadEvals reads JSON cases with defaults',
    'a file or cwd through a link that leaves the working directory',
    'the CLI refuses --trials 0',
    'with neither option, the example case',
  ];
  const { output, ...run } = inTemp((temp) => runTests(temp, 'tests/surface/evals.test.ts', patterns));
  assert.deepEqual(run, { exit: 0, pass: 4, fail: 0, leftover: [] }, `left: ${run.leftover.join(', ')}\n${output}`);
});

test('T0-EVAL-TEST-TEMP acceptance 2: the three T1-EVAL-TRANSCRIPT-2 acceptance 9 tests of command-lines.test.ts pass and leave no aidlc-eval* entry in the temporary directory [R2]', () => {
  const { output, ...run } = inTemp((temp) => runTests(temp, 'tests/surface/command-lines.test.ts', ['T1-EVAL-TRANSCRIPT-2 acceptance 9']));
  assert.deepEqual(run, { exit: 0, pass: 3, fail: 0, leftover: [] }, `left: ${run.leftover.join(', ')}\n${output}`);
});

test('T0-EVAL-TEST-TEMP acceptance 3: tests/surface/evals.test.ts calls mkdtempSync in one place only, its recording helper [R1]', () => {
  const source = readFileSync(path.join(root, 'tests', 'surface', 'evals.test.ts'), 'utf8');
  assert.equal(source.split('mkdtempSync(').length - 1, 1);
});

test('T0-EVAL-TEST-TEMP acceptance 4: the temporary directory set as TEMP is removed after its run, also when an assertion inside the run fails [R1] [R2]', () => {
  const seen: string[] = [];
  assert.throws(() => inTemp((temp) => {
    seen.push(temp);
    assert.fail('an assertion of the run fails');
  }), /an assertion of the run fails/);
  inTemp((temp) => void seen.push(temp));
  assert.deepEqual(seen.map((dir) => [dir, existsSync(dir)]), seen.map((dir) => [dir, false]));
});
