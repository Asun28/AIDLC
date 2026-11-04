/**
 * Command execution with receipts (plan v5 §5 "Evidence and probes").
 *
 * Every probe records the actual command, exit code, output digest and environment binding.
 * "Check command exits before parsing. Errors are not empty results."
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  input?: string;
  /** Use a shell (needed for compound commands); default false. */
  shell?: boolean;
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

export const runSync: SyncRunner = (command, args, options = {}) => {
  const startedAt = new Date();
  const shell = needsShell(command, options.shell);
  const res = spawnSync(command, shell ? args.map(quoteForShell) : args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    timeout: options.timeoutMs,
    input: options.input,
    shell,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
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
 * Builds the async runner around a tree kill. At `timeoutMs` a root still running is ended with its
 * tree (a root whose exit was observed is never killed: its pid may belong to another process now),
 * stdout and stderr are destroyed, and the receipt resolves on the close event or, at the latest,
 * TIMEOUT_GRACE_MS after the tree kill returns, with the exit the system reported by then.
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
    let stdout = '';
    let stderr = '';
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
      resolve({
        command,
        args,
        cwd: options.cwd ?? process.cwd(),
        exitCode: code,
        signal,
        timedOut,
        stdout,
        stderr,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        outputSha256: digest(stdout, stderr),
      });
    };
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
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
          // Release every handle on the child: stdout and stderr went at the timeout, a pending write
          // of an input the surviving root never reads holds stdin, child.unref() the process handle,
          // and finish clears both timers.
          child.stdin.destroy();
          child.unref();
          finish(exitCode, exitSignal);
        }, TIMEOUT_GRACE_MS);
      }, options.timeoutMs);
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (stdout += d));
    child.stderr.on('data', (d: string) => (stderr += d));
    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err.message}`;
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
