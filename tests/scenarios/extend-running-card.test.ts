import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, T0, type Fixture } from './_harness.ts';
import { HOUR_MS, MINUTE_MS, addMs, type CardRun, type CardState, type JournalEvent } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { GoalStore } from '../../src/state/goal-store.ts';

// Card T0-EXTEND-RUNNING-CARD (issue 105): a deadline extension also moves the deadline of every card run of the current
// projection still in progress, and the run-card directive shows the stored card deadline.

/** The card-deadline NOTE entries of a journal, in journal order. */
const deadlineNotes = (events: JournalEvent[]) => events.filter((e) => e.type === 'NOTE' && e.data['cardDeadline'] !== undefined);
/** The index of the extension's own NOTE for `newDeadline`. */
const extensionAt = (events: JournalEvent[], newDeadline: string) =>
  events.findIndex((e) => e.type === 'NOTE' && (e.data['extension'] as { newDeadline?: string } | undefined)?.newDeadline === newDeadline);
/** Check the recovery receipt, then compare every pre-existing field apart from the deadline and store write fields. */
const settled = (after: CardRun, before: CardRun, extensionId: string) => {
  assert.deepEqual(after.lastExtension, { id: extensionId, fromState: before.state, fromDeadline: before.deadline, ...(before.stop ? { fromStopReason: before.stop.reason } : {}) });
  const { lastExtension, ...rest } = after;
  return { ...rest, ...(before.lastExtension ? { lastExtension: before.lastExtension } : {}), revision: before.revision, updatedAt: before.updatedAt };
};
const nextExtensionId = (fx: Fixture, goalId: string) => {
  const goal = fx.goal(goalId);
  return `${goal.id}@${goal.generation}/extension/${goal.storeRevision + 1}`;
};

/** A card at BUILD: PREPARE, then the build directive of attempt 1. */
function toBuild(fx: Fixture, goalId: string, cardId: string): CardRun {
  const runner = fx.runner();
  let r = runner.next(fx.goal(goalId), fx.card(cardId), fx.controller.ensureCardRun(fx.goal(goalId), cardId));
  r = runner.next(fx.goal(goalId), fx.card(cardId), r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  return r.run;
}

test('T0-EXTEND-RUNNING-CARD acceptance 1: a card in BUILD past its own deadline takes the new goal deadline, only its deadline changes, the NOTE follows the extension, and the card continues (issue 105) [R1]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    const goal = goalForCards(fx, ['T1-A'], { size: 'T1' });
    assert.equal(goal.deadlines.goalDeadline, addMs(T0, 12 * HOUR_MS), 'the arc limit applies, so the goal outlives the card limit');
    const built = toBuild(fx, goal.id, 'T1-A');
    assert.equal(built.deadline, addMs(T0, 3 * HOUR_MS), 'the card limit, fixed at its start');
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    const before = fx.store.getCardRun(goal.id, 'T1-A')!;
    const until = addMs(T0, 14 * HOUR_MS);
    const extensionId = nextExtensionId(fx, goal.id);
    const extended = fx.controller.extendDeadline(goal.id, 'lead', until, 'the reviews and the ship remain');
    assert.equal(extended.terminal, false);
    const after = fx.store.getCardRun(goal.id, 'T1-A')!;
    assert.deepEqual(settled(after, before, extensionId), { ...before, deadline: until }, 'only the deadline and verified recovery receipt change');
    assert.equal(after.revision, before.revision + 1, 'one write');
    const events = fx.events(goal.id);
    const notes = deadlineNotes(events);
    assert.deepEqual(notes.map((e) => [e.cardId, e.data['cardDeadline']]), [['T1-A', { from: before.deadline, to: until, by: 'lead' }]]);
    const at = extensionAt(events, until);
    assert.ok(at >= 0 && at < events.indexOf(notes[0]!), 'the extension is journaled before the card NOTE');
    const next = fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), after);
    assert.equal(next.directive.kind, 'build', `the card continues under the new deadline: ${next.directive.narration}`);
    assert.equal(next.run.stop, undefined, 'no time stop');
    assert.notEqual(fx.controller.next(goal.id).kind, 'stop', 'the goal continues');
  } finally {
    fx.cleanup();
  }
});

