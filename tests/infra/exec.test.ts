import { after, describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type SpawnSyncOptions } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRun, createRunSync, killProcessTree, ok, run, runSync, scriptedRunner, TIMEOUT_GRACE_MS, TREE_HELPER_BACKSTOP_MS, treeHelperPath } from '../../src/probes/exec.ts';
import type { ExecOptions, ExecReceipt, ProcessKiller, SpawnSyncFn, SyncRunner } from '../../src/probes/exec.ts';
import { cleanup, tmpDir } from './helpers.ts';

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

type KillZero = (pid: number, signal: 0) => unknown;

/** What `process.kill(pid, 0)` reports: `alive` when it succeeds, else the code of the error it throws. */
function probe(pid: number, kill: KillZero = process.kill): string {
  try {
    kill(pid, 0);
    return 'alive';
  } catch (err) {
    return (err as NodeJS.ErrnoException).code ?? `no code: ${(err as Error).message}`;
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

/**
 * Acceptance 3's death check: polls `process.kill(pid, 0)` up to `ms` until it throws, then asserts
 * the code is ESRCH. A process that still answers (a POSIX zombie included) or any other error
 * (EPERM, an error with no code) fails.
 */
async function assertGoneWithin(pid: number, ms: number, kill: KillZero = process.kill): Promise<void> {
  const until = Date.now() + ms;
  let state = probe(pid, kill);
  while (state === 'alive' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 50));
    state = probe(pid, kill);
  }
  assert.equal(state, 'ESRCH', `process.kill(${pid}, 0) after ${ms} ms: ${state}`);
}

function readPid(file: string): number | undefined {
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

// ---------------------------------------------------------------------------------------------
// T0-EXEC-TEST-LOAD: the calibrated scale of the process-tree tests.
// ---------------------------------------------------------------------------------------------

interface Bounds {
  timeoutMs: number;
  stayBoundMs: number;
  exitCloseMs: number;
  noKillBoundMs: number;
  slowKillBoundMs: number;
  goneWithinMs: number;
  syncBoundMs: number;
  runnerExitBoundMs: number;
}

const CALIBRATION_BASE_MS = 750;
const SCALE_MAX = 8;
const CALIBRATION_LIMIT_MS = 30_000;
/** How long the slow-kill case's tree kill blocks. */
const SLOW_KILL_MS = 1500;
/** How long the fixture's sleeper lives (SLEEP_MS of exec-tree.child.ts). */
const SLEEPER_LIFE_MS = 60_000;
/** After the calibration's time limit, how long a pid file of a sleeper the root had started is awaited. */
const CALIBRATION_LATE_PID_MS = 5000;

/** `from` without the git and node variables that redirect a child, plus a git ceiling and a state directory under `dir`. */
function fixtureEnv(dir: string, from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(from)) {
    const upper = name.toUpperCase();
    if (upper.startsWith('GIT_') || upper === 'NODE_OPTIONS' || upper === 'AIDLC_STATE_DIR') continue;
    env[name] = value;
  }
  env.GIT_CEILING_DIRECTORIES = [dirname(dir), dirname(realpathSync.native(dir))].join(delimiter);
  env.AIDLC_STATE_DIR = join(dir, 'state');
  return env;
}

/**
 * Times the fixture's exit mode from the spawn to the root's exit, with no kill. Undefined when the spawn
 * fails, the root does not exit 0 within CALIBRATION_LIMIT_MS or the sleeper never wrote its pid file.
 * The sleeper is ended and verified gone in every case; its pid goes to `ended`.
 * `command` and `limitMs` replace the spawned command (given the pid file) and the time limit in tests of this function.
 */
async function calibrate(
  t: TestContext,
  fixture = FIXTURE,
  ended: number[] = [],
  command: (pidFile: string) => [string, string[]] = (pidFile) => [process.execPath, [fixture, 'exit', pidFile]],
  limitMs = CALIBRATION_LIMIT_MS,
): Promise<number | undefined> {
  const dir = tmpDir('aidlc-exec-calibrate-');
  t.after(() => cleanup(dir));
  const pidFile = join(dir, 'sleeper.pid');
  const startedAt = Date.now();
  const [file, args] = command(pidFile);
  const child = spawn(file, args, { stdio: 'ignore', windowsHide: true, env: fixtureEnv(dir) });
  let limit: NodeJS.Timeout | undefined;
  let limited = false;
  const measured = await new Promise<number | undefined>((resolve) => {
    child.once('error', () => resolve(undefined));
    child.once('exit', (code, signal) => resolve(code === 0 && signal === null && readPid(pidFile) !== undefined ? Date.now() - startedAt : undefined));
    limit = setTimeout(() => {
      limited = true;
      end(child.pid);
      resolve(undefined);
    }, limitMs);
  });
  clearTimeout(limit);
  // A sleeper the root had started may publish its pid after the limit: wait for it, at most CALIBRATION_LATE_PID_MS.
  for (let waited = 0; limited && readPid(pidFile) === undefined && waited < CALIBRATION_LATE_PID_MS; waited += 50) await new Promise((r) => setTimeout(r, 50));
  const sleeper = readPid(pidFile);
  if (sleeper !== undefined) {
    end(sleeper);
    await assertGoneWithin(sleeper, 3000);
    ended.push(sleeper);
  }
  return measured;
}

/** The scale of a calibration: its time in units of CALIBRATION_BASE_MS, rounded up, from 1 to SCALE_MAX. A missing or invalid measurement throws. */
function scaleFor(measured: number | undefined): number {
  if (measured === undefined || !Number.isFinite(measured) || measured < 0) throw new Error(`calibration failed: ${String(measured)}`);
  return Math.min(SCALE_MAX, Math.max(1, Math.ceil(measured / CALIBRATION_BASE_MS)));
}

/** Main's timeout and bounds times `scale`; TIMEOUT_GRACE_MS, the helper's backstop and the slow kill's duration are the product's and stay. */
function boundsAt(scale: number): Bounds {
  const timeoutMs = 1500 * scale;
  return {
    timeoutMs,
    stayBoundMs: 6000 * scale,
    exitCloseMs: timeoutMs + TIMEOUT_GRACE_MS,
    noKillBoundMs: (1500 + 1000) * scale + TIMEOUT_GRACE_MS,
    slowKillBoundMs: (1500 + 1000) * scale + SLOW_KILL_MS + TIMEOUT_GRACE_MS,
    goneWithinMs: 3000 * scale,
    syncBoundMs: Math.min(6000 * scale, timeoutMs + TIMEOUT_GRACE_MS + TREE_HELPER_BACKSTOP_MS),
    runnerExitBoundMs: TIMEOUT_MS + TIMEOUT_GRACE_MS + 3000 * scale,
  };
}

