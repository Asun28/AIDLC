import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { makeStop } from '../../src/core/stop.ts';
import { driveCardToDone } from './_harness.ts';
import { readFileSync, writeFileSync } from 'node:fs';

test('Q5: a requirement revision versions the same goal, maps superseded cards and returns to PLAN', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
    writeCard(fx, { id: 'T1-C', title: 'c (replaces b)', allowPaths: ['src/c.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' });
    assert.equal(goal.state, 'RUN');
    const r = fx.controller.report({ goalId: goal.id, generation: 0, result: 'revision', data: { text: 'build the hello feature, but c instead of b', cards: ['T1-A', 'T1-C'], replacements: { 'T1-B': 'T1-C' }, reason: 'user amendment' } });
    const g = fx.goal(goal.id);
    assert.equal(g.revision, 1);
    assert.equal(g.revisions.length, 2);
    assert.equal(g.revisions[1]!.request.text, 'build the hello feature, but c instead of b');
    assert.deepEqual(g.revisions[1]!.supersededCards, { 'T1-B': 'T1-C' });
    assert.deepEqual(g.revisions[1]!.removedCards, []);
    assert.deepEqual(g.cards, ['T1-A', 'T1-C']);
    assert.equal(g.cardRevisions['T1-A'], 0, 'unaffected card keeps its revision and evidence');
    assert.equal(g.cardRevisions['T1-C'], 0);
    assert.equal(g.state, 'PLAN');
    assert.equal(g.generation, 0, 'a revision does not change the execution generation');
    assert.ok(fx.events(goal.id).some((e) => e.type === 'GOAL_REVISED'));
    assert.ok(['plan', 'project-cards'].includes(r.directive.kind));
  } finally {
    fx.cleanup();
  }
});

test('Q5: a stale dispatch (wrong generation) is refused before any mutation', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    const before = fx.events(goal.id).length;
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 7, result: 'cards-projected', data: { cards: ['T1-HELLO'] } }), /stale report/);
    assert.equal(fx.events(goal.id).length, before);
    assert.equal(fx.goal(goal.id).state, 'RUN');
  } finally {
    fx.cleanup();
  }
});

test('Q5/Q8: a terminal goal refuses new work; resume links the old generation and keeps exhausted limits', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goal = goalForCards(fx, ['T1-HELLO']);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'user cancelled' } });
    const cancelled = fx.goal(goal.id);
    assert.equal(cancelled.terminal, true);
    assert.equal(cancelled.stop?.reason, 'cancelled');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-HELLO'] } }), /terminal/);
    assert.equal(fx.controller.next(goal.id).kind, 'stop');

    const resumed = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'user asked to continue' } });
    const g = fx.goal(goal.id);
    assert.equal(g.generation, 1);
    assert.equal(g.terminal, false);
    assert.equal(g.linkedFrom, `${goal.id}@0`);
    assert.equal(g.deadlines.goalDeadline, goal.deadlines.goalDeadline, 'the original deadline is preserved');
    assert.notEqual(resumed.directive.kind, 'stop');
    assert.equal(resumed.directive.generation, 1);
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-HELLO'] } }), /stale report/, 'old-generation dispatch is refused after resume');
  } finally {
    fx.cleanup();
  }
});

