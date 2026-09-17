import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, driveCardToDone, goalForCards, T0 } from './_harness.ts';

/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

function threeCards(fx: ReturnType<typeof makeFixture>, resources?: string[]) {
  writeCard(fx, { id: 'T1-A', title: 'freeze the interface', freeze: true, allowPaths: ['src/a.ts'] });
  writeCard(fx, { id: 'T1-B', title: 'implement b', dependsOn: ['T1-A'], allowPaths: ['src/b.ts'], resources });
  writeCard(fx, { id: 'T1-C', title: 'implement c', dependsOn: ['T1-A'], allowPaths: ['src/c.ts'], resources });
}

test('Q3/Q9: a T1 arc runs the freeze card alone, then two disjoint cards in one wave with cap two', () => {
  const fx = makeFixture();
  try {
    threeCards(fx);
    const goal = goalForCards(fx, ['T1-A', 'T1-B', 'T1-C'], { size: 'T1' });
    assert.equal(goal.state, 'RUN');
    assert.equal(goal.routing.size, 'T1');
    assert.equal(goal.deadlines.goalDeadline, '2026-09-11T12:00:00.000Z', 'multi-card arc has the 12h limit');

    const d0 = fx.controller.next(goal.id);
    assert.equal(d0.kind, 'run-card');
    if (d0.kind === 'run-card') {
      assert.equal(d0.cardId, 'T1-A');
      assert.deepEqual(d0.context['wave'], ['T1-A'], 'freeze card runs alone');
    }
    driveCardToDone(fx, goal.id, 'T1-A');

    const d1 = fx.controller.next(goal.id);
    assert.equal(d1.kind, 'run-card');
    if (d1.kind === 'run-card') {
      assert.ok(['T1-B', 'T1-C'].includes(d1.cardId));
      assert.deepEqual([...(d1.context['wave'] as string[])].sort(), ['T1-B', 'T1-C']);
      assert.equal(d1.context['workers'], 2);
    }
    driveCardToDone(fx, goal.id, 'T1-B');
    driveCardToDone(fx, goal.id, 'T1-C');

    const d2 = fx.controller.next(goal.id);
    assert.equal(d2.kind, 'verify-arc');
    if (d2.kind === 'verify-arc') {
      assert.deepEqual(d2.cards, ['T1-A', 'T1-B', 'T1-C']);
      assert.equal(d2.repairCyclesLeft, 1);
      assert.ok(d2.integratedChecks.some((c) => /cross-card/.test(c)));
    }
  } finally {
    fx.cleanup();
  }
});

test('Q9: cards sharing a declared resource serialise even with disjoint allow_paths', () => {
  const fx = makeFixture();
  try {
    threeCards(fx, ['db:main']);
    const goal = goalForCards(fx, ['T1-A', 'T1-B', 'T1-C'], { size: 'T1' });
    driveCardToDone(fx, goal.id, 'T1-A');
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'run-card');
    if (d.kind === 'run-card') {
      assert.equal((d.context['wave'] as string[]).length, 1, 'shared db resource keeps the wave at one card');
      assert.ok((d.context['arcReasons'] as string[]).some((r) => /serialised: shares resources/.test(r)));
    }
  } finally {
    fx.cleanup();
  }
});

