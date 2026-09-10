import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GitHubShipPath } from '../../src/delivery/github-ship.ts';
import { scriptedRunner, type ExecReceipt } from '../../src/probes/exec.ts';

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
