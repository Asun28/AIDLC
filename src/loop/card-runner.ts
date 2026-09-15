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
import { selectCardState, type CardDecision, type CardEvidence } from '../core/card-machine.ts';
import { checkAdmission } from '../core/deadlines.ts';
import { createEpisode, finishAttempt, nextEffortAction, reopenAfterReviewBlock, startAttempt } from '../core/effort.ts';
import { classifyVerdict, recordReviewOutcome, reviewRequestKey, type ClassifiedVerdict } from '../core/review-policy.ts';
import { classifyCiFailure, canRerun, recordRerunIntent, reconcileRerun, hasUnreconciledRerun } from '../core/ci-policy.ts';
import { makeStop } from '../core/stop.ts';
import { CardRun, MAX_NO_VERDICT_RETRIES, MAX_SUBSTANTIVE_REVIEW_DECISIONS, addMs, type ActorIdentity, type Card, type EffortLevel, type Goal, type Lease, type PreReviewRound, type StopRecord, type Verdict } from '../core/types.ts';
import { LeaseStore, FencedError, resourceKeys } from '../coordination/lease.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import { ReviewQueue } from '../coordination/review-queue.ts';
import { GitProbe } from '../probes/git.ts';
import { GhProbe } from '../probes/gh.ts';
import { run, runSync, type Runner, type SyncRunner } from '../probes/exec.ts';
import { decideWorktree } from '../delivery/worktree.ts';
import { appendLesson, formatLesson, hasLesson, lessonFromText, lessonsPath, parseLessonLine, readLessons, type LessonsContext } from '../artifacts/lessons.ts';
import { classifyShipOutput, DryRunShipPath, ScaffoldShipPath, type ShipPath, type ShipResult } from '../delivery/ship.ts';
import { GitHubShipPath } from '../delivery/github-ship.ts';
import { buildReviewPrompt, collectCandidateDiff, materialiseVerdictSchema, pathAllowed, runReviewPanel, type PanelResult } from '../review/pre-review.ts';
import { Journal, currentActor } from '../state/journal.ts';
import { GoalStore } from '../state/goal-store.ts';
import { requireAuthority } from '../core/authorization.ts';
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

