import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, killProcessTree, ok, run, runSync, scriptedRunner, TIMEOUT_GRACE_MS } from '../../src/probes/exec.ts';
import type { ExecOptions, ExecReceipt, ProcessKiller, SyncRunner } from '../../src/probes/exec.ts';

describe('probes/exec (receipts: exit, output digest, timeout)', () => {
  it('runSync executes a real node process and records exit 0, output and a sha256 receipt', () => {
    const r = runSync(process.execPath, ['-e', 'process.stdout.write("hi"); process.stderr.write("warn")']);
    assert.equal(r.exitCode, 0);
    assert.equal(r.timedOut, false);
    assert.equal(r.stdout, 'hi');
    assert.equal(r.stderr, 'warn');
    assert.equal(r.command, process.execPath);
    assert.match(r.outputSha256, /^[a-f0-9]{64}$/);
    assert.ok(Date.parse(r.finishedAt) >= Date.parse(r.startedAt));
    assert.ok(r.durationMs >= 0);
    assert.equal(ok(r), true);
    // a non-zero exit is not an empty result
    const bad = runSync(process.execPath, ['-e', 'process.exit(3)']);
    assert.equal(bad.exitCode, 3);
    assert.equal(ok(bad), false);
  });

  it('runSync marks a timed-out process and never reports it as ok', () => {
    const r = runSync(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 300 });
    assert.equal(r.timedOut, true);
    assert.equal(ok(r), false);
    assert.notEqual(r.exitCode, 0);
  });

  it('runSync reports a spawn failure in stderr instead of throwing', () => {
    const r = runSync('definitely-not-a-real-binary-aidlc', []);
    assert.notEqual(r.exitCode, 0);
    assert.match(r.stderr, /\[spawn error\]/);
    assert.equal(ok(r), false);
  });

  it('run (async) executes with stdin input and honours the timeout', async () => {
    const r = await run(process.execPath, ['-e', 'process.stdin.on("data", d => process.stdout.write(String(d).toUpperCase()))'], { input: 'abc' });
    assert.equal(r.exitCode, 0);
    assert.equal(r.stdout, 'ABC');
    const slow = await run(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 300 });
    assert.equal(slow.timedOut, true);
    assert.equal(ok(slow), false);
  });

  it('scriptedRunner maps command prefixes to canned receipts and returns 127 for unknown commands', () => {
    const runner = scriptedRunner({
      'git rev-parse --verify HEAD': { stdout: 'abc123\n' },
      'gh pr list': (args) => ({ stdout: JSON.stringify({ args }) }),
      'fail': { exitCode: 2, stderr: 'nope' },
    });
    const head = runner('git', ['rev-parse', '--verify', 'HEAD'], { cwd: 'C:/x' });
    assert.equal(head.exitCode, 0);
    assert.equal(head.stdout, 'abc123\n');
    assert.equal(head.cwd, 'C:/x');
    assert.match(head.outputSha256, /^[a-f0-9]{64}$/);
    const fn = runner('gh', ['pr', 'list', '--repo', 'r']);
    assert.deepEqual(JSON.parse(fn.stdout), { args: ['pr', 'list', '--repo', 'r'] });
    const fail = runner('fail', ['x']);
    assert.equal(fail.exitCode, 2);
    assert.equal(fail.stderr, 'nope');
    const unknown = runner('git', ['status']);
    assert.equal(unknown.exitCode, 127);
    assert.match(unknown.stderr, /no entry for "git status"/);
    assert.equal(ok(unknown), false);
  });
});

// ---------------------------------------------------------------------------------------------
// T0-EXEC-TREE-KILL: a timed-out command of the async runner is ended with its whole process tree.
// ---------------------------------------------------------------------------------------------

/** A scripted runner that records every call it answers. */
function recordingRunner(script: Parameters<typeof scriptedRunner>[0]): { runner: SyncRunner; calls: { command: string; args: string[]; options: ExecOptions | undefined }[] } {
  const inner = scriptedRunner(script);
  const calls: { command: string; args: string[]; options: ExecOptions | undefined }[] = [];
  return { calls, runner: (command, args, options) => (calls.push({ command, args, options }), inner(command, args, options)) };
}

/** A killer that records each (pid, signal) and throws ESRCH for the pids given. */
function recordingKiller(esrch: number[] = []): { killer: ProcessKiller; kills: [number, string][] } {
  const kills: [number, string][] = [];
  return {
    kills,
    killer: (pid, signal) => {
      kills.push([pid, signal]);
      if (esrch.includes(pid)) throw Object.assign(new Error(`kill ESRCH ${pid}`), { code: 'ESRCH' });
      return true;
    },
  };
}

