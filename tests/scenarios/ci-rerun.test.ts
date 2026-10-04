import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor, InjectedShipPath, T0 } from './_harness.ts';
import { canRerun } from '../../src/core/ci-policy.ts';
import { countedFailures } from '../../src/core/effort.ts';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import type { ShipRequest, ShipResult } from '../../src/delivery/ship.ts';

const TRANSIENT = '[CI-GATE-LOG] actions/runs/12345/job/456\nError: read ECONNRESET while fetching artifact\n[CI-GATE-RED] [{"name":"build","conclusion":"failure"}]\n[CI-GATE-STEP] {"check":"build","job":"456","step":{"number":1,"name":"Set up job","conclusion":"failure"}}';
/** The same failure with only its log text: no structured evidence, so no rerun (T0-CI-RERUN-STRUCTURED). */
const LOG_ONLY = '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/12345 ... Error: read ECONNRESET while fetching artifact';
const CODE_DEFECT = '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/777 ... AssertionError: expected 2 to equal 3';

/** The bounds journaled for the goal (card T1-BOUND-TELEMETRY), in journal order. */
const fired = (fx: ReturnType<typeof makeFixture>, goalId: string) => fx.events(goalId).filter((e) => e.type === 'BOUND_FIRED').map((e) => e.data['bound']);

/** The keys of those firings: goal/card/bound/the persisted value that fired it (R3 decision 1); a CI firing names the candidate and its reruns (T1-BOUND-TELEMETRY-2). */
const keysOf = (fx: ReturnType<typeof makeFixture>, goalId: string) => fx.events(goalId).filter((e) => e.type === 'BOUND_FIRED').map((e) => String(e.data['key']).slice(goalId.length));

function start(fx: ReturnType<typeof makeFixture>, ship: InjectedShipPath) {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goal = goalForCards(fx, ['T1-HELLO']);
  const runner = fx.runner(ship);
  const card = fx.card('T1-HELLO');
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
  r = runner.next(fx.goal(goal.id), card, r.run);
  const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
  return { goal, runner, card, run1 };
}

test('T0-CI-RERUN-STRUCTURED acceptance 3: a transient failure told by log text alone is STOP/ci with no rerun intent [R3]', () => {
  const fx = makeFixture();
  try {
    const { goal, runner, card, run1 } = start(fx, new InjectedShipPath(['ci-red'], LOG_ONLY));
    const r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.stop?.reason, 'ci');
    assert.equal(r.run.ci.reruns.length, 0, 'no rerun intent');
  } finally {
    fx.cleanup();
  }
});

test('Q7: a transient CI failure earns one persisted same-origin rerun, reconciles, and then merges', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red', 'merged'], TRANSIENT);
    const { goal, runner, card, run1 } = start(fx, ship);
    let r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'ship', 'transient failure: rerun directive');
    assert.equal(r.run.state, 'SHIP');
    assert.equal(r.run.ci.reruns.length, 1);
    assert.equal(r.run.ci.reruns[0]!.outcome, 'requested', 'rerun intent persisted before the request');
    assert.equal(r.run.ci.reruns[0]!.runId, '12345');
    assert.equal(r.run.ci.reruns[0]!.candidate, candidateShaFor('T1-HELLO'));
    const types = fx.events(goal.id).map((e) => e.type);
    assert.ok(types.includes('CI_CLASSIFIED'));
    assert.ok(types.includes('CI_RERUN'));
    assert.deepEqual(fired(fx, goal.id), ['ci-rerun-allowed'], 'T1-BOUND-TELEMETRY acceptance 1: the rerun journals one ci-rerun-allowed firing');
    assert.deepEqual(fx.events(goal.id).filter((e) => e.type === 'BOUND_FIRED').map((e) => [String(e.data['key']).slice(goal.id.length), e.data['stoppedAt']]), [['@0/T1-HELLO/ci-rerun-allowed/sha-t1-hello/0', fx.now()]], 'the key, and the clock time of the grant (T1-BOUND-TELEMETRY-2)');

    const reconciled = runner.ciReconcile(fx.goal(goal.id), card, r.run, '12345', () => ({ status: 'completed', conclusion: 'success', attempt: 2 }));
    assert.equal(reconciled.state, 'SHIP');
    assert.equal(reconciled.ci.reruns[0]!.outcome, 'success');

    // BUG: src/loop/card-runner.ts ship() — re-shipping the SAME candidate after the reconciled rerun
    // enqueues the same review key; ReviewQueue.enqueue reports the earlier request as 'completed',
    // admit() finds nothing queued and the runner answers `wait` on 'review-pool:default:empty'.
    // Expected: a completed review for this candidate is reused (or re-opened when it carried no
    // verdict) and the ship proceeds to merged -> CLOSE.
    r = runner.next(fx.goal(goal.id), card, reconciled);
    assert.equal(r.directive.kind, 'close', `expected merged -> close, got ${r.directive.kind}: ${r.directive.narration}`);
    assert.equal(ship.requests.length, 2);
    assert.deepEqual(fired(fx, goal.id), ['ci-rerun-allowed'], 'the reconciled rerun and the merge fire nothing more');
  } finally {
    fx.cleanup();
  }
});

