import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor, InjectedShipPath } from './_harness.ts';
import { DryRunShipPath, type ShipOutcomeClass } from '../../src/delivery/ship.ts';
import { countedFailures } from '../../src/core/effort.ts';
import { CardRun, type Verdict } from '../../src/core/types.ts';
import { rmSync, writeFileSync } from 'node:fs';

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

/** A ship path whose review-queue completion runs `during` (another window acting while the ship result is being applied). */
function duringQueueCompletion(fx: ReturnType<typeof makeFixture>, during: () => void, body: () => void): void {
  const real = fx.queue.complete.bind(fx.queue);
  let fired = false;
  fx.queue.complete = (...args: Parameters<typeof real>) => {
    if (!fired) {
      fired = true;
      during();
    }
    return real(...args);
  };
  try {
    body();
  } finally {
    fx.queue.complete = real;
  }
}

test('T1-REVIEW-FINDINGS-3 acceptance 10: a candidate or a stop recorded while the ship result is being applied is never overwritten by the shipped candidate\'s outcome; the outcome is history', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    // (1) A newer candidate lands after the ship read the persisted record.
    let runner = fx.runner(new DryRunShipPath(['review-blocked', 'review-blocked'], BLOCK));
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    let after: ReturnType<typeof runner.next> | undefined;
    duringQueueCompletion(fx, () => {
      const now = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
      fx.store.saveCardRun(CardRun.parse({ ...now, candidate: { sha: 'sha-newer', dirty: false, untracked: [], digest: 'sha-newer' }, dodReceipt: 'dod:newer', updatedAt: fx.now() }));
    }, () => {
      after = runner.next(g(), card, run);
    });
    let persisted = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.equal(persisted.candidate?.sha, 'sha-newer', 'the newer candidate stays');
    assert.equal(persisted.dodReceipt, 'dod:newer', 'the newer candidate keeps its receipt');
    assert.notEqual(persisted.state, 'REVIEW_FIX');
    assert.equal(persisted.review.substantiveDecisions, 1, 'the decision on the shipped candidate is history');
    assert.match(after!.directive.narration, /candidate changed|superseded/i, after!.directive.narration);
    // (2) A stop lands after the ship read the persisted record: it stays, and the ship outcome is history.
    const second = fx.store.saveCardRun(CardRun.parse({ ...persisted, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2', state: 'BUILD', updatedAt: fx.now() }));
    runner = fx.runner(new DryRunShipPath(['merged']));
    duringQueueCompletion(fx, () => {
      const now = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
      fx.store.saveCardRun(CardRun.parse({ ...now, state: 'STOP', stop: { reason: 'review', detail: 'stopped by the adjudicator', nextAction: 'human ruling', at: fx.now(), global: false, unresolvedOperations: [] }, updatedAt: fx.now() }));
    }, () => {
      after = runner.next(g(), card, second);
    });
    persisted = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.equal(persisted.state, 'STOP', 'the stop recorded meanwhile stays');
    assert.equal(persisted.stop?.detail, 'stopped by the adjudicator');
    assert.equal(after!.directive.kind, 'stop');
    assert.equal(persisted.mergeVerified, false, 'the merge of a stopped run is not applied as a verified merge');
  } finally {
    fx.cleanup();
  }
});

/** A ship path during whose ship another window records a newer candidate with its own DoD receipt. */
class SupersedingShipPath extends DryRunShipPath {
  private readonly fx: ReturnType<typeof makeFixture>;
  private readonly goalId: string;
  constructor(fx: ReturnType<typeof makeFixture>, goalId: string, outcomes: ShipOutcomeClass[], verdict: Verdict) {
    super(outcomes, verdict);
    this.fx = fx;
    this.goalId = goalId;
  }
  override ship(req: Parameters<DryRunShipPath['ship']>[0]): ReturnType<DryRunShipPath['ship']> {
    const now = this.fx.store.getCardRun(this.goalId, req.cardId)!;
    this.fx.store.saveCardRun(CardRun.parse({ ...now, candidate: { sha: 'sha-newer', dirty: false, untracked: [], digest: 'sha-newer' }, dodReceipt: 'dod:newer', updatedAt: this.fx.now() }));
    return super.ship(req);
  }
}

test('T1-REVIEW-FINDINGS-2 R2 cycle 1 round 1: a ship result for a candidate replaced during the ship is recorded as history; the newer candidate keeps its receipt, state and identity', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const ship = new SupersedingShipPath(fx, goal.id, ['review-blocked'], BLOCK);
    const runner = fx.runner(ship);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    const after = runner.next(g(), card, run);
    const persisted = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.equal(persisted.candidate?.sha, 'sha-newer', "the newer candidate is the run's candidate");
    assert.equal(persisted.dodReceipt, 'dod:newer', 'the newer candidate keeps its receipt');
    assert.equal(persisted.blockedReceipt, undefined, 'no receipt of another candidate is retained under this block');
    assert.notEqual(persisted.state, 'REVIEW_FIX', 'the block of the shipped candidate does not move the newer candidate');
    assert.equal(persisted.review.substantiveDecisions, 1, 'the decision on the shipped candidate is history');
    assert.deepEqual(persisted.findings.map((f) => [f.id, f.candidateSha]), [['F1', candidateShaFor('T1-HELLO')]]);
    assert.equal(after.run.candidate?.sha, 'sha-newer');
    assert.match(after.directive.narration, /candidate changed|superseded/i, after.directive.narration);
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

test('T1-REVIEW-FINDINGS-3 R3 decision 1: a decision or a check failure recorded while the ship result is applied is kept: the ledger is not overwritten, the action follows it, and no receipt is recreated', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    const runner = fx.runner(new DryRunShipPath(['review-blocked', 'review-blocked'], BLOCK));
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    assert.throws(() => runner.recordAttempt(g(), card, run, { outcome: 'success', dodReceipt: 'dod:x', checksLost: ['tests/a.test.ts'] }), /lost checks|contradict/i, 'a success that lost checks is refused');
    // While the ship result is applied, another window records a formal decision (a block) and a failed check on the same candidate.
    let after: ReturnType<typeof runner.next> | undefined;
    duringQueueCompletion(fx, () => {
      fx.store.updateCardRun(goal.id, 'T1-HELLO', (current) => ({ ...current!, dodReceipt: undefined, blockedReceipt: undefined, review: { ...current!.review, substantiveDecisions: current!.review.substantiveDecisions + 1, substantiveBlocks: current!.review.substantiveBlocks + 1, invocations: [...current!.review.invocations, { invocationId: 'r3:other', candidateDigest: candidateShaFor('T1-HELLO'), candidateSha: candidateShaFor('T1-HELLO'), base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'codex', requestedAt: fx.now(), outcome: 'block' as const, runStatus: 'success' as const, mergeBlocking: true }] } }));
    }, () => {
      after = runner.next(g(), card, run);
    });
    const persisted = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.ok(persisted.review.invocations.some((i) => i.invocationId === 'r3:other'), 'the decision recorded meanwhile survives the ship write');
    const blocks = persisted.review.invocations.filter((i) => i.outcome === 'block').length;
    assert.equal(blocks, 2);
    assert.equal(persisted.review.substantiveBlocks, 2, 'the counters count both decisions');
    assert.equal(persisted.state, 'STOP', 'two blocks stop the card whichever completed first');
    assert.equal(after!.directive.kind, 'stop');
    assert.equal(persisted.blockedReceipt, undefined, 'a receipt cleared by the failed check meanwhile is not recreated from the pre-ship snapshot');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-3 R2 cycle 1 round 3: the run is re-read under the lock right before the ship is dispatched: a candidate or a reservation recorded after the gate cancels the dispatch', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    const ship = new DryRunShipPath(['merged', 'merged']);
    const runner = fx.runner(ship);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    /** Between the gate and the dispatch (at pool admission) another window writes `during`. */
    const atAdmission = (during: () => void, body: () => ReturnType<typeof runner.next>) => {
      const real = fx.queue.admit.bind(fx.queue);
      let fired = false;
      fx.queue.admit = (...args: Parameters<typeof real>) => {
        if (!fired) {
          fired = true;
          during();
        }
        return real(...args);
      };
      try {
        return body();
      } finally {
        fx.queue.admit = real;
      }
    };
    // (1) A newer candidate with its own receipt lands after the gate: the ship for the old one is not dispatched.
    let after = atAdmission(
      () => fx.store.updateCardRun(goal.id, 'T1-HELLO', (current) => ({ ...current!, candidate: { sha: 'sha-newer', dirty: false, untracked: [], digest: 'sha-newer' }, dodReceipt: 'dod:newer' })),
      () => runner.next(g(), card, run),
    );
    assert.equal(ship.requests.length, 0, 'no ship is dispatched for a candidate the record no longer holds');
    assert.equal(after.directive.kind, 'wait', after.directive.narration);
    assert.match(after.directive.narration, /candidate|changed/i);
    assert.equal(fx.ops.unresolved(goal.id, 'T1-HELLO').filter((o) => o.status === 'issued' || o.status === 'running' || o.status === 'UNKNOWN').length, 0, 'the operation intent is cancelled');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the pool slot is released');
    // (2) A pre-review round reserved after the gate parks the ship as well.
    let current = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    after = atAdmission(
      () => fx.store.updateCardRun(goal.id, 'T1-HELLO', (c) => ({ ...c!, preReview: { ...c!.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'r2', candidateDigest: 'sha-newer', candidateSha: 'sha-newer', requestedAt: fx.now(), durationMs: 0, outcome: 'pending', reasons: [], reservationId: 'res-late' }] } })),
      () => runner.next(g(), card, current),
    );
    assert.equal(ship.requests.length, 0, 'no ship is dispatched while a review is reserved');
    assert.equal(after.directive.kind, 'wait', after.directive.narration);
    assert.equal(fx.ops.unresolved(goal.id, 'T1-HELLO').filter((o) => o.status === 'issued' || o.status === 'running' || o.status === 'UNKNOWN').length, 0);
    // With the record as the gate saw it, the ship runs.
    current = fx.store.updateCardRun(goal.id, 'T1-HELLO', (c) => ({ ...c!, preReview: { ...c!.preReview, rounds: [] } }));
    after = runner.next(g(), card, current);
    assert.equal(ship.requests.length, 1);
    assert.equal(after.directive.kind, 'close', after.directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 acceptance 15: a pre-dispatch re-read whose lock acquisition fails cancels the intent and the pool admission and keeps the original error', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    const ship = new DryRunShipPath(['merged']);
    const runner = fx.runner(ship);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    const lock = `${fx.store.cardFile(goal.id, 'T1-HELLO')}.lock`;
    const real = fx.queue.admit.bind(fx.queue);
    fx.queue.admit = (...args: Parameters<typeof real>) => {
      writeFileSync(lock, `pid=${process.pid} at=now nonce=held`, 'utf8');
      return real(...args);
    };
    try {
      assert.throws(() => runner.next(g(), card, run), /locked/i);
    } finally {
      fx.queue.admit = real;
      rmSync(lock, { force: true });
    }
    assert.equal(ship.requests.length, 0);
    assert.equal(fx.ops.unresolved(goal.id, 'T1-HELLO').filter((o) => o.status === 'issued' || o.status === 'running' || o.status === 'UNKNOWN').length, 0, 'the intent is cancelled');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the pool admission is released');
    // The next call ships.
    const after = runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(ship.requests.length, 1);
    assert.equal(after.directive.kind, 'close', after.directive.narration);
  } finally {
    fx.cleanup();
  }
});

