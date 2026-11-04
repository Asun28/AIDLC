import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, actorA, actorB, type Fixture } from './_harness.ts';
import { Journal, setActorForTests } from '../../src/state/journal.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import { MINUTE_MS, type Goal } from '../../src/core/types.ts';

const CARD = 'T1-HELLO';

/** Goal A runs the card, its lease expired under win-A, and goal B holds no run of the card; the session is win-B. */
function expiredLease(fx: Fixture): { goal: Goal; unrelated: Goal; key: string } {
  writeCard(fx, { id: CARD, title: 'print hello' });
  writeCard(fx, { id: 'T1-OTHER', title: 'print other' });
  const goal = goalForCards(fx, [CARD]);
  const unrelated = goalForCards(fx, ['T1-OTHER']);
  const prepared = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  assert.equal(prepared.run.ownerGeneration, 0);
  fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
  setActorForTests(actorB);
  return { goal, unrelated, key: resourceKeys.card(fx.repo.key, CARD) };
}

/** A goal that holds a run of the card, written directly, so its journal is one of the card's. */
function goalRunningTheCard(fx: Fixture, goal: Goal): Goal {
  writeCard(fx, { id: 'T1-THIRD', title: 'print third' });
  const third = goalForCards(fx, ['T1-THIRD']);
  fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, CARD)!, goalId: third.id });
  return third;
}

/** The line an unmerged build leaves: well formed in every field but the type, which main does not declare. */
function appendForeignLine(fx: Fixture, goalId: string): void {
  const journal = Journal.forGoal(fx.paths.journal, goalId);
  journal.append({ type: 'NOTE', goalId, data: { kind: 'foreign' } });
  const lines = readFileSync(journal.file, 'utf8').trimEnd().split('\n');
  lines[lines.length - 1] = JSON.stringify({ ...(JSON.parse(lines[lines.length - 1]!) as Record<string, unknown>), type: 'BOUND_FIRED' });
  writeFileSync(journal.file, `${lines.join('\n')}\n`, 'utf8');
}

/** The takeover's lease section, without its run update: the lease is win-B's at generation 1, the intent journaled, the run at 0. */
function interruptAfterLeaseWrite(fx: Fixture, goal: Goal, key: string): void {
  const journal = Journal.forGoal(fx.paths.journal, goal.id);
  fx.leases.update(key, (existing) => {
    const next = fx.leases.successor(key, existing!, { operation: `card:${CARD}`, now: fx.now() });
    journal.append({ type: 'NOTE', goalId: goal.id, cardId: CARD, generation: goal.generation, data: { kind: 'card-takeover-intent', resource: key, previousOwner: existing!.owner, previousGeneration: existing!.generation, leaseGeneration: next.generation, acquirer: { session: actorB.session, host: actorB.host }, acquiredAt: fx.now() } });
    return { ...next, owner: actorB, acquiredAt: fx.now() };
  });
}

const leaseEvents = (fx: Fixture, goalId: string, key: string) => fx.events(goalId).filter((e) => e.data['resource'] === key && e.data['leaseGeneration'] === 1);
const noted = (fx: Fixture, goalId: string, key: string, kind: string) => leaseEvents(fx, goalId, key).filter((e) => e.type === 'NOTE' && e.data['kind'] === kind);
const acquired = (fx: Fixture, goalId: string, key: string) => leaseEvents(fx, goalId, key).filter((e) => e.type === 'LEASE_ACQUIRED');

