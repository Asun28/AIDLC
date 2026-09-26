import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, T0 } from './_harness.ts';
import { HOUR_MS, addMs, type GoalRequest, type RequestSize } from '../../src/core/types.ts';

/** A fixture whose registry holds the two cards the issue #73 request named. */
function withCards() {
  const fx = makeFixture();
  writeCard(fx, { id: 'T1-PARSE-GUARD', title: 'parse guard' });
  writeCard(fx, { id: 'T1-STORE-CAS', title: 'store cas' });
  const create = (request: Partial<GoalRequest> & { text: string }, cards?: string[]) =>
    fx.controller.createGoal({ source: 'natural-language', affectedSurfaces: [], ...request }, cards ? { cards } : {});
  return { fx, create };
}

const ISSUE_73 = 'v5.1 hardening wave 1: T1-PARSE-GUARD then T1-STORE-CAS, per docs/plans/PLAN-v5.1-hardening.md';

test('T0-GOAL-CARD-COUNT acceptance 2: the issue #73 request, with an explicit T1 or no size, starts with no card and the 12 h arc deadline [R2]', () => {
  const { fx, create } = withCards();
  try {
    for (const explicitSize of ['T1', undefined] as const) {
      const goal = create({ text: ISSUE_73, explicitSize });
      assert.deepEqual(goal.cards, [], `size ${explicitSize ?? 'inferred'}: the projection names the cards`);
      assert.equal(goal.deadlines.goalDeadline, addMs(T0, 12 * HOUR_MS), `size ${explicitSize ?? 'inferred'}: the arc limit`);
    }
  } finally {
    fx.cleanup();
  }
});

test('T0-GOAL-CARD-COUNT acceptance 2: --card with an explicit T1 or T2 keeps that card and gets the 12 h arc deadline [R3]', () => {
  const { fx, create } = withCards();
  try {
    for (const explicitSize of ['T1', 'T2'] as RequestSize[]) {
      const goal = create({ text: 'Execute card T1-PARSE-GUARD', source: 'card', ref: 'T1-PARSE-GUARD', explicitSize }, ['T1-PARSE-GUARD']);
      assert.deepEqual(goal.cards, ['T1-PARSE-GUARD'], explicitSize);
      assert.equal(goal.deadlines.goalDeadline, addMs(T0, 12 * HOUR_MS), `${explicitSize}: never the one-card limit`);
    }
  } finally {
    fx.cleanup();
  }
});

test('T0-GOAL-CARD-COUNT acceptance 2: one named card with no size or an explicit T0, from the text or --card, keeps the card and the 3 h limit [R2] [R3]', () => {
  const { fx, create } = withCards();
  try {
    const goals = [
      create({ text: 'implement T1-PARSE-GUARD' }),
      create({ text: 'implement T1-PARSE-GUARD', explicitSize: 'T0' }),
      create({ text: 'Execute card T1-PARSE-GUARD', source: 'card', ref: 'T1-PARSE-GUARD', explicitSize: 'T0-bugfix' }, ['T1-PARSE-GUARD']),
    ];
    // --card one card with a T1 the router inferred from impact words: only an explicit T1 or T2 forces the arc.
    const inferred = create({ text: 'Execute card T1-PARSE-GUARD: fix the password reset token', source: 'card', ref: 'T1-PARSE-GUARD' }, ['T1-PARSE-GUARD']);
    assert.deepEqual([inferred.routing.size, inferred.routing.sizeSource], ['T1', 'inferred'], 'impact words infer T1');
    for (const goal of [...goals, inferred]) {
      assert.deepEqual(goal.cards, ['T1-PARSE-GUARD']);
      assert.equal(goal.deadlines.goalDeadline, addMs(T0, 3 * HOUR_MS));
    }
  } finally {
    fx.cleanup();
  }
});

test('T0-GOAL-CARD-COUNT acceptance 2: a release goal with an explicit T1 or T2 gets 12 h, a release with no explicit size keeps 3 h, and a tighter user limit wins [R3]', () => {
  const { fx, create } = withCards();
  try {
    for (const explicitSize of ['T1', 'T2'] as RequestSize[]) {
      const goal = create({ text: 'release to staging', explicitSize });
      assert.equal(goal.routing.kind, 'release', `${explicitSize}: a release route`);
      assert.equal(goal.deadlines.goalDeadline, addMs(T0, 12 * HOUR_MS), `${explicitSize}: the arc limit, not the standalone release limit`);
    }
    const plain = create({ text: 'release to staging' });
    assert.equal(plain.routing.kind, 'release');
    assert.equal(plain.deadlines.goalDeadline, addMs(T0, 3 * HOUR_MS), 'a release with no explicit size keeps the one-card limit');
    const limited = fx.controller.createGoal({ text: ISSUE_73, source: 'natural-language', affectedSurfaces: [], explicitSize: 'T1' }, { userLimitMs: HOUR_MS });
    assert.equal(limited.deadlines.goalDeadline, addMs(T0, HOUR_MS), 'a tighter user limit wins over the arc limit');
  } finally {
    fx.cleanup();
  }
});

