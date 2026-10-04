import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, symlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeFixture, writeCard } from './_harness.ts';
import { loadContextPack } from '../../src/loop/context-pack.ts';

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

test('missing plan files, anchors and lesson files are explicit and outside references are refused', () => {
  const fx = makeFixture();
  const outside = mkdtempSync(path.join(tmpdir(), 'aidlc-pack-outside-'));
  try {
    writeCard(fx, { id: 'T1-PACK', title: 'project context' });
    const card = { ...fx.card('T1-PACK'), plan_ref: 'plans/missing.md#section' };
    assert.deepEqual(JSON.parse(loadContextPack(card, fx.tmp, [])).missingSources, ['plans/missing.md', 'docs/LESSONS.md']);
    assert.deepEqual(JSON.parse(loadContextPack({ ...card, plan_ref: undefined }, fx.tmp, [])).missingSources, ['plan_ref', 'docs/LESSONS.md']);
    mkdirSync(path.join(fx.tmp, 'plans'));
    writeFileSync(path.join(fx.tmp, 'plans/missing.md'), '# Other\nNot the requested section.');
    assert.deepEqual(JSON.parse(loadContextPack(card, fx.tmp, [])).missingSources, ['plans/missing.md#section', 'docs/LESSONS.md']);
    for (const ref of ['../escape.md', path.join(outside, 'secret.md')]) assert.throws(() => loadContextPack({ ...card, plan_ref: ref }, fx.tmp, []), /outside repository/);
    writeFileSync(path.join(outside, 'secret.md'), 'private material');
    symlinkSync(outside, path.join(fx.tmp, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => loadContextPack({ ...card, plan_ref: 'external/secret.md' }, fx.tmp, []), /outside repository/);
    mkdirSync(path.join(fx.tmp, 'docs'));
    symlinkSync(outside, path.join(fx.tmp, 'docs/LESSONS.md'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => loadContextPack(card, fx.tmp, []), /outside repository/);
  } finally { fx.cleanup(); rmSync(outside, { recursive: true, force: true }); }
});

test('plan section extraction ignores headings in fenced code and reports an empty missing anchor', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-PACK', title: 'project context' });
    const card = { ...fx.card('T1-PACK'), plan_ref: 'plan.md#selected' };
    writeFileSync(path.join(fx.tmp, 'plan.md'), '# Plan\n```md\n## Selected\nwrong\n```\n## Selected\nreal\n~~~md\n## Example\n~~~\n## Other\nexcluded');
    assert.equal(JSON.parse(loadContextPack(card, fx.tmp, [])).planSection, '## Selected\nreal\n~~~md\n## Example\n~~~');
    writeFileSync(path.join(fx.tmp, 'plan.md'), '');
    assert.deepEqual(JSON.parse(loadContextPack(card, fx.tmp, [])).missingSources, ['plan.md#selected', 'docs/LESSONS.md']);
  } finally { fx.cleanup(); }
});
