/**
 * Card T0-OP-INTENT-DUP: a ship of `card next` (`CardRunner.ship`) that failed after recording its merge intent leaves
 * that intent to the next ship of the same candidate, which continues under it instead of recording a second one. Faults
 * are thrown from `fs.appendFileSync`, patched on the `node:fs` export, the boundary every journal append passes through.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs, { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorB, goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner, type CardDirective } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { reviewRequestKey } from '../../src/core/review-policy.ts';
import type { OperationIntent } from '../../src/coordination/reconcile.ts';
import { verifyAudit } from '../../src/audit/verifier.ts';
import type { Card, CardRun, Goal, OperationRecord } from '../../src/core/types.ts';

const CARD = 'T0-OID';
const DIGEST = 'sha-oid';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const faultMessage = (type: string): string => `EIO: injected fault, appendFileSync ${type}`;

interface Ctx {
  fx: Fixture;
  runner: CardRunner;
  ship: DryRunShipPath;
  goalId: string;
  card: Card;
  g: () => Goal;
  run: () => CardRun;
}

/** The config of the fault-point test: gateRequired, `fake-r2` with one round, `fake-p` as the formal reviewer `primary`, the dry-run ship. */
function open(): Ctx {
  const fx = makeFixture({
    config: {
      gateRequired: true,
      preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'stop', shell: false },
      formalReview: { command: ['fake-p', '--schema', '{schema}', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false },
    },
  });
  const runner = scriptedRunner({
    'git diff --numstat': { stdout: '0\t0\tsrc/t0-oid.ts\n' },
    'git diff --name-only': { stdout: 'src/t0-oid.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t0-oid.ts b/src/t0-oid.ts\n+export const oid = 1;\n' },
    'fake-r2': () => ({ stdout: PASS }),
    'fake-p': () => ({ stdout: PASS }),
  });
  const ship = new DryRunShipPath(['merged']);
  writeCard(fx, { id: CARD, title: 'op intent dup', allowPaths: ['src/t0-oid.ts'] });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const cardRunner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner });
  const g = () => fx.goal(goalId);
  let r = cardRunner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  r = cardRunner.next(g(), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  return { fx, runner: cardRunner, ship, goalId, card, g, run: () => fx.store.getCardRun(goalId, CARD)! };
}

const next = (c: Ctx): { run: CardRun; directive: CardDirective } => c.runner.next(c.g(), c.card, c.run());

/** The card at SHIP after its R2 and R3 passes, with nothing shipped and no operation recorded. */
async function atShip(): Promise<Ctx> {
  const c = open();
  c.runner.recordAttempt(c.g(), c.card, c.run(), { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: DIGEST });
  assert.equal(next(c).directive.kind, 'pre-review');
  await c.runner.preReview(c.g(), c.card, c.run());
  assert.equal(next(c).directive.kind, 'review');
  assert.equal((await c.runner.formalReview(c.g(), c.card, c.run())).classified.outcome, 'pass');
  assert.equal(c.run().candidate?.digest, DIGEST);
  assert.equal(c.run().ownerGeneration, 0);
  assert.deepEqual(c.fx.ops.list({}), []);
  return c;
}

