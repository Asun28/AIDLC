/**
 * Atomic, schema-validated JSON persistence.
 *
 * Writes go to a temporary sibling and are renamed into place so a reader never observes a
 * half-written record. A leftover temporary file is evidence of an interrupted write and is
 * reported, never silently adopted (plan v5 MS5: "acquire/update it atomically and recover
 * interrupted writes").
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ZodType } from 'zod';

export class StoreError extends Error {
  readonly code: string;
  readonly file: string;
  constructor(code: string, file: string, message: string) {
    super(`${code}: ${message} (${file})`);
    this.code = code;
    this.file = file;
  }
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function tempName(file: string): string {
  return `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
}

/** Write `data` to `file` atomically. Returns the bytes written. */
export function atomicWriteText(file: string, text: string): number {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tempName(file);
  const fd = openSync(tmp, 'w');
  try {
    const bytes = writeSync(fd, text, null, 'utf8');
    try {
      fsyncSync(fd);
    } catch {
      /* fsync is best effort on some filesystems */
    }
    closeSync(fd);
    renameSync(tmp, file);
    return bytes;
  } catch (err) {
    try {
      closeSync(fd);
    } catch {
      /* already closed */
    }
    try {
      unlinkSync(tmp);
    } catch {
      /* nothing to clean */
    }
    throw err;
  }
}

export function atomicWriteJson(file: string, value: unknown): number {
  return atomicWriteText(file, stableStringify(value) + '\n');
}

/** Read and validate a JSON record. Missing file returns undefined; invalid content throws. */
export function readJson<T>(file: string, schema: ZodType<T>): T | undefined {
  if (!existsSync(file)) return undefined;
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new StoreError('READ_FAILED', file, (err as Error).message);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new StoreError('MALFORMED_JSON', file, (err as Error).message);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StoreError('SCHEMA_VIOLATION', file, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  return result.data;
}

/** Detect leftover temporary files from interrupted writes in a directory. */
export function findInterruptedWrites(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /\.tmp-\d+-[a-f0-9]{8}$/.test(name))
    .map((name) => path.join(dir, name));
}

