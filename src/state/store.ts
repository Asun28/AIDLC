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
import type { Dirent } from 'node:fs';
import type { StatePaths } from './paths.ts';

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
    if (code === 'EEXIST' || (code === 'EPERM' && present(file))) return false;
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
 * `change` on a lock freed meanwhile. No lock is ever removed but by the writer that created it: a lock whose owner process
 * is gone is refused like any other, naming the file and the process id for the operator. The write is ownership-checked
 * (a writer whose lock changed hands refuses with `LOCK_LOST`) and runs inside `within` when given, so a caller holds
 * another lock until the record is on disk. The release removes only this writer's lock, and neither it nor an unreadable
 * lock replaces the change's result or error. The lock is not reentrant: nested sections take the card-run lock before the
 * lease lock.
 */
export function updateJson<T>(file: string, schema: ZodType<T>, change: (current: T | undefined) => T | undefined, opts: { timeoutMs?: number; within?: (write: () => void) => void } = {}): T | undefined {
  const lock = `${file}.lock`;
  const owner = `pid=${process.pid} at=${new Date().toISOString()} nonce=${randomBytes(4).toString('hex')}`;
  const deadline = Date.now() + (opts.timeoutMs ?? 2_000);
  while (!createExclusive(lock, owner)) {
    sleepSync(10);
    if (Date.now() >= deadline) throw locked(file, lock);
  }
  try {
    const current = readJson(file, schema);
    const next = change(current);
    if (next === undefined || next === current) return current;
    const write = (): void => {
      // A lock this writer cannot read is still its own: no other writer removes a lock.
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
      if (readLockOwner(lock) === owner) unlinkSync(lock);
    } catch {
      /* the change's outcome stands; a lock left behind is refused with its process id named until the operator removes it */
    }
  }
}

/**
 * The refusal of a lock another writer holds. A lock naming a process that is no longer running (a crashed writer) is named
 * with its file and process id, so the operator can delete it once that process is confirmed dead; it is never removed here.
 */
function locked(file: string, lock: string): StoreError {
  const holder = readLockOwner(lock);
  const pid = lockPid(holder);
  if (pid !== undefined && !processAlive(pid)) return new StoreError('LOCKED', file, `${lock} is locked by pid ${pid}, which is no longer running; ${staleLockAction(lock, pid)}`);
  return new StoreError('LOCKED', file, `locked by another writer (${holder ?? 'unknown owner'}); run the command again`);
}

/** A process id, kept only when it is a positive integer. */
function usablePid(digits: string | undefined): number | undefined {
  const pid = Number(digits);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

/** The usable process id in a lock's owner text: the first `pid=<digits>` at a word boundary. */
function lockPid(holder: string | undefined): number | undefined {
  return usablePid(/\bpid=(\d+)/.exec(holder ?? '')?.[1]);
}

/** What the operator does with a lock whose process is gone; `lock` is named as the caller quotes it. */
function staleLockAction(lock: string, pid: number): string {
  return `delete ${lock} only once pid ${pid} is confirmed dead, then run the command again`;
}

/** Block the thread for `ms` (a lock retry between two synchronous file operations). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Whether a path exists, a file Windows is still deleting included (its stat fails with EPERM); any other stat failure propagates. */
function present(file: string): boolean {
  try {
    statSync(file);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    if (code === 'EPERM') return true;
    throw err;
  }
}

/** Whether a process is still running (a process this one may not signal counts as running). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The owner text of a lock file, undefined when it is gone; any other read failure propagates. */
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

const TEMP_NAME = /\.tmp-(\d+)-[a-f0-9]{8}$/;
const MANIFEST_TEMP_NAME = /^manifest\.json\.tmp-(\d+)-[a-f0-9]{8}$/;
const STATE_DIRS = ['goals', 'releases', 'leases', 'review-queue', 'operations', 'journal', 'incidents', 'heartbeat'] as const;

/**
 * Stale lock files, leftover atomic-write temporary files and unreadable entries of the state directory, as `none` or one
 * entry per path (its relative path JSON-quoted, then the finding), sorted by relative path. Reads only: it takes no lock,
 * opens no temporary file, enters nothing below a goal directory and never throws.
 */
export function interruptedWritesReport(paths: StatePaths): 'none' | string[] {
  const found: Array<[string, string]> = [];
  const codeOf = (err: unknown): string => {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    return typeof code === 'string' ? code : 'UNREADABLE';
  };
  /** The entries of a directory, undefined (and an entry for any failure but ENOENT) when it cannot be listed. */
  const list = (rel: string, dir: string): Dirent[] | undefined => {
    try {
      return readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (codeOf(err) !== 'ENOENT') found.push([rel, 'unreadable, ' + codeOf(err)]);
      return undefined;
    }
  };
  const scan = (rel: string, dir: string, evidence: boolean): void => {
    for (const entry of list(rel, dir) ?? []) {
      const name = entry.name;
      const lock = evidence ? name === 'manifest.json.lock' : name.endsWith('.lock');
      const temp = lock ? null : (evidence ? MANIFEST_TEMP_NAME : TEMP_NAME).exec(name);
      if (!lock && !temp) continue;
      const own = `${rel}/${name}`;
      if (!entry.isFile()) {
        found.push([own, 'unreadable, not a regular file']);
      } else if (temp) {
        const pid = usablePid(temp[1]);
        if (pid === undefined) found.push([own, 'temp, no usable pid']);
        else if (!processAlive(pid)) found.push([own, `temp, pid ${pid} is no longer running`]);
      } else {
        try {
          const pid = lockPid(readLockOwner(path.join(dir, name)));
          if (pid === undefined) found.push([own, 'lock, owner unknown; delete it only once no aidlc command is running on this state directory']);
          else if (!processAlive(pid)) found.push([own, `lock, pid ${pid} is no longer running; ${staleLockAction(JSON.stringify(own), pid)}`]);
        } catch (err) {
          found.push([own, 'unreadable, ' + codeOf(err)]);
        }
      }
    }
  };
  try {
    readdirSync(paths.root, { withFileTypes: true });
  } catch (err) {
    return codeOf(err) === 'ENOENT' ? 'none' : ['".": unreadable, ' + codeOf(err)];
  }
  const dirs: Record<(typeof STATE_DIRS)[number], string> = { goals: paths.goals, releases: paths.releases, leases: paths.leases, 'review-queue': paths.reviewQueue, operations: paths.operations, journal: paths.journal, incidents: paths.incidents, heartbeat: path.join(paths.root, 'heartbeat') };
  for (const name of STATE_DIRS) scan(name, dirs[name], false);
  for (const [parent, parentDir] of [['cards', paths.cards], ['evidence', paths.evidence]] as const) {
    for (const goal of list(parent, parentDir) ?? []) if (goal.isDirectory()) scan(`${parent}/${goal.name}`, path.join(parentDir, goal.name), parent === 'evidence');
  }
  if (found.length === 0) return 'none';
  return found.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([rel, text]) => `${JSON.stringify(rel)}: ${text}`);
}
