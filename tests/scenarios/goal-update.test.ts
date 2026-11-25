// Card T1-GOAL-UPDATE (issue 300): every write of a goal record is one locked update decided on the record read inside it.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs, { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, driveCardToDone, actorB, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { StoreError } from '../../src/state/store.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import { HOUR_MS, MAX_PLANNING_INVOCATIONS, ReleaseAttempt, type Goal } from '../../src/core/types.ts';
import type { ReportInput } from '../../src/loop/directive.ts';

const CARD = 'T1-A';
const LATER = '2026-12-31T00:00:00.000Z';
const isCode = (code: string) => (err: unknown) => err instanceof StoreError && err.code === code;

/** Another command: `run` is called once, right after read number `nth` of the file `at` returns. */
const overlap: { at?: string; nth: number; run?: () => void } = { nth: 1 };
/** Called with each lock file right before its exclusive create. */
let onLock: ((file: string) => void) | undefined;
/** Called once, right before the next append onto a journal. */
let onAppend: (() => void) | undefined;
const real = { read: fs.readFileSync, open: fs.openSync, append: fs.appendFileSync };
before(() => {
  const target = fs as unknown as Record<string, unknown>;
  target['readFileSync'] = (...args: Parameters<typeof fs.readFileSync>) => {
    const out = real.read(...args);
    if (overlap.at && typeof args[0] === 'string' && path.resolve(args[0]) === path.resolve(overlap.at) && --overlap.nth === 0) {
      overlap.at = undefined;
      overlap.run!();
    }
    return out;
  };
  target['openSync'] = (...args: Parameters<typeof fs.openSync>) => {
    if (onLock && args[1] === 'wx' && String(args[0]).endsWith('.lock')) onLock(path.resolve(String(args[0])));
    return real.open(...args);
  };
  target['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    const run = onAppend;
    onAppend = undefined;
    run?.();
    return real.append(...args);
  };
  syncBuiltinESMExports();
});
after(() => {
  Object.assign(fs, { readFileSync: real.read, openSync: real.open, appendFileSync: real.append });
  syncBuiltinESMExports();
  setActorForTests(undefined);
});

const journalFile = (fx: Fixture, id: string) => path.join(fx.paths.journal, `${id}.jsonl`);
/** The goal record, the goal journal, the goal lease and the card run, as stored. */
const bytes = (fx: Fixture, id: string) => [fx.store.goalFile(id), journalFile(fx, id), fx.leases.file(resourceKeys.goal(fx.repo.key, id)), fx.store.cardFile(id, CARD)].map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : ''));
const report = (fx: Fixture, goalId: string, result: ReportInput['result'], data: Record<string, unknown> = {}, extra: Partial<ReportInput> = {}) => void fx.controller.report({ goalId, generation: 0, result, data, ...extra });
const cancel = (fx: Fixture, id: string) => report(fx, id, 'cancel', { detail: 'stopped by the user' });
const resume = (fx: Fixture, id: string) => report(fx, id, 'resume', { reason: 'the owner continues' });
const extend = (fx: Fixture, id: string) => void fx.controller.extendDeadline(id, 'the owner', LATER, 'more time');
const revise = (fx: Fixture, id: string) => report(fx, id, 'revision', { text: 'print hello twice' });
const approve = (fx: Fixture, id: string) => report(fx, id, 'approved', { kind: 'development', by: 'a lead' });
/** The runner of a fixture whose card R3 stopped, by the store every copy of the fixture shares. */
const runners = new WeakMap<GoalStore, CardRunner>();
/** `aidlc review rule` on the last unruled finding, through the real runner: it journals the ruling and lifts the stop. */
const rule = (fx: Fixture, id: string) => void fx.controller.ruleFinding(runners.get(fx.store)!, id, fx.card(CARD), 'F2', { decision: 'rejected', by: 'the owner', reason: 'the row exists' });
/** `aidlc card continue` through the real runner. */
const proceed = (fx: Fixture, id: string) => void fx.controller.continueCard(runners.get(fx.store)!, id, fx.card(CARD), { by: 'the owner', reason: 'one more decision' });

