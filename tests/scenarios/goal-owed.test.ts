// Card T1-GOAL-OWED (issue 300): a goal write and its event survive a failure of either, and the recovery leaves each event once.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs, { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, driveCardToDone, actorB, type Fixture } from './_harness.ts';
import { runCliInProcess } from '../infra/cli-inprocess.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';
import { DEFAULT_LEASE_TTL_MS } from '../../src/coordination/lease.ts';
import { makeStop } from '../../src/core/stop.ts';
import { HOUR_MS, MAX_INTEGRATION_REPAIR_CYCLES, MAX_PLANNING_INVOCATIONS, ReleaseAttempt, type Goal } from '../../src/core/types.ts';
import { GoalController } from '../../src/loop/controller.ts';
import type { ReportInput } from '../../src/loop/directive.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { GoalStore } from '../../src/state/goal-store.ts';

const CARD = 'T1-A';
const LATER = '2026-12-31T00:00:00.000Z';

/**
 * The calls of one command on one goal, in order: `record 1`, `append GOAL_STATE 1` and so on, the number counting the calls of that
 * name. The call named `fail` throws before it takes effect.
 */
const watch: { goal?: string; journal?: string; calls: string[]; fail?: string } = { calls: [] };
/** Another command: `run` is called once, right after the next read of the file `at`. */
const overlap: { at?: string; run?: () => void } = {};
const real = { append: fs.appendFileSync, rename: fs.renameSync, read: fs.readFileSync };
function called(name: string): void {
  const call = `${name} ${watch.calls.filter((c) => c.startsWith(`${name} `)).length + 1}`;
  watch.calls.push(call);
  if (call === watch.fail) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
}
before(() => {
  const target = fs as unknown as Record<string, unknown>;
  target['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    if (watch.journal && path.resolve(String(args[0])) === watch.journal) called(`append ${(JSON.parse(String(args[1])) as { type: string }).type}`);
    return real.append(...args);
  };
  target['renameSync'] = (from: fs.PathLike, to: fs.PathLike) => {
    if (watch.goal && path.resolve(String(to)) === watch.goal) called('record');
    return real.rename(from, to);
  };
  target['readFileSync'] = (...args: Parameters<typeof fs.readFileSync>) => {
    const out = real.read(...args);
    if (overlap.at && typeof args[0] === 'string' && path.resolve(args[0]) === path.resolve(overlap.at)) {
      overlap.at = undefined;
      overlap.run!();
    }
    return out;
  };
  syncBuiltinESMExports();
});
after(() => {
  Object.assign(fs, { appendFileSync: real.append, renameSync: real.rename, readFileSync: real.read });
  syncBuiltinESMExports();
  setActorForTests(undefined);
});

const journalFile = (fx: Fixture, id: string) => path.resolve(fx.paths.journal, `${id}.jsonl`);
/** Runs `act` with the call `fail` failing, and returns its calls and its error. */
function watched(fx: Fixture, id: string, act: () => void, fail?: string): { calls: string[]; error?: Error } {
  Object.assign(watch, { goal: path.resolve(fx.store.goalFile(id)), journal: journalFile(fx, id), calls: [], fail });
  try {
    act();
    return { calls: watch.calls };
  } catch (err) {
    return { calls: watch.calls, error: err as Error };
  } finally {
    Object.assign(watch, { goal: undefined, journal: undefined, fail: undefined });
  }
}

const report = (fx: Fixture, id: string, result: ReportInput['result'], data: Record<string, unknown> = {}, extra: Partial<ReportInput> = {}) => void fx.controller.report({ goalId: id, generation: 0, result, data, ...extra });
const cancel = (fx: Fixture, id: string) => report(fx, id, 'cancel', { detail: 'stopped by the user' });
const resume = (fx: Fixture, id: string) => report(fx, id, 'resume', { reason: 'the owner continues' });
const extend = (fx: Fixture, id: string) => void fx.controller.extendDeadline(id, 'the owner', LATER, 'more time');
const next = (fx: Fixture, id: string) => void fx.controller.next(id);

