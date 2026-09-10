import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { decideWorktree } from '../../src/delivery/worktree.ts';
import { GitProbe } from '../../src/probes/git.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { Lease } from '../../src/core/types.ts';
import { actor, iso } from './helpers.ts';

// Drive-neutral fixture paths: Windows keeps a drive letter, POSIX runners use an absolute root.
const D = process.platform === 'win32' ? 'C:' : '';

const MAIN = `${D}/repo`;
const WT_ROOT = `${D}/wt`;

function porcelain(entries: Array<{ path: string; branch?: string }>): string {
  return entries.map((e) => `worktree ${e.path}\nHEAD 1234567890abcdef1234567890abcdef12345678\n${e.branch ? `branch refs/heads/${e.branch}\n` : 'detached\n'}`).join('\n') + '\n';
}

function probeWith(list: string, commonDir = `${D}/repo/.git`): GitProbe {
  return new GitProbe(
    scriptedRunner({
      'git worktree list --porcelain': { stdout: list },
      'git rev-parse --git-common-dir': { stdout: `${commonDir}\n` },
    }),
  );
}

function lease(session: string, released = false): Lease {
  return { resourceKey: 'card:repo:t1-foo', generation: 2, owner: actor(session), acquiredAt: iso(), heartbeatAt: iso(), expiresAt: iso(600_000), released };
}

describe('delivery/worktree (safe start-or-attach, R14-R16)', () => {
  const base = { mainRoot: MAIN, worktreeRoot: WT_ROOT, cardId: 'T1-FOO', session: 'window-a' };

  it('starts a new worktree when none exists for the branch', () => {
    const d = decideWorktree(probeWith(porcelain([{ path: MAIN, branch: 'main' }])), base);
    assert.equal(d.action, 'start');
    if (d.action === 'start') assert.equal(d.path, path.join(WT_ROOT, 'T1-FOO'));
  });

  it('attaches when branch, canonical path and common directory match and the lease is ours (or absent)', () => {
    const probe = probeWith(porcelain([{ path: MAIN, branch: 'main' }, { path: `${WT_ROOT}/T1-FOO`, branch: 'T1-FOO' }]));
    const noLease = decideWorktree(probe, base);
    assert.equal(noLease.action, 'attach');
    if (noLease.action === 'attach') {
      assert.equal(noLease.path, path.resolve(`${WT_ROOT}/T1-FOO`));
      assert.equal(noLease.head, '1234567890abcdef1234567890abcdef12345678');
    }
    const own = decideWorktree(probe, { ...base, lease: lease('window-a') });
    assert.equal(own.action, 'attach');
    const released = decideWorktree(probe, { ...base, lease: lease('window-b', true) });
    assert.equal(released.action, 'attach');
  });

  it('stops with ownership when another session owns the card lease', () => {
    const probe = probeWith(porcelain([{ path: MAIN, branch: 'main' }, { path: `${WT_ROOT}/T1-FOO`, branch: 'T1-FOO' }]));
    const d = decideWorktree(probe, { ...base, lease: lease('window-b') });
    assert.equal(d.action, 'stop');
    if (d.action === 'stop') {
      assert.equal(d.stopReason, 'ownership');
      assert.match(d.reason, /owned by session window-b \(generation 2\)/);
    }
  });

  it('stops with ownership when the branch is checked out at an unexpected path', () => {
    const probe = probeWith(porcelain([{ path: MAIN, branch: 'main' }, { path: `${D}/elsewhere/T1-FOO`, branch: 'T1-FOO' }]));
    const d = decideWorktree(probe, base);
    assert.equal(d.action, 'stop');
    if (d.action === 'stop') {
      assert.equal(d.stopReason, 'ownership');
      assert.match(d.reason, /expected/);
    }
  });

  it('stops with ownership when the worktree belongs to a different repository', () => {
    const probe = new GitProbe(
      scriptedRunner({
        'git worktree list --porcelain': { stdout: porcelain([{ path: MAIN, branch: 'main' }, { path: `${WT_ROOT}/T1-FOO`, branch: 'T1-FOO' }]) },
        // relative output resolves differently per cwd -> common dirs differ
        'git rev-parse --git-common-dir': { stdout: '.git\n' },
      }),
    );
    const d = decideWorktree(probe, base);
    assert.equal(d.action, 'stop');
    if (d.action === 'stop') {
      assert.equal(d.stopReason, 'ownership');
      assert.match(d.reason, /different repository/);
    }
  });

  it('stops with tool when the probe itself fails', () => {
    const probe = new GitProbe(scriptedRunner({ 'git worktree list --porcelain': { exitCode: 128, stderr: 'fatal: not a git repository' } }));
    const d = decideWorktree(probe, base);
    assert.equal(d.action, 'stop');
    if (d.action === 'stop') {
      assert.equal(d.stopReason, 'tool');
      assert.match(d.reason, /worktree probe failed/);
    }
  });
});
