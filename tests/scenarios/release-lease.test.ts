// Card T0-STAGING-LEASE-RELEASE: a release attempt that ends (DONE or STOP) with no unresolved operation of its own releases
// every environment lease it claimed, deciding and writing in one lease section; one that leaves an unresolved operation
// keeps them. A failed release is named with `aidlc release next <attemptId>`, which exits 0 on a stopped goal.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, renameSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, driveCardToDone, opsConfigured, opsRunner, candidateShaFor, actorA, actorB, T0 } from './_harness.ts';
import { ReleaseRunner, releaseOperationOf, type ReleaseDirective } from '../../src/loop/release-runner.ts';
import { ReleaseAttempt, HOUR_MS, MINUTE_MS, addMs, type ActorIdentity, type HealthSignal, type Lease, type OperationStatus, type ReleaseState } from '../../src/core/types.ts';
import { LeaseStore } from '../../src/coordination/lease.ts';
import { OperationLedger } from '../../src/coordination/reconcile.ts';
import type { StoreError } from '../../src/state/store.ts';
import { cleanup } from '../infra/helpers.ts';
import { makeStop } from '../../src/core/stop.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { OpsLoad } from '../../src/delivery/ops.ts';

type Fx = ReturnType<typeof makeFixture>;
type Deps = ConstructorParameters<typeof ReleaseRunner>[0];

const STAGING = 'env:staging';
const PRODUCTION = 'env:production';
const UNRESOLVED: OperationStatus[] = ['intended', 'issued', 'running', 'UNKNOWN'];
const PAST = new Date('2020-01-01T00:00:00.000Z');

/** A fresh fixture whose temporary directory the test's after hook removes. */
function inFixture(t: TestContext, body: (fx: Fx) => void): void {
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  body(fx);
}

function signal(observed: number, at: string): HealthSignal {
  return { name: 'http_5xx_rate', source: 'prometheus', threshold: { op: '<', value: 1 }, observed, samples: 20, minSamples: 5, lastSampleAt: at, maxStalenessMs: 5 * MINUTE_MS, synthetic: false, probeAvailable: true };
}

function releaseRunner(fx: Fx, extra: Partial<Deps> = {}): ReleaseRunner {
  return new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store, ops: fx.ops, leases: fx.leases, runner: opsRunner, opsLoad: opsConfigured(), now: fx.now, signals: () => [signal(0.1, fx.now())], ...extra });
}

/** A goal driven to DELIVER with its attempt's candidate bound and staging approved. */
function delivering(fx: Fx, target: 'staging' | 'production', release: ReleaseRunner): { goalId: string; attemptId: string } {
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goalId = goalForCards(fx, ['T1-HELLO'], { target }).id;
  driveCardToDone(fx, goalId, 'T1-HELLO');
  assert.equal(fx.controller.next(goalId).kind, 'verify-arc');
  const rep = fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: {} });
  const attemptId = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
  assert.ok(attemptId, rep.directive.narration);
  release.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
  fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest: 'c1', environment: 'staging' } });
  return { goalId, attemptId };
}

const step = (fx: Fx, release: ReleaseRunner, goalId: string, attemptId: string) => release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);

/** A production attempt driven from STAGE to CHECKPOINT (it has claimed env:staging and deployed there). */
function toCheckpoint(fx: Fx, release: ReleaseRunner, goalId: string, attemptId: string): void {
  const r = step(fx, release, goalId, attemptId);
  const cp = release.next(fx.goal(goalId), release.reportStep(fx.goal(goalId), r.attempt, 'stage-verify', 'succeeded'));
  assert.equal(cp.attempt.state, 'CHECKPOINT', cp.directive.narration);
}

const approveProduction = (fx: Fx, goalId: string) => fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'production', by: 'release-manager', candidateDigest: 'c1', environment: 'production', operations: ['deploy'] } });

/** An attempt of a fresh goal saved directly in `state` (STOP carries a stop record, DONE the delivered disposition). */
function stored(fx: Fx, state: ReleaseState, overrides: Partial<ReleaseAttempt> = {}): ReleaseAttempt {
  const target = overrides.target ?? 'staging';
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goalId = goalForCards(fx, ['T1-HELLO'], { target: target === 'production' ? 'production' : 'staging' }).id;
  const terminal = state === 'STOP' ? { stop: makeStop('release-health', 'staging deployment failed', 'diagnose', { at: T0, global: false }), disposition: 'failed' as const } : state === 'DONE' ? { disposition: 'delivered' as const } : {};
  const attempt = ReleaseAttempt.parse({ id: `rel-${goalId}-1`, goalId, generation: 0, target, environment: target, state, candidateDigest: 'c1', sourceSha: 's1', startedAt: T0, deadline: addMs(T0, 12 * HOUR_MS), updatedAt: T0, ...terminal, ...overrides });
  fx.store.saveRelease(attempt);
  return attempt;
}

/** A lease of `environment` acquired by `actor` (this session by default) at `at` (now by default). */
function hold(fx: Fx, environment: string, operation: string | undefined, options: { actor?: ActorIdentity; at?: string } = {}): Lease {
  const claim = fx.leases.claim(`env:${environment}`, { actor: options.actor ?? actorA, operation, now: options.at ?? fx.now() });
  assert.equal(claim.status, 'acquired');
  return fx.leases.read(`env:${environment}`)!;
}

const released = (fx: Fx, key: string) => fx.leases.read(key)?.released === true;
const held = (fx: Fx, key: string) => fx.leases.read(key)?.released === false;

/** A fabricated ledger record at a distinct time `minute` minutes before T0, in the given status. */
function record(fx: Fx, minute: number, fields: { goalId: string; kind?: 'deploy' | 'rollback'; releaseAttempt?: string; idempotencyKey?: string; target?: string; status: OperationStatus }): string {
  const at = addMs(T0, -minute * MINUTE_MS);
  const rec = fx.ops.recordIntent({ kind: fields.kind ?? 'deploy', goalId: fields.goalId, releaseAttempt: fields.releaseAttempt, target: fields.target ?? 'staging', candidateDigest: 'c1', idempotencyKey: fields.idempotencyKey, ownerGeneration: 0, timeoutMs: 60_000 }, at);
  if (fields.status === 'issued') fx.ops.markIssued(rec.id, undefined, at);
  else if (fields.status === 'running') fx.ops.markRunning(rec.id, at);
  else if (fields.status !== 'intended') fx.ops.markResult(rec.id, fields.status, {}, at);
  return rec.id;
}

