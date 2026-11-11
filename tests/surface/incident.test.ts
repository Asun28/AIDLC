import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { IncidentLedger, intentFromBreach, writeIncidentIntent } from '../../src/maintain/incident.ts';
import { breachIdentity, type BandBreach } from '../../src/maintain/bands.ts';
import { parseIntent } from '../../src/artifacts/intent.ts';
import { makeFixture } from '../scenarios/_harness.ts';

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

test('the dedupe window starts at each filing: a breach refiled after the window is deduped again until the next window ends', () => {
  const ledger = new IncidentLedger(mkdtempSync(path.join(tmpdir(), 'aidlc-incident-')));
  const id = breachIdentity(breach);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, t0).file, true);
  ledger.attachIntent(id, 'intent/x.md', t0);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(5.9)).file, false);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(7)).file, true);
  ledger.attachIntent(id, 'intent/y.md', later(7));
  // The second window runs from hour 7, so hours 8 and 12.9 are inside it and hour 13.1 is past it.
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(8)).file, false);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(12.9)).file, false);
  const third = ledger.shouldFile(breach, 6 * HOUR, later(13.1));
  assert.equal(third.file, true);
  assert.equal(third.record.firstSeen, t0);
  assert.equal(third.record.filedAt, later(7));
});

test('a record filed before filedAt existed keeps its window from firstSeen', () => {
  const ledger = new IncidentLedger(mkdtempSync(path.join(tmpdir(), 'aidlc-incident-')));
  const id = breachIdentity(breach);
  ledger.write({ [id]: { identity: id, firstSeen: t0, lastSeen: t0, count: 1, intentFile: 'intent/x.md', disposition: 'open' } });
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(2)).file, false);
  assert.equal(ledger.shouldFile(breach, 6 * HOUR, later(7)).file, true);
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

test('aidlc monitor check --file-intent records the filing time on the incident, so the same breach inside the window files nothing', () => {
  const fx = makeFixture();
  try {
    writeFileSync(path.join(fx.tmp, 'bands.yaml'), ['metric: error_rate', 'direction: above', 'min_samples: 8', 'tiers:', '  1sigma: { action: log }', '  2sigma: { action: diagnose, tools: "Read" }', '  3sigma: { action: propose, routes: [pull_request] }', 'dedupe_window_ms: 21600000', ''].join('\n'), 'utf8');
    writeFileSync(path.join(fx.tmp, 'data.json'), JSON.stringify({ baseline: [9, 10, 11, 9, 10, 11, 9, 10, 11, 9, 10, 11], recent: [{ at: '2026-09-11T00:00:00.000Z', value: 14 }] }), 'utf8');
    const check = () => spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'monitor', 'check', '--bands', 'bands.yaml', '--data', 'data.json', '--file-intent'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000 });
    const first = check();
    assert.equal(first.status, 0, first.stderr);
    assert.equal((JSON.parse(first.stdout) as { filed: string[] }).filed.length, 1, first.stdout);
    const records = () => Object.values(new IncidentLedger(fx.paths.incidents).read());
    assert.equal(records().length, 1);
    const filed = records()[0]!;
    assert.ok(filed.intentFile);
    // The command passes the time of the check to the ledger: the window of the next check starts there.
    assert.equal(typeof filed.filedAt, 'string');
    assert.equal(filed.filedAt, filed.lastSeen);
    const second = check();
    assert.equal(second.status, 0, second.stderr);
    assert.deepEqual((JSON.parse(second.stdout) as { filed: string[] }).filed, []);
    assert.equal(records()[0]!.filedAt, filed.filedAt, 'a deduplicated check leaves the filing time as it was');
    assert.equal(records()[0]!.count, 2);
  } finally {
    fx.cleanup();
  }
});
