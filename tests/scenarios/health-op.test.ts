// Card T0-HEALTH-OP-SIGNALS: a release runner built without a signal source, as `aidlc release next` builds it, reads the
// OBSERVE health signals from the last non-blank stdout line of the bound `health` operation, run once per evaluation.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorB, goalForCards, makeFixture, opsConfigured, opsNotConfigured, opsRunner, writeCard, T0, type Fixture } from './_harness.ts';
import { cleanup } from '../infra/helpers.ts';
import { ReleaseRunner } from '../../src/loop/release-runner.ts';
import * as ops from '../../src/delivery/ops.ts';
import { ReleaseAttempt, HOUR_MS, MINUTE_MS, addMs, type HealthSignal } from '../../src/core/types.ts';
import { evaluateSignal } from '../../src/core/health.ts';
import { LeaseStore, resourceKeys } from '../../src/coordination/lease.ts';
import { Journal } from '../../src/state/journal.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import type { ExecReceipt, SyncRunner } from '../../src/probes/exec.ts';

type Fx = Fixture;
type Entry = Record<string, unknown>;
type Receipt = Partial<ExecReceipt>;

const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const BOTH_UNAVAILABLE = ['http_5xx_rate=INSUFFICIENT_DATA', 'p95_latency_ms=INSUFFICIENT_DATA'];
const BOTH_PASS = ['http_5xx_rate=PASS', 'p95_latency_ms=PASS'];
const DECLARED = [
  { name: 'http_5xx_rate', source: 'prometheus', threshold: { op: '<', value: 1 }, minSamples: 5 },
  { name: 'p95_latency_ms', source: 'prometheus', threshold: { op: '<=', value: 800 }, minSamples: 5 },
];
const HEALTH_BINDING: Entry = { role: 'health', command: ['health-cmd'], targetSelection: 'arg', targetArg: '--env', timeoutMs: 60000 };

/** A production goal in a fixture removed after the test. */
function setup(t: TestContext): { fx: Fx; goalId: string } {
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  writeCard(fx, { id: 'T1-HELLO', title: 'print hello' });
  return { fx, goalId: goalForCards(fx, ['T1-HELLO'], { target: 'production' }).id };
}

interface HealthChange {
  binding?: Entry;
  bindings?: Entry[];
  health?: Entry[];
  asyncDeploy?: boolean;
}

/** The deploy, status and environment bindings of the scenarios, the health binding (with `binding` applied, or `bindings`), a recover binding and the declared list. */
function healthOps(change: HealthChange = {}): ops.OpsLoad {
  const base = opsConfigured({ asyncDeploy: change.asyncDeploy });
  if (base.status !== 'configured') throw new Error('opsConfigured is configured');
  const kept = base.config.operations.filter((o) => ['deploy', 'status', 'environment'].includes(o.role));
  const health = change.bindings ?? [{ ...HEALTH_BINDING, ...change.binding }];
  const recover = { role: 'recover', command: ['recover-cmd'], targetSelection: 'arg', successPattern: 'ok' };
  const config = ops.DeliveryOpsConfig.parse({ schemaVersion: 1, environments: { staging: { production: false }, production: { production: true } }, operations: [...kept, ...health, recover], health: change.health ?? DECLARED });
  return { status: 'configured', config, file: 'memory' };
}

interface Call {
  command: string;
  args: string[];
  cwd: string | undefined;
  target: string | undefined;
  timeoutMs: number | undefined;
  killTree: boolean | undefined;
}

