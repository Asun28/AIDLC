/**
 * Card T0-JOURNAL-FAULT-EVENTS: the attempt, R2, R3 and merge-result events of a card run are journaled only after the
 * record write that commits the decision, and once; that write records the event on the run as owed (`journalOwed`), and
 * the next `card next`, `card attempt`, `review pre` or `review r3` appends an owed event the journal does not hold.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs, { mkdirSync, readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { GitHubShipPath } from '../../src/delivery/github-ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { CardRun, type Card, type Goal, type JournalEvent } from '../../src/core/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARD = 'T1-JO';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const BLOCK = '{"verdict":"block","reasons":["[spec] 6 tests @ src/t1-jo.ts:1: no RED -> add a failing test"],"axes":{"spec":{"verdict":"block","reasons":["tests"]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const R1_TYPES = ['ATTEMPT_STARTED', 'ATTEMPT_FINISHED', 'PRE_REVIEW_DECIDED', 'REVIEW_DECIDED', 'OPERATION_RESULT'];

interface Owed {
  key: string;
  type: string;
  generation: number;
  data: Record<string, unknown>;
}

interface Ctx {
  fx: Fixture;
  runner: CardRunner;
  goalId: string;
  card: Card;
  g: () => Goal;
  run: () => CardRun;
  cardFile: string;
  /** Reviewer runs so far, counted at the scripted runner. */
  spawned: { r2: number; r3: number };
}

/** The fixture of tests/scenarios/fault-points.test.ts, left after PREPARE (the next `card next` opens attempt 1). */
function prepared(r3 = PASS): Ctx {
  const fx = makeFixture({
    config: {
      gateRequired: true,
      preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'stop', shell: false },
      formalReview: { command: ['fake-p', '--schema', '{schema}', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false },
    },
  });
  const spawned = { r2: 0, r3: 0 };
  const runner = scriptedRunner({
    'git diff --numstat': { stdout: '0\t0\tsrc/t1-jo.ts\n' },
    'git diff --name-only': { stdout: 'src/t1-jo.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t1-jo.ts b/src/t1-jo.ts\n+export const jo = 1;\n' },
    'fake-r2': () => (spawned.r2++, { stdout: PASS }),
    'fake-p': () => (spawned.r3++, { stdout: r3 }),
  });
  writeCard(fx, { id: CARD, title: 'journal owed', allowPaths: ['src/t1-jo.ts'] });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const cardRunner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner });
  const g = () => fx.goal(goalId);
  const r = cardRunner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  return { fx, runner: cardRunner, goalId, card, g, run: () => fx.store.getCardRun(goalId, CARD)!, cardFile: path.resolve(fx.paths.cards, goalId, `${CARD}.json`), spawned };
}