async function calibratedBounds(t: TestContext): Promise<Bounds & { scale: number }> {
  const measured = await calibrate(t);
  const scale = scaleFor(measured);
  t.diagnostic(`calibration ${String(measured)} ms, scale ${scale}`);
  return { scale, ...boundsAt(scale) };
}

const notReady = (scale: number, detail: string): Error => new Error(`fixture not ready before the timeout at scale ${scale}: the machine got slower after calibration (${detail})`);

/** The sleeper wrote its pid file, so existed, no later than the earliest time the timeout could fire. */
function assertSleeperExisted(run: { sleeperWrittenMs: number | undefined; startedMs: number }, timeoutMs: number, scale: number): void {
  if (run.sleeperWrittenMs === undefined) throw notReady(scale, 'no sleeper pid file');
  if (run.sleeperWrittenMs > run.startedMs + timeoutMs) throw notReady(scale, `the sleeper's pid file was written ${Math.round(run.sleeperWrittenMs - run.startedMs)} ms after the call, the timeout was ${timeoutMs} ms`);
}

/** The sleeper died well before its own 60 s end, so its death was a kill and not that end. */
function assertKilledBeforeNaturalEnd(sleeperWrittenMs: number | undefined, goneAtMs: number): void {
  if (sleeperWrittenMs === undefined) throw new Error('no sleeper pid file');
  if (goneAtMs >= sleeperWrittenMs + SLEEPER_LIFE_MS - 1000) throw new Error(`the sleeper was gone ${Math.round(goneAtMs - sleeperWrittenMs)} ms after it wrote its pid file, within 1000 ms of its natural end after ${SLEEPER_LIFE_MS} ms: the death check cannot tell a kill from that end`);
}

/** No tree kill call found the root alive: it had exited before the timeout. */
function assertRootGone(aliveAtCall: boolean[], scale: number): void {
  if (aliveAtCall.some((alive) => alive)) throw notReady(scale, 'the tree kill found the root still running');
}

