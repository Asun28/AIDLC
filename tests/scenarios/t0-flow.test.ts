import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, driveCardToDone, candidateShaFor } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import { CardRun } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actorA, actorB } from './_harness.ts';

test('Q1/Q8/Q10/Q15: a T0 card flows PREPARE -> BUILD -> SHIP -> CLOSE -> DONE and the goal finishes development-only', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = fx.controller.createGoal({ text: 'implement T1-HELLO', source: 'card', ref: 'T1-HELLO', affectedSurfaces: [] }, { cards: ['T1-HELLO'] });
    assert.equal(goal.routing.size, 'T0');
    assert.equal(goal.routing.kind, 'card-execute');
    assert.equal(goal.target, 'development');
    assert.equal(goal.state, 'PLAN');
    assert.deepEqual(goal.cards, ['T1-HELLO']);

    const d0 = fx.controller.next(goal.id);
    assert.equal(d0.kind, 'project-cards');

    const rep = fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-HELLO'] } });
    assert.equal(rep.directive.kind, 'run-card');
    assert.equal(rep.directive.goalState, 'RUN');
    if (rep.directive.kind === 'run-card') {
      assert.equal(rep.directive.cardId, 'T1-HELLO');
      assert.equal(rep.directive.cardState, 'PREPARE');
      assert.equal(rep.directive.mode, 'remote');
      assert.equal(rep.directive.base, 'main');
    }

    const runner = fx.runner(new DryRunShipPath(['merged']));
    const card = fx.card('T1-HELLO');
    const run0 = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-HELLO');
    assert.equal(run0.state, 'PREPARE');

    let r = runner.next(fx.goal(goal.id), card, run0);
    assert.equal(r.directive.kind, 'prepare');
    if (r.directive.kind === 'prepare') assert.equal(r.directive.action, 'start');
    assert.equal(r.run.state, 'BUILD');
    assert.ok(r.run.worktree);

    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') {
      assert.equal(r.directive.attempt, 1);
      assert.equal(r.directive.effort, 'medium');
      assert.equal(r.directive.tdd, true);
    }

    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: candidateShaFor('T1-HELLO') });
    assert.equal(run1.effort?.terminal, 'succeeded');
    assert.equal(run1.dodReceipt, 'dod:ok');
    assert.equal(run1.candidate?.sha, candidateShaFor('T1-HELLO'));

    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'close');
    assert.equal(r.run.state, 'CLOSE');
    assert.equal(r.run.mergeVerified, true);
    if (r.directive.kind === 'close') assert.deepEqual(r.directive.missing, ['metadata', 'docSync', 'findings', 'evidence', 'cleanup']);

    const run2 = runner.markClosure(fx.goal(goal.id), card, r.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true });
    r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'done');
    assert.equal(r.run.state, 'DONE');

    const d1 = fx.controller.next(goal.id);
    assert.equal(d1.kind, 'verify-arc');
    if (d1.kind === 'verify-arc') assert.deepEqual(d1.cards, ['T1-HELLO']);
    assert.equal(fx.goal(goal.id).state, 'VERIFY_ARC');

    const done = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
    assert.equal(done.directive.kind, 'done');
    const final = fx.goal(goal.id);
    assert.equal(final.state, 'DONE');
    assert.equal(final.terminal, true);
    assert.equal(final.stages.development, 'pass');
    for (const stage of ['package', 'staging', 'production', 'migration', 'operations'] as const) assert.equal(final.stages[stage], 'not_requested', `${stage} must be not_requested`);

    // A later wakeup does no new work.
    const before = fx.events(goal.id).length;
    const again = fx.controller.next(goal.id);
    assert.equal(again.kind, 'done');
    assert.equal(fx.events(goal.id).length, before, 'no events appended by a terminal next()');

    // Journal chain and operation ordering.
    const verification = fx.journal(goal.id).verify();
    assert.equal(verification.ok, true);
    const types = fx.events(goal.id).map((e) => e.type);
    const intent = types.indexOf('OPERATION_INTENT');
    const issued = types.indexOf('OPERATION_ISSUED');
    const result = types.indexOf('OPERATION_RESULT');
    assert.ok(intent >= 0 && issued > intent && result > issued, `intent(${intent}) < issued(${issued}) < result(${result})`);
    assert.ok(types.includes('GOAL_DONE'));
    const mergeOps = fx.ops.list({ goalId: goal.id, kind: 'merge' });
    assert.equal(mergeOps.length, 1);
    assert.equal(mergeOps[0]!.status, 'succeeded');
  } finally {
    fx.cleanup();
  }
});

