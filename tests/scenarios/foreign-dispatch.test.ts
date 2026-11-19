// Card T0-FOREIGN-DISPATCH-NO-WRITE (issue 378): `card next` from a session that does not hold a live card lease writes
// nothing to the run record, the goal journal or the lease, and returns a stop that names the holder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { makeFixture, writeCard, goalForCards, actorA, actorB, type Fixture } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { DEFAULT_LEASE_TTL_MS, LeaseStore, resourceKeys, type ClaimResult } from '../../src/coordination/lease.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { MINUTE_MS, type Goal } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';

const CARD = 'T1-HELLO';

/** The bytes of the run record, the journal line count and the bytes of the lease record (empty when there is none). */
function written(fx: Fixture, goal: Goal): { run: string; journalLines: number; lease: string } {
  return {
    run: readFileSync(fx.store.cardFile(goal.id, CARD), 'utf8'),
    journalLines: readFileSync(fx.journal(goal.id).file, 'utf8').split('\n').filter(Boolean).length,
    lease: existsSync(fx.leases.file(resourceKeys.card(fx.repo.key, CARD))) ? readFileSync(fx.leases.file(resourceKeys.card(fx.repo.key, CARD)), 'utf8') : '',
  };
}

/** Session B prepares the card, holds its lease and reaches BUILD; the BUILD directive B's next call returns. */
function heldByB(): { fx: Fixture; goal: Goal; buildBefore: ReturnType<CardRunner['next']>['directive'] } {
  const fx = makeFixture({ actor: actorA });
  writeCard(fx, { id: CARD, title: 'print hello' });
  const goal = goalForCards(fx, [CARD]);
  setActorForTests(actorB);
  const prepared = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  assert.equal(prepared.directive.kind, 'prepare', prepared.directive.narration);
  const build = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
  assert.equal(build.directive.kind, 'build', build.directive.narration);
  assert.equal(fx.store.getCardRun(goal.id, CARD)?.state, 'BUILD');
  return { fx, goal, buildBefore: build.directive };
}

function assertNamesHolder(fx: Fixture, goal: Goal, directive: ReturnType<CardRunner['next']>['directive']): void {
  assert.equal(directive.kind, 'stop', directive.narration);
  if (directive.kind !== 'stop') return;
  const lease = fx.leases.read(resourceKeys.card(fx.repo.key, CARD))!;
  assert.equal(directive.stop.reason, 'ownership');
  for (const part of [`session ${actorB.session}`, `host ${actorB.host}`, `generation ${lease.generation}`, lease.expiresAt]) {
    assert.ok(directive.stop.detail.includes(part), `the detail names ${part}: ${directive.stop.detail}`);
  }
  assert.ok(directive.stop.nextAction.includes(`aidlc card takeover ${CARD} --goal ${goal.id}`), directive.stop.nextAction);
}

test('T0-FOREIGN-DISPATCH-NO-WRITE acceptance 1 - card next under another session\'s live card lease writes nothing and names the holder', () => {
  const { fx, goal } = heldByB();
  try {
    setActorForTests(actorA);
    const before = written(fx, goal);
    const foreign = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.deepEqual(written(fx, goal), before, 'the run file, the journal and the lease file are as before the call');
    assertNamesHolder(fx, goal, foreign.directive);
    // B's session on another host is not the holder either [R1]
    setActorForTests({ ...actorB, host: 'other-host' });
    assertNamesHolder(fx, goal, fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!).directive);
    assert.deepEqual(written(fx, goal), before, 'same session, other host: nothing written');
    // an ownership stop already on the stored run (saved by an earlier version) gives way to the stop that names the holder [R2]
    setActorForTests(actorA);
    const run = fx.store.getCardRun(goal.id, CARD)!;
    fx.store.saveCardRun({ ...run, state: 'STOP', stop: makeStop('ownership', 'this dispatch carries a stale ownership generation', 'revalidate', { at: fx.now() }) });
    const stored = written(fx, goal);
    assertNamesHolder(fx, goal, fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!).directive);
    assert.deepEqual(written(fx, goal), stored, 'a stored ownership stop: nothing written');
    // at the instant the lease expires it is still live [R1]
    fx.clock.now = fx.leases.read(resourceKeys.card(fx.repo.key, CARD))!.expiresAt;
    assertNamesHolder(fx, goal, fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!).directive);
    assert.deepEqual(written(fx, goal), stored, 'at expiresAt: nothing written');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-FOREIGN-DISPATCH-NO-WRITE acceptance 2 - the holder continues after a foreign dispatch with no recovery step', () => {
  const { fx, goal, buildBefore } = heldByB();
  try {
    setActorForTests(actorA);
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!).directive.kind, 'stop');
    setActorForTests(actorB);
    const after = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.deepEqual(after.directive, buildBefore, 'the holder gets the BUILD directive it got before the foreign call');
    const revalidated = fx.events(goal.id).filter((e) => e.type === 'LEASE_RENEWED' && e.data['revalidated'] === true);
    assert.equal(revalidated.length, 0, 'no ownership stop was left for the holder to revalidate');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

