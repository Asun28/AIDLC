import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { GOAL_TRANSITIONS, GoalTransitionError, assertGoalTransition, goalDoneEvidence, stagesForTarget, transitionGoal } from '../../src/core/goal-machine.ts';
import { makeStop } from '../../src/core/stop.ts';
import { T0, goal } from './_fixtures.ts';

describe('goal state machine (Q10 / Q15 / Q16)', () => {
  test('transition table matches the v5 diagram; terminal states have no exits', () => {
    assert.deepEqual(GOAL_TRANSITIONS.DONE, []);
    assert.deepEqual(GOAL_TRANSITIONS.STOP, []);
    assert.ok(GOAL_TRANSITIONS.PLAN.includes('CARDS'));
    assert.ok(!GOAL_TRANSITIONS.PLAN.includes('RUN'));
    assert.ok(GOAL_TRANSITIONS.RUN.includes('RUN'), 'next independent ready card');
    assert.throws(() => assertGoalTransition(goal(), 'RUN'), GoalTransitionError);
  });

  test('PLAN -> CARDS needs accepted intent; CARDS -> RUN needs an authorized projection', () => {
    assert.throws(() => assertGoalTransition(goal(), 'CARDS'), /insufficient accepted intent/);
    const cards = transitionGoal(goal(), 'CARDS', T0, { intentAccepted: true });
    assert.equal(cards.state, 'CARDS');
    assert.throws(() => transitionGoal(cards, 'RUN', T0), /not validated\/authorized/);
    assert.equal(transitionGoal(cards, 'RUN', T0, { projectionAuthorized: true }).state, 'RUN');
  });

  test('Q10: VERIFY_ARC requires closed required cards; an empty board is never DONE', () => {
    const run = goal({ state: 'RUN' });
    assert.throws(() => assertGoalTransition(run, 'VERIFY_ARC'), /never DONE/);
    assert.equal(transitionGoal(run, 'VERIFY_ARC', T0, { requiredCardsClosed: true }).state, 'VERIFY_ARC');
  });

  test('Q10/Q15: a development goal closes only after integrated acceptance and never DELIVERs', () => {
    const v = goal({ state: 'VERIFY_ARC' });
    assert.throws(() => assertGoalTransition(v, 'CLOSE'), /integrated acceptance not passed/);
    assert.equal(transitionGoal(v, 'CLOSE', T0, { integratedAcceptancePassed: true }).state, 'CLOSE');
    assert.throws(() => assertGoalTransition(v, 'DELIVER', { integratedAcceptancePassed: true }), /development-only goal has no delivery stage/);
  });

  test('Q16: a non-development target must DELIVER before CLOSE and CLOSE only when delivery is verified', () => {
    const v = goal({ state: 'VERIFY_ARC' }, 'staging');
    assert.throws(() => assertGoalTransition(v, 'CLOSE', { integratedAcceptancePassed: true }), /requires DELIVER before CLOSE/);
    const d = transitionGoal(v, 'DELIVER', T0, { integratedAcceptancePassed: true });
    assert.equal(d.state, 'DELIVER');
    assert.throws(() => assertGoalTransition(d, 'CLOSE'), /delivery target not verified/);
    assert.equal(transitionGoal(d, 'CLOSE', T0, { deliveryVerified: true }).state, 'CLOSE');
  });

  test('Q10: one bounded repair cycle: VERIFY_ARC -> CARDS only while the cycle is available', () => {
    const v = goal({ state: 'VERIFY_ARC' });
    assert.throws(() => assertGoalTransition(v, 'CARDS'), /repair cycle already used/);
    assert.equal(transitionGoal(v, 'CARDS', T0, { repairCycleAvailable: true }).state, 'CARDS');
  });

  test('CLOSE -> DONE needs complete closure and marks the goal terminal', () => {
    const c = goal({ state: 'CLOSE' });
    assert.throws(() => assertGoalTransition(c, 'DONE'), /closure incomplete/);
    const done = transitionGoal(c, 'DONE', T0, { closureComplete: true });
    assert.equal(done.terminal, true);
    assert.throws(() => assertGoalTransition(done, 'CLOSE'), /terminal/);
  });

  test('STOP needs a recorded reason, becomes terminal, and refuses further transitions', () => {
    const run = goal({ state: 'RUN' });
    assert.throws(() => transitionGoal(run, 'STOP', T0), /requires a recorded reason/);
    const stopped = transitionGoal(run, 'STOP', T0, {}, makeStop('time', 'deadline', 'hand off', { at: T0 }));
    assert.equal(stopped.terminal, true);
    assert.equal(stopped.stop?.reason, 'time');
    assert.throws(() => assertGoalTransition(stopped, 'RUN'), /terminal/);
    assert.throws(() => assertGoalTransition(stopped, 'STOP'), /terminal/);
  });

  test('WAIT -> PLAN only on an accepted revision', () => {
    const w = goal({ state: 'WAIT' });
    assert.throws(() => assertGoalTransition(w, 'PLAN'), /no accepted revision/);
    assert.equal(transitionGoal(w, 'PLAN', T0, { revisionAccepted: true }).state, 'PLAN');
  });

  test('Q15: stagesForTarget marks disabled stages not_requested, never pass/fail', () => {
    const dev = stagesForTarget('development');
    assert.equal(dev.development, 'pending');
    for (const k of ['package', 'staging', 'production', 'migration', 'operations'] as const) assert.equal(dev[k], 'not_requested');
    const prod = stagesForTarget('production');
    assert.equal(prod.staging, 'pending');
    assert.equal(prod.production, 'pending');
    assert.equal(prod.package, 'not_requested');
    assert.equal(stagesForTarget('package').package, 'pending');
    assert.equal(stagesForTarget('migration').migration, 'pending');
    assert.equal(stagesForTarget('operations').operations, 'pending');
  });

  test('Q11/Q15: goalDoneEvidence ignores not_requested stages and lists the missing ones', () => {
    const done = goal({ state: 'DONE', terminal: true, stages: { ...stagesForTarget('development'), development: 'pass' } });
    assert.deepEqual(goalDoneEvidence(done), { done: true, missing: [] });
    const pending = goal({ state: 'DONE', stages: { ...stagesForTarget('staging'), development: 'pass' } }, 'staging');
    assert.deepEqual(goalDoneEvidence(pending), { done: false, missing: ['staging=pending'] });
    const notDone = goal({ state: 'CLOSE', stages: { ...stagesForTarget('development'), development: 'pass' } });
    assert.equal(goalDoneEvidence(notDone).done, false);
  });
});