describe('T0-EXEC-TEST-LOAD the calibrated scale [R2] [R3] [R4] [R6]', () => {
  const dir = tmpDir('aidlc-exec-env-');
  after(() => cleanup(dir));
  const notReadyMessage = (scale: number, detail: string): { message: string } => ({ message: `fixture not ready before the timeout at scale ${scale}: the machine got slower after calibration (${detail})` });

  it('the calibrated scale and the scaled bounds on each input class', () => {
    for (const [measured, scale] of [[0, 1], [432, 1], [750, 1], [751, 2], [3969, 6], [4325, 6], [5250, 7], [5251, 8], [6000, 8], [6001, 8], [60_000, 8]] as const) {
      assert.equal(scaleFor(measured), scale, `scaleFor(${measured})`);
    }
    for (const measured of [undefined, NaN, -1, Infinity, -Infinity]) {
      assert.throws(() => scaleFor(measured), { message: `calibration failed: ${String(measured)}` }, `scaleFor(${String(measured)})`);
    }
    assert.deepEqual(boundsAt(1), { timeoutMs: 1500, stayBoundMs: 6000, exitCloseMs: 3500, noKillBoundMs: 4500, slowKillBoundMs: 6000, goneWithinMs: 3000, syncBoundMs: 6000, runnerExitBoundMs: 6500 });
    assert.deepEqual(Object.values(boundsAt(4)), [6000, 24_000, 8000, 12_000, 13_500, 12_000, 23_000, 15_500]);
    assert.deepEqual(Object.values(boundsAt(8)), [12_000, 48_000, 14_000, 22_000, 23_500, 24_000, 29_000, 27_500]);
    assert.ok(boundsAt(8).stayBoundMs < 60_000);
    assert.ok(boundsAt(8).runnerExitBoundMs < 60_000);

    assert.throws(() => assertSleeperExisted({ sleeperWrittenMs: undefined, startedMs: 1000 }, 3000, 2), notReadyMessage(2, 'no sleeper pid file'));
    assertSleeperExisted({ sleeperWrittenMs: 4000, startedMs: 1000 }, 3000, 2);
    assert.throws(() => assertSleeperExisted({ sleeperWrittenMs: 4001, startedMs: 1000 }, 3000, 2), notReadyMessage(2, "the sleeper's pid file was written 3001 ms after the call, the timeout was 3000 ms"));

    for (const alive of [[], [false]]) assertRootGone(alive, 3);
    for (const alive of [[true], [false, true]]) assert.throws(() => assertRootGone(alive, 3), notReadyMessage(3, 'the tree kill found the root still running'));

    const naturalEnd = (gone: number): { message: string } => ({ message: `the sleeper was gone ${gone} ms after it wrote its pid file, within 1000 ms of its natural end after 60000 ms: the death check cannot tell a kill from that end` });
    assertKilledBeforeNaturalEnd(1000, 59_999);
    assert.throws(() => assertKilledBeforeNaturalEnd(1000, 60_000), naturalEnd(59_000));
    assert.throws(() => assertKilledBeforeNaturalEnd(1000, 61_000), naturalEnd(60_000));
    assert.throws(() => assertKilledBeforeNaturalEnd(undefined, 5), { message: 'no sleeper pid file' });

    const from = { GIT_DIR: 'a', git_work_tree: 'b', Git_Config_Global: 'c', GIT_CEILING_DIRECTORIES: 'd', NODE_OPTIONS: 'e', node_options: 'f', AIDLC_STATE_DIR: 'g', aidlc_state_dir: 'h', PATH: 'p', KEEP: 'k' };
    assert.deepEqual(fixtureEnv(dir, from), { PATH: 'p', KEEP: 'k', GIT_CEILING_DIRECTORIES: [dirname(dir), dirname(realpathSync.native(dir))].join(delimiter), AIDLC_STATE_DIR: join(dir, 'state') });
  });

  it('calibrate times the exit fixture and ends its sleeper, and returns undefined when the fixture cannot start', async (t) => {
    const ended: number[] = [];
    const measured = await calibrate(t, FIXTURE, ended);
    assert.ok(typeof measured === 'number' && Number.isFinite(measured) && measured > 0, `calibrate returned ${String(measured)}`);
    assert.equal(ended.length, 1);
    assert.equal(probe(ended[0]!), 'ESRCH');
    const missingDir = tmpDir('aidlc-exec-missing-');
    t.after(() => cleanup(missingDir));
    const missed = await calibrate(t, join(missingDir, 'missing.ts'));
    assert.equal(missed, undefined);
    assert.throws(() => scaleFor(missed), { message: 'calibration failed: undefined' });
  });

  describe('calibrate returns undefined on each failure of the spawned command', () => {
    // An inline child that writes the pid file the calibration looks for (its own pid), then runs `then`.
    const inline = (then: string) => (pidFile: string): [string, string[]] => [process.execPath, ['-e', `require('fs').writeFileSync(process.argv[1], String(process.pid)); ${then}`, pidFile]];
    it('a child that writes the pid file and exits 3', async (t) => {
      const ended: number[] = [];
      assert.equal(await calibrate(t, FIXTURE, ended, inline('process.exit(3)')), undefined);
      assert.equal(ended.length, 1);
    });
    it('a child that writes the pid file and kills itself', async (t) => {
      const ended: number[] = [];
      assert.equal(await calibrate(t, FIXTURE, ended, inline("process.kill(process.pid, 'SIGKILL')")), undefined);
      assert.equal(ended.length, 1);
    });
    it('a child that writes its own pid to <pidFile>.root and no pid file, with a limit of 5 s: undefined, the root gone, nothing ended', async (t) => {
      const ended: number[] = [];
      let pidFile = '';
      const command = (file: string): [string, string[]] => {
        pidFile = file;
        return [process.execPath, ['-e', "require('fs').writeFileSync(process.argv[1] + '.root', String(process.pid)); setTimeout(() => {}, 30_000)", file]];
      };
      assert.equal(await calibrate(t, FIXTURE, ended, command, 5000), undefined);
      const root = readPid(`${pidFile}.root`);
      assert.ok(root !== undefined, 'the child wrote its pid before the limit');
      await assertGoneWithin(root, 3000);
      assert.deepEqual(ended, []);
    });
    it('a root whose detached sleeper writes the pid file 1000 ms after the limit: undefined, the late sleeper ended', async (t) => {
      const ended: number[] = [];
      let pidFile = '';
      const sleeper = "setTimeout(() => require('fs').writeFileSync(process.argv[1], String(process.pid)), 6500); setTimeout(() => {}, 30_000)";
      const command = (file: string): [string, string[]] => {
        pidFile = file;
        const root = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(sleeper)}, process.argv[1]], { detached: true, stdio: 'ignore' }).unref(); setTimeout(() => {}, 30_000)`;
        return [process.execPath, ['-e', root, file]];
      };
      t.after(() => end(readPid(pidFile)));
      assert.equal(await calibrate(t, FIXTURE, ended, command, 6000), undefined);
      assert.equal(ended.length, 1);
      assert.equal(probe(ended[0]!), 'ESRCH');
    });
    it('a child that exits 0 without writing the pid file', async (t) => {
      const ended: number[] = [];
      assert.equal(await calibrate(t, FIXTURE, ended, () => [process.execPath, ['-e', 'process.exit(0)']]), undefined);
      assert.deepEqual(ended, []);
    });
    it('a command that does not exist, without waiting for the time limit', async (t) => {
      const ended: number[] = [];
      const started = Date.now();
      assert.equal(await calibrate(t, FIXTURE, ended, () => ['aidlc-no-such-command-for-calibrate', []], 10_000), undefined);
      assert.ok(Date.now() - started < 5000, 'the spawn error resolved the calibration, not the time limit');
      assert.deepEqual(ended, []);
    });
    it('a child that writes the pid file and sleeps 30 s, with a limit of 5 s: undefined at the limit, the child gone', async (t) => {
      const ended: number[] = [];
      const started = Date.now();
      assert.equal(await calibrate(t, FIXTURE, ended, inline('setTimeout(() => {}, 30_000)'), 5000), undefined);
      assert.ok(Date.now() - started < 20_000, 'the calibration ended at its limit, not when the child exited');
      assert.equal(ended.length, 1);
      assert.equal(probe(ended[0]!), 'ESRCH');
    });
  });
});

interface FixtureRun {
  receipt: ExecReceipt | undefined;
  elapsedMs: number;
  sleeper: number | undefined;
  root: number | undefined;
  startedMs: number;
  sleeperWrittenMs: number | undefined;
}

/** The modification time of the pid file the sleeper wrote itself, undefined when it is missing. */
function writtenMs(file: string): number | undefined {
  return existsSync(file) ? statSync(file).mtimeMs : undefined;
}

/**
 * Runs the fixture in `mode` with `timeoutMs` (default 1500) and races the receipt against `boundMs` from the call.
 * Every fixture process is ended in a `finally`, so a red run neither waits 60 s nor leaves a sleeper.
 */
async function raceFixture(runner: typeof run, mode: 'stay' | 'exit', boundMs: number, check: (r: FixtureRun) => void | Promise<void>, timeoutMs = TIMEOUT_MS): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'aidlc-exec-tree-'));
  const pidFile = join(dir, 'sleeper.pid');
  const started = Date.now();
  let bound: NodeJS.Timeout | undefined;
  try {
    const receipt = await Promise.race([
      runner(process.execPath, [FIXTURE, mode, pidFile], { timeoutMs }),
      new Promise<undefined>((r) => (bound = setTimeout(() => r(undefined), boundMs))),
    ]);
    const elapsedMs = Date.now() - started;
    // A receipt that settles while synchronous work holds the bound timer back still wins the race:
    // the elapsed time decides, not which promise settled first.
    if (receipt) assert.ok(elapsedMs <= boundMs, `receipt after ${elapsedMs} ms, past the ${boundMs} ms bound`);
    await check({ receipt, elapsedMs, sleeper: readPid(pidFile), root: readPid(`${pidFile}.root`), startedMs: started, sleeperWrittenMs: writtenMs(pidFile) });
  } finally {
    clearTimeout(bound);
    end(readPid(pidFile));
    end(readPid(`${pidFile}.root`));
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A tree kill that records the pid it is given and delegates to the production killProcessTree. */
function delegatingTreeKill(): { calls: number[]; aliveAtCall: boolean[]; treeKill: (pid: number) => void } {
  const calls: number[] = [];
  const aliveAtCall: boolean[] = [];
  return { calls, aliveAtCall, treeKill: (pid) => (calls.push(pid), aliveAtCall.push(probe(pid) === 'alive'), killProcessTree(pid, process.platform, runSync, (p, signal) => process.kill(p, signal))) };
}

describe('T0-EXEC-TREE-KILL the death check of acceptance 3', () => {
  const throwing = (code: string | undefined): KillZero => () => {
    throw Object.assign(new Error(`kill ${code ?? 'no code'}`), code === undefined ? {} : { code });
  };
  it('passes when process.kill(pid, 0) throws ESRCH', async () => {
    await assertGoneWithin(4242, 200, throwing('ESRCH'));
  });
  for (const [name, kill] of [
    ['throws EPERM', throwing('EPERM')],
    ['throws an error with no code (as a failed read does)', throwing(undefined)],
    ['keeps succeeding, as it does for a POSIX zombie', () => true],
  ] as [string, KillZero][]) {
    it(`fails when process.kill(pid, 0) ${name}`, async () => {
      await assert.rejects(assertGoneWithin(process.pid, 200, kill));
    });
  }
});

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

  it('acceptance 3: run on the stay fixture with timeoutMs 1500 times the calibrated scale resolves within 6 s times that scale, timed out and not ok, and the sleeper is gone', async (t) => {
    const b = await calibratedBounds(t);
    await raceFixture(run, 'stay', b.stayBoundMs, async ({ receipt, elapsedMs, sleeper, startedMs, sleeperWrittenMs }) => {
      assertSleeperExisted({ sleeperWrittenMs, startedMs }, b.timeoutMs, b.scale);
      assert.ok(receipt, `no receipt within ${b.stayBoundMs} ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      assert.equal(ok(receipt), false);
      assert.ok(sleeper !== undefined, 'the sleeper wrote its pid before the timeout');
      await assertGoneWithin(sleeper, b.goneWithinMs);
      assertKilledBeforeNaturalEnd(sleeperWrittenMs, Date.now());
    }, b.timeoutMs);
  });

  it('acceptance 4: createRun calls its tree kill once, with the root pid, in stay mode', async (t) => {
    const b = await calibratedBounds(t);
    const { calls, treeKill } = delegatingTreeKill();
    await raceFixture(createRun(treeKill), 'stay', b.stayBoundMs, ({ receipt, elapsedMs, root }) => {
      assert.ok(receipt, `no receipt within ${b.stayBoundMs} ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      assert.ok(root !== undefined, 'the root wrote its pid');
      assert.deepEqual(calls, [root]);
    }, b.timeoutMs);
  });

  it('acceptance 4: in exit mode (the root gone, the sleeper holding its output) the tree kill is never called and the receipt resolves within 6 s times the calibrated scale, timed out', async (t) => {
    const b = await calibratedBounds(t);
    const { calls, aliveAtCall, treeKill } = delegatingTreeKill();
    await raceFixture(createRun(treeKill), 'exit', b.stayBoundMs, ({ receipt, elapsedMs }) => {
      assertRootGone(aliveAtCall, b.scale);
      assert.ok(receipt, `no receipt within ${b.stayBoundMs} ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      assert.equal(ok(receipt), false);
      assert.deepEqual(calls, []);
      // [R3] stdout and stderr are destroyed at the timeout, so the close event of the exited root
      // resolves the receipt before the grace bound, with the exit the system reported for the root.
      assert.ok(elapsedMs < b.exitCloseMs, `resolved at ${elapsedMs} ms, not on the close event before the bound`);
      assert.equal(receipt.exitCode, 0);
      assert.equal(receipt.signal, null);
    }, b.timeoutMs);
  });

  it('acceptance 5: with a tree kill that kills nothing, the receipt resolves by (1500 + 1000) ms times the calibrated scale + TIMEOUT_GRACE_MS (2000), timed out, exitCode and signal null, root and sleeper still alive', async (t) => {
    const b = await calibratedBounds(t);
    assert.equal(TIMEOUT_GRACE_MS, 2000);
    const calls: number[] = [];
    const bound = b.noKillBoundMs;
    await raceFixture(createRun((pid) => void calls.push(pid)), 'stay', bound, ({ receipt, elapsedMs, sleeper, root, startedMs, sleeperWrittenMs }) => {
      assertSleeperExisted({ sleeperWrittenMs, startedMs }, b.timeoutMs, b.scale);
      const rootState = calls.length === 1 ? probe(calls[0]!) : `tree kill called ${calls.length} times`;
      const sleeperState = sleeper !== undefined ? probe(sleeper) : 'no sleeper pid';
      assert.ok(receipt, `no receipt within ${bound} ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      assert.equal(ok(receipt), false);
      assert.equal(receipt.exitCode, null);
      assert.equal(receipt.signal, null);
      assert.deepEqual(calls, [root], 'the tree kill was called once, with the root pid');
      assert.equal(rootState, 'alive', 'the root is still alive at the receipt');
      assert.equal(sleeperState, 'alive', 'the sleeper is still alive at the receipt');
    }, b.timeoutMs);
  });

  it('acceptance 5 [R3]: the bound counts from the return of a tree kill that takes 1500 ms and kills nothing, not from the timeout', async (t) => {
    const b = await calibratedBounds(t);
    let returnedAt = 0;
    const slowKill = (): void => {
      const until = Date.now() + SLOW_KILL_MS;
      while (Date.now() < until) {
        /* a tree kill that blocks, as a slow taskkill or ps does */
      }
      returnedAt = Date.now();
    };
    await raceFixture(createRun(slowKill), 'stay', b.slowKillBoundMs, ({ receipt, elapsedMs }) => {
      assert.ok(receipt, `no receipt within ${b.slowKillBoundMs} ms of the call (${elapsedMs} ms)`);
      assert.equal(receipt.timedOut, true);
      const waited = Date.parse(receipt.finishedAt) - returnedAt;
      assert.ok(waited >= 2000 - 50, `resolved ${waited} ms after the tree kill returned, before TIMEOUT_GRACE_MS (2000)`);
    }, b.timeoutMs);
  });
});

describe('T0-EXEC-TREE-KILL a timed-out runner releases every handle at the bound [R3]', () => {
  it('acceptance 5 [R3]: with a tree kill that kills nothing and a large input the root never reads, the runner process exits on its own after the receipt, the root still alive at the receipt', async (t) => {
    const b = await calibratedBounds(t);
    const dir = mkdtempSync(join(tmpdir(), 'aidlc-exec-tree-'));
    const pidFile = join(dir, 'sleeper.pid');
    // The runner's node start, the 1500 ms timeout, TIMEOUT_GRACE_MS (2000) and 3000 ms of slack: only the slack scales.
    const boundMs = b.runnerExitBoundMs;
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
      t.diagnostic(`runner exited after ${elapsedMs} ms`);
      assert.equal(exited, true, `the runner process is still running ${elapsedMs} ms after its start`);
      assert.ok(elapsedMs <= boundMs, `the runner exited after ${elapsedMs} ms, past the ${boundMs} ms bound`);
      assert.equal(existsSync(`${pidFile}.receipt`) ? readFileSync(`${pidFile}.receipt`, 'utf8') : 'no receipt', 'resolved timedOut=true exitCode=null root=alive');
    } finally {
      clearTimeout(bound);
      end(runner.pid);
      end(readPid(pidFile));
      end(readPid(`${pidFile}.root`));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * The sentences this card appends to the pre-review command paragraph of docs/OPERATIONS.md. Its third
 * sentence, on the synchronous runner's limit, was replaced by card T0-EXEC-SYNC-TREE-KILL (its R5),
 * whose tests/infra/exec-sync-tree.test.ts pins the replacement and the old sentence's absence.
 */
const OPERATIONS_SENTENCES = [
  "A command the async runner starts (the R2 and R3 reviewers, the claude-code provider of `aidlc run`) is ended at its `timeoutMs` with its whole process tree: on Windows by `taskkill /T /F` on the root's pid, elsewhere by `SIGKILL` to the root and to each of its descendants found in one process-table read (card T0-EXEC-TREE-KILL).",
  'Its receipt then resolves with `timedOut` true no later than 2000 ms after the timeout or the tree kill, whichever ends later, whatever a surviving descendant still holds open.',
];
/** The exec.ts sentence as card T0-EXEC-SYNC-TREE-KILL (its R6) extended it with the `runSync` clause. */
const ARCHITECTURE_SENTENCE = "`exec.ts` runs commands and returns receipts (exit, output digest, timing), the async runner ending a timed-out command's whole process tree and `runSync` with `killTree` running the command under `exec-tree-helper.ts`, which applies that tree kill, with a scripted runner for tests.";
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
    // 2 OPERATIONS sentences, the ARCHITECTURE sentence, 3 CHANGELOG sentences.
    assert.equal(removals.length, 6);
    for (const [sentence, holds] of removals) assert.equal(holds(), false, `removing this text still passes: ${sentence}`);
  });
});

// ---------------------------------------------------------------------------------------------
// T0-EXEC-SYNC-TREE-KILL: runSync with killTree runs the command under exec-tree-helper.ts.
// ---------------------------------------------------------------------------------------------

describe('T0-EXEC-SYNC-TREE-KILL runSync with killTree on real processes [R1] [R2]', () => {
  it("acceptance 1: on the stay fixture with timeoutMs 1500 times the calibrated scale returns within 6 s times that scale and before the helper's backstop, timed out and not ok, with the caller's command, args and cwd, and the sleeper is gone", async (t) => {
    const b = await calibratedBounds(t);
    const dir = mkdtempSync(join(tmpdir(), 'aidlc-exec-sync-tree-'));
    const pidFile = join(dir, 'sleeper.pid');
    const args = [FIXTURE, 'stay', pidFile];
    try {
      const started = Date.now();
      // The caller's cwd is the system temp dir, not `dir`: a leaked process holding `dir` as its cwd would make the cleanup fail instead of the assertion.
      const receipt = runSync(process.execPath, args, { cwd: tmpdir(), timeoutMs: b.timeoutMs, killTree: true });
      const elapsedMs = Date.now() - started;
      const sleeperWrittenMs = writtenMs(pidFile);
      assertSleeperExisted({ sleeperWrittenMs, startedMs: started }, b.timeoutMs, b.scale);
      assert.ok(elapsedMs <= b.syncBoundMs, `runSync returned after ${elapsedMs} ms, past the ${b.syncBoundMs} ms bound`);
      assert.ok(!receipt.stderr.startsWith('[tree helper error]'), `runSync returned the helper's backstop receipt: ${receipt.stderr}`);
      assert.equal(receipt.timedOut, true);
      assert.equal(ok(receipt), false);
      assert.equal(receipt.command, process.execPath);
      assert.deepEqual(receipt.args, args);
      assert.equal(receipt.cwd, tmpdir());
      const sleeper = readPid(pidFile);
      assert.ok(sleeper !== undefined, 'the sleeper wrote its pid before the timeout');
      await assertGoneWithin(sleeper, b.goneWithinMs);
      assertKilledBeforeNaturalEnd(sleeperWrittenMs, Date.now());
    } finally {
      end(readPid(pidFile));
      end(readPid(`${pidFile}.root`));
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("acceptance 2: returns the command's own exit code 3, stdout and stderr, and passes input to it on stdin", () => {
    const args = ['-e', 'process.stdin.on("data", d => process.stdout.write(String(d).toUpperCase())); process.stdin.on("end", () => { process.stderr.write("warn"); process.exit(3); })'];
    const receipt = runSync(process.execPath, args, { timeoutMs: 30_000, killTree: true, input: 'abc' });
    assert.equal(receipt.exitCode, 3);
    assert.equal(receipt.signal, null);
    assert.equal(receipt.timedOut, false);
    assert.equal(receipt.stdout, 'ABC');
    assert.equal(receipt.stderr, 'warn');
    assert.equal(receipt.command, process.execPath);
    assert.deepEqual(receipt.args, args);
    assert.equal(ok(receipt), false);
  });
});

/**
 * The largest output the direct runner returns whole: its spawnSync `maxBuffer` is 64 MiB over stdout and
 * stderr together, and an output that reaches it ends the command (ENOBUFS). Split as 32 MiB of stdout and
 * 32 MiB - 1 byte of stderr.
 */
const [OUT_BYTES, ERR_BYTES] = [32 * 1024 * 1024, 32 * 1024 * 1024 - 1];

describe('T0-EXEC-SYNC-TREE-KILL worst-case output and input through the helper (R3 decision 1 F2) [R2]', () => {
  for (const [name, byte, char] of [
    ['NUL bytes', 0x00, '\u0000'],
    ['invalid UTF-8 (0xFF, one U+FFFD per byte, as the direct runner decodes it)', 0xff, '�'],
  ] as [string, number, string][]) {
    it(`a command writing 64 MiB - 1 byte of ${name} (32 MiB to stdout, the rest to stderr) returns exit 0 and both outputs whole, as the direct runner does`, () => {
      const args = ['-e', `process.stdout.write(Buffer.alloc(${OUT_BYTES}, ${byte})); process.stderr.write(Buffer.alloc(${ERR_BYTES}, ${byte}))`];
      const [expectedOut, expectedErr] = [char.repeat(OUT_BYTES), char.repeat(ERR_BYTES)];
      const direct = runSync(process.execPath, args, { timeoutMs: 120_000 });
      assert.ok(direct.exitCode === 0 && direct.stdout === expectedOut && direct.stderr === expectedErr, `direct runner: exit ${direct.exitCode}, stdout ${direct.stdout.length} chars, stderr ${JSON.stringify(direct.stderr.slice(-200))}`);
      const r = runSync(process.execPath, args, { timeoutMs: 120_000, killTree: true });
      assert.equal(r.exitCode, 0, `stderr: ${r.stderr.slice(0, 300)}`);
      assert.equal(r.timedOut, false);
      assert.ok(r.stdout === expectedOut, `stdout: ${r.stdout.length} chars, not ${OUT_BYTES} of ${name}`);
      assert.ok(r.stderr === expectedErr, `stderr: ${r.stderr.length} chars, not ${ERR_BYTES} of ${name}; starts ${JSON.stringify(r.stderr.slice(0, 200))}`);
    });
  }

  it('a 96 MiB input of NUL characters reaches the command whole, as it does through the direct runner', () => {
    const args = ['-e', 'let n = 0; process.stdin.on("data", (d) => (n += d.length)); process.stdin.on("end", () => process.stdout.write(String(n)))'];
    const input = '\u0000'.repeat(96 * 1024 * 1024);
    assert.equal(runSync(process.execPath, args, { timeoutMs: 120_000, input }).stdout, '100663296');
    let r: ExecReceipt | undefined;
    assert.doesNotThrow(() => (r = runSync(process.execPath, args, { timeoutMs: 120_000, killTree: true, input })));
    assert.equal(r?.exitCode, 0, `stderr: ${r?.stderr.slice(0, 300)}`);
    assert.equal(r?.stdout, '100663296');
  });
});

describe('T0-EXEC-SYNC-TREE-KILL shell commands through the helper (R2 suggestion) [R1]', () => {
  it('shell: true runs through the shell as on the direct path: quoted args stay whole and the shell expands a variable', () => {
    const variable = process.platform === 'win32' ? '%AIDLC_SHELL_PROBE%' : '$AIDLC_SHELL_PROBE';
    const args = ['-e', "process.stdout.write(process.argv.slice(1).join('|'))", 'a b', 'x&y', variable];
    const env = { ...process.env, AIDLC_SHELL_PROBE: 'expanded' };
    const direct = runSync('node', args, { shell: true, env, timeoutMs: 30_000 });
    const r = runSync('node', args, { shell: true, env, timeoutMs: 30_000, killTree: true });
    assert.equal(direct.stdout, 'a b|x&y|expanded');
    assert.equal(r.stdout, 'a b|x&y|expanded', `stderr: ${r.stderr.slice(0, 300)}`);
    assert.equal(r.exitCode, 0);
  });

  it('without shell, the needsShell fallback runs npm as on the direct path', () => {
    const direct = runSync('npm', ['--version'], { timeoutMs: 60_000 });
    const r = runSync('npm', ['--version'], { timeoutMs: 60_000, killTree: true });
    assert.equal(direct.exitCode, 0, direct.stderr);
    assert.match(direct.stdout, /^\d+\.\d+\.\d+/);
    assert.equal(r.exitCode, 0, r.stderr.slice(0, 300));
    assert.equal(r.stdout, direct.stdout);
  });
});

type SpawnCall = { command: string; args: string[]; options: SpawnSyncOptions };
type SpawnAnswer = { status?: number | null; signal?: NodeJS.Signals | null; stdout?: string | Buffer; stderr?: string | Buffer; error?: Error };

/** A spawnSync stand-in that records each call and answers with `answer`, its outputs in the encoding asked for. */
function recordingSpawner(answer: SpawnAnswer): { spawner: SpawnSyncFn; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  const spawner = (command: string, args: string[], options: SpawnSyncOptions) => {
    calls.push({ command, args, options });
    const as = (v: string | Buffer | undefined) => (options.encoding === 'buffer' ? Buffer.from(v ?? '') : String(v ?? ''));
    return { pid: 1, output: [], status: 0, signal: null, ...answer, stdout: as(answer.stdout), stderr: as(answer.stderr) };
  };
  return { calls, spawner: spawner as unknown as SpawnSyncFn };
}

/** The helper's transport: a JSON header line, then the stdout and stderr bytes. */
function transport(header: Record<string, unknown>, stdout: string, stderr: string): Buffer {
  const [out, err] = [Buffer.from(stdout), Buffer.from(stderr)];
  return Buffer.concat([Buffer.from(`${JSON.stringify({ stdoutBytes: out.length, stderrBytes: err.length, ...header })}\n`), out, err]);
}

const EXEC_MODULE = new URL('../../src/probes/exec.ts', import.meta.url).href;
const HELPER_TS = fileURLToPath(new URL('../../src/probes/exec-tree-helper.ts', import.meta.url));
const HELPER_HEADER = { exitCode: 3, signal: null, timedOut: false };
const HELPER_OUTPUT = transport(HELPER_HEADER, 'out', 'err');

describe('T0-EXEC-SYNC-TREE-KILL the helper start and its receipt [R1] [R2] [R3]', () => {
  it('acceptance 3: the helper path is exec-tree-helper.ts beside a .ts exec module and exec-tree-helper.js beside a .js one', () => {
    assert.equal(treeHelperPath(EXEC_MODULE), HELPER_TS);
    assert.ok(existsSync(HELPER_TS));
    assert.equal(treeHelperPath(new URL('../../dist/probes/exec.js', import.meta.url).href), fileURLToPath(new URL('../../dist/probes/exec-tree-helper.js', import.meta.url)));
  });

  it("acceptance 3 [R1]: starts node on the helper with the caller's cwd and env, a JSON header line on stdin (command, args, timeoutMs, shell, inputBytes) and the input bytes after it, a backstop of timeoutMs + TIMEOUT_GRACE_MS + TREE_HELPER_BACKSTOP_MS (15 000 ms), a buffer transport of 3 x 64 MiB + 1 MiB", () => {
    assert.equal(TREE_HELPER_BACKSTOP_MS, 15_000);
    const { spawner, calls } = recordingSpawner({ stdout: HELPER_OUTPUT });
    const env = { AIDLC_TEST_MARKER: 'env-marker' };
    createRunSync(spawner)('deploy', ['--to', 'staging'], { cwd: '/work', env, timeoutMs: 1500, input: 'payload \u0000 é', shell: false, killTree: true });
    assert.equal(calls.length, 1);
    const { command, args, options } = calls[0]!;
    assert.equal(command, process.execPath);
    assert.deepEqual(args, [HELPER_TS]);
    assert.equal(options.cwd, '/work');
    assert.equal(options.env, env);
    assert.equal(options.timeout, 1500 + TIMEOUT_GRACE_MS + TREE_HELPER_BACKSTOP_MS);
    assert.equal(options.shell, false);
    assert.equal(options.encoding, 'buffer');
    assert.equal(options.maxBuffer, 3 * 64 * 1024 * 1024 + 1024 * 1024);
    const stdin = options.input as Buffer;
    const eol = stdin.indexOf(0x0a);
    assert.deepEqual(JSON.parse(stdin.subarray(0, eol).toString('utf8')), { command: 'deploy', args: ['--to', 'staging'], timeoutMs: 1500, shell: false, inputBytes: 12 });
    assert.equal(stdin.subarray(eol + 1).toString('utf8'), 'payload \u0000 é');
  });

  it("acceptance 3 [R2]: a helper transport gives the command's exit, signal, timedOut, stdout and stderr under the caller's command, args and cwd", () => {
    const { spawner } = recordingSpawner({ stdout: HELPER_OUTPUT });
    const r = createRunSync(spawner)('deploy', ['--to', 'staging'], { cwd: '/work', timeoutMs: 1500, killTree: true });
    assert.deepEqual([r.command, r.args, r.cwd], ['deploy', ['--to', 'staging'], '/work']);
    assert.deepEqual([r.exitCode, r.signal, r.timedOut, r.stdout, r.stderr], [3, null, false, 'out', 'err']);
    assert.match(r.outputSha256, /^[a-f0-9]{64}$/);
  });

  for (const [name, answer] of [
    ['an empty stdout (exit 1)', { status: 1, stdout: '' }],
    ['a stdout that is not JSON (exit 0)', { status: 0, stdout: 'not json\n' }],
    ['JSON that is not a receipt (exit 0)', { status: 0, stdout: transport({ ...HELPER_HEADER, exitCode: '3' }, 'out', 'err') }],
    ['a header with no line end (exit 0)', { status: 0, stdout: JSON.stringify({ ...HELPER_HEADER, stdoutBytes: 0, stderrBytes: 0 }) }],
    ['a body shorter than the header says, as a truncated transport is (exit 0)', { status: 0, stdout: HELPER_OUTPUT.subarray(0, HELPER_OUTPUT.length - 1) }],
    ['a body longer than the header says (exit 0)', { status: 0, stdout: Buffer.concat([HELPER_OUTPUT, Buffer.from('x')]) }],
    ['a negative byte count (exit 0)', { status: 0, stdout: transport({ ...HELPER_HEADER, stdoutBytes: -1, stderrBytes: 7 }, 'out', 'err') }],
    ['a well-formed transport with a helper exit 2', { status: 2, stdout: HELPER_OUTPUT }],
  ] as [string, SpawnAnswer][]) {
    it(`acceptance 3 [R2]: ${name} gives exitCode null, not ok, stderr beginning [tree helper error] with the helper's exit code`, () => {
      const { spawner } = recordingSpawner({ ...answer, stderr: 'helper crashed' });
      const r = createRunSync(spawner)('deploy', ['--to', 'staging'], { cwd: '/work', timeoutMs: 1500, killTree: true });
      assert.equal(r.exitCode, null);
      assert.equal(ok(r), false);
      assert.equal(r.timedOut, false);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, `[tree helper error] exit ${answer.status}\nhelper crashed`);
      assert.deepEqual([r.command, r.args, r.cwd], ['deploy', ['--to', 'staging'], '/work']);
    });
  }

  it('acceptance 3 [R2]: a helper that reaches its backstop gives timedOut true, exitCode null and a [tree helper error]', () => {
    const { spawner } = recordingSpawner({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
    const r = createRunSync(spawner)('deploy', [], { timeoutMs: 1500, killTree: true });
    assert.equal(r.timedOut, true);
    assert.equal(r.exitCode, null);
    assert.equal(ok(r), false);
    assert.equal(r.stderr, '[tree helper error] exit null (SIGTERM, backstop 18500 ms)\n');
  });

  it('acceptance 3 [R2]: a helper transport that overflows (ENOBUFS) gives exitCode null and a [tree helper error], never a partial receipt', () => {
    const { spawner } = recordingSpawner({ status: null, signal: 'SIGTERM', stdout: HELPER_OUTPUT.subarray(0, 20), error: Object.assign(new Error('spawnSync node ENOBUFS'), { code: 'ENOBUFS' }) });
    const r = createRunSync(spawner)('deploy', [], { timeoutMs: 1500, killTree: true });
    assert.deepEqual([r.exitCode, r.timedOut, r.stdout], [null, false, '']);
    assert.equal(r.stderr, '[tree helper error] exit null (SIGTERM)\n\n[spawn error] spawnSync node ENOBUFS');
  });

  for (const [name, options] of [
    ['killTree without timeoutMs', { killTree: true }],
    ['timeoutMs without killTree', { timeoutMs: 1500 }],
  ] as [string, ExecOptions][]) {
    it(`acceptance 2 [R3]: ${name} spawns the command itself, never the helper`, () => {
      const { spawner, calls } = recordingSpawner({ stdout: 'direct' });
      const r = createRunSync(spawner)('git', ['status'], options);
      assert.deepEqual(calls.map((c) => [c.command, c.args, c.options.timeout]), [['git', ['status'], options.timeoutMs]]);
      assert.equal(r.stdout, 'direct');
    });
  }
});

/**
 * A root that starts the fixture's sleeper through a shell, with no pipe to it, waits for its pid file and
 * then writes to stdout without end: `node -e OVERFLOW_ROOT <fixture> <pidFile>`.
 */
const OVERFLOW_ROOT = [
  "const { spawn } = require('node:child_process');",
  "const { existsSync } = require('node:fs');",
  'const [fixture, pidFile] = process.argv.slice(1);',
  'const q = (s) => `"${s}"`;',
  "spawn(`${q(process.execPath)} ${q(fixture)} sleeper ${q(pidFile)}`, { shell: true, stdio: 'ignore' });",
  'const poll = setInterval(() => {',
  '  if (!existsSync(pidFile)) return;',
  '  clearInterval(poll);',
  '  const chunk = Buffer.alloc(1 << 20, 120);',
  "  const flood = () => { while (process.stdout.write(chunk)) {} process.stdout.once('drain', flood); };",
  '  flood();',
  '}, 20);',
].join('\n');

describe('T0-EXEC-SYNC-TREE-KILL the 64 MiB output limit through the helper (R3 decision 2 N2) [R2]', () => {
  it('a command whose output passes 64 MiB is ended with its tree before its timeout and reported as the direct runner reports ENOBUFS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidlc-exec-sync-tree-'));
    const [directPid, helperPid] = [join(dir, 'direct.pid'), join(dir, 'helper.pid')];
    try {
      const direct = runSync(process.execPath, ['-e', OVERFLOW_ROOT, FIXTURE, directPid], { cwd: tmpdir(), timeoutMs: 20_000 });
      const started = Date.now();
      const r = runSync(process.execPath, ['-e', OVERFLOW_ROOT, FIXTURE, helperPid], { cwd: tmpdir(), timeoutMs: 20_000, killTree: true });
      const elapsedMs = Date.now() - started;
      const enobufs = /\n\[spawn error\] spawn(Sync)? .+ ENOBUFS$/;
      assert.deepEqual([direct.exitCode, direct.signal, direct.timedOut], [null, 'SIGTERM', false]);
      assert.match(direct.stderr, enobufs);
      assert.deepEqual([r.exitCode, r.signal, r.timedOut], [null, 'SIGTERM', false], `stderr: ${r.stderr.slice(-300)}`);
      assert.match(r.stderr, enobufs);
      assert.equal(ok(r), false);
      assert.ok(elapsedMs < 15_000, `runSync returned after ${elapsedMs} ms, not before the 20 000 ms timeout`);
      assert.ok(r.stdout.length > 64 * 1024 * 1024 - (1 << 20) && r.stdout.length <= 65 * 1024 * 1024, `stdout of ${r.stdout.length} chars, not the 64 MiB limit and at most one more MiB`);
      const sleeper = readPid(helperPid);
      assert.ok(sleeper !== undefined, 'the sleeper wrote its pid before the flood');
      await assertGoneWithin(sleeper, 3000);
    } finally {
      end(readPid(directPid));
      end(readPid(helperPid));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** Prints the parent pid after 300 ms: the test's own pid on the direct path, the helper's under the helper. */
const PPID_AFTER_300MS = ['-e', 'setTimeout(() => process.stdout.write(String(process.ppid)), 300)'];

describe('T0-EXEC-SYNC-TREE-KILL timeouts past the largest timer delay (R3 decision 2 N3) [R3]', () => {
  it('timeoutMs 2 147 483 647, the largest timer delay, runs under the helper and the command ends on its own', () => {
    const r = runSync(process.execPath, PPID_AFTER_300MS, { timeoutMs: 2_147_483_647, killTree: true });
    assert.deepEqual([r.exitCode, r.timedOut], [0, false], r.stderr.slice(0, 300));
    assert.match(r.stdout, /^\d+$/);
    assert.notEqual(Number(r.stdout), process.pid);
  });

  it('timeoutMs 2 147 483 648 with killTree refuses a real command, which never runs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aidlc-exec-sync-tree-'));
    const marker = join(dir, 'ran');
    try {
      const r = runSync(process.execPath, ['-e', 'require("node:fs").writeFileSync(process.argv[1], "x")', marker], { timeoutMs: 2_147_483_648, killTree: true });
      assert.equal(r.exitCode, null);
      assert.match(r.stderr, /^\[tree helper error\] unsupported timeoutMs/);
      assert.equal(existsSync(marker), false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const timeoutMs of [2_147_483_648, Number.MAX_SAFE_INTEGER + 2, 1500.5, Infinity, -1]) {
    it(`timeoutMs ${timeoutMs} with killTree spawns nothing and returns the refusal`, () => {
      const { spawner, calls } = recordingSpawner({ stdout: 'direct' });
      const r = createRunSync(spawner)('git', ['status'], { timeoutMs, killTree: true });
      assert.deepEqual(calls, []);
      assert.deepEqual([r.exitCode, ok(r)], [null, false]);
      assert.match(r.stderr, /^\[tree helper error\] unsupported timeoutMs/);
    });
  }

  it('timeoutMs 2 147 483 647 with killTree spawns the helper', () => {
    const { spawner, calls } = recordingSpawner({ stdout: HELPER_OUTPUT });
    createRunSync(spawner)('git', ['status'], { timeoutMs: 2_147_483_647, killTree: true });
    assert.deepEqual(calls.map((c) => [c.command, c.args]), [[process.execPath, [HELPER_TS]]]);
  });
});
