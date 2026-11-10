import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeOf, readWatch, renderBoard, renderWatch, watchRegistry, type WatchReads } from '../../src/state/board.ts';
import { makeStop } from '../../src/core/stop.ts';
import { Lease, type CardRun, type Goal } from '../../src/core/types.ts';
import { StoreError } from '../../src/state/store.ts';
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
    assert.match(out, /^- \*\*Counters\*\*: planning=0\/2 integration-repair=0\/1$/m);
    assert.ok(!out.includes('lifecycle-repair'), 'the board shows no lifecycle repair bound (T1-SWEEP-DEAD-CODE)');
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

describe('aidlc board --watch screen (T1-BOARD-WATCH)', () => {
  const now = '2026-09-11T12:00:00.000Z';
  const lease = (label: string, session: string, generation: number, expiresAt: string, released = false, host = 'h1'): Lease =>
    Lease.parse({ resourceKey: `${label}:k`, generation, owner: { session, pid: 1, processStart: now, host }, acquiredAt: now, heartbeatAt: now, expiresAt, released });
  const goal = makeGoal('goal-watch', { cards: ['T1-A', 'T1-B', 'T1-E', 'T1-GONE'], stop: makeStop('review', 'second block', 'ask a human', { at: iso() }) });
  const runs: Record<string, CardRun> = {
    'T1-A': makeCardRun(goal.id, 'T1-A', { state: 'BUILD' }),
    'T1-E': makeCardRun(goal.id, 'T1-E', { state: 'STOP', stop: makeStop('review', 'second block', 'ask a human', { at: iso() }), blocker: 'waiting on a human' }),
    'T1-GONE': makeCardRun(goal.id, 'T1-GONE', { state: 'SHIP' }),
  };
  // T1-A's lease expires exactly at the render's now (still live); T1-B's expired a millisecond before; T1-E's is released.
  const leases: Record<string, Lease> = {
    goal: lease('goal', 'win-A', 3, '2026-09-11T12:10:00.000Z'),
    'T1-A': lease('card', 'win-B', 1, now),
    'T1-B': lease('card', 'win-C', 2, '2026-09-11T11:59:59.999Z'),
    'T1-E': lease('card', 'win-D', 4, '2026-09-11T13:00:00.000Z', true),
  };
  const reads = (over: Partial<WatchReads> = {}): WatchReads => ({
    goal: () => goal,
    run: (cardId) => runs[cardId],
    lease: (label) => leases[label],
    registry: () => new Set(['T1-A', 'T1-B', 'T1-E']),
    ...over,
  });
  /** A read that fails with `err` on its first call and returns `value` after. */
  const scripted = <T,>(err: Error, value: T) => {
    let calls = 0;
    return (): T => {
      if (calls++ === 0) throw err;
      return value;
    };
  };

  it('renders the six line groups of the Output contract: the stop reason only, live leases only, a card outside the registry marked [R1]', () => {
    assert.deepEqual(renderWatch(readWatch('goal-watch', reads()), now).split('\n'), [
      'aidlc watch: goal-watch at 2026-09-11T12:00:00.000Z (view only; Ctrl+C ends it)',
      'Goal: RUN, generation 0, revision 0, deadline 2026-09-11T22:00:00.000Z',
      'Stop: review',
      'Cards:',
      '  T1-A BUILD',
      '  T1-B todo',
      '  T1-E STOP stop review blocker',
      '  T1-GONE SHIP not in the card registry',
      'Leases:',
      '  goal owner win-A host h1 generation 3 until 2026-09-11T12:10:00.000Z',
      '  T1-A owner win-B host h1 generation 1 until 2026-09-11T12:00:00.000Z',
      'Next: not computed (view only); run aidlc next --goal goal-watch',
    ]);
  });

  it('says (none) for no cards and no live lease, marks a terminal goal, and has no Stop line without a stop [R1]', () => {
    const quiet = makeGoal('goal-quiet', { state: 'DONE', terminal: true });
    assert.deepEqual(renderWatch(readWatch('goal-quiet', reads({ goal: () => quiet, lease: () => leases['T1-B'] })), now).split('\n'), [
      'aidlc watch: goal-quiet at 2026-09-11T12:00:00.000Z (view only; Ctrl+C ends it)',
      'Goal: DONE (terminal), generation 0, revision 0, deadline 2026-09-11T22:00:00.000Z',
      'Cards:',
      '  (none)',
      'Leases:',
      '  (none)',
      'Next: not computed (view only); run aidlc next --goal goal-quiet',
    ]);
  });

  it('never prints stop detail, next action, blocker or request text, and escapes a lease owner and host that are not plain [R3]', () => {
    const hostile = 'X\n\u001b[2J\u009b\u202e\u007f';
    const g: Goal = makeGoal('goal-watch', {
      cards: ['T1-A'],
      stop: makeStop('review', `detail${hostile}`, `nextaction${hostile}`, { at: iso() }),
      revisions: [{ revision: 0, at: iso(), reason: 'intake', request: { text: `request${hostile}`, source: 'natural-language', affectedSurfaces: [] }, supersededCards: {}, removedCards: [] }],
    });
    const run = makeCardRun(g.id, 'T1-A', { state: 'STOP', stop: makeStop('card', `detail${hostile}`, `nextaction${hostile}`, { at: iso() }), blocker: `blocker${hostile}` });
    const owner = lease('goal', `s${hostile}`, 1, '2026-09-11T12:10:00.000Z', false, `h${hostile}`);
    // The registry is read as card ids only, so a card title has no way onto the screen; the CLI test of acceptance 4
    // (tests/scenarios/board-watch.test.ts) loads a registry card with a hostile title and checks none of it is printed.
    const screen = renderWatch(readWatch('goal-watch', reads({ goal: () => g, run: () => run, lease: (label) => (label === 'goal' ? owner : undefined), registry: () => new Set(['T1-A']) })), now);
    assert.deepEqual(screen.split('\n'), [
      'aidlc watch: goal-watch at 2026-09-11T12:00:00.000Z (view only; Ctrl+C ends it)',
      'Goal: RUN, generation 0, revision 0, deadline 2026-09-11T22:00:00.000Z',
      'Stop: review',
      'Cards:',
      '  T1-A STOP stop card blocker',
      'Leases:',
      '  goal owner "sX\\n\\u001b[2J\\u009b\\u202e\\u007f" host "hX\\n\\u001b[2J\\u009b\\u202e\\u007f" generation 1 until 2026-09-11T12:10:00.000Z',
      'Next: not computed (view only); run aidlc next --goal goal-watch',
    ]);
    assert.doesNotMatch(screen, /[^\n\x20-\x7e]/, 'only printable ASCII and line breaks reach the screen');
    for (const text of ['detail', 'nextaction', 'request', 'blockerX']) assert.ok(!screen.includes(text), text);
  });

  it('keeps a registry card title holding a newline, ESC [2J, U+009B, U+202E and DEL off the screen: watchRegistry, the projection the CLI uses, keeps only the id [R3]', () => {
    const title = 'Watched TITLE-MARK\n\u001b[2J\u009b\u202e\u007f Next: forged';
    const hostile = makeCard('T1-A', { title });
    // Precondition: the card in memory holds every character acceptance 2 lists (a card file's YAML would not keep them all).
    for (const ch of ['\n', '\u001b[2J', '\u009b', '\u202e', '\u007f']) assert.ok(hostile.title.includes(ch), JSON.stringify(ch));
    const registry = watchRegistry([{ card: hostile }, { card: makeCard('T1-B') }]);
    assert.deepEqual([...registry], ['T1-A', 'T1-B']);
    const one = makeGoal('goal-watch', { cards: ['T1-A'] });
    const screen = renderWatch(readWatch('goal-watch', reads({ goal: () => one, run: () => undefined, lease: () => undefined, registry: () => registry })), now);
    assert.match(screen, /^ {2}T1-A todo$/m, 'the card is in the registry, so its row carries no mark');
    assert.doesNotMatch(screen, /TITLE-MARK|forged/, 'no part of the title');
    assert.doesNotMatch(screen, /[^\x20-\x7e\n]/, 'only printable ASCII and line breaks');
  });

  it('prints a code on the row of a record that cannot be read and renders it again on the next good read [R4]', () => {
    const onGoal = reads({ goal: scripted(new StoreError('MALFORMED_JSON', 'goal.json', 'Unexpected token'), goal) });
    assert.equal(renderWatch(readWatch('goal-watch', onGoal), now), 'aidlc watch: goal-watch at 2026-09-11T12:00:00.000Z (view only; Ctrl+C ends it)\nstate unreadable: MALFORMED_JSON');
    assert.match(renderWatch(readWatch('goal-watch', onGoal), now), /^Goal: RUN, generation 0,/m, 'the next good read renders the goal');
    assert.equal(renderWatch(readWatch('goal-watch', reads({ goal: () => undefined })), now).split('\n')[1], 'state unreadable: NOT_FOUND');
    const noRegistry = reads({ registry: scripted(new StoreError('READ_FAILED', 'specs/tasks', 'EACCES'), new Set(['T1-A', 'T1-B', 'T1-E'])) });
    assert.equal(renderWatch(readWatch('goal-watch', noRegistry), now).split('\n')[7], '  T1-GONE SHIP', 'an unreadable registry marks no card');
    assert.equal(renderWatch(readWatch('goal-watch', noRegistry), now).split('\n')[7], '  T1-GONE SHIP not in the card registry', 'the next good read marks it again');

    const runA = scripted(new StoreError('SCHEMA_VIOLATION', 'run.json', 'state: bad'), runs['T1-A']);
    const leaseGoal = scripted(new StoreError('READ_FAILED', 'lease.json', 'EACCES'), leases['goal']);
    const leaseA = scripted(new Error('boom'), leases['T1-A']);
    const onRows = reads({
      run: (id) => (id === 'T1-A' ? runA() : runs[id]),
      lease: (label) => (label === 'goal' ? leaseGoal() : label === 'T1-A' ? leaseA() : leases[label]),
    });
    assert.deepEqual(renderWatch(readWatch('goal-watch', onRows), now).split('\n').slice(3, 11), [
      'Cards:',
      '  T1-A unreadable: SCHEMA_VIOLATION',
      '  T1-B todo',
      '  T1-E STOP stop review blocker',
      '  T1-GONE SHIP not in the card registry',
      'Leases:',
      '  goal unreadable: READ_FAILED',
      '  T1-A unreadable: UNREADABLE',
    ]);
    assert.deepEqual(renderWatch(readWatch('goal-watch', onRows), now).split('\n').slice(4, 11), [
      '  T1-A BUILD',
      '  T1-B todo',
      '  T1-E STOP stop review blocker',
      '  T1-GONE SHIP not in the card registry',
      'Leases:',
      '  goal owner win-A host h1 generation 3 until 2026-09-11T12:10:00.000Z',
      '  T1-A owner win-B host h1 generation 1 until 2026-09-11T12:00:00.000Z',
    ]);
  });
});

