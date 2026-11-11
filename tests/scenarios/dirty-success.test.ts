/**
 * Card T0-DIRTY-SUCCESS: `card attempt --outcome success` on a card worktree whose probe reports uncommitted or untracked
 * entries is refused before any write and names the entries, so the implementer commits, removes or ignores them and records
 * the success again with no counted failure. Everything outside that case is recorded as before the card.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs, { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { mutantsMarkerPath } from '../../src/review/mutants.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { Card, CardRun, Goal, JournalEvent } from '../../src/core/types.ts';

const CARD = 'T0-DS';
const HEAD = 'a'.repeat(40);
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const T = '2026-09-11T00:00:00.000Z';

/** The entry lists of R1, as `git status --porcelain=v1 --untracked-files=all` prints them, and the paths each names. */
const DIRTY: { name: string; status: string; named: string[]; more: boolean }[] = [
  { name: 'modified in the worktree', status: ' M src/a.ts\n', named: ['src/a.ts'], more: false },
  { name: 'modified in the index', status: 'M  src/a.ts\n', named: ['src/a.ts'], more: false },
  { name: 'added', status: 'A  src/n.ts\n', named: ['src/n.ts'], more: false },
  { name: 'deleted', status: ' D src/gone.ts\n', named: ['src/gone.ts'], more: false },
  { name: 'renamed', status: 'R  src/old.ts -> src/new.ts\n', named: ['src/old.ts -> src/new.ts'], more: false },
  { name: 'unmerged after a base-sync merge repair', status: 'UU CHANGELOG.md\n', named: ['CHANGELOG.md'], more: false },
  { name: 'an untracked file alone', status: '?? scratch.txt\n', named: ['scratch.txt'], more: false },
  {
    name: 'seven entries',
    status: ' M src/1.ts\n M src/2.ts\nA  src/3.ts\n D src/4.ts\n?? src/5.ts\n?? src/6.ts\n?? src/7.ts\n',
    named: ['src/1.ts', 'src/2.ts', 'src/3.ts', 'src/4.ts', 'src/5.ts'],
    more: true,
  },
];

interface Ctx {
  fx: Fixture;
  runner: CardRunner;
  goalId: string;
  card: Card;
  g: () => Goal;
  run: () => CardRun;
  worktree: string;
  cardFile: string;
  /** The scripted `git status` output and exit code; `probes` counts the status calls. */
  git: { status: string; exit: number; probes: number };
  patch: (change: (run: CardRun) => CardRun) => CardRun;
}

