/**
 * T0-REVIEW-CANDIDATE-PINS: a commit R3 decides on keeps a ref, written before the decision. A squash merge leaves a card's
 * commits on its branch alone, so without the ref a deleted branch and an automatic `git gc` lose a commit the ledger names.
 * These runs use real git in a temporary repository and a scripted reviewer.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import type { CardRun, Verdict } from '../../src/core/types.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';

const CARD = 'T0-PIN';
const FILE = 'src/t0-pin.ts';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const REASON = `[standards] 9 error handling @ ${FILE}:1: the value is unchecked -> check it`;
const BLOCK = `${JSON.stringify({ verdict: 'block', reasons: [REASON], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: [REASON] } } })}\n`;
const NO_VERDICT = 'the reviewer printed no verdict\n';
const REVIEWED_CONFIG = {
  gateRequired: true,
  preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false },
  formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false },
};

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** The next commit of the card branch. */
function commitCandidate(fx: Fixture, n: number): string {
  mkdirSync(path.join(fx.tmp, 'src'), { recursive: true });
  writeFileSync(path.join(fx.tmp, FILE), `export const v = ${n};\n`);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', `candidate ${n}`]);
  return git(fx.tmp, ['rev-parse', 'HEAD']);
}

/** A real repository at `fx.tmp`, on a card branch off `main`, with the card committed and the state directory ignored. */
function gitRepo(fx: Fixture): void {
  writeCard(fx, { id: CARD, title: 'pin a candidate', allowPaths: [FILE] });
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  git(fx.tmp, ['checkout', '-q', '-b', CARD]);
}

interface Options {
  /** What `fake-r3` prints, one entry per decision; the last repeats. */
  verdicts?: string[];
  /** Runs for each git call, before it does; a receipt in place of the real result stands in for it. */
  onGit?: SyncRunner;
  /** Runs when the formal reviewer starts. */
  onReview?: () => void;
  isGit?: boolean;
  ship?: DryRunShipPath;
}

function runnerFor(fx: Fixture, o: Options = {}): { runner: CardRunner; calls: string[][] } {
  const calls: string[][] = [];
  const verdicts = [...(o.verdicts ?? [PASS])];
  const reviewers = scriptedRunner({
    'fake-r2': () => ({ stdout: PASS }),
    'fake-r3': () => {
      o.onReview?.();
      return { stdout: verdicts.length > 1 ? verdicts.shift()! : verdicts[0]! };
    },
  });
  const runner: SyncRunner = (command, args, options) => {
    if (command !== 'git') return reviewers(command, args, options);
    calls.push(args);
    return o.onGit?.(command, args, options) ?? runSync(command, args, options);
  };
  const repo = { ...fx.repo, isGit: o.isGit ?? true };
  return { runner: new CardRunner({ paths: fx.paths, repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: o.ship ?? new DryRunShipPath(['merged', 'merged']), now: fx.now, runner }), calls };
}

function openGoal(fx: Fixture): string {
  const goal = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [] }, { cards: [CARD] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [CARD] } });
  return goal.id;
}

/** Record a candidate, pass R2, and run R3 on it. */
async function decide(fx: Fixture, runner: CardRunner, goalId: string, run: CardRun, candidate: string, attempt: number) {
  const card = fx.card(CARD);
  const recorded = runner.recordAttempt(fx.goal(goalId), card, run, { outcome: 'success', dodReceipt: `dod:${attempt}`, redReceipt: 'red:1', candidateSha: candidate });
  const ready = runner.next(fx.goal(goalId), card, recorded);
  const passed = runner.next(fx.goal(goalId), card, (await runner.preReview(fx.goal(goalId), card, ready.run)).run);
  return runner.formalReview(fx.goal(goalId), card, passed.run);
}

function start(fx: Fixture, runner: CardRunner): { goalId: string; run: CardRun } {
  const goalId = openGoal(fx);
  const card = fx.card(CARD);
  const first = runner.next(fx.goal(goalId), card, fx.controller.ensureCardRun(fx.goal(goalId), CARD));
  return { goalId, run: runner.next(fx.goal(goalId), card, first.run).run };
}

const decided = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'REVIEW_DECIDED').map((e) => e.data as Record<string, unknown>);
const pinRef = (sha: string) => `refs/aidlc/candidates/${sha}`;
const pins = (fx: Fixture): string[] => git(fx.tmp, ['for-each-ref', '--format=%(refname)', 'refs/aidlc/candidates/']).split('\n').filter(Boolean);
const summary = (run: CardRun) => ({ state: run.state, decisions: run.review.substantiveDecisions, blocks: run.review.substantiveBlocks, findings: run.findings.map((f) => f.reason) });

