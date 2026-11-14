/**
 * Card T1-DOD-RECORD: a successful `card attempt` runs the card's dod_command in the card worktree through the DoD call
 * of the mutant sweep and records it on the attempt (`loopDod`); the record changes no state, and `card status` prints it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goalForCards, makeFixture, writeCard } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type ExecOptions } from '../../src/probes/exec.ts';
import type { CardRun, LoopDod } from '../../src/core/types.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const TREE_CHILD = fileURLToPath(new URL('../infra/exec-tree.child.ts', import.meta.url));
const CARD = 'T1-DR';
const HEAD = 'c'.repeat(40);
const PRIOR = 'b'.repeat(40);
const DOD_SCRIPT = `process.stdout.write('é' + 'x'.repeat(4091));\nprocess.stderr.write('tail');\nprocess.exitCode = Number(process.argv[2]);\n`;
/** sha256 of the UTF-8 bytes of stdout, one 0x00 byte, then stderr (R3), from the literal output of dod.mjs. */
const OUT_SHA = createHash('sha256').update(Buffer.concat([Buffer.from(`é${'x'.repeat(4091)}`, 'utf8'), Buffer.from([0]), Buffer.from('tail', 'utf8')])).digest('hex');
const OUT_TAIL = `�${'x'.repeat(4091)}tail`;
const LINE_FORM = /^loopDod=attempt \d+ exit=(\d+|none) dod_exit=\d+ (matches|DIFFERS) timedOut=(true|false) commit=([0-9a-f]{40}|-) clean=(true|false|-) durationMs=\d+ sha256=[0-9a-f]{64}$/;

/** Acceptance detail 2: a card at BUILD with its worktree directory and dod.mjs, and a runner that records each call. */
function atBuild(dodCommand: string, options: { ship?: 'github' | 'dry-run'; dodTimeoutMs?: number } = {}) {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'dod record', allowPaths: ['src/t1-dr.ts'], dodCommand });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const g = () => fx.goal(goalId);
  const dry = fx.runner();
  let r = dry.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  r = dry.next(g(), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  const worktree = r.run.worktree!;
  mkdirSync(worktree, { recursive: true });
  writeFileSync(path.join(worktree, 'dod.mjs'), DOD_SCRIPT, 'utf8');
  const git = { status: '', exit: 0 };
  const script = scriptedRunner({
    'git rev-parse --verify HEAD': { stdout: `${HEAD}\n` },
    'git status --porcelain=v1 --untracked-files=all': () => ({ stdout: git.status, exitCode: git.exit, stderr: git.exit ? 'fatal: not a git repository' : '' }),
  });
  const calls: [string, string[], ExecOptions | undefined][] = [];
  const recording = (command: string, args: string[], opts?: ExecOptions) => (calls.push([command, args, opts]), command === 'git' ? script(command, args, opts) : runSync(command, args, opts));
  const ship = options.ship ?? 'github';
  const config = { ...fx.config, shipPath: ship, ...(ship === 'github' ? { repository: 'o/r' } : {}) };
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: recording, ...(options.dodTimeoutMs ? { dodTimeoutMs: options.dodTimeoutMs } : {}) });
  const run = () => fx.store.getCardRun(goalId, CARD)!;
  const succeed = (input: Input = SUCCESS) => runner.recordAttempt(g(), card, run(), input);
  const patch = (change: (run: CardRun) => CardRun) => fx.store.updateCardRun(goalId, CARD, (stored) => change(stored!));
  return { fx, goalId, worktree, git, succeed, patch, nonGit: () => calls.filter((c) => c[0] !== 'git') };
}
type Ctx = ReturnType<typeof atBuild>;

async function withCtx(make: () => Ctx, body: (c: Ctx) => void | Promise<void>): Promise<void> {
  const c = make();
  try {
    await body(c);
  } finally {
    c.fx.cleanup();
  }
}

