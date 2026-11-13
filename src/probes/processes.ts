/**
 * Stray processes for `aidlc doctor` (card T0-DOCTOR-STRAY-PROCESSES-2): one bounded process listing, Windows PowerShell
 * `Get-CimInstance Win32_Process` on win32 and `ps` elsewhere, read into rows, and the processes under the main checkout or
 * the card worktree root that are at least 30 minutes old and have used at least half of that age in CPU time. The module
 * only reads: it ends no process, and the runner alone cancels the listing at its timeout or output bound.
 */
import path from 'node:path';
import { resolveWorktreeRoot, type ProjectConfig } from '../config.ts';
import type { ExecReceipt, Runner } from './exec.ts';

/** How long the one process listing may run before the runner requests its cancellation. */
export const PROCESS_LIST_TIMEOUT_MS = 10_000;
/** The byte bound of the listing's output (16 MiB). */
export const PROCESS_LIST_MAX_BUFFER = 16 * 1024 * 1024;
/** The least age of a stray process. */
export const STRAY_AGE_MS = 30 * 60 * 1000;
/** The least share of its age a stray process has used in CPU time. */
export const STRAY_CPU_RATIO = 0.5;
/** The most entries the value lists. */
export const STRAY_MAX_ENTRIES = 20;

export interface ProcessRow {
  pid: number;
  ppid: number;
  /** Epoch milliseconds, or null when the listing gives none. */
  startMs: number | null;
  /** CPU time of the process itself, its children excluded. */
  cpuMs: number;
  command: string;
}

/** `none`, the entries and the sentence, `unknown: <reason>` or an `n/a` value. */
export type StrayValue = string | string[];

export interface StrayInput {
  isGit: boolean;
  /** An absolute path for `platform`. */
  mainRoot: string;
  config: ProjectConfig;
  runner: Runner;
  /** An ISO timestamp, read before the listing starts. */
  now: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  self?: number;
  cwd?: string;
}

/** The Windows listing: no `"` and no `\`, so Node's quoting of an argument leaves it whole. */
const CIM_SCRIPT = "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-CimInstance -ClassName Win32_Process | ForEach-Object { [ordered]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; start = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null }; cpu = [long][math]::Floor(($_.UserModeTime + $_.KernelModeTime) / 10000); cmd = $_.CommandLine } } | ConvertTo-Json -Compress } catch { exit 1 }";
const PS_ARGS = ['-A', '-ww', '-o', 'pid=', '-o', 'ppid=', '-o', 'etime=', '-o', 'time=', '-o', 'args='];
const PS_LINE = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/s;
const PS_TIME = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)(?:[.,](\d+))?$/;

const UNREADABLE = 'unknown: the process listing could not be read';
const NO_EXIT = 'unknown: the process listing failed (no exit code)';
/** The last string of every list value. */
const STRAY_SENTENCE = 'Not a failure and no reason to stop: name these processes to the user in your next report. End one only if this session started it, after checking that the pid is still that process.';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSafe = (v: unknown): v is number => Number.isSafeInteger(v);
const isCount = (v: unknown): v is number => isSafe(v) && v >= 0;

/** The rows of a Windows listing, or undefined when R2 refuses it. */
function parseCim(stdout: string): ProcessRow[] | undefined {
  const text = stdout.startsWith('\uFEFF') ? stdout.slice(1) : stdout;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  // ConvertTo-Json prints one object, not an array, when there is one process.
  const items = Array.isArray(parsed) ? (parsed as unknown[]) : isRecord(parsed) ? [parsed] : undefined;
  if (!items) return undefined;
  const rows: ProcessRow[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    if (!isRecord(item)) return undefined;
    // A missing member reads as undefined, which no member type accepts.
    const { pid, ppid, start, cpu, cmd } = item;
    if (!isCount(pid) || !isCount(ppid)) return undefined;
    const startMs = start === null ? null : isSafe(start) ? start : undefined;
    const cpuMs = cpu === null ? 0 : isCount(cpu) ? cpu : undefined;
    const command = cmd === null ? '' : typeof cmd === 'string' ? cmd : undefined;
    if (startMs === undefined || cpuMs === undefined || command === undefined || seen.has(pid)) return undefined;
    seen.add(pid);
    rows.push({ pid, ppid, startMs, cpuMs, command });
  }
  return rows;
}

