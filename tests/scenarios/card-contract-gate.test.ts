// Card T0-CONTRACT-GATE-2: while the card of a started run differs from the contract the run recorded, and the run is neither
// merged nor DONE, `next`, `recordAttempt`, `preReview` and `formalReview` refuse new work until the owner's amendment is
// recorded or the card text is restored; an amendment recorded during a call refuses the reservation or the ship.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, T0, type CardSpec } from './_harness.ts';
import { hostName } from '../../src/state/paths.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';

type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const [CARD, FILE, BY, REASON, SESSION] = ['T0-CG', 'src/t0-cg.ts', 'the owner', 'requirements reworded', 'card-contract-gate'];
const FAR = '2099-01-01T00:00:00.000Z';
const SPEC: CardSpec = { id: CARD, title: 'contract gate', allowPaths: [FILE], requirements: ['R1. The gate shall hold.'], acceptance: ['1. gate holds. [R1]'], budget: 80 };
const REQUIREMENTS = { requirements: ['R1. The gate shall hold twice.'] };
const BOTH = { ...REQUIREMENTS, acceptance: ['1. gate holds twice. [R1]'] };
const BUDGET = { budget: 90 };
const CONFIG = { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } };
const PRE = { preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } };
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const block = (text: string): string => { const reasons = [`[spec] 6 tests @ ${FILE}:1: ${text} -> add one`]; return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n'; };

const message = (fields: string[]) => `card ${CARD} differs from the contract its run recorded in ${fields.join(', ')}: nothing is recorded, reviewed, shipped or built on it until the owner's amendment is recorded with \`aidlc card amend ${CARD} --by <who> --reason <text>\` or the card text is restored to the recorded contract, which is the way on where the amendment is refused`;
const refusal = (fields: string[]) => ({ message: message(fields) });
/** The refusal of R5 on a record locked for a reservation. */
const amended = (fields: string[]) => ({ message: `the contract of card ${CARD} was amended after this command read the run (${fields.join(', ')}); run the command again` });

function setup(fx: ReturnType<typeof makeFixture>) {
  const verdicts: string[] = [];
  const r2: string[] = [];
  const calls = { r3: 0, r2: 0 };
  /** A write of another caller, made once while the command collects the candidate diff. */
  const during: { diff?: () => void } = {};
  const ship = new DryRunShipPath(['merged']);
  const script = scriptedRunner({ 'git diff --name-only': () => ({ stdout: `${FILE}\u0000` }), 'git diff': () => { const write = during.diff; during.diff = undefined; write?.(); return { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` }; }, 'fake-r3': () => { calls.r3 += 1; return { stdout: verdicts.shift()! }; }, 'fake-r2': () => { calls.r2 += 1; return { stdout: r2.shift()! }; } });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, SPEC);
  const goal = goalForCards(fx, [CARD]);
  const g = () => fx.goal(goal.id);
  const card = () => fx.card(CARD);
  const persisted = () => fx.store.getCardRun(goal.id, CARD)!;
  const next = () => runner.next(g(), card(), persisted()).directive as Stored;
  const record = (outcome: 'success' | 'fail' | 'not-counted', sha = 'sha-1') => runner.recordAttempt(g(), card(), persisted(), outcome === 'success' ? { outcome, dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha } : outcome === 'fail' ? { outcome, cause: 'the test failed' } : { outcome, notCountedReason: 'quota' });
  const review = () => runner.formalReview(g(), card(), persisted());
  const pre = () => runner.preReview(g(), card(), persisted());
  const amend = () => runner.amendCard(g(), card(), { by: BY, reason: REASON });
  const started = () => {
    runner.next(g(), card(), fx.controller.ensureCardRun(g(), CARD));
    assert.equal(next()['kind'], 'build');
    fx.store.updateCardRun(goal.id, CARD, (r) => ({ ...r!, deadline: FAR }));
  };
  const decide = async (sha: string, verdict: string) => { verdicts.push(verdict); record('success', sha); assert.equal(next()['kind'], 'review'); await review(); };
  const runFile = fx.store.cardFile(goal.id, CARD);
  const journalFile = path.join(fx.paths.journal, `${goal.id}.jsonl`);
  const bytes = () => [runFile, journalFile].map((f) => (existsSync(f) ? readFileSync(f, 'utf8') : ''));
  const events = (type: string) => readFileSync(journalFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Stored).filter((e) => e['type'] === type);
  const seed = (change: (run: Stored) => void) => { const run = JSON.parse(readFileSync(runFile, 'utf8')); change(run); writeFileSync(runFile, JSON.stringify(run, null, 2), 'utf8'); };
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: SESSION };
  writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ cardsDir: 'specs/tasks', shipPath: 'dry-run', worktreeRoot: path.join(fx.tmp, 'wt'), ...CONFIG }));
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000, windowsHide: true });
  return {
    fx, runner, ship, calls, verdicts, r2, during, goal, g, card, persisted, next, record, review, pre, amend, started, decide, bytes, events, seed, cli,
    changeCard: (delta: Partial<CardSpec>) => writeCard(fx, { ...SPEC, ...delta }),
    restoreCard: () => writeCard(fx, SPEC),
    outcomes: () => persisted().effort?.attempts.map((a) => a.outcome),
    lease: () => fx.leases.read(resourceKeys.card(fx.repo.key, CARD)),
    queued: () => fx.queue.list().map((q: Stored) => q['state']),
  };
}
type S = ReturnType<typeof setup>;
async function scenario(body: (s: S) => Promise<void> | void, config: Record<string, unknown> = {}) {
  const fx = makeFixture({ config: { ...CONFIG, ...config }, actor: { session: SESSION, pid: 1, processStart: T0, host: hostName() } });
  try { await body(setup(fx)); } finally { fx.cleanup(); }
}
const op = (status: string) => (s: S) => { const { id } = s.fx.ops.recordIntent({ kind: 'merge', goalId: s.goal.id, cardId: CARD, target: 'main', candidateDigest: 'sha-1', ownerGeneration: 0, timeoutMs: 60_000, effects: ['merge'] }, T0);
  if (status !== 'intended') s.fx.ops.markIssued(id, undefined, T0);
  if (status === 'running') s.fx.ops.markRunning(id, T0); else if (status === 'UNKNOWN') s.fx.ops.markResult(id, 'UNKNOWN', {}, T0); };
/** The directive kinds `next` returns on a passed candidate arranged by `arrange`, with the card unchanged and changed. */
async function kinds(arrange: (s: S) => void): Promise<unknown[]> {
  const out: unknown[] = [];
  for (const changed of [false, true]) {
    await scenario(async (s) => {
      s.started(); await s.decide('sha-1', PASS); arrange(s);
      if (changed) s.changeCard(REQUIREMENTS);
      out.push(s.next()['kind']);
    });
  }
  return out;
}

test('1 [R1] [R2] [R4] [R6] BUILD with an attempt running: next and recordAttempt of every outcome refuse with one message, write nothing and renew no lease; two changed fields in contract order', async () => {
  await scenario((s) => {
    s.started();
    assert.deepEqual(s.outcomes(), ['running']);
    s.changeCard(REQUIREMENTS);
    const held = s.bytes();
    s.fx.advance(60_000);
    const lease = s.lease();
    assert.throws(() => s.next(), refusal(['requirements']), 'next');
    assert.deepEqual(s.bytes(), held, 'next');
    assert.deepEqual(s.lease(), lease, 'the card lease is not renewed');
    for (const outcome of ['success', 'fail', 'not-counted'] as const) {
      assert.throws(() => s.record(outcome), refusal(['requirements']), outcome);
      assert.deepEqual(s.bytes(), held, outcome);
    }
    s.changeCard(BOTH);
    assert.throws(() => s.next(), refusal(['requirements', 'acceptance']), 'next, two fields');
    assert.deepEqual(s.bytes(), held, 'two fields');
  });
  // R2: the gate comes after the delivery of the owed events of the record recordAttempt reads.
  await scenario((s) => {
    s.started();
    s.seed((r) => { r['journalOwed'] = [{ key: 'owed-gate', type: 'NOTE', generation: s.g().generation, data: { note: 'owed before the gate', eventKey: 'owed-gate' } }]; });
    s.changeCard(REQUIREMENTS);
    assert.throws(() => s.record('success'), refusal(['requirements']), 'recordAttempt');
    assert.deepEqual(s.events('NOTE').filter((e) => e['data']['eventKey'] === 'owed-gate').map((e) => e['data']['completed']), [true], 'the owed event is delivered before the refusal');
    assert.deepEqual(s.outcomes(), ['running']);
  });
});

test('2 [R4] REVIEW_FIX after an R3 block: next refuses, the attempts are as they were and nothing is written', () => scenario(async (s) => {
  s.started();
  await s.decide('sha-1', block('no RED'));
  assert.deepEqual([s.persisted().state, s.persisted().review.substantiveDecisions], ['REVIEW_FIX', 1]);
  s.changeCard(REQUIREMENTS);
  const [held, attempts] = [s.bytes(), s.persisted().effort!.attempts];
  assert.throws(() => s.next(), refusal(['requirements']));
  assert.deepEqual(s.persisted().effort!.attempts, attempts);
  assert.deepEqual(s.bytes(), held);
}));

test('3 [R3] [R4] SHIP: next, formalReview and preReview refuse before any reservation, request, reviewer or ship, and write nothing', async () => {
  await scenario(async (s) => {
    s.started(); s.record('success');
    assert.equal(s.persisted().state, 'BUILD');
    s.changeCard(REQUIREMENTS);
    const [held, states] = [s.bytes(), s.events('CARD_STATE').length];
    assert.throws(() => s.next(), refusal(['requirements']), 'next');
    assert.equal(s.events('CARD_STATE').length, states);
    assert.deepEqual(s.bytes(), held, 'next');
    s.verdicts.push(PASS);
    await assert.rejects(s.review(), refusal(['requirements']), 'formalReview');
    assert.deepEqual([s.persisted().review.invocations.length, s.calls.r3, s.queued()], [0, 0, []]);
    assert.deepEqual(s.bytes(), held, 'formalReview');
  });
  await scenario(async (s) => {
    s.started(); await s.decide('sha-1', PASS);
    s.changeCard(REQUIREMENTS);
    const held = s.bytes();
    assert.throws(() => s.next(), refusal(['requirements']), 'next after the pass');
    assert.deepEqual([s.ship.requests.length, s.fx.ops.list({ cardId: CARD }).length], [0, 0]);
    assert.deepEqual(s.bytes(), held, 'next after the pass');
  });
  await scenario(async (s) => {
    s.started(); s.record('success');
    assert.equal(s.next()['kind'], 'pre-review');
    s.changeCard(REQUIREMENTS);
    const held = s.bytes();
    s.r2.push(PASS);
    await assert.rejects(s.pre(), refusal(['requirements']), 'preReview');
    assert.deepEqual([s.persisted().preReview.rounds.length, s.calls.r2], [0, 0]);
    assert.deepEqual(s.bytes(), held, 'preReview');
  }, PRE);
});

test('4 [R1] [R2] [R3] [R4] [R7] where amendCard refuses, the gate refuses all the same and the restored card text is the way on', async () => {
  // A pending repair.
  await scenario(async (s) => {
    s.started(); s.record('success');
    s.runner.withdrawCandidate(s.g(), s.card(), s.persisted(), 'a defect found before review');
    s.changeCard(REQUIREMENTS);
    assert.throws(() => s.amend(), /a withdrawn repair is pending/);
    const held = s.bytes();
    assert.throws(() => s.next(), refusal(['requirements']), 'next');
    assert.throws(() => s.record('success', 'sha-2'), refusal(['requirements']), 'recordAttempt');
    assert.deepEqual(s.bytes(), held);
    s.restoreCard();
    assert.equal(s.next()['kind'], 'build');
    assert.doesNotThrow(() => s.record('success', 'sha-2'));
    assert.deepEqual([s.persisted().pendingRepair, s.persisted().candidate?.sha], [undefined, 'sha-2']);
    s.changeCard(REQUIREMENTS);
    assert.throws(() => s.next(), refusal(['requirements']));
    assert.doesNotThrow(() => s.amend());
    assert.deepEqual(s.persisted().amendments.map((a) => a.changed), [['requirements']]);
    assert.equal(s.next()['kind'], 'review', 'next after the amendment');
  });
  // A merge intent recorded and not dispatched.
  await scenario(async (s) => {
    s.started(); await s.decide('sha-1', PASS); op('intended')(s);
    s.changeCard(REQUIREMENTS);
    assert.throws(() => s.amend(), /unresolved/);
    const held = s.bytes();
    assert.throws(() => s.next(), refusal(['requirements']), 'next');
    assert.deepEqual([s.bytes(), s.ship.requests.length], [held, 0]);
    s.restoreCard();
    assert.deepEqual([s.next()['kind'], s.ship.requests.length], ['close', 1], 'next ships with the card text restored');
  });
  // A formal review in flight.
  await scenario(async (s) => {
    s.started(); await s.decide('sha-1', PASS);
    s.seed((r) => { r['review'].invocations.push({ ...r['review'].invocations[0], invocationId: 'inv-pending', outcome: 'pending' }); });
    s.changeCard(REQUIREMENTS);
    assert.throws(() => s.amend(), /a formal review of this card is in flight \(candidate sha-1, inv-pending/);
    const held = s.bytes();
    assert.throws(() => s.next(), refusal(['requirements']), 'next');
    assert.deepEqual(s.bytes(), held, 'next');
    s.verdicts.push(PASS);
    await assert.rejects(s.review(), refusal(['requirements']), 'formalReview');
    assert.deepEqual([s.bytes(), s.calls.r3], [held, 1], 'formalReview writes nothing and runs no reviewer');
    s.restoreCard();
    assert.equal(s.next()['kind'], 'review', 'next with the card text restored');
  });
});

test('5 [R1] no contract, mergeVerified or DONE: next returns what it returns for the unchanged card, and with no contract an attempt is recorded', async () => {
  const rows: Array<[string, (s: S) => void]> = [
    ['no contract', (s) => s.seed((r) => { delete r['contract']; })],
    ['mergeVerified', (s) => s.seed((r) => { r['mergeVerified'] = true; })],
    ['DONE', (s) => s.seed((r) => { r['state'] = 'DONE'; })],
  ];
  for (const [name, arrange] of rows) {
    assert.deepEqual(await kinds(arrange), ['close', 'close'], name);
  }
  for (const changed of [false, true]) {
    await scenario((s) => {
      s.started(); s.seed((r) => { delete r['contract']; });
      if (changed) s.changeCard(REQUIREMENTS);
      assert.doesNotThrow(() => s.record('success'), `no contract, changed ${changed}`);
      assert.deepEqual(s.outcomes(), ['success']);
    });
  }
});

test('6 [R2] [R3] [R4] PREPARE, WAIT and STOP return as for the unchanged card; the reviews keep their own refusal of a stopped run and of no reviewer', async () => {
  await scenario((s) => {
    const created = s.fx.controller.ensureCardRun(s.g(), CARD);
    assert.ok(created.contract, 'the created run holds a contract');
    s.changeCard(REQUIREMENTS);
    assert.equal((s.runner.next(s.g(), s.card(), created).directive as Stored)['kind'], 'prepare');
    assert.throws(() => s.next(), refusal(['requirements']), 'the BUILD after the prepare');
  });
  for (const status of ['issued', 'running', 'UNKNOWN']) {
    assert.deepEqual(await kinds(op(status)), ['wait', 'wait'], `operation ${status}`);
  }
  await scenario(async (s) => {
    s.started();
    for (const n of [1, 2, 3, 4]) {
      s.record('success', `sha-${n}`);
      assert.equal(s.next()['kind'], 'pre-review'); s.r2.push(PASS); await s.pre();
      assert.equal(s.next()['kind'], 'review'); s.verdicts.push(block(`finding ${n}`)); await s.review();
    }
    assert.equal(s.next()['kind'], 'stop');
    const stop = s.persisted().stop;
    assert.equal(stop?.reason, 'review');
    s.changeCard(REQUIREMENTS);
    const held = s.bytes();
    await assert.rejects(s.review(), /card run is stopped \(review\)/, 'formalReview');
    await assert.rejects(s.pre(), /card run is stopped \(review\)/, 'preReview');
    assert.throws(() => s.record('success', 'sha-5'), refusal(['requirements']), 'recordAttempt');
    assert.deepEqual([s.calls.r3, s.calls.r2, s.bytes()], [4, 4, held]);
    assert.deepEqual([s.next()['kind'], s.next()['stop']], ['stop', stop]);
    s.runner.continueStop(s.g(), s.card(), { by: BY, reason: 'one more decision' });
    assert.throws(() => s.next(), refusal(['requirements']), 'the dispatch after the continuation');
    await assert.rejects(s.review(), refusal(['requirements']), 'formalReview after the continuation');
  }, PRE);
  await scenario(async (s) => {
    s.started(); s.record('success');
    s.changeCard(REQUIREMENTS);
    await assert.rejects(s.pre(), /preReview\.command is not configured/);
  });
});

test('7 [R7] after the amendment or with the card text restored the refused calls proceed', async () => {
  await scenario((s) => {
    s.started();
    s.changeCard(REQUIREMENTS);
    assert.throws(() => s.next(), refusal(['requirements']));
    s.amend();
    assert.equal(s.next()['kind'], 'build');
    assert.doesNotThrow(() => s.record('success'));
    assert.deepEqual(s.outcomes(), ['success']);
    s.changeCard(BOTH);
    assert.throws(() => s.next(), refusal(['acceptance']), 'the second change');
  });
  await scenario((s) => {
    s.started();
    s.changeCard(REQUIREMENTS);
    assert.throws(() => s.next(), refusal(['requirements']));
    s.restoreCard();
    assert.deepEqual([s.next()['kind'], s.persisted().amendments], ['build', []]);
  });
  await scenario(async (s) => {
    s.started(); await s.decide('sha-1', PASS);
    s.changeCard(REQUIREMENTS);
    assert.throws(() => s.next(), refusal(['requirements']));
    s.amend();
    assert.equal(s.next()['kind'], 'review');
    s.verdicts.push(PASS);
    await assert.doesNotReject(s.review());
    assert.deepEqual(s.persisted().review.invocations.map((i) => i.outcome), ['pass', 'pass'], 'formalReview records a decision');
  });
});

test('8 [R6] aidlc card next exits 1 with the message on standard error and writes nothing', () => scenario((s) => {
  s.started();
  s.changeCard(REQUIREMENTS);
  const held = s.bytes();
  const r = s.cli('card', 'next', CARD);
  assert.deepEqual([r.status, r.stderr], [1, `aidlc: ${message(['requirements'])}\n`]);
  assert.deepEqual(s.bytes(), held);
}));

test('9 [R4] [R5] an amendment recorded during the call, which holds the card it read before, refuses the selection, the reservation or the ship', async () => {
  const amendBudget = (s: S) => { s.changeCard(BUDGET); s.runner.amendCard(s.g(), s.fx.card(CARD), { by: BY, reason: 'budget raised' }); };
  // next: between the first read of the dispatch and the state selection.
  await scenario((s) => {
    s.started();
    const [g, card, caller] = [s.g(), s.card(), s.persisted()];
    const realGet = s.fx.store.getCardRun.bind(s.fx.store);
    let reads = 0;
    s.fx.store.getCardRun = (goalId: string, cardId: string) => { const value = realGet(goalId, cardId); reads += 1; if (reads === 1) { s.fx.store.getCardRun = realGet; amendBudget(s); } return value; };
    let journal = '';
    try {
      assert.throws(() => { try { s.runner.next(g, card, caller); } finally { journal = s.bytes()[1]!; } }, refusal(['budget']));
    } finally { s.fx.store.getCardRun = realGet; }
    assert.equal(s.persisted().amendments.length, 1, 'the amendment landed during the call');
    assert.deepEqual(s.outcomes(), ['running'], 'no attempt is started');
    assert.deepEqual(journal.trim().split('\n').slice(-2).map((l) => JSON.parse(l)['type']), ['ATTEMPT_STARTED', 'NOTE'], 'no event after the amendment');
    assert.equal(s.next()['kind'], 'build');
  });
  // formalReview: while the diff is collected.
  await scenario(async (s) => {
    s.started(); s.record('success');
    assert.equal(s.next()['kind'], 'review');
    s.during.diff = () => amendBudget(s);
    s.verdicts.push(PASS);
    const lines = s.bytes()[1]!.trim().split('\n').length;
    await assert.rejects(s.review(), amended(['budget']));
    assert.deepEqual([s.persisted().review.invocations.length, s.calls.r3], [0, 0]);
    assert.deepEqual(s.bytes()[1]!.trim().split('\n').slice(lines).map((l) => JSON.parse(l)['type']), ['NOTE', 'REVIEW_ADMITTED'], 'the amendment, then the admission');
    assert.deepEqual(s.queued(), ['cancelled'], 'the pool request is cancelled');
    s.verdicts.length = 0; s.verdicts.push(PASS);
    await assert.doesNotReject(s.review());
    assert.deepEqual(s.persisted().review.invocations.map((i) => i.outcome), ['pass'], 'the call made again records a decision');
  });
  // preReview: while the diff is collected.
  await scenario(async (s) => {
    s.started(); s.record('success');
    assert.equal(s.next()['kind'], 'pre-review');
    s.during.diff = () => amendBudget(s);
    s.r2.push(PASS);
    const held = s.bytes()[1]!.trim().split('\n').length;
    await assert.rejects(s.pre(), amended(['budget']));
    assert.deepEqual([s.persisted().preReview.rounds.length, s.calls.r2], [0, 0]);
    assert.deepEqual(s.bytes()[1]!.trim().split('\n').slice(held).map((l) => JSON.parse(l)['type']), ['NOTE'], 'only the amendment is journaled');
  }, PRE);
  // The ship: before its intent is recorded.
  await scenario(async (s) => {
    s.started(); await s.decide('sha-1', PASS);
    const [g, card, caller] = [s.g(), s.card(), s.persisted()];
    const realFind = s.fx.ops.findDuplicate.bind(s.fx.ops);
    s.fx.ops.findDuplicate = (...args: Parameters<typeof realFind>) => { s.fx.ops.findDuplicate = realFind; amendBudget(s); return realFind(...args); };
    let directive: Stored;
    try { directive = s.runner.next(g, card, caller).directive as Stored; } finally { s.fx.ops.findDuplicate = realFind; }
    assert.deepEqual([directive['kind'], directive['on'], directive['narration']], ['wait', 'record-changed', `The card run changed after the ship gate (the contract of the card was amended meanwhile (budget)); nothing was dispatched. Run \`aidlc card next ${CARD}\` again.`]);
    assert.deepEqual([s.ship.requests.length, s.fx.ops.list({ cardId: CARD }).map((o) => o.status), s.queued()], [0, ['cancelled'], ['completed', 'cancelled']]);
    assert.deepEqual([s.next()['kind'], s.ship.requests.length], ['close', 1], 'next made again ships');
  });
});