type Input = Parameters<CardRunner['recordAttempt']>[3];
const SUCCESS: Input = { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1' };
const loopDodOf = (run: CardRun) => (run.effort!.attempts.at(-1) as { loopDod?: LoopDod & Record<string, unknown> }).loopDod;
const projection = (run: CardRun) => [run.state, run.effort?.terminal, run.effort?.attempts.map((a) => [a.n, a.outcome]), run.dodReceipt, run.candidate];
/** `card status` through the CLI from the sources, text output (`--no-json`: stdout is not a TTY). */
const status = (c: Ctx) => spawnSync(process.execPath, [MAIN, 'card', 'status', CARD, '--goal', c.goalId, '--no-json'], { cwd: c.fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: c.fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 60_000 });
function statusLine(c: Ctx): string {
  const r = status(c);
  assert.equal(r.status, 0, r.stderr);
  const line = r.stdout.split(/\r?\n/).find((l) => l.startsWith('loopDod='));
  assert.ok(line, `status prints a loopDod line: ${r.stdout}`);
  return line;
}

describe('T1-DOD-RECORD', () => {
  it('a passing DoD is recorded on the success through the DoD call of the sweep [R1] [R2] [R3] [R7]', async () => {
    await withCtx(() => atBuild('node dod.mjs 0'), (c) => {
      const rec = loopDodOf(c.succeed());
      assert.ok(rec, 'the attempt carries loopDod');
      const { durationMs, ...rest } = rec;
      assert.ok(Number.isInteger(durationMs), `durationMs is an integer: ${durationMs}`);
      assert.deepEqual(rest, { ran: true, command: 'node dod.mjs 0', worktree: c.worktree, commit: HEAD, clean: true, exitCode: 0, timedOut: false, expectedExit: 0, timeoutMs: 540000, outputSha256: OUT_SHA, outputTail: OUT_TAIL });
      assert.deepEqual(c.nonGit(), [['node dod.mjs 0', [], { cwd: c.worktree, shell: true, timeoutMs: 540000, killTree: true }]]);
      const line = statusLine(c);
      assert.ok(line.startsWith('loopDod=attempt 1 exit=0 dod_exit=0 matches timedOut=false commit='), line);
      assert.match(line, LINE_FORM);
    });
  });

  it('a failing DoD is recorded and changes nothing else [R3] [R6] [R7]', async () => {
    let passing: unknown;
    await withCtx(() => atBuild('node dod.mjs 0'), (c) => void (passing = projection(c.succeed())));
    await withCtx(() => atBuild('node dod.mjs 3'), (c) => {
      const run = c.succeed();
      const rec = loopDodOf(run);
      assert.ok(rec, 'the attempt carries loopDod');
      assert.deepEqual([rec.exitCode, rec.expectedExit], [3, 0]);
      assert.deepEqual(projection(run), passing);
      const line = statusLine(c);
      assert.ok(line.includes('exit=3 dod_exit=0 DIFFERS'), line);
      assert.match(line, LINE_FORM);
    });
  });

  it('a DoD past the timeout is ended with its process tree [R2] [R5] [R6]', async () => {
    const pids: number[] = [];
    await withCtx(() => atBuild(`node "${TREE_CHILD}" stay tree.pid`, { dodTimeoutMs: 10000 }), async (c) => {
      try {
        const run = c.succeed();
        for (const f of ['tree.pid.root', 'tree.pid']) {
          try {
            pids.push(Number(readFileSync(path.join(c.worktree, f), 'utf8')));
          } catch {
            /* asserted below */
          }
        }
        const rec = loopDodOf(run);
        assert.ok(rec, 'the attempt carries loopDod');
        assert.deepEqual([rec.timedOut, rec.exitCode], [true, null]);
        assert.ok(Number(rec.durationMs) >= 10000, `durationMs ${rec.durationMs} is at least the timeout`);
        assert.deepEqual([run.effort?.terminal, run.dodReceipt], ['succeeded', 'dod:1']);
        assert.ok(pids.length === 2 && pids.every((p) => Number.isInteger(p) && p > 0), `both pid files hold a pid: ${pids}`);
        for (const pid of pids) {
          let code: string | undefined;
          for (let i = 0; i < 200 && code === undefined; i++) {
            try {
              process.kill(pid, 0);
              await new Promise((resolve) => setTimeout(resolve, 50));
            } catch (err) {
              code = (err as NodeJS.ErrnoException).code;
            }
          }
          assert.equal(code, 'ESRCH', `pid ${pid} has ended`);
        }
      } finally {
        for (const pid of pids) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* already ended */
          }
        }
      }
    });
  });

  it('a dirty worktree refuses the success before any DoD [R6]', async () => {
    await withCtx(() => atBuild('node dod.mjs 0'), (c) => {
      c.git.status = ' M src/a.ts\n';
      const file = c.fx.store.cardFile(c.goalId, CARD);
      const before = readFileSync(file, 'utf8');
      assert.throws(() => c.succeed(), (e: Error) => e.message.includes('uncommitted or untracked changes') && e.message.includes('nothing was recorded'));
      assert.deepEqual(c.nonGit(), []);
      assert.equal(readFileSync(file, 'utf8'), before);
    });
  });

  it('a run with no worktree directory records the DoD as not run and starts nothing [R4] [R6]', async () => {
    const file = (c: Ctx) => (writeFileSync(path.join(c.fx.tmp, 'file-worktree'), 'not a directory', 'utf8'), path.join(c.fx.tmp, 'file-worktree'));
    const cases: [string, (c: Ctx) => string | undefined, string][] = [['unset', () => undefined, 'no-worktree'], ['nothing there', (c) => path.join(c.fx.tmp, 'gone-worktree'), 'no-directory'], ['a file there', file, 'no-directory']];
    for (const [name, set, reason] of cases) {
      await withCtx(() => atBuild('node dod.mjs 0'), (c) => {
        const w = set(c);
        c.patch((run) => ({ ...run, worktree: w }));
        const run = c.succeed({ ...SUCCESS, candidateSha: PRIOR });
        assert.equal(run.effort?.terminal, 'succeeded', name);
        assert.deepEqual(loopDodOf(run), { ran: false, command: 'node dod.mjs 0', reason }, name);
        assert.equal(statusLine(c), `loopDod=attempt 1 not run: ${reason}`, name);
        assert.deepEqual(c.nonGit(), [], name);
        if (name === 'a file there') assert.equal(run.candidate?.sha, HEAD, 'the file path is probed and binds the scripted HEAD');
      });
    }
  });

  it('a record written before the card parses and shows loopDod=- [R7] [R8]', async () => {
    await withCtx(() => atBuild('node dod.mjs 0'), (c) => {
      const recorded = c.succeed();
      const file = c.fx.store.cardFile(c.goalId, CARD);
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { effort: { attempts: Record<string, unknown>[] } };
      for (const a of raw.effort.attempts) delete a.loopDod;
      writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
      const parsed = c.fx.store.getCardRun(c.goalId, CARD)!;
      assert.deepEqual([parsed.state, parsed.effort?.terminal], [recorded.state, recorded.effort?.terminal]);
      for (const a of parsed.effort!.attempts) assert.equal('loopDod' in a, false);
      assert.equal(statusLine(c), 'loopDod=-');
    });
  });

  it('commit and clean are absent when no probe of this call read them [R3]', async () => {
    for (const ship of ['github', 'dry-run'] as const) {
      await withCtx(() => atBuild('node dod.mjs 0', { ship }), (c) => {
        c.patch((run) => ({ ...run, candidate: { sha: PRIOR, dirty: false, untracked: [], digest: PRIOR } }));
        if (ship === 'github') c.git.exit = 128;
        const rec = loopDodOf(c.succeed(ship === 'dry-run' ? { ...SUCCESS, candidateSha: HEAD } : SUCCESS));
        assert.ok(rec, `${ship}: the attempt carries loopDod`);
        assert.deepEqual([rec.ran, rec.exitCode, c.nonGit().length], [true, 0, 1], ship);
        assert.deepEqual(['commit' in rec, 'clean' in rec], [false, false], `${ship}: no commit key and no clean key`);
      });
    }
  });
});
