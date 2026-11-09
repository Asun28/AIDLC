// Card T0-CARD-LEASE-HEARTBEAT: a PreToolUse or UserPromptSubmit event renews the card leases of the event's session that
// have less than half of their TTL left, and the renewal never changes the hook's decision, output or exit code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dispatchHook } from '../../src/hooks/entry.ts';
import { renewSessionCardLeases, type HookEvent } from '../../src/hooks/index.ts';
import { DEFAULT_LEASE_TTL_MS, LeaseStore, resourceKeys } from '../../src/coordination/lease.ts';
import { MINUTE_MS, addMs, type ActorIdentity, type Lease } from '../../src/core/types.ts';
import { hostName } from '../../src/state/paths.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = '2026-11-09T12:00:00.000Z';
const START = '2026-11-09T08:00:00.000Z';
const S: ActorIdentity = { session: 'sess-S', pid: 11, processStart: START, host: hostName() };
const T: ActorIdentity = { session: 'sess-T', pid: 12, processStart: START, host: hostName() };
const bash: HookEvent = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' }, session_id: 'sess-S' };
const key = (cardId: string): string => resourceKeys.card('repo', cardId);
/** The marker file name of a session: the first 16 hex of the sha256 of the session id. */
const marker = (session: string): string => createHash('sha256').update(session).digest('hex').slice(0, 16);
/** The UTC minute window of a time: floor(ms / 60 000). */
const windowOf = (at: string): number => Math.floor(Date.parse(at) / 60_000);

