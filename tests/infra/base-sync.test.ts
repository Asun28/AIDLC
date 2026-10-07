import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { baseSyncReport } from '../../src/probes/base-sync.ts';
import { pathToFileURL } from 'node:url';
import { runSync, scriptedRunner, type ExecReceipt, type SyncRunner } from '../../src/probes/exec.ts';

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

const report = (cwd: string, base = 'main'): string => baseSyncReport({ isGit: true, cwd, base });

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
    assert.equal(baseSyncReport({ isGit: false, cwd: root, base: 'main', runner }), 'n/a');
    assert.deepEqual(calls, []);
  });

  test('a base that is not a plain branch name gives the not-plain line and git is not run [R1]', () => {
    for (const base of ['-x', 'ma in', 'main\nx', '', 'origin/', 'origin/-x', 'main;rm', 'mäin']) {
      const { runner, calls } = recordingRunner();
      assert.equal(baseSyncReport({ isGit: true, cwd: root, base, runner }), NOT_PLAIN, JSON.stringify(base));
      assert.deepEqual(calls, [], JSON.stringify(base));
    }
  });
});

describe('baseSyncReport when git cannot answer (T0-DOCTOR-BASE-SYNC acceptance 2)', () => {
  const SECRET = 'fatal: private repository text';
  const OID = '1111111111111111111111111111111111111111';
  const cases: Array<[string, Record<string, Partial<ExecReceipt>>, string]> = [
    ['rev-list exits 128', { 'git --no-lazy-fetch rev-parse': { stdout: `${OID}\n` }, 'git --no-lazy-fetch rev-list': { exitCode: 128, stderr: SECRET, stdout: '2\t3\n' } }, 'UNREADABLE: git rev-list failed (exit 128)'],
    ['rev-parse exits 129, as a git older than 2.44 does on --no-lazy-fetch', { 'git --no-lazy-fetch rev-parse': { exitCode: 129, stderr: 'unknown option: --no-lazy-fetch' } }, 'UNREADABLE: git rev-parse failed (exit 129)'],
    ['rev-parse exits 128', { 'git --no-lazy-fetch rev-parse': { exitCode: 128, stderr: SECRET, stdout: SECRET } }, 'UNREADABLE: git rev-parse failed (exit 128)'],
    ['rev-list exits 0 with empty output', { 'git --no-lazy-fetch rev-parse': { stdout: `${OID}\n` }, 'git --no-lazy-fetch rev-list': { stdout: '' } }, 'UNREADABLE: git rev-list failed (exit 0)'],
    ['rev-list has no exit code', { 'git --no-lazy-fetch rev-parse': { stdout: `${OID}\n` }, 'git --no-lazy-fetch rev-list': { exitCode: null, timedOut: true, stderr: SECRET } }, 'UNREADABLE: git rev-list failed (UNREADABLE)'],
  ];
  test('a runner that throws instead of answering: the value is unreadable without an exit code, and nothing throws [R1]', () => {
    const runner: SyncRunner = () => { throw new Error(SECRET); };
    let value = '';
    assert.doesNotThrow(() => { value = baseSyncReport({ isGit: true, cwd: root, base: 'main', runner }); });
    assert.equal(value, 'UNREADABLE: git rev-parse failed (UNREADABLE)');
  });

  for (const [name, script, expected] of cases) {
    test(`${name}: the value names the command and its exit, never git's text, and nothing throws [R1]`, () => {
      let value = '';
      assert.doesNotThrow(() => { value = baseSyncReport({ isGit: true, cwd: root, base: 'main', runner: scriptedRunner(script) }); });
      assert.equal(value, expected);
      assert.ok(!value.includes('private'), value);
    });
  }
});

describe('aidlc doctor prints baseSync (T0-DOCTOR-BASE-SYNC acceptance 3)', { skip: !GIT_OK && 'git is not available' }, () => {
  const doctor = (fx: { dir: string; clone: string }): Record<string, unknown> => {
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc.js'), 'doctor', '--json'], { cwd: fx.clone, env: { ...process.env, AIDLC_STATE_DIR: path.join(fx.dir, 'state') }, encoding: 'utf8', timeout: 120_000, windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout) as Record<string, unknown>;
  };

  test('in a clone one commit ahead of its origin, doctor --json prints the ahead line and exits 0, and follows the configured base [R1]', () => {
    const fx = cloneOfOrigin();
    try {
      commit(fx.clone, 'local a');
      assert.equal(doctor(fx)['baseSync'], 'ahead 1 of origin/main: unpublished commits on main; push them (git push origin main)');
      git(fx.seed, ['push', '-q', fx.origin, 'main:trunk']);
      git(fx.clone, ['fetch', '-q', 'origin']);
      git(fx.clone, ['branch', '-q', 'trunk', 'origin/trunk']);
      writeFileSync(path.join(fx.clone, 'aidlc.config.json'), JSON.stringify({ base: 'trunk' }), 'utf8');
      assert.equal(doctor(fx)['baseSync'], 'in sync with origin/trunk');
    } finally { fx.cleanup(); }
  });
});

