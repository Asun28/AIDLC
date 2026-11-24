import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const flat = (text: string) => text.replace(/\s+/g, ' ');
const claude = flat(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'));

const REUSE = '- Before adding a package or writing code, check `package.json` dependencies, Node built-ins, and helpers in `src/` and `tests/` for the needed capability. Read the relevant APIs before choosing reuse or custom code.';
const SCHEMAS = '- Parse persisted records with their zod schemas at the boundary. Core schemas: `src/core/types.ts`; manifest: `src/audit/manifest.ts`.';
const DETAILS = '`docs/ARCHITECTURE.md`, Module map, describes each. Runtime details: state lives under `<main checkout>/.aidlc/`, shared by all worktrees;';
const CLOCK = '`DryRunShipPath`, a fixed clock and a temp `.aidlc`. Some tests read real time to measure or bound a wait, or for a file time.';
/** The words each correction replaces, as CLAUDE.md on main at 41593464 has them. */
const REPLACED = ['Four facts it leaves out', 'nothing in `tests/` calls `Date.now()`', 'Every persisted record has a zod schema in `src/core/types.ts`'];

/** The text of a flattened CLAUDE.md from one of its headings to a later one. */
function section(text: string, from: string, to: string): string {
  const start = text.indexOf(` ## ${from} `);
  const end = text.indexOf(` ## ${to} `);
  return start >= 0 && end > start ? text.slice(start, end) : '';
}
const ARCHITECTURE_END = ' ## Configuration and environment ';
const conventions = (text: string) => section(text, 'Conventions', 'AI-native SDLC (aidlc)');
const architecture = (text: string) => section(text, 'Architecture', 'Configuration and environment');
const holdsRules = (text: string) => conventions(text).includes(`${REUSE} ${SCHEMAS}`);
const holdsCorrections = (text: string) => architecture(text).includes(DETAILS) && architecture(text).includes(CLOCK);
const replaced = (text: string) => REPLACED.filter((words) => text.includes(words));

test('T0-CLAUDE-MD-REUSE acceptance 1: Conventions holds the reuse rule directly before the schema rule, each once in the file [R1] [R4]', () => {
  assert.ok(holdsRules(claude), 'the two bullets, in order, in Conventions');
  assert.equal(claude.split(REUSE).length, 2, 'the reuse rule is in the file once');
  assert.equal(claude.split(SCHEMAS).length, 2, 'the schema rule is in the file once');
  assert.equal(holdsRules(claude.replace(REUSE, '')), false, 'without the reuse rule');
  assert.equal(holdsRules(claude.replace(`${REUSE} ${SCHEMAS}`, `${SCHEMAS} ${REUSE}`)), false, 'with the two in the other order');
  assert.equal(holdsRules(claude.replace(`${REUSE} ${SCHEMAS}`, '').replace(ARCHITECTURE_END, ` ${REUSE} ${SCHEMAS}${ARCHITECTURE_END}`)), false, 'with the two in Architecture');
});

test('T0-CLAUDE-MD-REUSE acceptance 2: Architecture holds the two corrected sentences, each once in the file [R2] [R3]', () => {
  assert.ok(holdsCorrections(claude), 'the Layers paragraph and the paragraph on injected side effects');
  assert.equal(claude.split('Runtime details:').length, 2);
  assert.equal(claude.split('Some tests read real time').length, 2);
  assert.equal(holdsCorrections(claude.replace('Runtime details:', 'Details:')), false, 'without the first');
  assert.equal(holdsCorrections(claude.replace('or for a file time.', '')), false, 'without the end of the second');
});

test('T0-CLAUDE-MD-REUSE acceptance 3: CLAUDE.md holds none of the words the corrections replace, and the check finds each of them in a text that wraps them over lines [R2] [R3] [R4]', () => {
  assert.deepEqual(replaced(claude), []);
  for (const words of REPLACED) assert.deepEqual(replaced(flat(`a\n${words.replace(/ /g, '\n')}\nb`)), [words]);
});
