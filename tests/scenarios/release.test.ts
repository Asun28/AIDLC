import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, driveCardToDone, opsConfigured, opsNotConfigured, opsRunner, candidateShaFor, T0 } from './_harness.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import { ReleaseAttempt, HOUR_MS, MINUTE_MS, addMs, type HealthSignal, type ReleaseState } from '../../src/core/types.ts';
import type { OpsLoad } from '../../src/delivery/ops.ts';

type Fx = ReturnType<typeof makeFixture>;

/** Drive a staging/production goal to DELIVER and return the created attempt id. */
function toDeliver(fx: Fx, target: 'staging' | 'production'): { goalId: string; attemptId: string } {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goal = goalForCards(fx, ['T1-HELLO'], { target });
  assert.equal(goal.target, target);
  assert.equal(goal.stages.staging, 'pending');
  driveCardToDone(fx, goal.id, 'T1-HELLO');
  assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
  const rep = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
  assert.equal(fx.goal(goal.id).state, 'DELIVER');
  assert.equal(rep.directive.kind, 'release');
  const attemptId = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
  assert.ok(attemptId);
  return { goalId: goal.id, attemptId };
}

function releaseRunner(fx: Fx, opsLoad: OpsLoad, signals?: (a: ReleaseAttempt) => HealthSignal[]): ReleaseRunner {
  return new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store, ops: fx.ops, leases: fx.leases, runner: opsRunner, opsLoad, now: fx.now, signals });
}

function stagingAuth(fx: Fx, goalId: string, candidateDigest: string) {
  fx.controller.report({ goalId, generation: fx.goal(goalId).generation, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest, environment: 'staging' } });
}

test('Q16: a staging goal reaches DELIVER and stops with release-config when no provider operations are bound', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'staging');
    const runner = releaseRunner(fx, opsNotConfigured);
    const goal = fx.goal(goalId);
    let attempt = fx.store.getRelease(attemptId)!;
    assert.equal(attempt.state, 'PREPARE');
    // Without a candidate the runner asks for one rather than stopping.
    let r = runner.next(goal, attempt);
    assert.equal(r.directive.kind, 'prepare');
    if (r.directive.kind === 'prepare') assert.ok(r.directive.needs.some((n) => /candidate/.test(n)));

    attempt = runner.setCandidate(goal, attempt, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    r = runner.next(goal, attempt);
    assert.equal(r.directive.kind, 'stop');
    assert.equal(r.attempt.state, 'STOP');
    assert.equal(r.attempt.stop?.reason, 'release-config');
    assert.equal(r.attempt.disposition, 'failed');
    assert.ok(/NOT CONFIGURED/.test(r.attempt.stop?.detail ?? ''));
    // Reporting the stopped attempt stops the goal with the same reason and never marks staging as passed.
    const rep = fx.controller.report({ goalId, generation: 0, result: 'release-result', attemptId, data: { attempt: r.attempt } });
    assert.equal(rep.directive.kind, 'stop');
    assert.equal(fx.goal(goalId).stages.staging, 'fail');
    assert.equal(fx.goal(goalId).stop?.reason, 'release-config');
  } finally {
    fx.cleanup();
  }
});

