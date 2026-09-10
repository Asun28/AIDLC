import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ok, run, runSync, scriptedRunner } from '../../src/probes/exec.ts';

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
