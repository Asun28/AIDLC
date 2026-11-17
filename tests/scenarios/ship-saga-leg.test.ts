import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShipOutput, DryRunShipPath, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { countedFailures, goalForCards, makeFixture, writeCard } from './_harness.ts';

/**
 * A ship path that classifies one scaffold-style output with `classifyShipOutput`, as ScaffoldShipPath does with the
 * output of task.ps1, and keeps the dry-run path's scripted reviewer (the model: ReceiptShipPath of ship-failing-line.test.ts).
 */
class ReceiptShipPath extends DryRunShipPath {
  private readonly stdout: string;
  constructor(stdout: string) {
    super(['dod-failed']);
    this.stdout = stdout;
  }
  override ship(req: ShipRequest): ShipResult {
    const dry = super.ship(req);
    return classifyShipOutput({ ...dry.receipt, command: 'pwsh', exitCode: 1, stdout: this.stdout });
  }
}

const REPORT = '  [SAGA-FAIL] DoD (= first pending leg)';
/** The issue 347 shape (T0-SHIP-SAGA-LEG acceptance 1): license words of the card text and DoD output before the saga report. */
const ISSUE_347 = [
  'card T0-SCRIPTS-ORPHAN-FUNCS: allow_paths docs/LICENSE-POLICY.md',
  'forbid: 依赖许可不合规（见 docs/LICENSE-POLICY.md）',
  'TAP version 13',
  'ok 1 - keeps the orphan list',
  'not ok 2 - removes the orphan functions',
  '  [SAGA-DONE] card-check',
  REPORT,
  '  [SAGA-TODO] verify -> commit -> scope-gate -> budget-gate -> license-gate -> leak-gate -> push+PR -> R3-review -> CI-gate -> merge',
  'DoD 未通过（退出码 1）。修绿再 ship。',
].join('\n');

/** One DoD-green attempt refuted by a ship with the given output, then the next directive. */
function oneShipFailure(stdout: string) {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-SAGA', title: 'the ship fails at its DoD leg' });
    const goal = goalForCards(fx, ['T1-SAGA']);
    const runner = fx.runner(new ReceiptShipPath(stdout));
    const card = fx.card('T1-SAGA');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-SAGA'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    const run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(fx.goal(goal.id), card, run);
    return { directive: r.directive, run: r.run };
  } finally {
    fx.cleanup();
  }
}

test('T0-SHIP-SAGA-LEG acceptance 4: a DoD-leg ship failure holding license words is one counted failed attempt and a build, not a stop [R2]', () => {
  const { directive, run } = oneShipFailure(ISSUE_347);
  assert.equal(directive.kind, 'build', directive.narration);
  if (directive.kind === 'build') assert.equal(directive.attempt, 2);
  assert.equal(run.stop, undefined);
  assert.deepEqual(countedFailures(run.effort!).map((a) => a.cause), ['ship dod-failed: sentinel DoD 未通过; failing line: not ok N - removes the orphan functions']);
});

test('T0-SHIP-SAGA-LEG acceptance 4: the same ship without its leg report is classified as on main and stops the card as STOP/risk [R3]', () => {
  const { directive, run } = oneShipFailure(ISSUE_347.split('\n').filter((l) => l !== REPORT).join('\n'));
  assert.equal(directive.kind, 'stop', directive.narration);
  assert.equal(run.stop?.reason, 'risk');
  assert.match(run.stop?.detail ?? '', /^license-blocked: /);
});