test('R2/R3: a resume carries its revision so a stopped goal continues with the replacement card; an amendment on a terminal goal names the resume', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-A2', title: 'a again, replacement', allowPaths: ['src/a.ts'] });
    const goal = goalForCards(fx, ['T1-A']);
    const runner = fx.runner();
    let r = runner.next(fx.goal(goal.id), fx.card('T1-A'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A'));
    r = runner.next(fx.goal(goal.id), fx.card('T1-A'), r.run);
    fx.store.saveCardRun({ ...r.run, state: 'STOP', stop: makeStop('review', 'second substantive block', 'adjudicate', { at: fx.now(), global: false }) });
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.equal(fx.goal(goal.id).terminal, true);
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'revision', data: { text: 'again', replacements: { 'T1-A': 'T1-A2' } } }), /goal resume \S+ --text .* --replace/, 'an amendment on a terminal goal names the resume with both flags');
    const eventsBefore = fx.events(goal.id).length;
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'blank', text: '' } }), /non-empty/, 'a carried revision is validated before anything is journaled');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'bad map', text: 'x', replacements: { 'T1-A': 7 } } }), /replacements/);
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'wrong card', text: 'x', replacements: { 'T1-ZZ': 'T1-A2' } } }), /outside the goal/, 'a replacement of a card the goal never had is refused');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'inconsistent', text: 'x', cards: ['T1-A'], replacements: { 'T1-A': 'T1-A2' } } }), /listed/, 'a replacement absent from the listed cards is refused');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'absent card', text: 'x', replacements: { 'T1-A': 'T1-MISSING' } } }), /registry/, 'a replacement the registry does not know is refused');
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'both listed', text: 'x', cards: ['T1-A', 'T1-A2'], replacements: { 'T1-A': 'T1-A2' } } }), /still listed/, 'a replacement whose superseded card is still listed is refused');
    assert.equal(fx.events(goal.id).length, eventsBefore, 'no takeover event for a refused resume');
    assert.equal(fx.goal(goal.id).generation, 0);
    const plain = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'first look' } });
    assert.equal(plain.directive.kind, 'stop', 'a resume without a revision re-projects the same stopped card and stops again');
    const resumed = fx.controller.report({ goalId: goal.id, generation: 1, result: 'resume', data: { reason: 'ruling', text: 'continue with the replacement card', replacements: { 'T1-A': 'T1-A2' } } });
    const g = fx.goal(goal.id);
    assert.equal(g.generation, 2);
    assert.deepEqual(g.cards, ['T1-A2']);
    assert.equal(g.revision, 1);
    const types = fx.events(goal.id).map((e) => e.type);
    assert.ok(types.lastIndexOf('GOAL_REVISED') > types.lastIndexOf('GOAL_TAKEOVER'), 'the revision is journaled inside the resume');
    assert.equal(resumed.directive.kind, 'run-card', resumed.directive.narration);
    if (resumed.directive.kind === 'run-card') assert.equal(resumed.directive.cardId, 'T1-A2');
  } finally {
    fx.cleanup();
  }
});

test('R2: resuming a DONE goal with a replacement card re-enters execution through the projection and re-verifies the arc', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-A2', title: 'a again, replacement', allowPaths: ['src/a.ts'] });
    const goal = goalForCards(fx, ['T1-A']);
    driveCardToDone(fx, goal.id, 'T1-A');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } });
    assert.equal(fx.goal(goal.id).state, 'DONE');
    const resumed = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'more work', text: 'continue with the replacement', replacements: { 'T1-A': 'T1-A2' } } });
    const g = fx.goal(goal.id);
    assert.deepEqual(g.cards, ['T1-A2']);
    assert.equal(g.stages.development, 'pending', 'completion evidence is invalidated by the revision');
    assert.equal(resumed.directive.kind, 'run-card', resumed.directive.narration);
    if (resumed.directive.kind === 'run-card') assert.equal(resumed.directive.cardId, 'T1-A2');
    assert.equal(g.state, 'RUN');
  } finally {
    fx.cleanup();
  }
});

test('R2: a T2 goal resumed with a replacement card passes the plan checkpoint for the new revision before the replacement is dispatched', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-A2', title: 'a again, replacement', allowPaths: ['src/a.ts'] });
    const goal = goalForCards(fx, ['T1-A'], { size: 'T2' });
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'approved', data: { kind: 'plan-checkpoint', by: 'user' } });
    assert.equal(fx.controller.next(goal.id).kind, 'run-card');
    const runner = fx.runner();
    let r = runner.next(fx.goal(goal.id), fx.card('T1-A'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A'));
    r = runner.next(fx.goal(goal.id), fx.card('T1-A'), r.run);
    fx.store.saveCardRun({ ...r.run, state: 'STOP', stop: makeStop('review', 'second substantive block', 'adjudicate', { at: fx.now(), global: false }) });
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    const resumed = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'ruling', text: 'continue with the replacement card', replacements: { 'T1-A': 'T1-A2' } } });
    assert.equal(resumed.directive.kind, 'checkpoint', `revision 1 is not approved yet: ${resumed.directive.narration}`);
    assert.equal(fx.goal(goal.id).revision, 1);
    const early = runner.next(fx.goal(goal.id), fx.card('T1-A2'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A2'));
    assert.equal(early.directive.kind, 'wait', `no worker execution of the replacement before the checkpoint: ${early.directive.narration}`);
    fx.controller.report({ goalId: goal.id, generation: 1, result: 'approved', data: { kind: 'plan-checkpoint', by: 'user' } });
    const after = fx.controller.next(goal.id);
    assert.equal(after.kind, 'run-card', after.narration);
    if (after.kind === 'run-card') assert.equal(after.cardId, 'T1-A2');
  } finally {
    fx.cleanup();
  }
});

