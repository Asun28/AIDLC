import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture } from './_harness.ts';
import { Directive } from '../../src/loop/directive.ts';

const INTENT = [
  '---',
  'slug: claims',
  'title: Claims status self-service',
  'author: J. Ortiz (product)',
  'status: accepted',
  'created: 2026-09-11T00:00:00Z',
  'source: human',
  '---',
  '',
  '# Intent: Claims status self-service',
  '',
  '## Problem',
  'Adjusters phone the desk for claim status every day.',
  '',
  '## Proposed outcome',
  'Policy holders read their claim status in the portal.',
  '',
  '## Affected users and systems',
  'Portal, claims API.',
  '',
  '## Constraints',
  'Claim notes carry PII.',
  '',
  '## Open questions',
  '- Which roles may see claim notes?',
  '- Is the status API contract frozen?',
  '',
].join('\n');

test('R2: the T1 plan directive names grilling and lists the open questions of the intent recorded on the goal', () => {
  const fx = makeFixture();
  try {
    mkdirSync(path.join(fx.tmp, 'intent'), { recursive: true });
    writeFileSync(path.join(fx.tmp, 'intent', 'claims.md'), INTENT);
    const goal = fx.controller.createGoal({ text: 'Add a claims status self-service feature to the portal', source: 'natural-language', affectedSurfaces: [] }, { intentRef: 'intent/claims.md' });
    assert.equal(goal.routing.size, 'T1');
    assert.equal(goal.intentRef, 'intent/claims.md');
    assert.deepEqual(goal.routing.skills, ['grilling', 'tdd']);

    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'plan');
    assert.ok(d.skills.includes('grilling'), `plan directive skills: ${JSON.stringify(d.skills)}`);
    if (d.kind === 'plan') assert.ok(d.inputs.includes('intent/claims.md'), 'the intent path is a plan input');
    assert.match(d.narration, /grilling/);
    assert.match(d.narration, /Which roles may see claim notes\?/);
    assert.match(d.narration, /Is the status API contract frozen\?/);
  } finally {
    fx.cleanup();
  }
});

test('R2: a missing intent file is narrated, never thrown; a T0 route never names grilling; the directive base defaults skills', () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Add a claims status self-service feature to the portal', source: 'natural-language', affectedSurfaces: [] }, { intentRef: 'intent/missing.md' });
    const d = fx.controller.next(goal.id);
    assert.equal(d.kind, 'plan');
    assert.match(d.narration, /intent\/missing\.md/);
    assert.match(d.narration, /not found|missing|unreadable/i);
    assert.ok(d.skills.includes('grilling'));

    const t0 = fx.controller.createGoal({ text: 'Fix a typo in the README', source: 'natural-language', affectedSurfaces: [] });
    assert.equal(t0.routing.size, 'T0');
    assert.deepEqual(t0.routing.skills, ['tdd']);
    const d0 = fx.controller.next(t0.id);
    assert.equal(d0.kind, 'plan');
    assert.ok(!d0.skills.includes('grilling'), 'T0 never grills');

    const parsed = Directive.parse({ ...d0, skills: undefined });
    assert.deepEqual(parsed.skills, [], 'the directive base defaults skills to an empty list');
  } finally {
    fx.cleanup();
  }
});
