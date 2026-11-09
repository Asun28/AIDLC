// Card T0-CARD-LEASE-HEARTBEAT: the goal dispatch waits on a card run stopped for ownership while that card's lease is
// live, and stops the goal as before once the lease has expired; the incident sequence of goal g-20261107095106-c08940.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, candidateShaFor, actorA, actorB, type Fixture } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { hostName } from '../../src/state/paths.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import { MINUTE_MS, addMs, type Goal } from '../../src/core/types.ts';
import { dispatchHook } from '../../src/hooks/entry.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';

/** Session B prepares the card (B holds its lease); session A, which coordinates the goal, then reads the run and stops it for ownership. */
function stoppedForOwnership(): { fx: Fixture; goal: Goal } {
  const fx = makeFixture({ actor: actorA });
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goal = goalForCards(fx, ['T1-HELLO']);
  const card = fx.card('T1-HELLO');
  setActorForTests(actorB);
  const prepared = fx.runner().next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
  assert.equal(prepared.directive.kind, 'prepare');
  setActorForTests(actorA);
  const stopped = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
  assert.equal(stopped.run.stop?.reason, 'ownership');
  return { fx, goal };
}

test('T0-CARD-LEASE-HEARTBEAT acceptance 4: a card run stopped for ownership under a live lease of another session makes the goal wait; with that lease expired the goal stops for ownership naming card takeover [R4]', () => {
  const live = stoppedForOwnership();
  try {
    const { fx, goal } = live;
    fx.advance(MINUTE_MS);
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'wait', d.narration);
    if (d.kind === 'wait') assert.equal(d.on, 'T1-HELLO:owner:win-B');
    assert.notEqual(fx.goal(goal.id).state, 'STOP');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'GOAL_STOPPED').length, 0, 'no GOAL_STOPPED');
  } finally {
    setActorForTests(actorA);
    live.fx.cleanup();
  }
  const expired = stoppedForOwnership();
  try {
    const { fx, goal } = expired;
    fx.advance(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'stop', d.narration);
    const stop = fx.goal(goal.id).stop;
    assert.equal(fx.goal(goal.id).state, 'STOP');
    assert.equal(stop?.reason, 'ownership');
    assert.ok(stop?.nextAction.includes('card takeover'), stop?.nextAction);
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'GOAL_STOPPED').length, 1);
  } finally {
    setActorForTests(actorA);
    expired.fx.cleanup();
  }
});

test('T0-CARD-LEASE-HEARTBEAT acceptance 5: the owner keeps its lease through a tool call, the other session waits, and the owner clears the stop and continues [R1] [R4]', () => {
  const A = { ...actorA, host: hostName() };
  const B = { ...actorB, host: hostName() };
  const fx = makeFixture({ actor: A });
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const card = fx.card('T1-HELLO');
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    // A prepares the card and starts BUILD
    let r = fx.runner().next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
    assert.equal(r.directive.kind, 'prepare');
    r = fx.runner().next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    // A's implementer runs a Bash command one second before the lease would expire: the hook renews it
    const leaseBefore = fx.leases.read(cardKey)!;
    fx.clock.now = addMs(leaseBefore.expiresAt, -1000);
    const hook = dispatchHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, session_id: 'win-A', cwd: fx.tmp }, { cwd: fx.tmp, env: { PATH: process.env['PATH'], AIDLC_STATE_DIR: fx.paths.root }, now: fx.now() });
    assert.deepEqual(hook, { exitCode: 0 });
    assert.equal(fx.leases.read(cardKey)?.expiresAt, addMs(fx.now(), DEFAULT_LEASE_TTL_MS), 'the tool call renewed the lease');
    // past the original expiry, session B's card next saves an ownership stop on the run, and B's next waits
    fx.advance(5 * MINUTE_MS);
    setActorForTests(B);
    const rB = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(rB.run.stop?.reason, 'ownership');
    const dB = fx.controller.next(goal.id);
    assert.equal(dB.kind, 'wait', dB.narration);
    assert.notEqual(fx.goal(goal.id).state, 'STOP');
    // A's next card next clears the stop and the goal continues
    setActorForTests(A);
    fx.advance(MINUTE_MS);
    r = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    assert.equal(r.run.stop, undefined);
    assert.ok(fx.events(goal.id).some((e) => e.type === 'LEASE_RENEWED' && e.data['revalidated'] === true), 'LEASE_RENEWED revalidated');
    const attempted = fx.runner().recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:T1-HELLO', redReceipt: 'red:T1-HELLO', candidateSha: candidateShaFor('T1-HELLO') });
    r = fx.runner().next(fx.goal(goal.id), card, attempted);
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    const dA = fx.controller.next(goal.id);
    assert.notEqual(dA.kind, 'stop', dA.narration);
    const report = verifyAudit({ goalId: goal.id, journal: fx.journal(goal.id), operations: fx.ops, now: fx.now() });
    assert.deepEqual(report.findings.filter((f) => f.code === 'WORK_AFTER_TERMINAL'), []);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});
