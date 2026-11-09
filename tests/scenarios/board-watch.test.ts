import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { goal } from '../core/_fixtures.ts';
import { cleanup } from '../infra/helpers.ts';
import { LeaseStore, resourceKeys } from '../../src/coordination/lease.ts';
import { shortKey } from '../../src/state/paths.ts';
import { renderCard } from '../../src/artifacts/card.ts';
import { watchLoop } from '../../src/cli/main.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const main = path.resolve(here, '..', '..', 'src', 'cli', 'main.ts');

/** Every file and directory under `dir` with its bytes, so a write, a new file or a new directory shows up as a difference. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) {
        files[`${path.relative(dir, p)}/`] = '';
        walk(p);
      } else files[path.relative(dir, p)] = readFileSync(p).toString('base64');
    }
  };
  walk(dir);
  return files;
}

/** A repository directory (not a git checkout) whose card registry holds T1-A, and a state directory beside it holding goal `g-watch` (cards T1-A and T1-B) and a live goal lease. */
function fixture(): { tmp: string; repo: string; state: string; env: NodeJS.ProcessEnv } {
  const tmp = mkdtempSync(path.join(tmpdir(), 'aidlc-watch-'));
  const repo = path.join(tmp, 'repo');
  const state = path.join(tmp, 'state');
  mkdirSync(path.join(repo, 'specs', 'tasks'), { recursive: true });
  writeFileSync(path.join(repo, 'specs', 'tasks', 'T1-A.md'), renderCard({ id: 'T1-A', title: 'Watched card', allowPaths: ['src/a.ts'], dodCommand: 'npm test', acceptance: ['1. It holds. [dod arm 1]'], deliverable: 'It holds.' }), 'utf8');
  mkdirSync(path.join(state, 'goals'), { recursive: true });
  mkdirSync(path.join(state, 'leases'), { recursive: true });
  writeFileSync(path.join(state, 'goals', 'g-watch.json'), JSON.stringify(goal({ id: 'g-watch', cards: ['T1-A', 'T1-B'] }), null, 2), 'utf8');
  // The key the CLI derives: the canonical repository path (lesson 2026-11-08 T0-WORKTREE-RECLAIM-2).
  const key = resourceKeys.goal(shortKey(realpathSync.native(repo)), 'g-watch');
  const lease = { resourceKey: key, generation: 2, owner: { session: 'win-A', pid: 1, processStart: '2026-09-11T00:00:00.000Z', host: 'h1' }, acquiredAt: '2026-09-11T00:00:00.000Z', heartbeatAt: '2026-09-11T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', released: false };
  writeFileSync(new LeaseStore(path.join(state, 'leases')).file(key), JSON.stringify(lease), 'utf8');
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: state };
  delete env.AIDLC_SESSION;
  delete env.CLAUDE_CODE_SESSION_ID;
  return { tmp, repo, state, env };
}

function cli(fx: { repo: string; env: NodeJS.ProcessEnv }, args: string[], env: NodeJS.ProcessEnv = fx.env) {
  return spawnSync(process.execPath, [main, ...args], { cwd: fx.repo, encoding: 'utf8', env, windowsHide: true, timeout: 30_000 });
}

