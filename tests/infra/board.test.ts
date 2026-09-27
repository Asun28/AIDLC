import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { boundsOfJournals, journalFiring, outcomeOf, renderBoard } from '../../src/state/board.ts';
import { makeStop } from '../../src/core/stop.ts';
import { BoundName, JournalEvent, boundFired } from '../../src/core/types.ts';
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
    for (const bound of BoundName.options) assert.equal(JournalEvent.safeParse(event('BOUND_FIRED', { bound, key: `g-1/-/${bound}/1` })).success, true, `${bound} parses`);
    for (const data of [{ bound: 'lifecycle-repair', key: 'k' }, { bound: 'card-workers', key: 'k' }, { bound: 'Card-Deadline', key: 'k' }, { bound: 'constructor', key: 'k' }, { bound: 1, key: 'k' }, { bound: ['attempts'], key: 'k' }, { key: 'k' }, { bound: 'attempts' }, { bound: 'attempts', key: '' }, { bound: 'attempts', key: 1 }]) {
      assert.equal(JournalEvent.safeParse(event('BOUND_FIRED', data)).success, false, `${JSON.stringify(data)} fails to parse`);
    }
    assert.equal(JournalEvent.safeParse(event('NOTE', { bound: 'lifecycle-repair' })).success, true, 'the payload rule reads BOUND_FIRED events only');
    const dir = tmpDir();
    try {
      const journal = Journal.forGoal(dir, 'g-1');
      assert.throws(() => journal.append({ type: 'BOUND_FIRED', goalId: 'g-1', generation: 0, data: { bound: 'lifecycle-repair', key: 'g-1/-/lifecycle-repair/1' } }), 'the append boundary refuses it');
      assert.throws(() => journal.append({ type: 'BOUND_FIRED', goalId: 'g-1', generation: 0, data: { bound: 'attempts' } }), 'a firing without its key is refused too');
      assert.equal(journal.readAll().length, 0, 'nothing is written');
      journal.append({ type: 'NOTE', goalId: 'g-1', generation: 0, data: { key: 'g-1/T1-A/attempts/3' } });
      for (let i = 0; i < 2; i += 1) journalFiring(journal, boundFired({ id: 'g-1', generation: 0 }, 'attempts', 3, 'T1-A'));
      journalFiring(Journal.forGoal(dir, 'g-new'), boundFired({ id: 'g-new', generation: 0 }, 'attempts', 1));
      assert.equal(Journal.forGoal(dir, 'g-new').readAll().length, 1, 'a journal not written yet is absent, not damaged (T1-BOUND-TELEMETRY-2)');
      assert.deepEqual(journal.readAll().filter((e) => e.type === 'BOUND_FIRED').map((e) => e.data), [{ bound: 'attempts', key: 'g-1@0/T1-A/attempts/3' }], 'one entry per key; an event of another type is no firing');
    } finally {
      cleanup(dir);
    }
  });

  it('acceptance 3: the board prints one Bounds line over every goal journal: each fired bound in the fixed order, its count, and the first terminal event of the goal after each firing [R2]', () => {
    const fx = makeFixture();
    try {
      for (const id of ['T1-A', 'T1-B', 'T1-C', 'T1-D', 'T1-Q']) writeCard(fx, { id, title: id.toLowerCase() });
      const quiet = goalForCards(fx, ['T1-Q']);
      assert.deepEqual(boundsLines(fx.controller.writeBoard(fx.goal(quiet.id))), ['Bounds: none fired'], 'no firing in any journal');
      const [a, b, c] = ['T1-A', 'T1-B', 'T1-C'].map((id) => goalForCards(fx, [id]).id) as [string, string, string];
      let seq = 0;
      const fire = (goalId: string, bound: string, key = `${goalId}/-/${bound}/${(seq += 1)}`) => fx.journal(goalId).append({ type: 'BOUND_FIRED', goalId, generation: 0, data: { bound, key } });
      const stop = (goalId: string, reason: string) => fx.journal(goalId).append({ type: 'GOAL_STOPPED', goalId, generation: 0, data: { reason, detail: 'fixture', nextAction: 'none', global: false } });
      const readmit = (goalId: string) => fx.journal(goalId).append({ type: 'GOAL_STATE', goalId, generation: 0, data: { from: 'STOP', to: 'CARDS', reason: 'deadline extension' } });
      const done = (goalId: string) => fx.journal(goalId).append({ type: 'GOAL_DONE', goalId, generation: 0, data: { cards: [], stages: {} } });
      // Goal a: the first terminal event after both firings is the time stop, not the DONE that follows the re-admission.
      fire(a, 'ci-rerun-allowed');
      fx.journal(a).append({ type: 'NOTE', goalId: a, generation: 0, data: { bound: 'attempts' } });
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
      fire(c, 'review-decisions', `${c}/T1-C/review-decisions/sha-c/2`);
      stop(c, 'review');
      fire(c, 'review-decisions', `${c}/T1-C/review-decisions/sha-c/2`); // a retry of the same firing after its save failed
      fire(c, 'attempts');
      stop(c, 'not-a-stop-reason');
      const expected = 'Bounds: card-deadline 3 (DONE 1, STOP/review 1, STOP/time 1, open 0); review-decisions 1 (DONE 0, STOP/review 1, open 0); ci-rerun-allowed 1 (DONE 0, STOP/time 1, open 0); attempts 1 (DONE 0, open 1)';
      const board = fx.controller.writeBoard(fx.goal(quiet.id));
      assert.deepEqual(boundsLines(board), [expected], 'the board of a goal without firings counts every goal journal');
      assert.ok(board.split('\n').includes(expected), 'the line starts with Bounds:');
      assert.equal(readFileSync(path.join(fx.paths.board, `${quiet.id}.md`), 'utf8'), board, 'the board file carries the same line');
      assert.deepEqual(boundsLines(fx.controller.writeBoard(fx.goal(c))), [expected], 'every goal board carries the same line');
      // R3 decision 1 F7: a journal with a line that does not parse keeps its readable firings and is named, never read as none fired.
      const broken = goalForCards(fx, ['T1-D']).id;
      fire(broken, 'arc-deadline');
      appendFileSync(fx.journal(broken).file, 'not a journal line\n', 'utf8');
      mkdirSync(path.join(fx.paths.journal, 'g-dir.jsonl')); // a journal that cannot be read at all
      appendFileSync(path.join(fx.paths.journal, '_host.jsonl'), 'not a journal line\n', 'utf8'); // the host journal is no goal journal
      const named = expected.replace('; review-decisions', '; arc-deadline 1 (DONE 0, open 1); review-decisions') + `; incomplete: lines that do not parse in "${broken}", "g-dir"`;
      assert.deepEqual(boundsLines(fx.controller.writeBoard(fx.goal(quiet.id))), [named]);
    } finally {
      fx.cleanup();
    }
  });

  it('R3 decision 1 F8: a goal record that does not parse blocks neither another goal\'s stop nor its Bounds line', () => {
    const fx = makeFixture();
    try {
      writeCard(fx, { id: 'T1-A', title: 'a' });
      const goal = goalForCards(fx, ['T1-A']);
      writeFileSync(path.join(fx.paths.goals, 'g-damaged.json'), '{ not json', 'utf8');
      Journal.forGoal(fx.paths.journal, 'g-orphan').append({ type: 'BOUND_FIRED', goalId: 'g-orphan', generation: 0, data: { bound: 'attempts', key: 'g-orphan/-/attempts/1' } }); // a journal without a goal record is read too
      fx.advance(3 * 3600_000 + 60_000);
      const kind = (() => {
        try {
          return fx.controller.next(goal.id).kind;
        } catch (err) {
          return String(err);
        }
      })();
      assert.equal(kind, 'stop', 'the goal deadline stop is saved');
      assert.equal(fx.goal(goal.id).terminal, true);
      assert.deepEqual(boundsLines(readFileSync(path.join(fx.paths.board, `${goal.id}.md`), 'utf8')), ['Bounds: arc-deadline 1 (DONE 0, STOP/time 1, open 0); attempts 1 (DONE 0, open 1); incomplete: pending firings or unreadable records in "g-damaged"'], 'the record that cannot be read is named (T1-BOUND-TELEMETRY-2)');
    } finally {
      fx.cleanup();
    }
  });

  it('R2 attempt 2 advisory: a journal directory that cannot be listed is named, never thrown out of the board', () => {
    const dir = tmpDir();
    try {
      const line = (journals: string) => {
        try {
          return boundsOfJournals(journals);
        } catch (err) {
          return String(err);
        }
      };
      writeFileSync(path.join(dir, 'journal'), '', 'utf8'); // exists, and listing it fails (ENOTDIR)
      assert.equal(line(path.join(dir, 'journal')), 'Bounds: none fired; incomplete: lines that do not parse in "journal"');
      assert.equal(line(path.join(dir, 'absent')), 'Bounds: none fired', 'a journal directory not yet created holds no firing');
    } finally {
      cleanup(dir);
    }
  });

  it('T1-BOUND-TELEMETRY-2 acceptance 8: a goal journal that cannot be read in full refuses the firing and keeps it pending, and the board names the goal and the journal; once readable, the next call journals it once and clears it [R2] [R6]', () => {
    const fx = makeFixture();
    try {
      writeCard(fx, { id: 'T1-A', title: 'a' });
      const goal = goalForCards(fx, ['T1-A']);
      const file = fx.journal(goal.id).file;
      writeFileSync(file, readFileSync(file, 'utf8').replace('\n', '\nnot a journal line\n'), 'utf8'); // its tail still appends
      fx.advance(3 * 3600_000 + 60_000);
      const stop = fx.controller.next(goal.id);
      assert.equal(stop.kind, 'stop');
      assert.match(stop.narration, /arc-deadline\/.* stays pending/, 'the command names the pending firing');
      assert.deepEqual([fx.goal(goal.id).terminal, fx.goal(goal.id).pendingFiring?.bound], [true, 'arc-deadline'], 'the stop is saved with its firing pending');
      assert.deepEqual(boundsLines(fx.controller.writeBoard(fx.goal(goal.id))), [`Bounds: none fired; incomplete: lines that do not parse in "${goal.id}"; pending firings or unreadable records in "${goal.id}"`]);
      assert.equal(fx.controller.next(goal.id).kind, 'stop', 'still refused: the stop stands');
      writeFileSync(file, readFileSync(file, 'utf8').replace('not a journal line\n', ''), 'utf8');
      const seen = fx.events(goal.id).length;
      assert.equal(fx.controller.next(goal.id).kind, 'stop');
      fx.controller.next(goal.id);
      assert.deepEqual(fx.events(goal.id).slice(seen).map((e) => [e.type, e.data['key']]), [['BOUND_FIRED', `${goal.id}@0/-/arc-deadline/${goal.deadlines.goalDeadline}`]], 'journaled once, before anything else');
      assert.equal(fx.goal(goal.id).pendingFiring, undefined, 'and cleared');
      assert.match(boundsLines(fx.controller.writeBoard(fx.goal(goal.id)))[0] ?? '', /^Bounds: arc-deadline 1 \([^;]*\)$/);
    } finally {
      fx.cleanup();
    }
  });

  it('T1-BOUND-TELEMETRY-2 acceptance 10: a journal file or directory that is a dangling link, or a directory that cannot be listed, is named as incomplete, while an absent one reads as none fired [R2]', (t) => {
    const dir = tmpDir();
    try {
      const journals = path.join(dir, 'journals');
      mkdirSync(journals);
      // A junction needs no privilege on Windows; elsewhere the type is ignored and a symbolic link is made.
      const dangling = (at: string) => {
        try {
          symlinkSync(path.join(dir, 'gone'), at, 'junction');
          return true;
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
          throw err;
        }
      };
      if (!dangling(path.join(journals, 'g-link.jsonl')) || !dangling(path.join(dir, 'linked'))) return t.skip('the platform refuses links (EPERM)');
      mkdirSync(path.join(journals, 'g-dir.jsonl')); // a directory where a journal file is expected
      writeFileSync(path.join(dir, 'file'), '', 'utf8'); // a file where the journal directory is expected
      assert.equal(boundsOfJournals(journals), 'Bounds: none fired; incomplete: lines that do not parse in "g-dir", "g-link"', 'a dangling journal file is named');
      assert.equal(boundsOfJournals(path.join(dir, 'linked')), 'Bounds: none fired; incomplete: lines that do not parse in "linked"', 'a dangling journal directory is named');
      assert.equal(boundsOfJournals(path.join(dir, 'file')), 'Bounds: none fired; incomplete: lines that do not parse in "file"');
      assert.equal(boundsOfJournals(path.join(dir, 'absent')), 'Bounds: none fired', 'an absent journal directory holds no firing');
      assert.equal(boundsOfJournals(path.join(dir, 'bad\0name')), 'Bounds: none fired; incomplete: lines that do not parse in "bad\\u0000name"', 'a path lstat refuses for another reason is named');
      mkdirSync(path.join(dir, 'cards', 'g-b'), { recursive: true });
      for (const [f, text] of [['journals/g-a.json', '{}'], ['journals/g-b.json', '{}'], ['journals/g-a.json.lock', 'pid=1'], ['cards/g-a', '']] as const) writeFileSync(path.join(dir, f), text, 'utf8');
      assert.equal(boundsOfJournals(path.join(dir, 'absent'), { goals: journals, cards: path.join(dir, 'cards') }), 'Bounds: none fired; incomplete: pending firings or unreadable records in "g-a"', 'a card-run directory that cannot be listed is named; a lock file is no record');
    } finally {
      cleanup(dir);
    }
  });

  it('acceptance 4: no config key is added and the board writes no path under .aidlc/ beyond its own board file [R3]', () => {
    assert.deepEqual(Object.keys(ProjectConfig.shape), ['schemaVersion', 'cardsDir', 'archiveDir', 'intentDir', 'specsDir', 'plansDir', 'evalsDir', 'worktreeRoot', 'base', 'mode', 'shipPath', 'reviewPool', 'reviewPolicyVersion', 'reviewer', 'gateRequired', 'cardPolicy', 'maxWorkers', 'family', 'provider', 'repository', 'userLimitMs', 'hooks', 'tierPaths', 'preReview', 'formalReview', 'github']);
    const fx = makeFixture();
    try {
      writeCard(fx, { id: 'T1-A', title: 'a' });
      const goal = goalForCards(fx, ['T1-A']);
      fx.journal(goal.id).append({ type: 'BOUND_FIRED', goalId: goal.id, generation: 0, data: { bound: 'attempts', key: `${goal.id}/T1-A/attempts/3` } });
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

  it('acceptance 14: docs/OPERATIONS.md names BOUND_FIRED, the outbox, the goal LOCKED refusal and the board line with its incomplete part, and the CHANGELOG Unreleased section carries the entry of card T1-BOUND-TELEMETRY-2 and the Changed entry [R1] [R2] [R5] [R7]', () => {
    const operations = read('docs', 'OPERATIONS.md');
    for (const sentence of [
      '- Each bound of the README Limits table journals one `BOUND_FIRED` event when it fires (card T1-BOUND-TELEMETRY-2), whose payload `{ bound, key }` names it: `card-deadline`, `arc-deadline`, `reconciliation-grace`, `review-decisions`, `no-verdict-retry`, `ci-rerun-allowed`, `ci-rerun-denied`, `attempts`, `planning-invocations` or `integration-repair`; an event that names another bound, or no key, fails to parse. The worker cap is a cap, not a firing, and the lifecycle repair bound is defined and not enforced, so neither is journaled.',
      '- A firing goes through an outbox: it is saved as `pendingFiring` on the card run or the goal record in the same write as the stop or state it causes, so a bound stop never waits on the journal. Right after that write, and at the start of every later `aidlc card next`, `aidlc next` and `aidlc report`, a second write under the same lock (the card-run lock, or the goal lock) journals the pending firing, only when the journal holds no `BOUND_FIRED` with the same key, and clears it. A journal that cannot be read in full refuses the append and nothing is written: the firing stays pending beside its stop, and the call answers with that stop, or a wait, naming the firing, never with a ship or a build.',
      '- The key names the firing from persisted facts only, never the clock: the goal and its generation (a resumed generation that the same bound stops again is a new firing), the card when there is one, the bound and the stored card or goal deadline, the candidate digest (review decisions, no-verdict retry, and for a CI rerun the digest and the number of reruns the ledger holds for the candidate, cancelled ones included, so a rerun granted again after a cancel is a new firing), the number of attempts recorded on the effort episode, the planning invocation count or the repair cycle count. A retry after a refused save journals nothing twice, and a later call on the stopped card or goal journals nothing.',
      '- Goal writes take the store lock, `<goal>.json.lock`, like card runs: a goal write while another writer holds it refuses with `StoreError` `LOCKED` naming the file and writes nothing, `aidlc goal extend` included, and the command run again succeeds once the lock is free. A goal stop is written only over a record that is not terminal, so of two overlapping calls only the one whose write landed journals the firing and `GOAL_STOPPED`.',
      '- The board prints one line over every goal journal in the state directory, `Bounds: <bound> <n> (DONE a, STOP/<reason> b, open c); ...`: the fired bounds in that order, the number of distinct firings of each, and for each firing the first terminal event of its goal after its first entry (`GOAL_DONE` is DONE, `GOAL_STOPPED` is STOP with its reason, none yet is open). With no firing the line is `Bounds: none fired`.',
      '- The line reads every goal journal file of the state directory, whatever the goal records say, one line at a time: a line that does not parse is left out and the Bounds line ends with `; incomplete: lines that do not parse in "<journal>"`, naming each such journal, so a damaged journal never reads as none fired and never blocks another goal or its stop. A journal file or directory that is a dangling link, or a directory that cannot be listed, is named the same way; only one that is absent reads as none fired.',
      '- The `incomplete:` part also names, after `pending firings or unreadable records in`, every goal whose goal record or card run holds a `pendingFiring`, or cannot be read, so a firing not yet journaled never reads as none fired.',
    ]) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
    const changelog = read('CHANGELOG.md');
    const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
    for (const entry of ['- Bound telemetry, card T1-BOUND-TELEMETRY-2 (replacing T1-BOUND-TELEMETRY): each bound of the README Limits table journals one `BOUND_FIRED` event naming it when it fires (the card and arc deadlines, the reconciliation grace, the review decisions, the no-verdict retry, a CI rerun allowed or denied, the implementation attempts, the planning invocations and the integration repair cycle), and `aidlc board` prints one `Bounds:` line with the number of firings of each bound and the goal outcomes that followed them, so the defaults can be judged from data. A firing is saved as `pendingFiring` in the same write as the stop or state it causes, an outbox, and journaled once per key right after that write or by the next `aidlc card next`, `aidlc next` or `aidlc report` once the journal reads in full, so a bound stop never waits on the journal and a retry neither loses nor doubles a firing; a CI rerun firing also counts the reruns of its candidate, so a rerun granted again after a cancel is its own firing. The board reads every goal journal file line by line and names a journal it cannot read in full, a dangling link included, and every goal whose firing is pending or whose record cannot be read. The README Limits table says the lifecycle repair bound is defined and not enforced.', '- Changed: goal writes now take the store lock, card T1-BOUND-TELEMETRY-2: the goal record is written under `<goal>.json.lock` like a card run, so a goal write while another writer holds the lock refuses with `StoreError` `LOCKED` and writes nothing, `aidlc goal extend` included, and a goal stop is written only over a record that is not terminal.']) assert.ok(unreleased.includes(entry), `CHANGELOG.md Unreleased states: ${entry}`);
  });
});
