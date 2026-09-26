import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { CardRun } from '../../src/core/types.ts';

/** The stderr the DeepSeek CLI printed on each round-3 angle of issue #92: a billing hold since T0-R2-BILLING-HOLD. */
const INSUFFICIENT_BALANCE = 'ERROR 402: {"error":{"message":"Insufficient Balance (request_id: e1f8c686-3ba1-4d72-bbba-204d56dbd462)","type":"unknown_error","param":null,"code":"invalid_request_error"}}\n';
const PASS = { stdout: '{"verdict":"pass","reasons":[]}\n' };
const HOLD_MS = 15 * 60 * 1000;

type Output = { stdout?: string; stderr?: string; exitCode?: number };

/**
 * A card with a primary pre-reviewer (`deepseek`) and, unless `fallback` is false, a fallback (`sonnet`) whose argv carries
 * `{effort}` under the policy high, xhigh from 500 changed lines or a change under src/core. Each reviewer answers from its
 * own queue (a pass when it is empty); every call is logged with its argv.
 */
function setup(options: { fallback?: boolean; changedPath?: string; fallbackCap?: number } = {}) {
  const changedPath = options.changedPath ?? 'src/t1-gate.ts';
  const fallback = options.fallback === false ? {} : { fallback: { command: ['fallback-reviewer', '--effort', '{effort}'], reviewer: 'sonnet', timeoutMs: 1000, shell: false, ...(options.fallbackCap ? { maxDiffBytes: options.fallbackCap } : {}), effort: { default: 'high', xhigh: { minChangedLines: 500, paths: ['src/core/**'] } } } };
  const fx = makeFixture({ config: { preReview: { command: ['primary-reviewer'], reviewer: 'deepseek', rounds: 2, timeoutMs: 1000, onExhausted: 'stop', shell: false, ...fallback } } });
  const primary: Output[] = [];
  const secondary: Output[] = [];
  const calls: string[][] = [];
  const hooks: { onDiff?: () => void } = {};
  const script = scriptedRunner({
    'git diff --name-only': { stdout: `${changedPath}\u0000` },
    'git diff': () => {
      hooks.onDiff?.();
      return { stdout: `diff --git a/${changedPath} b/${changedPath}\n@@ -1 +1 @@\n-export const gate = 0;\n+export const gate = 1;\n` };
    },
    'primary-reviewer': (args) => {
      calls.push(['primary-reviewer', ...args]);
      return primary.shift() ?? PASS;
    },
    'fallback-reviewer': (args) => {
      calls.push(['fallback-reviewer', ...args]);
      return secondary.shift() ?? PASS;
    },
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  writeCard(fx, { id: 'T1-GATE', title: 'gate the ship', allowPaths: [changedPath] });
  const goal = fx.controller.createGoal({ text: 'implement T1-GATE', source: 'card', ref: 'T1-GATE', affectedSurfaces: [] }, { cards: ['T1-GATE'] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-GATE'] } });
  const card = fx.card('T1-GATE');
  const r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-GATE'));
  assert.equal(r.directive.kind, 'prepare');
  const run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: 'sha-1' });
  return { fx, runner, card, goalId: goal.id, run, primary, secondary, calls, hooks };
}

type Setup = ReturnType<typeof setup>;
const next = (s: Setup, run: CardRun) => s.runner.next(s.fx.goal(s.goalId), s.card, run);
const review = (s: Setup, run: CardRun) => s.runner.preReview(s.fx.goal(s.goalId), s.card, run);
function preReviewDirective(s: Setup, run: CardRun): { run: CardRun; reviewer: string; round: number; narration: string } {
  const r = next(s, run);
  assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
  if (r.directive.kind !== 'pre-review') throw new Error('unreachable');
  return { run: r.run, reviewer: r.directive.reviewer, round: r.directive.round, narration: r.directive.narration };
}
/** Hold the primary with the 402 answer, and return the run the gate returns after it. */
async function holdPrimary(s: Setup, run: CardRun): Promise<CardRun> {
  s.primary.push({ stderr: INSUFFICIENT_BALANCE, exitCode: 1 });
  const d = preReviewDirective(s, run);
  assert.equal(d.reviewer, 'deepseek', 'the primary runs first');
  const held = await review(s, d.run);
  assert.equal(held.result.outcome, 'quota-hold');
  assert.equal(held.round.reviewer, 'deepseek');
  return held.run;
}
const events = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'PRE_REVIEW_DECIDED').map((e) => e.data as Record<string, unknown>);
const withCard = (fn: (s: Setup) => Promise<void>, options?: Parameters<typeof setup>[0]) => async () => {
  const s = setup(options);
  try {
    await fn(s);
  } finally {
    s.fx.cleanup();
  }
};

test('T0-R2-FALLBACK acceptance 3: a primary held on 402 hands the round to the fallback at high effort; the round, its event and its evidence note name the fallback and the level; a pass opens the ship [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet', 'the gate names the fallback, not WAIT');
  assert.equal(d.round, 1, 'the hold consumed no round');
  assert.ok(d.narration.includes('(R2, sonnet)'), d.narration);
  assert.ok(d.narration.includes('(the primary deepseek is on a quota hold; its fallback runs)'), d.narration);
  assert.ok(!d.narration.includes('retry once it clears'), `a switch is no retry of the held reviewer: ${d.narration}`);
  const passed = await review(s, d.run);
  assert.equal(passed.result.outcome, 'pass');
  assert.deepEqual(s.calls.at(-1), ['fallback-reviewer', '--effort', 'high'], 'the fallback ran with {effort} expanded to high for a small candidate');
  assert.equal(passed.round.reviewer, 'sonnet');
  assert.equal(passed.round.effort, 'high');
  const last = events(s.fx, s.goalId).at(-1);
  assert.equal(last?.['reviewer'], 'sonnet', 'PRE_REVIEW_DECIDED names the fallback');
  assert.ok((passed.run.evidence ?? []).some((e) => e.note?.startsWith('pre-review sonnet pass')), JSON.stringify(passed.run.evidence));
  assert.deepEqual(passed.run.preReview.rounds.map((r) => [r.reviewer, r.outcome]), [['deepseek', 'quota-hold'], ['sonnet', 'pass']]);
  assert.equal(passed.run.preReview.rounds[0]?.effort, undefined, 'a primary with no {effort} records no level');
  const shipped = next(s, passed.run);
  assert.notEqual(shipped.directive.kind, 'pre-review', 'the pass opens the ship');
  assert.notEqual(shipped.directive.kind, 'wait', shipped.directive.narration);
}));

