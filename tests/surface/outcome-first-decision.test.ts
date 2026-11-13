// Card T1-OUTCOME-FIRST-DECISION: summary_review_convergence counts a card's first formal decision and its decisions to a
// pass in date order, leaving out second passes and base-sync decisions.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTables, type Row, type Tables } from '../../bench/outcome/ingest.ts';
import { cleanup, tmpDir } from '../infra/helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const temps: string[] = [];
after(() => temps.forEach((dir) => cleanup(dir)));

const duckdb = process.env['DUCKDB_BIN'] ?? (spawnSync('duckdb', ['--version'], { windowsHide: true }).status === 0 ? 'duckdb' : undefined);
const skip = duckdb === undefined ? 'no duckdb binary' : false;

/** A formal entry of `review_decisions`: codex, merge-blocking on a block and not on a pass, no stop, no decision number. */
const decision = (cardId: string, goalId: string, outcome: string, requestedAt: string, rest: Row = {}): Row => ({
  goalId, cardId, stage: 'formal', outcome, mergeBlocking: outcome === 'block', reviewer: 'codex', requestedAt, candidateSha: null,
  secondPass: null, baseSync: null, stopReview: false, decision: null, round: null, cycle: null, angles: [], ...rest,
});

/** The entries of each fixture card (body section Acceptance detail, item 1, of the card). */
const entries: Record<string, Row[]> = {
  'T1-SECOND': [
    decision('T1-SECOND', 'g-s', 'pass', '2026-01-01T01:00:00Z', { decision: 1 }),
    decision('T1-SECOND', 'g-s', 'block', '2026-01-01T02:00:00Z', { decision: 2, secondPass: true }),
    decision('T1-SECOND', 'g-s', 'pass', '2026-01-01T02:30:00Z', { decision: 3 }),
  ],
  'T1-SECOND-ONLY': [decision('T1-SECOND-ONLY', 'g-o', 'pass', '2026-01-08T00:00:00Z', { decision: 1, secondPass: true })],
  'T1-SYNC': [
    decision('T1-SYNC', 'g-s', 'pass', '2026-01-01T03:00:00Z', { decision: 1 }),
    decision('T1-SYNC', 'g-s', 'block', '2026-01-01T04:00:00Z', { decision: 2, baseSync: true }),
    decision('T1-SYNC', 'g-s', 'pass', '2026-01-01T05:00:00Z', { decision: 3, baseSync: true }),
  ],
  'T1-SYNC-PASS': [
    decision('T1-SYNC-PASS', 'g-y', 'block', '2026-01-08T01:00:00Z', { decision: 1 }),
    decision('T1-SYNC-PASS', 'g-y', 'pass', '2026-01-08T02:00:00Z', { decision: 2, baseSync: true }),
  ],
  'T1-RUNS': [
    decision('T1-RUNS', 'g-b', 'block', '2026-01-02T00:00:00Z', { decision: 1, mergeBlocking: null }),
    decision('T1-RUNS', 'g-b', 'block', '2026-01-02T01:00:00Z', { decision: 2, stopReview: true }),
    decision('T1-RUNS', 'g-a', 'pass', '2026-01-03T00:00:00Z', { decision: 1 }),
  ],
  'T1-RETRY': [
    decision('T1-RETRY', 'g-r', 'block', '2026-01-03T23:00:00Z', { stage: 'pre', reviewer: 'deepseek', mergeBlocking: null, round: 1, cycle: 0 }),
    decision('T1-RETRY', 'g-r', 'quota-hold', '2026-01-04T00:00:00Z', { decision: 1, mergeBlocking: null }),
    decision('T1-RETRY', 'g-r', 'no-verdict', '2026-01-04T01:00:00Z', { decision: 1, mergeBlocking: null }),
    decision('T1-RETRY', 'g-r', 'pass', '2026-01-04T02:00:00Z', { decision: 1 }),
  ],
  'T1-MS': [
    decision('T1-MS', 'g-m', 'block', '2026-01-05T00:00:00Z', { mergeBlocking: null }),
    decision('T1-MS', 'g-m', 'pass', '2026-01-05T00:00:00.5Z', { mergeBlocking: null }),
  ],
  'T1-RULED': [
    decision('T1-RULED', 'g-u', 'block', '2026-01-06T00:00:00Z', { decision: 1 }),
    decision('T1-RULED', 'g-u', 'block', '2026-01-06T01:00:00Z', { decision: 2 }),
    decision('T1-RULED', 'g-u', 'block', '2026-01-06T02:00:00Z', { decision: 3, stopReview: true }),
    decision('T1-RULED', 'g-u', 'pass', '2026-01-06T03:00:00Z', { reviewer: 'ruling:owner', mergeBlocking: null }),
  ],
  'T1-ADVISORY': [
    decision('T1-ADVISORY', 'g-v', 'block', '2026-01-07T00:00:00Z', { decision: 1, mergeBlocking: false }),
    decision('T1-ADVISORY', 'g-v', 'pass', '2026-01-07T01:00:00Z', { decision: 2 }),
  ],
  'T1-TIE': [
    decision('T1-TIE', 'g-t', 'pass', '2026-01-09T00:00:00Z', { decision: 1 }),
    decision('T1-TIE', 'g-t', 'block', '2026-01-09T00:00:00Z', { decision: 2 }),
  ],
};

