import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { makeFixture, writeCard, goalForCards, driveCardToDone, opsConfigured, opsRunner, candidateShaFor, T0 } from './_harness.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import { runGoal } from '../../src/loop/run-driver.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { ReleaseAttempt } from '../../src/core/types.ts';
import { DeliveryOpsConfig } from '../../src/delivery/ops.ts';

type Fx = ReturnType<typeof makeFixture>;
type Target = 'staging' | 'production' | 'migration';

/** Drive a goal to DELIVER and return the attempt the controller created (PREPARE). */
function toDeliver(fx: Fx, target: Target): { goalId: string; attemptId: string } {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goal = goalForCards(fx, ['T1-HELLO'], { target });
  driveCardToDone(fx, goal.id, 'T1-HELLO');
  assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
  const rep = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
  assert.equal(rep.directive.kind, 'release');
  return { goalId: goal.id, attemptId: rep.directive.kind === 'release' ? rep.directive.attemptId : '' };
}

function runnerOf(fx: Fx): ReleaseRunner {
  return new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store, ops: fx.ops, leases: fx.leases, runner: opsRunner, opsLoad: opsConfigured(), now: fx.now, signals: () => [] });
}

function controllerWith(fx: Fx, releaseRunner: ReleaseRunner): GoalController {
  return new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry, releaseRunner });
}

/** A production attempt driven to CHECKPOINT by the runner on `opsConfigured()`. */
function toCheckpoint(fx: Fx, runner: ReleaseRunner, goalId: string, attemptId: string): ReleaseAttempt {
  let attempt = runner.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
  fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest: 'c1', environment: 'staging' } });
  let r = runner.next(fx.goal(goalId), attempt);
  attempt = runner.reportStep(fx.goal(goalId), r.attempt, 'stage-verify', 'succeeded');
  r = runner.next(fx.goal(goalId), attempt);
  assert.equal(r.attempt.state, 'CHECKPOINT');
  return r.attempt;
}

function releasePacket(c: GoalController, goalId: string): Record<string, unknown> {
  const d = c.next(goalId);
  assert.equal(d.kind, 'release');
  return d.kind === 'release' ? d.packet : {};
}

/** Store an attempt at CHECKPOINT the way a release-result patch would, with a populated digest, evidence and steps. */
function saveCheckpoint(fx: Fx, attemptId: string, extra: Partial<ReleaseAttempt> = {}): ReleaseAttempt {
  const attempt = ReleaseAttempt.parse({
    ...fx.store.getRelease(attemptId)!,
    state: 'CHECKPOINT',
    environment: 'staging',
    candidateDigest: 'c9',
    sourceSha: 'sha9',
    configDigest: 'cfg9',
    operations: ['op-record-1'],
    steps: [{ name: 'stage-deploy', status: 'succeeded' }, { name: 'stage-verify', status: 'succeeded' }],
    evidence: [{ id: 'ev-1', kind: 'health', createdAt: T0 }],
    ...extra,
  });
  return fx.store.saveRelease(attempt);
}

function opsFile(fx: Fx): string {
  return path.join(fx.tmp, 'aidlc.ops.json');
}

function writeOps(fx: Fx, environments: Record<string, { production: boolean }>): void {
  const base = opsConfigured();
  assert.equal(base.status, 'configured');
  const config = DeliveryOpsConfig.parse({ ...(base.status === 'configured' ? base.config : {}), environments });
  writeFileSync(opsFile(fx), JSON.stringify(config), 'utf8');
}

test("the goal's release directive at CHECKPOINT carries the runner's packet, and an authority recorded from it lets release next apply", () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'production');
    const runner = runnerOf(fx);
    const attempt = toCheckpoint(fx, runner, goalId, attemptId);
    const controller = controllerWith(fx, runner);
    const d = controller.next(goalId);
    assert.equal(d.kind, 'release');
    if (d.kind !== 'release') return;
    assert.deepEqual(d.packet, runner.checkpointPacket(fx.goal(goalId), attempt)!.packet);
    assert.equal(d.packet['environment'], 'production');
    assert.deepEqual(d.packet['operations'], ['deploy']);
    assert.equal(d.environment, 'staging', 'the directive keeps the attempt environment');
    controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: d.packet['candidateDigest'], sourceSha: d.packet['sourceSha'], environment: d.packet['environment'], operations: d.packet['operations'] } });
    const applied = runner.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
    assert.equal(applied.directive.kind, 'apply', applied.directive.narration);
    const deploys = fx.ops.list({ goalId, kind: 'deploy' }).filter((o) => o.target === 'production');
    assert.equal(deploys.length, 1);
  } finally {
    fx.cleanup();
  }
});

