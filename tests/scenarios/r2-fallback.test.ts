import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import type { CardRun, PreReviewRound } from '../../src/core/types.ts';

/** The stderr the DeepSeek CLI printed on each round-3 angle of issue #92: a billing hold since T0-R2-BILLING-HOLD. */
const INSUFFICIENT_BALANCE = 'ERROR 402: {"error":{"message":"Insufficient Balance (request_id: e1f8c686-3ba1-4d72-bbba-204d56dbd462)","type":"unknown_error","param":null,"code":"invalid_request_error"}}\n';
const PASS = { stdout: '{"verdict":"pass","reasons":[]}\n' };
const HOLD_MS = 15 * 60 * 1000;
/** The reconciliation grace after a reviewer timeout before a pending round is dropped (RECONCILE_GRACE_MS). */
const GRACE_MS = 5 * 60 * 1000;

type Output = { stdout?: string; stderr?: string; exitCode?: number };

interface Options {
  /** false: no preReview.fallback. */
  fallback?: boolean;
  changedPath?: string;
  fallbackCap?: number;
  fallbackTimeoutMs?: number;
  /** The primary's argv after its command name. */
  primaryArgs?: string[];
  /** The fallback's argv after its command name; `--effort {effort}` by default. */
  fallbackArgs?: string[];
  /** A fallback with only its command, reviewer and effort policy: every other setting omitted (T0-R2-FALLBACK-2). */
  fallbackBare?: boolean;
  /** The primary's `shell` and `answerMarker`, unset by default. */
  primaryShell?: boolean;
  primaryMarker?: string;
}

/**
 * A card with a primary pre-reviewer (`deepseek`, timeout 1 s) and, unless `fallback` is false, a fallback (`sonnet`) whose
 * argv carries `{effort}` under the policy high, xhigh from 500 changed lines or a change under src/core. Each reviewer
 * answers from its own queue (a pass when it is empty); every call is logged with its argv.
 */
function setup(options: Options = {}) {
  const changedPath = options.changedPath ?? 'src/t1-gate.ts';
  const effort = { default: 'high', xhigh: { minChangedLines: 500, paths: ['src/core/**'] } };
  const fallback = options.fallback === false ? {} : options.fallbackBare ? { fallback: { command: ['fallback-reviewer', '--effort', '{effort}'], reviewer: 'sonnet', effort } } : {
    fallback: {
      command: ['fallback-reviewer', ...(options.fallbackArgs ?? ['--effort', '{effort}'])],
      reviewer: 'sonnet',
      timeoutMs: options.fallbackTimeoutMs ?? 1000,
      shell: false,
      ...(options.fallbackCap ? { maxDiffBytes: options.fallbackCap } : {}),
      effort,
    },
  };
  const primaryExtra = { shell: options.primaryShell ?? false, ...(options.primaryMarker ? { answerMarker: options.primaryMarker } : {}) };
  const fx = makeFixture({ config: { preReview: { command: ['primary-reviewer', ...(options.primaryArgs ?? [])], reviewer: 'deepseek', rounds: 2, timeoutMs: 1000, onExhausted: 'stop', ...primaryExtra, ...fallback } } });
  const primary: Output[] = [];
  const secondary: Output[] = [];
  const calls: string[][] = [];
  const hooks: { onDiff?: () => void } = {};
  /** The spawn options of every reviewer call: the shell and the timeout the dispatch chose. */
  const spawned: Array<{ command: string; shell?: boolean; timeoutMs?: number }> = [];
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
  const recording: SyncRunner = (command, args, spawnOptions) => {
    if (command.endsWith('-reviewer')) spawned.push({ command, shell: spawnOptions?.shell, timeoutMs: spawnOptions?.timeoutMs });
    return script(command, args, spawnOptions);
  };
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: recording });
  writeCard(fx, { id: 'T1-GATE', title: 'gate the ship', allowPaths: [changedPath] });
  const goal = fx.controller.createGoal({ text: 'implement T1-GATE', source: 'card', ref: 'T1-GATE', affectedSurfaces: [] }, { cards: ['T1-GATE'] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-GATE'] } });
  const card = fx.card('T1-GATE');
  const r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-GATE'));
  assert.equal(r.directive.kind, 'prepare');
  const run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: 'sha-1' });
  return { fx, runner, card, goalId: goal.id, run, primary, secondary, calls, hooks, spawned };
}