const TASKKILL = 'C:\\Windows\\System32\\taskkill.exe';
const WIN_ENV = { SystemRoot: 'C:\\Windows' };

describe('T0-EXEC-TREE-KILL killProcessTree on win32 (taskkill.exe, fallback to the root) [R1] [R4]', () => {
  it('acceptance 1: runs %SystemRoot%\\System32\\taskkill.exe /pid 4242 /T /F once, with a 10 000 ms timeout and no shell, and kills nothing when it exits 0', () => {
    const { runner, calls } = recordingRunner({ [TASKKILL]: { exitCode: 0 } });
    const { killer, kills } = recordingKiller();
    killProcessTree(4242, 'win32', runner, killer, WIN_ENV);
    assert.deepEqual(calls.map((c) => [c.command, c.args]), [[TASKKILL, ['/pid', '4242', '/T', '/F']]]);
    assert.equal(calls[0]!.options?.timeoutMs, 10_000);
    assert.equal(calls[0]!.options?.shell, false);
    assert.deepEqual(kills, []);
  });

  for (const [name, receipt] of [
    ['exits 128', { exitCode: 128, stderr: 'ERROR: The process "4242" not found.' }],
    ['cannot be started (spawn error, null exit code)', { exitCode: null, stderr: '\n[spawn error] spawn taskkill.exe ENOENT' }],
  ] as [string, Partial<ExecReceipt>][]) {
    it(`acceptance 1: when taskkill ${name}, sends SIGKILL to 4242 alone, once`, () => {
      const { runner, calls } = recordingRunner({ [TASKKILL]: receipt });
      const { killer, kills } = recordingKiller();
      killProcessTree(4242, 'win32', runner, killer, WIN_ENV);
      assert.equal(calls.length, 1);
      assert.deepEqual(kills, [[4242, 'SIGKILL']]);
    });
  }
});

/** The table of acceptance 2 as ps pads it: 10 -> 11 -> 12 -> 14, and 13 -> 15 beside it. */
const PS_TABLE = ['   10     1', '   11    10', '   12    11', '   13     1', '   14    12', '   15    13', ''].join('\n');
const PS_ARGS = ['-A', '-o', 'pid=', '-o', 'ppid='];

describe('T0-EXEC-TREE-KILL killProcessTree elsewhere (one ps read, SIGKILL to the root and its descendants) [R1] [R4]', () => {
  for (const platform of ['linux', 'darwin'] as const) {
    it(`acceptance 2 (${platform}): reads ps -A -o pid= -o ppid= once and kills 10, 11, 12 and 14, 10 first, never 13 or 15`, () => {
      const { runner, calls } = recordingRunner({ 'ps -A -o pid= -o ppid=': { stdout: PS_TABLE } });
      const { killer, kills } = recordingKiller();
      killProcessTree(10, platform, runner, killer);
      assert.deepEqual(calls.map((c) => [c.command, c.args]), [['ps', PS_ARGS]]);
      assert.equal(calls[0]!.options?.timeoutMs, 10_000);
      assert.equal(calls[0]!.options?.shell, false);
      assert.deepEqual(kills[0], [10, 'SIGKILL']);
      assert.deepEqual([...kills].sort((a, b) => a[0] - b[0]), [[10, 'SIGKILL'], [11, 'SIGKILL'], [12, 'SIGKILL'], [14, 'SIGKILL']]);
    });

    for (const [name, receipt] of [
      ['ps exits 1', { exitCode: 1, stdout: PS_TABLE }],
      ['ps cannot be started (spawn error, null exit code)', { exitCode: null, stderr: '\n[spawn error] spawn ps ENOENT' }],
      ['ps prints no line of two integers', { stdout: '  PID  PPID\nnot a table\n10\n10 x\n' }],
    ] as [string, Partial<ExecReceipt>][]) {
      it(`acceptance 2 (${platform}): when ${name}, kills only the root 10`, () => {
        const { runner } = recordingRunner({ 'ps -A -o pid= -o ppid=': receipt });
        const { killer, kills } = recordingKiller();
        killProcessTree(10, platform, runner, killer);
        assert.deepEqual(kills, [[10, 'SIGKILL']]);
      });
    }

    it(`acceptance 2 (${platform}): a killer that throws ESRCH for 11 does not stop 12 and 14`, () => {
      const { runner } = recordingRunner({ 'ps -A -o pid= -o ppid=': { stdout: PS_TABLE } });
      const { killer, kills } = recordingKiller([11]);
      killProcessTree(10, platform, runner, killer);
      assert.deepEqual([...kills].sort((a, b) => a[0] - b[0]), [[10, 'SIGKILL'], [11, 'SIGKILL'], [12, 'SIGKILL'], [14, 'SIGKILL']]);
    });
  }
});

