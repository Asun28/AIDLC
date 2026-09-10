import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE_TRANSITIONS, ReleaseTransitionError, assertReleaseTransition, finalStateForTarget, nextAfterObserve, tagActionRequiresAuthority, transitionRelease } from '../../src/core/release-machine.ts';
import { makeStop } from '../../src/core/stop.ts';
import { T0, auth, release } from './_fixtures.ts';

const EFFECTS = { candidateDigest: 'cand-1', environment: 'prod', operations: ['deploy'] };
const stagingAuth = auth({ id: 'stg', kind: 'staging', candidateDigest: 'cand-1', environment: 'staging', operations: ['deploy'] });
const prodAuth = auth({ id: 'prod', kind: 'production', candidateDigest: 'cand-1', environment: 'prod', operations: ['deploy'] });
const RECOVERY_EFFECTS = { candidateDigest: 'cand-1', environment: 'prod', operations: ['rollback'] };
const recoveryAuth = auth({
  id: 'rb',
  kind: 'recovery',
  candidateDigest: 'cand-1',
  environment: 'prod',
  operations: ['rollback'],
  recovery: { eligibleBaseline: 'v1.9', healthTrigger: '5xx>1%', procedure: 'runbook:rollback', migrationCompatibility: 'expand-only', windowMs: 600_000, owner: 'sre' },
});
const STAGING_EFFECTS = { candidateDigest: 'cand-1', environment: 'staging', operations: ['deploy'] };

