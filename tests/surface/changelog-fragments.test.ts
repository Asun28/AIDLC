// Card T1-CHANGELOG-FRAGMENTS: every file in changelog.d is the README or one entry line of a registered card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadCardRegistry } from '../../src/artifacts/card.ts';
import { fragmentEntry, fragmentProblems } from '../infra/changelog.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const DIR = path.join(root, 'changelog.d');

const ENTRY =
  "- T1-CHANGELOG-FRAGMENTS: a card records its behaviour change in its own new file `changelog.d/<card id>.md` and leaves `CHANGELOG.md` as it is, so two cards that run at the same time and both write fragments change no file in common for their entries. The file holds one line ended by one line feed, `- <card id>: <text>` or `- <card id> (<qualifier>): <text>`, and its name is the id of a card in `specs/tasks/` or `specs/archive/tasks/`; `tests/surface/changelog-fragments.test.ts` refuses any other file in `changelog.d/` except its README. The changes not yet released are the Unreleased section of `CHANGELOG.md` and the files in `changelog.d/`; `CLAUDE.md` (Conventions) states the rule and `changelog.d/README.md` the form. The base-sync merge of `CHANGELOG.md` entries (card T0-BASE-SYNC-CHANGELOG-2) is unchanged for the cards that still add an entry there.";

test('T1-CHANGELOG-FRAGMENTS acceptance 1 - every file in changelog.d is the README or a well-formed fragment of a registered card', () => {
  const registry = loadCardRegistry(path.join(root, 'specs', 'tasks'), path.join(root, 'specs', 'archive', 'tasks'));
  const cardIds: ReadonlySet<string> = new Set(registry.cards.map((c) => c.card.id));
  const names = readdirSync(DIR).sort();
  assert.ok(names.includes('README.md'), `changelog.d holds ${names.join(', ')}`);
  assert.ok(names.includes('T1-CHANGELOG-FRAGMENTS.md'), `changelog.d holds ${names.join(', ')}`);
  const problems = names
    .filter((name) => name !== 'README.md')
    .flatMap((name) => fragmentProblems(name, readFileSync(path.join(DIR, name), 'utf8'), cardIds));
  assert.deepEqual(problems, []);
});

test('T1-CHANGELOG-FRAGMENTS acceptance 2 - fragmentProblems refuses each malformed name and text and passes the two entry forms', () => {
  const ids: ReadonlySet<string> = new Set(['T1-X', 'T0-Y']);
  const oneLine = 'T1-X.md: the text is not one line ended by one line feed';
  const start = 'T1-X.md: the line does not start with "- T1-X: " or "- T1-X (<qualifier>): "';
  const good = '- T1-X: a change.\n';

  for (const text of [good, '- T1-X (bugfix, issue 1): a change.\n']) {
    assert.deepEqual(fragmentProblems('T1-X.md', text, ids), [], JSON.stringify(text));
  }
  for (const text of ['', '- T1-X: a change.', '- T1-X: a change.\r\n', '- T1-X: a.\n\n- T1-X: b.\n', '- T1-X: a change.\n\n']) {
    assert.deepEqual(fragmentProblems('T1-X.md', text, ids), [oneLine], JSON.stringify(text));
  }
  for (const text of ['\n', '- T0-Y: a change.\n', 'T1-X: a change.\n', '* T1-X: a change.\n', '- T1-X a change.\n', '- T1-X: \n', `﻿${good}`]) {
    assert.deepEqual(fragmentProblems('T1-X.md', text, ids), [start], JSON.stringify(text));
  }
  for (const name of ['t1-x.md', 'T1-X.txt', 'T1_X.md', 'notes.md']) {
    assert.deepEqual(fragmentProblems(name, good, ids), [`${name}: the file name is not <card id>.md`], name);
  }
  assert.deepEqual(fragmentProblems('T9-NONE.md', '- T9-NONE: a change.\n', ids), [
    'T9-NONE.md: no card T9-NONE in specs/tasks or specs/archive/tasks',
  ]);
});

test('T1-CHANGELOG-FRAGMENTS acceptance 2 - fragmentProblems refuses a nested or empty qualifier and blank text, and reports a text problem after the registry problem', () => {
  const ids: ReadonlySet<string> = new Set(['T1-X', 'T0-Y']);
  const start = 'T1-X.md: the line does not start with "- T1-X: " or "- T1-X (<qualifier>): "';
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X (a (b)): a change.\n', ids), [start], 'nested qualifier');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X (): a change.\n', ids), [start], 'empty qualifier');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X:   \n', ids), [start], 'blank text');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X (a (b): a change.\n', ids), [start], 'opening parenthesis in the qualifier');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X (a) b): a change.\n', ids), [start], 'closing parenthesis in the qualifier');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X (a: a change.\n', ids), [start], 'qualifier without its closing parenthesis');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X a): a change.\n', ids), [start], 'qualifier without its opening parenthesis');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X(a): a change.\n', ids), [start], 'no space before the qualifier');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X (a) (b): a change.\n', ids), [start], 'two qualifiers');
  assert.deepEqual(fragmentProblems('T1-X.md', '- T1-X:a change.\n', ids), [start], 'no space after the colon');
  assert.deepEqual(fragmentProblems('T1-X.md', ' T1-X: a change.\n', ids), [start], 'no hyphen before the id');
  assert.deepEqual(fragmentProblems('T1-X_md', '- T1-X: a change.\n', ids), ['T1-X_md: the file name is not <card id>.md'], 'no .md extension');
  const registry = 'T9-NONE.md: no card T9-NONE in specs/tasks or specs/archive/tasks';
  assert.deepEqual(fragmentProblems('T9-NONE.md', '- T9-NONE: a change.', ids), [
    registry,
    'T9-NONE.md: the text is not one line ended by one line feed',
  ]);
  assert.deepEqual(fragmentProblems('T9-NONE.md', '- T9-NONE: a.\n- T9-NONE: b.\n', ids), [
    registry,
    'T9-NONE.md: the text is not one line ended by one line feed',
  ]);
  assert.deepEqual(fragmentProblems('T9-NONE.md', '* T9-NONE: a change.\n', ids), [
    registry,
    'T9-NONE.md: the line does not start with "- T9-NONE: " or "- T9-NONE (<qualifier>): "',
  ]);
});

test('T1-CHANGELOG-FRAGMENTS acceptance 3 - the fragment of this card holds its entry', () => {
  assert.equal(fragmentEntry(root, 'T1-CHANGELOG-FRAGMENTS'), ENTRY);
});
