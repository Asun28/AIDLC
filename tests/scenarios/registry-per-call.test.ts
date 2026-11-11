/**
 * Card T0-REGISTRY-PER-CALL: each outermost `next`, `report` or `createGoal` call of `GoalController` retains at most one
 * successfully loaded card registry, loaded on first use and dropped on return or throw; `aidlc board` loads it once.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, driveCardToDone, goalForCards, type Fixture } from './_harness.ts';
import { cleanup } from '../infra/helpers.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { ReviewQueue } from '../../src/coordination/review-queue.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { MAX_PLANNING_INVOCATIONS } from '../../src/core/types.ts';
import type { CardRegistry } from '../../src/artifacts/card.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

/** A review queue whose `pool` read throws `pool unreadable` once when armed. */
class FailingPool extends ReviewQueue {
  armed = false;
  override pool(name: string, now?: string) {
    if (this.armed) {
      this.armed = false;
      throw new Error('pool unreadable');
    }
    return super.pool(name, now);
  }
}

interface Counted {
  fx: Fixture;
  c: GoalController;
  /** The loader calls since the last `count`, then resets the counter. */
  count: () => number;
  /** The next loader call throws `err` (once). */
  arm: (err: Error) => void;
  /** `fn` runs inside the next loader call (once), before it reads the files. */
  onFirst: (fn: () => void) => void;
}

/** A fixture and a second controller over it whose `cards` loader counts its calls. */
function counted(t: TestContext, queue?: (fx: Fixture) => ReviewQueue): Counted {
  // `makeFixture` caches the harness actor; the reset is registered first, so it runs whatever happens after.
  t.after(() => setActorForTests(undefined));
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  let loads = 0;
  let boom: Error | undefined;
  let first: (() => void) | undefined;
  const cards = (): CardRegistry => {
    loads += 1;
    if (first) {
      const fn = first;
      first = undefined;
      fn();
    }
    if (boom) {
      const err = boom;
      boom = undefined;
      throw err;
    }
    return fx.registry();
  };
  const c = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: queue ? queue(fx) : fx.queue, ops: fx.ops, now: fx.now, cards });
  return {
    fx,
    c,
    count: () => {
      const n = loads;
      loads = 0;
      return n;
    },
    arm: (err) => {
      boom = err;
    },
    onFirst: (fn) => {
      first = fn;
    },
  };
}

const t0Request = (id: string) => ({ text: `implement ${id}`, source: 'card' as const, ref: id, affectedSurfaces: [] });

/** Every file of the cards directory with its bytes. */
function cardFiles(fx: Fixture): Record<string, string> {
  return Object.fromEntries(readdirSync(fx.cardsDir).sort().map((name) => [name, readFileSync(path.join(fx.cardsDir, name), 'latin1')]));
}

function stateLine(fx: Fixture, goalId: string): string[] {
  return readFileSync(path.join(fx.paths.board, `${goalId}.md`), 'utf8').split('\n').filter((l) => l.startsWith('- **State**'));
}

test('createGoal loads the registry once', (t) => {
  const { fx, c, count } = counted(t);
  writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
  count();
  const goal = c.createGoal(t0Request('T1-A'), { cards: ['T1-A'] });
  assert.equal(goal.state, 'PLAN');
  assert.equal(count(), 1, 'main loads twice: at intake and in the board write');
});

