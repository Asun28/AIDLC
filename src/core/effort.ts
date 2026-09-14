/**
 * Task-effort episodes (plan v5 MA2).
 *
 * One local repair episode has at most four evaluated attempts: the baseline attempt, up to
 * two baseline repairs and, only when justified, one final attempt at the next supported
 * effort. Expected RED, quota waits, admission holds, tool outages and missing environment
 * setup are not reasoning failures. Two consecutive failures with the same cause and no
 * verified progress stop the branch early. Escalation never happens automatically at start
 * and never creates a new time/review allowance.
 */
import type { Attempt, EffortEpisode, EffortLevel, NotCountedReason, Role } from './types.ts';

export const MAX_COUNTED_ATTEMPTS = 4;
export const MAX_BASELINE_ATTEMPTS = 3;

export function createEpisode(taskId: string, role: Role, baseline: EffortLevel, ladder: EffortLevel[]): EffortEpisode {
  if (!ladder.includes(baseline)) throw new Error(`baseline effort ${baseline} is not in the supported ladder ${ladder.join('>')}`);
  return { taskId, role, baseline, ladder, attempts: [], escalationUsed: false };
}

export function nextSupportedEffort(episode: EffortEpisode): EffortLevel | undefined {
  const idx = episode.ladder.indexOf(episode.baseline);
  return episode.ladder[idx + 1];
}

/** Attempts that count toward the ladder: DoD failures only. A success ends the episode, and a review block reopens it without spending an attempt (reviews keep their own rounds and decisions). */
export function countedAttempts(episode: EffortEpisode): Attempt[] {
  return episode.attempts.filter((a) => a.outcome === 'fail');
}

/** Sequence number of the next attempt: every attempt that ran, not-counted ones excluded. */
function nextAttemptNumber(episode: EffortEpisode): number {
  return episode.attempts.filter((a) => a.outcome !== 'not-counted').length + 1;
}

/** A review block (R2 or R3) reopens a succeeded episode: the blocked attempt keeps its success and its evidence notes the block; the repair is the next attempt at the same effort. */
export function reopenAfterReviewBlock(episode: EffortEpisode, reason: string): EffortEpisode {
  const idx = episode.attempts.length - 1;
  const last = episode.attempts[idx];
  if (!last || last.outcome !== 'success') return { ...episode, terminal: undefined };
  const attempts = episode.attempts.map((a, i) => (i === idx ? { ...a, evidence: `${a.evidence ? `${a.evidence}; ` : ''}review block: ${reason}` } : a));
  return { ...episode, attempts, terminal: undefined };
}

export function countedFailures(episode: EffortEpisode): Attempt[] {
  return episode.attempts.filter((a) => a.outcome === 'fail');
}

export type NextEffortAction =
  | { action: 'attempt'; effort: EffortLevel; n: number; escalated: boolean }
  | { action: 'done' }
  | { action: 'stop'; reason: 'same-cause-stop' | 'exhausted' | 'escalation-unavailable' | 'escalation-failed'; detail: string };

export interface EscalationJustification {
  /** The remaining gap plausibly benefits from more reasoning/implementation effort. */
  harderProblem: boolean;
  /** Time, authority and quality limits still permit another attempt. */
  limitsPermit: boolean;
}

