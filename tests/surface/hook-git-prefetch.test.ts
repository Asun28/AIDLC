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
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * A preload that counts the `spawn` and `spawnSync` calls of `git` and records whether the first `spawn` came before the
 * hook entry module loaded; it writes the counts to `PROBE_OUT` at exit.
 */
const PROBE = `import cp from 'node:child_process';
import fs from 'node:fs';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
const counts = { spawn: 0, spawnSync: 0, spawnBeforeEntry: false };
let seq = 0;
let spawnedAt = 0;
let entryAt = 0;
const realSpawn = cp.spawn;
const realSync = cp.spawnSync;
const write = fs.writeFileSync;
cp.spawn = function (cmd, ...rest) { if (cmd === 'git') { counts.spawn++; if (!spawnedAt) spawnedAt = ++seq; } return realSpawn.call(this, cmd, ...rest); };
cp.spawnSync = function (cmd, ...rest) { if (cmd === 'git') counts.spawnSync++; return realSync.call(this, cmd, ...rest); };
syncBuiltinESMExports();
registerHooks({ load(url, context, next) { if (!entryAt && /\\/hooks\\/entry\\.(js|ts)$/.test(url)) entryAt = ++seq; return next(url, context); } });
process.on('exit', () => { counts.spawnBeforeEntry = spawnedAt > 0 && entryAt > 0 && spawnedAt < entryAt; write(process.env.PROBE_OUT, JSON.stringify(counts)); });
`;

interface Counts {
  spawn: number;
  spawnSync: number;
  spawnBeforeEntry: boolean;
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
    const hook = (processCwd: string, event: Record<string, unknown>) => {
      const out = path.join(dir, `probe-${++n}.json`);
      const state = path.join(dir, `state-${n}`);
      mkdirSync(state);
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(f.probe).href, path.join(root, 'bin', 'aidlc-hook.js')], {
        cwd: processCwd,
        input: JSON.stringify({ session_id: 'prefetch', ...event }),
        env: childEnv({ AIDLC_STATE_DIR: state, AIDLC_SESSION: 'prefetch', PROBE_OUT: out }),
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
  });
});

/** The identity key the rule states: the first 16 hex characters of the sha256 of the path, lower-cased with forward slashes. */
const keyOf = (p: string): string => createHash('sha256').update(p.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 16);

test('T0-HOOK-GIT-PREFETCH acceptance 2: a settled lookup gives the identity git gives, with no synchronous call, and only for the directory it ran in [R1]', () => {
  withTemp((dir) => {
    const f = fixture(dir);
    const pathsUrl = pathToFileURL(path.join(root, 'src', 'state', 'paths.ts')).href;
    let n = 0;
    const identity = (cwd: string, settle: string, target: string) => {
      const out = path.join(dir, `identity-${++n}.json`);
      const code = `import { prefetchRepoIdentity, settleRepoIdentity, resolveRepoIdentity } from ${JSON.stringify(pathsUrl)};
prefetchRepoIdentity(process.cwd());
await settleRepoIdentity(${JSON.stringify(settle)});
process.stdout.write(JSON.stringify(resolveRepoIdentity(${JSON.stringify(target)})));`;
      const r = spawnSync(process.execPath, ['--import', pathToFileURL(f.probe).href, '--input-type=module', '-e', code], { cwd, env: childEnv({ PROBE_OUT: out }), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
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
  });
});

const OPS_SENTENCES = 'Finding the root costs one `git rev-parse` per hook process, which blocks for about 40 ms on Windows when called synchronously; the hook entry (`bin/aidlc-hook.js`) starts it before it loads its modules, and `main` uses its answer when the event\'s working directory is the one it started in (card T0-HOOK-GIT-PREFETCH), so git runs while the modules load and a hook event takes 25 to 30 ms less. Every other directory and every other caller (`aidlc hook <name>`, `aidlc hook auto`, the CLI) asks git when it needs the root, as before.';

const CHANGELOG_ENTRY = '- T0-HOOK-GIT-PREFETCH: the hook entry starts the `git rev-parse` that finds the repository root before it loads its modules, and `main` uses the answer when the event\'s working directory is the one git ran in, so git runs while the modules load instead of blocking the guards (about 40 ms on Windows); any other directory and every other caller ask git as before. Measured on Windows in two interleaved runs of 15: each hook event takes 25 to 30 ms less (PreToolUse Bash 174 ms to 146 ms and 173 ms to 147 ms).';

/** The sentences of a paragraph: a split after a full stop that a space and a capital letter or a backtick follow. */
const sentences = (paragraph: string): string[] => paragraph.split(/(?<=\.)\s+(?=[A-Z`])/);

/** Whether the docs carry this card's texts: the sentences in the config-discovery paragraph of Hooks, and the entry. */
function docsHold(ops: string, changelog: string): boolean {
  const at = ops.indexOf('\n## Hooks\n');
  const end = ops.indexOf('\n## Pre-review (R2)\n');
  if (!(at >= 0 && end > at)) return false;
  const discovery = ops.slice(at, end).split('\n\n').find((p) => p.startsWith('Which `aidlc.config.json` the guards read'));
  if (!discovery?.includes(OPS_SENTENCES)) return false;
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  return unreleased.split('\n').includes(CHANGELOG_ENTRY);
}

test('T0-HOOK-GIT-PREFETCH acceptance 5: the docs carry every sentence this card adds, and removing any one of them fails [R5]', () => {
  const [ops, changelog] = [read('docs/OPERATIONS.md'), read('CHANGELOG.md')];
  assert.ok(docsHold(ops, changelog), 'the doc texts this card adds are present whole');
  const removals: [string, () => boolean][] = [
    ...sentences(OPS_SENTENCES).map((s): [string, () => boolean] => [s, () => docsHold(ops.replace(s, ''), changelog)]),
    ...sentences(CHANGELOG_ENTRY).map((s): [string, () => boolean] => [s, () => docsHold(ops, changelog.replace(s, ''))]),
  ];
  assert.equal(removals.length, REMOVALS);
  for (const [sentence, holds] of removals) assert.equal(holds(), false, `removing this text still passes: ${sentence}`);
});

// 2 OPERATIONS sentences and 2 CHANGELOG sentences.
const REMOVALS = 4;