test('T0-R2-FALLBACK acceptance 3: a candidate under src/core runs the fallback at xhigh [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet');
  const passed = await review(s, d.run);
  assert.deepEqual(s.calls.at(-1), ['fallback-reviewer', '--effort', 'xhigh']);
  assert.equal(passed.round.effort, 'xhigh');
}, { changedPath: 'src/core/gate.ts' }));

test('T0-R2-FALLBACK acceptance 4: a fallback no-verdict is retried on the fallback while the primary holds, and a second one stops the card: the retry is shared [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  s.secondary.push({ stdout: 'I cannot decide.\n' });
  let d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet');
  const first = await review(s, d.run);
  assert.equal(first.result.outcome, 'no-verdict');
  d = preReviewDirective(s, first.run);
  assert.equal(d.reviewer, 'sonnet', 'a no-verdict never switches reviewer, and the primary still holds');
  assert.ok(d.narration.includes('(retry: the previous run produced no verdict)'), d.narration);
  s.secondary.push({ stdout: 'I still cannot decide.\n' });
  const second = await review(s, d.run);
  assert.equal(second.result.outcome, 'no-verdict');
  const stopped = next(s, second.run);
  assert.equal(stopped.directive.kind, 'stop', stopped.directive.narration);
  assert.equal(stopped.run.stop?.reason, 'tool');
  assert.ok(stopped.run.stop?.detail.includes('sonnet'), stopped.run.stop?.detail);
}));

test('T0-R2-FALLBACK acceptance 4: a fallback block returns the card to BUILD and the repaired candidate goes to the fallback while the primary still holds [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  s.secondary.push({ stdout: '{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-gate.ts:1: no RED -> add a failing test first"]}\n' });
  const d = preReviewDirective(s, afterHold);
  const blocked = await review(s, d.run);
  assert.equal(blocked.result.outcome, 'block');
  assert.equal(blocked.run.state, 'BUILD');
  const build = next(s, blocked.run);
  assert.equal(build.directive.kind, 'build', build.directive.narration);
  const repaired = s.runner.recordAttempt(s.fx.goal(s.goalId), s.card, build.run, { outcome: 'success', dodReceipt: 'dod:ok2', redReceipt: 'red:ok', candidateSha: 'sha-2' });
  const again = preReviewDirective(s, repaired);
  assert.equal(again.reviewer, 'sonnet', 'the primary hold belongs to the reviewer, on any candidate');
  assert.equal(again.round, 2);
  const passed = await review(s, again.run);
  assert.equal(passed.round.reviewer, 'sonnet');
}));

