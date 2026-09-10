import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { OperationLedger, unattendedMutationAllowed, type OperationIntent } from '../../src/coordination/reconcile.ts';
import { cleanup, iso, tmpDir } from './helpers.ts';

function intent(overrides: Partial<OperationIntent> = {}): OperationIntent {
  return {
    kind: 'deploy',
    goalId: 'goal-1',
    cardId: 'T1-A',
    target: 'staging',
    candidateDigest: 'cand-1',
    ownerGeneration: 3,
    timeoutMs: 60_000,
    effects: ['deploys staging'],
    ...overrides,
  };
}

describe('coordination/reconcile (Q18 operation recovery)', () => {
  const dir = tmpDir();
  const ledger = new OperationLedger(path.join(dir, 'operations'));
  after(() => cleanup(dir));

  it('records intent durably before anything is issued', () => {
    const rec = ledger.recordIntent(intent(), iso(0));
    assert.match(rec.id, /^op-\d{14}-[a-f0-9]{8}$/);
    assert.equal(rec.status, 'intended');
    assert.equal(rec.intentRecordedAt, iso(0));
    assert.equal(rec.issuedAt, undefined);
    assert.equal(rec.ownerGeneration, 3);
    assert.equal(rec.externallyVisible, true);
    // undefined-valued keys are dropped on disk; compare the durable shape
    assert.deepEqual(ledger.get(rec.id), JSON.parse(JSON.stringify(rec)));
    assert.deepEqual(ledger.unresolved('goal-1').map((r) => r.id), [rec.id]);
    const issued = ledger.markIssued(rec.id, 'provider-op-9', iso(1));
    assert.equal(issued.status, 'issued');
    assert.equal(issued.providerOperationId, 'provider-op-9');
    assert.equal(issued.issuedAt, iso(1));
    const running = ledger.markRunning(rec.id, iso(2));
    assert.equal(running.status, 'running');
    assert.equal(running.issuedAt, iso(1));
    const done = ledger.markResult(rec.id, 'succeeded', { evidenceRef: 'ev-1' }, iso(3));
    assert.equal(done.status, 'succeeded');
    assert.equal(done.finishedAt, iso(3));
    assert.equal(done.evidenceRef, 'ev-1');
    assert.deepEqual(ledger.unresolved('goal-1'), []);
  });

  it('reconcile keeps UNKNOWN explicit when the provider cannot resolve the outcome', () => {
    const rec = ledger.recordIntent(intent({ candidateDigest: 'cand-unknown' }), iso(10));
    ledger.markIssued(rec.id, undefined, iso(11));
    const unknown = ledger.reconcile(rec.id, () => ({ status: 'UNKNOWN', detail: 'provider status endpoint timed out' }), iso(12));
    assert.equal(unknown.status, 'UNKNOWN');
    assert.equal(unknown.reconciledAt, iso(12));
    assert.equal(unknown.error, 'provider status endpoint timed out');
    assert.equal(unknown.finishedAt, undefined);
    // still unresolved: blocks new mutations until resolved
    assert.ok(ledger.unresolved('goal-1').some((r) => r.id === rec.id));
    // a later lookup that finds the result resolves it
    const found = ledger.reconcile(rec.id, () => ({ status: 'succeeded', providerOperationId: 'late-42', evidenceRef: 'ev-late' }), iso(13));
    assert.equal(found.status, 'succeeded');
    assert.equal(found.providerOperationId, 'late-42');
    assert.equal(found.finishedAt, iso(13));
    // terminal records are returned unchanged without calling lookup
    let called = false;
    const same = ledger.reconcile(rec.id, () => {
      called = true;
      return { status: 'failed' };
    });
    assert.equal(called, false);
    assert.equal(same.status, 'succeeded');
  });

  it('reconcile reports running with the provider id and keeps it unresolved', () => {
    const rec = ledger.recordIntent(intent({ candidateDigest: 'cand-running' }), iso(20));
    const running = ledger.reconcile(rec.id, () => ({ status: 'running', providerOperationId: 'p-1' }), iso(21));
    assert.equal(running.status, 'running');
    assert.equal(running.providerOperationId, 'p-1');
    assert.ok(ledger.unresolved('goal-1', 'T1-A').some((r) => r.id === rec.id));
    assert.equal(ledger.unresolved('goal-1', 'T9-NOPE').length, 0);
  });

  it('unresolved() lists intended/issued/running/UNKNOWN and nothing terminal', () => {
    const l = new OperationLedger(path.join(dir, 'ops2'));
    const a = l.recordIntent(intent({ candidateDigest: 'a' }), iso(0));
    const b = l.recordIntent(intent({ candidateDigest: 'b' }), iso(1));
    const c = l.recordIntent(intent({ candidateDigest: 'c' }), iso(2));
    const d = l.recordIntent(intent({ candidateDigest: 'd' }), iso(3));
    const e = l.recordIntent(intent({ candidateDigest: 'e' }), iso(4));
    const f = l.recordIntent(intent({ candidateDigest: 'f' }), iso(5));
    l.markIssued(b.id, 'x', iso(6));
    l.markRunning(c.id, iso(7));
    l.reconcile(d.id, () => ({ status: 'UNKNOWN', detail: '?' }), iso(8));
    l.markResult(e.id, 'failed', { error: 'boom' }, iso(9));
    l.markResult(f.id, 'cancelled', {}, iso(10));
    assert.deepEqual(
      l.unresolved('goal-1').map((r) => r.status),
      ['intended', 'issued', 'running', 'UNKNOWN'],
    );
    assert.deepEqual(l.unresolved('goal-1').map((r) => r.id), [a.id, b.id, c.id, d.id]);
    assert.equal(l.list({ status: 'failed' })[0]?.error, 'boom');
    assert.equal(l.list({ goalId: 'other' }).length, 0);
  });

  it('findDuplicate detects an equivalent in-flight operation (same target + candidate, honouring idempotency keys)', () => {
    const l = new OperationLedger(path.join(dir, 'ops3'));
    const first = l.recordIntent(intent({ idempotencyKey: 'k1' }), iso(0));
    assert.equal(l.findDuplicate(intent())?.id, first.id);
    assert.equal(l.findDuplicate(intent({ idempotencyKey: 'k1' }))?.id, first.id);
    assert.equal(l.findDuplicate(intent({ idempotencyKey: 'k2' })), undefined);
    assert.equal(l.findDuplicate(intent({ candidateDigest: 'cand-2' })), undefined);
    assert.equal(l.findDuplicate(intent({ target: 'production' })), undefined);
    assert.equal(l.findDuplicate(intent({ kind: 'rollback' })), undefined);
    // a failed or cancelled operation is not a duplicate; a succeeded one still is (no double deploy)
    l.markResult(first.id, 'failed', {}, iso(1));
    assert.equal(l.findDuplicate(intent()), undefined);
    const second = l.recordIntent(intent(), iso(2));
    l.markResult(second.id, 'succeeded', {}, iso(3));
    assert.equal(l.findDuplicate(intent())?.id, second.id);
  });

  it('unattended external mutations need an idempotency key or a status lookup', () => {
    const visible = (o: Partial<OperationIntent> = {}) => intent({ externallyVisible: true, ...o });
    assert.equal(unattendedMutationAllowed(intent({ externallyVisible: false }), { idempotencyKey: false, statusLookup: false }).allowed, true);
    assert.equal(unattendedMutationAllowed(visible({ idempotencyKey: 'k' }), { idempotencyKey: true, statusLookup: false }).allowed, true);
    // key supported by the provider but not supplied: falls through to status lookup
    assert.equal(unattendedMutationAllowed(visible(), { idempotencyKey: true, statusLookup: false }).allowed, false);
    assert.equal(unattendedMutationAllowed(visible(), { idempotencyKey: false, statusLookup: true }).allowed, true);
    const refused = unattendedMutationAllowed(visible(), { idempotencyKey: false, statusLookup: false });
    assert.equal(refused.allowed, false);
    assert.match(refused.detail, /exactly-once cannot be established; stop the unattended path/);
  });

  it('an intent that omits externallyVisible is treated as externally visible (fail closed)', () => {
    // BUG: src/coordination/reconcile.ts unattendedMutationAllowed() reads `!intent.externallyVisible`,
    // so an intent that leaves the field undefined is judged "no external effect" and allowed with
    // neither idempotency key nor status lookup. OperationLedger.recordIntent defaults the same field
    // to true; the guard must use `intent.externallyVisible ?? true` to match (LC4: stop the
    // unattended path when exactly-once cannot be established).
    const refused = unattendedMutationAllowed(intent(), { idempotencyKey: false, statusLookup: false });
    assert.equal(refused.allowed, false);
  });

  it('unknown operation ids throw', () => {
    assert.throws(() => ledger.markIssued('op-missing', 'x'), /unknown operation/);
    assert.throws(() => ledger.reconcile('op-missing', () => ({ status: 'failed' })), /unknown operation/);
    assert.equal(ledger.get('op-missing'), undefined);
  });
});
