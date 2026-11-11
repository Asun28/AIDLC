// Card T0-RELEASE-REPORT-STEP: `aidlc release report` records only the manual step the attempt's state asks for
// (`package-run-proof`, `stage-verify`, `recover-verify`), with `succeeded`, `failed` or `UNKNOWN`, and refuses anything
// else before any write. A failed verification is final and stops the attempt as a failed operation of its state does.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, opsRunner, T0 } from './_harness.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import { ReleaseAttempt, HOUR_MS, addMs } from '../../src/core/types.ts';
import { DeliveryOpsConfig, type OpsLoad } from '../../src/delivery/ops.ts';
import { GoalStore } from '../../src/state/goal-store.ts';

type Fx = ReturnType<typeof makeFixture>;
type StepRecord = ReleaseAttempt['steps'][number];

const MANUAL = ['package-run-proof', 'stage-verify', 'recover-verify'] as const;
const STATUSES = ['succeeded', 'failed', 'UNKNOWN'] as const;
const STEP_STATUSES: StepRecord['status'][] = ['pending', 'running', 'succeeded', 'failed', 'UNKNOWN', 'skipped'];

const ROLE_BINDINGS = [
  { role: 'deploy', command: ['deploy-cmd'], targetSelection: 'arg', operationIdPattern: 'id=(\\w+)', statusLookup: ['status-cmd', '{id}'], successPattern: 'ok', failurePattern: 'FAILED' },
  { role: 'status', command: ['status-cmd'] },
  { role: 'environment', command: ['env-cmd'] },
  { role: 'health', command: ['health-cmd'] },
  { role: 'recover', command: ['recover-cmd'], targetSelection: 'arg', successPattern: 'ok' },
  { role: 'build', command: ['build-cmd'] },
  { role: 'package', command: ['package-cmd'] },
];

/** The ops configuration with every role bound except those named in `without`. */
function opsConfig(without: string[] = []): Record<string, unknown> {
  return { schemaVersion: 1, environments: { staging: { production: false }, production: { production: true } }, operations: ROLE_BINDINGS.filter((b) => !without.includes(b.role)) };
}

function opsLoad(without: string[] = []): OpsLoad {
  return { status: 'configured', file: 'memory', config: DeliveryOpsConfig.parse(opsConfig(without)) };
}

const UNREADABLE: OpsLoad = { status: 'unreadable', file: 'aidlc.ops.json', error: 'Unexpected end of JSON input' };

function setup(t: TestContext): { fx: Fx; goalId: string } {
  const fx = makeFixture();
  t.after(() => fx.cleanup());
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  return { fx, goalId: goalForCards(fx, ['T1-HELLO'], { target: 'production' }).id };
}

function releaseRunner(fx: Fx, ops: OpsLoad = opsLoad(), store: GoalStore = fx.store): ReleaseRunner {
  return new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store, ops: fx.ops, leases: fx.leases, runner: opsRunner, opsLoad: ops, now: fx.now, signals: () => [] });
}

let seq = 0;

/** An attempt stored directly, as tests/scenarios/release.test.ts builds one in OBSERVE. */
function stored(fx: Fx, goalId: string, fields: Partial<ReleaseAttempt> = {}): ReleaseAttempt {
  seq += 1;
  return fx.store.saveRelease(
    ReleaseAttempt.parse({ id: `rel-${goalId}-${seq}`, goalId, generation: 0, target: 'staging', environment: 'staging', state: 'PREPARE', candidateDigest: 'c1', sourceSha: 's1', startedAt: T0, deadline: addMs(T0, 12 * HOUR_MS), updatedAt: T0, ...fields }),
  );
}

const step = (name: string, status: StepRecord['status']): StepRecord => ({ name, status });

const STOPPED: NonNullable<ReleaseAttempt['stop']> = { reason: 'release-health', detail: 'stopped earlier', nextAction: 'none', global: false, at: T0, unresolvedOperations: [] };

/** An attempt in the state and condition that expects `name`. */
function expecting(fx: Fx, goalId: string, name: (typeof MANUAL)[number]): ReleaseAttempt {
  if (name === 'package-run-proof') return stored(fx, goalId, { target: 'package', environment: undefined, state: 'PREPARE' });
  if (name === 'stage-verify') return stored(fx, goalId, { state: 'STAGE', steps: [step('stage-deploy', 'succeeded')] });
  return stored(fx, goalId, { target: 'production', environment: 'production', state: 'RECOVER', disposition: 'recovered', steps: [step('stage-deploy', 'succeeded'), step('stage-verify', 'succeeded'), step('apply-deploy', 'failed'), step('recover', 'succeeded')] });
}