type Setup = ReturnType<typeof setup>;
type Reviewed = Awaited<ReturnType<CardRunner['preReview']>>;
const next = (s: Setup, run: CardRun) => s.runner.next(s.fx.goal(s.goalId), s.card, run);
const review = (s: Setup, run: CardRun) => s.runner.preReview(s.fx.goal(s.goalId), s.card, run);
function preReviewDirective(s: Setup, run: CardRun): { run: CardRun; reviewer: string; round: number; narration: string } {
  const r = next(s, run);
  assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
  if (r.directive.kind !== 'pre-review') throw new Error('unreachable');
  return { run: r.run, reviewer: r.directive.reviewer, round: r.directive.round, narration: r.directive.narration };
}
/** Hold the primary with the 402 answer, and return the run the review recorded. */
async function holdPrimary(s: Setup, run: CardRun): Promise<CardRun> {
  s.primary.push({ stderr: INSUFFICIENT_BALANCE, exitCode: 1 });
  const d = preReviewDirective(s, run);
  assert.equal(d.reviewer, 'deepseek', 'the primary runs first');
  const held = await review(s, d.run);
  assert.equal(held.result.outcome, 'quota-hold');
  assert.equal(held.round.reviewer, 'deepseek');
  return held.run;
}
const decidedEvents = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'PRE_REVIEW_DECIDED').map((e) => e.data as Record<string, unknown>);
/**
 * Every record of one decided round names the reviewer that ran and the level `{effort}` expanded to: the round, its
 * PRE_REVIEW_DECIDED event and its evidence note, each with no level when none was expanded.
 */
function assertRecordedBy(s: Setup, reviewed: Reviewed, reviewer: string, effort: string | undefined): void {
  assert.equal(reviewed.round.reviewer, reviewer, 'the round names the reviewer that ran');
  assert.equal(reviewed.round.effort, effort, 'the round records the level');
  const event = decidedEvents(s.fx, s.goalId).at(-1)!;
  assert.equal(event['reviewer'], reviewer, 'PRE_REVIEW_DECIDED names the reviewer that ran');
  assert.equal(event['effort'], effort, 'PRE_REVIEW_DECIDED carries the level');
  assert.equal('effort' in event, effort !== undefined, 'an event without a level has no effort key');
  const notes = (reviewed.run.evidence ?? []).map((e) => e.note ?? '');
  const note = `pre-review ${reviewer}${effort ? ` (effort ${effort})` : ''} ${reviewed.result.outcome}:`;
  assert.equal(notes.at(-1)?.startsWith(note), true, `the evidence note of the round is "${note} ...": ${JSON.stringify(notes)}`);
}
/** A pass opens the ship: the gate ships the candidate in the same call and the card reaches CLOSE. */
function assertShips(s: Setup, run: CardRun): void {
  const shipped = next(s, run);
  assert.equal(shipped.directive.kind, 'close', shipped.directive.narration);
  assert.equal(shipped.run.state, 'CLOSE');
}
const withCard = (fn: (s: Setup) => Promise<void>, options?: Options) => async () => {
  const s = setup(options);
  try {
    await fn(s);
  } finally {
    s.fx.cleanup();
  }
};

test('T0-R2-FALLBACK acceptance 3: a primary held on 402 hands the round to the fallback at high; the round, its event and its evidence note name the fallback and the level; the pass ships [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet', 'the gate names the fallback, not WAIT');
  assert.equal(d.round, 1, 'the hold consumed no round');
  assert.ok(d.narration.includes('(R2, sonnet)'), d.narration);
  assert.ok(d.narration.includes('(the primary deepseek is on a quota hold; its fallback runs)'), d.narration);
  assert.ok(!d.narration.includes('retry once it clears'), `a switch is no retry of the held reviewer: ${d.narration}`);
  const passed = await review(s, d.run);
  assert.equal(passed.result.outcome, 'pass');
  assert.deepEqual(s.calls, [['primary-reviewer'], ['fallback-reviewer', '--effort', 'high']], 'the fallback ran with {effort} expanded to high for a small candidate');
  assertRecordedBy(s, passed, 'sonnet', 'high');
  assert.deepEqual(passed.run.preReview.rounds.map((r) => [r.reviewer, r.outcome, r.effort]), [['deepseek', 'quota-hold', undefined], ['sonnet', 'pass', 'high']]);
  assertShips(s, passed.run);
}));

