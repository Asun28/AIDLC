import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs, { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { z } from 'zod';
import { LeaseStore } from '../../src/coordination/lease.ts';
import { OperationLedger } from '../../src/coordination/reconcile.ts';
import { ReviewQueue } from '../../src/coordination/review-queue.ts';
import { BoundsReadError, readBoundRecords } from '../../src/state/bounds.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { shortKey, statePathsFromRoot } from '../../src/state/paths.ts';
import {
  StoreError,
  atomicWriteJson,
  atomicWriteText,
  canonicalJson,
  createExclusive,
  findInterruptedWrites,
  listJsonFiles,
  readJson,
  recoverInterruptedWrites,
  stableStringify,
} from '../../src/state/store.ts';
import { cleanup, ensureStatePaths, makeGoal, tmpDir } from './helpers.ts';

const Rec = z.object({ id: z.string(), n: z.number().int(), tags: z.array(z.string()).default([]) });

describe('state/store', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));

  it('atomicWriteJson then readJson round-trips through the zod schema', () => {
    const file = path.join(dir, 'a', 'rec.json');
    atomicWriteJson(file, { n: 1, id: 'x' });
    const back = readJson(file, Rec);
    assert.deepEqual(back, { id: 'x', n: 1, tags: [] });
    // keys are sorted deterministically on disk
    assert.equal(readFileSync(file, 'utf8'), '{\n  "id": "x",\n  "n": 1\n}\n');
    assert.equal(findInterruptedWrites(path.dirname(file)).length, 0);
  });

  it('readJson returns undefined for a missing file', () => {
    assert.equal(readJson(path.join(dir, 'nope.json'), Rec), undefined);
  });

  it('malformed JSON raises StoreError MALFORMED_JSON', () => {
    const file = path.join(dir, 'bad.json');
    writeFileSync(file, '{ not json', 'utf8');
    assert.throws(
      () => readJson(file, Rec),
      (err: unknown) => err instanceof StoreError && err.code === 'MALFORMED_JSON' && err.file === file,
    );
  });

  it('schema violation raises StoreError SCHEMA_VIOLATION with the path in the message', () => {
    const file = path.join(dir, 'wrong.json');
    writeFileSync(file, JSON.stringify({ id: 'x', n: 'not-a-number' }), 'utf8');
    assert.throws(
      () => readJson(file, Rec),
      (err: unknown) => err instanceof StoreError && err.code === 'SCHEMA_VIOLATION' && /n:/.test(err.message),
    );
  });

  it('leftover .tmp- files are detected and removed as interrupted writes', () => {
    const sub = path.join(dir, 'interrupted');
    atomicWriteJson(path.join(sub, 'good.json'), { id: 'g', n: 2 });
    const leftover = path.join(sub, 'good.json.tmp-4242-deadbeef');
    writeFileSync(leftover, '{"partial":', 'utf8');
    writeFileSync(path.join(sub, 'unrelated.tmp'), 'x', 'utf8');
    const found = findInterruptedWrites(sub);
    assert.deepEqual(found, [leftover]);
    const removed = recoverInterruptedWrites(sub);
    assert.deepEqual(removed, [leftover]);
    assert.equal(existsSync(leftover), false);
    assert.equal(findInterruptedWrites(sub).length, 0);
    // the durable record survives untouched
    assert.deepEqual(readJson(path.join(sub, 'good.json'), Rec), { id: 'g', n: 2, tags: [] });
  });

  it('findInterruptedWrites on a missing directory is empty', () => {
    assert.deepEqual(findInterruptedWrites(path.join(dir, 'does-not-exist')), []);
  });

  it('createExclusive succeeds once and returns false on the second call', () => {
    const file = path.join(dir, 'claims', 'one.json');
    assert.equal(createExclusive(file, 'first'), true);
    assert.equal(createExclusive(file, 'second'), false);
    assert.equal(readFileSync(file, 'utf8'), 'first');
  });

  it('atomicWriteText replaces an existing file atomically', () => {
    const file = path.join(dir, 'replace.txt');
    atomicWriteText(file, 'v1');
    atomicWriteText(file, 'v2');
    assert.equal(readFileSync(file, 'utf8'), 'v2');
    assert.equal(findInterruptedWrites(dir).length, 0);
  });

  it('canonicalJson sorts keys and drops undefined; stableStringify is pretty', () => {
    assert.equal(canonicalJson({ b: 1, a: [{ z: 1, y: undefined }] }), '{"a":[{"z":1}],"b":1}');
    assert.equal(stableStringify({ b: 1, a: 2 }), '{\n  "a": 2,\n  "b": 1\n}');
  });

  it('listJsonFiles returns sorted .json paths only', () => {
    const sub = path.join(dir, 'list');
    atomicWriteJson(path.join(sub, 'b.json'), {});
    atomicWriteJson(path.join(sub, 'a.json'), {});
    writeFileSync(path.join(sub, 'c.txt'), '', 'utf8');
    assert.deepEqual(
      listJsonFiles(sub).map((f) => path.basename(f)),
      ['a.json', 'b.json'],
    );
    assert.deepEqual(listJsonFiles(path.join(dir, 'missing')), []);
  });
});

