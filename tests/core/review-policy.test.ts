import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyVerdict, detectQuotaHold, findingMarker, parseVerdict, recordReviewOutcome, reviewRequestKey } from '../../src/core/review-policy.ts';
import { ReviewLedger, type Verdict } from '../../src/core/types.ts';
import { T0 } from './_fixtures.ts';

const SHA = 'a'.repeat(40);
const inv = (id: string) => ({ invocationId: id, candidateDigest: 'cand-1', base: 'main', policyVersion: 'v1', reviewer: 'codex', requestedAt: T0 });
const specBlock: Verdict = { verdict: 'block', reasons: ['[spec] 6 tests missing'], sha: SHA, run_status: 'success', axes: { spec: { verdict: 'block', reasons: ['tests missing'] }, standards: { verdict: 'pass', reasons: [] } } };
const standardsBlock: Verdict = { verdict: 'block', reasons: ['[standards] naming'], sha: SHA, run_status: 'success', axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: ['naming'] } } };
const pass: Verdict = { verdict: 'pass', reasons: [], sha: SHA, run_status: 'success' };

describe('parseVerdict (scaffold verdict.schema.json)', () => {
  test('enforces only the case-sensitive verdict enum; malformed shapes are undefined', () => {
    assert.equal(parseVerdict({ verdict: 'BLOCK', reasons: [] }), undefined);
    assert.equal(parseVerdict({ verdict: ['block'] }), undefined);
    assert.equal(parseVerdict('block'), undefined);
    assert.equal(parseVerdict(null), undefined);
    const v = parseVerdict({ verdict: 'block', reasons: ['x', 5], sha: SHA, run_status: 'weird', axes: { spec: { verdict: 'block', reasons: ['a'] }, standards: { verdict: 'nope' } }, routed_skip: { predicate: 'p', reason: 'r' } });
    assert.ok(v);
    assert.deepEqual(v.reasons, ['x']);
    assert.equal(v.run_status, undefined);
    assert.equal(v.axes?.spec?.verdict, 'block');
    assert.equal(v.axes?.standards, undefined);
    assert.deepEqual(v.routed_skip, { predicate: 'p', reason: 'r', changed_paths: [] });
  });
});

describe('classifyVerdict (Q6)', () => {
  test('Q6: pass with matching sha proceeds', () => {
    const c = classifyVerdict(pass, { candidateSha: SHA, tier: 'S' });
    assert.equal(c.outcome, 'pass');
    assert.equal(c.mergeBlocking, false);
  });

  test('Q6: spec-axis block on a Tier-S card blocks merge', () => {
    const c = classifyVerdict(specBlock, { candidateSha: SHA, tier: 'S' });
    assert.equal(c.outcome, 'block-defect');
    assert.equal(c.mergeBlocking, true);
  });

  test('spec-axis block on Tier 1 is advisory unless the gate is required', () => {
    assert.equal(classifyVerdict(specBlock, { candidateSha: SHA, tier: '1' }).outcome, 'block-advisory');
    assert.equal(classifyVerdict(specBlock, { candidateSha: SHA, tier: '1', gateRequired: true }).outcome, 'block-defect');
  });

  test('standards-only block is advisory at every tier; gateRequired makes it blocking', () => {
    assert.equal(classifyVerdict(standardsBlock, { candidateSha: SHA, tier: 'S' }).outcome, 'block-advisory');
    assert.equal(classifyVerdict(standardsBlock, { candidateSha: SHA, tier: 'S', gateRequired: true }).mergeBlocking, true);
  });

  test('a block without axes is read conservatively as a spec block', () => {
    const c = classifyVerdict({ verdict: 'block', reasons: ['x'], sha: SHA, run_status: 'success' }, { candidateSha: SHA });
    assert.equal(c.outcome, 'block-defect');
  });

  test('Q6: missing / malformed / stale / no_output / timeout never pass', () => {
    assert.equal(classifyVerdict(undefined).outcome, 'no-verdict');
    const stale = classifyVerdict(pass, { candidateSha: 'b'.repeat(40) });
    assert.equal(stale.outcome, 'no-verdict');
    assert.equal(stale.stale, true);
    assert.equal(classifyVerdict({ verdict: 'block', reasons: [], run_status: 'no_output' }).outcome, 'no-verdict');
    assert.equal(classifyVerdict({ verdict: 'block', reasons: [], run_status: 'malformed' }).outcome, 'no-verdict');
    assert.equal(classifyVerdict({ verdict: 'block', reasons: [], run_status: 'timeout' }).outcome, 'no-verdict');
    assert.equal(classifyVerdict({ verdict: 'pass', reasons: [], run_status: 'tool_error' }).outcome, 'no-verdict', 'a pass with a failed run is not a pass');
  });

  test('Q24: a verified quota hold is quota-hold, not a decision and not a defect', () => {
    assert.equal(classifyVerdict(undefined, { rawOutput: 'HTTP 429 Too Many Requests; retry-after: 120 s' }).outcome, 'quota-hold');
    assert.equal(classifyVerdict({ verdict: 'block', reasons: [], run_status: 'timeout' }, { rawOutput: 'usage limit reached' }).outcome, 'quota-hold');
    assert.deepEqual(detectQuotaHold('retry-after: 30s'), { hold: true, retryAfterMs: 30_000 });
    assert.deepEqual(detectQuotaHold('Retry-After: 2 min'), { hold: true, retryAfterMs: 120_000 });
    assert.deepEqual(detectQuotaHold('all good'), { hold: false });
    assert.deepEqual(detectQuotaHold(undefined), { hold: false });
  });

  test('routed skip is not a review that passed but does not block', () => {
    const c = classifyVerdict({ verdict: 'pass', reasons: [], routed_skip: { predicate: 'AllPathsMatch', reason: 'docs only', changed_paths: ['README.md'] } });
    assert.equal(c.outcome, 'routed-skip');
    assert.equal(c.mergeBlocking, false);
  });
});

