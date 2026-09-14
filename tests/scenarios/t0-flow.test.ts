import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, driveCardToDone, candidateShaFor, InjectedShipPath } from './_harness.ts';
import { DryRunShipPath, ScaffoldShipPath } from '../../src/delivery/ship.ts';
import { DEFAULT_LEASE_TTL_MS, resourceKeys } from '../../src/coordination/lease.ts';
import { CardRun, addMs, type Verdict } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actorA, actorB } from './_harness.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CardRunner, hasConflictDiagnostic } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { countedFailures } from '../../src/core/effort.ts';

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
    assert.ok(r.directive.narration.includes('docs/LESSONS.md'), 'PREPARE points at the lessons file');
    assert.equal(r.run.state, 'BUILD');
    assert.ok(r.run.worktree);

    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') {
      assert.equal(r.directive.attempt, 1);
      assert.equal(r.directive.effort, 'medium');
      assert.equal(r.directive.tdd, true);
      assert.deepEqual(r.directive.skills, ['tdd'], 'BUILD names the tdd skill');
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

test('pre-review gate: a block returns to BUILD as a counted repair, a pass opens the ship, an R3 block restarts the cycle, and exhaustion is STOP/review unless onExhausted is ship', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-reviewer'], reviewer: 'fake', rounds: 2, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const verdicts: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-gate.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-gate.ts b/src/t1-gate.ts\n+export const gate = 1;\n' },
      'fake-reviewer': () => {
        const out = verdicts.shift() ?? '{"verdict":"pass","reasons":[]}\n';
        if (out.includes('429')) fx.advance(90_000); // the review itself outlasts the hold it reports
        return { stdout: out };
      },
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
    const round1 = await runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(round1.result.outcome, 'block');
    assert.equal(round1.run.state, 'BUILD');
    assert.equal(round1.run.dodReceipt, undefined, 'a block clears the DoD receipt');
    assert.equal(round1.run.effort?.attempts.at(-1)?.outcome, 'success', 'the blocked attempt keeps its success; the review budget, not the ladder, paid for the block');
    assert.equal(round1.run.effort?.terminal, undefined, 'the episode is reopened for the repair');
    assert.equal(round1.run.preReview.rounds.length, 1);
    assert.ok(round1.result.verdictRef && existsSync(round1.result.verdictRef), 'verdict retained next to the candidate');

    // The repair is the next counted attempt; the new candidate needs a fresh round.
    r = runner.next(fx.goal(goal.id), card, round1.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.deepEqual(r.directive.skills, ['tdd'], 'the build directive for a pending pre-review block names the skills');
    if (r.directive.kind === 'build') assert.equal(r.directive.attempt, 2);
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok2', redReceipt: 'red:ok', candidateSha: 'sha-2' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 2);
    // A quota hold is WAIT, never a decision: the gate parks the card until the hold clears, then asks again.
    verdicts.push('Error: 429 Too Many Requests, retry after 60 seconds\n');
    const held = await runner.preReview(fx.goal(goal.id), card, r.run);
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
    const noVerdict = await runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(noVerdict.result.outcome, 'no-verdict');
    // Retried rounds keep every attempt's evidence: distinct files, the earlier round document still present.
    assert.ok(held.round.verdictRef && existsSync(held.round.verdictRef), 'the held round retained its document');
    assert.ok(noVerdict.round.verdictRef && existsSync(noVerdict.round.verdictRef), 'the retried round retained its document');
    assert.notEqual(held.round.verdictRef, noVerdict.round.verdictRef, 'a retry never overwrites an earlier attempt');
    r = runner.next(fx.goal(goal.id), card, noVerdict.run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 2);
    verdicts.push('{"verdict":"pass","reasons":[]}\n');
    const round2 = await runner.preReview(fx.goal(goal.id), card, r.run);
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
    const noVerdict2 = await runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(noVerdict2.result.outcome, 'no-verdict');
    r = runner.next(fx.goal(goal.id), card, noVerdict2.run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 1);

    // Exhaustion: with one round per cycle, a block followed by a fix has no round left -> STOP/review.
    const strict = mk(1);
    verdicts.push('{"verdict":"block","reasons":["[standards] 9 error handling @ src/t1-gate.ts:2: swallowed error -> rethrow"]}\n');
    const round3 = await strict.preReview(fx.goal(goal.id), card, r.run);
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

test('formal review (R3) command: R2 pass first, then a review directive; a block is REVIEW_FIX and restarts the pre-review cycle; retry and quota hold never decide; a pass opens the ship', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const r2: string[] = [];
    const r3: string[] = [];
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-r3.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-r3.ts b/src/t1-r3.ts\n+export const r3 = 1;\n' },
      'fake-r2': () => ({ stdout: r2.shift() ?? PASS }),
      'fake-r3': () => {
        const out = r3.shift() ?? PASS;
        if (out.includes('429')) fx.advance(90_000); // the review itself outlasts the hold it reports
        return { stdout: out };
      },
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
    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, run), /pre-review/);
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    r = runner.next(fx.goal(goal.id), card, (await runner.preReview(fx.goal(goal.id), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(fx.ops.list({ goalId: goal.id, kind: 'merge' }).length, 0, 'nothing ships before R3');

    // A malformed R3 output gets the single retry; a quota hold parks the card; neither is a decision.
    r3.push('nonsense\n');
    let f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'no-verdict');
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    r3.push('429 Too Many Requests, retry after 60 seconds\n');
    f = await runner.formalReview(fx.goal(goal.id), card, r.run);
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
    f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    assert.equal(f.run.state, 'REVIEW_FIX');
    assert.equal(f.run.review.substantiveDecisions, 1);
    assert.equal(f.run.review.substantiveBlocks, 1);
    assert.equal(f.run.dodReceipt, undefined);
    assert.ok(f.verdictRef && existsSync(f.verdictRef));
    assert.equal((JSON.parse(readFileSync(f.verdictRef, 'utf8')) as { sha: string }).sha, 'sha-1');
    assert.equal(f.run.effort?.attempts.at(-1)?.outcome, 'success', 'the blocked attempt keeps its success; the R3 decision paid for the block');
    assert.equal(f.run.effort?.terminal, undefined, 'the episode is reopened for the repair');
    assert.equal(countedFailures(f.run.effort!).length, 0, 'no DoD failure was recorded');

    // The repair is the next attempt; the repaired candidate restarts loop 1 (pre-review cycle 1) before R3 runs again.
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.deepEqual(r.directive.skills, ['tdd'], 'the review-fix build directive names the skills');
    if (r.directive.kind === 'build') assert.equal(r.directive.effort, 'medium', 'the repair runs at the effort that succeeded');
    if (r.directive.kind === 'build') assert.equal(r.directive.attempt, 2);
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 1);
    r = runner.next(fx.goal(goal.id), card, (await runner.preReview(fx.goal(goal.id), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    f = await runner.formalReview(fx.goal(goal.id), card, r.run);
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

test('formal review guards: an advisory block proceeds, a hold blocks the command, a stale sha never passes, and a third decision is refused', async () => {
  const fx = makeFixture({ config: { formalReview: { command: ['fake-r3'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const r3: string[] = [];
    let r3Calls = 0;
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-guard.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-guard.ts b/src/t1-guard.ts\n+export const guard = 1;\n' },
      'fake-r2': { stdout: PASS },
      'fake-r3': () => {
        r3Calls += 1;
        const out = r3.shift() ?? PASS;
        if (out.includes('429')) fx.advance(90_000); // the review itself outlasts the hold it reports
        return { stdout: out };
      },
    });
    // What the ship path re-reads: the published advisory document, a consistent pass with the findings under advisory.
    const PUBLISHED: Verdict = { verdict: 'pass', reasons: [], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1', run_status: 'success' };
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged', 'merged', 'merged'], PUBLISHED), now: fx.now, runner: script });
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
    let f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'block-advisory');
    assert.equal(f.run.state, 'SHIP');
    assert.equal(f.run.review.substantiveDecisions, 1);
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'close', `advisory findings never become a silent merge bar: ${r.directive.narration}`);
    assert.equal(r.run.review.substantiveDecisions, 1, 'a ship-path re-read of the command verdict is not a second decision');
    const canonical = JSON.parse(readFileSync(path.join(fx.repo.mainRoot, '.review', 'T1-GUARD.json'), 'utf8')) as { verdict: string; axes: { spec: { verdict: string }; standards: { verdict: string } }; advisory: string[] };
    assert.equal(canonical.verdict, 'pass');
    assert.equal(canonical.axes.standards.verdict, 'pass', 'the published advisory document does not contradict itself');
    assert.equal(canonical.advisory.length, 1, 'the findings are retained under advisory');

    // Guards that refuse before any dispatch: a review pool that does not admit, and a checkout not at the pinned candidate.
    const spawnsBefore = r3Calls;
    fx.queue.setPoolLimit(fx.config.reviewPool, 1, 'test: one slot');
    const occupant = fx.queue.enqueue({ pool: fx.config.reviewPool, repository: 'other/repo', candidateDigest: 'other', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requester: 'other', deadline: addMs(fx.now(), 3_600_000), now: fx.now() });
    fx.queue.admit(fx.config.reviewPool, actorB, fx.now());
    const busy = CardRun.parse({ ...r.run, state: 'BUILD', mergeVerified: false, candidate: { sha: 'sha-1b', dirty: false, untracked: [], digest: 'sha-1b' }, dodReceipt: 'dod:1b', updatedAt: fx.now() });
    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, busy), /pool/);
    fx.queue.complete(occupant.request.key, 'other-verdict', fx.now());
    const gitRunner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: scriptedRunner({ 'git rev-parse': { stdout: 'elsewhere\n' }, 'git diff --name-only': { stdout: 'src/t1-guard.ts\n' }, 'git diff': { stdout: 'diff\n' }, 'fake-r3': () => { r3Calls += 1; return { stdout: PASS }; } }) });
    await assert.rejects(() => gitRunner.formalReview(fx.goal(goal.id), card, busy), /pinned candidate/);
    assert.equal(r3Calls, spawnsBefore, 'neither guard dispatched the reviewer');

    // A ship-path verdict that differs from the command's decision for the same sha is a new outcome and is recorded:
    // a block as the second decision leaves no allowance for the review a repair would need, so it stops.
    const closed = r.run;
    const DIFFERENT: Verdict = { verdict: 'block', reasons: ['[spec] 1 out of scope @ src/t1-guard.ts:9: touches a frozen path -> revert'], axes: { spec: { verdict: 'block', reasons: ['frozen'] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1c', run_status: 'success' };
    const differing = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, gateRequired: true }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['review-blocked'], DIFFERENT), now: fx.now, runner: script });
    const passedByCommand = fx.store.saveCardRun(CardRun.parse({ ...r.run, state: 'SHIP', mergeVerified: false, candidate: { sha: 'sha-1c', dirty: false, untracked: [], digest: 'sha-1c' }, dodReceipt: 'dod:1c', review: { ...r.run.review, substantiveDecisions: 1, substantiveBlocks: 0, invocations: [{ ...ledgerBase, invocationId: 'r3:cmd-1c', candidateDigest: 'sha-1c', requestedAt: fx.now(), outcome: 'pass' as const }], lastVerdict: { verdict: 'pass' as const, reasons: [], sha: 'sha-1c', run_status: 'success' as const } }, updatedAt: fx.now() }));
    const differed = differing.next(fx.goal(goal.id), card, passedByCommand);
    assert.equal(differed.directive.kind, 'stop', `a different ship outcome is a second decision: ${differed.directive.narration}`);
    assert.match(differed.directive.narration, /two-decision allowance/);
    assert.equal(differed.run.review.substantiveDecisions, 2);
    assert.equal(differed.run.review.substantiveBlocks, 1);
    assert.equal(differed.run.state, 'STOP');

    // (2) An active quota hold blocks the command itself, for R3 and for R2 alike.
    const held = fx.store.saveCardRun(CardRun.parse({ ...closed, state: 'BUILD', mergeVerified: false, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2', review: { ...closed.review, invocations: [...closed.review.invocations, { ...ledgerBase, invocationId: 'r3:hold', candidateDigest: 'sha-2', requestedAt: fx.now(), outcome: 'quota-hold', holdUntil: addMs(fx.now(), 60_000) }] }, updatedAt: fx.now() }));
    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, held), /hold/);
    const r2Runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, preReview: { ...fx.config.preReview, command: ['fake-r2'], reviewer: 'fake-r2' } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const heldR2 = { ...held, preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-2', requestedAt: fx.now(), durationMs: 0, outcome: 'quota-hold' as const, reasons: [], holdUntil: addMs(fx.now(), 60_000) }] } };
    await assert.rejects(() => r2Runner.preReview(fx.goal(goal.id), card, heldR2), /hold/);
    fx.advance(61_000);

    // (3) A verdict that names another sha is stale: never a pass, not a decision, and it never overwrites the candidate-bound verdict file.
    r = runner.next(fx.goal(goal.id), card, held);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    r3.push('{"verdict":"pass","reasons":[],"sha":"sha-1","axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.stale, true);
    assert.equal(f.classified.outcome, 'no-verdict');
    assert.equal(f.run.review.substantiveDecisions, 1);
    const verdictFile = JSON.parse(readFileSync(path.join(fx.repo.mainRoot, '.review', 'T1-GUARD.json'), 'utf8')) as { sha: string; verdict: string };
    assert.equal(verdictFile.sha, 'sha-1', 'the stale verdict must not be stamped onto the current candidate');
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'review', 'the single no-verdict retry');
    r3.push(PASS);
    f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(f.run.review.substantiveDecisions, 2);
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'close', r.directive.narration);

    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, f.run), /allowance/, 'no further run once the allowance is used, even with a current-candidate pass');
    // (4) The two-decision allowance is enforced before a third review is issued or run.
    const third = fx.store.saveCardRun(CardRun.parse({ ...r.run, state: 'BUILD', mergeVerified: false, candidate: { sha: 'sha-3', dirty: false, untracked: [], digest: 'sha-3' }, dodReceipt: 'dod:3', updatedAt: fx.now() }));
    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, third), /allowance/);
    r = runner.next(fx.goal(goal.id), card, third);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'review');
    const stoppedRun = CardRun.parse({ ...third, state: 'STOP', stop: makeStop('review', 'second substantive block', 'human ruling', { at: fx.now(), global: false }), review: { ...third.review, substantiveDecisions: 1, substantiveBlocks: 1 }, updatedAt: fx.now() });
    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, stoppedRun), /stopped/, 'a stopped card run never dispatches a review');
  } finally {
    fx.cleanup();
  }
});

