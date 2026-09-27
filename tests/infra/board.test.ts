import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { outcomeOf, renderBoard } from '../../src/state/board.ts';
import { makeStop } from '../../src/core/stop.ts';
import { BoundName, JournalEvent } from '../../src/core/types.ts';
import { ProjectConfig } from '../../src/config.ts';
import { Journal } from '../../src/state/journal.ts';
import { goalForCards, makeFixture, writeCard } from '../scenarios/_harness.ts';
import { actor, cleanup, iso, makeCard, makeCardRun, makeGoal, tmpDir } from './helpers.ts';

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

describe('T1-BOUND-TELEMETRY: BOUND_FIRED and the Bounds line of the board', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
  const boundsLines = (board: string) => board.split('\n').filter((l) => l.includes('Bounds:'));

  it('acceptance 2: the bounds are the Limits table rows in its order, and a BOUND_FIRED payload that names no known bound fails to parse [R1]', () => {
    assert.deepEqual(BoundName.options, ['card-deadline', 'arc-deadline', 'reconciliation-grace', 'review-decisions', 'no-verdict-retry', 'ci-rerun-allowed', 'ci-rerun-denied', 'attempts', 'planning-invocations', 'integration-repair']);
    const event = (type: string, data: Record<string, unknown>) => ({ seq: 0, ts: iso(), type, goalId: 'g-1', generation: 0, actor: actor('win-A'), data, prevHash: '0'.repeat(64), hash: 'a'.repeat(64) });
    for (const bound of BoundName.options) assert.equal(JournalEvent.safeParse(event('BOUND_FIRED', { bound })).success, true, `${bound} parses`);
    for (const data of [{ bound: 'lifecycle-repair' }, { bound: 'card-workers' }, { bound: 'Card-Deadline' }, { bound: 'constructor' }, { bound: 1 }, { bound: ['attempts'] }, {}]) {
      assert.equal(JournalEvent.safeParse(event('BOUND_FIRED', data)).success, false, `${JSON.stringify(data)} names no known bound`);
    }
    assert.equal(JournalEvent.safeParse(event('NOTE', { bound: 'lifecycle-repair' })).success, true, 'the payload rule reads BOUND_FIRED events only');
    const dir = tmpDir();
    try {
      const journal = Journal.forGoal(dir, 'g-1');
      assert.throws(() => journal.append({ type: 'BOUND_FIRED', goalId: 'g-1', generation: 0, data: { bound: 'lifecycle-repair' } }), 'the append boundary refuses it');
      assert.equal(journal.readAll().length, 0, 'nothing is written');
      journal.append({ type: 'BOUND_FIRED', goalId: 'g-1', generation: 0, data: { bound: 'attempts' } });
      assert.deepEqual(journal.readAll().map((e) => e.data), [{ bound: 'attempts' }]);
    } finally {
      cleanup(dir);
    }
  });

  it('acceptance 3: the board prints one Bounds line over every goal journal: each fired bound in the fixed order, its count, and the first terminal event of the goal after each firing [R2]', () => {
    const fx = makeFixture();
    try {
      for (const id of ['T1-A', 'T1-B', 'T1-C', 'T1-Q']) writeCard(fx, { id, title: id.toLowerCase() });
      const quiet = goalForCards(fx, ['T1-Q']);
      assert.deepEqual(boundsLines(fx.controller.writeBoard(fx.goal(quiet.id))), ['Bounds: none fired'], 'no firing in any journal');
      const [a, b, c] = ['T1-A', 'T1-B', 'T1-C'].map((id) => goalForCards(fx, [id]).id) as [string, string, string];
      const fire = (goalId: string, bound: string) => fx.journal(goalId).append({ type: 'BOUND_FIRED', goalId, generation: 0, data: { bound } });
      const stop = (goalId: string, reason: string) => fx.journal(goalId).append({ type: 'GOAL_STOPPED', goalId, generation: 0, data: { reason, detail: 'fixture', nextAction: 'none', global: false } });
      const readmit = (goalId: string) => fx.journal(goalId).append({ type: 'GOAL_STATE', goalId, generation: 0, data: { from: 'STOP', to: 'CARDS', reason: 'deadline extension' } });
      const done = (goalId: string) => fx.journal(goalId).append({ type: 'GOAL_DONE', goalId, generation: 0, data: { cards: [], stages: {} } });
      // Goal a: the first terminal event after both firings is the time stop, not the DONE that follows the re-admission.
      fire(a, 'ci-rerun-allowed');
      fire(a, 'card-deadline');
      stop(a, 'time');
      readmit(a);
      done(a);
      // Goal b: a stop before the firing is no outcome of it.
      stop(b, 'time');
      readmit(b);
      fire(b, 'card-deadline');
      done(b);
      // Goal c: two firings end in a review stop; a firing after it stays open, since a GOAL_STOPPED without a stop reason is no terminal event.
      fire(c, 'card-deadline');
      fire(c, 'review-decisions');
      stop(c, 'review');
      fire(c, 'attempts');
      stop(c, 'not-a-stop-reason');
      const expected = 'Bounds: card-deadline 3 (DONE 1, STOP/review 1, STOP/time 1, open 0); review-decisions 1 (DONE 0, STOP/review 1, open 0); ci-rerun-allowed 1 (DONE 0, STOP/time 1, open 0); attempts 1 (DONE 0, open 1)';
      const board = fx.controller.writeBoard(fx.goal(quiet.id));
      assert.deepEqual(boundsLines(board), [expected], 'the board of a goal without firings counts every goal journal');
      assert.ok(board.split('\n').includes(expected), 'the line starts with Bounds:');
      assert.equal(readFileSync(path.join(fx.paths.board, `${quiet.id}.md`), 'utf8'), board, 'the board file carries the same line');
      assert.deepEqual(boundsLines(fx.controller.writeBoard(fx.goal(c))), [expected], 'every goal board carries the same line');
    } finally {
      fx.cleanup();
    }
  });

  it('acceptance 4: no config key is added and the board writes no path under .aidlc/ beyond its own board file [R3]', () => {
    assert.deepEqual(Object.keys(ProjectConfig.shape), ['schemaVersion', 'cardsDir', 'archiveDir', 'intentDir', 'specsDir', 'plansDir', 'evalsDir', 'worktreeRoot', 'base', 'mode', 'shipPath', 'reviewPool', 'reviewPolicyVersion', 'reviewer', 'gateRequired', 'cardPolicy', 'maxWorkers', 'family', 'provider', 'repository', 'userLimitMs', 'hooks', 'tierPaths', 'preReview', 'formalReview', 'github']);
    const fx = makeFixture();
    try {
      writeCard(fx, { id: 'T1-A', title: 'a' });
      const goal = goalForCards(fx, ['T1-A']);
      fx.journal(goal.id).append({ type: 'BOUND_FIRED', goalId: goal.id, generation: 0, data: { bound: 'attempts' } });
      const snapshot = () => new Map(readdirSync(fx.paths.root, { recursive: true, encoding: 'utf8' }).map((p) => path.join(fx.paths.root, p)).filter((f) => statSync(f).isFile()).map((f) => [path.relative(fx.paths.root, f), createHash('sha256').update(readFileSync(f)).digest('hex')] as const));
      const boardFile = path.join('board', `${goal.id}.md`);
      const before = snapshot();
      const text = fx.controller.writeBoard(fx.goal(goal.id));
      assert.deepEqual(boundsLines(text), ['Bounds: attempts 1 (DONE 0, open 1)']);
      assert.ok(existsSync(path.join(fx.paths.root, boardFile)), 'the board file is written where it is written today');
      const after = snapshot();
      before.delete(boardFile);
      after.delete(boardFile);
      assert.deepEqual(after, before, 'every other path under .aidlc/ is unchanged and none is added');
    } finally {
      fx.cleanup();
    }
  });

  it('acceptance 5: the README Limits table says the lifecycle repair bound is defined and not enforced [R4]', () => {
    const rows = read('README.md').split('\n').filter((l) => l.startsWith('| Integration / lifecycle repair cycles |'));
    assert.deepEqual(rows, ['| Integration / lifecycle repair cycles | 1 each; the integration repair bound is enforced, the lifecycle repair bound is defined and not enforced | `src/core/arc.ts`, `src/loop/controller.ts` |']);
  });

  it('acceptance 7: docs/OPERATIONS.md names BOUND_FIRED and the board line, and the CHANGELOG Unreleased section carries the entry [R1] [R2]', () => {
    const operations = read('docs', 'OPERATIONS.md');
    for (const sentence of [
      '- Each bound of the README Limits table journals one `BOUND_FIRED` event when it fires (card T1-BOUND-TELEMETRY), whose payload `{ bound }` names it: `card-deadline`, `arc-deadline`, `reconciliation-grace`, `review-decisions`, `no-verdict-retry`, `ci-rerun-allowed`, `ci-rerun-denied`, `attempts`, `planning-invocations` or `integration-repair`; an event that names another bound fails to parse. The worker cap is a cap, not a firing, and the lifecycle repair bound is defined and not enforced, so neither is journaled.',
      '- The board prints one line over every goal journal in the state directory, `Bounds: <bound> <n> (DONE a, STOP/<reason> b, open c); ...`: the fired bounds in that order, the number of firings of each, and for each firing the first terminal event of its goal after it (`GOAL_DONE` is DONE, `GOAL_STOPPED` is STOP with its reason, none yet is open). With no firing the line is `Bounds: none fired`.',
    ]) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    const entry = '- Bound telemetry, card T1-BOUND-TELEMETRY: each bound of the README Limits table journals one `BOUND_FIRED` event naming it when it fires (the card and arc deadlines, the reconciliation grace, the review decisions, the no-verdict retry, a CI rerun allowed or denied, the implementation attempts, the planning invocations and the integration repair cycle), and `aidlc board` prints one `Bounds:` line with the number of firings of each bound and the goal outcomes that followed them, so the defaults can be judged from data. The README Limits table says the lifecycle repair bound is defined and not enforced.';
    assert.ok(unreleased.includes(entry), `CHANGELOG.md Unreleased states: ${entry}`);
  });
});
