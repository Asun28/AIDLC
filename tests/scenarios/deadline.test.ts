import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor, InjectedShipPath, T0, type Fixture } from './_harness.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { HOUR_MS, MINUTE_MS, RECONCILE_GRACE_MS, addMs } from '../../src/core/types.ts';
import { effectiveGoalDeadline } from '../../src/core/deadlines.ts';
import { makeStop } from '../../src/core/stop.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import type { ShipOutcomeClass, ShipRequest, ShipResult } from '../../src/delivery/ship.ts';

/** The bounds journaled for the goal (card T1-BOUND-TELEMETRY), in journal order, each with the card it names. */
const fired = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'BOUND_FIRED').map((e) => `${String(e.data['bound'])}@${e.cardId ?? 'goal'}`);

/** The keys of those firings after the goal id: @generation/card/bound/the persisted value that fired it (R3 decision 1, R2 on cc53042). */
const keysOf = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'BOUND_FIRED').map((e) => String(e.data['key']).slice(goalId.length));

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
    assert.deepEqual(fired(fx, goal.id), ['arc-deadline@goal'], 'T1-BOUND-TELEMETRY acceptance 1: the goal deadline journals one arc-deadline firing');
    assert.ok(fx.controller.writeBoard(g).split('\n').includes('Bounds: arc-deadline 1 (DONE 0, STOP/time 1, open 0)'), 'the firing is journaled ahead of the stop it causes');

    // A new controller over the same persisted state does not invent a clean start.
    const fresh = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, now: fx.now, cards: fx.registry });
    const again = fresh.next(goal.id);
    assert.equal(again.kind, 'stop');
    assert.equal(fresh.mustGoal(goal.id).stop?.reason, 'time');
    assert.throws(() => fresh.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-HELLO'] } }), /terminal/);
    assert.deepEqual(fired(fx, goal.id), ['arc-deadline@goal'], 'a late call on the stopped goal fires nothing more');
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
    assert.deepEqual(fired(fx, goal.id), ['card-deadline@T1-A'], 'T1-BOUND-TELEMETRY acceptance 1: the card deadline journals one card-deadline firing');
    assert.equal(fx.goal(goal.id).terminal, false, 'the arc itself is still within its 12h limit');
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'run-card', 'independent ready work continues');
    if (d.kind === 'run-card') assert.equal(d.cardId, 'T1-B');
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), r.run).directive.kind, 'stop');
    assert.deepEqual(fired(fx, goal.id), ['card-deadline@T1-A'], 'the stopped card fires nothing more');
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
    // An explicit T2 goal has the 12 h arc deadline (T0-GOAL-CARD-COUNT), so the extension lands past it.
    fx.controller.extendDeadline(goal.id, 'lead', addMs(T0, 14 * HOUR_MS), 'more time');
    const again = fx.controller.next(goal.id);
    assert.equal(again.kind, 'checkpoint', `re-entry passes the projection checkpoint before any dispatch: ${again.narration}`);
    if (again.kind === 'checkpoint') assert.equal(again.approvalKind, 'plan-checkpoint');
    assert.equal(fx.goal(goal.id).state, 'CARDS');
    // A worker calling the card before the approval is parked too: the goal in CARDS has not admitted its projection.
    const early = runner.next(fx.goal(goal.id), fx.card('T1-A'), fx.store.getCardRun(goal.id, 'T1-A')!);
    assert.equal(early.directive.kind, 'wait', `no worker execution before the checkpoint: ${early.directive.narration}`);
    if (early.directive.kind === 'wait') assert.ok(early.directive.on.includes('CARDS'), early.directive.on);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'approved', data: { kind: 'plan-checkpoint', by: 'user' } });
    const after = fx.controller.next(goal.id);
    assert.equal(runner.next(fx.goal(goal.id), fx.card('T1-A'), fx.store.getCardRun(goal.id, 'T1-A')!).directive.kind, 'build', 'after the approval the worker continues');
    assert.ok(after.kind === 'wait' || after.kind === 'run-card', `after the approval the re-admitted card continues: ${after.kind}`);
  } finally {
    fx.cleanup();
  }
});

