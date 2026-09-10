import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Journal } from '../../src/state/journal.ts';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';
import { OperationLedger } from '../../src/coordination/reconcile.ts';

const now = '2026-09-11T00:00:00.000Z';

function fixture(goalId = 'g1') {
  const root = mkdtempSync(path.join(tmpdir(), 'aidlc-audit-'));
  const journal = Journal.forGoal(path.join(root, 'journal'), goalId);
  const evidence = new EvidenceStore(path.join(root, 'evidence'), goalId);
  const operations = new OperationLedger(path.join(root, 'operations'));
  return { root, journal, evidence, operations, goalId };
}

function sealWith(f: ReturnType<typeof fixture>, candidate = 'cand-final') {
  let m = f.evidence.load(f.goalId, 0, 0, now);
  m = f.evidence.retain(m, { id: 'dod', kind: 'dod-receipt', content: 'exit 0', candidateDigest: candidate });
  const head = f.journal.head();
  return f.evidence.seal(m, { journalHead: head.hash, journalEvents: head.seq + 1, finalCandidateDigest: candidate, now });
}

test('Q12: intact journal + sealed manifest => independently-verified; not claimed fully audited', () => {
  const f = fixture();
  f.journal.append({ type: 'GOAL_CREATED', goalId: f.goalId, data: { text: 'x' } });
  f.journal.append({ type: 'MODEL_INVOCATION', goalId: f.goalId, data: { invocationId: 'inv-1' } });
  f.journal.append({ type: 'GOAL_DONE', goalId: f.goalId });
  const manifest = sealWith(f);
  const report = verifyAudit({ goalId: f.goalId, journal: f.journal, evidence: f.evidence, manifest, operations: f.operations, finalCandidateDigest: 'cand-final', now });
  assert.equal(report.level, 'independently-verified', JSON.stringify(report.findings));
  assert.equal(report.fullyAuditedStatus, 'not-claimed');
  assert.equal(report.journal.ok, true);
  assert.equal(report.journal.events, 3);
  assert.equal(report.manifest?.sealOk, true);
  assert.deepEqual(report.findings.filter((x) => x.severity === 'block'), []);
});

test('tampered journal => level recorded with JOURNAL_CHAIN block', () => {
  const f = fixture();
  f.journal.append({ type: 'GOAL_CREATED', goalId: f.goalId, data: { text: 'original' } });
  f.journal.append({ type: 'NOTE', goalId: f.goalId, data: { n: 1 } });
  const lines = readFileSync(f.journal.file, 'utf8').split('\n');
  lines[0] = lines[0]!.replace('"original"', '"altered"');
  writeFileSync(f.journal.file, lines.join('\n'), 'utf8');
  const report = verifyAudit({ goalId: f.goalId, journal: f.journal, now });
  assert.equal(report.level, 'recorded');
  assert.ok(report.findings.some((x) => x.code === 'JOURNAL_CHAIN' && x.severity === 'block'));
  assert.equal(report.journal.ok, false);
});

test('operation without OPERATION_INTENT event and without result is blocking', () => {
  const f = fixture();
  f.journal.append({ type: 'GOAL_CREATED', goalId: f.goalId });
  const op = f.operations.recordIntent({ kind: 'deploy', goalId: f.goalId, target: 'staging', ownerGeneration: 0, timeoutMs: 1000 }, now);
  const report = verifyAudit({ goalId: f.goalId, journal: f.journal, operations: f.operations, now });
  assert.ok(report.findings.some((x) => x.code === 'OP_INTENT_MISSING' && x.detail.includes(op.id)));
  assert.ok(report.findings.some((x) => x.code === 'OP_UNRESOLVED'));
  assert.equal(report.level, 'recorded');
  // with the intent event and a reconciled UNKNOWN result it is traceable with a warning
  f.journal.append({ type: 'OPERATION_INTENT', goalId: f.goalId, data: { operationId: op.id } });
  f.operations.markResult(op.id, 'UNKNOWN', { error: 'provider lost' }, now);
  const again = verifyAudit({ goalId: f.goalId, journal: f.journal, operations: f.operations, now });
  assert.equal(again.level, 'traceable');
  assert.ok(again.findings.some((x) => x.code === 'OP_UNKNOWN' && x.severity === 'warn'));
});

test('work after a terminal disposition and missing trace ids are blocking', () => {
  const f = fixture();
  f.journal.append({ type: 'GOAL_DONE', goalId: f.goalId });
  f.journal.append({ type: 'CARD_DISPATCHED', goalId: f.goalId, cardId: 'T1-A', data: { childRef: 'child-1' } });
  const report = verifyAudit({ goalId: f.goalId, journal: f.journal, now });
  assert.ok(report.findings.some((x) => x.code === 'WORK_AFTER_TERMINAL'));
  assert.equal(report.level, 'recorded');
  const g = fixture('g2');
  g.journal.append({ type: 'MODEL_INVOCATION', goalId: g.goalId, data: {} });
  const r2 = verifyAudit({ goalId: g.goalId, journal: g.journal, now });
  assert.ok(r2.findings.some((x) => x.code === 'TRACE_MISSING'));
});

