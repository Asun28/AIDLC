import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor, actorA, actorB, T0, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { HOUR_MS, MINUTE_MS, addMs, type CardRun, type JournalEvent } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';

// Card T0-CARD-STATE-OWED (issue 502): the CARD_STATE of a `card next` selection is owed with the record and journaled only
// after the card-run write that stores the selected state lands. Interleavings are injected by wrapping
// `GoalStore.saveCardRun`, never by timing.

const CARD = 'T1-A';

/** The CARD_STATE events of the card from `from` to `to`, in journal order. */
const transitions = (events: JournalEvent[], from: string, to: string) => events.filter((e) => e.type === 'CARD_STATE' && e.cardId === CARD && e.data['from'] === from && e.data['to'] === to);

/** The owed CARD_STATE entries of a stored run. */
const owedStates = (run: CardRun | undefined) => (run?.journalOwed ?? []).filter((o) => o.type === 'CARD_STATE');

/**
 * Wrap `fx.store.saveCardRun`: `before` runs once, right before the first save, and `landed` after every save that lands,
 * with the run as stored. The wrapper is the store's own instance method, so the runner's writes go through it.
 */
function wrapSaves(fx: Fixture, hooks: { before?: () => void; landed?: (run: CardRun) => void }): void {
  const real = fx.store.saveCardRun.bind(fx.store);
  let fired = false;
  fx.store.saveCardRun = (run, within) => {
    if (!fired && hooks.before) {
      fired = true;
      hooks.before();
    }
    const saved = real(run, within);
    hooks.landed?.(saved);
    return saved;
  };
}

/** A T1 goal (12 h arc, 3 h card) whose one card run is stored in SHIP, the clock past the card deadline. */
function shipPastDeadline(fx: Fixture): { goalId: string; deadline: string } {
  writeCard(fx, { id: CARD, title: 'a' });
  const goal = goalForCards(fx, [CARD], { size: 'T1' });
  const run = fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
  const stored = fx.store.saveCardRun({ ...run, state: 'SHIP' });
  assert.equal(stored.deadline, addMs(T0, 3 * HOUR_MS), 'the card limit');
  fx.advance(3 * HOUR_MS + MINUTE_MS);
  return { goalId: goal.id, deadline: stored.deadline };
}

/** One `card next` on the stored run; a throw is returned, not raised. */
function cardNext(fx: Fixture, goalId: string): { error?: Error; kind?: string; reason?: string } {
  try {
    const r = fx.runner().next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
    return { kind: r.directive.kind, reason: r.directive.kind === 'stop' ? r.directive.stop.reason : undefined };
  } catch (error) {
    return { error: error as Error };
  }
}

