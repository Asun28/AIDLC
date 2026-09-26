import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard } from './_harness.ts';
import { DryRunShipPath, classifyShipOutput, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner, type ExecReceipt } from '../../src/probes/exec.ts';
import { MINUTE_MS, addMs, type ReviewInvocation } from '../../src/core/types.ts';

// Card T0-BASE-SYNC-REVIEW: a candidate made by resolving a base-sync conflict after both R3 decisions gets one more decision
// by the configured base-sync reviewer, instead of a STOP.

const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const BLOCK = '{"verdict":"block","reasons":["[spec] 6 tests @ src/t0-bsr.ts:1: the merge drops a guard -> restore it"],"axes":{"spec":{"verdict":"block","reasons":["guard"]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const HOLD = '429 Too Many Requests, retry after 60 seconds\n';
const BASE_SYNC = { command: ['fake-cx', '--effort', '{effort}', '{instructions}'], reviewer: 'codex-bs', timeoutMs: 1000, shell: false };
/** A held reviewer reports the hold on stderr and exits non-zero; anything else is its stdout answer. */
const answer = (out: string): Partial<ExecReceipt> => (out === HOLD ? { stderr: out, exitCode: 1 } : { stdout: out });

/**
 * A ship path that ends each ship with the next step: `base-sync` is the base-sync CHANGELOG merge (a new candidate that
 * clears a merge-conflict repair), `red-missing` a rejected RED receipt (a repair that is not a base sync);
 * once the steps run out, ships merge.
 */
class SequenceShip extends DryRunShipPath {
  private readonly steps: Array<'base-sync' | 'red-missing'>;
  constructor(steps: Array<'base-sync' | 'red-missing'>) {
    super(['merged']);
    this.steps = [...steps];
  }
  override ship(req: ShipRequest): ShipResult {
    const step = this.steps.shift();
    if (!step) return super.ship(req);
    this.requests.push(req);
    const now = new Date().toISOString();
    if (step === 'red-missing') {
      return { outcome: 'red-missing', sentinels: [], detail: 'RED receipt rejected by the ship path', receipt: { command: 'dry-run', args: [req.cardId], cwd: '', exitCode: 1, signal: null, timedOut: false, stdout: '[TD85-RESUME] RED receipt rejected\n', stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '' } };
    }
    const stdout = ['CONFLICT (content): Merge conflict in CHANGELOG.md', 'Automatic merge failed; fix conflicts and then commit the result.', `[SHIP-BASE-SYNC-MERGED] refs/remotes/origin/main conflicted with HEAD ${req.candidateSha ?? 'unknown'} only in entries both sides added; merged as ${'c'.repeat(40)}`, '[SAGA-FAIL]'].join('\n');
    return classifyShipOutput({ command: 'dry-run', args: [req.cardId], cwd: '', exitCode: 1, signal: null, timedOut: false, stdout, stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '' });
  }
}

/**
 * A card whose decision 1 passes on sha-1, whose ship merges the base into sha-2 (a base-sync candidate), whose decision 2
 * passes on sha-2, and whose next ship merges again into sha-3: both decisions are used and sha-3 is a base-sync candidate.
 * `primary` and `cx` feed the primary and the base-sync reviewer; `cxArgs` records each base-sync dispatch's argv.
 */
