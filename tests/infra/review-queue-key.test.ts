/**
 * Card T0-REVIEW-QUEUE-KEY (issue 304): `ReviewQueue.hold`, `cancel` and `release` find a request by `shortKey` of the key they
 * are given, which ignores letter case and reads `\` as `/`, and free the slot of the request's stored key; `aidlc review
 * release` journals its `review-slot-released` NOTE and checks a retry by that stored key.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReviewQueue, type EnqueueInput } from '../../src/coordination/review-queue.ts';
import type { ActorIdentity, Goal, ReviewRequest } from '../../src/core/types.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { hostName, shortKey } from '../../src/state/paths.ts';
import { atomicWriteJson, processAlive } from '../../src/state/store.ts';
import { goalForCards, makeFixture, writeCard, T0, type Fixture } from '../scenarios/_harness.ts';
import { fragmentEntry } from './changelog.ts';
import { cleanup, tmpDir } from './helpers.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
/** The CLI from the sources, never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const POOL = 'default';
const FAR = '2126-01-01T00:00:00.000Z';
const CARD = 'T1-HELD';

/**
 * A slot owner pid no process can hold (not the pid of an exited child, which Windows may hand out again: issue 312). It is
 * the largest pid `release` accepts (2**31-1, MAX_PID of src/coordination/review-queue.ts). Linux hands out pids up to
 * pid_max, at most 2**22, and Windows hands out multiples of 4, which this odd number is not.
 */
const DEAD_PID = 2 ** 31 - 1;
const deadOwner: ActorIdentity = { session: 'gone', pid: DEAD_PID, processStart: T0, host: hostName() };

const upper = (key: string): string => key.toUpperCase();
const slashed = (key: string): string => key.replaceAll('/', '\\');
const stored = (key: string): string => key;
const SPELLINGS = [['stored', stored], ['upper-case', upper], ['backslash', slashed]] as const;

const enqueueInput = (requester: string): EnqueueInput => ({ pool: POOL, repository: 'o/r', candidateDigest: 'digest', base: 'main', policyVersion: 'p', reviewer: 'r', requester, deadline: FAR, now: T0 });

/** A request admitted with the dead owner, its key holding a `/` and lower-case letters. */
function running(queue: ReviewQueue, requester: string): ReviewRequest {
  const key = queue.enqueue(enqueueInput(requester)).request.key;
  assert.equal(queue.admit(POOL, deadOwner, T0, key).status, 'admitted');
  const r = queue.get(key)!;
  assert.ok(r.key.includes('/') && r.key !== upper(r.key), `control: the key ${r.key} holds a / and lower-case letters`);
  assert.deepEqual(queue.pool(POOL).active, [r.key], 'control: the stored key holds the slot');
  return r;
}

function queueFor(t: TestContext): ReviewQueue {
  const dir = tmpDir('aidlc-qkey-');
  setActorForTests(deadOwner);
  t.after(() => {
    setActorForTests(undefined);
    cleanup(dir);
  });
  return new ReviewQueue(dir);
}

test('control: the dead owner pid is reported dead on this machine', () => {
  assert.equal(processAlive(DEAD_PID), false);
});

test('acceptance 1: hold, cancel and release free the slot of the stored key whatever spelling they are given [R1]', async (t) => {
  const settle = {
    hold: (q: ReviewQueue, key: string) => q.hold(key, FAR, 'quota', T0),
    cancel: (q: ReviewQueue, key: string) => q.cancel(key, 'cancelled', T0),
    release: (q: ReviewQueue, key: string) => q.release(key, 'owner gone', { now: T0 }),
  } as const;
  const settledState = { hold: 'retry-after', cancel: 'cancelled', release: 'cancelled' } as const;
  for (const method of ['hold', 'cancel', 'release'] as const) {
    for (const [name, spell] of SPELLINGS) {
      await t.test(`${method} with the ${name} spelling`, (t) => {
        const q = queueFor(t);
        const r = running(q, 'g-1:T1-A');
        const result = settle[method](q, spell(r.key));
        assert.equal(result?.key, r.key);
        assert.equal(q.get(r.key)?.state, settledState[method]);
        assert.deepEqual(q.pool(POOL).active, []);
      });
    }
  }
});

