// Card T0-RELEASE-OP-REISSUE: a release step whose operation the ledger already holds is never issued again. An operation
// without a recorded outcome makes `release next` wait and name `aidlc ops reconcile`, a recorded outcome becomes the step,
// and two callers of one step record one intent and dispatch once.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, driveCardToDone, opsConfigured, opsRunner, candidateShaFor, T0 } from './_harness.ts';
import { ReleaseRunner, type ReleaseDirective } from '../../src/loop/release-runner.ts';
import { ReleaseAttempt, HOUR_MS, MINUTE_MS, addMs, type OperationKind, type OperationStatus } from '../../src/core/types.ts';
import { OperationLedger } from '../../src/coordination/reconcile.ts';
import { LeaseStore } from '../../src/coordination/lease.ts';
import { StoreError } from '../../src/state/store.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import type { OpsLoad } from '../../src/delivery/ops.ts';
import type { SyncRunner } from '../../src/probes/exec.ts';

type Fx = ReturnType<typeof makeFixture>;
type Step = 'stage-deploy' | 'apply-deploy' | 'recover';

const UNRESOLVED: OperationStatus[] = ['intended', 'issued', 'running', 'UNKNOWN'];
const TERMINAL: OperationStatus[] = ['succeeded', 'failed', 'cancelled'];

function inFixture(body: (fx: Fx) => void): void {
  const fx = makeFixture();
  try {
    body(fx);
  } finally {
    fx.cleanup();
  }
}

/** The scenario ops runner, counting each command; the commands in `throwOn` throw on their first call (an interrupted command). */
function countingRunner(throwOn: string[] = []): { runner: SyncRunner; runs: Record<string, number> } {
  const runs: Record<string, number> = {};
  const runner: SyncRunner = (command, args, options) => {
    runs[command] = (runs[command] ?? 0) + 1;
    if (throwOn.includes(command) && runs[command] === 1) throw new Error(`${command} interrupted`);
    return opsRunner(command, args, options);
  };
  return { runner, runs };
}

function releaseRunner(fx: Fx, runner: SyncRunner, opsLoad: OpsLoad = opsConfigured(), extra: Partial<ConstructorParameters<typeof ReleaseRunner>[0]> = {}): ReleaseRunner {
  return new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store, ops: fx.ops, leases: fx.leases, runner, opsLoad, now: fx.now, signals: () => [], ...extra });
}

/** A staging deploy whose command threw on a goal driven to DELIVER: the first `next` throws and leaves the step's record `intended`. */
function interruptedStagingDeploy(fx: Fx, opsLoad: OpsLoad = opsConfigured()) {
  const { runner, runs } = countingRunner(['deploy-cmd']);
  const release = releaseRunner(fx, runner, opsLoad);
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goalId = goalForCards(fx, ['T1-HELLO'], { target: 'staging' }).id;
  driveCardToDone(fx, goalId, 'T1-HELLO');
  assert.equal(fx.controller.next(goalId).kind, 'verify-arc');
  const rep = fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: {} });
  const attemptId = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
  assert.ok(attemptId, rep.directive.narration);
  release.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
  fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest: 'c1', environment: 'staging' } });
  assert.throws(() => release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!), /deploy-cmd interrupted/);
  const ops = fx.ops.list({ goalId, kind: 'deploy' });
  assert.deepEqual(ops.map((o) => o.status), ['intended']);
  return { release, runs, goalId, attemptId, opId: ops[0]!.id };
}

/** An attempt of a fresh goal saved directly in a mutating state, so a test controls the ledger the step meets. */
function attemptAt(fx: Fx, state: 'STAGE' | 'APPLY' | 'RECOVER', goalId?: string, overrides: Partial<ReleaseAttempt> = {}): { goalId: string; attempt: ReleaseAttempt } {
  const target = state === 'STAGE' ? 'staging' : 'production';
  if (!goalId) {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    goalId = goalForCards(fx, ['T1-HELLO'], { target }).id;
  }
  const attempt = ReleaseAttempt.parse({ id: `rel-${goalId}-1`, goalId, generation: 0, target, environment: target, state, candidateDigest: 'c1', sourceSha: 's1', startedAt: T0, deadline: addMs(T0, 12 * HOUR_MS), updatedAt: T0, ...overrides });
  fx.store.saveRelease(attempt);
  return { goalId, attempt };
}

