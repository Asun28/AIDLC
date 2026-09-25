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

/** Journal a sequence of [type, generation, data] events for one goal and verify it. */
function journalOf(events: Array<[string, number | undefined, Record<string, unknown>?]>, goalId = 'g-readmit') {
  const f = fixture(goalId);
  for (const [type, generation, data] of events) f.journal.append({ type, goalId: f.goalId, generation, data: data ?? {} } as Parameters<Journal['append']>[0]);
  return verifyAudit({ goalId: f.goalId, journal: f.journal, now });
}
const afterTerminal = (report: ReturnType<typeof verifyAudit>) => report.findings.find((x) => x.code === 'WORK_AFTER_TERMINAL');
const dispatch = (generation: number): [string, number, Record<string, unknown>] => ['CARD_DISPATCHED', generation, { childRef: 'card:T0-X' }];
const attempt = (generation: number): [string, number, Record<string, unknown>] => ['ATTEMPT_STARTED', generation, { n: 1 }];
const resume = (generation: number): [string, number, Record<string, unknown>] => ['GOAL_TAKEOVER', generation, { linkedFrom: `g-readmit@${generation - 1}`, reason: 'user resume' }];

test('T0-AUDIT-READMIT acceptance 1: the continuation of a resumed goal is not work after a terminal disposition', () => {
  const report = journalOf([['GOAL_CREATED', 0], dispatch(0), ['GOAL_STOPPED', 0, { reason: 'tool' }], resume(1), dispatch(1), attempt(1), ['OPERATION_ISSUED', 1, { operationId: 'op-1' }], ['GOAL_DONE', 1]]);
  assert.equal(afterTerminal(report), undefined, JSON.stringify(report.findings));
  assert.equal(report.level, 'traceable', JSON.stringify(report.findings));
});

test('T0-AUDIT-READMIT acceptance 2: the continuation of a time stop re-admitted by a deadline extension is not work after a terminal disposition', () => {
  const report = journalOf([['GOAL_CREATED', 0], dispatch(0), ['GOAL_STOPPED', 0, { reason: 'time' }], ['NOTE', 0, { extension: { by: 'user', newDeadline: '2026-09-11T06:00:00.000Z' } }], ['GOAL_STATE', 0, { from: 'STOP', to: 'CARDS' }], dispatch(0), attempt(0), ['GOAL_DONE', 0]]);
  assert.equal(afterTerminal(report), undefined, JSON.stringify(report.findings));
  assert.equal(report.level, 'traceable', JSON.stringify(report.findings));
  // The latest terminal disposition is the one the extension ends, not the first one journaled.
  const latest = journalOf([['GOAL_DONE', 0], ['GOAL_STOPPED', 0, { reason: 'time' }], ['GOAL_STATE', 0, { from: 'STOP', to: 'CARDS' }], dispatch(0)], 'g-latest');
  assert.equal(afterTerminal(latest), undefined, JSON.stringify(latest.findings));
});

