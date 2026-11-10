import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { GitProbe } from '../../src/probes/git.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { resolveWorktreeRoot } from '../../src/config.ts';
import type { CardRun } from '../../src/core/types.ts';

const CARD = 'T1-HELLO';

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

/**
 * A goal that projects T1-HELLO in a real git repository, with `card next` run on the given ship path. The worktree root is
 * canonical (realpathSync.native), the path `git worktree list` reports, so the attach check compares like with like.
 */
function setup(shipPath: 'github' | 'dry-run') {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'say hello' });
  const goal = goalForCards(fx, [CARD]);
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\nwt/\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  mkdirSync(path.join(fx.tmp, 'wt'), { recursive: true });
  const root = realpathSync.native(path.join(fx.tmp, 'wt'));
  // The main root canonical too: where the temp directory is an 8.3 short path (the Windows runner's RUNNER~1), git
  // resolves the main checkout's common directory against the short spelling and the worktree's to the long one, and the
  // attach check reads them as two repositories (lesson 2026-11-09 T1-BOARD-WATCH-2). A real run's main root comes from git.
  const mainRoot = realpathSync.native(fx.tmp);
  const runner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, mainRoot, worktreeRoot: mainRoot }, config: { ...fx.config, shipPath, worktreeRoot: root }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
  const next = () => runner.next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD) ?? fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  return { fx, goalId: goal.id, worktree: path.join(root, CARD), next };
}

test('T0-PREPARE-WORKTREE acceptance 1: on the github ship path, a second card next without the worktree made returns prepare with action start again, not build, and records no worktree path [R1] [R2]', () => {
  const { fx, worktree, next } = setup('github');
  try {
    const first = next();
    assert.equal(first.directive.kind, 'prepare', first.directive.narration);
    if (first.directive.kind === 'prepare') {
      assert.equal(first.directive.action, 'start');
      assert.equal(first.directive.worktree, worktree);
    }
    assert.equal(first.run.state, 'PREPARE', 'a start keeps the run in PREPARE');
    assert.equal(first.run.worktree, undefined, 'a start records no worktree path');
    const second = next();
    assert.equal(second.directive.kind, 'prepare', `the second card next: ${second.directive.narration}`);
    if (second.directive.kind === 'prepare') {
      assert.equal(second.directive.action, 'start');
      assert.equal(second.directive.worktree, worktree);
    }
    assert.equal(second.run.worktree, undefined);
  } finally {
    fx.cleanup();
  }
});

test('T0-PREPARE-WORKTREE acceptance 2: after git worktree add of the card branch at the directive path, card next returns prepare with action attach, then build in that worktree [R1] [R2]', () => {
  const { fx, worktree, next } = setup('github');
  try {
    const first = next();
    assert.equal(first.directive.kind, 'prepare', first.directive.narration);
    git(fx.tmp, ['worktree', 'add', '-q', '-b', CARD, worktree]);
    const attach = next();
    assert.equal(attach.directive.kind, 'prepare', attach.directive.narration);
    if (attach.directive.kind === 'prepare') {
      assert.equal(attach.directive.action, 'attach');
      assert.equal(attach.directive.worktree.toLowerCase(), worktree.toLowerCase());
    }
    const build = next();
    assert.equal(build.directive.kind, 'build', build.directive.narration);
    if (build.directive.kind === 'build') assert.equal(build.directive.worktree.toLowerCase(), worktree.toLowerCase());
  } finally {
    fx.cleanup();
  }
});