test('one report loads the registry once, with the board writes and the next it runs', async (t) => {
  await t.test('(a) cards-projected ending in run-card', (st) => {
    const { fx, c, count } = counted(st);
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    const goal = c.createGoal(t0Request('T1-A'), { cards: ['T1-A'] });
    const before = cardFiles(fx);
    count();
    const r = c.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-A'] } });
    assert.equal(r.directive.kind, 'run-card', r.directive.narration);
    assert.equal(count(), 1, 'main: 4');
    assert.deepEqual(cardFiles(fx), before);
  });
  await t.test('(b) cards-projected ending in a stop', (st) => {
    const { fx, c, count } = counted(st);
    writeCard(fx, { id: 'T1-OPEN', title: 'open', status: 'todo', allowPaths: ['src/open.ts'] });
    writeCard(fx, { id: 'T1-NEXT', title: 'next', dependsOn: ['T1-OPEN'], allowPaths: ['src/next.ts'] });
    const goal = c.createGoal(t0Request('T1-NEXT'), { cards: ['T1-NEXT'] });
    const before = cardFiles(fx);
    count();
    const r = c.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-NEXT'] } });
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(count(), 1, 'main: 5');
    assert.deepEqual(cardFiles(fx), before);
  });
  await t.test('(c) arc-verified', (st) => {
    const { fx, c, count } = counted(st);
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    const goal = goalForCards(fx, ['T1-A']);
    assert.equal(goal.target, 'development');
    assert.equal(goal.state, 'RUN');
    driveCardToDone(fx, goal.id, 'T1-A');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    const before = cardFiles(fx);
    count();
    const r = c.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
    assert.equal(r.directive.kind, 'done', r.directive.narration);
    assert.equal(count(), 1, 'main: 3');
    assert.deepEqual(cardFiles(fx), before);
  });
  await t.test('(d) revision in RUN', (st) => {
    const { fx, c, count } = counted(st);
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' });
    assert.equal(goal.state, 'RUN');
    const before = cardFiles(fx);
    count();
    const r = c.report({ goalId: goal.id, generation: 0, result: 'revision', data: { text: 'build it again', cards: ['T1-A'] } });
    assert.equal(r.directive.kind, 'project-cards', r.directive.narration);
    assert.equal(count(), 1, 'main: 2');
    assert.deepEqual(cardFiles(fx), before);
  });
});

test('an arc-completing next loads the registry once', (t) => {
  const { fx, c, count } = counted(t);
  writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
  const goal = goalForCards(fx, ['T1-A']);
  driveCardToDone(fx, goal.id, 'T1-A');
  count();
  const d = c.next(goal.id);
  assert.equal(d.kind, 'verify-arc', d.narration);
  assert.equal(count(), 1, 'main: 2');
});

test('a later outermost call loads again and sees the card files as they are then', (t) => {
  const { fx, c, count } = counted(t);
  writeCard(fx, { id: 'T1-EARLIER', title: 'earlier', status: 'merged', allowPaths: ['src/earlier.ts'] });
  writeCard(fx, { id: 'T1-NEXT', title: 'next', dependsOn: ['T1-EARLIER'], allowPaths: ['src/next.ts'] });
  const goal = goalForCards(fx, ['T1-NEXT']);
  count();
  assert.equal(c.next(goal.id).kind, 'run-card');
  assert.equal(count(), 1);
  writeCard(fx, { id: 'T1-EARLIER', title: 'earlier', status: 'todo', allowPaths: ['src/earlier.ts'] });
  const d = c.next(goal.id);
  assert.equal(d.kind, 'stop', d.narration);
  assert.match(fx.goal(goal.id).stop?.detail ?? '', /required gaps remain/);
  assert.equal(count(), 1, 'main: 2');
  // Outside any scope `writeBoard` loads as on main.
  c.writeBoard(fx.goal(goal.id));
  assert.equal(count(), 1);
  c.writeBoard(fx.goal(goal.id));
  assert.equal(count(), 1);
  c.writeBoard(fx.goal(goal.id), [fx.card('T1-NEXT')], fx.store.listCardRuns(goal.id), {});
  assert.equal(count(), 0);
});

