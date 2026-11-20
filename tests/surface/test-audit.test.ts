// Card T1-TEST-AUDIT-LIST-2: the audit rows live in docs/reliability/test-audit.json; the table of test-audit.md is their rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { z } from 'zod';

const root = path.resolve(import.meta.dirname, '..', '..');
const START = '<!-- audit-table:start -->';
const END = '<!-- audit-table:end -->';

const text = z.string().min(1);
const Row = z.strictObject({
  file: text,
  test: text,
  class: z.enum(['removed-behaviour', 'duplicate', 'removed-path', 'superseded-card']),
  evidence: text,
  coveredBy: text,
  action: z.enum(['update', 'remove']),
});
const Audit = z.strictObject({ commit: z.string().regex(/^[0-9a-f]{7,40}$/), rows: z.array(Row) });
type Row = z.infer<typeof Row>;

/** The names of the `it` and `test` calls of a source, read from its syntax tree: text in comments and strings is not a call. */
function testNames(source: string): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['it', 'test'].includes(node.expression.text)) {
      const first = node.arguments[0];
      if (first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))) names.add(first.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('t.ts', source, ts.ScriptTarget.Latest, true));
  return names;
}

/** The problems of R2; `read` answers a file's text or undefined, `allNames` the test names of every file under tests/. */
function rowProblems(rows: Row[], read: (file: string) => string | undefined, allNames: Set<string>): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    const source = r.file.startsWith('tests/') ? read(r.file) : undefined;
    if (source === undefined) problems.push(`${r.file}: no such file under tests/`);
    else if (!testNames(source).has(r.test)) problems.push(`${r.file}: no it/test named ${r.test}`);
    if (r.coveredBy === 'none' && r.action !== 'update') problems.push(`${r.test}: remove without a covering test`);
    if (r.coveredBy === r.test) problems.push(`${r.test}: a row cannot name its own test as its cover`);
    if (r.coveredBy !== 'none' && !allNames.has(r.coveredBy)) problems.push(`${r.test}: covered by names no test: ${r.coveredBy}`);
  }
  return problems;
}