/** A fresh fixture with an attempt at STAGE and a counting runner. */
function stageCase(body: (c: { fx: Fx; goalId: string; attempt: ReleaseAttempt; runner: SyncRunner; runs: Record<string, number> }) => void, overrides: Partial<ReleaseAttempt> = {}): void {
  inFixture((fx) => body({ fx, ...attemptAt(fx, 'STAGE', undefined, overrides), ...countingRunner() }));
}

/** A fabricated ledger record at a distinct time `minute` minutes before T0, in the given status. */
function record(fx: Fx, minute: number, fields: { goalId: string; kind?: OperationKind; releaseAttempt?: string; idempotencyKey?: string; target?: string; candidateDigest?: string; status: OperationStatus; error?: string }): string {
  const at = addMs(T0, -minute * MINUTE_MS);
  const rec = fx.ops.recordIntent({ kind: fields.kind ?? 'deploy', goalId: fields.goalId, releaseAttempt: fields.releaseAttempt, target: fields.target ?? 'staging', candidateDigest: fields.candidateDigest ?? 'c1', idempotencyKey: fields.idempotencyKey, ownerGeneration: 0, timeoutMs: 60_000 }, at);
  if (fields.status === 'issued') fx.ops.markIssued(rec.id, undefined, at);
  else if (fields.status === 'running') fx.ops.markRunning(rec.id, at);
  else if (fields.status !== 'intended') fx.ops.markResult(rec.id, fields.status, { error: fields.error }, at);
  return rec.id;
}

const keyOf = (attempt: ReleaseAttempt, step: Step) => `${attempt.id}:${step}:c1`;

/** The wait on operations of unknown outcome (R1, R2): the ids, the reconciliation grace and the commands that settle them. */
function assertReconcileWait(d: ReleaseDirective, attempt: ReleaseAttempt, ids: string[]): void {
  assert.equal(d.kind, 'wait', d.narration);
  if (d.kind !== 'wait') return;
  assert.equal(d.on, `unknown:${ids.join(',')}`);
  assert.equal(d.until, addMs(attempt.deadline, 5 * MINUTE_MS));
  for (const id of ids) assert.ok(d.narration.includes(`aidlc ops reconcile ${id} --status`), d.narration);
  for (const status of ['succeeded', 'failed', 'cancelled', 'UNKNOWN', 'running']) assert.ok(d.narration.includes(status), `${status}: ${d.narration}`);
  assert.ok(d.narration.includes('--provider-id'), d.narration);
  assert.ok(d.narration.includes(`aidlc release next ${attempt.id}`), d.narration);
  assert.match(d.narration, /may still be running/);
  assert.match(d.narration, /not issued again until its outcome is recorded/);
}

const cli = (fx: Fx, ...args: string[]) => spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), ...args], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000 });

test('a staging deploy interrupted while its command ran is not issued again; release next waits on the intended operation and names aidlc ops reconcile', () => {
  inFixture((fx) => {
    const { release, runs, goalId, attemptId, opId } = interruptedStagingDeploy(fx);
    const before = fx.store.getRelease(attemptId)!;
    for (let i = 0; i < 2; i++) assertReconcileWait(release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!).directive, before, [opId]);
    assert.equal(runs['deploy-cmd'], 1, 'the deploy command ran once');
    assert.deepEqual(fx.ops.list({ goalId }).filter((o) => o.releaseAttempt === attemptId).map((o) => [o.id, o.status]), [[opId, 'intended']]);
    const after = fx.store.getRelease(attemptId)!;
    assert.deepEqual({ steps: after.steps, operations: after.operations }, { steps: before.steps, operations: before.operations });
    const goalNext = fx.controller.next(goalId);
    assert.equal(goalNext.kind, 'wait', goalNext.narration);
    if (goalNext.kind === 'wait') assert.equal(goalNext.on, `reconcile:${opId}`);
  });
});

