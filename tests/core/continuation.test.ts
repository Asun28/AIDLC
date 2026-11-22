import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { admittedDecisions, continueReviewStop } from '../../src/core/continuation.ts';
import { CardRun } from '../../src/core/types.ts';
import { cardRun, T0 } from './_fixtures.ts';

const AT = '2026-09-11T05:00:00.000Z';
const STOP_AT = '2026-09-11T04:00:00.000Z';
const LIFT = { at: '2026-09-11T02:00:00.000Z', by: 'owner' };
const call = (id: string, extra: Record<string, unknown> = {}) => ({ invocationId: id, candidateDigest: `d-${id}`, base: 'main', policyVersion: 'v1', reviewer: 'codex', requestedAt: T0, outcome: 'block', ...extra });
const stopFor = (reason: string, detail = 'stopped') => ({ reason, detail, nextAction: 'rule', global: false, at: STOP_AT });
const stopped = (review: Record<string, unknown>, stop = stopFor('review')) => cardRun({ state: 'STOP', stop, review });

const runs = {
  'a: a block on decision 4': stopped({ substantiveDecisions: 4, substantiveBlocks: 4, invocations: [call('i1'), call('i2'), call('i3'), call('i4', { stopReview: 'fourth decision blocked' })] }, stopFor('review', 'fourth decision blocked')),
  'b: a re-raise on decision 2 after a lifted stop': stopped({ substantiveDecisions: 2, substantiveBlocks: 2, invocations: [call('i1', { stopReview: 'first', stopLifted: LIFT }), call('r1', { outcome: 'pass', ruled: true }), call('i2', { stopReview: 're-raise' })] }),
  'c: a stop the gate made': stopped({ substantiveDecisions: 4, substantiveBlocks: 3, invocations: [call('i1'), call('i2')] }),
};

describe('continueReviewStop (card T1-CONTINUE-CORE)', () => {
  for (const [name, run] of Object.entries(runs)) {
    for (const [decisions, above] of [[undefined, 1], [3, 3]] as const) {
      test(`acceptance 1 (${name}, decisions ${decisions ?? 'absent'}): the entry holds the act, the lifted stop and admits ${above} above the decisions; each unlifted stop is lifted [R2]`, () => {
        const before = structuredClone(run);
        const out = continueReviewStop(run, { at: AT, by: 'owner', reason: 'one more round', ...(decisions ? { decisions } : {}) }, true);
        assert.deepEqual(out.continuation, { at: AT, by: 'owner', reason: 'one more round', stop: { reason: 'review', detail: run.stop?.detail, at: STOP_AT }, decisions: above, admits: run.review.substantiveDecisions + above });
        const expected = run.review.invocations.map((i) => (i.stopReview && !i.stopLifted ? { ...i, stopLifted: { at: AT, by: 'owner' } } : i));
        assert.deepEqual(out.review, { ...run.review, invocations: expected });
        assert.deepEqual(run, before, 'the run passed in is unchanged');
      });
    }
  }

  test('acceptance 1: the lifted invocation keeps its own lift, and a gate stop leaves the ledger deep-equal [R2]', () => {
    const b = continueReviewStop(runs['b: a re-raise on decision 2 after a lifted stop'], { at: AT, by: 'owner', reason: 'r' }, true);
    assert.deepEqual(b.review.invocations[0]?.stopLifted, LIFT);
    const c = runs['c: a stop the gate made'];
    assert.deepEqual(continueReviewStop(c, { at: AT, by: 'owner', reason: 'r' }, true).review, c.review);
  });

  const base = runs['a: a block on decision 4'];
  const act = { at: AT, by: 'owner', reason: 'r' };
  const refusals: Array<[string, CardRun, Parameters<typeof continueReviewStop>[1], boolean, RegExp]> = [
    ['state BUILD', { ...base, state: 'BUILD' }, act, true, /is in BUILD, not in STOP/],
    ['stop reason ci', stopped(base.review, stopFor('ci')), act, true, /stop reason ci is not review/],
    ['stop reason time', stopped(base.review, stopFor('time')), act, true, /stop reason time is not review/],
    ['stop reason card', stopped(base.review, stopFor('card')), act, true, /stop reason card is not review/],
    ['not a command reviewer', base, act, false, /formal reviewer is not a command/],
    ['noVerdictRetriesUsed 2', stopped({ ...base.review, noVerdictRetriesUsed: 2 }), act, true, /missing verdict/],
    ['blank by', base, { ...act, by: '  ' }, true, /by is blank/],
    ['blank reason', base, { ...act, reason: ' \t' }, true, /reason is blank/],
    ['decisions 0', base, { ...act, decisions: 0 }, true, /decisions 0 is not a whole number from 1 to 4/],
    ['decisions 5', base, { ...act, decisions: 5 }, true, /decisions 5 is not a whole number from 1 to 4/],
    ['decisions 1.5', base, { ...act, decisions: 1.5 }, true, /decisions 1.5 is not a whole number from 1 to 4/],
    ['decisions NaN', base, { ...act, decisions: Number.NaN }, true, /decisions NaN is not a whole number from 1 to 4/],
  ];
  for (const [cause, run, a, command, message] of refusals) {
    test(`acceptance 2: ${cause} is refused with a message that names it, and the run is unchanged [R3]`, () => {
      const before = structuredClone(run);
      assert.throws(() => continueReviewStop(run, a, command), message);
      assert.deepEqual(run, before);
    });
  }
});

describe('continuations on CardRun and admittedDecisions (card T1-CONTINUE-CORE)', () => {
  const entry = (reason: 'review' | 'ci', admits?: number) => ({ at: AT, by: 'owner', reason: 'r', stop: { reason, detail: 'd', at: STOP_AT }, ...(admits === undefined ? {} : { decisions: 1, admits }) });

  test('acceptance 3: a run without continuations parses to an empty array, and one entry round-trips [R1]', () => {
    assert.deepEqual(cardRun().continuations, []);
    const one = cardRun({ continuations: [entry('review', 5)] });
    assert.deepEqual(one.continuations, [entry('review', 5)]);
    assert.deepEqual(CardRun.parse(JSON.parse(JSON.stringify(one))), one);
  });

  test('acceptance 3: admittedDecisions is the admits of the last review entry, undefined without one [R4]', () => {
    assert.equal(admittedDecisions([entry('review', 5), entry('review', 7), entry('ci')]), 7);
    assert.equal(admittedDecisions([]), undefined);
    assert.equal(admittedDecisions([entry('ci')]), undefined);
  });
});