test('T0-GOAL-CARD-COUNT-3 acceptance 3: the issue #73 request with --card one of its two cards keeps that card and gets 12 h; --card on a one-card text keeps 3 h [R3]', () => {
  const { fx, create } = withCards();
  try {
    const several = create({ text: ISSUE_73, source: 'card', ref: 'T1-PARSE-GUARD' }, ['T1-PARSE-GUARD']);
    assert.deepEqual(several.cards, ['T1-PARSE-GUARD'], '--card sets the goal cards');
    assert.equal(several.deadlines.goalDeadline, addMs(T0, 12 * HOUR_MS), 'a text naming several cards keeps the arc limit');
    const one = create({ text: 'Execute card T1-PARSE-GUARD', source: 'card', ref: 'T1-PARSE-GUARD' }, ['T1-PARSE-GUARD']);
    assert.equal(one.deadlines.goalDeadline, addMs(T0, 3 * HOUR_MS), 'a one-card text with --card keeps the card limit');
  } finally {
    fx.cleanup();
  }
});

test('T0-GOAL-CARD-COUNT-3 acceptance 5: docs/OPERATIONS.md and the CHANGELOG Unreleased section state the three rules [R5]', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
  const sentence = 'A request whose text names several cards keeps the arc limit also when `--card` names one of them, its `ref=` is the first known card id of the text, and a caller that passes no known card list has every card id token counted (card T0-GOAL-CARD-COUNT-3).';
  assert.ok(read('docs', 'OPERATIONS.md').includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const end = changelog.indexOf('\n## ', start + 1);
  const unreleased = changelog.slice(start, end === -1 ? changelog.length : end);
  const entry = "- Goal card count follow-up, card T0-GOAL-CARD-COUNT-3: a request whose text names several cards keeps the 12 h arc deadline when `--card` names one of them; the router takes `ref=` from the first known card id, never an unknown id before it, and without a known card list counts every card id token, so two tokens leave the count to the projection (issue #73).";
  assert.ok(unreleased.includes(entry), `CHANGELOG.md Unreleased states: ${entry}`);
});

test('T0-GOAL-CARD-COUNT acceptance 3: docs/OPERATIONS.md, docs/ARCHITECTURE.md and the CHANGELOG Unreleased section state how the count is decided [R4]', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
  const operations = read('docs', 'OPERATIONS.md');
  for (const sentence of [
    '- The goal deadline is fixed at intake from the card count (card T0-GOAL-CARD-COUNT): one card gets the 3 h card limit, and an unknown count or more than one card gets the 12 h arc limit.',
    'The count is 1 when the request names one known card id, or `--card` names one card, with a T0 or T0-bugfix size; a request that names several known card ids leaves it unknown for the projection to decide, and an explicit T1 or T2 size always gets the arc limit.',
  ]) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  const sentence = 'The goal deadline is fixed at intake: `createGoal` (`src/loop/controller.ts`) takes the goal\'s card from the request text only when the router counts exactly one card, a request naming several known card ids leaves the count unknown, and an explicit T1 or T2 size always gets the arc limit (card T0-GOAL-CARD-COUNT).';
  assert.ok(read('docs', 'ARCHITECTURE.md').includes(sentence), `docs/ARCHITECTURE.md states: ${sentence}`);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const end = changelog.indexOf('\n## ', start + 1);
  const unreleased = changelog.slice(start, end === -1 ? changelog.length : end);
  const entry = '- Goal card count, card T0-GOAL-CARD-COUNT: a goal request that names several known card ids, or carries an explicit T1 or T2 size, now gets the 12 h arc deadline and leaves its card list to the projection; it used to take the first card id of the text as its only card and get the 3 h one-card limit (issue #73).';
  assert.ok(unreleased.includes(entry), `CHANGELOG.md Unreleased states: ${entry}`);
});