test('T0-R2-FALLBACK acceptance 3: a candidate under src/core runs the fallback at xhigh, recorded on the round, its event and its evidence note; the pass ships [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet');
  const passed = await review(s, d.run);
  assert.deepEqual(s.calls.at(-1), ['fallback-reviewer', '--effort', 'xhigh']);
  assertRecordedBy(s, passed, 'sonnet', 'xhigh');
  assertShips(s, passed.run);
}, { changedPath: 'src/core/gate.ts' }));

test('T0-R2-FALLBACK acceptance 3: the diff cap of the fallback applies, and its refusal names preReview.fallback.maxDiffBytes [R1] [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet');
  await assert.rejects(review(s, d.run), /preReview\.fallback\.maxDiffBytes/);
  assert.ok(!s.calls.some((c) => c[0] === 'fallback-reviewer'), 'a refused diff dispatches nothing');
}, { fallbackCap: 10 }));

for (const fallback of [false, true]) {
  test(`T0-R2-FALLBACK acceptance 5: a primary argv with a literal {effort} is dispatched unchanged and records no level, ${fallback ? 'with a fallback configured and the primary not held' : 'without a fallback'} [R3]`, withCard(async (s) => {
    const d = preReviewDirective(s, s.run);
    assert.equal(d.reviewer, 'deepseek');
    const passed = await review(s, d.run);
    assert.deepEqual(s.calls, [['primary-reviewer', '--effort', '{effort}']], 'the primary has no effort policy: {effort} stays as written');
    assertRecordedBy(s, passed, 'deepseek', undefined);
  }, { fallback, primaryArgs: ['--effort', '{effort}'] }));
}

test('T0-R2-FALLBACK acceptance 4: the no-verdict retry is shared: a primary no-verdict, a primary hold and a fallback no-verdict stop the card, with no further dispatch [R3]', withCard(async (s) => {
  s.primary.push({ stdout: 'I cannot decide.\n' });
  let d = preReviewDirective(s, s.run);
  const first = await review(s, d.run);
  assert.equal(first.result.outcome, 'no-verdict');
  assert.equal(first.round.reviewer, 'deepseek');
  const afterHold = await holdPrimary(s, first.run);
  s.secondary.push({ stdout: 'I cannot decide either.\n' });
  d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet');
  const second = await review(s, d.run);
  assert.equal(second.result.outcome, 'no-verdict');
  // The primary's hold expires before the gate reads the record: the stop still names the reviewer whose round was last.
  s.fx.advance(HOLD_MS + 1_000);
  const stopped = next(s, second.run);
  assert.equal(stopped.directive.kind, 'stop', stopped.directive.narration);
  assert.equal(stopped.run.stop?.reason, 'tool');
  assert.ok(stopped.run.stop?.detail.startsWith('pre-reviewer sonnet produced no usable verdict twice in R3 cycle 0'), stopped.run.stop?.detail);
  assert.deepEqual(s.calls, [['primary-reviewer'], ['primary-reviewer'], ['fallback-reviewer', '--effort', 'high']], 'one no-verdict each, one hold, and nothing after the stop');
}));

test('T0-R2-FALLBACK acceptance 4: a fallback no-verdict is retried on the fallback while the primary holds, and a second one stops the card [R3]', withCard(async (s) => {
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
  assert.ok(stopped.run.stop?.detail.startsWith('pre-reviewer sonnet produced no usable verdict twice'), stopped.run.stop?.detail);
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
  assertRecordedBy(s, passed, 'sonnet', 'high');
}));

