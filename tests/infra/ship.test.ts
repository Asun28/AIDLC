import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DryRunShipPath, ScaffoldShipPath, classifyShipOutput, type ShipOutcomeClass } from '../../src/delivery/ship.ts';
import type { ExecReceipt } from '../../src/probes/exec.ts';
import { cleanup, tmpDir } from './helpers.ts';

function receipt(stdout: string, exitCode = 1, extra: Partial<ExecReceipt> = {}): ExecReceipt {
  const now = new Date().toISOString();
  return { command: 'pwsh', args: [], cwd: '', exitCode, signal: null, timedOut: false, stdout, stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '', ...extra };
}

// One representative sentinel per class of the (module-private) SENTINEL_MAP, in its precedence order.
const SENTINELS: Array<[string, ShipOutcomeClass]> = [
  ['[SHIP-MERGE-FAIL]', 'merge-failed'],
  ['[CI-GATE-TIMEOUT]', 'ci-timeout'],
  ['[CI-GATE-RED]', 'ci-red'],
  ['[CI-GATE-HEAD-MOVED]', 'ci-red'],
  ['[R3-SPEC-BLOCK]', 'review-blocked'],
  ['[R3-ROUND-CAP]', 'review-blocked'],
  ['[R3-REVIEWER-TIMEOUT]', 'review-no-verdict'],
  ['[R3-STALE-VERDICT-SHA]', 'review-no-verdict'],
  ['[R3-BAD-VERDICT-JSON]', 'review-no-verdict'],
  ['[SHIP-NO-REVIEWER]', 'no-reviewer'],
  ['[SHIP-PR-RETARGET]', 'pr-failed'],
  ['[SHIP-PUSH-FAIL]', 'push-failed'],
  ['[CARD-BUDGET-OVER]', 'budget-over'],
  ['[R3-DIFF-TOO-LARGE]', 'budget-over'],
  ['[SHIP-SCOPE-BLOCK]', 'scope-blocked'],
  ['[SHIP-SCOPE-ALLOW-EMPTY]', 'scope-blocked'],
  ['先跑：gh auth login', 'auth-failed'],
  ['缺少 RED 证据（.review\\T1-FOO.red）', 'red-missing'],
  ['检出疑似机密（见上 check-secrets）', 'secrets-blocked'],
  ['依赖许可不合规（见 docs/LICENSE-POLICY.md）', 'license-blocked'],
  ['verify: FAIL', 'verify-failed'],
  ['DoD 未通过（退出码 1）。修绿再 ship。', 'dod-failed'],
];

describe('delivery/ship (classification of the scaffold ship saga)', () => {
  it('maps every known sentinel to its outcome class', () => {
    for (const [sentinel, cls] of SENTINELS) {
      const r = classifyShipOutput(receipt(`[SAGA-FAIL] leg failed\n${sentinel}\n`));
      assert.equal(r.outcome, cls, `${sentinel} -> ${r.outcome}`);
      if (sentinel.startsWith('[')) assert.ok(r.sentinels.includes(sentinel), `sentinels should list ${sentinel}`);
    }
  });

  it('exit 0 without a saga failure is merged; exit 0 with SAGA-FAIL still classifies the sentinel', () => {
    const merged = classifyShipOutput(receipt('[SHIP-TIME] merge 3s\n[SAGA-DONE]\n', 0));
    assert.equal(merged.outcome, 'merged');
    assert.match(merged.detail, /exited 0/);
    const plain = classifyShipOutput(receipt('all good', 0));
    assert.equal(plain.outcome, 'merged');
    const contradictory = classifyShipOutput(receipt('[SAGA-FAIL]\n[CI-GATE-RED]\n', 0));
    assert.equal(contradictory.outcome, 'ci-red');
  });

  it('captures the resume command and PR number; timeouts and unknown exits are unclassified', () => {
    const r = classifyShipOutput(receipt('[SAGA-FAIL] CI-gate\n[CI-GATE-RED] job ci red\nPR #17 opened\n[SAGA-RESUME] pwsh -File scripts\\task.ps1 -TaskId T1-FOO -Phase ship -Base main\n'));
    assert.equal(r.outcome, 'ci-red');
    assert.equal(r.prNumber, 17);
    assert.equal(r.resumeCommand, 'pwsh -File scripts\\task.ps1 -TaskId T1-FOO -Phase ship -Base main');
    const timeout = classifyShipOutput(receipt('[SHIP-TIME] DoD 12s', null as unknown as number, { timedOut: true }));
    assert.equal(timeout.outcome, 'unclassified');
    assert.match(timeout.detail, /timed out; reconcile before retry/);
    const unknown = classifyShipOutput(receipt('something odd happened', 1));
    assert.equal(unknown.outcome, 'unclassified');
    assert.match(unknown.detail, /exit 1 with no known sentinel/);
  });
});