test('T0-CARD-STATE-OWED acceptance 1: an extension landing before the time stop is saved refuses the save as stale and leaves no SHIP to STOP CARD_STATE (issue 502 case 1) [R1] [R2]', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goalId } = shipPastDeadline(fx);
    const until = addMs(T0, 14 * HOUR_MS);
    wrapSaves(fx, { before: () => fx.controller.extendDeadline(goalId, 'lead', until, 'the ship remains') });
    const first = cardNext(fx, goalId);
    assert.match(first.error?.message ?? '', /changed since it was read/, `the save is refused as stale: ${first.error?.message ?? first.kind}`);
    assert.deepEqual(transitions(fx.events(goalId), 'SHIP', 'STOP'), [], 'the refused command journals no CARD_STATE of its transition');
    const stored = fx.store.getCardRun(goalId, CARD)!;
    assert.equal(stored.state, 'SHIP');
    assert.equal(stored.deadline, until, 'the extension stands');
    assert.deepEqual(owedStates(stored), [], 'no CARD_STATE owed on the stored run');
    const again = cardNext(fx, goalId);
    assert.equal(again.error, undefined, again.error?.message);
    assert.notEqual(again.reason, 'time', 'the next card next does not stop for time');
    assert.deepEqual(transitions(fx.events(goalId), 'SHIP', 'STOP'), [], 'still no time stop journaled');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-STATE-OWED acceptance 2: two card next calls on one read journal one SHIP to STOP CARD_STATE, from the save that lands (issue 502 case 2) [R1] [R2]', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goalId } = shipPastDeadline(fx);
    let inner: ReturnType<typeof cardNext> | undefined;
    wrapSaves(fx, { before: () => (inner = cardNext(fx, goalId)) });
    const outer = cardNext(fx, goalId);
    assert.equal(inner?.error, undefined, `the second call lands: ${inner?.error?.message}`);
    assert.equal(inner?.reason, 'time');
    assert.match(outer.error?.message ?? '', /changed since it was read/, `the first call's save is refused: ${outer.error?.message ?? outer.kind}`);
    const stops = transitions(fx.events(goalId), 'SHIP', 'STOP');
    assert.equal(stops.length, 1, 'exactly one CARD_STATE for the one stop');
    assert.equal(typeof stops[0]!.data['eventKey'], 'string', 'the owed entry key');
    assert.equal(stops[0]!.data['completed'], undefined, 'journaled by the command whose write stored it');
    assert.equal(fx.store.getCardRun(goalId, CARD)!.state, 'STOP');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-STATE-OWED acceptance 3: a lost CARD_STATE append after the stop landed stays owed and the next card next appends it once, completed [R3]', () => {
  const fx = makeFixture({ actor: actorA });
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['appendFileSync']!;
  try {
    const { goalId } = shipPastDeadline(fx);
    let failed = false;
    target['appendFileSync'] = (...args: unknown[]) => {
      if (!failed && String(args[1]).includes('"type":"CARD_STATE"')) {
        failed = true;
        throw Object.assign(new Error('EIO: injected fault on a CARD_STATE line'), { code: 'EIO' });
      }
      return real(...args);
    };
    syncBuiltinESMExports();
    let first: ReturnType<typeof cardNext>;
    try {
      first = cardNext(fx, goalId);
    } finally {
      target['appendFileSync'] = real;
      syncBuiltinESMExports();
    }
    assert.ok(failed, 'the fault was injected');
    assert.match(first.error?.message ?? '', /EIO/, 'the append fails the command');
    const stored = fx.store.getCardRun(goalId, CARD)!;
    assert.equal(stored.state, 'STOP', 'the stop landed before the append');
    assert.equal(owedStates(stored).length, 1, 'the CARD_STATE is owed on the run');
    assert.deepEqual(transitions(fx.events(goalId), 'SHIP', 'STOP'), [], 'the journal holds none');
    const second = cardNext(fx, goalId);
    assert.equal(second.error, undefined, second.error?.message);
    const stops = transitions(fx.events(goalId), 'SHIP', 'STOP');
    assert.equal(stops.length, 1, 'the next card next appends it once');
    assert.equal(stops[0]!.data['completed'], true, 'completed for the earlier command');
    assert.equal(stops[0]!.data['eventKey'], owedStates(stored)[0]!.key);
    cardNext(fx, goalId);
    assert.equal(transitions(fx.events(goalId), 'SHIP', 'STOP').length, 1, 'a third card next appends none');
  } finally {
    target['appendFileSync'] = real;
    syncBuiltinESMExports();
    setActorForTests(actorA);
    fx.cleanup();
  }
});

/** A merged card stopped for ownership with no lease (the fixture of foreign-dispatch.test.ts, STOP to CLOSE reconciliation). */
function mergedOwnershipStop(fx: Fixture): string {
  writeCard(fx, { id: CARD, title: 'a' });
  const goal = goalForCards(fx, [CARD]);
  const run = fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
  fx.store.saveCardRun({ ...run, state: 'STOP', mergeVerified: true, stop: makeStop('ownership', 'this dispatch carries a stale ownership generation', 'revalidate', { at: fx.now() }) });
  return goal.id;
}

test('T0-CARD-STATE-OWED acceptance 4: the ownership-stop reconciliation journals STOP to CLOSE only after the write that stores CLOSE, and none when that write is refused [R1] [R2]', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const goalId = mergedOwnershipStop(fx);
    wrapSaves(fx, { before: () => fx.store.updateCardRun(goalId, CARD, (current) => ({ ...current!, blocker: 'written meanwhile' })) });
    const refused = cardNext(fx, goalId);
    assert.match(refused.error?.message ?? '', /changed since it was read/, `the reconciliation save is refused: ${refused.error?.message ?? refused.kind}`);
    assert.deepEqual(transitions(fx.events(goalId), 'STOP', 'CLOSE'), [], 'no STOP to CLOSE for a refused write');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
  const fy = makeFixture({ actor: actorA });
  try {
    const goalId = mergedOwnershipStop(fy);
    const landed: { state: string; journal: number }[] = [];
    wrapSaves(fy, { landed: (run) => landed.push({ state: run.state, journal: fy.events(goalId).length }) });
    const r = cardNext(fy, goalId);
    assert.equal(r.error, undefined, r.error?.message);
    const events = fy.events(goalId);
    const closes = transitions(events, 'STOP', 'CLOSE');
    assert.equal(closes.length, 1, 'exactly one STOP to CLOSE');
    const stored = landed.find((s) => s.state === 'CLOSE');
    assert.ok(stored, 'a save stored CLOSE');
    assert.ok(events.indexOf(closes[0]!) >= stored.journal, `the event follows the write that stored CLOSE (event at ${events.indexOf(closes[0]!)}, journal length ${stored.journal} at that write)`);
  } finally {
    setActorForTests(actorA);
    fy.cleanup();
  }
});

