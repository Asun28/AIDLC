import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, T0 } from './_harness.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { HOUR_MS, MINUTE_MS, addMs } from '../../src/core/types.ts';
import { effectiveGoalDeadline } from '../../src/core/deadlines.ts';
import { makeStop } from '../../src/core/stop.ts';

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
    assert.throws(() => fx.controller.extendDeadline(goal.id, 'lead', 'not-a-date', 'garbage'), /ISO/, 'an unparsable deadline is refused');
    assert.throws(() => fx.controller.extendDeadline(goal.id, 'lead', '', 'blank'), /ISO/);
    assert.throws(() => fx.controller.extendDeadline(goal.id, 'lead', '2026-09-11T06:00:00+00:00', 'offset form'), /ISO/, 'only the persisted UTC form is accepted');
    assert.throws(() => fx.controller.extendDeadline(goal.id, 'lead', '2026-02-30T00:00:00Z', 'no such day'), /calendar/, 'a shape-valid timestamp that is no calendar date is refused');
    assert.throws(() => fx.controller.extendDeadline(goal.id, 'lead', '2026-09-11T24:00:00Z', 'no such hour'), /calendar/);
    assert.equal(fx.goal(goal.id).deadlines.extensions.length, 0, 'a refused extension is not recorded');
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

test('R1: a recorded extension re-admits a goal stopped for time and its time-stopped cards; a stop for any other reason stays', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const runner = fx.runner();
    let r = runner.next(fx.goal(goal.id), fx.card('T1-HELLO'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), fx.card('T1-HELLO'), r.run);
    assert.equal(r.directive.kind, 'build');
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    const stopped = runner.next(fx.goal(goal.id), fx.card('T1-HELLO'), r.run);
    assert.equal(stopped.run.stop?.reason, 'time');
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.equal(fx.goal(goal.id).terminal, true);
    const until = addMs(T0, 6 * HOUR_MS);
    const extended = fx.controller.extendDeadline(goal.id, 'lead', until, 'the change is complete; the reviews and the ship remain');
    assert.equal(extended.terminal, false, 'the extension re-admits the goal');
    assert.equal(extended.state, 'CARDS', 're-entry runs through the projection check and its authorization');
    assert.equal(extended.stop, undefined);
    const hello = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.equal(hello.stop, undefined, 'the time stop of the card is cleared');
    assert.notEqual(hello.state, 'STOP', 'the re-admitted run is selectable again');
    const afterExtension = fx.controller.next(goal.id);
    assert.equal(afterExtension.kind, 'wait', `the controller waits on the re-admitted card before any worker call, it never re-stops: ${afterExtension.narration}`);
    if (afterExtension.kind === 'wait') assert.ok(afterExtension.on.includes('T1-HELLO'), afterExtension.on);
    assert.equal(hello.deadline, until, 'the card deadline follows the extension');
    assert.ok(fx.events(goal.id).some((e) => e.type === 'CARD_STATE' && e.cardId === 'T1-HELLO' && String(e.data['reason'] ?? '').includes('extension')), 'the re-admission is journaled');
    const resumed = runner.next(fx.goal(goal.id), fx.card('T1-HELLO'), hello);
    assert.equal(resumed.directive.kind, 'build', `the card continues under the new deadline: ${resumed.directive.narration}`);
    assert.notEqual(fx.controller.next(goal.id).kind, 'stop', 'the goal continues under the extension (it waits on its running card)');

    // A card stopped for another reason keeps its stop when its goal is extended.
    writeCard(fx, { id: 'T1-OTHER', title: 'stopped for review' });
    const other = goalForCards(fx, ['T1-OTHER']);
    const otherRun = fx.controller.ensureCardRun(fx.goal(other.id), 'T1-OTHER');
    fx.store.saveCardRun({ ...otherRun, state: 'STOP', stop: makeStop('review', 'second substantive block', 'adjudicate', { at: fx.now(), global: false }) });
    fx.controller.extendDeadline(other.id, 'lead', addMs(fx.now(), 6 * HOUR_MS), 'more time');
    assert.equal(fx.store.getCardRun(other.id, 'T1-OTHER')?.stop?.reason, 'review', 'a stop for another reason stays');
  } finally {
    fx.cleanup();
  }
});

