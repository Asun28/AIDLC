// Card T0-HOOK-GIT-PREFETCH: the hook entry starts the repository git lookup before it loads its modules and uses the
// answer when the event's working directory is the one git ran in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');

/** The child environment, built at each call without any variable the loop reads or that changes what Node loads, in every letter case. */
function childEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    const upper = k.toUpperCase();
    if (upper.startsWith('AIDLC_') || ['CLAUDE_CODE_SESSION_ID', 'RELEASE_APPROVAL', 'NODE_OPTIONS', 'NODE_COMPILE_CACHE'].includes(upper)) continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

function withTemp<T>(fn: (dir: string) => T): T {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'aidlc-git-prefetch-')));
  try {
    return fn(dir);
  } finally {
    removeTemp(dir);
  }
}

/** A stand-in a hook process left running holds its working directory on Windows until it exits, which `rmSync` does not retry for a subdirectory. */
function removeTemp(dir: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 100) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/**
 * A preload that counts the `spawn` and `spawnSync` calls of `git` and records whether the first `spawn` came before the
 * hook entry module loaded; it writes the counts to `PROBE_OUT` at exit. `PROBE_MODE` injects a fault into the `git` calls
 * (R3 decision 1): `throw` makes `spawn` throw, `nostreams` makes it return a child without output streams that then
 * reports EMFILE, and `verbose-out` and `verbose-err` run, for `spawn` and `spawnSync` alike, a git stand-in that prints
 * the two refs of the working directory followed by more than 1 MiB on stdout or on stderr.
 *
 * R3 decision 2 adds stand-ins that print git's real answer (`REFS`) with more output: `mixed` 600 KiB on each stream,
 * `limit` exactly 1 MiB over both streams, `over` one byte more, `linger` more than 1 MiB and then 5 s of waiting
 * (`exitSignal` records how it ended). `kill-eperm` and `kill-enosys` print 16 MiB on each stream and fail `child.kill` as
 * Node fails it, with an `error` event or a throw (`delivered` counts the bytes read from both streams);
 * `nostreams-enosys` is `nostreams` with that throw (`killed` records the call), `nostreams-silent` is `nostreams` with no
 * `error` event. `read-error-out` and `read-error-err` run real git and fail the read of that stream, `stdin-error` fails
 * the write stream, and `exit-1` prints git's real answer and exits 1.
 */
