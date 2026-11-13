/**
 * aidlc doctor strayProcesses (card T0-DOCTOR-STRAY-PROCESSES-2): the one bounded listing, its two parsers, the roots, the
 * matching, the parent walk, the stray rule, the printed form, the defaults, the one real listing, the doctor line and the
 * rule in CLAUDE.md, its template, the implementer agent and the documents.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { ProjectConfig } from '../../src/config.ts';
import { run, scriptedRunner, type ExecOptions, type ExecReceipt, type Runner } from '../../src/probes/exec.ts';
import { STRAY_AGE_MS, STRAY_CPU_RATIO, listProcesses, strayEntries, strayProcessesReport, type ProcessRow, type StrayInput, type StrayValue } from '../../src/probes/processes.ts';
import { cleanup, tmpDir } from './helpers.ts';

const repo = path.resolve(import.meta.dirname, '..', '..');
const NOW = '2026-09-11T10:00:00.000Z';
const T = Date.parse(NOW);
const MIN = 60_000;
const OLD = T - 31 * MIN;
const UNREADABLE = 'unknown: the process listing could not be read';
const OPTIONS = { timeoutMs: 10000, maxBuffer: 16777216, shell: false };
const POWERSHELL = '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const PS_ARGS = ['-A', '-ww', '-o', 'pid=', '-o', 'ppid=', '-o', 'etime=', '-o', 'time=', '-o', 'args='];

// The texts of the card's section Exact text, written out as literals.
const SCRIPT = "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; Get-CimInstance -ClassName Win32_Process | ForEach-Object { [ordered]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; start = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { $null }; cpu = [long][math]::Floor(($_.UserModeTime + $_.KernelModeTime) / 10000); cmd = $_.CommandLine } } | ConvertTo-Json -Compress } catch { exit 1 }";
const S = 'Not a failure and no reason to stop: name these processes to the user in your next report. End one only if this session started it, after checking that the pid is still that process.';
const H1 = [
  '- Never feed a script to an interpreter on standard input (`python -`, a',
  '  heredoc into `node`): write it to a file outside the worktree and run the',
  '  file.',
  '- Leave no process running: before you report, find any process you started',
  '  that has not ended, check it is that process, stop its tree by pid (never',
  '  by name) and name it in the report.',
];
const I1 = [
  '7. Do not feed a script to an interpreter on standard input; write it to a',
  '   file outside the worktree and run the file. Await a command you put in',
  '   the background. Leave no process running: when a command times out, or',
  '   one in the background has not ended when you report, find the process you',
  '   started, check it is that process, stop its tree by pid (never by name)',
  '   and name it in the report. Never end a process from an old pid or from a',
  '   doctor entry alone.',
];
const P1 = "Stray processes (card T0-DOCTOR-STRAY-PROCESSES-2): when doctor completes its checks it prints `strayProcesses`, the processes that run under the repository, whose age is at least 30 minutes and whose cumulative CPU time is at least half of their age; processes whose cumulative CPU time is below half their age are excluded, and current activity is not measured. Age comes from the start time in the listing and doctor's clock on Windows, and from the elapsed time `ps` reports elsewhere. Doctor reads them from one process listing, Windows PowerShell `Get-CimInstance Win32_Process` on Windows and `ps` elsewhere, started beside its other probes. Cancellation is requested after 10 seconds or when the output passes 16 MiB; the receipt resolves within 2 seconds after the tree cleanup returns; about 22 seconds assumes that the cleanup helper returns within its own timeout; termination is best effort. A process is under the repository when its own command line, or that of a process it descends from, names the main checkout or the card worktree root (`worktreeRoot` as `resolveWorktreeRoot` resolves it, a relative one against the process directory): both are compared after every run of `\\` and `/` is made one `/`, and on Windows after lower-casing, where a root with a drive letter also matches as `/d/...` and `/mnt/d/...`; the root must have, before and after it, the start or end of the text or a character other than a letter, a digit, `.`, `_` and `-`. These are chosen matching boundaries: a sibling directory whose name is the root's name followed by other punctuation (`AIDLC+old`, `AIDLC(1)`) is matched too. The chain of parents ends at a process the listing does not show, at a process it has already passed, at a parent that started after its child, and at the processes doctor descends from, whose command lines do not count. Doctor's own process, the processes it descends from and the processes it started are never listed, and neither is a process without a start time. The value is `none` when the listing was read and nothing is stray; or one entry per process, at most 20, largest CPU time first and then by process id, each `pid <pid>, <executable>, age <minutes> min, cpu <minutes> min, under <root>` with `, folder <segment>` for the path segment after the root and `, through an ancestor` when the match is in an ancestor's command line, then `and <n> more` when more are found, then the sentence `Not a failure and no reason to stop: name these processes to the user in your next report. End one only if this session started it, after checking that the pid is still that process.`; or `unknown: <reason>` when the listing fails, times out or cannot be read; or `n/a (not a git repository)` outside a git repository and `n/a (no usable root)` when neither root can be used, where no listing runs. No argument of any command line is printed, in the JSON or in the text. Not listed: a process that idles before it burns, until its CPU time reaches half its age (time asleep counts in age and not in CPU); a process inside WSL or a container, which the Windows listing does not show; a process whose command line the system does not give, such as an elevated one; a process started by relative paths from a shell whose directory is the checkout; and a process whose own command line names no root, once no process it descends from that names one is running. Doctor ends no process, and its own listing is cancelled at the timeout or at the output bound; the line never changes doctor's exit code. CLAUDE.md (Hard limits) and the installed implementer agent tell every session to write a script to a file and run the file instead of feeding it to an interpreter on standard input, and to leave no process running: on 2026-11-12 four `python -` processes left by implementer agents had each run at a full CPU core for 8.8 to 21.9 hours while doctor reported nothing about them.";
const A1 = "`processes.ts` gives `aidlc doctor` its `strayProcesses` line (`strayProcessesReport`): one bounded process listing, Windows PowerShell `Get-CimInstance Win32_Process` on Windows and `ps` elsewhere, and the processes under the main checkout or the card worktree root whose age (from the listed start time and doctor's clock on Windows, from the elapsed time `ps` reports elsewhere) is at least 30 minutes and whose cumulative CPU time is at least half of that age, printed without their arguments.";
const C1 = "- T0-DOCTOR-STRAY-PROCESSES-2 (bugfix, replaces T0-DOCTOR-STRAY-PROCESSES, ordered by the owner on 2026-11-12): when `aidlc doctor` completes its checks it prints `strayProcesses`: `none`; up to 20 processes, largest CPU time first, whose age is at least 30 minutes, whose cumulative CPU time is at least half of that age and whose own command line, or that of a process they descend from other than doctor's own chain, names the main checkout or the card worktree root, each with its pid, the base name of its executable, age, CPU time and the root it matched, never an argument, followed by the count of those not shown and a sentence that the list is not a failure and that a process is ended only by the session that started it; `unknown: <reason>` when the process listing (Windows PowerShell `Get-CimInstance Win32_Process` on Windows, `ps` elsewhere, run beside the other probes) fails, times out or cannot be read; `n/a (not a git repository)`; or `n/a (no usable root)`. Cancellation of the listing is requested after 10 seconds or past 16 MiB of output; the receipt resolves within 2 seconds after the tree cleanup returns, about 22 seconds in all when the cleanup helper keeps its own timeout; termination is best effort. Doctor ends no process and the line never changes its exit code. Before this card doctor did not enumerate process age, CPU time or command lines: on 2026-11-12 four `python -` processes left by implementer agents had each run at a full CPU core for 8.8 to 21.9 hours, and held their card worktrees open after `git worktree remove`, while doctor reported nothing about them. CLAUDE.md and `templates/CLAUDE.aidlc.md` (Hard limits) and the installed implementer agent now say not to feed a script to an interpreter on standard input and to leave no process running; `aidlc init` writes the two new lines into a repository that has no aidlc section, and a section a repository already has stays as it is.";

interface Call { command: string; args: string[]; options: ExecOptions | undefined }

/** A scripted listing: records each call and resolves a `scriptedRunner` receipt, which `finish` may change after it is built. */
function recorder(partial: Partial<ExecReceipt>, finish?: (receipt: ExecReceipt) => void): { runner: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const runner: Runner = async (command, args, options) => {
    calls.push({ command, args, options });
    const receipt = scriptedRunner({ [command]: partial })(command, args, options);
    finish?.(receipt);
    return receipt;
  };
  return { runner, calls };
}

