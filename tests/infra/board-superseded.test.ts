import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeOf, renderBoard } from '../../src/state/board.ts';
import { makeStop } from '../../src/core/stop.ts';
import { Lease, type Card, type CardRun } from '../../src/core/types.ts';
import { iso, makeCard, makeCardRun, makeGoal } from './helpers.ts';

// Card T0-BOARD-SUPERSEDED: the board row of a card with superseded_by says so and names the successor; the arc is unchanged.
const goal = makeGoal('goal-sup', { maxWorkers: 2 });
const rowOf = (out: string, id: string) => out.split('\n').find((l) => l.includes(`| ${id} |`))!;
const arcOf = (out: string) => out.split('\n').find((l) => l.startsWith('- **Arc**:'));
const notesOf = (out: string) => out.split('## Arc notes')[1] ?? '';
const unmarked = (cards: Card[]) => cards.map((c) => ({ ...c, superseded_by: undefined }));

describe('T0-BOARD-SUPERSEDED: board row of a superseded card', () => {
  const cards = [makeCard('T0-A', { superseded_by: 'T0-B' }), makeCard('T0-C')];

  it('acceptance 1: a superseded card with no run shows [~] SUPERSEDED and its successor; another row is unchanged [R1] [R2]', () => {
    const out = renderBoard(goal, cards, [], iso());
    const a = rowOf(out, 'T0-A');
    assert.match(a, /^\| \[~\] \| T0-A \| SUPERSEDED \|/);
    assert.match(a, /\| superseded by T0-B \|$/);
    assert.equal(rowOf(out, 'T0-C'), rowOf(renderBoard(goal, unmarked(cards), [], iso()), 'T0-C'));
  });

  it('acceptance 2: with a run the state gains (superseded) and the blocker the successor; a merged card keeps its row [R1]', () => {
    const runs: CardRun[] = [makeCardRun(goal.id, 'T0-A', { state: 'STOP', stop: makeStop('review', 'second block', 'ask a human', { at: iso() }) })];
    const out = renderBoard(goal, cards, runs, iso());
    const main = rowOf(renderBoard(goal, unmarked(cards), runs, iso()), 'T0-A');
    const a = rowOf(out, 'T0-A');
    assert.match(a, /^\| \[S\] \| T0-A \| STOP \(superseded\) \|/);
    assert.match(a, /\| superseded by T0-B; review: second block \|$/);
    assert.equal(a.replace(' (superseded)', '').replace('superseded by T0-B; ', ''), main);

    const merged = [makeCard('T0-A', { status: 'merged', superseded_by: 'T0-B' }), makeCard('T0-C')];
    assert.equal(rowOf(renderBoard(goal, merged, [], iso()), 'T0-A'), rowOf(renderBoard(goal, unmarked(merged), [], iso()), 'T0-A'));
  });

  it('R3 decision 1 F1: a live owner row keeps its box and state and gains only the Blocker prefix [R1]', () => {
    const runs = [makeCardRun(goal.id, 'T0-A', { state: 'STOP', stop: makeStop('ownership', 'lease held by win-B', 'wait for the owner', { at: iso() }) })];
    const owner = Lease.parse({ resourceKey: 'card:k', generation: 1, owner: { session: 'win-B', pid: 1, processStart: iso(), host: 'h1' }, acquiredAt: iso(), heartbeatAt: iso(), expiresAt: '2026-09-11T12:30:00.000Z', released: false });
    const owners = new Map([['T0-A', owner]]);
    const main = rowOf(renderBoard(goal, unmarked(cards), runs, iso(), {}, owners), 'T0-A');
    const a = rowOf(renderBoard(goal, cards, runs, iso(), {}, owners), 'T0-A');
    assert.match(a, /^\| \[-\] \| T0-A \| STOP \(lease live\) \|/);
    assert.ok(!a.includes('(superseded)'), 'the owner row keeps main\'s state text');
    const blocker = main.split(' | ').at(-1)!.replace(/ \|$/, '');
    assert.ok(a.endsWith(`| superseded by T0-B; ${blocker} |`), 'the successor prefix comes before the whole Blocker of main');
    assert.equal(a.replace('superseded by T0-B; ', ''), main);
  });

  it('acceptance 3: outcomeOf, the Arc line and the Arc notes do not change [R2]', () => {
    const stopRun = makeCardRun(goal.id, 'T0-A', { state: 'STOP', stop: makeStop('review', 'second block', 'ask a human', { at: iso() }) });
    const merged = [makeCard('T0-A', { status: 'merged', superseded_by: 'T0-B' }), makeCard('T0-C')];
    for (const [set, runs] of [[cards, []], [cards, [stopRun]], [merged, []], [merged, [stopRun]]] as Array<[Card[], CardRun[]]>) {
      for (const card of set) {
        const run = runs.find((r) => r.cardId === card.id);
        assert.equal(outcomeOf(run, card), outcomeOf(run, { ...card, superseded_by: undefined }));
      }
      const marked = renderBoard(goal, set, runs, iso());
      const plain = renderBoard(goal, unmarked(set), runs, iso());
      assert.equal(arcOf(marked), arcOf(plain));
      assert.equal(notesOf(marked), notesOf(plain));
    }
  });
});
