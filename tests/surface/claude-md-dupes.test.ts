// Card T0-CLAUDE-MD-DUPES, issue 500: CLAUDE.md holds what the code cannot show, without bold emphasis.
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

test('T0-CLAUDE-MD-DUPES acceptance 1: the duplicated lines and the bold are gone, and the lines the code cannot show stay [R1] [R2] [R3] [R4]', () => {
  for (const removed of ['npm run typecheck', 'npm test ', 'npm run test:watch', 'npm run dev']) assert.ok(!starts(removed), `Commands still holds ${removed}`);
  for (const kept of ['npm run check', 'node --test tests/core/router.test.ts', 'node --test --test-name-pattern', 'npm run build', 'node bin/aidlc.js <cmd>', 'npm run bench']) assert.ok(starts(kept), `Commands lost ${kept}`);
  for (const removed of ['erasableSyntaxOnly', 'verbatimModuleSyntax', '`core/` (pure decision engines']) assert.ok(!claude.includes(removed), `CLAUDE.md still names ${removed}`);
  assert.ok(!claude.includes('**'), 'CLAUDE.md holds no bold markup');
  assert.ok(conventions.includes('Relative imports carry an explicit `.ts` extension'), 'Conventions keeps the import extension rule');
});

test('T0-CLAUDE-MD-DUPES acceptance 2: CLAUDE.md is shorter than the 199 lines of main at 5ef3ec3e [R5]', () => {
  const lines = claude.replace(/\n$/, '').split('\n').length;
  assert.ok(lines < 199, `CLAUDE.md is ${lines} lines`);
});
