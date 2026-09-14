import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canRerun, classifyCiFailure, gateChecks, gateRedChecks, gateRedNames, hasUnreconciledRerun, reconcileRerun, recordRerunIntent } from '../../src/core/ci-policy.ts';
import { CiLedger } from '../../src/core/types.ts';
import { T0 } from './_fixtures.ts';

describe('CI classification (Q7)', () => {
  test('transient infrastructure patterns classify as transient', () => {
    const c = classifyCiFailure([{ name: 'test', conclusion: 'failure', logExcerpt: 'npm ERR! network read ECONNRESET' }]);
    assert.equal(c.class, 'transient');
    assert.deepEqual(c.failedJobs, ['test']);
    assert.ok(c.evidence.some((e) => e.startsWith('transient:')));
  });

  test('deterministic test failures classify as code defects and win over transient noise', () => {
    const c = classifyCiFailure([{ name: 'test', conclusion: 'failure', logExcerpt: 'AssertionError: expected 1 to equal 2\nsocket hang up' }]);
    assert.equal(c.class, 'code-defect');
    assert.ok(c.evidence.some((e) => e.startsWith('code:')));
  });

  test('no evidence is unknown; extra log text is considered', () => {
    assert.equal(classifyCiFailure([{ name: 'lint', conclusion: 'failure' }]).class, 'unknown');
    assert.equal(classifyCiFailure([{ name: 'lint', conclusion: 'failure' }], 'The hosted runner encountered an error and lost communication').class, 'transient');
  });

  test('successful / neutral / skipped jobs are not failures', () => {
    const c = classifyCiFailure([
      { name: 'a', conclusion: 'success' },
      { name: 'b', conclusion: 'neutral' },
      { name: 'c', conclusion: 'skipped' },
    ]);
    assert.deepEqual(c.failedJobs, []);
    assert.equal(c.class, 'unknown');
  });

  test('a cancelled job without code evidence is transient only with transient evidence', () => {
    assert.equal(classifyCiFailure([{ name: 'a', conclusion: 'cancelled', logExcerpt: 'The operation was canceled.' }]).class, 'transient');
    assert.equal(classifyCiFailure([{ name: 'a', conclusion: 'cancelled' }]).class, 'unknown');
  });
});

