/**
 * Card T0-REVIEW-RELEASE: every mutation of a review pool runs in one section of the pool record's lock, and `aidlc review
 * release` frees the slot of a process that died outside any catch, journaling the release in that same section.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { goalForCards, makeFixture, writeCard, T0, type Fixture } from './_harness.ts';
import { ReviewQueue, type EnqueueInput } from '../../src/coordination/review-queue.ts';
import { Journal } from '../../src/state/journal.ts';
import { hostName, shortKey } from '../../src/state/paths.ts';
import { atomicWriteJson, listJsonFiles } from '../../src/state/store.ts';
import type { ActorIdentity, ReviewRequest } from '../../src/core/types.ts';

/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const CARD = 'T1-HELD';
const POOL = 'default';
const AT = '2026-09-11T01:00:00.000Z';
const FAR = '2126-01-01T00:00:00.000Z';
const REASON = 'the owner died';

const deadPid = (): number => {
  const pid = spawnSync(process.execPath, ['-e', '']).pid;
  assert.ok(pid > 0);
  return pid;
};
const ownerOf = (pid: number, host = hostName()): ActorIdentity => ({ session: 'gone', pid, processStart: T0, host });

const input = (requester: string, digest = 'held', pool = POOL): EnqueueInput => ({ pool, repository: 'o/r', candidateDigest: digest, base: 'main', policyVersion: 'p', reviewer: 'r', requester, deadline: FAR });

/** A request admitted for `owner`, so it is running and holds the slot of its pool. */
function running(fx: Fixture, owner: ActorIdentity, requester = `g-held:${CARD}`, pool = POOL, queue: ReviewQueue = fx.queue): ReviewRequest {
  const enqueued = queue.enqueue(input(requester, 'held', pool));
  const admitted = queue.admit(pool, owner, fx.now(), enqueued.request.key);
  assert.equal(admitted.status, 'admitted');
  return queue.get(enqueued.request.key)!;
}

/** Every file of the queue directory and its text, so a refusal that writes anything, a lock left behind included, shows. */
const queueFiles = (fx: Fixture): Record<string, string> => Object.fromEntries(readdirSync(fx.paths.reviewQueue).sort().map((name) => [name, readFileSync(path.join(fx.paths.reviewQueue, name), 'utf8')]));

const code = (err: unknown): string | undefined => (err as { code?: string }).code;

const withFixture = (body: (fx: Fixture) => void): void => {
  const fx = makeFixture();
  try {
    body(fx);
  } finally {
    fx.cleanup();
  }
};

const cli = (fx: Fixture, key: string): SpawnSyncReturns<string> => spawnSync(process.execPath, [MAIN, 'review', 'release', key, '--reason', REASON], { cwd: fx.tmp, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-B' } });

const cliAsync = (fx: Fixture, key: string): Promise<{ status: number | null; stderr: string }> =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MAIN, 'review', 'release', key, '--reason', REASON], { cwd: fx.tmp, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-B' } });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stderr }));
  });

