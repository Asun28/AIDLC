// Card T1-CARD-AMEND: `CardRunner.amendCard` records the amendment of a started card in one locked update and re-derives the candidate digest.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs, { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, InjectedShipPath, T0, type CardSpec } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { amendedDigest, contractDigests } from '../../src/core/contract.ts';
import type { Card } from '../../src/core/types.ts';

type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const CARD = 'T1-CA';
const FILE = 'src/t1-ca.ts';
const BY = 'the owner';
const REASON = 'acceptance reworded';
const SPEC: CardSpec = { id: CARD, title: 'card amend', allowPaths: [FILE], requirements: ['R1. The amend shall hold.'], acceptance: ['1. amend holds. [R1]'], budget: 80 };
const ACCEPTANCE = { acceptance: ['1. amend holds twice. [R1]'] };
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const TRANSIENT = '[CI-GATE-LOG] actions/runs/12345/job/456\nError: read ECONNRESET while fetching artifact\n[CI-GATE-RED] [{"name":"build","conclusion":"failure"}]\n[CI-GATE-STEP] {"check":"build","job":"456","step":{"number":1,"name":"Set up job","conclusion":"failure"}}';
const block = (text: string): string => { const reasons = [`[spec] 6 tests @ ${FILE}:1: ${text} -> add one`]; return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n'; };
const amendment = (changed: string[], invalidated: string[], revision = 1) => ({ at: T0, by: BY, reason: REASON, revision, changed, invalidated });

/** The faults of tests/scenarios/fault-points.test.ts: a throw from fs.renameSync onto the card-run record, and from fs.appendFileSync onto a NOTE line of the goal journal. */
const fault = { record: false, append: false };
const real = { appendFileSync: fs.appendFileSync, renameSync: fs.renameSync };
const eio = () => Object.assign(new Error('EIO: injected'), { code: 'EIO' });
before(() => {
  Object.assign(fs, {
    appendFileSync: (...a: Parameters<typeof fs.appendFileSync>) => { if (fault.append && String(a[0]).endsWith('.jsonl') && String(a[1]).includes('"type":"NOTE"')) throw eio(); return real.appendFileSync(...a); },
    renameSync: (from: fs.PathLike, to: fs.PathLike) => { if (fault.record && String(to).endsWith(`${CARD}.json`)) throw eio(); return real.renameSync(from, to); },
  });
  syncBuiltinESMExports();
});
after(() => { Object.assign(fs, real); syncBuiltinESMExports(); });

/** `body` on a one-card goal under a command reviewer that answers with `verdicts` in order. */
async function scenario(verdicts: string[], body: (s: ReturnType<typeof setup>) => Promise<void> | void, ship = new InjectedShipPath(['merged'], '')) {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } } });
  try {
    await body(setup(fx, verdicts, ship));
  } finally {
    Object.assign(fault, { record: false, append: false });
    fx.cleanup();
  }
}
function setup(fx: ReturnType<typeof makeFixture>, verdicts: string[], ship: InjectedShipPath) {
  const script = scriptedRunner({ 'git diff --name-only': { stdout: `${FILE}\u0000` }, 'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` }, 'fake-r3': () => ({ stdout: verdicts.shift()! }) });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, SPEC);
  const goal = goalForCards(fx, [CARD]);
  let card = fx.card(CARD);
  const g = () => fx.goal(goal.id);
  const persisted = () => fx.store.getCardRun(goal.id, CARD)!;
  runner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  const runFile = fx.store.cardFile(goal.id, CARD);
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const stored = (): Stored => JSON.parse(readFileSync(runFile, 'utf8'));
  const next = () => runner.next(g(), card, persisted()).directive as Stored;
  const attempt = (sha: string) => runner.recordAttempt(g(), card, persisted(), { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha });
  const review = () => runner.formalReview(g(), card, persisted());
  return {
    fx, ship, goal, persisted, stored, next, attempt, review,
    card: () => card,
    /** A success with candidate `sha`, its review directive and the R3 decision. */
    decide: async (sha: string) => { attempt(sha); assert.equal(next()['kind'], 'review'); await review(); },
    reconcile: () => runner.ciReconcile(g(), card, persisted(), '12345', () => ({ status: 'completed', conclusion: 'success', attempt: 2 })),
    /** The card file as committed with `delta`, as the runner reads it from then on. */
    change: (delta: Partial<CardSpec>) => { writeCard(fx, { ...SPEC, ...delta }); card = fx.card(CARD); },
    amend: (act: { by?: string; reason?: string } = {}, c: Card = card) => runner.amendCard(g(), c, { by: BY, reason: REASON, ...act }),
    seed: (change: (run: Stored) => void) => { const run = stored(); change(run); writeFileSync(runFile, JSON.stringify(run, null, 2), 'utf8'); },
    bytes: () => [existsSync(runFile) ? readFileSync(runFile, 'utf8') : '', readFileSync(journalFile, 'utf8')],
    events: (type?: string): Stored[] => readFileSync(journalFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => !type || e['type'] === type),
  };
}
/** The fields R5 keeps, the commit of the candidate and the outcome of every attempt. */
const kept = (r: Stored) => [r['state'], r['stop'], r['review'], r['preReview'], r['findings'], r['continuations'], r['redReceipt'], r['deadline'], r['candidate']?.sha, r['effort']?.attempts.map((a: Stored) => a.outcome)];
const strip = (e: Stored) => { const { eventKey: _key, ...data } = e['data']; return data; };

test('acceptance 1 and 2: an R3-passed run not shipped, after its acceptance changed, records revision 1, loses its DoD receipt and its succeeded episode, takes the amended digest on candidate and CI rerun; card next builds, the attempt on the same commit is reviewed again and ships [R1] [R2] [R3] [R4] [R5]', () => scenario([PASS, PASS], async (s) => {
  await s.decide('sha-1');
  assert.equal(s.next()['kind'], 'ship', 'the transient failure takes the rerun');
  s.reconcile();
  const was = s.stored();
  s.change(ACCEPTANCE);
  s.amend();
  const now = s.stored();
  assert.deepEqual(now['amendments'], [amendment(['acceptance'], ['dod', 'review'])]);
  assert.deepEqual([was['cardRevision'], now['cardRevision']], [0, 1]);
  assert.deepEqual(now['contract'], contractDigests(s.card()));
  assert.deepEqual(['dodReceipt' in was, 'dodReceipt' in now, was['effort'].terminal, now['effort'].terminal], [true, false, 'succeeded', undefined]);
  assert.deepEqual([was['candidate'].digest, was['ci'].reruns.map((r: Stored) => r.candidate)], ['sha-1', ['sha-1']]);
  assert.deepEqual([now['candidate'].digest, now['ci'].reruns.map((r: Stored) => r.candidate)], [amendedDigest('sha-1', 1), [amendedDigest('sha-1', 1)]]);
  assert.deepEqual(now['review'].invocations.map((i: Stored) => i.candidateDigest), ['sha-1']);
  assert.deepEqual(kept(now), kept(was));
  const shipped = s.ship.requests.length;
  assert.equal(s.next()['kind'], 'build');
  s.attempt('sha-1');
  assert.equal(s.persisted().candidate!.digest, amendedDigest('sha-1', 1));
  assert.equal(s.next()['kind'], 'review');
  await s.review();
  assert.equal(s.persisted().review.substantiveDecisions, was['review'].substantiveDecisions + 1);
  assert.deepEqual([s.next()['kind'], s.persisted().mergeVerified, s.ship.requests.length], ['close', true, shipped + 1]);
}, new InjectedShipPath(['ci-red', 'merged'], TRANSIENT)));

test('acceptance 2, second row: a run that used its two decisions is amended, rebuilt on the same commit and stopped for review by card next [R3] [R4]', () => scenario([block('no RED'), PASS], async (s) => {
  await s.decide('sha-1');
  await s.decide('sha-2');
  assert.equal(s.persisted().review.substantiveDecisions, 2);
  s.change(ACCEPTANCE);
  s.amend();
  assert.equal(s.next()['kind'], 'build');
  s.attempt('sha-2');
  assert.deepEqual([s.next()['kind'], s.persisted().stop?.reason, s.ship.requests.length], ['stop', 'review', 0]);
  assert.match(s.persisted().stop!.detail, new RegExp(`${amendedDigest('sha-2', 1)} exceeds the two-decision allowance \\(2 used\\)`));
}));

test('acceptance 3: budget alone, dod_command alone, requirements alone and a run in STOP for review each lose only the evidence their fields touch [R1] [R2] [R3] [R5]', async () => {
  const rows: Array<[string, string[], Partial<CardSpec>, string[], string[], (s: ReturnType<typeof setup>, was: Stored, now: Stored) => void]> = [
    ['budget', [PASS], { budget: 120 }, ['budget'], [], (s, was, now) => {
      assert.deepEqual([now['dodReceipt'], now['candidate'].digest], [was['dodReceipt'], 'sha-1']);
      assert.deepEqual([s.next()['kind'], s.persisted().review.invocations.length, s.ship.requests.map((q) => q.candidateSha)], ['close', 1, ['sha-1']]);
    }],
    ['dod_command', [PASS], { dodCommand: 'node --test tests/other.test.ts' }, ['dod_command'], ['dod'], (s, _was, now) => {
      assert.deepEqual(['dodReceipt' in now, now['candidate'].digest], [false, 'sha-1']);
      assert.equal(s.next()['kind'], 'build');
      s.attempt('sha-1');
      assert.deepEqual([s.next()['kind'], s.persisted().review.invocations.length, s.ship.requests.map((q) => q.candidateSha)], ['close', 1, ['sha-1']]);
    }],
    ['requirements', [PASS], { requirements: ['R1. The amend shall hold twice.'] }, ['requirements'], ['review'], (s, was, now) => {
      assert.deepEqual([now['dodReceipt'], now['candidate'].digest], [was['dodReceipt'], amendedDigest('sha-1', 1)]);
      assert.equal(s.next()['kind'], 'review');
    }],
    ['STOP for review', ['a', 'b', 'c', 'd'].map(block), { requirements: ['R1. The amend shall hold twice.'] }, ['requirements'], ['review'], (_s, was, now) => {
      assert.deepEqual([was['state'], was['stop'].reason, now['state'], now['stop'], now['candidate'].digest], ['STOP', 'review', 'STOP', was['stop'], amendedDigest('sha-4', 1)]);
    }],
  ];
  for (const [name, verdicts, delta, changed, invalidated, then] of rows) {
    await scenario(verdicts, async (s) => {
      for (const n of verdicts.keys()) await s.decide(`sha-${n + 1}`);
      if (verdicts.length === 4) s.next();
      const was = s.stored();
      s.change(delta);
      s.amend();
      const now = s.stored();
      assert.deepEqual([now['amendments'], now['cardRevision'], now['contract']], [[amendment(changed, invalidated)], 1, contractDigests(s.card())], name);
      assert.deepEqual(kept(now), kept(was), name);
      if (!invalidated.includes('dod')) assert.deepEqual(now['effort'], was['effort'], name);
      then(s, was, now);
    });
  }
});

test('acceptance 4: each refusal names its cause and leaves the card-run file and the journal byte-identical [R6]', async () => {
  const op = (status: string) => (s: ReturnType<typeof setup>) => {
    const { id } = s.fx.ops.recordIntent({ kind: 'merge', goalId: s.goal.id, cardId: CARD, target: 'main', candidateDigest: 'sha-1', ownerGeneration: 0, timeoutMs: 60_000, effects: ['merge'] }, T0);
    if (status !== 'intended') s.fx.ops.markIssued(id, undefined, T0);
    if (status === 'running') s.fx.ops.markRunning(id, T0);
    if (status === 'UNKNOWN') s.fx.ops.markResult(id, 'UNKNOWN', {}, T0);
  };
  const rows: Array<[string, (s: ReturnType<typeof setup>) => void, RegExp, { by?: string; reason?: string }?]> = [
    ['no run', () => {}, /T1-NONE has no card run/],
    ['DONE', (s) => s.seed((r) => { r['state'] = 'DONE'; }), /is DONE/],
    ['mergeVerified', (s) => s.seed((r) => { r['mergeVerified'] = true; }), /is merged/],
    ...['intended', 'issued', 'running', 'UNKNOWN'].map((status): [string, (s: ReturnType<typeof setup>) => void, RegExp] => [`operation ${status}`, op(status), /operation\(s\) of this card are unresolved/]),
    ['pending invocation', (s) => s.seed((r) => { r['review'].invocations.push({ ...r['review'].invocations[0], invocationId: 'inv-pending', outcome: 'pending' }); }), /formal review of this card is in flight/],
    ['pending repair', (s) => s.seed((r) => { r['pendingRepair'] = { kind: 'red-missing', detail: 'no RED', at: T0 }; }), /red-missing repair is pending/],
    ['no contract', (s) => s.seed((r) => { delete r['contract']; }), /holds no contract/],
    ['equal contract', (s) => s.seed((r) => { r['contract'] = contractDigests(s.card()); }), /contract equals the card's/],
    ['blank by', () => {}, /by is blank/, { by: ' \t' }],
    ['blank reason', () => {}, /reason is blank/, { reason: '  ' }],
  ];
  for (const [name, arrange, cause, act] of rows) {
    await scenario([PASS], async (s) => {
      await s.decide('sha-1');
      s.change(ACCEPTANCE);
      arrange(s);
      const held = s.bytes();
      assert.throws(() => s.amend(act, name === 'no run' ? { ...s.card(), id: 'T1-NONE' } : s.card()), cause, name);
      assert.deepEqual(s.bytes(), held, name);
    });
  }
});

test('acceptance 5: the act appends exactly one NOTE event with the amendment; a failed card-run write changes no byte; a failed NOTE append keeps the amendment and the next card next appends the event once [R7]', async () => {
  const data = { amendment: { by: BY, reason: REASON, revision: 1, changed: ['acceptance'], invalidated: ['dod', 'review'] } };
  for (const faulted of [false, true]) {
    await scenario([PASS], async (s) => {
      await s.decide('sha-1');
      s.change(ACCEPTANCE);
      const count = s.events().length;
      if (!faulted) {
        s.amend();
        return assert.deepEqual(s.events().slice(count).map((e) => [e['type'], strip(e)]), [['NOTE', data]]);
      }
      const held = s.bytes();
      fault.record = true; assert.throws(() => s.amend(), /EIO: injected/); fault.record = false;
      assert.deepEqual(s.bytes(), held, 'the card-run file and the journal are byte-identical');
      fault.append = true; assert.throws(() => s.amend(), /EIO: injected/); fault.append = false;
      assert.deepEqual([s.persisted().amendments, s.events().length], [[amendment(['acceptance'], ['dod', 'review'])], count]);
      s.next(); s.next();
      assert.deepEqual(s.events('NOTE').map(strip), [{ ...data, completed: true }]);
    });
  }
});
