import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, actorA, actorB, T0 } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { hostName } from '../../src/state/paths.ts';
import { DEFAULT_LEASE_TTL_MS, FencedError, LeaseStore, resourceKeys } from '../../src/coordination/lease.ts';
import { MINUTE_MS, addMs } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { StoreError } from '../../src/state/store.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

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
 * Route one `node:fs` function through `wrap` while `body` runs (the ESM binding of a builtin follows the CJS export after a
 * sync): the boundary every writer of the state directory passes, never an injected collaborator.
 */
function throughFs<T>(name: 'openSync' | 'readFileSync' | 'renameSync' | 'appendFileSync' | 'unlinkSync', wrap: (real: (...args: unknown[]) => unknown, args: unknown[]) => unknown, body: () => T): T {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target[name]!;
  target[name] = (...args: unknown[]) => wrap(real, args);
  syncBuiltinESMExports();
  try {
    return body();
  } finally {
    target[name] = real;
    syncBuiltinESMExports();
  }
}

/** Run `before(n)` ahead of the n-th exclusive create of `lock` while `body` runs, and `held(n)` once that create has taken the lock. */
function onLock<T>(lock: string, hooks: { before?: (n: number) => void; held?: (n: number) => void }, body: () => T): T {
  let n = 0;
  return throughFs(
    'openSync',
    (real, args) => {
      if (String(args[0]) !== lock || args[1] !== 'wx') return real(...args);
      const at = (n += 1);
      hooks.before?.(at);
      const fd = real(...args);
      hooks.held?.(at);
      return fd;
    },
    body,
  );
}

test('T0-CARD-TAKEOVER, interleaved (T1-STORE-CAS-2): an operation, a stop, a release or a takeover persisted before the lease section is honoured, an operation attempted inside it is refused, and an interrupted takeover is completed', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-OP', 'T1-LATE', 'T1-STOP', 'T1-RELEASE', 'T1-TWICE', 'T1-ABANDON', 'T1-CLAIM', 'T1-PREPARED'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    const key = (id: string) => resourceKeys.card(fx.repo.key, id);
    const lockOf = (id: string) => `${fx.leases.file(key(id))}.lock`;
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
    const takeover = (id: string) => fx.runner().takeover(fx.goal(goal.id), fx.card(id), current(id));
    // Another process acts after the command's first read and before its lease section takes the lease lock.
    const beforeSection = (id: string, meanwhile: () => void) => onLock(lockOf(id), { before: (n) => { if (n === 1) meanwhile(); } }, () => takeover(id));
    const takeovers = (id: string) => fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === id && e.data['takeover'] === true);
    const intent = (cardId: string) => ({ kind: 'merge' as const, goalId: goal.id, cardId, target: 'main', candidateDigest: 'c1', ownerGeneration: 0, timeoutMs: 1000 });
    // an operation of the card recorded meanwhile: the ledger is read inside the lease section, so the takeover refuses it by id
    let op = '';
    assert.throws(
      () => beforeSection('T1-OP', () => { op = fx.ops.recordIntent(intent('T1-OP'), fx.now()).id; }),
      (err: unknown) => err instanceof Error && op !== '' && err.message.includes(`not reconciled (${op})`),
    );
    assert.equal(fx.leases.read(key('T1-OP'))?.generation, 0);
    assert.equal(current('T1-OP').ownerGeneration, 0);
    // an operation attempted while the takeover holds the lease lock, as a ship records its intent (under that lock): it waits for
    // the lock, is refused and records nothing, and the takeover goes through with one acquisition journaled
    const quick = new LeaseStore(fx.paths.leases, { timeoutMs: 50 });
    let attempted: unknown;
    const late = onLock(lockOf('T1-LATE'), {
      held: (n) => {
        if (n !== 1) return;
        try {
          quick.update(key('T1-LATE'), (lease) => { fx.ops.recordIntent(intent('T1-LATE'), fx.now()); return lease; });
        } catch (err) {
          attempted = err;
        }
      },
    }, () => takeover('T1-LATE'));
    assert.match(String(attempted), /locked/, 'refused while the takeover holds the lease lock');
    assert.deepEqual(fx.ops.list({ cardId: 'T1-LATE' }), [], 'no operation is recorded');
    assert.equal(late.completed, false);
    assert.equal(late.lease.generation, 1);
    assert.equal(late.lease.owner.session, 'win-B');
    assert.equal(late.run.ownerGeneration, 1);
    assert.equal(late.run.state, 'BUILD');
    assert.deepEqual(takeovers('T1-LATE').map((e) => e.data), [{ resource: key('T1-LATE'), leaseGeneration: 1, takeover: true, previousOwner: 'win-A', previousGeneration: 0 }]);
    // a stop another process persisted meanwhile: the run update reads the stored run under the card-run lock, so the stop stays, at the new generation
    const riskStop = makeStop('risk', 'a secret-looking value in the candidate', 'rotate it before any push', { at: fx.now(), global: false });
    const risky = beforeSection('T1-STOP', () => fx.store.saveCardRun({ ...current('T1-STOP'), state: 'STOP', stop: riskStop }));
    assert.equal(risky.lease.generation, 1);
    assert.equal(risky.run.ownerGeneration, 1);
    assert.equal(risky.run.state, 'STOP');
    assert.equal(risky.run.stop?.reason, 'risk', 'a stop that is not an ownership stop is kept');
    assert.equal(current('T1-STOP').stop?.reason, 'risk');
    // a release meanwhile (the old owner let the card go): the record the lease section reads is released, so the takeover refuses
    assert.throws(() => beforeSection('T1-RELEASE', () => fx.leases.release(key('T1-RELEASE'), 0, actorA)), /lease of card T1-RELEASE is released \(generation 0\)/);
    assert.equal(fx.leases.read(key('T1-RELEASE'))?.generation, 0);
    assert.equal(fx.leases.read(key('T1-RELEASE'))?.released, true);
    assert.equal(current('T1-RELEASE').ownerGeneration, 0);
    // a takeover by this session meanwhile (a second window of the same session, or a retry racing the first) whose run update
    // did not land: the record the lease section reads is already this session's, so no second advance; the run update is
    // completed instead, journaled as such, and the state selected
    const twiceKey = key('T1-TWICE');
    const completed = beforeSection('T1-TWICE', () => { fx.leases.takeover(twiceKey, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorB, now: fx.now(), operation: 'card:T1-TWICE' }); });
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
    assert.throws(() => takeover('T1-TWICE'), /this session owns card T1-TWICE at generation 1; run/);
    // the same completion when the lease was taken and the process ended before the run update: the command run again finishes it
    const again = fx.leases.read(twiceKey)!;
    fx.store.saveCardRun({ ...current('T1-TWICE'), ownerGeneration: 0, state: 'STOP', stop: makeStop('ownership', 'this dispatch carries a stale ownership generation', 'revalidate', { at: fx.now() }) });
    const finished = takeover('T1-TWICE');
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
    const claimed = takeover('T1-CLAIM');
    assert.equal(claimed.completed, true);
    assert.equal(claimed.previousOwner, undefined);
    assert.equal(claimed.previousGeneration, undefined);
    assert.equal(claimed.lease.generation, 0, 'no advance');
    assert.equal(claimed.run.ownerGeneration, 0);
    assert.equal(claimed.run.state, 'PREPARE');
    assert.deepEqual(takeovers('T1-CLAIM').map((e) => e.data), [{ resource: claimKey, leaseGeneration: 0, takeover: true, completed: true }]);
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-CLAIM'), current('T1-CLAIM')).directive.kind, 'prepare');
    // an intent whose lease write never landed (this session's takeover ended right after journaling it, at the rename of the
    // lease record): the old owner lets the card go and a third session claims the same generation; that session's completion
    // recovers no previous owner, since the intent is bound to the acquiring session and the acquisition time the lease carries
    const abandonKey = key('T1-ABANDON');
    const abandonFile = fx.leases.file(abandonKey);
    assert.throws(() => throughFs('renameSync', (real, args) => { if (String(args[1]) === abandonFile) throw new Error('process ended'); return real(...args); }, () => takeover('T1-ABANDON')), /process ended/);
    assert.equal(fx.leases.read(abandonKey)?.owner.session, 'win-A', 'no lease write');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'NOTE' && e.cardId === 'T1-ABANDON' && e.data['kind'] === 'card-takeover-intent').length, 1, 'the intent was journaled');
    assert.equal(takeovers('T1-ABANDON').length, 0, 'no acquisition is journaled for a lease write that never landed');
    fx.leases.release(abandonKey, 0, actorA);
    const actorC = { session: 'win-C', pid: 3, processStart: T0, host: 'h' };
    fx.advance(MINUTE_MS);
    assert.equal(fx.leases.claim(abandonKey, { actor: actorC, now: fx.now(), operation: 'card:T1-ABANDON' }).status, 'acquired');
    assert.equal(fx.leases.read(abandonKey)?.generation, 1);
    setActorForTests(actorC);
    const external = takeover('T1-ABANDON');
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
    const prepared = takeover('T1-PREPARED');
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

