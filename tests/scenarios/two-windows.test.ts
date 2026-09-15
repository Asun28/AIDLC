import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, actorA, actorB, T0 } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { hostName } from '../../src/state/paths.ts';
import { DEFAULT_LEASE_TTL_MS, FencedError, LeaseStore, resourceKeys } from '../../src/coordination/lease.ts';
import { MINUTE_MS, addMs } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';

/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

test('Q23: a second window attaches read-only to a coordinated goal and cannot take an owned card', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    const goalKey = resourceKeys.goal(fx.repo.key, goal.id);
    assert.equal(fx.leases.read(goalKey)?.owner.session, 'win-A');

    // Window A prepares the card (claims the card lease).
    const runnerA = fx.runner();
    const card = fx.card('T1-HELLO');
    const rA = runnerA.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    assert.equal(rA.directive.kind, 'prepare');
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-A');

    // Window B.
    setActorForTests(actorB);
    const dB = fx.controller.next(goal.id);
    assert.equal(dB.kind, 'wait');
    if (dB.kind === 'wait') assert.equal(dB.on, 'owner:win-A');
    const runnerB = fx.runner();
    const rB = runnerB.next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(rB.directive.kind, 'stop');
    assert.equal(rB.run.stop?.reason, 'ownership');
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-A', 'the card lease is untouched');
    assert.equal(fx.leases.read(cardKey)?.generation, 0);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('Q23: takeover of an expired lease first reconciles the old owner and then fences the stale writer', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    const claimA = fx.leases.claim(cardKey, { actor: actorA, now: fx.now(), operation: 'card:T1-HELLO' });
    assert.equal(claimA.status, 'acquired');
    const op = fx.ops.recordIntent({ kind: 'merge', goalId: goal.id, cardId: 'T1-HELLO', target: 'main', candidateDigest: 'c1', ownerGeneration: 0, timeoutMs: 1000 }, fx.now());

    // Not expired yet: B is held.
    const held = fx.leases.claim(cardKey, { actor: actorB, now: fx.now() });
    assert.equal(held.status, 'held');

    // Expired: B sees 'expired' but expiry alone proves nothing.
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const expired = fx.leases.claim(cardKey, { actor: actorB, now: fx.now() });
    assert.equal(expired.status, 'expired');
    const reconcile = () => {
      const unresolved = fx.ops.unresolved(goal.id, 'T1-HELLO').map((o) => o.id);
      return { reconciled: unresolved.length === 0, unresolvedOperations: unresolved };
    };
    assert.throws(() => fx.leases.takeover(cardKey, reconcile, { actor: actorB, now: fx.now() }), /not reconciled/);

    fx.ops.markResult(op.id, 'succeeded', {}, fx.now());
    const taken = fx.leases.takeover(cardKey, reconcile, { actor: actorB, now: fx.now(), operation: 'card:T1-HELLO' });
    assert.equal(taken.lease.generation, 1);
    assert.equal(taken.lease.owner.session, 'win-B');
    assert.throws(() => fx.leases.fence(cardKey, 0, actorA, fx.now()), FencedError);
    assert.throws(() => fx.leases.heartbeat(cardKey, 0, { actor: actorA, now: fx.now() }), FencedError);
    fx.leases.fence(cardKey, 1, actorB, fx.now());
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('Q24: the shared review pool admits one request per candidate and holds a second distinct request at capacity', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const base = { pool: 'default', repository: 'repo', base: 'main', policyVersion: 'review-v1', reviewer: 'codex-review', deadline: addMs(T0, 60 * MINUTE_MS), now: T0 };
    const first = fx.queue.enqueue({ ...base, candidateDigest: 'c1', requester: 'goal-1:T1-A' });
    assert.equal(first.status, 'enqueued');
    const joined = fx.queue.enqueue({ ...base, candidateDigest: 'c1', requester: 'goal-2:T1-A' });
    assert.equal(joined.status, 'joined');
    assert.deepEqual(joined.request.requesters, ['goal-1:T1-A', 'goal-2:T1-A']);
    assert.equal(fx.queue.list('default').length, 1, 'one provider request for two windows');

    const admitted = fx.queue.admit('default', actorA, T0);
    assert.equal(admitted.status, 'admitted');
    const second = fx.queue.enqueue({ ...base, candidateDigest: 'c2', requester: 'goal-3:T1-B' });
    assert.equal(second.status, 'enqueued');
    const busy = fx.queue.admit('default', actorB, T0);
    assert.equal(busy.status, 'busy');
    if (busy.status === 'busy') assert.equal(busy.active.length, 1);

    fx.queue.complete(first.request.key, 'verdict-1', T0);
    const next = fx.queue.admit('default', actorB, T0);
    assert.equal(next.status, 'admitted');
    if (next.status === 'admitted') assert.equal(next.request.candidateDigest, 'c2');
  } finally {
    fx.cleanup();
  }
});

