// Card T0-HOOK-LOAD-FAIL-CLOSED (issue 508): a hook process whose CLI or hook modules fail to load blocks a PreToolUse
// call (exit 2) through both bin entries, and ends as before (exit 1) on every other event and for every other command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpDir } from '../infra/helpers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The child environment without any variable the loop reads or that changes what Node loads, in every letter case. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    if (upper.startsWith('AIDLC_') || ['CLAUDE_CODE_SESSION_ID', 'RELEASE_APPROVAL', 'NODE_OPTIONS', 'NODE_COMPILE_CACHE'].includes(upper)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

/** A copy of src/, bin/ and package.json in a temporary directory (no dist/, so the entries load the sources), a working directory and a state directory. */
function withPackage(fn: (p: { pkg: string; repo: string; state: string }) => void | Promise<void>): Promise<void> {
  const dir = tmpDir('aidlc-hook-load-');
  const pkg = path.join(dir, 'pkg');
  for (const part of ['src', 'bin']) cpSync(path.join(root, part), path.join(pkg, part), { recursive: true });
  cpSync(path.join(root, 'package.json'), path.join(pkg, 'package.json'));
  symlinkSync(path.join(root, 'node_modules'), path.join(pkg, 'node_modules'), 'junction');
  const repo = path.join(dir, 'repo');
  const state = path.join(dir, 'state');
  mkdirSync(repo);
  mkdirSync(state);
  return Promise.resolve(fn({ pkg, repo, state })).finally(() => rmSync(dir, { recursive: true, force: true }));
}

/** Replaces `src/<rel>` of `pkg` with a module that throws `message` at import. */
function breakModule(pkg: string, rel: string, message: string): void {
  writeFileSync(path.join(pkg, 'src', rel), `throw new Error(${JSON.stringify(message)});\n`);
}

const bash = { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status' } };
const blockLine = (message: string) => `[aidlc hook] cannot load the hook modules; the tool call is blocked: ${message}\n`;

function run(pkg: string, repo: string, state: string, args: string[], stdin: string) {
  return spawnSync(process.execPath, [path.join(pkg, 'bin', args[0]!), ...args.slice(1)], {
    cwd: repo,
    input: stdin,
    env: childEnv({ AIDLC_STATE_DIR: state, AIDLC_SESSION: 'hook-load' }),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60_000,
  });
}

const event = (e: Record<string, unknown>, repo: string) => JSON.stringify({ ...e, cwd: repo, session_id: 'hook-load' });

test('acceptance 1: aidlc hook auto and aidlc -C <dir> hook <name> exit 2 on a PreToolUse event when the CLI module fails to load [R1]', async () => {
  await withPackage(({ pkg, repo, state }) => {
    breakModule(pkg, 'cli/main.ts', 'boom');
    for (const args of [['aidlc.js', 'hook', 'auto'], ['aidlc.js', '-C', repo, 'hook', 'production-gate']]) {
      const r = run(pkg, repo, state, args, event(bash, repo));
      assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
      assert.equal(r.stdout, '');
      assert.equal(r.stderr, blockLine('boom'));
    }
    breakModule(pkg, 'cli/main.ts', 'a\nb');
    const r = run(pkg, repo, state, ['aidlc.js', 'hook', 'auto'], event(bash, repo));
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stderr, blockLine('a | b'));
  });
});

test('acceptance 2: bin/aidlc-hook.js exits 2 on a PreToolUse event when its entry module fails to load [R1]', async () => {
  await withPackage(({ pkg, repo, state }) => {
    breakModule(pkg, 'hooks/entry.ts', 'boom');
    const r = run(pkg, repo, state, ['aidlc-hook.js'], event(bash, repo));
    assert.equal(r.status, 2, r.stderr);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, blockLine('boom'));
  });
});

test('acceptance 3: other events and other stdin exit 1 through each entry, and a command other than hook never reads stdin [R2]', async () => {
  await withPackage(async ({ pkg, repo, state }) => {
    breakModule(pkg, 'cli/main.ts', 'boom');
    breakModule(pkg, 'hooks/entry.ts', 'boom');
    const inputs = [event({ hook_event_name: 'Stop' }, repo), event({ hook_event_name: 'UserPromptSubmit', prompt: 'hi' }, repo), '{}', 'not json', ''];
    for (const args of [['aidlc.js', 'hook', 'auto'], ['aidlc-hook.js']]) {
      for (const stdin of inputs) {
        const r = run(pkg, repo, state, args, stdin);
        assert.equal(r.status, 1, `${args.join(' ')} <- ${stdin}: ${r.stderr}`);
        assert.equal(r.stdout, '');
        assert.ok(r.stderr.length > 0, `${args.join(' ')} <- ${stdin}: empty stderr`);
        assert.ok(!r.stderr.includes('blocked'), r.stderr);
      }
    }
    // A command other than hook with a PreToolUse event on stdin: one that read stdin would block (exit 2).
    const listed = run(pkg, repo, state, ['aidlc.js', 'goal', 'list'], event(bash, repo));
    assert.equal(listed.status, 1, listed.stderr);
    assert.ok(!listed.stderr.includes('blocked'), listed.stderr);
    // stdin stays an open pipe that is never written or closed: a command that read it would wait until it is killed.
    const child = spawn(process.execPath, [path.join(pkg, 'bin', 'aidlc.js'), 'goal', 'list'], { cwd: repo, env: childEnv({ AIDLC_STATE_DIR: state }), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, 10_000);
    const status = await new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    clearTimeout(timer);
    child.stdin.destroy();
    assert.equal(killed, false, 'aidlc goal list waited on stdin');
    assert.equal(status, 1);
  });
});

test('a PreToolUse event that arrives in two parts 3 s apart still blocks through each entry (R3 decision 1) [R1]', async () => {
  await withPackage(async ({ pkg, repo, state }) => {
    breakModule(pkg, 'cli/main.ts', 'boom');
    breakModule(pkg, 'hooks/entry.ts', 'boom');
    const text = event(bash, repo);
    for (const args of [['aidlc.js', 'hook', 'auto'], ['aidlc-hook.js']]) {
      const child = spawn(process.execPath, [path.join(pkg, 'bin', args[0]!), ...args.slice(1)], { cwd: repo, env: childEnv({ AIDLC_STATE_DIR: state }), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      const exited = new Promise<number | null>((resolve) => child.on('close', (code) => resolve(code)));
      child.stdin.write(text.slice(0, 20));
      const second = setTimeout(() => child.stdin.end(text.slice(20)), 3_000);
      const kill = setTimeout(() => child.kill(), 30_000);
      const status = await exited;
      clearTimeout(second);
      clearTimeout(kill);
      assert.equal(status, 2, `${args.join(' ')}: ${stderr}`);
      assert.equal(stdout, '');
      assert.equal(stderr, blockLine('boom'));
    }
  });
});

test('the failure handler is imported only inside the catch of each entry, so an install that loads imports nothing more [R3]', () => {
  for (const entry of ['bin/aidlc.js', 'bin/aidlc-hook.js']) {
    const source = readFileSync(path.join(root, entry), 'utf8');
    assert.ok(!/^import .*hook-load-failure/m.test(source), `${entry} imports the handler statically`);
    assert.match(source, /await import\([^)]*hook-load-failure\.js/, `${entry} does not import the handler in its catch`);
  }
});