/** The words of the refusal message that name what the state expects. */
function expectsText(expected: string | undefined): string {
  return expected ? `expects a report of ${expected}` : 'expects no step report';
}

/** A report that must be refused: it throws naming the attempt, its state, the refused value and the expected step, and writes nothing. */
function assertRefused(fx: Fx, runner: ReleaseRunner, attemptId: string, name: string, status: string, refused: string, expected: string | undefined): void {
  const attempt = fx.store.getRelease(attemptId)!;
  const before = JSON.stringify(attempt);
  const events = fx.events(attempt.goalId).length;
  const label = `${attempt.state} ${JSON.stringify(name)} ${JSON.stringify(status)}`;
  assert.throws(
    () => runner.reportStep(fx.goal(attempt.goalId), attempt, name, status as 'succeeded'),
    (err: Error) => {
      for (const part of [attempt.id, `is in ${attempt.state}`, JSON.stringify(refused), expectsText(expected)]) assert.ok(err.message.includes(part), `${label}: ${err.message} lacks ${part}`);
      return true;
    },
    label,
  );
  assert.equal(JSON.stringify(fx.store.getRelease(attemptId)), before, `${label}: stored attempt changed`);
  assert.equal(fx.events(attempt.goalId).length, events, `${label}: journal grew`);
}

/** The name forms that differ from a manual step name only in letter case or by whitespace. */
function nameVariants(name: string): string[] {
  return [name.toUpperCase(), name[0]!.toUpperCase() + name.slice(1), ` ${name}`, `${name} `, `${name}\t`, `\n${name}`];
}

const FOREIGN_NAMES = ['stage-deploy', 'apply-deploy', 'recover', 'anything', '', 'Stage-Verify', ' stage-verify', ...MANUAL.flatMap(nameVariants)];

function cli(fx: Fx, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  return spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), ...args], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 60_000 });
}