test('T0-AUDIT-READMIT acceptance 3: work after the last terminal disposition, late work of the stopped generation and work after a lease takeover still block', () => {
  const cases: Array<[string, Array<[string, number | undefined, Record<string, unknown>?]>, number]> = [
    ['work after GOAL_DONE with no re-admission', [['GOAL_CREATED', 0], ['GOAL_DONE', 0], dispatch(0)], 1],
    ['every kind of work after GOAL_DONE counts', [['GOAL_DONE', 0], dispatch(0), attempt(0), ['OPERATION_ISSUED', 0, { operationId: 'op-9' }]], 3],
    ['a work event that names no generation after the generation-1 resume', [['GOAL_STOPPED', 0], resume(1), ['CARD_DISPATCHED', undefined, { childRef: 'card:T0-X' }]], 1],
    ['a lease takeover that names a later generation re-admits nothing', [['GOAL_STOPPED', 0], ['GOAL_TAKEOVER', 1, { leaseGeneration: 3 }], dispatch(1)], 1],
    ['work after the final GOAL_DONE of a resumed goal', [['GOAL_STOPPED', 0], resume(1), dispatch(1), ['GOAL_DONE', 1], attempt(1)], 1],
    ['a generation-0 dispatch after the generation-1 resume', [['GOAL_STOPPED', 0], resume(1), dispatch(0), dispatch(1)], 1],
    ['a generation-0 dispatch after a generation-1 resume with no stop journaled before it', [resume(1), dispatch(0), dispatch(1)], 1],
    // R2 cycle 0 round 2: a later takeover naming a lower generation never lowers the generation work is checked against,
    // and never ends a stop of a higher generation.
    ['a generation-0 dispatch after a resume to 1 and a later takeover naming generation 0', [['GOAL_STOPPED', 0], resume(1), ['GOAL_TAKEOVER', 0, { linkedFrom: 'g-readmit@0' }], dispatch(0)], 1],
    ['a takeover naming generation 1 after a resume to 2 and a stop of generation 2', [['GOAL_STOPPED', 0], resume(2), ['GOAL_STOPPED', 2], ['GOAL_TAKEOVER', 1, { linkedFrom: 'g-readmit@0' }], dispatch(2)], 1],
    ['work after a lease takeover that follows GOAL_STOPPED', [['GOAL_STOPPED', 0], ['GOAL_TAKEOVER', undefined, { leaseGeneration: 2, report: {} }], dispatch(0)], 1],
    ['a resume that does not move the generation re-admits nothing', [['GOAL_STOPPED', 1], ['GOAL_TAKEOVER', 1, { linkedFrom: 'g-readmit@0' }], dispatch(1)], 1],
    ['a GOAL_STATE from STOP after GOAL_DONE re-admits nothing', [['GOAL_DONE', 0, { reason: 'time' }], ['GOAL_STATE', 0, { from: 'STOP', to: 'CARDS' }], dispatch(0)], 1],
    ['a GOAL_STATE from STOP of another generation re-admits nothing', [['GOAL_STOPPED', 1, { reason: 'time' }], ['GOAL_STATE', 0, { from: 'STOP', to: 'CARDS' }], dispatch(1)], 1],
    ['a GOAL_STATE that is not from STOP re-admits nothing', [['GOAL_STOPPED', 0, { reason: 'time' }], ['GOAL_STATE', 0, { from: 'RUN', to: 'CARDS' }], attempt(0)], 1],
    // R2 cycle 0 round 1: only the extension's transition, STOP to CARDS after a time stop, re-admits.
    ['a GOAL_STATE from STOP to anything but CARDS re-admits nothing', [['GOAL_STOPPED', 0, { reason: 'time' }], ['GOAL_STATE', 0, { from: 'STOP', to: 'DONE' }], dispatch(0)], 1],
    ['a GOAL_STATE from STOP to CARDS after a stop that is not for time re-admits nothing', [['GOAL_STOPPED', 0, { reason: 'review' }], ['GOAL_STATE', 0, { from: 'STOP', to: 'CARDS' }], dispatch(0)], 1],
    ['a GOAL_STATE from STOP to CARDS after a stop that names no reason re-admits nothing', [['GOAL_STOPPED', 0], ['GOAL_STATE', 0, { from: 'STOP', to: 'CARDS' }], dispatch(0)], 1],
  ];
  for (const [name, events, count] of cases) {
    const report = journalOf(events, `g-${cases.findIndex((c) => c[0] === name)}`);
    const finding = afterTerminal(report);
    assert.ok(finding && finding.severity === 'block', `${name}: ${JSON.stringify(report.findings)}`);
    assert.equal(finding.detail, `${count} mutation event(s) after terminal disposition`, name);
    assert.equal(report.level, 'recorded', name);
  }
});

test('T0-AUDIT-READMIT acceptance 5: docs/OPERATIONS.md and the CHANGELOG Unreleased section state which events re-admit a goal for WORK_AFTER_TERMINAL', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  const docSentences = [
    '`WORK_AFTER_TERMINAL` counts a dispatch, an issued operation or an attempt only when the latest disposition journaled before it is terminal (`GOAL_DONE` or `GOAL_STOPPED`); a user-authorised re-admission ends that state: the `GOAL_TAKEOVER` of `aidlc goal resume`, which names the generation it links from and moves to a later one, or the `GOAL_STATE` from `STOP` to `CARDS` that `aidlc goal extend` writes in the stopped generation when it re-admits a time stop, so the continuation of a resumed or extended goal is not work after a terminal disposition (card T0-AUDIT-READMIT).',
    'A lease takeover (`aidlc goal takeover`) re-admits nothing, and work journaled by a generation below the latest resume still blocks.',
  ];
  for (const sentence of docSentences) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  const changelogSentences = [
    '- Audit re-admission, card T0-AUDIT-READMIT: `aidlc audit verify` no longer reports `WORK_AFTER_TERMINAL` for the work of a goal the user re-admitted with `aidlc goal resume` or with `aidlc goal extend` after a time stop, which dropped such a goal to `recorded`; it counts a dispatch, an issued operation or an attempt only when the latest disposition before it is `GOAL_DONE` or `GOAL_STOPPED`.',
    'Work after the final disposition, work of a generation below the latest resume and work after a lease takeover still block.',
    'Of the goals in this repository\'s state when this card ran, the four that were resumed (g-20260915193112-db0472, g-20260917214550-c76e7f, g-20260918021545-195e85 and g-20260925014420-bcf1ef) reported 4, 4, 5 and 4 such events and now report none; every other goal reports what it reported before (docs/OPERATIONS.md).',
  ];
  for (const sentence of changelogSentences) assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
});
