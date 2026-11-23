import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, type Fixture } from './_harness.ts';
import type { Directive } from '../../src/loop/directive.ts';

// T1-CARD-WRITER-LESSONS: the `plan` and `project-cards` directives carry the count and the ten most recent lines of
// docs/LESSONS.md, and their narration names the count and the file and says every card is checked against them
// before it is registered.

const VALID = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return `- 2026-11-${n} T0-WRITER-${n}: ${i % 2 ? 'ALWAYS' : 'NEVER'} write rule number ${n} of the card writer (source: PR 9${n})`;
});
const NOT_A_LESSON = 'This line is not a lesson and is not counted.';
const FILE_TEXT = ['# Lessons', '', '## Lessons', '', '- (none yet)', NOT_A_LESSON, ...VALID, ''].join('\n');

function writeLessons(fx: Fixture): string {
  const file = path.join(fx.tmp, 'docs', 'LESSONS.md');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, FILE_TEXT);
  return file;
}

/** The five directives of acceptance 1 and 2, each with the text its narration holds on main. */
function fiveDirectives(fx: Fixture): { name: string; directive: Directive; onMain: string; kind: Directive['kind'] }[] {
  const out: { name: string; directive: Directive; onMain: string; kind: Directive['kind'] }[] = [];
  const t0 = fx.controller.createGoal({ text: 'Rename one label in the status line', source: 'natural-language', explicitSize: 'T0', affectedSurfaces: [] });
  out.push({ name: 'T0 goal with no card', directive: fx.controller.next(t0.id), onMain: 'no planning funnel', kind: 'plan' });

  const t1 = fx.controller.createGoal({ text: 'Add support for exporting reports as a new feature module', source: 'natural-language', explicitSize: 'T1', affectedSurfaces: [] });
  out.push({ name: 'T1 goal', directive: fx.controller.next(t1.id), onMain: 'no full forge', kind: 'plan' });

  writeCard(fx, { id: 'T0-ONE', title: 'one', allowPaths: ['src/one.ts'] });
  const existing = fx.controller.createGoal({ text: 'do T0-ONE', source: 'card', ref: 'T0-ONE', explicitSize: 'T0', affectedSurfaces: [] }, { cards: ['T0-ONE'] });
  out.push({ name: 'T0 goal for an existing card', directive: fx.controller.next(existing.id), onMain: 'validate the card', kind: 'project-cards' });

  mkdirSync(path.join(fx.tmp, 'plans'), { recursive: true });
  writeFileSync(path.join(fx.tmp, 'plans', 'p.md'), '# Plan\n');
  const produced = fx.controller.report({ goalId: t1.id, generation: 0, result: 'plan-produced', data: { planRef: 'plans/p.md' } });
  out.push({ name: 'T1 goal after plan-produced', directive: produced.directive, onMain: 'No cards registered', kind: 'project-cards' });

  writeCard(fx, { id: 'T1-B', title: 'b', allowPaths: ['src/b.ts'] });
  writeCard(fx, { id: 'T1-C', title: 'c', allowPaths: ['src/c.ts'] });
  const run = goalForCards(fx, ['T1-B', 'T1-C'], { size: 'T1' });
  const revised = fx.controller.report({ goalId: run.id, generation: 0, result: 'revision', data: { text: 'build it again', cards: ['T1-B'] } });
  out.push({ name: 'T1 goal in RUN after a revision naming a registered card', directive: revised.directive, onMain: 'Plan accepted', kind: 'project-cards' });
  return out;
}

function lessonsOf(d: Directive): unknown {
  return (d as { lessons?: unknown }).lessons;
}

test('the plan directive of a T0 goal with no card carries the lessons file, its count and the ten most recent lines', () => {
  const fx = makeFixture();
  try {
    const file = writeLessons(fx);
    const g = fx.controller.createGoal({ text: 'Rename one label in the status line', source: 'natural-language', explicitSize: 'T0', affectedSurfaces: [] });
    const d = fx.controller.next(g.id);
    assert.equal(d.kind, 'plan');
    const lessons = lessonsOf(d) as { file: string; count: number; recent: string[] } | undefined;
    assert.ok(lessons, 'the plan directive has a lessons field');
    assert.equal(lessons.file, file);
    assert.equal(lessons.count, 12);
    assert.deepEqual(lessons.recent, VALID.slice(-10));
  } finally {
    fx.cleanup();
  }
});

test('each of the five plan and project-cards directives carries the same lessons field', () => {
  const fx = makeFixture();
  try {
    const file = writeLessons(fx);
    const expected = { file, count: 12, recent: VALID.slice(2) };
    for (const { name, directive, kind } of fiveDirectives(fx)) {
      assert.equal(directive.kind, kind, name);
      assert.deepEqual(lessonsOf(directive), expected, name);
    }
  } finally {
    fx.cleanup();
  }
});

test('each of the five narrations names the count, the file and registration, keeps its text from main and quotes no lesson', () => {
  const fx = makeFixture();
  try {
    writeLessons(fx);
    for (const { name, directive, onMain } of fiveDirectives(fx)) {
      const n = directive.narration;
      assert.ok(n.includes(onMain), `${name}: ${n}`);
      assert.ok(n.includes('12 lessons so far'), `${name}: ${n}`);
      assert.ok(n.includes('docs/LESSONS.md'), `${name}: ${n}`);
      assert.ok(n.includes('registered'), `${name}: ${n}`);
      assert.ok(n.indexOf(onMain) < n.indexOf('12 lessons so far'), `${name}: the text from main comes first: ${n}`);
      for (const line of VALID) {
        assert.ok(!n.includes(line), `${name}: quotes a lesson line`);
        assert.ok(!n.includes(line.slice(line.indexOf(': ') + 2)), `${name}: quotes a lesson rule`);
      }
      assert.ok(!/rule number/.test(n), `${name}: quotes lesson text`);
    }
  } finally {
    fx.cleanup();
  }
});

test('with no lessons file the plan and project-cards directives carry count 0 and no lines, and say 0 lessons so far', () => {
  const fx = makeFixture();
  try {
    const file = path.join(fx.tmp, 'docs', 'LESSONS.md');
    const t0 = fx.controller.createGoal({ text: 'Rename one label in the status line', source: 'natural-language', explicitSize: 'T0', affectedSurfaces: [] });
    let plan: Directive | undefined;
    assert.doesNotThrow(() => { plan = fx.controller.next(t0.id); });
    assert.equal(plan!.kind, 'plan');
    assert.deepEqual(lessonsOf(plan!), { file, count: 0, recent: [] });
    assert.ok(plan!.narration.includes('0 lessons so far'), plan!.narration);

    writeCard(fx, { id: 'T0-ONE', title: 'one', allowPaths: ['src/one.ts'] });
    const existing = fx.controller.createGoal({ text: 'do T0-ONE', source: 'card', ref: 'T0-ONE', explicitSize: 'T0', affectedSurfaces: [] }, { cards: ['T0-ONE'] });
    let cards: Directive | undefined;
    assert.doesNotThrow(() => { cards = fx.controller.next(existing.id); });
    assert.equal(cards!.kind, 'project-cards');
    assert.deepEqual(lessonsOf(cards!), { file, count: 0, recent: [] });
    assert.ok(cards!.narration.includes('0 lessons so far'), cards!.narration);
  } finally {
    fx.cleanup();
  }
});