test('every entry point drops its registry when it throws, and an escaping loader error keeps its object', async (t) => {
  await t.test('(a) report', (st) => {
    const { fx, c, count } = counted(st);
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    const goal = c.createGoal(t0Request('T1-A'), { cards: ['T1-A'] });
    count();
    const report = () => c.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-LATE'] } });
    assert.throws(report, (err: Error) => err.message.includes('cards not found'));
    assert.equal(count(), 1);
    writeCard(fx, { id: 'T1-LATE', title: 'late', allowPaths: ['src/late.ts'] });
    assert.equal(report().directive.kind, 'run-card');
    assert.equal(count(), 1, 'main: 4');
  });
  await t.test('(b) createGoal', (st) => {
    const { fx, c, count } = counted(st);
    writeCard(fx, { id: 'T1-M', title: 'm', status: 'merged', allowPaths: ['src/m.ts'] });
    count();
    const create = () => c.createGoal(t0Request('T1-M'), { cards: ['T1-M'] });
    assert.throws(create, (err: Error) => err.message.includes('already merged'));
    assert.equal(count(), 1);
    writeCard(fx, { id: 'T1-M', title: 'm', status: 'todo', allowPaths: ['src/m.ts'] });
    assert.equal(create().state, 'PLAN');
    assert.equal(count(), 1, 'main: 2');
  });
  await t.test('(c) next', (st) => {
    let queue: FailingPool | undefined;
    const { fx, c, count } = counted(st, (f) => (queue = new FailingPool(f.paths.reviewQueue)));
    writeCard(fx, { id: 'T1-EARLIER', title: 'earlier', status: 'merged', allowPaths: ['src/earlier.ts'] });
    writeCard(fx, { id: 'T1-NEXT', title: 'next', dependsOn: ['T1-EARLIER'], allowPaths: ['src/next.ts'] });
    const goal = goalForCards(fx, ['T1-NEXT']);
    queue!.armed = true;
    count();
    assert.throws(() => c.next(goal.id), (err: Error) => err.message === 'pool unreadable');
    assert.equal(count(), 1, 'the load of nextInRun comes before the pool read');
    writeCard(fx, { id: 'T1-EARLIER', title: 'earlier', status: 'todo', allowPaths: ['src/earlier.ts'] });
    const d = c.next(goal.id);
    assert.equal(d.kind, 'stop', d.narration);
    assert.equal(count(), 1, 'main: 2');
  });
  await t.test('(d) an escaping loader error', (st) => {
    const { fx, c, count, arm } = counted(st);
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    const goal = goalForCards(fx, ['T1-A']);
    const boom = new Error('registry unreadable');
    arm(boom);
    count();
    assert.throws(() => c.next(goal.id), (err) => err === boom);
    assert.equal(count(), 1);
    assert.equal(c.next(goal.id).kind, 'run-card');
    assert.equal(count(), 1);
  });
});

test('a caught load failure keeps nothing, and the next site of the same call loads again', (t) => {
  const { fx, c, count, arm } = counted(t);
  writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
  const goal = c.createGoal(t0Request('T1-A'), { cards: ['T1-A'] });
  assert.deepEqual(stateLine(fx, goal.id), ['- **State**: PLAN']);
  arm(new Error('registry unreadable'));
  count();
  const r = c.report({ goalId: goal.id, generation: 0, result: 'rejected', data: { detail: 'no' } });
  assert.equal(r.directive.kind, 'stop');
  assert.equal(fx.goal(goal.id).state, 'STOP');
  assert.equal(fx.goal(goal.id).stop?.reason, 'checkpoint');
  assert.equal(count(), 2, 'the stop board write threw, the board write of report loaded again');
  const notes = fx.events(goal.id).filter((e) => e.type === 'NOTE' && 'boardError' in e.data);
  assert.deepEqual(notes.map((e) => e.data['boardError']), ['unknown']);
  assert.deepEqual(stateLine(fx, goal.id), ['- **State**: STOP (terminal)']);
});

