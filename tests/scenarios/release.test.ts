import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, driveCardToDone, opsConfigured, opsNotConfigured, opsRunner, candidateShaFor, T0 } from './_harness.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import { ReleaseAttempt, HOUR_MS, MINUTE_MS, addMs, type HealthSignal, type ReleaseState } from '../../src/core/types.ts';
import { DeliveryOpsConfig, type OpsLoad } from '../../src/delivery/ops.ts';

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

test('the approval packet is read without advancing the attempt: no save, no journal event, no deploy, before and after the authority is recorded', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'production');
    const runner = releaseRunner(fx, opsConfigured(), () => []);
    let attempt = runner.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    stagingAuth(fx, goalId, 'c1');
    // Before CHECKPOINT there is no packet, and asking for one issues nothing.
    assert.equal(runner.checkpointPacket(fx.goal(goalId), attempt), undefined);
    assert.equal(fx.ops.list({ goalId, kind: 'deploy' }).length, 0, 'asking for the packet in PREPARE deploys nothing');
    let r = runner.next(fx.goal(goalId), attempt);
    attempt = runner.reportStep(fx.goal(goalId), r.attempt, 'stage-verify', 'succeeded');
    r = runner.next(fx.goal(goalId), attempt);
    assert.equal(r.attempt.state, 'CHECKPOINT');
    const observed = () => ({ events: fx.journal(goalId).readAll().length, deploys: fx.ops.list({ goalId, kind: 'deploy' }).length, attempt: JSON.stringify(fx.store.getRelease(attemptId)) });
    const before = observed();
    const waiting = runner.checkpointPacket(fx.goal(goalId), r.attempt);
    assert.equal(waiting?.kind, 'checkpoint');
    assert.equal(waiting?.packet['environment'], 'production');
    assert.equal(waiting?.packet['candidateDigest'], 'c1');
    assert.deepEqual(waiting, r.directive, 'the packet command prints the directive release next returned');
    assert.deepEqual(observed(), before);
    // With the matching authority recorded the packet is still only read: release next is the command that applies.
    fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: 'c1', environment: 'production', operations: ['deploy'] } });
    const authorized = observed();
    const ready = runner.checkpointPacket(fx.goal(goalId), fx.store.getRelease(attemptId)!);
    assert.equal(ready?.kind, 'checkpoint');
    assert.match(ready?.narration ?? '', /authority is recorded/);
    assert.deepEqual(observed(), authorized);
    assert.equal(fx.store.getRelease(attemptId)!.state, 'CHECKPOINT');
    assert.equal(fx.ops.list({ goalId, kind: 'deploy' }).filter((o) => o.target === 'production').length, 0, 'reading the packet never deploys to production');
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

test('T0-PROD-GOAL-STAGES acceptance 1: a production goal driven through a verified staging and a delivered attempt reaches DONE with every stage passed', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'production');
    const runner = releaseRunner(fx, opsConfigured(), () => [signal(0.1, fx.now())]);
    const attempt = runner.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    stagingAuth(fx, goalId, 'c1');
    let r = runner.next(fx.goal(goalId), attempt);
    r = runner.next(fx.goal(goalId), runner.reportStep(fx.goal(goalId), r.attempt, 'stage-verify', 'succeeded'));
    assert.equal(r.attempt.state, 'CHECKPOINT');
    fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: 'c1', environment: 'production', operations: ['deploy'] } });
    r = runner.next(fx.goal(goalId), r.attempt);
    assert.equal(r.attempt.state, 'OBSERVE', r.directive.narration);
    r = runner.next(fx.goal(goalId), r.attempt);
    fx.advance(Date.parse(r.attempt.healthWindow!.to) - Date.parse(fx.now()) + MINUTE_MS);
    r = runner.next(fx.goal(goalId), r.attempt);
    assert.equal(r.attempt.state, 'CLOSE', r.directive.narration);
    r = runner.next(fx.goal(goalId), r.attempt);
    assert.equal(r.attempt.disposition, 'delivered');
    const done = fx.controller.next(goalId);
    assert.equal(done.kind, 'done', done.narration);
    assert.equal(fx.goal(goalId).state, 'DONE');
    const { development, staging, production } = fx.goal(goalId).stages;
    assert.deepEqual({ development, staging, production }, { development: 'pass', staging: 'pass', production: 'pass' });
  } finally {
    fx.cleanup();
  }
});

