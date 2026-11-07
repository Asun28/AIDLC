/**
 * T1-R3-SECOND-PASS: with `formalReview.secondPass` on, the first R3 pass of a card run does not admit the ship. One more R3
 * runs on the same candidate, with rules matched to its diff, and a block from it is an R3 block. These runs use real git in
 * a temporary repository and a scripted reviewer.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, { mkdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import type { CardRun } from '../../src/core/types.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import { formatReviewStats, summarizeReviews } from '../../src/review/stats.ts';

const CARD = 'T0-TWO';
const FILE = 'src/t0-two.ts';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const NO_VERDICT = 'the reviewer printed no verdict\n';
const block = (n: number) => {
  const reason = `[standards] 9 error handling @ ${FILE}:1: unchecked value ${n} -> check it`;
  return `${JSON.stringify({ verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: [reason] } } })}\n`;
};
const formal = (extra: Record<string, unknown> = {}) => ({ command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, ...extra });
const ON = { gateRequired: true, formalReview: formal({ secondPass: true }) };
const OFF = { gateRequired: true, formalReview: formal() };
const WITH_R2 = { ...ON, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } };

const OLD_RULE = '- 2026-01-01 T1-OLD-MATCH: ALWAYS check `export const v` before the ship (source: PR 1)';
const newerRules = Array.from({ length: 30 }, (_, i) => `- 2026-02-${String((i % 28) + 1).padStart(2, '0')} T1-NEW-${i}: ALWAYS keep unrelated rule ${i} ${'z'.repeat(200)} (source: PR 2)`);

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function commitCandidate(fx: Fixture, n: number): string {
  mkdirSync(path.join(fx.tmp, 'src'), { recursive: true });
  writeFileSync(path.join(fx.tmp, FILE), `export const v = ${n};\n`);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', `candidate ${n}`]);
  return git(fx.tmp, ['rev-parse', 'HEAD']);
}

function gitRepo(fx: Fixture): void {
  writeCard(fx, { id: CARD, title: 'review twice', allowPaths: [FILE] });
  mkdirSync(path.join(fx.tmp, 'docs'), { recursive: true });
  writeFileSync(path.join(fx.tmp, 'docs', 'LESSONS.md'), `# Lessons\n\n${[OLD_RULE, ...newerRules].join('\n')}\n`);
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  git(fx.tmp, ['checkout', '-q', '-b', CARD]);
}

type Reply = string | { exitCode: number; stderr: string };

/** `replies` is what `fake-r3` answers, one entry per call; the last repeats. Every prompt it receives lands in `prompts`. */
function runnerFor(fx: Fixture, replies: Reply[]): { runner: CardRunner; prompts: string[] } {
  const prompts: string[] = [];
  const left = [...replies];
  const reviewers = scriptedRunner({
    'fake-r2': () => ({ stdout: PASS }),
    'fake-r3': () => {
      const reply = left.length > 1 ? left.shift()! : left[0]!;
      return typeof reply === 'string' ? { stdout: reply } : reply;
    },
  });
  const runner: SyncRunner = (command, args, options) => {
    if (command === 'fake-r3') prompts.push(args[args.length - 1]!);
    return command === 'git' ? runSync(command, args, options) : reviewers(command, args, options);
  };
  const repo = { ...fx.repo, isGit: true };
  return { runner: new CardRunner({ paths: fx.paths, repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged', 'merged']), now: fx.now, runner }), prompts };
}

function start(fx: Fixture, runner: CardRunner): { goalId: string; run: CardRun } {
  const goal = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [] }, { cards: [CARD] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [CARD] } });
  const card = fx.card(CARD);
  const first = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  return { goalId: goal.id, run: runner.next(fx.goal(goal.id), card, first.run).run };
}

/** Record a candidate and run the R3 the gate directs. */
async function decide(fx: Fixture, runner: CardRunner, goalId: string, run: CardRun, candidate: string, attempt: number) {
  const card = fx.card(CARD);
  const recorded = runner.recordAttempt(fx.goal(goalId), card, run, { outcome: 'success', dodReceipt: `dod:${attempt}`, redReceipt: 'red:1', candidateSha: candidate });
  const ready = runner.next(fx.goal(goalId), card, recorded);
  assert.equal(ready.directive.kind, 'review');
  return runner.formalReview(fx.goal(goalId), card, ready.run);
}

