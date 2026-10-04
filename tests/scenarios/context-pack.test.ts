import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard } from './_harness.ts';

test('run-card carries the referenced plan section and matching lessons as JSON data', () => {
  const fx = makeFixture();
  try {
    mkdirSync(path.join(fx.tmp, 'plans'));
    mkdirSync(path.join(fx.tmp, 'docs'));
    writeFileSync(path.join(fx.tmp, 'plans/feature.md'), '# Plan\n## Selected section\nImplement carefully.\n### Detail\nKeep this.\n## Other\nExclude this.\n');
    writeFileSync(path.join(fx.tmp, 'docs/LESSONS.md'), '# Lessons\n- src/loop: keep receipts\n- unrelated: exclude this\n');
    writeCard(fx, { id: 'T1-PACK', title: 'project context', planRef: 'plans/feature.md#selected-section', allowPaths: ['src/loop/example.ts'] });
    const goal = fx.controller.createGoal({ text: 'implement T1-PACK', source: 'card', ref: 'T1-PACK', affectedSurfaces: [] }, { cards: ['T1-PACK'] });
    const { directive } = fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-PACK'] } });
    assert.equal(directive.kind, 'run-card');
    if (directive.kind !== 'run-card') throw new Error('expected run-card');
    assert.equal(typeof directive.context.pack, 'string');
    const pack = JSON.parse(directive.context.pack as string);
    assert.equal(pack.planSection, '## Selected section\nImplement carefully.\n### Detail\nKeep this.');
    assert.deepEqual(pack.acceptance, fx.card('T1-PACK').acceptance);
    assert.deepEqual(pack.lessons, ['- src/loop: keep receipts']);
    assert.deepEqual(pack.missingSources, []);
    const again = fx.controller.next(goal.id);
    assert.equal(again.kind === 'run-card' && again.context.pack, directive.context.pack);
  } finally { fx.cleanup(); }
});
