// Card T0-CANDIDATE-WITHDRAW (issue 128): a bound candidate no R3 decision has decided is withdrawn with a recorded finding,
// a counted failure on the effort ladder, so a defect found before R3 takes the ordinary repair path.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { makeStop } from '../../src/core/stop.ts';
import type { CardRun } from '../../src/core/types.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actorA, actorB, makeFixture, writeCard } from './_harness.ts';

const CARD = 'T0-CW';
const T = '2026-09-11T00:00:00.000Z';
const FINDING = 'the split at a lone ampersand drops a denial';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const REASON = '[spec] 6 tests missing @ src/t0-cw.ts: the empty input is not covered -> add a case for it';
const BLOCK = `${JSON.stringify({ verdict: 'block', reasons: [REASON], axes: { spec: { verdict: 'block', reasons: [REASON] }, standards: { verdict: 'pass', reasons: [] } } })}\n`;

const realAppend = fs.appendFileSync;
const realRename = fs.renameSync;
let failingEvent: string | undefined;
let failingRecord = false;

before(() => {
  (fs as unknown as Record<string, unknown>)['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    if (failingEvent && typeof args[1] === 'string' && args[1].includes(`"type":"${failingEvent}"`)) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return realAppend(...args);
  };
  (fs as unknown as Record<string, unknown>)['renameSync'] = (from: fs.PathLike, to: fs.PathLike) => {
    if (failingRecord && String(to).endsWith(`${CARD}.json`)) throw Object.assign(new Error('EIO: injected'), { code: 'EIO' });
    return realRename(from, to);
  };
  syncBuiltinESMExports();
});
after(() => {
  fs.appendFileSync = realAppend;
  fs.renameSync = realRename;
  syncBuiltinESMExports();
});

/** A card with R3, and with R2 when `onExhausted` is given, fed from answer queues. */
function setup(preReview?: { onExhausted: 'stop' | 'ship'; rounds: number }) {
  const fx = makeFixture({
    config: {
      gateRequired: true,
      ...(preReview ? { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', timeoutMs: 1000, shell: false, ...preReview } } : {}),
      formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false },
    },
  });
  const r2: string[] = [];
  const r3: string[] = [];
  let duringDiff: (() => void) | undefined;
  const script = scriptedRunner({
    'git diff --name-only': { stdout: 'src/t0-cw.ts\u0000' },
    'git diff': () => {
      const act = duringDiff;
      duringDiff = undefined;
      act?.();
      return { stdout: 'diff --git a/src/t0-cw.ts b/src/t0-cw.ts\n+export const cw = 1;\n' };
    },
    'fake-r2': () => ({ stdout: r2.shift() ?? PASS }),
    'fake-r3': () => ({ stdout: r3.shift() ?? PASS }),
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner: script });
  writeCard(fx, { id: CARD, title: 'candidate withdrawal', allowPaths: ['src/t0-cw.ts'] });
  const goal = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [] }, { cards: [CARD] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [CARD] } });
  const card = fx.card(CARD);
  const g = () => fx.goal(goal.id);
  const stored = () => fx.store.getCardRun(goal.id, CARD)!;
  const first = runner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  /** Record `sha` as a successful attempt. */
  const bind = (sha: string, input: { progress?: boolean; evidence?: string } = {}): CardRun => runner.recordAttempt(g(), card, stored(), { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha, ...input });
  const withdraw = (cause = FINDING): CardRun => runner.withdrawCandidate(g(), card, stored(), cause);
  const next = () => runner.next(g(), card, stored());
  const patch = (change: (run: CardRun) => CardRun): CardRun => fx.store.updateCardRun(goal.id, CARD, (run) => change(run!));
  const attemptsFinished = () => fx.events(goal.id).filter((e) => e.type === 'ATTEMPT_FINISHED' && e.data['refutedBy'] === 'withdrawn');
  return { fx, runner, card, g, goalId: goal.id, first, stored, bind, withdraw, next, patch, attemptsFinished, r2, r3, onDiff: (act: () => void) => (duringDiff = act) };
}
type Setup = ReturnType<typeof setup>;

/** Run `body` on a fresh card and always release the fixture and the acting session. */
async function withCard(body: (s: Setup) => void | Promise<void>, preReview?: { onExhausted: 'stop' | 'ship'; rounds: number }): Promise<void> {
  const s = setup(preReview);
  try {
    await body(s);
  } finally {
    setActorForTests(actorA);
    s.fx.cleanup();
  }
}