async function atBaseSync(opts: { baseSync?: boolean; fallback?: boolean; steps?: Array<'base-sync' | 'red-missing'>; baseSyncTimeoutMs?: number; blockFirst?: boolean; stopAtFirstMerge?: boolean } = {}) {
  const fx = makeFixture({
    config: {
      gateRequired: true,
      preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false },
      formalReview: { command: ['fake-p', '--schema', '{schema}', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false, ...(opts.fallback ? { fallback: { command: ['fake-fb', '{instructions}'], reviewer: 'backup', timeoutMs: 1000, shell: false } } : {}), ...(opts.baseSync === false ? {} : { baseSync: { ...BASE_SYNC, ...(opts.baseSyncTimeoutMs ? { timeoutMs: opts.baseSyncTimeoutMs } : {}) } }) },
    },
  });
  const primary: string[] = [];
  const cx: string[] = [];
  const r2: string[] = [];
  const cxArgs: string[][] = [];
  const pArgs: string[][] = [];
  /** Runs inside the base-sync reviewer, before it answers. */
  const hooks: { onCx?: () => void } = {};
  const script = scriptedRunner({
    'git diff --name-only': { stdout: 'src/t0-bsr.ts\n' },
    'git diff': { stdout: 'diff --git a/src/t0-bsr.ts b/src/t0-bsr.ts\n+export const bsr = 1;\n' },
    'fake-r2': () => ({ stdout: r2.shift() ?? PASS }),
    'fake-p': (args) => {
      pArgs.push(args);
      return answer(primary.shift() ?? PASS);
    },
    'fake-fb': () => ({ stdout: PASS }),
    'fake-cx': (args) => {
      cxArgs.push(args);
      hooks.onCx?.();
      const out = cx.shift() ?? PASS;
      if (out === HOLD) fx.advance(90_000); // the review itself outlasts the hold it reports
      return answer(out);
    },
  });
  const ship = new SequenceShip(opts.steps ?? ['base-sync', 'base-sync']);
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, { id: 'T0-BSR', title: 'base-sync review', allowPaths: ['src/t0-bsr.ts'] });
  const goal = fx.controller.createGoal({ text: 'implement T0-BSR', source: 'card', ref: 'T0-BSR', affectedSurfaces: [] }, { cards: ['T0-BSR'] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T0-BSR'] } });
  const card = fx.card('T0-BSR');
  const g = () => fx.goal(goal.id);
  const state = { r: runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T0-BSR')) };
  /** Record `sha`, take its R2 pass, and return the gate's answer after it. */
  const reviewed = async (sha: string, redReceipt = 'red:1') => {
    let run = runner.recordAttempt(g(), card, state.r.run, { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt, candidateSha: sha });
    state.r = runner.next(g(), card, run);
    assert.equal(state.r.directive.kind, 'pre-review', `${sha}: ${state.r.directive.narration}`);
    run = (await runner.preReview(g(), card, state.r.run)).run;
    state.r = runner.next(g(), card, run);
    return state.r;
  };
  /** Run the formal review the gate asked for, then ask the gate again. */
  const decide = async () => {
    const f = await runner.formalReview(g(), card, state.r.run);
    state.r = runner.next(g(), card, f.run);
    return { f, r: state.r };
  };
  let r = await reviewed('sha-1');
  assert.equal(r.directive.kind, 'review', r.directive.narration);
  const handle = { fx, runner, card, g, goal, ship, primary, cx, r2, cxArgs, pArgs, hooks, reviewed, decide, state };
  if (opts.blockFirst) {
    // Decision 1 blocks: the card returns to REVIEW_FIX, and the caller records the repair.
    primary.push(BLOCK);
    await decide();
    return handle;
  }
  r = (await decide()).r;
  assert.equal(r.directive.kind, 'build', `the first ship merged the base into a new candidate: ${r.directive.narration}`);
  if (opts.stopAtFirstMerge) return handle;
  r = await reviewed('sha-2');
  assert.equal(r.directive.kind, 'review', r.directive.narration);
  r = (await decide()).r;
  return handle;
}

test('acceptance 1: with both decisions used, a base-sync candidate gets a review directive naming the base-sync reviewer, which runs at medium effort; its pass ships', async () => {
  const s = await atBaseSync();
  try {
    assert.equal(s.state.r.directive.kind, 'build', 'the second ship merged the base again');
    const r = await s.reviewed('sha-3');
    assert.equal(r.directive.kind, 'review', `a base-sync decision, not a stop: ${r.directive.narration}`);
    if (r.directive.kind === 'review') assert.equal(r.directive.reviewer, 'codex-bs');
    const { f, r: after } = await s.decide();
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(s.cxArgs[0]?.slice(0, 2), ['--effort', 'medium'], 'the base-sync reviewer runs with its own effort policy, medium by default');
    const inv = f.run.review.invocations.at(-1)!;
    assert.equal(inv.reviewer, 'codex-bs');
    assert.equal((inv as { baseSync?: boolean }).baseSync, true, 'the invocation is marked as a base-sync decision');
    assert.equal(inv.effort, 'medium');
    assert.ok(s.fx.queue.list().some((q) => q.reviewer === 'codex-bs' && q.pool === `${s.goal.reviewPool}/codex-bs`), 'the base-sync reviewer queues in its own review pool, apart from the primary\'s quota');
    const primaryPools = s.fx.queue.list().filter((q) => q.reviewer === 'primary').map((q) => q.pool);
    assert.ok(primaryPools.length > 0 && primaryPools.every((p) => p === s.goal.reviewPool), `the primary stays in the goal pool with no fallback configured: ${primaryPools.join(', ')}`);
    assert.equal(after.directive.kind, 'close', `the pass ships: ${after.directive.narration}`);
  } finally {
    s.fx.cleanup();
  }
});

test('acceptance 2: the base-sync prompt carries the delta since the candidate the last decision reviewed and says the base moved', async () => {
  const s = await atBaseSync();
  try {
    await s.reviewed('sha-3');
    await s.decide();
    const prompt = s.cxArgs[0]?.at(-1) ?? '';
    assert.ok(prompt.includes('## Delta since the last reviewed candidate') && prompt.includes('- since: sha-2'), 'the delta since sha-2, the candidate decision 2 reviewed');
    assert.equal(s.pArgs.length, 2);
    assert.ok(s.pArgs.every((a) => !(a.at(-1) ?? '').includes('## Base sync')), 'decisions 1 and 2 (a base-sync candidate within the allowance included) carry no base-sync section');
    assert.ok(prompt.includes('## Base sync\n- The base moved under this card: this candidate merges the new base into the candidate the last decision reviewed. Review the merged result against the new base, including how the base\'s changes meet the card\'s; no decision on an earlier candidate carries to this one.'), prompt.slice(prompt.indexOf('## Candidate'), prompt.indexOf('## Candidate') + 600));
  } finally {
    s.fx.cleanup();
  }
});

test('acceptance 3: a base-sync block stops for review with its findings; a no-verdict takes the retry and a second stops; a quota hold waits, then the base-sync reviewer runs', async () => {
  const block = await atBaseSync();
  try {
    await block.reviewed('sha-3');
    block.cx.push(BLOCK);
    const { f, r } = await block.decide();
    assert.equal(f.classified.outcome, 'block-defect');
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    assert.equal(r.run.stop?.reason, 'review');
    assert.ok(r.run.findings.some((x) => x.stage === 'formal' && x.candidateSha === 'sha-3'), 'the base-sync findings are recorded');
  } finally {
    block.fx.cleanup();
  }
  const none = await atBaseSync();
  try {
    await none.reviewed('sha-3');
    none.cx.push('no verdict here\n', 'still none\n');
    let { f, r } = await none.decide();
    assert.equal(f.classified.outcome, 'no-verdict');
    assert.equal(r.directive.kind, 'review', `the single retry: ${r.directive.narration}`);
    if (r.directive.kind === 'review') assert.equal(r.directive.reviewer, 'codex-bs');
    ({ f, r } = await none.decide());
    assert.equal(f.classified.outcome, 'no-verdict');
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
  } finally {
    none.fx.cleanup();
  }
  const held = await atBaseSync();
  try {
    await held.reviewed('sha-3');
    held.cx.push(HOLD);
    let { f, r } = await held.decide();
    assert.equal(f.classified.outcome, 'quota-hold');
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    if (r.directive.kind === 'wait') assert.equal(r.directive.on, 'review-quota');
    held.fx.advance(61_000);
    r = held.runner.next(held.g(), held.card, r.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    if (r.directive.kind === 'review') assert.equal(r.directive.reviewer, 'codex-bs', 'the base-sync reviewer runs once its hold clears');
    held.state.r = r;
    ({ f, r } = await held.decide());
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(r.directive.kind, 'close', r.directive.narration);
  } finally {
    held.fx.cleanup();
  }
});

test('acceptance 4: no base-sync reviewer, a RED-receipt repair and a second base-sync decision still stop; a review repair is not a base-sync candidate; a later base-sync candidate gets its own decision', async () => {
  const unset = await atBaseSync({ baseSync: false });
  try {
    const r = await unset.reviewed('sha-3');
    assert.equal(r.directive.kind, 'stop', `without formalReview.baseSync the allowance stops as before: ${r.directive.narration}`);
    assert.equal(r.run.stop?.reason, 'review');
  } finally {
    unset.fx.cleanup();
  }
  const repair = await atBaseSync({ steps: ['base-sync', 'red-missing'] });
  try {
    assert.equal(repair.state.r.directive.kind, 'build', `the rejected RED receipt opens a repair: ${repair.state.r.directive.narration}`);
    assert.equal(repair.state.r.run.pendingRepair?.kind, 'red-missing');
    // R2 blocks the RED repair too; its own repair is still not a base-sync candidate (only a base-sync candidate carries the mark).
    repair.r2.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t0-bsr.ts:1: a guard is missing -> add it"],"axes":{"spec":{"verdict":"block","reasons":["guard"]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    const blocked = await repair.reviewed('sha-3', 'red:2');
    assert.equal(blocked.directive.kind, 'build', `R2 blocked the RED repair: ${blocked.directive.narration}`);
    const r = await repair.reviewed('sha-4', 'red:2');
    assert.equal(repair.fx.store.getCardRun(repair.goal.id, 'T0-BSR')?.candidate?.baseSync, undefined, 'the repair of an undecided candidate that is not a base-sync candidate carries no mark');
    assert.equal(r.directive.kind, 'stop', `a RED-receipt repair past the allowance is not a base-sync candidate: ${r.directive.narration}`);
  } finally {
    repair.fx.cleanup();
  }
  // A candidate repaired after a formal block is not a base-sync candidate: its decision (2) is the primary's.
  const fixed = await atBaseSync({ blockFirst: true });
  try {
    assert.equal(fixed.state.r.directive.kind, 'build', fixed.state.r.directive.narration);
    assert.match(fixed.state.r.directive.narration, /Review block to repair/);
    const r = await fixed.reviewed('sha-2');
    assert.equal(fixed.fx.store.getCardRun(fixed.goal.id, 'T0-BSR')?.candidate?.baseSync, undefined, 'a review repair is not a base-sync candidate');
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    if (r.directive.kind === 'review') assert.equal(r.directive.reviewer, 'primary');
  } finally {
    fixed.fx.cleanup();
  }
  const twice = await atBaseSync({ steps: ['base-sync', 'base-sync', 'base-sync'] });
  try {
    await twice.reviewed('sha-3');
    const first = await twice.decide();
    assert.equal(first.f.classified.outcome, 'pass');
    await assert.rejects(() => twice.runner.formalReview(twice.g(), twice.card, first.f.run), /allowance/, 'one base-sync decision per base-sync candidate');
    assert.equal(first.r.directive.kind, 'build', `the third ship merged the base again: ${first.r.directive.narration}`);
    const r = await twice.reviewed('sha-4');
    assert.equal(r.directive.kind, 'review', `a later base-sync candidate gets its own decision: ${r.directive.narration}`);
    if (r.directive.kind === 'review') assert.equal(r.directive.reviewer, 'codex-bs');
  } finally {
    twice.fx.cleanup();
  }
});

test('acceptance 6: docs/OPERATIONS.md and the CHANGELOG Unreleased section state when a base-sync decision runs, who runs it and what its outcomes do', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  const docSentences = [
    'Base-sync decision (card T0-BASE-SYNC-REVIEW): a candidate recorded by the successful attempt that cleared a `merge-conflict` repair, or that repairs a base-sync candidate no R3 decision has decided yet (an R2 block after the merge), is a base-sync candidate; when it needs R3 after both decisions are used and `formalReview.baseSync` is configured, the SHIP gate issues one more decision on it by that reviewer, with its own command, effort policy (default `medium`) and review pool `<reviewPool>/<reviewer>`, instead of stopping for review; the primary keeps the pool it has without a base-sync reviewer.',
    'The prompt carries the delta since the candidate the last decision reviewed and says that the base moved; the invocation is recorded under the base-sync reviewer\'s name and marked `baseSync`.',
    'A base-sync candidate gets at most one base-sync decision: its pass ships, its block stops the card for review with the findings retained, a no-verdict takes the card\'s single no-verdict retry and a quota hold of the base-sync reviewer waits; a later base-sync candidate gets its own.',
    'Without `formalReview.baseSync`, and for any other candidate past the allowance, the gate stops for review as before; this repository configures Codex (`codex exec -m gpt-6-astra -c model_reasoning_effort={effort}`, read-only, reviewer `codex-base-sync`, a name of its own because the primary R3 reviewer is `codex`) at `medium`.',
  ];
  for (const sentence of docSentences) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
  const changelogSentences = [
    '- Base-sync decision, card T0-BASE-SYNC-REVIEW: a candidate made by resolving a base-sync conflict after both R3 decisions are used now gets one more decision by `formalReview.baseSync` (this repository: Codex `gpt-6-astra` at medium effort) instead of stopping for review; its pass ships and its block stops the card.',
    'The decision is taken once per base-sync candidate, its prompt says the base moved, and every other candidate past the two-decision allowance stops as before (docs/OPERATIONS.md).',
  ];
  for (const sentence of changelogSentences) assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
});

test('R3: a base-sync decision whose commit lost the lock is recovered as a base-sync decision; a base-sync reservation without an envelope is timed by the base-sync reviewer', async () => {
  const lost = await atBaseSync();
  const lock = `${lost.fx.store.cardFile(lost.goal.id, 'T0-BSR')}.lock`;
  try {
    await lost.reviewed('sha-3');
    lost.hooks.onCx = () => writeFileSync(lock, `pid=${process.pid} at=now nonce=held`, 'utf8');
    await assert.rejects(() => lost.runner.formalReview(lost.g(), lost.card, lost.state.r.run), /locked/i);
    lost.hooks.onCx = undefined;
    rmSync(lock, { force: true });
    const f = await lost.runner.formalReview(lost.g(), lost.card, lost.fx.store.getCardRun(lost.goal.id, 'T0-BSR')!);
    assert.equal(lost.cxArgs.length, 1, 'the retained result is committed without running the reviewer again');
    const decided = f.run.review.invocations.filter((i) => i.reviewer === 'codex-bs' && i.outcome === 'pass');
    assert.equal(decided.length, 1);
    assert.equal(decided[0]!.baseSync, true, 'the recovered decision keeps its base-sync mark');
  } finally {
    rmSync(lock, { force: true });
    lost.fx.cleanup();
  }
  // The primary times out after 1 s, the base-sync reviewer after 20 minutes: a base-sync reservation 10 minutes old with no
  // envelope is still finishing (primary timeout plus grace would have dropped it as abandoned).
  const slow = await atBaseSync({ baseSyncTimeoutMs: 20 * MINUTE_MS });
  try {
    await slow.reviewed('sha-3');
    const pending: ReviewInvocation = { invocationId: 'r3:T0-BSR.r3.3.aaaaaaaa', candidateDigest: 'sha-3', candidateSha: 'sha-3', base: 'main', policyVersion: slow.fx.config.reviewPolicyVersion, reviewer: 'codex-bs', requestedAt: addMs(slow.fx.now(), -10 * MINUTE_MS), outcome: 'pending', baseSync: true };
    slow.fx.store.updateCardRun(slow.goal.id, 'T0-BSR', (cur) => ({ ...cur!, review: { ...cur!.review, invocations: [...cur!.review.invocations, pending] } }));
    await assert.rejects(() => slow.runner.formalReview(slow.g(), slow.card, slow.fx.store.getCardRun(slow.goal.id, 'T0-BSR')!), /in flight/, 'the base-sync reservation is within its own reviewer timeout');
    assert.equal(slow.cxArgs.length, 0);
  } finally {
    slow.fx.cleanup();
  }
});

test('acceptance 1: a base-sync candidate that R2 blocks is repaired into a candidate that still gets the base-sync decision', async () => {
  const s = await atBaseSync();
  try {
    // sha-3 is the merge; R2 blocks it before any R3 decision.
    s.r2.push('{"verdict":"block","reasons":["[spec] 6 tests @ src/t0-bsr.ts:1: the merge drops a guard -> restore it"],"axes":{"spec":{"verdict":"block","reasons":["guard"]},"standards":{"verdict":"pass","reasons":[]}}}\n');
    const blocked = await s.reviewed('sha-3');
    assert.equal(blocked.directive.kind, 'build', `R2 blocked the merge: ${blocked.directive.narration}`);
    // The repair of the merge still answers the moved base: it gets the base-sync decision, not a stop.
    const r = await s.reviewed('sha-4');
    assert.equal(s.fx.store.getCardRun(s.goal.id, 'T0-BSR')?.candidate?.baseSync, true, 'the repair of an undecided base-sync candidate is a base-sync candidate');
    assert.equal(r.directive.kind, 'review', `a base-sync decision, not a stop: ${r.directive.narration}`);
    if (r.directive.kind === 'review') assert.equal(r.directive.reviewer, 'codex-bs');
    const { f } = await s.decide();
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(f.run.review.invocations.at(-1)?.candidateSha, 'sha-4');
  } finally {
    s.fx.cleanup();
  }
});

test('R2 cycle 1: a failed or not-counted attempt while a merge-conflict repair is pending records no base-sync candidate; only the success that clears it does', async () => {
  const s = await atBaseSync({ stopAtFirstMerge: true });
  try {
    const run0 = s.fx.store.getCardRun(s.goal.id, 'T0-BSR')!;
    assert.equal(run0.pendingRepair?.kind, 'merge-conflict');
    // A failed attempt that names a sha, then a not-counted one: neither clears the repair, and neither marks a candidate.
    let run = s.runner.recordAttempt(s.g(), s.card, run0, { outcome: 'fail', cause: 'dod red on the merge', candidateSha: 'sha-x' });
    assert.equal(run.pendingRepair?.kind, 'merge-conflict', 'a failure clears no repair');
    assert.notEqual(run.candidate?.baseSync, true, 'a failed attempt records no base-sync candidate');
    run = s.runner.recordAttempt(s.g(), s.card, run, { outcome: 'not-counted', notCountedReason: 'env-setup', candidateSha: 'sha-y' });
    assert.equal(run.pendingRepair?.kind, 'merge-conflict');
    assert.notEqual(run.candidate?.baseSync, true, 'a not-counted attempt records no base-sync candidate');
    // The success that clears the repair records the base-sync candidate.
    run = s.runner.recordAttempt(s.g(), s.card, run, { outcome: 'success', dodReceipt: 'dod:sha-2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    assert.equal(run.pendingRepair, undefined);
    assert.equal(run.candidate?.baseSync, true);
  } finally {
    s.fx.cleanup();
  }
});

test('T0-BASE-SYNC-HOLD-NARRATION acceptance 1: a quota hold of the base-sync reviewer is narrated as its own hold, with a fallback configured or without one', async () => {
  for (const fallback of [true, false]) {
    const label = fallback ? 'with a fallback' : 'without a fallback';
    const s = await atBaseSync({ fallback });
    try {
      await s.reviewed('sha-3');
      s.cx.push(HOLD);
      const decided = await s.decide();
      assert.equal(decided.f.classified.outcome, 'quota-hold', label);
      let r = decided.r;
      assert.equal(r.directive.kind, 'wait', `${label}: ${r.directive.narration}`);
      if (r.directive.kind === 'wait') {
        assert.equal(r.directive.on, 'review-quota');
        assert.ok(r.directive.narration.startsWith('Base-sync reviewer codex-bs reported a quota/rate limit'), `${label}: ${r.directive.narration}`);
        assert.doesNotMatch(r.directive.narration, /primary|backup/, `${label}: neither the primary nor the fallback is named as held`);
      }
      s.fx.advance(61_000);
      r = s.runner.next(s.g(), s.card, r.run);
      assert.equal(r.directive.kind, 'review', `${label}: ${r.directive.narration}`);
      if (r.directive.kind === 'review') assert.equal(r.directive.reviewer, 'codex-bs', `${label}: the base-sync reviewer runs once its hold clears`);
    } finally {
      s.fx.cleanup();
    }
  }
});

test('T0-BASE-SYNC-HOLD-NARRATION acceptance 3: the CHANGELOG Unreleased section states the fix', () => {
  const changelog = readFileSync(path.join(path.resolve(import.meta.dirname, '..', '..'), 'CHANGELOG.md'), 'utf8').replace(/\r\n/g, '\n');
  const unreleased = changelog.slice(changelog.indexOf('## Unreleased'), changelog.indexOf('\n## ', changelog.indexOf('## Unreleased') + 1));
  const sentence = '- Base-sync hold narration, card T0-BASE-SYNC-HOLD-NARRATION: a quota hold of the base-sync reviewer now makes `aidlc card next` wait with a narration that names the base-sync reviewer as held; with a fallback configured it used to say that the primary and the fallback both reported a quota, which was false.';
  assert.ok(unreleased.includes(sentence), `CHANGELOG.md Unreleased states: ${sentence}`);
});