/** The rows of summary_review_convergence over `review_decisions` alone, the other tables empty. */
function convergence(rows: Row[]): Row[] {
  const out = realpathSync.native(tmpDir('aidlc-first-decision-'));
  temps.push(out);
  const tables: Tables = { cards: [], card_runs: [], review_decisions: rows, findings: [], state_spans: [], attempts: [], ingest_errors: [] };
  writeTables(tables, out);
  const sql = readFileSync(path.join(root, 'bench', 'outcome', 'views', '10-cards.sql'), 'utf8');
  const r = spawnSync(duckdb!, ['-json', '-bail'], { cwd: out, input: `${sql}\nSELECT * FROM summary_review_convergence;\n`, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout) as Row[];
}

const row = (first: number, twoPlus: number, mean: number | null, stop: number): Row => ({ cards: 1, first_decision_pass_share: first, two_or_more_blocks_share: twoPlus, mean_decisions_to_pass: mean, stop_review_share: stop });

test('T1-OUTCOME-FIRST-DECISION acceptance 1: summary_review_convergence gives each fixture card alone its row by date order [R1] [R2] [R3] [R4]', { skip }, () => {
  const actual = Object.fromEntries(Object.entries(entries).map(([card, rows]) => [card, convergence(rows)]));
  assert.deepEqual(actual, {
    'T1-SECOND': [row(1, 0, 1, 0)],
    'T1-SECOND-ONLY': [row(0, 0, null, 0)],
    'T1-SYNC': [row(1, 0, 1, 0)],
    'T1-SYNC-PASS': [row(0, 0, null, 0)],
    'T1-RUNS': [row(0, 1, 3, 1)],
    'T1-RETRY': [row(1, 0, 1, 0)],
    'T1-MS': [row(0, 0, 2, 0)],
    'T1-RULED': [row(0, 1, 4, 1)],
    'T1-ADVISORY': [row(0, 0, 2, 0)],
    'T1-TIE': [row(1, 0, 1, 0)],
  });
});

test('T1-OUTCOME-FIRST-DECISION acceptance 2: summary_review_convergence over the ten fixture cards together [R3] [R4]', { skip }, () => {
  assert.deepEqual(convergence(Object.values(entries).flat()), [
    { cards: 10, first_decision_pass_share: 0.4, two_or_more_blocks_share: 0.2, mean_decisions_to_pass: 1.875, stop_review_share: 0.2 },
  ]);
});
