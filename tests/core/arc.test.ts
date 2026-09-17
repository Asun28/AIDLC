import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenIntegrationRepair, resourcesDisjoint, selectArc, topologicalOrder } from '../../src/core/arc.ts';
import { card } from './_fixtures.ts';

describe('arc selection (Q9 / Q10)', () => {
  test('topological order respects depends_on and reports cycles', () => {
    const cards = [card('T1-C', { depends_on: ['T1-B'] }), card('T1-B', { depends_on: ['T1-A'] }), card('T1-A')];
    assert.deepEqual(topologicalOrder(cards).order, ['T1-A', 'T1-B', 'T1-C']);
    const cyc = topologicalOrder([card('T1-A', { depends_on: ['T1-B'] }), card('T1-B', { depends_on: ['T1-A'] })]);
    assert.ok(cyc.cycle);
    assert.equal(cyc.cycle![0], cyc.cycle![cyc.cycle!.length - 1]);
  });

  test('a dependency cycle is STOP, never dispatch', () => {
    const s = selectArc({ cards: [card('T1-A', { depends_on: ['T1-B'] }), card('T1-B', { depends_on: ['T1-A'] })], outcomes: {} });
    assert.equal(s.verdict, 'stop');
    assert.match(s.reasons[0] ?? '', /dependency cycle/);
  });

  test('ready set follows dependencies; dependents wait on open prerequisites', () => {
    const s = selectArc({ cards: [card('T1-A'), card('T1-B', { depends_on: ['T1-A'] }), card('T1-C', { depends_on: ['T1-B'] })], outcomes: {} });
    assert.deepEqual(s.ready, ['T1-A']);
    assert.deepEqual(s.wave, ['T1-A']);
    assert.deepEqual(s.waitingOn, ['T1-B', 'T1-C']);
    assert.equal(s.verdict, 'dispatch');
  });

  test('a depends_on id outside the projection is satisfied only by a closed outcome, and never joins the wave', () => {
    const projection = [card('T1-STATS', { depends_on: ['T1-MERGED-ELSEWHERE'] })];
    const gap = selectArc({ cards: projection, outcomes: {} });
    assert.deepEqual(gap.waitingOn, ['T1-STATS'], 'an id the caller vouches for nowhere is an open gap');
    assert.equal(gap.verdict, 'stop');
    const vouched = selectArc({ cards: projection, outcomes: { 'T1-MERGED-ELSEWHERE': 'closed' } });
    assert.deepEqual(vouched.ready, ['T1-STATS']);
    assert.deepEqual(vouched.wave, ['T1-STATS']);
    assert.equal(vouched.verdict, 'dispatch');
    for (const [set, ids] of Object.entries({ ready: vouched.ready, wave: vouched.wave, waitingOn: vouched.waitingOn, blockedByStop: vouched.blockedByStop })) {
      assert.ok(!ids.includes('T1-MERGED-ELSEWHERE'), `a prerequisite outside the projection is never scheduled or reported: ${set}`);
    }
  });

  test('Q9: a freeze card runs alone before its dependents', () => {
    const s = selectArc({ cards: [card('T1-IFACE', { freeze: true }), card('T1-B'), card('T1-C')], outcomes: {} });
    assert.deepEqual(s.wave, ['T1-IFACE']);
    assert.ok(s.reasons.some((r) => /freeze card T1-IFACE runs alone/.test(r)));
    const busy = selectArc({ cards: [card('T1-IFACE', { freeze: true }), card('T1-B')], outcomes: { 'T1-B': 'running' } });
    assert.deepEqual(busy.wave, []);
    assert.equal(busy.verdict, 'wait');
  });

  test('Q9: cap of two workers only with disjoint resources', () => {
    const s = selectArc({ cards: [card('T1-A'), card('T1-B'), card('T1-C')], outcomes: {} });
    assert.equal(s.workers, 2);
    assert.deepEqual(s.wave, ['T1-A', 'T1-B']);
    const capped = selectArc({ cards: [card('T1-A'), card('T1-B')], outcomes: {}, maxWorkers: 5 });
    assert.equal(capped.workers, 2, 'the cap is never raised above two');
  });

  test('Q9: shared ports/databases serialise even with disjoint allow_paths', () => {
    const s = selectArc({ cards: [card('T1-A', { resources: ['db:main'] }), card('T1-B', { resources: ['DB:MAIN'] })], outcomes: {} });
    assert.deepEqual(s.wave, ['T1-A']);
    assert.ok(s.reasons.some((r) => /T1-B serialised: shares resources with T1-A/.test(r)));
    assert.equal(resourcesDisjoint(card('T1-A', { resources: ['port:8080'] }), card('T1-B', { resources: ['port:8080'] })), false);
    assert.equal(resourcesDisjoint(card('T1-A'), card('T1-B')), true);
  });

  test('overlapping allow_paths (including wildcards) are not isolated', () => {
    assert.equal(resourcesDisjoint(card('T1-A', { allow_paths: ['src/api/'] }), card('T1-B', { allow_paths: ['src/api/users.ts'] })), false);
    assert.equal(resourcesDisjoint(card('T1-A', { allow_paths: ['src/**'] }), card('T1-B', { allow_paths: ['docs/'] })), false);
    assert.equal(resourcesDisjoint(card('T1-A', { allow_paths: ['src\\a\\'] }), card('T1-B', { allow_paths: ['src/a/x.ts'] })), false);
  });

  test('parallelizable_with declarations restrict pairing', () => {
    const a = card('T1-A', { parallelizable_with: ['T1-C'] });
    const b = card('T1-B', { parallelizable_with: ['T1-C'] });
    assert.equal(resourcesDisjoint(a, b), false);
    assert.equal(resourcesDisjoint(a, card('T1-C', { parallelizable_with: ['T1-A'] })), true);
  });

  test('Q9: a single reviewer slot or unverified ownership lowers concurrency to one', () => {
    const slot = selectArc({ cards: [card('T1-A'), card('T1-B')], outcomes: {}, singleReviewerSlot: true });
    assert.equal(slot.workers, 1);
    assert.deepEqual(slot.wave, ['T1-A']);
    const own = selectArc({ cards: [card('T1-A'), card('T1-B')], outcomes: {}, ownershipControlsVerified: false });
    assert.equal(own.workers, 1);
    assert.ok(own.reasons.some((r) => /ownership\/locking not verified/.test(r)));
  });

  test('Q9: running work occupies slots; the lead is not an uncounted third writer', () => {
    const s = selectArc({ cards: [card('T1-A'), card('T1-B'), card('T1-C')], outcomes: { 'T1-A': 'running' } });
    assert.deepEqual(s.wave, ['T1-B']);
    const full = selectArc({ cards: [card('T1-A'), card('T1-B'), card('T1-C')], outcomes: { 'T1-A': 'running', 'T1-B': 'waiting' } });
    assert.deepEqual(full.wave, []);
    assert.equal(full.verdict, 'wait');
  });

  test('Q9: a child STOP blocks its dependents; safe independent work continues', () => {
    const s = selectArc({ cards: [card('T1-A'), card('T1-B', { depends_on: ['T1-A'] }), card('T1-C')], outcomes: { 'T1-A': 'stopped' } });
    assert.deepEqual(s.blockedByStop, ['T1-B']);
    assert.deepEqual(s.wave, ['T1-C']);
    assert.equal(s.verdict, 'dispatch');
  });

  test('Q9/Q10: an empty ready set with required gaps is STOP or WAIT, never DONE', () => {
    const stopped = selectArc({ cards: [card('T1-A'), card('T1-B', { depends_on: ['T1-A'] })], outcomes: { 'T1-A': 'stopped' } });
    assert.equal(stopped.verdict, 'stop');
    assert.match(stopped.reasons.at(-1) ?? '', /blocked by stopped dependencies/);
    const waiting = selectArc({ cards: [card('T1-A'), card('T1-B', { depends_on: ['T1-A'] })], outcomes: { 'T1-A': 'running' } });
    assert.equal(waiting.verdict, 'wait');
  });

  test('all cards closed is done, but only as a child result the parent still verifies', () => {
    const s = selectArc({ cards: [card('T1-A', { status: 'merged' }), card('T1-B')], outcomes: { 'T1-B': 'closed' } });
    assert.equal(s.verdict, 'done');
    assert.match(s.reasons[0] ?? '', /parent still verifies/);
  });

  test('Q20: a contraction migration card is deferred behind compatibility steps', () => {
    const s = selectArc({ cards: [card('T1-DROP', { migration_phase: 'contract' }), card('T1-EXPAND', { migration_phase: 'expand' })], outcomes: {} });
    assert.deepEqual(s.wave, ['T1-EXPAND']);
    assert.ok(s.reasons.some((r) => /contraction card T1-DROP deferred/.test(r)));
  });

  test('Q10: exactly one integration repair cycle per arc', () => {
    assert.equal(canOpenIntegrationRepair(0).allowed, true);
    assert.equal(canOpenIntegrationRepair(1).allowed, false);
    assert.match(canOpenIntegrationRepair(1).detail, /STOP\/arc-verify/);
  });
});
