/**
 * Card T1-DOD-RECORD: a successful `card attempt` runs the card's dod_command in the card worktree through the DoD call
 * of the mutant sweep and records what the run gave on the attempt (`loopDod`); the record changes no state, and
 * `card status` prints it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type ExecOptions } from '../../src/probes/exec.ts';
import type { Card, CardRun, Goal, LoopDod } from '../../src/core/types.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const TREE_CHILD = fileURLToPath(new URL('../infra/exec-tree.child.ts', import.meta.url));
const CARD = 'T1-DR';
const HEAD = 'c'.repeat(40);
const PRIOR = 'b'.repeat(40);
const OUT = `é${'x'.repeat(4091)}`;
const ERR = 'tail';
const DOD_SCRIPT = `process.stdout.write('é' + 'x'.repeat(4091));\nprocess.stderr.write('tail');\nprocess.exitCode = Number(process.argv[2]);\n`;

type Call = [string, string[], ExecOptions | undefined];
interface Ctx {
  fx: Fixture;
  runner: CardRunner;
  goalId: string;
  card: Card;
  g: () => Goal;
  run: () => CardRun;
  worktree: string;
  calls: Call[];
  nonGit: () => Call[];
  git: { status: string; exit: number };
  patch: (change: (run: CardRun) => CardRun) => CardRun;
}

/** Acceptance detail 2: a card at BUILD with its worktree directory and dod.mjs, and a runner that records each call. */
function atBuild(dodCommand: string, options: { ship?: 'github' | 'dry-run'; dodTimeoutMs?: number } = {}): Ctx {
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
  const calls: Call[] = [];
  const recording = (command: string, args: string[], opts?: ExecOptions) => {
    calls.push([command, args, opts]);
    return command === 'git' ? script(command, args, opts) : runSync(command, args, opts);
  };
  const ship = options.ship ?? 'github';
  const deps = { paths: fx.paths, repo: fx.repo, config: { ...fx.config, shipPath: ship, ...(ship === 'github' ? { repository: 'o/r' } : {}) }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: recording, ...(options.dodTimeoutMs ? { dodTimeoutMs: options.dodTimeoutMs } : {}) };
  const runner = new CardRunner(deps);
  return {
    fx,
    runner,
    goalId,
    card,
    g,
    run: () => fx.store.getCardRun(goalId, CARD)!,
    worktree,
    calls,
    nonGit: () => calls.filter((c) => c[0] !== 'git'),
    git,
    patch: (change) => fx.store.updateCardRun(goalId, CARD, (run) => change(run!)),
  };
}

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
const succeed = (c: Ctx, input: Input = SUCCESS): CardRun => c.runner.recordAttempt(c.g(), c.card, c.run(), input);
const loopDodOf = (run: CardRun): LoopDod | undefined => (run.effort!.attempts.at(-1) as { loopDod?: LoopDod }).loopDod;
const projection = (run: CardRun) => [run.state, run.effort?.terminal, run.effort?.attempts.map((a) => [a.n, a.outcome]), run.dodReceipt, run.candidate];

/** `card status` through the CLI from the sources, text output (`--no-json`: stdout is not a TTY). */
function status(c: Ctx): { status: number | null; stdout: string; stderr: string } {
  return spawnSync(process.execPath, [MAIN, 'card', 'status', CARD, '--goal', c.goalId, '--no-json'], { cwd: c.fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: c.fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 60_000 });
}
const loopDodLine = (stdout: string): string | undefined => stdout.split(/\r?\n/).find((l) => l.startsWith('loopDod='));

/** sha256 of the UTF-8 bytes of stdout, one 0x00 byte, then stderr (R3), from the literal output of dod.mjs. */
const OUT_SHA = createHash('sha256').update(Buffer.concat([Buffer.from(OUT, 'utf8'), Buffer.from([0]), Buffer.from(ERR, 'utf8')])).digest('hex');
const OUT_TAIL = `�${'x'.repeat(4091)}tail`;
const LINE_FORM = /^loopDod=attempt \d+ exit=(\d+|none) dod_exit=\d+ (matches|DIFFERS) timedOut=(true|false) commit=([0-9a-f]{40}|-) clean=(true|false|-) durationMs=\d+ sha256=[0-9a-f]{64}$/;