/** The CLI with a preload that fails the rename onto one file of the queue directory, the last step of its atomic write. */
function cliFailingWrite(fx: Fixture, key: string, file: string): SpawnSyncReturns<string> {
  const preload = path.join(fx.tmp, 'fail-write.mjs');
  writeFileSync(preload, [
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { syncBuiltinESMExports } from 'node:module';",
    'const rename = fs.renameSync;',
    "fs.renameSync = (from, to) => { if (path.basename(String(to)) === process.env.FAIL_WRITE_TO) throw new Error('injected write failure'); return rename(from, to); };",
    'syncBuiltinESMExports();',
    '',
  ].join('\n'));
  return spawnSync(process.execPath, ['--import', pathToFileURL(preload).href, MAIN, 'review', 'release', key, '--reason', REASON], { cwd: fx.tmp, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-B', FAIL_WRITE_TO: file } });
}

const poolFile = (fx: Fixture): string => readdirSync(fx.paths.reviewQueue).find((name) => name.startsWith('_pool-'))!;

const notes = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'NOTE' && e.data['kind'] === 'review-slot-released');
const noteFields = (fx: Fixture, goalId: string) => notes(fx, goalId).map((e) => [e.goalId, e.cardId, e.data['key'], e.data['seq'], e.data['reason']]);

test('acceptance 1: release frees a running request of this host whose owner process is gone [R2]', () => {
  withFixture((fx) => {
    const request = running(fx, ownerOf(deadPid()));
    const waiting = fx.queue.enqueue(input('g-next:T1-NEXT', 'next')).request;
    assert.deepEqual(fx.queue.pool(POOL).active, [request.key]);

    const released = fx.queue.release(request.key, REASON, { now: AT });

    const expected = { ...request, state: 'cancelled', finishedAt: AT, lastError: REASON };
    assert.deepEqual(released, expected);
    assert.deepEqual(fx.queue.get(request.key), expected);
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    assert.equal(fx.queue.pool(POOL).updatedAt, AT);
    const admitted = fx.queue.admit(POOL, ownerOf(process.pid), AT);
    assert.equal(admitted.status === 'admitted' && admitted.request.key, waiting.key, 'the next request takes the freed slot');
  });
});

test('acceptance 2: release throws and leaves the request and the pool unchanged for anything but a dead owner of this host [R2]', () => {
  const refused = (name: string, setup: (fx: Fixture) => string, pattern: RegExp): void => {
    withFixture((fx) => {
      const key = setup(fx);
      const before = queueFiles(fx);
      let called = false;
      assert.throws(() => fx.queue.release(key, 'reason', { now: AT, before: () => (called = true) }), pattern, name);
      assert.deepEqual(queueFiles(fx), before, name);
      assert.equal(called, false, `${name}: a refusal runs no before`);
    });
  };
  refused('an unknown key', (fx) => {
    running(fx, ownerOf(deadPid()));
    return 'no-such-request';
  }, /unknown review request no-such-request/);
  refused('a queued request', (fx) => fx.queue.enqueue(input(`g-held:${CARD}`)).request.key, /is queued, not running/);
  refused('a completed request', (fx) => {
    const key = running(fx, ownerOf(deadPid())).key;
    fx.queue.complete(key, 'verdict', fx.now());
    return key;
  }, /is completed, not running/);
  refused('a cancelled request', (fx) => {
    const key = running(fx, ownerOf(deadPid())).key;
    fx.queue.cancel(key, 'already gone', fx.now());
    return key;
  }, /is cancelled, not running/);
  refused('a retry-after request', (fx) => {
    const key = running(fx, ownerOf(deadPid())).key;
    fx.queue.hold(key, FAR, 'quota', fx.now());
    return key;
  }, /is retry-after, not running/);
  refused('a lost request', (fx) => {
    const key = running(fx, ownerOf(deadPid())).key;
    fx.queue.markLost(key, 'lost');
    return key;
  }, /is lost, not running/);
  refused('a slotOwner naming another host', (fx) => running(fx, ownerOf(deadPid(), 'elsewhere')).key, /host elsewhere/);
  refused('pid 0', (fx) => running(fx, ownerOf(0)).key, /no usable pid/);
  refused('a pid no process can have', (fx) => running(fx, ownerOf(2 ** 31)).key, /no usable pid/);
  refused('a running request with no slotOwner', (fx) => {
    const request = running(fx, ownerOf(deadPid()));
    const file = listJsonFiles(fx.paths.reviewQueue).find((f) => !path.basename(f).startsWith('_pool-'))!;
    atomicWriteJson(file, { ...request, slotOwner: undefined });
    return request.key;
  }, /no usable pid/);
  refused('an owner process that is alive', (fx) => running(fx, ownerOf(process.pid)).key, /still running as pid/);
});

test('acceptance 2: a before that throws is rethrown, writes nothing and leaves the slot releasable [R2]', () => {
  withFixture((fx) => {
    const request = running(fx, ownerOf(deadPid()));
    const before = queueFiles(fx);
    const failure = new Error('journal write failed');
    let seen: ReviewRequest | undefined;
    assert.throws(() => fx.queue.release(request.key, REASON, { now: AT, before: (r) => {
      seen = r;
      throw failure;
    } }), (err) => err === failure);
    assert.deepEqual(seen, request);
    assert.deepEqual(queueFiles(fx), before);
    assert.equal(fx.queue.release(request.key, REASON, { now: AT }).state, 'cancelled');
  });
});

/** Runs each attempt while a release holds its section: each must refuse with LOCKED, writing nothing. */
function refusedInSection(fx: Fixture, key: string, attempts: Record<string, () => unknown>): void {
  const reached: string[] = [];
  const released = fx.queue.release(key, REASON, { now: AT, before: () => {
    const before = queueFiles(fx);
    for (const [name, attempt] of Object.entries(attempts)) {
      assert.throws(attempt, (err) => code(err) === 'LOCKED', name);
      reached.push(name);
    }
    assert.deepEqual(queueFiles(fx), before);
  } });
  assert.deepEqual(reached, Object.keys(attempts));
  assert.equal(released.state, 'cancelled');
  assert.equal(released.lastError, REASON);
  assert.deepEqual(fx.queue.pool(POOL).active, []);
}

test('acceptance 3: while a release holds its section, enqueue, admit, cancel and a second release refuse with LOCKED [R1] [R2]', () => {
  withFixture((fx) => {
    const request = running(fx, ownerOf(deadPid()));
    refusedInSection(fx, request.key, {
      'enqueue of a joining goal': () => fx.queue.enqueue(input('g-join:T1-JOIN')),
      'enqueue of a new request': () => fx.queue.enqueue(input('g-new:T1-NEW', 'new')),
      admit: () => fx.queue.admit(POOL, ownerOf(process.pid), AT),
      cancel: () => fx.queue.cancel(request.key, 'cancelled meanwhile', AT),
      'second release': () => fx.queue.release(request.key, 'second', { now: AT }),
    });
    assert.deepEqual(fx.queue.get(request.key)?.requesters, [`g-held:${CARD}`]);
  });
});

test('acceptance 3: every other mutation of the pool takes the same section [R1]', () => {
  withFixture((fx) => {
    const request = running(fx, ownerOf(deadPid()));
    refusedInSection(fx, request.key, {
      requeue: () => fx.queue.requeue(request.key, AT),
      complete: () => fx.queue.complete(request.key, 'verdict', AT),
      markLost: () => fx.queue.markLost(request.key, 'lost'),
      resolveLost: () => fx.queue.resolveLost(request.key, { found: false }, AT),
      hold: () => fx.queue.hold(request.key, FAR, 'quota', AT),
      setPoolLimit: () => fx.queue.setPoolLimit(POOL, 2, 'two seats'),
      savePool: () => fx.queue.savePool({ ...fx.queue.pool(POOL), maxConcurrent: 2 }),
    });
  });
});

test('acceptance 3: updatePool takes the same section [R1]', () => {
  withFixture((fx) => {
    const request = running(fx, ownerOf(deadPid()));
    refusedInSection(fx, request.key, { updatePool: () => fx.queue.updatePool(POOL, (current) => ({ ...current, maxConcurrent: 2 })) });
  });
});

test('acceptance 3: updatePool changes the pool as stored in its section, so a read taken before an admission loses nothing [R1]', () => {
  withFixture((fx) => {
    const stale = fx.queue.pool(POOL, AT);
    assert.equal(stale.nextSeq, 0);
    assert.deepEqual(stale.active, []);
    const request = running(fx, ownerOf(deadPid()));

    const updated = fx.queue.updatePool(POOL, (current) => ({ ...current, resetAt: FAR }));

    assert.deepEqual(updated.active, [request.key]);
    assert.equal(updated.nextSeq, 1);
    assert.equal(updated.resetAt, FAR);
    assert.deepEqual(fx.queue.pool(POOL), updated);
  });
});

test('acceptance 3: a change of updatePool that throws writes nothing, and it cannot write another pool [R1]', () => {
  withFixture((fx) => {
    running(fx, ownerOf(deadPid()));
    const before = queueFiles(fx);
    const failure = new Error('change failed');
    assert.throws(() => fx.queue.updatePool(POOL, () => {
      throw failure;
    }), (err) => err === failure);
    assert.deepEqual(queueFiles(fx), before);
    assert.equal(fx.queue.updatePool(POOL, (current) => ({ ...current, pool: 'other' })).pool, POOL);
    assert.deepEqual(readdirSync(fx.paths.reviewQueue).filter((name) => name.startsWith('_pool-')).length, 1);
  });
});

test('acceptance 3: a read of the pool takes no section [R1]', () => {
  withFixture((fx) => {
    const request = running(fx, ownerOf(deadPid()));
    fx.queue.release(request.key, REASON, { now: AT, before: () => {
      assert.deepEqual(fx.queue.pool(POOL).active, [request.key]);
      assert.equal(fx.queue.get(request.key)?.state, 'running');
      assert.deepEqual(fx.queue.list(POOL).map((r) => r.key), [request.key]);
      assert.equal(fx.queue.heldUntil(POOL, FAR, AT), FAR);
      assert.equal(fx.queue.notificationOwner(POOL), undefined);
    } });
  });
});

test('acceptance 3: an enqueue joining a request of another pool takes the section of that request, not the pool it names [R1]', () => {
  withFixture((fx) => {
    const request = running(fx, ownerOf(deadPid()));
    refusedInSection(fx, request.key, { 'enqueue naming another pool': () => fx.queue.enqueue(input('g-join:T1-JOIN', 'held', 'other')) });
  });
});

test('acceptance 3: a request moved to another pool after the first read is released in the section of the pool now holding it [R1] [R2]', () => {
  withFixture((fx) => {
    const plain = fx.queue;
    const request = running(fx, ownerOf(deadPid()));
    plain.cancel(request.key, 'cancelled', fx.now());
    // A second process moves the request between the first read and the section: enqueue replaces a cancelled request in the pool it names.
    class Moved extends ReviewQueue {
      moved = false;
      override get(key: string): ReviewRequest | undefined {
        const stale = super.get(key);
        if (this.moved) return stale;
        this.moved = true;
        const held = running(fx, ownerOf(deadPid()), `g-moved:${CARD}`, 'other', plain);
        assert.equal(held.key, request.key);
        return stale;
      }
    }
    const reached: unknown[] = [];
    const released = new Moved(fx.paths.reviewQueue).release(request.key, REASON, { now: AT, before: () => {
      try {
        plain.enqueue(input('g-join:T1-JOIN', 'held', 'other'));
      } catch (err) {
        reached.push(code(err));
      }
    } });
    assert.deepEqual(reached, ['LOCKED']);
    assert.equal(released.pool, 'other');
    assert.deepEqual(plain.pool('other').active, []);
  });
});

test('acceptance 4: a second release of a key admitted again for a live owner refuses and leaves it running [R2]', () => {
  withFixture((fx) => {
    const first = running(fx, ownerOf(deadPid()));
    fx.queue.release(first.key, 'first', { now: AT });
    const again = running(fx, ownerOf(process.pid));
    assert.equal(again.key, first.key);
    assert.notEqual(again.seq, first.seq);
    assert.throws(() => fx.queue.release(first.key, 'stale', { now: AT }), /still running as pid/);
    assert.deepEqual(fx.queue.get(first.key), again);
    assert.deepEqual(fx.queue.pool(POOL).active, [first.key]);
  });
});

test('acceptance 5: aidlc review release frees a dead owner with one NOTE, refuses a live owner, and a later admission journals its own NOTE [R3]', () => {
  withFixture((fx) => {
    writeCard(fx, { id: CARD, title: 'held slot' });
    const goal = goalForCards(fx, [CARD]);
    const requester = `${goal.id}:${CARD}`;

    const live = running(fx, ownerOf(process.pid), requester);
    const refused = cli(fx, live.key);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /still running as pid/);
    assert.equal(notes(fx, goal.id).length, 0);
    assert.deepEqual(fx.queue.pool(POOL).active, [live.key]);
    fx.queue.cancel(live.key, 'test over', fx.now());

    const dead = running(fx, ownerOf(deadPid()), requester);
    const released = cli(fx, dead.key);
    assert.equal(released.status, 0, released.stderr);
    assert.deepEqual(JSON.parse(released.stdout), JSON.parse(JSON.stringify(fx.queue.get(dead.key))));
    assert.equal(fx.queue.get(dead.key)?.state, 'cancelled');
    assert.equal(fx.queue.get(dead.key)?.lastError, REASON);
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    assert.deepEqual(noteFields(fx, goal.id), [[goal.id, CARD, dead.key, dead.seq, REASON]]);

    const later = running(fx, ownerOf(deadPid()), requester);
    assert.equal(later.key, dead.key);
    assert.notEqual(later.seq, dead.seq);
    assert.equal(cli(fx, later.key).status, 0);
    assert.deepEqual(noteFields(fx, goal.id), [[goal.id, CARD, dead.key, dead.seq, REASON], [goal.id, CARD, later.key, later.seq, REASON]]);
    assert.equal(Journal.forGoal(fx.paths.journal, goal.id).verify().ok, true);
  });
});

