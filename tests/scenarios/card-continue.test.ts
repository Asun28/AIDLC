// Card T1-CONTINUE-REVIEW-2: `CardRunner.continueStop` lifts a review stop on the same card in one locked update, and every rule that reads the review allowance reads the count the continuation admits.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, InjectedShipPath } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const FILE = 'src/t1-cc.ts';
const BY = { by: 'the owner', reason: 'one more repair round' };
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const CODE_DEFECT = '[CI-GATE-RED] job failed: https://github.com/o/r/actions/runs/777 ... AssertionError: expected 2 to equal 3';
const block = (text: string, reasons = [`[spec] 6 tests @ ${FILE}:1: ${text} -> add one`]): string => JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';
const FOUR = ['no RED', 'no boundary row', 'no error row', 'no fault row'].map((t) => block(t)); // each a new finding: the fourth stops the run
const RERAISE = [block('no RED'), block('still no RED (re:F1)')]; // decision 2 re-raises the disputed F1 and stops the run

/** The faults of tests/scenarios/fault-points.test.ts: a throw from fs.renameSync onto the card-run record, and from fs.appendFileSync onto a CARD_STATE line. */
const fault = { record: false, append: false };
const real = { appendFileSync: fs.appendFileSync, renameSync: fs.renameSync };
const eio = () => Object.assign(new Error('EIO: injected'), { code: 'EIO' });
before(() => {
  Object.assign(fs, {
    appendFileSync: (...a: Parameters<typeof fs.appendFileSync>) => { if (fault.append && String(a[1]).includes('"type":"CARD_STATE"')) throw eio(); return real.appendFileSync(...a); },
    renameSync: (from: fs.PathLike, to: fs.PathLike) => { if (fault.record && String(to).endsWith('T1-CC.json')) throw eio(); return real.renameSync(from, to); },
  });
  syncBuiltinESMExports();
});
after(() => { Object.assign(fs, real); syncBuiltinESMExports(); });