test('T0-PREPARE-WORKTREE acceptance 3: a run stored in BUILD, REVIEW_FIX or SHIP whose recorded worktree does not exist gets prepare with action start [R2]', () => {
  for (const state of ['BUILD', 'REVIEW_FIX', 'SHIP'] as const) {
    const { fx, goalId, worktree, next } = setup('github');
    try {
      // The first card next claims the card lease for this session; the run is then stored as an earlier card next left
      // it before this card: in `state`, naming a worktree directory nobody made.
      next();
      fx.store.updateCardRun(goalId, CARD, (current) => ({ ...(current as CardRun), state, worktree, branch: CARD }));
      const r = next();
      assert.equal(r.directive.kind, 'prepare', `${state}: ${r.directive.narration}`);
      if (r.directive.kind === 'prepare') {
        assert.equal(r.directive.action, 'start', state);
        assert.equal(r.directive.worktree, worktree, state);
      }
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-PREPARE-WORKTREE acceptance 3: a run stored in BUILD whose recorded worktree path is a regular file, or lies under one so that its stat fails, gets prepare with action start [R2]', () => {
  for (const form of ['a regular file', 'a path under a regular file'] as const) {
    const { fx, goalId, worktree, next } = setup('github');
    try {
      next();
      writeFileSync(worktree, 'not a worktree\n');
      const recorded = form === 'a regular file' ? worktree : path.join(worktree, 'nested');
      fx.store.updateCardRun(goalId, CARD, (current) => ({ ...(current as CardRun), state: 'BUILD', worktree: recorded, branch: CARD }));
      const r = next();
      assert.equal(r.directive.kind, 'prepare', `${form}: ${r.directive.narration}`);
      if (r.directive.kind === 'prepare') assert.equal(r.directive.action, 'start', form);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-PREPARE-WORKTREE acceptance 3: an attached worktree whose directory is deleted while git still registers it, prunable or locked, gets a retryable prepare start naming how to clear the registration, never a stop, and builds again once it is made [R2]', () => {
  for (const form of ['prunable', 'locked'] as const) {
    const { fx, worktree, next } = setup('github');
    try {
      next();
      git(fx.tmp, ['worktree', 'add', '-q', '-b', CARD, worktree]);
      next();
      assert.equal(next().directive.kind, 'build', `${form}: setup, the attached worktree builds`);
      if (form === 'locked') git(fx.tmp, ['worktree', 'lock', worktree]);
      rmSync(worktree, { recursive: true, force: true });
      for (const call of ['first', 'second']) {
        const r = next();
        assert.equal(r.directive.kind, 'prepare', `${form}, ${call} card next after the delete: ${r.directive.narration}`);
        if (r.directive.kind === 'prepare') {
          assert.equal(r.directive.action, 'start', `${form}, ${call}`);
          assert.equal(r.directive.worktree, worktree, `${form}, ${call}`);
          assert.ok(r.directive.narration.includes('git worktree prune'), `${form}, ${call}: ${r.directive.narration}`);
          if (form === 'locked') assert.ok(r.directive.narration.includes('git worktree unlock'), `${form}, ${call}: ${r.directive.narration}`);
        }
        assert.equal(r.run.state, 'PREPARE', `${form}, ${call}`);
        assert.equal(r.run.stop, undefined, `${form}, ${call}: no stop is recorded`);
        assert.equal(r.run.worktree, undefined, `${form}, ${call}: no worktree path is recorded`);
      }
      if (form === 'locked') git(fx.tmp, ['worktree', 'unlock', worktree]);
      git(fx.tmp, ['worktree', 'prune']);
      git(fx.tmp, ['worktree', 'add', '-q', worktree, CARD]);
      const attach = next();
      assert.equal(attach.directive.kind, 'prepare', `${form}: ${attach.directive.narration}`);
      if (attach.directive.kind === 'prepare') assert.equal(attach.directive.action, 'attach', form);
      assert.equal(next().directive.kind, 'build', `${form}: the worktree made again builds`);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-PREPARE-WORKTREE acceptance 3: a common-directory probe that fails for a worktree whose directory exists keeps its tool stop, even when git marks the entry prunable [R2]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: CARD, title: 'say hello' });
    const goal = goalForCards(fx, [CARD]);
    const config = { ...fx.config, shipPath: 'github' as const };
    const worktree = path.join(resolveWorktreeRoot(config, fx.repo.mainRoot), CARD);
    mkdirSync(worktree, { recursive: true });
    const listing = `worktree ${fx.repo.mainRoot}\nHEAD ${'1'.repeat(40)}\nbranch refs/heads/main\n\nworktree ${worktree}\nHEAD ${'1'.repeat(40)}\nbranch refs/heads/${CARD}\nprunable gitdir file points to non-existent location\n\n`;
    const script = scriptedRunner({ 'git worktree list --porcelain': { stdout: listing }, 'git rev-parse --git-common-dir': { exitCode: 128, stderr: 'fatal: unable to read the common git directory' } });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, git: new GitProbe(script) });
    const r = runner.next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.stop?.reason, 'tool');
    assert.ok(r.run.stop?.detail.includes('cannot verify common git directory'), r.run.stop?.detail);
  } finally {
    fx.cleanup();
  }
});

