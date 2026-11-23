/**
 * The hook entry's early repository lookup (card T0-PREFETCH-TIMEOUT, issue 456): a git that does not exit is ended at the
 * bound of the synchronous lookup, and the lookup settles as not answered, so `resolveRepoIdentity` asks git itself.
 */
import { describe, test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  canonical,
  prefetchRepoIdentity,
  resetRepoIdentityForTests,
  resolveRepoIdentity,
  settleRepoIdentity,
  shortKey,
  type RepoIdentity,
} from '../../src/state/paths.ts';
import { tmpDir } from './helpers.ts';

// Taken before any test mocks the timers, so the seam's own bound runs on the real clock.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;

interface Call {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

/**
 * A spawner that runs the node binary with a script that never exits, with the options it receives. It ends that child
 * itself at 10 s, so a lookup with no bound (the rule of main) fails the assertions, not the run.
 */
function hanging(children: ChildProcess[], calls: Call[] = []): typeof spawn {
  return ((command: string, args: readonly string[], options: SpawnOptions) => {
    calls.push({ command, args, options });
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options);
    const fallback = realSetTimeout(() => child.kill(), 10_000);
    child.on('exit', () => realClearTimeout(fallback));
    children.push(child);
    return child;
  }) as unknown as typeof spawn;
}

/** A spawner that runs the real command with the options it receives. */
function passthrough(children: ChildProcess[]): typeof spawn {
  return ((command: string, args: readonly string[], options: SpawnOptions) => {
    const child = spawn(command, args, options);
    children.push(child);
    return child;
  }) as unknown as typeof spawn;
}

function exited(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

/**
 * A fresh git repository under the temp directory, made through `tmpDir`, which registers its removal. After `body`, every child a spawner started there is ended and has
 * exited before the directory is removed, so a failed assertion is not hidden by a busy directory.
 */
async function withRepo(body: (dir: string, expected: RepoIdentity, children: ChildProcess[]) => Promise<void>): Promise<void> {
  const dir = tmpDir('aidlc-prefetch-timeout-');
  const children: ChildProcess[] = [];
  try {
    const init = spawnSync('git', ['init', '-q'], { cwd: dir, encoding: 'utf8', windowsHide: true });
    assert.equal(init.status, 0, init.stderr);
    const root = canonical(dir);
    await body(dir, { mainRoot: root, worktreeRoot: root, isGit: true, key: shortKey(root) }, children);
  } finally {
    resetRepoIdentityForTests();
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await exited(child);
    }
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

describe('prefetchRepoIdentity bound (card T0-PREFETCH-TIMEOUT)', () => {
  test('acceptance 1: a git that never exits is ended at the bound and the lookup is not answered', { timeout: 20_000 }, async () => {
    await withRepo(async (dir, expected, children) => {
      resetRepoIdentityForTests();
      const started = performance.now();
      prefetchRepoIdentity(dir, hanging(children), 500);
      await settleRepoIdentity(dir);
      const elapsed = performance.now() - started;
      assert.equal(children.length, 1);
      await exited(children[0]!);
      assert.ok(elapsed < 9_000, `settled after ${Math.round(elapsed)} ms, not at the 500 ms bound`);
      assert.deepEqual(resolveRepoIdentity(dir), expected);
    });
  });

  test('acceptance 2: the default bound is GIT_LOOKUP_TIMEOUT_MS, with the arguments and options of main', { timeout: 20_000 }, async () => {
    await withRepo(async (dir, expected, children) => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        resetRepoIdentityForTests();
        const calls: Call[] = [];
        prefetchRepoIdentity(dir, hanging(children, calls));
        assert.deepEqual(calls, [{ command: 'git', args: ['rev-parse', '--git-common-dir', '--show-toplevel'], options: { cwd: dir, windowsHide: true } }]);
        const kill = mock.method(children[0]!, 'kill');
        mock.timers.tick(119_999);
        assert.equal(kill.mock.callCount(), 0, 'not ended before 120000 ms');
        mock.timers.tick(1);
        assert.equal(kill.mock.callCount(), 1, 'ended at 120000 ms');
        await settleRepoIdentity(dir);
      } finally {
        mock.timers.reset();
      }
      await exited(children[0]!);
      assert.deepEqual(resolveRepoIdentity(dir), expected);
    });
  });

  test('acceptance 3: an answered lookup is cached and its child is never ended by the bound', { timeout: 20_000 }, async () => {
    await withRepo(async (dir, expected, children) => {
      mock.timers.enable({ apis: ['setTimeout'] });
      try {
        resetRepoIdentityForTests();
        prefetchRepoIdentity(dir, passthrough(children));
        const kill = mock.method(children[0]!, 'kill');
        await settleRepoIdentity(dir);
        mock.timers.tick(120_000);
        assert.equal(kill.mock.callCount(), 0);
        // With .git moved away, only the cached answer can still read the repository.
        renameSync(path.join(dir, '.git'), path.join(dir, 'moved.git'));
        assert.deepEqual(resolveRepoIdentity(dir), expected);
      } finally {
        mock.timers.reset();
      }
    });
  });
});
