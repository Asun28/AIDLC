import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, driveCardToDone, candidateShaFor } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import { CardRun, addMs } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actorA, actorB } from './_harness.ts';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

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

test('WAIT resumes: a goal polled while its only card was running parks in WAIT and still reaches verify-arc once the card closes', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-PARK', title: 'parked while running' });
    const goal = fx.controller.createGoal({ text: 'implement T1-PARK', source: 'card', ref: 'T1-PARK', affectedSurfaces: [] }, { cards: ['T1-PARK'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-PARK'] } });
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const card = fx.card('T1-PARK');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-PARK'));
    assert.equal(r.directive.kind, 'prepare');
    assert.equal(r.run.state, 'BUILD');

    // Polling the goal while the card is in BUILD parks the goal in WAIT (the common operator path).
    const parked = fx.controller.next(goal.id);
    assert.equal(parked.kind, 'wait');
    assert.equal(fx.goal(goal.id).state, 'WAIT');

    // The card finishes normally.
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: candidateShaFor('T1-PARK') });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'close');
    r = runner.next(fx.goal(goal.id), card, runner.markClosure(fx.goal(goal.id), card, r.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true }));
    assert.equal(r.directive.kind, 'done');

    // The parked goal must resume: WAIT -> RUN -> VERIFY_ARC, never an illegal WAIT -> VERIFY_ARC throw.
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'verify-arc');
    assert.equal(fx.goal(goal.id).state, 'VERIFY_ARC');
    const states = fx.events(goal.id).filter((e) => e.type === 'GOAL_STATE').map((e) => `${String(e.data?.['from'])}->${String(e.data?.['to'])}`);
    assert.ok(states.includes('WAIT->RUN'), `resumption must be journaled: ${states.join(', ')}`);
    assert.ok(states.includes('RUN->VERIFY_ARC'), `verify-arc must be derived from RUN: ${states.join(', ')}`);
    const done = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: 'integrated checks green' } });
    assert.equal(done.directive.kind, 'done');
  } finally {
    fx.cleanup();
  }
});