test('T0-PREPARE-WORKTREE-2 acceptance 3: a stale registration is read only from a listing that succeeds and a stat that finds nothing, so a failed first listing and a stat that cannot tell (EACCES) keep the tool stop [R2]', () => {
  const failing = (code: string) => Object.assign(new Error(`${code}: injected`), { code });
  for (const form of ['the first listing fails, the second shows a stale registration', 'the locked worktree directory cannot be read (EACCES)'] as const) {
    const fx = makeFixture();
    const realStat = fs.statSync;
    try {
      writeCard(fx, { id: CARD, title: 'say hello' });
      const goal = goalForCards(fx, [CARD]);
      const config = { ...fx.config, shipPath: 'github' as const };
      const worktree = path.join(resolveWorktreeRoot(config, fx.repo.mainRoot), CARD);
      const mark = form.startsWith('the locked') ? 'locked' : 'prunable gitdir file points to non-existent location';
      const listing = `worktree ${fx.repo.mainRoot}\nHEAD ${'1'.repeat(40)}\nbranch refs/heads/main\n\nworktree ${worktree}\nHEAD ${'1'.repeat(40)}\nbranch refs/heads/${CARD}\n${mark}\n\n`;
      let lists = 0;
      const script = scriptedRunner({
        'git worktree list --porcelain': () => (lists++ === 0 && form.startsWith('the first') ? { exitCode: 128, stderr: 'fatal: Unable to read the worktree list' } : { stdout: listing }),
        'git rev-parse --git-common-dir': { exitCode: 128, stderr: 'fatal: cannot change to the worktree directory' },
      });
      if (form.startsWith('the locked')) {
        mkdirSync(worktree, { recursive: true });
        (fs as unknown as Record<string, unknown>)['statSync'] = ((p: fs.PathLike, ...rest: unknown[]) => {
          if (path.resolve(String(p)) === path.resolve(worktree)) throw failing('EACCES');
          return (realStat as unknown as (...a: unknown[]) => unknown)(p, ...rest);
        }) as typeof fs.statSync;
        syncBuiltinESMExports();
      }
      const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, git: new GitProbe(script) });
      const r = runner.next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
      assert.equal(r.directive.kind, 'stop', `${form}: ${r.directive.narration}`);
      assert.equal(r.run.stop?.reason, 'tool', form);
    } finally {
      (fs as unknown as Record<string, unknown>)['statSync'] = realStat;
      syncBuiltinESMExports();
      fx.cleanup();
    }
  }
});

test('T0-PREPARE-WORKTREE acceptance 4: with shipPath dry-run, a first card next returns prepare with action start and a second returns build, as before this card [R3]', () => {
  const { fx, worktree, next } = setup('dry-run');
  try {
    const first = next();
    assert.equal(first.directive.kind, 'prepare', first.directive.narration);
    if (first.directive.kind === 'prepare') {
      assert.equal(first.directive.action, 'start');
      assert.equal(first.directive.worktree, worktree);
    }
    const second = next();
    assert.equal(second.directive.kind, 'build', second.directive.narration);
    if (second.directive.kind === 'build') assert.equal(second.directive.worktree, worktree);
  } finally {
    fx.cleanup();
  }
});
