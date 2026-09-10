import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, actorA, actorB, T0 } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { DEFAULT_LEASE_TTL_MS, FencedError, resourceKeys } from '../../src/coordination/lease.ts';
import { MINUTE_MS, addMs } from '../../src/core/types.ts';

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
