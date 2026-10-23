/**
 * Review policy (plan v5 §5 "Build, review and retries", R20-R25).
 *
 * - Substantive allowance: an initial decision plus one subsequent decision for a repaired
 *   candidate. With a command reviewer (card T1-EFF-R3-PROGRESS) a block from decision 2 on is
 *   STOP/review only when it re-raises an unresolved finding the author disputed or an earlier R3
 *   decision raised, or as the fourth decision (MAX_R3_DECISIONS); a block of new findings gets
 *   another repair round. A ship-path reviewer keeps the second-block stop. A required review
 *   beyond the allowance is STOP/review.
 * - Missing / malformed / stale verdicts never pass. Initial dispatch plus one retry total
 *   across script and driver; the script's internal retry consumes it.
 * - Verified quota / admission holds are WAIT, not a code defect and not a decision.
 * - Deduplicate by invocation identity, not by verdict file count. The installed script's
 *   own counter is tracked separately and never rewritten.
 * - An introduced defect must be fixed within scope or reverted; never deferred as a nit.
 */
import { detectQuotaHold, quotaOutput } from './parse-guard.ts';
import { FINDING_CLASS_MAX, FINDING_CLASS_PATTERN, MAX_NO_VERDICT_RETRIES, MAX_R3_DECISIONS, MAX_SUBSTANTIVE_REVIEW_DECISIONS, type FindingDisposition, type FindingStage, type ReviewFinding, type ReviewInvocation, type ReviewLedger, type Verdict } from './types.ts';

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
  /** The receipt of the reviewer process, read for a verified quota hold by the stream rule of `quotaOutput`. */
  receipt?: { exitCode: number | null; stdout: string; stderr: string };
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
  const quota = detectQuotaHold(options.receipt && quotaOutput(options.receipt));
  const held = `via ${quota.via}: ${quota.evidence}`;
  if (!verdict) {
    if (quota.hold) return { outcome: 'quota-hold', mergeBlocking: false, runStatus: 'tool_error', reasons: ['verified reviewer admission/quota hold', held], stale: false };
    return { outcome: 'no-verdict', mergeBlocking: false, runStatus: 'malformed', reasons: ['missing or malformed verdict; never pass'], stale: false };
  }
  const stale = Boolean(options.candidateSha && verdict.sha && verdict.sha !== options.candidateSha);
  if (stale) return { outcome: 'no-verdict', mergeBlocking: false, runStatus: verdict.run_status ?? 'no_output', reasons: ['stale verdict sha'], stale: true };
  if (verdict.run_status && verdict.run_status !== 'success') return { outcome: quota.hold ? 'quota-hold' : 'no-verdict', mergeBlocking: false, runStatus: verdict.run_status, reasons: quota.hold ? [...verdict.reasons, held] : verdict.reasons, stale: false };
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

/**
 * Record one reviewer invocation outcome in the ledger and decide the next action. `repeated` is a command reviewer's
 * list of the findings this decision re-raises (`repeatedFindings`, card T1-EFF-R3-PROGRESS); absent for a ship-path
 * reviewer and a base-sync decision, which keep the second-block stop.
 */