test('acceptance 5: a goal requesting through two cards journals one NOTE [R3]', () => {
  withFixture((fx) => {
    writeCard(fx, { id: CARD, title: 'held slot' });
    writeCard(fx, { id: 'T1-TWO', title: 'second card' });
    const goal = goalForCards(fx, [CARD, 'T1-TWO']);
    const request = running(fx, ownerOf(deadPid()), `${goal.id}:${CARD}`);
    fx.queue.enqueue(input(`${goal.id}:T1-TWO`));
    assert.equal(cli(fx, request.key).status, 0);
    assert.deepEqual(noteFields(fx, goal.id), [[goal.id, CARD, request.key, request.seq, REASON]]);
  });
});

test('acceptance 5: a NOTE counts only for its own key and seq, as a NOTE of that kind, and a requester naming no goal journals nothing [R3]', () => {
  withFixture((fx) => {
    writeCard(fx, { id: CARD, title: 'held slot' });
    const goal = goalForCards(fx, [CARD]);
    const requester = `${goal.id}:${CARD}`;
    const journal = Journal.forGoal(fx.paths.journal, goal.id);

    const first = running(fx, ownerOf(deadPid()), requester, 'pool-one');
    assert.equal(first.seq, 0);
    fx.queue.enqueue(input('g-gone:T1-GONE', 'held', 'pool-one'));
    journal.append({ type: 'NOTE', goalId: goal.id, data: { kind: 'another-kind', key: first.key, seq: first.seq } });
    journal.append({ type: 'GOAL_CREATED', goalId: goal.id, data: { kind: 'review-slot-released', key: first.key, seq: first.seq } });
    const released = cli(fx, first.key);
    assert.equal(released.status, 0, released.stderr);
    assert.deepEqual(noteFields(fx, goal.id), [[goal.id, CARD, first.key, 0, REASON]]);

    const enqueued = fx.queue.enqueue(input(requester, 'other', 'pool-two')).request;
    assert.equal(fx.queue.admit('pool-two', ownerOf(deadPid()), fx.now()).status, 'admitted');
    assert.equal(enqueued.seq, 0);
    assert.notEqual(enqueued.key, first.key);
    assert.equal(cli(fx, enqueued.key).status, 0);
    assert.deepEqual(noteFields(fx, goal.id), [[goal.id, CARD, first.key, 0, REASON], [goal.id, CARD, enqueued.key, 0, REASON]]);
  });
});