test('R1: an extension after a replacement resume re-admits only the runs of the current projection; a superseded card keeps its time stop', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
    writeCard(fx, { id: 'T1-A2', title: 'a again, replacement', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B2', title: 'b again, replacement', allowPaths: ['src/b.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' });
    assert.equal(goal.deadlines.goalDeadline, addMs(T0, 12 * HOUR_MS), 'the arc limit applies, so the goal outlives the card limit');
    const runner = fx.runner();
    let a = runner.next(fx.goal(goal.id), fx.card('T1-A'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A'));
    a = runner.next(fx.goal(goal.id), fx.card('T1-A'), a.run);
    assert.equal(a.directive.kind, 'build');
    let b = runner.next(fx.goal(goal.id), fx.card('T1-B'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-B'));
    b = runner.next(fx.goal(goal.id), fx.card('T1-B'), b.run);
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    assert.equal(runner.next(fx.goal(goal.id), fx.card('T1-A'), a.run).run.stop?.reason, 'time');
    fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, 'T1-B')!, state: 'STOP', stop: makeStop('review', 'second substantive block', 'adjudicate', { at: fx.now(), global: false }) });
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.equal(fx.goal(goal.id).terminal, true);
    const resumed = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'both cards replaced', text: 'continue with the replacements', replacements: { 'T1-A': 'T1-A2', 'T1-B': 'T1-B2' } } });
    assert.equal(resumed.directive.kind, 'run-card', resumed.directive.narration);
    assert.deepEqual(fx.goal(goal.id).cards, ['T1-A2', 'T1-B2']);
    const extended = fx.controller.extendDeadline(goal.id, 'lead', addMs(T0, 20 * HOUR_MS), 'more time for the replacements');
    assert.equal(extended.terminal, false);
    const superseded = fx.store.getCardRun(goal.id, 'T1-A')!;
    assert.equal(superseded.stop?.reason, 'time', 'a run outside the current projection is not re-admitted');
    assert.equal(superseded.state, 'STOP');
    assert.ok(!fx.events(goal.id).some((e) => e.type === 'CARD_STATE' && e.cardId === 'T1-A' && String(e.data['reason'] ?? '').includes('extension')), 'no re-admission is journaled for the superseded card');
    const after = fx.controller.next(goal.id);
    assert.notEqual(after.kind, 'stop', after.narration);
    if (after.kind === 'wait') assert.ok(!after.on.includes('T1-A:'), `the controller never waits on a superseded card: ${after.on}`);
  } finally {
    fx.cleanup();
  }
});

test('R1: a T2 goal extended after a time stop passes the plan checkpoint again before any dispatch', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    const goal = goalForCards(fx, ['T1-A'], { size: 'T2' });
    assert.equal(fx.controller.next(goal.id).kind, 'checkpoint');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'approved', data: { kind: 'plan-checkpoint', by: 'user' } });
    assert.equal(fx.controller.next(goal.id).kind, 'run-card');
    const runner = fx.runner();
    let r = runner.next(fx.goal(goal.id), fx.card('T1-A'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A'));
    r = runner.next(fx.goal(goal.id), fx.card('T1-A'), r.run);
    assert.equal(r.directive.kind, 'build');
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    assert.equal(runner.next(fx.goal(goal.id), fx.card('T1-A'), r.run).run.stop?.reason, 'time');
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    // The checkpoint approval expired during the stop: re-entry must ask again before any dispatch.
    const stopped = fx.goal(goal.id);
    fx.store.saveGoal({ ...stopped, authorizations: stopped.authorizations.map((a) => ({ ...a, expiresAt: addMs(T0, 2 * HOUR_MS) })) });
    fx.controller.extendDeadline(goal.id, 'lead', addMs(T0, 6 * HOUR_MS), 'more time');
    const again = fx.controller.next(goal.id);
    assert.equal(again.kind, 'checkpoint', `re-entry passes the projection checkpoint before any dispatch: ${again.narration}`);
    if (again.kind === 'checkpoint') assert.equal(again.approvalKind, 'plan-checkpoint');
    assert.equal(fx.goal(goal.id).state, 'CARDS');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'approved', data: { kind: 'plan-checkpoint', by: 'user' } });
    const after = fx.controller.next(goal.id);
    assert.ok(after.kind === 'wait' || after.kind === 'run-card', `after the approval the re-admitted card continues: ${after.kind}`);
  } finally {
    fx.cleanup();
  }
});