/**
 * A lease store through which session B acts on the card lease once, at one point of A's dispatch: right after A's first
 * read of it, or right before A's first claim of it.
 */
class BActs extends LeaseStore {
  readonly key: string;
  readonly at: 'after-read' | 'before-claim';
  readonly now: () => string;
  acted = false;
  constructor(dir: string, key: string, at: 'after-read' | 'before-claim', now: () => string) {
    super(dir);
    this.key = key;
    this.at = at;
    this.now = now;
  }
  override read(resourceKey: string): ReturnType<LeaseStore['read']> {
    const lease = super.read(resourceKey);
    if (this.at === 'after-read' && resourceKey === this.key) this.act();
    return lease;
  }
  override claim(resourceKey: string, options: Parameters<LeaseStore['claim']>[1] = {}): ClaimResult {
    if (this.at === 'before-claim' && resourceKey === this.key && !options.actor) this.act();
    return super.claim(resourceKey, options);
  }
  private act(): void {
    if (this.acted) return;
    this.acted = true;
    assert.match(super.claim(this.key, { actor: actorB, now: this.now(), operation: `card:${CARD}` }).status, /^(acquired|renewed)$/);
  }
}

/** A's dispatch of the stored run through `leases`, checked against the run bytes and journal lines read before it. */
function dispatchWritesNothing(fx: Fixture, goal: Goal, leases: BActs): void {
  setActorForTests(actorA);
  const before = written(fx, goal);
  const r = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now }).next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
  assert.ok(leases.acted, `session B acted on the lease ${leases.at}`);
  const after = written(fx, goal);
  assert.deepEqual({ run: after.run, journalLines: after.journalLines }, { run: before.run, journalLines: before.journalLines }, 'the run file and the journal are as before the dispatch');
  assertNamesHolder(fx, goal, r.directive);
}

