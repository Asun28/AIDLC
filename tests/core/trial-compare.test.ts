// Card T1-BENCH-TRIALS-2: the median and range over trials, and the four-way verdict on two summaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTrials, trialRange, type TrialSummary } from '../../src/core/trial-compare.ts';

const range = (min: number, max: number, median = (min + max) / 2) => ({ median, min, max });
const summary = (extra: Partial<TrialSummary> = {}): TrialSummary => ({ trials: 3, recall: range(0.5, 0.6), falseBlockRate: range(0.1, 0.2), noVerdict: 0, errors: 0, ...extra });
const ids = ['a', 'b'];
const side = (extra: Partial<TrialSummary> = {}, caseIds = ids) => ({ summary: summary(extra), caseIds });

test('T1-BENCH-TRIALS-2 acceptance 1: the median of an odd and an even trial count, and a null trial makes the range null [R3]', () => {
  assert.deepEqual(trialRange([0.5, 1, 0]), { median: 0.5, min: 0, max: 1 });
  assert.deepEqual(trialRange([0.25, 1, 0, 0.5]), { median: 0.375, min: 0, max: 1 });
  assert.equal(trialRange([0.5, null, 1]), null);
});

test('T1-BENCH-TRIALS-2 acceptance 1: each of the four verdicts on built summaries [R3] [R5]', () => {
  const v = (before: ReturnType<typeof side>, after: ReturnType<typeof side>) => compareTrials(before, after).verdict;
  assert.equal(v(side(), side({ recall: range(0.7, 0.9) })), 'better');
  assert.equal(v(side(), side({ recall: range(0.2, 0.4) })), 'worse');
  // Recall ranges overlap, so the false-block rate decides; lower is better.
  assert.equal(v(side(), side({ recall: range(0.55, 0.7), falseBlockRate: range(0, 0.05) })), 'better');
  assert.equal(v(side(), side({ recall: range(0.4, 0.5), falseBlockRate: range(0.3, 0.4) })), 'worse');
  assert.equal(v(side(), side({ recall: range(0.6, 0.8), falseBlockRate: range(0.2, 0.3) })), 'no-measurable-difference');
  // A recall of null skips the recall comparison and is not inconclusive by itself.
  assert.equal(v(side({ recall: null }), side({ recall: range(0.9, 1), falseBlockRate: range(0.3, 0.4) })), 'worse');
  assert.equal(v(side(), side({ recall: null })), 'no-measurable-difference');
  assert.match(compareTrials(side(), side({ recall: range(0.7, 0.9) })).reason, /^recall 0\.70 to 0\.90 after, 0\.50 to 0\.60 before/);
});

test('T1-BENCH-TRIALS-2 acceptance 1: inconclusive names each cause in a one-line reason [R4]', () => {
  const r = (before: ReturnType<typeof side>, after: ReturnType<typeof side>) => compareTrials(before, after);
  const better = { recall: range(0.9, 1) };
  const cases = r(side(), side(better, ['a', 'c"']));
  assert.equal(cases.verdict, 'inconclusive');
  assert.equal(cases.reason, 'the case ids differ: only before "b", only after "c\\""');
  assert.equal(r(side({ trials: 2 }), side(better)).reason, 'before has 2 trials, fewer than the 3 a verdict needs');
  assert.equal(r(side(), side({ ...better, noVerdict: 1 })).reason, 'after has 1 no-verdict and 0 errors over its trials');
  assert.equal(r(side({ errors: 2 }), side(better)).reason, 'before has 0 no-verdict and 2 errors over its trials');
  const all = r(side({ trials: 1 }, ['a']), side({ ...better, errors: 1 }));
  assert.equal(all.verdict, 'inconclusive');
  assert.equal(all.reason, 'the case ids differ: only after "b"; before has 1 trials, fewer than the 3 a verdict needs; after has 0 no-verdict and 1 errors over its trials');
  assert.ok(!all.reason.includes('\n'));
});

// Card T1-EVAL-VARIANT: the eval variant run passes the pass rate as the one metric, with no second metric.
const one = { before: '"main"', after: 'HEAD', first: 'pass rate', noVerdict: 'quota holds', errors: 'model errors' };
const rate = (min: number, max: number, extra: Partial<TrialSummary> = {}) => side({ recall: range(min, max), falseBlockRate: null, ...extra }, ['a']);

test('T1-EVAL-VARIANT acceptance 5: the verdict with one metric and no second metric names only that metric [R4]', () => {
  assert.deepEqual(compareTrials(rate(0, 0.2), rate(0.5, 1), one), { verdict: 'better', reason: 'pass rate 0.50 to 1.00 HEAD, 0.00 to 0.20 "main": the ranges do not overlap' });
  assert.deepEqual(compareTrials(rate(0.5, 1), rate(0, 0.2), one), { verdict: 'worse', reason: 'pass rate 0.00 to 0.20 HEAD, 0.50 to 1.00 "main": the ranges do not overlap' });
  assert.deepEqual(compareTrials(rate(0, 0.6), rate(0.5, 1), one), { verdict: 'no-measurable-difference', reason: 'the pass rate ranges overlap or are not scored on both sides' });
  // A second metric left in the summaries does not decide when the names carry none.
  const withSecond = (min: number, fb: number) => side({ recall: range(min, 0.6), falseBlockRate: range(fb, fb) }, ['a']);
  assert.equal(compareTrials(withSecond(0.4, 0.5), withSecond(0.5, 0), one).verdict, 'no-measurable-difference');
  assert.deepEqual(compareTrials(rate(0, 0.2, { trials: 2 }), rate(0.5, 1, { errors: 1, noVerdict: 1 }), one), {
    verdict: 'inconclusive',
    reason: '"main" has 2 trials, fewer than the 3 a verdict needs; HEAD has 1 quota holds and 1 model errors over its trials',
  });
});