/** A one-card goal in RUN. */
function running(fx: Fixture, options: Parameters<typeof goalForCards>[2] = {}): Goal {
  writeCard(fx, { id: CARD, title: 'a', allowPaths: ['src/a.ts'] });
  return goalForCards(fx, [CARD], options);
}
const at = (state: Goal['state']) => (fx: Fixture) => fx.store.saveGoal({ ...running(fx), state });
function cancelled(fx: Fixture): Goal {
  const g = running(fx);
  cancel(fx, g.id);
  return fx.goal(g.id);
}
function stoppedForTime(fx: Fixture): Goal {
  const g = running(fx);
  fx.advance(4 * HOUR_MS);
  assert.equal(fx.controller.next(g.id).kind, 'stop');
  return fx.goal(g.id);
}
/** In `state`, with its card closed. */
const closed = (state: Goal['state']) => (fx: Fixture) => {
  const g = running(fx);
  driveCardToDone(fx, g.id, CARD);
  return fx.store.saveGoal({ ...fx.goal(g.id), state, ...(state === 'CLOSE' ? { stages: { ...g.stages, development: 'pass' as const } } : {}) });
};
const planning = (fx: Fixture) => fx.controller.createGoal({ text: 'build the hello feature', source: 'natural-language', affectedSurfaces: [], explicitSize: 'T1' });
function withRun(fx: Fixture): Goal {
  const g = running(fx);
  fx.controller.ensureCardRun(g, CARD);
  return g;
}
/** In DELIVER, with a release attempt. */
function delivering(fx: Fixture): Goal {
  const g = running(fx, { target: 'staging' });
  fx.store.saveRelease(ReleaseAttempt.parse({ id: `rel-${g.id}-1`, goalId: g.id, generation: 0, target: 'staging', state: 'PREPARE', startedAt: fx.now(), deadline: LATER, updatedAt: fx.now() }));
  return fx.store.saveGoal({ ...fx.goal(g.id), state: 'DELIVER', stages: { ...g.stages, development: 'pass' } });
}
/** Stopped for time by a card that is stopped for time, inside the goal deadline (the case of deadline.test.ts:230). */
function stoppedByCard(fx: Fixture): Goal {
  const g = running(fx);
  const run = fx.controller.ensureCardRun(g, CARD);
  fx.store.saveCardRun({ ...run, state: 'STOP', stop: makeStop('time', 'card deadline passed', 'extend the deadline', { at: fx.now(), global: false }) });
  assert.equal(fx.controller.next(g.id).kind, 'stop');
  return fx.goal(g.id);
}

/** The goal record and the goal events, without what differs between two fixtures (ids, the repository path, real times) and without the marks of a recovery. */
function view(fx: Fixture, id: string): unknown {
  const { updatedAt: _u, repository: _r, ...record } = fx.goal(id);
  const events = fx.events(id).filter((e) => /^(GOAL_|PLAN_)/.test(e.type) || ['CARDS_PROJECTED', 'AUTHORIZATION_GRANTED'].includes(e.type) || (e.type === 'NOTE' && e.data['extension']));
  const ops = fx.ops.list({ goalId: id }).map((o) => o.id);
  let text = JSON.stringify({ record, events: events.map(({ type, generation, data: { eventKey: _k, completed: _c, ...data } }) => [type, generation, data]) }).replaceAll(id, 'G').replaceAll(fx.repo.key, 'R').replace(/-r(\d+)-[0-9a-f]{4}"/g, '-r$1"');
  for (const op of ops) text = text.replaceAll(op, 'OP');
  return JSON.parse(text);
}
/** The chain of the goal journal and what `aidlc audit verify` counts after a terminal disposition; no two events carry one key. */
function assertSound(fx: Fixture, id: string, where: string): void {
  const journal = fx.journal(id);
  assert.deepEqual(journal.verify().problems, [], where);
  assert.deepEqual(verifyAudit({ goalId: id, journal, operations: fx.ops, now: fx.now() }).findings.filter((f) => ['WORK_AFTER_TERMINAL', 'JOURNAL_CHAIN'].includes(f.code)), [], where);
  const keys = journal.readAll().map((e) => e.data['eventKey']).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length, `${where}: an event key twice`);
}

