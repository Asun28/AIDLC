import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs, { existsSync, readdirSync, readFileSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { StoreError, updateJson } from '../../src/state/store.ts';
import { cleanup, tmpDir } from './helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Rec = z.object({ id: z.string(), n: z.number().int() });
/** A lock file's mtime far beyond any stale age, fixed rather than read from the clock. */
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z');
/** A record as another tool writes it (compact JSON): any write by `updateJson` re-serializes it, so equal bytes prove that nothing was written. */
const STORED = '{"id":"x","n":1}';
const isCode = (code: string) => (err: unknown) => err instanceof StoreError && err.code === code;

/** Route every exclusive create (`wx`) of `lock` through `before` first (the ESM binding of a builtin follows the CJS export after a sync). */
function onExclusiveCreate<T>(lock: string, before: () => void, body: () => T): T {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['openSync']!;
  target['openSync'] = (...args: unknown[]) => {
    if (String(args[0]) === lock && args[1] === 'wx') before();
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    return body();
  } finally {
    target['openSync'] = real;
    syncBuiltinESMExports();
  }
}

const eperm = (): Error => Object.assign(new Error('EPERM: operation not permitted, open'), { code: 'EPERM' });

describe('state/store updateJson (T1-STORE-CAS acceptance 1)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));
  const seed = (name: string): string => {
    const file = path.join(dir, name);
    writeFileSync(file, STORED, 'utf8');
    return file;
  };

  it('hands the change the stored record, writes its result and releases the lock', () => {
    const file = seed('write.json');
    assert.deepEqual(updateJson(file, Rec, (current) => ({ ...current!, n: current!.n + 1 })), { id: 'x', n: 2 });
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { id: 'x', n: 2 });
    assert.ok(!existsSync(`${file}.lock`), 'the lock is released');
  });

  it('a live lock refuses with StoreError LOCKED before the change runs and leaves the record byte-identical', () => {
    const file = seed('live.json');
    const lock = `${file}.lock`;
    writeFileSync(lock, `pid=${process.pid} at=2026-09-26T00:00:00.000Z nonce=live`, 'utf8');
    let entered = false;
    assert.throws(
      () => updateJson(file, Rec, (current) => { entered = true; return { ...current!, n: 9 }; }, { timeoutMs: 50 }),
      (err: unknown) => isCode('LOCKED')(err) && /locked by another writer \(pid=\d+ at=2026-09-26T00:00:00\.000Z nonce=live\); run the command again/.test((err as Error).message),
    );
    assert.equal(entered, false, 'the change never runs without the lock');
    assert.equal(readFileSync(file, 'utf8'), STORED);
    assert.ok(existsSync(lock), 'a live lock is never removed by a waiter');
    unlinkSync(lock);
  });

  it('a change that throws writes nothing and releases the lock', () => {
    const file = seed('throw.json');
    assert.throws(() => updateJson(file, Rec, () => { throw new Error('refused'); }), /refused/);
    assert.equal(readFileSync(file, 'utf8'), STORED);
    assert.ok(!existsSync(`${file}.lock`));
  });

  it('a change that returns the record it received, or nothing, writes nothing and returns the stored record', () => {
    const file = seed('same.json');
    assert.deepEqual(updateJson(file, Rec, (current) => current), { id: 'x', n: 1 });
    assert.equal(readFileSync(file, 'utf8'), STORED, 'the unchanged record is not rewritten');
    assert.deepEqual(updateJson(file, Rec, () => undefined), { id: 'x', n: 1 });
    assert.equal(readFileSync(file, 'utf8'), STORED, 'no record to write, nothing written');
    const absent = path.join(dir, 'absent.json');
    assert.equal(updateJson(absent, Rec, (current) => current), undefined);
    assert.ok(!existsSync(absent) && !existsSync(`${absent}.lock`), 'no record is created and the lock is released');
  });

  it('a stale lock whose owner process is gone is taken over, and so is a stale takeover marker; a live owner keeps its lock however old', () => {
    const file = seed('stale.json');
    const lock = `${file}.lock`;
    // A crashed writer names a pid no platform has (pid 1 is init on Linux, alive and unsignallable).
    writeFileSync(lock, 'pid=999999999 at=2020-01-01T00:00:00.000Z nonce=dead', 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    assert.deepEqual(updateJson(file, Rec, (current) => ({ ...current!, n: 2 })), { id: 'x', n: 2 });
    assert.ok(!existsSync(lock) && !existsSync(`${lock}.takeover`), 'the stale lock and the takeover marker are gone');
    writeFileSync(lock, 'pid=999999999 at=2020-01-01T00:00:00.000Z nonce=dead', 'utf8');
    writeFileSync(`${lock}.takeover`, 'pid=999999998 at=2020-01-01T00:00:00.000Z nonce=taker', 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    utimesSync(`${lock}.takeover`, LONG_AGO, LONG_AGO);
    assert.deepEqual(updateJson(file, Rec, (current) => ({ ...current!, n: 3 })), { id: 'x', n: 3 });
    assert.ok(!existsSync(lock) && !existsSync(`${lock}.takeover`));
    writeFileSync(lock, `pid=${process.pid} at=2020-01-01T00:00:00.000Z nonce=old-live`, 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    assert.throws(() => updateJson(file, Rec, (current) => ({ ...current!, n: 4 }), { timeoutMs: 50, staleMs: 10 }), isCode('LOCKED'));
    assert.ok(existsSync(lock), 'the live owner keeps its lock');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { id: 'x', n: 3 });
    unlinkSync(lock);
  });

  it('a lock that changed hands during the change refuses the write with LOCK_LOST and leaves the new owner its lock', () => {
    const file = seed('lost.json');
    const lock = `${file}.lock`;
    assert.throws(
      () => updateJson(file, Rec, (current) => { writeFileSync(lock, 'pid=other at=now nonce=new', 'utf8'); return { ...current!, n: 2 }; }),
      (err: unknown) => isCode('LOCK_LOST')(err) && /nothing written, run the command again/.test((err as Error).message),
    );
    assert.equal(readFileSync(file, 'utf8'), STORED);
    assert.equal(readFileSync(lock, 'utf8'), 'pid=other at=now nonce=new', "the other owner's lock is left in place");
    unlinkSync(lock);
  });

  it('an exclusive create that fails with EPERM (Windows, a lock being deleted) is busy: retried until the deadline, then LOCKED', () => {
    const file = seed('eperm.json');
    const lock = `${file}.lock`;
    let failures = 2;
    const written = onExclusiveCreate(lock, () => { if (failures-- > 0) throw eperm(); }, () => updateJson(file, Rec, (current) => ({ ...current!, n: 2 })));
    assert.deepEqual(written, { id: 'x', n: 2 }, 'two EPERM refusals, then the lock is taken');
    assert.equal(failures, -1, 'the create was retried after each EPERM');
    assert.throws(() => onExclusiveCreate(lock, () => { throw eperm(); }, () => updateJson(file, Rec, (current) => ({ ...current!, n: 3 }), { timeoutMs: 50 })), isCode('LOCKED'));
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { id: 'x', n: 2 });
  });
});

