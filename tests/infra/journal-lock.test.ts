/**
 * Card T0-JOURNAL-APPEND-LOCK: `Journal.append` reads the head and appends under one lock per journal file
 * (`<journal file>.append.lock`, taken through `updateJson` on a record path that is never written), so appenders in
 * separate processes keep one hash chain, and every way the lock refuses leaves the journal as it was.
 */
import { after, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs, { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Journal, setActorForTests } from '../../src/state/journal.ts';
import { StoreError } from '../../src/state/store.ts';
import { actor, cleanup, tmpDir } from './helpers.ts';

const CHILD = path.join(path.dirname(fileURLToPath(import.meta.url)), 'journal-lock.child.ts');
const ME = actor('lock-test', 4242);
/** A fixed owner time for lock files the test writes. */
const AT = '2026-11-11T00:00:00.000Z';
/** A pid no platform has (pid 1 is init on Linux, alive and unsignallable). */
const DEAD_PID = 999999999;

type FsName = 'readFileSync' | 'openSync' | 'appendFileSync' | 'writeFileSync';

/** Route one `node:fs` function through `wrap` while `body` runs (the ESM binding of a builtin follows the CJS export after a sync). */
function throughFs<T>(name: FsName, wrap: (real: (...args: unknown[]) => unknown, args: unknown[]) => unknown, body: () => T): T {
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

/** The outcome of `body`: its value, or the error it threw. */
function settle<T>(body: () => T): { value?: T; error?: unknown } {
  try {
    return { value: body() };
  } catch (error) {
    return { error };
  }
}

const eperm = (): Error => Object.assign(new Error('EPERM: operation not permitted, open'), { code: 'EPERM', syscall: 'open' });
const errno = (code: string): Error => Object.assign(new Error(`${code}: simulated`), { code });
const isLocked = (err: unknown): boolean => err instanceof StoreError && err.code === 'LOCKED';
const textOf = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
const lockOf = (j: Journal): string => `${j.file}.append.lock`;
const recordOf = (j: Journal): string => `${j.file}.append`;

/** The environment of a child appender: its own session, and no test-runner context. */
function childEnv(session: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_SESSION: session };
  delete env['NODE_TEST_CONTEXT'];
  return env;
}

interface ChildReport {
  returned: number;
  thrown: Array<{ code: string; syscall: string; file: string }>;
}

/** Run one child appender to its exit; resolves once the process has closed, whatever it did. */
function runChild(file: string, count: number, session: string): Promise<{ status: number | null; stdout: string; stderr: string; error?: Error }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CHILD, file, String(count)], { env: childEnv(session), timeout: 300_000, windowsHide: true });
    let stdout = '';
    let stderr = '';
    let error: Error | undefined;
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
    child.on('error', (err) => (error = err));
    child.on('close', (status) => resolve({ status, stdout, stderr, error }));
  });
}

/** A thrown append the card allows, with nothing appended: `LOCKED`, or the EPERM of the exclusive create of an absent lock path. */
function allowedRefusal(t: ChildReport['thrown'][number], lockName: string): boolean {
  return t.code === 'LOCKED' || (t.code === 'EPERM' && t.syscall === 'open' && t.file === lockName);
}

