import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRevision, routeAmendment } from '../../src/core/amendments.ts';
import { card, cardRun } from './_fixtures.ts';

const base = { textOnly: false, currentGeneration: 1, currentRevision: 2 };

describe('amendments (Q5)', () => {
  test('Q5: an unstarted card is amended in place as a new revision', () => {
    const r = routeAmendment({ ...base, card: card('T1-A') });
    assert.equal(r.route, 'amend-in-place');
  });

  test('Q5: running or reviewed work reconciles its effects first', () => {
    assert.equal(routeAmendment({ ...base, card: card('T1-A'), run: cardRun({ state: 'BUILD' }) }).route, 'reconcile-then-amend');
    assert.equal(routeAmendment({ ...base, card: card('T1-A'), run: cardRun({ state: 'WAIT' }) }).route, 'reconcile-then-amend');
    const reviewed = cardRun({ state: 'PREPARE', pr: { number: 3, state: 'OPEN' } });
    assert.equal(routeAmendment({ ...base, card: card('T1-A'), run: reviewed }).route, 'reconcile-then-amend');
  });

  test('Q5: merged history is immutable; the new requirement becomes a successor', () => {
    const r = routeAmendment({ ...base, card: card('T1-A', { status: 'merged' }) });
    assert.equal(r.route, 'successor');
    assert.equal(r.route === 'successor' && r.successorOf, 'T1-A');
    const viaRun = routeAmendment({ ...base, card: card('T1-A'), run: cardRun({ state: 'CLOSE', mergeVerified: true }) });
    assert.equal(viaRun.route, 'successor');
  });

  test('Q5: a card-text-only request never authorises code execution', () => {
    const r = routeAmendment({ ...base, textOnly: true, card: card('T1-A'), run: cardRun({ state: 'BUILD' }) });
    assert.equal(r.route, 'text-only');
    assert.match(r.detail, /do not execute/);
  });

  test('Q5: a stale generation or revision dispatch must revalidate before mutating', () => {
    assert.equal(routeAmendment({ ...base, card: card('T1-A'), observedGeneration: 0 }).route, 'revalidate');
    assert.equal(routeAmendment({ ...base, card: card('T1-A'), observedRevision: 1, textOnly: true }).route, 'revalidate', 'stale check precedes text-only');
    assert.equal(routeAmendment({ ...base, card: card('T1-A'), observedGeneration: 1, observedRevision: 2 }).route, 'amend-in-place');
  });

  test('a PREPARE run with no worktree or PR still counts as unstarted', () => {
    assert.equal(routeAmendment({ ...base, card: card('T1-A'), run: cardRun({ state: 'PREPARE' }) }).route, 'amend-in-place');
  });

  test('Q5: mapRevision maps superseded cards, records removals and retains unaffected evidence', () => {
    const m = mapRevision(['T1-A', 'T1-B', 'T1-C'], ['T1-A', 'T1-D'], { 'T1-B': 'T1-D' });
    assert.deepEqual(m.supersededCards, { 'T1-B': 'T1-D' });
    assert.deepEqual(m.removedCards, ['T1-C']);
    assert.deepEqual(m.retainedEvidenceFor, ['T1-A']);
  });
});