export function recordReviewOutcome(
  ledger: ReviewLedger,
  invocation: Omit<ReviewInvocation, 'outcome' | 'runStatus'>,
  classified: ClassifiedVerdict,
  verdict: Verdict | undefined,
  scriptCounterDelta = 0,
  repeated?: string[],
): { ledger: ReviewLedger; decision: LedgerDecision } {
  const existing = ledger.invocations.find((i) => i.invocationId === invocation.invocationId);
  if (existing) {
    // Duplicate by invocation identity: idempotent replay; a recorded stop is returned as it was recorded.
    return { ledger, decision: existing.stopReview ? { action: 'stop-review', detail: existing.stopReview } : decideFromLedger(ledger, classified, repeated, invocation.decision) };
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
  const decision = decideFromLedger(next, classified, repeated, record.decision);
  // A stopping decision records its detail, so a commit that only lands as history (a newer candidate superseded it) still
  // stops the card with that detail at the next assessment, and admission refuses another decision (card T1-EFF-R3-PROGRESS-2).
  if (decision.action === 'stop-review') {
    const stopReview = decision.detail;
    next.invocations = next.invocations.map((i) => (i === record ? { ...record, stopReview } : i));
  }
  return { ledger: next, decision };
}

const ORDINALS = ['first', 'second', 'third', 'fourth'];
const ordinal = (n: number): string => ORDINALS[n - 1] ?? `${n}th`;

function decideFromLedger(ledger: ReviewLedger, classified: ClassifiedVerdict, repeated?: string[], dispatched?: number): LedgerDecision {
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
      if (repeated) {
        // A command reviewer (card T1-EFF-R3-PROGRESS): from decision 2 on, a re-raised unresolved finding is the
        // maker/checker deadlock and stops for a ruling; a block of only new findings is progress and gets another repair
        // round, up to the fourth decision. The repeat is judged at the decision number the reviewer was dispatched with and
        // the cap at the decisions recorded (card T1-EFF-R3-PROGRESS-2).
        if ((dispatched ?? ledger.substantiveDecisions) >= 2 && repeated.length) {
          return { action: 'stop-review', detail: `${ordinal(ledger.substantiveBlocks)} substantive block re-raised unresolved finding(s) ${repeated.join(', ')}` };
        }
        if (ledger.substantiveDecisions >= MAX_R3_DECISIONS) {
          return { action: 'stop-review', detail: `${ordinal(ledger.substantiveDecisions)} decision blocked: the ${MAX_R3_DECISIONS}-decision allowance for repairs is used` };
        }
        return { action: 'review-fix', remainingDecisions: MAX_R3_DECISIONS - ledger.substantiveDecisions };
      }
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

/**
 * A reason tagged `[question]` or `[suggestion]` is advisory in both stages: never a block, whatever else it carries (R10). The
 * tag counts only where the output contract puts it: opening the reason (after the axis tag if any), or opening the text after
 * the `@ <file:line>:` location. A path or prose that merely contains the bracket text is no tag, so a cited block is never
 * downgraded by its wording.
 */
export const ADVISORY_TAG = /^\s*(?:\[(?:spec|standards)\]\s*)?(?:[^@\n]*?@\s*[^\s@:]+(?::\d+(?:-\d+)?)?\s*:\s*)?\[(?:question|suggestion)\]/i;

/** `(class: <slug>)` anywhere in a reason, the keyword in any case with at most one space after the colon; the first group decides. */
const FINDING_CLASS_TAG = /\(class: ?([^)]*)\)/i;

/** The defect class a reason names (card T1-REVIEW-CLASS-SWEEP); a malformed slug names none, and a `[question]` or `[suggestion]` reason carries none. */
export function findingClass(reason: string): string | undefined {
  if (ADVISORY_TAG.test(reason)) return undefined;
  const slug = FINDING_CLASS_TAG.exec(reason)?.[1];
  return slug !== undefined && slug.length <= FINDING_CLASS_MAX && FINDING_CLASS_PATTERN.test(slug) ? slug : undefined;
}

/** The `file:line` a reason cites: the normalised file of `findingLocation` with the line range the reason gives. */
function findingSite(reason: string): string | undefined {
  const file = findingLocation(reason);
  const m = FINDING_LOCATION.exec(reason);
  return file && m ? file + m[0].slice(m[0].indexOf(m[1]!) + m[1]!.length) : undefined;
}

/** One defect class of a block: the ids of its open findings and the sites they cite. */
export interface BlockClass {
  class: string;
  ids: string[];
  sites: string[];
}

/**
 * The classes of a block's findings (`findingsOfBlock`), in first-raised order: each open finding with a class adds its id
 * and every site its raising and re-raise reasons cite, once each. A disputed, resolved, advisory (never a merge bar) or
 * class-less finding adds nothing.
 */
export function blockClasses(findings: ReviewFinding[]): BlockClass[] {
  const out: BlockClass[] = [];
  for (const f of findings) {
    if (!f.class || f.advisory || f.disposition === 'disputed' || f.resolvedAt) continue;
    let entry = out.find((c) => c.class === f.class);
    if (!entry) out.push((entry = { class: f.class, ids: [], sites: [] }));
    entry.ids.push(f.id);
    for (const reason of [f.reason, ...f.reraised.map((r) => r.reason)]) {
      const site = findingSite(reason);
      if (site && !entry.sites.includes(site)) entry.sites.push(site);
    }
  }
  return out;
}

/** The text a formal repair narration appends for the classes of its block (R11); empty for a block without a class. */
export function classRepairText(classes: BlockClass[]): string {
  if (!classes.length) return '';
  const list = classes.map((c) => `${c.class} (${c.ids.join(', ')}${c.sites.length ? ` at ${c.sites.join(', ')}` : ''})`).join('; ');
  return ` Defect classes of this block: ${list}. Fix every site of each class inside the card's allow_paths, not only the cited lines; leave a site outside allow_paths unchanged and dispute a re-raise that cites one.`;
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
   * The findings as the reviewer received them at dispatch (id -> disposition, dispute count, revision). A
   * re-raise answered the dispute the snapshot showed; a finding absent from the snapshot was raised after
   * dispatch and is never resolved by this round; a finding whose revision moved after dispatch keeps that
   * later change (the round neither resets nor resolves it). Absent = the current findings are the snapshot;
   * an empty object = the reviewer received no findings (a ship-path reviewer).
   */
  seen?: Record<string, FindingSnapshot>;
  /** The angle that wrote each reason, from the structured panel result; takes precedence over a trailing `(<angle>)` tag. */
  perspectiveByReason?: Record<string, string>;
  /** Paths of the delta since the candidate the stage last reviewed (empty when the candidate is unchanged); absent on a first round. A new finding citing a file outside it is a first-round miss. */
  deltaPaths?: string[];
}

/** One finding as a reviewer received it at dispatch. */
export interface FindingSnapshot {
  disposition: FindingDisposition;
  disputes: number;
  revision: number;
  resolved: boolean;
}

/** Every finding of the run as a reviewer receives it, resolved ones included (a re-raise may reopen them). */
export function snapshotFindings(findings: ReviewFinding[]): Record<string, FindingSnapshot> {
  return Object.fromEntries(findings.map((f) => [f.id, { disposition: f.disposition, disputes: f.disputes.length, revision: f.revision, resolved: Boolean(f.resolvedAt) }]));
}

/** Ordering of rounds within a stage: pre-review rounds by (cycle, round), formal decisions by number. */
function roundKey(stage: FindingStage, cycle: number | undefined, round: number): number {
  return stage === 'pre' ? (cycle ?? 0) * 1_000_000 + round : round;
}

/** The latest round of `stage` that raised or re-raised the finding. */
function lastRoundOf(f: ReviewFinding, stage: FindingStage): number {
  const keys = [...(f.stage === stage ? [roundKey(stage, f.cycle, f.round)] : []), ...f.reraised.filter((r) => r.stage === stage).map((r) => roundKey(stage, r.cycle, r.round))];
  return keys.length ? Math.max(...keys) : -1;
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
 * returns to open unless it changed after dispatch; the dispute history stays). A decided round resolves
 * the stage's other open or disputed findings it received, unchanged since. Rounds without a verdict
 * change nothing.
 */
export function recordFindings(findings: ReviewFinding[], input: RecordFindingsInput): RecordFindingsResult {
  if (input.outcome !== 'pass' && input.outcome !== 'block') return { findings, raised: [], reraised: [], resolved: [] };
  // References resolve against the findings the reviewer received (the dispatched snapshot), never against ids this
  // round allocates nor against findings added while it was in flight.
  const seen = input.seen ?? snapshotFindings(findings);
  const known = new Set(Object.keys(seen).filter((id) => findings.some((f) => f.id === id)));
  // A finding whose revision moved after dispatch (a dispute recorded or withdrawn, another round's re-raise) keeps that change: this round never saw it.
  const changedSince = (f: ReviewFinding) => !(f.id in seen) || seen[f.id]!.revision !== f.revision;
  const perspectiveOf = (reason: string) => input.perspectiveByReason?.[reason] ?? input.perspectives?.find((p) => reason.trimEnd().endsWith(`(${p})`));
  const thisRound = roundKey(input.stage, input.cycle, input.round);
  let next = findings.map((f) => ({ ...f }));
  const raised: string[] = [];
  const reraised: string[] = [];
  for (const reason of input.reasons) {
    const ref = findingReference(reason);
    if (ref && known.has(ref)) {
      const before = findings.find((f) => f.id === ref)!;
      const prior = next.find((f) => f.id === ref)!;
      if (!reraised.includes(prior.id)) reraised.push(prior.id);
      // Every re-raise reason is kept with its angle; the dispute it answered is the one the dispatched snapshot showed.
      const received = seen[prior.id];
      prior.reraised = [...prior.reraised, { stage: input.stage, cycle: input.cycle, round: input.round, candidateSha: input.candidateSha, at: input.at, reason, perspective: perspectiveOf(reason), answeredDispute: received?.disposition === 'disputed' && received.disputes > 0 ? received.disputes - 1 : undefined, sawDisputes: received?.disputes ?? 0 }];
      // A re-raise reopens the finding (a resolved one included) unless it changed after dispatch.
      if (!changedSince(before)) {
        prior.disposition = 'open';
        prior.resolvedAt = undefined;
      }
      prior.revision = before.revision + 1;
      // A tagged re-raise names the class of a finding that has none; an existing class is never replaced.
      const cls = findingClass(reason);
      if (cls && !prior.class) prior.class = cls;
      continue;
    }
    const id = nextFindingId(next);
    const finding: ReviewFinding = { id, stage: input.stage, cycle: input.cycle, round: input.round, perspective: perspectiveOf(reason), reason, file: findingLocation(reason), candidateSha: input.candidateSha, raisedAt: input.at, disposition: 'open', disputes: [], reraised: [], revision: 0 };
    const cls = findingClass(reason);
    if (cls) finding.class = cls;
    if (input.advisory) finding.advisory = true;
    if (input.deltaPaths && (!finding.file || !input.deltaPaths.includes(finding.file))) finding.outsideDelta = true;
    next = [...next, finding];
    raised.push(id);
  }
  const resolved: string[] = [];
  for (const f of next) {
    // The stage owns a finding it raised or re-raised: an R2 finding re-raised by R3 decision 1 is R3's to resolve at decision 2.
    const ofStage = f.stage === input.stage || f.reraised.some((r) => r.stage === input.stage);
    if (!ofStage || f.resolvedAt || raised.includes(f.id) || reraised.includes(f.id)) continue;
    const before = findings.find((x) => x.id === f.id)!;
    // Only a finding the reviewer received, unchanged since, and raised or re-raised in a strictly earlier round of the stage is resolved.
    if (changedSince(before) || lastRoundOf(before, input.stage) >= thisRound) continue;
    f.resolvedAt = input.at;
    f.revision = before.revision + 1;
    resolved.push(f.id);
  }
  return { findings: next, raised, reraised, resolved };
}

/**
 * The findings a re-raise by R3 `decision` repeats, fixed at dispatch from the record locked at reservation (cards
 * T1-EFF-R3-PROGRESS, T1-EFF-R3-PROGRESS-2): the findings its reviewer received that are disputed and unresolved in that
 * snapshot, or held by R3, raised or re-raised by the previous R3 decision. Re-raising one is the repeat that stops R3 for a
 * ruling, the maker/checker deadlock. A finding an earlier R3 decision left out was accepted by R3, so its return is a
 * regression with a repair round, not a repeat; an R2 finding the author never disputed and R3 never raised is not a repeat
 * either, since with one R2 round per cycle R2's findings reach R3 unrepaired. An R2 pass resolving a finding R3 holds does
 * not end R3's hold. Nothing recorded after the dispatch changes the set.
 */
export function heldFindings(findings: ReviewFinding[], seen: Record<string, FindingSnapshot>, decision: number): string[] {
  return findings
    .filter((f) => {
      const received = seen[f.id];
      if (!received) return false;
      const disputed = received.disposition === 'disputed' && !received.resolved;
      const lastByR3 = Math.max(f.stage === 'formal' ? f.round : 0, ...f.reraised.filter((r) => r.stage === 'formal').map((r) => r.round));
      return disputed || (lastByR3 > 0 && lastByR3 >= decision - 1);
    })
    .map((f) => f.id);
}

/** The held findings a decision's cited reasons re-raise (`re:F<n>`, resolved as `recordFindings` resolves it), once each, in reason order. */
export function repeatedFindings(reasons: string[], held: string[]): string[] {
  const out: string[] = [];
  for (const reason of reasons) {
    const ref = findingReference(reason);
    if (ref && held.includes(ref) && !out.includes(ref)) out.push(ref);
  }
  return out;
}

const findingOrThrow = (findings: ReviewFinding[], id: string): ReviewFinding => {
  const f = findings.find((x) => x.id === id.toUpperCase());
  if (!f) throw new Error(`no finding ${id} on this card run (aidlc review findings <card> lists them)`);
  return f;
};

/**
 * Whether a re-raise recorded since the latest dispute came from a round that received every dispute of the finding
 * so far (`afterReraises` on the dispute marks where those re-raises start). A later re-raise from a round that
 * received none, completing late, never revokes it.
 */
function receivedEveryDispute(f: ReviewFinding): boolean {
  const since = f.disputes.at(-1)?.afterReraises ?? 0;
  return f.reraised.slice(since).some((r) => (r.sawDisputes ?? (r.answeredDispute !== undefined ? r.answeredDispute + 1 : 0)) >= f.disputes.length);
}

/** Rounds of mutual non-acceptance: distinct disputes a reviewer received and answered with a re-raise (a withdrawn dispute never reached a reviewer). */
export function nonAcceptanceRounds(f: ReviewFinding): number {
  return new Set(f.reraised.map((r) => r.answeredDispute).filter((i): i is number => i !== undefined)).size;
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
  // One dispute per re-raise that received the previous one, a withdrawn dispute included: the next dispute waits for a
  // reviewer who received every dispute so far to re-raise the finding. A re-raise by a round dispatched before the
  // dispute received none of it and opens no second dispute.
  if (f.disputes.length && !receivedEveryDispute(f)) throw new Error(`${f.id} was already disputed since the last re-raise that received it (a withdrawn dispute counts); a second dispute needs a re-raise in between`);
  return findings.map((x) => (x.id === f.id ? { ...x, disposition: 'disputed' as const, disputes: [...x.disputes, { at, note: note.trim(), afterReraises: x.reraised.length }], revision: x.revision + 1 } : x));
}

/** The author withdraws a dispute: the finding returns to open; the note stays in the history. */
export function acceptFinding(findings: ReviewFinding[], id: string): ReviewFinding[] {
  const f = findingOrThrow(findings, id);
  if (f.resolvedAt) throw new Error(`${f.id} is resolved (no later round re-raised it); nothing to withdraw`);
  if (f.disposition !== 'disputed') throw new Error(`${f.id} is not disputed; nothing to withdraw`);
  return findings.map((x) => (x.id === f.id ? { ...x, disposition: 'open' as const, revision: x.revision + 1 } : x));
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

/** The ledgers of a card run as a stale-write check reads them. */
export interface LedgerView {
  review: ReviewLedger;
  preReview: { rounds: Array<{ reservationId?: string; cycle: number; round: number; requestedAt: string; outcome: string }>; handoffs: Array<{ cycle: number; candidateDigest: string }> };
}

/**
 * Why a write computed from an earlier read of the run is stale: the persisted ledgers carry an entry the writer's
 * copy lacks, an entry the writer still holds as pending that was decided meanwhile (a reservation and its decision
 * share one id), a pending entry the writer holds that the persisted ledgers no longer carry (a reservation released
 * or abandoned meanwhile; a reservation is only ever created by the reservation transaction, never by a snapshot
 * write), or a decision counter the write would regress. The writer re-runs its command on the current record instead
 * of dropping, undoing, resurrecting or overwriting the entry.
 */
export function staleLedger(persisted: LedgerView, mine: LedgerView): string | undefined {
  const roundKeyOf = (r: LedgerView['preReview']['rounds'][number]) => r.reservationId ?? `${r.cycle}:${r.round}:${r.requestedAt}`;
  for (const i of persisted.review.invocations) {
    const m = mine.review.invocations.find((x) => x.invocationId === i.invocationId);
    if (!m) return `review invocation ${i.invocationId}`;
    if (i.outcome !== 'pending' && m.outcome === 'pending') return `the decision of review invocation ${i.invocationId}`;
  }
  for (const r of persisted.preReview.rounds) {
    const m = mine.preReview.rounds.find((x) => roundKeyOf(x) === roundKeyOf(r));
    if (!m) return `pre-review round ${r.cycle}/${r.round} (${roundKeyOf(r)})`;
    if (r.outcome !== 'pending' && m.outcome === 'pending') return `the outcome of pre-review round ${r.cycle}/${r.round} (${roundKeyOf(r)})`;
  }
  const handoff = persisted.preReview.handoffs.find((h) => !mine.preReview.handoffs.some((m) => m.cycle === h.cycle && m.candidateDigest === h.candidateDigest));
  if (handoff) return `residual hand-off of cycle ${handoff.cycle}`;
  const phantomInvocation = mine.review.invocations.find((m) => m.outcome === 'pending' && !persisted.review.invocations.some((i) => i.invocationId === m.invocationId));
  if (phantomInvocation) return `the release of review invocation ${phantomInvocation.invocationId}`;
  const phantomRound = mine.preReview.rounds.find((m) => m.outcome === 'pending' && !persisted.preReview.rounds.some((r) => roundKeyOf(r) === roundKeyOf(m)));
  if (phantomRound) return `the release of pre-review round ${phantomRound.cycle}/${phantomRound.round} (${roundKeyOf(phantomRound)})`;
  for (const counter of ['substantiveDecisions', 'substantiveBlocks', 'noVerdictRetriesUsed'] as const) {
    if (mine.review[counter] < persisted.review[counter]) return `review counter ${counter} (${persisted.review[counter]})`;
  }
  return undefined;
}