/** A one-card goal in RUN. */
function running(fx: Fixture): Goal {
  writeCard(fx, { id: CARD, title: 'a', allowPaths: ['src/a.ts'] });
  return goalForCards(fx, [CARD]);
}
const REVIEWED = { config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } };
const block = (texts: string[]): string => {
  const reasons = texts.map((text, i) => `[spec] 6 tests @ src/a.ts:${i + 1}: ${text}`);
  return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';
};
/** The same goal in STOP for review: R3 stopped its card at decision 2, and F1 of its two findings is ruled, so a ruling on F2 lifts the stop. */
async function stoppedForReview(fx: Fixture): Promise<Goal> {
  const goal = running(fx);
  const verdicts = [block(['no RED -> add one']), block(['still no RED (re:F1) -> add one', 'no doc row -> add one'])];
  const script = scriptedRunner({ 'git diff --name-only': () => ({ stdout: 'src/a.ts\u0000' }), 'git diff': () => ({ stdout: 'diff --git a/src/a.ts b/src/a.ts\n+export const x = 1;\n' }), 'fake-r3': () => ({ stdout: verdicts.shift()! }) });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  runners.set(fx.store, runner);
  const card = fx.card(CARD);
  const run = () => fx.store.getCardRun(goal.id, CARD)!;
  let r = runner.next(goal, card, fx.controller.ensureCardRun(goal, CARD));
  for (const n of [1, 2]) {
    r = runner.next(goal, card, runner.recordAttempt(goal, card, r.run, { outcome: 'success', dodReceipt: `dod:${n}`, redReceipt: 'red:1', candidateSha: `sha-${n}` }));
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    if (n === 2) runner.disputeFinding(goal, card, run(), 'F1', 'the row exists');
    r = runner.next(goal, card, (await runner.formalReview(goal, card, run())).run);
  }
  assert.deepEqual([run().state, run().stop?.reason], ['STOP', 'review']);
  assert.equal(fx.controller.next(goal.id).kind, 'stop');
  fx.controller.ruleFinding(runner, goal.id, card, 'F1', { decision: 'rejected', by: 'the owner', reason: 'the row exists' });
  assert.deepEqual([fx.goal(goal.id).state, fx.goal(goal.id).stop?.reason, run().state], ['STOP', 'review', 'STOP']);
  return fx.goal(goal.id);
}
/** The same goal in STOP for time. */
function stoppedForTime(fx: Fixture): Goal {
  const goal = running(fx);
  fx.advance(4 * HOUR_MS);
  fx.controller.next(goal.id);
  assert.equal(fx.goal(goal.id).stop?.reason, 'time');
  return fx.goal(goal.id);
}