/** A ship that returns after the card deadline: the fixture clock moves while it runs. */
class LateShip extends InjectedShipPath {
  private readonly fx: Fixture;
  constructor(fx: Fixture, outcomes: ShipOutcomeClass[], stdoutText: string) {
    super(outcomes, stdoutText);
    this.fx = fx;
  }
  override ship(req: ShipRequest): ShipResult {
    this.fx.advance(4 * HOUR_MS);
    return super.ship(req);
  }
}

for (const [outcome, text, detail] of [
  ['red-missing', '', /^RED receipt rejected .* after the card deadline/],
  ['merge-failed', 'CONFLICT (content): Merge conflict in src/a.ts', /^merge conflict on the base sync after the card deadline/],
] as const) {
  test(`T1-BOUND-TELEMETRY acceptance 1: a ${outcome} ship result that returns after the card deadline stops the card for time and journals one card-deadline firing [R1]`, () => {
    const fx = makeFixture();
    try {
      writeCard(fx, { id: 'T1-LATE', title: 'the ship returns late' });
      const goal = goalForCards(fx, ['T1-LATE'], { size: 'T1' });
      const runner = fx.runner(new LateShip(fx, [outcome], text));
      const card = fx.card('T1-LATE');
      let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-LATE'));
      r = runner.next(fx.goal(goal.id), card, r.run);
      const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-LATE') });
      r = runner.next(fx.goal(goal.id), card, run1);
      assert.equal(r.directive.kind, 'stop', r.directive.narration);
      assert.equal(r.run.stop?.reason, 'time');
      assert.match(r.run.stop?.detail ?? '', detail);
      assert.deepEqual(fired(fx, goal.id), ['card-deadline@T1-LATE']);
      assert.deepEqual(keysOf(fx, goal.id), [`@0/T1-LATE/card-deadline/${addMs(T0, 3 * HOUR_MS)}`]);
      assert.equal(runner.next(fx.goal(goal.id), card, r.run).directive.kind, 'stop');
      assert.deepEqual(fired(fx, goal.id), ['card-deadline@T1-LATE'], 'the stopped card fires nothing more');
    } finally {
      fx.cleanup();
    }
  });
}

test('T1-BOUND-TELEMETRY acceptance 1: an UNKNOWN operation past the card deadline and its grace stops the card and journals one reconciliation-grace firing for the card [R1]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    const goal = goalForCards(fx, ['T1-A'], { size: 'T1' });
    const run = fx.controller.ensureCardRun(goal, 'T1-A');
    const op = fx.ops.recordIntent({ kind: 'merge', goalId: goal.id, cardId: 'T1-A', target: 'main', candidateDigest: 'c1', ownerGeneration: 0, timeoutMs: 1000 }, fx.now());
    fx.ops.markResult(op.id, 'UNKNOWN', { error: 'lookup failed' }, fx.now());
    fx.advance(3 * HOUR_MS + RECONCILE_GRACE_MS + MINUTE_MS);
    const r = fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.stop?.reason, 'time');
    assert.match(r.run.stop?.detail ?? '', /reconciliation grace expired/);
    assert.equal(fx.goal(goal.id).terminal, false, 'the goal is within its 12 h limit');
    assert.deepEqual(fired(fx, goal.id), ['reconciliation-grace@T1-A']);
    assert.deepEqual(keysOf(fx, goal.id), [`@0/T1-A/reconciliation-grace/${run.deadline}`]);
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), r.run).directive.kind, 'stop');
    assert.deepEqual(fired(fx, goal.id), ['reconciliation-grace@T1-A'], 'the stopped card fires nothing more');
  } finally {
    fx.cleanup();
  }
});

test('T1-BOUND-TELEMETRY acceptance 1: an unresolved operation past the goal deadline and its grace stops the goal and journals one reconciliation-grace firing for the goal, not an arc-deadline one [R1]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    fx.ops.recordIntent({ kind: 'merge', goalId: goal.id, cardId: 'T1-HELLO', target: 'main', candidateDigest: 'c1', ownerGeneration: 0, timeoutMs: 1000 }, fx.now());
    fx.advance(3 * HOUR_MS + RECONCILE_GRACE_MS + MINUTE_MS);
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'stop', d.narration);
    if (d.kind === 'stop') assert.equal(d.stop.detail, 'reconciliation grace expired with unresolved operations');
    assert.deepEqual(fired(fx, goal.id), ['reconciliation-grace@goal']);
    assert.deepEqual(keysOf(fx, goal.id), [`@0/-/reconciliation-grace/${effectiveGoalDeadline(goal.deadlines)}`]);
    assert.ok(fx.controller.writeBoard(fx.goal(goal.id)).split('\n').includes('Bounds: reconciliation-grace 1 (DONE 0, STOP/time 1, open 0)'), 'the firing is journaled ahead of the stop it causes');
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.deepEqual(fired(fx, goal.id), ['reconciliation-grace@goal'], 'the stopped goal fires nothing more');
  } finally {
    fx.cleanup();
  }
});

