import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { ScaffoldShipPath } from '../../src/delivery/ship.ts';
import type { ShipPath } from '../../src/delivery/ship.ts';

// Card T0-RED-PATH-TEXT: the BUILD directive and card-loop.md BUILD name the command that records RED on the configured ship path.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACCEPTANCE_TABLE = 'When allow_paths lists this card file, write a table in its `## Attempt evidence` section before the final DoD run, one row per acceptance item: the item number, the test or command that proves it, and its result. A row with no proof is unfinished work. Correct the table on every repair.';

/** A scaffold ship path whose worktree holds no `.red` file. */
class NoRedScaffold extends ScaffoldShipPath {
  override readRedReceipt(): undefined {
    return undefined;
  }
}

/** Starts the tdd card T0-RPT and returns the narration of its first BUILD directive, which has no RED receipt. */
function firstBuildNarration(fx: Fixture, shipPath?: ShipPath): string {
  writeCard(fx, { id: 'T0-RPT', title: 'red path text', allowPaths: ['src/t0-rpt.ts'] });
  const goal = goalForCards(fx, ['T0-RPT']);
  const card = fx.card('T0-RPT');
  const runner = fx.runner(shipPath);
  const prepared = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), 'T0-RPT'));
  const build = runner.next(fx.goal(goal.id), card, prepared.run);
  assert.equal(build.directive.kind, 'build', build.directive.narration);
  if (build.directive.kind !== 'build') throw new Error('unreachable');
  assert.equal(build.directive.tdd, true);
  assert.equal(build.directive.redReceipt, undefined);
  return build.directive.narration;
}

test('T0-RED-PATH-TEXT acceptance 1: off the scaffold ship path, BUILD before RED names --red-receipt on card attempt and no task.ps1 [R2]', () => {
  const fx = makeFixture();
  try {
    const narration = firstBuildNarration(fx);
    assert.equal(
      narration,
      `Attempt 1 at effort medium: establish behavioural RED first, then implement within allow_paths and run the DoD. Record the result with \`aidlc card attempt T0-RPT --outcome success --dod-receipt "<command: exit code and counts>" --red-receipt "<sha>:<test>"\` or \`aidlc card attempt T0-RPT --outcome fail --cause ...\`. ${ACCEPTANCE_TABLE}`,
    );
    assert.ok(narration.includes('--red-receipt "<sha>:<test>"'), narration);
    assert.ok(!narration.includes('task.ps1'), narration);
  } finally {
    fx.cleanup();
  }
});

test('T0-RED-PATH-TEXT acceptance 2: on the scaffold ship path, BUILD before RED names aidlc card red and no --red-receipt [R3]', () => {
  const fx = makeFixture();
  try {
    const narration = firstBuildNarration(fx, new NoRedScaffold({ mainRoot: fx.tmp, worktreeRoot: fx.config.worktreeRoot }));
    assert.ok(narration.includes('establish behavioural RED first with `aidlc card red T0-RPT` (task.ps1 -Phase red writes .review/T0-RPT.red)'), narration);
    assert.ok(!narration.includes('--red-receipt'), narration);
    assert.equal(
      narration,
      `Attempt 1 at effort medium: establish behavioural RED first with \`aidlc card red T0-RPT\` (task.ps1 -Phase red writes .review/T0-RPT.red), then implement within allow_paths and run the DoD. Record the result with \`aidlc card attempt T0-RPT --outcome success --dod-receipt "<command: exit code and counts>"\` or \`aidlc card attempt T0-RPT --outcome fail --cause ...\`. ${ACCEPTANCE_TABLE}`,
    );
  } finally {
    fx.cleanup();
  }
});

for (const copy of ['.claude/skills/aidlc-loop/card-loop.md', 'templates/claude/skills/aidlc-loop/card-loop.md']) {
  test(`T0-RED-PATH-TEXT acceptance 3: ${copy} BUILD names card attempt --red-receipt, and card red for scaffold only [R1]`, () => {
    const text = readFileSync(path.join(ROOT, copy), 'utf8').replace(/\s+/g, ' ');
    assert.ok(text.includes('TDD: prove behavioral RED first (`card attempt --red-receipt`; scaffold: `card red`).'), copy);
    assert.ok(!text.includes('(`aidlc card red <id>`; scaffold: task.ps1'), copy);
  });
}