describe('delivery/ship ScaffoldShipPath (file contracts)', () => {
  const dir = tmpDir();
  const mainRoot = path.join(dir, 'repo');
  const worktreeRoot = path.join(dir, 'wt');
  after(() => cleanup(dir));

  it('readVerdict reads .review/<branch>.json and .rounds from the card worktree', () => {
    const review = path.join(worktreeRoot, 'T1-FOO', '.review');
    mkdirSync(review, { recursive: true });
    writeFileSync(path.join(review, 'T1-FOO.json'), JSON.stringify({ verdict: 'block', reasons: ['[spec] 6 tests missing'], sha: 'abc', branch: 'T1-FOO', run_status: 'success', axes: { spec: { verdict: 'block', reasons: ['tests'] }, standards: { verdict: 'pass', reasons: [] } } }), 'utf8');
    writeFileSync(path.join(review, 'T1-FOO.rounds'), '2\n', 'utf8');
    const ship = new ScaffoldShipPath({ mainRoot, worktreeRoot });
    const v = ship.readVerdict('T1-FOO');
    assert.equal(v.file, path.join(review, 'T1-FOO.json'));
    assert.equal(v.rounds, 2);
    assert.equal(v.verdict?.verdict, 'block');
    assert.equal(v.verdict?.axes?.spec?.verdict, 'block');
    assert.equal(v.verdict?.run_status, 'success');
    // malformed or wrongly-cased verdicts are not verdicts
    writeFileSync(path.join(review, 'T1-FOO.json'), JSON.stringify({ verdict: 'BLOCK', reasons: [] }), 'utf8');
    assert.equal(ship.readVerdict('T1-FOO').verdict, undefined);
    writeFileSync(path.join(review, 'T1-FOO.json'), 'prose, not json', 'utf8');
    const raw = ship.readVerdict('T1-FOO');
    assert.equal(raw.verdict, undefined);
    assert.equal(raw.raw, 'prose, not json');
    assert.deepEqual(ship.readVerdict('T2-NONE'), { file: path.join(worktreeRoot, 'T2-NONE', '.review', 'T2-NONE.json'), rounds: undefined });
  });

  it('readRedReceipt reads the RED phase receipt', () => {
    const review = path.join(worktreeRoot, 'T1-RED', '.review');
    mkdirSync(review, { recursive: true });
    writeFileSync(path.join(review, 'T1-RED.red'), JSON.stringify({ taskId: 'T1-RED', sha: '(no-commit-yet)', dodExit: 1, phase: 'red' }), 'utf8');
    const ship = new ScaffoldShipPath({ mainRoot, worktreeRoot });
    assert.deepEqual(ship.readRedReceipt('T1-RED'), { taskId: 'T1-RED', sha: '(no-commit-yet)', dodExit: 1, phase: 'red' });
    assert.equal(ship.readRedReceipt('T1-NONE'), undefined);
  });

  it('readMergeToken parses the T24 merge credential from the git common dir', () => {
    const tokens = path.join(mainRoot, '.git', 'scaffold-merged');
    mkdirSync(tokens, { recursive: true });
    writeFileSync(path.join(tokens, 'T1-FOO'), 'tip=abcdef0123456789abcdef0123456789abcdef01\nmerged_pr=#12\nutc=2026-09-11T10:00:00Z\n', 'utf8');
    writeFileSync(path.join(tokens, 'T1-LOCAL'), 'tip=1111\nmerged=2222\nutc=2026-09-11T11:00:00Z', 'utf8');
    const ship = new ScaffoldShipPath({ mainRoot, worktreeRoot });
    assert.deepEqual(ship.readMergeToken('T1-FOO'), { tip: 'abcdef0123456789abcdef0123456789abcdef01', mergedPr: 12, utc: '2026-09-11T10:00:00Z' });
    assert.deepEqual(ship.readMergeToken('T1-LOCAL'), { tip: '1111', merged: '2222', utc: '2026-09-11T11:00:00Z' });
    assert.equal(ship.readMergeToken('T1-NONE'), undefined);
  });

  it('ship() drives task.ps1 from the main checkout with preserved base and mode', () => {
    const seen: Array<{ cmd: string; args: string[]; cwd?: string }> = [];
    const ship = new ScaffoldShipPath({
      mainRoot,
      worktreeRoot,
      pwsh: 'pwsh-test',
      runner: (cmd, args, options) => {
        seen.push({ cmd, args, cwd: options?.cwd });
        return receipt('[SAGA-DONE]\n', 0);
      },
    });
    const r = ship.ship({ cardId: 'T1-FOO', base: 'origin/main', mode: 'local', skipRed: true, noAutoMerge: true });
    assert.equal(r.outcome, 'merged');
    assert.equal(seen[0]!.cmd, 'pwsh-test');
    assert.equal(seen[0]!.cwd, mainRoot);
    assert.deepEqual(seen[0]!.args, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(mainRoot, 'scripts', 'task.ps1'), '-TaskId', 'T1-FOO', '-Phase', 'ship', '-Base', 'origin/main', '-Local', '-SkipRed', '-NoAutoMerge']);
    ship.phase('T1-FOO', 'cleanup', ['-Force']);
    assert.deepEqual(seen[1]!.args.slice(-3), ['-Phase', 'cleanup', '-Force']);
    assert.equal(ship.worktreePath('T1-FOO'), path.join(worktreeRoot, 'T1-FOO'));
  });
});

describe('delivery/ship DryRunShipPath', () => {
  it('returns scripted outcomes in order, clamping to the last one, and records requests', () => {
    const dry = new DryRunShipPath(['dod-failed', 'review-blocked', 'merged'], { verdict: 'pass', reasons: [] });
    const req = { cardId: 'T1-FOO', base: 'main', mode: 'remote' as const };
    assert.equal(dry.ship(req).outcome, 'dod-failed');
    assert.equal(dry.ship(req).outcome, 'review-blocked');
    assert.equal(dry.ship(req).outcome, 'merged');
    assert.equal(dry.ship(req).outcome, 'merged');
    assert.equal(dry.requests.length, 4);
    assert.equal(dry.ship(req).receipt.exitCode, 0);
    assert.equal(new DryRunShipPath(['ci-red']).ship(req).receipt.exitCode, 1);
    assert.equal(dry.readVerdict().verdict?.verdict, 'pass');
    assert.equal(dry.readMergeToken(), undefined);
    assert.equal(new DryRunShipPath().ship(req).outcome, 'merged');
  });
});