/** `body` with `fs.readFileSync` throwing `error` for `file` and reading every other path; the real function is restored after. */
function failingRead<T>(file: string, error: unknown, body: () => T): T {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['readFileSync']!;
  target['readFileSync'] = (...args: unknown[]) => {
    if (args[0] === file) throw error;
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    return body();
  } finally {
    target['readFileSync'] = real;
    syncBuiltinESMExports();
  }
}

/** An error of the row: its message, and its code unless the row has none. */
const readError = (code: string | undefined, message: string): Error => (code === undefined ? new Error(message) : Object.assign(new Error(message), { code }));

/** Asserts that `err` is the READ_FAILED store error of `file` with the message of `message`, field by field. */
function isReadFailed(err: unknown, file: string, message: string): boolean {
  assert.ok(err instanceof StoreError, String(err));
  assert.deepEqual({ code: err.code, file: err.file, message: err.message }, { code: 'READ_FAILED', file, message: `READ_FAILED: ${message} (${file})` });
  return true;
}

describe('state/store readJson reads a record as absent only on ENOENT (T0-STORE-READ-ENOENT)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));

  it('T0-STORE-READ-ENOENT acceptance 1 - only a read error with the code ENOENT is an absent record', () => {
    const file = path.join(dir, 'unseen', 'rec.json');
    assert.equal(existsSync(file), false);
    const absent: Array<[string, string]> = [
      ['ENOENT', 'ENOENT: no such file or directory, open'],
      ['ENOENT', 'a message that names no code'],
    ];
    for (const [code, message] of absent) {
      assert.equal(failingRead(file, readError(code, message), () => readJson(file, Rec)), undefined, `${code}: ${message}`);
    }
    const refused: Array<[string | undefined, string]> = [
      ['EACCES', 'EACCES: permission denied, open'],
      ['ENOTDIR', 'ENOTDIR: not a directory, open'],
      ['ELOOP', 'ELOOP: too many symbolic links encountered, open'],
      ['EPERM', 'EPERM: operation not permitted, open'],
      ['EISDIR', 'EISDIR: illegal operation on a directory, read'],
      ['ENAMETOOLONG', 'ENAMETOOLONG: name too long, open'],
      ['EIO', 'EIO: i/o error, read'],
      ['EACCES', 'a denied read of ENOENT.json'],
      ['enoent', 'a code in another letter case'],
      [undefined, 'an error with no code'],
    ];
    for (const [code, message] of refused) {
      assert.throws(() => failingRead(file, readError(code, message), () => readJson(file, Rec)), (err: unknown) => isReadFailed(err, file, message), `${code}: ${message}`);
    }
  });

  it('T0-STORE-READ-ENOENT acceptance 2 - a directory at the record path is READ_FAILED and a path under a regular file is READ_FAILED on POSIX and absent on Windows', () => {
    const real = path.join(dir, 'real');
    const directory = path.join(real, 'dir.json');
    mkdirSync(directory, { recursive: true });
    assert.throws(() => readJson(directory, Rec), (err: unknown) => err instanceof StoreError && err.code === 'READ_FAILED' && err.file === directory);

    const plain = path.join(real, 'plain');
    writeFileSync(plain, 'text', 'utf8');
    const under = path.join(plain, 'rec.json');
    // Under a regular file POSIX answers ENOTDIR and Windows answers that there is no entry, which no reader can tell from a missing file.
    if (process.platform === 'win32') {
      assert.equal(readJson(under, Rec), undefined);
    } else {
      assert.throws(() => readJson(under, Rec), (err: unknown) => err instanceof StoreError && err.code === 'READ_FAILED' && err.file === under && err.message.includes('ENOTDIR'));
    }
  });

  const noModes = process.platform === 'win32' ? 'Windows has no POSIX mode bits, so a directory mode cannot hide a record' : process.getuid?.() === 0 ? 'root reads through any directory mode' : false;
  it('T0-STORE-READ-ENOENT acceptance 3 - a record in a directory without search permission is READ_FAILED (EACCES), read alone or through a listing', { skip: noModes }, () => {
    const store = new GoalStore(ensureStatePaths(statePathsFromRoot(path.join(dir, 'locked', '.aidlc'))));
    const saved = store.saveGoal(makeGoal('goal-locked'));
    const file = store.goalFile('goal-locked');
    const denied = (err: unknown): boolean => err instanceof StoreError && err.code === 'READ_FAILED' && err.file === file && err.message.includes('EACCES');
    try {
      chmodSync(store.paths.goals, 0o000);
      assert.throws(() => store.getGoal('goal-locked'), denied);
      chmodSync(store.paths.goals, 0o600);
      assert.throws(() => store.listGoals(), denied);
    } finally {
      chmodSync(store.paths.goals, 0o755);
    }
    assert.deepEqual(store.getGoal('goal-locked'), saved);
  });

  it('T0-STORE-READ-ENOENT acceptance 4 - each reader of one record refuses a record whose read fails with EACCES and reads a missing one as absent', () => {
    const paths = ensureStatePaths(statePathsFromRoot(path.join(dir, 'readers', '.aidlc')));
    const store = new GoalStore(paths);
    const leases = new LeaseStore(paths.leases);
    const ops = new OperationLedger(paths.operations);
    const queue = new ReviewQueue(paths.reviewQueue);
    const at = '2026-09-11T10:00:00.000Z';
    const message = 'EACCES: permission denied, open';
    const rows: Array<[string, string, () => unknown, unknown]> = [
      ["store.getGoal('g-1')", store.goalFile('g-1'), () => store.getGoal('g-1'), undefined],
      ["store.getCardRun('g-1', 'T1-A')", store.cardFile('g-1', 'T1-A'), () => store.getCardRun('g-1', 'T1-A'), undefined],
      ["store.getRelease('rel-1')", store.releaseFile('rel-1'), () => store.getRelease('rel-1'), undefined],
      ["leases.read('card:x')", leases.file('card:x'), () => leases.read('card:x'), undefined],
      ["ops.get('op-1')", path.join(paths.operations, 'op-1.json'), () => ops.get('op-1'), undefined],
      ["queue.get('k')", path.join(paths.reviewQueue, `${shortKey('k')}.json`), () => queue.get('k'), undefined],
      ["queue.pool('default', at)", path.join(paths.reviewQueue, `_pool-${shortKey('default')}.json`), () => queue.pool('default', at), { pool: 'default', maxConcurrent: 1, active: [], nextSeq: 0, usageKnown: false, updatedAt: at }],
    ];
    for (const [reader, file, read, missing] of rows) {
      assert.equal(existsSync(file), false, reader);
      assert.deepEqual(read(), missing, reader);
      assert.throws(() => failingRead(file, readError('EACCES', message), read), (err: unknown) => isReadFailed(err, file, message), reader);
    }
    const goalFile = store.goalFile('g-1');
    assert.equal(existsSync(goalFile), false);
    assert.equal(readBoundRecords(store, 'g-1'), undefined);
    assert.throws(
      () => failingRead(goalFile, readError('EACCES', message), () => readBoundRecords(store, 'g-1')),
      (err: unknown) => err instanceof BoundsReadError && err.message === `cannot read ${JSON.stringify(goalFile)}: READ_FAILED`,
    );
  });
});