/** R5: the narration names each failed key, its error and the command that retries the cleanup. */
function assertRetryNamed(d: ReleaseDirective, attemptId: string, key: string, error: RegExp | string): void {
  assert.ok(d.narration.includes(key), d.narration);
  if (typeof error === 'string') assert.ok(d.narration.includes(error), d.narration);
  else assert.match(d.narration, error);
  assert.ok(d.narration.includes(`aidlc release next ${attemptId}`), d.narration);
}

test('a staging attempt that ends in DONE releases env:staging, and another session then acquires it', (t) => {
  inFixture(t, (fx) => {
    const release = releaseRunner(fx);
    const { goalId, attemptId } = delivering(fx, 'staging', release);
    const r = step(fx, release, goalId, attemptId);
    assert.equal(r.directive.kind, 'stage', r.directive.narration);
    const done = release.next(fx.goal(goalId), release.reportStep(fx.goal(goalId), r.attempt, 'stage-verify', 'succeeded'));
    assert.equal(done.attempt.state, 'DONE', done.directive.narration);
    fx.advance(11 * MINUTE_MS);
    assert.equal(fx.leases.claim(STAGING, { actor: actorB, operation: 'release:rel-other', now: fx.now() }).status, 'acquired');
  });
});

test('a delivered production attempt releases the staging and the production lease it claimed', (t) => {
  inFixture(t, (fx) => {
    const release = releaseRunner(fx);
    const { goalId, attemptId } = delivering(fx, 'production', release);
    toCheckpoint(fx, release, goalId, attemptId);
    assert.equal(held(fx, STAGING), true, 'env:staging stays held while the attempt waits at CHECKPOINT');
    approveProduction(fx, goalId);
    let r = step(fx, release, goalId, attemptId);
    assert.equal(r.attempt.state, 'OBSERVE', r.directive.narration);
    assert.deepEqual({ staging: held(fx, STAGING), production: held(fx, PRODUCTION) }, { staging: true, production: true }, 'both held while the attempt observes');
    fx.advance(Date.parse(r.attempt.healthWindow!.to) - Date.parse(fx.now()) + MINUTE_MS);
    r = step(fx, release, goalId, attemptId);
    assert.equal(r.attempt.state, 'CLOSE', r.directive.narration);
    r = step(fx, release, goalId, attemptId);
    assert.equal(r.attempt.disposition, 'delivered', r.directive.narration);
    assert.deepEqual({ staging: released(fx, STAGING), production: released(fx, PRODUCTION) }, { staging: true, production: true });
  });
});

test('every terminal path passes the one exit', (t) => {
  inFixture(t, (fx) => {
    const release = releaseRunner(fx, { runner: scriptedRunner({ 'deploy-cmd': { stdout: 'FAILED', exitCode: 1 } }) });
    const { goalId, attemptId } = delivering(fx, 'staging', release);
    const r = step(fx, release, goalId, attemptId);
    assert.equal(r.attempt.stop?.reason, 'release-health', r.directive.narration);
    assert.equal(released(fx, STAGING), true, 'failed staging deploy');
  });
  inFixture(t, (fx) => {
    const ops = opsConfigured();
    const publishing: OpsLoad = ops.status === 'configured' ? { ...ops, config: { ...ops.config, operations: ops.config.operations.map((o) => (o.role === 'deploy' ? { ...o, triggersPublication: true } : o)) } } : ops;
    const release = releaseRunner(fx, { opsLoad: publishing });
    const { goalId, attemptId } = delivering(fx, 'staging', release);
    const r = step(fx, release, goalId, attemptId);
    assert.equal(r.attempt.stop?.reason, 'release-auth', r.directive.narration);
    assert.equal(released(fx, STAGING), true, 'publishing deploy without production authority');
  });
  inFixture(t, (fx) => {
    const release = releaseRunner(fx);
    const { goalId, attemptId } = delivering(fx, 'production', release);
    toCheckpoint(fx, release, goalId, attemptId);
    const other = hold(fx, 'production', 'release:rel-other', { actor: actorB, at: addMs(fx.now(), -20 * MINUTE_MS) });
    approveProduction(fx, goalId);
    const r = step(fx, release, goalId, attemptId);
    assert.equal(r.attempt.stop?.reason, 'ownership', r.directive.narration);
    assert.equal(released(fx, STAGING), true, 'ownership stop at APPLY: own env:staging');
    assert.deepEqual(fx.leases.read(PRODUCTION), other, 'ownership stop at APPLY: the other session lease');
  });
  for (const state of ['STOP', 'DONE'] as const) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, state);
      hold(fx, 'staging', `release:${attempt.id}`);
      const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
      assert.equal(r.directive.kind, state === 'STOP' ? 'stop' : 'done');
      assert.equal(released(fx, STAGING), true, `attempt stored in ${state}`);
    });
  }
  inFixture(t, (fx) => {
    // T0-RELEASE-OP-REISSUE R6: a settled record of another kind under the step's key stops the attempt for audit in `issue`.
    const attempt = stored(fx, 'STAGE');
    record(fx, 1, { goalId: attempt.goalId, kind: 'rollback', idempotencyKey: `${attempt.id}:stage-deploy:c1`, status: 'succeeded' });
    const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.attempt.stop?.reason, 'audit', r.directive.narration);
    assert.equal(released(fx, STAGING), true, 'STOP audit from issue');
  });
});