/** The goal record and the events, without what differs between two fixtures: ids, the repository path and real times. */
function view(fx: Fixture, id: string): unknown {
  const { updatedAt: _u, repository: _r, ...record } = fx.goal(id);
  const plain = (v: unknown) => JSON.parse(JSON.stringify(v).replaceAll(id, 'G').replace(/-r(\d+)-[0-9a-f]{4}"/g, '-r$1"').replace(/"eventKey":"[^"]+"/g, '"eventKey":"K"'));
  return plain({ record, events: fx.events(id).map((e) => [e.type, e.generation, e.data]) });
}

type Act = (fx: Fixture, id: string) => void;
function attempt(act: () => void): string | undefined {
  try {
    act();
    return undefined;
  } catch (err) {
    return (err as Error).message;
  }
}

test('T1-GOAL-UPDATE acceptance 2: two owner acts on one goal leave what the two leave one after the other, or one is refused with nothing written [R3] [R4]', async () => {
  // `landed` runs whole after the first read of the goal by `first`. `refused`: the cause `first` is refused with.
  const rows: Array<[name: string, setup: (fx: Fixture) => Goal | Promise<Goal>, first: Act, landed: Act, refused?: RegExp]> = [
    ['an extension, a cancellation lands', running, extend, cancel],
    ['a cancellation, an extension lands', running, cancel, extend],
    ['a resume, a ruling lands', stoppedForReview, resume, rule, /resume applies only to a terminal goal/],
    ['a ruling, a resume lands', stoppedForReview, rule, resume, /changed since it was read.*run the command again/],
    ['a ruling, an extension lands', stoppedForReview, rule, extend, /changed since it was read.*run the command again/],
    ['a continuation, a resume lands', stoppedForReview, proceed, resume, /changed since it was read.*run the command again/],
    ['a revision, a cancellation lands', running, revise, cancel, /is terminal \(STOP\)/],
    ['a revision, an approval lands', running, revise, approve],
    ['a cancellation, a cancellation and a resume land', running, cancel, (fx, id) => { cancel(fx, id); resume(fx, id); }, /stale report: observed generation 0, current 1/],
    // The resume of a goal past its deadline stops it again for time, in generation 1, and the extension re-admits that stop.
    ['an extension, a resume lands', stoppedForTime, extend, resume],
    ['a resume, an extension lands', stoppedForTime, resume, extend, /resume applies only to a terminal goal/],
  ];
  for (const [name, setup, first, landed, refused] of rows) {
    const fx = makeFixture(setup === stoppedForReview ? REVIEWED : {});
    const twin = makeFixture(setup === stoppedForReview ? REVIEWED : {});
    try {
      const goal = await setup(fx);
      let after: string[] = [];
      Object.assign(overlap, { at: fx.store.goalFile(goal.id), nth: 1, run: () => { landed(fx, goal.id); after = bytes(fx, goal.id); } });
      const error = attempt(() => first(fx, goal.id));
      assert.notDeepEqual(after, [], `${name}: the other command ran`);
      if (refused) {
        assert.match(error ?? 'not refused', refused, name);
        assert.deepEqual(bytes(fx, goal.id), after, `${name}: the refused command wrote nothing`);
        continue;
      }
      assert.equal(error, undefined, name);
      const serial = await setup(twin);
      landed(twin, serial.id);
      first(twin, serial.id);
      assert.deepEqual(view(fx, goal.id), view(twin, serial.id), name);
      if (first === extend && landed === cancel) assert.deepEqual([fx.goal(goal.id).stop?.reason, fx.goal(goal.id).deadlines.extensions.length], ['cancelled', 1], `${name}: the cancellation stands and the extension is recorded`);
    } finally {
      overlap.at = undefined;
      fx.cleanup();
      twin.cleanup();
    }
  }
});

/** States from which `aidlc next` makes each of its derived writes. */
const derived: Array<[name: string, setup: (fx: Fixture) => Goal]> = [
  ['CARDS to RUN', (fx) => fx.store.saveGoal({ ...running(fx), state: 'CARDS' })],
  ['RUN to WAIT', (fx) => {
    const g = running(fx);
    fx.controller.ensureCardRun(g, CARD);
    fx.store.updateCardRun(g.id, CARD, (r) => ({ ...r!, state: 'SHIP' }));
    return g;
  }],
  ['WAIT to RUN', (fx) => fx.store.saveGoal({ ...running(fx), state: 'WAIT' })],
  ['RUN to VERIFY_ARC', (fx) => {
    const g = running(fx);
    driveCardToDone(fx, g.id, CARD);
    return g;
  }],
  ['WAIT to VERIFY_ARC', (fx) => {
    const g = running(fx);
    driveCardToDone(fx, g.id, CARD);
    return fx.store.saveGoal({ ...fx.goal(g.id), state: 'WAIT' });
  }],
  ['DELIVER to CLOSE', (fx) => {
    writeCard(fx, { id: CARD, title: 'a', allowPaths: ['src/a.ts'] });
    const g = goalForCards(fx, [CARD], { target: 'staging' });
    driveCardToDone(fx, g.id, CARD);
    fx.store.saveRelease(ReleaseAttempt.parse({ id: `rel-${g.id}-1`, goalId: g.id, generation: 0, target: 'staging', state: 'DONE', disposition: 'delivered', startedAt: fx.now(), deadline: LATER, updatedAt: fx.now() }));
    return fx.store.saveGoal({ ...fx.goal(g.id), state: 'DELIVER', stages: { ...g.stages, development: 'pass' } });
  }],
  ['CLOSE to DONE', (fx) => {
    const g = running(fx);
    driveCardToDone(fx, g.id, CARD);
    return fx.store.saveGoal({ ...fx.goal(g.id), state: 'CLOSE', stages: { ...g.stages, development: 'pass' } });
  }],
  ['CLOSE to DONE under an expired lease of another session', (fx) => {
    const g = running(fx);
    driveCardToDone(fx, g.id, CARD);
    const closing = fx.store.saveGoal({ ...fx.goal(g.id), state: 'CLOSE', stages: { ...g.stages, development: 'pass' } });
    fx.advance(DEFAULT_LEASE_TTL_MS + 1000);
    setActorForTests(actorB);
    return closing;
  }],
  ['the time stop', (fx) => {
    const g = running(fx);
    fx.advance(4 * HOUR_MS);
    return g;
  }],
  ['the reconciliation stop', (fx) => {
    const g = running(fx);
    const op = fx.ops.recordIntent({ goalId: g.id, kind: 'merge', target: 'main', ownerGeneration: 0, timeoutMs: HOUR_MS }, fx.now());
    fx.ops.markIssued(op.id, undefined, fx.now());
    fx.advance(4 * HOUR_MS);
    return g;
  }],
  ['the planning stop', (fx) => {
    const g = fx.controller.createGoal({ text: 'build the hello feature', source: 'natural-language', affectedSurfaces: [], explicitSize: 'T1' });
    return fx.store.saveGoal({ ...g, counters: { ...g.counters, planningInvocations: MAX_PLANNING_INVOCATIONS } });
  }],
  ['the stop of an empty ready set', (fx) => {
    writeCard(fx, { id: 'T1-OPEN', title: 'open', allowPaths: ['src/open.ts'] });
    writeCard(fx, { id: CARD, title: 'a', dependsOn: ['T1-OPEN'], allowPaths: ['src/a.ts'] });
    const g = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [], explicitSize: 'T0' }, { cards: [CARD] });
    return fx.store.saveGoal({ ...g, state: 'RUN' });
  }],
];