function withState<T>(fn: (s: { cwd: string; env: NodeJS.ProcessEnv; stateDir: string; leases: LeaseStore }) => T): T {
  const cwd = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-heartbeat-')));
  const stateDir = path.join(cwd, 'state');
  mkdirSync(path.join(stateDir, 'leases'), { recursive: true });
  try {
    return fn({ cwd, env: { PATH: process.env['PATH'], AIDLC_STATE_DIR: stateDir }, stateDir, leases: new LeaseStore(path.join(stateDir, 'leases')) });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

/** A card lease of `actor` claimed `ago` before NOW, so it has DEFAULT_LEASE_TTL_MS - ago left. */
function leaseOf(leases: LeaseStore, cardId: string, actor: ActorIdentity, ago: number): Lease {
  return leases.claim(key(cardId), { actor, now: addMs(NOW, -ago), operation: `card:${cardId}` }).lease;
}

const bytes = (leases: LeaseStore, cardId: string): string => readFileSync(leases.file(key(cardId)), 'utf8');

/** The hook result for the same event over a state directory without leases: the decision R1 must leave unchanged. */
function baseline(event: HookEvent): ReturnType<typeof dispatchHook> {
  return withState(({ cwd, env }) => dispatchHook(event, { cwd, env, now: NOW }));
}

test('T0-CARD-LEASE-HEARTBEAT acceptance 1: a PreToolUse Bash event of session S renews its leases with less than half the TTL left, expired included, and writes no other lease [R1]', () => {
  withState(({ cwd, env, leases }) => {
    const four = leaseOf(leases, 'T1-FOUR', S, 6 * MINUTE_MS);
    const expired = leaseOf(leases, 'T1-EXPIRED', S, 30 * MINUTE_MS);
    leaseOf(leases, 'T1-SIX', S, 4 * MINUTE_MS);
    leaseOf(leases, 'T1-RELEASED', S, 6 * MINUTE_MS);
    leases.release(key('T1-RELEASED'), 0, S);
    leaseOf(leases, 'T1-OTHER', T, 6 * MINUTE_MS);
    assert.equal(four.expiresAt, addMs(NOW, 4 * MINUTE_MS));
    assert.equal(expired.expiresAt, addMs(NOW, -20 * MINUTE_MS));
    const untouched = ['T1-SIX', 'T1-RELEASED', 'T1-OTHER'].map((id) => bytes(leases, id));

    const result = dispatchHook(bash, { cwd, env, now: NOW });

    assert.deepEqual(result, { exitCode: 0 });
    for (const [id, before] of [['T1-FOUR', four], ['T1-EXPIRED', expired]] as const) {
      const after = leases.read(key(id));
      assert.equal(after?.expiresAt, addMs(NOW, DEFAULT_LEASE_TTL_MS), `${id}: renewed to now + TTL`);
      assert.equal(after?.generation, before.generation, `${id}: same generation`);
      assert.equal(after?.owner.session, 'sess-S', `${id}: same owner`);
    }
    assert.deepEqual(['T1-SIX', 'T1-RELEASED', 'T1-OTHER'].map((id) => bytes(leases, id)), untouched, 'the lease with 6 minutes left, the released lease and the lease of T are not written');
  });
});

test('T0-CARD-LEASE-HEARTBEAT acceptance 2: a malformed lease, a lease taken over between the read and the write and a held lock leave the decision unchanged, print nothing and journal nothing [R2]', () => {
  const expected = baseline(bash);
  withState(({ cwd, env, stateDir, leases }) => {
    // malformed: not JSON, and JSON naming S that the lease schema refuses
    writeFileSync(path.join(leases.dir, 'garbage.json'), '{ not json', 'utf8');
    const invalid = JSON.stringify({ resourceKey: key('T1-INVALID'), generation: 0, owner: { ...S, processStart: 'not a time' }, acquiredAt: NOW, heartbeatAt: NOW, expiresAt: addMs(NOW, -MINUTE_MS), released: false });
    writeFileSync(leases.file(key('T1-INVALID')), invalid, 'utf8');
    // a held lock on an expired lease of S
    leaseOf(leases, 'T1-LOCKED', S, 30 * MINUTE_MS);
    const lockedBefore = bytes(leases, 'T1-LOCKED');
    const lock = `${leases.file(key('T1-LOCKED'))}.lock`;
    writeFileSync(lock, `pid=${process.pid} at=${NOW} nonce=held`, 'utf8');
    // a lease the hook still renews beside them
    leaseOf(leases, 'T1-GOOD', S, 6 * MINUTE_MS);
    // fenced: session T takes the lease over after the hook read it and before its heartbeat writes
    leaseOf(leases, 'T1-FENCED', S, 30 * MINUTE_MS);
    class TakenOverBetween extends LeaseStore {
      override heartbeat(resourceKey: string, generation: number, options: { ttlMs?: number; actor?: ActorIdentity; now?: string } = {}): Lease {
        if (resourceKey === key('T1-FENCED')) this.update(resourceKey, (e) => e && { ...e, generation: e.generation + 1, owner: T, acquiredAt: NOW, heartbeatAt: NOW, expiresAt: addMs(NOW, DEFAULT_LEASE_TTL_MS) });
        return super.heartbeat(resourceKey, generation, options);
      }
    }

    const result = dispatchHook(bash, { cwd, env, now: NOW, openLeases: (dir: string) => new TakenOverBetween(dir, { timeoutMs: 50 }) });

    assert.deepEqual(result, expected, 'the decision and output are those without R1');
    assert.equal(readFileSync(leases.file(key('T1-INVALID')), 'utf8'), invalid, 'the malformed lease is not written');
    assert.equal(bytes(leases, 'T1-LOCKED'), lockedBefore, 'the locked lease is skipped');
    assert.ok(existsSync(lock), 'the lock of another writer is left in place');
    const fenced = leases.read(key('T1-FENCED'));
    assert.deepEqual([fenced?.owner.session, fenced?.generation, fenced?.expiresAt], ['sess-T', 1, addMs(NOW, DEFAULT_LEASE_TTL_MS)], 'the takeover stands');
    assert.equal(leases.read(key('T1-GOOD'))?.expiresAt, addMs(NOW, DEFAULT_LEASE_TTL_MS), 'a failing lease skips that lease only');
    assert.equal(existsSync(path.join(stateDir, 'journal')), false, 'no journal is written');
    unlinkSync(lock);
  });
});

test('T0-CARD-LEASE-HEARTBEAT acceptance 2: the hook process with a malformed lease and a held lock of an expiring lease of its session exits 0 and prints nothing [R2]', () => {
  withState(({ stateDir, leases }) => {
    writeFileSync(path.join(leases.dir, 'garbage.json'), '{ not json', 'utf8');
    leaseOf(leases, 'T1-LOCKED', S, 30 * MINUTE_MS);
    const before = bytes(leases, 'T1-LOCKED');
    writeFileSync(`${leases.file(key('T1-LOCKED'))}.lock`, `pid=${process.pid} at=${NOW} nonce=held`, 'utf8');
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      const upper = k.toUpperCase();
      if (upper.startsWith('AIDLC_') || ['CLAUDE_CODE_SESSION_ID', 'RELEASE_APPROVAL', 'NODE_OPTIONS'].includes(upper)) continue;
      env[k] = v;
    }
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'aidlc-hook.js')], {
      cwd: root,
      input: JSON.stringify({ ...bash, cwd: root }),
      env: { ...env, AIDLC_STATE_DIR: stateDir },
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
    assert.equal(bytes(leases, 'T1-LOCKED'), before);
    assert.equal(existsSync(path.join(stateDir, 'journal')), false, 'no journal is written');
  });
});