test('an intended release operation past the reconciliation grace stops the attempt for time and lists it', () => {
  inFixture((fx) => {
    const { release, runs, goalId, attemptId, opId } = interruptedStagingDeploy(fx);
    const deadline = fx.store.getRelease(attemptId)!.deadline;
    fx.advance(Date.parse(addMs(deadline, 5 * MINUTE_MS)) - Date.parse(fx.now()) + MINUTE_MS);
    const r = release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.attempt.stop?.reason, 'time');
    assert.deepEqual(r.attempt.stop?.unresolvedOperations, [opId]);
    assert.equal(fx.store.getRelease(attemptId)!.state, 'STOP', 'the stop is saved');
    assert.equal(runs['deploy-cmd'], 1);
  });
  // An intended operation of the attempt without the step's key is selected by its releaseAttempt: it waits, then stops.
  stageCase(({ fx, goalId, attempt, runner, runs }) => {
    const release = releaseRunner(fx, runner);
    const id = record(fx, 1, { goalId, releaseAttempt: attempt.id, status: 'intended' });
    assertReconcileWait(release.next(fx.goal(goalId), attempt).directive, attempt, [id]);
    fx.advance(12 * HOUR_MS + 6 * MINUTE_MS);
    const r = release.next(fx.goal(goalId), attempt);
    assert.equal(r.attempt.stop?.reason, 'time', r.directive.narration);
    assert.deepEqual(r.attempt.stop?.unresolvedOperations, [id]);
    assert.equal(runs['deploy-cmd'], undefined);
  });
});

test('each outcome aidlc ops reconcile records settles the step with no second deploy', () => {
  const cases: { status: string; extra?: string[]; opsLoad?: OpsLoad }[] = [{ status: 'succeeded' }, { status: 'failed' }, { status: 'cancelled' }, { status: 'UNKNOWN' }, { status: 'running', extra: ['--provider-id', 'dep1'], opsLoad: opsConfigured({ asyncDeploy: true }) }];
  for (const c of cases) {
    inFixture((fx) => {
      const { release, runs, goalId, attemptId, opId } = interruptedStagingDeploy(fx, c.opsLoad);
      if (c.status === 'succeeded') {
        const listed = cli(fx, 'goal', 'reconcile', goalId);
        assert.equal(listed.status, 0, listed.stderr);
        assert.ok(listed.stdout.includes(opId) && listed.stdout.includes('manual: aidlc ops reconcile'), listed.stdout);
      }
      const settled = cli(fx, 'ops', 'reconcile', opId, '--status', c.status, ...(c.extra ?? []));
      assert.equal(settled.status, 0, settled.stderr);
      const events = fx.events(goalId).length;
      const r = release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
      if (c.status === 'succeeded' || c.status === 'running') {
        assert.equal(r.directive.kind, 'stage', `${c.status}: ${r.directive.narration}`);
        assert.ok(r.directive.narration.includes('stage-verify'), r.directive.narration);
        assert.deepEqual(r.attempt.steps.find((s) => s.name === 'stage-deploy'), { name: 'stage-deploy', status: 'succeeded', operationId: opId });
        assert.ok(r.attempt.operations.includes(opId));
        assert.ok(r.attempt.evidence.some((e) => e.id === `op-${opId}` && e.kind === 'deploy' && e.environment === 'staging'), JSON.stringify(r.attempt.evidence));
      }
      if (c.status === 'succeeded') assert.equal(fx.events(goalId).length, events, 'adoption appends no journal event');
      if (c.status === 'failed' || c.status === 'cancelled') {
        assert.equal(r.directive.kind, 'stop', `${c.status}: ${r.directive.narration}`);
        assert.equal(r.attempt.stop?.reason, 'release-health');
        assert.equal(r.attempt.stop?.detail, 'staging deployment failed');
      }
      if (c.status === 'UNKNOWN') assertReconcileWait(r.directive, r.attempt, [opId]);
      assert.equal(runs['deploy-cmd'], 1, `${c.status}: the deploy command ran once`);
      assert.equal(fx.ops.list({ goalId, kind: 'deploy' }).length, 1, c.status);
    });
  }
});

