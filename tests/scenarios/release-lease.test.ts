// Card T0-STAGING-LEASE-RELEASE: a release attempt that ends (DONE or STOP) with no unresolved operation of its own releases
// every environment lease it claimed, deciding and writing in one lease section; one that leaves an unresolved operation
// keeps them. A failed release is named with `aidlc release next <attemptId>`, which exits 0 on a stopped goal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, driveCardToDone, opsConfigured, opsRunner, candidateShaFor, actorA, actorB, T0 } from './_harness.ts';
import { ReleaseRunner, releaseOperationOf, type ReleaseDirective } from '../../src/loop/release-runner.ts';
import { ReleaseAttempt, HOUR_MS, MINUTE_MS, addMs, type ActorIdentity, type HealthSignal, type Lease, type OperationStatus, type ReleaseState } from '../../src/core/types.ts';
import { LeaseStore } from '../../src/coordination/lease.ts';
import { makeStop } from '../../src/core/stop.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { OpsLoad } from '../../src/delivery/ops.ts';

type Fx = ReturnType<typeof makeFixture>;
type Deps = ConstructorParameters<typeof ReleaseRunner>[0];

const STAGING = 'env:staging';
const PRODUCTION = 'env:production';
const UNRESOLVED: OperationStatus[] = ['intended', 'issued', 'running', 'UNKNOWN'];
const PAST = new Date('2020-01-01T00:00:00.000Z');

