import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner, type ExecReceipt } from '../../src/probes/exec.ts';
import { RECONCILE_GRACE_MS, type CardRun, type Verdict } from '../../src/core/types.ts';

const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const BLOCK = '{"verdict":"block","reasons":["[spec] 6 tests @ src/t0-fb.ts:1: no RED -> add a failing test"],"axes":{"spec":{"verdict":"block","reasons":["tests"]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const HOLD_60 = '429 Too Many Requests, retry after 60 seconds\n';
const HOLD_120 = '429 Too Many Requests, retry after 120 seconds\n';

/** The fallback formal reviewer the scenarios configure. */
const FALLBACK = { command: ['fake-b', '{instructions}'], reviewer: 'backup', timeoutMs: 1000, shell: false, maxDiffBytes: 300_000 };

/**
 * A ship path whose verdict read also returns the raw text of the canonical document the command reviewer published, as
 * the scaffold and GitHub ship paths do, so the raw document's reviewer clause is exercised. The file is set once known.
 */
class RawShipPath extends DryRunShipPath {
  rawFile?: string;
  override readVerdict(): { verdict?: Verdict; raw?: string } {
    const v = super.readVerdict();
    return { ...v, raw: this.rawFile && existsSync(this.rawFile) ? readFileSync(this.rawFile, 'utf8') : undefined };
  }
}

/** A card at the R3 review directive with a primary (`fake-p`) and a fallback (`fake-b`) formal reviewer, each fed from its own queue. */
async function atReview(withFallback = true, opts: { gateRequired?: boolean; shipVerdict?: Verdict; formalReview?: Record<string, unknown>; fallback?: Record<string, unknown>; diff?: string; script?: Record<string, Partial<ExecReceipt> | ((args: string[]) => Partial<ExecReceipt>)>; allowPaths?: string[] } = {}) {
  const fx = makeFixture({
    config: {
      gateRequired: opts.gateRequired ?? true,
      preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false },
      formalReview: { command: ['fake-p', '--schema', '{schema}', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false, ...opts.formalReview, ...(withFallback ? { fallback: { ...FALLBACK, ...opts.fallback } } : {}) },
    },
  });
  const primary: string[] = [];
  const backup: string[] = [];
  const calls: string[] = [];
  /** The argv each reviewer received, one entry per run. */
  const argv: { primary: string[][]; backup: string[][] } = { primary: [], backup: [] };
  /** Runs inside the primary reviewer, before it answers. */
  const hooks: { onPrimary?: () => void } = {};
  const script = scriptedRunner({
    // Keys of a scenario come first: the runner answers the first key the command starts with.
    ...opts.script,
    // A numstat of any range says 0 lines: the effort level must come from the diff the reviewer receives.
    'git diff --numstat': { stdout: '0\t0\tsrc/t0-fb.ts\n' },
    'git diff --name-only': { stdout: 'src/t0-fb.ts\n' },
    'git diff': { stdout: opts.diff ?? 'diff --git a/src/t0-fb.ts b/src/t0-fb.ts\n+export const fb = 1;\n' },
    'fake-r2': () => ({ stdout: PASS }),
    'fake-p': (args) => {
      calls.push('primary');
      argv.primary.push(args);
      hooks.onPrimary?.();
      return { stdout: primary.shift() ?? PASS };
    },
    'fake-b': (args) => {
      calls.push('backup');
      argv.backup.push(args);
      return { stdout: backup.shift() ?? PASS };
    },
  });
  const ship = new RawShipPath(['merged', 'merged', 'merged', 'merged'], opts.shipVerdict);
  const makeRunner = (config = fx.config, repo = fx.repo) => new CardRunner({ paths: fx.paths, repo, config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  const runner = makeRunner();
  /** Open a card of its own goal and bring it to the review directive; every card reviews the same stubbed diff. */
  const open = async (id: string, sha: string) => {
    writeCard(fx, { id, title: 'formal review fallback', allowPaths: opts.allowPaths ?? ['src/t0-fb.ts'] });
    const goal = fx.controller.createGoal({ text: `implement ${id}`, source: 'card', ref: id, affectedSurfaces: [] }, { cards: [id] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [id] } });
    const card = fx.card(id);
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), id));
    const run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: sha });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    r = runner.next(fx.goal(goal.id), card, (await runner.preReview(fx.goal(goal.id), card, r.run)).run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    return { card, goalId: goal.id, g: () => fx.goal(goal.id), run: r.run };
  };
  const a = await open('T0-FB', 'sha-1');
  return { fx, runner, makeRunner, ship, open, card: a.card, goalId: a.goalId, g: a.g, primary, backup, calls, argv, hooks, run: a.run };
}