test('review panel: perspectives run concurrently in R2 and R3, any block blocks the round, a pass needs every angle, a stale binding from one angle voids the panel, and one R3 panel is one decision', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2', '--focus', '{perspective}'], perspectives: ['bugs', 'security', 'compliance'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    let securityBlocks = true;
    let stopDuringReview: CardRun | undefined;
    const r3Out: string[] = ['{"verdict":"pass","reasons":[],"branch":"OTHER","axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n'];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-panel.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-panel.ts b/src/t1-panel.ts\n+export const panel = 1;\n' },
      'fake-r2 --focus security': () => ({ stdout: securityBlocks ? '{"verdict":"block","reasons":["[spec] 2 boundary @ src/t1-panel.ts:1: token logged -> redact"],"axes":{"spec":{"verdict":"block","reasons":["token"]},"standards":{"verdict":"pass","reasons":[]}}}\n' : PASS }),
      'fake-r2': { stdout: PASS },
      'fake-r3': () => {
        const out = r3Out.shift() ?? PASS;
        if (out === 'STOP' && stopDuringReview) {
          // another window stops the card while this review is still running
          fx.store.saveCardRun(CardRun.parse({ ...stopDuringReview, state: 'STOP', stop: makeStop('review', 'stopped meanwhile', 'human ruling', { at: fx.now(), global: false }), updatedAt: fx.now() }));
          return { stdout: PASS };
        }
        return { stdout: out };
      },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-PANEL', title: 'review panel' });
    const goal = fx.controller.createGoal({ text: 'implement T1-PANEL', source: 'card', ref: 'T1-PANEL', affectedSurfaces: [] }, { cards: ['T1-PANEL'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-PANEL'] } });
    const card = fx.card('T1-PANEL');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-PANEL'));
    let run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });

    // R2 round 1: three angles at once; the security angle blocks, so the round blocks with the reason tagged.
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    const round1 = await runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(round1.result.outcome, 'block');
    assert.equal(round1.run.state, 'BUILD');
    assert.equal(round1.round.perspectives?.length, 3);
    assert.ok(round1.result.reasons[0]?.endsWith('(security)'), round1.result.reasons.join(' | '));
    assert.equal(round1.round.perspectives?.filter((p) => p.outcome === 'pass').length, 2);

    // Fix; round 2 passes on every angle; the R3 panel starts.
    securityBlocks = false;
    r = runner.next(fx.goal(goal.id), card, round1.run);
    assert.equal(r.directive.kind, 'build');
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    const round2 = await runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(round2.result.outcome, 'pass');
    r = runner.next(fx.goal(goal.id), card, round2.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);

    // R3 (one exhaustive pass): a verdict binding another branch is stale (no decision consumed, one retry).
    let f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.stale, true);
    assert.equal(f.classified.outcome, 'no-verdict');
    assert.equal(f.run.review.substantiveDecisions, 0);
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(f.run.review.substantiveDecisions, 1);
    assert.ok(!f.run.review.invocations.some((i) => i.outcome === 'pending'), 'the reservation is replaced by the decision');
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').length, 2);

    // A STOP saved while the review runs is never overwritten by the review's own save: no decision, reservation released.
    const fresh = fx.store.saveCardRun(CardRun.parse({ ...r.run, state: 'BUILD', mergeVerified: false, candidate: { sha: 'sha-3', dirty: false, untracked: [], digest: 'sha-3' }, dodReceipt: 'dod:3', updatedAt: fx.now() }));
    r = runner.next(fx.goal(goal.id), card, fresh);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    r = runner.next(fx.goal(goal.id), card, (await runner.preReview(fx.goal(goal.id), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    stopDuringReview = r.run;
    r3Out.push('STOP');
    f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.run.state, 'STOP', 'a stop saved meanwhile survives the review');
    assert.equal(f.run.review.substantiveDecisions, 1, 'no decision is recorded on a stopped run');
    assert.ok(!f.run.review.invocations.some((i) => i.outcome === 'pending'));
    // The scope gate blocks an R2 round and refuses an R3 dispatch with no reviewer process at all.
    let spawns = 0;
    const scoped = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: scriptedRunner({ 'git diff --name-only': { stdout: 'src/t1-panel.ts\nsrc/outside.ts\n' }, 'git diff': { stdout: 'diff\n' }, 'fake-r2': () => { spawns += 1; return { stdout: PASS }; }, 'fake-r3': () => { spawns += 1; return { stdout: PASS }; } }) });
    const outside = fx.store.saveCardRun(CardRun.parse({ ...stopDuringReview, state: 'BUILD', stop: undefined, candidate: { sha: 'sha-4', dirty: false, untracked: [], digest: 'sha-4' }, dodReceipt: 'dod:4', updatedAt: fx.now() }));
    const gated = await scoped.preReview(fx.goal(goal.id), card, outside);
    assert.equal(gated.result.outcome, 'block');
    assert.ok(gated.result.reasons[0]?.includes('src/outside.ts'), gated.result.reasons.join(' | '));
    assert.equal(gated.round.perspectives?.[0]?.name, 'scope-gate');
    const outsideWithR2 = fx.store.saveCardRun(CardRun.parse({ ...outside, preReview: { rounds: [...outside.preReview.rounds, { round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-4', requestedAt: fx.now(), durationMs: 0, outcome: 'pass' as const, reasons: [] }] }, updatedAt: fx.now() }));
    await assert.rejects(() => scoped.formalReview(fx.goal(goal.id), card, outsideWithR2), /out of scope/);
    assert.equal(spawns, 0, 'the scope gate spends no tokens');

    // A pending reservation for the same candidate refuses a second dispatch.
    const pendingRun = fx.store.saveCardRun(CardRun.parse({ ...stopDuringReview, state: 'SHIP', stop: undefined, review: { ...stopDuringReview.review, invocations: [...stopDuringReview.review.invocations, { invocationId: 'r3:pending', candidateDigest: 'sha-3', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const }] }, updatedAt: fx.now() }));
    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, pendingRun), /pending/);
  } finally {
    fx.cleanup();
  }
});

test('R4: a merge conflict at ship returns the card to BUILD naming merge-conflicts, clears the DoD receipt and reopens the episode; the repaired candidate ships', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-CONF', title: 'a change that conflicts with the moved base' });
    const goal = fx.controller.createGoal({ text: 'implement T1-CONF', source: 'card', ref: 'T1-CONF', affectedSurfaces: [] }, { cards: ['T1-CONF'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-CONF'] } });
    const runner = fx.runner(new InjectedShipPath(['merge-failed', 'merged'], 'CONFLICT (content): Merge conflict in src/a.ts'));
    const card = fx.card('T1-CONF');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-CONF'));
    assert.equal(r.directive.kind, 'prepare');
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    assert.equal(run1.effort?.terminal, 'succeeded');

    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'build', `a conflict returns to BUILD, got ${r.directive.kind}: ${r.directive.narration}`);
    assert.equal(r.run.state, 'BUILD');
    if (r.directive.kind === 'build') {
      assert.deepEqual(r.directive.skills, ['merge-conflicts', 'tdd']);
      assert.match(r.directive.narration, /merge-conflicts/);
      assert.match(r.directive.narration, /new candidate/);
    }
    assert.equal(r.run.dodReceipt, undefined, 'a conflict clears the DoD receipt so the card cannot re-ship the old candidate');
    assert.equal(r.run.effort?.terminal, undefined, 'the effort episode is reopened, not counted as a failure');
    assert.equal(r.run.effort?.attempts.filter((a) => a.outcome === 'fail').length, 0);

    const run2 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    assert.equal(run2.effort?.terminal, 'succeeded');
    r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'close', `the repaired candidate ships: ${r.directive.narration}`);
  } finally {
    fx.cleanup();
  }
});

test('R4: a merge failure without a conflict is still a tool stop, and a red-missing return also reopens the episode', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-NOCONF', title: 'merge fails for another reason' });
    const goal = fx.controller.createGoal({ text: 'implement T1-NOCONF', source: 'card', ref: 'T1-NOCONF', affectedSurfaces: [] }, { cards: ['T1-NOCONF'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-NOCONF'] } });
    const runner = fx.runner(new InjectedShipPath(['merge-failed'], 'Pull request #7 is not mergeable: the base branch policy prohibits the merge'));
    const card = fx.card('T1-NOCONF');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-NOCONF'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop');
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'tool');

    writeCard(fx, { id: 'T1-RED', title: 'red receipt rejected by the ship path' });
    const goal2 = fx.controller.createGoal({ text: 'implement T1-RED', source: 'card', ref: 'T1-RED', affectedSurfaces: [] }, { cards: ['T1-RED'] });
    fx.controller.next(goal2.id);
    fx.controller.report({ goalId: goal2.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-RED'] } });
    const runner2 = fx.runner(new DryRunShipPath(['red-missing', 'merged']));
    const card2 = fx.card('T1-RED');
    let r2 = runner2.next(fx.goal(goal2.id), card2, fx.controller.ensureCardRun(fx.goal(goal2.id), 'T1-RED'));
    r2 = runner2.next(fx.goal(goal2.id), card2, r2.run);
    const run21 = runner2.recordAttempt(fx.goal(goal2.id), card2, r2.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r2 = runner2.next(fx.goal(goal2.id), card2, run21);
    assert.equal(r2.directive.kind, 'build');
    if (r2.directive.kind === 'build') assert.deepEqual(r2.directive.skills, ['tdd'], 'the repair build directive names the skills too');
    assert.equal(r2.run.effort?.terminal, undefined, 'red-missing reopens the episode the same way');
    assert.equal(r2.run.redReceipt, undefined, 'the rejected RED receipt is cleared, never reused as proof');
    if (r2.directive.kind === 'build') assert.equal(r2.directive.redReceipt, undefined);
    const run22 = runner2.recordAttempt(fx.goal(goal2.id), card2, r2.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:2', candidateSha: 'sha-2' });
    assert.equal(run22.effort?.terminal, 'succeeded');
  } finally {
    fx.cleanup();
  }
});

test('R3: a bugfix goal names diagnose on the build directive even without a card diagnosis', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-FIX', title: 'fix the crash when opening the settings page' });
    const goal = fx.controller.createGoal({ text: 'Fix crash when opening the settings page', source: 'bug-evidence', affectedSurfaces: [] }, { hasBugEvidence: true, cards: ['T1-FIX'] });
    assert.equal(goal.routing.kind, 'bugfix');
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-FIX'] } });
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const card = fx.card('T1-FIX');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-FIX'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.deepEqual(r.directive.skills, ['tdd', 'diagnose']);
  } finally {
    fx.cleanup();
  }
});

test('R3: the build directive names tdd, and diagnose as well on a card that carries a diagnosis', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-BUG', title: 'null adjuster crashes claim status', diagnosis: { root_cause: 'adjuster is optional but rendered as required', same_class: 'claim summary checked' } });
    const goal = fx.controller.createGoal({ text: 'implement T1-BUG', source: 'card', ref: 'T1-BUG', affectedSurfaces: [] }, { cards: ['T1-BUG'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-BUG'] } });
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const card = fx.card('T1-BUG');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-BUG'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.deepEqual(r.directive.skills, ['tdd', 'diagnose']);
  } finally {
    fx.cleanup();
  }
});

test('R3: an incident goal names diagnose on the build directive', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-INC', title: 'checkout 5xx spike after deploy' });
    const goal = fx.controller.createGoal({ text: 'Alert: 5xx spike on checkout service after deploy', source: 'incident', affectedSurfaces: [] }, { cards: ['T1-INC'] });
    assert.equal(goal.routing.kind, 'incident');
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-INC'] } });
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const card = fx.card('T1-INC');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-INC'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.deepEqual(r.directive.skills, ['tdd', 'diagnose']);
  } finally {
    fx.cleanup();
  }
});

test('R3: every repair path returns a build directive that names the skills: scope-blocked and budget-over (episode kept), CI code defect, and a pending pre-review block', () => {
  for (const outcome of ['scope-blocked', 'budget-over'] as const) {
    const fx = makeFixture();
    try {
      const id = outcome === 'scope-blocked' ? 'T1-SCOPE' : 'T1-BUDGET';
      writeCard(fx, { id, title: `ship rejected with ${outcome}` });
      const goal = fx.controller.createGoal({ text: `implement ${id}`, source: 'card', ref: id, affectedSurfaces: [] }, { cards: [id] });
      fx.controller.next(goal.id);
      fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [id] } });
      const runner = fx.runner(new DryRunShipPath([outcome]));
      const card = fx.card(id);
      let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), id));
      r = runner.next(fx.goal(goal.id), card, r.run);
      const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
      r = runner.next(fx.goal(goal.id), card, run1);
      assert.equal(r.directive.kind, 'build', `${outcome} returns to BUILD`);
      if (r.directive.kind === 'build') assert.deepEqual(r.directive.skills, ['tdd'], `${outcome} build directive names the skills`);
      assert.equal(r.run.dodReceipt, undefined);
      assert.equal(r.run.effort?.terminal, 'succeeded', `${outcome} is a code-side repair: the episode is not reopened by this card`);
    } finally {
      fx.cleanup();
    }
  }

  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-CIRED', title: 'CI finds a code defect' });
    const goal = fx.controller.createGoal({ text: 'implement T1-CIRED', source: 'card', ref: 'T1-CIRED', affectedSurfaces: [] }, { cards: ['T1-CIRED'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-CIRED'] } });
    const runner = fx.runner(new InjectedShipPath(['ci-red'], 'AssertionError: expected 1 to equal 2\n1 failing'));
    const card = fx.card('T1-CIRED');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-CIRED'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'build', `a CI code defect returns to BUILD: ${r.directive.narration}`);
    if (r.directive.kind === 'build') assert.deepEqual(r.directive.skills, ['tdd'], 'the CI code-defect build directive names the skills');
  } finally {
    fx.cleanup();
  }
});

