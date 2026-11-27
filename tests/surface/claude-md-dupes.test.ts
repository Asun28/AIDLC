// Card T0-CLAUDE-MD-DUPES, issue 500: CLAUDE.md holds what the code cannot show, without bold emphasis.
// One test per removed text, so each fails on main for its own removal (lesson of T0-STOP-JOURNAL).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const claude = readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').replace(/\r\n/g, '\n');
/** The lines of the first ```bash block, the Commands block. */
const commands = (claude.split('```bash\n')[1]?.split('```')[0] ?? '').split('\n');
const starts = (prefix: string) => commands.some((line) => line.startsWith(prefix));
const flat = claude.replace(/\s+/g, ' ');
const conventions = flat.slice(flat.indexOf(' ## Conventions '), flat.indexOf(' ## AI-native SDLC (aidlc) '));

for (const removed of ['npm run typecheck', 'npm test', 'npm run test:watch', 'npm run dev']) {
  test(`T0-CLAUDE-MD-DUPES acceptance 1: the Commands block holds no line starting ${removed} [R1]`, () => {
    assert.equal(starts(removed), false);
  });
}

test('T0-CLAUDE-MD-DUPES acceptance 1: the Commands block keeps the lines package.json does not state [R1]', () => {
  for (const kept of ['npm run check', 'node --test tests/core/router.test.ts', 'node --test --test-name-pattern', 'npm run build', 'node bin/aidlc.js <cmd>', 'npm run bench']) assert.ok(starts(kept), `Commands lost ${kept}`);
});

for (const removed of ['erasableSyntaxOnly', 'verbatimModuleSyntax', '`core/` (pure decision engines']) {
  test(`T0-CLAUDE-MD-DUPES acceptance 1: CLAUDE.md does not name ${removed} [R2] [R3]`, () => {
    assert.equal(claude.includes(removed), false);
  });
}

test('T0-CLAUDE-MD-DUPES acceptance 1: CLAUDE.md holds no bold span; the path globs keep their ** (owner amendment of 2026-11-27) [R4]', () => {
  assert.equal(/(^|\s)\*\*\S/m.test(claude), false);
});

test('T0-CLAUDE-MD-DUPES acceptance 1: Conventions keeps the import extension rule [R3]', () => {
  assert.ok(conventions.includes('Relative imports carry an explicit `.ts` extension'));
});

test('T0-CLAUDE-MD-DUPES acceptance 2: CLAUDE.md is shorter than the 199 lines of main at 5ef3ec3e [R5]', () => {
  const lines = claude.replace(/\n$/, '').split('\n').length;
  assert.ok(lines < 199, `CLAUDE.md is ${lines} lines`);
});
