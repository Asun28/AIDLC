import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARC_LIMIT_MS,
  CARD_LIMIT_MS,
  Card,
  CardId,
  CardRun,
  CiLedger,
  Goal,
  IsoTimestamp,
  RECONCILE_GRACE_MS,
  ReleaseAttempt,
  ReviewLedger,
  RoutingResult,
  StopRecord,
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
    assert.equal(CardRun.parse({ ...r, state: 'DONE', mergeVerified: true, closure: five }).closure.lessons, true, 'a run persisted as DONE before the predicate existed stays complete');
    assert.equal(CardRun.parse({ ...r, state: 'CLOSE', mergeVerified: true, closure: five }).closure.lessons, false, 'any other run has an open lesson step');
    assert.equal(CardRun.parse({ ...r, state: 'DONE', mergeVerified: false, closure: five }).closure.lessons, false, 'a DONE record without a verified merge is no legacy closure');
    assert.equal(r.pendingRepair, undefined);
    assert.equal(CardRun.parse({ ...r, pendingRepair: { kind: 'merge-conflict', detail: 'CONFLICT in src/a.ts', at: T0 } }).pendingRepair?.kind, 'merge-conflict');
    assert.equal(r.mergeVerified, false);
    assert.equal(r.mode, 'remote');
    assert.deepEqual(CardRun.parse(JSON.parse(JSON.stringify(r))), r);
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
