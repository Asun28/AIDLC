// Card T0-OPS-CWD: an operation command and its status lookup run in one directory, the main checkout or the binding's
// `cwd` resolved against it, whatever the process directory; a binding directory that does not exist stops the release
// before an intent is recorded.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, driveCardToDone, opsConfigured, opsRunner, candidateShaFor, T0 } from './_harness.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import { ReleaseAttempt, HOUR_MS, addMs } from '../../src/core/types.ts';
import { OperationLedger } from '../../src/coordination/reconcile.ts';
import { DeliveryOpsConfig, type OpsLoad } from '../../src/delivery/ops.ts';
import { statePathsFromRoot } from '../../src/state/paths.ts';
import { cleanup, ensureStatePaths, tmpDir } from '../infra/helpers.ts';
import type { SyncRunner } from '../../src/probes/exec.ts';

type Fx = ReturnType<typeof makeFixture>;

/** A fixture removed after the test that asks for it. */
function fixtureFor(t: TestContext): Fx {
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  return fx;
}

/** The ops config of the scenarios with `cwd` set on the bindings named in `cwds`. */
function opsWithCwd(options: { asyncDeploy?: boolean }, cwds: Record<string, string>, drop: string[] = [], extra: Record<string, Record<string, unknown>> = {}): OpsLoad {
  const base = opsConfigured(options);
  if (base.status !== 'configured') throw new Error('opsConfigured is configured');
  const operations = base.config.operations
    .filter((o) => !drop.includes(o.role))
    .map((o) => ({ ...o, ...(cwds[o.role] === undefined ? {} : { cwd: cwds[o.role] }), ...(extra[o.role] ?? {}) }));
  return { ...base, config: DeliveryOpsConfig.parse({ ...base.config, operations }) };
}

/** A runner that records the command and the directory of each call and answers as the scenario ops runner does. */
function recordingRunner(): { runner: SyncRunner; calls: { command: string; cwd: string | undefined }[] } {
  const calls: { command: string; cwd: string | undefined }[] = [];
  const runner: SyncRunner = (command, args, options) => (calls.push({ command, cwd: options?.cwd }), opsRunner(command, args, options));
  return { runner, calls };
}

function releaseRunner(fx: Fx, runner: SyncRunner, opsLoad: OpsLoad): ReleaseRunner {
  return new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store, ops: fx.ops, leases: fx.leases, runner, opsLoad, now: fx.now, signals: () => [] });
}

/** A staging goal driven to DELIVER with its candidate set and staging approved, so the next step is the deploy. */
function stagingAtDeploy(fx: Fx, release: ReleaseRunner): { goalId: string; attemptId: string } {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goalId = goalForCards(fx, ['T1-HELLO'], { target: 'staging' }).id;
  driveCardToDone(fx, goalId, 'T1-HELLO');
  assert.equal(fx.controller.next(goalId).kind, 'verify-arc');
  const rep = fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: {} });
  const attemptId = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
  assert.ok(attemptId, rep.directive.narration);
  release.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
  fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest: 'c1', environment: 'staging' } });
  return { goalId, attemptId };
}

/** An attempt of a fresh goal saved directly at STAGE, so a test controls the ledger the deploy step meets. */
function attemptAtStage(fx: Fx): { goalId: string; attempt: ReleaseAttempt } {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goalId = goalForCards(fx, ['T1-HELLO'], { target: 'staging' }).id;
  const attempt = ReleaseAttempt.parse({ id: `rel-${goalId}-1`, goalId, generation: 0, target: 'staging', environment: 'staging', state: 'STAGE', candidateDigest: 'c1', sourceSha: 's1', startedAt: T0, deadline: addMs(T0, 12 * HOUR_MS), updatedAt: T0 });
  fx.store.saveRelease(attempt);
  return { goalId, attempt };
}

/**
 * The environment of a child process that works in `fixture`: no inherited variable whose name starts with GIT_ in any case
 * (GIT_DIR, GIT_CONFIG_COUNT and the like; Windows names are case-insensitive) and no AIDLC_STATE_DIR, and git told not to
 * look for a repository above the parent of `fixture`, so one that encloses the temp directory is never found. The global git
 * configuration is an empty file of the test and the system configuration is off, so the caller's signing, hooks and identity
 * settings reach no child.
 */
function childEnv(fixture: string, iso: GitIsolation): Record<string, string> {
  const inherited = Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !/^GIT_/i.test(entry[0]) && entry[0].toUpperCase() !== 'AIDLC_STATE_DIR');
  return { ...Object.fromEntries(inherited), GIT_CEILING_DIRECTORIES: path.dirname(fixture), GIT_CONFIG_GLOBAL: iso.config, GIT_CONFIG_NOSYSTEM: '1' };
}