const PROBE = `import cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
const counts = { spawn: 0, spawnSync: 0, spawnBeforeEntry: false };
const mode = process.env.PROBE_MODE ?? '';
const REFS = "const refs = require('node:child_process').execFileSync('git', ['rev-parse', '--git-common-dir', '--show-toplevel'], { encoding: 'utf8' });";
const FLOOD = REFS + " process.stdout.write(refs); const block = 'x'.repeat(1024 * 1024); for (let i = 0; i < 16; i++) { process.stdout.write(block); process.stderr.write(block); }";
const VERBOSE = {
  'verbose-out': "process.stdout.write('.git\\\\n' + process.cwd() + '\\\\n' + 'x'.repeat(1024 * 1024))",
  'verbose-err': "process.stdout.write('.git\\\\n' + process.cwd() + '\\\\n'); process.stderr.write('x'.repeat(1024 * 1024 + 1))",
  mixed: REFS + " process.stdout.write(refs + 'x'.repeat(600 * 1024)); process.stderr.write('x'.repeat(600 * 1024));",
  limit: REFS + " process.stdout.write(refs + 'x'.repeat(512 * 1024 - refs.length)); process.stderr.write('x'.repeat(512 * 1024));",
  over: REFS + " process.stdout.write(refs + 'x'.repeat(512 * 1024 - refs.length)); process.stderr.write('x'.repeat(512 * 1024 + 1));",
  linger: REFS + " process.stdout.write(refs + 'x'.repeat(1024 * 1024)); setTimeout(() => {}, 5000);",
  'exit-1': REFS + " process.stdout.write(refs); process.exitCode = 1;",
  'kill-eperm': FLOOD,
  'kill-enosys': FLOOD,
};
const killError = (code) => Object.assign(new Error('kill ' + code), { code, syscall: 'kill' });
/** The faults that act on a child that did start. */
function faulted(child) {
  if (mode === 'kill-eperm' || mode === 'kill-enosys') {
    counts.delivered = 0;
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (d) => { counts.delivered += d.length; });
    child.kill = mode === 'kill-eperm' ? () => { child.emit('error', killError('EPERM')); return false; } : () => { throw killError('ENOSYS'); };
  }
  if (mode === 'linger') child.on('exit', (code, signal) => { counts.exitSignal = signal; });
  if (mode === 'read-error-out') child.stdout.destroy(new Error('read EIO'));
  if (mode === 'read-error-err') child.stderr.destroy(new Error('read EIO'));
  if (mode === 'stdin-error') child.stdin.destroy(new Error('write EPIPE'));
  return child;
}
let seq = 0;
let spawnedAt = 0;
let entryAt = 0;
const realSpawn = cp.spawn;
const realSync = cp.spawnSync;
const write = fs.writeFileSync;
cp.spawn = function (cmd, args, options) {
  if (cmd !== 'git') return realSpawn.call(this, cmd, args, options);
  counts.spawn++;
  if (!spawnedAt) spawnedAt = ++seq;
  if (mode === 'throw') throw Object.assign(new Error('spawn git E2BIG'), { code: 'E2BIG' });
  if (mode.startsWith('nostreams')) {
    const child = new EventEmitter();
    const kill = mode === 'nostreams-enosys' ? () => { counts.killed = true; throw killError('ENOSYS'); } : () => true;
    Object.assign(child, { stdout: null, stderr: null, stdin: null, kill });
    if (mode !== 'nostreams-silent') process.nextTick(() => child.emit('error', Object.assign(new Error('spawn git EMFILE'), { code: 'EMFILE' })));
    return child;
  }
  if (VERBOSE[mode]) return faulted(realSpawn.call(this, process.execPath, ['-e', VERBOSE[mode]], options));
  return faulted(realSpawn.call(this, cmd, args, options));
};
cp.spawnSync = function (cmd, args, options) {
  if (cmd !== 'git') return realSync.call(this, cmd, args, options);
  counts.spawnSync++;
  if (VERBOSE[mode]) return realSync.call(this, process.execPath, ['-e', VERBOSE[mode]], options);
  return realSync.call(this, cmd, args, options);
};
syncBuiltinESMExports();
registerHooks({ load(url, context, next) { if (!entryAt && /\\/hooks\\/entry\\.(js|ts)$/.test(url)) entryAt = ++seq; return next(url, context); } });
process.on('exit', () => { counts.spawnBeforeEntry = spawnedAt > 0 && entryAt > 0 && spawnedAt < entryAt; write(process.env.PROBE_OUT, JSON.stringify(counts)); });
`;

interface Counts {
  spawn: number;
  spawnSync: number;
  spawnBeforeEntry: boolean;
  delivered?: number;
  exitSignal?: string | null;
  killed?: boolean;
}

