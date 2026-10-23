import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, candidateShaFor } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner, type ExecReceipt } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { ReviewInvocation, type Verdict } from '../../src/core/types.ts';
import { changedLineRanges, runReviewPanel } from '../../src/review/pre-review.ts';

// The [pre-existing] tag on the command path and the ship path (card T1-REVIEW-PRE-EXISTING).

const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';

/** A committed diff whose only hunk covers lines 1-3 of `file` (one context line, one added line, one context line). */
const diffOf = (file: string) => `diff --git a/${file} b/${file}\nindex 1111111..2222222 100644\n--- a/${file}\n+++ b/${file}\n@@ -1,2 +1,3 @@\n a\n+b\n c\n`;

/** A block whose only reason is `reason`, on the root and on the standards axis, as one verdict line. */
const blockLine = (reason: string) => JSON.stringify({ verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: [reason] } } }) + '\n';

const tagged = (file: string, line: number) => `[standards] 9 error handling @ ${file}:${line}: [pre-existing] the catch swallows the error -> rethrow`;

/** A card on the command path with scripted R2 and R3 reviewers and the scripted diff above. */
async function commandCard(id: string, file: string, r2: string[], r3: string[]) {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  const script = scriptedRunner({
    'git diff --name-only': { stdout: `${file}\u0000` },
    'git diff': { stdout: diffOf(file) },
    'fake-r2': () => ({ stdout: r2.shift() ?? PASS }),
    'fake-r3': () => ({ stdout: r3.shift() ?? PASS }),
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  writeCard(fx, { id, title: 'pre-existing tag', allowPaths: [file] });
  const goal = fx.controller.createGoal({ text: `implement ${id}`, source: 'card', ref: id, affectedSurfaces: [] }, { cards: [id] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [id] } });
  const card = fx.card(id);
  const g = () => fx.goal(goal.id);
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), id));
  const run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
  r = runner.next(g(), card, run);
  return { fx, runner, card, g, r, goalId: goal.id };
}

test('acceptance 6: on the command path a [pre-existing] block on an unchanged line is an R2 pass and an R3 pass with the reason retained as advisory and no finding; on a changed line it blocks and records F1 [R2] [R3] [R4] [R7]', async () => {
  const file = 'src/t1-pe.ts';
  const r2Reason = tagged(file, 40);
  const r3Reason = `[standards] 9 error handling @ ${file}:40: [pre-existing] the retry loop never backs off -> add a delay`;
  const a = await commandCard('T1-PE', file, [blockLine(r2Reason)], [blockLine(r3Reason)]);
  try {
    const round = await a.runner.preReview(a.g(), a.card, a.r.run);
    assert.equal(round.result.outcome, 'pass');
    assert.equal(round.round.outcome, 'pass');
    assert.deepEqual(round.round.advisory, [r2Reason]);
    const preEvent = a.fx.events(a.goalId).filter((e) => e.type === 'PRE_REVIEW_DECIDED').at(-1);
    assert.equal(preEvent?.data['outcome'], 'pass');
    assert.deepEqual(preEvent?.data['advisory'], [r2Reason]);
    assert.deepEqual(preEvent?.data['findings'], []);
    assert.deepEqual(round.run.findings, []);
    const next = a.runner.next(a.g(), a.card, round.run);
    assert.equal(next.directive.kind, 'review');
    const decision = await a.runner.formalReview(a.g(), a.card, next.run);
    assert.equal(decision.classified.outcome, 'pass');
    assert.deepEqual(decision.advisory, [r3Reason]);
    const invocation = decision.run.review.invocations.at(-1);
    assert.equal(invocation?.outcome, 'pass');
    assert.deepEqual(invocation?.advisory, [r3Reason]);
    const event = a.fx.events(a.goalId).filter((e) => e.type === 'REVIEW_DECIDED').at(-1);
    assert.equal(event?.data['outcome'], 'pass');
    assert.deepEqual(event?.data['advisory'], [r3Reason]);
    assert.deepEqual(event?.data['findings'], []);
    assert.equal(decision.run.review.substantiveDecisions, 1);
    assert.equal(decision.run.review.substantiveBlocks, 0);
    assert.deepEqual(decision.run.findings, []);
    assert.equal(decision.run.state, 'SHIP');
    // The persisted record carries the same advisory reasons.
    assert.deepEqual(a.fx.store.getCardRun(a.goalId, 'T1-PE')?.review.invocations.at(-1)?.advisory, [r3Reason]);
  } finally {
    a.fx.cleanup();
  }
  const changed = tagged(file, 2);
  const b = await commandCard('T1-PE2', file, [blockLine(changed)], []);
  try {
    const round = await b.runner.preReview(b.g(), b.card, b.r.run);
    assert.equal(round.result.outcome, 'block');
    assert.deepEqual(round.round.advisory, []);
    assert.deepEqual(round.run.findings.map((f) => [f.id, f.stage, f.reason, f.disposition]), [['F1', 'pre', changed, 'open']]);
    assert.equal(round.run.state, 'BUILD');
  } finally {
    b.fx.cleanup();
  }
});