test('R4: conflict detection needs an affirmative diagnostic: a card whose id contains the word conflict and a policy refusal still stop', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-CONFLICT', title: 'a card named after the failure mode' });
    const goal = fx.controller.createGoal({ text: 'implement T1-CONFLICT', source: 'card', ref: 'T1-CONFLICT', affectedSurfaces: [] }, { cards: ['T1-CONFLICT'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-CONFLICT'] } });
    const runner = fx.runner(new InjectedShipPath(['merge-failed'], 'gh: Pull request #7 is not mergeable: the base branch policy prohibits the merge; resume with task.ps1 -TaskId T1-CONFLICT'));
    const card = fx.card('T1-CONFLICT');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-CONFLICT'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', `no affirmative conflict diagnostic: ${r.directive.narration}`);
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'tool');
  } finally {
    fx.cleanup();
  }
});

test('R4: the pending conflict repair is persisted: a second next() before the repair still names merge-conflicts, and a recorded attempt clears it', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-PERSIST', title: 'conflict guidance survives a resumed worker' });
    const goal = fx.controller.createGoal({ text: 'implement T1-PERSIST', source: 'card', ref: 'T1-PERSIST', affectedSurfaces: [] }, { cards: ['T1-PERSIST'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-PERSIST'] } });
    const runner = fx.runner(new InjectedShipPath(['merge-failed', 'merged'], 'Automatic merge failed; fix conflicts and then commit the result.'));
    const card = fx.card('T1-PERSIST');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-PERSIST'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'build');
    assert.equal(r.run.pendingRepair?.kind, 'merge-conflict');
    const again = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(again.directive.kind, 'build');
    if (again.directive.kind === 'build') {
      assert.deepEqual(again.directive.skills, ['merge-conflicts', 'tdd'], 'a resumed worker still gets the skill');
      assert.match(again.directive.narration, /merge-conflict/);
    }
    const stillFailing = runner.recordAttempt(fx.goal(goal.id), card, again.run, { outcome: 'fail', cause: 'conflict resolution broke a test', progress: true });
    assert.equal(stillFailing.pendingRepair?.kind, 'merge-conflict', 'a failed attempt keeps the pending repair');
    const retry = runner.next(fx.goal(goal.id), card, stillFailing);
    const run2 = runner.recordAttempt(fx.goal(goal.id), card, retry.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    assert.equal(run2.pendingRepair, undefined, 'a successful attempt clears the pending repair');
    r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'close');
  } finally {
    fx.cleanup();
  }
});

test('R4: a conflict after the escalated success is repaired at the escalated effort; the review budget paid for the block', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-SPENT', title: 'two failures, then success, then a conflict' });
    const goal = fx.controller.createGoal({ text: 'implement T1-SPENT', source: 'card', ref: 'T1-SPENT', affectedSurfaces: [] }, { cards: ['T1-SPENT'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-SPENT'] } });
    const runner = fx.runner(new InjectedShipPath(['merge-failed'], 'CONFLICT (content): Merge conflict in src/a.ts'));
    const card = fx.card('T1-SPENT');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-SPENT'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    let run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause: 'type error in a.ts', progress: true });
    r = runner.next(fx.goal(goal.id), card, run);
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause: 'assertion in a.test.ts', progress: true });
    r = runner.next(fx.goal(goal.id), card, run);
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause: 'timeout in b.test.ts', progress: true });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.equal(r.directive.effort, 'high', 'the fourth attempt is the single escalation');
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:4', redReceipt: 'red:4', candidateSha: 'sha-4' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'build', `the conflict repair is admitted at the escalated effort: ${r.directive.narration}`);
    if (r.directive.kind === 'build') assert.equal(r.directive.effort, 'high');
    const run5 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:5', redReceipt: 'red:4', candidateSha: 'sha-5' });
    assert.equal(run5.effort?.terminal, 'succeeded');
  } finally {
    fx.cleanup();
  }
});