const FIXTURE = fileURLToPath(new URL('./exec-tree.child.ts', import.meta.url));
const TIMEOUT_MS = 1500;

/**
 * Whether `pid` is a running process. `process.kill(pid, 0)` also succeeds for a POSIX zombie, a
 * killed process its parent has not reaped yet; on Linux a process whose /proc/<pid>/stat state is
 * Z counts as gone, so a CI whose PID 1 reaps orphans late does not read a killed sleeper as alive.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform !== 'linux') return true;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3) !== 'Z';
  } catch {
    return false;
  }
}

function end(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    /* already gone */
  }
}

/** Polls until `pid` is gone (a killed POSIX process stays a zombie until it is reaped), up to `ms`. */
async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
}

function readPid(file: string): number | undefined {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

interface FixtureRun {
  receipt: ExecReceipt | undefined;
  elapsedMs: number;
  sleeper: number | undefined;
  root: number | undefined;
}

/**
 * Runs the fixture in `mode` with `timeoutMs` 1500 and races the receipt against `boundMs` from the call.
 * Every fixture process is ended in a `finally`, so a red run neither waits 60 s nor leaves a sleeper.
 */
async function raceFixture(runner: typeof run, mode: 'stay' | 'exit', boundMs: number, check: (r: FixtureRun) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'aidlc-exec-tree-'));
  const pidFile = join(dir, 'sleeper.pid');
  const started = Date.now();
  let bound: NodeJS.Timeout | undefined;
  try {
    const receipt = await Promise.race([
      runner(process.execPath, [FIXTURE, mode, pidFile], { timeoutMs: TIMEOUT_MS }),
      new Promise<undefined>((r) => (bound = setTimeout(() => r(undefined), boundMs))),
    ]);
    const elapsedMs = Date.now() - started;
    // A receipt that settles while synchronous work holds the bound timer back still wins the race:
    // the elapsed time decides, not which promise settled first.
    if (receipt) assert.ok(elapsedMs <= boundMs, `receipt after ${elapsedMs} ms, past the ${boundMs} ms bound`);
    await check({ receipt, elapsedMs, sleeper: readPid(pidFile), root: readPid(`${pidFile}.root`) });
  } finally {
    clearTimeout(bound);
    end(readPid(pidFile));
    end(readPid(`${pidFile}.root`));
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A tree kill that records the pid it is given and delegates to the production killProcessTree. */
function delegatingTreeKill(): { calls: number[]; treeKill: (pid: number) => void } {
  const calls: number[] = [];
  return { calls, treeKill: (pid) => (calls.push(pid), killProcessTree(pid, process.platform, runSync, (p, signal) => process.kill(p, signal))) };
}

describe('T0-EXEC-TREE-KILL run on real processes (a node root, a shell, a node sleeper) [R1] [R2] [R3] [R4]', () => {
  it('raceFixture fails a receipt that settles after its bound while synchronous work held the bound timer back', async () => {
    const receipt = scriptedRunner({ late: { timedOut: true } })('late', []);
    const late: typeof run = () =>
      new Promise((resolve) =>
        setTimeout(() => {
          const until = Date.now() + 150;
          while (Date.now() < until) {
            /* blocks past the 50 ms bound */
          }
          resolve(receipt);
        }, 10),
      );
    await assert.rejects(raceFixture(late, 'stay', 50, () => {}), /past the 50 ms bound/);
  });

  it('acceptance 3: run on the stay fixture with timeoutMs 1500 resolves within 6 s, timed out and not ok, and the sleeper is gone', async () => {
    await raceFixture(run, 'stay', 6000, async ({ receipt, elapsedMs, sleeper }) => {
      assert.ok(receipt, `no receipt within 6000 ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      assert.equal(ok(receipt), false);
      assert.ok(sleeper !== undefined, 'the sleeper wrote its pid before the timeout');
      assert.equal(await goneWithin(sleeper, 3000), true, `sleeper ${sleeper} is still alive`);
    });
  });

  it('acceptance 4: createRun calls its tree kill once, with the root pid, in stay mode', async () => {
    const { calls, treeKill } = delegatingTreeKill();
    await raceFixture(createRun(treeKill), 'stay', 6000, ({ receipt, elapsedMs, root }) => {
      assert.ok(receipt, `no receipt within 6000 ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      assert.ok(root !== undefined, 'the root wrote its pid');
      assert.deepEqual(calls, [root]);
    });
  });

  it('acceptance 4: in exit mode (the root gone, the sleeper holding its output) the tree kill is never called and the receipt resolves within 6 s, timed out', async () => {
    const { calls, treeKill } = delegatingTreeKill();
    await raceFixture(createRun(treeKill), 'exit', 6000, ({ receipt, elapsedMs }) => {
      assert.ok(receipt, `no receipt within 6000 ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      assert.equal(ok(receipt), false);
      assert.deepEqual(calls, []);
      // [R3] stdout and stderr are destroyed at the timeout, so the close event of the exited root
      // resolves the receipt before the grace bound, with the exit the system reported for the root.
      assert.ok(elapsedMs < TIMEOUT_MS + 2000, `resolved at ${elapsedMs} ms, not on the close event before the bound`);
      assert.equal(receipt.exitCode, 0);
      assert.equal(receipt.signal, null);
    });
  });

  it('acceptance 5: with a tree kill that kills nothing, the receipt resolves by 1500 + TIMEOUT_GRACE_MS (2000) + 1000 ms, timed out, exitCode and signal null, root and sleeper still alive', async () => {
    assert.equal(TIMEOUT_GRACE_MS, 2000);
    const calls: number[] = [];
    const bound = TIMEOUT_MS + 2000 + 1000;
    await raceFixture(createRun((pid) => void calls.push(pid)), 'stay', bound, ({ receipt, elapsedMs, sleeper, root }) => {
      const rootAlive = calls.length === 1 && alive(calls[0]!);
      const sleeperAlive = sleeper !== undefined && alive(sleeper);
      assert.ok(receipt, `no receipt within ${bound} ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      assert.equal(ok(receipt), false);
      assert.equal(receipt.exitCode, null);
      assert.equal(receipt.signal, null);
      assert.deepEqual(calls, [root], 'the tree kill was called once, with the root pid');
      assert.equal(rootAlive, true, 'the root is still alive at the receipt');
      assert.equal(sleeperAlive, true, 'the sleeper is still alive at the receipt');
    });
  });

  it('acceptance 5 [R3]: the bound counts from the return of a tree kill that takes 1500 ms and kills nothing, not from the timeout', async () => {
    const slowMs = 1500;
    let returnedAt = 0;
    const slowKill = (): void => {
      const until = Date.now() + slowMs;
      while (Date.now() < until) {
        /* a tree kill that blocks, as a slow taskkill or ps does */
      }
      returnedAt = Date.now();
    };
    await raceFixture(createRun(slowKill), 'stay', TIMEOUT_MS + slowMs + 2000 + 1000, ({ receipt, elapsedMs }) => {
      assert.ok(receipt, `no receipt within ${TIMEOUT_MS + slowMs + 2000 + 1000} ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      const waited = Date.parse(receipt.finishedAt) - returnedAt;
      assert.ok(waited >= 2000 - 50, `resolved ${waited} ms after the tree kill returned, before TIMEOUT_GRACE_MS (2000)`);
    });
  });
});

describe('T0-EXEC-TREE-KILL a timed-out runner releases every handle at the bound [R3]', () => {
  it('acceptance 5 [R3]: with a tree kill that kills nothing and a large input the root never reads, the runner process exits on its own after the receipt, the root still alive at the receipt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidlc-exec-tree-'));
    const pidFile = join(dir, 'sleeper.pid');
    // The runner's node start, the 1500 ms timeout, TIMEOUT_GRACE_MS (2000) and 3000 ms of slack.
    const boundMs = TIMEOUT_MS + 2000 + 3000;
    const started = Date.now();
    // No pipes to the runner: on Windows the root and the sleeper inherit the runner's own handles,
    // so a pipe would stay open after the runner exits; its receipt goes to a file and 'exit' decides.
    const runner = spawn(process.execPath, [FIXTURE, 'runner', pidFile], { stdio: 'ignore', windowsHide: true });
    let bound: NodeJS.Timeout | undefined;
    try {
      const exited = await Promise.race([
        new Promise<boolean>((r) => runner.on('exit', () => r(true))),
        new Promise<boolean>((r) => (bound = setTimeout(() => r(false), boundMs))),
      ]);
      const elapsedMs = Date.now() - started;
      assert.equal(exited, true, `the runner process is still running ${elapsedMs} ms after its start`);
      assert.ok(elapsedMs <= boundMs, `the runner exited after ${elapsedMs} ms, past the ${boundMs} ms bound`);
      assert.equal(existsSync(`${pidFile}.receipt`) ? readFileSync(`${pidFile}.receipt`, 'utf8') : 'no receipt', 'resolved timedOut=true exitCode=null rootAlive=true');
    } finally {
      clearTimeout(bound);
      end(runner.pid);
      end(readPid(pidFile));
      end(readPid(`${pidFile}.root`));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** The sentences this card appends to the pre-review command paragraph of docs/OPERATIONS.md. */
const OPERATIONS_SENTENCES = [
  "A command the async runner starts (the R2 and R3 reviewers, the claude-code provider of `aidlc run`) is ended at its `timeoutMs` with its whole process tree: on Windows by `taskkill /T /F` on the root's pid, elsewhere by `SIGKILL` to the root and to each of its descendants found in one process-table read (card T0-EXEC-TREE-KILL).",
  'Its receipt then resolves with `timedOut` true no later than 2000 ms after the timeout or the tree kill, whichever ends later, whatever a surviving descendant still holds open.',
  'The synchronous runner (git, gh, the scaffold ship script, ops bindings, eval commands) still ends only the root of a timed-out command, so a descendant of such a command keeps running after its receipt returns.',
];
const ARCHITECTURE_SENTENCE = "`exec.ts` runs commands and returns receipts (exit, output digest, timing), the async runner ending a timed-out command's whole process tree, with a scripted runner for tests.";
const CHANGELOG_ENTRY =
  '- T0-EXEC-TREE-KILL (bugfix): a command the async runner `run` times out (an R2 or R3 reviewer, the claude-code provider of `aidlc run`) is ended with its whole process tree, `taskkill /T /F` on Windows and `SIGKILL` to the root and its descendants from one `ps` read elsewhere, and its receipt resolves with `timedOut` true within `TIMEOUT_GRACE_MS` (2000 ms) of the timeout or the tree kill. Before, only the root (on Windows the shell) was killed, so a timed-out reviewer kept running and its receipt waited until it exited on its own: a 1 s timeout returned at 12.1 s. The synchronous runner `runSync` still ends only the root of a timed-out command (card T0-EXEC-SYNC-TREE-KILL).';

const readDoc = (path: string): string => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');
const sentencesOf = (text: string): string[] => text.split(/(?<=\.)\s+(?=[A-Z`])/);

/** Whether every text this card adds is present whole: the OPERATIONS sentences in the pre-review command paragraph, the ARCHITECTURE sentence in the probes paragraph, the CHANGELOG entry under Unreleased. */
function docsHold(ops: string, architecture: string, changelog: string): boolean {
  const paragraph = ops.split('\n').find((line) => line.startsWith('`command` is argv (the prompt arrives on stdin;')) ?? '';
  if (!OPERATIONS_SENTENCES.every((s) => paragraph.includes(` ${s}`))) return false;
  const probes = architecture.split('\n').find((line) => line.startsWith('`src/probes/` gathers evidence.')) ?? '';
  if (!probes.includes(` ${ARCHITECTURE_SENTENCE} `)) return false;
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  return unreleased.split('\n').includes(CHANGELOG_ENTRY);
}

describe('T0-EXEC-TREE-KILL docs [R5] [R6] [R7]', () => {
  it('acceptance 7: OPERATIONS.md, ARCHITECTURE.md and the CHANGELOG Unreleased section carry each sentence, and removing any one fails', () => {
    const [ops, architecture, changelog] = [readDoc('docs/OPERATIONS.md'), readDoc('docs/ARCHITECTURE.md'), readDoc('CHANGELOG.md')];
    assert.ok(docsHold(ops, architecture, changelog), 'the doc texts this card adds are present whole');
    const removals: [string, () => boolean][] = [
      ...OPERATIONS_SENTENCES.map((s): [string, () => boolean] => [s, () => docsHold(ops.replace(s, ''), architecture, changelog)]),
      [ARCHITECTURE_SENTENCE, () => docsHold(ops, architecture.replace(ARCHITECTURE_SENTENCE, ''), changelog)],
      ...sentencesOf(CHANGELOG_ENTRY).map((s): [string, () => boolean] => [s, () => docsHold(ops, architecture, changelog.replace(s, ''))]),
    ];
    // 3 OPERATIONS sentences, the ARCHITECTURE sentence, 3 CHANGELOG sentences.
    assert.equal(removals.length, 7);
    for (const [sentence, holds] of removals) assert.equal(holds(), false, `removing this text still passes: ${sentence}`);
  });
});