test("release report accepts only the step the attempt's state asks for", (t) => {
  const { fx, goalId } = setup(t);
  const runner = releaseRunner(fx);
  const later = [step('stage-deploy', 'succeeded'), step('stage-verify', 'succeeded'), step('apply-deploy', 'succeeded'), step('recover', 'succeeded')];
  const prod = { target: 'production' as const, environment: 'production' };
  const rows: Array<{ label: string; fields: Partial<ReleaseAttempt>; expects?: (typeof MANUAL)[number] }> = [
    { label: 'PREPARE package, needs met', fields: { target: 'package', environment: undefined }, expects: 'package-run-proof' },
    { label: 'PREPARE staging, needs met', fields: { target: 'staging' } },
    ...(['production', 'migration', 'development', 'operations'] as const).map((target) => ({ label: `PREPARE ${target}, needs met`, fields: { target } })),
    { label: 'STAGE, stage-deploy succeeded', fields: { state: 'STAGE', steps: [step('stage-deploy', 'succeeded')] }, expects: 'stage-verify' },
    { label: 'STAGE of a production target, stage-deploy succeeded', fields: { ...prod, environment: 'staging', state: 'STAGE', steps: [step('stage-deploy', 'succeeded')] }, expects: 'stage-verify' },
    { label: 'STAGE, stage-deploy absent', fields: { state: 'STAGE', steps: [step('recover', 'succeeded')] } },
    ...STEP_STATUSES.filter((s) => s !== 'succeeded').map((s) => ({ label: `STAGE, stage-deploy ${s}`, fields: { state: 'STAGE' as const, steps: [step('stage-deploy', s)] } })),
    { label: 'CHECKPOINT', fields: { ...prod, state: 'CHECKPOINT', steps: later } },
    { label: 'APPLY', fields: { ...prod, state: 'APPLY', steps: later } },
    { label: 'OBSERVE', fields: { ...prod, state: 'OBSERVE', steps: later } },
    { label: 'RECOVER, recover succeeded', fields: { ...prod, state: 'RECOVER', disposition: 'recovered', steps: [step('stage-deploy', 'succeeded'), step('recover', 'succeeded')] }, expects: 'recover-verify' },
    { label: 'RECOVER, recover absent', fields: { ...prod, state: 'RECOVER', disposition: 'recovered', steps: [step('stage-deploy', 'succeeded')] } },
    ...STEP_STATUSES.filter((s) => s !== 'succeeded').map((s) => ({ label: `RECOVER, recover ${s}`, fields: { ...prod, state: 'RECOVER' as const, disposition: 'recovered' as const, steps: [step('stage-deploy', 'succeeded'), step('recover', s)] } })),
    { label: 'CLOSE', fields: { ...prod, state: 'CLOSE', steps: later } },
    { label: 'WAIT', fields: { ...prod, state: 'WAIT', steps: later } },
    { label: 'WAIT of a package attempt', fields: { target: 'package', environment: undefined, state: 'WAIT' } },
    { label: 'DONE', fields: { ...prod, state: 'DONE', disposition: 'delivered', steps: later } },
    { label: 'DONE of a package attempt', fields: { target: 'package', environment: undefined, state: 'DONE', disposition: 'delivered' } },
    { label: 'STOP', fields: { ...prod, state: 'STOP', disposition: 'failed', steps: later, stop: STOPPED } },
    { label: 'STOP of a package attempt', fields: { target: 'package', environment: undefined, state: 'STOP', disposition: 'failed', stop: STOPPED } },
  ];
  for (const row of rows) {
    const attempt = stored(fx, goalId, row.fields);
    const names = [...FOREIGN_NAMES, ...MANUAL.filter((m) => m !== row.expects)];
    for (const name of names) for (const status of STATUSES) assertRefused(fx, runner, attempt.id, name, status, name, row.expects);
    if (row.expects) {
      const events = fx.events(goalId).length;
      const accepted = runner.reportStep(fx.goal(goalId), fx.store.getRelease(attempt.id)!, row.expects, 'UNKNOWN');
      assert.deepEqual(accepted.steps.find((s) => s.name === row.expects), step(row.expects, 'UNKNOWN'), row.label);
      assert.deepEqual(fx.store.getRelease(attempt.id)!.steps.find((s) => s.name === row.expects), step(row.expects, 'UNKNOWN'), row.label);
      assert.equal(fx.events(goalId).length, events + 1, row.label);
    }
  }
});

test('a status outside succeeded, failed and UNKNOWN is refused before any write', (t) => {
  const { fx, goalId } = setup(t);
  const runner = releaseRunner(fx);
  const refusedStatuses = ['pending', 'running', 'skipped', 'Succeeded', '', 'done', 'SUCCEEDED', 'Failed', 'unknown', 'Unknown', ' succeeded', 'succeeded ', 'cancelled'];
  for (const name of MANUAL) {
    const attempt = expecting(fx, goalId, name);
    for (const status of refusedStatuses) assertRefused(fx, runner, attempt.id, name, status, status, name);
    // The step is still expected after every refusal.
    assert.equal(runner.reportStep(fx.goal(goalId), fx.store.getRelease(attempt.id)!, name, 'UNKNOWN').steps.find((s) => s.name === name)?.status, 'UNKNOWN');
  }
});