/** A runner that records each call and answers a `health-` command with `answer()`, built at the call, and every other command as the scenario ops runner. */
function recording(fx: Fx, answer: () => Receipt | Error): { runner: SyncRunner; calls: Call[]; health: () => Call[] } {
  const calls: Call[] = [];
  const runner: SyncRunner = (command, args, options) => {
    calls.push({ command, args, cwd: options?.cwd, target: options?.env?.['AIDLC_TARGET_ENV'], timeoutMs: options?.timeoutMs, killTree: options?.killTree });
    if (!command.startsWith('health-')) return opsRunner(command, args, options);
    const r = answer();
    if (r instanceof Error) throw r;
    return { command, args, cwd: options?.cwd ?? fx.tmp, exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', startedAt: fx.now(), finishedAt: fx.now(), durationMs: 0, outputSha256: '', ...r };
  };
  return { runner, calls, health: () => calls.filter((c) => c.command.startsWith('health-')) };
}

function releaseRunner(fx: Fx, opsLoad: ops.OpsLoad, runner: SyncRunner, extra: { leases?: LeaseStore; store?: GoalStore; signals?: (a: ReleaseAttempt) => HealthSignal[] } = {}): ReleaseRunner {
  return new ReleaseRunner({ paths: fx.paths, repo: fx.repo, store: extra.store ?? fx.store, ops: fx.ops, leases: extra.leases ?? fx.leases, runner, opsLoad, now: fx.now, ...(extra.signals ? { signals: extra.signals } : {}) });
}

let attempts = 0;
/** A production attempt stored in OBSERVE (candidate c1, window T0 to T0 plus 10 minutes), with a new id each call. */
function observing(fx: Fx, goalId: string, overrides: Partial<ReleaseAttempt> = {}): ReleaseAttempt {
  const attempt = ReleaseAttempt.parse({ id: `rel-${goalId}-obs-${++attempts}`, goalId, generation: 0, target: 'production', environment: 'production', state: 'OBSERVE', candidateDigest: 'c1', sourceSha: 's1', healthWindow: { from: T0, to: addMs(T0, 10 * MINUTE_MS) }, startedAt: T0, deadline: addMs(T0, 12 * HOUR_MS), updatedAt: T0, ...overrides });
  fx.store.saveRelease(attempt);
  return attempt;
}

const entry = (fx: Fx, name: string, observed: number, extra: Entry = {}): Entry => ({ name, observed, samples: 20, lastSampleAt: fx.now(), ...extra });
const body = (fx: Fx, extra: Entry = {}, signals?: Entry[]): Entry => ({ environment: 'production', candidate: 'c1', signals: signals ?? [entry(fx, 'http_5xx_rate', 0.1), entry(fx, 'p95_latency_ms', 300)], ...extra });
/** The base report with `extra` applied to its first entry. */
const firstEntry = (fx: Fx, extra: Entry): Entry => body(fx, {}, [entry(fx, 'http_5xx_rate', 0.1, extra), entry(fx, 'p95_latency_ms', 300)]);
const printed = (report: unknown): string => `probe start\n${JSON.stringify(report)}\n`;
const passing = (fx: Fx): Receipt => ({ exitCode: 0, stdout: printed(body(fx)) });

/** The `HEALTH_EVALUATED` data of one attempt. */
function evaluations(fx: Fx, goalId: string, attemptId: string): { result: string; signals: string[] }[] {
  return fx.events(goalId).filter((e) => e.type === 'HEALTH_EVALUATED' && e.data['attemptId'] === attemptId).map((e) => ({ result: String(e.data['result']), signals: e.data['signals'] as string[] }));
}

interface Row {
  label: string;
  ops?: HealthChange;
  load?: ops.OpsLoad;
  attempt?: Partial<ReleaseAttempt>;
  answer?: (fx: Fx) => Receipt;
  noCall?: boolean;
}

/** One `next` at the fixture time on a new attempt of the row, with a new recording runner. */
function runRow(fx: Fx, goalId: string, row: Row) {
  const attempt = observing(fx, goalId, row.attempt);
  const rec = recording(fx, () => (row.answer ?? passing)(fx));
  const r = releaseRunner(fx, row.load ?? healthOps(row.ops), rec.runner).next(fx.goal(goalId), attempt);
  return { r, attempt, health: rec.health(), evaluated: evaluations(fx, goalId, attempt.id) };
}

function assertUnavailable(out: ReturnType<typeof runRow>, row: Row): void {
  assert.deepEqual(out.evaluated.map((e) => e.signals), [BOTH_UNAVAILABLE], row.label);
  assert.equal(out.r.attempt.healthResult, 'INSUFFICIENT_DATA', row.label);
  assert.equal(out.r.directive.kind, 'observe', row.label);
  assert.equal(out.health.length, row.noCall ? 0 : 1, `${row.label}: health calls`);
}

function assertPass(out: ReturnType<typeof runRow>, label: string): void {
  assert.deepEqual(out.evaluated.map((e) => e.signals), [BOTH_PASS], label);
  assert.equal(out.r.attempt.healthResult, 'PASS', label);
  assert.equal(out.r.directive.kind, 'observe', label);
  assert.equal(out.health.length, 1, `${label}: health calls`);
}

test('a runner built without signals closes on a health PASS over the elapsed window', (t) => {
  const { fx, goalId } = setup(t);
  const attempt = observing(fx, goalId);
  const runner = releaseRunner(fx, healthOps(), recording(fx, () => passing(fx)).runner);
  let r = runner.next(fx.goal(goalId), attempt);
  assert.equal(r.directive.kind, 'observe', r.directive.narration);
  assert.equal(r.attempt.state, 'OBSERVE');
  assert.equal(r.attempt.healthResult, 'PASS');
  assert.deepEqual(evaluations(fx, goalId, attempt.id).map((e) => e.signals), [BOTH_PASS]);
  fx.advance(11 * MINUTE_MS);
  r = runner.next(fx.goal(goalId), r.attempt);
  assert.equal(r.directive.kind, 'close', r.directive.narration);
  assert.equal(r.attempt.state, 'CLOSE');
  assert.equal(r.attempt.healthResult, 'PASS');
  r = runner.next(fx.goal(goalId), r.attempt);
  assert.equal(r.directive.kind, 'done');
  assert.equal(r.attempt.disposition, 'delivered');
});

test('a health BREACH read from the bound command goes to RECOVER, or stops without recovery authority', (t) => {
  const breach = (fx: Fx): Receipt => ({ exitCode: 0, stdout: printed(body(fx, {}, [entry(fx, 'http_5xx_rate', 7.5), entry(fx, 'p95_latency_ms', 300)])) });
  const authorized = setup(t);
  {
    const { fx, goalId } = authorized;
    fx.controller.report({
      goalId,
      generation: 0,
      result: 'approved',
      data: { kind: 'recovery', by: 'sre-lead', candidateDigest: 'c1', environment: 'production', operations: [], recovery: { eligibleBaseline: 'v1.4.2', healthTrigger: 'http_5xx_rate >= 1 over 5m', procedure: 'recover-cmd', migrationCompatibility: 'schema unchanged', windowMs: 30 * MINUTE_MS, owner: 'sre-oncall' } },
    });
    const attempt = observing(fx, goalId);
    const r = releaseRunner(fx, healthOps(), recording(fx, () => breach(fx)).runner).next(fx.goal(goalId), attempt);
    assert.equal(r.directive.kind, 'recover', r.directive.narration);
    assert.equal(r.attempt.state, 'RECOVER');
    assert.equal(r.attempt.disposition, 'recovered');
    assert.deepEqual(fx.ops.list({ goalId, kind: 'rollback' }).map((o) => o.status), ['succeeded']);
    assert.deepEqual(evaluations(fx, goalId, attempt.id).map((e) => e.signals), [['http_5xx_rate=BREACH', 'p95_latency_ms=PASS']]);
  }
  const { fx, goalId } = setup(t);
  const attempt = observing(fx, goalId);
  const r = releaseRunner(fx, healthOps(), recording(fx, () => breach(fx)).runner).next(fx.goal(goalId), attempt);
  assert.equal(r.directive.kind, 'stop');
  assert.equal(r.attempt.stop?.reason, 'rollback-auth');
  assert.equal(fx.ops.list({ goalId, kind: 'rollback' }).length, 0);
});

test('unsuccessful execution receipts and invalid reports produce unavailable signals, never PASS', (t) => {
  const { fx, goalId } = setup(t);
  writeFileSync(path.join(fx.tmp, 'health-file'), 'not a directory');
  const base = (fx: Fx): string => printed(body(fx));
  const lines = (last: string): Receipt => ({ exitCode: 0, stdout: `probe start\n${last}\n` });
  const schema = (label: string, report: (fx: Fx) => Entry): Row => ({ label: `schema: ${label}`, answer: (fx) => ({ exitCode: 0, stdout: printed(report(fx)) }) });
  const noBinding: Row = { label: 'no binding', ops: { bindings: [] }, noCall: true };
  const rows: Row[] = [
    noBinding,
    { label: 'attempt without environment', attempt: { environment: undefined }, noCall: true },
    { label: 'attempt environment empty', attempt: { environment: '' }, noCall: true },
    { label: 'cwd missing', ops: { binding: { cwd: 'missing' } }, noCall: true },
    { label: 'cwd a file', ops: { binding: { cwd: 'health-file' } }, noCall: true },
    { label: 'exit 1', answer: (fx) => ({ exitCode: 1, stdout: base(fx) }) },
    { label: 'exit null, not timed out', answer: (fx) => ({ exitCode: null, timedOut: false, stdout: base(fx) }) },
    { label: 'timed out', answer: (fx) => ({ exitCode: 0, timedOut: true, stdout: base(fx) }) },
    { label: 'failure pattern on stdout', ops: { binding: { failurePattern: 'DEGRADED' } }, answer: (fx) => ({ exitCode: 0, stdout: `DEGRADED\n${base(fx)}` }) },
    { label: 'failure pattern on stderr only', ops: { binding: { failurePattern: 'DEGRADED' } }, answer: (fx) => ({ exitCode: 0, stdout: base(fx), stderr: 'DEGRADED\n' }) },
    { label: 'success pattern not seen', ops: { binding: { successPattern: 'probe ok' } } },
    { label: 'async exit 0 (issued)', ops: { binding: { async: true } } },
    { label: 'async exit 1 (UNKNOWN)', ops: { binding: { async: true } }, answer: (fx) => ({ exitCode: 1, stdout: base(fx) }) },
    { label: 'report on stderr, stdout empty', answer: (fx) => ({ exitCode: 0, stdout: '', stderr: base(fx) }) },
    { label: 'stdout empty', answer: () => ({ exitCode: 0, stdout: '' }) },
    { label: 'stdout blank lines', answer: () => ({ exitCode: 0, stdout: '\n  \n\t\n' }) },
    { label: 'report then a line done', answer: (fx) => ({ exitCode: 0, stdout: `${base(fx)}done\n` }) },
    { label: 'last line {', answer: () => lines('{') },
    { label: 'last line []', answer: () => lines('[]') },
    { label: 'last line null', answer: () => lines('null') },
    { label: 'last line "text"', answer: () => lines('"text"') },
    schema('environment absent', (fx) => body(fx, { environment: undefined })),
    schema('environment 7', (fx) => body(fx, { environment: 7 })),
    schema("environment ''", (fx) => body(fx, { environment: '' })),
    schema('candidate absent', (fx) => body(fx, { candidate: undefined })),
    schema("candidate ''", (fx) => body(fx, { candidate: '' })),
    schema('signals absent', (fx) => body(fx, { signals: undefined })),
    schema('signals {}', (fx) => body(fx, { signals: {} })),
    schema('an entry without name', (fx) => firstEntry(fx, { name: undefined })),
    schema('samples -1', (fx) => firstEntry(fx, { samples: -1 })),
    schema('samples 1.5', (fx) => firstEntry(fx, { samples: 1.5 })),
    schema('samples "20"', (fx) => firstEntry(fx, { samples: '20' })),
    schema('samples 9007199254740992', (fx) => firstEntry(fx, { samples: 9007199254740992 })),
    schema('observed "0.1"', (fx) => firstEntry(fx, { observed: '0.1' })),
    schema('observed null', (fx) => firstEntry(fx, { observed: null })),
    { label: 'schema: observed 1e400', answer: (fx) => ({ exitCode: 0, stdout: printed(firstEntry(fx, { observed: 'INF' })).replace('"INF"', '1e400') }) },
    schema('lastSampleAt with a space', (fx) => firstEntry(fx, { lastSampleAt: '2026-09-11 00:00:00Z' })),
    schema('lastSampleAt month 13', (fx) => firstEntry(fx, { lastSampleAt: '2026-13-01T00:00:00.000Z' })),
    schema('lastSampleAt 0', (fx) => firstEntry(fx, { lastSampleAt: 0 })),
    schema('a malformed undeclared entry', (fx) => body(fx, {}, [entry(fx, 'http_5xx_rate', 0.1), entry(fx, 'p95_latency_ms', 300), { name: 'cpu', samples: -1 }])),
  ];
  let noBindingAttempt: ReleaseAttempt | undefined;
  for (const row of rows) {
    const out = runRow(fx, goalId, row);
    assertUnavailable(out, row);
    if (row === noBinding) noBindingAttempt = out.r.attempt;
  }
  const controls: [string, (fx: Fx) => Receipt, HealthChange?][] = [
    ['the base report', passing],
    ['CRLF line ends', (fx) => ({ exitCode: 0, stdout: base(fx).replace(/\n/g, '\r\n') })],
    ['two blank lines after the report', (fx) => ({ exitCode: 0, stdout: `${base(fx)}  \n\t\n` })],
    ['spaces around the report line', (fx) => ({ exitCode: 0, stdout: `probe start\n   ${JSON.stringify(body(fx))}   \n` })],
    ['success pattern on stdout', (fx) => ({ exitCode: 0, stdout: `probe ok\n${base(fx)}` }), { binding: { successPattern: 'probe ok' } }],
    ['success pattern on stderr only', (fx) => ({ exitCode: 0, stdout: base(fx), stderr: 'probe ok\n' }), { binding: { successPattern: 'probe ok' } }],
    ['samples 9007199254740991', (fx) => ({ exitCode: 0, stdout: printed(firstEntry(fx, { samples: 9007199254740991 })) })],
  ];
  for (const [label, answer, change] of controls) assertPass(runRow(fx, goalId, { label, answer, ops: change }), `control: ${label}`);
  fx.advance(41 * MINUTE_MS);
  const late = releaseRunner(fx, healthOps({ bindings: [] }), recording(fx, () => passing(fx)).runner).next(fx.goal(goalId), fx.store.getRelease(noBindingAttempt!.id)!);
  assert.equal(late.directive.kind, 'stop');
  assert.equal(late.attempt.stop?.reason, 'release-health');
  assert.equal(late.attempt.stop?.detail, 'insufficient health data within the maximum wait');
});

test("the report names the attempt's environment by its lease and its candidate exactly", (t) => {
  const { fx, goalId } = setup(t);
  const reporting = (extra: Entry) => (fx: Fx): Receipt => ({ exitCode: 0, stdout: printed(body(fx, extra)) });
  assertPass(runRow(fx, goalId, { label: 'Production', answer: reporting({ environment: 'Production' }) }), 'environment Production');
  const slash = runRow(fx, goalId, { label: 'OPS\\prod', attempt: { environment: 'ops/prod' }, answer: reporting({ environment: 'OPS\\prod' }) });
  assertPass(slash, 'environment OPS\\prod for ops/prod');
  assert.deepEqual(slash.health[0]!.args, ['--env', 'ops/prod']);
  const rows: Row[] = [
    { label: 'environment staging', answer: reporting({ environment: 'staging' }) },
    { label: 'environment with a trailing space', answer: reporting({ environment: 'production ' }) },
    { label: 'candidate C1', answer: reporting({ candidate: 'C1' }) },
    { label: 'candidate with a leading space', answer: reporting({ candidate: ' c1' }) },
    { label: 'candidate c2', answer: reporting({ candidate: 'c2' }) },
    { label: 'attempt without a digest', attempt: { candidateDigest: undefined } },
    { label: 'attempt with an empty digest', attempt: { candidateDigest: '' } },
  ];
  for (const row of rows) assertUnavailable(runRow(fx, goalId, row), row);
});

test('a signal the report does not name, or names twice, is INSUFFICIENT_DATA; an undeclared one is ignored', (t) => {
  const { fx, goalId } = setup(t);
  const listing = (signals: (fx: Fx) => Entry[]) => (fx: Fx): Receipt => ({ exitCode: 0, stdout: printed(body(fx, {}, signals(fx))) });
  const rows: [string, (fx: Fx) => Entry[], string, string[]][] = [
    ['http_5xx_rate only', (fx) => [entry(fx, 'http_5xx_rate', 0.1)], 'INSUFFICIENT_DATA', ['http_5xx_rate=PASS', 'p95_latency_ms=INSUFFICIENT_DATA']],
    ['p95_latency_ms twice', (fx) => [entry(fx, 'http_5xx_rate', 0.1), entry(fx, 'p95_latency_ms', 300), entry(fx, 'p95_latency_ms', 300)], 'INSUFFICIENT_DATA', ['http_5xx_rate=PASS', 'p95_latency_ms=INSUFFICIENT_DATA']],
    ['an undeclared cpu entry', (fx) => [entry(fx, 'http_5xx_rate', 0.1), entry(fx, 'p95_latency_ms', 300), entry(fx, 'cpu', 1000000)], 'PASS', BOTH_PASS],
    ['p95_latency_ms not named, http_5xx_rate breached', (fx) => [entry(fx, 'http_5xx_rate', 7.5)], 'BREACH', ['http_5xx_rate=BREACH', 'p95_latency_ms=INSUFFICIENT_DATA']],
    ['http_5xx_rate without observed', (fx) => [entry(fx, 'http_5xx_rate', 0.1, { observed: undefined }), entry(fx, 'p95_latency_ms', 300)], 'INSUFFICIENT_DATA', ['http_5xx_rate=INSUFFICIENT_DATA', 'p95_latency_ms=PASS']],
    ['http_5xx_rate without lastSampleAt', (fx) => [entry(fx, 'http_5xx_rate', 0.1, { lastSampleAt: undefined }), entry(fx, 'p95_latency_ms', 300)], 'INSUFFICIENT_DATA', ['http_5xx_rate=INSUFFICIENT_DATA', 'p95_latency_ms=PASS']],
    ['http_5xx_rate with samples 0', (fx) => [entry(fx, 'http_5xx_rate', 0.1, { samples: 0 }), entry(fx, 'p95_latency_ms', 300)], 'INSUFFICIENT_DATA', ['http_5xx_rate=INSUFFICIENT_DATA', 'p95_latency_ms=PASS']],
    ['http_5xx_rate six minutes old', (fx) => [entry(fx, 'http_5xx_rate', 0.1, { lastSampleAt: addMs(fx.now(), -6 * MINUTE_MS) }), entry(fx, 'p95_latency_ms', 300)], 'INSUFFICIENT_DATA', ['http_5xx_rate=INSUFFICIENT_DATA', 'p95_latency_ms=PASS']],
  ];
  for (const [label, signals, result, expected] of rows) {
    const out = runRow(fx, goalId, { label, answer: listing(signals) });
    assert.deepEqual(out.evaluated, [{ result, signals: expected }], label);
  }
});

test('aidlc.ops.json, not the command, gives each signal its source, threshold, minimum samples and staleness', (t) => {
  const D = ops.DeliveryOpsConfig.parse({
    schemaVersion: 1,
    health: [
      { name: 'a', source: 's1', threshold: { op: '<', value: 1 }, minSamples: 5, maxStalenessMs: 120000, windowMs: 600000, maxWaitMs: 1800000 },
      { name: 'b', source: 's2', threshold: { op: '>=', value: 2 }, minSamples: 1, maxStalenessMs: 300000, windowMs: 600000, maxWaitMs: 1800000 },
    ],
  }).health;
  type Report = Parameters<typeof ops.healthSignals>[1];
  // (a) Unknown keys are dropped at both levels.
  const line = JSON.stringify({ environment: 'production', candidate: 'c1', window: 600000, signals: [{ name: 'a', observed: 0.5, samples: 9, lastSampleAt: T0, unit: 'ratio' }] });
  assert.deepEqual(ops.healthReportOf(`${line}\n`), { environment: 'production', candidate: 'c1', signals: [{ name: 'a', observed: 0.5, samples: 9, lastSampleAt: T0 }] });
  // (b) Declaration order and declared fields; the report's source is not read.
  const report = { environment: 'production', candidate: 'c1', signals: [{ name: 'b', observed: 3, samples: 4, lastSampleAt: T0 }, { name: 'a', observed: 0.5, samples: 9, lastSampleAt: T0, source: 'other' }] } as Report;
  assert.deepEqual(ops.healthSignals(D, report), [
    { name: 'a', source: 's1', threshold: { op: '<', value: 1 }, minSamples: 5, maxStalenessMs: 120000, observed: 0.5, samples: 9, lastSampleAt: T0, synthetic: false, probeAvailable: true },
    { name: 'b', source: 's2', threshold: { op: '>=', value: 2 }, minSamples: 1, maxStalenessMs: 300000, observed: 3, samples: 4, lastSampleAt: T0, synthetic: false, probeAvailable: true },
  ]);
  // (c) No report: every declared signal unavailable.
  assert.deepEqual(ops.healthSignals(D, undefined), [
    { name: 'a', source: 's1', threshold: { op: '<', value: 1 }, minSamples: 5, maxStalenessMs: 120000, samples: 0, synthetic: false, probeAvailable: false },
    { name: 'b', source: 's2', threshold: { op: '>=', value: 2 }, minSamples: 1, maxStalenessMs: 300000, samples: 0, synthetic: false, probeAvailable: false },
  ]);
  // (d) Two declarations of one name each read that one entry.
  const twice = [D[0]!, { ...D[0]!, threshold: { op: '<' as const, value: 0.1 } }];
  const once = { environment: 'production', candidate: 'c1', signals: [{ name: 'a', observed: 0.5, samples: 9, lastSampleAt: T0 }] } as Report;
  assert.deepEqual(ops.healthSignals(twice, once).map((s) => [s.probeAvailable, s.observed]), [[true, 0.5], [true, 0.5]]);
  // (e) A re-cased or padded name does not match.
  const near = { environment: 'production', candidate: 'c1', signals: [{ name: 'A', observed: 0.5, samples: 9, lastSampleAt: T0 }, { name: ' a', observed: 0.5, samples: 9, lastSampleAt: T0 }] } as Report;
  assert.equal(ops.healthSignals(D, near)[0]!.probeAvailable, false);
  // (f) An empty name and source are kept verbatim.
  const blank = ops.DeliveryOpsConfig.parse({ schemaVersion: 1, health: [{ name: '', source: '', threshold: { op: '<', value: 1 } }] }).health;
  const blankReport = { environment: 'production', candidate: 'c1', signals: [{ name: '', observed: 0.5, samples: 9, lastSampleAt: T0 }] } as Report;
  assert.deepEqual(ops.healthSignals(blank, blankReport).map((s) => [s.name, s.source, s.probeAvailable]), [['', '', true]]);

  const { fx, goalId } = setup(t);
  const through = (label: string, health: Entry[] | undefined, signals: (fx: Fx) => Entry[]) => runRow(fx, goalId, { label, ops: { health }, answer: (fx) => ({ exitCode: 0, stdout: printed(body(fx, {}, signals(fx))) }) }).evaluated.map((e) => e.signals);
  const lt = (name: string, value: number, extra: Entry = {}): Entry => ({ name, source: 's', threshold: { op: '<', value }, minSamples: 1, ...extra });
  assert.deepEqual(through('two declarations of a', [lt('a', 1), lt('a', 0.1)], (fx) => [entry(fx, 'a', 0.5)]), [['a=PASS', 'a=BREACH']]);
  assert.deepEqual(through('an empty name', [lt('', 1)], (fx) => [entry(fx, '', 0.5)]), [['=PASS']]);
  // (g) The output's threshold, minimum and staleness change nothing.
  const http = (fx: Fx, extra: Entry): Entry[] => [entry(fx, 'http_5xx_rate', 0.1, extra), entry(fx, 'p95_latency_ms', 300)];
  assert.deepEqual(through('threshold in the output', undefined, (fx) => http(fx, { observed: 5, threshold: { op: '<', value: 10 } })), [['http_5xx_rate=BREACH', 'p95_latency_ms=PASS']]);
  assert.deepEqual(through('minSamples in the output', undefined, (fx) => http(fx, { samples: 3, minSamples: 1 })), [['http_5xx_rate=INSUFFICIENT_DATA', 'p95_latency_ms=PASS']]);
  const strict = [{ ...DECLARED[0]!, maxStalenessMs: 60000 }, DECLARED[1]!];
  assert.deepEqual(through('maxStalenessMs in the output', strict, (fx) => http(fx, { lastSampleAt: addMs(fx.now(), -3 * MINUTE_MS), maxStalenessMs: 3600000 })), [['http_5xx_rate=INSUFFICIENT_DATA', 'p95_latency_ms=PASS']]);
});

/** A lease store that counts each call of a method that takes a section, claims, renews, releases, fences or purges. */
class CountingLeases extends LeaseStore {
  readonly counts: Record<string, number> = {};
  private count(name: string): void {
    this.counts[name] = (this.counts[name] ?? 0) + 1;
  }
  override update(...a: Parameters<LeaseStore['update']>) {
    this.count('update');
    return super.update(...a);
  }
  override claim(...a: Parameters<LeaseStore['claim']>) {
    this.count('claim');
    return super.claim(...a);
  }
  override takeover(...a: Parameters<LeaseStore['takeover']>) {
    this.count('takeover');
    return super.takeover(...a);
  }
  override heartbeat(...a: Parameters<LeaseStore['heartbeat']>) {
    this.count('heartbeat');
    return super.heartbeat(...a);
  }
  override release(...a: Parameters<LeaseStore['release']>) {
    this.count('release');
    return super.release(...a);
  }
  override fence(...a: Parameters<LeaseStore['fence']>) {
    this.count('fence');
    return super.fence(...a);
  }
  override purgeReleased(...a: Parameters<LeaseStore['purgeReleased']>) {
    this.count('purgeReleased');
    return super.purgeReleased(...a);
  }
}

test("the health command runs once per call with the attempt's environment, and touches no operation, lease or other event", (t) => {
  const { fx, goalId } = setup(t);
  mkdirSync(path.join(fx.tmp, 'ops'));
  const env = resourceKeys.environment('production');
  assert.equal(fx.leases.claim(env, { actor: actorB, now: T0 }).status, 'acquired');
  const leaseBytes = readFileSync(fx.leases.file(env));
  const ledger = fx.ops.list({ goalId });
  const eventCount = fx.events(goalId).length;
  const leases = new CountingLeases(fx.paths.leases);
  const rec = recording(fx, () => passing(fx));
  const runner = releaseRunner(fx, healthOps({ binding: { cwd: 'ops', idempotencyKeyArg: '--idempotency-key' } }), rec.runner, { leases });
  let attempt = observing(fx, goalId);
  // `targetSelection: 'arg'` leaves the inherited environment as it is: the calls run with the variable unset.
  const inheritedTarget = process.env['AIDLC_TARGET_ENV'];
  delete process.env['AIDLC_TARGET_ENV'];
  try {
    for (const step of [0, 1, 1]) {
      fx.advance(step * MINUTE_MS);
      attempt = runner.next(fx.goal(goalId), attempt).attempt;
    }
  } finally {
    if (inheritedTarget === undefined) delete process.env['AIDLC_TARGET_ENV'];
    else process.env['AIDLC_TARGET_ENV'] = inheritedTarget;
  }
  assert.deepEqual(rec.calls, [0, 1, 2].map(() => ({ command: 'health-cmd', args: ['--env', 'production'], cwd: path.resolve(fx.tmp, 'ops'), target: undefined, timeoutMs: 60000, killTree: true })));
  assert.deepEqual(leases.counts, {});
  assert.deepEqual(readFileSync(fx.leases.file(env)), leaseBytes);
  assert.deepEqual(fx.ops.list({ goalId }), ledger);
  assert.deepEqual(fx.events(goalId).slice(eventCount).map((e) => e.type), ['HEALTH_EVALUATED', 'HEALTH_EVALUATED', 'HEALTH_EVALUATED']);
  assert.deepEqual(fx.store.getRelease(attempt.id), attempt);
  assert.equal(attempt.healthResult, 'PASS');

  const byEnv = runRow(fx, goalId, { label: 'env', ops: { binding: { targetSelection: 'env' } } });
  assert.deepEqual([byEnv.health[0]!.args, byEnv.health[0]!.target], [[], 'production']);
  const two = runRow(fx, goalId, { label: 'two bindings', ops: { bindings: [{ ...HEALTH_BINDING, command: ['health-a'] }, { ...HEALTH_BINDING, command: ['health-b'] }] } });
  assert.deepEqual(two.health.map((c) => c.command), ['health-a']);
  const loads: [string, ops.OpsLoad][] = [
    ['an empty health list', healthOps({ health: [] })],
    ['not configured', opsNotConfigured],
    ['unreadable', { status: 'unreadable', file: 'memory', error: 'x' }],
  ];
  for (const [label, load] of loads) {
    const out = runRow(fx, goalId, { label, load });
    assert.equal(out.health.length, 0, label);
    assert.equal(out.r.attempt.healthResult, 'INSUFFICIENT_DATA', label);
  }
});

test('reconciliation comes before the health command', (t) => {
  const { fx, goalId } = setup(t);
  const intent = (attempt: ReleaseAttempt) => fx.ops.recordIntent({ kind: 'deploy', goalId, releaseAttempt: attempt.id, target: 'production', candidateDigest: 'c1', idempotencyKey: `${attempt.id}:apply-deploy:c1`, ownerGeneration: 0, timeoutMs: 60000 }, fx.now());
  const attempt = observing(fx, goalId);
  const op = intent(attempt);
  const rec = recording(fx, () => passing(fx));
  const runner = releaseRunner(fx, healthOps(), rec.runner);
  const waiting = runner.next(fx.goal(goalId), attempt);
  assert.equal(waiting.directive.kind, 'wait');
  if (waiting.directive.kind === 'wait') assert.equal(waiting.directive.on, `unknown:${op.id}`);
  assert.equal(rec.health().length, 0);
  assert.deepEqual(evaluations(fx, goalId, attempt.id), []);
  fx.ops.markResult(op.id, 'succeeded', {}, fx.now());
  runner.next(fx.goal(goalId), waiting.attempt);
  assert.equal(rec.health().length, 1);
  assert.equal(evaluations(fx, goalId, attempt.id).length, 1);

  const issued = observing(fx, goalId);
  fx.ops.markIssued(intent(issued).id, 'dep1', fx.now());
  const asyncRec = recording(fx, () => passing(fx));
  const r = releaseRunner(fx, healthOps({ asyncDeploy: true }), asyncRec.runner).next(fx.goal(goalId), issued);
  assert.deepEqual(asyncRec.calls.map((c) => [c.command, ...c.args]), [['status-cmd', 'dep1'], ['health-cmd', '--env', 'production']]);
  assert.equal(r.attempt.healthResult, 'PASS');
  assert.deepEqual(evaluations(fx, goalId, issued.id).map((e) => e.result), ['PASS']);
});

test('a runner, journal or save failure leaves the evaluation incomplete and the next call runs the command again', (t) => {
  const { fx, goalId } = setup(t);
  const stored = (id: string) => JSON.stringify(fx.store.getRelease(id));
  // (a) A runner exception propagates; the APPLY row keeps its OBSERVE save.
  const boom = new Error('runner failed');
  for (const overrides of [{}, { state: 'APPLY' as const, healthWindow: undefined, steps: [{ name: 'apply-deploy', status: 'succeeded' as const }] }]) {
    const attempt = observing(fx, goalId, overrides);
    const before = stored(attempt.id);
    const rec = recording(fx, () => boom);
    assert.throws(() => releaseRunner(fx, healthOps(), rec.runner).next(fx.goal(goalId), attempt), (e) => e === boom);
    assert.equal(rec.health().length, 1);
    assert.deepEqual(evaluations(fx, goalId, attempt.id), []);
    if (attempt.state === 'OBSERVE') assert.equal(stored(attempt.id), before);
    else assert.deepEqual([fx.store.getRelease(attempt.id)!.state, fx.store.getRelease(attempt.id)!.healthWindow], ['OBSERVE', { from: T0, to: addMs(T0, 10 * MINUTE_MS) }]);
  }
  // (b) The HEALTH_EVALUATED append fails once.
  {
    const attempt = observing(fx, goalId);
    const before = stored(attempt.id);
    const rec = recording(fx, () => passing(fx));
    const runner = releaseRunner(fx, healthOps(), rec.runner);
    const realAppend = Journal.prototype.append;
    let refused = false;
    Journal.prototype.append = function (this: Journal, input: Parameters<Journal['append']>[0]) {
      if (!refused && input.type === 'HEALTH_EVALUATED') {
        refused = true;
        throw new Error('append refused');
      }
      return realAppend.call(this, input);
    };
    try {
      assert.throws(() => runner.next(fx.goal(goalId), attempt), /append refused/);
    } finally {
      Journal.prototype.append = realAppend;
    }
    assert.equal(rec.health().length, 1);
    assert.equal(stored(attempt.id), before);
    assert.deepEqual(fx.ops.list({ goalId }), []);
    runner.next(fx.goal(goalId), attempt);
    assert.equal(rec.health().length, 2);
    assert.equal(evaluations(fx, goalId, attempt.id).length, 1);
  }
  // (c) The save after the evaluation fails once.
  const attempt = observing(fx, goalId);
  const before = stored(attempt.id);
  const losing = new GoalStore(fx.paths);
  const save = losing.saveRelease.bind(losing);
  let lost = false;
  losing.saveRelease = (a) => {
    if (!lost) {
      lost = true;
      throw new Error('save lost');
    }
    return save(a);
  };
  const rec = recording(fx, () => passing(fx));
  const runner = releaseRunner(fx, healthOps(), rec.runner, { store: losing });
  assert.throws(() => runner.next(fx.goal(goalId), attempt), /save lost/);
  assert.equal(rec.health().length, 1);
  assert.equal(evaluations(fx, goalId, attempt.id).length, 1);
  assert.equal(stored(attempt.id), before);
  runner.next(fx.goal(goalId), attempt);
  assert.equal(rec.health().length, 2);
});

test('an injected signals source runs no health command', (t) => {
  const { fx, goalId } = setup(t);
  const signal: HealthSignal = { name: 'http_5xx_rate', source: 'prometheus', threshold: { op: '<', value: 1 }, observed: 0.1, samples: 20, minSamples: 5, lastSampleAt: fx.now(), maxStalenessMs: 5 * MINUTE_MS, synthetic: false, probeAvailable: true };
  for (const [signals, result] of [[() => [signal], 'PASS'], [() => [], 'INSUFFICIENT_DATA']] as const) {
    const rec = recording(fx, () => passing(fx));
    const r = releaseRunner(fx, healthOps(), rec.runner, { signals: signals as () => HealthSignal[] }).next(fx.goal(goalId), observing(fx, goalId));
    assert.equal(r.attempt.healthResult, result);
    assert.equal(rec.health().length, 0);
  }
});

test('aidlc release next closes an observed attempt from the bound health command', (t) => {
  const { fx, goalId } = setup(t);
  const attempt = observing(fx, goalId);
  const script = "console.log('probe start'); console.log(JSON.stringify({ environment: process.env.AIDLC_TARGET_ENV, candidate: 'c1', signals: [{ name: 'http_5xx_rate', observed: 0.1, samples: 20, lastSampleAt: new Date().toISOString() }] }));";
  const config = { schemaVersion: 1, environments: { production: { production: true } }, operations: [{ role: 'health', command: [process.execPath, '-e', script], targetSelection: 'env', timeoutMs: 60000 }], health: [{ name: 'http_5xx_rate', source: 'prometheus', threshold: { op: '<', value: 1 }, minSamples: 1 }] };
  writeFileSync(path.join(fx.tmp, 'aidlc.ops.json'), JSON.stringify(config, null, 2));
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_') && name.toUpperCase() !== 'NODE_OPTIONS'));
  const ceiling = [path.dirname(fx.tmp), path.dirname(realpathSync.native(fx.tmp))].join(path.delimiter);
  const env = { ...inherited, GIT_CEILING_DIRECTORIES: ceiling, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'health-op-cli' };
  const res = spawnSync(process.execPath, [MAIN, 'release', 'next', attempt.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  assert.equal(res.status, 0, res.stderr);
  const saved = fx.store.getRelease(attempt.id)!;
  assert.deepEqual([saved.state, saved.healthResult], ['CLOSE', 'PASS'], JSON.stringify(saved.stop));
  assert.equal((JSON.parse(res.stdout) as { attempt: { state: string } }).attempt.state, 'CLOSE');
});

test('the staleness of a sample is judged when the health command has returned', (t) => {
  const { fx, goalId } = setup(t);
  const declared = [{ ...DECLARED[0]!, maxStalenessMs: 300000 }];
  // The command takes `ms` of fixture time; its sample was taken 200 000 ms before it started.
  const slow = (ms: number) => (): Receipt => {
    const sampled = addMs(fx.now(), -200000);
    fx.advance(ms);
    return { exitCode: 0, stdout: printed(body(fx, {}, [entry(fx, 'http_5xx_rate', 0.1, { lastSampleAt: sampled })])) };
  };
  const run = (ms: number, overrides: Partial<ReleaseAttempt> = {}) => {
    const started = fx.now();
    const attempt = observing(fx, goalId, overrides);
    const r = releaseRunner(fx, healthOps({ health: declared }), recording(fx, slow(ms)).runner).next(fx.goal(goalId), attempt);
    return { started, attempt, r, evaluated: evaluations(fx, goalId, attempt.id) };
  };
  // (a) 350 000 ms old when the command returns: past the 300 000 ms bound.
  const late = run(150000, { healthWindow: undefined });
  assert.deepEqual(late.evaluated, [{ result: 'INSUFFICIENT_DATA', signals: ['http_5xx_rate=INSUFFICIENT_DATA'] }]);
  const returned = ops.healthSignals(ops.DeliveryOpsConfig.parse({ schemaVersion: 1, health: declared }).health, ops.healthReportOf(printed(body(fx, {}, [entry(fx, 'http_5xx_rate', 0.1, { lastSampleAt: addMs(late.started, -200000) })]))));
  assert.equal(evaluateSignal(returned[0]!, fx.now()).detail, 'last sample 350s old exceeds 300s');
  // The fallback window and the `at` of the insufficient-data STOP keep the step's time.
  assert.deepEqual(late.r.attempt.healthWindow, { from: late.started, to: addMs(late.started, 10 * MINUTE_MS) });
  assert.deepEqual(late.r.directive.kind === 'observe' ? late.r.directive.window : undefined, late.r.attempt.healthWindow);
  const stopped = run(150000, { healthWindow: { from: addMs(fx.now(), -41 * MINUTE_MS), to: addMs(fx.now(), -31 * MINUTE_MS) } });
  assert.equal(stopped.r.attempt.stop?.reason, 'release-health');
  assert.equal(stopped.r.attempt.stop?.at, stopped.started);
  // (b) 250 000 ms old when it returns: inside the bound.
  assert.deepEqual(run(50000).evaluated, [{ result: 'PASS', signals: ['http_5xx_rate=PASS'] }]);
  // A PASS whose command starts 25 s before the end of the window and returns 50 s later: the window has not elapsed at the step's time.
  const open = run(50000, { healthWindow: { from: addMs(fx.now(), 25000 - 10 * MINUTE_MS), to: addMs(fx.now(), 25000) } });
  assert.deepEqual([open.evaluated.map((e) => e.result), open.r.directive.kind, open.r.attempt.state], [['PASS'], 'observe', 'OBSERVE']);
  // Insufficient data whose command starts 75 s before the end of the maximum wait and returns 150 s later: no STOP yet.
  const waitEnd = addMs(fx.now(), 75000);
  const waiting = run(150000, { healthWindow: { from: addMs(waitEnd, -40 * MINUTE_MS), to: addMs(waitEnd, -30 * MINUTE_MS) } });
  assert.deepEqual([waiting.evaluated.map((e) => e.result), waiting.r.directive.kind, waiting.r.attempt.state], [['INSUFFICIENT_DATA'], 'observe', 'OBSERVE']);
  // A breaching sample inside its bound when the evaluation began and past it when the command returned still routes to RECOVER.
  {
    const own = setup(t);
    own.fx.controller.report({
      goalId: own.goalId,
      generation: 0,
      result: 'approved',
      data: { kind: 'recovery', by: 'sre-lead', candidateDigest: 'c1', environment: 'production', operations: [], recovery: { eligibleBaseline: 'v1.4.2', healthTrigger: 'http_5xx_rate >= 1 over 5m', procedure: 'recover-cmd', migrationCompatibility: 'schema unchanged', windowMs: 30 * MINUTE_MS, owner: 'sre-oncall' } },
    });
    const attempt = observing(own.fx, own.goalId);
    const breach = (): Receipt => {
      const sampled = addMs(own.fx.now(), -200000);
      own.fx.advance(150000);
      return { exitCode: 0, stdout: printed(body(own.fx, {}, [entry(own.fx, 'http_5xx_rate', 7.5, { lastSampleAt: sampled })])) };
    };
    const r = releaseRunner(own.fx, healthOps({ health: declared }), recording(own.fx, breach).runner).next(own.fx.goal(own.goalId), attempt);
    assert.deepEqual(evaluations(own.fx, own.goalId, attempt.id), [{ result: 'BREACH', signals: ['http_5xx_rate=BREACH'] }]);
    assert.deepEqual([r.directive.kind, r.attempt.state], ['recover', 'RECOVER'], r.directive.narration);
  }

  // A report line padded with a byte order mark or no-break spaces is read.
  const padded = (before: string, after: string) => (fx: Fx): Receipt => ({ exitCode: 0, stdout: `probe start\n${before}${JSON.stringify(body(fx))}${after}\n` });
  assertPass(runRow(fx, goalId, { label: 'BOM', answer: padded('﻿', '') }), 'a line that begins with U+FEFF');
  assertPass(runRow(fx, goalId, { label: 'NBSP', answer: padded('  ', ' ') }), 'a line padded with U+00A0');
  // Many blank lines before the report.
  assertPass(runRow(fx, goalId, { label: 'blank lines', answer: (fx) => ({ exitCode: 0, stdout: `probe start\n${'\n'.repeat(200000)}${JSON.stringify(body(fx))}\n` }) }), '200 000 blank lines before the report');
  // A declared `A` reads no entry whose name differs in letter case or padding only.
  for (const name of ['a', ' A', ' A ']) {
    const out = runRow(fx, goalId, { label: name, ops: { health: [{ name: 'A', source: 's', threshold: { op: '<', value: 1 }, minSamples: 1 }] }, answer: (fx) => ({ exitCode: 0, stdout: printed(body(fx, {}, [entry(fx, name, 0.5)])) }) });
    assert.deepEqual(out.evaluated.map((e) => e.signals), [['A=INSUFFICIENT_DATA']], JSON.stringify(name));
  }
  // The exported schema refuses an empty environment and an empty candidate.
  const report = { environment: 'production', candidate: 'c1', signals: [] };
  assert.equal(ops.HealthReport.safeParse(report).success, true);
  assert.equal(ops.HealthReport.safeParse({ ...report, environment: '' }).success, false);
  assert.equal(ops.HealthReport.safeParse({ ...report, candidate: '' }).success, false);
});
