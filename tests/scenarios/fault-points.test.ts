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
import { isDeepStrictEqual } from 'node:util';
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
const pollOf = (value: unknown): { pollSeconds?: number } => {
  const poll = (value as { directive?: { pollSeconds?: number } } | undefined)?.directive?.pollSeconds;
  return poll === undefined ? {} : { pollSeconds: poll };
};

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
// Liveness (card T1-VERIFY-LIVENESS, spec review-verification R22, R23): the end state a run comes to rest in.
// ---------------------------------------------------------------------------------------------------------------------

/** R3: the end state of a run; no timestamp, id, hash, revision, evidence entry or lease field takes part. */
interface EndState {
  /** The kind of the drive's last directive. */
  directive: string | null;
  state: string | null;
  stop: string | null;
  mergeVerified: boolean | null;
  /** `[n, outcome]` per attempt, and the episode's terminal. */
  attempts: Array<[number, string]>;
  terminal: string | null;
  /** R2 rounds as `[cycle, round, outcome]`. */
  r2: Array<[number, number, string]>;
  r3: { invocations: Array<[string, string]>; substantiveDecisions: number; substantiveBlocks: number; noVerdictRetriesUsed: number };
  /** The goal's review-pool requests as sorted `[reviewer, state]`, and each of their pools' active slots as `[pool, count]`. */
  requests: Array<[string, string]>;
  activeSlots: Array<[string, number]>;
  /** The card's operations as sorted `[kind, status, an OPERATION_INTENT event names it]`. */
  operations: Array<[string, string, boolean]>;
  /** Counts per `TYPE outcome` (or `TYPE status`) of the counted journal events, decision events of a discard left out. */
  journal: Record<string, number>;
}

// R4: written from the fixture's design before any run. A to D: one success attempt (the episode `succeeded`), one R2 pass
// in cycle 0, one R3 pass by the formal reviewer `primary`, the formal request and the ship's request (`codex-review`, the
// config default) completed in pool `default`, one merge operation succeeded through the dry-run ship, and the card at CLOSE.
const FAULT_FREE_CLOSE: EndState = {
  directive: 'close',
  state: 'CLOSE',
  stop: null,
  mergeVerified: true,
  attempts: [[1, 'success']],
  terminal: 'succeeded',
  r2: [[0, 1, 'pass']],
  r3: { invocations: [['primary', 'pass']], substantiveDecisions: 1, substantiveBlocks: 0, noVerdictRetriesUsed: 0 },
  requests: [['codex-review', 'completed'], ['primary', 'completed']],
  activeSlots: [['default', 0]],
  operations: [['merge', 'succeeded', true]],
  journal: { ATTEMPT_STARTED: 1, 'ATTEMPT_FINISHED success': 1, 'PRE_REVIEW_DECIDED pass': 1, 'REVIEW_DECIDED pass': 1, 'OPERATION_RESULT succeeded': 1 },
};

// E: the same attempt, R2 and R3 entries, no ship: the formal request alone, no operation, and the deadline stop.
const FAULT_FREE_TIME: EndState = {
  directive: 'stop',
  state: 'STOP',
  stop: 'time',
  mergeVerified: false,
  attempts: [[1, 'success']],
  terminal: 'succeeded',
  r2: [[0, 1, 'pass']],
  r3: { invocations: [['primary', 'pass']], substantiveDecisions: 1, substantiveBlocks: 0, noVerdictRetriesUsed: 0 },
  requests: [['primary', 'completed']],
  activeSlots: [['default', 0]],
  operations: [],
  journal: { ATTEMPT_STARTED: 1, 'ATTEMPT_FINISHED success': 1, 'PRE_REVIEW_DECIDED pass': 1, 'REVIEW_DECIDED pass': 1 },
};

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
  /** The `pollSeconds` of a `wait` directive, for the liveness drive. */
  pollSeconds?: number;
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
      const value = await body();
      const directive = directiveOf(value);
      steps.push({ call, directive, ...pollOf(value) });
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

// ---------------------------------------------------------------------------------------------------------------------
// Liveness: the drive to rest, the end state and the judge (T1-VERIFY-LIVENESS R1 to R8).
// ---------------------------------------------------------------------------------------------------------------------