test('a deploy whose result was recorded but whose attempt save was lost becomes the step and is not issued again', () => {
  stageCase(({ fx, goalId, attempt, runner, runs }) => {
    const losing = new GoalStore(fx.paths);
    const save = losing.saveRelease.bind(losing);
    let lost = false;
    losing.saveRelease = (a) => {
      if (!lost && fx.ops.list({ goalId: a.goalId, kind: 'deploy' }).some((o) => o.status === 'succeeded')) {
        lost = true;
        throw new Error('save lost');
      }
      return save(a);
    };
    const release = releaseRunner(fx, runner, opsConfigured(), { store: losing });
    assert.throws(() => release.next(fx.goal(goalId), attempt), /save lost/);
    assert.deepEqual(fx.ops.list({ goalId }).map((o) => o.status), ['succeeded']);
    assert.deepEqual(fx.store.getRelease(attempt.id)!.steps, []);
    const r = release.next(fx.goal(goalId), fx.store.getRelease(attempt.id)!);
    assert.equal(r.directive.kind, 'stage', r.directive.narration);
    assert.equal(runs['deploy-cmd'], 1);
  });
});

test('an interrupted production deploy and an interrupted recovery wait on their intended operation', () => {
  for (const [state, command, kind] of [['APPLY', 'deploy-cmd', 'deploy'], ['RECOVER', 'recover-cmd', 'rollback']] as const) {
    inFixture((fx) => {
      const { runner, runs } = countingRunner([command]);
      const release = releaseRunner(fx, runner);
      const { goalId, attempt } = attemptAt(fx, state);
      assert.throws(() => release.next(fx.goal(goalId), attempt), new RegExp(`${command} interrupted`));
      const ops = fx.ops.list({ goalId, kind });
      assert.deepEqual(ops.map((o) => o.status), ['intended'], state);
      for (let i = 0; i < 2; i++) assertReconcileWait(release.next(fx.goal(goalId), fx.store.getRelease(attempt.id)!).directive, attempt, [ops[0]!.id]);
      assert.equal(runs[command], 1, `${state}: ${command} ran once`);
    });
  }
});

test('a record that matches the step only by its key is waited on before the grace and stops the attempt after it', () => {
  for (const status of UNRESOLVED) {
    stageCase(({ fx, goalId, attempt, runner, runs }) => {
      const release = releaseRunner(fx, runner);
      const keyOnly = record(fx, 2, { goalId, idempotencyKey: keyOf(attempt, 'stage-deploy'), status });
      const otherAttempt = record(fx, 1, { goalId, releaseAttempt: `rel-${goalId}-0`, idempotencyKey: keyOf(attempt, 'stage-deploy'), status });
      const stored = JSON.stringify(fx.store.getRelease(attempt.id));
      assertReconcileWait(release.next(fx.goal(goalId), attempt).directive, attempt, [keyOnly, otherAttempt]);
      assert.equal(JSON.stringify(fx.store.getRelease(attempt.id)), stored, `${status}: the stored attempt is unchanged`);
      fx.advance(12 * HOUR_MS + 6 * MINUTE_MS);
      const r = release.next(fx.goal(goalId), attempt);
      assert.equal(r.directive.kind, 'stop', `${status}: ${r.directive.narration}`);
      assert.equal(r.attempt.stop?.reason, 'time');
      assert.deepEqual(r.attempt.stop?.unresolvedOperations, [keyOnly, otherAttempt]);
      assert.equal(fx.store.getRelease(attempt.id)!.state, 'STOP');
      assert.equal(runs['deploy-cmd'], undefined, `${status}: no command ran`);
      assert.equal(fx.ops.list({ goalId }).length, 2, `${status}: no intent recorded`);
    });
  }
});