test('a call that reaches no loader site loads nothing; a PLAN stop path loads once', (t) => {
  const { fx, c, count } = counted(t);
  writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
  const t0 = c.createGoal(t0Request('T1-A'), { cards: ['T1-A'] });
  const t1 = c.createGoal({ text: 'build the hello feature', source: 'natural-language', affectedSurfaces: [], explicitSize: 'T1' });
  count();
  assert.equal(c.next(t0.id).kind, 'project-cards');
  assert.equal(count(), 0);
  assert.equal(c.next(t1.id).kind, 'plan');
  assert.equal(count(), 0);
  c.report({ goalId: t0.id, generation: 0, result: 'cancel', data: {} });
  count();
  assert.equal(c.next(t0.id).kind, 'stop');
  assert.equal(count(), 0);
  const g = fx.goal(t1.id);
  fx.store.saveGoal({ ...g, counters: { ...g.counters, planningInvocations: MAX_PLANNING_INVOCATIONS } });
  const d = c.next(t1.id);
  assert.equal(d.kind, 'stop', d.narration);
  assert.equal(fx.goal(t1.id).stop?.reason, 'checkpoint');
  assert.equal(count(), 1, 'the board write of the stop');
});

test('aidlc board reads the card directory once', (t) => {
  t.after(() => setActorForTests(undefined));
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  writeCard(fx, { id: 'T1-NEXT', title: 'next', allowPaths: ['src/next.ts'] });
  const goal = fx.controller.createGoal(t0Request('T1-NEXT'), { cards: ['T1-NEXT'] });
  const out = path.join(fx.tmp, 'readdir-count.txt');
  // Counts the `readdirSync` calls whose path ends in the segments `specs` and `tasks`; the export sync lets the named
  // import of src/artifacts/card.ts see the wrapper.
  const shim = `data:text/javascript,${encodeURIComponent(
    [
      "import fs from 'node:fs';",
      "import { syncBuiltinESMExports } from 'node:module';",
      'const real = fs.readdirSync;',
      'let n = 0;',
      'fs.readdirSync = function (p, ...rest) {',
      '  const segs = String(p).split(/[\\\\/]+/).filter(Boolean);',
      "  if (segs[segs.length - 2] === 'specs' && segs[segs.length - 1] === 'tasks') n += 1;",
      '  return real.call(this, p, ...rest);',
      '};',
      'syncBuiltinESMExports();',
      "process.on('exit', () => fs.writeFileSync(process.env.REGISTRY_READDIR_COUNT_FILE, String(n)));",
    ].join('\n'),
  )}`;
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    if (v === undefined || upper === 'NODE_OPTIONS' || upper.startsWith('GIT_') || upper.startsWith('AIDLC_')) continue;
    env[k] = v;
  }
  const ceilings = [...new Set([path.dirname(fx.tmp), path.dirname(realpathSync.native(fx.tmp))])];
  Object.assign(env, { GIT_CEILING_DIRECTORIES: ceilings.join(path.delimiter), AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A', REGISTRY_READDIR_COUNT_FILE: out });
  const r = spawnSync(process.execPath, ['--import', shim, MAIN, 'board', '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, 'utf8'), '1', 'main: 2 (the CLI and writeBoard)');
  assert.equal(r.stdout, readFileSync(path.join(fx.paths.board, `${goal.id}.md`), 'utf8') + '\n');
});

test('the first registry load of a plan-produced report comes after its journal event and its goal save', (t) => {
  const { fx, c, count, onFirst } = counted(t);
  writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
  writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
  const goal = fx.controller.createGoal({ text: 'build the hello feature', source: 'natural-language', affectedSurfaces: [], explicitSize: 'T1' }, { cards: ['T1-A', 'T1-B'] });
  assert.equal(goal.state, 'PLAN');
  const seen: unknown[] = [];
  onFirst(() => seen.push(fx.events(goal.id).some((e) => e.type === 'PLAN_INVOKED'), new GoalStore(fx.paths).getGoal(goal.id)?.state));
  count();
  const r = c.report({ goalId: goal.id, generation: 0, result: 'plan-produced', data: { planRef: 'plans/hello.md' } });
  assert.equal(r.directive.kind, 'run-card', r.directive.narration);
  assert.equal(count(), 1, 'main: 3');
  assert.deepEqual(seen, [true, 'CARDS']);
});
