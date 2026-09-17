import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeOf, renderBoard } from '../../src/state/board.ts';
import { makeStop } from '../../src/core/stop.ts';
import { iso, makeCard, makeCardRun, makeGoal } from './helpers.ts';

describe('state/board (regenerated view, never the store of record)', () => {
  const goal = makeGoal('goal-board', { maxWorkers: 2 });
  const cards = [
    makeCard('T1-A'),
    makeCard('T1-B', { depends_on: ['T1-A'] }),
    makeCard('T1-C', { freeze: true }),
    makeCard('T1-D', { status: 'merged' }),
    makeCard('T1-E'),
    makeCard('T1-F'),
  ];
  const runs = [
    makeCardRun(goal.id, 'T1-A', { state: 'BUILD', worktree: 'C:\\wt\\T1-A' }),
    makeCardRun(goal.id, 'T1-E', { state: 'STOP', stop: makeStop('review', 'second block', 'ask a human', { at: iso() }) }),
    makeCardRun(goal.id, 'T1-F', { state: 'WAIT', pr: { number: 42, state: 'OPEN' } }),
  ];

  it('outcomeOf maps card status and run state to arc outcomes', () => {
    assert.equal(outcomeOf(undefined, makeCard('T1-X')), 'todo');
    assert.equal(outcomeOf(undefined, makeCard('T1-X', { status: 'merged' })), 'closed');
    assert.equal(outcomeOf(makeCardRun('g', 'T1-X', { state: 'DONE' }), makeCard('T1-X')), 'closed');
    assert.equal(outcomeOf(makeCardRun('g', 'T1-X', { state: 'STOP' }), makeCard('T1-X')), 'stopped');
    assert.equal(outcomeOf(makeCardRun('g', 'T1-X', { state: 'WAIT' }), makeCard('T1-X')), 'waiting');
    assert.equal(outcomeOf(makeCardRun('g', 'T1-X', { state: 'PREPARE' }), makeCard('T1-X')), 'todo');
    assert.equal(outcomeOf(makeCardRun('g', 'T1-X', { state: 'PREPARE', worktree: 'C:\\wt\\T1-X' }), makeCard('T1-X')), 'running');
    assert.equal(outcomeOf(makeCardRun('g', 'T1-X', { state: 'SHIP' }), makeCard('T1-X')), 'running');
  });

  it('renders the goal header lines', () => {
    const out = renderBoard(goal, cards, runs, iso());
    assert.match(out, /^# aidlc board — goal-board/m);
    assert.match(out, /^- \*\*Goal\*\*: Build the widget feature/m);
    assert.match(out, /^- \*\*Generation \/ revision\*\*: 0 \/ 0/m);
    assert.match(out, /^- \*\*State\*\*: RUN$/m);
    assert.match(out, /^- \*\*Route\*\*: size=T1 kind=feature target=development modules=router\+arc\+card-loop/m);
    assert.match(out, /^- \*\*Deadline\*\*: 2026-09-11T22:00:00\.000Z \(created 2026-09-11T10:00:00\.000Z\)/m);
    assert.match(out, /^- \*\*Stages\*\*: development=pending package=not_requested/m);
    assert.match(out, /^- \*\*Counters\*\*: planning=0\/2 integration-repair=0\/1 lifecycle-repair=0\/1/m);
    assert.match(out, /^- \*\*Arc\*\*: verdict=\w+ workers=\d+ wave=/m);
    assert.match(out, /view only; clocks, approvals and history live in \.aidlc\//);
  });

  it('renders one row per card with the six-state checkbox mapping', () => {
    const out = renderBoard(goal, cards, runs, iso());
    const rows = out.split('\n').filter((l) => /^\| \[.\] \| T1-/.test(l));
    assert.equal(rows.length, cards.length);
    const row = (id: string) => rows.find((r) => r.includes(`| ${id} |`))!;
    assert.match(row('T1-A'), /^\| \[-\] \| T1-A \| BUILD \| - \|/);
    assert.match(row('T1-B'), /^\| \[ \] \| T1-B \| todo \| T1-A \| waiting \|/);
    assert.match(row('T1-D'), /^\| \[x\] \| T1-D \| DONE \|/);
    assert.match(row('T1-E'), /^\| \[S\] \| T1-E \| STOP \|/);
    assert.match(row('T1-E'), /review: second block \|$/);
    assert.match(row('T1-F'), /^\| \[\?\] \| T1-F \| WAIT \|/);
    assert.match(row('T1-F'), /\| #42 OPEN \|/);
    // review / ci / attempt counters for a run
    assert.match(row('T1-A'), /\| 0\/2 blocks=0 nv=0 \| 0\/1 \|/);
    assert.match(row('T1-A'), /C:\\wt\\T1-A/);
  });

  it('renders the STOP line for a stopped goal and arc notes when the arc has reasons', () => {
    const stopped = { ...goal, state: 'STOP' as const, terminal: true, stop: makeStop('time', 'arc deadline reached', 'hand off with evidence', { at: iso() }) };
    const out = renderBoard(stopped, cards, runs, iso());
    assert.match(out, /^- \*\*State\*\*: STOP \(terminal\)$/m);
    assert.match(out, /^- \*\*STOP\*\*: STOP\/time \(global\) arc deadline reached -> next: hand off with evidence/m);
    // freeze card T1-C is ready while T1-A is running -> arc explains it waits
    assert.match(out, /^## Arc notes$/m);
    assert.match(out, /freeze card T1-C waits for running work to finish/);
  });

  it('reports the arc of a projection whose prerequisite merged elsewhere, not a stop of its own', () => {
    const projection = [makeCard('T1-NEXT', { depends_on: ['T1-EARLIER'] })];
    const blind = renderBoard(makeGoal('goal-extern'), projection, [], iso());
    assert.match(blind, /^- \*\*Arc\*\*: verdict=stop workers=\d+ wave=-/m, 'with no outcome from the caller the view sees an open gap');
    const vouched = renderBoard(makeGoal('goal-extern'), projection, [], iso(), { 'T1-EARLIER': 'closed' });
    assert.match(vouched, /^- \*\*Arc\*\*: verdict=dispatch workers=\d+ wave=T1-NEXT ready=T1-NEXT$/m);
    assert.doesNotMatch(vouched, /^\| \[.\] \| T1-EARLIER \|/m, 'the prerequisite outside the projection is no row of this board');
  });

  it('omits arc notes and STOP when there is nothing to say', () => {
    const quiet = makeGoal('goal-quiet');
    const out = renderBoard(quiet, [makeCard('T1-Q')], [], iso());
    assert.doesNotMatch(out, /## Arc notes/);
    assert.doesNotMatch(out, /\*\*STOP\*\*/);
    assert.match(out, /^\| \[ \] \| T1-Q \| todo \| - \| next \|/m);
  });
});
