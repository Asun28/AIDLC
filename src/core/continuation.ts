/**
 * The continuation of a stop (card T1-CONTINUE-CORE, spec card-continuation R1 to R5): a recorded act lets a run stopped for review
 * take a stated number of further R3 decisions. Pure: it returns the entry and the ledger, and the caller writes them.
 */
import { MAX_NO_VERDICT_RETRIES, MAX_R3_DECISIONS, type CardRun, type Continuation, type ReviewLedger } from './types.ts';

export interface ContinuationAct {
  at: string;
  by: string;
  reason: string;
  /** Further R3 decisions admitted, 1 to 4; 1 when absent. */
  decisions?: number;
}

/**
 * The entry and the ledger of a continuation of a review stop: each invocation with an unlifted `stopReview` gets `stopLifted`, and
 * `admits` is `substantiveDecisions` plus `decisions`. No counter moves. Throws, changing nothing, when a condition does not hold.
 */
export function continueReviewStop(run: Pick<CardRun, 'state' | 'stop' | 'review'>, act: ContinuationAct, commandReviewer: boolean): { continuation: Continuation; review: ReviewLedger } {
  const stop = run.stop;
  if (run.state !== 'STOP' || !stop) throw new Error(`the card run is in ${run.state}, not in STOP: a continuation lifts a stop`);
  if (stop.reason !== 'review') throw new Error(`the stop reason ${stop.reason} is not review: this continuation lifts a stop for review`);
  if (!commandReviewer) throw new Error('the formal reviewer is not a command: it runs inside the ship script, where no admission reads a continuation');
  if (run.review.noVerdictRetriesUsed > MAX_NO_VERDICT_RETRIES) throw new Error('the review stopped on a missing verdict, not on a decision: a continuation admits decisions, not retries');
  const by = act.by.trim();
  const reason = act.reason.trim();
  if (!by) throw new Error('by is blank: name who continues the run');
  if (!reason) throw new Error('reason is blank: say why the run goes on');
  const decisions = act.decisions ?? 1;
  if (!Number.isInteger(decisions) || decisions < 1 || decisions > MAX_R3_DECISIONS) throw new Error(`decisions ${decisions} is not a whole number from 1 to ${MAX_R3_DECISIONS}`);
  const lifted = { at: act.at, by };
  return {
    continuation: { at: act.at, by, reason, stop: { reason: stop.reason, detail: stop.detail, at: stop.at }, decisions, admits: run.review.substantiveDecisions + decisions },
    review: { ...run.review, invocations: run.review.invocations.map((i) => (i.stopReview && !i.stopLifted ? { ...i, stopLifted: lifted } : i)) },
  };
}

/** The decision count the last continuation of a review stop admits; undefined when no continuation lifted a review stop. */
export function admittedDecisions(continuations: Continuation[]): number | undefined {
  return continuations.filter((c) => c.stop.reason === 'review').at(-1)?.admits;
}
