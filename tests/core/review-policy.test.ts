import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectQuotaHold } from '../../src/core/parse-guard.ts';
import { classifyVerdict, findingMarker, parseVerdict, recordReviewOutcome, reviewRequestKey } from '../../src/core/review-policy.ts';
// Namespace import for the finding bookkeeping (T1-REVIEW-FINDINGS): on the baseline the functions are absent and each
// test fails at its first call, so the RED is the behaviour, not a link error that aborts the file.
import * as policy from '../../src/core/review-policy.ts';
import { ReviewFinding, ReviewLedger, type Verdict } from '../../src/core/types.ts';
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
    assert.equal(classifyVerdict(undefined, { receipt: { exitCode: 1, stdout: 'HTTP 429 Too Many Requests; retry-after: 120 s', stderr: '' } }).outcome, 'quota-hold');
    assert.equal(classifyVerdict({ verdict: 'block', reasons: [], run_status: 'timeout' }, { receipt: { exitCode: 1, stdout: 'usage limit reached', stderr: '' } }).outcome, 'quota-hold');
    assert.deepEqual(detectQuotaHold('retry-after: 30s'), { hold: true, via: 'text', evidence: 'retry-after', retryAfterMs: 30_000 });
    assert.deepEqual(detectQuotaHold('Retry-After: 2 min'), { hold: true, via: 'text', evidence: 'Retry-After', retryAfterMs: 120_000 });
    assert.deepEqual(detectQuotaHold('all good'), { hold: false, via: 'text' });
    assert.deepEqual(detectQuotaHold(undefined), { hold: false, via: 'text' });
  });

  test('T1-PARSE-GUARD acceptance 6: a ship-path quota hold records the path that decided in its reasons, and a receipt that exited 0 is read on stderr alone [R4]', () => {
    const missing = classifyVerdict(undefined, { receipt: { exitCode: 1, stdout: 'Error: 429 Too Many Requests', stderr: '' } });
    assert.equal(missing.outcome, 'quota-hold');
    assert.ok(missing.reasons.includes('via text: 429'), missing.reasons.join(' | '));
    const timedOut = classifyVerdict({ verdict: 'block', reasons: ['reviewer timed out'], run_status: 'timeout' }, { receipt: { exitCode: 0, stdout: '', stderr: 'usage limit reached' } });
    assert.equal(timedOut.outcome, 'quota-hold');
    assert.deepEqual(timedOut.reasons, ['reviewer timed out', 'via text: usage limit']);
    assert.equal(timedOut.runStatus, 'timeout');
    const answered = classifyVerdict(undefined, { receipt: { exitCode: 0, stdout: 'the quota rule is unchanged', stderr: '' } });
    assert.equal(answered.outcome, 'no-verdict', 'the stdout of a process that exited 0 is its answer, never a hold');
    assert.deepEqual(classifyVerdict({ verdict: 'block', reasons: ['r'], run_status: 'tool_error' }, { receipt: { exitCode: 1, stdout: 'boom', stderr: '' } }), { outcome: 'no-verdict', mergeBlocking: false, runStatus: 'tool_error', reasons: ['r'], stale: false });
  });

  test('T0-QUOTA-FALSE-HOLD acceptance 1: each quota pattern holds only as a whole word or phrase: no letter or digit directly before or after it, except across a lowercase-to-uppercase change', () => {
    const cases: Array<[string, boolean]> = [
      ['quota', true],
      ['Quota exceeded', true],
      ['monthly quotas reached', true],
      ['429 Too Many Requests', true],
      ['HTTP/1.1 429', true],
      ['too many requests', true],
      ['rate limit', true],
      ['rate-limited', true],
      ['ratelimit hit', true],
      ['rate limits apply', true],
      ['rate limiting in effect', true],
      ['rate limiter rejected the call', true],
      ['usage limit', true],
      ['usage limits reached', true],
      ['retry after 30 seconds', true],
      ['Retry-After: 30', true],
      ['overloaded', true],
      ['at capacity', true],
      ['error code insufficient_quota', true],
      ['type overloaded_error', true],
      // A lowercase-to-uppercase change ends a word: camelCase provider codes hold (R3 decision 1 F1).
      ['reason: quotaExceeded', true],
      ['QuotaExceeded', true],
      ['rateLimitExceeded', true],
      ['userRateLimitExceeded', true],
      ['openai.RateLimitError', true],
      ['insufficientQuota', true],
      ['OverloadedError', true],
      ['tooManyRequests', true],
      ['usageLimitReached', true],
      ['serverAtCapacity', true],
      ['{"retryAfter": 30}', true],
      ['seeing 429s from the API', true],
      ['subQuotas', true],
      // All capitals stay one word; the last capital of a run before a capitalised word starts that word.
      ['QUOTA EXCEEDED', true],
      ['HTTP 429 TOO MANY REQUESTS', true],
      ['RATE_LIMIT_EXCEEDED', true],
      ['type rate_limit_error', true],
      ['code too_many_requests', true],
      ['usage_limit_reached', true],
      ['retry_after: 30', true],
      ['APIQuotaExceeded', true],
      ['QUOTAExceeded', true],
      ['XQuota', true],
      ['Quotation marks around pass need escape', false],
      ['commit 1429abf', false],
      ['4290 lines', false],
      ['sha abc429 and 429def', false],
      ['build 1429 finished', false],
      ['2quota left', false],
      // Named dropped classes: a letter or digit touching `429`, a one-case compound, a same-case letter across a camel split.
      ['HTTP429', false],
      ['error E429', false],
      ['4290s', false],
      ['quotaexceeded', false],
      ['QUOTAEXCEEDED', false],
      ['someQuotation', false],
      ['2Quota left', false],
      ['XQUOTA', false],
      ['QUOTAS2', false],
      ['a subquota of the plan', false],
      ['an accurate limit on lines', false],
      ['rate limitation of the parser', false],
      ['misusage limit', false],
      ['usage limitation', false],
      ['retry afterwards', false],
      ['incapacity', false],
      ['capacityless', false],
      ['overloadedness', false],
      ['too many requests2', false],
      ['too many requestsX', true], // a lowercase-to-uppercase change ends the word
      ['all good', false],
    ];
    for (const [text, hold] of cases) assert.equal(detectQuotaHold(text).hold, hold, `${JSON.stringify(text)} holds: ${hold}`);
  });

  test('routed skip is not a review that passed but does not block', () => {
    const c = classifyVerdict({ verdict: 'pass', reasons: [], routed_skip: { predicate: 'AllPathsMatch', reason: 'docs only', changed_paths: ['README.md'] } });
    assert.equal(c.outcome, 'routed-skip');
    assert.equal(c.mergeBlocking, false);
  });
});