test('only the step\'s exact key matches, and every status has one outcome', () => {
  // Records that do not match the staging deploy: the deploy runs once and the stage directive follows.
  const others: [string, (a: ReleaseAttempt, goalId: string) => { goalId: string; idempotencyKey?: string }][] = [
    ['no key', (_a, goalId) => ({ goalId })],
    ['an empty key', (_a, goalId) => ({ goalId, idempotencyKey: '' })],
    ['another candidate digest', (a, goalId) => ({ goalId, idempotencyKey: `${a.id}:stage-deploy:c2` })],
    ['the key of another step', (a, goalId) => ({ goalId, idempotencyKey: keyOf(a, 'apply-deploy') })],
    ['the key in another letter case', (a, goalId) => ({ goalId, idempotencyKey: keyOf(a, 'stage-deploy').toUpperCase() })],
    ['the exact key under another goal', (a) => ({ goalId: 'g-other', idempotencyKey: keyOf(a, 'stage-deploy') })],
  ];
  for (const [label, fields] of others) {
    stageCase(({ fx, goalId, attempt, runner, runs }) => {
      record(fx, 1, { ...fields(attempt, goalId), status: 'intended' });
      const r = releaseRunner(fx, runner).next(fx.goal(goalId), attempt);
      assert.equal(r.directive.kind, 'stage', `${label}: ${r.directive.narration}`);
      assert.equal(runs['deploy-cmd'], 1, label);
    });
  }
  // An exact-key record of the step's kind: an unresolved status waits (R5), a terminal one becomes the step (R7).
  for (const status of [...UNRESOLVED, ...TERMINAL]) {
    stageCase(({ fx, goalId, attempt, runner, runs }) => {
      const id = record(fx, 1, { goalId, idempotencyKey: keyOf(attempt, 'stage-deploy'), status });
      const r = releaseRunner(fx, runner).next(fx.goal(goalId), attempt);
      if (UNRESOLVED.includes(status)) assertReconcileWait(r.directive, attempt, [id]);
      else {
        assert.equal(r.directive.kind, status === 'succeeded' ? 'stage' : 'stop', `${status}: ${r.directive.narration}`);
        assert.deepEqual(r.attempt.steps.find((s) => s.name === 'stage-deploy'), { name: 'stage-deploy', status: status === 'succeeded' ? 'succeeded' : 'failed', operationId: id });
        if (status !== 'succeeded') assert.equal(r.attempt.stop?.detail, 'staging deployment failed');
      }
      assert.equal(runs['deploy-cmd'], undefined, status);
    });
  }
  // A succeeded and an intended match together wait on the intended one.
  stageCase(({ fx, goalId, attempt, runner, runs }) => {
    record(fx, 2, { goalId, idempotencyKey: keyOf(attempt, 'stage-deploy'), status: 'succeeded' });
    const open = record(fx, 1, { goalId, idempotencyKey: keyOf(attempt, 'stage-deploy'), status: 'intended' });
    assertReconcileWait(releaseRunner(fx, runner).next(fx.goal(goalId), attempt).directive, attempt, [open]);
    assert.equal(runs['deploy-cmd'], undefined);
  });
  // Three terminal matches are adopted as the last in ledger order; the evidence takes the environment from the record's
  // target and the candidate digest from the attempt.
  stageCase(({ fx, goalId, attempt, runner, runs }) => {
    record(fx, 3, { goalId, idempotencyKey: keyOf(attempt, 'stage-deploy'), status: 'failed' });
    record(fx, 2, { goalId, idempotencyKey: keyOf(attempt, 'stage-deploy'), status: 'succeeded' });
    const last = record(fx, 1, { goalId, idempotencyKey: keyOf(attempt, 'stage-deploy'), target: 'staging-b', candidateDigest: 'c-record', status: 'failed', error: 'exit 3' });
    const r = releaseRunner(fx, runner).next(fx.goal(goalId), attempt);
    assert.equal(r.attempt.stop?.reason, 'release-health', r.directive.narration);
    assert.deepEqual(r.attempt.steps.find((s) => s.name === 'stage-deploy'), { name: 'stage-deploy', status: 'failed', operationId: last });
    assert.deepEqual(r.attempt.operations, [last]);
    assert.deepEqual(r.attempt.evidence.map((e) => [e.id, e.kind, e.environment, e.candidateDigest, e.note]), [[`op-${last}`, 'deploy', 'staging-b', 'c1', 'exit 3']]);
    assert.equal(runs['deploy-cmd'], undefined);
  });
  // An attempt without a candidate digest keys its steps with `na`, and one with an empty digest leaves the last part empty.
  for (const [label, digest, suffix] of [['no candidate digest', undefined, 'na'], ['an empty candidate digest', '', '']] as const) {
    stageCase(
      ({ fx, goalId, attempt, runner, runs }) => {
        const id = record(fx, 1, { goalId, idempotencyKey: `${attempt.id}:stage-deploy:${suffix}`, status: 'intended' });
        assertReconcileWait(releaseRunner(fx, runner).next(fx.goal(goalId), attempt).directive, attempt, [id]);
        assert.equal(runs['deploy-cmd'], undefined, label);
      },
      { candidateDigest: digest },
    );
  }
  // An attempt that already lists the adopted operation and its evidence keeps one of each.
  inFixture((fx) => {
    const { runner, runs } = countingRunner();
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goalId = goalForCards(fx, ['T1-HELLO'], { target: 'staging' }).id;
    const id = record(fx, 1, { goalId, idempotencyKey: `rel-${goalId}-1:stage-deploy:c1`, status: 'succeeded' });
    const { attempt } = attemptAt(fx, 'STAGE', goalId, { operations: [id], evidence: [{ id: `op-${id}`, kind: 'deploy', createdAt: T0, candidateDigest: 'c1', environment: 'staging' }] });
    const r = releaseRunner(fx, runner).next(fx.goal(goalId), attempt);
    assert.equal(r.directive.kind, 'stage', r.directive.narration);
    assert.deepEqual(r.attempt.operations, [id]);
    assert.deepEqual(r.attempt.evidence.map((e) => e.id), [`op-${id}`]);
    assert.equal(runs['deploy-cmd'], undefined);
  });
  // The step's records are read before its binding: with the deploy role unbound, an intended match still waits.
  stageCase(({ fx, goalId, attempt, runner }) => {
    const load = opsConfigured();
    const unbound: OpsLoad = load.status === 'configured' ? { ...load, config: { ...load.config, operations: load.config.operations.filter((o) => o.role !== 'deploy') } } : load;
    const id = record(fx, 1, { goalId, idempotencyKey: keyOf(attempt, 'stage-deploy'), status: 'intended' });
    assertReconcileWait(releaseRunner(fx, runner, unbound).next(fx.goal(goalId), attempt).directive, attempt, [id]);
  });
  // An exact-key record of another kind stops the attempt for audit, whatever its status.
  for (const status of [...UNRESOLVED, ...TERMINAL]) {
    stageCase(({ fx, goalId, attempt, runner, runs }) => {
      const id = record(fx, 1, { goalId, kind: 'rollback', idempotencyKey: keyOf(attempt, 'stage-deploy'), status });
      const events = fx.events(goalId).length;
      const r = releaseRunner(fx, runner).next(fx.goal(goalId), attempt);
      assert.equal(r.directive.kind, 'stop', `${status}: ${r.directive.narration}`);
      const stored = fx.store.getRelease(attempt.id)!;
      assert.equal(stored.state, 'STOP');
      assert.equal(stored.stop?.reason, 'audit');
      for (const part of [id, 'rollback', 'stage-deploy']) assert.ok(stored.stop?.detail.includes(part), `${status}: ${stored.stop?.detail}`);
      assert.equal(stored.stop?.nextAction, 'reconcile the ledger record by hand; the release step is not issued again');
      assert.equal(stored.stop?.global, false);
      assert.equal(stored.disposition, 'failed');
      assert.equal(runs['deploy-cmd'], undefined, status);
      assert.equal(fx.ops.list({ goalId }).length, 1, `${status}: no intent recorded`);
      assert.equal(fx.events(goalId).length, events, `${status}: no journal event`);
    });
  }
});

