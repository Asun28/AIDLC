/**
 * Command execution with receipts (plan v5 §5 "Evidence and probes").
 *
 * Every probe records the actual command, exit code, output digest and environment binding.
 * "Check command exits before parsing. Errors are not empty results."
 */
import { spawn, spawnSync, type SpawnSyncOptionsWithBufferEncoding, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  /** Use a shell (needed for compound commands); default false. */
  shell?: boolean;
  /**
   * `runSync` only, with `timeoutMs`: run the command under `exec-tree-helper.ts`, which ends the
   * command's whole process tree at the timeout (card T0-EXEC-SYNC-TREE-KILL). A `timeoutMs` that is not a
   * whole number from 1 to 2 147 483 647 starts nothing and returns a `[tree helper error]` receipt.
   */
  killTree?: boolean;
  /**
   * Async runner only: once stdout and stderr together pass this many bytes the command's tree is ended
   * as at the timeout, and the receipt reports exit code null, signal SIGTERM and a `[spawn error] ...
   * ENOBUFS` line, as runSync's spawnSync reports its 64 MiB limit. The tree helper sets it to that limit.
   */
  maxBuffer?: number;
}

export interface ExecReceipt {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outputSha256: string;
}

export type Runner = (command: string, args: string[], options?: ExecOptions) => Promise<ExecReceipt>;
export type SyncRunner = (command: string, args: string[], options?: ExecOptions) => ExecReceipt;

function digest(stdout: string, stderr: string): string {
  return createHash('sha256').update(stdout).update('\u0000').update(stderr).digest('hex');
}

/**
 * Starts a process synchronously: `spawnSync` in production. A test seam: tests pass a recorder to
 * `createRunSync` to see how the command or the tree helper is started and to answer for it.
 */
export interface SpawnSyncFn {
  (command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding): SpawnSyncReturns<string>;
  (command: string, args: string[], options: SpawnSyncOptionsWithBufferEncoding): SpawnSyncReturns<Buffer>;
}

/**
 * The tree helper beside the exec module at `moduleUrl`, with that module's own extension (`.ts` from the
 * sources, `.js` from the build). Exported as a test seam; runSync passes its own module URL.
 */
export function treeHelperPath(moduleUrl: string): string {
  return fileURLToPath(new URL(`./exec-tree-helper${moduleUrl.endsWith('.ts') ? '.ts' : '.js'}`, moduleUrl));
}

/** How long past the command's `timeoutMs` and TIMEOUT_GRACE_MS `runSync` lets the tree helper run before it ends the helper. */
export const TREE_HELPER_BACKSTOP_MS = 15_000;

/**
 * The largest delay a Node timer keeps (2^31 - 1 ms, about 24.8 days); a larger one fires after 1 ms. A
 * `killTree` call with a longer, or not a whole positive, `timeoutMs` is refused before any spawn.
 */
const MAX_TIMER_MS = 2_147_483_647;

/** The direct runner's spawnSync `maxBuffer`: at most 64 MiB of stdout and stderr together. */
export const SYNC_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The tree helper's transport limit. The helper prints a one-line JSON header and then the command's stdout
 * and stderr as UTF-8 bytes, so no byte is escaped; a byte that is not valid UTF-8 decodes to U+FFFD, three
 * bytes, so the 64 MiB the direct runner accepts needs at most 3 x 64 MiB, plus 1 MiB for the header.
 */
const TREE_HELPER_MAX_BUFFER = 3 * SYNC_MAX_BUFFER + 1024 * 1024;

type HelperResult = Pick<ExecReceipt, 'exitCode' | 'signal' | 'timedOut' | 'stdout' | 'stderr'>;

const isByteCount = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/**
 * Decodes the tree helper's stdout: a JSON header line ({ exitCode, signal, timedOut, stdoutBytes,
 * stderrBytes }), then exactly `stdoutBytes` and `stderrBytes` bytes. Anything else (no header line, a header
 * that is not JSON or not a header, a body shorter or longer than the header says) is undefined, so a
 * truncated or malformed transport never yields a partial receipt.
 */
