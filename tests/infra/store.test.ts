import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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
import { cleanup, tmpDir } from './helpers.ts';

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