test('Q10: integrated acceptance failure opens one bounded repair cycle; a second failure is STOP/arc-verify', () => {
  const fx = makeFixture();
  try {
    threeCards(fx);
    writeCard(fx, { id: 'T1-FIX', title: 'repair the combined workflow', allowPaths: ['src/fix.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B', 'T1-C'], { size: 'T1' });
    for (const id of ['T1-A', 'T1-B', 'T1-C']) driveCardToDone(fx, goal.id, id);
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');

    const failed = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-failed', data: { repairCards: ['T1-FIX'], detail: 'combined workflow broken' } });
    const g1 = fx.goal(goal.id);
    assert.equal(g1.counters.integrationRepairCycles, 1);
    assert.ok(g1.cards.includes('T1-FIX'));
    assert.equal(g1.stages.development, 'fail');
    assert.equal(failed.directive.kind, 'run-card');
    if (failed.directive.kind === 'run-card') assert.equal(failed.directive.cardId, 'T1-FIX');
    assert.equal(fx.goal(goal.id).state, 'RUN');

    driveCardToDone(fx, goal.id, 'T1-FIX');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');

    const second = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-failed', data: { repairCards: ['T1-FIX'], detail: 'still broken' } });
    assert.equal(second.directive.kind, 'stop');
    const g2 = fx.goal(goal.id);
    assert.equal(g2.state, 'STOP');
    assert.equal(g2.terminal, true);
    assert.equal(g2.stop?.reason, 'arc-verify');
    assert.equal(g2.counters.integrationRepairCycles, 1, 'no second cycle is opened');
  } finally {
    fx.cleanup();
  }
});

test('Q9: a child STOP blocks its dependents and the goal stops with the child reason when nothing else is ready', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-X', title: 'x', allowPaths: ['src/x.ts'] });
    writeCard(fx, { id: 'T1-Y', title: 'y', dependsOn: ['T1-X'], allowPaths: ['src/y.ts'] });
    const goal = goalForCards(fx, ['T1-X', 'T1-Y'], { size: 'T1' });
    fx.controller.ensureCardRun(goal, 'T1-X');
    const r = fx.controller.report({
      goalId: goal.id,
      generation: 0,
      result: 'card-result',
      cardId: 'T1-X',
      data: { state: 'STOP', stop: { reason: 'capability', detail: 'no reviewer backend', nextAction: 'configure the reviewer', global: false, at: T0 } },
    });
    assert.equal(r.directive.kind, 'stop');
    const g = fx.goal(goal.id);
    assert.equal(g.state, 'STOP');
    assert.equal(g.stop?.reason, 'capability');
    assert.ok(/blocked by stopped dependencies: T1-Y/.test(g.stop?.detail ?? ''), g.stop?.detail);
  } finally {
    fx.cleanup();
  }
});

test('a prerequisite merged under an earlier goal satisfies the gate: the goal dispatches its card instead of stopping on a required gap', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-EARLIER', title: 'merged under an earlier goal', status: 'merged', allowPaths: ['src/earlier.ts'] });
    writeCard(fx, { id: 'T1-NEXT', title: 'the next card of the plan', dependsOn: ['T1-EARLIER'], allowPaths: ['src/next.ts'] });
    const goal = goalForCards(fx, ['T1-NEXT']);
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'run-card', d.narration);
    if (d.kind === 'run-card') {
      assert.equal(d.cardId, 'T1-NEXT');
      assert.deepEqual(d.context['wave'], ['T1-NEXT'], 'the merged prerequisite is never dispatched with its dependent');
    }
    assert.deepEqual(fx.goal(goal.id).cards, ['T1-NEXT'], 'the projection still holds one card');
  } finally {
    fx.cleanup();
  }
});

test('a prerequisite outside the projection that has not merged is still a required gap', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-OPEN', title: 'open under no goal', allowPaths: ['src/open.ts'] });
    writeCard(fx, { id: 'T1-NEXT', title: 'the next card of the plan', dependsOn: ['T1-OPEN'], allowPaths: ['src/next.ts'] });
    const goal = goalForCards(fx, ['T1-NEXT']);
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'stop', d.narration);
    assert.equal(fx.goal(goal.id).stop?.reason, 'card');
    assert.match(fx.goal(goal.id).stop?.detail ?? '', /required gaps remain/);
  } finally {
    fx.cleanup();
  }
});

test('aidlc board prints the one text it writes: the arc of a projection whose prerequisite merged elsewhere, rendered once', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-EARLIER', title: 'merged under an earlier goal', status: 'merged', allowPaths: ['src/earlier.ts'] });
    writeCard(fx, { id: 'T1-NEXT', title: 'the next card of the plan', dependsOn: ['T1-EARLIER'], allowPaths: ['src/next.ts'] });
    const goal = goalForCards(fx, ['T1-NEXT']);
    const r = spawnSync(process.execPath, [MAIN, 'board', '--goal', goal.id], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    const written = readFileSync(path.join(fx.paths.board, `${goal.id}.md`), 'utf8');
    assert.equal(r.stdout, written + '\n', 'the printed board is the board that was written, not a second render');
    assert.match(written, /^- \*\*Arc\*\*: verdict=dispatch workers=\d+ wave=T1-NEXT ready=T1-NEXT$/m);
  } finally {
    fx.cleanup();
  }
});
