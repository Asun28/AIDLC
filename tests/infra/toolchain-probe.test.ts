/**
 * aidlc doctor toolchain lines (card T0-DOCTOR-PROBE-TIMEOUT, issue 371): a version probe that does not exit is ended at
 * the bound and reported as unknown, not as MISSING.
 */
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { run, type ExecOptions, type ExecReceipt, type Runner } from '../../src/probes/exec.ts';
import { TOOLCHAIN_PROBE_TIMEOUT_MS, toolchainReport } from '../../src/probes/toolchain.ts';
import { cleanup, tmpDir } from './helpers.ts';

/** A child that records its pid in the file named by its first argument, then never exits. */
const HANG = "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);";

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

function receipt(command: string, args: string[], over: Partial<ExecReceipt>): ExecReceipt {
  return { command, args, cwd: '.', exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', startedAt: '', finishedAt: '', durationMs: 0, outputSha256: '', ...over };
}

describe('toolchainReport (card T0-DOCTOR-PROBE-TIMEOUT)', () => {
  const dir = tmpDir();
  after(() => cleanup(dir));

  test('acceptance 1: a tool that never exits is ended at the bound and reported as unknown, not MISSING', { timeout: 20_000 }, async () => {
    const pidFiles: string[] = [];
    const hanging: Runner = (command, _args, options) => {
      const file = path.join(dir, `${command}.pid`);
      pidFiles.push(file);
      // A runner given no bound (the rule of main) still ends the child at 10 s, so that rule fails the assertions, not the run.
      return run(process.execPath, ['-e', HANG, file], { ...options, timeoutMs: options?.timeoutMs ?? 10_000 });
    };
    const started = Date.now();
    const report = await toolchainReport(hanging, 500);
    assert.ok(Date.now() - started < 15_000, 'the report resolves within 15 s');
    assert.deepEqual(report, {
      git: 'unknown: git --version did not exit within 500 ms',
      gh: 'unknown: gh --version did not exit within 500 ms',
      pwsh: 'unknown: pwsh -v did not exit within 500 ms',
    });
    assert.equal(pidFiles.length, 3);
    for (const file of pidFiles) {
      const pid = Number(readFileSync(file, 'utf8'));
      assert.ok(Number.isInteger(pid) && pid > 0, `${file} holds a pid`);
      assert.equal(alive(pid), false, `pid ${pid} is no longer running`);
    }
  });

  test('acceptance 2: the three calls, the default bound and each outcome of a receipt', async () => {
    const calls: [string, string[], ExecOptions | undefined][] = [];
    const scripted = (over: Record<string, Partial<ExecReceipt>>): Runner => async (command, args, options) => {
      calls.push([command, args, options]);
      return receipt(command, args, over[command] ?? {});
    };
    const report = await toolchainReport(
      scripted({
        git: { stdout: 'git version 2.50.0\nsecond line\n' },
        gh: { stdout: '', stderr: '  gh version 2.87.0 (2026-02-18)\r\nhttps://example.invalid\r\n' },
        pwsh: { exitCode: 0, timedOut: true, stdout: 'PowerShell 7.6.0' },
      }),
    );
    assert.equal(TOOLCHAIN_PROBE_TIMEOUT_MS, 120_000);
    assert.deepEqual(calls, [
      ['git', ['--version'], { timeoutMs: 120_000 }],
      ['gh', ['--version'], { timeoutMs: 120_000 }],
      ['pwsh', ['-v'], { timeoutMs: 120_000 }],
    ]);
    assert.deepEqual(report, {
      git: 'git version 2.50.0',
      gh: 'gh version 2.87.0 (2026-02-18)',
      pwsh: 'unknown: pwsh -v did not exit within 120000 ms',
    });

    calls.length = 0;
    const failed = await toolchainReport(
      scripted({
        git: { exitCode: 1, stdout: 'git version 2.50.0' },
        gh: { exitCode: null, stderr: '\n[spawn error] spawn gh ENOENT' },
        pwsh: { exitCode: 127 },
      }),
      700,
    );
    assert.deepEqual(calls.map((c) => c[2]), [{ timeoutMs: 700 }, { timeoutMs: 700 }, { timeoutMs: 700 }]);
    assert.deepEqual(failed, { git: 'MISSING', gh: 'MISSING (needed for remote ship)', pwsh: 'MISSING (needed for scaffold ship path)' });

    const timedOut = await toolchainReport(scripted({ git: { timedOut: true, exitCode: null }, gh: { timedOut: true, exitCode: 1 }, pwsh: { timedOut: true } }), 700);
    assert.deepEqual(timedOut, {
      git: 'unknown: git --version did not exit within 700 ms',
      gh: 'unknown: gh --version did not exit within 700 ms',
      pwsh: 'unknown: pwsh -v did not exit within 700 ms',
    });
  });

  test('T1-GIT-MIN-VERSION acceptance 6: the git line is marked on exit 0 only', async () => {
    const gitLine = async (over: Partial<ExecReceipt>): Promise<string> =>
      (await toolchainReport(async (command, args) => receipt(command, args, command === 'git' ? over : {}), 700)).git;
    assert.equal(await gitLine({ stdout: 'git version 2.44.2\n' }), 'git version 2.44.2 (UNSUPPORTED: aidlc needs git 2.45 or newer)');
    assert.equal(await gitLine({ stdout: '' }), 'UNREADABLE: "" names no git version; aidlc needs git 2.45 or newer');
    assert.equal(await gitLine({ exitCode: 1, stdout: 'git version 2.44.2' }), 'MISSING');
    assert.equal(await gitLine({ timedOut: true, stdout: 'git version 2.44.2' }), 'unknown: git --version did not exit within 700 ms');
  });
});