test('T0-CARD-TAKEOVER-2, completion (T1-STORE-CAS-2): a completion decides on the record its lease section reads, so a record released or taken before that section refuses without a write', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-RELEASED', 'T1-TAKEN'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    for (const id of ids) fx.controller.ensureCardRun(fx.goal(goal.id), id);
    const key = (id: string) => resourceKeys.card(fx.repo.key, id);
    const snapshot = (id: string) => ({ run: fx.store.getCardRun(goal.id, id), lease: fx.leases.read(key(id)), events: fx.events(goal.id).length });
    const beforeSection = (id: string, meanwhile: () => void, run: ReturnType<typeof snapshot>['run']) => onLock(`${fx.leases.file(key(id))}.lock`, { before: (n) => { if (n === 1) meanwhile(); } }, () => fx.runner().takeover(fx.goal(goal.id), fx.card(id), run!));
    // both leases are this session's (B) at generation 0 and the runs carry none: claims whose run update did not land
    setActorForTests(actorB);
    for (const id of ids) assert.equal(fx.leases.claim(key(id), { actor: actorB, now: fx.now(), operation: `card:${id}` }).status, 'acquired');
    // released by another process of this session after the command's first read and before its lease section
    const released = snapshot('T1-RELEASED');
    assert.throws(() => beforeSection('T1-RELEASED', () => fx.leases.release(key('T1-RELEASED'), 0, actorB), released.run), /lease of card T1-RELEASED is released \(generation 0\)/);
    assert.deepEqual({ ...snapshot('T1-RELEASED'), lease: undefined }, { ...released, lease: undefined }, 'nothing written');
    assert.equal(fx.leases.read(key('T1-RELEASED'))?.released, true);
    // taken by another session in between (the lease expired and A took it): the record is another session's, live, at the next generation
    const taken = snapshot('T1-TAKEN');
    assert.throws(
      () => beforeSection('T1-TAKEN', () => { fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS); fx.leases.takeover(key('T1-TAKEN'), () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorA, now: fx.now(), operation: 'card:T1-TAKEN' }); }, taken.run),
      /is still held by win-A until .*expiry alone does not prove the owner stopped/,
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
    // the stored run itself stopped for ownership while its lease is gone: the reconciliation lifts the stop, and the guard
    // still holds afterwards, with an absent lease and with a released one
    const cardKey = resourceKeys.card(fx.repo.key, 'T2-HELLO');
    const ownershipStop = () => makeStop('ownership', 'this dispatch carries a stale ownership generation', 'revalidate', { at: fx.now() });
    fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, 'T2-HELLO')!, state: 'STOP', stop: ownershipStop() });
    const absent = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T2-HELLO')!);
    assert.equal(absent.directive.kind, 'wait', `the guard holds after the reconciliation (absent lease): ${absent.directive.kind}`);
    if (absent.directive.kind === 'wait') assert.equal(absent.directive.on, 'goal:CARDS:plan-checkpoint');
    assert.equal(fx.leases.read(cardKey), undefined, 'no lease claimed');
    assert.equal(fx.leases.claim(cardKey, { actor: actorB, now: fx.now(), operation: 'card:T2-HELLO' }).status, 'acquired');
    fx.leases.release(cardKey, 0, actorB);
    fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, 'T2-HELLO')!, state: 'STOP', stop: ownershipStop() });
    const released = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T2-HELLO')!);
    assert.equal(released.directive.kind, 'wait', `the guard holds after the reconciliation (released lease): ${released.directive.kind}`);
    assert.equal(fx.leases.read(cardKey)?.released, true, 'no lease claimed');
    assert.notEqual(fx.store.getCardRun(goal.id, 'T2-HELLO')?.state, 'BUILD', 'nothing dispatched');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-CARD-TAKEOVER-2, stale writers: an attempt record and a CI reconciliation from the old owner with the run it kept land on the stored run, never its generation or a persisted stop', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    // window A prepares the card and keeps the run it read (generation 0, no stop); window B takes the card over after the
    // expiry, and a blocking stop is persisted on the stored run
    const prepared = fx.runner().next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    assert.equal(prepared.directive.kind, 'prepare');
    setActorForTests(actorB);
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const taken = fx.runner().takeover(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(taken.lease.generation, 1);
    const risk = makeStop('risk', 'a secret-looking value in the candidate', 'rotate it before any push', { at: fx.now(), global: false });
    fx.store.saveCardRun({ ...fx.store.getCardRun(goal.id, 'T1-HELLO')!, state: 'STOP', stop: risk });
    // A's delayed attempt record with its stale snapshot: it applies no fence, so its receipts and candidate land on the
    // stored run, but the stored generation and the persisted stop stand
    setActorForTests(actorA);
    const recorded = fx.runner().recordAttempt(fx.goal(goal.id), card, prepared.run, { outcome: 'success', dodReceipt: 'dod:stale', redReceipt: 'red:stale', candidateSha: 'sha-stale' });
    assert.equal(recorded.ownerGeneration, 1, 'the stored generation stands');
    assert.equal(recorded.stop?.reason, 'risk', 'the persisted stop stands');
    assert.equal(recorded.dodReceipt, 'dod:stale');
    assert.equal(recorded.candidate?.sha, 'sha-stale');
    const stored = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.equal(stored.ownerGeneration, 1);
    assert.equal(stored.stop?.reason, 'risk');
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-B');
    // A's CI reconciliation with the same stale snapshot: the same rule
    const reconciled = fx.runner().ciReconcile(fx.goal(goal.id), card, prepared.run, 'run-1', () => ({ status: 'completed', conclusion: 'success', attempt: 1 }));
    assert.equal(reconciled.ownerGeneration, 1, 'the stored generation stands');
    assert.equal(reconciled.stop?.reason, 'risk', 'the persisted stop stands');
    assert.equal(reconciled.dodReceipt, 'dod:stale', 'and so does what the attempt recorded');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-HELLO')?.ownerGeneration, 1);
    // B's next call sees the stop the loop knows, not a dispatch of the old owner
    setActorForTests(actorB);
    assert.equal(fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!).run.stop?.reason, 'risk');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test("T1-STORE-CAS-2 acceptance 4: a ship's fence and intent share the card lease lock with the takeover: an intent attempted while the lock is held is refused, an intent recorded first refuses the takeover by id, and a ship after the takeover is fenced with no intent", () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-HELD', 'T1-FIRST', 'T1-AFTER'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    const key = (id: string) => resourceKeys.card(fx.repo.key, id);
    const lockOf = (id: string) => `${fx.leases.file(key(id))}.lock`;
    const current = (id: string) => fx.store.getCardRun(goal.id, id)!;
    const intents = (id: string) => fx.ops.list({ cardId: id });
    // window A (a lease store that waits 50 ms for a lock) prepares each card and records its candidate: the next call ships it
    const windowA = (shipPath: DryRunShipPath = new DryRunShipPath(['merged'])) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }), queue: fx.queue, ops: fx.ops, shipPath, now: fx.now });
    for (const id of ids) {
      const prepared = windowA().next(fx.goal(goal.id), fx.card(id), fx.controller.ensureCardRun(fx.goal(goal.id), id));
      assert.equal(prepared.directive.kind, 'prepare');
      const build = windowA().next(fx.goal(goal.id), fx.card(id), prepared.run);
      assert.equal(build.directive.kind, 'build');
      windowA().recordAttempt(fx.goal(goal.id), fx.card(id), build.run, { outcome: 'success', dodReceipt: `dod:${id}`, redReceipt: `red:${id}`, candidateSha: `sha-${id}` });
    }
    const takeoverByB = (id: string) => {
      setActorForTests(actorB);
      try {
        return fx.runner().takeover(fx.goal(goal.id), fx.card(id), current(id));
      } finally {
        setActorForTests(actorA);
      }
    };
    // The owner's call takes the lease lock twice: its renewal, then the ship's fence and intent.
    const atShipSection = (id: string, act: () => void) => onLock(lockOf(id), { before: (n) => { if (n === 2) act(); } }, () => windowA().next(fx.goal(goal.id), fx.card(id), current(id)));
    // held: a takeover holds the lease lock (its record names this live process) when A's ship reaches its section
    let fired = 0;
    assert.throws(() => atShipSection('T1-HELD', () => { fired += 1; writeFileSync(lockOf('T1-HELD'), `pid=${process.pid} at=${fx.now()} nonce=takeover`, 'utf8'); }), /locked/);
    assert.equal(fired, 1, "the ship's section is the second lease section of the call");
    assert.deepEqual(intents('T1-HELD'), [], 'no intent is recorded');
    assert.ok(!fx.events(goal.id).some((e) => e.type === 'OPERATION_INTENT' && e.cardId === 'T1-HELD'));
    unlinkSync(lockOf('T1-HELD'));
    // first: A's intent is recorded, and a takeover attempted while the ship is in flight refuses and names it
    let refusal: unknown;
    let inFlight = '';
    class TakeoverDuringShip extends DryRunShipPath {
      override ship(req: Parameters<DryRunShipPath['ship']>[0]): ReturnType<DryRunShipPath['ship']> {
        inFlight = intents('T1-FIRST')[0]?.id ?? '';
        fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
        try {
          takeoverByB('T1-FIRST');
        } catch (err) {
          refusal = err;
        }
        return super.ship(req);
      }
    }
    windowA(new TakeoverDuringShip(['merged'])).next(fx.goal(goal.id), fx.card('T1-FIRST'), current('T1-FIRST'));
    assert.notEqual(inFlight, '', 'the intent was recorded before the dispatch');
    assert.match(String(refusal), new RegExp(`not reconciled \\(${inFlight}\\)`));
    assert.equal(fx.leases.read(key('T1-FIRST'))?.owner.session, 'win-A');
    assert.equal(fx.leases.read(key('T1-FIRST'))?.generation, 0);
    // after: B takes the card over once A's ship has passed its gate and before its section; the section's fence refuses at the
    // stale generation, no intent is recorded, and the stale ship writes nothing over the new owner's run
    let taken: ReturnType<CardRunner['takeover']> | undefined;
    assert.throws(() => atShipSection('T1-AFTER', () => { fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS); taken = takeoverByB('T1-AFTER'); }), /changed since it was read/);
    assert.equal(taken?.lease.generation, 1);
    assert.deepEqual(intents('T1-AFTER'), [], 'the fenced ship records no intent');
    assert.ok(!fx.events(goal.id).some((e) => e.type === 'OPERATION_INTENT' && e.cardId === 'T1-AFTER'));
    assert.equal(current('T1-AFTER').ownerGeneration, 1);
    assert.equal(current('T1-AFTER').stop, undefined);
    assert.equal(fx.leases.read(key('T1-AFTER'))?.owner.session, 'win-B');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test("T1-STORE-CAS-2 acceptance 5: a stop saved between the takeover's run read and its run update survives the takeover, and an old owner's review commit after the takeover is fenced", async () => {
  const fx = makeFixture({ actor: actorA, config: { preReview: { command: ['fake-r2', '{instructions}'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const ids = ['T1-STOPPED', 'T1-REVIEW'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    const current = (id: string) => fx.store.getCardRun(goal.id, id)!;
    let onDispatch: (() => void) | undefined;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-review.ts\u0000' },
      'git diff': { stdout: 'diff --git a/src/t1-review.ts b/src/t1-review.ts\n+export const review = 1;\n' },
      'fake-r2': () => {
        onDispatch?.();
        return { stdout: '{"verdict":"pass","reasons":[]}\n' };
      },
    });
    const runner = () => new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    // window A prepares both cards and records the candidate of T1-REVIEW
    for (const id of ids) assert.equal(runner().next(fx.goal(goal.id), fx.card(id), fx.controller.ensureCardRun(fx.goal(goal.id), id)).directive.kind, 'prepare');
    const build = runner().next(fx.goal(goal.id), fx.card('T1-REVIEW'), current('T1-REVIEW'));
    assert.equal(build.directive.kind, 'build');
    const candidate = runner().recordAttempt(fx.goal(goal.id), fx.card('T1-REVIEW'), build.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    // B's takeover: another process saves a risk stop right after the command's first read of the run record
    const runFile = fx.store.cardFile(goal.id, 'T1-STOPPED');
    const risk = makeStop('risk', 'a secret-looking value in the candidate', 'rotate it before any push', { at: fx.now(), global: false });
    let reads = 0;
    let taken: ReturnType<CardRunner['takeover']> | undefined;
    setActorForTests(actorB);
    const caller = current('T1-STOPPED');
    assert.doesNotThrow(() => {
      taken = throughFs(
        'readFileSync',
        (real, args) => {
          const out = real(...args);
          if (String(args[0]) === runFile && ++reads === 1) fx.store.saveCardRun({ ...current('T1-STOPPED'), state: 'STOP', stop: risk });
          return out;
        },
        () => runner().takeover(fx.goal(goal.id), fx.card('T1-STOPPED'), caller),
      );
    });
    assert.equal(taken?.lease.generation, 1);
    assert.equal(taken?.run.ownerGeneration, 1);
    assert.equal(taken?.run.stop?.reason, 'risk', 'the stop saved meanwhile survives the takeover');
    assert.equal(current('T1-STOPPED').stop?.reason, 'risk');
    assert.equal(current('T1-STOPPED').ownerGeneration, 1);
    // A's pre-review of T1-REVIEW is in flight when B takes the card over: its commit is fenced at the new generation
    setActorForTests(actorA);
    const reserved = runner().next(fx.goal(goal.id), fx.card('T1-REVIEW'), candidate).run;
    let tookOver: ReturnType<CardRunner['takeover']> | undefined;
    onDispatch = () => {
      onDispatch = undefined;
      fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
      setActorForTests(actorB);
      try {
        tookOver = runner().takeover(fx.goal(goal.id), fx.card('T1-REVIEW'), current('T1-REVIEW'));
      } finally {
        setActorForTests(actorA);
      }
    };
    const reviewed = await runner().preReview(fx.goal(goal.id), fx.card('T1-REVIEW'), reserved);
    assert.equal(tookOver?.lease.generation, 1);
    assert.equal(reviewed.run.ownerGeneration, 1, 'the run keeps the new generation');
    assert.equal(reviewed.run.stop?.reason, 'ownership', "the old owner's review commit is fenced");
    assert.match(reviewed.run.stop?.detail ?? '', /fenced: .*owned by win-B/);
    assert.ok(!reviewed.run.preReview.rounds.some((r) => r.outcome === 'pending'), 'its reservation is released');
    assert.ok(!reviewed.run.preReview.rounds.some((r) => r.outcome === 'pass'), 'no pass of the old owner is recorded');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-STORE-CAS-2 acceptance 6: two completions of one takeover generation journal exactly one LEASE_ACQUIRED', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-TWO', title: 'card T1-TWO' });
    const goal = goalForCards(fx, ['T1-TWO']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-TWO');
    const current = () => fx.store.getCardRun(goal.id, 'T1-TWO')!;
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-TWO'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-TWO')).directive.kind, 'prepare');
    // B took the lease at generation 1 and ended before the run update and the acquisition were journaled
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    fx.leases.takeover(cardKey, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorB, now: fx.now(), operation: 'card:T1-TWO' });
    setActorForTests(actorB);
    // two windows of B complete it at once: the second runs while the first journals the acquisition
    const second = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }), queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
    let armed = true;
    let secondError: unknown;
    let firstError: unknown;
    throughFs(
      'appendFileSync',
      (real, args) => {
        if (armed && String(args[1]).includes('"LEASE_ACQUIRED"')) {
          armed = false;
          try {
            second.takeover(fx.goal(goal.id), fx.card('T1-TWO'), current());
          } catch (err) {
            secondError = err;
          }
        }
        return real(...args);
      },
      () => {
        try {
          fx.runner().takeover(fx.goal(goal.id), fx.card('T1-TWO'), current());
        } catch (err) {
          firstError = err;
        }
      },
    );
    const acquisitions = () => fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === 'T1-TWO' && e.data['leaseGeneration'] === 1);
    assert.equal(acquisitions().length, 1, 'one LEASE_ACQUIRED for generation 1');
    assert.equal(armed, false, 'the second completion ran while the first journaled the acquisition');
    assert.match(String(secondError), /locked/, 'the second completion waits for the lease lock the first holds, then refuses');
    assert.equal(firstError, undefined);
    assert.equal(current().ownerGeneration, 1);
    // the second completion run again: the run carries the generation, so nothing is left to complete and nothing is journaled
    assert.throws(() => second.takeover(fx.goal(goal.id), fx.card('T1-TWO'), current()), /this session owns card T1-TWO at generation 1/);
    assert.equal(acquisitions().length, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test("T1-STORE-CAS-2: the ship's duplicate check runs in its lease section: a merge of the candidate issued meanwhile makes the ship wait on it with no second intent", () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-DUP', title: 'card T1-DUP' });
    const goal = goalForCards(fx, ['T1-DUP']);
    const current = () => fx.store.getCardRun(goal.id, 'T1-DUP')!;
    const prepared = fx.runner().next(fx.goal(goal.id), fx.card('T1-DUP'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-DUP'));
    const build = fx.runner().next(fx.goal(goal.id), fx.card('T1-DUP'), prepared.run);
    assert.equal(build.directive.kind, 'build');
    fx.runner().recordAttempt(fx.goal(goal.id), fx.card('T1-DUP'), build.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-dup' });
    // Another window of the owner issued the merge of this candidate after this call's gate and before its ship section.
    let other = '';
    const lock = `${fx.leases.file(resourceKeys.card(fx.repo.key, 'T1-DUP'))}.lock`;
    const shipped = onLock(lock, {
      before: (n) => {
        if (n !== 2) return;
        other = fx.ops.recordIntent({ kind: 'merge', goalId: goal.id, cardId: 'T1-DUP', target: 'main', candidateDigest: current().candidate!.digest, ownerGeneration: 0, timeoutMs: 1000 }, fx.now()).id;
        fx.ops.markIssued(other, undefined, fx.now());
      },
    }, () => fx.runner().next(fx.goal(goal.id), fx.card('T1-DUP'), current()));
    assert.notEqual(other, '', "the other window's merge was issued at the ship section");
    assert.equal(shipped.directive.kind, 'wait');
    if (shipped.directive.kind === 'wait') assert.equal(shipped.directive.on, `operation:${other}`);
    assert.deepEqual(fx.ops.list({ cardId: 'T1-DUP' }).map((o) => o.id), [other], 'no second intent is recorded');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-STORE-CAS-2: a lease of the same session id on another host is another session\'s: the takeover advances it instead of completing it', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-HOST', title: 'card T1-HOST' });
    const goal = goalForCards(fx, ['T1-HOST']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HOST');
    fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HOST');
    const elsewhere = { session: 'win-B', pid: 9, processStart: T0, host: 'elsewhere' };
    assert.equal(fx.leases.claim(cardKey, { actor: elsewhere, now: fx.now(), operation: 'card:T1-HOST' }).status, 'acquired');
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    setActorForTests(actorB);
    const taken = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-HOST'), fx.store.getCardRun(goal.id, 'T1-HOST')!);
    assert.equal(taken.completed, false);
    assert.equal(taken.lease.generation, 1, 'the generation advances');
    assert.deepEqual(taken.lease.owner, actorB);
    assert.deepEqual(taken.previousOwner, elsewhere);
    assert.equal(taken.run.ownerGeneration, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

/**
 * Window B takes card `id` over at the next generation and pauses right before its run update (the first exclusive create
 * of the card-run lock); `meanwhile` runs there, then B resumes. Returns B's error, if any.
 */
function pausedTakeover(fx: ReturnType<typeof makeFixture>, goalId: string, id: string, meanwhile: () => void): unknown {
  const runLock = `${fx.store.cardFile(goalId, id)}.lock`;
  setActorForTests(actorB);
  try {
    onLock(runLock, { before: (n) => { if (n === 1) meanwhile(); } }, () => fx.runner().takeover(fx.goal(goalId), fx.card(id), fx.store.getCardRun(goalId, id)!));
    return undefined;
  } catch (err) {
    return err;
  } finally {
    setActorForTests(actorA);
  }
}

test('T1-STORE-CAS R3 decision 1 F2: a takeover that lost the lease before its run update refuses and never writes its older generation over a later owner', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-STALE', title: 'card T1-STALE' });
    const goal = goalForCards(fx, ['T1-STALE']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-STALE');
    const current = () => fx.store.getCardRun(goal.id, 'T1-STALE')!;
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-STALE'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-STALE')).directive.kind, 'prepare');
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    // B takes the lease at generation 1 and pauses; its lease expires and C completes a takeover at generation 2
    const actorC = { session: 'win-C', pid: 3, processStart: T0, host: 'h' };
    let byC: ReturnType<CardRunner['takeover']> | undefined;
    let afterC: ReturnType<typeof current> | undefined;
    let eventsAfterC = 0;
    const refusal = pausedTakeover(fx, goal.id, 'T1-STALE', () => {
      assert.equal(fx.leases.read(cardKey)?.generation, 1, "B's lease write landed before the pause");
      fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
      setActorForTests(actorC);
      try {
        byC = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-STALE'), current());
      } finally {
        setActorForTests(actorB);
      }
      afterC = current();
      eventsAfterC = fx.events(goal.id).length;
    });
    assert.equal(byC?.lease.generation, 2);
    assert.equal(afterC?.ownerGeneration, 2);
    // B resumes: its completion refuses, naming the lease as it is now, and writes nothing
    assert.match(String(refusal), /session win-C at generation 2/, `B refuses: ${String(refusal)}`);
    assert.deepEqual(current(), afterC, "the run keeps C's generation and nothing of B's");
    assert.equal(fx.leases.read(cardKey)?.owner.session, 'win-C', "the lease stays C's");
    assert.equal(fx.leases.read(cardKey)?.generation, 2);
    assert.equal(fx.events(goal.id).length, eventsAfterC, 'B journals nothing once it resumes');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-STORE-CAS R3 decision 1 F2: the paused takeover checks the whole acquisition, owner session, host, generation and release, before its run update', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-NEWER', 'T1-REUSED', 'T1-REMOTE', 'T1-LET-GO'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    const key = (id: string) => resourceKeys.card(fx.repo.key, id);
    const current = (id: string) => fx.store.getCardRun(goal.id, id)!;
    for (const id of ids) assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(id), fx.controller.ensureCardRun(fx.goal(goal.id), id)).directive.kind, 'prepare');
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const actorC = { session: 'win-C', pid: 3, processStart: T0, host: 'h' };
    const remoteB = { session: 'win-B', pid: 4, processStart: T0, host: 'elsewhere' };
    const as = <T>(who: typeof actorA, body: () => T): T => {
      setActorForTests(who);
      try {
        return body();
      } finally {
        setActorForTests(actorB);
      }
    };
    /** B pauses after acquiring generation 1; `meanwhile` changes the lease; B resumes and must refuse without a write. */
    const stale = (id: string, meanwhile: () => void, names: RegExp) => {
      let snapshot: { run: ReturnType<typeof current>; lease: ReturnType<typeof fx.leases.read>; events: number } | undefined;
      const refusal = pausedTakeover(fx, goal.id, id, () => {
        assert.equal(fx.leases.read(key(id))?.generation, 1);
        meanwhile();
        snapshot = { run: current(id), lease: fx.leases.read(key(id)), events: fx.events(goal.id).length };
      });
      assert.match(String(refusal), names, `${id}: B refuses naming the lease as it is: ${String(refusal)}`);
      assert.deepEqual({ run: current(id), lease: fx.leases.read(key(id)), events: fx.events(goal.id).length }, snapshot, `${id}: B writes nothing once it resumes`);
    };
    // the same session at a newer generation: C took the card at 2, then another window of B at 3
    stale('T1-NEWER', () => {
      fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
      assert.equal(as(actorC, () => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-NEWER'), current('T1-NEWER'))).lease.generation, 2);
      fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
      assert.equal(as(actorB, () => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-NEWER'), current('T1-NEWER'))).lease.generation, 3);
    }, /held by session win-B at generation 3/);
    assert.equal(current('T1-NEWER').ownerGeneration, 3, 'the run keeps the newer generation');
    // the same generation under another owner: B's other process let the card go, the record was purged, and C claimed it
    // twice (a purged lease restarts at generation 0), so the record is C's at generation 1
    const reclaim = (id: string, who: typeof actorA) => () => {
      fx.leases.release(key(id), 1, actorB);
      fx.leases.purgeReleased(key(id));
      assert.equal(fx.leases.claim(key(id), { actor: who, now: fx.now(), operation: `card:${id}` }).lease.generation, 0);
      fx.leases.release(key(id), 0, who);
      assert.equal(fx.leases.claim(key(id), { actor: who, now: fx.now(), operation: `card:${id}` }).lease.generation, 1);
    };
    stale('T1-REUSED', reclaim('T1-REUSED', actorC), /held by session win-C at generation 1/);
    // the same session id on another host at the same generation is another session
    stale('T1-REMOTE', reclaim('T1-REMOTE', remoteB), /held by session win-B at generation 1/);
    assert.equal(fx.leases.read(key('T1-REMOTE'))?.owner.host, 'elsewhere');
    // B's own acquisition, released by another process of B before the run update
    stale('T1-LET-GO', () => fx.leases.release(key('T1-LET-GO'), 1, actorB), /released at generation 1/);
    assert.equal(current('T1-LET-GO').ownerGeneration, 0, 'the run is not taken at a released generation');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

/** The outcome of `body`: its value, or the error it threw. */
function settle<T>(body: () => T): { value?: T; error?: unknown } {
  try {
    return { value: body() };
  } catch (error) {
    return { error };
  }
}

test('T1-STORE-CAS-2 acceptance 11: a completion of the same generation that lands between the takeover\'s first run read and its lease section makes the takeover refuse as already owned, journal nothing and write nothing', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-RACED', title: 'card T1-RACED' });
    const goal = goalForCards(fx, ['T1-RACED']);
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-RACED');
    const current = () => fx.store.getCardRun(goal.id, 'T1-RACED')!;
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-RACED'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-RACED')).directive.kind, 'prepare');
    // B took the lease at generation 1 and ended before its run update: two windows of B complete it at once
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    fx.leases.takeover(cardKey, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: actorB, now: fx.now(), operation: 'card:T1-RACED' });
    setActorForTests(actorB);
    const runFile = fx.store.cardFile(goal.id, 'T1-RACED');
    const caller = current();
    let reads = 0;
    let other: ReturnType<CardRunner['takeover']> | undefined;
    let afterOther: { run: ReturnType<typeof current>; events: number } | undefined;
    const outcome = settle(() =>
      throughFs(
        'readFileSync',
        (real, args) => {
          const out = real(...args);
          if (String(args[0]) === runFile && ++reads === 1) {
            other = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-RACED'), current());
            afterOther = { run: current(), events: fx.events(goal.id).length };
          }
          return out;
        },
        () => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-RACED'), caller),
      ),
    );
    assert.equal(other?.completed, true, 'the other window completed the takeover at the first run read');
    assert.equal(afterOther?.run.ownerGeneration, 1);
    assert.match(String(outcome.error), /this session owns card T1-RACED at generation 1/, `refused as already owned: ${String(outcome.error)}`);
    assert.deepEqual({ run: current(), events: fx.events(goal.id).length }, afterOther, 'nothing journaled, nothing written');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-STORE-CAS-2 acceptance 12: the takeover holds the lease lock until its run write lands: a release or another takeover at the paused rename refuses with locked and changes nothing, and a release before its lease section leaves the run unwritten', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-PAUSED', 'T1-EARLY'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    const key = (id: string) => resourceKeys.card(fx.repo.key, id);
    const current = (id: string) => fx.store.getCardRun(goal.id, id)!;
    const state = (id: string) => ({ run: current(id), lease: fx.leases.read(key(id)), events: fx.events(goal.id).length });
    for (const id of ids) assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(id), fx.controller.ensureCardRun(fx.goal(goal.id), id)).directive.kind, 'prepare');
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const quick = new LeaseStore(fx.paths.leases, { timeoutMs: 50 });
    const windowC = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: quick, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
    const actorC = { session: 'win-C', pid: 3, processStart: T0, host: 'h' };
    // B's run write is paused at the rename of the run record; meanwhile another process of B releases the lease and C,
    // once the lease has expired, takes the card over
    const runFile = fx.store.cardFile(goal.id, 'T1-PAUSED');
    let atRename: ReturnType<typeof state> | undefined;
    let afterAttempts: ReturnType<typeof state> | undefined;
    let release: { error?: unknown } = {};
    let byC: { error?: unknown } = {};
    setActorForTests(actorB);
    const taken = settle(() =>
      throughFs(
        'renameSync',
        (real, args) => {
          if (atRename === undefined && String(args[1]) === runFile) {
            atRename = state('T1-PAUSED');
            release = settle(() => quick.release(key('T1-PAUSED'), 1, actorB));
            fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
            setActorForTests(actorC);
            byC = settle(() => windowC.takeover(fx.goal(goal.id), fx.card('T1-PAUSED'), current('T1-PAUSED')));
            setActorForTests(actorB);
            afterAttempts = state('T1-PAUSED');
          }
          return real(...args);
        },
        () => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-PAUSED'), current('T1-PAUSED')),
      ),
    );
    assert.match(String(release.error), /locked/, `the release refuses while the run write is paused: ${String(release.error)}`);
    assert.match(String(byC.error), /locked/, `C's takeover refuses while the run write is paused: ${String(byC.error)}`);
    assert.deepEqual(afterAttempts, atRename, 'the refused release and takeover change nothing');
    assert.equal(taken.error, undefined, `B's takeover lands: ${String(taken.error)}`);
    assert.equal(current('T1-PAUSED').ownerGeneration, 1, 'the run carries the takeover generation');
    assert.equal(fx.leases.read(key('T1-PAUSED'))?.generation, 1, 'and so does the lease');
    assert.equal(fx.leases.read(key('T1-PAUSED'))?.owner.session, 'win-B');
    assert.equal(fx.leases.read(key('T1-PAUSED'))?.released, false);
    // A release that lands after B's lease write and before its run section takes the lease lock: the run stays unwritten
    const leaseLock = `${fx.leases.file(key('T1-EARLY'))}.lock`;
    const before = current('T1-EARLY');
    const early = settle(() => onLock(leaseLock, { before: (n) => { if (n === 2) fx.leases.release(key('T1-EARLY'), 1, actorB); } }, () => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-EARLY'), current('T1-EARLY'))));
    assert.match(String(early.error), /released at generation 1/, `refused: ${String(early.error)}`);
    assert.deepEqual(current('T1-EARLY'), before, 'the run is left unwritten');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === 'T1-EARLY' && e.data['leaseGeneration'] === 1).length, 0, 'no acquisition journaled');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-STORE-CAS-2: the owner\'s takeover of a run that already carries its generation refuses in its lease section, without waiting for a card-run lock another writer holds', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-OWNED', title: 'card T1-OWNED' });
    const goal = goalForCards(fx, ['T1-OWNED']);
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-OWNED'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-OWNED')).directive.kind, 'prepare');
    // Another writer of this session holds the card-run lock (a review commit in progress, say).
    const lock = `${fx.store.cardFile(goal.id, 'T1-OWNED')}.lock`;
    writeFileSync(lock, `pid=${process.pid} at=${fx.now()} nonce=committing`, 'utf8');
    const quick = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 50 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
    const outcome = settle(() => quick.takeover(fx.goal(goal.id), fx.card('T1-OWNED'), fx.store.getCardRun(goal.id, 'T1-OWNED')!));
    assert.match(String(outcome.error), /this session owns card T1-OWNED at generation 0/, `refused as owned, not locked: ${String(outcome.error)}`);
    unlinkSync(lock);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-STORE-CAS-2: the acquisition is journaled before the run write, so a run write that fails leaves it for the completion the command run again performs', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-TORN', title: 'card T1-TORN' });
    const goal = goalForCards(fx, ['T1-TORN']);
    const current = () => fx.store.getCardRun(goal.id, 'T1-TORN')!;
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-TORN'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-TORN')).directive.kind, 'prepare');
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    setActorForTests(actorB);
    const runFile = fx.store.cardFile(goal.id, 'T1-TORN');
    const acquisitions = () => fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === 'T1-TORN' && e.data['leaseGeneration'] === 1);
    let failed = false;
    const torn = settle(() =>
      throughFs(
        'renameSync',
        (real, args) => {
          if (!failed && String(args[1]) === runFile) {
            failed = true;
            throw Object.assign(new Error('EIO: simulated rename failure'), { code: 'EIO' });
          }
          return real(...args);
        },
        () => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-TORN'), current()),
      ),
    );
    assert.match(String(torn.error), /EIO/);
    assert.equal(current().ownerGeneration, 0, 'the run is not written');
    assert.equal(acquisitions().length, 1, 'the acquisition is journaled before the run write');
    const done = fx.runner().takeover(fx.goal(goal.id), fx.card('T1-TORN'), current());
    assert.equal(done.completed, true);
    assert.equal(done.run.ownerGeneration, 1);
    assert.equal(acquisitions().length, 1, 'the completion journals no second acquisition');
    assert.ok(fx.events(goal.id).some((e) => e.type === 'NOTE' && e.cardId === 'T1-TORN' && e.data['kind'] === 'card-takeover-completed'));
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-STORE-CAS-2 R3 decision 1 F2 F4: every run write of a takeover, the assessment saves included, lands with the lease lock held: at each paused rename a release and another takeover refuse with locked and change nothing', () => {
  const fx = makeFixture({ actor: actorA, config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const quick = new LeaseStore(fx.paths.leases, { timeoutMs: 50 });
    const windowC = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: quick, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
    const actorC = { session: 'win-C', pid: 3, processStart: T0, host: 'h' };
    let cards = 0;
    type Variant = 'stopped' | 'merged' | 'receipt';
    /**
     * A card A prepared and B read stopped for ownership; its lease has expired. `merged`: its merge is verified too, so the
     * assessment reconciles the stop to CLOSE; `receipt`: the pre-review block of its candidate exhausted the cycle and kept
     * the DoD receipt, which the assessment restores. Returns the goal id.
     */
    const stoppedCard = (id: string, variant: Variant): string => {
      cards += 1;
      writeCard(fx, { id, title: `card ${id}` });
      const goal = goalForCards(fx, [id]);
      setActorForTests(actorA);
      assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(id), fx.controller.ensureCardRun(fx.goal(goal.id), id)).directive.kind, 'prepare');
      setActorForTests(actorB);
      assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(id), fx.store.getCardRun(goal.id, id)!).run.stop?.reason, 'ownership');
      const run = fx.store.getCardRun(goal.id, id)!;
      if (variant === 'merged') fx.store.saveCardRun({ ...run, mergeVerified: true });
      if (variant === 'receipt') {
        const round = { round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'd-kept', requestedAt: fx.now(), durationMs: 0, outcome: 'block' as const, reasons: ['[spec] 6 tests @ src/x.ts:1: no RED -> add one'] };
        fx.store.saveCardRun({ ...run, candidate: { sha: 'sha-kept', dirty: false, untracked: [], digest: 'd-kept' }, dodReceipt: undefined, blockedReceipt: { dodReceipt: 'dod:kept', candidateDigest: 'd-kept', stage: 'pre', cycle: 0 }, preReview: { ...run.preReview, rounds: [round] } });
      }
      fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
      return goal.id;
    };
    /** B's takeover of `id` with `at(n, file)` run before the n-th rename of the run record. */
    const takeoverPausing = (goalId: string, id: string, at: (n: number) => void) => {
      const runFile = fx.store.cardFile(goalId, id);
      let n = 0;
      setActorForTests(actorB);
      try {
        return settle(() =>
          throughFs(
            'renameSync',
            (real, args) => {
              if (String(args[1]) === runFile) at((n += 1));
              return real(...args);
            },
            () => fx.runner().takeover(fx.goal(goalId), fx.card(id), fx.store.getCardRun(goalId, id)!),
          ),
        );
      } finally {
        setActorForTests(actorA);
      }
    };
    for (const variant of ['stopped', 'merged', 'receipt'] as const) {
      // How many times the takeover renames the run record: the run update, the assessment's saves and the final save.
      let renames = 0;
      const tag = variant[0]!.toUpperCase();
      const probeGoal = stoppedCard(`T1-PROBE-${tag}`, variant);
      assert.equal(takeoverPausing(probeGoal, `T1-PROBE-${tag}`, (n) => { renames = n; }).error, undefined);
      assert.ok(renames >= (variant === 'receipt' ? 4 : 3), `${variant}: the takeover renames the run record ${renames} times: the update, the assessment's saves and the final save`);
      if (variant === 'receipt') assert.equal(fx.store.getCardRun(probeGoal, `T1-PROBE-${tag}`)?.dodReceipt, 'dod:kept', 'the assessment restored the kept receipt');
      for (let at = 1; at <= renames; at += 1) {
        const id = `T1-AT-${tag}${at}`;
        const goalId = stoppedCard(id, variant);
        const key = resourceKeys.card(fx.repo.key, id);
        const state = () => ({ run: fx.store.getCardRun(goalId, id), lease: fx.leases.read(key), events: fx.events(goalId).length });
        let paused: ReturnType<typeof state> | undefined;
        let after: ReturnType<typeof state> | undefined;
        let release: { error?: unknown } = {};
        let byC: { error?: unknown } = {};
        const taken = takeoverPausing(goalId, id, (n) => {
          if (n !== at) return;
          paused = state();
          release = settle(() => quick.release(key, 1, actorB));
          fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
          setActorForTests(actorC);
          byC = settle(() => windowC.takeover(fx.goal(goalId), fx.card(id), fx.store.getCardRun(goalId, id)!));
          setActorForTests(actorB);
          after = state();
        });
        const where = `${variant} run, rename ${at} of ${renames}`;
        assert.ok(paused, `${where}: the rename was reached`);
        assert.match(String(release.error), /locked/, `${where}: the release refuses while the run write is paused: ${String(release.error)}`);
        assert.match(String(byC.error), /locked/, `${where}: C's takeover refuses while the run write is paused: ${String(byC.error)}`);
        assert.deepEqual(after, paused, `${where}: the refused release and takeover change nothing`);
        assert.equal(taken.error, undefined, `${where}: B's takeover lands: ${String(taken.error)}`);
        assert.equal(fx.store.getCardRun(goalId, id)?.ownerGeneration, 1, `${where}: the run carries the takeover generation`);
        assert.equal(fx.leases.read(key)?.generation, 1, `${where}: and so does the lease`);
        assert.equal(fx.leases.read(key)?.owner.session, 'win-B');
        assert.equal(fx.leases.read(key)?.released, false);
      }
    }
    assert.ok(cards >= 13, `${cards} cards exercised`);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-STORE-CAS-2 R3 decision 1 F2: a release that lands between the run update and the assessment makes the takeover refuse at its next run write, which leaves the run as the update wrote it', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: 'T1-BETWEEN', title: 'card T1-BETWEEN' });
    const goal = goalForCards(fx, ['T1-BETWEEN']);
    const key = resourceKeys.card(fx.repo.key, 'T1-BETWEEN');
    const current = () => fx.store.getCardRun(goal.id, 'T1-BETWEEN')!;
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-BETWEEN'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-BETWEEN')).directive.kind, 'prepare');
    setActorForTests(actorB);
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card('T1-BETWEEN'), current()).run.stop?.reason, 'ownership');
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    // The run update's section ends when its card-run lock is removed; another process of B releases the lease right then.
    const runLock = `${fx.store.cardFile(goal.id, 'T1-BETWEEN')}.lock`;
    let updated: ReturnType<typeof current> | undefined;
    const outcome = settle(() =>
      throughFs(
        'unlinkSync',
        (real, args) => {
          const out = real(...args);
          if (updated === undefined && String(args[0]) === runLock) {
            updated = current();
            fx.leases.release(key, 1, actorB);
          }
          return out;
        },
        () => fx.runner().takeover(fx.goal(goal.id), fx.card('T1-BETWEEN'), current()),
      ),
    );
    assert.equal(updated?.ownerGeneration, 1, 'the run update landed before the release');
    assert.match(String(outcome.error), /changed hands after this takeover acquired generation 1: the lease is released at generation 1/, `refused: ${String(outcome.error)}`);
    assert.deepEqual(current(), updated, 'no later run write of the takeover lands');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-TAKEOVER-LOCKED-HINT (issue 87 item 3): a takeover refused with LOCKED after its lease write names the generation it took and the command that goes on: the takeover again at the run update, card next at a save of the assessment [R1] [R2]', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    const ids = ['T1-RUNLOCK', 'T1-SAVELOCK'];
    for (const id of ids) writeCard(fx, { id, title: `card ${id}` });
    const goal = goalForCards(fx, ids);
    const key = (id: string) => resourceKeys.card(fx.repo.key, id);
    const current = (id: string) => fx.store.getCardRun(goal.id, id)!;
    const acquired = (id: string) => fx.events(goal.id).filter((e) => e.type === 'LEASE_ACQUIRED' && e.cardId === id && e.data['leaseGeneration'] === 1);
    for (const id of ids) assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(id), fx.controller.ensureCardRun(fx.goal(goal.id), id)).directive.kind, 'prepare');
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const windowB = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }), queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
    const lockOf = (id: string) => `${fx.leases.file(key(id))}.lock`;
    // Another live writer holds the lease lock when the takeover creates it for the n-th time: the lease section (1), the
    // run update (2), then the first save of the assessment (3).
    const heldAt = (id: string, n: number) => {
      const outcome = settle(() => onLock(lockOf(id), { before: (at) => { if (at === n) writeFileSync(lockOf(id), `pid=${process.pid} at=${fx.now()} nonce=other`, 'utf8'); } }, () => windowB.takeover(fx.goal(goal.id), fx.card(id), current(id))));
      unlinkSync(lockOf(id));
      return outcome.error;
    };
    setActorForTests(actorB);
    // R1: the run update is refused; the lease carries the new generation, the run does not
    const atRun = heldAt('T1-RUNLOCK', 2);
    assert.ok(atRun instanceof StoreError, `a StoreError: ${String(atRun)}`);
    assert.equal(atRun.code, 'LOCKED');
    assert.ok(atRun.message.includes('the takeover of card T1-RUNLOCK took lease generation 1, but its run update was refused (LOCKED: locked by another writer'), atRun.message);
    assert.ok(atRun.message.includes(`; run \`aidlc card takeover T1-RUNLOCK --goal ${goal.id}\` again to complete it`), atRun.message);
    assert.equal(fx.leases.read(key('T1-RUNLOCK'))?.generation, 1, 'the lease carries the new generation');
    assert.equal(fx.leases.read(key('T1-RUNLOCK'))?.owner.session, 'win-B');
    assert.equal(current('T1-RUNLOCK').ownerGeneration, 0, 'the run does not');
    assert.equal(acquired('T1-RUNLOCK').length, 0, 'no acquisition journaled');
    // the command it names completes the takeover
    const again = windowB.takeover(fx.goal(goal.id), fx.card('T1-RUNLOCK'), current('T1-RUNLOCK'));
    assert.equal(again.completed, true);
    assert.equal(current('T1-RUNLOCK').ownerGeneration, 1, 'the run carries the generation');
    assert.equal(acquired('T1-RUNLOCK').length, 1, 'one acquisition for it');
    // R2: the first save of the assessment is refused after the run update landed
    const atSave = heldAt('T1-SAVELOCK', 3);
    assert.ok(atSave instanceof StoreError, `a StoreError: ${String(atSave)}`);
    assert.equal(atSave.code, 'LOCKED');
    assert.ok(atSave.message.includes('the takeover of card T1-SAVELOCK is done and the run carries lease generation 1, but a save of its assessment was refused (LOCKED: locked by another writer'), atSave.message);
    assert.ok(atSave.message.includes(`; run \`aidlc card next T1-SAVELOCK --goal ${goal.id}\` to go on`), atSave.message);
    assert.equal(current('T1-SAVELOCK').ownerGeneration, 1, 'the run carries the generation');
    assert.equal(fx.leases.read(key('T1-SAVELOCK'))?.generation, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-TAKEOVER-LOCKED-HINT: docs/OPERATIONS.md and the CHANGELOG Unreleased section state the refusal after the lease write [R3]', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
  const ops = read('docs/OPERATIONS.md');
  const sessions = ops.slice(ops.indexOf('\n## Sessions\n'), ops.indexOf('\n## ', ops.indexOf('\n## Sessions\n') + 1));
  assert.ok(sessions.includes('A takeover refused with `LOCKED` after its lease write names the generation it took and the next command.'), 'the Sessions section states it');
  const changelog = read('CHANGELOG.md');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  assert.ok(unreleased.includes("- Takeover refusal after the lease write, card T0-TAKEOVER-LOCKED-HINT (issue 87 item 3): a card takeover refused with `LOCKED` after its lease write names the card, the lease generation it took and the refusal, and the command that goes on from there: `aidlc card takeover <card> --goal <goal>` again while the run does not carry that generation, `aidlc card next <card> --goal <goal>` once it does; the error keeps the `LOCKED` code."), 'the CHANGELOG states it');
});