const next = (c: Ctx) => c.runner.next(c.g(), c.card, c.run());
/** The finished attempt's event data as `card attempt` records it, every field set. */
const FINISHED = { outcome: 'success', cause: 'none left', progress: true, evidence: 'dod 21/21' } as const;
const attempt = (c: Ctx): CardRun => c.runner.recordAttempt(c.g(), c.card, c.run(), { ...FINISHED, dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-jo' });
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * A card at SHIP whose next `card next` merges on the GitHub ship path and reads the merge's ShippedFacts from gh and git
 * (the setup of T1-AUDIT-FACTS-2 acceptance 1 in tests/scenarios/t0-flow.test.ts): PR 42, head a..a, merge b..b, tree c..c.
 */
function shipWithFacts(): Ctx {
  const [HEAD, MERGE, TREE] = ['a', 'b', 'c'].map((ch) => ch.repeat(40)) as [string, string, string];
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'journal owed facts' });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const g = () => fx.goal(goalId);
  const dry = fx.runner();
  let r = dry.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  r = dry.next(g(), card, r.run);
  dry.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: HEAD });
  mkdirSync(path.join(fx.config.worktreeRoot, CARD, '.review'), { recursive: true });
  let merged = false;
  const script = scriptedRunner({
    'gh api user -q .login': { stdout: 'alice\n' },
    'git add -A': {},
    'git diff --cached --quiet': {},
    'git rev-parse --verify HEAD': { stdout: `${HEAD}\n` },
    'git fetch': {},
    'git rev-parse --verify --quiet refs/remotes/origin/main^{commit}': { stdout: `${'d'.repeat(40)}\n` },
    'git merge-tree --write-tree HEAD': { stdout: `${'f'.repeat(40)}\n` },
    'git push': {},
    'gh pr list': { stdout: '[]' },
    'gh pr create': { stdout: 'https://github.com/o/r/pull/42\n' },
    'gh api repos/o/r/commits': { stdout: JSON.stringify({ check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }) },
    'gh pr merge': () => ((merged = true), {}),
    'gh pr view 42 --repo o/r --json': () => ({ stdout: JSON.stringify({ number: 42, state: 'MERGED', headRefOid: HEAD, baseRefName: 'main', mergeCommit: merged ? { oid: MERGE } : null }) }),
    [`git rev-parse ${MERGE}^{tree}`]: { stdout: `${TREE}\n` },
  });
  const github = { requiredChecks: ['ci'], requireVerdict: false, ciTimeoutMs: 0, ciPollMs: 1 };
  const ship = new GitHubShipPath({ mainRoot: fx.tmp, worktreeRoot: fx.config.worktreeRoot, repository: 'o/r', runner: script, ...github, sleep: () => {} });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, shipPath: 'github', repository: 'o/r', github }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  return { fx, runner, goalId, card, g, run: () => fx.store.getCardRun(goalId, CARD)!, cardFile: path.resolve(fx.paths.cards, goalId, `${CARD}.json`), spawned: { r2: 0, r3: 0 } };
}
const preReview = (c: Ctx) => c.runner.preReview(c.g(), c.card, c.run());
const formalReview = (c: Ctx) => c.runner.formalReview(c.g(), c.card, c.run());

/** Attempt 1 running, as `card next` leaves it at BUILD. */
function atBuild(r3 = PASS): Ctx {
  const c = prepared(r3);
  assert.equal(next(c).directive.kind, 'build');
  return c;
}

/** At SHIP with an R2 pass, before `review r3`. */
async function atReview(r3 = PASS): Promise<Ctx> {
  const c = atBuild(r3);
  attempt(c);
  assert.equal(next(c).directive.kind, 'pre-review');
  await preReview(c);
  assert.equal(next(c).directive.kind, 'review');
  return c;
}

const events = (c: Ctx): JournalEvent[] => c.fx.events(c.goalId);
const ofType = (c: Ctx, type: string): JournalEvent[] => events(c).filter((e) => e.type === type);
const owedOf = (run: CardRun | Record<string, unknown>): Owed[] => (run as { journalOwed?: Owed[] }).journalOwed ?? [];

type Fault = { call: 'appendFileSync'; event: string } | { call: 'renameSync' };

/**
 * Run `body` with the first `fs.appendFileSync` of a journal line of `event`, or the first `fs.renameSync` onto the card-run
 * record, throwing an injected error (patched on the `node:fs` export, that one call only, restored in a finally).
 */
async function faulted(c: Ctx, fault: Fault, body: () => unknown): Promise<{ error: unknown; injected: Error }> {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target[fault.call]!;
  const injected = Object.assign(new Error(`EIO: injected ${fault.call}`), { code: 'EIO' });
  let fired = false;
  target[fault.call] = (...args: unknown[]) => {
    const hit = fault.call === 'renameSync' ? path.resolve(String(args[1])) === c.cardFile : String(args[0]).endsWith('.jsonl') && String(args[1]).includes(`"type":"${fault.event}"`);
    if (hit && !fired) {
      fired = true;
      throw injected;
    }
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    await body();
    return { error: undefined, injected };
  } catch (error) {
    return { error, injected };
  } finally {
    target[fault.call] = real;
    syncBuiltinESMExports();
  }
}

