/**
 * Card T0-DOD-RECEIPT-REQUIRED: a success attempt with no DoD receipt, or a blank one, is refused after every existing refusal
 * of `recordAttempt` and before anything of the attempt is recorded; the build directives, the help and the documents name
 * `--dod-receipt`.
 */
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';
import fs, { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { cleanup } from '../infra/helpers.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { mutantsMarkerPath } from '../../src/review/mutants.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { Card, CardRun, Goal, JournalEvent } from '../../src/core/types.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const T = '2026-09-11T00:00:00.000Z';
const HEAD = 'a'.repeat(40);
const ACCEPTANCE_TABLE = 'When allow_paths lists this card file, write a table in its `## Attempt evidence` section before the final DoD run, one row per acceptance item: the item number, the test or command that proves it, and its result. A row with no proof is unfinished work. Correct the table on every repair.';
const msg = (id: string) => `a successful attempt on card ${id} needs a DoD receipt: the attempt carries none or a blank one, and nothing was recorded; record it again with --dod-receipt "<command: exit code and counts>"`;

type Input = Parameters<CardRunner['recordAttempt']>[3];
type Owing = CardRun & { journalOwed?: Record<'key' | 'type', string>[] };

interface Ctx {
  fx: Fixture;
  runner: CardRunner;
  goalId: string;
  id: string;
  card: Card;
  g: () => Goal;
  run: () => CardRun;
  cardFile: string;
  patch: (change: (run: CardRun) => CardRun) => CardRun;
  attempt: (input: Input) => CardRun;
  next: () => ReturnType<CardRunner['next']>;
  bytes: () => string;
  ofType: (type: string) => JournalEvent[];
  /** The first `build` directive narration. */
  first: string;
  worktree: string;
  /** The scripted `git status` output and exit code; `probes` counts the status calls (fixture G only). */
  git: { status: string; exit: number; probes: number };
}

function ctxOf(fx: Fixture, runner: CardRunner, goalId: string, id: string, first: string, worktree: string, git: Ctx['git']): Ctx {
  const card = fx.card(id);
  const g = () => fx.goal(goalId);
  const run = () => fx.store.getCardRun(goalId, id)!;
  const cardFile = fx.store.cardFile(goalId, id);
  return {
    fx,
    runner,
    goalId,
    id,
    card,
    g,
    run,
    cardFile,
    patch: (change) => fx.store.updateCardRun(goalId, id, (r) => change(r!)),
    attempt: (input) => runner.recordAttempt(g(), card, run(), input),
    next: () => runner.next(g(), card, run()),
    bytes: () => readFileSync(cardFile, 'utf8'),
    ofType: (type) => fx.events(goalId).filter((e) => e.type === type),
    first,
    worktree,
    git,
  };
}

/** Fixture D: a dry-run card at BUILD with attempt 1 running; `T0-DR` is a tdd card and `T0-DRN` is not. */
function atBuild(t: TestContext, id: 'T0-DR' | 'T0-DRN' = 'T0-DR'): Ctx {
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  writeCard(fx, { id, title: 'dod receipt', allowPaths: ['src/t0-dr.ts'], ...(id === 'T0-DRN' ? { tdd: false } : {}) });
  const goalId = goalForCards(fx, [id]).id;
  const card = fx.card(id);
  const runner = fx.runner();
  let r = runner.next(fx.goal(goalId), card, fx.controller.ensureCardRun(fx.goal(goalId), id));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  r = runner.next(fx.goal(goalId), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  return ctxOf(fx, runner, goalId, id, r.directive.narration, '', { status: '', exit: 0, probes: 0 });
}

/** Fixture G: a card at BUILD with an existing worktree directory and a scripted git, on the ship path `ship`. */
function atBuildGit(t: TestContext, ship: 'github' | 'scaffold'): Ctx {
  const fx = makeFixture({
    config: {
      gateRequired: true,
      preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'stop', shell: false },
      formalReview: { command: ['fake-p', '--schema', '{schema}', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false },
    },
  });
  t.after(() => cleanup(fx.tmp));
  writeCard(fx, { id: 'T0-DRG', title: 'dod receipt', allowPaths: ['src/t0-drg.ts'] });
  const goalId = goalForCards(fx, ['T0-DRG']).id;
  const card = fx.card('T0-DRG');
  const dry = fx.runner();
  let r = dry.next(fx.goal(goalId), card, fx.controller.ensureCardRun(fx.goal(goalId), 'T0-DRG'));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  r = dry.next(fx.goal(goalId), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  const worktree = r.run.worktree!;
  mkdirSync(worktree, { recursive: true });
  const git = { status: '', exit: 0, probes: 0 };
  const script = scriptedRunner({
    'git rev-parse --verify HEAD': { stdout: `${HEAD}\n` },
    'git status --porcelain=v1 --untracked-files=all': () => (git.probes++, { stdout: git.status, exitCode: git.exit, stderr: git.exit ? 'fatal: not a git repository' : '' }),
    'git diff --numstat': { stdout: '0\t0\tsrc/t0-drg.ts\n' },
    'git diff --name-only': { stdout: 'src/t0-drg.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t0-drg.ts b/src/t0-drg.ts\n+export const drg = 1;\n' },
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, shipPath: ship, ...(ship === 'github' ? { repository: 'o/r' } : {}) }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  return ctxOf(fx, runner, goalId, 'T0-DRG', r.directive.narration, worktree, git);
}

/**
 * `act` throws a message that is `expected` (equal, matching or accepted by the function); the card-run file is
 * byte-identical and the journal holds the same events.
 */
function refused(c: Ctx, act: () => unknown, expected: string | RegExp | ((m: string) => boolean), label = ''): Error {
  const before = c.bytes();
  const journal = JSON.stringify(c.fx.events(c.goalId));
  let thrown: Error | undefined;
  assert.throws(
    act,
    (e: unknown) => {
      thrown = e as Error;
      const m = thrown.message;
      if (typeof expected === 'string') assert.equal(m, expected, label);
      else if (expected instanceof RegExp) assert.match(m, expected, label);
      else assert.ok(expected(m), `${label}: ${m}`);
      return true;
    },
    `${label}: no error`,
  );
  assert.equal(c.bytes(), before, `${label}: the card-run file is byte-identical`);
  assert.equal(JSON.stringify(c.fx.events(c.goalId)), journal, `${label}: the journal holds the same events`);
  return thrown!;
}

/** Run `body` with the first journal append of `event` throwing an injected error; returns what `body` threw. */
function failingAppend(event: string, body: () => unknown): unknown {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['appendFileSync']!;
  let fired = false;
  target['appendFileSync'] = (...args: unknown[]) => {
    if (!fired && String(args[0]).endsWith('.jsonl') && String(args[1]).includes(`"type":"${event}"`)) {
      fired = true;
      throw Object.assign(new Error('EIO: injected appendFileSync'), { code: 'EIO' });
    }
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    body();
    return undefined;
  } catch (error) {
    return error;
  } finally {
    target['appendFileSync'] = real;
    syncBuiltinESMExports();
  }
}

const dirtyRefusal = (c: Ctx, named: string[]) => (m: string) => {
  assert.ok(m.includes(c.worktree), `names the worktree: ${m}`);
  for (const p of named) assert.ok(m.includes(p), `names ${p}: ${m}`);
  assert.match(m, /nothing (was|is) recorded/i);
  return true;
};

const BLANKS: [string, unknown][] = [
  ['absent', undefined],
  ['empty', ''],
  ['space', ' '],
  ['tab', '\t'],
  ['line feed', '\n'],
  ['carriage return and line feed', '\r\n'],
  ['U+00A0', ' '],
  ['U+FEFF', '﻿'],
  ['U+2028', ' '],
  ['mixed white space', ' \t\n '],
  ['null', null],
  ['a number', 42],
];

describe('T0-DOD-RECEIPT-REQUIRED: a success with no receipt or a blank one records nothing [R1] [R3]', () => {
  it('a success without a DoD receipt, or with a blank one, is refused and records nothing [acceptance 1]', (t) => {
    for (const id of ['T0-DR', 'T0-DRN'] as const) {
      const c = atBuild(t, id);
      const base = { outcome: 'success', ...(id === 'T0-DR' ? { redReceipt: 'red:1' } : {}), candidateSha: 'sha-dr' } as const;
      for (const [name, value] of BLANKS) {
        const input = { ...base, dodReceipt: value } as unknown as Input;
        refused(c, () => c.attempt(input), msg(id), `${id} ${name}`);
        assert.equal(c.run().effort?.attempts.at(-1)?.outcome, 'running', `${id} ${name}: attempt 1 is still running`);
      }
      const saved = c.attempt({ ...base, dodReceipt: 'node --test exit 0: 3 pass' });
      assert.equal(saved.effort?.terminal, 'succeeded');
      assert.equal(saved.dodReceipt, 'node --test exit 0: 3 pass');
    }
  });

  it('a receipt the stored run holds does not stand in for the attempt\'s [acceptance 2]', (t) => {
    const c = atBuild(t);
    c.patch((run) => ({ ...run, dodReceipt: 'dod:earlier' }));
    refused(c, () => c.attempt({ outcome: 'success', redReceipt: 'red:1', candidateSha: 'sha-dr' }), msg('T0-DR'));
    assert.equal(c.run().dodReceipt, 'dod:earlier');
    assert.equal(c.run().effort?.attempts.at(-1)?.outcome, 'running');
  });

  describe('a non-blank receipt is stored as given, and other outcome strings bypass the guard [acceptance 3]', () => {
    const ok = { outcome: 'success', redReceipt: 'red:1', candidateSha: 'sha-dr' } as const;
    for (const receipt of [' exit 0: 3 pass ', 'dod:2026-09-11T00:00:00.000Z']) {
      it(`stores ${JSON.stringify(receipt)} as given`, (t) => {
        const c = atBuild(t);
        const saved = c.attempt({ ...ok, dodReceipt: receipt });
        assert.equal(saved.dodReceipt, receipt);
        assert.equal(saved.effort?.terminal, 'succeeded');
      });
    }
    for (const input of [{ outcome: 'fail', cause: 'red' }, { outcome: 'fail', cause: 'red', dodReceipt: '  ' }] as const) {
      it(`records ${JSON.stringify(input)}`, (t) => {
        const c = atBuild(t);
        const saved = c.attempt(input);
        assert.equal(saved.effort?.attempts.at(-1)?.outcome, 'fail');
        assert.equal(saved.dodReceipt, undefined);
      });
    }
    it('records a not-counted attempt with no receipt', (t) => {
      const c = atBuild(t);
      const saved = c.attempt({ outcome: 'not-counted', notCountedReason: 'expected-red', redReceipt: 'red:1' });
      assert.equal(saved.effort?.attempts.at(-1)?.outcome, 'not-counted');
    });
    it('refuses `Success` at the save, not with the receipt message, and writes nothing', (t) => {
      const c = atBuild(t);
      refused(c, () => c.attempt({ ...ok, outcome: 'Success' as never }), (m) => !m.includes('needs a DoD receipt'));
    });
    it('records `running` with no receipt as on main', (t) => {
      const c = atBuild(t);
      const saved = c.attempt({ outcome: 'running' as never });
      assert.equal(saved.effort?.attempts.at(-1)?.outcome, 'running');
      assert.equal(saved.effort?.attempts.at(-1)?.finishedAt, T);
      assert.equal(c.ofType('ATTEMPT_FINISHED').at(-1)?.data['outcome'], 'running');
    });
  });
});

describe('T0-DOD-RECEIPT-REQUIRED: the refusal comes after every existing one and before the save [R1] [R2]', () => {
  const NOREC: Input = { outcome: 'success', redReceipt: 'red:1' };
  const row = (name: string, body: (c: Ctx) => void) => it(`${name} [acceptance 4]`, (t) => body(atBuildGit(t, 'github')));

  describe('every existing refusal still comes first', () => {
    row('(a) a mutant marker, probing nothing', (c) => {
      const marker = mutantsMarkerPath(c.worktree, 'T0-DRG');
      mkdirSync(path.dirname(marker), { recursive: true });
      writeFileSync(marker, '');
      refused(c, () => c.attempt(NOREC), /a mutant run is in progress or was interrupted/);
      assert.equal(c.git.probes, 0);
    });

    row('(b) an owed delivery: a failed delivery propagates, a retried one journals the event once and then the DoD refusal comes', (c) => {
      assert.match(String(failingAppend('ATTEMPT_FINISHED', () => c.attempt({ outcome: 'fail', cause: 'red' }))), /EIO: injected/);
      const owed = (c.run() as Owing).journalOwed!;
      assert.deepEqual(owed.map((o) => o.type), ['ATTEMPT_FINISHED']);
      const started = c.ofType('ATTEMPT_STARTED').length;
      const before = c.bytes();
      assert.match(String(failingAppend('ATTEMPT_FINISHED', () => c.attempt(NOREC))), /EIO: injected/, 'the injected error, not the DoD error');
      assert.equal(c.bytes(), before, 'the card-run file is byte-identical');
      assert.equal(c.ofType('ATTEMPT_FINISHED').length, 0);
      assert.throws(() => c.attempt(NOREC), (e: Error) => e.message === msg('T0-DRG'));
      assert.equal(c.bytes(), before, 'the delivery writes nothing to the run');
      const finished = c.ofType('ATTEMPT_FINISHED');
      assert.equal(finished.length, 1, 'the owed event is journaled once');
      assert.deepEqual([finished[0]!.data['outcome'], finished[0]!.data['eventKey'], finished[0]!.data['completed']], ['fail', owed[0]!.key, true]);
      assert.equal(c.ofType('ATTEMPT_STARTED').length, started, 'no ATTEMPT_STARTED of the call');
    });

    row('(c) lost checks, probing nothing', (c) => {
      refused(c, () => c.attempt({ ...NOREC, checksLost: ['t1'] }), /a successful attempt cannot report lost checks \(t1\)/);
      assert.equal(c.git.probes, 0);
    });

    row('(d) a missing RED receipt, probing nothing', (c) => {
      refused(c, () => c.attempt({ outcome: 'success' }), /a successful attempt on tdd card T0-DRG needs a RED receipt/);
      assert.equal(c.git.probes, 0);
    });

    row('(e) a stopped episode with no attempt running', (c) => {
      c.attempt({ outcome: 'fail', cause: 'red' });
      c.patch((run) => ({ ...run, effort: { ...run.effort!, terminal: 'exhausted' } }));
      refused(c, () => c.attempt(NOREC), 'no attempt may start: exhausted: episode already terminal');
    });

    row('(f) a succeeded episode', (c) => {
      c.attempt({ ...NOREC, dodReceipt: 'dod:1' });
      refused(c, () => c.attempt(NOREC), (m) => m.includes('episode already succeeded') && m.includes('aidlc card withdraw T0-DRG'));
    });

    row('(g) a stopped episode with attempt 1 running', (c) => {
      c.patch((run) => ({ ...run, effort: { ...run.effort!, terminal: 'exhausted' } }));
      refused(c, () => c.attempt(NOREC), 'the effort episode is terminal (exhausted); no attempt may be recorded');
    });

    row('(h) a dirty worktree, after one probe', (c) => {
      c.git.status = ' M src/a.ts\n';
      refused(c, () => c.attempt(NOREC), dirtyRefusal(c, ['src/a.ts']));
      assert.equal(c.git.probes, 1);
    });

    row('(i) a withdrawn candidate', (c) => {
      c.attempt({ ...NOREC, dodReceipt: 'dod:1' });
      c.runner.withdrawCandidate(c.g(), c.card, c.run(), 'the empty input is not covered');
      c.next();
      refused(c, () => c.attempt(NOREC), /is the withdrawn one/);
    });
  });

  for (const ship of ['github', 'scaffold'] as const) {
    it(`the DoD refusal comes after the probe on the ${ship} path, and before the save [acceptance 5]`, (t) => {
      const c = atBuildGit(t, ship);
      refused(c, () => c.attempt(NOREC), msg('T0-DRG'));
      assert.equal(c.git.probes, 1, 'the probe ran first');
      assert.equal(c.run().effort?.attempts.at(-1)?.outcome, 'running');
    });
  }

  it('a probe that fails keeps the prior candidate and the DoD refusal still comes after it [acceptance 5]', (t) => {
    const c = atBuildGit(t, 'github');
    c.git.exit = 128;
    refused(c, () => c.attempt(NOREC), msg('T0-DRG'));
    assert.equal(c.git.probes, 1);
  });
});

describe('T0-DOD-RECEIPT-REQUIRED: the build directives name --dod-receipt [R5]', () => {
  it('the build directives name --dod-receipt [acceptance 6]', (t) => {
    const c = atBuild(t);
    const tddClause = `Record the result with \`aidlc card attempt T0-DR --outcome success --dod-receipt "<command: exit code and counts>"\` or \`aidlc card attempt T0-DR --outcome fail --cause ...\`.`;
    assert.ok(c.first.includes(tddClause), c.first);
    assert.match(c.first, /establish behavioural RED first/);
    assert.ok(c.first.endsWith(ACCEPTANCE_TABLE));
    assert.equal(c.first.split(ACCEPTANCE_TABLE).length, 2);
    const plainClause = 'then record the attempt outcome (`aidlc card attempt`) with the DoD receipt (`--dod-receipt "<command: exit code and counts>"`).';
    c.attempt({ outcome: 'not-counted', notCountedReason: 'expected-red', redReceipt: 'red:1' });
    const second = c.next().directive;
    assert.equal(second.kind, 'build', second.narration);
    assert.ok(second.narration.includes(plainClause), second.narration);
    assert.match(second.narration, /implement\/repair within allow_paths/);
    assert.equal(second.narration.split(ACCEPTANCE_TABLE).length, 2);
    const n = atBuild(t, 'T0-DRN');
    assert.ok(n.first.includes(plainClause), n.first);
  });
});

describe('T0-DOD-RECEIPT-REQUIRED: aidlc card attempt [R1] [R6]', () => {
  const cliEnv = (fx: Fixture): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      const upper = k.toUpperCase();
      if (!(upper.startsWith('GIT_') || upper.startsWith('AIDLC_') || upper === 'NODE_OPTIONS')) env[k] = v;
    }
    env['GIT_CEILING_DIRECTORIES'] = [...new Set([path.dirname(fx.tmp), path.dirname(realpathSync.native(fx.tmp))])].join(path.delimiter);
    env['AIDLC_STATE_DIR'] = fx.paths.root;
    env['AIDLC_SESSION'] = 'win-A';
    return env;
  };
  const cli = (fx: Fixture, args: string[], json = true) => spawnSync(process.execPath, [MAIN, ...args, ...(json ? ['--json'] : [])], { cwd: fx.tmp, env: cliEnv(fx), encoding: 'utf8', timeout: 60_000 });

  it('aidlc card attempt refuses a success without a receipt, and its help says the option is required on success [acceptance 7]', (t) => {
    const c = atBuild(t);
    const base = ['card', 'attempt', 'T0-DR', '--goal', c.goalId, '--outcome', 'success', '--red-receipt', 'red:1', '--candidate-sha', 'sha-cli'];
    for (const extra of [[], ['--dod-receipt', ''], ['--dod-receipt', '   ']]) {
      const before = c.bytes();
      const r = cli(c.fx, [...base, ...extra]);
      assert.equal(r.status, 1, `${extra.join(' ')}: ${r.stdout}${r.stderr}`);
      assert.ok(r.stderr.includes(msg('T0-DR')), r.stderr);
      assert.equal(c.bytes(), before);
    }
    const fx = makeFixture();
    t.after(() => cleanup(fx.tmp));
    writeCard(fx, { id: 'T0-DR', title: 'dod receipt', allowPaths: ['src/t0-dr.ts'] });
    const goalId = goalForCards(fx, ['T0-DR']).id;
    const r = cli(fx, ['card', 'attempt', 'T0-DR', '--goal', goalId, '--outcome', 'success', '--red-receipt', 'red:1', '--candidate-sha', 'sha-cli']);
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.ok(r.stderr.includes(msg('T0-DR')), r.stderr);
    const run = fx.store.getCardRun(goalId, 'T0-DR')!;
    assert.equal(run.state, 'PREPARE');
    assert.equal(run.effort, undefined);
    const types = fx.events(goalId).filter((e) => e.cardId === 'T0-DR').map((e) => e.type);
    assert.equal(types.filter((x) => x === 'CARD_DISPATCHED').length, 1);
    assert.ok(!types.includes('ATTEMPT_STARTED') && !types.includes('ATTEMPT_FINISHED'), types.join(','));
    const help = cli(fx, ['card', 'attempt', '--help'], false);
    assert.equal(help.status, 0, help.stderr);
    assert.ok(help.stdout.replace(/\s+/g, ' ').includes('--dod-receipt <text> the DoD command, its exit code and counts (required on success)'), help.stdout);
  });
});

describe('T0-DOD-RECEIPT-REQUIRED: stored receipts and not-counted attempts are read as before [R4]', () => {
  const ok = { outcome: 'success', redReceipt: 'red:1', candidateSha: 'sha-dr' } as const;
  it('stored receipts and not-counted attempts are read as before [acceptance 8]', (t) => {
    const a = atBuild(t);
    a.attempt({ ...ok, dodReceipt: 'dod:2026-09-11T00:00:00.000Z' });
    assert.equal(a.next().directive.kind, 'close');
    for (const [stored, kind] of [['', 'build'], ['   ', 'close']] as const) {
      const c = atBuild(t);
      c.attempt({ ...ok, dodReceipt: 'dod:1' });
      c.patch((run) => ({ ...run, dodReceipt: stored }));
      assert.equal(c.fx.store.getCardRun(c.goalId, 'T0-DR')!.dodReceipt, stored);
      assert.equal(c.next().directive.kind, kind, JSON.stringify(stored));
    }
    for (const [lost, kept] of [[undefined, 'dod:kept'], [['t1'], undefined]] as const) {
      const c = atBuild(t);
      c.patch((run) => ({ ...run, dodReceipt: 'dod:kept' }));
      const saved = c.attempt({ outcome: 'not-counted', notCountedReason: 'tool-outage', ...(lost ? { checksLost: [...lost] } : {}) });
      assert.equal(saved.dodReceipt, kept);
    }
  });
});

describe('T0-DOD-RECEIPT-REQUIRED: the documents and both card-loop copies [R7] [R8]', () => {
  const lf = (file: string) => readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
  const RED = 'A success attempt on a `tdd: true` card is refused when neither the stored run nor the attempt carries a RED receipt: `aidlc card attempt` names the missing RED receipt and records nothing (no attempt, no effort change, no candidate), so record the success again with `--red-receipt`.';
  const STOP = 'A repair attempt that a review fix opened and that is still running when such a failure stops the ladder stays in the stopped episode, and `aidlc card attempt` refuses to finish it with any outcome, naming the stop (card T0-RUNNING-REPAIR-STOP): a success recorded after the stop would otherwise turn the stopped episode back into a succeeded one.';
  const D = "A success attempt is also refused when it carries no DoD receipt, or one that is empty or only white space, whatever receipt the stored run holds (card T0-DOD-RECEIPT-REQUIRED): `aidlc card attempt` names the missing DoD receipt and records no attempt or attempt evidence, so record the success again with `--dod-receipt`, the DoD command with its exit code and counts; this refusal comes after every other check the attempt makes before it is recorded (the missing RED receipt, a stopped or succeeded episode, a dirty worktree and a withdrawn candidate among them, each with its own message), and on a card with no run yet the command still creates the run first. The receipt is the session's statement of the DoD result. A successful attempt requires a string that is non-blank under `String.prototype.trim`; the original string is stored without verifying its reported result. SHIP readiness continues to use the stored receipt's truthiness.";
  const ENTRY = '- T0-DOD-RECEIPT-REQUIRED (bugfix, audit item F15): a successful attempt is refused when it carries no DoD receipt, or one that is empty or only white space, whatever receipt the stored run holds: `aidlc card attempt --outcome success` without `--dod-receipt`, and every call of `CardRunner.recordAttempt` with the outcome `success`. The refusal records no attempt or attempt evidence (no attempt, neither the running one nor an implicit one, no effort change, candidate, DoD or RED receipt, `ATTEMPT_STARTED` or `ATTEMPT_FINISHED`); an event an earlier command owes is still delivered first, and on a card with no run yet `aidlc card attempt` still creates the run and its `CARD_DISPATCHED` event before the check. It comes after every existing refusal of the attempt, which keep their messages, and before the attempt is written. Before this card, when the other checks of the attempt passed, such a success was recorded with the generated receipt `dod:<timestamp>`, or with the empty or white-space text as given: a generated receipt or one of white space counted as present for the SHIP readiness although no DoD result was stated, and an empty one counted as absent, so the card stayed in BUILD with a succeeded episode and the next success was refused. A non-blank receipt is stored as given, and failed and not-counted attempts need none, as before; stored runs keep their receipts and are read as before. The build directives name `--dod-receipt "<command: exit code and counts>"`, both `card-loop.md` copies show it on the success command, and the help of `aidlc card attempt` says the option is required on success. The heartbeat comment of `CardRunner.next` no longer says that the controller renews the goal lease.';
  const COPIES = ['.claude/skills/aidlc-loop/card-loop.md', 'templates/claude/skills/aidlc-loop/card-loop.md'];
  const PINNED = [
    '`aidlc card next <id>` returns one directive from the precedence below; do that move, then `aidlc card next <id>` again.',
    "Verify skills: when a card changes a file that a `.claude/skills/verify-*/SKILL.md` covers, run that skill's check before SHIP; at CLOSE, move its sync commit to the merge commit only after confirming that the check describes the code there.",
    '- Card: `aidlc cards validate --card <id>`. Registry is authority; board is a view.',
    'aidlc review dispute',
  ];

  it('the documents and both card-loop copies name the DoD receipt [acceptance 9]', () => {
    const operations = lf('docs/OPERATIONS.md');
    const line = operations.split('\n').find((l) => l.includes(RED));
    assert.ok(line?.includes(`${RED} ${D}`), 'D1 and D2 follow the RED sentence on its line');
    assert.ok(operations.includes(STOP), 'the stop-naming sentence stays');
    const changelog = lf('CHANGELOG.md');
    assert.ok(changelog.includes(`${ENTRY}\n\n- T0-AUDIT-FIXES`), 'the entry sits above T0-AUDIT-FIXES');
    assert.equal(changelog.split(ENTRY).length, 2, 'the entry occurs once');
    const [live, template] = COPIES.map((f) => readFileSync(path.join(ROOT, f), 'utf8'));
    assert.equal(live, template, 'the two copies are identical');
    assert.ok(Buffer.byteLength(template!, 'utf8') <= 6500, 'under the cap');
    assert.ok(!/[^\x00-\x7F]/.test(template!), 'ASCII');
    const flat = template!.replace(/\s+/g, ' ');
    assert.ok(flat.includes('Attempts (MA2): `aidlc card attempt <id> --outcome success|fail|not-counted --cause "<normalized>" [--progress]`; success needs `--dod-receipt "<command: exit code and counts>"`. Record cause'), 'the success command names the flag');
    for (const pinned of PINNED) assert.ok(flat.includes(pinned), pinned);
    assert.ok(template!.includes('\n## SHIP\nVerify skills: '));
    assert.match(flat, /3 ?h|three hours|3-hour/i);
    assert.match(flat, /(missing|malformed|stale)[^.]*verdict[^.]*never\s+pass/i);
    assert.match(flat, /one retry/i);
    assert.ok(flat.indexOf('card close --all') > flat.indexOf('aidlc evidence retain --card'));
  });
});
