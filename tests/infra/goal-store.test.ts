import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { GoalStore } from '../../src/state/goal-store.ts';
import { ensureStatePaths, statePathsFromRoot } from '../../src/state/paths.ts';
import { ReleaseAttempt } from '../../src/core/types.ts';
import { cleanup, iso, makeCardRun, makeGoal, tmpDir } from './helpers.ts';

describe('state/goal-store', () => {
  const dir = tmpDir();
  const paths = ensureStatePaths(statePathsFromRoot(path.join(dir, '.aidlc')));
  const store = new GoalStore(paths);
  after(() => cleanup(dir));

  it('saves, gets and lists goals (newest first) with schema validation', () => {
    const g1 = makeGoal('goal-a', { createdAt: iso(0), updatedAt: iso(0) });
    const g2 = makeGoal('goal-b', { createdAt: iso(60_000), updatedAt: iso(60_000) });
    const saved = store.saveGoal(g1);
    assert.equal(saved.id, 'goal-a');
    // updatedAt is stamped from the real clock on every save
    assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.equal(saved.createdAt, g1.createdAt);
    store.saveGoal(g2);
    assert.equal(store.getGoal('goal-a')?.id, 'goal-a');
    assert.equal(store.getGoal('missing'), undefined);
    assert.deepEqual(
      store.listGoals().map((g) => g.id),
      ['goal-b', 'goal-a'],
    );
    assert.ok(existsSync(store.goalFile('goal-a')));
  });

  it('refuses to persist an invalid goal', () => {
    const bad = { ...makeGoal('goal-bad'), state: 'NOPE' } as unknown as ReturnType<typeof makeGoal>;
    assert.throws(() => store.saveGoal(bad));
    assert.equal(store.getGoal('goal-bad'), undefined);
  });

  it('saves, gets and lists card runs per goal', () => {
    const run = makeCardRun('goal-a', 'T1-ALPHA');
    store.saveCardRun(run);
    store.saveCardRun(makeCardRun('goal-a', 'T1-BETA', { state: 'SHIP' }));
    store.saveCardRun(makeCardRun('goal-b', 'T1-GAMMA'));
    assert.equal(store.getCardRun('goal-a', 'T1-ALPHA')?.state, 'BUILD');
    assert.equal(store.getCardRun('goal-a', 'T1-ZZZ'), undefined);
    assert.deepEqual(
      store.listCardRuns('goal-a').map((r) => r.cardId).sort(),
      ['T1-ALPHA', 'T1-BETA'],
    );
    assert.deepEqual(store.listCardRuns('goal-none'), []);
    // defaults were filled in by the schema (review / ci / closure prefault)
    const back = store.getCardRun('goal-a', 'T1-ALPHA')!;
    assert.equal(back.review.substantiveDecisions, 0);
    assert.deepEqual(back.ci.reruns, []);
    assert.equal(back.closure.cleanup, false);
  });

  it('saves, gets and lists release attempts, filtered by goal', () => {
    const attempt = ReleaseAttempt.parse({
      id: 'rel-1',
      goalId: 'goal-a',
      generation: 0,
      target: 'staging',
      state: 'PREPARE',
      startedAt: iso(),
      deadline: iso(3 * 60 * 60 * 1000),
      updatedAt: iso(),
    });
    store.saveRelease(attempt);
    assert.equal(store.getRelease('rel-1')?.target, 'staging');
    assert.equal(store.listReleases('goal-a').length, 1);
    assert.equal(store.listReleases('goal-b').length, 0);
    assert.equal(store.listReleases().length, 1);
  });

  it('recover() removes interrupted temporary writes across the state tree', () => {
    const leftovers = [
      path.join(paths.goals, 'goal-a.json.tmp-1-0123abcd'),
      path.join(paths.cards, 'goal-a', 'T1-ALPHA.json.tmp-2-0123abcd'),
      path.join(paths.releases, 'rel-1.json.tmp-3-0123abcd'),
    ];
    for (const f of leftovers) writeFileSync(f, '{', 'utf8');
    const { interrupted } = store.recover();
    assert.deepEqual(interrupted.sort(), leftovers.sort());
    for (const f of leftovers) assert.equal(existsSync(f), false);
    // durable records untouched
    assert.equal(store.getGoal('goal-a')?.id, 'goal-a');
    assert.equal(store.getCardRun('goal-a', 'T1-ALPHA')?.cardId, 'T1-ALPHA');
    assert.deepEqual(store.recover().interrupted, []);
  });
});

