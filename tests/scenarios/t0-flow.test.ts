import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, driveCardToDone, candidateShaFor, InjectedShipPath, T0 } from './_harness.ts';
import { DryRunShipPath, ScaffoldShipPath } from '../../src/delivery/ship.ts';
import { DEFAULT_LEASE_TTL_MS, FencedError, resourceKeys } from '../../src/coordination/lease.ts';
import { CardRun, addMs, type Verdict } from '../../src/core/types.ts';
import { makeStop } from '../../src/core/stop.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actorA, actorB } from './_harness.ts';
import fs, { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { CardRunner, hasConflictDiagnostic } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { countedFailures } from '../../src/core/effort.ts';
import { atomicWriteJson } from '../../src/state/store.ts';
import { acceptFinding } from '../../src/core/review-policy.ts';
import { RECONCILE_GRACE_MS } from '../../src/core/types.ts';

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
    // The resumed state is persisted: a ship reads the record as persisted, and a stop saved there wins over the caller's copy.
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
    assert.throws(() => runner.next(g(), card, stale), /changed|re-run|run the command again/i, 'the stale write is refused instead of dropping the reservation');
    assert.equal(fx.store.getCardRun(goal.id, 'T1-STALE')?.preReview.rounds.length, 1, 'the reservation survives');
    // A stale write that lacks a decided round is refused the same way.
    fx.store.updateCardRun(goal.id, 'T1-STALE', (current) => ({ ...current!, preReview: { ...current!.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: 'sha-1', candidateSha: 'sha-1', requestedAt: fx.now(), durationMs: 5, outcome: 'pass', reasons: [], reservationId: 'res-1' }] } }));
    assert.throws(() => runner.disputeFinding(g(), card, stale, 'F1', 'x'), /F1|changed/);
    assert.throws(() => runner.next(g(), card, stale), /changed|re-run|run the command again/i);
    assert.equal(fx.store.getCardRun(goal.id, 'T1-STALE')?.preReview.rounds[0]?.outcome, 'pass');
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
      'fake-r3': () => { dispatched += 1; onDispatch?.(); return { stdout: r3.shift() ?? R3_PASS }; },
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
    // (2) The retention itself fails (the log cannot be written), so the dispatch throws with no receipt behind it, and the
    // lock is held again: the failure is retained as a marker and the reservation is released by the next command.
    const realWrite = fs.writeFileSync;
    (fs as unknown as Record<string, unknown>)['writeFileSync'] = ((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(file).endsWith('.log') && String(file).includes('T1-TH.r3.')) {
        held();
        const err = new Error('EACCES: permission denied, open') as NodeJS.ErrnoException;
        err.code = 'EACCES';
        throw err;
      }
      return (realWrite as unknown as (...a: unknown[]) => void)(file, ...rest);
    }) as typeof fs.writeFileSync;
    syncBuiltinESMExports();
    try {
      await assert.rejects(() => runner.formalReview(g(), card, persisted), /EACCES/);
    } finally {
      (fs as unknown as Record<string, unknown>)['writeFileSync'] = realWrite;
      syncBuiltinESMExports();
      rmSync(lock, { force: true });
    }
    assert.equal(dispatched, 2);
    persisted = fx.store.getCardRun(goal.id, 'T1-TH')!;
    assert.ok(persisted.review.invocations.some((i) => i.outcome === 'pending'), 'the release at the time was refused by the held lock');
    const passed = await runner.formalReview(g(), card, persisted);
    assert.equal(passed.classified.outcome, 'pass');
    assert.equal(dispatched, 3, 'the failed dispatch is released and redone, once');
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
      'fake-r3': () => { dispatched += 1; onDispatch?.(); return { stdout: r3.shift() ?? R3_PASS }; },
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
