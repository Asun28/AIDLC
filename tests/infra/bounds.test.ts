import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addMs, type CardRun, type Goal } from '../../src/core/types.ts';
import { T0, cardRun, goal } from '../core/_fixtures.ts';
// Namespace import: the module is new, so each test fails at its first call rather than at link time.
import * as bounds from '../../src/state/bounds.ts';

const H = 3_600_000;
const at = (ms: number) => addMs(T0, ms);
/** `goal()` admits a one-card goal: its deadline is T0 + 3 h. */
const GOAL_DEADLINE = at(3 * H);

const stop = (reason: string, when = at(H), unresolvedOperations: string[] = []) => ({ reason, detail: 'free text the count never reads', nextAction: 'n', global: false, at: when, unresolvedOperations });
const effort = (over: Record<string, unknown> = {}) => ({ taskId: 'T1-A', role: 'implementer', baseline: 'high', ladder: ['high', 'max'], ...over });
const invocation = (id: string, requestedAt: string, outcome: string) => ({ invocationId: `r3:${id}`, candidateDigest: 'd1', base: 'main', policyVersion: 'REVIEW.md@3', reviewer: 'r3', requestedAt, outcome });
const candidate = { sha: 'sha1', dirty: false, digest: 'd1' };

/** The bounds that fired, by label, with their count; a bound that did not fire is absent. */
function fired(stats: bounds.BoundStats): Record<string, number> {
  return Object.fromEntries(stats.bounds.filter((b) => b.fired > 0).map((b) => [b.bound, b.fired]));
}

function one(goals: Goal[], runs: CardRun[] = []): Record<string, number> {
  return fired(bounds.summarizeBounds(goals, runs));
}

const g1 = (over: Record<string, unknown> = {}) => goal({ id: 'g1', ...over });
const r1 = (over: Record<string, unknown> = {}) => cardRun({ goalId: 'g1', ...over });

describe('Derivation rows: one fixture each, counted once under its bound (acceptance 1)', () => {
  test('Card admission: a run time STOP with a deadline before the goal deadline', () => {
    assert.deepEqual(one([g1()], [r1({ deadline: at(H), stop: stop('time', at(H)) })]), { 'Card admission': 1 });
  });
  test('Arc admission: a goal time STOP at or after the effective goal deadline', () => {
    assert.deepEqual(one([g1({ stop: stop('time', GOAL_DEADLINE), state: 'STOP' })]), { 'Arc admission': 1 });
  });
  test('Reconciliation grace: a time STOP with unresolved operations, on a run and on a goal', () => {
    assert.deepEqual(one([g1()], [r1({ deadline: at(H), stop: stop('time', at(H), ['op-1']) })]), { 'Reconciliation grace': 1 });
    assert.deepEqual(one([g1({ stop: stop('time', GOAL_DEADLINE, ['op-1']), state: 'STOP' })]), { 'Reconciliation grace': 1 });
  });
  test('Substantive review decisions: reached at 2, and a review STOP whose latest R3 decision by requestedAt is a block', () => {
    assert.deepEqual(one([g1()], [r1({ review: { substantiveDecisions: 2 } })]), { 'Substantive review decisions': 1 });
    // The invocations are stored out of order: the latest by requestedAt is the block.
    const review = { substantiveDecisions: 1, invocations: [invocation('b', at(2 * H), 'block'), invocation('a', at(H), 'no-verdict')] };
    assert.deepEqual(one([g1()], [r1({ review, stop: stop('review') })]), { 'Substantive review decisions': 1 });
  });
  test('No-verdict retry: reached at 1, and a review STOP with more than 1 retry used', () => {
    assert.deepEqual(one([g1()], [r1({ review: { noVerdictRetriesUsed: 1 } })]), { 'No-verdict retry': 1 });
    const review = { noVerdictRetriesUsed: 2, invocations: [invocation('a', at(H), 'no-verdict')] };
    assert.deepEqual(one([g1()], [r1({ review, stop: stop('review') })]), { 'No-verdict retry': 1 });
  });
  test('Transient CI rerun: a rerun that is not cancelled, and a ci STOP with a rerun for the candidate', () => {
    const rerun = (outcome: string) => ({ runId: '1', attempt: 1, candidate: 'd1', requestedAt: at(H), outcome });
    assert.deepEqual(one([g1()], [r1({ candidate, ci: { reruns: [rerun('success')] } })]), { 'Transient CI rerun': 1 });
    assert.deepEqual(one([g1()], [r1({ candidate, ci: { reruns: [rerun('failure')] }, stop: stop('ci') })]), { 'Transient CI rerun': 1 });
    assert.deepEqual(one([g1()], [r1({ candidate, ci: { reruns: [rerun('cancelled')] } })]), {}, 'a cancelled rerun alone is not a firing');
  });
  test('Implementation attempts: escalation used, and a card STOP with a terminal effort outcome', () => {
    assert.deepEqual(one([g1()], [r1({ effort: effort({ escalationUsed: true }) })]), { 'Implementation attempts': 1 });
    for (const terminal of ['same-cause-stop', 'exhausted', 'escalation-unavailable', 'escalation-failed']) {
      assert.deepEqual(one([g1()], [r1({ effort: effort({ terminal }), stop: stop('card') })]), { 'Implementation attempts': 1 }, terminal);
    }
    assert.deepEqual(one([g1()], [r1({ stop: stop('card') })]), {}, 'a run without an effort field counts as attempts not fired');
  });
  test('Planning invocations: reached at 2, and a checkpoint STOP at 2 with no planRef', () => {
    assert.deepEqual(one([g1({ counters: { planningInvocations: 2 } })]), { 'Planning invocations': 1 });
    assert.deepEqual(one([g1({ counters: { planningInvocations: 2 }, stop: stop('checkpoint'), state: 'STOP' })]), { 'Planning invocations': 1 });
  });
  test('Integration repair cycles: reached at 1, and an arc-verify STOP', () => {
    assert.deepEqual(one([g1({ counters: { integrationRepairCycles: 1 } })]), { 'Integration repair cycles': 1 });
    assert.deepEqual(one([g1({ stop: stop('arc-verify'), state: 'STOP' })]), { 'Integration repair cycles': 1 });
  });
});

