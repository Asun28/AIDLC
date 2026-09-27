/**
 * STOP records (plan v5 §5 "Pacing, closure and STOP").
 *
 * A STOP preserves partial effects, the reason and the precise next action. Global
 * prohibitions and capture failures are distinguished from a single blocked branch.
 */
import { nowIso, type StopReason, type StopRecord } from './types.ts';

const GLOBAL_REASONS: ReadonlySet<StopReason> = new Set<StopReason>(['auth', 'audit', 'cancelled', 'ownership', 'risk', 'frozen', 'time']);

/**
 * The next action of a stop that nothing lifts (card T0-TOOL-STOP-TEXT, issue 85 item 2): a `tool` stop is selected before
 * anything else, so the command that made it returns it again and the way on is a replacement card through `goal resume`
 * (a recorded resume is issue 109). It gives the cause first and never names `card next`.
 */
export function toolStopNextAction(goalId: string, cardId: string, cause: string, _candidate = true): string {
  return `${cause}; this stop is final for card ${cardId}: fix the cause, register a replacement card that carries the candidate, then run \`aidlc goal resume ${goalId} --reason "..." --replace '{"${cardId}":"<replacement>"}'\``;
}

export function makeStop(
  reason: StopReason,
  detail: string,
  nextAction: string,
  options: { global?: boolean; unresolvedOperations?: string[]; at?: string; finalFor?: { goalId: string; cardId: string; candidate?: boolean } } = {},
): StopRecord {
  return {
    reason,
    detail,
    // `finalFor` marks a stop nothing lifts: its next action is the cause followed by the replacement path.
    nextAction: options.finalFor ? toolStopNextAction(options.finalFor.goalId, options.finalFor.cardId, nextAction) : nextAction,
    global: options.global ?? GLOBAL_REASONS.has(reason),
    at: options.at ?? nowIso(),
    unresolvedOperations: options.unresolvedOperations ?? [],
  };
}

export function isGlobalStop(stop: StopRecord | undefined): boolean {
  return Boolean(stop && stop.global);
}

/** Human-readable one-line rendering used by the CLI and the board. */
export function formatStop(stop: StopRecord): string {
  const scope = stop.global ? 'global' : 'branch';
  const unresolved = stop.unresolvedOperations.length ? ` unresolved=${stop.unresolvedOperations.join(',')}` : '';
  return `STOP/${stop.reason} (${scope}) ${stop.detail} -> next: ${stop.nextAction}${unresolved}`;
}
