/**
 * Card T0-JOURNAL-APPEND-LOCK acceptance 9: a refused journal append leaves the writes its caller made before it, and the
 * command docs/OPERATIONS.md names recovers each. The refusal is the EPERM of the exclusive create of an absent lock path,
 * which the journal lock propagates at once (R2), injected at the `wx` open of `<journal file>.append.lock` during the
 * append of one event type.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { hostname } from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { candidateShaFor, driveCardToDone, goalForCards, makeFixture, opsConfigured, opsRunner, writeCard, T0, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import { Journal } from '../../src/state/journal.ts';
import type { AppendInput } from '../../src/state/journal.ts';
import type { SyncRunner } from '../../src/probes/exec.ts';
import type { ActorIdentity, CardRun, JournalEventType } from '../../src/core/types.ts';

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const POOL = 'default';

const cli = (fx: Fixture, ...args: string[]) => spawnSync(process.execPath, [MAIN, ...args], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000, windowsHide: true });

/**
 * Run `body` with the journal lock of the first append of `type` refused: the `wx` open of the journal's lock path throws EPERM
 * while no lock file exists. Appends of other types and every later append are untouched.
 */
function refusedAt<T>(type: JournalEventType, body: () => T): { value?: T; error?: unknown; refused: boolean } {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const realOpen = target['openSync']!;
  const realAppend = Journal.prototype.append;
  let armed = false;
  let refused = false;
  target['openSync'] = (...args: unknown[]) => {
    if (armed && args[1] === 'wx' && String(args[0]).endsWith('.jsonl.append.lock')) {
      armed = false;
      refused = true;
      throw Object.assign(new Error('EPERM: operation not permitted, open'), { code: 'EPERM', syscall: 'open', path: String(args[0]) });
    }
    return realOpen(...args);
  };
  syncBuiltinESMExports();
  Journal.prototype.append = function (this: Journal, input: AppendInput) {
    armed = !refused && input.type === type;
    try {
      return realAppend.call(this, input);
    } finally {
      armed = false;
    }
  };
  try {
    return { value: body(), refused };
  } catch (error) {
    return { error, refused };
  } finally {
    Journal.prototype.append = realAppend;
    target['openSync'] = realOpen;
    syncBuiltinESMExports();
  }
}

const isEperm = (err: unknown): boolean => (err as NodeJS.ErrnoException | undefined)?.code === 'EPERM';

/**
 * A scenario fixture: `makeFixture` creates its directory with `tmpDir` of tests/infra/helpers.ts, and the test's `after` hook,
 * registered here where the directory is created, removes it with the fixture's `cleanup`.
 */
function fixture(t: TestContext, actor?: ActorIdentity): Fixture {
  const fx = makeFixture(actor ? { actor } : {});
  t.after(() => fx.cleanup());
  return fx;
}