describe('recordReviewOutcome ledger (Q6 / Q24)', () => {
  test('Q6: pass proceeds to merge and counts one substantive decision', () => {
    const { ledger, decision } = recordReviewOutcome(ReviewLedger.parse({}), inv('i1'), classifyVerdict(pass, { candidateSha: SHA, tier: 'S' }), pass, 1);
    assert.deepEqual(decision, { action: 'proceed-merge' });
    assert.equal(ledger.substantiveDecisions, 1);
    assert.equal(ledger.scriptCounter, 1);
    assert.equal(ledger.invocations[0]?.outcome, 'pass');
  });

  test('Q6: a defect block enters REVIEW-FIX with one decision remaining; a second block stops', () => {
    const c = classifyVerdict(specBlock, { candidateSha: SHA, tier: 'S' });
    const first = recordReviewOutcome(ReviewLedger.parse({}), inv('i1'), c, specBlock);
    assert.deepEqual(first.decision, { action: 'review-fix', remainingDecisions: 1 });
    assert.equal(first.ledger.substantiveBlocks, 1);
    const second = recordReviewOutcome(first.ledger, inv('i2'), c, specBlock);
    assert.equal(second.decision.action, 'stop-review');
    assert.match(second.decision.action === 'stop-review' ? second.decision.detail : '', /second substantive block/);
    assert.equal(second.ledger.substantiveDecisions, 2);
  });

  test('Q6: a required review beyond two decisions stops even without a second block', () => {
    const passC = classifyVerdict(pass, { candidateSha: SHA, tier: 'S' });
    const blockC = classifyVerdict(specBlock, { candidateSha: SHA, tier: 'S' });
    let l = recordReviewOutcome(ReviewLedger.parse({}), inv('i1'), blockC, specBlock).ledger;
    l = recordReviewOutcome(l, inv('i2'), passC, pass).ledger;
    assert.equal(l.substantiveDecisions, 2);
    const third = recordReviewOutcome(l, inv('i3'), blockC, specBlock);
    assert.equal(third.decision.action, 'stop-review');
  });

  test('Q6: no verdict gets exactly one retry across script and driver, then stops', () => {
    const nv = classifyVerdict(undefined);
    const first = recordReviewOutcome(ReviewLedger.parse({}), inv('i1'), nv, undefined);
    assert.deepEqual(first.decision, { action: 'retry-review', retriesLeft: 1 });
    assert.equal(first.ledger.noVerdictRetriesUsed, 1);
    assert.equal(first.ledger.substantiveDecisions, 0, 'infrastructure outcomes are not substantive');
    const second = recordReviewOutcome(first.ledger, inv('i2'), nv, undefined);
    assert.equal(second.decision.action, 'stop-review');
    assert.equal(second.ledger.noVerdictRetriesUsed, 2);
  });

  test('Q6: duplicate invocation identity is idempotent (dedupe by invocation, not file count)', () => {
    const c = classifyVerdict(specBlock, { candidateSha: SHA, tier: 'S' });
    const first = recordReviewOutcome(ReviewLedger.parse({}), inv('same'), c, specBlock);
    const replay = recordReviewOutcome(first.ledger, inv('same'), c, specBlock);
    assert.deepEqual(replay.ledger, first.ledger);
    assert.deepEqual(replay.decision, first.decision);
    assert.equal(replay.ledger.invocations.length, 1);
  });

  test('Q24: quota hold waits and consumes no substantive round', () => {
    const q = classifyVerdict(undefined, { rawOutput: 'rate limit exceeded' });
    const r = recordReviewOutcome(ReviewLedger.parse({}), inv('i1'), q, undefined);
    assert.equal(r.decision.action, 'wait-quota');
    assert.equal(r.ledger.substantiveDecisions, 0);
    assert.equal(r.ledger.noVerdictRetriesUsed, 0);
    assert.equal(r.ledger.invocations[0]?.outcome, 'quota-hold');
  });

  test('advisory block proceeds but is recorded as a decision', () => {
    const adv = classifyVerdict(standardsBlock, { candidateSha: SHA, tier: 'S' });
    const r = recordReviewOutcome(ReviewLedger.parse({}), inv('i1'), adv, standardsBlock);
    assert.deepEqual(r.decision, { action: 'proceed-merge' });
    assert.equal(r.ledger.substantiveDecisions, 1);
    assert.equal(r.ledger.substantiveBlocks, 0);
  });
});

describe('keys and markers', () => {
  test('reviewRequestKey normalises case and whitespace (MS3 dedupe key)', () => {
    const a = reviewRequestKey({ repository: 'Org/Repo', candidateDigest: 'ABC', base: 'main ', policyVersion: 'v1', reviewer: 'Codex' });
    const b = reviewRequestKey({ repository: 'org/repo', candidateDigest: 'abc', base: 'main', policyVersion: 'v1', reviewer: 'codex' });
    assert.equal(a, b);
    assert.notEqual(a, reviewRequestKey({ repository: 'org/repo', candidateDigest: 'abd', base: 'main', policyVersion: 'v1', reviewer: 'codex' }));
  });

  test('findingMarker is stable and bounded', () => {
    const m = findingMarker('T1-A', 12, SHA, 'Missing test for the empty case!');
    assert.equal(m, findingMarker('T1-A', 12, SHA, 'Missing test for the empty case!'));
    assert.match(m, /^aidlc-finding:T1-A:12:aaaaaaaaaaaa:missing-test-for-the-empty-case$/);
    assert.match(findingMarker('T1-A', undefined, SHA, 'x'), /:nopr:/);
  });
});