test('an attempt with an unresolved operation keeps its leases', (t) => {
  for (const status of UNRESOLVED) {
    for (const association of ['releaseAttempt', 'key only', 'key of another attempt'] as const) {
      for (const state of ['STOP', 'DONE'] as const) {
        inFixture(t, (fx) => {
          const attempt = stored(fx, state);
          hold(fx, 'staging', `release:${attempt.id}`);
          const key = `${attempt.id}:stage-deploy:c1`;
          record(fx, 1, { goalId: attempt.goalId, status, ...(association === 'releaseAttempt' ? { releaseAttempt: attempt.id } : { idempotencyKey: key, releaseAttempt: association === 'key only' ? undefined : 'rel-other' }) });
          releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
          assert.equal(held(fx, STAGING), true, `${status}, ${association}, ${state}`);
        });
      }
    }
  }
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'STAGE', { deadline: addMs(T0, -10 * MINUTE_MS) });
    hold(fx, 'staging', `release:${attempt.id}`);
    record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, status: 'UNKNOWN' });
    const release = releaseRunner(fx);
    const r = release.next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.attempt.stop?.reason, 'time', r.directive.narration);
    assert.equal(held(fx, STAGING), true, 'STOP time after the reconciliation grace');
    release.next(fx.goal(attempt.goalId), fx.store.getRelease(attempt.id)!);
    assert.equal(held(fx, STAGING), true, 'a further next on the STOP time attempt');
  });
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'STOP');
    hold(fx, 'staging', `release:${attempt.id}`);
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'a terminal attempt with no ledger record');
  });
  for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, 'STOP');
      hold(fx, 'staging', `release:${attempt.id}`);
      record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, status });
      releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
      assert.equal(released(fx, STAGING), true, `a ${status} record of the attempt`);
    });
  }
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'STOP');
    hold(fx, 'staging', `release:${attempt.id}`);
    record(fx, 1, { goalId: attempt.goalId, releaseAttempt: 'rel-other', target: 'production', status: 'intended' });
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'an unresolved record of another attempt on another environment, without the key (R12 keeps a lease for one on the same environment, acceptance 13)');
  });
});

test("only the attempt's own lease of this session and host is released", (t) => {
  const cases: { label: string; lease: (fx: Fx, attemptId: string) => Lease | undefined; released: boolean }[] = [
    { label: 'no operation', lease: (fx) => hold(fx, 'production', undefined), released: false },
    { label: 'another attempt', lease: (fx) => hold(fx, 'production', 'release:rel-other'), released: false },
    { label: 'the attempt id with a suffix', lease: (fx, id) => hold(fx, 'production', `release:${id}-2`), released: false },
    { label: 'another session', lease: (fx, id) => hold(fx, 'production', `release:${id}`, { actor: actorB }), released: false },
    { label: 'this session on another host', lease: (fx, id) => hold(fx, 'production', `release:${id}`, { actor: { ...actorA, host: 'h2' } }), released: false },
    {
      label: 'released',
      lease: (fx, id) => {
        const l = hold(fx, 'production', `release:${id}`);
        fx.leases.release(PRODUCTION, l.generation, actorA);
        return fx.leases.read(PRODUCTION);
      },
      released: false,
    },
    { label: 'absent', lease: () => undefined, released: false },
    { label: 'expired, of this session', lease: (fx, id) => hold(fx, 'production', `release:${id}`, { at: addMs(T0, -20 * MINUTE_MS) }), released: true },
  ];
  for (const c of cases) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, 'CLOSE', { target: 'production' });
      const before = c.lease(fx, attempt.id);
      // A lease left unchanged is not written either: its file keeps a modification time set in the past.
      const file = fx.leases.file(PRODUCTION);
      if (before) utimesSync(file, PAST, PAST);
      const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
      assert.equal(r.attempt.state, 'DONE', r.directive.narration);
      assert.deepEqual(fx.leases.read(PRODUCTION), before && (c.released ? { ...before, released: true } : before), c.label);
      if (before && !c.released) assert.equal(statSync(file).mtimeMs, PAST.getTime(), `${c.label}: not written`);
    });
  }
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'DONE', { environment: 'Staging' });
    hold(fx, 'staging', `release:${attempt.id}`);
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'environment Staging releases env:staging');
  });
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'DONE', { environment: 'Staging' });
    mkdirSync(fx.paths.leases, { recursive: true });
    writeFileSync(fx.leases.file(STAGING), '{not json');
    const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.ok(r.directive.narration.includes(`${STAGING} (`), `environment Staging is named by the key env:staging: ${r.directive.narration}`);
  });
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'DONE', { target: 'production' });
    hold(fx, 'staging', `release:${attempt.id}`);
    record(fx, 1, { goalId: attempt.goalId, idempotencyKey: `${attempt.id}:stage-deploy:c1`, target: 'staging', status: 'succeeded' });
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'the target of a record that belongs by its key');
  });
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'DONE', { environment: undefined });
    const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.directive.narration, 'Release attempt delivered.', 'no environment and no record: nothing to release');
  });
});

test('a renewal for another attempt that lands before the cleanup takes the lock keeps the lease', (t) => {
  inFixture(t, (fx) => {
    let attemptId = '';
    let renewal: Lease | undefined;
    let renewing = false;
    // A renewal by this session for another attempt, landing on the first env:staging section after the attempt was saved terminal.
    const leases = new (class extends LeaseStore {
      override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
        const state = attemptId ? fx.store.getRelease(attemptId)?.state : undefined;
        if (!renewing && key === STAGING && (state === 'DONE' || state === 'STOP')) {
          renewing = true;
          renewal = this.claim(STAGING, { operation: 'release:rel-other', now: fx.now() }).lease;
        }
        return super.update(key, change);
      }
    })(fx.paths.leases);
    const release = releaseRunner(fx, { leases });
    const d = delivering(fx, 'staging', release);
    attemptId = d.attemptId;
    const r = step(fx, release, d.goalId, attemptId);
    const done = release.next(fx.goal(d.goalId), release.reportStep(fx.goal(d.goalId), r.attempt, 'stage-verify', 'succeeded'));
    assert.equal(done.attempt.state, 'DONE', done.directive.narration);
    assert.ok(renewal, 'the renewal for another attempt landed after the attempt was saved DONE');
    const after = fx.leases.read(STAGING);
    assert.deepEqual({ released: after?.released, operation: after?.operation, generation: after?.generation }, { released: false, operation: 'release:rel-other', generation: renewal.generation });
  });
});

