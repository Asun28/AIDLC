import assert from 'node:assert/strict';
import { test } from 'node:test';
import { goalForCards, makeFixture, writeCard } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath, ScaffoldShipPath, type ShipPath } from '../../src/delivery/ship.ts';

/** The two directive texts, as their cards word them. */
const PR_SUMMARY_ASK = 'When allow_paths lists this card file, write a `## PR summary` section in it before the final DoD run, for a person who reads the pull request: the headings `### What`, `### Why / Intent`, `### How / Behaviour`, `### System impact`, `### Security`, `### Tests and review`, `### Risk`, `### Ownership` and `### Docs` in that order, one to three short sentences under each, in ASD-STE100 style (at most 20 words a sentence, active voice, one meaning for each word) and New Zealand spelling, at most 4000 characters and no `@`. The GitHub ship path makes it the text of the pull request it creates. Correct it on every repair.';
const ACCEPTANCE_TABLE = 'When allow_paths lists this card file, write a table in its `## Attempt evidence` section before the final DoD run, one row per acceptance item: the item number, the test or command that proves it, and its result. A row with no proof is unfinished work. Correct the table on every repair.';

/** The narration holds the summary instruction once, and it stands directly before the table instruction with one space between. */
function assertAsksOnceBeforeTable(narration: string): void {
  assert.equal(narration.split(PR_SUMMARY_ASK).length, 2, narration);
  assert.equal(narration.split(`${PR_SUMMARY_ASK} ${ACCEPTANCE_TABLE}`).length, 2, narration);
}

/** Starts a tdd card and returns its first build directive, which has no RED receipt yet. */
/** A scaffold ship path whose worktree holds no `.red` file, so the build before RED takes its scaffold wording. */
class NoRedScaffold extends ScaffoldShipPath {
  override readRedReceipt(): undefined {
    return undefined;
  }
}

function firstBuild(fx: ReturnType<typeof makeFixture>, shipPath?: ShipPath) {
  writeCard(fx, { id: 'T0-PS', title: 'summary instruction', allowPaths: ['src/t0-ps.ts'] });
  const goal = goalForCards(fx, ['T0-PS']);
  const card = fx.card('T0-PS');
  const runner = fx.runner(shipPath);
  const prepared = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T0-PS'));
  const build = runner.next(fx.goal(goal.id), card, prepared.run);
  assert.equal(build.directive.kind, 'build', build.directive.narration);
  if (build.directive.kind !== 'build') throw new Error('unreachable');
  return { goal, card, runner, run: build.run, directive: build.directive };
}

test('T0-PR-SUMMARY-ASK acceptance 1: the build directive before RED asks for the PR summary once, directly before the table [R1]', () => {
  const fx = makeFixture();
  try {
    const { directive } = firstBuild(fx);
    assert.equal(directive.redReceipt, undefined);
    assert.match(directive.narration, /establish behavioural RED first/);
    assertAsksOnceBeforeTable(directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T0-PR-SUMMARY-ASK acceptance 1: the build directive before RED on the scaffold ship path asks for the PR summary once, directly before the table [R1]', () => {
  const fx = makeFixture();
  try {
    const { directive } = firstBuild(fx, new NoRedScaffold({ mainRoot: fx.tmp, worktreeRoot: fx.config.worktreeRoot }));
    assert.equal(directive.redReceipt, undefined);
    assert.match(directive.narration, /establish behavioural RED first with `aidlc card red T0-PS`/);
    assertAsksOnceBeforeTable(directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T0-PR-SUMMARY-ASK acceptance 1: the build directive with a RED receipt asks for the PR summary once, directly before the table [R1]', () => {
  const fx = makeFixture();
  try {
    const { goal, card, runner, run } = firstBuild(fx);
    const red = runner.recordAttempt(fx.goal(goal.id), card, run, { outcome: 'not-counted', notCountedReason: 'expected-red', redReceipt: 'red:1' });
    const next = runner.next(fx.goal(goal.id), card, red);
    assert.equal(next.directive.kind, 'build', next.directive.narration);
    if (next.directive.kind !== 'build') throw new Error('unreachable');
    assert.equal(next.directive.redReceipt, 'red:1');
    assert.match(next.directive.narration, /implement\/repair within allow_paths/);
    assertAsksOnceBeforeTable(next.directive.narration);
  } finally {
    fx.cleanup();
  }
});

test('T0-PR-SUMMARY-ASK acceptance 1: the build directive of an R3 repair asks for the PR summary once, directly before the table [R1]', async () => {
  const reason = '[spec] 6 tests missing @ src/t0-ps.ts:1: no RED -> add a failing test';
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    const script = scriptedRunner({
      'git diff --name-only': { stdout: 'src/t0-ps.ts\u0000' },
      'git diff': { stdout: 'diff --git a/src/t0-ps.ts b/src/t0-ps.ts\n+export const ps = 1;\n' },
      'fake-r3': () => ({ stdout: JSON.stringify({ verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'block', reasons: [reason] }, standards: { verdict: 'pass', reasons: [] } } }) + '\n' }),
    });
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
    writeCard(fx, { id: 'T0-PS', title: 'summary instruction', allowPaths: ['src/t0-ps.ts'] });
    const goal = goalForCards(fx, ['T0-PS']);
    const card = fx.card('T0-PS');
    const started = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T0-PS'));
    const built = runner.recordAttempt(fx.goal(goal.id), card, started.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-1' });
    const ready = runner.next(fx.goal(goal.id), card, built);
    assert.equal(ready.directive.kind, 'review', ready.directive.narration);
    const block = await runner.formalReview(fx.goal(goal.id), card, ready.run);
    assert.equal(block.classified.outcome, 'block-defect');
    const repair = runner.next(fx.goal(goal.id), card, block.run);
    assert.equal(repair.directive.kind, 'build', repair.directive.narration);
    assert.ok(repair.directive.narration.startsWith('Review block to repair: '), repair.directive.narration);
    assertAsksOnceBeforeTable(repair.directive.narration);
  } finally {
    fx.cleanup();
  }
});