type Act = (fx: Fixture, id: string) => void;
/** `faults`: each call of the command that can fail, with its recovery: `next`, or `again` for the same command. */
type Row = [name: string, setup: (fx: Fixture) => Goal, act: Act, faults: Record<string, 'next' | 'again'>];

/** Fails each call of each row in turn, and compares the recovered goal with a twin whose command did not fail. */
function checkRows(rows: Row[]): void {
  for (const [name, setup, act, faults] of rows) {
    const twin = makeFixture();
    try {
      const whole = setup(twin);
      const { calls, error } = watched(twin, whole.id, () => act(twin, whole.id));
      assert.equal(error, undefined, name);
      const expected = view(twin, whole.id);
      for (const [fail, recovery] of Object.entries(faults)) {
        const where = `${name}, ${fail} fails, ${recovery}`;
        const fx = makeFixture();
        try {
          const { id } = setup(fx);
          assert.match(watched(fx, id, () => act(fx, id), fail).error?.message ?? 'no error', /EIO: injected/, where);
          assertSound(fx, id, `${where}: before the recovery`);
          if (recovery === 'again') act(fx, id);
          else next(fx, id);
          assert.deepEqual(view(fx, id), expected, where);
          assertSound(fx, id, where);
          // The goal goes on: a card it admits is dispatched, and nothing is appended twice later.
          if (!fx.goal(id).terminal && fx.controller.next(id).kind === 'run-card') {
            fx.controller.ensureCardRun(fx.goal(id), CARD);
            assert.equal(fx.events(id).at(-1)!.type, 'CARD_DISPATCHED', where);
          }
          const events = fx.events(id).length;
          next(fx, id);
          assert.equal(fx.events(id).length, events, `${where}: a further next appends nothing`);
          assertSound(fx, id, `${where}: after a dispatch`);
        } finally {
          fx.cleanup();
        }
      }
      assert.deepEqual([...calls].sort(), Object.keys(faults).sort(), `${name}: every call is failed`);
    } finally {
      setActorForTests(undefined);
      twin.cleanup();
    }
  }
}

const STOPPED = { 'record 1': 'again', 'append GOAL_STOPPED 1': 'next' } as const;

test('T1-GOAL-OWED acceptance 1 and 2: an owner act survives a failure of its event or of its record, and the recovery leaves each event once [R1] [R2] [R3] [R4] [R5]', () => {
  checkRows([
    ['a cancellation', running, cancel, STOPPED],
    ['an extension of a running goal', running, extend, { 'record 1': 'again', 'append NOTE 1': 'next' }],
    ['an extension of a time stop', stoppedForTime, extend, { 'append NOTE 1': 'again', 'append GOAL_STATE 1': 'again', 'record 1': 'again' }],
    ['a resume', cancelled, resume, { 'append GOAL_TAKEOVER 1': 'again', 'record 1': 'again', 'record 2': 'next' }],
    ['a resume that carries a revision', cancelled, (fx, id) => report(fx, id, 'resume', { reason: 'again', text: 'print hello twice', cards: [CARD] }), { 'append GOAL_TAKEOVER 1': 'again', 'append GOAL_REVISED 1': 'again', 'record 1': 'again', 'record 2': 'next', 'append GOAL_STATE 1': 'next' }],
    ['a resume whose derived stop follows', stoppedByCard, resume, { 'append GOAL_TAKEOVER 1': 'again', 'record 1': 'again', 'record 2': 'next', 'append GOAL_STOPPED 1': 'next' }],
    ['a revision', running, (fx, id) => report(fx, id, 'revision', { text: 'print hello twice' }), { 'record 1': 'again', 'append GOAL_REVISED 1': 'next' }],
    ['an approval', running, (fx, id) => report(fx, id, 'approved', { kind: 'development', by: 'a lead' }), { 'record 1': 'again', 'append AUTHORIZATION_GRANTED 1': 'next' }],
    ['a rejection', at('CARDS'), (fx, id) => report(fx, id, 'rejected', { detail: 'no' }), STOPPED],
  ]);
});