test('a package run proof is refused through aidlc release report until the PREPARE needs are met, so the attempt never reaches DONE without them', (t) => {
  const { fx, goalId } = setup(t);
  const opsFile = path.join(fx.tmp, 'aidlc.ops.json');
  const cases: Array<{ label: string; fields: Partial<ReleaseAttempt>; ops: OpsLoad; file: string }> = [
    { label: 'candidate digest absent', fields: { candidateDigest: undefined }, ops: opsLoad(), file: JSON.stringify(opsConfig()) },
    { label: 'candidate digest empty', fields: { candidateDigest: '' }, ops: opsLoad(), file: JSON.stringify(opsConfig()) },
    { label: 'source sha absent', fields: { sourceSha: undefined }, ops: opsLoad(), file: JSON.stringify(opsConfig()) },
    { label: 'source sha empty', fields: { sourceSha: '' }, ops: opsLoad(), file: JSON.stringify(opsConfig()) },
    { label: 'build role missing', fields: {}, ops: opsLoad(['build']), file: JSON.stringify(opsConfig(['build'])) },
    { label: 'package role missing', fields: {}, ops: opsLoad(['package']), file: JSON.stringify(opsConfig(['package'])) },
    { label: 'ops configuration unreadable', fields: {}, ops: UNREADABLE, file: '{' },
  ];
  for (const c of cases) {
    // The runner, given the stored attempt.
    const viaRunner = stored(fx, goalId, { target: 'package', environment: undefined, ...c.fields });
    for (const status of STATUSES) assertRefused(fx, releaseRunner(fx, c.ops), viaRunner.id, 'package-run-proof', status, 'package-run-proof', undefined);
    assert.equal(fx.store.getRelease(viaRunner.id)!.state, 'PREPARE', c.label);
    // The CLI, which reads the ops configuration of the repository.
    writeFileSync(opsFile, c.file, 'utf8');
    const viaCli = stored(fx, goalId, { target: 'package', environment: undefined, ...c.fields });
    const before = JSON.stringify(viaCli);
    const events = fx.events(goalId).length;
    const res = cli(fx, 'release', 'report', viaCli.id, '--step', 'package-run-proof', '--status', 'succeeded');
    assert.equal(res.status, 1, `${c.label}: ${res.stdout}${res.stderr}`);
    assert.ok(res.stderr.includes(`aidlc: release attempt ${viaCli.id} is in PREPARE`) && res.stderr.includes(expectsText(undefined)), `${c.label}: ${res.stderr}`);
    assert.equal(JSON.stringify(fx.store.getRelease(viaCli.id)), before, c.label);
    assert.equal(fx.events(goalId).length, events, c.label);
  }
  // Every need met: the run proof is accepted and delivers the attempt.
  const met = stored(fx, goalId, { target: 'package', environment: undefined });
  const done = releaseRunner(fx).reportStep(fx.goal(goalId), met, 'package-run-proof', 'succeeded');
  assert.equal(done.state, 'DONE');
  assert.equal(done.disposition, 'delivered');
  writeFileSync(opsFile, JSON.stringify(opsConfig()), 'utf8');
  const metCli = stored(fx, goalId, { target: 'package', environment: undefined });
  const res = cli(fx, 'release', 'report', metCli.id, '--step', 'package-run-proof', '--status', 'succeeded');
  assert.equal(res.status, 0, res.stderr);
  assert.equal(fx.store.getRelease(metCli.id)!.state, 'DONE');
});

/** The STOP a failed step of each manual name leads to (R4, R5, R6). */
const FAILED_STOP = {
  'package-run-proof': { detail: 'package install/run proof failed', nextAction: 'diagnose; a repair card re-enters candidate preparation' },
  'stage-verify': { detail: 'staging verification failed', nextAction: 'diagnose; a repair card re-enters candidate preparation' },
  'recover-verify': { detail: 'recovery verification failed', nextAction: 'escalate to the named owner with environment and data state' },
} as const;

/** `next` stops the attempt with the STOP of a failed `name`, saved and returned. */
function assertFailedStop(fx: Fx, runner: ReleaseRunner, attemptId: string, name: (typeof MANUAL)[number], global: boolean): void {
  const r = runner.next(fx.goal(fx.store.getRelease(attemptId)!.goalId), fx.store.getRelease(attemptId)!);
  assert.equal(r.directive.kind, 'stop', `${name}: ${r.directive.narration}`);
  assert.equal(r.attempt.state, 'STOP', name);
  assert.equal(r.attempt.disposition, 'failed', name);
  assert.equal(r.attempt.stop?.reason, 'release-health', name);
  assert.equal(r.attempt.stop?.detail, FAILED_STOP[name].detail, name);
  assert.equal(r.attempt.stop?.nextAction, FAILED_STOP[name].nextAction, name);
  assert.equal(r.attempt.stop?.global, global, name);
  if (r.directive.kind === 'stop') assert.deepEqual(r.directive.stop, r.attempt.stop, name);
  assert.deepEqual({ ...fx.store.getRelease(attemptId)!, updatedAt: '' }, { ...r.attempt, updatedAt: '' }, `${name}: the STOP is saved`);
}

/** The `global` flag of the STOP of a failed `recover` operation, which R5 copies. */
function failedRecoverGlobal(fx: Fx, goalId: string): boolean {
  const attempt = stored(fx, goalId, { target: 'production', environment: 'production', state: 'RECOVER', disposition: 'recovered', steps: [step('recover', 'failed')] });
  const r = releaseRunner(fx).next(fx.goal(goalId), attempt);
  assert.equal(r.attempt.stop?.detail, 'recovery procedure failed');
  return r.attempt.stop!.global;
}

