import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { blockList, flowItems, hasKey, renderFrontMatter, scalar, splitFrontMatter, stripComment } from '../../src/artifacts/frontmatter.ts';

const FM = [
  'id: T1-FOO',
  'status: todo            # todo | in-progress | in-review | merged',
  'allow_paths:            # the paths this card may change',
  '  # A full-line comment inside the list is skipped',
  '  - src/foo.ts',
  '  - src/bar.ts   # trailing comment',
  'depends_on: [T1-A, T1-B]',
  'dod_command: node --test tests/foo.test.ts',
].join('\n');

test('splitFrontMatter tolerates a BOM and separates body', () => {
  const doc = splitFrontMatter(`﻿---\n${FM}\n---\n\n# T1-FOO\nbody`);
  assert.ok(doc);
  assert.equal(doc.frontMatter, FM);
  assert.equal(doc.body.trim(), '# T1-FOO\nbody');
  assert.equal(doc.yaml?.['id'], 'T1-FOO');
});

test('splitFrontMatter returns undefined without a front matter block', () => {
  assert.equal(splitFrontMatter('# no front matter'), undefined);
});

test('scalar strips a trailing comment', () => {
  assert.equal(scalar(FM, 'status'), 'todo');
  assert.equal(scalar(FM, 'dod_command'), 'node --test tests/foo.test.ts');
  assert.equal(scalar(FM, 'missing'), undefined);
  assert.equal(stripComment('value   # comment'), 'value');
});

test('blockList collects indented items, skips comment lines and stops at the next key', () => {
  assert.deepEqual(blockList(FM, 'allow_paths'), ['src/foo.ts', 'src/bar.ts']);
  assert.equal(blockList(FM, 'nope'), undefined);
});

test('blockList does not parse inline flow lists', () => {
  assert.deepEqual(blockList(FM, 'depends_on'), []);
});

test('hasKey detects keys at line start only', () => {
  assert.equal(hasKey(FM, 'dod_command'), true);
  assert.equal(hasKey(FM, 'foo'), false);
});

test('renderFrontMatter round-trips through splitFrontMatter', () => {
  const text = renderFrontMatter({ id: 'T1-FOO', allow_paths: ['src/x.ts'], budget: 400 }, '# T1-FOO\n\nbody\n');
  assert.ok(text.startsWith('---\n'));
  const doc = splitFrontMatter(text);
  assert.ok(doc);
  assert.equal(doc.yaml?.['id'], 'T1-FOO');
  assert.deepEqual(doc.yaml?.['allow_paths'], ['src/x.ts']);
  assert.equal(doc.yaml?.['budget'], 400);
  assert.ok(doc.body.includes('# T1-FOO'));
});

test('stripComment reads a comment as YAML does: a hash inside a quoted scalar is text, a space and a hash start a comment in a plain value (T0-FM-COMMENT-CUT) [R1]', () => {
  const kept: Array<[string, string]> = [
    ['"issue #45 item 2"', 'a double-quoted value'],
    ["'issue #45'", 'a single-quoted value'],
    ['"a \\" quote, then #45"', 'an escaped double quote before the hash'],
    ["'it''s #45'", 'a doubled single quote before the hash'],
    ['["issue #85 item 2", "b"]', 'a double-quoted item of a flow list'],
    ["['a #1', 'b #2']", 'single-quoted items of a flow list'],
    ['[x, "y #3"]', 'a quoted item after a comma'],
    ['{k: "v", w: "z #4"}', 'a quoted value after a comma in a flow mapping'],
    ['[[a, b], "c #7", {d: "e #8"}]', 'quoted scalars after nested flow collections'],
    ['PR#84 merged', 'a hash after a non-blank character'],
    ['docs/plan.md#45-module-design', 'a hash inside a path'],
    ['#45 first', 'a hash at the value start'],
    ['"issue #45', 'an unterminated quoted scalar'],
    ['a\u00a0#45', 'a hash after a non-breaking space'],
  ];
  for (const [value, label] of kept) assert.equal(stripComment(value), value, label);
  const cut: Array<[string, string, string]> = [
    ['"issue #45"   # note', '"issue #45"', 'a comment after the closing double quote'],
    ["'a #1' #2", "'a #1'", 'a comment after the closing single quote'],
    ['"a \\\\" #45', '"a \\\\"', 'an escaped backslash leaves the closing quote a closing quote'],
    ['Each of the six items of issue #45 has a test', 'Each of the six items of issue', 'a plain value'],
    ['value   # comment', 'value', 'a hash-space comment'],
    ["the card's issue #45", "the card's issue", 'an apostrophe inside a plain value opens nothing'],
    ['a "b" c #45', 'a "b" c', 'a quote inside a plain value opens nothing'],
    ['see [x, "y #5"]', 'see [x, "y', 'a bracket inside a plain value opens no flow list'],
    ['see {k, "y #6"}', 'see {k, "y', 'a brace inside a plain value opens no flow mapping'],
    ['[plain #1, "q #2"]', '[plain', 'a plain item of a flow list'],
    ['a\t#tab', 'a', 'a tab before the hash'],
    ['| #97', '|', 'a comment after a block-scalar header'],
    ['--- x #5', '--- x', 'a document marker at the value start is text of the value'],
    ['%50 faster #45', '%50 faster', 'a percent sign at the value start is text of the value'],
  ];
  for (const [value, stripped, label] of cut) assert.equal(stripComment(value), stripped, label);
});

