/**
 * Bound statistics (card T1-BOUND-STATS): how often each loop bound fired and the current outcome of the goal that hit
 * it, and the recorded owner acts and the card runs left in STOP (card T0-BOUNDS-OWNER-ACTS), read only from the goal and
 * card-run records. `summarizeBounds` is pure, with no clock; `readBoundRecords` reads each record file on its own, with
 * no snapshot across files.
 */
import path from 'node:path';
import { CardRun, Goal, StopReason } from '../core/types.ts';
import { effectiveGoalDeadline } from '../core/deadlines.ts';
import { listJsonFiles, readJson } from './store.ts';
import { readErrorCode } from './claims.ts';
import type { GoalStore } from './goal-store.ts';

/** The README Limits names, in that order. */
export const BOUNDS = ['Card admission', 'Arc admission', 'Reconciliation grace', 'Substantive review decisions', 'No-verdict retry', 'Transient CI rerun', 'Implementation attempts', 'Planning invocations', 'Integration repair cycles'] as const;
type Bound = (typeof BOUNDS)[number];

const ACT_KINDS = ['extensions', 'continuations', 'amendments', 'rulings'] as const;
type ActCounts = Record<(typeof ACT_KINDS)[number], number>;
/** One recorded act; `waitMs` is its time after the deadline in force (an extension) or after the stop (a continuation), 0 for the other kinds. */
interface Act { kind: keyof ActCounts; at: string; by: string; waitMs: number }

/**
 * `outcomes` is the current state of each firing's goal, `STOP` by goal stop reason in StopReason order; `extensions` is
 * `deadlines.extensions.length` of every goal read. `acts` and `stopped` hold one entry per UTC month of the record's
 * time, earliest first; `actors` one per distinct `by` text, in code unit order.
 */
export interface BoundStats {
  bounds: { bound: Bound; fired: number; outcomes: { DONE: number; STOP: Partial<Record<StopReason, number>>; open: number } }[];
  extensions: { goalId: string; count: number }[];
  acts: (ActCounts & { month: string; extensionsAfterDeadline: number; hoursLateMedian: number | null; hoursFromStopMedian: number | null })[];
  actors: (ActCounts & { by: string })[];
  stopped: { month: string; reasons: Partial<Record<StopReason, number>> }[];
}

const ms = Date.parse;
const TERMINAL_EFFORT = new Set(['same-cause-stop', 'exhausted', 'escalation-unavailable', 'escalation-failed']);
/** A time STOP with no unresolved operation is a deadline; one with them is the reconciliation grace. */
const timeStop = (s: Goal['stop'], grace: boolean) => s?.reason === 'time' && (s.unresolvedOperations.length > 0) === grace;

/** The goal bounds one goal fired, each at most once (the card's Derivation table). */
function goalBounds(g: Goal): Bound[] {
  const s = g.stop;
  return [
    timeStop(s, false) && ms(s!.at) >= ms(effectiveGoalDeadline(g.deadlines)) && 'Arc admission',
    timeStop(s, true) && 'Reconciliation grace',
    g.counters.planningInvocations >= 2 && 'Planning invocations',
    (g.counters.integrationRepairCycles >= 1 || s?.reason === 'arc-verify') && 'Integration repair cycles',
  ].filter((b): b is Bound => Boolean(b));
}

/** The card bounds one run fired, each at most once; the run's goal decides the card deadline row. */
function runBounds(r: CardRun, g: Goal | undefined): Bound[] {
  const s = r.stop;
  const latest = [...r.review.invocations].sort((a, b) => ms(a.requestedAt) - ms(b.requestedAt)).at(-1);
  return [
    timeStop(s, false) && g && ms(r.deadline) < ms(effectiveGoalDeadline(g.deadlines)) && 'Card admission',
    timeStop(s, true) && 'Reconciliation grace',
    (r.review.substantiveDecisions >= 2 || (s?.reason === 'review' && latest?.outcome === 'block')) && 'Substantive review decisions',
    // A review STOP with more than one retry used has also reached the allowance of one.
    r.review.noVerdictRetriesUsed >= 1 && 'No-verdict retry',
    (r.ci.reruns.some((x) => x.outcome !== 'cancelled') || (s?.reason === 'ci' && r.ci.reruns.some((x) => x.candidate === r.candidate?.digest))) && 'Transient CI rerun',
    r.effort && (r.effort.escalationUsed || (s?.reason === 'card' && TERMINAL_EFFORT.has(r.effort.terminal ?? ''))) && 'Implementation attempts',
  ].filter((b): b is Bound => Boolean(b));
}

