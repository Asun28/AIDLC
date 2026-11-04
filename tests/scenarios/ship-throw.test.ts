/**
 * Card T0-SHIP-THROW-SLOT-2: a ship that throws any value frees its review slot and leaves its operation UNKNOWN.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs, { readFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { candidateShaFor, goalForCards, makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath, thrownText, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import type { Goal } from '../../src/core/types.ts';

const CARD = 'T1-THROW';
const POOL = 'default';
const NO_TEXT = 'a value with no text';

/** Throws from its first ship, as a `gh` read inside the ship does, and ships normally after it. */
class ThrowOnce extends DryRunShipPath {
  readonly thrown: unknown;
  private readonly beforeThrow: () => void;
  private threw = false;

  constructor(thrown: unknown = new Error('gh: Server Error (HTTP 502)'), beforeThrow: () => void = () => {}) {
    super();
    this.thrown = thrown;
    this.beforeThrow = beforeThrow;
  }

  override ship(req: ShipRequest): ShipResult {
    if (this.threw) return super.ship(req);
    this.threw = true;
    this.beforeThrow();
    throw this.thrown;
  }
}

/** The card at SHIP, its attempt recorded, the next `card next` dispatching the ship. */
function atShip(fx: Fixture, shipPath: DryRunShipPath): { goal: Goal; next: () => ReturnType<ReturnType<Fixture['runner']>['next']> } {
  writeCard(fx, { id: CARD, title: 'ship that throws' });
  const goal = goalForCards(fx, [CARD]);
  const runner = fx.runner(shipPath);
  const card = fx.card(CARD);
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  assert.equal(r.directive.kind, 'prepare');
  r = runner.next(fx.goal(goal.id), card, r.run);
  assert.equal(r.directive.kind, 'build');
  runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: `dod:${CARD}`, redReceipt: `red:${CARD}`, candidateSha: candidateShaFor(CARD) });
  return { goal, next: () => runner.next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, CARD)!) };
}

const thrownOperation = (fx: Fixture) => fx.ops.list({ cardId: CARD }).find((o) => o.kind === 'merge' && o.status === 'UNKNOWN');

