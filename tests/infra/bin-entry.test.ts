import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanup, tmpDir } from './helpers.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Resolved = { target: string; reason: 'dist' | 'no-dist' | 'stale-dist' };
type ResolveEntry = (input: { dist: string; src: string; srcRoot: string }) => Resolved;

async function loadResolver(): Promise<ResolveEntry> {
  const mod = (await import(pathToFileURL(path.join(repoRoot, 'bin', 'resolve-entry.js')).href)) as { resolveEntry: ResolveEntry };
  return mod.resolveEntry;
}

describe('bin entries: the compiled build is loaded only when it is at least as new as every source file (T0-BIN-STALE-DIST)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));
  const at = (file: string, iso: string) => {
    const d = new Date(iso);
    utimesSync(file, d, d);
  };

  it('resolveEntry: the compiled entry when it is current, the sources when it is missing or older than any source file', async () => {
    const resolveEntry = await loadResolver();
    const srcRoot = path.join(dir, 'src');
    mkdirSync(path.join(srcRoot, 'cli'), { recursive: true });
    mkdirSync(path.join(srcRoot, 'deep', 'er'), { recursive: true });
    const src = path.join(srcRoot, 'cli', 'main.ts');
    const deep = path.join(srcRoot, 'deep', 'er', 'x.ts');
    writeFileSync(src, '', 'utf8');
    writeFileSync(deep, '', 'utf8');
    at(src, '2026-09-01T00:00:00Z');
    at(deep, '2026-09-01T00:00:00Z');
    const dist = path.join(dir, 'dist', 'cli', 'main.js');
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'no-dist' }, 'no build: the sources');
    mkdirSync(path.dirname(dist), { recursive: true });
    writeFileSync(dist, '', 'utf8');
    at(dist, '2026-09-02T00:00:00Z');
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: dist, reason: 'dist' }, 'a build newer than every source file');
    at(deep, '2026-09-03T00:00:00Z');
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'stale-dist' }, 'a source file deep in the tree newer than the build: the sources');
    at(deep, '2026-09-02T00:00:00Z');
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: dist, reason: 'dist' }, 'a source file as new as the build is not newer');
    assert.deepEqual(resolveEntry({ dist, src, srcRoot: path.join(dir, 'missing') }), { target: dist, reason: 'dist' }, 'a source root that cannot be read counts as not newer');
  });

  it('both bin entries load the resolver, and AIDLC_ENTRY_DEBUG=1 prints the chosen target and the reason once', () => {
    for (const entry of ['aidlc.js', 'aidlc-hook.js']) {
      const text = readFileSync(path.join(repoRoot, 'bin', entry), 'utf8');
      assert.match(text, /from '\.\/resolve-entry\.js'/, `${entry} imports the shared resolver`);
      assert.match(text, /resolveEntry\(/, `${entry} calls it`);
      assert.doesNotMatch(text, /existsSync\(dist\) \? dist : src/, `${entry} no longer prefers dist/ on existence alone`);
    }
    const run = spawnSync(process.execPath, [path.join(repoRoot, 'bin', 'aidlc.js'), '--version'], { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, AIDLC_ENTRY_DEBUG: '1' } });
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stderr.split(/\r?\n/).filter((l) => l.startsWith('[aidlc entry]'));
    assert.equal(lines.length, 1, `one debug line: ${run.stderr}`);
    assert.match(lines[0]!, /reason=(dist|no-dist|stale-dist)/);
    assert.match(lines[0]!, /target=.*(main\.js|main\.ts)/);
  });
});
