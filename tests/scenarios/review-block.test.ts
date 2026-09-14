import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor } from './_harness.ts';
import { DryRunShipPath, type ShipOutcomeClass } from '../../src/delivery/ship.ts';
import { countedFailures } from '../../src/core/effort.ts';
import { CardRun, type Verdict } from '../../src/core/types.ts';

const BLOCK: Verdict = {
  verdict: 'block',
  reasons: ['[spec] 6 tests missing @ src/hello.ts'],
  axes: { spec: { verdict: 'block', reasons: ['tests missing'] }, standards: { verdict: 'pass', reasons: [] } },
  sha: candidateShaFor('T1-HELLO'),
  run_status: 'success',
};

function tierSCard(fx: ReturnType<typeof makeFixture>) {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello', tier: 'S', reviewGate: 'codex {verdict:pass}', acceptance: ['1. hello() returns hello. [dod arm 1]'] });
}

test('Q6: a Tier-S spec block is merge-blocking and routes to REVIEW_FIX with one decision consumed', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new DryRunShipPath(['review-blocked', 'review-blocked'], BLOCK);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'review-fix');
    assert.equal(r.run.state, 'REVIEW_FIX');
    assert.equal(r.run.review.substantiveDecisions, 1);
    assert.equal(r.run.review.substantiveBlocks, 1);
    assert.equal(r.run.review.noVerdictRetriesUsed, 0);
    assert.equal(r.run.dodReceipt, undefined, 'the blocked candidate is no longer a ready candidate');
    if (r.directive.kind === 'review-fix') {
      assert.equal(r.directive.remainingDecisions, 1);
      assert.deepEqual(r.directive.reasons, BLOCK.reasons);
    }
    assert.equal(ship.requests.length, 1);
    const types = fx.events(goal.id).map((e) => e.type);
    assert.ok(types.includes('REVIEW_DECIDED'));
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the review slot is released after the decision');
    assert.equal(r.run.effort?.attempts.at(-1)?.outcome, 'success', 'the blocked attempt keeps its success; the R3 decision paid for the block');
    assert.equal(r.run.effort?.terminal, undefined, 'the episode is reopened for the repair');
    assert.equal(countedFailures(r.run.effort!).length, 0, 'no DoD failure was recorded');
    const repair = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(repair.directive.kind, 'build');
    if (repair.directive.kind === 'build') {
      assert.equal(repair.directive.effort, 'medium', 'the repair runs at the effort that succeeded');
      assert.equal(repair.directive.attempt, 2);
    }
  } finally {
    fx.cleanup();
  }
});

test('Q6: after REVIEW_FIX a repaired candidate ships once more; a second substantive block is STOP/review and no third ship happens', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new DryRunShipPath(['review-blocked', 'review-blocked'], BLOCK);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'review-fix');

    // BUG: src/loop/card-runner.ts — there is no path out of REVIEW_FIX. `next()` keeps returning
    // review-fix because `reviewBlockPending` is true whenever run.state === 'REVIEW_FIX' (line ~138),
    // and `recordAttempt` throws 'no running attempt to finish' because the effort episode is already
    // terminal ('succeeded') and REVIEW_FIX never starts a repair attempt. Expected: the review block
    // marks the previous attempt as a counted failure (cause = review block) so the next `next()` yields
    // a `build` directive for attempt 2; after `recordAttempt` success with a new candidate sha the
    // repaired candidate ships (second substantive decision) and a second block is STOP/review.
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build', `expected a repair attempt after REVIEW_FIX, got ${r.directive.kind}`);
    const run2 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:2', candidateSha: 'sha-repaired' });
    r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'stop');
    assert.equal(r.run.state, 'STOP');
    assert.equal(r.run.stop?.reason, 'review');
    assert.equal(r.run.review.substantiveDecisions, 2);
    assert.equal(r.run.review.substantiveBlocks, 2);
    assert.equal(ship.requests.length, 2, 'no third ship request');
  } finally {
    fx.cleanup();
  }
});