/** A `ps` elapsed or CPU time in milliseconds, or undefined when it does not match or is not finite. */
function duration(text: string): number | undefined {
  const m = PS_TIME.exec(text);
  if (!m) return undefined;
  // Every digit of the fraction counts: whole milliseconds from the first three, the rest as a fraction of one.
  const digits = m[5] ?? '';
  const fraction = Number(`${digits}000`.slice(0, 3)) + (digits.length > 3 ? Number(`0.${digits.slice(3)}`) : 0);
  const ms = Number(m[1] ?? 0) * 86_400_000 + Number(m[2] ?? 0) * 3_600_000 + Number(m[3]) * 60_000 + Number(m[4]) * 1000 + fraction;
  return Number.isFinite(ms) ? ms : undefined;
}

/** The rows of a `ps` listing, or undefined when R3 refuses it. */
function parsePs(stdout: string, nowMs: number): ProcessRow[] | undefined {
  const rows: ProcessRow[] = [];
  const seen = new Set<number>();
  for (const raw of stdout.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.trim() === '') continue;
    const m = PS_LINE.exec(line);
    if (!m) return undefined;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const elapsedMs = duration(m[3]!);
    const cpuMs = duration(m[4]!);
    if (!isSafe(pid) || !isSafe(ppid) || elapsedMs === undefined || cpuMs === undefined) return undefined;
    const startMs = nowMs - elapsedMs;
    if (!Number.isFinite(startMs) || seen.has(pid)) return undefined;
    seen.add(pid);
    rows.push({ pid, ppid, startMs, cpuMs, command: m[5] ?? '' });
  }
  return rows.length > 0 ? rows : undefined;
}

/**
 * Runs the one process listing through `runner` and reads it: the rows, or an `unknown: <reason>` string. Never rejects.
 * The runner requests cancellation after PROCESS_LIST_TIMEOUT_MS or past PROCESS_LIST_MAX_BUFFER bytes of output.
 */