test('T1-GOAL-UPDATE acceptance 3: a derived write of aidlc next over a cancellation that landed since its read is refused with GOAL_STALE and journals nothing [R5]', () => {
  for (const [name, setup] of derived) {
    const fx = makeFixture();
    try {
      const goal = setup(fx);
      const written = fx.goal(goal.id).writes;
      let after: string[] = [];
      Object.assign(overlap, { at: fx.store.goalFile(goal.id), nth: 1, run: () => { cancel(fx, goal.id); after = bytes(fx, goal.id); } });
      assert.throws(() => fx.controller.next(goal.id), isCode('GOAL_STALE'), name);
      assert.notDeepEqual(after, [], `${name}: the cancellation landed`);
      assert.equal(fx.goal(goal.id).writes, written + 1, `${name}: the cancellation is the one write`);
      assert.equal(bytes(fx, goal.id)[0], after[0], `${name}: the goal record is the one the cancellation wrote`);
      const events = fx.events(goal.id);
      const late = events.slice(events.findLastIndex((e) => e.type === 'GOAL_STOPPED') + 1).map((e) => e.type);
      assert.deepEqual(late, [], `${name}: no event after the stop`);
      assert.equal(bytes(fx, goal.id)[2], after[2], `${name}: the goal lease is as it was`);
    } finally {
      overlap.at = undefined;
      fx.cleanup();
    }
  }
});

test('T1-GOAL-UPDATE acceptance 3: each state of those rows makes its derived write when no other command lands [R5]', () => {
  for (const [name, setup] of derived) {
    const fx = makeFixture();
    try {
      const goal = setup(fx);
      const written = fx.goal(goal.id).writes;
      fx.controller.next(goal.id);
      assert.ok(fx.goal(goal.id).writes > written, name);
    } finally {
      fx.cleanup();
    }
  }
});

test('T1-GOAL-UPDATE acceptance 4: a writer that does not get the goal lock is refused with LOCKED, with the goal record, the goal journal, the goal lease and the card run as they were [R6]', async () => {
  type Row = [name: string, setup: (fx: Fixture) => Goal | Promise<Goal>, act: Act];
  const reported = (result: ReportInput['result'], data: Record<string, unknown>, setup: Row[1] = running, extra: Partial<ReportInput> = {}): Row => [`report ${result}`, setup, (fx, id) => report(fx, id, result, data, extra)];
  const at = (state: Goal['state']) => (fx: Fixture) => fx.store.saveGoal({ ...running(fx), state });
  const withRun = (fx: Fixture) => {
    const g = running(fx);
    fx.controller.ensureCardRun(g, CARD);
    return g;
  };
  const verified = (fx: Fixture) => {
    const g = running(fx);
    driveCardToDone(fx, g.id, CARD);
    return fx.store.saveGoal({ ...fx.goal(g.id), state: 'VERIFY_ARC' });
  };
  const released = (fx: Fixture) => {
    const g = running(fx);
    fx.store.saveRelease(ReleaseAttempt.parse({ id: 'rel-1', goalId: g.id, generation: 0, target: 'staging', state: 'PREPARE', startedAt: fx.now(), deadline: LATER, updatedAt: fx.now() }));
    return g;
  };
  const rows: Row[] = [
    reported('intent-accepted', {}),
    reported('plan-produced', { planRef: 'plans/a.md' }),
    reported('plan-failed', { detail: 'no' }),
    reported('cards-projected', { cards: [CARD] }),
    reported('approved', { kind: 'development' }),
    reported('rejected', { detail: 'no' }, at('CARDS')),
    reported('card-result', { state: 'BUILD' }, withRun, { cardId: CARD }),
    reported('arc-verified', {}, verified),
    reported('arc-failed', { repairCards: [CARD] }, at('VERIFY_ARC')),
    reported('release-result', { state: 'STAGE' }, released, { attemptId: 'rel-1' }),
    reported('revision', { text: 'print hello twice' }),
    reported('cancel', {}),
    reported('resume', { reason: 'again' }, stoppedForReview),
    ['extendDeadline', running, extend],
    ['a ruling that lifts the stop', stoppedForReview, rule],
    ['a continuation', stoppedForReview, proceed],
    ...derived.map(([name, setup]): Row => [`next, ${name}`, setup, (fx, id) => void fx.controller.next(id)]),
  ];
  for (const [name, setup, act] of rows) {
    const fx = makeFixture(setup === stoppedForReview ? REVIEWED : {});
    try {
      const goal = await setup(fx);
      const held = `${fx.store.goalFile(goal.id)}.lock`;
      writeFileSync(held, `pid=${process.pid} at=${fx.now()} nonce=00000000`);
      const before = bytes(fx, goal.id);
      const impatient: Fixture = { ...fx, controller: new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 30 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry }) };
      assert.throws(() => act(impatient, goal.id), isCode('LOCKED'), name);
      assert.deepEqual(bytes(fx, goal.id), before, name);
      rmSync(held);
      const written = fx.goal(goal.id).writes;
      act(fx, goal.id);
      assert.ok(fx.goal(goal.id).writes > written, `${name}: with the lock free it writes the goal`);
    } finally {
      fx.cleanup();
    }
  }
});

