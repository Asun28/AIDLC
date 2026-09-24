import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARC_LIMIT_MS,
  CARD_LIMIT_MS,
  Card,
  EffortLevel,
  CardId,
  CardRun,
  CiLedger,
  Goal,
  IsoTimestamp,
  RECONCILE_GRACE_MS,
  PreReviewRound,
  ReleaseAttempt,
  ReviewEffortLevel,
  ReviewInvocation,
  ReviewLedger,
  RoundCoverage,
  RoutingResult,
  StopRecord,
  Verdict,
  addMs,
  minIso,
  nowIso,
} from '../../src/core/types.ts';
import { T0, card, cardRun, goal, release, routing } from './_fixtures.ts';

describe('types: primitives', () => {
  test('IsoTimestamp accepts toISOString output and rejects offsets / prose', () => {
    assert.equal(IsoTimestamp.safeParse(T0).success, true);
    assert.equal(IsoTimestamp.safeParse(nowIso()).success, true);
    assert.equal(IsoTimestamp.safeParse('2026-09-11T00:00:00+02:00').success, false);
    assert.equal(IsoTimestamp.safeParse('yesterday').success, false);
  });

  test('CardId enforces the scaffold regex (case-sensitive)', () => {
    for (const ok of ['T0-SCAFFOLD', 'T2-API', 'T3-REVIEW-GATE', 'T311-AIDLC-LOOP']) assert.equal(CardId.safeParse(ok).success, true, ok);
    for (const bad of ['t1-foo', 'T1_FOO', 'my-task', 'T1-', 'T1-foo', 'T?-EXAMPLE']) assert.equal(CardId.safeParse(bad).success, false, bad);
  });

  test('addMs / minIso are pure on ISO strings', () => {
    assert.equal(addMs(T0, 60_000), '2026-09-11T00:01:00.000Z');
    assert.equal(minIso(T0, addMs(T0, 1)), T0);
    assert.equal(minIso(addMs(T0, 1), T0), T0);
  });

  test('limits are the plan v5 values', () => {
    assert.equal(CARD_LIMIT_MS, 3 * 3600 * 1000);
    assert.equal(ARC_LIMIT_MS, 12 * 3600 * 1000);
    assert.equal(RECONCILE_GRACE_MS, 5 * 60 * 1000);
  });
});

