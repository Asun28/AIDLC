import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import type { Verdict } from '../../src/core/types.ts';

const BLOCK: Verdict = {
  verdict: 'block',
  reasons: ['[spec] 6 tests missing @ src/hello.ts'],
  axes: { spec: { verdict: 'block', reasons: ['tests missing'] }, standards: { verdict: 'pass', reasons: [] } },
  sha: candidateShaFor('T1-HELLO'),
  run_status: 'success',
};

function tierSCard(fx: ReturnType<typeof makeFixture>) {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello', tier: 'S', reviewGate: 'codex {verdict:pass}', acceptance: ['1. hello() returns hello. [dod arm 1]'] });
}

test('Q6: a Tier-S spec block is merge-blocking and routes to REVIEW_FIX with one decision consumed', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new DryRunShipPath(['review-blocked', 'review-blocked'], BLOCK);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'review-fix');
    assert.equal(r.run.state, 'REVIEW_FIX');
    assert.equal(r.run.review.substantiveDecisions, 1);
    assert.equal(r.run.review.substantiveBlocks, 1);
    assert.equal(r.run.review.noVerdictRetriesUsed, 0);
    assert.equal(r.run.dodReceipt, undefined, 'the blocked candidate is no longer a ready candidate');
    if (r.directive.kind === 'review-fix') {
      assert.equal(r.directive.remainingDecisions, 1);
      assert.deepEqual(r.directive.reasons, BLOCK.reasons);
    }
    assert.equal(ship.requests.length, 1);
    const types = fx.events(goal.id).map((e) => e.type);
    assert.ok(types.includes('REVIEW_DECIDED'));
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the review slot is released after the decision');
  } finally {
    fx.cleanup();
  }
});

test('Q6: after REVIEW_FIX a repaired candidate ships once more; a second substantive block is STOP/review and no third ship happens', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new DryRunShipPath(['review-blocked', 'review-blocked'], BLOCK);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'review-fix');

    // BUG: src/loop/card-runner.ts — there is no path out of REVIEW_FIX. `next()` keeps returning
    // review-fix because `reviewBlockPending` is true whenever run.state === 'REVIEW_FIX' (line ~138),
    // and `recordAttempt` throws 'no running attempt to finish' because the effort episode is already
    // terminal ('succeeded') and REVIEW_FIX never starts a repair attempt. Expected: the review block
    // marks the previous attempt as a counted failure (cause = review block) so the next `next()` yields
    // a `build` directive for attempt 2; after `recordAttempt` success with a new candidate sha the
    // repaired candidate ships (second substantive decision) and a second block is STOP/review.
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build', `expected a repair attempt after REVIEW_FIX, got ${r.directive.kind}`);
    const run2 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:2', candidateSha: 'sha-repaired' });
    r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'stop');
    assert.equal(r.run.state, 'STOP');
    assert.equal(r.run.stop?.reason, 'review');
    assert.equal(r.run.review.substantiveDecisions, 2);
    assert.equal(r.run.review.substantiveBlocks, 2);
    assert.equal(ship.requests.length, 2, 'no third ship request');
  } finally {
    fx.cleanup();
  }
});

test('Q6: a missing verdict never passes; one retry is offered, then a second no-verdict is STOP/review', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new DryRunShipPath(['review-no-verdict', 'review-no-verdict']);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'ship', 'first no-verdict offers the single retry');
    assert.equal(r.run.state, 'SHIP');
    assert.equal(r.run.review.noVerdictRetriesUsed, 1);
    assert.equal(r.run.review.substantiveDecisions, 0, 'a no-verdict is not a substantive decision');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'slot released after the completed (no-verdict) request');

    // BUG: src/loop/card-runner.ts ship() — the retry of the SAME candidate enqueues the same review key,
    // ReviewQueue.enqueue returns { status: 'completed' } for the earlier no-verdict request, admit() then
    // finds nothing queued and the runner returns a `wait` directive on 'review-pool:default:empty'
    // forever. Expected: a completed request without a verdict (verdictRef 'no-verdict') is re-opened
    // (cancel + enqueue) so the retry ship runs, and the second no-verdict is STOP/review.
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'stop', `expected STOP/review after the retry, got ${r.directive.kind}: ${r.directive.narration}`);
    assert.equal(r.run.stop?.reason, 'review');
    assert.equal(r.run.review.noVerdictRetriesUsed, 2);
    assert.equal(ship.requests.length, 2);
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
  } finally {
    fx.cleanup();
  }
});

test('Q6: a standards-only block on a Tier-1 card is advisory and the merge proceeds', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello', tier: '1', reviewGate: 'codex {verdict:pass}', acceptance: ['1. hello() returns hello. [dod arm 1]'] });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const advisory: Verdict = { ...BLOCK, axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: ['naming'] } } };
    const ship = new DryRunShipPath(['merged'], advisory);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'close');
    assert.equal(r.run.review.substantiveDecisions, 1);
    assert.equal(r.run.review.substantiveBlocks, 0, 'advisory block is not a substantive block');
  } finally {
    fx.cleanup();
  }
});