// ---- Fixture W (win32)
type WinRow = Record<string, unknown>;
/** A Windows row: `cpu` is its age (a full core) unless given, and 0 when `start` is null. */
function w(pid: number, ppid: number, start: number | null, cmd: string | null, cpu?: number | null): WinRow {
  return { pid, ppid, start, cpu: cpu !== undefined ? cpu : start === null ? 0 : T - start, cmd };
}
const CLAUDE = w(3999, 1, T - 240 * MIN, '"C:\\Users\\u\\.local\\bin\\claude.exe" --x');
const DOCTOR = w(4000, 3999, T - 120 * MIN, '"C:\\Program Files\\nodejs\\node.exe" D:\\Projects\\AIDLC\\bin\\aidlc.js doctor');
const BASE = [CLAUDE, DOCTOR];
const W_ROOTS = ['D:\\Projects\\AIDLC', 'D:\\wt\\AIDLC'];

function winInput(runner: Runner, over: Partial<StrayInput> = {}): StrayInput {
  return { isGit: true, mainRoot: 'D:\\Projects\\AIDLC', config: ProjectConfig.parse({ worktreeRoot: 'D:\\wt\\AIDLC' }), runner, now: NOW, platform: 'win32', env: { SystemRoot: 'C:\\WINDOWS' }, self: 4000, cwd: 'D:\\Caller', ...over };
}
async function winReport(stdout: string, over: Partial<StrayInput> = {}, receipt: Partial<ExecReceipt> = {}): Promise<{ value: StrayValue; calls: Call[] }> {
  const r = recorder({ exitCode: 0, timedOut: false, stdout, ...receipt });
  return { value: await strayProcessesReport(winInput(r.runner, over)), calls: r.calls };
}
/** The value for the base rows plus `rows`. */
async function win(rows: WinRow[], over: Partial<StrayInput> = {}): Promise<StrayValue> {
  return (await winReport(JSON.stringify([...BASE, ...rows]), over)).value;
}
/** The value for one old, busy process under pid 3999 with the command line `cmd`. */
const winCmd = (cmd: string, over: Partial<StrayInput> = {}): Promise<StrayValue> => win([w(5900, 3999, OLD, cmd)], over);

// ---- Fixture P (posix)
/** A ps line: the CPU time is the elapsed time unless given. */
const p = (pid: number | string, ppid: number | string, elapsed: string, cmd: string, cpu = elapsed): string => `   ${pid}  ${ppid}  ${elapsed}  ${cpu} ${cmd}`;
const P_BASE = ['   3999     1  4:00:00  4:00:00 claude --x', '   4000  3999  2:00:00  2:00:00 node /home/u/src/AIDLC/bin/aidlc.js doctor'];
const psText = (lines: string[]): string => lines.join('\n') + '\n';

function psInput(runner: Runner, over: Partial<StrayInput> = {}): StrayInput {
  return { isGit: true, mainRoot: '/home/u/src/AIDLC', config: ProjectConfig.parse({}), runner, now: NOW, platform: 'linux', env: { HOME: '/home/u' }, self: 4000, cwd: '/home/u/caller', ...over };
}
async function psReport(stdout: string, over: Partial<StrayInput> = {}): Promise<{ value: StrayValue; calls: Call[] }> {
  const r = recorder({ exitCode: 0, timedOut: false, stdout });
  return { value: await strayProcessesReport(psInput(r.runner, over)), calls: r.calls };
}
/** The value for the base lines plus `lines`. */
async function ps(lines: string[], over: Partial<StrayInput> = {}): Promise<StrayValue> {
  return (await psReport(psText([...P_BASE, ...lines]), over)).value;
}
const psCmd = (cmd: string, over: Partial<StrayInput> = {}): Promise<StrayValue> => ps([p(5900, 3999, '45:00', cmd)], over);

/** The entry of `pid`; the value must be a list holding it. */
function listed(value: StrayValue, pid: number): string {
  assert.ok(Array.isArray(value), `expected a list holding pid ${pid}: ${JSON.stringify(value)}`);
  const entry = value.find((e) => e.startsWith(`pid ${pid},`));
  assert.ok(entry !== undefined, `pid ${pid} is not listed: ${JSON.stringify(value)}`);
  return entry;
}
/** The value is `none` or a list, and holds no entry of `pid`. */
function notListed(value: StrayValue, pid: number): void {
  assert.ok(value === 'none' || Array.isArray(value), `expected none or a list: ${JSON.stringify(value)}`);
  if (Array.isArray(value)) assert.ok(!value.some((e) => e.startsWith(`pid ${pid},`)), `pid ${pid} is listed: ${JSON.stringify(value)}`);
}