test('R4: runReviewPanel hands the changed lines to every angle of a panel and to an angle rerun on the fallback', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-pe-panel-'));
  const reviewDir = path.join(dir, '.review');
  const file = 'src/t1-pe.ts';
  const outside = tagged(file, 40);
  const changedLines = changedLineRanges(diffOf(file), [file]);
  const panel = (perspectives: string[], outputs: Record<string, { stdout: string }>, stem: string, withMap: boolean) =>
    runReviewPanel({
      runner: async (c: string, a: string[], o?: { timeoutMs?: number }) => scriptedRunner(outputs)(c, a, o),
      command: ['primary', '--focus', '{perspective}'],
      perspectives,
      promptFor: () => 'P',
      vars: {},
      cwd: dir,
      timeoutMs: 1000,
      shell: false,
      reviewDir,
      fileStem: stem,
      head: 'sha-1',
      reviewer: 'deepseek',
      changedPaths: [file],
      ...(withMap ? { changedLines } : {}),
      fallback: { command: ['fb', '--focus', '{perspective}'], reviewer: 'fb', timeoutMs: 1000, shell: false, vars: {}, promptFor: () => 'FB' },
    });
  // Two angles block on the pre-existing reason only: the round passes with it under advisory.
  const angles = await panel(['bugs', 'security'], { 'primary --focus bugs': { stdout: blockLine(outside) }, 'primary --focus security': { stdout: blockLine(outside) } }, 'T1-PE.pre.0.1', true);
  assert.equal(angles.outcome, 'pass');
  assert.deepEqual(angles.advisory, [`${outside} (bugs)`, `${outside} (security)`]);
  // The primary returns no verdict and the fallback rerun blocks on the reason: the rerun reads the map too.
  const rerun = await panel(['bugs'], { primary: { stdout: 'no verdict\n' }, fb: { stdout: blockLine(outside) } }, 'T1-PE.pre.0.2', true);
  assert.equal(rerun.outcome, 'pass');
  assert.equal(rerun.perspectives[0]?.fallback?.reviewer, 'fb');
  assert.deepEqual(rerun.advisory, [outside]);
  // Without a map the same rerun blocks.
  const noMap = await panel(['bugs'], { primary: { stdout: 'no verdict\n' }, fb: { stdout: blockLine(outside) } }, 'T1-PE.pre.0.3', false);
  assert.equal(noMap.outcome, 'block');
  assert.deepEqual(noMap.reasons, [outside]);
  assert.equal((JSON.parse(readFileSync(noMap.verdictRef!, 'utf8')) as { outcome: string }).outcome, 'block');
});

/** The ship path: DryRunShipPath with a Tier-S block whose only reason is `reason`, and a CardRunner whose runner records every call. */
function shipRun(reason: string, script: Record<string, Partial<ExecReceipt>>, config: Record<string, unknown> = {}) {
  const fx = makeFixture({ config });
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello', tier: 'S', reviewGate: 'codex {verdict:pass}', allowPaths: ['src/hello.ts'], acceptance: ['1. hello() returns hello. [dod arm 1]'] });
  const goal = goalForCards(fx, ['T1-HELLO']);
  const verdict: Verdict = { verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'block', reasons: [reason] }, standards: { verdict: 'pass', reasons: [] } }, sha: candidateShaFor('T1-HELLO'), run_status: 'success' };
  const calls: string[] = [];
  const scripted = scriptedRunner(script);
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['review-blocked', 'review-blocked'], verdict), now: fx.now, runner: (c, a, o) => (calls.push([c, ...a].join(' ')), scripted(c, a, o)) });
  const card = fx.card('T1-HELLO');
  const g = () => fx.goal(goal.id);
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-HELLO'));
  r = runner.next(g(), card, r.run);
  const run1 = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidateShaFor('T1-HELLO') });
  const shipped = runner.next(g(), card, run1);
  const persisted = fx.store.getCardRun(goal.id, 'T1-HELLO')!;
  const event = fx.events(goal.id).filter((e) => e.type === 'REVIEW_DECIDED').at(-1);
  fx.cleanup();
  return { shipped, persisted, event, calls, invocation: persisted.review.invocations.at(-1) };
}

