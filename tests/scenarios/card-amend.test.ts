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
type S = ReturnType<typeof setup>;
const [CARD, FILE, BY, REASON] = ['T1-CA', 'src/t1-ca.ts', 'the owner', 'acceptance reworded'];
const SPEC: CardSpec = { id: CARD, title: 'card amend', allowPaths: [FILE], requirements: ['R1. The amend shall hold.'], acceptance: ['1. amend holds. [R1]'], budget: 80 };
const [ACCEPTANCE, REQUIREMENTS, DOD] = [{ acceptance: ['1. amend holds twice. [R1]'] }, { requirements: ['R1. The amend shall hold twice.'] }, { dodCommand: 'node --test tests/other.test.ts' }];
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
  }); syncBuiltinESMExports();
});
after(() => { Object.assign(fs, real); syncBuiltinESMExports(); });

/** `body` on a one-card goal under a command reviewer that answers with `verdicts` in order, and an R2 reviewer answering with `r2` when given. */
async function scenario(verdicts: string[], body: (s: S) => Promise<void> | void, ship = new InjectedShipPath(['merged'], ''), r2?: string[]) {
  const preReview = r2 ? { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } : {};
  const fx = makeFixture({ config: { gateRequired: true, ...preReview, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } } });
  try { await body(setup(fx, [...verdicts], ship, [...(r2 ?? [])])); } finally { Object.assign(fault, { record: false, append: false }); fx.cleanup(); }
}
function setup(fx: ReturnType<typeof makeFixture>, verdicts: string[], ship: InjectedShipPath, r2: string[] = []) {
  const script = scriptedRunner({ 'git diff --name-only': { stdout: `${FILE}\u0000` }, 'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` }, 'fake-r3': () => ({ stdout: verdicts.shift()! }), 'fake-r2': () => ({ stdout: r2.shift()! }) });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, SPEC);
  const goal = goalForCards(fx, [CARD]);
  let card = fx.card(CARD);
  const [g, persisted] = [() => fx.goal(goal.id), () => fx.store.getCardRun(goal.id, CARD)!];
  runner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  const [runFile, journalFile] = [fx.store.cardFile(goal.id, CARD), path.join(fx.paths.journal, `${goal.id}.jsonl`)];
  const stored = (): Stored => JSON.parse(readFileSync(runFile, 'utf8'));
  const next = () => runner.next(g(), card, persisted()).directive as Stored;
  /** A success; with no `sha` the dry-run path keeps the run's candidate. */
  const attempt = (sha?: string, evidence?: string) => runner.recordAttempt(g(), card, persisted(), { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha, evidence });
  const review = () => runner.formalReview(g(), card, persisted());
  const pre = () => runner.preReview(g(), card, persisted());
  return {
    fx, ship, goal, persisted, stored, next, attempt, review, pre, card: () => card,
    /** A success with candidate `sha`, its review directive and the R3 decision. */
    decide: async (sha: string) => { attempt(sha); assert.equal(next()['kind'], 'review'); await review(); },
    reconcile: () => runner.ciReconcile(g(), card, persisted(), '12345', () => ({ status: 'completed', conclusion: 'success', attempt: 2 })),
    /** The card file committed with `delta` and amended on the run. */
    amend: (delta?: Partial<CardSpec>, act: { by?: string; reason?: string } = {}, c?: Card) => { if (delta) { writeCard(fx, { ...SPEC, ...delta }); card = fx.card(CARD); } return runner.amendCard(g(), c ?? card, { by: BY, reason: REASON, ...act }); },
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
  const was = s.stored(); s.amend(ACCEPTANCE); const now = s.stored();
  assert.deepEqual(now['amendments'], [amendment(['acceptance'], ['dod', 'review'])]);
  assert.deepEqual([was['cardRevision'], now['cardRevision']], [0, 1]);
  assert.deepEqual(now['contract'], contractDigests(s.card()));
  assert.deepEqual(['dodReceipt' in was, 'dodReceipt' in now, was['effort'].terminal, now['effort'].terminal], [true, false, 'succeeded', undefined]);
  assert.deepEqual([was['candidate'].digest, was['ci'].reruns.map((r: Stored) => r.candidate)], ['sha-1', ['sha-1']]);
  assert.deepEqual([now['candidate'].digest, now['ci'].reruns.map((r: Stored) => r.candidate)], [amendedDigest('sha-1', 1), [amendedDigest('sha-1', 1)]]);
  assert.deepEqual(now['review'].invocations.map((i: Stored) => i.candidateDigest), ['sha-1']);
  assert.deepEqual(kept(now), kept(was));
  const shipped = s.ship.requests.length;
  assert.equal(s.next()['kind'], 'build'); s.attempt('sha-1');
  assert.equal(s.persisted().candidate!.digest, amendedDigest('sha-1', 1));
  assert.equal(s.next()['kind'], 'review'); await s.review();
  assert.equal(s.persisted().review.substantiveDecisions, was['review'].substantiveDecisions + 1);
  assert.deepEqual([s.next()['kind'], s.persisted().mergeVerified, s.ship.requests.length], ['close', true, shipped + 1]);
}, new InjectedShipPath(['ci-red', 'merged'], TRANSIENT)));

test('acceptance 2, second row: a run that used its two decisions is amended, rebuilt on the same commit and stopped for review by card next [R3] [R4]', () => scenario([block('no RED'), PASS], async (s) => {
  await s.decide('sha-1'); await s.decide('sha-2');
  assert.equal(s.persisted().review.substantiveDecisions, 2);
  s.amend(ACCEPTANCE);
  assert.equal(s.next()['kind'], 'build'); s.attempt('sha-2');
  assert.deepEqual([s.next()['kind'], s.persisted().stop?.reason, s.ship.requests.length], ['stop', 'review', 0]);
  assert.match(s.persisted().stop!.detail, new RegExp(`${amendedDigest('sha-2', 1)} exceeds the two-decision allowance \\(2 used\\)`));
}));

test('acceptance 3: budget alone, dod_command alone, requirements alone and a run in STOP for review each lose only the evidence their fields touch [R1] [R2] [R3] [R5]', async () => {
  const shipsUnreviewed = (s: S) => assert.deepEqual([s.next()['kind'], s.persisted().review.invocations.length, s.ship.requests.map((q) => q.candidateSha)], ['close', 1, ['sha-1']]);
  const rows: Array<[string, string[], Partial<CardSpec>, string[], string[], (s: S, was: Stored, now: Stored) => void]> = [
    ['budget', [PASS], { budget: 120 }, ['budget'], [], (s, was, now) => { assert.deepEqual([now['dodReceipt'], now['candidate'].digest], [was['dodReceipt'], 'sha-1']); shipsUnreviewed(s); }],
    ['dod_command', [PASS], DOD, ['dod_command'], ['dod'], (s, _was, now) => { assert.deepEqual(['dodReceipt' in now, now['candidate'].digest, s.next()['kind']], [false, 'sha-1', 'build']); s.attempt('sha-1'); shipsUnreviewed(s); }],
    ['requirements', [PASS], REQUIREMENTS, ['requirements'], ['review'], (s, was, now) => { assert.deepEqual([now['dodReceipt'], now['candidate'].digest, s.next()['kind']], [was['dodReceipt'], amendedDigest('sha-1', 1), 'review']); }],
    ['STOP for review', ['a', 'b', 'c', 'd'].map(block), REQUIREMENTS, ['requirements'], ['review'], (_s, was, now) => {
      assert.deepEqual([was['state'], was['stop'].reason, now['state'], now['stop'], now['candidate'].digest], ['STOP', 'review', 'STOP', was['stop'], amendedDigest('sha-4', 1)]);
    }],
  ];
  for (const [name, verdicts, delta, changed, invalidated, then] of rows) {
    await scenario(verdicts, async (s) => {
      for (const n of verdicts.keys()) await s.decide(`sha-${n + 1}`);
      if (verdicts.length === 4) s.next();
      const was = s.stored(); s.amend(delta); const now = s.stored();
      assert.deepEqual([now['amendments'], now['cardRevision'], now['contract']], [[amendment(changed, invalidated)], 1, contractDigests(s.card())], name);
      assert.deepEqual(kept(now), kept(was), name);
      if (!invalidated.includes('dod')) assert.deepEqual(now['effort'], was['effort'], name);
      then(s, was, now);
    });
  }
});

test('acceptance 4: each refusal names its cause and leaves the card-run file and the journal byte-identical [R6]', async () => {
  const op = (status: string) => (s: S) => { const { id } = s.fx.ops.recordIntent({ kind: 'merge', goalId: s.goal.id, cardId: CARD, target: 'main', candidateDigest: 'sha-1', ownerGeneration: 0, timeoutMs: 60_000, effects: ['merge'] }, T0);
    if (status !== 'intended') s.fx.ops.markIssued(id, undefined, T0);
    if (status === 'running') s.fx.ops.markRunning(id, T0); else if (status === 'UNKNOWN') s.fx.ops.markResult(id, 'UNKNOWN', {}, T0); };
  const rows: Array<[string, (s: S) => void, RegExp, { by?: string; reason?: string }?]> = [
    ['no run', () => {}, /T1-NONE has no card run/],
    ['DONE', (s) => s.seed((r) => { r['state'] = 'DONE'; }), /is DONE/],
    ['mergeVerified', (s) => s.seed((r) => { r['mergeVerified'] = true; }), /is merged/],
    ...['intended', 'issued', 'running', 'UNKNOWN'].map((status): [string, (s: S) => void, RegExp] => [`operation ${status}`, op(status), /operation\(s\) of this card are unresolved/]),
    ['pending invocation', (s) => s.seed((r) => { r['review'].invocations.push({ ...r['review'].invocations[0], invocationId: 'inv-pending', outcome: 'pending' }); }), /formal review of this card is in flight/],
    ['pending repair', (s) => s.seed((r) => { r['pendingRepair'] = { kind: 'red-missing', detail: 'no RED', at: T0 }; }), /red-missing repair is pending/],
    ['no contract', (s) => s.seed((r) => { delete r['contract']; }), /holds no contract/],
    ['equal contract', (s) => s.seed((r) => { r['contract'] = contractDigests({ ...s.card(), ...ACCEPTANCE }); }), /contract equals the card's/],
    ['blank by', () => {}, /by is blank/, { by: ' \t' }],
    ['blank reason', () => {}, /reason is blank/, { reason: '  ' }],
  ];
  for (const [name, arrange, cause, act] of rows) {
    await scenario([PASS], async (s) => {
      await s.decide('sha-1'); arrange(s);
      const held = s.bytes();
      assert.throws(() => s.amend(ACCEPTANCE, act, name === 'no run' ? { ...s.card(), id: 'T1-NONE' } : undefined), cause, name);
      assert.deepEqual(s.bytes(), held, name);
    });
  }
});

test('acceptance 5: the act appends exactly one NOTE event with the amendment; a failed card-run write changes no byte; a failed NOTE append keeps the amendment and the next card next appends the event once [R7]', async () => {
  const data = { amendment: { by: BY, reason: REASON, revision: 1, changed: ['acceptance'], invalidated: ['dod', 'review'] } };
  for (const faulted of [false, true]) {
    await scenario([PASS], async (s) => {
      await s.decide('sha-1');
      const count = s.events().length;
      if (!faulted) { s.amend(ACCEPTANCE); return assert.deepEqual(s.events().slice(count).map((e) => [e['type'], strip(e)]), [['NOTE', data]]); }
      const held = s.bytes();
      fault.record = true; assert.throws(() => s.amend(ACCEPTANCE), /EIO: injected/); fault.record = false;
      assert.deepEqual(s.bytes(), held, 'the card-run file and the journal are byte-identical');
      fault.append = true; assert.throws(() => s.amend(ACCEPTANCE), /EIO: injected/); fault.append = false;
      assert.deepEqual([s.persisted().amendments, s.events().length], [[amendment(['acceptance'], ['dod', 'review'])], count]);
      s.next(); s.next();
      assert.deepEqual(s.events('NOTE').map(strip), [{ ...data, completed: true }]);
    });
  }
});

test('guard rows: a CI rerun of another candidate keeps its candidate, a second amendment applies the digest twice and a kept candidate is not amended again; after an R3 block a dod or a review amendment unsets the blocked receipt and leaves the reopened episode as it was [R2] [R3] [R4]', async () => {
  for (const sha of ['sha-1', undefined]) {
    await scenario([PASS], async (s) => {
      await s.decide('sha-1');
      s.seed((r) => { r['ci'].reruns = ['sha-0', 'sha-1'].map((candidate, i) => ({ runId: `${i}`, attempt: 1, candidate, requestedAt: T0, outcome: 'success' })); });
      for (const n of [1, 2]) s.amend({ acceptance: [`1. amend holds ${n} times. [R1]`] });
      assert.deepEqual([s.stored()['amendments'].map((a: Stored) => a.revision), s.stored()['ci'].reruns.map((r: Stored) => r.candidate), s.next()['kind']], [[1, 2], ['sha-0', amendedDigest('sha-1', 2)], 'build']);
      s.attempt(sha);
      assert.equal(s.persisted().candidate!.digest, amendedDigest('sha-1', 2), String(sha));
    });
  }
  for (const delta of [DOD, REQUIREMENTS, ACCEPTANCE]) {
    await scenario([block('no RED')], async (s) => {
      await s.decide('sha-1');
      const was = s.stored(); s.amend(delta);
      assert.deepEqual([was['effort'].terminal, 'blockedReceipt' in was, 'blockedReceipt' in s.stored(), s.stored()['effort']], [undefined, true, false, was['effort']], JSON.stringify(delta));
    });
  }
});

test('R3 decision 1, F1: with pre-review configured, a candidate holding an R2 and an R3 pass is amended in its requirements; card next asks for a new pre-review round, which is admitted and passes, R3 decides the amended candidate and the ship merges [R3] [R4]', () => scenario([PASS, PASS], async (s) => {
  s.attempt('sha-1');
  assert.equal(s.next()['kind'], 'pre-review'); await s.pre();
  assert.equal(s.next()['kind'], 'review'); await s.review();
  s.amend(REQUIREMENTS);
  const amended = amendedDigest('sha-1', 1);
  assert.equal(s.next()['kind'], 'pre-review');
  await assert.doesNotReject(s.pre());
  assert.deepEqual(s.persisted().preReview.rounds.map((r) => [r.candidateSha, r.candidateDigest, r.outcome]), [['sha-1', 'sha-1', 'pass'], ['sha-1', amended, 'pass']]);
  assert.equal(s.next()['kind'], 'review'); await s.review();
  assert.deepEqual([s.persisted().review.invocations.map((i) => [i.candidateSha, i.candidateDigest, i.outcome]), s.persisted().review.substantiveDecisions], [[['sha-1', 'sha-1', 'pass'], ['sha-1', amended, 'pass']], 2]);
  assert.deepEqual([s.next()['kind'], s.persisted().mergeVerified, s.ship.requests.map((q) => q.candidateSha)], ['close', true, ['sha-1']]);
}, undefined, [PASS, PASS]));

test('R3 decision 1, F2: a candidate R3 blocked with an undisputed finding is amended in its requirements and recorded again on the same commit; R3 is admitted on the amended candidate, the old block and its finding stay as they were, the pass resolves the finding by the existing rule and ships [R3] [R4] [R5]', () => scenario([block('no RED'), PASS], async (s) => {
  await s.decide('sha-1');
  const was = s.stored();
  assert.deepEqual([was['findings'].map((f: Stored) => [f.id, f.disposition, f.disputes.length]), was['review'].substantiveDecisions, was['review'].substantiveBlocks], [[['F1', 'open', 0]], 1, 1]);
  s.amend(REQUIREMENTS);
  s.attempt('sha-1');
  assert.equal(s.next()['kind'], 'review');
  await assert.doesNotReject(s.review());
  const now = s.stored();
  assert.deepEqual(now['review'].invocations[0], was['review'].invocations[0]);
  assert.deepEqual(now['review'].invocations.map((i: Stored) => [i.candidateDigest, i.outcome]), [['sha-1', 'block'], [amendedDigest('sha-1', 1), 'pass']]);
  assert.deepEqual([now['review'].substantiveDecisions, now['review'].substantiveBlocks], [2, 1]);
  assert.deepEqual(now['findings'], [{ ...was['findings'][0], resolvedAt: T0, revision: was['findings'][0].revision + 1 }], 'the pass resolves F1 (recordFindings)');
  assert.deepEqual([s.next()['kind'], s.persisted().mergeVerified], ['close', true]);
}));

test('guard rows of the same-candidate rule: a pre-review pass on the amended digest still refuses another round; without a review amendment a block recorded under another digest of the same commit still refuses R3 [R3]', async () => {
  await scenario([PASS], async (s) => {
    s.attempt('sha-1'); s.next(); await s.pre(); s.next(); await s.review();
    s.amend(REQUIREMENTS); s.next(); await s.pre();
    await assert.rejects(s.pre(), /already holds a pre-review pass \(round 2 of cycle 0\)/);
  }, undefined, [PASS, PASS]);
  await scenario([block('no RED')], async (s) => {
    await s.decide('sha-1');
    s.seed((r) => { r['review'].invocations[0].candidateDigest = 'dg-earlier'; });
    s.amend(DOD); s.attempt('sha-1');
    await assert.rejects(s.review(), /candidate sha-1 was blocked by its last formal decision and is unchanged; open finding\(s\): F1/);
  });
});

test('second R3 pass, F3: a dod amendment of a succeeded episode keeps the bound attempt a success and appends the literal reopen reason with its revision to its evidence; a second one on the re-succeeded episode appends revision 2 [R1] [R2]', async () => {
  const rows: Array<[string | undefined, string, string]> = [
    [undefined, 'review block: amendment 1', 'review block: amendment 2'],
    ['dod green on sha-1', 'dod green on sha-1; review block: amendment 1', 'dod green on sha-1; review block: amendment 2'],
  ];
  for (const [prior, first, second] of rows) {
    await scenario([], async (s) => {
      s.attempt('sha-1', prior);
      s.amend(ACCEPTANCE);
      assert.deepEqual(s.persisted().effort!.attempts.map((a) => [a.outcome, a.evidence]), [['success', first]], String(prior));
      assert.equal(s.next()['kind'], 'build');
      s.attempt('sha-1', prior);
      s.amend(DOD);
      const now = s.stored();
      assert.deepEqual([now['effort'].attempts.map((a: Stored) => [a.outcome, a.evidence]), now['effort'].terminal, now['cardRevision'], now['contract']], [[['success', first], ['success', second]], undefined, 2, contractDigests(s.card())], String(prior));
    });
  }
});

test('clause rows: the revision is one above a cardRevision of 3; R4 on a new commit for n of 1 and 2; a continuation and a pre-review round stay as they were [R1] [R3] [R4] [R5]', async () => {
  await scenario([PASS], async (s) => {
    await s.decide('sha-1');
    s.seed((r) => { r['cardRevision'] = 3; r['continuations'] = [{ at: T0, by: 'the owner', reason: 'one more round', stop: { reason: 'review', detail: 'four blocks', at: T0 }, decisions: 1, admits: 5 }]; });
    const was = s.stored(); s.amend(ACCEPTANCE); const now = s.stored();
    assert.deepEqual([now['amendments'].map((a: Stored) => a.revision), now['cardRevision'], now['continuations']], [[4], 4, was['continuations']]);
  });
  for (const n of [1, 2]) {
    await scenario([PASS], async (s) => {
      await s.decide('sha-1');
      for (let i = 1; i <= n; i += 1) s.amend({ acceptance: [`1. amend holds ${i} times. [R1]`] });
      assert.equal(s.next()['kind'], 'build');
      s.attempt('sha-2');
      assert.deepEqual(s.persisted().candidate, { sha: 'sha-2', dirty: false, untracked: [], digest: amendedDigest('sha-2', n) }, String(n));
    });
  }
  await scenario([PASS], async (s) => {
    s.attempt('sha-1'); s.next(); await s.pre(); s.next(); await s.review();
    const was = s.stored(); s.amend(REQUIREMENTS); const now = s.stored();
    assert.deepEqual([now['preReview'], now['preReview'].rounds.map((r: Stored) => [r.candidateDigest, r.outcome])], [was['preReview'], [['sha-1', 'pass']]]);
  }, undefined, [PASS]);
});
