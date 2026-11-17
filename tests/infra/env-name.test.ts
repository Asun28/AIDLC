/**
 * Card T0-ENV-CASE (issue 307): SystemRoot, windir and SystemDrive are read from a caller-supplied environment object in any
 * letter case on win32, through one pure helper, so a copy of an environment started in Git Bash (SYSTEMROOT, WINDIR,
 * SYSTEMDRIVE) finds the system root and drive.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ProjectConfig, resolveWorktreeRoot } from '../../src/config.ts';
import { envValue } from '../../src/core/env-name.ts';
import { killProcessTree, scriptedRunner, type Runner, type SyncRunner } from '../../src/probes/exec.ts';
import { listProcesses } from '../../src/probes/processes.ts';
import { fragmentEntry } from './changelog.ts';

const repo = path.resolve(import.meta.dirname, '..', '..');
const NOW_MS = Date.parse('2026-11-17T05:00:00.000Z');

describe('envValue (card T0-ENV-CASE) [R1]', () => {
  // Each row holds one rule's trigger: [platform, env, name, expected, rule].
  const rows: Array<[NodeJS.Platform, NodeJS.ProcessEnv, string, string | undefined, string]> = [
    ['win32', { SYSTEMROOT: 'D:\\Win' }, 'SystemRoot', 'D:\\Win', 'another letter case counts on win32'],
    ['win32', { SystemRoot: 'D:\\A', SYSTEMROOT: 'E:\\B' }, 'SystemRoot', 'D:\\A', 'the exact spelling first'],
    ['win32', { SYSTEMROOT: 'E:\\B', SystemRoot: 'D:\\A' }, 'SystemRoot', 'D:\\A', 'the exact spelling first, standing after another'],
    ['win32', { SystemRoot: '', SYSTEMROOT: 'E:\\B' }, 'SystemRoot', 'E:\\B', 'an empty value is missing'],
    ['win32', { systemroot: 'F:\\C', SYSTEMROOT: 'E:\\B' }, 'SystemRoot', 'F:\\C', 'the other spellings in key order'],
    ['win32', {}, 'SystemRoot', undefined, 'no spelling gives undefined'],
    ['linux', { SYSTEMROOT: 'D:\\Win' }, 'SystemRoot', undefined, 'only the exact name off win32'],
    ['linux', { HOME: '' }, 'HOME', undefined, 'an empty value is missing off win32'],
    ['linux', { HOME: '/home/u' }, 'HOME', '/home/u', 'the exact name is read off win32'],
    ['win32', { PATH: 'C:\\bin', SYSTEMROOT: 'D:\\Win' }, 'SystemRoot', 'D:\\Win', 'a key of another name before a matching one does not count'],
    ['win32', { PATH: 'C:\\bin' }, 'SystemRoot', undefined, 'a key of another name alone gives undefined'],
    ['win32', Object.defineProperty({}, 'SYSTEMROOT', { value: 'D:\\Win' }), 'SystemRoot', 'D:\\Win', 'a non-enumerable own key counts (R3 decision 1 F1)'],
    ['win32', Object.assign(Object.create({ SystemRoot: 'X:\\Proto' }), { SYSTEMROOT: 'D:\\Own' }), 'SystemRoot', 'D:\\Own', 'an inherited exact name is not an own key (R3 decision 1 F3)'],
  ];
  for (const [platform, env, name, expected, rule] of rows) {
    test(`${rule}: ${platform} ${JSON.stringify(env)} read as ${name} gives ${String(expected)}`, () => {
      assert.equal(envValue(env, name, platform), expected);
    });
  }
});

/** A sync runner that records each command and answers exit 0. */
function syncRecorder(): { runner: SyncRunner; commands: string[] } {
  const inner = scriptedRunner({ '': { exitCode: 0 } });
  const commands: string[] = [];
  return { commands, runner: (command, args, options) => (commands.push(command), inner(command, args, options)) };
}

/** An async runner that records each command and answers exit 0 with an empty listing. */
function asyncRecorder(): { runner: Runner; commands: string[] } {
  const inner = scriptedRunner({ '': { exitCode: 0, stdout: '[]' } });
  const commands: string[] = [];
  return { commands, runner: async (command, args, options) => (commands.push(command), inner(command, args, options)) };
}

describe('the three reads take an environment whose names are upper case (card T0-ENV-CASE, issue 307) [R2]', () => {
  const kills: Array<[NodeJS.ProcessEnv, string]> = [
    [{ SYSTEMROOT: 'D:\\Windows' }, 'D:\\Windows\\System32\\taskkill.exe'],
    [{ WINDIR: 'E:\\W' }, 'E:\\W\\System32\\taskkill.exe'],
  ];
  for (const [env, expected] of kills) {
    test(`killProcessTree on win32 with ${JSON.stringify(env)} runs ${expected}`, () => {
      const { runner, commands } = syncRecorder();
      killProcessTree(4242, 'win32', runner, () => true, env);
      assert.deepEqual(commands, [expected]);
    });
  }

  const lists: Array<[NodeJS.ProcessEnv, string]> = [
    [{ SYSTEMROOT: 'D:\\Windows\\' }, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
    [{ WINDIR: 'E:\\W' }, 'E:\\W\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'],
  ];
  for (const [env, expected] of lists) {
    test(`listProcesses on win32 with ${JSON.stringify(env)} runs ${expected}`, async () => {
      const { runner, commands } = asyncRecorder();
      await listProcesses(runner, 'win32', env, NOW_MS);
      assert.deepEqual(commands, [expected]);
    });
  }

  test('resolveWorktreeRoot on win32 with an empty worktreeRoot and { SYSTEMDRIVE: "E:" } gives E:\\wt\\AIDLC', () => {
    assert.equal(resolveWorktreeRoot(ProjectConfig.parse({}), 'D:\\Projects\\AIDLC', { SYSTEMDRIVE: 'E:' }, 'win32'), 'E:\\wt\\AIDLC');
  });
});

describe('the change is recorded in changelog.d (card T0-ENV-CASE) [R3]', () => {
  test('changelog.d/T0-ENV-CASE.md carries the bugfix entry of issue 307', () => {
    assert.match(fragmentEntry(repo, 'T0-ENV-CASE'), /^- T0-ENV-CASE \(bugfix, issue 307\): .*SystemRoot, windir and SystemDrive.* any letter case on win32/);
  });
});
