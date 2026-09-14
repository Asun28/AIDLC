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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { selectCardState, type CardEvidence } from '../core/card-machine.ts';
import { checkAdmission } from '../core/deadlines.ts';
import { createEpisode, finishAttempt, nextEffortAction, reopenAfterReviewBlock, startAttempt } from '../core/effort.ts';
import { acceptFinding, classifyVerdict, describeContested, describeDeadlock, disputeFinding, findingsOfBlock, nonAcceptanceRounds, recordFindings, recordReviewOutcome, rerunAllowed, reviewRequestKey, snapshotFindings, type BlockSelector, type ClassifiedVerdict, type FindingSnapshot, type LedgerDecision, type RecordFindingsInput, type RecordFindingsResult } from '../core/review-policy.ts';
import { classifyCiFailure, canRerun, recordRerunIntent, reconcileRerun, hasUnreconciledRerun } from '../core/ci-policy.ts';
import { makeStop } from '../core/stop.ts';
import { CardRun, MAX_NO_VERDICT_RETRIES, MAX_SUBSTANTIVE_REVIEW_DECISIONS, RECONCILE_GRACE_MS, addMs, type BlockedReceipt, type Card, type EffortLevel, type Goal, type PreReviewRound, type ReviewFinding, type ReviewInvocation, type ReviewLedger, type StopRecord, type Verdict } from '../core/types.ts';
import { LeaseStore, FencedError, resourceKeys } from '../coordination/lease.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import { ReviewQueue } from '../coordination/review-queue.ts';
import { GitProbe } from '../probes/git.ts';
import { GhProbe } from '../probes/gh.ts';
import { run, runSync, type Runner, type SyncRunner } from '../probes/exec.ts';
import { decideWorktree } from '../delivery/worktree.ts';
import { classifyShipOutput, DryRunShipPath, ScaffoldShipPath, type ShipPath, type ShipResult } from '../delivery/ship.ts';
import { GitHubShipPath } from '../delivery/github-ship.ts';
import { buildReviewPrompt, citedReasonsOf, collectCandidateDiff, materialiseVerdictSchema, pathAllowed, runReviewPanel, type PanelResult, type PriorFinding } from '../review/pre-review.ts';
import { Journal, currentActor } from '../state/journal.ts';
import { GoalStore } from '../state/goal-store.ts';
import type { StatePaths, RepoIdentity } from '../state/paths.ts';
import type { ProjectConfig } from '../config.ts';
import { resolveWorktreeRoot } from '../config.ts';

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
  | { kind: 'prepare'; cardId: string; action: 'start' | 'attach'; worktree: string; skills?: string[]; narration: string }
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
  if (config.shipPath === 'scaffold') return new ScaffoldShipPath({ mainRoot, worktreeRoot: resolveWorktreeRoot(config), runner });
  if (config.shipPath === 'github') {
    const gh = config.github;
    return new GitHubShipPath({ mainRoot, worktreeRoot: resolveWorktreeRoot(config), repository: config.repository ?? '', runner, requiredChecks: gh.requiredChecks, requireVerdict: gh.requireVerdict, ciTimeoutMs: gh.ciTimeoutMs, ciPollMs: gh.ciPollMs });
  }
  return new DryRunShipPath();
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

  private journal(goalId: string): Journal {
    return Journal.forGoal(this.paths.journal, goalId);
  }

  worktreePath(cardId: string): string {
    return path.join(resolveWorktreeRoot(this.config), cardId);
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
      this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle, exhausted: true, action: 'ship', residual, residualFindings, findings: [], reraised: [], resolved: [], deadlock: deadlock || undefined } });
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

  /** Drop a pending formal-review reservation from the persisted run (the dispatch failed before a decision). */
  private releaseReservation(goal: Goal, card: Card, invocationId: string): void {
    if (!this.store.getCardRun(goal.id, card.id)) return;
    this.store.updateCardRun(goal.id, card.id, (current) => ({ ...current!, review: { ...current!.review, invocations: current!.review.invocations.filter((i) => i.invocationId !== invocationId) } }));
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

  /** Gather evidence and select the next card directive. Performs only the bounded action of the selected state. */
  next(goal: Goal, card: Card, run: CardRun, options: { effort?: EffortLevel } = {}): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    const key = resourceKeys.card(this.repo.key, card.id);
    const me = currentActor();
    let lease = this.leases.read(key);
    // Heartbeat: the owner's own `card next` renews the card lease, as the controller renews the goal
    // lease. Expiry alone never proves the owner stopped; only a takeover changes the generation, and
    // that case still fails the fence in ship(). A stop caused only by the owner's own expiry is
    // revalidated by the renewal.
    if (lease && !lease.released && lease.owner.session === me.session && lease.owner.host === me.host && run.ownerGeneration === lease.generation) {
      const wasExpired = Date.parse(lease.expiresAt) < Date.parse(now);
      const renewal = this.leases.claim(key, { operation: lease.operation, now });
      if (renewal.status === 'renewed') {
        lease = renewal.lease;
        const revalidated = run.stop?.reason === 'ownership';
        if (wasExpired || revalidated) this.journal(goal.id).append({ type: 'LEASE_RENEWED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { resource: key, leaseGeneration: lease.generation, wasExpired, revalidated } });
        if (revalidated) run = { ...run, stop: undefined, blocker: undefined };
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
      closureComplete: Object.values(run.closure).every(Boolean),
      // A block stays pending only while the reviewed candidate is still the current candidate; a new
      // candidate (new sha/digest after the fix) moves the card back through BUILD/SHIP, and so does a
      // block whose every finding the author disputed (the next decision runs on the unchanged candidate).
      reviewBlockPending: (() => {
        const lastBlock = [...run.review.invocations].reverse().find((i) => i.outcome === 'block');
        if (!lastBlock || reviewExhausted || run.candidate?.digest !== lastBlock.candidateDigest) return false;
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
    if (next.state !== run.state) this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { from: run.state, to: next.state, reason: decision.reason } });

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

  private prepare(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    const key = resourceKeys.card(this.repo.key, card.id);
    const claim = this.leases.claim(key, { operation: `card:${card.id}`, now });
    if (claim.status === 'held') {
      const stop = makeStop('ownership', `card ${card.id} is owned by session ${claim.lease.owner.session} (generation ${claim.lease.generation})`, 'attach read-only or take over after the lease expires and old effects are reconciled', { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    if (claim.status === 'expired') {
      const stop = makeStop('ownership', `card ${card.id} has an expired lease from session ${claim.lease.owner.session}`, "reconcile the old owner's in-flight operations, then `aidlc card takeover`", { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    this.journal(goal.id).append({ type: claim.status === 'acquired' ? 'LEASE_ACQUIRED' : 'LEASE_RENEWED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { resource: key, leaseGeneration: claim.lease.generation } });
    const worktreeRoot = resolveWorktreeRoot(this.config);
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
    const next = this.save({ ...run, state: 'BUILD', worktree: decision.path, branch: card.id, ownerGeneration: claim.lease.generation, stop: undefined, blocker: undefined });
    return {
      run: next,
      directive: {
        kind: 'prepare',
        cardId: card.id,
        action: decision.action,
        worktree: decision.path,
        skills: [],
        narration: 'Read docs/LESSONS.md once before the first attempt. ' + (decision.action === 'start' ? `Start a new worktree for ${card.id} at ${decision.path} (scaffold: pwsh scripts/task.ps1 -TaskId ${card.id} -Phase start from the main checkout). ${decision.reason}` : `Attach to existing worktree ${decision.path}: ${decision.reason}. Do not re-run start.`),
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
    }
    return this.save({ ...run, effort: episode, dodReceipt: input.outcome === 'success' ? (input.dodReceipt ?? `dod:${now}`) : run.dodReceipt, redReceipt: input.redReceipt ?? run.redReceipt, candidate, pendingRepair: clearsPendingRepair(run.pendingRepair, input) ? undefined : run.pendingRepair, blockedReceipt: input.outcome === 'not-counted' && !input.checksLost?.length ? run.blockedReceipt : undefined });
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
    // R3 as a command: a fresh formal pass for this candidate before any ship is issued.
    const formal = this.formalReviewGate(goal, card, run);
    if (formal) return formal;
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
    this.ops.markIssued(op.id, undefined, now);
    this.journal(goal.id).append({ type: 'OPERATION_ISSUED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId: op.id } });
    const result = this.shipPath.ship({ cardId: card.id, base: this.config.base, mode: run.mode, skipRed: !card.tdd, timeoutMs: 60 * 60 * 1000, candidateSha: run.candidate?.sha });
    return this.applyShipResult(goal, card, run, result, op.id, key, candidateDigest);
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
    const pending = run.preReview.rounds.find((r) => r.outcome === 'pending' && r.candidateDigest === digest);
    if (pending) {
      const expiry = (r: PreReviewRound) => Date.parse(r.requestedAt) + cfg.timeoutMs + RECONCILE_GRACE_MS;
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
      if (cancelled) this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle: cancelled.cycle, round: cancelled.round, reviewer: cancelled.reviewer, candidateDigest: digest, outcome: 'no-verdict', decision: 'abandoned: no result within the timeout and the grace', reservationId: cancelled.reservationId, findings: [], reraised: [], resolved: [] } });
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
      if (cfg.onExhausted === 'ship') return { run: this.recordResidualHandoff(goal, card, run, cycle, digest ?? 'unknown') };
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
   * REVIEW_FIX by `formalReview`; a quota hold parks the card until `holdUntil`.
   */
  private formalReviewGate(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive: CardDirective } | undefined {
    const cfg = this.config.formalReview;
    if (!cfg.command.length) return undefined;
    const now = this.clock();
    const digest = run.candidate?.digest;
    const last = [...run.review.invocations].reverse().find((i) => i.reviewer === cfg.reviewer && i.candidateDigest === digest);
    if (last?.outcome === 'pass') return undefined;
    let disputedNote = '';
    if (last?.outcome === 'block') {
      // Only a merge-blocking block is pending; advisory findings are retained and never become a silent merge bar.
      if (!this.invocationBlocking(run, card, last)) return undefined;
      const answered = run.candidate?.sha ? this.blockAnswered(run, { stage: 'formal', candidateSha: run.candidate.sha }) : { answered: false, open: [] };
      if (!answered.answered) {
        const next = this.save({ ...run, state: 'REVIEW_FIX', dodReceipt: undefined, blockedReceipt: this.keepReceipt(run, { stage: 'formal', candidateSha: run.candidate?.sha }) });
        const ids = answered.open.length ? ` Open finding(s): ${answered.open.join(', ')}; dispute one with \`aidlc review dispute ${card.id} <id> --note "<why>"\`, and the next decision runs on the unchanged candidate once every finding of the block is disputed.` : '';
        return { run: next, directive: { kind: 'review-fix', cardId: card.id, reasons: run.review.lastVerdict?.reasons ?? [], remainingDecisions: Math.max(0, MAX_SUBSTANTIVE_REVIEW_DECISIONS - run.review.substantiveDecisions), narration: `Formal review block still pending on candidate ${digest ?? 'unknown'}: fix within scope or revert, rebuild, and record the attempt with the new candidate sha.${ids}` } };
      }
      disputedNote = ` Every finding of the last decision on this candidate is disputed; the next decision runs on the unchanged candidate with the author's notes.`;
    }
    if (last?.outcome === 'quota-hold' && last.holdUntil && Date.parse(last.holdUntil) > Date.parse(now)) {
      const next = this.save({ ...run, state: 'WAIT' });
      const pollSeconds = Math.max(60, Math.ceil((Date.parse(last.holdUntil) - Date.parse(now)) / 1000));
      return { run: next, directive: { kind: 'wait', cardId: card.id, on: 'review-quota', pollSeconds, narration: `Formal reviewer ${cfg.reviewer} reported a quota/rate limit; holding until ${last.holdUntil} (not a decision). Then run \`aidlc card next ${card.id}\`.` } };
    }
    // R3 policy: a further required review beyond the two-decision allowance is STOP/review, never a third run.
    if (run.review.substantiveDecisions >= MAX_SUBSTANTIVE_REVIEW_DECISIONS) {
      const stop = makeStop('review', `a further required review of candidate ${digest ?? 'unknown'} exceeds the two-decision allowance (${run.review.substantiveDecisions} used)`, 'return the retained verdict evidence for human adjudication; no counter reset', { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    const decision = run.review.substantiveDecisions + 1;
    const retry = last?.outcome === 'no-verdict' ? ' (retry: the previous run produced no verdict)' : '';
    const next = this.save({ ...run, state: 'SHIP' });
    return { run: next, directive: { kind: 'review', cardId: card.id, reviewer: cfg.reviewer, decision, maxDecisions: MAX_SUBSTANTIVE_REVIEW_DECISIONS, narration: `Formal review (R3, ${cfg.reviewer}) before the ship, decision ${decision}/${MAX_SUBSTANTIVE_REVIEW_DECISIONS}${retry}: run \`aidlc review r3 ${card.id}\`. A pass hands the candidate to the ship; a merge-blocking block returns it to REVIEW_FIX and the repaired candidate restarts the pre-review cycle.${disputedNote}` } };
  }

  /** The R3 guards over one record: stop, R2 eligibility, an in-flight decision, a quota hold, the same-candidate rule, the allowances. */
  private formalAdmission(current: CardRun, card: Card, candidateSha: string, candidateDigest: string, now: string): void {
    const cfg = this.config.formalReview;
    if (current.stop || current.state === 'STOP') throw new Error(`card run is stopped (${current.stop?.reason ?? 'STOP'}); no review may run: ${current.stop?.nextAction ?? 'resolve the stop first'}`);
    const eligibility = this.preReviewEligibility(current, candidateDigest);
    if (!eligibility.eligible) throw new Error(`pre-review pass required first (${eligibility.reason}): run \`aidlc review pre ${card.id}\` on candidate ${candidateSha.slice(0, 12)} before the formal review`);
    const ledger = current.review;
    const forCandidate = ledger.invocations.filter((i) => i.reviewer === cfg.reviewer && i.candidateDigest === candidateDigest);
    const pendingReservation = ledger.invocations.find((i) => i.outcome === 'pending' && i.candidateDigest === candidateDigest);
    if (pendingReservation) throw new Error(`a formal review of this candidate is already pending (${pendingReservation.invocationId}, requested ${pendingReservation.requestedAt}); join it, do not dispatch another`);
    const lastForCandidate = forCandidate[forCandidate.length - 1];
    if (lastForCandidate?.outcome === 'quota-hold' && lastForCandidate.holdUntil && Date.parse(lastForCandidate.holdUntil) > Date.parse(now)) {
      throw new Error(`formal reviewer ${cfg.reviewer} is on a quota hold until ${lastForCandidate.holdUntil}; do not re-run before it clears`);
    }
    // Same-candidate rule, keyed by the committed sha and independent of the reviewer's name: a blocked, unchanged
    // candidate (an advisory block included) is re-decided only with every finding of the block disputed.
    const lastDecided = [...ledger.invocations].reverse().find((i) => ((i.candidateSha ?? i.candidateDigest) === candidateSha || i.candidateDigest === candidateDigest) && (i.outcome === 'pass' || i.outcome === 'block'));
    if (lastDecided?.outcome === 'block') {
      const answered = this.blockAnswered(current, { stage: 'formal', candidateSha });
      if (!answered.answered) throw new Error(this.sameCandidateRefusal(card, candidateSha, 'its last formal decision', answered.open));
    }
    if (ledger.substantiveDecisions >= MAX_SUBSTANTIVE_REVIEW_DECISIONS) {
      throw new Error(`the two-decision review allowance is used (${ledger.substantiveDecisions}); ${lastForCandidate?.outcome === 'pass' ? 'the current candidate already holds its pass, ship it' : 'a further required review is STOP/review'}, not another run`);
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
  async formalReview(goal: Goal, card: Card, run: CardRun): Promise<{ run: CardRun; classified: ClassifiedVerdict; verdict?: Verdict; advisory: string[]; verdictRef?: string; logRef?: string; durationMs: number; receiptSha256: string }> {
    const cfg = this.config.formalReview;
    if (!cfg.command.length) throw new Error('formalReview.command is not configured (aidlc.config.json)');
    // Guards read the persisted run, not the caller's snapshot, so overlapping calls see each other's reservation.
    let persisted = this.store.getCardRun(goal.id, card.id) ?? run;
    if (persisted.stop || persisted.state === 'STOP') throw new Error(`card run is stopped (${persisted.stop?.reason ?? 'STOP'}); no review may run: ${persisted.stop?.nextAction ?? 'resolve the stop first'}`);
    const now = this.clock();
    const cwd = this.reviewCheckout(persisted);
    this.refuseDirtyCandidate(persisted, cwd);
    const baseRef = persisted.base?.oid ?? this.config.base;
    const candidateSha = this.pinnedCandidate(persisted, cwd);
    const candidateDigest = persisted.candidate?.digest ?? candidateSha;
    // Exhausted rounds reach R3 through the command as through the gate: the hand-off is recorded once either way.
    const eligibility = this.preReviewEligibility(persisted, candidateDigest);
    if (eligibility.eligible && eligibility.exhausted) persisted = this.recordResidualHandoff(goal, card, persisted, persisted.review.substantiveBlocks, candidateDigest);
    this.formalAdmission(persisted, card, candidateSha, candidateDigest, now);
    // Only the lease owner at the run's generation may reserve a decision.
    if (persisted.ownerGeneration !== undefined) {
      this.renewOwnLease(card.id, persisted, now);
      this.leases.fence(resourceKeys.card(this.repo.key, card.id), persisted.ownerGeneration, currentActor(), now);
    }
    const reviewDir = path.join(cwd, '.review');
    const schema = materialiseVerdictSchema(reviewDir);
    const reviewPolicy = this.reviewPolicy();
    const { changedPaths, diff, truncated } = collectCandidateDiff(this.runner, cwd, baseRef, cfg.maxDiffBytes, this.repo.isGit ? candidateSha : 'HEAD');
    if (!diff.trim()) throw new Error(`no committed candidate diff against ${baseRef} in ${cwd}; commit the candidate first`);
    // Deterministic scope gate (dimension 1): no model call, no decision consumed.
    const outOfScope = changedPaths.filter((p) => !pathAllowed(p, card.allow_paths));
    if (outOfScope.length) throw new Error(`out of scope: ${outOfScope.join(', ')} outside allow_paths; revert the change or amend the card before the formal review (no decision consumed)`);
    // Shared review admission (MS3): the command reviewer takes a pool slot like any other formal reviewer.
    const key = reviewRequestKey({ repository: goal.repository, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer });
    let enq = this.queue.enqueue({ pool: goal.reviewPool, repository: goal.repository, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer, requester: `${goal.id}:${card.id}`, deadline: run.deadline, now });
    if (enq.status === 'completed') enq = { status: 'enqueued', request: this.queue.requeue(key, now) };
    if (enq.status === 'joined' && enq.request.state === 'running') throw new Error(`a matching formal review is already running in pool ${goal.reviewPool}; join it, do not dispatch another`);
    const admit = this.admitReview(goal, card, key, now);
    if (admit.status !== 'admitted' || admit.request.key !== key) throw new Error(`review pool ${goal.reviewPool} is ${admit.status === 'admitted' ? 'occupied by another request' : admit.status}; the formal review waits for admission (aidlc review status)`);
    this.journal(goal.id).append({ type: 'REVIEW_ADMITTED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { key, seq: admit.request.seq, reviewer: cfg.reviewer } });
    // Reserve the invocation under the card-run lock before dispatch so a concurrent call cannot spend the same decision.
    // The guards are re-checked on the locked record (a dispute withdrawn or a decision recorded since the first read
    // refuses here), the owner's lease is renewed and fenced in the same transaction, and the numbering, the prior
    // findings and the snapshot the reviewer receives come from that record. A refused reservation frees the pool slot.
    let fileStem = '';
    let invocationId = '';
    let decisionNo = 0;
    let priorFindings: PriorFinding[] = [];
    let seen: Record<string, FindingSnapshot> = {};
    try {
      this.store.updateCardRun(goal.id, card.id, (locked) => {
        const current = locked ?? persisted;
        this.formalAdmission(current, card, candidateSha, candidateDigest, now);
        if (current.ownerGeneration !== undefined) {
          this.renewOwnLease(card.id, current, now);
          this.leases.fence(resourceKeys.card(this.repo.key, card.id), current.ownerGeneration, currentActor(), now);
        }
        const n = current.review.invocations.filter((i) => i.reviewer === cfg.reviewer).length + 1;
        fileStem = `${card.id}.r3.${n}.${randomUUID().slice(0, 8)}`;
        invocationId = `r3:${fileStem}`;
        decisionNo = current.review.substantiveDecisions + 1;
        priorFindings = this.priorFindingsFor(current);
        seen = this.findingsSnapshot(current);
        const reservation: ReviewInvocation = { invocationId, candidateDigest, candidateSha, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer, requestedAt: now, outcome: 'pending' };
        return { ...current, review: { ...current.review, invocations: [...current.review.invocations, reservation] } };
      });
    } catch (err) {
      this.queue.cancel(key, `formal review not dispatched: ${(err as Error).message}`, now);
      throw err;
    }
    const promptInArgv = cfg.command.some((a) => a.includes('{instructions}'));
    const promptFor = () => buildReviewPrompt({ stage: 'formal', includeDiff: !promptInArgv, reviewPolicy, card, base: baseRef, head: candidateSha, changedPaths, diff, truncated, priorFindings, round: decisionNo, maxRounds: MAX_SUBSTANTIVE_REVIEW_DECISIONS });
    let panel: PanelResult;
    try {
      // The formal review is never fanned out: one exhaustive pass per decision.
      panel = await runReviewPanel({ runner: this.asyncRunner, command: cfg.command, perspectives: [], promptFor, vars: { schema, cwd, base: baseRef, head: candidateSha, card: card.id }, cwd, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir, fileStem, head: candidateSha, reviewer: cfg.reviewer, changedPaths });
    } catch (err) {
      this.queue.markLost(key, `formal review did not run: ${(err as Error).message}`, this.clock());
      this.releaseReservation(goal, card, invocationId);
      throw err;
    }
    const after = this.clock();
    const decided = panel.outcome === 'pass' || panel.outcome === 'block';
    // Keep the reviewer's own binding: an explicit sha or branch that is not this candidate is a stale verdict, never a pass.
    const verdict: Verdict | undefined = decided && panel.verdict ? { ...panel.verdict, sha: panel.verdict.sha ?? candidateSha, branch: panel.verdict.branch ?? card.id, run_status: panel.runStatus } : undefined;
    let classified: ClassifiedVerdict;
    if (panel.outcome === 'quota-hold') classified = { outcome: 'quota-hold', mergeBlocking: false, runStatus: 'tool_error', reasons: panel.reasons, stale: false };
    else if (!verdict) classified = { outcome: 'no-verdict', mergeBlocking: false, runStatus: panel.runStatus, reasons: panel.reasons.length ? panel.reasons : ['missing or malformed verdict; never pass'], stale: false };
    else classified = classifyVerdict(verdict, { candidateSha, tier: card.tier, gateRequired: this.config.gateRequired });
    if (verdict && verdict.branch !== card.id) classified = { outcome: 'no-verdict', mergeBlocking: false, runStatus: 'malformed', reasons: [`stale verdict branch ${verdict.branch}`], stale: true };
    // Timed from the clock after the run: a review can outlast the hold it reports.
    const holdUntil = classified.outcome === 'quota-hold' ? addMs(after, panel.retryAfterMs ?? 15 * 60 * 1000) : undefined;
    if (holdUntil) this.queue.hold(key, holdUntil, 'reviewer reported rate limit/quota', after);
    else this.queue.complete(key, panel.verdictRef ?? 'no-verdict', after);
    const advisory = panel.advisory ?? [];
    const evidenceEntry = { id: `r3-${fileStem}`, kind: 'artifact' as const, createdAt: after, candidateDigest, note: `formal review ${cfg.reviewer} ${classified.outcome}: ${classified.reasons.join(' | ')}`.slice(0, 500) };
    const dropReservation = (r: CardRun): ReviewLedger => ({ ...r.review, invocations: r.review.invocations.filter((i) => i.invocationId !== invocationId) });
    const result = { classified, verdict, advisory, verdictRef: panel.verdictRef, logRef: panel.logRef, durationMs: panel.durationMs, receiptSha256: panel.receiptSha256 };
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
        release: (latest) => ({ ...latest, review: dropReservation(latest) }),
        decide: (latest) => {
          const rec = recordReviewOutcome(dropReservation(latest), { invocationId, candidateDigest, candidateSha, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer, requestedAt: now, verdictRef: panel.verdictRef, holdUntil, mergeBlocking: classified.mergeBlocking }, classified, verdict);
          decision = rec.decision;
          // Findings: every cited reason of a block (root or axis, advisory included) is recorded; a pass resolves the stage's open ones the reviewer received.
          // A routed skip is not a decision on the findings: it records and resolves nothing.
          const decidedOutcome = classified.outcome === 'block-defect' || classified.outcome === 'block-advisory' ? 'block' : classified.outcome === 'pass' ? 'pass' : 'no-verdict';
          const findingsInput: RecordFindingsInput = { stage: 'formal', round: rec.ledger.substantiveDecisions, candidateSha, at: after, outcome: decidedOutcome, reasons: decidedOutcome === 'block' && verdict ? citedReasonsOf(verdict, changedPaths) : [], advisory: classified.outcome === 'block-advisory', seen };
          const withDecision = (r: CardRun): CardRun => ({ ...r, review: rec.ledger });
          return {
            findingsInput,
            history: withDecision,
            commit: (r) => {
              let next = withDecision(r);
              switch (rec.decision.action) {
                case 'review-fix': {
                  // The review budget, not the ladder, paid for this block: the episode reopens and the repair is the next attempt.
                  const effort = r.effort ? reopenAfterReviewBlock(r.effort, classified.reasons[0] ?? 'review block') : r.effort;
                  next = { ...next, state: 'REVIEW_FIX', effort, dodReceipt: undefined, blocker: undefined, blockedReceipt: this.keepReceipt(r, { stage: 'formal', candidateSha }) };
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
    if (publishable && verdict) {
      const canonical =
        classified.outcome === 'block-advisory'
          ? { ...verdict, verdict: 'pass' as const, reasons: [], axes: { spec: { verdict: 'pass' as const, reasons: [] }, standards: { verdict: 'pass' as const, reasons: [] } }, advisory: [...new Set([...verdict.reasons, ...(verdict.axes?.spec?.reasons ?? []), ...(verdict.axes?.standards?.reasons ?? [])])] }
          : verdict;
      writeFileSync(path.join(reviewDir, `${card.id}.json`), JSON.stringify({ ...canonical, reviewer: cfg.reviewer }, null, 2) + '\n', 'utf8');
    }
    this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId, reviewer: cfg.reviewer, candidateDigest, outcome: classified.outcome, mergeBlocking: classified.mergeBlocking, decision: discardedDecision(committed.status) ?? decision?.action, runStatus: classified.runStatus, reasons: classified.reasons, advisory, findings: committed.found.raised, reraised: committed.found.reraised, resolved: committed.found.resolved, verdictRef: panel.verdictRef, receiptSha256: panel.receiptSha256, durationMs: panel.durationMs, holdUntil } });
    return { run: committed.run, ...result };
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
    const pending = forCandidate.find((r) => r.outcome === 'pending');
    if (pending) throw new Error(`a pre-review round of this candidate is in flight (reservation ${pending.reservationId ?? 'unknown'}, requested ${pending.requestedAt}); wait for it, do not dispatch another`);
    const rounds = current.preReview.rounds.filter((r) => r.cycle === cycle && r.outcome !== 'pending');
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
    return { cycle, round: rounds.filter((r) => r.outcome === 'pass' || r.outcome === 'block').length + 1, attemptNo: forCandidate.length + 1 };
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
    const { changedPaths, diff, truncated } = collectCandidateDiff(this.runner, cwd, baseRef, cfg.maxDiffBytes, this.repo.isGit ? candidateSha : 'HEAD');
    if (!diff.trim()) throw new Error(`no committed candidate diff against ${baseRef} in ${cwd}; commit the candidate first`);
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
      numbering = this.preReviewAdmission(current, card, candidateSha, candidateDigest, now);
      if (current.ownerGeneration !== undefined) {
        this.renewOwnLease(card.id, current, now);
        this.leases.fence(resourceKeys.card(this.repo.key, card.id), current.ownerGeneration, currentActor(), now);
      }
      fileStem = `${card.id}.pre.${numbering.cycle}.${numbering.round}.${numbering.attemptNo}.${randomUUID().slice(0, 8)}`;
      reservation = { round: numbering.round, cycle: numbering.cycle, reviewer: cfg.reviewer, candidateDigest, candidateSha, requestedAt: now, durationMs: 0, outcome: 'pending', reasons: [], reservationId: fileStem };
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
      const promptFor = (perspective?: string) => buildReviewPrompt({ stage: 'pre', includeDiff: !promptInArgv, perspective, reviewPolicy, card, base: baseRef, head: candidateSha, changedPaths, diff, truncated, priorFindings, round, maxRounds: cfg.rounds });
      try {
        result = await runReviewPanel({ runner: this.asyncRunner, command: cfg.command, perspectives: cfg.perspectives, promptFor, vars: { cwd, base: baseRef, head: candidateSha, card: card.id }, cwd, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir, fileStem, head: candidateSha, reviewer: cfg.reviewer, changedPaths });
      } catch (err) {
        dropReservation();
        throw err;
      }
    }
    const after = this.clock();
    // Timed from the clock after the run: a review can outlast the hold it reports.
    const holdUntil = result.outcome === 'quota-hold' ? addMs(after, result.retryAfterMs ?? 15 * 60 * 1000) : undefined;
    const perspectives = result.perspectives.map((p) => ({ name: p.perspective, outcome: p.outcome, runStatus: p.runStatus, reasons: p.reasons, durationMs: p.durationMs, verdictRef: p.verdictRef, receiptSha256: p.receiptSha256 }));
    const record: PreReviewRound = { ...reserved, durationMs: result.durationMs, outcome: result.outcome, runStatus: result.runStatus, reasons: result.reasons, verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, holdUntil, perspectives };
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
    const findingsInput: RecordFindingsInput = { stage: 'pre', cycle, round, candidateSha, at: after, outcome: result.outcome, reasons: result.outcome === 'block' && result.verdict ? citedReasonsOf(result.verdict, changedPaths) : [], perspectives: cfg.perspectives, perspectiveByReason, seen };
    const withRecord = (current: CardRun): CardRun => ({ ...current, preReview: { ...current.preReview, rounds: current.preReview.rounds.map((r) => (r.reservationId === fileStem ? record : r)) } });
    const committed = this.commitReviewed(
      goal,
      card,
      persisted,
      {
        candidateDigest,
        evidence: evidenceEntry,
        reserved: (latest) => latest.preReview.rounds.some((r) => r.reservationId === fileStem),
        release: (latest) => ({ ...latest, preReview: { ...latest.preReview, rounds: latest.preReview.rounds.filter((r) => r.reservationId !== fileStem) } }),
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
    this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle, round, reviewer: cfg.reviewer, candidateDigest, outcome: result.outcome, decision: discardedDecision(committed.status), runStatus: result.runStatus, reasons: result.reasons, advisory: result.advisory ?? [], findings: found.raised, reraised: found.reraised, resolved: found.resolved, verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, durationMs: record.durationMs, holdUntil, perspectives: perspectives.map((p) => `${p.name}:${p.outcome}`) } });
    return { run: saved, result, round: record };
  }

  /**
   * Pool admission in queue order. A stale request of this same card (an earlier candidate that never ran,
   * left by a refused admission) is superseded; another requester's request is waited for.
   */
  private admitReview(goal: Goal, card: Card, key: string, now: string): ReturnType<ReviewQueue['admit']> {
    const requester = `${goal.id}:${card.id}`;
    let admit = this.queue.admit(goal.reviewPool, currentActor(), now);
    for (let guard = 0; admit.status === 'admitted' && admit.request.key !== key && admit.request.requesters.every((r) => r === requester) && guard < 10; guard += 1) {
      this.queue.complete(admit.request.key, 'superseded by a newer candidate of the same card', now);
      admit = this.queue.admit(goal.reviewPool, currentActor(), now);
    }
    return admit;
  }

  applyShipResult(goal: Goal, card: Card, run: CardRun, result: ShipResult, operationId: string, reviewKey: string, candidateDigest: string): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    const verdictInfo = this.shipPath.readVerdict(card.id);
    const classified = classifyVerdict(verdictInfo.verdict, { candidateSha: run.candidate?.sha, tier: card.tier, gateRequired: this.config.gateRequired, rawOutput: `${result.receipt.stdout}\n${result.receipt.stderr}` });
    const invocationId = `ship:${operationId}`;
    let review = run.review;
    let reviewDecision: ReturnType<typeof recordReviewOutcome>['decision'] | undefined;
    // The document the command-run formal reviewer already decided for this candidate, re-read by the ship
    // path, is the same artifact and never a second decision; any other ship review outcome is recorded.
    const commandReviewer = this.config.formalReview.command.length ? this.config.formalReview.reviewer : undefined;
    const decidedByCommand = commandReviewer !== undefined && run.review.invocations.some((i) => i.reviewer === commandReviewer && i.candidateDigest === candidateDigest && (i.outcome === 'pass' || i.outcome === 'block'));
    const rawDoc = (() => {
      try {
        return verdictInfo.raw ? (JSON.parse(verdictInfo.raw) as { reviewer?: string; sha?: string }) : undefined;
      } catch {
        return undefined;
      }
    })();
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
      (!rawDoc || (rawDoc.reviewer === commandReviewer && rawDoc.sha === run.candidate?.sha)) &&
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
        rec = recordReviewOutcome(current.review, { invocationId, candidateDigest, candidateSha: run.candidate?.sha, artifactDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: this.config.reviewer, requestedAt: now, mergeBlocking: classified.mergeBlocking }, classified, verdictInfo.verdict, verdictInfo.rounds !== undefined ? Math.max(0, verdictInfo.rounds - current.review.scriptCounter) : 0);
        recorded = rec.ledger.invocations.length > current.review.invocations.length;
        if (!recorded) return current;
        // Findings of a ship-path decision: every cited reason of a block (root or axis, advisory included), ids allocated on
        // the locked record (a dispute saved during the ship is kept).
        const decidedOutcome = classified.outcome === 'block-defect' || classified.outcome === 'block-advisory' ? 'block' : classified.outcome === 'pass' ? 'pass' : 'no-verdict'; // a routed skip decides nothing about the findings
        const input: RecordFindingsInput = { stage: 'formal', round: rec.ledger.substantiveDecisions, candidateSha: run.candidate?.sha, at: now, outcome: decidedOutcome, reasons: decidedOutcome === 'block' && verdictInfo.verdict ? citedReasonsOf(verdictInfo.verdict) : [], advisory: classified.outcome === 'block-advisory', seen: {} };
        found = recordFindings(current.findings, input);
        return { ...current, review: rec.ledger, findings: found.findings };
      });
      run = { ...run, review: locked.review, findings: locked.findings };
      review = locked.review;
      const standing = standingFor(review);
      // The ledger's standing decision for an artifact already recorded decides again; nothing new is recorded.
      reviewDecision = rec ? rec.decision : standing ? (standing.outcome === 'block' && classified.mergeBlocking ? ({ action: review.substantiveBlocks >= 2 ? 'stop-review' : 'review-fix', remainingDecisions: Math.max(0, MAX_SUBSTANTIVE_REVIEW_DECISIONS - review.substantiveDecisions), detail: 'second substantive block' } as LedgerDecision) : { action: 'proceed-merge' }) : undefined;
      if (recorded && rec) this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId, outcome: classified.outcome, mergeBlocking: classified.mergeBlocking, decision: rec.decision.action, runStatus: classified.runStatus, findings: found.raised, reraised: found.reraised, resolved: found.resolved } });
    }
    if (classified.outcome === 'quota-hold') {
      this.queue.hold(reviewKey, new Date(Date.parse(now) + 15 * 60 * 1000).toISOString(), 'reviewer reported rate limit/quota', now);
      this.journal(goal.id).append({ type: 'REVIEW_HOLD', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { key: reviewKey } });
    } else if (result.outcome === 'unclassified' && result.receipt.timedOut) {
      this.queue.markLost(reviewKey, 'ship timed out; look up the review before releasing the slot', now);
    } else {
      this.queue.complete(reviewKey, verdictInfo.file ?? 'no-verdict', now);
    }
    const evidence = [...run.evidence, { id: `ship-${operationId}`, kind: 'artifact' as const, createdAt: now, candidateDigest, note: `ship ${result.outcome}: ${result.sentinels.join(' ')}`.slice(0, 500) }];

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
      this.ops.markResult(operationId, mergeVerified ? 'succeeded' : 'UNKNOWN', { evidenceRef: `ship-${operationId}`, error: mergeVerified ? undefined : 'merge reported but not verified against the intended base' });
      this.journal(goal.id).append({ type: 'OPERATION_RESULT', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId, status: mergeVerified ? 'succeeded' : 'UNKNOWN' } });
      const next = this.save({ ...run, state: mergeVerified ? 'CLOSE' : 'WAIT', review, mergeVerified, pr: pr ? { number: pr, state: 'MERGED' as const, headRefOid: token?.tip ?? run.candidate?.sha } : run.pr, evidence });
      return mergeVerified ? this.close(goal, card, next) : { run: next, directive: { kind: 'wait', cardId: card.id, on: `merge-verify:${operationId}`, pollSeconds: 60, narration: 'Ship exited 0 but the merge is not verified on the intended base; reconcile the PR/merge token before CLOSE.' } };
    }

    this.ops.markResult(operationId, 'failed', { error: `${result.outcome}: ${result.detail}` });
    this.journal(goal.id).append({ type: 'OPERATION_RESULT', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { operationId, status: 'failed', outcome: result.outcome } });

    switch (result.outcome) {
      case 'review-blocked': {
        if (reviewDecision?.action === 'stop-review') {
          const stop = makeStop('review', this.withContest(reviewDecision.detail, run.findings), 'return the PR and retained verdict evidence for human adjudication; no counter reset', { at: now, global: false });
          const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
          return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
        }
        // The two R3 decisions are the formal review's own budget: the episode reopens and the repair is the next attempt.
        const effort = run.effort ? reopenAfterReviewBlock(run.effort, classified.reasons[0] ?? 'review block') : run.effort;
        const next = this.save({ ...run, state: 'REVIEW_FIX', review, effort, dodReceipt: undefined, evidence, blockedReceipt: this.keepReceipt(run, { stage: 'formal', candidateSha: run.candidate?.sha }) });
        return { run: next, directive: { kind: 'review-fix', cardId: card.id, reasons: classified.reasons, remainingDecisions: Math.max(0, 2 - review.substantiveDecisions), narration: 'Substantive block: fix within scope or revert; then rebuild and ship the repaired candidate (run `aidlc card next` to open the repair attempt).' } };
      }
      case 'review-no-verdict': {
        if (reviewDecision?.action === 'retry-review') {
          const next = this.save({ ...run, state: 'SHIP', review, evidence });
          return { run: next, directive: { kind: 'ship', cardId: card.id, base: this.config.base, mode: run.mode, narration: `No verdict (${classified.runStatus}); raw evidence preserved. One retry remains across script and driver: re-run the same ship command.` } };
        }
        const stop = makeStop('review', 'missing/malformed/stale verdict after the single retry', 'preserve raw output; never pass; hand off for adjudication', { at: now, global: false });
        const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
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
          const stop = makeStop('risk', `security gate red: ${finding}`, 'remove the finding from the change or the history, then ship a new candidate; the gate is never rerun or bypassed', { at: now, global: false });
          const stopped = this.save({ ...run, state: 'STOP', review, stop, dodReceipt: undefined, blockedReceipt: undefined, evidence });
          return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
        }
        const rerun = canRerun(run.ci, runId, 1, candidateDigest, cls.class);
        if (rerun.allowed) {
          const ci = recordRerunIntent(run.ci, runId, 1, candidateDigest, now);
          this.journal(goal.id).append({ type: 'CI_RERUN', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { runId, candidateDigest, persistedBeforeRequest: true } });
          const next = this.save({ ...run, state: 'SHIP', review, ci, evidence });
          return { run: next, directive: { kind: 'ship', cardId: card.id, base: this.config.base, mode: run.mode, narration: `Transient CI failure (${cls.evidence[0] ?? 'evidence'}): one same-origin rerun permitted and persisted; rerun the ship/CI for the same candidate and reconcile (aidlc card ci-reconcile ${card.id} --run ${runId}).` } };
        }
        if (cls.class === 'code-defect') {
          const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, blockedReceipt: undefined, evidence });
          return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: run.redReceipt, dodCommand: card.dod_command, effort: run.effort?.baseline ?? 'medium', attempt: (run.effort?.attempts.length ?? 0) + 1, skills: this.buildSkills(goal, card), narration: `CI code defect (${cls.evidence[0] ?? ''}): repair in BUILD and ship a new candidate.` } };
        }
        const stop = makeStop('ci', rerun.reason, 'diagnose the failure before any further rerun', { at: now, global: false });
        const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
      }
      case 'dod-failed':
      case 'verify-failed':
      case 'scope-blocked':
      case 'budget-over': {
        const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, blockedReceipt: undefined, evidence });
        return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: run.redReceipt, dodCommand: card.dod_command, effort: run.effort?.baseline ?? 'medium', attempt: (run.effort?.attempts.length ?? 0) + 1, skills: this.buildSkills(goal, card), narration: `${result.outcome}: ${result.detail}. Repair within scope (never weaken a test or widen allow_paths to pass a gate) and re-run the DoD.` } };
      }
      case 'red-missing': {
        // The ship path rejected the RED receipt: not a code fault, so a succeeded episode is reopened rather than counted,
        // provided the episode can still admit an attempt; the rejected receipt is never reused as proof.
        const admission = checkAdmission(run.deadline, now);
        if (admission.phase !== 'open') {
          const stop = makeStop('time', `RED receipt rejected (${result.detail}) after the card deadline (${admission.phase}); no repair attempt may start`, 'hand off with the branch and the retained ship output; extend only explicitly', { at: now, global: false });
          const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
          return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
        }
        const reopened = reopenEpisode(run.effort);
        const inadmissible = reopened ? nextEffortAction(reopened, { harderProblem: true, limitsPermit: true }) : undefined;
        if (inadmissible && inadmissible.action !== 'attempt') {
          const stop = makeStop('card', `RED receipt rejected (${result.detail}) but the effort episode cannot admit a repair attempt: ${inadmissible.action === 'stop' ? `${inadmissible.reason}: ${inadmissible.detail}` : 'episode already terminal'}`, 'amend the goal with a replacement card to open a linked episode, or resume with a fresh generation', { at: now, global: false });
          const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
          return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
        }
        const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, blockedReceipt: undefined, redReceipt: undefined, evidence, effort: reopened, pendingRepair: { kind: 'red-missing', detail: result.detail, at: now, rejectedReceipt: run.redReceipt } });
        const repairEffort = inadmissible?.action === 'attempt' ? inadmissible.effort : (run.effort?.baseline ?? 'medium');
        return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: undefined, dodCommand: card.dod_command, effort: repairEffort, attempt: (run.effort?.attempts.length ?? 0) + 1, skills: this.buildSkills(goal, card), narration: `${result.outcome}: ${result.detail}. Establish the RED receipt again within scope and re-run the DoD.` } };
      }
      case 'auth-failed': {
        const stop = makeStop('auth', 'GitHub account/permission guard failed', 'run `gh auth login` for the configured personal account; never downgrade to local mode silently', { at: now });
        const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
      }
      case 'no-reviewer': {
        const stop = makeStop('capability', 'a blocking review is required but no reviewer backend is configured', 'configure ReviewCommand/codex or choose a blocking path', { at: now, global: false });
        const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
      }
      case 'secrets-blocked':
      case 'license-blocked': {
        const stop = makeStop('risk', `${result.outcome}: ${result.detail}`, 'remove the offending content/dependency; these gates are never bypassed', { at: now, global: false });
        const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
      }
      case 'merge-failed':
      default: {
        // Only a real conflict returns to BUILD, and only on an affirmative diagnostic in the ship output: git's CONFLICT
        // markers or GitHub's clean-merge failure. A policy or status-check refusal, or the word inside a card id or a
        // resume command, never counts.
        if (result.outcome === 'merge-failed' && hasConflictDiagnostic(result.receipt)) {
          const admission = checkAdmission(run.deadline, now);
          if (admission.phase !== 'open') {
            const stop = makeStop('time', `merge conflict on the base sync after the card deadline (${admission.phase}); no repair attempt may start`, 'hand off with the branch and the retained ship output; extend only explicitly', { at: now, global: false });
            const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
            return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
          }
          const reopened = reopenEpisode(run.effort);
          const inadmissible = reopened ? nextEffortAction(reopened, { harderProblem: true, limitsPermit: true }) : undefined;
          if (inadmissible && inadmissible.action !== 'attempt') {
            const stop = makeStop('card', `merge conflict on the base sync but the effort episode cannot admit a repair attempt: ${inadmissible.action === 'stop' ? `${inadmissible.reason}: ${inadmissible.detail}` : 'episode already terminal'}`, 'amend the goal with a replacement card to open a linked episode, or resume with a fresh generation', { at: now, global: false });
            const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
            return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
          }
          const detail = `merge conflict on the base sync (${result.detail})`;
          const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, blockedReceipt: undefined, evidence, effort: reopened, pendingRepair: { kind: 'merge-conflict', detail, at: now } });
          const repairEffort = inadmissible?.action === 'attempt' ? inadmissible.effort : (run.effort?.baseline ?? 'medium');
          return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: run.redReceipt, dodCommand: card.dod_command, effort: repairEffort, attempt: (run.effort?.attempts.length ?? 0) + 1, skills: ['merge-conflicts', ...this.buildSkills(goal, card)], narration: `Merge conflict on the base sync (${result.detail}): resolve every hunk by intent with the merge-conflicts skill (merge only, never rebase), rerun the DoD and record the attempt. The merge commit is a new candidate: it costs an R2 round and, once R3 has decided, the second R3 decision.` } };
        }
        const stop = makeStop('tool', `unclassified ship outcome (exit ${result.receipt.exitCode}): ${result.detail}`, result.resumeCommand ? `inspect diagnostics, then resume with: ${result.resumeCommand}` : 'inspect the ship output and the retained receipt', { at: now, global: false });
        const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
      }
    }
  }

  /** Reconcile a persisted CI rerun by looking up its actual attempt (Q7). */
  ciReconcile(goal: Goal, card: Card, run: CardRun, runId: string, lookup?: () => { status: string; conclusion: string | null; attempt: number }): CardRun {
    const now = this.clock();
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

  private close(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive: CardDirective } {
    const missing = Object.entries(run.closure).filter(([, v]) => !v).map(([k]) => k);
    const next = this.save({ ...run, state: missing.length ? 'CLOSE' : 'DONE' });
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
    return { run: next, directive: { kind: 'close', cardId: card.id, missing, narration: `Merge verified. Complete only the missing closure steps (${missing.join(', ')}) through the existing approved metadata procedure, then mark them with \`aidlc card close ${card.id} --${missing[0]}\`.` } };
  }

  markClosure(goal: Goal, card: Card, run: CardRun, flags: Partial<CardRun['closure']>): CardRun {
    const closure = { ...run.closure, ...flags };
    this.journal(goal.id).append({ type: 'EVIDENCE_RETAINED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { closure } });
    return this.save({ ...run, closure });
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

