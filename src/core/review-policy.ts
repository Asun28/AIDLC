/**
 * Review policy (plan v5 §5 "Build, review and retries", R20-R25).
 *
 * - Substantive allowance: an initial decision plus one subsequent decision for a repaired
 *   candidate. A second block, or a required review beyond the allowance, is STOP/review.
 * - Missing / malformed / stale verdicts never pass. Initial dispatch plus one retry total
 *   across script and driver; the script's internal retry consumes it.
 * - Verified quota / admission holds are WAIT, not a code defect and not a decision.
 * - Deduplicate by invocation identity, not by verdict file count. The installed script's
 *   own counter is tracked separately and never rewritten.
 * - An introduced defect must be fixed within scope or reverted; never deferred as a nit.
 */
import { MAX_NO_VERDICT_RETRIES, MAX_SUBSTANTIVE_REVIEW_DECISIONS, type ReviewInvocation, type ReviewLedger, type Verdict } from './types.ts';

export type ReviewOutcomeClass = 'pass' | 'block-defect' | 'block-advisory' | 'no-verdict' | 'quota-hold' | 'routed-skip';

export interface ClassifiedVerdict {
  outcome: ReviewOutcomeClass;
  /** True only when a spec-axis block should stop the ship (Tier S with spec block, or required gate block). */
  mergeBlocking: boolean;
  runStatus: Verdict['run_status'];
  reasons: string[];
  stale: boolean;
}

export interface ClassifyOptions {
  /** HEAD sha of the candidate that was supposed to be reviewed. */
  candidateSha?: string;
  /** Project tier of the card; only Tier S spec blocks are merge-blocking in advisory mode. */
  tier?: 'S' | '1' | '0';
  /** ReviewGate 'required' makes every block merge-blocking. */
  gateRequired?: boolean;
  /** Reviewer stdout / stderr, used to detect verified quota holds. */
  rawOutput?: string;
}

const QUOTA_PATTERNS = [/rate[- ]?limit/i, /quota/i, /usage limit/i, /429/, /retry[- ]after/i, /too many requests/i, /capacity/i, /overloaded/i];

export function detectQuotaHold(text: string | undefined): { hold: boolean; retryAfterMs?: number } {
  if (!text) return { hold: false };
  const hold = QUOTA_PATTERNS.some((p) => p.test(text));
  if (!hold) return { hold: false };
  const m = text.match(/retry[- ]after[:=\s]+(\d+)\s*(ms|s|sec|seconds|m|min|minutes)?/i);
  if (m) {
    const n = Number(m[1]);
    const unit = (m[2] ?? 's').toLowerCase();
    const factor = unit.startsWith('ms') ? 1 : unit.startsWith('m') ? 60_000 : 1000;
    return { hold: true, retryAfterMs: n * factor };
  }
  return { hold: true };
}

/** Parse a raw verdict document. Returns undefined when it does not satisfy the enforced field. */
export function parseVerdict(raw: unknown): Verdict | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  if (v['verdict'] !== 'pass' && v['verdict'] !== 'block') return undefined; // case-sensitive enum, like the scaffold
  const reasons = Array.isArray(v['reasons']) ? v['reasons'].filter((r): r is string => typeof r === 'string') : [];
  const out: Verdict = { verdict: v['verdict'], reasons };
  if (typeof v['sha'] === 'string') out.sha = v['sha'];
  if (typeof v['branch'] === 'string') out.branch = v['branch'];
  if (typeof v['run_status'] === 'string' && ['success', 'timeout', 'no_output', 'malformed', 'tool_error'].includes(v['run_status'])) {
    out.run_status = v['run_status'] as Verdict['run_status'];
  }
  const axes = v['axes'];
  if (axes && typeof axes === 'object') {
    const a = axes as Record<string, unknown>;
    const pick = (k: string) => {
      const ax = a[k];
      if (!ax || typeof ax !== 'object') return undefined;
      const av = (ax as Record<string, unknown>)['verdict'];
      if (av !== 'pass' && av !== 'block') return undefined;
      const ar = (ax as Record<string, unknown>)['reasons'];
      return { verdict: av as 'pass' | 'block', reasons: Array.isArray(ar) ? ar.filter((r): r is string => typeof r === 'string') : [] };
    };
    out.axes = { spec: pick('spec'), standards: pick('standards') };
  }
  const rs = v['routed_skip'];
  if (rs && typeof rs === 'object') {
    const r = rs as Record<string, unknown>;
    out.routed_skip = {
      predicate: String(r['predicate'] ?? ''),
      reason: String(r['reason'] ?? ''),
      changed_paths: Array.isArray(r['changed_paths']) ? r['changed_paths'].map(String) : [],
    };
  }
  return out;
}