test('T1-GOAL-OWED acceptance 1 and 2: each result of aidlc report survives the same failures [R1] [R3] [R4] [R5]', () => {
  const release = (patch: Record<string, unknown>): Act => (fx, id) => report(fx, id, 'release-result', patch, { attemptId: `rel-${id}-1` });
  const arcFailed: Act = (fx, id) => report(fx, id, 'arc-failed', { repairCards: [CARD], detail: 'the flow fails' });
  checkRows([
    ['intent-accepted', planning, (fx, id) => report(fx, id, 'intent-accepted', { by: 'the owner' }), { 'record 1': 'again', 'append PLAN_ACCEPTED 1': 'next' }],
    ['plan-produced', planning, (fx, id) => report(fx, id, 'plan-produced', { planRef: 'plans/a.md' }), { 'record 1': 'again', 'append PLAN_INVOKED 1': 'next' }],
    ['plan-failed', planning, (fx, id) => report(fx, id, 'plan-failed', { detail: 'no' }), { 'record 1': 'again', 'append PLAN_INVOKED 1': 'next' }],
    ['cards-projected', at('PLAN'), (fx, id) => report(fx, id, 'cards-projected', { cards: [CARD] }), { 'record 1': 'again', 'append CARDS_PROJECTED 1': 'next', 'record 2': 'next', 'append GOAL_STATE 1': 'next' }],
    ['card-result', withRun, (fx, id) => report(fx, id, 'card-result', { state: 'BUILD' }, { cardId: CARD }), { 'record 1': 'again', 'append CARD_RESULT 1': 'next', 'record 2': 'next' }],
    ['arc-verified', closed('VERIFY_ARC'), (fx, id) => report(fx, id, 'arc-verified', { evidence: 'the flow runs' }), { 'record 1': 'again', 'append GOAL_STATE 1': 'next', 'record 2': 'next', 'append GOAL_DONE 1': 'next' }],
    ['arc-failed, a repair left', at('VERIFY_ARC'), arcFailed, { 'record 1': 'again', 'append GOAL_STATE 1': 'next', 'record 2': 'next', 'append GOAL_STATE 2': 'next' }],
    ['arc-failed, no repair left', (fx) => fx.store.saveGoal({ ...running(fx), state: 'VERIFY_ARC', counters: { planningInvocations: 0, integrationRepairCycles: MAX_INTEGRATION_REPAIR_CYCLES } }), arcFailed, STOPPED],
    ['release-result, the goal goes on', delivering, release({ state: 'STAGE' }), { 'record 1': 'again', 'append RELEASE_STATE 1': 'next' }],
    ['release-result, the release stopped', delivering, release({ state: 'STOP' }), { ...STOPPED, 'append RELEASE_STATE 1': 'next' }],
    ['release-result, the release recovered', delivering, release({ state: 'DONE', disposition: 'recovered' }), { ...STOPPED, 'append RELEASE_STATE 1': 'next' }],
  ]);
});