/** A card at BUILD with attempt 1 running and an existing worktree directory, driven by a runner on `ship`. */
function atBuild(ship: 'github' | 'scaffold' | 'dry-run' = 'github', options: { tdd?: boolean } = {}): Ctx {
  const fx = makeFixture({
    config: {
      gateRequired: true,
      preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'stop', shell: false },
      formalReview: { command: ['fake-p', '--schema', '{schema}', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false },
    },
  });
  writeCard(fx, { id: CARD, title: 'dirty success', allowPaths: ['src/t0-ds.ts'], ...(options.tdd === false ? { tdd: false } : {}) });
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
  const git = { status: '', exit: 0, probes: 0 };
  const script = scriptedRunner({
    'git rev-parse --verify HEAD': { stdout: `${HEAD}\n` },
    'git status --porcelain=v1 --untracked-files=all': () => (git.probes++, { stdout: git.status, exitCode: git.exit, stderr: git.exit ? 'fatal: not a git repository' : '' }),
    'git diff --numstat': { stdout: '0\t0\tsrc/t0-ds.ts\n' },
    'git diff --name-only': { stdout: 'src/t0-ds.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t0-ds.ts b/src/t0-ds.ts\n+export const ds = 1;\n' },
    'fake-r2': { stdout: PASS },
    'fake-p': { stdout: PASS },
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, shipPath: ship, ...(ship === 'github' ? { repository: 'o/r' } : {}) }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  return {
    fx,
    runner,
    goalId,
    card,
    g,
    run: () => fx.store.getCardRun(goalId, CARD)!,
    worktree,
    cardFile: path.resolve(fx.paths.cards, goalId, `${CARD}.json`),
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
const attempt = (c: Ctx, input: Input = SUCCESS): CardRun => c.runner.recordAttempt(c.g(), c.card, c.run(), input);
const next = (c: Ctx) => c.runner.next(c.g(), c.card, c.run());
const events = (c: Ctx): JournalEvent[] => c.fx.events(c.goalId);
const ofType = (c: Ctx, type: string): JournalEvent[] => events(c).filter((e) => e.type === type);
const bytes = (c: Ctx): string => readFileSync(c.cardFile, 'utf8');

/** `act` throws a message matching `expected`; the card-run file is byte-identical and the journal holds the same events. */
function refused(c: Ctx, act: () => unknown, expected: RegExp | ((e: Error) => boolean)): Error {
  const before = bytes(c);
  const journal = JSON.stringify(events(c));
  let thrown: Error | undefined;
  assert.throws(act, (e: unknown) => {
    thrown = e as Error;
    return expected instanceof RegExp ? expected.test(thrown.message) : expected(thrown);
  });
  assert.equal(bytes(c), before, 'the card-run file is byte-identical');
  assert.equal(JSON.stringify(events(c)), journal, 'the journal holds the same events');
  return thrown!;
}

/** The refusal of R1 for a worktree whose status lists `named`, ending with `, ...` when there are more. */
function dirtyRefusal(c: Ctx, named: string[], more: boolean): (e: Error) => boolean {
  return (e) => {
    const m = e.message;
    assert.ok(m.includes(c.worktree), `names the worktree: ${m}`);
    for (const p of named) assert.ok(m.includes(p), `names ${p}: ${m}`);
    assert.equal(m.includes(', ...'), more, `ends the list with ", ..." only past five entries: ${m}`);
    if (more) assert.ok(!m.includes('src/6.ts') && !m.includes('src/7.ts'), `names only the first five: ${m}`);
    assert.match(m, /nothing (was|is) recorded/i);
    assert.match(m, /commit/);
    assert.match(m, /remove/);
    assert.match(m, /ignore/);
    return true;
  };
}

/** Run `body` with the first journal append of `event` throwing an injected error. */
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

describe('T0-DIRTY-SUCCESS: a success on a dirty card worktree is refused before any write and names the entries', () => {
  for (const ship of ['github', 'scaffold'] as const) {
    for (const d of DIRTY) {
      it(`${ship}: a success with ${d.name} is refused with nothing recorded; the same call on a clean worktree records it and card next leaves BUILD [acceptance 1] [R1] [R2]`, () =>
        withCtx(
          () => atBuild(ship),
          (c) => {
            c.git.status = d.status;
            refused(c, () => attempt(c), dirtyRefusal(c, d.named, d.more));
            assert.equal(c.run().effort?.attempts.at(-1)?.outcome, 'running', 'attempt 1 is still running');
            c.git.status = '';
            const saved = attempt(c);
            assert.equal(saved.effort?.terminal, 'succeeded');
            assert.deepEqual([saved.candidate?.sha, saved.candidate?.dirty], [HEAD, false]);
            const directive = next(c).directive;
            assert.notEqual(directive.kind, 'build', directive.narration);
          },
        ));
    }
  }

  it('after a recorded fail, a dirty success opens no attempt, journals no ATTEMPT_STARTED and leaves the card-run file byte-identical [acceptance 2] [R1]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        attempt(c, { outcome: 'fail', cause: 'red' });
        assert.ok(!c.run().effort?.attempts.some((a) => a.outcome === 'running'), 'no attempt is running');
        const started = ofType(c, 'ATTEMPT_STARTED').length;
        c.git.status = ' M src/a.ts\n';
        refused(c, () => attempt(c), dirtyRefusal(c, ['src/a.ts'], false));
        assert.equal(ofType(c, 'ATTEMPT_STARTED').length, started);
        assert.deepEqual(c.run().effort?.attempts.map((a) => a.outcome), ['fail']);
      },
    ));

  it('a dirty success delivers the ATTEMPT_FINISHED a failed append of the fail left owed, once and completed, and then refuses; only the owed entry is cleared [acceptance 2] [R1]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        const error = failingAppend('ATTEMPT_FINISHED', () => attempt(c, { outcome: 'fail', cause: 'red' }));
        assert.match(String(error), /EIO: injected/);
        const before = c.run() as CardRun & { journalOwed?: { key: string; type: string }[] };
        assert.deepEqual(before.journalOwed?.map((o) => o.type), ['ATTEMPT_FINISHED']);
        assert.equal(ofType(c, 'ATTEMPT_FINISHED').length, 0);
        const started = ofType(c, 'ATTEMPT_STARTED').length;
        c.git.status = '?? scratch.txt\n';
        assert.throws(() => attempt(c), dirtyRefusal(c, ['scratch.txt'], false));
        const finished = ofType(c, 'ATTEMPT_FINISHED');
        assert.equal(finished.length, 1, 'the owed event is journaled once');
        assert.deepEqual([finished[0]!.data['outcome'], finished[0]!.data['eventKey'], finished[0]!.data['completed']], ['fail', before.journalOwed![0]!.key, true]);
        assert.equal(ofType(c, 'ATTEMPT_STARTED').length, started, 'no ATTEMPT_STARTED of this call');
        const after = c.run() as CardRun & { journalOwed?: unknown[] };
        assert.deepEqual({ ...after, journalOwed: undefined }, { ...before, journalOwed: undefined }, 'the run differs only in the owed entry');
        // The delivery writes nothing to the run: the entry is cleared in that the journal now holds it, so no later command
        // appends it again (card T0-JOURNAL-FAULT-EVENTS R2).
        assert.throws(() => attempt(c), dirtyRefusal(c, ['scratch.txt'], false));
        assert.equal(ofType(c, 'ATTEMPT_FINISHED').length, 1, 'the delivered entry is owed no more');
      },
    ));
});

