import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';
import { doneGoalTakeover } from '../../src/core/card-goal.ts';

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
  const run = (format: '--json' | '--no-json', args: string[]) => spawnSync(process.execPath, [MAIN, ...args, format], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-Z' }, encoding: 'utf8', timeout: 60_000 });
  const cli = (...args: string[]) => run('--json', args);
  const human = (...args: string[]) => run('--no-json', args);
  const goalLease = fx.leases.file(resourceKeys.goal(fx.repo.key, goal.id));
  const cardLease = fx.leases.file(resourceKeys.card(fx.repo.key, CARD));
  /** Every lease file, the card run file and every goal journal, by path. */
  const snapshot = () => {
    const files = [fx.store.cardFile(goal.id, CARD), fx.store.cardFile(goal.id, 'T1-GONE'), ...readdirSync(fx.paths.leases).map((f) => path.join(fx.paths.leases, f)), ...readdirSync(fx.paths.journal).map((f) => path.join(fx.paths.journal, f))];
    return Object.fromEntries(files.filter((f) => existsSync(f)).map((f) => [f, readFileSync(f, 'utf8')]));
  };
  const generation = (file: string) => (JSON.parse(readFileSync(file, 'utf8')) as { generation: number }).generation;
  return { fx, goalId: goal.id, cli, human, goalLease, cardLease, snapshot, generation };
}

/** Any read of the file fails to parse, so a command that reads it before the DONE check exits with a store error. */
function unreadable(file: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, '{', 'utf8');
}

test('T0-TAKEOVER-DONE-GOAL acceptance 2: goal takeover on a DONE goal takes no lease, appends no event, reports DONE and exits 0 [R1]', () => {
  const { fx, goalId, cli, human, goalLease, snapshot } = setup('DONE');
  try {
    assert.ok(existsSync(goalLease), 'setup: the goal lease exists');
    const text = doneGoalTakeover({ id: goalId, state: 'DONE' })!;
    const before = snapshot();
    const r = cli('goal', 'takeover', goalId);
    assert.equal(r.status, 0, `exits 0: ${r.stderr}`);
    assert.deepEqual(JSON.parse(r.stdout), { goalId, state: 'DONE', takenOver: false, detail: text }, 'the JSON report carries the text of R3');
    const h = human('goal', 'takeover', goalId);
    assert.equal(h.status, 0, `human output exits 0: ${h.stderr}`);
    assert.equal(h.stdout.trim(), text, 'the human line is the text of R3');
    assert.deepEqual(snapshot(), before, 'leases and journals are byte-identical');
  } finally {
    fx.cleanup();
  }
});

test('T0-TAKEOVER-DONE-GOAL acceptance 3: card takeover on a card of a DONE goal, with and without --goal, takes no lease, writes nothing, reports DONE and exits 0 [R2]', () => {
  const { fx, goalId, cli, human, cardLease, snapshot } = setup('DONE');
  try {
    assert.ok(existsSync(cardLease), 'setup: the card lease exists');
    const text = doneGoalTakeover({ id: goalId, state: 'DONE' })!;
    // The card run and the card lease are unreadable: a read of either before the DONE check fails the command.
    unreadable(fx.store.cardFile(goalId, CARD));
    unreadable(cardLease);
    // A run of a card the goal does not project: only `--goal` resolves it, through `holdsRun`, which reads that run.
    writeCard(fx, { id: 'T1-GONE', title: 'a card the goal does not project' });
    unreadable(fx.store.cardFile(goalId, 'T1-GONE'));
    unreadable(fx.leases.file(resourceKeys.card(fx.repo.key, 'T1-GONE')));
    const cases: Array<[string, string[]]> = [[CARD, ['--goal', goalId]], [CARD, []], ['T1-GONE', ['--goal', goalId]]];
    for (const [cardId, extra] of cases) {
      const args = ['card', 'takeover', cardId, ...extra];
      const label = args.join(' ');
      const before = snapshot();
      const r = cli(...args);
      assert.equal(r.status, 0, `${label} exits 0: ${r.stderr}`);
      assert.deepEqual(JSON.parse(r.stdout), { cardId, goalId, state: 'DONE', takenOver: false, detail: text }, `${label}: the JSON report carries the card and the text of R3`);
      const h = human(...args);
      assert.equal(h.status, 0, `${label} human output exits 0: ${h.stderr}`);
      assert.equal(h.stdout.trim(), `${cardId}: ${text}`, `${label}: the human line names the card and the text of R3`);
      assert.ok(!h.stdout.includes('next:'), `${label} prints no next hint: ${h.stdout}`);
      assert.deepEqual(snapshot(), before, `${label}: leases, the card runs and journals are byte-identical`);
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

/** The CLI with the goal-store call-log preload of card-terminal-goal.test.ts; returns the logged call names in order. */
const PRELOAD = pathToFileURL(fileURLToPath(new URL('./card-terminal-goal.preload.ts', import.meta.url))).href;
function calls(fx: ReturnType<typeof makeFixture>, ...args: string[]): { status: number | null; stderr: string; calls: string[] } {
  const log = path.join(fx.tmp, `calls-${Math.random().toString(16).slice(2)}.log`);
  const r = spawnSync(process.execPath, ['--import', PRELOAD, MAIN, ...args, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-Z', AIDLC_TEST_CALL_LOG: log }, encoding: 'utf8', timeout: 120_000 });
  return { status: r.status, stderr: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [] };
}

test('T0-TAKEOVER-DONE-GOAL-2 acceptance 5: goal takeover reads the goal record once; card takeover, with --goal and without, reads the goal records once, with no getGoal, before its first card-run read [R1] [R2]', () => {
  for (const args of [['card', 'takeover', CARD, '--goal'], ['card', 'takeover', CARD]]) {
    const { fx, goalId } = setup('DONE');
    try {
      // A DONE goal: the whole command logs one listGoals and nothing else.
      const full = args.at(-1) === '--goal' ? [...args, goalId] : args;
      const done = calls(fx, ...full);
      assert.equal(done.status, 0, done.stderr);
      assert.deepEqual(done.calls, ['listGoals'], `${full.join(' ')} on a DONE goal: ${done.calls.join(',')}`);
    } finally {
      fx.cleanup();
    }
    const { fx: live, goalId: liveId } = setup('RUN');
    try {
      const full = args.at(-1) === '--goal' ? [...args, liveId] : args;
      const r = calls(live, ...full);
      assert.equal(r.status, 0, r.stderr);
      const first = r.calls.findIndex((n) => n === 'getCardRun' || n === 'saveCardRun');
      assert.ok(first > 0, `${full.join(' ')} reads the run: ${r.calls.join(',')}`);
      assert.deepEqual(r.calls.slice(0, first), ['listGoals'], `${full.join(' ')} on a RUN goal before the first card-run access: ${r.calls.join(',')}`);
    } finally {
      live.cleanup();
    }
  }
  for (const state of ['DONE', 'RUN'] as const) {
    const { fx, goalId } = setup(state);
    try {
      const r = calls(fx, 'goal', 'takeover', goalId);
      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(r.calls.filter((n) => n === 'getGoal' || n === 'listGoals'), ['getGoal'], `goal takeover on a ${state} goal: ${r.calls.join(',')}`);
    } finally {
      fx.cleanup();
    }
  }
});