test('T1-GOAL-OWED acceptance 1 and 2: each derived write of aidlc next survives the same failures, and aidlc next recovers it [R1] [R3] [R4] [R5]', () => {
  const stop = { 'record 1': 'next', 'append GOAL_STOPPED 1': 'next' } as const;
  const state = { 'record 1': 'next', 'append GOAL_STATE 1': 'next' } as const;
  const done = { 'record 1': 'next', 'append GOAL_DONE 1': 'next' } as const;
  checkRows([
    ['CARDS to RUN', at('CARDS'), next, state],
    ['RUN to WAIT', (fx) => {
      const g = withRun(fx);
      fx.store.updateCardRun(g.id, CARD, (r) => ({ ...r!, state: 'SHIP' }));
      return g;
    }, next, { 'record 1': 'next' }],
    ['WAIT to RUN', at('WAIT'), next, { 'record 1': 'next' }],
    ['RUN to VERIFY_ARC', closed('RUN'), next, state],
    ['WAIT to VERIFY_ARC', closed('WAIT'), next, { ...state, 'record 2': 'next', 'append GOAL_STATE 2': 'next' }],
    ['DELIVER to CLOSE', (fx) => {
      const g = running(fx, { target: 'staging' });
      driveCardToDone(fx, g.id, CARD);
      fx.store.saveRelease(ReleaseAttempt.parse({ id: `rel-${g.id}-1`, goalId: g.id, generation: 0, target: 'staging', state: 'DONE', disposition: 'delivered', startedAt: fx.now(), deadline: LATER, updatedAt: fx.now() }));
      return fx.store.saveGoal({ ...fx.goal(g.id), state: 'DELIVER', stages: { ...g.stages, development: 'pass' } });
    }, next, { ...done, 'record 2': 'next' }],
    ['CLOSE to DONE', closed('CLOSE'), next, done],
    ['CLOSE to DONE under an expired lease of another session', (fx) => {
      const g = closed('CLOSE')(fx);
      fx.advance(DEFAULT_LEASE_TTL_MS + 1000);
      setActorForTests(actorB);
      return g;
    }, next, { ...done, 'append NOTE 1': 'next', 'append GOAL_TAKEOVER 1': 'next' }],
    ['the time stop', (fx) => {
      const g = running(fx);
      fx.advance(4 * HOUR_MS);
      return g;
    }, next, stop],
    ['the reconciliation stop', (fx) => {
      const g = running(fx);
      const op = fx.ops.recordIntent({ goalId: g.id, kind: 'merge', target: 'main', ownerGeneration: 0, timeoutMs: HOUR_MS }, fx.now());
      fx.ops.markIssued(op.id, undefined, fx.now());
      fx.advance(4 * HOUR_MS);
      return g;
    }, next, stop],
    ['the planning stop', (fx) => fx.store.saveGoal({ ...planning(fx), counters: { planningInvocations: MAX_PLANNING_INVOCATIONS, integrationRepairCycles: 0 } }), next, stop],
    ['the stop of an empty ready set', (fx) => {
      writeCard(fx, { id: 'T1-OPEN', title: 'open', allowPaths: ['src/open.ts'] });
      writeCard(fx, { id: CARD, title: 'a', dependsOn: ['T1-OPEN'], allowPaths: ['src/a.ts'] });
      const g = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [], explicitSize: 'T0' }, { cards: [CARD] });
      return fx.store.saveGoal({ ...g, state: 'RUN' });
    }, next, stop],
  ]);
});

test('T1-GOAL-OWED acceptance 1: a resume that landed, whose derived stop was not written, is recovered by aidlc next with one generation step and one GOAL_TAKEOVER [R4]', () => {
  for (const fail of ['record 2', 'append GOAL_STOPPED 1']) {
    const fx = makeFixture();
    try {
      const { id } = stoppedByCard(fx);
      assert.ok(watched(fx, id, () => resume(fx, id), fail).error, fail);
      assert.equal(fx.controller.next(id).kind, 'stop', fail);
      assert.deepEqual([fx.goal(id).generation, fx.goal(id).stop?.reason, fx.events(id).filter((e) => e.type === 'GOAL_TAKEOVER').length, fx.events(id).filter((e) => e.type === 'GOAL_STOPPED').length], [1, 'time', 1, 2], fail);
    } finally {
      fx.cleanup();
    }
  }
});

