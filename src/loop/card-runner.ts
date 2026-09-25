/**
 * Card runner (plan v5 §5 card states, R14-R27, Q1/Q6/Q7/Q8/Q23).
 *
 * Gathers evidence with probes, selects the card state by precedence, and executes the
 * bounded action the state permits: PREPARE claims the card lease and starts/attaches the
 * worktree; BUILD checks RED/DoD receipts (the agent implements); SHIP runs the single ship
 * path with preserved base/mode and feeds the review/CI ledgers; REVIEW_FIX hands defects
 * back; CLOSE verifies closure predicates; DONE/STOP return. Every attempt is recorded in the
 * effort episode; every external mutation records intent first.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { selectCardState, type CardDecision, type CardEvidence } from '../core/card-machine.ts';
import { checkAdmission } from '../core/deadlines.ts';
import { createEpisode, finishAttempt, nextEffortAction, reopenAfterReviewBlock, startAttempt } from '../core/effort.ts';
import { acceptFinding, classifyVerdict, describeContested, describeDeadlock, disputeFinding, findingsOfBlock, nonAcceptanceRounds, parseVerdict, quotaOutput, recordFindings, recordReviewOutcome, rerunAllowed, reviewRequestKey, snapshotFindings, type BlockSelector, type ClassifiedVerdict, type FindingSnapshot, type LedgerDecision, type RecordFindingsInput, type RecordFindingsResult } from '../core/review-policy.ts';
import { classifyCiFailure, canRerun, recordRerunIntent, reconcileRerun, hasUnreconciledRerun, type RerunDecision } from '../core/ci-policy.ts';
import { makeStop } from '../core/stop.ts';
import { ActorIdentity, CardRun, MAX_NO_VERDICT_RETRIES, MAX_SUBSTANTIVE_REVIEW_DECISIONS, RECONCILE_GRACE_MS, RunStatus, addMs, type BlockedReceipt, type Card, type EffortLevel, type FindingStage, type Goal, type Lease, type PreReviewRound, type ReviewFinding, type ReviewEffortLevel, type ReviewInvocation, type ReviewLedger, type StopRecord, type Verdict } from '../core/types.ts';
import { selectReviewEffortFromDiff } from '../core/review-effort.ts';
import { LeaseStore, FencedError, resourceKeys } from '../coordination/lease.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import { ReviewQueue } from '../coordination/review-queue.ts';
import { GitProbe } from '../probes/git.ts';
import { GhProbe } from '../probes/gh.ts';
import { run, runSync, type Runner, type SyncRunner } from '../probes/exec.ts';
import { decideWorktree } from '../delivery/worktree.ts';
import { appendLesson, formatLesson, hasLesson, lessonFromText, lessonsPath, parseLessonLine, readLessons, reviewLessons, type LessonsContext } from '../artifacts/lessons.ts';
import { classifyShipOutput, DryRunShipPath, ScaffoldShipPath, type ShipPath, type ShipResult } from '../delivery/ship.ts';
import { GitHubShipPath } from '../delivery/github-ship.ts';
import { COVERAGE_ANGLE, buildReviewPrompt, citedReasonsOf, collectCandidateDiff, materialiseVerdictSchema, pathAllowed, policyHash, runReviewPanel, stripAdvisoryTags, type PanelResult, type PriorFinding, type ReviewDelta } from '../review/pre-review.ts';
import { Journal, currentActor } from '../state/journal.ts';
import { GoalStore } from '../state/goal-store.ts';
import { atomicWriteJson } from '../state/store.ts';
import { requireAuthority } from '../core/authorization.ts';
import type { StatePaths, RepoIdentity } from '../state/paths.ts';
import type { FormalReviewConfig, ProjectConfig } from '../config.ts';
import { resolveWorktreeRoot } from '../config.ts';

/** One formal reviewer's settings: the primary `formalReview`, its `fallback` or its `baseSync` reviewer. */
type FormalReviewer = Omit<FormalReviewConfig, 'fallback' | 'baseSync'>;

export interface CardRunnerDeps {
  paths: StatePaths;
  repo: RepoIdentity;
  config: ProjectConfig;
  store?: GoalStore;
  leases?: LeaseStore;
  queue?: ReviewQueue;
  ops?: OperationLedger;
  git?: GitProbe;
  gh?: GhProbe;
  runner?: SyncRunner;
  /** Concurrent runner for review panels; defaults to the async spawn, or wraps `runner` when a scripted one is given. */
  asyncRunner?: Runner;
  shipPath?: ShipPath;
  now?: () => string;
}

export type CardDirective =
  | { kind: 'prepare'; cardId: string; action: 'start' | 'attach'; worktree: string; skills?: string[]; lessons?: LessonsContext; narration: string }
  | { kind: 'build'; cardId: string; worktree: string; tdd: boolean; redReceipt?: string; dodCommand: string; effort: EffortLevel; attempt: number; skills?: string[]; narration: string }
  | { kind: 'ship'; cardId: string; base: string; mode: 'local' | 'remote'; narration: string }
  | { kind: 'review-fix'; cardId: string; reasons: string[]; remainingDecisions: number; narration: string }
  | { kind: 'pre-review'; cardId: string; round: number; maxRounds: number; reviewer: string; narration: string }
  | { kind: 'review'; cardId: string; reviewer: string; decision: number; maxDecisions: number; narration: string }
  | { kind: 'wait'; cardId: string; on: string; pollSeconds: number; narration: string }
  | { kind: 'close'; cardId: string; missing: string[]; narration: string }
  | { kind: 'done'; cardId: string; narration: string }
  | { kind: 'stop'; cardId: string; stop: StopRecord; narration: string };

/** One review result to commit under the card-run lock (`CardRunner.commitReviewed`). */
interface CommitReviewInput {
  /** The candidate the result is bound to; a record whose candidate moved on keeps the result as history only. */
  candidateDigest: string;
  evidence: CardRun['evidence'][number];
  /** Whether the locked record still carries the reservation this result completes. */
  reserved: (latest: CardRun) => boolean;
  /** The locked record without the reservation (a stopped run, a lost lease). */
  release: (latest: CardRun) => CardRun;
  /** The decision computed from the locked record: the findings input, the full commit and the history-only commit. */
  decide: (latest: CardRun) => { findingsInput: RecordFindingsInput; commit: (run: CardRun, found: RecordFindingsResult) => CardRun; history: (run: CardRun, found: RecordFindingsResult) => CardRun };
}

type CommitReviewStatus = 'committed' | 'stopped' | 'abandoned' | 'fenced' | 'superseded';

/** One formal (R3) result to commit: from the reviewer that just ran, or retained by a reservation whose commit did not land. */
interface FormalResult {
  invocationId: string;
  fileStem: string;
  reviewDir: string;
  candidateSha: string;
  candidateDigest: string;
  changedPaths?: string[];
  /** The findings as the reviewer received them at dispatch. */
  seen: Record<string, FindingSnapshot>;
  /** sha256 of the policy text the reviewer received. */
  policyHash?: string;
  /** Paths of the delta since the candidate the stage last reviewed; absent on a first decision. */
  deltaPaths?: string[];
  requestedAt: string;
  at: string;
  verdict?: Verdict;
  classified: ClassifiedVerdict;
  advisory: string[];
  verdictRef?: string;
  logRef?: string;
  durationMs: number;
  receiptSha256: string;
  holdUntil?: string;
  /** The reviewer that ran: the primary or the fallback, as its reservation recorded. */
  reviewer: string;
  /** The level `{effort}` expanded to, as its reservation recorded; absent when the argv carried no `{effort}`. */
  effort?: ReviewEffortLevel;
  /** A base-sync decision, as its reservation recorded it (T0-BASE-SYNC-REVIEW). */
  baseSync?: boolean;
  retained?: boolean;
  /** The pool request key of the envelope, for a recovery that settles it. */
  key?: string;
  /** The queue sequence of that request as admitted, for a recovery that settles only that request. */
  seq?: number;
}

/** A formal result recovered from a reservation: it always names the pool request to settle. */
type RetainedFormalResult = FormalResult & { key: string };

/** The journal's `decision` text for a result that did not commit; undefined for a committed one. */
function discardedDecision(status: CommitReviewStatus): string | undefined {
  switch (status) {
    case 'stopped':
      return 'discarded: card run stopped meanwhile';
    case 'abandoned':
      return 'discarded: reservation abandoned meanwhile';
    case 'fenced':
      return 'discarded: ownership lost';
    case 'superseded':
      return 'superseded: the candidate changed meanwhile';
    default:
      return undefined;
  }
}

/** The ship path a project config selects; the `github` block carries the required checks, the verdict rule and the CI polling limits. */
export function shipPathFor(config: ProjectConfig, mainRoot: string, runner: SyncRunner): ShipPath {
  if (config.shipPath === 'scaffold') return new ScaffoldShipPath({ mainRoot, worktreeRoot: resolveWorktreeRoot(config, mainRoot), runner });
  if (config.shipPath === 'github') {
    const gh = config.github;
    return new GitHubShipPath({ mainRoot, worktreeRoot: resolveWorktreeRoot(config, mainRoot), repository: config.repository ?? '', runner, requiredChecks: gh.requiredChecks, requireVerdict: gh.requireVerdict, ciTimeoutMs: gh.ciTimeoutMs, ciPollMs: gh.ciPollMs });
  }
  return new DryRunShipPath();
}

/** Thrown inside a takeover's reconciliation when the record the store hands over is already the acting session's: the interrupted takeover is completed, not advanced again. */
class AlreadyOwned extends Error {
  readonly lease: Lease;
  constructor(lease: Lease) {
    super(`lease ${lease.resourceKey} is already this session's at generation ${lease.generation}`);
    this.lease = lease;
  }
}

export class CardRunner {
  readonly paths: StatePaths;
  readonly repo: RepoIdentity;
  readonly config: ProjectConfig;
  readonly store: GoalStore;
  readonly leases: LeaseStore;
  readonly queue: ReviewQueue;
  readonly ops: OperationLedger;
  readonly git: GitProbe;
  readonly gh: GhProbe;
  readonly runner: SyncRunner;
  readonly asyncRunner: Runner;
  readonly shipPath: ShipPath;
  private readonly clock: () => string;

  constructor(deps: CardRunnerDeps) {
    this.paths = deps.paths;
    this.repo = deps.repo;
    this.config = deps.config;
    this.store = deps.store ?? new GoalStore(deps.paths);
    this.leases = deps.leases ?? new LeaseStore(deps.paths.leases);
    this.queue = deps.queue ?? new ReviewQueue(deps.paths.reviewQueue);
    this.ops = deps.ops ?? new OperationLedger(deps.paths.operations);
    this.runner = deps.runner ?? runSync;
    const scripted = deps.runner;
    this.asyncRunner = deps.asyncRunner ?? (scripted ? async (command, args, options) => scripted(command, args, options) : run);
    this.git = deps.git ?? new GitProbe(this.runner);
    this.gh = deps.gh ?? new GhProbe(this.runner);
    this.clock = deps.now ?? (() => new Date().toISOString());
    this.shipPath = deps.shipPath ?? shipPathFor(deps.config, deps.repo.mainRoot, this.runner);
  }

  /** The repository copy of the lessons file: read at PREPARE, appended at CLOSE. */
  private lessonsFile(): string {
    return lessonsPath(this.repo.mainRoot);
  }

  private journal(goalId: string): Journal {
    return Journal.forGoal(this.paths.journal, goalId);
  }

  worktreePath(cardId: string): string {
    return path.join(resolveWorktreeRoot(this.config, this.repo.mainRoot), cardId);
  }

  /** The checkout a review reads: the card worktree when it exists, else the main checkout. */
  private reviewCheckout(run: CardRun): string {
    return run.worktree && existsSync(run.worktree) ? run.worktree : this.repo.mainRoot;
  }

  /** The candidate a review is bound to: the pinned sha, verified against the checkout HEAD in a git repository. */
  private pinnedCandidate(run: CardRun, cwd: string): string {
    const pinned = run.candidate?.sha;
    if (this.repo.isGit) {
      const head = this.git.head(cwd);
      if (pinned && head !== pinned) throw new Error(`checkout ${cwd} is at ${head.slice(0, 12)}, not the pinned candidate ${pinned.slice(0, 12)}; check out the candidate before the review`);
      return pinned ?? head;
    }
    if (!pinned) throw new Error('no candidate recorded for this run; record the attempt with --candidate-sha first');
    return pinned;
  }

  private reviewPolicy(): string {
    const policyFile = path.join(this.repo.mainRoot, 'REVIEW.md');
    return existsSync(policyFile)
      ? readFileSync(policyFile, 'utf8')
      : 'Must-block: out of scope, hard boundaries, frozen contracts, license, non-original code, missing or fake tests. Two axes, spec and standards. Output the JSON verdict as the last line.';
  }

  /**
   * R2 eligibility for R3, shared by the gate and the command: the candidate holds a pre-review pass
   * (from any cycle: a pass stays valid for the candidate it reviewed), or the current cycle's rounds
   * are exhausted and the policy hands the residual findings on.
   */
  private preReviewEligibility(run: CardRun, candidateDigest: string): { eligible: boolean; reason: string; exhausted?: boolean } {
    const cfg = this.config.preReview;
    if (!cfg.command.length) return { eligible: true, reason: 'pre-review not configured' };
    const cycle = run.review.substantiveBlocks;
    const passed = [...run.preReview.rounds].reverse().find((r) => r.candidateDigest === candidateDigest && r.outcome === 'pass');
    if (passed) return { eligible: true, reason: `pre-review round ${passed.round} of cycle ${passed.cycle} passed` };
    const rounds = run.preReview.rounds.filter((r) => r.cycle === cycle);
    const latest = [...rounds].reverse().find((r) => r.candidateDigest === candidateDigest && r.outcome !== 'pending');
    const blocks = rounds.filter((r) => r.outcome === 'block').length;
    if (blocks >= cfg.rounds && cfg.onExhausted === 'ship') return { eligible: true, reason: 'pre-review rounds exhausted; residual findings handed to R3', exhausted: true };
    return { eligible: false, reason: latest ? `latest pre-review outcome for this candidate is ${latest.outcome}` : 'no pre-review round for this candidate' };
  }

