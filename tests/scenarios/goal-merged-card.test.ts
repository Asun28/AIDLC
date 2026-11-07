import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync } from 'node:fs';
import { makeFixture, writeCard } from './_harness.ts';

/** A fixture whose registry holds T0-OLD with `status: merged`. */
function withMergedCard() {
  const fx = makeFixture();
  writeCard(fx, { id: 'T0-OLD', title: 'merged earlier', status: 'merged' });
  return fx;
}

function assertRefusedWithNothingWritten(fx: ReturnType<typeof makeFixture>, create: () => unknown): void {
  assert.throws(create, (e: unknown) => e instanceof Error && e.message.includes('T0-OLD') && e.message.includes('successor'));
  assert.deepEqual(fx.store.listGoals(), [], 'no goal record');
  assert.deepEqual(readdirSync(fx.paths.journal), [], 'no journal');
  assert.deepEqual(readdirSync(fx.paths.leases), [], 'no lease');
}

test('T0-GOAL-MERGED-CARD acceptance 1: a goal whose --card is merged is refused, with nothing written [R1] [R2]', () => {
  const fx = withMergedCard();
  try {
    assertRefusedWithNothingWritten(fx, () => fx.controller.createGoal({ text: 'Fix the thing', source: 'card', ref: 'T0-OLD', affectedSurfaces: [] }, { cards: ['T0-OLD'] }));
  } finally {
    fx.cleanup();
  }
});

test('T0-GOAL-MERGED-CARD acceptance 1: a request text that resolves to a merged card is refused, with nothing written [R1] [R2]', () => {
  const fx = withMergedCard();
  try {
    assertRefusedWithNothingWritten(fx, () => fx.controller.createGoal({ text: 'implement T0-OLD', source: 'natural-language', affectedSurfaces: [] }));
  } finally {
    fx.cleanup();
  }
});

test('T0-GOAL-MERGED-CARD acceptance 2: a card-text amendment of a merged card still creates its goal [R3]', () => {
  const fx = withMergedCard();
  try {
    const goal = fx.controller.createGoal({ text: 'reword the card text of T0-OLD', source: 'natural-language', affectedSurfaces: [] });
    assert.equal(goal.routing.kind, 'card-amendment');
    assert.deepEqual(goal.cards, ['T0-OLD']);
    assert.deepEqual(fx.store.listGoals().map((g) => g.id), [goal.id]);
  } finally {
    fx.cleanup();
  }
});
