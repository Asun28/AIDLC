/**
 * Card T0-OP-TIMESTAMP-NOW-2: every operation-ledger write of the card runner and the release runner takes its time from the
 * runner's injected clock, so the times and the id of an operation follow the fixture clock, never the wall clock.
 */
import assert from 'node:assert/strict';
import { describe, test, type TestContext } from 'node:test';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { actorB, candidateShaFor, driveCardToDone, goalForCards, makeFixture, opsConfigured, opsRunner, writeCard, type Fixture } from './_harness.ts';
import { cleanup } from '../infra/helpers.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import { DryRunShipPath, type ShipOutcomeClass, type ShipPath, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import type { ProjectConfig } from '../../src/config.ts';
import type { GoalStore } from '../../src/state/goal-store.ts';
import type { CardRun, OperationRecord } from '../../src/core/types.ts';

const CARD = 'T0-CLOCK';
const HEAD = 'a'.repeat(40);
const MINUTE = 60_000;

/** A dry-run ship of `outcome` that runs `during` after the dispatch and reports `pr` as its PR number. */
class ShipWith extends DryRunShipPath {
  private readonly during: () => void;
  private readonly pr: number | undefined;
  constructor(outcome: ShipOutcomeClass, during: () => void = () => {}, pr?: number) {
    super([outcome]);
    this.during = during;
    this.pr = pr;
  }
  override ship(req: ShipRequest): ShipResult {
    const result = super.ship(req);
    this.during();
    return { ...result, prNumber: this.pr };
  }
}

interface Shipping {
  fx: Fixture;
  goalId: string;
  next: () => unknown;
}

/** The card built on HEAD by the dry-run runner; `next` ships it through `shipOf` on a runner with `config` and `exec`. */
function atShip(t: TestContext, shipOf: (fx: Fixture, goalId: string) => ShipPath = () => new DryRunShipPath(['merged']), config: Partial<ProjectConfig> = {}, exec: SyncRunner = scriptedRunner({})): Shipping {
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  writeCard(fx, { id: CARD, title: 'op clock' });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const dry = fx.runner();
  let r = dry.next(fx.goal(goalId), card, fx.controller.ensureCardRun(fx.goal(goalId), CARD));
  r = dry.next(fx.goal(goalId), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  const built = dry.recordAttempt(fx.goal(goalId), card, r.run, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: HEAD });
  mkdirSync(built.worktree!, { recursive: true });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: { ...fx.config, ...config }, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: shipOf(fx, goalId), now: fx.now, runner: exec });
  return { fx, goalId, next: () => runner.next(fx.goal(goalId), card, fx.store.getCardRun(goalId, CARD)!) };
}

/** Advance the fixture clock by `ms`, run `act` (a ship), and return the card's one merge operation. */
function settle(s: Shipping, ms: number, act: () => unknown = s.next): OperationRecord {
  s.fx.advance(ms);
  act();
  const ops = s.fx.ops.list({ goalId: s.goalId, cardId: CARD, kind: 'merge' });
  assert.equal(ops.length, 1, JSON.stringify(ops));
  return ops[0]!;
}

/** A request of another requester for `candidateDigest`, admitted and running in pool `default`. */
function running(s: Shipping, candidateDigest: string): void {
  const run = s.fx.store.getCardRun(s.goalId, CARD)!;
  s.fx.queue.enqueue({ pool: 'default', repository: s.fx.goal(s.goalId).repository, candidateDigest, base: 'main', policyVersion: s.fx.config.reviewPolicyVersion, reviewer: s.fx.config.reviewer, requester: 'g-20260911000000-000000:T1-ELSE', deadline: run.deadline, now: s.fx.now() });
  assert.equal(s.fx.queue.admit('default', actorB, s.fx.now()).status, 'admitted');
}

/** The first card-run write after `REVIEW_ADMITTED`, the ship's arming read, runs `instead`; the store is restored by then. */
function atArming(s: Shipping, instead: (real: GoalStore['updateCardRun']) => CardRun): void {
  const store = s.fx.store as unknown as Record<string, unknown>;
  const real = s.fx.store.updateCardRun.bind(s.fx.store);
  store['updateCardRun'] = (...args: Parameters<GoalStore['updateCardRun']>) => {
    if (!s.fx.events(s.goalId).some((e) => e.type === 'REVIEW_ADMITTED')) return real(...args);
    delete store['updateCardRun'];
    return instead(real);
  };
}