test('Q16: a staging goal with a synchronous bound deploy finishes after staging verification and never enters CHECKPOINT', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'staging');
    const runner = releaseRunner(fx, opsConfigured());
    let attempt = runner.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    stagingAuth(fx, goalId, 'c1');
    const seen: ReleaseState[] = [];
    let r = runner.next(fx.goal(goalId), attempt);
    seen.push(r.attempt.state);
    assert.equal(r.directive.kind, 'stage', r.directive.narration);
    assert.equal(r.attempt.environment, 'staging');
    assert.equal(r.attempt.steps.find((s) => s.name === 'stage-deploy')?.status, 'succeeded');
    const ops = fx.ops.list({ goalId, kind: 'deploy' });
    assert.equal(ops.length, 1);
    assert.equal(ops[0]!.status, 'succeeded');
    assert.equal(ops[0]!.target, 'staging');
    const types = fx.events(goalId).map((e) => e.type);
    assert.ok(types.indexOf('OPERATION_INTENT') < types.indexOf('OPERATION_ISSUED'), 'intent journaled before issue');

    attempt = runner.reportStep(fx.goal(goalId), r.attempt, 'stage-verify', 'succeeded', 'smoke + health ok on c1');
    r = runner.next(fx.goal(goalId), attempt);
    seen.push(r.attempt.state);
    assert.equal(r.directive.kind, 'done');
    assert.equal(r.attempt.state, 'DONE');
    assert.equal(r.attempt.disposition, 'delivered');
    assert.ok(!seen.includes('CHECKPOINT') && !seen.includes('APPLY'), 'staging never promotes');

    const rep = fx.controller.report({ goalId, generation: 0, result: 'release-result', attemptId, data: { attempt: r.attempt } });
    const d = fx.controller.next(goalId);
    assert.ok(['close', 'done'].includes(d.kind), `goal continues to closure: ${d.kind}`);
    assert.equal(fx.goal(goalId).stages.staging, 'pass');
    assert.equal(fx.goal(goalId).stages.production, 'not_requested');
    assert.ok(rep.goal);
  } finally {
    fx.cleanup();
  }
});

test('Q18: an asynchronous deploy is issued, waited on, reconciled by status lookup and then verified', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'staging');
    const runner = releaseRunner(fx, opsConfigured({ asyncDeploy: true }));
    const attempt = runner.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    stagingAuth(fx, goalId, 'c1');
    let r = runner.next(fx.goal(goalId), attempt);
    assert.equal(r.directive.kind, 'wait', 'exit zero of an async deploy is not completion');
    const op = fx.ops.list({ goalId, kind: 'deploy' })[0]!;
    assert.equal(op.status, 'running');
    assert.equal(op.providerOperationId, 'dep1');
    assert.equal(r.attempt.steps.find((s) => s.name === 'stage-deploy')?.status, 'running');

    r = runner.next(fx.goal(goalId), r.attempt);
    assert.equal(fx.ops.get(op.id)?.status, 'succeeded', 'status lookup reconciled the operation');
    // BUG: src/loop/release-runner.ts next() — reconciliation updates the operation ledger but never
    // propagates the outcome into attempt.steps, so `stage-deploy` stays 'running' and the STAGE branch
    // answers `wait` forever. Expected: after reconciliation the step is 'succeeded' and the runner asks
    // for stage-verify (directive 'stage').
    assert.equal(r.directive.kind, 'stage', `expected stage after reconciliation, got ${r.directive.kind}: ${r.directive.narration}`);
    assert.equal(r.attempt.steps.find((s) => s.name === 'stage-deploy')?.status, 'succeeded');
  } finally {
    fx.cleanup();
  }
});

test('Q17: a production goal presents the checkpoint packet for the production environment and waits for matching authority', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'production');
    const runner = releaseRunner(fx, opsConfigured());
    let attempt = runner.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    stagingAuth(fx, goalId, 'c1');
    let r = runner.next(fx.goal(goalId), attempt);
    assert.equal(r.directive.kind, 'stage');
    attempt = runner.reportStep(fx.goal(goalId), r.attempt, 'stage-verify', 'succeeded');
    r = runner.next(fx.goal(goalId), attempt);
    assert.equal(r.directive.kind, 'checkpoint');
    assert.equal(r.attempt.state, 'CHECKPOINT');
    if (r.directive.kind === 'checkpoint') {
      assert.equal(r.directive.packet['candidateDigest'], 'c1');
      // BUG: src/loop/release-runner.ts CHECKPOINT branch — `defaultEnvironment('production', attempt.environment)`
      // returns the staging environment because the fallback wins, so the packet (and the later APPLY) name
      // 'staging' as the production environment. Expected: the packet names the ops config's production
      // environment ('production'), and the authority check binds to it.
      assert.equal(r.directive.packet['environment'], 'production', `packet environment: ${String(r.directive.packet['environment'])}`);
    }
    // Without authority the checkpoint is presented again, not applied.
    r = runner.next(fx.goal(goalId), r.attempt);
    assert.equal(r.directive.kind, 'checkpoint');
    assert.equal(fx.ops.list({ goalId, kind: 'deploy' }).length, 1, 'only the staging deploy has been issued');
  } finally {
    fx.cleanup();
  }
});