test('T0-EXTEND-RUNNING-CARD acceptance 1: a card whose deadline was capped by the old goal deadline takes the new one and is not stopped at the old goal deadline [R1]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    const goal = goalForCards(fx, ['T1-A']);
    assert.equal(goal.deadlines.goalDeadline, addMs(T0, 3 * HOUR_MS), 'one card: the 3 h limit');
    fx.advance(HOUR_MS);
    const built = toBuild(fx, goal.id, 'T1-A');
    assert.equal(built.deadline, addMs(T0, 3 * HOUR_MS), 'started an hour in, the card is capped by the goal deadline');
    fx.advance(HOUR_MS);
    const until = addMs(T0, 6 * HOUR_MS);
    fx.controller.extendDeadline(goal.id, 'lead', until, 'more time');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-A')!.deadline, until);
    fx.advance(HOUR_MS + MINUTE_MS);
    const next = fx.runner().next(fx.goal(goal.id), fx.card('T1-A'), fx.store.getCardRun(goal.id, 'T1-A')!);
    assert.equal(next.directive.kind, 'build', `past the old goal deadline the card continues: ${next.directive.narration}`);
    assert.notEqual(fx.controller.next(goal.id).kind, 'stop', 'the goal continues');
  } finally {
    fx.cleanup();
  }
});

test('T0-EXTEND-RUNNING-CARD acceptance 2: every state in progress is moved; DONE, a review stop and a later deadline keep their record and journal nothing; a time stop is re-admitted as before [R1]', () => {
  const fx = makeFixture();
  try {
    const moving: Array<[string, CardState]> = [['T1-PREPARE', 'PREPARE'], ['T1-BUILD', 'BUILD'], ['T1-SHIP', 'SHIP'], ['T1-REVIEW-FIX', 'REVIEW_FIX'], ['T1-WAIT', 'WAIT'], ['T1-CLOSE', 'CLOSE']];
    const kept = ['T1-DONE', 'T1-STOP-REVIEW', 'T1-LATER', 'T1-EQUAL'];
    const ids = [...moving.map(([id]) => id), ...kept, 'T1-STOP-TIME'];
    for (const id of ids) writeCard(fx, { id, title: id.toLowerCase() });
    const goal = goalForCards(fx, ids, { size: 'T1' });
    const store = (id: string, patch: Partial<CardRun>) => fx.store.saveCardRun({ ...fx.controller.ensureCardRun(fx.goal(goal.id), id), ...patch });
    for (const [id, state] of moving) store(id, { state });
    store('T1-DONE', { state: 'DONE' });
    store('T1-STOP-REVIEW', { state: 'STOP', stop: makeStop('review', 'second substantive block', 'adjudicate', { at: fx.now(), global: false }) });
    store('T1-LATER', { state: 'BUILD', deadline: addMs(T0, 30 * HOUR_MS) });
    store('T1-EQUAL', { state: 'BUILD', deadline: addMs(T0, 20 * HOUR_MS) });
    store('T1-STOP-TIME', { state: 'STOP', stop: makeStop('time', 'admission deadline reached', 'extend', { at: fx.now(), global: false }) });
    fx.advance(HOUR_MS);
    const before = new Map(ids.map((id) => [id, fx.store.getCardRun(goal.id, id)!]));
    const until = addMs(T0, 20 * HOUR_MS);
    const extensionId = nextExtensionId(fx, goal.id);
    fx.controller.extendDeadline(goal.id, 'lead', until, 'more time');
    for (const [id, state] of moving) {
      const after = fx.store.getCardRun(goal.id, id)!;
      assert.deepEqual(settled(after, before.get(id)!, extensionId), { ...before.get(id)!, deadline: until }, `${state}: only the deadline and verified recovery receipt change`);
    }
    for (const id of kept) assert.deepEqual(fx.store.getCardRun(goal.id, id), before.get(id), `${id}: the record is unchanged`);
    assert.equal(fx.store.getCardRun(goal.id, 'T1-LATER')!.deadline, addMs(T0, 30 * HOUR_MS), 'a deadline is never moved earlier');
    const readmitted = fx.store.getCardRun(goal.id, 'T1-STOP-TIME')!;
    assert.equal(readmitted.stop, undefined, 'the time stop is re-admitted as before');
    assert.equal(readmitted.state, 'BUILD');
    assert.equal(readmitted.deadline, until);
    const events = fx.events(goal.id);
    assert.ok(events.some((e) => e.type === 'CARD_STATE' && e.cardId === 'T1-STOP-TIME' && e.data['to'] === 'readmitted'), 'the re-admission is journaled');
    const notes = deadlineNotes(events);
    assert.deepEqual(notes.map((e) => e.cardId).sort(), moving.map(([id]) => id).sort(), 'one NOTE per moved run, none for any other');
    const at = extensionAt(events, until);
    assert.ok(at >= 0 && notes.every((e) => events.indexOf(e) > at), 'the goal first, then the cards');
    for (const e of notes) assert.deepEqual(e.data['cardDeadline'], { from: before.get(e.cardId!)!.deadline, to: until, by: 'lead' });
  } finally {
    fx.cleanup();
  }
});