const replaceCandidate = (fx: Fixture, goalId: string, real: GoalStore['updateCardRun'] = fx.store.updateCardRun.bind(fx.store)): CardRun =>
  real(goalId, CARD, (current) => ({ ...current!, candidate: { ...current!.candidate!, digest: 'replaced-meanwhile' } }));

const ghOpen = scriptedRunner({ 'gh pr view 42 --repo o/r --json': { stdout: JSON.stringify({ number: 42, state: 'OPEN', headRefOid: HEAD, mergeCommit: null }) } });

describe('T0-OP-TIMESTAMP-NOW-2 acceptance 1: every changed ledger write records the injected clock [R1]', () => {
  test('the merge intent of a ship: intentRecordedAt and the id prefix are the fixture time', (t) => {
    const s = atShip(t);
    const op = settle(s, MINUTE);
    assert.deepEqual([op.intentRecordedAt, op.id.slice(0, 18)], [s.fx.now(), 'op-20260911000100-']);
  });

  test('a ship that joins a running review request: finishedAt of the cancelled record', (t) => {
    const s = atShip(t);
    running(s, s.fx.store.getCardRun(s.goalId, CARD)!.candidate!.digest);
    const op = settle(s, 2 * MINUTE);
    assert.deepEqual([op.status, op.error, op.finishedAt], ['cancelled', 'joined running review request', s.fx.now()]);
  });

  test('a ship whose review is not admitted: finishedAt of the cancelled record', (t) => {
    const s = atShip(t);
    running(s, 'sha-else');
    const op = settle(s, 3 * MINUTE);
    assert.deepEqual([op.status, op.error, op.finishedAt], ['cancelled', 'review not admitted: busy', s.fx.now()]);
  });

  test('a ship whose arming read of the card run throws: finishedAt of the cancelled record', (t) => {
    const s = atShip(t);
    atArming(s, () => {
      throw new Error('EIO: injected updateCardRun');
    });
    const op = settle(s, 4 * MINUTE, () => assert.throws(s.next, /EIO: injected updateCardRun/));
    assert.deepEqual([op.status, op.finishedAt], ['cancelled', s.fx.now()]);
  });

  test('a ship whose card run changed after the gate: finishedAt of the cancelled record', (t) => {
    const s = atShip(t);
    atArming(s, (real) => replaceCandidate(s.fx, s.goalId, real));
    const op = settle(s, 5 * MINUTE);
    assert.deepEqual([op.status, op.error?.startsWith('ship not dispatched: the candidate changed'), op.finishedAt], ['cancelled', true, s.fx.now()]);
  });

  test('a ship path that throws: finishedAt of the UNKNOWN record', (t) => {
    const s = atShip(t, () =>
      new ShipWith('merged', () => {
        throw new Error('gh: Server Error (HTTP 502)');
      }),
    );
    const op = settle(s, 6 * MINUTE, () => assert.throws(s.next, /HTTP 502/));
    assert.deepEqual([op.status, op.finishedAt], ['UNKNOWN', s.fx.now()]);
  });

  test('a ship result applied after the candidate changed in flight: finishedAt', (t) => {
    const s = atShip(t, (fx, goalId) => new ShipWith('merged', () => replaceCandidate(fx, goalId)));
    const op = settle(s, 7 * MINUTE);
    assert.deepEqual([op.status, op.error?.includes('while the ship was in flight'), op.finishedAt], ['UNKNOWN', true, s.fx.now()]);
  });

  test('a merge-unconfirmed ship that gh reads as not merged: finishedAt of the failed record', (t) => {
    const s = atShip(t, () => new ShipWith('merge-unconfirmed', () => {}, 42), { shipPath: 'github', repository: 'o/r' }, ghOpen);
    const op = settle(s, 8 * MINUTE);
    assert.deepEqual([op.status, op.error?.startsWith('merge-unconfirmed: PR #42 OPEN'), op.finishedAt], ['failed', true, s.fx.now()]);
  });

  test('a merged ship: finishedAt of the succeeded record', (t) => {
    const s = atShip(t);
    const op = settle(s, 9 * MINUTE);
    assert.deepEqual([op.status, op.finishedAt], ['succeeded', s.fx.now()]);
  });

  test('a merged ship that is not verified: finishedAt of the UNKNOWN record', (t) => {
    const s = atShip(t, undefined, { shipPath: 'github' });
    const op = settle(s, 10 * MINUTE);
    assert.deepEqual([op.status, op.error?.startsWith('merge reported but not verified'), op.finishedAt], ['UNKNOWN', true, s.fx.now()]);
  });

  test('a ship with the outcome dod-failed: finishedAt of the failed record', (t) => {
    const s = atShip(t, () => new DryRunShipPath(['dod-failed']));
    const op = settle(s, 11 * MINUTE);
    assert.deepEqual([op.status, op.error?.startsWith('dod-failed: '), op.finishedAt], ['failed', true, s.fx.now()]);
  });

  test('a release deploy: intentRecordedAt and the id prefix are the fixture time', (t) => {
    const fx = makeFixture();
    t.after(() => cleanup(fx.tmp));
    writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
    const goalId = goalForCards(fx, ['T1-HELLO'], { target: 'staging' }).id;
    driveCardToDone(fx, goalId, 'T1-HELLO');
    assert.equal(fx.controller.next(goalId).kind, 'verify-arc');
    const rep = fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: {} });
    assert.equal(rep.directive.kind, 'release');
    const runner = new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store, ops: fx.ops, leases: fx.leases, runner: opsRunner, opsLoad: opsConfigured(), now: fx.now });
    const attempt = runner.setCandidate(fx.goal(goalId), fx.store.getRelease(rep.directive.kind === 'release' ? rep.directive.attemptId : '')!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
    fx.controller.report({ goalId, generation: fx.goal(goalId).generation, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest: 'c1', environment: 'staging' } });
    fx.advance(12 * MINUTE);
    assert.equal(runner.next(fx.goal(goalId), attempt).directive.kind, 'stage');
    const deploys = fx.ops.list({ goalId, kind: 'deploy' });
    assert.deepEqual(deploys.map((o) => [o.intentRecordedAt, o.id.slice(0, 18)]), [[fx.now(), 'op-20260911001200-']]);
  });
});