export function classifyVerdict(verdict: Verdict | undefined, options: ClassifyOptions = {}): ClassifiedVerdict {
  const quota = detectQuotaHold(options.rawOutput);
  if (!verdict) {
    if (quota.hold) return { outcome: 'quota-hold', mergeBlocking: false, runStatus: 'tool_error', reasons: ['verified reviewer admission/quota hold'], stale: false };
    return { outcome: 'no-verdict', mergeBlocking: false, runStatus: 'malformed', reasons: ['missing or malformed verdict; never pass'], stale: false };
  }
  const stale = Boolean(options.candidateSha && verdict.sha && verdict.sha !== options.candidateSha);
  if (stale) return { outcome: 'no-verdict', mergeBlocking: false, runStatus: verdict.run_status ?? 'no_output', reasons: ['stale verdict sha'], stale: true };
  if (verdict.run_status && verdict.run_status !== 'success') {
    if (quota.hold || verdict.run_status === 'timeout') {
      // A timeout may be a quota-exhausted reviewer; the scaffold cannot tell them apart.
      return { outcome: quota.hold ? 'quota-hold' : 'no-verdict', mergeBlocking: false, runStatus: verdict.run_status, reasons: verdict.reasons, stale: false };
    }
    return { outcome: 'no-verdict', mergeBlocking: false, runStatus: verdict.run_status, reasons: verdict.reasons, stale: false };
  }
  if (verdict.routed_skip) return { outcome: 'routed-skip', mergeBlocking: false, runStatus: 'success', reasons: [verdict.routed_skip.reason], stale: false };
  if (verdict.verdict === 'pass') return { outcome: 'pass', mergeBlocking: false, runStatus: 'success', reasons: [], stale: false };
  const specBlock = verdict.axes?.spec?.verdict === 'block' || (!verdict.axes && verdict.verdict === 'block');
  const mergeBlocking = Boolean(options.gateRequired) || (specBlock && (options.tier === undefined || options.tier === 'S'));
  return {
    outcome: mergeBlocking ? 'block-defect' : 'block-advisory',
    mergeBlocking,
    runStatus: 'success',
    reasons: verdict.reasons,
    stale: false,
  };
}

export type LedgerDecision =
  | { action: 'proceed-merge' }
  | { action: 'review-fix'; remainingDecisions: number }
  | { action: 'retry-review'; retriesLeft: number }
  | { action: 'wait-quota'; retryAfterMs?: number }
  | { action: 'stop-review'; detail: string };

/** Record one reviewer invocation outcome in the ledger and decide the next action. */
export function recordReviewOutcome(
  ledger: ReviewLedger,
  invocation: Omit<ReviewInvocation, 'outcome' | 'runStatus'>,
  classified: ClassifiedVerdict,
  verdict: Verdict | undefined,
  scriptCounterDelta = 0,
): { ledger: ReviewLedger; decision: LedgerDecision } {
  if (ledger.invocations.some((i) => i.invocationId === invocation.invocationId)) {
    // Duplicate by invocation identity: idempotent replay; return the existing decision.
    return { ledger, decision: decideFromLedger(ledger, classified) };
  }
  const record: ReviewInvocation = {
    ...invocation,
    outcome:
      classified.outcome === 'pass' || classified.outcome === 'routed-skip'
        ? 'pass'
        : classified.outcome === 'block-defect' || classified.outcome === 'block-advisory'
          ? 'block'
          : classified.outcome === 'quota-hold'
            ? 'quota-hold'
            : 'no-verdict',
    runStatus: classified.runStatus,
  };
  const next: ReviewLedger = {
    ...ledger,
    invocations: [...ledger.invocations, record],
    scriptCounter: ledger.scriptCounter + scriptCounterDelta,
    lastVerdict: verdict ?? ledger.lastVerdict,
  };
  // A fresh pass for a candidate that already passed (CI rerun on the same digest) is the same decision, not a new one.
  const repeatedPass = record.outcome === 'pass' && ledger.invocations.some((i) => i.candidateDigest === invocation.candidateDigest && i.outcome === 'pass');
  const substantive = !repeatedPass && (classified.outcome === 'pass' || classified.outcome === 'block-defect' || classified.outcome === 'block-advisory');
  if (substantive) {
    next.substantiveDecisions = ledger.substantiveDecisions + 1;
    if (classified.outcome === 'block-defect') next.substantiveBlocks = ledger.substantiveBlocks + 1;
  }
  if (classified.outcome === 'no-verdict') next.noVerdictRetriesUsed = ledger.noVerdictRetriesUsed + 1;
  return { ledger: next, decision: decideFromLedger(next, classified) };
}

function decideFromLedger(ledger: ReviewLedger, classified: ClassifiedVerdict): LedgerDecision {
  switch (classified.outcome) {
    case 'pass':
    case 'routed-skip':
    case 'block-advisory':
      return { action: 'proceed-merge' };
    case 'quota-hold':
      return { action: 'wait-quota' };
    case 'no-verdict': {
      // The first no-verdict counts as the dispatch; one retry total across script and driver.
      const retriesLeft = MAX_NO_VERDICT_RETRIES + 1 - ledger.noVerdictRetriesUsed;
      if (retriesLeft > 0) return { action: 'retry-review', retriesLeft };
      return { action: 'stop-review', detail: 'no verdict after initial dispatch plus one retry; preserve raw evidence' };
    }
    case 'block-defect': {
      if (ledger.substantiveBlocks >= 2) return { action: 'stop-review', detail: 'second substantive block' };
      if (ledger.substantiveDecisions >= MAX_SUBSTANTIVE_REVIEW_DECISIONS) {
        return { action: 'stop-review', detail: 'a further required review exceeds the two-decision allowance' };
      }
      return { action: 'review-fix', remainingDecisions: MAX_SUBSTANTIVE_REVIEW_DECISIONS - ledger.substantiveDecisions };
    }
    default:
      return { action: 'stop-review', detail: 'unclassified review outcome' };
  }
}

/** Dedupe key for shared review admission (MS3). */
export function reviewRequestKey(parts: { repository: string; candidateDigest: string; base: string; policyVersion: string; reviewer: string }): string {
  return [parts.repository, parts.candidateDigest, parts.base, parts.policyVersion, parts.reviewer].map((p) => p.trim().toLowerCase()).join('|');
}

/** A finding disposition marker stable across replays (used for idempotent issue creation). */
export function findingMarker(cardId: string, prNumber: number | undefined, sha: string, reason: string): string {
  const slug = reason
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  return `aidlc-finding:${cardId}:${prNumber ?? 'nopr'}:${sha.slice(0, 12)}:${slug}`;
}