describe('state/goal-store updateCardRun (T1-REVIEW-FINDINGS acceptance 2)', () => {
  const dir = tmpDir();
  const paths = ensureStatePaths(statePathsFromRoot(path.join(dir, '.aidlc')));
  after(() => cleanup(dir));

  it('applies the change to the persisted record under the card-run lock, never to a stale snapshot', () => {
    const store = new GoalStore(paths);
    const stale = store.saveCardRun(makeCardRun('goal-u', 'T1-U', { findings: [{ id: 'F1', stage: 'pre', round: 1, reason: '[spec] 6 tests @ src/u.ts:1: no RED -> add one', raisedAt: iso(0), disposition: 'open', disputes: [], reraised: [], revision: 0 }] }));
    // Another window records a note on F1 after this snapshot was taken.
    store.saveCardRun({ ...stale, findings: stale.findings.map((f) => ({ ...f, disposition: 'disputed', disputes: [{ at: iso(1000), note: 'from the other window', afterReraises: 0 }] })) });
    const next = store.updateCardRun('goal-u', 'T1-U', (current) => {
      assert.equal(current?.findings[0]?.disposition, 'disputed', 'the callback receives the persisted record');
      return { ...current!, findings: [...current!.findings, { id: 'F2', stage: 'pre', round: 1, reason: '[spec] 1 out of scope @ src/v.ts: outside allow_paths -> revert', raisedAt: iso(0), disposition: 'open', disputes: [], reraised: [], revision: 0 }] };
    });
    assert.deepEqual(next.findings.map((f) => [f.id, f.disposition]), [['F1', 'disputed'], ['F2', 'open']], 'both changes survive');
    assert.deepEqual(store.getCardRun('goal-u', 'T1-U')?.findings.map((f) => f.id), ['F1', 'F2']);
    assert.ok(!existsSync(`${store.cardFile('goal-u', 'T1-U')}.lock`), 'the lock is released');
  });

  it('waits for a held lock and refuses after the timeout; a lock older than the stale age is taken over', () => {
    const store = new GoalStore(paths, { lockTimeoutMs: 60 });
    store.saveCardRun(makeCardRun('goal-l', 'T1-L'));
    const lock = `${store.cardFile('goal-l', 'T1-L')}.lock`;
    writeFileSync(lock, `pid=1 at=${new Date().toISOString()}`, 'utf8');
    assert.throws(() => store.updateCardRun('goal-l', 'T1-L', (current) => current!), /locked/);
    assert.ok(existsSync(lock), 'a live lock is never removed by a waiter');
    unlinkSync(lock);
    writeFileSync(lock, 'pid=1 (crashed)', 'utf8');
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    const next = store.updateCardRun('goal-l', 'T1-L', (current) => ({ ...current!, blocker: 'after a stale lock' }));
    assert.equal(next.blocker, 'after a stale lock');
    assert.ok(!existsSync(lock));
    assert.ok(!existsSync(`${lock}.takeover`), 'the takeover marker is released');
    // A crashed taker-over leaves a stale takeover marker: it is aged out the same way and never blocks forever.
    writeFileSync(lock, 'pid=1 (crashed)', 'utf8');
    writeFileSync(`${lock}.takeover`, 'pid=2 (crashed during takeover)', 'utf8');
    utimesSync(lock, old, old);
    utimesSync(`${lock}.takeover`, old, old);
    assert.equal(store.updateCardRun('goal-l', 'T1-L', (current) => ({ ...current!, blocker: 'after a stale takeover marker' })).blocker, 'after a stale takeover marker');
    assert.ok(!existsSync(lock) && !existsSync(`${lock}.takeover`));
  });

  it('the write and the release are ownership-checked: a lock lost to another owner refuses the write and leaves that owner\'s lock', () => {
    const store = new GoalStore(paths);
    const before = store.saveCardRun(makeCardRun('goal-o', 'T1-O'));
    const lock = `${store.cardFile('goal-o', 'T1-O')}.lock`;
    assert.throws(
      () =>
        store.updateCardRun('goal-o', 'T1-O', (current) => {
          writeFileSync(lock, 'pid=other at=now', 'utf8'); // the lock changed hands while this writer was suspended
          return { ...current!, blocker: 'must not be written' };
        }),
      /lock/,
    );
    assert.deepEqual(store.getCardRun('goal-o', 'T1-O'), before);
    assert.equal(readFileSync(lock, 'utf8'), 'pid=other at=now', 'the other owner\'s lock is left in place');
    unlinkSync(lock);
  });

  it('the deadline holds on every wait: a stale lock behind a live takeover marker refuses within the timeout', () => {
    const store = new GoalStore(paths, { lockTimeoutMs: 80 });
    store.saveCardRun(makeCardRun('goal-d', 'T1-D'));
    const lock = `${store.cardFile('goal-d', 'T1-D')}.lock`;
    writeFileSync(lock, 'pid=1 (crashed)', 'utf8');
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    writeFileSync(`${lock}.takeover`, 'pid=2 (taking over)', 'utf8');
    const started = Date.now();
    assert.throws(() => store.updateCardRun('goal-d', 'T1-D', (current) => current!), /locked/);
    assert.ok(Date.now() - started < 2_000, 'refused at the deadline, not after the stale age');
    unlinkSync(lock);
    unlinkSync(`${lock}.takeover`);
  });

  it('a throwing change leaves the record and the lock untouched', () => {
    const store = new GoalStore(paths);
    const before = store.saveCardRun(makeCardRun('goal-t', 'T1-T'));
    assert.throws(() => store.updateCardRun('goal-t', 'T1-T', () => { throw new Error('refused'); }), /refused/);
    assert.deepEqual(store.getCardRun('goal-t', 'T1-T'), before);
    assert.ok(!existsSync(`${store.cardFile('goal-t', 'T1-T')}.lock`));
  });
});