test('acceptance 5: the same key at the same seq in another pool is another release, with its own NOTE naming its pool [R3]', () => {
  withFixture((fx) => {
    writeCard(fx, { id: CARD, title: 'held slot' });
    const goal = goalForCards(fx, [CARD]);
    const requester = `${goal.id}:${CARD}`;

    const first = running(fx, ownerOf(deadPid()), requester, 'pool-one');
    assert.equal(cli(fx, first.key).status, 0);
    const moved = running(fx, ownerOf(deadPid()), requester, 'pool-two');
    assert.deepEqual([moved.key, moved.seq, moved.pool], [first.key, first.seq, 'pool-two']);
    const released = cli(fx, moved.key);
    assert.equal(released.status, 0, released.stderr);

    assert.deepEqual(notes(fx, goal.id).map((e) => [e.data['pool'], e.data['key'], e.data['seq']]), [['pool-one', first.key, 0], ['pool-two', first.key, 0]]);
  });
});

/** A dead owner's request of two goals, its slot held; `T1-NEXT` waits behind it. */
function twoGoals(fx: Fixture): { one: string; two: string; request: ReviewRequest } {
  writeCard(fx, { id: CARD, title: 'held slot' });
  writeCard(fx, { id: 'T1-TWO', title: 'second requester' });
  const one = goalForCards(fx, [CARD]).id;
  const two = goalForCards(fx, ['T1-TWO']).id;
  const request = running(fx, ownerOf(deadPid()), `${one}:${CARD}`);
  fx.queue.enqueue(input(`${two}:T1-TWO`));
  return { one, two, request: fx.queue.get(request.key)! };
}

