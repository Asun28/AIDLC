import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCliInProcess } from './cli-inprocess.ts';
import { tmpDir } from './helpers.ts';

const BIN = path.join(import.meta.dirname, '..', '..', 'bin', 'aidlc.js');

function fixture(): { repo: string; env: NodeJS.ProcessEnv } {
  const repo = tmpDir('aidlc-inproc-repo-');
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: tmpDir('aidlc-inproc-state-'), AIDLC_SESSION: 'inproc-session' };
  delete env['AIDLC_ENTRY_DEBUG'];
  delete env['AIDLC_RUN_NO_SHIP'];
  return { repo, env };
}

function child(argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...argv], { cwd: options.cwd, env: options.env, encoding: 'utf8', input: options.input ?? '' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function processState(): unknown[] {
  return [process.cwd(), JSON.stringify(Object.entries(process.env).sort(([a], [b]) => (a < b ? -1 : 1))), process.exitCode, process.exit, process.stdout.write, process.stderr.write, Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'), Object.getOwnPropertyDescriptor(process, 'stdin')];
}

// Before any call: acceptance 2 also checks that the calls of acceptance 1 left nothing behind.
const atLoad = processState();

describe('runCliInProcess', () => {
  it('T1-TEST-CLI-INPROC acceptance 1: in-process and bin/aidlc.js give the same status, stdout and stderr', async () => {
    const { repo, env } = fixture();
    const calls: Array<{ argv: string[]; status: number }> = [
      { argv: ['--help'], status: 0 },
      { argv: ['frobnicate'], status: 1 },
      { argv: ['cards', 'validate'], status: 0 },
      { argv: ['-C', 'nowhere', 'cards', 'validate'], status: 1 },
      { argv: ['ops', 'intent', '--goal', 'g-x', '--kind', 'bogus', '--target', 't'], status: 1 },
      { argv: ['next', '--goal', 'g-nope\n\n  second  '], status: 1 },
    ];
    for (const { argv, status } of calls) {
      const expected = child(argv, { cwd: repo, env });
      assert.equal(expected.status, status, `child ${argv.join(' ')}: ${expected.stderr}`);
      const actual = await runCliInProcess(argv, { cwd: repo, env });
      assert.deepEqual(actual, expected, argv.join(' '));
    }
    // A key given as undefined is left out of the call's environment, as spawnSync leaves it out of the child's.
    const unset = { ...env, AIDLC_SESSION: undefined, CLAUDE_CODE_SESSION_ID: undefined };
    const sessionLine = (stdout: string): string | undefined => stdout.split('\n').find((l) => l.startsWith('session '));
    const expected = child(['doctor', '--no-json'], { cwd: repo, env: unset });
    assert.match(sessionLine(expected.stdout) ?? '', /^session +default-/);
    assert.equal(sessionLine((await runCliInProcess(['doctor', '--no-json'], { cwd: repo, env: unset })).stdout), sessionLine(expected.stdout));
  });

  it('T1-TEST-CLI-INPROC acceptance 2: cwd, env, exitCode, exit and the streams are restored after a passing, an exiting and a throwing call', async () => {
    const { repo, env } = fixture();
    const before = processState();
    assert.deepEqual(before, atLoad);
    const calls: Array<{ argv: string[]; status: number }> = [
      { argv: ['cards', 'validate'], status: 0 },
      { argv: ['security', 'check'], status: 2 },
      { argv: ['-C', 'nowhere', 'cards', 'validate'], status: 1 },
      { argv: ['ops', 'intent', '--goal', 'g-x', '--kind', 'bogus', '--target', 't'], status: 1 },
    ];
    for (const { argv, status } of calls) {
      const r = await runCliInProcess(argv, { cwd: repo, env: { ...env, AIDLC_INPROC_PROBE: '1' } });
      assert.equal(r.status, status, argv.join(' '));
      assert.deepEqual(processState(), before, argv.join(' '));
    }
  });

  it('T1-TEST-CLI-INPROC acceptance 3: a nested call rejects naming the helper', async () => {
    const { repo, env } = fixture();
    const before = processState();
    const first = runCliInProcess(['cards', 'validate'], { cwd: repo, env });
    await assert.rejects(runCliInProcess(['--help'], { cwd: repo, env }), /runCliInProcess/);
    assert.equal((await first).status, 0);
    assert.deepEqual(processState(), before);
  });

  it('T1-TEST-CLI-INPROC acceptance 4: input', async () => {
    const { repo, env } = fixture();
    const argv = ['hook', 'auto'];
    const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'add a new feature to build X' });
    const expected = child(argv, { cwd: repo, env, input });
    assert.match(expected.stdout, /\[route\]/);
    assert.deepEqual(await runCliInProcess(argv, { cwd: repo, env, input }), expected);
  });
});