/** An empty git configuration file and an empty hooks directory, in a directory of the test that `t` removes. */
interface GitIsolation {
  config: string;
  hooks: string;
}

function isolate(t: TestContext): GitIsolation {
  const dir = tmpDir('aidlc-ops-cwd-git-');
  t.after(() => cleanup(dir));
  writeFileSync(path.join(dir, 'gitconfig'), '', 'utf8');
  mkdirSync(path.join(dir, 'hooks'));
  return { config: path.join(dir, 'gitconfig'), hooks: path.join(dir, 'hooks') };
}

/** A git command of the fixture: identity, hooks and signing come from the arguments, never from the caller's configuration. */
function git(cwd: string, fixture: string, iso: GitIsolation, ...args: string[]): void {
  const config = ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', `core.hooksPath=${iso.hooks}`, '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false'];
  const r = spawnSync('git', [...config, ...args], { cwd, env: childEnv(fixture, iso), encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

test('the release runner and goal reconcile use the binding directory', (t) => {
  // Card T0-OPS-CWD acceptance 4 [R3] [R4]: the runner calls.
  const fx = fixtureFor(t);
  mkdirSync(path.join(fx.tmp, 'ops'));
  const { runner, calls } = recordingRunner();
  const release = releaseRunner(fx, runner, opsWithCwd({ asyncDeploy: true }, { deploy: 'ops' }));
  const { goalId, attemptId } = stagingAtDeploy(fx, release);
  const issued = release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
  assert.equal(issued.directive.kind, 'wait', issued.directive.narration);
  assert.deepEqual(calls, [{ command: 'deploy-cmd', cwd: path.join(fx.tmp, 'ops') }]);
  release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
  assert.deepEqual(calls, [{ command: 'deploy-cmd', cwd: path.join(fx.tmp, 'ops') }, { command: 'status-cmd', cwd: path.join(fx.tmp, 'ops') }]);
});

test('aidlc goal reconcile looks the status up in the binding directory of the main checkout, from a subdirectory and from a linked worktree', (t) => {
  // Card T0-OPS-CWD acceptance 4 [R4]: the CLI.
  const repo = tmpDir('aidlc-ops-cwd-');
  const linked = path.join(tmpDir('aidlc-ops-cwd-wt-'), 'linked');
  const out = tmpDir('aidlc-ops-cwd-out-');
  const iso = isolate(t);
  t.after(() => [repo, path.dirname(linked), out].forEach(cleanup));
  git(repo, repo, iso, 'init', '-q', '-b', 'main');
  git(repo, repo, iso, 'commit', '-q', '--allow-empty', '-m', 'init');
  git(repo, repo, iso, 'worktree', 'add', '-q', linked, '-b', 'feature');
  mkdirSync(path.join(repo, 'ops'));
  mkdirSync(path.join(repo, 'src', 'sub'), { recursive: true });
  const record = 'require("node:fs").writeFileSync(process.argv[1], process.cwd())';
  writeFileSync(
    path.join(repo, 'aidlc.ops.json'),
    JSON.stringify({ schemaVersion: 1, operations: [{ role: 'deploy', command: ['deploy-cmd'], async: true, cwd: 'ops', statusLookup: ['node', '-e', record, path.join(out, 'cwd.txt'), '{id}'] }] }),
    'utf8',
  );
  const ledger = new OperationLedger(ensureStatePaths(statePathsFromRoot(path.join(repo, '.aidlc'))).operations);
  const rec = ledger.recordIntent({ kind: 'deploy', goalId: 'goal-ops-cwd', target: 'staging', ownerGeneration: 0, timeoutMs: 60_000 }, T0);
  ledger.markIssued(rec.id, 'op-1', T0);
  for (const [label, cwd, fixture] of [['a subdirectory of the main checkout', path.join(repo, 'src', 'sub'), repo], ['a linked worktree', linked, linked]] as const) {
    const run = spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'goal', 'reconcile', 'goal-ops-cwd'], { cwd, env: childEnv(fixture, iso), encoding: 'utf8', timeout: 60_000 });
    assert.equal(run.status, 0, `${label}: ${run.stderr}`);
    assert.ok(run.stdout.includes('provider lookup'), `${label}: ${run.stdout}`);
    assert.equal(realpathSync.native(readFileSync(path.join(out, 'cwd.txt'), 'utf8')), realpathSync.native(path.join(repo, 'ops')), label);
    writeFileSync(path.join(out, 'cwd.txt'), '', 'utf8');
  }
});

test('a binding directory that does not exist stops the release before any operation', (t) => {
  // Card T0-OPS-CWD acceptance 5 [R5].
  const rows: [string, (fx: Fx) => string][] = [
    ['absent', () => 'missing'],
    [
      'a file',
      (fx) => {
        writeFileSync(path.join(fx.tmp, 'afile'), 'x', 'utf8');
        return 'afile';
      },
    ],
    [
      'a path under a file',
      (fx) => {
        writeFileSync(path.join(fx.tmp, 'afile'), 'x', 'utf8');
        return 'afile/sub';
      },
    ],
  ];
  for (const [label, makeCwd] of rows) {
    const fx = fixtureFor(t);
    const cwd = makeCwd(fx);
    const { runner, calls } = recordingRunner();
    const release = releaseRunner(fx, runner, opsWithCwd({}, { deploy: cwd }));
    const { goalId, attemptId } = stagingAtDeploy(fx, release);
    const r = release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
    assert.equal(r.directive.kind, 'stop', `${label}: ${r.directive.narration}`);
    const stop = fx.store.getRelease(attemptId)!;
    assert.equal(stop.state, 'STOP', `${label}: the stop is saved`);
    assert.equal(stop.stop?.reason, 'release-config', label);
    assert.equal(stop.disposition, 'failed', label);
    assert.equal(stop.stop?.nextAction, 'create the directory or correct cwd in aidlc.ops.json', label);
    assert.ok(stop.stop?.detail.includes('deploy') && stop.stop.detail.includes(path.resolve(fx.tmp, cwd)), `${label}: ${stop.stop?.detail}`);
    assert.deepEqual(fx.ops.list({ goalId }).filter((o) => o.releaseAttempt === attemptId || o.kind === 'deploy'), [], `${label}: no ledger record for the attempt`);
    assert.deepEqual(fx.events(goalId).filter((e) => e.type === 'OPERATION_INTENT' && (e.data as { step?: string }).step === 'stage-deploy'), [], `${label}: no OPERATION_INTENT for the step`);
    assert.deepEqual(calls, [], `${label}: no command ran`);
  }
});

test('a binding directory that does not exist changes no earlier return of the deploy step', (t) => {
  // Card T0-OPS-CWD acceptance 5 [R5], the order rows, each with the directory missing.
  {
    const fx = fixtureFor(t);
    const { runner, calls } = recordingRunner();
    const { goalId, attempt } = attemptAtStage(fx);
    const rec = fx.ops.recordIntent({ kind: 'deploy', goalId, releaseAttempt: attempt.id, target: 'staging', candidateDigest: 'c1', idempotencyKey: `${attempt.id}:stage-deploy:c1`, ownerGeneration: 0, timeoutMs: 60_000 }, T0);
    fx.ops.markResult(rec.id, 'succeeded', {}, T0);
    const r = releaseRunner(fx, runner, opsWithCwd({}, { deploy: 'missing' })).next(fx.goal(goalId), attempt);
    assert.equal(r.attempt.stop, undefined, `a settled step stops nothing: ${r.directive.narration}`);
    assert.deepEqual(r.attempt.steps.find((s) => s.name === 'stage-deploy'), { name: 'stage-deploy', status: 'succeeded', operationId: rec.id });
    assert.equal(fx.ops.list({ goalId }).length, 1, 'no second record');
    assert.deepEqual(calls, []);
  }
  {
    const fx = fixtureFor(t);
    const { runner, calls } = recordingRunner();
    const { goalId, attempt } = attemptAtStage(fx);
    const r = releaseRunner(fx, runner, opsWithCwd({}, { status: 'missing', recover: 'missing' }, ['deploy'])).next(fx.goal(goalId), attempt);
    assert.equal(r.attempt.stop?.reason, 'release-config');
    assert.match(r.attempt.stop?.detail ?? '', /operation deploy is NOT CONFIGURED/);
    assert.deepEqual(r.attempt.stop?.nextAction, 'bind it in aidlc.ops.json');
    assert.deepEqual([fx.ops.list({ goalId }), calls], [[], []]);
  }
  {
    const fx = fixtureFor(t);
    const { runner, calls } = recordingRunner();
    const { goalId, attempt } = attemptAtStage(fx);
    const r = releaseRunner(fx, runner, opsWithCwd({}, { deploy: 'missing' }, [], { deploy: { triggersPublication: true } })).next(fx.goal(goalId), attempt);
    assert.equal(r.attempt.stop?.reason, 'release-auth');
    assert.match(r.attempt.stop?.detail ?? '', /triggers external publication/);
    assert.deepEqual([fx.ops.list({ goalId }), calls], [[], []]);
  }
});