test('pre-review gate: a block returns to BUILD as a counted repair, a pass opens the ship, an R3 block restarts the cycle, and exhaustion is STOP/review unless onExhausted is ship', () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-reviewer'], reviewer: 'fake', rounds: 2, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const verdicts: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-gate.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-gate.ts b/src/t1-gate.ts\n+export const gate = 1;\n' },
      'fake-reviewer': () => ({ stdout: verdicts.shift() ?? '{"verdict":"pass","reasons":[]}\n' }),
    });
    const mk = (rounds: number, onExhausted: 'stop' | 'ship' = 'stop') =>
      new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, preReview: { ...fx.config.preReview, rounds, onExhausted } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged', 'merged', 'merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-GATE', title: 'gate the ship' });
    const goal = fx.controller.createGoal({ text: 'implement T1-GATE', source: 'card', ref: 'T1-GATE', affectedSurfaces: [] }, { cards: ['T1-GATE'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-GATE'] } });
    const runner = mk(2);
    const card = fx.card('T1-GATE');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-GATE'));
    assert.equal(r.directive.kind, 'prepare');
    let run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: 'sha-1' });

    // Round 1: the gate asks for a pre-review before any ship is issued.
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') {
      assert.equal(r.directive.round, 1);
      assert.equal(r.directive.maxRounds, 2);
    }
    assert.equal(fx.ops.list({ goalId: goal.id, kind: 'merge' }).length, 0, 'nothing ships before the pre-review');
    verdicts.push('=== answer ===\n{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-gate.ts:1: no RED -> add a failing test first"]}\n');
    const round1 = runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(round1.result.outcome, 'block');
    assert.equal(round1.run.state, 'BUILD');
    assert.equal(round1.run.dodReceipt, undefined, 'a block clears the DoD receipt');
    assert.equal(round1.run.effort?.attempts.at(-1)?.outcome, 'fail', 'the blocked attempt becomes a counted failure');
    assert.equal(round1.run.preReview.rounds.length, 1);
    assert.ok(round1.result.verdictRef && existsSync(round1.result.verdictRef), 'verdict retained next to the candidate');

    // The repair is the next counted attempt; the new candidate needs a fresh round.
    r = runner.next(fx.goal(goal.id), card, round1.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.equal(r.directive.attempt, 2);
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok2', redReceipt: 'red:ok', candidateSha: 'sha-2' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 2);
    // A quota hold is WAIT, never a decision: the gate parks the card until the hold clears, then asks again.
    verdicts.push('Error: 429 Too Many Requests, retry after 60 seconds\n');
    const held = runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(held.result.outcome, 'quota-hold');
    r = runner.next(fx.goal(goal.id), card, held.run);
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    if (r.directive.kind === 'wait') assert.equal(r.directive.on, 'pre-review-quota');
    assert.equal(r.run.state, 'WAIT');
    fx.advance(61_000);
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 2, 'a hold consumes no round');
    // A malformed verdict gets one retry within the cycle; it consumes no round either.
    verdicts.push('I cannot decide.\n');
    const noVerdict = runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(noVerdict.result.outcome, 'no-verdict');
    r = runner.next(fx.goal(goal.id), card, noVerdict.run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 2);
    verdicts.push('{"verdict":"pass","reasons":[]}\n');
    const round2 = runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(round2.result.outcome, 'pass');
    assert.equal(round2.run.state, 'SHIP');

    // A pass opens the ship (dry-run merged -> CLOSE); both rounds are journaled.
    r = runner.next(fx.goal(goal.id), card, round2.run);
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    assert.equal(fx.ops.list({ goalId: goal.id, kind: 'merge' }).length, 1);
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED').length, 4, 'block, quota hold, no-verdict and pass are all journaled');

    // An R3 block starts a new cycle: the repaired candidate needs a fresh pass, counted from round 1.
    const cycled = fx.store.saveCardRun(CardRun.parse({ ...r.run, state: 'BUILD', mergeVerified: false, review: { ...r.run.review, substantiveDecisions: 1, substantiveBlocks: 1 }, candidate: { sha: 'sha-3', dirty: false, untracked: [], digest: 'sha-3' }, dodReceipt: 'dod:ok3', updatedAt: fx.now() }));
    r = runner.next(fx.goal(goal.id), card, cycled);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 1);
    // The no-verdict retry is per cycle: the earlier cycle's retry does not exhaust this one.
    verdicts.push('garbage\n');
    const noVerdict2 = runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(noVerdict2.result.outcome, 'no-verdict');
    r = runner.next(fx.goal(goal.id), card, noVerdict2.run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 1);

    // Exhaustion: with one round per cycle, a block followed by a fix has no round left -> STOP/review.
    const strict = mk(1);
    verdicts.push('{"verdict":"block","reasons":["[standards] 9 error handling @ src/t1-gate.ts:2: swallowed error -> rethrow"]}\n');
    const round3 = strict.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(round3.run.state, 'BUILD');
    r = strict.next(fx.goal(goal.id), card, round3.run);
    assert.equal(r.directive.kind, 'build');
    run = strict.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok4', redReceipt: 'red:ok', candidateSha: 'sha-4' });
    r = strict.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'review');

    // ... unless the policy hands the residual findings to R3.
    const lenient = mk(1, 'ship');
    r = lenient.next(fx.goal(goal.id), card, { ...run, state: 'SHIP', stop: undefined });
    assert.equal(r.directive.kind, 'close', r.directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('formal review (R3) command: R2 pass first, then a review directive; a block is REVIEW_FIX and restarts the pre-review cycle; retry and quota hold never decide; a pass opens the ship', () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const r2: string[] = [];
    const r3: string[] = [];
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-r3.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-r3.ts b/src/t1-r3.ts\n+export const r3 = 1;\n' },
      'fake-r2': () => ({ stdout: r2.shift() ?? PASS }),
      'fake-r3': () => ({ stdout: r3.shift() ?? PASS }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged', 'merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-R3', title: 'formal review command' });
    const goal = fx.controller.createGoal({ text: 'implement T1-R3', source: 'card', ref: 'T1-R3', affectedSurfaces: [] }, { cards: ['T1-R3'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-R3'] } });
    const card = fx.card('T1-R3');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-R3'));
    let run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });

    // R3 refuses to run before the R2 pass.
    assert.throws(() => runner.formalReview(fx.goal(goal.id), card, run), /pre-review/);
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    r = runner.next(fx.goal(goal.id), card, runner.preReview(fx.goal(goal.id), card, r.run).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(fx.ops.list({ goalId: goal.id, kind: 'merge' }).length, 0, 'nothing ships before R3');

    // A malformed R3 output gets the single retry; a quota hold parks the card; neither is a decision.
    r3.push('nonsense\n');
    let f = runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'no-verdict');
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    r3.push('429 Too Many Requests, retry after 60 seconds\n');
    f = runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'quota-hold');
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'wait');
    if (r.directive.kind === 'wait') assert.equal(r.directive.on, 'review-quota');
    fx.advance(61_000);
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(r.run.review.substantiveDecisions, 0);

    // A block (gateRequired) is REVIEW_FIX with one decision consumed; the verdict file is candidate-bound.
    r3.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-r3.ts:1: no RED -> add a failing test"],"axes":{"spec":{"verdict":"block","reasons":["tests"]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    f = runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    assert.equal(f.run.state, 'REVIEW_FIX');
    assert.equal(f.run.review.substantiveDecisions, 1);
    assert.equal(f.run.review.substantiveBlocks, 1);
    assert.equal(f.run.dodReceipt, undefined);
    assert.ok(f.verdictRef && existsSync(f.verdictRef));
    assert.equal((JSON.parse(readFileSync(f.verdictRef, 'utf8')) as { sha: string }).sha, 'sha-1');

    // The repair is the next attempt; the repaired candidate restarts loop 1 (pre-review cycle 1) before R3 runs again.
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'build');
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 1);
    r = runner.next(fx.goal(goal.id), card, runner.preReview(fx.goal(goal.id), card, r.run).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    f = runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(f.run.review.substantiveDecisions, 2);
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    assert.equal(fx.ops.list({ goalId: goal.id, kind: 'merge' }).length, 1);
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').length, 4, 'no-verdict, quota hold, block and pass are all journaled');
  } finally {
    fx.cleanup();
  }
});

