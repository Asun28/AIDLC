import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, T0 } from './_harness.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { HOUR_MS, MINUTE_MS, addMs } from '../../src/core/types.ts';
import { effectiveGoalDeadline } from '../../src/core/deadlines.ts';

test('Q8/Q25: a one-card goal stops at the 3h admission deadline and the STOP survives a fresh controller', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    assert.equal(goal.deadlines.goalDeadline, addMs(T0, 3 * HOUR_MS));
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'stop');
    if (d.kind === 'stop') assert.equal(d.stop.reason, 'time');
    const g = fx.goal(goal.id);
    assert.equal(g.terminal, true);
    assert.equal(g.state, 'STOP');

    // A new controller over the same persisted state does not invent a clean start.
    const fresh = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, now: fx.now, cards: fx.registry });
    const again = fresh.next(goal.id);
    assert.equal(again.kind, 'stop');
    assert.equal(fresh.mustGoal(goal.id).stop?.reason, 'time');
    assert.throws(() => fresh.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-HELLO'] } }), /terminal/);
  } finally {
    fx.cleanup();
  }
});

test('Q8/Q25: a card deadline is min(start + 3h, goal deadline) and expiry stops the card, not the arc', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' });
    assert.equal(effectiveGoalDeadline(goal.deadlines), addMs(T0, 12 * HOUR_MS));
    const run = fx.controller.ensureCardRun(goal, 'T1-A');
    assert.equal(run.startedAt, T0);
    assert.equal(run.deadline, addMs(T0, 3 * HOUR_MS), 'card limit is tighter than the arc limit');

    fx.advance(3 * HOUR_MS + MINUTE_MS);
    const r = fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), run);
    assert.equal(r.directive.kind, 'stop');
    assert.equal(r.run.stop?.reason, 'time');
    assert.equal(fx.goal(goal.id).terminal, false, 'the arc itself is still within its 12h limit');
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'run-card', 'independent ready work continues');
    if (d.kind === 'run-card') assert.equal(d.cardId, 'T1-B');
  } finally {
    fx.cleanup();
  }
});

test('Q8: retries and revisions never reset the original start; a fresh runner sees the same attempts', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const runner = fx.runner();
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    fx.advance(10 * MINUTE_MS);
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    const failed = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause: 'tests red: 2 failing', progress: true });
    assert.equal(failed.effort?.attempts.length, 1);
    assert.equal(failed.startedAt, T0, 'start is fixed at the first PREPARE');
    assert.equal(failed.deadline, addMs(T0, 3 * HOUR_MS));

    const fresh = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, now: fx.now });
    const persisted = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.equal(persisted.effort?.attempts.length, 1);
    assert.equal(persisted.effort?.attempts[0]!.cause, 'tests red: 2 failing');
    const r2 = fresh.next(fx.goal(goal.id), card, persisted);
    assert.equal(r2.directive.kind, 'build');
    if (r2.directive.kind === 'build') assert.equal(r2.directive.attempt, 2, 'the counter continues; no reset through a new runner');
    assert.equal(r2.run.deadline, addMs(T0, 3 * HOUR_MS));
  } finally {
    fx.cleanup();
  }
});

test('Q8: an extension is explicit, later and recorded; an earlier date is refused', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    assert.throws(() => fx.controller.extendDeadline(goal.id, 'lead', addMs(T0, HOUR_MS), 'too early'), /later/);
    const extended = fx.controller.extendDeadline(goal.id, 'lead', addMs(T0, 5 * HOUR_MS), 'reviewer outage');
    assert.equal(effectiveGoalDeadline(extended.deadlines), addMs(T0, 5 * HOUR_MS));
    assert.equal(extended.deadlines.extensions.length, 1);
    assert.equal(extended.deadlines.extensions[0]!.by, 'lead');
    fx.advance(4 * HOUR_MS);
    assert.notEqual(fx.controller.next(goal.id).kind, 'stop', 'inside the extended window');
    fx.advance(HOUR_MS + MINUTE_MS);
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
  } finally {
    fx.cleanup();
  }
});