const next = (fx: Fixture, runner: CardRunner, goalId: string, run: CardRun) => runner.next(fx.goal(goalId), fx.card(CARD), run);
const review = (fx: Fixture, runner: CardRunner, goalId: string, run: CardRun) => runner.formalReview(fx.goal(goalId), fx.card(CARD), run);
const decided = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'REVIEW_DECIDED').map((e) => e.data as Record<string, unknown>);
const section = (prompt: string) => prompt.slice(prompt.indexOf('## Learned invariants'), prompt.indexOf('## Card contract'));

async function withRepo(config: Record<string, unknown>, body: (fx: Fixture) => Promise<void>): Promise<void> {
  const fx = makeFixture({ config });
  try {
    gitRepo(fx);
    await body(fx);
  } finally {
    fx.cleanup();
  }
}

test('T1-R3-SECOND-PASS acceptance 1: with the option off a first pass admits the ship and no invocation has secondPass [R1]', async () => {
  await withRepo(OFF, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    assert.equal(next(fx, runner, goalId, first.run).directive.kind, 'close');
    assert.equal(prompts.length, 1);
    assert.deepEqual(fx.store.getCardRun(goalId, CARD)!.review.invocations.map((i) => i.secondPass), [undefined]);
  });
});

test('T1-R3-SECOND-PASS acceptance 1: with the option on the first pass returns a review directive, and the ship follows the second pass [R2] [R4]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    const due = next(fx, runner, goalId, first.run);
    assert.equal(due.directive.kind, 'review');
    assert.match(String((due.directive as { narration?: string }).narration), /second R3 pass/i);
    const second = await review(fx, runner, goalId, due.run);
    assert.equal(next(fx, runner, goalId, second.run).directive.kind, 'close');
    assert.equal(prompts.length, 2);
    assert.deepEqual(fx.store.getCardRun(goalId, CARD)!.review.invocations.map((i) => i.secondPass), [undefined, true]);
    assert.deepEqual(decided(fx, goalId).map((d) => d['secondPass']), [undefined, true]);
  });
});

test('T1-R3-SECOND-PASS acceptance 2: the second pass holds the matched rule and sentence, and the first the newest rules [R3]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    await review(fx, runner, goalId, next(fx, runner, goalId, first.run).run);
    assert.ok(!section(prompts[0]!).includes('T1-OLD-MATCH'), 'the newest rules fill the first pass');
    assert.ok(section(prompts[0]!).includes('the newest rules are above'));
    assert.ok(section(prompts[1]!).includes('T1-OLD-MATCH'), 'the matching rule reaches the second pass');
    assert.ok(section(prompts[1]!).includes('the rules that best match this diff are above'));
  });
});

test('T1-R3-SECOND-PASS acceptance 2: the second pass sends no delta, though the pass before it did [R3]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [block(1), PASS]);
    const { goalId, run } = start(fx, runner);
    const blocked = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    const passed = await decide(fx, runner, goalId, blocked.run, commitCandidate(fx, 2), 2);
    await review(fx, runner, goalId, next(fx, runner, goalId, passed.run).run);
    assert.ok(prompts[1]!.includes('## Delta since the last reviewed candidate'), 'the repair is reviewed as a delta');
    assert.ok(!prompts[2]!.includes('## Delta since the last reviewed candidate'), 'the second pass reads the whole diff');
  });
});