test('R4: a resume line quoting the git message is not a conflict; a real diagnostic on its own line is', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-QUOTE', title: 'policy refusal followed by a resume hint' });
    const goal = fx.controller.createGoal({ text: 'implement T1-QUOTE', source: 'card', ref: 'T1-QUOTE', affectedSurfaces: [] }, { cards: ['T1-QUOTE'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-QUOTE'] } });
    const runner = fx.runner(new InjectedShipPath(['merge-failed'], 'gh: Pull request #7 is not mergeable: the base branch policy prohibits the merge\n[SAGA-RESUME] pwsh scripts/task.ps1 -TaskId T1-QUOTE -Note "fix conflicts and then commit the result."'));
    const card = fx.card('T1-QUOTE');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-QUOTE'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', `quoted text never counts: ${r.directive.narration}`);
    assert.equal(hasConflictDiagnostic({ stdout: 'Auto-merging src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts\n', stderr: '' }), true);
    assert.equal(hasConflictDiagnostic({ stdout: 'X Pull request #7 is not mergeable: the merge commit cannot be cleanly created', stderr: '' }), true);
    assert.equal(hasConflictDiagnostic({ stdout: '[SAGA-RESUME] resume with: CONFLICT (content) was seen earlier', stderr: '' }), false);
    assert.equal(hasConflictDiagnostic({ stdout: 'CONFLICT (content): Merge conflict in src/resume.ts', stderr: '' }), true, 'a real diagnostic naming resume.ts still counts');
    assert.equal(hasConflictDiagnostic({ stdout: '"Pull request #7 is not mergeable: the merge commit cannot be cleanly created"', stderr: '' }), false, 'a quoted gh message never counts');
    assert.equal(hasConflictDiagnostic({ stdout: 'X Pull request #7 is not mergeable: the merge commit cannot be cleanly created', stderr: '' }), true, 'the gh failure glyph form counts');
  } finally {
    fx.cleanup();
  }
});

