import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';

/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const CARD = 'T1-HELLO';

/**
 * A goal that projects T1-HELLO with its card run claimed at PREPARE by the fixture's session at the fixture clock, so the
 * goal lease and the card lease are held by that session and long expired on the real clock the CLI runs on. The CLI runs as
 * session win-Z, another session.
 */
function setup(state: 'DONE' | 'RUN') {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'say hello' });
  const goal = goalForCards(fx, [CARD]);
  fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  if (state === 'DONE') fx.store.saveGoal({ ...fx.goal(goal.id), state: 'DONE', terminal: true });
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-Z' }, encoding: 'utf8', timeout: 60_000 });
  const goalLease = fx.leases.file(resourceKeys.goal(fx.repo.key, goal.id));
  const cardLease = fx.leases.file(resourceKeys.card(fx.repo.key, CARD));
  /** Every lease file, the card run file and every goal journal, by path. */
  const snapshot = () => {
    const files = [fx.store.cardFile(goal.id, CARD), ...readdirSync(fx.paths.leases).map((f) => path.join(fx.paths.leases, f)), ...readdirSync(fx.paths.journal).map((f) => path.join(fx.paths.journal, f))];
    return Object.fromEntries(files.filter((f) => existsSync(f)).map((f) => [f, readFileSync(f, 'utf8')]));
  };
  const generation = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { generation: number }).generation;
  return { fx, goalId: goal.id, cli, goalLease, cardLease, snapshot, generation };
}

test('T0-TAKEOVER-DONE-GOAL acceptance 2: goal takeover on a DONE goal takes no lease, appends no event, reports DONE and exits 0 [R1]', () => {
  const { fx, goalId, cli, goalLease, snapshot } = setup('DONE');
  try {
    assert.ok(existsSync(goalLease), 'setup: the goal lease exists');
    const before = snapshot();
    const r = cli('goal', 'takeover', goalId);
    assert.equal(r.status, 0, `exits 0: ${r.stderr}`);
    assert.ok(r.stdout.includes(goalId) && r.stdout.includes('DONE'), `names the goal and DONE: ${r.stdout}`);
    assert.deepEqual(snapshot(), before, 'leases and journals are byte-identical');
  } finally {
    fx.cleanup();
  }
});

test('T0-TAKEOVER-DONE-GOAL acceptance 3: card takeover on a card of a DONE goal, with and without --goal, takes no lease, writes nothing, reports DONE and exits 0 [R2]', () => {
  const { fx, goalId, cli, cardLease, snapshot } = setup('DONE');
  try {
    assert.ok(existsSync(cardLease), 'setup: the card lease exists');
    for (const args of [['card', 'takeover', CARD, '--goal', goalId], ['card', 'takeover', CARD]]) {
      const before = snapshot();
      const r = cli(...args);
      const label = args.join(' ');
      assert.equal(r.status, 0, `${label} exits 0: ${r.stderr}`);
      for (const part of [CARD, goalId, 'DONE']) assert.ok(r.stdout.includes(part), `${label} names ${part}: ${r.stdout}`);
      assert.ok(!r.stdout.includes('next:'), `${label} prints no next hint: ${r.stdout}`);
      assert.deepEqual(snapshot(), before, `${label}: leases, the card run and journals are byte-identical`);
    }
  } finally {
    fx.cleanup();
  }
});

test('T0-TAKEOVER-DONE-GOAL acceptance 4: on the same fixtures with the goal in RUN, goal takeover and card takeover take the lease as before [R4]', () => {
  const { fx, goalId, cli, goalLease, cardLease, generation } = setup('RUN');
  try {
    const goalBefore = generation(goalLease);
    const g = cli('goal', 'takeover', goalId);
    assert.equal(g.status, 0, g.stderr);
    assert.equal(generation(goalLease), goalBefore + 1, 'the goal lease generation advances');
    const cardBefore = generation(cardLease);
    const c = cli('card', 'takeover', CARD, '--goal', goalId);
    assert.equal(c.status, 0, c.stderr);
    assert.equal(generation(cardLease), cardBefore + 1, 'the card lease generation advances');
  } finally {
    fx.cleanup();
  }
});
