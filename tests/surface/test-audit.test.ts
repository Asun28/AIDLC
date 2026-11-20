// Card T1-TEST-AUDIT-LIST: docs/reliability/test-audit.md lists the tests that no longer match the code, for the owner to approve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..', '..');
const DOC = 'docs/reliability/test-audit.md';
const HEADER = ['file', 'test', 'class', 'evidence', 'covered by', 'action'] as const;
const CLASSES = ['removed-behaviour', 'duplicate', 'removed-path', 'superseded-card'];
const ACTIONS = ['update', 'remove'];

type Row = { [K in (typeof HEADER)[number]]: string };

/** The cells of a table line, split at each pipe not escaped by a backslash; an escaped pipe becomes a pipe. */
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));

/** Whether a line is the Markdown separator of a six-column table: six cells of dashes with optional alignment colons. */
const isSeparator = (line: string | undefined) => line !== undefined && line.trim().startsWith('|') && cells(line).length === HEADER.length && cells(line).every((c) => /^:?-+:?$/.test(c));

/**
 * The rows of the first table whose header is HEADER in order and is followed by a separator; undefined when the text holds no
 * such table. As in Markdown, every line after the separator up to the first blank line is a row of the table. This checker
 * accepts only rows that start with a pipe and hold six cells: any other line before the first blank line refuses the whole
 * table, so a row Markdown renders is never left unchecked.
 */
function auditRows(text: string): Row[] | undefined {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const at = lines.findIndex((l) => l.trim().startsWith('|') && cells(l).join('\n') === HEADER.join('\n'));
  if (at < 0 || !isSeparator(lines[at + 1])) return undefined;
  const rows: Row[] = [];
  for (const line of lines.slice(at + 2)) {
    if (line.trim() === '') break;
    const c = cells(line);
    if (!line.trim().startsWith('|') || c.length !== HEADER.length) return undefined;
    rows.push(Object.fromEntries(HEADER.map((h, i) => [h, c[i] ?? ''])) as Row);
  }
  return rows;
}