/** A git repository freezing `contracts/`, a subdirectory, a linked worktree whose own config copy freezes nothing, and a directory outside git. */
function fixture(dir: string): { repo: string; sub: string; worktree: string; outside: string; probe: string } {
  const repo = path.join(dir, 'repo');
  mkdirSync(path.join(repo, 'sub'), { recursive: true });
  const git = (args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { cwd: repo, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  git(['init', '-q', '-b', 'main']);
  writeFileSync(path.join(repo, 'aidlc.config.json'), JSON.stringify({ hooks: { frozenPaths: ['contracts/'] } }));
  git(['add', 'aidlc.config.json']);
  git(['commit', '-q', '-m', 'config']);
  const worktree = path.join(dir, 'wt');
  git(['worktree', 'add', '-q', '-b', 'side', worktree]);
  writeFileSync(path.join(worktree, 'aidlc.config.json'), JSON.stringify({ hooks: { frozenPaths: [] } }));
  const outside = path.join(dir, 'outside');
  mkdirSync(outside);
  const probe = path.join(dir, 'probe.mjs');
  writeFileSync(probe, PROBE);
  return { repo: realpathSync.native(repo), sub: realpathSync.native(path.join(repo, 'sub')), worktree: realpathSync.native(worktree), outside: realpathSync.native(outside), probe };
}

const FROZEN = 'FROZEN: this path is a frozen contract/schema (aidlc.config.json hooks.frozenPaths). Changes go through version review, not in-place edits. Stop and ask the user how to proceed.';
const DENIED = `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: FROZEN } })}\n`;

test('T0-HOOK-GIT-PREFETCH acceptance 1: the hook entry starts git before its modules load and asks git again only for another directory [R1] [R2] [R3]', () => {
  withTemp((dir) => {
    const f = fixture(dir);
    let n = 0;
    const hook = (processCwd: string, event: Record<string, unknown>, mode = '') => {
      const out = path.join(dir, `probe-${++n}.json`);
      const state = path.join(dir, `state-${n}`);
      mkdirSync(state);
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(f.probe).href, path.join(root, 'bin', 'aidlc-hook.js')], {
        cwd: processCwd,
        input: JSON.stringify({ session_id: 'prefetch', ...event }),
        env: childEnv({ AIDLC_STATE_DIR: state, AIDLC_SESSION: 'prefetch', PROBE_OUT: out, PROBE_MODE: mode }),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      });
      return { status: r.status, stdout: r.stdout, stderr: r.stderr, counts: JSON.parse(readFileSync(out, 'utf8')) as Counts };
    };
    const edit = (cwd: string) => ({ hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd, tool_input: { file_path: 'contracts/a.yaml', old_string: 'a', new_string: 'b' } });
    const same = hook(f.repo, edit(f.repo));
    assert.deepEqual([same.status, same.stdout, same.stderr], [0, DENIED, ''], 'the main checkout');
    assert.deepEqual(same.counts, { spawn: 1, spawnSync: 0, spawnBeforeEntry: true }, 'one lookup, started before the entry loaded');
    const sub = hook(f.repo, edit(f.sub));
    assert.deepEqual([sub.status, sub.stdout, sub.stderr], [0, DENIED, ''], 'a subdirectory reads the main checkout config');
    assert.deepEqual([sub.counts.spawn, sub.counts.spawnSync], [1, 1], 'another directory asks git as before');
    const linked = hook(f.worktree, edit(f.worktree));
    assert.deepEqual([linked.status, linked.stdout, linked.stderr], [0, DENIED, ''], 'a linked worktree reads the main checkout config, not its own copy');
    assert.deepEqual([linked.counts.spawn, linked.counts.spawnSync], [1, 0]);
    const bash = hook(f.repo, { hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: f.repo, tool_input: { command: 'git status' } });
    assert.deepEqual([bash.status, bash.stdout, bash.stderr], [0, '', '']);
    assert.deepEqual([bash.counts.spawn, bash.counts.spawnSync], [1, 0]);
    const unguarded = hook(f.repo, { hook_event_name: 'PreToolUse', tool_name: 'Read', cwd: f.repo, tool_input: { file_path: 'contracts/a.yaml' } });
    assert.deepEqual([unguarded.status, unguarded.stdout, unguarded.stderr], [0, '', ''], 'an event no guard handles');
    // A spawn that fails is no lookup (R3 decision 1): the guards still run, asking git synchronously as on main.
    for (const mode of ['throw', 'nostreams']) {
      const failed = hook(f.repo, edit(f.repo), mode);
      assert.deepEqual([failed.status, failed.stdout, failed.stderr], [0, DENIED, ''], `${mode}: the guards run`);
      assert.deepEqual([failed.counts.spawn, failed.counts.spawnSync], [1, 1], `${mode}: git is asked synchronously`);
    }
  });
});

/** The identity key the rule states: the first 16 hex characters of the sha256 of the path, lower-cased with forward slashes. */
const keyOf = (p: string): string => createHash('sha256').update(p.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 16);