test('T0-CARD-LEASE-HEARTBEAT acceptance 3: a UserPromptSubmit event of session S renews its expiring lease [R1]', () => {
  withState(({ cwd, env, leases }) => {
    const four = leaseOf(leases, 'T1-FOUR', S, 6 * MINUTE_MS);
    dispatchHook({ hook_event_name: 'UserPromptSubmit', prompt: 'what is left on this card?', session_id: 'sess-S' }, { cwd, env, now: NOW });
    const after = leases.read(key('T1-FOUR'));
    assert.deepEqual([after?.expiresAt, after?.generation], [addMs(NOW, DEFAULT_LEASE_TTL_MS), four.generation]);
  });
});

test('T0-CARD-LEASE-HEARTBEAT acceptance 8: one marker per session holds the minute window of its last scan; the same or an older window does not scan, the next one does, and a state without a leases directory gets nothing [R3]', () => {
  withState(({ cwd, env, stateDir, leases }) => {
    const markerFile = path.join(stateDir, 'heartbeat', marker('sess-S'));
    leaseOf(leases, 'T1-FIRST', S, 6 * MINUTE_MS);
    dispatchHook(bash, { cwd, env, now: NOW });
    assert.equal(leases.read(key('T1-FIRST'))?.expiresAt, addMs(NOW, DEFAULT_LEASE_TTL_MS), 'an event with no marker scans and renews');
    assert.equal(readFileSync(markerFile, 'utf8'), String(windowOf(NOW)), 'the marker holds the current window');
    leaseOf(leases, 'T1-LATE', S, 6 * MINUTE_MS);
    const before = bytes(leases, 'T1-LATE');
    dispatchHook(bash, { cwd, env, now: addMs(NOW, 30_000) });
    assert.equal(bytes(leases, 'T1-LATE'), before, 'the same window renews nothing');
    dispatchHook(bash, { cwd, env, now: addMs(NOW, -MINUTE_MS) });
    assert.equal(bytes(leases, 'T1-LATE'), before, 'an older window (a delayed hook) does not scan');
    dispatchHook(bash, { cwd, env, now: addMs(NOW, 61_000) });
    assert.equal(leases.read(key('T1-LATE'))?.expiresAt, addMs(NOW, 61_000 + DEFAULT_LEASE_TTL_MS), 'the next window scans');
    dispatchHook(bash, { cwd, env, now: addMs(NOW, 2 * MINUTE_MS) });
    assert.deepEqual(readdirSync(path.join(stateDir, 'heartbeat')), [marker('sess-S')], 'one file per session after scans in three windows');
    assert.equal(readFileSync(markerFile, 'utf8'), String(windowOf(addMs(NOW, 2 * MINUTE_MS))));
  });
  withState(({ cwd, env, stateDir }) => {
    rmSync(path.join(stateDir, 'leases'), { recursive: true });
    dispatchHook(bash, { cwd, env, now: NOW });
    assert.deepEqual(readdirSync(stateDir), [], 'a state root without leases/ gets no heartbeat directory or file');
    const absent = path.join(cwd, 'absent-state');
    dispatchHook(bash, { cwd, env: { ...env, AIDLC_STATE_DIR: absent }, now: NOW });
    assert.equal(existsSync(absent), false, 'an absent state root is not created');
  });
});

test('T0-CARD-LEASE-HEARTBEAT acceptance 9: a lease released between the scan and the heartbeat stays released with its old expiry [R1] [R2]', () => {
  withState(({ cwd, env, leases }) => {
    const due = leaseOf(leases, 'T1-RELEASED-MEANWHILE', S, 6 * MINUTE_MS);
    class ReleasedBetween extends LeaseStore {
      override heartbeat(resourceKey: string, generation: number, options: { ttlMs?: number; actor?: ActorIdentity; now?: string } = {}): Lease {
        this.release(resourceKey, generation, S);
        return super.heartbeat(resourceKey, generation, options);
      }
    }
    const result = dispatchHook(bash, { cwd, env, now: NOW, openLeases: (dir: string) => new ReleasedBetween(dir, { timeoutMs: 50 }) });
    assert.deepEqual(result, { exitCode: 0 });
    const after = leases.read(key('T1-RELEASED-MEANWHILE'));
    assert.deepEqual([after?.released, after?.expiresAt], [true, due.expiresAt]);
  });
});