test('altered artifact and stale-candidate evidence block independent verification', () => {
  const f = fixture();
  f.journal.append({ type: 'GOAL_CREATED', goalId: f.goalId });
  const manifest = sealWith(f, 'cand-old');
  const entry = manifest.entries[0]!;
  writeFileSync(path.join(f.evidence.dir, entry.path), 'exit 1', 'utf8');
  const altered = verifyAudit({ goalId: f.goalId, journal: f.journal, evidence: f.evidence, manifest, now });
  assert.ok(altered.findings.some((x) => x.code === 'ARTIFACT_ALTERED'));
  assert.equal(altered.level, 'traceable');
  assert.equal(altered.manifest?.sealOk, true);
  const stale = verifyAudit({ goalId: f.goalId, journal: f.journal, evidence: f.evidence, manifest, finalCandidateDigest: 'cand-new', now });
  assert.ok(stale.findings.some((x) => x.code === 'EVIDENCE_STALE_CANDIDATE'));
  // non-mutating bookkeeping after sealing is a warning only (closure notes may follow a seal)
  f.journal.append({ type: 'NOTE', goalId: f.goalId });
  const trailing = verifyAudit({ goalId: f.goalId, journal: f.journal, evidence: f.evidence, manifest, now });
  assert.ok(trailing.findings.some((x) => x.code === 'MANIFEST_TRAILING' && x.severity === 'warn'));
  assert.ok(!trailing.findings.some((x) => x.code === 'MANIFEST_STALE'));
  // a mutation after sealing => MANIFEST_STALE block
  f.journal.append({ type: 'CARD_DISPATCHED', goalId: f.goalId, data: { childRef: 'card:T1-X' } });
  const moved = verifyAudit({ goalId: f.goalId, journal: f.journal, evidence: f.evidence, manifest, now });
  assert.ok(moved.findings.some((x) => x.code === 'MANIFEST_STALE' && x.severity === 'block'));
});

test('unsealed manifest is a warning only', () => {
  const f = fixture();
  f.journal.append({ type: 'GOAL_CREATED', goalId: f.goalId });
  const m = f.evidence.retain(f.evidence.load(f.goalId, 0, 0, now), { id: 'a', kind: 'artifact', content: 'a' });
  const report = verifyAudit({ goalId: f.goalId, journal: f.journal, evidence: f.evidence, manifest: m, now });
  assert.equal(report.level, 'traceable');
  assert.ok(report.findings.some((x) => x.code === 'MANIFEST_UNSEALED' && x.severity === 'warn'));
});

test('fully-audited claim is BLOCKED/capability without a host capture boundary, verified with one', () => {
  const f = fixture();
  f.journal.append({ type: 'GOAL_CREATED', goalId: f.goalId });
  const manifest = sealWith(f);
  const blocked = verifyAudit({ goalId: f.goalId, journal: f.journal, evidence: f.evidence, manifest, hostCaptureBoundary: { present: false, detail: 'no OpenTelemetry export configured' }, now });
  assert.equal(blocked.claimedFullyAudited, true);
  assert.equal(blocked.fullyAuditedStatus, 'BLOCKED/capability');
  assert.ok(blocked.prerequisite?.includes('host capture boundary missing'));
  const verified = verifyAudit({ goalId: f.goalId, journal: f.journal, evidence: f.evidence, manifest, hostCaptureBoundary: { present: true, detail: 'otel export' }, now });
  assert.equal(verified.fullyAuditedStatus, 'verified');
  const g = fixture('g3');
  g.journal.append({ type: 'GOAL_CREATED', goalId: g.goalId });
  const notVerified = verifyAudit({ goalId: g.goalId, journal: g.journal, hostCaptureBoundary: { present: true, detail: 'otel' }, now });
  assert.equal(notVerified.level, 'traceable');
  assert.equal(notVerified.fullyAuditedStatus, 'BLOCKED/capability');
  assert.ok(notVerified.prerequisite?.includes('audit level is traceable'));
});

// BUG: an empty (or absent) journal verifies with zero problems, and the `traceable` promotion only
// checks `chain.ok`, so a goal with no events at all is reported as `traceable` instead of `none`.
test('an empty journal is level none, not traceable', () => {
  const g = fixture('g4');
  const report = verifyAudit({ goalId: g.goalId, journal: g.journal, now });
  assert.equal(report.journal.events, 0);
  assert.equal(report.level, 'none');
});