describe('T0-DIRTY-SUCCESS: the refusals before it keep their order and messages [R3]', () => {
  it('a mutant marker is refused first and nothing is probed [acceptance 3]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        c.git.status = ' M src/a.ts\n';
        const marker = mutantsMarkerPath(c.worktree, CARD);
        mkdirSync(path.dirname(marker), { recursive: true });
        writeFileSync(marker, '');
        refused(c, () => attempt(c), /a mutant run is in progress or was interrupted/);
        assert.equal(c.git.probes, 0);
      },
    ));

  it('lost checks on a success are refused with the message of main and nothing is probed [acceptance 3]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        c.git.status = ' M src/a.ts\n';
        refused(c, () => attempt(c, { ...SUCCESS, checksLost: ['t1'] }), /a successful attempt cannot report lost checks \(t1\)/);
        assert.equal(c.git.probes, 0);
      },
    ));

  it('a tdd success without a RED receipt is refused with the message of main and nothing is probed [acceptance 3]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        c.git.status = ' M src/a.ts\n';
        refused(c, () => attempt(c, { outcome: 'success', dodReceipt: 'dod:1' }), new RegExp(`a successful attempt on tdd card ${CARD} needs a RED receipt`));
        assert.equal(c.git.probes, 0);
      },
    ));

  it('a success after a recorded success is refused by the admission and nothing is probed [acceptance 3]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        attempt(c);
        const probes = c.git.probes;
        c.git.status = ' M src/a.ts\n';
        refused(c, () => attempt(c), /episode already succeeded/);
        assert.equal(c.git.probes, probes);
      },
    ));

  it('after card withdraw a dirty success gets the refusal of R1, and the withdrawn candidate on a clean worktree the withdrawn refusal [acceptance 3]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        attempt(c);
        c.runner.withdrawCandidate(c.g(), c.card, c.run(), 'the empty input is not covered');
        assert.equal(c.run().pendingRepair?.kind, 'withdrawn');
        next(c);
        c.git.status = ' M src/a.ts\n';
        refused(c, () => attempt(c), dirtyRefusal(c, ['src/a.ts'], false));
        c.git.status = '';
        refused(c, () => attempt(c), /is the withdrawn one/);
      },
    ));
});

