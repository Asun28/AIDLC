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
import { MAX_NO_VERDICT_RETRIES, MAX_SUBSTANTIVE_REVIEW_DECISIONS, type FindingDisposition, type FindingStage, type ReviewFinding, type ReviewInvocation, type ReviewLedger, type Verdict } from './types.ts';

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

// ---------------------------------------------------------------------------
// Review findings: identity, dispositions, re-raises (T1-REVIEW-FINDINGS)
// ---------------------------------------------------------------------------

/** `re:F<n>` (a space after the colon is accepted) anywhere in a reason names the prior finding it re-raises. */
const FINDING_REFERENCE = /\bre:\s?(F\d+)\b/i;

/** `@ <path>[:line[-line]]`: the path is any run of non-space characters (dot-leading and non-ASCII included) up to an optional `:line`. */
export const FINDING_LOCATION = /@\s*([^\s@:]+)(?::\d+(?:-\d+)?)?/u;

export function findingReference(reason: string): string | undefined {
  const m = FINDING_REFERENCE.exec(reason);
  return m ? m[1]!.toUpperCase() : undefined;
}

/** The changed file a reason cites, normalised to posix separators without a leading `./`. */
export function findingLocation(reason: string): string | undefined {
  const m = FINDING_LOCATION.exec(reason);
  if (!m) return undefined;
  const file = m[1]!.replace(/\\/g, '/').replace(/^\.\//, '');
  return /[\p{L}\p{N}]/u.test(file) ? file : undefined;
}

export interface RecordFindingsInput {
  stage: FindingStage;
  cycle?: number;
  round: number;
  candidateSha?: string;
  at: string;
  /** A decided outcome (pass or block) resolves the stage's open findings the round did not re-raise; anything else records nothing. */
  outcome: 'pass' | 'block' | 'no-verdict' | 'quota-hold';
  /** The cited block reasons, as the aggregated verdict carries them (a panel tags each with ` (<perspective>)`). */
  reasons: string[];
  /** Panel angle names: a trailing `(<name>)` on a reason is the angle that raised it. */
  perspectives?: string[];
  /** The block was advisory (never a merge bar): its findings are recorded and marked, the ship proceeds. */
  advisory?: boolean;
  /**
   * The findings as the reviewer received them at dispatch (id -> disposition and dispute count). A re-raise
   * answered a dispute only when the dispatched snapshot showed it disputed; a finding absent from the
   * snapshot was raised after dispatch and is never resolved by this round; a finding whose disposition or
   * dispute count changed after dispatch keeps that later change (the round neither resets nor resolves it).
   * Absent = the current findings are the snapshot.
   */
  seen?: Record<string, FindingSnapshot>;
}

/** One finding as a reviewer received it at dispatch. */
export interface FindingSnapshot {
  disposition: FindingDisposition;
  disputes: number;
}

export function snapshotFindings(findings: ReviewFinding[]): Record<string, FindingSnapshot> {
  return Object.fromEntries(findings.filter((f) => !f.resolvedAt).map((f) => [f.id, { disposition: f.disposition, disputes: f.disputes.length }]));
}

export interface RecordFindingsResult {
  findings: ReviewFinding[];
  /** Ids of the new findings, in reason order. */
  raised: string[];
  /** Ids of the prior findings this round re-raised. */
  reraised: string[];
  /** Ids resolved by this round (same stage, open or disputed, not re-raised). */
  resolved: string[];
}

const nextFindingId = (findings: ReviewFinding[]): string => `F${findings.reduce((n, f) => Math.max(n, Number(f.id.slice(1)) || 0), 0) + 1}`;

/**
 * Record the findings of one round or decision. Each cited reason without a known `re:F<n>` reference
 * becomes a new finding; a reason that references a prior finding is a re-raise of it (the finding
 * returns to open, the dispute history stays). A decided round resolves the stage's other open or
 * disputed findings. Rounds without a verdict change nothing.
 */
export function recordFindings(findings: ReviewFinding[], input: RecordFindingsInput): RecordFindingsResult {
  if (input.outcome !== 'pass' && input.outcome !== 'block') return { findings, raised: [], reraised: [], resolved: [] };
  // References resolve against the findings that existed before this round, never against ids this round allocates.
  const known = new Set(findings.map((f) => f.id));
  const seen = input.seen ?? snapshotFindings(findings);
  // A finding changed after dispatch (a dispute recorded or withdrawn meanwhile) keeps that change: the round never saw it.
  const changedSince = (f: ReviewFinding) => !(f.id in seen) || seen[f.id]!.disposition !== f.disposition || seen[f.id]!.disputes !== f.disputes.length;
  const perspectiveOf = (reason: string) => input.perspectives?.find((p) => reason.trimEnd().endsWith(`(${p})`));
  let next = findings.map((f) => ({ ...f }));
  const raised: string[] = [];
  const reraised: string[] = [];
  for (const reason of input.reasons) {
    const ref = findingReference(reason);
    if (ref && known.has(ref)) {
      const prior = next.find((f) => f.id === ref)!;
      if (!reraised.includes(prior.id)) reraised.push(prior.id);
      // Every re-raise reason is kept with its angle; whether the round answered a dispute is read from the dispatched snapshot.
      prior.reraised = [...prior.reraised, { stage: input.stage, cycle: input.cycle, round: input.round, candidateSha: input.candidateSha, at: input.at, reason, perspective: perspectiveOf(reason), answeredDispute: seen[prior.id]?.disposition === 'disputed' }];
      if (!changedSince(findings.find((f) => f.id === ref)!)) {
        prior.disposition = 'open';
        prior.resolvedAt = undefined;
      }
      continue;
    }
    const id = nextFindingId(next);
    const finding: ReviewFinding = { id, stage: input.stage, cycle: input.cycle, round: input.round, perspective: perspectiveOf(reason), reason, file: findingLocation(reason), candidateSha: input.candidateSha, raisedAt: input.at, disposition: 'open', disputes: [], reraised: [] };
    if (input.advisory) finding.advisory = true;
    next = [...next, finding];
    raised.push(id);
  }
  const resolved: string[] = [];
  for (const f of next) {
    // Only findings the reviewer received, unchanged since, can be resolved by its verdict; one raised or disputed meanwhile stays as it is.
    if (f.stage !== input.stage || f.resolvedAt || raised.includes(f.id) || reraised.includes(f.id) || changedSince(findings.find((x) => x.id === f.id)!)) continue;
    f.resolvedAt = input.at;
    resolved.push(f.id);
  }
  return { findings: next, raised, reraised, resolved };
}

const findingOrThrow = (findings: ReviewFinding[], id: string): ReviewFinding => {
  const f = findings.find((x) => x.id === id.toUpperCase());
  if (!f) throw new Error(`no finding ${id} on this card run (aidlc review findings <card> lists them)`);
  return f;
};

/** Rounds of mutual non-acceptance: distinct rounds whose re-raise answered a dispute (a withdrawn dispute never reached a reviewer). */
export function nonAcceptanceRounds(f: ReviewFinding): number {
  return new Set(f.reraised.filter((r) => r.answeredDispute).map((r) => `${r.stage}:${r.cycle ?? 0}:${r.round}`)).size;
}

/** Findings disputed twice and re-raised twice: two rounds of mutual non-acceptance, a human ruling. */
export function deadlockedFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return findings.filter((f) => nonAcceptanceRounds(f) >= 2);
}