test('T1-GOAL-UPDATE acceptance 5: the goal lock nests after the goal lease lock and before the card-run, card-lease and journal locks [R7]', () => {
  const ranks = ['goal-lease', 'goal', 'card-run', 'card-lease', 'journal'];
  const logged = (fx: Fixture, goalId: string, act: () => void): string[] => {
    const goalLease = path.resolve(fx.leases.file(resourceKeys.goal(fx.repo.key, goalId)));
    const kind = (lock: string): string => {
      const file = lock.slice(0, -'.lock'.length);
      const inside = (dir: string) => file.startsWith(path.resolve(dir) + path.sep);
      return inside(fx.paths.goals) ? 'goal' : inside(fx.paths.cards) ? 'card-run' : inside(fx.paths.journal) ? 'journal' : file === goalLease ? 'goal-lease' : inside(fx.paths.leases) ? 'card-lease' : 'other';
    };
    const seen = new Set<string>();
    const nested: string[] = [];
    onLock = (file) => {
      for (const held of seen) if (held !== file && existsSync(held)) {
        const [outer, inner] = [kind(held), kind(file)];
        nested.push(`${outer} > ${inner}`);
        assert.ok(ranks.indexOf(outer) < ranks.indexOf(inner), `${inner} taken inside ${outer}`);
      }
      seen.add(file);
    };
    try {
      act();
    } finally {
      onLock = undefined;
    }
    return nested;
  };
  const fx = makeFixture();
  try {
    writeCard(fx, { id: CARD, title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
    const goal = goalForCards(fx, [CARD, 'T1-B']);
    for (const id of [CARD, 'T1-B']) fx.controller.ensureCardRun(fx.goal(goal.id), id);
    const extension = logged(fx, goal.id, () => extend(fx, goal.id));
    assert.ok(extension.includes('goal > journal') && extension.includes('goal > card-run'), extension.join(', '));
    assert.ok(logged(fx, goal.id, () => report(fx, goal.id, 'cards-projected', { cards: [CARD, 'T1-B'] })).includes('goal > journal'));
  } finally {
    fx.cleanup();
  }
  const closing = makeFixture();
  try {
    const goal = derived.find(([name]) => name === 'CLOSE to DONE')![1](closing);
    const close = logged(closing, goal.id, () => assert.equal(closing.controller.next(goal.id).kind, 'done'));
    assert.ok(close.includes('goal-lease > goal'), close.join(', '));
  } finally {
    closing.cleanup();
  }
});

test('T1-GOAL-UPDATE acceptance 5: no registry loader runs while the goal lock is held [R7]', async () => {
  const verified = (fx: Fixture) => {
    const g = running(fx);
    driveCardToDone(fx, g.id, CARD);
    return fx.store.saveGoal({ ...fx.goal(g.id), state: 'VERIFY_ARC' });
  };
  const rows: Array<[result: ReportInput['result'], data: Record<string, unknown>, setup: (fx: Fixture) => Goal | Promise<Goal>]> = [
    ['cards-projected', { cards: [CARD] }, running],
    ['revision', { text: 'print hello twice' }, running],
    ['arc-verified', {}, verified],
    ['resume', { reason: 'again', text: 'print hello twice', cards: [CARD] }, stoppedForReview],
    ['plan-produced', { planRef: 'plans/a.md' }, (fx) => fx.store.saveGoal({ ...running(fx), state: 'PLAN' })],
    ['rejected', { detail: 'no' }, (fx) => fx.store.saveGoal({ ...running(fx), state: 'CARDS' })],
  ];
  for (const [result, data, setup] of rows) {
    const fx = makeFixture(setup === stoppedForReview ? REVIEWED : {});
    try {
      const goal = await setup(fx);
      const held: boolean[] = [];
      const cards = () => (held.push(existsSync(`${fx.store.goalFile(goal.id)}.lock`)), fx.registry());
      const controller = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards });
      report({ ...fx, controller }, goal.id, result, data);
      assert.ok(held.length > 0, `${result}: the registry was loaded`);
      assert.ok(!held.includes(true), `${result}: never inside the goal lock`);
    } finally {
      fx.cleanup();
    }
  }
});

