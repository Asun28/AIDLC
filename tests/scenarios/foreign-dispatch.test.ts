// Card T0-FOREIGN-DISPATCH-NO-WRITE (issue 378): `card next` from a session that does not hold a live card lease writes
// nothing to the run record, the goal journal or the lease, and returns a stop that names the holder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { makeFixture, writeCard, goalForCards, actorA, actorB, type Fixture } from './_harness.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { LeaseStore, resourceKeys, type ClaimResult } from '../../src/coordination/lease.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import type { Goal } from '../../src/core/types.ts';

const CARD = 'T1-HELLO';

/** The bytes of the run record, the journal line count and the bytes of the lease record. */
function written(fx: Fixture, goal: Goal): { run: string; journalLines: number; lease: string } {
  return {
    run: readFileSync(fx.store.cardFile(goal.id, CARD), 'utf8'),
    journalLines: readFileSync(fx.journal(goal.id).file, 'utf8').split('\n').filter(Boolean).length,
    lease: readFileSync(fx.leases.file(resourceKeys.card(fx.repo.key, CARD)), 'utf8'),
  };
}

/** Session B prepares the card, holds its lease and reaches BUILD; the BUILD directive B's next call returns. */
function heldByB(): { fx: Fixture; goal: Goal; buildBefore: ReturnType<CardRunner['next']>['directive'] } {
  const fx = makeFixture({ actor: actorA });
  writeCard(fx, { id: CARD, title: 'print hello' });
  const goal = goalForCards(fx, [CARD]);
  setActorForTests(actorB);
  const prepared = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  assert.equal(prepared.directive.kind, 'prepare', prepared.directive.narration);
  const build = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
  assert.equal(build.directive.kind, 'build', build.directive.narration);
  assert.equal(fx.store.getCardRun(goal.id, CARD)?.state, 'BUILD');
  return { fx, goal, buildBefore: build.directive };
}

function assertNamesHolder(fx: Fixture, goal: Goal, directive: ReturnType<CardRunner['next']>['directive']): void {
  assert.equal(directive.kind, 'stop', directive.narration);
  if (directive.kind !== 'stop') return;
  const lease = fx.leases.read(resourceKeys.card(fx.repo.key, CARD))!;
  assert.equal(directive.stop.reason, 'ownership');
  for (const part of [`session ${actorB.session}`, `host ${actorB.host}`, `generation ${lease.generation}`, lease.expiresAt]) {
    assert.ok(directive.stop.detail.includes(part), `the detail names ${part}: ${directive.stop.detail}`);
  }
  assert.ok(directive.stop.nextAction.includes(`aidlc card takeover ${CARD} --goal ${goal.id}`), directive.stop.nextAction);
}

test('T0-FOREIGN-DISPATCH-NO-WRITE acceptance 1 - card next under another session\'s live card lease writes nothing and names the holder', () => {
  const { fx, goal } = heldByB();
  try {
    setActorForTests(actorA);
    const before = written(fx, goal);
    const foreign = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.deepEqual(written(fx, goal), before, 'the run file, the journal and the lease file are as before the call');
    assertNamesHolder(fx, goal, foreign.directive);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-FOREIGN-DISPATCH-NO-WRITE acceptance 2 - the holder continues after a foreign dispatch with no recovery step', () => {
  const { fx, goal, buildBefore } = heldByB();
  try {
    setActorForTests(actorA);
    assert.equal(fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!).directive.kind, 'stop');
    setActorForTests(actorB);
    const after = fx.runner().next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.deepEqual(after.directive, buildBefore, 'the holder gets the BUILD directive it got before the foreign call');
    const revalidated = fx.events(goal.id).filter((e) => e.type === 'LEASE_RENEWED' && e.data['revalidated'] === true);
    assert.equal(revalidated.length, 0, 'no ownership stop was left for the holder to revalidate');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T0-FOREIGN-DISPATCH-NO-WRITE acceptance 3 - the held claim in PREPARE writes nothing', () => {
  const fx = makeFixture({ actor: actorA });
  try {
    writeCard(fx, { id: CARD, title: 'print hello' });
    const goal = goalForCards(fx, [CARD]);
    fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
    const key = resourceKeys.card(fx.repo.key, CARD);
    // Session B takes the lease after A's assessment read it (none: PREPARE selected) and before A's claim.
    let before: ReturnType<typeof written> | undefined;
    class TakenBeforeClaim extends LeaseStore {
      override claim(resourceKey: string, options: Parameters<LeaseStore['claim']>[1] = {}): ClaimResult {
        if (!before && resourceKey === key && !options.actor) {
          assert.equal(super.claim(resourceKey, { actor: actorB, now: options.now, operation: `card:${CARD}` }).status, 'acquired');
          before = written(fx, goal);
        }
        return super.claim(resourceKey, options);
      }
    }
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: new TakenBeforeClaim(fx.paths.leases), queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
    const r = runner.next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD)!);
    assert.ok(before, 'the lease was taken between the assessment and the claim');
    const after = written(fx, goal);
    assert.deepEqual({ run: after.run, journalLines: after.journalLines }, { run: before.run, journalLines: before.journalLines }, 'the run file and the journal are as before the claim');
    assertNamesHolder(fx, goal, r.directive);
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});
