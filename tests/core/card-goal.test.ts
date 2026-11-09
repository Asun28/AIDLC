import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveCardGoal, terminalGoalRefusal, type CardGoalCandidate } from '../../src/core/card-goal.ts';

/** A goal record as the resolver reads it; lists are newest first, as the goal store returns them. */
const goal = (id: string, cards: string[], terminal = false): CardGoalCandidate => ({ id, cards, terminal });

function refused(r: ReturnType<typeof resolveCardGoal>): string {
  assert.equal(r.ok, false, `expected a refusal, got ${JSON.stringify(r)}`);
  return r.ok ? '' : r.error;
}

describe('resolveCardGoal (T0-CARD-GOAL-RESOLVE)', () => {
  test('the older active goal that projects the card is chosen over a newer active goal that does not (issue #72) [R1]', () => {
    assert.deepEqual(resolveCardGoal([goal('g-new', ['T0-OTHER']), goal('g-old', ['T0-X'])], 'T0-X'), { ok: true, goalId: 'g-old' });
  });

  test('with no active goal projecting the card, the one terminal goal that does is chosen; an active projecting goal wins over a terminal one [R1]', () => {
    assert.deepEqual(resolveCardGoal([goal('g-active', ['T0-OTHER']), goal('g-done', ['T0-X'], true)], 'T0-X'), { ok: true, goalId: 'g-done' });
    assert.deepEqual(resolveCardGoal([goal('g-done', ['T0-X'], true), goal('g-live', ['T0-X'])], 'T0-X'), { ok: true, goalId: 'g-live' });
  });

  test('two active goals projecting the card are refused naming both and --goal, and so are two terminal ones with no active one [R2]', () => {
    const cases = [
      { goals: [goal('g-2', ['T0-X']), goal('g-1', ['T0-X'])], says: 'is projected by 2 active goals (g-2, g-1)' },
      { goals: [goal('g-2', ['T0-X'], true), goal('g-1', ['T0-X'], true), goal('g-0', ['T0-OTHER'])], says: 'is projected by no active goal and by 2 terminal goals (g-2, g-1)' },
    ];
    for (const { goals, says } of cases) {
      const error = refused(resolveCardGoal(goals, 'T0-X'));
      for (const part of ['card T0-X', says, '--goal <id>']) assert.ok(error.includes(part), `${error} names ${part}`);
      assert.ok(!error.includes('g-0'), `${error} names only the goals that project the card`);
    }
  });

  test('a card no goal projects is refused naming it and aidlc goal new --card, with goals and without any [R2]', () => {
    for (const goals of [[goal('g-a', ['T0-A'])], []]) {
      const error = refused(resolveCardGoal(goals, 'T0-X'));
      assert.ok(error.includes('no goal projects card T0-X'), error);
      assert.ok(error.includes('aidlc goal new --card T0-X'), error);
    }
  });

  test('an explicit goal that projects the card is used, and one that does not but holds its run is used [R3]', () => {
    const goals = [goal('g-b', ['T0-Y']), goal('g-a', ['T0-X'])];
    assert.deepEqual(resolveCardGoal(goals, 'T0-X', { explicit: 'g-a', holdsRun: () => false }), { ok: true, goalId: 'g-a' });
    const asked: string[] = [];
    assert.deepEqual(resolveCardGoal(goals, 'T0-X', { explicit: 'g-b', holdsRun: (id) => (asked.push(id), id === 'g-b') }), { ok: true, goalId: 'g-b' });
    assert.deepEqual(asked, ['g-b'], 'the run is looked up in the named goal');
  });

  test('an explicit goal that neither projects the card nor holds its run is refused naming it and the projecting goals; an unknown goal is refused [R3]', () => {
    const goals = [goal('g-b', ['T0-Y']), goal('g-a', ['T0-X'])];
    const error = refused(resolveCardGoal(goals, 'T0-X', { explicit: 'g-b', holdsRun: () => false }));
    for (const part of ['g-b', 'T0-X', 'g-a']) assert.ok(error.includes(part), `${error} names ${part}`);
    const none = refused(resolveCardGoal([goal('g-b', ['T0-Y'])], 'T0-X', { explicit: 'g-b', holdsRun: () => false }));
    assert.ok(none.includes('no goal projects it'), none);
    const unknown = refused(resolveCardGoal(goals, 'T0-X', { explicit: 'g-zzz', holdsRun: () => false }));
    assert.ok(unknown.includes('goal g-zzz not found'), unknown);
    // A --goal given empty is a goal named, not an absent option: it is refused, never resolved from the projection.
    const empty = refused(resolveCardGoal(goals, 'T0-X', { explicit: '', holdsRun: () => false }));
    assert.ok(empty.includes('not found'), empty);
  });
});

describe('terminalGoalRefusal (T0-CARD-TERMINAL-GOAL)', () => {
  const EXTEND = 'aidlc goal extend g-1 --until <iso> --by <who> --reason "..."';
  const RESUME = 'aidlc goal resume g-1 --reason "..."';
  const names = (text: string | undefined, parts: string[], absent: string) => {
    assert.ok(text !== undefined, 'expected a refusal');
    for (const part of parts) assert.ok(text.includes(part), `${text} names ${part}`);
    assert.ok(!text.includes(absent), `${text} names one re-admitting command, not ${absent}`);
  };

  test('a goal in RUN, WAIT or CLOSE is not refused [R3]', () => {
    for (const state of ['RUN', 'WAIT', 'CLOSE']) assert.equal(terminalGoalRefusal({ id: 'g-1', state, terminal: false }), undefined, state);
  });

  test('a goal stopped for time names the goal, STOP, time and aidlc goal extend [R2]', () => {
    names(terminalGoalRefusal({ id: 'g-1', state: 'STOP', terminal: true, stop: { reason: 'time' } }), ['g-1', 'STOP', 'time', EXTEND], 'goal resume');
  });

  test('a goal stopped for ownership or cancelled names the reason and aidlc goal resume [R2]', () => {
    for (const reason of ['ownership', 'cancelled']) names(terminalGoalRefusal({ id: 'g-1', state: 'STOP', terminal: true, stop: { reason } }), ['g-1', 'STOP', reason, RESUME], 'goal extend');
  });

  test('a DONE goal names DONE and aidlc goal resume [R2]', () => {
    names(terminalGoalRefusal({ id: 'g-1', state: 'DONE', terminal: true }), ['g-1', 'DONE', RESUME], 'goal extend');
  });

  test('a non-terminal goal left in STOP by the resume of a time stop names aidlc goal extend [R2]', () => {
    names(terminalGoalRefusal({ id: 'g-1', state: 'STOP', terminal: false }), ['g-1', 'STOP', EXTEND], 'goal resume');
  });
});
