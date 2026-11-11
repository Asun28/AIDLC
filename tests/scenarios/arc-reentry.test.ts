/**
 * Card T0-CARDS-PROJECTED-REENTRY: after VERIFY_ARC a new card enters a goal only through the repair cycle
 * (`aidlc goal repair`) or a recorded user revision, and `arc-verified` is refused while a listed card is not merged.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { makeFixture, writeCard, driveCardToDone, goalForCards, type Fixture } from './_harness.ts';
import { GoalController } from '../../src/loop/controller.ts';
import { Goal, type CardRun, type DeliveryTarget } from '../../src/core/types.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { runGoal } from '../../src/loop/run-driver.ts';

/** The `verify-arc` narration of main at 92796d4f, for a goal whose listed cards are all merged. */
const MAIN_VERIFY_ARC_NARRATION = 'All required cards closed. Verify the whole goal on the final integrated artifact, then report arc-verified (with evidence) or arc-failed (with the coherent repair cards).';

/** The error a call throws, or undefined when it returns. */
function refusal(fn: () => unknown): Error | undefined {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  return undefined;
}

/** A goal for `cards`, every card driven to DONE, and `next` at `verify-arc`. */
function atVerifyArc(fx: Fixture, cards: string[], options: { size?: 'T1' | 'T2'; target?: DeliveryTarget } = {}): string {
  const goal = goalForCards(fx, cards, options);
  if (options.size === 'T2') fx.controller.report({ goalId: goal.id, generation: 0, result: 'approved', data: { kind: 'plan-checkpoint', by: 'user' } });
  for (const id of cards) driveCardToDone(fx, goal.id, id);
  const d = fx.controller.next(goal.id);
  assert.equal(d.kind, 'verify-arc', d.narration);
  return goal.id;
}

/** A goal in CLOSE with its one card's lesson step open, reached as t0-flow.test.ts Q1/Q8/Q10/Q15 does. */
function atClose(fx: Fixture, cardId: string, target: DeliveryTarget): string {
  const goalId = atVerifyArc(fx, [cardId], { target });
  const run = fx.store.getCardRun(goalId, cardId)!;
  fx.store.saveCardRun({ ...run, state: 'CLOSE', closure: { ...run.closure, lessons: false } });
  const rep = fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
  if (target !== 'development') {
    assert.equal(rep.directive.kind, 'release', rep.directive.narration);
    const attemptId = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
    fx.store.saveRelease({ ...fx.store.getRelease(attemptId)!, state: 'DONE', disposition: 'delivered', updatedAt: fx.now() });
    const d = fx.controller.next(goalId);
    assert.equal(d.kind, 'close', d.narration);
  } else {
    assert.equal(rep.directive.kind, 'close', rep.directive.narration);
  }
  assert.equal(fx.goal(goalId).state, 'CLOSE');
  return goalId;
}

/** A goal record saved in VERIFY_ARC through the fixture store, listing `cards`. */
function verifyArcRecord(fx: Fixture, cards: string[], target: DeliveryTarget = 'development'): string {
  const g = fx.controller.createGoal({ text: 'build the hello feature', source: 'natural-language', affectedSurfaces: [], explicitSize: 'T1', explicitTarget: target });
  fx.store.saveGoal(Goal.parse({ ...g, state: 'VERIFY_ARC', cards, cardRevisions: Object.fromEntries(cards.map((c) => [c, 0])) }));
  return g.id;
}

function seedRun(fx: Fixture, goalId: string, cardId: string, mergeVerified: boolean, state: CardRun['state']): void {
  const run = fx.controller.ensureCardRun(fx.goal(goalId), cardId);
  fx.store.saveCardRun({ ...run, state, mergeVerified });
}

function goalBytes(fx: Fixture, goalId: string): string {
  return readFileSync(fx.store.goalFile(goalId), 'utf8');
}