/** Findings re-raised after a dispute at least once. */
export function contestedFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return findings.filter((f) => nonAcceptanceRounds(f) >= 1);
}

const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

/** One sentence naming the deadlocked findings, empty when there are none. */
export function describeDeadlock(findings: ReviewFinding[]): string {
  const dead = deadlockedFindings(findings);
  if (!dead.length) return '';
  return `deadlock: ${dead.map((f) => `${f.id} (${f.reason}) disputed ${times(nonAcceptanceRounds(f))} and re-raised ${times(nonAcceptanceRounds(f))}`).join('; ')}; human ruling needed`;
}

/** One sentence naming the findings re-raised after a dispute, empty when there are none. */
export function describeContested(findings: ReviewFinding[]): string {
  const contested = contestedFindings(findings);
  if (!contested.length) return '';
  return contested.map((f) => `${f.id} re-raised after the author's dispute (${f.reason})`).join('; ');
}

/**
 * The author disputes an open finding with a note. A second dispute needs a re-raise in between; a
 * finding disputed twice and re-raised twice is a deadlock that only a human ruling settles.
 */
export function disputeFinding(findings: ReviewFinding[], id: string, note: string, at: string): ReviewFinding[] {
  const f = findingOrThrow(findings, id);
  if (!note.trim()) throw new Error(`a dispute needs a note: why ${f.id} does not hold`);
  if (f.resolvedAt) throw new Error(`${f.id} is resolved (no later round re-raised it); nothing to dispute`);
  if (f.disposition === 'disputed') throw new Error(`${f.id} is already disputed; wait for the next round to answer it`);
  if (nonAcceptanceRounds(f) >= 2) throw new Error(`${f.id} was disputed twice and re-raised twice: a human ruling is needed, not a third dispute`);
  // One dispute per re-raise, a withdrawn one included: the next dispute waits for a reviewer to re-raise the finding.
  const last = f.disputes.at(-1);
  if (last && f.reraised.length <= last.afterReraises) throw new Error(`${f.id} was already disputed since the last re-raise (a withdrawn dispute counts); a second dispute needs a re-raise in between`);
  return findings.map((x) => (x.id === f.id ? { ...x, disposition: 'disputed' as const, disputes: [...x.disputes, { at, note: note.trim(), afterReraises: x.reraised.length }] } : x));
}

