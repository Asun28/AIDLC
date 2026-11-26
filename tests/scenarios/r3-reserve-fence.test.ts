import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, actorA, actorB } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

const CARD = 'T1-RSV';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';

// Card T0-R3-RESERVE-FENCE-TEST: `formalReview` fences the owner's lease before the pool request and again inside the
// locked reservation. A takeover that lands between the two (here from the queue's `enqueue`, the one injected call
// between them) must refuse the reservation: no reviewer runs and the new owner's run keeps what the takeover wrote.
test('T0-R3-RESERVE-FENCE-TEST acceptance 1 and 2: a takeover after the first fence of review r3 refuses the reservation, runs no reviewer and leaves the new owner\'s run in SHIP [R1]', async () => {
  const fx = makeFixture({ config: { formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false } } });
  try {
    let reviewerRuns = 0;
    const runner = scriptedRunner({
      'git diff --numstat': { stdout: '0\t0\tsrc/t1-rsv.ts\n' },
      'git diff --name-only': { stdout: 'src/t1-rsv.ts\u0000' },
      'git diff': { stdout: 'diff --git a/src/t1-rsv.ts b/src/t1-rsv.ts\n+export const rsv = 1;\n' },
      'fake-r3': () => { reviewerRuns += 1; return { stdout: PASS }; },
    });
    writeCard(fx, { id: CARD, title: 'reservation fence', allowPaths: ['src/t1-rsv.ts'] });
    const goalId = goalForCards(fx, [CARD]).id;
    const card = fx.card(CARD);
    const g = () => fx.goal(goalId);
    const run = () => fx.store.getCardRun(goalId, CARD)!;
    // The queue of window A: its `enqueue` runs `onEnqueue` once, then the fixture's queue.
    let onEnqueue: (() => void) | undefined;
    const queue = Object.create(fx.queue) as typeof fx.queue;
    queue.enqueue = (...args: Parameters<typeof fx.queue.enqueue>) => {
      const hook = onEnqueue;
      onEnqueue = undefined;
      hook?.();
      return fx.queue.enqueue(...args);
    };
    const cr = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner });
    let r = cr.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
    assert.equal(r.directive.kind, 'prepare');
    r = cr.next(g(), card, r.run);
    assert.equal(r.directive.kind, 'build');
    cr.recordAttempt(g(), card, run(), { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-rsv' });
    r = cr.next(g(), card, run());
    assert.equal(r.directive.kind, 'review');
    assert.equal(run().ownerGeneration, 0, 'window A owns the card at generation 0');

    // Window B takes the card over once A's lease has expired, while A's review is between its two fences.
    let takenOver: ReturnType<CardRunner['takeover']> | undefined;
    onEnqueue = () => {
      setActorForTests(actorB);
      try {
        fx.advance(11 * 60_000);
        takenOver = cr.takeover(g(), card, run());
      } finally {
        setActorForTests(actorA);
      }
    };
    await assert.rejects(() => cr.formalReview(g(), card, run()), (e: Error) => /fenced/.test(e.message) && e.message.includes(actorB.session));

    // Acceptance 1: the takeover completed.
    assert.ok(takenOver, 'the takeover ran between the two fences');
    assert.equal(takenOver.lease.generation, 1);
    assert.equal(takenOver.lease.owner.session, actorB.session);
    assert.equal(fx.leases.read(takenOver.lease.resourceKey)?.owner.session, actorB.session, 'B holds the lease');
    // Acceptance 2: nothing of A's review landed.
    assert.equal(reviewerRuns, 0, 'no reviewer runs for an owner that lost the lease');
    const after = run();
    assert.equal(after.ownerGeneration, 1, 'the run carries B\'s generation');
    assert.equal(after.state, 'SHIP', 'the run stays in SHIP');
    assert.equal(after.stop, undefined, 'no stop is written onto B\'s run');
    assert.deepEqual(after.review.invocations, [], 'no review invocation is reserved');
    assert.equal(fx.events(goalId).filter((e) => e.type === 'REVIEW_DECIDED').length, 0, 'no REVIEW_DECIDED event');
  } finally {
    fx.cleanup();
  }
});