/** R1: the drive ends at one of these kinds, at a kind it has no move for, or after this many `next` calls in all. */
const AT_REST = new Set(['close', 'done', 'stop']);
const NEXT_BOUND = 12;

interface DriveStep {
  call: Step['call'] | 'recordAttempt' | 'wait';
  directive?: string;
  threw?: string;
  pollSeconds?: number;
  /** The fixture clock before and after a wait. */
  clock?: [string, string];
}

/** R2: the one move each directive kind names; every other kind ends the drive. */
const MOVES: Record<string, { call: DriveStep['call']; move: (c: Ctx, pollSeconds: number | undefined) => unknown }> = {
  build: { call: 'recordAttempt', move: attempt },
  'pre-review': { call: 'preReview', move: preReview },
  review: { call: 'formalReview', move: formalReview },
  wait: { call: 'wait', move: (c, poll) => c.fx.advance((poll ?? 0) * 1000) },
};

/**
 * Continue a run from the recovery's steps (or, for a fault-free `next` command, from its own directive) to rest: after each
 * `next` the move its directive names; a move that throws is logged and the next `next` follows.
 */
async function drive(c: Ctx, prior: Step[], seed?: Step): Promise<{ steps: DriveStep[]; last?: string; nexts: number }> {
  const steps: DriveStep[] = [...prior];
  let nexts = prior.filter((s) => s.call === 'next').length;
  let pending: Step | undefined = prior.length ? (prior.at(-1)!.call === 'next' ? prior.at(-1) : undefined) : seed;
  let last = [...prior].reverse().find((s) => s.call === 'next' && s.directive !== undefined)?.directive ?? seed?.directive;
  for (;;) {
    if (pending?.directive !== undefined) {
      const named = MOVES[pending.directive];
      if (AT_REST.has(pending.directive) || !named) break;
      const before = c.fx.now();
      try {
        await named.move(c, pending.pollSeconds);
        steps.push(named.call === 'wait' ? { call: 'wait', pollSeconds: pending.pollSeconds ?? 0, clock: [before, c.fx.now()] } : { call: named.call });
      } catch (err) {
        steps.push({ call: named.call, threw: (err as Error).message });
      }
    }
    if (nexts >= NEXT_BOUND) break;
    nexts += 1;
    try {
      const value = next(c);
      pending = { call: 'next', directive: directiveOf(value), ...pollOf(value) };
      last = pending.directive;
    } catch (err) {
      pending = { call: 'next', threw: (err as Error).message };
    }
    steps.push(pending);
  }
  return { steps, last, nexts };
}

const driveText = (s: DriveStep): string => (s.call === 'wait' ? `wait ${s.pollSeconds ?? 0}s, clock ${s.clock?.[0]} -> ${s.clock?.[1]}` : s.call === 'next' || s.threw !== undefined ? stepText(s as Step) : `${s.call} -> done`);

/** R3: the journal events counted, each by the field that names its outcome or status. */
const COUNTED_EVENTS: Record<string, string | undefined> = { ATTEMPT_STARTED: undefined, ATTEMPT_FINISHED: 'outcome', PRE_REVIEW_DECIDED: 'outcome', REVIEW_DECIDED: 'outcome', OPERATION_RESULT: 'status', OPERATION_RECONCILED: 'outcome' };
const byText = (a: unknown, b: unknown): number => JSON.stringify(a).localeCompare(JSON.stringify(b));