describe('STOPs that are not a bound (acceptance 2)', () => {
  test('a card time STOP copied to the goal counts once', () => {
    // Card deadline first: the run stops at its own deadline, the goal is stopped later with the same reason at the controller's now.
    assert.deepEqual(one([g1({ stop: stop('time', at(H + 60_000)), state: 'STOP' })], [r1({ deadline: at(H), stop: stop('time', at(H)) })]), { 'Card admission': 1 });
    // Goal deadline first: the run's deadline is the goal deadline, so only the arc counts.
    assert.deepEqual(one([g1({ stop: stop('time', GOAL_DEADLINE), state: 'STOP' })], [r1({ deadline: GOAL_DEADLINE, stop: stop('time', GOAL_DEADLINE) })]), { 'Arc admission': 1 });
  });
  test('a ci STOP with no rerun for the candidate, R2 exhaustion, an ownership STOP and a checkpoint STOP with a planRef count under no bound', () => {
    assert.deepEqual(one([g1()], [r1({ candidate, stop: stop('ci') })]), {});
    const r2Exhausted = { rounds: [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'd1', requestedAt: at(H), durationMs: 1000, outcome: 'block', reasons: ['[spec] 1 @ src/a.ts:1: wrong -> fix'] }], handoffs: [] };
    assert.deepEqual(one([g1()], [r1({ preReview: r2Exhausted, stop: stop('review') })]), {});
    assert.deepEqual(one([g1()], [r1({ stop: stop('ownership') })]), {});
    assert.deepEqual(one([g1({ counters: { planningInvocations: 1 }, planRef: 'plans/x.md', stop: stop('checkpoint'), state: 'STOP' })]), {});
  });
});

describe('outcomes (acceptance 3)', () => {
  const firing = () => ({ review: { substantiveDecisions: 2 } });
  const outcomes = (stats: bounds.BoundStats, label: string) => stats.bounds.find((b) => b.bound === label)?.outcomes;

  test('a firing takes its goal current outcome: DONE, STOP/<reason> or open', () => {
    const goals = [goal({ id: 'gd', state: 'DONE' }), goal({ id: 'gs', state: 'STOP', stop: stop('cancelled') }), goal({ id: 'go', state: 'RUN' })];
    const runs = goals.map((g) => cardRun({ goalId: g.id, ...firing() }));
    assert.deepEqual(outcomes(bounds.summarizeBounds(goals, runs), 'Substantive review decisions'), { DONE: 1, STOP: { cancelled: 1 }, open: 1 });
  });
  test('the run of a card removed from goal.cards is counted', () => {
    const stats = bounds.summarizeBounds([g1({ cards: ['T1-B'] })], [r1({ cardId: 'T1-A', ...firing() })]);
    assert.deepEqual(fired(stats), { 'Substantive review decisions': 1 });
  });
  test('a card with runs in two goals counts once per goal with each goal outcome', () => {
    const goals = [goal({ id: 'ga', state: 'DONE' }), goal({ id: 'gb', state: 'STOP', stop: stop('review') })];
    const runs = goals.map((g) => cardRun({ goalId: g.id, cardId: 'T1-A', ...firing() }));
    const stats = bounds.summarizeBounds(goals, runs);
    assert.deepEqual(fired(stats), { 'Substantive review decisions': 2 });
    assert.deepEqual(outcomes(stats, 'Substantive review decisions'), { DONE: 1, STOP: { review: 1 }, open: 0 });
  });
});