test('T0-FOREIGN-DISPATCH-NO-WRITE acceptance 3 - the held claim in PREPARE writes nothing', () => {
  // a fresh run at PREPARE: B takes the lease after A's assessment selected PREPARE and before A's claim
  const fresh = makeFixture({ actor: actorA });
  try {
    writeCard(fresh, { id: CARD, title: 'print hello' });
    const goal = goalForCards(fresh, [CARD]);
    fresh.controller.ensureCardRun(fresh.goal(goal.id), CARD);
    dispatchWritesNothing(fresh, goal, new BActs(fresh.paths.leases, resourceKeys.card(fresh.repo.key, CARD), 'before-claim', fresh.now));
  } finally {
    setActorForTests(actorA);
    fresh.cleanup();
  }
  // a run in BUILD under B's expired lease, which A's assessment takes to PREPARE: B renews before A's claim
  const { fx, goal } = heldByB();
  try {
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    dispatchWritesNothing(fx, goal, new BActs(fx.paths.leases, resourceKeys.card(fx.repo.key, CARD), 'before-claim', fx.now));
    assert.equal(fx.store.getCardRun(goal.id, CARD)?.state, 'BUILD');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-FOREIGN-DISPATCH-NO-WRITE-2 R3 F2 - a lease another session takes right after the dispatch reads it writes nothing', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: CARD, title: 'print hello' });
    const goal = goalForCards(fx, [CARD]);
    fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
    dispatchWritesNothing(fx, goal, new BActs(fx.paths.leases, resourceKeys.card(fx.repo.key, CARD), 'after-read', fx.now));
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
  // a run in BUILD whose lease A held and released: B takes it right after A's read, and A's dispatch to PREPARE writes nothing
  const released = makeFixture({ actor: actorA });
  try {
    writeCard(released, { id: CARD, title: 'print hello' });
    const goal = goalForCards(released, [CARD]);
    assert.equal(released.runner().next(released.goal(goal.id), released.card(CARD), released.controller.ensureCardRun(released.goal(goal.id), CARD)).directive.kind, 'prepare');
    released.leases.release(resourceKeys.card(released.repo.key, CARD), 0, actorA);
    assert.equal(released.store.getCardRun(goal.id, CARD)?.state, 'BUILD');
    dispatchWritesNothing(released, goal, new BActs(released.paths.leases, resourceKeys.card(released.repo.key, CARD), 'after-read', released.now));
  } finally {
    setActorForTests(actorA);
    released.cleanup();
  }
});

test('T0-FOREIGN-DISPATCH-NO-WRITE-2 R3 F4 - with the plan checkpoint missing, a foreign live lease still returns the stop naming the holder', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: CARD, title: 'print hello' });
    const goal = goalForCards(fx, [CARD], { size: 'T2' });
    assert.equal(fx.goal(goal.id).state, 'CARDS', 'a T2 goal waits for its plan checkpoint');
    fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
    assert.equal(fx.leases.claim(resourceKeys.card(fx.repo.key, CARD), { actor: actorB, now: fx.now(), operation: `card:${CARD}` }).status, 'acquired');
    const before = written(fx, goal);
    const r = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.deepEqual(written(fx, goal), before, 'the run file, the journal and the lease file are as before the call');
    assertNamesHolder(fx, goal, r.directive);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-FOREIGN-DISPATCH-NO-WRITE-2 - the claim ahead of the assessment is taken only for PREPARE: a stopped run claims no lease', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: CARD, title: 'print hello' });
    const goal = goalForCards(fx, [CARD]);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
    fx.store.saveCardRun({ ...run, state: 'STOP', stop: makeStop('risk', 'a secret-looking value in the candidate', 'rotate it before any push', { at: fx.now(), global: false }) });
    const r = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.equal(r.directive.kind, 'stop');
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'risk');
    assert.equal(fx.leases.read(resourceKeys.card(fx.repo.key, CARD)), undefined, 'no lease claimed');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-FOREIGN-DISPATCH-NO-WRITE-2 - the selection ahead of the claim saves nothing: a merged card stopped for ownership with no lease is reconciled to CLOSE once, journaled', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: CARD, title: 'print hello' });
    const goal = goalForCards(fx, [CARD]);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
    fx.store.saveCardRun({ ...run, state: 'STOP', mergeVerified: true, stop: makeStop('ownership', 'this dispatch carries a stale ownership generation', 'revalidate', { at: fx.now() }) });
    fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    const reconciled = fx.events(goal.id).filter((e) => e.type === 'CARD_STATE' && e.data['from'] === 'STOP' && e.data['to'] === 'CLOSE');
    assert.equal(reconciled.length, 1, 'one STOP to CLOSE reconciliation');
    assert.equal(fx.store.getCardRun(goal.id, CARD)?.stop, undefined);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-FOREIGN-DISPATCH-NO-WRITE-2 - PREPARE uses the claim taken ahead of the assessment: a fresh dispatch journals one LEASE_ACQUIRED and no LEASE_RENEWED', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: CARD, title: 'print hello' });
    const goal = goalForCards(fx, [CARD]);
    const r = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
    assert.equal(r.directive.kind, 'prepare', r.directive.narration);
    const lease = (type: string) => fx.events(goal.id).filter((e) => e.type === type && e.cardId === CARD).length;
    assert.deepEqual({ acquired: lease('LEASE_ACQUIRED'), renewed: lease('LEASE_RENEWED') }, { acquired: 1, renewed: 0 });
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});
