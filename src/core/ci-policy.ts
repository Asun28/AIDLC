/**
 * CI policy (plan v5 R22-R24, Q7).
 *
 * Diagnose before rerunning: a code defect goes back to BUILD with a new candidate; only a
 * justified transient failure earns one same-origin rerun per run/attempt/candidate. The
 * rerun identity is persisted before the request, and a queued/running/completed rerun
 * consumes the allowance even when its request response was lost.
 */
import { MAX_CI_TRANSIENT_RERUNS, type CiFailureClass, type CiLedger } from './types.ts';

const TRANSIENT_PATTERNS: RegExp[] = [
  /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|socket hang up/i,
  /connection (?:reset|refused|timed out)/i,
  /rate limit|429 Too Many Requests|503 Service Unavailable|502 Bad Gateway/i,
  /The hosted runner .* lost communication|runner has received a shutdown signal|The operation was canceled/i,
  /No space left on device/i,
  /Unable to (?:download|resolve) (?:action|artifact)|Failed to (?:download|restore) cache/i,
  /npm ERR! (?:network|fetch failed)|ERR_PNPM_FETCH|ECONNABORTED/i,
  /Could not resolve host|Temporary failure in name resolution/i,
  /timed out waiting for|exceeded the maximum execution time/i,
  /flaky|retry(?:ing)? in \d+/i,
];

const CODE_DEFECT_PATTERNS: RegExp[] = [
  /AssertionError|assert(?:ion)? failed|expected .* (?:to|but) (?:be|equal|received)/i,
  /FAIL(?:ED)?\s+(?:tests?|suites?)|\d+ (?:failed|failing)/i,
  /error TS\d+|SyntaxError|ReferenceError|TypeError|NullPointerException|IndexError|KeyError/i,
  /compilation failed|cannot find (?:module|symbol|name)|undefined reference/i,
  /lint(?:ing)? (?:error|failed)|ruff|eslint .*error/i,
  /test(?:s)? (?:did not|didn't) pass|exit code 1/i,
  /Traceback \(most recent call last\)/,
];

export interface CiJob {
  name: string;
  conclusion?: string | null;
  status?: string | null;
  logExcerpt?: string;
}

export interface CiClassification {
  class: CiFailureClass;
  failedJobs: string[];
  evidence: string[];
}

export function classifyCiFailure(jobs: CiJob[], extraLog?: string): CiClassification {
  const failed = jobs.filter((j) => j.conclusion && !['success', 'neutral', 'skipped'].includes(j.conclusion.toLowerCase()));
  const texts = [...failed.map((j) => j.logExcerpt ?? ''), extraLog ?? ''].filter((t) => t.length > 0);
  const evidence: string[] = [];
  let codeHits = 0;
  let transientHits = 0;
  for (const text of texts) {
    for (const p of CODE_DEFECT_PATTERNS) {
      const m = text.match(p);
      if (m) {
        codeHits += 1;
        evidence.push(`code: ${m[0].slice(0, 80)}`);
      }
    }
    for (const p of TRANSIENT_PATTERNS) {
      const m = text.match(p);
      if (m) {
        transientHits += 1;
        evidence.push(`transient: ${m[0].slice(0, 80)}`);
      }
    }
  }
  let cls: CiFailureClass;
  if (codeHits > 0) cls = 'code-defect'; // any deterministic failure evidence wins; repair first
  else if (transientHits > 0) cls = 'transient';
  else cls = 'unknown';
  if (failed.some((j) => (j.conclusion ?? '').toLowerCase() === 'cancelled') && codeHits === 0) {
    cls = transientHits > 0 ? 'transient' : 'unknown';
  }
  return { class: cls, failedJobs: failed.map((j) => j.name), evidence };
}

export interface RerunDecision {
  allowed: boolean;
  reason: string;
}

/** Whether a same-origin rerun for (runId, attempt, candidate) is still within allowance. */
export function canRerun(ledger: CiLedger, runId: string, attempt: number, candidate: string, classification: CiFailureClass): RerunDecision {
  if (classification !== 'transient') {
    return { allowed: false, reason: classification === 'code-defect' ? 'code defect: repair in BUILD and ship a new candidate' : 'unclassified failure: diagnose before any rerun' };
  }
  const used = ledger.reruns.filter((r) => r.candidate === candidate && r.outcome !== 'cancelled');
  if (used.length >= MAX_CI_TRANSIENT_RERUNS) {
    return { allowed: false, reason: `rerun allowance (${MAX_CI_TRANSIENT_RERUNS}) already consumed for candidate ${candidate.slice(0, 12)} (run ${used[0]?.runId} attempt ${used[0]?.attempt})` };
  }
  if (used.some((r) => r.runId === runId && r.attempt === attempt)) {
    return { allowed: false, reason: 'a rerun for this run/attempt is already persisted; reconcile its outcome first' };
  }
  return { allowed: true, reason: 'justified transient failure; one same-origin rerun permitted' };
}

/** Persist the rerun intent BEFORE issuing the request. */
export function recordRerunIntent(ledger: CiLedger, runId: string, attempt: number, candidate: string, requestedAt: string): CiLedger {
  return { ...ledger, reruns: [...ledger.reruns, { runId, attempt, candidate, requestedAt, outcome: 'requested' }] };
}

export function reconcileRerun(ledger: CiLedger, runId: string, attempt: number, outcome: 'queued' | 'in_progress' | 'success' | 'failure' | 'lost' | 'cancelled', reconciledAt: string): CiLedger {
  return {
    ...ledger,
    reruns: ledger.reruns.map((r) => (r.runId === runId && r.attempt === attempt ? { ...r, outcome, reconciledAt } : r)),
  };
}

/** Whether a lost rerun response must be looked up before any further CI action. */
export function hasUnreconciledRerun(ledger: CiLedger): boolean {
  return ledger.reruns.some((r) => r.outcome === 'requested' || r.outcome === 'lost' || r.outcome === 'queued' || r.outcome === 'in_progress');
}