/** `act` throws `expected`, and the stored run and the journal stay as they were. */
function refused(s: Setup, act: () => unknown, expected: RegExp): void {
  const run = JSON.stringify(s.stored());
  const events = s.fx.events(s.goalId).length;
  assert.throws(act, expected);
  assert.equal(JSON.stringify(s.stored()), run, 'the stored run is unchanged');
  assert.equal(s.fx.events(s.goalId).length, events, 'the journal is unchanged');
}

test('T0-CANDIDATE-WITHDRAW acceptance 1: a candidate no review has read is withdrawn, the success that bound it counted as a failure with the finding as its cause [R1]', () =>
  withCard((s) => {
    const bound = s.bind('sha-a', { evidence: 'npm test: 42 pass' });
    assert.equal(bound.effort?.terminal, 'succeeded');
    assert.equal(s.next().run.state, 'SHIP', 'the withdrawal starts from the ship gate');
    const digest = bound.candidate?.digest;
    s.patch((current) => ({ ...current, blockedReceipt: { dodReceipt: 'dod:kept', candidateDigest: digest!, stage: 'pre', cycle: 0, round: 1 } }));
    const run = s.withdraw();
    const attempt = run.effort!.attempts.at(-1)!;
    assert.deepEqual([attempt.outcome, attempt.cause], ['fail', `withdrawn: ${FINDING}`]);
    assert.equal(attempt.evidence, `npm test: 42 pass; withdrawn: ${FINDING}`, 'the DoD text stays, with the finding after it');
    assert.equal(run.effort?.terminal, undefined);
    assert.equal(run.dodReceipt, undefined);
    assert.equal(run.blockedReceipt, undefined);
    assert.equal(run.state, 'BUILD');
    assert.deepEqual([run.pendingRepair?.kind, run.pendingRepair?.detail, run.pendingRepair?.candidateDigest], ['withdrawn', FINDING, digest]);
    const finished = s.attemptsFinished();
    assert.equal(finished.length, 1);
    assert.deepEqual([finished[0]?.data['n'], finished[0]?.data['outcome'], finished[0]?.data['cause']], [attempt.n, 'fail', `withdrawn: ${FINDING}`]);
    assert.equal(finished[0]?.data['completed'], undefined, 'the command journaled its own commit');
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 2: card next after a withdrawal opens the repair with the finding in its narration, and no R3 decision is spent [R2]', () =>
  withCard((s) => {
    s.bind('sha-a');
    s.withdraw();
    const { run, directive } = s.next();
    assert.equal(directive.kind, 'build', directive.narration);
    assert.ok(directive.narration.includes(FINDING), directive.narration);
    if (directive.kind === 'build') assert.equal(directive.attempt, 2);
    assert.equal(run.effort?.attempts.at(-1)?.outcome, 'running');
    assert.equal(run.review.substantiveDecisions, 0);
  }));

/** The rows of acceptance 3 that need one stored field or record: each arranges a bound candidate, then the refusal. */
const REFUSALS: Array<{ name: string; arrange: (s: Setup) => void; expected: RegExp }> = [
  { name: 'a stopped run', arrange: (s) => void s.patch((run) => ({ ...run, state: 'STOP', stop: makeStop('review', 'held', 'ask', { at: T, global: false }) })), expected: /stopped/ },
  { name: 'a merged run', arrange: (s) => void s.patch((run) => ({ ...run, mergeVerified: true })), expected: /merged/ },
  { name: 'a card deadline that has passed', arrange: (s) => void s.patch((run) => ({ ...run, deadline: '2026-09-10T00:00:00.000Z' })), expected: /deadline/ },
  { name: 'a run with no candidate', arrange: (s) => void s.patch((run) => ({ ...run, candidate: undefined })), expected: /no candidate/ },
  { name: 'a pending repair', arrange: (s) => void s.patch((run) => ({ ...run, pendingRepair: { kind: 'red-missing', detail: 'rejected', at: T } })), expected: /red-missing/ },
  {
    name: 'an R3 decision in flight',
    arrange: (s) => void s.patch((run) => ({ ...run, review: { ...run.review, invocations: [{ invocationId: 'r3:x', candidateDigest: run.candidate!.digest, base: 'main', policyVersion: 'v', reviewer: 'fake-r3', requestedAt: T, outcome: 'pending' }] } })),
    expected: /formal review of this card is in flight/,
  },
  {
    name: 'an R2 round in flight',
    arrange: (s) => void s.patch((run) => ({ ...run, preReview: { ...run.preReview, rounds: [{ round: 1, cycle: 0, reviewer: 'fake-r2', candidateDigest: run.candidate!.digest, requestedAt: T, durationMs: 0, outcome: 'pending', reasons: [], advisory: [] }] } })),
    expected: /pre-review round of this card is in flight/,
  },
  {
    name: 'an unresolved operation',
    arrange: (s) => void s.fx.ops.recordIntent({ kind: 'merge', goalId: s.goalId, cardId: CARD, target: 'main', candidateDigest: s.stored().candidate!.digest, ownerGeneration: 0, timeoutMs: 60_000, effects: ['merge'] }, T),
    expected: /unresolved/,
  },
];

for (const row of REFUSALS) {
  test(`T0-CANDIDATE-WITHDRAW acceptance 3: ${row.name} refuses a withdrawal with nothing written [R3]`, () =>
    withCard((s) => {
      s.bind('sha-a');
      row.arrange(s);
      refused(s, () => s.withdraw(), row.expected);
    }));
}

test('T0-CANDIDATE-WITHDRAW acceptance 3: an empty cause, an open episode and a terminal goal refuse with nothing written [R3]', () =>
  withCard((s) => {
    refused(s, () => s.withdraw(), /no candidate|open/);
    s.bind('sha-a');
    refused(s, () => s.withdraw('   '), /--cause/);
    s.fx.store.saveGoal({ ...s.g(), state: 'STOP', terminal: true });
    refused(s, () => s.withdraw(), /terminal/);
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 3: a lease held by another session refuses a withdrawal with nothing written [R3]', () =>
  withCard((s) => {
    s.bind('sha-a');
    setActorForTests(actorB);
    refused(s, () => s.withdraw(), /lease|owner|fence|generation/i);
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 3: an R3 pass on the bound candidate refuses a withdrawal [R3]', () =>
  withCard(async (s) => {
    s.bind('sha-a');
    await s.runner.formalReview(s.g(), s.card, s.stored());
    refused(s, () => s.withdraw(), /R3 decided/);
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 3: an R3 block on the bound candidate refuses a withdrawal once a dispute has settled the repair [R3]', () =>
  withCard(async (s) => {
    s.bind('sha-a');
    s.r3.push(BLOCK);
    await s.runner.formalReview(s.g(), s.card, s.stored());
    s.next();
    s.runner.disputeFinding(s.g(), s.card, s.stored(), 'F1', 'tests/t0-cw.test.ts covers the empty input');
    s.next();
    assert.equal(s.stored().effort?.terminal, 'succeeded', 'the dispute settled the repair, so the success stands');
    refused(s, () => s.withdraw(), /R3 decided/);
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 3: a third baseline failure with no progress refuses a withdrawal, and the candidate stays bound [R3]', () =>
  withCard((s) => {
    s.runner.recordAttempt(s.g(), s.card, s.stored(), { outcome: 'fail', cause: 'first cause' });
    s.runner.recordAttempt(s.g(), s.card, s.stored(), { outcome: 'fail', cause: 'second cause' });
    s.bind('sha-a');
    refused(s, () => s.withdraw(), /ladder/);
    assert.equal(s.stored().effort?.terminal, 'succeeded');
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 3: a second withdrawal with the same cause and no progress refuses [R3]', () =>
  withCard((s) => {
    s.bind('sha-a');
    s.withdraw();
    s.next();
    s.bind('sha-b');
    refused(s, () => s.withdraw(), /same-cause-stop/);
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 4: a repaired candidate no decision has read is withdrawable after an R3 block on the one before it [R3]', () =>
  withCard(async (s) => {
    s.bind('sha-a');
    s.r3.push(BLOCK);
    await s.runner.formalReview(s.g(), s.card, s.stored());
    s.next();
    s.bind('sha-b');
    const run = s.withdraw();
    assert.equal(run.pendingRepair?.kind, 'withdrawn');
    assert.equal(run.review.substantiveDecisions, 1, 'the decision on the blocked candidate stays counted');
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 4: an R3 run with no verdict decided nothing, so the candidate stays withdrawable [R3]', () =>
  withCard(async (s) => {
    s.bind('sha-a');
    s.r3.push('not a verdict\n');
    await s.runner.formalReview(s.g(), s.card, s.stored());
    assert.equal(s.stored().review.invocations.at(-1)?.outcome, 'no-verdict');
    assert.equal(s.withdraw().pendingRepair?.kind, 'withdrawn');
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 5: the withdrawn candidate cannot be bound again, and a failed attempt on it is recorded [R4]', () =>
  withCard((s) => {
    s.bind('sha-a');
    s.withdraw();
    s.next();
    refused(s, () => s.bind('sha-a'), /withdrawn/);
    assert.equal(s.stored().effort?.attempts.at(-1)?.outcome, 'running');
    const failed = s.runner.recordAttempt(s.g(), s.card, s.stored(), { outcome: 'fail', cause: 'still red' });
    assert.equal(failed.effort?.attempts.at(-1)?.outcome, 'fail');
    assert.equal(failed.pendingRepair?.kind, 'withdrawn');
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 6: no R2 round and no R3 decision runs on a withdrawn candidate [R5]', () =>
  withCard(
    async (s) => {
      s.bind('sha-a');
      s.withdraw();
      await assert.rejects(() => s.runner.preReview(s.g(), s.card, s.stored()), /withdrawn/);
      await assert.rejects(() => s.runner.formalReview(s.g(), s.card, s.stored()), /withdrawn/);
      assert.equal(s.stored().preReview.rounds.length, 0);
      assert.equal(s.stored().review.invocations.length, 0);
    },
    { onExhausted: 'stop', rounds: 3 },
  ));

test('T0-CANDIDATE-WITHDRAW acceptance 6: a withdrawal landing while a review collects its diff refuses that dispatch at its reservation [R5]', () =>
  withCard(async (s) => {
    s.bind('sha-a');
    s.onDiff(() => s.withdraw());
    await assert.rejects(() => s.runner.formalReview(s.g(), s.card, s.stored()), /withdrawn/);
    assert.equal(s.stored().pendingRepair?.kind, 'withdrawn');
    assert.equal(s.stored().review.invocations.length, 0);
    assert.deepEqual(s.fx.queue.list().filter((r) => r.state === 'running'), [], 'the refused dispatch holds no active slot');
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 7: the repaired candidate needs its own R2 pass and its own R3 decision, though R2 passed the withdrawn one [R6]', () =>
  withCard(
    async (s) => {
      s.bind('sha-a');
      assert.equal(s.next().directive.kind, 'pre-review');
      await s.runner.preReview(s.g(), s.card, s.stored());
      assert.equal(s.next().directive.kind, 'review');
      s.withdraw();
      assert.equal(s.next().directive.kind, 'build');
      const rebound = s.bind('sha-b');
      assert.equal(rebound.candidate?.sha, 'sha-b');
      assert.equal(rebound.pendingRepair, undefined);
      assert.equal(s.next().directive.kind, 'pre-review');
      await s.runner.preReview(s.g(), s.card, s.stored());
      assert.equal(s.next().directive.kind, 'review');
    },
    { onExhausted: 'stop', rounds: 3 },
  ));

test('T0-CANDIDATE-WITHDRAW acceptance 7: R2 rounds spent under onExhausted ship leave the episode open, so the withdrawal refuses and a new attempt binds the repair [R3] [R6]', () =>
  withCard(
    async (s) => {
      s.bind('sha-a');
      assert.equal(s.next().directive.kind, 'pre-review');
      s.r2.push(BLOCK);
      await s.runner.preReview(s.g(), s.card, s.stored());
      assert.equal(s.next().directive.kind, 'review', 'the residual findings go to R3');
      refused(s, () => s.withdraw(), /open/);
      assert.equal(s.bind('sha-b').candidate?.sha, 'sha-b');
    },
    { onExhausted: 'ship', rounds: 1 },
  ));

test('T0-CANDIDATE-WITHDRAW acceptance 7: the repair of a withdrawn base-sync candidate is still a base-sync candidate [R6]', () =>
  withCard((s) => {
    s.bind('sha-a');
    s.patch((run) => ({ ...run, candidate: { ...run.candidate!, baseSync: true } }));
    s.withdraw();
    s.next();
    assert.equal(s.bind('sha-b').candidate?.baseSync, true);
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 8: a lost ATTEMPT_FINISHED append keeps the withdrawal, and the next card next journals it once [R7]', () =>
  withCard((s) => {
    s.bind('sha-a');
    failingEvent = 'ATTEMPT_FINISHED';
    try {
      assert.throws(() => s.withdraw(), /EIO/);
    } finally {
      failingEvent = undefined;
    }
    assert.equal(s.stored().pendingRepair?.kind, 'withdrawn', 'the withdrawal is saved');
    assert.equal(s.stored().journalOwed?.length, 1, 'the event is owed');
    assert.equal(s.attemptsFinished().length, 0);
    s.next();
    const finished = s.attemptsFinished();
    assert.equal(finished.length, 1);
    assert.equal(finished[0]?.data['completed'], true);
    s.next();
    assert.equal(s.attemptsFinished().length, 1, 'a second card next adds none');
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 8: a refused withdrawal writes nothing with an event owed, and the next card next delivers it [R3] [R7]', () =>
  withCard((s) => {
    s.bind('sha-a');
    failingEvent = 'ATTEMPT_FINISHED';
    try {
      assert.throws(() => s.withdraw(), /EIO/);
    } finally {
      failingEvent = undefined;
    }
    refused(s, () => s.withdraw(), /open/);
    refused(s, () => s.withdraw('   '), /--cause/);
    assert.equal(s.attemptsFinished().length, 0, 'the refusals delivered nothing');
    s.next();
    assert.equal(s.attemptsFinished().length, 1);
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 9: a failed record write leaves the run and the journal as they were, and a retry withdraws [R1]', () =>
  withCard((s) => {
    s.bind('sha-a');
    failingRecord = true;
    try {
      refused(s, () => s.withdraw(), /EIO/);
    } finally {
      failingRecord = false;
    }
    assert.equal(s.stored().effort?.terminal, 'succeeded');
    assert.equal(s.withdraw().pendingRepair?.kind, 'withdrawn');
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 10: card attempt on a succeeded episode names card withdraw [R8]', () =>
  withCard((s) => {
    s.bind('sha-a');
    assert.throws(() => s.bind('sha-b'), (err: Error) => err.message.includes('episode already succeeded') && err.message.includes(`aidlc card withdraw ${CARD}`));
  }));

test('T0-CANDIDATE-WITHDRAW acceptance 11: the CLI withdraws a bound candidate and requires a cause [R1]', () => {
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'aidlc.js');
  const tmp = mkdtempSync(path.join(tmpdir(), 'aidlc-withdraw-cli-'));
  try {
    mkdirSync(path.join(tmp, 'specs', 'tasks'), { recursive: true });
    writeFileSync(path.join(tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'dry-run', cardsDir: 'specs/tasks', worktreeRoot: path.join(tmp, 'wt') }));
    const fx = makeFixture();
    try {
      writeCard(fx, { id: CARD, title: 'candidate withdrawal', allowPaths: ['src/t0-cw.ts'] });
      fs.copyFileSync(path.join(fx.cardsDir, `${CARD}.md`), path.join(tmp, 'specs', 'tasks', `${CARD}.md`));
    } finally {
      fx.cleanup();
    }
    const env = { ...process.env, AIDLC_STATE_DIR: path.join(tmp, 'state') };
    const raw = (...args: string[]) => spawnSync(process.execPath, [bin, ...args, '--json'], { cwd: tmp, env, encoding: 'utf8', timeout: 60_000 });
    const cli = (...args: string[]) => {
      const r = raw(...args);
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}\n${r.stdout}`);
      return JSON.parse(r.stdout) as Record<string, any>;
    };
    const created = cli('goal', 'new', `implement ${CARD}`, '--card', CARD);
    const goal = typeof created['goal'] === 'string' ? (created['goal'] as string) : (created['goal']?.id as string);
    cli('report', '--goal', goal, '--result', 'cards-projected', '--cards', CARD);
    const unstarted = raw('card', 'withdraw', CARD, '--goal', goal, '--cause', FINDING);
    assert.notEqual(unstarted.status, 0);
    assert.match(unstarted.stderr, /no run/);
    assert.equal(existsSync(path.join(tmp, 'state', 'cards', goal, `${CARD}.json`)), false, 'no run was created, so no deadline started');
    const journal = path.join(tmp, 'state', 'journal');
    assert.ok(!readdirSync(journal).some((name) => readFileSync(path.join(journal, name), 'utf8').includes('CARD_DISPATCHED')), 'no card was dispatched');
    assert.equal(cli('card', 'next', CARD, '--goal', goal)['directive']['kind'], 'prepare');
    assert.equal(cli('card', 'next', CARD, '--goal', goal)['directive']['kind'], 'build');
    cli('card', 'attempt', CARD, '--goal', goal, '--outcome', 'success', '--dod-receipt', 'dod:cli', '--red-receipt', 'red:1', '--candidate-sha', 'sha-cli');
    const missing = raw('card', 'withdraw', CARD, '--goal', goal);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /--cause/);
    const withdrawn = cli('card', 'withdraw', CARD, '--goal', goal, '--cause', FINDING);
    assert.equal(withdrawn['pendingRepair']['detail'], FINDING);
    assert.equal(cli('card', 'next', CARD, '--goal', goal)['directive']['kind'], 'build');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
