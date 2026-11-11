// Card T0-TEST-TEMP-CLEANUP: a directory made by tmpDir is removed when its process exits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanup, tmpDir } from '../infra/helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const helpersUrl = pathToFileURL(path.join(root, 'tests', 'infra', 'helpers.ts')).href;

/** Runs `fn` with a new empty scratch directory (canonical path) and removes it afterwards. */
function inScratch<T>(fn: (scratch: string) => T): T {
  const scratch = realpathSync.native(tmpDir('aidlc-ttscratch-'));
  try {
    return fn(scratch);
  } finally {
    cleanup(scratch);
  }
}

function childEnv(scratch: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TEMP: scratch, TMP: scratch, TMPDIR: scratch };
  // A nested `node --test` that inherits this runner's context reports to it and exits 0 whatever its tests do.
  delete env['NODE_TEST_CONTEXT'];
  return env;
}

/** Runs `source` as an ES module in a child `node` with the temporary directory set to `scratch`. */
function runModule(scratch: string, source: string) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: root, env: childEnv(scratch), encoding: 'utf8', timeout: 120_000, windowsHide: true,
  });
  return { exit: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('a directory from tmpDir is removed when its process exits', () => {
  inScratch((scratch) => {
    const r = runModule(scratch, `
      import { mkdirSync, writeFileSync } from 'node:fs';
      import path from 'node:path';
      import { tmpDir } from ${JSON.stringify(helpersUrl)};
      const parent = path.join(${JSON.stringify(scratch)}, 'parent');
      mkdirSync(parent);
      const dir = tmpDir('aidlc-tt-', parent);
      writeFileSync(path.join(dir, 'f.txt'), 'x');
      console.log(dir);
    `);
    const dir = r.stdout.trim();
    assert.equal(r.exit, 0, r.stderr);
    assert.equal(existsSync(dir), false, `left: ${dir}`);
    assert.ok(path.basename(dir).startsWith('aidlc-tt-'), `printed: ${r.stdout}`);
    assert.equal(path.dirname(dir), path.join(scratch, 'parent'));
  });
});

test('the owner removes a directory its child used once the child is done', () => {
  inScratch((scratch) => {
    const r = runModule(scratch, `
      import { spawnSync } from 'node:child_process';
      import { tmpDir } from ${JSON.stringify(helpersUrl)};
      const dir = tmpDir('aidlc-tt-');
      const g = spawnSync(process.execPath, ['-e', "require('node:fs').writeFileSync('g.txt', String(process.cwd()))"], { cwd: dir });
      if (g.status !== 0) process.exit(3);
      console.log(dir);
    `);
    const dir = r.stdout.trim();
    assert.equal(r.exit, 0, r.stderr);
    assert.equal(existsSync(dir), false, `left: ${dir}`);
    assert.ok(path.basename(dir).startsWith('aidlc-tt-'), `printed: ${r.stdout}`);
  });
});

test('a removal that fails is reported and left, and the others are removed', () => {
  inScratch((scratch) => {
    const r = runModule(scratch, `
      import { existsSync, rmSync } from 'node:fs';
      import { tmpDir, removeTempDirs } from ${JSON.stringify(helpersUrl)};
      const dirs = [tmpDir('aidlc-tt-'), tmpDir('aidlc-tt-'), tmpDir('aidlc-tt-')];
      const busy = dirs[1];
      const left = removeTempDirs((dir) => {
        if (dir === busy) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        rmSync(dir, { recursive: true, force: true });
      });
      console.log(JSON.stringify({ busy, left, gone: dirs.map((d) => !existsSync(d)) }));
    `);
    assert.equal(r.exit, 0, r.stderr);
    const out = JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}') as { busy: string; left: string[]; gone: boolean[] };
    assert.deepEqual(out.left, [out.busy]);
    assert.deepEqual(out.gone, [true, false, true]);
    // The directory it left stays recorded, so the exit handler removes it once the remover works again.
    assert.equal(existsSync(out.busy), false, `left at exit: ${out.busy}`);
    assert.ok(r.stderr.split('\n').includes(`aidlc tests: could not remove ${out.busy} (EBUSY)`), r.stderr);
  });
});

/** Runs `node --test` on each file with the patterns in a child with an empty temporary directory; every selected test must pass and no `aidlc-*` entry may be left. */
function assertNoLeak(runs: Array<[string, string[]]>, passes: number[]): void {
  inScratch((scratch) => {
    const results = runs.map(([file, patterns]) => {
      const args = ['--test', '--test-reporter=tap', ...patterns.map((p) => `--test-name-pattern=${p}`), file];
      const r = spawnSync(process.execPath, args, { cwd: root, env: childEnv(scratch), encoding: 'utf8', timeout: 300_000, windowsHide: true });
      const count = (name: string): number => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(r.stdout ?? '')?.[1] ?? -1);
      return { file, exit: r.status, pass: count('pass'), fail: count('fail'), output: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-2000) };
    });
    const leftover = readdirSync(scratch).filter((name) => name.startsWith('aidlc-'));
    const summary = results.map(({ file, exit, pass, fail }) => ({ file, exit, fail, selectedPassed: pass > 0 }));
    assert.deepEqual(summary, runs.map(([file]) => ({ file, exit: 0, fail: 0, selectedPassed: true })), results.map((r) => r.output).join('\n'));
    assert.deepEqual(results.map((r) => r.pass), passes);
    assert.deepEqual(leftover, [], `left: ${leftover.join(', ')}`);
  });
}

test('the fixtures that leaked leave nothing in the temporary directory', () => {
  assertNoLeak([
    ['tests/surface/hooks.test.ts', ['production-gate: non-production commands pass', 'T0-HOOK-CONFIG-DISCOVERY acceptance 1', 'protect-paths reads frozenPaths from aidlc.config.json via runHook', 'T0-HOOK-CONFIG-CLOSED-3 acceptance 1:']],
    ['tests/surface/verifier.test.ts', ['Q12: intact journal']],
    ['tests/surface/pre-review.test.ts', ['buildPreReviewPrompt carries the policy', 'T1-REVIEW-FINDINGS-4 R3 decision 2', 'T0-R2-ANSWER-MARKER acceptance 1']],
    ['tests/scenarios/op-intent-dup.test.ts', ['acceptance 1: a failed OPERATION_INTENT append']],
  ], [4, 1, 3, 1]);
});

test('the line-break directory test of hooks.test.ts leaves nothing in the temporary directory', { skip: process.platform === 'win32' && 'the selected test is skipped on Windows, which does not allow a line break in a file name' }, () => {
  assertNoLeak([['tests/surface/hooks.test.ts', ['T0-HOOK-CONFIG-CLOSED-3 acceptance 4: a real directory whose name holds a line break']]], [1]);
});