// git 2.44 is the first to know --no-lazy-fetch; an older git refuses it (exit 129), which acceptance 2 covers.
const GIT_VERSION = /(\d+)\.(\d+)/.exec(spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true }).stdout ?? '');
const GIT_244 = GIT_OK && GIT_VERSION !== null && (Number(GIT_VERSION[1]) > 2 || (Number(GIT_VERSION[1]) === 2 && Number(GIT_VERSION[2]) >= 44));

/** The test environment without GIT_NO_LAZY_FETCH in any letter case, so only the flag can keep git from fetching. */
function lazyFetchEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (key.toUpperCase() !== 'GIT_NO_LAZY_FETCH') env[key] = value;
  return env;
}

/** Whether the clone holds the object, asked without fetching it. */
function holds(cwd: string, oid: string): boolean {
  return spawnSync('git', ['cat-file', '-e', oid], { cwd, env: { ...lazyFetchEnv(), GIT_NO_LAZY_FETCH: '1' }, windowsHide: true }).status === 0;
}

/** A promisor clone of origin whose origin/main names a commit pushed after the clone and never fetched into it. */
function promisorClone(): { clone: string; missing: string; cleanup: () => void } {
  const dir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-base-sync-promisor-')));
  const origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  const clone = path.join(dir, 'clone');
  git(dir, ['init', '-q', '--bare', '-b', 'main', origin]);
  git(origin, ['config', 'uploadpack.allowFilter', 'true']);
  git(origin, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
  git(dir, ['init', '-q', '-b', 'main', seed]);
  commit(seed, 'one');
  git(seed, ['push', '-q', origin, 'main']);
  git(dir, ['clone', '-q', pathToFileURL(origin).href, clone]);
  commit(seed, 'two');
  git(seed, ['push', '-q', origin, 'main']);
  const missing = git(seed, ['rev-parse', 'HEAD']);
  for (const [key, value] of [['core.repositoryformatversion', '1'], ['extensions.partialClone', 'origin'], ['remote.origin.promisor', 'true'], ['remote.origin.partialclonefilter', 'blob:none']] as const) git(clone, ['config', key, value]);
  writeFileSync(path.join(clone, '.git', 'refs', 'remotes', 'origin', 'main'), `${missing}\n`, 'utf8');
  return { clone, missing, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('baseSyncReport never fetches from a promisor remote (T0-DOCTOR-BASE-SYNC acceptance 6)', () => {
  test('origin/main naming a commit the clone does not hold is n/a and the commit stays absent, while a plain read of the ref fetches it [R1]', { skip: !GIT_244 && 'git 2.44 or newer is not available' }, () => {
    const fx = promisorClone();
    try {
      assert.equal(holds(fx.clone, fx.missing), false, 'the fixture starts without the commit');
      const runner: SyncRunner = (command, args, options) => runSync(command, args, { ...options, env: lazyFetchEnv() });
      assert.equal(baseSyncReport({ isGit: true, cwd: fx.clone, base: 'main', runner }), 'n/a (no origin/main)');
      assert.equal(holds(fx.clone, fx.missing), false, 'baseSync fetched nothing');
      const plain = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main^{commit}'], { cwd: fx.clone, env: lazyFetchEnv(), encoding: 'utf8', windowsHide: true });
      assert.equal(plain.status, 0, plain.stderr);
      assert.equal(holds(fx.clone, fx.missing), true, 'a plain read of the same ref fetches the commit, so the fixture exercises lazy fetching');
    } finally { fx.cleanup(); }
  });

  test('every git call of the check carries --no-lazy-fetch before its command [R1]', () => {
    const calls: string[][] = [];
    const answer = scriptedRunner({ 'git --no-lazy-fetch rev-parse': { stdout: '1111111111111111111111111111111111111111\n' }, 'git --no-lazy-fetch rev-list': { stdout: '0\t1\n' } });
    const runner: SyncRunner = (command, args, options) => { calls.push([command, ...args]); return answer(command, args, options); };
    assert.equal(baseSyncReport({ isGit: true, cwd: root, base: 'main', runner }), 'ahead 1 of origin/main: unpublished commits on main; push them (git push origin main)');
    assert.deepEqual(calls.map((call) => call.slice(0, 3)), [['git', '--no-lazy-fetch', 'rev-parse'], ['git', '--no-lazy-fetch', 'rev-parse'], ['git', '--no-lazy-fetch', 'rev-list']]);
  });
});