test('R11: a ship-path review block on the escalated success reopens the episode and repairs at the escalated effort', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new DryRunShipPath(['review-blocked', 'merged'], BLOCK);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    let run = r.run;
    for (const cause of ['type error in hello.ts', 'assertion in hello.test.ts', 'timeout in hello.test.ts']) {
      r = runner.next(fx.goal(goal.id), card, run);
      assert.equal(r.directive.kind, 'build');
      run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause, progress: true });
    }
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.equal(r.directive.effort, 'high', 'the fourth attempt is the single escalation');
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:4', redReceipt: 'red:4', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'review-fix', r.directive.narration);
    assert.equal(r.run.effort?.attempts.at(-1)?.outcome, 'success', 'the escalated success is preserved');
    assert.equal(r.run.effort?.terminal, undefined, 'the episode is reopened');
    assert.equal(countedFailures(r.run.effort!).length, 3, 'the failure count is unchanged by the block');
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build', `the repair is admitted, not escalation-failed: ${r.directive.narration}`);
    if (r.directive.kind === 'build') {
      assert.equal(r.directive.effort, 'high', 'the repair runs at the escalated effort');
      assert.equal(r.directive.attempt, 5);
    }
    const repaired = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:5', redReceipt: 'red:4', candidateSha: 'sha-repaired' });
    assert.equal(repaired.effort?.terminal, 'succeeded');
    assert.equal(countedFailures(repaired.effort!).length, 3);
  } finally {
    fx.cleanup();
  }
});

test('Q6: a missing verdict never passes; one retry is offered, then a second no-verdict is STOP/review', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new DryRunShipPath(['review-no-verdict', 'review-no-verdict']);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'ship', 'first no-verdict offers the single retry');
    assert.equal(r.run.state, 'SHIP');
    assert.equal(r.run.review.noVerdictRetriesUsed, 1);
    assert.equal(r.run.review.substantiveDecisions, 0, 'a no-verdict is not a substantive decision');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'slot released after the completed (no-verdict) request');

    // BUG: src/loop/card-runner.ts ship() — the retry of the SAME candidate enqueues the same review key,
    // ReviewQueue.enqueue returns { status: 'completed' } for the earlier no-verdict request, admit() then
    // finds nothing queued and the runner returns a `wait` directive on 'review-pool:default:empty'
    // forever. Expected: a completed request without a verdict (verdictRef 'no-verdict') is re-opened
    // (cancel + enqueue) so the retry ship runs, and the second no-verdict is STOP/review.
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'stop', `expected STOP/review after the retry, got ${r.directive.kind}: ${r.directive.narration}`);
    assert.equal(r.run.stop?.reason, 'review');
    assert.equal(r.run.review.noVerdictRetriesUsed, 2);
    assert.equal(ship.requests.length, 2);
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
  } finally {
    fx.cleanup();
  }
});

test('Q6: a standards-only block on a Tier-1 card is advisory and the merge proceeds', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello', tier: '1', reviewGate: 'codex {verdict:pass}', acceptance: ['1. hello() returns hello. [dod arm 1]'] });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const advisory: Verdict = { ...BLOCK, axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: ['naming'] } } };
    const ship = new DryRunShipPath(['merged'], advisory);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'close');
    assert.equal(r.run.review.substantiveDecisions, 1);
    assert.equal(r.run.review.substantiveBlocks, 0, 'advisory block is not a substantive block');
  } finally {
    fx.cleanup();
  }
});

/** A dry-run ship path whose scripted reviewer returns a different verdict per ship request. */
class SequencedVerdictShipPath extends DryRunShipPath {
  private readonly verdicts: Verdict[];
  constructor(outcomes: ShipOutcomeClass[], verdicts: Verdict[]) {
    super(outcomes);
    this.verdicts = verdicts;
  }
  override readVerdict(): { verdict?: Verdict } {
    const last = this.requests[this.requests.length - 1];
    const verdict = this.verdicts[Math.min(this.requests.length - 1, this.verdicts.length - 1)];
    if (!verdict) return {};
    return { verdict: last?.candidateSha ? { ...verdict, sha: last.candidateSha } : verdict };
  }
}