test('a lease cleanup that fails leaves the attempt terminal, releases the other leases and names the command that retries it', (t) => {
  inFixture(t, (fx) => {
    let failures = 1;
    const leases = new (class extends LeaseStore {
      override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
        if (key === STAGING && failures > 0) {
          failures--;
          throw new Error('lease section unavailable');
        }
        return super.update(key, change);
      }
    })(fx.paths.leases);
    const attempt = stored(fx, 'CLOSE', { target: 'production' });
    record(fx, 2, { goalId: attempt.goalId, releaseAttempt: attempt.id, idempotencyKey: `${attempt.id}:stage-deploy:c1`, target: 'staging', status: 'succeeded' });
    record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, idempotencyKey: `${attempt.id}:apply-deploy:c1`, target: 'production', status: 'succeeded' });
    hold(fx, 'staging', `release:${attempt.id}`);
    hold(fx, 'production', `release:${attempt.id}`);
    const release = releaseRunner(fx, { leases });
    const r = release.next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.directive.kind, 'done', r.directive.narration);
    assertRetryNamed(r.directive, attempt.id, STAGING, 'lease section unavailable');
    assert.equal(released(fx, PRODUCTION), true, 'the other lease is released');
    assert.equal(fx.store.getRelease(attempt.id)?.state, 'DONE');
    assert.equal(held(fx, STAGING), true);
    release.next(fx.goal(attempt.goalId), fx.store.getRelease(attempt.id)!);
    assert.equal(released(fx, STAGING), true, 'the retry releases env:staging');
  });
  inFixture(t, (fx) => {
    // A STOP reached through a nested step (the failed deploy `issue` hands back to the step logic) is cleaned up once, at the exit.
    let attemptId = '';
    let failures = 1;
    const leases = new (class extends LeaseStore {
      override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
        const state = attemptId ? fx.store.getRelease(attemptId)?.state : undefined;
        if (key === STAGING && failures > 0 && (state === 'DONE' || state === 'STOP')) {
          failures--;
          throw new Error('lease section unavailable');
        }
        return super.update(key, change);
      }
    })(fx.paths.leases);
    const release = releaseRunner(fx, { leases, runner: scriptedRunner({ 'deploy-cmd': { stdout: 'FAILED', exitCode: 1 } }) });
    const d = delivering(fx, 'staging', release);
    attemptId = d.attemptId;
    const r = step(fx, release, d.goalId, attemptId);
    assert.equal(r.attempt.stop?.reason, 'release-health', r.directive.narration);
    assertRetryNamed(r.directive, attemptId, STAGING, 'lease section unavailable');
    assert.equal(r.directive.narration.split('lease section unavailable').length, 2, `named once: ${r.directive.narration}`);
    assert.equal(held(fx, STAGING), true, 'a nested STOP is cleaned up at the exit alone');
  });
  for (const [label, content, error] of [
    ['malformed', '{not json', /MALFORMED_JSON/],
    ['not a lease', JSON.stringify({ resourceKey: STAGING }), /SCHEMA_VIOLATION/],
  ] as const) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, 'DONE');
      mkdirSync(fx.paths.leases, { recursive: true });
      writeFileSync(fx.leases.file(STAGING), content);
      const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
      assert.equal(r.directive.kind, 'done', label);
      assertRetryNamed(r.directive, attempt.id, STAGING, error);
      assert.equal(fx.store.getRelease(attempt.id)?.state, 'DONE', label);
    });
  }
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'STOP');
    hold(fx, 'staging', `release:${attempt.id}`);
    const lock = `${fx.leases.file(STAGING)}.lock`;
    writeFileSync(lock, `pid=${process.pid} at=${T0} nonce=held`);
    const r = releaseRunner(fx, { leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }) }).next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.directive.kind, 'stop');
    assertRetryNamed(r.directive, attempt.id, STAGING, /LOCKED/);
    assert.equal(held(fx, STAGING), true, 'a held lock leaves the lease as it was');
    rmSync(lock);
    releaseRunner(fx).next(fx.goal(attempt.goalId), fx.store.getRelease(attempt.id)!);
    assert.equal(released(fx, STAGING), true, 'the retry after the lock is freed releases it');
  });
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'STOP');
    hold(fx, 'staging', `release:${attempt.id}`);
    writeFileSync(path.join(fx.paths.operations, 'op-unreadable.json'), '{');
    const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.directive.kind, 'stop');
    assertRetryNamed(r.directive, attempt.id, 'operation ledger', /MALFORMED_JSON/);
    assert.equal(held(fx, STAGING), true, 'an unreadable ledger keeps every lease');
  });
});

/** A child process environment: no inherited variable whose name starts with GIT_, and git stopped above the fixture. */
function childEnv(fx: Fx, extra: Record<string, string>): NodeJS.ProcessEnv {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')));
  return { ...inherited, GIT_CEILING_DIRECTORIES: path.dirname(fx.tmp), ...extra };
}

test('aidlc release next run twice on a stopped attempt exits 0 both times', (t) => {
  inFixture(t, (fx) => {
    const { goalId, attemptId } = delivering(fx, 'staging', releaseRunner(fx));
    fx.store.saveRelease(ReleaseAttempt.parse({ ...fx.store.getRelease(attemptId)!, environment: 'staging', state: 'STOP', stop: makeStop('release-health', 'staging deployment failed', 'diagnose', { at: T0, global: false }), disposition: 'failed' }));
    const session = 'release-lease-cli';
    hold(fx, 'staging', `release:${attemptId}`, { actor: { session, pid: 1, processStart: T0, host: os.hostname() } });
    const run = () => spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'release', 'next', attemptId], { cwd: fx.tmp, env: childEnv(fx, { AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: session }), encoding: 'utf8', timeout: 60_000 });
    const reports = () => fx.events(goalId).filter((e) => e.type === 'RELEASE_STATE' && e.data['state'] === 'STOP').length;
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(fx.goal(goalId).terminal, true, 'the first run reports release-result and stops the goal');
    const reported = reports();
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.equal(reports(), reported, 'the second run skips the report');
    assert.equal(released(fx, STAGING), true);
  });
});

