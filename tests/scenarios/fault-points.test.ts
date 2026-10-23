/**
 * Fault-point check (card T1-VERIFY-FAULT-POINTS, spec review-verification R1 to R3): each card-run record write and each
 * goal journal append of five card-run commands fails in turn, one write per run, by a throw from the `node:fs` call every
 * writer passes through; the card then takes its next step, and six invariants are checked over the persisted card run and
 * the goal journal after the fault-free run, after the faulted command and after the next step.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs, { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { goalForCards, makeFixture, writeCard, T0, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { Journal } from '../../src/state/journal.ts';
import type { StatePaths } from '../../src/state/paths.ts';
import { CardRun, type Card, type Goal, type JournalEvent, type ReviewInvocation } from '../../src/core/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CARD = 'T1-FP';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';

// ---------------------------------------------------------------------------------------------------------------------
// Fixture: one card driven PREPARE -> BUILD -> A -> B -> C, then D or E (the atReview setup of r3-fallback.test.ts).
// ---------------------------------------------------------------------------------------------------------------------

interface Ctx {
  fx: Fixture;
  runner: CardRunner;
  ship: DryRunShipPath;
  goalId: string;
  card: Card;
  g: () => Goal;
  /** The persisted card run; every command and recovery step starts from it. */
  run: () => CardRun;
  /** Reviewer runs so far, counted at the scripted runner. */
  spawned: { r2: number; r3: number };
}

type Stage = 'A' | 'B' | 'C' | 'D' | 'E';

function open(): Ctx {
  const fx = makeFixture({
    config: {
      gateRequired: true,
      preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 1, timeoutMs: 1000, onExhausted: 'stop', shell: false },
      formalReview: { command: ['fake-p', '--schema', '{schema}', '{instructions}'], reviewer: 'primary', timeoutMs: 1000, shell: false },
    },
  });
  const spawned = { r2: 0, r3: 0 };
  const runner = scriptedRunner({
    'git diff --numstat': { stdout: '0\t0\tsrc/t1-fp.ts\n' },
    'git diff --name-only': { stdout: 'src/t1-fp.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t1-fp.ts b/src/t1-fp.ts\n+export const fp = 1;\n' },
    'fake-r2': () => {
      spawned.r2 += 1;
      return { stdout: PASS };
    },
    'fake-p': () => {
      spawned.r3 += 1;
      return { stdout: PASS };
    },
  });
  const ship = new DryRunShipPath(['merged']);
  writeCard(fx, { id: CARD, title: 'fault points', allowPaths: ['src/t1-fp.ts'] });
  const goalId = goalForCards(fx, [CARD]).id;
  const card = fx.card(CARD);
  const cardRunner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner });
  const g = () => fx.goal(goalId);
  let r = cardRunner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  assert.equal(r.directive.kind, 'prepare', r.directive.narration);
  r = cardRunner.next(g(), card, r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  return { fx, runner: cardRunner, ship, goalId, card, g, run: () => fx.store.getCardRun(goalId, CARD)!, spawned };
}

const attempt = (c: Ctx): CardRun => c.runner.recordAttempt(c.g(), c.card, c.run(), { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: 'sha-fp' });
const next = (c: Ctx) => c.runner.next(c.g(), c.card, c.run());
const preReview = (c: Ctx) => c.runner.preReview(c.g(), c.card, c.run());
const formalReview = (c: Ctx) => c.runner.formalReview(c.g(), c.card, c.run());

/** A fresh fixture driven without faults to the start of `stage`. */
async function startAt(stage: Stage): Promise<Ctx> {
  const c = open();
  if (stage === 'A') return c;
  attempt(c);
  assert.equal(next(c).directive.kind, 'pre-review');
  if (stage === 'B') return c;
  await preReview(c);
  assert.equal(next(c).directive.kind, 'review');
  if (stage === 'C') return c;
  assert.equal((await formalReview(c)).classified.outcome, 'pass');
  if (stage === 'D') return c;
  // E: the fixture clock moves past the card run's deadline (and with it the lease).
  c.fx.advance(Date.parse(c.run().deadline) - Date.parse(c.fx.now()) + 60_000);
  return c;
}

