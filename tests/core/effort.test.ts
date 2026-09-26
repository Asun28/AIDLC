import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterShipFailure,
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

  test('an episode at baseline high on the Claude ladder escalates to xhigh, not max [T1-OPUS55-MODELS R5]', () => {
    let ep = createEpisode('t', 'implementer', 'high', EFFORT_LADDERS['claude']!);
    assert.equal(nextSupportedEffort(ep), 'xhigh');
    ep = fail(ep, 1, 'a', true);
    ep = fail(ep, 2, 'b', true);
    ep = fail(ep, 3, 'c', true);
    assert.deepEqual(nextEffortAction(ep, JUSTIFIED), { action: 'attempt', effort: 'xhigh', n: 4, escalated: true });
  });

  test('ladders: Claude uses its own levels, never a translation of GPT strings [T1-OPUS55-MODELS R5]', () => {
    assert.deepEqual(EFFORT_LADDERS['claude'], ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.deepEqual(GPT, ['low', 'medium', 'high', 'xhigh']);
  });
});

describe('T0-SHIP-REPAIR-ATTEMPT: a ship that fails on the candidate code', () => {
  function succeed(ep: EffortEpisode, n: number, options: { progress?: boolean; evidence?: string; effort?: EffortLevel } = {}): EffortEpisode {
    const started = startAttempt(ep, options.effort ?? ep.baseline, addMs(T0, n * 60_000));
    return finishAttempt(started, { finishedAt: addMs(T0, n * 60_000 + 30_000), outcome: 'success', progress: options.progress, evidence: options.evidence });
  }
  /** A succeeded attempt reopened by a review block, with the review-fix repair already running. */
  function runningAfterBlock(ep: EffortEpisode, n: number): EffortEpisode {
    return startAttempt(reopenAfterReviewBlock(ep, 'R3 block'), 'medium', addMs(T0, n * 60_000));
  }

  test('the success that bound the candidate becomes a counted failure with the ship cause, its evidence kept, and the episode reopens at the next baseline attempt', () => {
    const ep = succeed(createEpisode('t', 'implementer', 'medium', GPT), 1, { evidence: 'DoD green' });
    assert.equal(ep.terminal, 'succeeded');
    const step = afterShipFailure(ep, 'ship dod-failed: 3 tests red', JUSTIFIED);
    assert.equal(step.refuted?.n, 1);
    const [refuted] = step.episode.attempts;
    assert.deepEqual([refuted?.outcome, refuted?.cause, refuted?.evidence, refuted?.finishedAt], ['fail', 'ship dod-failed: 3 tests red', 'DoD green; ship dod-failed: 3 tests red', ep.attempts[0]!.finishedAt]);
    assert.equal(step.episode.terminal, undefined, 'the episode is reopened');
    assert.equal(countedAttempts(step.episode).length, 1);
    assert.deepEqual(step.action, { action: 'attempt', effort: 'medium', n: 2, escalated: false });
    assert.equal(afterShipFailure(succeed(createEpisode('t', 'implementer', 'medium', GPT), 1), 'ship verify-failed: x', JUSTIFIED).episode.attempts[0]!.evidence, 'ship verify-failed: x', 'no recorded evidence: the cause alone');
  });

  test('the same ship cause twice without progress stops the episode as same-cause-stop; with progress it does not', () => {
    for (const progress of [false, true]) {
      const first = afterShipFailure(succeed(createEpisode('t', 'implementer', 'medium', GPT), 1, { progress }), 'ship ci-red: CI code defect (expected 2 to equal 3 at line 12)', JUSTIFIED);
      const second = afterShipFailure(succeed(first.episode, 2, { progress }), 'ship ci-red: CI code defect (expected 2 to equal 3 at line 40)', JUSTIFIED);
      if (progress) {
        assert.deepEqual(second.action, { action: 'attempt', effort: 'medium', n: 3, escalated: false });
        assert.equal(second.episode.terminal, undefined);
      } else {
        assert.equal(second.action.action, 'stop');
        assert.equal(second.action.action === 'stop' && second.action.reason, 'same-cause-stop');
        assert.match(second.action.action === 'stop' ? second.action.detail : '', /ship ci-red: ci code defect/);
        assert.equal(second.episode.terminal, 'same-cause-stop', 'the stop is persisted on the episode');
      }
    }
  });

  test('three refuted baseline successes: exhausted without progress, the escalation with progress, and a refuted escalation ends the episode', () => {
    for (const progress of [false, true]) {
      let ep = createEpisode('t', 'implementer', 'medium', GPT);
      let step = afterShipFailure(succeed(ep, 1, { progress }), 'ship dod-failed: a', JUSTIFIED);
      step = afterShipFailure(succeed(step.episode, 2, { progress }), 'ship dod-failed: b', JUSTIFIED);
      step = afterShipFailure(succeed(step.episode, 3, { progress }), 'ship dod-failed: c', JUSTIFIED);
      assert.equal(countedAttempts(step.episode).length, 3);
      if (!progress) {
        assert.equal(step.action.action === 'stop' && step.action.reason, 'exhausted');
        assert.equal(step.episode.terminal, 'exhausted');
        continue;
      }
      assert.deepEqual(step.action, { action: 'attempt', effort: 'high', n: 4, escalated: true });
      ep = succeed(step.episode, 4, { progress, effort: 'high' });
      step = afterShipFailure(ep, 'ship dod-failed: d', JUSTIFIED);
      assert.equal(step.action.action === 'stop' && step.action.reason, 'escalation-failed');
      assert.equal(step.episode.terminal, 'escalation-failed');
      assert.equal(countedAttempts(step.episode).length, 4, 'no fifth attempt');
    }
  });

  test('escalation needs the limits: without them the third refuted success with progress is exhausted', () => {
    let step = afterShipFailure(succeed(createEpisode('t', 'implementer', 'medium', GPT), 1, { progress: true }), 'ship dod-failed: a', JUSTIFIED);
    step = afterShipFailure(succeed(step.episode, 2, { progress: true }), 'ship dod-failed: b', JUSTIFIED);
    step = afterShipFailure(succeed(step.episode, 3, { progress: true }), 'ship dod-failed: c', { harderProblem: true, limitsPermit: false });
    assert.equal(step.action.action === 'stop' && step.action.reason, 'exhausted');
    assert.equal(step.episode.terminal, 'exhausted');
  });

  test('a not-counted record after the success never hides it; with no success to refute the attempts stay and a terminal episode stays terminal', () => {
    let ep = runningAfterBlock(succeed(createEpisode('t', 'implementer', 'medium', GPT), 1), 2);
    ep = finishAttempt(ep, { finishedAt: addMs(T0, 150_000), outcome: 'not-counted', notCountedReason: 'quota' });
    const step = afterShipFailure(ep, 'ship budget-over: 900 lines', JUSTIFIED);
    assert.deepEqual(step.episode.attempts.map((a) => a.outcome), ['fail', 'not-counted']);
    assert.equal(step.refuted?.n, 1);

    const failed = fail(createEpisode('t', 'implementer', 'medium', GPT), 1, 'type error', false);
    const none = afterShipFailure(failed, 'ship scope-blocked: src/x.ts', JUSTIFIED);
    assert.equal(none.refuted, undefined);
    assert.deepEqual(none.episode.attempts, failed.attempts, 'nothing to refute: the attempts are unchanged');
    assert.deepEqual(none.action, { action: 'attempt', effort: 'medium', n: 2, escalated: false });
    const afterBlock = fail(reopenAfterReviewBlock(succeed(createEpisode('t', 'implementer', 'medium', GPT), 1), 'R2 block'), 2, 'type error', false);
    const kept2 = afterShipFailure(afterBlock, 'ship dod-failed: x', JUSTIFIED);
    assert.equal(kept2.refuted, undefined, 'a failure after the reopened success leaves that success alone');
    assert.deepEqual(kept2.episode.attempts, afterBlock.attempts);

    // Three failures with progress, stopped as exhausted where the limits did not permit the escalation.
    const stopped: EffortEpisode = { ...fail(fail(fail(createEpisode('t', 'implementer', 'medium', GPT), 1, 'a', true), 2, 'b', true), 3, 'c', true), terminal: 'exhausted' };
    const kept = afterShipFailure(stopped, 'ship dod-failed: d', JUSTIFIED);
    assert.equal(kept.action.action, 'stop', 'a terminal episode is never reopened by a ship failure');
    assert.equal(kept.episode.terminal, 'exhausted');
  });

  test('a repair already running (opened by a review fix) is the next attempt: the ladder decides on the settled attempts and sets its effort', () => {
    const baseline = afterShipFailure(runningAfterBlock(succeed(createEpisode('t', 'implementer', 'medium', GPT), 1), 2), 'ship dod-failed: a', JUSTIFIED);
    assert.deepEqual(baseline.action, { action: 'attempt', effort: 'medium', n: 2, escalated: false });
    assert.deepEqual(baseline.episode.attempts.map((a) => [a.outcome, a.effort]), [['fail', 'medium'], ['running', 'medium']]);
    assert.equal(baseline.episode.escalationUsed, false);
    let quota = runningAfterBlock(succeed(createEpisode('t', 'implementer', 'medium', GPT), 1), 2);
    quota = startAttempt(finishAttempt(quota, { finishedAt: addMs(T0, 150_000), outcome: 'not-counted', notCountedReason: 'quota' }), 'medium', addMs(T0, 200_000));
    assert.deepEqual(afterShipFailure(quota, 'ship dod-failed: a', JUSTIFIED).action, { action: 'attempt', effort: 'medium', n: 3, escalated: false }, 'the running attempt keeps its own number');

    for (const progress of [true, false]) {
      const twice = fail(fail(createEpisode('t', 'implementer', 'medium', GPT), 1, 'a', true), 2, 'b', true);
      const step = afterShipFailure(runningAfterBlock(succeed(twice, 3, { progress }), 4), 'ship dod-failed: c', JUSTIFIED);
      if (progress) {
        assert.deepEqual(step.action, { action: 'attempt', effort: 'high', n: 4, escalated: true });
        assert.deepEqual(step.episode.attempts.map((a) => [a.outcome, a.effort]), [['fail', 'medium'], ['fail', 'medium'], ['fail', 'medium'], ['running', 'high']], 'the running repair is the escalation');
        assert.equal(step.episode.escalationUsed, true);
      } else {
        assert.equal(step.action.action === 'stop' && step.action.reason, 'exhausted');
        assert.equal(step.episode.terminal, 'exhausted');
      }
    }
  });
});