describe('the line (acceptance 4)', () => {
  test('keeps the Limits order, prints DONE and open always and one STOP/<reason> per reason in enum order', () => {
    const goals = [goal({ id: 'gd', state: 'DONE', counters: { integrationRepairCycles: 1 } }), goal({ id: 'gs', state: 'STOP', stop: stop('time', GOAL_DEADLINE) })];
    const runs = [cardRun({ goalId: 'gs', review: { noVerdictRetriesUsed: 1 } }), cardRun({ goalId: 'gd', cardId: 'T1-B', deadline: at(H), stop: stop('time', at(H)) })];
    const line = bounds.formatBounds(bounds.summarizeBounds(goals, runs)).split('\n')[0];
    assert.equal(line, 'Bounds: Card admission 1 (DONE 1, open 0); Arc admission 1 (DONE 0, STOP/time 1, open 0); No-verdict retry 1 (DONE 0, STOP/time 1, open 0); Integration repair cycles 1 (DONE 1, open 0)');
  });
  test('the JSON form carries all nine bounds in the Limits order', () => {
    assert.deepEqual(bounds.summarizeBounds([], []).bounds.map((b) => b.bound), ['Card admission', 'Arc admission', 'Reconciliation grace', 'Substantive review decisions', 'No-verdict retry', 'Transient CI rerun', 'Implementation attempts', 'Planning invocations', 'Integration repair cycles']);
  });
  test('prints `Bounds: none fired` and `Extensions: none` when nothing fired and nothing was extended', () => {
    assert.equal(bounds.formatBounds(bounds.summarizeBounds([g1()], [r1()])), 'Bounds: none fired\nExtensions: none');
  });
  test('reports each goal extension count; a time STOP that an extension lifted is not counted', () => {
    const extension = (n: number) => ({ at: at(n * H), by: 'user', newDeadline: at((n + 3) * H), reason: 'more time' });
    // `goal extend` cleared the goal stop and re-admitted the time-stopped run, so neither record holds a STOP.
    const extended = goal({ id: 'g-ext', state: 'RUN', deadlines: { ...g1().deadlines, extensions: [extension(3), extension(4)] } });
    const stats = bounds.summarizeBounds([extended, goal({ id: 'g-none' })], [cardRun({ goalId: 'g-ext', deadline: at(H) })]);
    assert.deepEqual(fired(stats), {});
    assert.deepEqual(stats.extensions, [{ goalId: 'g-ext', count: 2 }, { goalId: 'g-none', count: 0 }]);
    assert.equal(bounds.formatBounds(stats), 'Bounds: none fired\nExtensions: "g-ext" 2');
  });
  test('the arc deadline is the effective one: a goal time STOP before an extended deadline is not the arc bound', () => {
    const ext = { at: at(H), by: 'user', newDeadline: at(6 * H), reason: 'more time' };
    assert.deepEqual(one([g1({ state: 'STOP', stop: stop('time', GOAL_DEADLINE), deadlines: { ...g1().deadlines, extensions: [ext] } })]), {});
  });
  test('a record-sourced id reaches the line as a JSON string with every code point outside U+0020..U+007E escaped', () => {
    const odd = goal({ id: 'g-\u001b[31mé', deadlines: { ...g1().deadlines, extensions: [{ at: at(H), by: 'u', newDeadline: at(6 * H), reason: 'r' }] } });
    assert.equal(bounds.formatBounds(bounds.summarizeBounds([odd], [])).split('\n')[1], 'Extensions: "g-\\u001b[31m\\u00e9" 1');
  });
});