/** The ship path a project config selects; the `github` block carries the required checks, the verdict rule and the CI polling limits. */
export function shipPathFor(config: ProjectConfig, mainRoot: string, runner: SyncRunner): ShipPath {
  if (config.shipPath === 'scaffold') return new ScaffoldShipPath({ mainRoot, worktreeRoot: resolveWorktreeRoot(config), runner });
  if (config.shipPath === 'github') {
    const gh = config.github;
    return new GitHubShipPath({ mainRoot, worktreeRoot: resolveWorktreeRoot(config), repository: config.repository ?? '', runner, requiredChecks: gh.requiredChecks, requireVerdict: gh.requireVerdict, ciTimeoutMs: gh.ciTimeoutMs, ciPollMs: gh.ciPollMs });
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

  /** R2 eligibility for R3, shared by the gate and the command: the latest round for this candidate passed, or the rounds are exhausted and the policy hands the residual findings on. */
  private preReviewEligibility(run: CardRun, candidateDigest: string): { eligible: boolean; reason: string } {
    const cfg = this.config.preReview;
    if (!cfg.command.length) return { eligible: true, reason: 'pre-review not configured' };
    const cycle = run.review.substantiveBlocks;
    const rounds = run.preReview.rounds.filter((r) => r.cycle === cycle);
    const latest = [...rounds].reverse().find((r) => r.candidateDigest === candidateDigest);
    if (latest?.outcome === 'pass') return { eligible: true, reason: `pre-review round ${latest.round} passed` };
    const blocks = rounds.filter((r) => r.outcome === 'block').length;
    if (blocks >= cfg.rounds && cfg.onExhausted === 'ship') return { eligible: true, reason: 'pre-review rounds exhausted; residual findings handed to R3' };
    return { eligible: false, reason: latest ? `latest pre-review outcome for this candidate is ${latest.outcome}` : 'no pre-review round for this candidate' };
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
    const current = this.store.getCardRun(goal.id, card.id);
    if (!current) return;
    this.save({ ...current, review: { ...current.review, invocations: current.review.invocations.filter((i) => i.invocationId !== invocationId) } });
  }

  private save(run: CardRun): CardRun {
    return this.store.saveCardRun(CardRun.parse({ ...run, updatedAt: this.clock() }));
  }

  /**
   * Evidence from the persisted facts alone (lease record, operation ledger, run record; no probe), the owner's lease
   * renewal and the state selection, shared by `next`, which then performs the selected state's action, and by
   * `takeover`, which persists the selected state without one. `run` is returned as this block leaves it (a merged
   * card's ownership stop reconciled, an owner's stop revalidated), `next` as the selection would save it.
   */
  private assess(goal: Goal, card: Card, caller: CardRun, now: string): { run: CardRun; next: CardRun; decision: CardDecision; lease: Lease | undefined } {
    // Loop-owned evidence comes from the store, never from the caller's snapshot: a window that kept the run it read
    // before another session's takeover writes neither that generation nor an older merge or closure record back (the
    // three fields a raw card patch may not set either); everything else the caller passes is the run it means.
    const stored = this.store.getCardRun(goal.id, card.id);
    let run: CardRun = stored ? { ...caller, ownerGeneration: stored.ownerGeneration, mergeVerified: stored.mergeVerified, closure: stored.closure } : caller;
    const key = resourceKeys.card(this.repo.key, card.id);
    const me = currentActor();
    let lease = this.leases.read(key);
    // A merged card stopped for ownership is reconciled once the blocking lease is gone (released, expired or ours):
    // the replacement session may then reclaim the card in CLOSE instead of reading the old stop forever.
    if (run.stop?.reason === 'ownership' && run.mergeVerified && (!lease || lease.released || Date.parse(lease.expiresAt) < Date.parse(now) || (lease.owner.session === me.session && lease.owner.host === me.host))) {
      this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { from: 'STOP', to: 'CLOSE', reason: 'ownership stop reconciled: the blocking lease is gone' } });
      run = this.save({ ...run, state: 'CLOSE', stop: undefined });
    }
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
      // A run persisted as DONE keeps its closure complete: DONE is derived from a verified merge and a complete closure and never patched, so a record that predates the lessons predicate stays DONE.
      closureComplete: run.state === 'DONE' || Object.values(run.closure).every(Boolean),
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
    const next: CardRun = { ...run, state: decision.state, stop: decision.stop ?? run.stop, blocker: decision.state === 'STOP' ? decision.reason : undefined };
    if (next.state !== run.state) this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { from: run.state, to: next.state, reason: decision.reason } });
    return { run, next, decision, lease };
  }

  /** Gather evidence and select the next card directive. Performs only the bounded action of the selected state. */
  next(goal: Goal, card: Card, run: CardRun, options: { effort?: EffortLevel } = {}): { run: CardRun; directive: CardDirective } {
    const now = this.clock();
    // A T2 goal back in CARDS (a recovery re-entry after an extension or a resumed revision) whose plan checkpoint is not
    // approved for the current revision has not admitted its projection: no worker executes a card of it before `aidlc next` does.
    if (goal.state === 'CARDS' && goal.routing.size === 'T2' && !run.stop && run.state !== 'DONE' && requireAuthority(goal.authorizations, 'plan-checkpoint', { goalRevision: goal.revision }, now).status === 'missing') {
      return { run, directive: { kind: 'wait', cardId: card.id, on: `goal:${goal.state}:plan-checkpoint`, pollSeconds: 60, narration: `goal ${goal.id} is in CARDS without a plan checkpoint for revision ${goal.revision}: run \`aidlc next --goal ${goal.id}\` and record the approval before this card continues` } };
    }
    const assessed = this.assess(goal, card, run, now);
    run = assessed.run;
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

  /**
   * Take over the card lease of another session (MS2): only once that lease has expired and no operation of the card is
   * unresolved in any goal (the lease is one resource per repository and card). The generation advances, so a write of
   * the old owner at its generation is fenced; the run, read again once the lease is held, records the new generation (a
   * run interrupted between the lease claim and the PREPARE save, which has none, included) and its state is selected
   * again through `assess`, whose renewal revalidates the ownership stop as it does for an owner's own expired lease and
   * keeps any other stop as `card next` keeps it. The record is validated on what the store hands to the reconciliation,
   * not on the earlier read, and the ledger is read there too, so a release, a takeover or an operation that landed
   * meanwhile is seen. A lease this session already holds at a generation the run does not carry is an interrupted
   * takeover (or an interrupted claim), completed here without another advance; one the run carries refuses, since
   * `card next` renews it. A missing or released lease, a live lease of another session and an unresolved operation
   * refuse before any write. The store has no compare-and-set: an operation admitted after the lease write is a WAIT for
   * the new owner, since the state selection reads the ledger again, and a run write racing the final save is narrowed,
   * not closed, as the review paths narrow theirs. The goal lease is not touched (`aidlc goal takeover`).
   */
  takeover(goal: Goal, card: Card, caller: CardRun): { run: CardRun; lease: Lease; completed: boolean; previousOwner?: ActorIdentity; previousGeneration?: number } {
    const now = this.clock();
    const key = resourceKeys.card(this.repo.key, card.id);
    const me = currentActor();
    const mine = (l: Lease): boolean => !l.released && l.owner.session === me.session && l.owner.host === me.host;
    const unresolvedNow = (): string[] => this.ops.list({ cardId: card.id }).filter((o) => ['intended', 'issued', 'running', 'UNKNOWN'].includes(o.status)).map((o) => o.id);
    const first = this.leases.read(key);
    if (!first) throw new Error(`card ${card.id} has no lease record; run \`aidlc card next ${card.id}\` to claim it`);
    const seen: { previous?: { owner: ActorIdentity; generation: number } } = {};
    let lease: Lease;
    if (mine(first)) {
      lease = first;
    } else {
      try {
        lease = this.leases.takeover(
          key,
          (old) => {
            if (old.released) throw new Error(`the lease of card ${card.id} is released (generation ${old.generation}); run \`aidlc card next ${card.id}\` to claim it`);
            if (mine(old)) throw new AlreadyOwned(old);
            const unresolved = unresolvedNow();
            seen.previous = { owner: old.owner, generation: old.generation };
            return { reconciled: unresolved.length === 0, unresolvedOperations: unresolved, note: unresolved.length ? 'reconcile with `aidlc ops reconcile` first' : undefined };
          },
          { operation: `card:${card.id}`, now },
        ).lease;
      } catch (err) {
        if (!(err instanceof AlreadyOwned)) throw err;
        lease = err.lease;
        seen.previous = undefined;
      }
    }
    const previous = seen.previous;
    const current = this.store.getCardRun(goal.id, card.id) ?? caller;
    if (!previous && current.ownerGeneration === lease.generation) throw new Error(`this session owns card ${card.id} at generation ${lease.generation}; run \`aidlc card next ${card.id}\``);
    const data = previous ? { resource: key, leaseGeneration: lease.generation, takeover: true, previousOwner: previous.owner.session, previousGeneration: previous.generation } : { resource: key, leaseGeneration: lease.generation, takeover: true, completed: true };
    this.journal(goal.id).append({ type: 'LEASE_ACQUIRED', goalId: goal.id, cardId: card.id, generation: goal.generation, data });
    const owned = this.save({ ...current, ownerGeneration: lease.generation });
    const assessed = this.assess(goal, card, owned, now);
    const next = this.save(assessed.next);
    return { run: next, lease: assessed.lease ?? lease, completed: previous === undefined, previousOwner: previous?.owner, previousGeneration: previous?.generation };
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
    return this.save({ ...run, effort: episode, dodReceipt: input.outcome === 'success' ? (input.dodReceipt ?? `dod:${now}`) : run.dodReceipt, redReceipt: input.redReceipt ?? run.redReceipt, candidate, pendingRepair: clearsPendingRepair(run.pendingRepair, input) ? undefined : run.pendingRepair });
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
      const admitted = run.effort ? nextEffortAction(run.effort, { harderProblem: true, limitsPermit: true }) : undefined;
      return { run: next, directive: { kind: 'build', cardId: card.id, worktree: run.worktree ?? this.worktreePath(card.id), tdd: card.tdd, redReceipt: run.redReceipt, dodCommand: card.dod_command, effort: admitted?.action === 'attempt' ? admitted.effort : (run.effort?.baseline ?? 'medium'), attempt: (run.effort?.attempts.length ?? 0) + 1, skills: this.buildSkills(goal, card), narration: `Pre-review block still pending on candidate ${digest ?? 'unknown'}: ${last.reasons.join(' | ') || 'see the retained verdict'}. Fix within scope, rerun the DoD, record the attempt with the new candidate sha, then \`aidlc review pre ${card.id}\`.` } };
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
  async formalReview(goal: Goal, card: Card, run: CardRun): Promise<{ run: CardRun; classified: ClassifiedVerdict; verdict?: Verdict; advisory: string[]; verdictRef?: string; logRef?: string; durationMs: number; receiptSha256: string }> {
    const cfg = this.config.formalReview;
    if (!cfg.command.length) throw new Error('formalReview.command is not configured (aidlc.config.json)');
    if (run.stop || run.state === 'STOP') throw new Error(`card run is stopped (${run.stop?.reason ?? 'STOP'}); no review may run: ${run.stop?.nextAction ?? 'resolve the stop first'}`);
    const now = this.clock();
    const cwd = this.reviewCheckout(run);
    const baseRef = run.base?.oid ?? this.config.base;
    const candidateSha = this.pinnedCandidate(run, cwd);
    const candidateDigest = run.candidate?.digest ?? candidateSha;
    const eligibility = this.preReviewEligibility(run, candidateDigest);
    if (!eligibility.eligible) throw new Error(`pre-review pass required first (${eligibility.reason}): run \`aidlc review pre ${card.id}\` on candidate ${candidateSha.slice(0, 12)} before the formal review`);
    // Guards read the persisted run, not the caller's snapshot, so overlapping calls see each other's reservation.
    const persisted = this.store.getCardRun(goal.id, card.id) ?? run;
    if (persisted.stop || persisted.state === 'STOP') throw new Error(`card run is stopped (${persisted.stop?.reason ?? 'STOP'}); no review may run: ${persisted.stop?.nextAction ?? 'resolve the stop first'}`);
    const ledger = persisted.review;
    const forCandidate = ledger.invocations.filter((i) => i.reviewer === cfg.reviewer && i.candidateDigest === candidateDigest);
    const pendingReservation = forCandidate.find((i) => i.outcome === 'pending');
    if (pendingReservation) throw new Error(`a formal review of this candidate is already pending (${pendingReservation.invocationId}, requested ${pendingReservation.requestedAt}); join it, do not dispatch another`);
    const lastForCandidate = forCandidate[forCandidate.length - 1];
    if (lastForCandidate?.outcome === 'quota-hold' && lastForCandidate.holdUntil && Date.parse(lastForCandidate.holdUntil) > Date.parse(now)) {
      throw new Error(`formal reviewer ${cfg.reviewer} is on a quota hold until ${lastForCandidate.holdUntil}; do not re-run before it clears`);
    }
    if (ledger.substantiveDecisions >= MAX_SUBSTANTIVE_REVIEW_DECISIONS) {
      throw new Error(`the two-decision review allowance is used (${ledger.substantiveDecisions}); ${lastForCandidate?.outcome === 'pass' ? 'the current candidate already holds its pass, ship it' : 'a further required review is STOP/review'}, not another run`);
    }
    if (ledger.noVerdictRetriesUsed > MAX_NO_VERDICT_RETRIES) {
      throw new Error(`no verdict after the single retry (${ledger.noVerdictRetriesUsed} used); the card is STOP/review, not another run`);
    }
    // Only the lease owner at the run's generation may reserve a decision.
    if (persisted.ownerGeneration !== undefined) {
      this.renewOwnLease(card.id, persisted, now);
      this.leases.fence(resourceKeys.card(this.repo.key, card.id), persisted.ownerGeneration, currentActor(), now);
    }
    const reviewDir = path.join(cwd, '.review');
    const schema = materialiseVerdictSchema(reviewDir);
    const reviewPolicy = this.reviewPolicy();
    const priorFindings = (run.review.lastVerdict?.reasons ?? []).map((f) => `previous R3 decision: ${f}`);
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
    // Reserve the invocation on the persisted run before dispatch so a concurrent call cannot spend the same decision.
    const n = ledger.invocations.filter((i) => i.reviewer === cfg.reviewer).length + 1;
    const fileStem = `${card.id}.r3.${n}.${randomUUID().slice(0, 8)}`;
    const invocationId = `r3:${fileStem}`;
    const reservation = { invocationId, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer, requestedAt: now, outcome: 'pending' as const };
    this.save({ ...persisted, review: { ...ledger, invocations: [...ledger.invocations, reservation] } });
    const promptInArgv = cfg.command.some((a) => a.includes('{instructions}'));
    const promptFor = () => buildReviewPrompt({ stage: 'formal', includeDiff: !promptInArgv, reviewPolicy, card, base: baseRef, head: candidateSha, changedPaths, diff, truncated, priorFindings, round: ledger.substantiveDecisions + 1, maxRounds: MAX_SUBSTANTIVE_REVIEW_DECISIONS });
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
    // Re-read persisted state: the review may have run for minutes; a stop or takeover saved meanwhile wins,
    // and a discarded decision is never published.
    const current = this.store.getCardRun(goal.id, card.id) ?? run;
    const withoutReservation = { ...current.review, invocations: current.review.invocations.filter((i) => i.invocationId !== invocationId) };
    const result = { classified, verdict, advisory, verdictRef: panel.verdictRef, logRef: panel.logRef, durationMs: panel.durationMs, receiptSha256: panel.receiptSha256 };
    if (current.stop || current.state === 'STOP') {
      this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId, reviewer: cfg.reviewer, candidateDigest, outcome: classified.outcome, decision: 'discarded: card run stopped meanwhile', runStatus: classified.runStatus, reasons: classified.reasons, verdictRef: panel.verdictRef, receiptSha256: panel.receiptSha256, durationMs: panel.durationMs } });
      return { run: this.save({ ...current, review: withoutReservation, evidence: [...current.evidence, evidenceEntry] }), ...result };
    }
    this.renewOwnLease(card.id, current, after);
    try {
      if (current.ownerGeneration !== undefined) this.leases.fence(resourceKeys.card(this.repo.key, card.id), current.ownerGeneration, currentActor(), after);
    } catch (err) {
      const stop = makeStop('ownership', (err as FencedError).message, 'revalidate ownership; a stale generation cannot commit a review decision', { at: after });
      return { run: this.save({ ...current, review: withoutReservation, state: 'STOP', stop, evidence: [...current.evidence, evidenceEntry] }), ...result };
    }
    // The canonical document the ship paths read is published only now, for a successful, non-stale decision that
    // is being recorded; an advisory block is published as a consistent pass with every finding under `advisory`.
    const publishable = verdict !== undefined && !classified.stale && classified.runStatus === 'success' && (classified.outcome === 'pass' || classified.outcome === 'block-defect' || classified.outcome === 'block-advisory');
    if (publishable && verdict) {
      const canonical =
        classified.outcome === 'block-advisory'
          ? { ...verdict, verdict: 'pass' as const, reasons: [], axes: { spec: { verdict: 'pass' as const, reasons: [] }, standards: { verdict: 'pass' as const, reasons: [] } }, advisory: [...new Set([...verdict.reasons, ...(verdict.axes?.spec?.reasons ?? []), ...(verdict.axes?.standards?.reasons ?? [])])] }
          : verdict;
      writeFileSync(path.join(reviewDir, `${card.id}.json`), JSON.stringify({ ...canonical, reviewer: cfg.reviewer }, null, 2) + '\n', 'utf8');
    }
    const rec = recordReviewOutcome(withoutReservation, { invocationId, candidateDigest, base: this.config.base, policyVersion: this.config.reviewPolicyVersion, reviewer: cfg.reviewer, requestedAt: now, verdictRef: panel.verdictRef, holdUntil }, classified, verdict);
    this.journal(goal.id).append({ type: 'REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { invocationId, reviewer: cfg.reviewer, candidateDigest, outcome: classified.outcome, mergeBlocking: classified.mergeBlocking, decision: rec.decision.action, runStatus: classified.runStatus, reasons: classified.reasons, advisory, verdictRef: panel.verdictRef, receiptSha256: panel.receiptSha256, durationMs: panel.durationMs, holdUntil } });
    let next: CardRun = { ...current, review: rec.ledger, evidence: [...current.evidence, evidenceEntry] };
    switch (rec.decision.action) {
      case 'review-fix': {
        // The review budget, not the ladder, paid for this block: the episode reopens and the repair is the next attempt.
        const effort = current.effort ? reopenAfterReviewBlock(current.effort, classified.reasons[0] ?? 'review block') : current.effort;
        next = { ...next, state: 'REVIEW_FIX', effort, dodReceipt: undefined, blocker: undefined };
        break;
      }
      case 'stop-review': {
        const stop = makeStop('review', rec.decision.detail, 'return the retained verdict evidence for human adjudication; no counter reset', { at: after, global: false });
        next = { ...next, state: 'STOP', stop };
        break;
      }
      case 'wait-quota':
        next = { ...next, state: 'WAIT' };
        break;
      default:
        next = { ...next, state: 'SHIP' };
    }
    return { run: this.commitReviewed(goal, card, current, next, after), ...result };
  }

  /**
   * Commit a reviewed run: re-read the persisted run under the fence immediately before the write and keep a
   * terminal state saved meanwhile. The store has no compare-and-set, so this narrows the window; it does not
   * close it.
   */
  private commitReviewed(goal: Goal, card: Card, expected: CardRun, next: CardRun, now: string): CardRun {
    const latest = this.store.getCardRun(goal.id, card.id) ?? expected;
    if (latest.stop || latest.state === 'STOP') {
      this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { from: next.state, to: 'STOP', reason: 'a stop was saved while the review decision was being committed; the decision is kept as evidence only' } });
      return this.save({ ...latest, evidence: next.evidence });
    }
    if (latest.ownerGeneration !== undefined) this.leases.fence(resourceKeys.card(this.repo.key, card.id), latest.ownerGeneration, currentActor(), now);
    return this.save({ ...next, ownerGeneration: latest.ownerGeneration });
  }

  /** R2: run the configured pre-reviewer on the committed candidate and record the round. */
  async preReview(goal: Goal, card: Card, run: CardRun): Promise<{ run: CardRun; result: PanelResult; round: PreReviewRound }> {
    const cfg = this.config.preReview;
    if (!cfg.command.length) throw new Error('preReview.command is not configured (aidlc.config.json)');
    if (run.stop || run.state === 'STOP') throw new Error(`card run is stopped (${run.stop?.reason ?? 'STOP'}); no review may run: ${run.stop?.nextAction ?? 'resolve the stop first'}`);
    const now = this.clock();
    const cwd = this.reviewCheckout(run);
    const baseRef = run.base?.oid ?? this.config.base;
    const candidateSha = this.pinnedCandidate(run, cwd);
    const candidateDigest = run.candidate?.digest ?? candidateSha;
    const cycle = run.review.substantiveBlocks; // an R3 block restarts the pre-review cycle; an R3 pass does not
    const rounds = run.preReview.rounds.filter((r) => r.cycle === cycle);
    const lastRound = [...rounds].reverse().find((r) => r.candidateDigest === candidateDigest);
    if (lastRound?.outcome === 'quota-hold' && lastRound.holdUntil && Date.parse(lastRound.holdUntil) > Date.parse(now)) {
      throw new Error(`pre-reviewer ${cfg.reviewer} is on a quota hold until ${lastRound.holdUntil}; do not re-run before it clears`);
    }
    const round = rounds.filter((r) => r.outcome === 'pass' || r.outcome === 'block').length + 1;
    const reviewPolicy = this.reviewPolicy();
    const lastBlock = [...rounds].reverse().find((r) => r.outcome === 'block');
    const priorFindings = [...(lastBlock?.reasons ?? []).map((f) => `pre-review round ${lastBlock?.round}: ${f}`), ...(cycle > 0 ? (run.review.lastVerdict?.reasons ?? []).map((f) => `R3 block: ${f}`) : [])];
    const { changedPaths, diff, truncated } = collectCandidateDiff(this.runner, cwd, baseRef, cfg.maxDiffBytes, this.repo.isGit ? candidateSha : 'HEAD');
    if (!diff.trim()) throw new Error(`no committed candidate diff against ${baseRef} in ${cwd}; commit the candidate first`);
    // Retention names carry the attempt number for this candidate and a nonce, so a retried or overlapping round never
    // overwrites earlier evidence.
    const attemptNo = rounds.filter((r) => r.candidateDigest === candidateDigest).length + 1;
    const fileStem = `${card.id}.pre.${cycle}.${round}.${attemptNo}.${randomUUID().slice(0, 8)}`;
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
      result = await runReviewPanel({ runner: this.asyncRunner, command: cfg.command, perspectives: cfg.perspectives, promptFor, vars: { cwd, base: baseRef, head: candidateSha, card: card.id }, cwd, timeoutMs: cfg.timeoutMs, shell: cfg.shell, reviewDir, fileStem, head: candidateSha, reviewer: cfg.reviewer, changedPaths });
    }
    const after = this.clock();
    // Timed from the clock after the run: a review can outlast the hold it reports.
    const holdUntil = result.outcome === 'quota-hold' ? addMs(after, result.retryAfterMs ?? 15 * 60 * 1000) : undefined;
    const perspectives = result.perspectives.map((p) => ({ name: p.perspective, outcome: p.outcome, runStatus: p.runStatus, reasons: p.reasons, durationMs: p.durationMs, verdictRef: p.verdictRef, receiptSha256: p.receiptSha256 }));
    const record: PreReviewRound = { round, cycle, reviewer: cfg.reviewer, candidateDigest, candidateSha, requestedAt: now, durationMs: result.durationMs, outcome: result.outcome, runStatus: result.runStatus, reasons: result.reasons, verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, holdUntil, perspectives };
    const evidenceEntry = { id: `pre-review-${cycle}-${round}-${attemptNo}`, kind: 'artifact' as const, createdAt: after, candidateDigest, note: `pre-review ${cfg.reviewer} ${result.outcome}: ${result.reasons.join(' | ')}`.slice(0, 500) };
    // Re-read persisted state: the panel may have run for minutes; a stop or takeover saved meanwhile wins.
    const current = this.store.getCardRun(goal.id, card.id) ?? run;
    if (current.stop || current.state === 'STOP') {
      this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle, round, reviewer: cfg.reviewer, candidateDigest, outcome: result.outcome, decision: 'discarded: card run stopped meanwhile', runStatus: result.runStatus, reasons: result.reasons, verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, durationMs: record.durationMs } });
      return { run: this.save({ ...current, evidence: [...current.evidence, evidenceEntry] }), result, round: record };
    }
    this.renewOwnLease(card.id, current, after);
    try {
      if (current.ownerGeneration !== undefined) this.leases.fence(resourceKeys.card(this.repo.key, card.id), current.ownerGeneration, currentActor(), after);
    } catch (err) {
      const stop = makeStop('ownership', (err as FencedError).message, 'revalidate ownership; a stale generation cannot commit a review round', { at: after });
      return { run: this.save({ ...current, state: 'STOP', stop, evidence: [...current.evidence, evidenceEntry] }), result, round: record };
    }
    this.journal(goal.id).append({ type: 'PRE_REVIEW_DECIDED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { cycle, round, reviewer: cfg.reviewer, candidateDigest, outcome: result.outcome, runStatus: result.runStatus, reasons: result.reasons, advisory: result.advisory ?? [], verdictRef: result.verdictRef, receiptSha256: result.receiptSha256, durationMs: record.durationMs, holdUntil, perspectives: perspectives.map((p) => `${p.name}:${p.outcome}`) } });
    let next: CardRun = { ...current, preReview: { rounds: [...current.preReview.rounds, record] }, evidence: [...current.evidence, evidenceEntry] };
    if (result.outcome === 'block') {
      // The R2 rounds are the pre-review's own budget: the episode reopens and the repair is the next attempt.
      const effort = current.effort ? reopenAfterReviewBlock(current.effort, `pre-review: ${result.reasons[0] ?? 'block'}`) : current.effort;
      next = { ...next, state: 'BUILD', effort, dodReceipt: undefined, blocker: undefined };
    }
    return { run: this.commitReviewed(goal, card, current, next, after), result, round: record };
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
    if (!sameArtifact && (verdictInfo.verdict || ['review-blocked', 'review-no-verdict'].includes(result.outcome))) {
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
        // The two R3 decisions are the formal review's own budget: the episode reopens and the repair is the next attempt.
        const effort = run.effort ? reopenAfterReviewBlock(run.effort, classified.reasons[0] ?? 'review block') : run.effort;
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
        // The classifier reads the structured gate lines for names and keeps wait lines and payloads out of the log patterns.
        const cls = classifyCiFailure([{ name: 'ship-ci-gate', conclusion: result.outcome === 'ci-timeout' ? 'timed_out' : 'failure', logExcerpt: text }]);
        this.journal(goal.id).append({ type: 'CI_CLASSIFIED', goalId: goal.id, cardId: card.id, generation: goal.generation, data: { class: cls.class, evidence: cls.evidence.slice(0, 5) } });
        const runId = text.match(/runs\/(\d+)/)?.[1] ?? `ship-${operationId}`;
        if (cls.class === 'security') {
          // A red secret or security scan is never rerun and never repaired blind: STOP/risk naming the check.
          const finding = cls.evidence.find((e) => e.startsWith('security: '))?.slice('security: '.length) ?? cls.failedJobs.join(',');
          const stop = makeStop('risk', `security gate red: ${finding}`, 'remove the finding from the change or the history, then ship a new candidate; the gate is never rerun or bypassed', { at: now, global: false });
          const stopped = this.save({ ...run, state: 'STOP', review, stop, dodReceipt: undefined, evidence });
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
          const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, evidence });
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
        const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, evidence });
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
        const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, redReceipt: undefined, evidence, effort: reopened, pendingRepair: { kind: 'red-missing', detail: result.detail, at: now, rejectedReceipt: run.redReceipt } });
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
          const next = this.save({ ...run, state: 'BUILD', review, dodReceipt: undefined, evidence, effort: reopened, pendingRepair: { kind: 'merge-conflict', detail, at: now } });
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

