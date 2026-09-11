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
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { selectCardState, type CardEvidence } from '../core/card-machine.ts';
import { checkAdmission } from '../core/deadlines.ts';
import { createEpisode, finishAttempt, nextEffortAction, startAttempt } from '../core/effort.ts';
import { classifyVerdict, recordReviewOutcome, reviewRequestKey, type ClassifiedVerdict } from '../core/review-policy.ts';
import { classifyCiFailure, canRerun, recordRerunIntent, reconcileRerun, hasUnreconciledRerun } from '../core/ci-policy.ts';
import { makeStop } from '../core/stop.ts';
import { CardRun, MAX_NO_VERDICT_RETRIES, MAX_SUBSTANTIVE_REVIEW_DECISIONS, addMs, type Card, type EffortLevel, type Goal, type PreReviewRound, type StopRecord, type Verdict } from '../core/types.ts';
import { LeaseStore, FencedError, resourceKeys } from '../coordination/lease.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import { ReviewQueue } from '../coordination/review-queue.ts';
import { GitProbe } from '../probes/git.ts';
import { GhProbe } from '../probes/gh.ts';
import { run, runSync, type Runner, type SyncRunner } from '../probes/exec.ts';
import { decideWorktree } from '../delivery/worktree.ts';
import { classifyShipOutput, DryRunShipPath, ScaffoldShipPath, type ShipPath, type ShipResult } from '../delivery/ship.ts';
import { GitHubShipPath } from '../delivery/github-ship.ts';
import { buildReviewPrompt, collectCandidateDiff, materialiseVerdictSchema, pathAllowed, runReviewPanel, type PanelResult } from '../review/pre-review.ts';
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
  | { kind: 'prepare'; cardId: string; action: 'start' | 'attach'; worktree: string; narration: string }
  | { kind: 'build'; cardId: string; worktree: string; tdd: boolean; redReceipt?: string; dodCommand: string; effort: EffortLevel; attempt: number; narration: string }
  | { kind: 'ship'; cardId: string; base: string; mode: 'local' | 'remote'; narration: string }
  | { kind: 'review-fix'; cardId: string; reasons: string[]; remainingDecisions: number; narration: string }
  | { kind: 'pre-review'; cardId: string; round: number; maxRounds: number; reviewer: string; narration: string }
  | { kind: 'review'; cardId: string; reviewer: string; decision: number; maxDecisions: number; narration: string }
  | { kind: 'wait'; cardId: string; on: string; pollSeconds: number; narration: string }
  | { kind: 'close'; cardId: string; missing: string[]; narration: string }
  | { kind: 'done'; cardId: string; narration: string }
  | { kind: 'stop'; cardId: string; stop: StopRecord; narration: string };

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
    this.shipPath =
      deps.shipPath ??
      (deps.config.shipPath === 'scaffold'
        ? new ScaffoldShipPath({ mainRoot: deps.repo.mainRoot, worktreeRoot: resolveWorktreeRoot(deps.config), runner: this.runner })
        : deps.config.shipPath === 'github'
          ? new GitHubShipPath({ mainRoot: deps.repo.mainRoot, worktreeRoot: resolveWorktreeRoot(deps.config), repository: deps.config.repository ?? '', runner: this.runner })
          : new DryRunShipPath());
  }

  private journal(goalId: string): Journal {
    return Journal.forGoal(this.paths.journal, goalId);
  }

  worktreePath(cardId: string): string {
    return path.join(resolveWorktreeRoot(this.config), cardId);
  }

  private save(run: CardRun): CardRun {
    return this.store.saveCardRun(CardRun.parse({ ...run, updatedAt: this.clock() }));
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
      // candidate (new sha/digest after the fix) moves the card back through BUILD/SHIP.
      reviewBlockPending: (() => {
        const reviewedDigest = [...run.review.invocations].reverse().find((i) => i.outcome === 'block')?.candidateDigest;
        const blocked = run.review.lastVerdict?.verdict === 'block' && classifyVerdict(run.review.lastVerdict, { tier: card.tier, gateRequired: this.config.gateRequired }).mergeBlocking;
        return Boolean(blocked && !reviewExhausted && reviewedDigest !== undefined && run.candidate?.digest === reviewedDigest);
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
            narration: `Review block to repair: ${reasons.join(' | ') || 'see verdict'}. Fix the introduced defects within scope or revert the defective change; do not defer a required fix as a nit.${attemptNote} Rerun the DoD and record \`aidlc card attempt ${card.id} --outcome success --candidate-sha <new sha> --dod-receipt ...\`; the repaired candidate ships with ${Math.max(0, 2 - run.review.substantiveDecisions)} substantive decision(s) left.`,
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
        narration: decision.action === 'start' ? `Start a new worktree for ${card.id} at ${decision.path} (scaffold: pwsh scripts/task.ps1 -TaskId ${card.id} -Phase start from the main checkout). ${decision.reason}` : `Attach to existing worktree ${decision.path}: ${decision.reason}. Do not re-run start.`,
      },
    };
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
      if (red) redReceipt = `${red.sha}:${red.dodExit}`;
    }
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
        narration: card.tdd && !redReceipt
          ? `Attempt ${attemptNo} at effort ${effort}: establish behavioural RED first (scaffold: task.ps1 -Phase red writes .review/${card.id}.red), then implement within allow_paths and run the DoD. Record the result with \`aidlc card attempt ${card.id} --outcome success|fail --cause ...\`.`
          : `Attempt ${attemptNo} at effort ${effort}: implement/repair within allow_paths, run \`${card.dod_command}\` and the affected checks, then record the attempt outcome (\`aidlc card attempt\`) with the DoD receipt.`,
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
    return this.save({ ...run, effort: episode, dodReceipt: input.outcome === 'success' ? (input.dodReceipt ?? `dod:${now}`) : run.dodReceipt, redReceipt: input.redReceipt ?? run.redReceipt, candidate });
  }

  private ship(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    if (hasUnreconciledRerun(run.ci)) {
      const next = this.save({ ...run, state: 'WAIT' });
      return { run: next, directive: { kind: 'wait', cardId: card.id, on: 'ci-rerun', pollSeconds: 90, narration: 'A CI rerun is persisted but not reconciled; look it up (aidlc card ci-reconcile) before shipping again.' } };
    }
    // R2: a fresh pre-review pass for this candidate is required before any ship is issued.
    const gate = this.preReviewGate(goal, card, run);
    if (gate) return gate;
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
    const admit = this.queue.admit(goal.reviewPool, currentActor(), now);
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
  private preReviewGate(goal: Goal, card: Card, run: CardRun): { run: CardRun; directive: CardDirective } | undefined {
    const cfg = this.config.preReview;
    if (!cfg.command.length) return undefined;
    const now = this.clock();
    const cycle = run.review.substantiveBlocks; // an R3 block restarts the pre-review cycle; an R3 pass does not
    const rounds = run.preReview.rounds.filter((r) => r.cycle === cycle);
    const decided = rounds.filter((r) => r.outcome === 'pass' || r.outcome === 'block');
    const blocks = decided.filter((r) => r.outcome === 'block');
    const digest = run.candidate?.digest;
    const last = [...rounds].reverse().find((r) => r.candidateDigest === digest);
    if (last?.outcome === 'pass') return undefined;
    if (last?.outcome === 'block') {
      // Reaching SHIP with a blocked, unrepaired candidate: hand it back with the reasons.
      const next = this.save({ ...run, state: 'BUILD', dodReceipt: undefined });
      return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: run.redReceipt, dodCommand: card.dod_command, effort: run.effort?.baseline ?? 'medium', attempt: (run.effort?.attempts.length ?? 0) + 1, narration: `Pre-review block still pending on candidate ${digest ?? 'unknown'}: ${last.reasons.join(' | ') || 'see the retained verdict'}. Fix within scope, rerun the DoD, record the attempt with the new candidate sha, then \`aidlc review pre ${card.id}\`.` } };
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
    if (blocks.length >= cfg.rounds) {
      const residual = blocks[blocks.length - 1]?.reasons ?? [];
      if (cfg.onExhausted === 'ship') {
        this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle, exhausted: true, action: 'ship', residual } });
        return undefined;
      }
      const stop = makeStop('review', `pre-review rounds exhausted (${blocks.length}/${cfg.rounds} blocks in R3 cycle ${cycle}); last block: ${residual.join(' | ') || 'see the retained verdicts'}`, `read the retained verdicts under .review/${card.id}.pre.*; fix within scope and re-run, or set preReview.onExhausted to "ship" to hand the residual findings to R3`, { at: now, global: false });
      const stopped = this.save({ ...run, state: 'STOP', stop });
      return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
    }
    const round = decided.length + 1;
    const retry = last?.outcome === 'no-verdict' ? ' (retry: the previous run produced no verdict)' : last?.outcome === 'quota-hold' ? ' (the previous run reported a quota hold; retry once it clears)' : '';
    const next = this.save({ ...run, state: 'SHIP' });
    return { run: next, directive: { kind: 'pre-review', cardId: card.id, round, maxRounds: cfg.rounds, reviewer: cfg.reviewer, narration: `Pre-review round ${round}/${cfg.rounds} (R2, ${cfg.reviewer}) before the ship${retry}: run \`aidlc review pre ${card.id}\`. A pass hands the candidate to the ship and R3; a block returns to BUILD with the reasons.` } };
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
    if (last?.outcome === 'block') {
      // Only a merge-blocking block is pending; advisory findings are retained and never become a silent merge bar.
      const blocking = run.review.lastVerdict ? classifyVerdict(run.review.lastVerdict, { candidateSha: run.candidate?.sha, tier: card.tier, gateRequired: this.config.gateRequired }).mergeBlocking : true;
      if (!blocking) return undefined;
      const next = this.save({ ...run, state: 'REVIEW_FIX', dodReceipt: undefined });
      return { run: next, directive: { kind: 'review-fix', cardId: card.id, reasons: run.review.lastVerdict?.reasons ?? [], remainingDecisions: Math.max(0, MAX_SUBSTANTIVE_REVIEW_DECISIONS - run.review.substantiveDecisions), narration: `Formal review block still pending on candidate ${digest ?? 'unknown'}: fix within scope or revert, rebuild, and record the attempt with the new candidate sha.` } };
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
    return { run: next, directive: { kind: 'review', cardId: card.id, reviewer: cfg.reviewer, decision, maxDecisions: MAX_SUBSTANTIVE_REVIEW_DECISIONS, narration: `Formal review (R3, ${cfg.reviewer}) before the ship, decision ${decision}/${MAX_SUBSTANTIVE_REVIEW_DECISIONS}${retry}: run \`aidlc review r3 ${card.id}\`. A pass hands the candidate to the ship; a merge-blocking block returns it to REVIEW_FIX and the repaired candidate restarts the pre-review cycle.` } };
  }

  /**
   * R3 as a command: run the formal reviewer on the committed candidate, write the candidate-bound
   * verdict file the ship paths read (`.review/<card>.json`) and record the decision through the
   * existing R3 ledger (`recordReviewOutcome`), so the two-decision allowance and the single
   * no-verdict retry apply exactly as for a ship-path reviewer.
   */
  async formalReview(goal: Goal, card: Card, run: CardRun): Promise<{ run: CardRun; classified: ClassifiedVerdict; verdict?: Verdict; verdictRef?: string; logRef?: string; durationMs: number; receiptSha256: string }> {
    const cfg = this.config.formalReview;
    if (!cfg.command.length) throw new Error('formalReview.command is not configured (aidlc.config.json)');
    if (run.stop || run.state === 'STOP') throw new Error(`card run is stopped (${run.stop?.reason ?? 'STOP'}); no review may run: ${run.stop?.nextAction ?? 'resolve the stop first'}`);
    const now = this.clock();
    const cwd = run.worktree && existsSync(run.worktree) ? run.worktree : this.repo.mainRoot;
    const baseRef = run.base?.oid ?? this.config.base;
    const candidateSha = run.candidate?.sha ?? this.git.head(cwd);
    const candidateDigest = run.candidate?.digest ?? candidateSha;
    const cycle = run.review.substantiveBlocks; // an R3 block restarts the pre-review cycle; an R3 pass does not
    if (this.config.preReview.command.length && !run.preReview.rounds.some((r) => r.cycle === cycle && r.candidateDigest === candidateDigest && r.outcome === 'pass')) {
      throw new Error(`pre-review pass required first: run \`aidlc review pre ${card.id}\` on candidate ${candidateSha.slice(0, 12)} before the formal review`);
    }
    const lastForCandidate = [...run.review.invocations].reverse().find((i) => i.reviewer === cfg.reviewer && i.candidateDigest === candidateDigest);
    if (lastForCandidate?.outcome === 'quota-hold' && lastForCandidate.holdUntil && Date.parse(lastForCandidate.holdUntil) > Date.parse(now)) {
      throw new Error(`formal reviewer ${cfg.reviewer} is on a quota hold until ${lastForCandidate.holdUntil}; do not re-run before it clears`);
    }
    if (run.review.substantiveDecisions >= MAX_SUBSTANTIVE_REVIEW_DECISIONS) {
      throw new Error(`the two-decision review allowance is used (${run.review.substantiveDecisions}); ${lastForCandidate?.outcome === 'pass' ? 'the current candidate already holds its pass, ship it' : 'a further required review is STOP/review'}, not another run`);
    }
    if (run.review.noVerdictRetriesUsed > MAX_NO_VERDICT_RETRIES) {
      throw new Error(`no verdict after the single retry (${run.review.noVerdictRetriesUsed} used); the card is STOP/review, not another run`);
    }
    const reviewDir = path.join(cwd, '.review');
    const schema = materialiseVerdictSchema(reviewDir);
    const policyFile = path.join(this.repo.mainRoot, 'REVIEW.md');
    const reviewPolicy = existsSync(policyFile)
      ? readFileSync(policyFile, 'utf8')
      : 'Must-block: out of scope, hard boundaries, frozen contracts, license, non-original code, missing or fake tests. Two axes, spec and standards. Output the JSON verdict as the last line.';
    const priorFindings = (run.review.lastVerdict?.reasons ?? []).map((f) => `previous R3 decision: ${f}`);
    const { changedPaths, diff, truncated } = collectCandidateDiff(this.runner, cwd, baseRef, cfg.maxDiffBytes);
    if (!diff.trim()) throw new Error(`no committed candidate diff against ${baseRef} in ${cwd}; commit the candidate first`);
    // Deterministic scope gate (dimension 1): no model call, no decision consumed.
    const outOfScope = changedPaths.filter((p) => !pathAllowed(p, card.allow_paths));
    if (outOfScope.length) throw new Error(`out of scope: ${outOfScope.join(', ')} outside allow_paths; revert the change or amend the card before the formal review (no decision consumed)`);
    const promptInArgv = cfg.command.some((a) => a.includes('{instructions}'));
    const promptFor = (perspective?: string) => buildReviewPrompt({ stage: 'formal', includeDiff: !promptInArgv, perspective, reviewPolicy, card, base: baseRef, head: candidateSha, changedPaths, diff, truncated, priorFindings, round: run.review.substantiveDecisions + 1, maxRounds: MAX_SUBSTANTIVE_REVIEW_DECISIONS });
    const n = run.review.invocations.filter((i) => i.reviewer === cfg.reviewer).length + 1;
    const fileStem = `${card.id}.r3.${n}`;
    const panel = await runReviewPanel({ runner: this.asyncRunner, command: cfg.command, perspectives: cfg.perspectives, promptFor, vars: { schema, cwd, base: baseRef, head: candidateSha, card: card.id }, cwd, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir, fileStem, head: candidateSha, reviewer: cfg.reviewer });
    // Keep the reviewer's own binding: an explicit sha or branch that is not this candidate is a stale verdict, never a pass.
    const verdict: Verdict | undefined = panel.verdict ? { ...panel.verdict, sha: panel.verdict.sha ?? candidateSha, branch: panel.verdict.branch ?? card.id, run_status: panel.runStatus } : undefined;
    let classified: ClassifiedVerdict;
    if (panel.outcome === 'quota-hold') classified = { outcome: 'quota-hold', mergeBlocking: false, runStatus: 'tool_error', reasons: panel.reasons, stale: false };
    else if (!verdict) classified = { outcome: 'no-verdict', mergeBlocking: false, runStatus: panel.runStatus, reasons: panel.reasons.length ? panel.reasons : ['missing or malformed verdict; never pass'], stale: false };
    else classified = classifyVerdict(verdict, { candidateSha, tier: card.tier, gateRequired: this.config.gateRequired });
    if (verdict && verdict.branch !== card.id) classified = { outcome: 'no-verdict', mergeBlocking: false, runStatus: 'malformed', reasons: [`stale verdict branch ${verdict.branch}`], stale: true };
    if (verdict && !classified.stale) writeFileSync(path.join(reviewDir, `${card.id}.json`), JSON.stringify({ ...verdict, reviewer: cfg.reviewer }, null, 2) + '\n', 'utf8');
    // Timed from the clock after the run: a review can outlast the hold it reports.
    const holdUntil = classified.outcome === 'quota-hold' ? addMs(this.clock(), panel.retryAfterMs ?? 15 * 60 * 1000) : undefined;
    const perspectives = panel.perspectives.map((p) => ({ name: p.perspective, outcome: p.outcome, runStatus: p.runStatus, reasons: p.reasons, durationMs: p.durationMs, verdictRef: p.verdictRef, receiptSha256: p.receiptSha256 }));
    const invocationId = `r3:${fileStem}`;
    const rec = recordReviewOutcome(run.review, { invocationId, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer, requestedAt: now, verdictRef: panel.verdictRef, holdUntil, perspectives }, classified, verdict);
    this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId, reviewer: cfg.reviewer, candidateDigest, outcome: classified.outcome, mergeBlocking: classified.mergeBlocking, decision: rec.decision.action, runStatus: classified.runStatus, reasons: classified.reasons, verdictRef: panel.verdictRef, receiptSha256: panel.receiptSha256, durationMs: panel.durationMs, holdUntil, perspectives: perspectives.map((p) => `${p.name}:${p.outcome}`) } });
    const evidence = [...run.evidence, { id: `r3-${fileStem}`, kind: 'artifact' as const, createdAt: now, candidateDigest, note: `formal review ${cfg.reviewer} ${classified.outcome}: ${classified.reasons.join(' | ')}`.slice(0, 500) }];
    let next: CardRun = { ...run, review: rec.ledger, evidence };
    switch (rec.decision.action) {
      case 'review-fix': {
        // MA2: the reviewed attempt missed acceptance; the repair is the next counted attempt.
        const effort = run.effort ? markReviewFailure(run.effort, classified.reasons[0] ?? 'review block') : run.effort;
        next = { ...next, state: 'REVIEW_FIX', effort, dodReceipt: undefined, blocker: undefined };
        break;
      }
      case 'stop-review': {
        const stop = makeStop('review', rec.decision.detail, 'return the retained verdict evidence for human adjudication; no counter reset', { at: now, global: false });
        next = { ...next, state: 'STOP', stop };
        break;
      }
      case 'wait-quota':
        next = { ...next, state: 'WAIT' };
        break;
      default:
        next = { ...next, state: 'SHIP' };
    }
    next = this.save(next);
    return { run: next, classified, verdict, verdictRef: panel.verdictRef, logRef: panel.logRef, durationMs: panel.durationMs, receiptSha256: panel.receiptSha256 };
  }

  /** R2: run the configured pre-reviewer on the committed candidate and record the round. */
  async preReview(goal: Goal, card: Card, run: CardRun): Promise<{ run: CardRun; result: PanelResult; round: PreReviewRound }> {
    const cfg = this.config.preReview;
    if (!cfg.command.length) throw new Error('preReview.command is not configured (aidlc.config.json)');
    if (run.stop || run.state === 'STOP') throw new Error(`card run is stopped (${run.stop?.reason ?? 'STOP'}); no review may run: ${run.stop?.nextAction ?? 'resolve the stop first'}`);
    const now = this.clock();
    const cwd = run.worktree && existsSync(run.worktree) ? run.worktree : this.repo.mainRoot;
    const baseRef = run.base?.oid ?? this.config.base;
    const candidateSha = run.candidate?.sha ?? this.git.head(cwd);
    const candidateDigest = run.candidate?.digest ?? candidateSha;
    const cycle = run.review.substantiveBlocks; // an R3 block restarts the pre-review cycle; an R3 pass does not
    const rounds = run.preReview.rounds.filter((r) => r.cycle === cycle);
    const lastRound = [...rounds].reverse().find((r) => r.candidateDigest === candidateDigest);
    if (lastRound?.outcome === 'quota-hold' && lastRound.holdUntil && Date.parse(lastRound.holdUntil) > Date.parse(now)) {
      throw new Error(`pre-reviewer ${cfg.reviewer} is on a quota hold until ${lastRound.holdUntil}; do not re-run before it clears`);
    }
    const round = rounds.filter((r) => r.outcome === 'pass' || r.outcome === 'block').length + 1;
    const policyFile = path.join(this.repo.mainRoot, 'REVIEW.md');
    const reviewPolicy = existsSync(policyFile)
      ? readFileSync(policyFile, 'utf8')
      : 'Must-block: out of scope, hard boundaries, frozen contracts, license, non-original code, missing or fake tests. Two axes, spec and standards. Output the JSON verdict as the last line.';
    const lastBlock = [...rounds].reverse().find((r) => r.outcome === 'block');
    const priorFindings = [...(lastBlock?.reasons ?? []).map((f) => `pre-review round ${lastBlock?.round}: ${f}`), ...(cycle > 0 ? (run.review.lastVerdict?.reasons ?? []).map((f) => `R3 block: ${f}`) : [])];
    const { changedPaths, diff, truncated } = collectCandidateDiff(this.runner, cwd, baseRef, cfg.maxDiffBytes);
    if (!diff.trim()) throw new Error(`no committed candidate diff against ${baseRef} in ${cwd}; commit the candidate first`);
    const fileStem = `${card.id}.pre.${cycle}.${round}`;
    const reviewDir = path.join(cwd, '.review');
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
      result = await runReviewPanel({ runner: this.asyncRunner, command: cfg.command, perspectives: cfg.perspectives, promptFor, vars: { cwd, base: baseRef, head: candidateSha, card: card.id }, cwd, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir, fileStem, head: candidateSha, reviewer: cfg.reviewer });
    }
    // Timed from the clock after the run: a review can outlast the hold it reports.
    const holdUntil = result.outcome === 'quota-hold' ? addMs(this.clock(), result.retryAfterMs ?? 15 * 60 * 1000) : undefined;
    const perspectives = result.perspectives.map((p) => ({ name: p.perspective, outcome: p.outcome, runStatus: p.runStatus, reasons: p.reasons, durationMs: p.durationMs, verdictRef: p.verdictRef, receiptSha256: p.receiptSha256 }));
    const record: PreReviewRound = { round, cycle, reviewer: cfg.reviewer, candidateDigest, candidateSha, requestedAt: now, durationMs: result.durationMs, outcome: result.outcome, runStatus: result.runStatus, reasons: result.reasons, verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, holdUntil, perspectives };
    this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle, round, reviewer: cfg.reviewer, candidateDigest, outcome: result.outcome, runStatus: result.runStatus, reasons: result.reasons, verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, durationMs: record.durationMs, holdUntil, perspectives: perspectives.map((p) => `${p.name}:${p.outcome}`) } });
    const ledger = { rounds: [...run.preReview.rounds, record] };
    const evidence = [...run.evidence, { id: `pre-review-${cycle}-${round}`, kind: 'artifact' as const, createdAt: now, candidateDigest, note: `pre-review ${cfg.reviewer} ${result.outcome}: ${result.reasons.join(' | ')}`.slice(0, 500) }];
    let next: CardRun = { ...run, preReview: ledger, evidence };
    if (result.outcome === 'block') {
      // MA2: the blocked candidate missed acceptance; the repair is the next counted attempt.
      const effort = run.effort ? markReviewFailure(run.effort, `pre-review: ${result.reasons[0] ?? 'block'}`) : run.effort;
      next = { ...next, state: 'BUILD', effort, dodReceipt: undefined, blocker: undefined };
    }
    next = this.save(next);
    return { run: next, result, round: record };
  }

  applyShipResult(goal: Goal, card: Card, run: CardRun, result: ShipResult, operationId: string, reviewKey: string, candidateDigest: string): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    const verdictInfo = this.shipPath.readVerdict(card.id);
    const classified = classifyVerdict(verdictInfo.verdict, { candidateSha: run.candidate?.sha, tier: card.tier, gateRequired: this.config.gateRequired, rawOutput: `${result.receipt.stdout}\n${result.receipt.stderr}` });
    const invocationId = `ship:${operationId}`;
    let review = run.review;
    let reviewDecision: ReturnType<typeof recordReviewOutcome>['decision'] | undefined;
    // A verdict the command-run formal reviewer already decided for this candidate (pass or advisory block)
    // is re-read by the ship path, never decided a second time.
    const commandReviewer = this.config.formalReview.command.length ? this.config.formalReview.reviewer : undefined;
    const alreadyDecided = commandReviewer !== undefined && run.review.invocations.some((i) => i.reviewer === commandReviewer && i.candidateDigest === candidateDigest && (i.outcome === 'pass' || i.outcome === 'block'));
    // Record a substantive decision only when a verdict exists or the ship outcome is review-related; a
    // merge without a readable verdict is noted as evidence, never counted as a decision or a retry.
    if (!alreadyDecided && (verdictInfo.verdict || ['review-blocked', 'review-no-verdict'].includes(result.outcome))) {
      const rec = recordReviewOutcome(review, { invocationId, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: this.config.reviewer, requestedAt: now }, classified, verdictInfo.verdict, verdictInfo.rounds !== undefined ? Math.max(0, verdictInfo.rounds - review.scriptCounter) : 0);
      review = rec.ledger;
      reviewDecision = rec.decision;
      this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId, outcome: classified.outcome, mergeBlocking: classified.mergeBlocking, decision: rec.decision.action, runStatus: classified.runStatus } });
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
          const stop = makeStop('review', reviewDecision.detail, 'return the PR and retained verdict evidence for human adjudication; no counter reset', { at: now, global: false });
          const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
          return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
        }
        // MA2: the shipped attempt missed acceptance; record it as a counted failure so the repair is the next attempt.
        const effort = run.effort ? markReviewFailure(run.effort, classified.reasons[0] ?? 'review block') : run.effort;
        const next = this.save({ ...run, state: 'REVIEW_FIX', review, effort, dodReceipt: undefined, evidence });
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
        const cls = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: result.outcome === 'ci-timeout' ? 'timed_out' : 'failure', logExcerpt: text }]);
        this.journal(goal.id).append({ type: 'CI_CLASSIFIED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { class: cls.class, evidence: cls.evidence.slice(0, 5) } });
        const runId = text.match(/runs\/(\d+)/)?.[1] ?? `ship-${operationId}`;
        const rerun = canRerun(run.ci, runId, 1, candidateDigest, cls.class);
        if (rerun.allowed) {
          const ci = recordRerunIntent(run.ci, runId, 1, candidateDigest, now);
          this.journal(goal.id).append({ type: 'CI_RERUN', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { runId, candidateDigest, persistedBeforeRequest: true } });
          const next = this.save({ ...run, state: 'SHIP', review, ci, evidence });
          return { run: next, directive: { kind: 'ship', cardId: card.id, base: this.config.base, mode: run.mode, narration: `Transient CI failure (${cls.evidence[0] ?? 'evidence'}): one same-origin rerun permitted and persisted; rerun the ship/CI for the same candidate and reconcile (aidlc card ci-reconcile ${card.id} --run ${runId}).` } };
        }
        if (cls.class === 'code-defect') {
          const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, evidence });
          return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: run.redReceipt, dodCommand: card.dod_command, effort: run.effort?.baseline ?? 'medium', attempt: (run.effort?.attempts.length ?? 0) + 1, narration: `CI code defect (${cls.evidence[0] ?? ''}): repair in BUILD and ship a new candidate.` } };
        }
        const stop = makeStop('ci', rerun.reason, 'diagnose the failure before any further rerun', { at: now, global: false });
        const stopped = this.save({ ...run, state: 'STOP', review, stop, evidence });
        return { run: stopped, directive: { kind: 'stop', cardId: card.id, stop, narration: stop.detail } };
      }
      case 'dod-failed':
      case 'verify-failed':
      case 'scope-blocked':
      case 'budget-over':
      case 'red-missing': {
        const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, evidence });
        return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: run.redReceipt, dodCommand: card.dod_command, effort: run.effort?.baseline ?? 'medium', attempt: (run.effort?.attempts.length ?? 0) + 1, narration: `${result.outcome}: ${result.detail}. Repair within scope (never weaken a test or widen allow_paths to pass a gate) and re-run the DoD.` } };
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
      default: {
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
export function markReviewFailure(episode: NonNullable<CardRun['effort']>, reason: string): NonNullable<CardRun['effort']> {
  const idx = episode.attempts.length - 1;
  const last = episode.attempts[idx];
  if (!last || last.outcome !== 'success') return { ...episode, terminal: undefined };
  const attempts = episode.attempts.map((a, i) => (i === idx ? { ...a, outcome: 'fail' as const, cause: `review block: ${reason}`, evidence: 'reviewer verdict block', progress: true } : a));
  return { ...episode, attempts, terminal: undefined };
}