const within = (dir: string, file: string): boolean => {
  const rel = path.relative(dir, path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Run `body` with the first goal-journal append of an event of `type` throwing; `fs.appendFileSync` is restored in a finally. */
function withAppendFault<T>(c: Ctx, type: string, body: () => T): T {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['appendFileSync']!;
  let thrown = false;
  target['appendFileSync'] = (...args: unknown[]) => {
    if (!thrown && within(c.fx.paths.journal, String(args[0]))) {
      let line: string | undefined;
      try {
        line = (JSON.parse(String(args[1])) as { type?: string }).type;
      } catch {
        /* not a journal line */
      }
      if (line === type) {
        thrown = true;
        throw Object.assign(new Error(faultMessage(type)), { code: 'EIO' });
      }
    }
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    return body();
  } finally {
    target['appendFileSync'] = real;
    syncBuiltinESMExports();
  }
}

/** The card's merge operations as `[id, status]`, in ledger order. */
const merges = (c: Ctx): Array<[string, string]> => c.fx.ops.list({ goalId: c.goalId, cardId: CARD, kind: 'merge' }).map((o): [string, string] => [o.id, o.status]);
/** The operation ids the goal journal's `OPERATION_INTENT` events name, in journal order. */
const intentEvents = (c: Ctx): string[] => c.fx.events(c.goalId).filter((e) => e.type === 'OPERATION_INTENT').map((e) => String(e.data['operationId']));
const opCodes = (c: Ctx): string[] => verifyAudit({ goalId: c.goalId, journal: c.fx.journal(c.goalId), operations: c.fx.ops, now: c.fx.now() }).findings.map((f) => f.code).filter((code) => code.startsWith('OP_'));
const waitOn = (d: CardDirective): string | undefined => (d.kind === 'wait' ? d.on : undefined);

/** The merge intent the ship of this card records: goal, card, target, candidate digest and owner generation. */
const shipIntent = (c: Ctx, over: Partial<OperationIntent> = {}): OperationIntent => ({ kind: 'merge', goalId: c.goalId, cardId: CARD, target: 'main', candidateDigest: DIGEST, ownerGeneration: 0, timeoutMs: 60 * 60 * 1000, ...over });
const earlier = (c: Ctx, ms: number): string => new Date(Date.parse(c.fx.now()) - ms).toISOString();

/** Fail the ship at the append of `type`; the ship rejects with that error and leaves exactly one merge operation, `intended`. */
function strand(c: Ctx, type: string): string {
  withAppendFault(c, type, () => assert.throws(() => next(c), { message: faultMessage(type) }));
  const left = merges(c);
  assert.equal(left.length, 1, 'one merge operation after the failed ship');
  assert.equal(left[0]![1], 'intended');
  assert.deepEqual(c.ship.requests, [], 'nothing was dispatched');
  return left[0]![0];
}

describe('T0-OP-INTENT-DUP: the next ship continues under the merge intent a failed ship left', () => {
  it('acceptance 1: a failed OPERATION_INTENT append leaves one intent; the next ship takes it over, journals OPERATION_INTENT once and closes, and nothing is unresolved for the goal or the audit [R1] [R2]', async () => {
    const c = await atShip();
    const id = strand(c, 'OPERATION_INTENT');
    assert.deepEqual(intentEvents(c), []);
    assert.equal(next(c).directive.kind, 'close');
    assert.deepEqual(merges(c), [[id, 'succeeded']]);
    assert.deepEqual(intentEvents(c), [id]);
    assert.deepEqual(c.fx.ops.unresolved(c.goalId), []);
    const goalNext = c.fx.controller.next(c.goalId);
    assert.ok(!(goalNext.kind === 'wait' && goalNext.on.startsWith('reconcile:')), `the goal waits on ${goalNext.kind === 'wait' ? goalNext.on : goalNext.kind}`);
    assert.deepEqual(opCodes(c), []);
    assert.equal(c.ship.requests.length, 1, 'one dispatch');
  });

  it('acceptance 2: a failed REVIEW_REQUESTED append leaves one journaled intent; the next ship takes it over without a second OPERATION_INTENT and closes [R1] [R2]', async () => {
    const c = await atShip();
    const id = strand(c, 'REVIEW_REQUESTED');
    assert.deepEqual(intentEvents(c), [id]);
    assert.equal(next(c).directive.kind, 'close');
    assert.deepEqual(merges(c), [[id, 'succeeded']]);
    assert.deepEqual(intentEvents(c), [id]);
    assert.deepEqual(c.fx.ops.unresolved(c.goalId), []);
    assert.equal(c.ship.requests.length, 1, 'one dispatch');
  });

  it('acceptance 3: a failed REVIEW_ADMITTED append (request cancelled) leaves one intent; the next ship takes it over and closes [R1]', async () => {
    const c = await atShip();
    const id = strand(c, 'REVIEW_ADMITTED');
    assert.equal(next(c).directive.kind, 'close');
    assert.deepEqual(merges(c), [[id, 'succeeded']]);
    assert.deepEqual(intentEvents(c), [id]);
    assert.deepEqual(c.fx.ops.unresolved(c.goalId), []);
    assert.equal(c.ship.requests.length, 1, 'one dispatch');
  });

  it('a second ship failure on a taken-over intent keeps that one intent, and the third ship closes under it [R1] [R2]', async () => {
    const c = await atShip();
    const id = strand(c, 'OPERATION_INTENT');
    withAppendFault(c, 'REVIEW_REQUESTED', () => assert.throws(() => next(c), { message: faultMessage('REVIEW_REQUESTED') }));
    assert.deepEqual(merges(c), [[id, 'intended']]);
    assert.deepEqual(intentEvents(c), [id]);
    assert.equal(next(c).directive.kind, 'close');
    assert.deepEqual(merges(c), [[id, 'succeeded']]);
    assert.deepEqual(intentEvents(c), [id]);
  });

  it('of two matching intended intents the ship takes over the earliest, and the later one stays intended [R1]', async () => {
    const c = await atShip();
    const first = c.fx.ops.recordIntent(shipIntent(c), earlier(c, 2000));
    const second = c.fx.ops.recordIntent(shipIntent(c), earlier(c, 1000));
    assert.equal(next(c).directive.kind, 'close');
    assert.deepEqual(merges(c), [[first.id, 'succeeded'], [second.id, 'intended']]);
    assert.deepEqual(intentEvents(c), [first.id]);
  });
});

describe('T0-OP-INTENT-DUP: what the ship never takes over [R1]', () => {
  const others: Array<[string, (c: Ctx) => Partial<OperationIntent>]> = [
    ['another owner generation (acceptance 4)', () => ({ ownerGeneration: 1 })],
    ['another candidate digest (acceptance 4)', () => ({ candidateDigest: 'sha-other' })],
    ['another card (acceptance 4)', () => ({ cardId: 'T0-OTHER' })],
    ['another goal', () => ({ goalId: 'g-20260911000000-000000' })],
    ['another target', () => ({ target: 'release' })],
    ['another kind', () => ({ kind: 'deploy' })],
    ['no card (an `aidlc ops intent` record)', () => ({ cardId: undefined })],
  ];
  for (const [name, over] of others) {
    it(`an intended intent of ${name} stays intended and the ship records its own`, async () => {
      const c = await atShip();
      const foreign = c.fx.ops.recordIntent(shipIntent(c, over(c)), earlier(c, 1000));
      const before = c.fx.ops.get(foreign.id);
      assert.equal(next(c).directive.kind, 'close');
      assert.deepEqual(c.fx.ops.get(foreign.id), before, 'the recorded intent is unchanged');
      assert.equal(before?.status, 'intended');
      const own = merges(c).filter(([id]) => id !== foreign.id);
      assert.equal(own.length, 1, 'the ship recorded a new intent');
      assert.equal(own[0]![1], 'succeeded');
      assert.deepEqual(intentEvents(c), [own[0]![0]]);
    });
  }

  for (const status of ['cancelled', 'failed', 'succeeded'] as const) {
    it(`a matching merge operation that is ${status} is not taken over: the ship records its own`, async () => {
      const c = await atShip();
      const recorded = c.fx.ops.recordIntent(shipIntent(c), earlier(c, 1000));
      c.fx.ops.markResult(recorded.id, status, {}, earlier(c, 500));
      const settled = c.fx.ops.get(recorded.id);
      assert.equal(settled?.status, status);
      assert.equal(next(c).directive.kind, 'close');
      assert.deepEqual(c.fx.ops.get(recorded.id), settled, 'the settled operation is unchanged');
      const own = merges(c).filter(([id]) => id !== recorded.id);
      assert.equal(own.length, 1, 'the ship recorded a new intent');
      assert.equal(own[0]![1], 'succeeded');
    });
  }

  it('acceptance 4: an issued merge intent of the candidate recorded without a card makes card next wait on operation:<id> with the ledger unchanged', async () => {
    const c = await atShip();
    const issued = c.fx.ops.recordIntent(shipIntent(c, { cardId: undefined }), earlier(c, 1000));
    c.fx.ops.markIssued(issued.id, undefined, earlier(c, 500));
    const before: OperationRecord[] = c.fx.ops.list({});
    const d = next(c).directive;
    assert.equal(waitOn(d), `operation:${issued.id}`);
    assert.deepEqual(c.fx.ops.list({}), before);
  });
});

describe('T0-OP-INTENT-DUP: the waits cancel only an intent the same call recorded [R3]', () => {
  const shipKey = (c: Ctx): string => reviewRequestKey({ repository: c.g().repository, candidateDigest: DIGEST, base: 'main', policyVersion: c.fx.config.reviewPolicyVersion, reviewer: c.fx.config.reviewer });
  const enqueueRunning = (c: Ctx, candidateDigest: string): void => {
    c.fx.queue.enqueue({ pool: 'default', repository: c.g().repository, candidateDigest, base: 'main', policyVersion: c.fx.config.reviewPolicyVersion, reviewer: c.fx.config.reviewer, requester: 'g-20260911000000-000000:T1-ELSE', deadline: c.run().deadline, now: c.fx.now() });
    const admitted = c.fx.queue.admit('default', actorB, c.fx.now());
    assert.equal(admitted.status, 'admitted');
  };
  /** Pool `default` busy with another requester's running request of another candidate. */
  const busy = (c: Ctx): void => enqueueRunning(c, 'sha-else');
  /** The ship's own request (same key) already running for another requester. */
  const ownRunning = (c: Ctx): void => enqueueRunning(c, DIGEST);

  for (const [name, setup, on, error] of [
    ['acceptance 5: pool default busy', busy, () => 'review-pool:default:busy', 'review not admitted: busy'],
    ['acceptance 5: the ship\'s own request running', ownRunning, (c: Ctx) => `review:${shipKey(c)}`, 'joined running review request'],
  ] as Array<[string, (c: Ctx) => void, (c: Ctx) => string, string]>) {
    it(`${name}: a ship that took over a stranded intent waits and leaves it intended`, async () => {
      const c = await atShip();
      const stranded = c.fx.ops.recordIntent(shipIntent(c), earlier(c, 1000));
      const before = c.fx.ops.get(stranded.id);
      setup(c);
      assert.equal(waitOn(next(c).directive), on(c));
      assert.deepEqual(merges(c), [[stranded.id, 'intended']]);
      assert.deepEqual(c.fx.ops.get(stranded.id), before, 'the taken-over intent is unchanged');
      assert.deepEqual(intentEvents(c), [stranded.id]);
    });

    it(`${name}: a ship that recorded its own intent waits and marks it cancelled`, async () => {
      const c = await atShip();
      setup(c);
      assert.equal(waitOn(next(c).directive), on(c));
      const ops = c.fx.ops.list({ goalId: c.goalId, cardId: CARD });
      assert.deepEqual(ops.map((o) => [o.kind, o.status, o.error]), [['merge', 'cancelled', error]]);
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Acceptance 7: the Doc text section of the card, one assertion per sentence, and removing any one fails.
// ---------------------------------------------------------------------------------------------------------------------

const OPERATIONS_ANCHOR = "when that re-read cannot take the lock the intent and the pool admission are cancelled too and the error is the caller's.";
const OPERATIONS_SENTENCE =
  'A ship that fails after recording its merge intent and before dispatching leaves the intent `intended`, and the next ship of the same candidate continues under it instead of recording a second one (card T0-OP-INTENT-DUP): it takes over the earliest `intended` merge intent of the goal and card with the same target, candidate digest and owner generation, journals `OPERATION_INTENT` for it only when the journal names none, and never marks a taken-over intent `cancelled` while it waits on the pool or on a running review.';
const ARCHITECTURE_ANCHOR = '`reconcile.ts` is the operation ledger: intent before issue, reconciliation by provider lookup, explicit UNKNOWN.';
const ARCHITECTURE_SENTENCE = "The card runner's ship continues under an `intended` merge intent that an earlier failed ship of the same candidate left, instead of recording a second one (card T0-OP-INTENT-DUP).";
const CHANGELOG_SENTENCES = [
  '- T0-OP-INTENT-DUP (bugfix): a ship that failed after recording its merge intent (at the `OPERATION_INTENT`, `REVIEW_REQUESTED` or `REVIEW_ADMITTED` append, the review enqueue or the admission) no longer leaves that intent `intended` for good: the next ship of the same candidate continues under it and journals its `OPERATION_INTENT` when it is missing.',
  "Before, the next ship recorded a second intent and merged, and the first kept the goal's `aidlc next` waiting on `reconcile:<id>`, refused takeovers and blocked `aidlc audit verify` until a person ran `aidlc ops reconcile`.",
];

const readDoc = (file: string): string => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const unreleasedOf = (changelog: string): string => {
  const start = changelog.indexOf('\n## Unreleased\n');
  if (start < 0) return '';
  const end = changelog.indexOf('\n## ', start + 1);
  return changelog.slice(start, end < 0 ? undefined : end);
};

/** Each sentence of the Doc text section in its place, as `[sentence, present]`. */
function placed(ops: string, architecture: string, changelog: string): Array<[string, boolean]> {
  const opsLine = ops.split('\n').find((line) => line.startsWith('Same-candidate rule:')) ?? '';
  const coordination = architecture.split('\n').find((line) => line.startsWith('`src/coordination/` is package S of the plan.')) ?? '';
  const entry = unreleasedOf(changelog).split('\n').find((line) => line.startsWith('- T0-OP-INTENT-DUP ')) ?? '';
  return [
    [OPERATIONS_SENTENCE, opsLine.includes(`${OPERATIONS_ANCHOR} ${OPERATIONS_SENTENCE} `)],
    [ARCHITECTURE_SENTENCE, coordination.endsWith(`${ARCHITECTURE_ANCHOR} ${ARCHITECTURE_SENTENCE}`)],
    [CHANGELOG_SENTENCES[0]!, entry.startsWith(`${CHANGELOG_SENTENCES[0]!} `)],
    [CHANGELOG_SENTENCES[1]!, entry.endsWith(` ${CHANGELOG_SENTENCES[1]!}`) && entry === CHANGELOG_SENTENCES.join(' ')],
  ];
}

describe('T0-OP-INTENT-DUP docs [R5] [R6] [R7]', () => {
  const docs = (): [string, string, string] => [readDoc('docs/OPERATIONS.md'), readDoc('docs/ARCHITECTURE.md'), readDoc('CHANGELOG.md')];

  it('acceptance 7: docs/OPERATIONS.md carries the OPERATIONS sentence right after the lock-failure sentence of the same-candidate paragraph [R5]', () => {
    assert.deepEqual(placed(...docs())[0], [OPERATIONS_SENTENCE, true]);
  });

  it('acceptance 7: docs/ARCHITECTURE.md carries the ARCHITECTURE sentence right after the reconcile.ts sentence [R6]', () => {
    assert.deepEqual(placed(...docs())[1], [ARCHITECTURE_SENTENCE, true]);
  });

  it('acceptance 7: the CHANGELOG Unreleased section carries the first sentence of the entry [R7]', () => {
    assert.deepEqual(placed(...docs())[2], [CHANGELOG_SENTENCES[0], true]);
  });

  it('acceptance 7: the CHANGELOG Unreleased section carries the second sentence of the entry [R7]', () => {
    assert.deepEqual(placed(...docs())[3], [CHANGELOG_SENTENCES[1], true]);
  });

  it('acceptance 7: removing any one sentence from its document fails its check', () => {
    const [ops, architecture, changelog] = docs();
    const removals: Array<[string, Array<[string, boolean]>]> = [
      [OPERATIONS_SENTENCE, placed(ops.replace(OPERATIONS_SENTENCE, ''), architecture, changelog)],
      [ARCHITECTURE_SENTENCE, placed(ops, architecture.replace(ARCHITECTURE_SENTENCE, ''), changelog)],
      ...CHANGELOG_SENTENCES.map((s): [string, Array<[string, boolean]>] => [s, placed(ops, architecture, changelog.replace(s, ''))]),
    ];
    assert.equal(removals.length, 4);
    for (const [sentence, checks] of removals) assert.equal(checks.find(([s]) => s === sentence)?.[1], false, `removing this text still passes: ${sentence}`);
  });
});
