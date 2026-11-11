/**
 * Card T0-ASK-RECLASSIFY: a revision re-classifies the revised request text with the router and stores its ambiguity,
 * so the ask that a revision answered is not asked again; every other routing field stays the intake route.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { makeFixture, writeCard, driveCardToDone, goalForCards, type Fixture } from './_harness.ts';
import { Goal, type GoalRequest } from '../../src/core/types.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { runGoal } from '../../src/loop/run-driver.ts';

// The router's three questions (src/core/router.ts), written out so that a change of the rule shows here.
const BOTH = (n: number) => `bare number ${n} matches both a card stage prefix and issue #${n}; ask which is meant`;
const PREFIX = (n: number) => `bare number ${n} is a stage prefix, not a unique card id; ask for the full card id`;
const NEITHER = (n: number) => `bare number ${n} does not uniquely identify a card or issue`;

const PLAIN = 'build the hello feature';

function request(text: string, ref?: string): GoalRequest {
  return { text, source: ref ? 'issue' : 'natural-language', ref, affectedSurfaces: [] };
}

function registry(fx: Fixture): void {
  writeCard(fx, { id: 'T7-A', title: 'the card of stage 7', allowPaths: ['src/t7a.ts'] });
}

function amend(fx: Fixture, goalId: string, data: Record<string, unknown>) {
  return fx.controller.report({ goalId, generation: fx.goal(goalId).generation, result: 'revision', data });
}

function goalBytes(fx: Fixture, goalId: string): string {
  return readFileSync(fx.store.goalFile(goalId), 'utf8');
}

/** Every routing field but the question. */
function retained(goal: Goal): Record<string, unknown> {
  const { ambiguity: _ambiguity, ...rest } = goal.routing;
  return rest;
}

function refusal(fn: () => unknown): Error | undefined {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  return undefined;
}

test('the revision an ask asked for answers it: the revised text is re-classified and the goal plans', () => {
  const fx = makeFixture();
  try {
    registry(fx);
    const goal = fx.controller.createGoal(request('7'));
    const intake = fx.goal(goal.id).routing;
    const asked = fx.controller.next(goal.id);
    assert.equal(asked.kind, 'ask');
    if (asked.kind === 'ask') assert.equal(asked.question, PREFIX(7));
    const rep = amend(fx, goal.id, { text: 'run card T7-A', cards: ['T7-A'] });
    const revised = fx.goal(goal.id);
    assert.equal(revised.routing.ambiguity, undefined);
    assert.equal('ambiguity' in revised.routing, false, 'the question is removed, not set to undefined');
    assert.deepEqual(retained(revised), retained({ routing: intake } as Goal), 'every other routing field is the intake route');
    assert.equal(rep.directive.kind, 'project-cards', rep.directive.narration);
    assert.equal(fx.controller.next(goal.id).kind, 'project-cards');
  } finally {
    fx.cleanup();
  }
});

