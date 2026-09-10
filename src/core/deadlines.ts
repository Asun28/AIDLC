/**
 * Admission deadlines (plan v5 §1 "Authority and limits").
 *
 * - Three hours per card, twelve hours per multi-card arc, including planning and waits.
 * - A tighter user/project limit wins. Original starts are persisted; retries, revisions,
 *   successors and wakeups never reset them. A delayed approval does not extend a deadline;
 *   an extension is explicit and recorded.
 * - At the admission deadline no new planned work starts; reconciliation may finish within
 *   the five-minute grace.
 */
import {
  ARC_LIMIT_MS,
  CARD_LIMIT_MS,
  RECONCILE_GRACE_MS,
  addMs,
  minIso,
  type Deadlines,
  type IsoTimestamp,
} from './types.ts';

export interface DeadlineOptions {
  /** Number of cards if known; 'unknown' or >1 selects the arc limit. */
  cardCount: number | 'unknown';
  /** Standalone release goals use the single-card limit. */
  standaloneRelease?: boolean;
  /** Optional tighter user/project limit in milliseconds. */
  userLimitMs?: number;
}

export function computeGoalDeadlines(createdAt: IsoTimestamp, options: DeadlineOptions): Deadlines {
  const multi = options.cardCount === 'unknown' || (typeof options.cardCount === 'number' && options.cardCount > 1);
  let limit = multi && !options.standaloneRelease ? ARC_LIMIT_MS : CARD_LIMIT_MS;
  if (options.userLimitMs !== undefined && options.userLimitMs > 0 && options.userLimitMs < limit) limit = options.userLimitMs;
  return {
    createdAt,
    goalDeadline: addMs(createdAt, limit),
    extensions: [],
    graceMs: RECONCILE_GRACE_MS,
  };
}

/** Effective goal deadline: the last explicit recorded extension wins. */
export function effectiveGoalDeadline(deadlines: Deadlines): IsoTimestamp {
  const last = deadlines.extensions[deadlines.extensions.length - 1];
  return last ? last.newDeadline : deadlines.goalDeadline;
}

/** A card's admission deadline is the earlier of its own 3h limit and the goal deadline. */
export function computeCardDeadline(cardStart: IsoTimestamp, deadlines: Deadlines, userLimitMs?: number): IsoTimestamp {
  let limit = CARD_LIMIT_MS;
  if (userLimitMs !== undefined && userLimitMs > 0 && userLimitMs < limit) limit = userLimitMs;
  return minIso(addMs(cardStart, limit), effectiveGoalDeadline(deadlines));
}

export type AdmissionPhase = 'open' | 'grace' | 'expired';

export interface AdmissionCheck {
  phase: AdmissionPhase;
  remainingMs: number;
  deadline: IsoTimestamp;
  graceEndsAt: IsoTimestamp;
}

/** Whether new planned work may still be admitted, and whether reconciliation may continue. */
export function checkAdmission(deadline: IsoTimestamp, now: IsoTimestamp, graceMs: number = RECONCILE_GRACE_MS): AdmissionCheck {
  const remainingMs = Date.parse(deadline) - Date.parse(now);
  const graceEndsAt = addMs(deadline, graceMs);
  if (remainingMs > 0) return { phase: 'open', remainingMs, deadline, graceEndsAt };
  if (Date.parse(now) < Date.parse(graceEndsAt)) return { phase: 'grace', remainingMs, deadline, graceEndsAt };
  return { phase: 'expired', remainingMs, deadline, graceEndsAt };
}

/** Record an explicit extension. Never called implicitly by retries or approvals. */
export function extendDeadline(deadlines: Deadlines, by: string, newDeadline: IsoTimestamp, reason: string, at: IsoTimestamp): Deadlines {
  if (Date.parse(newDeadline) <= Date.parse(effectiveGoalDeadline(deadlines))) {
    throw new Error('extension must move the deadline later');
  }
  if (!reason.trim()) throw new Error('extension requires a recorded reason');
  return { ...deadlines, extensions: [...deadlines.extensions, { at, by, newDeadline, reason }] };
}

/** True when an operation with the given timeout can still finish before the deadline. */
export function fitsBeforeDeadline(deadline: IsoTimestamp, now: IsoTimestamp, timeoutMs: number): boolean {
  return Date.parse(now) + timeoutMs <= Date.parse(deadline);
}
