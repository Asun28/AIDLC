import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EvidenceStore, Manifest, fileSha256 } from '../../src/audit/manifest.ts';

const now = '2026-09-11T00:00:00.000Z';

test('retain copies artifacts into the evidence tree and records their digest', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aidlc-evidence-'));
  const store = new EvidenceStore(path.join(root, 'evidence'), 'g1');
  let m = store.load('g1', 0, 0, now);
  assert.equal(m.entries.length, 0);
  const src = path.join(root, 'dod.log');
  writeFileSync(src, 'all green\n', 'utf8');
  m = store.retain(m, { id: 'dod-receipt', kind: 'dod-receipt', sourcePath: src, candidateDigest: 'abc', note: 'from worktree' });
  m = store.retain(m, { id: 'verdict', kind: 'review-verdict', content: '{"verdict":"pass"}', candidateDigest: 'abc', invocationId: 'inv-1' });
  assert.equal(m.entries.length, 2);
  const dod = m.entries.find((e) => e.id === 'dod-receipt')!;
  const copied = path.join(store.dir, dod.path);
  assert.ok(existsSync(copied));
  assert.equal(readFileSync(copied, 'utf8'), 'all green\n');
  assert.equal(dod.sha256, fileSha256(src));
  assert.equal(dod.bytes, 10);
  // reload from disk
  const reloaded = store.load('g1', 0, 0, now);
  assert.equal(reloaded.entries.length, 2);
  // retaining the same id replaces the entry
  m = store.retain(m, { id: 'verdict', kind: 'review-verdict', content: '{"verdict":"block"}' });
  assert.equal(m.entries.length, 2);
  assert.throws(() => store.retain(m, { id: 'x', kind: 'other', sourcePath: path.join(root, 'missing') }), /evidence source missing/);
});

test('seal binds the journal head; verifySeal detects tampering; retain after seal throws', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'aidlc-evidence-'));
  const store = new EvidenceStore(path.join(root, 'evidence'), 'g2');
  let m = store.retain(store.load('g2', 1, 2, now), { id: 'a', kind: 'artifact', content: 'a' });
  assert.equal(store.verifySeal(m), false);
  const sealed = store.seal(m, { journalHead: 'ff'.repeat(32), journalEvents: 7, finalSha: 'deadbeef', finalCandidateDigest: 'cand', now, host: { node: 'v22', platform: 'win32', aidlc: '0.1.0' } });
  assert.ok(sealed.seal);
  assert.equal(sealed.sealedAt, now);
  assert.equal(sealed.journalEvents, 7);
  assert.equal(store.verifySeal(sealed), true);
  // persisted and re-parseable
  const onDisk = Manifest.parse(JSON.parse(readFileSync(store.manifestFile(), 'utf8')));
  assert.equal(store.verifySeal(onDisk), true);
  // tamper with an entry
  const tampered = { ...sealed, entries: [{ ...sealed.entries[0]!, sha256: '0'.repeat(64) }] };
  assert.equal(store.verifySeal(tampered), false);
  assert.throws(() => store.retain(sealed, { id: 'b', kind: 'artifact', content: 'b' }), /sealed/);
  m = sealed;
  assert.equal(m.entries.length, 1);
});
