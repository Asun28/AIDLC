import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');

/** The ranked directories of src/, inner to outer: the order of the Layers sentence of CLAUDE.md. */
const ORDER = ['core', 'scaffold', 'probes', 'state', 'coordination', 'delivery', 'review', 'loop', 'hooks', 'cli'];

interface Edge { from: string; to: string; builtin: boolean }

/** The module specifiers of a TypeScript source text, read from its syntax tree [R1]. */
function importsOf(_text: string, _fileName: string): string[] {
  return [];
}

/** The edge of one specifier in one file (posix paths from the repository root), or none [R3]. */
function edgeOf(_from: string, _spec: string): Edge | undefined {
  return undefined;
}

/** The findings of the four rules over the source files and their imports [R2] [R3] [R4] [R5]. */
function findings(_sources: string[], _edges: Edge[], _order: string[] = ORDER): string[] {
  return [];
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
