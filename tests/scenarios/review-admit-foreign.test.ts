/**
 * Card T0-REVIEW-ADMIT-FOREIGN: a card asking the review pool for admission (`review r3`, `CardRunner.formalReview`, and
 * the ship of `card next`, `CardRunner.ship`) is admitted only for its own request and waits behind another card's
 * request, instead of making that request `running` with nobody to run it. Two cards of one goal share pool `default`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { actorB, goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner, type CardDirective } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { Card, CardRun, Goal, ReviewRequest } from '../../src/core/types.ts';

const Y = 'T1-Y';
const Z = 'T1-Z';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const OTHER = 'g-20260911000000-000000:T1-X';

interface Ctx {
  fx: Fixture;
  runner: CardRunner;
  ship: DryRunShipPath;
  goalId: string;
  g: () => Goal;
  card: (id: string) => Card;
  run: (id: string) => CardRun;
  spawned: { r3: number };
}

/** The config of the fault-point test, two cards of one goal, each driven to BUILD. */
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
    'git diff --numstat': { stdout: '0\t0\tsrc/t1-yz.ts\n' },
    'git diff --name-only': { stdout: 'src/t1-yz.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t1-yz.ts b/src/t1-yz.ts\n+export const yz = 1;\n' },
    'fake-r2': () => ({ stdout: PASS }),
    'fake-p': () => {
      spawned.r3 += 1;
      return { stdout: PASS };
    },
  });
  const ship = new DryRunShipPath(['merged']);
  for (const id of [Y, Z]) writeCard(fx, { id, title: `review admit foreign ${id}`, allowPaths: ['src/t1-yz.ts'] });
  const goalId = goalForCards(fx, [Y, Z]).id;
  const cardRunner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner });
  const g = () => fx.goal(goalId);
  for (const id of [Y, Z]) {
    let r = cardRunner.next(g(), fx.card(id), fx.controller.ensureCardRun(g(), id));
    assert.equal(r.directive.kind, 'prepare', r.directive.narration);
    r = cardRunner.next(g(), fx.card(id), r.run);
    assert.equal(r.directive.kind, 'build', r.directive.narration);
  }
  return { fx, runner: cardRunner, ship, goalId, g, card: (id) => fx.card(id), run: (id) => fx.store.getCardRun(goalId, id)!, spawned };
}

const next = (c: Ctx, id: string) => c.runner.next(c.g(), c.card(id), c.run(id));
const formalReview = (c: Ctx, id: string) => c.runner.formalReview(c.g(), c.card(id), c.run(id));
const requesterOf = (c: Ctx, id: string): string => `${c.goalId}:${id}`;
const waitOn = (d: CardDirective): string => (d.kind === 'wait' ? d.on : `not a wait: ${d.kind}`);

/** Both cards after their R2 passes, when `card next` directs `review`. */
async function atReview(): Promise<Ctx> {
  const c = open();
  for (const id of [Y, Z]) {
    c.runner.recordAttempt(c.g(), c.card(id), c.run(id), { outcome: 'success', dodReceipt: `dod:${id}`, redReceipt: `red:${id}`, candidateSha: `sha-${id.toLowerCase()}` });
    assert.equal(next(c, id).directive.kind, 'pre-review');
    await c.runner.preReview(c.g(), c.card(id), c.run(id));
    assert.equal(next(c, id).directive.kind, 'review');
  }
  return c;
}

/** Both cards at SHIP after their R3 passes. */
async function atShip(): Promise<Ctx> {
  const c = await atReview();
  for (const id of [Y, Z]) assert.equal((await formalReview(c, id)).classified.outcome, 'pass');
  assert.equal(c.spawned.r3, 2);
  return c;
}

