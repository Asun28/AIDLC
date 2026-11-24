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
    // The STOP arm on its own: the only rerun is cancelled, so the reached arm cannot fire.
    assert.deepEqual(one([g1()], [r1({ candidate, ci: { reruns: [rerun('cancelled')] }, stop: stop('ci') })]), { 'Transient CI rerun': 1 }, 'a ci STOP with a cancelled rerun for the candidate fires');
    const other = { ...rerun('cancelled'), candidate: 'd0' };
    assert.deepEqual(one([g1()], [r1({ candidate, ci: { reruns: [other] }, stop: stop('ci') })]), {}, 'a ci STOP whose only rerun is for another candidate does not fire');
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
    assert.equal(bounds.formatBounds(bounds.summarizeBounds([g1()], [r1()])), 'Bounds: none fired\nExtensions: none\nActs: none\nBy: none\nStopped: none');
  });
  test('reports each goal extension count; a time STOP that an extension lifted is not counted', () => {
    const extension = (n: number) => ({ at: at(n * H), by: 'user', newDeadline: at((n + 3) * H), reason: 'more time' });
    // `goal extend` cleared the goal stop and re-admitted the time-stopped run, so neither record holds a STOP.
    const extended = goal({ id: 'g-ext', state: 'RUN', deadlines: { ...g1().deadlines, extensions: [extension(3), extension(4)] } });
    const stats = bounds.summarizeBounds([extended, goal({ id: 'g-none' })], [cardRun({ goalId: 'g-ext', deadline: at(H) })]);
    assert.deepEqual(fired(stats), {});
    assert.deepEqual(stats.extensions, [{ goalId: 'g-ext', count: 2 }, { goalId: 'g-none', count: 0 }]);
    assert.equal(bounds.formatBounds(stats), 'Bounds: none fired\nExtensions: "g-ext" 2\nActs: 2026-09 extensions 2 (0 after the deadline), continuations 0, amendments 0, rulings 0\nBy: "user" extensions 2, continuations 0, amendments 0, rulings 0\nStopped: none');
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

/** The records of the Fixture section of card T0-BOUNDS-OWNER-ACTS; hours are offsets from T0. */
const OCT = '2026-10-01T00:00:00.000Z';
const h = (hours: number) => at(hours * H);
const extension = (when: string, newDeadline: string, by = 'owner') => ({ at: when, by, newDeadline, reason: 'r' });
const extended = (extensions: unknown[], over: Record<string, unknown> = {}) => g1({ deadlines: { ...g1().deadlines, extensions }, ...over });
const continuation = (when: string, stoppedAt: string, by = 'owner') => ({ at: when, by, reason: 'r', stop: { reason: 'review', detail: 'd', at: stoppedAt } });
const amendment = (when: string, by = 'owner') => ({ at: when, by, reason: 'r', revision: 1, changed: ['acceptance'], invalidated: ['dod'] });
const ruling = (when: string, by = 'owner') => ({ at: when, by, decision: 'deferred', reason: 'r' });
const finding = (id: string, ruled?: unknown) => ({ id, stage: 'formal', round: 1, reason: 'x', raisedAt: h(1), disposition: 'open', ...(ruled ? { ruling: ruled } : {}) });

const G1_EXTENSIONS = [extension(h(2), h(6)), extension(h(8), h(12)), extension(h(13), h(20), ''), extension(h(20), h(40))];
const actGoals = (g1Extensions = G1_EXTENSIONS) => [extended(g1Extensions), extended([extension(OCT, '2026-10-02T00:00:00.000Z')], { id: 'g2' })];
const actRun = () => r1({
  continuations: [continuation(h(10), h(4)), continuation(h(11.5), h(11)), continuation(h(12), h(9))],
  amendments: [amendment(h(5))],
  findings: [finding('F1', ruling(h(7))), finding('F2'), finding('F3', ruling('2026-10-03T00:00:00.000Z', 'second'))],
});
const SEPTEMBER = { month: '2026-09', extensions: 4, extensionsAfterDeadline: 2, hoursLateMedian: 1, continuations: 3, hoursFromStopMedian: 3, amendments: 1, rulings: 1 };
const OCTOBER = { month: '2026-10', extensions: 1, extensionsAfterDeadline: 1, hoursLateMedian: 477, continuations: 0, hoursFromStopMedian: null, amendments: 0, rulings: 1 };

describe('recorded owner acts by month and by recorder (card T0-BOUNDS-OWNER-ACTS, acceptance 1)', () => {
  const acts = (goals: Goal[], runs: CardRun[] = []) => bounds.summarizeBounds(goals, runs).acts;
  const late = (extensions: unknown[]) => acts([extended(extensions)]).map((m) => [m.extensions, m.extensionsAfterDeadline, m.hoursLateMedian]);

  test('the fixture gives exactly its acts and actors', () => {
    const stats = bounds.summarizeBounds(actGoals(), [actRun()]);
    assert.deepEqual(stats.acts, [SEPTEMBER, OCTOBER]);
    assert.deepEqual(stats.actors, [
      { by: '', extensions: 1, continuations: 0, amendments: 0, rulings: 0 },
      { by: 'owner', extensions: 4, continuations: 3, amendments: 1, rulings: 1 },
      { by: 'second', extensions: 0, continuations: 0, amendments: 0, rulings: 1 },
    ]);
  });
  test('records with no act give no month and no actor', () => {
    const stats = bounds.summarizeBounds([g1()], [r1({ findings: [finding('F1')] })]);
    assert.deepEqual([stats.acts, stats.actors], [[], []]);
  });
  test('an extension at the deadline in force is not after it, and one a millisecond later is', () => {
    const later = G1_EXTENSIONS.with(3, extension(at(20 * H + 1), h(40)));
    assert.deepEqual(acts(actGoals(later), [actRun()]), [{ ...SEPTEMBER, extensionsAfterDeadline: 3 }, OCTOBER]);
  });
  test('an extension whose by is the empty text has an actor of its own', () => {
    const named = G1_EXTENSIONS.with(2, extension(h(13), h(20)));
    const actors = bounds.summarizeBounds(actGoals(named), [actRun()]).actors;
    assert.deepEqual(actors.map((a) => [a.by, a.extensions]), [['owner', 5], ['second', 0]]);
  });
  test('an even count of after-deadline extensions gives the lower of the two middle values, an odd count the middle one', () => {
    assert.deepEqual(late([extension(h(5), h(6)), extension(h(7), h(8))]), [[2, 2, 1]]);
    assert.deepEqual(late([extension(h(8), h(9)), extension(h(10), h(11)), extension(h(13), h(14))]), [[3, 3, 2]]);
    // 10, 1, 4 and 3 h late: the lower middle value of the numbers is 3, of their texts 1.
    assert.deepEqual(late([extension(h(13), h(14)), extension(h(15), h(16)), extension(h(20), h(21)), extension(h(24), h(25))]), [[4, 4, 3]]);
  });
  test('a median is in hours rounded to one decimal place', () => {
    assert.deepEqual(late([extension(h(4.26), h(9))]), [[1, 1, 1.3]]);
    assert.deepEqual(acts([g1()], [r1({ continuations: [continuation(h(2.24), h(1))] })]).map((m) => m.hoursFromStopMedian), [1.2]);
  });
  test('the deadline in force is the newDeadline of the entry before it in the order of the array', () => {
    // 5 h after +3 h, then before +12 h, then 1 h after +6 h.
    assert.deepEqual(late([extension(h(8), h(12)), extension(h(2), h(6)), extension(h(7), h(7.5))]), [[3, 2, 1]]);
  });
  test('a month with no extension after a deadline has a null hoursLateMedian, and one with no continuation a null hoursFromStopMedian', () => {
    assert.deepEqual(acts([extended([extension(h(2), h(6))])]), [{ month: '2026-09', extensions: 1, extensionsAfterDeadline: 0, hoursLateMedian: null, continuations: 0, hoursFromStopMedian: null, amendments: 0, rulings: 0 }]);
  });
  test('an act at the first instant of a month counts in that month, and one a millisecond earlier in the month before', () => {
    const goals = [extended([extension('2026-09-30T23:59:59.999Z', OCT)]), extended([extension(OCT, OCT)], { id: 'g2' })];
    assert.deepEqual(acts(goals).map((m) => [m.month, m.extensions]), [['2026-09', 1], ['2026-10', 1]]);
  });
  test('each kind of act opens its own month, earliest month first', () => {
    const run = r1({
      continuations: [continuation('2026-12-01T00:00:00.000Z', h(1))],
      amendments: [amendment('2027-01-01T00:00:00.000Z')],
      findings: [finding('F1', ruling('2026-11-01T00:00:00.000Z'))],
    });
    const months = acts([extended([extension(OCT, OCT)])], [run]).map((m) => [m.month, m.extensions, m.continuations, m.amendments, m.rulings]);
    assert.deepEqual(months, [['2026-10', 1, 0, 0, 0], ['2026-11', 0, 0, 0, 1], ['2026-12', 0, 1, 0, 0], ['2027-01', 0, 0, 1, 0]]);
  });
  test('actors are ordered by code unit, and each kind of act counts under its own by', () => {
    const run = r1({ continuations: [continuation(h(2), h(1), 'b')], amendments: [amendment(h(3), 'B')], findings: [finding('F1', ruling(h(4), 'é'))] });
    const actors = bounds.summarizeBounds([extended([extension(h(1), h(6), 'a')])], [run]).actors;
    assert.deepEqual(actors.map((a) => [a.by, a.extensions, a.continuations, a.amendments, a.rulings]), [['B', 0, 0, 1, 0], ['a', 1, 0, 0, 0], ['b', 0, 1, 0, 0], ['é', 0, 0, 0, 1]]);
  });
});

const stoppedRun = (goalId: string, reason: string, when: string, cardId: string) => cardRun({ goalId, cardId, state: 'STOP', stop: stop(reason, when) });
const STOPPED_GOALS = () => [g1({ state: 'STOP', stop: stop('review') }), goal({ id: 'g3', state: 'DONE' }), goal({ id: 'g4', state: 'STOP', stop: stop('cancelled') })];
const STOPPED_RUNS = () => [
  stoppedRun('g1', 'review', h(1), 'T1-A'),
  stoppedRun('g1', 'time', '2026-10-02T00:00:00.000Z', 'T1-B'),
  stoppedRun('g3', 'review', h(1), 'T1-C'),
  stoppedRun('g4', 'review', h(1), 'T1-D'),
];

describe('card runs left in STOP by month (card T0-BOUNDS-OWNER-ACTS, acceptance 2)', () => {
  const stopped = (goals: Goal[], runs: CardRun[]) => bounds.summarizeBounds(goals, runs).stopped;

  test('the four runs give the two entries; the runs of the DONE goal and of the cancelled goal are in neither', () => {
    assert.deepEqual(stopped(STOPPED_GOALS(), STOPPED_RUNS()), [{ month: '2026-09', reasons: { review: 1 } }, { month: '2026-10', reasons: { time: 1 } }]);
  });
  test('a run in STOP whose goal is not among the goals given is counted', () => {
    assert.deepEqual(stopped([], [STOPPED_RUNS()[2]!]), [{ month: '2026-09', reasons: { review: 1 } }]);
  });
  test('a run that is not in STOP, or is in STOP with no stop, is not counted', () => {
    assert.deepEqual(stopped([g1()], [r1({ state: 'BUILD', stop: stop('review') }), r1({ cardId: 'T1-B', state: 'STOP' })]), []);
  });
  test('the reasons of a month come in StopReason order whatever order the runs come in, and the months earliest first', () => {
    const runs = [stoppedRun('g1', 'time', OCT, 'T1-A'), stoppedRun('g1', 'time', h(1), 'T1-B'), stoppedRun('g1', 'card', h(2), 'T1-C'), stoppedRun('g1', 'time', h(3), 'T1-D')];
    assert.deepEqual(stopped([g1()], runs).map((m) => [m.month, Object.entries(m.reasons)]), [['2026-09', [['card', 1], ['time', 2]]], ['2026-10', [['time', 1]]]]);
  });
});

describe('the three lines of the owner acts (card T0-BOUNDS-OWNER-ACTS, acceptance 3)', () => {
  const lines = (goals: Goal[], runs: CardRun[]) => bounds.formatBounds(bounds.summarizeBounds(goals, runs)).split('\n');

  test('the fixture prints its Acts and By lines after the first two lines', () => {
    assert.deepEqual(lines(actGoals(), [actRun()]), [
      'Bounds: none fired',
      'Extensions: "g1" 4; "g2" 1',
      'Acts: 2026-09 extensions 4 (2 after the deadline, median 1.0 h late), continuations 3 (median 3.0 h after the stop), amendments 1, rulings 1; 2026-10 extensions 1 (1 after the deadline, median 477.0 h late), continuations 0, amendments 0, rulings 1',
      'By: "" extensions 1, continuations 0, amendments 0, rulings 0; "owner" extensions 4, continuations 3, amendments 1, rulings 1; "second" extensions 0, continuations 0, amendments 0, rulings 1',
      'Stopped: none',
    ]);
  });
  test('the stopped runs print their line, and a month with two reasons prints both', () => {
    assert.equal(lines(STOPPED_GOALS(), STOPPED_RUNS())[4], 'Stopped: 2026-09 review 1; 2026-10 time 1');
    assert.equal(lines([g1()], [stoppedRun('g1', 'time', h(1), 'T1-A'), stoppedRun('g1', 'card', h(2), 'T1-B')])[4], 'Stopped: 2026-09 card 1, time 1');
  });
  test('records with no act and no stopped run print none on each line', () => {
    assert.deepEqual(lines([], []), ['Bounds: none fired', 'Extensions: none', 'Acts: none', 'By: none', 'Stopped: none']);
  });
  test('a month with no extension and no continuation prints no bracket', () => {
    assert.equal(lines([], [r1({ amendments: [amendment(h(1))] })])[2], 'Acts: 2026-09 extensions 0, continuations 0, amendments 1, rulings 0');
  });
  test('a by text reaches the line as a JSON string with every code point outside U+0020..U+007E escaped', () => {
    assert.equal(lines([], [r1({ amendments: [amendment(h(1), 'o-\u001b[31mé')] })])[3], 'By: "o-\\u001b[31m\\u00e9" extensions 0, continuations 0, amendments 1, rulings 0');
  });
});