test('T1-GOAL-OWED acceptance 1: the next goal command that writes the goal appends an owed event once, marked completed, before its own [R3]', () => {
  const rows: Array<[name: string, setup: (fx: Fixture) => Goal, first: Act, owed: string, then: Act, own: string[]]> = [
    ['a resume after a cancellation', running, cancel, 'GOAL_STOPPED', resume, ['GOAL_TAKEOVER']],
    ['an extension after a time stop', (fx) => {
      const g = running(fx);
      fx.advance(4 * HOUR_MS);
      return g;
    }, next, 'GOAL_STOPPED', extend, ['NOTE', 'GOAL_STATE']],
    ['an approval after a revision', running, (fx, id) => report(fx, id, 'revision', { text: 'print hello twice' }), 'GOAL_REVISED', (fx, id) => report(fx, id, 'approved', { kind: 'development' }), ['AUTHORIZATION_GRANTED']],
    ['an extension after an extension', running, extend, 'NOTE', (fx, id) => void fx.controller.extendDeadline(id, 'the owner', '2027-01-31T00:00:00.000Z', 'more'), ['NOTE']],
  ];
  for (const [name, setup, first, owed, then, own] of rows) {
    const fx = makeFixture();
    try {
      const { id } = setup(fx);
      assert.ok(watched(fx, id, () => first(fx, id), `append ${owed} 1`).error, name);
      const held = fx.events(id).length;
      then(fx, id);
      const added = fx.events(id).slice(held);
      assert.deepEqual(added.map((e) => [e.type, e.data['completed']]), [[owed, true], ...own.map((type) => [type, undefined])], name);
      assertSound(fx, id, name);
    } finally {
      fx.cleanup();
    }
  }
});

test('T1-GOAL-OWED acceptance 1: a report that is refused leaves an owed event to the command that recovers it [R3]', () => {
  const fx = makeFixture();
  try {
    const { id } = running(fx);
    assert.ok(watched(fx, id, () => cancel(fx, id), 'append GOAL_STOPPED 1').error);
    const held = readFileSync(journalFile(fx, id), 'utf8');
    assert.throws(() => cancel(fx, id), /is terminal/);
    assert.equal(readFileSync(journalFile(fx, id), 'utf8'), held);
  } finally {
    fx.cleanup();
  }
});

test('T1-GOAL-OWED acceptance 1: aidlc next appends an owed event under the goal lock, so two of them append it once, and a held lock refuses it [R3] [R4]', () => {
  const fx = makeFixture();
  try {
    const { id } = running(fx);
    assert.ok(watched(fx, id, () => cancel(fx, id), 'append GOAL_STOPPED 1').error);
    const lock = `${fx.store.goalFile(id)}.lock`;
    writeFileSync(lock, `pid=${process.pid} at=${fx.now()} nonce=00000000`);
    const impatient = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 30 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry });
    const held = readFileSync(journalFile(fx, id), 'utf8');
    assert.throws(() => impatient.next(id), /locked by another writer/);
    assert.equal(readFileSync(journalFile(fx, id), 'utf8'), held);
    rmSync(lock);
    const record = readFileSync(fx.store.goalFile(id), 'utf8');
    // Another `next` lands right after the first one reads the journal.
    let landed = 0;
    Object.assign(overlap, { at: journalFile(fx, id), run: () => { next(fx, id); landed = fx.events(id).filter((e) => e.type === 'GOAL_STOPPED').length; } });
    assert.equal(fx.controller.next(id).kind, 'stop');
    assert.equal(landed, 1, 'the other next appended it');
    assert.equal(fx.events(id).filter((e) => e.type === 'GOAL_STOPPED').length, 1);
    assert.equal(readFileSync(fx.store.goalFile(id), 'utf8'), record, 'the record is not written again');
  } finally {
    overlap.at = undefined;
    fx.cleanup();
  }
});