/** Whenever an operation of the attempt is unresolved, the attempt's lease on `key` is held (the forbid of the card). */
function assertNoUnresolvedWithoutLease(fx: Fx, attempt: ReleaseAttempt, key: string): void {
  const open = fx.ops.list({ goalId: attempt.goalId }).filter((o) => releaseOperationOf(o, attempt) && UNRESOLVED.includes(o.status));
  if (open.length) assert.equal(held(fx, key), true, `${open.map((o) => `${o.id} ${o.status}`).join(', ')} with ${key} released`);
}

test('an intent recorded around the cleanup is seen by its lease section or never recorded for a released lease', (t) => {
  // The intent lands after the cleanup's first ledger read and before its lease section takes the lock.
  for (const status of ['intended', 'running'] as const) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, 'STOP');
      hold(fx, 'staging', `release:${attempt.id}`);
      let recorded = '';
      const leases = new (class extends LeaseStore {
        override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
          if (key === STAGING && !recorded) recorded = record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, idempotencyKey: `${attempt.id}:stage-deploy:c1`, status });
          return super.update(key, change);
        }
      })(fx.paths.leases);
      releaseRunner(fx, { leases }).next(fx.goal(attempt.goalId), attempt);
      assert.equal(fx.ops.get(recorded)?.status, status, 'the intent landed before the section');
      assertNoUnresolvedWithoutLease(fx, attempt, STAGING);
      assert.equal(held(fx, STAGING), true, `${status}: the section saw the record and kept the lease`);
    });
  }
  // The reverse order: a caller holding a STAGE copy of the attempt claimed the lease, then the cleanup of the stored terminal
  // attempt released it (or the lease changed otherwise) before that caller's `issue` took the lock.
  const interventions: [string, (fx: Fx, attempt: ReleaseAttempt) => void][] = [
    ['released by the cleanup', (fx, attempt) => void releaseRunner(fx).next(fx.goal(attempt.goalId), fx.store.getRelease(attempt.id)!)],
    ['renewed by this session for another attempt', (fx) => void fx.leases.claim(STAGING, { operation: 'release:rel-other', now: fx.now() })],
    ['removed', (fx) => rmSync(fx.leases.file(STAGING))],
  ];
  for (const [label, intervene] of interventions) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, 'STOP');
      let intervened = false;
      const leases = new (class extends LeaseStore {
        override claim(key: string, options: Parameters<LeaseStore['claim']>[1] = {}): ReturnType<LeaseStore['claim']> {
          const claimed = super.claim(key, options);
          if (key === STAGING && !intervened) {
            intervened = true;
            intervene(fx, attempt);
          }
          return claimed;
        }
      })(fx.paths.leases);
      let runs = 0;
      const runner = scriptedRunner({ 'deploy-cmd': () => (runs++, { stdout: 'ok id=dep1', exitCode: 0 }) });
      const stale = ReleaseAttempt.parse({ ...attempt, state: 'STAGE', stop: undefined, disposition: 'pending' });
      const r = releaseRunner(fx, { leases, runner, opsLoad: opsConfigured({ asyncDeploy: true }) }).next(fx.goal(attempt.goalId), stale);
      assert.ok(intervened, label);
      assertNoUnresolvedWithoutLease(fx, attempt, STAGING);
      assert.deepEqual({ kind: r.directive.kind, on: r.directive.kind === 'wait' ? r.directive.on : undefined, runs, records: fx.ops.list({ goalId: attempt.goalId }).length }, { kind: 'wait', on: 'environment:staging', runs: 0, records: 0 }, `${label}: ${r.directive.narration}`);
    });
  }
  // A ledger that becomes unreadable after the first read keeps the lease whose section met it and every key after it; the keys
  // are the attempt's environment (production) first, then the record's target (staging).
  for (const [breakAt, kept, releasedKeys] of [
    [PRODUCTION, [PRODUCTION, STAGING], []],
    [STAGING, [STAGING], [PRODUCTION]],
  ] as const) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, 'DONE', { target: 'production' });
      record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, target: 'staging', status: 'succeeded' });
      hold(fx, 'production', `release:${attempt.id}`);
      hold(fx, 'staging', `release:${attempt.id}`);
      let broken = false;
      const leases = new (class extends LeaseStore {
        override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
          if (!broken && key === breakAt) {
            broken = true;
            writeFileSync(path.join(fx.paths.operations, 'op-unreadable.json'), '{');
          }
          return super.update(key, change);
        }
      })(fx.paths.leases);
      const r = releaseRunner(fx, { leases }).next(fx.goal(attempt.goalId), attempt);
      assert.equal(r.directive.kind, 'done');
      assertRetryNamed(r.directive, attempt.id, 'operation ledger', /MALFORMED_JSON/);
      assert.ok(r.directive.narration.includes(`environment leases ${kept.join(', ')} kept`), r.directive.narration);
      assert.deepEqual({ held: [PRODUCTION, STAGING].filter((k) => held(fx, k)), released: [PRODUCTION, STAGING].filter((k) => released(fx, k)) }, { held: kept, released: releasedKeys }, `broken at ${breakAt}`);
    });
  }
  inFixture(t, (fx) => {
    // A failed lease section before the ledger failure is named as well.
    const attempt = stored(fx, 'DONE', { target: 'production' });
    record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, target: 'staging', status: 'succeeded' });
    hold(fx, 'production', `release:${attempt.id}`);
    hold(fx, 'staging', `release:${attempt.id}`);
    const leases = new (class extends LeaseStore {
      override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
        if (key === PRODUCTION) throw new Error('lease section unavailable');
        writeFileSync(path.join(fx.paths.operations, 'op-unreadable.json'), '{');
        return super.update(key, change);
      }
    })(fx.paths.leases);
    const r = releaseRunner(fx, { leases }).next(fx.goal(attempt.goalId), attempt);
    assertRetryNamed(r.directive, attempt.id, PRODUCTION, 'lease section unavailable');
    assert.ok(r.directive.narration.includes(`environment leases ${STAGING} kept`), r.directive.narration);
    assert.deepEqual({ production: held(fx, PRODUCTION), staging: held(fx, STAGING) }, { production: true, staging: true });
  });
});