test('Q1: driveCardToDone helper reproduces the flow for reuse by other scenarios', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-ONE', title: 'one' });
    const goal = fx.controller.createGoal({ text: 'implement T1-ONE', source: 'card', ref: 'T1-ONE', affectedSurfaces: [] }, { cards: ['T1-ONE'] });
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-ONE'] } });
    const run = driveCardToDone(fx, goal.id, 'T1-ONE');
    assert.equal(run.state, 'DONE');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
  } finally {
    fx.cleanup();
  }
});

test('owner heartbeat: a BUILD longer than the lease TTL still ships, and a same-owner ownership stop is revalidated; a foreign lease still stops', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-SLOW', title: 'slow build' });
    const goal = fx.controller.createGoal({ text: 'implement T1-SLOW', source: 'card', ref: 'T1-SLOW', affectedSurfaces: [] }, { cards: ['T1-SLOW'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-SLOW'] } });
    const runner = fx.runner(new DryRunShipPath(['merged', 'merged']));
    const card = fx.card('T1-SLOW');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-SLOW'));
    assert.equal(r.directive.kind, 'prepare');
    const key = resourceKeys.card(fx.repo.key, 'T1-SLOW');
    const acquired = fx.leases.read(key)!;

    // The implementation takes longer than the lease TTL; nobody else touches the card.
    fx.advance(DEFAULT_LEASE_TTL_MS + 60_000);
    assert.ok(Date.parse(acquired.expiresAt) < Date.parse(fx.now()), 'fixture: the PREPARE lease has expired');
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: candidateShaFor('T1-SLOW') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'close', `the owner's own card next must renew the lease and ship; got ${r.directive.kind}: ${r.directive.narration}`);
    assert.equal(r.run.mergeVerified, true);
    const renewed = fx.leases.read(key)!;
    assert.equal(renewed.generation, acquired.generation, 'a renewal keeps the generation');
    assert.ok(Date.parse(renewed.expiresAt) > Date.parse(fx.now()), 'the lease was renewed by the owner');

    // A run already stopped with reason ownership, while the same session still holds the lease at the
    // same generation, is revalidated by the owner's next call instead of staying terminal.
    const stopped = fx.store.saveCardRun(CardRun.parse({ ...run1, state: 'STOP', stop: makeStop('ownership', 'fenced: lease expired; renew or reconcile before mutating', 'revalidate ownership', { at: fx.now() }), updatedAt: fx.now() }));
    fx.advance(DEFAULT_LEASE_TTL_MS + 60_000);
    r = runner.next(fx.goal(goal.id), card, stopped);
    assert.notEqual(r.directive.kind, 'stop', `a stale same-owner ownership stop must be revalidated: ${r.directive.narration}`);
    assert.equal(r.run.stop, undefined);

    // A different session never renews or clears somebody else's lease.
    const foreign = fx.store.saveCardRun(CardRun.parse({ ...stopped, updatedAt: fx.now() }));
    setActorForTests(actorB);
    try {
      r = runner.next(fx.goal(goal.id), card, foreign);
      assert.equal(r.directive.kind, 'stop');
      assert.equal(fx.leases.read(key)!.owner.session, actorA.session);
    } finally {
      setActorForTests(actorA);
    }
  } finally {
    fx.cleanup();
  }
});
