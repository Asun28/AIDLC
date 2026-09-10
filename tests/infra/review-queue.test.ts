import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ReviewQueue, type EnqueueInput } from '../../src/coordination/review-queue.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actor, cleanup, iso, tmpDir } from './helpers.ts';

function input(overrides: Partial<EnqueueInput> = {}): EnqueueInput {
  return {
    pool: 'codex:acct',
    repository: 'Asun28/repo',
    candidateDigest: 'digest-1',
    base: 'main',
    policyVersion: 'rubric-v17',
    reviewer: 'gpt-5.6-sol',
    requester: 'goal-1/T1-A',
    deadline: iso(60 * 60 * 1000),
    now: iso(0),
    ...overrides,
  };
}

describe('coordination/review-queue (Q24 shared provider admission)', () => {
  const dir = tmpDir();
  const A = actor('window-a');
  const B = actor('window-b');
  setActorForTests(A);
  after(() => {
    cleanup(dir);
    setActorForTests(undefined);
  });

  it('Q24: two windows requesting the same review produce one provider request', () => {
    const q = new ReviewQueue(path.join(dir, 'q1'));
    const first = q.enqueue(input({ requester: 'goal-1/T1-A' }));
    const second = q.enqueue(input({ requester: 'goal-2/T1-A', now: iso(10) }));
    assert.equal(first.status, 'enqueued');
    assert.equal(second.status, 'joined');
    assert.equal(second.request.key, first.request.key);
    assert.deepEqual(second.request.requesters, ['goal-1/T1-A', 'goal-2/T1-A']);
    assert.equal(q.list('codex:acct').length, 1);
    // the same requester again also joins, without duplicating itself
    const third = q.enqueue(input({ requester: 'goal-1/T1-A' }));
    assert.equal(third.status, 'joined');
    assert.equal(third.request.requesters.length, 2);
    // key differs on candidate/base/policy/reviewer, and is case-insensitive
    assert.equal(q.enqueue(input({ candidateDigest: 'digest-2' })).status, 'enqueued');
    assert.equal(q.enqueue(input({ base: 'MAIN' })).status, 'joined');
    assert.equal(q.list('codex:acct').length, 2);
  });

  it('Q24: a different request queues at capacity and is admitted in persisted order', () => {
    const q = new ReviewQueue(path.join(dir, 'q2'));
    const r1 = q.enqueue(input({ candidateDigest: 'c1', now: iso(0) })).request;
    const r2 = q.enqueue(input({ candidateDigest: 'c2', now: iso(1) })).request;
    const r3 = q.enqueue(input({ candidateDigest: 'c3', now: iso(2) })).request;
    assert.deepEqual([r1.seq, r2.seq, r3.seq], [0, 1, 2]);
    const a1 = q.admit('codex:acct', A, iso(10));
    assert.equal(a1.status, 'admitted');
    if (a1.status === 'admitted') {
      assert.equal(a1.request.key, r1.key);
      assert.equal(a1.request.state, 'running');
      assert.equal(a1.request.attempts, 1);
      assert.deepEqual(a1.request.slotOwner, A);
    }
    const busy = q.admit('codex:acct', B, iso(11));
    assert.deepEqual(busy, { status: 'busy', active: [r1.key] });
    assert.deepEqual(q.pool('codex:acct').active, [r1.key]);
    // completion releases the slot; the next request in seq order is admitted, not a later one
    q.complete(r1.key, 'verdict:c1', iso(20));
    assert.equal(q.get(r1.key)?.state, 'completed');
    assert.equal(q.get(r1.key)?.verdictRef, 'verdict:c1');
    assert.deepEqual(q.pool('codex:acct').active, []);
    const a2 = q.admit('codex:acct', B, iso(21));
    assert.equal(a2.status, 'admitted');
    if (a2.status === 'admitted') assert.equal(a2.request.key, r2.key);
    q.complete(r2.key, 'verdict:c2', iso(30));
    const a3 = q.admit('codex:acct', A, iso(31));
    assert.equal(a3.status, 'admitted');
    if (a3.status === 'admitted') assert.equal(a3.request.key, r3.key);
    q.complete(r3.key, 'verdict:c3', iso(40));
    assert.deepEqual(q.admit('codex:acct', A, iso(41)), { status: 'empty' });
    // a completed key re-enqueued reports completed (verdict reuse is the caller's freshness decision)
    assert.equal(q.enqueue(input({ candidateDigest: 'c1', now: iso(50) })).status, 'completed');
  });

  it('a request whose deadline passed before admission is cancelled, not run', () => {
    const q = new ReviewQueue(path.join(dir, 'q3'));
    const late = q.enqueue(input({ candidateDigest: 'late', deadline: iso(100), now: iso(0) })).request;
    const ok = q.enqueue(input({ candidateDigest: 'ok', deadline: iso(10_000), now: iso(1) })).request;
    const a = q.admit('codex:acct', A, iso(200));
    assert.equal(q.get(late.key)?.state, 'cancelled');
    assert.match(q.get(late.key)?.lastError ?? '', /deadline passed/);
    assert.equal(a.status, 'admitted');
    if (a.status === 'admitted') assert.equal(a.request.key, ok.key);
  });

  it('Q24 / MS4: a confirmed quota hold queues with retry-after, holds no slot, registers one notification owner', () => {
    const q = new ReviewQueue(path.join(dir, 'q4'));
    const r = q.enqueue(input({ candidateDigest: 'q', now: iso(0) })).request;
    const admitted = q.admit('codex:acct', A, iso(1));
    assert.equal(admitted.status, 'admitted');
    const held = q.hold(r.key, iso(60_000), 'HTTP 429 retry-after 60', iso(2));
    assert.equal(held.state, 'retry-after');
    assert.equal(held.retryAfter, iso(60_000));
    assert.equal(held.slotOwner, undefined);
    assert.match(held.lastError ?? '', /quota\/admission hold: HTTP 429/);
    const pool = q.pool('codex:acct');
    assert.deepEqual(pool.active, []);
    assert.equal(pool.resetAt, iso(60_000));
    assert.deepEqual(pool.notificationOwner, A);
    assert.deepEqual(q.notificationOwner('codex:acct'), A);
    // before reset: nobody polls; admission reports the reset time
    assert.deepEqual(q.admit('codex:acct', B, iso(30_000)), { status: 'reset-pending', resetAt: iso(60_000) });
    // a second hold with an earlier retry-after keeps the later reset and the same owner
    setActorForTests(B);
    const r2 = q.enqueue(input({ candidateDigest: 'q2', now: iso(3) })).request;
    q.hold(r2.key, iso(30_000), 'rate limit', iso(4));
    assert.equal(q.pool('codex:acct').resetAt, iso(60_000));
    assert.deepEqual(q.pool('codex:acct').notificationOwner, A);
    setActorForTests(A);
    // after reset: the held request is admitted in order and counts a new attempt
    const again = q.admit('codex:acct', A, iso(61_000));
    assert.equal(again.status, 'admitted');
    if (again.status === 'admitted') {
      assert.equal(again.request.key, r.key);
      assert.equal(again.request.attempts, 2);
    }
  });

  it('a lost response keeps the slot occupied until it is looked up and resolved', () => {
    const q = new ReviewQueue(path.join(dir, 'q5'));
    const r = q.enqueue(input({ candidateDigest: 'lost', now: iso(0) })).request;
    const other = q.enqueue(input({ candidateDigest: 'other', now: iso(1) })).request;
    assert.equal(q.admit('codex:acct', A, iso(2)).status, 'admitted');
    const lost = q.markLost(r.key, 'reviewer process exited without output', iso(3));
    assert.equal(lost.state, 'lost');
    // still occupying the slot: another review must not launch
    assert.deepEqual(q.admit('codex:acct', B, iso(4)), { status: 'busy', active: [r.key] });
    assert.throws(() => q.resolveLost(other.key, { found: false }), /is not lost/);
    // lookup found nothing: requeued in order, slot released
    const requeued = q.resolveLost(r.key, { found: false }, iso(5));
    assert.equal(requeued.state, 'queued');
    assert.equal(requeued.slotOwner, undefined);
    assert.deepEqual(q.pool('codex:acct').active, []);
    const next = q.admit('codex:acct', B, iso(6));
    assert.equal(next.status, 'admitted');
    if (next.status === 'admitted') assert.equal(next.request.key, r.key); // seq 0 still first
    // lookup found a verdict: completed directly
    q.markLost(r.key, 'lost again', iso(7));
    const done = q.resolveLost(r.key, { found: true, verdictRef: 'verdict:lost' }, iso(8));
    assert.equal(done.state, 'completed');
    assert.equal(done.verdictRef, 'verdict:lost');
    assert.deepEqual(q.pool('codex:acct').active, []);
  });

  it('cancel releases the slot; unknown keys are tolerated', () => {
    const q = new ReviewQueue(path.join(dir, 'q6'));
    const r = q.enqueue(input({ candidateDigest: 'cancel', now: iso(0) })).request;
    q.admit('codex:acct', A, iso(1));
    const c = q.cancel(r.key, 'goal stopped', iso(2));
    assert.equal(c?.state, 'cancelled');
    assert.equal(c?.lastError, 'goal stopped');
    assert.deepEqual(q.pool('codex:acct').active, []);
    assert.equal(q.cancel('nope', 'x'), undefined);
    assert.throws(() => q.complete('nope', 'v'), /unknown review request/);
  });

  it('raising the pool limit above one requires evidence', () => {
    const q = new ReviewQueue(path.join(dir, 'q7'));
    assert.throws(() => q.setPoolLimit('codex:acct', 2, '   '), /requires provider\/project evidence/);
    assert.equal(q.setPoolLimit('codex:acct', 1, '').maxConcurrent, 1);
    const raised = q.setPoolLimit('codex:acct', 2, 'provider dashboard shows 2 concurrent seats');
    assert.equal(raised.maxConcurrent, 2);
    q.enqueue(input({ candidateDigest: 'p1', now: iso(0) }));
    q.enqueue(input({ candidateDigest: 'p2', now: iso(1) }));
    q.enqueue(input({ candidateDigest: 'p3', now: iso(2) }));
    assert.equal(q.admit('codex:acct', A, iso(3)).status, 'admitted');
    assert.equal(q.admit('codex:acct', B, iso(4)).status, 'admitted');
    assert.equal(q.admit('codex:acct', A, iso(5)).status, 'busy');
  });
});