describe('T1-DOD-RECORD', () => {
  it('a passing DoD is recorded on the success through the DoD call of the sweep [R1] [R2] [R3] [R7]', async () => {
    await withCtx(() => atBuild('node dod.mjs 0'), (c) => {
      const run = succeed(c);
      const rec = loopDodOf(run);
      assert.ok(rec, 'the attempt carries loopDod');
      const { durationMs, ...rest } = rec as LoopDod & { durationMs: number };
      assert.ok(Number.isInteger(durationMs), `durationMs is an integer: ${durationMs}`);
      assert.deepEqual(rest, { ran: true, command: 'node dod.mjs 0', worktree: c.worktree, commit: HEAD, clean: true, exitCode: 0, timedOut: false, expectedExit: 0, timeoutMs: 540000, outputSha256: OUT_SHA, outputTail: OUT_TAIL });
      assert.deepEqual(c.nonGit(), [['node dod.mjs 0', [], { cwd: c.worktree, shell: true, timeoutMs: 540000, killTree: true }]]);
      const r = status(c);
      assert.equal(r.status, 0, r.stderr);
      const line = loopDodLine(r.stdout);
      assert.ok(line?.startsWith('loopDod=attempt 1 exit=0 dod_exit=0 matches timedOut=false commit='), `status line: ${r.stdout}`);
      assert.match(line!, LINE_FORM);
    });
  });

  it('a failing DoD is recorded and changes nothing else [R3] [R6] [R7]', async () => {
    let passing: unknown;
    await withCtx(() => atBuild('node dod.mjs 0'), (c) => {
      passing = projection(succeed(c));
    });
    await withCtx(() => atBuild('node dod.mjs 3'), (c) => {
      const run = succeed(c);
      const rec = loopDodOf(run) as (LoopDod & { exitCode: number | null; expectedExit: number }) | undefined;
      assert.ok(rec, 'the attempt carries loopDod');
      assert.equal(rec.exitCode, 3);
      assert.equal(rec.expectedExit, 0);
      assert.deepEqual(projection(run), passing);
      const r = status(c);
      assert.equal(r.status, 0, r.stderr);
      const line = loopDodLine(r.stdout);
      assert.ok(line?.includes('exit=3 dod_exit=0 DIFFERS'), `status line: ${r.stdout}`);
      assert.match(line!, LINE_FORM);
    });
  });

  it('a DoD past the timeout is ended with its process tree [R2] [R5] [R6]', async () => {
    const pids: number[] = [];
    await withCtx(() => atBuild(`node "${TREE_CHILD}" stay tree.pid`, { dodTimeoutMs: 10000 }), async (c) => {
      try {
        const run = succeed(c);
        for (const f of ['tree.pid.root', 'tree.pid']) {
          try {
            const pid = Number(readFileSync(path.join(c.worktree, f), 'utf8'));
            if (Number.isInteger(pid) && pid > 0) pids.push(pid);
          } catch {
            /* asserted below */
          }
        }
        const rec = loopDodOf(run) as (LoopDod & { timedOut: boolean; exitCode: number | null; durationMs: number }) | undefined;
        assert.ok(rec, 'the attempt carries loopDod');
        assert.equal(rec.timedOut, true);
        assert.equal(rec.exitCode, null);
        assert.ok(rec.durationMs >= 10000, `durationMs ${rec.durationMs} is at least the timeout`);
        assert.equal(run.effort?.terminal, 'succeeded');
        assert.equal(run.dodReceipt, 'dod:1');
        assert.equal(pids.length, 2, 'both pid files hold a pid');
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
      assert.throws(() => succeed(c), (e: Error) => e.message.includes('uncommitted or untracked changes') && e.message.includes('nothing was recorded'));
      assert.deepEqual(c.nonGit(), []);
      assert.equal(readFileSync(file, 'utf8'), before);
    });
  });

  it('a run with no worktree directory records the DoD as not run and starts nothing [R4] [R6]', async () => {
    const cases: { name: string; set: (c: Ctx) => string | undefined; expected: (w: string | undefined) => LoopDod }[] = [
      { name: 'unset', set: () => undefined, expected: () => ({ ran: false, command: 'node dod.mjs 0', reason: 'no-worktree' }) as LoopDod },
      { name: 'nothing there', set: (c) => path.join(c.fx.tmp, 'gone-worktree'), expected: (w) => ({ ran: false, command: 'node dod.mjs 0', reason: 'no-directory', worktree: w }) as LoopDod },
      {
        name: 'a file there',
        set: (c) => {
          const f = path.join(c.fx.tmp, 'file-worktree');
          writeFileSync(f, 'not a directory', 'utf8');
          return f;
        },
        expected: (w) => ({ ran: false, command: 'node dod.mjs 0', reason: 'no-directory', worktree: w }) as LoopDod,
      },
    ];
    for (const k of cases) {
      await withCtx(() => atBuild('node dod.mjs 0'), (c) => {
        const w = k.set(c);
        c.patch((run) => ({ ...run, worktree: w }));
        const run = succeed(c, { ...SUCCESS, candidateSha: PRIOR });
        assert.equal(run.effort?.terminal, 'succeeded', k.name);
        assert.deepEqual(loopDodOf(run), k.expected(w), k.name);
        assert.deepEqual(c.nonGit(), [], k.name);
        if (k.name === 'a file there') assert.equal(run.candidate?.sha, HEAD, 'the file path is probed and binds the scripted HEAD');
      });
    }
  });

  it('a record written before the card parses and shows loopDod=- [R7] [R8]', async () => {
    await withCtx(() => atBuild('node dod.mjs 0'), (c) => {
      const recorded = succeed(c);
      const file = c.fx.store.cardFile(c.goalId, CARD);
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { effort: { attempts: Record<string, unknown>[] } };
      for (const a of raw.effort.attempts) delete a.loopDod;
      writeFileSync(file, JSON.stringify(raw, null, 2), 'utf8');
      const parsed = c.fx.store.getCardRun(c.goalId, CARD)!;
      assert.equal(parsed.state, recorded.state);
      assert.equal(parsed.effort?.terminal, recorded.effort?.terminal);
      for (const a of parsed.effort!.attempts) assert.equal('loopDod' in a, false);
      const r = status(c);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.split(/\r?\n/).includes('loopDod=-'), `status prints loopDod=-: ${r.stdout}`);
    });
  });

  it('commit and clean are absent when no probe of this call read them [R3]', async () => {
    const prior = { sha: PRIOR, dirty: false, untracked: [], digest: PRIOR };
    for (const ship of ['github', 'dry-run'] as const) {
      await withCtx(() => atBuild('node dod.mjs 0', { ship }), (c) => {
        c.patch((run) => ({ ...run, candidate: prior }));
        if (ship === 'github') c.git.exit = 128;
        const run = succeed(c, ship === 'dry-run' ? { ...SUCCESS, candidateSha: HEAD } : SUCCESS);
        const rec = loopDodOf(run) as Record<string, unknown> | undefined;
        assert.ok(rec, `${ship}: the attempt carries loopDod`);
        assert.equal(rec.ran, true, ship);
        assert.equal(rec.exitCode, 0, ship);
        assert.equal(c.nonGit().length, 1, ship);
        assert.equal('commit' in rec, false, `${ship}: no commit key`);
        assert.equal('clean' in rec, false, `${ship}: no clean key`);
      });
    }
  });
});
