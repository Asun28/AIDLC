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
function throughFs<T>(name: 'readFileSync' | 'statSync' | 'unlinkSync' | 'openSync' | 'writeSync', wrap: (real: (...args: unknown[]) => unknown, args: unknown[]) => unknown, body: () => T): T {
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

  it('a lock whose owner process is gone is refused with LOCKED naming the lock file, the process id and when deleting it is safe, and it stays however old; a live owner keeps its lock however old [R7]', () => {
    const file = seed('stale.json');
    const lock = `${file}.lock`;
    // A crashed writer names a pid no platform has (pid 1 is init on Linux, alive and unsignallable).
    const dead = 'pid=999999999 at=2020-01-01T00:00:00.000Z nonce=dead';
    writeFileSync(lock, dead, 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    const refused = settle(() => updateJson(file, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 }));
    assert.ok(isCode('LOCKED')(refused.error), `LOCKED: ${String(refused.error)}`);
    assert.ok(String((refused.error as Error | undefined)?.message).includes(`${lock} is locked by pid 999999999, which is no longer running; delete ${lock} only once pid 999999999 is confirmed dead, then run the command again`), `the refusal names the file, the pid and when deleting is safe: ${String(refused.error)}`);
    assert.equal(textOf(lock), dead, 'the dead owner\'s lock stays in place');
    assert.equal(readFileSync(file, 'utf8'), STORED);
    writeFileSync(lock, `pid=${process.pid} at=2020-01-01T00:00:00.000Z nonce=old-live`, 'utf8');
    utimesSync(lock, LONG_AGO, LONG_AGO);
    assert.throws(() => updateJson(file, Rec, (current) => ({ ...current!, n: 4 }), { timeoutMs: 50 }), (err: unknown) => isCode('LOCKED')(err) && /locked by another writer/.test((err as Error).message));
    assert.ok(existsSync(lock), 'the live owner keeps its lock');
    assert.equal(readFileSync(file, 'utf8'), STORED);
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

  it('acceptance 13: no updateJson path unlinks a lock or a marker whose text is not its own, under a live, a stale, a replaced or its own lock [R7]', () => {
    // At the filesystem boundary: every exclusive create of a lock file and the text written into it, and every unlink of a
    // lock or marker file with the text found there when it is removed.
    const fds = new Map<unknown, string>();
    const own = new Set<string>();
    const foreign: string[] = [];
    const watch = <T>(body: () => T): T =>
      throughFs('openSync', (real, args) => {
        const fd = real(...args);
        if (args[1] === 'wx' && String(args[0]).includes('.lock')) fds.set(fd, String(args[0]));
        return fd;
      }, () =>
        throughFs('writeSync', (real, args) => {
          if (fds.has(args[0])) own.add(String(args[1]));
          return real(...args);
        }, () =>
          throughFs('unlinkSync', (real, args) => {
            const target = String(args[0]);
            if (target.includes('.lock')) {
              const text = textOf(target);
              if (text === undefined || !own.has(text)) foreign.push(`${path.basename(target)}: ${text ?? 'gone'}`);
            }
            return real(...args);
          }, body),
        ),
      );
    // A live owner's lock, a dead owner's lock older than any stale age with a crashed taker's marker beside it, a lock that
    // changes hands while the change runs, and this call's own lock.
    const live = seed('boundary-live.json');
    writeFileSync(`${live}.lock`, LIVE, 'utf8');
    const stale = seed('boundary-stale.json');
    writeFileSync(`${stale}.lock`, DEAD, 'utf8');
    writeFileSync(`${stale}.lock.takeover`, 'pid=999999998 at=2020-01-01T00:00:00.000Z nonce=crashed-taker', 'utf8');
    for (const f of [`${stale}.lock`, `${stale}.lock.takeover`]) utimesSync(f, LONG_AGO, LONG_AGO);
    const replaced = seed('boundary-replaced.json');
    const mine = seed('boundary-own.json');
    const other = `pid=${process.pid} at=2026-09-27T00:00:00.000Z nonce=next-holder`;
    const outcomes = watch(() => ({
      live: settle(() => updateJson(live, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 })),
      stale: settle(() => updateJson(stale, Rec, (current) => ({ ...current!, n: 2 }), { timeoutMs: 50 })),
      replaced: settle(() => updateJson(replaced, Rec, (current) => { writeFileSync(`${replaced}.lock`, other, 'utf8'); return { ...current!, n: 2 }; })),
      mine: settle(() => updateJson(mine, Rec, (current) => ({ ...current!, n: 2 }))),
    }));
    assert.deepEqual(foreign, [], 'no lock or marker is unlinked unless its text is the one this process created it with');
    assert.ok(isCode('LOCKED')(outcomes.live.error), `live: ${String(outcomes.live.error)}`);
    assert.ok(isCode('LOCKED')(outcomes.stale.error), `stale: ${String(outcomes.stale.error)}`);
    assert.ok(isCode('LOCK_LOST')(outcomes.replaced.error), `replaced: ${String(outcomes.replaced.error)}`);
    assert.deepEqual(outcomes.mine, { value: { id: 'x', n: 2 } });
    assert.equal(textOf(`${live}.lock`), LIVE);
    assert.equal(textOf(`${stale}.lock`), DEAD);
    assert.ok(existsSync(`${stale}.lock.takeover`), "the crashed taker's marker stays too");
    assert.equal(textOf(`${replaced}.lock`), other);
    assert.equal(textOf(`${mine}.lock`), undefined, 'its own lock is released');
    for (const f of [`${live}.lock`, `${stale}.lock`, `${stale}.lock.takeover`, `${replaced}.lock`]) unlinkSync(f);
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