test("a revised text is classed by the router's bare-number rule, and each class asks the router's question for it", () => {
  const fx = makeFixture();
  try {
    registry(fx);
    // Each row: how the goal is created, the revised text, the question it asks (undefined: no ask).
    const issue7 = () => fx.controller.createGoal(request(PLAIN, '#7'), { knownIssueNumbers: [7] });
    const plain = () => fx.controller.createGoal(request(PLAIN));
    const seven = () => fx.controller.createGoal(request('7'));
    const rows: Array<[string, () => Goal, string, string | undefined]> = [
      ['(a) #7 with issue 7 and card T7-A', issue7, '#7', BOTH(7)],
      ['(a) " 7 " with issue 7 and card T7-A', issue7, ' 7 ', BOTH(7)],
      ['(a) a tab and a line break around 7', issue7, '\t7\n', BOTH(7)],
      ['(b) 7 with card T7-A only', plain, '7', PREFIX(7)],
      ['(b) 07 is the number 7', plain, '07', PREFIX(7)],
      ['(b) #7 with card T7-A and no issue number', plain, '#7', PREFIX(7)],
      ['(b) a ref that is not # and digits records no issue number', () => fx.controller.createGoal(request(PLAIN, '#7a')), '7', PREFIX(7)],
      ['(b) a ref of another repository records no issue number', () => fx.controller.createGoal(request(PLAIN, 'owner/repo#7')), '7', PREFIX(7)],
      ['(d) 99 names neither', plain, '99', NEITHER(99)],
      ['(d) six digits with no T123456- card', seven, '123456', NEITHER(123456)],
      ['(e) seven digits', seven, '1234567', undefined],
      ['(e) a minus sign', seven, '-7', undefined],
      ['(e) a plus sign', seven, '+7', undefined],
      ['(e) a decimal point', seven, '7.0', undefined],
      ['(e) prose with the number', seven, 'fix 7', undefined],
      ['(e) a space after the hash', seven, '# 7', undefined],
      ['(e) a full card id', seven, 'T7-A', undefined],
    ];
    for (const [label, create, text, question] of rows) {
      const goal = create();
      const rep = amend(fx, goal.id, { text });
      assert.equal(fx.goal(goal.id).routing.ambiguity, question, label);
      if (question === undefined) assert.notEqual(rep.directive.kind, 'ask', `${label}: ${rep.directive.narration}`);
      else {
        assert.equal(rep.directive.kind, 'ask', `${label}: ${rep.directive.narration}`);
        if (rep.directive.kind === 'ask') assert.equal(rep.directive.question, question, label);
      }
    }

    // (c) the issue number only: no ask, and the question the intake text asked is gone.
    const nine = fx.controller.createGoal(request('99', '#9'), { knownIssueNumbers: [9] });
    assert.equal(fx.goal(nine.id).routing.ambiguity, NEITHER(99));
    const rep = amend(fx, nine.id, { text: '9' });
    assert.equal(fx.goal(nine.id).routing.ambiguity, undefined);
    assert.notEqual(rep.directive.kind, 'ask', rep.directive.narration);

    // The class decides whatever the routing held before: a (d) question revised to 7 asks the (b) question.
    const ninetyNine = fx.controller.createGoal(request('99'));
    const prior = fx.goal(ninetyNine.id).routing.ambiguity;
    assert.equal(prior, NEITHER(99));
    const again = amend(fx, ninetyNine.id, { text: '7' });
    assert.equal(again.directive.kind, 'ask');
    if (again.directive.kind === 'ask') {
      assert.equal(again.directive.question, PREFIX(7));
      assert.notEqual(again.directive.question, prior);
    }
  } finally {
    fx.cleanup();
  }
});

/** The goal of `T1-A`, `T1-B` with the first card merged, in the state the row names. */
function twoCards(fx: Fixture, state: 'PLAN' | 'RUN' | 'WAIT' | 'CARDS' | 'VERIFY_ARC' | 'DELIVER' | 'CLOSE'): string {
  const size = state === 'CARDS' ? 'T2' : 'T1';
  const goal = goalForCards(fx, ['T1-A', 'T1-B'], { size, target: state === 'DELIVER' ? 'staging' : 'development' });
  driveCardToDone(fx, goal.id, 'T1-A');
  if (state === 'PLAN' || state === 'WAIT') fx.store.saveGoal(Goal.parse({ ...fx.goal(goal.id), state }));
  if (state === 'VERIFY_ARC' || state === 'DELIVER' || state === 'CLOSE') {
    driveCardToDone(fx, goal.id, 'T1-B');
    assert.equal(fx.controller.next(goal.id).kind, 'verify-arc');
  }
  if (state === 'DELIVER') assert.equal(fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } }).directive.kind, 'release');
  if (state === 'CLOSE') {
    const run = fx.store.getCardRun(goal.id, 'T1-B')!;
    fx.store.saveCardRun({ ...run, state: 'CLOSE', closure: { ...run.closure, lessons: false } });
    assert.equal(fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: ['dod:ok'] } }).directive.kind, 'close');
  }
  assert.equal(fx.goal(goal.id).state, state === 'DELIVER' ? 'DELIVER' : state);
  return goal.id;
}