/** A production attempt stored in STOP holding env:production and env:staging, and a RECOVER copy of it as an older caller sees it. */
function stoppedWithRecoverCopy(fx: Fx): { attempt: ReleaseAttempt; copy: ReleaseAttempt } {
  const attempt = stored(fx, 'STOP', { target: 'production' });
  record(fx, 2, { goalId: attempt.goalId, releaseAttempt: attempt.id, idempotencyKey: `${attempt.id}:stage-deploy:c1`, target: 'staging', status: 'succeeded' });
  record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, idempotencyKey: `${attempt.id}:apply-deploy:c1`, target: 'production', status: 'failed' });
  hold(fx, 'production', `release:${attempt.id}`);
  hold(fx, 'staging', `release:${attempt.id}`);
  return { attempt, copy: ReleaseAttempt.parse({ ...attempt, state: 'RECOVER', stop: undefined, disposition: 'pending' }) };
}

const rollbacks = (fx: Fx, attempt: ReleaseAttempt) => fx.ops.list({ goalId: attempt.goalId }).filter((o) => o.kind === 'rollback').length;

test('the admission and the cleanup of one attempt never interleave across two environments', (t) => {
  // The admission of a recovery reached while the cleanup holds the attempt section, after env:production, before env:staging.
  inFixture(t, (fx) => {
    const { attempt, copy } = stoppedWithRecoverCopy(fx);
    let runs = 0;
    const runner = scriptedRunner({ 'recover-cmd': () => (runs++, { stdout: 'ok', exitCode: 0 }) });
    const admission = releaseRunner(fx, { runner, leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }) });
    let refused: unknown;
    let during: { productionReleased: boolean; runs: number; rollbacks: number } | undefined;
    const leases = new (class extends LeaseStore {
      override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
        if (key === STAGING && !during) {
          const productionReleased = released(fx, PRODUCTION);
          during = { productionReleased, runs, rollbacks: 0 };
          try {
            admission.next(fx.goal(attempt.goalId), copy);
          } catch (err) {
            refused = err;
          }
          during = { productionReleased, runs, rollbacks: rollbacks(fx, attempt) };
        }
        return super.update(key, change);
      }
    })(fx.paths.leases);
    releaseRunner(fx, { leases }).next(fx.goal(attempt.goalId), attempt);
    assert.equal(during?.productionReleased, true, 'the cleanup had released env:production when the admission came');
    assert.deepEqual({ runs: during?.runs, rollbacks: during?.rollbacks }, { runs: 0, rollbacks: 0 }, 'nothing admitted while the cleanup holds the attempt section');
    assert.equal((refused as StoreError | undefined)?.code, 'LOCKED', String(refused));
    // After the cleanup the admission rule applies: this caller's claim re-acquired env:production, so the step is recorded and run.
    admission.next(fx.goal(attempt.goalId), copy);
    assert.deepEqual({ runs, rollbacks: rollbacks(fx, attempt) }, { runs: 1, rollbacks: 1 });
    assertNoUnresolvedWithoutLease(fx, attempt, PRODUCTION);
  });
  // The reverse order: the admission holds the attempt section, and the cleanup is refused as a failed section and releases nothing.
  inFixture(t, (fx) => {
    const { attempt, copy } = stoppedWithRecoverCopy(fx);
    let cleanupResult: ReturnType<ReleaseRunner['next']> | undefined;
    let leasesDuring: { production: boolean; staging: boolean } | undefined;
    const ops = new (class extends OperationLedger {
      override recordIntent(...args: Parameters<OperationLedger['recordIntent']>): ReturnType<OperationLedger['recordIntent']> {
        if (!cleanupResult) {
          cleanupResult = releaseRunner(fx, { leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }) }).next(fx.goal(attempt.goalId), fx.store.getRelease(attempt.id)!);
          leasesDuring = { production: held(fx, PRODUCTION), staging: held(fx, STAGING) };
        }
        return super.recordIntent(...args);
      }
    })(fx.paths.operations);
    releaseRunner(fx, { ops }).next(fx.goal(attempt.goalId), copy);
    assert.deepEqual(leasesDuring, { production: true, staging: true }, 'the refused cleanup released nothing');
    assertRetryNamed(cleanupResult!.directive, attempt.id, `release-attempt:${attempt.id}`, /LOCKED/);
  });
  // Order: the admission takes the attempt section before its environment section. A cleanup that runs just before the
  // admission enters its attempt section meets no section of that admission, releases both leases, and the admission then
  // finds the lease released and records nothing.
  inFixture(t, (fx) => {
    const { attempt, copy } = stoppedWithRecoverCopy(fx);
    let runs = 0;
    const runner = scriptedRunner({ 'recover-cmd': () => (runs++, { stdout: 'ok', exitCode: 0 }) });
    let cleanupResult: ReturnType<ReleaseRunner['next']> | undefined;
    const leases = new (class extends LeaseStore {
      override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
        if (key === `release-attempt:${attempt.id}` && !cleanupResult) cleanupResult = releaseRunner(fx, { leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }) }).next(fx.goal(attempt.goalId), fx.store.getRelease(attempt.id)!);
        return super.update(key, change);
      }
    })(fx.paths.leases);
    const r = releaseRunner(fx, { leases, runner }).next(fx.goal(attempt.goalId), copy);
    assert.doesNotMatch(cleanupResult?.directive.narration ?? '', /release failed/, 'the cleanup met no section of the admission');
    assert.deepEqual({ production: released(fx, PRODUCTION), staging: released(fx, STAGING) }, { production: true, staging: true });
    assert.deepEqual({ kind: r.directive.kind, on: r.directive.kind === 'wait' ? r.directive.on : undefined, runs, rollbacks: rollbacks(fx, attempt) }, { kind: 'wait', on: 'environment:production', runs: 0, rollbacks: 0 });
  });
  // Order: the cleanup takes one environment section at a time; env:production's section is closed before env:staging's opens.
  inFixture(t, (fx) => {
    const { attempt } = stoppedWithRecoverCopy(fx);
    let claim: ReturnType<LeaseStore['claim']> | undefined;
    const leases = new (class extends LeaseStore {
      override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
        if (key === STAGING && !claim) claim = new LeaseStore(fx.paths.leases, { timeoutMs: 50 }).claim(PRODUCTION, { actor: actorB, operation: 'release:rel-b', now: fx.now() });
        return super.update(key, change);
      }
    })(fx.paths.leases);
    releaseRunner(fx, { leases }).next(fx.goal(attempt.goalId), attempt);
    assert.equal(claim?.status, 'acquired', "another session claims env:production while the cleanup decides env:staging");
  });
  // An attempt without an environment takes no attempt section (R14): a held one does not stop its cleanup.
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'DONE', { environment: undefined });
    record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, target: 'staging', status: 'succeeded' });
    hold(fx, 'staging', `release:${attempt.id}`);
    writeFileSync(`${fx.leases.file(`release-attempt:${attempt.id}`)}.lock`, `pid=${process.pid} at=${T0} nonce=held`);
    releaseRunner(fx, { leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }) }).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'an attempt without an environment releases the lease of its record target');
  });
});

