import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShipOutput, DryRunShipPath, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { countedFailures } from '../../src/core/effort.ts';
import { goalForCards, makeFixture, writeCard } from './_harness.ts';

/**
 * A ship path that classifies one scaffold-style receipt per ship, as ScaffoldShipPath does with the output of
 * task.ps1, and keeps the dry-run path's scripted reviewer (card T0-SHIP-FAILING-LINE).
 */
class ReceiptShipPath extends DryRunShipPath {
  private readonly texts: string[];
  constructor(texts: string[]) {
    super(['dod-failed']);
    this.texts = texts;
  }
  override ship(req: ShipRequest): ShipResult {
    const dry = super.ship(req);
    const stdout = this.texts[Math.min(this.requests.length, this.texts.length) - 1]!;
    return classifyShipOutput({ ...dry.receipt, command: 'pwsh', exitCode: 1, stdout });
  }
}

type Counted = 'dod-failed' | 'verify-failed' | 'scope-blocked' | 'budget-over';
const SAGA = '[SAGA-FAIL] ship\n[SAGA-RESUME] pwsh -File scripts\\task.ps1 -TaskId T1-LINE -Phase ship -Base main';
const RECEIPT: Record<Counted, (line: string) => string> = {
  'dod-failed': (line) => ['TAP version 13', 'ok 1 - passes', line, '# fail 1', 'DoD 未通过（退出码 1）。修绿再 ship。', SAGA].join('\n'),
  'verify-failed': (line) => ['ok 1 - the card DoD', line, 'WARNING: pytest 失败（退出码 1）', 'verify: FAIL', 'verify.ps1 未过（项目级回归红）。修绿再 ship。', SAGA].join('\n'),
  'scope-blocked': (line) => [line, 'Fix (L18): revert card-external changes out of this branch with a reverse commit', SAGA].join('\n'),
  'budget-over': (line) => [line, SAGA].join('\n'),
};

/**
 * Per outcome: line `a`, a different line `b`, line `a` again with its numbers changed, and the cause the card runner
 * records for `a` and `b`. The dod and verify outcomes also have two lines that are not failing lines.
 */
const CASES: Record<Counted, { a: string; b: string; again: string; causeA: string; causeB: string; none?: [string, string] }> = {
  'dod-failed': {
    a: 'not ok 3 - parses the header',
    b: 'not ok 3 - parses the footer',
    again: 'not ok 7 - parses the header',
    causeA: 'ship dod-failed: sentinel DoD 未通过; failing line: not ok N - parses the header',
    causeB: 'ship dod-failed: sentinel DoD 未通过; failing line: not ok N - parses the footer',
    none: ['Error: something broke', 'Error: something else broke'],
  },
  'verify-failed': {
    a: 'FAILED tests/test_a.py::test_parse - AssertionError: 1 != 2',
    b: 'FAILED tests/test_b.py::test_parse - AssertionError: 1 != 2',
    again: 'FAILED tests/test_a.py::test_parse - AssertionError: 3 != 4',
    causeA: 'ship verify-failed: sentinel verify\\.ps1 未过; failing line: failed tests/test_a.py::test_parse - assertionerror: N != N',
    causeB: 'ship verify-failed: sentinel verify\\.ps1 未过; failing line: failed tests/test_b.py::test_parse - assertionerror: N != N',
    none: ['Traceback (most recent call last):', 'Traceback (most recent call last):  '],
  },
  'scope-blocked': {
    a: "[SHIP-SCOPE-BLOCK] out-of-scope changes (not under the card's allow_paths): src/a.ts",
    b: "[SHIP-SCOPE-BLOCK] out-of-scope changes (not under the card's allow_paths): src/b.ts",
    again: "[SHIP-SCOPE-BLOCK] out-of-scope changes (not under the card's allow_paths): src/a.ts",
    causeA: "ship scope-blocked: sentinel \\[SHIP-SCOPE-BLOCK\\]; failing line: %5Bship-scope-block%5D out-of-scope changes (not under the card's allow_paths): src/a.ts",
    causeB: "ship scope-blocked: sentinel \\[SHIP-SCOPE-BLOCK\\]; failing line: %5Bship-scope-block%5D out-of-scope changes (not under the card's allow_paths): src/b.ts",
  },
  'budget-over': {
    a: "[CARD-BUDGET-OVER] this card's diff is 812 lines against a budget of 720 declared on the BASE card",
    b: "[CARD-BUDGET-UNDECIDABLE] could not measure the diff against 'origin/main' (git diff --numstat exited non-zero)",
    again: "[CARD-BUDGET-OVER] this card's diff is 905 lines against a budget of 400 declared on the BASE card",
    causeA: "ship budget-over: sentinel \\[CARD-BUDGET-OVER\\]; failing line: %5Bcard-budget-over%5D this card's diff is N lines against a budget of N declared on the base card",
    causeB: "ship budget-over: sentinel \\[CARD-BUDGET-OVER\\]; failing line: %5Bcard-budget-undecidable%5D could not measure the diff against 'origin/main' (git diff --numstat exited non-zero)",
  },
};