test('formal review guards: an advisory block proceeds, a hold blocks the command, a stale sha never passes, and a third decision is refused', () => {
  const fx = makeFixture({ config: { formalReview: { command: ['fake-r3'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const r3: string[] = [];
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-guard.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-guard.ts b/src/t1-guard.ts\n+export const guard = 1;\n' },
      'fake-r2': { stdout: PASS },
      'fake-r3': () => ({ stdout: r3.shift() ?? PASS }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged', 'merged', 'merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-GUARD', title: 'review guards' });
    const goal = fx.controller.createGoal({ text: 'implement T1-GUARD', source: 'card', ref: 'T1-GUARD', affectedSurfaces: [] }, { cards: ['T1-GUARD'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-GUARD'] } });
    const card = fx.card('T1-GUARD');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-GUARD'));
    let run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    const ledgerBase = { base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3' };

    // (1) A standards-only block without a required gate is advisory: the decision counts, the ship proceeds.
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'review');
    r3.push('{"verdict":"block","reasons":["[standards] 16 slop @ src/t1-guard.ts:1: dead helper -> remove"],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"block","reasons":["dead helper"]}}}\n');
    let f = runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'block-advisory');
    assert.equal(f.run.state, 'SHIP');
    assert.equal(f.run.review.substantiveDecisions, 1);
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'close', `advisory findings never become a silent merge bar: ${r.directive.narration}`);

    // (2) An active quota hold blocks the command itself, for R3 and for R2 alike.
    const held = fx.store.saveCardRun(CardRun.parse({ ...r.run, state: 'BUILD', mergeVerified: false, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2', review: { ...r.run.review, invocations: [...r.run.review.invocations, { ...ledgerBase, invocationId: 'r3:hold', candidateDigest: 'sha-2', requestedAt: fx.now(), outcome: 'quota-hold', holdUntil: addMs(fx.now(), 60_000) }] }, updatedAt: fx.now() }));
    assert.throws(() => runner.formalReview(fx.goal(goal.id), card, held), /hold/);
    const r2Runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, preReview: { ...fx.config.preReview, command: ['fake-r2'], reviewer: 'fake-r2' } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const heldR2 = { ...held, preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-2', requestedAt: fx.now(), durationMs: 0, outcome: 'quota-hold' as const, reasons: [], holdUntil: addMs(fx.now(), 60_000) }] } };
    assert.throws(() => r2Runner.preReview(fx.goal(goal.id), card, heldR2), /hold/);
    fx.advance(61_000);

    // (3) A verdict that names another sha is stale: never a pass, not a decision, and it never overwrites the candidate-bound verdict file.
    r = runner.next(fx.goal(goal.id), card, held);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    r3.push('{"verdict":"pass","reasons":[],"sha":"sha-1","axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    f = runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.stale, true);
    assert.equal(f.classified.outcome, 'no-verdict');
    assert.equal(f.run.review.substantiveDecisions, 1);
    const verdictFile = JSON.parse(readFileSync(path.join(fx.repo.mainRoot, '.review', 'T1-GUARD.json'), 'utf8')) as { sha: string; verdict: string };
    assert.equal(verdictFile.sha, 'sha-1', 'the stale verdict must not be stamped onto the current candidate');
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'review', 'the single no-verdict retry');
    r3.push(PASS);
    f = runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(f.run.review.substantiveDecisions, 2);
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'close', r.directive.narration);

    // (4) The two-decision allowance is enforced before a third review is issued or run.
    const third = fx.store.saveCardRun(CardRun.parse({ ...r.run, state: 'BUILD', mergeVerified: false, candidate: { sha: 'sha-3', dirty: false, untracked: [], digest: 'sha-3' }, dodReceipt: 'dod:3', updatedAt: fx.now() }));
    r = runner.next(fx.goal(goal.id), card, third);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'review');
    assert.throws(() => runner.formalReview(fx.goal(goal.id), card, third), /allowance/);
  } finally {
    fx.cleanup();
  }
});
