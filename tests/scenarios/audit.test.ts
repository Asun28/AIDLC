import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, driveCardToDone, candidateShaFor } from './_harness.ts';
import { HOUR_MS, MINUTE_MS, addMs } from '../../src/core/types.ts';
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

test('T0-AUDIT-READMIT acceptance 4: a goal stopped, resumed with a replacement card and driven to DONE verifies at traceable with no WORK_AFTER_TERMINAL', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    writeCard(fx, { id: 'T1-HELLO-2', title: 'print hello, replacement' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'the card spent its review allowance on provider timeouts' } });
    assert.equal(fx.goal(goal.id).terminal, true);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'user approved a replacement card', replacements: { 'T1-HELLO': 'T1-HELLO-2' } } });
    assert.equal(fx.goal(goal.id).generation, 1);
    driveCardToDone(fx, goal.id, 'T1-HELLO-2');
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 1, result: 'arc-verified', data: {} });
    assert.equal(fx.goal(goal.id).state, 'DONE');
    const takeover = fx.events(goal.id).find((e) => e.type === 'GOAL_TAKEOVER');
    assert.equal(takeover?.generation, 1, 'the resume journals its takeover in the new generation');
    assert.equal(takeover?.data['linkedFrom'], `${goal.id}@0`, 'the resume names the generation it links from');
    const types = fx.events(goal.id).map((e) => e.type);
    assert.ok(types.indexOf('GOAL_STOPPED') < types.indexOf('GOAL_TAKEOVER') && types.lastIndexOf('CARD_DISPATCHED') > types.indexOf('GOAL_TAKEOVER'), `the journal carries a stop, a resume and work after it: ${types.join(', ')}`);
    const report = verifyAudit({ goalId: goal.id, journal: fx.journal(goal.id), operations: fx.ops, now: fx.now() });
    assert.equal(report.findings.find((f) => f.code === 'WORK_AFTER_TERMINAL'), undefined, JSON.stringify(report.findings));
    assert.equal(report.level, 'traceable', JSON.stringify(report.findings));
  } finally {
    fx.cleanup();
  }
});

test('T0-AUDIT-READMIT acceptance 2 end to end: a goal stopped for time, re-admitted by a deadline extension and driven to DONE verifies at traceable with no WORK_AFTER_TERMINAL', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const runner = fx.runner();
    let r = runner.next(fx.goal(goal.id), fx.card('T1-HELLO'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), fx.card('T1-HELLO'), r.run);
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    runner.next(fx.goal(goal.id), fx.card('T1-HELLO'), r.run);
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    fx.controller.extendDeadline(goal.id, 'lead', addMs(fx.now(), 6 * HOUR_MS), 'the reviews and the ship remain');
    // The re-admitted card continues from BUILD: the attempt, the ship, the closure.
    const card = fx.card('T1-HELLO');
    r = runner.next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:T1-HELLO', redReceipt: 'red:T1-HELLO', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    const run2 = runner.markClosure(fx.goal(goal.id), card, r.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true }, { skipped: 'fixture: no rule learned' });
    assert.equal(runner.next(fx.goal(goal.id), card, run2).directive.kind, 'done');
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
    assert.equal(fx.goal(goal.id).state, 'DONE');
    const events = fx.events(goal.id);
    const stop = events.findIndex((e) => e.type === 'GOAL_STOPPED');
    assert.equal(events[stop]?.data['reason'], 'time', 'the controller journals the time stop with its reason');
    const readmit = events.findIndex((e) => e.type === 'GOAL_STATE' && e.data['from'] === 'STOP');
    assert.equal(events[readmit]?.data['to'], 'CARDS', 'the extension journals STOP to CARDS');
    assert.ok(stop < readmit && events.slice(readmit).some((e) => ['CARD_DISPATCHED', 'OPERATION_ISSUED', 'ATTEMPT_STARTED'].includes(e.type)), `work follows the re-admission: ${events.map((e) => e.type).join(', ')}`);
    const report = verifyAudit({ goalId: goal.id, journal: fx.journal(goal.id), operations: fx.ops, now: fx.now() });
    assert.equal(report.findings.find((f) => f.code === 'WORK_AFTER_TERMINAL'), undefined, JSON.stringify(report.findings));
    assert.equal(report.level, 'traceable', JSON.stringify(report.findings));
  } finally {
    fx.cleanup();
  }
});
