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
/** Ends the process tree rooted at a pid. */
export type TreeKill = (pid: number) => void;

/** How long a timed-out receipt waits for the child's close event after the timeout or the tree kill. */
export const TIMEOUT_GRACE_MS = 2000;

/** Ends the process tree rooted at `pid` (seam: today ends the root alone). */
export function killProcessTree(pid: number, _platform: NodeJS.Platform, _runner: SyncRunner, killer: ProcessKiller, _env: NodeJS.ProcessEnv = process.env): void {
  try {
    killer(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

/** Builds the async runner around a tree kill (seam: today the tree kill is not used). */
export const createRun = (_treeKill: TreeKill): Runner => (command, args, options = {}) =>
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
    let timer: NodeJS.Timeout | undefined;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);
    }
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (stdout += d));
    child.stderr.on('data', (d: string) => (stderr += d));
    child.on('error', (err) => {
      stderr += `\n[spawn error] ${err.message}`;
    });
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
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
    });
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