/** A ship path that counts how often its verdict file is read. */
class CountingVerdictShipPath extends SequencedVerdictShipPath {
  reads = 0;
  override readVerdict(): { verdict?: Verdict } {
    this.reads += 1;
    return super.readVerdict();
  }
}

test('T1-REVIEW-FINDINGS-4 acceptance 16: the same ship result applied twice through applyShipResult reads the artifact twice and records one decision and one finding', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-ADV2', title: 'advisory re-read', tier: '1', acceptance: ['1. it works. [dod arm 1]'] });
    const goal = goalForCards(fx, ['T1-ADV2']);
    const advisory: Verdict = { verdict: 'block', reasons: ['[standards] 16 de-AI-slop @ src/adv2.ts:3: duplicated helper -> reuse'], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: ['[standards] 16 de-AI-slop @ src/adv2.ts:3: duplicated helper -> reuse'] } }, sha: candidateShaFor('T1-ADV2'), run_status: 'success' };
    const ship = new CountingVerdictShipPath(['merged'], [advisory]);
    const runner = fx.runner(ship);
    const card = fx.card('T1-ADV2');
    const g = () => fx.goal(goal.id);
    // The arguments of the first application are captured: the identical result, operation and key are replayed below.
    const realApply = runner.applyShipResult.bind(runner);
    let captured: Parameters<typeof realApply> | undefined;
    runner.applyShipResult = ((...args: Parameters<typeof realApply>) => {
      captured ??= args;
      return realApply(...args);
    }) as typeof runner.applyShipResult;
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-ADV2'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-ADV2') });
    r = runner.next(g(), card, run);
    runner.applyShipResult = realApply;
    assert.ok(captured, 'fixture: the ship result was applied once');
    assert.equal(ship.reads, 1);
    assert.equal(r.run.review.substantiveDecisions, 1);
    assert.equal(r.run.findings.length, 1, 'the advisory block records its cited reason once');
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    const decidedBefore = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').length;
    // The same result, operation and key applied again (a replay of the operation): the artifact is re-read, nothing new is recorded.
    const [, , , result, operationId, reviewKey, candidateDigest] = captured;
    const replay = runner.applyShipResult(g(), card, fx.store.getCardRun(goal.id, 'T1-ADV2')!, result, operationId, reviewKey, candidateDigest);
    assert.equal(ship.reads, 2, 'the artifact was re-read');
    assert.equal(replay.run.review.substantiveDecisions, 1, 'a replay of the same ship result is not a second decision');
    assert.equal(replay.run.findings.length, 1, 'no duplicate finding for the identical reason');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').length, decidedBefore, 'no second REVIEW_DECIDED for the replay');
    assert.equal(replay.directive.kind, 'close', replay.directive.narration);
    // The same result under a later operation of the same candidate (a CI retry re-reading the unchanged artifact): the
    // artifact identity, not the operation, makes it the same decision.
    const retry = fx.ops.recordIntent({ kind: 'merge', goalId: goal.id, cardId: 'T1-ADV2', target: 'main', candidateDigest, ownerGeneration: 0, timeoutMs: 60_000, effects: ['merge'] });
    const reread = runner.applyShipResult(g(), card, fx.store.getCardRun(goal.id, 'T1-ADV2')!, result, retry.id, reviewKey, candidateDigest);
    assert.equal(ship.reads, 3, 'the artifact was re-read again');
    assert.equal(reread.run.review.substantiveDecisions, 1, 'a later operation re-reading the same artifact is not a second decision');
    assert.equal(reread.run.findings.length, 1, 'no duplicate finding under the later operation');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').length, decidedBefore, 'no REVIEW_DECIDED for the re-read');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R3 decision 1: the transient-CI branch decides the rerun from the ledger locked at completion, and a pre-dispatch cleanup always cancels the pool admission and keeps the original error', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    // (1) Another window persists a rerun for this candidate while the ship result is applied: the allowance is consumed, no second rerun is granted and the other window's rerun is kept.
    const runner = fx.runner(new InjectedShipPath(['ci-red', 'ci-red'], '[CI-GATE-RED] job=build conclusion=failure runs/111\nnpm ERR! network ECONNRESET'));
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    let after: ReturnType<typeof runner.next> | undefined;
    duringQueueCompletion(fx, () => {
      fx.store.updateCardRun(goal.id, 'T1-HELLO', (current) => ({ ...current!, ci: { ...current!.ci, reruns: [...current!.ci.reruns, { runId: '999', attempt: 1, candidate: candidateShaFor('T1-HELLO'), requestedAt: fx.now(), outcome: 'requested' as const }] } }));
    }, () => {
      after = runner.next(g(), card, run);
    });
    const persisted = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.ok(persisted.ci.reruns.some((x) => x.runId === '999'), 'the rerun another window persisted survives');
    assert.equal(persisted.ci.reruns.length, 1, 'no second rerun is granted once the allowance is consumed');
    assert.notEqual(after!.directive.kind, 'ship', after!.directive.narration);
    // (2) The pre-dispatch cleanup: a failing operation store never masks the lock error nor skips the pool cancellation.
    const fresh = fx.store.updateCardRun(goal.id, 'T1-HELLO', (current) => ({ ...current!, state: 'SHIP', stop: undefined, dodReceipt: 'dod:1', ci: { reruns: [] } }));
    const lock = `${fx.store.cardFile(goal.id, 'T1-HELLO')}.lock`;
    const realAdmit = fx.queue.admit.bind(fx.queue);
    fx.queue.admit = (...args: Parameters<typeof realAdmit>) => {
      writeFileSync(lock, `pid=${process.pid} at=now nonce=held`, 'utf8');
      return realAdmit(...args);
    };
    const realMark = fx.ops.markResult.bind(fx.ops);
    let marks = 0;
    fx.ops.markResult = (...args: Parameters<typeof realMark>) => {
      marks += 1;
      if (marks === 1) throw new Error('operation store unavailable');
      return realMark(...args);
    };
    try {
      assert.throws(() => runner.next(g(), card, fresh), /locked/i, 'the original lock error is the one thrown');
    } finally {
      fx.queue.admit = realAdmit;
      fx.ops.markResult = realMark;
      rmSync(lock, { force: true });
    }
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the pool admission is cancelled although the operation store failed');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R2 cycle 1 round 1: the pre-dispatch drift cleanup attempts every step: a failing operation store never skips the pool cancellation nor hides the drift', () => {
  const fx = makeFixture();
  try {
    tierSCard(fx);
    const goal = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    const g = () => fx.goal(goal.id);
    const ship = new DryRunShipPath(['merged']);
    const runner = fx.runner(ship);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
    r = runner.next(g(), card, r.run);
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
    const realAdmit = fx.queue.admit.bind(fx.queue);
    fx.queue.admit = (...args: Parameters<typeof realAdmit>) => {
      fx.store.updateCardRun(goal.id, 'T1-HELLO', (current) => ({ ...current!, candidate: { sha: 'sha-newer', dirty: false, untracked: [], digest: 'sha-newer' }, dodReceipt: 'dod:newer' }));
      return realAdmit(...args);
    };
    const realMark = fx.ops.markResult.bind(fx.ops);
    let marks = 0;
    fx.ops.markResult = (...args: Parameters<typeof realMark>) => {
      marks += 1;
      if (marks === 1) throw new Error('operation store unavailable');
      return realMark(...args);
    };
    let after: ReturnType<typeof runner.next> | undefined;
    try {
      after = runner.next(g(), card, run);
    } finally {
      fx.queue.admit = realAdmit;
      fx.ops.markResult = realMark;
    }
    assert.equal(ship.requests.length, 0);
    assert.equal(after!.directive.kind, 'wait', after!.directive.narration);
    assert.match(after!.directive.narration, /candidate changed/i, 'the drift is reported although the operation store failed');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the pool admission is cancelled although the operation store failed');
  } finally {
    fx.cleanup();
  }
});
