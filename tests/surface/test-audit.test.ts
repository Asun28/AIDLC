// Card T1-TEST-AUDIT-LIST: docs/reliability/test-audit.md lists the tests that no longer match the code, for the owner to approve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const DOC = 'docs/reliability/test-audit.md';
const HEADER = ['file', 'test', 'class', 'evidence', 'covered by', 'action'];
const CLASSES = ['removed-behaviour', 'duplicate', 'removed-path', 'superseded-card'];
const ACTIONS = ['update', 'remove'];

type Row = Record<(typeof HEADER)[number], string>;

/** The cells of a table line, split at each pipe not escaped by a backslash; an escaped pipe becomes a pipe. */
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

/** The rows of the first table whose header is HEADER in order; undefined when the text holds no such table. */
function auditRows(text: string): Row[] | undefined {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.trim().startsWith('|') && cells(l).join('\n') === HEADER.join('\n'));
  if (at < 0) return undefined;
  const rows: Row[] = [];
  for (const line of lines.slice(at + 2)) {
    if (!line.trim().startsWith('|')) break;
    const c = cells(line);
    rows.push(Object.fromEntries(HEADER.map((h, i) => [h, c[i] ?? ''])) as Row);
  }
  return rows;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `source` holds an `it(` or `test(` call whose first argument is the string literal `name`, in any quote. */
function namesTest(source: string, name: string): boolean {
  return ["'", '"', '`'].some((q) => {
    const literal = q + name.replace(/\\/g, '\\\\').replaceAll(q, `\\${q}`) + q;
    return new RegExp(`(?<![\\w$.])(?:it|test)\\(\\s*${escapeRegex(literal)}`).test(source);
  });
}

/** The problems of each row of R1 and R4; `read` answers a repository file's text or undefined when it does not exist. */
function rowProblems(rows: Row[], read: (file: string) => string | undefined): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    const source = read(r.file);
    if (source === undefined) problems.push(`${r.file}: no such file`);
    else if (!namesTest(source, r.test)) problems.push(`${r.file}: no it/test named ${r.test}`);
    if (!CLASSES.includes(r.class)) problems.push(`${r.test}: class ${r.class}`);
    if (!ACTIONS.includes(r.action)) problems.push(`${r.test}: action ${r.action}`);
    if (r.evidence === '' || r['covered by'] === '') problems.push(`${r.test}: empty evidence or covered by`);
  }
  return problems;
}

/** The rows that propose remove with no covering test (R2). */
const removeWithoutCover = (rows: Row[]) => rows.filter((r) => r['covered by'] === 'none' && r.action !== 'update');

const readRepo = (file: string) => {
  const abs = path.join(root, file);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : undefined;
};

const row = (over: Partial<Row>): Row => ({ file: 'a.test.ts', test: 'it holds', class: 'duplicate', evidence: 'e', 'covered by': 'x', action: 'update', ...over });

test('T1-TEST-AUDIT-LIST acceptance 1: every row names an existing test with a valid class and action', () => {
  const rows = auditRows(readFileSync(path.join(root, DOC), 'utf8'));
  assert.ok(rows, `${DOC} holds a table with the columns ${HEADER.join(', ')}`);
  assert.deepEqual(rowProblems(rows, readRepo), []);
  // The checks refuse what R1 and R4 refuse.
  const src = "test('it holds', () => {});\nit(\"say \\\"hi\\\"\", () => {});\nsubmit('gone');";
  const read = (f: string) => (f === 'a.test.ts' ? src : undefined);
  assert.deepEqual(rowProblems([row({}), row({ test: 'say "hi"' })], read), []);
  assert.equal(rowProblems([row({ file: 'b.test.ts' })], read).length, 1, 'a missing file');
  assert.equal(rowProblems([row({ test: 'it hold' })], read).length, 1, 'a name that is not the whole literal');
  assert.equal(rowProblems([row({ test: 'gone' })], read).length, 1, 'a call that is not it or test');
  assert.equal(rowProblems([row({ class: 'obsolete' })], read).length, 1, 'an unknown class');
  assert.equal(rowProblems([row({ action: 'skip' })], read).length, 1, 'an unknown action');
  assert.equal(rowProblems([row({ evidence: '' })], read).length, 1, 'an empty evidence');
  assert.equal(auditRows('| file | test | class | evidence | action |\n| - |'), undefined, 'a table without the six columns');
  assert.deepEqual(auditRows(`${'| ' + HEADER.join(' | ') + ' |'}\n|---|---|---|---|---|---|\n| f | a \\| b | duplicate | e | none | update |\n\n| x |`)?.map((r) => r.test), ['a | b']);
});

test('T1-TEST-AUDIT-LIST acceptance 2: no row proposes remove without a covering test', () => {
  const rows = auditRows(readFileSync(path.join(root, DOC), 'utf8')) ?? [];
  assert.deepEqual(removeWithoutCover(rows).map((r) => r.test), []);
  assert.deepEqual(removeWithoutCover([row({ 'covered by': 'none', action: 'remove' }), row({ 'covered by': 'none' }), row({ action: 'remove' })]).length, 1);
});
