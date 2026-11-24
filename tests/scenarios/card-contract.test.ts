import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, T0 } from './_harness.ts';
import { contractDigests } from '../../src/core/contract.ts';
import { CardRun } from '../../src/core/types.ts';

test('R2/R4: a new run holds the contract digests of its card; later calls return it as it is after the card file changes and is removed', () => {
  const fx = makeFixture();
  try {
    const spec = { id: 'T1-K', title: 'k', requirements: ['R1. The k shall hold.'], acceptance: ['1. k holds. [R1]'], budget: 80 };
    const file = writeCard(fx, spec);
    const goal = goalForCards(fx, ['T1-K']);
    const before = contractDigests(fx.card('T1-K'));
    assert.deepEqual(fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-K').contract, before);
    const runBytes = readFileSync(fx.store.cardFile(goal.id, 'T1-K'), 'utf8');
    writeCard(fx, { ...spec, acceptance: ['1. k holds twice. [R1]'] });
    assert.notDeepEqual(contractDigests(fx.card('T1-K')), before);
    assert.deepEqual(fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-K').contract, before);
    rmSync(file);
    assert.deepEqual(fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-K').contract, before);
    assert.equal(readFileSync(fx.store.cardFile(goal.id, 'T1-K'), 'utf8'), runBytes, 'no call after the first writes the run');
  } finally {
    fx.cleanup();
  }
});

test('R3: for a card the registry does not hold and that has no run, ensureCardRun throws naming the card, writes no run and appends nothing', () => {
  const fx = makeFixture();
  try {
    const file = writeCard(fx, { id: 'T1-L', title: 'l' });
    const goal = goalForCards(fx, ['T1-L']);
    rmSync(file);
    const journal = fx.journal(goal.id).file;
    const journalBytes = readFileSync(journal, 'utf8');
    assert.throws(() => fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-L'), /T1-L/);
    assert.equal(existsSync(fx.store.cardFile(goal.id, 'T1-L')), false);
    assert.equal(readFileSync(journal, 'utf8'), journalBytes);
  } finally {
    fx.cleanup();
  }
});

test('R8: a run without contract or amendments parses to undefined and an empty list; one amendment round-trips', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-K', title: 'k' });
    const goal = goalForCards(fx, ['T1-K']);
    const { contract: _c, amendments: _a, ...bare } = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-K');
    const old = CardRun.parse(bare);
    assert.equal(old.contract, undefined);
    assert.deepEqual(old.amendments, []);
    const amendment = { at: T0, by: 'owner', reason: 'acceptance reworded', revision: 1, changed: ['acceptance'], invalidated: ['dod', 'review'] };
    const amended = CardRun.parse(JSON.parse(JSON.stringify({ ...bare, amendments: [amendment] })));
    assert.deepEqual(amended.amendments, [amendment]);
    assert.deepEqual(CardRun.parse(JSON.parse(JSON.stringify(amended))), amended);
    for (const bad of [{ by: '' }, { reason: '' }, { revision: -1 }, { at: 'now' }, { changed: ['title'] }, { invalidated: ['ci'] }]) {
      assert.equal(CardRun.safeParse({ ...bare, amendments: [{ ...amendment, ...bad }] }).success, false, JSON.stringify(bad));
    }
  } finally {
    fx.cleanup();
  }
});
