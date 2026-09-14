import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyVerdict, detectQuotaHold, findingMarker, parseVerdict, recordReviewOutcome, reviewRequestKey } from '../../src/core/review-policy.ts';
// Namespace import for the finding bookkeeping (T1-REVIEW-FINDINGS): on the baseline the functions are absent and each
// test fails at its first call, so the RED is the behaviour, not a link error that aborts the file.
import * as policy from '../../src/core/review-policy.ts';
import { ReviewLedger, type ReviewFinding, type Verdict } from '../../src/core/types.ts';
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