test('Q7: the rerun allowance is per candidate; a second transient failure on the same candidate is STOP/ci', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], TRANSIENT);
    const { goal, runner, card, run1 } = start(fx, ship);
    const digest = run1.candidate!.digest;
    assert.equal(canRerun({ reruns: [] }, '1', 1, digest, 'transient').allowed, true);
    assert.equal(canRerun({ reruns: [{ runId: '999', attempt: 1, candidate: digest, requestedAt: T0, outcome: 'success' }] }, '12345', 1, digest, 'transient').allowed, false);
    assert.equal(canRerun({ reruns: [{ runId: '999', attempt: 1, candidate: 'other', requestedAt: T0, outcome: 'success' }] }, '12345', 1, digest, 'transient').allowed, true, 'a new candidate has its own allowance');

    // Persist a consumed rerun for this candidate, then ship: the transient failure cannot rerun again.
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-HELLO', data: { ci: { reruns: [{ runId: '999', attempt: 1, candidate: digest, requestedAt: T0, outcome: 'success' }] } } });
    const run2 = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    const r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'stop');
    assert.equal(r.run.stop?.reason, 'ci');
    assert.equal(r.run.ci.reruns.length, 1, 'no second rerun recorded');
    assert.deepEqual(fired(fx, goal.id), ['ci-rerun-denied'], 'T1-BOUND-TELEMETRY acceptance 1: the denial journals one ci-rerun-denied firing');
    assert.deepEqual(keysOf(fx, goal.id), ['@0/T1-HELLO/ci-rerun-denied/sha-t1-hello/1']);
    assert.equal(runner.next(fx.goal(goal.id), card, r.run).directive.kind, 'stop');
    assert.deepEqual(fired(fx, goal.id), ['ci-rerun-denied'], 'the stopped card fires nothing more');
  } finally {
    fx.cleanup();
  }
});

test('Q7: a code-defect CI failure never reruns; it goes back to BUILD with a new candidate', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], CODE_DEFECT);
    const { goal, runner, card, run1 } = start(fx, ship);
    const r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'build');
    assert.equal(r.run.state, 'BUILD');
    assert.equal(r.run.ci.reruns.length, 0);
    assert.equal(r.run.dodReceipt, undefined, 'the failed candidate needs a fresh DoD');
    const classified = fx.events(goal.id).find((e) => e.type === 'CI_CLASSIFIED');
    assert.equal(classified?.data['class'], 'code-defect');
    assert.deepEqual(fired(fx, goal.id), [], 'a code defect with attempts left fires no bound');
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-REPAIR-ATTEMPT acceptance 1: a CI code defect on a succeeded attempt is a counted failure that reopens the episode; the repair is recorded and ships', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red', 'merged'], CODE_DEFECT);
    const { goal, runner, card, run1 } = start(fx, ship);
    assert.equal(run1.effort?.terminal, 'succeeded');
    let r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    if (r.directive.kind === 'build') {
      assert.equal(r.directive.attempt, 2);
      assert.equal(r.directive.effort, 'medium');
    }
    const effort = r.run.effort!;
    assert.equal(effort.terminal, undefined, 'the episode is reopened');
    assert.equal(countedFailures(effort).length, 1, 'the ship failure is a counted failure');
    assert.equal(effort.attempts[0]!.outcome, 'fail', 'the attempt that bound the failed candidate is the counted failure');
    assert.match(effort.attempts[0]!.cause ?? '', /^ship ci-red: CI code defect \(/, 'the cause names the ship outcome');
    const finished = fx.events(goal.id).filter((e) => e.type === 'ATTEMPT_FINISHED').at(-1);
    assert.equal(finished?.data['outcome'], 'fail');
    assert.equal(finished?.data['refutedBy'], 'ship ci-red');
    assert.equal(finished?.data['n'], 1);

    const run2 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', candidateSha: 'sha-repair' });
    assert.equal(run2.effort?.terminal, 'succeeded');
    assert.deepEqual(run2.effort?.attempts.map((a) => a.outcome), ['fail', 'success']);
    r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'close', `the repaired candidate ships: ${r.directive.narration}`);
    assert.equal(ship.requests.length, 2);
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-REPAIR-ATTEMPT acceptance 3: the same CI code defect twice without progress stops the card early; card next returns the stop, never a build directive', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], CODE_DEFECT);
    const { goal, runner, card, run1 } = start(fx, ship);
    let r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    const run2 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', candidateSha: 'sha-repair' });
    r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'stop', `the second same-cause failure stops: ${r.directive.narration}`);
    if (r.directive.kind === 'stop') {
      assert.equal(r.directive.stop.reason, 'card');
      assert.match(r.directive.stop.detail, /same-cause-stop/);
    }
    assert.equal(r.run.effort?.terminal, 'same-cause-stop');
    assert.equal(countedFailures(r.run.effort!).length, 2);
    assert.deepEqual(fired(fx, goal.id), ['attempts'], 'T1-BOUND-TELEMETRY acceptance 1: the ladder stop journals one attempts firing');
    assert.deepEqual(keysOf(fx, goal.id), ['@0/T1-HELLO/attempts/2']);
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'stop', 'card next keeps returning the stop');
    assert.deepEqual(fired(fx, goal.id), ['attempts'], 'the stopped card fires nothing more');
    assert.throws(() => runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:3', candidateSha: 'sha-3' }), /no attempt may start: same-cause-stop/);
    assert.equal(ship.requests.length, 2);
  } finally {
    fx.cleanup();
  }
});