const SHIP_DIFF = { 'git diff --name-only': { stdout: 'src/hello.ts\u0000' }, 'git diff': { stdout: diffOf('src/hello.ts') } };
const shipReason = (line: number) => `[spec] 6 tests missing @ src/hello.ts:${line}: [pre-existing] the helper has no test -> add one`;

/** A ship-path block recorded as one: F1, one block consumed, no advisory key on the decision. */
function assertShipBlock(s: ReturnType<typeof shipRun>, reason: string, label: string) {
  assert.equal(s.invocation?.outcome, 'block', label);
  assert.equal('advisory' in (s.invocation ?? {}), false, `${label}: a decision that retained no advisory reason has no advisory key`);
  assert.equal(s.persisted.review.substantiveBlocks, 1, label);
  assert.deepEqual(s.persisted.findings.map((f) => [f.id, f.stage, f.reason]), [['F1', 'formal', reason]], label);
  assert.deepEqual(s.event?.data['advisory'], [], label);
  assert.equal(s.shipped.directive.kind, 'review-fix', label);
  assert.equal(s.persisted.state, 'REVIEW_FIX', label);
}

test('acceptance 7: on the ship path a [pre-existing] block on an unchanged line is a pass with the reason on the decision and its event; a changed line, a failed diff and a diff above the cap keep it a block; a document without the tag runs no diff [R3] [R5] [R6] [R7]', () => {
  const outside = shipReason(40);
  const pass = shipRun(outside, SHIP_DIFF);
  assert.equal(pass.invocation?.outcome, 'pass');
  assert.deepEqual(pass.invocation?.advisory, [outside]);
  assert.deepEqual(pass.event?.data['advisory'], [outside]);
  assert.equal(pass.event?.data['outcome'], 'pass');
  assert.equal(pass.persisted.review.substantiveBlocks, 0, 'no block consumed');
  assert.deepEqual(pass.persisted.findings, [], 'no finding');
  // The ship path itself refused the merge on a document the loop reads as advisory notes: a stop for a human, as for [question].
  assert.equal(pass.persisted.state, 'STOP');
  assert.equal(pass.persisted.stop?.reason, 'review');
  assert.ok(pass.persisted.stop?.detail.includes(outside), pass.persisted.stop?.detail);
  assert.deepEqual(pass.calls.filter((c) => c.startsWith('git diff')), ['git diff --name-only -z main...HEAD --no-renames', 'git diff --text main...HEAD --no-color --no-ext-diff --no-textconv'], 'the diff is collected against the run base');

  const inside = shipReason(2);
  assertShipBlock(shipRun(inside, SHIP_DIFF), inside, 'a changed line');
  assertShipBlock(shipRun(outside, { 'git diff --name-only': { stdout: 'src/hello.ts\u0000' }, 'git diff': { exitCode: 1, stderr: 'fatal: bad revision' } }), outside, 'a git diff that exits non-zero');
  assertShipBlock(shipRun(outside, SHIP_DIFF, { formalReview: { maxDiffBytes: 40 } }), outside, 'a diff above formalReview.maxDiffBytes');

  // R2 F1 (class: empty-diff-advisory): a git diff that exits 0 with no output builds no map, so the block stands.
  assertShipBlock(shipRun(outside, { 'git diff --name-only': { stdout: '' }, 'git diff': { stdout: '' } }), outside, 'an empty diff');

  const plain = '[spec] 6 tests missing @ src/hello.ts:40: the helper has no test -> add one';
  const noTag = shipRun(plain, SHIP_DIFF);
  assertShipBlock(noTag, plain, 'a document without the tag');
  assert.deepEqual(noTag.calls.filter((c) => c.startsWith('git diff')), [], 'no git diff for a document without a [pre-existing] reason');
});

test('acceptance 8: a ReviewInvocation record without advisory parses with no advisory key [R8]', () => {
  const record = { invocationId: 'r3:T1-X.r3.1.abcd1234', candidateDigest: 'digest-1', base: 'main', policyVersion: 'REVIEW.md@4', reviewer: 'codex', requestedAt: '2026-10-23T12:00:00.000Z', outcome: 'pass' };
  const parsed = ReviewInvocation.parse(record);
  assert.equal('advisory' in parsed, false);
  assert.deepEqual(parsed, record);
  assert.deepEqual(ReviewInvocation.parse({ ...record, advisory: ['[question] why?'] }).advisory, ['[question] why?']);
});
