import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goalForCards, makeFixture, writeCard } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';

/** The directive text, as the card words it. */
const ACCEPTANCE_TABLE = 'When allow_paths lists this card file, write a table in its `## Attempt evidence` section before the final DoD run, one row per acceptance item: the item number, the test or command that proves it, and its result. A row with no proof is unfinished work. Correct the table on every repair.';

function assertCarriesTableOnce(narration: string): void {
  assert.equal(narration.split(ACCEPTANCE_TABLE).length, 2, narration);
}

/** Starts a tdd card and returns its first build directive, which has no RED receipt yet. */
function firstBuild(fx: ReturnType<typeof makeFixture>) {
  writeCard(fx, { id: 'T0-AT', title: 'acceptance table', allowPaths: ['src/t0-at.ts'] });
  const goal = goalForCards(fx, ['T0-AT']);
  const card = fx.card('T0-AT');
  const runner = fx.runner();
  const prepared = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T0-AT'));
  const build = runner.next(fx.goal(goal.id), card, prepared.run);
  assert.equal(build.directive.kind, 'build', build.directive.narration);
  if (build.directive.kind !== 'build') throw new Error('unreachable');
  return { goal, card, runner, run: build.run, directive: build.directive };
}

test('T0-ACCEPT-TABLE acceptance 1: the build directive before RED carries the table text once [R1]', () => {
  const fx = makeFixture();
  try {
    const { directive } = firstBuild(fx);
    assert.equal(directive.tdd, true);
    assert.equal(directive.redReceipt, undefined);
    assert.match(directive.narration, /establish behavioural RED first/);
    assertCarriesTableOnce(directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T0-ACCEPT-TABLE acceptance 1: the build directive with a RED receipt carries the table text once [R1]', () => {
  const fx = makeFixture();
  try {
    const { goal, card, runner, run } = firstBuild(fx);
    const red = runner.recordAttempt(fx.goal(goal.id), card, run, { outcome: 'not-counted', notCountedReason: 'expected-red', redReceipt: 'red:1' });
    const next = runner.next(fx.goal(goal.id), card, red);
    assert.equal(next.directive.kind, 'build', next.directive.narration);
    if (next.directive.kind !== 'build') throw new Error('unreachable');
    assert.equal(next.directive.redReceipt, 'red:1');
    assert.match(next.directive.narration, /implement\/repair within allow_paths/);
    assertCarriesTableOnce(next.directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T0-ACCEPT-TABLE acceptance 1: the build directive of an R3 repair carries the table text once [R1]', async () => {
  const reason = '[spec] 6 tests missing @ src/t0-at.ts:1: no RED -> add a failing test';
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t0-at.ts\u0000' },
      'git diff': { stdout: 'diff --git a/src/t0-at.ts b/src/t0-at.ts\n+export const at = 1;\n' },
      'fake-r3': () => ({ stdout: JSON.stringify({ verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'block', reasons: [reason] }, standards: { verdict: 'pass', reasons: [] } } }) + '\n' }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T0-AT', title: 'acceptance table', allowPaths: ['src/t0-at.ts'] });
    const goal = goalForCards(fx, ['T0-AT']);
    const card = fx.card('T0-AT');
    const started = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T0-AT'));
    const built = runner.recordAttempt(fx.goal(goal.id), card, started.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    const ready = runner.next(fx.goal(goal.id), card, built);
    assert.equal(ready.directive.kind, 'review', ready.directive.narration);
    const block = await runner.formalReview(fx.goal(goal.id), card, ready.run);
    assert.equal(block.classified.outcome, 'block-defect');
    const repair = runner.next(fx.goal(goal.id), card, block.run);
    assert.equal(repair.directive.kind, 'build', repair.directive.narration);
    assert.ok(repair.directive.narration.startsWith('Review block to repair: '), repair.directive.narration);
    assertCarriesTableOnce(repair.directive.narration);
  } finally {
    fx.cleanup();
  }
});