const SECURITY = '[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"failure"}]\n[SAGA-FAIL]\n[SAGA-RESUME] aidlc card next T1-HELLO';

test('R7: a red secret scan is STOP/risk with no rerun intent and no repair attempt', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], SECURITY);
    const { goal, runner, card, run1 } = start(fx, ship);
    const r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.state, 'STOP');
    assert.equal(r.run.stop?.reason, 'risk');
    assert.ok((r.run.stop?.detail ?? '').includes('Gitleaks (committed history)'), r.run.stop?.detail);
    assert.equal(r.run.ci.reruns.length, 0, 'no rerun intent is persisted for a security failure');
    assert.equal(r.run.dodReceipt, undefined, 'the candidate is not ready to ship again');
    const classified = fx.events(goal.id).find((e) => e.type === 'CI_CLASSIFIED');
    assert.equal(classified?.data['class'], 'security');
    assert.ok(!fx.events(goal.id).some((e) => e.type === 'CI_RERUN'));
    assert.equal(ship.requests.length, 1);
  } finally {
    fx.cleanup();
  }
});

const SECURITY_NATIVE = '[CI-GATE-RED] [{"name":"secret_scan","conclusion":"failure"}]\nnpm ERR! network read ECONNRESET\n[SAGA-FAIL]';

test('R7: a native secret_scan job with transient noise is STOP/risk, never a rerun', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], SECURITY_NATIVE);
    const { goal, runner, card, run1 } = start(fx, ship);
    const r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.stop?.reason, 'risk');
    assert.equal(r.run.ci.reruns.length, 0, 'the transient evidence next to the scan earns no rerun');
    assert.equal(fx.events(goal.id).find((e) => e.type === 'CI_CLASSIFIED')?.data['class'], 'security');
  } finally {
    fx.cleanup();
  }
});

const SECURITY_JSON = '[CI-GATE-RED] [{"name":"Gitleaks (committed history)","conclusion":"failure"}]\nread ECONNRESET while fetching artifact\n[SAGA-FAIL]';
const PENDING_NOISE = '[CI-GATE-WAIT] 1 pending: [{"name":"flaky-tests","conclusion":null,"status":"in_progress"}]\n[CI-GATE-RED] [{"name":"build-test","conclusion":"failure"}]\n[SAGA-FAIL]';

test('R7: a structured gate line is classified from its checks; transient text next to it never earns the scan a rerun', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], SECURITY_JSON);
    const { goal, runner, card, run1 } = start(fx, ship);
    const r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.stop?.reason, 'risk');
    assert.equal(r.run.ci.reruns.length, 0);
    assert.equal(fx.events(goal.id).find((e) => e.type === 'CI_CLASSIFIED')?.data['class'], 'security');
  } finally {
    fx.cleanup();
  }
});

test('R7: pending check names in a wait line are no failure evidence; a red build without a log is unknown and never reruns', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], PENDING_NOISE);
    const { goal, runner, card, run1 } = start(fx, ship);
    const r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.stop?.reason, 'ci', 'diagnose before any rerun');
    assert.equal(r.run.ci.reruns.length, 0, 'flaky-tests in the wait line is not transient evidence');
    assert.deepEqual(fired(fx, goal.id), [], 'T1-BOUND-TELEMETRY: an unclassified failure is no rerun the allowance denied');
    assert.equal(fx.events(goal.id).find((e) => e.type === 'CI_CLASSIFIED')?.data['class'], 'unknown');
  } finally {
    fx.cleanup();
  }
});

