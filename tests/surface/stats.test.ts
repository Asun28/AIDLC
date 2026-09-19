import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CardRun, addMs } from '../../src/core/types.ts';
import { goal } from '../core/_fixtures.ts';
// Namespace import: the summary is new, so each test fails at its first call rather than at link time.
import * as stats from '../../src/review/stats.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const T0 = '2026-09-11T00:00:00.000Z';
const MIN = 60_000;
const at = (ms: number) => addMs(T0, ms);

function run(overrides: Record<string, unknown> = {}): CardRun {
  return CardRun.parse({ goalId: 'g-stats', cardId: 'T1-A', cardRevision: 0, goalGeneration: 0, state: 'SHIP', startedAt: T0, deadline: at(180 * MIN), updatedAt: T0, ...overrides });
}

/**
 * One card run through two R2 cycles and two R3 decisions, with every disposition a finding can carry.
 * The expected numbers below are read off this timeline by hand, never recomputed from the summary.
 */
function reviewedRun(): CardRun {
  return run({
    preReview: {
      rounds: [
        { round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd1', requestedAt: at(0), durationMs: MIN, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'], perspectives: [{ name: 'bugs', outcome: 'block', durationMs: 40_000, reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'] }, { name: 'security', outcome: 'pass', durationMs: 20_000, reasons: [] }] },
        { round: 1, cycle: 1, reviewer: 'r2', candidateDigest: 'd2', requestedAt: at(20 * MIN), durationMs: 0, outcome: 'quota-hold', reasons: [], holdUntil: at(22 * MIN) },
        { round: 2, cycle: 1, reviewer: 'r2', candidateDigest: 'd2', requestedAt: at(25 * MIN), durationMs: 30_000, outcome: 'pass', reasons: [], perspectives: [{ name: 'bugs', outcome: 'pass', durationMs: 30_000, reasons: [] }, { name: 'security', outcome: 'pass', durationMs: 25_000, reasons: [] }] },
      ],
      handoffs: [],
    },
    review: {
      substantiveDecisions: 2,
      substantiveBlocks: 1,
      scriptCounter: 2,
      noVerdictRetriesUsed: 0,
      invocations: [
        { invocationId: 'r3:T1-A.r3.1.aaaaaaaa', candidateDigest: 'd1', base: 'main', policyVersion: 'REVIEW.md@3', reviewer: 'r3', requestedAt: at(10 * MIN), outcome: 'block', mergeBlocking: true, candidateSha: 'sha1' },
        { invocationId: 'r3:T1-A.r3.2.bbbbbbbb', candidateDigest: 'd2', base: 'main', policyVersion: 'REVIEW.md@3', reviewer: 'r3', requestedAt: at(30 * MIN), outcome: 'pass', candidateSha: 'sha2' },
      ],
    },
    // The decision artifact each formal invocation writes: its `createdAt` is when the decision landed.
    evidence: [
      { id: 'r3-T1-A.r3.1.aaaaaaaa', kind: 'artifact', createdAt: at(15 * MIN), candidateDigest: 'd1', note: 'formal review r3 block-defect' },
      { id: 'r3-T1-A.r3.2.bbbbbbbb', kind: 'artifact', createdAt: at(33 * MIN), candidateDigest: 'd2', note: 'formal review r3 pass' },
    ],
    findings: [
      { id: 'F1', stage: 'pre', cycle: 0, round: 1, perspective: 'bugs', reason: '[spec] 1 @ src/a.ts:1: wrong -> fix', raisedAt: at(MIN), disposition: 'open', reraised: [{ stage: 'pre', cycle: 1, round: 2, at: at(26 * MIN), reason: 'still wrong' }] },
      { id: 'F2', stage: 'pre', cycle: 0, round: 1, perspective: 'bugs', reason: '[standards] 4 @ src/a.ts:9: naming -> rename', raisedAt: at(MIN), disposition: 'disputed', disputes: [{ at: at(5 * MIN), note: 'the name is the one the card fixes', afterReraises: 0 }] },
      { id: 'F3', stage: 'pre', cycle: 0, round: 1, perspective: 'security', reason: '[spec] 2 @ src/a.ts:4: unchecked -> check', raisedAt: at(MIN), disposition: 'open', resolvedAt: at(25 * MIN + 30_000) },
      { id: 'F4', stage: 'formal', round: 1, reason: '[spec] 6 @ src/b.ts:3: untested -> add the test', raisedAt: at(15 * MIN), disposition: 'open', outsideDelta: true, resolvedAt: at(33 * MIN) },
    ],
  });
}

/**
 * A card run whose shadow coverage records were retained, over three candidates:
 *   sha1 one decided round, item 3 unaccounted, item 2 conflicted, one malformed entry -> incomplete, and last on sha1;
 *   sha2 one round that accounted for everything, then a round that asked for no coverage -> last on sha2, no unaccounted item;
 *   sha3 a round with item 1 unaccounted and item 4 inconsistent, then a complete round -> the later round is last on sha3.
 * The expected numbers below are read off this timeline by hand, never recomputed from the summary.
 */
const coverage = (over: Record<string, unknown> = {}) => ({ expected: 4, accounted: 4, unaccounted: [], conflicted: [], inconsistent: [], malformed: 0, angles: ['ac-coverage'], ...over });

function coveredRun(): CardRun {
  return run({
    preReview: {
      rounds: [
        { round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd1', candidateSha: 'sha1', requestedAt: at(0), durationMs: MIN, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'], coverage: coverage({ accounted: 3, unaccounted: [3], conflicted: [2], malformed: 1 }) },
        { round: 1, cycle: 1, reviewer: 'r2', candidateDigest: 'd2', candidateSha: 'sha2', requestedAt: at(20 * MIN), durationMs: MIN, outcome: 'pass', reasons: [], coverage: coverage({}) },
        // A round that asked for no coverage is not a requested round, and it is still the last decided round on sha2.
        { round: 2, cycle: 1, reviewer: 'r2', candidateDigest: 'd2', candidateSha: 'sha2', requestedAt: at(25 * MIN), durationMs: MIN, outcome: 'pass', reasons: [] },
        { round: 1, cycle: 2, reviewer: 'r2', candidateDigest: 'd3', candidateSha: 'sha3', requestedAt: at(40 * MIN), durationMs: MIN, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'], coverage: coverage({ accounted: 3, unaccounted: [1], inconsistent: [4] }) },
        { round: 2, cycle: 2, reviewer: 'r2', candidateDigest: 'd3', candidateSha: 'sha3', requestedAt: at(50 * MIN), durationMs: MIN, outcome: 'pass', reasons: [], coverage: coverage({}) },
        // A reserved round carries no decision, so its record is no round of any kind.
        { round: 3, cycle: 2, reviewer: 'r2', candidateDigest: 'd3', candidateSha: 'sha3', requestedAt: at(55 * MIN), durationMs: 0, outcome: 'pending', reasons: [], coverage: coverage({ accounted: 0, unaccounted: [1, 2, 3, 4] }) },
      ],
      handoffs: [],
    },
    findings: [
      { id: 'F1', stage: 'formal', round: 1, reason: '[spec] 6 @ src/b.ts:3: untested -> add the test', candidateSha: 'sha1', raisedAt: at(10 * MIN), disposition: 'open' },
      // The axis tag is read as `enforceCitations` reads it: the leading space and the case are the reviewer's, not a different axis.
      { id: 'F2', stage: 'formal', round: 1, reason: ' [Spec] 9 @ src/b.ts:11: contract deviation -> restore it', candidateSha: 'sha1', raisedAt: at(10 * MIN), disposition: 'open' },
      { id: 'F3', stage: 'formal', round: 1, reason: '[standards] 4 @ src/b.ts:9: naming -> rename', candidateSha: 'sha1', raisedAt: at(10 * MIN), disposition: 'open' },
      { id: 'F4', stage: 'pre', cycle: 0, round: 1, reason: '[spec] 1 @ src/a.ts:1: wrong -> fix', candidateSha: 'sha1', raisedAt: at(MIN), disposition: 'open' },
      { id: 'F5', stage: 'formal', round: 2, reason: '[spec] 2 @ src/b.ts:5: missing -> add it', candidateSha: 'sha2', raisedAt: at(30 * MIN), disposition: 'open' },
      { id: 'F6', stage: 'formal', round: 3, reason: '[spec] 3 @ src/b.ts:7: missing -> add it', candidateSha: 'sha3', raisedAt: at(60 * MIN), disposition: 'open' },
      { id: 'F7', stage: 'formal', round: 3, reason: '[spec] 5 @ src/b.ts:8: missing -> add it', raisedAt: at(60 * MIN), disposition: 'open' },
    ],
  });
}

const NO_COVERAGE = { roundsRequested: 0, roundsComplete: 0, unaccounted: 0, conflicted: 0, inconsistent: 0, r3SpecFindingsAfterIncomplete: 0 };

describe('review statistics (R11, R12)', () => {
  test('summarizeReviews reports the R2 rounds, the R3 decisions, the findings by disposition and the wall time of one card', () => {
    const [summary, ...rest] = stats.summarizeReviews([reviewedRun()], []);
    assert.equal(rest.length, 0, 'one card run, one entry');
    assert.equal(summary?.cardId, 'T1-A');
    assert.deepEqual(summary?.r2, { rounds: 3, blocks: 1, noVerdict: 0, quotaHolds: 1, durationMs: 90_000, blocksByPerspective: { bugs: 1 } });
    // 15:00 - 10:00 for the blocked decision, 33:00 - 30:00 for the passing one.
    assert.deepEqual(summary?.r3, { decisions: 2, blocks: 1, durationMs: 8 * MIN });
    assert.deepEqual(summary?.findings, { total: 4, pre: 3, formal: 1, open: 1, disputed: 1, reraised: 1, firstRoundMiss: 1, resolved: 2 });
    // First request at 00:00, last pass decided at 33:00.
    assert.equal(summary?.wallMs, 33 * MIN);
  });

  test('summarizeReviews reports zeros for a card run that was never reviewed', () => {
    const [summary] = stats.summarizeReviews([run({ cardId: 'T1-QUIET' })], []);
    assert.equal(summary?.cardId, 'T1-QUIET');
    assert.deepEqual(summary?.r2, { rounds: 0, blocks: 0, noVerdict: 0, quotaHolds: 0, durationMs: 0, blocksByPerspective: {} });
    assert.deepEqual(summary?.r3, { decisions: 0, blocks: 0, durationMs: 0 });
    assert.deepEqual(summary?.findings, { total: 0, pre: 0, formal: 0, open: 0, disputed: 0, reraised: 0, firstRoundMiss: 0, resolved: 0 });
    assert.equal(summary?.wallMs, 0);
    assert.equal(summary?.family, undefined, 'a card that supersedes nothing reports no family');
  });

  test('summarizeReviews reports the family of a card that supersedes earlier cards, oldest first, with the family totals', () => {
    // T1-A -> T1-A-2 -> T1-A-3: each card was superseded by the next, so the third carries the family.
    const registry = [
      { id: 'T1-A', superseded_by: 'T1-A-2' },
      { id: 'T1-A-2', superseded_by: 'T1-A-3' },
      { id: 'T1-A-3' },
    ];
    const first = run({
      cardId: 'T1-A',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd1', requestedAt: at(0), durationMs: 10_000, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'] }], handoffs: [] },
      findings: [{ id: 'F1', stage: 'pre', cycle: 0, round: 1, reason: '[spec] 1 @ src/a.ts:1: wrong -> fix', raisedAt: at(10_000), disposition: 'open' }],
    });
    const second = run({
      cardId: 'T1-A-2',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd2', requestedAt: at(60 * MIN), durationMs: 20_000, outcome: 'pass', reasons: [] }], handoffs: [] },
      review: { substantiveDecisions: 1, substantiveBlocks: 0, scriptCounter: 1, noVerdictRetriesUsed: 0, invocations: [{ invocationId: 'r3:T1-A-2.r3.1.dddddddd', candidateDigest: 'd2', base: 'main', policyVersion: 'REVIEW.md@3', reviewer: 'codex', requestedAt: at(61 * MIN), outcome: 'pass' }] },
      evidence: [{ id: 'r3-T1-A-2.r3.1.dddddddd', kind: 'artifact', createdAt: at(63 * MIN), candidateDigest: 'd2', note: 'formal review codex pass' }],
    });
    const third = run({
      cardId: 'T1-A-3',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd3', requestedAt: at(120 * MIN), durationMs: 30_000, outcome: 'pass', reasons: [] }], handoffs: [] },
      findings: [{ id: 'F1', stage: 'formal', round: 1, reason: '[spec] 6 @ src/c.ts:2: untested -> add the test', raisedAt: at(121 * MIN), disposition: 'open', resolvedAt: at(122 * MIN) }],
    });
    const summaries = stats.summarizeReviews([third, first, second], registry);
    assert.deepEqual(summaries.map((s) => s.cardId), ['T1-A', 'T1-A-2', 'T1-A-3'], 'every card of the family is reported');
    const family = summaries.find((s) => s.cardId === 'T1-A-3')?.family;
    assert.deepEqual(family?.members.map((m) => m.cardId), ['T1-A', 'T1-A-2'], 'the predecessors come oldest first');
    assert.equal(family?.members[0]?.r2.blocks, 1, "the predecessor's own rounds are reported");
    // The round that blocked carries no panel record, so the block counts under the reviewer that decided it.
    assert.deepEqual(family?.totals.r2, { rounds: 3, blocks: 1, noVerdict: 0, quotaHolds: 0, durationMs: 60_000, blocksByPerspective: { deepseek: 1 } });
    assert.deepEqual(family?.totals.r3, { decisions: 1, blocks: 0, durationMs: 2 * MIN });
    assert.deepEqual(family?.totals.findings, { total: 2, pre: 1, formal: 1, open: 1, disputed: 0, reraised: 0, firstRoundMiss: 0, resolved: 1 });
    // 10s on the first card, 3 min on the second, 30s on the third.
    assert.equal(family?.totals.wallMs, 220_000);
    assert.equal(summaries.find((s) => s.cardId === 'T1-A')?.family, undefined, 'the oldest card of a family supersedes nothing');
    assert.deepEqual(summaries.find((s) => s.cardId === 'T1-A-2')?.family?.members.map((m) => m.cardId), ['T1-A'], 'a middle card carries the part of the family it supersedes');
  });

  test('summarizeReviews keeps a predecessor that ran under another goal whole when the report is scoped to one goal (R3 F1)', () => {
    const registry = [
      { id: 'T1-A', superseded_by: 'T1-A-2' },
      { id: 'T1-A-2' },
    ];
    const older = run({
      goalId: 'g-old',
      cardId: 'T1-A',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd1', requestedAt: at(0), durationMs: 10_000, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'] }], handoffs: [] },
      findings: [{ id: 'F1', stage: 'pre', cycle: 0, round: 1, reason: '[spec] 1 @ src/a.ts:1: wrong -> fix', raisedAt: at(10_000), disposition: 'open' }],
    });
    const newer = run({
      goalId: 'g-new',
      cardId: 'T1-A-2',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd2', requestedAt: at(60 * MIN), durationMs: 20_000, outcome: 'pass', reasons: [] }], handoffs: [] },
    });
    const summaries = stats.summarizeReviews([older, newer], registry, { goals: ['g-new'] });
    assert.deepEqual(summaries.map((s) => s.cardId), ['T1-A-2'], 'only the cards of the goal asked for are reported');
    const member = summaries[0]?.family?.members[0];
    assert.equal(member?.cardId, 'T1-A');
    assert.equal(member?.r2.rounds, 1, 'the predecessor keeps the round it ran under the other goal');
    assert.equal(member?.findings.total, 1, 'and the findings it raised there');
    assert.deepEqual(summaries[0]?.family?.totals.r2, { rounds: 2, blocks: 1, noVerdict: 0, quotaHolds: 0, durationMs: 30_000, blocksByPerspective: { deepseek: 1 } });
  });

  test('summarizeReviews counts a panel angle named after an Object property, per card and in the family totals (R3 F2)', () => {
    const registry = [{ id: 'T1-A', superseded_by: 'T1-A-2' }, { id: 'T1-A-2' }];
    const blocked = (cardId: string, requestedAt: string) =>
      run({
        cardId,
        preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd', requestedAt, durationMs: 1_000, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'], perspectives: [{ name: 'constructor', outcome: 'block', durationMs: 1_000, reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'] }, { name: 'toString', outcome: 'block', durationMs: 1_000, reasons: ['[spec] 1 @ src/a.ts:2: also wrong -> fix'] }] }], handoffs: [] },
      });
    const summaries = stats.summarizeReviews([blocked('T1-A', at(0)), blocked('T1-A-2', at(MIN))], registry);
    assert.deepEqual(summaries[0]?.r2.blocksByPerspective, { constructor: 1, toString: 1 }, 'the angle name is a count, never an inherited property');
    assert.deepEqual(summaries[1]?.family?.totals.r2.blocksByPerspective, { constructor: 2, toString: 2 });
  });

  test('summarizeReviews counts an advisory block, which the enforcement counter leaves out (R3 F3)', () => {
    const advisory = run({
      review: {
        substantiveDecisions: 1,
        substantiveBlocks: 0,
        scriptCounter: 1,
        noVerdictRetriesUsed: 0,
        invocations: [{ invocationId: 'r3:T1-A.r3.1.eeeeeeee', candidateDigest: 'd1', base: 'main', policyVersion: 'REVIEW.md@3', reviewer: 'codex', requestedAt: at(0), outcome: 'block', mergeBlocking: false, candidateSha: 'sha1' }],
      },
      evidence: [{ id: 'r3-T1-A.r3.1.eeeeeeee', kind: 'artifact', createdAt: at(MIN), candidateDigest: 'd1', note: 'formal review codex block-advisory' }],
    });
    const [summary] = stats.summarizeReviews([advisory], []);
    assert.deepEqual(summary?.r3, { decisions: 1, blocks: 1, durationMs: MIN }, 'a block that never barred the merge is still a block');
  });

  test('summarizeReviews measures an R2 round to the completion its artifact records, not to the reviewer runtime (R3 F4)', () => {
    // A round waits for the diff, the prompt and pool admission before the reviewer starts, so the round
    // ends when `commitPreReviewResult` writes `pre-review-<cycle>-<round>-<attempt>`, not one runtime after the request.
    const delayed = run({
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd1', requestedAt: at(0), durationMs: 5_000, outcome: 'pass', reasons: [], reservationId: 'T1-A.pre.0.1.1.abcd1234' }], handoffs: [] },
      evidence: [{ id: 'pre-review-0-1-1', kind: 'artifact', createdAt: at(65_000), candidateDigest: 'd1', note: 'pre-review deepseek pass' }],
    });
    const [summary] = stats.summarizeReviews([delayed], []);
    assert.equal(summary?.wallMs, 65_000, 'the round ended when its artifact landed');
    assert.equal(summary?.r2.durationMs, 5_000, 'the measured reviewer runtime is unchanged');
    // A record from before the artifact existed carries no reservation id and keeps the measured end.
    const legacy = run({ preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd1', requestedAt: at(0), durationMs: 5_000, outcome: 'pass', reasons: [] }], handoffs: [] } });
    assert.equal(stats.summarizeReviews([legacy], [])[0]?.wallMs, 5_000);
  });

  test('formatReviewStats prints one line per card, with the family members and the family total under the card that supersedes them', () => {
    const line = stats.formatReviewStats(stats.summarizeReviews([reviewedRun()], []));
    assert.equal(
      line,
      'T1-A  R2 3 rounds, 1 block (bugs 1), 1 quota hold, 1m 30s | R3 2 decisions, 1 block, 8m 00s | findings 4: 3 pre, 1 formal, 1 open, 1 disputed, 2 resolved, 1 re-raised, 1 first-round miss | coverage: not requested | wall 33m 00s',
    );
    assert.equal(stats.formatReviewStats(stats.summarizeReviews([run({ cardId: 'T1-QUIET' })], [])), 'T1-QUIET  R2 0 rounds, 0s | R3 0 decisions, 0s | findings 0 | coverage: not requested | wall 0s');
    assert.equal(stats.formatReviewStats([]), 'no card runs');
  });

  test('summarizeReviews reports the coverage of the rounds that requested it and the R3 spec findings that followed an unaccounted item (R11 acceptance 1)', () => {
    const [summary] = stats.summarizeReviews([coveredRun()], []);
    assert.deepEqual(summary?.coverage, {
      // Four decided rounds carry a coverage record; the pending one and the round that asked for none do not.
      roundsRequested: 4,
      // The two rounds with no unaccounted, conflicted or inconsistent item and no malformed entry.
      roundsComplete: 2,
      // Item 3 on sha1 and item 1 on sha3.
      unaccounted: 2,
      conflicted: 1,
      inconsistent: 1,
      // F1 and F2: formal, spec-tagged, on sha1, whose last decided round left item 3 unaccounted. F3 is
      // another axis, F4 another stage, F5 a candidate whose last decided round accounted for everything,
      // F6 a candidate a later round completed, F7 bound to no candidate.
      r3SpecFindingsAfterIncomplete: 2,
    });
  });

  test('summarizeReviews joins the coverage of every run of a card, so the last decided round on a candidate is the last whichever run decided it (R2 cycle 0 round 1 F1)', () => {
    // The same card under two goals. sha1 is reviewed only in the first run, which left item 2 unaccounted;
    // sha2 is left incomplete there too, but the second run decides a later round on it that accounts for
    // every item. Matching findings against the rounds of their own run alone gets both candidates wrong.
    const first = run({
      goalId: 'g-a',
      preReview: {
        rounds: [
          { round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd1', candidateSha: 'sha1', requestedAt: at(0), durationMs: MIN, outcome: 'block', reasons: ['[spec] 2 @ src/a.ts:1: wrong -> fix'], coverage: coverage({ accounted: 3, unaccounted: [2] }) },
          { round: 1, cycle: 1, reviewer: 'r2', candidateDigest: 'd2', candidateSha: 'sha2', requestedAt: at(10 * MIN), durationMs: MIN, outcome: 'block', reasons: ['[spec] 3 @ src/a.ts:2: wrong -> fix'], coverage: coverage({ accounted: 3, unaccounted: [3] }) },
        ],
        handoffs: [],
      },
      findings: [{ id: 'F1', stage: 'formal', round: 1, reason: '[spec] 3 @ src/b.ts:1: missing -> add it', candidateSha: 'sha2', raisedAt: at(11 * MIN), disposition: 'open' }],
    });
    const second = run({
      goalId: 'g-b',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd2', candidateSha: 'sha2', requestedAt: at(20 * MIN), durationMs: MIN, outcome: 'pass', reasons: [], coverage: coverage() }], handoffs: [] },
      findings: [
        { id: 'F1', stage: 'formal', round: 1, reason: '[spec] 2 @ src/b.ts:3: missing -> add it', candidateSha: 'sha1', raisedAt: at(25 * MIN), disposition: 'open' },
        { id: 'F2', stage: 'formal', round: 1, reason: '[spec] 2 @ src/b.ts:4: also missing -> add it', candidateSha: 'sha1', raisedAt: at(25 * MIN), disposition: 'open' },
      ],
    });
    const [summary, ...rest] = stats.summarizeReviews([first, second], []);
    assert.equal(rest.length, 0, 'both runs are the one card');
    assert.equal(summary?.goalId, undefined, 'two goals ran it');
    assert.equal(summary?.coverage.roundsRequested, 3, 'the rounds of both runs');
    assert.equal(summary?.coverage.unaccounted, 2, 'and their items');
    assert.equal(
      summary?.coverage.r3SpecFindingsAfterIncomplete,
      2,
      'the two findings on sha1, whose only round left item 2 unaccounted; the sha2 finding is cleared by the later round the other run decided',
    );
  });

  test('summarizeReviews settles a candidate by the round decided last, not the one requested last (R3 decision 1 F1)', () => {
    // The first round is requested first and decided last: its artifact lands at 30:00, while the round
    // the other run requested at 10:00 is measured out at 20:00. Ordering by the request calls the
    // complete round last and loses the finding.
    const slow = run({
      goalId: 'g-a',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd1', candidateSha: 'sha1', requestedAt: at(0), durationMs: 5 * MIN, outcome: 'block', reasons: ['[spec] 2 @ src/a.ts:1: wrong -> fix'], reservationId: 'T1-A.pre.0.1.1.aaaa1111', coverage: coverage({ accounted: 3, unaccounted: [2] }) }], handoffs: [] },
      evidence: [{ id: 'pre-review-0-1-1', kind: 'artifact', createdAt: at(30 * MIN), candidateDigest: 'd1', note: 'pre-review r2 block' }],
      findings: [{ id: 'F1', stage: 'formal', round: 1, reason: '[spec] 2 @ src/b.ts:1: missing -> add it', candidateSha: 'sha1', raisedAt: at(31 * MIN), disposition: 'open' }],
    });
    const quick = run({
      goalId: 'g-b',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd1', candidateSha: 'sha1', requestedAt: at(10 * MIN), durationMs: 10 * MIN, outcome: 'pass', reasons: [], coverage: coverage() }], handoffs: [] },
    });
    const [summary] = stats.summarizeReviews([slow, quick], []);
    assert.equal(summary?.coverage.r3SpecFindingsAfterIncomplete, 1, 'the round decided at 30:00 is the last on sha1, and it left item 2 unaccounted');
  });

  test('summarizeReviews orders two rounds decided at the same instant from the records, never from the order the runs were passed in (R3 decision 1 F1)', () => {
    // Same request time, same measured runtime, same candidate: only the persisted cycle, round and goal
    // separate them, and the summary must not change when the caller hands the runs over in either order.
    const round = (over: Record<string, unknown>) => ({ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd1', candidateSha: 'sha1', requestedAt: at(0), durationMs: MIN, reasons: [], ...over });
    const first = run({
      goalId: 'g-a',
      preReview: { rounds: [round({ outcome: 'block', reasons: ['[spec] 2 @ src/a.ts:1: wrong -> fix'], coverage: coverage({ accounted: 3, unaccounted: [2] }) })], handoffs: [] },
      findings: [{ id: 'F1', stage: 'formal', round: 1, reason: '[spec] 2 @ src/b.ts:1: missing -> add it', candidateSha: 'sha1', raisedAt: at(5 * MIN), disposition: 'open' }],
    });
    const second = run({ goalId: 'g-b', preReview: { rounds: [round({ outcome: 'pass', coverage: coverage() })], handoffs: [] } });
    const forwards = stats.summarizeReviews([first, second], [])[0]?.coverage;
    const backwards = stats.summarizeReviews([second, first], [])[0]?.coverage;
    assert.deepEqual(forwards, backwards, 'the caller order decides nothing');
    assert.equal(forwards?.r3SpecFindingsAfterIncomplete, 0, 'g-b decided the last round on sha1 and accounted for every item');
  });

  test('summarizeReviews treats a conflicted, an inconsistent and a malformed round as incomplete without counting a finding after them (R3 decision 1 F2)', () => {
    // Each round accounted for every item, so none of them leaves the question an unaccounted item asks;
    // each is still short of complete, for a different reason.
    const only = run({
      preReview: {
        rounds: [
          { round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'dc', candidateSha: 'shaC', requestedAt: at(0), durationMs: MIN, outcome: 'block', reasons: ['[spec] 2 @ src/a.ts:1: wrong -> fix'], coverage: coverage({ conflicted: [2] }) },
          { round: 1, cycle: 1, reviewer: 'r2', candidateDigest: 'di', candidateSha: 'shaI', requestedAt: at(10 * MIN), durationMs: MIN, outcome: 'block', reasons: ['[spec] 3 @ src/a.ts:2: wrong -> fix'], coverage: coverage({ inconsistent: [3] }) },
          { round: 1, cycle: 2, reviewer: 'r2', candidateDigest: 'dm', candidateSha: 'shaM', requestedAt: at(20 * MIN), durationMs: MIN, outcome: 'pass', reasons: [], coverage: coverage({ malformed: 1 }) },
        ],
        handoffs: [],
      },
      findings: [
        { id: 'F1', stage: 'formal', round: 1, reason: '[spec] 2 @ src/b.ts:1: missing -> add it', candidateSha: 'shaC', raisedAt: at(MIN), disposition: 'open' },
        { id: 'F2', stage: 'formal', round: 2, reason: '[spec] 3 @ src/b.ts:2: missing -> add it', candidateSha: 'shaI', raisedAt: at(11 * MIN), disposition: 'open' },
        { id: 'F3', stage: 'formal', round: 3, reason: '[spec] 4 @ src/b.ts:3: missing -> add it', candidateSha: 'shaM', raisedAt: at(21 * MIN), disposition: 'open' },
      ],
    });
    assert.deepEqual(stats.summarizeReviews([only], [])[0]?.coverage, {
      roundsRequested: 3,
      roundsComplete: 0,
      unaccounted: 0,
      conflicted: 1,
      inconsistent: 1,
      r3SpecFindingsAfterIncomplete: 0,
    });
  });

  test('summarizeReviews lets a decided round that asked for no coverage end the question an unaccounted item left (R3 decision 1 F3)', () => {
    const rounds = [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'dx', candidateSha: 'shaX', requestedAt: at(0), durationMs: MIN, outcome: 'block', reasons: ['[spec] 2 @ src/a.ts:1: wrong -> fix'], coverage: coverage({ accounted: 3, unaccounted: [2] }) }];
    const finding = [{ id: 'F1', stage: 'formal', round: 1, reason: '[spec] 2 @ src/b.ts:1: missing -> add it', candidateSha: 'shaX', raisedAt: at(30 * MIN), disposition: 'open' }];
    const open = run({ preReview: { rounds, handoffs: [] }, findings: finding });
    assert.equal(stats.summarizeReviews([open], [])[0]?.coverage.r3SpecFindingsAfterIncomplete, 1, 'the unaccounted round is the last on shaX');
    const closed = run({
      preReview: { rounds: [...rounds, { round: 2, cycle: 0, reviewer: 'r2', candidateDigest: 'dx', candidateSha: 'shaX', requestedAt: at(10 * MIN), durationMs: MIN, outcome: 'pass', reasons: [] }], handoffs: [] },
      findings: finding,
    });
    const after = stats.summarizeReviews([closed], [])[0]?.coverage;
    assert.equal(after?.roundsRequested, 1, 'the later round retained no coverage record');
    assert.equal(after?.r3SpecFindingsAfterIncomplete, 0, 'but it is the last decided round on shaX, so the question is settled');
  });

  test('summarizeReviews reports zeros for a card whose rounds carry no coverage (R12 acceptance 3)', () => {
    const [summary] = stats.summarizeReviews([reviewedRun()], []);
    assert.deepEqual(summary?.coverage, NO_COVERAGE, 'a round that asked for no coverage leaves every field at zero');
    const [quiet] = stats.summarizeReviews([run({ cardId: 'T1-QUIET' })], []);
    assert.deepEqual(quiet?.coverage, NO_COVERAGE, 'and so does a card that was never reviewed');
  });

  test('the family totals sum the coverage fields over the members and the card (R11 acceptance 2)', () => {
    const registry = [{ id: 'T1-A', superseded_by: 'T1-A-2' }, { id: 'T1-A-2' }];
    const older = coveredRun();
    const newer = run({
      cardId: 'T1-A-2',
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd9', candidateSha: 'sha9', requestedAt: at(90 * MIN), durationMs: MIN, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'], coverage: { expected: 2, accounted: 1, unaccounted: [2], conflicted: [], inconsistent: [], malformed: 0, angles: ['ac-coverage'] } }], handoffs: [] },
      findings: [{ id: 'F1', stage: 'formal', round: 1, reason: '[spec] 2 @ src/b.ts:1: missing -> add it', candidateSha: 'sha9', raisedAt: at(95 * MIN), disposition: 'open' }],
    });
    const summaries = stats.summarizeReviews([older, newer], registry);
    const successor = summaries.find((s) => s.cardId === 'T1-A-2');
    assert.deepEqual(successor?.coverage, { roundsRequested: 1, roundsComplete: 0, unaccounted: 1, conflicted: 0, inconsistent: 0, r3SpecFindingsAfterIncomplete: 1 }, 'the card reports its own rounds');
    assert.equal(successor?.family?.members[0]?.coverage.roundsRequested, 4, 'the predecessor keeps its own');
    assert.deepEqual(successor?.family?.totals.coverage, { roundsRequested: 5, roundsComplete: 2, unaccounted: 3, conflicted: 1, inconsistent: 1, r3SpecFindingsAfterIncomplete: 3 });
  });

  test('formatReviewStats prints the coverage segment, and `coverage: not requested` for a card with no coverage round (R12 acceptance 3)', () => {
    const covered = stats.formatReviewStats(stats.summarizeReviews([coveredRun()], []));
    assert.match(covered, /\| coverage: 2\/4 complete, unaccounted 2, conflicted 1, inconsistent 1, r3 spec findings after incomplete 2 \|/);
    const quiet = stats.formatReviewStats(stats.summarizeReviews([run({ cardId: 'T1-QUIET' })], []));
    assert.equal(quiet, 'T1-QUIET  R2 0 rounds, 0s | R3 0 decisions, 0s | findings 0 | coverage: not requested | wall 0s');
  });

  test('aidlc review stats prints the summary as JSON when stdout is not a TTY and one line per card with --no-json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-stats-'));
    mkdirSync(path.join(dir, 'cards', 'g-stats-cli'), { recursive: true });
    mkdirSync(path.join(dir, 'goals'), { recursive: true });
    const writeGoal = (id: string) => writeFileSync(path.join(dir, 'goals', `${id}.json`), JSON.stringify(goal({ id }), null, 2), 'utf8');
    writeGoal('g-stats-cli');
    writeFileSync(path.join(dir, 'cards', 'g-stats-cli', 'T1-A.json'), JSON.stringify({ ...reviewedRun(), goalId: 'g-stats-cli' }, null, 2), 'utf8');
    const cli = (args: string[]) => spawnSync(process.execPath, [path.join(root, 'src', 'cli', 'main.ts'), ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, AIDLC_STATE_DIR: dir }, windowsHide: true });

    const json = cli(['review', 'stats', '--goal', 'g-stats-cli']);
    assert.equal(json.status, 0, json.stderr);
    const payload = JSON.parse(json.stdout) as { cards: stats.CardReviewStats[] };
    assert.deepEqual(payload.cards.map((c) => c.cardId), ['T1-A'], 'a piped stdout prints the JSON summary');
    assert.equal(payload.cards[0]?.r2.rounds, 3);
    assert.equal(payload.cards[0]?.r3.decisions, 2);
    assert.equal(payload.cards[0]?.findings.firstRoundMiss, 1);

    const human = cli(['--no-json', 'review', 'stats', '--goal', 'g-stats-cli']);
    assert.equal(human.status, 0, human.stderr);
    assert.match(human.stdout.trim(), /^T1-A {2}R2 3 rounds, 1 block \(bugs 1\)/, 'the human output is the formatter line');

    // The family is aggregated from every goal, not only the one asked for (R3 F1). The chain comes from
    // this repository's own registry, where T0-ARC-EXTERN-DEP was superseded by T0-ARC-EXTERN-DEP-2.
    mkdirSync(path.join(dir, 'cards', 'g-stats-old'), { recursive: true });
    writeGoal('g-stats-old');
    const blockedRound = { round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'd1', requestedAt: at(0), durationMs: 10_000, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'] };
    writeFileSync(path.join(dir, 'cards', 'g-stats-old', 'T0-ARC-EXTERN-DEP.json'), JSON.stringify(run({ goalId: 'g-stats-old', cardId: 'T0-ARC-EXTERN-DEP', preReview: { rounds: [blockedRound], handoffs: [] } }), null, 2), 'utf8');
    writeFileSync(path.join(dir, 'cards', 'g-stats-cli', 'T0-ARC-EXTERN-DEP-2.json'), JSON.stringify(run({ goalId: 'g-stats-cli', cardId: 'T0-ARC-EXTERN-DEP-2', preReview: { rounds: [{ ...blockedRound, requestedAt: at(60 * MIN), durationMs: 20_000, outcome: 'pass', reasons: [] }], handoffs: [] } }), null, 2), 'utf8');
    const family = cli(['review', 'stats', '--goal', 'g-stats-cli', '--card', 'T0-ARC-EXTERN-DEP-2']);
    assert.equal(family.status, 0, family.stderr);
    const successor = (JSON.parse(family.stdout) as { cards: stats.CardReviewStats[] }).cards[0];
    assert.equal(successor?.family?.members[0]?.cardId, 'T0-ARC-EXTERN-DEP');
    assert.equal(successor?.family?.members[0]?.r2.rounds, 1, 'the predecessor that ran under another goal keeps its rounds');
    assert.equal(successor?.family?.totals.r2.durationMs, 30_000);

    const missing = cli(['review', 'stats', '--goal', 'g-stats-cli', '--card', 'T1-NEVER-RUN']);
    assert.equal(missing.status, 0, missing.stderr);
    const asked = (JSON.parse(missing.stdout) as { cards: stats.CardReviewStats[] }).cards;
    assert.deepEqual(asked.map((c) => c.cardId), ['T1-NEVER-RUN'], 'the card asked for is answered even without a run');
    assert.equal(asked[0]?.r2.rounds, 0);
  });

  test('summarizeReviews counts an unfinished review: a round still pending and a decision with no artifact add no duration', () => {
    const pending = run({
      preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd1', requestedAt: at(0), durationMs: 0, outcome: 'pending', reasons: [], reservationId: 'res-1' }], handoffs: [] },
      review: { substantiveDecisions: 0, substantiveBlocks: 0, scriptCounter: 0, noVerdictRetriesUsed: 0, invocations: [{ invocationId: 'r3:T1-A.r3.1.cccccccc', candidateDigest: 'd1', base: 'main', policyVersion: 'REVIEW.md@3', reviewer: 'r3', requestedAt: at(5 * MIN), outcome: 'pending' }] },
    });
    const [summary] = stats.summarizeReviews([pending], []);
    assert.equal(summary?.r2.rounds, 0, 'a reserved round is not a decided round');
    assert.equal(summary?.r3.durationMs, 0, 'no decision artifact, no measured duration');
    // No pass yet: the wall time runs to the last review request, at 05:00.
    assert.equal(summary?.wallMs, 5 * MIN);
  });
});