interface Rig { fx: Fixture; goal: Goal; cwd: string }

function rig(t: TestContext): Rig {
  const fx = makeFixture({ actor: deadOwner });
  t.after(() => {
    setActorForTests(undefined);
    cleanup(fx.tmp);
  });
  writeCard(fx, { id: CARD, title: 'held slot' });
  const goal = goalForCards(fx, [CARD]);
  return { fx, goal, cwd: realpathSync.native(fx.tmp) };
}

/** The inherited environment without NODE_, GIT_ and AIDLC_ variables or a session id, with the fixture's state directory. */
function childEnv(r: Rig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const up = name.toUpperCase();
    if (up.startsWith('NODE_') || up.startsWith('GIT_') || up.startsWith('AIDLC_') || up === 'CLAUDE_CODE_SESSION_ID') continue;
    env[name] = value;
  }
  return { ...env, GIT_CEILING_DIRECTORIES: [path.dirname(r.fx.tmp), path.dirname(r.cwd)].join(path.delimiter), AIDLC_STATE_DIR: r.fx.paths.root, AIDLC_SESSION: 'queue-key-test' };
}

function release(r: Rig, key: string): { status: number | null; stderr: string } {
  const res = spawnSync(process.execPath, [MAIN, 'review', 'release', key, '--reason', 'r'], { cwd: r.cwd, env: childEnv(r), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { status: res.status, stderr: res.stderr };
}

const releasedKeys = (r: Rig): unknown[] => r.fx.events(r.goal.id).filter((e) => e.type === 'NOTE' && e.data['kind'] === 'review-slot-released').map((e) => e.data['key']);
const requestPath = (r: Rig, key: string): string => path.join(r.fx.paths.reviewQueue, `${shortKey(key)}.json`);

test('acceptance 2: aidlc review release journals its NOTE under the stored key and a retry finds it [R2]', async (t) => {
  for (const [name, spell] of SPELLINGS) {
    await t.test(`the ${name} spelling journals one NOTE whose key is the stored key and frees its slot`, (t) => {
      const r = rig(t);
      const req = running(r.fx.queue, `${r.goal.id}:${CARD}`);
      const res = release(r, spell(req.key));
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(releasedKeys(r), [req.key]);
      assert.deepEqual(r.fx.queue.pool(POOL).active, []);
    });
  }
  const retries = [['upper-case', upper, 'stored', stored], ['upper-case', upper, 'upper-case', upper], ['stored', stored, 'backslash', slashed]] as const;
  for (const [firstName, first, retryName, retry] of retries) {
    await t.test(`a ${retryName} retry after a ${firstName} release that left the request running appends no second NOTE`, (t) => {
      const r = rig(t);
      const req = running(r.fx.queue, `${r.goal.id}:${CARD}`);
      assert.equal(release(r, first(req.key)).status, 0);
      atomicWriteJson(requestPath(r, req.key), req);
      const res = release(r, retry(req.key));
      assert.equal(res.status, 0, res.stderr);
      assert.equal(r.fx.queue.get(req.key)?.state, 'cancelled');
      assert.deepEqual(releasedKeys(r), [req.key]);
    });
  }
});

test('acceptance 4: the fragment of this card holds its entry [R3]', () => {
  assert.equal(
    fragmentEntry(ROOT, 'T0-REVIEW-QUEUE-KEY'),
    "- T0-REVIEW-QUEUE-KEY (bugfix, issue 304): `ReviewQueue.hold`, `cancel` and `release` free the slot of the request's stored key, and `aidlc review release` journals its `review-slot-released` NOTE and checks a retry by that stored key, so a key given in another letter case or with `\\` for `/` leaves no stale entry in the pool's `active` list and no second NOTE.",
  );
});