test('T0-R2-FALLBACK acceptance 4: with both held the gate waits until the earlier hold and names both; the reviewer whose hold cleared runs; the primary runs again once its hold clears [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  s.secondary.push({ stderr: 'Error: 429 Too Many Requests, retry after 60 seconds\n', exitCode: 1 });
  let d = preReviewDirective(s, afterHold);
  const fallbackHeld = await review(s, d.run);
  assert.equal(fallbackHeld.result.outcome, 'quota-hold');
  assert.equal(fallbackHeld.round.reviewer, 'sonnet');
  const fallbackHold = fallbackHeld.round.holdUntil!;
  assert.equal(fallbackHold, new Date(Date.parse(s.fx.now()) + 60_000).toISOString(), 'the fallback holds for its 60 s');
  const waiting = next(s, fallbackHeld.run);
  assert.deepEqual(waiting.directive, { kind: 'wait', cardId: 'T1-GATE', on: 'pre-review-quota', pollSeconds: 60, narration: `Pre-reviewers deepseek and fallback sonnet both reported a quota/rate limit; holding until ${fallbackHold} (no round consumed). Continue independent work within limits, then run \`aidlc card next T1-GATE\`.` });
  await assert.rejects(review(s, waiting.run), { message: `pre-reviewer sonnet is on a quota hold until ${fallbackHold}; do not re-run before it clears` }, 'review pre refuses while both hold');
  s.fx.advance(61_000);
  d = preReviewDirective(s, waiting.run);
  assert.equal(d.reviewer, 'sonnet', 'the reviewer whose hold cleared first runs next');
  s.fx.advance(HOLD_MS);
  d = preReviewDirective(s, d.run);
  assert.equal(d.reviewer, 'deepseek', 'the primary runs again once its hold clears');
  const passed = await review(s, d.run);
  assertRecordedBy(s, passed, 'deepseek', undefined);
  assert.deepEqual(s.calls.at(-1), ['primary-reviewer']);
}));

test('T0-R2-FALLBACK acceptance 4: a reservation whose reviewer changed since the first read is refused: a hold recorded meanwhile [R3]', withCard(async (s) => {
  const d = preReviewDirective(s, s.run);
  assert.equal(d.reviewer, 'deepseek');
  // A concurrent round records a primary hold while this dispatch collects its diff, before its reservation.
  s.hooks.onDiff = () => {
    s.hooks.onDiff = undefined;
    s.fx.store.updateCardRun(s.goalId, s.card.id, (current) => {
      const latest = current!;
      const held: PreReviewRound = { round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: latest.candidate?.digest ?? 'sha-1', candidateSha: 'sha-1', requestedAt: s.fx.now(), durationMs: 0, outcome: 'quota-hold', reasons: ['via text: Insufficient Balance'], holdUntil: new Date(Date.parse(s.fx.now()) + HOLD_MS).toISOString(), advisory: [] };
      return { ...latest, preReview: { ...latest.preReview, rounds: [...latest.preReview.rounds, held] } };
    });
  };
  await assert.rejects(review(s, d.run), /the pre-reviewer changed since the first read \(deepseek, now sonnet: .*run the command again/);
  const stored = s.fx.store.getCardRun(s.goalId, s.card.id)!;
  assert.deepEqual(stored.preReview.rounds.map((r) => [r.reviewer, r.outcome]), [['deepseek', 'quota-hold']], 'only the concurrent hold is recorded');
  assert.equal(s.calls.length, 0, 'no reviewer ran');
}));

test('T0-R2-FALLBACK acceptance 4: a reservation whose reviewer changed since the first read is refused: the primary hold expired while the diff was collected [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet');
  s.hooks.onDiff = () => {
    s.hooks.onDiff = undefined;
    s.fx.advance(HOLD_MS + 1_000);
  };
  await assert.rejects(review(s, d.run), /the pre-reviewer changed since the first read \(sonnet, now deepseek: .*run the command again/);
  assert.ok(!s.calls.some((c) => c[0] === 'fallback-reviewer'), 'the fallback never runs once the primary is free');
  assert.deepEqual(s.fx.store.getCardRun(s.goalId, s.card.id)!.preReview.rounds.map((r) => [r.reviewer, r.outcome]), [['deepseek', 'quota-hold']]);
  assert.equal(preReviewDirective(s, afterHold).reviewer, 'deepseek', 'the gate now names the primary');
}));

