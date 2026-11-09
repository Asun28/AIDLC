import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

test('T0-CARD-TERMINAL-GOAL acceptance 2: with --goal naming a stopped goal that holds a run of a card it no longer projects, card next and card attempt are refused before that run is read [R1] [R2]', () => {
  const { fx, goalId, cli, types } = setup();
  try {
    writeCard(fx, { id: 'T1-GONE', title: 'a card the goal no longer projects' });
    fx.controller.report({ goalId, generation: 0, result: 'cancel', data: { detail: 'stopped' } });
    // A malformed run, written after the stop: any read of it is a store error, so the refusal shows the guard ran before the read.
    const file = fx.store.cardFile(goalId, 'T1-GONE');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{', 'utf8');
    const before = types();
    for (const args of [['card', 'next', 'T1-GONE', '--goal', goalId], ['card', 'attempt', 'T1-GONE', '--goal', goalId, '--outcome', 'success']]) {
      const r = cli(...args);
      const label = args.join(' ');
      assert.notEqual(r.status, 0, `${label} exits non-zero: ${r.stdout}`);
      for (const part of [goalId, 'cancelled', `aidlc goal resume ${goalId}`]) assert.ok(r.stderr.includes(part), `${label}: the refusal names ${part}, not a store error: ${r.stderr}`);
      assert.equal(readFileSync(file, 'utf8'), '{', `${label} leaves the run file as it was`);
      assert.deepEqual(types(), before, `${label} appends no journal event`);
    }
  } finally {
    fx.cleanup();
  }
});

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

test('T0-CARD-TERMINAL-GOAL acceptance 2: card close --cleanup and --all on a stopped goal are refused without the worktree sweep, which would remove the card worktree of the cancelled goal [R1] [R2]', () => {
  for (const flag of ['--cleanup', '--all']) {
    const { fx, goalId, cli } = setup();
    try {
      fx.controller.ensureCardRun(fx.goal(goalId), CARD);
      fx.controller.report({ goalId, generation: 0, result: 'cancel', data: { detail: 'stopped' } });
      // A git repository on the github ship path with the card's clean worktree: the sweep removes it for the cancelled goal.
      writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\naidlc.config.json\n');
      writeFileSync(path.join(fx.tmp, 'tracked.txt'), 'base\n');
      git(fx.tmp, ['init', '-q', '-b', 'main']);
      git(fx.tmp, ['add', '-A']);
      git(fx.tmp, ['commit', '-q', '-m', 'base']);
      git(fx.tmp, ['branch', CARD]);
      mkdirSync(path.join(fx.tmp, 'wt'), { recursive: true });
      const root = realpathSync.native(path.join(fx.tmp, 'wt'));
      const worktree = path.join(root, CARD);
      git(fx.tmp, ['worktree', 'add', '-q', worktree, CARD]);
      writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'github', worktreeRoot: root, cardsDir: 'specs/tasks', base: 'main' }));
      const r = cli('card', 'close', CARD, '--goal', goalId, flag);
      assert.notEqual(r.status, 0, `card close ${flag} exits non-zero: ${r.stdout}`);
      assert.ok(r.stderr.includes(`aidlc goal resume ${goalId}`), `card close ${flag}: ${r.stderr}`);
      assert.doesNotMatch(r.stderr, /worktree /, `card close ${flag} runs no sweep`);
      assert.equal(existsSync(path.join(worktree, 'tracked.txt')), true, `card close ${flag} leaves the worktree`);
      assert.equal(existsSync(path.join(fx.paths.evidence, goalId, 'review', CARD)), false, `card close ${flag} copies no evidence`);
    } finally {
      fx.cleanup();
    }
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
    const after: string[] = types().slice(before);
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
    // The CLI runs on the real clock, past the fixture's goal deadline: a fixed far deadline keeps the resumed goal from a time stop.
    const g = fx.goal(goalId);
    fx.store.saveGoal({ ...g, deadlines: { ...g.deadlines, goalDeadline: '2099-01-01T00:00:00.000Z' } });
    const resume = cli('goal', 'resume', goalId, '--reason', 'continue the card');
    assert.equal(resume.status, 0, resume.stderr);
    const r = cli('card', 'next', CARD, '--goal', goalId);
    assert.ok(!r.stderr.includes('aidlc goal resume'), `card next is not refused after the resume: ${r.stderr}`);
    assert.equal(r.status, 0, r.stderr);
  } finally {
    fx.cleanup();
  }
});