test('Q17: a production checkpoint applies only with authority bound to candidate + production environment + operations', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'production');
    const runner = releaseRunner(fx, opsConfigured(), () => []);
    let attempt = runner.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    stagingAuth(fx, goalId, 'c1');
    let r = runner.next(fx.goal(goalId), attempt);
    attempt = runner.reportStep(fx.goal(goalId), r.attempt, 'stage-verify', 'succeeded');
    r = runner.next(fx.goal(goalId), attempt);
    assert.equal(r.attempt.state, 'CHECKPOINT');
    // A production approval for a different candidate is not carried over.
    fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: 'c-other', environment: 'production', operations: ['deploy'] } });
    r = runner.next(fx.goal(goalId), r.attempt);
    assert.equal(r.directive.kind, 'checkpoint', 'stale/other-candidate approval does not apply');
    // Matching authority applies.
    fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: 'c1', environment: 'production', operations: ['deploy'] } });
    // BUG: src/loop/release-runner.ts guards() — effects.operations is `attempt.operations`, which holds
    // the ledger's operation record ids (op-...), not operation roles, and effects.environment is still
    // 'staging' at CHECKPOINT (see the packet bug above). A correctly bound production authority
    // (candidate c1, environment 'production', operations ['deploy']) therefore never matches and the
    // checkpoint is presented forever. Expected: APPLY issues the production deploy and OBSERVE begins.
    r = runner.next(fx.goal(goalId), r.attempt);
    assert.equal(r.attempt.state, 'OBSERVE', `expected APPLY -> OBSERVE, got ${r.attempt.state}: ${r.directive.narration}`);
    assert.equal(r.attempt.environment, 'production');
    assert.equal(fx.ops.list({ goalId, kind: 'deploy' }).filter((o) => o.target === 'production').length, 1);
  } finally {
    fx.cleanup();
  }
});

/** Build a production attempt directly in OBSERVE to exercise health, recovery and closure in isolation. */
function observing(fx: Fx, goalId: string, overrides: Partial<ReleaseAttempt> = {}): ReleaseAttempt {
  const attempt = ReleaseAttempt.parse({
    id: `rel-${goalId}-obs`,
    goalId,
    generation: 0,
    target: 'production',
    environment: 'production',
    state: 'OBSERVE',
    candidateDigest: 'c1',
    sourceSha: 's1',
    healthWindow: { from: T0, to: addMs(T0, 10 * MINUTE_MS) },
    startedAt: T0,
    deadline: addMs(T0, 12 * HOUR_MS),
    updatedAt: T0,
    ...overrides,
  });
  fx.store.saveRelease(attempt);
  return attempt;
}

function signal(observed: number, at: string): HealthSignal {
  return { name: 'http_5xx_rate', source: 'prometheus', threshold: { op: '<', value: 1 }, observed, samples: 20, minSamples: 5, lastSampleAt: at, maxStalenessMs: 5 * MINUTE_MS, synthetic: false, probeAvailable: true };
}