describe('R3 stops on no progress (T1-EFF-R3-PROGRESS)', () => {
  const finding = (id: string, stage: 'pre' | 'formal', extra: Record<string, unknown> = {}) =>
    ReviewFinding.parse({ id, stage, round: 1, ...(stage === 'pre' ? { cycle: 0 } : {}), reason: `[spec] 6 tests @ src/gate.ts:1: finding ${id} -> fix`, raisedAt: T0, ...extra });

  test('acceptance 1: heldFindings fixes at dispatch the findings a re-raise repeats, disputed and unresolved or held by the previous R3 decision, and repeatedFindings keeps the re-raised ones', () => {
    // Decision 3: F1 was raised by decision 1 and re-raised by decision 2 (held); F2 is an R2 residual nobody disputed;
    // F3 was raised by decision 1 and left out by decision 2 (accepted, resolved); F4 is an R2 finding the author disputes.
    const reraisedBy2 = [{ stage: 'formal', round: 2, at: T0, reason: '[spec] 6 tests @ src/gate.ts:1: still missing (re:F1) -> fix' }];
    const findings = [
      finding('F1', 'formal', { reraised: reraisedBy2 }),
      finding('F2', 'pre'),
      finding('F3', 'formal', { resolvedAt: T0 }),
      finding('F4', 'pre', { disposition: 'disputed', disputes: [{ at: T0, note: 'the helper is asked for by acceptance 2' }] }),
    ];
    const seen = policy.snapshotFindings(findings);
    const reasons = ['F1', 'F2', 'F3', 'F4', 'F9'].map((id) => `[spec] 6 tests @ src/gate.ts:2: still missing (re:${id}) -> fix`);
    assert.deepEqual(policy.heldFindings(findings, seen, 3), ['F1', 'F4']);
    // decision 2: F3, raised by decision 1, is still held by R3 when decision 2 is dispatched
    assert.deepEqual(policy.heldFindings(findings, seen, 2), ['F1', 'F3', 'F4']);
    assert.deepEqual(policy.repeatedFindings(reasons, ['F1', 'F4']), ['F1', 'F4'], 're:F2, re:F3 and re:F9 repeat nothing held');
    assert.deepEqual(policy.repeatedFindings(reasons.slice(1), ['F1']), [], 'a decision that does not re-raise F1 repeats nothing');
  });

  test('acceptance 2: a later block of new findings returns to REVIEW_FIX; a re-raised unresolved finding from decision 2 on, or the fourth decision, stops', () => {
    const c = classifyVerdict(specBlock, { candidateSha: SHA, tier: 'S' });
    const first = recordReviewOutcome(ReviewLedger.parse({}), inv('i1'), c, specBlock, 0, ['F1']);
    assert.deepEqual(first.decision, { action: 'review-fix', remainingDecisions: 3 }, 'decision 1 never stops on a re-raise');
    const fresh = recordReviewOutcome(first.ledger, inv('i2'), c, specBlock, 0, []);
    assert.deepEqual(fresh.decision, { action: 'review-fix', remainingDecisions: 2 }, 'new findings on decision 2 get another repair round');
    const repeat = recordReviewOutcome(first.ledger, inv('i2'), c, specBlock, 0, ['F1']);
    assert.equal(repeat.decision.action, 'stop-review');
    assert.match(repeat.ledger.invocations.at(-1)?.stopReview ?? '', /second substantive block re-raised unresolved finding\(s\) F1/, 'a stopping decision records its detail, so a superseded commit stops with it (R3 decisions 1 and 2, F1)');
    const replay = recordReviewOutcome(repeat.ledger, inv('i2'), c, specBlock, 0, []);
    assert.equal(replay.decision.action, 'stop-review', 'a replay of a recorded stop returns the stop it recorded');
    assert.equal(fresh.ledger.invocations.at(-1)?.stopReview, undefined, 'a repair round is not a stop');
    assert.match(repeat.decision.action === 'stop-review' ? repeat.decision.detail : '', /second substantive block re-raised unresolved finding\(s\) F1/);
    const third = recordReviewOutcome(fresh.ledger, inv('i3'), c, specBlock, 0, []);
    assert.deepEqual(third.decision, { action: 'review-fix', remainingDecisions: 1 });
    const fourth = recordReviewOutcome(third.ledger, inv('i4'), c, specBlock, 0, []);
    assert.equal(fourth.decision.action, 'stop-review', 'the fourth decision stops whatever its findings');
    assert.equal(fourth.ledger.substantiveDecisions, 4);
  });

  test('T1-EFF-R3-PROGRESS-2 (R3 decision 2, re:F2): the repeat stop is judged at the dispatched decision number, and the four-decision cap at the decisions recorded', () => {
    const c = classifyVerdict(specBlock, { candidateSha: SHA, tier: 'S' });
    const other = recordReviewOutcome(ReviewLedger.parse({}), inv('other'), c, specBlock, 0, []);
    const late = recordReviewOutcome(other.ledger, { ...inv('i1'), decision: 1 }, c, specBlock, 0, ['F4']);
    assert.deepEqual(late.decision, { action: 'review-fix', remainingDecisions: 2 }, 'dispatched as decision 1, it gets its repair round although another decision completed first');
    const seeded = ReviewLedger.parse({ substantiveDecisions: 3, substantiveBlocks: 3 });
    assert.equal(recordReviewOutcome(seeded, { ...inv('i4'), decision: 2 }, c, specBlock, 0, []).decision.action, 'stop-review', 'the fourth decision recorded stops whatever number it was dispatched with');
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

  test('Q6, ship-path reviewer (no re-raise list): a defect block enters REVIEW-FIX with one decision remaining; a second block stops', () => {
    const c = classifyVerdict(specBlock, { candidateSha: SHA, tier: 'S' });
    const first = recordReviewOutcome(ReviewLedger.parse({}), inv('i1'), c, specBlock);
    assert.deepEqual(first.decision, { action: 'review-fix', remainingDecisions: 1 });
    assert.equal(first.ledger.substantiveBlocks, 1);
    const second = recordReviewOutcome(first.ledger, inv('i2'), c, specBlock);
    assert.equal(second.decision.action, 'stop-review');
    assert.match(second.decision.action === 'stop-review' ? second.decision.detail : '', /second substantive block/);
    assert.equal(second.ledger.substantiveDecisions, 2);
  });

  test('Q6, ship-path reviewer (no re-raise list): a required review beyond two decisions stops even without a second block', () => {
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
    const q = classifyVerdict(undefined, { receipt: { exitCode: 1, stdout: 'rate limit exceeded', stderr: '' } });
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

describe('review findings: identity and re-raises (T1-REVIEW-FINDINGS acceptance 1)', () => {
  const LATER = '2026-09-11T01:00:00.000Z';
  const LATEST = '2026-09-11T02:00:00.000Z';
  const block = (findings: ReviewFinding[], round: number, reasons: string[], at = T0, extra: Partial<policy.RecordFindingsInput> = {}) =>
    policy.recordFindings(findings, { stage: 'pre', cycle: 0, round, candidateSha: 'sha-1', at, outcome: 'block', reasons, perspectives: ['ac-coverage', 'edge-cases'], ...extra });

  test('a block records one finding per cited reason with sequential ids, stage, cycle, round, perspective, cited file and candidate sha', () => {
    const r = block([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add a failing test first (ac-coverage)', '[standards] 9 error handling @ src/gate.ts:9: swallowed error -> rethrow (edge-cases)']);
    assert.deepEqual(r.raised, ['F1', 'F2']);
    assert.deepEqual(r.reraised, []);
    assert.deepEqual(r.resolved, []);
    const [f1, f2] = r.findings;
    assert.deepEqual({ id: f1!.id, stage: f1!.stage, cycle: f1!.cycle, round: f1!.round, perspective: f1!.perspective, file: f1!.file, candidateSha: f1!.candidateSha, disposition: f1!.disposition, raisedAt: f1!.raisedAt }, { id: 'F1', stage: 'pre', cycle: 0, round: 1, perspective: 'ac-coverage', file: 'src/gate.ts', candidateSha: 'sha-1', disposition: 'open', raisedAt: T0 });
    assert.equal(f2!.perspective, 'edge-cases');
    assert.equal(f2!.reason, '[standards] 9 error handling @ src/gate.ts:9: swallowed error -> rethrow (edge-cases)', 'the reason is kept verbatim');
    // Ids continue from the last one across rounds and stages.
    const more = policy.recordFindings(r.findings, { stage: 'formal', round: 1, candidateSha: 'sha-1', at: LATER, outcome: 'block', reasons: ['[spec] 1 out of scope @ src/other.ts: outside allow_paths -> revert'] });
    assert.deepEqual(more.raised, ['F3']);
    assert.equal(more.findings.find((f) => f.id === 'F3')?.stage, 'formal');
  });

  test('a reason carrying re:F<k> is a re-raise of F<k> (a space after the colon is accepted), returns it to open, and an unknown id is a new finding', () => {
    const first = block([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one']).findings;
    const disputed = policy.disputeFinding(first, 'F1', 'the RED is tests/gate.test.ts at 0f1e', LATER);
    assert.equal(disputed.find((f) => f.id === 'F1')?.disposition, 'disputed');
    const r = block(disputed, 2, ['[spec] 6 tests @ src/gate.ts:1: the RED asserts nothing (re: F1) -> assert the gate', '[standards] 9 error handling @ src/gate.ts:9: swallowed error (re:F9) -> rethrow'], LATEST);
    assert.deepEqual(r.reraised, ['F1']);
    assert.deepEqual(r.raised, ['F2'], 'an unknown reference is a new finding');
    assert.equal(r.findings.length, 2);
    const f1 = r.findings.find((f) => f.id === 'F1')!;
    assert.equal(f1.disposition, 'open', 'a re-raise rejects the dispute');
    assert.equal(f1.disputes.length, 1, 'the dispute stays in the history');
    assert.deepEqual(f1.reraised.map((x) => ({ stage: x.stage, round: x.round, at: x.at, answeredDispute: x.answeredDispute })), [{ stage: 'pre', round: 2, at: LATEST, answeredDispute: 0 }], 'the re-raise records which dispute it answered');
    assert.equal(f1.revision, 2, 'the dispute and the re-raise each bumped the revision');
    assert.match(f1.reraised[0]!.reason, /asserts nothing/);
    assert.equal(policy.findingReference('[spec] 6 tests @ a.ts:1: x (re: F12) -> y'), 'F12');
    assert.equal(policy.findingReference('[spec] 6 tests @ a.ts:1: x -> y'), undefined);
  });

  test('references resolve against the findings that existed before the round: two reasons naming an unknown F1 on an empty ledger are two new findings', () => {
    const r = block([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED (re:F1) -> add one', '[standards] 9 error handling @ src/gate.ts:9: swallowed (re:F1) -> rethrow']);
    assert.deepEqual(r.raised, ['F1', 'F2']);
    assert.deepEqual(r.reraised, []);
    assert.deepEqual(r.findings.map((f) => f.reraised.length), [0, 0]);
    // A finding added while the round was in flight did not exist for that reviewer: a reference to it is an unknown id.
    const f = block([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one']).findings;
    const seen = policy.snapshotFindings(f);
    const withF2 = block(f, 2, ['[standards] 9 error handling @ src/gate.ts:9: swallowed -> rethrow'], LATER, { seen: {} }).findings; // F2 raised by an overlapping round
    const late = block(withF2, 3, ['[standards] 9 error handling @ src/gate.ts:9: still swallowed (re:F2) -> rethrow'], LATEST, { seen });
    assert.deepEqual(late.raised, ['F3'], 'the reference to an id the reviewer never received is a new finding');
    assert.deepEqual(late.reraised, []);
    assert.equal(late.findings.find((x) => x.id === 'F2')?.reraised.length, 0, 'F2 is untouched');
  });

  test('several panel angles re-raising one finding keep every reason with its angle, and the round counts once toward non-acceptance', () => {
    let f = block([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one (ac-coverage)']).findings;
    f = policy.disputeFinding(f, 'F1', 'the RED is tests/gate.test.ts', LATER);
    const r = block(f, 2, ['[spec] 6 tests @ src/gate.ts:1: the RED asserts nothing (re:F1) -> assert (ac-coverage)', '[spec] 6 tests @ src/gate.ts:1: the RED is not behavioural (re:F1) -> assert the seam (edge-cases)'], LATEST);
    assert.deepEqual(r.reraised, ['F1']);
    const f1 = r.findings[0]!;
    assert.deepEqual(f1.reraised.map((x) => [x.round, x.perspective, x.answeredDispute]), [[2, 'ac-coverage', 0], [2, 'edge-cases', 0]], 'both re-raise reasons are retained with their angle');
    assert.match(f1.reraised[1]!.reason, /not behavioural/);
    assert.equal(policy.nonAcceptanceRounds(f1), 1, 'one round, not two');
  });

  test('the dispatched snapshot decides what a round answered and what it may resolve: a dispute recorded after dispatch is not answered, a finding raised after dispatch is not resolved', () => {
    let f = block([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one']).findings;
    const seenOpen = policy.snapshotFindings(f);
    f = policy.disputeFinding(f, 'F1', 'disputed while the round ran', LATER);
    const r = block(f, 2, ['[spec] 6 tests @ src/gate.ts:1: still no RED (re:F1) -> add one'], LATEST, { seen: seenOpen });
    assert.equal(r.findings[0]!.reraised[0]!.answeredDispute, undefined, 'the reviewer never saw the dispute');
    assert.equal(policy.nonAcceptanceRounds(r.findings[0]!), 0);
    assert.equal(r.findings[0]!.disputes.length, 1, 'the later dispute is preserved');
    assert.equal(r.findings[0]!.disposition, 'disputed', 'a re-raise that never saw the dispute does not reset it: the dispute waits for the next round');
    const passedLate = policy.recordFindings(f, { stage: 'pre', cycle: 0, round: 2, candidateSha: 'sha-1', at: LATEST, outcome: 'pass', reasons: [], seen: seenOpen });
    assert.deepEqual(passedLate.resolved, [], 'a pass whose snapshot had F1 open does not resolve the finding disputed meanwhile');
    const late = block(r.findings, 3, ['[standards] 9 error handling @ src/gate.ts:9: swallowed -> rethrow'], LATEST, { seen: {} }).findings; // F2 raised by an overlapping round that saw nothing
    assert.equal(late.find((x) => x.id === 'F1')?.resolvedAt, undefined, 'a round that did not receive F1 does not resolve it');
    const passed = policy.recordFindings(late, { stage: 'pre', cycle: 0, round: 4, candidateSha: 'sha-1', at: LATEST, outcome: 'pass', reasons: [], seen: { F1: policy.snapshotFindings(late)['F1']! } });
    assert.deepEqual(passed.resolved, ['F1'], 'only findings the round received, unchanged since, are resolved; F2 stays open');
    assert.equal(passed.findings.find((x) => x.id === 'F2')?.resolvedAt, undefined);
  });

  test('resolution needs a strictly later round of the stage and an unchanged finding revision; a re-raise reopens a resolved finding', () => {
    let f = block([], 2, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one']).findings;
    assert.equal(f[0]!.revision, 0);
    const sameRound = policy.recordFindings(f, { stage: 'pre', cycle: 0, round: 2, candidateSha: 'sha-1', at: LATER, outcome: 'pass', reasons: [], seen: policy.snapshotFindings(f) });
    assert.deepEqual(sameRound.resolved, [], 'a pass of the same round never resolves a finding of that round');
    const before = policy.snapshotFindings(f);
    f = block(f, 3, ['[spec] 6 tests @ src/gate.ts:1: still no RED (re:F1) -> add one'], LATEST).findings;
    assert.equal(f[0]!.revision, 1, 'a re-raise bumps the revision');
    const stalePass = policy.recordFindings(f, { stage: 'pre', cycle: 0, round: 2, candidateSha: 'sha-1', at: LATEST, outcome: 'pass', reasons: [], seen: before });
    assert.deepEqual(stalePass.resolved, [], 'a late round-two pass never resolves a finding round three re-raised');
    const later = policy.recordFindings(f, { stage: 'pre', cycle: 0, round: 4, candidateSha: 'sha-1', at: LATEST, outcome: 'pass', reasons: [], seen: policy.snapshotFindings(f) });
    assert.deepEqual(later.resolved, ['F1']);
    assert.equal(later.findings[0]!.revision, 2, 'resolution bumps the revision');
    const reopened = policy.recordFindings(later.findings, { stage: 'formal', round: 1, candidateSha: 'sha-1', at: LATEST, outcome: 'block', reasons: ['[spec] 6 tests @ src/gate.ts:1: the RED is not behavioural (re:F1) -> assert the seam'], seen: policy.snapshotFindings(later.findings) });
    assert.deepEqual(reopened.reraised, ['F1'], 'a known resolved finding is re-raised, not re-created');
    assert.equal(reopened.findings[0]!.resolvedAt, undefined);
    assert.equal(reopened.findings[0]!.disposition, 'open');
    const cycled = policy.recordFindings(reopened.findings, { stage: 'pre', cycle: 1, round: 1, candidateSha: 'sha-2', at: LATEST, outcome: 'pass', reasons: [], seen: policy.snapshotFindings(reopened.findings) });
    assert.deepEqual(cycled.resolved, ['F1'], 'a later cycle is a later round of the pre-review stage');
  });

  test('two rounds that answered the same dispute count as one round of non-acceptance', () => {
    let f = block([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one']).findings;
    f = policy.disputeFinding(f, 'F1', 'the RED is tests/gate.test.ts', LATER);
    const seen = policy.snapshotFindings(f);
    f = block(f, 2, ['[spec] 6 tests @ src/gate.ts:1: still no RED (re:F1) -> add one'], LATEST, { seen }).findings;
    f = policy.recordFindings(f, { stage: 'formal', round: 1, candidateSha: 'sha-1', at: LATEST, outcome: 'block', reasons: ['[spec] 6 tests @ src/gate.ts:1: no behavioural RED (re:F1) -> assert'], seen }).findings;
    assert.deepEqual(f[0]!.reraised.map((x) => x.answeredDispute), [0, 0], 'both rounds answered the first dispute');
    assert.equal(policy.nonAcceptanceRounds(f[0]!), 1);
    assert.deepEqual(policy.deadlockedFindings(f), []);
    assert.equal(policy.disputeFinding(f, 'F1', 'second answer', LATER)[0]!.disputes.length, 2, 'a second dispute is still allowed');
  });

  test('a structured perspective map names the angle of an untagged reason (a single-angle panel)', () => {
    const reason = '[spec] 6 tests @ src/gate.ts:1: no RED -> add one';
    const r = policy.recordFindings([], { stage: 'pre', cycle: 0, round: 1, candidateSha: 'sha-1', at: T0, outcome: 'block', reasons: [reason], perspectives: ['ac-coverage'], perspectiveByReason: { [reason]: 'ac-coverage' } });
    assert.equal(r.findings[0]!.perspective, 'ac-coverage');
  });

  test('an advisory block records its cited reasons as advisory findings', () => {
    const r = policy.recordFindings([], { stage: 'formal', round: 1, candidateSha: 'sha-1', at: T0, outcome: 'block', advisory: true, reasons: ['[standards] 16 de-AI-slop @ src/gate.ts:4: duplicated helper -> reuse'] });
    assert.deepEqual(r.raised, ['F1']);
    assert.equal(r.findings[0]!.advisory, true);
  });

  test('a decided later round of the same stage that does not re-raise an open or disputed finding resolves it; the other stage and a non-decision leave it open', () => {
    const first = block([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one', '[standards] 9 error handling @ src/gate.ts:9: swallowed -> rethrow']).findings;
    const otherStage = policy.recordFindings(first, { stage: 'formal', round: 1, candidateSha: 'sha-2', at: LATER, outcome: 'pass', reasons: [] });
    assert.deepEqual(otherStage.resolved, [], 'a formal pass does not resolve pre-review findings');
    const undecided = policy.recordFindings(first, { stage: 'pre', cycle: 0, round: 2, candidateSha: 'sha-2', at: LATER, outcome: 'no-verdict', reasons: [] });
    assert.deepEqual(undecided.resolved, [], 'a round without a verdict resolves nothing');
    const r = block(first, 2, ['[standards] 9 error handling @ src/gate.ts:9: still swallowed (re:F2) -> rethrow'], LATEST, { candidateSha: 'sha-2' });
    assert.deepEqual(r.resolved, ['F1']);
    assert.equal(r.findings.find((f) => f.id === 'F1')?.resolvedAt, LATEST);
    assert.equal(r.findings.find((f) => f.id === 'F2')?.resolvedAt, undefined);
    const passed = policy.recordFindings(r.findings, { stage: 'pre', cycle: 0, round: 3, candidateSha: 'sha-3', at: LATEST, outcome: 'pass', reasons: [] });
    assert.deepEqual(passed.resolved, ['F2'], 'a pass resolves every open finding of the stage');
  });
});

describe('review findings: dispositions, the same-candidate rule and deadlocks (acceptance 2, 4, 5)', () => {
  const LATER = '2026-09-11T01:00:00.000Z';
  const raise = (findings: ReviewFinding[], round: number, reasons: string[], stage: 'pre' | 'formal' = 'pre') => policy.recordFindings(findings, { stage, cycle: 0, round, candidateSha: 'sha-1', at: T0, outcome: 'block', reasons }).findings;

  test('dispute needs an open finding and a note, a second dispute needs a re-raise in between, and accept withdraws the dispute', () => {
    const f = raise([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one']);
    assert.throws(() => policy.disputeFinding(f, 'F7', 'x', LATER), /F7/);
    assert.throws(() => policy.disputeFinding(f, 'F1', '   ', LATER), /note/);
    const d = policy.disputeFinding(f, 'F1', 'the RED is behavioural: tests/gate.test.ts', LATER);
    assert.deepEqual(d.find((x) => x.id === 'F1')?.disputes, [{ at: LATER, note: 'the RED is behavioural: tests/gate.test.ts', afterReraises: 0 }]);
    assert.throws(() => policy.disputeFinding(d, 'F1', 'again', LATER), /already disputed/);
    const a = policy.acceptFinding(d, 'F1');
    assert.equal(a.find((x) => x.id === 'F1')?.disposition, 'open');
    assert.equal(a.find((x) => x.id === 'F1')?.disputes.length, 1, 'the withdrawn dispute stays in the history');
    assert.throws(() => policy.acceptFinding(a, 'F1'), /not disputed/);
    assert.throws(() => policy.disputeFinding(a, 'F1', 'once more', LATER), /re-raise/, 'a withdrawn dispute still needs a re-raise before the next one');
    const answered = policy.recordFindings(a, { stage: 'pre', cycle: 0, round: 2, candidateSha: 'sha-1', at: LATER, outcome: 'block', reasons: ['[spec] 6 tests @ src/gate.ts:1: still no RED (re:F1) -> add one'] }).findings;
    assert.equal(policy.disputeFinding(answered, 'F1', 'second answer', LATER).find((x) => x.id === 'F1')?.disputes.length, 2, 'after a re-raise the next dispute is allowed');
    const resolved = policy.recordFindings(a, { stage: 'pre', cycle: 0, round: 2, candidateSha: 'sha-2', at: LATER, outcome: 'pass', reasons: [] }).findings;
    assert.throws(() => policy.disputeFinding(resolved, 'F1', 'late', LATER), /resolved/);
    // dispute -> pass -> accept: a resolved finding is never reopened by a withdrawal (edge-cases finding, R2 round 3).
    const disputedThenPassed = policy.recordFindings(policy.disputeFinding(f, 'F1', 'answer', LATER), { stage: 'pre', cycle: 0, round: 2, candidateSha: 'sha-2', at: LATER, outcome: 'pass', reasons: [] }).findings;
    assert.equal(disputedThenPassed[0]?.resolvedAt, LATER);
    assert.throws(() => policy.acceptFinding(disputedThenPassed, 'F1'), /resolved/);
  });

  test('rerunAllowed refuses an unchanged candidate while any finding of its last block is open and allows it once every one is disputed', () => {
    let f = raise([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one', '[standards] 9 error handling @ src/gate.ts:9: swallowed -> rethrow']);
    assert.deepEqual(policy.rerunAllowed(f, { stage: 'pre', cycle: 0, round: 1 }), { allowed: false, open: ['F1', 'F2'] });
    f = policy.disputeFinding(f, 'F1', 'covered by tests/gate.test.ts', LATER);
    assert.deepEqual(policy.rerunAllowed(f, { stage: 'pre', cycle: 0, round: 1 }), { allowed: false, open: ['F2'] });
    f = policy.disputeFinding(f, 'F2', 'the error is rethrown at line 12', LATER);
    assert.deepEqual(policy.rerunAllowed(f, { stage: 'pre', cycle: 0, round: 1 }), { allowed: true, open: [] });
    // A finding re-raised by a later round belongs to that round's block as well.
    f = raise(f, 2, ['[spec] 6 tests @ src/gate.ts:1: still no RED (re:F1) -> add one']);
    assert.deepEqual(policy.rerunAllowed(f, { stage: 'pre', cycle: 0, round: 2 }), { allowed: false, open: ['F1'] });
    assert.deepEqual(policy.rerunAllowed(f, { stage: 'formal', candidateSha: 'sha-1' }), { allowed: true, open: [] }, 'a candidate with no formal finding has nothing open');
    // Formal findings are keyed by the candidate they were raised or re-raised on, never by a run-wide counter.
    let g = raise([], 1, ['[spec] 14 scope fidelity @ src/gate.ts:3: helper not in the acceptance list -> remove it'], 'formal');
    assert.deepEqual(policy.findingsOfCandidate(g, 'formal', 'sha-1').map((x) => x.id), ['F1']);
    assert.deepEqual(policy.findingsOfCandidate(g, 'formal', 'sha-2'), []);
    assert.deepEqual(policy.rerunAllowed(g, { stage: 'formal', candidateSha: 'sha-1' }), { allowed: false, open: ['F1'] });
    g = policy.disputeFinding(g, 'F1', 'acceptance 1 names it', LATER);
    assert.deepEqual(policy.rerunAllowed(g, { stage: 'formal', candidateSha: 'sha-1' }), { allowed: true, open: [] });
    g = policy.recordFindings(g, { stage: 'formal', round: 2, candidateSha: 'sha-1', at: LATER, outcome: 'block', reasons: ['[spec] 14 scope fidelity @ src/gate.ts:3: still there (re:F1) -> remove it'] }).findings;
    assert.deepEqual(policy.rerunAllowed(g, { stage: 'formal', candidateSha: 'sha-1' }), { allowed: false, open: ['F1'] }, 'a re-raise on the candidate reopens it');
  });

  test('deadlockedFindings names a finding disputed twice and re-raised twice, a re-raise of an open finding is not non-acceptance, and a third dispute is refused', () => {
    let f = raise([], 1, ['[spec] 6 tests @ src/gate.ts:1: no RED -> add one']);
    f = raise(f, 2, ['[spec] 6 tests @ src/gate.ts:1: no RED (re:F1) -> add one']);
    assert.equal(policy.nonAcceptanceRounds(f[0]!), 0, 'a re-raise of an open finding answered no dispute');
    f = policy.disputeFinding(f, 'F1', 'first answer', LATER);
    f = raise(f, 3, ['[spec] 6 tests @ src/gate.ts:1: no RED (re:F1) -> add one']);
    assert.deepEqual(policy.deadlockedFindings(f), []);
    assert.deepEqual(policy.contestedFindings(f).map((x) => x.id), ['F1']);
    f = policy.disputeFinding(f, 'F1', 'second answer', LATER);
    f = raise(f, 4, ['[spec] 6 tests @ src/gate.ts:1: no RED (re:F1) -> add one']);
    assert.deepEqual(policy.deadlockedFindings(f).map((x) => x.id), ['F1']);
    assert.throws(() => policy.disputeFinding(f, 'F1', 'third answer', LATER), /human ruling/);
    assert.match(policy.describeDeadlock(f), /F1 .*disputed twice.*re-raised twice/);
  });
});

describe('stale ledger writes (T1-REVIEW-FINDINGS-2 R3 decision 1)', () => {
  const ledger = (over: Partial<ReviewLedger> = {}) => ReviewLedger.parse(over);
  const pending = { ...inv('r3:a'), candidateSha: SHA, outcome: 'pending' as const, runStatus: 'success' as const };
  const decided = { ...pending, outcome: 'block' as const };
  const round = { round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'cand-1', requestedAt: T0, durationMs: 0, outcome: 'pending' as const, reasons: [], reservationId: 'res-1' };
  const run = (review: ReviewLedger, rounds: Array<Omit<typeof round, 'outcome'> & { outcome: 'pending' | 'block' | 'pass' }>) => ({ review, preReview: { rounds, handoffs: [] } });

  test('a snapshot that still holds a decided entry as pending, or lower counters, is stale; an identical ledger is not', () => {
    assert.equal(policy.staleLedger(run(ledger({ invocations: [decided], substantiveDecisions: 1, substantiveBlocks: 1 }), []), run(ledger({ invocations: [decided], substantiveDecisions: 1, substantiveBlocks: 1 }), [])), undefined);
    assert.match(policy.staleLedger(run(ledger({ invocations: [decided], substantiveDecisions: 1, substantiveBlocks: 1 }), []), run(ledger({ invocations: [pending] }), [])) ?? '', /r3:a/);
    assert.match(policy.staleLedger(run(ledger({ invocations: [decided], substantiveDecisions: 1, substantiveBlocks: 1 }), []), run(ledger({ invocations: [decided] }), [])) ?? '', /substantiveDecisions/);
    assert.match(policy.staleLedger(run(ledger(), [{ ...round, outcome: 'block' }]), run(ledger(), [round])) ?? '', /round/);
    assert.match(policy.staleLedger(run(ledger({ noVerdictRetriesUsed: 1 }), []), run(ledger(), [])) ?? '', /noVerdictRetriesUsed/);
    assert.equal(policy.staleLedger(run(ledger(), [round]), run(ledger(), [{ ...round, outcome: 'block' }])), undefined, 'the writer deciding a pending round is the expected direction');
  });

  test('a pending entry the writer still holds after the persisted ledger released it is stale (a resurrection); a decided entry the writer adds is not', () => {
    assert.match(policy.staleLedger(run(ledger(), []), run(ledger({ invocations: [pending] }), [])) ?? '', /r3:a/, 'a released R3 reservation is not written back');
    assert.match(policy.staleLedger(run(ledger(), []), run(ledger(), [round])) ?? '', /res-1/, 'an abandoned R2 round is not written back');
    assert.equal(policy.staleLedger(run(ledger(), []), run(ledger({ invocations: [decided], substantiveDecisions: 1, substantiveBlocks: 1 }), [{ ...round, outcome: 'block' }])), undefined, 'a decided entry the writer adds is the expected direction');
  });
});

describe('one dispute per answered re-raise (T1-REVIEW-FINDINGS-3 R2 cycle 1 round 1)', () => {
  const LATER = '2026-09-11T01:00:00.000Z';
  const raise = (): ReviewFinding[] => policy.recordFindings([], { stage: 'pre', cycle: 0, round: 1, candidateSha: SHA, at: T0, outcome: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: no RED -> add one'] }).findings;

  test('a re-raise by a round that never received the dispute answers nothing: no second dispute until a reviewer who received it re-raises', () => {
    let f = raise();
    const seenOpen = policy.snapshotFindings(f); // a round dispatched before the dispute
    f = policy.disputeFinding(f, 'F1', 'the RED is tests/a.test.ts', T0);
    f = policy.recordFindings(f, { stage: 'pre', cycle: 0, round: 2, candidateSha: SHA, at: LATER, outcome: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: still no RED (re:F1) -> add one'], seen: seenOpen }).findings;
    assert.equal(f[0]!.reraised[0]?.answeredDispute, undefined, 'the re-raise answered no dispute');
    assert.equal(f[0]!.disposition, 'disputed', 'a finding changed after dispatch keeps its disposition');
    f = policy.acceptFinding(f, 'F1');
    assert.throws(() => policy.disputeFinding(f, 'F1', 'a second answer', LATER), /re-raise/, 'no reviewer answered the first dispute yet');
    // A round that received the dispute re-raises: the answer opens the next dispute.
    const seenDisputed = policy.snapshotFindings(policy.disputeFinding(raise(), 'F1', 'x', T0));
    let g = policy.disputeFinding(raise(), 'F1', 'the RED is tests/a.test.ts', T0);
    g = policy.recordFindings(g, { stage: 'pre', cycle: 0, round: 2, candidateSha: SHA, at: LATER, outcome: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: still no RED (re:F1) -> add one'], seen: seenDisputed }).findings;
    assert.equal(g[0]!.reraised[0]?.answeredDispute, 0);
    assert.equal(g[0]!.disposition, 'open');
    assert.equal(policy.disputeFinding(g, 'F1', 'a second answer', LATER)[0]!.disputes.length, 2, 'one dispute per answered re-raise');
  });
});

describe('resolution by the deciding stage and the second-dispute window (T1-REVIEW-FINDINGS-4 acceptance 14)', () => {
  const LATER = '2026-09-11T01:00:00.000Z';
  const LATEST = '2026-09-11T02:00:00.000Z';
  const raise = (): ReviewFinding[] => policy.recordFindings([], { stage: 'pre', cycle: 0, round: 1, candidateSha: SHA, at: T0, outcome: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: no RED -> add one'] }).findings;

  test('an R2 finding re-raised by R3 decision 1 is resolved by decision 2 when it received the finding unchanged', () => {
    let f = raise();
    f = policy.recordFindings(f, { stage: 'formal', round: 1, candidateSha: SHA, at: LATER, outcome: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: still no RED (re:F1) -> add one'] }).findings;
    assert.deepEqual(f[0]!.reraised.map((r) => r.stage), ['formal']);
    const pass = policy.recordFindings(f, { stage: 'formal', round: 2, candidateSha: 'b'.repeat(40), at: LATEST, outcome: 'pass', reasons: [], seen: policy.snapshotFindings(f) });
    assert.deepEqual(pass.resolved, ['F1'], 'the deciding stage re-raised it, so its later decision resolves it');
    assert.equal(pass.findings[0]!.resolvedAt, LATEST);
    // A finding the formal stage never raised or re-raised is left to its own stage.
    const other = policy.recordFindings(raise(), { stage: 'formal', round: 1, candidateSha: SHA, at: LATER, outcome: 'pass', reasons: [] });
    assert.deepEqual(other.resolved, [], 'the other stage leaves it alone');
  });

  test('a second dispute is admitted by any re-raise since the latest dispute that received it; a late overlapping re-raise that received none never revokes it', () => {
    let f = raise();
    const seenOpen = policy.snapshotFindings(f);
    f = policy.disputeFinding(f, 'F1', 'the RED is tests/a.test.ts', T0);
    const seenDisputed = policy.snapshotFindings(f);
    f = policy.recordFindings(f, { stage: 'pre', cycle: 0, round: 2, candidateSha: SHA, at: LATER, outcome: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: still no RED (re:F1) -> add one'], seen: seenDisputed }).findings;
    // A round dispatched before the dispute completes late and re-raises too.
    f = policy.recordFindings(f, { stage: 'pre', cycle: 0, round: 3, candidateSha: SHA, at: LATEST, outcome: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: no RED seen (re:F1) -> add one'], seen: seenOpen }).findings;
    assert.deepEqual(f[0]!.reraised.map((r) => r.sawDisputes), [1, 0]);
    assert.equal(policy.disputeFinding(f, 'F1', 'a second answer', LATEST)[0]!.disputes.length, 2, 'the earlier answering re-raise keeps the second dispute open');
  });
});

describe('first-round misses (T1-REVIEW-INPUTS acceptance 3)', () => {
  const raise = (findings: ReviewFinding[], round: number, reasons: string[], deltaPaths?: string[]) => policy.recordFindings(findings, { stage: 'pre', cycle: 0, round, candidateSha: `sha-${round}`, at: T0, outcome: 'block', reasons, deltaPaths });

  test('a new finding whose cited file is outside the delta is marked outsideDelta; inside it is not; a first round marks nothing; an empty delta marks every new finding; a re-raise is never marked', () => {
    const first = raise([], 1, ['[spec] 6 tests @ src/a.ts:1: no RED -> add one']);
    assert.equal(first.findings[0]!.outsideDelta, undefined, 'a first round has no delta to be outside of');
    const second = raise(first.findings, 2, ['[spec] 6 tests @ src/a.ts:1: still no RED (re:F1) -> add one', '[standards] 9 error handling @ src/a.ts:9: swallowed -> rethrow', '[standards] 9 error handling @ src/b.ts:3: swallowed -> rethrow'], ['src/b.ts']);
    assert.deepEqual(second.findings.map((f) => [f.id, f.outsideDelta ?? false]), [['F1', false], ['F2', true], ['F3', false]], 'F2 cites a file the delta did not touch');
    const same = raise(second.findings, 3, ['[spec] 14 scope @ src/b.ts:5: helper -> remove'], []);
    assert.equal(same.findings.find((f) => f.id === 'F4')?.outsideDelta, true, 'on an unchanged candidate every new finding is a first-round miss');
  });
});

describe('defect classes (T1-REVIEW-CLASS-SWEEP)', () => {
  const LATER = '2026-09-11T01:00:00.000Z';
  const LATEST = '2026-09-11T02:00:00.000Z';
  /** A finding as this card records it: `class` is read through this view so the RED compiles against the baseline type. */
  type Classed = ReviewFinding & { class?: string };
  const classOf = (f: ReviewFinding | undefined): string | undefined => (f as Classed | undefined)?.class;
  const rec = (findings: ReviewFinding[], round: number, reasons: string[], at = T0, stage: 'pre' | 'formal' = 'formal') => policy.recordFindings(findings, { stage, round, candidateSha: 'sha-1', at, outcome: 'block', reasons });
  const reason = (slug: string) => `[standards] 9 error handling (class: ${slug}) @ src/a.ts:3: x -> y`;

  test('acceptance 1: findingClass reads a well-formed (class: <slug>) tag in any case with at most one space; a reason without one or with a malformed slug has no class, and the first tag decides [R10]', () => {
    assert.equal(policy.findingClass('[standards] 9 error handling (class: journal-before-save) @ src/a.ts:3: x -> y'), 'journal-before-save');
    assert.equal(policy.findingClass('[standards] 9 error handling (class:journal-before-save) @ src/a.ts:3: x -> y'), 'journal-before-save');
    assert.equal(policy.findingClass('[standards] 9 error handling (CLASS: journal-before-save) @ src/a.ts:3: x -> y'), 'journal-before-save');
    assert.equal(policy.findingClass('[standards] 9 error handling @ src/a.ts:3: x -> y'), undefined, 'no tag');
    for (const slug of ['Journal-Order', 'two words', 'a_b', '-a', 'a-', 'a--b', '', 'a'.repeat(41), ' two-spaces']) assert.equal(policy.findingClass(reason(slug)), undefined, `malformed slug "${slug}"`);
    assert.equal(policy.findingClass(reason('a'.repeat(40))), 'a'.repeat(40), 'forty characters is the limit');
    assert.equal(policy.findingClass(reason('r3-2')), 'r3-2', 'digits are slug characters');
    assert.equal(policy.findingClass('[standards] 9 (class: first-one) @ src/a.ts:3: x (class: second-one) -> y'), 'first-one', 'the first tag decides');
    assert.equal(policy.findingClass('[standards] 9 (class: Bad-One) @ src/a.ts:3: x (class: second-one) -> y'), undefined, 'a malformed first tag decides too');
  });

  test('acceptance 2: recordFindings sets the class of a new tagged finding, records an untagged or malformed reason as main does, and a tagged re-raise sets a missing class and keeps an existing one, with the same ids, dispositions and revisions as an untagged copy [R10]', () => {
    const tagged = rec([], 1, [reason('journal-before-save'), '[spec] 6 tests @ src/b.ts:1: no RED -> add one']);
    assert.equal(classOf(tagged.findings[0]), 'journal-before-save');
    assert.equal('class' in tagged.findings[1]!, false, 'an untagged reason records no class key');
    const plain = '[standards] 9 error handling @ src/a.ts:3: x -> y';
    const malformed = reason('Two Words');
    const asMain = (text: string) => [{ id: 'F1', stage: 'formal', cycle: undefined, round: 1, perspective: undefined, reason: text, file: 'src/a.ts', candidateSha: 'sha-1', raisedAt: T0, disposition: 'open', disputes: [], reraised: [], revision: 0 }];
    assert.deepEqual(rec([], 1, [plain]).findings, asMain(plain), 'an untagged reason records the finding main records');
    assert.deepEqual(rec([], 1, [malformed]).findings, asMain(malformed), 'a malformed tag records the finding main records');

    // Round 1 raises F1 and F2 (tagged) and F3 (untagged); F2 is disputed; round 2 re-raises F1 under another class and F3 under one.
    const round1 = [reason('journal-before-save'), '[standards] 9 error handling (class: journal-before-save) @ src/c.ts:5: x -> y', '[spec] 6 tests @ src/b.ts:1: no RED -> add one'];
    const round2 = ['[standards] 9 error handling (class: other-class) @ src/d.ts:2: still x (re:F1) -> y', '[spec] 6 tests (class: missing-red) @ src/b.ts:1: no RED (re:F3) -> add one'];
    const strip = (reasons: string[]) => reasons.map((r) => r.replace(/ \(class: [^)]*\)/, ''));
    const run = (first: string[], second: string[]) => {
      const a = rec([], 1, first);
      const b = rec(policy.disputeFinding(a.findings, 'F2', 'not a defect', LATER), 2, second, LATEST);
      return { a, b };
    };
    const withTags = run(round1, round2);
    const without = run(strip(round1), strip(round2));
    const shape = (r: { a: policy.RecordFindingsResult; b: policy.RecordFindingsResult }) => [r.a, r.b].map((x) => ({ raised: x.raised, reraised: x.reraised, resolved: x.resolved, findings: x.findings.map((f) => [f.id, f.disposition, f.revision, f.resolvedAt ?? null]) }));
    assert.deepEqual(shape(withTags), shape(without), 'the class changes no id, list, disposition, revision or resolution');
    assert.deepEqual(withTags.b.reraised, ['F1', 'F3']);
    assert.deepEqual(withTags.b.resolved, ['F2']);
    const after = withTags.b.findings;
    assert.equal(classOf(after.find((f) => f.id === 'F1')), 'journal-before-save', 'a re-raise never replaces an existing class');
    assert.equal(classOf(after.find((f) => f.id === 'F3')), 'missing-red', 'a tagged re-raise sets the class of a finding that had none');
    assert.equal(after.find((f) => f.id === 'F3')!.reraised[0]!.reason, round2[1], 'the re-raise reason keeps the tag as text');
    assert.deepEqual(without.b.findings.map(classOf), [undefined, undefined, undefined]);
  });

  test('acceptance 4: blockClasses groups the open findings of a block by class in first-raised order, with their ids and every cited file:line once; disputed, resolved and class-less findings add nothing [R11]', () => {
    const first = rec([], 1, [
      reason('journal-before-save'), // F1 src/a.ts:3
      '[spec] 6 tests (class: missing-red) @ src/b.ts:1: no RED -> add one', // F2
      '[standards] 9 error handling (class: journal-before-save) @ src\\c.ts:5: x -> y', // F3, a Windows separator
      '[spec] 14 scope @ src/d.ts:2: helper -> remove', // F4, no class
      '[standards] 9 error handling (class: disputed-one) @ src/e.ts:1: x -> y', // F5, disputed below
      '[standards] 9 error handling (class: journal-before-save) @ src/a.ts:3: the same site again -> y', // F6
      '[standards] 9 error handling (class: resolved-one) @ src/f.ts:4: x -> y', // F7, resolved below
    ]);
    // A later round re-raises F1 at a second site and again at its first.
    const second = rec(first.findings, 1, ['[standards] 9 error handling @ src/a.ts:9: x (re:F1) -> y', '[standards] 9 error handling @ src/a.ts:3: x (re:F1) -> y'], LATER, 'pre');
    const findings = policy.disputeFinding(second.findings, 'F5', 'not a defect', LATEST).map((f) => (f.id === 'F7' ? { ...f, resolvedAt: LATEST } : f));
    assert.deepEqual(policy.blockClasses(findings), [
      { class: 'journal-before-save', ids: ['F1', 'F3', 'F6'], sites: ['src/a.ts:3', 'src/a.ts:9', 'src/c.ts:5'] },
      { class: 'missing-red', ids: ['F2'], sites: ['src/b.ts:1'] },
    ]);
    assert.deepEqual(policy.blockClasses(rec([], 1, ['[spec] 6 tests @ src/b.ts:1: no RED -> add one', '[standards] 9 error handling @ src/a.ts:3: x -> y']).findings), [], 'a block without a class');
  });

  test('R2 suggestions at a21a763: a [question] or [suggestion] reason carries no class, an advisory-block finding adds nothing to blockClasses, and a slug with a line break is malformed [R10] [R11]', () => {
    for (const tag of ['[question]', '[suggestion]']) {
      const advisory = `[standards] 9 error handling (class: journal-before-save) @ src/a.ts:3: ${tag} is the event saved first? -> confirm`;
      assert.equal(policy.findingClass(advisory), undefined, `${tag}: findingClass`);
      assert.equal('class' in rec([], 1, [advisory]).findings[0]!, false, `${tag}: recordFindings records no class key`);
    }
    assert.equal(policy.findingClass(`[standards] 9 error handling ${'[question]'} (class: journal-before-save) @ src/a.ts:3: x -> y`), 'journal-before-save', 'a tag the advisory rule does not read stays a block reason with its class');
    const advisoryBlock = policy.recordFindings([], { stage: 'formal', round: 1, candidateSha: 'sha-1', at: T0, outcome: 'block', reasons: [reason('journal-before-save')], advisory: true });
    assert.equal(advisoryBlock.findings[0]!.advisory, true);
    assert.equal(classOf(advisoryBlock.findings[0]), 'journal-before-save', 'an advisory block records the class of its reason');
    assert.deepEqual(policy.blockClasses(advisoryBlock.findings), [], 'an advisory finding is never a merge bar, so no repair asks for its class');
    for (const slug of ['abc\n', 'abc\r\n', 'ab\nc']) assert.equal(policy.findingClass(reason(slug)), undefined, `a line break in ${JSON.stringify(slug)}`);
  });
});