test('T1-BOUND-TELEMETRY R2 on cc53042: a resumed generation that the arc deadline stops again journals its own firing, one per generation however often it is called [R1]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    const goal = goalForCards(fx, ['T1-A']);
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    for (let i = 0; i < 2; i += 1) assert.equal(fx.controller.next(goal.id).kind, 'stop');
    // A resume keeps the deadline, so generation 1 is stopped by the same bound on the same persisted value.
    assert.equal(fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'user asked to continue' } }).directive.kind, 'stop');
    for (let i = 0; i < 2; i += 1) assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.equal(fx.goal(goal.id).generation, 1);
    const deadline = effectiveGoalDeadline(goal.deadlines);
    assert.deepEqual(keysOf(fx, goal.id), [`@0/-/arc-deadline/${deadline}`, `@1/-/arc-deadline/${deadline}`]);
    assert.ok(fx.controller.writeBoard(fx.goal(goal.id)).split('\n').includes('Bounds: arc-deadline 2 (DONE 0, STOP/time 2, open 0)'));
    assert.deepEqual(fx.events(goal.id).filter((e) => e.type === 'BOUND_FIRED').map((e) => e.generation), [0, 1], 'each entry carries the generation of its firing (T1-BOUND-TELEMETRY-2)');
  } finally {
    fx.cleanup();
  }
});

/** A line that does not parse inserted after the first one, so the journal cannot be read in full while its tail still appends; returns the repair. */
function damageJournal(fx: Fixture, goalId: string): () => void {
  const file = fx.journal(goalId).file;
  writeFileSync(file, readFileSync(file, 'utf8').replace('\n', '\nnot a journal line\n'), 'utf8');
  return () => writeFileSync(file, readFileSync(file, 'utf8').replace('not a journal line\n', ''), 'utf8');
}

test('T1-BOUND-TELEMETRY-2 acceptance 16: card next journals and clears a pending firing before selection; while the journal refuses it, card next names it and dispatches no work [R6] [R8]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    const goal = goalForCards(fx, ['T1-A'], { size: 'T1' });
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: {} });
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'continue' } }); // the card fires in generation 1
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    const repair = damageJournal(fx, goal.id);
    const next = () => fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), run);
    const stopped = next();
    assert.deepEqual([stopped.directive.kind, stopped.run.stop?.reason, fx.store.getCardRun(goal.id, 'T1-A')?.pendingFiring?.bound], ['stop', 'time', 'card-deadline'], 'the stop is saved with its firing pending');
    assert.match(stopped.directive.narration, /card-deadline\/.* stays pending/);
    fx.controller.extendDeadline(goal.id, 'lead', addMs(T0, 13 * HOUR_MS), 'more time'); // re-admits the run; the firing stays pending
    assert.equal(fx.store.getCardRun(goal.id, 'T1-A')?.pendingFiring?.bound, 'card-deadline');
    const records = () => [fx.store.cardFile(goal.id, 'T1-A'), fx.journal(goal.id).file].map((f) => readFileSync(f, 'utf8'));
    const before = records();
    const held = next();
    assert.deepEqual([held.directive.kind, held.run.state], ['wait', 'BUILD'], `no work is dispatched: ${held.directive.narration}`);
    assert.deepEqual(records(), before, 'nothing is selected or written');
    assert.match(held.directive.narration, /card-deadline\/.* stays pending/);
    repair();
    const seen = fx.events(goal.id).length;
    const resumed = next();
    assert.notEqual(resumed.directive.kind, 'wait', resumed.directive.narration);
    assert.deepEqual(fx.events(goal.id).slice(seen, seen + 1).map((e) => [e.type, e.data['key'], e.generation]), [['BOUND_FIRED', `${goal.id}@1/T1-A/card-deadline/${run.deadline}`, 1]], 'journaled before selection');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-A')?.pendingFiring, undefined);
  } finally {
    fx.cleanup();
  }
});