interface Covered {
  stage: Stage;
  name: string;
  run: (c: Ctx) => unknown;
  /** The command is E: its fault-free run and every recovery must end in the deadline stop (I6). */
  deadline?: boolean;
  /** How the fault-free run's result and persisted run differ from the end the card names for the command (`field actual, expected value`). */
  ends: (value: unknown, run: CardRun | undefined, shipped: number) => string[];
}

/** Each `[field, actual, expected]` whose actual differs, as `field actual, expected value`. */
const differ = (...pairs: Array<[string, unknown, unknown]>): string[] => pairs.filter(([, a, e]) => a !== e).map(([f, a, e]) => `${f} ${String(a)}, expected ${String(e)}`);
const field = (value: unknown, ...keys: string[]): unknown => keys.reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], value);
const directiveOf = (value: unknown): string | undefined => (value as { directive?: { kind?: string } } | undefined)?.directive?.kind;

const COVERED: Covered[] = [
  {
    stage: 'A', name: 'A recordAttempt success (card attempt)', run: attempt,
    ends: (_v, run) => differ(['state', run?.state, 'BUILD'], ['last attempt', run?.effort?.attempts.at(-1)?.outcome, 'success'], ['dodReceipt', run?.dodReceipt, 'dod:1'], ['candidate', run?.candidate?.sha, 'sha-fp']),
  },
  {
    stage: 'B', name: 'B preReview R2 pass (review pre)', run: preReview,
    ends: (v, run) => differ(['result', field(v, 'result', 'outcome'), 'pass'], ['round', run?.preReview.rounds.at(-1)?.outcome, 'pass'], ['rounds', run?.preReview.rounds.length, 1]),
  },
  {
    stage: 'C', name: 'C formalReview R3 pass (review r3)', run: formalReview,
    ends: (v, run) => differ(['result', field(v, 'classified', 'outcome'), 'pass'], ['invocation', run?.review.invocations.at(-1)?.outcome, 'pass'], ['substantiveDecisions', run?.review.substantiveDecisions, 1]),
  },
  {
    stage: 'D', name: 'D next at SHIP after the pass (card next, ship to CLOSE)', run: next,
    ends: (v, run, shipped) => differ(['directive', directiveOf(v), 'close'], ['state', run?.state, 'CLOSE'], ['mergeVerified', run?.mergeVerified, true], ['ship requests', shipped, 1]),
  },
  {
    stage: 'E', name: 'E next at SHIP past the deadline (card next, STOP/time)', run: next, deadline: true,
    ends: (v, run) => differ(['directive', directiveOf(v), 'stop'], ['state', run?.state, 'STOP'], ['stop.reason', run?.stop?.reason, 'time']),
  },
];

// ---------------------------------------------------------------------------------------------------------------------
// Fault points: the k-th renameSync onto a card-run record or appendFileSync onto a goal journal throws EIO.
// ---------------------------------------------------------------------------------------------------------------------

interface FaultPoint {
  call: 'renameSync' | 'appendFileSync';
  /** The target, relative to the state directory. */
  file: string;
  /** The journal event type an append carries. */
  event?: string;
}

const describePoint = (p: FaultPoint): string => `${p.call} ${p.file}${p.event ? ` (${p.event})` : ''}`;

