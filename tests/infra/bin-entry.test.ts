import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs, { copyFileSync, mkdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanup, tmpDir } from './helpers.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Resolved = { target: string; reason: 'dist' | 'no-dist' | 'stale-dist' | 'src-unreadable' };
type ResolveEntry = (input: { dist: string; src: string; srcRoot: string }) => Resolved;

async function loadResolver(): Promise<ResolveEntry> {
  const mod = (await import(pathToFileURL(path.join(repoRoot, 'bin', 'resolve-entry.js')).href)) as { resolveEntry: ResolveEntry };
  return mod.resolveEntry;
}

const at = (file: string, iso: string) => {
  const d = new Date(iso);
  utimesSync(file, d, d);
};

/**
 * A symbolic link (a junction for a directory on Windows). Only the platform's refusal (EPERM: no privilege) is
 * reported, as false, so the case is skipped explicitly; any other failure is a setup error and fails the test.
 */
function linkOrRefused(target: string, link: string, type: 'file' | 'dir' | 'junction'): boolean {
  try {
    symlinkSync(target, link, type);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw err;
  }
}

describe('bin entries: the compiled build is loaded only when it is at least as new as every source file (T0-BIN-STALE-DIST)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));

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

  it('resolveEntry counts a newer source reached through a linked file', async (t) => {
    const resolveEntry = await loadResolver();
    const base = path.join(dir, 'linked-file');
    const srcRoot = path.join(base, 'src');
    const outside = path.join(base, 'outside');
    mkdirSync(path.join(srcRoot, 'cli'), { recursive: true });
    mkdirSync(outside, { recursive: true });
    const src = path.join(srcRoot, 'cli', 'main.ts');
    writeFileSync(src, '', 'utf8');
    at(src, '2026-09-01T00:00:00Z');
    const dist = path.join(base, 'dist', 'cli', 'main.js');
    mkdirSync(path.dirname(dist), { recursive: true });
    writeFileSync(dist, '', 'utf8');
    at(dist, '2026-09-02T00:00:00Z');
    const newerFile = path.join(outside, 'newer.ts');
    writeFileSync(newerFile, '', 'utf8');
    at(newerFile, '2026-09-03T00:00:00Z');
    if (!linkOrRefused(newerFile, path.join(srcRoot, 'linked.ts'), 'file')) {
      t.skip('the platform refuses file links (EPERM)');
      return;
    }
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'stale-dist' }, 'a newer source reached through a file link counts');
    fs.rmSync(path.join(srcRoot, 'linked.ts'));
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: dist, reason: 'dist' }, 'without the link the build is current');
  });

  it('resolveEntry walks a linked directory', async (t) => {
    const resolveEntry = await loadResolver();
    const base = path.join(dir, 'linked-dir');
    const srcRoot = path.join(base, 'src');
    const outside = path.join(base, 'outside');
    mkdirSync(path.join(srcRoot, 'cli'), { recursive: true });
    mkdirSync(path.join(outside, 'sub'), { recursive: true });
    const src = path.join(srcRoot, 'cli', 'main.ts');
    writeFileSync(src, '', 'utf8');
    at(src, '2026-09-01T00:00:00Z');
    const dist = path.join(base, 'dist', 'cli', 'main.js');
    mkdirSync(path.dirname(dist), { recursive: true });
    writeFileSync(dist, '', 'utf8');
    at(dist, '2026-09-02T00:00:00Z');
    const newerInDir = path.join(outside, 'sub', 'deep.ts');
    writeFileSync(newerInDir, '', 'utf8');
    at(newerInDir, '2026-09-03T00:00:00Z');
    const linkedDir = path.join(srcRoot, 'linked-dir');
    const linked = process.platform === 'win32' ? linkOrRefused(path.join(outside, 'sub'), linkedDir, 'junction') : linkOrRefused(path.join(outside, 'sub'), linkedDir, 'dir');
    if (!linked) {
      t.skip('the platform refuses directory links (EPERM)');
      return;
    }
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'stale-dist' }, 'a newer source reached through a directory link counts');
    at(newerInDir, '2026-09-02T00:00:00Z');
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: dist, reason: 'dist' }, 'the linked directory is walked: with nothing newer the build is current');
  });

  it('resolveEntry ends a cycle through directory links', async (t) => {
    const resolveEntry = await loadResolver();
    const base = path.join(dir, 'linked-cycle');
    const srcRoot = path.join(base, 'src');
    const outside = path.join(base, 'outside');
    mkdirSync(path.join(srcRoot, 'cli'), { recursive: true });
    mkdirSync(path.join(outside, 'sub'), { recursive: true });
    const src = path.join(srcRoot, 'cli', 'main.ts');
    writeFileSync(src, '', 'utf8');
    at(src, '2026-09-01T00:00:00Z');
    const dist = path.join(base, 'dist', 'cli', 'main.js');
    mkdirSync(path.dirname(dist), { recursive: true });
    writeFileSync(dist, '', 'utf8');
    at(dist, '2026-09-02T00:00:00Z');
    const newerInDir = path.join(outside, 'sub', 'deep.ts');
    writeFileSync(newerInDir, '', 'utf8');
    at(newerInDir, '2026-09-03T00:00:00Z');
    const kind = process.platform === 'win32' ? 'junction' : 'dir';
    if (!linkOrRefused(path.join(outside, 'sub'), path.join(srcRoot, 'linked-dir'), kind)) {
      t.skip('the platform refuses directory links (EPERM)');
      return;
    }
    if (!linkOrRefused(srcRoot, path.join(outside, 'sub', 'back'), kind)) {
      t.skip('the platform refuses the cycle link (EPERM)');
      return;
    }
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'stale-dist' }, 'a cycle through links ends and the newer source counts');
  });

  it('resolveEntry never treats an incomplete scan as freshness: an unreadable descendant or an uninspectable source selects the sources', async () => {
    const resolveEntry = await loadResolver();
    const base = path.join(dir, 'partial');
    const srcRoot = path.join(base, 'src');
    mkdirSync(path.join(srcRoot, 'cli'), { recursive: true });
    mkdirSync(path.join(srcRoot, 'locked'), { recursive: true });
    const src = path.join(srcRoot, 'cli', 'main.ts');
    writeFileSync(src, '', 'utf8');
    at(src, '2026-09-01T00:00:00Z');
    const hidden = path.join(srcRoot, 'locked', 'newer.ts');
    writeFileSync(hidden, '', 'utf8');
    at(hidden, '2026-09-03T00:00:00Z');
    const dist = path.join(base, 'dist', 'cli', 'main.js');
    mkdirSync(path.dirname(dist), { recursive: true });
    writeFileSync(dist, '', 'utf8');
    at(dist, '2026-09-02T00:00:00Z');
    const failing = (code: string) => {
      const err = new Error(`${code}: cannot inspect`) as NodeJS.ErrnoException;
      err.code = code;
      return err;
    };
    const realReaddir = fs.readdirSync;
    const realStat = fs.statSync;
    try {
      (fs as unknown as Record<string, unknown>)['readdirSync'] = ((p: fs.PathLike, ...rest: unknown[]) => {
        if (String(p) === path.join(srcRoot, 'locked')) throw failing('EACCES');
        return (realReaddir as unknown as (...a: unknown[]) => unknown)(p, ...rest);
      }) as typeof fs.readdirSync;
      syncBuiltinESMExports();
      assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'src-unreadable' }, 'a descendant directory that cannot be read hides sources: never the build');
      (fs as unknown as Record<string, unknown>)['readdirSync'] = realReaddir;
      (fs as unknown as Record<string, unknown>)['statSync'] = ((p: fs.PathLike, ...rest: unknown[]) => {
        if (String(p) === hidden) throw failing('EIO');
        return (realStat as unknown as (...a: unknown[]) => unknown)(p, ...rest);
      }) as typeof fs.statSync;
      syncBuiltinESMExports();
      assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'src-unreadable' }, 'a source that cannot be inspected is never proof of freshness');
      // The root enumerates but one of its own children cannot be inspected (readdir with file types would lstat it and fail):
      // a descendant failure, never an unreadable root.
      (fs as unknown as Record<string, unknown>)['statSync'] = realStat;
      (fs as unknown as Record<string, unknown>)['readdirSync'] = ((p: fs.PathLike, options?: unknown) => {
        if (String(p) === srcRoot && options && typeof options === 'object' && (options as { withFileTypes?: boolean }).withFileTypes) throw failing('EIO');
        return (realReaddir as unknown as (...a: unknown[]) => unknown)(p, options);
      }) as typeof fs.readdirSync;
      (fs as unknown as Record<string, unknown>)['statSync'] = ((p: fs.PathLike, ...rest: unknown[]) => {
        if (String(p) === path.join(srcRoot, 'cli')) throw failing('EIO');
        return (realStat as unknown as (...a: unknown[]) => unknown)(p, ...rest);
      }) as typeof fs.statSync;
      syncBuiltinESMExports();
      assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'src-unreadable' }, 'a child of a readable root that cannot be inspected selects the sources');
    } finally {
      (fs as unknown as Record<string, unknown>)['readdirSync'] = realReaddir;
      (fs as unknown as Record<string, unknown>)['statSync'] = realStat;
      syncBuiltinESMExports();
    }
    assert.deepEqual(resolveEntry({ dist, src, srcRoot }), { target: src, reason: 'stale-dist' }, 'fixture: the hidden source is newer once readable');
  });

  it('both bin entries run the sources when the build is older than a source file and the build when it is newer; AIDLC_ENTRY_DEBUG=1 prints the choice once', () => {
    // A package laid out in a temp dir: both entries and the resolver as shipped, a compiled build and sources that each print which one ran.
    const pkg = path.join(dir, 'pkg');
    for (const sub of ['bin', 'dist/cli', 'dist/hooks', 'src/cli', 'src/hooks']) mkdirSync(path.join(pkg, sub), { recursive: true });
    for (const entry of ['aidlc.js', 'aidlc-hook.js', 'resolve-entry.js']) {
      if (entry === 'resolve-entry.js' && !fs.existsSync(path.join(repoRoot, 'bin', entry))) continue;
      copyFileSync(path.join(repoRoot, 'bin', entry), path.join(pkg, 'bin', entry));
    }
    const printing = (what: string) => `export async function main() { process.stdout.write(${JSON.stringify(what)}); }\n`;
    const files = {
      distCli: path.join(pkg, 'dist', 'cli', 'main.js'),
      distHook: path.join(pkg, 'dist', 'hooks', 'entry.js'),
      srcCli: path.join(pkg, 'src', 'cli', 'main.ts'),
      srcHook: path.join(pkg, 'src', 'hooks', 'entry.ts'),
      other: path.join(pkg, 'src', 'other.ts'),
    };
    writeFileSync(files.distCli, printing('dist:cli'), 'utf8');
    writeFileSync(files.distHook, printing('dist:hook'), 'utf8');
    writeFileSync(files.srcCli, printing('src:cli'), 'utf8');
    writeFileSync(files.srcHook, printing('src:hook'), 'utf8');
    writeFileSync(files.other, 'export const other = 1;\n', 'utf8');
    const stamp = (build: string, source: string) => {
      for (const f of [files.distCli, files.distHook]) at(f, build);
      for (const f of [files.srcCli, files.srcHook]) at(f, '2026-09-01T00:00:00Z');
      at(files.other, source);
    };
    const run = (entry: string, env: Record<string, string> = {}) => spawnSync(process.execPath, [path.join(pkg, 'bin', entry)], { cwd: pkg, encoding: 'utf8', input: '', env: { ...process.env, ...env } });
    // The build is older than one source file: the sources run, for both entries.
    stamp('2026-09-02T00:00:00Z', '2026-09-03T00:00:00Z');
    let cli = run('aidlc.js');
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, 'src:cli', 'the CLI entry runs the sources over a stale build');
    let hook = run('aidlc-hook.js');
    assert.equal(hook.status, 0, hook.stderr);
    assert.equal(hook.stdout, 'src:hook', 'the hook entry runs the sources over a stale build');
    // The build is newer than every source file: the build runs, and the debug line names it once.
    stamp('2026-09-04T00:00:00Z', '2026-09-03T00:00:00Z');
    cli = run('aidlc.js', { AIDLC_ENTRY_DEBUG: '1' });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(cli.stdout, 'dist:cli', 'the CLI entry runs a current build');
    const lines = cli.stderr.split(/\r?\n/).filter((l) => l.startsWith('[aidlc entry]'));
    assert.equal(lines.length, 1, `one debug line: ${cli.stderr}`);
    assert.match(lines[0]!, /reason=dist/);
    assert.match(lines[0]!, /target=.*main\.js/);
    hook = run('aidlc-hook.js', { AIDLC_ENTRY_DEBUG: '1' });
    assert.equal(hook.stdout, 'dist:hook', 'the hook entry runs a current build');
    const hookLines = hook.stderr.split(/\r?\n/).filter((l) => l.startsWith('[aidlc entry]'));
    assert.equal(hookLines.length, 1, `one debug line from the hook entry: ${hook.stderr}`);
    assert.match(hookLines[0]!, /reason=dist/);
    assert.match(hookLines[0]!, /target=.*entry\.js/);
    const quiet = run('aidlc-hook.js');
    assert.equal(quiet.stderr.split(/\r?\n/).filter((l) => l.startsWith('[aidlc entry]')).length, 0, 'without the variable the hook entry prints nothing');
    // Both entries share the resolver.
    for (const entry of ['aidlc.js', 'aidlc-hook.js']) {
      const text = readFileSync(path.join(repoRoot, 'bin', entry), 'utf8');
      assert.match(text, /from '\.\/resolve-entry\.js'/, `${entry} imports the shared resolver`);
    }
  });
});