/** A card run under a command reviewer that answers with `verdicts` in order, and the moves of the loop on it; `body` runs on a fresh fixture. */
async function scenario(verdicts: string[], body: (d: ReturnType<typeof drive>, config: Stored) => Promise<void>, opts: { secondPass?: boolean; ship?: InjectedShipPath } = {}) {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: opts.secondPass ?? false } } });
  try {
    await body(drive(fx, verdicts, opts.ship ?? new InjectedShipPath(['merged'], '')), fx.config);
  } finally {
    Object.assign(fault, { record: false, append: false });
    fx.cleanup();
  }
}
function drive(fx: ReturnType<typeof makeFixture>, verdicts: string[], ship: InjectedShipPath) {
  const script = scriptedRunner({ 'git diff --name-only': { stdout: `${FILE}\u0000` }, 'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` }, 'fake-r3': () => ({ stdout: verdicts.shift()! }) });
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
    assert.equal(next()['kind'], 'review');
    if (dispute) runner.disputeFinding(g(), card, persisted(), dispute, 'the row exists');
    return review().then(next);
  };
  const runFile = fx.store.cardFile(goal.id, 'T1-CC');
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const stored = (): Stored => JSON.parse(readFileSync(runFile, 'utf8'));
  const seed = (change: (run: Stored) => void) => { const run = stored(); change(run); writeFileSync(runFile, JSON.stringify(run, null, 2), 'utf8'); };
  return {
    ship, card, persisted, next, attempt, review, cycle, stored, seed,
    bytes: () => [existsSync(runFile) ? readFileSync(runFile, 'utf8') : '', readFileSync(journalFile, 'utf8')],
    readmitted: () => readFileSync(journalFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e['type'] === 'CARD_STATE' && e['data'].to === 'readmitted'),
    go: (act: { decisions?: number } = {}, c = card) => runner.continueStop(g(), c, { ...BY, ...act }),
    /** The stop on decision 2 by the re-raise of the disputed F1. */
    reraised: async () => { await cycle('sha-1'); await cycle('sha-2', 'F1'); assert.equal(persisted().stop?.reason, 'review'); },
    /** A newer candidate behind a recorded stop (card T1-EFF-R3-PROGRESS-2): the admission refuses its review. */
    further: (sha: string) => seed((run) => { run['state'] = 'REVIEW_FIX'; delete run['stop']; run['candidate'] = { ...run['candidate'], sha, digest: sha }; }),
  };
}

/** Each field R2 keeps. */
const kept = ({ review: r, ...run }: Stored) => [r.substantiveDecisions, r.substantiveBlocks, r.noVerdictRetriesUsed, r.scriptCounter, r.invocations.map((i: Stored) => i.outcome), ...['findings', 'effort', 'ci', 'candidate', 'dodReceipt', 'redReceipt', 'blockedReceipt', 'deadline'].map((k) => run[k])];
const left = (n: number) => new RegExp(`ships with ${n} substantive decision\\(s\\) left`);

test('acceptance 1, 2, 3 and 6: a run stopped on R3 decision 4 is continued, keeps every R2 field, owes one CARD_STATE event and takes decision 5 of the admitted count: at 5 of 5 a pass ships with no second pass and a block stops it, at 5 of 8 a pass gets the second pass [R1] [R2] [R3] [R4] [R5]', async () => {
  for (const [fifth, decisions] of [[PASS, 1], [block('no doc row'), 1], [PASS, 4]] as const) {
    const admits = 4 + decisions;
    await scenario([...FOUR, fifth], async (d) => {
      for (const n of [1, 2, 3, 4]) await d.cycle(`sha-${n}`);
      const was = d.stored();
      const stopping = was['review'].invocations.findIndex((i: Stored) => i.stopReview);
      d.go(decisions === 1 ? {} : { decisions });
      const now = d.stored();
      assert.deepEqual([was['state'], now['state'], 'stop' in now, 'blocker' in now, now['continuations'].length, now['review'].invocations[stopping].stopLifted?.by], ['STOP', 'BUILD', false, false, 1, BY.by]);
      assert.deepEqual(kept(now), kept(was));
      assert.deepEqual(d.readmitted().map((e) => [e['cardId'], e['data'].from, e['data'].continuation]), [['T1-CC', 'STOP', { ...BY, stop: 'review', decisions, admits }]]);
      // The run is in REVIEW_FIX on every call until the repair; the repair directive (kind build) names the decisions left.
      for (const _ of [1, 2]) assert.match(d.next()['narration'], left(decisions));
      assert.equal(d.persisted().state, 'REVIEW_FIX');
      d.attempt('sha-5');
      assert.deepEqual([d.next()['kind'], d.next()['decision'], d.next()['maxDecisions']], ['review', 5, admits]);
      await d.review();
      const last = d.next();
      if (admits === 8) return assert.match(last['narration'], /^Second R3 pass/);
      if (fifth === PASS) { assert.deepEqual([last['kind'], d.ship.requests.map((q) => q.candidateSha), d.persisted().review.invocations.some((i) => i.secondPass)], ['close', ['sha-5'], false]); d.further('sha-6'); return assert.rejects(d.review(), /continuation's admitted count of 5 decisions is used/); }
      assert.match(d.persisted().stop!.detail, /continuation.*\b5\b/);
      d.further('sha-6');
      await assert.rejects(d.review(), /continuation/);
    }, { secondPass: true });
  }
});

test('acceptance 4: a run stopped on decision 2 by a re-raise and continued with one decision is admitted decision 3 and no more: a block stops it and decision 4 is refused, a pass ships with no second pass and no further decision [R4] [R5]', async () => {
  for (const third of [PASS, block('no doc row')]) {
    await scenario([...RERAISE, third], async (d) => {
      await d.reraised();
      d.go({ decisions: 1 });
      assert.match(d.next()['narration'], left(1));
      d.attempt('sha-3');
      assert.deepEqual([d.next()['kind'], d.next()['decision'], d.next()['maxDecisions']], ['review', 3, 3]);
      await d.review();
      if (third === PASS) {
        await assert.rejects(d.review(), /continuation's admitted count of 3 decisions is used/);
        return assert.deepEqual([d.next()['kind'], d.persisted().review.invocations.some((i) => i.secondPass)], ['close', false]);
      }
      assert.deepEqual([d.next()['kind'], d.persisted().stop?.reason], ['stop', 'review']);
      assert.match(d.persisted().stop!.detail, /continuation.*\b3\b/);
      d.further('sha-4');
      await assert.rejects(d.review(), /continuation/);
    }, { secondPass: true });
  }
});

test('acceptance 5: a run the gate stopped with no decision left is continued and gets decision 3 of 3; after a further CI code defect the gate stop names the continuation [R4] [R5]', async () => {
  await scenario([block('no RED'), PASS, PASS], async (d) => {
    await d.cycle('sha-1');
    assert.equal((await d.cycle('sha-2'))['kind'], 'build');
    d.attempt('sha-3');
    assert.deepEqual([d.next()['kind'], d.persisted().stop?.reason], ['stop', 'review']);
    assert.match(d.persisted().stop!.detail, /exceeds the two-decision allowance \(2 used\)/);
    d.go();
    assert.deepEqual([d.next()['kind'], d.next()['decision'], d.next()['maxDecisions']], ['review', 3, 3]);
    await d.review();
    // A second defect with another cause, so the effort ladder admits the repair (a repeated cause is a same-cause stop).
    Object.assign(d.ship, { stdoutText: CODE_DEFECT.replace('AssertionError: expected 2 to equal 3', 'TypeError: x is not a function') });
    assert.equal(d.next()['kind'], 'build');
    d.attempt('sha-4');
    assert.match(d.next()['stop'].detail, /exceeds the continuation's admitted count of 3 decisions \(3 used\)/);
  }, { ship: new InjectedShipPath(['ci-red', 'ci-red'], CODE_DEFECT) });
});

test('acceptance 6, fault rows: a failed card-run write changes no byte; a failed CARD_STATE append keeps the continuation and the next card next appends the event once [R3]', async () => {
  await scenario([...RERAISE], async (d) => {
    await d.reraised();
    const held = d.bytes();
    for (const on of [{ record: true }, { append: true }]) {
      Object.assign(fault, on);
      assert.throws(() => d.go(), /EIO: injected/);
      Object.assign(fault, { record: false, append: false });
      if (on.record) assert.deepEqual(d.bytes(), held, 'the card-run file and the journal are byte-identical');
    }
    assert.deepEqual([d.stored()['continuations'].length, d.readmitted().length], [1, 0]);
    d.next(); d.next(); // the first delivers the owed event, the second appends nothing
    assert.deepEqual(d.readmitted().map((e) => [e['data'].continuation.admits, e['data'].completed]), [[3, true]]);
  });
});

test('acceptance 7: a run under a ship-path reviewer, a run in BUILD, a run stopped for ci and a card with no run each throw with their cause and write nothing [R6]', async () => {
  const rows: Array<[string, (run: Stored, config: Stored) => void, RegExp]> = [
    ['ship-path reviewer', (_run, config) => { config['formalReview'].command = []; }, /formal reviewer is not a command/],
    ['BUILD', (run) => { run['state'] = 'BUILD'; delete run['stop']; }, /is in BUILD, not in STOP/],
    ['ci', (run) => { run['stop'].reason = 'ci'; }, /stop reason ci is not review/],
    ['no run', () => {}, /T1-NONE has no card run/],
  ];
  for (const [name, change, cause] of rows) {
    await scenario([...RERAISE], async (d, config) => {
      await d.reraised();
      d.seed((run) => change(run, config));
      const held = d.bytes();
      assert.throws(() => d.go({}, name === 'no run' ? { ...d.card, id: 'T1-NONE' } : d.card), cause, name);
      assert.deepEqual(d.bytes(), held, name);
    });
  }
});