test('T0-SESSION-IDENTITY-2, live to expired: a run whose lease belongs to an ended session stops before PREPARE, stays stopped after expiry, and continues as the owner identity', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    const card = fx.card('T1-HELLO');
    // window A prepares the card and holds a live lease
    const prepared = fx.runner().next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    assert.equal(prepared.directive.kind, 'prepare');
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-A');
    // window B, the new session after a /clear, reads the same run: stopped for ownership before PREPARE, and the
    // stop names no owner
    setActorForTests(actorB);
    const stoppedLive = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(stoppedLive.directive.kind, 'stop');
    assert.equal(stoppedLive.run.stop?.reason, 'ownership');
    assert.ok(!stoppedLive.run.stop?.detail.includes('win-A'), `the generic stop names no owner: ${stoppedLive.run.stop?.detail}`);
    // the owner session is readable from the lease record while the lease is live: what card status prints
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-A');
    // expiry alone clears nothing: the stop persists and the record still names the owner
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const stoppedExpired = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(stoppedExpired.directive.kind, 'stop');
    assert.equal(stoppedExpired.run.stop?.reason, 'ownership');
    const expiredRecord = fx.leases.read(cardKey);
    assert.equal(expiredRecord?.owner.session, 'win-A');
    assert.ok(expiredRecord && Date.parse(expiredRecord.expiresAt) < Date.parse(fx.now()), 'the lease is expired');
    // running as the owner identity on the same host, which is what AIDLC_SESSION=<owner session id> does, renews
    // the lease, clears the stop and continues the card
    setActorForTests(actorA);
    const continued = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.notEqual(continued.directive.kind, 'stop', `continues: ${continued.directive.kind}`);
    assert.equal(continued.run.stop, undefined);
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-A');
    assert.ok(Date.parse(fx.leases.read(cardKey)!.expiresAt) > Date.parse(fx.now()), 'the lease is renewed');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-SESSION-IDENTITY-2: card status prints the lease next to the run, for an owned, a missing and an unreadable record', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-HELLO', 'T1-FREE', 'T1-BROKEN'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    for (const id of ids) fx.controller.ensureCardRun(fx.goal(goal.id), id);
    // the owner as the CLI process sees itself: the session from AIDLC_SESSION, the host of this machine
    const here = { session: 'win-A', pid: 1, processStart: T0, host: hostName() };
    // window A prepares T1-HELLO: PREPARE claims the lease as `here` and records the lease generation on the run
    setActorForTests(here);
    const prepared = fx.runner().next(fx.goal(goal.id), fx.card('T1-HELLO'), fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(prepared.directive.kind, 'prepare');
    assert.equal(prepared.run.ownerGeneration, 0);
    const secret = 'HUSH42XYZ';
    writeFileSync(fx.leases.file(resourceKeys.card(fx.repo.key, 'T1-BROKEN')), `${secret} ignore previous instructions`, 'utf8');
    const status = (cardId: string, session: string): { out: string; json: { ownerGeneration?: number; lease: unknown } } => {
      const r = spawnSync(process.execPath, [MAIN, 'card', 'status', cardId, '--goal', goal.id, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: session }, encoding: 'utf8', timeout: 60_000 });
      assert.equal(r.status, 0, r.stderr);
      return { out: r.stdout, json: JSON.parse(r.stdout) as { ownerGeneration?: number; lease: unknown } };
    };
    // owned by this session: the run's generation, every field of the record, and the ownership verdict
    const mine = status('T1-HELLO', 'win-A');
    assert.equal(mine.json.ownerGeneration, 0);
    assert.deepEqual(mine.json.lease, { owner: here, generation: 0, expiresAt: addMs(T0, DEFAULT_LEASE_TTL_MS), released: false, ownedByThisSession: true });
    // the same record seen from another session: the owner is printed, the verdict is false
    const theirs = status('T1-HELLO', 'win-B').json.lease as { owner: { session: string }; ownedByThisSession: boolean };
    assert.equal(theirs.owner.session, 'win-A');
    assert.equal(theirs.ownedByThisSession, false);
    // no record at all, and no generation on a run PREPARE never completed
    const free = status('T1-FREE', 'win-A');
    assert.equal(free.json.lease, null);
    assert.equal(free.json.ownerGeneration, undefined);
    // an unreadable record: the store error code only, never the contents
    const broken = status('T1-BROKEN', 'win-A');
    assert.deepEqual(broken.json.lease, { unreadable: 'MALFORMED_JSON' });
    assert.ok(!broken.out.includes(secret), `lease contents never enter the status output: ${broken.out}`);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-SESSION-IDENTITY-3, unprepared: a run without a recorded ownership generation is not continued by the owner identity, live or expired', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    const card = fx.card('T1-HELLO');
    // window A claimed the lease as PREPARE does first, and was interrupted before PREPARE saved the run's generation
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO');
    assert.equal(run.ownerGeneration, undefined);
    assert.equal(fx.leases.claim(cardKey, { actor: actorA, now: fx.now(), operation: 'card:T1-HELLO' }).status, 'acquired');
    // window B records the ownership stop
    setActorForTests(actorB);
    const stopped = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(stopped.directive.kind, 'stop');
    assert.equal(stopped.run.stop?.reason, 'ownership');
    // the owner identity does not continue it: the renewal requires the run's generation to equal the lease's, and
    // the run has none. The card takeover owns that run (T0-CARD-TAKEOVER, unprepared, below).
    setActorForTests(actorA);
    const live = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(live.directive.kind, 'stop');
    assert.equal(live.run.stop?.reason, 'ownership');
    assert.equal(live.run.ownerGeneration, undefined);
    assert.equal(fx.leases.read(cardKey)?.generation, 0);
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const expired = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(expired.directive.kind, 'stop');
    assert.equal(expired.run.stop?.reason, 'ownership');
    assert.equal(expired.run.ownerGeneration, undefined);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER, prepared: the takeover refuses a live or unreconciled lease, takes the expired one, fences the old owner and continues the run', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    const card = fx.card('T1-HELLO');
    const records = () => ({ run: fx.store.getCardRun(goal.id, 'T1-HELLO'), lease: fx.leases.read(cardKey), events: fx.events(goal.id).length });
    // window A prepares the card: the worktree is recorded and the run carries the lease generation
    const prepared = fx.runner().next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    assert.equal(prepared.directive.kind, 'prepare');
    assert.equal(prepared.run.ownerGeneration, 0);
    // window B, the session after a /clear, reads the run: stopped for ownership
    setActorForTests(actorB);
    const stopped = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(stopped.run.stop?.reason, 'ownership');
    // live: refused with the owner and the expiry, nothing written
    const live = records();
    assert.throws(() => fx.runner().takeover(fx.goal(goal.id), card, live.run!), /still held by win-A until .*expiry alone does not prove the owner stopped/);
    assert.deepEqual(records(), live);
    // expired, but a delivery operation of the card is unresolved: refused with its id, nothing written
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const op = fx.ops.recordIntent({ kind: 'merge', goalId: goal.id, cardId: 'T1-HELLO', target: 'main', candidateDigest: 'c1', ownerGeneration: 0, timeoutMs: 1000 }, fx.now());
    const pending = records();
    assert.throws(() => fx.runner().takeover(fx.goal(goal.id), card, pending.run!), new RegExp(`not reconciled \\(${op.id}\\)`));
    assert.deepEqual(records(), pending);
    fx.ops.markResult(op.id, 'succeeded', {}, fx.now());
    // the lease is one resource per repository and card: an operation of the card unresolved in another goal that lists it
    // refuses too, named by id, nothing written
    const other = goalForCards(fx, ['T1-HELLO']);
    const elsewhere = fx.ops.recordIntent({ kind: 'merge', goalId: other.id, cardId: 'T1-HELLO', target: 'main', candidateDigest: 'c2', ownerGeneration: 0, timeoutMs: 1000 }, fx.now());
    const foreign = records();
    assert.throws(() => fx.runner().takeover(fx.goal(goal.id), card, foreign.run!), new RegExp(`not reconciled \\(${elsewhere.id}\\)`));
    assert.deepEqual(records(), foreign);
    fx.ops.markResult(elsewhere.id, 'cancelled', {}, fx.now());
    // reconciled: the lease is taken at the next generation and the run is owned at it, its ownership stop cleared
    const taken = fx.runner().takeover(fx.goal(goal.id), card, records().run!);
    assert.equal(taken.lease.generation, 1);
    assert.equal(taken.lease.owner.session, 'win-B');
    assert.equal(taken.lease.operation, 'card:T1-HELLO');
    assert.equal(taken.completed, false);
    assert.equal(taken.previousOwner?.session, 'win-A');
    assert.equal(taken.previousGeneration, 0);
    const owned = records();
    assert.equal(owned.run?.ownerGeneration, 1);
    assert.equal(owned.run?.stop, undefined);
    assert.equal(owned.run?.state, 'BUILD', 'the state is selected again from the persisted evidence: a prepared run without receipts is BUILD');
    assert.deepEqual(JSON.parse(JSON.stringify(taken.run)), owned.run, 'the returned run is the persisted one');
    assert.equal(owned.lease?.generation, 1);
    assert.equal(owned.lease?.owner.session, 'win-B');
    const events = fx.events(goal.id);
    const intent = events.find((e) => e.type === 'NOTE' && e.cardId === 'T1-HELLO' && e.data['kind'] === 'card-takeover-intent');
    const acquired = events.find((e) => e.type === 'LEASE_ACQUIRED' && e.data['takeover'] === true);
    assert.deepEqual(intent?.data, { kind: 'card-takeover-intent', resource: cardKey, previousOwner: actorA, previousGeneration: 0, leaseGeneration: 1, acquirer: { session: 'win-B', host: 'h' }, acquiredAt: taken.lease.acquiredAt }, 'the handoff intent names the previous owner and is bound to the acquisition it precedes');
    assert.ok(intent && acquired && intent.seq < acquired.seq, 'the intent precedes the acquisition');
    assert.deepEqual(acquired?.data, { resource: cardKey, leaseGeneration: 1, takeover: true, previousOwner: 'win-A', previousGeneration: 0 });
    assert.ok(events.some((e) => e.type === 'LEASE_RENEWED' && e.data['revalidated'] === true), 'the ownership stop is cleared by the renewal that revalidates an owner lease');
    // window B continues the card
    const continued = fx.runner().next(fx.goal(goal.id), card, owned.run!);
    assert.equal(continued.directive.kind, 'build', `B continues: ${continued.directive.narration}`);
    // window A is fenced at its generation: its write is refused, and its dispatch with the run it kept from before the
    // takeover (generation 0, stale merge and closure evidence, no stop) writes nothing back. With a blocking stop
    // persisted meanwhile (risk, as a ship finding records it), the stored stop stands: A's dispatch returns it, B's
    // renewal does not clear it, and the generation, merge and closure records are the stored ones
    assert.throws(() => fx.leases.fence(cardKey, 0, actorA, fx.now()), FencedError);
    const snapshot = { ...prepared.run, mergeVerified: true, closure: { ...prepared.run.closure, metadata: true, evidence: true } };
    fx.store.saveCardRun({ ...records().run!, state: 'STOP', stop: makeStop('risk', 'a secret-looking value in the candidate', 'rotate it before any push', { at: fx.now(), global: false }) });
    setActorForTests(actorA);
    const blocked = fx.runner().next(fx.goal(goal.id), card, snapshot);
    assert.equal(blocked.directive.kind, 'stop');
    assert.equal(blocked.run.stop?.reason, 'risk', "the persisted risk stop stands over A's stale snapshot");
    const kept = records().run!;
    assert.equal(kept.stop?.reason, 'risk');
    assert.equal(kept.ownerGeneration, 1, "A's stale snapshot never writes its generation back");
    assert.equal(kept.mergeVerified, false, 'nor a merge it never verified');
    assert.deepEqual(kept.closure, owned.run!.closure, 'nor closure steps it never performed');
    setActorForTests(actorB);
    assert.equal(fx.runner().next(fx.goal(goal.id), card, records().run!).run.stop?.reason, 'risk', 'a renewal clears an ownership stop only');
    // the risk is dispositioned (the stop lifted on the stored run); A's stale dispatch then records its ownership stop
    // on the stored run, the lease stays with B
    fx.store.saveCardRun({ ...records().run!, state: 'BUILD', stop: undefined });
    setActorForTests(actorA);
    const stale = fx.runner().next(fx.goal(goal.id), card, snapshot);
    assert.equal(stale.directive.kind, 'stop');
    assert.equal(stale.run.stop?.reason, 'ownership');
    assert.equal(records().run?.stop?.reason, 'ownership');
    assert.equal(records().run?.ownerGeneration, 1);
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-B');
    assert.equal(fx.leases.read(cardKey)?.generation, 1);
    // the stop A's stale dispatch recorded is revalidated by B's next call, as any owner stop caused by expiry is
    setActorForTests(actorB);
    const again = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(again.directive.kind, 'build');
    assert.equal(again.run.stop, undefined);
    // B's own lease: nothing to take over
    const mine = records();
    assert.throws(() => fx.runner().takeover(fx.goal(goal.id), card, mine.run!), /this session owns card T1-HELLO at generation 1/);
    assert.deepEqual(records(), mine);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER, unprepared: a run interrupted between the lease claim and the PREPARE save is owned by the takeover and starts at PREPARE', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    const card = fx.card('T1-HELLO');
    // window A claimed the lease as PREPARE does first and was interrupted before the run's generation was saved
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO');
    assert.equal(run.ownerGeneration, undefined);
    assert.equal(fx.leases.claim(cardKey, { actor: actorA, now: fx.now(), operation: 'card:T1-HELLO' }).status, 'acquired');
    // window B records the ownership stop; once the lease has expired the takeover owns the run at the new generation
    setActorForTests(actorB);
    const stopped = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(stopped.run.stop?.reason, 'ownership');
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const taken = fx.runner().takeover(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(taken.lease.generation, 1);
    assert.equal(taken.run.ownerGeneration, 1);
    assert.equal(taken.run.stop, undefined);
    assert.equal(taken.run.state, 'PREPARE', 'no worktree: the state selected again is PREPARE');
    // B's next prepares the card: the lease is renewed at generation 1, not acquired again
    const prepared = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(prepared.directive.kind, 'prepare');
    assert.equal(prepared.run.ownerGeneration, 1);
    assert.equal(prepared.run.state, 'BUILD');
    assert.equal(fx.leases.read(cardKey)?.generation, 1);
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-B');
    const acquisitions = fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === 'T1-HELLO');
    assert.equal(acquisitions.length, 1, 'one acquisition of the card lease, the takeover; PREPARE renewed it');
    assert.equal(acquisitions[0]?.data['takeover'], true);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER, refusals: a missing, released or own lease refuses the takeover and writes nothing', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-FREE', 'T1-RELEASED', 'T1-MINE'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    for (const id of ids) fx.controller.ensureCardRun(fx.goal(goal.id), id);
    const refused = (id: string, pattern: RegExp) => {
      const key = resourceKeys.card(fx.repo.key, id);
      const before = { run: fx.store.getCardRun(goal.id, id), lease: fx.leases.read(key), events: fx.events(goal.id).length };
      assert.throws(() => fx.runner().takeover(fx.goal(goal.id), fx.card(id), before.run!), pattern);
      assert.deepEqual({ run: fx.store.getCardRun(goal.id, id), lease: fx.leases.read(key), events: fx.events(goal.id).length }, before, `${id}: nothing written`);
    };
    // no lease record at all; every hint names this goal, since a later command's default goal may be another one
    refused('T1-FREE', new RegExp(`card T1-FREE has no lease record; run \`aidlc card next T1-FREE --goal ${goal.id}\``));
    // a released lease: another session held it and stopped this session's dispatch for ownership, then let the card go; the
    // takeover refuses (a claim takes a released lease) and the hint holds, since next lifts an ownership stop whose lease is gone
    const releasedKey = resourceKeys.card(fx.repo.key, 'T1-RELEASED');
    assert.equal(fx.leases.claim(releasedKey, { actor: actorB, now: fx.now(), operation: 'card:T1-RELEASED' }).status, 'acquired');
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-RELEASED'), fx.store.getCardRun(goal.id, 'T1-RELEASED')!).run.stop?.reason, 'ownership');
    fx.leases.release(releasedKey, 0, actorB);
    refused('T1-RELEASED', new RegExp(`lease of card T1-RELEASED is released \\(generation 0\\); run \`aidlc card next T1-RELEASED --goal ${goal.id}\``));
    const reclaimed = fx.runner().next(fx.goal(goal.id), fx.card('T1-RELEASED'), fx.store.getCardRun(goal.id, 'T1-RELEASED')!);
    assert.equal(reclaimed.directive.kind, 'prepare', 'the ownership stop is lifted once its lease is gone, and the claim follows');
    assert.equal(reclaimed.run.stop, undefined);
    assert.equal(fx.leases.read(releasedKey)?.owner.session, 'win-A');
    assert.equal(fx.leases.read(releasedKey)?.generation, 1);
    assert.ok(fx.events(goal.id).some((e) => e.type === 'NOTE' && e.cardId === 'T1-RELEASED' && e.data['kind'] === 'ownership-stop-reconciled'), 'the reconciliation is journaled');
    // a lease this session owns, live or expired: the owner's own next continues it
    const mine = fx.runner().next(fx.goal(goal.id), fx.card('T1-MINE'), fx.store.getCardRun(goal.id, 'T1-MINE')!);
    assert.equal(mine.directive.kind, 'prepare');
    refused('T1-MINE', new RegExp(`this session owns card T1-MINE at generation 0; run \`aidlc card next T1-MINE --goal ${goal.id}\``));
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    refused('T1-MINE', /this session owns card T1-MINE at generation 0/);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER, command: `aidlc card takeover` refuses a live lease without a write, takes an expired one and prints the generations', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-HELLO', 'T1-LATE', 'T1-NORUN', 'T1-OUTSIDE', 'T1-HUMAN'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    for (const id of ['T1-HELLO', 'T1-LATE', 'T1-OUTSIDE', 'T1-HUMAN']) fx.controller.ensureCardRun(fx.goal(goal.id), id);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    // the CLI selects the state on the wall clock, so the deadlines are self-evident: T1-LATE's lies in 2020, the others' in 2126
    for (const id of ['T1-HELLO', 'T1-OUTSIDE', 'T1-HUMAN']) fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, id)!, deadline: '2126-01-01T03:00:00.000Z' });
    fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, 'T1-LATE')!, deadline: '2020-01-01T03:00:00.000Z' });
    // the ended session's lease as the CLI sees it on the wall clock: claimed in 2126 it is live, renewed in 2020 it is expired
    const ended = { session: 'win-A', pid: 1, processStart: T0, host: hostName() };
    const takeover = (cardId: string, session: string) => spawnSync(process.execPath, [MAIN, 'card', 'takeover', cardId, '--goal', goal.id, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: session }, encoding: 'utf8', timeout: 60_000 });
    assert.equal(fx.leases.claim(cardKey, { actor: ended, now: '2126-01-01T00:00:00.000Z', operation: 'card:T1-HELLO' }).status, 'acquired');
    const live = takeover('T1-HELLO', 'win-B');
    assert.notEqual(live.status, 0, 'a live lease refuses');
    assert.match(live.stderr, /still held by win-A until 2126-01-01T00:10:00\.000Z; expiry alone does not prove the owner stopped/);
    assert.equal(fx.leases.read(cardKey)?.generation, 0);
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-A');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-HELLO')?.ownerGeneration, undefined);
    // expired: taken at generation 1 by the acting session, the run owned and selected (no worktree: PREPARE)
    assert.equal(fx.leases.claim(cardKey, { actor: ended, now: '2020-01-01T00:00:00.000Z' }).status, 'renewed');
    const taken = takeover('T1-HELLO', 'win-B');
    assert.equal(taken.status, 0, taken.stderr);
    const json = JSON.parse(taken.stdout) as { lease: { generation: number; owner: { session: string; host: string } }; previousOwner: { session: string; host: string; generation: number }; run: { state: string; ownerGeneration?: number; stop?: unknown } };
    assert.equal(json.lease.generation, 1);
    assert.equal(json.lease.owner.session, 'win-B');
    assert.deepEqual(json.previousOwner, { session: 'win-A', host: hostName(), generation: 0 });
    assert.deepEqual(json.run, { state: 'PREPARE', ownerGeneration: 1 });
    assert.equal(fx.store.getCardRun(goal.id, 'T1-HELLO')?.ownerGeneration, 1);
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-B');
    // the same session again: nothing to take over
    const own = takeover('T1-HELLO', 'win-B');
    assert.notEqual(own.status, 0);
    assert.match(own.stderr, /this session owns card T1-HELLO at generation 1/);
    assert.equal(fx.leases.read(cardKey)?.generation, 1);
    // a run past its deadline: the lease is taken all the same, and the state selected is the time stop `card next` would record
    const lateKey = resourceKeys.card(fx.repo.key, 'T1-LATE');
    assert.equal(fx.leases.claim(lateKey, { actor: ended, now: '2020-01-01T00:00:00.000Z', operation: 'card:T1-LATE' }).status, 'acquired');
    const late = takeover('T1-LATE', 'win-B');
    assert.equal(late.status, 0, late.stderr);
    const lateJson = JSON.parse(late.stdout) as { lease: { generation: number; owner: { session: string } }; run: { state: string; ownerGeneration?: number; stop?: { reason: string } } };
    assert.equal(lateJson.lease.generation, 1);
    assert.equal(lateJson.lease.owner.session, 'win-B');
    assert.equal(lateJson.run.ownerGeneration, 1);
    assert.equal(lateJson.run.state, 'STOP');
    assert.equal(lateJson.run.stop?.reason, 'time');
    // no run record: nothing to take over, and none is created
    const none = takeover('T1-NORUN', 'win-B');
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /no run record for T1-NORUN/);
    assert.equal(fx.store.getCardRun(goal.id, 'T1-NORUN'), undefined, 'no run record is created');
    // an interrupted takeover (the lease this session's at generation 1, the run still at 0): the command completes it,
    // without a second advance, and names the previous owner from the handoff intent it journaled before the lease write
    fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, 'T1-HELLO')!, ownerGeneration: 0 });
    const done = takeover('T1-HELLO', 'win-B');
    assert.equal(done.status, 0, done.stderr);
    const doneJson = JSON.parse(done.stdout) as { completed: boolean; lease: { generation: number }; previousOwner?: { session: string; host: string; generation: number }; run: { state: string; ownerGeneration?: number } };
    assert.equal(doneJson.completed, true);
    assert.equal(doneJson.lease.generation, 1, 'no second advance');
    assert.deepEqual(doneJson.previousOwner, { session: 'win-A', host: hostName(), generation: 0 });
    assert.deepEqual(doneJson.run, { state: 'PREPARE', ownerGeneration: 1 });
    // a completion of a lease taken outside the command (no handoff intent journaled): completed, the generation
    // unchanged, and no previous owner in the output
    const outsideKey = resourceKeys.card(fx.repo.key, 'T1-OUTSIDE');
    assert.equal(fx.leases.claim(outsideKey, { actor: ended, now: '2020-01-01T00:00:00.000Z', operation: 'card:T1-OUTSIDE' }).status, 'acquired');
    fx.leases.takeover(outsideKey, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: { session: 'win-B', pid: 2, processStart: T0, host: hostName() }, now: '2126-01-01T00:00:00.000Z', operation: 'card:T1-OUTSIDE' });
    assert.equal(fx.store.getCardRun(goal.id, 'T1-OUTSIDE')?.ownerGeneration, undefined);
    const outside = takeover('T1-OUTSIDE', 'win-B');
    assert.equal(outside.status, 0, outside.stderr);
    const outsideJson = JSON.parse(outside.stdout) as { completed: boolean; lease: { generation: number }; run: { state: string; ownerGeneration?: number } } & Record<string, unknown>;
    assert.equal(outsideJson.completed, true);
    assert.equal(outsideJson.lease.generation, 1, 'no second advance');
    assert.equal('previousOwner' in outsideJson, false, 'no handoff intent, no previous owner');
    assert.deepEqual(outsideJson.run, { state: 'PREPARE', ownerGeneration: 1 });
    // the human line (--no-json) follows completed: a takeover reads as one, a completion names its provenance and never an advance
    const human = (cardId: string, session: string) => spawnSync(process.execPath, [MAIN, 'card', 'takeover', cardId, '--goal', goal.id, '--no-json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: session }, encoding: 'utf8', timeout: 60_000 });
    const humanKey = resourceKeys.card(fx.repo.key, 'T1-HUMAN');
    assert.equal(fx.leases.claim(humanKey, { actor: ended, now: '2020-01-01T00:00:00.000Z', operation: 'card:T1-HUMAN' }).status, 'acquired');
    const tookOver = human('T1-HUMAN', 'win-B');
    assert.equal(tookOver.status, 0, tookOver.stderr);
    assert.match(tookOver.stdout, new RegExp(`^took over T1-HUMAN from session win-A@${hostName()} \\(generation 0 -> 1\\); state=PREPARE\\nnext: aidlc card next T1-HUMAN --goal ${goal.id}`));
    fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, 'T1-HUMAN')!, ownerGeneration: 0 });
    const humanDone = human('T1-HUMAN', 'win-B');
    assert.equal(humanDone.status, 0, humanDone.stderr);
    assert.match(humanDone.stdout, new RegExp(`^completed the takeover of T1-HUMAN: the lease was already this session's at generation 1 \\(taken from session win-A@${hostName()}, generation 0, as the handoff intent records\\), the run now carries it; state=PREPARE`));
    assert.ok(!humanDone.stdout.includes('took over'), 'a completion never reads as an advance');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER, goal stopped: a goal the dispatch stopped on the card ownership stop runs the card again after the takeover and a resume', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const goalKey = resourceKeys.goal(fx.repo.key, goal.id);
    const card = fx.card('T1-HELLO');
    // window A prepares the card and ends
    const prepared = fx.runner().next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    assert.equal(prepared.directive.kind, 'prepare');
    // window B takes the goal lease after its expiry (aidlc goal takeover); the dispatch waits on the running card,
    // the card-level next stops it for ownership, and the following dispatch stops the goal on that stop
    setActorForTests(actorB);
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    fx.leases.takeover(goalKey, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorB, now: fx.now(), operation: 'coordinate' });
    assert.equal(fx.controller.next(goal.id).kind, 'wait');
    const stopped = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(stopped.run.stop?.reason, 'ownership');
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.equal(fx.goal(goal.id).terminal, true);
    assert.equal(fx.goal(goal.id).stop?.reason, 'ownership');
    // the card takeover owns the run and selects BUILD; the goal stays terminal until it is resumed
    const taken = fx.runner().takeover(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(taken.run.state, 'BUILD');
    assert.equal(taken.run.stop, undefined);
    assert.equal(fx.controller.next(goal.id).kind, 'stop', 'a terminal goal accepts no work');
    // aidlc goal resume: the next generation dispatches the card, and B continues it
    const resumed = fx.controller.report({ goalId: goal.id, generation: fx.goal(goal.id).generation, result: 'resume', data: { reason: 'card taken over by win-B' } });
    assert.equal(fx.goal(goal.id).terminal, false);
    // the dispatch reports the taken-over card as running (it has a worktree): the worker continues it with card next
    assert.equal(resumed.directive.kind, 'wait', `the resumed goal reports the card running: ${resumed.directive.kind} ${resumed.directive.narration}`);
    if (resumed.directive.kind === 'wait') assert.equal(resumed.directive.on, 'T1-HELLO:BUILD');
    const continued = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(continued.directive.kind, 'build', `B continues the card: ${continued.directive.narration}`);
    assert.equal(continued.run.ownerGeneration, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

/**
 * A lease store that lets another process act after the command's first read and before the store's own takeover
 * (`meanwhile`), or after the reconciliation returned and before the store writes the lease (`afterReconcile`).
 */
class InterleavedLeaseStore extends LeaseStore {
  readonly meanwhile: () => void;
  readonly afterReconcile: () => void;
  readonly beforeRead: (n: number) => void;
  reads = 0;
  constructor(dir: string, hooks: { meanwhile?: () => void; afterReconcile?: () => void; beforeRead?: (n: number) => void }) {
    super(dir);
    this.meanwhile = hooks.meanwhile ?? (() => undefined);
    this.afterReconcile = hooks.afterReconcile ?? (() => undefined);
    this.beforeRead = hooks.beforeRead ?? (() => undefined);
  }
  /** Every read of the store, the command's own and the ones its claims and fences make, counted; `beforeRead(n)` runs before the n-th. */
  override read(resourceKey: string): ReturnType<LeaseStore['read']> {
    this.reads += 1;
    this.beforeRead(this.reads);
    return super.read(resourceKey);
  }
  override takeover(resourceKey: string, reconcile: Parameters<LeaseStore['takeover']>[1], options?: Parameters<LeaseStore['takeover']>[2]): ReturnType<LeaseStore['takeover']> {
    this.meanwhile();
    return super.takeover(
      resourceKey,
      (old) => {
        const report = reconcile(old);
        this.afterReconcile();
        return report;
      },
      options,
    );
  }
}

test('T0-CARD-TAKEOVER, interleaved: an operation, a stop, a release or a takeover persisted between the read and the lease write is honoured, and an interrupted takeover is completed', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-OP', 'T1-LATE', 'T1-STOP', 'T1-RELEASE', 'T1-TWICE', 'T1-ABANDON', 'T1-CLAIM', 'T1-PREPARED'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    const key = (id: string) => resourceKeys.card(fx.repo.key, id);
    const current = (id: string) => fx.store.getCardRun(goal.id, id)!;
    // window A prepares every card but the two this session claims itself and ends; window B, the next session, reads each
    // run stopped for ownership
    for (const id of ids.filter((id) => id !== 'T1-CLAIM' && id !== 'T1-PREPARED')) {
      setActorForTests(actorA);
      assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(id), fx.controller.ensureCardRun(fx.goal(goal.id), id)).directive.kind, 'prepare');
      setActorForTests(actorB);
      assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(id), current(id)).run.stop?.reason, 'ownership');
    }
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const interleaved = (hooks: { meanwhile?: () => void; afterReconcile?: () => void }) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: new InterleavedLeaseStore(fx.paths.leases, hooks), queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
    const takeovers = (id: string) => fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === id && e.data['takeover'] === true);
    const intent = (cardId: string) => ({ kind: 'merge' as const, goalId: goal.id, cardId, target: 'main', candidateDigest: 'c1', ownerGeneration: 0, timeoutMs: 1000 });
    // an operation of the card recorded meanwhile: the ledger is read inside the reconciliation, so the takeover refuses it by id
    let op = '';
    assert.throws(
      () => interleaved({ meanwhile: () => { op = fx.ops.recordIntent(intent('T1-OP'), fx.now()).id; } }).takeover(fx.goal(goal.id), fx.card('T1-OP'), current('T1-OP')),
      (err: unknown) => err instanceof Error && err.message.includes(`not reconciled (${op})`),
    );
    assert.equal(fx.leases.read(key('T1-OP'))?.generation, 0);
    assert.equal(current('T1-OP').ownerGeneration, 0);
    // an operation admitted after the reconciliation returned and before the lease write: the lease is taken (its writer is
    // fenced from now on), the run is left as it was, the command names the id; once it is reconciled the command run again
    // completes the takeover, and the previous owner comes from the intent journaled before the lease write
    let lateOp = '';
    assert.throws(
      () => interleaved({ afterReconcile: () => { lateOp = fx.ops.recordIntent(intent('T1-LATE'), fx.now()).id; } }).takeover(fx.goal(goal.id), fx.card('T1-LATE'), current('T1-LATE')),
      (err: unknown) => err instanceof Error && err.message.includes(`landed after the reconciliation (${lateOp})`),
    );
    assert.equal(fx.leases.read(key('T1-LATE'))?.generation, 1, 'the lease is taken');
    assert.equal(fx.leases.read(key('T1-LATE'))?.owner.session, 'win-B');
    assert.equal(current('T1-LATE').ownerGeneration, 0, 'the run is not updated');
    assert.equal(current('T1-LATE').stop?.reason, 'ownership');
    assert.equal(takeovers('T1-LATE').length, 0, 'no acquisition journaled yet');
    assert.throws(() => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-LATE'), current('T1-LATE')), /landed after the reconciliation/);
    fx.ops.markResult(lateOp, 'succeeded', {}, fx.now());
    const lateDone = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-LATE'), current('T1-LATE'));
    assert.equal(lateDone.completed, true);
    assert.equal(lateDone.previousOwner?.session, 'win-A', 'the previous owner is recovered from the handoff intent');
    assert.equal(lateDone.previousGeneration, 0);
    assert.equal(lateDone.lease.generation, 1);
    assert.equal(lateDone.run.ownerGeneration, 1);
    assert.equal(lateDone.run.state, 'BUILD');
    assert.deepEqual(takeovers('T1-LATE').map((e) => e.data), [{ resource: key('T1-LATE'), leaseGeneration: 1, takeover: true, previousOwner: 'win-A', previousGeneration: 0, completed: true }]);
    // a stop another process persisted meanwhile: the run is read again once the lease is held, so the stop stays, at the new generation
    const riskStop = makeStop('risk', 'a secret-looking value in the candidate', 'rotate it before any push', { at: fx.now(), global: false });
    const risky = interleaved({ meanwhile: () => fx.store.saveCardRun({ ...current('T1-STOP'), state: 'STOP', stop: riskStop }) }).takeover(fx.goal(goal.id), fx.card('T1-STOP'), current('T1-STOP'));
    assert.equal(risky.lease.generation, 1);
    assert.equal(risky.run.ownerGeneration, 1);
    assert.equal(risky.run.state, 'STOP');
    assert.equal(risky.run.stop?.reason, 'risk', 'a stop that is not an ownership stop is kept');
    assert.equal(current('T1-STOP').stop?.reason, 'risk');
    // a release meanwhile (the old owner let the card go): the record the store hands to the reconciliation is released, so the takeover refuses
    assert.throws(() => interleaved({ meanwhile: () => fx.leases.release(key('T1-RELEASE'), 0, actorA) }).takeover(fx.goal(goal.id), fx.card('T1-RELEASE'), current('T1-RELEASE')), /lease of card T1-RELEASE is released \(generation 0\)/);
    assert.equal(fx.leases.read(key('T1-RELEASE'))?.generation, 0);
    assert.equal(fx.leases.read(key('T1-RELEASE'))?.released, true);
    assert.equal(current('T1-RELEASE').ownerGeneration, 0);
    // a takeover by this session meanwhile (a second window of the same session, or a retry racing the first) whose run update
    // did not land: the record handed to the reconciliation is already this session's, so no second advance; the run update is
    // completed instead, journaled as such, and the state selected
    const twiceKey = key('T1-TWICE');
    const completed = interleaved({ meanwhile: () => { fx.leases.takeover(twiceKey, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorB, now: fx.now(), operation: 'card:T1-TWICE' }); } }).takeover(fx.goal(goal.id), fx.card('T1-TWICE'), current('T1-TWICE'));
    assert.equal(completed.completed, true);
    assert.equal(completed.previousOwner, undefined);
    assert.equal(completed.lease.generation, 1, 'no second advance');
    assert.equal(completed.run.ownerGeneration, 1);
    assert.equal(completed.run.stop, undefined);
    assert.equal(completed.run.state, 'BUILD');
    const acquisitions = fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === 'T1-TWICE' && e.data['takeover'] === true);
    assert.equal(acquisitions.length, 1, "one takeover event (A's PREPARE journaled its own acquisition)");
    assert.deepEqual(acquisitions[0]?.data, { resource: twiceKey, leaseGeneration: 1, takeover: true, completed: true });
    // B continues; with the run at the lease generation there is nothing left to take over
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-TWICE'), current('T1-TWICE')).directive.kind, 'build');
    assert.throws(() => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-TWICE'), current('T1-TWICE')), /this session owns card T1-TWICE at generation 1; run/);
    // the same completion when the lease was taken and the process ended before the run update: the command run again finishes it
    const again = fx.leases.read(twiceKey)!;
    fx.store.saveCardRun({ ...current('T1-TWICE'), ownerGeneration: 0, state: 'STOP', stop: makeStop('ownership', 'this dispatch carries a stale ownership generation', 'revalidate', { at: fx.now() }) });
    const finished = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-TWICE'), current('T1-TWICE'));
    assert.equal(finished.completed, true);
    assert.equal(finished.lease.generation, again.generation);
    assert.equal(finished.run.ownerGeneration, again.generation);
    assert.equal(finished.run.stop, undefined);
    assert.equal(finished.run.state, 'BUILD');
    assert.equal(takeovers('T1-TWICE').length, 1, 'one acquisition per generation: the completion journals nothing twice');
    // a claim whose run update did not land (this session's PREPARE ended between the claim and the save): the lease is
    // this session's at generation 0 and the run carries none, so the command completes it without an advance, with no
    // previous owner (no handoff intent, since no takeover happened), and the run starts at PREPARE
    const claimKey = key('T1-CLAIM');
    fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-CLAIM');
    assert.equal(fx.leases.claim(claimKey, { actor: actorB, now: fx.now(), operation: 'card:T1-CLAIM' }).status, 'acquired');
    assert.equal(current('T1-CLAIM').ownerGeneration, undefined);
    const claimed = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-CLAIM'), current('T1-CLAIM'));
    assert.equal(claimed.completed, true);
    assert.equal(claimed.previousOwner, undefined);
    assert.equal(claimed.previousGeneration, undefined);
    assert.equal(claimed.lease.generation, 0, 'no advance');
    assert.equal(claimed.run.ownerGeneration, 0);
    assert.equal(claimed.run.state, 'PREPARE');
    assert.deepEqual(takeovers('T1-CLAIM').map((e) => e.data), [{ resource: claimKey, leaseGeneration: 0, takeover: true, completed: true }]);
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-CLAIM'), current('T1-CLAIM')).directive.kind, 'prepare');
    // an intent whose lease write never landed (this session's takeover ended right after journaling it): the old owner lets
    // the card go and a third session claims the same generation; that session's completion recovers no previous owner,
    // since the intent is bound to the acquiring session and the acquisition time the lease carries
    const abandonKey = key('T1-ABANDON');
    assert.throws(() => interleaved({ afterReconcile: () => { throw new Error('process ended'); } }).takeover(fx.goal(goal.id), fx.card('T1-ABANDON'), current('T1-ABANDON')), /process ended/);
    assert.equal(fx.leases.read(abandonKey)?.owner.session, 'win-A', 'no lease write');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'NOTE' && e.cardId === 'T1-ABANDON' && e.data['kind'] === 'card-takeover-intent').length, 1, 'the intent was journaled');
    fx.leases.release(abandonKey, 0, actorA);
    const actorC = { session: 'win-C', pid: 3, processStart: T0, host: 'h' };
    fx.advance(MINUTE_MS);
    assert.equal(fx.leases.claim(abandonKey, { actor: actorC, now: fx.now(), operation: 'card:T1-ABANDON' }).status, 'acquired');
    assert.equal(fx.leases.read(abandonKey)?.generation, 1);
    setActorForTests(actorC);
    const external = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-ABANDON'), current('T1-ABANDON'));
    assert.equal(external.completed, true);
    assert.equal(external.previousOwner, undefined, 'an intent that never acquired matches no lease');
    assert.equal(external.run.ownerGeneration, 1);
    assert.deepEqual(takeovers('T1-ABANDON').map((e) => e.data), [{ resource: abandonKey, leaseGeneration: 1, takeover: true, completed: true }]);
    setActorForTests(actorB);
    // a claim this session journaled as PREPARE does (the acquisition event before the run's generation was saved): the
    // completion recognises that acquisition, journals the completion instead of a second acquisition
    const preparedKey = key('T1-PREPARED');
    fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-PREPARED');
    assert.equal(fx.leases.claim(preparedKey, { actor: actorB, now: fx.now(), operation: 'card:T1-PREPARED' }).status, 'acquired');
    fx.journal(goal.id).append({ type: 'LEASE_ACQUIRED', goalId: goal.id, cardId: 'T1-PREPARED', generation: 0, data: { resource: preparedKey, leaseGeneration: 0 } });
    const prepared = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-PREPARED'), current('T1-PREPARED'));
    assert.equal(prepared.completed, true);
    assert.equal(prepared.run.ownerGeneration, 0);
    const preparedAcquisitions = fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === 'T1-PREPARED' && e.data['leaseGeneration'] === 0);
    assert.equal(preparedAcquisitions.length, 1, 'the acquisition PREPARE journaled is the one');
    assert.ok(fx.events(goal.id).some((e) => e.type === 'NOTE' && e.cardId === 'T1-PREPARED' && e.data['kind'] === 'card-takeover-completed' && e.data['leaseGeneration'] === 0), 'the completion is journaled as such');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER-2, completion: the lease is read once more before the completion journals and saves, and a record released or taken meanwhile refuses without a write', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-RELEASED', 'T1-TAKEN'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    for (const id of ids) fx.controller.ensureCardRun(fx.goal(goal.id), id);
    const key = (id: string) => resourceKeys.card(fx.repo.key, id);
    const snapshot = (id: string) => ({ run: fx.store.getCardRun(goal.id, id), lease: fx.leases.read(key(id)), events: fx.events(goal.id).length });
    const withHook = (beforeRead: (n: number) => void) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: new InterleavedLeaseStore(fx.paths.leases, { beforeRead }), queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
    // both leases are this session's (B) at generation 0 and the runs carry none: claims whose run update did not land
    setActorForTests(actorB);
    for (const id of ids) assert.equal(fx.leases.claim(key(id), { actor: actorB, now: fx.now(), operation: `card:${id}` }).status, 'acquired');
    // released by another process of this session between the command's first read and the completion's own read
    const released = snapshot('T1-RELEASED');
    assert.throws(() => withHook((n) => { if (n === 2) fx.leases.release(key('T1-RELEASED'), 0, actorB); }).takeover(fx.goal(goal.id), fx.card('T1-RELEASED'), released.run!), /lease of card T1-RELEASED is released \(generation 0\)/);
    assert.deepEqual({ ...snapshot('T1-RELEASED'), lease: undefined }, { ...released, lease: undefined }, 'nothing written');
    assert.equal(fx.leases.read(key('T1-RELEASED'))?.released, true);
    // taken by another session between the two reads (the lease expired and A took it): the record is another session's at the next generation
    const taken = snapshot('T1-TAKEN');
    assert.throws(
      () => withHook((n) => { if (n === 2) { fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS); fx.leases.takeover(key('T1-TAKEN'), () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorA, now: fx.now(), operation: 'card:T1-TAKEN' }); } }).takeover(fx.goal(goal.id), fx.card('T1-TAKEN'), taken.run!),
      /card T1-TAKEN is owned by session win-A \(generation 1\) since the command's first read/,
    );
    assert.deepEqual({ ...snapshot('T1-TAKEN'), lease: undefined }, { ...taken, lease: undefined }, 'nothing written');
    assert.equal(fx.leases.read(key('T1-TAKEN'))?.owner.session, 'win-A');
    assert.equal(fx.leases.read(key('T1-TAKEN'))?.generation, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER-2, across goals: the handoff intent and the acquisition are resolved by card resource and generation in every goal journal', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const first = goalForCards(fx, ['T1-HELLO']);
    const second = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    // window A prepares the card under the first goal and ends; the second goal, which lists the same card, has a run of its own
    const prepared = fx.runner().next(fx.goal(first.id), card, fx.controller.ensureCardRun(fx.goal(first.id), 'T1-HELLO'));
    assert.equal(prepared.directive.kind, 'prepare');
    fx.controller.ensureCardRun(fx.goal(second.id), 'T1-HELLO');
    setActorForTests(actorB);
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    // B takes the card through the first goal: the intent and the acquisition land in that goal's journal
    const taken = fx.runner().takeover(fx.goal(first.id), card, fx.store.getCardRun(first.id, 'T1-HELLO')!);
    assert.equal(taken.lease.generation, 1);
    assert.equal(taken.previousOwner?.session, 'win-A');
    // the second goal's run carries no generation: completing it through the second goal names the previous owner from
    // the first goal's intent and journals no second acquisition of generation 1 anywhere
    const completed = fx.runner().takeover(fx.goal(second.id), card, fx.store.getCardRun(second.id, 'T1-HELLO')!);
    assert.equal(completed.completed, true);
    assert.equal(completed.previousOwner?.session, 'win-A', 'the previous owner comes from the other goal journal');
    assert.equal(completed.previousGeneration, 0);
    assert.equal(completed.lease.generation, 1);
    assert.equal(completed.run.ownerGeneration, 1);
    const acquisitions = [first.id, second.id].flatMap((g) => fx.events(g).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === 'T1-HELLO' && e.data['takeover'] === true && e.data['leaseGeneration'] === 1));
    assert.equal(acquisitions.length, 1, 'one acquisition per generation across goals');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER-2, goal stopped at PREPARE: a taken-over run without a worktree is dispatched again as run-card after the resume, and the new owner prepares it', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    const goalKey = resourceKeys.goal(fx.repo.key, goal.id);
    const card = fx.card('T1-HELLO');
    // window A claimed the card lease as PREPARE does first and ended before the run's generation and worktree were saved
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO');
    assert.equal(run.worktree, undefined);
    assert.equal(fx.leases.claim(cardKey, { actor: actorA, now: fx.now(), operation: 'card:T1-HELLO' }).status, 'acquired');
    // window B takes the goal lease after its expiry; the dispatch offers the card (no worktree: todo), the card-level next
    // stops it on A's expired lease, and the following dispatch stops the goal on that stop
    setActorForTests(actorB);
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    fx.leases.takeover(goalKey, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorB, now: fx.now(), operation: 'coordinate' });
    assert.equal(fx.controller.next(goal.id).kind, 'run-card');
    const stopped = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(stopped.run.stop?.reason, 'ownership');
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.equal(fx.goal(goal.id).terminal, true);
    // the takeover owns the run at generation 1 and selects PREPARE; the resumed goal dispatches it again as run-card
    const taken = fx.runner().takeover(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(taken.lease.generation, 1);
    assert.equal(taken.run.state, 'PREPARE');
    const resumed = fx.controller.report({ goalId: goal.id, generation: fx.goal(goal.id).generation, result: 'resume', data: { reason: 'card taken over by win-B' } });
    assert.equal(resumed.directive.kind, 'run-card', `a run without a worktree is dispatched again: ${resumed.directive.kind} ${resumed.directive.narration}`);
    if (resumed.directive.kind === 'run-card') {
      assert.equal(resumed.directive.cardId, 'T1-HELLO');
      assert.equal(resumed.directive.cardState, 'PREPARE');
    }
    // the new owner prepares it: the lease is renewed at generation 1, not acquired again
    const prepared = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(prepared.directive.kind, 'prepare');
    assert.equal(prepared.run.ownerGeneration, 1);
    assert.equal(fx.leases.read(cardKey)?.generation, 1);
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-B');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER-2, checkpoint: next reads the stored run before its plan-checkpoint guard, so a caller snapshot carrying a stop does not skip it', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T2-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T2-HELLO'], { size: 'T2' });
    assert.equal(fx.goal(goal.id).state, 'CARDS', 'a T2 goal waits for its plan checkpoint');
    const card = fx.card('T2-HELLO');
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T2-HELLO');
    const fresh = fx.runner().next(fx.goal(goal.id), card, run);
    assert.equal(fresh.directive.kind, 'wait');
    if (fresh.directive.kind === 'wait') assert.equal(fresh.directive.on, 'goal:CARDS:plan-checkpoint');
    // a snapshot that carries a stop the stored run does not (a window that read the run before a takeover cleared it)
    const stale = fx.runner().next(fx.goal(goal.id), card, { ...run, state: 'STOP', stop: makeStop('ownership', 'this dispatch carries a stale ownership generation', 'revalidate', { at: fx.now() }) });
    assert.equal(stale.directive.kind, 'wait', `the guard applies to the stored run: ${stale.directive.kind}`);
    assert.equal(fx.store.getCardRun(goal.id, 'T2-HELLO')?.state, 'PREPARE', 'nothing dispatched');
    assert.equal(fx.leases.read(resourceKeys.card(fx.repo.key, 'T2-HELLO')), undefined, 'no lease claimed');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});