test('cards-projected is refused in VERIFY_ARC, DELIVER and CLOSE before the registry is loaded, whatever data.cards holds', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-D', title: 'd', allowPaths: ['src/d.ts'] });
    writeCard(fx, { id: 'T1-C', title: 'c', allowPaths: ['src/c.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b, registered and never listed', allowPaths: ['src/b.ts'] });
    const verifying = atVerifyArc(fx, ['T1-A']);
    const delivering = atVerifyArc(fx, ['T1-D'], { target: 'staging' });
    assert.equal(fx.controller.report({ goalId: delivering, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } }).directive.kind, 'release');
    const closing = atClose(fx, 'T1-C', 'development');
    let loads = 0;
    const counted = new GoalController({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, now: fx.now, cards: () => {
      loads += 1;
      return fx.registry();
    } });
    const cancelThenResume = (id: string) => [`aidlc goal cancel ${id}`, `aidlc goal resume ${id} --text "<request>" --cards <ids>`];
    const cases: Array<[string, string, string[]]> = [
      ['VERIFY_ARC', verifying, [`aidlc goal repair ${verifying} --cards <new ids>`, `aidlc goal amend ${verifying} --text "<request>" --cards <ids>`]],
      ['DELIVER', delivering, cancelThenResume(delivering)],
      ['CLOSE', closing, cancelThenResume(closing)],
    ];
    for (const [state, goalId, routes] of cases) {
      assert.equal(fx.goal(goalId).state, state);
      for (const cards of [['T1-B'], [], ['T1-NOT-REGISTERED']]) {
        const before = goalBytes(fx, goalId);
        const journal = fx.events(goalId).length;
        loads = 0;
        const err = refusal(() => counted.report({ goalId, generation: 0, result: 'cards-projected', data: { cards } }));
        assert.ok(err, `${state}, cards [${cards.join(',')}]: cards-projected was accepted, the goal is now in ${fx.goal(goalId).state}`);
        assert.equal(loads, 0, `${state}, cards [${cards.join(',')}]: the refusal comes before any registry load (${err.message})`);
        assert.ok(err.message.includes(state), `${state}: the refusal names the state: ${err.message}`);
        for (const route of routes) assert.ok(err.message.includes(route), `${state}: the refusal names ${route}: ${err.message}`);
        assert.equal(goalBytes(fx, goalId), before, `${state}: the goal record is unchanged`);
        assert.equal(fx.events(goalId).length, journal, `${state}: nothing is journaled`);
        assert.equal(fx.goal(goalId).counters.integrationRepairCycles, 0);
      }
    }
  } finally {
    fx.cleanup();
  }
});

