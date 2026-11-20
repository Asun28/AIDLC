// Card T1-TEST-AUDIT-LIST-2: the audit rows live in docs/reliability/test-audit.json; the table of test-audit.md is their rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import { z } from 'zod';

const root = path.resolve(import.meta.dirname, '..', '..');
const START = '<!-- audit-table:start -->';
const END = '<!-- audit-table:end -->';

/** A line terminator: CR, LF, NEL, LS or PS. */
const LINE_BREAK = /[\r\n\u0085\u2028\u2029]/;
/**
 * A cell value: non-empty, on one line, with no whitespace at either end (refused, not trimmed, so the rendering is the value),
 * and no backslash directly before a pipe (a source `\|` would render as `\\|`, an escaped backslash and a cell boundary).
 */
const text = z.string().min(1)
  .refine((s) => !LINE_BREAK.test(s), 'a line terminator')
  .refine((s) => s === s.trim(), 'whitespace at an end')
  .refine((s) => !s.includes('\\|'), 'a backslash before a pipe');
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
    const source = read(r.file);
    if (source === undefined) problems.push(`${r.file}: no such file under tests/`);
    else if (!testNames(source).has(r.test)) problems.push(`${r.file}: no it/test named ${r.test}`);
    if (r.coveredBy === 'none' && r.action !== 'update') problems.push(`${r.test}: remove without a covering test`);
    if (r.coveredBy !== 'none' && !allNames.has(r.coveredBy)) problems.push(`${r.test}: covered by names no test: ${r.coveredBy}`);
  }
  return problems;
}

/** The Markdown table of the rows (R3), a pipe inside a cell written as \|. */
const render = (rows: Row[]) => ['| file | test | class | evidence | covered by | action |', '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((r) => {
    const line = `| ${[r.file, r.test, r.class, r.evidence, r.coveredBy, r.action].map((c) => c.replaceAll('|', '\\|')).join(' | ')} |`;
    if (LINE_BREAK.test(line)) throw new Error(`the row of ${r.test} does not render to one line`);
    return line;
  })].join('\n');

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

/**
 * The absolute path of `file` when it names an existing .ts file inside `<base>/tests`, else undefined. `file` must be relative,
 * use forward slashes and be already normalised (`tests/../tests/x.ts` and `tests/./x.ts` are refused, not normalised), and the
 * file it resolves to, links followed, must lie inside the resolved tests directory (which also refuses a path outside tests/).
 */