test('T0-EXTEND-RUNNING-CARD acceptance 2: a run in BUILD of a card superseded by a replacement resume keeps its record; the projection\'s running card is moved [R1]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    writeCard(fx, { id: 'T1-B', title: 'b' });
    writeCard(fx, { id: 'T1-A2', title: 'a again, replacement', allowPaths: ['src/t1-a.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' });
    for (const id of ['T1-A', 'T1-B']) fx.store.saveCardRun({ ...fx.controller.ensureCardRun(fx.goal(goal.id), id), state: 'BUILD' });
    fx.advance(12 * HOUR_MS + MINUTE_MS);
    assert.equal(fx.controller.next(goal.id).kind, 'stop', 'the goal stops at its deadline');
    const resumed = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'card a replaced', text: 'continue with the replacement', replacements: { 'T1-A': 'T1-A2' } } });
    assert.equal(resumed.directive.kind, 'stop', `past its deadline the resumed goal stops for time again, which the extension re-admits: ${resumed.directive.narration}`);
    assert.deepEqual(fx.goal(goal.id).cards, ['T1-A2', 'T1-B']);
    const supersededBefore = fx.store.getCardRun(goal.id, 'T1-A')!;
    assert.equal(supersededBefore.state, 'BUILD', 'the superseded run is still in progress');
    const b = fx.store.getCardRun(goal.id, 'T1-B')!;
    const until = addMs(T0, 20 * HOUR_MS);
    const extensionId = nextExtensionId(fx, goal.id);
    fx.controller.extendDeadline(goal.id, 'lead', until, 'more time for the replacement');
    assert.deepEqual(fx.store.getCardRun(goal.id, 'T1-A'), supersededBefore, 'a card outside the current projection is untouched');
    assert.deepEqual(settled(fx.store.getCardRun(goal.id, 'T1-B')!, b, extensionId), { ...b, deadline: until }, 'the running card of the projection is moved');
    assert.deepEqual(deadlineNotes(fx.events(goal.id)).map((e) => e.cardId), ['T1-B']);
  } finally {
    fx.cleanup();
  }
});

