// Card T1-SWEEP2-DUPLICATES acceptance 3: `aidlc next` in CLOSE, not a copy of the rule, gates goal DONE on the
// requested stages (LC11, Q11): a requested stage that has not passed is listed as missing, a `not_requested` one is not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, driveCardToDone } from './_harness.ts';
import { transitionGoal } from '../../src/core/goal-machine.ts';

test('T1-SWEEP2-DUPLICATES acceptance 3: a goal in CLOSE with closed cards lists stage staging=pending and no not_requested stage; with staging pass it reaches DONE [R3]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO'], { target: 'staging' });
    driveCardToDone(fx, goal.id, 'T1-HELLO');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
    // The goal enters CLOSE with its staging stage still pending (the release scenarios place an attempt in OBSERVE the same way).
    const delivering = fx.goal(goal.id);
    assert.equal(delivering.state, 'DELIVER');
    fx.store.saveGoal(transitionGoal(delivering, 'CLOSE', fx.now(), { deliveryVerified: true }));
    const closing = fx.goal(goal.id);
    assert.equal(closing.stages.staging, 'pending');
    assert.equal(closing.stages.production, 'not_requested');

    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'close', d.narration);
    if (d.kind === 'close') {
      assert.deepEqual(d.missing, ['stage staging=pending']);
      assert.ok(!d.missing.some((m) => m.includes('not_requested')), 'a not_requested stage is never missing');
    }
    assert.equal(fx.goal(goal.id).state, 'CLOSE');

    fx.store.saveGoal({ ...fx.goal(goal.id), stages: { ...fx.goal(goal.id).stages, staging: 'pass' } });
    const done = fx.controller.next(goal.id);
    assert.equal(done.kind, 'done', done.narration);
    assert.equal(fx.goal(goal.id).state, 'DONE');
  } finally {
    fx.cleanup();
  }
});