test("another attempt's unresolved operation on the environment keeps its lease", (t) => {
  const failing = scriptedRunner({ 'deploy-cmd': { stdout: 'FAILED', exitCode: 1 } });
  const cases: { label: string; status: OperationStatus; otherGoal: boolean; target: string }[] = [
    ...(['running', 'intended', 'issued', 'UNKNOWN'] as const).map((status) => ({ label: status, status, otherGoal: false, target: 'staging' })),
    { label: 'running, of another goal', status: 'running', otherGoal: true, target: 'staging' },
    { label: 'running, its target spelled STAGING', status: 'running', otherGoal: false, target: 'STAGING' },
  ];
  for (const c of cases) {
    inFixture(t, (fx) => {
      // Attempt A of this session holds env:staging with an operation still open there; attempt B renews the lease, then fails.
      const b = stored(fx, 'STAGE');
      const aId = `${b.id}-A`;
      hold(fx, 'staging', `release:${aId}`);
      const opA = record(fx, 1, { goalId: c.otherGoal ? 'g-20260911000000-other' : b.goalId, releaseAttempt: aId, target: c.target, status: c.status });
      const r = releaseRunner(fx, { runner: failing }).next(fx.goal(b.goalId), b);
      assert.equal(r.attempt.stop?.reason, 'release-health', r.directive.narration);
      assert.equal(fx.leases.read(STAGING)?.operation, `release:${b.id}`, 'B renewed the lease');
      assert.equal(held(fx, STAGING), true, `${c.label} with env:staging released`);
      assert.ok(r.directive.narration.includes(`aidlc release next ${b.id}`), r.directive.narration);
      if (c.label !== 'running') return;
      fx.ops.markResult(opA, 'succeeded', {}, fx.now());
      const a = ReleaseAttempt.parse({ ...b, id: aId, state: 'STOP', stop: makeStop('release-health', 'staging deployment failed', 'diagnose', { at: T0, global: false }), disposition: 'failed' });
      fx.store.saveRelease(a);
      const before = fx.leases.read(STAGING);
      releaseRunner(fx).next(fx.goal(b.goalId), a);
      assert.deepEqual(fx.leases.read(STAGING), before, "A's own cleanup leaves the lease that names B unchanged");
      releaseRunner(fx).next(fx.goal(b.goalId), fx.store.getRelease(b.id)!);
      assert.equal(released(fx, STAGING), true, 'release next <B> releases it once nothing on staging is unresolved');
    });
  }
  inFixture(t, (fx) => {
    const b = stored(fx, 'STAGE');
    hold(fx, 'staging', `release:${b.id}-A`);
    record(fx, 1, { goalId: b.goalId, releaseAttempt: `${b.id}-A`, target: 'production', status: 'running' });
    releaseRunner(fx, { runner: failing }).next(fx.goal(b.goalId), b);
    assert.equal(released(fx, STAGING), true, "another attempt's open operation on another environment does not keep env:staging");
  });
});