test('T0-REVIEW-CANDIDATE-PINS acceptance 1: an R3 pass pins the candidate, which survives a deleted branch and a full prune [R1] [R2]', async () => {
  const fx = makeFixture({ config: REVIEWED_CONFIG });
  try {
    gitRepo(fx);
    const candidate = commitCandidate(fx, 1);
    const { runner } = runnerFor(fx);
    const { goalId, run } = start(fx, runner);
    const result = await decide(fx, runner, goalId, run, candidate, 1);
    assert.equal(result.classified.outcome, 'pass');
    assert.equal(git(fx.tmp, ['rev-parse', pinRef(candidate)]), candidate);
    assert.equal(decided(fx, goalId).at(-1)?.['candidatePinned'], true);
    assert.equal(decided(fx, goalId).at(-1)?.['pinError'], undefined);

    const unpinned = commitCandidate(fx, 2);
    git(fx.tmp, ['checkout', '-q', 'main']);
    git(fx.tmp, ['branch', '-q', '-D', CARD]);
    git(fx.tmp, ['reflog', 'expire', '--expire=now', '--all']);
    git(fx.tmp, ['-c', 'gc.pruneExpire=now', 'gc', '-q']);
    assert.equal(git(fx.tmp, ['cat-file', '-t', candidate]), 'commit', 'the pin keeps the candidate');
    const gone = spawnSync('git', ['cat-file', '-e', `${unpinned}^{commit}`], { cwd: fx.tmp, windowsHide: true });
    assert.notEqual(gone.status, 0, 'the same steps drop a commit with no pin, so the fixture is live');
  } finally {
    fx.cleanup();
  }
});

test('T0-REVIEW-CANDIDATE-PINS acceptance 2: a block and a pass on the repaired candidate leave a ref for each commit [R1]', async () => {
  const fx = makeFixture({ config: REVIEWED_CONFIG });
  try {
    gitRepo(fx);
    const first = commitCandidate(fx, 1);
    const { runner } = runnerFor(fx, { verdicts: [BLOCK, PASS] });
    const { goalId, run } = start(fx, runner);
    const blocked = await decide(fx, runner, goalId, run, first, 1);
    assert.equal(blocked.classified.outcome, 'block-defect');
    const repair = runner.next(fx.goal(goalId), fx.card(CARD), blocked.run);
    const second = commitCandidate(fx, 2);
    const passed = await decide(fx, runner, goalId, repair.run, second, 2);
    assert.equal(passed.classified.outcome, 'pass');
    assert.deepEqual(pins(fx), [pinRef(first), pinRef(second)].sort());
    assert.equal(git(fx.tmp, ['rev-parse', pinRef(first)]), first);
    assert.equal(git(fx.tmp, ['rev-parse', pinRef(second)]), second);
  } finally {
    fx.cleanup();
  }
});