test('R4: a conflict after two failures with progress and a success is admitted as the escalated attempt, not refused', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-PROG', title: 'progress on every failure' });
    const goal = fx.controller.createGoal({ text: 'implement T1-PROG', source: 'card', ref: 'T1-PROG', affectedSurfaces: [] }, { cards: ['T1-PROG'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-PROG'] } });
    const runner = fx.runner(new InjectedShipPath(['merge-failed', 'merged'], 'CONFLICT (content): Merge conflict in src/a.ts'));
    const card = fx.card('T1-PROG');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-PROG'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    let run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause: 'type error in a.ts', progress: true });
    r = runner.next(fx.goal(goal.id), card, run);
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause: 'assertion in a.test.ts', progress: true });
    r = runner.next(fx.goal(goal.id), card, run);
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:3', redReceipt: 'red:3', candidateSha: 'sha-3' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'build', `the same justification BUILD grants admits the repair: ${r.directive.narration}`);
    const run4 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:4', redReceipt: 'red:3', candidateSha: 'sha-4' });
    assert.equal(run4.effort?.terminal, 'succeeded');
  } finally {
    fx.cleanup();
  }
});

test('R4: a conflict reported after the card deadline stops with reason time instead of reopening BUILD', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-LATE', title: 'ship finishes after the deadline' });
    const goal = fx.controller.createGoal({ text: 'implement T1-LATE', source: 'card', ref: 'T1-LATE', affectedSurfaces: [] }, { cards: ['T1-LATE'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-LATE'] } });
    const runner = fx.runner(new InjectedShipPath(['merge-failed'], 'CONFLICT (content): Merge conflict in src/a.ts'));
    const card = fx.card('T1-LATE');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-LATE'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const run1 = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    fx.advance(3 * 3600_000 + 1000);
    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'time');
  } finally {
    fx.cleanup();
  }
});