test('a ledger entry that is listed and cannot be read keeps every lease', (t) => {
  // Each planted entry is a file or link the test creates inside the fixture's operations directory.
  const plants: [string, (dir: string) => void, string][] = [
    ['an entry that is not JSON', (dir) => writeFileSync(path.join(dir, 'op-bad.json'), '{'), 'MALFORMED_JSON'],
    ['an entry that fails the OperationRecord schema', (dir) => writeFileSync(path.join(dir, 'op-bad.json'), '{}'), 'SCHEMA_VIOLATION'],
    ['an entry whose link target is gone', (dir) => symlinkSync(path.join(dir, 'missing'), path.join(dir, 'op-gone.json'), 'junction'), 'READ_FAILED'],
    ['an operations path that is a regular file', (dir) => (renameSync(dir, `${dir}-moved`), writeFileSync(dir, '')), 'READ_FAILED'],
  ];
  for (const [label, plant, code] of plants) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, 'DONE');
      hold(fx, 'staging', `release:${attempt.id}`);
      plant(fx.paths.operations);
      const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
      assertRetryNamed(r.directive, attempt.id, 'operation ledger', 'every environment lease of the attempt kept');
      assert.ok(r.directive.narration.includes(`could not be read (${code}: `), `${label}: ${r.directive.narration}`);
      assert.equal(held(fx, STAGING), true, label);
    });
  }
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    inFixture(t, (fx) => {
      // A directory with read and no search permission: it lists its entries, and `existsSync` answers false for each of them.
      const attempt = stored(fx, 'DONE');
      hold(fx, 'staging', `release:${attempt.id}`);
      record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, target: 'staging', status: 'running' });
      chmodSync(fx.paths.operations, 0o600);
      try {
        const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
        assertRetryNamed(r.directive, attempt.id, 'operation ledger', 'every environment lease of the attempt kept');
        assert.equal(held(fx, STAGING), true, 'a directory without search permission');
      } finally {
        chmodSync(fx.paths.operations, 0o755);
      }
    });
    // A directory without read permission (its listing fails with EACCES), and an entry without read permission.
    const entry = (fx: Fx) => path.join(fx.paths.operations, 'op-locked.json');
    const modes: [string, (fx: Fx) => void, (fx: Fx) => void][] = [
      ['a directory without read permission', (fx) => chmodSync(fx.paths.operations, 0o300), (fx) => chmodSync(fx.paths.operations, 0o755)],
      ['an entry without read permission', (fx) => chmodSync(entry(fx), 0o000), (fx) => chmodSync(entry(fx), 0o644)],
    ];
    for (const [label, lock, unlock] of modes) {
      inFixture(t, (fx) => {
        const attempt = stored(fx, 'DONE');
        hold(fx, 'staging', `release:${attempt.id}`);
        const id = record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, target: 'staging', status: 'succeeded' });
        renameSync(path.join(fx.paths.operations, `${id}.json`), entry(fx));
        lock(fx);
        try {
          const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
          assertRetryNamed(r.directive, attempt.id, 'operation ledger', 'every environment lease of the attempt kept');
          assert.equal(held(fx, STAGING), true, label);
        } finally {
          unlock(fx);
        }
      });
    }
  }
  inFixture(t, (fx) => {
    const attempt = stored(fx, 'DONE');
    hold(fx, 'staging', `release:${attempt.id}`);
    renameSync(fx.paths.operations, `${fx.paths.operations}-moved`);
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'an operations directory that does not exist is an empty ledger');
  });
});

test("an attempt without an environment is issued as on main, every time: next throws before any intent, a schema error on target for '' and a TypeError for an absent environment", (t) => {
  for (const [label, environment] of [
    ['empty', ''],
    ['absent', undefined],
  ] as const) {
    inFixture(t, (fx) => {
      const attempt = stored(fx, 'STAGE', { environment });
      // A held attempt section changes nothing: an attempt without an environment takes none (R14).
      writeFileSync(`${fx.leases.file(`release-attempt:${attempt.id}`)}.lock`, `pid=${process.pid} at=${T0} nonce=held`);
      let runs = 0;
      const runner = scriptedRunner({ 'deploy-cmd': () => (runs++, { stdout: 'ok id=dep1', exitCode: 0 }) });
      for (let i = 0; i < 3; i++) {
        assert.throws(
          () => releaseRunner(fx, { runner, leases: new LeaseStore(fx.paths.leases, { timeoutMs: 50 }) }).next(fx.goal(attempt.goalId), fx.store.getRelease(attempt.id)!),
          (err: Error) => (environment === '' ? err.name === 'ZodError' && err.message.includes('"target"') : err instanceof TypeError && err.message.includes('toLowerCase')),
          `${label}, call ${i + 1}`,
        );
      }
      assert.deepEqual({ runs, records: fx.ops.list().length, state: fx.store.getRelease(attempt.id)?.state }, { runs: 0, records: 0, state: 'STAGE' }, label);
    });
  }
});

// Acceptance 16: the STOPs T0-RELEASE-REPORT-STEP added pass the exit. A package attempt claims no environment lease (it never
// enters STAGE, APPLY or RECOVER), so its failed run proof has no lease to release and no case here.
test('the stops T0-RELEASE-REPORT-STEP added release the leases: a failed stage-verify report', (t) => {
  inFixture(t, (fx) => {
    const release = releaseRunner(fx);
    const { goalId, attemptId } = delivering(fx, 'staging', release);
    const staged = step(fx, release, goalId, attemptId);
    assert.equal(staged.directive.kind, 'stage', staged.directive.narration);
    assert.equal(held(fx, STAGING), true, 'the staging deploy claimed env:staging');
    const r = release.next(fx.goal(goalId), release.reportStep(fx.goal(goalId), staged.attempt, 'stage-verify', 'failed'));
    assert.deepEqual({ state: r.attempt.state, reason: r.attempt.stop?.reason, detail: r.attempt.stop?.detail }, { state: 'STOP', reason: 'release-health', detail: 'staging verification failed' });
    assert.equal(released(fx, STAGING), true, 'the STOP of a failed stage-verify releases env:staging');
  });
});

test('the stops T0-RELEASE-REPORT-STEP added release the leases: a failed recover-verify report', (t) => {
  inFixture(t, (fx) => {
    const release = releaseRunner(fx);
    const attempt = stored(fx, 'RECOVER', { target: 'production', steps: [{ name: 'recover', status: 'succeeded' }] });
    record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, idempotencyKey: `${attempt.id}:stage-deploy:c1`, target: 'staging', status: 'succeeded' });
    hold(fx, 'staging', `release:${attempt.id}`);
    const reported = release.reportStep(fx.goal(attempt.goalId), attempt, 'recover-verify', 'failed');
    const r = release.next(fx.goal(attempt.goalId), reported);
    assert.deepEqual({ state: r.attempt.state, reason: r.attempt.stop?.reason, detail: r.attempt.stop?.detail }, { state: 'STOP', reason: 'release-health', detail: 'recovery verification failed' });
    assert.ok(fx.leases.read(PRODUCTION), 'the RECOVER step claimed env:production');
    assert.deepEqual({ production: released(fx, PRODUCTION), staging: released(fx, STAGING) }, { production: true, staging: true }, 'the STOP of a failed recover-verify releases both leases');
  });
});