test('T0-HOOK-GIT-PREFETCH acceptance 2: a settled lookup gives the identity git gives, with no synchronous call, and only for the directory it ran in [R1]', () => {
  withTemp((dir) => {
    const f = fixture(dir);
    const pathsUrl = pathToFileURL(path.join(root, 'src', 'state', 'paths.ts')).href;
    let n = 0;
    const identity = (cwd: string, settle: string, target: string, mode = '') => {
      const out = path.join(dir, `identity-${++n}.json`);
      const code = `import { prefetchRepoIdentity, settleRepoIdentity, resolveRepoIdentity } from ${JSON.stringify(pathsUrl)};
prefetchRepoIdentity(process.cwd());
await settleRepoIdentity(${JSON.stringify(settle)});
process.stdout.write(JSON.stringify(resolveRepoIdentity(${JSON.stringify(target)})));`;
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(f.probe).href, '--input-type=module', '-e', code], { cwd, env: childEnv({ PROBE_OUT: out, PROBE_MODE: mode }), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
      assert.equal(r.status, 0, r.stderr);
      const counts = JSON.parse(readFileSync(out, 'utf8')) as Counts;
      return { identity: JSON.parse(r.stdout) as unknown, spawn: counts.spawn, spawnSync: counts.spawnSync };
    };
    const inRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: true, key: keyOf(f.repo) };
    assert.deepEqual(identity(f.repo, f.repo, f.repo), { identity: inRepo, spawn: 1, spawnSync: 0 }, 'the main checkout');
    assert.deepEqual(identity(f.sub, f.sub, f.sub), { identity: inRepo, spawn: 1, spawnSync: 0 }, 'a subdirectory settled from itself');
    assert.deepEqual(identity(f.worktree, f.worktree, f.worktree), { identity: { mainRoot: f.repo, worktreeRoot: f.worktree, isGit: true, key: keyOf(f.repo) }, spawn: 1, spawnSync: 0 }, 'a linked worktree');
    assert.deepEqual(identity(f.outside, f.outside, f.outside), { identity: { mainRoot: f.outside, worktreeRoot: f.outside, isGit: false, key: keyOf(f.outside) }, spawn: 1, spawnSync: 0 }, 'a directory outside git');
    assert.deepEqual(identity(f.repo, f.sub, f.sub), { identity: inRepo, spawn: 1, spawnSync: 1 }, 'another directory than the lookup ran in asks git synchronously');
    // R3 decision 1: a failed spawn caches nothing, so git is asked synchronously; output past spawnSync's 1 MiB on either
    // stream reads as no output, on the prefetched path as on the synchronous one.
    for (const mode of ['throw', 'nostreams']) assert.deepEqual(identity(f.repo, f.repo, f.repo, mode), { identity: inRepo, spawn: 1, spawnSync: 1 }, mode);
    const noRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: false, key: keyOf(f.repo) };
    for (const mode of ['verbose-out', 'verbose-err']) {
      assert.deepEqual(identity(f.repo, f.repo, f.repo, mode), { identity: noRepo, spawn: 1, spawnSync: 0 }, `${mode}: prefetched`);
      assert.deepEqual(identity(f.repo, f.sub, f.repo, mode), { identity: noRepo, spawn: 1, spawnSync: 1 }, `${mode}: synchronous`);
    }
  });
});

