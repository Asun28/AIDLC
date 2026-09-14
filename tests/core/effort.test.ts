import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reopenAfterReviewBlock,
  EFFORT_LADDERS,
  MAX_BASELINE_ATTEMPTS,
  MAX_COUNTED_ATTEMPTS,
  countedAttempts,
  createEpisode,
  finishAttempt,
  nextEffortAction,
  nextSupportedEffort,
  normaliseCause,
  startAttempt,
} from '../../src/core/effort.ts';
import type { EffortEpisode, EffortLevel } from '../../src/core/types.ts';
import { addMs } from '../../src/core/types.ts';
import { T0 } from './_fixtures.ts';

const GPT = EFFORT_LADDERS['gpt']!;
const JUSTIFIED = { harderProblem: true, limitsPermit: true };

function fail(ep: EffortEpisode, n: number, cause: string, progress: boolean, effort: EffortLevel = ep.baseline): EffortEpisode {
  const started = startAttempt(ep, effort, addMs(T0, n * 60_000));
  return finishAttempt(started, { finishedAttempt: undefined, finishedAt: addMs(T0, n * 60_000 + 30_000), outcome: 'fail', cause, progress } as never);
}

describe('effort episodes (MA2 / Q25)', () => {
  test('constants match the plan: four counted attempts, three at baseline', () => {
    assert.equal(MAX_COUNTED_ATTEMPTS, 4);
    assert.equal(MAX_BASELINE_ATTEMPTS, 3);
  });

  test('baseline must be in the ladder; next supported effort is the next rung', () => {
    assert.throws(() => createEpisode('t', 'implementer', 'max', GPT), /not in the supported ladder/);
    const ep = createEpisode('t', 'implementer', 'medium', GPT);
    assert.equal(nextSupportedEffort(ep), 'high');
    assert.equal(nextSupportedEffort(createEpisode('t', 'implementer', 'xhigh', GPT)), undefined);
  });

  test('Q25: the first attempt starts at the task baseline, never uplifted', () => {
    const ep = createEpisode('t', 'implementer', 'medium', GPT);
    assert.deepEqual(nextEffortAction(ep), { action: 'attempt', effort: 'medium', n: 1, escalated: false });
  });

  test('Q25: two consecutive same-cause failures without progress stop the branch early', () => {
    let ep = createEpisode('t', 'implementer', 'medium', GPT);
    ep = fail(ep, 1, 'TypeError: x is undefined at line 12', false);
    assert.equal(ep.terminal, undefined);
    assert.equal(nextEffortAction(ep).action, 'attempt');
    ep = fail(ep, 2, 'TypeError: x is undefined at line 15', false); // same normalised cause
    assert.equal(ep.terminal, 'same-cause-stop');
    const next = nextEffortAction(ep);
    assert.equal(next.action, 'stop');
    assert.equal(next.action === 'stop' && next.reason, 'same-cause-stop');
  });

  test('Q25: same cause with verified progress does not stop early', () => {
    let ep = createEpisode('t', 'implementer', 'medium', GPT);
    ep = fail(ep, 1, 'assertion failed', true);
    ep = fail(ep, 2, 'assertion failed', true);
    assert.equal(ep.terminal, undefined);
    assert.deepEqual(nextEffortAction(ep), { action: 'attempt', effort: 'medium', n: 3, escalated: false });
  });

  test('Q25: the fourth attempt escalates once only with progress, justification and an available level', () => {
    let ep = createEpisode('t', 'implementer', 'medium', GPT);
    ep = fail(ep, 1, 'a', true);
    ep = fail(ep, 2, 'b', true);
    ep = fail(ep, 3, 'c', true);
    assert.equal(countedAttempts(ep).length, 3);
    assert.equal(ep.terminal, undefined);
    assert.equal(nextEffortAction(ep).action, 'stop', 'no justification -> exhausted');
    const noJust = nextEffortAction(ep);
    assert.equal(noJust.action === 'stop' && noJust.reason, 'exhausted');
    const partial = nextEffortAction(ep, { harderProblem: true, limitsPermit: false });
    assert.equal(partial.action === 'stop' && partial.reason, 'exhausted');
    assert.deepEqual(nextEffortAction(ep, JUSTIFIED), { action: 'attempt', effort: 'high', n: 4, escalated: true });
  });

  test('Q25: no progress on the third baseline attempt means no fourth attempt', () => {
    let ep = createEpisode('t', 'implementer', 'medium', GPT);
    ep = fail(ep, 1, 'a', true);
    ep = fail(ep, 2, 'b', true);
    ep = fail(ep, 3, 'c', false);
    const next = nextEffortAction(ep, JUSTIFIED);
    assert.equal(next.action, 'stop');
    assert.equal(next.action === 'stop' && next.reason, 'exhausted');
  });

  test('Q25: escalation is unavailable at the top of the ladder', () => {
    let ep = createEpisode('t', 'implementer', 'xhigh', GPT);
    ep = fail(ep, 1, 'a', true);
    ep = fail(ep, 2, 'b', true);
    ep = fail(ep, 3, 'c', true);
    assert.equal(ep.terminal, 'escalation-unavailable');
    const next = nextEffortAction(ep, JUSTIFIED);
    assert.equal(next.action === 'stop' && next.reason, 'escalation-unavailable');
  });

  test('Q25: a failed escalated attempt ends the episode; there is no fifth attempt', () => {
    let ep = createEpisode('t', 'implementer', 'medium', GPT);
    ep = fail(ep, 1, 'a', true);
    ep = fail(ep, 2, 'b', true);
    ep = fail(ep, 3, 'c', true);
    ep = fail(ep, 4, 'd', true, 'high');
    assert.equal(ep.escalationUsed, true);
    assert.equal(ep.terminal, 'escalation-failed');
    const next = nextEffortAction(ep, JUSTIFIED);
    assert.equal(next.action === 'stop' && next.reason, 'escalation-failed');
  });

  test('Q25: quota / expected RED / admission holds are not counted and do not trigger uplift', () => {
    let ep = createEpisode('t', 'implementer', 'medium', GPT);
    for (const reason of ['quota', 'expected-red', 'admission-hold', 'tool-outage', 'env-setup'] as const) {
      ep = startAttempt(ep, 'medium', T0);
      ep = finishAttempt(ep, { finishedAt: T0, outcome: 'not-counted', notCountedReason: reason });
    }
    assert.equal(ep.attempts.length, 5);
    assert.equal(countedAttempts(ep).length, 0);
    assert.deepEqual(nextEffortAction(ep), { action: 'attempt', effort: 'medium', n: 1, escalated: false });
    assert.equal(ep.escalationUsed, false);
  });

  test('R12: only DoD failures count toward the ladder; a review-blocked success reopens the episode without spending an attempt', () => {
    let ep = createEpisode('t', 'implementer', 'medium', GPT);
    for (let i = 0; i < 4; i++) {
      ep = startAttempt(ep, 'medium', T0);
      ep = finishAttempt(ep, { finishedAt: T0, outcome: 'success', progress: true });
      assert.equal(ep.terminal, 'succeeded');
      ep = reopenAfterReviewBlock(ep, `review block ${i + 1}`);
      assert.equal(ep.terminal, undefined);
      assert.equal(ep.attempts.at(-1)?.outcome, 'success', 'the blocked attempt keeps its success');
    }
    assert.equal(countedAttempts(ep).length, 0, 'successes are not counted attempts');
    const next = nextEffortAction(ep);
    assert.equal(next.action, 'attempt');
    if (next.action === 'attempt') {
      assert.equal(next.effort, 'medium', 'still a baseline attempt after four review blocks');
      assert.equal(next.n, 5, 'attempt numbers stay sequential');
    }
    // The same episode keeps three baseline failures and one justified escalation for real DoD failures.
    for (const [cause, n] of [['a', 6], ['b', 7]] as Array<[string, number]>) {
      ep = startAttempt(ep, 'medium', T0);
      ep = finishAttempt(ep, { finishedAt: T0, outcome: 'fail', cause, progress: true });
      assert.equal(ep.terminal, undefined);
      assert.deepEqual(nextEffortAction(ep), { action: 'attempt', effort: 'medium', n, escalated: false });
    }
    ep = startAttempt(ep, 'medium', T0);
    ep = finishAttempt(ep, { finishedAt: T0, outcome: 'fail', cause: 'c', progress: true });
    assert.equal(countedAttempts(ep).length, MAX_BASELINE_ATTEMPTS, 'three DoD failures on the reopened episode');
    assert.equal(nextEffortAction(ep).action, 'stop', 'the fourth attempt needs a justification');
    assert.deepEqual(nextEffortAction(ep, JUSTIFIED), { action: 'attempt', effort: 'high', n: 8, escalated: true });
    ep = startAttempt(ep, 'high', T0);
    ep = finishAttempt(ep, { finishedAt: T0, outcome: 'fail', cause: 'd', progress: true });
    assert.equal(countedAttempts(ep).length, MAX_COUNTED_ATTEMPTS);
    assert.equal(ep.terminal, 'escalation-failed', 'four DoD failures end the episode; the review blocks never counted');
    assert.equal(nextEffortAction(ep, JUSTIFIED).action, 'stop');
    let failing = createEpisode('u', 'implementer', 'medium', GPT);
    for (const cause of ['a', 'b', 'c']) {
      failing = startAttempt(failing, 'medium', T0);
      failing = finishAttempt(failing, { finishedAt: T0, outcome: 'fail', cause, progress: false });
    }
    assert.equal(countedAttempts(failing).length, 3);
    assert.equal(nextEffortAction(failing).action, 'stop', 'three DoD failures without progress still stop the episode');
  });

  test('R10/R11: a review block on the escalated success admits the repair at the escalated effort, not escalation-failed', () => {
    let ep = createEpisode('v', 'implementer', 'medium', GPT);
    for (const cause of ['a', 'b', 'c']) {
      ep = startAttempt(ep, 'medium', T0);
      ep = finishAttempt(ep, { finishedAt: T0, outcome: 'fail', cause, progress: true });
    }
    const up = nextEffortAction(ep, JUSTIFIED);
    assert.equal(up.action, 'attempt');
    if (up.action !== 'attempt') return;
    ep = startAttempt(ep, up.effort, T0);
    ep = finishAttempt(ep, { finishedAt: T0, outcome: 'success', progress: true });
    ep = reopenAfterReviewBlock(ep, 'R3 block');
    const repair = nextEffortAction(ep);
    assert.deepEqual(repair, { action: 'attempt', effort: up.effort, n: 5, escalated: true });
  });

  test('R10/R11: not-counted records after a review block never hide the reopened success', () => {
    let ep = createEpisode('w', 'implementer', 'medium', GPT);
    for (const cause of ['a', 'b', 'c']) {
      ep = startAttempt(ep, 'medium', T0);
      ep = finishAttempt(ep, { finishedAt: T0, outcome: 'fail', cause, progress: true });
    }
    ep = startAttempt(ep, 'high', T0);
    ep = finishAttempt(ep, { finishedAt: T0, outcome: 'success', progress: true });
    ep = reopenAfterReviewBlock(ep, 'R3 block');
    ep = startAttempt(ep, 'high', T0);
    ep = finishAttempt(ep, { finishedAt: T0, outcome: 'not-counted', notCountedReason: 'quota' });
    assert.equal(countedAttempts(ep).length, 3, 'the interruption is not a DoD failure');
    assert.deepEqual(nextEffortAction(ep), { action: 'attempt', effort: 'high', n: 5, escalated: true }, 'the repair resumes at the escalated effort after the interruption');
  });

  test('R12: a preserved success between two same-cause failures breaks the same-cause streak', () => {
    let ep = fail(createEpisode('x', 'implementer', 'medium', GPT), 1, 'type error in a.ts', false);
    ep = startAttempt(ep, 'medium', T0);
    ep = finishAttempt(ep, { finishedAt: T0, outcome: 'success', progress: true });
    ep = reopenAfterReviewBlock(ep, 'R2 block');
    ep = fail(ep, 3, 'type error in a.ts', false);
    assert.equal(ep.terminal, undefined, 'the two failures are not consecutive');
    assert.deepEqual(nextEffortAction(ep), { action: 'attempt', effort: 'medium', n: 4, escalated: false });
    ep = fail(ep, 4, 'type error in a.ts', false);
    assert.equal(ep.terminal, 'same-cause-stop', 'two consecutive same-cause failures without progress still stop');
  });

  test('success terminates the episode as done', () => {
    let ep = createEpisode('t', 'implementer', 'medium', GPT);
    ep = startAttempt(ep, 'medium', T0);
    ep = finishAttempt(ep, { finishedAt: T0, outcome: 'success', progress: true });
    assert.equal(ep.terminal, 'succeeded');
    assert.deepEqual(nextEffortAction(ep), { action: 'done' });
  });

  test('guards: running attempt blocks decisions; failures need a cause; not-counted needs a reason', () => {
    const ep = startAttempt(createEpisode('t', 'implementer', 'medium', GPT), 'medium', T0);
    assert.throws(() => nextEffortAction(ep), /still running/);
    assert.throws(() => finishAttempt(ep, { finishedAt: T0, outcome: 'fail' }), /normalised cause/);
    assert.throws(() => finishAttempt(ep, { finishedAt: T0, outcome: 'not-counted' }), /reason/);
    assert.throws(() => finishAttempt(createEpisode('t', 'implementer', 'medium', GPT), { finishedAt: T0, outcome: 'success' }), /no running attempt/);
    assert.throws(() => startAttempt(createEpisode('t', 'implementer', 'medium', GPT), 'max', T0), /unsupported/);
  });

  test('normaliseCause folds numbers, hex and whitespace', () => {
    assert.equal(normaliseCause('TypeError at line 12 (0xdeadbeef)'), normaliseCause('typeerror   at line 99 (0x1)'));
    assert.notEqual(normaliseCause('TypeError'), normaliseCause('ReferenceError'));
  });

  test('ladders: Claude uses its own levels, never a translation of GPT strings', () => {
    assert.deepEqual(EFFORT_LADDERS['claude'], ['low', 'medium', 'high', 'max']);
    assert.deepEqual(GPT, ['low', 'medium', 'high', 'xhigh']);
  });
});