describe('state/goal-store lock hardening (T1-REVIEW-FINDINGS-2 R3 decision 1)', () => {
  const dir = tmpDir();
  const paths = ensureStatePaths(statePathsFromRoot(path.join(dir, '.aidlc')));
  after(() => cleanup(dir));
  /** Route the store's `statSync` of one path through `handler` (the ESM binding of a builtin follows the CJS export after a sync). */
  const withStatOf = (target: string, handler: () => fs.Stats, body: () => void) => {
    const real = fs.statSync;
    (fs as unknown as Record<string, unknown>)['statSync'] = ((p: fs.PathLike, ...rest: unknown[]) => (String(p) === target ? handler() : (real as unknown as (...a: unknown[]) => fs.Stats)(p, ...rest))) as typeof fs.statSync;
    syncBuiltinESMExports();
    try {
      body();
    } finally {
      (fs as unknown as Record<string, unknown>)['statSync'] = real;
      syncBuiltinESMExports();
    }
  };

  it('a stale lock whose owner process is alive is never taken over: the waiter refuses at the deadline; a dead owner\'s lock is', () => {
    const store = new GoalStore(paths, { lockTimeoutMs: 60, staleLockMs: 10 });
    store.saveCardRun(makeCardRun('goal-p', 'T1-P'));
    const lock = `${store.cardFile('goal-p', 'T1-P')}.lock`;
    writeFileSync(lock, `pid=${process.pid} at=old nonce=x`, 'utf8'); // this process is alive
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    assert.throws(() => store.updateCardRun('goal-p', 'T1-P', (current) => current!), /locked/);
    assert.ok(existsSync(lock), 'a live owner keeps its lock however old');
    unlinkSync(lock);
    writeFileSync(lock, 'pid=999999999 at=old nonce=y', 'utf8'); // no such process
    utimesSync(lock, old, old);
    assert.equal(store.updateCardRun('goal-p', 'T1-P', (current) => ({ ...current!, blocker: 'after a dead owner' })).blocker, 'after a dead owner');
  });

  it('the deadline is checked before every retry acquisition: a wait that overran it never runs the change even when the lock is free by then', () => {
    const store = new GoalStore(paths, { lockTimeoutMs: 40 });
    store.saveCardRun(makeCardRun('goal-f', 'T1-F'));
    const lock = `${store.cardFile('goal-f', 'T1-F')}.lock`;
    writeFileSync(lock, 'pid=1 at=now nonce=z', 'utf8');
    let entered = false;
    // The wait between two attempts overruns the deadline and the owner releases the lock meanwhile.
    withStatOf(lock, () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
      try {
        unlinkSync(lock);
      } catch {
        /* already gone */
      }
      return { mtimeMs: Date.now() } as fs.Stats;
    }, () => {
      assert.throws(() => store.updateCardRun('goal-f', 'T1-F', (current) => { entered = true; return current!; }), /locked/);
    });
    assert.equal(entered, false, 'an expired waiter refuses instead of entering late');
  });

  it('ageMs treats only a vanished file as gone: a permission error on the lock propagates instead of looping to the deadline', () => {
    const store = new GoalStore(paths, { lockTimeoutMs: 200 });
    store.saveCardRun(makeCardRun('goal-e', 'T1-E'));
    const lock = `${store.cardFile('goal-e', 'T1-E')}.lock`;
    writeFileSync(lock, 'pid=1 at=now nonce=w', 'utf8');
    try {
      withStatOf(lock, () => {
        const err = new Error('EACCES: permission denied, stat') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }, () => {
        assert.throws(() => store.updateCardRun('goal-e', 'T1-E', (current) => current!), (err: unknown) => err instanceof Error && /EACCES/.test(err.message) && !/locked by another writer/.test(err.message));
      });
    } finally {
      unlinkSync(lock);
    }
  });

  it('saveCardRun refuses a snapshot that lacks, regresses or un-decides a persisted ledger entry, so controller writers are covered too', () => {
    const store = new GoalStore(paths);
    const base = store.saveCardRun(makeCardRun('goal-s', 'T1-S'));
    const withPending = store.saveCardRun({ ...base, preReview: { ...base.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd', requestedAt: iso(0), durationMs: 0, outcome: 'pending', reasons: [], reservationId: 'res-1' }] } });
    assert.throws(() => store.saveCardRun(base), /changed since it was read/i, 'a snapshot without the reservation is refused');
    const decided = store.saveCardRun({ ...withPending, preReview: { ...withPending.preReview, rounds: [{ ...withPending.preReview.rounds[0]!, outcome: 'block', reasons: ['[spec] 6 tests @ src/s.ts:1: no RED -> add one'] }] } });
    assert.throws(() => store.saveCardRun(withPending), /changed since it was read/i, 'a snapshot that would turn the decided round back into pending is refused');
    assert.equal(store.getCardRun('goal-s', 'T1-S')?.preReview.rounds[0]?.outcome, 'block');
    const counters = store.saveCardRun({ ...decided, review: { ...decided.review, substantiveDecisions: 1, substantiveBlocks: 1 } });
    assert.throws(() => store.saveCardRun(decided), /changed since it was read/i, 'a snapshot that would regress the decision counters is refused');
    assert.equal(store.getCardRun('goal-s', 'T1-S')?.review.substantiveDecisions, 1);
    assert.equal(store.saveCardRun({ ...counters, blocker: 'fresh' }).blocker, 'fresh', 'a snapshot at the current ledger writes');
  });

  it('saveCardRun refuses a snapshot that still holds a reservation the persisted record released: a phantom pending entry is never written back', () => {
    const store = new GoalStore(paths);
    const base = store.saveCardRun(makeCardRun('goal-r', 'T1-R'));
    const reservation = { invocationId: 'r3:res', candidateDigest: 'd', base: 'main', policyVersion: 'v1', reviewer: 'r3', requestedAt: iso(0), outcome: 'pending' as const };
    const reserved = store.updateCardRun('goal-r', 'T1-R', (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations, reservation] } }));
    store.updateCardRun('goal-r', 'T1-R', (current) => ({ ...current!, review: { ...current!.review, invocations: current!.review.invocations.filter((i) => i.invocationId !== 'r3:res') } }));
    assert.throws(() => store.saveCardRun({ ...reserved, blocker: 'late' }), /changed since it was read/i, 'the released R3 reservation is not resurrected');
    assert.equal(store.getCardRun('goal-r', 'T1-R')?.review.invocations.length, 0);
    const round = { round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd', requestedAt: iso(0), durationMs: 0, outcome: 'pending' as const, reasons: [], reservationId: 'res-late' };
    const withRound = store.updateCardRun('goal-r', 'T1-R', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: [...current!.preReview.rounds, round] } }));
    store.updateCardRun('goal-r', 'T1-R', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: current!.preReview.rounds.filter((r) => r.reservationId !== 'res-late') } }));
    assert.throws(() => store.saveCardRun({ ...withRound, blocker: 'late' }), /changed since it was read/i, 'the abandoned R2 round is not resurrected');
    assert.equal(store.getCardRun('goal-r', 'T1-R')?.preReview.rounds.length, 0);
    assert.equal(store.saveCardRun({ ...base, preReview: { ...base.preReview, rounds: [{ ...round, outcome: 'pass' }] }, blocker: 'decided' }).blocker, 'decided', 'a decided round the writer adds is written');
  });

  it('a lock this process cannot read is never taken over: the read error propagates instead of counting as a dead owner', () => {
    const store = new GoalStore(paths, { lockTimeoutMs: 200, staleLockMs: 10 });
    store.saveCardRun(makeCardRun('goal-u', 'T1-U'));
    const lock = `${store.cardFile('goal-u', 'T1-U')}.lock`;
    writeFileSync(lock, `pid=${process.pid} at=old nonce=u`, 'utf8');
    const old = new Date(Date.now() - 120_000);
    utimesSync(lock, old, old);
    const real = fs.readFileSync;
    (fs as unknown as Record<string, unknown>)['readFileSync'] = ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(p) === lock) {
        const err = new Error('EACCES: permission denied, open') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return (real as unknown as (...a: unknown[]) => Buffer | string)(p, ...rest);
    }) as typeof fs.readFileSync;
    syncBuiltinESMExports();
    try {
      assert.throws(() => store.updateCardRun('goal-u', 'T1-U', (current) => current!), (err: unknown) => err instanceof Error && /EACCES/.test(err.message));
    } finally {
      (fs as unknown as Record<string, unknown>)['readFileSync'] = real;
      syncBuiltinESMExports();
    }
    assert.ok(existsSync(lock), 'the unreadable lock is left in place');
    unlinkSync(lock);
  });
});