function reviewerOf(d: { kind: string; reviewer?: string }): string | undefined {
  return d.kind === 'review' ? d.reviewer : undefined;
}

test('a primary quota hold dispatches the fallback instead of WAIT; its pass is published under the fallback name and ships [R2] [R5]', async () => {
  const { fx, runner, card, g, primary, calls, run, goalId } = await atReview();
  try {
    primary.push(HOLD_60);
    let f = await runner.formalReview(g(), card, run);
    assert.equal(f.classified.outcome, 'quota-hold');
    let r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(reviewerOf(r.directive), 'backup');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(calls, ['primary', 'backup']);
    assert.equal(f.run.review.substantiveDecisions, 1);
    assert.equal(f.run.review.invocations.at(-1)?.reviewer, 'backup');
    assert.ok(f.verdictRef && existsSync(f.verdictRef));
    const canonical = JSON.parse(readFileSync(path.join(path.dirname(f.verdictRef), `${card.id}.json`), 'utf8')) as { reviewer: string; verdict: string };
    assert.equal(canonical.reviewer, 'backup');
    assert.equal(canonical.verdict, 'pass');
    const decided = fx.events(goalId).filter((e) => e.type === 'REVIEW_DECIDED').map((e) => (e.data as { reviewer: string }).reviewer);
    assert.deepEqual(decided, ['primary', 'backup']);
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'close', r.directive.narration);
    assert.equal(r.run.review.substantiveDecisions, 1, 'the ship-path re-read of the fallback decision is not a second decision');
    assert.equal(fx.ops.list({ goalId, kind: 'merge' }).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('both reviewers held is WAIT until the earlier hold clears, then the reviewer whose hold cleared runs [R3]', async () => {
  const { fx, runner, card, g, primary, backup, calls, run } = await atReview();
  try {
    primary.push(HOLD_60);
    let f = await runner.formalReview(g(), card, run);
    let r = runner.next(g(), card, f.run);
    assert.equal(reviewerOf(r.directive), 'backup');
    backup.push(HOLD_120);
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'quota-hold');
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    if (r.directive.kind === 'wait') {
      assert.equal(r.directive.on, 'review-quota');
      assert.ok(r.directive.pollSeconds <= 60, `polls at the earlier hold, got ${r.directive.pollSeconds}s`);
    }
    await assert.rejects(() => runner.formalReview(g(), card, r.run), /quota hold/);
    fx.advance(61_000);
    r = runner.next(g(), card, r.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(reviewerOf(r.directive), 'primary');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(calls, ['primary', 'backup', 'primary']);
    assert.equal(f.run.review.substantiveDecisions, 1);
  } finally {
    fx.cleanup();
  }
});

test('the primary runs again once its hold expires; without a fallback a primary hold is still WAIT [R4]', async () => {
  const a = await atReview();
  try {
    a.primary.push(HOLD_60);
    const f = await a.runner.formalReview(a.g(), a.card, a.run);
    a.fx.advance(61_000);
    const r = a.runner.next(a.g(), a.card, f.run);
    assert.equal(reviewerOf(r.directive), 'primary');
    const p = await a.runner.formalReview(a.g(), a.card, r.run);
    assert.equal(p.classified.outcome, 'pass');
    assert.deepEqual(a.calls, ['primary', 'primary'], 'the fallback never replaces a primary that is not on hold');
  } finally {
    a.fx.cleanup();
  }
  const b = await atReview(false);
  try {
    b.primary.push(HOLD_60);
    const f = await b.runner.formalReview(b.g(), b.card, b.run);
    const r = b.runner.next(b.g(), b.card, f.run);
    assert.equal(r.directive.kind, 'wait');
    if (r.directive.kind === 'wait') assert.equal(r.directive.on, 'review-quota');
  } finally {
    b.fx.cleanup();
  }
});

test('the two-decision allowance is shared across reviewers: a fallback block and a primary block stop the card [R5]', async () => {
  const { fx, runner, card, g, primary, backup, calls, run } = await atReview();
  try {
    primary.push(HOLD_60);
    let f = await runner.formalReview(g(), card, run);
    let r = runner.next(g(), card, f.run);
    backup.push(BLOCK);
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    assert.equal(f.run.review.substantiveDecisions, 1);
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    let repaired: CardRun = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    r = runner.next(g(), card, repaired);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    repaired = (await runner.preReview(g(), card, r.run)).run;
    fx.advance(61_000);
    r = runner.next(g(), card, repaired);
    assert.equal(reviewerOf(r.directive), 'primary');
    primary.push(BLOCK.replace('src/t0-fb.ts:1', 'src/t0-fb.ts:2'));
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.run.review.substantiveDecisions, 2);
    assert.deepEqual(calls, ['primary', 'backup', 'primary']);
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'stop', r.directive.narration);
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'review');
  } finally {
    fx.cleanup();
  }
});