test('T0-REVIEW-CANDIDATE-PINS acceptance 3: a ship-path reviewer pass and block each leave the ref and report it on the event [R1] [R3]', () => {
  for (const [outcome, verdict] of [
    ['review-blocked', 'block'],
    ['merged', 'pass'],
  ] as const) {
    const fx = makeFixture();
    try {
      gitRepo(fx);
      const candidate = commitCandidate(fx, 1);
      const reasons = verdict === 'block' ? [`[spec] 6 tests missing @ ${FILE}:1: no test -> add one`] : [];
      const document: Verdict = { verdict, reasons, axes: { spec: { verdict, reasons }, standards: { verdict: 'pass', reasons: [] } }, sha: candidate, run_status: 'success' };
      const { runner } = runnerFor(fx, { ship: new DryRunShipPath([outcome, outcome], document) });
      const { goalId, run } = start(fx, runner);
      const card = fx.card(CARD);
      const recorded = runner.recordAttempt(fx.goal(goalId), card, run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidate });
      runner.next(fx.goal(goalId), card, recorded);
      assert.equal(git(fx.tmp, ['rev-parse', pinRef(candidate)]), candidate, `the ${verdict} pinned`);
      assert.equal(decided(fx, goalId).at(-1)?.['candidatePinned'], true, `the ${verdict} reported`);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-REVIEW-CANDIDATE-PINS acceptance 4: the pin is written while the invocation is still pending [R1]', async () => {
  const fx = makeFixture({ config: REVIEWED_CONFIG });
  try {
    gitRepo(fx);
    const candidate = commitCandidate(fx, 1);
    let goalId = '';
    const seen: (string | undefined)[] = [];
    const { runner } = runnerFor(fx, {
      onGit: (_command, args) => {
        if (args.includes('update-ref')) seen.push(fx.store.getCardRun(goalId, CARD)?.review.invocations.at(-1)?.outcome);
        return undefined as never;
      },
    });
    const opened = start(fx, runner);
    goalId = opened.goalId;
    await decide(fx, runner, goalId, opened.run, candidate, 1);
    assert.deepEqual(seen, ['pending']);
  } finally {
    fx.cleanup();
  }
});

test('T0-REVIEW-CANDIDATE-PINS R1: a candidate the author replaced during its review is pinned, since the ledger names it', async () => {
  const fx = makeFixture({ config: REVIEWED_CONFIG });
  try {
    gitRepo(fx);
    const candidate = commitCandidate(fx, 1);
    let goalId = '';
    const { runner } = runnerFor(fx, {
      onReview: () => {
        fx.store.updateCardRun(goalId, CARD, (current) => ({ ...current!, candidate: { ...current!.candidate!, sha: 'b'.repeat(40), digest: 'b'.repeat(64) } }));
      },
    });
    const opened = start(fx, runner);
    goalId = opened.goalId;
    await decide(fx, runner, goalId, opened.run, candidate, 1);
    assert.equal(git(fx.tmp, ['rev-parse', pinRef(candidate)]), candidate);
  } finally {
    fx.cleanup();
  }
});

/** The run a decision leaves, with the pin as `onGit` and the setup leave it. */
async function blockedWith(o: Options, setup?: (fx: Fixture) => void) {
  const fx = makeFixture({ config: REVIEWED_CONFIG });
  try {
    gitRepo(fx);
    setup?.(fx);
    const candidate = commitCandidate(fx, 1);
    const { runner } = runnerFor(fx, { ...o, verdicts: [BLOCK] });
    const { goalId, run } = start(fx, runner);
    const result = await decide(fx, runner, goalId, run, candidate, 1);
    return { summary: summary(result.run), event: decided(fx, goalId).at(-1)!, pins: pins(fx) };
  } finally {
    fx.cleanup();
  }
}

test('T0-REVIEW-CANDIDATE-PINS acceptance 5: a failed update-ref or a refused hook name changes nothing of the review and is reported [R3]', async () => {
  const pinned = await blockedWith({});
  assert.equal(pinned.event['candidatePinned'], true);

  const failing = await blockedWith({
    onGit: (command, args, options) => (args.includes('update-ref') ? { ...runSync(command, ['--version'], options), exitCode: 1, stdout: '', stderr: 'fatal: cannot lock ref\nsecond line\n' } : (undefined as never)),
  });
  assert.deepEqual(failing.summary, pinned.summary);
  assert.equal(failing.event['candidatePinned'], false);
  assert.match(String(failing.event['pinError']), /cannot lock ref/);
  assert.doesNotMatch(String(failing.event['pinError']), /\n/, 'the cause is one line');
  assert.deepEqual(failing.pins, []);

  const refused = await blockedWith({}, (fx) => git(fx.tmp, ['config', 'hook.Bench=Hook.event', 'reference-transaction']));
  assert.deepEqual(refused.summary, pinned.summary);
  assert.equal(refused.event['candidatePinned'], false);
  assert.match(String(refused.event['pinError']), /hook\.Bench=Hook\.event/);
  assert.deepEqual(refused.pins, []);
});

const mark = (marker: string) => `echo ran >> '${marker.replace(/\\/g, '/')}'`;

/** Whether a plain `git update-ref` runs the hook, which shows the fixture is live. */
function plainUpdateRunsHook(fx: Fixture, candidate: string, marker: string): boolean {
  rmSync(marker, { force: true });
  git(fx.tmp, ['update-ref', 'refs/aidlc/probe', candidate]);
  git(fx.tmp, ['update-ref', '-d', 'refs/aidlc/probe']);
  const ran = existsSync(marker);
  rmSync(marker, { force: true });
  return ran;
}

test('T0-REVIEW-CANDIDATE-PINS acceptance 6: a hook in .git/hooks or a core.hooksPath directory runs for a plain update-ref and not for the pin [R2]', async () => {
  for (const place of ['hooks', 'hooksPath'] as const) {
    const fx = makeFixture({ config: REVIEWED_CONFIG });
    try {
      gitRepo(fx);
      const candidate = commitCandidate(fx, 1);
      const marker = path.join(fx.tmp, '.aidlc', 'hook-ran');
      const dir = place === 'hooks' ? path.join(fx.tmp, '.git', 'hooks') : path.join(fx.tmp, '.aidlc', 'other-hooks');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'reference-transaction'), `#!/bin/sh\n${mark(marker)}\n`, { mode: 0o755 });
      if (place === 'hooksPath') git(fx.tmp, ['config', 'core.hooksPath', dir.replace(/\\/g, '/')]);
      assert.equal(plainUpdateRunsHook(fx, candidate, marker), true, `the hook of ${place} runs`);
      const config = readFileSync(path.join(fx.tmp, '.git', 'config'));
      const { runner } = runnerFor(fx);
      const { goalId, run } = start(fx, runner);
      await decide(fx, runner, goalId, run, candidate, 1);
      assert.equal(git(fx.tmp, ['rev-parse', pinRef(candidate)]), candidate);
      assert.equal(existsSync(marker), false, 'the pin ran the hook');
      assert.deepEqual(readFileSync(path.join(fx.tmp, '.git', 'config')), config);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-REVIEW-CANDIDATE-PINS acceptance 6: a hook defined in config runs for a plain update-ref and not for the pin, on a git that has such hooks [R2]', async (t) => {
  const fx = makeFixture({ config: REVIEWED_CONFIG });
  try {
    gitRepo(fx);
    const candidate = commitCandidate(fx, 1);
    const marker = path.join(fx.tmp, '.aidlc', 'hook-ran');
    git(fx.tmp, ['config', 'hook.Bench.Hook.event', 'reference-transaction']);
    git(fx.tmp, ['config', 'hook.Bench.Hook.command', mark(marker)]);
    if (!plainUpdateRunsHook(fx, candidate, marker)) return t.skip('this git runs no hook defined in config');
    const { runner } = runnerFor(fx);
    const { goalId, run } = start(fx, runner);
    await decide(fx, runner, goalId, run, candidate, 1);
    assert.equal(git(fx.tmp, ['rev-parse', pinRef(candidate)]), candidate);
    assert.equal(existsSync(marker), false, 'the pin ran the hook');
  } finally {
    fx.cleanup();
  }
});

test('T0-REVIEW-CANDIDATE-PINS acceptance 7: a no-verdict and a quota hold pin nothing and add neither field [R4]', async () => {
  for (const [verdict, outcome] of [
    [NO_VERDICT, 'no-verdict'],
    ['', 'quota-hold'],
  ] as const) {
    const fx = makeFixture({ config: REVIEWED_CONFIG });
    try {
      gitRepo(fx);
      const candidate = commitCandidate(fx, 1);
      const hold = outcome === 'quota-hold';
      const { runner, calls } = hold ? quotaRunner(fx) : runnerFor(fx, { verdicts: [verdict] });
      const { goalId, run } = start(fx, runner);
      const result = await decide(fx, runner, goalId, run, candidate, 1);
      assert.equal(result.classified.outcome, outcome);
      assert.deepEqual(pins(fx), []);
      assert.equal(calls.some((args) => args.includes('update-ref')), false);
      const event = decided(fx, goalId).at(-1);
      assert.equal(event?.['candidatePinned'], undefined);
      assert.equal(event?.['pinError'], undefined);
    } finally {
      fx.cleanup();
    }
  }
});

/** A runner whose formal reviewer exits on a quota message. */
function quotaRunner(fx: Fixture): { runner: CardRunner; calls: string[][] } {
  const calls: string[][] = [];
  const reviewers = scriptedRunner({
    'fake-r2': () => ({ stdout: PASS }),
    'fake-r3': () => ({ exitCode: 1, stderr: '429 Too Many Requests, retry after 60 seconds\n' }),
  });
  const runner: SyncRunner = (command, args, options) => {
    if (command !== 'git') return reviewers(command, args, options);
    calls.push(args);
    return runSync(command, args, options);
  };
  return { runner: new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner }), calls };
}

test('T0-REVIEW-CANDIDATE-PINS acceptance 7: outside a git repository the review makes no git call for a pin and adds neither field [R4]', async () => {
  const fx = makeFixture({ config: REVIEWED_CONFIG });
  try {
    writeCard(fx, { id: CARD, title: 'pin a candidate', allowPaths: [FILE] });
    const { runner, calls } = runnerFor(fx, {
      isGit: false,
      onGit: (command, args, options) => ({ ...runSync(process.execPath, ['--version'], options), command, args, exitCode: 0, stdout: `${FILE}\u0000`, stderr: '' }),
    });
    const { goalId, run } = start(fx, runner);
    const result = await decide(fx, runner, goalId, run, 'sha-1', 1);
    assert.equal(result.classified.outcome, 'pass');
    assert.equal(calls.some((args) => args.includes('update-ref') || args[0] === 'config'), false);
    assert.equal(decided(fx, goalId).at(-1)?.['candidatePinned'], undefined);
  } finally {
    fx.cleanup();
  }
});
