import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';

test('Q5: a requirement revision versions the same goal, maps superseded cards and returns to PLAN', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
    writeCard(fx, { id: 'T1-C', title: 'c (replaces b)', allowPaths: ['src/c.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' });
    assert.equal(goal.state, 'RUN');
    const r = fx.controller.report({ goalId: goal.id, generation: 0, result: 'revision', data: { text: 'build the hello feature, but c instead of b', cards: ['T1-A', 'T1-C'], replacements: { 'T1-B': 'T1-C' }, reason: 'user amendment' } });
    const g = fx.goal(goal.id);
    assert.equal(g.revision, 1);
    assert.equal(g.revisions.length, 2);
    assert.equal(g.revisions[1]!.request.text, 'build the hello feature, but c instead of b');
    assert.deepEqual(g.revisions[1]!.supersededCards, { 'T1-B': 'T1-C' });
    assert.deepEqual(g.revisions[1]!.removedCards, []);
    assert.deepEqual(g.cards, ['T1-A', 'T1-C']);
    assert.equal(g.cardRevisions['T1-A'], 0, 'unaffected card keeps its revision and evidence');
    assert.equal(g.cardRevisions['T1-C'], 0);
    assert.equal(g.state, 'PLAN');
    assert.equal(g.generation, 0, 'a revision does not change the execution generation');
    assert.ok(fx.events(goal.id).some((e) => e.type === 'GOAL_REVISED'));
    assert.ok(['plan', 'project-cards'].includes(r.directive.kind));
  } finally {
    fx.cleanup();
  }
});

test('Q5: a stale dispatch (wrong generation) is refused before any mutation', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const before = fx.events(goal.id).length;
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 7, result: 'cards-projected', data: { cards: ['T1-HELLO'] } }), /stale report/);
    assert.equal(fx.events(goal.id).length, before);
    assert.equal(fx.goal(goal.id).state, 'RUN');
  } finally {
    fx.cleanup();
  }
});

test('Q5/Q8: a terminal goal refuses new work; resume links the old generation and keeps exhausted limits', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'user cancelled' } });
    const cancelled = fx.goal(goal.id);
    assert.equal(cancelled.terminal, true);
    assert.equal(cancelled.stop?.reason, 'cancelled');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-HELLO'] } }), /terminal/);
    assert.equal(fx.controller.next(goal.id).kind, 'stop');

    const resumed = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'user asked to continue' } });
    const g = fx.goal(goal.id);
    assert.equal(g.generation, 1);
    assert.equal(g.terminal, false);
    assert.equal(g.linkedFrom, `${goal.id}@0`);
    assert.equal(g.deadlines.goalDeadline, goal.deadlines.goalDeadline, 'the original deadline is preserved');
    assert.notEqual(resumed.directive.kind, 'stop');
    assert.equal(resumed.directive.generation, 1);
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-HELLO'] } }), /stale report/, 'old-generation dispatch is refused after resume');
  } finally {
    fx.cleanup();
  }
});