test('a failed verification stops the attempt as a failed operation of its state does', (t) => {
  const { fx, goalId } = setup(t);
  const runner = releaseRunner(fx);
  const recoverGlobal = failedRecoverGlobal(fx, goalId);
  for (const name of MANUAL) {
    const attempt = expecting(fx, goalId, name);
    runner.reportStep(fx.goal(goalId), attempt, name, 'failed');
    assertFailedStop(fx, runner, attempt.id, name, name === 'recover-verify' ? recoverGlobal : false);
  }
  // A production attempt in STAGE stops the same way.
  const prodStage = stored(fx, goalId, { target: 'production', environment: 'staging', state: 'STAGE', steps: [step('stage-deploy', 'succeeded')] });
  runner.reportStep(fx.goal(goalId), prodStage, 'stage-verify', 'failed');
  assertFailedStop(fx, runner, prodStage.id, 'stage-verify', false);
  // The failed run proof is read before the PREPARE needs: an ops configuration unreadable after the report still stops.
  const pkg = expecting(fx, goalId, 'package-run-proof');
  runner.reportStep(fx.goal(goalId), pkg, 'package-run-proof', 'failed');
  assertFailedStop(fx, releaseRunner(fx, UNREADABLE), pkg.id, 'package-run-proof', false);
});

test('a failed manual step is final', (t) => {
  const { fx, goalId } = setup(t);
  const runner = releaseRunner(fx);
  const recoverGlobal = failedRecoverGlobal(fx, goalId);
  for (const name of MANUAL) {
    const attempt = expecting(fx, goalId, name);
    runner.reportStep(fx.goal(goalId), attempt, name, 'failed');
    for (const status of STATUSES) assertRefused(fx, runner, attempt.id, name, status, name, undefined);
    assertFailedStop(fx, runner, attempt.id, name, name === 'recover-verify' ? recoverGlobal : false);
    for (const status of STATUSES) assertRefused(fx, runner, attempt.id, name, status, name, undefined);
  }
  // aidlc release candidate with a new digest does not clear a failed run proof.
  const pkg = expecting(fx, goalId, 'package-run-proof');
  runner.reportStep(fx.goal(goalId), pkg, 'package-run-proof', 'failed');
  const res = cli(fx, 'release', 'candidate', pkg.id, '--digest', 'c2', '--sha', 'b'.repeat(40));
  assert.equal(res.status, 0, res.stderr);
  const rebound = fx.store.getRelease(pkg.id)!;
  assert.equal(rebound.candidateDigest, 'c2');
  assert.deepEqual(rebound.steps.find((s) => s.name === 'package-run-proof'), step('package-run-proof', 'failed'));
  assertRefused(fx, runner, pkg.id, 'package-run-proof', 'succeeded', 'package-run-proof', undefined);
  assertFailedStop(fx, runner, pkg.id, 'package-run-proof', false);
  // A succeeded verification stays expected until the state advances: reported again with any status before next.
  for (const name of ['stage-verify', 'recover-verify'] as const) {
    const attempt = expecting(fx, goalId, name);
    let current = runner.reportStep(fx.goal(goalId), attempt, name, 'succeeded');
    current = runner.reportStep(fx.goal(goalId), current, name, 'succeeded');
    current = runner.reportStep(fx.goal(goalId), current, name, 'UNKNOWN');
    current = runner.reportStep(fx.goal(goalId), current, name, 'succeeded');
    current = runner.reportStep(fx.goal(goalId), current, name, 'failed');
    assert.deepEqual(current.steps.find((s) => s.name === name), step(name, 'failed'));
    assertFailedStop(fx, runner, attempt.id, name, name === 'recover-verify' ? recoverGlobal : false);
  }
  // Finality is read from the stored step: a report whose save failed leaves its journal event and the step still expected.
  for (const name of MANUAL) {
    const losing = new GoalStore(fx.paths);
    let lose = true;
    const save = losing.saveRelease.bind(losing);
    losing.saveRelease = (a) => {
      if (lose) {
        lose = false;
        throw new Error('save lost');
      }
      return save(a);
    };
    const attempt = expecting(fx, goalId, name);
    const before = JSON.stringify(attempt);
    const events = fx.events(goalId);
    assert.throws(() => releaseRunner(fx, opsLoad(), losing).reportStep(fx.goal(goalId), attempt, name, 'failed'), /save lost/);
    const after = fx.events(goalId);
    assert.equal(after.length, events.length + 1, name);
    assert.equal(after.at(-1)!.type, 'EVIDENCE_RETAINED', name);
    assert.equal(JSON.stringify(fx.store.getRelease(attempt.id)), before, name);
    const again = releaseRunner(fx, opsLoad(), losing).reportStep(fx.goal(goalId), fx.store.getRelease(attempt.id)!, name, 'failed');
    assert.deepEqual(again.steps.find((s) => s.name === name), step(name, 'failed'), name);
  }
});