test('T0-EXTEND-RUNNING-CARD acceptance 1: the run is read under the card-run lock, so a write that lands after the listing is kept: a changed field stays, a run stopped meanwhile and a deadline moved later meanwhile are not moved, a time stop landing meanwhile is re-admitted, and a time stop re-admitted meanwhile is moved (R2 cycle 0 round 1) [R1]', () => {
  const fx = makeFixture();
  try {
    const ids = ['T1-A', 'T1-B', 'T1-C', 'T1-D', 'T1-E'];
    for (const id of ids) writeCard(fx, { id, title: id.toLowerCase() });
    const goal = goalForCards(fx, ids, { size: 'T1' });
    for (const id of ids) fx.store.saveCardRun({ ...fx.controller.ensureCardRun(fx.goal(goal.id), id), state: 'BUILD' });
    const timeStop = () => makeStop('time', 'admission deadline reached', 'extend', { at: fx.now(), global: false });
    fx.store.updateCardRun(goal.id, 'T1-E', (current) => ({ ...current!, state: 'STOP', stop: timeStop() }));
    /** Another session's writes, landing between the extension's listing of the runs and its update of each. */
    const race = () => {
      fx.store.updateCardRun(goal.id, 'T1-A', (current) => ({ ...current!, worktree: 'D:/wt/raced', deadline: addMs(T0, 5 * HOUR_MS) }));
      fx.store.updateCardRun(goal.id, 'T1-B', (current) => ({ ...current!, state: 'STOP', stop: makeStop('review', 'second substantive block', 'adjudicate', { at: fx.now(), global: false }) }));
      fx.store.updateCardRun(goal.id, 'T1-C', (current) => ({ ...current!, deadline: addMs(T0, 30 * HOUR_MS) }));
      // A card next that read the old deadline stops T1-D for time; another session re-admits T1-E.
      fx.store.updateCardRun(goal.id, 'T1-D', (current) => ({ ...current!, state: 'STOP', stop: timeStop() }));
      fx.store.updateCardRun(goal.id, 'T1-E', (current) => ({ ...current!, state: 'BUILD', stop: undefined }));
    };
    let raced = false;
    class RacingStore extends GoalStore {
      override listCardRuns(goalId: string): CardRun[] {
        const listed = super.listCardRuns(goalId);
        // Once: the listing of the extension, not the board it writes afterwards.
        if (!raced) race();
        raced = true;
        return listed;
      }
    }
    const controller = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new RacingStore(fx.paths), leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry });
    fx.advance(HOUR_MS);
    const until = addMs(T0, 20 * HOUR_MS);
    controller.extendDeadline(goal.id, 'lead', until, 'more time');
    assert.ok(raced, 'the writes landed after the listing');
    const a = fx.store.getCardRun(goal.id, 'T1-A')!;
    assert.equal(a.deadline, until, 'the running card is moved');
    assert.equal(a.worktree, 'D:/wt/raced', 'the write that landed after the listing is kept');
    const b = fx.store.getCardRun(goal.id, 'T1-B')!;
    assert.equal(b.stop?.reason, 'review', 'the stop that landed after the listing is kept');
    assert.equal(b.deadline, addMs(T0, 3 * HOUR_MS), 'a run stopped meanwhile is not moved');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-C')!.deadline, addMs(T0, 30 * HOUR_MS), 'a deadline moved later meanwhile is not moved earlier');
    const d = fx.store.getCardRun(goal.id, 'T1-D')!;
    assert.deepEqual([d.state, d.stop, d.deadline], ['BUILD', undefined, until], 'a time stop that landed after the listing is re-admitted');
    const e = fx.store.getCardRun(goal.id, 'T1-E')!;
    assert.deepEqual([e.state, e.stop, e.deadline], ['BUILD', undefined, until], 'a time stop re-admitted after the listing is moved as a running card');
    const events = fx.events(goal.id);
    assert.deepEqual(events.filter((x) => x.type === 'CARD_STATE' && x.data['to'] === 'readmitted').map((x) => x.cardId), ['T1-D'], 'the re-admission is journaled for the run stopped under the lock');
    assert.deepEqual(deadlineNotes(events).map((x) => x.cardId), ['T1-A', 'T1-E'], 'only the moved runs are journaled');
    assert.deepEqual(deadlineNotes(events)[0]!.data['cardDeadline'], { from: addMs(T0, 5 * HOUR_MS), to: until, by: 'lead' }, 'the NOTE names the deadline read under the lock');
  } finally {
    fx.cleanup();
  }
});