test('without an injected runner the controller packet equals the CLI\'s for every ops configuration', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'production');
    const cli = () => new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store });
    const compare = (attempt: ReleaseAttempt): Record<string, unknown> => {
      const packet = releasePacket(fx.controller, goalId);
      assert.deepEqual(packet, cli().checkpointPacket(fx.goal(goalId), attempt)!.packet);
      return packet;
    };

    // The production environment the file names.
    writeOps(fx, { staging: { production: false }, live: { production: true } });
    let attempt = saveCheckpoint(fx, attemptId);
    let packet = compare(attempt);
    assert.equal(packet['environment'], 'live');
    assert.deepEqual(packet['operations'], ['deploy']);
    assert.match(String(packet['recoveryPlan']), /recover-cmd/);
    assert.equal(packet['configDigest'], 'cfg9');
    assert.deepEqual(packet['evidence'], ['ev-1']);
    assert.deepEqual(packet['dataSteps'], ['stage-deploy:succeeded', 'stage-verify:succeeded']);

    // The file changes between two reads: the second packet follows it.
    writeOps(fx, { staging: { production: false }, live2: { production: true } });
    packet = compare(attempt);
    assert.equal(packet['environment'], 'live2');

    // No environment marked production: the fallback.
    writeOps(fx, { staging: { production: false } });
    packet = compare(attempt);
    assert.equal(packet['environment'], 'production');

    // The file holds text that does not parse.
    writeFileSync(opsFile(fx), 'this is { not json', 'utf8');
    packet = compare(attempt);
    assert.equal(packet['environment'], 'production');
    assert.equal(packet['recoveryPlan'], 'NOT CONFIGURED');

    // The file is absent.
    rmSync(opsFile(fx), { force: true });
    packet = compare(attempt);
    assert.equal(packet['environment'], 'production');
    assert.equal(packet['recoveryPlan'], 'NOT CONFIGURED');

    // An attempt with a database.
    writeOps(fx, { staging: { production: false }, live: { production: true } });
    attempt = saveCheckpoint(fx, attemptId, { database: 'main-db' });
    packet = compare(attempt);
    assert.deepEqual(packet['operations'], ['deploy', 'migration-apply']);
    assert.equal(packet['environment'], 'live');
  } finally {
    fx.cleanup();
  }
});

test('a migration attempt at CHECKPOINT carries the runner\'s packet', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'migration');
    writeOps(fx, { staging: { production: false }, live: { production: true } });
    const attempt = saveCheckpoint(fx, attemptId, { database: 'main-db' });
    const packet = releasePacket(fx.controller, goalId);
    assert.deepEqual(packet, new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store }).checkpointPacket(fx.goal(goalId), attempt)!.packet);
    assert.equal(packet['environment'], 'live');
    assert.deepEqual(packet['operations'], ['deploy', 'migration-apply']);
  } finally {
    fx.cleanup();
  }
});

test('reading the packet writes nothing', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'production');
    assert.deepEqual(releasePacket(fx.controller, goalId), {}, 'in PREPARE the packet is empty');
    const runner = runnerOf(fx);
    const attempt = toCheckpoint(fx, runner, goalId, attemptId);
    const controller = controllerWith(fx, runner);
    const observed = () => ({ events: fx.journal(goalId).readAll().length, ops: fx.ops.list({ goalId }).length, attempt: JSON.stringify(fx.store.getRelease(attemptId)) });
    const before = observed();
    const packet = releasePacket(controller, goalId);
    assert.equal(packet['environment'], 'production');
    assert.deepEqual(observed(), before);
    controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: packet['candidateDigest'], sourceSha: packet['sourceSha'], environment: packet['environment'], operations: packet['operations'] } });
    const after = observed();
    assert.deepEqual(releasePacket(controller, goalId), packet);
    assert.deepEqual(observed(), after);
    assert.equal(fx.store.getRelease(attemptId)!.state, 'CHECKPOINT');
    assert.equal(attempt.state, 'CHECKPOINT');
  } finally {
    fx.cleanup();
  }
});

test('an attempt at CHECKPOINT that is not a production step gets an empty packet', () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'staging');
    const rep = fx.controller.report({ goalId, generation: 0, result: 'release-result', attemptId, data: { attempt: { state: 'CHECKPOINT', candidateDigest: 'c1', sourceSha: 'sha1', environment: 'staging' } } });
    assert.equal(rep.directive.kind, 'release');
    assert.deepEqual(rep.directive.kind === 'release' ? rep.directive.packet : null, {});
    assert.deepEqual(releasePacket(fx.controller, goalId), {});
  } finally {
    fx.cleanup();
  }
});

test('run returns the release directive with the same packet and no provider call', async () => {
  const fx = makeFixture();
  try {
    const { goalId, attemptId } = toDeliver(fx, 'production');
    const runner = runnerOf(fx);
    const attempt = toCheckpoint(fx, runner, goalId, attemptId);
    const controller = controllerWith(fx, runner);
    const provider = new MockProvider();
    const d = await runGoal(goalId, 2, { controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(d.kind, 'release');
    assert.deepEqual(d.kind === 'release' ? d.packet : null, runner.checkpointPacket(fx.goal(goalId), attempt)!.packet);
    assert.equal(provider.calls.length, 0);
  } finally {
    fx.cleanup();
  }
});