/** The author withdraws a dispute: the finding returns to open; the note stays in the history. */
export function acceptFinding(findings: ReviewFinding[], id: string): ReviewFinding[] {
  const f = findingOrThrow(findings, id);
  if (f.resolvedAt) throw new Error(`${f.id} is resolved (no later round re-raised it); nothing to withdraw`);
  if (f.disposition !== 'disputed') throw new Error(`${f.id} is not disputed; nothing to withdraw`);
  return findings.map((x) => (x.id === f.id ? { ...x, disposition: 'open' as const } : x));
}

/** The findings a pre-review round raised or re-raised (rounds are numbered per cycle). */
export function findingsOfRound(findings: ReviewFinding[], round: { stage: FindingStage; cycle?: number; round: number }): ReviewFinding[] {
  const inRound = (stage: FindingStage, cycle: number | undefined, n: number) => stage === round.stage && n === round.round && (stage === 'formal' || (cycle ?? 0) === (round.cycle ?? 0));
  return findings.filter((f) => inRound(f.stage, f.cycle, f.round) || f.reraised.some((r) => inRound(r.stage, r.cycle, r.round)));
}

/** The findings a stage raised or re-raised on one candidate; the formal stage is keyed this way, never by a run-wide decision counter. */
export function findingsOfCandidate(findings: ReviewFinding[], stage: FindingStage, candidateSha: string): ReviewFinding[] {
  return findings.filter((f) => (f.stage === stage && f.candidateSha === candidateSha) || f.reraised.some((r) => r.stage === stage && r.candidateSha === candidateSha));
}

/** A pre-review round (cycle + round) or the formal decisions on one candidate. */
export type BlockSelector = { stage: 'pre'; cycle?: number; round: number } | { stage: 'formal'; candidateSha: string };

/** The findings a block raised or re-raised, by selector. */
export function findingsOfBlock(findings: ReviewFinding[], block: BlockSelector): ReviewFinding[] {
  return block.stage === 'pre' ? findingsOfRound(findings, block) : findingsOfCandidate(findings, 'formal', block.candidateSha);
}

/**
 * Same-candidate rule: a candidate that a round blocked is re-reviewed unchanged only when every finding
 * of that block is disputed, so the reviewer receives new information and never the same snapshot twice.
 */
export function rerunAllowed(findings: ReviewFinding[], block: BlockSelector): { allowed: boolean; open: string[] } {
  const open = findingsOfBlock(findings, block)
    .filter((f) => f.disposition !== 'disputed' && !f.resolvedAt)
    .map((f) => f.id);
  return { allowed: open.length === 0, open };
}