test('T1-R3-SECOND-PASS acceptance 2: the second pass sends no advisory notes, though the first did [R3]', async () => {
  await withRepo(WITH_R2, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [PASS]);
    const { goalId, run } = start(fx, runner);
    const card = fx.card(CARD);
    const recorded = runner.recordAttempt(fx.goal(goalId), card, run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: commitCandidate(fx, 1) });
    const ready = next(fx, runner, goalId, recorded);
    await runner.preReview(fx.goal(goalId), card, ready.run);
    const noted = fx.store.updateCardRun(goalId, CARD, (latest) => ({ ...latest!, preReview: { ...latest!.preReview, rounds: latest!.preReview.rounds.map((r) => ({ ...r, advisory: ['AN ADVISORY NOTE'] })) } }));
    const first = await review(fx, runner, goalId, next(fx, runner, goalId, noted).run);
    await review(fx, runner, goalId, next(fx, runner, goalId, first.run).run);
    assert.ok(prompts[0]!.includes('AN ADVISORY NOTE'));
    assert.ok(!prompts[1]!.includes('AN ADVISORY NOTE'));
  });
});

test('T1-R3-SECOND-PASS acceptance 3: a second-pass pass spends no decision [R4]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner } = runnerFor(fx, [PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    assert.equal(first.run.review.substantiveDecisions, 1);
    const second = await review(fx, runner, goalId, next(fx, runner, goalId, first.run).run);
    assert.equal(second.run.review.substantiveDecisions, 1);
    assert.equal(second.run.review.substantiveBlocks, 0);
  });
});

test('T1-R3-SECOND-PASS acceptance 3: a blocking second pass spends a decision, returns REVIEW_FIX, and after a repair one pass ships [R4]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [PASS, block(1), PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    const blocked = await review(fx, runner, goalId, next(fx, runner, goalId, first.run).run);
    assert.equal(blocked.run.state, 'REVIEW_FIX');
    assert.equal(blocked.run.review.substantiveDecisions, 2);
    assert.equal(blocked.run.review.substantiveBlocks, 1);
    const repaired = await decide(fx, runner, goalId, blocked.run, commitCandidate(fx, 2), 2);
    assert.equal(next(fx, runner, goalId, repaired.run).directive.kind, 'close');
    assert.equal(prompts.length, 3, 'no third review');
  });
});

test('T1-R3-SECOND-PASS acceptance 4: a first pass at decision 2 gets its second pass and no STOP [R2] [R5]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner } = runnerFor(fx, [block(1), PASS]);
    const { goalId, run } = start(fx, runner);
    const blocked = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    const passed = await decide(fx, runner, goalId, blocked.run, commitCandidate(fx, 2), 2);
    assert.equal(passed.run.review.substantiveDecisions, 2);
    const due = next(fx, runner, goalId, passed.run);
    assert.equal(due.directive.kind, 'review');
    const second = await review(fx, runner, goalId, due.run);
    assert.equal(next(fx, runner, goalId, second.run).directive.kind, 'close');
  });
});

test('T1-R3-SECOND-PASS acceptance 4: a first pass at decision 4 ships with no second pass [R2]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [block(1), block(2), block(3), PASS]);
    const { goalId, run } = start(fx, runner);
    let latest = run;
    for (let n = 1; n <= 4; n++) latest = (await decide(fx, runner, goalId, latest, commitCandidate(fx, n), n)).run;
    assert.equal(latest.review.substantiveDecisions, 4);
    assert.equal(next(fx, runner, goalId, latest).directive.kind, 'close');
    assert.equal(prompts.length, 4);
    assert.equal(fx.store.getCardRun(goalId, CARD)!.review.invocations.some((i) => i.secondPass), false);
  });
});

test('T1-R3-SECOND-PASS acceptance 5: a no-verdict on the second pass leaves it due, and the retry runs it [R5]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [PASS, NO_VERDICT, PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    const lost = await review(fx, runner, goalId, next(fx, runner, goalId, first.run).run);
    assert.deepEqual(lost.run.review.invocations.map((i) => [i.outcome, i.secondPass]), [['pass', undefined], ['no-verdict', true]]);
    const retry = next(fx, runner, goalId, lost.run);
    assert.equal(retry.directive.kind, 'review');
    const second = await review(fx, runner, goalId, retry.run);
    assert.ok(section(prompts[2]!).includes('T1-OLD-MATCH'), 'the retry is still the second pass');
    assert.equal(next(fx, runner, goalId, second.run).directive.kind, 'close');
  });
});