/** Two DoD-green attempts, each refuted by a ship of `outcome` with the given receipt lines, without progress. */
function twoShipFailures(outcome: Counted, first: string, second: string) {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-LINE', title: 'the ship fails on its own code twice' });
    const goal = goalForCards(fx, ['T1-LINE']);
    const runner = fx.runner(new ReceiptShipPath([RECEIPT[outcome](first), RECEIPT[outcome](second)]));
    const card = fx.card('T1-LINE');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-LINE'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    for (let n = 1; n <= 2; n += 1) {
      assert.equal(r.directive.kind, 'build', `${outcome}: attempt ${n} is a build: ${r.directive.narration}`);
      if (r.directive.kind === 'build') assert.equal(r.directive.attempt, n);
      const run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: `dod:${n}`, redReceipt: 'red:1', candidateSha: `sha-${n}` });
      r = runner.next(fx.goal(goal.id), card, run);
    }
    return { directive: r.directive, effort: r.run.effort! };
  } finally {
    fx.cleanup();
  }
}

for (const outcome of Object.keys(CASES) as Counted[]) {
  const c = CASES[outcome];

  test(`T0-SHIP-FAILING-LINE acceptance 4 (${outcome}): two ship failures on different lines are two causes, and the ladder admits attempt 3`, () => {
    const { directive, effort } = twoShipFailures(outcome, c.a, c.b);
    assert.equal(directive.kind, 'build', directive.narration);
    if (directive.kind === 'build') assert.equal(directive.attempt, 3);
    assert.equal(effort.terminal, undefined, 'the episode is open');
    assert.deepEqual(countedFailures(effort).map((a) => a.cause), [c.causeA, c.causeB]);
  });

  test(`T0-SHIP-FAILING-LINE acceptance 4 (${outcome}): the same line twice, its numbers changed, stops the card as same-cause-stop`, () => {
    const { directive, effort } = twoShipFailures(outcome, c.a, c.again);
    assert.equal(directive.kind, 'stop', directive.narration);
    if (directive.kind === 'stop') assert.match(directive.stop.detail, /same-cause-stop/);
    assert.equal(effort.terminal, 'same-cause-stop');
    assert.equal(countedFailures(effort)[0]!.cause, c.causeA);
  });

  const none = c.none;
  if (none) {
    test(`T0-SHIP-FAILING-LINE acceptance 4 (${outcome}): two ship failures with no failing line are one cause and stop the card`, () => {
      const { directive, effort } = twoShipFailures(outcome, none[0], none[1]);
      assert.equal(directive.kind, 'stop', directive.narration);
      assert.equal(effort.terminal, 'same-cause-stop');
      const constant = outcome === 'dod-failed' ? 'ship dod-failed: sentinel DoD 未通过' : 'ship verify-failed: sentinel verify\\.ps1 未过';
      assert.deepEqual(countedFailures(effort).map((a) => a.cause), [constant, constant]);
    });
  }
}
