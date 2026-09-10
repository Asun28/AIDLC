/**
 * STOP records (plan v5 §5 "Pacing, closure and STOP").
 *
 * A STOP preserves partial effects, the reason and the precise next action. Global
 * prohibitions and capture failures are distinguished from a single blocked branch.
 */
import { nowIso, type StopReason, type StopRecord } from './types.ts';

const GLOBAL_REASONS: ReadonlySet<StopReason> = new Set<StopReason>(['auth', 'audit', 'cancelled', 'ownership', 'risk', 'frozen', 'time']);

export function makeStop(
  reason: StopReason,
  detail: string,
  nextAction: string,
  options: { global?: boolean; unresolvedOperations?: string[]; at?: string } = {},
): StopRecord {
  return {
    reason,
    detail,
    nextAction,
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