test('T0-R2-FALLBACK acceptance 4: once the primary hold clears the primary runs again; with both held the gate waits until the earlier hold and names both [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  s.secondary.push({ stderr: 'Error: 429 Too Many Requests, retry after 60 seconds\n', exitCode: 1 });
  let d = preReviewDirective(s, afterHold);
  const fallbackHeld = await review(s, d.run);
  assert.equal(fallbackHeld.result.outcome, 'quota-hold');
  assert.equal(fallbackHeld.round.reviewer, 'sonnet');
  const waiting = next(s, fallbackHeld.run);
  assert.equal(waiting.directive.kind, 'wait', waiting.directive.narration);
  if (waiting.directive.kind === 'wait') {
    assert.equal(waiting.directive.on, 'pre-review-quota');
    assert.ok(waiting.directive.narration.includes('deepseek') && waiting.directive.narration.includes('sonnet'), waiting.directive.narration);
    assert.ok(waiting.directive.pollSeconds <= 61, `the earlier hold, the fallback's 60 s: ${waiting.directive.pollSeconds}`);
  }
  await assert.rejects(review(s, waiting.run), /quota hold/, 'review pre refuses while both hold');
  s.fx.advance(61_000);
  d = preReviewDirective(s, waiting.run);
  assert.equal(d.reviewer, 'sonnet', 'the reviewer whose hold cleared first runs next');
  s.fx.advance(HOLD_MS);
  d = preReviewDirective(s, d.run);
  assert.equal(d.reviewer, 'deepseek', 'the primary runs again once its hold clears');
  const passed = await review(s, d.run);
  assert.equal(passed.round.reviewer, 'deepseek');
  assert.deepEqual(s.calls.at(-1), ['primary-reviewer']);
}));

test('T0-R2-FALLBACK acceptance 4: a reservation whose reviewer changed since the first read is refused, and no round is recorded [R3]', withCard(async (s) => {
  const d = preReviewDirective(s, s.run);
  assert.equal(d.reviewer, 'deepseek');
  // A concurrent round records a primary hold while this dispatch collects its diff, before its reservation.
  s.hooks.onDiff = () => {
    s.hooks.onDiff = undefined;
    s.fx.store.updateCardRun(s.goalId, s.card.id, (current) => {
      const latest = current!;
      const held = { round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: latest.candidate?.digest ?? 'sha-1', candidateSha: 'sha-1', requestedAt: s.fx.now(), durationMs: 0, outcome: 'quota-hold' as const, reasons: ['via text: Insufficient Balance'], holdUntil: new Date(Date.parse(s.fx.now()) + HOLD_MS).toISOString(), advisory: [] };
      return { ...latest, preReview: { ...latest.preReview, rounds: [...latest.preReview.rounds, held] } };
    });
  };
  await assert.rejects(review(s, d.run), /run the command again/);
  const stored = s.fx.store.getCardRun(s.goalId, s.card.id)!;
  assert.deepEqual(stored.preReview.rounds.map((r) => [r.reviewer, r.outcome]), [['deepseek', 'quota-hold']], 'only the concurrent hold is recorded');
  assert.equal(s.calls.length, 0, 'no reviewer ran');
}));

test('T0-R2-FALLBACK acceptance 5: without preReview.fallback the same 402 round is WAIT on pre-review-quota, with the directive, the round and the hold as before [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const held = afterHold.preReview.rounds.at(-1)!;
  assert.equal(held.reviewer, 'deepseek');
  assert.equal(held.effort, undefined);
  const waiting = next(s, afterHold);
  assert.equal(waiting.directive.kind, 'wait', waiting.directive.narration);
  if (waiting.directive.kind === 'wait') {
    assert.equal(waiting.directive.on, 'pre-review-quota');
    assert.ok(waiting.directive.narration.startsWith(`Pre-reviewer deepseek reported a quota/rate limit; holding until ${held.holdUntil} (no round consumed).`), waiting.directive.narration);
  }
  await assert.rejects(review(s, waiting.run), new RegExp(`pre-reviewer deepseek is on a quota hold until ${held.holdUntil!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  s.fx.advance(HOLD_MS + 1_000);
  const d = preReviewDirective(s, waiting.run);
  assert.equal(d.reviewer, 'deepseek');
  assert.equal(d.round, 1);
  assert.ok(d.narration.includes('(the previous run reported a quota hold; retry once it clears)'), d.narration);
  assert.ok(!s.calls.some((c) => c[0] === 'fallback-reviewer'), 'no fallback is configured, so none runs');
}, { fallback: false }));

test('T0-R2-FALLBACK acceptance 3: the diff cap of the fallback applies, and its refusal names preReview.fallback.maxDiffBytes [R1] [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet');
  await assert.rejects(review(s, d.run), /preReview\.fallback\.maxDiffBytes/);
  assert.ok(!s.calls.some((c) => c[0] === 'fallback-reviewer'), 'a refused diff dispatches nothing');
}, { fallbackCap: 10 }));