/** Every act of the records; an extension's deadline in force is the goal deadline, then the newDeadline of the entry before it. */
function ownerActs(goals: readonly Goal[], runs: readonly CardRun[]): Act[] {
  return [
    ...goals.flatMap(({ deadlines: d }) => d.extensions.map((x, i): Act => ({ kind: 'extensions', at: x.at, by: x.by, waitMs: ms(x.at) - ms(d.extensions[i - 1]?.newDeadline ?? d.goalDeadline) }))),
    ...runs.flatMap((r) => [
      ...r.continuations.map((c): Act => ({ kind: 'continuations', at: c.at, by: c.by, waitMs: ms(c.at) - ms(c.stop.at) })),
      ...r.amendments.map((a): Act => ({ kind: 'amendments', at: a.at, by: a.by, waitMs: 0 })),
      ...r.findings.flatMap(({ ruling }): Act[] => (ruling ? [{ kind: 'rulings', at: ruling.at, by: ruling.by, waitMs: 0 }] : [])),
    ]),
  ];
}

const monthOf = (at: string) => at.slice(0, 7);

/** The items under each key, the keys in code unit order. */
function grouped<T>(items: readonly T[], keyOf: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(keyOf(item), [...(groups.get(keyOf(item)) ?? []), item]);
  return [...groups].sort(([a], [b]) => (a < b ? -1 : 1));
}

/** The median in hours to one decimal place, the lower of the two middle values for an even count; `null` for none. */
function medianHours(waits: number[]): number | null {
  const middle = waits.sort((a, b) => a - b)[Math.floor((waits.length - 1) / 2)];
  return middle === undefined ? null : Math.round((middle / 3_600_000) * 10) / 10;
}

function monthActs([month, acts]: [string, Act[]]): BoundStats['acts'][number] {
  const { extensions, continuations, amendments, rulings } = actCounts(acts);
  const waits = (kind: Act['kind']) => acts.filter((a) => a.kind === kind).map((a) => a.waitMs);
  const late = waits('extensions').filter((wait) => wait > 0);
  return { month, extensions, extensionsAfterDeadline: late.length, hoursLateMedian: medianHours(late), continuations, hoursFromStopMedian: medianHours(waits('continuations')), amendments, rulings };
}

function actCounts(acts: readonly Act[]): ActCounts {
  return Object.fromEntries(ACT_KINDS.map((kind) => [kind, acts.filter((a) => a.kind === kind).length])) as ActCounts;
}

/** The runs left in STOP by month and reason; a run whose goal is DONE or cancelled is not left, one whose goal was not read is. */
function stoppedRuns(runs: readonly CardRun[], goalOf: (r: CardRun) => Goal | undefined): BoundStats['stopped'] {
  const stops = runs.flatMap((r) => {
    const g = goalOf(r);
    return r.state === 'STOP' && r.stop && g?.state !== 'DONE' && g?.stop?.reason !== 'cancelled' ? [r.stop] : [];
  });
  return grouped(stops, (s) => monthOf(s.at)).map(([month, all]) => {
    const counts = StopReason.options.map((reason) => [reason, all.filter((s) => s.reason === reason).length] as const);
    return { month, reasons: Object.fromEntries(counts.filter(([, n]) => n > 0)) };
  });
}