test('arc-verified is decided by the merge predicate over the listed cards', () => {
  const fx = makeFixture();
  try {
    // One row per (registry entry, run of this goal); merged = a `merged` entry or a run with mergeVerified.
    const rows: Array<{ id: string; entry: 'absent' | 'todo' | 'merged'; run: 'absent' | { mergeVerified: boolean; state: CardRun['state'] }; merged: boolean }> = [
      { id: 'T1-NOENTRY-NORUN', entry: 'absent', run: 'absent', merged: false },
      { id: 'T1-NOENTRY-RUNOPEN', entry: 'absent', run: { mergeVerified: false, state: 'BUILD' }, merged: false },
      { id: 'T1-NOENTRY-RUNMERGED', entry: 'absent', run: { mergeVerified: true, state: 'CLOSE' }, merged: true },
      { id: 'T1-TODO-NORUN', entry: 'todo', run: 'absent', merged: false },
      { id: 'T1-TODO-RUNOPEN', entry: 'todo', run: { mergeVerified: false, state: 'BUILD' }, merged: false },
      { id: 'T1-TODO-RUNMERGED', entry: 'todo', run: { mergeVerified: true, state: 'DONE' }, merged: true },
      { id: 'T1-MERGED-NORUN', entry: 'merged', run: 'absent', merged: true },
      { id: 'T1-MERGED-RUNOPEN', entry: 'merged', run: { mergeVerified: false, state: 'BUILD' }, merged: true },
      { id: 'T1-MERGED-RUNMERGED', entry: 'merged', run: { mergeVerified: true, state: 'CLOSE' }, merged: true },
    ];
    for (const row of rows) if (row.entry !== 'absent') writeCard(fx, { id: row.id, title: row.id.toLowerCase(), allowPaths: [`src/${row.id.toLowerCase()}.ts`], status: row.entry });
    const seed = (goalId: string, ids: string[]) => {
      for (const row of rows) if (ids.includes(row.id) && row.run !== 'absent') seedRun(fx, goalId, row.id, row.run.mergeVerified, row.run.state);
    };

    for (const row of rows) {
      const goalId = verifyArcRecord(fx, [row.id]);
      seed(goalId, [row.id]);
      const journal = fx.events(goalId).length;
      const err = refusal(() => fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } }));
      const label = `${row.id} (entry ${row.entry}, run ${row.run === 'absent' ? 'absent' : `mergeVerified ${row.run.mergeVerified}`})`;
      if (row.merged) {
        assert.equal(err, undefined, `${label} is merged, so arc-verified is accepted: ${err?.message}`);
        assert.equal(fx.goal(goalId).state, 'CLOSE', label);
      } else {
        assert.ok(err, `${label} is not merged, so arc-verified is refused; the goal is now in ${fx.goal(goalId).state}`);
        assert.ok(err.message.includes(row.id), `${label}: the refusal names the card: ${err.message}`);
        assert.equal(fx.goal(goalId).state, 'VERIFY_ARC', label);
        assert.equal(fx.events(goalId).length, journal, `${label}: nothing is journaled`);
      }
    }

    // Every row on one goal: the refusal and the narration name every failing id at once, and no merged one.
    const all = verifyArcRecord(fx, rows.map((r) => r.id));
    seed(all, rows.map((r) => r.id));
    const failing = rows.filter((r) => !r.merged).map((r) => r.id);
    const passing = rows.filter((r) => r.merged).map((r) => r.id);
    const d = fx.controller.next(all);
    assert.equal(d.kind, 'verify-arc');
    for (const id of failing) assert.ok(d.narration.includes(id), `the narration names ${id}: ${d.narration}`);
    for (const id of passing) assert.ok(!d.narration.includes(id), `the narration leaves out the merged ${id}: ${d.narration}`);
    assert.match(d.narration, /arc-verified is refused until/);
    assert.match(d.narration, /merges or a revision removes it/);
    const journal = fx.events(all).length;
    const err = refusal(() => fx.controller.report({ goalId: all, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } }));
    assert.ok(err, `arc-verified with ${failing.join(',')} not merged was accepted`);
    for (const id of failing) assert.ok(err.message.includes(id), `the refusal names ${id}: ${err.message}`);
    for (const id of passing) assert.ok(!err.message.includes(id), `the refusal leaves out the merged ${id}: ${err.message}`);
    assert.equal(fx.goal(all).state, 'VERIFY_ARC');
    assert.equal(fx.events(all).length, journal);

    // Every listed card merged: main's narration, and arc-verified is accepted.
    const merged = verifyArcRecord(fx, passing);
    seed(merged, passing);
    assert.equal(fx.controller.next(merged).narration, MAIN_VERIFY_ARC_NARRATION);
    fx.controller.report({ goalId: merged, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
    assert.equal(fx.goal(merged).state, 'CLOSE');

    // An empty card list passes as on main.
    const empty = verifyArcRecord(fx, []);
    fx.controller.report({ goalId: empty, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
    assert.equal(fx.goal(empty).state, 'DONE', 'accepted, and with no card to close the next derives DONE');

    // A card the revision removed keeps its run, which is not merged, and does not block.
    const revised = verifyArcRecord(fx, ['T1-MERGED-NORUN', 'T1-TODO-RUNOPEN']);
    seed(revised, ['T1-TODO-RUNOPEN']);
    fx.controller.report({ goalId: revised, generation: 0, result: 'revision', data: { text: 'drop the open card', cards: ['T1-MERGED-NORUN'] } });
    assert.equal(fx.goal(revised).state, 'VERIFY_ARC');
    assert.equal(fx.store.getCardRun(revised, 'T1-TODO-RUNOPEN')?.mergeVerified, false, 'the removed card keeps its run');
    assert.equal(fx.controller.next(revised).narration, MAIN_VERIFY_ARC_NARRATION);
    fx.controller.report({ goalId: revised, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
    assert.equal(fx.goal(revised).state, 'CLOSE');
  } finally {
    fx.cleanup();
  }
});

test('a revision in VERIFY_ARC that adds a card returns the goal to PLAN, and the card runs before the arc is verified again', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
    writeCard(fx, { id: 'T1-C', title: 'c', allowPaths: ['src/c.ts'] });
    const goalId = atVerifyArc(fx, ['T1-A'], { size: 'T1' });
    const journal = fx.events(goalId).length;
    const rev = fx.controller.report({ goalId, generation: 0, result: 'revision', data: { text: 'build a, then b', cards: ['T1-A', 'T1-B'] } });
    const g = fx.goal(goalId);
    assert.equal(g.state, 'PLAN');
    assert.equal(g.revision, 1);
    assert.equal(g.counters.integrationRepairCycles, 0, 'a revision does not spend the repair cycle');
    assert.ok(fx.events(goalId).slice(journal).some((e) => e.type === 'GOAL_REVISED'));
    assert.equal(rev.directive.kind, 'project-cards', rev.directive.narration);
    const projected = fx.controller.report({ goalId, generation: 0, result: 'cards-projected', data: { cards: ['T1-A', 'T1-B'] } });
    assert.equal(projected.directive.kind, 'run-card', projected.directive.narration);
    if (projected.directive.kind === 'run-card') assert.equal(projected.directive.cardId, 'T1-B');
    driveCardToDone(fx, goalId, 'T1-B');
    assert.equal(fx.controller.next(goalId).kind, 'verify-arc');
    fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
    assert.equal(fx.goal(goalId).state, 'DONE', 'accepted, and with both cards closed the next derives DONE');

    // A revision in VERIFY_ARC that only drops a card stays in VERIFY_ARC.
    const pair = atVerifyArc(fx, ['T1-A', 'T1-C'], { size: 'T1' });
    fx.controller.report({ goalId: pair, generation: 0, result: 'revision', data: { text: 'a only', cards: ['T1-A'] } });
    assert.equal(fx.goal(pair).state, 'VERIFY_ARC');

    // T2: the revision goes through PLAN and CARDS, and the added card waits for the checkpoint of the new revision.
    const t2 = atVerifyArc(fx, ['T1-C'], { size: 'T2' });
    const t2rev = fx.controller.report({ goalId: t2, generation: 0, result: 'revision', data: { text: 'build c, then b', cards: ['T1-C', 'T1-B'] } });
    assert.equal(fx.goal(t2).state, 'PLAN');
    assert.equal(t2rev.directive.kind, 'project-cards', t2rev.directive.narration);
    const t2projected = fx.controller.report({ goalId: t2, generation: 0, result: 'cards-projected', data: { cards: ['T1-C', 'T1-B'] } });
    assert.equal(fx.goal(t2).state, 'CARDS');
    assert.equal(t2projected.directive.kind, 'checkpoint', `revision 1 is not approved yet: ${t2projected.directive.narration}`);
    assert.equal(t2projected.directive.revision, 1);
    assert.equal(fx.controller.next(t2).kind, 'checkpoint', 'no run-card before the approval');
    const approved = fx.controller.report({ goalId: t2, generation: 0, result: 'approved', data: { kind: 'plan-checkpoint', by: 'user' } });
    assert.equal(approved.directive.kind, 'run-card', approved.directive.narration);
    if (approved.directive.kind === 'run-card') assert.equal(approved.directive.cardId, 'T1-B');
  } finally {
    fx.cleanup();
  }
});

test('a revision in DELIVER or CLOSE that adds a card is refused before any write; cancel, then resume with it, runs the card in a new generation', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-S', title: 's', allowPaths: ['src/s.ts'] });
    writeCard(fx, { id: 'T1-V', title: 'v', allowPaths: ['src/v.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b, the added card', allowPaths: ['src/b.ts'] });
    const delivering = atVerifyArc(fx, ['T1-A'], { target: 'staging' });
    assert.equal(fx.controller.report({ goalId: delivering, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } }).directive.kind, 'release');
    const closingStaging = atClose(fx, 'T1-S', 'staging');
    const closingDevelopment = atClose(fx, 'T1-V', 'development');
    const cases: Array<[string, string, string, RegExp]> = [
      ['DELIVER', delivering, 'T1-A', /release attempt of this generation would be continued or reused/],
      ['CLOSE', closingStaging, 'T1-S', /delivered release of this generation would close the goal/],
      ['CLOSE', closingDevelopment, 'T1-V', /CLOSE leads only to DONE (?:and|or) STOP/],
    ];
    for (const [state, goalId, kept, reason] of cases) {
      const before = goalBytes(fx, goalId);
      const journal = fx.events(goalId).length;
      const err = refusal(() => fx.controller.report({ goalId, generation: 0, result: 'revision', data: { text: 'add b', cards: [kept, 'T1-B'] } }));
      assert.ok(err, `${state} (${fx.goal(goalId).target}): the revision that adds T1-B was accepted; state ${fx.goal(goalId).state}, revision ${fx.goal(goalId).revision}`);
      assert.ok(err.message.includes(`aidlc goal cancel ${goalId}`), `${state}: names the cancel: ${err.message}`);
      assert.ok(err.message.includes(`aidlc goal resume ${goalId} --text "<request>" --cards <ids>`), `${state}: names the resume: ${err.message}`);
      assert.match(err.message, reason);
      assert.equal(goalBytes(fx, goalId), before, `${state}: the goal record is unchanged`);
      assert.equal(fx.goal(goalId).revision, 0);
      assert.equal(fx.goal(goalId).state, state);
      assert.equal(fx.events(goalId).length, journal, `${state}: nothing is journaled`);
    }

    // The same revision in PLAN or CARDS is accepted with the state unchanged, as on main (R8).
    const planning = fx.controller.createGoal({ text: 'build the hello feature', source: 'natural-language', affectedSurfaces: [], explicitSize: 'T1' });
    fx.controller.report({ goalId: planning.id, generation: 0, result: 'revision', data: { text: 'add b', cards: ['T1-B'] } });
    assert.deepEqual([fx.goal(planning.id).state, fx.goal(planning.id).revision], ['PLAN', 1]);
    const projecting = goalForCards(fx, ['T1-A'], { size: 'T2' });
    assert.equal(projecting.state, 'CARDS', 'a T2 projection waits in CARDS for its checkpoint');
    fx.controller.report({ goalId: projecting.id, generation: 0, result: 'revision', data: { text: 'add b', cards: ['T1-A', 'T1-B'] } });
    assert.deepEqual([fx.goal(projecting.id).state, fx.goal(projecting.id).revision], ['CARDS', 1]);

    // A text-only revision in DELIVER lists merged cards only: accepted, the state unchanged.
    fx.controller.report({ goalId: delivering, generation: 0, result: 'revision', data: { text: 'ship a, reworded' } });
    assert.equal(fx.goal(delivering).revision, 1);
    assert.equal(fx.goal(delivering).state, 'DELIVER');

    // The named route: cancel, then resume with the text and the whole card list.
    fx.controller.report({ goalId: delivering, generation: 0, result: 'cancel', data: { detail: 'add b' } });
    const resumed = fx.controller.report({ goalId: delivering, generation: 0, result: 'resume', data: { reason: 'add b', text: 'ship a and b', cards: ['T1-A', 'T1-B'] } });
    assert.equal(fx.goal(delivering).generation, 1);
    assert.equal(resumed.directive.kind, 'run-card', resumed.directive.narration);
    if (resumed.directive.kind === 'run-card') assert.equal(resumed.directive.cardId, 'T1-B');
  } finally {
    fx.cleanup();
  }
});

