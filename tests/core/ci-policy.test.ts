import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canRerun, classifyCiFailure, hasUnreconciledRerun, reconcileRerun, recordRerunIntent } from '../../src/core/ci-policy.ts';
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
