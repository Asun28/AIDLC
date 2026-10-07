import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { baseSyncReport } from '../../src/probes/base-sync.ts';
import { GitProbe } from '../../src/probes/git.ts';
import { scriptedRunner, type ExecReceipt, type SyncRunner } from '../../src/probes/exec.ts';

const GIT_OK = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).status === 0;
const root = path.resolve(import.meta.dirname, '..', '..');

// The R1 lines, written out from the card rather than built by the code under test.
const IN_SYNC = 'in sync with origin/main';
const AHEAD_2 = 'ahead 2 of origin/main: unpublished commits on main; push them (git push origin main)';
const BEHIND_1 = 'behind 1 of origin/main: on main, git merge --ff-only origin/main';
const DIVERGED_2_1 = 'diverged from origin/main (ahead 2, behind 1): on main, git merge origin/main, resolve, then git push origin main';
const NOT_PLAIN = 'n/a (base is not a plain branch name)';

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const commit = (cwd: string, message: string): string => git(cwd, ['commit', '-q', '--allow-empty', '-m', message]);

/** A bare origin whose main has one commit, a seed repository that pushes to it, and a clone whose main tracks origin/main. */
function cloneOfOrigin(): { dir: string; origin: string; seed: string; clone: string; cleanup: () => void } {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-base-sync-')));
  const origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  const clone = path.join(dir, 'clone');
  git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(dir, ['init', '-q', '-b', 'main', seed]);
  commit(seed, 'one');
  git(seed, ['push', '-q', origin, 'main']);
  git(dir, ['clone', '-q', origin, clone]);
  return { dir, origin, seed, clone, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Another commit on origin's main, fetched into the clone. */
function originMovesOn(fx: { origin: string; seed: string; clone: string }, message: string): void {
  commit(fx.seed, message);
  git(fx.seed, ['push', '-q', fx.origin, 'main']);
  git(fx.clone, ['fetch', '-q', 'origin']);
}

const report = (cwd: string, base = 'main'): string => baseSyncReport({ isGit: true, cwd, base, git: new GitProbe() });

/** A runner that records every call and answers none; a call to it is a git run. */
function recordingRunner(): { runner: SyncRunner; calls: string[][] } {
  const calls: string[][] = [];
  const answer = scriptedRunner({});
  return { calls, runner: (command, args, options) => { calls.push([command, ...args]); return answer(command, args, options); } };
}

describe('baseSyncReport over real repositories (T0-DOCTOR-BASE-SYNC acceptance 1)', { skip: !GIT_OK && 'git is not available' }, () => {
  test('a clone that matches origin is in sync [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      assert.equal(report(fx.clone), IN_SYNC);
    } finally { fx.cleanup(); }
  });

  test('two local commits not on origin are ahead 2 with the push command [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      commit(fx.clone, 'local a');
      commit(fx.clone, 'local b');
      assert.equal(report(fx.clone), AHEAD_2);
    } finally { fx.cleanup(); }
  });

  test('one fetched origin commit not on local main is behind 1 with the fast-forward command [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      originMovesOn(fx, 'remote a');
      assert.equal(report(fx.clone), BEHIND_1);
    } finally { fx.cleanup(); }
  });

  test('commits on both sides are diverged with the merge and push commands [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      commit(fx.clone, 'local a');
      commit(fx.clone, 'local b');
      originMovesOn(fx, 'remote a');
      assert.equal(report(fx.clone), DIVERGED_2_1);
    } finally { fx.cleanup(); }
  });

  test('a repository without origin/main has nothing to compare [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      assert.equal(report(fx.seed), 'n/a (no origin/main)');
    } finally { fx.cleanup(); }
  });

  test('a clone without a local main branch has nothing to compare [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      git(fx.clone, ['checkout', '-q', '-b', 'other']);
      git(fx.clone, ['branch', '-q', '-D', 'main']);
      assert.equal(report(fx.clone), 'n/a (no main branch)');
    } finally { fx.cleanup(); }
  });

  test('a base spelled origin/main names the same two refs [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      assert.equal(report(fx.clone, 'origin/main'), IN_SYNC);
      commit(fx.clone, 'local a');
      commit(fx.clone, 'local b');
      assert.equal(report(fx.clone, 'origin/main'), AHEAD_2);
    } finally { fx.cleanup(); }
  });

  test('another branch checked out does not change the counts: they compare the two branch refs, not HEAD [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      commit(fx.clone, 'local a');
      commit(fx.clone, 'local b');
      originMovesOn(fx, 'remote a');
      git(fx.clone, ['checkout', '-q', '-b', 'feature', 'origin/main']);
      for (const message of ['f1', 'f2', 'f3']) commit(fx.clone, message);
      assert.equal(report(fx.clone), DIVERGED_2_1);
    } finally { fx.cleanup(); }
  });
});