test('R2: a resumed goal never reuses the delivered release of an earlier generation; the replacement candidate gets a fresh attempt', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-A2', title: 'a again, replacement', allowPaths: ['src/a.ts'] });
    const goal = goalForCards(fx, ['T1-A'], { target: 'staging' });
    driveCardToDone(fx, goal.id, 'T1-A');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    const rep = fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: {} });
    assert.equal(rep.directive.kind, 'release');
    const first = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
    const delivered = fx.store.getRelease(first)!;
    fx.store.saveRelease({ ...delivered, state: 'DONE', disposition: 'delivered', updatedAt: fx.now() });
    assert.equal(fx.controller.next(goal.id).kind, 'done');
    assert.equal(fx.goal(goal.id).state, 'DONE');
    const resumed = fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'follow-up', text: 'ship the replacement', replacements: { 'T1-A': 'T1-A2' } } });
    assert.equal(resumed.directive.kind, 'run-card', resumed.directive.narration);
    driveCardToDone(fx, goal.id, 'T1-A2');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    const again = fx.controller.report({ goalId: goal.id, generation: 1, result: 'arc-verified', data: {} });
    assert.equal(again.directive.kind, 'release', `a fresh release, never the delivered one of generation 0: ${again.directive.narration}`);
    if (again.directive.kind === 'release') {
      assert.notEqual(again.directive.attemptId, first);
      assert.equal(fx.store.getRelease(again.directive.attemptId)!.generation, 1);
    }
  } finally {
    fx.cleanup();
  }
});

test('R2: a resume that retains a repair card added by arc-failed keeps a revision entry for it instead of refusing the continuation', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
    writeCard(fx, { id: 'T1-FIX', title: 'repair the combined workflow', allowPaths: ['src/fix.ts'] });
    writeCard(fx, { id: 'T1-FIX2', title: 'second repair', allowPaths: ['src/fix2.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' });
    for (const id of ['T1-A', 'T1-B']) driveCardToDone(fx, goal.id, id);
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-failed', data: { repairCards: ['T1-FIX'], detail: 'combined workflow broken' } });
    assert.equal(fx.goal(goal.id).cardRevisions['T1-FIX'], undefined, 'the repair card was added without a revision entry');
    const fix = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-FIX');
    fx.store.saveCardRun({ ...fix, state: 'STOP', stop: makeStop('review', 'second substantive block', 'adjudicate', { at: fx.now(), global: false }) });
    assert.equal(fx.controller.next(goal.id).kind, 'stop');
    assert.equal(fx.goal(goal.id).terminal, true);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'add a second repair', text: 'repair in two cards', cards: ['T1-A', 'T1-B', 'T1-FIX', 'T1-FIX2'] } });
    const g = fx.goal(goal.id);
    assert.equal(g.generation, 1);
    assert.deepEqual(g.cards, ['T1-A', 'T1-B', 'T1-FIX', 'T1-FIX2']);
    assert.equal(g.cardRevisions['T1-FIX'], 0, 'a retained card without an entry starts at revision 0');
    assert.equal(g.cardRevisions['T1-FIX2'], 0);
    assert.equal(g.cardRevisions['T1-A'], 0, 'closed cards keep their revision and evidence');
  } finally {
    fx.cleanup();
  }
});

test('R2: a revision that leaves a listed card without its prerequisite is refused before anything is journaled', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-A', title: 'a', allowPaths: ['src/a.ts'] });
    const bFile = writeCard(fx, { id: 'T1-B', title: 'b, after a', allowPaths: ['src/b.ts'] });
    writeFileSync(bFile, readFileSync(bFile, 'utf8').replace('dod_exit: 0\n', 'dod_exit: 0\ndepends_on:\n  - T1-A\n'), 'utf8');
    writeCard(fx, { id: 'T1-A2', title: 'a again, replacement', allowPaths: ['src/a.ts'] });
    const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size: 'T1' });
    assert.deepEqual(fx.card('T1-B').depends_on, ['T1-A']);
    const runner = fx.runner();
    let r = runner.next(fx.goal(goal.id), fx.card('T1-A'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A'));
    r = runner.next(fx.goal(goal.id), fx.card('T1-A'), r.run);
    fx.store.saveCardRun({ ...r.run, state: 'STOP', stop: makeStop('review', 'second substantive block', 'adjudicate', { at: fx.now(), global: false }) });
    assert.equal(fx.controller.next(goal.id).kind, 'stop', 'b is blocked behind the stopped a');
    const eventsBefore = fx.events(goal.id).length;
    assert.throws(() => fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'replace a', text: 'a again', replacements: { 'T1-A': 'T1-A2' } } }), /T1-B depends on T1-A/, 'the replacement leaves b without its prerequisite');
    assert.equal(fx.events(goal.id).length, eventsBefore, 'a refused resume journals nothing');
    assert.equal(fx.goal(goal.id).generation, 0);
  } finally {
    fx.cleanup();
  }
});