test('T1-GOAL-UPDATE acceptance 5: a command that lands between the record write of a new goal and its first event is refused with LOCKED, and the journal starts with its two events [R3]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: CARD, title: 'a', allowPaths: ['src/a.ts'] });
    const impatient = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 30 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry });
    let landed: string | undefined = 'not run';
    onAppend = () => { landed = attempt(() => void impatient.extendDeadline(fx.store.listGoals()[0]!.id, 'the owner', LATER, 'more time')); };
    const goal = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [], explicitSize: 'T0' }, { cards: [CARD] });
    assert.match(landed ?? 'not refused', /locked by another writer/);
    assert.deepEqual(fx.events(goal.id).map((e) => e.type), ['GOAL_CREATED', 'GOAL_ROUTED']);
    assert.deepEqual([JSON.stringify(goal), goal.deadlines.extensions], [JSON.stringify(fx.goal(goal.id)), []], 'the record createGoal returns is the one stored');
  } finally {
    onAppend = undefined;
    fx.cleanup();
  }
});

test('T1-GOAL-UPDATE acceptance 2: a ruling or a continuation rerun over a goal that was re-admitted and stopped again since its read, in the same or a later generation, is refused with nothing written [R4]', async () => {
  for (const act of [rule, proceed]) for (const later of ['the same generation', 'a later generation']) {
    const name = `${act === rule ? 'ruling' : 'continuation'}, ${later}`;
    const fx = makeFixture(REVIEWED);
    try {
      const goal = await stoppedForReview(fx);
      // The state a failed re-admission leaves: the card's stop is lifted, the goal is in STOP.
      const runner = runners.get(fx.store)!;
      if (act === rule) runner.ruleFinding(goal, fx.card(CARD), 'F2', { decision: 'rejected', by: 'the owner', reason: 'the row exists' });
      else runner.continueStop(goal, fx.card(CARD), { by: 'the owner', reason: 'one more decision' });
      let after: string[] = [];
      Object.assign(overlap, { at: fx.store.goalFile(goal.id), nth: 1, run: () => {
        if (later === 'a later generation') resume(fx, goal.id);
        else act(fx, goal.id);
        // The stop another card of the goal gives it, after the lift.
        fx.store.saveGoal({ ...fx.goal(goal.id), state: 'STOP', terminal: true, stop: { ...goal.stop!, at: LATER } });
        after = bytes(fx, goal.id);
      } });
      assert.throws(() => act(fx, goal.id), /changed since it was read.*run the command again/, name);
      assert.notDeepEqual(after, [], `${name}: the other commands ran`);
      assert.deepEqual(bytes(fx, goal.id), after, name);
    } finally {
      overlap.at = undefined;
      fx.cleanup();
    }
  }
});

test('T1-GOAL-UPDATE acceptance 2: a ruling or a continuation on a goal that is not stopped is refused, with nothing written, when a cancellation lands since its read or holds the lock [R4] [R6]', async () => {
  for (const act of [rule, proceed]) {
    const name = act === rule ? 'ruling' : 'continuation';
    for (const how of ['lands', 'holds the lock'] as const) {
      const fx = makeFixture(REVIEWED);
      try {
        const stopped = await stoppedForReview(fx);
        // The card is stopped for review and the goal runs its other work.
        const { stop: _stop, ...open } = fx.goal(stopped.id);
        const goal = fx.store.saveGoal({ ...open, state: 'RUN', terminal: false });
        let after = bytes(fx, goal.id);
        if (how === 'lands') {
          Object.assign(overlap, { at: fx.store.goalFile(goal.id), nth: 1, run: () => { cancel(fx, goal.id); after = bytes(fx, goal.id); } });
          assert.throws(() => act(fx, goal.id), isCode('GOAL_STALE'), name);
        } else {
          const held = `${fx.store.goalFile(goal.id)}.lock`;
          writeFileSync(held, `pid=${process.pid} at=${fx.now()} nonce=00000000`);
          const impatient: Fixture = { ...fx, controller: new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 30 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry }) };
          assert.throws(() => act(impatient, goal.id), isCode('LOCKED'), name);
          rmSync(held);
        }
        assert.deepEqual(bytes(fx, goal.id), after, `${name}, a cancellation ${how}`);
        if (how === 'holds the lock') {
          const record = bytes(fx, goal.id)[0];
          act(fx, goal.id);
          assert.deepEqual([bytes(fx, goal.id)[0], fx.store.getCardRun(goal.id, CARD)?.state], [record, act === rule ? 'SHIP' : 'BUILD'], `${name}: with the lock free it lifts the stop and writes no goal`);
        }
      } finally {
        overlap.at = undefined;
        fx.cleanup();
      }
    }
  }
});