test('aidlc run ends without a delivery when the provider reports arc-verified for a goal whose listed card is not merged', async () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-OPEN', title: 'open', allowPaths: ['src/open.ts'] });
    const goalId = verifyArcRecord(fx, ['T1-OPEN'], 'staging');
    const refusals: string[] = [];
    const failures: string[] = [];
    const provider = new MockProvider();
    const complete = provider.complete.bind(provider);
    provider.complete = async (request) => {
      const directive = JSON.parse(request.prompt.slice(request.prompt.indexOf('{'), request.prompt.lastIndexOf('}') + 1)) as { kind: string };
      if (directive.kind === 'verify-arc') {
        const err = refusal(() => fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: { evidence: 'integrated check passed' } }));
        if (err) refusals.push(err.message);
      }
      return complete(request);
    };
    const directive = await runGoal(goalId, 3, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now, onFailure: (reason) => failures.push(reason) });
    assert.equal(refusals.length, 1, `the provider's arc-verified is refused: ${refusals.join(' | ')}`);
    assert.ok(refusals[0]!.includes('T1-OPEN'));
    assert.deepEqual(failures, ['provider returned with no state transition']);
    assert.equal(directive.kind, 'verify-arc');
    assert.equal(fx.goal(goalId).state, 'VERIFY_ARC');
    assert.deepEqual(fx.store.listReleases(goalId), [], 'no release attempt is created');
  } finally {
    fx.cleanup();
  }
});