test('T0-SHIP-THROW-SLOT-2 acceptance 3: a ship that throws rethrows, leaves its operation UNKNOWN and frees its slot for another card', () => {
  const fx = makeFixture();
  try {
    const ship = new ThrowOnce();
    const { goal, next } = atShip(fx, ship);
    assert.throws(next, (err) => err === ship.thrown);
    const operation = thrownOperation(fx);
    assert.equal(operation?.error?.startsWith('ship threw: '), true, JSON.stringify(operation));
    const requests = fx.queue.list(POOL).filter((r) => r.requesters.includes(`${goal.id}:${CARD}`));
    assert.deepEqual(requests.map((r) => r.state), ['cancelled']);
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    const results = fx.events(goal.id).filter((e) => e.type === 'OPERATION_RESULT' && e.data['operationId'] === operation?.id);
    assert.deepEqual(results.map((e) => [e.data['status'], e.data['outcome']]), [['UNKNOWN', 'ship-threw']]);
    const other = fx.queue.enqueue({ pool: POOL, repository: 'o/r', candidateDigest: 'other', base: 'main', policyVersion: 'p', reviewer: 'r', requester: 'g-other:T1-OTHER', deadline: '2126-01-01T00:00:00.000Z' });
    assert.equal(fx.queue.admit(POOL, undefined, fx.now(), other.request.key).status, 'admitted');
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-THROW-SLOT-2 acceptance 5: a ship that throws a value that is no Error is settled like any other, and that value is rethrown', () => {
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const noMessage = Object.defineProperty(new Error('hidden'), 'message', {
    get() {
      throw new Error('no message');
    },
  });
  const values: Array<[unknown, string]> = [[null, 'null'], ['plain text', 'plain text'], [Object.create(null), NO_TEXT], [revoked.proxy, NO_TEXT], [noMessage, NO_TEXT], [Object.assign(new Error('hidden'), { message: 42 }), '42']];
  for (const [thrown, text] of values) {
    const fx = makeFixture();
    try {
      const ship = new ThrowOnce(thrown);
      const { next } = atShip(fx, ship);
      assert.throws(next, (err) => err === thrown);
      assert.equal(thrownOperation(fx)?.error, `ship threw: ${text}`);
      assert.deepEqual(fx.queue.pool(POOL).active, []);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-SHIP-THROW-SLOT-2 acceptance 5: thrownText returns a primitive string for any value', () => {
  assert.equal(thrownText(Object.assign(new Error('hidden'), { message: 42 })), '42');
  assert.equal(thrownText(new Error('plain')), 'plain');
  assert.equal(thrownText(undefined), 'undefined');
  assert.equal(thrownText(Object.create(null)), NO_TEXT);
});

/** Run `body` with `object[method]` throwing, that one method only, restored in a finally. */
function failing<T extends object>(object: T, method: keyof T & string, body: () => void): void {
  const real = object[method];
  (object as Record<string, unknown>)[method] = () => {
    throw new Error(`EIO: injected ${method}`);
  };
  try {
    body();
  } finally {
    (object as Record<string, unknown>)[method] = real;
  }
}

const shipResults = (fx: Fixture, goalId: string) => fx.events(goalId).filter((e) => e.type === 'OPERATION_RESULT' && e.data['outcome'] === 'ship-threw');

test('T0-SHIP-THROW-SLOT-2 acceptance 7: with the ledger write failing the slot is free, the value rethrown and the event still owed', () => {
  const fx = makeFixture();
  try {
    const ship = new ThrowOnce();
    const { goal, next } = atShip(fx, ship);
    failing(fx.ops, 'markResult', () => assert.throws(next, (err) => err === ship.thrown));
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    assert.equal(fx.ops.list({ cardId: CARD }).find((o) => o.kind === 'merge')?.status, 'issued');
    assert.deepEqual(fx.store.getCardRun(goal.id, CARD)?.journalOwed?.map((o) => [o.type, o.data['outcome']]), [['OPERATION_RESULT', 'ship-threw']]);
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-THROW-SLOT-2 acceptance 7: with the request cancel failing the operation is UNKNOWN, the event journaled and the value rethrown', () => {
  const fx = makeFixture();
  try {
    const ship = new ThrowOnce();
    const { goal, next } = atShip(fx, ship);
    failing(fx.queue, 'cancel', () => assert.throws(next, (err) => err === ship.thrown));
    assert.ok(thrownOperation(fx));
    assert.equal(shipResults(fx, goal.id).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-THROW-SLOT-2 acceptance 7: with the record write failing the operation is UNKNOWN, the slot free and the event journaled once', () => {
  const fx = makeFixture();
  try {
    // The store fails from the throw on: the writes of `card next` before the ship stand.
    const store = fx.store as unknown as Record<string, unknown>;
    const ship = new ThrowOnce(new Error('gh: Server Error (HTTP 502)'), () => {
      store['updateCardRun'] = () => {
        throw new Error('EIO: injected updateCardRun');
      };
    });
    const { goal, next } = atShip(fx, ship);
    assert.throws(next, (err) => err === ship.thrown);
    delete store['updateCardRun'];
    assert.ok(thrownOperation(fx));
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    assert.equal(shipResults(fx, goal.id).length, 1);
    assert.equal(next().directive.kind, 'wait');
    assert.equal(shipResults(fx, goal.id).length, 1);
  } finally {
    fx.cleanup();
  }
});

/** Run `body` with the first journal append of a line holding `marker` throwing, that one call only. */
function appendFailing(marker: string, body: () => void): void {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = target['appendFileSync']!;
  let fired = false;
  target['appendFileSync'] = (...args: unknown[]) => {
    if (!fired && String(args[0]).endsWith('.jsonl') && String(args[1]).includes(marker)) {
      fired = true;
      throw new Error('EIO: injected append');
    }
    return real(...args);
  };
  syncBuiltinESMExports();
  try {
    body();
  } finally {
    target['appendFileSync'] = real;
    syncBuiltinESMExports();
  }
}

test('T0-SHIP-THROW-SLOT-2 acceptance 8: an OPERATION_RESULT append that failed stays owed, and the next card next appends it once, marked', () => {
  const fx = makeFixture();
  try {
    const ship = new ThrowOnce();
    const { goal, next } = atShip(fx, ship);
    appendFailing('ship-threw', () => assert.throws(next, (err) => err === ship.thrown));
    assert.equal(shipResults(fx, goal.id).length, 0);
    assert.deepEqual(fx.queue.pool(POOL).active, []);
    assert.equal(next().directive.kind, 'wait');
    assert.deepEqual(shipResults(fx, goal.id).map((e) => e.data['completed']), [true]);
    next();
    assert.equal(shipResults(fx, goal.id).length, 1);
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-THROW-SLOT-2 acceptance 8: a reconcile that lands first leaves the owed result unappended', () => {
  const fx = makeFixture();
  try {
    const ship = new ThrowOnce();
    const { goal, next } = atShip(fx, ship);
    appendFailing('ship-threw', () => assert.throws(next, (err) => err === ship.thrown));
    const operation = thrownOperation(fx)!;
    fx.ops.reconcile(operation.id, () => ({ status: 'failed', detail: 'looked up' }));
    fx.journal(goal.id).append({ type: 'OPERATION_RECONCILED', goalId: goal.id, cardId: CARD, data: { operationId: operation.id, status: 'failed' } });
    next();
    assert.equal(shipResults(fx, goal.id).length, 0);
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-THROW-SLOT-2 acceptance 4: after the throw nothing ships until the operation is looked up, and then the ship runs once more', () => {
  const fx = makeFixture();
  try {
    const ship = new ThrowOnce();
    const { goal, next } = atShip(fx, ship);
    assert.throws(next, (err) => err === ship.thrown);
    assert.equal(next().directive.kind, 'wait');
    assert.equal(ship.requests.length, 0);
    fx.ops.reconcile(thrownOperation(fx)!.id, () => ({ status: 'failed', detail: 'looked up: the PR is open and unmerged' }));
    assert.equal(next().directive.kind, 'close');
    assert.equal(ship.requests.length, 1);
    assert.deepEqual(fx.ops.list({ cardId: CARD }).filter((o) => o.kind === 'merge').map((o) => o.status), ['failed', 'succeeded']);
    const requests = fx.queue.list(POOL).filter((r) => r.requesters.includes(`${goal.id}:${CARD}`));
    assert.deepEqual(requests.map((r) => r.state), ['completed']);
    assert.deepEqual(fx.queue.pool(POOL).active, []);
  } finally {
    fx.cleanup();
  }
});

test('T0-SHIP-THROW-SLOT-2 acceptance 9: the OPERATIONS sentence and the CHANGELOG entry', () => {
  const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
  assert.ok(read('docs/OPERATIONS.md').includes('A ship that throws frees its review slot and leaves its merge operation `UNKNOWN`, since a merge may have landed: look the outcome up and record it with `aidlc ops reconcile <opId> --status <s>`, and `card next` ships again.'));
  assert.ok(read('CHANGELOG.md').includes("- T0-SHIP-THROW-SLOT-2 (bugfix): a GitHub outage during a ship no longer stops every review in the repository. An unreadable check-run read is now a pending read of the CI gate, retried until the gate's timeout, and any other throw of a ship frees its review slot and leaves its merge operation `UNKNOWN` for `aidlc ops reconcile`. Before, an HTTP 502 from the check-runs read left a `running` request in the pool that no command could clear."));
});
