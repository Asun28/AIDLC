import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_LEASE_TTL_MS, FencedError, LeaseStore, resourceKeys } from '../../src/coordination/lease.ts';
import { actor, cleanup, iso, tmpDir } from './helpers.ts';

describe('coordination/lease (Q23 shared ownership, generations, fencing)', () => {
  const dir = tmpDir();
  const store = new LeaseStore(path.join(dir, 'leases'));
  const A = actor('window-a', 100);
  const B = actor('window-b', 200);
  const t0 = iso(0);
  after(() => cleanup(dir));

  it('Q23: two windows claiming one card produce exactly one writer', () => {
    const key = resourceKeys.card('repo1', 'T1-FOO');
    const a = store.claim(key, { actor: A, now: t0, operation: 'ship' });
    const b = store.claim(key, { actor: B, now: t0 });
    assert.equal(a.status, 'acquired');
    assert.equal(b.status, 'held');
    if (a.status !== 'acquired' || b.status !== 'held') return;
    assert.equal(a.lease.generation, 0);
    assert.equal(a.lease.operation, 'ship');
    assert.deepEqual(b.lease.owner, A);
    assert.equal(b.expired, false);
    assert.equal(a.lease.expiresAt, iso(DEFAULT_LEASE_TTL_MS));
    // the same owner renews rather than re-acquires
    const again = store.claim(key, { actor: A, now: iso(1000), operation: 'review' });
    assert.equal(again.status, 'renewed');
    if (again.status === 'renewed') {
      assert.equal(again.lease.generation, 0);
      assert.equal(again.lease.operation, 'review');
      assert.equal(again.lease.heartbeatAt, iso(1000));
    }
    assert.equal(store.isCurrent(key, 0), true);
    assert.equal(store.isCurrent(key, 1), false);
  });

  it('Q23: an expired lease is reported as expired, never silently taken', () => {
    const key = resourceKeys.card('repo1', 'T1-EXPIRED');
    store.claim(key, { actor: A, now: t0, ttlMs: 1000 });
    const late = store.claim(key, { actor: B, now: iso(5000) });
    assert.equal(late.status, 'expired');
    if (late.status === 'expired') {
      assert.equal(late.expired, true);
      assert.deepEqual(late.lease.owner, A);
    }
    // still owned by A on disk; B has not become the writer
    assert.deepEqual(store.read(key)?.owner, A);
  });

  it('Q23: takeover is refused until the old owner effects are reconciled', () => {
    const key = resourceKeys.card('repo1', 'T1-TAKEOVER');
    store.claim(key, { actor: A, now: t0, ttlMs: 1000 });
    // live lease: takeover refused regardless of reconciliation
    assert.throws(() => store.takeover(key, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: B, now: iso(500) }), /still held by window-a/);
    // expired but unreconciled: refused with the unresolved operation ids
    assert.throws(
      () => store.takeover(key, () => ({ reconciled: false, unresolvedOperations: ['op-1'] }), { actor: B, now: iso(5000) }),
      /takeover refused: old owner effects not reconciled \(op-1\)/,
    );
    assert.equal(store.read(key)?.generation, 0);
    assert.deepEqual(store.read(key)?.owner, A);
  });

  it('Q23: takeover advances the generation and fences the stale writer', () => {
    const key = resourceKeys.card('repo1', 'T1-FENCE');
    store.claim(key, { actor: A, now: t0, ttlMs: 1000 });
    let reconciledLease: string | undefined;
    const { lease, report } = store.takeover(
      key,
      (old) => {
        reconciledLease = old.owner.session;
        return { reconciled: true, unresolvedOperations: [], note: 'old ship finished' };
      },
      { actor: B, now: iso(5000), operation: 'resume' },
    );
    assert.equal(reconciledLease, 'window-a');
    assert.equal(report.note, 'old ship finished');
    assert.equal(lease.generation, 1);
    assert.deepEqual(lease.owner, B);
    assert.equal(lease.operation, 'resume');
    // the old writer's generation is fenced on every path
    assert.throws(() => store.fence(key, 0, A, iso(6000)), (e: unknown) => e instanceof FencedError && /stale generation; current is 1/.test(e.message));
    assert.throws(() => store.heartbeat(key, 0, { actor: A, now: iso(6000) }), FencedError);
    assert.throws(() => store.release(key, 0, A), FencedError);
    // the new owner passes the fence and can heartbeat
    store.fence(key, 1, B, iso(6000));
    const hb = store.heartbeat(key, 1, { actor: B, now: iso(7000), ttlMs: 2000 });
    assert.equal(hb.heartbeatAt, iso(7000));
    assert.equal(hb.expiresAt, iso(9000));
    // wrong generation from the right owner is also fenced
    assert.throws(() => store.heartbeat(key, 5, { actor: B, now: iso(7000) }), FencedError);
    // a lapsed lease fails the fence even for its owner
    assert.throws(() => store.fence(key, 1, B, iso(20_000)), /lease expired/);
    // wrong owner with the current generation is fenced
    assert.throws(() => store.fence(key, 1, A, iso(8000)), /owned by window-b/);
  });

  it('Q23: a released lease can be re-acquired with generation+1', () => {
    const key = resourceKeys.goal('repo1', 'g1');
    const first = store.claim(key, { actor: A, now: t0 });
    assert.equal(first.status, 'acquired');
    store.release(key, 0, A);
    assert.equal(store.read(key)?.released, true);
    assert.equal(store.isCurrent(key, 0), false);
    assert.throws(() => store.fence(key, 0, A, iso(10)), /no live lease/);
    const second = store.claim(key, { actor: B, now: iso(10) });
    assert.equal(second.status, 'acquired');
    if (second.status === 'acquired') {
      assert.equal(second.lease.generation, 1);
      assert.deepEqual(second.lease.owner, B);
    }
    // releasing an unknown lease is a no-op; purging removes only released files
    store.release(resourceKeys.goal('repo1', 'unknown'), 0, A);
    store.release(key, 1, B);
    store.purgeReleased(key);
    assert.equal(existsSync(store.file(key)), false);
  });

  it('T1-STORE-CAS acceptance 3: with a live lease lock, claim, takeover, heartbeat and release each refuse with a locked message and leave the record byte-identical', () => {
    const quick = new LeaseStore(path.join(dir, 'leases'), { timeoutMs: 50 });
    const key = resourceKeys.card('repo1', 'T1-LOCKED');
    store.claim(key, { actor: A, now: t0, ttlMs: 1000 });
    const file = store.file(key);
    const before = readFileSync(file, 'utf8');
    // Another writer of this lease, alive (this process), holds its lock.
    writeFileSync(`${file}.lock`, `pid=${process.pid} at=${t0} nonce=held`, 'utf8');
    const writes: Array<[string, () => unknown]> = [
      ['claim', () => quick.claim(key, { actor: A, now: iso(500) })],
      ['takeover', () => quick.takeover(key, () => ({ reconciled: true, unresolvedOperations: [] }), { actor: B, now: iso(5000) })],
      ['heartbeat', () => quick.heartbeat(key, 0, { actor: A, now: iso(500) })],
      ['release', () => quick.release(key, 0, A)],
    ];
    for (const [name, write] of writes) {
      assert.throws(write, /locked/, `${name} refuses while the lock is held`);
      assert.equal(readFileSync(file, 'utf8'), before, `${name} leaves the lease record byte-identical`);
    }
    unlinkSync(`${file}.lock`);
  });

  it('T1-STORE-CAS: releasing a lease that does not exist writes no record and leaves no lock', () => {
    const key = resourceKeys.card('repo1', 'T1-NEVER');
    store.release(key, 0, A);
    assert.equal(existsSync(store.file(key)), false);
    assert.equal(existsSync(`${store.file(key)}.lock`), false);
  });

  it("T1-STORE-CAS: a lease store's lock options reach its lock: a crashed writer's lock older than staleMs is taken over", () => {
    const dir2 = path.join(dir, 'leases-stale');
    const patient = new LeaseStore(dir2, { timeoutMs: 1_000, staleMs: 100 });
    const key = resourceKeys.card('repo1', 'T1-CRASHED');
    const lock = `${patient.file(key)}.lock`;
    mkdirSync(dir2, { recursive: true });
    writeFileSync(lock, 'pid=999999999 at=2026-09-11T10:00:00.000Z nonce=crashed', 'utf8');
    // One second older than it was written: past this store's 100 ms stale age, well within the default 30 s.
    const written = statSync(lock).mtime;
    const older = new Date(written.getTime() - 1_000);
    utimesSync(lock, older, older);
    assert.equal(patient.claim(key, { actor: A, now: t0 }).status, 'acquired');
    assert.equal(existsSync(lock), false);
  });

  it('list() returns every parseable lease; resource keys are scoped and case-insensitive', () => {
    const leases = store.list();
    assert.ok(leases.length >= 4);
    assert.ok(leases.every((l) => typeof l.generation === 'number'));
    assert.equal(resourceKeys.card('r', 'T1-Foo'), 'card:r:t1-foo');
    assert.equal(resourceKeys.environment('Prod'), 'env:prod');
    assert.equal(resourceKeys.database('Main'), 'db:main');
    assert.equal(resourceKeys.integration('r', 'Main'), 'integration:r:main');
    assert.equal(resourceKeys.reviewPool('Codex'), 'review-pool:codex');
    assert.equal(resourceKeys.writerCap('host'), 'writers:host');
    assert.match(path.basename(store.file('anything')), /^[a-f0-9]{16}\.json$/);
  });
});
