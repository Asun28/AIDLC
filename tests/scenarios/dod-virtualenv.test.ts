/**
 * Card T0-DOD-VENV (issue 450): the loop-run DoD of a successful `card attempt` runs with the scripts directory of a Python
 * virtualenv first on PATH, found in the card worktree, then in the main checkout, and the `loopDod` record names it.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { goalForCards, makeFixture, writeCard } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type ExecOptions } from '../../src/probes/exec.ts';
import type { CardRun, LoopDod } from '../../src/core/types.ts';

const CARD = 'T0-DV';
const HEAD = 'c'.repeat(40);
/** A command name no PATH holds: only a virtualenv's probe program answers it. */
const PROBE = 'aidlc-venv-probe-450';
const SCRIPTS = process.platform === 'win32' ? 'Scripts' : 'bin';

/** A virtualenv `<root>/<name>` with `pyvenv.cfg` and, in the platform's scripts directory, the probe that prints `word`. */
function venvWithProbe(root: string, name: string, word: string): string {
  const dir = path.join(root, name);
  const scripts = path.join(dir, SCRIPTS);
  mkdirSync(scripts, { recursive: true });
  writeFileSync(path.join(dir, 'pyvenv.cfg'), 'home = /usr/bin\n', 'utf8');
  if (process.platform === 'win32') writeFileSync(path.join(scripts, `${PROBE}.cmd`), `@echo ${word}\r\n@exit /b 0\r\n`, 'utf8');
  else writeFileSync(path.join(scripts, PROBE), `#!/bin/sh\necho '${word}'\nexit 0\n`, { encoding: 'utf8', mode: 0o755 });
  return dir;
}

/** A card at BUILD with its worktree directory, as `atBuild` of dod-record.test.ts builds it, the DoD through the real runSync. */
function atBuild() {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'dod virtualenv', allowPaths: ['src/t0-dv.ts'], dodCommand: PROBE });
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
  const script = scriptedRunner({
    'git rev-parse --verify HEAD': { stdout: `${HEAD}\n` },
    'git status --porcelain=v1 --untracked-files=all': { stdout: '' },
  });
  const calls: [string, string[], ExecOptions | undefined][] = [];
  const recording = (command: string, args: string[], opts?: ExecOptions) => (calls.push([command, args, opts]), command === 'git' ? script(command, args, opts) : runSync(command, args, opts));
  const config = { ...fx.config, shipPath: 'github' as const, repository: 'o/r' };
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: recording });
  const run = () => fx.store.getCardRun(goalId, CARD)!;
  const succeed = () => runner.recordAttempt(g(), card, run(), { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1' });
  return { fx, worktree, mainRoot: fx.repo.mainRoot, succeed, nonGit: () => calls.filter((c) => c[0] !== 'git') };
}

const loopDodOf = (run: CardRun) => run.effort!.attempts.at(-1)!.loopDod as Extract<LoopDod, { ran: true }> | undefined;

describe('T0-DOD-VENV', () => {
  it('acceptance 3 - a .venv in the main checkout runs the DoD with its scripts directory first on PATH [R3] [R4]', () => {
    const c = atBuild();
    try {
      const dir = venvWithProbe(c.mainRoot, '.venv', 'main venv');
      const rec = loopDodOf(c.succeed());
      assert.ok(rec?.ran, 'the DoD ran');
      assert.equal(rec.exitCode, 0, rec.outputTail);
      assert.equal(rec.virtualenv, dir);
      assert.ok(rec.outputTail.includes('main venv'), rec.outputTail);
      const options = c.nonGit()[0]?.[2];
      assert.equal(options?.env?.VIRTUAL_ENV, dir, 'the DoD call carries the virtualenv');
    } finally {
      c.fx.cleanup();
    }
  });

  it('acceptance 4 - a venv in the card worktree comes before the main checkout [R1] [R4]', () => {
    const c = atBuild();
    try {
      venvWithProbe(c.mainRoot, '.venv', 'main venv');
      const dir = venvWithProbe(c.worktree, 'venv', 'worktree venv');
      const rec = loopDodOf(c.succeed());
      assert.ok(rec?.ran, 'the DoD ran');
      assert.equal(rec.exitCode, 0, rec.outputTail);
      assert.equal(rec.virtualenv, dir);
      assert.ok(rec.outputTail.includes('worktree venv'), rec.outputTail);
      assert.equal(rec.outputTail.includes('main venv'), false, rec.outputTail);
    } finally {
      c.fx.cleanup();
    }
  });

  it('no virtualenv in either root: no env on the call and no virtualenv on the record [R3] [R4]', () => {
    const c = atBuild();
    try {
      const rec = loopDodOf(c.succeed());
      assert.ok(rec?.ran, 'the DoD ran');
      assert.notEqual(rec.exitCode, 0, 'no PATH holds the probe');
      assert.equal('virtualenv' in rec, false);
      const options = c.nonGit()[0]?.[2];
      assert.equal(options && 'env' in options, false);
    } finally {
      c.fx.cleanup();
    }
  });
});
