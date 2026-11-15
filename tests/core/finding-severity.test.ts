import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
// Namespace import: on the baseline `findingSeverity` is absent and each test fails at its first call, not at link time.
import * as policy from '../../src/core/review-policy.ts';
import { ADVISORY_TAG, PRE_EXISTING_TAG, citedReasonsOf, stripAdvisoryTags } from '../../src/review/pre-review.ts';
import { ReviewFinding, type Verdict } from '../../src/core/types.ts';
import { T0 } from './_fixtures.ts';

// The severity tag of a block reason (card T1-REVIEW-SEVERITY): recorded and counted, read by no gate.

const severity = (reason: string) => (policy as unknown as { findingSeverity: (r: string) => string }).findingSeverity(reason);
const block = (reasons: string[]): Verdict => ({ verdict: 'block', reasons, axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons } } });

describe('finding severity (T1-REVIEW-SEVERITY)', () => {
  test('T1-REVIEW-SEVERITY acceptance 1: findingSeverity reads the tag at the start or after the axis tag and gives P1 otherwise', () => {
    for (const tag of ['P0', 'P1', 'P2'] as const) {
      assert.equal(severity(`[${tag}] 9 error handling @ src/a.ts:3: x -> y`), tag, `[${tag}] alone`);
      assert.equal(severity(`  [${tag}] 9 error handling @ src/a.ts:3: x -> y`), tag, `[${tag}] after leading white space`);
      assert.equal(severity(`[spec] [${tag}] 6 tests @ src/a.ts:3: x -> y`), tag, `[spec] [${tag}]`);
      assert.equal(severity(`[standards] [${tag}] 9 error handling @ src/a.ts:3: x -> y`), tag, `[standards] [${tag}]`);
      assert.equal(severity(`[standards] [${tag.toLowerCase()}] 9 error handling @ src/a.ts:3: x -> y`), tag, `lower case [${tag.toLowerCase()}]`);
      assert.equal(severity(`[SPEC]  [${tag.toLowerCase()}] 6 tests @ src/a.ts:3: x -> y`), tag, 'axis tag in upper case, two spaces');
    }
    assert.equal(severity('[standards] 9 error handling [P0] @ src/a.ts:3: x -> y'), 'P1', 'a tag after the dimension');
    assert.equal(severity('[standards] 9 error handling @ src/a.ts:3: [P2] x -> y'), 'P1', 'a tag after the location');
    assert.equal(severity('[standards][P0] 9 error handling @ src/a.ts:3: x -> y'), 'P1', 'no white space between the axis tag and the severity tag');
    assert.equal(severity('[standards] 9 error handling @ src/a.ts:3: x -> y'), 'P1', 'no tag');
    assert.equal(severity('[P3] 9 error handling @ src/a.ts:3: x -> y'), 'P1', 'an unknown level');
    assert.equal(severity(''), 'P1', 'an empty reason');
  });

  test('T1-REVIEW-SEVERITY acceptance 2: a severity tag before an advisory or pre-existing tag keeps the reason advisory, and one elsewhere changes nothing', () => {
    // R4's four reasons.
    const advisory = ['[standards] [P2] [suggestion] x', '[spec] [P1] @ a.ts:3: [question] y'];
    const preExisting = ['[standards] [P2] [pre-existing] @ a.ts:3: z'];
    const onMain = '[standards] 9 errors [P2] [suggestion] @ a.ts:3: w';
    // The advisory reasons the existing tests name (tests/core/review-policy.test.ts, tests/scenarios/pre-existing.test.ts).
    const existingAdvisory = [
      '[standards] 9 error handling (class: journal-before-save) @ src/a.ts:3: [question] is the event saved first? -> confirm',
      '[standards] 9 error handling (class: journal-before-save) @ src/a.ts:3: [suggestion] is the event saved first? -> confirm',
      '[question] why?',
    ];
    const existingPreExisting = [
      '[standards] 9 error handling @ src/a.ts:40: [pre-existing] the catch swallows the error -> rethrow',
      '[standards] 9 error handling @ src/a.ts:40: [pre-existing] the retry loop never backs off -> add a delay',
      '[spec] 6 tests missing @ src/hello.ts:40: [pre-existing] the helper has no test -> add one',
    ];
    const existingBlock = '[standards] 9 error handling [question] (class: journal-before-save) @ src/a.ts:3: x -> y';
    for (const r of [...advisory, ...existingAdvisory]) {
      assert.equal(ADVISORY_TAG.test(r), true, `ADVISORY_TAG: ${r}`);
      assert.equal(PRE_EXISTING_TAG.test(r), false, `PRE_EXISTING_TAG: ${r}`);
      assert.deepEqual(citedReasonsOf(block([r]), ['a.ts', 'src/a.ts']), [], `citedReasonsOf: ${r}`);
    }
    for (const r of [...preExisting, ...existingPreExisting]) {
      assert.equal(PRE_EXISTING_TAG.test(r), true, `PRE_EXISTING_TAG: ${r}`);
      assert.equal(ADVISORY_TAG.test(r), false, `ADVISORY_TAG: ${r}`);
      // Without a changed-line map the tag is ignored: the reason stays a cited block (R3 decision 1 F2).
      assert.deepEqual(citedReasonsOf(block([r]), ['a.ts', 'src/a.ts', 'src/hello.ts']), [r], `citedReasonsOf: ${r}`);
    }
    // A severity tag with no white space after the axis tag is not in its position, as findingSeverity reads it (R3 decision 1 F1).
    const noWhiteSpace = ['[standards][P2] [suggestion] @ src/a.ts:3: broken -> fix', '[standards][P2] [pre-existing] @ src/a.ts:3: broken -> fix'];
    for (const r of [onMain, existingBlock, ...noWhiteSpace]) {
      assert.equal(ADVISORY_TAG.test(r), false, `ADVISORY_TAG: ${r}`);
      assert.equal(PRE_EXISTING_TAG.test(r), false, `PRE_EXISTING_TAG: ${r}`);
      assert.deepEqual(citedReasonsOf(block([r]), ['a.ts', 'src/a.ts']), [r], `citedReasonsOf: ${r}`);
      assert.equal(stripAdvisoryTags(block([r])).verdict.verdict, 'block', `stripAdvisoryTags keeps the block: ${r}`);
    }
    assert.equal(stripAdvisoryTags(block(['[standards] [P2] [suggestion] @ src/a.ts:3: broken -> fix'])).verdict.verdict, 'pass', 'with the white space the tag is advisory');
    assert.equal(stripAdvisoryTags(block(['[spec][P1] @ a.ts:3: [question] y'])).verdict.verdict, 'pass', 'a tag after the location stays advisory, as on main');
    for (const r of ['[P2] [suggestion] x', '  [p0] @ a.ts:3: [question] y', '[spec] [p1] [question] y']) assert.equal(stripAdvisoryTags(block([r])).verdict.verdict, 'pass', `no axis or lower case, still advisory: ${r}`);
    assert.equal(PRE_EXISTING_TAG.test('[P1] [pre-existing] @ a.ts:3: z'), true, 'no axis before [pre-existing]');
  });

  test('T1-REVIEW-SEVERITY acceptance 3: recordFindings stores the severity of each new finding and keeps it on a re-raise', () => {
    const reasons = ['[standards] [P0] 9 error handling @ src/a.ts:3: x -> y', '[spec] [P2] 14 scope @ src/b.ts:1: helper -> remove', '[standards] 9 error handling @ src/c.ts:5: x -> y'];
    for (const stage of ['pre', 'formal'] as const) {
      const first = policy.recordFindings([], { stage, round: 1, candidateSha: 'sha-1', at: T0, outcome: 'block', reasons });
      assert.deepEqual(first.findings.map((f) => [f.id, f.severity]), [['F1', 'P0'], ['F2', 'P2'], ['F3', 'P1']], `${stage}: severity of each new finding`);
      const second = policy.recordFindings(first.findings, { stage, round: 2, candidateSha: 'sha-2', at: '2026-01-01T01:00:00.000Z', outcome: 'block', reasons: ['[spec] [P0] 14 scope @ src/b.ts:1: helper -> remove (re:F2)'] });
      assert.deepEqual(second.reraised, ['F2'], `${stage}: a re-raise`);
      assert.equal(second.findings.find((f) => f.id === 'F2')!.severity, 'P2', `${stage}: a re-raise keeps the stored severity`);
    }
    const old = ReviewFinding.parse({ id: 'F1', stage: 'formal', round: 1, reason: '[standards] 9 x @ a.ts:1: y -> z', raisedAt: T0 });
    assert.equal('severity' in old, false, 'a record written before the card parses with no severity');
  });
});