/** A ship that, while `lock` is set, holds the card-run lock when it returns, so the save of its result is refused (LOCKED). */
class LockingShip extends InjectedShipPath {
  lock: string | undefined;
  override ship(req: ShipRequest): ShipResult {
    if (this.lock) writeFileSync(this.lock, `pid=${process.pid} nonce=held`, 'utf8');
    return super.ship(req);
  }
}

test('T1-BOUND-TELEMETRY-2 acceptance 6: a CI rerun granted, cancelled and granted again on the same candidate journals two ci-rerun-allowed firings with distinct keys, and a retry of a refused save journals none more [R1]', () => {
  const fx = makeFixture();
  try {
    const ship = new LockingShip(['ci-red'], TRANSIENT);
    const { goal, card, run1 } = start(fx, ship);
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: new GoalStore(fx.paths, { lockTimeoutMs: 50 }), leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now });
    const stored = () => fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.equal(runner.next(fx.goal(goal.id), card, run1).directive.kind, 'ship', 'the first grant');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-HELLO', data: { ci: { reruns: [...stored().ci.reruns.map((r) => ({ ...r, outcome: 'cancelled' })), { runId: '5', attempt: 1, candidate: 'sha-other', requestedAt: T0, outcome: 'success' }] } } }); // another candidate's rerun is not counted
    ship.lock = `${fx.store.cardFile(goal.id, 'T1-HELLO')}.lock`;
    assert.throws(() => runner.next(fx.goal(goal.id), card, stored()), /LOCKED/, 'the save of the second grant is refused');
    unlinkSync(ship.lock);
    ship.lock = undefined;
    assert.equal(runner.next(fx.goal(goal.id), card, stored()).directive.kind, 'ship', 'the retry grants the rerun again');
    assert.equal(ship.requests.length, 3);
    assert.deepEqual(keysOf(fx, goal.id), ['@0/T1-HELLO/ci-rerun-allowed/sha-t1-hello/0', '@0/T1-HELLO/ci-rerun-allowed/sha-t1-hello/1'], 'one key per grant, the cancelled rerun counted');
  } finally {
    fx.cleanup();
  }
});

test('T1-BOUND-TELEMETRY-2 acceptance 9: a CI-denied ship result whose firing the journal refuses leaves the card STOPPED with the firing pending; the next card next journals it once and returns the stop without shipping again [R5] [R6]', () => {
  const fx = makeFixture();
  try {
    const ship = new InjectedShipPath(['ci-red'], TRANSIENT);
    const { goal, runner, card, run1 } = start(fx, ship);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-HELLO', data: { ci: { reruns: [{ runId: '999', attempt: 1, candidate: run1.candidate!.digest, requestedAt: T0, outcome: 'success' }] } } });
    const file = fx.journal(goal.id).file;
    writeFileSync(file, readFileSync(file, 'utf8').replace('\n', '\nnot a journal line\n'), 'utf8'); // cannot be read in full; its tail still appends
    const r = runner.next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    const stopped = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    assert.deepEqual([stopped.state, stopped.stop?.reason, stopped.pendingFiring?.bound], ['STOP', 'ci', 'ci-rerun-denied'], 'the stop is saved with its firing pending');
    assert.equal(r.directive.kind, 'stop');
    assert.match(r.directive.narration, /ci-rerun-denied\/sha-t1-hello\/1 stays pending/, 'the command names the pending firing');
    assert.ok(fx.controller.writeBoard(fx.goal(goal.id)).includes(`\nBounds: none fired; incomplete: lines that do not parse in "${goal.id}"; pending firings or unreadable records in "${goal.id}"\n`), 'the board names the journal and the goal');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-HELLO', data: { pendingFiring: undefined } }), /pendingFiring is loop-owned/, 'a raw patch never clears it');
    writeFileSync(file, readFileSync(file, 'utf8').replace('not a journal line\n', ''), 'utf8');
    assert.equal(runner.next(fx.goal(goal.id), card, stopped).directive.kind, 'stop');
    assert.equal(ship.requests.length, 1, 'the ship path is not invoked again');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-HELLO')?.pendingFiring, undefined);
    assert.deepEqual(keysOf(fx, goal.id), ['@0/T1-HELLO/ci-rerun-denied/sha-t1-hello/1']);
    runner.next(fx.goal(goal.id), card, stopped);
    assert.deepEqual(keysOf(fx, goal.id), ['@0/T1-HELLO/ci-rerun-denied/sha-t1-hello/1'], 'once per key');
  } finally {
    fx.cleanup();
  }
});