test('T0-EXTEND-RUNNING-CARD acceptance 3: the run-card directive carries the stored card deadline after an extension; a card without a run gets the computed one [R2]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a' });
    const goal = goalForCards(fx, ['T1-A']);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A');
    assert.equal(run.state, 'PREPARE');
    assert.equal(run.deadline, addMs(T0, 3 * HOUR_MS));
    fx.advance(HOUR_MS);
    const until = addMs(T0, 6 * HOUR_MS);
    fx.controller.extendDeadline(goal.id, 'lead', until, 'more time');
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'run-card', d.narration);
    if (d.kind === 'run-card') assert.equal(d.cardDeadline, fx.store.getCardRun(goal.id, 'T1-A')!.deadline, 'the stored deadline');
    if (d.kind === 'run-card') assert.equal(d.cardDeadline, until);

    // A card without a run: its start is now, an hour in, so the card limit ends before the extended goal deadline.
    writeCard(fx, { id: 'T1-B', title: 'b' });
    const other = goalForCards(fx, ['T1-B']);
    fx.advance(HOUR_MS);
    fx.controller.extendDeadline(other.id, 'lead', addMs(fx.now(), 10 * HOUR_MS), 'more time');
    assert.equal(fx.store.getCardRun(other.id, 'T1-B'), undefined, 'no run yet');
    const fresh = fx.controller.next(other.id);
    assert.equal(fresh.kind, 'run-card', fresh.narration);
    if (fresh.kind === 'run-card') assert.equal(fresh.cardDeadline, addMs(fx.now(), 3 * HOUR_MS), 'the computed deadline: start plus the card limit');
  } finally {
    fx.cleanup();
  }
});

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

/** The sentences this card adds to docs/OPERATIONS.md (section Deadline extensions). */
const OPERATIONS_SENTENCES = [
  '## Deadline extensions',
  'An extension also moves the deadline of every card run of the goal\'s current projection still in progress (neither DONE nor stopped) to the new goal deadline when that is later, so the next `aidlc card next` continues the card instead of stopping it for time (card T0-EXTEND-RUNNING-CARD, issue 105).',
  'Each move is journaled as a `NOTE` naming the card and both deadlines, after the extension\'s own entries; a DONE run, a stop for any other reason, a card outside the current projection and a deadline already at or after the new one are left as they are, and no deadline is moved earlier.',
  'The extension takes no card lease: a card command that read the run before it and saves that snapshot afterwards is refused as stale (`CARD_RUN_STALE`) and is run again.',
  'The `run-card` directive\'s `cardDeadline` is the stored deadline of the card\'s run; only a card without a run gets the computed one.',
];
/** The phrase this card adds to docs/ARCHITECTURE.md (goal machine). */
const ARCHITECTURE_PHRASE =
  'and moves the deadline of every run of that projection still in progress to the new goal deadline when that is later (journaled as `NOTE`, card T0-EXTEND-RUNNING-CARD)';
/** The CHANGELOG entry, one line under Unreleased. */
const CHANGELOG_ENTRY =
  '- Extension moves running cards, card T0-EXTEND-RUNNING-CARD (issue 105): `aidlc goal extend` also moves the deadline of every card run of the goal\'s current projection still in progress (neither DONE nor stopped) to the new goal deadline when that is later, journaled as a `NOTE` naming the card and both deadlines, so the next `aidlc card next` no longer stops the card for time right after the extension; each run, a time-stopped one included, is decided on its record read under the card-run lock, so a time stop that lands during the extension is re-admitted and a concurrent write no longer fails the extension with `CARD_RUN_STALE`; the `run-card` directive\'s `cardDeadline` is the stored deadline of the card\'s run, where it used to be recomputed from the card\'s start.';

test('T0-EXTEND-RUNNING-CARD acceptance 4: docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md Unreleased state the rule [R3]', () => {
  const operations = read('docs', 'OPERATIONS.md');
  for (const sentence of OPERATIONS_SENTENCES) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  const section = operations.slice(operations.indexOf('## Deadline extensions'), operations.indexOf('\n## ', operations.indexOf('## Deadline extensions') + 1));
  assert.ok(section.includes('`aidlc goal extend <id> --until <iso> --by <who> --reason "..."` is the only way to move a deadline'), 'the extend bullet lives in the section');
  for (const sentence of OPERATIONS_SENTENCES.slice(1)) assert.ok(section.includes(sentence), `the Deadline extensions section states: ${sentence}`);
  assert.ok(read('docs', 'ARCHITECTURE.md').includes(ARCHITECTURE_PHRASE), `docs/ARCHITECTURE.md states: ${ARCHITECTURE_PHRASE}`);
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(unreleased.split('\n').includes(CHANGELOG_ENTRY), 'CHANGELOG.md Unreleased carries the entry');
});
