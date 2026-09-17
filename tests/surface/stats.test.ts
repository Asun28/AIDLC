import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CardRun, addMs } from '../../src/core/types.ts';
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