test('R4: a RED receipt the ship path rejected is never reloaded from the scaffold worktree; a fresh receipt is', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-SCAF', title: 'scaffold worktree keeps the old red file' });
    const goal = fx.controller.createGoal({ text: 'implement T1-SCAF', source: 'card', ref: 'T1-SCAF', affectedSurfaces: [] }, { cards: ['T1-SCAF'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-SCAF'] } });
    const worktreeRoot = path.join(fx.tmp, 'wt');
    const runner = fx.runner(new ScaffoldShipPath({ mainRoot: fx.tmp, worktreeRoot }));
    const card = fx.card('T1-SCAF');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-SCAF'));
    assert.equal(r.directive.kind, 'prepare');
    const redFile = path.join(worktreeRoot, 'T1-SCAF', '.review', 'T1-SCAF.red');
    mkdirSync(path.dirname(redFile), { recursive: true });
    writeFileSync(redFile, JSON.stringify({ taskId: 'T1-SCAF', sha: 'abc', dodExit: 0, phase: 'red' }));
    const rejected = fx.store.saveCardRun(CardRun.parse({ ...r.run, redReceipt: undefined, pendingRepair: { kind: 'red-missing', detail: 'RED rejected', at: fx.now(), rejectedReceipt: 'abc:0' }, updatedAt: fx.now() }));
    r = runner.next(fx.goal(goal.id), card, rejected);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.equal(r.directive.redReceipt, undefined, 'the rejected receipt is not reloaded');
    assert.equal(r.run.redReceipt, undefined);
    assert.match(r.directive.narration, /establish behavioural RED first/);
    const failed = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause: 'red still missing' });
    assert.equal(failed.pendingRepair?.rejectedReceipt, 'abc:0', 'a failed repair keeps the pending repair and the rejected receipt');
    r = runner.next(fx.goal(goal.id), card, failed);
    if (r.directive.kind === 'build') assert.equal(r.directive.redReceipt, undefined, 'still not reloaded after a failed repair');
    const noReplacement = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:x', candidateSha: 'sha-x' });
    assert.equal(noReplacement.pendingRepair?.rejectedReceipt, 'abc:0', 'a success without a replacement receipt keeps the rejected one out');
    r = runner.next(fx.goal(goal.id), card, noReplacement);
    if (r.directive.kind === 'build') assert.equal(r.directive.redReceipt, undefined, 'still not reloaded after a success without a replacement');
    writeFileSync(redFile, JSON.stringify({ taskId: 'T1-SCAF', sha: 'def', dodExit: 0, phase: 'red' }));
    r = runner.next(fx.goal(goal.id), card, r.run);
    if (r.directive.kind === 'build') assert.equal(r.directive.redReceipt, 'def:0', 'a fresh receipt is accepted');
  } finally {
    fx.cleanup();
  }
});

test('R3/acceptance 7: BUILD skills follow the finalized size: an explicit T0-bugfix card route names diagnose without a bugfix kind or a card diagnosis', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-SIZED', title: 'explicitly routed as a bugfix' });
    const goal = fx.controller.createGoal({ text: 'implement T1-SIZED', source: 'card', ref: 'T1-SIZED', explicitSize: 'T0-bugfix', affectedSurfaces: [] }, { cards: ['T1-SIZED'] });
    assert.equal(goal.routing.size, 'T0-bugfix');
    assert.equal(goal.routing.kind, 'card-execute');
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-SIZED'] } });
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const card = fx.card('T1-SIZED');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-SIZED'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.deepEqual(r.directive.skills, ['tdd', 'diagnose']);
  } finally {
    fx.cleanup();
  }
});