/** Remove interrupted temporary files; the durable record is whatever was renamed last. */
export function recoverInterruptedWrites(dir: string): string[] {
  const found = findInterruptedWrites(dir);
  for (const file of found) {
    try {
      unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
  return found;
}

/** Create a file exclusively; returns false if it exists, or is being deleted (Windows refuses that create with EPERM while the path exists). */
export function createExclusive(file: string, text: string): boolean {
  mkdirSync(path.dirname(file), { recursive: true });
  let fd: number;
  try {
    fd = openSync(file, 'wx');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || (code === 'EPERM' && ageMs(file) !== undefined)) return false;
    throw err;
  }
  try {
    writeSync(fd, text, null, 'utf8');
    try {
      fsyncSync(fd);
    } catch {
      /* best effort */
    }
  } finally {
    closeSync(fd);
  }
  return true;
}

/**
 * The one read-modify-write of a record: `change` receives the record as stored, parsed by `schema`, under an exclusive
 * lock file (`<file>.lock`, created with `wx` and naming its process), and the record it returns is written atomically;
 * a change that throws, or returns the record it received or nothing, writes nothing. A waiter refuses with `LOCKED` at
 * the deadline (`timeoutMs`, default 2 s), which is checked before every retry, so a wait that overran it never runs
 * `change` on a lock freed meanwhile. A lock older than `staleMs` (default 30 s) whose owner process is gone belongs to a
 * crashed writer and is taken over through a serialized marker; a live owner keeps its lock however old. The write is
 * ownership-checked (a writer whose lock changed hands refuses with `LOCK_LOST`) and runs inside `within` when given, so a
 * caller holds another lock until the record is on disk. The release removes only this writer's lock, and neither it nor
 * an unreadable lock replaces the change's result or error. The lock is not reentrant: nested sections take the card-run
 * lock before the lease lock.
 */
export function updateJson<T>(file: string, schema: ZodType<T>, change: (current: T | undefined) => T | undefined, opts: { timeoutMs?: number; staleMs?: number; within?: (write: () => void) => void } = {}): T | undefined {
  const lock = `${file}.lock`;
  const owner = `pid=${process.pid} at=${new Date().toISOString()} nonce=${randomBytes(4).toString('hex')}`;
  const deadline = Date.now() + (opts.timeoutMs ?? 2_000);
  const staleMs = opts.staleMs ?? 30_000;
  while (!createExclusive(lock, owner)) {
    if (staleOwner(lock, staleMs) !== undefined) takeOverStaleLock(lock, owner, staleMs);
    else sleepSync(10);
    if (Date.now() >= deadline) throw new StoreError('LOCKED', file, `locked by another writer (${readLockOwner(lock) ?? 'unknown owner'}); run the command again`);
  }
  try {
    const current = readJson(file, schema);
    const next = change(current);
    if (next === undefined || next === current) return current;
    const write = (): void => {
      // A lock this writer cannot read is still its own: no waiter removes a lock it cannot read.
      let holder: string | undefined = owner;
      try {
        holder = readLockOwner(lock);
      } catch {
        /* unreadable: kept as this writer's */
      }
      if (holder !== owner) throw new StoreError('LOCK_LOST', file, `the lock changed hands during the update (${holder ?? 'lock gone'}); nothing written, run the command again`);
      atomicWriteJson(file, next);
    };
    if (opts.within) opts.within(write);
    else write();
    return next;
  } finally {
    try {
      removeIfOwner(lock, owner);
    } catch {
      /* the change's outcome stands; a lock left behind is taken over once stale after this process ends */
    }
  }
}

/** Block the thread for `ms` (a lock retry between two synchronous file operations). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** The owner text of a lock or marker older than the stale age whose owner process is gone (one naming no process counts as gone); undefined otherwise. */
function staleOwner(file: string, staleMs: number): string | undefined {
  const age = ageMs(file);
  if (age === undefined || age <= staleMs) return undefined;
  const text = readLockOwner(file);
  return text !== undefined && !ownerAlive(text) ? text : undefined;
}

/**
 * Stale-lock takeover, serialized among waiters by a second exclusive marker (`<lock>.takeover`): the one waiter holding
 * the marker judges the lock again and removes it only while it still names the dead owner it judged, and releases only its
 * own marker. A marker is reclaimed like a lock: once it is older than the stale age and its owner process is gone, so a
 * suspended live taker keeps it. Errors other than a vanished file propagate.
 */
function takeOverStaleLock(lock: string, owner: string, staleMs: number): void {
  const marker = `${lock}.takeover`;
  if (!createExclusive(marker, owner)) {
    const dead = staleOwner(marker, staleMs);
    if (dead !== undefined) removeIfOwner(marker, dead);
    else sleepSync(10);
    return;
  }
  try {
    const dead = staleOwner(lock, staleMs);
    if (dead !== undefined) removeIfOwner(lock, dead);
  } finally {
    removeIfOwner(marker, owner);
  }
}

/** Remove a lock or marker only while it still names `text`; a file already gone is not an error, anything else propagates. */
function removeIfOwner(file: string, text: string): void {
  if (readLockOwner(file) !== text) return;
  try {
    unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Age of a file by its mtime, undefined when it is gone; a file being deleted (EPERM on Windows) is fresh; any other stat failure propagates. */
function ageMs(file: string): number | undefined {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return undefined;
    if (code === 'EPERM') return 0;
    throw err;
  }
}

/** Whether the process an owner text names is still running (a process this one may not signal counts as running). */
function ownerAlive(text: string): boolean {
  const pid = Number(/\bpid=(\d+)/.exec(text)?.[1]);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The owner text of a lock file, undefined when it is gone; any other read failure propagates (a lock this process cannot read is never taken over or released). */
function readLockOwner(lock: string): string | undefined {
  try {
    return readFileSync(lock, 'utf8').trim() || 'unknown owner';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

export function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(dir, name));
}