test('T0-R2-FALLBACK acceptance 4: a pending round expires on the timeout of the reviewer it names: the fallback round is still in flight when a primary round would be dropped [R3]', async () => {
  for (const [reviewer, stillPending] of [['sonnet', true], ['deepseek', false]] as const) {
    const s = setup({ fallbackTimeoutMs: 600_000 });
    try {
      const reservationId = `T1-GATE.pre.0.1.1.${reviewer === 'sonnet' ? 'aaaaaaaa' : 'bbbbbbbb'}`;
      s.fx.store.updateCardRun(s.goalId, s.card.id, (current) => {
        const latest = current!;
        const pending: PreReviewRound = { round: 1, cycle: 0, reviewer, candidateDigest: latest.candidate?.digest ?? 'sha-1', candidateSha: 'sha-1', requestedAt: s.fx.now(), durationMs: 0, outcome: 'pending', reasons: [], reservationId, advisory: [] };
        return { ...latest, preReview: { ...latest.preReview, rounds: [...latest.preReview.rounds, pending] } };
      });
      // Past the primary's 1 s timeout and the grace, well inside the fallback's 600 s.
      s.fx.advance(1_000 + GRACE_MS + 1_000);
      const r = next(s, s.fx.store.getCardRun(s.goalId, s.card.id)!);
      if (stillPending) {
        assert.equal(r.directive.kind, 'wait', r.directive.narration);
        if (r.directive.kind === 'wait') assert.equal(r.directive.on, `pre-review:${reservationId}`);
        assert.ok(r.directive.narration.endsWith('A round is dropped 15 minutes after its dispatch when nothing came back.'), `the fallback timeout of 600 s plus the 5 min grace: ${r.directive.narration}`);
        assert.equal(r.run.preReview.rounds.at(-1)?.outcome, 'pending', 'the fallback round keeps running');
      } else {
        assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
        assert.deepEqual(r.run.preReview.rounds, [], 'the abandoned primary round is dropped');
      }
    } finally {
      s.fx.cleanup();
    }
  }
});

test('T0-R2-FALLBACK acceptance 5: without preReview.fallback the 402 round, the WAIT directive, the refusal and the directive after the hold are as before this card [R3]', withCard(async (s) => {
  const start = s.fx.now();
  const afterHold = await holdPrimary(s, s.run);
  const held = afterHold.preReview.rounds.at(-1)!;
  const holdUntil = new Date(Date.parse(start) + HOLD_MS).toISOString();
  const { reservationId, verdictRef, receiptSha256, policyHash, ...stable } = held;
  assert.match(reservationId ?? '', /^T1-GATE\.pre\.0\.1\.1\.[0-9a-f]{8}$/);
  assert.ok(verdictRef?.endsWith(`${reservationId}.json`), verdictRef);
  assert.match(receiptSha256 ?? '', /^[0-9a-f]{64}$/);
  assert.match(policyHash ?? '', /^[0-9a-f]{64}$/);
  assert.deepEqual(stable, {
    round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: 'sha-1', candidateSha: 'sha-1', requestedAt: start, durationMs: 0, outcome: 'quota-hold', runStatus: 'tool_error',
    reasons: ['via text: Insufficient Balance'], advisory: [], holdUntil, coverage: undefined,
    perspectives: [{ name: 'review', outcome: 'quota-hold', runStatus: 'tool_error', reasons: ['via text: Insufficient Balance'], durationMs: 0, verdictRef: undefined, receiptSha256 }],
  }, 'the round, field for field');
  const waiting = next(s, afterHold);
  assert.deepEqual(waiting.directive, { kind: 'wait', cardId: 'T1-GATE', on: 'pre-review-quota', pollSeconds: 900, narration: `Pre-reviewer deepseek reported a quota/rate limit; holding until ${holdUntil} (no round consumed). Continue independent work within limits, then run \`aidlc card next T1-GATE\`.` });
  assert.equal(waiting.run.state, 'WAIT');
  await assert.rejects(review(s, waiting.run), { message: `pre-reviewer deepseek is on a quota hold until ${holdUntil}; do not re-run before it clears` });
  s.fx.advance(HOLD_MS + 1_000);
  const d = preReviewDirective(s, waiting.run);
  assert.equal(d.reviewer, 'deepseek');
  assert.equal(d.round, 1);
  assert.equal(d.narration, 'Pre-review round 1/2 (R2, deepseek) before the ship (the previous run reported a quota hold; retry once it clears): run `aidlc review pre T1-GATE`. A pass hands the candidate to the ship and R3; a block returns to BUILD with the reasons.');
  const passed = await review(s, d.run);
  assertRecordedBy(s, passed, 'deepseek', undefined);
  assert.ok(!s.calls.some((c) => c[0] === 'fallback-reviewer'), 'no fallback is configured, so none runs');
}, { fallback: false }));