function endState(c: Ctx, directive: string | undefined): EndState {
  const run = c.fx.store.getCardRun(c.goalId, CARD);
  const events = Journal.forGoal(c.fx.paths.journal, c.goalId).readAll();
  const requests = c.fx.queue.list().filter((r) => r.requesters.includes(`${c.goalId}:${CARD}`));
  const intents = new Set(events.filter((e) => e.type === 'OPERATION_INTENT').map((e) => String((e.data as Record<string, unknown>)['operationId'])));
  const journal: Record<string, number> = {};
  for (const e of events) {
    const d = e.data as Record<string, unknown>;
    if (!(e.type in COUNTED_EVENTS) || DISCARD.test(String(d['decision'] ?? ''))) continue;
    const by = COUNTED_EVENTS[e.type];
    const key = by ? `${e.type} ${String(d[by])}` : e.type;
    journal[key] = (journal[key] ?? 0) + 1;
  }
  return {
    directive: directive ?? null,
    state: run?.state ?? null,
    stop: run?.stop?.reason ?? null,
    mergeVerified: run?.mergeVerified ?? null,
    attempts: (run?.effort?.attempts ?? []).map((a): [number, string] => [a.n, a.outcome]),
    terminal: run?.effort?.terminal ?? null,
    r2: (run?.preReview.rounds ?? []).map((r): [number, number, string] => [r.cycle, r.round, r.outcome]),
    r3: { invocations: (run?.review.invocations ?? []).map((i): [string, string] => [i.reviewer, i.outcome]), substantiveDecisions: run?.review.substantiveDecisions ?? 0, substantiveBlocks: run?.review.substantiveBlocks ?? 0, noVerdictRetriesUsed: run?.review.noVerdictRetriesUsed ?? 0 },
    requests: requests.map((r): [string, string] => [r.reviewer, r.state]).sort(byText),
    activeSlots: [...new Set(requests.map((r) => r.pool))].sort().map((p): [string, number] => [p, c.fx.queue.pool(p, c.fx.now()).active.length]),
    operations: c.fx.ops.list({ goalId: c.goalId, cardId: CARD }).map((o): [string, string, boolean] => [o.kind, o.status, intents.has(o.id)]).sort(byText),
    journal,
  };
}

/** Each differing path with its fault-free and observed value; a journal count absent on one side is 0. */
type Difference = Record<string, [unknown, unknown]>;
function difference(faultFree: EndState, observed: EndState): Difference {
  const out: Difference = {};
  const put = (at: string, a: unknown, b: unknown) => {
    if (!isDeepStrictEqual(a, b)) out[at] = [a, b];
  };
  for (const key of Object.keys(faultFree) as Array<keyof EndState>) {
    if (key === 'r3') for (const k of Object.keys(faultFree.r3) as Array<keyof EndState['r3']>) put(`r3.${k}`, faultFree.r3[k], observed.r3[k]);
    else if (key === 'journal') for (const k of [...new Set([...Object.keys(faultFree.journal), ...Object.keys(observed.journal)])].sort()) put(`journal.${k}`, faultFree.journal[k] ?? 0, observed.journal[k] ?? 0);
    else put(key, faultFree[key], observed[key]);
  }
  return out;
}

/** One fault run at rest, with its command's fault-free end state and the drive's steps (the recovery's included). */
interface Rested {
  faultPoint: string;
  faultFree: EndState;
  end: EndState;
  steps: DriveStep[];
}

/** A known violation: the fault point, its exact difference, the hypothesis it confirms, and the counterexample. */
interface Pin {
  faultPoint: string;
  difference: Difference;
  hypothesis: string;
  counterexample: string;
  /** The step docs/OPERATIONS.md assigns to a person for this state. */
  docRecovery?: string;
}

const diffText = (d: Difference): string => Object.entries(d).map(([at, [a, b]]) => `${at} fault-free ${JSON.stringify(a)}, observed ${JSON.stringify(b)}`).join('; ');

/** R5, R6: unpinned differences, and pins that reach the fault-free end state, differ otherwise or name no counted fault point. */
function judge(observed: Rested[], pins: Pin[]): { unpinned: string[]; stale: string[] } {
  const unpinned: string[] = [];
  const stale: string[] = [];
  for (const o of observed) {
    const diff = difference(o.faultFree, o.end);
    const pin = pins.find((p) => p.faultPoint === o.faultPoint);
    const trail = `drive: ${o.steps.map(driveText).join(', ')}`;
    if (!pin) {
      if (Object.keys(diff).length) unpinned.push(`${o.faultPoint}: ${diffText(diff)}; ${trail}`);
    } else if (!Object.keys(diff).length) {
      stale.push(`pin ${pin.faultPoint} (${pin.hypothesis}): the fault point reaches the fault-free end state; remove the pin; ${trail}`);
    } else if (!isDeepStrictEqual(pin.difference, diff)) {
      stale.push(`pin ${pin.faultPoint} (${pin.hypothesis}): the difference changed: pinned ${diffText(pin.difference)}; observed ${diffText(diff)}; ${trail}`);
    }
  }
  for (const pin of pins) if (!observed.some((o) => o.faultPoint === pin.faultPoint)) stale.push(`pin ${pin.faultPoint} (${pin.hypothesis}): no counted fault point has this name`);
  return { unpinned, stale };
}

