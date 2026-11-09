import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { makeStop } from '../../src/core/stop.ts';

/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const CARD = 'T1-HELLO';

/** A goal that projects T1-HELLO, and the CLI against its state directory as session win-A. */
function setup() {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'say hello' });
  const goal = goalForCards(fx, [CARD]);
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 60_000 });
  const types = () => fx.events(goal.id).map((e) => e.type);
  return { fx, goalId: goal.id, cli, types };
}

/** The commands of R1, each without --goal; `--goal <id>` is appended for the second run. */
const REFUSED: string[][] = [
  ['card', 'next', CARD],
  ['card', 'attempt', CARD, '--outcome', 'success'],
  ['card', 'close', CARD, '--metadata'],
  ['card', 'report', CARD, '--data', '{}'],
  ['review', 'pre', CARD],
  ['review', 'r3', CARD],
  ['review', 'dispute', CARD, 'F1', '--note', 'the finding does not hold'],
  ['review', 'accept', CARD, 'F1'],
];

test('T0-CARD-TERMINAL-GOAL acceptance 2: on a cancelled goal every card command of R1, with --goal and without, is refused naming the goal, STOP, the reason and goal resume, and writes nothing [R1] [R2]', () => {
  const { fx, goalId, cli, types } = setup();
  try {
    fx.controller.report({ goalId, generation: 0, result: 'cancel', data: { detail: 'stopped' } });
    for (const base of REFUSED) {
      for (const args of [base, [...base, '--goal', goalId]]) {
        const before = types();
        const r = cli(...args);
        const label = args.join(' ');
        assert.notEqual(r.status, 0, `${label} exits non-zero: ${r.stdout}`);
        for (const part of [goalId, 'STOP', 'cancelled', `aidlc goal resume ${goalId}`]) assert.ok(r.stderr.includes(part), `${label}: the refusal names ${part}: ${r.stderr}`);
        assert.equal(existsSync(fx.store.cardFile(goalId, CARD)), false, `${label} creates no card run`);
        assert.deepEqual(types(), before, `${label} appends no journal event`);
      }
    }
  } finally {
    fx.cleanup();
  }
});

/** The card run in BUILD with its attempt running, then the goal stopped for ownership. */
function stoppedInBuild() {
  const s = setup();
  const runner = s.fx.runner();
  const card = s.fx.card(CARD);
  let r = runner.next(s.fx.goal(s.goalId), card, s.fx.controller.ensureCardRun(s.fx.goal(s.goalId), CARD));
  r = runner.next(s.fx.goal(s.goalId), card, r.run);
  assert.equal(r.directive.kind, 'build', `setup reaches BUILD: ${r.directive.narration}`);
  assert.ok(s.types().includes('ATTEMPT_STARTED'), 'setup: the attempt is running');
  s.fx.store.saveGoal({ ...s.fx.goal(s.goalId), state: 'STOP', terminal: true, stop: makeStop('ownership', 'the card lease lapsed', 'card takeover', { at: s.fx.now() }) });
  return s;
}

test('T0-CARD-TERMINAL-GOAL acceptance 3: on a goal stopped for ownership with a running attempt, card next and card attempt are refused and the run and journal stay as they were [R1]', () => {
  const { fx, goalId, cli, types } = stoppedInBuild();
  try {
    const file = fx.store.cardFile(goalId, CARD);
    const bytes = readFileSync(file, 'utf8');
    const before = types().length;
    for (const args of [['card', 'next', CARD, '--goal', goalId], ['card', 'attempt', CARD, '--goal', goalId, '--outcome', 'success']]) {
      const r = cli(...args);
      assert.notEqual(r.status, 0, `${args.join(' ')} exits non-zero: ${r.stdout}`);
      assert.ok(r.stderr.includes('ownership') && r.stderr.includes(`aidlc goal resume ${goalId}`), `${args.join(' ')}: ${r.stderr}`);
    }
    assert.equal(readFileSync(file, 'utf8'), bytes, 'the stored run is byte-identical');
    const after = types().slice(before);
    for (const type of ['ATTEMPT_STARTED', 'ATTEMPT_FINISHED', 'LEASE_RENEWED', 'CARD_STATE', 'OPERATION_ISSUED']) assert.ok(!after.includes(type), `no ${type} after the stop: ${after.join(',')}`);
  } finally {
    fx.cleanup();
  }
});

test('T0-CARD-TERMINAL-GOAL acceptance 4: on the same stopped goal card status prints the run, and card takeover and card ci-reconcile are not refused by the goal guard [R4]', () => {
  const { fx, goalId, cli } = stoppedInBuild();
  try {
    const status = cli('card', 'status', CARD, '--goal', goalId);
    assert.equal(status.status, 0, status.stderr);
    assert.equal((JSON.parse(status.stdout) as { cardId: string; state: string }).state, 'BUILD');
    for (const args of [['card', 'takeover', CARD, '--goal', goalId], ['card', 'ci-reconcile', CARD, '--goal', goalId, '--run', '42']]) {
      const r = cli(...args);
      assert.ok(!r.stderr.includes('aidlc goal resume'), `${args.join(' ')} prints no refusal of R2: ${r.stderr}`);
    }
  } finally {
    fx.cleanup();
  }
});

test('T0-CARD-TERMINAL-GOAL acceptance 5: after goal resume the same card next is not refused [R1]', () => {
  const { fx, goalId, cli } = setup();
  try {
    fx.controller.report({ goalId, generation: 0, result: 'cancel', data: { detail: 'stopped' } });
    const resume = cli('goal', 'resume', goalId, '--reason', 'continue the card');
    assert.equal(resume.status, 0, resume.stderr);
    const r = cli('card', 'next', CARD, '--goal', goalId);
    assert.ok(!r.stderr.includes('aidlc goal resume'), `card next is not refused after the resume: ${r.stderr}`);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    fx.cleanup();
  }
});