test('R11: an R3 command block on the escalated success reopens the episode and the repair runs at the escalated effort', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const BLOCK = '{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-up.ts:1: no RED -> add a failing test"],"axes":{"spec":{"verdict":"block","reasons":["tests"]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const script = scriptedRunner({ 'git diff --name-only': { stdout: 'src/t1-up.ts\n' }, 'git diff': { stdout: 'diff --git a/src/t1-up.ts b/src/t1-up.ts\n+export const up = 1;\n' }, 'fake-r2': { stdout: PASS }, 'fake-r3': { stdout: BLOCK } });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-UP', title: 'escalated success blocked by the R3 command' });
    const goal = fx.controller.createGoal({ text: 'implement T1-UP', source: 'card', ref: 'T1-UP', affectedSurfaces: [] }, { cards: ['T1-UP'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-UP'] } });
    const card = fx.card('T1-UP');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-UP'));
    let run = r.run;
    for (const cause of ['type error in up.ts', 'assertion in up.test.ts', 'timeout in up.test.ts']) {
      r = runner.next(fx.goal(goal.id), card, run);
      assert.equal(r.directive.kind, 'build');
      run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'fail', cause, progress: true });
    }
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'build');
    if (r.directive.kind === 'build') assert.equal(r.directive.effort, 'high', 'the fourth attempt is the single escalation');
    run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:4', redReceipt: 'red:4', candidateSha: 'sha-4' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    r = runner.next(fx.goal(goal.id), card, (await runner.preReview(fx.goal(goal.id), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    const f = await runner.formalReview(fx.goal(goal.id), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    assert.equal(f.run.state, 'REVIEW_FIX');
    assert.equal(f.run.effort?.attempts.at(-1)?.outcome, 'success', 'the escalated success is preserved');
    assert.equal(f.run.effort?.terminal, undefined, 'the episode is reopened');
    assert.equal(countedFailures(f.run.effort!).length, 3, 'the failure count is unchanged by the block');
    r = runner.next(fx.goal(goal.id), card, f.run);
    assert.equal(r.directive.kind, 'build', `the repair is admitted, not escalation-failed: ${r.directive.narration}`);
    if (r.directive.kind === 'build') {
      assert.equal(r.directive.effort, 'high', 'the repair runs at the escalated effort');
      assert.equal(r.directive.attempt, 5);
    }
    const repaired = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:5', redReceipt: 'red:4', candidateSha: 'sha-5' });
    assert.equal(repaired.effort?.terminal, 'succeeded');
    assert.equal(countedFailures(repaired.effort!).length, 3);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS: an R2 block records findings, the unchanged candidate is refused until every finding is disputed, the next prompt carries the notes, a re-raise reopens the finding, and a deadlock is named in the residual and in the stop', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2', '{instructions}'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'ship', shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[]}\n';
    const verdicts: string[] = [];
    const prompts: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-find.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-find.ts b/src/t1-find.ts\n+export const find = 1;\n' },
      'fake-r2': (args) => {
        prompts.push(args[0] ?? '');
        return { stdout: verdicts.shift() ?? PASS };
      },
    });
    const mk = (onExhausted: 'stop' | 'ship') =>
      new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, preReview: { ...fx.config.preReview, onExhausted } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-FIND', title: 'review findings' });
    const goal = fx.controller.createGoal({ text: 'implement T1-FIND', source: 'card', ref: 'T1-FIND', affectedSurfaces: [] }, { cards: ['T1-FIND'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-FIND'] } });
    const runner = mk('ship');
    const card = fx.card('T1-FIND');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-FIND'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review');

    // Round 1 blocks with two cited reasons: two findings with sequential ids, journaled with the round.
    verdicts.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-find.ts:1: no RED -> add a failing test first","[standards] 9 error handling @ src/t1-find.ts:9: swallowed error -> rethrow"]}\n');
    const round1 = await runner.preReview(g(), card, r.run);
    assert.equal(round1.result.outcome, 'block');
    assert.deepEqual(round1.run.findings.map((f) => [f.id, f.stage, f.round, f.disposition, f.candidateSha]), [['F1', 'pre', 1, 'open', 'sha-1'], ['F2', 'pre', 1, 'open', 'sha-1']]);
    const decided1 = fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED').at(-1)!;
    assert.deepEqual({ findings: decided1.data['findings'], reraised: decided1.data['reraised'] }, { findings: ['F1', 'F2'], reraised: [] });

    // The unchanged candidate: the command refuses while a finding of the block is open, and the gate hands back to BUILD naming the open ids and the two moves.
    await assert.rejects(() => runner.preReview(g(), card, round1.run), /F1, F2.*dispute/s);
    run = runner.recordAttempt(g(), card, round1.run, { outcome: 'success', dodReceipt: 'dod:1b', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    assert.match(r.directive.narration, /open finding.*F1, F2/is);
    assert.match(r.directive.narration, /aidlc review dispute T1-FIND/);
    assert.deepEqual(runner.listFindings(r.run).map((f) => f.id), ['F1', 'F2']);

    // Dispositions: dispute needs a note, a second dispute needs a re-raise in between, accept withdraws; each is journaled; a stopped run refuses.
    assert.throws(() => runner.disputeFinding(g(), card, r.run, 'F1', '  '), /note/);
    run = runner.disputeFinding(g(), card, r.run, 'F1', 'the RED is behavioural: tests/t1-find.test.ts fails on the assertion at the baseline');
    assert.equal(run.findings.find((f) => f.id === 'F1')?.disposition, 'disputed');
    assert.throws(() => runner.disputeFinding(g(), card, run, 'F1', 'again'), /already disputed/);
    await assert.rejects(() => runner.preReview(g(), card, run), /F2/);
    run = runner.acceptFinding(g(), card, run, 'F1');
    assert.equal(run.findings.find((f) => f.id === 'F1')?.disposition, 'open');
    run = runner.disputeFinding(g(), card, run, 'F1', 'the RED is behavioural: tests/t1-find.test.ts fails on the assertion at the baseline');
    run = runner.disputeFinding(g(), card, run, 'F2', 'the error is rethrown at src/t1-find.ts:12 after the receipt is written');
    assert.deepEqual(fx.events(goal.id).filter((e) => e.type === 'FINDING_DISPUTED').map((e) => e.data['finding']), ['F1', 'F1', 'F2']);
    assert.deepEqual(fx.events(goal.id).filter((e) => e.type === 'FINDING_ACCEPTED').map((e) => e.data['finding']), ['F1']);
    const stopped = { ...run, state: 'STOP' as const, stop: makeStop('review', 'x', 'y', { at: fx.now(), global: false }) };
    assert.throws(() => runner.disputeFinding(g(), card, stopped, 'F2', 'late'), /stopped/);
    assert.throws(() => runner.acceptFinding(g(), card, stopped, 'F2'), /stopped/);
    assert.deepEqual(runner.listFindings(stopped).map((f) => f.id), ['F1', 'F2'], 'the listing stays readable on a stopped run');

    // Every finding disputed: the gate issues round 2 on the unchanged candidate and the prompt carries the notes.
    run = runner.recordAttempt(g(), card, run, { outcome: 'success', dodReceipt: 'dod:1c', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 2);
    assert.match(r.directive.narration, /disputed/);
    verdicts.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-find.ts:1: the test asserts nothing about the gate (re:F1) -> assert the behaviour"]}\n');
    const round2 = await runner.preReview(g(), card, r.run);
    const prompt2 = prompts.at(-1)!;
    assert.ok(prompt2.includes('## Prior findings') && prompt2.includes('re:F<n>'), 'the prompt states the reference syntax');
    assert.ok(/- F1 .*disputed.*fails on the assertion at the baseline/.test(prompt2), `F1 with its note in the prompt: ${prompt2.slice(prompt2.indexOf('## Prior findings'), prompt2.indexOf('## Candidate'))}`);
    assert.ok(/- F2 .*disputed.*rethrown at src\/t1-find.ts:12/.test(prompt2), 'F2 with its note in the prompt');
    assert.equal(round2.result.outcome, 'block');
    const f1 = round2.run.findings.find((f) => f.id === 'F1')!;
    const f2 = round2.run.findings.find((f) => f.id === 'F2')!;
    assert.equal(f1.disposition, 'open', 'a re-raise returns the finding to open');
    assert.equal(f1.reraised.length, 1);
    assert.equal(f2.resolvedAt, fx.now(), 'a finding the round did not re-raise is resolved');
    assert.equal(round2.run.findings.length, 2, 'the re-raise is not a new finding');
    const decided2 = fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED').at(-1)!;
    assert.deepEqual({ findings: decided2.data['findings'], reraised: decided2.data['reraised'] }, { findings: [], reraised: ['F1'] });

    // Second dispute, third round re-raises again: a deadlock. Exhausted rounds hand the residual to R3 naming it; with onExhausted stop the stop detail names it.
    run = runner.disputeFinding(g(), card, round2.run, 'F1', 'the test observes the gate through the public interface; see tests/t1-find.test.ts:20');
    verdicts.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-find.ts:1: still no behavioural assertion (re:F1) -> assert the behaviour"]}\n');
    const round3 = await runner.preReview(g(), card, run);
    assert.equal(round3.result.outcome, 'block');
    const f1b = round3.run.findings.find((f) => f.id === 'F1')!;
    assert.equal(f1b.disputes.length, 3, 'the withdrawn dispute stays in the history');
    assert.deepEqual(f1b.reraised.map((x) => x.answeredDispute), [true, true], 'two rounds of mutual non-acceptance');
    assert.throws(() => runner.disputeFinding(g(), card, round3.run, 'F1', 'a third answer'), /human ruling/);
    run = runner.recordAttempt(g(), card, round3.run, { outcome: 'success', dodReceipt: 'dod:1d', redReceipt: 'red:1', candidateSha: 'sha-1' });
    const strict = mk('stop');
    r = strict.next(g(), card, run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    if (r.directive.kind === 'stop') assert.match(r.directive.stop.detail, /deadlock.*F1.*disputed twice.*re-raised twice/s);
    r = runner.next(g(), card, { ...run, state: 'SHIP', stop: undefined });
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    const exhausted = fx.events(goal.id).find((e) => e.type === 'PRE_REVIEW_DECIDED' && e.data['exhausted'] === true)!;
    assert.match(String(exhausted.data['deadlock']), /F1.*disputed twice.*re-raised twice/s);
    assert.deepEqual({ findings: exhausted.data['findings'], reraised: exhausted.data['reraised'], resolved: exhausted.data['resolved'], residual: exhausted.data['residualFindings'] }, { findings: [], reraised: [], resolved: [], residual: ['F1'] }, 'the exhausted event carries the same id lists as a decision event plus the residual');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS: an R3 block on the same candidate is re-decided only when every finding is disputed, the pre-review pass stays valid across cycles, the R3 prompt carries the findings, and the second block names the contested finding', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const r3: string[] = [];
    const prompts: string[] = [];
    let r2Runs = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-fr3.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-fr3.ts b/src/t1-fr3.ts\n+export const fr3 = 1;\n' },
      'fake-r2': () => {
        r2Runs += 1;
        return { stdout: PASS };
      },
      'fake-r3': (args) => {
        prompts.push(args[0] ?? '');
        return { stdout: r3.shift() ?? PASS };
      },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-FR3', title: 'formal review findings' });
    const goal = fx.controller.createGoal({ text: 'implement T1-FR3', source: 'card', ref: 'T1-FR3', affectedSurfaces: [] }, { cards: ['T1-FR3'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-FR3'] } });
    const card = fx.card('T1-FR3');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-FR3'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    r = runner.next(g(), card, (await runner.preReview(g(), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(r2Runs, 1);

    // Decision 1 blocks: two findings recorded on the formal stage; the unchanged candidate is refused while one is open.
    r3.push('{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-fr3.ts:3: exported helper the card does not ask for -> remove it","[standards] 9 error handling @ src/t1-fr3.ts:7: swallowed error -> rethrow"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-fr3.ts:3: exported helper the card does not ask for -> remove it"]},"standards":{"verdict":"block","reasons":["[standards] 9 error handling @ src/t1-fr3.ts:7: swallowed error -> rethrow"]}}}\n');
    let f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    assert.deepEqual(f.run.findings.map((x) => [x.id, x.stage, x.round]), [['F1', 'formal', 1], ['F2', 'formal', 1]]);
    const decided = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').at(-1)!;
    assert.deepEqual({ findings: decided.data['findings'], reraised: decided.data['reraised'] }, { findings: ['F1', 'F2'], reraised: [] });
    await assert.rejects(() => runner.formalReview(g(), card, f.run), /F1, F2.*dispute/s);
    // The guard is keyed by the candidate's own decision, not by the run's last verdict: a later verdict of another kind changes nothing.
    const staleVerdict = fx.store.saveCardRun(CardRun.parse({ ...f.run, review: { ...f.run.review, lastVerdict: { verdict: 'pass', reasons: [], sha: 'sha-other', run_status: 'success' } }, updatedAt: fx.now() }));
    await assert.rejects(() => runner.formalReview(g(), card, staleVerdict), /F1, F2.*dispute/s);
    assert.equal(runner.next(g(), card, staleVerdict).run.state, 'REVIEW_FIX', 'the block stays pending on the candidate it was recorded for');
    fx.store.saveCardRun(CardRun.parse({ ...f.run, updatedAt: fx.now() }));
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'build', 'the repair attempt opens');
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1b', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'build', `an undisputed block on the unchanged candidate stays pending as a repair: ${r.directive.narration}`);
    assert.equal(r.run.state, 'REVIEW_FIX');
    assert.match(r.directive.narration, /open finding.*F1, F2.*aidlc review dispute T1-FR3/is);

    // Every finding disputed: the block is no longer pending, the earlier R2 pass still counts, and decision 2 runs on the unchanged candidate with the notes.
    run = runner.disputeFinding(g(), card, r.run, 'F1', 'acceptance 1 names the helper; it is exercised by tests/t1-fr3.test.ts');
    run = runner.disputeFinding(g(), card, run, 'F2', 'the error is rethrown at line 12');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.match(r.directive.narration, /disputed/);
    if (r.directive.kind === 'review') assert.equal(r.directive.decision, 2);
    assert.equal(r2Runs, 1, 'no second pre-review round for a candidate that already holds its pass');
    r3.push('{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-fr3.ts:3: the helper is not in the acceptance list (re:F1) -> remove it"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-fr3.ts:3: the helper is not in the acceptance list (re:F1) -> remove it"]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    f = await runner.formalReview(g(), card, r.run);
    const prompt = prompts.at(-1)!;
    assert.ok(/- F1 .*disputed.*exercised by tests\/t1-fr3.test.ts/.test(prompt) && /- F2 .*disputed.*rethrown at line 12/.test(prompt), 'the R3 prompt carries both findings with their notes');
    assert.equal(f.run.state, 'STOP');
    assert.equal(f.run.stop?.reason, 'review');
    assert.match(f.run.stop?.detail ?? '', /second substantive block.*F1 re-raised after the author.s dispute/s);
    assert.equal(f.run.findings.find((x) => x.id === 'F1')?.reraised.length, 1);
    assert.equal(f.run.findings.find((x) => x.id === 'F2')?.resolvedAt, fx.now());
  } finally {
    fx.cleanup();
  }
});
