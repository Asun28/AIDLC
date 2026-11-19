import { AsyncLocalStorage } from 'node:async_hooks';
import { Readable } from 'node:stream';
import { main } from '../../src/cli/main.ts';

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

function replaceEnv(next: NodeJS.ProcessEnv): void {
  // A key given as undefined is left out, as spawnSync leaves it out of a child's environment.
  for (const key of Object.keys(process.env)) if (next[key] === undefined) delete process.env[key];
  for (const [key, value] of Object.entries(next)) if (value !== undefined) process.env[key] = value;
}

/**
 * Runs `main` of `src/cli/main.ts` in this process with `cwd` and `env` (default `process.env`) for the call and `input`
 * as standard input, and returns the exit status, stdout and stderr that `bin/aidlc.js` in a child process returns.
 * cwd, env, exitCode, `process.exit`, `process.stdin` and the stdout and stderr writers are restored after every call.
 * Calls do not nest: one made while another runs rejects.
 */
export async function runCliInProcess(argv: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; input?: string }): Promise<{ status: number; stdout: string; stderr: string }> {
  if (running) throw new Error('runCliInProcess: a call is already running; await it before the next call');
  running = true;
  const env = { ...(options.env ?? process.env) };
  const saved = {
    cwd: process.cwd(),
    env: { ...process.env },
    exitCode: process.exitCode,
    exit: process.exit,
    stdoutWrite: process.stdout.write,
    stderrWrite: process.stderr.write,
    stdin: Object.getOwnPropertyDescriptor(process, 'stdin'),
    stdoutTTY: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
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
  } finally {
    if (saved.stdin) Object.defineProperty(process, 'stdin', saved.stdin);
    if (saved.stdoutTTY) Object.defineProperty(process.stdout, 'isTTY', saved.stdoutTTY);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
    process.stdout.write = saved.stdoutWrite;
    process.stderr.write = saved.stderrWrite;
    process.exit = saved.exit;
    process.exitCode = saved.exitCode;
    process.chdir(saved.cwd);
    replaceEnv(saved.env);
    running = false;
  }
  return { status, stdout: out.join(''), stderr: err.join('') };
}