test('acceptance 6: a failed write of the pool leaves the request running and its slot held, and running the command again finishes it [R2] [R3]', () => {
  withFixture((fx) => {
    const { one, two, request } = twoGoals(fx);

    const failed = cliFailingWrite(fx, request.key, poolFile(fx));
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /injected write failure/);
    assert.deepEqual(fx.queue.get(request.key), request);
    assert.deepEqual(fx.queue.pool(POOL).active, [request.key]);

    const finished = cli(fx, request.key);
    assert.equal(finished.status, 0, finished.stderr);
    assert.equal(fx.queue.get(request.key)?.state, 'cancelled');
    assert.equal(fx.queue.get(request.key)?.lastError, REASON);
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    assert.deepEqual(noteFields(fx, one), [[one, CARD, request.key, request.seq, REASON]]);
    assert.deepEqual(noteFields(fx, two), [[two, 'T1-TWO', request.key, request.seq, REASON]]);
  });
});

test('acceptance 6: a failed write of the request leaves it running, and running the command again finishes it without touching a later admission [R2] [R3]', () => {
  withFixture((fx) => {
    const { one, two, request } = twoGoals(fx);
    const next = fx.queue.enqueue(input('g-next:T1-NEXT', 'next')).request;

    const failed = cliFailingWrite(fx, request.key, `${shortKey(request.key)}.json`);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /injected write failure/);
    assert.deepEqual(fx.queue.get(request.key), request);

    const admitted = fx.queue.admit(POOL, ownerOf(process.pid), AT);
    assert.equal(admitted.status === 'admitted' && admitted.request.key, next.key, 'the freed slot is free');

    const finished = cli(fx, request.key);
    assert.equal(finished.status, 0, finished.stderr);
    assert.equal(fx.queue.get(request.key)?.state, 'cancelled');
    assert.equal(fx.queue.get(request.key)?.lastError, REASON);
    assert.deepEqual(fx.queue.pool(POOL).active, [next.key]);
    assert.equal(fx.queue.get(next.key)?.state, 'running');
    assert.deepEqual(noteFields(fx, one), [[one, CARD, request.key, request.seq, REASON]]);
    assert.deepEqual(noteFields(fx, two), [[two, 'T1-TWO', request.key, request.seq, REASON]]);
  });
});

