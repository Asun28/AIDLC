import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAdmission, computeCardDeadline, computeGoalDeadlines, effectiveGoalDeadline, extendDeadline, fitsBeforeDeadline } from '../../src/core/deadlines.ts';
import { ARC_LIMIT_MS, CARD_LIMIT_MS, HOUR_MS, MINUTE_MS, RECONCILE_GRACE_MS, addMs } from '../../src/core/types.ts';
import { T0 } from './_fixtures.ts';

describe('deadlines (Q8 / Q25)', () => {
  test('Q8: a one-card goal has a three-hour goal deadline', () => {
    const d = computeGoalDeadlines(T0, { cardCount: 1 });
    assert.equal(d.goalDeadline, addMs(T0, CARD_LIMIT_MS));
    assert.equal(d.graceMs, RECONCILE_GRACE_MS);
    assert.deepEqual(d.extensions, []);
  });

  test('Q8: a multi-card arc (or unknown count) shares the twelve-hour arc deadline', () => {
    assert.equal(computeGoalDeadlines(T0, { cardCount: 3 }).goalDeadline, addMs(T0, ARC_LIMIT_MS));
    assert.equal(computeGoalDeadlines(T0, { cardCount: 'unknown' }).goalDeadline, addMs(T0, ARC_LIMIT_MS));
  });

  test('a standalone release goal uses the three-hour limit even with unknown cards', () => {
    assert.equal(computeGoalDeadlines(T0, { cardCount: 'unknown', standaloneRelease: true }).goalDeadline, addMs(T0, CARD_LIMIT_MS));
  });

  test('a tighter user/project limit wins; a looser one does not extend', () => {
    assert.equal(computeGoalDeadlines(T0, { cardCount: 5, userLimitMs: 2 * HOUR_MS }).goalDeadline, addMs(T0, 2 * HOUR_MS));
    assert.equal(computeGoalDeadlines(T0, { cardCount: 1, userLimitMs: 10 * HOUR_MS }).goalDeadline, addMs(T0, CARD_LIMIT_MS));
    assert.equal(computeGoalDeadlines(T0, { cardCount: 1, userLimitMs: 0 }).goalDeadline, addMs(T0, CARD_LIMIT_MS));
  });

  test('Q8: card deadline is the earlier of its own 3h limit and the goal deadline', () => {
    const d = computeGoalDeadlines(T0, { cardCount: 3 });
    const lateStart = addMs(T0, 10 * HOUR_MS);
    assert.equal(computeCardDeadline(lateStart, d), d.goalDeadline, 'goal deadline wins when the card starts late');
    assert.equal(computeCardDeadline(T0, d), addMs(T0, CARD_LIMIT_MS), 'own limit wins early in the arc');
    assert.equal(computeCardDeadline(T0, d, 30 * MINUTE_MS), addMs(T0, 30 * MINUTE_MS));
  });

  test('Q8: admission phases: open, grace, expired', () => {
    const deadline = addMs(T0, HOUR_MS);
    assert.equal(checkAdmission(deadline, T0).phase, 'open');
    assert.equal(checkAdmission(deadline, T0).remainingMs, HOUR_MS);
    assert.equal(checkAdmission(deadline, deadline).phase, 'grace');
    assert.equal(checkAdmission(deadline, addMs(deadline, RECONCILE_GRACE_MS - 1)).phase, 'grace');
    assert.equal(checkAdmission(deadline, addMs(deadline, RECONCILE_GRACE_MS)).phase, 'expired');
    assert.equal(checkAdmission(deadline, T0).graceEndsAt, addMs(deadline, RECONCILE_GRACE_MS));
  });

  test('Q25: extensions are explicit, later, and recorded with a reason', () => {
    const d = computeGoalDeadlines(T0, { cardCount: 1 });
    const later = addMs(d.goalDeadline, HOUR_MS);
    const extended = extendDeadline(d, 'owner', later, 'approved extension', addMs(T0, MINUTE_MS));
    assert.equal(effectiveGoalDeadline(extended), later);
    assert.equal(extended.extensions.length, 1);
    assert.equal(extended.extensions[0]?.by, 'owner');
    // the original record is untouched
    assert.equal(effectiveGoalDeadline(d), d.goalDeadline);
    assert.throws(() => extendDeadline(d, 'owner', addMs(d.goalDeadline, -1), 'earlier', T0), /later/);
    assert.throws(() => extendDeadline(d, 'owner', later, '   ', T0), /reason/);
  });

  test('fitsBeforeDeadline bounds provider timeouts by the remaining time', () => {
    const deadline = addMs(T0, HOUR_MS);
    assert.equal(fitsBeforeDeadline(deadline, T0, HOUR_MS), true);
    assert.equal(fitsBeforeDeadline(deadline, T0, HOUR_MS + 1), false);
  });
});