const LOOP = path.join(import.meta.dirname, '..', '..', 'src', 'loop');
const LEDGER_WRITES = new Set(['recordIntent', 'markIssued', 'markRunning', 'markResult', 'reconcile']);

/** Every call of a ledger write on an expression ending in `ops` in src/loop/*.ts, as `file:line`, and whether it names its time. */
function ledgerWrites(): Array<{ at: string; timed: boolean }> {
  const found: Array<{ at: string; timed: boolean }> = [];
  for (const file of readdirSync(LOOP).filter((f) => f.endsWith('.ts'))) {
    const sf = ts.createSourceFile(file, readFileSync(path.join(LOOP, file), 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && LEDGER_WRITES.has(node.expression.name.text)) {
        const on = node.expression.expression;
        if ((ts.isIdentifier(on) && on.text === 'ops') || (ts.isPropertyAccessExpression(on) && on.name.text === 'ops')) {
          const last = node.arguments[node.arguments.length - 1];
          const timed = !!last && ((ts.isIdentifier(last) && last.text === 'now') || (ts.isCallExpression(last) && last.arguments.length === 0 && last.expression.getText(sf) === 'this.clock'));
          found.push({ at: `${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`, timed });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return found;
}

test('T0-OP-TIMESTAMP-NOW-2 acceptance 2: every operation-ledger write in src/loop names its time [R1]', () => {
  const writes = ledgerWrites();
  assert.ok(writes.length >= 16, `found ${writes.length} ledger writes: ${writes.map((w) => w.at).join(', ')}`);
  assert.deepEqual(writes.filter((w) => !w.timed).map((w) => w.at), []);
});
