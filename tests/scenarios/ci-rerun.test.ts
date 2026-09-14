import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor, InjectedShipPath, T0 } from './_harness.ts';
import { canRerun } from '../../src/core/ci-policy.ts';

const TRANSIENT = '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/12345 ... Error: read ECONNRESET while fetching artifact';
const CODE_DEFECT = '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/777 ... AssertionError: expected 2 to equal 3';

function start(fx: ReturnType<typeof makeFixture>, ship: InjectedShipPath) {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goal = goalForCards(fx, ['T1-HELLO']);
  const runner = fx.runner(ship);
  const card = fx.card('T1-HELLO');
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
  r = runner.next(fx.goal(goal.id), card, r.run);
  const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
  return { goal, runner, card, run1 };
}

test('Q7: a transient CI failure earns one persisted same-origin rerun, reconciles, and then merges', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red', 'merged'], TRANSIENT);
    const { goal, runner, card, run1 } = start(fx, ship);
    let r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'ship', 'transient failure: rerun directive');
    assert.equal(r.run.state, 'SHIP');
    assert.equal(r.run.ci.reruns.length, 1);
    assert.equal(r.run.ci.reruns[0]!.outcome, 'requested', 'rerun intent persisted before the request');
    assert.equal(r.run.ci.reruns[0]!.runId, '12345');
    assert.equal(r.run.ci.reruns[0]!.candidate, candidateShaFor('T1-HELLO'));
    const types = fx.events(goal.id).map((e) => e.type);
    assert.ok(types.includes('CI_CLASSIFIED'));
    assert.ok(types.includes('CI_RERUN'));

    const reconciled = runner.ciReconcile(fx.goal(goal.id), card, r.run, '12345', () => ({ status: 'completed', conclusion: 'success', attempt: 2 }));
    assert.equal(reconciled.state, 'SHIP');
    assert.equal(reconciled.ci.reruns[0]!.outcome, 'success');

    // BUG: src/loop/card-runner.ts ship() — re-shipping the SAME candidate after the reconciled rerun
    // enqueues the same review key; ReviewQueue.enqueue reports the earlier request as 'completed',
    // admit() finds nothing queued and the runner answers `wait` on 'review-pool:default:empty'.
    // Expected: a completed review for this candidate is reused (or re-opened when it carried no
    // verdict) and the ship proceeds to merged -> CLOSE.
    r = runner.next(fx.goal(goal.id), card, reconciled);
    assert.equal(r.directive.kind, 'close', `expected merged -> close, got ${r.directive.kind}: ${r.directive.narration}`);
    assert.equal(ship.requests.length, 2);
  } finally {
    fx.cleanup();
  }
});

test('Q7: the rerun allowance is per candidate; a second transient failure on the same candidate is STOP/ci', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], TRANSIENT);
    const { goal, runner, card, run1 } = start(fx, ship);
    const digest = run1.candidate!.digest;
    assert.equal(canRerun({ reruns: [] }, '1', 1, digest, 'transient').allowed, true);
    assert.equal(canRerun({ reruns: [{ runId: '999', attempt: 1, candidate: digest, requestedAt: T0, outcome: 'success' }] }, '12345', 1, digest, 'transient').allowed, false);
    assert.equal(canRerun({ reruns: [{ runId: '999', attempt: 1, candidate: 'other', requestedAt: T0, outcome: 'success' }] }, '12345', 1, digest, 'transient').allowed, true, 'a new candidate has its own allowance');

    // Persist a consumed rerun for this candidate, then ship: the transient failure cannot rerun again.
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-HELLO', data: { ci: { reruns: [{ runId: '999', attempt: 1, candidate: digest, requestedAt: T0, outcome: 'success' }] } } });
    const run2 = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    const r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'stop');
    assert.equal(r.run.stop?.reason, 'ci');
    assert.equal(r.run.ci.reruns.length, 1, 'no second rerun recorded');
  } finally {
    fx.cleanup();
  }
});

test('Q7: a code-defect CI failure never reruns; it goes back to BUILD with a new candidate', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], CODE_DEFECT);
    const { goal, runner, card, run1 } = start(fx, ship);
    const r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'build');
    assert.equal(r.run.state, 'BUILD');
    assert.equal(r.run.ci.reruns.length, 0);
    assert.equal(r.run.dodReceipt, undefined, 'the failed candidate needs a fresh DoD');
    const classified = fx.events(goal.id).find((e) => e.type === 'CI_CLASSIFIED');
    assert.equal(classified?.data['class'], 'code-defect');
  } finally {
    fx.cleanup();
  }
});

const SECURITY = '[CI-GATE-RED] Gitleaks (committed history)=failure\n[SAGA-FAIL]\n[SAGA-RESUME] aidlc card next T1-HELLO';

test('R7: a red secret scan is STOP/risk with no rerun intent and no repair attempt', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], SECURITY);
    const { goal, runner, card, run1 } = start(fx, ship);
    const r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.state, 'STOP');
    assert.equal(r.run.stop?.reason, 'risk');
    assert.ok((r.run.stop?.detail ?? '').includes('Gitleaks (committed history)'), r.run.stop?.detail);
    assert.equal(r.run.ci.reruns.length, 0, 'no rerun intent is persisted for a security failure');
    assert.equal(r.run.dodReceipt, undefined, 'the candidate is not ready to ship again');
    const classified = fx.events(goal.id).find((e) => e.type === 'CI_CLASSIFIED');
    assert.equal(classified?.data['class'], 'security');
    assert.ok(!fx.events(goal.id).some((e) => e.type === 'CI_RERUN'));
    assert.equal(ship.requests.length, 1);
  } finally {
    fx.cleanup();
  }
});