describe('types: schema round-trips', () => {
  test('Card applies defaults and round-trips', () => {
    const c = card('T1-A');
    assert.equal(c.dod_exit, 0);
    assert.deepEqual(c.depends_on, []);
    assert.deepEqual(c.acceptance, []);
    assert.equal(c.tdd, true);
    assert.equal(c.freeze, false);
    assert.deepEqual(c.resources, []);
    assert.deepEqual(Card.parse(JSON.parse(JSON.stringify(c))), c);
  });

  test('Card refuses empty allow_paths and bad status', () => {
    assert.equal(Card.safeParse({ ...card('T1-A'), allow_paths: [] }).success, false);
    assert.equal(Card.safeParse({ ...card('T1-A'), status: 'done' }).success, false);
  });

  test('R1/R2: RoutingResult defaults skills and Goal carries an optional intentRef', () => {
    const { skills, ...withoutSkills } = routing();
    assert.deepEqual(skills, ['tdd']);
    assert.deepEqual(RoutingResult.parse(withoutSkills).skills, [], 'a routing result persisted before skills existed parses with an empty list');
    assert.deepEqual(RoutingResult.parse(routing({ skills: ['grilling', 'tdd'] })).skills, ['grilling', 'tdd']);
    assert.equal(goal().intentRef, undefined);
    assert.equal(Goal.parse({ ...goal(), intentRef: 'intent/claims.md' }).intentRef, 'intent/claims.md');
  });

  test('CardRun prefaults review / ci / closure sub-records', () => {
    const r = cardRun();
    assert.equal(r.review.substantiveDecisions, 0);
    assert.equal(r.review.noVerdictRetriesUsed, 0);
    assert.deepEqual(r.review.invocations, []);
    assert.deepEqual(r.ci.reruns, []);
    assert.equal(r.closure.cleanup, false);
    assert.equal(r.closure.lessons, false, 'the lesson disposition is the sixth closure predicate');
    const five = { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true };
    assert.equal(CardRun.parse({ ...r, state: 'DONE', mergeVerified: true, closure: five }).closure.lessons, false, 'the schema default stays false for every record; a DONE record stays DONE through the state evidence, not the parser');
    assert.equal(CardRun.parse({ ...r, state: 'CLOSE', mergeVerified: true, closure: five }).closure.lessons, false, 'any other run has an open lesson step');
    assert.equal(r.pendingRepair, undefined);
    assert.equal(CardRun.parse({ ...r, pendingRepair: { kind: 'merge-conflict', detail: 'CONFLICT in src/a.ts', at: T0 } }).pendingRepair?.kind, 'merge-conflict');
    assert.equal(r.mergeVerified, false);
    assert.equal(r.mode, 'remote');
    assert.deepEqual(CardRun.parse(JSON.parse(JSON.stringify(r))), r);
    // T1-REVIEW-FINDINGS acceptance 6: a run persisted before findings existed parses with an empty list.
    const { findings: _dropped, ...withoutFindings } = r as typeof r & { findings?: unknown };
    assert.deepEqual(CardRun.parse(withoutFindings).findings, []);
    // T1-REVIEW-FINDINGS-3 acceptance 10: a run persisted before the revision existed parses at revision 0.
    const { revision: _rev, ...withoutRevision } = r as typeof r & { revision?: unknown };
    assert.equal(CardRun.parse(withoutRevision).revision, 0);
    const finding = { id: 'F1', stage: 'pre', round: 1, reason: '[spec] 6 tests @ src/a.ts:1: no RED -> add one', raisedAt: T0 };
    const parsed = CardRun.parse({ ...r, findings: [finding] }).findings[0]!;
    assert.deepEqual({ disposition: parsed.disposition, disputes: parsed.disputes, reraised: parsed.reraised }, { disposition: 'open', disputes: [], reraised: [] }, 'finding sub-records default');
  });

  test('T1-REVIEW-COVERAGE acceptance 3: Verdict carries an optional bounded coverage list and parses documents written without one', () => {
    const base = { verdict: 'pass' as const, reasons: [] };
    assert.equal(Verdict.parse(base).coverage, undefined, 'a verdict document without the list parses unchanged');
    const withCoverage = Verdict.parse({ ...base, coverage: [{ item: 1, status: 'supported', impl: 'src/a.ts:10', test: 'tests/a.test.ts:4' }, { item: 2, status: 'unknown' }] });
    assert.deepEqual(withCoverage.coverage, [{ item: 1, status: 'supported', impl: 'src/a.ts:10', test: 'tests/a.test.ts:4' }, { item: 2, status: 'unknown' }], 'the locations are optional, the item and the status are not');
    assert.equal(Verdict.safeParse({ ...base, coverage: [{ item: 0, status: 'supported' }] }).success, false, 'the item is a positive integer');
    assert.equal(Verdict.safeParse({ ...base, coverage: [{ item: 1.5, status: 'supported' }] }).success, false, 'the item is an integer');
    assert.equal(Verdict.safeParse({ ...base, coverage: [{ item: 1, status: 'partial' }] }).success, false, 'the status is one of the three');
    assert.equal(Verdict.safeParse({ ...base, coverage: [{ item: 1, status: 'violated', impl: 3 }] }).success, false, 'a location is a string');
  });

  test('T1-REVIEW-COVERAGE acceptance 5: a pre-review round carries the optional round coverage and rounds written before it parse unchanged', () => {
    const round = { round: 1, cycle: 0, reviewer: 'fake', candidateDigest: 'sha-1', requestedAt: T0, outcome: 'pass' as const };
    assert.equal(PreReviewRound.parse(round).coverage, undefined, 'a round persisted before this change carries no coverage');
    const coverage = { expected: 4, accounted: 3, unaccounted: [4], conflicted: [2], inconsistent: [3], malformed: 1, angles: ['ac-coverage'] };
    assert.deepEqual(PreReviewRound.parse({ ...round, coverage }).coverage, coverage);
    assert.deepEqual(RoundCoverage.parse({ expected: 2 }), { expected: 2, accounted: 0, unaccounted: [], conflicted: [], inconsistent: [], malformed: 0, angles: [] }, 'the lists and the counters default to empty');
    assert.equal(RoundCoverage.safeParse({ expected: 1, accounted: -1 }).success, false, 'the counters are non-negative');
  });

  test('ReviewLedger / CiLedger parse from empty objects', () => {
    const l = ReviewLedger.parse({});
    assert.equal(l.substantiveBlocks, 0);
    assert.equal(l.scriptCounter, 0);
    assert.deepEqual(CiLedger.parse({}).reruns, []);
  });

  test('Goal prefaults counters and defaults the runtime fields', () => {
    const g = goal();
    assert.equal(g.counters.planningInvocations, 0);
    assert.equal(g.counters.integrationRepairCycles, 0);
    assert.equal(g.maxWorkers, 2);
    assert.equal(g.reviewPool, 'default');
    assert.equal(g.terminal, false);
    assert.deepEqual(g.cards, []);
    assert.deepEqual(g.revisions[0]?.supersededCards, {});
    assert.deepEqual(g.revisions[0]?.removedCards, []);
    assert.deepEqual(Goal.parse(JSON.parse(JSON.stringify(g))), g);
  });

  test('Goal refuses a maxWorkers above the cap of two and an empty revision list', () => {
    assert.equal(Goal.safeParse({ ...goal(), maxWorkers: 3 }).success, false);
    assert.equal(Goal.safeParse({ ...goal(), revisions: [] }).success, false);
  });

  test('Goal stages must name every delivery target (not_requested is explicit)', () => {
    const g = goal();
    assert.equal(g.stages.production, 'not_requested');
    assert.equal(g.stages.development, 'pending');
    const partial = { ...g, stages: { development: 'pending' } };
    assert.equal(Goal.safeParse(partial).success, false, 'a missing stage key must not parse as silently absent');
  });

  test('ReleaseAttempt defaults disposition pending and empty steps', () => {
    const r = release();
    assert.equal(r.disposition, 'pending');
    assert.deepEqual(r.steps, []);
    assert.deepEqual(ReleaseAttempt.parse(JSON.parse(JSON.stringify(r))), r);
  });

  test('StopRecord defaults unresolvedOperations', () => {
    const s = StopRecord.parse({ reason: 'time', detail: 'x', nextAction: 'y', global: true, at: T0 });
    assert.deepEqual(s.unresolvedOperations, []);
    assert.equal(StopRecord.safeParse({ reason: 'bogus', detail: 'x', nextAction: 'y', global: true, at: T0 }).success, false);
  });
});

describe('types: ReviewInvocation effort (T1-OPUS55-R3 acceptance 4)', () => {
  const record = { invocationId: 'r3:T1-X.r3.1.abcd1234', candidateDigest: 'digest-1', base: 'main', policyVersion: 'REVIEW.md@3', reviewer: 'claude-opus-5-5', requestedAt: T0, outcome: 'pass' };

  test('a record with effort parses and keeps the level [R3]', () => {
    assert.equal(ReviewInvocation.parse({ ...record, effort: 'high' }).effort, 'high');
  });

  test('a record written before the field parses unchanged, with no effort [R3]', () => {
    assert.deepEqual(ReviewInvocation.parse(record), record);
  });
});

describe('types: ReviewEffortLevel (T1-OPUS55-R3-2 acceptance 10)', () => {
  test('the R3 levels are the effort levels without low [R1]', () => {
    assert.deepEqual(ReviewEffortLevel.options, EffortLevel.options.filter((l) => l !== 'low'));
    assert.equal(ReviewEffortLevel.safeParse('low').success, false);
  });
});