test('board --watch --interval 1 prints two screens, exits 0 when its reader closes stdout, and writes nothing (acceptance 4) [R1] [R2] [R5]', async () => {
  const fx = fixture();
  try {
    const before = { state: snapshot(fx.state), repo: snapshot(fx.repo) };
    const child = spawn(process.execPath, [main, 'board', 'g-watch', '--watch', '--interval', '1'], { cwd: fx.repo, env: fx.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    const guard = setTimeout(() => child.kill(), 20_000);
    await new Promise<void>((resolve) => {
      child.stdout.on('data', (d: Buffer) => {
        stdout += d.toString();
        if ((stdout.match(/^Next: /gm) ?? []).length >= 2) resolve();
      });
    });
    // Like `board --watch | head`: the reader goes away after two screens.
    child.stdout.destroy();
    const code = await exited;
    clearTimeout(guard);
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    const screens = stdout.split('\n\n').filter((s) => s.includes('Next: '));
    assert.equal(screens.length, 2, stdout);
    for (const screen of screens) {
      const lines = screen.split('\n');
      assert.match(lines[0]!, /^aidlc watch: g-watch at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \(view only; Ctrl\+C ends it\)$/);
      assert.deepEqual(lines.slice(1), [
        'Goal: PLAN, generation 0, revision 0, deadline ' + goal().deadlines.goalDeadline,
        'Cards:',
        '  T1-A todo',
        '  T1-B todo not in the card registry',
        'Leases:',
        '  goal owner win-A host h1 generation 2 until 2099-01-01T00:00:00.000Z',
        'Next: not computed (view only); run aidlc next --goal g-watch',
      ]);
    }
    assert.doesNotMatch(stdout, /\u001b/, 'a pipe gets no screen clear');
    assert.deepEqual({ state: snapshot(fx.state), repo: snapshot(fx.repo) }, before, 'no session-default, board file, _local mirror or journal line');
    assert.ok(!existsSync(path.join(fx.state, 'session-default')));
  } finally {
    cleanup(fx.tmp);
  }
});

test('board --watch refuses a bad interval, --interval without --watch, a goal id that is not plain and an unknown goal, never echoing the value (acceptance 5) [R1] [R5]', () => {
  const fx = fixture();
  try {
    const before = snapshot(fx.state);
    for (const interval of ['0', '3601', '1.5', 'abc']) {
      const r = cli(fx, ['board', 'g-watch', '--watch', '--interval', interval]);
      assert.equal(r.status, 1, interval);
      assert.equal(r.stderr, 'aidlc: --interval must be a whole number of seconds from 1 to 3600\n', interval);
      assert.equal(r.stdout, '', interval);
    }
    // The bounds themselves pass the interval check and reach the goal check.
    for (const interval of ['1', '3600']) {
      const r = cli(fx, ['board', 'g-missing', '--watch', '--interval', interval]);
      assert.equal(r.stderr, 'aidlc: unknown goal g-missing\n', interval);
    }
    const noWatch = cli(fx, ['board', 'g-watch', '--interval', '5']);
    assert.equal(noWatch.status, 1);
    assert.equal(noWatch.stderr, 'aidlc: --interval needs --watch\n');
    for (const id of ['g-\u00e9\u001b[31m', '../x', 'a'.repeat(65)]) {
      const r = cli(fx, ['board', id, '--watch']);
      assert.equal(r.status, 1, id);
      assert.equal(r.stderr, 'aidlc: board --watch: INVALID_GOAL_ID\n', id);
    }
    const unknown = cli(fx, ['board', '--goal', 'g-missing', '--watch']);
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stderr, 'aidlc: unknown goal g-missing\n');
    assert.deepEqual(snapshot(fx.state), before);
  } finally {
    cleanup(fx.tmp);
  }
});

test('board --watch with no goal id checks the default goal: an unreadable goal list and a stored id that is not plain exit 1 (acceptance 5) [R5]', () => {
  const fx = fixture();
  try {
    writeFileSync(path.join(fx.state, 'goals', 'g-bad.json'), '{ "id": CANARY', 'utf8');
    const unreadable = cli(fx, ['board', '--watch']);
    assert.equal(unreadable.status, 1);
    assert.equal(unreadable.stderr, 'aidlc: board --watch: MALFORMED_JSON\n');
    // An empty id that is supplied is checked as given and never selects the default goal: with the goal list
    // unreadable, a default selection would print MALFORMED_JSON instead (R3 decision 1, F2).
    for (const args of [['board', '', '--watch'], ['board', '--watch', '--goal', '']]) {
      const empty = cli(fx, args);
      assert.equal(empty.status, 1, JSON.stringify(args));
      assert.equal(empty.stderr, 'aidlc: board --watch: INVALID_GOAL_ID\n', JSON.stringify(args));
    }
    writeFileSync(path.join(fx.state, 'goals', 'g-bad.json'), JSON.stringify(goal({ id: 'g-\u001b[2J', createdAt: '2026-09-12T00:00:00.000Z' })), 'utf8');
    const odd = cli(fx, ['board', '--watch']);
    assert.equal(odd.status, 1);
    assert.equal(odd.stderr, 'aidlc: board --watch: INVALID_GOAL_ID\n');
  } finally {
    cleanup(fx.tmp);
  }
});

test('the watch loop renders on each interval and, stopped the way SIGINT stops it, ends with no error and writes nothing after (acceptance 6) [R5]', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const out = new PassThrough();
    const written: string[] = [];
    out.on('data', (d: Buffer) => written.push(d.toString()));
    const stop = new AbortController();
    let n = 0;
    const ended = watchLoop(() => `screen ${++n}`, out, 1000, stop.signal);
    mock.timers.tick(1000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(written, ['screen 1\n\n', 'screen 2\n\n']);
    stop.abort();
    assert.equal(await ended, undefined);
    mock.timers.tick(5000);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(n, 2, 'no screen is rendered after the stop');
    assert.equal(written.length, 2, 'nothing is written after the stop');
  } finally {
    mock.timers.reset();
  }
});

