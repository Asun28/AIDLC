import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFixture, writeCard, goalForCards, driveCardToDone, actorA, actorB, type Fixture } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import { MINUTE_MS } from '../../src/core/types.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { doneGoalTakeover } from '../../src/core/card-goal.ts';

/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const PRELOAD = pathToFileURL(fileURLToPath(new URL('./takeover-done-race.preload.ts', import.meta.url))).href;
const CARD = 'T1-HELLO';

/**
 * A RUN goal that projects T1-HELLO with its card run claimed at PREPARE by the fixture's session at the fixture clock, so the
 * goal lease and the card lease are held by that session and long expired on the real clock the CLI runs on. The CLI runs as
 * session win-Z; with `race`, the preload saves the goal DONE right after the command's first goal read.
 */
function setup() {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'say hello' });
  const goal = goalForCards(fx, [CARD]);
  fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  const cli = (race: boolean, ...args: string[]) =>
    spawnSync(process.execPath, [...(race ? ['--import', PRELOAD] : []), MAIN, ...args, '--json'], {
      cwd: fx.tmp,
      env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-Z', ...(race ? { AIDLC_TEST_DONE_AFTER_READ: goal.id } : {}) },
      encoding: 'utf8',
      timeout: 60_000,
    });
  const goalLease = fx.leases.file(resourceKeys.goal(fx.repo.key, goal.id));
  const cardLease = fx.leases.file(resourceKeys.card(fx.repo.key, CARD));
  /** Every lease file, the card run file and every goal journal, by path. */
  const snapshot = () => {
    const files = [fx.store.cardFile(goal.id, CARD), ...readdirSync(fx.paths.leases).map((f) => path.join(fx.paths.leases, f)), ...readdirSync(fx.paths.journal).map((f) => path.join(fx.paths.journal, f))];
    return Object.fromEntries(files.filter((f) => existsSync(f) && !f.endsWith('.lock')).map((f) => [f, readFileSync(f, 'utf8')]));
  };
  const generation = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { generation: number }).generation;
  return { fx, goalId: goal.id, cli, goalLease, cardLease, snapshot, generation };
}

test('T0-TAKEOVER-DONE-RACE acceptance 1: goal takeover on a goal saved DONE after its goal read takes no lease, appends no event and reports DONE [R2]', () => {
  const { fx, goalId, cli, snapshot } = setup();
  try {
    const before = snapshot();
    const r = cli(true, 'goal', 'takeover', goalId);
    assert.equal(r.status, 0, `exits 0: ${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), { goalId, state: 'DONE', takenOver: false, detail: doneGoalTakeover({ id: goalId, state: 'DONE' }) });
    assert.deepEqual(snapshot(), before, 'leases and journals are byte-identical');
  } finally {
    fx.cleanup();
  }
});

for (const withGoal of [true, false]) {
  test(`T0-TAKEOVER-DONE-RACE acceptance 2: card takeover ${withGoal ? 'with' : 'without'} --goal on a goal saved DONE after its goal read takes no lease, writes no run and appends no event [R3]`, () => {
    const { fx, goalId, cli, snapshot } = setup();
    try {
      const before = snapshot();
      const r = cli(true, 'card', 'takeover', CARD, ...(withGoal ? ['--goal', goalId] : []));
      assert.equal(r.status, 0, `exits 0: ${r.stderr}`);
      assert.deepEqual(JSON.parse(r.stdout), { cardId: CARD, goalId, state: 'DONE', takenOver: false, detail: doneGoalTakeover({ id: goalId, state: 'DONE' }) });
      assert.deepEqual(snapshot(), before, 'leases, the card run and journals are byte-identical');
    } finally {
      fx.cleanup();
    }
  });
}

test('T0-TAKEOVER-DONE-RACE acceptance 4: on a RUN goal both takeovers advance the lease generation, and card takeover leaves the goal lease byte-identical [R5]', () => {
  const { fx, goalId, cli, goalLease, cardLease, generation } = setup();
  try {
    const goalLeaseBefore = readFileSync(goalLease, 'utf8');
    const card = cli(false, 'card', 'takeover', CARD, '--goal', goalId);
    assert.equal(card.status, 0, card.stderr);
    assert.equal(generation(cardLease), 1, 'the card lease advanced');
    assert.equal(readFileSync(goalLease, 'utf8'), goalLeaseBefore, 'the goal lease is byte-identical after card takeover');
    const goal = cli(false, 'goal', 'takeover', goalId);
    assert.equal(goal.status, 0, goal.stderr);
    assert.equal(generation(goalLease), 1, 'the goal lease advanced');
  } finally {
    fx.cleanup();
  }
});

/** A one-card goal created by win-A with its card DONE, the clock past the goal lease TTL and the goal in VERIFY_ARC. */
function closableGoal(fx: Fixture): { goalId: string; lockFile: string } {
  writeCard(fx, { id: CARD, title: 'print hello' });
  const goal = goalForCards(fx, [CARD]);
  driveCardToDone(fx, goal.id, CARD);
  fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
  assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
  return { goalId: goal.id, lockFile: `${fx.leases.file(resourceKeys.goal(fx.repo.key, goal.id))}.lock` };
}

for (const lease of ['own', 'foreign', 'released', 'absent'] as const) {
  test(`T0-TAKEOVER-DONE-RACE acceptance 3: goal close with ${lease === 'own' ? 'its own held' : lease === 'foreign' ? 'an expired foreign' : lease === 'released' ? 'a released' : 'no'} goal lease saves DONE while it holds the goal lease lock [R1]`, () => {
    const fx = makeFixture({ actor: actorA });
    const realSave = GoalStore.prototype.saveGoal;
    try {
      const { goalId, lockFile } = closableGoal(fx);
      const leaseFile = lockFile.slice(0, -'.lock'.length);
      if (lease === 'released') fx.leases.release(resourceKeys.goal(fx.repo.key, goalId), 0, actorA);
      if (lease === 'absent') unlinkSync(leaseFile);
      if (lease === 'foreign') setActorForTests(actorB);
      const locked: boolean[] = [];
      GoalStore.prototype.saveGoal = function (this: GoalStore, goal) {
        if (goal.id === goalId && goal.state === 'DONE') locked.push(existsSync(lockFile));
        return realSave.call(this, goal);
      };
      const { directive } = fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: {} });
      assert.equal(directive.kind, 'done', directive.narration);
      assert.deepEqual(locked, [true], 'the DONE record is saved once, under the goal lease lock');
    } finally {
      GoalStore.prototype.saveGoal = realSave;
      setActorForTests(actorA);
      fx.cleanup();
    }
  });
}
