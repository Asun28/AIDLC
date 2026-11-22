// Card T1-CONTINUE-REVIEW: `CardRunner.continueStop` lifts a review stop on the same card in one locked update, and every rule that reads the review allowance reads the count the continuation admits.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs, { readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, InjectedShipPath } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FILE = 'src/t1-cc.ts';
const BY = { by: 'the owner', reason: 'one more repair round' };
const R3 = { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false };
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const CODE_DEFECT = '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/777 ... AssertionError: expected 2 to equal 3';
const block = (texts: string[]): string => {
  const reasons = texts.map((text, i) => `[spec] 6 tests @ ${FILE}:${i + 1}: ${text}`);
  return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';
};
/** Four blocks, each with a new finding: the fourth stops the run on the 4-decision allowance. */
const FOUR = ['no RED', 'no boundary row', 'no error row', 'no fault row'].map((t) => block([`${t} -> add one`]));
/** Decision 2 re-raises the disputed F1 and stops the run. */
const RERAISE = [block(['no RED -> add one']), block(['still no RED (re:F1) -> add one'])];

/** The faults of tests/scenarios/fault-points.test.ts: a throw from fs.renameSync onto the card-run record, and from fs.appendFileSync onto a CARD_STATE line. */
const fault = { record: false, append: false };
const real = { append: fs.appendFileSync, rename: fs.renameSync };
const eio = () => Object.assign(new Error('EIO: injected'), { code: 'EIO' });
before(() => {
  (fs as unknown as Stored)['appendFileSync'] = (...args: Parameters<typeof fs.appendFileSync>) => {
    if (fault.append && typeof args[1] === 'string' && args[1].includes('"type":"CARD_STATE"')) throw eio();
    return real.append(...args);
  };
  (fs as unknown as Stored)['renameSync'] = (from: fs.PathLike, to: fs.PathLike) => {
    if (fault.record && String(to).endsWith('T1-CC.json')) throw eio();
    return real.rename(from, to);
  };
  syncBuiltinESMExports();
});
after(() => {
  Object.assign(fs, { appendFileSync: real.append, renameSync: real.rename });
  syncBuiltinESMExports();
});