test('an adopted production deploy and an adopted recovery keep the effects of the transitions that follow', () => {
  type Adopted = { fx: Fx; r: ReturnType<ReleaseRunner['next']>; runs: Record<string, number>; goalId: string };
  const check = (label: string, state: 'APPLY' | 'RECOVER', status: OperationStatus, authorized: boolean, expect: (o: Adopted) => void) =>
    inFixture((fx) => {
      const { runner, runs } = countingRunner();
      writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
      const goalId = goalForCards(fx, ['T1-HELLO'], { target: 'production' }).id;
      const recovery = { eligibleBaseline: 'v1.4.2', healthTrigger: 'http_5xx_rate >= 1 over 5m', procedure: 'recover-cmd', migrationCompatibility: 'schema unchanged', windowMs: 30 * MINUTE_MS, owner: 'sre-oncall' };
      if (authorized) fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'recovery', by: 'sre-lead', candidateDigest: 'c1', environment: 'production', operations: [], recovery } });
      const { attempt } = attemptAt(fx, state, goalId);
      record(fx, 1, { goalId, kind: state === 'APPLY' ? 'deploy' : 'rollback', target: 'production', idempotencyKey: keyOf(attempt, state === 'APPLY' ? 'apply-deploy' : 'recover'), status });
      expect({ fx, r: releaseRunner(fx, runner).next(fx.goal(goalId), attempt), runs, goalId });
      assert.equal(runs['deploy-cmd'], undefined, `${label}: no deploy command ran`);
    });
  check('succeeded apply-deploy', 'APPLY', 'succeeded', false, ({ r }) => assert.equal(r.attempt.state, 'OBSERVE', r.directive.narration));
  for (const status of ['failed', 'cancelled'] as const) {
    check(`${status} apply-deploy, authorized`, 'APPLY', status, true, ({ r, runs, fx, goalId }) => {
      assert.equal(r.attempt.state, 'RECOVER', r.directive.narration);
      assert.equal(runs['recover-cmd'], 1, 'the recovery is issued once');
      assert.deepEqual(fx.ops.list({ goalId, kind: 'rollback' }).map((o) => o.status), ['succeeded']);
    });
    check(`${status} apply-deploy, not authorized`, 'APPLY', status, false, ({ r, fx }) => {
      assert.equal(r.directive.kind, 'stop', r.directive.narration);
      assert.equal(fx.store.getRelease(r.attempt.id)!.stop?.reason, 'rollback-auth');
    });
  }
  check('succeeded recover', 'RECOVER', 'succeeded', true, ({ r, runs }) => {
    assert.equal(r.directive.kind, 'recover', r.directive.narration);
    assert.ok(r.directive.narration.includes('recover-verify'), r.directive.narration);
    assert.deepEqual(r.attempt.evidence.map((e) => [e.kind, e.environment]), [['recovery', 'production']]);
    assert.equal(runs['recover-cmd'], undefined);
  });
  check('failed recover', 'RECOVER', 'failed', true, ({ r, runs }) => {
    assert.equal(r.attempt.stop?.reason, 'release-health', r.directive.narration);
    assert.equal(r.attempt.stop?.detail, 'recovery procedure failed');
    assert.equal(runs['recover-cmd'], undefined);
  });
});

