// Card T1-SWEEP2-DUPLICATES acceptance 2: the release runner, not a copy of the rule, puts a publishing deploy behind
// production authority (Q17): a `deploy` binding with `triggersPublication: true` is issued only when a production
// authorization names the environment it deploys to.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, driveCardToDone, opsConfigured, opsRunner, candidateShaFor } from './_harness.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import type { OpsLoad } from '../../src/delivery/ops.ts';

type Fx = ReturnType<typeof makeFixture>;

/** The scenario ops bindings with the deploy marked as one that triggers external publication (tag/release CD). */
function publishingOps(): OpsLoad {
  const load = opsConfigured();
  if (load.status !== 'configured') throw new Error('opsConfigured() must return a configured load');
  return { ...load, config: { ...load.config, operations: load.config.operations.map((o) => (o.role === 'deploy' ? { ...o, triggersPublication: true } : o)) } };
}

/** A staging goal driven to DELIVER with candidate c1 set and staging authority recorded, so the next step is the staging deploy. */
function stagingRelease(fx: Fx): { goalId: string; runner: ReleaseRunner; attemptId: string } {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goal = goalForCards(fx, ['T1-HELLO'], { target: 'staging' });
  driveCardToDone(fx, goal.id, 'T1-HELLO');
  assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
  const rep = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
  assert.equal(rep.directive.kind, 'release', rep.directive.narration);
  const attemptId = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
  const runner = new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store, ops: fx.ops, leases: fx.leases, runner: opsRunner, opsLoad: publishingOps(), now: fx.now });
  runner.setCandidate(fx.goal(goal.id), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest: 'c1', environment: 'staging' } });
  return { goalId: goal.id, runner, attemptId };
}

test('T1-SWEEP2-DUPLICATES acceptance 2: a publishing staging deploy stops release-auth with no operation issued when no production authorization names staging [R3]', () => {
  const fx = makeFixture();
  try {
    const { goalId, runner, attemptId } = stagingRelease(fx);
    // A production authorization for another environment does not cover the staging deploy.
    fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: 'c1', environment: 'production', operations: ['deploy'] } });
    const r = runner.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.attempt.state, 'STOP');
    assert.equal(r.attempt.stop?.reason, 'release-auth');
    assert.equal(r.attempt.stop?.detail, 'deploy triggers external publication and no production authority names staging');
    assert.deepEqual(fx.ops.list({ goalId }).filter((o) => o.releaseAttempt === attemptId), [], 'the release attempt records and issues no operation');
    assert.deepEqual(fx.ops.list({ goalId, kind: 'deploy' }), [], 'no deploy is recorded or issued');
  } finally {
    fx.cleanup();
  }
});

test('T1-SWEEP2-DUPLICATES acceptance 2: a publishing staging deploy is issued when a production authorization names staging [R3]', () => {
  const fx = makeFixture();
  try {
    const { goalId, runner, attemptId } = stagingRelease(fx);
    fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: 'c1', environment: 'staging', operations: ['deploy'] } });
    const r = runner.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
    assert.equal(r.directive.kind, 'stage', r.directive.narration);
    assert.equal(r.attempt.steps.find((s) => s.name === 'stage-deploy')?.status, 'succeeded');
    const deploys = fx.ops.list({ goalId, kind: 'deploy' });
    assert.equal(deploys.length, 1);
    assert.equal(deploys[0]!.target, 'staging');
    assert.equal(deploys[0]!.status, 'succeeded');
  } finally {
    fx.cleanup();
  }
});
