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

  test('formatReviewStats prints one line per card, with the family members and the family total under the card that supersedes them', () => {
    const line = stats.formatReviewStats(stats.summarizeReviews([reviewedRun()], []));
    assert.equal(
      line,
      'T1-A  R2 3 rounds, 1 block (bugs 1), 1 quota hold, 1m 30s | R3 2 decisions, 1 block, 8m 00s | findings 4: 3 pre, 1 formal, 1 open, 1 disputed, 2 resolved, 1 re-raised, 1 first-round miss | wall 33m 00s',
    );
    assert.equal(stats.formatReviewStats(stats.summarizeReviews([run({ cardId: 'T1-QUIET' })], [])), 'T1-QUIET  R2 0 rounds, 0s | R3 0 decisions, 0s | findings 0 | wall 0s');
    assert.equal(stats.formatReviewStats([]), 'no card runs');
  });

  test('aidlc review stats prints the summary as JSON when stdout is not a TTY and one line per card with --no-json', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-stats-'));
    mkdirSync(path.join(dir, 'cards', 'g-stats-cli'), { recursive: true });
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