test('flowItems splits a one-line flow list only at a comma outside a quoted item (T0-FM-COMMENT-CUT) [R1]', () => {
  assert.deepEqual(flowItems('[a, b]'), ['a', 'b']);
  assert.deepEqual(flowItems('["see issue, #45", \'a, b #46\', plain]'), ['"see issue, #45"', "'a, b #46'", 'plain'], 'a comma inside a quoted item');
  assert.deepEqual(flowItems('["a \\" , b", \'it\'\'s, ok\', z]'), ['"a \\" , b"', "'it''s, ok'", 'z'], 'an escaped quote before the comma');
  assert.deepEqual(flowItems('[plain, text, with "quotes, inside"]'), ['plain', 'text', 'with "quotes', 'inside"'], 'a quote inside a plain item opens nothing');
  assert.deepEqual(flowItems('[note: a, b]'), ['note: a', 'b'], 'a colon separates no items');
  assert.deepEqual(flowItems('[a:"b, c", d]'), ['a:"b', 'c"', 'd'], 'a colon inside a plain item opens no quote, as YAML reads it (T0-FM-COMMENT-CUT-2)');
  assert.deepEqual(flowItems('[[a, b], {c: d, e: f}, g]'), ['[a, b]', '{c: d, e: f}', 'g'], 'a nested flow collection stays whole (T0-FM-COMMENT-CUT-2)');
  assert.equal(flowItems('a, b'), undefined, 'not a flow list');
});

test('docs/OPERATIONS.md states the comment rule of card front matter (T0-FM-COMMENT-CUT) [R4]', () => {
  const operations = readFileSync(path.join(import.meta.dirname, '..', '..', 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
  const sentences = [
    'Card front matter (card T0-FM-COMMENT-CUT-2, issue 97). The card readers and `aidlc cards validate` read comments as the yaml package\'s lexer reads them: a hash sign after a space or a tab starts a comment, except inside a quoted scalar (`"..."` or `\'...\'`, also as an item of a flow list) or the body of a block scalar (`|` or `>`), where it is text; a hash directly after any other character (`PR#84`, `plan.md#45-x`, a non-breaking space) is text as well, and an inline list splits only at the commas of its top level.',
    '`aidlc cards validate` reports as `[CARD-FM-COMMENT-CUT]` every comment that begins with a hash directly followed by text, which is how an issue or a PR number reads, after value text on a key line (the key read with or without a space after its colon, as the card readers read it) or a list-item line, a block-scalar header line included, giving the key or the list item, the full raw value and the text kept: blocking on a card that is neither `merged` nor superseded, a warning otherwise.',
    'A comment of a hash, a space and text, the form the installed card template uses to annotate its keys, is not reported; write a reference without the hash (`issue 45`), or quote the value.',
  ];
  for (const sentence of sentences) assert.ok(operations.includes(sentence), `docs/OPERATIONS.md states: ${sentence}`);
});
