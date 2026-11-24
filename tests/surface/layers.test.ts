import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..', '..');

/** The ranked directories of src/, inner to outer: the order of the Layers sentence of CLAUDE.md. */
const ORDER = ['core', 'scaffold', 'probes', 'state', 'coordination', 'delivery', 'review', 'loop', 'hooks', 'cli'];

interface Edge { from: string; to: string; builtin: boolean }

/** The top-level units of src/ that have no place in the order; rules R3 to R5 hold for them. */
const UNRANKED = ['artifacts', 'audit', 'evals', 'maintain', 'providers', 'config.ts', 'index.ts'];

/** The module specifiers of a TypeScript source text, read from its syntax tree [R1]. */
function importsOf(text: string, fileName: string): string[] {
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) out.push(n.arguments[0].text);
    else if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) out.push(n.argument.literal.text);
    ts.forEachChild(n, visit);
  };
  visit(ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS));
  return out;
}

/** The edge of one specifier in one file (posix paths from the repository root): a file under src/, a Node built-in as `node:<name>`, or none [R3]. */
function edgeOf(from: string, spec: string): Edge | undefined {
  if (isBuiltin(spec)) return { from, to: spec.startsWith('node:') ? spec : `node:${spec}`, builtin: true };
  if (!spec.startsWith('.')) return undefined;
  const to = path.posix.join(path.posix.dirname(from), spec);
  return to.startsWith('src/') ? { from, to, builtin: false } : undefined;
}

/** The findings of the four rules over the source files and their imports [R2] [R3] [R4] [R5]. */
function findings(sources: string[], edges: Edge[], order: string[] = ORDER): string[] {
  const unit = (file: string): string => file.split('/')[1]!;
  const out: string[] = [];
  for (const file of sources) if (!order.includes(unit(file)) && !UNRANKED.includes(unit(file))) out.push(`unplaced: ${unit(file)} (${file}) is in no list`);
  const graph = new Map<string, Set<string>>();
  for (const { from, to, builtin } of edges) {
    const a = unit(from);
    if (builtin) {
      if (a === 'core' && to !== 'node:crypto') out.push(`core: ${from} imports ${to}`);
      continue;
    }
    const b = unit(to);
    if (a === b) continue;
    if (a === 'core') out.push(`core: ${from} imports ${to}`);
    if (order.includes(a) && order.includes(b) && order.indexOf(a) < order.indexOf(b)) out.push(`order: ${from} imports ${to} (${a} before ${b})`);
    graph.set(a, (graph.get(a) ?? new Set()).add(b));
  }
  // Remove each unit whose imports are all removed; the units left lie on a cycle or import one.
  const left = new Set([...graph.keys(), ...[...graph.values()].flatMap((s) => [...s])]);
  for (let moved = true; moved;) {
    moved = false;
    for (const u of left) if (![...(graph.get(u) ?? [])].some((d) => left.has(d))) moved = left.delete(u);
  }
  if (left.size > 0) out.push(`cycle: among ${[...left].sort().join(', ')}`);
  return out;
}

/** The findings of built lists: source files, and imports as [file, specifier]. */
function check(sources: string[], imports: [string, string][], order: string[] = ORDER): string[] {
  return findings(sources, imports.map(([from, spec]) => edgeOf(from, spec)).filter((e): e is Edge => e !== undefined), order);
}

function sourceFiles(dir: string, rel: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? sourceFiles(path.join(dir, e.name), `${rel}/${e.name}`) : e.name.endsWith('.ts') ? [`${rel}/${e.name}`] : []);
}