test('T1-R3-SECOND-PASS acceptance 5: a quota hold on the second pass waits and leaves it due [R5]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner, prompts } = runnerFor(fx, [PASS, { exitCode: 1, stderr: '429 Too Many Requests, retry after 60 seconds\n' }, PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    const held = await review(fx, runner, goalId, next(fx, runner, goalId, first.run).run);
    assert.deepEqual(held.run.review.invocations.map((i) => [i.outcome, i.secondPass]), [['pass', undefined], ['quota-hold', true]]);
    assert.equal(next(fx, runner, goalId, held.run).directive.kind, 'wait');
    fx.advance(6 * 60 * 60 * 1000);
    const retry = next(fx, runner, goalId, fx.store.getCardRun(goalId, CARD)!);
    assert.equal(retry.directive.kind, 'review');
    const second = await review(fx, runner, goalId, retry.run);
    assert.ok(section(prompts[2]!).includes('T1-OLD-MATCH'), 'the retry is still the second pass');
    assert.equal(next(fx, runner, goalId, second.run).directive.kind, 'close');
  });
});

/** Run `body` with the first journal append of a REVIEW_DECIDED line failing, the failure patched on the `node:fs` export. */
async function failingDecidedAppend(body: () => Promise<unknown>): Promise<unknown> {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['appendFileSync']!;
  let fired = false;
  target['appendFileSync'] = (...args: unknown[]) => {
    if (!fired && String(args[0]).endsWith('.jsonl') && String(args[1]).includes('"type":"REVIEW_DECIDED"')) {
      fired = true;
      throw Object.assign(new Error('EIO: injected append'), { code: 'EIO' });
    }
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    await body();
    return undefined;
  } catch (error) {
    return error;
  } finally {
    target['appendFileSync'] = real;
    syncBuiltinESMExports();
  }
}

test('T1-R3-SECOND-PASS acceptance 6: a failed REVIEW_DECIDED append on a second pass is made by the next card next with secondPass [R3]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner } = runnerFor(fx, [PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    const due = next(fx, runner, goalId, first.run);
    const error = await failingDecidedAppend(() => review(fx, runner, goalId, due.run));
    assert.match(String(error), /injected append/);
    assert.equal(decided(fx, goalId).length, 1, 'the append was lost');
    next(fx, runner, goalId, fx.store.getCardRun(goalId, CARD)!);
    assert.deepEqual(decided(fx, goalId).map((d) => d['secondPass']), [undefined, true]);
  });
});

test('T1-R3-SECOND-PASS acceptance 7: review stats count second-pass decisions and blocks, per card and in the text [R6]', async () => {
  await withRepo(ON, async (fx) => {
    const { runner } = runnerFor(fx, [PASS]);
    const { goalId, run } = start(fx, runner);
    const first = await decide(fx, runner, goalId, run, commitCandidate(fx, 1), 1);
    await review(fx, runner, goalId, next(fx, runner, goalId, first.run).run);
    const passed = fx.store.getCardRun(goalId, CARD)!;
    const blocked: CardRun = { ...passed, cardId: 'T0-BLOCKED', review: { ...passed.review, invocations: passed.review.invocations.map((i) => (i.secondPass ? { ...i, outcome: 'block' as const } : i)) } };
    const none: CardRun = { ...passed, cardId: 'T0-NONE', review: { ...passed.review, invocations: passed.review.invocations.filter((i) => !i.secondPass) } };
    const rows = summarizeReviews([passed, blocked, none], []);
    const r3 = (id: string) => rows.find((r) => r.cardId === id)!.r3;
    assert.deepEqual([r3(CARD).secondPasses, r3(CARD).secondPassBlocks], [1, 0]);
    assert.deepEqual([r3('T0-BLOCKED').secondPasses, r3('T0-BLOCKED').secondPassBlocks], [1, 1]);
    assert.deepEqual([r3('T0-NONE').secondPasses, r3('T0-NONE').secondPassBlocks], [0, 0]);
    const text = formatReviewStats(rows);
    assert.match(text, /second pass 2, 1 block/);
    assert.match(text.split('\n').find((l) => l.startsWith('T0-NONE'))!, /^(?!.*second pass)/);
  });
});