/** The CLI with the goal-store preload: the call log at `<tmp>/calls.log`, and `env` for the preload's options. */
const PRELOAD = pathToFileURL(fileURLToPath(new URL('./card-terminal-goal.preload.ts', import.meta.url))).href;
function cliWithPreload(fx: ReturnType<typeof makeFixture>, env: Record<string, string>, ...args: string[]) {
  const log = path.join(fx.tmp, 'calls.log');
  writeFileSync(log, '');
  const r = spawnSync(process.execPath, ['--import', PRELOAD, MAIN, ...args, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A', AIDLC_TEST_CALL_LOG: log, ...env }, encoding: 'utf8', timeout: 120_000 });
  return { ...r, calls: readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

test('T0-CARD-TERMINAL-GOAL-2 acceptance 6: card next, attempt, report and close --all read the goal records once, with no getGoal, before the first card-run access, with --goal and without [R5]', () => {
  const commands = [
    ['card', 'next', CARD],
    ['card', 'attempt', CARD, '--outcome', 'success'],
    ['card', 'report', CARD, '--data', '{}'],
    ['card', 'close', CARD, '--all'],
  ];
  for (const base of commands) {
    for (const explicit of [false, true]) {
      const { fx, goalId } = setup();
      try {
        const args = explicit ? [...base, '--goal', goalId] : base;
        const { calls } = cliWithPreload(fx, {}, ...args);
        const first = calls.findIndex((x) => x === 'getCardRun' || x === 'saveCardRun');
        assert.ok(first >= 0, `${args.join(' ')} reaches a card run: ${calls.join(',')}`);
        assert.deepEqual(calls.slice(0, first), ['listGoals'], `${args.join(' ')}: goal-store calls before the first card-run access: ${calls.join(',')}`);
      } finally {
        fx.cleanup();
      }
    }
  }
});

test('T0-CARD-TERMINAL-GOAL-2 acceptance 7: a cancel saved right after the one read lets card close --all reach markClosure, which refuses with the sweep run, and no guard refuses after the sweep is registered [R5] [R6]', () => {
  const { fx, goalId } = setup();
  try {
    const run = fx.controller.ensureCardRun(fx.goal(goalId), CARD);
    fx.store.saveCardRun({ ...run, state: 'CLOSE', mergeVerified: true });
    writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\naidlc.config.json\ncalls.log\n');
    writeFileSync(path.join(fx.tmp, 'tracked.txt'), 'base\n');
    git(fx.tmp, ['init', '-q', '-b', 'main']);
    git(fx.tmp, ['add', '-A']);
    git(fx.tmp, ['commit', '-q', '-m', 'base']);
    git(fx.tmp, ['branch', CARD]);
    mkdirSync(path.join(fx.tmp, 'wt'), { recursive: true });
    const root = realpathSync.native(path.join(fx.tmp, 'wt'));
    git(fx.tmp, ['worktree', 'add', '-q', path.join(root, CARD), CARD]);
    writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'github', worktreeRoot: root, cardsDir: 'specs/tasks', base: 'main' }));
    const r = cliWithPreload(fx, { AIDLC_TEST_CANCEL_AFTER_LIST: goalId }, 'card', 'close', CARD, '--goal', goalId, '--all');
    assert.notEqual(r.status, 0, r.stdout);
    assert.match(r.stderr, /closure cannot change/, 'markClosure refuses the goal the preload cancelled');
    assert.ok(!r.stderr.includes('card commands do no card work'), `no refusal of R2 after the sweep is registered: ${r.stderr}`);
    assert.match(r.stderr, /worktree removed: T1-HELLO/, 'a refusal raised after the read still runs the sweep (R6)');
  } finally {
    fx.cleanup();
  }
});