describe('T0-JOURNAL-FAULT-EVENTS: covered decision events follow their record write and reach the journal once', () => {
  it('a lost ATTEMPT_FINISHED append leaves the finished attempt and the owed event; the next card next appends it once, completed [acceptance 1]', async () => {
    const c = atBuild();
    const { error, injected } = await faulted(c, { call: 'appendFileSync', event: 'ATTEMPT_FINISHED' }, () => attempt(c));
    assert.equal(error, injected);
    const run = c.run();
    assert.deepEqual(run.effort?.attempts.map((a) => [a.n, a.outcome]), [[1, 'success']]);
    const owed = owedOf(run);
    assert.deepEqual(owed.map((o) => o.type), ['ATTEMPT_FINISHED']);
    assert.equal(ofType(c, 'ATTEMPT_FINISHED').length, 0);
    assert.equal(next(c).directive.kind, 'pre-review');
    const finished = ofType(c, 'ATTEMPT_FINISHED');
    assert.equal(finished.length, 1);
    assert.deepEqual(finished[0]!.data, { outcome: 'success', cause: 'none left', progress: true, evidence: 'dod 21/21', eventKey: owed[0]!.key, completed: true });
    const count = events(c).length;
    assert.equal(next(c).directive.kind, 'pre-review');
    assert.equal(events(c).length, count);
  });

  it('a lost record write of card attempt journals no ATTEMPT_FINISHED; the retried attempt journals exactly one [acceptance 2]', async () => {
    const c = atBuild();
    const { error, injected } = await faulted(c, { call: 'renameSync' }, () => attempt(c));
    assert.equal(error, injected);
    assert.equal(ofType(c, 'ATTEMPT_FINISHED').length, 0);
    assert.equal(next(c).directive.kind, 'build');
    attempt(c);
    assert.deepEqual(ofType(c, 'ATTEMPT_FINISHED').map((e) => e.data['outcome']), ['success']);
  });

  it('a lost record write of the BUILD step journals no ATTEMPT_STARTED; the next card next journals exactly one [acceptance 2]', async () => {
    const c = prepared();
    const { error, injected } = await faulted(c, { call: 'renameSync' }, () => next(c));
    assert.equal(error, injected);
    assert.equal(ofType(c, 'ATTEMPT_STARTED').length, 0);
    assert.equal(next(c).directive.kind, 'build');
    assert.deepEqual(ofType(c, 'ATTEMPT_STARTED').map((e) => e.data['n']), [1]);
  });

  it('a lost record write of the REVIEW_FIX step after an R3 block journals exactly one ATTEMPT_STARTED for the repair [acceptance 2]', async () => {
    const c = await atReview(BLOCK);
    assert.equal((await formalReview(c)).classified.outcome, 'block-defect');
    assert.equal(c.run().state, 'REVIEW_FIX');
    const { error, injected } = await faulted(c, { call: 'renameSync' }, () => next(c));
    assert.equal(error, injected);
    assert.equal(ofType(c, 'ATTEMPT_STARTED').filter((e) => e.data['reason'] === 'review-fix').length, 0);
    assert.equal(next(c).directive.kind, 'build');
    assert.deepEqual(ofType(c, 'ATTEMPT_STARTED').filter((e) => e.data['reason'] === 'review-fix').map((e) => e.data['n']), [2]);
  });

  it('a lost PRE_REVIEW_DECIDED append is made once by the next card next, completed, with the lists of the commit [acceptance 3]', async () => {
    const c = atBuild();
    attempt(c);
    assert.equal(next(c).directive.kind, 'pre-review');
    const { error, injected } = await faulted(c, { call: 'appendFileSync', event: 'PRE_REVIEW_DECIDED' }, () => preReview(c));
    assert.equal(error, injected);
    assert.equal(ofType(c, 'PRE_REVIEW_DECIDED').length, 0);
    const owed = owedOf(c.run()).filter((o) => o.type === 'PRE_REVIEW_DECIDED');
    assert.equal(owed.length, 1);
    assert.equal(next(c).directive.kind, 'review');
    const decided = ofType(c, 'PRE_REVIEW_DECIDED');
    assert.equal(decided.length, 1);
    // Every field the commit wrote: literals, and the receipt fields from the round the ledger holds.
    const round = c.run().preReview.rounds.at(-1)!;
    assert.match(String(round.receiptSha256), HEX64);
    assert.deepEqual(decided[0]!.data, { cycle: 0, round: 1, reviewer: 'fake-r2', candidateDigest: 'sha-jo', outcome: 'pass', runStatus: 'success', reasons: [], advisory: [], findings: [], reraised: [], resolved: [], verdictRef: round.verdictRef, receiptSha256: round.receiptSha256, durationMs: 0, perspectives: ['review:pass'], policyHash: round.policyHash, eventKey: owed[0]!.key, completed: true });
  });

  it('a lost REVIEW_DECIDED append is made once by the next card next, completed, without publication fields [acceptance 3]', async () => {
    const c = await atReview();
    const { error, injected } = await faulted(c, { call: 'appendFileSync', event: 'REVIEW_DECIDED' }, () => formalReview(c));
    assert.equal(error, injected);
    assert.equal(ofType(c, 'REVIEW_DECIDED').length, 0);
    const owed = owedOf(c.run()).filter((o) => o.type === 'REVIEW_DECIDED');
    assert.equal(owed.length, 1);
    assert.equal(next(c).directive.kind, 'close');
    const decided = ofType(c, 'REVIEW_DECIDED');
    assert.equal(decided.length, 1);
    const { receiptSha256, ...d } = decided[0]!.data;
    const invocation = c.run().review.invocations.at(-1)!;
    assert.match(String(receiptSha256), HEX64);
    assert.match(invocation.invocationId, /^r3:T1-JO\.r3\.1\.[0-9a-f]{8}$/);
    // Every field the commit wrote: literals, the ids and refs from the invocation the ledger holds; no publication field.
    assert.deepEqual(d, { invocationId: invocation.invocationId, reviewer: 'primary', candidateDigest: 'sha-jo', outcome: 'pass', mergeBlocking: false, decision: 'proceed-merge', runStatus: 'success', reasons: [], advisory: [], findings: [], reraised: [], resolved: [], verdictRef: invocation.verdictRef, durationMs: 0, policyHash: invocation.policyHash, eventKey: owed[0]!.key, completed: true });
  });

  it('a lost merge OPERATION_RESULT append is made once by the next card next with the owed operation, status and facts, and completed [acceptance 4]', async () => {
    const c = shipWithFacts();
    const { error, injected } = await faulted(c, { call: 'appendFileSync', event: 'OPERATION_RESULT' }, () => next(c));
    assert.equal(error, injected);
    assert.equal(ofType(c, 'OPERATION_RESULT').length, 0);
    const op = c.fx.ops.list({ cardId: CARD })[0]!;
    assert.equal(op.status, 'succeeded');
    const facts = { headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mergeSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', tree: 'cccccccccccccccccccccccccccccccccccccccc', pr: 42 };
    assert.deepEqual(owedOf(c.run()).filter((o) => o.type === 'OPERATION_RESULT').map((o) => o.data), [{ operationId: op.id, status: 'succeeded', ...facts }]);
    assert.equal(next(c).directive.kind, 'close');
    assert.deepEqual(ofType(c, 'OPERATION_RESULT').map((e) => e.data), [{ operationId: op.id, status: 'succeeded', headSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', mergeSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', tree: 'cccccccccccccccccccccccccccccccccccccccc', pr: 42, completed: true }]);
    next(c);
    assert.equal(ofType(c, 'OPERATION_RESULT').length, 1);
  });

  it('an owed merge result is not appended while the operation stays issued, nor once OPERATION_RECONCILED names it [acceptance 4]', async () => {
    const c = await atReview();
    await formalReview(c);
    const realMark = c.fx.ops.markResult.bind(c.fx.ops);
    const injected = new Error('EIO: injected markResult');
    c.fx.ops.markResult = () => {
      c.fx.ops.markResult = realMark;
      throw injected;
    };
    assert.throws(() => next(c), (err) => err === injected);
    const op = c.fx.ops.list({ cardId: CARD })[0]!;
    assert.equal(c.fx.ops.get(op.id)?.status, 'issued');
    assert.deepEqual(owedOf(c.run()).filter((o) => o.type === 'OPERATION_RESULT').map((o) => o.data['status']), ['succeeded']);
    next(c);
    next(c);
    assert.equal(ofType(c, 'OPERATION_RESULT').length, 0);
    c.fx.ops.reconcile(op.id, () => ({ status: 'succeeded' }));
    c.fx.journal(c.goalId).append({ type: 'OPERATION_RECONCILED', goalId: c.goalId, cardId: CARD, data: { operationId: op.id, status: 'succeeded' } });
    next(c);
    next(c);
    assert.equal(ofType(c, 'OPERATION_RESULT').length, 0);
  });

  it('review pre appends an owed ATTEMPT_FINISHED before its round [acceptance 5]', async () => {
    const c = atBuild();
    await faulted(c, { call: 'appendFileSync', event: 'ATTEMPT_FINISHED' }, () => attempt(c));
    const key = owedOf(c.run())[0]!.key;
    const before = events(c).length;
    await preReview(c);
    const appended = events(c).slice(before);
    assert.deepEqual([appended[0]!.type, appended[0]!.data], ['ATTEMPT_FINISHED', { outcome: 'success', cause: 'none left', progress: true, evidence: 'dod 21/21', eventKey: key, completed: true }]);
    const decided = appended.find((e) => e.type === 'PRE_REVIEW_DECIDED');
    assert.ok(decided && decided.seq > appended[0]!.seq);
  });

  it('a commit keeps an owed entry the journal does not hold beside its own [acceptance 5]', () => {
    const c = atBuild();
    const foreign: Owed = { key: 'k-foreign', type: 'OPERATION_RESULT', generation: c.g().generation, data: { operationId: 'op-none', status: 'succeeded' } };
    c.fx.store.updateCardRun(c.goalId, CARD, (current) => ({ ...current!, journalOwed: [foreign] }) as CardRun);
    attempt(c);
    const owed = owedOf(c.run());
    assert.deepEqual(owed.map((o) => o.type), ['OPERATION_RESULT', 'ATTEMPT_FINISHED']);
    assert.deepEqual(owed[0], foreign);
    assert.equal(ofType(c, 'OPERATION_RESULT').length, 0);
  });

  /** Each of the four commands on a run holding an owed event the journal lacks, left by a lost append of `event`. */
  const owing: Array<{ command: string; event: string; setup: () => Promise<Ctx>; run: (c: Ctx) => unknown }> = [
    { command: 'card next', event: 'ATTEMPT_FINISHED', setup: async () => { const c = atBuild(); await faulted(c, { call: 'appendFileSync', event: 'ATTEMPT_FINISHED' }, () => attempt(c)); return c; }, run: next },
    { command: 'card attempt', event: 'ATTEMPT_STARTED', setup: async () => { const c = prepared(); await faulted(c, { call: 'appendFileSync', event: 'ATTEMPT_STARTED' }, () => next(c)); return c; }, run: attempt },
    { command: 'review pre', event: 'ATTEMPT_FINISHED', setup: async () => { const c = atBuild(); await faulted(c, { call: 'appendFileSync', event: 'ATTEMPT_FINISHED' }, () => attempt(c)); return c; }, run: preReview },
    { command: 'review r3', event: 'PRE_REVIEW_DECIDED', setup: async () => { const c = atBuild(); attempt(c); next(c); await faulted(c, { call: 'appendFileSync', event: 'PRE_REVIEW_DECIDED' }, () => preReview(c)); return c; }, run: formalReview },
  ];
  for (const o of owing) {
    it(`a ${o.command} whose owed ${o.event} append throws rejects with that error, runs no reviewer and leaves the card run and the journal unchanged [acceptance 5] [R4]`, async () => {
      const c = await o.setup();
      assert.equal(owedOf(c.run()).filter((e) => e.type === o.event).length, 1);
      const before = c.run();
      const count = events(c).length;
      const spawned = { ...c.spawned };
      const { error, injected } = await faulted(c, { call: 'appendFileSync', event: o.event }, () => o.run(c));
      assert.equal(error, injected);
      assert.deepEqual(c.run(), before);
      assert.equal(events(c).length, count);
      assert.deepEqual(c.spawned, spawned);
    });
  }

  it('a card run without journalOwed parses unchanged, and card next on it appends only the events of its step [acceptance 6]', () => {
    const c = prepared();
    const raw = JSON.parse(readFileSync(c.cardFile, 'utf8')) as Record<string, unknown>;
    assert.equal('journalOwed' in raw, false);
    assert.deepEqual(CardRun.parse(raw), raw);
    const before = events(c).length;
    assert.equal(next(c).directive.kind, 'build');
    assert.deepEqual(events(c).slice(before).filter((e) => R1_TYPES.includes(e.type)).map((e) => [e.type, e.data['n']]), [['ATTEMPT_STARTED', 1]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Doc text (acceptance 8): each sentence and the phrase in its place, and removing any one fails the check.
// ---------------------------------------------------------------------------------------------------------------------

const lf = (file: string): string => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

const OPERATIONS_SENTENCES = [
  'The card runner journals `ATTEMPT_STARTED`, `ATTEMPT_FINISHED`, `PRE_REVIEW_DECIDED`, `REVIEW_DECIDED` and the merge `OPERATION_RESULT` only after the card-run write that commits the decision, and once (card T0-JOURNAL-FAULT-EVENTS): that write records the event on the run as owed, the command appends it after the write, and an append that did not land is made, marked `completed: true`, by the next `card next`, `card attempt`, `review pre` or `review r3` on the card.',
  'A merge result is appended only while the operation ledger shows that result, and never once `aidlc ops reconcile` has journaled `OPERATION_RECONCILED` for the operation.',
];
const ARCHITECTURE_SENTENCE = 'The card runner appends an attempt, R2, R3 or merge-result event only after the card-run write that commits its decision, which records the event as owed (`CardRun.journalOwed`); an append that did not land is made by the next card-run command on the card, so each such event reaches the journal once and never ahead of its record (card T0-JOURNAL-FAULT-EVENTS).';
const ARCHITECTURE_PHRASE = 'the decision events still owed to the journal (`journalOwed`)';
const CHANGELOG_SENTENCES = [
  '- T0-JOURNAL-FAULT-EVENTS (bugfix): the attempt, R2, R3 and merge-result events of a card run are journaled only after the record write that commits the decision, and once: the write records the event on the card run as owed (`CardRun.journalOwed`), and an append that did not land is made, marked `completed: true`, by the next `card next`, `card attempt`, `review pre` or `review r3` on the card.',
  'Before, a failed record write after `ATTEMPT_STARTED` or `ATTEMPT_FINISHED` journaled the attempt event twice, and a failed append after an R2, R3 or merge commit lost the event for good, which also hid a shipped card from `aidlc audit verify --claim-full`.',
];

const section = (doc: string, heading: string): string => {
  const start = doc.indexOf(`\n${heading}\n`);
  if (start < 0) return '';
  const end = doc.indexOf('\n## ', start + heading.length + 2);
  return doc.slice(start, end < 0 ? undefined : end);
};

interface DocPin {
  name: string;
  file: string;
  text: string;
  holds: (doc: string, text: string) => boolean;
}

/** OPERATIONS, Audit: after the paragraph that lists the `verify` findings. */
const inAudit = (doc: string, text: string): boolean => {
  const audit = section(doc, '## Audit');
  const findings = audit.indexOf('`verify` reports the level');
  return findings >= 0 && audit.indexOf(text) > audit.indexOf('\n\n', findings);
};
/** ARCHITECTURE, Evidence and audit chain: the end of item 1. */
const endOfItem1 = (doc: string, text: string): boolean => (section(doc, '## Evidence and audit chain').split('\n').find((l) => l.startsWith('1. ')) ?? '').endsWith(` ${text}`);
/** ARCHITECTURE, Persisted state: the card-run row, after the run revision. */
const inCardRow = (doc: string, text: string): boolean => {
  const row = doc.split('\n').find((l) => l.startsWith('| `cards/<goalId>/<cardId>.json` |')) ?? '';
  return row.includes(`the run revision (compare-and-set for snapshot writes), ${text}`);
};
const inUnreleased = (doc: string, text: string): boolean => section(doc, '## Unreleased').includes(text);

const DOC_PINS: DocPin[] = [
  ...OPERATIONS_SENTENCES.map((text, n) => ({ name: `OPERATIONS sentence ${n + 1}`, file: 'docs/OPERATIONS.md', text, holds: inAudit })),
  { name: 'ARCHITECTURE sentence', file: 'docs/ARCHITECTURE.md', text: ARCHITECTURE_SENTENCE, holds: endOfItem1 },
  { name: 'ARCHITECTURE phrase', file: 'docs/ARCHITECTURE.md', text: ARCHITECTURE_PHRASE, holds: inCardRow },
  ...CHANGELOG_SENTENCES.map((text, n) => ({ name: `CHANGELOG sentence ${n + 1}`, file: 'CHANGELOG.md', text, holds: inUnreleased })),
];

describe('T0-JOURNAL-FAULT-EVENTS doc text [acceptance 8]', () => {
  for (const pin of DOC_PINS) {
    it(`${pin.file} carries the ${pin.name} in its place, and removing it fails the check`, () => {
      const doc = lf(pin.file);
      assert.ok(pin.holds(doc, pin.text), `${pin.file}: ${pin.text}`);
      assert.equal(pin.holds(doc.replace(pin.text, ''), pin.text), false);
    });
  }
});
