/**
 * Card T0-REVIEW-ADMIT-STRAND: a `REVIEW_ADMITTED` append that fails after the review pool admitted the request cancels that
 * request in `review r3` (`CardRunner.formalReview`) and in the ship of `card next` (`CardRunner.ship`), so the slot is
 * freed and the card is reviewed and shipped again. Faults are thrown from `fs.appendFileSync` and `fs.renameSync`,
 * patched on the `node:fs` export, the boundary every journal append and store write passes through.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs, { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { Card, CardRun, Goal } from '../../src/core/types.ts';

const CARD = 'T0-RAS';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const APPEND_ERROR = 'EIO: injected fault, appendFileSync REVIEW_ADMITTED';
const CANCEL_ERROR = 'EIO: injected fault, renameSync of the review request (the cancellation)';
const RESERVE_ERROR = 'EIO: injected fault, renameSync of the card-run record (the reservation)';

interface Ctx {
  fx: Fixture;
  runner: CardRunner;
  ship: DryRunShipPath;
  goalId: string;
  card: Card;
  g: () => Goal;
  run: () => CardRun;
  spawned: { r3: number };
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
  const spawned = { r3: 0 };
  const runner = scriptedRunner({
    'git diff --numstat': { stdout: '0\t0\tsrc/t0-ras.ts\n' },
    'git diff --name-only': { stdout: 'src/t0-ras.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t0-ras.ts b/src/t0-ras.ts\n+export const ras = 1;\n' },
    'fake-r2': () => ({ stdout: PASS }),
    'fake-p': () => {
      spawned.r3 += 1;
      return { stdout: PASS };
    },
  });
  const ship = new DryRunShipPath(['merged']);
  writeCard(fx, { id: CARD, title: 'review admit strand', allowPaths: ['src/t0-ras.ts'] });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const cardRunner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner });
  const g = () => fx.goal(goalId);
  let r = cardRunner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  r = cardRunner.next(g(), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  return { fx, runner: cardRunner, ship, goalId, card, g, run: () => fx.store.getCardRun(goalId, CARD)!, spawned };
}

const next = (c: Ctx) => c.runner.next(c.g(), c.card, c.run());
const formalReview = (c: Ctx) => c.runner.formalReview(c.g(), c.card, c.run());

/** The card after its R2 pass, when `card next` directs `review`. */
async function atReview(): Promise<Ctx> {
  const c = open();
  c.runner.recordAttempt(c.g(), c.card, c.run(), { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-ras' });
  assert.equal(next(c).directive.kind, 'pre-review');
  await c.runner.preReview(c.g(), c.card, c.run());
  assert.equal(next(c).directive.kind, 'review');
  return c;
}

/** The card at SHIP after its R3 pass. */
async function atShip(): Promise<Ctx> {
  const c = await atReview();
  assert.equal((await formalReview(c)).classified.outcome, 'pass');
  assert.equal(c.spawned.r3, 1);
  return c;
}

interface Faults {
  /** Throw from the `REVIEW_ADMITTED` journal append. */
  admitted?: boolean;
  /** Throw from the first card-run record write after the `REVIEW_ADMITTED` append (the reservation of `review r3`). */
  reservation?: boolean;
  /** Throw from every review-request write once an earlier fault was thrown (the cancellation). */
  cancellation?: boolean;
}

const within = (dir: string, file: string): boolean => {
  const rel = path.relative(dir, path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Run `body` with `fs.appendFileSync` and `fs.renameSync` patched on the `node:fs` export; restored in a finally. */
async function withFaults<T>(c: Ctx, faults: Faults, body: () => T | Promise<T>): Promise<T> {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = { renameSync: target['renameSync']!, appendFileSync: target['appendFileSync']! };
  let admittedSeen = false;
  let reservationThrown = false;
  let faulted = false;
  target['appendFileSync'] = (...args: unknown[]) => {
    const file = String(args[0]);
    if (within(c.fx.paths.journal, file)) {
      let type: string | undefined;
      try {
        type = (JSON.parse(String(args[1])) as { type?: string }).type;
      } catch {
        /* not a journal line */
      }
      if (type === 'REVIEW_ADMITTED') {
        if (faults.admitted) {
          faulted = true;
          throw Object.assign(new Error(APPEND_ERROR), { code: 'EIO' });
        }
        admittedSeen = true;
      }
    }
    return real.appendFileSync(...args);
  };
  target['renameSync'] = (...args: unknown[]) => {
    const dest = String(args[1]);
    if (faults.reservation && admittedSeen && !reservationThrown && within(c.fx.paths.cards, dest) && dest.endsWith('.json')) {
      reservationThrown = true;
      faulted = true;
      throw Object.assign(new Error(RESERVE_ERROR), { code: 'EIO' });
    }
    if (faults.cancellation && faulted && within(c.fx.paths.reviewQueue, dest) && !path.basename(dest).startsWith('_pool-')) {
      throw Object.assign(new Error(CANCEL_ERROR), { code: 'EIO' });
    }
    return real.renameSync(...args);
  };
  syncBuiltinESMExports();
  try {
    return await body();
  } finally {
    target['renameSync'] = real.renameSync;
    target['appendFileSync'] = real.appendFileSync;
    syncBuiltinESMExports();
  }
}

const requestOf = (c: Ctx, reviewer: string) => {
  const found = c.fx.queue.list().filter((r) => r.reviewer === reviewer);
  assert.equal(found.length, 1, `one ${reviewer} request`);
  return found[0]!;
};
const activeSlots = (c: Ctx): string[] => c.fx.queue.pool('default', c.fx.now()).active;
const operations = (c: Ctx): string[] => c.fx.ops.list({ goalId: c.goalId, cardId: CARD }).map((o) => `${o.kind} ${o.status}`);

describe('T0-REVIEW-ADMIT-STRAND: a failed REVIEW_ADMITTED append cancels the admitted pool request', () => {
  it('acceptance 1: review r3 rejects with the append error, cancels the primary request and frees the slot; the next review r3 runs the reviewer once and passes [R1]', async () => {
    const c = await atReview();
    await withFaults(c, { admitted: true }, () => assert.rejects(formalReview(c), { message: APPEND_ERROR }));
    assert.equal(requestOf(c, 'primary').state, 'cancelled');
    assert.deepEqual(activeSlots(c), []);
    assert.deepEqual(c.run().review.invocations, []);
    assert.equal(c.spawned.r3, 0);
    const second = await formalReview(c);
    assert.equal(c.spawned.r3, 1);
    assert.equal(second.classified.outcome, 'pass');
  });

  it('acceptance 2: the ship of card next rejects with the append error, cancels the codex-review request, leaves its one merge intent intended and dispatches nothing; the next card next closes [R2]', async () => {
    const c = await atShip();
    await withFaults(c, { admitted: true }, () => assert.throws(() => next(c), { message: APPEND_ERROR }));
    assert.equal(requestOf(c, 'codex-review').state, 'cancelled');
    assert.deepEqual(activeSlots(c), []);
    assert.deepEqual(operations(c), ['merge intended']);
    assert.deepEqual(c.ship.requests, []);
    assert.equal(next(c).directive.kind, 'close');
  });

  it('acceptance 3: a cancellation that throws in turn never replaces the append error or the reservation error [R3]', async () => {
    const r3 = await atReview();
    await withFaults(r3, { admitted: true, cancellation: true }, () => assert.rejects(formalReview(r3), { message: APPEND_ERROR }));
    assert.equal(requestOf(r3, 'primary').state, 'running');

    const shipping = await atShip();
    await withFaults(shipping, { admitted: true, cancellation: true }, () => assert.throws(() => next(shipping), { message: APPEND_ERROR }));
    assert.equal(requestOf(shipping, 'codex-review').state, 'running');

    const reserving = await atReview();
    await withFaults(reserving, { reservation: true, cancellation: true }, () => assert.rejects(formalReview(reserving), { message: RESERVE_ERROR }));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Acceptance 5: the Doc text section of the card, one assertion per sentence, and removing any one fails.
// ---------------------------------------------------------------------------------------------------------------------

const OPERATIONS_ANCHOR = 'a refused R3 reservation cancels its review-pool request.';
const OPERATIONS_SENTENCE =
  "When the `REVIEW_ADMITTED` append fails after the review pool admitted the request, `review r3` and the ship of `card next` cancel that request, which frees its slot, and fail with the append's error (card T0-REVIEW-ADMIT-STRAND): `review r3` writes no reservation, the ship dispatches nothing and leaves its merge intent `intended`, and a cancellation that fails in turn leaves the request `running` while the command still reports the append's error.";
const ARCHITECTURE_ANCHOR = '`review-queue.ts` is the shared provider/account admission queue.';
const ARCHITECTURE_SENTENCE = 'A card-run command whose `REVIEW_ADMITTED` append fails after the queue admitted its request cancels that request, freeing the slot (card T0-REVIEW-ADMIT-STRAND).';
const CHANGELOG_SENTENCES = [
  "- T0-REVIEW-ADMIT-STRAND (bugfix): a `REVIEW_ADMITTED` append that fails after the review pool admitted the request no longer leaves the request `running` with its slot: `review r3` and the ship of `card next` cancel it and fail with the append's error.",
  'Before, every later `review r3` of the candidate refused with "a matching formal review is already running", the ship waited on `review:<key>` for good, and the held slot kept every other review of the pool waiting.',
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
  const entry = unreleasedOf(changelog).split('\n').find((line) => line.startsWith('- T0-REVIEW-ADMIT-STRAND ')) ?? '';
  return [
    [OPERATIONS_SENTENCE, opsLine.includes(`${OPERATIONS_ANCHOR} ${OPERATIONS_SENTENCE} `)],
    [ARCHITECTURE_SENTENCE, coordination.includes(`${ARCHITECTURE_ANCHOR} ${ARCHITECTURE_SENTENCE} `)],
    [CHANGELOG_SENTENCES[0]!, entry.startsWith(`${CHANGELOG_SENTENCES[0]!} `)],
    [CHANGELOG_SENTENCES[1]!, entry.endsWith(` ${CHANGELOG_SENTENCES[1]!}`) && entry === CHANGELOG_SENTENCES.join(' ')],
  ];
}

describe('T0-REVIEW-ADMIT-STRAND docs [R5] [R6] [R7]', () => {
  const docs = (): [string, string, string] => [readDoc('docs/OPERATIONS.md'), readDoc('docs/ARCHITECTURE.md'), readDoc('CHANGELOG.md')];

  it('acceptance 5: docs/OPERATIONS.md carries the OPERATIONS sentence right after the refused-reservation sentence of the same-candidate paragraph [R5]', () => {
    assert.deepEqual(placed(...docs())[0], [OPERATIONS_SENTENCE, true]);
  });

  it('acceptance 5: docs/ARCHITECTURE.md carries the ARCHITECTURE sentence right after the review-queue.ts sentence [R6]', () => {
    assert.deepEqual(placed(...docs())[1], [ARCHITECTURE_SENTENCE, true]);
  });

  it('acceptance 5: the CHANGELOG Unreleased section carries the first sentence of the entry [R7]', () => {
    assert.deepEqual(placed(...docs())[2], [CHANGELOG_SENTENCES[0], true]);
  });

  it('acceptance 5: the CHANGELOG Unreleased section carries the second sentence of the entry [R7]', () => {
    assert.deepEqual(placed(...docs())[3], [CHANGELOG_SENTENCES[1], true]);
  });

  it('acceptance 5: removing any one sentence from its document fails its check', () => {
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