test('T0-CARD-LEASE-HEARTBEAT acceptance 10: a PreToolUse event that no guard handles (Read) renews the session lease [R1]', () => {
  withState(({ cwd, env, leases }) => {
    leaseOf(leases, 'T1-FOUR', S, 6 * MINUTE_MS);
    const result = dispatchHook({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'README.md' }, session_id: 'sess-S' }, { cwd, env, now: NOW });
    assert.deepEqual(result, { exitCode: 0 });
    assert.equal(leases.read(key('T1-FOUR'))?.expiresAt, addMs(NOW, DEFAULT_LEASE_TTL_MS));
  });
});

test('T0-CARD-LEASE-HEARTBEAT acceptance 11: a scanning event lists only the leases directory, and a skipped event lists none [R3]', () => {
  withState(({ cwd, env, leases }) => {
    leaseOf(leases, 'T1-OTHER-1', T, 6 * MINUTE_MS);
    leaseOf(leases, 'T1-OTHER-2', T, 2 * MINUTE_MS);
    leaseOf(leases, 'T1-MINE', S, 6 * MINUTE_MS);
    const listed: string[] = [];
    const original = fs.readdirSync;
    fs.readdirSync = ((dir: fs.PathLike, ...rest: unknown[]) => {
      listed.push(path.resolve(String(dir)));
      return (original as (...args: unknown[]) => unknown)(dir, ...rest);
    }) as typeof fs.readdirSync;
    syncBuiltinESMExports();
    let scanning: string[];
    let skipped: string[];
    try {
      renewSessionCardLeases(bash, cwd, env, NOW);
      scanning = listed.splice(0);
      renewSessionCardLeases(bash, cwd, env, addMs(NOW, 30_000));
      skipped = listed.splice(0);
    } finally {
      fs.readdirSync = original;
      syncBuiltinESMExports();
    }
    assert.deepEqual(scanning, [path.resolve(leases.dir)], 'a scanning event lists the leases directory once');
    assert.deepEqual(skipped, [], 'a skipped event lists nothing');
    assert.equal(leases.read(key('T1-MINE'))?.expiresAt, addMs(NOW, DEFAULT_LEASE_TTL_MS));
  });
});

test('T0-CARD-LEASE-HEARTBEAT R1: a Stop event of session S leaves its due lease unwritten [R1]', () => {
  withState(({ cwd, env, leases }) => {
    leaseOf(leases, 'T1-DUE', S, 6 * MINUTE_MS);
    const before = bytes(leases, 'T1-DUE');
    dispatchHook({ hook_event_name: 'Stop', session_id: 'sess-S' }, { cwd, env, now: NOW });
    assert.equal(bytes(leases, 'T1-DUE'), before);
  });
});

test('T0-CARD-LEASE-HEARTBEAT-2 acceptance 12: the per-guard entry `aidlc hook protect-paths` renews the session lease and answers as it does with no lease [R1] [R2]', () => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    if (upper.startsWith('AIDLC_') || ['CLAUDE_CODE_SESSION_ID', 'RELEASE_APPROVAL', 'NODE_OPTIONS'].includes(upper)) continue;
    env[k] = v;
  }
  const guard = (stateDir: string) =>
    spawnSync(process.execPath, [path.join(root, 'src', 'cli', 'main.ts'), 'hook', 'protect-paths'], {
      cwd: root,
      input: JSON.stringify({ ...bash, cwd: root }),
      env: { ...env, AIDLC_STATE_DIR: stateDir },
      encoding: 'utf8',
      windowsHide: true,
    });
  const without = withState(({ stateDir }) => guard(stateDir));
  withState(({ stateDir, leases }) => {
    // the child runs on the real clock: a lease that expired in 2020 is due whatever the time
    const old = leases.claim(key('T1-DUE'), { actor: S, now: '2019-12-31T23:50:00.000Z', operation: 'card:T1-DUE' }).lease;
    assert.equal(old.expiresAt, '2020-01-01T00:00:00.000Z');
    const r = guard(stateDir);
    assert.deepEqual([r.status, r.stdout], [without.status, without.stdout], 'the guard answers as with no lease');
    const after = leases.read(key('T1-DUE'));
    assert.ok(after && Date.parse(after.expiresAt) > Date.parse(old.expiresAt), `renewed: ${after?.expiresAt}`);
    assert.equal(after?.generation, old.generation);
  });
});
