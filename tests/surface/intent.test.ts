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

const withQuestions = (section: string) => parseIntent(renderIntent({ ...intent, openQuestions: ['SECTION'] }).replace('- SECTION', () => section)).intent!.openQuestions;

test('T0-SMALL-ISSUES-410-411-465 acceptance 4: one open question per list item or paragraph, a wrapped line joined with one space, and parse then render keeps the list [R4]', () => {
  const rows: Array<[string, string[]]> = [
    ['- one?\n- two, wrapped\n  over two\n  lines?\n- three?', ['one?', 'two, wrapped over two lines?', 'three?']],
    ['- one\nunindented?', ['one unindented?']],
    ['- one\r\n  wrapped?\r\n- two?', ['one wrapped?', 'two?']],
    ['* one?\n+ two?\n1. three?\n2) four\n   wrapped?', ['one?', 'two?', 'three?', 'four wrapped?']],
    ['- one?\n  - nested?', ['one?', 'nested?']],
    ['- one\n  --flag wrapped?', ['one --flag wrapped?']],
    ['- one?\n\n  a paragraph after a blank line?', ['one?', 'a paragraph after a blank line?']],
    ['one paragraph\nover two lines?\n\na second?', ['one paragraph over two lines?', 'a second?']],
    ['- one?\n-\n- two?', ['one?', 'two?']],
  ];
  for (const [section, questions] of rows) {
    const parsed = withQuestions(section);
    assert.deepEqual(parsed, questions, section);
    assert.deepEqual(parseIntent(renderIntent({ ...intent, openQuestions: parsed })).intent?.openQuestions, questions, section);
  }
});

test('T0-SMALL-ISSUES-410-411-465 acceptance 5: an item that is (none), or (none followed by a colon or a semicolon and a text with no parenthesis inside, is no question; every other text that begins with (none is one [R5]', () => {
  for (const note of ['(none)', '- (none)', '(none; settled by the owner decisions above)', '- (none: the engineer chose medium,\n  raised dynamically)']) assert.deepEqual(withQuestions(note), [], note);
  for (const question of ['(none of the vendors answered; whom do we ask?)', '(none: settled) except which region?', '(none: x) and who pays (the owner?)', '(nonessential)', 'none']) assert.deepEqual(withQuestions(`- ${question}`), [question], question);
});