describe('T0-JOURNAL-APPEND-LOCK: Journal.append under one per-journal lock', () => {
  const dir = tmpDir();
  after(() => {
    cleanup(dir);
    setActorForTests(undefined);
  });
  let n = 0;
  /** A fresh journal in the test directory holding `events` NOTE events. */
  const journalWith = (events: number): Journal => {
    const j = new Journal(path.join(dir, `j${++n}.jsonl`));
    for (let i = 0; i < events; i++) j.append({ type: 'NOTE', actor: ME, data: { i } });
    return j;
  };

  it('four processes appending to one journal keep one hash chain [R1] [R2]', async () => {
    const j = new Journal(path.join(dir, 'contended.jsonl'));
    const results = await Promise.all([0, 1, 2, 3].map((i) => runChild(j.file, 150, `lock-child-${i}`)));
    const reports = results.map((r, i) => {
      assert.equal(r.error, undefined, `child ${i} started: ${String(r.error)}`);
      assert.equal(r.status, 0, `child ${i}: ${r.stderr}`);
      return JSON.parse(r.stdout.trim()) as ChildReport;
    });
    const returned = reports.reduce((sum, r) => sum + r.returned, 0);
    const thrown = reports.flatMap((r) => r.thrown);
    assert.deepEqual(thrown.filter((t) => !allowedRefusal(t, path.basename(lockOf(j)))), [], 'every thrown append is LOCKED or the absent-path EPERM');
    assert.equal(returned + thrown.length, 600, 'every append returned or threw');
    const v = j.verify();
    assert.deepEqual(v.problems, [], 'the chain verifies');
    assert.equal(v.ok, true);
    assert.equal(v.events, returned, 'every returned append is in the chain, and no refused one');
    assert.ok(returned >= 300, `at least 300 appends returned (${returned}; refused: ${JSON.stringify(thrown)})`);
    assert.equal(existsSync(lockOf(j)), false, 'no lock is left');
    assert.equal(existsSync(recordOf(j)), false, 'the lock record is never written');
  });

  it('an append started while another holds the lock between its head read and its append is refused [R1] [R2]', () => {
    const j = journalWith(3);
    let readHead: number | undefined;
    let child: ReturnType<typeof spawnSync> | undefined;
    // The head read of append A: the journal as A read it is returned, and the child starts before A appends.
    const event = throughFs('readFileSync', (real, args) => {
      const content = real(...args);
      if (child === undefined && String(args[0]) === j.file) {
        const lines = String(content).split('\n').filter((l) => l.trim());
        readHead = (JSON.parse(lines.at(-1)!) as { seq: number }).seq;
        child = spawnSync(process.execPath, [CHILD, j.file, '1'], { env: childEnv('lock-child-interleave'), encoding: 'utf8', timeout: 120_000, windowsHide: true });
      }
      return content;
    }, () => j.append({ type: 'NOTE', actor: ME, data: { a: true } }));
    assert.ok(child, 'the child ran during the head read');
    assert.equal(child.status, 0, String(child.stderr));
    const report = JSON.parse(String(child.stdout).trim()) as ChildReport;
    assert.deepEqual({ returned: report.returned, codes: report.thrown.map((t) => t.code) }, { returned: 0, codes: ['LOCKED'] }, 'the child waited out its deadline and appended nothing');
    assert.equal(readHead, 2);
    assert.equal(event.seq, readHead + 1, "A's event follows the head A read");
    const v = j.verify();
    assert.deepEqual(v.problems, []);
    assert.equal(v.events, 4);
  });

  it('a held journal lock refuses with LOCKED after the deadline and is left in place [R2] [R5]', () => {
    const j = journalWith(2);
    const before = readFileSync(j.file, 'utf8');
    const live = `pid=${process.pid} at=${AT} nonce=0badc0de`;
    writeFileSync(lockOf(j), live, 'utf8');
    const started = Date.now();
    const refused = settle(() => j.append({ type: 'NOTE', actor: ME }));
    const waited = Date.now() - started;
    assert.ok(isLocked(refused.error), `LOCKED: ${String(refused.error)}`);
    const message = (refused.error as Error).message;
    assert.ok(message.includes(`locked by another writer (${live}); run the command again`), message);
    assert.ok(message.includes(`(${recordOf(j)})`), `the record path is named: ${message}`);
    assert.ok(waited >= 1_900, `refused at the 2 s deadline, not before (${waited} ms)`);
    assert.equal(readFileSync(j.file, 'utf8'), before, 'the journal is byte for byte unchanged');
    assert.equal(textOf(lockOf(j)), live, 'the live lock keeps its text');

    const dead = `pid=${DEAD_PID} at=${AT} nonce=dead`;
    writeFileSync(lockOf(j), dead, 'utf8');
    const crashed = settle(() => j.append({ type: 'NOTE', actor: ME }));
    assert.ok(isLocked(crashed.error), `LOCKED: ${String(crashed.error)}`);
    const lock = lockOf(j);
    assert.ok((crashed.error as Error).message.includes(`${lock} is locked by pid ${DEAD_PID}, which is no longer running; delete ${lock} only once pid ${DEAD_PID} is confirmed dead, then run the command again`), (crashed.error as Error).message);
    assert.equal(textOf(lock), dead, "the dead owner's lock stays until the operator deletes it");
    assert.equal(readFileSync(j.file, 'utf8'), before);
    unlinkSync(lock);
  });

  it('an EPERM on the lock path is retried while the path exists and propagates at once while it is absent [R2]', () => {
    const j = journalWith(1);
    const lock = lockOf(j);
    // Another writer's lock is being deleted: its path exists until the deletion completes after the second refusal.
    writeFileSync(lock, `pid=${process.pid} at=${AT} nonce=deleting`, 'utf8');
    let failures = 2;
    const appended = throughFs('openSync', (real, args) => {
      if (String(args[0]) === lock && args[1] === 'wx') {
        if (failures-- > 0) throw eperm();
        if (existsSync(lock)) unlinkSync(lock);
      }
      return real(...args);
    }, () => j.append({ type: 'NOTE', actor: ME }));
    assert.equal(failures, -1, 'the create was retried after each EPERM');
    assert.equal(appended.seq, 1, 'then the lock was taken and the event appended');
    assert.equal(existsSync(lock), false);

    const before = readFileSync(j.file, 'utf8');
    const started = Date.now();
    const absent = settle(() => throughFs('openSync', (real, args) => {
      if (String(args[0]) === lock && args[1] === 'wx') throw eperm();
      return real(...args);
    }, () => j.append({ type: 'NOTE', actor: ME })));
    assert.equal((absent.error as NodeJS.ErrnoException | undefined)?.code, 'EPERM', `the EPERM propagates: ${String(absent.error)}`);
    assert.ok(Date.now() - started < 1_000, 'without waiting for the deadline');
    assert.equal(readFileSync(j.file, 'utf8'), before, 'the journal is unchanged');
    assert.equal(existsSync(lock), false);
  });

  it('a malformed head releases the journal lock [R3]', () => {
    for (const bad of ['not json', '{"seq":"x"}']) {
      const j = journalWith(2);
      const good = readFileSync(j.file, 'utf8');
      writeFileSync(j.file, `${good}${bad}\n`, 'utf8');
      const thrown = settle(() => j.append({ type: 'NOTE', actor: ME }));
      assert.ok(thrown.error !== undefined && !isLocked(thrown.error), `${bad}: the head read's error is rethrown: ${String(thrown.error)}`);
      assert.equal(existsSync(lockOf(j)), false, `${bad}: no lock file is left`);
      writeFileSync(j.file, good, 'utf8');
      assert.equal(j.append({ type: 'NOTE', actor: ME }).seq, 2, `${bad}: the next append takes the lock`);
      assert.equal(j.verify().ok, true);
    }
  });

  it('a failed append releases the journal lock (regression control) [R3]', () => {
    const j = journalWith(2);
    let failed = false;
    const thrown = settle(() => throughFs('appendFileSync', (real, args) => {
      if (!failed && String(args[0]) === j.file) {
        failed = true;
        throw errno('EIO');
      }
      return real(...args);
    }, () => j.append({ type: 'NOTE', actor: ME })));
    assert.equal((thrown.error as NodeJS.ErrnoException | undefined)?.code, 'EIO');
    assert.equal(existsSync(lockOf(j)), false, 'no lock file is left');
    assert.equal(j.append({ type: 'NOTE', actor: ME }).seq, 2, 'the next append returns the next seq');
    const v = j.verify();
    assert.deepEqual(v.problems, []);
    assert.equal(v.events, 3);
  });

  it('an append reached from inside another append of the same process is refused [R4]', () => {
    const j = new Journal(path.join(dir, 'nested.jsonl'));
    let inner: { value?: unknown; error?: unknown } | undefined;
    const outer = throughFs('appendFileSync', (real, args) => {
      if (inner === undefined && String(args[0]) === j.file) inner = settle(() => j.append({ type: 'NOTE', actor: ME, data: { inner: true } }));
      return real(...args);
    }, () => j.append({ type: 'NOTE', actor: ME, data: { outer: true } }));
    assert.ok(inner && isLocked(inner.error), `the inner append is refused with LOCKED: ${String(inner?.error)}`);
    assert.equal(outer.seq, 0, 'the outer append succeeds');
    assert.deepEqual(j.readAll().map((e) => e.data), [{ outer: true }], 'the journal holds one event');
  });

  it('the actor is resolved before the lock and ts is read inside it [R1] [R7]', () => {
    const stateDir = path.join(dir, 'fresh-state');
    const j = new Journal(path.join(dir, 'actor.jsonl'));
    const keys = ['AIDLC_SESSION', 'CLAUDE_CODE_SESSION_ID', 'AIDLC_STATE_DIR'] as const;
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    const order: string[] = [];
    try {
      delete process.env['AIDLC_SESSION'];
      delete process.env['CLAUDE_CODE_SESSION_ID'];
      process.env['AIDLC_STATE_DIR'] = stateDir;
      setActorForTests(undefined);
      throughFs('writeFileSync', (real, args) => {
        if (path.basename(String(args[0])) === 'session-default') order.push('session-default');
        return real(...args);
      }, () =>
        throughFs('openSync', (real, args) => {
          if (String(args[0]) === lockOf(j) && args[1] === 'wx') order.push('lock');
          return real(...args);
        }, () => j.append({ type: 'NOTE' })));
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      setActorForTests(undefined);
    }
    assert.deepEqual(order, ['session-default', 'lock'], 'session-default is written before the lock file is created');
    assert.equal(existsSync(recordOf(j)), false);
    for (let i = 0; i < 10; i++) {
      j.append({ type: 'NOTE', actor: ME, data: { i } });
      assert.equal(existsSync(recordOf(j)), false, `after append ${i + 1} no record file exists`);
    }
    const ts = j.readAll().map((e) => Date.parse(e.ts));
    assert.equal(ts.length, 11);
    for (let i = 1; i < ts.length; i++) assert.ok(ts[i]! >= ts[i - 1]!, `ts is non-decreasing along seq at seq ${i}`);

    // An append that has started and not yet taken the lock while another append lands after the clock has moved on: its
    // ts is read once it holds the lock, so it is no earlier than the event that landed first.
    const k = journalWith(1);
    let landed: { seq: number; ts: string } | undefined;
    let entered = false;
    const waiting = throughFs('openSync', (real, args) => {
      if (!entered && String(args[0]) === lockOf(k) && args[1] === 'wx') {
        entered = true;
        const from = Date.now();
        while (Date.now() < from + 2) {
          /* the clock moves past the waiting append's start */
        }
        landed = k.append({ type: 'NOTE', actor: ME, data: { first: true } });
      }
      return real(...args);
    }, () => k.append({ type: 'NOTE', actor: ME, data: { waiting: true } }));
    assert.ok(landed, 'the other append landed while this one waited for the lock');
    assert.equal(waiting.seq, landed.seq + 1);
    assert.ok(Date.parse(waiting.ts) >= Date.parse(landed.ts), `the waiting append's ts ${waiting.ts} is no earlier than ${landed.ts}`);
    assert.equal(k.verify().ok, true);
  });

  it('an implicit ts never moves back with the clock, and an explicit ts is recorded as given [R1]', () => {
    const j = new Journal(path.join(dir, 'clock.jsonl'));
    // The clock is the boundary: Date is mocked, so each append reads the time the test sets.
    mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-11T12:00:00.000Z') });
    const at = (iso: string, data: Record<string, unknown>, ts?: string) => {
      mock.timers.setTime(Date.parse(iso));
      return j.append({ type: 'NOTE', actor: ME, data, ...(ts ? { ts } : {}) }).ts;
    };
    try {
      assert.equal(at('2026-11-11T12:00:00.000Z', { c: 'no head' }), '2026-11-11T12:00:00.000Z', 'no head: the first event takes the clock reading');
      assert.equal(at('2026-11-11T11:59:00.000Z', { c: 'clock earlier' }), '2026-11-11T12:00:00.000Z', "the clock reads earlier than the head: the head's ts is used");
      assert.equal(at('2026-11-11T12:05:00.000Z', { c: 'clock later' }), '2026-11-11T12:05:00.000Z', 'the clock reads later: used as read');
      assert.equal(at('2026-11-11T12:05:00.000Z', { c: 'equal' }), '2026-11-11T12:05:00.000Z', 'equal readings: the same ts');
      assert.equal(at('2026-11-11T12:06:00.000Z', { c: 'explicit earlier' }, '2026-11-11T11:00:00.000Z'), '2026-11-11T11:00:00.000Z', 'an explicit ts is recorded as given, earlier than the head included');
      assert.equal(at('2026-11-11T11:30:00.000Z', { c: 'after explicit' }), '2026-11-11T11:30:00.000Z', 'the clock is compared with the head event only');
    } finally {
      mock.timers.reset();
    }
    // verify() checks seq, prevHash and hashes, not ts order: the chain with the explicit earlier ts verifies.
    const v = j.verify();
    assert.deepEqual(v.problems, []);
    assert.equal(v.events, 6);
  });
});
