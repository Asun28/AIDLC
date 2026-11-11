import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const doc = readFileSync(path.join(root, 'docs', 'ARCHITECTURE.md'), 'utf8').replace(/\r\n/g, '\n');

function listTs(dir: string, rel: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = `${rel}/${e.name}`;
    if (e.isDirectory()) out.push(...listTs(path.join(dir, e.name), r));
    else if (e.name.endsWith('.ts')) out.push(r);
  }
  return out;
}

// A run of n backticks opens a span and the next run of exactly n on the line closes it.
function spansOf(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const runs = [...line.matchAll(/`+/g)].map((m) => ({ at: m.index!, n: m[0].length }));
    for (let i = 0; i < runs.length; i += 1) {
      const close = runs.findIndex((r, j) => j > i && r.n === runs[i]!.n);
      if (close < 0) continue;
      out.push(line.slice(runs[i]!.at + runs[i]!.n, runs[close]!.at));
      i = close;
    }
  }
  return out;
}

function mapParagraphs(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === '## Module map');
  if (start < 0) return [];
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').split(/\n\s*\n/);
}

function named(file: string, text: string): boolean {
  const base = file.slice(file.lastIndexOf('/') + 1);
  const dir = file.slice(0, file.lastIndexOf('/') + 1);
  const below = file.slice('src/'.length);
  if (spansOf(text).some((s) => s === file || (below.includes('/') && s === below))) return true;
  return mapParagraphs(text).some((p) => {
    const spans = spansOf(p);
    return spans.includes(base) && spans.some((s) => s.startsWith(dir));
  });
}

describe('docs/ARCHITECTURE.md module map (T0-AUDIT-DOC-TRUTH)', () => {
  test('every source file under src/ is named in docs/ARCHITECTURE.md [T0-AUDIT-DOC-TRUTH R7]', () => {
    const files = listTs(path.join(root, 'src'), 'src').sort();
    assert.ok(files.includes('src/config.ts') && files.includes('src/core/types.ts'), 'the listing walks src/');
    assert.deepEqual(files.filter((f) => !named(f, doc)), []);
  });

  test('matcher controls on the real document [T0-AUDIT-DOC-TRUTH R7]', () => {
    assert.equal(named('src/core/stop.ts', doc.replaceAll('`stop.ts`', '')), false, 'control 1');
    assert.equal(named('src/core/absent-module.ts', doc), false, 'control 2');
  });

  test('matcher controls on synthetic documents [T0-AUDIT-DOC-TRUTH R7]', () => {
    const synth = (map: string, rest = '') => `# T\n\n## Module map\n\n${map}\n\n## Next\n\n${rest}\n`;
    const f = 'src/a/b.ts';
    assert.equal(named(f, synth('`src/a/` holds x.', '`src/a/b.ts` is named.')), true, 'full path outside the map');
    assert.equal(named(f, synth('`src/a/` holds x.', '`a/b.ts` is named.')), true, 'path below src/ outside the map');
    assert.equal(named(f, synth('`src/a/` holds `b.ts`.')), true, 'base name in its directory paragraph');
    assert.equal(named(f, synth('`src/c/` holds `b.ts`.')), false, 'base name in another directory paragraph');
    assert.equal(named(f, synth('`src/a/` holds x.', '`src/a/` holds `b.ts`.')), false, 'base name outside the map');
    assert.equal(named(f, synth('`src/a/` holds b.ts as text.')), false, 'plain text');
    assert.equal(named(f, synth('`src/a/` holds `b.ts.bak` and `see b.ts`.')), false, 'inside a longer span');
    assert.equal(named(f, synth('`src/a/` holds x.', '`see src/a/b.ts` here.')), false, 'full path inside a longer span');
    assert.equal(named(f, synth('`src/a/` holds `x ``b.ts`` y`.')), false, 'doubled backticks inside a single span');
    assert.equal(named('src/config.ts', synth('`src/a/` holds x.', '`config.ts` is named.')), false, 'root-level base name outside the map');
  });
});