/** Another requester's request, admitted and running in pool `default`. */
function foreignRunning(c: Ctx, reviewer: string): ReviewRequest {
  const request = c.fx.queue.enqueue({ pool: 'default', repository: c.g().repository, candidateDigest: 'digest-x', base: 'main', policyVersion: c.fx.config.reviewPolicyVersion, reviewer, requester: OTHER, deadline: c.run(Y).deadline, now: c.fx.now() }).request;
  const admitted = c.fx.queue.admit('default', actorB, c.fx.now());
  assert.equal(admitted.status === 'admitted' && admitted.request.key, request.key);
  return request;
}

const requestOf = (c: Ctx, id: string, reviewer: string): ReviewRequest => {
  const found = c.fx.queue.list('default').filter((r) => r.reviewer === reviewer && r.requesters.includes(requesterOf(c, id)) && r.state !== 'completed');
  assert.equal(found.length, 1, `one open ${reviewer} request of ${id}`);
  return found[0]!;
};
const activeSlots = (c: Ctx): string[] => c.fx.queue.pool('default', c.fx.now()).active;

describe('T0-REVIEW-ADMIT-FOREIGN: a card is admitted only for its own request and waits behind another card', () => {
  it('acceptance 3: review r3 of Z behind Y refuses naming Y, leaves Y queued and the slot free; Y then Z each run the reviewer once and pass, and both close [R3] [R4]', async () => {
    const c = await atReview();
    const other = foreignRunning(c, 'primary');
    await assert.rejects(formalReview(c, Y), /review pool "default" is busy/);
    await assert.rejects(formalReview(c, Z), /review pool "default" is busy/);
    c.fx.queue.complete(other.key, 'verdict:x', c.fx.now());
    const yRequest = requestOf(c, Y, 'primary');
    await assert.rejects(formalReview(c, Z), { message: `review pool "default" is behind the request of ${requesterOf(c, Y)}; the formal review waits for admission (aidlc review status --pool "default")` });
    assert.deepEqual(requestOf(c, Y, 'primary'), yRequest, "Y's request is unchanged");
    assert.equal(yRequest.state, 'queued');
    assert.deepEqual(activeSlots(c), []);
    assert.equal(c.spawned.r3, 0);
    assert.equal((await formalReview(c, Y)).classified.outcome, 'pass');
    assert.equal(c.spawned.r3, 1);
    assert.equal((await formalReview(c, Z)).classified.outcome, 'pass');
    assert.equal(c.spawned.r3, 2);
    assert.equal(next(c, Y).directive.kind, 'close');
    assert.equal(next(c, Z).directive.kind, 'close');
  });

  it('acceptance 4: the ship of Z behind Y waits on review-pool:default:behind naming Y, leaves Y queued; Y and then Z close [R3] [R4]', async () => {
    const c = await atShip();
    const reviewer = c.fx.config.reviewer;
    const other = foreignRunning(c, reviewer);
    assert.equal(waitOn(next(c, Y).directive), 'review-pool:default:busy');
    assert.equal(waitOn(next(c, Z).directive), 'review-pool:default:busy');
    c.fx.queue.complete(other.key, 'verdict:x', c.fx.now());
    const yRequest = requestOf(c, Y, reviewer);
    const behind = next(c, Z).directive;
    assert.deepEqual(behind, { kind: 'wait', cardId: Z, on: 'review-pool:default:behind', pollSeconds: 120, narration: `Review pool default is behind the request of ${requesterOf(c, Y)}; waiting holds no active slot. Continue independent work within limits.` });
    assert.deepEqual(requestOf(c, Y, reviewer), yRequest, "Y's ship request is unchanged");
    assert.equal(yRequest.state, 'queued');
    assert.deepEqual(activeSlots(c), []);
    assert.deepEqual(
      c.fx.ops.list({ goalId: c.goalId, cardId: Z }).map((o) => [o.kind, o.status, o.error]),
      [['merge', 'cancelled', 'review not admitted: busy'], ['merge', 'cancelled', 'review not admitted: behind']],
      "Z's merge intents, each cancelled by its own admission wait",
    );
    assert.equal(c.ship.requests.length, 0, "nothing is shipped while both cards wait");
    assert.equal(next(c, Y).directive.kind, 'close');
    assert.equal(next(c, Z).directive.kind, 'close');
    assert.deepEqual(c.ship.requests.map((r) => r.cardId), [Y, Z]);
  });

  it('acceptance 5: a queued request of Y alone for an earlier candidate is superseded and Y admitted; one Y shares with another requester is not, and Y is behind it [R3]', async () => {
    const c = await atReview();
    const earlier = { pool: 'default', repository: c.g().repository, candidateDigest: 'digest-y-earlier', base: 'main', policyVersion: c.fx.config.reviewPolicyVersion, reviewer: 'primary', requester: requesterOf(c, Y), deadline: c.run(Y).deadline, now: c.fx.now() };
    const stale = [c.fx.queue.enqueue(earlier).request, c.fx.queue.enqueue({ ...earlier, candidateDigest: 'digest-y-earlier-2' }).request];
    assert.equal((await formalReview(c, Y)).classified.outcome, 'pass');
    assert.equal(c.spawned.r3, 1);
    for (const request of stale) {
      const superseded = c.fx.queue.get(request.key)!;
      assert.equal(superseded.state, 'completed');
      assert.equal(superseded.verdictRef, 'superseded by a newer candidate of the same card');
    }

    const shared = await atReview();
    const base = { pool: 'default', repository: shared.g().repository, candidateDigest: 'digest-y-earlier', base: 'main', policyVersion: shared.fx.config.reviewPolicyVersion, reviewer: 'primary', deadline: shared.run(Y).deadline, now: shared.fx.now() };
    shared.fx.queue.enqueue({ ...base, requester: requesterOf(shared, Y) });
    const joint = shared.fx.queue.enqueue({ ...base, requester: OTHER }).request;
    assert.deepEqual(joint.requesters, [requesterOf(shared, Y), OTHER]);
    await assert.rejects(formalReview(shared, Y), { message: `review pool "default" is behind the request of ${requesterOf(shared, Y)}, ${OTHER}; the formal review waits for admission (aidlc review status --pool "default")` });
    assert.deepEqual(shared.fx.queue.get(joint.key), joint, 'the shared request is not superseded');
    assert.equal(shared.spawned.r3, 0);

    // After the supersede Y asks again for its own request only: Z's request, queued behind the earlier candidate, stays queued.
    const between = await atReview();
    const old = between.fx.queue.enqueue({ ...earlier, repository: between.g().repository, requester: requesterOf(between, Y), deadline: between.run(Y).deadline, now: between.fx.now() }).request;
    await assert.rejects(formalReview(between, Z), { message: `review pool "default" is behind the request of ${requesterOf(between, Y)}; the formal review waits for admission (aidlc review status --pool "default")` });
    const zRequest = requestOf(between, Z, 'primary');
    await assert.rejects(formalReview(between, Y), { message: `review pool "default" is behind the request of ${requesterOf(between, Z)}; the formal review waits for admission (aidlc review status --pool "default")` });
    assert.equal(between.fx.queue.get(old.key)?.verdictRef, 'superseded by a newer candidate of the same card');
    assert.deepEqual(requestOf(between, Z, 'primary'), zRequest, "Z's request is unchanged");
    assert.equal(zRequest.state, 'queued');
    assert.deepEqual(activeSlots(between), []);
    assert.equal((await formalReview(between, Z)).classified.outcome, 'pass');
    assert.equal((await formalReview(between, Y)).classified.outcome, 'pass');
    assert.equal(between.spawned.r3, 2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Acceptance 6: the Doc text section of the card, one assertion per sentence, and removing any one fails.
// ---------------------------------------------------------------------------------------------------------------------

const OPERATIONS_ANCHOR = 'even if the candidate already holds its pass.';
const OPERATIONS_SENTENCE =
  "A card is admitted to the shared review pool only for its own request, in queue order (card T0-REVIEW-ADMIT-FOREIGN): when another card's request is ahead of it and no free slot is left for it, `review r3` refuses and the ship waits on `review-pool:<pool>:behind`, both naming the card ahead, and an earlier candidate of the same card ahead of it is completed as superseded, as before.";
const ARCHITECTURE_ANCHOR = 'A card-run command whose `REVIEW_ADMITTED` append fails after the queue admitted its request cancels that request, freeing the slot (card T0-REVIEW-ADMIT-STRAND).';
const ARCHITECTURE_SENTENCE = '`ReviewQueue.admit` with a request key admits only that request, and only once fewer requests are ahead of it than the pool has free slots, which is how the card runner asks (card T0-REVIEW-ADMIT-FOREIGN).';
const CHANGELOG_SENTENCES = [
  "- T0-REVIEW-ADMIT-FOREIGN (bugfix): a card asking the review pool for admission is admitted only for its own request and waits its turn behind another card's request (`review r3` refuses, the ship waits on `review-pool:<pool>:behind`, both naming the card ahead).",
  'Before, it admitted the other card\'s request on its behalf, that request stayed `running` with the slot and nobody to run it, the other card\'s `review r3` refused with "a matching formal review is already running" and both cards waited for good.',
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
  const opsLine = ops.split('\n').find((line) => line.startsWith('Placeholders in argv:')) ?? '';
  const coordination = architecture.split('\n').find((line) => line.startsWith('`src/coordination/` is package S of the plan.')) ?? '';
  const entry = unreleasedOf(changelog).split('\n').find((line) => line.startsWith('- T0-REVIEW-ADMIT-FOREIGN ')) ?? '';
  return [
    [OPERATIONS_SENTENCE, opsLine.includes(`${OPERATIONS_ANCHOR} ${OPERATIONS_SENTENCE} `)],
    [ARCHITECTURE_SENTENCE, coordination.includes(`${ARCHITECTURE_ANCHOR} ${ARCHITECTURE_SENTENCE} `)],
    [CHANGELOG_SENTENCES[0]!, entry.startsWith(`${CHANGELOG_SENTENCES[0]!} `)],
    [CHANGELOG_SENTENCES[1]!, entry.endsWith(` ${CHANGELOG_SENTENCES[1]!}`) && entry === CHANGELOG_SENTENCES.join(' ')],
  ];
}

describe('T0-REVIEW-ADMIT-FOREIGN docs [R5] [R6] [R7]', () => {
  const docs = (): [string, string, string] => [readDoc('docs/OPERATIONS.md'), readDoc('docs/ARCHITECTURE.md'), readDoc('CHANGELOG.md')];

  it('acceptance 6: docs/OPERATIONS.md carries the OPERATIONS sentence right after the sentence ending "even if the candidate already holds its pass." [R5]', () => {
    assert.deepEqual(placed(...docs())[0], [OPERATIONS_SENTENCE, true]);
  });

  it("acceptance 6: docs/ARCHITECTURE.md carries the ARCHITECTURE sentence right after T0-REVIEW-ADMIT-STRAND's sentence [R6]", () => {
    assert.deepEqual(placed(...docs())[1], [ARCHITECTURE_SENTENCE, true]);
  });

  it('acceptance 6: the CHANGELOG Unreleased section carries the first sentence of the entry [R7]', () => {
    assert.deepEqual(placed(...docs())[2], [CHANGELOG_SENTENCES[0], true]);
  });

  it('acceptance 6: the CHANGELOG Unreleased section carries the second sentence of the entry [R7]', () => {
    assert.deepEqual(placed(...docs())[3], [CHANGELOG_SENTENCES[1], true]);
  });

  it('acceptance 6: removing any one sentence from its document fails its check', () => {
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