export function summarizeBounds(goals: readonly Goal[], runs: readonly CardRun[]): BoundStats {
  const bounds: BoundStats['bounds'] = BOUNDS.map((bound) => ({ bound, fired: 0, outcomes: { DONE: 0, STOP: {}, open: 0 } }));
  const byId = new Map(goals.map((g) => [g.id, g]));
  const add = (fired: Bound[], g: Goal | undefined) => {
    for (const c of fired.map((b) => bounds[BOUNDS.indexOf(b)]!)) {
      const o = c.outcomes;
      c.fired += 1;
      if (g?.state === 'DONE') o.DONE += 1;
      else if (g?.stop) o.STOP[g.stop.reason] = (o.STOP[g.stop.reason] ?? 0) + 1;
      else o.open += 1;
    }
  };
  for (const g of goals) add(goalBounds(g), g);
  for (const r of runs) add(runBounds(r, byId.get(r.goalId)), byId.get(r.goalId));
  for (const { outcomes: o } of bounds) o.STOP = Object.fromEntries(StopReason.options.filter((x) => o.STOP[x]).map((x) => [x, o.STOP[x]]));
  const acts = ownerActs(goals, runs);
  return {
    bounds,
    extensions: goals.map((g) => ({ goalId: g.id, count: g.deadlines.extensions.length })),
    acts: grouped(acts, (a) => monthOf(a.at)).map(monthActs),
    actors: grouped(acts, (a) => a.by).map(([by, own]) => ({ by, ...actCounts(own) })),
    stopped: stoppedRuns(runs, (r) => byId.get(r.goalId)),
  };
}

/** JSON text with every code point outside U+0020..U+007E escaped as \uXXXX: record text never reaches a terminal raw. */
export function asciiJson(value: unknown, indent?: number): string {
  return JSON.stringify(value, null, indent).replace(/[^\x20-\x7e\n]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function formatBounds(s: BoundStats): string {
  const fired = s.bounds.filter((b) => b.fired > 0).map((b) => `${b.bound} ${b.fired} (DONE ${b.outcomes.DONE}${Object.entries(b.outcomes.STOP).map(([reason, n]) => `, STOP/${reason} ${n}`).join('')}, open ${b.outcomes.open})`);
  const extended = s.extensions.filter((e) => e.count > 0).map((e) => `${asciiJson(e.goalId)} ${e.count}`);
  const late = (m: BoundStats['acts'][number]) => (m.extensions ? ` (${m.extensionsAfterDeadline} after the deadline${m.hoursLateMedian === null ? '' : `, median ${m.hoursLateMedian.toFixed(1)} h late`})` : '');
  const waited = (m: BoundStats['acts'][number]) => (m.hoursFromStopMedian === null ? '' : ` (median ${m.hoursFromStopMedian.toFixed(1)} h after the stop)`);
  const acts = s.acts.map((m) => `${m.month} extensions ${m.extensions}${late(m)}, continuations ${m.continuations}${waited(m)}, amendments ${m.amendments}, rulings ${m.rulings}`);
  const actors = s.actors.map((a) => `${asciiJson(a.by)} ${ACT_KINDS.map((kind) => `${kind} ${a[kind]}`).join(', ')}`);
  const stopped = s.stopped.map((m) => `${m.month} ${Object.entries(m.reasons).map(([reason, n]) => `${reason} ${n}`).join(', ')}`);
  const line = (label: string, items: string[], none = 'none') => `${label}: ${items.length ? items.join('; ') : none}`;
  return [line('Bounds', fired, 'none fired'), line('Extensions', extended), line('Acts', acts), line('By', actors), line('Stopped', stopped)].join('\n');
}

/** A record or directory that could not be read or failed its schema: the path and the store's error code, never its text. */
export class BoundsReadError extends Error {}

function attempt<T>(file: string, read: () => T): T {
  try {
    return read();
  } catch (err) {
    throw new BoundsReadError(`cannot read ${asciiJson(file)}: ${readErrorCode(err)}`);
  }
}

/** Every goal and card run, or one goal's (`undefined` when that goal has no record); each file is read once, on its own. */
export function readBoundRecords(store: GoalStore, goalId?: string): { goals: Goal[]; runs: CardRun[] } | undefined {
  const files = goalId ? [store.goalFile(goalId)] : attempt(store.paths.goals, () => listJsonFiles(store.paths.goals));
  const goals = files.flatMap((f) => attempt(f, () => readJson(f, Goal)) ?? []);
  if (goalId && !goals.length) return undefined;
  const runFiles = goals.flatMap((g) => attempt(path.join(store.paths.cards, g.id), () => listJsonFiles(path.join(store.paths.cards, g.id))));
  return { goals, runs: runFiles.flatMap((f) => attempt(f, () => readJson(f, CardRun)) ?? []) };
}
