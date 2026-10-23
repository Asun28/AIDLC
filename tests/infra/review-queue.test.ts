import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
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
    const lost = q.markLost(r.key, 'reviewer process exited without output');
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
    q.markLost(r.key, 'lost again');
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
  it('T0-SHIP-QUOTA-RESET (issue 54): heldUntil names the later of a hold and the reset the pool already keeps; an equal, earlier or absent reset leaves the hold', () => {
    const q = new ReviewQueue(path.join(dir, 'held-until'));
    const hold = iso(15 * 60_000);
    assert.equal(q.heldUntil('codex:none', hold, iso(0)), hold, 'a pool with no reset: the hold');
    const other = q.enqueue(input({ pool: 'codex:later', candidateDigest: 'later', now: iso(0) })).request;
    q.hold(other.key, iso(20 * 60_000 + 500), 'another request held the pool longer', iso(1));
    assert.equal(q.heldUntil('codex:later', hold, iso(2)), iso(20 * 60_000 + 500), 'a later reset: the reset');
    const same = q.enqueue(input({ pool: 'codex:same', candidateDigest: 'same', now: iso(0) })).request;
    q.hold(same.key, hold, 'the same time', iso(1));
    assert.equal(q.heldUntil('codex:same', hold, iso(2)), hold, 'an equal reset: the hold');
    const earlier = q.enqueue(input({ pool: 'codex:earlier', candidateDigest: 'earlier', now: iso(0) })).request;
    q.hold(earlier.key, iso(5 * 60_000), 'a shorter hold', iso(1));
    assert.equal(q.heldUntil('codex:earlier', hold, iso(2)), hold, 'an earlier reset: the hold');
  });

  // Card T0-REVIEW-ADMIT-FOREIGN: with a request key, admit admits only that request, and only while fewer eligible
  // requests stand ahead of it than the pool has free slots; otherwise `behind` names the first request ahead.
  const Y = 'goal-1/T1-Y';
  const Z = 'goal-1/T1-Z';
  const snapshot = (q: ReviewQueue) => ({ requests: q.list('codex:acct'), pool: q.pool('codex:acct') });
  const queueYZ = (q: ReviewQueue) => ({
    y: q.enqueue(input({ candidateDigest: 'y', requester: Y, now: iso(10) })).request,
    z: q.enqueue(input({ candidateDigest: 'z', requester: Z, now: iso(11) })).request,
  });

  it('T0-REVIEW-ADMIT-FOREIGN acceptance 1: in a one-slot pool Z behind Y gets behind naming Y and changes nothing; Y is then admitted [R1]', () => {
    const q = new ReviewQueue(path.join(dir, 'foreign-one'));
    const { y, z } = queueYZ(q);
    const before = snapshot(q);
    assert.deepEqual(q.admit('codex:acct', B, iso(20), z.key), { status: 'behind', ahead: { key: y.key, requesters: [Y] } });
    assert.deepEqual(snapshot(q), before, 'both requests and the pool are as they were');
    const admitted = q.admit('codex:acct', A, iso(21), y.key);
    assert.deepEqual(admitted, { status: 'admitted', request: { ...y, state: 'running', startedAt: iso(21), slotOwner: A, attempts: 1 } });
    assert.deepEqual(q.pool('codex:acct').active, [y.key]);
    assert.equal(q.get(z.key)?.state, 'queued');
  });

  it('T0-REVIEW-ADMIT-FOREIGN acceptance 1: in a two-slot pool with one slot taken Z is behind Y; with both slots free Z is admitted and Y stays queued [R1]', () => {
    const taken = new ReviewQueue(path.join(dir, 'foreign-two-taken'));
    taken.setPoolLimit('codex:acct', 2, 'two seats');
    const x = taken.enqueue(input({ candidateDigest: 'x', requester: 'goal-2/T1-X', now: iso(1) })).request;
    assert.equal(taken.admit('codex:acct', A, iso(2), x.key).status, 'admitted');
    const one = queueYZ(taken);
    const before = snapshot(taken);
    assert.deepEqual(taken.admit('codex:acct', B, iso(20), one.z.key), { status: 'behind', ahead: { key: one.y.key, requesters: [Y] } });
    assert.deepEqual(snapshot(taken), before);

    const free = new ReviewQueue(path.join(dir, 'foreign-two-free'));
    free.setPoolLimit('codex:acct', 2, 'two seats');
    const two = queueYZ(free);
    const admitted = free.admit('codex:acct', B, iso(20), two.z.key);
    assert.equal(admitted.status, 'admitted');
    if (admitted.status === 'admitted') assert.equal(admitted.request.key, two.z.key);
    assert.deepEqual(free.get(two.y.key), two.y, 'Y stays queued, unchanged');
    assert.deepEqual(free.pool('codex:acct').active, [two.z.key]);

    // two free slots and two requests ahead: behind, naming the first of them
    const full = new ReviewQueue(path.join(dir, 'foreign-two-ahead'));
    full.setPoolLimit('codex:acct', 2, 'two seats');
    const w = full.enqueue(input({ candidateDigest: 'w', requester: 'goal-2/T1-W', now: iso(9) })).request;
    const three = queueYZ(full);
    const unchanged = snapshot(full);
    assert.deepEqual(full.admit('codex:acct', B, iso(20), three.z.key), { status: 'behind', ahead: { key: w.key, requesters: ['goal-2/T1-W'] } });
    assert.deepEqual(snapshot(full), unchanged);
  });

  it('T0-REVIEW-ADMIT-FOREIGN acceptance 1: a queued head past its deadline is cancelled and the caller admitted [R1]', () => {
    const q = new ReviewQueue(path.join(dir, 'foreign-deadline'));
    const y = q.enqueue(input({ candidateDigest: 'y', requester: Y, deadline: iso(100), now: iso(10) })).request;
    const z = q.enqueue(input({ candidateDigest: 'z', requester: Z, deadline: iso(10_000), now: iso(11) })).request;
    const admitted = q.admit('codex:acct', B, iso(200), z.key);
    assert.equal(admitted.status, 'admitted');
    if (admitted.status === 'admitted') assert.equal(admitted.request.key, z.key);
    assert.equal(q.get(y.key)?.state, 'cancelled');
    assert.equal(q.get(y.key)?.lastError, 'deadline passed before admission');
  });

  it('T0-REVIEW-ADMIT-FOREIGN acceptance 1: a retry-after head not yet due is passed over and the caller admitted [R1]', () => {
    const q = new ReviewQueue(path.join(dir, 'foreign-retry'));
    const { y, z } = queueYZ(q);
    assert.equal(q.admit('codex:acct', A, iso(12), y.key).status, 'admitted');
    q.hold(y.key, iso(60_000), 'HTTP 429', iso(13));
    q.savePool({ ...q.pool('codex:acct'), resetAt: undefined });
    const held = q.get(y.key);
    const admitted = q.admit('codex:acct', B, iso(20), z.key);
    assert.equal(admitted.status, 'admitted');
    if (admitted.status === 'admitted') assert.equal(admitted.request.key, z.key);
    assert.deepEqual(q.get(y.key), held, 'the held head is unchanged');
  });

  // R3 decision 1 F1: a keyed call that answers `behind` writes nothing the keyless call at the same moment does not write
  // on its way to the request it admits. Requests named X are past their deadline; Z is the caller.
  const files = (d: string): Map<string, string> => new Map(readdirSync(d).filter((f) => f.endsWith('.json')).map((f) => [f, readFileSync(path.join(d, f), 'utf8')]));
  const build = (d: string, slots: number, order: string[], stale: boolean): ReviewQueue => {
    const q = new ReviewQueue(d);
    if (slots > 1) q.setPoolLimit('codex:acct', slots, 'two seats');
    if (stale) {
      const s = q.enqueue(input({ candidateDigest: 'stale', requester: 'goal-3/T1-S', now: iso(1) })).request;
      q.admit('codex:acct', A, iso(2));
      q.complete(s.key, 'verdict:stale', iso(3));
      q.savePool({ ...q.pool('codex:acct'), active: [s.key], updatedAt: iso(4) });
    }
    order.forEach((name, i) => q.enqueue(input({ candidateDigest: name, requester: `goal-1/T1-${name}`, deadline: name.startsWith('X') ? iso(100) : iso(10_000), now: iso(10 + i) })));
    return q;
  };
  const keyOf = (q: ReviewQueue, name: string): string => q.list('codex:acct').find((r) => r.candidateDigest === name)!.key;
  for (const [name, slots, order, stale] of [
    ['an expired request before the first eligible one', 2, ['X1', 'Y', 'W', 'Z'], false],
    ['an expired request between the first eligible one and the caller (the F1 order)', 2, ['Y', 'X1', 'W', 'Z'], false],
    ['an expired request after the caller', 2, ['Y', 'W', 'Z', 'X1'], false],
    ['several expired requests before, between and after', 2, ['X1', 'Y', 'X2', 'W', 'X3', 'Z', 'X4'], false],
    ['a one-slot pool with an expired request between', 1, ['Y', 'X1', 'Z'], false],
    ['a stale active slot and an expired request between', 2, ['Y', 'X1', 'W', 'Z'], true],
  ] as Array<[string, number, string[], boolean]>) {
    it(`T0-REVIEW-ADMIT-FOREIGN R3 decision 1 F1: behind leaves the queue as the keyless call leaves it apart from its admission, ${name} [R1]`, () => {
      const base = path.join(dir, `f1-${order.join('')}-${slots}-${stale}`);
      const pre = build(path.join(base, 'pre'), slots, order, stale);
      const keyless = build(path.join(base, 'keyless'), slots, order, stale);
      const keyed = build(path.join(base, 'keyed'), slots, order, stale);
      const before = files(pre.dir);
      const admitted = keyless.admit('codex:acct', A, iso(200));
      assert.equal(admitted.status, 'admitted');
      const admittedKey = admitted.status === 'admitted' ? admitted.request.key : '';
      const first = order.find((n) => !n.startsWith('X'))!;
      assert.equal(admittedKey, keyOf(pre, first));
      assert.deepEqual(keyed.admit('codex:acct', A, iso(200), keyOf(pre, 'Z')), { status: 'behind', ahead: { key: keyOf(pre, first), requesters: [`goal-1/T1-${first}`] } });
      // Every request file is byte-identical to the keyless call's, the request it admitted restored to its state before the call.
      const poolFile = [...before.keys()].find((f) => f.startsWith('_pool-'))!;
      const requestsOnly = (m: Map<string, string>) => new Map([...m].filter(([f]) => f !== poolFile));
      const expected = new Map([...requestsOnly(files(keyless.dir))].map(([f, text]): [string, string] => [f, JSON.parse(text).key === admittedKey ? before.get(f)! : text]));
      const after = files(keyed.dir);
      assert.deepEqual(requestsOnly(after), expected);
      // The pool file is not written on `behind`, a stale slot included; the next admitting call cleans that slot.
      assert.equal(after.get(poolFile), before.get(poolFile), 'the pool file is byte-identical to the file before the call');
      if (stale) {
        const next = keyed.admit('codex:acct', A, iso(201), keyOf(pre, first));
        assert.equal(next.status === 'admitted' && next.request.key, keyOf(pre, first));
        assert.deepEqual(keyed.pool('codex:acct').active, [keyOf(pre, first)], 'the stale slot is gone after the next admission');
      }
    });
  }

  it('T0-REVIEW-ADMIT-FOREIGN: a stale active slot does not count against the free slots of a keyed call [R1]', () => {
    const q = build(path.join(dir, 'stale-free'), 2, ['Y', 'Z'], true);
    const admitted = q.admit('codex:acct', A, iso(200), keyOf(q, 'Z'));
    assert.equal(admitted.status === 'admitted' && admitted.request.key, keyOf(q, 'Z'));
    assert.deepEqual(q.pool('codex:acct').active, [keyOf(q, 'Z')]);
    assert.equal(q.get(keyOf(q, 'Y'))?.state, 'queued');
  });

  it('T0-REVIEW-ADMIT-FOREIGN R3 decision 1 F1: an expired request met behind an eligible one is cancelled when the caller is admitted [R1]', () => {
    const q = build(path.join(dir, 'f1-admitted'), 2, ['Y', 'X1', 'Z'], false);
    const admitted = q.admit('codex:acct', A, iso(200), keyOf(q, 'Z'));
    assert.equal(admitted.status === 'admitted' && admitted.request.key, keyOf(q, 'Z'));
    const x = q.get(keyOf(q, 'X1'))!;
    assert.deepEqual([x.state, x.finishedAt, x.lastError], ['cancelled', iso(200), 'deadline passed before admission']);
    assert.equal(q.get(keyOf(q, 'Y'))?.state, 'queued');
  });

  it('T0-REVIEW-ADMIT-FOREIGN acceptance 2: without a key admit still admits Y for the caller of Z, as in the reproduction of the diagnosis [R2]', () => {
    const q = new ReviewQueue(path.join(dir, 'foreign-keyless'));
    const x = q.enqueue(input({ candidateDigest: 'x', requester: 'goal-1/T1-X', now: iso(0) })).request;
    const first = q.admit('codex:acct', A, iso(1));
    assert.equal(first.status === 'admitted' && first.request.key, x.key);
    const y = q.enqueue(input({ candidateDigest: 'y', requester: Y, now: iso(2) })).request;
    assert.equal(q.admit('codex:acct', A, iso(3)).status, 'busy');
    q.enqueue(input({ candidateDigest: 'z', requester: Z, now: iso(4) }));
    q.complete(x.key, 'verdict:x', iso(5));
    const zCall = q.admit('codex:acct', B, iso(6));
    assert.equal(zCall.status === 'admitted' && zCall.request.key, y.key, "Z's keyless call admits Y");
    const again = q.enqueue(input({ candidateDigest: 'y', requester: Y, now: iso(7) }));
    assert.equal(again.status, 'joined');
    assert.equal(again.request.state, 'running');
    assert.deepEqual(q.pool('codex:acct').active, [y.key]);
  });
});
