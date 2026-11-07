/**
 * T0-BUDGET-DOC-TRUTH (issue 122): the budget is a merge gate only on the scaffold ship path. The third test reads the
 * github adapter, so a later gate there fails it and the docs move in the same change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
const TEMPLATES = ['specs/tasks/_TEMPLATE.md', 'templates/cards/_TEMPLATE.md'];
const LINE = '# budget: 400          # declared net changed lines (added+deleted); a merge gate only on the scaffold ship path, advisory on github and dry-run';
const SENTENCE = 'The `budget-over` outcome comes only from the `[CARD-BUDGET-OVER]`, `[CARD-BUDGET-UNDECIDABLE]` and `[R3-DIFF-TOO-LARGE]` sentinels the scaffold prints: the `github` and `dry-run` ship paths compare no diff with the card\'s `budget`, so on those paths the budget is advisory and a card can merge over it (card T0-BUDGET-DOC-TRUTH).';

for (const file of TEMPLATES) {
  test(`acceptance 1: ${file} says the budget gates a merge only on the scaffold path [R1]`, () => {
    const lines = read(file).split(/\r?\n/);
    assert.ok(lines.includes(LINE), `${file} holds the corrected budget line`);
    assert.ok(!read(file).includes('once declared it is a merge gate'), `${file} keeps the false claim`);
  });
}

test('acceptance 2: docs/OPERATIONS.md states where budget-over comes from [R2]', () => {
  assert.ok(read('docs/OPERATIONS.md').split(/\r?\n/).includes(SENTENCE));
});

test('acceptance 3: the github adapter prints no budget sentinel, so the sentence of R2 holds [R2]', () => {
  const adapter = read('src/delivery/github-ship.ts');
  for (const sentinel of ['CARD-BUDGET-OVER', 'CARD-BUDGET-UNDECIDABLE', 'R3-DIFF-TOO-LARGE']) assert.ok(!adapter.includes(sentinel), sentinel);
});