test('an UNKNOWN verification keeps the state and the step is asked for again', (t) => {
  const { fx, goalId } = setup(t);
  const runner = releaseRunner(fx);
  for (const name of MANUAL) {
    const attempt = expecting(fx, goalId, name);
    const reported = runner.reportStep(fx.goal(goalId), attempt, name, 'UNKNOWN');
    assert.equal(reported.state, attempt.state, name);
    const r = runner.next(fx.goal(goalId), reported);
    assert.equal(r.attempt.state, attempt.state, name);
    if (name === 'package-run-proof') {
      assert.equal(r.directive.kind, 'prepare', r.directive.narration);
      if (r.directive.kind === 'prepare') assert.deepEqual(r.directive.needs, ['install/run proof']);
      assert.ok(r.directive.narration.includes(`aidlc release report ${attempt.id} --step package-run-proof`), r.directive.narration);
    } else if (name === 'stage-verify') {
      assert.equal(r.directive.kind, 'stage', r.directive.narration);
      assert.ok(r.directive.narration.includes(`aidlc release report ${attempt.id} --step stage-verify`), r.directive.narration);
    } else {
      assert.equal(r.directive.kind, 'recover', r.directive.narration);
      assert.ok(r.directive.narration.includes('recover-verify'), r.directive.narration);
    }
    // Reported again after next, the step is still expected.
    assert.equal(runner.reportStep(fx.goal(goalId), r.attempt, name, 'UNKNOWN').state, attempt.state, name);
  }
});

test('aidlc release report refuses an operation step by exit 1 and writes nothing', (t) => {
  const { fx, goalId } = setup(t);
  const attempt = stored(fx, goalId, { state: 'STAGE', steps: [{ name: 'stage-deploy', status: 'succeeded', operationId: 'op-1' }], operations: ['op-1'] });
  const before = JSON.stringify(attempt);
  const events = fx.events(goalId).length;
  const res = cli(fx, 'release', 'report', attempt.id, '--step', 'stage-deploy', '--status', 'succeeded');
  assert.equal(res.status, 1, res.stdout);
  const line = res.stderr.split(/\r?\n/).find((l) => l.startsWith('aidlc: ')) ?? '';
  for (const part of [`aidlc: release attempt ${attempt.id} is in STAGE`, '"stage-deploy"', expectsText('stage-verify')]) assert.ok(line.includes(part), res.stderr);
  assert.equal(JSON.stringify(fx.store.getRelease(attempt.id)), before);
  assert.equal(fx.events(goalId).length, events);
  // The --goal refusal comes first and is unchanged.
  writeCard(fx, { id: 'T1-OTHER', title: 'another goal' });
  const other = goalForCards(fx, ['T1-OTHER']);
  const foreign = cli(fx, 'release', 'report', attempt.id, '--step', 'stage-deploy', '--status', 'succeeded', '--goal', other.id);
  assert.equal(foreign.status, 1);
  assert.ok(foreign.stderr.includes(`aidlc: release attempt ${attempt.id} belongs to goal ${goalId}, not ${other.id}`), foreign.stderr);
  assert.equal(JSON.stringify(fx.store.getRelease(attempt.id)), before);
  // The help names the three accepted steps and the state of each.
  const help = cli(fx, 'release', 'report', '--help');
  assert.equal(help.status, 0, help.stderr);
  // Commander wraps a long description; read it with its whitespace folded.
  const text = help.stdout.replace(/\s+/g, ' ');
  for (const part of ['package-run-proof (PREPARE', 'stage-verify (STAGE', 'recover-verify (RECOVER']) assert.ok(text.includes(part), help.stdout);
  assert.ok(!help.stdout.includes('...'), help.stdout);
});
