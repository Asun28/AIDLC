import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, driveCardToDone, candidateShaFor } from './_harness.ts';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';

function finishedGoal(fx: ReturnType<typeof makeFixture>) {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goal = goalForCards(fx, ['T1-HELLO']);
  driveCardToDone(fx, goal.id, 'T1-HELLO');
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
  assert.equal(fx.goal(goal.id).state, 'DONE');
  return goal.id;
}

function sealed(fx: ReturnType<typeof makeFixture>, goalId: string) {
  const ev = new EvidenceStore(fx.paths.evidence, goalId);
  const digest = candidateShaFor('T1-HELLO');
  let manifest = ev.load(goalId, 0, 0, fx.now());
  manifest = ev.retain(manifest, { id: 'dod-receipt', kind: 'dod-receipt', content: 'node --test: 3 pass', candidateDigest: digest });
  fx.journal(goalId).append({ type: 'MANIFEST_SEALED', goalId, generation: 0, data: { entries: manifest.entries.length } });
  const head = fx.journal(goalId).head();
  manifest = ev.seal(manifest, { journalHead: head.hash, journalEvents: head.seq + 1, finalSha: digest, finalCandidateDigest: digest, now: fx.now() });
  return { ev, manifest, digest };
}

test('Q12: a completed goal with sealed evidence verifies as independently-verified', () => {
  const fx = makeFixture();
  try {
    const goalId = finishedGoal(fx);
    const { ev, manifest, digest } = sealed(fx, goalId);
    const report = verifyAudit({ goalId, journal: fx.journal(goalId), operations: fx.ops, evidence: ev, manifest, finalCandidateDigest: digest, now: fx.now() });
    assert.equal(report.level, 'independently-verified', JSON.stringify(report.findings));
    assert.equal(report.journal.ok, true);
    assert.equal(report.manifest?.sealOk, true);
    assert.equal(report.fullyAuditedStatus, 'not-claimed');
    assert.deepEqual(report.findings.filter((f) => f.severity === 'block'), []);
  } finally {
    fx.cleanup();
  }
});

test('Q12: a mutation after the seal makes the manifest stale', () => {
  const fx = makeFixture();
  try {
    const goalId = finishedGoal(fx);
    const { ev, manifest, digest } = sealed(fx, goalId);
    fx.journal(goalId).append({ type: 'CARD_DISPATCHED', goalId, generation: 0, cardId: 'T1-HELLO', data: { childRef: 'card:T1-HELLO' } });
    const report = verifyAudit({ goalId, journal: fx.journal(goalId), operations: fx.ops, evidence: ev, manifest, finalCandidateDigest: digest, now: fx.now() });
    assert.ok(report.findings.some((f) => f.code === 'MANIFEST_STALE' && f.severity === 'block'), JSON.stringify(report.findings));
    assert.ok(report.findings.some((f) => f.code === 'WORK_AFTER_TERMINAL'));
    assert.notEqual(report.level, 'independently-verified');
  } finally {
    fx.cleanup();
  }
});

test('Q12: a tampered journal line breaks the chain and drops the level to recorded', () => {
  const fx = makeFixture();
  try {
    const goalId = finishedGoal(fx);
    const { ev, manifest, digest } = sealed(fx, goalId);
    const file = fx.journal(goalId).file;
    const lines = readFileSync(file, 'utf8').trim().split('\n');
    const idx = 3;
    const obj = JSON.parse(lines[idx]!) as { data: Record<string, unknown> };
    obj.data['tampered'] = true;
    lines[idx] = JSON.stringify(obj);
    writeFileSync(file, lines.join('\n') + '\n', 'utf8');
    const report = verifyAudit({ goalId, journal: fx.journal(goalId), operations: fx.ops, evidence: ev, manifest, finalCandidateDigest: digest, now: fx.now() });
    assert.equal(report.journal.ok, false);
    assert.ok(report.findings.some((f) => f.code === 'JOURNAL_CHAIN'));
    assert.equal(report.level, 'recorded');
  } finally {
    fx.cleanup();
  }
});

test('Q12/LC12: a "fully audited" claim without a host capture boundary is BLOCKED/capability with the prerequisite named', () => {
  const fx = makeFixture();
  try {
    const goalId = finishedGoal(fx);
    const { ev, manifest, digest } = sealed(fx, goalId);
    const blocked = verifyAudit({ goalId, journal: fx.journal(goalId), operations: fx.ops, evidence: ev, manifest, finalCandidateDigest: digest, hostCaptureBoundary: { present: false, detail: 'no host capture boundary asserted' }, now: fx.now() });
    assert.equal(blocked.level, 'independently-verified');
    assert.equal(blocked.fullyAuditedStatus, 'BLOCKED/capability');
    assert.ok(/capture boundary/.test(blocked.prerequisite ?? ''));
    const verified = verifyAudit({ goalId, journal: fx.journal(goalId), operations: fx.ops, evidence: ev, manifest, finalCandidateDigest: digest, hostCaptureBoundary: { present: true, detail: 'asserted' }, now: fx.now() });
    assert.equal(verified.fullyAuditedStatus, 'verified');
  } finally {
    fx.cleanup();
  }
});