/** The card at BUILD with attempt 1 running; `next` runs `card next` on the stored run. */
function atBuild(fx: Fixture, cardId: string, shipPath: DryRunShipPath) {
  writeCard(fx, { id: cardId, title: 'journal lock refusal' });
  const goalId = goalForCards(fx, [cardId]).id;
  const runner = fx.runner(shipPath);
  const card = fx.card(cardId);
  const run = () => fx.store.getCardRun(goalId, cardId)!;
  let r = runner.next(fx.goal(goalId), card, fx.controller.ensureCardRun(fx.goal(goalId), cardId));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  r = runner.next(fx.goal(goalId), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  return {
    goalId,
    run,
    next: () => runner.next(fx.goal(goalId), card, run()),
    attempt: (): CardRun => runner.recordAttempt(fx.goal(goalId), card, run(), { outcome: 'success', dodReceipt: `dod:${cardId}`, redReceipt: `red:${cardId}`, candidateSha: candidateShaFor(cardId) }),
  };
}

test('(a) a refused delivery of the owed ATTEMPT_FINISHED leaves the attempt recorded and the event owed; the next card next delivers it once, completed [R6]', (t) => {
  const fx = fixture(t);
  const c = atBuild(fx, 'T1-JLA', new DryRunShipPath(['merged']));
  const out = refusedAt('ATTEMPT_FINISHED', () => c.attempt());
  assert.equal(out.refused, true, 'the journal lock was refused');
  assert.ok(isEperm(out.error), `card attempt throws the refusal: ${String(out.error)}`);
  const run = c.run();
  assert.deepEqual(run.effort?.attempts.map((a) => [a.n, a.outcome]), [[1, 'success']], 'the attempt is recorded');
  const owed = run.journalOwed ?? [];
  assert.deepEqual(owed.map((o) => o.type), ['ATTEMPT_FINISHED'], 'ATTEMPT_FINISHED is still owed');
  assert.equal(fx.events(c.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED').length, 0);
  c.next();
  const finished = fx.events(c.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED');
  assert.equal(finished.length, 1, 'delivered once');
  assert.equal(finished[0]!.data['eventKey'], owed[0]!.key);
  assert.equal(finished[0]!.data['completed'], true);
  c.next();
  assert.equal(fx.events(c.goalId).filter((e) => e.type === 'ATTEMPT_FINISHED').length, 1, 'and not again');
  assert.equal(fx.journal(c.goalId).verify().ok, true);
});

test('(b) a refused OPERATION_ISSUED of the ship leaves the operation issued and the pool request running, and runs no ship; after ops reconcile and review release the next card next ships once [R6]', (t) => {
  // The shipping process has exited by the time the operator recovers: its admission names a pid that is gone, on this host.
  const gone = spawnSync(process.execPath, ['-e', '']).pid;
  assert.ok(gone > 0);
  const shipper: ActorIdentity = { session: 'win-A', pid: gone, processStart: T0, host: hostname() };
  const fx = fixture(t, shipper);
  const ship = new DryRunShipPath(['merged']);
  const c = atBuild(fx, 'T1-JLB', ship);
  c.attempt();
  const out = refusedAt('OPERATION_ISSUED', () => c.next());
  assert.equal(out.refused, true, 'the journal lock was refused');
  assert.ok(isEperm(out.error), `card next throws the refusal: ${String(out.error)}`);
  const merges = fx.ops.list({ goalId: c.goalId, kind: 'merge' });
  assert.deepEqual(merges.map((o) => o.status), ['issued'], 'the operation is issued');
  const opId = merges[0]!.id;
  const requests = fx.queue.list(POOL).filter((r) => r.requesters.includes(`${c.goalId}:T1-JLB`));
  assert.deepEqual(requests.map((r) => r.state), ['running'], 'the pool request is running');
  const key = requests[0]!.key;
  assert.equal(ship.requests.length, 0, 'the ship path ran no ship');
  assert.equal(fx.events(c.goalId).filter((e) => e.type === 'OPERATION_ISSUED').length, 0);

  const waiting = c.next();
  assert.equal(waiting.directive.kind, 'wait', waiting.directive.narration);
  assert.ok(waiting.directive.narration.includes(`attached to running operation ${opId}`), waiting.directive.narration);
  assert.equal(ship.requests.length, 0, 'the wait runs no ship');

  const reconciled = cli(fx, 'ops', 'reconcile', opId, '--status', 'cancelled');
  assert.equal(reconciled.status, 0, reconciled.stderr);
  const released = cli(fx, 'review', 'release', key, '--reason', 'the ship process is gone');
  assert.equal(released.status, 0, released.stderr);
  const shipped = c.next();
  assert.equal(ship.requests.length, 1, `the next card next ships once: ${shipped.directive.kind}: ${shipped.directive.narration}`);
  assert.equal(fx.ops.list({ goalId: c.goalId, kind: 'merge' }).filter((o) => o.status === 'succeeded').length, 1);
  assert.equal(fx.journal(c.goalId).verify().ok, true);
});

/** The scenario ops runner, counting each command. */
function countingRunner(): { runner: SyncRunner; runs: Record<string, number> } {
  const runs: Record<string, number> = {};
  const runner: SyncRunner = (command, args, options) => {
    runs[command] = (runs[command] ?? 0) + 1;
    return opsRunner(command, args, options);
  };
  return { runner, runs };
}

test('(c) a refused OPERATION_INTENT of a release step leaves the operation intended and the command not run; release next waits naming aidlc ops reconcile; the reconcile settles the step by its record and a new attempt after goal resume deploys once [R6]', (t) => {
  const fx = fixture(t);
  const { runner, runs } = countingRunner();
  const release = new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: fx.store, ops: fx.ops, leases: fx.leases, runner, opsLoad: opsConfigured(), now: fx.now, signals: () => [] });
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  const goalId = goalForCards(fx, ['T1-HELLO'], { target: 'staging' }).id;
  driveCardToDone(fx, goalId, 'T1-HELLO');
  assert.equal(fx.controller.next(goalId).kind, 'verify-arc');
  const rep = fx.controller.report({ goalId, generation: 0, result: 'arc-verified', data: {} });
  const attemptId = rep.directive.kind === 'release' ? rep.directive.attemptId : '';
  assert.ok(attemptId, rep.directive.narration);
  release.setCandidate(fx.goal(goalId), fx.store.getRelease(attemptId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
  fx.controller.report({ goalId, generation: 0, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest: 'c1', environment: 'staging' } });

  const out = refusedAt('OPERATION_INTENT', () => release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!));
  assert.equal(out.refused, true, 'the journal lock was refused');
  assert.ok(isEperm(out.error), `release next throws the refusal: ${String(out.error)}`);
  const deploys = fx.ops.list({ goalId, kind: 'deploy' });
  assert.deepEqual(deploys.map((o) => o.status), ['intended'], 'the operation is intended');
  const opId = deploys[0]!.id;
  assert.equal(runs['deploy-cmd'], undefined, 'the deploy command did not run');

  const waiting = release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
  assert.equal(waiting.directive.kind, 'wait', waiting.directive.narration);
  assert.ok(waiting.directive.narration.includes(`aidlc ops reconcile ${opId} --status`), waiting.directive.narration);
  assert.equal(runs['deploy-cmd'], undefined, 'the wait runs no command');

  const reconciled = cli(fx, 'ops', 'reconcile', opId, '--status', 'cancelled');
  assert.equal(reconciled.status, 0, reconciled.stderr);
  // The step's cancelled record becomes the step (T0-RELEASE-OP-REISSUE R7, ReleaseRunner.settleStep): failed, so release next
  // stops the attempt and issues nothing again.
  const after = release.next(fx.goal(goalId), fx.store.getRelease(attemptId)!);
  assert.equal(after.directive.kind, 'stop', after.directive.narration);
  assert.equal(after.attempt.stop?.reason, 'release-health');
  assert.equal(after.attempt.stop?.detail, 'staging deployment failed');
  assert.equal(runs['deploy-cmd'], undefined, 'after the reconcile the step is settled by its record and the command is not run');
  assert.deepEqual(fx.ops.list({ goalId, kind: 'deploy' }).map((o) => [o.id, o.status]), [[opId, 'cancelled']], 'no second operation');

  // The deploy that never ran is retried by a new release attempt after a resume. `aidlc release next` reports a stopped
  // attempt to the goal (src/cli/main.ts, release next), which stops the goal; `aidlc goal resume <goalId> --reason <text>`
  // makes the `resume` report below (src/cli/main.ts, goal resume). Both are called in process: the CLI reads the real
  // clock, and this fixture's goal deadline is on the fixed clock.
  const stopped = fx.controller.report({ goalId, generation: 0, result: 'release-result', attemptId, data: { attempt: after.attempt } });
  assert.deepEqual([stopped.goal.state, stopped.goal.terminal], ['STOP', true], 'the reported stop makes the goal terminal, which resume requires');
  const resumed = fx.controller.report({ goalId, generation: 0, result: 'resume', data: { reason: 'the deploy never ran' } });
  assert.equal(resumed.goal.generation, 1);
  assert.equal(resumed.directive.kind, 'verify-arc', resumed.directive.narration);
  const arc = fx.controller.report({ goalId, generation: 1, result: 'arc-verified', data: {} });
  const retryId = arc.directive.kind === 'release' ? arc.directive.attemptId : '';
  assert.ok(retryId && retryId !== attemptId, `a new release attempt: ${arc.directive.narration}`);
  release.setCandidate(fx.goal(goalId), fx.store.getRelease(retryId)!, { candidateDigest: 'c1', sourceSha: candidateShaFor('T1-HELLO') });
  fx.controller.report({ goalId, generation: 1, result: 'approved', data: { kind: 'staging', by: 'user', candidateDigest: 'c1', environment: 'staging' } });
  release.next(fx.goal(goalId), fx.store.getRelease(retryId)!);
  assert.equal(runs['deploy-cmd'], 1, 'the new attempt runs the deploy once');
  assert.deepEqual(fx.ops.list({ goalId, kind: 'deploy' }).map((o) => o.releaseAttempt).sort(), [attemptId, retryId].sort(), 'one operation per attempt');
  assert.equal(fx.journal(goalId).verify().ok, true);
});