describe('release state machine (LC5 / Q16-Q22)', () => {
  test('diagram: terminal states have no exits; CHECKPOINT is reachable only from STAGE/WAIT', () => {
    assert.deepEqual(RELEASE_TRANSITIONS.DONE, []);
    assert.deepEqual(RELEASE_TRANSITIONS.STOP, []);
    assert.ok(!RELEASE_TRANSITIONS.PREPARE.includes('CHECKPOINT'));
    assert.throws(() => assertReleaseTransition(release(), 'APPLY'), ReleaseTransitionError);
    assert.throws(() => assertReleaseTransition(release({ state: 'DONE' }), 'CLOSE'), /terminal/);
    assert.equal(finalStateForTarget('package'), 'PREPARE');
    assert.equal(finalStateForTarget('staging'), 'STAGE');
    assert.equal(finalStateForTarget('production'), 'OBSERVE');
  });

  test('Q16: a package-only goal finishes after PREPARE with install/run proof', () => {
    assert.throws(() => assertReleaseTransition(release(), 'DONE'), /package install\/run proof missing/);
    const done = transitionRelease(release(), 'DONE', T0, { packageRunProof: true });
    assert.equal(done.state, 'DONE');
    assert.equal(done.disposition, 'delivered');
    assert.throws(() => assertReleaseTransition(release(), 'STAGE', { candidateVerified: true }), /package goal has no staging stage/);
  });

  test('Q16: a staging goal finishes after STAGE and can never enter CHECKPOINT', () => {
    const stg = release({ target: 'staging' });
    const staged = transitionRelease(stg, 'STAGE', T0, { candidateVerified: true, providersConfigured: true, authorizations: [stagingAuth], effects: STAGING_EFFECTS });
    assert.equal(staged.state, 'STAGE');
    assert.throws(() => assertReleaseTransition(staged, 'CHECKPOINT', { stagingVerified: true }), /CHECKPOINT is a production step/);
    assert.throws(() => assertReleaseTransition(staged, 'DONE'), /staging verification incomplete/);
    const done = transitionRelease(staged, 'DONE', T0, { stagingVerified: true });
    assert.equal(done.state, 'DONE');
    assert.equal(done.disposition, 'delivered');
  });

  test('Q18/LC3: NOT CONFIGURED providers stop with STOP/release-config instead of pretending', () => {
    const stg = release({ target: 'staging' });
    const stopped = transitionRelease(stg, 'STAGE', T0, { candidateVerified: true, providersConfigured: false, authorizations: [stagingAuth], effects: STAGING_EFFECTS });
    assert.equal(stopped.state, 'STOP');
    assert.equal(stopped.stop?.reason, 'release-config');
    assert.equal(stopped.disposition, 'failed');
    const prod = release({ target: 'production', state: 'CHECKPOINT' });
    const s2 = transitionRelease(prod, 'APPLY', T0, { providersConfigured: false, authorizations: [prodAuth], effects: EFFECTS });
    assert.equal(s2.stop?.reason, 'release-config');
  });

  test('Q17: staging authority is scoped; missing it is STOP/release-auth', () => {
    const stg = release({ target: 'staging' });
    const stopped = transitionRelease(stg, 'STAGE', T0, { candidateVerified: true, providersConfigured: true, authorizations: [prodAuth], effects: STAGING_EFFECTS });
    assert.equal(stopped.state, 'STOP');
    assert.equal(stopped.stop?.reason, 'release-auth');
  });

  test('Q17: production CHECKPOINT needs verified staging; APPLY needs a matching production authority', () => {
    const prod = release({ target: 'production', state: 'STAGE' });
    assert.throws(() => assertReleaseTransition(prod, 'CHECKPOINT'), /staging verification and recovery readiness/);
    const chk = transitionRelease(prod, 'CHECKPOINT', T0, { stagingVerified: true });
    assert.equal(chk.state, 'CHECKPOINT');
    const stale = transitionRelease(chk, 'APPLY', T0, { providersConfigured: true, authorizations: [prodAuth], effects: { ...EFFECTS, candidateDigest: 'cand-2' } });
    assert.equal(stale.state, 'STOP');
    assert.equal(stale.stop?.reason, 'release-auth');
    assert.match(stale.stop?.detail ?? '', /candidate digest differs/);
    const applied = transitionRelease(chk, 'APPLY', T0, { providersConfigured: true, authorizations: [prodAuth], effects: EFFECTS });
    assert.equal(applied.state, 'APPLY');
    assert.equal(transitionRelease(applied, 'OBSERVE', T0).state, 'OBSERVE');
  });

  test('Q19: OBSERVE closes only on PASS; INSUFFICIENT_DATA never closes; BREACH routes to RECOVER', () => {
    const obs = release({ target: 'production', state: 'OBSERVE' });
    assert.throws(() => assertReleaseTransition(obs, 'CLOSE', { health: 'INSUFFICIENT_DATA' }), /is not PASS/);
    assert.throws(() => assertReleaseTransition(obs, 'CLOSE'), /is not PASS/);
    assert.equal(transitionRelease(obs, 'CLOSE', T0, { health: 'PASS' }).state, 'CLOSE');
    assert.equal(nextAfterObserve('BREACH', false, true), 'RECOVER');
    assert.equal(nextAfterObserve('PASS', true, true), 'CLOSE');
    assert.equal(nextAfterObserve('PASS', false, true), 'WAIT');
    assert.equal(nextAfterObserve('INSUFFICIENT_DATA', true, true), 'WAIT');
    assert.equal(nextAfterObserve('INSUFFICIENT_DATA', true, false), 'STOP');
  });

  test('Q21: RECOVER needs an applicable procedure and a real recovery authority, else STOP/rollback-auth', () => {
    const obs = release({ target: 'production', state: 'OBSERVE', candidateDigest: 'cand-1' });
    const notApplicable = transitionRelease(obs, 'RECOVER', T0, { recoveryApplicable: false, authorizations: [recoveryAuth], effects: RECOVERY_EFFECTS });
    assert.equal(notApplicable.stop?.reason, 'rollback-auth');
    const noAuth = transitionRelease(obs, 'RECOVER', T0, { recoveryApplicable: true, authorizations: [prodAuth], effects: RECOVERY_EFFECTS });
    assert.equal(noAuth.state, 'STOP');
    assert.equal(noAuth.stop?.reason, 'rollback-auth');
    const wrongOps = transitionRelease(obs, 'RECOVER', T0, { recoveryApplicable: true, authorizations: [recoveryAuth], effects: { ...RECOVERY_EFFECTS, operations: ['restore-db'] } });
    assert.equal(wrongOps.stop?.reason, 'rollback-auth', 'the recovery record permits only its named procedure');
    const recovering = transitionRelease(obs, 'RECOVER', T0, { recoveryApplicable: true, authorizations: [recoveryAuth], effects: RECOVERY_EFFECTS });
    assert.equal(recovering.state, 'RECOVER');
    assert.equal(recovering.disposition, 'recovered');
  });

  test('Q22: recovery is reported as recovered, never as delivery of the failed candidate', () => {
    const rec = release({ target: 'production', state: 'RECOVER', disposition: 'recovered' });
    assert.throws(() => assertReleaseTransition(rec, 'CLOSE'), /recovered environment\/data state not verified/);
    const closed = transitionRelease(rec, 'CLOSE', T0, { recoveryVerified: true });
    assert.equal(closed.disposition, 'recovered');
    const done = transitionRelease(closed, 'DONE', T0, { closureComplete: true });
    assert.equal(done.state, 'DONE');
    assert.equal(done.disposition, 'recovered');
  });

  test('a successful production release closes as delivered', () => {
    const closed = release({ target: 'production', state: 'CLOSE' });
    assert.throws(() => assertReleaseTransition(closed, 'DONE'), /release closure incomplete/);
    assert.equal(transitionRelease(closed, 'DONE', T0, { closureComplete: true }).disposition, 'delivered');
  });

  test('explicit STOP needs a reason and fails a pending disposition', () => {
    const stg = release({ target: 'staging', state: 'STAGE' });
    assert.throws(() => transitionRelease(stg, 'STOP', T0), /STOP requires a recorded reason/);
    const s = transitionRelease(stg, 'STOP', T0, {}, makeStop('release-health', 'no telemetry', 'wire probes', { at: T0 }));
    assert.equal(s.disposition, 'failed');
    assert.equal(s.stop?.reason, 'release-health');
  });

  test('Q17: tag/publish actions that trigger external publication need authority', () => {
    assert.equal(tagActionRequiresAuthority({ pushesTag: true }), true);
    assert.equal(tagActionRequiresAuthority({ workflowTriggeredByTag: true }), true);
    assert.equal(tagActionRequiresAuthority({ createsRelease: true }), true);
    assert.equal(tagActionRequiresAuthority({}), false);
  });
});