function decodeHelperOutput(out: Buffer): HelperResult | undefined {
  const eol = out.indexOf(0x0a);
  if (eol < 0) return undefined;
  let header: unknown;
  try {
    header = JSON.parse(out.subarray(0, eol).toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof header !== 'object' || header === null) return undefined;
  const h = header as Record<string, unknown>;
  const [exitCode, signal, timedOut, stdoutBytes, stderrBytes] = [h['exitCode'], h['signal'], h['timedOut'], h['stdoutBytes'], h['stderrBytes']];
  if (!(exitCode === null || Number.isInteger(exitCode)) || !(signal === null || typeof signal === 'string') || typeof timedOut !== 'boolean') return undefined;
  if (!isByteCount(stdoutBytes) || !isByteCount(stderrBytes) || out.length !== eol + 1 + stdoutBytes + stderrBytes) return undefined;
  const body = eol + 1;
  return {
    exitCode: exitCode as number | null,
    signal,
    timedOut,
    stdout: out.subarray(body, body + stdoutBytes).toString('utf8'),
    stderr: out.subarray(body + stdoutBytes).toString('utf8'),
  };
}

/**
 * Runs the command under the tree helper: node on `exec-tree-helper` with the caller's cwd and environment.
 * Its stdin is a JSON header line ({ command, args, timeoutMs, shell, inputBytes }, inputBytes only with an
 * input) followed by the input as UTF-8 bytes. The receipt is the command's own under the caller's command,
 * args and cwd, timed around the helper; a helper that exits non-zero or prints anything but one well-formed
 * transport gives exit code null and a `[tree helper error]`, timed out when the helper reached its backstop.
 */
function runInTreeHelper(spawner: SpawnSyncFn, command: string, args: string[], options: ExecOptions, timeoutMs: number): ExecReceipt {
  const startedAt = new Date();
  const backstopMs = timeoutMs + TIMEOUT_GRACE_MS + TREE_HELPER_BACKSTOP_MS;
  const input = options.input === undefined ? undefined : Buffer.from(options.input, 'utf8');
  const header = JSON.stringify({ command, args, timeoutMs, shell: options.shell, inputBytes: input?.length });
  const res = spawner(process.execPath, [treeHelperPath(import.meta.url)], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'buffer',
    timeout: backstopMs,
    input: Buffer.concat([Buffer.from(`${header}\n`, 'utf8'), ...(input ? [input] : [])]),
    shell: false,
    windowsHide: true,
    maxBuffer: TREE_HELPER_MAX_BUFFER,
  });
  const finishedAt = new Date();
  const decoded = res.status === 0 && res.stdout ? decodeHelperOutput(res.stdout) : undefined;
  let result: HelperResult;
  if (decoded) {
    result = decoded;
  } else {
    const timedOut = res.error !== undefined && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
    const how = timedOut ? ` (${res.signal}, backstop ${backstopMs} ms)` : res.signal ? ` (${res.signal})` : '';
    const spawnError = res.error && !timedOut ? `\n[spawn error] ${res.error.message}` : '';
    result = { exitCode: null, signal: res.signal ?? null, timedOut, stdout: '', stderr: `[tree helper error] exit ${res.status}${how}\n${res.stderr?.toString('utf8') ?? ''}${spawnError}` };
  }
  return {
    command,
    args,
    cwd: options.cwd ?? process.cwd(),
    ...result,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    outputSha256: digest(result.stdout, result.stderr),
  };
}

/** The refusal of a `killTree` call whose `timeoutMs` the helper cannot honour: nothing was started. */
function refuseTimeout(command: string, args: string[], options: ExecOptions, timeoutMs: number): ExecReceipt {
  const at = new Date().toISOString();
  const stderr = `[tree helper error] unsupported timeoutMs ${timeoutMs}: killTree needs a whole number from 1 to ${MAX_TIMER_MS}; nothing was started`;
  return { command, args, cwd: options.cwd ?? process.cwd(), exitCode: null, signal: null, timedOut: false, stdout: '', stderr, startedAt: at, finishedAt: at, durationMs: 0, outputSha256: digest('', stderr) };
}

/**
 * Builds the synchronous runner around a process starter; `runSync` is `createRunSync(spawnSync)`, and tests
 * use it as a seam with a recording starter. With `killTree` and `timeoutMs` the command runs under the tree
 * helper when `timeoutMs` is a whole number from 1 to 2 147 483 647, and any other `timeoutMs` starts
 * nothing, so a command that asked for tree cleanup never runs without it. Without either it is one spawn
 * of the command, whose timeout ends the root alone.
 */