describe('T0-DIRTY-SUCCESS: every case outside R1 is recorded as before [R4] [R5]', () => {
  for (const outcome of ['fail', 'not-counted'] as const) {
    it(`--outcome ${outcome} on a dirty worktree is recorded and probes nothing [acceptance 4]`, () =>
      withCtx(
        () => atBuild(),
        (c) => {
          c.git.status = ' M src/a.ts\n?? scratch.txt\n';
          const saved = attempt(c, outcome === 'fail' ? { outcome, cause: 'red' } : { outcome, notCountedReason: 'tool-outage' });
          assert.equal(saved.effort?.attempts.at(-1)?.outcome, outcome);
          assert.equal(saved.candidate, undefined);
          assert.equal(c.git.probes, 0);
        },
      ));
  }

  it('the dry-run ship path never reads the dirty status and binds --candidate-sha [acceptance 4]', () =>
    withCtx(
      () => atBuild('dry-run'),
      (c) => {
        c.git.status = ' M src/a.ts\n';
        const saved = attempt(c, { ...SUCCESS, candidateSha: 'sha-dry' });
        assert.equal(saved.effort?.terminal, 'succeeded');
        assert.deepEqual([saved.candidate?.sha, saved.candidate?.dirty], ['sha-dry', false]);
        assert.equal(c.git.probes, 0);
      },
    ));

  it('a run whose worktree is unset, and one whose worktree names nothing, bind --candidate-sha [acceptance 4]', async () => {
    for (const worktree of [undefined, 'missing'] as const) {
      await withCtx(
        () => atBuild(),
        (c) => {
          c.git.status = ' M src/a.ts\n';
          c.patch((run) => ({ ...run, worktree: worktree === undefined ? undefined : path.join(c.fx.tmp, 'nothing-here') }));
          const saved = attempt(c, { ...SUCCESS, candidateSha: 'sha-bound' });
          assert.equal(saved.effort?.terminal, 'succeeded');
          assert.deepEqual([saved.candidate?.sha, saved.candidate?.dirty], ['sha-bound', false]);
          assert.equal(c.git.probes, 0);
        },
      );
    }
  });

  it('a worktree path that is a file is probed, the probe fails and the success is recorded with no candidate [acceptance 4]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        rmSync(c.worktree, { recursive: true, force: true });
        writeFileSync(c.worktree, 'not a directory');
        c.git.status = ' M src/a.ts\n';
        c.git.exit = 128;
        const saved = attempt(c);
        assert.equal(c.git.probes, 1, 'the probe runs');
        assert.equal(saved.effort?.terminal, 'succeeded');
        assert.equal(saved.candidate, undefined);
      },
    ));

  for (const prior of ['absent', 'clean', 'dirty'] as const) {
    it(`a probe whose git status exits 128 keeps the ${prior} prior candidate and records the success [acceptance 4]`, () =>
      withCtx(
        () => atBuild(),
        (c) => {
          const kept = prior === 'absent' ? undefined : { sha: 'b'.repeat(40), dirty: prior === 'dirty', untracked: prior === 'dirty' ? ['scratch.txt'] : [], digest: `digest-${prior}` };
          c.patch((run) => ({ ...run, candidate: kept }));
          c.git.status = ' M src/a.ts\n';
          c.git.exit = 128;
          const saved = attempt(c);
          assert.equal(c.git.probes, 1, 'the probe runs');
          assert.equal(saved.effort?.terminal, 'succeeded');
          assert.deepEqual(saved.candidate, kept);
        },
      ));
  }

  it('a dirty success with a pending merge-conflict repair is refused and leaves the repair; a clean one records it and clears the repair [acceptance 4]', () =>
    withCtx(
      () => atBuild(),
      (c) => {
        const repair = { kind: 'merge-conflict' as const, detail: 'CHANGELOG.md conflicts with main', at: T };
        c.patch((run) => ({ ...run, pendingRepair: repair }));
        c.git.status = 'UU CHANGELOG.md\n';
        refused(c, () => attempt(c), dirtyRefusal(c, ['CHANGELOG.md'], false));
        assert.deepEqual(c.run().pendingRepair, repair);
        c.git.status = '';
        const saved = attempt(c);
        assert.equal(saved.effort?.terminal, 'succeeded');
        assert.equal(saved.pendingRepair, undefined);
        assert.equal(saved.candidate?.baseSync, true);
      },
    ));
});

describe('T0-DIRTY-SUCCESS: a run stored before the card with a dirty candidate [R7]', () => {
  it('gets build from card next, and review pre and review r3 refuse it as dirty [acceptance 5]', () =>
    withCtx(
      () => atBuild(),
      async (c) => {
        attempt(c);
        c.patch((run) => ({ ...run, candidate: { ...run.candidate!, dirty: true, untracked: ['scratch.txt'] } }));
        assert.equal(c.run().effort?.terminal, 'succeeded');
        assert.ok(c.run().dodReceipt);
        assert.equal(next(c).directive.kind, 'build');
        await assert.rejects(c.runner.preReview(c.g(), c.card, c.run()), /the candidate has uncommitted or untracked inputs \(scratch\.txt\)/);
        await assert.rejects(c.runner.formalReview(c.g(), c.card, c.run()), /the candidate has uncommitted or untracked inputs \(scratch\.txt\)/);
      },
    ));
});
