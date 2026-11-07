// Card T0-SIDE-WRITE-FAULTS: a failed side write beside a saved record. A lost CARD_DISPATCHED append is recovered once
// (issue 143), and a failed board write never loses a goal stop (issue 127).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs, { rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { makeFixture, writeCard, goalForCards, type Fixture } from './_harness.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { HOUR_MS, MINUTE_MS } from '../../src/core/types.ts';

const CARD = 'T1-SIDE';
const realAppend = fs.appendFileSync;
let failing: string | undefined;

/** The `failing` event type throws EIO at its journal append; every other append runs. */
before(() => {
  (fs as unknown as Record<string, unknown>)['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    if (failing && typeof args[1] === 'string' && args[1].includes(`"type":"${failing}"`)) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return realAppend(...args);
  };
  syncBuiltinESMExports();
});
after(() => {
  fs.appendFileSync = realAppend;
  syncBuiltinESMExports();
});

function opened(fx: Fixture) {
  writeCard(fx, { id: CARD, title: 'side writes' });
  const goal = goalForCards(fx, [CARD]);
  return { goalId: goal.id, g: () => fx.goal(goal.id), card: fx.card(CARD) };
}

/** `ensureCardRun` with the CARD_DISPATCHED append failing; the run stays saved. */
function lostDispatch(fx: Fixture, goalId: string): void {
  failing = 'CARD_DISPATCHED';
  try {
    assert.throws(() => fx.controller.ensureCardRun(fx.goal(goalId), CARD), /EIO/);
  } finally {
    failing = undefined;
  }
}

const dispatches = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'CARD_DISPATCHED');

test('T0-SIDE-WRITE-FAULTS acceptance 1: a fault-free dispatch journals one keyed event with no completed mark, and card next adds none [R1]', () => {
  const fx = makeFixture();
  try {
    const { goalId, g, card } = opened(fx);
    const run = fx.controller.ensureCardRun(g(), CARD);
    fx.runner().next(g(), card, run);
    const events = dispatches(fx, goalId);
    assert.equal(events.length, 1);
    assert.equal(typeof events[0]?.data['eventKey'], 'string');
    assert.equal(events[0]?.data['completed'], undefined);
  } finally {
    fx.cleanup();
  }
});

test('T0-SIDE-WRITE-FAULTS acceptance 2: a failed dispatch append leaves the saved run owing the event and the journal without it [R1] [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId } = opened(fx);
    lostDispatch(fx, goalId);
    const stored = fx.store.getCardRun(goalId, CARD);
    assert.deepEqual(stored?.journalOwed?.map((o) => o.type), ['CARD_DISPATCHED']);
    assert.equal(dispatches(fx, goalId).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('T0-SIDE-WRITE-FAULTS acceptance 3: a retry returns the same run and card next appends the event once, marked completed [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId, g, card } = opened(fx);
    lostDispatch(fx, goalId);
    const first = fx.store.getCardRun(goalId, CARD)!;
    const retried = fx.controller.ensureCardRun(g(), CARD);
    assert.equal(retried.startedAt, first.startedAt);
    const dry = fx.runner();
    const r = dry.next(g(), card, retried);
    const events = dispatches(fx, goalId);
    assert.equal(events.length, 1);
    assert.equal(events[0]?.data['completed'], true);
    dry.next(g(), card, r.run);
    assert.equal(dispatches(fx, goalId).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('T0-SIDE-WRITE-FAULTS acceptance 4: a recorded attempt as the first step also leaves exactly one event [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId, g, card } = opened(fx);
    lostDispatch(fx, goalId);
    fx.runner().recordAttempt(g(), card, fx.store.getCardRun(goalId, CARD)!, { outcome: 'fail', cause: 'red' });
    assert.equal(dispatches(fx, goalId).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('T0-SIDE-WRITE-FAULTS acceptance 5: a recovered dispatch counts at its startedAt against the last disposition [R3]', () => {
  const fx = makeFixture();
  try {
    const stoppedAt = '2026-09-11T02:00:00.000Z';
    const before = '2026-09-11T01:00:00.000Z';
    const later = '2026-09-11T03:00:00.000Z';
    const journal = fx.journal('g-recovered');
    const count = (): number => Number(verifyAudit({ goalId: 'g-recovered', journal, now: fx.now() }).findings.find((f) => f.code === 'WORK_AFTER_TERMINAL')?.detail.match(/^[0-9]+/)?.[0] ?? 0);
    const dispatch = (data: Record<string, unknown>, ts: string) => journal.append({ type: 'CARD_DISPATCHED', goalId: 'g-recovered', cardId: CARD, generation: 0, data: { childRef: 'c', ...data }, ts });
    journal.append({ type: 'GOAL_STOPPED', goalId: 'g-recovered', generation: 0, data: {}, ts: stoppedAt });
    dispatch({ startedAt: before, completed: true }, '2026-09-11T04:00:00.000Z');
    assert.equal(count(), 0, 'committed before the stop');
    dispatch({ startedAt: later, completed: true }, '2026-09-11T05:00:00.000Z');
    assert.equal(count(), 1, 'committed after the stop');
    dispatch({ startedAt: before }, '2026-09-11T06:00:00.000Z');
    assert.equal(count(), 2, 'not a recovered event');
  } finally {
    fx.cleanup();
  }
});

test('T0-SIDE-WRITE-FAULTS acceptance 6: a board write that fails beside a goal stop keeps the stop and journals a NOTE with the error code [R4]', () => {
  const fx = makeFixture();
  try {
    const { goalId } = opened(fx);
    rmSync(fx.paths.board, { recursive: true, force: true });
    writeFileSync(fx.paths.board, 'not a directory');
    fx.advance(3 * HOUR_MS + MINUTE_MS);
    const d = fx.controller.next(goalId);
    assert.equal(d.kind, 'stop', d.narration);
    const fresh = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, now: fx.now, cards: fx.registry });
    assert.equal(fresh.mustGoal(goalId).stop?.reason, 'time');
    const events = fx.events(goalId);
    assert.equal(events.filter((e) => e.type === 'GOAL_STOPPED').length, 1);
    const notes = events.filter((e) => e.type === 'NOTE' && typeof e.data['boardError'] === 'string');
    assert.equal(notes.length, 1);
    assert.match(String(notes[0]?.data['boardError']), /^E[A-Z]+$/);
  } finally {
    fx.cleanup();
  }
});