const within = (dir: string, file: string): boolean => {
  const rel = path.relative(dir, path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** The fault point a call is, or undefined when the call is not one. */
function faultPoint(paths: StatePaths, call: FaultPoint['call'], args: unknown[]): FaultPoint | undefined {
  if (call === 'renameSync') {
    const dest = String(args[1]);
    return within(paths.cards, dest) && dest.endsWith('.json') ? { call, file: path.relative(paths.root, dest) } : undefined;
  }
  const file = String(args[0]);
  if (!(within(paths.journal, file) && file.endsWith('.jsonl') && path.basename(file) !== '_host.jsonl')) return undefined;
  let event: string | undefined;
  try {
    event = (JSON.parse(String(args[1])) as { type?: string }).type;
  } catch {
    /* not a journal line */
  }
  return { call, file: path.relative(paths.root, file), event };
}

/**
 * Run `body` with `fs.renameSync` and `fs.appendFileSync` patched on the `node:fs` export: every fault point is recorded,
 * and the `failAt`-th (1-based; 0 fails none) throws EIO before the real call runs. Restored in a finally.
 */
async function underFaults(paths: StatePaths, failAt: number, body: () => unknown): Promise<{ points: FaultPoint[]; value?: unknown; error?: Error }> {
  const target = fs as unknown as Record<string, (...args: unknown[]) => unknown>;
  const real = { renameSync: target['renameSync']!, appendFileSync: target['appendFileSync']! };
  const points: FaultPoint[] = [];
  for (const call of ['renameSync', 'appendFileSync'] as const) {
    target[call] = (...args: unknown[]) => {
      const point = faultPoint(paths, call, args);
      if (point) {
        points.push(point);
        if (points.length === failAt) throw Object.assign(new Error(`EIO: injected fault ${failAt}, ${describePoint(point)}`), { code: 'EIO' });
      }
      return real[call](...args);
    };
  }
  syncBuiltinESMExports();
  try {
    return { points, value: await body() };
  } catch (error) {
    return { points, error: error as Error };
  } finally {
    target['renameSync'] = real.renameSync;
    target['appendFileSync'] = real.appendFileSync;
    syncBuiltinESMExports();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Observation and the six invariants.
// ---------------------------------------------------------------------------------------------------------------------

interface Step {
  call: 'next' | 'preReview' | 'formalReview';
  /** The directive a `next` returned. */
  directive?: string;
  /** The message of a throw (a refusal). */
  threw?: string;
}

interface Observation {
  run?: CardRun;
  runError?: string;
  /** `*.tmp-*` and `*.lock` files under the state directory, relative to it. */
  stray: string[];
  journal: { ok: boolean; problems: string[] };
  events: JournalEvent[];
  /** The recovery steps taken so far. */
  steps: Step[];
  /** Runs of the R2 reviewer, the R3 reviewer and the ship path since the covered command started. */
  spawned: { r2: number; r3: number; ship: number };
  /** The observation ends a fault-free run or a recovery of E: the deadline stop must hold (I6). */
  deadline: boolean;
  /** The directive of the last `next` (the command's own for a fault-free `next`). */
  lastDirective?: string;
}

function observe(c: Ctx, base: { r2: number; r3: number; ship: number }, extra: Pick<Observation, 'steps' | 'deadline' | 'lastDirective'>): Observation {
  let run: CardRun | undefined;
  let runError: string | undefined;
  try {
    run = c.fx.store.getCardRun(c.goalId, CARD);
    if (!run) runError = 'no card run';
  } catch (err) {
    runError = (err as Error).message;
  }
  // The card's `*.tmp-*` and `*.lock`, matched on the file name: a temporary file of any suffix is a leftover.
  const stray = (readdirSync(c.fx.paths.root, { recursive: true }) as string[]).filter((f) => path.basename(f).includes('.tmp-') || path.basename(f).endsWith('.lock')).sort();
  const journal = Journal.forGoal(c.fx.paths.journal, c.goalId);
  const verified = journal.verify();
  let events: JournalEvent[] = [];
  try {
    events = journal.readAll();
  } catch {
    /* reported by verify */
  }
  return {
    run,
    runError,
    stray,
    journal: { ok: verified.ok, problems: verified.problems.map((p) => `line ${p.line}: ${p.problem}`) },
    events,
    spawned: { r2: c.spawned.r2 - base.r2, r3: c.spawned.r3 - base.r3, ship: c.ship.requests.length - base.ship },
    ...extra,
  };
}

const DISCARD = /^(discarded|superseded|released|abandoned)/;

/** The invariants I1 to I6 over one observation; each violation names its invariant and the persisted field. */
function check(o: Observation): string[] {
  const v: string[] = [];
  // I1: the record and the journal chain are intact, and no writer left a temp file or a lock.
  if (o.runError) v.push(`I1: the card run is unreadable: ${o.runError} (cards/<goal>/${CARD}.json)`);
  for (const f of o.stray) v.push(`I1: ${f} left under the state directory`);
  if (!o.journal.ok) v.push(`I1: the goal journal does not verify: ${o.journal.problems.join('; ')} (journal/<goal>.jsonl)`);
  // I2: every recovery next returns a directive.
  for (const s of o.steps) if (s.call === 'next' && s.threw !== undefined) v.push(`I2: a recovery next threw: ${s.threw}`);
  const invocations = o.run?.review.invocations ?? [];
  const rounds = o.run?.preReview.rounds ?? [];
  // I3: every decision event names a decision the card run holds; the covered path decides only passes.
  for (const e of o.events) {
    const d = e.data as Record<string, unknown>;
    if (e.type === 'REVIEW_DECIDED') {
      const held = invocations.some((i) => i.invocationId === d['invocationId'] && i.outcome === 'pass');
      if (d['outcome'] !== 'pass' || DISCARD.test(String(d['decision'] ?? '')) || !held) v.push(`I3: REVIEW_DECIDED seq ${e.seq} (invocation ${String(d['invocationId'])}, outcome ${String(d['outcome'])}, decision ${String(d['decision'])}) names no pass the card run holds (review.invocations)`);
    }
    if (e.type === 'PRE_REVIEW_DECIDED') {
      const held = rounds.some((r) => r.cycle === d['cycle'] && r.round === d['round'] && r.candidateDigest === d['candidateDigest'] && r.outcome === 'pass');
      if (d['exhausted'] || d['outcome'] !== 'pass' || d['decision'] !== undefined || !held) v.push(`I3: PRE_REVIEW_DECIDED seq ${e.seq} (cycle ${String(d['cycle'])}, round ${String(d['round'])}, outcome ${String(d['outcome'])}, decision ${String(d['decision'] ?? d['action'])}) names no pass round the card run holds (preReview.rounds)`);
    }
  }
  // I4: no decision recorded twice.
  const twice = (ids: string[]) => ids.filter((id, n) => ids.indexOf(id) !== n);
  for (const id of twice(invocations.map((i) => i.invocationId))) v.push(`I4: invocation ${id} held twice (review.invocations)`);
  for (const id of twice(rounds.flatMap((r) => (r.reservationId ? [r.reservationId] : [])))) v.push(`I4: reservation ${id} held twice (preReview.rounds)`);
  for (const id of twice(o.events.filter((e) => e.type === 'REVIEW_DECIDED').map((e) => String((e.data as Record<string, unknown>)['invocationId'])))) v.push(`I4: two REVIEW_DECIDED events name invocation ${id}`);
  if ((o.run?.review.substantiveDecisions ?? 0) > 1) v.push(`I4: ${o.run!.review.substantiveDecisions} substantive R3 decisions (review.substantiveDecisions)`);
  const passes = rounds.filter((r) => r.outcome === 'pass').length;
  if (passes > 1) v.push(`I4: ${passes} R2 passes (preReview.rounds)`);
  // I5: no reviewer and no ship runs twice over one command and its recovery.
  for (const [who, n] of Object.entries(o.spawned)) if (n > 1) v.push(`I5: the ${who === 'ship' ? 'ship path' : `${who.toUpperCase()} reviewer`} ran ${n} times`);
  // I6: a deadline stop is kept.
  if (o.deadline && (o.run?.stop?.reason !== 'time' || o.lastDirective !== 'stop')) v.push(`I6: the deadline run ends at ${o.run?.state ?? 'no run'} with stop ${o.run?.stop?.reason ?? 'none'} and directive ${o.lastDirective ?? 'none'} (stop.reason)`);
  return v;
}

// ---------------------------------------------------------------------------------------------------------------------
// The enumerator.
// ---------------------------------------------------------------------------------------------------------------------

interface Enumerated {
  points: FaultPoint[];
  /** The fault points (k) at which any violation was reported. */
  reported: number[];
  violations: string[];
}

/** The recovery: next, the review command it directs, next again; a refusal of the review command is printed, not failed. */
async function recover(c: Ctx, log: (msg: string) => void, label: string): Promise<Step[]> {
  const steps: Step[] = [];
  const step = async (call: Step['call'], body: () => unknown): Promise<string | undefined> => {
    try {
      const directive = directiveOf(await body());
      steps.push({ call, directive });
      return directive;
    } catch (err) {
      steps.push({ call, threw: (err as Error).message });
      if (call !== 'next') log(`${label}: recovery ${call} refused: ${(err as Error).message}`);
      return undefined;
    }
  };
  const first = await step('next', () => next(c));
  if (first === 'pre-review') await step('preReview', () => preReview(c));
  if (first === 'review') await step('formalReview', () => formalReview(c));
  await step('next', () => next(c));
  return steps;
}

const stepText = (s: Step): string => `${s.call} -> ${s.threw !== undefined ? `refused: ${s.threw}` : (s.directive ?? 'returned')}`;

/**
 * Count the fault points of `cmd` on a fault-free run, then fail each one on a fresh fixture, recover (unless `recovery`
 * is false) and check the invariants after the faulted command and after the recovery.
 */
async function enumerate(cmd: Covered, start: () => Promise<Ctx>, log: (msg: string) => void, recovery = true): Promise<Enumerated> {
  const counted = await start();
  let points: FaultPoint[];
  const violations: string[] = [];
  try {
    const base = { ...counted.spawned, ship: counted.ship.requests.length };
    const res = await underFaults(counted.fx.paths, 0, () => cmd.run(counted));
    points = res.points;
    const label = `${cmd.name} k=0 of ${points.length}, no fault`;
    // The fault-free run must reach the end the card names before its count of fault points is accepted.
    const obs = observe(counted, base, { steps: [], deadline: Boolean(cmd.deadline), lastDirective: directiveOf(res.value) });
    if (res.error) violations.push(`${label}; the command threw: ${res.error.message}`);
    for (const e of cmd.ends(res.value, obs.run, obs.spawned.ship)) violations.push(`${label}; end state: ${e}`);
    for (const x of check(obs)) violations.push(`${label}; recovery: none; after the command: ${x}`);
  } finally {
    counted.fx.cleanup();
  }
  const reported: number[] = [];
  for (let k = 1; k <= points.length; k++) {
    const c = await start();
    try {
      const base = { ...c.spawned, ship: c.ship.requests.length };
      const res = await underFaults(c.fx.paths, k, () => cmd.run(c));
      const label = `${cmd.name} k=${k} of ${points.length}, failed ${describePoint(res.points[k - 1] ?? points[k - 1]!)}`;
      const outcome = res.error ? `the command threw: ${res.error.message}` : `the command returned ${directiveOf(res.value) ?? 'a value'}`;
      // The observation after the command is kept and reported with the completed recovery trail, so a violation the
      // recovery repairs still names every step taken after it.
      const afterCommand = check(observe(c, base, { steps: [], deadline: false }));
      let afterRecovery: string[] = [];
      let trail = 'none';
      if (recovery) {
        const steps = await recover(c, log, label);
        const last = [...steps].reverse().find((s) => s.call === 'next')?.directive;
        trail = steps.map(stepText).join(', ');
        afterRecovery = check(observe(c, base, { steps, deadline: Boolean(cmd.deadline), lastDirective: last }));
      }
      const found = [...afterCommand.map((x) => `${label}; ${outcome}; recovery: ${trail}; after the command: ${x}`), ...afterRecovery.map((x) => `${label}; ${outcome}; recovery: ${trail}; after the recovery: ${x}`)];
      if (found.length) reported.push(k);
      violations.push(...found);
    } finally {
      c.fx.cleanup();
    }
  }
  return { points, reported, violations };
}

// ---------------------------------------------------------------------------------------------------------------------
// Self-test components (R4): a decision journaled before or after the record that holds it.
// ---------------------------------------------------------------------------------------------------------------------

function selftestInvocation(): ReviewInvocation {
  return { invocationId: 'r3:selftest', candidateDigest: 'digest-selftest', base: 'main', policyVersion: 'v1', reviewer: 'primary', requestedAt: T0, outcome: 'pass' };
}

function appendDecided(c: Ctx): void {
  const g = c.g();
  c.fx.journal(c.goalId).append({ type: 'REVIEW_DECIDED', goalId: c.goalId, cardId: CARD, generation: g.generation, data: { invocationId: 'r3:selftest', outcome: 'pass', decision: 'proceed-merge' } });
}

function holdInvocation(c: Ctx): void {
  c.fx.store.updateCardRun(c.goalId, CARD, (current) => ({ ...current!, review: { ...current!.review, invocations: [...current!.review.invocations, selftestInvocation()] } }));
}

const decideOutOfOrder: Covered = { stage: 'A', name: 'decideOutOfOrder', run: (c) => (appendDecided(c), holdInvocation(c)), ends: () => [] };
const decideInOrder: Covered = { stage: 'A', name: 'decideInOrder', run: (c) => (holdInvocation(c), appendDecided(c)), ends: () => [] };

// ---------------------------------------------------------------------------------------------------------------------
// Doc text (acceptance 8).
// ---------------------------------------------------------------------------------------------------------------------

const DOC_SENTENCES = [
  '`tests/scenarios/fault-points.test.ts` (card T1-VERIFY-FAULT-POINTS) fails each card-run record write and each goal journal append of five card-run commands, one write per run, then takes the card\'s next step and checks the persisted card run and the goal journal.',
  'The covered commands are `card attempt` (a success at BUILD), `review pre` (an R2 pass), `review r3` (an R3 pass), `card next` at SHIP after the R3 pass (the dry-run ship merges and the card reaches CLOSE) and `card next` at SHIP once the card deadline has passed (STOP/time).',
  'A write fails by a throw from `fs.renameSync` onto the card-run record or from `fs.appendFileSync` onto the goal journal; the next step is `card next`, the `review pre` or `review r3` it directs, and `card next` again, and a refusal of that review command is printed, not failed.',
  'After the faulted command and after the next step the test checks six invariants: the records and the journal chain are intact (I1), every `card next` returns a directive (I2), every `REVIEW_DECIDED` and `PRE_REVIEW_DECIDED` event names a decision the card run holds (I3), no decision is recorded twice (I4), no reviewer or ship runs twice (I5), and a deadline stop is kept (I6).',
  'It does not fail lease, review-queue, operation-ledger or `.review/` writes, does not model a process that dies mid-command or a torn journal line, and does not require every card-run change to reach the journal.',
  'Run it with `node --test tests/scenarios/fault-points.test.ts`; `npm test` runs it, so CI runs it on every push.',
];

const CHANGELOG_ENTRY = '- T1-VERIFY-FAULT-POINTS: `tests/scenarios/fault-points.test.ts` fails each card-run record write and goal journal append of `card attempt`, `review pre`, `review r3` and two `card next` steps (the ship to CLOSE and the deadline stop) one at a time, takes the card\'s next step, and checks six invariants over the card run and the goal journal; a self-test shows that it reports a component that journals a decision before it writes the record.';

const lf = (file: string): string => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------------------------------------------------

describe('fault-point check: each card-run write and journal append of five commands fails in turn (T1-VERIFY-FAULT-POINTS)', { timeout: 30_000 }, () => {
  for (const cmd of COVERED) {
    it(`${cmd.name}: the fault-free run has fault points and no violation, and every fault point and its recovery keep I1 to I6 [R1] [R2] [R3]`, async (t) => {
      const out = await enumerate(cmd, () => startAt(cmd.stage), (msg) => t.diagnostic(msg));
      t.diagnostic(`${cmd.name}: ${out.points.length} fault points: ${out.points.map((p, n) => `${n + 1} ${describePoint(p)}`).join('; ')}`);
      assert.ok(out.points.some((p) => p.call === 'renameSync'), 'at least one card-run record write');
      assert.ok(out.points.some((p) => p.call === 'appendFileSync'), 'at least one goal journal append');
      assert.deepEqual(out.violations, []);
    });
  }

  it('the enumerator and I3 report a component that journals a decision before its record at exactly k = 2, and its in-order twin at none [R4]', async (t) => {
    const log = (msg: string) => t.diagnostic(msg);
    const broken = await enumerate(decideOutOfOrder, () => startAt('A'), log, false);
    assert.deepEqual(broken.points.map((p) => p.call), ['appendFileSync', 'renameSync']);
    assert.deepEqual(broken.reported, [2]);
    assert.match(broken.violations.join('\n'), /^decideOutOfOrder k=2 of 2, failed renameSync .*; recovery: none; after the command: I3: REVIEW_DECIDED seq \d+ \(invocation r3:selftest/m);
    // Every counterexample carries the recovery trail, the one found after the command as well as the one after the recovery.
    const traced = await enumerate(decideOutOfOrder, () => startAt('A'), log);
    assert.deepEqual(traced.reported, [2]);
    assert.ok(traced.violations.length >= 1);
    for (const v of traced.violations) assert.match(v, /^decideOutOfOrder k=2 of 2, failed renameSync .*; recovery: next -> \w+(, \w+ -> [^;]+)*; after the (command|recovery): I3: REVIEW_DECIDED .*\(review\.invocations\)$/);
    assert.ok(traced.violations.some((v) => v.includes('; after the command: I3:')), traced.violations.join('\n'));
    const twin = await enumerate(decideInOrder, () => startAt('A'), log, false);
    assert.deepEqual(twin.points.map((p) => p.call), ['renameSync', 'appendFileSync']);
    assert.deepEqual(twin.reported, []);
  });

  it('a fault-free run that does not reach the end state its command names is reported before its fault points are accepted [R1]', async (t) => {
    // D's command from the review directive: next returns review, nothing ships, and check() alone finds nothing wrong.
    const stalled = await enumerate({ ...COVERED[3]!, name: 'D from the review directive' }, () => startAt('C'), (msg) => t.diagnostic(msg), false);
    assert.match(stalled.violations[0] ?? '', /^D from the review directive k=0 of \d+, no fault; end state: directive review, expected close/);
  });

  it('I1, I2, I4, I5 and I6 each report one violation for an observation that breaks it alone, and none unbroken [R5]', async () => {
    const c = await startAt('A');
    try {
      const zero = { r2: 0, r3: 0, ship: 0 };
      const unbroken = observe(c, { ...c.spawned, ship: 0 }, { steps: [{ call: 'next', directive: 'build' }], deadline: false });
      assert.deepEqual(check(unbroken), []);
      const only = (o: Observation, invariant: string) => {
        const v = check(o);
        assert.equal(v.length, 1, v.join('\n'));
        assert.ok(v[0]!.startsWith(`${invariant}:`), v[0]);
      };
      // I1: a lock file beside the card run.
      const lock = `${c.fx.store.cardFile(c.goalId, CARD)}.lock`;
      writeFileSync(lock, 'pid=1', 'utf8');
      only(observe(c, { ...c.spawned, ship: 0 }, { steps: [], deadline: false }), 'I1');
      fs.unlinkSync(lock);
      assert.ok(!existsSync(lock));
      // I1: a temporary file of any suffix beside the card run (the card's `*.tmp-*`).
      const leftover = `${c.fx.store.cardFile(c.goalId, CARD)}.tmp-leftover`;
      writeFileSync(leftover, '{}', 'utf8');
      only(observe(c, { ...c.spawned, ship: 0 }, { steps: [], deadline: false }), 'I1');
      fs.unlinkSync(leftover);
      assert.deepEqual(check(observe(c, { ...c.spawned, ship: 0 }, { steps: [], deadline: false })), []);
      // I2: a recovery next that threw.
      only({ ...unbroken, steps: [{ call: 'next', threw: 'CARD_RUN_STALE' }] }, 'I2');
      // I4: one R3 invocation id held twice.
      const run = unbroken.run!;
      const inv = selftestInvocation();
      const holding = (invocations: ReviewInvocation[]) => ({ ...unbroken, run: { ...run, review: { ...run.review, invocations } } });
      assert.deepEqual(check(holding([inv])), []);
      only(holding([inv, inv]), 'I4');
      // I5: the ship path run twice.
      assert.deepEqual(check({ ...unbroken, spawned: { ...zero, ship: 1 } }), []);
      only({ ...unbroken, spawned: { ...zero, ship: 2 } }, 'I5');
      // I6: a recovery of E that ends at SHIP.
      const stopped = CardRun.parse({ ...run, state: 'STOP', stop: { reason: 'time', detail: 'admission deadline reached', nextAction: 'hand off', global: false, at: T0 } });
      assert.deepEqual(check({ ...unbroken, run: stopped, deadline: true, lastDirective: 'stop' }), []);
      only({ ...unbroken, run: { ...run, state: 'SHIP' }, deadline: true, lastDirective: 'wait' }, 'I6');
    } finally {
      c.fx.cleanup();
    }
  });

  const ops = lf('docs/OPERATIONS.md');
  const section = (): string => {
    const at = ops.indexOf('\n## Fault-point check\n');
    assert.ok(at > ops.indexOf('\n## Evals\n') && ops.indexOf('\n## Evals\n') >= 0, 'docs/OPERATIONS.md has a Fault-point check section after Evals');
    const end = ops.indexOf('\n## ', at + 1);
    return ops.slice(at, end < 0 ? undefined : end);
  };
  DOC_SENTENCES.forEach((sentence, n) => {
    it(`docs/OPERATIONS.md Fault-point check states sentence ${n + 1} of the card's doc text [R8]`, () => {
      assert.ok(section().includes(sentence), sentence);
    });
  });

  it('the CHANGELOG Unreleased section carries the T1-VERIFY-FAULT-POINTS entry [R9]', () => {
    const changelog = lf('CHANGELOG.md');
    const start = changelog.indexOf('## Unreleased');
    const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
    assert.ok(unreleased.split('\n').includes(CHANGELOG_ENTRY), CHANGELOG_ENTRY);
  });
});
