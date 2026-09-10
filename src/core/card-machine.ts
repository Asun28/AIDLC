/**
 * Card state selection (plan v5 §5 "States and precedence", v4 §5 "State selection").
 *
 * The next state is chosen from evidence in a fixed precedence order; board or chat text
 * never decides. Reconciliation of an issued operation with unknown outcome comes first and
 * admits no new mutation. Card DONE is only a child result: the parent still verifies and
 * delivers the requested goal.
 */
import { checkAdmission } from './deadlines.ts';
import { makeStop } from './stop.ts';
import type { CardRun, CardState, StopRecord } from './types.ts';

export interface CardEvidence {
  now: string;
  /** Deadline and grace for admission decisions. */
  deadline: string;
  graceMs?: number;
  /** An issued operation (review, CI rerun, merge, deploy) whose outcome is unknown. */
  unknownOperations: string[];
  /** A known operation is still running (attach or wait). */
  runningOperation?: string;
  /** Terminal reason already recorded (owner takeover, cancellation, global STOP). */
  terminal?: StopRecord;
  /** Validated card, capabilities and owner (worktree attached safely). */
  prepared: boolean;
  /** Merge verified on the intended base (PR MERGED and base contains the commit). */
  mergeVerified: boolean;
  /** All closure predicates hold (metadata, doc_sync, findings, evidence, cleanup). */
  closureComplete: boolean;
  /** Fresh substantive review block on the current candidate that still has allowance. */
  reviewBlockPending: boolean;
  /** Review allowance exhausted / second block / no-verdict retries exhausted. */
  reviewExhausted: boolean;
  /** Acceptance work incomplete: RED not established, DoD failing, code-caused CI failure or base moved. */
  buildIncomplete: boolean;
  /** Candidate committed, checks green, no active operation, merge incomplete. */
  candidateReady: boolean;
  /** Ownership generation matches the current lease; false means stale dispatch. */
  ownershipCurrent: boolean;
  /** Same-cause repeated failure / effort episode exhausted. */
  repairExhausted?: string;
  /** Capability gaps that prohibit the path (advisory ship that could merge a defect, missing reviewer). */
  capabilityBlocker?: string;
}

export interface CardDecision {
  state: CardState;
  reason: string;
  stop?: StopRecord;
  /** True when no new delivery mutation may be admitted (reconciliation or terminal). */
  admitMutations: boolean;
}

export function selectCardState(ev: CardEvidence): CardDecision {
  const admission = checkAdmission(ev.deadline, ev.now, ev.graceMs);

  // 1. Reconcile first: an issued operation whose outcome is unknown blocks everything else.
  if (ev.unknownOperations.length > 0) {
    if (admission.phase === 'expired') {
      return {
        state: 'STOP',
        reason: 'reconciliation grace expired with unresolved operations',
        stop: makeStop('time', 'reconciliation grace expired; outcomes remain UNKNOWN', 'hand off the exact environment and unresolved operation ids to the named owner', {
          unresolvedOperations: ev.unknownOperations,
          at: ev.now,
        }),
        admitMutations: false,
      };
    }
    return { state: 'WAIT', reason: `reconciling unknown operations: ${ev.unknownOperations.join(',')}`, admitMutations: false };
  }

  // 2. Terminal reasons already recorded.
  if (ev.terminal) return { state: 'STOP', reason: ev.terminal.detail, stop: ev.terminal, admitMutations: false };
  if (!ev.ownershipCurrent) {
    return {
      state: 'STOP',
      reason: 'stale ownership generation',
      stop: makeStop('ownership', 'this dispatch carries a stale ownership generation', 'revalidate against the current lease before any further mutation', { at: ev.now }),
      admitMutations: false,
    };
  }
  if (ev.capabilityBlocker) {
    return { state: 'STOP', reason: ev.capabilityBlocker, stop: makeStop('capability', ev.capabilityBlocker, 'configure the missing control or choose a blocking path', { at: ev.now, global: false }), admitMutations: false };
  }

  // 3. DONE: merge verified and closure complete.
  if (ev.mergeVerified && ev.closureComplete) return { state: 'DONE', reason: 'verified prior completion; no new work', admitMutations: false };

  // 4. WAIT: a known operation is running.
  if (ev.runningOperation) return { state: 'WAIT', reason: `attached to running operation ${ev.runningOperation}`, admitMutations: false };

  // 5. CLOSE: merged but closure incomplete (regardless of card status text).
  if (ev.mergeVerified) return { state: 'CLOSE', reason: 'merge verified; complete only missing closure steps', admitMutations: true };

  // 6. Admission deadline: stop new planned work.
  if (admission.phase !== 'open') {
    return {
      state: 'STOP',
      reason: 'card admission deadline reached',
      stop: makeStop('time', `admission deadline ${ev.deadline} reached`, 'hand off with the existing branch/PR and evidence; an extension must be explicit and recorded', { at: ev.now, global: false }),
      admitMutations: false,
    };
  }

  // 7. Exhausted repair / review allowances.
  if (ev.reviewExhausted) {
    return { state: 'STOP', reason: 'review allowance exhausted', stop: makeStop('review', 'second substantive block or no verdict after the single retry', 'return the PR and retained verdict evidence for human adjudication', { at: ev.now, global: false }), admitMutations: false };
  }
  if (ev.repairExhausted) {
    return { state: 'STOP', reason: ev.repairExhausted, stop: makeStop('card', ev.repairExhausted, 'record cause, evidence and the next needed action; do not attempt again from another session', { at: ev.now, global: false }), admitMutations: false };
  }

  // 8. PREPARE: no validated run context.
  if (!ev.prepared) return { state: 'PREPARE', reason: 'validate card, capabilities and owner; start or attach', admitMutations: true };

  // 9. REVIEW-FIX: fresh substantive block with allowance left.
  if (ev.reviewBlockPending) return { state: 'REVIEW_FIX', reason: 'resolve candidate defects or document dispute within remaining review allowance', admitMutations: true };

  // 10. BUILD: acceptance work incomplete.
  if (ev.buildIncomplete) return { state: 'BUILD', reason: 'establish RED, implement/repair and run affected checks', admitMutations: true };

  // 11. SHIP: candidate ready.
  if (ev.candidateReady) return { state: 'SHIP', reason: 'dispatch/resume the existing ship path with preserved base and mode', admitMutations: true };

  return { state: 'BUILD', reason: 'no ready candidate; continue acceptance work', admitMutations: true };
}

/** Apply a decision to a durable card run record. */
export function applyCardDecision(run: CardRun, decision: CardDecision, now: string): CardRun {
  return { ...run, state: decision.state, stop: decision.stop ?? run.stop, updatedAt: now };
}

export const CARD_TRANSITIONS: Record<CardState, CardState[]> = {
  PREPARE: ['BUILD', 'WAIT', 'STOP', 'CLOSE', 'DONE'],
  BUILD: ['SHIP', 'WAIT', 'STOP', 'BUILD'],
  SHIP: ['WAIT', 'REVIEW_FIX', 'BUILD', 'CLOSE', 'STOP'],
  REVIEW_FIX: ['SHIP', 'BUILD', 'STOP', 'WAIT'],
  WAIT: ['BUILD', 'SHIP', 'REVIEW_FIX', 'CLOSE', 'STOP', 'DONE', 'PREPARE'],
  CLOSE: ['DONE', 'STOP', 'WAIT'],
  DONE: [],
  STOP: [],
};

export function isCardTransitionAllowed(from: CardState, to: CardState): boolean {
  return from === to || CARD_TRANSITIONS[from].includes(to);
}