/** The Markdown table of the rows (R3), a pipe inside a cell written as \|. */
const render = (rows: Row[]) => ['| file | test | class | evidence | covered by | action |', '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => `| ${[r.file, r.test, r.class, r.evidence, r.coveredBy, r.action].map((c) => c.replaceAll('|', '\\|')).join(' | ')} |`)].join('\n');

/** The problems of R3: each marker line once, the start before the end, and exactly the rendering between them, which occurs once. */
function tableProblems(md: string, table: string): string[] {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const at = (m: string) => lines.flatMap((l, i) => (l === m ? [i] : []));
  const [s, e] = [at(START), at(END)];
  if (s.length !== 1 || e.length !== 1) return [`markers: ${s.length} start, ${e.length} end`];
  const problems: string[] = [];
  if (lines.slice(s[0]! + 1, e[0]).join('\n') !== table) problems.push('the lines between the markers are not the rendering');
  if (md.split(table).length !== 2) problems.push('the rendering does not occur exactly once');
  return problems;
}

const repoRead = (file: string) => (existsSync(path.join(root, file)) ? readFileSync(path.join(root, file), 'utf8') : undefined);
const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
const allNames = new Set(filesUnder(path.join(root, 'tests')).flatMap((f) => [...testNames(readFileSync(f, 'utf8'))]));
const audit = () => Audit.parse(JSON.parse(readFileSync(path.join(root, 'docs/reliability/test-audit.json'), 'utf8')));

const SRC = [
  "test('it holds', () => {});",
  "// test('in a comment', () => {});",
  "const s = \"test('in a string', () => {})\";",
  "test('outer', async (t) => { await t.test('a subtest', () => {}); });",
  "submit('not a test');",
  'test(`tpl ${x}`, () => {});',
].join('\n');
const row = (over: Partial<Row> = {}): Row => ({ file: 'tests/a.test.ts', test: 'it holds', class: 'duplicate', evidence: 'e', coveredBy: 'outer', action: 'update', ...over });
const fixture = (rows: Row[]) => rowProblems(rows, (f) => (['tests/a.test.ts', 'other/a.test.ts'].includes(f) ? SRC : undefined), testNames(SRC));

test('T1-TEST-AUDIT-LIST-2 acceptance 1: the JSON rows are valid and each names an existing test with a valid class and action', () => {
  assert.deepEqual(rowProblems(audit().rows, repoRead, allNames), []);
  const ok = { commit: '1a757adb', rows: [row()] };
  assert.equal(Audit.safeParse(ok).success, true);
  for (const [why, bad] of [
    ['an unknown row key', { ...ok, rows: [{ ...row(), note: 'x' }] }],
    ['an unknown top-level key', { ...ok, extra: 1 }],
    ['a missing key', { ...ok, rows: [{ ...row(), coveredBy: undefined }] }],
    ['an empty value', { ...ok, rows: [row({ evidence: '' })] }],
    ['a class outside the set', { ...ok, rows: [{ ...row(), class: 'obsolete' }] }],
    ['an action outside the set', { ...ok, rows: [{ ...row(), action: 'skip' }] }],
    ['a commit that is not a sha', { ...ok, commit: 'main' }],
  ] as const) assert.equal(Audit.safeParse(bad).success, false, why);
  assert.deepEqual(fixture([row()]), []);
  assert.equal(fixture([row({ test: 'in a comment' })]).length, 1, 'a name only in a comment');
  assert.equal(fixture([row({ test: 'in a string' })]).length, 1, 'a name only in a string');
  assert.equal(fixture([row({ file: 'tests/b.test.ts' })]).length, 1, 'a missing file');
  assert.equal(fixture([row({ file: 'other/a.test.ts' })]).length, 1, 'a file outside tests/');
  for (const name of ['a subtest', 'not a test', 'tpl ${x}']) assert.equal(fixture([row({ test: name })]).length, 1, `not an it/test name: ${name}`);
  assert.equal(fixture([row({ coveredBy: 'in a string' })]).length, 1, 'a coveredBy naming no test');
  assert.equal(fixture([row({ coveredBy: 'it holds' })]).length, 1, 'a row naming its own test as its cover');
});

test('T1-TEST-AUDIT-LIST-2 acceptance 2: no row proposes remove without a covering test', () => {
  assert.deepEqual(audit().rows.filter((r) => r.coveredBy === 'none' && r.action !== 'update'), []);
  assert.equal(fixture([row({ coveredBy: 'none', action: 'remove' })]).length, 1);
  assert.deepEqual(fixture([row({ coveredBy: 'none' }), row({ action: 'remove' })]), []);
});

test('T1-TEST-AUDIT-LIST-2 acceptance 3: the Markdown table is exactly the rendering of the JSON rows', () => {
  const table = render(audit().rows);
  assert.deepEqual(tableProblems(repoRead('docs/reliability/test-audit.md')!, table), []);
  const t = render([row({ test: 'a | b' })]);
  assert.ok(t.includes('| a \\| b |'), 'a pipe in a cell is escaped');
  const doc = (body: string) => `intro\n${START}\n${body}\n${END}\nend`;
  assert.deepEqual(tableProblems(doc(t), t), []);
  assert.deepEqual(tableProblems(`a line that mentions ${START} is not a marker\n${doc(t)}`, t), [], 'a marker is a whole line');
  assert.ok(tableProblems(doc(t.replace('duplicate', 'removed-path')), t).includes('the lines between the markers are not the rendering'), 'a changed cell');
  assert.equal(tableProblems(doc(`${t}\n| x | x | x | x | x | x |`), t).length, 1, 'an added row');
  assert.equal(tableProblems(`${START}\n${t}`, t).length, 1, 'a missing end marker');
  assert.equal(tableProblems(`${doc(t)}\n${START}`, t).length, 1, 'a doubled start marker');
  assert.equal(tableProblems(`${doc(t)}\n\n${t}`, t).length, 1, 'the rendering twice');
});