test('acceptance 6: a release whose second journal cannot be written exits non-zero with the slot held, and running it again finishes it [R3]', () => {
  withFixture((fx) => {
    writeCard(fx, { id: CARD, title: 'held slot' });
    writeCard(fx, { id: 'T1-TWO', title: 'second requester' });
    const one = goalForCards(fx, [CARD]);
    const two = goalForCards(fx, ['T1-TWO']);
    const request = running(fx, ownerOf(deadPid()), `${one.id}:${CARD}`);
    fx.queue.enqueue(input(`${two.id}:T1-TWO`));
    const joined = fx.queue.get(request.key);

    const journal = path.join(fx.paths.journal, `${two.id}.jsonl`);
    const kept = readFileSync(journal, 'utf8');
    rmSync(journal);
    mkdirSync(journal);
    const failed = cli(fx, request.key);
    assert.notEqual(failed.status, 0);
    assert.deepEqual(fx.queue.pool(POOL).active, [request.key]);
    assert.deepEqual(fx.queue.get(request.key), joined);
    assert.equal(notes(fx, one.id).length, 1);

    rmSync(journal, { recursive: true });
    writeFileSync(journal, kept);
    const finished = cli(fx, request.key);
    assert.equal(finished.status, 0, finished.stderr);
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    assert.equal(fx.queue.get(request.key)?.state, 'cancelled');
    assert.deepEqual(noteFields(fx, one.id), [[one.id, CARD, request.key, request.seq, REASON]]);
    assert.deepEqual(noteFields(fx, two.id), [[two.id, 'T1-TWO', request.key, request.seq, REASON]]);
  });
});