test('two callers of one step record one intent and dispatch once', () => {
  stageCase(({ fx, goalId, attempt, runner, runs }) => {
    // The second caller: same session and state directory, a lease store that gives up on a held lock after 50 ms.
    const second = releaseRunner(fx, runner, opsConfigured(), { leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }) });
    const racing = new OperationLedger(fx.paths.operations);
    const recordIntent = racing.recordIntent.bind(racing);
    let nested: unknown = 'not run';
    let recordedByNested = -1;
    racing.recordIntent = (intent, now) => {
      if (nested === 'not run') {
        try {
          second.next(fx.goal(goalId), fx.store.getRelease(attempt.id)!);
          nested = 'returned';
        } catch (err) {
          nested = err;
        }
        recordedByNested = fx.ops.list({ goalId }).length;
      }
      return recordIntent(intent, now);
    };
    const first = releaseRunner(fx, runner, opsConfigured(), { ops: racing });
    const r = first.next(fx.goal(goalId), attempt);
    assert.equal(runs['deploy-cmd'], 1, 'the deploy is dispatched once');
    assert.ok(nested instanceof StoreError && nested.code === 'LOCKED', `the nested call fails with LOCKED: ${String(nested)}`);
    assert.equal(recordedByNested, 0, 'the nested call records nothing');
    assert.equal(r.directive.kind, 'stage', r.directive.narration);
    assert.equal(first.next(fx.goal(goalId), fx.store.getRelease(attempt.id)!).directive.kind, 'stage');
    assert.equal(fx.ops.list({ goalId }).length, 1);
    assert.equal(runs['deploy-cmd'], 1);
  });
});
