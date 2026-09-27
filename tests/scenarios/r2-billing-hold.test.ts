import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

/** The stderr the DeepSeek CLI printed on each round-3 angle of issue #92 (request id of the edge-cases angle). */
const INSUFFICIENT_BALANCE = 'ERROR 402: {"error":{"message":"Insufficient Balance (request_id: e1f8c686-3ba1-4d72-bbba-204d56dbd462)","type":"unknown_error","param":null,"code":"invalid_request_error"}}\n';

test('T0-R2-BILLING-HOLD acceptance 3: a pre-reviewer that answers 402 Insufficient Balance is held; the gate waits, no round is consumed and the no-verdict retry is still there [R2]', async () => {
  const fx = makeFixture({ config: { preReview: { command: ['fake-reviewer'], reviewer: 'fake', rounds: 2, timeoutMs: 1000, onExhausted: 'stop', shell: false } } });
  try {
    const outputs: Array<{ stdout?: string; stderr?: string; exitCode?: number }> = [];
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t1-gate.ts\u0000' },
      'git diff': { stdout: 'diff --git a/src/t1-gate.ts b/src/t1-gate.ts\n+export const gate = 1;\n' },
      'fake-reviewer': () => outputs.shift() ?? { stdout: '{"verdict":"pass","reasons":[]}\n' },
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T1-GATE', title: 'gate the ship' });
    const goal = fx.controller.createGoal({ text: 'implement T1-GATE', source: 'card', ref: 'T1-GATE', affectedSurfaces: [] }, { cards: ['T1-GATE'] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-GATE'] } });
    const card = fx.card('T1-GATE');
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-GATE'));
    assert.equal(r.directive.kind, 'prepare');
    const run = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: 'sha-1' });
    r = runner.next(fx.goal(goal.id), card, run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') assert.equal(r.directive.round, 1);

    // The account has no balance: the reviewer exits 1 with the 402 line on stderr.
    outputs.push({ stderr: INSUFFICIENT_BALANCE, exitCode: 1 });
    const held = await runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(held.result.outcome, 'quota-hold', `a billing state is a hold, not a no-verdict round: ${held.result.outcome}/${held.result.runStatus}`);
    assert.deepEqual(held.result.reasons, ['via text: Insufficient Balance'], 'the hold names the billing state');
    assert.equal(held.round.outcome, 'quota-hold');

    // WAIT, and the hold consumed nothing: no decided round and no no-verdict round.
    r = runner.next(fx.goal(goal.id), card, held.run);
    assert.equal(r.directive.kind, 'wait', r.directive.narration);
    if (r.directive.kind === 'wait') assert.equal(r.directive.on, 'pre-review-quota');
    assert.equal(r.run.state, 'WAIT');
    assert.deepEqual(r.run.preReview.rounds.map((x) => x.outcome), ['quota-hold']);

    // Once the hold clears, the gate asks for the same round, with no no-verdict retry note.
    fx.advance(15 * 60 * 1000 + 1000);
    r = runner.next(fx.goal(goal.id), card, r.run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') {
      assert.equal(r.directive.round, 1, 'a hold consumes no round');
      assert.ok(!r.directive.narration.includes('produced no verdict'), r.directive.narration);
    }

    // The no-verdict retry is still unspent: a malformed answer now gets the retry, not a stop.
    outputs.push({ stdout: 'I cannot decide.\n' });
    const noVerdict = await runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(noVerdict.result.outcome, 'no-verdict');
    r = runner.next(fx.goal(goal.id), card, noVerdict.run);
    assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
    if (r.directive.kind === 'pre-review') {
      assert.equal(r.directive.round, 1);
      assert.ok(r.directive.narration.includes('(retry: the previous run produced no verdict)'), r.directive.narration);
    }
    outputs.push({ stdout: '{"verdict":"pass","reasons":[]}\n' });
    const passed = await runner.preReview(fx.goal(goal.id), card, r.run);
    assert.equal(passed.result.outcome, 'pass');
  } finally {
    fx.cleanup();
  }
});