for (const [label, steps] of [['no stage-verify step', []], ['a failed stage-verify step', [{ name: 'stage-verify', status: 'failed' }]]] as const) {
  test(`T0-PROD-GOAL-STAGES acceptance 2 and 3: a delivered production attempt with ${label} leaves staging pending and the goal in CLOSE`, () => {
    const fx = makeFixture();
    try {
      const { goalId, attemptId } = toDeliver(fx, 'production');
      fx.store.saveRelease(ReleaseAttempt.parse({ ...fx.store.getRelease(attemptId)!, state: 'DONE', disposition: 'delivered', steps }));
      const d = fx.controller.next(goalId);
      assert.equal(d.kind, 'close', d.narration);
      if (d.kind === 'close') assert.deepEqual(d.missing, ['stage staging=pending']);
      assert.equal(fx.goal(goalId).state, 'CLOSE');
      assert.equal(fx.goal(goalId).stages.production, 'pass');
    } finally {
      fx.cleanup();
    }
  });
}

test('a release command refuses a --goal that does not own the attempt, and writes nothing', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'staging');
    writeCard(fx, { id: 'T1-OTHER', title: 'another goal' });
    const other = goalForCards(fx, ['T1-OTHER']);
    const before = JSON.stringify(fx.store.getRelease(attemptId));
    const cli = (...args: string[]) => spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), ...args], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000 });
    for (const args of [['release', 'next', attemptId], ['release', 'report', attemptId, '--step', 'stage-verify', '--status', 'succeeded'], ['release', 'candidate', attemptId, '--digest', 'c1', '--sha', 'a'.repeat(40)]]) {
      const refused = cli(...args, '--goal', other.id);
      assert.notEqual(refused.status, 0, args.join(' '));
      assert.ok(refused.stderr.includes(`release attempt ${attemptId} belongs to goal ${goalId}, not ${other.id}`), refused.stderr);
      assert.equal(JSON.stringify(fx.store.getRelease(attemptId)), before, args.join(' '));
    }
    // The owning goal, named or not, is accepted as before.
    assert.equal(cli('release', 'candidate', attemptId, '--digest', 'c1', '--sha', 'a'.repeat(40), '--goal', goalId).status, 0);
    assert.equal(fx.store.getRelease(attemptId)!.candidateDigest, 'c1');
  } finally {
    fx.cleanup();
  }
});

test('a package attempt asks for its run proof by the command that records it', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO'], { target: 'package' });
    driveCardToDone(fx, goal.id, 'T1-HELLO');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    const rep = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
    const attemptId = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
    assert.ok(attemptId, JSON.stringify(rep.directive));
    const packageOps: OpsLoad = { status: 'configured', file: 'memory', config: DeliveryOpsConfig.parse({ schemaVersion: 1, environments: {}, operations: [{ role: 'build', command: ['build-cmd'] }, { role: 'package', command: ['package-cmd'] }] }) };
    const runner = releaseRunner(fx, packageOps);
    const attempt = runner.setCandidate(fx.goal(goal.id), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    const r = runner.next(fx.goal(goal.id), attempt);
    assert.equal(r.directive.kind, 'prepare');
    const narration = r.directive.kind === 'prepare' ? r.directive.narration : '';
    assert.ok(narration.includes(`aidlc release report ${attemptId} --step package-run-proof --status succeeded`), narration);
    // The step and status the narration names are the ones that deliver the attempt.
    assert.equal(runner.reportStep(fx.goal(goal.id), r.attempt, 'package-run-proof', 'succeeded').state, 'DONE');
  } finally {
    fx.cleanup();
  }
});