export const createRunSync = (spawner: SpawnSyncFn): SyncRunner => (command, args, options = {}) => {
  if (options.killTree && options.timeoutMs !== undefined) {
    const { timeoutMs } = options;
    const supported = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= MAX_TIMER_MS;
    return supported ? runInTreeHelper(spawner, command, args, options, timeoutMs) : refuseTimeout(command, args, options, timeoutMs);
  }
  const startedAt = new Date();
  const shell = needsShell(command, options.shell);
  const res = spawner(command, shell ? args.map(quoteForShell) : args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    input: options.input,
    shell,
    windowsHide: true,
    maxBuffer: SYNC_MAX_BUFFER,
  });
  const finishedAt = new Date();
  const timedOut = res.error !== undefined && (res.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  const stderr = (res.stderr ?? '') + (res.error && !timedOut ? `\n[spawn error] ${res.error.message}` : '');
  return {
    command,
    args,
    cwd: options.cwd ?? process.cwd(),
    exitCode: res.status,
    signal: res.signal ?? null,
    timedOut,
    stdout: res.stdout ?? '',
    stderr,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    outputSha256: digest(res.stdout ?? '', stderr),
  };
};

export const runSync: SyncRunner = createRunSync(spawnSync);

/** Sends a signal to one process; `process.kill` in production, a recorder in tests. */
export type ProcessKiller = (pid: number, signal: NodeJS.Signals) => unknown;
/** Ends the process tree rooted at a live pid. */
export type TreeKill = (pid: number) => void;

/**
 * How long a timed-out receipt waits for the child's close event after the timeout or after the
 * tree kill returns, whichever is later; at that bound the receipt resolves whatever still holds
 * the command's stdout or stderr open (card T0-EXEC-TREE-KILL).
 */
export const TIMEOUT_GRACE_MS = 2000;
/** Timeout of each helper the tree kill runs (taskkill.exe, ps). */
const TREE_KILL_HELPER_TIMEOUT_MS = 10_000;

function sigkill(pid: number, killer: ProcessKiller): void {
  try {
    killer(pid, 'SIGKILL');
  } catch {
    /* ESRCH and the like: that process is gone or not ours; the others are still sent */
  }
}

/**
 * Ends the process tree rooted at the live `pid`. On Windows `%SystemRoot%\System32\taskkill.exe
 * /pid <pid> /T /F`, and SIGKILL to the root alone when taskkill cannot be started or exits non-zero.
 * Elsewhere one read of `ps -A -o pid= -o ppid=` and SIGKILL to the root and then to every process
 * whose parent chain in that table leads to it, or to the root alone when the table cannot be read.
 * Helpers run without a shell, each with a 10 000 ms timeout.
 */
