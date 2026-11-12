// Card T0-TEST-TEMP-SWEEP: no test creates a temporary directory outside a helper that registers its removal.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { cleanup, tmpDir } from '../infra/helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
/** The three names of R2, built from parts so that this file holds no occurrence of them. */
const BASE = ['mk', 'dtemp'].join('');
const NAMES = new Set([`${BASE}Sync`, BASE, `${BASE}DisposableSync`]);
/** The four helpers of R2 (file relative to the root, top-level function): each records its directory at creation. */
const ALLOWED = new Set(['tests/infra/helpers.ts#tmpDir', 'tests/surface/evals.test.ts#tempDir', 'tests/surface/command-lines.test.ts#tempDir', 'tests/surface/eval-test-temp.test.ts#inTemp']);
const HELPER_FILES = new Set([...ALLOWED].map((a) => a.slice(0, a.indexOf('#'))));

interface Site { file: string; line: number; fn: string; kind: 'call' | 'reference'; name: string }
const show = (s: Site): string => `${s.file}:${s.line} [${s.fn}] ${s.kind} of ${s.name}`;

const isFunctionLike = (node: ts.Node): node is ts.SignatureDeclaration =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node);

/** The name a report gives a function: its name, `<constant> (immediately invoked)`, else `<anonymous>`. */
function functionName(fn: ts.SignatureDeclaration): string {
  if (fn.name && (ts.isIdentifier(fn.name) || ts.isStringLiteral(fn.name))) return fn.name.text;
  // The parentheses an arrow function needs to be called are not a wrapper; anything else between it and the call is.
  const callee = ts.isParenthesizedExpression(fn.parent) ? fn.parent : fn;
  const call = callee.parent;
  if (ts.isCallExpression(call) && call.expression === callee) {
    const decl = call.parent;
    if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name) && (decl.parent.flags & ts.NodeFlags.Const) !== 0) return `${decl.name.text} (immediately invoked)`;
    return '<anonymous>';
  }
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && ts.isIdentifier(parent.name)) return parent.name.text;
  return '<anonymous>';
}

