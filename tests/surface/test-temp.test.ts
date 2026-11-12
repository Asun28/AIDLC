// Card T0-TEST-TEMP-SWEEP: no test creates a temporary directory outside a helper that registers its removal.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { cleanup, tmpDir } from '../infra/helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const FS_MODULES = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises']);
const TARGETS = new Set(['mkdtempSync', 'mkdtemp', 'mkdtempDisposableSync']);
/** The four helpers of R2 (file relative to the root, top-level function): each records its directory at creation. */
const ALLOWED = new Set(['tests/infra/helpers.ts#tmpDir', 'tests/surface/evals.test.ts#tempDir', 'tests/surface/command-lines.test.ts#tempDir', 'tests/surface/eval-test-temp.test.ts#inTemp']);

interface Site { file: string; line: number; fn: string; kind: 'call' | 'reference'; name: string }
const show = (s: Site): string => `${s.file}:${s.line} [${s.fn}] ${s.kind} of ${s.name}`;

const stringValue = (node: ts.Node): string | undefined => (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined);
/** The member name of `x.name` or `x['name']`, else undefined. */
const memberName = (node: ts.Node): string | undefined =>
  ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) ? stringValue(node.argumentExpression) : undefined;
const isFunctionLike = (node: ts.Node): node is ts.SignatureDeclaration =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node);

/** The name a report gives a function: its declared or bound name, `callback of <callee>` for an argument, `<name> (immediately invoked)`, else `<anonymous>`. */
function functionName(fn: ts.SignatureDeclaration, sf: ts.SourceFile): string {
  if (fn.name && (ts.isIdentifier(fn.name) || ts.isStringLiteral(fn.name))) return fn.name.text;
  const parent = fn.parent;
  if (ts.isParenthesizedExpression(parent) && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
    const holder = parent.parent.parent;
    return `${ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name) ? holder.name.text : '<anonymous>'} (immediately invoked)`;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && ts.isIdentifier(parent.name)) return parent.name.text;
  if (ts.isCallExpression(parent) && parent.arguments.includes(fn as ts.Expression)) return `callback of ${parent.expression.getText(sf)}`;
  return '<anonymous>';
}

