// Card T0-CARD-LEASE-HEARTBEAT: the goal dispatch waits on a card run stopped for ownership while that card's lease is
// live, and stops the goal as before once the lease has expired; the incident sequence of goal g-20261107095106-c08940.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, candidateShaFor, actorA, actorB, type Fixture } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { hostName } from '../../src/state/paths.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import { MINUTE_MS, addMs, type Goal } from '../../src/core/types.ts';
import { dispatchHook } from '../../src/hooks/entry.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';

/**
 * Session B prepares the card (B holds its lease); `elapsed` later session A, which coordinates the goal, reads the run
 * and stops it for ownership: under B's live lease, or, once that lease has expired, at PREPARE's claim as in the incident.
 */
function stoppedForOwnership(elapsed: number): { fx: Fixture; goal: Goal } {
  const fx = makeFixture({ actor: actorA });
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goal = goalForCards(fx, ['T1-HELLO']);
  const card = fx.card('T1-HELLO');
  setActorForTests(actorB);
  const prepared = fx.runner().next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO'));
  assert.equal(prepared.directive.kind, 'prepare');
  fx.advance(elapsed);
  setActorForTests(actorA);
  const stopped = fx.runner().next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-HELLO')!);
  assert.equal(stopped.run.stop?.reason, 'ownership');
  return { fx, goal };
}

test('T0-CARD-LEASE-HEARTBEAT acceptance 4: a card run stopped for ownership under a live lease of another session makes the goal wait; with that lease expired the goal stops for ownership naming card takeover [R4]', () => {
  const live = stoppedForOwnership(MINUTE_MS);
  try {
    const { fx, goal } = live;
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'wait', d.narration);
    if (d.kind === 'wait') assert.equal(d.on, 'T1-HELLO:owner:win-B');
    assert.notEqual(fx.goal(goal.id).state, 'STOP');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'GOAL_STOPPED').length, 0, 'no GOAL_STOPPED');
  } finally {
    setActorForTests(actorA);
    live.fx.cleanup();
  }
  const expired = stoppedForOwnership(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
  try {
    const { fx, goal } = expired;
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

test('T0-CARD-LEASE-HEARTBEAT acceptance 4: a card lease file that cannot be read keeps the goal stop of a run stopped for ownership, as before this card [R4]', () => {
  const { fx, goal } = stoppedForOwnership(MINUTE_MS);
  try {
    writeFileSync(fx.leases.file(resourceKeys.card(fx.repo.key, 'T1-HELLO')), '{ not json', 'utf8');
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'stop', d.narration);
    assert.equal(fx.goal(goal.id).stop?.reason, 'ownership');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
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

// Card T0-BOARD-OWNER-WAIT: the board shows a card stopped for ownership under a live card lease as the goal's wait on
// its owner, from the same lease decision the dispatch uses.
const arcLine = (text: string): string => text.split('\n').find((l) => l.startsWith('- **Arc**:')) ?? '';
const helloRow = (text: string): string => text.split('\n').find((l) => l.includes('| T1-HELLO |')) ?? '';

test('T0-BOARD-OWNER-WAIT acceptance 1: under a live card lease the board written by next, by writeBoard(goal) and by writeBoard(goal, cards) shows the wait on the owner [R1] [R2]', () => {
  const { fx, goal } = stoppedForOwnership(MINUTE_MS);
  try {
    const lease = fx.leases.read(resourceKeys.card(fx.repo.key, 'T1-HELLO'))!;
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'wait', d.narration);
    const fromNext = readFileSync(path.join(fx.paths.board, `${goal.id}.md`), 'utf8');
    const fromGoal = fx.controller.writeBoard(fx.goal(goal.id));
    const fromBoardCommand = fx.controller.writeBoard(fx.goal(goal.id), [fx.card('T1-HELLO')]);
    for (const [label, text] of [['next', fromNext], ['writeBoard(goal)', fromGoal], ['writeBoard(goal, cards)', fromBoardCommand]] as const) {
      assert.match(arcLine(text), /verdict=wait /, `${label}: ${arcLine(text)}`);
      const row = helloRow(text);
      assert.ok(row.startsWith('| [-] | T1-HELLO | STOP (lease live) |'), `${label}: ${row}`);
      assert.ok(row.includes('| ownership: '), `${label}: ${row}`);
      assert.ok(row.endsWith(`; the goal waits on owner win-B until ${lease.expiresAt} |`), `${label}: ${row}`);
    }
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-BOARD-OWNER-WAIT acceptance 2: with the card lease expired or malformed, writeBoard(goal) shows the stop as before this card [R2] [R3]', () => {
  const expired = stoppedForOwnership(DEFAULT_LEASE_TTL_MS + MINUTE_MS);
  try {
    const text = expired.fx.controller.writeBoard(expired.fx.goal(expired.goal.id));
    assert.ok(helloRow(text).startsWith('| [S] | T1-HELLO | STOP |'), helloRow(text));
    assert.match(arcLine(text), /verdict=stop /);
  } finally {
    setActorForTests(actorA);
    expired.fx.cleanup();
  }
  const malformed = stoppedForOwnership(MINUTE_MS);
  try {
    const { fx, goal } = malformed;
    writeFileSync(fx.leases.file(resourceKeys.card(fx.repo.key, 'T1-HELLO')), '{ not json', 'utf8');
    const text = fx.controller.writeBoard(fx.goal(goal.id));
    assert.ok(helloRow(text).startsWith('| [S] | T1-HELLO | STOP |'), helloRow(text));
    assert.match(arcLine(text), /verdict=stop /);
  } finally {
    setActorForTests(actorA);
    malformed.fx.cleanup();
  }
});

test('T0-BOARD-OWNER-WAIT acceptance 3: one controller next reads the card lease exactly once, the board taking the dispatch decision [R2]', () => {
  const { fx, goal } = stoppedForOwnership(MINUTE_MS);
  try {
    const cardKey = resourceKeys.card(fx.repo.key, 'T1-HELLO');
    const read = fx.leases.read.bind(fx.leases);
    let cardReads = 0;
    fx.leases.read = (key: string) => {
      if (key === cardKey) cardReads++;
      return read(key);
    };
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'wait', d.narration);
    assert.equal(cardReads, 1);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-BOARD-OWNER-WAIT acceptance 6: a goal stopped while the card lease stays live has no live owners, so its board shows the stop as before [R1]', () => {
  const { fx, goal } = stoppedForOwnership(MINUTE_MS);
  try {
    assert.equal(fx.controller.next(goal.id).kind, 'wait');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'stopped' } });
    const lease = fx.leases.read(resourceKeys.card(fx.repo.key, 'T1-HELLO'));
    assert.ok(lease && !lease.released && Date.parse(lease.expiresAt) >= Date.parse(fx.now()), 'the card lease is still live');
    const text = fx.controller.writeBoard(fx.goal(goal.id));
    assert.ok(helloRow(text).startsWith('| [S] | T1-HELLO | STOP |'), helloRow(text));
    assert.ok(!text.includes('lease live'), text);
    assert.ok(!text.includes('waits on owner'), text);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});