test('T0-TAKEOVER-FOREIGN-LINE acceptance 1: a line the schema refuses in a goal that holds no run of the card does not reach the takeover', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goal, unrelated, key } = expiredLease(fx);
    appendForeignLine(fx, unrelated.id);
    assert.throws(() => Journal.forGoal(fx.paths.journal, unrelated.id).readAll(), { name: 'ZodError' });
    const taken = fx.runner().takeover(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.equal(taken.completed, false);
    assert.equal(fx.leases.read(key)?.owner.session, actorB.session);
    assert.equal(fx.leases.read(key)?.generation, 1);
    assert.equal(fx.store.getCardRun(goal.id, CARD)?.ownerGeneration, 1);
    assert.equal(noted(fx, goal.id, key, 'card-takeover-intent').length, 1);
    assert.equal(acquired(fx, goal.id, key).length, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-TAKEOVER-FOREIGN-LINE acceptance 2: a takeover interrupted after its lease write completes past a line in an unrelated goal', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goal, unrelated, key } = expiredLease(fx);
    appendForeignLine(fx, unrelated.id);
    interruptAfterLeaseWrite(fx, goal, key);
    assert.equal(fx.store.getCardRun(goal.id, CARD)?.ownerGeneration, 0);
    const done = fx.runner().takeover(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.equal(done.completed, true);
    assert.equal(done.previousOwner?.session, actorA.session);
    assert.equal(done.previousGeneration, 0);
    assert.equal(fx.store.getCardRun(goal.id, CARD)?.ownerGeneration, 1);
    assert.equal(acquired(fx, goal.id, key).length, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-TAKEOVER-FOREIGN-LINE acceptance 2, a snapshot of the caller: with no run stored for the goal, its own journal is still read', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goal, key } = expiredLease(fx);
    interruptAfterLeaseWrite(fx, goal, key);
    const snapshot = fx.store.getCardRun(goal.id, CARD)!;
    rmSync(path.join(fx.paths.cards, goal.id, `${CARD}.json`));
    assert.equal(fx.store.getCardRun(goal.id, CARD), undefined);
    const done = fx.runner().takeover(fx.goal(goal.id), fx.card(CARD), snapshot);
    assert.equal(done.completed, true);
    assert.equal(done.previousOwner?.session, actorA.session, 'the intent in the journal of the goal names the previous owner');
    assert.equal(done.previousGeneration, 0);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-TAKEOVER-FOREIGN-LINE acceptance 3: a line the schema refuses in a journal of the card still stops the takeover', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goal } = expiredLease(fx);
    const third = goalRunningTheCard(fx, goal);
    appendForeignLine(fx, third.id);
    assert.throws(() => fx.runner().takeover(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!), { name: 'ZodError' });
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-TAKEOVER-FOREIGN-LINE acceptance 4: the acquisition journaled under another goal that runs the card is still found', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const { goal, key } = expiredLease(fx);
    const third = goalRunningTheCard(fx, goal);
    Journal.forGoal(fx.paths.journal, third.id).append({ type: 'LEASE_ACQUIRED', goalId: third.id, cardId: CARD, generation: 0, data: { resource: key, leaseGeneration: 1, takeover: true } });
    interruptAfterLeaseWrite(fx, goal, key);
    const done = fx.runner().takeover(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.equal(done.completed, true);
    assert.equal(acquired(fx, goal.id, key).length, 0, 'no second acquisition: the first one is in the other journal');
    assert.equal(noted(fx, goal.id, key, 'card-takeover-completed').length, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-TAKEOVER-FOREIGN-LINE acceptance 5: the OPERATIONS sentence and the CHANGELOG entry', () => {
  const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.ok(read('docs/OPERATIONS.md').includes('A takeover reads the journal of the goal it runs under and of each other goal that holds a run of the card, no other journal, so a line the journal schema refuses stops only the takeover of a card run in that line\'s goal.'));
  assert.ok(read('CHANGELOG.md').includes('- T0-TAKEOVER-FOREIGN-LINE (bugfix): `aidlc card takeover` reads the journal of the goal it runs under and of each other goal that holds a run of the card, no other journal, so a line the journal schema refuses in an unrelated goal (five `BOUND_FIRED` lines an unmerged build wrote) no longer crashes the takeover of every card after its lease write. A takeover already stopped that way completes when run again.'));
});
