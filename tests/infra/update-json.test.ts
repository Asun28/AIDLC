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

/** Route one `node:fs` function through `wrap` while `body` runs: the boundary every lock step passes. */
function throughFs<T>(name: 'readFileSync' | 'statSync' | 'unlinkSync' | 'openSync', wrap: (real: (...args: unknown[]) => unknown, args: unknown[]) => unknown, body: () => T): T {
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

/** The text of a file, undefined when it is gone. */
const textOf = (file: string): string | undefined => (existsSync(file) ? readFileSync(file, 'utf8') : undefined);
const errno = (code: string) => Object.assign(new Error(`${code}: simulated`), { code });

describe('state/store updateJson (T1-STORE-CAS-2 acceptance 1)', () => {
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

  it('a young lock is never taken over, even when its owner process is gone: the waiter refuses at the deadline', () => {
    const file = seed('young.json');
    const lock = `${file}.lock`;
    writeFileSync(lock, 'pid=999999999 at=2026-09-26T00:00:00.000Z nonce=young', 'utf8');
    assert.throws(() => updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 }), isCode('LOCKED'));
    assert.ok(existsSync(lock), 'a lock younger than the stale age stays');
    assert.equal(readFileSync(file, 'utf8'), STORED);
    unlinkSync(lock);
  });

  it('the takeover re-checks the lock under its marker: a stale lock replaced by a live one meanwhile is left to its new owner', () => {
    const file = seed('recheck.json');
    const lock = `${file}.lock`;
    writeFileSync(lock, 'pid=999999999 at=2020-01-01T00:00:00.000Z nonce=dead', 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    // Right before this waiter takes the takeover marker, another waiter has removed the stale lock and a live writer has locked.
    let replaced = false;
    const live = `pid=${process.pid} at=2026-09-26T00:00:00.000Z nonce=new-owner`;
    const replace = () => { if (!replaced) { replaced = true; writeFileSync(lock, live, 'utf8'); } };
    let entered = false;
    assert.throws(() => onExclusiveCreate(`${lock}.takeover`, replace, () => updateJson(file, Rec, (current) => { entered = true; return { ...current!, n: 2 }; }, { timeoutMs: 50 })), isCode('LOCKED'));
    assert.ok(replaced, 'the waiter went for the takeover marker');
    assert.equal(entered, false);
    assert.equal(readFileSync(lock, 'utf8'), live, "the new owner's lock is left in place");
    assert.ok(!existsSync(`${lock}.takeover`), 'the marker is released');
    unlinkSync(lock);
  });

  it('an exclusive create that fails for another reason (EACCES) propagates at once instead of waiting for the deadline', () => {
    const file = seed('eacces.json');
    const lock = `${file}.lock`;
    const eacces = (): Error => Object.assign(new Error('EACCES: permission denied, open'), { code: 'EACCES' });
    assert.throws(() => onExclusiveCreate(lock, () => { throw eacces(); }, () => updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 })), (err: unknown) => (err as NodeJS.ErrnoException).code === 'EACCES');
    assert.equal(readFileSync(file, 'utf8'), STORED);
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

  it('an exclusive create that fails with EPERM while the lock path exists (Windows, a lock being deleted) is busy: retried until the deadline, then LOCKED', () => {
    const file = seed('eperm.json');
    const lock = `${file}.lock`;
    // Another writer's lock is being deleted: its path exists until the deletion completes after the second refusal.
    writeFileSync(lock, `pid=${process.pid} at=2026-09-26T00:00:00.000Z nonce=deleting`, 'utf8');
    let failures = 2;
    const deleting = () => {
      if (failures-- > 0) throw eperm();
      if (existsSync(lock)) unlinkSync(lock);
    };
    const written = onExclusiveCreate(lock, deleting, () => updateJson(file, Rec, (current) => ({ ...current!, n: 2 })));
    assert.deepEqual(written, { id: 'x', n: 2 }, 'two EPERM refusals, then the lock is taken');
    assert.equal(failures, -1, 'the create was retried after each EPERM');
    writeFileSync(lock, `pid=${process.pid} at=2026-09-26T00:00:00.000Z nonce=deleting`, 'utf8');
    assert.throws(() => onExclusiveCreate(lock, () => { throw eperm(); }, () => updateJson(file, Rec, (current) => ({ ...current!, n: 3 }), { timeoutMs: 50 })), isCode('LOCKED'));
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { id: 'x', n: 2 });
    unlinkSync(lock);
  });
});