/** Decide the next bounded step for the episode. Pure; persisted state decides everything. */
export function nextEffortAction(episode: EffortEpisode, justification?: EscalationJustification): NextEffortAction {
  if (episode.terminal === 'succeeded') return { action: 'done' };
  if (episode.terminal) {
    return { action: 'stop', reason: episode.terminal, detail: 'episode already terminal' };
  }
  if (episode.attempts.some((a) => a.outcome === 'running')) {
    throw new Error('an attempt is still running; finish or reconcile it before deciding the next action');
  }
  const failures = countedFailures(episode);
  const last = failures[failures.length - 1];
  const prev = failures[failures.length - 2];
  if (last && prev && last.cause && prev.cause && normaliseCause(last.cause) === normaliseCause(prev.cause) && !last.progress && !prev.progress) {
    return { action: 'stop', reason: 'same-cause-stop', detail: `two consecutive failures with cause "${normaliseCause(last.cause)}" and no verified progress` };
  }
  const counted = countedAttempts(episode).length;
  const n = nextAttemptNumber(episode);
  if (counted < MAX_BASELINE_ATTEMPTS) {
    return { action: 'attempt', effort: episode.baseline, n, escalated: false };
  }
  if (episode.escalationUsed) {
    return { action: 'stop', reason: 'escalation-failed', detail: 'the single escalated attempt already failed; episode ends with evidence and next needed action' };
  }
  const next = nextSupportedEffort(episode);
  if (!next) {
    return { action: 'stop', reason: 'escalation-unavailable', detail: `baseline ${episode.baseline} is already the maximum supported level` };
  }
  if (!last?.progress) {
    return { action: 'stop', reason: 'exhausted', detail: 'third baseline attempt failed without evidenced progress; a fourth attempt is not justified' };
  }
  if (!justification || !justification.harderProblem || !justification.limitsPermit) {
    return { action: 'stop', reason: 'exhausted', detail: 'escalation requires a diagnosed harder problem and remaining time/authority/quality allowance' };
  }
  return { action: 'attempt', effort: next, n, escalated: true };
}

export function startAttempt(episode: EffortEpisode, effort: EffortLevel, startedAt: string): EffortEpisode {
  const n = episode.attempts.length + 1;
  const escalated = effort !== episode.baseline;
  if (escalated && !episode.ladder.includes(effort)) throw new Error(`effort ${effort} unsupported`);
  return {
    ...episode,
    escalationUsed: episode.escalationUsed || escalated,
    attempts: [...episode.attempts, { n, effort, startedAt, outcome: 'running', progress: false, checksGained: [], checksLost: [] }],
  };
}

export interface FinishAttemptInput {
  finishedAt: string;
  outcome: 'success' | 'fail' | 'not-counted';
  notCountedReason?: NotCountedReason;
  cause?: string;
  evidence?: string;
  progress?: boolean;
  checksGained?: string[];
  checksLost?: string[];
  nextHypothesis?: string;
}

export function finishAttempt(episode: EffortEpisode, input: FinishAttemptInput): EffortEpisode {
  const idx = episode.attempts.findIndex((a) => a.outcome === 'running');
  if (idx < 0) throw new Error('no running attempt to finish');
  if (input.outcome === 'not-counted' && !input.notCountedReason) throw new Error('not-counted attempts must state their reason');
  if (input.outcome === 'fail' && !input.cause) throw new Error('a counted failure must record its normalised cause');
  const current = episode.attempts[idx]!;
  const finished: Attempt = {
    ...current,
    finishedAt: input.finishedAt,
    outcome: input.outcome,
    notCountedReason: input.notCountedReason,
    cause: input.cause,
    evidence: input.evidence,
    progress: input.progress ?? false,
    checksGained: input.checksGained ?? [],
    checksLost: input.checksLost ?? [],
    nextHypothesis: input.nextHypothesis,
  };
  const attempts = episode.attempts.map((a, i) => (i === idx ? finished : a));
  let terminal = episode.terminal;
  if (input.outcome === 'success') terminal = 'succeeded';
  const updated: EffortEpisode = { ...episode, attempts, terminal };
  if (input.outcome === 'fail') {
    const decision = nextEffortAction(updated, { harderProblem: true, limitsPermit: true });
    if (decision.action === 'stop' && decision.reason !== 'exhausted') updated.terminal = decision.reason;
    if (decision.action === 'stop' && decision.reason === 'exhausted' && (updated.escalationUsed || !nextSupportedEffort(updated))) {
      updated.terminal = updated.escalationUsed ? 'escalation-failed' : 'escalation-unavailable';
    }
  }
  return updated;
}

export function normaliseCause(cause: string): string {
  return cause
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '0x')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Host effort ladders; a Claude host uses its own verified levels, never a translation of GPT strings. */
export const EFFORT_LADDERS: Record<string, EffortLevel[]> = {
  gpt: ['low', 'medium', 'high', 'xhigh'],
  claude: ['low', 'medium', 'high', 'max'],
};