/** The R3 decision 2 runs: the hook entry and an identity call in a child process, each under the preload with `mode`. */
function runs(dir: string, f: ReturnType<typeof fixture>) {
  let n = 0;
  const countsPath = () => path.join(dir, `decision2-${++n}.json`);
  const hook = (processCwd: string, eventCwd: string, mode: string) => {
    const out = countsPath();
    const state = path.join(dir, `decision2-state-${n}`);
    mkdirSync(state);
    const event = { session_id: 'prefetch', hook_event_name: 'PreToolUse', tool_name: 'Edit', cwd: eventCwd, tool_input: { file_path: 'contracts/a.yaml', old_string: 'a', new_string: 'b' } };
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(f.probe).href, path.join(root, 'bin', 'aidlc-hook.js')], { cwd: processCwd, input: JSON.stringify(event), env: childEnv({ AIDLC_STATE_DIR: state, AIDLC_SESSION: 'prefetch', PROBE_OUT: out, PROBE_MODE: mode }), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    const counts = JSON.parse(readFileSync(out, 'utf8')) as Counts;
    return { seen: [r.status, r.stdout, r.stderr, counts.spawn, counts.spawnSync], counts };
  };
  const pathsUrl = pathToFileURL(path.join(root, 'src', 'state', 'paths.ts')).href;
  const identity = (settle: string, mode: string) => {
    const out = countsPath();
    const code = `import { prefetchRepoIdentity, settleRepoIdentity, resolveRepoIdentity } from ${JSON.stringify(pathsUrl)};
prefetchRepoIdentity(process.cwd());
await settleRepoIdentity(${JSON.stringify(settle)});
process.stdout.write(JSON.stringify(resolveRepoIdentity(process.cwd())));`;
    const r = spawnSync(process.execPath, ['--import', pathToFileURL(f.probe).href, '--input-type=module', '-e', code], { cwd: f.repo, env: childEnv({ PROBE_OUT: out, PROBE_MODE: mode }), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    assert.equal(r.status, 0, `${mode}: ${r.stderr}`);
    const counts = JSON.parse(readFileSync(out, 'utf8')) as Counts;
    return { seen: [JSON.parse(r.stdout) as unknown, counts.spawn, counts.spawnSync], counts };
  };
  return { hook, identity };
}

test('T0-HOOK-GIT-PREFETCH F3: a lookup counts stdout and stderr together against the 1 MiB of spawnSync, and over it reads as no output, on both paths [R1] [R3]', () => {
  withTemp((dir) => {
    const f = fixture(dir);
    const { hook, identity } = runs(dir, f);
    const inRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: true, key: keyOf(f.repo) };
    const noRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: false, key: keyOf(f.repo) };
    assert.deepEqual(identity(f.repo, 'limit').seen, [inRepo, 1, 0], 'exactly 1 MiB is an answer: prefetched');
    assert.deepEqual(identity(f.sub, 'limit').seen, [inRepo, 1, 1], 'exactly 1 MiB is an answer: synchronous');
    for (const mode of ['mixed', 'over']) {
      assert.deepEqual(identity(f.repo, mode).seen, [noRepo, 1, 0], `${mode}: prefetched`);
      assert.deepEqual(identity(f.sub, mode).seen, [noRepo, 1, 1], `${mode}: synchronous`);
    }
    // In the linked worktree an accepted identity reads the main checkout's config and denies; no output reads the worktree's own copy, which freezes nothing.
    assert.deepEqual(hook(f.worktree, f.worktree, 'limit').seen, [0, DENIED, '', 1, 0], 'the guard reads an accepted identity');
    for (const mode of ['mixed', 'over']) {
      assert.deepEqual(hook(f.worktree, f.worktree, mode).seen, [0, '', '', 1, 0], `${mode}: the guard, prefetched`);
      assert.deepEqual(hook(f.repo, f.worktree, mode).seen, [0, '', '', 1, 1], `${mode}: the guard, synchronous`);
    }
  });
});

test('T0-HOOK-GIT-PREFETCH F3: over the limit the child is ended and reading stops, so buffered output stays bounded [R1]', () => {
  withTemp((dir) => {
    const f = fixture(dir);
    const { identity } = runs(dir, f);
    const noRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: false, key: keyOf(f.repo) };
    const linger = identity(f.repo, 'linger');
    assert.deepEqual(linger.seen, [noRepo, 1, 0]);
    assert.equal(linger.counts.exitSignal, 'SIGTERM', 'the child is ended with the signal spawnSync sends');
    for (const mode of ['kill-eperm', 'kill-enosys']) {
      const flood = identity(f.repo, mode);
      assert.ok(flood.counts.delivered! < 2 * 1024 * 1024, `${mode}: ${flood.counts.delivered} bytes of 32 MiB read`);
    }
  });
});

test('T0-HOOK-GIT-PREFETCH F4: a kill that errors or throws settles the lookup as no output, with no second git and no lookup left pending [R1] [R3]', () => {
  withTemp((dir) => {
    const f = fixture(dir);
    const { hook, identity } = runs(dir, f);
    const noRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: false, key: keyOf(f.repo) };
    for (const mode of ['kill-eperm', 'kill-enosys']) {
      assert.deepEqual(identity(f.repo, mode).seen, [noRepo, 1, 0], `${mode}: the identity`);
      assert.deepEqual(hook(f.worktree, f.worktree, mode).seen, [0, '', '', 1, 0], `${mode}: the guard`);
    }
    const noStreams = hook(f.repo, f.repo, 'nostreams-enosys');
    assert.deepEqual(noStreams.seen, [0, DENIED, '', 1, 1], 'a child without streams is no lookup, whatever its kill does');
    assert.equal(noStreams.counts.killed, true, 'a child without streams is ended');
    assert.deepEqual(hook(f.repo, f.repo, 'nostreams-silent').seen, [0, DENIED, '', 1, 1], 'a child without streams settles with no event from it');
  });
});