/** A card driven to BUILD with a successful attempt, so the next `card next` selects SHIP and ships through `shipPath`. */
function builtCandidate(fx: Fixture, shipPath: DryRunShipPath): { goalId: string; runner: ReturnType<Fixture['runner']> } {
  writeCard(fx, { id: CARD, title: 'a' });
  const goal = goalForCards(fx, [CARD]);
  const runner = fx.runner(shipPath);
  let r = runner.next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  r = runner.next(fx.goal(goal.id), fx.card(CARD), r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  runner.recordAttempt(fx.goal(goal.id), fx.card(CARD), r.run, { outcome: 'success', dodReceipt: `dod:${CARD}`, redReceipt: `red:${CARD}`, candidateSha: candidateShaFor(CARD) });
  return { goalId: goal.id, runner };
}

for (const outcome of ['merged', 'auth-failed'] as const) {
  test(`T0-CARD-STATE-OWED R3 decision 1 F1: a ship whose result is written outside the dispatch save (${outcome}) still journals BUILD to SHIP once, after the write that stores SHIP [R1] [R5]`, () => {
    const fx = makeFixture({ actor: actorA });
    try {
      const { goalId, runner } = builtCandidate(fx, new DryRunShipPath([outcome]));
      const landed: { state: string; journal: number }[] = [];
      wrapSaves(fx, { landed: (run) => landed.push({ state: run.state, journal: fx.events(goalId).length }) });
      runner.next(fx.goal(goalId), fx.card(CARD), fx.store.getCardRun(goalId, CARD)!);
      const events = fx.events(goalId);
      const ships = transitions(events, 'BUILD', 'SHIP');
      assert.equal(ships.length, 1, 'one BUILD to SHIP');
      const stored = landed.find((s) => s.state === 'SHIP');
      assert.ok(stored, 'a save stored SHIP before the ship');
      assert.ok(events.indexOf(ships[0]!) >= stored.journal, 'the event follows that write');
      assert.ok(events.indexOf(ships[0]!) < events.findIndex((e) => e.type === 'OPERATION_INTENT'), 'and precedes the ship intent');
    } finally {
      setActorForTests(actorA);
      fx.cleanup();
    }
  });
}

test('T0-CARD-STATE-OWED R3 decision 1 F3: an owed CARD_STATE is not recovered by a card next under another session live lease [R4]', () => {
  const fx = makeFixture({ actor: actorA });
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['appendFileSync']!;
  try {
    const { goalId } = shipPastDeadline(fx);
    let failed = false;
    target['appendFileSync'] = (...args: unknown[]) => {
      if (!failed && String(args[1]).includes('"type":"CARD_STATE"')) {
        failed = true;
        throw Object.assign(new Error('EIO: injected fault on a CARD_STATE line'), { code: 'EIO' });
      }
      return real(...args);
    };
    syncBuiltinESMExports();
    try {
      cardNext(fx, goalId);
    } finally {
      target['appendFileSync'] = real;
      syncBuiltinESMExports();
    }
    assert.equal(owedStates(fx.store.getCardRun(goalId, CARD)).length, 1, 'the CARD_STATE is owed');
    const key = resourceKeys.card(fx.repo.key, CARD);
    assert.equal(fx.leases.claim(key, { actor: actorB, now: fx.now(), operation: `card:${CARD}` }).status, 'acquired', 'session B holds the card lease');
    const refused = cardNext(fx, goalId);
    assert.equal(refused.kind, 'stop', `the dispatch stops under the holder's lease: ${refused.error?.message ?? refused.kind}`);
    assert.deepEqual(transitions(fx.events(goalId), 'SHIP', 'STOP'), [], 'no append under the foreign lease');
    assert.equal(owedStates(fx.store.getCardRun(goalId, CARD)).length, 1, 'still owed');
  } finally {
    target['appendFileSync'] = real;
    syncBuiltinESMExports();
    setActorForTests(actorA);
    fx.cleanup();
  }
});
