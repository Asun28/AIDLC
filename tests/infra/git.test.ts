import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { GitProbe, GitProbeError } from '../../src/probes/git.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

// Drive-neutral fixture paths: Windows keeps a drive letter, POSIX runners use an absolute root.
const D = process.platform === 'win32' ? 'C:' : '';

const PORCELAIN = [
  `worktree ${D}/repo`,
  'HEAD 1111111111111111111111111111111111111111',
  'branch refs/heads/main',
  '',
  `worktree ${D}/wt/T1-FOO`,
  'HEAD 2222222222222222222222222222222222222222',
  'branch refs/heads/T1-FOO',
  'locked',
  '',
  `worktree ${D}/wt/scratch`,
  'HEAD 3333333333333333333333333333333333333333',
  'detached',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n');

describe('probes/git (evidence probes with a scripted runner)', () => {
  it('parses worktree porcelain including branch, detached, locked and prunable', () => {
    const probe = new GitProbe(scriptedRunner({ 'git worktree list --porcelain': { stdout: PORCELAIN } }));
    const entries = probe.worktrees(`${D}/repo`);
    assert.equal(entries.length, 3);
    assert.equal(entries[0]!.path, path.resolve(`${D}/repo`));
    assert.equal(entries[0]!.branch, 'main');
    assert.equal(entries[0]!.head, '1111111111111111111111111111111111111111');
    assert.equal(entries[1]!.branch, 'T1-FOO');
    assert.equal(entries[1]!.locked, true);
    assert.equal(entries[2]!.detached, true);
    assert.equal(entries[2]!.prunable, true);
    assert.equal(entries[2]!.branch, undefined);
  });

  it('findWorktree matches exact branch and canonical path; a path mismatch is reported, not adopted', () => {
    const probe = new GitProbe(scriptedRunner({ 'git worktree list --porcelain': { stdout: PORCELAIN } }));
    const hit = probe.findWorktree(`${D}/repo`, 'T1-FOO', path.join(`${D}/wt`, 'T1-FOO'));
    assert.equal(hit.mismatch, undefined);
    assert.equal(hit.entry?.branch, 'T1-FOO');
    const mismatch = probe.findWorktree(`${D}/repo`, 'T1-FOO', `${D}/elsewhere/T1-FOO`);
    assert.ok(mismatch.entry);
    assert.match(mismatch.mismatch ?? '', /expected .*elsewhere/);
    assert.deepEqual(probe.findWorktree(`${D}/repo`, 'T9-NONE'), {});
    // the same branch in two worktrees is ambiguous
    const dup = new GitProbe(scriptedRunner({ 'git worktree list --porcelain': { stdout: PORCELAIN + `worktree ${D}/wt/dup\nbranch refs/heads/T1-FOO\n` } }));
    assert.match(dup.findWorktree(`${D}/repo`, 'T1-FOO').mismatch ?? '', /checked out in 2 worktrees/);
  });

  it('a failing git command throws GitProbeError with the receipt (errors are not empty results)', () => {
    const probe = new GitProbe(scriptedRunner({ 'git rev-parse --verify HEAD': { exitCode: 128, stderr: 'fatal: not a git repository' } }));
    assert.throws(() => probe.head(`${D}/nowhere`), (e: unknown) => e instanceof GitProbeError && /not a git repository/.test(e.message) && e.receipt.exitCode === 128);
    assert.equal(probe.currentBranch(`${D}/nowhere`), undefined);
  });

  it('candidate digest binds HEAD to the working-tree status and input manifest', () => {
    let status = '';
    const probe = new GitProbe(
      scriptedRunner({
        'git rev-parse --verify HEAD': { stdout: 'abcdef\n' },
        'git status --porcelain=v1 --untracked-files=all': () => ({ stdout: status }),
      }),
    );
    const clean = probe.candidate(`${D}/wt`);
    assert.equal(clean.sha, 'abcdef');
    assert.equal(clean.dirty, false);
    assert.deepEqual(clean.untracked, []);
    status = ' M src/a.ts\n?? tests/new.test.ts\n';
    const dirty = probe.candidate(`${D}/wt`);
    assert.equal(dirty.dirty, true);
    assert.deepEqual(dirty.untracked, ['tests/new.test.ts']);
    assert.notEqual(dirty.digest, clean.digest);
    status = '';
    assert.equal(probe.candidate(`${D}/wt`).digest, clean.digest);
    assert.notEqual(probe.candidate(`${D}/wt`, ['fixtures/golden.json@1']).digest, clean.digest);
  });

  it('resolveBase prefers the remote ref, then local, fully qualified and verified as a commit', () => {
    const both = new GitProbe(
      scriptedRunner({
        'git rev-parse --verify --quiet refs/remotes/origin/main^{commit}': { stdout: 'remote-oid\n' },
        'git rev-parse --verify --quiet refs/heads/main^{commit}': { stdout: 'local-oid\n' },
      }),
    );
    assert.deepEqual(both.resolveBase(`${D}/repo`, 'main'), { ref: 'refs/remotes/origin/main', oid: 'remote-oid' });
    assert.deepEqual(both.resolveBase(`${D}/repo`, 'origin/main'), { ref: 'refs/remotes/origin/main', oid: 'remote-oid' });
    assert.deepEqual(both.resolveBase(`${D}/repo`, 'main', true), { ref: 'refs/heads/main', oid: 'local-oid' });
    const localOnly = new GitProbe(
      scriptedRunner({
        'git rev-parse --verify --quiet refs/remotes/origin/main^{commit}': { exitCode: 1 },
        'git rev-parse --verify --quiet refs/heads/main^{commit}': { stdout: 'local-oid\n' },
      }),
    );
    assert.deepEqual(localOnly.resolveBase(`${D}/repo`, 'main'), { ref: 'refs/heads/main', oid: 'local-oid' });
    assert.equal(localOnly.resolveBase(`${D}/repo`, 'origin/main'), undefined);
    const none = new GitProbe(scriptedRunner({}));
    assert.equal(none.resolveBase(`${D}/repo`, 'main'), undefined);
  });

  it('divergence parses left-right counts; contains/numstat/changedPaths read their commands', () => {
    const probe = new GitProbe(
      scriptedRunner({
        'git rev-list --left-right --count refs/remotes/origin/main...HEAD': { stdout: '2\t3\n' },
        'git merge-base --is-ancestor deadbeef refs/remotes/origin/main': { exitCode: 0 },
        'git merge-base --is-ancestor cafebabe refs/remotes/origin/main': { exitCode: 1 },
        'git diff --name-only base...HEAD': { stdout: 'src/a.ts\ndocs/b.md\n' },
        'git diff --numstat base...HEAD': { stdout: '10\t2\tsrc/a.ts\n-\t-\tbin/blob\n3\t0\tdocs/b.md\n' },
        'git rev-parse --git-common-dir': { stdout: `${D}/repo/.git\n` },
        'git fetch --quiet --no-tags origin +refs/heads/main:refs/remotes/origin/main': { exitCode: 0 },
      }),
    );
    assert.deepEqual(probe.divergence(`${D}/wt`, 'refs/remotes/origin/main'), { behind: 2, ahead: 3 });
    assert.equal(probe.contains(`${D}/wt`, 'refs/remotes/origin/main', 'deadbeef'), true);
    assert.equal(probe.contains(`${D}/wt`, 'refs/remotes/origin/main', 'cafebabe'), false);
    assert.deepEqual(probe.changedPaths(`${D}/wt`, 'base'), ['src/a.ts', 'docs/b.md']);
    assert.deepEqual(probe.numstat(`${D}/wt`, 'base'), { added: 13, deleted: 2, files: 3 });
    assert.equal(probe.commonDir(`${D}/wt`), path.resolve(`${D}/repo/.git`));
    assert.equal(probe.fetchBase(`${D}/wt`, 'origin/main').exitCode, 0);
  });
});
