import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { ensureStatePaths, resolveRepoIdentity, resolveStatePaths, shortKey, statePathsFromRoot } from '../../src/state/paths.ts';
import { cleanup, tmpDir } from './helpers.ts';

function git(args: string[], cwd: string): { status: number | null; out: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

const gitAvailable = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;

describe('state/paths (MS1 canonical state location)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));

  it('AIDLC_STATE_DIR overrides the state root', () => {
    const override = path.join(dir, 'custom-state');
    const p = resolveStatePaths(dir, { AIDLC_STATE_DIR: override });
    assert.equal(p.root, path.resolve(override));
    assert.equal(p.goals, path.join(override, 'goals'));
    assert.equal(p.journal, path.join(override, 'journal'));
  });

  it('a non-git directory resolves to <cwd>/.aidlc and isGit=false', () => {
    const plain = path.join(dir, 'plain');
    mkdirSync(plain, { recursive: true });
    const id = resolveRepoIdentity(plain);
    assert.equal(id.isGit, false);
    assert.equal(id.mainRoot.toLowerCase(), path.resolve(plain).toLowerCase());
    assert.equal(id.worktreeRoot.toLowerCase(), path.resolve(plain).toLowerCase());
    const p = resolveStatePaths(plain, {});
    assert.equal(p.root.toLowerCase(), path.join(path.resolve(plain), '.aidlc').toLowerCase());
  });

  it('statePathsFromRoot lays out every subdirectory and ensureStatePaths creates them', () => {
    const root = path.join(dir, 'layout');
    const p = statePathsFromRoot(root);
    assert.deepEqual(Object.keys(p).sort(), ['board', 'cards', 'evidence', 'goals', 'incidents', 'journal', 'leases', 'operations', 'releases', 'reviewQueue', 'root'].sort());
    ensureStatePaths(p);
    for (const d of Object.values(p)) assert.ok(existsSync(d), d);
  });

  it('shortKey is stable, case- and slash-insensitive, 16 hex chars', () => {
    const a = shortKey('D:\\Projects\\Repo');
    assert.equal(a, shortKey('d:/projects/repo'));
    assert.match(a, /^[a-f0-9]{16}$/);
    assert.notEqual(a, shortKey('d:/projects/other'));
  });

  it('a linked git worktree resolves to the same mainRoot as the main checkout', (t) => {
    if (!gitAvailable) {
      t.skip('git not available');
      return;
    }
    const repo = path.join(dir, 'repo');
    mkdirSync(repo, { recursive: true });
    assert.equal(git(['init', '-q', '-b', 'main'], repo).status, 0);
    const commit = git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'init'], repo);
    assert.equal(commit.status, 0, commit.out);
    const wt = path.join(dir, 'wt-feature');
    const add = git(['worktree', 'add', '-q', wt, '-b', 'feature'], repo);
    assert.equal(add.status, 0, add.out);

    const main = resolveRepoIdentity(repo);
    const linked = resolveRepoIdentity(wt);
    assert.equal(main.isGit, true);
    assert.equal(linked.isGit, true);
    assert.equal(main.mainRoot.toLowerCase(), realpathSync.native(repo).toLowerCase());
    assert.equal(linked.mainRoot.toLowerCase(), main.mainRoot.toLowerCase());
    assert.equal(linked.worktreeRoot.toLowerCase(), realpathSync.native(wt).toLowerCase());
    assert.equal(linked.key, main.key);
    // both sessions share one .aidlc directory
    assert.equal(resolveStatePaths(wt, {}).root.toLowerCase(), resolveStatePaths(repo, {}).root.toLowerCase());
    assert.equal(resolveStatePaths(repo, {}).root.toLowerCase(), path.join(realpathSync.native(repo), '.aidlc').toLowerCase());
  });
});
