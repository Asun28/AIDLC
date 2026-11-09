/**
 * Bound statistics (card T1-BOUND-STATS): how often each loop bound fired and the current outcome of the goal that hit
 * it, read only from the goal and card-run records. `summarizeBounds` is pure, with no clock; `readBoundRecords` reads
 * each record file on its own, with no snapshot across files.
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

/** `outcomes` is the current state of each firing's goal, `STOP` by goal stop reason in StopReason order; `extensions` is `deadlines.extensions.length` of every goal read. */
export interface BoundStats {
  bounds: { bound: Bound; fired: number; outcomes: { DONE: number; STOP: Partial<Record<StopReason, number>>; open: number } }[];
  extensions: { goalId: string; count: number }[];
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
  return { bounds, extensions: goals.map((g) => ({ goalId: g.id, count: g.deadlines.extensions.length })) };
}

/** JSON text with every code point outside U+0020..U+007E escaped as \uXXXX: record text never reaches a terminal raw. */
export function asciiJson(value: unknown, indent?: number): string {
  return JSON.stringify(value, null, indent).replace(/[^\x20-\x7e\n]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function formatBounds(s: BoundStats): string {
  const fired = s.bounds.filter((b) => b.fired > 0).map((b) => `${b.bound} ${b.fired} (DONE ${b.outcomes.DONE}${Object.entries(b.outcomes.STOP).map(([reason, n]) => `, STOP/${reason} ${n}`).join('')}, open ${b.outcomes.open})`);
  const extended = s.extensions.filter((e) => e.count > 0).map((e) => `${asciiJson(e.goalId)} ${e.count}`);
  return `Bounds: ${fired.length ? fired.join('; ') : 'none fired'}\nExtensions: ${extended.length ? extended.join('; ') : 'none'}`;
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
