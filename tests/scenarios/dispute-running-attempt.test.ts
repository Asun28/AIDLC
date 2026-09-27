import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyShipOutput, DryRunShipPath, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { nextEffortAction, startAttempt } from '../../src/core/effort.ts';
import { reopenEpisode } from '../../src/loop/card-runner.ts';
import { scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import type { CardRun } from '../../src/core/types.ts';
import { makeFixture, writeCard } from './_harness.ts';

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
  return { fx, runner, ship, card, g, goalId: goal.id, first, record, legacyRunning, r2, r3, prompts };
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
    if (next.directive.kind === 'build') assert.equal(next.directive.attempt, next.run.effort!.attempts.length + 1);
    if (next.directive.kind === 'build') assert.notEqual(next.directive.attempt, opened!.n);
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
    if (next.directive.kind === 'build') assert.deepEqual([next.directive.attempt, next.directive.effort], [running.n, running.effort]);
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