test('a fallback no-verdict takes the single shared retry on the fallback while the primary stays held, and never switches back early [R2] [R5]', async () => {
  const { fx, runner, card, g, primary, backup, calls, run } = await atReview();
  try {
    primary.push(HOLD_60);
    let f = await runner.formalReview(g(), card, run);
    let r = runner.next(g(), card, f.run);
    backup.push('nonsense\n');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'no-verdict');
    assert.equal(f.run.review.substantiveDecisions, 0);
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(reviewerOf(r.directive), 'backup', 'a no-verdict never switches reviewer; the primary is still held');
    backup.push('nonsense again\n');
    f = await runner.formalReview(g(), card, r.run);
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'stop', 'the second no-verdict spends the one retry, whichever reviewer ran');
    if (r.directive.kind === 'stop') assert.equal(r.directive.stop.reason, 'review');
    assert.deepEqual(calls, ['primary', 'backup', 'backup']);
  } finally {
    fx.cleanup();
  }
});

test("a repaired candidate while the primary is still held goes to the fallback: the hold is the reviewer's, not the candidate's [R2] [R6]", async () => {
  const { fx, runner, card, g, primary, backup, calls, run } = await atReview();
  try {
    primary.push(HOLD_120);
    let f = await runner.formalReview(g(), card, run);
    let r = runner.next(g(), card, f.run);
    backup.push(BLOCK);
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'block-defect');
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    const repaired = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:2', redReceipt: 'red:1', candidateSha: 'sha-2' });
    r = runner.next(g(), card, repaired);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    r = runner.next(g(), card, (await runner.preReview(g(), card, r.run)).run);
    // No clock advance: the primary is still held for the repaired candidate too.
    assert.equal(r.directive.kind, 'review', r.directive.narration);
    assert.equal(reviewerOf(r.directive), 'backup');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(calls, ['primary', 'backup', 'backup']);
    assert.equal(f.run.review.substantiveDecisions, 2);
  } finally {
    fx.cleanup();
  }
});

test("both held with the fallback's hold the earlier one: WAIT until it clears, then the fallback runs [R3]", async () => {
  const { fx, runner, card, g, primary, backup, calls, run } = await atReview();
  try {
    primary.push(HOLD_120);
    let f = await runner.formalReview(g(), card, run);
    let r = runner.next(g(), card, f.run);
    backup.push(HOLD_60);
    f = await runner.formalReview(g(), card, r.run);
    r = runner.next(g(), card, f.run);
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    if (r.directive.kind === 'wait') assert.ok(r.directive.pollSeconds <= 60, 'polls at the earlier hold, got ' + r.directive.pollSeconds + 's');
    fx.advance(61_000);
    r = runner.next(g(), card, r.run);
    assert.equal(reviewerOf(r.directive), 'backup');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(calls, ['primary', 'backup', 'backup']);
  } finally {
    fx.cleanup();
  }
});

const SHIP_PASS: Verdict = { verdict: 'pass', reasons: [], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'pass', reasons: [] } }, branch: 'T0-FB', run_status: 'success' };
const ADVISORY_BLOCK = '{"verdict":"block","reasons":["[standards] 16 hygiene @ src/t0-fb.ts:1: naming -> rename"],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"block","reasons":["[standards] 16 hygiene @ src/t0-fb.ts:1: naming -> rename"]}}}\n';