describe('strayProcesses (card T0-DOCTOR-STRAY-PROCESSES-2)', () => {
  test('the listing is one bounded command per platform [R1]', async () => {
    const { value, calls } = await winReport(JSON.stringify(BASE));
    assert.equal(value, 'none');
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.command, 'C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepEqual(calls[0]!.args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', SCRIPT]);
    assert.ok(!SCRIPT.includes('"') && !SCRIPT.includes('\\'), 'the script holds no double quote and no backslash');
    assert.deepEqual(calls[0]!.options, OPTIONS);
    const roots: Array<[NodeJS.ProcessEnv, string]> = [[{ SystemRoot: 'D:\\Win\\\\' }, 'D:\\Win'], [{ windir: 'E:\\W' }, 'E:\\W'], [{ SystemRoot: '', windir: '' }, 'C:\\Windows'], [{}, 'C:\\Windows']];
    for (const [env, dir] of roots) {
      const r = await winReport(JSON.stringify(BASE), { env });
      assert.equal(r.calls.length, 1, JSON.stringify(env));
      assert.equal(r.calls[0]!.command, `${dir}${POWERSHELL}`, JSON.stringify(env));
    }
    for (const platform of ['linux', 'darwin', 'freebsd'] as NodeJS.Platform[]) {
      const r = await psReport(psText(P_BASE), { platform });
      assert.equal(r.value, 'none', platform);
      assert.equal(r.calls.length, 1, platform);
      assert.equal(r.calls[0]!.command, 'ps', platform);
      assert.deepEqual(r.calls[0]!.args, PS_ARGS, platform);
      assert.deepEqual(r.calls[0]!.options, OPTIONS, platform);
    }
  });

  test('a Windows listing is read in each form it takes [R2] [R9]', async () => {
    // (a) one object, not an array
    assert.equal((await winReport(JSON.stringify(DOCTOR), { self: 4000 })).value, 'none');
    // (b) a byte order mark and a CPU time above 24 hours
    const b = await winReport('\uFEFF' + JSON.stringify([...BASE, w(5001, 4999, OLD, 'D:\\wt\\AIDLC\\T0-X\\run.cmd', 90_000_000)]));
    assert.deepEqual(b.value, ['pid 5001, "run.cmd", age 31 min, cpu 1500 min, under D:\\wt\\AIDLC, folder t0-x', S]);
    // (c) a null command line under a parent that names the root
    assert.deepEqual(await win([w(5100, 5101, OLD, null), w(5101, 3999, T - 60 * MIN, 'D:\\wt\\AIDLC\\T0-X\\a.exe')]), [
      'pid 5101, "a.exe", age 60 min, cpu 60 min, under D:\\wt\\AIDLC, folder t0-x',
      'pid 5100, (no command line), age 31 min, cpu 31 min, under D:\\wt\\AIDLC, folder t0-x, through an ancestor',
      S,
    ]);
    // (d) a command line with a line break
    assert.deepEqual(await win([w(5200, 3999, OLD, 'bash -c "cd D:\\wt\\AIDLC\\T0-X\npython -"')]), ['pid 5200, "bash", age 31 min, cpu 31 min, under D:\\wt\\AIDLC, folder t0-x', S]);
    // (e) a parent without a start time: not stray itself, and the walk goes on through it
    const e = await win([w(5300, 3999, null, 'D:\\wt\\AIDLC\\x'), w(5301, 5300, OLD, 'python.exe -')]);
    notListed(e, 5300);
    listed(e, 5301);
    // (f) a null CPU time reads as 0
    assert.equal(await win([w(5250, 3999, OLD, 'D:\\wt\\AIDLC\\x', null)]), 'none');
  });

  test('a Windows listing the parser refuses gives unknown [R2] [R4]', async () => {
    const good = w(5500, 3999, OLD, 'D:\\wt\\AIDLC\\x');
    const without = (key: string): WinRow => Object.fromEntries(Object.entries(good).filter(([k]) => k !== key));
    const plus = (element: unknown): string => JSON.stringify([...BASE, element]);
    const rows: Array<[string, string]> = [
      ['empty', ''],
      ['not json', 'not json'],
      ['a string', '"text"'],
      ['a number', '42'],
      ['a boolean', 'true'],
      ['null', 'null'],
      ['an empty array (doctor missing)', '[]'],
      ['an element 1', plus(1)],
      ['an element null', plus(null)],
      ['an element []', plus([])],
      ...['pid', 'ppid', 'start', 'cpu', 'cmd'].map((k): [string, string] => [`without ${k}`, plus(without(k))]),
      ...([['pid', null], ['pid', '5'], ['pid', -1], ['pid', 1.5], ['pid', 2 ** 53], ['ppid', null], ['ppid', '5'], ['ppid', -1], ['ppid', 2 ** 53], ['start', true], ['start', '2026-09-11'], ['start', 1.5], ['start', 2 ** 53], ['cpu', -1], ['cpu', 2.5], ['cpu', '5'], ['cpu', 2 ** 53], ['cmd', 5], ['cmd', {}]] as Array<[string, unknown]>).map(
        ([k, v]): [string, string] => [`${k}: ${JSON.stringify(v)}`, plus({ ...good, [k]: v })],
      ),
      ['pid 3999 twice', plus(w(3999, 1, OLD, 'again'))],
      ['without doctor', JSON.stringify([CLAUDE])],
    ];
    for (const [label, stdout] of rows) assert.equal((await winReport(stdout)).value, UNREADABLE, label);
  });

  test('a ps listing is read in each form it takes [R3] [R8] [R9]', async () => {
    const cmd = '/home/u/.wt/AIDLC/T0-X/run.sh -x';
    const times: Array<[string, string, string]> = [
      ['45:00', '45:00', 'age 45 min, cpu 45 min'],
      ['01:02:03', '01:02:03', 'age 62 min, cpu 62 min'],
      ['2-03:04:05', '2-03:04:05', 'age 3064 min, cpu 3064 min'],
      ['2-00:00:00', '1-02:03:04', 'age 2880 min, cpu 1563 min'],
      ['5:00:00', '150:00.00', 'age 300 min, cpu 150 min'],
    ];
    for (const [elapsed, cpu, shown] of times) {
      assert.equal(listed(await ps([p(5500, 3999, elapsed, cmd, cpu)]), 5500), `pid 5500, "run.sh", ${shown}, under /home/u/.wt/AIDLC, folder T0-X`, `${elapsed} ${cpu}`);
    }
    const parsed = await listProcesses(recorder({ stdout: psText([...P_BASE, p(5501, 3999, '45:00', 'a', '20:00.50'), p(5502, 3999, '45:00', 'a', '20:00,50'), p(5503, 3999, '45:00', 'a', '0:00.03'), p(5504, 3999, '45:00', 'a', '00:00:00')]) }).runner, 'linux', {}, T);
    assert.ok(Array.isArray(parsed), String(parsed));
    const row = (pid: number): ProcessRow => parsed.find((r) => r.pid === pid)!;
    assert.deepEqual([5501, 5502, 5503, 5504].map((pid) => row(pid).cpuMs), [1_200_500, 1_200_500, 30, 0]);
    assert.equal(row(5501).startMs, T - 2_700_000);
    assert.deepEqual(row(5501), { pid: 5501, ppid: 3999, startMs: T - 2_700_000, cpuMs: 1_200_500, command: 'a' });
    // A line with no command under a shell that names the root.
    assert.deepEqual(await ps(['   5800  5801    45:00    45:00', p(5801, 3999, '1:00:00', 'sh -c "cd /home/u/.wt/AIDLC/T0-X && python3 -"')]), [
      'pid 5801, "sh", age 60 min, cpu 60 min, under /home/u/.wt/AIDLC, folder T0-X',
      'pid 5800, (no command line), age 45 min, cpu 45 min, under /home/u/.wt/AIDLC, folder T0-X, through an ancestor',
      S,
    ]);
    // U+2028 in the command line, after the root.
    listed(await ps([p(5600, 3999, '45:00', 'sh /home/u/.wt/AIDLC/T0-X\u2028more')]), 5600);
    // Blank lines and a line of spaces change nothing; a trailing \r is removed.
    const lines = [...P_BASE, p(5700, 3999, '45:00', cmd)];
    const plain = await psReport(psText(lines));
    listed(plain.value, 5700);
    assert.deepEqual((await psReport('\n' + lines.join('\n\n   \n') + '\n\n')).value, plain.value);
    const lf = await listProcesses(recorder({ stdout: psText(lines) }).runner, 'linux', {}, T);
    const crlf = await listProcesses(recorder({ stdout: lines.join('\r\n') + '\r\n' }).runner, 'linux', {}, T);
    assert.ok(Array.isArray(lf), String(lf));
    assert.deepEqual(crlf, lf);
  });

  test('a ps listing the parser refuses gives unknown [R3] [R4]', async () => {
    const rows: Array<[string, string]> = [
      ['empty', ''],
      ['blank lines', '\n\n'],
      ['three columns', psText([...P_BASE, '5 4 45:00'])],
      ['a pid that is not a number', psText([...P_BASE, 'x 1 45:00 00:00:00 a'])],
      ['a pid of 20 digits', psText([...P_BASE, p('1'.repeat(20), 3999, '45:00', 'a')])],
      ['a ppid of 20 digits', psText([...P_BASE, p(5, '1'.repeat(20), '45:00', 'a')])],
      ['elapsed without a colon', psText([...P_BASE, '5 4 5 00:00:00 a'])],
      ['elapsed with four fields', psText([...P_BASE, '5 4 1:2:3:4 00:00:00 a'])],
      ['a CPU time that is not a time', psText([...P_BASE, '5 4 45:00 abc a'])],
      ['a negative elapsed time', psText([...P_BASE, '5 4 -5:00 00:00:00 a'])],
      ['elapsed minutes of 400 digits', psText([...P_BASE, `5 4 ${'9'.repeat(400)}:00 00:00:00 a`])],
      ['CPU seconds of 400 digits', psText([...P_BASE, `5 4 45:00 00:${'9'.repeat(400)} a`])],
      ['pid 3999 twice', psText([...P_BASE, '   3999     1 1:00 00:00:00 again'])],
      ['without doctor', psText([P_BASE[0]!])],
    ];
    for (const [label, stdout] of rows) assert.equal((await psReport(stdout)).value, UNREADABLE, label);
  });

  test('a listing that fails, times out, throws or rejects gives unknown, never none [R4]', async () => {
    const stdout = JSON.stringify(BASE);
    const failed = 'unknown: the process listing failed (no exit code)';
    const throws: Runner = () => {
      throw new Error('cannot start');
    };
    const rejects: Runner = async () => {
      throw new Error('rejected');
    };
    assert.equal(await strayProcessesReport(winInput(throws)), failed);
    assert.equal(await strayProcessesReport(winInput(rejects)), failed);
    assert.equal(await listProcesses(throws, 'win32', {}, T), failed);
    assert.equal(await listProcesses(rejects, 'win32', {}, T), failed);
    const rows: Array<[Partial<ExecReceipt>, string]> = [
      [{ timedOut: true, exitCode: null }, 'unknown: the process listing timed out after 10000 ms'],
      [{ timedOut: true, exitCode: 0 }, 'unknown: the process listing timed out after 10000 ms'],
      [{ exitCode: 1 }, 'unknown: the process listing failed (exit 1)'],
      [{ exitCode: 1, stdout: 'not json' }, 'unknown: the process listing failed (exit 1)'],
      [{ exitCode: -4058 }, 'unknown: the process listing failed (exit -4058)'],
      [{ exitCode: null, signal: 'SIGTERM' }, failed],
      [{ exitCode: 0, stderr: 'WARNING: x' }, 'none'],
    ];
    for (const [receipt, want] of rows) assert.equal((await winReport(stdout, {}, receipt)).value, want, JSON.stringify(receipt));
    const getter = recorder({ exitCode: 0, stdout }, (receipt) =>
      Object.defineProperty(receipt, 'stdout', {
        get(): string {
          throw new Error('unreadable output');
        },
      }),
    );
    assert.equal(await strayProcessesReport(winInput(getter.runner)), UNREADABLE);
  });

  test('the roots are the main checkout and the worktree root as the config resolves them [R5]', async () => {
    const off = await winReport(JSON.stringify(BASE), { isGit: false });
    assert.equal(off.value, 'n/a (not a git repository)');
    assert.equal(off.calls.length, 0);
    assert.equal(listed(await winCmd('node D:\\Projects\\AIDLC\\node_modules\\x\\tsserver.js'), 5900), 'pid 5900, "node", age 31 min, cpu 31 min, under D:\\Projects\\AIDLC, folder node_modules');
    const scoped = await win([w(5901, 3999, OLD, 'E:\\wt\\AIDLC\\T0-X'), w(5902, 3999, OLD, 'D:\\wt\\AIDLC\\T0-X')], { config: ProjectConfig.parse({ worktreeRoot: '' }), env: { SystemRoot: 'C:\\WINDOWS', SystemDrive: 'E:' } });
    assert.ok(listed(scoped, 5901).includes('under E:\\wt\\AIDLC, folder t0-x'));
    notListed(scoped, 5902);
    const relative = await win([w(5901, 3999, OLD, 'D:\\wt\\T0-X'), w(5902, 3999, OLD, 'D:\\Projects\\wt\\T0-X')], { config: ProjectConfig.parse({ worktreeRoot: '..\\wt' }), cwd: 'D:\\Caller' });
    assert.ok(listed(relative, 5901).includes('under D:\\wt, folder t0-x'));
    notListed(relative, 5902);
    // An absolute root loses its trailing separators: `\` and `/` on win32, `/` elsewhere.
    for (const worktreeRoot of ['D:\\wt\\AIDLC\\', 'D:\\wt\\AIDLC/\\']) {
      assert.equal(listed(await winCmd('D:\\wt\\AIDLC\\T0-X', { config: ProjectConfig.parse({ worktreeRoot }) }), 5900), 'pid 5900, "T0-X", age 31 min, cpu 31 min, under D:\\wt\\AIDLC, folder t0-x', worktreeRoot);
    }
    assert.equal(listed(await psCmd('/home/u/wt/T0-X', { config: ProjectConfig.parse({ worktreeRoot: '/home/u/wt//' }) }), 5900), 'pid 5900, "T0-X", age 45 min, cpu 45 min, under /home/u/wt, folder T0-X');
    assert.equal(listed(await psCmd('/home/u/wt/T0-X', { config: ProjectConfig.parse({ worktreeRoot: '/home/u/wt\\' }) }), 5900), 'pid 5900, "T0-X", age 45 min, cpu 45 min, under /home/u/wt\\, folder T0-X');
    const driveRoot = await win([w(5901, 3999, OLD, 'D:\\Other\\x'), w(5902, 3999, OLD, 'D:\\Projects\\AIDLC\\x')], { config: ProjectConfig.parse({ worktreeRoot: 'D:\\' }) });
    notListed(driveRoot, 5901);
    listed(driveRoot, 5902);
    const mainDrive = await winReport(JSON.stringify([...BASE, w(5901, 3999, OLD, 'E:\\wt\\T0-X')]), { mainRoot: 'D:\\', config: ProjectConfig.parse({ worktreeRoot: 'E:\\wt' }) });
    assert.equal(mainDrive.calls.length, 1);
    listed(mainDrive.value, 5901);
    const none = await winReport(JSON.stringify(BASE), { mainRoot: 'D:\\', config: ProjectConfig.parse({ worktreeRoot: '' }) });
    assert.equal(none.value, 'n/a (no usable root)');
    assert.equal(none.calls.length, 0);
    // Fixture P
    listed(await psCmd('/home/u/wt/T0-X', { config: ProjectConfig.parse({ worktreeRoot: '../wt' }), cwd: '/home/u/caller' }), 5900);
    const slash = await ps([p(5901, 3999, '45:00', '/srv/x'), p(5902, 3999, '45:00', '/home/u/src/AIDLC/x')], { config: ProjectConfig.parse({ worktreeRoot: '/' }) });
    notListed(slash, 5901);
    listed(slash, 5902);
    const psNone = await psReport(psText(P_BASE), { mainRoot: '/', config: ProjectConfig.parse({ worktreeRoot: '' }) });
    assert.equal(psNone.value, 'n/a (no usable root)');
    assert.equal(psNone.calls.length, 0);
    // A step that throws against the typed precondition gives the caught-error value.
    assert.equal((await winReport(JSON.stringify(BASE), { mainRoot: 42 as never })).value, UNREADABLE);
  });

  test('a root matches by normalized prefix between two non-name characters [R6]', async () => {
    const winListed = [
      'D:\\wt\\AIDLC\\T0-X',
      'D:/wt/AIDLC/T0-X',
      'D:\\\\wt\\\\AIDLC\\\\T0-X',
      'D:\\wt/AIDLC',
      'd:\\WT\\aidlc\\T0-X',
      '/d/wt/AIDLC/T0-X',
      'cd /D/wt/AIDLC',
      '/mnt/d/wt/AIDLC/T0-X',
      '"D:\\wt\\AIDLC"',
      'D:\\wt\\AIDLCX D:\\wt\\AIDLC\\T0-X',
      'file:///D:/wt/AIDLC/x',
      ...[';', '&', '(', ')', ' ', '\n'].map((c) => `x D:\\wt\\AIDLC${c}y`),
      ';D:\\wt\\AIDLC\\x',
      '(D:\\wt\\AIDLC\\x',
      'D:\\wt\\AIDLC+old',
      'D:\\wt\\AIDLC(1)',
    ];
    for (const cmd of winListed) listed(await winCmd(cmd), 5900);
    const winNotListed = [
      ...['X', '2', '\u00e9', '\u{1D49C}', '.bak', '_old', '-2'].map((c) => `D:\\wt\\AIDLC${c}`),
      ...['X', '2', '\u00e9', '\u{1D49C}', '.', '_', '-'].map((c) => `${c}/d/wt/AIDLC/x`),
      'D:\\wt',
      'D:\\wt\\AIDL',
      '/e/wt/AIDLC',
    ];
    for (const cmd of winNotListed) {
      const value = await winCmd(cmd);
      assert.equal(value, 'none', `${JSON.stringify(cmd)}: ${JSON.stringify(value)}`);
    }
    const share = { config: ProjectConfig.parse({ worktreeRoot: '\\\\srv\\share\\wt' }) };
    listed(await winCmd('\\\\srv\\share\\wt\\T0-X', share), 5900);
    listed(await winCmd('//srv/share/wt/T0-X', share), 5900);
    for (const cmd of ['/home/u/.wt/AIDLC/T0-X', 'x=/home/u/.wt/AIDLC', '/home/u//.wt/AIDLC', '\\home\\u\\.wt\\AIDLC']) listed(await psCmd(cmd), 5900);
    for (const cmd of ['/HOME/u/.wt/AIDLC', '/srv/home/u/.wt/AIDLC', '/home/u/.wt/AIDLCX']) {
      const value = await psCmd(cmd);
      assert.equal(value, 'none', `${JSON.stringify(cmd)}: ${JSON.stringify(value)}`);
    }
  });

  test('a process is under the repository through its parent chain, which its guards end [R7] [R8] [R9]', async () => {
    // (a) the incident: a python started by a bash whose command line names the card worktree
    const bash = '"C:\\Program Files\\Git\\bin\\bash.exe" -c "cd /d/wt/AIDLC/T0-OPS-CWD && python - <<\'EOF\'"';
    assert.deepEqual(await win([w(5000, 3999, OLD, bash, 100), w(5001, 5000, OLD, 'D:\\Python\\Python313\\python.exe -', 78_884_000)]), [
      'pid 5001, "python.exe", age 31 min, cpu 1314 min, under D:\\wt\\AIDLC, folder t0-ops-cwd, through an ancestor',
      S,
    ]);
    // (b) a parent that is not listed
    assert.equal(await win([w(5200, 7777, OLD, 'python.exe -')]), 'none');
    // (c) pid 0, its own parent
    assert.equal(await win([w(0, 0, T - 1000 * MIN, null)]), 'none');
    // (d) a parent younger than its child: its pid was reused
    assert.equal(await win([w(5400, 5401, OLD, 'python.exe -'), w(5401, 3999, T - 10 * MIN, 'D:\\wt\\AIDLC\\x')]), 'none');
    // (e) equal start times continue
    const equal = await win([w(5410, 5411, OLD, 'python.exe -'), w(5411, 3999, OLD, 'D:\\wt\\AIDLC\\x')]);
    listed(equal, 5410);
    listed(equal, 5411);
    // (f) a chain of four, only the top naming the root
    const chain = await win([w(5500, 5501, OLD, 'a.exe'), w(5501, 5502, OLD, 'b.exe'), w(5502, 5503, OLD, 'c.exe'), w(5503, 3999, OLD, 'D:\\wt\\AIDLC\\x')]);
    for (const pid of [5500, 5501, 5502]) assert.ok(listed(chain, pid).endsWith(', through an ancestor'), String(pid));
    assert.ok(!listed(chain, 5503).endsWith(', through an ancestor'));
  });

  test('a cyclic parent chain ends [R7]', () => {
    const child = path.join(repo, 'tests', 'infra', 'stray-processes.child.ts');
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) if (!/^(NODE_|GIT_|AIDLC_)/.test(key.toUpperCase())) env[key] = value;
    const asRow = (r: WinRow): ProcessRow => ({ pid: r['pid'] as number, ppid: r['ppid'] as number, startMs: r['start'] as number | null, cpuMs: (r['cpu'] as number | null) ?? 0, command: (r['cmd'] as string | null) ?? '' });
    const options = JSON.stringify({ roots: W_ROOTS, self: 4000, platform: 'win32', nowMs: T });
    const walk = (rows: WinRow[]): unknown => {
      const r = spawnSync(process.execPath, [child, JSON.stringify([...BASE, ...rows].map(asRow)), options], { encoding: 'utf8', timeout: 30_000, windowsHide: true, env });
      assert.equal(r.status, 0, `status ${r.status}, signal ${r.signal}, error ${r.error?.message}: ${r.stderr}`);
      return JSON.parse(r.stdout);
    };
    assert.equal(walk([w(5300, 5301, OLD, 'a.exe'), w(5301, 5300, OLD, 'b.exe')]), 'none');
    assert.deepEqual(walk([w(5310, 5311, OLD, 'python.exe -'), w(5311, 5310, OLD, 'D:\\wt\\AIDLC\\x')]), [
      'pid 5310, "python.exe", age 31 min, cpu 31 min, under D:\\wt\\AIDLC, folder x, through an ancestor',
      'pid 5311, "x", age 31 min, cpu 31 min, under D:\\wt\\AIDLC, folder x',
      S,
    ]);
  });

  test("doctor's own chain and its descendants are never listed and the chain's command lines do not count [R7]", async () => {
    assert.equal(await win([]), 'none');
    const pwsh = w(3999, 1, T - 240 * MIN, 'pwsh -WorkingDirectory D:\\Projects\\AIDLC');
    assert.equal((await winReport(JSON.stringify([pwsh, DOCTOR, w(5600, 3999, OLD, 'mcp-server.exe --stdio')]))).value, 'none');
    assert.equal(await win([w(4001, 4000, T - 60 * MIN, 'D:\\wt\\AIDLC\\probe.exe'), w(4002, 4001, OLD, 'D:\\wt\\AIDLC\\x.exe')]), 'none');
    assert.deepEqual(await win([w(5700, 3999, OLD, 'D:\\wt\\AIDLC\\T0-X\\y.exe')]), ['pid 5700, "y.exe", age 31 min, cpu 31 min, under D:\\wt\\AIDLC, folder t0-x', S]);
    assert.equal(await win([], { self: 4242 }), UNREADABLE);
  });

  test('a process is stray from 30 minutes of age and half its age in CPU [R5] [R8]', async () => {
    const one = (start: number | null, cpu?: number): Promise<StrayValue> => win([w(5800, 3999, start, 'D:\\wt\\AIDLC\\x', cpu)]);
    assert.ok(listed(await one(T - 30 * MIN), 5800).includes('age 30 min'));
    assert.equal(await one(T - 1_799_000), 'none');
    assert.equal(await one(T - 30 * MIN + 1), 'none');
    assert.equal(await one(T + MIN, 0), 'none');
    assert.equal(await one(null), 'none');
    assert.ok(listed(await one(T - 1_914_000), 5800).includes('age 31 min'));
    assert.ok(listed(await one(T - 30 * MIN, 900_000), 5800).includes('cpu 15 min'));
    assert.equal(await one(T - 30 * MIN, 899_999), 'none');
    const line = (elapsed: string, cpu = elapsed): Promise<StrayValue> => ps([p(5800, 3999, elapsed, '/home/u/.wt/AIDLC/x', cpu)]);
    listed(await line('30:00'), 5800);
    assert.equal(await line('29:59'), 'none');
    listed(await line('30:00', '15:00'), 5800);
    assert.equal(await line('30:00', '14:59'), 'none');
    assert.equal(await win([w(5800, 3999, OLD, 'D:\\wt\\AIDLC\\x')], { now: 'not a date' }), UNREADABLE);
    assert.equal(STRAY_AGE_MS, 1_800_000);
    assert.equal(STRAY_CPU_RATIO, 0.5);
  });

  test('an entry names the executable and the match and no argument; the list ends with the fixed sentence [R7] [R9]', async () => {
    const many = (n: number): WinRow[] => Array.from({ length: n }, (_, i) => w(6001 + i, 3999, OLD, 'D:\\wt\\AIDLC\\x', (6001 + i) * MIN));
    const entry = (pid: number, shown = 'x', folder = 'x'): string => `pid ${pid}, "${shown}", age 31 min, cpu ${pid} min, under D:\\wt\\AIDLC, folder ${folder}`;
    // (a) and (b): at most 20, largest CPU time first, then the count left out, then S
    assert.deepEqual(await win(many(23)), [...Array.from({ length: 20 }, (_, i) => entry(6023 - i)), 'and 3 more', S]);
    assert.deepEqual(await win(many(20)), [...Array.from({ length: 20 }, (_, i) => entry(6020 - i)), S]);
    // (c) an equal CPU time goes by pid
    const tie = await win([w(6101, 3999, OLD, 'D:\\wt\\AIDLC\\x', 1_860_000), w(6100, 3999, OLD, 'D:\\wt\\AIDLC\\x', 1_860_000)]);
    assert.ok(Array.isArray(tie));
    assert.deepEqual(tie.slice(0, 2).map((e) => e.split(',')[0]), ['pid 6100', 'pid 6101']);
    // (d) a quoted first word
    assert.ok(listed(await winCmd('"C:\\Program Files\\Tool Dir\\long name.exe" -x D:\\wt\\AIDLC\\T0-X'), 5900).startsWith('pid 5900, "long name.exe", '));
    // (e) the base name is cut to 60 code points
    const long = 'a'.repeat(59) + '\u{1D49C}';
    assert.ok(listed(await winCmd(`C:\\t\\${long}b D:\\wt\\AIDLC\\x`), 5900).startsWith(`pid 5900, ${JSON.stringify(long)}, `));
    // (f) the folder after the root, none at the end of the text or before a quote, cut to 60 code points
    assert.ok(listed(await winCmd('cd /d/wt/AIDLC/T0-OPS-CWD && x'), 5900).endsWith('under D:\\wt\\AIDLC, folder t0-ops-cwd'));
    assert.ok(listed(await winCmd('x D:\\wt\\AIDLC'), 5900).endsWith(', under D:\\wt\\AIDLC'));
    assert.ok(listed(await winCmd('x "D:\\wt\\AIDLC"'), 5900).endsWith(', under D:\\wt\\AIDLC'));
    assert.ok(listed(await winCmd(`x D:\\wt\\AIDLC\\${'k'.repeat(59)}\u{1D49C}${'k'.repeat(10)}`), 5900).endsWith(`, folder ${'k'.repeat(59)}\u{1D49C}`));
    // (g) the earliest occurrence; (h) the longer prefix at an equal start
    assert.ok(listed(await winCmd('x D:\\Projects\\AIDLC\\a D:\\wt\\AIDLC\\b'), 5900).endsWith(', under D:\\Projects\\AIDLC, folder a'));
    assert.ok(listed(await winCmd('x D:\\Projects\\AIDLC\\wt\\T0-X', { config: ProjectConfig.parse({ worktreeRoot: 'D:\\Projects\\AIDLC\\wt' }) }), 5900).endsWith(', under D:\\Projects\\AIDLC\\wt, folder t0-x'));
    // (i) no argument is printed
    const f1 = ['--pass', 'word'].join('');
    const v1 = ['hunter', '2'].join('');
    const f2 = ['--api', '-tok', 'en'].join('');
    const v2 = ['abc', '123'].join('');
    const secretive = await winCmd(`tool.exe ${f1} ${v1} ${f2}=${v2} D:\\wt\\AIDLC\\T0-X`);
    assert.deepEqual(secretive, ['pid 5900, "tool.exe", age 31 min, cpu 31 min, under D:\\wt\\AIDLC, folder t0-x', S]);
    assert.ok(!JSON.stringify(secretive).includes(v1) && !JSON.stringify(secretive).includes(v2));
    // (j) minutes are floored
    assert.ok(listed(await win([w(5900, 3999, OLD, 'D:\\wt\\AIDLC\\x', 1_199_999)]), 5900).includes(', cpu 19 min,'));
    assert.equal(S, 'Not a failure and no reason to stop: name these processes to the user in your next report. End one only if this session started it, after checking that the pid is still that process.');
  });

  describe('platform, environment, pid and directory default to the calling process [R5]', () => {
    const wt = path.resolve('wt-rel');
    const target = path.join(wt, 'T0-X');
    const busy = process.pid + 1;
    const away = process.pid + 2;
    const input = (runner: Runner): StrayInput => ({ isGit: true, mainRoot: path.resolve('main-x'), config: ProjectConfig.parse({ worktreeRoot: 'wt-rel' }), runner, now: NOW });

    test('on win32: the PowerShell path from SystemRoot and the root resolved against the process directory', { skip: process.platform !== 'win32' && 'the listing of this row is the Windows one' }, async () => {
      const self = w(process.pid, away, T - 60 * MIN, 'node self', 0);
      const proc = w(busy, away, OLD, `x.exe ${target}`);
      const r = recorder({ stdout: JSON.stringify([self, proc]) });
      const value = await strayProcessesReport(input(r.runner));
      assert.ok(process.env['SystemRoot'], 'SystemRoot is set');
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0]!.command, `${process.env['SystemRoot']}${POWERSHELL}`);
      assert.ok(listed(value, busy).includes(`under ${wt}, folder t0-x`), JSON.stringify(value));
      const without = recorder({ stdout: JSON.stringify([proc]) });
      assert.equal(await strayProcessesReport(input(without.runner)), UNREADABLE);
    });

    test('elsewhere: ps and the root resolved against the process directory', { skip: process.platform === 'win32' && 'POSIX only: the listing of this row is the ps one' }, async () => {
      const self = p(process.pid, away, '1:00:00', 'node self', '00:00:00');
      const proc = p(busy, away, '31:00', `x ${target}`);
      const r = recorder({ stdout: psText([self, proc]) });
      const value = await strayProcessesReport(input(r.runner));
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0]!.command, 'ps');
      assert.ok(listed(value, busy).includes(`under ${wt}, folder T0-X`), JSON.stringify(value));
      const without = recorder({ stdout: psText([proc]) });
      assert.equal(await strayProcessesReport(input(without.runner)), UNREADABLE);
    });

    // Last of this test: the variable is restored when the subtest ends, before any other test runs.
    test('on win32: SYSTEMROOT in another letter case is read through process.env itself', { skip: process.platform !== 'win32' && 'Windows only: environment names are case-insensitive there' }, async (t) => {
      const saved = process.env['SystemRoot'];
      t.after(() => {
        delete process.env['SYSTEMROOT'];
        if (saved !== undefined) process.env['SystemRoot'] = saved;
      });
      delete process.env['SystemRoot'];
      process.env['SYSTEMROOT'] = 'X:\\Sysroot';
      const r = recorder({ stdout: JSON.stringify([w(process.pid, away, T - 60 * MIN, 'node self', 0)]) });
      assert.equal(await strayProcessesReport(input(r.runner)), 'none');
      assert.equal(r.calls.length, 1);
      assert.equal(r.calls[0]!.command, 'X:\\Sysroot\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    });
  });

  test('the real listing shows this process and leaves it out of the report [R1] [R2] [R3] [R4] [R7]', async (t) => {
    let receipt: ExecReceipt | undefined;
    const runner: Runner = async (command, args, options) => {
      receipt = await run(command, args, options);
      return receipt;
    };
    const rows = await listProcesses(runner, process.platform, process.env, Date.parse(NOW));
    t.diagnostic(`receipt: exit ${receipt?.exitCode}, timedOut ${receipt?.timedOut}, ${receipt?.durationMs} ms, ${Buffer.byteLength(receipt?.stdout ?? '')} output bytes`);
    if (process.platform !== 'win32' && process.platform !== 'linux' && rows === 'unknown: the process listing failed (exit -2)') return;
    assert.ok(Array.isArray(rows), String(rows));
    const parent = rows.find((r) => r.pid === process.ppid);
    assert.ok(parent, `the parent pid ${process.ppid} is not in the listing`);
    const me = rows.find((r) => r.pid === process.pid);
    assert.ok(me, `pid ${process.pid} is not in the listing`);
    assert.equal(me.ppid, process.ppid);
    assert.ok(me.command.includes('stray-processes.test.ts'), me.command);
    assert.ok(me.startMs !== null && parent.startMs !== null, 'both start times are listed');
    const nowMs = me.startMs + 31 * MIN;
    // Old and busy, and naming the checkout: only the exclusion of doctor's own chain keeps both rows out.
    const copy = rows.map((r) => ((r.pid === process.pid || r.pid === process.ppid) && r.startMs !== null ? { ...r, cpuMs: nowMs - r.startMs, command: import.meta.filename } : r));
    const value = strayEntries(copy, { roots: [repo], self: process.pid, platform: process.platform, nowMs });
    notListed(value, process.pid);
    notListed(value, process.ppid);
  });

  describe('aidlc doctor prints strayProcesses after interruptedWrites and exits 0 [R5] [R10]', () => {
    const dirs: string[] = [];
    after(() => dirs.forEach(cleanup));
    function doctor(flag: '--json' | '--no-json'): { status: number | null; stdout: string; stderr: string } {
      const dir = tmpDir('aidlc-stray-');
      dirs.push(dir);
      const state = path.join(dir, 'state');
      mkdirSync(state);
      const env: NodeJS.ProcessEnv = {};
      for (const [key, value] of Object.entries(process.env)) if (!/^(GIT_|NODE_|AIDLC_)/.test(key.toUpperCase())) env[key] = value;
      env['GIT_CEILING_DIRECTORIES'] = [path.dirname(dir), path.dirname(realpathSync.native(dir))].join(path.delimiter);
      env['AIDLC_STATE_DIR'] = state;
      env['AIDLC_SESSION'] = 'doctor-test';
      const r = spawnSync(process.execPath, [path.join(repo, 'src', 'cli', 'main.ts'), 'doctor', flag], { cwd: dir, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr };
    }

    test('with --json', () => {
      const r = doctor('--json');
      assert.equal(r.status, 0, r.stderr);
      const parsed = JSON.parse(r.stdout) as Record<string, unknown>;
      assert.equal(parsed['strayProcesses'], 'n/a (not a git repository)');
      const keys = Object.keys(parsed);
      assert.equal(keys.indexOf('strayProcesses'), keys.indexOf('interruptedWrites') + 1);
    });

    test('with --no-json', () => {
      const r = doctor('--no-json');
      assert.equal(r.status, 0, r.stderr);
      const lines = r.stdout.split(/\r?\n/);
      const at = lines.indexOf('interruptedWrites none');
      assert.ok(at >= 0, r.stdout);
      assert.equal(lines[at + 1], 'strayProcesses n/a (not a git repository)');
    });
  });

  test('every session and the implementer agent carry the rule [R11]', () => {
    const read = (file: string): string => readFileSync(path.join(repo, file), 'utf8').replace(/\r\n/g, '\n');
    const secrets = '- Never echo or commit secrets; never fabricate endpoints, keys or results.';
    const holdsH1 = (text: string): boolean => {
      const lines = text.split('\n');
      const at = lines.indexOf(secrets);
      return at >= 0 && H1.every((l, i) => lines[at + 1 + i] === l) && lines[at + 7] === '' && lines[at + 8] === '### Docs';
    };
    const holdsI1 = (text: string): boolean => {
      const lines = text.split('\n');
      const at = lines.findIndex((l) => l.startsWith('6. Commit only what the card owns'));
      return at >= 0 && I1.every((l, i) => lines[at + 1 + i] === l) && lines[at + 8] === '' && (lines[at + 9] ?? '').startsWith('Report (compact');
    };
    const claude = read('CLAUDE.md');
    const template = read('templates/CLAUDE.aidlc.md');
    for (const [name, text] of [['CLAUDE.md', claude], ['templates/CLAUDE.aidlc.md', template]] as const) {
      assert.ok(holdsH1(text), name);
      assert.ok(!holdsH1(text.replace(H1.join('\n') + '\n', '')), `${name} without H1`);
    }
    assert.ok(claude.split('\n').length - (claude.endsWith('\n') ? 1 : 0) <= 200, 'CLAUDE.md within 200 lines');
    assert.ok(claude.endsWith(template.trim() + '\n'), 'CLAUDE.md ends with the template');
    const live = readFileSync(path.join(repo, '.claude', 'agents', 'implementer.md'));
    const installed = readFileSync(path.join(repo, 'templates', 'claude', 'agents', 'implementer.md'));
    assert.ok(live.equals(installed), 'the two implementer.md copies are equal');
    for (const [name, text] of [['.claude/agents/implementer.md', read('.claude/agents/implementer.md')], ['templates/claude/agents/implementer.md', read('templates/claude/agents/implementer.md')]] as const) {
      assert.ok(/^[\x00-\x7f]*$/.test(text), `${name} is ASCII`);
      assert.ok(holdsI1(text), name);
      assert.ok(!holdsI1(text.replace(I1.join('\n') + '\n', '')), `${name} without I1`);
    }
  });

  test('the documents state the check [R12]', () => {
    const read = (file: string): string => readFileSync(path.join(repo, file), 'utf8').replace(/\r\n/g, '\n');
    const holdsP1 = (text: string): boolean => {
      const lines = text.split('\n');
      const at = lines.indexOf(P1);
      return at >= 2 && lines[at - 2]!.startsWith('Interrupted writes (card T0-DOCTOR-INTERRUPTED-WRITES)') && lines[at - 1] === '' && lines[at + 1] === '' && lines[at + 2] === '## Running a goal';
    };
    const holdsA1 = (text: string): boolean => (text.split('\n').find((l) => l.startsWith('`src/probes/` gathers evidence.')) ?? '').endsWith(' ' + A1);
    const holdsC1 = (text: string): boolean => {
      const start = text.indexOf('## Unreleased');
      const unreleased = text.slice(start, text.indexOf('\n## ', start + 1));
      return start >= 0 && unreleased.includes(C1 + '\n\n- T0-CI-PERMISSIONS') && text.split(C1).length === 2;
    };
    const ops = read('docs/OPERATIONS.md');
    const architecture = read('docs/ARCHITECTURE.md');
    const changelog = read('CHANGELOG.md');
    assert.ok(holdsP1(ops), 'docs/OPERATIONS.md');
    assert.ok(!holdsP1(ops.replace(P1 + '\n\n', '')), 'docs/OPERATIONS.md without P1');
    assert.ok(holdsA1(architecture), 'docs/ARCHITECTURE.md');
    assert.ok(!holdsA1(architecture.replace(' ' + A1, '')), 'docs/ARCHITECTURE.md without A1');
    assert.ok(holdsC1(changelog), 'CHANGELOG.md');
    assert.ok(!holdsC1(changelog.replace(C1 + '\n\n', '')), 'CHANGELOG.md without C1');
  });
});