/** R7: `<stage>/record <n>` for the n-th card-run record write, `<stage>/append <EVENT>[ <n>]` for a journal append. */
function pointName(stage: Stage, points: FaultPoint[], k: number): string {
  const p = points[k - 1]!;
  const upTo = points.slice(0, k);
  if (p.call === 'renameSync') return `${stage}/record ${upTo.filter((q) => q.call === 'renameSync').length}`;
  const same = (q: FaultPoint) => q.call === 'appendFileSync' && q.event === p.event;
  return `${stage}/append ${p.event ?? 'unparsed'}${points.filter(same).length > 1 ? ` ${upTo.filter(same).length}` : ''}`;
}

/** Where a covered command's liveness runs land: its fault-free run at rest, the count of its fault points, each fault run at rest. */
interface Rest {
  faultFree?: { end: EndState; steps: DriveStep[]; nexts: number };
  counted: number;
  points: Rested[];
}

/** R5: the violations the base reproduces, each with its counterexample; a fix removes its pin. */
const SHIPPED: [string, string, boolean] = ['merge', 'succeeded', true];
const KNOWN_VIOLATIONS: Pin[] = [
  {
    faultPoint: 'A/record 1',
    difference: { 'journal.ATTEMPT_FINISHED success': [1, 2] },
    hypothesis: 'H5',
    counterexample: 'CardRunner.recordAttempt appends ATTEMPT_FINISHED before `this.save` writes the finished episode; the lost save leaves attempt 1 `running`, card next directs `build` for attempt 1 again and the second recordAttempt appends a second ATTEMPT_FINISHED success for the one attempt the record holds ([1, success]).',
  },
  {
    faultPoint: 'B/append PRE_REVIEW_DECIDED',
    difference: { 'journal.PRE_REVIEW_DECIDED pass': [1, 0] },
    hypothesis: 'H7',
    counterexample: 'CardRunner.preReview appends PRE_REVIEW_DECIDED after commitReviewed saved the pass round; the lost append is never written again: card next reads the pass in preReview.rounds and directs `review`, and the card closes with no PRE_REVIEW_DECIDED event for its R2 pass.',
  },
  {
    faultPoint: 'C/append REVIEW_DECIDED',
    difference: { 'journal.REVIEW_DECIDED pass': [1, 0] },
    hypothesis: 'H6',
    counterexample: 'CardRunner.commitFormalResult appends REVIEW_DECIDED after commitReviewed saved the pass invocation; the lost append is never written again: card next reads the pass in review.invocations and ships to `close`, and the card closes with no REVIEW_DECIDED event for its R3 pass.',
  },
  {
    faultPoint: 'D/append OPERATION_ISSUED',
    difference: {
      directive: ['close', 'wait'],
      state: ['CLOSE', 'WAIT'],
      mergeVerified: [true, false],
      requests: [[['codex-review', 'completed'], ['primary', 'completed']], [['codex-review', 'running'], ['primary', 'completed']]],
      activeSlots: [[['default', 0]], [['default', 1]]],
      operations: [[SHIPPED], [['merge', 'issued', true]]],
      'journal.OPERATION_RESULT succeeded': [1, 0],
    },
    hypothesis: 'H9',
    counterexample: 'CardRunner.ship calls ops.markIssued and then appends OPERATION_ISSUED; the lost append ends the ship before shipPath.ship runs, the operation stays `issued` and the ship\'s pool request `running`, and every card next selects WAIT "attached to running operation <id>" (selectCardState, runningOperation) until a person reconciles the operation.',
    docRecovery: 'aidlc ops reconcile',
  },
  {
    faultPoint: 'D/record 1',
    difference: {
      directive: ['close', 'wait'],
      state: ['CLOSE', 'WAIT'],
      mergeVerified: [true, false],
      operations: [[SHIPPED], [['merge', 'issued', true]]],
      'journal.OPERATION_RESULT succeeded': [1, 0],
    },
    hypothesis: 'H10',
    counterexample: 'CardRunner.applyShipResult completes the pool request and then writes CLOSE and mergeVerified in `finish`; the lost write after the dry-run merge leaves the operation `issued` (ops.markResult runs only after the write), and every card next selects WAIT "attached to running operation <id>" (selectCardState, runningOperation) until a person reconciles the operation.',
    docRecovery: 'aidlc ops reconcile',
  },
  {
    faultPoint: 'D/append OPERATION_RESULT',
    difference: { 'journal.OPERATION_RESULT succeeded': [1, 0] },
    hypothesis: 'H8',
    counterexample: 'CardRunner.applyShipResult marks the operation `succeeded` (ops.markResult) after `finish` saved CLOSE and then appends OPERATION_RESULT; the lost append is never written again: card next reads mergeVerified and returns `close`, and the journal holds no result for the merge the ledger records as succeeded.',
  },
];

