import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyShipOutput, DryRunShipPath, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { CardRunner, type CardDirective } from '../../src/loop/card-runner.ts';
import { finishAttempt, nextEffortAction, startAttempt } from '../../src/core/effort.ts';
import { reopenEpisode } from '../../src/loop/card-runner.ts';
import { scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import type { CardRun, EffortEpisode } from '../../src/core/types.ts';
import { makeFixture, writeCard } from './_harness.ts';
import { cleanup } from '../infra/helpers.ts';

const T = '2026-09-11T00:00:00.000Z';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const REASON = '[spec] 6 tests missing @ src/t0-dra.ts: the empty input is not covered -> add a case for it';
const BLOCK = JSON.stringify({ verdict: 'block', reasons: [REASON], axes: { spec: { verdict: 'block', reasons: [REASON] }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';

type ShipStep = 'base-sync-merged' | 'red-missing' | 'dod-failed';
/** A ship path whose ships end, in order, with a committed CHANGELOG base-sync merge or a rejected RED receipt. */
class StepShipPath extends DryRunShipPath {
  private readonly steps: ShipStep[];
  constructor(steps: ShipStep[]) {
    super(['merged']);
    this.steps = [...steps];
  }
  override ship(req: ShipRequest): ShipResult {
    const step = this.steps.shift();
    if (!step) return super.ship(req);
    this.requests.push(req);
    const now = new Date().toISOString();
    const stdout =
      step === 'base-sync-merged'
        ? ['Auto-merging CHANGELOG.md', 'CONFLICT (content): Merge conflict in CHANGELOG.md', 'Automatic merge failed; fix conflicts and then commit the result.', `[SHIP-BASE-SYNC-MERGED] refs/remotes/origin/main conflicted with HEAD ${req.candidateSha ?? 'unknown'} only in entries both sides added to the Unreleased section of CHANGELOG.md; merged by keeping both, the card's first, as ${'c'.repeat(40)}`, '[SAGA-FAIL]'].join('\n')
        : step === 'red-missing'
          ? ['[TD85-RESUME] RED receipt rejected', '[SAGA-FAIL]'].join('\n')
          : ['not ok 3 - parses the header', 'DoD 未通过（退出码 1）。修绿再 ship。', '[SAGA-FAIL]'].join('\n');
    return classifyShipOutput({ command: 'dry-run', args: [req.cardId], cwd: '', exitCode: 1, signal: null, timedOut: false, stdout, stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '' });
  }
}

/** A card with R2 (three rounds, a stop when they are exhausted) and R3, fed from answer queues; the R2 prompts are kept. */
function setup(steps: ShipStep[] = []) {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  const r2: string[] = [];
  const r3: string[] = [];
  const prompts: string[] = [];
  const script = scriptedRunner({
    'git diff --name-only': { stdout: 'src/t0-dra.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t0-dra.ts b/src/t0-dra.ts\n+export const dra = 1;\n' },
    'fake-r2': () => ({ stdout: r2.shift() ?? PASS }),
    'fake-r3': () => ({ stdout: r3.shift() ?? PASS }),
  });
  const recording: SyncRunner = (command, args, options) => {
    if (command === 'fake-r2') prompts.push(options?.input ?? '');
    return script(command, args, options);
  };
  const ship = new StepShipPath(steps);
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: recording });
  writeCard(fx, { id: 'T0-DRA', title: 'dispute and running attempt', allowPaths: ['src/t0-dra.ts'] });
  const goal = fx.controller.createGoal({ text: 'implement T0-DRA', source: 'card', ref: 'T0-DRA', affectedSurfaces: [] }, { cards: ['T0-DRA'] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T0-DRA'] } });
  const card = fx.card('T0-DRA');
  const g = () => fx.goal(goal.id);
  const first = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T0-DRA'));
  /** Record `sha` as a successful attempt and return the gate's directive after it. */
  const record = (run: CardRun, sha: string) => runner.next(g(), card, runner.recordAttempt(g(), card, run, { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha }));
  /** Put a running attempt on the stored episode, as a run persisted before card T0-DISPUTE-RUNNING-ATTEMPT holds one. */
  const legacyRunning = (): CardRun =>
    fx.store.updateCardRun(goal.id, 'T0-DRA', (current) => {
      const run = current!;
      const episode = reopenEpisode(run.effort)!;
      return { ...run, effort: startAttempt(episode, 'medium', T) };
    });
  /** Another runner over the same stores with a changed configuration. */
  const runnerWith = (config: typeof fx.config) => new CardRunner({ paths: fx.paths, repo: fx.repo, config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: recording });
  return { fx, runner, runnerWith, ship, card, g, goalId: goal.id, first, record, legacyRunning, r2, r3, prompts };
}
type Setup = ReturnType<typeof setup>;

/** R2 blocks sha-1, BUILD opens the repair attempt, and F1 is disputed: the gate's answer after the dispute. */
async function blockOpenDispute(s: Setup) {
  let r = s.record(s.first.run, 'sha-1');
  assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
  s.r2.push(BLOCK);
  const blocked = await s.runner.preReview(s.g(), s.card, r.run);
  assert.equal(blocked.result.outcome, 'block');
  r = s.runner.next(s.g(), s.card, blocked.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  const opened = r.run.effort!.attempts.find((a) => a.outcome === 'running');
  assert.ok(opened, 'BUILD opened the repair attempt');
  // The ladder's step before the dispute, with the opened attempt set aside.
  const before = nextEffortAction(reopenEpisode({ ...r.run.effort!, attempts: r.run.effort!.attempts.filter((a) => a.outcome !== 'running') })!, { harderProblem: true, limitsPermit: true });
  const disputed = s.runner.disputeFinding(s.g(), s.card, r.run, 'F1', 'src/t0-dra.test.ts covers the empty input at line 12');
  r = s.runner.next(s.g(), s.card, disputed);
  return { r, opened, before };
}

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 1: the sequence of issue 106: the dispute settles the repair attempt BUILD opened, and the later base-sync merge records its repair [R1] [R2]', async () => {
  const s = setup(['base-sync-merged']);
  try {
    const { r, opened, before } = await blockOpenDispute(s);
    assert.equal(r.directive.kind, 'pre-review', `the unchanged candidate goes back to R2: ${r.directive.narration}`);
    const episode = r.run.effort!;
    assert.deepEqual(episode.attempts.filter((a) => a.outcome === 'running'), [], 'no attempt stays running');
    const settled = episode.attempts.find((a) => a.n === opened!.n)!;
    assert.deepEqual([settled.outcome, settled.notCountedReason], ['not-counted', 'review-disputed']);
    assert.equal(episode.terminal, 'succeeded', 'the success that bound the candidate stands');
    const finished = s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED').at(-1)!;
    assert.deepEqual([finished.data['n'], finished.data['outcome'], finished.data['reason']], [opened!.n, 'not-counted', 'review-disputed']);
    // The ladder's next step is what it was before the dispute: the same effort, the same evaluated attempts.
    const after = nextEffortAction(reopenEpisode(episode)!, { harderProblem: true, limitsPermit: true });
    assert.equal(after.action, 'attempt');
    assert.equal(before.action, 'attempt');
    if (after.action === 'attempt' && before.action === 'attempt') assert.equal(after.effort, before.effort);
    assert.equal(episode.attempts.filter((a) => a.outcome === 'success' || a.outcome === 'fail').length, 1, 'one evaluated attempt, as before the dispute');

    // R2 and R3 pass on the unchanged candidate; the ship's base sync commits a CHANGELOG merge: the repair is recorded.
    const passed = await s.runner.preReview(s.g(), s.card, r.run);
    assert.equal(passed.result.outcome, 'pass');
    let next = s.runner.next(s.g(), s.card, passed.run);
    assert.equal(next.directive.kind, 'review', next.directive.narration);
    next = s.runner.next(s.g(), s.card, (await s.runner.formalReview(s.g(), s.card, next.run)).run);
    assert.equal(next.directive.kind, 'build', `the merge is the repair to record, never a throw: ${next.directive.narration}`);
    assert.equal(next.run.pendingRepair?.kind, 'merge-conflict');
    // Nothing runs: the repair is the next attempt, never the settled one.
    if (next.directive.kind === 'build') assert.equal(next.directive.attempt, 2);
    // One more `card next` opens the repair: a new record, never the settled one, named by its ladder number.
    const repair = s.runner.next(s.g(), s.card, next.run);
    const repairRecord = repair.run.effort!.attempts.find((a) => a.outcome === 'running')!;
    assert.equal(repairRecord.n, 3);
    assert.notEqual(repairRecord.n, opened!.n);
    assert.deepEqual([buildOf(repair).attempt, buildOf(repair).narration], [2, WITH_RED('Attempt 2 (record 3 of this run; 1 not counted)', MERGE_CONFLICT_PREFIX)]);
  } finally {
    s.fx.cleanup();
  }
});

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 1: a terminal episode keeps its running attempt when the dispute sends the candidate back, and nothing is journaled [R1]', async () => {
  const s = setup();
  try {
    let r = s.record(s.first.run, 'sha-1');
    s.r2.push(BLOCK);
    const blocked = await s.runner.preReview(s.g(), s.card, r.run);
    r = s.runner.next(s.g(), s.card, blocked.run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    // A ladder stop recorded meanwhile (as T0-RUNNING-REPAIR-STOP leaves one): the episode is terminal with the repair running.
    const stopped = s.fx.store.updateCardRun(s.goalId, 'T0-DRA', (current) => ({ ...current!, effort: { ...current!.effort!, terminal: 'exhausted' } }));
    const finishedBefore = s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED').length;
    const disputed = s.runner.disputeFinding(s.g(), s.card, stopped, 'F1', 'src/t0-dra.test.ts covers the empty input at line 12');
    r = s.runner.next(s.g(), s.card, disputed);
    const stored = s.fx.store.getCardRun(s.goalId, 'T0-DRA')!;
    assert.equal(stored.effort!.terminal, 'exhausted', 'the terminal is kept');
    assert.equal(stored.effort!.attempts.filter((a) => a.outcome === 'running').length, 1, 'a terminal episode takes no record');
    assert.equal(s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED').length, finishedBefore, 'nothing is journaled as settled');
  } finally {
    s.fx.cleanup();
  }
});

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 1: a disputed R3 block settles the review-fix repair the same way, and decision 2 runs on the unchanged candidate [R1]', async () => {
  const s = setup();
  try {
    let r = s.record(s.first.run, 'sha-1');
    r = s.runner.next(s.g(), s.card, (await s.runner.preReview(s.g(), s.card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    s.r3.push(BLOCK);
    r = s.runner.next(s.g(), s.card, (await s.runner.formalReview(s.g(), s.card, r.run)).run);
    assert.equal(r.directive.kind, 'build', `the block is a review-fix repair: ${r.directive.narration}`);
    const opened = r.run.effort!.attempts.find((a) => a.outcome === 'running')!;
    const disputed = s.runner.disputeFinding(s.g(), s.card, r.run, 'F1', 'src/t0-dra.test.ts covers the empty input at line 12');
    r = s.runner.next(s.g(), s.card, disputed);
    assert.equal(r.directive.kind, 'review', `decision 2 on the unchanged candidate: ${r.directive.narration}`);
    const settled = r.run.effort!.attempts.find((a) => a.n === opened.n)!;
    assert.deepEqual([settled.outcome, settled.notCountedReason], ['not-counted', 'review-disputed']);
    assert.equal(r.run.effort!.terminal, 'succeeded');
    const finished = s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED').at(-1)!;
    assert.deepEqual([finished.data['n'], finished.data['reason']], [opened.n, 'review-disputed']);
  } finally {
    s.fx.cleanup();
  }
});

test('a dispute accepted after the gate settled the repair reopens the episode: the repair gets an attempt and can be recorded', async () => {
  const s = setup();
  try {
    let r = s.record(s.first.run, 'sha-1');
    r = s.runner.next(s.g(), s.card, (await s.runner.preReview(s.g(), s.card, r.run)).run);
    s.r3.push(BLOCK);
    r = s.runner.next(s.g(), s.card, (await s.runner.formalReview(s.g(), s.card, r.run)).run);
    r = s.runner.next(s.g(), s.card, s.runner.disputeFinding(s.g(), s.card, r.run, 'F1', 'src/t0-dra.test.ts covers the empty input at line 12'));
    assert.equal(r.run.effort!.terminal, 'succeeded', 'the dispute settled the repair and the episode is succeeded again');
    // The author now agrees with the finding: the block stands, so the repair needs an attempt of the same episode.
    r = s.runner.next(s.g(), s.card, s.runner.acceptFinding(s.g(), s.card, r.run, 'F1'));
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    assert.equal(r.run.effort!.terminal, undefined, 'the episode is open for the repair');
    assert.equal(r.run.effort!.attempts.filter((a) => a.outcome === 'running').length, 1, 'card next opened the repair attempt');
    const repaired = s.runner.recordAttempt(s.g(), s.card, r.run, { outcome: 'success', dodReceipt: 'dod:sha-2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    assert.equal(repaired.candidate?.sha, 'sha-2');
    assert.equal(repaired.effort!.terminal, 'succeeded');
  } finally {
    s.fx.cleanup();
  }
});

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 1: a kept receipt reused because the pre-review rounds are exhausted settles nothing: the repair stays running and nothing is journaled (R3 decision 1 F1) [R1]', async () => {
  const s = setup();
  try {
    let r = s.record(s.first.run, 'sha-1');
    s.r2.push(BLOCK);
    const blocked = await s.runner.preReview(s.g(), s.card, r.run);
    r = s.runner.next(s.g(), s.card, blocked.run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    const opened = r.run.effort!.attempts.find((a) => a.outcome === 'running')!;
    // The rounds are cut to one: the block exhausts them, F1 stays open, and the kept receipt comes back without a dispute.
    const oneRound = s.runnerWith({ ...s.fx.config, preReview: { ...s.fx.config.preReview, rounds: 1 } });
    const finishedBefore = s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED').length;
    r = oneRound.next(s.g(), s.card, r.run);
    assert.equal(r.directive.kind, 'stop', `exhausted with onExhausted "stop": ${r.directive.narration}`);
    const stored = s.fx.store.getCardRun(s.goalId, 'T0-DRA')!;
    assert.equal(stored.dodReceipt, 'dod:sha-1', 'the kept receipt was reused');
    assert.equal(stored.findings.find((f) => f.id === 'F1')?.disposition, 'open', 'no finding was disputed');
    assert.deepEqual(stored.effort!.attempts.filter((a) => a.outcome === 'running').map((a) => a.n), [opened.n], 'the repair is not settled');
    assert.notEqual(stored.effort!.terminal, 'succeeded');
    assert.equal(s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED').length, finishedBefore, 'nothing is journaled as settled');
  } finally {
    s.fx.cleanup();
  }
});

/** R2 and R3 pass on sha-1, then the stored run gets a running attempt: the ship's answer. */
async function shipWithLegacyRunning(step: ShipStep) {
  const s = setup([step]);
  let r = s.record(s.first.run, 'sha-1');
  const passed = await s.runner.preReview(s.g(), s.card, r.run);
  r = s.runner.next(s.g(), s.card, passed.run);
  assert.equal(r.directive.kind, 'review', r.directive.narration);
  const decided = await s.runner.formalReview(s.g(), s.card, r.run);
  s.fx.store.updateCardRun(s.goalId, 'T0-DRA', () => decided.run);
  const legacy = s.legacyRunning();
  const running = legacy.effort!.attempts.find((a) => a.outcome === 'running')!;
  return { s, legacy, running, next: s.runner.next(s.g(), s.card, legacy) };
}

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 2: with a running attempt left by a run from before this card, a base-sync merge records its repair with that attempt [R2]', async () => {
  const { s, running, next } = await shipWithLegacyRunning('base-sync-merged');
  try {
    assert.equal(next.directive.kind, 'build', next.directive.narration);
    assert.equal(next.run.pendingRepair?.kind, 'merge-conflict');
    if (next.directive.kind === 'build') assert.deepEqual([next.directive.attempt, next.directive.effort], [running.n, running.effort], 'the running attempt is the repair');
    assert.deepEqual(next.run.effort!.attempts.filter((a) => a.outcome === 'running').map((a) => a.n), [running.n]);
  } finally {
    s.fx.cleanup();
  }
});

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 2: with a running attempt left by a run from before this card, a rejected RED receipt records its repair with that attempt [R2]', async () => {
  const { s, running, next } = await shipWithLegacyRunning('red-missing');
  try {
    assert.equal(next.directive.kind, 'build', next.directive.narration);
    assert.equal(next.run.pendingRepair?.kind, 'red-missing');
    if (next.directive.kind === 'build') assert.deepEqual([next.directive.attempt, next.directive.effort], [running.n, running.effort], 'the running attempt is the repair');
  } finally {
    s.fx.cleanup();
  }
});

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 2: the pre-review hand-back of a still-blocked candidate with a running attempt names that attempt [R2]', async () => {
  const s = setup();
  try {
    const { r } = await blockOpenDispute(s);
    // The dispute is withdrawn: the block is pending again on the unchanged candidate, and a run from before this card
    // still holds the attempt the dispute left.
    s.runner.acceptFinding(s.g(), s.card, r.run, 'F1');
    const legacy = s.legacyRunning();
    const running = legacy.effort!.attempts.find((a) => a.outcome === 'running')!;
    const next = s.runner.next(s.g(), s.card, legacy);
    assert.equal(next.directive.kind, 'build', next.directive.narration);
    assert.equal(running.n, 3);
    if (next.directive.kind === 'build') assert.deepEqual([next.directive.attempt, next.directive.effort], [2, running.effort]);
  } finally {
    s.fx.cleanup();
  }
});

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 2: with no running attempt a fresh BUILD, a DoD-failure repair, a review-fix repair and a red-missing repair number the next attempt attempts.length + 1 [R2]', async () => {
  // A fresh BUILD; R3 blocks decision 1 (a review-fix repair); decision 2 passes the repair; the ship fails its DoD.
  const s = setup(['dod-failed']);
  try {
    const fresh = s.runner.next(s.g(), s.card, s.first.run);
    assert.equal(fresh.directive.kind, 'build', fresh.directive.narration);
    if (fresh.directive.kind === 'build') assert.equal(fresh.directive.attempt, 1);
    let r = s.record(fresh.run, 'sha-1');
    r = s.runner.next(s.g(), s.card, (await s.runner.preReview(s.g(), s.card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    s.r3.push(BLOCK);
    r = s.runner.next(s.g(), s.card, (await s.runner.formalReview(s.g(), s.card, r.run)).run);
    assert.equal(r.directive.kind, 'build', `the block is a review-fix repair: ${r.directive.narration}`);
    const reviewFix = r.run.effort!.attempts.find((a) => a.outcome === 'running')!;
    if (r.directive.kind === 'build') assert.deepEqual([r.directive.attempt, reviewFix.n], [2, 2], 'the attempt the review fix opened, one after the success');
    r = s.record(r.run, 'sha-2');
    r = s.runner.next(s.g(), s.card, (await s.runner.preReview(s.g(), s.card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    r = s.runner.next(s.g(), s.card, (await s.runner.formalReview(s.g(), s.card, r.run)).run);
    assert.equal(r.directive.kind, 'build', `the DoD failure is a counted repair: ${r.directive.narration}`);
    assert.deepEqual(r.run.effort!.attempts.filter((a) => a.outcome === 'running'), []);
    if (r.directive.kind === 'build') assert.deepEqual([r.directive.attempt, r.run.effort!.attempts.length], [3, 2]);
  } finally {
    s.fx.cleanup();
  }
  // A rejected RED receipt with nothing running: the repair is the next attempt.
  const t = setup(['red-missing']);
  try {
    let r = t.record(t.first.run, 'sha-1');
    r = t.runner.next(t.g(), t.card, (await t.runner.preReview(t.g(), t.card, r.run)).run);
    r = t.runner.next(t.g(), t.card, (await t.runner.formalReview(t.g(), t.card, r.run)).run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    assert.equal(r.run.pendingRepair?.kind, 'red-missing');
    assert.deepEqual(r.run.effort!.attempts.filter((a) => a.outcome === 'running'), []);
    if (r.directive.kind === 'build') assert.equal(r.directive.attempt, r.run.effort!.attempts.length + 1);
  } finally {
    t.fx.cleanup();
  }
});

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 4: passes count in the round number and blocks in the budget: block, block, pass and a base-sync candidate give round 4/4, and a block on round 4 still exhausts the budget [R3]', async () => {
  const s = setup(['base-sync-merged']);
  try {
    let r = s.record(s.first.run, 'sha-1');
    assert.equal(r.directive.kind, 'pre-review');
    if (r.directive.kind === 'pre-review') assert.deepEqual([r.directive.round, r.directive.maxRounds], [1, 3]);
    assert.match(r.directive.narration, /^Pre-review round 1\/3 /);
    for (const sha of ['sha-2', 'sha-3']) {
      s.r2.push(BLOCK);
      const blocked = await s.runner.preReview(s.g(), s.card, r.run);
      assert.equal(blocked.result.outcome, 'block');
      r = s.runner.next(s.g(), s.card, blocked.run);
      assert.equal(r.directive.kind, 'build', r.directive.narration);
      r = s.record(r.run, sha);
    }
    const passed = await s.runner.preReview(s.g(), s.card, r.run);
    assert.equal(passed.result.outcome, 'pass');
    r = s.runner.next(s.g(), s.card, passed.run);
    r = s.runner.next(s.g(), s.card, (await s.runner.formalReview(s.g(), s.card, r.run)).run);
    assert.equal(r.directive.kind, 'build', `the base sync merged into a new candidate: ${r.directive.narration}`);
    r = s.record(r.run, 'sha-4');
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.deepEqual([r.directive.round, r.directive.maxRounds], [4, 4]);
    assert.match(r.directive.narration, /^Pre-review round 4\/4 /);
    s.r2.push(BLOCK);
    const blocked = await s.runner.preReview(s.g(), s.card, r.run);
    assert.match(s.prompts.at(-1) ?? '', /round 4 of 4\b/, 'the R2 prompt numbers the round the same way');
    assert.equal(blocked.result.outcome, 'block');
    // The block on round 4 is the third of the cycle: the budget is exhausted, and with onExhausted "stop" the gate stops.
    r = s.runner.next(s.g(), s.card, blocked.run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.match(r.run.stop?.detail ?? '', /pre-review rounds exhausted \(3\/3 blocks in R3 cycle 0\)/);
  } finally {
    s.fx.cleanup();
  }
});

/** The sentences card T0-DISPUTE-RUNNING-ATTEMPT adds to docs/OPERATIONS.md. */
const DOC_SENTENCES = [
  'When every finding of a block is disputed and the unchanged candidate goes back to review, the repair attempt that BUILD opened after the block is settled as not counted, with the reason `review-disputed`, and the effort episode is succeeded again, since the success that bound the candidate stands (card T0-DISPUTE-RUNNING-ATTEMPT).',
  'A ship repair that meets a running attempt (a base-sync merge, a rejected RED receipt, the pre-review hand-back of a still-blocked candidate) takes that attempt as the repair, with its number and effort, as a ship failure already does.',
  'Passes count in the pre-review round number and blocks in the budget: a pass followed by a new candidate, such as a base-sync merge, runs a further round, and the directive and the prompt then show round N of N; the cycle still ends at `rounds` blocks.',
];
const CHANGELOG_SENTENCE =
  '- Disputed repair attempt, card T0-DISPUTE-RUNNING-ATTEMPT (issue 106): a dispute that sends the unchanged candidate back to review settles the repair attempt BUILD had opened as not counted (`review-disputed`), a ship repair takes a running attempt as the repair instead of throwing, so a committed base-sync merge always records its repair, and the pre-review round is never shown past its maximum.';

test('T0-DISPUTE-RUNNING-ATTEMPT acceptance 5: docs/OPERATIONS.md and the CHANGELOG Unreleased section state the rules and the limit [R4]', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  for (const sentence of DOC_SENTENCES) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  assert.ok(unreleased.includes(CHANGELOG_SENTENCE), `CHANGELOG.md Unreleased states: ${CHANGELOG_SENTENCE}`);
});

test('a success recorded on the blocked candidate itself leaves the R3 block pending: card next opens one more repair attempt, once, and the repair on a new candidate is recorded', async () => {
  const s = setup();
  try {
    let r = s.record(s.first.run, 'sha-1');
    r = s.runner.next(s.g(), s.card, (await s.runner.preReview(s.g(), s.card, r.run)).run);
    s.r3.push(BLOCK);
    r = s.runner.next(s.g(), s.card, (await s.runner.formalReview(s.g(), s.card, r.run)).run);
    assert.equal(r.run.state, 'REVIEW_FIX');
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    const running = (run: CardRun) => run.effort!.attempts.filter((a) => a.outcome === 'running').length;
    const started = () => s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_STARTED').length;
    assert.equal(running(r.run), 1, 'the block opened the repair attempt');
    // The repair is recorded as a success on the sha the block names: nothing changed, so the block is still pending.
    const unchanged = s.runner.recordAttempt(s.g(), s.card, r.run, { outcome: 'success', dodReceipt: 'dod:sha-1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    assert.equal(unchanged.effort!.terminal, 'succeeded');
    const before = started();
    r = s.runner.next(s.g(), s.card, unchanged);
    assert.equal(r.run.state, 'REVIEW_FIX');
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    assert.equal(r.run.effort!.terminal, undefined, 'the episode is open again for the repair the block still asks for');
    assert.equal(running(r.run), 1);
    assert.equal(started(), before + 1);
    // Asking again without recording the attempt opens nothing more.
    const idle = s.runner.next(s.g(), s.card, r.run);
    assert.equal(idle.directive.kind, 'build');
    assert.equal(running(idle.run), 1);
    assert.equal(started(), before + 1);
    assert.equal(idle.run.effort!.attempts.length, r.run.effort!.attempts.length);
    // The repair on a new candidate is recorded and binds that candidate.
    const repaired = s.runner.recordAttempt(s.g(), s.card, idle.run, { outcome: 'success', dodReceipt: 'dod:sha-2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    assert.equal(repaired.candidate?.sha, 'sha-2');
    assert.equal(repaired.effort!.terminal, 'succeeded');
  } finally {
    s.fx.cleanup();
  }
});

// Card T0-ATTEMPT-NUMBER: the ladder number of an attempt in build directives and narrations.
const ACCEPTANCE_TABLE = 'When allow_paths lists this card file, write a table in its `## Attempt evidence` section before the final DoD run, one row per acceptance item: the item number, the test or command that proves it, and its result. A row with no proof is unfinished work. Correct the table on every repair.';
/** The build() narration before a RED receipt, with only the label varying. */
const BEFORE_RED = (label: string, prefix = '') => `${prefix}${label} at effort medium: establish behavioural RED first (scaffold: task.ps1 -Phase red writes .review/T0-DRA.red), then implement within allow_paths and run the DoD. Record the result with \`aidlc card attempt T0-DRA --outcome success --dod-receipt "<command: exit code and counts>"\` or \`aidlc card attempt T0-DRA --outcome fail --cause ...\`. ${ACCEPTANCE_TABLE}`;
/** The build() narration with a RED receipt, with only the label varying. */
const WITH_RED = (label: string, prefix = '') => `${prefix}${label} at effort medium: implement/repair within allow_paths, run \`node --test tests/t0-dra.test.ts\` and the affected checks, then record the attempt outcome (\`aidlc card attempt\`) with the DoD receipt (\`--dod-receipt "<command: exit code and counts>"\`). ${ACCEPTANCE_TABLE}`;
/** The review-fix narration of this fixture, with only the attempt note varying (empty on a repeated `card next`). */
const REVIEW_FIX = (note: string) => "Review block to repair: \"[spec] 6 tests missing @ src/t0-dra.ts: the empty input is not covered -> add a case for it\". Fix the introduced defects within scope or revert the defective change; do not defer a required fix as a nit." + note + ` ${ACCEPTANCE_TABLE}` + " Rerun the DoD and record `aidlc card attempt T0-DRA --outcome success --candidate-sha <new sha> --dod-receipt ...`; the repaired candidate ships with 3 substantive decision(s) left. Open finding(s): F1; a finding that does not hold is disputed with `aidlc review dispute T0-DRA <id> --note \"<why>\"`, and the next decision runs on the unchanged candidate once every finding of the block is disputed. Before adding code, check whether removing the code the finding names fixes the defect at every site, and remove it if so. After the repair, read the repair hunks again for what they newly break: most later findings sit on or next to those lines. List in the attempt evidence each input form and failure path the repair hunks handle (for a parser, each kind of value it can be given; for I/O, each error it can raise), each with the test that covers it. For each fixed finding of the Bugs or Security pass, record `aidlc review repro <cardId> <findingId> --argv '<JSON array>' --files <paths>` with the test that catches it, and attach one to a `wrong` dispute; a repro is evidence for the next decision and changes no gate.";
const HAND_BACK = "Pre-review block still pending on candidate sha-1: \"[spec] 6 tests missing @ src/t0-dra.ts: the empty input is not covered -> add a case for it\". Fix within scope, rerun the DoD, record the attempt with the new candidate sha, then `aidlc review pre T0-DRA`. Open finding(s): F1; dispute one with `aidlc review dispute T0-DRA <id> --note \"<why>\"`, and the round runs on the unchanged candidate once every finding of the block is disputed.";
const MERGE_CONFLICT = "Merge conflict on the base sync (\"sentinel \\\\[SHIP-BASE-SYNC-MERGED\\\\]\"): the ship path merged the entries both sides added to CHANGELOG.md Unreleased and committed the merge; check it, rerun the DoD on it and record it as the attempt. The merge commit is a new candidate: it costs an R2 round and, once R3 has decided, the second R3 decision.";
const MERGE_CONFLICT_PREFIX = "Pending merge-conflict repair: \"merge conflict on the base sync (sentinel \\\\[SHIP-BASE-SYNC-MERGED\\\\])\" ";
const RED_MISSING = "red-missing: \"sentinel 缺少 RED 证据\". Establish the RED receipt again within scope and re-run the DoD.";
const RED_MISSING_PREFIX = "Pending red-missing repair: \"sentinel 缺少 RED 证据\" ";
const DOD_FAILED = "dod-failed: \"sentinel DoD 未通过; failing line: not ok N - parses the header\". Repair within scope (never weaken a test or widen allow_paths to pass a gate) and re-run the DoD. The failure counts as a failed attempt on the effort ladder.";

type BuildDirective = Extract<CardDirective, { kind: 'build' }>;
function buildOf(r: { directive: CardDirective }): BuildDirective {
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  return r.directive as BuildDirective;
}
/** A not-counted first: `card next` opens record 1 and `recordAttempt` records it not counted (`tool-outage`). */
function notCountedFirst(s: Setup): CardRun {
  const opened = s.runner.next(s.g(), s.card, s.first.run);
  assert.equal(buildOf(opened).attempt, 1);
  return s.runner.recordAttempt(s.g(), s.card, opened.run, { outcome: 'not-counted', notCountedReason: 'tool-outage' });
}
/** R2 passes on the recorded candidate and R3 decides it (`r3` queued first when given): the decided run. */
async function reviewed(s: Setup, run: CardRun, r3?: string): Promise<CardRun> {
  const r = s.runner.next(s.g(), s.card, (await s.runner.preReview(s.g(), s.card, run)).run);
  assert.equal(r.directive.kind, 'review', r.directive.narration);
  if (r3) s.r3.push(r3);
  return (await s.runner.formalReview(s.g(), s.card, r.run)).run;
}
const outcomes = (run: CardRun) => run.effort!.attempts.map((a) => [a.n, a.outcome]);

test('T0-ATTEMPT-NUMBER: BUILD names its attempt by the ladder number when it opens it, while it runs and on a succeeded episode, with the record number in the label', async (t) => {
  // (a) Opened after a not-counted record, then asked for again while it runs.
  const s = setup();
  t.after(() => cleanup(s.fx.tmp));
  const started = () => s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_STARTED');
  let r = s.runner.next(s.g(), s.card, notCountedFirst(s));
  assert.deepEqual(outcomes(r.run), [[1, 'not-counted'], [2, 'running']]);
  let d = buildOf(r);
  assert.deepEqual([d.attempt, d.narration], [1, BEFORE_RED('Attempt 1 (record 2 of this run; 1 not counted)')]);
  r = s.runner.next(s.g(), s.card, r.run);
  d = buildOf(r);
  assert.deepEqual([d.attempt, d.narration], [1, BEFORE_RED('Attempt 1 (record 2 of this run; 1 not counted)')]);
  assert.deepEqual(started().map((e) => e.data['n']), [1, 1], 'records 1 and 2 open as attempt 1; the repeated call journals nothing');

  // (b) Two not-counted records before the attempt.
  const b = setup();
  t.after(() => cleanup(b.fx.tmp));
  let rb = b.runner.next(b.g(), b.card, notCountedFirst(b));
  rb = b.runner.next(b.g(), b.card, b.runner.recordAttempt(b.g(), b.card, rb.run, { outcome: 'not-counted', notCountedReason: 'quota' }));
  assert.deepEqual(outcomes(rb.run), [[1, 'not-counted'], [2, 'not-counted'], [3, 'running']]);
  d = buildOf(rb);
  assert.deepEqual([d.attempt, d.narration], [1, BEFORE_RED('Attempt 1 (record 3 of this run; 2 not counted)')]);

  // (c) A succeeded episode whose run lost its DoD receipt: BUILD names the next attempt and opens nothing.
  const c = setup();
  t.after(() => cleanup(c.fx.tmp));
  const rc = c.record(notCountedFirst(c), 'sha-1');
  assert.equal(rc.directive.kind, 'pre-review', rc.directive.narration);
  const stripped = c.fx.store.updateCardRun(c.goalId, 'T0-DRA', (current) => ({ ...current!, dodReceipt: undefined }));
  const startedBefore = c.fx.events(c.goalId).filter((e) => e.type === 'ATTEMPT_STARTED').length;
  d = buildOf(c.runner.next(c.g(), c.card, stripped));
  assert.deepEqual([d.attempt, d.narration], [2, WITH_RED('Attempt 2 (record 3 of this run; 1 not counted)')]);
  const stored = c.fx.store.getCardRun(c.goalId, 'T0-DRA')!;
  assert.deepEqual(outcomes(stored), [[1, 'not-counted'], [2, 'success']]);
  assert.equal(stored.effort!.terminal, 'succeeded');
  assert.equal(c.fx.events(c.goalId).filter((e) => e.type === 'ATTEMPT_STARTED').length, startedBefore, 'no attempt is opened');
});

test('T0-ATTEMPT-NUMBER: a review-fix repair names its attempt by the ladder number when it opens it and while it runs', async (t) => {
  const s = setup();
  t.after(() => cleanup(s.fx.tmp));
  const decided = await reviewed(s, s.record(notCountedFirst(s), 'sha-1').run, BLOCK);
  let r = s.runner.next(s.g(), s.card, decided);
  assert.deepEqual(outcomes(r.run), [[1, 'not-counted'], [2, 'success'], [3, 'running']]);
  let d = buildOf(r);
  assert.deepEqual([d.attempt, d.narration], [2, REVIEW_FIX(' Attempt 2 (record 3 of this run; 1 not counted) at effort medium.')]);
  r = s.runner.next(s.g(), s.card, r.run);
  d = buildOf(r);
  assert.deepEqual([d.attempt, d.narration], [2, REVIEW_FIX('')]);
  const repair = s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_STARTED').at(-1)!;
  assert.deepEqual([repair.data['n'], repair.data['reason']], [2, 'review-fix']);
});

test('T0-ATTEMPT-NUMBER: the pre-review hand-back of a succeeded episode names the ladder number the next BUILD opens', async (t) => {
  const s = setup();
  t.after(() => cleanup(s.fx.tmp));
  const { r } = await blockOpenDispute(s);
  let next = s.runner.next(s.g(), s.card, s.runner.acceptFinding(s.g(), s.card, r.run, 'F1'));
  let d = buildOf(next);
  assert.deepEqual([d.attempt, d.narration], [2, HAND_BACK]);
  next = s.runner.next(s.g(), s.card, next.run);
  assert.deepEqual(outcomes(next.run), [[1, 'success'], [2, 'not-counted'], [3, 'running']]);
  d = buildOf(next);
  assert.deepEqual([d.attempt, d.narration], [2, WITH_RED('Attempt 2 (record 3 of this run; 1 not counted)')]);
});

test('T0-ATTEMPT-NUMBER: the merge-conflict and rejected-RED repairs name the ladder number, with an attempt running and with none', async (t) => {
  for (const step of ['base-sync-merged', 'red-missing'] as const) {
    const literal = step === 'base-sync-merged' ? MERGE_CONFLICT : RED_MISSING;
    const opened = step === 'base-sync-merged' ? WITH_RED('Attempt 2 (record 3 of this run; 1 not counted)', MERGE_CONFLICT_PREFIX) : BEFORE_RED('Attempt 2 (record 3 of this run; 1 not counted)', RED_MISSING_PREFIX);
    // (a) A running attempt left by an older run.
    const s = setup([step]);
    t.after(() => cleanup(s.fx.tmp));
    const decided = await reviewed(s, s.record(notCountedFirst(s), 'sha-1').run);
    s.fx.store.updateCardRun(s.goalId, 'T0-DRA', () => decided);
    let next = s.runner.next(s.g(), s.card, s.legacyRunning());
    let d = buildOf(next);
    assert.deepEqual(next.run.effort!.attempts.filter((a) => a.outcome === 'running').map((a) => a.n), [3], step);
    assert.deepEqual([d.attempt, d.narration], [2, literal], step);

    // (b) Nothing running: the repair is the next attempt, opened by the next `card next`.
    const u = setup([step]);
    t.after(() => cleanup(u.fx.tmp));
    next = u.runner.next(u.g(), u.card, await reviewed(u, u.record(notCountedFirst(u), 'sha-1').run));
    d = buildOf(next);
    assert.deepEqual([d.attempt, d.narration], [2, literal], step);
    next = u.runner.next(u.g(), u.card, next.run);
    assert.deepEqual(outcomes(next.run), [[1, 'not-counted'], [2, 'success'], [3, 'running']], step);
    d = buildOf(next);
    assert.deepEqual([d.attempt, d.narration], [2, opened], step);
  }
});

test('T0-ATTEMPT-NUMBER: a ship failure with a running repair names its ladder number, and a promotion journals the stored n after the refutation', async (t) => {
  // (a) The running repair after a not-counted record.
  const s = setup(['dod-failed']);
  t.after(() => cleanup(s.fx.tmp));
  const decided = await reviewed(s, s.record(notCountedFirst(s), 'sha-1').run);
  s.fx.store.updateCardRun(s.goalId, 'T0-DRA', () => decided);
  let next = s.runner.next(s.g(), s.card, s.legacyRunning());
  let d = buildOf(next);
  assert.deepEqual([d.attempt, d.narration], [2, DOD_FAILED]);
  next = s.runner.next(s.g(), s.card, next.run);
  d = buildOf(next);
  assert.deepEqual([d.attempt, d.narration], [2, WITH_RED('Attempt 2 (record 3 of this run; 1 not counted)')]);

  // (b) The promotion of a running repair to the escalation.
  const p = setup(['dod-failed']);
  t.after(() => cleanup(p.fx.tmp));
  const passed = await reviewed(p, p.record(p.first.run, 'sha-1').run);
  const fail = (ep: EffortEpisode, cause: string) => finishAttempt(startAttempt(ep, 'medium', T), { finishedAt: T, outcome: 'fail', cause, progress: true });
  let ep: EffortEpisode = fail(fail({ ...passed.effort!, attempts: [], terminal: undefined, escalationUsed: false }, 'a'), 'b');
  ep = reopenEpisode(finishAttempt(startAttempt(ep, 'medium', T), { finishedAt: T, outcome: 'success', progress: true }))!;
  ep = startAttempt(finishAttempt(startAttempt(ep, 'medium', T), { finishedAt: T, outcome: 'not-counted', notCountedReason: 'quota' }), 'medium', T);
  const written = p.fx.store.updateCardRun(p.goalId, 'T0-DRA', () => ({ ...passed, effort: ep }));
  assert.deepEqual(outcomes(written), [[1, 'fail'], [2, 'fail'], [3, 'success'], [4, 'not-counted'], [5, 'running']]);
  const before = p.fx.events(p.goalId).length;
  d = buildOf(p.runner.next(p.g(), p.card, written));
  assert.deepEqual([d.attempt, d.effort], [4, 'high']);
  const appended = p.fx.events(p.goalId).slice(before).filter((e) => e.type === 'ATTEMPT_FINISHED' || e.type === 'ATTEMPT_STARTED');
  assert.deepEqual(appended.map((e) => [e.type, e.data['n']]), [['ATTEMPT_FINISHED', 3], ['ATTEMPT_STARTED', 5]]);
  assert.equal(appended[0]!.data['refutedBy'], 'ship dod-failed');
  assert.deepEqual([appended[1]!.data['promoted'], appended[1]!.data['from'], appended[1]!.data['effort']], [true, 'medium', 'high']);
});

test('T0-ATTEMPT-NUMBER: the implicit attempt journals the ladder number, as on main', (t) => {
  const s = setup();
  t.after(() => cleanup(s.fx.tmp));
  const run = s.runner.recordAttempt(s.g(), s.card, notCountedFirst(s), { outcome: 'success', dodReceipt: 'dod:sha-1', redReceipt: 'red:1', candidateSha: 'sha-1' });
  const implicit = s.fx.events(s.goalId).filter((e) => e.type === 'ATTEMPT_STARTED').at(-1)!;
  assert.deepEqual([implicit.data['n'], implicit.data['implicit']], [1, true]);
  assert.equal(run.effort!.attempts.at(-1)!.n, 2);
});

test('T0-ATTEMPT-NUMBER: a review-fix directive of a run with no effort episode names attempt 1', async (t) => {
  const s = setup();
  t.after(() => cleanup(s.fx.tmp));
  const decided = await reviewed(s, s.record(s.first.run, 'sha-1').run, BLOCK);
  const stripped = s.fx.store.updateCardRun(s.goalId, 'T0-DRA', () => ({ ...decided, effort: undefined }));
  assert.equal(buildOf(s.runner.next(s.g(), s.card, stripped)).attempt, 1);
});

test("T0-ATTEMPT-NUMBER: with no not-counted record the numbers and the narrations are main's", async (t) => {
  const s = setup();
  t.after(() => cleanup(s.fx.tmp));
  let r = s.runner.next(s.g(), s.card, s.first.run);
  let d = buildOf(r);
  assert.deepEqual([d.attempt, d.narration], [1, BEFORE_RED('Attempt 1')]);
  r = s.runner.next(s.g(), s.card, r.run);
  d = buildOf(r);
  assert.deepEqual([d.attempt, d.narration], [1, BEFORE_RED('Attempt 1')]);
  r = s.runner.next(s.g(), s.card, await reviewed(s, s.record(r.run, 'sha-1').run, BLOCK));
  d = buildOf(r);
  assert.deepEqual([d.attempt, d.narration], [2, REVIEW_FIX(' Attempt 2 at effort medium.')]);
  r = s.record(r.run, 'sha-2');
  const stripped = s.fx.store.updateCardRun(s.goalId, 'T0-DRA', (current) => ({ ...current!, dodReceipt: undefined }));
  d = buildOf(s.runner.next(s.g(), s.card, stripped));
  assert.deepEqual([d.attempt, d.narration], [3, WITH_RED('Attempt 3')]);
});

/** The sentence card T0-ATTEMPT-NUMBER appends to the ship repair attempt paragraph of docs/OPERATIONS.md. */
const LADDER_OPERATIONS =
  'Every build directive names, in its `attempt` field and in the `Attempt <n>` label of a BUILD or review-fix narration that has one, the ladder number of the attempt it opens, runs or asks for: the records of the run before that attempt that are not `not-counted`, plus one (card T0-ATTEMPT-NUMBER). When that attempt\'s record number, its `n` in the run, differs, the label adds `(record <n> of this run; <k> not counted)`; the stored `n`, the failure counts and the ladder limits are unchanged, and in the journal an `ATTEMPT_STARTED` that opens an attempt carries its ladder number while one that journals the promotion of a running repair, and every `ATTEMPT_FINISHED`, carry the stored `n`, as before.';
const LADDER_ARCHITECTURE =
  '`effort.ts` bounds implementation attempts (MA2). Build directives name an attempt by `ladderNumber`, the records before it that are not `not-counted` plus one; the stored attempt numbers and the journal\'s numbering are unchanged (card T0-ATTEMPT-NUMBER).';
const LADDER_CHANGELOG =
  '- T0-ATTEMPT-NUMBER (audit item F17): every build directive names its attempt by the ladder number, the records of the run before it that are not `not-counted` plus one, in its `attempt` field. Where a BUILD or review-fix narration already contains an attempt-number label, that label uses the ladder number and adds `(record <n> of this run; <k> not counted)` only when the attempt\'s record number differs. Before, with a not-counted record before the attempt, it was named by its ladder number when it opened and by its record number on a repeated `aidlc card next`, at BUILD on a succeeded episode, in the `attempt` field of a review-fix repair, in the pre-review hand-back and in the merge-conflict, rejected-RED and running-repair ship failure directives. With no not-counted record before the attempt every directive is as before, except that a review-fix directive of a run with no effort episode named attempt 0 and now names 1. The stored `n`, the journal events, the failure counts and the ladder limits are unchanged.';

test('T0-ATTEMPT-NUMBER: docs/OPERATIONS.md, docs/ARCHITECTURE.md and the CHANGELOG state the ladder number', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const read = (...parts: string[]) => readFileSync(path.join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');
  const operations = read('docs', 'OPERATIONS.md').split('\n');
  const paragraph = operations.find((line) => line.startsWith('A ship that fails on the candidate\'s own code is a failed attempt (card T0-SHIP-REPAIR-ATTEMPT)'));
  assert.ok(paragraph?.endsWith(` ${LADDER_OPERATIONS}`), 'the ship repair attempt paragraph ends with the ladder sentence');
  for (const sentence of DOC_SENTENCES) assert.ok(operations.join('\n').includes(sentence), `docs/OPERATIONS.md still states: ${sentence}`);
  const core = read('docs', 'ARCHITECTURE.md').split('\n').find((line) => line.startsWith('`src/core/` holds the decision engines.'));
  assert.ok(core?.includes(LADDER_ARCHITECTURE), 'the src/core/ paragraph states the ladder number directly after the effort.ts sentence');
  const changelog = read('CHANGELOG.md');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  assert.ok(unreleased.split('\n').includes(LADDER_CHANGELOG), 'the CHANGELOG Unreleased section holds the entry');
});