test('acceptance 7: two processes releasing one key end with one exit 0, the other refused or LOCKED, one NOTE per goal and a chain that verifies [R1] [R3]', async () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: CARD, title: 'held slot' });
    writeCard(fx, { id: 'T1-TWO', title: 'second requester' });
    const one = goalForCards(fx, [CARD]);
    const two = goalForCards(fx, ['T1-TWO']);
    for (let round = 0; round < 3; round += 1) {
      const request = running(fx, ownerOf(deadPid()), `${one.id}:${CARD}`);
      fx.queue.enqueue(input(`${two.id}:T1-TWO`));
      const results = await Promise.all([cliAsync(fx, request.key), cliAsync(fx, request.key)]);
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === 0).length, 1, JSON.stringify(results));
      const loser = results.find((r) => r.status !== 0)!;
      assert.match(loser.stderr, /is cancelled, not running|LOCKED/);
      assert.deepEqual(fx.queue.pool(POOL).active, []);
      assert.equal(notes(fx, one.id).length, round + 1);
      assert.equal(notes(fx, two.id).length, round + 1);
      for (const goal of [one, two]) {
        const chain = Journal.forGoal(fx.paths.journal, goal.id).verify();
        assert.deepEqual(chain.problems, []);
      }
    }
  } finally {
    fx.cleanup();
  }
});

test('acceptance 7: a command run while another holds the section refuses with LOCKED and journals nothing, so its NOTE lookup and append are inside the section [R1] [R3]', () => {
  withFixture((fx) => {
    writeCard(fx, { id: CARD, title: 'held slot' });
    const goal = goalForCards(fx, [CARD]);
    const request = running(fx, ownerOf(deadPid()), `${goal.id}:${CARD}`);
    const outcomes: Array<[number | null, boolean, number]> = [];
    fx.queue.release(request.key, REASON, { now: AT, before: () => {
      const racing = cli(fx, request.key);
      outcomes.push([racing.status, /LOCKED/.test(racing.stderr), notes(fx, goal.id).length]);
    } });
    assert.deepEqual(outcomes, [[1, true, 0]]);
  });
});

const read = (file: string): string => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

/** The text of a `## ` section of a Markdown file, from its heading to the next one, without the heading. */
function section(text: string, heading: string): string {
  const at = text.indexOf(`\n${heading}\n`);
  assert.ok(at >= 0, heading);
  const body = text.slice(at + heading.length + 2);
  const end = body.indexOf('\n## ');
  return (end < 0 ? body : body.slice(0, end)).trim();
}

test('acceptance 8: the OPERATIONS sentence is the last paragraph of Ship gates and not in Sessions [R4]', () => {
  const sentence = '`aidlc review release <key> --reason <text>` frees the slot of a `running` request whose owner process is gone from this host, which is how a process killed outside any catch leaves the pool; it refuses while that process is alive or when the owner is on another host, and journals a `review-slot-released` NOTE in each requester goal before it frees the slot, so running it again finishes a release that failed part way.';
  const operations = read('docs/OPERATIONS.md');
  assert.ok(section(operations, '## Ship gates (GitHub ship path)').endsWith(`\n\n${sentence}`));
  assert.ok(!section(operations, '## Sessions').includes('review release'));
});

test('acceptance 8: the CHANGELOG Unreleased section carries the entry [R5]', () => {
  const entry = '- T0-REVIEW-RELEASE: `aidlc review release <key> --reason <text>` frees the review slot of a process that died outside any catch, refusing while that process is alive or when it ran on another host, and every mutation of a review pool now runs in one lock section, so a release can never cancel a later admission of the same key.';
  assert.ok(section(read('CHANGELOG.md'), '## Unreleased').split('\n').includes(entry));
});
