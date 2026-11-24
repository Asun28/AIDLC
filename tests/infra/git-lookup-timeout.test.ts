/**
 * The repository lookup's git call (card T0-DOCTOR-PROBE-TIMEOUT, issue 371): a git that does not exit is ended at the
 * bound and the lookup throws an error that names the command, the bound and the directory.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { GIT_LOOKUP_TIMEOUT_MS, gitOut } from '../../src/state/paths.ts';

const cwd = process.cwd();

/** A spawner whose result is fixed, recording the options it was given. */
function recorder(result: Partial<ReturnType<typeof spawnSync>>, seen: SpawnSyncOptions[]): typeof spawnSync {
  return ((_command: string, _args: readonly string[], options: SpawnSyncOptions) => {
    seen.push(options);
    return { pid: 1, output: [], stdout: '', stderr: '', status: null, signal: null, ...result };
  }) as unknown as typeof spawnSync;
}

describe('gitOut (card T0-DOCTOR-PROBE-TIMEOUT)', () => {
  test('acceptance 3: a git that never exits is ended at the bound and the lookup throws', { timeout: 20_000 }, () => {
    const hanging = ((_command: string, _args: readonly string[], options: SpawnSyncOptions) =>
      // A call given no bound (the rule of main) still ends the child at 10 s, so that rule fails the assertion, not the run.
      spawnSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { ...options, timeout: options.timeout ?? 10_000 })) as unknown as typeof spawnSync;
    const started = Date.now();
    assert.throws(
      () => gitOut(['rev-parse', '--show-toplevel'], cwd, hanging, 500),
      (err: unknown) => err instanceof Error && err.message === `git rev-parse --show-toplevel did not exit within 500 ms in ${cwd}`,
    );
    assert.ok(Date.now() - started < 15_000, 'the call ends within 15 s');
  });

  test('acceptance 3: the default bound, the options of main and the other results', () => {
    assert.equal(GIT_LOOKUP_TIMEOUT_MS, 120_000);
    const seen: SpawnSyncOptions[] = [];
    assert.equal(gitOut(['rev-parse', '--show-toplevel'], cwd, recorder({ status: 0, stdout: '  /repo\n' }, seen)), '/repo');
    assert.deepEqual(seen, [{ cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000 }]);
    assert.equal(gitOut(['rev-parse'], cwd, recorder({ status: 1, stdout: 'x' }, seen)), undefined);
    const enoent = Object.assign(new Error('spawnSync git ENOENT'), { code: 'ENOENT' });
    assert.equal(gitOut(['rev-parse'], cwd, recorder({ status: null, error: enoent }, seen)), undefined);
  });
});
