/**
 * Atomic, schema-validated JSON persistence.
 *
 * Writes go to a temporary sibling and are renamed into place so a reader never observes a
 * half-written record. A leftover temporary file is evidence of an interrupted write and is
 * reported, never silently adopted (plan v5 MS5: "acquire/update it atomically and recover
 * interrupted writes").
 */
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
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

/** Create a file exclusively; returns false if it already exists. Used for atomic claims. */
export function createExclusive(file: string, text: string): boolean {
  mkdirSync(path.dirname(file), { recursive: true });
  let fd: number;
  try {
    fd = openSync(file, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
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

export function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => path.join(dir, name));
}
