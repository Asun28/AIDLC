import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, driveCardToDone, candidateShaFor, goalForCards, InjectedShipPath, T0 } from './_harness.ts';
import { DryRunShipPath, ScaffoldShipPath, type ShipOutcomeClass, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { DEFAULT_LEASE_TTL_MS, FencedError, resourceKeys } from '../../src/coordination/lease.ts';
import { CardRun, addMs, type Verdict } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actorA, actorB } from './_harness.ts';
import fs, { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CardRunner, hasConflictDiagnostic } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import * as cli from '../../src/cli/main.ts';
import { countedFailures } from '../../src/core/effort.ts';
import { atomicWriteJson } from '../../src/state/store.ts';
import { acceptFinding, reviewRequestKey } from '../../src/core/review-policy.ts';
import { RECONCILE_GRACE_MS } from '../../src/core/types.ts';
import { resolveWorktreeRoot } from '../../src/config.ts';

/** Test-only: write a run record wholesale, past the store's stale-write check, to rewind a scenario to an earlier ledger state. */
function rewindCardRun(fx: ReturnType<typeof makeFixture>, run: CardRun): CardRun {
  const next = CardRun.parse({ ...run, updatedAt: fx.now() });
  atomicWriteJson(fx.store.cardFile(run.goalId, run.cardId), next);
  return next;
}

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
    if (r.directive.kind === 'prepare') assert.deepEqual(r.directive.lessons, { file: path.join(fx.repo.mainRoot, 'docs', 'LESSONS.md'), count: 0, recent: [] }, 'PREPARE carries the lessons context, empty while the file is missing');
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
    assert.throws(() => runner.markClosure(fx.goal(goal.id), card, run1, { metadata: true }), /CLOSE/, 'closure flags apply to a CLOSE run only; a merge not yet verified refuses them');
    assert.equal(run1.dodReceipt, 'dod:ok');
    assert.equal(run1.candidate?.sha, candidateShaFor('T1-HELLO'));

    r = runner.next(fx.goal(goal.id), card, run1);
    assert.equal(r.directive.kind, 'close');
    assert.equal(r.run.state, 'CLOSE');
    assert.equal(r.run.mergeVerified, true);
    if (r.directive.kind === 'close') assert.deepEqual(r.directive.missing, ['metadata', 'docSync', 'findings', 'evidence', 'cleanup', 'lessons']);

    setActorForTests(actorB);
    assert.throws(() => runner.markClosure(fx.goal(goal.id), card, r.run, { metadata: true }), (e: unknown) => e instanceof FencedError, 'a foreign session cannot assert closure');
    setActorForTests(actorA);
    const run2 = runner.markClosure(fx.goal(goal.id), card, r.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true });
    r = runner.next(fx.goal(goal.id), card, run2);
    assert.equal(r.directive.kind, 'close', 'the five mechanical steps leave the lesson step open');
    if (r.directive.kind === 'close') assert.deepEqual(r.directive.missing, ['lessons']);
    assert.ok(r.directive.narration.includes('--lesson "') && r.directive.narration.includes('--skip-lesson') && !r.directive.narration.includes('--lessons'), `the close hint names the real flags: ${r.directive.narration}`);
    assert.throws(() => runner.markClosure(fx.goal(goal.id), card, r.run, { lessons: true }), /--lesson|--skip-lesson/, 'the lesson step needs a disposition');
    assert.throws(() => runner.markClosure(fx.goal(goal.id), card, r.run, { lessons: true }, { lessonText: 'MAYBE do it (source: x)' }), /NEVER/, 'the frozen format is enforced');
    const lessonsFile = path.join(fx.repo.mainRoot, 'docs', 'LESSONS.md');
    const run3 = runner.markClosure(fx.goal(goal.id), card, r.run, { lessons: true }, { lessonText: 'NEVER ship without the lesson step (source: T1-HELLO review)' });
    assert.deepEqual(readFileSync(lessonsFile, 'utf8').split('\n').filter((l) => l.startsWith('- ')), [`- ${T0.slice(0, 10)} T1-HELLO: NEVER ship without the lesson step (source: T1-HELLO review)`], 'one valid line appended to a file created from the header');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'EVIDENCE_RETAINED').at(-1)?.data['lesson'], `- ${T0.slice(0, 10)} T1-HELLO: NEVER ship without the lesson step (source: T1-HELLO review)`, 'the line is journaled');
    const retainedEvents = fx.events(goal.id).filter((e) => e.type === 'EVIDENCE_RETAINED');
    assert.equal(retainedEvents.at(-2)?.data['lessonPending'], retainedEvents.at(-1)?.data['lesson'], 'the disposition is journaled before the file changes');
    const retried = runner.markClosure(fx.goal(goal.id), card, run3, { lessons: true }, { lessonText: 'NEVER ship without the lesson step (source: T1-HELLO review)' });
    assert.equal(retried.closure.lessons, true);
    assert.equal(readFileSync(lessonsFile, 'utf8').split('\n').filter((l) => l.startsWith('- ')).length, 1, 'a retry recognises the completed append and writes no second line');
    // A retry on another date reuses the pending line: a runner whose clock reads yesterday retries the same rule.
    const yesterday = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: () => addMs(T0, -86_400_000) });
    const rolled = yesterday.markClosure(fx.goal(goal.id), card, run3, { lessons: true }, { lessonText: 'NEVER ship without the lesson step (source: T1-HELLO review)' });
    assert.equal(rolled.closure.lessons, true);
    assert.equal(readFileSync(lessonsFile, 'utf8').split('\n').filter((l) => l.startsWith('- ')).length, 1, 'a retry on another date reuses the pending line instead of dating a new one');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'EVIDENCE_RETAINED').at(-1)?.data['lesson'], `- ${T0.slice(0, 10)} T1-HELLO: NEVER ship without the lesson step (source: T1-HELLO review)`, 'the recorded line keeps its original date');
    r = runner.next(fx.goal(goal.id), card, rolled);
    assert.equal(r.directive.kind, 'done');
    assert.equal(r.run.state, 'DONE');

    const d1 = fx.controller.next(goal.id);
    assert.equal(d1.kind, 'verify-arc');
    if (d1.kind === 'verify-arc') assert.deepEqual(d1.cards, ['T1-HELLO']);
    assert.equal(fx.goal(goal.id).state, 'VERIFY_ARC');

    // The goal-level CLOSE lists a card whose lesson step is open and names it; once recorded, the goal is DONE.
    const closedRun = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
    fx.store.saveCardRun({ ...closedRun, state: 'CLOSE', closure: { ...closedRun.closure, lessons: false } });
    const pending = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
    assert.equal(pending.directive.kind, 'close', pending.directive.narration);
    if (pending.directive.kind === 'close') assert.deepEqual(pending.directive.missing, ['T1-HELLO: closure.lessons']);
    assert.ok(pending.directive.narration.includes('lessons'), `the goal-level CLOSE narration names the lesson step: ${pending.directive.narration}`);
    rewindCardRun(fx, closedRun);
    const done = { directive: fx.controller.next(goal.id) };
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
    const stopped = rewindCardRun(fx, { ...run1, state: 'STOP', stop: makeStop('ownership', 'fenced: lease expired; renew or reconcile before mutating', 'revalidate ownership', { at: fx.now() }) });
    fx.advance(DEFAULT_LEASE_TTL_MS + 60_000);
    r = runner.next(fx.goal(goal.id), card, stopped);
    assert.notEqual(r.directive.kind, 'stop', `a stale same-owner ownership stop must be revalidated: ${r.directive.narration}`);
    assert.equal(r.run.stop, undefined);

    // A different session never renews or clears somebody else's lease.
    const foreign = rewindCardRun(fx, stopped);
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
    r = runner.next(fx.goal(goal.id), card, runner.markClosure(fx.goal(goal.id), card, r.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true }, { skipped: 'parked scenario: no rule learned' }));
    assert.equal(r.directive.kind, 'done');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'EVIDENCE_RETAINED').at(-1)?.data['lessonSkipped'], 'parked scenario: no rule learned', 'the skip reason is journaled and no file is written');
    assert.equal(existsSync(path.join(fx.repo.mainRoot, 'docs', 'LESSONS.md')), false);

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
        if (!out.includes('429')) return { stdout: out };
        fx.advance(90_000); // the review itself outlasts the hold it reports
        return { stderr: out, exitCode: 1 }; // a held reviewer reports the hold on stderr and exits non-zero
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

    // Exhaustion: with one round per cycle, the block leaves no round for a repair; the cleared DoD evidence of the
    // unchanged candidate is reused so the gate decides at once -> STOP/review, no repair attempt asked for.
    const strict = mk(1);
    verdicts.push('{"verdict":"block","reasons":["[standards] 9 error handling @ src/t1-gate.ts:2: swallowed error -> rethrow"]}\n');
    const round3 = await strict.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(round3.run.state, 'BUILD');
    assert.equal(round3.run.dodReceipt, undefined, 'the block clears the receipt');
    r = strict.next(fx.goal(goal.id), card, round3.run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'review');
    assert.equal(r.run.dodReceipt, 'dod:ok3', 'the receipt cleared by the block is the evidence the gate decided on');
    run = r.run;

    // ... unless the policy hands the residual findings to R3.
    const lenient = mk(1, 'ship');
    // The resumed state is persisted: next reads the stored run and never a caller's snapshot (T0-CARD-TAKEOVER), and a stop saved there wins over the caller's copy.
    r = lenient.next(fx.goal(goal.id), card, fx.store.saveCardRun(CardRun.parse({ ...run, state: 'SHIP', stop: undefined, updatedAt: fx.now() })));
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
        if (!out.includes('429')) return { stdout: out };
        fx.advance(90_000); // the review itself outlasts the hold it reports
        return { stderr: out, exitCode: 1 }; // a held reviewer reports the hold on stderr and exits non-zero
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
        if (!out.includes('429')) return { stdout: out };
        fx.advance(90_000); // the review itself outlasts the hold it reports
        return { stderr: out, exitCode: 1 }; // a held reviewer reports the hold on stderr and exits non-zero
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
    // The guards read the persisted run: the new candidate is saved, not handed over in a snapshot.
    const busy = fx.store.saveCardRun(CardRun.parse({ ...r.run, state: 'BUILD', mergeVerified: false, candidate: { sha: 'sha-1b', dirty: false, untracked: [], digest: 'sha-1b' }, dodReceipt: 'dod:1b', updatedAt: fx.now() }));
    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, busy), /pool/);
    fx.queue.complete(occupant.request.key, 'other-verdict', fx.now());
    const gitRunner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: scriptedRunner({ 'git rev-parse': { stdout: 'elsewhere\n' }, 'git status': { stdout: '' }, 'git diff --name-only': { stdout: 'src/t1-guard.ts\n' }, 'git diff': { stdout: 'diff\n' }, 'fake-r3': () => { r3Calls += 1; return { stdout: PASS }; } }) });
    await assert.rejects(() => gitRunner.formalReview(fx.goal(goal.id), card, busy), /pinned candidate/);
    assert.equal(r3Calls, spawnsBefore, 'neither guard dispatched the reviewer');

    // A ship-path verdict that differs from the command's decision for the same sha is a new outcome and is recorded:
    // a block as the second decision leaves no allowance for the review a repair would need, so it stops.
    const closed = r.run;
    const DIFFERENT: Verdict = { verdict: 'block', reasons: ['[spec] 1 out of scope @ src/t1-guard.ts:9: touches a frozen path -> revert'], axes: { spec: { verdict: 'block', reasons: ['frozen'] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1c', run_status: 'success' };
    const differing = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, gateRequired: true }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['review-blocked'], DIFFERENT), now: fx.now, runner: script });
    const passedByCommand = rewindCardRun(fx, { ...r.run, state: 'SHIP', mergeVerified: false, candidate: { sha: 'sha-1c', dirty: false, untracked: [], digest: 'sha-1c' }, dodReceipt: 'dod:1c', review: { ...r.run.review, substantiveDecisions: 1, substantiveBlocks: 0, invocations: [...r.run.review.invocations, { ...ledgerBase, invocationId: 'r3:cmd-1c', candidateDigest: 'sha-1c', requestedAt: fx.now(), outcome: 'pass' as const }], lastVerdict: { verdict: 'pass' as const, reasons: [], sha: 'sha-1c', run_status: 'success' as const } } });
    const differed = differing.next(fx.goal(goal.id), card, passedByCommand);
    assert.equal(differed.directive.kind, 'stop', `a different ship outcome is a second decision: ${differed.directive.narration}`);
    assert.match(differed.directive.narration, /two-decision allowance/);
    assert.equal(differed.run.review.substantiveDecisions, 2);
    assert.equal(differed.run.review.substantiveBlocks, 1);
    assert.equal(differed.run.state, 'STOP');

    // (2) An active quota hold blocks the command itself, for R3 and for R2 alike.
    const held = rewindCardRun(fx, { ...closed, state: 'BUILD', mergeVerified: false, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2', review: { ...closed.review, invocations: [...closed.review.invocations, { ...ledgerBase, invocationId: 'r3:hold', candidateDigest: 'sha-2', requestedAt: fx.now(), outcome: 'quota-hold', holdUntil: addMs(fx.now(), 60_000) }] } });
    await assert.rejects(() => runner.formalReview(fx.goal(goal.id), card, held), /hold/);
    const r2Runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, preReview: { ...fx.config.preReview, command: ['fake-r2'], reviewer: 'fake-r2' } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    // The R2 guard reads the persisted run: the hold is saved, not handed over in a snapshot.
    const heldR2 = fx.store.saveCardRun(CardRun.parse({ ...held, preReview: { ...held.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-2', candidateSha: 'sha-2', requestedAt: fx.now(), durationMs: 0, outcome: 'quota-hold' as const, reasons: [], holdUntil: addMs(fx.now(), 60_000) }] }, updatedAt: fx.now() }));
    await assert.rejects(() => r2Runner.preReview(fx.goal(goal.id), card, heldR2), /hold/);
    rewindCardRun(fx, held);
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
          // another window stops the card while this review is still running (from the record as persisted, reservation included)
          fx.store.saveCardRun(CardRun.parse({ ...(fx.store.getCardRun(stopDuringReview.goalId, stopDuringReview.cardId) ?? stopDuringReview), state: 'STOP', stop: makeStop('review', 'stopped meanwhile', 'human ruling', { at: fx.now(), global: false }), updatedAt: fx.now() }));
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
    const outside = rewindCardRun(fx, { ...stopDuringReview, state: 'BUILD', stop: undefined, candidate: { sha: 'sha-4', dirty: false, untracked: [], digest: 'sha-4' }, dodReceipt: 'dod:4' });
    const gated = await scoped.preReview(fx.goal(goal.id), card, outside);
    assert.equal(gated.result.outcome, 'block');
    assert.ok(gated.result.reasons[0]?.includes('src/outside.ts'), gated.result.reasons.join(' | '));
    assert.equal(gated.round.perspectives?.[0]?.name, 'scope-gate');
    const outsideWithR2 = fx.store.saveCardRun(CardRun.parse({ ...gated.run, preReview: { ...gated.run.preReview, rounds: [...gated.run.preReview.rounds, { round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-4', requestedAt: fx.now(), durationMs: 0, outcome: 'pass' as const, reasons: [] }] }, updatedAt: fx.now() }));
    await assert.rejects(() => scoped.formalReview(fx.goal(goal.id), card, outsideWithR2), /out of scope/);
    assert.equal(spawns, 0, 'the scope gate spends no tokens');

    // A pending reservation for the same candidate refuses a second dispatch.
    const pendingRun = rewindCardRun(fx, { ...stopDuringReview, state: 'SHIP', stop: undefined, review: { ...stopDuringReview.review, invocations: [...stopDuringReview.review.invocations, { invocationId: 'r3:pending', candidateDigest: 'sha-3', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const }] } });
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
    // T1-REVIEW-LOOP-GUARDS: a success without a replacement receipt is refused and records nothing.
    assert.throws(() => runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:x', candidateSha: 'sha-x' }), /RED receipt/);
    const noReplacement = fx.store.getCardRun(goal.id, 'T1-SCAF')!;
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

    // The unchanged candidate: the command refuses while a finding of the block is open, also when the caller holds a snapshot from before the block (the guard reads the persisted run), and the gate hands back to BUILD naming the open ids and the two moves.
    await assert.rejects(() => runner.preReview(g(), card, round1.run), /F1, F2.*dispute/s);
    await assert.rejects(() => runner.preReview(g(), card, r.run), /F1, F2.*dispute/s);
    // A candidate with uncommitted inputs is never reviewed: the review reads the committed sha.
    const dirty = rewindCardRun(fx, { ...round1.run, candidate: { sha: 'sha-1', dirty: true, untracked: ['scratch.txt'], digest: 'other-digest' } });
    await assert.rejects(() => runner.preReview(g(), card, dirty), /dirty|uncommitted/i);
    rewindCardRun(fx, round1.run);
    run = runner.recordAttempt(g(), card, round1.run, { outcome: 'success', dodReceipt: 'dod:1b', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    assert.match(r.directive.narration, /open finding.*F1, F2/is);
    assert.match(r.directive.narration, /aidlc review dispute T1-FIND/);
    assert.deepEqual(runner.listFindings(r.run).map((f) => f.id), ['F1', 'F2']);

    // Dispositions: dispute needs a note, a second dispute needs a re-raise in between; each is journaled; a stopped run refuses.
    assert.throws(() => runner.disputeFinding(g(), card, r.run, 'F1', '  '), /note/);
    run = runner.disputeFinding(g(), card, r.run, 'F1', 'the RED is behavioural: tests/t1-find.test.ts fails on the assertion at the baseline');
    assert.equal(run.findings.find((f) => f.id === 'F1')?.disposition, 'disputed');
    assert.throws(() => runner.disputeFinding(g(), card, run, 'F1', 'again'), /already disputed/);
    await assert.rejects(() => runner.preReview(g(), card, run), /F2/);
    // Dispositions act on the persisted run, never on the caller's snapshot: a STOP saved meanwhile refuses and is kept.
    const stopped = fx.store.saveCardRun(CardRun.parse({ ...run, state: 'STOP', stop: makeStop('review', 'x', 'y', { at: fx.now(), global: false }), updatedAt: fx.now() }));
    assert.throws(() => runner.disputeFinding(g(), card, run, 'F2', 'late'), /stopped/);
    assert.throws(() => runner.acceptFinding(g(), card, run, 'F1'), /stopped/);
    assert.equal(fx.store.getCardRun(goal.id, 'T1-FIND')?.state, 'STOP', 'a stale snapshot never overwrites the saved stop');
    assert.deepEqual(runner.listFindings(stopped).map((f) => f.id), ['F1', 'F2'], 'the listing stays readable on a stopped run');
    rewindCardRun(fx, run);
    // A disposition recorded by another window is kept: the change is applied to the persisted record under the card-run lock, never to this snapshot.
    const snapshot = run;
    fx.store.saveCardRun(CardRun.parse({ ...snapshot, findings: snapshot.findings.map((f) => (f.id === 'F1' ? { ...f, disputes: f.disputes.map((d) => ({ ...d, note: `${d.note} (edited by a second window)` })) } : f)), updatedAt: fx.now() }));
    run = runner.disputeFinding(g(), card, snapshot, 'F2', 'the error is rethrown at src/t1-find.ts:12 after the receipt is written');
    assert.match(run.findings.find((f) => f.id === 'F1')?.disputes.at(-1)?.note ?? '', /edited by a second window/, 'the other window\'s change to F1 survived the write of F2');
    const lock = `${fx.store.cardFile(goal.id, 'T1-FIND')}.lock`;
    writeFileSync(lock, `pid=0 at=${new Date().toISOString()}`, 'utf8');
    try {
      assert.throws(() => runner.acceptFinding(g(), card, run, 'F2'), /locked/, 'a held lock refuses the write instead of overwriting');
    } finally {
      rmSync(lock, { force: true });
    }
    assert.equal(run.findings.find((f) => f.id === 'F2')?.disposition, 'disputed');
    assert.deepEqual(fx.events(goal.id).filter((e) => e.type === 'FINDING_DISPUTED').map((e) => e.data['finding']), ['F1', 'F2']);

    // Every finding disputed: no further attempt is needed, the block's own DoD evidence is reused for the unchanged candidate, the gate issues round 2 and the prompt carries the notes.
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 2);
    assert.equal(r.run.dodReceipt, 'dod:1b', 'the receipt cleared by the block is restored for the unchanged, fully disputed candidate');
    assert.equal(r.run.blockedReceipt, undefined, 'the retained receipt is consumed on restoration');
    assert.match(r.directive.narration, /disputed/);
    // A round in flight parks the gate; the command refuses a second dispatch; an abandoned round (older than the timeout and the grace) is dropped.
    const pending = fx.store.updateCardRun(goal.id, 'T1-FIND', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: [...current!.preReview.rounds, { round: 2, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-1', candidateSha: 'sha-1', requestedAt: fx.now(), durationMs: 0, outcome: 'pending', reasons: [] }] } }));
    const parked = runner.next(g(), card, pending);
    assert.equal(parked.directive.kind, 'wait', parked.directive.narration);
    if (parked.directive.kind === 'wait') assert.match(parked.directive.on, /pre-review/);
    await assert.rejects(() => runner.preReview(g(), card, parked.run), /pending|in flight|running/i);
    fx.advance(1000 + 5 * 60_000 + 1);
    r = runner.next(g(), card, parked.run);
    assert.equal(r.directive.kind, 'pre-review', `an abandoned round is dropped: ${r.directive.narration}`);
    assert.ok(!r.run.preReview.rounds.some((x) => x.outcome === 'pending'), 'the abandoned round is gone');
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 2);
    verdicts.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-find.ts:1: the test asserts nothing about the gate (re:F1) -> assert the behaviour"]}\n');
    // The prompt is built from the record read under the card-run lock: a note changed after the caller's read reaches the reviewer.
    const stale2 = r.run;
    fx.store.saveCardRun(CardRun.parse({ ...stale2, findings: stale2.findings.map((f) => (f.id === 'F2' ? { ...f, disputes: f.disputes.map((d) => ({ ...d, note: `${d.note}; see also the receipt test` })), revision: f.revision + 1 } : f)), updatedAt: fx.now() }));
    const round2 = await runner.preReview(g(), card, stale2);
    const prompt2 = prompts.at(-1)!;
    assert.ok(prompt2.includes('see also the receipt test'), 'the note saved after the caller read the run is in the prompt');
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
    assert.equal(f1b.disputes.length, 2);
    assert.deepEqual(f1b.reraised.map((x) => x.answeredDispute), [0, 1], 'two distinct disputes answered: two rounds of mutual non-acceptance');
    assert.throws(() => runner.disputeFinding(g(), card, round3.run, 'F1', 'a third answer'), /human ruling/);
    // Exhausted rounds decide on the unchanged candidate without a further attempt: STOP names the deadlock, or the residual ships to R3.
    const strict = mk('stop');
    r = strict.next(g(), card, round3.run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    if (r.directive.kind === 'stop') assert.match(r.directive.stop.detail, /deadlock.*F1.*disputed twice.*re-raised twice/s);
    // The resumed state is persisted (a rewind past the strict gate's stop): the ship reads the record as persisted.
    r = runner.next(g(), card, rewindCardRun(fx, { ...round3.run, state: 'SHIP', stop: undefined }));
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
    // The second reason lives only on the standards axis: every cited reason of the document is a finding, root or axis.
    r3.push('{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-fr3.ts:3: exported helper the card does not ask for -> remove it"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-fr3.ts:3: exported helper the card does not ask for -> remove it"]},"standards":{"verdict":"block","reasons":["[standards] 9 error handling @ src/t1-fr3.ts:7: swallowed error -> rethrow"]}}}\n');
    let f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    assert.deepEqual(f.run.findings.map((x) => [x.id, x.stage, x.round]), [['F1', 'formal', 1], ['F2', 'formal', 1]]);
    assert.match(f.run.findings[1]!.reason, /swallowed error/, 'the axis-only reason is F2');
    const decided = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').at(-1)!;
    assert.deepEqual({ findings: decided.data['findings'], reraised: decided.data['reraised'] }, { findings: ['F1', 'F2'], reraised: [] });
    await assert.rejects(() => runner.formalReview(g(), card, f.run), /F1, F2.*dispute/s);
    // The guard is keyed by the candidate's own decision, not by the run's last verdict: a later verdict of another kind changes nothing.
    const staleVerdict = fx.store.saveCardRun(CardRun.parse({ ...f.run, review: { ...f.run.review, lastVerdict: { verdict: 'pass', reasons: [], sha: 'sha-other', run_status: 'success' } }, updatedAt: fx.now() }));
    await assert.rejects(() => runner.formalReview(g(), card, staleVerdict), /F1, F2.*dispute/s);
    // The candidate's last decision counts whoever recorded it: a differently named reviewer is refused the same way.
    const renamed = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, formalReview: { ...fx.config.formalReview, reviewer: 'other-r3' } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    await assert.rejects(() => renamed.formalReview(g(), card, staleVerdict), /F1, F2.*dispute/s);
    assert.equal(runner.next(g(), card, staleVerdict).run.state, 'REVIEW_FIX', 'the block stays pending on the candidate it was recorded for');
    rewindCardRun(fx, f.run);
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'build', `an undisputed block on the unchanged candidate is a pending repair: ${r.directive.narration}`);
    assert.equal(r.run.state, 'REVIEW_FIX');
    assert.match(r.directive.narration, /open finding.*F1, F2.*aidlc review dispute T1-FR3/is);

    // Every finding disputed, no further attempt: the block's DoD evidence is reused for the unchanged candidate, the earlier R2 pass still counts, and decision 2 runs with the notes.
    run = runner.disputeFinding(g(), card, r.run, 'F1', 'acceptance 1 names the helper; it is exercised by tests/t1-fr3.test.ts');
    run = runner.disputeFinding(g(), card, run, 'F2', 'the error is rethrown at line 12');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(r.run.dodReceipt, 'dod:1', 'the receipt cleared by the block is restored');
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

test('T1-REVIEW-FINDINGS: accept withdraws a dispute, the finding stays open and undisputable until a re-raise, and the repaired candidate resolves it', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const verdicts: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-acc.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-acc.ts b/src/t1-acc.ts\n+export const acc = 1;\n' },
      'fake-r2': () => ({ stdout: verdicts.shift() ?? '{"verdict":"pass","reasons":[]}\n' }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-ACC', title: 'accept a finding' });
    const goal = fx.controller.createGoal({ text: 'implement T1-ACC', source: 'card', ref: 'T1-ACC', affectedSurfaces: [] }, { cards: ['T1-ACC'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-ACC'] } });
    const card = fx.card('T1-ACC');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-ACC'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    verdicts.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-acc.ts:1: no RED -> add a failing test first"]}\n');
    run = (await runner.preReview(g(), card, r.run)).run;
    run = runner.disputeFinding(g(), card, run, 'F1', 'the RED is tests/t1-acc.test.ts');
    run = runner.acceptFinding(g(), card, run, 'F1');
    assert.equal(run.findings[0]?.disposition, 'open');
    assert.deepEqual(fx.events(goal.id).filter((e) => e.type === 'FINDING_ACCEPTED').map((e) => e.data['finding']), ['F1']);
    assert.throws(() => runner.disputeFinding(g(), card, run, 'F1', 'again'), /re-raise/, 'a withdrawn dispute is still the one dispute allowed before a re-raise');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'build', 'an open finding keeps the candidate in repair');
    assert.equal(r.run.dodReceipt, undefined, 'no receipt is restored while a finding is open');
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    run = (await runner.preReview(g(), card, r.run)).run;
    assert.equal(run.findings[0]?.resolvedAt, fx.now(), 'the repaired candidate resolves it');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS: a routed skip is not a decision on the findings: an open formal finding stays open while the ship proceeds', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const r3: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-skip.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-skip.ts b/src/t1-skip.ts\n+export const skip = 1;\n' },
      'fake-r2': () => ({ stdout: PASS }),
      'fake-r3': () => ({ stdout: r3.shift() ?? PASS }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-SKIP', title: 'routed skip' });
    const goal = fx.controller.createGoal({ text: 'implement T1-SKIP', source: 'card', ref: 'T1-SKIP', affectedSurfaces: [] }, { cards: ['T1-SKIP'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-SKIP'] } });
    const card = fx.card('T1-SKIP');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-SKIP'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    r = runner.next(g(), card, (await runner.preReview(g(), card, r.run)).run);
    r3.push('{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-skip.ts:3: helper the card does not ask for -> remove it"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-skip.ts:3: helper the card does not ask for -> remove it"]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    let f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.run.findings.length, 1);
    run = runner.disputeFinding(g(), card, f.run, 'F1', 'acceptance 1 names the helper');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'review');
    r3.push('{"verdict":"pass","reasons":[],"routed_skip":{"predicate":"AllPathsMatch","reason":"docs only","changed_paths":["src/t1-skip.ts"]},"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'routed-skip');
    assert.equal(f.run.findings[0]?.resolvedAt, undefined, 'a skip decides nothing about the finding');
    assert.equal(f.run.findings[0]?.disposition, 'disputed', 'the dispute stands');
    const decided = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').at(-1)!;
    assert.deepEqual({ findings: decided.data['findings'], reraised: decided.data['reraised'], resolved: decided.data['resolved'] }, { findings: [], reraised: [], resolved: [] });
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS acceptance 5: a finding that reached two non-acceptance rounds in R2 is named as a deadlock in the STOP detail of the R3 second block', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'ship', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const r2: string[] = [];
    const r3: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-dl.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-dl.ts b/src/t1-dl.ts\n+export const dl = 1;\n' },
      'fake-r2': () => ({ stdout: r2.shift() ?? PASS }),
      'fake-r3': () => ({ stdout: r3.shift() ?? PASS }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-DL', title: 'deadlock across stages' });
    const goal = fx.controller.createGoal({ text: 'implement T1-DL', source: 'card', ref: 'T1-DL', affectedSurfaces: [] }, { cards: ['T1-DL'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-DL'] } });
    const card = fx.card('T1-DL');
    const g = () => fx.goal(goal.id);
    const reraise = '{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-dl.ts:1: still no behavioural RED (re:F1) -> assert the seam"]}\n';
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-DL'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    // R2: block, dispute, re-raise, dispute, re-raise: two non-acceptance rounds, rounds exhausted, residual handed to R3.
    r = runner.next(g(), card, run);
    r2.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-dl.ts:1: no RED -> add a failing test first"]}\n');
    run = (await runner.preReview(g(), card, r.run)).run;
    run = runner.disputeFinding(g(), card, run, 'F1', 'the RED is tests/t1-dl.test.ts');
    r2.push(reraise);
    run = (await runner.preReview(g(), card, run)).run;
    run = runner.disputeFinding(g(), card, run, 'F1', 'the test observes the public seam');
    r2.push(reraise);
    run = (await runner.preReview(g(), card, run)).run;
    assert.deepEqual(run.findings[0]?.reraised.map((x) => x.answeredDispute), [0, 1]);
    await assert.rejects(() => runner.preReview(g(), card, run), /exhausted/, 'the rounds cap holds: no fourth round, whatever the dispositions');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'review', `the residual ships to R3: ${r.directive.narration}`);
    // R3 decision 1 blocks on the same finding; the author repairs (a deadlocked finding cannot be disputed again); decision 2 re-raises it -> STOP names the deadlock.
    r3.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-dl.ts:1: the RED is not behavioural (re:F1) -> assert the seam"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-dl.ts:1: the RED is not behavioural (re:F1) -> assert the seam"]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    let f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.run.state, 'REVIEW_FIX');
    assert.throws(() => runner.disputeFinding(g(), card, f.run, 'F1', 'a third answer'), /human ruling/);
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'build');
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', 'the repaired candidate restarts the R2 cycle');
    r = runner.next(g(), card, (await runner.preReview(g(), card, r.run)).run);
    assert.equal(r.directive.kind, 'review');
    r3.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-dl.ts:1: the RED still asserts nothing (re:F1) -> assert the seam"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-dl.ts:1: the RED still asserts nothing (re:F1) -> assert the seam"]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.run.state, 'STOP');
    assert.match(f.run.stop?.detail ?? '', /second substantive block.*deadlock: F1 .*disputed twice.*re-raised twice.*human ruling/s);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2: review r3 on exhausted R2 rounds journals the residual hand-off once, the gate does not add a second, and a cited advisory block guards the unchanged candidate like a blocking one', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'ship', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const r2: string[] = [];
    const r3: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-ho.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-ho.ts b/src/t1-ho.ts\n+export const ho = 1;\n' },
      'fake-r2': () => ({ stdout: r2.shift() ?? PASS }),
      'fake-r3': () => ({ stdout: r3.shift() ?? PASS }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-HO', title: 'hand-off once', tier: '1' });
    const goal = fx.controller.createGoal({ text: 'implement T1-HO', source: 'card', ref: 'T1-HO', affectedSurfaces: [] }, { cards: ['T1-HO'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-HO'] } });
    const card = fx.card('T1-HO');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HO'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    r2.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-ho.ts:1: no RED -> add a failing test first"]}\n');
    run = (await runner.preReview(g(), card, r.run)).run;
    // The single round is exhausted: the command dispatches R3 directly and records the hand-off itself.
    const handoffs = () => fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED' && e.data['exhausted'] === true);
    assert.equal(handoffs().length, 0);
    r3.push('{"verdict":"block","reasons":["[standards] 16 de-AI-slop @ src/t1-ho.ts:2: duplicated helper -> reuse the existing one"],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"block","reasons":["[standards] 16 de-AI-slop @ src/t1-ho.ts:2: duplicated helper -> reuse the existing one"]}}}\n');
    const f = await runner.formalReview(g(), card, { ...run, dodReceipt: 'dod:1' });
    assert.equal(handoffs().length, 1, 'the command journals the hand-off');
    assert.deepEqual(handoffs()[0]!.data['residualFindings'], ['F1']);
    assert.equal(f.classified.outcome, 'block-advisory', 'a standards-only block on a tier-1 card without a required gate is advisory');
    assert.deepEqual(f.run.findings.map((x) => [x.id, x.stage, x.advisory ?? false]), [['F1', 'pre', false], ['F2', 'formal', true]], 'the advisory block records its cited reason');
    await assert.rejects(() => runner.formalReview(g(), card, f.run), /F2.*dispute/s, 'an advisory block with an open finding guards the unchanged candidate too');
    r = runner.next(g(), card, f.run);
    assert.equal(handoffs().length, 1, 'the gate records no second hand-off for the same cycle and candidate');
    assert.equal(r.directive.kind, 'close', `the advisory block ships: ${r.directive.narration}`);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2: findRun resolves an existing card run without creating one, and asks for the goal when the card runs in several goals', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-FR', title: 'find run' });
    const runner = fx.runner();
    assert.equal(runner.findRun('T1-FR'), undefined, 'no run, nothing created');
    assert.equal(fx.store.listGoals().length, 0);
    const goalA = fx.controller.createGoal({ text: 'implement T1-FR', source: 'card', ref: 'T1-FR', affectedSurfaces: [] }, { cards: ['T1-FR'] });
    fx.controller.next(goalA.id);
    fx.controller.report({ goalId: goalA.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-FR'] } });
    assert.equal(runner.findRun('T1-FR'), undefined, 'a projected card without a run is not a run');
    const runA = fx.controller.ensureCardRun(fx.goal(goalA.id), 'T1-FR');
    assert.equal(runner.findRun('T1-FR')?.goalId, goalA.id);
    const goalB = fx.controller.createGoal({ text: 'implement T1-FR again', source: 'card', ref: 'T1-FR', affectedSurfaces: [] }, { cards: ['T1-FR'] });
    fx.controller.next(goalB.id);
    fx.controller.report({ goalId: goalB.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-FR'] } });
    fx.controller.ensureCardRun(fx.goal(goalB.id), 'T1-FR');
    assert.throws(() => runner.findRun('T1-FR'), /--goal/);
    assert.equal(runner.findRun('T1-FR', goalA.id)?.startedAt, runA.startedAt);
    assert.equal(runner.findRun('T1-FR', 'g-none'), undefined);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 acceptance 4: the DoD receipt restored for a disputed block is dropped by a later check failure, so the next directive is the repair, never a review', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const verdicts: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-drop.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-drop.ts b/src/t1-drop.ts\n+export const drop = 1;\n' },
      'fake-r2': () => ({ stdout: verdicts.shift() ?? '{"verdict":"pass","reasons":[]}\n' }),
    });
    // The ship reports a red CI run with code-defect evidence: the card returns to BUILD with its receipts cleared.
    const ship = new InjectedShipPath(['ci-red', 'merged'], 'FAIL tests/drop.test.ts\nAssertionError: expected 1 to equal 2');
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-DROP', title: 'drop the restored receipt' });
    const goal = fx.controller.createGoal({ text: 'implement T1-DROP', source: 'card', ref: 'T1-DROP', affectedSurfaces: [] }, { cards: ['T1-DROP'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-DROP'] } });
    const card = fx.card('T1-DROP');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-DROP'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    verdicts.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-drop.ts:1: no RED -> add a failing test first"]}\n');
    run = (await runner.preReview(g(), card, r.run)).run;
    run = runner.disputeFinding(g(), card, run, 'F1', 'the RED is tests/drop.test.ts');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', 'the receipt is restored for the fully disputed candidate');
    assert.equal(r.run.dodReceipt, 'dod:1');
    run = (await runner.preReview(g(), card, r.run)).run; // round 2 passes
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'build', `a red CI run with a code defect returns the card to BUILD: ${r.directive.narration}`);
    assert.equal(r.run.dodReceipt, undefined, 'the check failure clears the receipt');
    assert.equal(r.run.blockedReceipt, undefined, 'and drops the retained one');
    r = runner.next(g(), card, r.run);
    assert.equal(r.directive.kind, 'build', 'nothing restores the receipt after a check failure');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 acceptance 7: a write computed from a stale read never drops a round, a decision or a hand-off another window recorded: it is refused', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-stale.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-stale.ts b/src/t1-stale.ts\n+export const stale = 1;\n' },
      'fake-r2': () => ({ stdout: '{"verdict":"pass","reasons":[]}\n' }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-STALE', title: 'stale writer' });
    const goal = fx.controller.createGoal({ text: 'implement T1-STALE', source: 'card', ref: 'T1-STALE', affectedSurfaces: [] }, { cards: ['T1-STALE'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-STALE'] } });
    const card = fx.card('T1-STALE');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-STALE'));
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    // Another window reserves a round; this window still holds the earlier snapshot.
    const stale = r.run;
    fx.store.updateCardRun(goal.id, 'T1-STALE', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-1', candidateSha: 'sha-1', requestedAt: fx.now(), durationMs: 0, outcome: 'pending', reasons: [], reservationId: 'res-1' }] } }));
    // `next` reads the stored run and never the caller's snapshot (T0-CARD-TAKEOVER): the reservation another window
    // recorded drives the gate (a round in flight parks the card) and nothing of the stale snapshot is written back.
    const parked = runner.next(g(), card, stale);
    assert.equal(parked.directive.kind, 'wait', parked.directive.narration);
    assert.equal(fx.store.getCardRun(goal.id, 'T1-STALE')?.preReview.rounds.length, 1, 'the reservation survives');
    // A stale snapshot that lacks a decided round is ignored the same way, and a snapshot write elsewhere (a disposition) is refused.
    fx.store.updateCardRun(goal.id, 'T1-STALE', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-1', candidateSha: 'sha-1', requestedAt: fx.now(), durationMs: 5, outcome: 'pass', reasons: [], reservationId: 'res-1' }] } }));
    assert.throws(() => runner.disputeFinding(g(), card, stale, 'F1', 'x'), /F1|changed/);
    assert.equal(runner.next(g(), card, stale).directive.kind, 'close', 'the decided round on the stored run drives the gate, not the snapshot that lacks it');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-STALE')?.preReview.rounds[0]?.outcome, 'pass', 'the decided round survives');
    // Re-read, the same command proceeds.
    const fresh = fx.store.getCardRun(goal.id, 'T1-STALE')!;
    assert.equal(runner.next(g(), card, fresh).directive.kind, 'close');
  } finally {
    fx.cleanup();
  }
});

const R2_PASS = '{"verdict":"pass","reasons":[]}\n';
const R3_PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const r2Block = (file: string, line = 1, what = 'no RED -> add one') => `{"verdict":"block","reasons":["[spec] 6 tests @ ${file}:${line}: ${what}"]}\n`;
const r3Block = (file: string) => `{"verdict":"block","reasons":["[spec] 6 tests @ ${file}:1: no RED -> add one"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 6 tests @ ${file}:1: no RED -> add one"]},"standards":{"verdict":"pass","reasons":[]}}}\n`;

/** A card at SHIP with a recorded candidate, ready for its first pre-review round. */
function cardAtShip(fx: ReturnType<typeof makeFixture>, runner: CardRunner, id: string, sha = 'sha-1', allowPaths?: string[]) {
  writeCard(fx, { id, title: `${id} scenario`, allowPaths });
  const goal = fx.controller.createGoal({ text: `implement ${id}`, source: 'card', ref: id, affectedSurfaces: [] }, { cards: [id] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [id] } });
  const card = fx.card(id);
  const g = () => fx.goal(goal.id);
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), id));
  const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: sha });
  r = runner.next(g(), card, run);
  return { goal, card, g, run: r.run, directive: r.directive };
}

test('T1-REVIEW-FINDINGS-2 R3 decision 1: a single-angle panel names its angle on axis-only findings too', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false, perspectives: ['edge-cases'] } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-ax.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-ax.ts b/src/t1-ax.ts\n+export const ax = 1;\n' },
      'fake-r2': () => ({ stdout: '{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-ax.ts:1: no RED -> add one"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-ax.ts:1: no RED -> add one"]},"standards":{"verdict":"block","reasons":["[standards] 9 error handling @ src/t1-ax.ts:9: swallowed -> rethrow"]}}}\n' }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-AX');
    assert.equal(s.directive.kind, 'pre-review', s.directive.narration);
    const round = await runner.preReview(s.g(), s.card, s.run);
    assert.deepEqual(round.run.findings.map((f) => [f.id, f.perspective]), [['F1', 'edge-cases'], ['F2', 'edge-cases']]);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 R3 decision 1: the review checkout is probed for uncommitted changes right before dispatch, whatever the recorded candidate says', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let status = '';
    let dispatched = 0;
    const script = scriptedRunner({
      'git rev-parse': { stdout: 'sha-1\n' },
      'git status': () => ({ stdout: status }),
      'git diff --name-only': { stdout: 'src/t1-wt.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-wt.ts b/src/t1-wt.ts\n+export const wt = 1;\n' },
      'fake-r2': () => { dispatched += 1; return { stdout: R2_PASS }; },
      'fake-r3': () => { dispatched += 1; return { stdout: R3_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-WT', title: 'worktree probed' });
    const goal = fx.controller.createGoal({ text: 'implement T1-WT', source: 'card', ref: 'T1-WT', affectedSurfaces: [] }, { cards: ['T1-WT'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-WT'] } });
    const card = fx.card('T1-WT');
    const g = () => fx.goal(goal.id);
    const r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-WT'));
    // The recorded candidate is clean (recorded while the tree was clean); the tree changes afterwards.
    const run = fx.store.saveCardRun(CardRun.parse({ ...r.run, candidate: { sha: 'sha-1', dirty: false, untracked: [], digest: 'sha-1' }, dodReceipt: 'dod:1', redReceipt: 'red:1', updatedAt: fx.now() }));
    status = ' M src/t1-wt.ts\n';
    await assert.rejects(() => runner.preReview(g(), card, run), /uncommitted|untracked|dirty/i);
    status = '?? scratch.txt\n';
    await assert.rejects(() => runner.formalReview(g(), card, run), /uncommitted|untracked|dirty/i);
    assert.equal(dispatched, 0, 'no reviewer ran on a changed tree');
    status = '';
    assert.equal((await runner.preReview(g(), card, run)).result.outcome, 'pass');
    assert.equal(dispatched, 1);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 R3 decision 1: R2 and R3 re-check the same-candidate rule on the record locked at reservation; a refused R3 reservation frees its pool slot', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const r2: string[] = [];
    const r3: string[] = [];
    let dispatched = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-rc.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-rc.ts b/src/t1-rc.ts\n+export const rc = 1;\n' },
      'fake-r2': () => { dispatched += 1; return { stdout: r2.shift() ?? R2_PASS }; },
      'fake-r3': () => { dispatched += 1; return { stdout: r3.shift() ?? R3_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-RC');
    const { card, g, goal } = s;
    /** Between the command's first read and its reservation another window withdraws the dispute of `id`. */
    const withdrawnAfterFirstRead = async (id: string, body: () => Promise<unknown>) => {
      const realGet = fx.store.getCardRun.bind(fx.store);
      let reads = 0;
      fx.store.getCardRun = (goalId: string, cardId: string) => {
        const value = realGet(goalId, cardId);
        reads += 1;
        if (reads === 1 && value) fx.store.saveCardRun(CardRun.parse({ ...value, findings: acceptFinding(value.findings, id), updatedAt: fx.now() }));
        return value;
      };
      try {
        await body();
      } finally {
        fx.store.getCardRun = realGet;
      }
    };
    // R2: block, dispute, then a reservation on a record whose finding is open again.
    r2.push(r2Block('src/t1-rc.ts'));
    let run = (await runner.preReview(g(), card, s.run)).run;
    run = runner.disputeFinding(g(), card, run, 'F1', 'the RED is tests/t1-rc.test.ts');
    await withdrawnAfterFirstRead('F1', () => assert.rejects(() => runner.preReview(g(), card, run), /F1.*dispute/s));
    assert.equal(dispatched, 1, 'nothing was dispatched on the reopened finding');
    assert.ok(!fx.store.getCardRun(goal.id, 'T1-RC')?.preReview.rounds.some((x) => x.outcome === 'pending'), 'no reservation was left behind');
    assert.throws(() => runner.disputeFinding(g(), card, fx.store.getCardRun(goal.id, 'T1-RC')!, 'F1', 'again'), /re-raise/, 'the withdrawn dispute counts until a reviewer re-raises the finding');
    // R3: the same rule on the formal stage, with the pool slot released by the refusal.
    run = runner.recordAttempt(g(), card, runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-RC')!).run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    run = runner.next(g(), card, run).run;
    run = (await runner.preReview(g(), card, run)).run;
    run = runner.next(g(), card, run).run;
    r3.push(r3Block('src/t1-rc.ts'));
    run = (await runner.formalReview(g(), card, run)).run;
    assert.deepEqual(run.findings.filter((f) => f.stage === 'formal').map((f) => f.id), ['F2']);
    run = runner.disputeFinding(g(), card, run, 'F2', 'the RED is tests/t1-rc.test.ts');
    const before = dispatched;
    await withdrawnAfterFirstRead('F2', () => assert.rejects(() => runner.formalReview(g(), card, run), /F2.*dispute/s));
    assert.equal(dispatched, before, 'nothing was dispatched on the reopened finding');
    const persisted = fx.store.getCardRun(goal.id, 'T1-RC')!;
    assert.ok(!persisted.review.invocations.some((i) => i.outcome === 'pending'), 'no reservation was left behind');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the refused reservation released its pool slot');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 R3 decision 1: a failed attempt drops the retained receipt, a foreign session cannot reserve a round, and a run stopped meanwhile records no finding and keeps no reservation', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2', '{instructions}'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const verdicts: string[] = [];
    let onDispatch: (() => void) | undefined;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-fs.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-fs.ts b/src/t1-fs.ts\n+export const fs = 1;\n' },
      'fake-r2': () => { onDispatch?.(); return { stdout: verdicts.shift() ?? R2_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-FS');
    const { card, g, goal } = s;
    verdicts.push(r2Block('src/t1-fs.ts'));
    let run = (await runner.preReview(g(), card, s.run)).run;
    assert.ok(run.blockedReceipt, 'the block retains the receipt');
    let r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'build');
    const failed = runner.recordAttempt(g(), card, r.run, { outcome: 'fail', cause: 'dod: assertion failed' });
    assert.equal(failed.blockedReceipt, undefined, 'a failed attempt drops the retained receipt');
    run = runner.disputeFinding(g(), card, failed, 'F1', 'the RED is tests/t1-fs.test.ts');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'build', `nothing restores a receipt after a failed check: ${r.directive.narration}`);
    // A foreign session (another window with its own identity) cannot reserve a round on this card.
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-1' });
    setActorForTests(actorB);
    try {
      await assert.rejects(() => runner.preReview(g(), card, run), /fenced|owned by/i);
    } finally {
      setActorForTests(actorA);
    }
    assert.ok(!fx.store.getCardRun(goal.id, 'T1-FS')?.preReview.rounds.some((x) => x.outcome === 'pending'), 'the foreign attempt left no reservation');
    // A run stopped while the round is in flight: the result is evidence only, no finding, no reservation left.
    onDispatch = () => {
      const now = fx.store.getCardRun(goal.id, 'T1-FS')!;
      fx.store.saveCardRun(CardRun.parse({ ...now, state: 'STOP', stop: makeStop('review', 'x', 'y', { at: fx.now(), global: false }), updatedAt: fx.now() }));
    };
    verdicts.push(r2Block('src/t1-fs.ts', 9, 'swallowed -> rethrow'));
    const stopped = await runner.preReview(g(), card, run);
    assert.equal(stopped.run.state, 'STOP');
    assert.deepEqual(stopped.run.findings.map((f) => f.id), ['F1'], 'no finding is recorded on a stopped run');
    assert.ok(!stopped.run.preReview.rounds.some((x) => x.outcome === 'pending'), 'the reservation is released');
    const discarded = fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED').at(-1)!;
    assert.deepEqual({ decision: discarded.data['decision'], findings: discarded.data['findings'] }, { decision: 'discarded: card run stopped meanwhile', findings: [] });
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 R3 decision 1: a result for a superseded candidate is history only, an abandoned reservation cannot complete, and a long review renews the lease before the fence', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const verdicts: string[] = [];
    let onDispatch: (() => void) | undefined;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-sup.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-sup.ts b/src/t1-sup.ts\n+export const sup = 1;\n' },
      'fake-r2': () => { onDispatch?.(); return { stdout: verdicts.shift() ?? R2_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-SUP');
    const { card, g, goal } = s;
    // While sha-1 is reviewed, the author records sha-2 with its own DoD; sha-1's block is history and leaves sha-2 alone.
    onDispatch = () => {
      const now = fx.store.getCardRun(goal.id, 'T1-SUP')!;
      fx.store.saveCardRun(CardRun.parse({ ...now, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2', updatedAt: fx.now() }));
    };
    verdicts.push(r2Block('src/t1-sup.ts'));
    const superseded = await runner.preReview(g(), card, s.run);
    assert.equal(superseded.run.candidate?.sha, 'sha-2');
    assert.equal(superseded.run.dodReceipt, 'dod:2', 'the newer candidate keeps its receipt');
    assert.equal(superseded.run.state, 'SHIP', 'the newer candidate keeps its state');
    assert.equal(superseded.run.blockedReceipt, undefined, 'no receipt of another candidate is retained under this review');
    assert.equal(superseded.run.preReview.rounds.at(-1)?.candidateSha, 'sha-1', 'the round is history for sha-1');
    assert.equal(superseded.run.preReview.rounds.at(-1)?.outcome, 'block');
    // The gate in another window abandons the round while its result is still on the way: the late result cannot resurrect it.
    onDispatch = () => {
      fx.advance(1000 + RECONCILE_GRACE_MS + 1);
      runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-SUP')!);
    };
    verdicts.push(r2Block('src/t1-sup.ts', 9, 'swallowed -> rethrow'));
    const late = await runner.preReview(g(), card, fx.store.getCardRun(goal.id, 'T1-SUP')!);
    assert.ok(!late.run.preReview.rounds.some((x) => x.reservationId === late.round.reservationId), 'the abandoned reservation is not resurrected');
    assert.deepEqual(late.run.findings.map((f) => f.id), ['F1'], 'a late result of an abandoned round records no finding');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED' && String(e.data['decision'] ?? '').startsWith('abandoned')).length, 1);
    const lateEvent = fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED').at(-1)!;
    assert.deepEqual({ decision: lateEvent.data['decision'], findings: lateEvent.data['findings'] }, { decision: 'discarded: reservation abandoned meanwhile', findings: [] });
    // A long review: the lease expires during the round; the completion renews the owner's lease before the fence and commits.
    onDispatch = () => {
      fx.advance(DEFAULT_LEASE_TTL_MS + 60_000);
    };
    const r = runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-SUP')!);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    const slow = await runner.preReview(g(), card, r.run);
    assert.equal(slow.result.outcome, 'pass');
    assert.equal(slow.run.state, 'SHIP', `an owner's own expired lease is renewed, not fenced: ${slow.run.stop?.detail ?? ''}`);
    assert.equal(slow.run.preReview.rounds.at(-1)?.outcome, 'pass');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 R3 decision 1: the gate abandons a round only when it is still pending under the lock; a decided round is kept and drives the directive', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-gate.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-gate.ts b/src/t1-gate.ts\n+export const gate = 1;\n' },
      'fake-r2': () => ({ stdout: r2Block('src/t1-gate.ts') }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-GATE');
    const { card, g, goal } = s;
    const blocked = (await runner.preReview(g(), card, s.run)).run;
    const decided = blocked.preReview.rounds.at(-1)!;
    // A window that read the run at reservation time still holds the round as pending, no finding and the receipt intact.
    const stale = CardRun.parse({ ...blocked, state: 'SHIP', dodReceipt: 'dod:1', blockedReceipt: undefined, effort: s.run.effort, findings: [], preReview: { ...blocked.preReview, rounds: [{ ...decided, outcome: 'pending', reasons: [], durationMs: 0, verdictRef: undefined, receiptSha256: undefined, perspectives: undefined }] }, updatedAt: fx.now() });
    fx.advance(1000 + RECONCILE_GRACE_MS + 1);
    const r = runner.next(g(), card, stale);
    assert.equal(r.directive.kind, 'build', `the decided block drives the directive: ${r.directive.narration}`);
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED' && String(e.data['decision'] ?? '').startsWith('abandoned')).length, 0, 'nothing was abandoned');
    const persisted = fx.store.getCardRun(goal.id, 'T1-GATE')!;
    assert.equal(persisted.preReview.rounds.find((x) => x.reservationId === decided.reservationId)?.outcome, 'block', 'the decided round survives');
    assert.deepEqual(persisted.findings.map((f) => f.id), ['F1']);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 R3 decision 1: the R3 counters and the action are computed from the ledger locked at completion, never from a ledger read before it', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let onDispatch: (() => void) | undefined;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-cc.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-cc.ts b/src/t1-cc.ts\n+export const cc = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => { onDispatch?.(); return { stdout: r3Block('src/t1-cc.ts') }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const otherBlock = (sha: string) => ({ invocationId: `r3:other-${sha}`, candidateDigest: sha, candidateSha: sha, base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'block' as const, runStatus: 'success' as const, mergeBlocking: true });
    /** Another window's decision on the same candidate lands in the store now (computed from the current record). */
    const landOtherBlock = (goalId: string, cardId: string, sha: string) => {
      const now = fx.store.getCardRun(goalId, cardId)!;
      fx.store.saveCardRun(CardRun.parse({ ...now, review: { ...now.review, substantiveDecisions: now.review.substantiveDecisions + 1, substantiveBlocks: now.review.substantiveBlocks + 1, invocations: [...now.review.invocations, otherBlock(sha)] }, updatedAt: fx.now() }));
    };
    const consistent = (goalId: string, cardId: string) => {
      const persisted = fx.store.getCardRun(goalId, cardId)!;
      const blocks = persisted.review.invocations.filter((i) => i.outcome === 'block').length;
      assert.equal(persisted.review.substantiveDecisions, blocks, 'the counters count every decision the ledger holds');
      assert.equal(persisted.review.substantiveBlocks, blocks);
      assert.equal(persisted.state, blocks >= 2 ? 'STOP' : 'REVIEW_FIX', 'the action follows the counters of the locked ledger');
      return blocks;
    };
    // (1) The other decision lands while the review runs: the completion counts it and stops the card.
    const a = cardAtShip(fx, runner, 'T1-CC');
    let r = runner.next(a.g(), a.card, (await runner.preReview(a.g(), a.card, a.run)).run);
    assert.equal(r.directive.kind, 'review');
    onDispatch = () => landOtherBlock(a.goal.id, 'T1-CC', 'sha-1');
    const f = await runner.formalReview(a.g(), a.card, r.run);
    assert.equal(f.run.review.substantiveDecisions, 2, 'the counters count the concurrent decision');
    assert.equal(f.run.state, 'STOP', 'two blocks stop the card whichever completed first');
    assert.equal(consistent(a.goal.id, 'T1-CC'), 2);
    // (2) The other decision lands after the review returned, at the first lease read of the completion: it lands only
    // while no completion holds the card-run lock, and whatever the interleaving the persisted ledger stays consistent.
    onDispatch = undefined;
    const b = cardAtShip(fx, runner, 'T1-CC2', 'sha-1', ['src/t1-cc.ts']);
    r = runner.next(b.g(), b.card, (await runner.preReview(b.g(), b.card, b.run)).run);
    assert.equal(r.directive.kind, 'review');
    const realRead = fx.leases.read.bind(fx.leases);
    let armed = false;
    onDispatch = () => {
      armed = true;
    };
    fx.leases.read = (key: string) => {
      if (armed) {
        armed = false;
        if (!existsSync(`${fx.store.cardFile(b.goal.id, 'T1-CC2')}.lock`)) landOtherBlock(b.goal.id, 'T1-CC2', 'sha-1');
      }
      return realRead(key);
    };
    try {
      await runner.formalReview(b.g(), b.card, r.run);
    } finally {
      fx.leases.read = realRead;
    }
    consistent(b.goal.id, 'T1-CC2');
  } finally {
    fx.cleanup();
  }
});


test('R5: PREPARE carries the count and the most recent lessons from docs/LESSONS.md', () => {
  const fx = makeFixture();
  try {
    const file = path.join(fx.repo.mainRoot, 'docs', 'LESSONS.md');
    mkdirSync(path.dirname(file), { recursive: true });
    const lines = [1, 2, 3, 4, 5, 6].map((n) => `- 2026-09-1${n} T1-OLD: NOTE rule ${n} (source: test)`);
    writeFileSync(file, `# Lessons\n\n## Lessons\n${lines.join('\n')}\n`, 'utf8');
    writeCard(fx, { id: 'T1-READ', title: 'reads the lessons' });
    const goal = fx.controller.createGoal({ text: 'implement T1-READ', source: 'card', ref: 'T1-READ', affectedSurfaces: [] }, { cards: ['T1-READ'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-READ'] } });
    const runner = fx.runner();
    const r = runner.next(fx.goal(goal.id), fx.card('T1-READ'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-READ'));
    assert.equal(r.directive.kind, 'prepare');
    if (r.directive.kind === 'prepare') {
      assert.equal(r.directive.lessons?.file, file);
      assert.equal(r.directive.lessons?.count, 6);
      assert.deepEqual(r.directive.lessons?.recent, lines.slice(1), 'the five most recent lines');
    }
    assert.ok(r.directive.narration.includes('6 lessons so far'), r.directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('R6: closure.lessons is never set by a raw card patch, a stale goal snapshot cannot record a disposition, and overlapping closers are serialised by the lessons lock', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-GUARD', title: 'guarded closure' });
    const goal = fx.controller.createGoal({ text: 'implement T1-GUARD', source: 'card', ref: 'T1-GUARD', affectedSurfaces: [] }, { cards: ['T1-GUARD'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-GUARD'] } });
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const card = fx.card('T1-GUARD');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-GUARD'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const built = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-GUARD') });
    r = runner.next(fx.goal(goal.id), card, built);
    assert.equal(r.directive.kind, 'close');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-GUARD', data: { closure: { ...r.run.closure, lessons: true } } }), /raw patch/);
    const five = { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true };
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-GUARD', data: { state: 'DONE', closure: five } }), /raw patch/, 'a closure without the lesson key never reaches the legacy rule');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-GUARD', data: { state: 'DONE' } }), /raw patch/, 'DONE is derived, never patched');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-GUARD')?.state, 'CLOSE');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-GUARD')?.closure.lessons, false, 'the raw patch path never sets the predicate');
    for (const patch of [{ mergeVerified: true }, { state: 'CLOSE' }, { ownerGeneration: 9 }]) {
      assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'card-result', cardId: 'T1-GUARD', data: patch }), /raw patch/, `${JSON.stringify(patch)} is loop-owned evidence`);
    }
    const lessonsFile = path.join(fx.repo.mainRoot, 'docs', 'LESSONS.md');
    const recorded = runner.markClosure(fx.goal(goal.id), card, r.run, { lessons: true }, { lessonText: 'NOTE guard the closure write (source: R3)' });
    assert.equal(recorded.closure.lessons, true);
    assert.ok(readFileSync(lessonsFile, 'utf8').includes('NOTE guard the closure write (source: R3)'));
    // A card next that read the run before the disposition never overwrites it: the persisted closure is preserved on save.
    const after = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(fx.store.getCardRun(goal.id, 'T1-GUARD')?.closure.lessons, true, 'the stale snapshot of card next does not undo the recorded disposition');
    assert.equal(after.directive.kind, 'close');
    if (after.directive.kind === 'close') assert.deepEqual(after.directive.missing, ['metadata', 'docSync', 'findings', 'evidence', 'cleanup']);
    const stale = fx.goal(goal.id);
    assert.throws(() => runner.markClosure({ ...stale, generation: stale.generation + 1 }, card, recorded, { metadata: true }), /generation/);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'cancelled under the closer' } });
    assert.throws(() => runner.markClosure(stale, card, recorded, { metadata: true }), /terminal/, 'the persisted goal decides, not the caller snapshot');
  } finally {
    fx.cleanup();
  }
});

test('R6: a replacement session reclaims the card lease in CLOSE once the old lease expired and no delivery operation is unresolved, then records the disposition', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-TAKE', title: 'closure after the owner left' });
    const goal = fx.controller.createGoal({ text: 'implement T1-TAKE', source: 'card', ref: 'T1-TAKE', affectedSurfaces: [] }, { cards: ['T1-TAKE'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-TAKE'] } });
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const card = fx.card('T1-TAKE');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-TAKE'));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const built = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-TAKE') });
    r = runner.next(fx.goal(goal.id), card, built);
    assert.equal(r.directive.kind, 'close');
    const before = r.run.ownerGeneration;
    setActorForTests(actorB);
    const early = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(early.directive.kind, 'stop', 'a live lease of another session is not taken');
    assert.equal(early.run.stop?.reason, 'ownership');
    fx.advance(DEFAULT_LEASE_TTL_MS + 1000);
    const taken = runner.next(fx.goal(goal.id), card, early.run);
    assert.equal(taken.directive.kind, 'close', `the ownership stop is reconciled once the blocking lease expired: ${taken.directive.narration}`);
    assert.equal(taken.run.stop, undefined);
    assert.ok(taken.run.ownerGeneration !== undefined && before !== undefined && taken.run.ownerGeneration > before, 'the expired lease is taken over with a new generation');
    const closed = runner.markClosure(fx.goal(goal.id), card, taken.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true }, { skipped: 'the replacement session found no rule to record' });
    const done = runner.next(fx.goal(goal.id), card, closed);
    assert.equal(done.directive.kind, 'done');
    // A record persisted as DONE before the lessons predicate existed stays DONE: the predicate defaults to false, the state evidence keeps the closure complete.
    fx.store.saveCardRun({ ...done.run, closure: { ...done.run.closure, lessons: false } });
    const legacy = runner.next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, 'T1-TAKE')!);
    assert.equal(legacy.directive.kind, 'done', legacy.directive.narration);
    assert.equal(legacy.run.state, 'DONE');
    // The goal finishes too: goal-level closure never lists the lesson step of a run persisted as DONE.
    setActorForTests(actorA);
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    const finished = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:1'] } });
    assert.equal(finished.directive.kind, 'done', finished.directive.narration);
    assert.equal(fx.goal(goal.id).state, 'DONE');
  } finally {
    setActorForTests(actorA);
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-2 R2 cycle 1 round 2: a candidate recorded between the first read and the reservation refuses the round and the decision; nothing is reserved for the replaced candidate', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-mv.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-mv.ts b/src/t1-mv.ts\n+export const mv = 1;\n' },
      'fake-r2': () => { dispatched += 1; return { stdout: R2_PASS }; },
      'fake-r3': () => { dispatched += 1; return { stdout: R3_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-MV');
    const { card, g, goal } = s;
    /** Between the command's first read and its reservation the author records a new candidate in another window. */
    const replacedAfterFirstRead = async (sha: string, body: () => Promise<unknown>) => {
      const realGet = fx.store.getCardRun.bind(fx.store);
      let reads = 0;
      fx.store.getCardRun = (goalId: string, cardId: string) => {
        const value = realGet(goalId, cardId);
        reads += 1;
        if (reads === 1 && value) fx.store.saveCardRun(CardRun.parse({ ...value, candidate: { sha, dirty: false, untracked: [], digest: sha }, dodReceipt: `dod:${sha}`, updatedAt: fx.now() }));
        return value;
      };
      try {
        await body();
      } finally {
        fx.store.getCardRun = realGet;
      }
    };
    await replacedAfterFirstRead('sha-2', () => assert.rejects(() => runner.preReview(g(), card, s.run), /candidate.*changed|changed since/i));
    let persisted = fx.store.getCardRun(goal.id, 'T1-MV')!;
    assert.equal(persisted.candidate?.sha, 'sha-2');
    assert.equal(persisted.preReview.rounds.length, 0, 'no round is reserved for either candidate');
    assert.equal(dispatched, 0);
    // The round then runs on the current candidate and passes; the formal stage has the same guard.
    const passed = await runner.preReview(g(), card, persisted);
    assert.equal(passed.result.outcome, 'pass');
    assert.equal(passed.round.candidateSha, 'sha-2');
    const before = dispatched;
    await replacedAfterFirstRead('sha-3', () => assert.rejects(() => runner.formalReview(g(), card, passed.run), /candidate.*changed|changed since/i));
    persisted = fx.store.getCardRun(goal.id, 'T1-MV')!;
    assert.equal(persisted.candidate?.sha, 'sha-3');
    assert.equal(persisted.review.invocations.length, 0, 'no decision is reserved for either candidate');
    assert.equal(dispatched, before);
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the refused reservation released its pool slot');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-3 acceptance 11: one pre-review round and one formal review in flight per card, whatever the candidate; pending decisions count toward the allowance', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-one.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-one.ts b/src/t1-one.ts\n+export const one = 1;\n' },
      'fake-r2': () => { dispatched += 1; return { stdout: R2_PASS }; },
      'fake-r3': () => { dispatched += 1; return { stdout: R3_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-ONE');
    const { card, g, goal } = s;
    // Another window reserved a round for sha-1; this window holds sha-2 with its own receipt.
    fx.store.updateCardRun(goal.id, 'T1-ONE', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-1', candidateSha: 'sha-1', requestedAt: fx.now(), durationMs: 0, outcome: 'pending', reasons: [], reservationId: 'res-sha-1' }] } }));
    let run = fx.store.updateCardRun(goal.id, 'T1-ONE', (current) => ({ ...current!, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2' }));
    await assert.rejects(() => runner.preReview(g(), card, run), /in flight/i, 'a second round never runs while one is in flight for the card');
    assert.equal(dispatched, 0);
    assert.equal(runner.next(g(), card, run).directive.kind, 'wait', 'the gate waits on the round in flight');
    // The round in flight is abandoned; the next round of the cycle is numbered after it.
    fx.advance(1000 + RECONCILE_GRACE_MS + 1);
    let r = runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-ONE')!);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    const round = await runner.preReview(g(), card, r.run);
    assert.equal(round.result.outcome, 'pass');
    // A formal review reserved for sha-1 by another window refuses this window's decision on sha-2, and it counts toward the allowance.
    run = fx.store.updateCardRun(goal.id, 'T1-ONE', (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations, { invocationId: 'r3:sha-1', candidateDigest: 'sha-1', candidateSha: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const }] } }));
    const before = dispatched;
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'a second decision never runs while one is in flight for the card');
    assert.equal(dispatched, before);
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'no pool slot is held by the refused dispatch');
    run = fx.store.updateCardRun(goal.id, 'T1-ONE', (current) => ({ ...current!, review: { ...current!.review, substantiveDecisions: 1, invocations: current!.review.invocations.map((i) => (i.invocationId === 'r3:sha-1' ? { ...i, outcome: 'pass' as const, runStatus: 'success' as const } : i)) } }));
    run = fx.store.updateCardRun(goal.id, 'T1-ONE', (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations, { invocationId: 'r3:sha-1b', candidateDigest: 'sha-1b', candidateSha: 'sha-1b', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const }] } }));
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight|allowance/i, 'one decision used and one pending leave no allowance for a third dispatch');
    assert.equal(dispatched, before);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-3 acceptance 12: a failed attempt clears the active receipt, the checkout is re-probed at dispatch, and a pass after a block on the same candidate is not a pending block', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const r2: string[] = [];
    const r3: string[] = [];
    let onDispatch: (() => void) | undefined;
    let statuses: string[] = [];
    let dispatched = 0;
    const script = scriptedRunner({
      'git rev-parse': { stdout: 'sha-1\n' },
      'git status': () => ({ stdout: statuses.shift() ?? '' }),
      'git diff --name-only': { stdout: 'src/t1-tw.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-tw.ts b/src/t1-tw.ts\n+export const tw = 1;\n' },
      'fake-r2': () => { dispatched += 1; return { stdout: r2.shift() ?? R2_PASS }; },
      'fake-r3': () => {
        dispatched += 1;
        onDispatch?.();
        const out = r3.shift() ?? R3_PASS;
        return out.includes('429') ? { stderr: out, exitCode: 1 } : { stdout: out }; // a held reviewer reports the hold on stderr
      },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-TW');
    const { card, g, goal } = s;
    // (1) A block, a dispute, the restored receipt: a failed check after that clears the active receipt as well as the retained one.
    r2.push(r2Block('src/t1-tw.ts'));
    let run = (await runner.preReview(g(), card, s.run)).run;
    run = runner.disputeFinding(g(), card, run, 'F1', 'the RED is tests/t1-tw.test.ts');
    let r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    assert.equal(r.run.dodReceipt, 'dod:1', 'the receipt the block cleared is restored for the disputed, unchanged candidate');
    const failed = runner.recordAttempt(g(), card, r.run, { outcome: 'fail', cause: 'dod: assertion failed' });
    assert.equal(failed.dodReceipt, undefined, 'a failed check leaves no active receipt');
    assert.equal(runner.next(g(), card, failed).directive.kind, 'build');
    run = runner.recordAttempt(g(), card, fx.store.getCardRun(goal.id, 'T1-TW')!, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-1' });
    const dispatchedBefore = dispatched;
    // (2) The checkout changes between the first probe and the dispatch: the round is refused and nothing is reserved.
    statuses = ['', ' M src/t1-tw.ts\n'];
    await assert.rejects(() => runner.preReview(g(), card, run), /uncommitted|untracked|dirty/i);
    assert.equal(dispatched, dispatchedBefore);
    assert.ok(!fx.store.getCardRun(goal.id, 'T1-TW')?.preReview.rounds.some((x) => x.outcome === 'pending'), 'no round is reserved');
    statuses = [];
    run = (await runner.preReview(g(), card, fx.store.getCardRun(goal.id, 'T1-TW')!)).run;
    assert.equal(run.preReview.rounds.at(-1)?.outcome, 'pass');
    statuses = ['', '?? scratch.txt\n'];
    await assert.rejects(() => runner.formalReview(g(), card, run), /uncommitted|untracked|dirty/i);
    assert.equal(fx.store.getCardRun(goal.id, 'T1-TW')?.review.invocations.length, 0, 'no decision is reserved');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the refused dispatch released its pool slot');
    statuses = [];
    // (3) Block, dispute, withdrawal during decision two, pass: the finding stays open (revision moved), the pass is the candidate's latest decision.
    r3.push(r3Block('src/t1-tw.ts'));
    run = (await runner.formalReview(g(), card, run)).run;
    assert.deepEqual(run.findings.filter((f) => f.stage === 'formal').map((f) => f.id), ['F2']);
    run = runner.disputeFinding(g(), card, run, 'F2', 'the RED is tests/t1-tw.test.ts');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    onDispatch = () => {
      runner.acceptFinding(g(), card, fx.store.getCardRun(goal.id, 'T1-TW')!, 'F2');
    };
    const passed = await runner.formalReview(g(), card, r.run);
    assert.equal(passed.classified.outcome, 'pass');
    const f2 = passed.run.findings.find((f) => f.id === 'F2')!;
    assert.equal(f2.disposition, 'open', 'the withdrawal during the decision is kept');
    assert.equal(f2.resolvedAt, undefined, 'a finding changed after dispatch is not resolved by the round');
    r = runner.next(g(), card, passed.run);
    assert.equal(r.directive.kind, 'close', `the latest decision on the candidate is a pass, not a pending block: ${r.directive.narration}`);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-3 R3 decision 1: a stop persisted before the gate reloads the run is honoured before any further write or external dispatch', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'ship', shell: false } } });
  try {
    const ship = new DryRunShipPath(['merged']);
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: scriptedRunner({ 'git diff --name-only': { stdout: 'src/t1-rv.ts\n' }, 'git diff': { stdout: 'diff\n' }, 'fake-r2': { stdout: R2_PASS } }) });
    const s = cardAtShip(fx, runner, 'T1-RV');
    const { card, g, goal } = s;
    // A round reserved by another window expires; this window still holds the snapshot with the reservation and no stop.
    const stale = fx.store.updateCardRun(goal.id, 'T1-RV', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-1', candidateSha: 'sha-1', requestedAt: fx.now(), durationMs: 0, outcome: 'pending', reasons: [], reservationId: 'res-rv' }] } }));
    fx.advance(1000 + RECONCILE_GRACE_MS + 1);
    // Another window stops the card before the gate reloads the record to drop the abandoned round.
    fx.store.updateCardRun(goal.id, 'T1-RV', (current) => ({ ...current!, state: 'STOP', stop: makeStop('review', 'stopped by the adjudicator', 'human ruling', { at: fx.now(), global: false }) }));
    const r = runner.next(g(), card, stale);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(ship.requests.length, 0, 'nothing is dispatched for a run stopped before the gate reloaded it');
    const persisted = fx.store.getCardRun(goal.id, 'T1-RV')!;
    assert.equal(persisted.state, 'STOP', 'the reloaded stop is never written over');
    assert.equal(persisted.stop?.detail, 'stopped by the adjudicator');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-3 R3 decision 1: a formal result whose commit lost the card-run lock is committed later from its retained verdict under the same invocation, without a second dispatch', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    let onDispatch: (() => void) | undefined;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-lk.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-lk.ts b/src/t1-lk.ts\n+export const lk = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => { dispatched += 1; onDispatch?.(); return { stdout: r3Block('src/t1-lk.ts') }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-LK');
    const { card, g, goal } = s;
    let r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    // A live writer holds the card-run lock while the result is committed: the commit refuses, the reservation stays.
    const lock = `${fx.store.cardFile(goal.id, 'T1-LK')}.lock`;
    onDispatch = () => writeFileSync(lock, `pid=${process.pid} at=now nonce=held`, 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, r.run), /locked/i);
    rmSync(lock, { force: true });
    let persisted = fx.store.getCardRun(goal.id, 'T1-LK')!;
    const reservation = persisted.review.invocations.find((i) => i.outcome === 'pending');
    assert.ok(reservation, 'the reservation is kept for the retained result');
    assert.equal(dispatched, 1);
    // The command run again commits the retained verdict under the same invocation: no reviewer runs, the decision is recorded once.
    onDispatch = undefined;
    const f = await runner.formalReview(g(), card, persisted);
    assert.equal(dispatched, 1, 'no second dispatch');
    assert.equal(f.classified.outcome, 'block-defect');
    persisted = fx.store.getCardRun(goal.id, 'T1-LK')!;
    assert.deepEqual(persisted.review.invocations.map((i) => [i.invocationId, i.outcome]), [[reservation!.invocationId, 'block']]);
    assert.equal(persisted.review.substantiveDecisions, 1);
    assert.equal(persisted.state, 'REVIEW_FIX');
    assert.deepEqual(persisted.findings.map((x) => x.id), ['F1']);
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-3 R2 cycle 1 round 1: a formal dispatch that fails never leaves its reservation in flight, even when the release itself is refused; the next review r3 continues without a stuck reservation', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    let onDispatch: (() => void) | undefined;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-th.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-th.ts b/src/t1-th.ts\n+export const th = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => { dispatched += 1; onDispatch?.(); return { stdout: R3_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-TH');
    const { card, g, goal } = s;
    const r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    const lock = `${fx.store.cardFile(goal.id, 'T1-TH')}.lock`;
    const held = () => writeFileSync(lock, `pid=${process.pid} at=now nonce=held`, 'utf8');
    // (1) The reviewer process cannot be spawned (a no-verdict receipt) and a live writer holds the lock at commit time: the
    // result is retained; the next command commits it as the no-verdict it is, without a dispatch, and the retry runs after.
    onDispatch = () => {
      held();
      throw new Error('spawn ENOENT');
    };
    await assert.rejects(() => runner.formalReview(g(), card, r.run), /locked/i);
    rmSync(lock, { force: true });
    onDispatch = undefined;
    const noVerdict = await runner.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-TH')!);
    assert.equal(noVerdict.classified.outcome, 'no-verdict');
    assert.equal(dispatched, 1, 'the retained receipt is committed, not re-run');
    let persisted = fx.store.getCardRun(goal.id, 'T1-TH')!;
    assert.deepEqual(persisted.review.invocations.map((i) => i.outcome), ['no-verdict']);
    assert.equal(persisted.review.noVerdictRetriesUsed, 1);
    // (2) The dispatch fails before any receipt exists (an empty review command) and the lock is held again when the failure
    // is retained: the reservation cannot be released at once; the next command releases it from the retained failure.
    const empty = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, formalReview: { ...fx.config.formalReview, command: [''] } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const realWrite = fs.writeFileSync;
    (fs as unknown as Record<string, unknown>)['writeFileSync'] = ((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file).endsWith('.failed.json')) held();
      return (realWrite as unknown as (...a: unknown[]) => void)(file, ...rest);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();
    try {
      await assert.rejects(() => empty.formalReview(g(), card, persisted), /review command is empty/);
    } finally {
      (fs as unknown as Record<string, unknown>)['writeFileSync'] = realWrite;
      syncBuiltinESMExports();
      rmSync(lock, { force: true });
    }
    assert.equal(dispatched, 1, 'nothing ran');
    persisted = fx.store.getCardRun(goal.id, 'T1-TH')!;
    assert.ok(persisted.review.invocations.some((i) => i.outcome === 'pending'), 'the release at the time was refused by the held lock');
    const passed = await runner.formalReview(g(), card, persisted);
    assert.equal(passed.classified.outcome, 'pass');
    assert.equal(dispatched, 2, 'the failed dispatch is released and redone, once');
    persisted = fx.store.getCardRun(goal.id, 'T1-TH')!;
    assert.deepEqual(persisted.review.invocations.map((i) => i.outcome), ['no-verdict', 'pass'], 'no pending reservation survives a failed dispatch');
    assert.equal(persisted.review.substantiveDecisions, 1);
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-3 R2 cycle 1 round 2: a retained formal result is committed whatever the current candidate (history for a replaced one), and a retained quota hold is committed as a hold', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    let onDispatch: (() => void) | undefined;
    const r3: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-rt.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-rt.ts b/src/t1-rt.ts\n+export const rt = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => {
        dispatched += 1;
        onDispatch?.();
        const out = r3.shift() ?? R3_PASS;
        return out.includes('429') ? { stderr: out, exitCode: 1 } : { stdout: out }; // a held reviewer reports the hold on stderr
      },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-RT');
    const { card, g, goal } = s;
    const lock = `${fx.store.cardFile(goal.id, 'T1-RT')}.lock`;
    const held = () => writeFileSync(lock, `pid=${process.pid} at=now nonce=held`, 'utf8');
    let r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    // (1) The block on sha-1 is retained (the commit lost the lock); the author records sha-2 before retrying.
    r3.push(r3Block('src/t1-rt.ts'));
    onDispatch = held;
    await assert.rejects(() => runner.formalReview(g(), card, r.run), /locked/i);
    rmSync(lock, { force: true });
    onDispatch = undefined;
    const repaired = fx.store.updateCardRun(goal.id, 'T1-RT', (current) => ({ ...current!, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2', preReview: { ...current!.preReview, rounds: [...current!.preReview.rounds, { round: 2, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-2', candidateSha: 'sha-2', requestedAt: fx.now(), durationMs: 0, outcome: 'pass', reasons: [] }] } }));
    const history = await runner.formalReview(g(), card, repaired);
    assert.equal(history.classified.outcome, 'block-defect', 'the retained result of the replaced candidate is committed');
    assert.equal(dispatched, 1, 'no dispatch for the retained result');
    let persisted = fx.store.getCardRun(goal.id, 'T1-RT')!;
    assert.deepEqual(persisted.review.invocations.map((i) => [i.candidateSha, i.outcome]), [['sha-1', 'block']], 'the decision is history for sha-1, no reservation stays');
    assert.equal(persisted.review.substantiveDecisions, 1);
    assert.equal(persisted.candidate?.sha, 'sha-2');
    assert.equal(persisted.dodReceipt, 'dod:2', 'the newer candidate keeps its receipt');
    assert.notEqual(persisted.state, 'REVIEW_FIX', 'the newer candidate keeps its state');
    assert.deepEqual(persisted.findings.map((f) => [f.id, f.candidateSha]), [['F1', 'sha-1']]);
    // The next command reviews sha-2.
    r3.push('Error: 429 Too Many Requests, retry after 60 seconds\n');
    onDispatch = () => {
      held();
      fx.advance(90_000);
    };
    await assert.rejects(() => runner.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-RT')!), /locked/i);
    rmSync(lock, { force: true });
    onDispatch = undefined;
    assert.equal(dispatched, 2);
    // (2) The retained quota hold is committed as a hold: no retry spent, the card waits for the hold, the command refuses meanwhile.
    const hold = await runner.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-RT')!);
    assert.equal(hold.classified.outcome, 'quota-hold');
    assert.equal(dispatched, 2, 'no dispatch for the retained hold');
    persisted = fx.store.getCardRun(goal.id, 'T1-RT')!;
    const last = persisted.review.invocations.at(-1)!;
    assert.equal(last.outcome, 'quota-hold');
    assert.ok(last.holdUntil && Date.parse(last.holdUntil) > Date.parse(fx.now()), 'the hold is recorded with its end');
    assert.equal(persisted.review.noVerdictRetriesUsed, 0, 'a hold spends no retry');
    assert.equal(persisted.state, 'WAIT');
    await assert.rejects(() => runner.formalReview(g(), card, persisted), /hold/);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 acceptance 15: a formal result is recovered only from its complete envelope, the recovery settles the pool request, a retention failure after the reviewer ran is charged as a no-verdict, and a pre-dispatch failure is released', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    let onDispatch: (() => void) | undefined;
    const r3: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-env.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-env.ts b/src/t1-env.ts\n+export const env = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => {
        dispatched += 1;
        onDispatch?.();
        const out = r3.shift() ?? R3_PASS;
        return out.includes('429') ? { stderr: out, exitCode: 1 } : { stdout: out }; // a held reviewer reports the hold on stderr
      },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-ENV');
    const { card, g, goal } = s;
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    let r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    // (1) A reservation whose reviewer wrote its log but no envelope exists yet is still in flight: nothing is committed from the log.
    let run = fx.store.updateCardRun(goal.id, 'T1-ENV', (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations, { invocationId: 'r3:T1-ENV.r3.9.logonly', candidateDigest: 'sha-1', candidateSha: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const }] } }));
    mkdirSync(reviewDir, { recursive: true });
    const logOnly = path.join(reviewDir, 'T1-ENV.r3.9.logonly.log');
    writeFileSync(logOnly, '# review fake-r3 exit=0 timedOut=false durationMs=1 outputSha256=x outcome=block runStatus=success\n## stdout\n', 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'a log without its envelope is a review still finishing');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-ENV')?.review.invocations.at(-1)?.outcome, 'pending');
    // A log older than the reviewer timeout and the grace with no envelope is an unrecoverable result: charged as a no-verdict.
    const old = new Date(Date.now() - (1000 + RECONCILE_GRACE_MS + 60_000));
    utimesSync(logOnly, old, old);
    const charged = await runner.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-ENV')!);
    assert.equal(charged.classified.outcome, 'no-verdict');
    assert.equal(dispatched, 0);
    run = fx.store.getCardRun(goal.id, 'T1-ENV')!;
    assert.deepEqual(run.review.invocations.map((i) => i.outcome), ['no-verdict']);
    assert.equal(run.review.noVerdictRetriesUsed, 1, 'the unrecoverable result spends the retry');
    // (2) The envelope is written but the pool request was never settled (the completion failed right after): the recovery settles it.
    const realComplete = fx.queue.complete.bind(fx.queue);
    let failOnce = true;
    fx.queue.complete = (...args: Parameters<typeof realComplete>) => {
      if (failOnce) {
        failOnce = false;
        throw new Error('queue store unavailable');
      }
      return realComplete(...args);
    };
    r3.push(R3_PASS);
    try {
      await assert.rejects(() => runner.formalReview(g(), card, run), /queue store unavailable/);
    } finally {
      fx.queue.complete = realComplete;
    }
    assert.equal(dispatched, 1);
    run = fx.store.getCardRun(goal.id, 'T1-ENV')!;
    const pendingPass = run.review.invocations.find((i) => i.outcome === 'pending');
    assert.ok(pendingPass, 'the result is retained under its reservation');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 1, 'the request is still running');
    const recovered = await runner.formalReview(g(), card, run);
    assert.equal(recovered.classified.outcome, 'pass');
    assert.equal(dispatched, 1, 'no second dispatch');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the recovery settles the pool request');
    run = fx.store.getCardRun(goal.id, 'T1-ENV')!;
    assert.deepEqual(run.review.invocations.map((i) => i.outcome), ['no-verdict', 'pass']);
    assert.equal(run.review.substantiveDecisions, 1);
    // (3) A retention failure after the reviewer returned is charged as a no-verdict, never re-dispatched; a pre-dispatch failure is released.
    const fresh = fx.store.updateCardRun(goal.id, 'T1-ENV', (current) => ({ ...current!, state: 'SHIP', candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2', preReview: { ...current!.preReview, rounds: [...current!.preReview.rounds, { round: 2, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-2', candidateSha: 'sha-2', requestedAt: fx.now(), durationMs: 0, outcome: 'pass', reasons: [] }] }, review: { ...current!.review, substantiveDecisions: 0, noVerdictRetriesUsed: 0, invocations: [] } }));
    const realWrite = fs.writeFileSync;
    (fs as unknown as Record<string, unknown>)['writeFileSync'] = ((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file).endsWith('.log') && String(file).includes('T1-ENV.r3.')) {
        const err = new Error('EACCES: permission denied, open') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return (realWrite as unknown as (...a: unknown[]) => void)(file, ...rest);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();
    let afterRetention: Awaited<ReturnType<typeof runner.formalReview>> | undefined;
    try {
      afterRetention = await runner.formalReview(g(), card, fresh);
    } finally {
      (fs as unknown as Record<string, unknown>)['writeFileSync'] = realWrite;
      syncBuiltinESMExports();
    }
    assert.equal(dispatched, 2);
    assert.equal(afterRetention!.classified.outcome, 'no-verdict', 'the reviewer ran: its lost result is a no-verdict, charged');
    run = fx.store.getCardRun(goal.id, 'T1-ENV')!;
    assert.deepEqual(run.review.invocations.map((i) => i.outcome), ['no-verdict']);
    assert.equal(run.review.noVerdictRetriesUsed, 1);
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
    const empty = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, formalReview: { ...fx.config.formalReview, command: [''] } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    await assert.rejects(() => empty.formalReview(g(), card, run), /review command is empty/);
    run = fx.store.getCardRun(goal.id, 'T1-ENV')!;
    assert.ok(!run.review.invocations.some((i) => i.outcome === 'pending'), 'a failure before any receipt releases the reservation');
    assert.equal(run.review.noVerdictRetriesUsed, 1, 'and spends nothing');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 acceptance 15: a second completion of an already-decided invocation removes nothing; the gate recomputes the candidate after its reload', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let onDispatch: (() => void) | undefined;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-dbl.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-dbl.ts b/src/t1-dbl.ts\n+export const dbl = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => { onDispatch?.(); return { stdout: r3Block('src/t1-dbl.ts') }; },
    });
    const ship = new DryRunShipPath(['merged']);
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-DBL');
    const { card, g, goal } = s;
    // One block is already on the ledger: the decision in flight is the second.
    fx.store.updateCardRun(goal.id, 'T1-DBL', (current) => ({ ...current!, review: { ...current!.review, substantiveDecisions: 1, substantiveBlocks: 1, invocations: [{ invocationId: 'r3:first', candidateDigest: 'sha-0', candidateSha: 'sha-0', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'block' as const, runStatus: 'success' as const, mergeBlocking: true }] } }));
    const r = runner.next(g(), card, (await runner.preReview(g(), card, fx.store.getCardRun(goal.id, 'T1-DBL')!)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    // While the reviewer runs, another window recovers the same reservation from an envelope it finds complete and commits it first.
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    onDispatch = () => {
      const now = fx.store.getCardRun(goal.id, 'T1-DBL')!;
      const pending = now.review.invocations.find((i) => i.outcome === 'pending')!;
      const stem = pending.invocationId.slice(3);
      const verdict = { verdict: 'block', reasons: ['[spec] 6 tests @ src/t1-dbl.ts:1: no RED -> add one'], axes: { spec: { verdict: 'block', reasons: ['[spec] 6 tests @ src/t1-dbl.ts:1: no RED -> add one'] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1', branch: 'T1-DBL', run_status: 'success' };
      writeFileSync(path.join(reviewDir, `${stem}.json`), JSON.stringify(verdict), 'utf8');
      writeFileSync(path.join(reviewDir, `${stem}.log`), '# review fake-r3 exit=0 timedOut=false durationMs=1 outputSha256=x outcome=block runStatus=success\n', 'utf8');
      writeFileSync(path.join(reviewDir, `${stem}.result.json`), JSON.stringify({ invocationId: pending.invocationId, candidateSha: 'sha-1', candidateDigest: 'sha-1', key: 'k', seen: {}, at: fx.now(), outcome: 'block', runStatus: 'success', reasons: verdict.reasons, verdict, advisory: [], verdictRef: path.join(reviewDir, `${stem}.json`), logRef: path.join(reviewDir, `${stem}.log`), durationMs: 1, receiptSha256: 'x' }), 'utf8');
      void runner.formalReview(g(), card, now);
    };
    const second = await runner.formalReview(g(), card, r.run);
    const persisted = fx.store.getCardRun(goal.id, 'T1-DBL')!;
    assert.equal(persisted.state, 'STOP', 'the second block stopped the card');
    assert.deepEqual(persisted.review.invocations.map((i) => i.outcome), ['block', 'block'], 'the decision committed first is never removed by the later completion');
    assert.equal(persisted.review.substantiveDecisions, 2);
    assert.equal(persisted.review.substantiveBlocks, 2);
    assert.deepEqual(persisted.findings.map((f) => f.id), ['F1']);
    assert.equal(second.run.review.invocations.length, 2);
    // The gate: a round reserved for sha-1 expires; the record now holds sha-2 with its own receipt while sha-1 had the pass.
    fx.store.updateCardRun(goal.id, 'T1-DBL', (current) => ({ ...current!, state: 'SHIP', stop: undefined, review: { ...current!.review, substantiveDecisions: 0, substantiveBlocks: 0, invocations: [] } }));
    const stale = fx.store.updateCardRun(goal.id, 'T1-DBL', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: [...current!.preReview.rounds, { round: 2, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-1', candidateSha: 'sha-1', requestedAt: fx.now(), durationMs: 0, outcome: 'pending', reasons: [], reservationId: 'res-old' }] } }));
    fx.advance(1000 + RECONCILE_GRACE_MS + 1);
    fx.store.updateCardRun(goal.id, 'T1-DBL', (current) => ({ ...current!, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2' }));
    const after = runner.next(g(), card, stale);
    assert.equal(ship.requests.length, 0, 'sha-2 is never shipped on sha-1 pass');
    assert.notEqual(after.directive.kind, 'review', after.directive.narration);
    assert.notEqual(after.directive.kind, 'close', after.directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R3 decision 1: an envelope is recovered only when complete and bound to its reservation, its outcome is authoritative, its hold keeps the recorded deadline, and a reservation with no artefact at all expires into a charged no-verdict', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-env2.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-env2.ts b/src/t1-env2.ts\n+export const env2 = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => { dispatched += 1; return { stdout: R3_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-ENV2');
    const { card, g, goal } = s;
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    mkdirSync(reviewDir, { recursive: true });
    const r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    const reserve = (id: string) => fx.store.updateCardRun(goal.id, 'T1-ENV2', (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations.filter((i) => i.outcome !== 'pending'), { invocationId: `r3:${id}`, candidateDigest: 'sha-1', candidateSha: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const }] } }));
    const passDoc = { verdict: 'pass', reasons: [], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1', branch: 'T1-ENV2', run_status: 'success' };
    // (1) An empty envelope is no envelope: the reservation stays in flight, nothing is recovered from the verdict file next to it.
    let run = reserve('T1-ENV2.r3.7.empty');
    writeFileSync(path.join(reviewDir, 'T1-ENV2.r3.7.empty.result.json'), '{}\n', 'utf8');
    writeFileSync(path.join(reviewDir, 'T1-ENV2.r3.7.empty.json'), JSON.stringify(passDoc), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'an incomplete envelope recovers nothing');
    // An envelope bound to another reservation is not this one's.
    writeFileSync(path.join(reviewDir, 'T1-ENV2.r3.7.empty.result.json'), JSON.stringify({ invocationId: 'r3:someone-else', candidateSha: 'sha-1', candidateDigest: 'sha-1', key: 'k', seen: {}, at: fx.now(), outcome: 'pass', runStatus: 'success', reasons: [], advisory: [], durationMs: 1, receiptSha256: 'x' }), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'an envelope of another invocation recovers nothing');
    // (2) A complete envelope declaring no-verdict is authoritative over a pass document beside it.
    run = reserve('T1-ENV2.r3.8.novd');
    writeFileSync(path.join(reviewDir, 'T1-ENV2.r3.8.novd.json'), JSON.stringify(passDoc), 'utf8');
    writeFileSync(path.join(reviewDir, 'T1-ENV2.r3.8.novd.result.json'), JSON.stringify({ invocationId: 'r3:T1-ENV2.r3.8.novd', candidateSha: 'sha-1', candidateDigest: 'sha-1', key: 'k', seen: {}, at: fx.now(), outcome: 'no-verdict', runStatus: 'malformed', reasons: ['inconsistent axes'], advisory: [], durationMs: 1, receiptSha256: 'x' }), 'utf8');
    const novd = await runner.formalReview(g(), card, run);
    assert.equal(novd.classified.outcome, 'no-verdict', 'the envelope decides, not the document beside it');
    run = fx.store.getCardRun(goal.id, 'T1-ENV2')!;
    assert.equal(run.review.invocations.at(-1)?.outcome, 'no-verdict');
    assert.equal(run.review.substantiveDecisions, 0);
    // (3) A recovered hold keeps the deadline the envelope recorded, whenever the recovery runs.
    run = reserve('T1-ENV2.r3.9.hold');
    const recorded = addMs(fx.now(), 60_000);
    writeFileSync(path.join(reviewDir, 'T1-ENV2.r3.9.hold.result.json'), JSON.stringify({ invocationId: 'r3:T1-ENV2.r3.9.hold', candidateSha: 'sha-1', candidateDigest: 'sha-1', key: 'k', seen: {}, at: fx.now(), outcome: 'quota-hold', runStatus: 'tool_error', reasons: [], retryAfterMs: 60_000, holdUntil: recorded, advisory: [], durationMs: 1, receiptSha256: 'x' }), 'utf8');
    fx.advance(3_600_000);
    const held = await runner.formalReview(g(), card, run);
    assert.equal(held.classified.outcome, 'quota-hold');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-ENV2')!.review.invocations.at(-1)?.holdUntil, recorded, 'the recorded deadline is kept, not restarted from the recovery');
    // (4) A reservation with no log, no envelope and no failure marker expires from its request time into a charged no-verdict, with its pool request settled.
    run = reserve('T1-ENV2.r3.10.nothing');
    const key = reviewRequestKey({ repository: goal.repository, candidateDigest: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3' });
    fx.queue.enqueue({ pool: goal.reviewPool, repository: goal.repository, candidateDigest: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requester: `${goal.id}:T1-ENV2`, deadline: addMs(fx.now(), 3_600_000), now: fx.now() });
    fx.queue.requeue(key, fx.now());
    fx.queue.admit(goal.reviewPool, actorA, fx.now());
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 1, 'fixture: the request is running');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'young enough to be still running');
    fx.advance(1000 + RECONCILE_GRACE_MS + 1);
    const expired = await runner.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-ENV2')!);
    assert.equal(expired.classified.outcome, 'no-verdict');
    assert.equal(dispatched, 0);
    run = fx.store.getCardRun(goal.id, 'T1-ENV2')!;
    assert.ok(!run.review.invocations.some((i) => i.outcome === 'pending'));
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the pool request is settled');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R3 decision 1: the gate re-validates after the hand-off reload, and the canonical verdict file is repaired from the envelope before the ship', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'ship', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const r2: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-ho2.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-ho2.ts b/src/t1-ho2.ts\n+export const ho2 = 1;\n' },
      'fake-r2': () => ({ stdout: r2.shift() ?? R2_PASS }),
      'fake-r3': () => ({ stdout: R3_PASS }),
    });
    const ship = new DryRunShipPath(['merged']);
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-HO2');
    const { card, g, goal } = s;
    // (1) The only round blocks; the exhausted cycle hands the residual to R3. Between card next's own writes and the
    // hand-off transaction (at the operation-ledger read) another window records a newer candidate with its receipt.
    r2.push(r2Block('src/t1-ho2.ts'));
    const blocked = (await runner.preReview(g(), card, s.run)).run;
    const disputed = runner.disputeFinding(g(), card, blocked, 'F1', 'the RED is tests/t1-ho2.test.ts');
    const realUnresolved = fx.ops.unresolved.bind(fx.ops);
    let injected = false;
    fx.ops.unresolved = (...args: Parameters<typeof realUnresolved>) => {
      if (!injected) {
        injected = true;
        fx.store.updateCardRun(goal.id, 'T1-HO2', (current) => ({ ...current!, candidate: { sha: 'sha-2', dirty: false, untracked: [], digest: 'sha-2' }, dodReceipt: 'dod:2' }));
      }
      return realUnresolved(...args);
    };
    let r: ReturnType<typeof runner.next>;
    try {
      r = runner.next(g(), card, disputed);
    } finally {
      fx.ops.unresolved = realUnresolved;
    }
    assert.ok(injected);
    assert.equal(ship.requests.length, 0, 'sha-2 is never shipped on sha-1 exhaustion');
    assert.notEqual(r.directive.kind, 'review', `sha-2 has no R2 review: ${r.directive.narration}`);
    assert.notEqual(r.directive.kind, 'close', r.directive.narration);
    // (2) A pass committed while the canonical file could not be written: the fault is at the publication's own seam (the
    // rename of the atomic write), the decision and its journal event land regardless, and the gate repairs the file from the
    // envelope before it opens the ship, replacing the stale same-SHA block the earlier decision on this candidate left.
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    const canonical = path.join(reviewDir, 'T1-HO2.json');
    fx.store.updateCardRun(goal.id, 'T1-HO2', (current) => ({ ...current!, candidate: { sha: 'sha-3', dirty: false, untracked: [], digest: 'sha-3' }, dodReceipt: 'dod:3', preReview: { ...current!.preReview, rounds: [...current!.preReview.rounds, { round: 2, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-3', candidateSha: 'sha-3', requestedAt: fx.now(), durationMs: 0, outcome: 'pass', reasons: [] }] } }));
    writeFileSync(canonical, JSON.stringify({ verdict: 'block', reasons: ['[spec] 6 tests @ src/t1-ho2.ts:1: stale block'], sha: 'sha-3', branch: 'T1-HO2', run_status: 'success', reviewer: 'fake-r3', invocationId: 'r3:T1-HO2.r3.0.stale' }), 'utf8');
    const realRename = fs.renameSync;
    let faulted = 0;
    (fs as unknown as Record<string, unknown>)['renameSync'] = ((from: fs.PathLike, to: fs.PathLike) => {
      if (String(to) === canonical) {
        faulted += 1;
        const err = new Error('EACCES: permission denied, rename') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return realRename(from, to);
    }) as typeof fs.renameSync;
    syncBuiltinESMExports();
    let passed: Awaited<ReturnType<typeof runner.formalReview>> | undefined;
    try {
      passed = await runner.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-HO2')!);
    } catch {
      /* the publication failure may surface as an error; the decision is committed either way */
    } finally {
      (fs as unknown as Record<string, unknown>)['renameSync'] = realRename;
      syncBuiltinESMExports();
    }
    assert.equal(faulted, 1, 'the fault fired at the publication seam');
    const committed = fx.store.getCardRun(goal.id, 'T1-HO2')!;
    const passInvocation = committed.review.invocations.at(-1)!;
    assert.equal(passInvocation.outcome, 'pass', passed ? 'the pass is committed' : 'the pass is committed even when the publication threw');
    const decidedEvent = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').find((e) => e.data['invocationId'] === passInvocation.invocationId);
    assert.ok(decidedEvent, 'REVIEW_DECIDED is journaled although the publication did not land');
    assert.equal(decidedEvent.data['canonicalPublished'], false, 'the event says the canonical document was not published');
    assert.equal((JSON.parse(readFileSync(canonical, 'utf8')) as { verdict?: string }).verdict, 'block', 'fixture: the stale same-SHA block is still the canonical document');
    // The sidecar of the pass contradicts its envelope (a block): the repair reads the committed envelope, never the sidecar.
    const stem = passInvocation.invocationId.slice(3);
    writeFileSync(path.join(reviewDir, `${stem}.json`), JSON.stringify({ verdict: 'block', reasons: ['[spec] 6 tests @ src/t1-ho2.ts:1: conflicting sidecar'], sha: 'sha-3', branch: 'T1-HO2', run_status: 'success' }), 'utf8');
    const after = runner.next(g(), card, committed);
    assert.ok(existsSync(canonical), 'the canonical verdict file is repaired from the committed envelope before the ship');
    const repaired = JSON.parse(readFileSync(canonical, 'utf8')) as { sha?: string; verdict?: string; invocationId?: string; advisory?: string[] };
    assert.equal(repaired.sha, 'sha-3');
    assert.equal(repaired.verdict, 'pass', 'the stale same-SHA block is replaced by the committed pass');
    assert.equal(repaired.invocationId, passInvocation.invocationId, 'the canonical document names the decision it publishes');
    assert.deepEqual(repaired.advisory ?? [], [], 'nothing of the conflicting sidecar reaches the canonical document');
    assert.equal(after.directive.kind, 'close', after.directive.narration);
    const repairs = () => fx.events(goal.id).filter((e) => e.type === 'NOTE' && e.data['canonicalRepaired'] === passInvocation.invocationId).length;
    assert.equal(repairs(), 1, 'the repair is journaled');
    runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-HO2')!);
    assert.equal(repairs(), 1, 'an intact canonical document is not repaired again');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R2 cycle 1 round 1: the envelope carries the verdict it decided on, so the recovery never reads the sidecar; a decided envelope without its verdict is incomplete', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-env3.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-env3.ts b/src/t1-env3.ts\n+export const env3 = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => { dispatched += 1; return { stdout: R3_PASS }; },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-ENV3');
    const { card, g, goal } = s;
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    mkdirSync(reviewDir, { recursive: true });
    const r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    const reserve = (id: string) => fx.store.updateCardRun(goal.id, 'T1-ENV3', (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations.filter((i) => i.outcome !== 'pending'), { invocationId: `r3:${id}`, candidateDigest: 'sha-1', candidateSha: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const }] } }));
    const blockDoc = { verdict: 'block', reasons: ['[spec] 6 tests @ src/t1-env3.ts:1: no RED -> add one'], axes: { spec: { verdict: 'block', reasons: ['[spec] 6 tests @ src/t1-env3.ts:1: no RED -> add one'] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1', branch: 'T1-ENV3', run_status: 'success' };
    const passDoc = { verdict: 'pass', reasons: [], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1', branch: 'T1-ENV3', run_status: 'success' };
    const envelope = (id: string, over: Record<string, unknown>) => ({ invocationId: `r3:${id}`, candidateSha: 'sha-1', candidateDigest: 'sha-1', key: 'k', seen: {}, at: fx.now(), runStatus: 'success', reasons: [], advisory: [], durationMs: 1, receiptSha256: 'x', ...over });
    // (1) A block envelope with its verdict inside is recovered as that block even when the sidecar beside it says pass.
    let run = reserve('T1-ENV3.r3.5.blk');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.5.blk.json'), JSON.stringify(passDoc), 'utf8');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.5.blk.result.json'), JSON.stringify(envelope('T1-ENV3.r3.5.blk', { outcome: 'block', reasons: blockDoc.reasons, verdict: blockDoc })), 'utf8');
    const blocked = await runner.formalReview(g(), card, run);
    assert.equal(blocked.classified.outcome, 'block-defect', 'the envelope decides, never the sidecar');
    run = fx.store.getCardRun(goal.id, 'T1-ENV3')!;
    assert.equal(run.review.invocations.at(-1)?.outcome, 'block');
    assert.deepEqual(run.findings.map((f) => f.reason), blockDoc.reasons, 'the findings come from the envelope\'s verdict');
    assert.equal(run.state, 'REVIEW_FIX');
    // (2) A decided envelope without its verdict is incomplete: nothing is recovered from the sidecar, the reservation waits.
    fx.store.updateCardRun(goal.id, 'T1-ENV3', (current) => ({ ...current!, state: 'SHIP', review: { ...current!.review, substantiveDecisions: 0, substantiveBlocks: 0, invocations: [] }, findings: [] }));
    run = reserve('T1-ENV3.r3.6.novd');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.json'), JSON.stringify(passDoc), 'utf8');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify(envelope('T1-ENV3.r3.6.novd', { outcome: 'pass' })), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'a pass envelope without its verdict recovers nothing');
    // A verdict that contradicts its envelope is inconsistent: incomplete as well.
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify(envelope('T1-ENV3.r3.6.novd', { outcome: 'pass', verdict: blockDoc })), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'an envelope whose verdict disagrees with its outcome recovers nothing');
    // A non-decided envelope that carries a verdict is inconsistent as well: a no-verdict or a hold never recovers the pass beside it.
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify(envelope('T1-ENV3.r3.6.novd', { outcome: 'no-verdict', runStatus: 'malformed', verdict: passDoc })), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'a no-verdict envelope with an embedded pass recovers nothing');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify(envelope('T1-ENV3.r3.6.novd', { outcome: 'quota-hold', runStatus: 'tool_error', retryAfterMs: 60_000, verdict: passDoc })), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'a hold envelope with an embedded pass recovers nothing');
    // R3 decision 2 (finding 1): the envelope is complete only when every field agrees with the reservation and with itself:
    // a decided outcome with a run status other than success, another candidate sha, no pool request key or no dispatch
    // snapshot are inconsistent artifacts, never a decision.
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify(envelope('T1-ENV3.r3.6.novd', { outcome: 'pass', runStatus: 'malformed', verdict: passDoc })), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'a pass with a malformed run status recovers nothing');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify(envelope('T1-ENV3.r3.6.novd', { outcome: 'pass', verdict: passDoc, candidateSha: 'sha-other' })), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'an envelope naming another candidate sha recovers nothing');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify({ ...envelope('T1-ENV3.r3.6.novd', { outcome: 'pass', verdict: passDoc }), key: undefined }), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'an envelope without its pool request key recovers nothing');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify({ ...envelope('T1-ENV3.r3.6.novd', { outcome: 'pass', verdict: passDoc }), seen: undefined }), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'an envelope without the dispatch snapshot recovers nothing');
    // (3) A pass envelope with its verdict inside and no sidecar at all is recovered as a pass, and the canonical file is published from it.
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.result.json'), JSON.stringify(envelope('T1-ENV3.r3.6.novd', { outcome: 'pass', verdict: passDoc })), 'utf8');
    rmSync(path.join(reviewDir, 'T1-ENV3.r3.6.novd.json'), { force: true });
    const passed = await runner.formalReview(g(), card, run);
    assert.equal(passed.classified.outcome, 'pass');
    assert.equal(dispatched, 0);
    assert.equal(fx.store.getCardRun(goal.id, 'T1-ENV3')!.review.invocations.at(-1)?.outcome, 'pass');
    assert.equal((JSON.parse(readFileSync(path.join(reviewDir, 'T1-ENV3.json'), 'utf8')) as { sha?: string }).sha, 'sha-1');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R2 cycle 1 round 2: a failed dispatch always releases what it can and rethrows its own error; a round or decision it could not release is dropped by the next command, never charged', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-fd.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-fd.ts b/src/t1-fd.ts\n+export const fd = 1;\n' },
      'fake-r2': () => { dispatched += 1; return { stdout: R2_PASS }; },
      'fake-r3': () => { dispatched += 1; return { stdout: R3_PASS }; },
    });
    const mk = (over: Record<string, unknown>) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, ...over }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const runner = mk({});
    const s = cardAtShip(fx, runner, 'T1-FD');
    const { card, g, goal } = s;
    // (1) R2: the dispatch throws before any receipt and the release is refused (the lock held): the original error surfaces,
    // and the next gate pass drops the round at once from its retained failure instead of waiting out the timeout.
    const emptyR2 = mk({ preReview: { ...fx.config.preReview, command: [''] } });
    const realUpdate = fx.store.updateCardRun.bind(fx.store);
    let updates = 0;
    fx.store.updateCardRun = ((goalId: string, cardId: string, change: Parameters<typeof realUpdate>[2]) => {
      updates += 1;
      if (updates === 2) throw new Error('CARD_RUN_LOCKED: card run is locked by another writer; run the command again');
      return realUpdate(goalId, cardId, change);
    }) as typeof fx.store.updateCardRun;
    try {
      await assert.rejects(() => emptyR2.preReview(g(), card, s.run), /review command is empty/, 'the dispatch error is the one thrown');
    } finally {
      fx.store.updateCardRun = realUpdate;
    }
    let persisted = fx.store.getCardRun(goal.id, 'T1-FD')!;
    assert.ok(persisted.preReview.rounds.some((x) => x.outcome === 'pending'), 'fixture: the release was refused');
    let r = runner.next(g(), card, persisted);
    assert.equal(r.directive.kind, 'pre-review', `the round that never ran is dropped at once: ${r.directive.narration}`);
    assert.ok(!fx.store.getCardRun(goal.id, 'T1-FD')!.preReview.rounds.some((x) => x.outcome === 'pending'));
    assert.equal(dispatched, 0);
    // (2) R3: the failure marker cannot be written; the reservation is still released and the pool request cancelled, and the original error surfaces.
    r = runner.next(g(), card, (await runner.preReview(g(), card, fx.store.getCardRun(goal.id, 'T1-FD')!)).run);
    assert.equal(r.directive.kind, 'review');
    const emptyR3 = mk({ formalReview: { ...fx.config.formalReview, command: [''] } });
    const realWrite = fs.writeFileSync;
    (fs as unknown as Record<string, unknown>)['writeFileSync'] = ((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file).endsWith('.failed.json')) {
        const err = new Error('EACCES: permission denied, open') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return (realWrite as unknown as (...a: unknown[]) => void)(file, ...rest);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();
    try {
      await assert.rejects(() => emptyR3.formalReview(g(), card, r.run), /review command is empty/, 'the dispatch error is the one thrown, not the marker failure');
    } finally {
      (fs as unknown as Record<string, unknown>)['writeFileSync'] = realWrite;
      syncBuiltinESMExports();
    }
    persisted = fx.store.getCardRun(goal.id, 'T1-FD')!;
    assert.ok(!persisted.review.invocations.some((i) => i.outcome === 'pending'), 'the reservation is released although the marker could not be written');
    assert.equal(persisted.review.noVerdictRetriesUsed, 0, 'a review that never ran is never charged');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the pool request is cancelled');
    assert.equal(dispatched, 1);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R3 decision 2 (finding 4): the locked re-read before the ship dispatch recomputes the review cycle and the pre-review eligibility; a cycle advanced meanwhile refuses the dispatch', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'ship', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-cy.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-cy.ts b/src/t1-cy.ts\n+export const cy = 1;\n' },
      'fake-r2': () => ({ stdout: r2Block('src/t1-cy.ts') }),
      'fake-r3': () => ({ stdout: R3_PASS }),
    });
    const ship = new DryRunShipPath(['merged']);
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-CY');
    const { card, g, goal } = s;
    // The only round blocks; the exhausted cycle 0 hands the residual to R3, which passes: the candidate is admitted to the ship
    // without a pre-review pass of its own.
    const blocked = (await runner.preReview(g(), card, s.run)).run;
    const disputed = runner.disputeFinding(g(), card, blocked, 'F1', 'the RED is tests/t1-cy.test.ts');
    let r = runner.next(g(), card, disputed);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    const passed = (await runner.formalReview(g(), card, r.run)).run;
    // Between the gates and the locked re-read right before the dispatch (at the operation intent), another window records
    // a formal block on the ledger: the cycle advances, and cycle 1 holds no round for this candidate.
    const realIntent = fx.ops.recordIntent.bind(fx.ops);
    let injected = false;
    fx.ops.recordIntent = ((...args: Parameters<typeof realIntent>) => {
      if (!injected) {
        injected = true;
        fx.store.updateCardRun(goal.id, 'T1-CY', (current) => ({ ...current!, review: { ...current!.review, substantiveBlocks: current!.review.substantiveBlocks + 1 } }));
      }
      return realIntent(...args);
    }) as typeof fx.ops.recordIntent;
    try {
      r = runner.next(g(), card, passed);
    } finally {
      fx.ops.recordIntent = realIntent;
    }
    assert.ok(injected, 'fixture: the cycle advanced between the gates and the dispatch');
    assert.equal(ship.requests.length, 0, 'nothing is shipped in a cycle without a pre-review pass or an exhausted hand-off');
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    assert.match(r.directive.narration, /review (ledger|cycle)|eligibility/i, r.directive.narration);
    assert.equal(fx.ops.unresolved(goal.id, 'T1-CY').length, 0, 'the merge intent is cancelled');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0, 'the pool admission is released');
    // The next call reads the record: cycle 1 needs its own pre-review round before any ship.
    const next = runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-CY')!);
    assert.equal(next.directive.kind, 'pre-review', next.directive.narration);
    assert.equal(ship.requests.length, 0);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R3 decision 2 (finding 5): a release computed from a failed dispatch removes only a reservation still pending on the locked record; a decision another window committed under that invocation stays, and only a released reservation is journaled', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-rl.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-rl.ts b/src/t1-rl.ts\n+export const rl = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => ({ stdout: R3_PASS }),
    });
    const mk = (over: Record<string, unknown>) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, ...over }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const runner = mk({});
    const s = cardAtShip(fx, runner, 'T1-RL');
    const { card, g, goal } = s;
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    mkdirSync(reviewDir, { recursive: true });
    const r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    // Whatever the locked record holds for the pending reservation, another window has decided it meanwhile.
    const decideAll = (current: CardRun | undefined): CardRun | undefined =>
      current && { ...current, review: { ...current.review, substantiveDecisions: current.review.substantiveDecisions + 1, invocations: current.review.invocations.map((i) => (i.outcome === 'pending' && i.invocationId.startsWith('r3:') ? { ...i, outcome: 'pass' as const, runStatus: 'success' as const } : i)) } };
    const realUpdate = fx.store.updateCardRun.bind(fx.store);
    const interceptNth = (n: number) => {
      let updates = 0;
      fx.store.updateCardRun = ((goalId: string, cardId: string, change: Parameters<typeof realUpdate>[2]) => {
        updates += 1;
        return realUpdate(goalId, cardId, updates === n ? (current) => change(decideAll(current)) : change);
      }) as typeof fx.store.updateCardRun;
    };
    // (1) The dispatch fails before any receipt; its release (the second locked write after the reservation) finds the
    // invocation decided: the decision and its counter stay, nothing is removed.
    const emptyR3 = mk({ formalReview: { ...fx.config.formalReview, command: [''] } });
    interceptNth(2);
    try {
      await assert.rejects(() => emptyR3.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-RL')!), /review command is empty/);
    } finally {
      fx.store.updateCardRun = realUpdate;
    }
    let persisted = fx.store.getCardRun(goal.id, 'T1-RL')!;
    const decided = persisted.review.invocations.filter((i) => i.invocationId.startsWith('r3:'));
    assert.equal(decided.length, 1, 'the invocation another window decided is never removed by the delayed release');
    assert.equal(decided[0]?.outcome, 'pass');
    assert.equal(persisted.review.substantiveDecisions, 1, 'its counter stays with it');
    // (2) The cleanup of a reservation whose retained failure marker says it never ran: the locked record shows it decided
    // meanwhile, so it is kept, and no release is journaled for it.
    persisted = fx.store.updateCardRun(goal.id, 'T1-RL', (current) => ({ ...current!, review: { ...current!.review, substantiveDecisions: 0, invocations: [{ invocationId: 'r3:T1-RL.r3.9.marker', candidateDigest: 'sha-1', candidateSha: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const }] } }));
    writeFileSync(path.join(reviewDir, 'T1-RL.r3.9.marker.failed.json'), JSON.stringify({ invocationId: 'r3:T1-RL.r3.9.marker', candidateSha: 'sha-1', at: fx.now(), error: 'spawn failed' }), 'utf8');
    const releasedBefore = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED' && /released/.test(String(e.data['decision'] ?? ''))).length;
    interceptNth(1);
    try {
      await runner.formalReview(g(), card, persisted);
    } finally {
      fx.store.updateCardRun = realUpdate;
    }
    persisted = fx.store.getCardRun(goal.id, 'T1-RL')!;
    const marker = persisted.review.invocations.find((i) => i.invocationId === 'r3:T1-RL.r3.9.marker');
    assert.equal(marker?.outcome, 'pass', 'the reservation decided meanwhile is kept by the cleanup');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED' && /released/.test(String(e.data['decision'] ?? ''))).length, releasedBefore, 'no release is journaled for a reservation that was not released');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R3 decision 2 (finding 11): an advisory block is a publishable decision too; its canonical document is repaired before the ship like a pass', async () => {
  const fx = makeFixture({ config: { gateRequired: false, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const reason = '[standards] 9 error handling @ src/t1-adv3.ts:1: swallowed error -> rethrow';
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-adv3.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-adv3.ts b/src/t1-adv3.ts\n+export const adv3 = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => ({ stdout: `${JSON.stringify({ verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: [reason] } } })}\n` }),
    });
    const ship = new DryRunShipPath(['merged']);
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
    // A tier 1 card without a required gate: a standards block is advisory.
    writeCard(fx, { id: 'T1-ADV3', title: 'advisory canonical', tier: '1' });
    const goal = fx.controller.createGoal({ text: 'implement T1-ADV3', source: 'card', ref: 'T1-ADV3', affectedSurfaces: [] }, { cards: ['T1-ADV3'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-ADV3'] } });
    const card = fx.card('T1-ADV3');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-ADV3'));
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    r = runner.next(g(), card, (await runner.preReview(g(), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    const decided = await runner.formalReview(g(), card, r.run);
    assert.equal(decided.classified.outcome, 'block-advisory');
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    const canonical = path.join(reviewDir, 'T1-ADV3.json');
    const read = () => JSON.parse(readFileSync(canonical, 'utf8')) as { verdict?: string; advisory?: string[]; invocationId?: string; sha?: string };
    assert.equal(read().verdict, 'pass', 'an advisory block is published as a consistent pass');
    assert.deepEqual(read().advisory, [reason]);
    const invocation = fx.store.getCardRun(goal.id, 'T1-ADV3')!.review.invocations.at(-1)!;
    assert.equal(invocation.outcome, 'block');
    assert.equal(invocation.mergeBlocking, false);
    // The publication is lost; the gate repairs it from the committed envelope with the advisory classification before the ship.
    rmSync(canonical, { force: true });
    const after = runner.next(g(), card, fx.store.getCardRun(goal.id, 'T1-ADV3')!);
    assert.ok(existsSync(canonical), 'the canonical document of an advisory block is repaired before the ship');
    assert.equal(read().verdict, 'pass');
    assert.deepEqual(read().advisory, [reason], 'every finding stays under advisory');
    assert.equal(read().invocationId, invocation.invocationId);
    assert.equal(read().sha, 'sha-1');
    assert.equal(ship.requests.length, 1, 'the ship ran after the repair');
    assert.equal(after.directive.kind, 'close', after.directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R3 decision 2 (findings 6, 12, 13, 14): a retained result settles the pool request under the envelope queue sequence or the reservation own key, is recovered before the stop guard as evidence only, and finishes an unfinished hold', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-rec.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-rec.ts b/src/t1-rec.ts\n+export const rec = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => {
        dispatched += 1;
        return { stdout: R3_PASS };
      },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-REC');
    const { card, g, goal } = s;
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    mkdirSync(reviewDir, { recursive: true });
    const r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    const passDoc = { verdict: 'pass', reasons: [], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1', branch: 'T1-REC', run_status: 'success' };
    const reserve = (id: string, over: Record<string, unknown> = {}) => fx.store.updateCardRun(goal.id, 'T1-REC', (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations.filter((i) => i.outcome !== 'pending'), { invocationId: `r3:${id}`, candidateDigest: 'sha-1', candidateSha: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const, ...over }] } }));
    // A running pool request under the key of (reviewer, policy); its persisted queue sequence is returned with the key.
    const request = (reviewer: string, policyVersion = fx.config.reviewPolicyVersion) => {
      const key = reviewRequestKey({ repository: goal.repository, candidateDigest: 'sha-1', base: 'main', policyVersion, reviewer });
      const enq = fx.queue.enqueue({ pool: goal.reviewPool, repository: goal.repository, candidateDigest: 'sha-1', base: 'main', policyVersion, reviewer, requester: `${goal.id}:T1-REC`, deadline: addMs(fx.now(), 3_600_000), now: fx.now() });
      if (enq.status === 'completed') fx.queue.requeue(key, fx.now());
      const admit = fx.queue.admit(goal.reviewPool, actorA, fx.now());
      assert.equal(admit.status === 'admitted' ? admit.request.key : admit.status, key, 'fixture: this request runs');
      return { key, seq: fx.queue.get(key)!.seq };
    };
    const envelope = (id: string, key: string, seq: number, over: Record<string, unknown>) => ({ invocationId: `r3:${id}`, candidateSha: 'sha-1', candidateDigest: 'sha-1', key, seq, seen: {}, at: fx.now(), runStatus: 'success', reasons: [], advisory: [], durationMs: 1, receiptSha256: 'x', ...over });
    // (1) finding 13: the envelope names the queue sequence its review was admitted under; a newer request under the same
    // reusable key (another attempt of the same candidate) is never the one a late recovery settles.
    let run = reserve('T1-REC.r3.1.seq');
    const older = request('fake-r3');
    writeFileSync(path.join(reviewDir, 'T1-REC.r3.1.seq.result.json'), JSON.stringify(envelope('T1-REC.r3.1.seq', older.key, older.seq - 1, { outcome: 'pass', verdict: passDoc })), 'utf8');
    const recovered = await runner.formalReview(g(), card, run);
    assert.equal(recovered.classified.outcome, 'pass');
    assert.equal(fx.queue.get(older.key)!.state, 'running', 'a request with another queue sequence is not the recovered review request');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 1);
    run = reserve('T1-REC.r3.2.seqok');
    writeFileSync(path.join(reviewDir, 'T1-REC.r3.2.seqok.result.json'), JSON.stringify(envelope('T1-REC.r3.2.seqok', older.key, older.seq, { outcome: 'pass', verdict: passDoc })), 'utf8');
    await runner.formalReview(g(), card, run);
    assert.equal(fx.queue.get(older.key)!.state, 'completed', 'the request the envelope names is settled');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
    // (2) finding 6: a reservation that expired without an envelope settles the request under its own base, policy version
    // and reviewer, never under the configuration current at recovery time.
    run = reserve('T1-REC.r3.3.old', { reviewer: 'r3-old', policyVersion: 'REVIEW.md@1' });
    const old = request('r3-old', 'REVIEW.md@1');
    fx.advance(1000 + RECONCILE_GRACE_MS + 1);
    const expired = await runner.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-REC')!);
    assert.equal(expired.classified.outcome, 'no-verdict');
    assert.equal(fx.queue.get(old.key)!.state, 'completed', 'the request the reservation was admitted under is settled');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
    assert.equal(dispatched, 0);
    // (3) finding 12: a run stopped meanwhile still recovers a completed envelope, as evidence only: the reservation is
    // released, the pool request settled, no decision counted, and the stop stands; no new review runs.
    run = reserve('T1-REC.r3.4.stop');
    const stopReq = request('r3-stop');
    writeFileSync(path.join(reviewDir, 'T1-REC.r3.4.stop.result.json'), JSON.stringify(envelope('T1-REC.r3.4.stop', stopReq.key, stopReq.seq, { outcome: 'pass', verdict: passDoc })), 'utf8');
    const stopped = fx.store.updateCardRun(goal.id, 'T1-REC', (current) => ({ ...current!, state: 'STOP', stop: { reason: 'time', detail: 'card deadline', nextAction: 'extend', at: fx.now(), global: false, unresolvedOperations: [] } }));
    const decisionsBefore = stopped.review.substantiveDecisions;
    await assert.rejects(() => runner.formalReview(g(), card, stopped), /stopped/, 'no new review runs on a stopped card');
    const after = fx.store.getCardRun(goal.id, 'T1-REC')!;
    assert.ok(!after.review.invocations.some((i) => i.outcome === 'pending'), 'the reservation is released');
    assert.equal(after.state, 'STOP');
    assert.equal(after.stop?.reason, 'time', 'the stop stands');
    assert.equal(after.review.substantiveDecisions, decisionsBefore, 'evidence only: no decision is counted on a stopped run');
    assert.ok(after.evidence.some((e) => e.id === 'r3-T1-REC.r3.4.stop'), 'the result is retained as evidence');
    assert.equal(fx.queue.get(stopReq.key)!.state, 'completed', 'the pool request is settled');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
    assert.equal(dispatched, 0);
    // (4) finding 14: a recovered hold finishes the queue bookkeeping the hold left unfinished (the slot still held, the
    // pool deadline not persisted), idempotently.
    fx.store.updateCardRun(goal.id, 'T1-REC', (current) => ({ ...current!, state: 'SHIP', stop: undefined }));
    run = reserve('T1-REC.r3.5.hold');
    const held = request('r3-hold');
    const retryAfter = addMs(fx.now(), 120_000);
    fx.queue.hold(held.key, retryAfter, 'quota', fx.now());
    fx.queue.savePool({ ...fx.queue.pool(goal.reviewPool), active: [held.key], resetAt: undefined });
    writeFileSync(path.join(reviewDir, 'T1-REC.r3.5.hold.result.json'), JSON.stringify(envelope('T1-REC.r3.5.hold', held.key, held.seq, { outcome: 'quota-hold', runStatus: 'tool_error', retryAfterMs: 120_000, holdUntil: retryAfter })), 'utf8');
    const hold = await runner.formalReview(g(), card, run);
    assert.equal(hold.classified.outcome, 'quota-hold');
    assert.deepEqual(fx.queue.pool(goal.reviewPool).active, [], 'the slot the unfinished hold kept is released');
    assert.equal(fx.queue.pool(goal.reviewPool).resetAt, retryAfter, 'the pool deadline of the verified hold is persisted');
    assert.equal(fx.queue.get(held.key)!.state, 'retry-after');
    assert.equal(fx.queue.get(held.key)!.retryAfter, retryAfter, 'the original hold deadline is kept');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-FINDINGS-4 R3 decision 2 (finding 15): a dispatch that fails before any receipt cancels its pool request before it releases the reservation; a refused cancellation keeps the reservation and its marker as the recoverable state, and the next command cancels the request from the marker before it dispatches', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    let dispatched = 0;
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-pc.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-pc.ts b/src/t1-pc.ts\n+export const pc = 1;\n' },
      'fake-r2': () => ({ stdout: R2_PASS }),
      'fake-r3': () => {
        dispatched += 1;
        return { stdout: R3_PASS };
      },
    });
    const mk = (over: Record<string, unknown>) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, ...over }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const runner = mk({});
    const s = cardAtShip(fx, runner, 'T1-PC');
    const { card, g, goal } = s;
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    mkdirSync(reviewDir, { recursive: true });
    const r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    const emptyR3 = mk({ formalReview: { ...fx.config.formalReview, command: [''] } });
    const realCancel = fx.queue.cancel.bind(fx.queue);
    let refused = 0;
    fx.queue.cancel = ((..._args: Parameters<typeof realCancel>) => {
      refused += 1;
      throw new Error('queue store unavailable');
    }) as typeof fx.queue.cancel;
    try {
      await assert.rejects(() => emptyR3.formalReview(g(), card, fx.store.getCardRun(goal.id, 'T1-PC')!), /review command is empty/, 'the dispatch error is the one thrown');
    } finally {
      fx.queue.cancel = realCancel;
    }
    assert.equal(refused, 1, 'fixture: the cancellation was refused');
    let persisted = fx.store.getCardRun(goal.id, 'T1-PC')!;
    const pending = persisted.review.invocations.find((i) => i.outcome === 'pending');
    assert.ok(pending, 'the reservation stays while the pool request of the review that never ran is not settled');
    const key = reviewRequestKey({ repository: goal.repository, candidateDigest: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3' });
    assert.equal(fx.queue.get(key)!.state, 'running', 'fixture: the request of the review that never ran is still running');
    const marker = JSON.parse(readFileSync(path.join(reviewDir, `${pending.invocationId.slice(3)}.failed.json`), 'utf8')) as { key?: string; seq?: number };
    assert.equal(marker.key, key, 'the marker names the pool request');
    assert.equal(marker.seq, fx.queue.get(key)!.seq, 'and its queue sequence');
    // The next command settles the marker request, releases the reservation and dispatches; it never joins the running
    // request of a reviewer that never started.
    const decided = await runner.formalReview(g(), card, persisted);
    assert.equal(decided.classified.outcome, 'pass');
    assert.equal(dispatched, 1, 'the reviewer ran once');
    persisted = fx.store.getCardRun(goal.id, 'T1-PC')!;
    assert.ok(!persisted.review.invocations.some((i) => i.invocationId === pending.invocationId), 'the reservation that never ran is released');
    assert.equal(fx.queue.get(key)!.state, 'completed', 'the stale request was cancelled from the marker and the dispatch completed its own');
    assert.equal(fx.queue.pool(goal.reviewPool).active.length, 0);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-INPUTS acceptance 1: a committed diff above the stage cap is refused by review pre and review r3 before any dispatch: no round, decision, receipt, pool request or journal event', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    let spawns = 0;
    const big = 'diff --git a/src/t1-cap.ts b/src/t1-cap.ts\n' + '+export const cap = 1;\n'.repeat(4);
    const script = scriptedRunner({ 'git diff --name-only': { stdout: 'src/t1-cap.ts\n' }, 'git diff': { stdout: big }, 'fake-r2': () => { spawns += 1; return { stdout: PASS }; }, 'fake-r3': () => { spawns += 1; return { stdout: PASS }; } });
    const mk = (pre: number, formal: number) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, preReview: { ...fx.config.preReview, maxDiffBytes: pre }, formalReview: { ...fx.config.formalReview, maxDiffBytes: formal } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-CAP', title: 'diff cap' });
    const goal = fx.controller.createGoal({ text: 'implement T1-CAP', source: 'card', ref: 'T1-CAP', affectedSurfaces: [] }, { cards: ['T1-CAP'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-CAP'] } });
    const card = fx.card('T1-CAP');
    const g = () => fx.goal(goal.id);
    const strict = mk(40, 40);
    let r = strict.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-CAP'));
    const run = strict.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = strict.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review');
    const before = fx.events(goal.id).length;
    await assert.rejects(() => strict.preReview(g(), card, r.run), new RegExp(`${Buffer.byteLength(big)} bytes[\\s\\S]*preReview\\.maxDiffBytes[\\s\\S]*40`), 'the refusal names the size and the cap');
    let stored = fx.store.getCardRun(goal.id, 'T1-CAP')!;
    assert.equal(stored.preReview.rounds.length, 0, 'no round recorded');
    assert.equal(spawns, 0, 'no model call');
    assert.equal(fx.events(goal.id).length, before, 'no journal event');
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    assert.ok(!existsSync(reviewDir) || fs.readdirSync(reviewDir).every((f) => !f.startsWith('T1-CAP.pre')), 'no receipt retained');
    // R3: the pre-review passes under a wider cap; the formal cap refuses the same diff before the pool request and the reservation.
    const lenient = mk(1000, 40);
    r = lenient.next(g(), card, (await lenient.preReview(g(), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    const journaled = () => fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED' || e.type === 'REVIEW_ADMITTED').length;
    const decidedBefore = journaled();
    await assert.rejects(() => lenient.formalReview(g(), card, r.run), new RegExp(`${Buffer.byteLength(big)} bytes[\\s\\S]*formalReview\\.maxDiffBytes[\\s\\S]*40`));
    stored = fx.store.getCardRun(goal.id, 'T1-CAP')!;
    assert.equal(stored.review.invocations.length, 0, 'no decision reserved or recorded');
    assert.equal(fx.queue.list(fx.config.reviewPool).filter((q) => q.requesters.includes(`${goal.id}:T1-CAP`)).length, 0, 'no pool request');
    assert.equal(journaled(), decidedBefore, 'no journal event');
    assert.equal(spawns, 1, 'only the pre-review ran');
    // Within the cap the same candidate is decided.
    const f = await mk(1000, 1000).formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-INPUTS acceptance 2-4: every round and decision records the policy hash and names it in the prompt with the rule files the candidate changes; a later round receives the delta and marks a finding outside it as a first-round miss; the unchanged candidate gets the no-change note; tagged reasons are advisory and the pre-review notes reach R3', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2', '{instructions}'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'ship', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const policy = '# Review instructions\nMust-block 1-6.\n';
    writeFileSync(path.join(fx.repo.mainRoot, 'REVIEW.md'), policy, 'utf8');
    const hash = createHash('sha256').update(policy, 'utf8').digest('hex');
    const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const r2: string[] = [];
    const r3: string[] = [];
    const prompts: Array<{ stage: string; text: string }> = [];
    const script = scriptedRunner({
      // The delta since the last reviewed candidate is its own range; the generic keys below serve the full diff against the base.
      'git diff --name-only -z sha-1...HEAD': { stdout: 'src/t1-in2.ts\n' },
      'git diff --text sha-1...HEAD': { stdout: 'diff --git a/src/t1-in2.ts b/src/t1-in2.ts\n+export const in2 = 1;\n' },
      'git diff --name-only -z sha-2...HEAD': { stdout: 'src/t1-in.ts\n' },
      'git diff --text sha-2...HEAD': { stdout: 'diff --git a/src/t1-in.ts b/src/t1-in.ts\n+export const fix = 1;\n' },
      'git diff --name-only': { stdout: 'src/t1-in.ts\nsrc/t1-in2.ts\nREVIEW.md\n' },
      'git diff': { stdout: 'diff --git a/src/t1-in.ts b/src/t1-in.ts\n+export const in1 = 1;\n' },
      'fake-r2': (args) => {
        prompts.push({ stage: 'pre', text: args[0] ?? '' });
        return { stdout: r2.shift() ?? PASS };
      },
      'fake-r3': (args) => {
        prompts.push({ stage: 'formal', text: args[0] ?? '' });
        return { stdout: r3.shift() ?? PASS };
      },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-IN', title: 'review inputs', allowPaths: ['src/t1-in.ts', 'src/t1-in2.ts', 'REVIEW.md'] });
    const goal = fx.controller.createGoal({ text: 'implement T1-IN', source: 'card', ref: 'T1-IN', affectedSurfaces: [] }, { cards: ['T1-IN'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-IN'] } });
    const card = fx.card('T1-IN');
    const g = () => fx.goal(goal.id);
    const lastPrompt = (stage: 'pre' | 'formal') => [...prompts].reverse().find((p) => p.stage === stage)!.text;
    const doc = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as { policy_hash?: string };
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-IN'));
    let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);

    // Round 1: the hash on the round, the retained document and the event; the prompt names it and the rule file the candidate changes; a [question] reason is advisory and never a finding.
    const question = '[spec] 14 scope fidelity @ src/t1-in.ts:3: [question] is the helper needed by acceptance 1? -> confirm';
    r2.push(`{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-in.ts:1: no RED -> add one",${JSON.stringify(question)}]}\n`);
    const round1 = await runner.preReview(g(), card, r.run);
    assert.equal(round1.result.outcome, 'block');
    assert.deepEqual(round1.run.findings.map((f) => f.id), ['F1'], 'the tagged reason is no finding');
    assert.equal(round1.round.policyHash, hash, 'the round records the hash');
    assert.deepEqual(round1.round.advisory, [question], 'the round keeps its advisory notes');
    assert.equal(doc(round1.result.verdictRef!).policy_hash, hash, 'the retained round document carries the hash');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED').at(-1)?.data['policyHash'], hash, 'the event carries the hash');
    const prompt1 = lastPrompt('pre');
    assert.ok(prompt1.includes(`sha256 ${hash}`), 'the prompt names the hash');
    assert.match(prompt1, /rule files.*REVIEW\.md/s, 'the prompt names the rule file the candidate changes');
    assert.ok(!prompt1.includes('## Delta since the last reviewed candidate'), 'a first round has no delta');

    // Round 2 on the repaired candidate receives the delta since sha-1 (src/t1-in2.ts): a new finding on src/t1-in.ts is a first-round miss, one inside the delta is not.
    r = runner.next(g(), card, round1.run);
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    r2.push('{"verdict":"block","reasons":["[standards] 9 error handling @ src/t1-in.ts:9: swallowed error -> rethrow","[standards] 9 error handling @ src/t1-in2.ts:2: swallowed error -> rethrow"]}\n');
    const round2 = await runner.preReview(g(), card, r.run);
    const prompt2 = lastPrompt('pre');
    const delta2 = prompt2.slice(prompt2.indexOf('## Delta since the last reviewed candidate'), prompt2.indexOf('## Diff'));
    assert.ok(delta2.includes('since: sha-1') && delta2.includes('src/t1-in2.ts') && delta2.includes('git diff sha-1...sha-2'), `an argv prompt names the last reviewed candidate, the delta paths and the pinned command: ${delta2}`);
    assert.deepEqual(round2.run.findings.map((f) => [f.id, f.outsideDelta ?? false, f.resolvedAt !== undefined]), [['F1', false, true], ['F2', true, false], ['F3', false, false]], 'F2 cites a file outside the delta');
    assert.equal(round2.round.policyHash, hash);

    // Round 3 on the unchanged, fully disputed candidate: the no-change note, every new finding a first-round miss, a [suggestion] kept as an advisory note.
    run = runner.disputeFinding(g(), card, round2.run, 'F2', 'the error is rethrown at src/t1-in.ts:12');
    run = runner.disputeFinding(g(), card, run, 'F3', 'the error is rethrown at src/t1-in2.ts:5');
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    const suggestion = '[suggestion] @ src/t1-in2.ts:7: rename the helper -> optional';
    r2.push(`{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-in2.ts:5: helper the card does not ask for -> remove it",${JSON.stringify(suggestion)}]}\n`);
    const round3 = await runner.preReview(g(), card, r.run);
    assert.match(lastPrompt('pre'), /## Delta since the last reviewed candidate\n[^\n]*no change since the last reviewed candidate/i, 'equal shas render the no-change note');
    assert.equal(round3.run.findings.find((f) => f.id === 'F4')?.outsideDelta, true, 'on an unchanged candidate every new finding is a first-round miss');
    assert.deepEqual(round3.round.advisory, [suggestion]);
    assert.ok(fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED' && !e.data['exhausted']).every((e) => e.data['policyHash'] === hash), 'every round event carries the hash');

    // Exhausted rounds hand off to R3: decision 1 receives the latest R2 round's advisory notes as non-blocking and records the hash; a block on decision 1 makes decision 2 receive the delta since sha-2.
    r = runner.next(g(), card, round3.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    r3.push('{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-in2.ts:5: helper the card does not ask for -> remove it"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 14 scope fidelity @ src/t1-in2.ts:5: helper the card does not ask for -> remove it"]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    let f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    const formal1 = lastPrompt('formal');
    const notes = formal1.slice(formal1.indexOf('## Pre-review advisory notes'), formal1.indexOf('## Candidate'));
    assert.ok(notes.includes(JSON.stringify(suggestion)), `the R3 prompt lists the latest R2 round's advisory notes: ${notes}`);
    assert.ok(formal1.includes(`sha256 ${hash}`) && !formal1.includes('## Delta since the last reviewed candidate'), 'decision 1 names the hash and has no delta');
    assert.equal(f.run.review.invocations.at(-1)?.policyHash, hash, 'the decision records the hash');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').at(-1)?.data['policyHash'], hash);
    r = runner.next(g(), card, f.run);
    run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:3', redReceipt: 'red:1', candidateSha: 'sha-3' });
    r = runner.next(g(), card, run);
    r = runner.next(g(), card, (await runner.preReview(g(), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    // Decision 2 receives the delta since sha-2 (src/t1-in.ts): a new finding on src/t1-in2.ts is a first-round miss on the formal stage too, one inside the delta is not; the second block stops the card.
    r3.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-in.ts:2: the fix has no RED -> add one","[standards] 9 error handling @ src/t1-in2.ts:9: swallowed error -> rethrow"],"axes":{"spec":{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-in.ts:2: the fix has no RED -> add one"]},"standards":{"verdict":"block","reasons":["[standards] 9 error handling @ src/t1-in2.ts:9: swallowed error -> rethrow"]}}}\n');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    assert.equal(f.run.state, 'STOP', 'the second substantive block stops the card');
    assert.deepEqual(f.run.findings.filter((x) => x.stage === 'formal' && x.round === 2).map((x) => [x.id, x.file, x.outsideDelta ?? false]), [['F6', 'src/t1-in.ts', false], ['F7', 'src/t1-in2.ts', true]], 'the formal stage marks a new finding outside its delta');
    const formal2 = lastPrompt('formal');
    const delta = formal2.slice(formal2.indexOf('## Delta since the last reviewed candidate'), formal2.indexOf('## Diff'));
    assert.ok(delta.includes('since: sha-2') && delta.includes('src/t1-in.ts') && delta.includes('git diff sha-2...sha-3'), `decision 2 receives the delta since the candidate decision 1 reviewed: ${delta}`);
    assert.equal(doc(path.join(fx.repo.mainRoot, '.review', 'T1-IN.json')).policy_hash, hash, 'the canonical verdict document carries the hash');
    assert.ok(f.run.review.invocations.filter((i) => i.outcome === 'pass' || i.outcome === 'block').every((i) => i.policyHash === hash), 'every decision carries the hash');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-INPUTS R3 decision 1 (F5, F6): review r3 checks the diff cap before the exhausted hand-off, so a refused review leaves no hand-off and no event; the hand-off recorded later carries the hash of the round it hands on', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'ship', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const big = 'diff --git a/src/t1-ho2.ts b/src/t1-ho2.ts\n' + '+export const ho2 = 1;\n'.repeat(4);
    const script = scriptedRunner({ 'git diff --name-only': { stdout: 'src/t1-ho2.ts\n' }, 'git diff': { stdout: big }, 'fake-r2': () => ({ stdout: '{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-ho2.ts:1: no RED -> add one"]}\n' }), 'fake-r3': () => ({ stdout: R3_PASS }) });
    const mk = (formal: number) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, formalReview: { ...fx.config.formalReview, maxDiffBytes: formal } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const narrow = mk(40);
    const s = cardAtShip(fx, narrow, 'T1-HO2');
    const { card, g, goal } = s;
    assert.equal(s.directive.kind, 'pre-review');
    const round = await narrow.preReview(g(), card, s.run);
    assert.equal(round.result.outcome, 'block', 'the single round of the cycle is spent: exhausted');
    // The command reaches the exhausted candidate before the gate does: the cap refuses it before the hand-off is recorded.
    await assert.rejects(() => narrow.formalReview(g(), card, round.run), /formalReview\.maxDiffBytes/);
    const stored = fx.store.getCardRun(goal.id, 'T1-HO2')!;
    assert.deepEqual(stored.preReview.handoffs, [], 'no hand-off persisted by a refused review');
    assert.ok(!fx.events(goal.id).some((e) => e.type === 'PRE_REVIEW_DECIDED' && e.data['exhausted'] === true), 'no hand-off event');
    assert.equal(stored.review.invocations.length, 0);
    // Within the cap the hand-off is recorded once, naming the hash of the round it hands on, and the decision runs.
    const f = await mk(1000).formalReview(g(), card, stored);
    assert.equal(f.classified.outcome, 'pass');
    const handoff = fx.events(goal.id).find((e) => e.type === 'PRE_REVIEW_DECIDED' && e.data['exhausted'] === true)!;
    assert.equal(handoff.data['policyHash'], round.round.policyHash, 'the hand-off carries the hash of the round it hands on');
    assert.equal(f.run.preReview.handoffs.length, 1);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-INPUTS R3 decision 1 (F6, F7): a ship-path decision records the policy_hash its verdict document names, and a ship-path block carried only by tagged reasons is a pass with the notes: no block consumed, the notes handed back with the ship refusal', () => {
  const question = '[spec] 14 scope fidelity @ src/t1-tag.ts:3: [question] is the helper named by acceptance 1? -> confirm';
  class HashedShipPath extends DryRunShipPath {
    override readVerdict(): { verdict?: Verdict; raw?: string } {
      const v = super.readVerdict();
      return { ...v, raw: v.verdict ? JSON.stringify({ ...v.verdict, policy_hash: 'h'.repeat(64) }) : undefined };
    }
  }
  const fx = makeFixture({ config: { gateRequired: true } });
  try {
    const blockByTag: Verdict = { verdict: 'block', reasons: [question], axes: { spec: { verdict: 'block', reasons: [question] }, standards: { verdict: 'pass', reasons: [] } }, run_status: 'success' };
    const runner = fx.runner(new HashedShipPath(['review-blocked', 'merged'], blockByTag));
    const s = cardAtShip(fx, runner, 'T1-TAG');
    const { goal } = s;
    assert.equal(s.directive.kind, 'stop', `the ship path refused on advisory notes only: a human decides, no repair is asked: ${s.directive.narration}`);
    if (s.directive.kind === 'stop') assert.ok(s.directive.stop.reason === 'review' && s.directive.stop.detail.includes(question), 'the stop names the notes');
    assert.equal(s.run.dodReceipt, 'dod:1', 'the DoD receipt stands');
    assert.equal(s.run.blockedReceipt, undefined, 'nothing was cleared into a retained receipt');
    assert.equal(s.run.review.substantiveBlocks, 0, 'no block consumed');
    assert.equal(s.run.review.invocations.at(-1)?.outcome, 'pass', 'the ledger records a pass with the notes');
    assert.equal(s.run.review.invocations.at(-1)?.policyHash, 'h'.repeat(64), 'the hash the verdict document names is recorded');
    assert.deepEqual(s.run.findings, [], 'a tagged reason is no finding');
    const decided = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').at(-1)!;
    assert.equal(decided.data['policyHash'], 'h'.repeat(64));
    assert.deepEqual(decided.data['advisory'], [question]);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-INPUTS R3 decision 1 (F9): a result envelope whose policy hash contradicts the reservation is not that reservation\'s; an envelope naming none recovers under the reserved hash', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const script = scriptedRunner({ 'git diff --name-only': { stdout: 'src/t1-env3.ts\n' }, 'git diff': { stdout: 'diff --git a/src/t1-env3.ts b/src/t1-env3.ts\n+export const env3 = 1;\n' }, 'fake-r2': () => ({ stdout: R2_PASS }), 'fake-r3': () => ({ stdout: R3_PASS }) });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-ENV3');
    const { card, g, goal } = s;
    const reviewDir = path.join(fx.repo.mainRoot, '.review');
    mkdirSync(reviewDir, { recursive: true });
    const r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    const reserve = (id: string) => fx.store.updateCardRun(goal.id, 'T1-ENV3', (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations.filter((i) => i.outcome !== 'pending'), { invocationId: `r3:${id}`, candidateDigest: 'sha-1', candidateSha: 'sha-1', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pending' as const, policyHash: 'a'.repeat(64) }] } }));
    const passDoc = { verdict: 'pass', reasons: [], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'pass', reasons: [] } }, sha: 'sha-1', branch: 'T1-ENV3', run_status: 'success' };
    const envelope = (id: string, extra: Record<string, unknown>) => ({ invocationId: `r3:${id}`, candidateSha: 'sha-1', candidateDigest: 'sha-1', key: 'k', seen: {}, at: fx.now(), outcome: 'pass', runStatus: 'success', reasons: [], advisory: [], durationMs: 1, receiptSha256: 'x', verdict: passDoc, ...extra });
    let run = reserve('T1-ENV3.r3.1.other');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.1.other.result.json'), JSON.stringify(envelope('T1-ENV3.r3.1.other', { policyHash: 'b'.repeat(64) })), 'utf8');
    await assert.rejects(() => runner.formalReview(g(), card, run), /in flight/i, 'an envelope claiming another applied policy is not this reservation\'s');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-ENV3')!.review.invocations.at(-1)?.outcome, 'pending', 'nothing recovered');
    run = reserve('T1-ENV3.r3.2.legacy');
    writeFileSync(path.join(reviewDir, 'T1-ENV3.r3.2.legacy.result.json'), JSON.stringify(envelope('T1-ENV3.r3.2.legacy', {})), 'utf8');
    const legacy = await runner.formalReview(g(), card, run);
    assert.equal(legacy.classified.outcome, 'pass');
    assert.equal(legacy.run.review.invocations.at(-1)?.policyHash, 'a'.repeat(64), 'the reserved hash is authoritative');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-INPUTS R3 decision 2 (F5 re-raised): the hand-off is recorded only after the last cap check; a decision landing during the hand-off write refuses in the reservation lock, and the delta the refused review then recollects is capped before any hand-off', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'ship', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, maxDiffBytes: 100 } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only -z sha-0...HEAD': { stdout: 'src/t1-ho3.ts\n' },
      'git diff --text sha-0...HEAD': { stdout: 'diff --git a/src/t1-ho3.ts b/src/t1-ho3.ts\n' + '+export const ho3 = 1;\n'.repeat(4) },
      'git diff --name-only': { stdout: 'src/t1-ho3.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-ho3.ts b/src/t1-ho3.ts\n+export const ho3 = 1;\n' },
      'fake-r2': () => ({ stdout: '{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-ho3.ts:1: no RED -> add one"]}\n' }),
      'fake-r3': () => ({ stdout: R3_PASS }),
    });
    const mk = (formal: number) => new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, formalReview: { ...fx.config.formalReview, maxDiffBytes: formal } }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    const runner = mk(100);
    const s = cardAtShip(fx, runner, 'T1-HO3');
    const { card, g, goal } = s;
    const round = await runner.preReview(g(), card, s.run);
    assert.equal(round.result.outcome, 'block', 'exhausted after the single round');
    // Another window commits an older-candidate decision while the hand-off is written (the first locked write of the command).
    const older = (current: CardRun | undefined): CardRun | undefined =>
      current && { ...current, review: { ...current.review, substantiveDecisions: current.review.substantiveDecisions + 1, invocations: [...current.review.invocations, { invocationId: 'r3:other-window', candidateDigest: 'sha-0', candidateSha: 'sha-0', base: 'main', policyVersion: fx.config.reviewPolicyVersion, reviewer: 'fake-r3', requestedAt: fx.now(), outcome: 'pass' as const, runStatus: 'success' as const }] } };
    const realUpdate = fx.store.updateCardRun.bind(fx.store);
    let updates = 0;
    fx.store.updateCardRun = ((goalId: string, cardId: string, change: Parameters<typeof realUpdate>[2]) => {
      updates += 1;
      return realUpdate(goalId, cardId, updates === 1 ? (current) => change(older(current)) : change);
    }) as typeof fx.store.updateCardRun;
    try {
      await assert.rejects(() => runner.formalReview(g(), card, round.run), /run the command again/, 'the reservation lock sees the moved candidate');
    } finally {
      fx.store.updateCardRun = realUpdate;
    }
    let stored = fx.store.getCardRun(goal.id, 'T1-HO3')!;
    assert.equal(stored.preReview.handoffs.length, 1, 'the hand-off is R2 bookkeeping and stays');
    assert.ok(!stored.review.invocations.some((i) => i.outcome === 'pending'), 'nothing reserved');
    assert.equal(fx.queue.list(fx.config.reviewPool).filter((q) => q.requesters.includes(`${goal.id}:T1-HO3`) && q.state !== 'cancelled').length, 0, 'the pool request is cancelled');
    // Run again: the delta since sha-0 is above the cap and refuses before anything is recorded; the hand-off is not recorded twice.
    await assert.rejects(() => runner.formalReview(g(), card, stored), /bytes[\s\S]*formalReview\.maxDiffBytes[\s\S]*100/, 'the recollected delta is capped');
    stored = fx.store.getCardRun(goal.id, 'T1-HO3')!;
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED' && e.data['exhausted'] === true).length, 1, 'one hand-off event in total');
    assert.ok(!stored.review.invocations.some((i) => i.outcome === 'pending'), 'nothing reserved by the refused review');
    const f = await mk(1000).formalReview(g(), card, stored);
    assert.equal(f.classified.outcome, 'pass');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-INPUTS R3 decision 2 (F6 re-raised, F10): a ship-path decision whose document names no policy_hash is bound to the policy in force at dispatch, and its findings are marked against the delta since the formal stage last reviewed candidate: on the identical sha every new finding is a first-round miss', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const policy = '# Review instructions\nMust-block 1-6.\n';
    writeFileSync(path.join(fx.repo.mainRoot, 'REVIEW.md'), policy, 'utf8');
    const hash = createHash('sha256').update(policy, 'utf8').digest('hex');
    const script = scriptedRunner({ 'git diff --name-only': { stdout: 'src/t1-sd.ts\n' }, 'git diff': { stdout: 'diff --git a/src/t1-sd.ts b/src/t1-sd.ts\n+export const sd = 1;\n' }, 'fake-r2': () => ({ stdout: R2_PASS }), 'fake-r3': () => ({ stdout: R3_PASS }) });
    // The ship path's own reviewer wrote a block on the same sha the command decision passed: another document, a second decision.
    const reason = '[standards] 9 error handling @ src/t1-sd.ts:9: swallowed error -> rethrow';
    const shipDoc: Verdict = { verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: [reason] } }, run_status: 'success' };
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['review-blocked'], shipDoc), now: fx.now, runner: script });
    const s = cardAtShip(fx, runner, 'T1-SD');
    const { card, g, goal } = s;
    let r = runner.next(g(), card, (await runner.preReview(g(), card, s.run)).run);
    assert.equal(r.directive.kind, 'review');
    const f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(f.run.review.invocations.at(-1)?.policyHash, hash, 'the command decision carries the hash of the policy it applied');
    assert.deepEqual(runner.shipBindings(f.run), { policyHash: hash, deltaPaths: [] }, 'the ship is bound at dispatch to the policy in force and to the empty delta of the same commit');
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'stop', `the ship path's own block is the second decision on the same sha, the last of the allowance: ${r.directive.narration}`);
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'review');
    const decided = r.run.review.invocations.filter((i) => i.outcome === 'pass' || i.outcome === 'block');
    assert.equal(decided.length, 2);
    assert.equal(decided.at(-1)?.policyHash, hash, 'a document naming no policy_hash is bound to the policy in force at dispatch');
    assert.deepEqual(r.run.findings.map((x) => [x.id, x.stage, x.outsideDelta ?? false]), [['F1', 'formal', true]], 'a new finding on the identical sha is a first-round miss');
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').at(-1)?.data['policyHash'], hash);
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-INVARIANTS acceptance 3: the lessons of the main checkout reach every R2 angle and the R3 prompt, read with the other prompt inputs before the dispatch writes anything', async () => {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2', '--focus', '{perspective}', '{instructions}'], perspectives: ['bugs', 'security'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  const WRITES = ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'copyFileSync', 'unlinkSync', 'rmSync'] as const;
  const originals = new Map<string, unknown>(WRITES.map((name) => [name, (fs as unknown as Record<string, unknown>)[name]]));
  const realWrite = fs.writeFileSync;
  try {
    const R2_PASS = '{"verdict":"pass","reasons":[]}\n';
    const R3_PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
    const lessonsFile = path.join(fx.repo.mainRoot, 'docs', 'LESSONS.md');
    const NEVER = '- 2026-09-15 T0-SHIP-BASE-SYNC-2: NEVER let text from outside the producer reach the ship output raw (source: PR #18 review history)';
    const NOTE = '- 2026-09-14 T1-LOOP-RESUME: NOTE amend the card on main before the next round (source: PR #13 review history)';
    const LATE = '- 2026-09-18 T0-LATE: NEVER read the lessons once the dispatch has begun (source: this scenario)';
    const fixtureLessons = `## Lessons\n${NEVER}\n${NOTE}\n`;
    mkdirSync(path.dirname(lessonsFile), { recursive: true });
    writeFileSync(lessonsFile, fixtureLessons, 'utf8');
    const prompts: string[] = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-inv.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-inv.ts b/src/t1-inv.ts\n+export const inv = 1;\n' },
      'fake-r2': (args) => {
        prompts.push(args.at(-1) ?? '');
        return { stdout: R2_PASS };
      },
      'fake-r3': (args) => {
        prompts.push(args.at(-1) ?? '');
        return { stdout: R3_PASS };
      },
    });
    // R3 decision 1: the probe is the filesystem itself, not a chosen writer, so the dispatch's first write is whichever it
    // makes first: the verdict schema, the renewed lease, the pool request, the retained reservation or the card run. The
    // lessons file is rewritten at that write; a read that follows it sends `T0-LATE` to the reviewer and fails this test.
    let armed = false;
    let rewrites = 0;
    const onWrite = (): void => {
      if (!armed) return;
      armed = false;
      rewrites += 1;
      (realWrite as unknown as (...a: unknown[]) => void)(lessonsFile, `## Lessons\n${LATE}\n`, 'utf8');
    };
    for (const name of WRITES) {
      (fs as unknown as Record<string, unknown>)[name] = ((...args: unknown[]) => {
        onWrite();
        return (originals.get(name) as (...a: unknown[]) => unknown)(...args);
      }) as unknown;
    }
    syncBuiltinESMExports();
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-INV', title: 'learned invariants' });
    const goal = fx.controller.createGoal({ text: 'implement T1-INV', source: 'card', ref: 'T1-INV', affectedSurfaces: [] }, { cards: ['T1-INV'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-INV'] } });
    const card = fx.card('T1-INV');
    const g = () => fx.goal(goal.id);
    let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-INV'));
    const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    r = runner.next(g(), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);

    armed = true;
    const pre = await runner.preReview(g(), card, r.run);
    assert.equal(pre.result.outcome, 'pass');
    assert.equal(rewrites, 1, 'the R2 dispatch wrote, and the lessons file was rewritten at that write');
    assert.equal(prompts.length, 2, 'one prompt per angle');
    for (const prompt of prompts) {
      assert.ok(prompt.includes(JSON.stringify(NEVER)), `every R2 angle carries the learned invariant: ${prompt.slice(prompt.indexOf('## Learned invariants'), prompt.indexOf('## Card contract'))}`);
      assert.ok(!prompt.includes('T1-LOOP-RESUME'), 'a NOTE line is not a learned invariant');
      assert.ok(!prompt.includes('T0-LATE'), 'the line written at the first write of the dispatch never reached this dispatch');
    }

    writeFileSync(lessonsFile, fixtureLessons, 'utf8');
    r = runner.next(g(), card, pre.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    armed = true;
    const f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(rewrites, 2, 'the R3 dispatch rewrote it at its own first write');
    const r3Prompt = prompts.at(-1)!;
    assert.ok(r3Prompt.includes('formal reviewer (R3)'), 'the last prompt is the R3 one');
    assert.ok(r3Prompt.includes(JSON.stringify(NEVER)), `the R3 prompt carries the same invariants: ${r3Prompt.slice(r3Prompt.indexOf('## Learned invariants'), r3Prompt.indexOf('## Card contract'))}`);
    assert.ok(!r3Prompt.includes('T1-LOOP-RESUME') && !r3Prompt.includes('T0-LATE'), 'no NOTE line, and nothing written once the dispatch began');
  } finally {
    for (const name of WRITES) (fs as unknown as Record<string, unknown>)[name] = originals.get(name);
    syncBuiltinESMExports();
    fx.cleanup();
  }
});

test('T1-REVIEW-COVERAGE acceptance 5: in shadow the decided round, its journal event, its round document and the R2 summary carry the coverage join, and the round decides exactly as the same round with coverage off', async () => {
  const acceptance = ['1. the gate holds. [dod arm 1]', '2. the gate reports its reason. [dod arm 1]', '3. the gate is idempotent. [dod arm 1]'];
  // One passing angle that accounts for two of the three items (one of them violated, which its own pass contradicts) and
  // names an item outside the list; one angle that reports no list at all.
  const coverageVerdict = JSON.stringify({
    verdict: 'pass',
    reasons: [],
    coverage: [
      { item: 1, status: 'supported', impl: 'src/t1-cov.ts:4', test: 'tests/t1-cov.test.ts:9' },
      { item: 2, status: 'violated' },
      { item: 9, status: 'supported', impl: 'src/t1-cov.ts:40', test: 'tests/t1-cov.test.ts:40' },
    ],
  });
  const plain = '{"verdict":"pass","reasons":[]}';

  const round = async (coverage: 'off' | 'shadow') => {
    const fx = makeFixture({
      config: {
        preReview: { command: ['fake-reviewer', '{perspective}'], reviewer: 'fake', rounds: 2, timeoutMs: 1000, shell: false, perspectives: ['ac-coverage', 'edge-cases'], coverage },
        formalReview: { command: ['fake-r3'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false },
      },
    });
    const prompts: Record<string, string> = {};
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-cov.ts\n' },
      'git diff': { stdout: 'diff --git a/src/t1-cov.ts b/src/t1-cov.ts\n+export const cov = 1;\n' },
      'fake-reviewer ac-coverage': { stdout: coverageVerdict + '\n' },
      'fake-reviewer edge-cases': { stdout: plain + '\n' },
      'fake-r3': { stdout: plain + '\n' },
    });
    const runner = new CardRunner({
      paths: fx.paths,
      repo: fx.repo,
      config: fx.config,
      store: fx.store,
      leases: fx.leases,
      queue: fx.queue,
      ops: fx.ops,
      shipPath: new DryRunShipPath(['merged']),
      now: fx.now,
      // The reviewer process is the boundary: the prompt it receives is what the loop sent it.
      runner: (command, args, options) => {
        if (command !== 'git') prompts[[command, ...args].join(' ')] = String(options?.input ?? '');
        return script(command, args, options);
      },
    });
    writeCard(fx, { id: 'T1-COV', title: 'gate the ship', acceptance });
    const goal = fx.controller.createGoal({ text: 'implement T1-COV', source: 'card', ref: 'T1-COV', affectedSurfaces: [] }, { cards: ['T1-COV'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-COV'] } });
    const card = fx.card('T1-COV');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-COV'));
    const built = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: 'sha-1' });
    r = runner.next(fx.goal(goal.id), card, built);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    const decided = await runner.preReview(fx.goal(goal.id), card, r.run);
    const formal = await runner.formalReview(fx.goal(goal.id), card, decided.run);
    const event = fx.events(goal.id).filter((e) => e.type === 'PRE_REVIEW_DECIDED').at(-1)!;
    const document = JSON.parse(readFileSync(decided.result.verdictRef!, 'utf8')) as Record<string, unknown>;
    return { fx, decided, formal, event, document, prompts };
  };

  const shadow = await round('shadow');
  const off = await round('off');
  try {
    const expected = { expected: 3, accounted: 2, unaccounted: [3], conflicted: [], inconsistent: [2], malformed: 1, angles: ['ac-coverage'] };
    assert.deepEqual(shadow.decided.round.coverage, expected, 'the round record carries the join');
    assert.deepEqual(shadow.event.data['coverage'], expected, 'the decision event carries it');
    assert.deepEqual(shadow.document['coverage'], expected, 'the round document next to the candidate carries it');
    assert.deepEqual(shadow.decided.result.coverage, expected, 'the panel returns it');
    assert.equal(off.decided.round.coverage, undefined, 'with coverage off the round record carries none');
    assert.equal(off.event.data['coverage'], undefined, 'and the event carries none');
    assert.equal(off.document['coverage'], undefined, 'and the round document carries none');

    // The summary names what the round accounted for and the items it did not, and says nothing when none was asked for.
    const summaryOf = (r: typeof shadow) =>
      cli.preReviewSummaryText(
        { reviewer: r.decided.round.reviewer, round: r.decided.round.round, maxRounds: 2, cycle: r.decided.round.cycle, outcome: r.decided.result.outcome, runStatus: r.decided.result.runStatus, durationMs: r.decided.result.durationMs, perspectives: ['ac-coverage:pass', 'edge-cases:pass'], reasons: r.decided.result.reasons, advisory: [], coverage: r.decided.round.coverage, state: r.decided.run.state },
        'T1-COV',
      );
    assert.match(summaryOf(shadow), /coverage: 2\/3 accounted; unaccounted 3; inconsistent 2/, summaryOf(shadow));
    // The `ac-coverage` angle is named in every summary; what the off round prints is no coverage line of its own.
    assert.ok(!/\n\s*coverage: /.test(summaryOf(off)) && !summaryOf(off).includes('accounted'), summaryOf(off));

    // Nothing else about the round differs: the same outcome, the same findings, the same prompts to the other angle and to
    // R3, and the same allowances.
    assert.equal(shadow.decided.result.outcome, 'pass');
    assert.equal(shadow.decided.result.outcome, off.decided.result.outcome);
    assert.deepEqual(shadow.decided.result.reasons, off.decided.result.reasons);
    assert.deepEqual(shadow.decided.run.findings, off.decided.run.findings);
    assert.equal(shadow.decided.run.state, off.decided.run.state);
    assert.deepEqual(shadow.decided.run.review, off.decided.run.review, 'the review allowances are untouched');
    assert.deepEqual(shadow.decided.run.effort?.attempts, off.decided.run.effort?.attempts, 'no attempt is spent either way');
    assert.equal(shadow.decided.run.preReview.rounds.length, off.decided.run.preReview.rounds.length);
    const prompt = (r: typeof shadow, key: string) => (r.prompts[key] ?? '').split(r.decided.run.worktree ?? '<none>').join('<worktree>');
    assert.equal(prompt(shadow, 'fake-r3'), prompt(off, 'fake-r3'), 'the R3 prompt is the one coverage off builds');
    assert.equal(prompt(shadow, 'fake-reviewer edge-cases'), prompt(off, 'fake-reviewer edge-cases'), 'the other angle is asked exactly what it was asked before');
    assert.ok(prompt(shadow, 'fake-reviewer ac-coverage').includes('"coverage":[{"item":1'), 'the ac-coverage angle is the one asked');
    assert.ok(!prompt(off, 'fake-reviewer ac-coverage').includes('"coverage"'), 'and it is asked nothing with coverage off');
    assert.equal(shadow.formal.classified.outcome, off.formal.classified.outcome, 'R3 decides the same');
  } finally {
    shadow.fx.cleanup();
    off.fx.cleanup();
  }
});

test('T0-WORKTREE-ROOT-DEFAULT: an empty worktreeRoot places a dry-run PREPARE under <platform root>/<checkout name>/<card>, and creates nothing there', () => {
  const fx = makeFixture({ config: { worktreeRoot: '' } });
  try {
    writeCard(fx, { id: 'T1-ROOT', title: 'per-repository worktree root' });
    const goal = goalForCards(fx, ['T1-ROOT']);
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const r = runner.next(goal, fx.card('T1-ROOT'), fx.controller.ensureCardRun(goal, 'T1-ROOT'));
    assert.equal(r.directive.kind, 'prepare');
    const worktree = r.run.worktree ?? '';
    assert.deepEqual(worktree.split(path.sep).slice(-3), [process.platform === 'win32' ? 'wt' : '.wt', path.basename(fx.tmp), 'T1-ROOT'], 'the last three segments are the platform root name, the checkout name and the card id');
    assert.equal(worktree, path.join(resolveWorktreeRoot(fx.config, fx.repo.mainRoot), 'T1-ROOT'));
    assert.ok(!existsSync(path.dirname(worktree)), 'dry-run PREPARE never creates the directory');
  } finally {
    fx.cleanup();
  }
});

test('T1-REVIEW-LOOP-GUARDS acceptance 1: a success attempt on a tdd card without a RED receipt is refused and records nothing; with the receipt, on a tdd: false card, or on a run that holds one it is accepted', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-NORED', title: 'success without a RED receipt' });
    writeCard(fx, { id: 'T1-NOTDD', title: 'a card exempt from RED', tdd: false });
    writeCard(fx, { id: 'T1-HASRED', title: 'a run that already holds RED' });
    const goal = goalForCards(fx, ['T1-NORED', 'T1-NOTDD', 'T1-HASRED']);
    const runner = fx.runner(new DryRunShipPath(['merged']));
    const toBuild = (id: string): CardRun => {
      const card = fx.card(id);
      const r = runner.next(goal, card, fx.controller.ensureCardRun(goal, id));
      return runner.next(goal, card, r.run).run;
    };

    const card = fx.card('T1-NORED');
    let run = toBuild('T1-NORED');
    run = runner.recordAttempt(goal, card, run, { outcome: 'fail', cause: 'red first' });
    assert.equal(run.effort?.attempts.at(-1)?.outcome, 'fail', 'a failed attempt needs no RED receipt');
    run = runner.next(goal, card, run).run;
    const before = fx.store.getCardRun(goal.id, 'T1-NORED')!;
    assert.throws(() => runner.recordAttempt(goal, card, run, { outcome: 'success', dodReceipt: 'dod:1', candidateSha: 'sha-1' }), /RED receipt/);
    const after = fx.store.getCardRun(goal.id, 'T1-NORED')!;
    assert.deepEqual(after, before, 'the refused success leaves the stored run unchanged');
    assert.deepEqual(after.effort, before.effort, 'the effort episode is unchanged');
    assert.equal(after.candidate, before.candidate, 'no candidate is bound');
    assert.equal(after.dodReceipt, undefined);
    const accepted = runner.recordAttempt(goal, card, after, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:2', candidateSha: 'sha-2' });
    assert.equal(accepted.effort?.terminal, 'succeeded');
    assert.equal(accepted.redReceipt, 'red:2');
    assert.equal(accepted.candidate?.sha, 'sha-2');

    const noTdd = runner.recordAttempt(goal, fx.card('T1-NOTDD'), toBuild('T1-NOTDD'), { outcome: 'success', dodReceipt: 'dod:1', candidateSha: 'sha-1' });
    assert.equal(noTdd.effort?.terminal, 'succeeded', 'a tdd: false card records a success without a RED receipt');

    const hasCard = fx.card('T1-HASRED');
    const stale = toBuild('T1-HASRED');
    let has = runner.recordAttempt(goal, hasCard, stale, { outcome: 'fail', cause: 'green pending', redReceipt: 'red:held' });
    has = runner.next(goal, hasCard, has).run;
    assert.equal(has.redReceipt, 'red:held');
    assert.equal(stale.redReceipt, undefined);
    has = runner.recordAttempt(goal, hasCard, stale, { outcome: 'success', dodReceipt: 'dod:1', candidateSha: 'sha-1' });
    assert.equal(has.effort?.terminal, 'succeeded', 'a stored run that already holds a RED receipt records a success without a new one, whatever the caller snapshot says');
    assert.equal(has.redReceipt, 'red:held');
  } finally {
    fx.cleanup();
  }
});

/** A dry-run ship path whose receipt exits with `exitCode` and carries `text` on one stream (T0-QUOTA-FALSE-HOLD). */
class StreamShipPath extends DryRunShipPath {
  private readonly stream: 'stdout' | 'stderr';
  private readonly text: string;
  private readonly exitCode: number | null;
  constructor(outcomes: ShipOutcomeClass[], stream: 'stdout' | 'stderr', text: string, exitCode: number | null) {
    super(outcomes);
    this.stream = stream;
    this.text = text;
    this.exitCode = exitCode;
  }
  override ship(req: ShipRequest): ShipResult {
    const r = super.ship(req);
    return { ...r, receipt: { ...r.receipt, exitCode: this.exitCode, [this.stream]: this.text } };
  }
}

test('T0-QUOTA-FALSE-HOLD acceptance 3: a ship receipt that exits 0 with no verdict and a quota word on stdout is a no-verdict that takes the retry; on stderr, or on stdout of a non-zero exit, it is a quota hold', () => {
  // Reviewer reasoning that names the whole word, so only the stream rule (R3) can tell these cases apart.
  const text = 'reasoning: the quota hold rule is unchanged\n';
  const cases: Array<['stdout' | 'stderr', number | null, 'no-verdict' | 'quota-hold']> = [
    ['stdout', 0, 'no-verdict'],
    ['stderr', 0, 'quota-hold'],
    ['stdout', 1, 'quota-hold'],
    ['stdout', null, 'quota-hold'], // killed by a signal: no exit code, so not an exit 0 (R3 decision 1 F2)
  ];
  for (const [stream, exitCode, expected] of cases) {
    const fx = makeFixture();
    try {
      writeCard(fx, { id: 'T0-QH', title: 'quota hold on the ship path' });
      const goal = goalForCards(fx, ['T0-QH']);
      const ship = new StreamShipPath(['review-no-verdict', 'merged'], stream, text, exitCode);
      const runner = fx.runner(ship);
      const card = fx.card('T0-QH');
      let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T0-QH'));
      r = runner.next(fx.goal(goal.id), card, r.run);
      const run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T0-QH') });
      r = runner.next(fx.goal(goal.id), card, run);
      const label = `${stream}, exit ${exitCode}`;
      assert.equal(ship.requests.length, 1, label);
      assert.deepEqual(r.run.review.invocations.map((i) => i.outcome), [expected], label);
      assert.equal(r.run.review.noVerdictRetriesUsed, expected === 'no-verdict' ? 1 : 0, label);
      // Held: the review pool slot is held for the reviewer's quota; a no-verdict completes it and re-runs the same ship.
      assert.equal(fx.events(goal.id).some((e) => e.type === 'REVIEW_HOLD'), expected === 'quota-hold', label);
      if (expected === 'no-verdict') assert.equal(r.directive.kind, 'ship', `${label}: ${r.directive.narration}`);
    } finally {
      fx.cleanup();
    }
  }
});

/** A dry-run ship path whose receipt exits 0 with the given stderr per call (empty past the list); `onShip` runs at dispatch. */
class StderrShipPath extends DryRunShipPath {
  private readonly stderrs: string[];
  onShip: ((req: ShipRequest) => void) | undefined;
  constructor(outcomes: ShipOutcomeClass[], stderrs: string[]) {
    super(outcomes);
    this.stderrs = stderrs;
  }
  override ship(req: ShipRequest): ShipResult {
    this.onShip?.(req);
    const r = super.ship(req);
    return { ...r, receipt: { ...r.receipt, exitCode: 0, stderr: this.stderrs[this.requests.length - 1] ?? '' } };
  }
}

/** A T0 card driven to its first ship; the ship path answers with the scripted outcomes and stderr. */
function shipOnce(fx: ReturnType<typeof makeFixture>, ship: DryRunShipPath) {
  writeCard(fx, { id: 'T0-SQW', title: 'quota hold on the ship path waits' });
  const goal = goalForCards(fx, ['T0-SQW']);
  const runner = fx.runner(ship);
  const card = fx.card('T0-SQW');
  const g = () => fx.goal(goal.id);
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T0-SQW'));
  r = runner.next(g(), card, r.run);
  const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T0-SQW') });
  const deadline = run.deadline;
  r = runner.next(g(), card, run);
  return { goal, runner, card, g, r, deadline };
}

test('T0-SHIP-QUOTA-WAIT acceptance 1: a review-no-verdict ship result that exits 0 with 429 Too Many Requests on stderr waits on review-quota, is not STOP, spends no retry or decision and journals REVIEW_HOLD', () => {
  const fx = makeFixture();
  try {
    const ship = new StderrShipPath(['review-no-verdict', 'merged'], ['429 Too Many Requests\n']);
    const { goal, r, deadline } = shipOnce(fx, ship);
    assert.equal(ship.requests.length, 1);
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    if (r.directive.kind === 'wait') {
      assert.equal(r.directive.on, 'review-quota');
      assert.equal(r.directive.pollSeconds, 15 * 60, 'poll when the 15-minute pool hold ends');
    }
    const persisted = fx.store.getCardRun(goal.id, 'T0-SQW')!;
    for (const run of [r.run, persisted]) {
      assert.equal(run.state, 'WAIT');
      assert.equal(run.stop, undefined);
      assert.deepEqual(run.review.invocations.map((i) => i.outcome), ['quota-hold']);
      assert.equal(run.review.noVerdictRetriesUsed, 0, 'a quota hold spends no no-verdict retry');
      assert.equal(run.review.substantiveDecisions, 0, 'a quota hold is not a decision');
      assert.equal(run.deadline, deadline, 'the hold never extends the card deadline');
    }
    assert.equal(fx.events(goal.id).filter((e) => e.type === 'REVIEW_HOLD').length, 1);
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-QUOTA-WAIT acceptance 2: once the hold has passed, card next issues the ship again for the same candidate and a merge closes the card; before that it ships nothing', () => {
  const fx = makeFixture();
  try {
    const ship = new StderrShipPath(['review-no-verdict', 'merged'], ['429 Too Many Requests\n']);
    const { goal, runner, card, g, r: held, deadline } = shipOnce(fx, ship);
    // `card next` dispatches the ship within the call: the run as stored at that dispatch is the observation of the issued
    // ship, apart from the merge result the same call then applies.
    const dispatched: Array<{ candidateSha?: string; stopped: boolean; noVerdictRetriesUsed?: number; substantiveDecisions?: number }> = [];
    ship.onShip = (req) => {
      const at = fx.store.getCardRun(goal.id, 'T0-SQW');
      dispatched.push({ candidateSha: req.candidateSha, stopped: at?.stop !== undefined, noVerdictRetriesUsed: at?.review.noVerdictRetriesUsed, substantiveDecisions: at?.review.substantiveDecisions });
    };
    fx.advance(14 * 60_000);
    let r = runner.next(g(), card, held.run);
    assert.equal(r.directive.kind, 'wait', `still held: ${r.directive.narration}`);
    assert.equal(ship.requests.length, 1, 'no ship while the hold stands');
    assert.deepEqual(dispatched, []);
    fx.advance(2 * 60_000);
    r = runner.next(g(), card, r.run);
    assert.equal(ship.requests.length, 2, `the hold passed, so the ship is issued again: ${r.directive.narration}`);
    assert.deepEqual(dispatched, [{ candidateSha: candidateShaFor('T0-SQW'), stopped: false, noVerdictRetriesUsed: 0, substantiveDecisions: 0 }], 'card next issued the ship for the same candidate, not stopped, with no retry or decision spent');
    assert.equal(ship.requests[1]!.candidateSha, ship.requests[0]!.candidateSha, 'the same candidate');
    // The merge result of that ship then closes the card.
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    assert.equal(r.run.state, 'CLOSE');
    assert.equal(r.run.mergeVerified, true);
    assert.equal(r.run.deadline, deadline, 'the hold never extends the card deadline');
    assert.equal(r.run.review.noVerdictRetriesUsed, 0);
    assert.equal(r.run.review.substantiveDecisions, 0);
    assert.equal(fx.store.getCardRun(goal.id, 'T0-SQW')!.state, 'CLOSE');
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-QUOTA-WAIT acceptance 3: a review-no-verdict ship result that exits 0 without a quota message on stderr still takes the single retry, then STOP/review', () => {
  const fx = makeFixture();
  try {
    const ship = new StderrShipPath(['review-no-verdict', 'review-no-verdict'], ['connection reset by peer\n', 'connection reset by peer\n']);
    const { goal, runner, card, g, r: first } = shipOnce(fx, ship);
    assert.equal(first.directive.kind, 'ship', first.directive.narration);
    assert.equal(first.run.review.noVerdictRetriesUsed, 1);
    const r = runner.next(g(), card, first.run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.stop?.reason, 'review');
    assert.equal(r.run.stop?.detail, 'missing/malformed/stale verdict after the single retry');
    assert.equal(r.run.review.noVerdictRetriesUsed, 2);
    assert.equal(ship.requests.length, 2);
    assert.equal(fx.events(goal.id).some((e) => e.type === 'REVIEW_HOLD'), false);
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-QUOTA-WAIT acceptance 4: docs/OPERATIONS.md and the CHANGELOG Unreleased section state that a ship-path quota hold is WAIT on review-quota', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  const docSentences = [
    'A `review-no-verdict` ship outcome whose receipt carries a quota message is a quota hold on the ship path as well: the ship returns a `wait` directive on `review-quota`, holds the review pool for 15 minutes, leaves the card out of STOP and spends neither the no-verdict retry nor a substantive decision (card T0-SHIP-QUOTA-WAIT).',
    'While the hold stands, `aidlc card next` waits on the held pool and ships nothing; once it has passed, `aidlc card next` ships the same candidate again, and the hold never extends the card deadline.',
  ];
  for (const sentence of docSentences) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  const changelogSentences = [
    '- Ship-path quota hold, card T0-SHIP-QUOTA-WAIT: a `review-no-verdict` ship outcome whose receipt carries a quota message now returns a `wait` directive on `review-quota` until the 15-minute review-pool hold passes, and the next `aidlc card next` after it ships the same candidate again; the card used to stop with STOP/review and `missing/malformed/stale verdict after the single retry`, although the pool was held and no retry or decision had been spent.',
    'A `review-no-verdict` ship outcome without a quota message still takes the single retry and then STOP/review (docs/OPERATIONS.md).',
  ];
  for (const sentence of changelogSentences) assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
});