/** Every occurrence of one of the three names in `text`: an identifier in any position, or a string or substitution-free template literal equal to the name; nothing is resolved. */
function scanSource(file: string, text: string): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    // `text` holds an identifier or a literal after its escapes are decoded.
    const name = (ts.isIdentifier(node) || literal) && NAMES.has(node.text) ? node.text : undefined;
    if (name !== undefined) {
      // The name of a function lies in the scope around it.
      let fn: ts.Node | undefined = isFunctionLike(node.parent) && node.parent.name === node ? node.parent.parent : node.parent;
      while (fn && !isFunctionLike(fn)) fn = fn.parent;
      const inHelper = fn !== undefined && ts.isFunctionDeclaration(fn) && fn.parent === sf && ALLOWED.has(`${file}#${fn.name?.text}`);
      const helperImport = HELPER_FILES.has(file) && ts.isImportSpecifier(node.parent) && node.parent.parent.parent.parent.parent === sf;
      if (!inHelper && !helperImport) {
        const access = (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) || (ts.isElementAccessExpression(node.parent) && node.parent.argumentExpression === node) ? node.parent : node;
        const called = ts.isCallExpression(access.parent) && access.parent.expression === access;
        // Lines counted by LF, as git grep and editors count them; the compiler also breaks lines at U+2028 and U+2029.
        const line = text.slice(0, node.getStart(sf)).split('\n').length;
        sites.push({ file, line, fn: fn ? functionName(fn as ts.SignatureDeclaration) : 'module scope', kind: called ? 'call' : 'reference', name });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

/** Scans every `.ts` file under `<root>/tests`, in path order. */
function scanTests(root: string): Site[] {
  const files = (readdirSync(path.join(root, 'tests'), { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `tests/${f.split(path.sep).join('/')}`)
    .sort();
  return files.flatMap((file) => scanSource(file, readFileSync(path.join(root, file), 'utf8')));
}

test('T0-TEST-TEMP-SWEEP acceptance 1: no mkdtemp call of tests/ lies outside a helper that registers its removal [R1] [R2]', () => {
  const sites = scanTests(ROOT);
  assert.deepEqual(sites.map(show), [], `${sites.length} sites outside the four helpers:\n${sites.map(show).join('\n')}`);
});

const scanRoot = tmpDir('aidlc-test-temp-');
after(() => cleanup(scanRoot));

test('T0-TEST-TEMP-SWEEP acceptance 2: the scan reports every occurrence of the three names [R2]', () => {
  // The three names, built from parts: this file holds no occurrence of them (the last row checks it).
  const base = ['mk', 'dtemp'].join('');
  const sync = `${base}Sync`;
  const disposable = `${base}DisposableSync`;
  const own = readFileSync(path.join(ROOT, 'tests', 'surface', 'test-temp.test.ts'), 'utf8');
  type Row = [file: string, text: string, expected: Array<[line: number, fn: string, kind: Site['kind'], name: string]>];
  const rows: Row[] = [
    ['tests/forms/named.ts', "import { mkdtempSync } from 'node:fs';\nfunction named() {\n  return mkdtempSync('x');\n}\n", [[1, 'module scope', 'reference', sync], [3, 'named', 'call', sync]]],
    ['tests/forms/aliased.ts', "import { mkdtempSync as make } from 'fs';\nconst aliased = () => make('x');\n", [[1, 'module scope', 'reference', sync]]],
    ['tests/forms/namespace.ts', "import * as fs from 'node:fs';\nfs.mkdtempSync('x');\n", [[2, 'module scope', 'call', sync]]],
    ['tests/forms/default.ts', "import fs from 'fs';\ntest('t', () => {\n  fs.mkdtempSync('x');\n});\n", [[3, '<anonymous>', 'call', sync]]],
    ['tests/forms/require.ts', "const dir = require('node:fs').mkdtempSync('x');\n", [[1, 'module scope', 'call', sync]]],
    ['tests/forms/promises.ts', "import fs from 'node:fs';\nasync function viaPromises() {\n  await fs.promises.mkdtemp('x');\n}\n", [[3, 'viaPromises', 'call', base]]],
    ['tests/forms/fs-promises.ts', "import { mkdtemp } from 'node:fs/promises';\nawait mkdtemp('x');\n", [[1, 'module scope', 'reference', base], [2, 'module scope', 'call', base]]],
    ['tests/forms/destructure.ts', "import fs from 'node:fs';\nconst { mkdtempSync } = fs;\nmkdtempSync('x');\n", [[2, 'module scope', 'reference', sync], [3, 'module scope', 'call', sync]]],
    ['tests/forms/destructure-rename.ts', "import * as fs from 'fs';\nconst { mkdtempSync: m } = fs;\nfunction renamed() { return m('x'); }\n", [[2, 'module scope', 'reference', sync]]],
    ['tests/forms/element.ts', "import fs from 'fs';\nfs['mkdtempSync']('x');\nfs[`mkdtempSync`]('y');\n", [[2, 'module scope', 'call', sync], [3, 'module scope', 'call', sync]]],
    ['tests/forms/disposable.ts', "import { mkdtempDisposableSync } from 'node:fs';\nconst d = mkdtempDisposableSync('x');\n", [[1, 'module scope', 'reference', disposable], [2, 'module scope', 'call', disposable]]],
    ['tests/forms/reference.ts', "import { mkdtempSync } from 'node:fs';\nconst make = mkdtempSync;\nmake('x');\n", [[1, 'module scope', 'reference', sync], [2, 'module scope', 'reference', sync]]],
    ['tests/forms/wrappers.ts', "import fs from 'node:fs';\nfs!.mkdtempSync('a');\n(fs as any).mkdtempSync('b');\n(require)('node:fs').mkdtempSync('c');\n(await (import('node:fs'))).mkdtempSync('d');\n", [[2, 'module scope', 'call', sync], [3, 'module scope', 'call', sync], [4, 'module scope', 'call', sync], [5, 'module scope', 'call', sync]]],
    ['tests/forms/escape.ts', "const \\u006DkdtempSync = 1;\nconst s = '\\u006DkdtempSync';\n", [[1, 'module scope', 'reference', sync], [2, 'module scope', 'reference', sync]]],
    ['tests/forms/local.ts', "function mkdtempSync(p: string) { return p; }\nmkdtempSync('x');\n", [[1, 'module scope', 'reference', sync], [2, 'module scope', 'call', sync]]],
    ['tests/forms/members.ts', "interface Tools {\n  mkdtempSync(p: string): string;\n}\nconst tools = { mkdtempSync: (p: string) => p };\n", [[2, 'module scope', 'reference', sync], [4, 'module scope', 'reference', sync]]],
    ['tests/forms/type-query.ts', "import type { mkdtempSync } from 'node:fs';\ntype F = typeof mkdtempSync;\n", [[1, 'module scope', 'reference', sync], [2, 'module scope', 'reference', sync]]],
    ['tests/infra/helpers.ts', "import { mkdtempSync } from 'node:fs';\nexport function tmpDir(prefix: string): string {\n  const dir = mkdtempSync(prefix);\n  function inner() { return mkdtempSync(prefix); }\n  return dir + inner();\n}\n", [[4, 'inner', 'call', sync]]],
    ['tests/forms/elsewhere.ts', "import { mkdtempSync } from 'node:fs';\nfunction tmpDir(prefix: string) {\n  return mkdtempSync(prefix);\n}\n", [[1, 'module scope', 'reference', sync], [3, 'tmpDir', 'call', sync]]],
    ['tests/forms/nested-occurrence.ts', "import fs from 'node:fs';\nfs.mkdtempSync(\n  fs.mkdtemp.name,\n);\n", [[2, 'module scope', 'call', sync], [3, 'module scope', 'reference', base]]],
    ['tests/forms/separators.ts', `import { mkdtempSync } from 'node:fs';\nconst s = 'a${String.fromCharCode(0x2028)}b${String.fromCharCode(0x2029)}c';\nmkdtempSync(s);\n`, [[1, 'module scope', 'reference', sync], [3, 'module scope', 'call', sync]]],
    ['tests/forms/iife.ts', "import fs from 'node:fs';\nconst probe = (() => {\n  return fs.mkdtempSync('x');\n})();\n", [[3, 'probe (immediately invoked)', 'call', sync]]],
    ['tests/forms/iife-wrapped.ts', "import fs from 'node:fs';\nconst probe = ((() => {\n  return fs.mkdtempSync('x');\n}) as () => string)();\n", [[3, '<anonymous>', 'call', sync]]],
    ['tests/infra/helpers.ts', "import { mkdtempSync } from 'node:fs';\nexport function tmpDir(prefix: string): string {\n  return mkdtempSync(prefix);\n}\n", []],
    ['tests/surface/evals.test.ts', "import { mkdtempSync } from 'node:fs';\nfunction tempDir(prefix: string) {\n  return mkdtempSync(prefix);\n}\n", []],
    ['tests/surface/command-lines.test.ts', "import { mkdtempSync } from 'node:fs';\nfunction tempDir(prefix: string) {\n  return mkdtempSync(prefix);\n}\n", []],
    ['tests/surface/eval-test-temp.test.ts', "import { mkdtempSync } from 'node:fs';\nfunction inTemp(prefix: string) {\n  return mkdtempSync(prefix);\n}\n", []],
    ['tests/forms/comment.ts', "// mkdtempSync('x')\n/* fs.mkdtemp('y') */\nexport {};\n", []],
    ['tests/forms/text.ts', "const s = 'mkdtempSync(';\nvoid s;\n", []],
    ['tests/forms/template.ts', "const n = 1;\nconst t = `mkdtempSync${n}`;\nvoid t;\n", []],
    ['tests/surface/test-temp.test.ts', own, []],
  ];
  // Each row in a directory of its own, so that a helper's file can appear in more than one row.
  const actual = rows.flatMap(([file, text], i) => {
    const root = path.join(scanRoot, String(i));
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text, 'utf8');
    return scanTests(root);
  });
  const expected = rows.flatMap(([file, , sites]) => sites.map(([line, fn, kind, name]): Site => ({ file, line, fn, kind, name })));
  assert.deepEqual(actual.map(show), expected.map(show));
});