test('T0-R2-FALLBACK acceptance 3: a fallback argv without {effort} runs as written and records no level on the round, its event or its evidence note [R3]', withCard(async (s) => {
  const afterHold = await holdPrimary(s, s.run);
  const d = preReviewDirective(s, afterHold);
  assert.equal(d.reviewer, 'sonnet');
  const passed = await review(s, d.run);
  assert.deepEqual(s.calls.at(-1), ['fallback-reviewer', '--model', 'sonnet']);
  assertRecordedBy(s, passed, 'sonnet', undefined);
}, { fallbackArgs: ['--model', 'sonnet'] }));

test('T0-R2-FALLBACK acceptance 5: without preReview.fallback two no-verdicts stop the card naming the configured reviewer, as before, when the rounds carry an earlier name [R3]', withCard(async (s) => {
  // Two no-verdict rounds of this candidate recorded under the name the reviewer had before a configuration change.
  s.fx.store.updateCardRun(s.goalId, s.card.id, (current) => {
    const latest = current!;
    const round = (n: number): PreReviewRound => ({ round: 1, cycle: 0, reviewer: 'renamed-reviewer', candidateDigest: latest.candidate?.digest ?? 'sha-1', candidateSha: 'sha-1', requestedAt: s.fx.now(), durationMs: 0, outcome: 'no-verdict', runStatus: 'malformed', reasons: [], reservationId: `T1-GATE.pre.0.1.${n}.cccccccc`, advisory: [] });
    return { ...latest, preReview: { ...latest.preReview, rounds: [round(1), round(2)] } };
  });
  const stopped = next(s, s.fx.store.getCardRun(s.goalId, s.card.id)!);
  assert.equal(stopped.directive.kind, 'stop', stopped.directive.narration);
  assert.ok(stopped.run.stop?.detail.startsWith('pre-reviewer deepseek produced no usable verdict twice in R3 cycle 0 (malformed)'), stopped.run.stop?.detail);
}, { fallback: false }));

test('T0-R2-FALLBACK-2 acceptance 4: a pending primary round shows the primary minutes in its WAIT text [R3]', async () => {
  const s = setup({ fallbackTimeoutMs: 600_000 });
  try {
    const reservationId = 'T1-GATE.pre.0.1.1.dddddddd';
    s.fx.store.updateCardRun(s.goalId, s.card.id, (current) => {
      const latest = current!;
      const pending: PreReviewRound = { round: 1, cycle: 0, reviewer: 'deepseek', candidateDigest: latest.candidate?.digest ?? 'sha-1', candidateSha: 'sha-1', requestedAt: s.fx.now(), durationMs: 0, outcome: 'pending', reasons: [], reservationId, advisory: [] };
      return { ...latest, preReview: { ...latest.preReview, rounds: [...latest.preReview.rounds, pending] } };
    });
    const r = next(s, s.fx.store.getCardRun(s.goalId, s.card.id)!);
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    assert.ok(r.directive.narration.endsWith('A round is dropped 5 minutes after its dispatch when nothing came back.'), `the primary 1 s plus the 5 min grace: ${r.directive.narration}`);
  } finally {
    s.fx.cleanup();
  }
});

for (const primaryShell of [true, false]) {
  test(`T0-R2-FALLBACK-2 acceptance 6: a fallback that omits shell, timeoutMs and answerMarker runs with the platform shell default, its own default timeout and no marker under a primary with shell ${primaryShell}, a 1 s timeout and a marker [R4]`, withCard(async (s) => {
    const afterHold = await holdPrimary(s, s.run);
    const d = preReviewDirective(s, afterHold);
    assert.equal(d.reviewer, 'sonnet');
    const passed = await review(s, d.run);
    assert.equal(passed.result.outcome, 'pass', 'an unmarked fallback verdict passes: the primary marker is not the fallback marker');
    const spawn = s.spawned.filter((x) => x.command === 'fallback-reviewer');
    assert.equal(spawn.length, 1);
    assert.equal(spawn[0]!.shell, process.platform === 'win32', `the platform default, never the primary shell ${primaryShell}`);
    assert.equal(spawn[0]!.timeoutMs, 600_000, 'the fallback schema default timeout, never the primary 1 s');
    assert.equal(s.spawned.find((x) => x.command === 'primary-reviewer')?.shell, primaryShell, 'the primary keeps its own shell');
  }, { fallbackBare: true, primaryShell, primaryMarker: '=== answer ===' }));
}
