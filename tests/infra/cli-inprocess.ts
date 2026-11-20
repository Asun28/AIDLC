import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import childProcess, { type SpawnSyncOptions, type SpawnSyncReturns, type StdioOptions } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { main } from '../../src/cli/main.ts';
import { currentActor, setActorForTests } from '../../src/state/journal.ts';
import { resetRepoIdentityForTests } from '../../src/state/paths.ts';

/** Thrown by the replaced `process.exit` to end `main` where the child process would end. */
class ExitSignal {
  readonly code: number | string | null | undefined;
  constructor(code: number | string | null | undefined) {
    this.code = code;
  }
}

let running = false;

/** Marks the asynchronous work of the current call: a write from outside it (the test runner's own report) passes through. */
const call = new AsyncLocalStorage<symbol>();

const asStatus = (code: number | string | null | undefined): number | undefined => (code === undefined || code === null ? undefined : Number(code));

/** A writer that collects what `main` writes in the call `token` marks, as a stream's `write` would accept it, and hands any other write to `original`. */
function collector(into: string[], original: typeof process.stdout.write, stream: NodeJS.WriteStream, token: symbol): typeof process.stdout.write {
  return ((chunk: string | Uint8Array, encoding?: BufferEncoding | ((err?: Error | null) => void), callback?: (err?: Error | null) => void): boolean => {
    if (call.getStore() !== token) return (original as (...args: unknown[]) => boolean).call(stream, chunk, encoding, callback);
    into.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    const done = typeof encoding === 'function' ? encoding : callback;
    if (done) queueMicrotask(() => done(null));
    return true;
  }) as typeof process.stdout.write;
}

/** `fs.writeSync` with a write to file descriptor 1 or 2 made in the call `token` marks collected into `out` or `err`. */
function syncWriter(original: typeof fs.writeSync, out: string[], err: string[], token: symbol): typeof fs.writeSync {
  return ((fd: number, data: string | NodeJS.ArrayBufferView, ...rest: unknown[]): number => {
    const into = fd === 1 ? out : fd === 2 ? err : undefined;
    if (!into || call.getStore() !== token) return (original as (...args: unknown[]) => number)(fd, data, ...rest);
    // Offset and length arguments of a buffer write are not read: src/ writes only strings to fd 1 and 2.
    const text = typeof data === 'string' ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
    into.push(text);
    return Buffer.byteLength(text);
  }) as typeof fs.writeSync;
}

/**
 * `child_process.spawnSync` with standard output and error inherited by the child, in the call `token` marks, read
 * through pipes into `out` and `err`, and an inherited standard input fed `input`: a child of bin/aidlc.js writes them
 * to the pipes spawnSync gave bin/aidlc.js and reads the same input.
 */
function syncSpawner(original: typeof childProcess.spawnSync, out: string[], err: string[], input: string, token: symbol): typeof childProcess.spawnSync {
  return ((command: string, argsOrOptions?: readonly string[] | SpawnSyncOptions, maybeOptions?: SpawnSyncOptions): SpawnSyncReturns<string | Buffer> => {
    const args = Array.isArray(argsOrOptions) ? (argsOrOptions as readonly string[]) : [];
    const options = (Array.isArray(argsOrOptions) ? maybeOptions : (argsOrOptions as SpawnSyncOptions | undefined)) ?? {};
    const given: StdioOptions = options.stdio ?? 'pipe';
    const stdio = typeof given === 'string' ? [given, given, given] : [...given];
    const inherited = [0, 1, 2].map((i) => stdio[i] === 'inherit');
    if (call.getStore() !== token || !inherited.some(Boolean)) return original(command, args, options);
    for (const i of [0, 1, 2]) if (inherited[i]) stdio[i] = 'pipe';
    const r = original(command, args, { ...options, stdio, ...(inherited[0] ? { input } : {}), ...(options.maxBuffer === undefined ? { maxBuffer: Infinity } : {}) });
    const text = (b: string | Buffer | null | undefined) => (b === null || b === undefined ? '' : typeof b === 'string' ? b : b.toString('utf8'));
    if (inherited[1]) out.push(text(r.stdout));
    if (inherited[2]) err.push(text(r.stderr));
    return r;
  }) as typeof childProcess.spawnSync;
}

/**
 * The actor `currentActor` caches for the caller, undefined when none is cached. With none
 * cached, `currentActor` returns and caches an actor of the session it is given: a fresh random one, so no session a
 * caller can hold is mistaken for it.
 */
function cachedActor(): ReturnType<typeof currentActor> | undefined {
  const probe = randomUUID();
  const actor = currentActor({ AIDLC_SESSION: probe });
  // An actor cached here for the probe is dropped by the reset before the call.
  return actor.session === probe ? undefined : actor;
}

/**
 * The environment a child started with `env` receives, as Node's `normalizeSpawnArguments` (lib/child_process.js) builds
 * it: every enumerable key, inherited ones included; on win32 the keys sorted and only the first of those equal apart
 * from case kept; then a key whose value is undefined left out.
 */
function childEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  let keys: string[] = [];
  for (const key in env) keys.push(key);
  if (process.platform === 'win32') {
    const seen = new Set<string>();
    keys = keys.sort().filter((key) => {
      const upper = key.toUpperCase();
      if (seen.has(upper)) return false;
      seen.add(upper);
      return true;
    });
  }
  // No prototype: a key named `__proto__` is an ordinary entry, as an own `__proto__` of `env` is for Node.
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of keys) {
    const value = env[key];
    if (value !== undefined) out[key] = String(value);
  }
  return out;
}

function replaceEnv(next: Record<string, string>): void {
  for (const key of Object.keys(process.env)) if (!Object.hasOwn(next, key)) delete process.env[key];
  for (const [key, value] of Object.entries(next)) process.env[key] = value;
}

/**
 * Runs `main` of `src/cli/main.ts` in this process with `cwd` and `env` (default `process.env`) for the call and `input`
 * as standard input, and returns the exit status, stdout and stderr that `bin/aidlc.js` in a child process returns.
 * cwd, env, exitCode, `process.exit`, `process.stdin` and the stdout and stderr writers are restored after every call.
 * Each call starts with no cached session actor and no cached repository identity, and the caller's actor is restored
 * after it. The exit listeners a call adds run inside it, in order, as the child runs them when it exits, and are
 * removed. Output written past the stream methods (`fs.writeSync` to fd 1 or 2, `spawnSync` with inherited stdio) is
 * collected with the rest. Calls do not nest: one made while another runs rejects.
 */
export async function runCliInProcess(argv: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; input?: string }): Promise<{ status: number; stdout: string; stderr: string }> {
  if (running) throw new Error('runCliInProcess: a call is already running; await it before the next call');
  running = true;
  // Released whatever throws, the reading of `options.env` included; the inner `finally` restores what was swapped.
  try {
    return await runOnce(argv, options);
  } finally {
    running = false;
  }
}

async function runOnce(argv: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; input?: string }): Promise<{ status: number; stdout: string; stderr: string }> {
  const env = childEnv(options.env ?? process.env);
  const saved = {
    cwd: process.cwd(),
    env: childEnv(process.env),
    exitCode: process.exitCode,
    exit: process.exit,
    stdoutWrite: process.stdout.write,
    stderrWrite: process.stderr.write,
    stdin: Object.getOwnPropertyDescriptor(process, 'stdin'),
    stdoutTTY: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
    actor: cachedActor(),
    exitListeners: process.rawListeners('exit'),
    writeSync: fs.writeSync,
    spawnSync: childProcess.spawnSync,
  };
  const token = Symbol('runCliInProcess call');
  const out: string[] = [];
  const err: string[] = [];
  let status: number;
  try {
    replaceEnv(env);
    process.chdir(options.cwd);
    process.exitCode = undefined;
    process.exit = ((code?: number | string | null) => {
      throw new ExitSignal(code);
    }) as typeof process.exit;
    process.stdout.write = collector(out, saved.stdoutWrite, process.stdout, token);
    process.stderr.write = collector(err, saved.stderrWrite, process.stderr, token);
    // A child started by spawnSync has a pipe for stdout, never a terminal.
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true, writable: true, enumerable: true });
    // A child started by spawnSync reads `input` from a pipe that then ends; with no input the pipe ends at once.
    const stdin = new Readable({ read() {} });
    if (options.input) stdin.push(Buffer.from(options.input, 'utf8'));
    stdin.push(null);
    Object.defineProperty(process, 'stdin', { value: stdin, configurable: true, writable: true, enumerable: true });
    fs.writeSync = syncWriter(saved.writeSync, out, err, token);
    childProcess.spawnSync = syncSpawner(saved.spawnSync, out, err, options.input ?? '', token);
    syncBuiltinESMExports();
    setActorForTests(undefined);
    resetRepoIdentityForTests();
    try {
      await call.run(token, () => main(['node', 'aidlc', ...argv]));
      status = asStatus(process.exitCode) ?? 0;
    } catch (error) {
      if (error instanceof ExitSignal) status = asStatus(error.code) ?? asStatus(process.exitCode) ?? 0;
      else {
        // As bin/aidlc.js prints a rejection of `main`.
        const message = error instanceof Error ? error.message : String(error);
        err.push(`aidlc: ${message.split(/\r\n|\r|\n/).map((l) => l.trim()).filter((l) => l !== '').join(' | ')}\n`);
        status = 1;
      }
    }
    // The child runs its exit listeners when it ends, in registration order; each added here runs once, inside the call.
    const added = process.rawListeners('exit').filter((l) => !saved.exitListeners.includes(l));
    for (const listener of added) process.removeListener('exit', listener as (code: number) => void);
    const exitCode = status;
    await call.run(token, () => {
      for (const listener of added) listener.call(process, exitCode);
    });
  } finally {
    fs.writeSync = saved.writeSync;
    childProcess.spawnSync = saved.spawnSync;
    syncBuiltinESMExports();
    setActorForTests(saved.actor);
    resetRepoIdentityForTests();
    if (saved.stdin) Object.defineProperty(process, 'stdin', saved.stdin);
    if (saved.stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', saved.stdoutTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    process.stdout.write = saved.stdoutWrite;
    process.stderr.write = saved.stderrWrite;
    process.exit = saved.exit;
    process.exitCode = saved.exitCode;
    process.chdir(saved.cwd);
    replaceEnv(saved.env);
  }
  return { status, stdout: out.join(''), stderr: err.join('') };
}
