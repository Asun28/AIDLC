import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CARD_TRANSITIONS, applyCardDecision, isCardTransitionAllowed, selectCardState, type CardEvidence } from '../../src/core/card-machine.ts';
import { makeStop } from '../../src/core/stop.ts';
import { RECONCILE_GRACE_MS, addMs } from '../../src/core/types.ts';
import { T0, T_CARD_DEADLINE, cardRun } from './_fixtures.ts';

function ev(overrides: Partial<CardEvidence> = {}): CardEvidence {
  return {
    now: T0,
    deadline: T_CARD_DEADLINE,
    unknownOperations: [],
    prepared: true,
    mergeVerified: false,
    closureComplete: false,
    reviewBlockPending: false,
    reviewExhausted: false,
    buildIncomplete: false,
    candidateReady: false,
    ownershipCurrent: true,
    ...overrides,
  };
}

describe('card state precedence (Q8 / Q18)', () => {
  test('Q18: an issued operation with unknown outcome is reconciled first; no new mutation is admitted', () => {
    const d = selectCardState(ev({ unknownOperations: ['op-1'], candidateReady: true, mergeVerified: true, closureComplete: true }));
    assert.equal(d.state, 'WAIT');
    assert.equal(d.admitMutations, false);
    assert.match(d.reason, /reconciling unknown operations: op-1/);
  });

  test('Q18: within the five-minute grace reconciliation may continue; after it the branch stops with UNKNOWN retained', () => {
    const grace = selectCardState(ev({ unknownOperations: ['op-1'], now: addMs(T_CARD_DEADLINE, RECONCILE_GRACE_MS - 1) }));
    assert.equal(grace.state, 'WAIT');
    const expired = selectCardState(ev({ unknownOperations: ['op-1'], now: addMs(T_CARD_DEADLINE, RECONCILE_GRACE_MS) }));
    assert.equal(expired.state, 'STOP');
    assert.equal(expired.stop?.reason, 'time');
    assert.deepEqual(expired.stop?.unresolvedOperations, ['op-1']);
    assert.equal(expired.admitMutations, false);
  });

  test('a recorded terminal reason is returned as STOP before any other evidence', () => {
    const stop = makeStop('cancelled', 'user cancelled', 'none', { at: T0 });
    const d = selectCardState(ev({ terminal: stop, mergeVerified: true, closureComplete: true }));
    assert.equal(d.state, 'STOP');
    assert.equal(d.stop, stop);
  });

  test('Q23: a stale ownership generation stops with STOP/ownership', () => {
    const d = selectCardState(ev({ ownershipCurrent: false, candidateReady: true }));
    assert.equal(d.state, 'STOP');
    assert.equal(d.stop?.reason, 'ownership');
  });

  test('a capability blocker stops the branch (not globally)', () => {
    const d = selectCardState(ev({ capabilityBlocker: 'advisory ship can merge a known defect before the skill reads it' }));
    assert.equal(d.state, 'STOP');
    assert.equal(d.stop?.reason, 'capability');
    assert.equal(d.stop?.global, false);
  });

  test('Q8: merge verified plus complete closure is DONE with no new work', () => {
    const d = selectCardState(ev({ mergeVerified: true, closureComplete: true, runningOperation: 'op-2' }));
    assert.equal(d.state, 'DONE');
    assert.equal(d.admitMutations, false);
  });

  test('a known running operation is WAIT (attach), not a duplicate dispatch', () => {
    const d = selectCardState(ev({ runningOperation: 'review-1', candidateReady: true }));
    assert.equal(d.state, 'WAIT');
    assert.match(d.reason, /review-1/);
  });

  test('Q8: merged but closure incomplete selects CLOSE regardless of card status text', () => {
    const d = selectCardState(ev({ mergeVerified: true }));
    assert.equal(d.state, 'CLOSE');
    assert.equal(d.admitMutations, true);
  });

  test('Q8: the admission deadline stops new planned work (grace does not admit)', () => {
    const d = selectCardState(ev({ now: T_CARD_DEADLINE, candidateReady: true }));
    assert.equal(d.state, 'STOP');
    assert.equal(d.stop?.reason, 'time');
    assert.match(d.stop?.nextAction ?? '', /extension must be explicit/);
    const stillOpen = selectCardState(ev({ now: addMs(T_CARD_DEADLINE, -1), candidateReady: true }));
    assert.equal(stillOpen.state, 'SHIP');
  });

  test('Q6: exhausted review allowance is STOP/review; exhausted repair is STOP/card', () => {
    assert.equal(selectCardState(ev({ reviewExhausted: true })).stop?.reason, 'review');
    const repair = selectCardState(ev({ repairExhausted: 'same cause twice' }));
    assert.equal(repair.state, 'STOP');
    assert.equal(repair.stop?.reason, 'card');
  });

  test('ordering: PREPARE before REVIEW-FIX before BUILD before SHIP', () => {
    assert.equal(selectCardState(ev({ prepared: false, reviewBlockPending: true, buildIncomplete: true, candidateReady: true })).state, 'PREPARE');
    assert.equal(selectCardState(ev({ reviewBlockPending: true, buildIncomplete: true, candidateReady: true })).state, 'REVIEW_FIX');
    assert.equal(selectCardState(ev({ buildIncomplete: true, candidateReady: true })).state, 'BUILD');
    assert.equal(selectCardState(ev({ candidateReady: true })).state, 'SHIP');
    assert.equal(selectCardState(ev()).state, 'BUILD');
  });

  test('applyCardDecision persists state and stop', () => {
    const run = cardRun();
    const d = selectCardState(ev({ ownershipCurrent: false }));
    const next = applyCardDecision(run, d, addMs(T0, 1000));
    assert.equal(next.state, 'STOP');
    assert.equal(next.stop?.reason, 'ownership');
    assert.equal(next.updatedAt, addMs(T0, 1000));
    assert.equal(run.state, 'BUILD', 'input is not mutated');
  });

  test('transition table: terminal states have no exits; self-transition is allowed', () => {
    assert.deepEqual(CARD_TRANSITIONS.DONE, []);
    assert.deepEqual(CARD_TRANSITIONS.STOP, []);
    assert.equal(isCardTransitionAllowed('DONE', 'BUILD'), false);
    assert.equal(isCardTransitionAllowed('BUILD', 'BUILD'), true);
    assert.equal(isCardTransitionAllowed('SHIP', 'REVIEW_FIX'), true);
    assert.equal(isCardTransitionAllowed('PREPARE', 'SHIP'), false);
  });
});
