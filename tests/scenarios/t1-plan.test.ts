import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

    mkdirSync(path.join(fx.tmp, 'intent', 'unreadable.md'), { recursive: true });
    const dirGoal = fx.controller.createGoal({ text: 'Add a claims status self-service feature to the portal', source: 'natural-language', affectedSurfaces: [] }, { intentRef: 'intent/unreadable.md' });
    const dd = fx.controller.next(dirGoal.id);
    assert.equal(dd.kind, 'plan');
    assert.ok(dd.narration.includes('intent/unreadable.md'), dd.narration);
    assert.match(dd.narration, /unreadable/);

    writeFileSync(path.join(fx.tmp, 'intent', 'bare.md'), ['# Intent', '', '## Open questions', '- Which roles may see claim notes?', ''].join('\n'));
    const bareGoal = fx.controller.createGoal({ text: 'Add a claims status self-service feature to the portal', source: 'natural-language', affectedSurfaces: [] }, { intentRef: 'intent/bare.md' });
    const db = fx.controller.next(bareGoal.id);
    assert.equal(db.kind, 'plan');
    assert.ok(db.narration.includes('does not validate'), db.narration);
    assert.ok(db.narration.includes('missing front matter'), db.narration);
    assert.ok(!db.narration.includes('no open questions'), 'validation failure is never read as an empty question list');

    writeFileSync(path.join(fx.tmp, 'intent', 'partial.md'), INTENT.replace('## Constraints\nClaim notes carry PII.\n\n', '').replace('- Which roles may see claim notes?\n- Is the status API contract frozen?', '- (none)'));
    const partialGoal = fx.controller.createGoal({ text: 'Add a claims status self-service feature to the portal', source: 'natural-language', affectedSurfaces: [] }, { intentRef: 'intent/partial.md' });
    const dp = fx.controller.next(partialGoal.id);
    assert.ok(dp.narration.includes('does not validate'), `a parsed intent with problems is a validation failure: ${dp.narration}`);
    assert.ok(dp.narration.includes('Constraints'), dp.narration);
    assert.ok(!dp.narration.includes('no open questions'), 'never read as an empty question list');

    writeFileSync(path.join(fx.tmp, 'intent', 'leaky.md'), ['---', 'slug: leaky', 'title: [unterminated', 'api_key: CANARY-hunter2-SECRET', '---', '# Intent: leaky', '## Problem', 'x', '## Proposed outcome', 'y', '## Affected users and systems', 'z', '## Constraints', 'w', '## Open questions', '- (none)', ''].join('\n'));
    const leakyGoal = fx.controller.createGoal({ text: 'Add a claims status self-service feature to the portal', source: 'natural-language', affectedSurfaces: [] }, { intentRef: 'intent/leaky.md' });
    const dl = fx.controller.next(leakyGoal.id);
    assert.ok(dl.narration.includes('does not validate'), dl.narration);
    assert.ok(!dl.narration.includes('CANARY'), `front-matter values never reach the narration: ${dl.narration}`);
    assert.ok(!dl.narration.includes('hunter2'), dl.narration);

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

test('R2: aidlc goal new --intent records the intent on the goal and the printed plan directive lists its open questions', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'aidlc-cli-'));
  try {
    mkdirSync(path.join(tmp, 'intent'), { recursive: true });
    writeFileSync(path.join(tmp, 'intent', 'claims.md'), INTENT);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const bin = path.join(root, 'bin', 'aidlc.js');
    const env = { ...process.env, AIDLC_STATE_DIR: path.join(tmp, 'state') };
    const created = spawnSync(process.execPath, [bin, 'goal', 'new', 'Add a claims status self-service feature to the portal', '--intent', 'intent/claims.md', '--json'], { cwd: tmp, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(created.status, 0, created.stderr);
    const out = JSON.parse(created.stdout) as { goal: string; routing: { skills: string[] }; directive: { kind: string; skills: string[]; narration: string; inputs?: string[] } };
    assert.ok(out.routing.skills.includes('grilling'));
    assert.equal(out.directive.kind, 'plan');
    assert.ok(out.directive.skills.includes('grilling'));
    assert.ok(out.directive.inputs?.includes('intent/claims.md'));
    assert.ok(out.directive.narration.includes('Which roles may see claim notes?'), out.directive.narration);
    const status = spawnSync(process.execPath, [bin, 'goal', 'status', out.goal, '--json'], { cwd: tmp, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(status.status, 0, status.stderr);
    const record = JSON.parse(status.stdout) as { intentRef?: string; goal?: { intentRef?: string } };
    assert.equal(record.intentRef ?? record.goal?.intentRef, 'intent/claims.md');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('acceptance 5: the documentation statements the card requires are present', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const architecture = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8');
  assert.ok(architecture.includes('`skills`'), 'the directive contract names skills');
  assert.ok(architecture.includes('merge-failed'), 'the ship outcome map lists merge-failed');
  const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
  assert.ok(operations.includes('--intent'), 'OPERATIONS documents goal new --intent');
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes('T1-LOOP-SKILLS'), 'CHANGELOG carries the entry');
});
