import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { changelogSince010 } from '../infra/changelog.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const flat = (text: string) => text.replace(/\s+/g, ' ');

/** Anthropic's Claude Code memory documentation targets under 200 lines per CLAUDE.md: longer files use more context and reduce adherence. */
const MAX_LINES = 200;
const LIMIT_SENTENCE = 'This file stays within 200 lines (`tests/surface/claude-md-size.test.ts`): every session loads it, and a longer file costs context and adherence, so detail goes in `docs/`.';
const ADAPTER_CLAUSE = 'every `ShipPath` adapter (`scaffold`, `github`, `dry-run`) prints the same scaffold-style sentinels so `classifyShipOutput` maps outcomes uniformly';
const CHANGELOG_ENTRY = "- T0-CLAUDE-MD-TRIM-2: `CLAUDE.md` goes from 215 lines to 177 and `tests/surface/claude-md-size.test.ts` holds it within 200, the target in Anthropic's Claude Code memory documentation. The removed text is text `docs/` and the skills already state: the per-directory `src/` layer descriptions, the review allowances, and the Lessons, Companion skills and Deadlines bullets. `templates/CLAUDE.aidlc.md` goes from 72 lines to 61, so `aidlc init` writes the shorter section into a repository that has none; a section a repository already has stays as it is.";

/** The lines of a text; a final newline ends the last line and adds none. */
const lineCount = (text: string) => text.replace(/\n$/, '').split('\n').length;

/** Whether the Conventions section of a CLAUDE.md text, whitespace collapsed, holds the limit sentence. */
function holdsLimit(claude: string): boolean {
  const text = flat(claude);
  const from = text.indexOf(' ## Conventions ');
  const to = text.indexOf(' ## AI-native SDLC (aidlc) ');
  return from >= 0 && to > from && text.slice(from, to).includes(LIMIT_SENTENCE);
}

/** Whether the Architecture section of a CLAUDE.md text, whitespace collapsed, holds the adapter clause. */
function holdsAdapters(claude: string): boolean {
  const text = flat(claude);
  const from = text.indexOf(' ## Architecture ');
  const to = text.indexOf(' ## Configuration and environment ');
  return from >= 0 && to > from && text.slice(from, to).includes(ADAPTER_CLAUSE);
}

test('T0-CLAUDE-MD-TRIM-2 acceptance 1: CLAUDE.md holds at most 200 lines, and a text of 201 lines counts as 201 [R1]', () => {
  assert.equal(lineCount('x\n'.repeat(200)), 200);
  assert.equal(lineCount('x\n'.repeat(201)), 201);
  const lines = lineCount(read('CLAUDE.md'));
  assert.ok(lines <= MAX_LINES, `CLAUDE.md is ${lines} lines, over ${MAX_LINES}`);
});

test('T0-CLAUDE-MD-TRIM-2 acceptance 2: the Conventions section states the limit, and removing the sentence fails [R2]', () => {
  const claude = read('CLAUDE.md');
  assert.ok(holdsLimit(claude), 'CLAUDE.md Conventions holds the limit sentence');
  assert.equal(holdsLimit(flat(claude).replace(LIMIT_SENTENCE, '')), false);
});

test('T0-CLAUDE-MD-TRIM-2 acceptance 6: the CHANGELOG Unreleased section carries the entry [R5]', () => {
  const changelog = read('CHANGELOG.md');
  const unreleased = changelogSince010(changelog);
  assert.ok(unreleased.split('\n').includes(CHANGELOG_ENTRY), 'the Unreleased section holds the entry');
});

test('T0-CLAUDE-MD-TRIM-2 acceptance 7: the Architecture section names the three ship path adapters, and removing the clause fails [R6]', () => {
  const claude = read('CLAUDE.md');
  assert.ok(holdsAdapters(claude), 'CLAUDE.md Architecture holds the adapter clause');
  assert.equal(holdsAdapters(flat(claude).replace(ADAPTER_CLAUSE, '')), false);
});