test('the watch loop ends quietly on EPIPE, reports any other stdout error code, and clears a terminal before each screen (acceptance 6) [R5]', async () => {
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    for (const [code, expected] of [['EPIPE', undefined], ['EIO', 'EIO']] as const) {
      const out = new PassThrough();
      let n = 0;
      const ended = watchLoop(() => `screen ${++n}`, out, 1000, new AbortController().signal);
      out.emit('error', Object.assign(new Error('write failed'), { code }));
      assert.equal(await ended, expected, code);
      mock.timers.tick(5000);
      assert.equal(n, 1, `${code}: the timer is cleared`);
    }
    const tty = Object.assign(new PassThrough(), { isTTY: true });
    const written: string[] = [];
    tty.on('data', (d: Buffer) => written.push(d.toString()));
    const stop = new AbortController();
    const ended = watchLoop(() => 'screen', tty, 1000, stop.signal);
    stop.abort();
    await ended;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(written, ['\u001b[2J\u001b[Hscreen\n\n']);
  } finally {
    mock.timers.reset();
  }
});

test('a real SIGINT ends board --watch with exit 0 and an empty stderr', { skip: process.platform === 'win32' ? 'win32 has no SIGINT delivery to a child process; the injectable stop above covers the handler' : false }, async () => {
  const fx = fixture();
  try {
    const child = spawn(process.execPath, [main, 'board', 'g-watch', '--watch', '--interval', '1'], { cwd: fx.repo, env: fx.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
    const guard = setTimeout(() => child.kill('SIGKILL'), 20_000);
    await new Promise((resolve) => child.stdout.once('data', resolve));
    child.kill('SIGINT');
    const code = await exited;
    clearTimeout(guard);
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
  } finally {
    cleanup(fx.tmp);
  }
});

test('board --watch exits 1 naming the errno code when stdout fails with an error other than EPIPE', { skip: existsSync('/dev/full') ? false : 'needs /dev/full, which fails every write with ENOSPC (Linux only)' }, () => {
  const fx = fixture();
  try {
    const r = spawnSync(process.execPath, [main, 'board', 'g-watch', '--watch'], { cwd: fx.repo, env: fx.env, stdio: ['ignore', openSync('/dev/full', 'w'), 'pipe'], encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 1);
    assert.equal(r.stderr, 'aidlc: board --watch: ENOSPC\n');
  } finally {
    cleanup(fx.tmp);
  }
});
