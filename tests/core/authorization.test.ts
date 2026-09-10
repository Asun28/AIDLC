import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalPacket, matchesAuthorization, requireAuthority } from '../../src/core/authorization.ts';
import { addMs } from '../../src/core/types.ts';
import { T0, auth } from './_fixtures.ts';

const prod = auth({ id: 'prod-1', kind: 'production', candidateDigest: 'cand-1', environment: 'prod', configDigest: 'cfg-1', operations: ['deploy', 'status'], migrations: ['expand-1'] });
const EFFECTS = { candidateDigest: 'cand-1', environment: 'prod', configDigest: 'cfg-1', operations: ['deploy'], migrations: ['expand-1'] };

describe('authorization binding (LC6 / Q17)', () => {
  test('Q17: a production approval matches only the exact candidate/environment/effects', () => {
    assert.equal(matchesAuthorization(prod, 'production', EFFECTS, T0).matched, true);
    assert.deepEqual(matchesAuthorization(prod, 'production', { ...EFFECTS, candidateDigest: 'cand-2' }, T0).mismatches, ['candidate digest differs']);
    assert.deepEqual(matchesAuthorization(prod, 'production', { ...EFFECTS, environment: 'staging' }, T0).mismatches, ['environment differs']);
    assert.deepEqual(matchesAuthorization(prod, 'production', { ...EFFECTS, configDigest: 'cfg-2' }, T0).mismatches, ['configuration digest differs']);
    assert.deepEqual(matchesAuthorization(prod, 'production', { ...EFFECTS, operations: ['deploy', 'rollback'] }, T0).mismatches, ['operations not covered: rollback']);
    assert.deepEqual(matchesAuthorization(prod, 'production', { ...EFFECTS, migrations: ['contract-1'] }, T0).mismatches, ['migrations not covered: contract-1']);
  });

  test('Q17: a development yes is insufficient for production; kind must match', () => {
    const dev = auth({ id: 'dev', kind: 'development' });
    const r = requireAuthority([dev], 'production', EFFECTS, T0);
    assert.equal(r.status, 'missing');
    assert.equal(r.status === 'missing' && r.stopReason, 'release-auth');
  });

  test('Q17: expired records do not match', () => {
    const expired = auth({ ...prod, id: 'old', expiresAt: T0 });
    assert.ok(matchesAuthorization(expired, 'production', EFFECTS, addMs(T0, 1)).mismatches.includes('expired'));
    assert.equal(matchesAuthorization(expired, 'production', EFFECTS, addMs(T0, -1)).matched, true);
  });

  test('Q17: a changed candidate cannot reuse stale approval; nearest mismatch is reported', () => {
    const r = requireAuthority([prod], 'production', { ...EFFECTS, candidateDigest: 'cand-2' }, T0);
    assert.equal(r.status, 'missing');
    if (r.status === 'missing') {
      assert.equal(r.stopReason, 'release-auth');
      assert.match(r.detail, /candidate digest differs/);
      assert.equal(r.nearest?.record?.id, 'prod-1');
    }
  });

  test('requireAuthority returns the matching record', () => {
    const r = requireAuthority([auth({ id: 'dev', kind: 'development' }), prod], 'production', EFFECTS, T0);
    assert.equal(r.status, 'authorized');
    assert.equal(r.status === 'authorized' && r.record.id, 'prod-1');
  });

  test('Q21: recovery pre-authorization needs the concrete specifics; prose naming rollback is not enough', () => {
    const prose = auth({ id: 'rb', kind: 'recovery', candidateDigest: 'cand-1', environment: 'prod' });
    const r = requireAuthority([prose], 'recovery', { candidateDigest: 'cand-1', environment: 'prod' }, T0);
    assert.equal(r.status, 'missing');
    assert.equal(r.status === 'missing' && r.stopReason, 'rollback-auth');
    assert.match(r.status === 'missing' ? r.detail : '', /recovery record lacks/);
    const real = auth({
      id: 'rb2',
      kind: 'recovery',
      candidateDigest: 'cand-1',
      environment: 'prod',
      recovery: { eligibleBaseline: 'v1.9', healthTrigger: '5xx > 1%', procedure: 'runbook:rollback-deploy', migrationCompatibility: 'expand-only schema', windowMs: 30 * 60_000, owner: 'sre' },
    });
    assert.equal(requireAuthority([real], 'recovery', { candidateDigest: 'cand-1', environment: 'prod' }, T0).status, 'authorized');
  });

  test('Q4: plan-checkpoint approval is bound to the goal revision', () => {
    const chk = auth({ id: 'chk', kind: 'plan-checkpoint', goalRevision: 1 });
    assert.equal(requireAuthority([chk], 'plan-checkpoint', { goalRevision: 1 }, T0).status, 'authorized');
    const r = requireAuthority([chk], 'plan-checkpoint', { goalRevision: 2 }, T0);
    assert.equal(r.status, 'missing');
    assert.equal(r.status === 'missing' && r.stopReason, 'checkpoint');
  });

  test('staging authority binds like production; a generic auth kind maps to STOP/auth', () => {
    const stg = auth({ id: 's', kind: 'staging', candidateDigest: 'cand-1', environment: 'staging', operations: ['deploy'] });
    assert.equal(requireAuthority([stg], 'staging', { candidateDigest: 'cand-1', environment: 'staging', operations: ['deploy'] }, T0).status, 'authorized');
    const r = requireAuthority([], 'development', {}, T0);
    assert.equal(r.status === 'missing' && r.stopReason, 'auth');
  });

  test('approvalPacket presents exact candidate, environment, operations, migrations, evidence and recovery', () => {
    const p = approvalPacket('production', EFFECTS, { changes: '3 files', evidence: ['dod-1'], dataSteps: ['expand-1'], recoveryPlan: 'rollback to v1.9' });
    assert.equal(p.candidateDigest, 'cand-1');
    assert.deepEqual(p.operations, ['deploy']);
    assert.deepEqual(p.evidence, ['dod-1']);
    assert.equal(p.recoveryPlan, 'rollback to v1.9');
    assert.deepEqual(approvalPacket('staging', {}, {}).operations, []);
  });
});