for (const c of [
  { name: 'a fallback pass', gateRequired: true, out: PASS, outcome: 'pass' },
  { name: 'a fallback advisory block', gateRequired: false, out: ADVISORY_BLOCK, outcome: 'block-advisory' },
]) {
  test('the ship path re-reading ' + c.name + ' records no second decision [R5]', async () => {
    const { fx, runner, ship, card, g, primary, backup, run, goalId } = await atReview(true, { gateRequired: c.gateRequired, shipVerdict: SHIP_PASS });
    try {
      primary.push(HOLD_60);
      let f = await runner.formalReview(g(), card, run);
      const r0 = runner.next(g(), card, f.run);
      assert.equal(reviewerOf(r0.directive), 'backup');
      backup.push(c.out);
      f = await runner.formalReview(g(), card, r0.run);
      assert.equal(f.classified.outcome, c.outcome);
      assert.ok(f.verdictRef);
      ship.rawFile = path.join(path.dirname(f.verdictRef), `${card.id}.json`);
      assert.equal((JSON.parse(readFileSync(ship.rawFile, 'utf8')) as { reviewer: string }).reviewer, 'backup', 'the raw document names the fallback');
      const decidedBefore = fx.events(goalId).filter((e) => e.type === 'REVIEW_DECIDED').length;
      const r = runner.next(g(), card, f.run);
      assert.equal(r.directive.kind, 'close', r.directive.narration);
      assert.equal(r.run.review.invocations.filter((i) => i.invocationId.startsWith('ship:')).length, 0, 'the re-read is the same artifact');
      assert.equal(r.run.review.substantiveDecisions, 1);
      assert.equal(fx.events(goalId).filter((e) => e.type === 'REVIEW_DECIDED').length, decidedBefore);
    } finally {
      fx.cleanup();
    }
  });
}

test('a request left in the goal pool before the fallback was configured is admitted from that pool [R6]', async () => {
  const { fx, makeRunner, card, g, primary, calls, run } = await atReview(false);
  try {
    const before = makeRunner();
    primary.push('nonsense\n');
    const f = await before.formalReview(g(), card, run);
    assert.equal(f.classified.outcome, 'no-verdict');
    const after = makeRunner({ ...fx.config, formalReview: { ...fx.config.formalReview, fallback: FALLBACK } });
    const r = after.next(g(), card, f.run);
    assert.equal(reviewerOf(r.directive), 'primary');
    const p = await after.formalReview(g(), card, r.run);
    assert.equal(p.classified.outcome, 'pass');
    assert.deepEqual(calls, ['primary', 'primary']);
  } finally {
    fx.cleanup();
  }
});

test('dispatching the fallback cancels the card\'s held primary request, so another card\'s primary review is admitted once the hold passes [R7]', async () => {
  const { fx, runner, open, card, g, primary, calls, run } = await atReview();
  try {
    primary.push(HOLD_60);
    let f = await runner.formalReview(g(), card, run);
    const r = runner.next(g(), card, f.run);
    assert.equal(reviewerOf(r.directive), 'backup');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    const held = fx.queue.list().filter((q) => q.reviewer === 'primary' && q.requesters.every((x) => x.endsWith(':T0-FB')));
    assert.ok(held.length > 0 && held.every((q) => q.state === 'cancelled'), 'card A left no primary request to admit: ' + held.map((q) => q.state).join(','));
    fx.advance(61_000);
    const b = await open('T0-FB2', 'sha-b');
    const rb = runner.next(b.g(), b.card, b.run);
    assert.equal(reviewerOf(rb.directive), 'primary', "card B's own ledger holds no hold");
    const fb = await runner.formalReview(b.g(), b.card, rb.run);
    assert.equal(fb.classified.outcome, 'pass');
    assert.deepEqual(calls, ['primary', 'backup', 'primary']);
  } finally {
    fx.cleanup();
  }
});

test('a failure cancelling the other reviewer\'s request never fails the admitted review: it is journaled and the review runs [R7]', async () => {
  const { fx, runner, card, g, primary, calls, run, goalId } = await atReview();
  try {
    primary.push(HOLD_60);
    let f = await runner.formalReview(g(), card, run);
    const r = runner.next(g(), card, f.run);
    const cancel = fx.queue.cancel.bind(fx.queue);
    fx.queue.cancel = (key: string, reason: string, now?: string) => {
      if (key.endsWith('|primary')) throw new Error('queue store unavailable');
      return cancel(key, reason, now);
    };
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(calls, ['primary', 'backup']);
    const failed = fx.events(goalId).filter((e) => e.type === 'NOTE' && (e.data as { reviewRequestCancelFailed?: string }).reviewRequestCancelFailed);
    assert.equal(failed.length, 1, 'the failed cancellation is journaled');
  } finally {
    fx.cleanup();
  }
});