function inFixture(body: (fx: Fx) => void): void {
  const fx = makeFixture();
  try {
    body(fx);
  } finally {
    fx.cleanup();
  }
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
function record(fx: Fx, minute: number, fields: { goalId: string; releaseAttempt?: string; idempotencyKey?: string; target?: string; status: OperationStatus }): string {
  const at = addMs(T0, -minute * MINUTE_MS);
  const rec = fx.ops.recordIntent({ kind: 'deploy', goalId: fields.goalId, releaseAttempt: fields.releaseAttempt, target: fields.target ?? 'staging', candidateDigest: 'c1', idempotencyKey: fields.idempotencyKey, ownerGeneration: 0, timeoutMs: 60_000 }, at);
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

test('a staging attempt that ends in DONE releases env:staging, and another session then acquires it', () => {
  inFixture((fx) => {
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

test('a delivered production attempt releases the staging and the production lease it claimed', () => {
  inFixture((fx) => {
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

test('every terminal path passes the one exit', () => {
  inFixture((fx) => {
    const release = releaseRunner(fx, { runner: scriptedRunner({ 'deploy-cmd': { stdout: 'FAILED', exitCode: 1 } }) });
    const { goalId, attemptId } = delivering(fx, 'staging', release);
    const r = step(fx, release, goalId, attemptId);
    assert.equal(r.attempt.stop?.reason, 'release-health', r.directive.narration);
    assert.equal(released(fx, STAGING), true, 'failed staging deploy');
  });
  inFixture((fx) => {
    const ops = opsConfigured();
    const publishing: OpsLoad = ops.status === 'configured' ? { ...ops, config: { ...ops.config, operations: ops.config.operations.map((o) => (o.role === 'deploy' ? { ...o, triggersPublication: true } : o)) } } : ops;
    const release = releaseRunner(fx, { opsLoad: publishing });
    const { goalId, attemptId } = delivering(fx, 'staging', release);
    const r = step(fx, release, goalId, attemptId);
    assert.equal(r.attempt.stop?.reason, 'release-auth', r.directive.narration);
    assert.equal(released(fx, STAGING), true, 'publishing deploy without production authority');
  });
  inFixture((fx) => {
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
    inFixture((fx) => {
      const attempt = stored(fx, state);
      hold(fx, 'staging', `release:${attempt.id}`);
      const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
      assert.equal(r.directive.kind, state === 'STOP' ? 'stop' : 'done');
      assert.equal(released(fx, STAGING), true, `attempt stored in ${state}`);
    });
  }
});

test('an attempt with an unresolved operation keeps its leases', () => {
  for (const status of UNRESOLVED) {
    for (const association of ['releaseAttempt', 'key only', 'key of another attempt'] as const) {
      for (const state of ['STOP', 'DONE'] as const) {
        inFixture((fx) => {
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
  inFixture((fx) => {
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
  inFixture((fx) => {
    const attempt = stored(fx, 'STOP');
    hold(fx, 'staging', `release:${attempt.id}`);
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'a terminal attempt with no ledger record');
  });
  for (const status of ['succeeded', 'failed', 'cancelled'] as const) {
    inFixture((fx) => {
      const attempt = stored(fx, 'STOP');
      hold(fx, 'staging', `release:${attempt.id}`);
      record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, status });
      releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
      assert.equal(released(fx, STAGING), true, `a ${status} record of the attempt`);
    });
  }
  inFixture((fx) => {
    const attempt = stored(fx, 'STOP');
    hold(fx, 'staging', `release:${attempt.id}`);
    record(fx, 1, { goalId: attempt.goalId, releaseAttempt: 'rel-other', status: 'intended' });
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'an unresolved record of another attempt, without the key');
  });
});

test("only the attempt's own lease of this session and host is released", () => {
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
    inFixture((fx) => {
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
  inFixture((fx) => {
    const attempt = stored(fx, 'DONE', { environment: 'Staging' });
    hold(fx, 'staging', `release:${attempt.id}`);
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'environment Staging releases env:staging');
  });
  inFixture((fx) => {
    const attempt = stored(fx, 'DONE', { environment: 'Staging' });
    mkdirSync(fx.paths.leases, { recursive: true });
    writeFileSync(fx.leases.file(STAGING), '{not json');
    const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.ok(r.directive.narration.includes(`${STAGING} (`), `environment Staging is named by the key env:staging: ${r.directive.narration}`);
  });
  inFixture((fx) => {
    const attempt = stored(fx, 'DONE', { target: 'production' });
    hold(fx, 'staging', `release:${attempt.id}`);
    record(fx, 1, { goalId: attempt.goalId, idempotencyKey: `${attempt.id}:stage-deploy:c1`, target: 'staging', status: 'succeeded' });
    releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(released(fx, STAGING), true, 'the target of a record that belongs by its key');
  });
  inFixture((fx) => {
    const attempt = stored(fx, 'DONE', { environment: undefined });
    const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.directive.narration, 'Release attempt delivered.', 'no environment and no record: nothing to release');
  });
});

test('a renewal for another attempt that lands before the cleanup takes the lock keeps the lease', () => {
  inFixture((fx) => {
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

test('a lease cleanup that fails leaves the attempt terminal, releases the other leases and names the command that retries it', () => {
  inFixture((fx) => {
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
  inFixture((fx) => {
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
    inFixture((fx) => {
      const attempt = stored(fx, 'DONE');
      mkdirSync(fx.paths.leases, { recursive: true });
      writeFileSync(fx.leases.file(STAGING), content);
      const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
      assert.equal(r.directive.kind, 'done', label);
      assertRetryNamed(r.directive, attempt.id, STAGING, error);
      assert.equal(fx.store.getRelease(attempt.id)?.state, 'DONE', label);
    });
  }
  inFixture((fx) => {
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
  inFixture((fx) => {
    const attempt = stored(fx, 'STOP');
    hold(fx, 'staging', `release:${attempt.id}`);
    writeFileSync(path.join(fx.paths.operations, 'op-unreadable.json'), '{');
    const r = releaseRunner(fx).next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.directive.kind, 'stop');
    assertRetryNamed(r.directive, attempt.id, 'operation ledger', /MALFORMED_JSON/);
    assert.equal(held(fx, STAGING), true, 'an unreadable ledger keeps every lease');
  });
});

test('aidlc release next run twice on a stopped attempt exits 0 both times', () => {
  inFixture((fx) => {
    const { goalId, attemptId } = delivering(fx, 'staging', releaseRunner(fx));
    fx.store.saveRelease(ReleaseAttempt.parse({ ...fx.store.getRelease(attemptId)!, environment: 'staging', state: 'STOP', stop: makeStop('release-health', 'staging deployment failed', 'diagnose', { at: T0, global: false }), disposition: 'failed' }));
    const session = 'release-lease-cli';
    hold(fx, 'staging', `release:${attemptId}`, { actor: { session, pid: 1, processStart: T0, host: os.hostname() } });
    const run = () => spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'release', 'next', attemptId], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: session }, encoding: 'utf8', timeout: 60_000 });
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

test('an intent recorded around the cleanup is seen by its lease section or never recorded for a released lease', () => {
  // The intent lands after the cleanup's first ledger read and before its lease section takes the lock.
  for (const status of ['intended', 'running'] as const) {
    inFixture((fx) => {
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
    inFixture((fx) => {
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
  // A ledger that becomes unreadable after the first read keeps the lease whose section met it and every key after it.
  inFixture((fx) => {
    const attempt = stored(fx, 'DONE', { target: 'production' });
    record(fx, 1, { goalId: attempt.goalId, releaseAttempt: attempt.id, target: 'staging', status: 'succeeded' });
    hold(fx, 'production', `release:${attempt.id}`);
    hold(fx, 'staging', `release:${attempt.id}`);
    let broken = false;
    const leases = new (class extends LeaseStore {
      override update(key: string, change: (existing: Lease | undefined) => Lease | undefined): Lease | undefined {
        if (!broken) {
          broken = true;
          writeFileSync(path.join(fx.paths.operations, 'op-unreadable.json'), '{');
        }
        return super.update(key, change);
      }
    })(fx.paths.leases);
    const r = releaseRunner(fx, { leases }).next(fx.goal(attempt.goalId), attempt);
    assert.equal(r.directive.kind, 'done');
    assertRetryNamed(r.directive, attempt.id, 'operation ledger', /MALFORMED_JSON/);
    assert.ok(r.directive.narration.includes(`${PRODUCTION}, ${STAGING} kept`), r.directive.narration);
    assert.deepEqual({ production: held(fx, PRODUCTION), staging: held(fx, STAGING) }, { production: true, staging: true });
  });
});
