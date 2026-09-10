import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blockList, hasKey, renderFrontMatter, scalar, splitFrontMatter, stripComment } from '../../src/artifacts/frontmatter.ts';

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