test('a missing canonical document of a fallback pass is repaired under the fallback name before the ship [R5]', async () => {
  const { fx, runner, card, g, primary, run } = await atReview();
  try {
    primary.push(HOLD_60);
    let f = await runner.formalReview(g(), card, run);
    const r = runner.next(g(), card, f.run);
    f = await runner.formalReview(g(), card, r.run);
    assert.ok(f.verdictRef);
    const canonical = path.join(path.dirname(f.verdictRef), `${card.id}.json`);
    rmSync(canonical);
    const shipped = runner.next(g(), card, f.run);
    assert.equal(shipped.directive.kind, 'close', shipped.directive.narration);
    assert.equal((JSON.parse(readFileSync(canonical, 'utf8')) as { reviewer: string }).reviewer, 'backup');
  } finally {
    fx.cleanup();
  }
});

/** A primary that carries `--effort {effort}`, high from 3 changed lines or a change under src/core. */
const EFFORT_PRIMARY = { command: ['fake-p', '--effort', '{effort}', '{instructions}'], effort: { default: 'medium', high: { minChangedLines: 3, paths: ['src/core/**'] } } };
/** Two changed lines in one hunk: below the threshold. */
const SMALL_DIFF = 'diff --git a/src/t0-fb.ts b/src/t0-fb.ts\n--- a/src/t0-fb.ts\n+++ b/src/t0-fb.ts\n@@ -1 +1 @@\n-export const fb = 0;\n+export const fb = 1;\n';
/** Three changed lines, one of them an added line reading `+++x`: at the threshold. */
const THRESHOLD_DIFF = 'diff --git a/src/t0-fb.ts b/src/t0-fb.ts\n--- a/src/t0-fb.ts\n+++ b/src/t0-fb.ts\n@@ -1 +1,2 @@\n-export const fb = 0;\n+export const fb = 1;\n+++x\n';

test('a small candidate runs a primary carrying {effort} at medium, and the invocation records medium [T1-OPUS55-R3 R2] [R3]', async () => {
  const { fx, runner, card, g, argv, run } = await atReview(false, { formalReview: EFFORT_PRIMARY, diff: SMALL_DIFF });
  try {
    const f = await runner.formalReview(g(), card, run);
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(argv.primary[0]!.slice(0, 2), ['--effort', 'medium']);
    assert.equal(f.run.review.invocations.at(-1)?.effort, 'medium');
  } finally {
    fx.cleanup();
  }
});

test('a candidate whose added plus deleted lines in the pinned diff the reviewer receives reach the threshold runs at high, whatever numstat says, and the invocation records high [T1-OPUS55-R3 R2] [R3]', async () => {
  const { fx, runner, card, g, argv, run } = await atReview(false, { formalReview: EFFORT_PRIMARY, diff: THRESHOLD_DIFF });
  try {
    const f = await runner.formalReview(g(), card, run);
    assert.deepEqual(argv.primary[0]!.slice(0, 2), ['--effort', 'high']);
    assert.equal(f.run.review.invocations.at(-1)?.effort, 'high');
  } finally {
    fx.cleanup();
  }
});

test('an argv without {effort} is passed unchanged and the invocation records no effort, even with a policy [T1-OPUS55-R3 R3]', async () => {
  const { fx, runner, card, g, argv, run } = await atReview(false, { formalReview: { effort: { default: 'max' } }, diff: THRESHOLD_DIFF });
  try {
    const f = await runner.formalReview(g(), card, run);
    assert.equal(f.classified.outcome, 'pass');
    assert.equal(argv.primary[0]!.length, 3);
    assert.equal(argv.primary[0]![0], '--schema');
    assert.ok(!argv.primary[0]!.includes('max'));
    assert.equal('effort' in f.run.review.invocations.at(-1)!, false);
  } finally {
    fx.cleanup();
  }
});

test("a fallback dispatch expands {effort} with the fallback's own policy [T1-OPUS55-R3 R2] [R3]", async () => {
  const { fx, runner, card, g, primary, argv, run } = await atReview(true, { formalReview: EFFORT_PRIMARY, fallback: { command: ['fake-b', '--effort', '{effort}', '{instructions}'], effort: { default: 'xhigh' } } });
  try {
    primary.push(HOLD_60);
    let f = await runner.formalReview(g(), card, run);
    assert.equal(f.classified.outcome, 'quota-hold');
    const r = runner.next(g(), card, f.run);
    assert.equal(reviewerOf(r.directive), 'backup');
    f = await runner.formalReview(g(), card, r.run);
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(argv.backup[0]!.slice(0, 2), ['--effort', 'xhigh']);
    assert.equal(f.run.review.invocations.at(-1)?.reviewer, 'backup');
    assert.equal(f.run.review.invocations.at(-1)?.effort, 'xhigh');
  } finally {
    fx.cleanup();
  }
});