test('T1-GOAL-UPDATE acceptance 3: a report whose own directive meets a cancellation that landed after its write keeps its write and returns the directive of the stopped goal [R4] [R5]', () => {
  const fx = makeFixture();
  try {
    const goal = fx.store.saveGoal({ ...running(fx), state: 'CARDS' });
    // Reads of an approval: before the lock, in its section, then the read of its directive.
    Object.assign(overlap, { at: fx.store.goalFile(goal.id), nth: 3, run: () => cancel(fx, goal.id) });
    const r = fx.controller.report({ goalId: goal.id, generation: 0, result: 'approved', data: { kind: 'development', by: 'a lead' } });
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.deepEqual([fx.goal(goal.id).stop?.reason, fx.goal(goal.id).authorizations.filter((x) => x.grantedBy === 'a lead').length], ['cancelled', 1]);
    assert.deepEqual(fx.events(goal.id).slice(-2).map((e) => e.type), ['AUTHORIZATION_GRANTED', 'GOAL_STOPPED']);
  } finally {
    overlap.at = undefined;
    fx.cleanup();
  }
});

test('T1-GOAL-UPDATE acceptance 2: an extension that lands between the write of a resume of a time stop and the directive of that resume leaves what the write, the extension and aidlc next leave one after the other [R4]', () => {
  const stopped = (fx: Fixture): Goal => {
    const goal = running(fx);
    fx.store.saveCardRun({ ...fx.controller.ensureCardRun(goal, CARD), state: 'SHIP' });
    fx.advance(13 * HOUR_MS);
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.equal(fx.goal(goal.id).stop?.reason, 'time');
    return fx.goal(goal.id);
  };
  const fx = makeFixture();
  const serial = makeFixture();
  try {
    const goal = stopped(fx);
    const other = stopped(serial);
    // The report's write alone: its directive is run after the extension, as a command of its own.
    const directive = serial.controller.next;
    Object.assign(serial.controller, { next: () => undefined });
    resume(serial, other.id);
    Object.assign(serial.controller, { next: directive });
    extend(serial, other.id);
    serial.controller.next(other.id);
    // Reads of a resume: before the lock, in its section, then the read of its directive.
    let landed = false;
    Object.assign(overlap, { at: fx.store.goalFile(goal.id), nth: 3, run: () => {
      extend(fx, goal.id);
      landed = true;
    } });
    resume(fx, goal.id);
    assert.ok(landed);
    assert.deepEqual(view(fx, goal.id), view(serial, other.id));
    assert.deepEqual([fx.goal(goal.id).state, fx.goal(goal.id).stop, fx.goal(goal.id).generation, fx.goal(goal.id).deadlines.extensions.map((e) => e.newDeadline)], ['WAIT', undefined, 1, [LATER]]);
  } finally {
    overlap.at = undefined;
    fx.cleanup();
    serial.cleanup();
  }
});