describe('CI rerun allowance (Q7)', () => {
  test('Q7: a code defect never reruns; unknown must be diagnosed first', () => {
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', 'code-defect').allowed, false);
    assert.match(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', 'code-defect').reason, /repair in BUILD/);
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', 'unknown').allowed, false);
  });

  test('Q7: a justified transient failure reruns once per candidate; the intent is persisted first', () => {
    let ledger = CiLedger.parse({});
    assert.equal(canRerun(ledger, 'run-1', 1, 'cand-1', 'transient').allowed, true);
    ledger = recordRerunIntent(ledger, 'run-1', 1, 'cand-1', T0);
    assert.equal(ledger.reruns[0]?.outcome, 'requested');
    assert.equal(hasUnreconciledRerun(ledger), true);
    assert.equal(canRerun(ledger, 'run-1', 2, 'cand-1', 'transient').allowed, false, 'allowance consumed for the candidate');
    assert.equal(canRerun(ledger, 'run-2', 1, 'cand-1', 'transient').allowed, false);
  });

  test('Q7: a lost or queued rerun response still consumes the allowance', () => {
    let ledger = recordRerunIntent(CiLedger.parse({}), 'run-1', 1, 'cand-1', T0);
    ledger = reconcileRerun(ledger, 'run-1', 1, 'lost', T0);
    assert.equal(ledger.reruns[0]?.outcome, 'lost');
    assert.equal(ledger.reruns[0]?.reconciledAt, T0);
    assert.equal(hasUnreconciledRerun(ledger), true, 'a lost response must be looked up before any further CI action');
    assert.equal(canRerun(ledger, 'run-1', 2, 'cand-1', 'transient').allowed, false);
    ledger = reconcileRerun(ledger, 'run-1', 1, 'queued', T0);
    assert.equal(canRerun(ledger, 'run-1', 2, 'cand-1', 'transient').allowed, false);
  });

  test('a cancelled rerun does not count; a new candidate has its own allowance', () => {
    let ledger = recordRerunIntent(CiLedger.parse({}), 'run-1', 1, 'cand-1', T0);
    ledger = reconcileRerun(ledger, 'run-1', 1, 'cancelled', T0);
    assert.equal(hasUnreconciledRerun(ledger), false);
    assert.equal(canRerun(ledger, 'run-1', 2, 'cand-1', 'transient').allowed, true);
    ledger = recordRerunIntent(ledger, 'run-1', 2, 'cand-1', T0);
    ledger = reconcileRerun(ledger, 'run-1', 2, 'success', T0);
    assert.equal(canRerun(ledger, 'run-3', 1, 'cand-2', 'transient').allowed, true);
    assert.equal(canRerun(ledger, 'run-3', 1, 'cand-1', 'transient').allowed, false);
  });
});

describe('security class (T1-LOOP-GATES R7)', () => {
  test('a failed check run named for a secret scan classifies as security from the ship gate line', () => {
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] Gitleaks (committed history)=failure\n[SAGA-FAIL]\n[SAGA-RESUME] aidlc card next T1-A' }]);
    assert.equal(c.class, 'security');
    assert.ok(c.evidence.includes('security: Gitleaks (committed history)'), c.evidence.join(' | '));
  });

  test('a raw gitleaks log classifies as security, as job text or as extra log text', () => {
    const log = 'Finding:     REDACTED\nSecret:      REDACTED\nRuleID:      generic-api-key\nEntropy:     4.2\n\n1:23PM WRN leaks found: 2';
    assert.equal(classifyCiFailure([{ name: 'log', conclusion: 'failure', logExcerpt: log }]).class, 'security');
    assert.equal(classifyCiFailure([{ name: 'log', conclusion: 'failure' }], log).class, 'security');
  });

  test('a failed job named for the secret scan classifies as security by its name; a green scan is no failure', () => {
    assert.equal(classifyCiFailure([{ name: 'Gitleaks (committed history)', conclusion: 'failure' }]).class, 'security');
    assert.equal(classifyCiFailure([{ name: 'Gitleaks (committed history)', conclusion: 'success' }]).class, 'unknown');
  });

  test('security wins over code-defect and transient evidence, even when the scan name carries a comma-bearing neighbour', () => {
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] check (ubuntu-latest, 22)=failure,Gitleaks (committed history)=failure\nAssertionError: expected 1 to equal 2\nsocket hang up' }]);
    assert.equal(c.class, 'security');
    assert.deepEqual(c.failedJobs, ['ship-ci-gate']);
  });

  test('a red check without a secret-scan name is not security', () => {
    assert.equal(classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] check (ubuntu-latest, 22)=failure' }]).class, 'unknown');
    assert.equal(classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] check (ubuntu-latest, 22)=failure\nAssertionError: expected 1 to equal 2' }]).class, 'code-defect');
  });

  test('native check names with =value fragments survive the gate-line parser; transient noise never earns the scan a rerun', () => {
    const line = '[CI-GATE-RED] scan (tool=gitleaks, os=linux)=failure,ci (node=22)=success';
    assert.deepEqual(gateRedNames(line), ['scan (tool=gitleaks, os=linux)', 'ci (node=22)']);
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: `${line}\nread ECONNRESET while fetching artifact` }]);
    assert.equal(c.class, 'security', c.evidence.join(' | '));
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', c.class).allowed, false);
  });

  test('underscore-separated secret-scan names classify as security; competing transient evidence never earns a rerun', () => {
    assert.equal(classifyCiFailure([{ name: 'secret_scan', conclusion: 'failure' }]).class, 'security');
    assert.equal(classifyCiFailure([{ name: 'secret-scanning', conclusion: 'failure' }]).class, 'security');
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] secret_scan=failure\nnpm ERR! network read ECONNRESET' }]);
    assert.equal(c.class, 'security', c.evidence.join(' | '));
    assert.equal(canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', c.class).allowed, false);
  });

  test('the JSON gate line keeps names with newlines, commas and sentinel-like text; brackets and percent signs decode', () => {
    const jsonLine = '[CI-GATE-RED] [{"name":"scan (tool=gitleaks,\\nos=linux)","conclusion":"failure"},{"name":"%5BSHIP-MERGE-FAIL%5D 100%25 diagnostics","conclusion":"success"}]';
    assert.deepEqual(gateChecks(jsonLine), [{ name: 'scan (tool=gitleaks,\nos=linux)', conclusion: 'failure' }, { name: '[SHIP-MERGE-FAIL] 100% diagnostics', conclusion: 'success' }]);
    const c = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: jsonLine + '\nread ECONNRESET while fetching artifact' }]);
    assert.equal(c.class, 'security', c.evidence.join(' | '));
    assert.equal(gateChecks('[CI-GATE-TIMEOUT] 2 pending checks: [{"name":"ci","conclusion":null,"status":"in_progress"},{"name":"x","conclusion":null,"status":"absent"}]')?.length, 2, 'the timeout line is structured too');
    assert.equal(gateChecks('[CI-GATE-RED] build=failure'), undefined, 'the pair form is not the JSON form');
  });

  test('a green scan next to a red build is a code defect, in the pair form and in the JSON form', () => {
    assert.deepEqual(gateRedChecks('[CI-GATE-RED] Gitleaks (committed history)=success,build-test=failure'), [{ name: 'Gitleaks (committed history)', conclusion: 'success' }, { name: 'build-test', conclusion: 'failure' }]);
    const pair = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] Gitleaks (committed history)=success,build-test=failure\nAssertionError: expected 1 to equal 2' }]);
    assert.equal(pair.class, 'code-defect', pair.evidence.join(' | '));
    const json = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: 'failure', logExcerpt: '[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"success"},{"name":"build-test","conclusion":"failure"}]\nAssertionError: expected 1 to equal 2' }]);
    assert.equal(json.class, 'code-defect', json.evidence.join(' | '));
  });

  test('security never reruns', () => {
    const d = canRerun(CiLedger.parse({}), 'run-1', 1, 'cand-1', 'security');
    assert.equal(d.allowed, false);
    assert.match(d.reason, /security gate/);
  });
});