/** The `.review` directory a formal review of the run writes to: the card worktree when it exists, else the main checkout. */
function reviewDirOf(fx: { repo: { mainRoot: string } }, run: CardRun): string {
  return path.join(run.worktree && existsSync(run.worktree) ? run.worktree : fx.repo.mainRoot, '.review');
}

/** Dispatch the primary while a live writer holds the card-run lock at commit time: the result is retained, the reservation stays. */
async function retainedHigh() {
  const s = await atReview(false, { formalReview: EFFORT_PRIMARY, diff: THRESHOLD_DIFF });
  const lock = `${s.fx.store.cardFile(s.goalId, s.card.id)}.lock`;
  // The caller cleans the fixture once it has the result; a failure here cleans it (and the lock) before it propagates.
  let handedOver = false;
  try {
    s.hooks.onPrimary = () => writeFileSync(lock, `pid=${process.pid} at=now nonce=held`, 'utf8');
    await assert.rejects(() => s.runner.formalReview(s.g(), s.card, s.run), /locked/i);
    s.hooks.onPrimary = undefined;
    const persisted = s.fx.store.getCardRun(s.goalId, s.card.id)!;
    const pending = persisted.review.invocations.find((i) => i.outcome === 'pending');
    assert.equal(pending?.effort, 'high', 'the reservation records the level');
    handedOver = true;
    return { ...s, persisted, stem: pending!.invocationId.slice(3) };
  } finally {
    rmSync(lock, { force: true });
    if (!handedOver) s.fx.cleanup();
  }
}

test('a result retained from its envelope is committed with the effort its reservation recorded [T1-OPUS55-R3 R3]', async () => {
  const { fx, runner, card, g, calls, persisted } = await retainedHigh();
  try {
    const f = await runner.formalReview(g(), card, persisted);
    assert.deepEqual(calls, ['primary'], 'committed from the envelope, not run again');
    assert.equal(f.run.review.invocations.at(-1)?.outcome, 'pass');
    assert.equal(f.run.review.invocations.at(-1)?.effort, 'high');
  } finally {
    fx.cleanup();
  }
});

test('a reservation with no envelope past the timeout and the grace is charged as a no-verdict with the effort it recorded [T1-OPUS55-R3 R3]', async () => {
  const { fx, runner, card, g, calls, persisted, stem } = await retainedHigh();
  try {
    const dir = reviewDirOf(fx, persisted);
    rmSync(path.join(dir, `${stem}.result.json`), { force: true });
    rmSync(path.join(dir, `${stem}.log`), { force: true });
    fx.advance(1000 + RECONCILE_GRACE_MS + 1);
    const f = await runner.formalReview(g(), card, persisted);
    assert.deepEqual(calls, ['primary'], 'charged, not run again');
    assert.equal(f.run.review.invocations.at(-1)?.outcome, 'no-verdict');
    assert.equal(f.run.review.invocations.at(-1)?.effort, 'high');
  } finally {
    fx.cleanup();
  }
});

/** Three changed lines of a file git treats as binary (NUL bytes), shown as text: at the threshold. */
const NUL_THRESHOLD_DIFF = 'diff --git a/src/t0-fb.ts b/src/t0-fb.ts\n--- a/src/t0-fb.ts\n+++ b/src/t0-fb.ts\n@@ -1 +1,2 @@\n-a\u0000b\n+a\u0000c\n+d\n';

test('in a git repository the level is counted from the pinned candidate range, never from HEAD, NUL-byte hunks included [T1-OPUS55-R3-2 acceptance 8] [R2] [R5]', async () => {
  const { fx, makeRunner, card, g, argv, run } = await atReview(false, {
    formalReview: EFFORT_PRIMARY,
    script: {
      'git rev-parse': { stdout: 'sha-1\n' },
      'git status': { stdout: '' },
      'git diff --text main...sha-1': { stdout: NUL_THRESHOLD_DIFF },
      'git diff --text main...HEAD': { stdout: SMALL_DIFF },
    },
  });
  try {
    const f = await makeRunner(fx.config, { ...fx.repo, isGit: true }).formalReview(g(), card, run);
    assert.equal(f.classified.outcome, 'pass');
    assert.deepEqual(argv.primary[0]!.slice(0, 2), ['--effort', 'high']);
    assert.equal(f.run.review.invocations.at(-1)?.effort, 'high');
  } finally {
    fx.cleanup();
  }
});