test('T1-REVIEW-FINDINGS: a ship-path review block records findings; without a command reviewer the disputes reach no reviewer, so the block stays pending until the candidate changes; the ship-path reviewer delivers no findings, so a re-raise answers no dispute and a pass resolves nothing', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const reraise: Verdict = { ...BLOCK, reasons: ['[spec] 6 tests missing @ src/hello.ts: the added test has no assertion (re:F1) -> assert the greeting'], axes: { spec: { verdict: 'block', reasons: ['[spec] 6 tests missing @ src/hello.ts: the added test has no assertion (re:F1) -> assert the greeting'] }, standards: { verdict: 'pass', reasons: [] } } };
    const ship = new SequencedVerdictShipPath(['review-blocked', 'review-blocked'], [BLOCK, reraise]);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run1 = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(g(), card, run1);
    assert.equal(r.directive.kind, 'review-fix');
    assert.deepEqual(r.run.findings.map((f) => [f.id, f.stage, f.round, f.candidateSha]), [['F1', 'formal', 1, candidateShaFor('T1-HELLO')]]);
    const decided = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').at(-1)!;
    assert.deepEqual(decided.data['findings'], ['F1']);

    // The unchanged candidate with the finding open: the block stays pending (no second ship).
    r = runner.next(g(), card, r.run);
    assert.equal(r.directive.kind, 'build');
    assert.equal(r.run.state, 'REVIEW_FIX');
    assert.match(r.directive.narration, /open finding.*F1/is);
    assert.equal(ship.requests.length, 1, 'no ship while the block is pending');

    // Disputed, but the ship-path reviewer re-reads a verdict file and receives no notes: the block stays pending until the candidate changes.
    let run = runner.disputeFinding(g(), card, r.run, 'F1', 'tests/hello.test.ts asserts the greeting at line 8 and fails on the baseline');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    assert.equal(r.run.state, 'REVIEW_FIX');
    assert.match(r.directive.narration, /ship-path reviewer/i);
    assert.equal(ship.requests.length, 1, 'a dispute alone never re-ships to a reviewer that cannot read it');

    // The repaired candidate ships; the reviewer writes re:F1 -> STOP/review. The ship-path reviewer received no findings, so the
    // reference names an id it never had: the reason is a new finding, F1 keeps its dispute for the human adjudicator.
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-repaired' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(ship.requests.length, 2);
    assert.equal(r.run.stop?.reason, 'review');
    assert.match(r.run.stop?.detail ?? '', /second substantive block/);
    assert.ok(!/re-raised after the author/.test(r.run.stop?.detail ?? ''), 'no contest is claimed for a reviewer that never received the dispute');
    const f1 = r.run.findings.find((f) => f.id === 'F1')!;
    assert.equal(f1.reraised.length, 0, 'a reviewer that received no findings cannot re-raise one');
    assert.equal(f1.disposition, 'disputed', 'the dispute is kept for the human adjudicator');
    assert.equal(f1.resolvedAt, undefined);
    assert.deepEqual(r.run.findings.map((f) => f.id), ['F1', 'F2'], 'the reason is recorded as a new finding');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2: a ship-path pass resolves no finding the reviewer never received, and a re-read of the same verdict artifact records no second decision and no finding', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new SequencedVerdictShipPath(['review-blocked', 'merged'], [BLOCK, { verdict: 'pass', reasons: [], sha: 'x', run_status: 'success' }]);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'review-fix');
    r = runner.next(g(), card, r.run);
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-repaired' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    assert.equal(r.run.findings[0]?.resolvedAt, undefined, 'the ship-path pass received no findings and resolves none');
    assert.equal(r.run.review.substantiveDecisions, 2);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2: the same advisory verdict artifact re-read on a CI retry is not a second decision and creates no duplicate finding', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-ADV', title: 'advisory retry', tier: '1', acceptance: ['1. it works. [dod arm 1]'] });
    const goal = goalForCards(fx, ['T1-ADV']);
    const advisory: Verdict = { verdict: 'block', reasons: ['[standards] 16 de-AI-slop @ src/adv.ts:3: duplicated helper -> reuse'], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: ['[standards] 16 de-AI-slop @ src/adv.ts:3: duplicated helper -> reuse'] } }, sha: candidateShaFor('T1-ADV'), run_status: 'success' };
    // First ship: CI red with transient evidence -> one rerun; second ship: merged. The reviewer file is the same advisory verdict both times.
    const ship = new SequencedVerdictShipPath(['ci-red', 'merged'], [advisory, advisory]);
    const runner = fx.runner(ship);
    const card = fx.card('T1-ADV');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-ADV'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-ADV') });
    r = runner.next(g(), card, run);
    const decisionsAfterFirst = r.run.review.substantiveDecisions;
    const findingsAfterFirst = r.run.findings.length;
    assert.equal(findingsAfterFirst, 1, 'the advisory block records its cited reason once');
    // Drive the second ship whatever the CI classification asked for.
    r = runner.next(g(), card, { ...r.run, state: 'SHIP', dodReceipt: 'dod:1', stop: undefined, ci: { reruns: [] } });
    assert.equal(r.run.review.substantiveDecisions, decisionsAfterFirst, 'a re-read of the same verdict artifact is not a second decision');
    assert.equal(r.run.findings.length, findingsAfterFirst, 'no duplicate finding for the identical reason');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2: a ship-path decision records its findings against the record locked at completion, so a dispute saved during the ship survives and the ids stay unique', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const second: Verdict = { ...BLOCK, reasons: ['[spec] 6 tests missing @ src/hello.ts: the added test has no assertion -> assert the greeting'], axes: { spec: { verdict: 'block', reasons: ['[spec] 6 tests missing @ src/hello.ts: the added test has no assertion -> assert the greeting'] }, standards: { verdict: 'pass', reasons: [] } } };
    const ship = new SequencedVerdictShipPath(['review-blocked', 'review-blocked'], [BLOCK, second]);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    r = runner.next(g(), card, run);
    assert.deepEqual(r.run.findings.map((f) => f.id), ['F1']);
    r = runner.next(g(), card, r.run);
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-repaired' });
    // Between the caller's read and the ship's completion another window disputes F1 and a concurrent completion added F2.
    const snapshot = run;
    const concurrent = fx.store.saveCardRun(CardRun.parse({ ...snapshot, findings: [...snapshot.findings.map((f) => ({ ...f, disposition: 'disputed' as const, disputes: [{ at: fx.now(), note: 'the test asserts the greeting', afterReraises: 0 }], revision: f.revision + 1 })), { id: 'F2', stage: 'formal' as const, round: 1, reason: '[standards] 9 error handling @ src/hello.ts:9: swallowed -> rethrow', raisedAt: fx.now(), disposition: 'open' as const, disputes: [], reraised: [], revision: 0 }], updatedAt: fx.now() }));
    assert.equal(concurrent.findings.length, 2);
    r = runner.next(g(), card, snapshot);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    const ids = r.run.findings.map((f) => f.id);
    assert.deepEqual(ids, ['F1', 'F2', 'F3'], 'the new finding takes the next free id of the locked record, never a duplicate of F2');
    assert.equal(r.run.findings.find((f) => f.id === 'F1')?.disposition, 'disputed', 'the dispute saved meanwhile survives the completion');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 R3 decision 1: a ship-path decision persists its invocation, counters and findings in one locked update, so a failure right after it leaves a consistent ledger and a replay records nothing twice', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new DryRunShipPath(['review-blocked', 'review-blocked'], BLOCK);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    // The queue completion after the decision fails once: the decision and its findings are already persisted together.
    const realComplete = fx.queue.complete.bind(fx.queue);
    let failed = false;
    fx.queue.complete = (...args: Parameters<typeof realComplete>) => {
      if (!failed) {
        failed = true;
        throw new Error('queue store unavailable');
      }
      return realComplete(...args);
    };
    try {
      assert.throws(() => runner.next(g(), card, run), /queue store unavailable/);
    } finally {
      fx.queue.complete = realComplete;
    }
    const persisted = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.equal(persisted.review.invocations.filter((i) => i.outcome === 'block').length, 1, 'the decision is persisted with its findings');
    assert.equal(persisted.review.substantiveDecisions, 1);
    assert.deepEqual(persisted.findings.map((f) => f.id), ['F1']);
    // Whatever the loop does next with the interrupted ship, the same artifact is never a second decision or a second finding.
    r = runner.next(g(), card, persisted);
    assert.equal(r.run.review.substantiveDecisions, 1);
    assert.deepEqual(r.run.findings.map((f) => f.id), ['F1']);
  } finally {
    fx.cleanup();
  }
});
