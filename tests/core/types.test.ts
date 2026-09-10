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
  StopRecord,
  addMs,
  minIso,
  nowIso,
} from '../../src/core/types.ts';
import { T0, card, cardRun, goal, release } from './_fixtures.ts';

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

  test('CardRun prefaults review / ci / closure sub-records', () => {
    const r = cardRun();
    assert.equal(r.review.substantiveDecisions, 0);
    assert.equal(r.review.noVerdictRetriesUsed, 0);
    assert.deepEqual(r.review.invocations, []);
    assert.deepEqual(r.ci.reruns, []);
    assert.equal(r.closure.cleanup, false);
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