test('T1-GOAL-OWED acceptance 1: a resume given again after it failed is compared with the stop it lifts, not with an earlier one [R2]', () => {
  const fx = makeFixture();
  try {
    const { id } = cancelled(fx);
    // The same extension input lifts two time stops: the second one journals its events too.
    resume(fx, id);
    const lift = () => void fx.controller.extendDeadline(id, 'the owner', LATER, 'more time');
    for (const n of [1, 2]) {
      fx.advance(4 * HOUR_MS);
      const g = fx.goal(id);
      fx.store.saveGoal({ ...g, deadlines: { ...g.deadlines, extensions: [] } });
      assert.equal(fx.controller.next(id).kind, 'stop');
      assert.equal(fx.goal(id).stop?.reason, 'time');
      lift();
      const readmissions = fx.events(id).filter((e) => e.type === 'GOAL_STATE' && e.data['from'] === 'STOP').length;
      assert.deepEqual([fx.goal(id).state, readmissions, fx.events(id).filter((e) => e.type === 'NOTE' && e.data['extension']).length], ['CARDS', n, n]);
      assertSound(fx, id, `lift ${n}`);
    }
    // After a DONE, whose generation a resume continues twice.
    const dn = makeFixture();
    try {
      const g = closed('CLOSE')(dn);
      assert.equal(dn.controller.next(g.id).kind, 'done');
      assert.ok(watched(dn, g.id, () => resume(dn, g.id), 'record 1').error);
      resume(dn, g.id);
      assert.deepEqual([dn.goal(g.id).generation, dn.events(g.id).filter((e) => e.type === 'GOAL_TAKEOVER' && e.data['linkedFrom']).length], [1, 1]);
    } finally {
      dn.cleanup();
    }
  } finally {
    fx.cleanup();
  }
});

test('T1-GOAL-OWED acceptance 1: a resume given with another reason after one that failed is journaled as the one that landed [R2]', () => {
  const fx = makeFixture();
  try {
    const { id } = cancelled(fx);
    assert.ok(watched(fx, id, () => resume(fx, id), 'record 1').error);
    report(fx, id, 'resume', { reason: 'another reason' });
    assert.deepEqual(fx.events(id).filter((e) => e.type === 'GOAL_TAKEOVER').map((e) => e.data['reason']), ['the owner continues', 'another reason']);
  } finally {
    fx.cleanup();
  }
});

test('T1-GOAL-OWED acceptance 1: aidlc goal cancel exits non-zero when its append fails, and aidlc next completes it [R4]', async () => {
  const fx = makeFixture();
  try {
    const { id } = running(fx);
    const env = { ...process.env, AIDLC_STATE_DIR: fx.paths.root };
    const cli = (...args: string[]) => runCliInProcess(args, { cwd: fx.tmp, env });
    Object.assign(watch, { journal: journalFile(fx, id), calls: [], fail: 'append GOAL_STOPPED 1' });
    const failed = await cli('goal', 'cancel', id);
    Object.assign(watch, { journal: undefined, fail: undefined });
    assert.notEqual(failed.status, 0, failed.stdout);
    assert.match(failed.stderr, /EIO: injected/);
    const recovered = await cli('next', '--goal', id);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.deepEqual(fx.events(id).filter((e) => e.type === 'GOAL_STOPPED').map((e) => e.data['completed']), [true]);
  } finally {
    Object.assign(watch, { journal: undefined, fail: undefined });
    fx.cleanup();
  }
});

test('T1-GOAL-OWED acceptance 3: a record stored with no journalOwed, as main writes it, is read and written, and the first write over it appends only its own events [R1]', () => {
  const fx = makeFixture();
  try {
    const { id } = running(fx);
    const file = fx.store.goalFile(id);
    const { journalOwed: _o, ...stored } = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    writeFileSync(file, JSON.stringify(stored));
    const held = fx.events(id).length;
    assert.equal(fx.controller.next(id).kind, 'run-card');
    assert.equal(fx.events(id).length, held, 'nothing is owed');
    cancel(fx, id);
    assert.deepEqual(fx.events(id).slice(held).map((e) => e.type), ['GOAL_STOPPED']);
    assert.deepEqual((JSON.parse(readFileSync(file, 'utf8')) as { journalOwed: Array<{ type: string }> }).journalOwed.map((o) => o.type), ['GOAL_STOPPED']);
  } finally {
    fx.cleanup();
  }
});