describe('baseSyncReport without git (T0-DOCTOR-BASE-SYNC acceptance 1)', () => {
  test('outside a git repository the value is n/a and git is not run [R1]', () => {
    const { runner, calls } = recordingRunner();
    assert.equal(baseSyncReport({ isGit: false, cwd: root, base: 'main', git: new GitProbe(runner) }), 'n/a');
    assert.deepEqual(calls, []);
  });

  test('a base that is not a plain branch name gives the not-plain line and git is not run [R1]', () => {
    for (const base of ['-x', 'ma in', 'main\nx', '', 'origin/', 'origin/-x', 'main;rm', 'mäin']) {
      const { runner, calls } = recordingRunner();
      assert.equal(baseSyncReport({ isGit: true, cwd: root, base, git: new GitProbe(runner) }), NOT_PLAIN, JSON.stringify(base));
      assert.deepEqual(calls, [], JSON.stringify(base));
    }
  });
});

describe('baseSyncReport when git cannot answer (T0-DOCTOR-BASE-SYNC acceptance 2)', () => {
  const SECRET = 'fatal: private repository text';
  const OID = '1111111111111111111111111111111111111111';
  const cases: Array<[string, Record<string, Partial<ExecReceipt>>, string]> = [
    ['rev-list exits 128', { 'git rev-parse': { stdout: `${OID}\n` }, 'git rev-list': { exitCode: 128, stderr: SECRET, stdout: SECRET } }, 'UNREADABLE: git rev-list failed (exit 128)'],
    ['rev-parse exits 128', { 'git rev-parse': { exitCode: 128, stderr: SECRET, stdout: SECRET } }, 'UNREADABLE: git rev-parse failed (exit 128)'],
    ['rev-list has no exit code', { 'git rev-parse': { stdout: `${OID}\n` }, 'git rev-list': { exitCode: null, timedOut: true, stderr: SECRET } }, 'UNREADABLE: git rev-list failed (UNREADABLE)'],
  ];
  for (const [name, script, expected] of cases) {
    test(`${name}: the value names the command and its exit, never git's text, and nothing throws [R1]`, () => {
      let value = '';
      assert.doesNotThrow(() => { value = baseSyncReport({ isGit: true, cwd: root, base: 'main', git: new GitProbe(scriptedRunner(script)) }); });
      assert.equal(value, expected);
      assert.ok(!value.includes('private'), value);
    });
  }
});

describe('aidlc doctor prints baseSync (T0-DOCTOR-BASE-SYNC acceptance 3)', { skip: !GIT_OK && 'git is not available' }, () => {
  test('in a clone one commit ahead of its origin, doctor --json prints the ahead line and exits 0 [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      commit(fx.clone, 'local a');
      const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc.js'), 'doctor', '--json'], { cwd: fx.clone, env: { ...process.env, AIDLC_STATE_DIR: path.join(fx.dir, 'state') }, encoding: 'utf8', timeout: 120_000, windowsHide: true });
      assert.equal(r.status, 0, r.stderr);
      const checks = JSON.parse(r.stdout) as Record<string, unknown>;
      assert.equal(checks['baseSync'], 'ahead 1 of origin/main: unpublished commits on main; push them (git push origin main)');
    } finally { fx.cleanup(); }
  });
});