test('T1-GOAL-UPDATE acceptance 2: a report whose directive does not get the goal lock, or is refused twice with GOAL_STALE, says that its result is recorded, and its event and its record stand [R4] [R6]', () => {
  for (const code of ['LOCKED', 'GOAL_STALE']) {
    const fx = makeFixture();
    try {
      const goal = fx.store.saveGoal({ ...running(fx), state: 'CARDS' });
      const impatient = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 30 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry });
      let met: string[] = [];
      const hold = () => {
        writeFileSync(`${fx.store.goalFile(goal.id)}.lock`, `pid=${process.pid} at=${fx.now()} nonce=00000000`);
        met = bytes(fx, goal.id);
      };
      const write = () => {
        fx.store.saveGoal(fx.goal(goal.id));
        met = bytes(fx, goal.id);
      };
      // Reads of an approval: before the lock, in its section, then the read of its directive and, derived again, its second read.
      Object.assign(overlap, { at: fx.store.goalFile(goal.id), nth: 3, run: code === 'LOCKED' ? hold : () => {
        write();
        Object.assign(overlap, { at: fx.store.goalFile(goal.id), nth: 2, run: write });
      } });
      assert.throws(() => impatient.report({ goalId: goal.id, generation: 0, result: 'approved', data: { kind: 'development', by: 'a lead' } }), (err: unknown) => isCode(code)(err) && /approved is recorded and is not to be given again; run aidlc next --goal /.test((err as Error).message), code);
      assert.deepEqual(bytes(fx, goal.id), met, code);
      assert.deepEqual([fx.goal(goal.id).state, fx.goal(goal.id).authorizations.filter((x) => x.grantedBy === 'a lead').length, fx.events(goal.id).at(-1)?.type], ['CARDS', 1, 'AUTHORIZATION_GRANTED'], code);
    } finally {
      overlap.at = undefined;
      fx.cleanup();
    }
  }
});

test('T1-GOAL-UPDATE acceptance 4: a command run inside the runner of a ruling or a continuation is refused with LOCKED, and the act completes [R3] [R6]', async () => {
  for (const [name, act, state] of [['ruling', 'ruleFinding', 'SHIP'], ['continuation', 'continueStop', 'BUILD']] as const) {
    const fx = makeFixture(REVIEWED);
    try {
      const goal = await stoppedForReview(fx);
      const runner = runners.get(fx.store)!;
      const impatient = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 30 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry });
      const landed: string[] = [];
      // The other command runs before the runner writes and again after it.
      const land = () => landed.push(attempt(() => void impatient.extendDeadline(goal.id, 'the owner', LATER, 'more time')) ?? 'completed');
      const around = <A extends unknown[], R>(fn: (...args: A) => R) => (...args: A): R => {
        land();
        const out = fn(...args);
        land();
        return out;
      };
      if (act === 'ruleFinding') fx.controller.ruleFinding({ ruleFinding: around(runner.ruleFinding.bind(runner)) }, goal.id, fx.card(CARD), 'F2', { decision: 'rejected', by: 'the owner', reason: 'the row exists' });
      else fx.controller.continueCard({ continueStop: around(runner.continueStop.bind(runner)) }, goal.id, fx.card(CARD), { by: 'the owner', reason: 'one more decision' });
      assert.equal(landed.length, 2, name);
      for (const l of landed) assert.match(l, /locked by another writer/, name);
      assert.deepEqual([fx.goal(goal.id).state, fx.goal(goal.id).deadlines.extensions, fx.store.getCardRun(goal.id, CARD)?.state], ['CARDS', [], state], name);
    } finally {
      fx.cleanup();
    }
  }
});

test('T1-GOAL-UPDATE acceptance 4: a close refused between its two lease sections leaves the goal record and the takeover intent alone, and the next call completes it with one GOAL_TAKEOVER [R6]', () => {
  const fx = makeFixture();
  const update = fx.leases.update.bind(fx.leases);
  try {
    const goal = derived.find(([name]) => name.startsWith('CLOSE to DONE under'))![1](fx);
    const held = `${fx.store.goalFile(goal.id)}.lock`;
    const [record, journal] = bytes(fx, goal.id) as [string, string];
    let sections = 0;
    fx.leases.update = (...args: Parameters<typeof update>) => {
      const out = update(...args);
      if (++sections === 1) writeFileSync(held, `pid=${process.pid} at=${fx.now()} nonce=00000000`);
      return out;
    };
    const impatient = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 30 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: fx.registry });
    assert.throws(() => impatient.next(goal.id), isCode('LOCKED'));
    fx.leases.update = update;
    const after = bytes(fx, goal.id) as [string, string];
    assert.equal(after[0], record, 'the goal record');
    const gained = after[1].slice(journal.length).trim().split('\n').map((l) => JSON.parse(l) as { type: string; data: { kind?: string } });
    assert.deepEqual(gained.map((e) => [e.type, e.data.kind]), [['NOTE', 'goal-close-takeover-intent']]);
    rmSync(held);
    assert.equal(fx.controller.next(goal.id).kind, 'done');
    assert.deepEqual([fx.goal(goal.id).state, fx.events(goal.id).filter((e) => e.type === 'GOAL_TAKEOVER').length], ['DONE', 1]);
  } finally {
    fx.leases.update = update;
    fx.cleanup();
  }
});