/** Every call of an fs mkdtemp function in `text`, and every reference to one that is not called, outside the four helpers of R2. */
function scanSource(file: string, text: string): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const fsObjects = new Set<string>();
  const bound = new Map<string, string>();
  const isRequireOfFs = (node: ts.Node): boolean =>
    ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments.length === 1 && FS_MODULES.has(stringValue(node.arguments[0]!) ?? '');
  const isFsObject = (node: ts.Node): boolean => {
    if (ts.isParenthesizedExpression(node)) return isFsObject(node.expression);
    if (ts.isIdentifier(node)) return fsObjects.has(node.text);
    if (memberName(node) === 'promises') return isFsObject((node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression);
    return isRequireOfFs(node);
  };
  /** The fs function an expression resolves to, else undefined. */
  const target = (node: ts.Node): string | undefined => {
    if (ts.isIdentifier(node)) return bound.get(node.text);
    const name = memberName(node);
    return name !== undefined && TARGETS.has(name) && isFsObject((node as ts.PropertyAccessExpression | ts.ElementAccessExpression).expression) ? name : undefined;
  };
  const bindName = (local: string, imported: string): void => {
    if (TARGETS.has(imported)) bound.set(local, imported);
    else if (imported === 'promises') fsObjects.add(local);
  };
  const collect = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && FS_MODULES.has(stringValue(node.moduleSpecifier) ?? '') && node.importClause) {
      const { name, namedBindings } = node.importClause;
      if (name) fsObjects.add(name.text);
      if (namedBindings && ts.isNamespaceImport(namedBindings)) fsObjects.add(namedBindings.name.text);
      if (namedBindings && ts.isNamedImports(namedBindings)) for (const el of namedBindings.elements) bindName(el.name.text, (el.propertyName ?? el.name).text);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && FS_MODULES.has(stringValue(node.moduleReference.expression) ?? '')) {
      fsObjects.add(node.name.text);
    } else if (ts.isVariableDeclaration(node) && node.initializer && isFsObject(node.initializer)) {
      if (ts.isIdentifier(node.name)) fsObjects.add(node.name.text);
      else if (ts.isObjectBindingPattern(node.name)) {
        for (const el of node.name.elements) {
          const key = el.propertyName ?? el.name;
          if (ts.isIdentifier(el.name) && (ts.isIdentifier(key) || ts.isStringLiteral(key))) bindName(el.name.text, key.text);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  for (let size = -1; size !== fsObjects.size + bound.size; ) {
    size = fsObjects.size + bound.size;
    collect(sf);
  }
  /** An identifier that names a binding rather than reading one. */
  const declares = (id: ts.Identifier): boolean => {
    const p = id.parent;
    return ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p) || ts.isImportEqualsDeclaration(p) || ts.isBindingElement(p)
      || ((ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isParameter(p) || ts.isPropertyAssignment(p) || ts.isPropertyAccessExpression(p)) && p.name === id);
  };
  const sites: Site[] = [];
  const visit = (node: ts.Node): void => {
    const name = ts.isIdentifier(node) && declares(node) ? undefined : target(node);
    if (name !== undefined) {
      const called = ts.isCallExpression(node.parent) && node.parent.expression === node;
      let fn: ts.Node | undefined = node.parent;
      while (fn && !isFunctionLike(fn)) fn = fn.parent;
      const exempt = called && fn !== undefined && ts.isFunctionDeclaration(fn) && fn.parent === sf && ALLOWED.has(`${file}#${fn.name?.text}`);
      if (!exempt) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        sites.push({ file, line, fn: fn ? functionName(fn as ts.SignatureDeclaration, sf) : 'module scope', kind: called ? 'call' : 'reference', name });
      }
      return;
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

test('T0-TEST-TEMP-SWEEP acceptance 2: the scan finds every form [R2]', () => {
  const rows: Array<[file: string, text: string, expected: Array<[line: number, fn: string, kind: Site['kind'], name: string]>]> = [
    ['tests/forms/named.ts', "import { mkdtempSync } from 'node:fs';\nfunction named() {\n  return mkdtempSync('x');\n}\n", [[3, 'named', 'call', 'mkdtempSync']]],
    ['tests/forms/aliased.ts', "import { mkdtempSync as make } from 'fs';\nconst aliased = () => make('x');\n", [[2, 'aliased', 'call', 'mkdtempSync']]],
    ['tests/forms/namespace.ts', "import * as fs from 'node:fs';\nfs.mkdtempSync('x');\n", [[2, 'module scope', 'call', 'mkdtempSync']]],
    ['tests/forms/default.ts', "import fs from 'fs';\ntest('t', () => {\n  fs.mkdtempSync('x');\n});\n", [[3, 'callback of test', 'call', 'mkdtempSync']]],
    ['tests/forms/promises.ts', "import fs from 'node:fs';\nasync function viaPromises() {\n  await fs.promises.mkdtemp('x');\n}\n", [[3, 'viaPromises', 'call', 'mkdtemp']]],
    ['tests/forms/fs-promises.ts', "import { mkdtemp } from 'node:fs/promises';\nawait mkdtemp('x');\n", [[2, 'module scope', 'call', 'mkdtemp']]],
    ['tests/forms/destructure.ts', "import fs from 'node:fs';\nconst { mkdtempSync } = fs;\nmkdtempSync('x');\n", [[3, 'module scope', 'call', 'mkdtempSync']]],
    ['tests/forms/destructure-rename.ts', "import * as fs from 'fs';\nconst { mkdtempSync: m } = fs;\nfunction renamed() { return m('x'); }\n", [[3, 'renamed', 'call', 'mkdtempSync']]],
    ['tests/forms/element.ts', "import fs from 'fs';\nfs['mkdtempSync']('x');\n", [[2, 'module scope', 'call', 'mkdtempSync']]],
    ['tests/forms/require.ts', "const dir = require('node:fs').mkdtempSync('x');\n", [[1, 'module scope', 'call', 'mkdtempSync']]],
    ['tests/forms/require-destructure.ts', "const { mkdtempSync } = require('fs');\nfunction viaRequire() {\n  return mkdtempSync('x');\n}\n", [[3, 'viaRequire', 'call', 'mkdtempSync']]],
    ['tests/forms/disposable.ts', "import { mkdtempDisposableSync } from 'node:fs';\nconst d = mkdtempDisposableSync('x');\n", [[2, 'module scope', 'call', 'mkdtempDisposableSync']]],
    ['tests/forms/reference.ts',"import { mkdtempSync } from 'node:fs';\nconst make = mkdtempSync;\nmake('x');\n", [[2, 'module scope', 'reference', 'mkdtempSync']]],
    ['tests/infra/helpers.ts', "import { mkdtempSync } from 'node:fs';\nexport function tmpDir(prefix: string): string {\n  const dir = mkdtempSync(prefix);\n  function inner() { return mkdtempSync(prefix); }\n  return dir + inner();\n}\n", [[4, 'inner', 'call', 'mkdtempSync']]],
    ['tests/surface/evals.test.ts', "import { mkdtempSync } from 'node:fs';\nfunction tempDir(prefix: string) {\n  return mkdtempSync(prefix);\n}\n", []],
    ['tests/surface/command-lines.test.ts', "import { mkdtempSync } from 'node:fs';\nfunction tempDir(prefix: string) {\n  return mkdtempSync(prefix);\n}\n", []],
    ['tests/surface/eval-test-temp.test.ts', "import { mkdtempSync } from 'node:fs';\nfunction inTemp(prefix: string) {\n  return mkdtempSync(prefix);\n}\n", []],
    ['tests/forms/elsewhere.ts', "import { mkdtempSync } from 'node:fs';\nfunction tmpDir(prefix: string) {\n  return mkdtempSync(prefix);\n}\n", [[3, 'tmpDir', 'call', 'mkdtempSync']]],
    ['tests/forms/text.ts', "import { mkdtempSync } from 'node:fs';\nconst s = 'mkdtempSync(';\n// mkdtempSync('x')\n/* fs.mkdtempSync('y') */\nvoid s;\n", []],
    ['tests/forms/local.ts', "function mkdtempSync(p: string) { return p; }\nmkdtempSync('x');\n", []],
  ];
  for (const [file, text] of rows) {
    mkdirSync(path.dirname(path.join(scanRoot, file)), { recursive: true });
    writeFileSync(path.join(scanRoot, file), text, 'utf8');
  }
  const expected = rows
    .flatMap(([file, , sites]) => sites.map(([line, fn, kind, name]): Site => ({ file, line, fn, kind, name })))
    .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  assert.deepEqual(scanTests(scanRoot).map(show), expected.map(show));
});