/** Whether `source` holds a call of `it` or `test` whose first argument is a string literal with the value `name`; text in comments and strings is not a call. */
function namesTest(source: string, name: string): boolean {
  const visit = (node: ts.Node): boolean => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['it', 'test'].includes(node.expression.text)) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && first.text === name) return true;
    }
    return ts.forEachChild(node, visit) ?? false;
  };
  return visit(ts.createSourceFile('t.ts', source, ts.ScriptTarget.Latest, true));
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
    // Only the exact value none means uncovered; any other cell that starts with the word none (none: why, None) is refused as ambiguous.
    if (/^none\b/i.test(r['covered by']) && r['covered by'] !== 'none') problems.push(`${r.test}: covered by is not exactly none`);
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
  const src = [
    "test('it holds', () => {});",
    'it("say \\"hi\\"", () => {});',
    "submit('gone');",
    "// test('in a comment', () => {});",
    "const text = \"test('in a string', () => {})\";",
    "test('outer', async (t) => { await t.test('a subtest', () => {}); });",
  ].join('\n');
  const read = (f: string) => (f === 'a.test.ts' ? src : undefined);
  assert.deepEqual(rowProblems([row({}), row({ test: 'say "hi"' })], read), []);
  assert.equal(rowProblems([row({ file: 'b.test.ts' })], read).length, 1, 'a missing file');
  assert.equal(rowProblems([row({ test: 'it hold' })], read).length, 1, 'a name that is not the whole literal');
  assert.equal(rowProblems([row({ test: 'gone' })], read).length, 1, 'a call that is not it or test');
  assert.equal(rowProblems([row({ test: 'in a comment' })], read).length, 1, 'a call inside a comment');
  assert.equal(rowProblems([row({ test: 'in a string' })], read).length, 1, 'a call inside a string');
  assert.equal(rowProblems([row({ test: 'a subtest' })], read).length, 1, 'a t.test subtest is not an it or test call');
  assert.equal(rowProblems([row({ file: 'tests/surface/test-audit.test.ts' })], readRepo).length, 1, 'fixture text of this file is not a test name');
  assert.equal(rowProblems([row({ 'covered by': 'none: no other test' })], read).length, 1, 'a covered by that starts with none');
  assert.equal(rowProblems([row({ 'covered by': 'None' })], read).length, 1, 'a covered by of another letter case');
  assert.deepEqual(rowProblems([row({ 'covered by': 'nonexistent-path test' })], read), [], 'a word that only starts with the letters none');
  assert.equal(rowProblems([row({ class: 'obsolete' })], read).length, 1, 'an unknown class');
  assert.equal(rowProblems([row({ action: 'skip' })], read).length, 1, 'an unknown action');
  assert.equal(rowProblems([row({ evidence: '' })], read).length, 1, 'an empty evidence');
  assert.equal(rowProblems([row({ 'covered by': '' })], read).length, 1, 'an empty covered by');
  assert.equal(auditRows('| file | test | class | evidence | action |\n| - |'), undefined, 'a table without the six columns');
  const head = `| ${HEADER.join(' | ')} |`;
  assert.equal(auditRows(`${head}\n| f | a | duplicate | e | none | update |`), undefined, 'a header without its separator');
  assert.equal(auditRows(`${head}\n|---|---|---|---|---|\n| f | a | duplicate | e | none | update |`), undefined, 'a separator of five cells');
  assert.equal(auditRows(`${head}\n|---|---|---|---|---|x|`), undefined, 'a separator cell that is not dashes');
  assert.equal(auditRows(`${head}\n---|---|---|---|---|---\n| f | a | duplicate | e | none | update |`), undefined, 'a separator without the leading pipe the rows need');
  assert.equal(auditRows('| a | b | c | d | e | f |\n|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 |'), undefined, 'another six-column table');
  assert.deepEqual(auditRows(`${head}\n| :--- | --- | ---: | :-: | - | --- |`), [], 'alignment colons');
  assert.deepEqual(auditRows(`${head}\n|---|---|---|---|---|---|\n| f | a \\| b | duplicate | e | none | update |\n\n| x |`)?.map((r) => r.test), ['a | b']);
  // Every line up to the first blank line is a row: one without an initial pipe, or without six cells, refuses the table (R3 decision 2).
  const bare = 'missing.test.ts | nonexistent | invalid | e | none | remove';
  const sep = '|---|---|---|---|---|---|';
  assert.equal(auditRows(`${head}\n${sep}\n${bare}`), undefined, 'a row without an initial pipe right after the separator');
  assert.equal(auditRows(`${head}\n${sep}\n| f | a | duplicate | e | none | update |\n${bare}`), undefined, 'a row without an initial pipe after a piped row');
  assert.equal(auditRows(`${head}\n${sep}\n| f | a | duplicate | e | none |`), undefined, 'a row of five cells');
  assert.equal(auditRows(`${head}\n${sep}\n| f | a | duplicate | e | none | update | x |`), undefined, 'a row of seven cells');
  assert.deepEqual(auditRows(`${head}\n${sep}\n| f | a | duplicate | e | none | update |\n   \nprose after a blank line`)?.length, 1, 'a whitespace-only line ends the table');
});

test('T1-TEST-AUDIT-LIST acceptance 2: no row proposes remove without a covering test', () => {
  const rows = auditRows(readFileSync(path.join(root, DOC), 'utf8'));
  assert.ok(rows, `${DOC} holds a table with the columns ${HEADER.join(', ')}`);
  assert.deepEqual(removeWithoutCover(rows).map((r) => r.test), []);
  assert.deepEqual(removeWithoutCover([row({ 'covered by': 'none', action: 'remove' }), row({ 'covered by': 'none' }), row({ action: 'remove' })]).length, 1);
});