export async function listProcesses(runner: Runner, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, nowMs: number): Promise<ProcessRow[] | string> {
  try {
    const win = platform === 'win32';
    // The SystemRoot expression of killProcessTree (src/probes/exec.ts).
    const command = win ? `${(env['SystemRoot'] || env['windir'] || 'C:\\Windows').replace(/[\\/]+$/, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'ps';
    const args = win ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', CIM_SCRIPT] : [...PS_ARGS];
    let receipt: ExecReceipt;
    try {
      receipt = await runner(command, args, { timeoutMs: PROCESS_LIST_TIMEOUT_MS, maxBuffer: PROCESS_LIST_MAX_BUFFER, shell: false });
    } catch {
      return NO_EXIT;
    }
    if (receipt.timedOut) return `unknown: the process listing timed out after ${PROCESS_LIST_TIMEOUT_MS} ms`;
    if (receipt.exitCode !== 0) return receipt.exitCode === null ? NO_EXIT : `unknown: the process listing failed (exit ${receipt.exitCode})`;
    // Standard error is never read.
    return (win ? parseCim(receipt.stdout) : parsePs(receipt.stdout, nowMs)) ?? UNREADABLE;
  } catch {
    return UNREADABLE;
  }
}

/** A name character: a Unicode letter or number, `.`, `_` or `-`; undefined (the start or end of the text) is none. */
const NAME = /^[\p{L}\p{N}._-]$/u;
const isName = (cp: number | undefined): boolean => cp !== undefined && NAME.test(String.fromCodePoint(cp));

/** Every run of `\` and `/` made one `/`, lower-cased on win32. */
function normalize(text: string, platform: NodeJS.Platform): string {
  const joined = text.replace(/[\\/]+/g, '/');
  return platform === 'win32' ? joined.toLowerCase() : joined;
}

/** The code point that ends just before index `i`. */
function codePointBefore(text: string, i: number): number | undefined {
  if (i <= 0) return undefined;
  const low = text.charCodeAt(i - 1);
  if (low >= 0xdc00 && low <= 0xdfff && i >= 2) {
    const high = text.charCodeAt(i - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.codePointAt(i - 2);
  }
  return low;
}

interface Root {
  /** As R5 resolved it; printed in the entry. */
  shown: string;
  prefixes: string[];
}

/** The prefixes of a root, or undefined for a filesystem root (`D:\`, `/`, `\\srv\share`), which would match every path on it. */
function rootOf(shown: string, platform: NodeJS.Platform): Root | undefined {
  // A filesystem root is the root the platform's path module parses, its trailing separators set aside.
  const trailing = platform === 'win32' ? /[\\/]+$/ : /\/+$/;
  const bare = shown.replace(trailing, '');
  if ((platform === 'win32' ? path.win32 : path.posix).parse(shown).root.replace(trailing, '') === bare) return undefined;
  const norm = normalize(shown, platform).replace(/\/$/, '');
  const drive = platform === 'win32' ? /^([a-z]):\/(.+)$/.exec(norm) : null;
  // The drive form, the Git Bash form and the WSL form.
  return { shown, prefixes: drive ? [norm, `/${drive[1]}/${drive[2]}`, `/mnt/${drive[1]}/${drive[2]}`] : [norm] };
}

interface Match {
  start: number;
  length: number;
  root: Root;
  segment: string;
}

/** The run of name characters from `from`, cut to 60 code points. */
function segmentAt(text: string, from: number): string {
  const cps: string[] = [];
  for (const ch of text.slice(from)) {
    if (cps.length === 60 || !isName(ch.codePointAt(0))) break;
    cps.push(ch);
  }
  return cps.join('');
}

/** The match in one command line: every occurrence of every prefix between two non-name code points; the smallest start, then the longer prefix. */
function matchIn(command: string, roots: Root[], platform: NodeJS.Platform): Match | undefined {
  const text = normalize(command, platform);
  let best: Match | undefined;
  for (const root of roots) {
    for (const prefix of root.prefixes) {
      for (let at = text.indexOf(prefix); at >= 0; at = text.indexOf(prefix, at + 1)) {
        const end = at + prefix.length;
        if (isName(codePointBefore(text, at)) || isName(text.codePointAt(end))) continue;
        if (best && (at > best.start || (at === best.start && prefix.length <= best.length))) continue;
        best = { start: at, length: prefix.length, root, segment: text[end] === '/' ? segmentAt(text, end + 1) : '' };
      }
    }
  }
  return best;
}

/**
 * The parents of `pid`, nearest first. The walk ends at a parent the listing does not show, at a process already visited
 * (a cycle) and at a parent that started strictly later than the current process (its pid was reused); an unknown start continues.
 */
function walk(pid: number, byPid: Map<number, ProcessRow>): number[] {
  const visited = new Set([pid]);
  const up: number[] = [];
  for (let current = byPid.get(pid); current !== undefined; ) {
    const next = byPid.get(current.ppid);
    if (!next || visited.has(next.pid)) break;
    if (current.startMs !== null && next.startMs !== null && next.startMs > current.startMs) break;
    visited.add(next.pid);
    up.push(next.pid);
    current = next;
  }
  return up;
}

/** The base name of the executable, the first word of the command line, cut to 60 code points; undefined when there is none. */
function executable(command: string): string | undefined {
  const text = command.replace(/^\s+/, '');
  if (text === '') return undefined;
  const word = text.startsWith('"') ? text.slice(1).split('"')[0]! : text.split(/\s/)[0]!;
  return Array.from(word.slice(Math.max(word.lastIndexOf('\\'), word.lastIndexOf('/')) + 1)).slice(0, 60).join('');
}

/**
 * The value of R9 for listed rows and resolved roots: `none`, or the entries of the stray processes under a root, largest CPU
 * time first and then by pid, at most STRAY_MAX_ENTRIES, `and <n> more`, then the sentence. Doctor's own chain (`self` and
 * the processes its walk reaches) and its descendants are never listed, and the chain's command lines do not count. When
 * `self` is not listed the listing was misread: `unknown: the process listing could not be read`.
 */
export function strayEntries(rows: ProcessRow[], options: { roots: string[]; self: number; platform: NodeJS.Platform; nowMs: number }): StrayValue {
  const { self, platform, nowMs } = options;
  const byPid = new Map(rows.map((row) => [row.pid, row] as const));
  if (!byPid.has(self)) return UNREADABLE;
  const chain = new Set([self, ...walk(self, byPid)]);
  const roots = options.roots.map((root) => rootOf(root, platform)).filter((root): root is Root => root !== undefined);
  const found: Array<{ row: ProcessRow; entry: string }> = [];
  for (const row of rows) {
    if (chain.has(row.pid)) continue;
    const up = walk(row.pid, byPid);
    if (up.includes(self) || row.startMs === null) continue;
    const ageMs = nowMs - row.startMs;
    if (ageMs < STRAY_AGE_MS || row.cpuMs < STRAY_CPU_RATIO * ageMs) continue;
    // Its own command line, then each parent's before the first process of doctor's chain.
    const stop = up.findIndex((pid) => chain.has(pid));
    const named = [row.pid, ...(stop < 0 ? up : up.slice(0, stop))];
    for (const [i, pid] of named.entries()) {
      const match = matchIn(byPid.get(pid)!.command, roots, platform);
      if (!match) continue;
      const exe = executable(row.command);
      const entry = `pid ${row.pid}, ${exe === undefined ? '(no command line)' : JSON.stringify(exe)}, age ${Math.floor(ageMs / 60_000)} min, cpu ${Math.floor(row.cpuMs / 60_000)} min, under ${match.root.shown}${match.segment ? `, folder ${match.segment}` : ''}${i > 0 ? ', through an ancestor' : ''}`;
      found.push({ row, entry });
      break;
    }
  }
  if (found.length === 0) return 'none';
  found.sort((a, b) => b.row.cpuMs - a.row.cpuMs || a.row.pid - b.row.pid);
  const entries = found.slice(0, STRAY_MAX_ENTRIES).map((f) => f.entry);
  if (found.length > STRAY_MAX_ENTRIES) entries.push(`and ${found.length - STRAY_MAX_ENTRIES} more`);
  return [...entries, STRAY_SENTENCE];
}

/**
 * Doctor's `strayProcesses` value. Platform, environment, pid and directory default to the calling process. Outside a git
 * repository, or with no usable root, no listing runs. Never rejects: any error it catches gives
 * `unknown: the process listing could not be read`.
 */
export async function strayProcessesReport(input: StrayInput): Promise<StrayValue> {
  try {
    const platform = input.platform ?? process.platform;
    // process.env itself: on Windows it finds a name whatever its letter case, and a copy does not.
    const env = input.env ?? process.env;
    const self = input.self ?? process.pid;
    const cwd = input.cwd ?? process.cwd();
    if (!input.isGit) return 'n/a (not a git repository)';
    const roots: string[] = [];
    if (rootOf(input.mainRoot, platform)) roots.push(input.mainRoot);
    let worktree: string | undefined;
    try {
      worktree = resolveWorktreeRoot(input.config, input.mainRoot, env, platform);
    } catch {
      // A main checkout at a filesystem root with an empty worktreeRoot: the worktree root is left out.
      worktree = undefined;
    }
    if (worktree !== undefined) {
      const p = platform === 'win32' ? path.win32 : path.posix;
      // An absolute root loses its trailing separators (`\` and `/` on win32, `/` elsewhere) unless it is a filesystem root.
      const trimmed = worktree.replace(platform === 'win32' ? /[\\/]+$/ : /\/+$/, '');
      const resolved = !p.isAbsolute(worktree) ? p.resolve(cwd, worktree) : p.parse(worktree).root === worktree ? worktree : trimmed;
      if (rootOf(resolved, platform)) roots.push(resolved);
    }
    if (roots.length === 0) return 'n/a (no usable root)';
    const nowMs = Date.parse(input.now);
    if (!Number.isFinite(nowMs)) return UNREADABLE;
    const rows = await listProcesses(input.runner, platform, env, nowMs);
    if (typeof rows === 'string') return rows;
    return strayEntries(rows, { roots, self, platform, nowMs });
  } catch {
    return UNREADABLE;
  }
}
