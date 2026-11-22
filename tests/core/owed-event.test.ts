import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CardRun, OwedEvent } from '../../src/core/types.ts';
import { cardRun } from './_fixtures.ts';

const TEN_TYPES = [
  'CARD_DISPATCHED',
  'ATTEMPT_STARTED',
  'ATTEMPT_FINISHED',
  'PRE_REVIEW_DECIDED',
  'REVIEW_DECIDED',
  'OPERATION_RESULT',
  'FINDING_RULED',
  'MERGE_ADOPTED',
  'CARD_STATE',
  'NOTE',
];

function owed(type: string, key = `k-${type}`): Record<string, unknown> {
  return { key, type, generation: 0, data: { cardId: 'T1-A' } };
}

describe('OwedEvent type', () => {
  for (const type of TEN_TYPES) {
    test(`accepts an owed ${type} event`, () => {
      assert.deepEqual(OwedEvent.parse(owed(type)), owed(type));
    });
  }

  test('refuses the type GOAL_STATE', () => {
    assert.throws(() => OwedEvent.parse(owed('GOAL_STATE')));
  });

  test('refuses an empty type', () => {
    assert.throws(() => OwedEvent.parse(owed('')));
  });
});

describe('CardRun journalOwed', () => {
  const entries = [owed('CARD_STATE', 'continue:T1-A:1'), owed('NOTE', 'amend:T1-A:1')];

  test('a run owing a CARD_STATE and a NOTE event parses with both entries unchanged', () => {
    const parsed = CardRun.parse({ ...cardRun(), journalOwed: entries });
    assert.deepEqual(parsed.journalOwed, entries);
  });

  test('a run owing an event of type GOAL_STATE is refused', () => {
    assert.throws(() => CardRun.parse({ ...cardRun(), journalOwed: [...entries, owed('GOAL_STATE', 'goal:1')] }));
  });
});
