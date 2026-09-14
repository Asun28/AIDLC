import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHubShipPath } from '../../src/delivery/github-ship.ts';
import { scriptedRunner, type ExecReceipt } from '../../src/probes/exec.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { makeFixture, writeCard, goalForCards } from '../scenarios/_harness.ts';

const HEAD = 'a'.repeat(40);

function fixture(verdict?: Record<string, unknown>) {
  const root = mkdtempSync(path.join(tmpdir(), 'aidlc-ghship-'));
  const wtRoot = path.join(root, 'wt');
  const wt = path.join(wtRoot, 'T1-A');
  mkdirSync(path.join(wt, '.review'), { recursive: true });
  mkdirSync(path.join(root, '.git'), { recursive: true });
  if (verdict) writeFileSync(path.join(wt, '.review', 'T1-A.json'), JSON.stringify(verdict));
  return { root, wtRoot, wt };
}

function runnerWith(overrides: Record<string, Partial<ExecReceipt> | ((args: string[]) => Partial<ExecReceipt>)> = {}) {
  return scriptedRunner({
    'gh api user -q .login': { stdout: 'alice\n' },
    'git add -A': {},
    'git diff --cached --quiet': { exitCode: 1 },
    'git commit': {},
    'git rev-parse --verify HEAD': { stdout: HEAD + '\n' },
    'git push': {},
    'gh pr list': { stdout: '[]' },
    'gh pr create': { stdout: 'https://github.com/o/r/pull/42\n' },
    'gh api repos/o/r/commits': { stdout: JSON.stringify({ check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }) },
    'gh pr merge': {},
    'gh pr view': { stdout: JSON.stringify({ number: 42, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', mergedAt: '2026-09-11T00:00:00.000Z', mergeCommit: { oid: 'b'.repeat(40) } }) },
    ...overrides,
  });
}

describe('GitHubShipPath', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('happy path: commit, push, PR, verdict pass, CI green, squash merge -> merged with token', () => {
    const f = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
    dirs.push(f.root);
    const ship = new GitHubShipPath({ mainRoot: f.root, worktreeRoot: f.wtRoot, repository: 'o/r', runner: runnerWith(), sleep: () => {} });
    const r = ship.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
    assert.equal(r.outcome, 'merged');
    assert.equal(r.prNumber, 42);
    assert.equal(ship.readMergeToken('T1-A')?.mergedPr, 42);
    assert.equal(ship.readMergeToken('T1-A')?.tip, HEAD);
  });

  test('missing verdict never merges (review-no-verdict) and nothing is pushed', () => {
    const f = fixture();
    dirs.push(f.root);
    const calls: string[] = [];
    const base = runnerWith();
    const runner: typeof base = (cmd, args, o) => {
      calls.push([cmd, ...args].join(' '));
      return base(cmd, args, o);
    };
    const ship = new GitHubShipPath({ mainRoot: f.root, worktreeRoot: f.wtRoot, repository: 'o/r', runner, sleep: () => {} });
    const r = ship.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
    assert.equal(r.outcome, 'review-no-verdict');
    assert.ok(!calls.some((c) => c.startsWith('git push')));
  });

  test('stale verdict sha is no-verdict; block verdict is review-blocked', () => {
    const stale = fixture({ verdict: 'pass', reasons: [], sha: 'c'.repeat(40) });
    dirs.push(stale.root);
    assert.equal(new GitHubShipPath({ mainRoot: stale.root, worktreeRoot: stale.wtRoot, repository: 'o/r', runner: runnerWith(), sleep: () => {} }).ship({ cardId: 'T1-A', base: 'main', mode: 'remote' }).outcome, 'review-no-verdict');
    const blocked = fixture({ verdict: 'block', reasons: ['[spec] 6'], sha: HEAD, axes: { spec: { verdict: 'block', reasons: ['x'] } } });
    dirs.push(blocked.root);
    assert.equal(new GitHubShipPath({ mainRoot: blocked.root, worktreeRoot: blocked.wtRoot, repository: 'o/r', runner: runnerWith(), sleep: () => {} }).ship({ cardId: 'T1-A', base: 'main', mode: 'remote' }).outcome, 'review-blocked');
  });

  test('auth failure is auth-failed, never a silent local merge', () => {
    const f = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
    dirs.push(f.root);
    const ship = new GitHubShipPath({ mainRoot: f.root, worktreeRoot: f.wtRoot, repository: 'o/r', runner: runnerWith({ 'gh api user -q .login': { exitCode: 1, stderr: 'not logged in' } }), sleep: () => {} });
    assert.equal(ship.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' }).outcome, 'auth-failed');
  });

  test('CI red and CI timeout classify; merge failure classifies', () => {
    const f = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
    dirs.push(f.root);
    const red = new GitHubShipPath({ mainRoot: f.root, worktreeRoot: f.wtRoot, repository: 'o/r', runner: runnerWith({ 'gh api repos/o/r/commits': { stdout: JSON.stringify({ check_runs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] }) } }), sleep: () => {} });
    assert.equal(red.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' }).outcome, 'ci-red');
    const pending = new GitHubShipPath({ mainRoot: f.root, worktreeRoot: f.wtRoot, repository: 'o/r', runner: runnerWith({ 'gh api repos/o/r/commits': { stdout: JSON.stringify({ check_runs: [{ name: 'ci', status: 'in_progress', conclusion: null }] }) } }), sleep: () => {}, ciTimeoutMs: 0 });
    assert.equal(pending.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' }).outcome, 'ci-timeout');
    const mergeFail = new GitHubShipPath({ mainRoot: f.root, worktreeRoot: f.wtRoot, repository: 'o/r', runner: runnerWith({ 'gh pr merge': { exitCode: 1, stderr: 'branch protection' } }), sleep: () => {} });
    assert.equal(mergeFail.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' }).outcome, 'merge-failed');
  });

  test('an already merged PR for the branch is not a new start', () => {
    const f = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
    dirs.push(f.root);
    const ship = new GitHubShipPath({ mainRoot: f.root, worktreeRoot: f.wtRoot, repository: 'o/r', runner: runnerWith({ 'gh pr list': { stdout: JSON.stringify([{ number: 7, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', mergedAt: '2026-09-11T00:00:00.000Z' }]) } }), sleep: () => {} });
    const r = ship.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
    assert.equal(r.outcome, 'merged');
    assert.equal(r.prNumber, 7);
  });
});

describe('GitHubShipPath required checks and config (T1-LOOP-GATES R8)', () => {
  const dirs: string[] = [];
  after(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });
  const runsOf = (runs: Array<{ name: string; status: string; conclusion: string | null }>) => ({ 'gh api repos/o/r/commits': { stdout: JSON.stringify({ check_runs: runs }) } });
  const base = (f: ReturnType<typeof fixture>) => ({ mainRoot: f.root, worktreeRoot: f.wtRoot, repository: 'o/r', sleep: () => {} });

  test('a required check absent from the run list is pending, never satisfied', () => {
    const f = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
    dirs.push(f.root);
    let merges = 0;
    const ship = new GitHubShipPath({ ...base(f), runner: runnerWith({ ...runsOf([{ name: 'ci', status: 'completed', conclusion: 'success' }]), 'gh pr merge': () => { merges += 1; return {}; } }), ciTimeoutMs: 0, requiredChecks: ['ci', 'Gitleaks (committed history)'] });
    const r = ship.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
    assert.equal(r.outcome, 'ci-timeout');
    assert.ok(r.receipt.stdout.includes('Gitleaks (committed history)'), 'the wait names the absent check');
    assert.equal(merges, 0, 'nothing merges while a required check is missing');
    assert.equal(ship.readMergeToken('T1-A'), undefined);
  });

  test('required checks present and green merge; a red check outside the list still reds the gate', () => {
    const f = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
    dirs.push(f.root);
    const green = new GitHubShipPath({ ...base(f), runner: runnerWith(runsOf([{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'Gitleaks (committed history)', status: 'completed', conclusion: 'success' }])), requiredChecks: ['ci', 'Gitleaks (committed history)'] });
    assert.equal(green.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' }).outcome, 'merged');
    const f2 = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
    dirs.push(f2.root);
    const red = new GitHubShipPath({ ...base(f2), runner: runnerWith(runsOf([{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'evals', status: 'completed', conclusion: 'failure' }])), requiredChecks: ['ci'] });
    const r = red.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
    assert.equal(r.outcome, 'ci-red');
    assert.ok(r.receipt.stdout.includes('[CI-GATE-RED] [{"name":"evals","conclusion":"failure"}]'), r.receipt.stdout);
  });

  /** PREPARE and BUILD through the dry-run path (the fixture has no git); the ship is the GitHub path the runner builds from the config. */
  test('a required check that reports skipped or neutral never satisfies the gate: ci-red with the conclusion on the gate line', () => {
    for (const conclusion of ['skipped', 'neutral']) {
      const f = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
      dirs.push(f.root);
      let merges = 0;
      const ship = new GitHubShipPath({ ...base(f), runner: runnerWith({ ...runsOf([{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'Gitleaks (committed history)', status: 'completed', conclusion }]), 'gh pr merge': () => { merges += 1; return {}; } }), requiredChecks: ['ci', 'Gitleaks (committed history)'] });
      const r = ship.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
      assert.equal(r.outcome, 'ci-red', `${conclusion}: ${r.receipt.stdout}`);
      assert.ok(r.receipt.stdout.includes(`[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"${conclusion}"}]`), r.receipt.stdout);
      assert.equal(merges, 0);
    }
    const other = new GitHubShipPath({ ...base(fixture({ verdict: 'pass', reasons: [], sha: HEAD })), runner: runnerWith(runsOf([{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'docs-lint', status: 'completed', conclusion: 'skipped' }])), requiredChecks: ['ci'] });
    assert.equal(other.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' }).outcome, 'merged', 'a skipped check outside the required list is not a failure');
  });

  type Runs = Array<{ name: string; status: string; conclusion: string | null }>;

  test('a pending check named like a sentinel never enters the sentinel stream; a later red scan is ci-red with the names encoded', () => {
    const f = fixture({ verdict: 'pass', reasons: [], sha: HEAD });
    dirs.push(f.root);
    let poll = 0;
    const polls: Runs[] = [
      [{ name: '[SHIP-MERGE-FAIL] diagnostics', status: 'in_progress', conclusion: null }, { name: 'ci', status: 'completed', conclusion: 'success' }],
      [{ name: '[SHIP-MERGE-FAIL] diagnostics', status: 'completed', conclusion: 'success' }, { name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'Gitleaks (committed history)', status: 'completed', conclusion: 'failure' }],
    ];
    const ship = new GitHubShipPath({ ...base(f), runner: runnerWith({ 'gh api repos/o/r/commits': () => ({ stdout: JSON.stringify({ check_runs: polls[Math.min(poll++, 1)] }) }) }) });
    const r = ship.ship({ cardId: 'T1-A', base: 'main', mode: 'remote' });
    assert.equal(r.outcome, 'ci-red', r.receipt.stdout);
    assert.ok(!r.receipt.stdout.includes('[SHIP-MERGE-FAIL]'), 'a check name never forms a sentinel');
    assert.ok(r.receipt.stdout.includes('%5BSHIP-MERGE-FAIL%5D diagnostics'), 'the pending name is logged encoded');
    assert.ok(r.receipt.stdout.includes('[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"failure"}]'), r.receipt.stdout);
  });

  function shipThroughConfig(runsOrPolls: Runs | ((poll: number) => Runs), github: { requiredChecks: string[]; requireVerdict: boolean; ciTimeoutMs?: number; ciPollMs?: number }, verdict?: Record<string, unknown>) {
    let poll = 0;
    const runsFor = () => (typeof runsOrPolls === 'function' ? runsOrPolls(poll++) : runsOrPolls);
    const fx = makeFixture();
    try {
      writeCard(fx, { id: 'T1-GATE', title: 'gate from config' });
      const goal = goalForCards(fx, ['T1-GATE']);
      const card = fx.card('T1-GATE');
      const dry = fx.runner();
      let r = dry.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-GATE'));
      r = dry.next(fx.goal(goal.id), card, r.run);
      const built = dry.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: HEAD });
      mkdirSync(path.join(fx.config.worktreeRoot, 'T1-GATE', '.review'), { recursive: true });
      if (verdict) writeFileSync(path.join(fx.config.worktreeRoot, 'T1-GATE', '.review', 'T1-GATE.json'), JSON.stringify(verdict));
      let merges = 0;
      let pushes = 0;
      const script = runnerWith({ 'gh api repos/o/r/commits': () => ({ stdout: JSON.stringify({ check_runs: runsFor() }) }), 'git push': () => { pushes += 1; return {}; }, 'gh pr merge': () => { merges += 1; return {}; } });
      // No ship path is injected: the runner builds it from the config, so the block below is the only way the options reach the gate.
      const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, gateRequired: true, shipPath: 'github', repository: 'o/r', github }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, runner: script });
      const shipped = runner.next(fx.goal(goal.id), card, built);
      return { kind: shipped.directive.kind, state: shipped.run.state, stopReason: shipped.run.stop?.reason, narration: shipped.directive.narration, merges, pushes, reruns: shipped.run.ci.reruns.length };
    } finally {
      fx.cleanup();
    }
  }

  test('R8: the card runner builds the GitHub ship path from the project config; an absent required check keeps the merge pending and the verdict rule follows the config', () => {
    const github = { requiredChecks: ['ci', 'Gitleaks (committed history)'], requireVerdict: false, ciTimeoutMs: 0, ciPollMs: 1 };
    const green = [{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'Gitleaks (committed history)', status: 'completed', conclusion: 'success' }];
    const absent = shipThroughConfig([{ name: 'ci', status: 'completed', conclusion: 'success' }], github);
    assert.equal(absent.merges, 0, 'nothing merges while a required check is absent from the head');
    assert.equal(absent.kind, 'stop', absent.narration);
    assert.equal(absent.stopReason, 'ci', 'the gate timed out on the absent check; the timeout is an unclassified CI failure');
    const present = shipThroughConfig(green, github);
    assert.equal(present.merges, 1, 'every required check present and green merges; no verdict file exists, so the merge proves requireVerdict false reached the path');
    assert.equal(present.kind, 'close', present.narration);
    assert.equal(present.state, 'CLOSE');
    assert.equal(present.pushes, 1);
    const strict = shipThroughConfig(green, { ...github, requireVerdict: true });
    assert.equal(strict.merges, 0, 'with the verdict rule on, nothing merges without a candidate-bound verdict');
    assert.equal(strict.kind, 'ship', strict.narration);
  });

  test('R7: a pending check named flaky-tests is no transient evidence once build-test fails: STOP/ci with no rerun', () => {
    const github = { requiredChecks: ['ci'], requireVerdict: false, ciTimeoutMs: 60_000, ciPollMs: 1 };
    const polls: Runs[] = [
      [{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'flaky-tests', status: 'in_progress', conclusion: null }],
      [{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: 'flaky-tests', status: 'completed', conclusion: 'success' }, { name: 'build-test', status: 'completed', conclusion: 'failure' }],
    ];
    const r = shipThroughConfig((poll) => polls[Math.min(poll, 1)]!, github);
    assert.equal(r.kind, 'stop', r.narration);
    assert.equal(r.stopReason, 'ci', 'no log text: an unclassified failure, diagnose before any rerun');
    assert.equal(r.reruns, 0, 'the earlier wait line is not transient evidence');
    assert.equal(r.merges, 0);
  });

  test('R7: a native scan name with a Unicode line separator reaches the runner intact: STOP/risk, no rerun, beside a failed flaky-tests check', () => {
    for (const sep of ['\u2028', '\u2029']) {
      const github = { requiredChecks: ['ci'], requireVerdict: false, ciTimeoutMs: 60_000, ciPollMs: 1 };
      const r = shipThroughConfig([{ name: 'ci', status: 'completed', conclusion: 'success' }, { name: `scan (tool=gitleaks,${sep}os=linux)`, status: 'completed', conclusion: 'failure' }, { name: 'flaky-tests', status: 'completed', conclusion: 'failure' }], github);
      assert.equal(r.kind, 'stop', r.narration);
      assert.equal(r.stopReason, 'risk', `U+${sep.charCodeAt(0).toString(16)}: ${r.narration}`);
      assert.equal(r.reruns, 0);
    }
  });

  test('R8: a block verdict for the candidate fails the ship even when the config waives the verdict requirement; nothing is pushed or merged', () => {
    const github = { requiredChecks: ['ci'], requireVerdict: false, ciTimeoutMs: 0, ciPollMs: 1 };
    const blocked = shipThroughConfig([{ name: 'ci', status: 'completed', conclusion: 'success' }], github, { verdict: 'block', reasons: ['[spec] 6 tests missing @ src/a.ts'], sha: HEAD });
    assert.equal(blocked.pushes, 0, 'no remote effect after a blocking verdict, whatever the config says');
    assert.equal(blocked.merges, 0);
    assert.equal(blocked.kind, 'review-fix', blocked.narration);
    assert.equal(blocked.state, 'REVIEW_FIX');
  });
});