test('T1-BOUND-TELEMETRY-2 acceptance 16: controller next and report journal and clear a pending goal firing before anything else; while the journal refuses it they name it and a resume is not applied [R6] [R8]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    const goal = goalForCards(fx, ['T1-A']);
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    const repair = damageJournal(fx, goal.id);
    for (let i = 0; i < 2; i += 1) {
      const d = fx.controller.next(goal.id);
      assert.equal(d.kind, 'stop');
      assert.match(d.narration, /arc-deadline\/.* stays pending/, 'next names the pending firing');
    }
    const refused = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'continue' } });
    assert.deepEqual([refused.directive.kind, fx.goal(goal.id).generation], ['stop', 0], 'the resume is not applied');
    assert.match(refused.directive.narration, /arc-deadline\/.* stays pending/, 'report names the pending firing');
    fx.controller.extendDeadline(goal.id, 'lead', addMs(T0, 12 * HOUR_MS), 'more time'); // re-admits the goal; its firing stays pending
    assert.equal(fx.controller.next(goal.id).kind, 'wait', 'a re-admitted goal whose firing stays pending waits on the journal');
    repair();
    const seen = fx.events(goal.id).length;
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: {} });
    assert.deepEqual(fx.events(goal.id).slice(seen, seen + 2).map((e) => e.type), ['BOUND_FIRED', 'GOAL_STOPPED'], 'the firing is journaled before the report');
    assert.deepEqual(keysOf(fx, goal.id), [`@0/-/arc-deadline/${goal.deadlines.goalDeadline}`]);
    writeCard(fx, { id: 'T1-B', title: 'b' }); // the goal grace and the planning allowance name a refused firing too (mutants M65, M66)
    const [grace, plan] = [goalForCards(fx, ['T1-B']), fx.controller.createGoal({ text: 'build the hello feature', source: 'natural-language', affectedSurfaces: [], explicitSize: 'T1' })];
    for (const g of [grace, plan]) damageJournal(fx, g.id);
    fx.ops.recordIntent({ kind: 'merge', goalId: grace.id, cardId: 'T1-B', target: 'main', candidateDigest: 'c1', ownerGeneration: 0, timeoutMs: 1000 }, fx.advance(3 * HOUR_MS + RECONCILE_GRACE_MS + MINUTE_MS));
    assert.match(fx.controller.next(grace.id).narration, /reconciliation-grace\/.* stays pending/);
    assert.match([0, 1].map(() => fx.controller.report({ goalId: plan.id, generation: 0, result: 'plan-failed', data: {} }).directive.narration)[1]!, /planning-invocations\/.* stays pending/);
  } finally {
    fx.cleanup();
  }
});

test('T1-BOUND-TELEMETRY-2 acceptance 18: a card firing that stays pending while its goal goes terminal counts as a firing of that stop once it lands [R9]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    const goal = goalForCards(fx, ['T1-A'], { size: 'T1' });
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A');
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    const repair = damageJournal(fx, goal.id);
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), run).run.pendingFiring?.bound, 'card-deadline');
    fx.advance(MINUTE_MS);
    assert.equal(fx.controller.next(goal.id).kind, 'stop', 'the goal stops on its stopped card');
    repair();
    fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), run);
    const [stopped, fired] = fx.events(goal.id).filter((e) => e.type === 'GOAL_STOPPED' || e.type === 'BOUND_FIRED');
    assert.deepEqual([stopped?.type, stopped?.data['at'], fired?.type, fired?.data['stoppedAt']], ['GOAL_STOPPED', fx.goal(goal.id).stop?.at, 'BOUND_FIRED', fx.store.getCardRun(goal.id, 'T1-A')?.stop?.at], 'the firing lands after the stop; each carries the persisted time of its stop');
    assert.ok(fx.controller.writeBoard(fx.goal(goal.id)).split('\n').includes('Bounds: card-deadline 1 (DONE 0, STOP/time 1, open 0)'));
  } finally {
    fx.cleanup();
  }
});
