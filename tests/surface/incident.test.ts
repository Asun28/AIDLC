import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IncidentLedger, intentFromBreach, writeIncidentIntent } from '../../src/maintain/incident.ts';
import { breachIdentity, type BandBreach } from '../../src/maintain/bands.ts';
import { parseIntent } from '../../src/artifacts/intent.ts';

const breach: BandBreach = {
  metric: 'ci_test_failure_rate',
  rule: 'WE1',
  sigma: 3,
  side: 'above',
  tier: '3sigma',
  action: 'propose',
  observed: [0.42],
  baseline: { mean: 0.05, std: 0.02, n: 30 },
  at: '2026-09-11T00:00:00.000Z',
  detail: 'one point 18.5σ from baseline mean 0.050',
};
const HOUR = 60 * 60 * 1000;
const t0 = '2026-09-11T00:00:00.000Z';
const later = (h: number) => new Date(Date.parse(t0) + h * HOUR).toISOString();

test('shouldFile files once, dedupes within the window, respects dismissal and refiles after the window', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-incident-'));
  const ledger = new IncidentLedger(dir);
  const first = ledger.shouldFile(breach, 6 * HOUR, t0);
  assert.equal(first.file, true);
  assert.equal(first.record.count, 1);
  const id = breachIdentity(breach);
  // without an intent attached yet, a repeat still asks to file
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(1)).file, true);
  ledger.attachIntent(id, 'intent/x.md');
  const again = ledger.shouldFile(breach, 6 * HOUR, later(2));
  assert.equal(again.file, false);
  assert.equal(again.record.count, 3);
  assert.equal(again.record.intentFile, 'intent/x.md');
  // after the window it refiles
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(7)).file, true);
  // dismissed never refiles
  assert.equal(ledger.triage(id, 'dismissed', 'known flaky')?.dismissReason, 'known flaky');
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(20)).file, false);
  assert.equal(ledger.triage('nope', 'fix-now'), undefined);
  assert.ok(existsSync(ledger.file));
});

test('intentFromBreach + writeIncidentIntent produce a parseable incident intent', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-intent-'));
  const intent = intentFromBreach(
    breach,
    { summary: 'Test failure rate spiked after the 09:00 deploy.', affected: 'CI pipeline, deploy job', proposedOutcome: 'Quarantine the flaky test or revert the deploy.', openQuestions: ['Was the deploy the cause?'], evidence: ['gh run view 123'] },
    t0,
  );
  assert.equal(intent.source, 'incident');
  assert.equal(intent.status, 'draft');
  assert.ok(intent.problem.includes('Anomaly: one point'));
  assert.ok(intent.constraints.includes('Tier action: propose'));
  const file = writeIncidentIntent(path.join(dir, 'intent'), intent);
  assert.ok(existsSync(file));
  const parsed = parseIntent(readFileSync(file, 'utf8'));
  assert.equal(parsed.ok, true, parsed.problems.join('; '));
  assert.deepEqual(parsed.intent?.openQuestions, ['Was the deploy the cause?']);
  assert.ok(readFileSync(file, 'utf8').includes('source: incident'));
  assert.ok(readFileSync(file, 'utf8').includes('- gh run view 123'));
});