/** Every TypeScript file under `dir`, as a repository-relative path with forward slashes. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? sourceFiles(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : []))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
}

describe('one lock primitive in src (T1-STORE-CAS acceptance 2)', () => {
  it("exclusive create ('wx'), sleepSync and Atomics.wait appear only in src/state/store.ts, the ship's CI poll sleep excepted by name, and mergeFindings nowhere", () => {
    const files = sourceFiles(path.join(root, 'src'));
    assert.ok(files.length > 40, `src resolved to ${files.length} files`);
    const text = (file: string) => readFileSync(path.join(root, file), 'utf8');
    const where = (pattern: RegExp) => files.filter((file) => pattern.test(text(file)));
    assert.deepEqual(where(/['"`]wx['"`]/), ['src/state/store.ts']);
    assert.deepEqual(where(/sleepSync/), ['src/state/store.ts']);
    assert.deepEqual(where(/Atomics\.wait/), ['src/delivery/github-ship.ts', 'src/state/store.ts']);
    // The one exception: the CI poll's default sleep in the GitHub ship path, between two check-run polls.
    assert.deepEqual(text('src/delivery/github-ship.ts').split(/\r?\n/).filter((line) => line.includes('Atomics.wait')).map((line) => line.trim().split(' = ')[0]), ['const sleep']);
    assert.deepEqual(where(/mergeFindings/), []);
  });
});