/**
 * A two-line candidate renaming `source` to src/t0-fb.ts, its diff headers as git writes them (a non-ASCII name C-quoted with
 * octal escapes). The scripted git lists it as git does: with rename detection by the destination only, with --no-renames by
 * the source and the destination.
 */
const RENAMES_OUT_OF_CORE = [
  { name: 'a file out of src/core/** [T1-OPUS55-R3-2 acceptance 9] [R6]', source: 'src/core/old.ts', headers: 'diff --git a/src/core/old.ts b/src/t0-fb.ts\nsimilarity index 95%\nrename from src/core/old.ts', glob: 'src/core/**' },
  { name: 'a non-ASCII file out of the single-segment glob src/core/*.ts [T1-RENAME-PATHS acceptance 3] [R3]', source: 'src/core/é.ts', headers: 'diff --git "a/src/core/\\303\\251.ts" b/src/t0-fb.ts\nsimilarity index 95%\nrename from "src/core/\\303\\251.ts"', glob: 'src/core/*.ts' },
];

for (const { name, source, headers, glob } of RENAMES_OUT_OF_CORE) {
  test(`a candidate that renames ${name} under the threshold runs at high: the changed paths name the rename source`, async () => {
    const renamed = `${headers}\nrename to src/t0-fb.ts\n@@ -1 +1 @@\n-a\n+b\n`;
    const script = { 'git diff --name-only -z': (args: string[]) => ({ stdout: args.includes('--no-renames') ? `${source}\u0000src/t0-fb.ts\u0000` : 'src/t0-fb.ts\u0000' }) };
    const effort = { default: 'medium', high: { minChangedLines: 3, paths: [glob] } };
    const { fx, runner, card, g, argv, run } = await atReview(false, { formalReview: { ...EFFORT_PRIMARY, effort }, diff: renamed, script, allowPaths: ['src/t0-fb.ts', source] });
    try {
      const f = await runner.formalReview(g(), card, run);
      assert.deepEqual(argv.primary[0]!.slice(0, 2), ['--effort', 'high']);
      assert.equal(f.run.review.invocations.at(-1)?.effort, 'high');
    } finally {
      fx.cleanup();
    }
  });
}

/** The Codex primary form: `{effort}` inside a longer argument. */
const EMBEDDED_PRIMARY = { ...EFFORT_PRIMARY, command: ['fake-p', '-c', 'model_reasoning_effort={effort}', '{instructions}'] };

for (const [diff, level] of [[THRESHOLD_DIFF, 'high'], [SMALL_DIFF, 'medium']] as const) {
  test(`an argv carrying {effort} inside a longer argument receives model_reasoning_effort=${level} and records ${level} [T1-OPUS55-R3-2 acceptance 3] [R2] [R3]`, async () => {
    const { fx, runner, card, g, argv, run } = await atReview(false, { formalReview: EMBEDDED_PRIMARY, diff });
    try {
      const f = await runner.formalReview(g(), card, run);
      assert.deepEqual(argv.primary[0]!.slice(0, 2), ['-c', `model_reasoning_effort=${level}`]);
      assert.equal(f.run.review.invocations.at(-1)?.effort, level);
    } finally {
      fx.cleanup();
    }
  });
}

test('a small candidate whose changed path matches high.paths runs at high without a rename [T1-OPUS55-R3-3 acceptance 11] [R2]', async () => {
  const { fx, runner, card, g, argv, run } = await atReview(false, { formalReview: { ...EFFORT_PRIMARY, effort: { default: 'medium', high: { minChangedLines: 500, paths: ['src/t0-fb.ts'] } } }, diff: SMALL_DIFF });
  try {
    const f = await runner.formalReview(g(), card, run);
    assert.deepEqual(argv.primary[0]!.slice(0, 2), ['--effort', 'high']);
    assert.equal(f.run.review.invocations.at(-1)?.effort, 'high');
  } finally {
    fx.cleanup();
  }
});
