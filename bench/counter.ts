// Bench preload (`node --import bench/counter.ts`): counts the deterministic work of one process and writes the counts
// as JSON at exit to the file AIDLC_BENCH_OUT names. Wall time moves between identical runs; these counts do not
// (docs/OPERATIONS.md, Loop benchmark). Card T0-LOOP-BENCH.
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';

// Captured before the wrapping below, so writing the counts is not counted.
const writeCounts = fs.writeFileSync;
const out = process.env['AIDLC_BENCH_OUT'];

/** The module that ends the bin freshness check: the hook dispatcher or the CLI, from dist/ or src/. */
const ENTRY = /\/(dist|src)\/(?:hooks\/entry|cli\/main)\.(?:js|ts)$/;

let entry: 'dist' | 'src' | 'none' = 'none';
let modules = 0;
let depBytes = 0;
let ownBytes = 0;
let beforeEntry = 0;
let afterEntry = 0;
let bytesBeforeEntry = 0;
let bytesAfterEntry = 0;
let spawns = 0;
const deps: Record<string, number> = {};

/**
 * Whether the function that called the wrapper is Node's own code: the module loader reading a package, or one fs
 * function calling another. Frame 0 is the message, frame 1 this function, frame 2 the wrapper, frame 3 its caller.
 */
function calledByNode(): boolean {
  const caller = new Error().stack?.split('\n')[3] ?? '';
  return /\(node:|at node:/.test(caller);
}

function byteLength(source: unknown): number {
  if (typeof source === 'string') return Buffer.byteLength(source);
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) return source.byteLength;
  return 0;
}

type Fn = (...args: unknown[]) => unknown;

function countFsCall(original: Fn, readsBytes: boolean): Fn {
  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const counted = !calledByNode();
    if (counted) {
      if (entry === 'none') beforeEntry++;
      else afterEntry++;
    }
    const result = original.apply(this, args);
    if (counted && readsBytes) {
      if (entry === 'none') bytesBeforeEntry += byteLength(result);
      else bytesAfterEntry += byteLength(result);
    }
    return result;
  };
  // `realpathSync.native` is a property of the function, and the code that canonicalises paths calls it: a
  // function property is counted like the function, any other property is kept as it is.
  const props = original as unknown as Record<string, unknown>;
  for (const key of Object.keys(props)) {
    const prop = props[key];
    (wrapped as unknown as Record<string, unknown>)[key] = typeof prop === 'function' ? countFsCall(prop as Fn, false) : prop;
  }
  return wrapped;
}

const fsTable = fs as unknown as Record<string, unknown>;
for (const name of Object.keys(fs)) {
  const original = fsTable[name];
  if (name.endsWith('Sync') && typeof original === 'function') fsTable[name] = countFsCall(original as Fn, name === 'readFileSync');
}

const cpTable = childProcess as unknown as Record<string, unknown>;
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  const original = cpTable[name] as (...a: unknown[]) => unknown;
  cpTable[name] = function (this: unknown, ...args: unknown[]): unknown {
    if (!calledByNode()) spawns++;
    return original.apply(this, args);
  };
}

// Named imports of node:fs and node:child_process read the wrappers only after this.
syncBuiltinESMExports();

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith('file:')) {
      modules++;
      const bytes = byteLength(result.source);
      const at = url.lastIndexOf('/node_modules/');
      if (at >= 0) {
        depBytes += bytes;
        const parts = url.slice(at + '/node_modules/'.length).split('/');
        const pkg = parts[0]?.startsWith('@') ? `${parts[0]}/${parts[1]}` : (parts[0] ?? '');
        deps[pkg] = (deps[pkg] ?? 0) + bytes;
      } else ownBytes += bytes;
      const hit = entry === 'none' ? ENTRY.exec(url) : null;
      if (hit) entry = hit[1] as 'dist' | 'src';
    }
    return result;
  },
});

process.on('exit', () => {
  if (!out) return;
  // A process that never loads an entry module has no freshness check: every call is its own work.
  const ran = entry !== 'none';
  const counts = {
    modules,
    depBytes,
    ownBytes,
    startFsCalls: ran ? beforeEntry : 0,
    fsCalls: ran ? afterEntry : beforeEntry,
    fsBytesRead: ran ? bytesAfterEntry : bytesBeforeEntry,
    spawns,
    entry,
    deps,
  };
  writeCounts(out, JSON.stringify(counts));
});