  /**
   * The residual hand-off of exhausted pre-review rounds to R3 (`onExhausted: ship`), journaled once per
   * cycle and candidate whether the gate or the R3 command reaches it first; the deadlock is named there.
   */
  private recordResidualHandoff(goal: Goal, card: Card, run: CardRun, cycle: number, candidateDigest: string): CardRun {
    if (run.preReview.handoffs.some((h) => h.cycle === cycle && h.candidateDigest === candidateDigest)) return run;
    // The marker is persisted under the lock first; the event is journaled only for the write that inserted it.
    let inserted = false;
    const next = this.store.updateCardRun(goal.id, card.id, (persisted) => {
      const current = persisted ?? run;
      if (current.preReview.handoffs.some((h) => h.cycle === cycle && h.candidateDigest === candidateDigest)) return current;
      inserted = true;
      return { ...current, preReview: { ...current.preReview, handoffs: [...current.preReview.handoffs, { cycle, candidateDigest, at: this.clock() }] } };
    });
    if (inserted) {
      const blocks = next.preReview.rounds.filter((r) => r.cycle === cycle && r.outcome === 'block');
      const residual = blocks[blocks.length - 1]?.reasons ?? [];
      const residualFindings = next.findings.filter((f) => f.stage === 'pre' && !f.resolvedAt).map((f) => f.id);
      const deadlock = describeDeadlock(next.findings);
      this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle, exhausted: true, action: 'ship', residual, residualFindings, findings: [], reraised: [], resolved: [], deadlock: deadlock || undefined, policyHash: blocks[blocks.length - 1]?.policyHash } });
    }
    return next;
  }

  /**
   * A review reads the committed candidate: the recorded candidate and the review checkout as it is now (a file
   * edited or added after the attempt was recorded leaves HEAD unchanged) must both be clean.
   */
  private refuseDirtyCandidate(run: CardRun, cwd: string): void {
    if (run.candidate?.dirty || run.candidate?.untracked.length) throw new Error(`the candidate has uncommitted or untracked inputs (${run.candidate.untracked.join(', ') || 'dirty worktree'}); commit them, record the attempt, then review`);
    if (!this.repo.isGit) return;
    const status = this.git.status(cwd);
    if (status.dirty) throw new Error(`the review checkout ${cwd} has uncommitted or untracked changes (${status.entries.slice(0, 5).join(', ')}${status.entries.length > 5 ? ', ...' : ''}); commit them, record the attempt, then review`);
  }

  /** The run's unresolved findings as the prompt renders them: open ones to verify, disputed ones with the author's note. */
  private priorFindingsFor(run: CardRun): PriorFinding[] {
    return run.findings
      .filter((f) => !f.resolvedAt)
      .map((f) => ({
        id: f.id,
        reason: f.reason,
        disposition: f.disposition,
        note: f.disposition === 'disputed' ? f.disputes.at(-1)?.note : undefined,
        notes: f.disputes.map((d) => d.note),
        reraisedReasons: f.reraised.map((r) => r.reason),
        origin: `${f.stage === 'pre' ? `pre-review round ${f.round}${f.perspective ? ` (${f.perspective})` : ''}` : `R3 decision ${f.round}`}${f.advisory ? ', advisory block' : ''}`,
        nonAcceptanceRounds: nonAcceptanceRounds(f),
      }));
  }

  /** The findings as a reviewer receives them at dispatch: disposition and dispute count of every unresolved finding. */
  private findingsSnapshot(run: CardRun): Record<string, FindingSnapshot> {
    return snapshotFindings(run.findings);
  }

  /** The committed sha the stage last decided on (a pass or a block, whichever reviewer recorded it); undefined before the stage's first decision. */
  private lastReviewedSha(run: CardRun, stage: FindingStage): string | undefined {
    if (stage === 'pre') return [...run.preReview.rounds].reverse().find((r) => (r.outcome === 'pass' || r.outcome === 'block') && r.candidateSha)?.candidateSha;
    return [...run.review.invocations].reverse().find((i) => (i.outcome === 'pass' || i.outcome === 'block') && i.candidateSha)?.candidateSha;
  }

  /** The delta since the candidate the stage last reviewed (R9): the same commit gives an empty delta, another commit its committed diff under the candidate diff's cap. */
  private collectDelta(cwd: string, sinceSha: string, candidateSha: string, maxBytes: number, cap: string): ReviewDelta {
    if (sinceSha === candidateSha) return { sinceSha, changedPaths: [], diff: '' };
    const { changedPaths, diff } = collectCandidateDiff(this.runner, cwd, sinceSha, maxBytes, this.repo.isGit ? candidateSha : 'HEAD', cap);
    return { sinceSha, changedPaths, diff };
  }

  /** The advisory notes of the latest decided pre-review round on the candidate, handed to the formal review (R10). */
  private advisoryNotesFor(run: CardRun, candidateSha: string, candidateDigest: string): string[] {
    return [...run.preReview.rounds].reverse().find((r) => (r.outcome === 'pass' || r.outcome === 'block') && ((r.candidateSha ?? r.candidateDigest) === candidateSha || r.candidateDigest === candidateDigest))?.advisory ?? [];
  }

  /** The DoD receipt a block clears, kept for the candidate it was bound to. */
  private keepReceipt(run: CardRun, block: Omit<BlockedReceipt, 'dodReceipt' | 'candidateDigest'>): BlockedReceipt | undefined {
    if (!run.dodReceipt || !run.candidate?.digest) return run.blockedReceipt;
    return { dodReceipt: run.dodReceipt, candidateDigest: run.candidate.digest, ...block };
  }

  /**
   * A receipt cleared by a block is evidence for the same candidate, base and inputs: it is reused when the
   * unchanged candidate goes back to review with every finding of the block disputed (a formal block only
   * with a command reviewer, since a ship-path reviewer receives no notes), or when the pre-review rounds
   * of the cycle are exhausted, so the gate decides (the residual ships to R3, or the card stops).
   */
  private reusableReceipt(run: CardRun): string | undefined {
    const kept = run.blockedReceipt;
    if (run.dodReceipt || !kept || run.candidate?.digest !== kept.candidateDigest) return undefined;
    if (kept.stage === 'formal') {
      const sha = kept.candidateSha ?? run.candidate?.sha;
      return this.config.formalReview.command.length && sha && this.blockAnswered(run, { stage: 'formal', candidateSha: sha }).answered ? kept.dodReceipt : undefined;
    }
    if (kept.round !== undefined && this.blockAnswered(run, { stage: 'pre', cycle: kept.cycle, round: kept.round }).answered) return kept.dodReceipt;
    const cfg = this.config.preReview;
    const blocks = run.preReview.rounds.filter((r) => r.cycle === run.review.substantiveBlocks && r.outcome === 'block').length;
    return cfg.command.length && blocks >= cfg.rounds ? kept.dodReceipt : undefined;
  }

  /**
   * Same-candidate rule: a block is answered when every finding it raised or re-raised is disputed, so a
   * new round or decision on the unchanged candidate receives new information. A block that recorded no
   * finding is never answered: the candidate must change.
   */
  private blockAnswered(run: CardRun, block: BlockSelector): { answered: boolean; open: string[] } {
    if (!findingsOfBlock(run.findings, block).length) return { answered: false, open: [] };
    const { allowed, open } = rerunAllowed(run.findings, block);
    return { answered: allowed, open };
  }

  /** Whether a recorded block invocation stops the ship: its own record, else (records written before the field) the run's last verdict. */
  private invocationBlocking(run: CardRun, card: Card, invocation: { mergeBlocking?: boolean } | undefined): boolean {
    if (!invocation) return false;
    if (invocation.mergeBlocking !== undefined) return invocation.mergeBlocking;
    return run.review.lastVerdict ? classifyVerdict(run.review.lastVerdict, { candidateSha: run.candidate?.sha, tier: card.tier, gateRequired: this.config.gateRequired }).mergeBlocking : true;
  }

  /** The refusal text for a round or decision on a blocked, unchanged candidate. */
  private sameCandidateRefusal(card: Card, candidateSha: string, blockedBy: string, open: string[]): string {
    const ids = open.length ? open.join(', ') : 'none recorded';
    return `candidate ${candidateSha.slice(0, 12)} was blocked by ${blockedBy} and is unchanged; open finding(s): ${ids}. Repair it and record the attempt with the new candidate sha, or dispute each finding with \`aidlc review dispute ${card.id} <id> --note "<why it does not hold>"\`; the round runs on the unchanged candidate only when every finding of the block is disputed`;
  }

  /** A stop detail with the deadlocked or contested findings named after it. */
  private withContest(detail: string, findings: ReviewFinding[]): string {
    const named = describeDeadlock(findings) || describeContested(findings);
    return named ? `${detail}; ${named}` : detail;
  }

  private guardFindingsMutation(run: CardRun): void {
    if (run.stop || run.state === 'STOP') throw new Error(`card run is stopped (${run.stop?.reason ?? 'STOP'}); findings cannot change: ${run.stop?.nextAction ?? 'resolve the stop first'}`);
  }

  /** The author disputes an open finding with a note; the next round or decision receives the note. */
  disputeFinding(goal: Goal, card: Card, run: CardRun, id: string, note: string): CardRun {
    const now = this.clock();
    const next = this.changeFinding(goal, card, run, id, (findings) => disputeFinding(findings, id, note, now));
    this.journal(goal.id).append({ type: 'FINDING_DISPUTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { finding: id.toUpperCase(), note: note.trim(), disputes: next.findings.find((f) => f.id === id.toUpperCase())?.disputes.length ?? 0 } });
    return next;
  }

  /** The author withdraws a dispute: the finding is open again and the next round verifies it. */
  acceptFinding(goal: Goal, card: Card, run: CardRun, id: string): CardRun {
    const next = this.changeFinding(goal, card, run, id, (findings) => acceptFinding(findings, id));
    this.journal(goal.id).append({ type: 'FINDING_ACCEPTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { finding: id.toUpperCase() } });
    return next;
  }

  /**
   * A disposition changes the persisted run under the card-run lock (`GoalStore.updateCardRun`), never the
   * caller's snapshot: the record is read inside the lock, a stop saved meanwhile refuses, the lease is
   * fenced at the run's generation, and only the changed finding is written back into that record, so no
   * disposition overwrites another window's.
   */
  private changeFinding(goal: Goal, card: Card, run: CardRun, id: string, change: (findings: ReviewFinding[]) => ReviewFinding[]): CardRun {
    return this.store.updateCardRun(goal.id, card.id, (persisted) => {
      const current = persisted ?? run;
      this.guardFindingsMutation(current);
      if (current.ownerGeneration !== undefined) this.leases.fence(resourceKeys.card(this.repo.key, card.id), current.ownerGeneration, currentActor(), this.clock());
      const changed = change(current.findings).find((f) => f.id === id.toUpperCase());
      return { ...current, findings: current.findings.map((f) => (changed && f.id === changed.id ? changed : f)) };
    });
  }

  /**
   * The existing run of a card, read only: the run in `goalId` when given, else the one goal that runs the
   * card; several candidate goals need an explicit choice. Nothing is created and no deadline starts.
   */
  findRun(cardId: string, goalId?: string): CardRun | undefined {
    if (goalId) return this.store.getCardRun(goalId, cardId);
    const runs = this.store
      .listGoals()
      .map((g) => this.store.getCardRun(g.id, cardId))
      .filter((r): r is CardRun => Boolean(r));
    if (runs.length > 1) throw new Error(`card ${cardId} runs in ${runs.length} goals (${runs.map((r) => r.goalId).join(', ')}); pass --goal <id>`);
    return runs[0];
  }

  /** Every finding of the run, in id order; readable on a stopped run too (the adjudicator reads it after a STOP). */
  listFindings(run: CardRun): ReviewFinding[] {
    return [...run.findings].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  }

  /** Renew the card lease when this session owns it at the run's generation (a review can outlast the TTL). */
  private renewOwnLease(cardId: string, run: CardRun, now: string): void {
    const key = resourceKeys.card(this.repo.key, cardId);
    const lease = this.leases.read(key);
    const me = currentActor();
    if (lease && !lease.released && lease.owner.session === me.session && lease.owner.host === me.host && run.ownerGeneration === lease.generation) this.leases.claim(key, { operation: lease.operation, now });
  }

  /**
   * Drop a pending formal-review reservation from the persisted run (the dispatch failed before a decision). Only an entry
   * still pending on the locked record is removed: a decision another window recovered under this invocation meanwhile
   * stays with its counters.
   */
  private releaseReservation(goal: Goal, card: Card, invocationId: string): void {
    if (!this.store.getCardRun(goal.id, card.id)) return;
    this.store.updateCardRun(goal.id, card.id, (current) => ({ ...current!, review: { ...current!.review, invocations: current!.review.invocations.filter((i) => !(i.invocationId === invocationId && i.outcome === 'pending')) } }));
  }

  /**
   * Every write goes through the card-run lock (`GoalStore.saveCardRun`): the store merges the findings by
   * revision with the persisted record and refuses a write computed from a stale read (a round, a decision or
   * a hand-off recorded meanwhile, a pending entry decided meanwhile, a counter the write would regress), so
   * the command is re-run on the current record instead of dropping or undoing the entry. Paths that remove
   * an entry on purpose (a released reservation, an abandoned round) write through `updateCardRun` from the
   * locked record.
   */
  private save(run: CardRun): CardRun {
    return this.store.saveCardRun(run);
  }

  /**
   * Evidence from the persisted facts alone (lease record, operation ledger, run record; no probe), the owner's lease
   * renewal and the state selection, shared by `next`, which then performs the selected state's action, and by
   * `takeover`, which persists the selected state without one. `run` is returned as this block leaves it (a merged
   * card's ownership stop reconciled, an owner's stop revalidated), `next` as the selection would save it.
   */
  private assess(goal: Goal, card: Card, caller: CardRun, now: string): { run: CardRun; next: CardRun; decision: CardDecision; lease: Lease | undefined } {
    // The stored run is the truth: a caller's snapshot (a window that kept the run it read before another session's
    // takeover, a blocking stop or a review decision landed) writes nothing back; a stale dispatch records its own
    // ownership stop on the stored run, and a stop already persisted there stays. The caller's copy stands in only
    // when no record exists yet.
    let run: CardRun = this.store.getCardRun(goal.id, card.id) ?? caller;
    const key = resourceKeys.card(this.repo.key, card.id);
    const me = currentActor();
    let lease = this.leases.read(key);
    // A merged card stopped for ownership is reconciled once the blocking lease is gone (released, expired or ours):
    // the replacement session may then reclaim the card in CLOSE instead of reading the old stop forever.
    if (run.stop?.reason === 'ownership' && run.mergeVerified && (!lease || lease.released || Date.parse(lease.expiresAt) < Date.parse(now) || (lease.owner.session === me.session && lease.owner.host === me.host))) {
      this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { from: 'STOP', to: 'CLOSE', reason: 'ownership stop reconciled: the blocking lease is gone' } });
      run = this.save({ ...run, state: 'CLOSE', stop: undefined });
    }
    // An unmerged run stopped for ownership whose blocking lease is gone (absent or released; never merely expired, which
    // proves nothing) is reconciled the same way: the stop is lifted and the selection proceeds, so the claim is reachable.
    if (run.stop?.reason === 'ownership' && !run.mergeVerified && (!lease || lease.released)) {
      this.journal(goal.id).append({ type: 'NOTE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { kind: 'ownership-stop-reconciled', reason: 'the blocking lease is gone', released: Boolean(lease?.released) } });
      run = { ...run, stop: undefined, blocker: undefined };
    }
    // Heartbeat: the owner's own `card next` renews the card lease, as the controller renews the goal
    // lease. Expiry alone never proves the owner stopped; only a takeover changes the generation, and
    // that case still fails the fence in ship(). A stop caused only by the owner's own expiry is
    // revalidated by the renewal.
    let revalidatedStop = false;
    if (lease && !lease.released && lease.owner.session === me.session && lease.owner.host === me.host && run.ownerGeneration === lease.generation) {
      const wasExpired = Date.parse(lease.expiresAt) < Date.parse(now);
      const renewal = this.leases.claim(key, { operation: lease.operation, now });
      if (renewal.status === 'renewed') {
        lease = renewal.lease;
        revalidatedStop = run.stop?.reason === 'ownership';
        if (wasExpired || revalidatedStop) this.journal(goal.id).append({ type: 'LEASE_RENEWED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { resource: key, leaseGeneration: lease.generation, wasExpired, revalidated: revalidatedStop } });
        if (revalidatedStop) run = { ...run, stop: undefined, blocker: undefined };
      }
    }
    const ownershipCurrent = !lease || lease.released || lease.owner.session === me.session || Date.parse(lease.expiresAt) < Date.parse(now);
    const reusable = this.reusableReceipt(run);
    if (reusable) run = this.save({ ...run, dodReceipt: reusable, blockedReceipt: undefined }); // consumed: a later check failure never resurrects it
    const unknownOps = this.ops.unresolved(goal.id, card.id).filter((o) => o.status === 'UNKNOWN' || o.status === 'issued' || o.status === 'running');
    const runningOp = this.ops.unresolved(goal.id, card.id).find((o) => o.status === 'running' || o.status === 'issued');
    const reviewExhausted = run.review.substantiveBlocks >= 2 || run.review.noVerdictRetriesUsed > 1 || (run.review.substantiveDecisions >= 2 && run.review.substantiveBlocks > 0 && run.state === 'REVIEW_FIX');
    const episode = run.effort;
    const repairExhausted = episode?.terminal && episode.terminal !== 'succeeded' ? `effort episode ${episode.terminal}` : undefined;
    // R20-R21: remote autonomous delivery needs an existing blocking independent-review path. With the
    // scaffold's advisory ReviewGate only a Tier-S spec block stops a ship, so any other card could be
    // merged with a known defect before this loop reads the verdict. That is STOP/capability, not a
    // reason to change ReviewGate defaults silently.
    const capabilityBlocker =
      this.config.shipPath === 'scaffold' && run.mode === 'remote' && !this.config.gateRequired && !(card.tier === 'S' && card.review_gate)
        ? `remote autonomous delivery needs a blocking independent review path: card ${card.id} is tier ${card.tier ?? 'computed'} under an advisory ReviewGate, so the ship could merge a known defect before this loop reads the verdict; set gateRequired=true (ReviewGate='required') or run a pre-ship blocking review`
        : undefined;

    const evidence: CardEvidence = {
      now,
      deadline: run.deadline,
      unknownOperations: unknownOps.filter((o) => o.status === 'UNKNOWN').map((o) => o.id),
      runningOperation: runningOp?.id,
      terminal: run.stop,
      prepared: Boolean(run.worktree) && Boolean(lease && !lease.released && lease.owner.session === me.session),
      mergeVerified: run.mergeVerified,
      // A run persisted as DONE keeps its closure complete: DONE is derived from a verified merge and a complete closure and never patched, so a record that predates the lessons predicate stays DONE.
      closureComplete: run.state === 'DONE' || Object.values(run.closure).every(Boolean),
      // A block stays pending only while the reviewed candidate is still the current candidate; a new
      // candidate (new sha/digest after the fix) moves the card back through BUILD/SHIP, and so does a
      // block whose every finding the author disputed (the next decision runs on the unchanged candidate).
      reviewBlockPending: (() => {
        // The candidate's latest decision, whichever reviewer recorded it: a pass after a block on the same candidate is no pending block.
        const lastBlock = [...run.review.invocations].reverse().find((i) => i.candidateDigest === run.candidate?.digest && (i.outcome === 'block' || i.outcome === 'pass'));
        if (!lastBlock || lastBlock.outcome !== 'block' || reviewExhausted) return false;
        // Disputes reach a reviewer only through the command path; a ship-path reviewer re-reads a verdict file.
        const answered = this.config.formalReview.command.length > 0 && run.candidate?.sha ? this.blockAnswered(run, { stage: 'formal', candidateSha: run.candidate.sha }).answered : false;
        return this.invocationBlocking(run, card, lastBlock) && !answered;
      })(),
      reviewExhausted,
      buildIncomplete: !run.dodReceipt || (card.tdd && !run.redReceipt) || (run.candidate?.dirty ?? false),
      candidateReady: Boolean(run.dodReceipt) && (!card.tdd || Boolean(run.redReceipt)) && !(run.candidate?.dirty ?? false),
      ownershipCurrent,
      repairExhausted,
      capabilityBlocker,
    };
    const decision = selectCardState(evidence);
    let next: CardRun = { ...run, state: decision.state, stop: decision.stop ?? run.stop, blocker: decision.state === 'STOP' ? decision.reason : undefined };
    // A revalidated ownership stop is persisted with the re-derived state before any action: a ship issued from this call
    // reads the record as persisted and must not find the stop it cleared.
    if (revalidatedStop) next = this.save(next);
    if (next.state !== run.state) this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { from: run.state, to: next.state, reason: decision.reason } });
    return { run, next, decision, lease };
  }

  /** Gather evidence and select the next card directive. Performs only the bounded action of the selected state. */
  next(goal: Goal, card: Card, caller: CardRun, options: { effort?: EffortLevel } = {}): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    // The stored run, before anything reads it: a caller's snapshot (a window that kept the run it read before a takeover
    // cleared its stop) decides nothing here either; the caller's copy stands in only when no record exists yet.
    let run: CardRun = this.store.getCardRun(goal.id, card.id) ?? caller;
    // A T2 goal back in CARDS (a recovery re-entry after an extension or a resumed revision) whose plan checkpoint is not
    // approved for the current revision has not admitted its projection: no worker executes a card of it before `aidlc next` does.
    const checkpointMissing = (r: CardRun): boolean => goal.state === 'CARDS' && goal.routing.size === 'T2' && !r.stop && r.state !== 'DONE' && requireAuthority(goal.authorizations, 'plan-checkpoint', { goalRevision: goal.revision }, now).status === 'missing';
    const checkpointWait = (r: CardRun): { run: CardRun; directive: CardDirective } => ({ run: r, directive: { kind: 'wait', cardId: card.id, on: `goal:${goal.state}:plan-checkpoint`, pollSeconds: 60, narration: `goal ${goal.id} is in CARDS without a plan checkpoint for revision ${goal.revision}: run \`aidlc next --goal ${goal.id}\` and record the approval before this card continues` } });
    if (checkpointMissing(run)) return checkpointWait(run);
    const assessed = this.assess(goal, card, run, now);
    run = assessed.run;
    // The reconciliation may have lifted a stop (an ownership stop whose lease is gone): the guard is asked again on the
    // run as it stands now, before any action.
    if (checkpointMissing(run)) return checkpointWait(run);
    const { decision } = assessed;
    let next = assessed.next;

    switch (decision.state) {
      case 'PREPARE':
        return this.prepare(goal, card, next);
      case 'BUILD':
        return this.build(goal, card, next, options.effort);
      case 'SHIP':
        return this.ship(goal, card, next);
      case 'REVIEW_FIX': {
        // The repair is a counted attempt of the same episode (MA2): start it here so `aidlc card attempt` can finish it.
        let episode = next.effort;
        let attemptNote = '';
        if (episode && !episode.attempts.some((a) => a.outcome === 'running')) {
          const action = nextEffortAction(episode, { harderProblem: true, limitsPermit: checkAdmission(run.deadline, now).phase === 'open' });
          if (action.action === 'stop') {
            const stop = makeStop('card', `${action.reason}: ${action.detail}`, 'record cause, evidence and the next needed action; no counter reset via another session', { at: now, global: false });
            const stopped = this.save({ ...next, state: 'STOP', stop, effort: { ...episode, terminal: action.reason } });
            return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: action.detail } };
          }
          if (action.action === 'attempt') {
            episode = startAttempt(episode, action.effort, now);
            attemptNote = ` Attempt ${action.n} at effort ${action.effort}${action.escalated ? ' (escalated)' : ''}.`;
            this.journal(goal.id).append({ type: 'ATTEMPT_STARTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { n: action.n, effort: action.effort, escalated: action.escalated, reason: 'review-fix' } });
          }
        }
        next = this.save({ ...next, effort: episode });
        // The handoff (`review-fix`) was returned by the ship; from here on the repair is BUILD work.
        const running = episode?.attempts.find((a) => a.outcome === 'running');
        const reasons = run.review.lastVerdict?.reasons ?? [];
        const open = run.candidate?.sha ? this.blockAnswered(run, { stage: 'formal', candidateSha: run.candidate.sha }).open : [];
        const commandReviewer = this.config.formalReview.command.length > 0;
        const disputeHint = open.length
          ? ` Open finding(s): ${open.join(', ')}; a finding that does not hold is disputed with \`aidlc review dispute ${card.id} <id> --note "<why>"\`${commandReviewer ? ', and the next decision runs on the unchanged candidate once every finding of the block is disputed.' : '; the ship-path reviewer re-reads a verdict file and receives no notes, so a dispute is recorded for the human adjudicator and the candidate ships again only once it changes.'}`
          : !commandReviewer && run.candidate?.sha && findingsOfBlock(run.findings, { stage: 'formal', candidateSha: run.candidate.sha }).length
            ? ' The ship-path reviewer re-reads a verdict file and receives no notes: the disputes are recorded for the human adjudicator; repair the candidate to ship again.'
            : '';
        return {
          run: next,
          directive: {
            kind: 'build',
            cardId: card.id,
            worktree: run.worktree ?? this.worktreePath(card.id),
            tdd: card.tdd,
            redReceipt: run.redReceipt,
            dodCommand: card.dod_command,
            effort: running?.effort ?? episode?.baseline ?? 'medium',
            attempt: running?.n ?? (episode?.attempts.length ?? 0),
            skills: this.buildSkills(goal, card),
            narration: `Review block to repair: ${reasons.join(' | ') || 'see verdict'}. Fix the introduced defects within scope or revert the defective change; do not defer a required fix as a nit.${attemptNote} Rerun the DoD and record \`aidlc card attempt ${card.id} --outcome success --candidate-sha <new sha> --dod-receipt ...\`; the repaired candidate ships with ${Math.max(0, 2 - run.review.substantiveDecisions)} substantive decision(s) left.${disputeHint}`,
          },
        };
      }
      case 'WAIT': {
        next = this.save(next);
        return { run: next, directive: { kind: 'wait', cardId: card.id, on: decision.reason, pollSeconds: 60, narration: decision.reason } };
      }
      case 'CLOSE':
        return this.close(goal, card, next);
      case 'DONE': {
        next = this.save(next);
        return { run: next, directive: { kind: 'done', cardId: card.id, narration: 'Card DONE (child result). The parent still verifies and delivers the goal.' } };
      }
      case 'STOP':
      default: {
        next = this.save(next);
        return { run: next, directive: { kind: 'stop', cardId: card.id, stop: next.stop ?? makeStop('card', decision.reason, 'inspect the card run record', { at: now, global: false }), narration: decision.reason } };
      }
    }
  }

  /**
   * Take over the card lease of another session (MS2): only once that lease has expired and no operation of the card is
   * unresolved in any goal (the lease is one resource per repository and card). The generation advances, so a write of
   * the old owner at its generation is fenced; the run, read again once the lease is held, records the new generation (a
   * run interrupted between the lease claim and the PREPARE save, which has none, included) and its state is selected
   * again through `assess`, whose renewal revalidates the ownership stop as it does for an owner's own expired lease and
   * keeps any other stop as `card next` keeps it. The record is validated on what the store hands to the reconciliation,
   * not on the earlier read, and the ledger is read there too, so a release, a takeover or an operation that landed
   * meanwhile is seen. A lease this session already holds at a generation the run does not carry is an interrupted
   * takeover (or an interrupted claim), completed here without another advance once the lease is read again and is
   * still this session's at that generation; one the run carries refuses, since `card next` renews it. The handoff
   * intent and the acquisition are resolved by resource and generation in every goal's journal. A missing or released
   * lease, a live lease of another session and an unresolved operation refuse before any write. The store has no
   * compare-and-set, and the guarantees end there (docs/OPERATIONS.md, Sessions): a renewal by the old owner landing
   * inside the lease store's own read-write window is overwritten, a writer that passed its fence before the lease
   * write and saves after it writes the run at the old generation (this command run again completes it), two
   * completions of one session may both journal the acquisition, and an operation admitted after the last ledger read
   * here is left to the assessment of `next`. The goal lease is not touched (`aidlc goal takeover`).
   */
  takeover(goal: Goal, card: Card, caller: CardRun): { run: CardRun; lease: Lease; completed: boolean; previousOwner?: ActorIdentity; previousGeneration?: number } {
    const now = this.clock();
    const key = resourceKeys.card(this.repo.key, card.id);
    const me = currentActor();
    const journal = this.journal(goal.id);
    const mine = (l: Lease): boolean => !l.released && l.owner.session === me.session && l.owner.host === me.host;
    const unresolvedNow = (): string[] => this.ops.list({ cardId: card.id }).filter((o) => ['intended', 'issued', 'running', 'UNKNOWN'].includes(o.status)).map((o) => o.id);
    // Every hint names the goal this command runs under: the default goal of a later command may be another one.
    const scoped = (command: string) => `\`aidlc card ${command} ${card.id} --goal ${goal.id}\``;
    const first = this.leases.read(key);
    if (!first) throw new Error(`card ${card.id} has no lease record; run ${scoped('next')} to claim it`);
    const seen: { previous?: { owner: ActorIdentity; generation: number } } = {};
    let lease: Lease;
    if (mine(first)) {
      lease = first;
    } else {
      try {
        lease = this.leases.takeover(
          key,
          (old) => {
            if (old.released) throw new Error(`the lease of card ${card.id} is released (generation ${old.generation}); run ${scoped('next')} to claim it`);
            if (mine(old)) throw new AlreadyOwned(old);
            const unresolved = unresolvedNow();
            if (unresolved.length) return { reconciled: false, unresolvedOperations: unresolved, note: 'reconcile with `aidlc ops reconcile` first' };
            // The handoff intent precedes the lease write, bound to the acquisition it precedes (the acquiring session and the
            // acquisition time the lease will carry): a process that ends between the write and the run update leaves the
            // previous owner in the journal for the completion, and an intent whose write never landed matches no lease.
            seen.previous = { owner: old.owner, generation: old.generation };
            journal.append({ type: 'NOTE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { kind: 'card-takeover-intent', resource: key, previousOwner: old.owner, previousGeneration: old.generation, leaseGeneration: old.generation + 1, acquirer: { session: me.session, host: me.host }, acquiredAt: now } });
            return { reconciled: true, unresolvedOperations: [] };
          },
          { operation: `card:${card.id}`, now },
        ).lease;
      } catch (err) {
        if (!(err instanceof AlreadyOwned)) throw err;
        lease = err.lease;
        seen.previous = undefined;
      }
    }
    const completed = seen.previous === undefined;
    let previous = seen.previous;
    // The lease is one resource per repository and card, so its handoff intent and its acquisition are looked up in every
    // goal's journal by resource and generation, not only in the goal this command runs under.
    const takeoverEvents = (type: 'NOTE' | 'LEASE_ACQUIRED') => this.store.listGoals().flatMap((g) => Journal.forGoal(this.paths.journal, g.id).readAll().filter((e) => e.type === type && e.data['resource'] === key && e.data['leaseGeneration'] === lease.generation));
    if (completed) {
      // A completion reads the lease once more right before it writes: the first read is not trusted, since a release or
      // another session's takeover may have landed since.
      const again = this.leases.read(key);
      if (!again) throw new Error(`card ${card.id} has no lease record any more; run ${scoped('next')} to claim it`);
      if (again.released) throw new Error(`the lease of card ${card.id} is released (generation ${again.generation}); run ${scoped('next')} to claim it`);
      if (!mine(again) || again.generation !== lease.generation) throw new Error(`card ${card.id} is owned by session ${again.owner.session} (generation ${again.generation}) since the command's first read; run ${scoped('status')} and start over`);
      // The previous owner comes from the intent journaled before the lease write, when that write is the acquisition this
      // session holds: the intent names the acquiring session and the acquisition time the lease carries.
      const bound = (e: { data: Record<string, unknown> }) => {
        const acquirer = e.data['acquirer'] as { session?: unknown; host?: unknown } | undefined;
        return e.data['kind'] === 'card-takeover-intent' && acquirer?.session === lease.owner.session && acquirer?.host === lease.owner.host && e.data['acquiredAt'] === lease.acquiredAt;
      };
      const intent = takeoverEvents('NOTE').reverse().find(bound);
      const owner = intent ? ActorIdentity.safeParse(intent.data['previousOwner']) : undefined;
      if (intent && owner?.success && typeof intent.data['previousGeneration'] === 'number') previous = { owner: owner.data, generation: intent.data['previousGeneration'] };
    }
    const current = this.store.getCardRun(goal.id, card.id) ?? caller;
    if (completed && current.ownerGeneration === lease.generation) throw new Error(`this session owns card ${card.id} at generation ${lease.generation}; run ${scoped('next')}`);
    // The ledger read inside the reconciliation precedes the store's write: an operation admitted in between is found here.
    // The lease stays taken (the writer is fenced from now on) and the run stays as it was until the operation is
    // reconciled; the command run again then completes the takeover.
    const late = unresolvedNow();
    if (late.length) throw new Error(`card ${card.id} is taken at generation ${lease.generation}, but ${late.length} operation(s) of the card landed after the reconciliation (${late.join(',')}); reconcile them, then run ${scoped('takeover')} again to complete the takeover`);
    // One acquisition per generation across goals, whatever journaled it (PREPARE's claim journals one before it saves the
    // generation): a completion after one journals the completion instead of a second acquisition.
    const journaled = takeoverEvents('LEASE_ACQUIRED').length > 0;
    if (!journaled) journal.append({ type: 'LEASE_ACQUIRED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { resource: key, leaseGeneration: lease.generation, takeover: true, ...(previous ? { previousOwner: previous.owner.session, previousGeneration: previous.generation } : {}), ...(completed ? { completed: true } : {}) } });
    else if (completed) journal.append({ type: 'NOTE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { kind: 'card-takeover-completed', resource: key, leaseGeneration: lease.generation, ...(previous ? { previousOwner: previous.owner.session, previousGeneration: previous.generation } : {}) } });
    const owned = this.save({ ...current, ownerGeneration: lease.generation });
    const assessed = this.assess(goal, card, owned, now);
    const next = this.save(assessed.next);
    return { run: next, lease: assessed.lease ?? lease, completed, previousOwner: previous?.owner, previousGeneration: previous?.generation };
  }

  private prepare(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    const key = resourceKeys.card(this.repo.key, card.id);
    const claim = this.leases.claim(key, { operation: `card:${card.id}`, now });
    if (claim.status === 'held') {
      const stop = makeStop('ownership', `card ${card.id} is owned by session ${claim.lease.owner.session} (generation ${claim.lease.generation})`, `attach read-only, or \`aidlc card takeover ${card.id} --goal ${goal.id}\` once the lease has expired and the old owner's operations are reconciled`, { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    if (claim.status === 'expired') {
      const stop = makeStop('ownership', `card ${card.id} has an expired lease from session ${claim.lease.owner.session}`, `reconcile the old owner's in-flight operations (aidlc ops list --goal ${goal.id}), then \`aidlc card takeover ${card.id} --goal ${goal.id}\``, { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    this.journal(goal.id).append({ type: claim.status === 'acquired' ? 'LEASE_ACQUIRED' : 'LEASE_RENEWED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { resource: key, leaseGeneration: claim.lease.generation } });
    const worktreeRoot = resolveWorktreeRoot(this.config, this.repo.mainRoot);
    let decision: ReturnType<typeof decideWorktree>;
    if (this.config.shipPath === 'dry-run') {
      decision = { action: run.worktree ? 'attach' : 'start', path: path.join(worktreeRoot, card.id), head: '', reason: 'dry-run' } as ReturnType<typeof decideWorktree>;
    } else {
      decision = decideWorktree(this.git, { mainRoot: this.repo.mainRoot, worktreeRoot, cardId: card.id, lease: claim.lease, session: currentActor().session });
    }
    if (decision.action === 'stop') {
      const stop = makeStop(decision.stopReason, decision.reason, 'resolve the worktree/ownership conflict before starting', { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop, ownerGeneration: claim.lease.generation });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: decision.reason } };
    }
    const lessons = readLessons(this.lessonsFile());
    const next = this.save({ ...run, state: 'BUILD', worktree: decision.path, branch: card.id, ownerGeneration: claim.lease.generation, stop: undefined, blocker: undefined });
    return {
      run: next,
      directive: {
        kind: 'prepare',
        cardId: card.id,
        action: decision.action,
        worktree: decision.path,
        skills: [],
        lessons,
        narration: `Read docs/LESSONS.md once before the first attempt (${lessons.count} lessons so far; the most recent are in this directive). ` + (decision.action === 'start' ? `Start a new worktree for ${card.id} at ${decision.path} (scaffold: pwsh scripts/task.ps1 -TaskId ${card.id} -Phase start from the main checkout). ${decision.reason}` : `Attach to existing worktree ${decision.path}: ${decision.reason}. Do not re-run start.`),
      },
    };
  }

  /** Companion skills for BUILD: the test-quality reference always, the diagnosis loop on bugfix evidence (goal kind or a card diagnosis). */
  private buildSkills(goal: Goal, card: Card): string[] {
    const bugfix = (goal.routing.skills ?? []).includes('diagnose') || goal.routing.size === 'T0-bugfix' || goal.routing.kind === 'bugfix' || goal.routing.kind === 'incident' || Boolean(card.diagnosis);
    return bugfix ? ['tdd', 'diagnose'] : ['tdd'];
  }

  private build(goal: Goal, card: Card, run: CardRun, effortOverride?: EffortLevel): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    const profile = goal.roleProfiles.find((p) => p.role === 'implementer');
    const ladder = profile?.supportedEfforts ?? ['low', 'medium', 'high'];
    let episode = run.effort ?? createEpisode(card.id, 'implementer', effortOverride ?? (ladder.includes('medium') ? 'medium' : ladder[0]!), ladder);
    const running = episode.attempts.find((a) => a.outcome === 'running');
    let attemptNo = running?.n ?? episode.attempts.length + 1;
    let effort: EffortLevel = running?.effort ?? episode.baseline;
    if (!running) {
      const action = nextEffortAction(episode, { harderProblem: true, limitsPermit: checkAdmission(run.deadline, now).phase === 'open' });
      if (action.action === 'stop') {
        const stop = makeStop('card', `${action.reason}: ${action.detail}`, 'record cause, evidence and the next needed action; no fifth attempt or counter reset via another session', { at: now, global: false });
        const stopped = this.save({ ...run, state: 'STOP', stop, effort: { ...episode, terminal: action.reason } });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: action.detail } };
      }
      if (action.action === 'attempt') {
        episode = startAttempt(episode, action.effort, now);
        attemptNo = action.n;
        effort = action.effort;
        this.journal(goal.id).append({ type: 'ATTEMPT_STARTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { n: attemptNo, effort, escalated: action.escalated } });
      }
    }
    // Refresh the RED receipt from the scaffold worktree when available.
    let redReceipt = run.redReceipt;
    if (!redReceipt && this.shipPath instanceof ScaffoldShipPath) {
      const red = this.shipPath.readRedReceipt(card.id);
      const id = red ? `${red.sha}:${red.dodExit}` : undefined;
      // A receipt the ship path already rejected is never reloaded as proof; RED has to be established again.
      if (id && id !== run.pendingRepair?.rejectedReceipt) redReceipt = id;
    }
    const repairPrefix = run.pendingRepair ? `Pending ${run.pendingRepair.kind} repair: ${run.pendingRepair.detail} ` : '';
    const next = this.save({ ...run, state: 'BUILD', effort: episode, redReceipt });
    return {
      run: next,
      directive: {
        kind: 'build',
        cardId: card.id,
        worktree: run.worktree ?? this.worktreePath(card.id),
        tdd: card.tdd,
        redReceipt,
        dodCommand: card.dod_command,
        effort,
        attempt: attemptNo,
        skills: run.pendingRepair?.kind === 'merge-conflict' ? ['merge-conflicts', ...this.buildSkills(goal, card)] : this.buildSkills(goal, card),
        narration: card.tdd && !redReceipt
          ? `${repairPrefix}Attempt ${attemptNo} at effort ${effort}: establish behavioural RED first (scaffold: task.ps1 -Phase red writes .review/${card.id}.red), then implement within allow_paths and run the DoD. Record the result with \`aidlc card attempt ${card.id} --outcome success|fail --cause ...\`.`
          : `${repairPrefix}Attempt ${attemptNo} at effort ${effort}: implement/repair within allow_paths, run \`${card.dod_command}\` and the affected checks, then record the attempt outcome (\`aidlc card attempt\`) with the DoD receipt.`,
      },
    };
  }

  /** Record an attempt outcome and, on success, the DoD/RED receipts. */
  recordAttempt(goal: Goal, card: Card, run: CardRun, input: { outcome: 'success' | 'fail' | 'not-counted'; cause?: string; notCountedReason?: 'expected-red' | 'quota' | 'admission-hold' | 'tool-outage' | 'env-setup'; progress?: boolean; evidence?: string; dodReceipt?: string; redReceipt?: string; candidateSha?: string; checksGained?: string[]; checksLost?: string[] }): CardRun {
    const now = this.clock();
    // A success that lost checks contradicts itself: lost checks are a failed check, recorded as one.
    if (input.outcome === 'success' && input.checksLost?.length) throw new Error(`a successful attempt cannot report lost checks (${input.checksLost.join(', ')}); record the attempt as fail with the cause`);
    // The stored run, as everywhere: a caller's snapshot never writes its generation, a stop or older evidence back. This
    // writer applies no fence (see docs/OPERATIONS.md, Sessions): what it records lands on the stored run as it is.
    run = this.store.getCardRun(goal.id, card.id) ?? run;
    // A success on a tdd card binds the candidate and ends the episode; without a RED receipt the card could never ship, so
    // it is refused before anything is recorded and the caller records it again with the receipt.
    if (input.outcome === 'success' && card.tdd && !run.redReceipt && !input.redReceipt) throw new Error(`a successful attempt on tdd card ${card.id} needs a RED receipt: none is recorded on the run and the attempt carries none; record it again with --red-receipt "<sha>:<test>"`);
    const ladder = goal.roleProfiles.find((p) => p.role === 'implementer')?.supportedEfforts ?? ['low', 'medium', 'high'];
    let episode = run.effort ?? createEpisode(card.id, 'implementer', ladder.includes('medium') ? 'medium' : ladder[0]!, ladder);
    if (!episode.attempts.some((a) => a.outcome === 'running')) {
      // The agent skipped `card next`: open the attempt under the same bounded rules before finishing it.
      const action = nextEffortAction(episode, { harderProblem: true, limitsPermit: checkAdmission(run.deadline, now).phase === 'open' });
      if (action.action !== 'attempt') throw new Error(action.action === 'stop' ? `no attempt may start: ${action.reason}: ${action.detail}` : 'episode already succeeded; ship the candidate instead');
      episode = startAttempt(episode, action.effort, now);
      this.journal(goal.id).append({ type: 'ATTEMPT_STARTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { n: action.n, effort: action.effort, escalated: action.escalated, implicit: true } });
    }
    episode = finishAttempt(episode, { finishedAt: now, outcome: input.outcome, cause: input.cause, notCountedReason: input.notCountedReason, progress: input.progress, evidence: input.evidence, checksGained: input.checksGained, checksLost: input.checksLost });
    this.journal(goal.id).append({ type: 'ATTEMPT_FINISHED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { outcome: input.outcome, cause: input.cause, progress: input.progress, evidence: input.evidence } });
    let candidate = run.candidate;
    if (input.outcome === 'success') {
      if (this.config.shipPath !== 'dry-run' && run.worktree && existsSync(run.worktree)) {
        try {
          const c = this.git.candidate(run.worktree);
          candidate = { sha: c.sha, dirty: c.dirty, untracked: c.untracked, digest: c.digest };
        } catch {
          /* keep prior */
        }
      } else if (input.candidateSha) {
        candidate = { sha: input.candidateSha, dirty: false, untracked: [], digest: input.candidateSha };
      }
      // The success that clears a merge-conflict repair records the merge of a moved base: a base-sync candidate
      // (T0-BASE-SYNC-REVIEW). So does the repair of a base-sync candidate no R3 decision has decided yet (an R2 block after
      // the merge): the base moved all the same, and the repaired merge is reviewed rather than stopped.
      const prior = run.candidate;
      const repairsBaseSync = prior?.baseSync === true && !run.review.invocations.some((i) => i.candidateDigest === prior.digest && (i.outcome === 'pass' || i.outcome === 'block'));
      if (candidate && ((run.pendingRepair?.kind === 'merge-conflict' && clearsPendingRepair(run.pendingRepair, input)) || repairsBaseSync)) candidate = { ...candidate, baseSync: true };
    }
    // A failed check, or lost checks, leave no DoD evidence: neither the active receipt nor the one a block retained.
    const checksHold = input.outcome === 'not-counted' && !input.checksLost?.length;
    return this.save({ ...run, effort: episode, dodReceipt: input.outcome === 'success' ? (input.dodReceipt ?? `dod:${now}`) : checksHold ? run.dodReceipt : undefined, redReceipt: input.redReceipt ?? run.redReceipt, candidate, pendingRepair: clearsPendingRepair(run.pendingRepair, input) ? undefined : run.pendingRepair, blockedReceipt: checksHold ? run.blockedReceipt : undefined });
  }

  private ship(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    if (hasUnreconciledRerun(run.ci)) {
      const next = this.save({ ...run, state: 'WAIT' });
      return { run: next, directive: { kind: 'wait', cardId: card.id, on: 'ci-rerun', pollSeconds: 90, narration: 'A CI rerun is persisted but not reconciled; look it up (aidlc card ci-reconcile) before shipping again.' } };
    }
    // R2: a fresh pre-review pass for this candidate is required before any ship is issued. The gate may have
    // written the run (a dropped abandoned round, a recorded hand-off): the ship continues from that record.
    const gate = this.preReviewGate(goal, card, run);
    if (gate.directive) return { run: gate.run, directive: gate.directive };
    run = gate.run;
    // The gate may have reloaded the run from the locked record (a dropped round, a recorded hand-off): a stop or a
    // lost candidate recorded meanwhile is honoured here, before any further write or external effect.
    const reloaded = this.revalidateReloaded(card, run, true);
    if (reloaded) return { run, directive: reloaded };
    // R3 as a command: a fresh formal pass for this candidate before any ship is issued.
    const formal = this.formalReviewGate(goal, card, run);
    if (formal) return formal;
    // A ship-path decision is bound here, before any intent: the policy in force (R8) and the delta since the formal stage's
    // last reviewed candidate (R9); a delta above the cap refuses the dispatch with nothing recorded.
    const bindings = this.shipBindings(run);
    // Fence and record intent before the external mutation.
    try {
      if (run.ownerGeneration !== undefined) this.leases.fence(resourceKeys.card(this.repo.key, card.id), run.ownerGeneration, currentActor(), now);
    } catch (err) {
      const stop = makeStop('ownership', (err as FencedError).message, 'revalidate ownership; a stale generation cannot commit an admitted effect', { at: now });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    const candidateDigest = run.candidate?.digest ?? 'unknown';
    const duplicate = this.ops.findDuplicate({ kind: 'merge', goalId: goal.id, cardId: card.id, target: this.config.base, candidateDigest, ownerGeneration: run.ownerGeneration ?? 0, timeoutMs: 1 });
    if (duplicate && ['issued', 'running', 'UNKNOWN'].includes(duplicate.status)) {
      const next = this.save({ ...run, state: 'WAIT' });
      return { run: next, directive: { kind: 'wait', cardId: card.id, on: `operation:${duplicate.id}`, pollSeconds: 60, narration: `A ship for this candidate is already ${duplicate.status} (${duplicate.id}); reconcile it instead of launching a second one.` } };
    }
    const op = this.ops.recordIntent({ kind: 'merge', goalId: goal.id, cardId: card.id, target: this.config.base, candidateDigest, ownerGeneration: run.ownerGeneration ?? 0, timeoutMs: 60 * 60 * 1000, effects: ['push', 'pr', 'review', 'ci', 'merge'] });
    this.journal(goal.id).append({ type: 'OPERATION_INTENT', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId: op.id, kind: 'merge', candidateDigest } });
    // Shared review admission (MS3): one request per candidate/base/policy/reviewer.
    const key = reviewRequestKey({ repository: goal.repository, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: this.config.reviewer });
    let enq = this.queue.enqueue({ pool: goal.reviewPool, repository: goal.repository, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: this.config.reviewer, requester: `${goal.id}:${card.id}`, deadline: run.deadline, now });
    if (enq.status === 'completed') {
      // Same candidate shipped again (no-verdict retry or CI rerun): the request is requeued in order; the
      // ledger's allowances (one no-verdict retry, one rerun) decide whether it may run at all.
      enq = { status: 'enqueued', request: this.queue.requeue(key, now) };
    }
    this.journal(goal.id).append({ type: 'REVIEW_REQUESTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { key, status: enq.status } });
    if (enq.status === 'joined' && enq.request.state === 'running') {
      this.ops.markResult(op.id, 'cancelled', { error: 'joined running review request' });
      const next = this.save({ ...run, state: 'WAIT' });
      return { run: next, directive: { kind: 'wait', cardId: card.id, on: `review:${key}`, pollSeconds: 60, narration: 'A matching review is already running in the shared pool; join it instead of launching another.' } };
    }
    const admit = this.admitReview(goal, card, key, now);
    if (admit.status !== 'admitted' || admit.request.key !== key) {
      this.ops.markResult(op.id, 'cancelled', { error: `review not admitted: ${admit.status}` });
      const next = this.save({ ...run, state: 'WAIT' });
      const until = admit.status === 'reset-pending' ? ` until ${admit.resetAt}` : '';
      return { run: next, directive: { kind: 'wait', cardId: card.id, on: `review-pool:${goal.reviewPool}:${admit.status}`, pollSeconds: 120, narration: `Review pool ${goal.reviewPool} is ${admit.status}${until}; waiting holds no active slot. Continue independent work within limits.` } };
    }
    this.journal(goal.id).append({ type: 'REVIEW_ADMITTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { key, seq: admit.request.seq } });
    // The record is re-read under the card-run lock right before the external effect: the candidate this ship was issued
    // for must still be the record's, with its receipts, no stop, no round or decision reserved meanwhile and the same
    // owner generation; anything else cancels the intent and the pool request and sends the caller back to `card next`.
    let armed: CardRun;
    try {
      armed = this.store.updateCardRun(goal.id, card.id, (current) => current ?? run);
    } catch (err) {
      // Nothing was dispatched: the intent and the pool admission are withdrawn, each step on its own so none masks the
      // failure or skips the next; the failure is the caller's.
      const reason = `ship not dispatched: ${(err as Error).message}`;
      try {
        this.ops.markResult(op.id, 'cancelled', { error: reason });
      } catch {
        /* the operation is reconciled from the ledger */
      }
      try {
        this.journal(goal.id).append({ type: 'OPERATION_RESULT', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId: op.id, status: 'cancelled', reason: (err as Error).message } });
      } catch {
        /* the journal is reconciled from the ledger */
      }
      try {
        this.queue.cancel(key, reason, now);
      } catch {
        /* the request is reconciled from the pool */
      }
      throw err;
    }
    const drift = this.shipDrift(card, armed, run);
    if (drift) {
      // Nothing is dispatched: the intent and the pool admission are withdrawn, each step on its own so none skips the
      // next or hides the drift; a step that failed is named in the directive and reconciled from its ledger.
      const failures: string[] = [];
      try {
        this.ops.markResult(op.id, 'cancelled', { error: `ship not dispatched: ${drift}` });
      } catch (err) {
        failures.push(`operation ${op.id} not marked cancelled (${(err as Error).message})`);
      }
      try {
        this.journal(goal.id).append({ type: 'OPERATION_RESULT', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId: op.id, status: 'cancelled', reason: drift } });
      } catch (err) {
        failures.push(`journal not appended (${(err as Error).message})`);
      }
      try {
        this.queue.cancel(key, `ship not dispatched: ${drift}`, now);
      } catch (err) {
        failures.push(`pool request ${key} not cancelled (${(err as Error).message})`);
      }
      const cleanup = failures.length ? ` Cleanup left to reconcile: ${failures.join('; ')}.` : '';
      if (armed.stop || armed.state === 'STOP') {
        const stop = armed.stop ?? makeStop('card', drift, 'inspect the card run record', { at: now, global: false });
        return { run: armed, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
      }
      return { run: armed, directive: { kind: 'wait', cardId: card.id, on: 'record-changed', pollSeconds: 0, narration: `The card run changed after the ship gate (${drift}); nothing was dispatched. Run \`aidlc card next ${card.id}\` again.${cleanup}` } };
    }
    this.ops.markIssued(op.id, undefined, now);
    this.journal(goal.id).append({ type: 'OPERATION_ISSUED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId: op.id } });
    const result = this.shipPath.ship({ cardId: card.id, base: this.config.base, mode: armed.mode, skipRed: !card.tdd, timeoutMs: 60 * 60 * 1000, candidateSha: armed.candidate?.sha });
    return this.applyShipResult(goal, card, armed, result, op.id, key, candidateDigest, bindings);
  }

  /**
   * What binds a ship-path decision at dispatch (its reviewer receives no prompt): the sha256 of the REVIEW.md in force, recorded
   * when the verdict document names no `policy_hash`, and the paths of the delta since the candidate the formal stage last
   * reviewed, against which its new findings are marked: none before the stage's first decision, empty for the same commit,
   * the committed diff for another commit in a git repository (a delta above the cap refuses the dispatch), none elsewhere.
   */
  shipBindings(run: CardRun): { policyHash: string; deltaPaths?: string[] } {
    const since = this.lastReviewedSha(run, 'formal');
    const sha = run.candidate?.sha;
    const deltaPaths = since === undefined ? undefined : since === sha ? [] : this.repo.isGit && sha ? this.collectDelta(this.reviewCheckout(run), since, sha, this.config.formalReview.maxDiffBytes, 'formalReview.maxDiffBytes').changedPaths : undefined;
    return { policyHash: policyHash(this.reviewPolicy()), deltaPaths };
  }

  /** Why the record re-read before the ship dispatch is not the one the gate admitted; undefined when it still is. */
  private shipDrift(card: Card, armed: CardRun, issued: CardRun): string | undefined {
    if (armed.stop || armed.state === 'STOP') return `the card run was stopped (${armed.stop?.reason ?? 'STOP'})`;
    if ((armed.candidate?.digest ?? 'unknown') !== (issued.candidate?.digest ?? 'unknown')) return `the candidate changed (${(issued.candidate?.digest ?? 'unknown').slice(0, 12)} admitted, ${(armed.candidate?.digest ?? 'none').slice(0, 12)} recorded meanwhile)`;
    if (!armed.dodReceipt || (card.tdd && !armed.redReceipt) || armed.candidate?.dirty) return 'the candidate is no longer ready (a receipt was cleared meanwhile)';
    const round = armed.preReview.rounds.find((r) => r.outcome === 'pending');
    if (round) return `a pre-review round was reserved meanwhile (${round.reservationId ?? round.requestedAt})`;
    const decision = armed.review.invocations.find((i) => i.outcome === 'pending');
    if (decision) return `a formal review was reserved meanwhile (${decision.invocationId})`;
    if (armed.ownerGeneration !== issued.ownerGeneration) return `the owner generation changed (${issued.ownerGeneration ?? 'none'} admitted, ${armed.ownerGeneration ?? 'none'} recorded meanwhile)`;
    // The review gates are recomputed on the reloaded record, not carried over from the admitted snapshot: a decision
    // recorded meanwhile moves the ledger (a block advances the cycle, and a candidate admitted on the exhausted hand-off
    // of the previous cycle holds no round in the new one), and a formal pass recorded meanwhile is not the one admitted.
    if (armed.review.substantiveBlocks !== issued.review.substantiveBlocks || armed.review.substantiveDecisions !== issued.review.substantiveDecisions) {
      return `the review ledger changed (cycle ${issued.review.substantiveBlocks}, ${issued.review.substantiveDecisions} decision(s) admitted; cycle ${armed.review.substantiveBlocks}, ${armed.review.substantiveDecisions} decision(s) recorded meanwhile)`;
    }
    const digest = armed.candidate?.digest ?? 'unknown';
    const eligibility = this.preReviewEligibility(armed, digest);
    if (!eligibility.eligible) return `the candidate lost its pre-review eligibility (${eligibility.reason})`;
    const formal = this.config.formalReview;
    if (formal.command.length) {
      const last = this.lastFormalInvocation(armed.review.invocations, digest);
      const admitted = last?.outcome === 'pass' || (last?.outcome === 'block' && !this.invocationBlocking(armed, card, last));
      if (!admitted) return `the candidate lost its formal review admission (${last?.outcome ?? 'no decision'} recorded meanwhile)`;
    }
    return undefined;
  }

  /**
   * A run reloaded from the locked record inside SHIP is not the caller's snapshot any more: a stop recorded meanwhile
   * ends the call as it stands, and a candidate no longer ready (a receipt cleared by a failed check meanwhile) sends
   * the caller back to `card next`, which re-derives the state from the record.
   */
  private revalidateReloaded(card: Card, run: CardRun, evidence: boolean): CardDirective | undefined {
    if (run.stop || run.state === 'STOP') {
      const stop = run.stop ?? makeStop('card', 'the card run was stopped while the ship gate ran', 'inspect the card run record', { at: this.clock(), global: false });
      return { kind: 'stop', cardId: card.id, stop, narration: stop.detail };
    }
    if (evidence && (!run.dodReceipt || (card.tdd && !run.redReceipt) || run.candidate?.dirty)) {
      return { kind: 'wait', cardId: card.id, on: 'evidence-changed', pollSeconds: 0, narration: `The card run changed while the ship gate ran (the candidate is no longer ready); run \`aidlc card next ${card.id}\` again.` };
    }
    return undefined;
  }

  /**
   * Pre-review gate inside SHIP (R2). Rounds are counted per R3 cycle (substantive R3 decisions so
   * far), so an R3 block restarts the cycle. A pass on the current candidate opens the ship; a block
   * was already handed back to BUILD by `preReview`; blocks beyond `rounds` apply `onExhausted`.
   */
  private preReviewGate(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive?: CardDirective } {
    const cfg = this.config.preReview;
    if (!cfg.command.length) return { run };
    const now = this.clock();
    const cycle = run.review.substantiveBlocks; // an R3 block restarts the pre-review cycle; an R3 pass does not
    const digest = run.candidate?.digest;
    // A round in flight parks the card; one abandoned past the reviewer timeout and the reconciliation grace is dropped.
    const pending = run.preReview.rounds.find((r) => r.outcome === 'pending');
    if (pending) {
      // A round whose dispatch failed before any receipt (its retained failure marker, no log) never ran: it expires at once.
      const reviewDir = path.join(this.reviewCheckout(run), '.review');
      const failedBeforeDispatch = (r: PreReviewRound) => r.reservationId !== undefined && existsSync(path.join(reviewDir, `${r.reservationId}.failed.json`)) && !existsSync(path.join(reviewDir, `${r.reservationId}.log`)) && !existsSync(path.join(reviewDir, `${r.reservationId}.json`));
      const expiry = (r: PreReviewRound) => (failedBeforeDispatch(r) ? Date.parse(r.requestedAt) : Date.parse(r.requestedAt) + cfg.timeoutMs + RECONCILE_GRACE_MS);
      if (Date.parse(now) < expiry(pending)) {
        const next = this.save({ ...run, state: 'WAIT' });
        return { run: next, directive: { kind: 'wait', cardId: card.id, on: `pre-review:${pending.reservationId ?? pending.requestedAt}`, pollSeconds: 60, narration: `A pre-review round of this candidate is in flight (requested ${pending.requestedAt}); wait for it instead of dispatching another. A round is dropped ${Math.round((cfg.timeoutMs + RECONCILE_GRACE_MS) / 60_000)} minutes after its dispatch when nothing came back.` } };
      }
      // Abandonment is decided on the locked record: only a round still pending and still expired there is dropped, and
      // only that drop is journaled; a round decided meanwhile stays and drives the gate from here on.
      let cancelled: PreReviewRound | undefined;
      run = this.store.updateCardRun(goal.id, card.id, (current) => {
        const latest = current ?? run;
        const still = latest.preReview.rounds.find((r) => r.outcome === 'pending' && r.reservationId === pending.reservationId && r.requestedAt === pending.requestedAt);
        if (!still || Date.parse(now) < expiry(still)) return latest;
        cancelled = still;
        return { ...latest, preReview: { ...latest.preReview, rounds: latest.preReview.rounds.filter((r) => r !== still) } };
      });
      if (cancelled) this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle: cancelled.cycle, round: cancelled.round, reviewer: cancelled.reviewer, candidateDigest: digest, outcome: 'no-verdict', decision: 'abandoned: no result within the timeout and the grace', reservationId: cancelled.reservationId, findings: [], reraised: [], resolved: [], policyHash: cancelled.policyHash } });
      // The gate's own logic handles the reloaded evidence (a decided round, a cleared receipt); only a stop ends it here.
      const reloaded = this.revalidateReloaded(card, run, false);
      if (reloaded) return { run, directive: reloaded };
      // The reloaded record may hold another candidate or another cycle: the gate reads them from it, never from the caller's copy.
      if (run.candidate?.digest !== digest || run.review.substantiveBlocks !== cycle) {
        return { run, directive: { kind: 'wait', cardId: card.id, on: 'record-changed', pollSeconds: 0, narration: `The card run changed while the ship gate ran (${run.candidate?.digest !== digest ? 'the candidate' : 'the review cycle'} moved on); run \`aidlc card next ${card.id}\` again.` } };
      }
    }
    const rounds = run.preReview.rounds.filter((r) => r.cycle === cycle && r.outcome !== 'pending');
    const decided = rounds.filter((r) => r.outcome === 'pass' || r.outcome === 'block');
    const blocks = decided.filter((r) => r.outcome === 'block');
    // A pass stays valid for the candidate it reviewed, whatever cycle recorded it.
    if (run.preReview.rounds.some((r) => r.candidateDigest === digest && r.outcome === 'pass')) return { run };
    // Exhausted rounds decide first: a candidate after the last allowed block stops or ships, whether or not it changed.
    if (blocks.length >= cfg.rounds) {
      const residual = blocks[blocks.length - 1]?.reasons ?? [];
      const deadlock = describeDeadlock(run.findings);
      if (cfg.onExhausted === 'ship') {
        // The hand-off transaction reloads the run: a stop, another candidate or another cycle recorded meanwhile ends
        // the gate here, never with the exhaustion of a cycle the record has left.
        const handed = this.recordResidualHandoff(goal, card, run, cycle, digest ?? 'unknown');
        const reloaded = this.revalidateReloaded(card, handed, true);
        if (reloaded) return { run: handed, directive: reloaded };
        if (handed.candidate?.digest !== digest || handed.review.substantiveBlocks !== cycle) {
          return { run: handed, directive: { kind: 'wait', cardId: card.id, on: 'record-changed', pollSeconds: 0, narration: `The card run changed while the ship gate ran (${handed.candidate?.digest !== digest ? 'the candidate' : 'the review cycle'} moved on); run \`aidlc card next ${card.id}\` again.` } };
        }
        return { run: handed };
      }
      const stop = makeStop('review', `pre-review rounds exhausted (${blocks.length}/${cfg.rounds} blocks in R3 cycle ${cycle}); last block: ${residual.join(' | ') || 'see the retained verdicts'}${deadlock ? `; ${deadlock}` : ''}`, `read the retained verdicts under .review/${card.id}.pre.*; fix within scope and re-run, or set preReview.onExhausted to "ship" to hand the residual findings to R3`, { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    const last = [...rounds].reverse().find((r) => r.candidateDigest === digest);
    let disputedNote = '';
    if (last?.outcome === 'block') {
      const answered = this.blockAnswered(run, { stage: 'pre', cycle, round: last.round });
      if (!answered.answered) {
        // Reaching SHIP with a blocked, unrepaired candidate: hand it back with the reasons and the open finding ids.
        // The episode reopens so the repair can be recorded; the review budget, not the ladder, paid for the block.
        const next = this.save({ ...run, state: 'BUILD', dodReceipt: undefined, effort: run.effort ? reopenAfterReviewBlock(run.effort, 'pre-review block still pending') : run.effort, blockedReceipt: this.keepReceipt(run, { stage: 'pre', cycle, round: last.round, candidateSha: run.candidate?.sha }) });
        const admitted = run.effort ? nextEffortAction(run.effort, { harderProblem: true, limitsPermit: true }) : undefined;
        const ids = answered.open.length ? ` Open finding(s): ${answered.open.join(', ')}; dispute one with \`aidlc review dispute ${card.id} <id> --note "<why>"\`, and the round runs on the unchanged candidate once every finding of the block is disputed.` : '';
        return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: run.redReceipt, dodCommand: card.dod_command, effort: admitted?.action === 'attempt' ? admitted.effort : (run.effort?.baseline ?? 'medium'), attempt: (run.effort?.attempts.length ?? 0) + 1, skills: this.buildSkills(goal, card), narration: `Pre-review block still pending on candidate ${digest ?? 'unknown'}: ${last.reasons.join(' | ') || 'see the retained verdict'}. Fix within scope, rerun the DoD, record the attempt with the new candidate sha, then \`aidlc review pre ${card.id}\`.${ids}` } };
      }
      disputedNote = ` Every finding of round ${last.round} is disputed; the round runs on the unchanged candidate with the author's notes.`;
    }
    // A quota hold is WAIT, never a decision: park the card until the hold clears; no round is consumed.
    if (last?.outcome === 'quota-hold' && last.holdUntil && Date.parse(last.holdUntil) > Date.parse(now)) {
      const next = this.save({ ...run, state: 'WAIT' });
      const pollSeconds = Math.max(60, Math.ceil((Date.parse(last.holdUntil) - Date.parse(now)) / 1000));
      return { run: next, directive: { kind: 'wait', cardId: card.id, on: 'pre-review-quota', pollSeconds, narration: `Pre-reviewer ${cfg.reviewer} reported a quota/rate limit; holding until ${last.holdUntil} (no round consumed). Continue independent work within limits, then run \`aidlc card next ${card.id}\`.` } };
    }
    // One no-verdict retry per cycle (initial run plus one retry), like R3.
    const noVerdicts = rounds.filter((r) => r.outcome === 'no-verdict').length;
    if (last?.outcome === 'no-verdict' && noVerdicts > 1) {
      const stop = makeStop('tool', `pre-reviewer ${cfg.reviewer} produced no usable verdict twice in R3 cycle ${cycle} (${last.runStatus ?? 'unknown'})`, `inspect the retained output under .review/${card.id}.pre.*.log; fix the pre-review command or clear preReview.command to skip R2`, { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    const round = decided.length + 1;
    const retry = last?.outcome === 'no-verdict' ? ' (retry: the previous run produced no verdict)' : last?.outcome === 'quota-hold' ? ' (the previous run reported a quota hold; retry once it clears)' : '';
    const next = this.save({ ...run, state: 'SHIP' });
    return { run: next, directive: { kind: 'pre-review', cardId: card.id, round, maxRounds: cfg.rounds, reviewer: cfg.reviewer, narration: `Pre-review round ${round}/${cfg.rounds} (R2, ${cfg.reviewer}) before the ship${retry}: run \`aidlc review pre ${card.id}\`. A pass hands the candidate to the ship and R3; a block returns to BUILD with the reasons.${disputedNote}` } };
  }

  /**
   * R3 gate inside SHIP when the formal reviewer is a configured command. The existing ledger rules
   * apply unchanged (two substantive decisions, one no-verdict retry); a block was already handed to
   * REVIEW_FIX by `formalReview`; a quota hold dispatches the fallback when one is configured and not held, else parks the card
   * until the earlier hold clears.
   */
  private formalReviewGate(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive: CardDirective } | undefined {
    const primary = this.config.formalReview;
    if (!primary.command.length) return undefined;
    const now = this.clock();
    const digest = run.candidate?.digest;
    // A decision by either configured reviewer decides the candidate; the reviewer that runs next is resolved below.
    const last = this.lastFormalInvocation(run.review.invocations, digest);
    if (last?.outcome === 'pass') {
      // The ship paths read the canonical document: a publication that did not land at commit time is repaired here.
      this.repairCanonical(goal, card, run, last);
      return undefined;
    }
    let disputedNote = '';
    if (last?.outcome === 'block') {
      // Only a merge-blocking block is pending; advisory findings are retained and never become a silent merge bar, and the
      // advisory decision's canonical document (a pass with every finding under advisory) is repaired like a pass.
      if (!this.invocationBlocking(run, card, last)) {
        this.repairCanonical(goal, card, run, last);
        return undefined;
      }
      const answered = run.candidate?.sha ? this.blockAnswered(run, { stage: 'formal', candidateSha: run.candidate.sha }) : { answered: false, open: [] };
      if (!answered.answered) {
        const next = this.save({ ...run, state: 'REVIEW_FIX', dodReceipt: undefined, blockedReceipt: this.keepReceipt(run, { stage: 'formal', candidateSha: run.candidate?.sha }) });
        const ids = answered.open.length ? ` Open finding(s): ${answered.open.join(', ')}; dispute one with \`aidlc review dispute ${card.id} <id> --note "<why>"\`, and the next decision runs on the unchanged candidate once every finding of the block is disputed.` : '';
        return { run: next, directive: { kind: 'review-fix', cardId: card.id, reasons: run.review.lastVerdict?.reasons ?? [], remainingDecisions: Math.max(0, MAX_SUBSTANTIVE_REVIEW_DECISIONS - run.review.substantiveDecisions), narration: `Formal review block still pending on candidate ${digest ?? 'unknown'}: fix within scope or revert, rebuild, and record the attempt with the new candidate sha.${ids}` } };
      }
      disputedNote = ` Every finding of the last decision on this candidate is disputed; the next decision runs on the unchanged candidate with the author's notes.`;
    }
    const { cfg, waitUntil } = this.formalReviewerNow(run, digest, now);
    if (waitUntil) {
      const next = this.save({ ...run, state: 'WAIT' });
      const pollSeconds = Math.max(60, Math.ceil((Date.parse(waitUntil) - Date.parse(now)) / 1000));
      const held = primary.fallback ? `Formal reviewers ${primary.reviewer} and fallback ${primary.fallback.reviewer} both reported a quota/rate limit` : `Formal reviewer ${cfg.reviewer} reported a quota/rate limit`;
      return { run: next, directive: { kind: 'wait', cardId: card.id, on: 'review-quota', pollSeconds, narration: `${held}; holding until ${waitUntil} (not a decision). Then run \`aidlc card next ${card.id}\`.` } };
    }
    // R3 policy: a further required review beyond the two-decision allowance is STOP/review, never a third run, except the
    // one base-sync decision a base-sync candidate gets from `formalReview.baseSync` (T0-BASE-SYNC-REVIEW).
    const baseSyncDecision = this.baseSyncDue(run);
    if (run.review.substantiveDecisions >= MAX_SUBSTANTIVE_REVIEW_DECISIONS && !baseSyncDecision) {
      const stop = makeStop('review', `a further required review of candidate ${digest ?? 'unknown'} exceeds the two-decision allowance (${run.review.substantiveDecisions} used)`, 'return the retained verdict evidence for human adjudication; no counter reset', { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    const decision = run.review.substantiveDecisions + 1;
    const retry = last?.outcome === 'no-verdict' ? ' (retry: the previous run produced no verdict)' : '';
    const next = this.save({ ...run, state: 'SHIP' });
    if (baseSyncDecision) {
      return { run: next, directive: { kind: 'review', cardId: card.id, reviewer: cfg.reviewer, decision, maxDecisions: decision, narration: `Base-sync decision (R3, ${cfg.reviewer}) before the ship: both decisions are used and this candidate merges a moved base, so it gets one more decision of its own${retry}: run \`aidlc review r3 ${card.id}\`. A pass hands the candidate to the ship; a block stops the card for review.` } };
    }
    return { run: next, directive: { kind: 'review', cardId: card.id, reviewer: cfg.reviewer, decision, maxDecisions: MAX_SUBSTANTIVE_REVIEW_DECISIONS, narration: `Formal review (R3, ${cfg.reviewer}) before the ship, decision ${decision}/${MAX_SUBSTANTIVE_REVIEW_DECISIONS}${retry}: run \`aidlc review r3 ${card.id}\`. A pass hands the candidate to the ship; a merge-blocking block returns it to REVIEW_FIX and the repaired candidate restarts the pre-review cycle.${disputedNote}` } };
  }

  /**
   * The review pool a formal reviewer queues in: the goal's pool, or with a fallback configured one pool per reviewer
   * (`<pool>/<reviewer>`), since a quota hold resets the whole pool it lands in and the two reviewers hold separate quotas;
   * the ship's own admission stays in the goal's pool either way.
   */
  private formalPool(goal: Goal, cfg: FormalReviewer): string {
    // The base-sync reviewer always queues in its own pool (its quota is its own); the primary moves only with a fallback,
    // so a base-sync reviewer alone leaves the primary, its pool limits and its holds where they were (T0-BASE-SYNC-REVIEW).
    return this.config.formalReview.fallback !== undefined || cfg === this.config.formalReview.baseSync ? `${goal.reviewPool}/${cfg.reviewer}` : goal.reviewPool;
  }

  /**
   * R7: once one formal reviewer is admitted for a candidate, the card will not run the other one for it again unless its
   * hold passes, so the other reviewer's queued or held request for the candidate (the one a hold left behind) is cancelled
   * when this card is its only requester: left in its pool, it would be admitted by the next card's review once the hold
   * passes and occupy the slot with no one to run it. The pool's reset time is kept; a request another card joined stays.
   * Best-effort, like the other pool cancellations: a failure is journaled and never fails the review this card reserved.
   */
  private cancelOtherReviewerRequest(goal: Goal, card: Card, candidateDigest: string, cfg: FormalReviewer, now: string): void {
    const formal = this.config.formalReview;
    if (!formal.fallback) return;
    const other = cfg.reviewer === formal.reviewer ? formal.fallback : formal;
    const key = reviewRequestKey({ repository: goal.repository, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: other.reviewer });
    const requester = `${goal.id}:${card.id}`;
    try {
      const request = this.queue.get(key);
      if (!request || (request.state !== 'queued' && request.state !== 'retry-after') || !request.requesters.every((r) => r === requester)) return;
      this.queue.cancel(key, `formal review of ${card.id} continued on ${cfg.reviewer}`, now);
      this.journal(goal.id).append({ type: 'NOTE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { reviewRequestCancelled: key, reviewer: other.reviewer, continuedOn: cfg.reviewer } });
    } catch (err) {
      try {
        this.journal(goal.id).append({ type: 'NOTE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { reviewRequestCancelFailed: key, reviewer: other.reviewer, error: (err as Error).message } });
      } catch {
        /* the request stays; the review this card reserved goes on */
      }
    }
  }

  /** The names of the configured formal reviewers: the primary, and the fallback and the base-sync reviewer when configured. */
  private formalReviewerNames(): Set<string> {
    const formal = this.config.formalReview;
    return new Set([formal.reviewer, ...(formal.fallback ? [formal.fallback.reviewer] : []), ...(formal.baseSync ? [formal.baseSync.reviewer] : [])]);
  }

  /**
   * A base-sync decision is due on the run's candidate (T0-BASE-SYNC-REVIEW): `formalReview.baseSync` is configured, the
   * candidate is a base-sync candidate, both decisions are used, and no decision was taken on it yet. A base that moved makes
   * a new solution, and it is reviewed rather than carried; any other candidate past the allowance still stops for review.
   */
  private baseSyncDue(run: CardRun): boolean {
    const candidate = run.candidate;
    if (!this.config.formalReview.baseSync || !candidate?.baseSync) return false;
    if (run.review.substantiveDecisions < MAX_SUBSTANTIVE_REVIEW_DECISIONS) return false;
    return !run.review.invocations.some((i) => i.candidateDigest === candidate.digest && (i.outcome === 'pass' || i.outcome === 'block'));
  }

  /** The latest invocation on a candidate by either configured formal reviewer, whatever its outcome (pending included). */
  private lastFormalInvocation(invocations: ReviewInvocation[], candidateDigest: string | undefined): ReviewInvocation | undefined {
    const names = this.formalReviewerNames();
    return [...invocations].reverse().find((i) => names.has(i.reviewer) && i.candidateDigest === candidateDigest);
  }

  /** The settings of the formal reviewer an invocation names: the configured fallback under its own name, else the primary. */
  private formalReviewerFor(name: string | undefined): FormalReviewer {
    const primary = this.config.formalReview;
    if (primary.baseSync && name === primary.baseSync.reviewer) return primary.baseSync;
    return primary.fallback && name === primary.fallback.reviewer ? primary.fallback : primary;
  }

  /**
   * The formal reviewer to dispatch for a candidate: the primary unless it holds an unexpired quota hold, then the
   * configured fallback unless it holds one too. With every configured reviewer held, `waitUntil` is the earlier hold and
   * `cfg` the reviewer whose hold clears first. With a fallback, a reviewer's hold is its latest invocation of the card on
   * any candidate, since a quota belongs to the reviewer and a repaired candidate has no invocation of its own yet;
   * without one it is the primary's latest invocation on the candidate, as before the fallback existed.
   */
  private formalReviewerNow(run: CardRun, candidateDigest: string | undefined, now: string): { cfg: FormalReviewer; waitUntil?: string } {
    const primary = this.config.formalReview;
    // A due base-sync decision goes to the base-sync reviewer alone; its hold is its latest invocation on the card.
    const baseSync = primary.baseSync;
    if (baseSync && this.baseSyncDue(run)) {
      const last = [...run.review.invocations].reverse().find((i) => i.reviewer === baseSync.reviewer);
      const hold = last?.outcome === 'quota-hold' && last.holdUntil && Date.parse(last.holdUntil) > Date.parse(now) ? last.holdUntil : undefined;
      return hold ? { cfg: baseSync, waitUntil: hold } : { cfg: baseSync };
    }
    const holdOf = (name: string): string | undefined => {
      const last = [...run.review.invocations].reverse().find((i) => i.reviewer === name && (primary.fallback !== undefined || i.candidateDigest === candidateDigest));
      return last?.outcome === 'quota-hold' && last.holdUntil && Date.parse(last.holdUntil) > Date.parse(now) ? last.holdUntil : undefined;
    };
    const primaryHold = holdOf(primary.reviewer);
    if (!primaryHold) return { cfg: primary };
    const fallback = primary.fallback;
    if (!fallback) return { cfg: primary, waitUntil: primaryHold };
    const fallbackHold = holdOf(fallback.reviewer);
    if (!fallbackHold) return { cfg: fallback };
    return Date.parse(fallbackHold) < Date.parse(primaryHold) ? { cfg: fallback, waitUntil: fallbackHold } : { cfg: primary, waitUntil: primaryHold };
  }

  /**
   * The candidate a review was prepared for (its diff collected, its guards checked) must still be the record's candidate
   * when the round or decision is reserved: a candidate recorded meanwhile refuses the reservation, and the command is
   * run again for the current candidate.
   */
  private refuseReplacedCandidate(current: CardRun, card: Card, stage: 'pre' | 'formal', candidateSha: string, candidateDigest: string): void {
    const sha = current.candidate?.sha;
    const digest = current.candidate?.digest ?? sha;
    if ((sha !== undefined && sha !== candidateSha) || (digest !== undefined && digest !== candidateDigest)) {
      throw new Error(`the candidate changed since the review was prepared (${candidateSha.slice(0, 12)} prepared, ${(sha ?? digest ?? 'none').slice(0, 12)} recorded meanwhile); run \`aidlc review ${stage === 'pre' ? 'pre' : 'r3'} ${card.id}\` again for the current candidate`);
    }
  }

  /**
   * The checkout as it is right before dispatch: still at the pinned candidate and still clean. The diff was collected
   * before the reservation; a change since then would send inputs the recorded candidate does not have.
   */
  private refuseChangedCheckout(current: CardRun, cwd: string, candidateSha: string): void {
    this.refuseDirtyCandidate(current, cwd);
    const head = this.pinnedCandidate(current, cwd);
    if (head !== candidateSha) throw new Error(`checkout ${cwd} moved to ${head.slice(0, 12)} since the review was prepared for ${candidateSha.slice(0, 12)}; check out the candidate and run the review again`);
  }

  /** One round or decision in flight per card, whatever the candidate: a reservation for any candidate refuses a second dispatch. */
  private inFlight(current: CardRun, stage: 'pre' | 'formal'): string | undefined {
    if (stage === 'pre') {
      const pending = current.preReview.rounds.find((r) => r.outcome === 'pending');
      return pending ? `a pre-review round of this card is in flight (candidate ${(pending.candidateSha ?? pending.candidateDigest).slice(0, 12)}, reservation ${pending.reservationId ?? 'unknown'}, requested ${pending.requestedAt}); wait for it, do not dispatch another` : undefined;
    }
    const pending = current.review.invocations.find((i) => i.outcome === 'pending');
    return pending ? `a formal review of this card is in flight (candidate ${(pending.candidateSha ?? pending.candidateDigest).slice(0, 12)}, ${pending.invocationId}, requested ${pending.requestedAt}); wait for it, do not dispatch another` : undefined;
  }

  /** The R3 guards over one record: stop, R2 eligibility, an in-flight decision, a quota hold, the same-candidate rule, the allowances. */
  private formalAdmission(current: CardRun, card: Card, candidateSha: string, candidateDigest: string, now: string, cfg: FormalReviewer): void {
    if (current.stop || current.state === 'STOP') throw new Error(`card run is stopped (${current.stop?.reason ?? 'STOP'}); no review may run: ${current.stop?.nextAction ?? 'resolve the stop first'}`);
    const eligibility = this.preReviewEligibility(current, candidateDigest);
    if (!eligibility.eligible) throw new Error(`pre-review pass required first (${eligibility.reason}): run \`aidlc review pre ${card.id}\` on candidate ${candidateSha.slice(0, 12)} before the formal review`);
    const ledger = current.review;
    const forCandidate = ledger.invocations.filter((i) => i.reviewer === cfg.reviewer && i.candidateDigest === candidateDigest);
    const inFlight = this.inFlight(current, 'formal');
    if (inFlight) throw new Error(inFlight);
    const lastForCandidate = forCandidate[forCandidate.length - 1];
    if (lastForCandidate?.outcome === 'quota-hold' && lastForCandidate.holdUntil && Date.parse(lastForCandidate.holdUntil) > Date.parse(now)) {
      throw new Error(`formal reviewer ${cfg.reviewer} is on a quota hold until ${lastForCandidate.holdUntil}; do not re-run before it clears`);
    }
    // The reviewer resolved on this record must be the one the dispatch was prepared for: a hold recorded or cleared meanwhile moves it.
    const active = this.formalReviewerNow(current, candidateDigest, now);
    if (active.waitUntil) throw new Error(`formal reviewer ${active.cfg.reviewer} is on a quota hold until ${active.waitUntil}; do not re-run before it clears`);
    if (active.cfg.reviewer !== cfg.reviewer) throw new Error(`the formal reviewer changed since the review was prepared (${cfg.reviewer} prepared, ${active.cfg.reviewer} due now); run the command again`);
    // Same-candidate rule, keyed by the committed sha and independent of the reviewer's name: a blocked, unchanged
    // candidate (an advisory block included) is re-decided only with every finding of the block disputed.
    const lastDecided = [...ledger.invocations].reverse().find((i) => ((i.candidateSha ?? i.candidateDigest) === candidateSha || i.candidateDigest === candidateDigest) && (i.outcome === 'pass' || i.outcome === 'block'));
    if (lastDecided?.outcome === 'block') {
      const answered = this.blockAnswered(current, { stage: 'formal', candidateSha });
      if (!answered.answered) throw new Error(this.sameCandidateRefusal(card, candidateSha, 'its last formal decision', answered.open));
    }
    // A decision in flight for another candidate is spent as far as the allowance is concerned.
    const pendingDecisions = ledger.invocations.filter((i) => i.outcome === 'pending').length;
    // The one base-sync decision of a base-sync candidate is outside the allowance (T0-BASE-SYNC-REVIEW): `active` above
    // resolves the base-sync reviewer only for a due base-sync decision and requires it to be the reviewer prepared for.
    const baseSyncDecision = cfg === this.config.formalReview.baseSync;
    if (ledger.substantiveDecisions + pendingDecisions >= MAX_SUBSTANTIVE_REVIEW_DECISIONS && !baseSyncDecision) {
      throw new Error(`the two-decision review allowance is used (${ledger.substantiveDecisions} decided${pendingDecisions ? `, ${pendingDecisions} in flight` : ''}); ${this.lastFormalInvocation(ledger.invocations, candidateDigest)?.outcome === 'pass' ? 'the current candidate already holds its pass, ship it' : 'a further required review is STOP/review'}, not another run`);
    }
    if (ledger.noVerdictRetriesUsed > MAX_NO_VERDICT_RETRIES) {
      throw new Error(`no verdict after the single retry (${ledger.noVerdictRetriesUsed} used); the card is STOP/review, not another run`);
    }
  }

  /**
   * R3 as a command: run the formal reviewer on the committed candidate, write the candidate-bound
   * verdict file the ship paths read (`.review/<card>.json`) and record the decision through the
   * existing R3 ledger (`recordReviewOutcome`), so the two-decision allowance and the single
   * no-verdict retry apply exactly as for a ship-path reviewer.
   */
  async formalReview(goal: Goal, card: Card, run: CardRun): Promise<{ run: CardRun; classified: ClassifiedVerdict; verdict?: Verdict; advisory: string[]; verdictRef?: string; logRef?: string; durationMs: number; receiptSha256: string; reviewer: string }> {
    if (!this.config.formalReview.command.length) throw new Error('formalReview.command is not configured (aidlc.config.json)');
    // Guards read the persisted run, not the caller's snapshot, so overlapping calls see each other's reservation.
    let persisted = this.store.getCardRun(goal.id, card.id) ?? run;
    const reviewDir = path.join(this.reviewCheckout(persisted), '.review');
    // A result retained for a reservation of this card whose commit did not land (the card-run lock was held by another
    // writer at the time) is committed now, under the same invocation, without running the reviewer again. The recovery
    // comes before every guard of a new dispatch: a run stopped meanwhile commits it as evidence only (`commitReviewed`
    // releases the reservation), so neither the reservation nor its pool request stays occupied behind the stop.
    const stoppedBefore = Boolean(persisted.stop || persisted.state === 'STOP');
    const retained = this.retainedFormalResult(goal, card, persisted, reviewDir);
    if (retained) {
      // The original pool request is settled first, under the key and queue sequence the envelope recorded (the key of the
      // reservation's own base, policy version and reviewer when no envelope exists): a newer request under the same
      // reusable key is another review's and is left alone.
      this.settlePoolRequest(retained.key, retained.seq, retained.holdUntil, retained.verdictRef, retained.at);
      const committed = this.commitFormalResult(goal, card, persisted, retained);
      // A result that stops the run itself (a second no-verdict, a second block) is that result; only a run stopped before
      // the recovery falls through to the stop below.
      if (!stoppedBefore) return committed;
      persisted = this.store.getCardRun(goal.id, card.id) ?? committed.run;
    }
    if (persisted.stop || persisted.state === 'STOP') throw new Error(`card run is stopped (${persisted.stop?.reason ?? 'STOP'}); no review may run: ${persisted.stop?.nextAction ?? 'resolve the stop first'}`);
    const now = this.clock();
    const cwd = this.reviewCheckout(persisted);
    this.refuseDirtyCandidate(persisted, cwd);
    const baseRef = persisted.base?.oid ?? this.config.base;
    const candidateSha = this.pinnedCandidate(persisted, cwd);
    const candidateDigest = persisted.candidate?.digest ?? candidateSha;
    // The primary, or the fallback while the primary holds a quota hold (on the card when a fallback is configured); admission
    // re-checks it under the lock.
    const cfg = this.formalReviewerNow(persisted, candidateDigest, now).cfg;
    // The base-sync reviewer is resolved only for a due base-sync decision; admission re-checks it on the locked record.
    const baseSyncDecision = cfg === this.config.formalReview.baseSync;
    const capName = cfg === this.config.formalReview ? 'formalReview.maxDiffBytes' : cfg === this.config.formalReview.baseSync ? 'formalReview.baseSync.maxDiffBytes' : 'formalReview.fallback.maxDiffBytes';
    const reviewPolicy = this.reviewPolicy();
    const hash = policyHash(reviewPolicy);
    // The learned invariants are a prompt input like the policy and the diff: read here, with everything else this dispatch
    // sends, before its first mutation (T1-REVIEW-INPUTS), so a lesson written later never changes what the reviewer receives.
    const lessons = reviewLessons(this.lessonsFile());
    // The cap is checked first (R7): a candidate diff or a delta above it is refused before the hand-off, the release of a
    // failed reservation, the pool request and the reservation, so nothing records the refused review.
    const { changedPaths, diff } = collectCandidateDiff(this.runner, cwd, baseRef, cfg.maxDiffBytes, this.repo.isGit ? candidateSha : 'HEAD', capName);
    if (!diff.trim()) throw new Error(`no committed candidate diff against ${baseRef} in ${cwd}; commit the candidate first`);
    // The effort level is an input like the diff and is counted from the pinned --text diff collected for the review (so a
    // file git treats as binary counts its shown hunks), with the dispatched reviewer's policy, before the first
    // mutation: a retry of the candidate on that reviewer runs at the same level, and a moved HEAD changes nothing.
    const effort: ReviewEffortLevel | undefined = cfg.command.some((a) => a.includes('{effort}')) ? selectReviewEffortFromDiff(cfg.effort, diff, changedPaths, pathAllowed) : undefined;
    // The delta since the candidate the stage last decided on (R9), collected before the lock and bound to that decision under it.
    let since = this.lastReviewedSha(persisted, 'formal');
    let delta = since ? this.collectDelta(cwd, since, candidateSha, cfg.maxDiffBytes, capName) : undefined;
    persisted = this.releaseFailedReservation(goal, card, persisted, reviewDir);
    // The release re-reads the record: a decision another window committed meanwhile moves the last reviewed candidate, and the delta follows it (under the same cap) before anything is reserved.
    if (this.lastReviewedSha(persisted, 'formal') !== since) {
      since = this.lastReviewedSha(persisted, 'formal');
      delta = since ? this.collectDelta(cwd, since, candidateSha, cfg.maxDiffBytes, capName) : undefined;
    }
    // Exhausted rounds reach R3 through the command as through the gate: the hand-off is recorded once either way, and only
    // after the last cap check, so a refused review never records it; a decision landing during its write is caught by the
    // reservation lock below (the hand-off itself is R2 bookkeeping and stands).
    const eligibility = this.preReviewEligibility(persisted, candidateDigest);
    if (eligibility.eligible && eligibility.exhausted) persisted = this.recordResidualHandoff(goal, card, persisted, persisted.review.substantiveBlocks, candidateDigest);
    this.formalAdmission(persisted, card, candidateSha, candidateDigest, now, cfg);
    // Only the lease owner at the run's generation may reserve a decision.
    if (persisted.ownerGeneration !== undefined) {
      this.renewOwnLease(card.id, persisted, now);
      this.leases.fence(resourceKeys.card(this.repo.key, card.id), persisted.ownerGeneration, currentActor(), now);
    }
    const schema = materialiseVerdictSchema(reviewDir);
    // Deterministic scope gate (dimension 1): no model call, no decision consumed.
    const outOfScope = changedPaths.filter((p) => !pathAllowed(p, card.allow_paths));
    if (outOfScope.length) throw new Error(`out of scope: ${outOfScope.join(', ')} outside allow_paths; revert the change or amend the card before the formal review (no decision consumed)`);
    // Shared review admission (MS3): the command reviewer takes a pool slot like any other formal reviewer.
    const key = reviewRequestKey({ repository: goal.repository, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer });
    // A request already stored under this key keeps its pool: enqueue and requeue never move it, so admission reads that pool.
    const pool = this.queue.get(key)?.pool ?? this.formalPool(goal, cfg);
    let enq = this.queue.enqueue({ pool, repository: goal.repository, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer, requester: `${goal.id}:${card.id}`, deadline: run.deadline, now });
    if (enq.status === 'completed') enq = { status: 'enqueued', request: this.queue.requeue(key, now) };
    if (enq.status === 'joined' && enq.request.state === 'running') throw new Error(`a matching formal review is already running in pool ${JSON.stringify(pool)}; join it, do not dispatch another`);
    const admit = this.admitReview(goal, card, key, now, pool);
    if (admit.status !== 'admitted' || admit.request.key !== key) throw new Error(`review pool ${JSON.stringify(pool)} is ${admit.status === 'admitted' ? 'occupied by another request' : admit.status}; the formal review waits for admission (aidlc review status --pool ${JSON.stringify(pool)})`);
    const admittedSeq = admit.request.seq;
    this.journal(goal.id).append({ type: 'REVIEW_ADMITTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { key, seq: admittedSeq, reviewer: cfg.reviewer } });
    // Reserve the invocation under the card-run lock before dispatch so a concurrent call cannot spend the same decision.
    // The guards are re-checked on the locked record (a dispute withdrawn or a decision recorded since the first read
    // refuses here), the owner's lease is renewed and fenced in the same transaction, and the numbering, the prior
    // findings and the snapshot the reviewer receives come from that record. A refused reservation frees the pool slot.
    let fileStem = '';
    let invocationId = '';
    let decisionNo = 0;
    let priorFindings: PriorFinding[] = [];
    let advisoryNotes: string[] = [];
    let seen: Record<string, FindingSnapshot> = {};
    try {
      this.store.updateCardRun(goal.id, card.id, (locked) => {
        const current = locked ?? persisted;
        this.refuseReplacedCandidate(current, card, 'formal', candidateSha, candidateDigest);
        this.refuseChangedCheckout(current, cwd, candidateSha);
        this.formalAdmission(current, card, candidateSha, candidateDigest, now, cfg);
        if (this.lastReviewedSha(current, 'formal') !== since) throw new Error('a formal decision was recorded since the delta was collected; run the command again');
        if (current.ownerGeneration !== undefined) {
          this.renewOwnLease(card.id, current, now);
          this.leases.fence(resourceKeys.card(this.repo.key, card.id), current.ownerGeneration, currentActor(), now);
        }
        const n = current.review.invocations.filter((i) => i.reviewer === cfg.reviewer).length + 1;
        fileStem = `${card.id}.r3.${n}.${randomUUID().slice(0, 8)}`;
        invocationId = `r3:${fileStem}`;
        decisionNo = current.review.substantiveDecisions + 1;
        priorFindings = this.priorFindingsFor(current);
        advisoryNotes = this.advisoryNotesFor(current, candidateSha, candidateDigest);
        seen = this.findingsSnapshot(current);
        const reservation: ReviewInvocation = { invocationId, candidateDigest, candidateSha, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer, requestedAt: now, outcome: 'pending', policyHash: hash, ...(effort ? { effort } : {}), ...(baseSyncDecision ? { baseSync: true } : {}) };
        // What the reviewer receives is retained next to its verdict, so a commit from the retained result binds the same snapshot.
        writeFileSync(path.join(reviewDir, `${fileStem}.reservation.json`), JSON.stringify({ invocationId, candidateSha, candidateDigest, requestedAt: now, changedPaths, seen, policyHash: hash, deltaPaths: delta?.changedPaths }, null, 2) + '\n', 'utf8');
        return { ...current, review: { ...current.review, invocations: [...current.review.invocations, reservation] } };
      });
    } catch (err) {
      this.queue.cancel(key, `formal review not dispatched: ${(err as Error).message}`, now);
      throw err;
    }
    // R7, once the dispatch is reserved: a refused reservation cancels nothing of the other reviewer.
    this.cancelOtherReviewerRequest(goal, card, candidateDigest, cfg, now);
    const promptInArgv = cfg.command.some((a) => a.includes('{instructions}'));
    const promptFor = () => buildReviewPrompt({ stage: 'formal', includeDiff: !promptInArgv, reviewPolicy, lessons, card, base: baseRef, head: candidateSha, changedPaths, diff, priorFindings, delta, advisoryNotes, round: decisionNo, maxRounds: Math.max(MAX_SUBSTANTIVE_REVIEW_DECISIONS, decisionNo), ...(baseSyncDecision ? { baseSync: true } : {}) });
    let panel: PanelResult | undefined;
    // Whether the reviewer process returned: a failure after that point is a lost result (charged as a no-verdict, the
    // reviewer ran), a failure before it a dispatch that never happened (released, nothing spent).
    let reviewerRan = false;
    const runner: Runner = async (command, args, options) => {
      const receipt = await this.asyncRunner(command, args, options);
      reviewerRan = true;
      return receipt;
    };
    let lost: Error | undefined;
    try {
      // The formal review is never fanned out: one exhaustive pass per decision.
      panel = await runReviewPanel({ runner, command: cfg.command, perspectives: [], promptFor, vars: { schema, cwd, base: baseRef, head: candidateSha, card: card.id, ...(effort ? { effort } : {}) }, cwd, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir, fileStem, head: candidateSha, reviewer: cfg.reviewer, changedPaths, policyHash: hash });
    } catch (err) {
      if (reviewerRan) lost = err as Error;
      else {
        // A dispatch that failed before any receipt. The failure is retained next to the reservation first (no lock needed),
        // naming the pool request it was admitted under, so the next command can finish what this cleanup cannot; the pool
        // request is cancelled next (a review that never ran holds no result to look up); the reservation is released last,
        // and only once the cancellation landed: a reservation whose request could not be cancelled stays, with its marker,
        // as the recoverable state `releaseFailedReservation` settles. None of it masks the dispatch error.
        try {
          writeFileSync(path.join(reviewDir, `${fileStem}.failed.json`), JSON.stringify({ invocationId, candidateSha, at: this.clock(), error: (err as Error).message, key, seq: admittedSeq }, null, 2) + '\n', 'utf8');
        } catch {
          /* the release below, or the expiry of the reservation, covers a marker that could not be written */
        }
        let cancelled = false;
        try {
          this.queue.cancel(key, `formal review did not run: ${(err as Error).message}`, this.clock());
          cancelled = true;
        } catch {
          /* the next command cancels the request from the marker before it releases the reservation */
        }
        if (cancelled) {
          try {
            this.releaseReservation(goal, card, invocationId);
          } catch {
            /* the retained failure releases it on the next command */
          }
        }
        throw err;
      }
    }
    const after = this.clock();
    const outcome: PanelResult['outcome'] = panel?.outcome ?? 'no-verdict';
    const runStatus: PanelResult['runStatus'] = panel?.runStatus ?? 'malformed';
    const reasons = panel?.reasons ?? [`the reviewer ran but its result was lost: ${lost?.message ?? 'retention failed'}`];
    const decided = outcome === 'pass' || outcome === 'block';
    // Keep the reviewer's own binding: an explicit sha or branch that is not this candidate is a stale verdict, never a pass.
    const verdict: Verdict | undefined = decided && panel?.verdict ? { ...panel.verdict, sha: panel.verdict.sha ?? candidateSha, branch: panel.verdict.branch ?? card.id, run_status: panel.runStatus } : undefined;
    const classified = this.classifyFormal(card, candidateSha, verdict, outcome, runStatus, reasons);
    // Timed from the clock after the run: a review can outlast the hold it reports.
    const holdUntil = classified.outcome === 'quota-hold' ? addMs(after, panel?.retryAfterMs ?? 15 * 60 * 1000) : undefined;
    const result: FormalResult = { invocationId, fileStem, reviewDir, candidateSha, candidateDigest, changedPaths, seen, policyHash: hash, deltaPaths: delta?.changedPaths, requestedAt: now, at: after, verdict, classified, advisory: panel?.advisory ?? [], verdictRef: panel?.verdictRef, logRef: panel?.logRef, durationMs: panel?.durationMs ?? 0, receiptSha256: panel?.receiptSha256 ?? '', holdUntil, reviewer: cfg.reviewer, effort, ...(baseSyncDecision ? { baseSync: true } : {}) };
    // The complete result is published next to its verdict, atomically, before the pool request is settled and the decision
    // committed: a later step that does not land is redone from the envelope (`retainedFormalResult`), never from the log.
    this.publishEnvelope(result, key, admittedSeq, outcome, runStatus, reasons, panel?.retryAfterMs);
    this.settlePoolRequest(key, admittedSeq, holdUntil, panel?.verdictRef, after);
    return this.commitFormalResult(goal, card, persisted, result);
  }

  /**
   * The canonical verdict document the ship paths read (`.review/<card>.json`), written atomically and naming the decision
   * it publishes; an advisory block is published as a consistent pass with every finding under `advisory`.
   */
  private publishCanonical(card: Card, reviewDir: string, verdict: Verdict, advisoryBlock: boolean, invocationId: string, hash: string | undefined, reviewer: string): void {
    const canonical = advisoryBlock
      ? { ...verdict, verdict: 'pass' as const, reasons: [], axes: { spec: { verdict: 'pass' as const, reasons: [] }, standards: { verdict: 'pass' as const, reasons: [] } }, advisory: [...new Set([...verdict.reasons, ...(verdict.axes?.spec?.reasons ?? []), ...(verdict.axes?.standards?.reasons ?? [])])] }
      : verdict;
    atomicWriteJson(path.join(reviewDir, `${card.id}.json`), { ...canonical, reviewer, invocationId, policy_hash: hash });
  }

  /**
   * The canonical verdict document of a committed, publishable decision (a pass, or an advisory block published as a pass),
   * repaired when the publication at commit time did not land: the file is missing, names another sha, or still carries an
   * earlier decision on the same sha (the block a disputed re-review then passed). The document is rebuilt from the
   * decision's committed result envelope (`<stem>.result.json`, bound to the invocation and agreeing with its outcome) with
   * the classification the ledger recorded, never from the verdict sidecar beside the envelope; a decision committed before
   * envelopes existed falls back to a sidecar whose verdict agrees with the recorded outcome. A repair that writes is
   * journaled once; a document that already publishes this decision is left alone.
   */
  private repairCanonical(goal: Goal, card: Card, run: CardRun, decided: ReviewInvocation): void {
    if (!decided.invocationId.startsWith('r3:')) return;
    const reviewDir = path.join(this.reviewCheckout(run), '.review');
    const canonicalFile = path.join(reviewDir, `${card.id}.json`);
    const sha = decided.candidateSha ?? run.candidate?.sha;
    try {
      if (existsSync(canonicalFile)) {
        const current = JSON.parse(readFileSync(canonicalFile, 'utf8')) as { sha?: string; verdict?: string; invocationId?: string };
        // Intact: this sha, published as a pass, by this decision (a document from before the binding existed is kept when it is a pass for this sha).
        if (current.sha === sha && current.verdict === 'pass' && (current.invocationId === undefined || current.invocationId === decided.invocationId)) return;
      }
    } catch {
      /* unreadable: repaired below */
    }
    const stem = decided.invocationId.slice(3);
    const readDoc = (file: string): Record<string, unknown> | undefined => {
      try {
        return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    };
    let verdict: Verdict | undefined;
    let source: 'envelope' | 'sidecar' | undefined;
    const envelope = this.completeEnvelope(readDoc(path.join(reviewDir, `${stem}.result.json`)), decided);
    if (envelope) {
      if (envelope.outcome === decided.outcome && envelope.verdict) {
        verdict = envelope.verdict;
        source = 'envelope';
      }
    } else {
      const raw = readDoc(path.join(reviewDir, `${stem}.json`));
      const parsed = raw ? parseVerdict(raw) : undefined;
      if (parsed && parsed.verdict === decided.outcome) {
        verdict = parsed;
        source = 'sidecar';
      }
    }
    // No agreeing document: the ship path reads the missing or stale file and refuses; the decision stays committed.
    if (!verdict || !source) return;
    try {
      this.publishCanonical(card, reviewDir, { ...verdict, sha: verdict.sha ?? sha, branch: verdict.branch ?? card.id, run_status: verdict.run_status ?? 'success' }, decided.outcome === 'block', decided.invocationId, decided.policyHash ?? envelope?.policyHash, decided.reviewer);
    } catch {
      return;
    }
    this.journal(goal.id).append({ type: 'NOTE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { canonicalRepaired: decided.invocationId, file: canonicalFile, source } });
  }

  /** The result envelope of a formal review, written atomically (`<stem>.result.json`), naming the pool request it was admitted under. */
  private publishEnvelope(r: FormalResult, key: string, seq: number, outcome: PanelResult['outcome'], runStatus: PanelResult['runStatus'], reasons: string[], retryAfterMs: number | undefined): void {
    // The verdict the decision was classified from travels inside the envelope: a recovery classifies from it alone.
    atomicWriteJson(path.join(r.reviewDir, `${r.fileStem}.result.json`), { invocationId: r.invocationId, candidateSha: r.candidateSha, candidateDigest: r.candidateDigest, at: r.at, key, seq, outcome, runStatus, reasons, retryAfterMs, holdUntil: r.holdUntil, advisory: r.advisory, verdict: r.verdict, verdictRef: r.verdictRef, logRef: r.logRef, durationMs: r.durationMs, receiptSha256: r.receiptSha256, changedPaths: r.changedPaths, seen: r.seen, policyHash: r.policyHash, deltaPaths: r.deltaPaths });
  }

  /**
   * The pool request of a formal review is completed (or held) once, and only the request the review was admitted under:
   * a request under the same reusable key with another queue sequence belongs to a later attempt of the candidate and is
   * left alone (a recovery without a sequence, from a reservation that left no envelope, settles by key). A request already
   * completed or cancelled is left alone; one on hold whose bookkeeping did not finish (the slot still held, the pool
   * deadline not persisted) is held again with its own deadline, which `ReviewQueue.hold` applies idempotently.
   */
  private settlePoolRequest(key: string, seq: number | undefined, holdUntil: string | undefined, verdictRef: string | undefined, at: string): void {
    const request = this.queue.get(key);
    if (!request) return;
    if (seq !== undefined && request.seq !== seq) return;
    if (request.state === 'completed' || request.state === 'cancelled') return;
    if (request.state === 'retry-after') {
      if (holdUntil) this.queue.hold(key, request.retryAfter ?? holdUntil, 'reviewer reported rate limit/quota (hold bookkeeping finished on recovery)', at);
      return;
    }
    if (holdUntil) this.queue.hold(key, holdUntil, 'reviewer reported rate limit/quota', at);
    else this.queue.complete(key, verdictRef ?? 'no-verdict', at);
  }

  /** The R3 classification of a verdict document against the candidate: a stale sha or branch is never a pass. */
  private classifyFormal(card: Card, candidateSha: string, verdict: Verdict | undefined, outcome: PanelResult['outcome'], runStatus: PanelResult['runStatus'], reasons: string[]): ClassifiedVerdict {
    let classified: ClassifiedVerdict;
    if (outcome === 'quota-hold') classified = { outcome: 'quota-hold', mergeBlocking: false, runStatus: 'tool_error', reasons, stale: false };
    else if (!verdict) classified = { outcome: 'no-verdict', mergeBlocking: false, runStatus, reasons: reasons.length ? reasons : ['missing or malformed verdict; never pass'], stale: false };
    else classified = classifyVerdict(verdict, { candidateSha, tier: card.tier, gateRequired: this.config.gateRequired });
    if (verdict && verdict.branch !== card.id) classified = { outcome: 'no-verdict', mergeBlocking: false, runStatus: 'malformed', reasons: [`stale verdict branch ${verdict.branch}`], stale: true };
    return classified;
  }

  /**
   * The result retained for a pending formal reservation of this card whose reviewer finished but whose commit did not
   * land: the complete result envelope published at completion, or a no-verdict when the reservation is older than the
   * reviewer timeout and the grace and left no envelope, together with the snapshot the reviewer received and the pool
   * request to settle (the envelope's, else the key of the reservation's own base, policy version and reviewer, never the
   * configuration current at recovery time). Undefined while the reviewer is still running.
   */
  private retainedFormalResult(goal: Goal, card: Card, persisted: CardRun, reviewDir: string): RetainedFormalResult | undefined {
    // Any pending formal reservation of the card whose complete result envelope was published, whatever the candidate:
    // a result for a candidate the author replaced meanwhile is committed as history by `commitReviewed`, never left in
    // flight. Without an envelope the reservation is a review still finishing until it is older than the reviewer
    // timeout and the grace (from its request when no log exists, from the log otherwise): then the result is
    // unrecoverable and charged as a no-verdict (the reviewer ran, or nothing says it did not: a dispatch that failed
    // before any receipt leaves its own marker and is released by `releaseFailedReservation`).
    const pending = persisted.review.invocations.find((i) => i.outcome === 'pending' && i.invocationId.startsWith('r3:'));
    if (!pending) return undefined;
    const fileStem = pending.invocationId.slice(3);
    const logRef = path.join(reviewDir, `${fileStem}.log`);
    const candidateSha = pending.candidateSha ?? pending.candidateDigest;
    const candidateDigest = pending.candidateDigest;
    const readDoc = (file: string): Record<string, unknown> | undefined => {
      try {
        return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : undefined;
      } catch {
        return undefined;
      }
    };
    const at = this.clock();
    const envelope = this.completeEnvelope(readDoc(path.join(reviewDir, `${fileStem}.result.json`)), pending);
    if (!envelope) {
      if (existsSync(path.join(reviewDir, `${fileStem}.failed.json`)) && !existsSync(logRef)) return undefined;
      const since = existsSync(logRef) ? statSync(logRef).mtimeMs : Date.parse(pending.requestedAt);
      const age = existsSync(logRef) ? Date.now() - since : Date.parse(at) - since;
      if (age <= this.formalReviewerFor(pending.reviewer).timeoutMs + RECONCILE_GRACE_MS) return undefined;
      const classified = this.classifyFormal(card, candidateSha, undefined, 'no-verdict', 'malformed', [existsSync(logRef) ? 'the reviewer ran but no result envelope was published' : 'no result and no receipt within the reviewer timeout and the grace']);
      const key = reviewRequestKey({ repository: goal.repository, candidateDigest, base: pending.base, policyVersion: pending.policyVersion, reviewer: pending.reviewer });
      return { invocationId: pending.invocationId, fileStem, reviewDir, candidateSha, candidateDigest, seen: {}, policyHash: pending.policyHash, requestedAt: pending.requestedAt, at, verdict: undefined, classified, advisory: [], logRef: existsSync(logRef) ? logRef : undefined, durationMs: 0, receiptSha256: '', reviewer: pending.reviewer, effort: pending.effort, baseSync: pending.baseSync, retained: true, key };
    }
    // The envelope is the whole result: its outcome, status and, for a decided outcome, the verdict it was classified from.
    // The sidecar beside it is retained evidence, never read back for a decision.
    const verdictFile = path.join(reviewDir, `${fileStem}.json`);
    const verdict: Verdict | undefined = envelope.verdict ? { ...envelope.verdict, sha: envelope.verdict.sha ?? candidateSha, branch: envelope.verdict.branch ?? persisted.cardId, run_status: envelope.verdict.run_status ?? 'success' } : undefined;
    const classified = this.classifyFormal(card, candidateSha, verdict, envelope.outcome, envelope.runStatus, envelope.reasons);
    // A recovered hold keeps the deadline the envelope recorded (from its completion, never from the recovery).
    const holdUntil = classified.outcome === 'quota-hold' ? (envelope.holdUntil ?? addMs(envelope.at, envelope.retryAfterMs ?? 15 * 60 * 1000)) : undefined;
    return { invocationId: pending.invocationId, fileStem, reviewDir, candidateSha, candidateDigest, changedPaths: envelope.changedPaths, seen: envelope.seen, policyHash: pending.policyHash ?? envelope.policyHash, deltaPaths: envelope.deltaPaths, requestedAt: pending.requestedAt, at, verdict: classified.outcome === 'quota-hold' ? undefined : verdict, classified, advisory: envelope.advisory, verdictRef: existsSync(verdictFile) ? verdictFile : undefined, logRef: existsSync(logRef) ? logRef : undefined, durationMs: envelope.durationMs, receiptSha256: envelope.receiptSha256, holdUntil, reviewer: pending.reviewer, effort: pending.effort, baseSync: pending.baseSync, retained: true, key: envelope.key, seq: envelope.seq };
  }

  /**
   * The result envelope as published, when it is complete, bound to this reservation and consistent with itself; undefined
   * otherwise. Bound: the invocation, the candidate digest and the candidate sha the reservation pinned. Complete: the pool
   * request key the review was admitted under and the snapshot the reviewer received. Consistent: an outcome and a run
   * status of their enums that agree (a decision ran to success, a no-verdict or a hold did not), and a decided outcome
   * carrying the verdict it was classified from, that verdict agreeing with it, a non-decided one carrying none.
   */
  private completeEnvelope(doc: Record<string, unknown> | undefined, pending: ReviewInvocation): { outcome: PanelResult['outcome']; runStatus: PanelResult['runStatus']; reasons: string[]; at: string; retryAfterMs?: number; holdUntil?: string; advisory: string[]; durationMs: number; receiptSha256: string; changedPaths?: string[]; seen: Record<string, FindingSnapshot>; key: string; seq?: number; verdict?: Verdict; policyHash?: string; deltaPaths?: string[] } | undefined {
    if (!doc) return undefined;
    const outcomes: PanelResult['outcome'][] = ['pass', 'block', 'no-verdict', 'quota-hold'];
    const outcome = doc['outcome'];
    const runStatus = doc['runStatus'];
    const at = doc['at'];
    const key = doc['key'];
    const seen = doc['seen'];
    if (doc['invocationId'] !== pending.invocationId) return undefined;
    if (doc['candidateDigest'] !== pending.candidateDigest) return undefined;
    if (doc['candidateSha'] !== (pending.candidateSha ?? pending.candidateDigest)) return undefined;
    if (typeof key !== 'string' || !key) return undefined;
    if (typeof seen !== 'object' || seen === null || Array.isArray(seen)) return undefined;
    // The hash the envelope names must be the reservation's: a recovered result never claims another applied policy; an
    // envelope from before the field names none and recovers under the reserved hash.
    const policyHash = typeof doc['policyHash'] === 'string' ? doc['policyHash'] : undefined;
    if (policyHash !== undefined && pending.policyHash !== undefined && policyHash !== pending.policyHash) return undefined;
    if (typeof outcome !== 'string' || !outcomes.includes(outcome as PanelResult['outcome'])) return undefined;
    if (typeof runStatus !== 'string' || !RunStatus.options.includes(runStatus as RunStatus) || typeof at !== 'string' || !Array.isArray(doc['reasons'])) return undefined;
    const decided = outcome === 'pass' || outcome === 'block';
    if (decided ? runStatus !== 'success' : runStatus === 'success') return undefined;
    // A decided outcome carries the verdict it was classified from, and that verdict agrees with it; a non-decided outcome
    // carries none. Anything else is an inconsistent artifact, never a decision.
    const verdict = doc['verdict'] !== undefined ? parseVerdict(doc['verdict']) : undefined;
    if (decided) {
      if (!verdict || verdict.verdict !== outcome) return undefined;
    } else if (doc['verdict'] !== undefined) return undefined;
    return {
      verdict,
      outcome: outcome as PanelResult['outcome'],
      runStatus: runStatus as PanelResult['runStatus'],
      reasons: (doc['reasons'] as unknown[]).filter((r): r is string => typeof r === 'string'),
      at,
      retryAfterMs: typeof doc['retryAfterMs'] === 'number' ? doc['retryAfterMs'] : undefined,
      holdUntil: typeof doc['holdUntil'] === 'string' ? doc['holdUntil'] : undefined,
      advisory: Array.isArray(doc['advisory']) ? (doc['advisory'] as unknown[]).filter((r): r is string => typeof r === 'string') : [],
      durationMs: typeof doc['durationMs'] === 'number' ? doc['durationMs'] : 0,
      receiptSha256: typeof doc['receiptSha256'] === 'string' ? doc['receiptSha256'] : '',
      changedPaths: Array.isArray(doc['changedPaths']) ? (doc['changedPaths'] as unknown[]).filter((r): r is string => typeof r === 'string') : undefined,
      seen: seen as Record<string, FindingSnapshot>,
      key,
      seq: typeof doc['seq'] === 'number' ? doc['seq'] : undefined,
      policyHash,
      deltaPaths: Array.isArray(doc['deltaPaths']) ? (doc['deltaPaths'] as unknown[]).filter((r): r is string => typeof r === 'string') : undefined,
    };
  }

  /**
   * A pending reservation whose dispatch failed before the reviewer ran (retained as `<stem>.failed.json`, no log) is
   * released here when the release at the time was refused or withheld, so the card is never left with a review in
   * flight that never ran; the reviewer is dispatched again by the admission that follows. The pool request the failed
   * dispatch was admitted under (named by the marker with its queue sequence) is cancelled first, when it is still that
   * request and still open, so the request of a reviewer that never started is never joined as a running review; a
   * cancellation that fails keeps the reservation for the next command.
   */
  private releaseFailedReservation(goal: Goal, card: Card, persisted: CardRun, reviewDir: string): CardRun {
    const markerOf = (i: ReviewInvocation) => path.join(reviewDir, `${i.invocationId.slice(3)}.failed.json`);
    const failed = persisted.review.invocations.filter((i) => i.outcome === 'pending' && i.invocationId.startsWith('r3:') && existsSync(markerOf(i)) && !existsSync(path.join(reviewDir, `${i.invocationId.slice(3)}.log`)));
    if (!failed.length) return persisted;
    const releasable = failed.filter((i) => {
      let marker: { key?: unknown; seq?: unknown } | undefined;
      try {
        marker = JSON.parse(readFileSync(markerOf(i), 'utf8')) as { key?: unknown; seq?: unknown };
      } catch {
        marker = undefined;
      }
      // A marker from before the binding names no request: nothing to cancel, the reservation is released.
      if (typeof marker?.key !== 'string' || typeof marker.seq !== 'number') return true;
      const request = this.queue.get(marker.key);
      if (!request || request.seq !== marker.seq || request.state === 'completed' || request.state === 'cancelled') return true;
      try {
        this.queue.cancel(marker.key, `formal review ${i.invocationId} did not run`, this.clock());
        return true;
      } catch {
        return false;
      }
    });
    if (!releasable.length) return persisted;
    const ids = new Set(releasable.map((i) => i.invocationId));
    // Only an entry still pending on the locked record is released (one decided meanwhile keeps its decision), and only a
    // released entry is journaled.
    const released: ReviewInvocation[] = [];
    const next = this.store.updateCardRun(goal.id, card.id, (current) => {
      const latest = current ?? persisted;
      released.length = 0;
      released.push(...latest.review.invocations.filter((i) => ids.has(i.invocationId) && i.outcome === 'pending'));
      return { ...latest, review: { ...latest.review, invocations: latest.review.invocations.filter((i) => !(ids.has(i.invocationId) && i.outcome === 'pending')) } };
    });
    for (const i of released) this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId: i.invocationId, reviewer: i.reviewer, candidateDigest: i.candidateDigest, outcome: 'no-verdict', decision: 'released: the dispatch failed before the reviewer ran', findings: [], reraised: [], resolved: [], policyHash: i.policyHash } });
    return next;
  }

  /**
   * Commit a formal result (a live one, or one retained by a reservation whose commit lost the lock): the decision,
   * the findings and the state from the ledger locked at completion, the canonical document for a committed decision,
   * and the journal event.
   */
  private commitFormalResult(goal: Goal, card: Card, persisted: CardRun, r: FormalResult): { run: CardRun; classified: ClassifiedVerdict; verdict?: Verdict; advisory: string[]; verdictRef?: string; logRef?: string; durationMs: number; receiptSha256: string; reviewer: string } {
    const { invocationId, fileStem, reviewDir, candidateSha, candidateDigest, seen, verdict, classified, advisory, holdUntil, reviewer } = r;
    const after = r.at;
    const evidenceEntry = { id: `r3-${fileStem}`, kind: 'artifact' as const, createdAt: after, candidateDigest, note: `formal review ${reviewer} ${classified.outcome}${r.retained ? ' (committed from the retained verdict)' : ''}: ${classified.reasons.join(' | ')}`.slice(0, 500) };
    const dropReservation = (x: CardRun): ReviewLedger => ({ ...x.review, invocations: x.review.invocations.filter((i) => i.invocationId !== invocationId) });
    const result = { classified, verdict, advisory, verdictRef: r.verdictRef, logRef: r.logRef, durationMs: r.durationMs, receiptSha256: r.receiptSha256 };
    // The decision (counters and action), the finding round and the resulting state are computed from the ledger
    // locked at completion, so a decision another completion recorded meanwhile is counted, never overwritten.
    let decision: LedgerDecision | undefined;
    const committed = this.commitReviewed(
      goal,
      card,
      persisted,
      {
        candidateDigest,
        evidence: evidenceEntry,
        reserved: (latest) => latest.review.invocations.some((i) => i.invocationId === invocationId && i.outcome === 'pending'),
        // Only the pending reservation is ever released: a decision already committed under this invocation stays with its counters.
        release: (latest) => ({ ...latest, review: { ...latest.review, invocations: latest.review.invocations.filter((i) => !(i.invocationId === invocationId && i.outcome === 'pending')) } }),
        decide: (latest) => {
          const rec = recordReviewOutcome(dropReservation(latest), { invocationId, candidateDigest, candidateSha, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer, requestedAt: r.requestedAt, verdictRef: r.verdictRef, holdUntil, mergeBlocking: classified.mergeBlocking, policyHash: r.policyHash, ...(r.effort ? { effort: r.effort } : {}), ...(r.baseSync ? { baseSync: true } : {}) }, classified, verdict);
          decision = rec.decision;
          // Findings: every cited reason of a block (root or axis, advisory included) is recorded; a pass resolves the stage's open ones the reviewer received.
          // A routed skip is not a decision on the findings: it records and resolves nothing.
          const decidedOutcome = classified.outcome === 'block-defect' || classified.outcome === 'block-advisory' ? 'block' : classified.outcome === 'pass' ? 'pass' : 'no-verdict';
          const findingsInput: RecordFindingsInput = { stage: 'formal', round: rec.ledger.substantiveDecisions, candidateSha, at: after, outcome: decidedOutcome, reasons: decidedOutcome === 'block' && verdict ? citedReasonsOf(verdict, r.changedPaths) : [], advisory: classified.outcome === 'block-advisory', seen, deltaPaths: r.deltaPaths };
          const withDecision = (x: CardRun): CardRun => ({ ...x, review: rec.ledger });
          return {
            findingsInput,
            history: withDecision,
            commit: (x) => {
              let next = withDecision(x);
              switch (rec.decision.action) {
                case 'review-fix': {
                  // The review budget, not the ladder, paid for this block: the episode reopens and the repair is the next attempt.
                  const effort = x.effort ? reopenAfterReviewBlock(x.effort, classified.reasons[0] ?? 'review block') : x.effort;
                  next = { ...next, state: 'REVIEW_FIX', effort, dodReceipt: undefined, blocker: undefined, blockedReceipt: this.keepReceipt(x, { stage: 'formal', candidateSha }) };
                  break;
                }
                case 'stop-review': {
                  const stop = makeStop('review', this.withContest(rec.decision.detail, next.findings), 'return the retained verdict evidence for human adjudication; no counter reset', { at: after, global: false });
                  next = { ...next, state: 'STOP', stop };
                  break;
                }
                case 'wait-quota':
                  next = { ...next, state: 'WAIT' };
                  break;
                default:
                  next = { ...next, state: 'SHIP' };
              }
              return next;
            },
          };
        },
      },
      after,
    );
    // The canonical document the ship paths read is published only for a successful, non-stale decision committed on the
    // current candidate; an advisory block is published as a consistent pass with every finding under `advisory`.
    const publishable = committed.status === 'committed' && verdict !== undefined && !classified.stale && classified.runStatus === 'success' && (classified.outcome === 'pass' || classified.outcome === 'block-defect' || classified.outcome === 'block-advisory');
    let publication: { published: boolean; error?: string } | undefined;
    if (publishable && verdict) {
      try {
        this.publishCanonical(card, reviewDir, verdict, classified.outcome === 'block-advisory', invocationId, r.policyHash, reviewer);
        publication = { published: true };
      } catch (err) {
        // The decision is committed either way: the event below records that the document did not land, and the gate
        // repairs it from the envelope before the ship (`repairCanonical`).
        publication = { published: false, error: (err as Error).message };
      }
    }
    this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId, reviewer, candidateDigest, outcome: classified.outcome, mergeBlocking: classified.mergeBlocking, decision: discardedDecision(committed.status) ?? decision?.action, runStatus: classified.runStatus, reasons: classified.reasons, advisory, findings: committed.found.raised, reraised: committed.found.reraised, resolved: committed.found.resolved, verdictRef: r.verdictRef, receiptSha256: r.receiptSha256, durationMs: r.durationMs, holdUntil, retained: r.retained || undefined, canonicalPublished: publication?.published, publicationError: publication?.error, policyHash: r.policyHash } });
    return { run: committed.run, ...result, reviewer };
  }

  /**
   * Commit a review result under the card-run lock, from the record as persisted at that moment, in this order:
   * a stopped run keeps the result as evidence only and releases the reservation; a reservation released meanwhile
   * (abandoned by the gate) is never resurrected; the owner's lease is renewed and fenced before anything is written
   * (a review can outlast the lease TTL; a lost lease releases the reservation and stops the run); the findings and
   * the decision are computed from the locked record; a result for a candidate the author replaced meanwhile is
   * recorded as history without touching the newer candidate's receipts, effort or state.
   */
  private commitReviewed(goal: Goal, card: Card, expected: CardRun, input: CommitReviewInput, now: string): { run: CardRun; found: RecordFindingsResult; status: CommitReviewStatus } {
    let found: RecordFindingsResult = { findings: [], raised: [], reraised: [], resolved: [] };
    const outcome: { status: CommitReviewStatus } = { status: 'committed' };
    const run = this.store.updateCardRun(goal.id, card.id, (persisted) => {
      const latest = persisted ?? expected;
      const evidence = [...latest.evidence, input.evidence];
      if (latest.stop || latest.state === 'STOP') {
        outcome.status = 'stopped';
        return { ...input.release(latest), evidence };
      }
      if (!input.reserved(latest)) {
        outcome.status = 'abandoned';
        return { ...latest, evidence };
      }
      if (latest.ownerGeneration !== undefined) {
        this.renewOwnLease(card.id, latest, now);
        try {
          this.leases.fence(resourceKeys.card(this.repo.key, card.id), latest.ownerGeneration, currentActor(), now);
        } catch (err) {
          outcome.status = 'fenced';
          const stop = makeStop('ownership', (err as FencedError).message, 'revalidate ownership; a stale generation cannot commit a review result', { at: now });
          return { ...input.release(latest), state: 'STOP', stop, evidence };
        }
      }
      const decision = input.decide(latest);
      // The findings are recomputed against the locked record: a disposition recorded during the review survives.
      found = recordFindings(latest.findings, decision.findingsInput);
      const withFindings: CardRun = { ...latest, findings: found.findings, evidence };
      if (latest.candidate?.digest !== input.candidateDigest) {
        outcome.status = 'superseded';
        return decision.history(withFindings, found);
      }
      return { ...decision.commit(withFindings, found), ownerGeneration: latest.ownerGeneration };
    });
    if (outcome.status === 'stopped') this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { from: run.state, to: 'STOP', reason: 'a stop was saved while the review result was being committed; the result is kept as evidence only' } });
    return { run, found, status: outcome.status };
  }

  /** The R2 guards over one record: stop, an in-flight round, a quota hold, exhausted rounds, the same-candidate rule. Returns the round numbering. */
  private preReviewAdmission(current: CardRun, card: Card, candidateSha: string, candidateDigest: string, now: string): { cycle: number; round: number; attemptNo: number } {
    const cfg = this.config.preReview;
    if (current.stop || current.state === 'STOP') throw new Error(`card run is stopped (${current.stop?.reason ?? 'STOP'}); no review may run: ${current.stop?.nextAction ?? 'resolve the stop first'}`);
    const cycle = current.review.substantiveBlocks; // an R3 block restarts the pre-review cycle; an R3 pass does not
    const forCandidate = current.preReview.rounds.filter((r) => (r.candidateSha ?? r.candidateDigest) === candidateSha || r.candidateDigest === candidateDigest);
    const inFlight = this.inFlight(current, 'pre');
    if (inFlight) throw new Error(inFlight);
    const rounds = current.preReview.rounds.filter((r) => r.cycle === cycle && r.outcome !== 'pending');
    const pendingInCycle = current.preReview.rounds.filter((r) => r.cycle === cycle && r.outcome === 'pending').length;
    const lastRound = [...rounds].reverse().find((r) => r.candidateDigest === candidateDigest);
    if (lastRound?.outcome === 'quota-hold' && lastRound.holdUntil && Date.parse(lastRound.holdUntil) > Date.parse(now)) {
      throw new Error(`pre-reviewer ${cfg.reviewer} is on a quota hold until ${lastRound.holdUntil}; do not re-run before it clears`);
    }
    // The rounds cap holds whatever the dispositions: exhausted rounds are decided by the gate (STOP, or the hand-off to R3).
    const blocksSoFar = rounds.filter((r) => r.outcome === 'block').length;
    if (blocksSoFar >= cfg.rounds) throw new Error(`the pre-review rounds of cycle ${cycle} are exhausted (${blocksSoFar}/${cfg.rounds} blocks); run \`aidlc card next ${card.id}\`: the gate stops the card or hands the residual findings to R3, it never dispatches another round`);
    // Same-candidate rule, keyed by the committed sha: a pass stays valid; a block is re-reviewed unchanged only with every finding disputed.
    const lastDecided = [...forCandidate].reverse().find((r) => r.outcome === 'pass' || r.outcome === 'block');
    if (lastDecided?.outcome === 'pass') throw new Error(`candidate ${candidateSha.slice(0, 12)} already holds a pre-review pass (round ${lastDecided.round} of cycle ${lastDecided.cycle}); run \`aidlc card next ${card.id}\` instead of another round`);
    if (lastDecided?.outcome === 'block') {
      const answered = this.blockAnswered(current, { stage: 'pre', cycle: lastDecided.cycle, round: lastDecided.round });
      if (!answered.answered) throw new Error(this.sameCandidateRefusal(card, candidateSha, `pre-review round ${lastDecided.round}`, answered.open));
    }
    return { cycle, round: rounds.filter((r) => r.outcome === 'pass' || r.outcome === 'block').length + pendingInCycle + 1, attemptNo: forCandidate.length + 1 };
  }

  /** R2: run the configured pre-reviewer on the committed candidate and record the round. */
  async preReview(goal: Goal, card: Card, run: CardRun): Promise<{ run: CardRun; result: PanelResult; round: PreReviewRound }> {
    const cfg = this.config.preReview;
    if (!cfg.command.length) throw new Error('preReview.command is not configured (aidlc.config.json)');
    // Guards, prior findings and the snapshot come from the persisted run, never from the caller's copy.
    const persisted = this.store.getCardRun(goal.id, card.id) ?? run;
    if (persisted.stop || persisted.state === 'STOP') throw new Error(`card run is stopped (${persisted.stop?.reason ?? 'STOP'}); no review may run: ${persisted.stop?.nextAction ?? 'resolve the stop first'}`);
    const now = this.clock();
    const cwd = this.reviewCheckout(persisted);
    this.refuseDirtyCandidate(persisted, cwd);
    const baseRef = persisted.base?.oid ?? this.config.base;
    const candidateSha = this.pinnedCandidate(persisted, cwd);
    const candidateDigest = persisted.candidate?.digest ?? candidateSha;
    this.preReviewAdmission(persisted, card, candidateSha, candidateDigest, now);
    const reviewPolicy = this.reviewPolicy();
    const hash = policyHash(reviewPolicy);
    // The learned invariants are a prompt input like the policy and the diff: read here, with everything else this dispatch
    // sends, before its first mutation (T1-REVIEW-INPUTS), so a lesson written later never changes what the reviewer receives.
    const lessons = reviewLessons(this.lessonsFile());
    // A diff above the cap is refused here, before the reservation: no round, receipt or event records it (R7).
    const { changedPaths, diff } = collectCandidateDiff(this.runner, cwd, baseRef, cfg.maxDiffBytes, this.repo.isGit ? candidateSha : 'HEAD', 'preReview.maxDiffBytes');
    if (!diff.trim()) throw new Error(`no committed candidate diff against ${baseRef} in ${cwd}; commit the candidate first`);
    // The delta since the candidate the stage last decided on (R9), collected before the lock and bound to that decision under it.
    const since = this.lastReviewedSha(persisted, 'pre');
    const delta = since ? this.collectDelta(cwd, since, candidateSha, cfg.maxDiffBytes, 'preReview.maxDiffBytes') : undefined;
    const reviewDir = path.join(cwd, '.review');
    // Reserve the round under the card-run lock before dispatch: the guards are re-checked on the locked record (a dispute
    // withdrawn or a round recorded since the first read refuses here), the owner's lease is renewed and fenced in the same
    // transaction, and the numbering, the prior findings and the snapshot the reviewer receives come from that record.
    // Retention names carry the attempt number for this candidate and a nonce, so a retried or overlapping round never
    // overwrites earlier evidence; the nonce is the reservation id of the round.
    let numbering = { cycle: 0, round: 0, attemptNo: 0 };
    let fileStem = '';
    let reservation: PreReviewRound | undefined;
    let priorFindings: PriorFinding[] = [];
    let seen: Record<string, FindingSnapshot> = {};
    this.store.updateCardRun(goal.id, card.id, (locked) => {
      const current = locked ?? persisted;
      this.refuseReplacedCandidate(current, card, 'pre', candidateSha, candidateDigest);
      this.refuseChangedCheckout(current, cwd, candidateSha);
      numbering = this.preReviewAdmission(current, card, candidateSha, candidateDigest, now);
      if (this.lastReviewedSha(current, 'pre') !== since) throw new Error('a pre-review round was decided since the delta was collected; run the command again');
      if (current.ownerGeneration !== undefined) {
        this.renewOwnLease(card.id, current, now);
        this.leases.fence(resourceKeys.card(this.repo.key, card.id), current.ownerGeneration, currentActor(), now);
      }
      fileStem = `${card.id}.pre.${numbering.cycle}.${numbering.round}.${numbering.attemptNo}.${randomUUID().slice(0, 8)}`;
      reservation = { round: numbering.round, cycle: numbering.cycle, reviewer: cfg.reviewer, candidateDigest, candidateSha, requestedAt: now, durationMs: 0, outcome: 'pending', reasons: [], reservationId: fileStem, policyHash: hash, advisory: [] };
      priorFindings = this.priorFindingsFor(current);
      seen = this.findingsSnapshot(current);
      return { ...current, preReview: { ...current.preReview, rounds: [...current.preReview.rounds, reservation] } };
    });
    if (!reservation) throw new Error('pre-review round not reserved');
    const reserved: PreReviewRound = reservation;
    const { cycle, round, attemptNo } = numbering;
    const dropReservation = () => this.store.updateCardRun(goal.id, card.id, (locked) => ({ ...(locked ?? persisted), preReview: { ...(locked ?? persisted).preReview, rounds: (locked ?? persisted).preReview.rounds.filter((r) => r.reservationId !== fileStem) } }));
    // Deterministic scope gate (dimension 1) first: a block with no model call and no tokens spent.
    const outOfScope = changedPaths.filter((p) => !pathAllowed(p, card.allow_paths));
    let result: PanelResult;
    if (outOfScope.length) {
      const reasons = outOfScope.map((p) => `[spec] 1 out of scope @ ${p}: outside allow_paths -> revert the change or amend the card (scope-gate)`);
      const verdict: Verdict = { verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } }, sha: candidateSha, branch: card.id, run_status: 'success' };
      result = { outcome: 'block', runStatus: 'success', reasons, verdict, perspectives: [{ perspective: 'scope-gate', outcome: 'block', runStatus: 'success', reasons, verdict, durationMs: 0, logRef: '', receiptSha256: '', exitCode: 0 }], durationMs: 0, receiptSha256: '' };
    } else {
      const promptInArgv = cfg.command.some((a) => a.includes('{instructions}'));
      // Acceptance coverage is asked of the one angle that answers it, so a panel without that angle asks for nothing and
      // records nothing: an empty record would read as a reviewer that ignored a request nobody made.
      const coverage = cfg.coverage === 'shadow' && cfg.perspectives.includes(COVERAGE_ANGLE);
      const promptFor = (perspective?: string) => buildReviewPrompt({ stage: 'pre', includeDiff: !promptInArgv, perspective, reviewPolicy, lessons, coverage, card, base: baseRef, head: candidateSha, changedPaths, diff, priorFindings, delta, round, maxRounds: cfg.rounds });
      try {
        result = await runReviewPanel({ runner: this.asyncRunner, command: cfg.command, perspectives: cfg.perspectives, promptFor, vars: { cwd, base: baseRef, head: candidateSha, card: card.id }, cwd, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir, fileStem, head: candidateSha, reviewer: cfg.reviewer, changedPaths, policyHash: hash, coverage: coverage ? { expected: card.acceptance.length } : undefined, answerMarker: cfg.answerMarker });
      } catch (err) {
        // The failure is retained next to the reservation first (no lock needed), so the gate drops the round at once even
        // when the drop below is refused; neither masks the panel's own error.
        try {
          mkdirSync(reviewDir, { recursive: true });
          writeFileSync(path.join(reviewDir, `${fileStem}.failed.json`), JSON.stringify({ reservationId: fileStem, candidateSha, at: this.clock(), error: (err as Error).message }, null, 2) + '\n', 'utf8');
        } catch {
          /* the drop below, or the expiry of the round, covers a marker that could not be written */
        }
        try {
          dropReservation();
        } catch {
          /* the retained failure drops it on the next gate pass */
        }
        throw err;
      }
    }
    const after = this.clock();
    // Timed from the clock after the run: a review can outlast the hold it reports.
    const holdUntil = result.outcome === 'quota-hold' ? addMs(after, result.retryAfterMs ?? 15 * 60 * 1000) : undefined;
    const perspectives = result.perspectives.map((p) => ({ name: p.perspective, outcome: p.outcome, runStatus: p.runStatus, reasons: p.reasons, durationMs: p.durationMs, verdictRef: p.verdictRef, receiptSha256: p.receiptSha256 }));
    const record: PreReviewRound = { ...reserved, durationMs: result.durationMs, outcome: result.outcome, runStatus: result.runStatus, reasons: result.reasons, advisory: result.advisory ?? [], verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, holdUntil, perspectives, coverage: result.coverage };
    const evidenceEntry = { id: `pre-review-${cycle}-${round}-${attemptNo}`, kind: 'artifact' as const, createdAt: after, candidateDigest, note: `pre-review ${cfg.reviewer} ${result.outcome}: ${result.reasons.join(' | ')}`.slice(0, 500) };
    // The angle that wrote each reason, from the structured result: every cited reason of the angle's own document (root
    // list and both axes), so a single-angle panel, whose reasons carry no trailing tag, keeps its angle on axis findings too.
    const perspectiveByReason: Record<string, string> = {};
    for (const p of result.perspectives) {
      for (const reason of new Set([...p.reasons, ...(p.verdict?.reasons ?? []), ...(p.verdict?.axes?.spec?.reasons ?? []), ...(p.verdict?.axes?.standards?.reasons ?? [])])) {
        perspectiveByReason[reason] = p.perspective;
        perspectiveByReason[`${reason} (${p.perspective})`] = p.perspective;
      }
    }
    const findingsInput: RecordFindingsInput = { stage: 'pre', cycle, round, candidateSha, at: after, outcome: result.outcome, reasons: result.outcome === 'block' && result.verdict ? citedReasonsOf(result.verdict, changedPaths) : [], perspectives: cfg.perspectives, perspectiveByReason, seen, deltaPaths: delta?.changedPaths };
    const withRecord = (current: CardRun): CardRun => ({ ...current, preReview: { ...current.preReview, rounds: current.preReview.rounds.map((r) => (r.reservationId === fileStem ? record : r)) } });
    const committed = this.commitReviewed(
      goal,
      card,
      persisted,
      {
        candidateDigest,
        evidence: evidenceEntry,
        reserved: (latest) => latest.preReview.rounds.some((r) => r.reservationId === fileStem),
        release: (latest) => ({ ...latest, preReview: { ...latest.preReview, rounds: latest.preReview.rounds.filter((r) => !(r.reservationId === fileStem && r.outcome === 'pending')) } }),
        decide: () => ({
          findingsInput,
          history: withRecord,
          commit: (current) => {
            let next = withRecord(current);
            if (result.outcome === 'block') {
              // The R2 rounds are the pre-review's own budget: the episode reopens and the repair is the next attempt.
              const effort = current.effort ? reopenAfterReviewBlock(current.effort, `pre-review: ${result.reasons[0] ?? 'block'}`) : current.effort;
              next = { ...next, state: 'BUILD', effort, dodReceipt: undefined, blocker: undefined, blockedReceipt: this.keepReceipt(current, { stage: 'pre', cycle, round, candidateSha }) };
            }
            return next;
          },
        }),
      },
      after,
    );
    const { run: saved, found } = committed;
    this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle, round, reviewer: cfg.reviewer, candidateDigest, outcome: result.outcome, decision: discardedDecision(committed.status), runStatus: result.runStatus, reasons: result.reasons, advisory: result.advisory ?? [], findings: found.raised, reraised: found.reraised, resolved: found.resolved, verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, durationMs: record.durationMs, holdUntil, perspectives: perspectives.map((p) => `${p.name}:${p.outcome}`), policyHash: hash, coverage: record.coverage } });
    return { run: saved, result, round: record };
  }

  /**
   * Pool admission in queue order. A stale request of this same card (an earlier candidate that never ran,
   * left by a refused admission) is superseded; another requester's request is waited for.
   */
  private admitReview(goal: Goal, card: Card, key: string, now: string, pool: string = goal.reviewPool): ReturnType<ReviewQueue['admit']> {
    const requester = `${goal.id}:${card.id}`;
    let admit = this.queue.admit(pool, currentActor(), now);
    for (let guard = 0; admit.status === 'admitted' && admit.request.key !== key && admit.request.requesters.every((r) => r === requester) && guard < 10; guard += 1) {
      this.queue.complete(admit.request.key, 'superseded by a newer candidate of the same card', now);
      admit = this.queue.admit(pool, currentActor(), now);
    }
    return admit;
  }

  applyShipResult(goal: Goal, card: Card, run: CardRun, result: ShipResult, operationId: string, reviewKey: string, candidateDigest: string, bindings: { policyHash?: string; deltaPaths?: string[] } = {}): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    const verdictInfo = this.shipPath.readVerdict(card.id);
    // R10 on the ship path: the document is classified with its tagged reasons moved to advisory notes (a block carried only
    // by [question] or [suggestion] reasons is a pass with the notes, no block consumed); the artifact identity below keeps
    // the document as written.
    const stripped = verdictInfo.verdict ? stripAdvisoryTags(verdictInfo.verdict) : undefined;
    const shipVerdict = stripped?.verdict;
    const shipAdvisory = stripped?.advisory ?? [];
    const classified = classifyVerdict(shipVerdict, { candidateSha: run.candidate?.sha, tier: card.tier, gateRequired: this.config.gateRequired, rawOutput: quotaOutput(result.receipt) });
    const invocationId = `ship:${operationId}`;
    let review = run.review;
    let reviewDecision: ReturnType<typeof recordReviewOutcome>['decision'] | undefined;
    // The document the command-run formal reviewer already decided for this candidate, re-read by the ship
    // path, is the same artifact and never a second decision; any other ship review outcome is recorded.
    const formal = this.config.formalReview;
    const commandReviewers = formal.command.length ? this.formalReviewerNames() : undefined;
    const decidedByCommand = commandReviewers !== undefined && run.review.invocations.some((i) => commandReviewers.has(i.reviewer) && i.candidateDigest === candidateDigest && (i.outcome === 'pass' || i.outcome === 'block'));
    const rawDoc = (() => {
      try {
        return verdictInfo.raw ? (JSON.parse(verdictInfo.raw) as { reviewer?: string; sha?: string; policy_hash?: unknown }) : undefined;
      } catch {
        return undefined;
      }
    })();
    // The hash the document names is the hash of the policy its reviewer applied (R8); a document naming none is bound to the
    // policy in force at dispatch (only a record from before the field carries none).
    const shipPolicyHash = typeof rawDoc?.policy_hash === 'string' ? rawDoc.policy_hash : bindings.policyHash;
    const last = run.review.lastVerdict;
    // Identity is the document itself: same reviewer (when the raw document names one), same sha, same verdict and
    // reasons as the command's recorded decision (an advisory block is published as a pass with `advisory`).
    const commandVerdict = last?.verdict === 'block' && !classifyVerdict(last, { candidateSha: run.candidate?.sha, tier: card.tier, gateRequired: this.config.gateRequired }).mergeBlocking ? 'pass' : last?.verdict;
    const commandReasons = commandVerdict === 'pass' ? [] : (last?.reasons ?? []);
    const sameArtifact =
      decidedByCommand &&
      last !== undefined &&
      verdictInfo.verdict !== undefined &&
      verdictInfo.verdict.sha === run.candidate?.sha &&
      (!rawDoc || (rawDoc.reviewer !== undefined && commandReviewers?.has(rawDoc.reviewer) === true && rawDoc.sha === run.candidate?.sha)) &&
      verdictInfo.verdict.verdict === commandVerdict &&
      JSON.stringify(verdictInfo.verdict.reasons) === JSON.stringify(commandReasons);
    // Record a substantive decision only when a verdict exists or the ship outcome is review-related; a
    // merge without a readable verdict is noted as evidence, never counted as a decision or a retry.
    // A ship-path verdict file re-read for the same candidate (a CI retry re-reading an unchanged advisory verdict) is the
    // same decision: it is recorded once.
    const artifactDigest = verdictInfo.verdict ? createHash('sha256').update(JSON.stringify(verdictInfo.verdict)).digest('hex') : undefined;
    const standingFor = (ledger: ReviewLedger): ReviewInvocation | undefined => (artifactDigest !== undefined ? [...ledger.invocations].reverse().find((i) => i.candidateDigest === candidateDigest && i.artifactDigest === artifactDigest && (i.outcome === 'pass' || i.outcome === 'block')) : undefined);
    if (!sameArtifact && (verdictInfo.verdict || ['review-blocked', 'review-no-verdict'].includes(result.outcome))) {
      // The decision, its counters and its findings are recorded in one locked update against the record as it is at
      // completion: a failure after the write leaves a consistent ledger, and the same artifact (a CI retry re-reading an
      // unchanged verdict, a replay of this operation) is never a second decision or a second finding. The ship-path
      // reviewer receives no prompt, so it delivered no findings: a re-raise answers no dispute and a pass resolves nothing.
      let rec: ReturnType<typeof recordReviewOutcome> | undefined;
      let recorded = false;
      let found: RecordFindingsResult = { findings: run.findings, raised: [], reraised: [], resolved: [] };
      const locked = this.store.updateCardRun(goal.id, card.id, (persisted) => {
        const current = persisted ?? run;
        rec = undefined;
        recorded = false;
        found = { findings: current.findings, raised: [], reraised: [], resolved: [] };
        if (standingFor(current.review)) return current;
        rec = recordReviewOutcome(current.review, { invocationId, candidateDigest, candidateSha: run.candidate?.sha, artifactDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: this.config.reviewer, requestedAt: now, mergeBlocking: classified.mergeBlocking, policyHash: shipPolicyHash }, classified, shipVerdict, verdictInfo.rounds !== undefined ? Math.max(0, verdictInfo.rounds - current.review.scriptCounter) : 0);
        recorded = rec.ledger.invocations.length > current.review.invocations.length;
        if (!recorded) return current;
        // Findings of a ship-path decision: every cited reason of a block (root or axis, advisory included), ids allocated on
        // the locked record (a dispute saved during the ship is kept).
        const decidedOutcome = classified.outcome === 'block-defect' || classified.outcome === 'block-advisory' ? 'block' : classified.outcome === 'pass' ? 'pass' : 'no-verdict'; // a routed skip decides nothing about the findings
        const input: RecordFindingsInput = { stage: 'formal', round: rec.ledger.substantiveDecisions, candidateSha: run.candidate?.sha, at: now, outcome: decidedOutcome, reasons: decidedOutcome === 'block' && shipVerdict ? citedReasonsOf(shipVerdict) : [], advisory: classified.outcome === 'block-advisory', seen: {}, deltaPaths: bindings.deltaPaths };
        found = recordFindings(current.findings, input);
        return { ...current, review: rec.ledger, findings: found.findings };
      });
      run = { ...run, review: locked.review, findings: locked.findings };
      review = locked.review;
      const standing = standingFor(review);
      // The ledger's standing decision for an artifact already recorded decides again; nothing new is recorded.
      reviewDecision = rec ? rec.decision : standing ? (standing.outcome === 'block' && classified.mergeBlocking ? ({ action: review.substantiveBlocks >= 2 ? 'stop-review' : 'review-fix', remainingDecisions: Math.max(0, MAX_SUBSTANTIVE_REVIEW_DECISIONS - review.substantiveDecisions), detail: 'second substantive block' } as LedgerDecision) : { action: 'proceed-merge' }) : undefined;
      if (recorded && rec) this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId, outcome: classified.outcome, mergeBlocking: classified.mergeBlocking, decision: rec.decision.action, runStatus: classified.runStatus, findings: found.raised, reraised: found.reraised, resolved: found.resolved, advisory: shipAdvisory, policyHash: shipPolicyHash } });
    }
    // The queue slot and the operation are settled before the outcome is applied. Only a review-no-verdict outcome holds the
    // pool on a quota message: the receipt is the output of the whole ship command (git, gh, the CI gate log), so any other
    // outcome settles its request whatever quota words it carries, and a merged or CI-red ship never leaves its request held.
    const holdUntil = new Date(Date.parse(now) + 15 * 60 * 1000).toISOString();
    if (result.outcome === 'review-no-verdict' && classified.outcome === 'quota-hold') {
      this.queue.hold(reviewKey, holdUntil, 'reviewer reported rate limit/quota', now);
      this.journal(goal.id).append({ type: 'REVIEW_HOLD', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { key: reviewKey } });
    } else if (result.outcome === 'unclassified' && result.receipt.timedOut) {
      this.queue.markLost(reviewKey, 'ship timed out; look up the review before releasing the slot', now);
    } else {
      this.queue.complete(reviewKey, verdictInfo.file ?? 'no-verdict', now);
    }
    const evidenceEntry = { id: `ship-${operationId}`, kind: 'artifact' as const, createdAt: now, candidateDigest, note: `ship ${result.outcome}: ${result.sentinels.join(' ')}`.slice(0, 500) };
    // The outcome is applied to the record locked at that moment, never to the snapshot the ship was issued from: a
    // dispute or a decision recorded during the ship survives, and a candidate recorded meanwhile (a new attempt during
    // a long ship) or a stop saved meanwhile is never overwritten by the shipped candidate's outcome. That outcome is then
    // history: the decision, the findings, the evidence and the operation result stay with the shipped candidate and the
    // run is left where the newer candidate or the stop put it.
    // The patch of each outcome is computed from the locked record (its ledger, receipts and effort as they are at that
    // moment, a decision or a failed check recorded meanwhile included); the ledger written in the decision transaction
    // above is never replaced by the copy captured then.
    const history = { superseded: false, stopped: false, newer: 'none' };
    const finish = (patchOf: (latest: CardRun) => Partial<CardRun>, then: (saved: CardRun) => { run: CardRun; directive: CardDirective }): { run: CardRun; directive: CardDirective } => {
      const saved = this.store.updateCardRun(goal.id, card.id, (current) => {
        const latest = current ?? run;
        const evidence = [...latest.evidence, evidenceEntry];
        if ((latest.candidate?.digest ?? 'unknown') !== candidateDigest) {
          history.superseded = true;
          history.newer = latest.candidate?.digest?.slice(0, 12) ?? 'none';
          return { ...latest, evidence };
        }
        if (latest.stop || latest.state === 'STOP') {
          history.stopped = true;
          return { ...latest, evidence };
        }
        return { ...latest, ...patchOf(latest), evidence };
      });
      if (!history.superseded && !history.stopped) return then(saved);
      const why = history.superseded ? `candidate ${candidateDigest.slice(0, 12)} was replaced by ${history.newer}` : `the card run was stopped (${saved.stop?.reason ?? 'STOP'})`;
      const status = result.outcome === 'merged' ? 'UNKNOWN' : 'failed';
      this.ops.markResult(operationId, status, { evidenceRef: `ship-${operationId}`, error: `ship ${result.outcome}: ${why} while the ship was in flight` });
      this.journal(goal.id).append({ type: 'OPERATION_RESULT', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId, status, outcome: result.outcome, superseded: history.superseded, stoppedMeanwhile: history.stopped } });
      const merged = status === 'UNKNOWN' ? ', and its merge is an unresolved operation to reconcile' : '';
      if (history.stopped) {
        const stop = saved.stop ?? makeStop('card', `stopped while the ship was in flight; the ship result (${result.outcome}) is history${merged}`, 'inspect the card run record', { at: now, global: false });
        return { run: saved, directive: { kind: 'stop', cardId: card.id, stop, narration: `${stop.detail}. The ship result (${result.outcome}) is recorded as history for candidate ${candidateDigest.slice(0, 12)}${merged}.` } };
      }
      return { run: saved, directive: { kind: 'wait', cardId: card.id, on: 'candidate-changed', pollSeconds: 0, narration: `The candidate changed while the ship was in flight (${candidateDigest.slice(0, 12)} shipped, ${history.newer} recorded meanwhile): the ship result (${result.outcome}) is recorded as history for the shipped candidate${merged}; run \`aidlc card next ${card.id}\` for the current candidate.` } };
    };

    if (result.outcome === 'merged') {
      const token = this.shipPath.readMergeToken(card.id);
      const pr = result.prNumber ?? token?.mergedPr;
      let mergeVerified = false;
      if (this.config.shipPath === 'dry-run') mergeVerified = true;
      else if (token?.tip && run.candidate?.sha && token.tip === run.candidate.sha) mergeVerified = true;
      else if (pr && this.config.repository) {
        try {
          const view = this.gh.prView(this.config.repository, pr, this.repo.mainRoot);
          mergeVerified = view.state === 'MERGED' && (!run.candidate?.sha || view.headRefOid === run.candidate.sha);
        } catch {
          mergeVerified = false;
        }
      }
      return finish((latest) => ({ state: mergeVerified ? 'CLOSE' : 'WAIT', mergeVerified, pr: pr ? { number: pr, state: 'MERGED' as const, headRefOid: token?.tip ?? run.candidate?.sha } : latest.pr }), (next) => {
        this.ops.markResult(operationId, mergeVerified ? 'succeeded' : 'UNKNOWN', { evidenceRef: `ship-${operationId}`, error: mergeVerified ? undefined : 'merge reported but not verified against the intended base' });
        this.journal(goal.id).append({ type: 'OPERATION_RESULT', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId, status: mergeVerified ? 'succeeded' : 'UNKNOWN' } });
        return mergeVerified ? this.close(goal, card, next) : { run: next, directive: { kind: 'wait', cardId: card.id, on: `merge-verify:${operationId}`, pollSeconds: 60, narration: 'Ship exited 0 but the merge is not verified on the intended base; reconcile the PR/merge token before CLOSE.' } };
      });
    }

    this.ops.markResult(operationId, 'failed', { error: `${result.outcome}: ${result.detail}` });
    this.journal(goal.id).append({ type: 'OPERATION_RESULT', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId, status: 'failed', outcome: result.outcome } });
    const stopWith = (stop: StopRecord, extra: Partial<CardRun> = {}) => finish(() => ({ ...extra, state: 'STOP', stop }), (next) => ({ run: next, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } }));
    const buildDirective = (next: CardRun, narration: string, effort?: EffortLevel, skills?: string[]): CardDirective => ({ kind: 'build', cardId: card.id, worktree: next.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: next.redReceipt, dodCommand: card.dod_command, effort: effort ?? next.effort?.baseline ?? 'medium', attempt: (next.effort?.attempts.length ?? 0) + 1, skills: skills ?? this.buildSkills(goal, card), narration });
    const buildWith = (patchOf: (latest: CardRun) => Partial<CardRun>, narration: string, effort?: EffortLevel, skills?: string[]) => finish((latest) => ({ ...patchOf(latest), state: 'BUILD' }), (next) => ({ run: next, directive: buildDirective(next, narration, effort, skills) }));

    switch (result.outcome) {
      case 'review-blocked': {
        // The action follows the ledger locked at this moment: a block recorded meanwhile makes this one the second.
        return finish(
          (latest) => {
            if (classified.outcome === 'pass') {
              // R10: the document blocked on advisory notes only. The loop recorded a pass, no block was consumed and the
              // candidate keeps its receipts; the ship path still refused the merge, so a human decides, not a repair.
              const stop = makeStop('review', `the ship path refused the merge on reasons the loop reads as advisory notes, never a block: ${shipAdvisory.join(' | ') || 'none named'}`, 'answer the notes or adjust the ship path reviewer; the candidate and its DoD receipt stand, no decision or block was consumed', { at: now, global: false });
              return { state: 'STOP', stop };
            }
            if (latest.review.substantiveBlocks >= 2 || reviewDecision?.action === 'stop-review') {
              const stop = makeStop('review', this.withContest(reviewDecision?.action === 'stop-review' ? reviewDecision.detail : 'second substantive block', latest.findings), 'return the PR and retained verdict evidence for human adjudication; no counter reset', { at: now, global: false });
              return { state: 'STOP', stop };
            }
            // The two R3 decisions are the formal review's own budget: the episode reopens and the repair is the next attempt.
            const effort = latest.effort ? reopenAfterReviewBlock(latest.effort, classified.reasons[0] ?? 'review block') : latest.effort;
            return { state: 'REVIEW_FIX', effort, dodReceipt: undefined, blockedReceipt: this.keepReceipt(latest, { stage: 'formal', candidateSha: latest.candidate?.sha }) };
          },
          (next) =>
            next.state === 'STOP' && next.stop
              ? { run: next, directive: { kind: 'stop', cardId: card.id, stop: next.stop, narration: next.stop.detail } }
              : { run: next, directive: { kind: 'review-fix', cardId: card.id, reasons: classified.reasons, remainingDecisions: Math.max(0, 2 - next.review.substantiveDecisions), narration: 'Substantive block: fix within scope or revert; then rebuild and ship the repaired candidate (run `aidlc card next` to open the repair attempt).' } },
        );
      }
      case 'review-no-verdict': {
        // A quota hold is WAIT on the pool hold set above, never a no-verdict: no retry or decision is spent, and `card next`
        // ships the same candidate again once the hold has passed.
        if (classified.outcome === 'quota-hold') {
          const pollSeconds = Math.max(60, Math.ceil((Date.parse(holdUntil) - Date.parse(now)) / 1000));
          return finish(() => ({ state: 'WAIT' }), (next) => ({ run: next, directive: { kind: 'wait', cardId: card.id, on: 'review-quota', pollSeconds, narration: `The ship-path reviewer reported a quota/rate limit; review pool ${goal.reviewPool} is held until ${holdUntil} (not a decision, no retry spent). Then run \`aidlc card next ${card.id}\`.` } }));
        }
        if (reviewDecision?.action === 'retry-review') {
          return finish(() => ({ state: 'SHIP' }), (next) => ({ run: next, directive: { kind: 'ship', cardId: card.id, base: this.config.base, mode: run.mode, narration: `No verdict (${classified.runStatus}); raw evidence preserved. One retry remains across script and driver: re-run the same ship command.` } }));
        }
        return stopWith(makeStop('review', 'missing/malformed/stale verdict after the single retry', 'preserve raw output; never pass; hand off for adjudication', { at: now, global: false }));
      }
      case 'ci-red':
      case 'ci-timeout': {
        const text = `${result.receipt.stdout}\n${result.receipt.stderr}`;
        // The classifier reads the structured gate lines for names and keeps wait lines and payloads out of the log patterns.
        const cls = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: result.outcome === 'ci-timeout' ? 'timed_out' : 'failure', logExcerpt: text }]);
        this.journal(goal.id).append({ type: 'CI_CLASSIFIED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { class: cls.class, evidence: cls.evidence.slice(0, 5) } });
        const runId = text.match(/runs\/(\d+)/)?.[1] ?? `ship-${operationId}`;
        if (cls.class === 'security') {
          // A red secret or security scan is never rerun and never repaired blind: STOP/risk naming the check.
          const finding = cls.evidence.find((e) => e.startsWith('security: '))?.slice('security: '.length) ?? cls.failedJobs.join(',');
          return stopWith(makeStop('risk', `security gate red: ${finding}`, 'remove the finding from the change or the history, then ship a new candidate; the gate is never rerun or bypassed', { at: now, global: false }), { dodReceipt: undefined, blockedReceipt: undefined });
        }
        // The rerun allowance, granted or denied, and the directive that follows are decided on the CI ledger locked at
        // completion, never on the snapshot the ship was issued from: a rerun another window persisted meanwhile is kept and
        // counted (that window's rerun is reconciled first), and one it cancelled meanwhile no longer consumes the allowance.
        const rerunOn = (ci: CardRun['ci']) => canRerun(ci, runId, 1, candidateDigest, cls.class);
        const snapshotAllowed = rerunOn(run.ci).allowed;
        let decided: RerunDecision | undefined;
        const codeDefect = `CI code defect (${cls.evidence[0] ?? ''}): repair in BUILD and ship a new candidate.`;
        const applied = finish(
          (latest) => {
            decided = rerunOn(latest.ci);
            if (decided.allowed) return { state: 'SHIP', ci: recordRerunIntent(latest.ci, runId, 1, candidateDigest, now) };
            if (cls.class === 'code-defect') return { state: 'BUILD', dodReceipt: undefined, blockedReceipt: undefined };
            if (snapshotAllowed) return { state: 'WAIT' };
            return { state: 'STOP', stop: makeStop('ci', decided.reason, 'diagnose the failure before any further rerun', { at: now, global: false }) };
          },
          (next) => {
            if (decided?.allowed) return { run: next, directive: { kind: 'ship', cardId: card.id, base: this.config.base, mode: run.mode, narration: `Transient CI failure (${cls.evidence[0] ?? 'evidence'}): one same-origin rerun permitted and persisted; rerun the ship/CI for the same candidate and reconcile (aidlc card ci-reconcile ${card.id} --run ${runId}).` } };
            if (cls.class === 'code-defect') return { run: next, directive: buildDirective(next, codeDefect) };
            if (snapshotAllowed) return { run: next, directive: { kind: 'wait', cardId: card.id, on: 'record-changed', pollSeconds: 0, narration: `The rerun allowance of this candidate was consumed while the ship result was applied (${decided?.reason ?? rerunOn(next.ci).reason}); run \`aidlc card next ${card.id}\` again.` } };
            const stop = next.stop ?? makeStop('ci', decided?.reason ?? rerunOn(next.ci).reason, 'diagnose the failure before any further rerun', { at: now, global: false });
            return { run: next, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
          },
        );
        if (decided?.allowed && applied.directive.kind === 'ship') this.journal(goal.id).append({ type: 'CI_RERUN', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { runId, candidateDigest, persistedBeforeRequest: true } });
        return applied;
      }
      case 'dod-failed':
      case 'verify-failed':
      case 'scope-blocked':
      case 'budget-over': {
        return buildWith(() => ({ dodReceipt: undefined, blockedReceipt: undefined }), `${result.outcome}: ${result.detail}. Repair within scope (never weaken a test or widen allow_paths to pass a gate) and re-run the DoD.`);
      }
      case 'red-missing': {
        // The ship path rejected the RED receipt: not a code fault, so a succeeded episode is reopened rather than counted,
        // provided the episode can still admit an attempt; the rejected receipt is never reused as proof.
        const admission = checkAdmission(run.deadline, now);
        if (admission.phase !== 'open') {
          return stopWith(makeStop('time', `RED receipt rejected (${result.detail}) after the card deadline (${admission.phase}); no repair attempt may start`, 'hand off with the branch and the retained ship output; extend only explicitly', { at: now, global: false }));
        }
        const reopened = reopenEpisode(run.effort);
        const inadmissible = reopened ? nextEffortAction(reopened, { harderProblem: true, limitsPermit: true }) : undefined;
        if (inadmissible && inadmissible.action !== 'attempt') {
          return stopWith(makeStop('card', `RED receipt rejected (${result.detail}) but the effort episode cannot admit a repair attempt: ${inadmissible.action === 'stop' ? `${inadmissible.reason}: ${inadmissible.detail}` : 'episode already terminal'}`, 'amend the goal with a replacement card to open a linked episode, or resume with a fresh generation', { at: now, global: false }));
        }
        const repairEffort = inadmissible?.action === 'attempt' ? inadmissible.effort : (run.effort?.baseline ?? 'medium');
        return buildWith((latest) => ({ dodReceipt: undefined, blockedReceipt: undefined, redReceipt: undefined, effort: reopenEpisode(latest.effort), pendingRepair: { kind: 'red-missing', detail: result.detail, at: now, rejectedReceipt: latest.redReceipt } }), `${result.outcome}: ${result.detail}. Establish the RED receipt again within scope and re-run the DoD.`, repairEffort);
      }
      case 'auth-failed': {
        return stopWith(makeStop('auth', 'GitHub account/permission guard failed', 'run `gh auth login` for the configured personal account; never downgrade to local mode silently', { at: now }));
      }
      case 'no-reviewer': {
        return stopWith(makeStop('capability', 'a blocking review is required but no reviewer backend is configured', 'configure ReviewCommand/codex or choose a blocking path', { at: now, global: false }));
      }
      case 'secrets-blocked':
      case 'license-blocked': {
        return stopWith(makeStop('risk', `${result.outcome}: ${result.detail}`, 'remove the offending content/dependency; these gates are never bypassed', { at: now, global: false }));
      }
      case 'merge-failed':
      default: {
        // Only a real conflict returns to BUILD, and only on an affirmative diagnostic in the ship output: git's CONFLICT
        // markers or GitHub's clean-merge failure. A policy or status-check refusal, or the word inside a card id or a
        // resume command, never counts.
        if (result.outcome === 'merge-failed' && hasConflictDiagnostic(result.receipt)) {
          const admission = checkAdmission(run.deadline, now);
          if (admission.phase !== 'open') {
            return stopWith(makeStop('time', `merge conflict on the base sync after the card deadline (${admission.phase}); no repair attempt may start`, 'hand off with the branch and the retained ship output; extend only explicitly', { at: now, global: false }));
          }
          const reopened = reopenEpisode(run.effort);
          const inadmissible = reopened ? nextEffortAction(reopened, { harderProblem: true, limitsPermit: true }) : undefined;
          if (inadmissible && inadmissible.action !== 'attempt') {
            return stopWith(makeStop('card', `merge conflict on the base sync but the effort episode cannot admit a repair attempt: ${inadmissible.action === 'stop' ? `${inadmissible.reason}: ${inadmissible.detail}` : 'episode already terminal'}`, 'amend the goal with a replacement card to open a linked episode, or resume with a fresh generation', { at: now, global: false }));
          }
          const detail = `merge conflict on the base sync (${result.detail})`;
          const repairEffort = inadmissible?.action === 'attempt' ? inadmissible.effort : (run.effort?.baseline ?? 'medium');
          // A CHANGELOG merge the ship path committed itself (T0-BASE-SYNC-CHANGELOG) is the same repair with the merge done.
          const step = result.sentinels.includes('[SHIP-BASE-SYNC-MERGED]')
            ? `the ship path merged the entries both sides added to CHANGELOG.md Unreleased and committed the merge; check it, rerun the DoD on it and record it as the attempt`
            : `resolve every hunk by intent with the merge-conflicts skill (merge only, never rebase), rerun the DoD and record the attempt`;
          return buildWith((latest) => ({ dodReceipt: undefined, blockedReceipt: undefined, effort: reopenEpisode(latest.effort), pendingRepair: { kind: 'merge-conflict', detail, at: now } }), `Merge conflict on the base sync (${result.detail}): ${step}. The merge commit is a new candidate: it costs an R2 round and, once R3 has decided, the second R3 decision.`, repairEffort, ['merge-conflicts', ...this.buildSkills(goal, card)]);
        }
        return stopWith(makeStop('tool', `unclassified ship outcome (exit ${result.receipt.exitCode}): ${result.detail}`, result.resumeCommand ? `inspect diagnostics, then resume with: ${result.resumeCommand}` : 'inspect the ship output and the retained receipt', { at: now, global: false }));
      }
    }
  }

  /** Reconcile a persisted CI rerun by looking up its actual attempt (Q7). */
  ciReconcile(goal: Goal, card: Card, caller: CardRun, runId: string, lookup?: () => { status: string; conclusion: string | null; attempt: number }): CardRun {
    const now = this.clock();
    // The stored run, as every writer of this runner: a caller's snapshot never writes its generation or a stop back.
    const run = this.store.getCardRun(goal.id, card.id) ?? caller;
    let outcome: 'queued' | 'in_progress' | 'success' | 'failure' | 'lost' = 'lost';
    try {
      const view = lookup ? lookup() : this.config.repository ? this.gh.runView(this.config.repository, runId, this.repo.mainRoot) : undefined;
      if (view) {
        if (view.status === 'completed') outcome = view.conclusion === 'success' ? 'success' : 'failure';
        else if (view.status === 'queued') outcome = 'queued';
        else outcome = 'in_progress';
      }
    } catch {
      outcome = 'lost';
    }
    const ci = reconcileRerun(run.ci, runId, 1, outcome, now);
    this.journal(goal.id).append({ type: 'OPERATION_RECONCILED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { runId, outcome } });
    return this.save({ ...run, ci, state: outcome === 'success' ? 'SHIP' : outcome === 'failure' ? 'BUILD' : 'WAIT' });
  }

  private close(goal: Goal, card: Card, caller: CardRun): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    // The stored run is the truth: a card next that read before a concurrent card close never undoes a recorded disposition.
    const run = this.store.getCardRun(goal.id, card.id) ?? caller;
    const missing = Object.entries(run.closure).filter(([, v]) => !v).map(([k]) => k);
    let ownerGeneration = run.ownerGeneration;
    if (missing.length) {
      // The closing session holds the card lease: the owner renews it, a replacement takes over an expired one once no
      // delivery operation of the card is unresolved, and a live lease of another session stops the card.
      const key = resourceKeys.card(this.repo.key, card.id);
      const claim = this.leases.claim(key, { operation: `card:${card.id}:close`, now });
      if (claim.status === 'held') {
        const stop = makeStop('ownership', `card ${card.id} is owned by session ${claim.lease.owner.session} (generation ${claim.lease.generation}) while it closes`, 'let the owner close it, or take over after its lease expires and its operations are reconciled', { at: now, global: false });
        const stopped = this.save({ ...run, state: 'STOP', stop });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
      }
      if (claim.status === 'expired') {
        const unresolved = this.ops.list({ goalId: goal.id, cardId: card.id }).filter((o) => ['issued', 'running', 'UNKNOWN'].includes(o.status)).map((o) => o.id);
        try {
          const taken = this.leases.takeover(key, () => ({ reconciled: unresolved.length === 0, unresolvedOperations: unresolved }), { operation: `card:${card.id}:close`, now });
          ownerGeneration = taken.lease.generation;
          this.journal(goal.id).append({ type: 'LEASE_ACQUIRED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { resource: key, leaseGeneration: taken.lease.generation, takeover: true, previousOwner: claim.lease.owner.session } });
        } catch (err) {
          const stop = makeStop('ownership', `card ${card.id}: ${(err as Error).message}`, 'reconcile the unresolved operations, then close the card again', { at: now, global: false });
          const stopped = this.save({ ...run, state: 'STOP', stop });
          return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
        }
      } else {
        ownerGeneration = claim.lease.generation;
        this.journal(goal.id).append({ type: claim.status === 'acquired' ? 'LEASE_ACQUIRED' : 'LEASE_RENEWED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { resource: key, leaseGeneration: claim.lease.generation } });
      }
    }
    const next = this.save({ ...run, state: missing.length ? 'CLOSE' : 'DONE', ownerGeneration });
    if (!missing.length) {
      const key = resourceKeys.card(this.repo.key, card.id);
      try {
        if (run.ownerGeneration !== undefined) this.leases.release(key, run.ownerGeneration);
      } catch {
        /* lease already gone */
      }
      this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { from: 'CLOSE', to: 'DONE' } });
      return { run: next, directive: { kind: 'done', cardId: card.id, narration: 'Closure verified; card DONE.' } };
    }
    // The lesson step has its own flags; every other step is marked by its own name.
    const firstFlag = missing[0] === 'lessons' ? '--lesson "<NEVER|ALWAYS|NOTE> <rule> (source: <ref>)"' : `--${missing[0]}`;
    const lessonHint = missing.includes('lessons') ? ' The lesson step takes --lesson "<NEVER|ALWAYS|NOTE> <rule> (source: <ref>)" or --skip-lesson "<why>"; --all never records it.' : '';
    return { run: next, directive: { kind: 'close', cardId: card.id, missing, narration: `Merge verified. Complete only the missing closure steps (${missing.join(', ')}) through the existing approved metadata procedure, then mark them with \`aidlc card close ${card.id} ${firstFlag}\`.${lessonHint}` } };
  }

  /**
   * Closure flags for a card whose merge is verified. The card lease is the serialisation: the run is reloaded, its merge
   * evidence and a present lease generation are required, and the lease is fenced (a stale or foreign session refused);
   * only a CLOSE run of a live goal accepts flags, and the persisted goal is read again right before anything is written.
   * `lessons` needs a disposition: one lesson line appended to docs/LESSONS.md or a reason to skip. A lesson is journaled
   * as pending before the file changes and as recorded once the closure is saved; a retry reuses the pending line, so a
   * completed append is recognised even across a date rollover and no line is written twice.
   */
  markClosure(goal: Goal, card: Card, run: CardRun, flags: Partial<CardRun['closure']>, disposition: { lessonText?: string; skipped?: string } = {}): CardRun {
    const now = this.clock();
    const assertLiveGoal = () => {
      const persisted = this.store.getGoal(goal.id) ?? goal;
      if (persisted.terminal) throw new Error(`goal ${goal.id} is terminal (${persisted.state}); closure cannot change`);
      if (persisted.generation !== goal.generation) throw new Error(`goal ${goal.id} is at generation ${persisted.generation}, the caller holds ${goal.generation}; reload the goal before closing`);
    };
    assertLiveGoal();
    const current = this.store.getCardRun(goal.id, card.id) ?? run;
    if (current.state !== 'CLOSE' || !current.mergeVerified) throw new Error(`card ${card.id} is ${current.state}${current.mergeVerified ? '' : ' without a verified merge'}; closure flags apply to a CLOSE run with its merge verified`);
    if (current.ownerGeneration === undefined) throw new Error(`card ${card.id} holds no card lease; run aidlc card next ${card.id} to hold it before closing`);
    this.leases.fence(resourceKeys.card(this.repo.key, card.id), current.ownerGeneration, currentActor(), now);
    const file = this.lessonsFile();
    const data: Record<string, unknown> = {};
    if (flags.lessons) {
      if (disposition.lessonText && disposition.skipped) throw new Error('record either a lesson or a reason to skip, not both');
      if (disposition.lessonText) {
        const entry = lessonFromText(disposition.lessonText, card.id, now.slice(0, 10));
        const pending = this.journal(goal.id)
          .filter((e) => e.type === 'EVIDENCE_RETAINED' && e.cardId === card.id && typeof e.data['lessonPending'] === 'string')
          .map((e) => String(e.data['lessonPending']))
          .reverse()
          .find((l) => {
            const p = parseLessonLine(l);
            return p !== undefined && p.ref === entry.ref && p.kind === entry.kind && p.rule === entry.rule && p.source === entry.source;
          });
        const line = pending ?? formatLesson(entry);
        if (!hasLesson(file, line)) {
          assertLiveGoal();
          if (!pending) this.journal(goal.id).append({ type: 'EVIDENCE_RETAINED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { closure: current.closure, lessonPending: line } });
          appendLesson(file, parseLessonLine(line) ?? entry);
        }
        data['lesson'] = line;
      } else if (disposition.skipped?.trim()) data['lessonSkipped'] = disposition.skipped.trim();
      else throw new Error('the lessons closure step needs --lesson "<NEVER|ALWAYS|NOTE> <rule> (source: <ref>)" or --skip-lesson "<why>"');
    }
    const closure = { ...current.closure, ...flags };
    assertLiveGoal();
    this.journal(goal.id).append({ type: 'EVIDENCE_RETAINED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { closure, ...data } });
    return this.save({ ...current, closure });
  }

  /** Write a fix-task marker so the protect-tests hook locks test files during a fix (Q1). */
  setFixTaskMarker(cardId: string | undefined): void {
    const file = path.join(this.paths.root, 'fix-task');
    mkdirSync(this.paths.root, { recursive: true });
    if (cardId) writeFileSync(file, cardId, 'utf8');
    else if (existsSync(file)) writeFileSync(file, '', 'utf8');
  }

  static classify = classifyShipOutput;
  static newId(): string {
    return randomUUID();
  }
}

/** A merge-blocking verdict turns the last successful attempt into a counted failure (cause = the block). */
/** A ship-side setback that is not the code's fault (a merge conflict, a rejected RED receipt) reopens a succeeded episode so the next attempt is admitted without counting a failure. */
/**
 * True only when a line of the ship output is git's or GitHub's own merge-conflict diagnostic, anchored at the start of
 * the line: `CONFLICT (...)`, `Automatic merge failed; fix conflicts and then commit the result.`, `Merge conflict in ...`,
 * or gh's `Pull request #N is not mergeable: the merge commit cannot be cleanly created` (optionally behind gh's failure
 * glyph). A quoted message, a resume command or a card id never starts a line that way, so they never count, while a
 * genuine diagnostic that happens to mention a file such as `resume.ts` still does.
 */
export function hasConflictDiagnostic(receipt: { stdout: string; stderr: string }): boolean {
  const diagnostic = [
    /^CONFLICT \(/,
    /^Automatic merge failed; fix conflicts and then commit the result\.$/,
    /^Merge conflict in /,
    /^(?:X |\u2717 )?Pull request #\d+ is not mergeable: the merge commit cannot be cleanly created/,
  ];
  return `${receipt.stdout}\n${receipt.stderr}`
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((line) => diagnostic.some((re) => re.test(line)));
}

/** A pending repair clears on a successful attempt; a rejected RED receipt clears only when the success brings a replacement receipt, so the rejected one is never reloaded as proof. */
export function clearsPendingRepair(pending: CardRun['pendingRepair'], input: { outcome: 'success' | 'fail' | 'not-counted'; redReceipt?: string }): boolean {
  if (!pending || input.outcome !== 'success') return false;
  if (pending.kind !== 'red-missing') return true;
  return input.redReceipt !== undefined && input.redReceipt !== pending.rejectedReceipt;
}

export function reopenEpisode(episode: NonNullable<CardRun['effort']> | undefined): NonNullable<CardRun['effort']> | undefined {
  if (!episode || episode.terminal !== 'succeeded') return episode;
  return { ...episode, terminal: undefined };
}