function testsPath(base: string, file: string): string | undefined {
  if (file.includes('\\') || path.isAbsolute(file) || path.posix.normalize(file) !== file || !file.endsWith('.ts')) return undefined;
  const abs = path.join(base, file);
  if (!existsSync(abs)) return undefined;
  const rel = path.relative(realpathSync(path.join(base, 'tests')), realpathSync(abs));
  return rel.split(path.sep)[0] !== '..' && !path.isAbsolute(rel) ? abs : undefined;
}
/** A reader of files under `<base>/tests` that answers undefined for any path testsPath refuses. */
const readerOf = (base: string) => (file: string) => { const abs = testsPath(base, file); return abs === undefined ? undefined : readFileSync(abs, 'utf8'); };
const repoRead = readerOf(root);
const filesUnder = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? filesUnder(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
/** The it/test names of every file under `<base>/tests`, each read through testsPath (the coveredBy search). */
const namesUnder = (base: string) => new Set(filesUnder(path.join(base, 'tests')).flatMap((f) => [...testNames(readerOf(base)(path.relative(base, f).split(path.sep).join('/')) ?? '')]));
const allNames = namesUnder(root);
const audit = () => Audit.parse(JSON.parse(readFileSync(path.join(root, 'docs/reliability/test-audit.json'), 'utf8')));

const SRC = [
  "test('it holds', () => {});",
  "// test('in a comment', () => {});",
  "const s = \"test('in a string', () => {})\";",
  "test('outer', async (t) => { await t.test('a subtest', () => {}); });",
  "submit('not a test');",
  'test(`tpl ${x}`, () => {});',
].join('\n');
const row = (over: Partial<Row> = {}): Row => ({ file: 'tests/a.test.ts', test: 'it holds', class: 'duplicate', evidence: 'e', coveredBy: 'it holds', action: 'update', ...over });
const fixture = (rows: Row[]) => rowProblems(rows, (f) => (f === 'tests/a.test.ts' ? SRC : undefined), testNames(SRC));

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
    ['a commit of six hex digits', { ...ok, commit: '1a757a' }],
    ['a commit of 41 hex digits', { ...ok, commit: 'a'.repeat(41) }],
    ['a commit in capitals', { ...ok, commit: '1A757ADB' }],
    ['an LF in a value', { ...ok, rows: [row({ evidence: 'a\nb' })] }],
    ['a CRLF in a value', { ...ok, rows: [row({ evidence: 'a\r\nb' })] }],
    ['a CR in a value', { ...ok, rows: [row({ evidence: 'a\rb' })] }],
    ['a U+2028 in a value', { ...ok, rows: [row({ evidence: 'a\u2028b' })] }],
    ['a U+2029 in a value', { ...ok, rows: [row({ evidence: 'a\u2029b' })] }],
    ['a U+0085 in a value', { ...ok, rows: [row({ evidence: 'a\u0085b' })] }],
    ['leading whitespace', { ...ok, rows: [row({ test: ' it holds' })] }],
    ['trailing whitespace', { ...ok, rows: [row({ coveredBy: 'it holds\t' })] }],
    ['a backslash before a pipe', { ...ok, rows: [row({ evidence: 'a \\| b' })] }],
  ] as const) assert.equal(Audit.safeParse(bad).success, false, why);
  assert.deepEqual(fixture([row()]), []);
  assert.equal(fixture([row({ test: 'in a comment' })]).length, 1, 'a name only in a comment');
  assert.equal(fixture([row({ test: 'in a string' })]).length, 1, 'a name only in a string');
  assert.equal(fixture([row({ file: 'tests/b.test.ts' })]).length, 1, 'a missing file');
  for (const name of ['a subtest', 'not a test', 'tpl ${x}']) assert.equal(fixture([row({ test: name })]).length, 1, `not an it/test name: ${name}`);
  assert.equal(fixture([row({ coveredBy: 'in a string' })]).length, 1, 'a coveredBy naming no test');
  assert.ok(testsPath(root, 'tests/surface/test-audit.test.ts'), 'a file under tests/');
  for (const bad of ['tests/../specs/tasks/T0-AUDIT-BINDING.md', 'tests\\..\\specs\\tasks\\T0-AUDIT-BINDING.md', path.join(root, 'tests', 'surface', 'test-audit.test.ts'),
    '/tests/surface/test-audit.test.ts', 'tests/../tests/surface/test-audit.test.ts', 'tests/./surface/test-audit.test.ts', 'tests/surface/../../src/config.ts', 'package.json', 'src/config.ts', 'tests\\surface\\test-audit.test.ts']) {
    assert.equal(testsPath(root, bad), undefined, `refused: ${bad}`);
  }
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'test-audit-'));
  try {
    mkdirSync(path.join(tmp, 'tests'));
    for (const name of ['tests/x.md', 'tests/x.ts', 'tests/..x.ts', 'outside.ts']) writeFileSync(path.join(tmp, name), 'x');
    assert.ok(testsPath(tmp, 'tests/x.ts'), 'a .ts file inside');
    assert.ok(testsPath(tmp, 'tests/..x.ts'), 'a name that starts with two dots is inside');
    assert.equal(testsPath(tmp, 'tests/x.md'), undefined, 'a file that is not .ts');
    assert.equal(testsPath(tmp, 'tests/missing.ts'), undefined, 'a file that does not exist');
    // Links out of tests/: one to a sibling (relative path starts with ..), one to this file, on another drive when the temporary
    // directory is on one (relative path is absolute on win32). A host that refuses links skips these two.
    for (const [link, target] of [['near.ts', path.join(tmp, 'outside.ts')], ['far.ts', import.meta.filename]] as const) {
      let linked = true;
      try { symlinkSync(target, path.join(tmp, 'tests', link), 'file'); } catch { linked = false; }
      if (linked) assert.equal(testsPath(tmp, `tests/${link}`), undefined, `a link out of tests/: ${link}`);
    }
    writeFileSync(path.join(tmp, 'outside.ts'), "test('outside', () => {});");
    if (existsSync(path.join(tmp, 'tests', 'near.ts'))) assert.equal(namesUnder(tmp).has('outside'), false, 'the coveredBy search reads no linked file outside tests/');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('T1-TEST-AUDIT-LIST-2 acceptance 2: no row proposes remove without a covering test', () => {
  assert.deepEqual(audit().rows.filter((r) => r.coveredBy === 'none' && r.action !== 'update'), []);
  assert.equal(fixture([row({ coveredBy: 'none', action: 'remove' })]).length, 1);
  assert.deepEqual(fixture([row({ coveredBy: 'none' }), row({ action: 'remove' })]), []);
});

test('T1-TEST-AUDIT-LIST-2 acceptance 3: the Markdown table is exactly the rendering of the JSON rows', () => {
  const table = render(audit().rows);
  assert.equal(table.split('\n').length, audit().rows.length + 2, 'one physical line per row of the repository file');
  assert.ok(Audit.safeParse({ commit: 'a'.repeat(40), rows: [row({ evidence: 'a | b, a \\ b, inner  spaces' })] }).success, 'a pipe, a lone backslash and inner spaces are kept');
  assert.throws(() => render([row({ evidence: 'a\nb' })]), /one line/, 'the renderer refuses a row that is not one line');
  assert.deepEqual(tableProblems(readFileSync(path.join(root, 'docs/reliability/test-audit.md'), 'utf8'), table), []);
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