export function killProcessTree(pid: number, platform: NodeJS.Platform, runner: SyncRunner, killer: ProcessKiller, env: NodeJS.ProcessEnv = process.env): void {
  if (platform === 'win32') {
    const systemRoot = (env['SystemRoot'] || env['windir'] || 'C:\\Windows').replace(/[\\/]+$/, '');
    const receipt = runner(`${systemRoot}\\System32\\taskkill.exe`, ['/pid', String(pid), '/T', '/F'], { timeoutMs: TREE_KILL_HELPER_TIMEOUT_MS, shell: false });
    if (!ok(receipt)) sigkill(pid, killer);
    return;
  }
  const table = runner('ps', ['-A', '-o', 'pid=', '-o', 'ppid='], { timeoutMs: TREE_KILL_HELPER_TIMEOUT_MS, shell: false });
  const children = new Map<number, number[]>();
  if (ok(table)) {
    for (const line of table.stdout.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
      if (!m) continue;
      const [child, parent] = [Number(m[1]), Number(m[2])];
      if (child === parent) continue;
      children.set(parent, [...(children.get(parent) ?? []), child]);
    }
  }
  // Breadth-first from the root over the one table read; a pid is visited once even if the table repeats it.
  const tree = [pid];
  const seen = new Set(tree);
  for (let i = 0; i < tree.length; i++) {
    for (const child of children.get(tree[i]!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      tree.push(child);
    }
  }
  for (const target of tree) sigkill(target, killer);
}

/**
 * Builds the async runner around a tree kill. At `timeoutMs`, or once stdout and stderr together pass
 * `maxBuffer` bytes, a root still running is ended with its tree (a root whose exit was observed is
 * never killed: its pid may belong to another process now), stdout and stderr are destroyed, and the
 * receipt resolves on the close event or, at the latest, TIMEOUT_GRACE_MS after the tree kill returns,
 * with the exit the system reported by then; an overflow reports exit code null, SIGTERM and ENOBUFS.
 */
export const createRun = (treeKill: TreeKill): Runner => (command, args, options = {}) =>
  new Promise<ExecReceipt>((resolve) => {
    const startedAt = new Date();
    const shell = needsShell(command, options.shell);
    const child = spawn(command, shell ? args.map(quoteForShell) : args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let notes = '';
    let bytes = 0;
    let overflowed = false;
    let stopping = false;
    let timedOut = false;
    let settled = false;
    let exited = false;
    let exitCode: number | null = null;
    let exitSignal: NodeJS.Signals | null = null;
    let timer: NodeJS.Timeout | undefined;
    let grace: NodeJS.Timeout | undefined;
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (grace) clearTimeout(grace);
      const finishedAt = new Date();
      // Decoded whole, as spawnSync decodes its output; an overflow is reported as spawnSync reports ENOBUFS.
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8') + notes + (overflowed ? `\n[spawn error] spawn ${command} ENOBUFS` : '');
      resolve({
        command,
        args,
        cwd: options.cwd ?? process.cwd(),
        exitCode: overflowed ? null : code,
        signal: overflowed ? 'SIGTERM' : signal,
        timedOut,
        stdout,
        stderr,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        outputSha256: digest(stdout, stderr),
      });
    };
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      if (!exited && child.pid !== undefined) {
        try {
          treeKill(child.pid);
        } catch {
          /* a failed tree kill still ends at the bound below */
        }
      }
      child.stdout.destroy();
      child.stderr.destroy();
      grace = setTimeout(() => {
        // Release every handle on the child: stdout and stderr went at the stop, a pending write
        // of an input the surviving root never reads holds stdin, child.unref() the process handle,
        // and finish clears both timers.
        child.stdin.destroy();
        child.unref();
        finish(exitCode, exitSignal);
      }, TIMEOUT_GRACE_MS);
    };
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        if (stopping) return;
        timedOut = true;
        stop();
      }, options.timeoutMs);
    }
    const collect = (into: Buffer[]) => (d: Buffer): void => {
      into.push(d);
      bytes += d.length;
      if (options.maxBuffer !== undefined && bytes > options.maxBuffer && !stopping) {
        overflowed = true;
        stop();
      }
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(err));
    child.on('error', (e) => {
      notes += `\n[spawn error] ${e.message}`;
    });
    child.on('exit', (code, signal) => {
      exited = true;
      exitCode = code;
      exitSignal = signal;
    });
    child.on('close', (code, signal) => finish(code, signal));
    child.stdin.on('error', () => {
      /* EPIPE: the child exited before reading its input; the close handler still resolves the receipt */
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });

export const run: Runner = createRun((pid) => killProcessTree(pid, process.platform, runSync, (p, signal) => process.kill(p, signal)));

/** A scripted runner for tests: map "command args..." to canned receipts. */
export function scriptedRunner(script: Record<string, Partial<ExecReceipt> | ((args: string[]) => Partial<ExecReceipt>)>): SyncRunner {
  return (command, args, options = {}) => {
    const key = [command, ...args].join(' ');
    const match = Object.keys(script).find((k) => key.startsWith(k));
    const now = new Date().toISOString();
    const base: ExecReceipt = { command, args, cwd: options.cwd ?? process.cwd(), exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '' };
    if (!match) return { ...base, exitCode: 127, stderr: `scripted runner: no entry for "${key}"`, outputSha256: digest('', `no entry for ${key}`) };
    const entry = script[match]!;
    const partial = typeof entry === 'function' ? entry(args) : entry;
    const merged = { ...base, ...partial };
    merged.outputSha256 = digest(merged.stdout, merged.stderr);
    return merged;
  };
}

export function ok(receipt: ExecReceipt): boolean {
  return receipt.exitCode === 0 && !receipt.timedOut;
}

/**
 * Node refuses to spawn `.cmd`/`.bat` wrappers (npm, npx, pnpm, yarn) without a shell on
 * Windows. Detect them so the caller's argv contract stays intact everywhere else.
 */
export function needsShell(command: string, explicit: boolean | undefined): boolean {
  if (explicit !== undefined) return explicit;
  if (process.platform !== 'win32') return false;
  return /^(npm|npx|pnpm|yarn|corepack|tsc|vitest|eslint|prettier)(\.cmd)?$/i.test(command) || /\.(cmd|bat)$/i.test(command);
}

function quoteForShell(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}