test('the question gates only PLAN', () => {
  const fx = makeFixture();
  try {
    registry(fx);
    for (const id of ['T1-A', 'T1-B', 'T1-C']) writeCard(fx, { id, title: id.toLowerCase(), allowPaths: [`src/${id.toLowerCase()}.ts`] });
    // The state the goal is in, the revision data, the state after it, and the directive that follows.
    const rows: Array<[string, Parameters<typeof twoCards>[1], Record<string, unknown>, string, string]> = [
      ['PLAN', 'PLAN', { text: '7' }, 'PLAN', 'ask'],
      ['RUN', 'RUN', { text: '7' }, 'PLAN', 'ask'],
      ['WAIT', 'WAIT', { text: '7' }, 'PLAN', 'ask'],
      ['VERIFY_ARC with an added card that is not merged', 'VERIFY_ARC', { text: '7', cards: ['T1-A', 'T1-B', 'T1-C'] }, 'PLAN', 'ask'],
      ['CARDS (T2, not approved)', 'CARDS', { text: '7' }, 'CARDS', 'checkpoint'],
      ['VERIFY_ARC without an added card', 'VERIFY_ARC', { text: '7' }, 'VERIFY_ARC', 'verify-arc'],
      ['DELIVER', 'DELIVER', { text: '7' }, 'DELIVER', 'release'],
      ['CLOSE', 'CLOSE', { text: '7' }, 'CLOSE', 'close'],
    ];
    for (const [label, state, data, after, kind] of rows) {
      const goalId = twoCards(fx, state);
      const rep = amend(fx, goalId, data);
      assert.equal(fx.goal(goalId).state, after, label);
      assert.equal(fx.goal(goalId).routing.ambiguity, PREFIX(7), `${label}: the question is stored`);
      assert.equal(rep.directive.kind, kind, `${label}: ${rep.directive.narration}`);
      if (rep.directive.kind === 'ask') assert.equal(rep.directive.question, PREFIX(7), label);
    }

    // A revision that computeRevision refuses changes neither routing nor journal.
    const goalId = fx.controller.createGoal(request(PLAIN)).id;
    const before = goalBytes(fx, goalId);
    const journal = fx.events(goalId).length;
    const err = refusal(() => amend(fx, goalId, { text: '7', cards: ['T9-NOT-IN-REGISTRY'] }));
    assert.ok(err, 'the revision that lists an unknown card was accepted');
    assert.equal(goalBytes(fx, goalId), before);
    assert.equal(fx.events(goalId).length, journal);
    assert.equal(fx.goal(goalId).routing.ambiguity, undefined);
  } finally {
    fx.cleanup();
  }
});

test('a resume stores the re-classified question and re-enters through CARDS', () => {
  const fx = makeFixture();
  try {
    registry(fx);
    for (const id of ['T1-A', 'T1-B', 'T1-C']) writeCard(fx, { id, title: id.toLowerCase(), allowPaths: [`src/${id.toLowerCase()}.ts`] });
    const cancelled = (size: 'T1' | 'T2', lastText: string | undefined): string => {
      const goal = goalForCards(fx, ['T1-A'], { size });
      if (lastText !== undefined) amend(fx, goal.id, { text: lastText });
      fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'answer by revision' } });
      return goal.id;
    };
    // The carried text is the new text, or the last revision's when only --cards or --replace is given.
    const rows: Array<[string, string, Record<string, unknown>, string, string, string]> = [
      ['--text 7', cancelled('T1', undefined), { text: '7' }, 'run-card', 'RUN', 'T1-A'],
      ['--cards only, last revision text 7', cancelled('T1', '7'), { cards: ['T1-A', 'T1-B'] }, 'run-card', 'RUN', 'T1-A'],
      ['--replace only, last revision text 7', cancelled('T1', '7'), { replacements: { 'T1-A': 'T1-C' } }, 'run-card', 'RUN', 'T1-C'],
      ['T2, --text 7, revision not approved', cancelled('T2', undefined), { text: '7' }, 'checkpoint', 'CARDS', ''],
    ];
    for (const [label, goalId, data, kind, state, cardId] of rows) {
      const rep = fx.controller.report({ goalId, generation: 0, result: 'resume', data: { reason: 'answer', ...data } });
      assert.equal(fx.goal(goalId).routing.ambiguity, PREFIX(7), `${label}: the question of the revised text is stored`);
      assert.equal(rep.directive.kind, kind, `${label}: ${rep.directive.narration}`);
      assert.equal(fx.goal(goalId).state, state, label);
      if (rep.directive.kind === 'run-card') assert.equal(rep.directive.cardId, cardId, label);
    }
  } finally {
    fx.cleanup();
  }
});

test('aidlc run returns the ask of a still ambiguous revised goal without a provider call, and plans after a revision that removed it', async () => {
  const fx = makeFixture();
  try {
    registry(fx);
    const deps = (provider: MockProvider) => ({ controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    const still = fx.controller.createGoal(request(PLAIN));
    amend(fx, still.id, { text: '7' });
    const idle = new MockProvider();
    const asked = await runGoal(still.id, 3, deps(idle));
    assert.equal(asked.kind, 'ask');
    if (asked.kind === 'ask') assert.equal(asked.question, PREFIX(7));
    assert.equal(idle.calls.length, 0);

    const answered = fx.controller.createGoal(request('7'));
    amend(fx, answered.id, { text: 'run card T7-A', cards: ['T7-A'] });
    const provider = new MockProvider();
    const failures: string[] = [];
    const first = await runGoal(answered.id, 1, { ...deps(provider), onFailure: (reason) => failures.push(reason) });
    assert.equal(first.kind, 'project-cards', first.narration);
    assert.equal(provider.calls.length, 1, `the provider is dispatched for the directive: ${failures.join(' | ')}`);
    assert.match(provider.calls[0]!.prompt, /"kind":"project-cards"/);
  } finally {
    fx.cleanup();
  }
});