test('Q19: health PASS closes only after the window elapsed; waiting never becomes PASS', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO'], { target: 'production' });
    const attempt = observing(fx, goal.id);
    const runner = releaseRunner(fx, opsConfigured(), () => [signal(0.1, fx.now())]);
    let r = runner.next(fx.goal(goal.id), attempt);
    assert.equal(r.directive.kind, 'observe', 'window still open');
    assert.equal(r.attempt.state, 'OBSERVE');
    assert.equal(r.attempt.healthResult, 'PASS');
    fx.advance(11 * MINUTE_MS);
    r = runner.next(fx.goal(goal.id), r.attempt);
    assert.equal(r.directive.kind, 'close');
    assert.equal(r.attempt.state, 'CLOSE');
    r = runner.next(fx.goal(goal.id), r.attempt);
    assert.equal(r.directive.kind, 'done');
    assert.equal(r.attempt.disposition, 'delivered');
    assert.ok(fx.events(goal.id).some((e) => e.type === 'HEALTH_EVALUATED' && e.data['result'] === 'PASS'));
  } finally {
    fx.cleanup();
  }
});

test('Q19: insufficient telemetry past the maximum wait is STOP/release-health, never PASS', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO'], { target: 'production' });
    const attempt = observing(fx, goal.id);
    const runner = releaseRunner(fx, opsConfigured(), () => []);
    let r = runner.next(fx.goal(goal.id), attempt);
    assert.equal(r.directive.kind, 'observe');
    assert.equal(r.attempt.healthResult, 'INSUFFICIENT_DATA');
    fx.advance(10 * MINUTE_MS + 31 * MINUTE_MS);
    r = runner.next(fx.goal(goal.id), r.attempt);
    assert.equal(r.directive.kind, 'stop');
    assert.equal(r.attempt.stop?.reason, 'release-health');
    assert.equal(r.attempt.disposition, 'failed');
  } finally {
    fx.cleanup();
  }
});

test('Q22: a health BREACH without recovery authority is STOP/rollback-auth', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO'], { target: 'production' });
    const attempt = observing(fx, goal.id);
    const runner = releaseRunner(fx, opsConfigured(), () => [signal(7.5, fx.now())]);
    const r = runner.next(fx.goal(goal.id), attempt);
    assert.equal(r.directive.kind, 'stop');
    assert.equal(r.attempt.stop?.reason, 'rollback-auth');
    assert.equal(fx.ops.list({ goalId: goal.id, kind: 'rollback' }).length, 0, 'no recovery issued without authority');
  } finally {
    fx.cleanup();
  }
});

test('Q22: a BREACH with a real recovery pre-authorization recovers, verifies and closes as recovered, never delivered', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO'], { target: 'production' });
    fx.controller.report({
      goalId: goal.id,
      generation: 0,
      result: 'approved',
      data: { kind: 'recovery', by: 'sre-lead', candidateDigest: 'c1', environment: 'production', operations: [], recovery: { eligibleBaseline: 'v1.4.2', healthTrigger: 'http_5xx_rate >= 1 over 5m', procedure: 'recover-cmd', migrationCompatibility: 'schema unchanged', windowMs: 30 * MINUTE_MS, owner: 'sre-oncall' } },
    });
    const attempt = observing(fx, goal.id);
    const runner = releaseRunner(fx, opsConfigured(), () => [signal(7.5, fx.now())]);
    let r = runner.next(fx.goal(goal.id), attempt);
    assert.equal(r.directive.kind, 'recover', r.directive.narration);
    assert.equal(r.attempt.state, 'RECOVER');
    assert.equal(r.attempt.disposition, 'recovered');
    const rollback = fx.ops.list({ goalId: goal.id, kind: 'rollback' });
    assert.equal(rollback.length, 1);
    assert.equal(rollback[0]!.status, 'succeeded');
    assert.equal(r.attempt.steps.find((s) => s.name === 'recover')?.status, 'succeeded');

    const verified = runner.reportStep(fx.goal(goal.id), r.attempt, 'recover-verify', 'succeeded', 'baseline restored');
    r = runner.next(fx.goal(goal.id), verified);
    assert.equal(r.directive.kind, 'close');
    r = runner.next(fx.goal(goal.id), r.attempt);
    assert.equal(r.directive.kind, 'done');
    assert.equal(r.attempt.state, 'DONE');
    assert.equal(r.attempt.disposition, 'recovered');
    assert.notEqual(r.attempt.disposition, 'delivered');
  } finally {
    fx.cleanup();
  }
});