describe('board owner wait (T0-BOARD-OWNER-WAIT)', () => {
  const goal = makeGoal('goal-owner', { cards: ['T1-O'] });
  const cards = [makeCard('T1-O')];
  const runs = [makeCardRun(goal.id, 'T1-O', { state: 'STOP', stop: makeStop('ownership', 'lease held by win-B', 'wait for the owner', { at: iso() }) })];
  const expiresAt = '2026-09-11T12:30:00.000Z';
  const owner = Lease.parse({ resourceKey: 'card:k', generation: 1, owner: { session: 'win-B', pid: 1, processStart: iso(), host: 'h1' }, acquiredAt: iso(), heartbeatAt: iso(), expiresAt, released: false });
  const row = (text: string): string => text.split('\n').find((l) => l.includes('| T1-O |')) ?? '';

  it('T0-BOARD-OWNER-WAIT acceptance 4: a run stopped for ownership with an owner lease renders as the wait on that owner [R1]', () => {
    const out = renderBoard(goal, cards, runs, iso(), {}, new Map([['T1-O', owner]]));
    assert.match(out, /^- \*\*Arc\*\*: verdict=wait /m);
    assert.equal(row(out), `| [-] | T1-O | STOP (lease live) | - |  |  |  | 0/2 blocks=0 nv=0 | 0/1 |  |  | ownership: lease held by win-B; the goal waits on owner win-B until ${expiresAt} |`);
  });

  it('T0-BOARD-OWNER-WAIT acceptance 4: without owners a run stopped for ownership renders the stop as before [R3]', () => {
    const out = renderBoard(goal, cards, runs, iso());
    assert.match(out, /^- \*\*Arc\*\*: verdict=stop /m);
    assert.ok(row(out).startsWith('| [S] | T1-O | STOP |'), row(out));
    assert.ok(row(out).endsWith('| ownership: lease held by win-B |'), row(out));
  });
});