describe('layers of src/ (T0-LAYER-ORDER-TEST)', () => {
  test('1. the reader takes each import form from the syntax tree and none from text that is not an import [R1]', () => {
    const forms: [string, string][] = [
      ["import { a } from './a.ts';", './a.ts'],
      ["import type { B } from './b.ts';", './b.ts'],
      ["import './c.ts';", './c.ts'],
      ["export { d } from './d.ts';", './d.ts'],
      ["export * from './e.ts';", './e.ts'],
      ["export * as ns from './f.ts';", './f.ts'],
      ["export type * as ns from './g.ts';", './g.ts'],
      ["const h = await import('./h.ts');", './h.ts'],
      ["let i: typeof import('./i.ts');", './i.ts'],
    ];
    for (const [text, spec] of forms) assert.deepEqual(importsOf(text, 'src/x.ts'), [spec], text);
    const none = [
      "const p = './j.ts'; const j = await import(p);",
      "// import { k } from './k.ts';",
      "const s = \"import { l } from './l.ts'\";",
      "const t = `import { m } from './m.ts'`;",
      'const n = await import(`./n.ts`);',
      "const o = require('./o.ts');",
    ];
    for (const text of none) assert.deepEqual(importsOf(text, 'src/x.ts'), [], text);
  });

  test('2. the check reports each rule on built lists of source files and imports [R2] [R3] [R4] [R5]', () => {
    const one = (from: string, spec: string, to: string) => {
      const found = check([], [[from, spec]]);
      assert.equal(found.length, 1, `${from} -> ${spec}: ${JSON.stringify(found)}`);
      assert.ok(found[0]!.includes(from) && found[0]!.includes(to), found[0]);
    };
    one('src/state/store.ts', '../loop/controller.ts', 'src/loop/controller.ts');
    one('src/probes/git.ts', '../state/store.ts', 'src/state/store.ts');
    one('src/scaffold/init.ts', '../probes/git.ts', 'src/probes/git.ts');
    const none: [string, string][] = [
      ['src/state/claims.ts', '../probes/git.ts'],
      ['src/probes/hook-wiring.ts', '../scaffold/init.ts'],
      ['src/cli/main.ts', '../scaffold/init.ts'],
      ['src/state/store.ts', './paths.ts'],
      ['src/state/claims.ts', '../artifacts/card.ts'],
      ['src/core/router.ts', 'node:crypto'],
      ['src/core/router.ts', 'crypto'],
      ['src/core/router.ts', 'zod'],
      ['src/core/router.ts', '../../bench/run.ts'],
    ];
    for (const imp of none) assert.deepEqual(check([], [imp]), [], imp.join(' -> '));
    assert.deepEqual(check([], [['src/config.ts', 'loop'], ['src/loop/run.ts', '../config.ts']]), [], 'a package named as a unit is no edge');
    // A relative specifier names the file the compiler resolves it to. These cases resolve against real files of the
    // tree (src/config.ts, src/audit/manifest.ts, src/index.ts, src/loop/controller.ts, bench/run.ts): a rename fails them.
    const sources = ['src/config.ts', 'src/audit/manifest.ts', 'src/index.ts'];
    for (const [first, spec, pair] of [['src/config.ts', '../config.js', /^cycle: among audit, config\.ts$/], ['src/config.ts', '../config.jsx', /^cycle: among audit, config\.ts$/],
      ['src/config.ts', '../config', /^cycle: among audit, config\.ts$/], ['src/index.ts', '..', /^cycle: among audit, index\.ts$/]] as const) {
      const found = check(sources, [[first, './audit/manifest.ts'], ['src/audit/manifest.ts', spec]]);
      assert.equal(found.length, 1, `${spec}: ${JSON.stringify(found)}`);
      assert.match(found[0]!, pair);
    }
    one('src/state/store.ts', '../loop/controller.js', 'src/loop/controller.ts');
    one('src/state/store.ts', '../loop/nothing.js', 'src/loop/nothing.js');
    assert.deepEqual(check([], [['src/core/router.ts', '../../bench/run.js']]), [], 'resolved outside src/');
    one('src/core/router.ts', '../artifacts/card.ts', 'src/artifacts/card.ts');
    one('src/core/router.ts', 'node:fs', 'fs');
    one('src/core/router.ts', 'fs', 'fs');
    const cycle = check([], [['src/audit/manifest.ts', '../evals/runner.ts'], ['src/evals/runner.ts', '../audit/verifier.ts']]);
    assert.equal(cycle.length, 1, JSON.stringify(cycle));
    assert.match(cycle[0]!, /cycle.*audit.*evals/);
    // A directory and a root file in no list: imports a listed unit, is imported by one, imports nothing, imports a package.
    for (const [file, inner] of [['src/newdir/a.ts', '../core/types.ts'], ['src/extra.ts', './core/types.ts']] as const) {
      const cases: [string[], [string, string][]][] = [
        [[file], [[file, inner]]],
        [[file, 'src/cli/main.ts'], [['src/cli/main.ts', path.posix.relative('src/cli', file)]]],
        [[file], []],
        [[file], [[file, 'zod']]],
      ];
      for (const [sources, imports] of cases) {
        const found = check(sources, imports);
        assert.equal(found.length, 1, `${file} ${JSON.stringify(imports)}: ${JSON.stringify(found)}`);
        assert.ok(found[0]!.startsWith('unplaced') && found[0]!.includes(file), found[0]);
      }
    }
  });

  test('3. the tree gives no finding, and an order finding with the ranked order reversed [R2] [R3] [R4] [R5]', () => {
    const files = sourceFiles(path.join(root, 'src'), 'src');
    assert.ok(files.includes('src/index.ts') && files.includes('src/core/types.ts'), 'the listing walks src/');
    const imports: [string, string][] = files.flatMap((f) =>
      importsOf(readFileSync(path.join(root, f), 'utf8'), f).map((spec): [string, string] => [f, spec]));
    assert.deepEqual(check(files, imports), []);
    assert.ok(check(files, imports, [...ORDER].reverse()).some((f) => f.startsWith('order')), 'reversed order');
  });
});