test('T0-HOOK-GIT-PREFETCH: a failed read of a stream starts no second git; the lookup reads what spawnSync reads, the exit status and the bytes read [R1] [R3]', () => {
  withTemp((dir) => {
    const f = fixture(dir);
    const { identity } = runs(dir, f);
    const inRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: true, key: keyOf(f.repo) };
    const noRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: false, key: keyOf(f.repo) };
    assert.deepEqual(identity(f.repo, 'read-error-out').seen, [noRepo, 1, 0], 'stdout read nothing');
    assert.deepEqual(identity(f.repo, 'read-error-err').seen, [inRepo, 1, 0], 'stdout read whole');
    assert.deepEqual(identity(f.repo, 'stdin-error').seen, [inRepo, 1, 0], 'git reads no input, so a failed stdin changes nothing');
  });
});

test('T0-HOOK-GIT-PREFETCH: an exit status other than 0 is no output whatever stdout holds, on both paths [R1]', () => {
  withTemp((dir) => {
    const f = fixture(dir);
    const { identity } = runs(dir, f);
    const noRepo = { mainRoot: f.repo, worktreeRoot: f.repo, isGit: false, key: keyOf(f.repo) };
    assert.deepEqual(identity(f.repo, 'exit-1').seen, [noRepo, 1, 0], 'prefetched');
    assert.deepEqual(identity(f.sub, 'exit-1').seen, [noRepo, 1, 1], 'synchronous');
  });
});

const OPS_PARAGRAPH = 'When the hook entry asks git (card T0-HOOK-GIT-PREFETCH): that `git rev-parse` blocks for about 40 ms on Windows when called synchronously, so the hook entry (`bin/aidlc-hook.js`) starts it before it loads its modules, and `main` uses its answer when the event\'s working directory is the one it started in; git then runs while the modules load, and a hook event takes 25 to 30 ms less. Every other directory and every other caller (`aidlc hook <name>`, `aidlc hook auto`, the CLI) asks git when it needs the root, as before.';

const CHANGELOG_ENTRY = '- T0-HOOK-GIT-PREFETCH: the hook entry starts the `git rev-parse` that finds the repository root before it loads its modules, and `main` uses the answer when the event\'s working directory is the one git ran in, so git runs while the modules load instead of blocking the guards (about 40 ms on Windows); any other directory and every other caller ask git as before. Measured on Windows in two interleaved runs of 15: each hook event takes 25 to 30 ms less (PreToolUse Bash 174 ms to 146 ms and 173 ms to 147 ms).';

/** The sentences of a paragraph: a split after a full stop that a space and a capital letter or a backtick follow. */
const sentences = (paragraph: string): string[] => paragraph.split(/(?<=\.)\s+(?=[A-Z`])/);

/** Whether the docs carry this card's texts: the paragraph right after the config-discovery paragraph of Hooks, and the entry. */
function docsHold(ops: string, changelog: string): boolean {
  const at = ops.indexOf('\n## Hooks\n');
  const end = ops.indexOf('\n## Pre-review (R2)\n');
  if (!(at >= 0 && end > at)) return false;
  const paragraphs = ops.slice(at, end).split('\n\n');
  const discovery = paragraphs.findIndex((p) => p.startsWith('Which `aidlc.config.json` the guards read'));
  if (discovery < 0 || paragraphs[discovery + 1] !== OPS_PARAGRAPH) return false;
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  return unreleased.split('\n').includes(CHANGELOG_ENTRY);
}

test('T0-HOOK-GIT-PREFETCH acceptance 5: the docs carry every sentence this card adds, and removing any one of them fails [R5]', () => {
  const [ops, changelog] = [read('docs/OPERATIONS.md'), read('CHANGELOG.md')];
  assert.ok(docsHold(ops, changelog), 'the doc texts this card adds are present whole');
  const removals: [string, () => boolean][] = [
    ...sentences(OPS_PARAGRAPH).map((s): [string, () => boolean] => [s, () => docsHold(ops.replace(s, ''), changelog)]),
    ...sentences(CHANGELOG_ENTRY).map((s): [string, () => boolean] => [s, () => docsHold(ops, changelog.replace(s, ''))]),
  ];
  assert.equal(removals.length, REMOVALS);
  for (const [sentence, holds] of removals) assert.equal(holds(), false, `removing this text still passes: ${sentence}`);
});

// 2 OPERATIONS paragraph sentences and 2 CHANGELOG sentences.
const REMOVALS = 4;