/** Every TypeScript file under `dir`, as a repository-relative path with forward slashes. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? sourceFiles(path.join(dir, entry.name)) : entry.name.endsWith('.ts') ? [path.join(dir, entry.name)] : []))
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort();
}

describe('one lock primitive in src (T1-STORE-CAS-2 acceptance 2)', () => {
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

describe('state/store updateJson lock ownership (T1-STORE-CAS-2)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));
  const seed = (name: string): string => {
    const file = path.join(dir, name);
    writeFileSync(file, STORED, 'utf8');
    return file;
  };
  const DEAD = 'pid=999999999 at=2020-01-01T00:00:00.000Z nonce=dead';
  const LIVE = `pid=${process.pid} at=2026-09-27T00:00:00.000Z nonce=live-writer`;

  it('acceptance 13: a takeover marker older than the stale age whose owner process is alive is left in place, and so is the stale lock behind it [R7]', () => {
    const file = seed('live-marker.json');
    const lock = `${file}.lock`;
    const marker = `${lock}.takeover`;
    const taker = `pid=${process.pid} at=2020-01-01T00:00:00.000Z nonce=suspended-taker`;
    writeFileSync(lock, DEAD, 'utf8');
    writeFileSync(marker, taker, 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    utimesSync(marker, LONG_AGO, LONG_AGO);
    const outcome = settle(() => updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 }));
    assert.equal(textOf(marker), taker, "the suspended taker's marker stays");
    assert.equal(textOf(lock), DEAD, 'the stale lock is left to the taker that holds the marker');
    assert.ok(isCode('LOCKED')(outcome.error), `the waiter refuses at the deadline: ${String(outcome.error)}`);
    assert.equal(readFileSync(file, 'utf8'), STORED);
    unlinkSync(marker);
    unlinkSync(lock);
  });

  it('acceptance 13: a takeover marker whose owner process is gone is reclaimed and the stale lock behind it taken over [R7]', () => {
    const file = seed('dead-marker.json');
    const lock = `${file}.lock`;
    const marker = `${lock}.takeover`;
    writeFileSync(lock, DEAD, 'utf8');
    writeFileSync(marker, 'pid=999999998 at=2020-01-01T00:00:00.000Z nonce=crashed-taker', 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    utimesSync(marker, LONG_AGO, LONG_AGO);
    assert.deepEqual(updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 1_000 }), { id: 'x', n: 2 });
    assert.equal(textOf(marker), undefined);
    assert.equal(textOf(lock), undefined);
  });

  it('acceptance 13: a waiter holding the marker never removes a lock that a live writer holds by the time it removes, nor a marker another waiter holds by the time it releases [R7]', () => {
    // The lock is judged stale under the marker, then a live writer's lock replaces it before the removal.
    const file = seed('replaced-lock.json');
    const lock = `${file}.lock`;
    const marker = `${lock}.takeover`;
    writeFileSync(lock, DEAD, 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    let holding = false;
    let replaced = false;
    const outcome = settle(() =>
      throughFs(
        'openSync',
        (real, args) => {
          const fd = real(...args);
          if (String(args[0]) === marker && args[1] === 'wx') holding = true;
          return fd;
        },
        () =>
          throughFs(
            'readFileSync',
            (real, args) => {
              const out = real(...args);
              if (holding && !replaced && String(args[0]) === lock) {
                replaced = true;
                writeFileSync(lock, LIVE, 'utf8');
              }
              return out;
            },
            () => updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 }),
          ),
      ),
    );
    assert.ok(replaced, 'the lock was replaced after the waiter judged it under the marker');
    assert.equal(textOf(lock), LIVE, "the live writer's lock is never removed");
    assert.ok(isCode('LOCKED')(outcome.error), `the waiter refuses at the deadline: ${String(outcome.error)}`);
    assert.equal(textOf(marker), undefined, 'the waiter releases its own marker');
    unlinkSync(lock);
    // The marker changes hands while its first holder removes the stale lock: the release leaves the other waiter's marker.
    const file2 = seed('replaced-marker.json');
    const lock2 = `${file2}.lock`;
    const marker2 = `${lock2}.takeover`;
    const other = `pid=${process.pid} at=2026-09-27T00:00:00.000Z nonce=other-waiter`;
    writeFileSync(lock2, DEAD, 'utf8');
    utimesSync(lock2, LONG_AGO, LONG_AGO);
    let swapped = false;
    const written = throughFs(
      'unlinkSync',
      (real, args) => {
        if (!swapped && String(args[0]) === lock2) {
          swapped = true;
          writeFileSync(marker2, other, 'utf8');
        }
        return real(...args);
      },
      () => updateJson(file2, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 1_000 }),
    );
    assert.ok(swapped);
    assert.deepEqual(written, { id: 'x', n: 2 });
    assert.equal(textOf(marker2), other, "the other waiter's marker is never removed");
    unlinkSync(marker2);
  });

  it('acceptance 14: a lock file that cannot be read at the ownership check or the release leaves the change its result [R8]', () => {
    const file = seed('unreadable.json');
    const lock = `${file}.lock`;
    let changed = false;
    const unreadable = (real: (...args: unknown[]) => unknown, args: unknown[]) => {
      if (changed && String(args[0]) === lock) throw errno('EACCES');
      return real(...args);
    };
    const wrote = settle(() => throughFs('readFileSync', unreadable, () => updateJson(file, Rec, (current) => { changed = true; return { ...current!, n: 2 }; })));
    assert.deepEqual(wrote, { value: { id: 'x', n: 2 } }, 'the change returned a record: that record is the result, written');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { id: 'x', n: 2 });
    if (existsSync(lock)) unlinkSync(lock);
    changed = false;
    const refused = settle(() => throughFs('readFileSync', unreadable, () => updateJson(file, Rec, () => { changed = true; throw new Error('the change refused'); })));
    assert.match(String(refused.error), /the change refused/, "the change's own error is the result");
    if (existsSync(lock)) unlinkSync(lock);
    // The release cannot remove the lock (EBUSY): the result still stands.
    const busy = settle(() => throughFs('unlinkSync', (real, args) => { if (String(args[0]) === lock) throw errno('EBUSY'); return real(...args); }, () => updateJson(file, Rec, (current) => ({ ...current!, n: 3 }))));
    assert.deepEqual(busy, { value: { id: 'x', n: 3 } }, 'a failed release never replaces the result');
    if (existsSync(lock)) unlinkSync(lock);
  });

  it('acceptance 15: an exclusive create that fails with EPERM while the lock path does not exist propagates at once [R9]', () => {
    const file = seed('eperm-absent.json');
    const lock = `${file}.lock`;
    const started = Date.now();
    const outcome = settle(() => onExclusiveCreate(lock, () => { throw eperm(); }, () => updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 1_000 })));
    assert.equal((outcome.error as NodeJS.ErrnoException | undefined)?.code, 'EPERM', `the EPERM propagates: ${String(outcome.error)}`);
    assert.ok(Date.now() - started < 900, 'without waiting for the deadline');
    assert.equal(readFileSync(file, 'utf8'), STORED);
  });

  it('acceptance 15: a lock whose stat fails with EPERM exists (Windows, being deleted): the waiter treats it as held and refuses with LOCKED [R9]', () => {
    const file = seed('eperm-stat.json');
    const lock = `${file}.lock`;
    writeFileSync(lock, LIVE, 'utf8');
    const outcome = settle(() => throughFs('statSync', (real, args) => { if (String(args[0]) === lock) throw errno('EPERM'); return real(...args); }, () => updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 })));
    assert.ok(isCode('LOCKED')(outcome.error), `LOCKED, not the stat error: ${String(outcome.error)}`);
    unlinkSync(lock);
  });
});

describe('state/store updateJson: a lock being deleted (T1-STORE-CAS-2 sweep)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));

  it('a lock whose stat fails with EPERM is fresh however it names a dead owner: never taken over, the waiter refuses with LOCKED [R9]', () => {
    const file = path.join(dir, 'deleting.json');
    writeFileSync(file, STORED, 'utf8');
    const lock = `${file}.lock`;
    const dead = 'pid=999999999 at=2020-01-01T00:00:00.000Z nonce=deleting';
    writeFileSync(lock, dead, 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    const outcome = settle(() => throughFs('statSync', (real, args) => { if (String(args[0]) === lock) throw errno('EPERM'); return real(...args); }, () => updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 })));
    assert.ok(isCode('LOCKED')(outcome.error), `LOCKED: ${String(outcome.error)}`);
    assert.equal(textOf(lock), dead, 'the lock being deleted is not removed by the waiter');
    assert.equal(readFileSync(file, 'utf8'), STORED);
    unlinkSync(lock);
  });
});