/**
 * Count the fault points of `cmd` on a fault-free run, then fail each one on a fresh fixture, recover (unless `recovery`
 * is false) and check the invariants after the faulted command and after the recovery.
 */
async function enumerate(cmd: Covered, start: () => Promise<Ctx>, log: (msg: string) => void, recovery = true, rest?: Rest): Promise<Enumerated> {
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
    if (rest) {
      // Liveness (R1): the fault-free run continues to rest; a `next` command's own directive is the drive's first.
      const seed: Step | undefined = cmd.run === next ? { call: 'next', directive: directiveOf(res.value), ...pollOf(res.value) } : undefined;
      const d = await drive(counted, [], seed);
      rest.faultFree = { end: endState(counted, d.last), steps: d.steps, nexts: d.nexts };
      rest.counted = points.length;
    }
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
      let steps: Step[] = [];
      if (recovery) {
        steps = await recover(c, log, label);
        const last = [...steps].reverse().find((s) => s.call === 'next')?.directive;
        trail = steps.map(stepText).join(', ');
        afterRecovery = check(observe(c, base, { steps, deadline: Boolean(cmd.deadline), lastDirective: last }));
      }
      const found = [...afterCommand.map((x) => `${label}; ${outcome}; recovery: ${trail}; after the command: ${x}`), ...afterRecovery.map((x) => `${label}; ${outcome}; recovery: ${trail}; after the recovery: ${x}`)];
      if (found.length) reported.push(k);
      violations.push(...found);
      if (rest?.faultFree && recovery) {
        // Liveness (R1): after the recovery the run continues to rest and is compared with the fault-free run's end state.
        const d = await drive(c, steps);
        rest.points.push({ faultPoint: pointName(cmd.stage, points, k), faultFree: rest.faultFree.end, end: endState(c, d.last), steps: d.steps });
      }
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

const LIVENESS_SENTENCES = [
  'The liveness check (card T1-VERIFY-LIVENESS) continues each fault run until `card next` returns `close`, `done` or `stop`, or for 12 `card next` calls, taking the move each directive names (`card attempt`, `review pre`, `review r3`, or a wait of `pollSeconds` on the fixture clock), and compares the end state with the fault-free run\'s: the card state and stop, the attempts, both review ledgers, the review-pool requests and slots, the card\'s operations and the decision events of the journal.',
  'A fault point whose end state differs fails the test unless `KNOWN_VIOLATIONS` in the test file pins it with that difference and its counterexample; a pin that no longer reproduces fails the test too, so a fix removes its pin in the same change.',
  'Each pin is a defect to file as a T0-bugfix card, except where the pin names a recovery these docs assign to a person, such as `aidlc ops reconcile` for an operation left `issued`.',
];

const LIVENESS_CHANGELOG_ENTRY = '- T1-VERIFY-LIVENESS: the fault-point test continues each fault run to rest and fails when the card does not reach the fault-free end state (card state, attempts, review ledgers, review-pool slots, operations, journal decisions), apart from the violations pinned in `KNOWN_VIOLATIONS` with their counterexamples; a pin that no longer reproduces fails the test.';

const lf = (file: string): string => readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------------------------------------------------

describe('fault-point check: each card-run write and journal append of five commands fails in turn (T1-VERIFY-FAULT-POINTS)', { timeout: 30_000 }, () => {
  const rested = new Map<Stage, Rest>();
  for (const cmd of COVERED) {
    it(`${cmd.name}: the fault-free run has fault points and no violation, and every fault point and its recovery keep I1 to I6 [R1] [R2] [R3]`, async (t) => {
      const rest: Rest = { counted: 0, points: [] };
      rested.set(cmd.stage, rest);
      const out = await enumerate(cmd, () => startAt(cmd.stage), (msg) => t.diagnostic(msg), true, rest);
      t.diagnostic(`${cmd.name}: ${out.points.length} fault points: ${out.points.map((p, n) => `${n + 1} ${describePoint(p)}`).join('; ')}`);
      assert.ok(out.points.some((p) => p.call === 'renameSync'), 'at least one card-run record write');
      assert.ok(out.points.some((p) => p.call === 'appendFileSync'), 'at least one goal journal append');
      assert.deepEqual(out.violations, []);
    });

    it(`${cmd.name}: the fault-free run rests at ${cmd.deadline ? 'stop with FAULT_FREE_TIME' : 'close with FAULT_FREE_CLOSE'} inside ${NEXT_BOUND} next calls [R1] [R3] [R4]`, () => {
      const ff = rested.get(cmd.stage)?.faultFree;
      assert.ok(ff, `${cmd.name}: the fault-free run was driven`);
      const trail = `drive: ${ff.steps.map(driveText).join(', ')}`;
      assert.deepEqual(ff.end, cmd.deadline ? FAULT_FREE_TIME : FAULT_FREE_CLOSE, trail);
      assert.ok(ff.nexts <= NEXT_BOUND, `${ff.nexts} next calls; ${trail}`);
    });
  }

  it('every fault point of A to E reaches its command\'s fault-free end state or matches its pin exactly, and no pin is stale [R5] [R6]', () => {
    assert.deepEqual([...rested.keys()], COVERED.map((c) => c.stage));
    for (const [stage, rest] of rested) assert.ok(rest.counted > 0 && rest.points.length === rest.counted, `${stage}: ${rest.points.length} of ${rest.counted} fault points driven to rest`);
    const observed = [...rested.values()].flatMap((r) => r.points);
    assert.deepEqual(judge(observed, KNOWN_VIOLATIONS), { unpinned: [], stale: [] });
  });

  it('every pin names a fault point, a difference, its hypothesis and a counterexample, and a documented recovery where it names one [R5]', () => {
    const ops = lf('docs/OPERATIONS.md');
    for (const pin of KNOWN_VIOLATIONS) {
      assert.match(pin.faultPoint, /^[A-E]\/(record \d+|append [A-Z_]+( \d+)?)$/, pin.faultPoint);
      assert.ok(Object.keys(pin.difference).length > 0, `${pin.faultPoint}: a difference`);
      assert.match(pin.hypothesis, /^(H([1-9]|10)|new)$/, `${pin.faultPoint}: ${pin.hypothesis}`);
      assert.ok(pin.counterexample.length > 80, `${pin.faultPoint}: a counterexample`);
      if (pin.docRecovery !== undefined) assert.ok(ops.includes(pin.docRecovery), `${pin.faultPoint}: docs/OPERATIONS.md names ${pin.docRecovery}`);
    }
    assert.equal(new Set(KNOWN_VIOLATIONS.map((p) => p.faultPoint)).size, KNOWN_VIOLATIONS.length, 'one pin per fault point');
  });

  it('the judge reports an unpinned difference, a pin now at the fault-free end state, a pin whose difference changed and a pin on an uncounted fault point, and nothing for a matching pin [R8]', () => {
    const at = (faultPoint: string, end: EndState): Rested => ({ faultPoint, faultFree: FAULT_FREE_CLOSE, end, steps: [{ call: 'next', directive: end.directive ?? undefined }] });
    const stuck: EndState = { ...FAULT_FREE_CLOSE, directive: 'review', state: 'SHIP' };
    const doubled: EndState = { ...FAULT_FREE_CLOSE, journal: { ...FAULT_FREE_CLOSE.journal, 'ATTEMPT_FINISHED success': 2 } };
    const pin = (faultPoint: string, difference: Difference): Pin => ({ faultPoint, difference, hypothesis: 'new', counterexample: 'hand-built' });
    const verdict = judge(
      [at('X/append NOTE', stuck), at('Y/record 1', FAULT_FREE_CLOSE), at('Z/record 2', doubled), at('M/record 3', stuck)],
      [pin('Y/record 1', { state: ['CLOSE', 'SHIP'] }), pin('Z/record 2', { state: ['CLOSE', 'SHIP'] }), pin('M/record 3', { directive: ['close', 'review'], state: ['CLOSE', 'SHIP'] }), pin('Q/record 9', { state: ['CLOSE', 'SHIP'] })],
    );
    assert.deepEqual(verdict.unpinned, ['X/append NOTE: directive fault-free "close", observed "review"; state fault-free "CLOSE", observed "SHIP"; drive: next -> review']);
    assert.equal(verdict.stale.length, 3, verdict.stale.join('\n'));
    assert.match(verdict.stale[0]!, /^pin Y\/record 1 \(new\): the fault point reaches the fault-free end state/);
    assert.match(verdict.stale[1]!, /^pin Z\/record 2 \(new\): the difference changed: pinned state fault-free "CLOSE", observed "SHIP"; observed journal\.ATTEMPT_FINISHED success fault-free 1, observed 2; drive: next -> close$/);
    assert.match(verdict.stale[2]!, /^pin Q\/record 9 \(new\): no counted fault point has this name$/);
  });

  it('fault points are named by command and call, uniquely per command, and the drive takes the build and wait moves on the base [R2] [R7]', () => {
    for (const [stage, rest] of rested) {
      const names = rest.points.map((p) => p.faultPoint);
      for (const n of names) assert.match(n, new RegExp(`^${stage}/(record \\d+|append [A-Z_]+( \\d+)?)$`), n);
      assert.equal(new Set(names).size, names.length, `${stage}: ${names.join(', ')}`);
    }
    const point = (name: string) => [...rested.values()].flatMap((r) => r.points).find((p) => p.faultPoint === name);
    const a = point('A/record 1');
    assert.ok(a?.steps.some((s, n) => s.call === 'recordAttempt' && s.threw === undefined && a.steps[n - 1]?.directive === 'build'), a?.steps.map(driveText).join(', '));
    const b = point('B/record 2');
    const waits = b?.steps.filter((s) => s.call === 'wait') ?? [];
    assert.ok(waits.length > 0 && waits.every((s) => s.clock !== undefined && Date.parse(s.clock[1]) - Date.parse(s.clock[0]) === (s.pollSeconds ?? 0) * 1000) && waits.some((s) => (s.pollSeconds ?? 0) > 0), b?.steps.map(driveText).join(', '));
  });

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

  LIVENESS_SENTENCES.forEach((sentence, n) => {
    it(`docs/OPERATIONS.md Fault-point check states sentence ${n + 1} of the liveness doc text (T1-VERIFY-LIVENESS) [R9]`, () => {
      assert.ok(section().includes(sentence), sentence);
    });
  });

  it('the CHANGELOG Unreleased section carries the T1-VERIFY-LIVENESS entry [R10]', () => {
    const changelog = lf('CHANGELOG.md');
    const start = changelog.indexOf('## Unreleased');
    const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
    assert.ok(unreleased.split('\n').includes(LIVENESS_CHANGELOG_ENTRY), LIVENESS_CHANGELOG_ENTRY);
  });
});