/** A card run driven through R3 decisions by a scripted command reviewer that answers with `verdicts` in order. */
function drive(fx: ReturnType<typeof makeFixture>, verdicts: string[], ship = new InjectedShipPath(['merged'], '')) {
  const script = scriptedRunner({
    'git diff --name-only': { stdout: `${FILE}\u0000` },
    'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` },
    'fake-r3': () => ({ stdout: verdicts.shift()! }),
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, { id: 'T1-CC', title: 'card continue', allowPaths: [FILE] });
  const goal = goalForCards(fx, ['T1-CC']);
  const card = fx.card('T1-CC');
  const g = () => fx.goal(goal.id);
  const persisted = () => fx.store.getCardRun(goal.id, 'T1-CC')!;
  runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T1-CC'));
  const next = () => runner.next(g(), card, persisted()).directive as Stored;
  const attempt = (sha: string) => runner.recordAttempt(g(), card, persisted(), { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha });
  const review = async () => runner.formalReview(g(), card, persisted());
  /** A success with candidate `sha`, its review directive, and the decision; returns the next directive. */
  const cycle = async (sha: string, dispute?: string) => {
    attempt(sha);
    const d = next();
    assert.equal(d['kind'], 'review', d['narration']);
    if (dispute) runner.disputeFinding(g(), card, persisted(), dispute, 'the row exists');
    await review();
    return next();
  };
  const runFile = fx.store.cardFile(goal.id, 'T1-CC');
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const stored = (): Stored => JSON.parse(readFileSync(runFile, 'utf8'));
  const seed = (change: (run: Stored) => void) => { const run = stored(); change(run); writeFileSync(runFile, JSON.stringify(run, null, 2), 'utf8'); };
  const bytes = () => [fs.existsSync(runFile) ? readFileSync(runFile, 'utf8') : '', readFileSync(journalFile, 'utf8')];
  const readmitted = () => readFileSync(journalFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e['type'] === 'CARD_STATE' && e['data'].to === 'readmitted');
  const go = (act: { decisions?: number } = {}, c = card) => runner.continueStop(g(), c, { ...BY, ...act });
  /** A newer candidate behind a recorded stop (card T1-EFF-R3-PROGRESS-2): the admission refuses its review. */
  const further = (sha: string) => seed((run) => { run['state'] = 'REVIEW_FIX'; delete run['stop']; run['candidate'] = { ...run['candidate'], sha, digest: sha }; });
  return { ship, card, persisted, next, attempt, review, cycle, stored, seed, bytes, readmitted, go, further };
}

/** Each field R2 keeps. */
const kept = ({ review: r, ...run }: Stored) => ({ counters: [r.substantiveDecisions, r.substantiveBlocks, r.noVerdictRetriesUsed, r.scriptCounter], outcomes: r.invocations.map((i: Stored) => i.outcome), ...['findings', 'effort', 'ci', 'candidate', 'dodReceipt', 'redReceipt', 'blockedReceipt', 'deadline'].map((k) => run[k]) });

test('acceptance 1, 2, 3 and 6: a run stopped on R3 decision 4 is continued with one decision, keeps every R2 field, owes one CARD_STATE event, takes decision 5 of 5, and a pass ships with no second pass while a block stops it [R1] [R2] [R3] [R4] [R5]', async () => {
  for (const fifth of [PASS, block(['no doc row -> add one'])]) {
    const fx = makeFixture({ config: { gateRequired: true, formalReview: { ...R3, secondPass: true } } });
    try {
      const d = drive(fx, [...FOUR, fifth]);
      for (const n of [1, 2, 3, 4]) await d.cycle(`sha-${n}`);
      const was = d.stored();
      assert.deepEqual([was['state'], was['stop']?.reason], ['STOP', 'review']);
      d.go();
      const now = d.stored();
      const stopping = was['review'].invocations.findIndex((i: Stored) => i.stopReview);
      const continuation = { by: BY.by, reason: BY.reason, stop: 'review', decisions: 1, admits: 5 };
      assert.deepEqual([now['state'], 'stop' in now, 'blocker' in now, now['continuations'].length, now['continuations'][0].admits, now['review'].invocations[stopping].stopLifted?.by], ['BUILD', false, false, 1, 5, BY.by]);
      assert.deepEqual(kept(now), kept(was));
      assert.deepEqual(d.readmitted().map((e) => [e['cardId'], e['data'].from, e['data'].continuation]), [['T1-CC', 'STOP', continuation]]);
      // The repaired candidate takes the decision the continuation admits; the run is in REVIEW_FIX on every call until then.
      for (const call of [1, 2]) assert.deepEqual([d.next()['kind'], d.persisted().state, d.next()['remainingDecisions']], ['review-fix', 'REVIEW_FIX', 1], `call ${call}`);
      d.attempt('sha-5');
      assert.deepEqual([d.next()['kind'], d.next()['decision'], d.next()['maxDecisions']], ['review', 5, 5]);
      await d.review();
      const last = d.next();
      if (fifth === PASS) {
        assert.deepEqual([last['kind'], d.ship.requests.map((q) => q.candidateSha), d.persisted().review.invocations.some((i) => i.secondPass)], ['close', ['sha-5'], false], last['narration']);
        continue;
      }
      assert.deepEqual([last['kind'], d.persisted().stop?.reason], ['stop', 'review']);
      assert.match(d.persisted().stop!.detail, /continuation.*\b5\b/);
      d.further('sha-6');
      await assert.rejects(d.review(), /continuation/);
    } finally {
      fx.cleanup();
    }
  }
});

test('acceptance 4: a run stopped on decision 2 by a re-raise and continued with one decision is admitted decision 3 and no more: a block stops it and decision 4 is refused, a pass ships with no second pass and no further decision [R4] [R5]', async () => {
  for (const third of [PASS, block(['no doc row -> add one'])]) {
    const fx = makeFixture({ config: { gateRequired: true, formalReview: { ...R3, secondPass: true } } });
    try {
      const d = drive(fx, [...RERAISE, third]);
      await d.cycle('sha-1');
      const stop = await d.cycle('sha-2', 'F1');
      assert.deepEqual([stop['kind'], d.persisted().stop?.reason, d.persisted().review.substantiveDecisions], ['stop', 'review', 2]);
      d.go({ decisions: 1 });
      if (d.next()['kind'] === 'review-fix') d.attempt('sha-3');
      assert.deepEqual([d.next()['kind'], d.next()['decision'], d.next()['maxDecisions']], ['review', 3, 3]);
      await d.review();
      if (third === PASS) {
        await assert.rejects(d.review(), /continuation's admitted count of 3 decisions is used/);
        assert.deepEqual([d.next()['kind'], d.persisted().review.invocations.some((i) => i.secondPass)], ['close', false]);
        continue;
      }
      assert.deepEqual([d.next()['kind'], d.persisted().stop?.reason], ['stop', 'review']);
      assert.match(d.persisted().stop!.detail, /continuation.*\b3\b/);
      d.further('sha-4');
      await assert.rejects(d.review(), /continuation/);
    } finally {
      fx.cleanup();
    }
  }
});

test('acceptance 5: a run the gate stopped with no decision left is continued and gets decision 3 of 3; after a further CI code defect the gate stop names the continuation [R4] [R5]', async () => {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: R3 } });
  try {
    const d = drive(fx, [block(['no RED -> add one']), PASS, PASS], new InjectedShipPath(['ci-red', 'ci-red'], CODE_DEFECT));
    await d.cycle('sha-1');
    assert.equal((await d.cycle('sha-2'))['kind'], 'build');
    d.attempt('sha-3');
    assert.deepEqual([d.next()['kind'], d.persisted().stop?.reason], ['stop', 'review']);
    d.go();
    assert.deepEqual([d.next()['kind'], d.next()['decision'], d.next()['maxDecisions']], ['review', 3, 3]);
    await d.review();
    assert.equal(d.next()['kind'], 'build');
    d.attempt('sha-4');
    const stop = d.next();
    assert.equal(stop['kind'], 'stop');
    assert.match(stop['stop'].detail, /exceeds the continuation's admitted count of 3 decisions \(3 used\)/);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 6, fault rows: a failed card-run write changes no byte; a failed CARD_STATE append keeps the continuation and the next card next appends the event once [R3]', async () => {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: R3 } });
  try {
    const d = drive(fx, [...RERAISE]);
    await d.cycle('sha-1');
    await d.cycle('sha-2', 'F1');
    const held = d.bytes();
    for (const on of [{ record: true }, { append: true }]) {
      Object.assign(fault, on);
      try {
        assert.throws(() => d.go(), /EIO: injected/);
      } finally {
        Object.assign(fault, { record: false, append: false });
      }
      if (on.record) assert.deepEqual(d.bytes(), held, 'the card-run file and the journal are byte-identical');
    }
    assert.deepEqual([d.stored()['continuations'].length, d.readmitted().length], [1, 0]);
    d.next();
    d.next();
    assert.deepEqual(d.readmitted().map((e) => [e['data'].continuation.admits, e['data'].completed]), [[3, true]]);
  } finally {
    fx.cleanup();
  }
});

test('acceptance 7: a run in BUILD, a run stopped for ci and a card with no run each throw with their cause and write nothing [R6]', async () => {
  const rows: Array<[string, (run: Stored) => void, RegExp]> = [
    ['BUILD', (run) => { run['state'] = 'BUILD'; delete run['stop']; }, /is in BUILD, not in STOP/],
    ['ci', (run) => { run['stop'].reason = 'ci'; }, /stop reason ci is not review/],
    ['no run', () => {}, /T1-NONE has no card run/],
  ];
  for (const [name, change, cause] of rows) {
    const fx = makeFixture({ config: { gateRequired: true, formalReview: R3 } });
    try {
      const d = drive(fx, [...RERAISE]);
      await d.cycle('sha-1');
      await d.cycle('sha-2', 'F1');
      d.seed(change);
      const held = d.bytes();
      assert.throws(() => d.go({}, name === 'no run' ? { ...d.card, id: 'T1-NONE' } : d.card), cause, name);
      assert.deepEqual(d.bytes(), held, name);
    } finally {
      fx.cleanup();
    }
  }
});
