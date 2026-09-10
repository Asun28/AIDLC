import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntent, renderIntent, sectionMap, slugify, type Intent } from '../../src/artifacts/intent.ts';

const intent: Intent = {
  slug: 'claims-status',
  title: 'Claims status self-service',
  author: 'J. Ortiz',
  status: 'draft',
  createdAt: '2026-09-11T00:00:00.000Z',
  problem: 'Customers phone the contact center for claim status.',
  proposedOutcome: 'Customers see claim status in the portal.',
  affected: 'Claims handlers, portal team, claims-core API.',
  constraints: 'No new PII in portal session.',
  openQuestions: ['Do third-party loss adjusters need access too?'],
  trackerRef: 'JIRA-123',
};

test('renderIntent produces a parseable intent with all sections', () => {
  const text = renderIntent(intent);
  assert.ok(text.includes('# Intent: Claims status self-service'));
  const parsed = parseIntent(text);
  assert.equal(parsed.ok, true, parsed.problems.join('; '));
  assert.equal(parsed.intent?.title, 'Claims status self-service');
  assert.equal(parsed.intent?.slug, 'claims-status');
  assert.equal(parsed.intent?.status, 'draft');
  assert.equal(parsed.intent?.trackerRef, 'JIRA-123');
  assert.deepEqual(parsed.intent?.openQuestions, ['Do third-party loss adjusters need access too?']);
  assert.equal(parsed.intent?.problem, 'Customers phone the contact center for claim status.');
});

test('missing section and placeholder content are reported', () => {
  const text = renderIntent({ ...intent, problem: '' }).replace('## Constraints', '## Limits');
  const parsed = parseIntent(text);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.problems.some((p) => p.includes('missing section "## Constraints"')));
  assert.ok(parsed.problems.some((p) => p.includes('"## Problem" is empty or still a placeholder')));
});

test('bad status and missing front matter are reported', () => {
  const text = renderIntent(intent).replace('status: draft', 'status: maybe');
  const parsed = parseIntent(text);
  assert.ok(parsed.problems.some((p) => p.includes('status must be')));
  assert.equal(parseIntent('# no fm').ok, false);
});

test('sectionMap keys sections by lowercased heading', () => {
  const m = sectionMap('intro\n## A\nfoo\nbar\n## B Two\nbaz\n');
  assert.equal(m.get('a'), 'foo\nbar');
  assert.equal(m.get('b two'), 'baz');
  assert.equal(m.has('intro'), false);
});

test('slugify normalises text', () => {
  assert.equal(slugify('Hello, World! 2026'), 'hello-world-2026');
  assert.equal(slugify('!!!'), 'intent');
});

test('empty open questions render as (none) and parse to []', () => {
  const parsed = parseIntent(renderIntent({ ...intent, openQuestions: [] }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.intent?.openQuestions, []);
});
