/**
 * Goal controller (plan v5 §5 goal states, LC1, LC11).
 *
 * `next(goalId)` derives exactly one directive from persisted facts. It may persist *derived*
 * transitions that have no external effect (deadline STOP, CARDS->RUN once authorized,
 * RUN->VERIFY_ARC once required cards closed, CLOSE->DONE once closure predicates hold) and
 * it regenerates the board view. `report()` commits externally observed results (plan output,
 * card results, arc verification, release results, revisions, cancellation). One goal has one
 * coordinator: the goal lease is claimed at intake and checked on every mutation.
 */
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { selectArc, canOpenIntegrationRepair, type CardOutcome } from '../core/arc.ts';
import { checkAdmission, computeCardDeadline, computeGoalDeadlines, effectiveGoalDeadline } from '../core/deadlines.ts';
import { GoalTransitionError, stagesForTarget, transitionGoal } from '../core/goal-machine.ts';
import { classifyRequest, formatRouting } from '../core/router.ts';
import { parseIntent } from '../artifacts/intent.ts';
import { makeStop } from '../core/stop.ts';
import { approvalPacket, requireAuthority } from '../core/authorization.ts';
import { resolveRoleProfile, assessTaskEffort } from '../core/roles.ts';
import { mapRevision } from '../core/amendments.ts';
import {
  AuthorizationRecord,
  Card,
  CardRun,
  Goal,
  GoalRequest,
  MAX_INTEGRATION_REPAIR_CYCLES,
  MAX_PLANNING_INVOCATIONS,
  ReleaseAttempt,
  StopReason,
  addMs,
  nowIso,
  type DeliveryTarget,
  type StopRecord,
} from '../core/types.ts';
import { finalStateForTarget } from '../core/release-machine.ts';
import { LeaseStore, resourceKeys } from '../coordination/lease.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import { ReviewQueue } from '../coordination/review-queue.ts';
import { Journal, currentActor } from '../state/journal.ts';
import { GoalStore } from '../state/goal-store.ts';
import { renderBoard, outcomeOf } from '../state/board.ts';
import type { StatePaths, RepoIdentity } from '../state/paths.ts';
import { loadCardRegistry, validateRegistry, type CardRegistry } from '../artifacts/card.ts';
import type { ProjectConfig } from '../config.ts';
import { Directive, type ReportInput } from './directive.ts';

export interface ControllerDeps {
  paths: StatePaths;
  repo: RepoIdentity;
  config: ProjectConfig;
  store?: GoalStore;
  leases?: LeaseStore;
  queue?: ReviewQueue;
  ops?: OperationLedger;
  now?: () => string;
  /** Registry loader; defaults to reading config.cardsDir under the main root. */
  cards?: () => CardRegistry;
  /** Optional board mirror inside the repo (`_local/aidlc-board.md`). */
  boardMirror?: string;
}

export interface CreateGoalOptions {
  knownIssueNumbers?: number[];
  hasBugEvidence?: boolean;
  userLimitMs?: number;
  cards?: string[];
  grantedBy?: string;
  /** Intent file relative to the main checkout; PLAN lists its open questions for T1/T2. */
  intentRef?: string;
}

/** Validation problems are narrated by category only: a YAML parser message quotes the offending source, which may be a private front-matter value. */
function sanitizeIntentProblem(problem: string): string {
  return problem.startsWith('front matter:') ? 'front matter does not parse' : problem;
}

export class GoalController {
  readonly paths: StatePaths;
  readonly repo: RepoIdentity;
  readonly config: ProjectConfig;
  readonly store: GoalStore;
  readonly leases: LeaseStore;
  readonly queue: ReviewQueue;
  readonly ops: OperationLedger;
  private readonly clock: () => string;
  private readonly registryLoader: () => CardRegistry;
  private readonly boardMirror: string | undefined;

  constructor(deps: ControllerDeps) {
    this.paths = deps.paths;
    this.repo = deps.repo;
    this.config = deps.config;
    this.store = deps.store ?? new GoalStore(deps.paths);
    this.leases = deps.leases ?? new LeaseStore(deps.paths.leases);
    this.queue = deps.queue ?? new ReviewQueue(deps.paths.reviewQueue);
    this.ops = deps.ops ?? new OperationLedger(deps.paths.operations);
    this.clock = deps.now ?? nowIso;
    this.registryLoader = deps.cards ?? (() => loadCardRegistry(path.join(this.repo.mainRoot, this.config.cardsDir), path.join(this.repo.mainRoot, this.config.archiveDir)));
    this.boardMirror = deps.boardMirror;
  }

  journal(goalId: string): Journal {
    return Journal.forGoal(this.paths.journal, goalId);
  }

  // ---------------------------------------------------------------------------------------
  // Intake
  // ---------------------------------------------------------------------------------------

  createGoal(request: GoalRequest, options: CreateGoalOptions = {}): Goal {
    const now = this.clock();
    const registry = this.registryLoader();
    const routing = classifyRequest({
      ...request,
      knownCardIds: registry.cards.map((c) => c.card.id),
      knownIssueNumbers: options.knownIssueNumbers,
      hasBugEvidence: options.hasBugEvidence,
      affectedSurfaces: request.affectedSurfaces,
    });
    const target: DeliveryTarget = request.explicitTarget ?? routing.target;
    const explicitCards = options.cards ?? (routing.kind === 'card-execute' || routing.kind === 'card-amendment' ? [routing.reasons.find((r) => r.startsWith('ref='))?.slice(4) ?? ''].filter(Boolean) : []);
    const cardCount = explicitCards.length ? explicitCards.length : routing.cardCount;
    const deadlines = computeGoalDeadlines(now, { cardCount, standaloneRelease: routing.kind === 'release', userLimitMs: options.userLimitMs ?? this.config.userLimitMs });
    const id = `g-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 6)}`;
    const roleProfiles = (['planner', 'implementer', 'investigator', 'reviewer', 'release-specialist'] as const).map((role) => resolveRoleProfile({ role, family: this.config.family }));
    const authorizations: AuthorizationRecord[] = [
      {
        id: `auth-dev-${id}`,
        kind: 'development',
        grantedBy: options.grantedBy ?? request.source,
        grantedAt: now,
        goalRevision: 0,
        operations: [],
        migrations: [],
        evidenceRefs: [],
        ref: 'the request itself authorises development-only work under installed policy',
      },
    ];
    if (target === 'staging' || target === 'production') {
      // LC6: staging actions run automatically only within the already requested staging scope.
      authorizations.push({ id: `auth-staging-${id}`, kind: 'staging', grantedBy: options.grantedBy ?? request.source, grantedAt: now, goalRevision: 0, operations: [], migrations: [], evidenceRefs: [], ref: 'explicit online-testing/staging (or production) request authorises the staging scope only; production needs its own bound approval' });
    }
    const goal: Goal = Goal.parse({
      schemaVersion: 1,
      id,
      generation: 0,
      revision: 0,
      revisions: [{ revision: 0, at: now, reason: 'intake', request, supersededCards: {}, removedCards: [] }],
      repository: request.repository ?? this.config.repository ?? this.repo.mainRoot,
      routing,
      intentRef: options.intentRef,
      target,
      stages: stagesForTarget(target),
      state: 'PLAN',
      deadlines,
      authorizations,
      cards: explicitCards,
      cardRevisions: Object.fromEntries(explicitCards.map((c) => [c, 0])),
      counters: {},
      roleProfiles,
      maxWorkers: this.config.maxWorkers,
      reviewPool: this.config.reviewPool,
      evidence: [],
      terminal: false,
      createdAt: now,
      updatedAt: now,
    });
    const claim = this.leases.claim(resourceKeys.goal(this.repo.key, goal.id), { operation: 'coordinate', now });
    if (claim.status === 'held') throw new Error(`goal lease unexpectedly held by ${claim.lease.owner.session}`);
    this.store.saveGoal(goal);
    const j = this.journal(goal.id);
    j.append({ type: 'GOAL_CREATED', goalId: goal.id, generation: 0, data: { request: request.text.slice(0, 500), source: request.source, target, deadline: deadlines.goalDeadline, leaseGeneration: claim.lease.generation } });
    j.append({ type: 'GOAL_ROUTED', goalId: goal.id, generation: 0, data: { routing, line: formatRouting(routing) } });
    this.writeBoard(goal);
    return goal;
  }

  // ---------------------------------------------------------------------------------------
  // next(): one typed directive
  // ---------------------------------------------------------------------------------------

  next(goalId: string): Directive {
    let goal = this.mustGoal(goalId);
    const now = this.clock();
    const base = (g: Goal) => ({ goalId: g.id, generation: g.generation, revision: g.revision, goalState: g.state, deadline: effectiveGoalDeadline(g.deadlines), skills: g.routing.skills ?? [] });

    if (goal.terminal || goal.state === 'DONE' || goal.state === 'STOP') {
      return goal.state === 'DONE'
        ? Directive.parse({ kind: 'done', ...base(goal), evidence: { stages: goal.stages, cards: goal.cards }, narration: 'Goal is DONE. Return the existing result; perform no further task work.' })
        : Directive.parse({ kind: 'stop', ...base(goal), stop: goal.stop ?? makeStop('cancelled', 'terminal', 'none', { at: now }), narration: 'Goal is terminal. Late wakeups do no new work.' });
    }

    // 1. Reconcile first.
    const unresolved = this.ops.unresolved(goal.id);
    if (unresolved.length) {
      const admission = checkAdmission(effectiveGoalDeadline(goal.deadlines), now, goal.deadlines.graceMs);
      if (admission.phase === 'expired') {
        goal = this.persistStop(goal, makeStop('time', 'reconciliation grace expired with unresolved operations', 'hand off the exact environment and unresolved operation ids to the named owner', { at: now, unresolvedOperations: unresolved.map((o) => o.id) }));
        return Directive.parse({ kind: 'stop', ...base(goal), stop: goal.stop, narration: 'Reconciliation grace expired.' });
      }
      return Directive.parse({ kind: 'wait', ...base(goal), on: `reconcile:${unresolved.map((o) => o.id).join(',')}`, until: admission.graceEndsAt, pollSeconds: 60, narration: `Reconcile ${unresolved.length} operation(s) with unknown outcome before admitting any new mutation: run \`aidlc ops reconcile\`.` });
    }

    // 2. Deadline.
    const admission = checkAdmission(effectiveGoalDeadline(goal.deadlines), now, goal.deadlines.graceMs);
    if (admission.phase !== 'open') {
      goal = this.persistStop(goal, makeStop('time', `goal admission deadline ${effectiveGoalDeadline(goal.deadlines)} reached`, 'hand off with the existing branches/PRs and evidence; an extension must be explicit and recorded (aidlc goal extend)', { at: now, global: false }));
      return Directive.parse({ kind: 'stop', ...base(goal), stop: goal.stop, narration: 'Admission deadline reached; no new planned work.' });
    }

    // 3. Ownership: this session must hold the goal lease (or attach read-only).
    const lease = this.leases.read(resourceKeys.goal(this.repo.key, goal.id));
    const me = currentActor();
    if (lease && !lease.released && lease.owner.session !== me.session && Date.parse(lease.expiresAt) >= Date.parse(now)) {
      return Directive.parse({ kind: 'wait', ...base(goal), on: `owner:${lease.owner.session}`, until: lease.expiresAt, pollSeconds: 120, narration: `Goal is coordinated by session ${lease.owner.session} (generation ${lease.generation}). Attach read-only, or take over after reconciliation with \`aidlc goal takeover\` once the lease expires.` });
    }

    switch (goal.state) {
      case 'PLAN':
        return this.nextInPlan(goal, now);
      case 'CARDS':
        return this.nextInCards(goal, now);
      case 'RUN':
      case 'WAIT':
        return this.nextInRun(goal, now);
      case 'VERIFY_ARC':
        return this.nextInVerifyArc(goal, now);
      case 'DELIVER':
        return this.nextInDeliver(goal, now);
      case 'CLOSE':
        return this.nextInClose(goal, now);
      default:
        return Directive.parse({ kind: 'wait', ...base(goal), on: 'unknown-state', narration: `unhandled goal state ${goal.state}` });
    }
  }

  private nextInPlan(goal: Goal, now: string): Directive {
    const base = this.baseOf(goal);
    if (goal.routing.ambiguity) {
      return Directive.parse({ kind: 'ask', ...base, question: goal.routing.ambiguity, options: [], responseRoute: 'aidlc goal amend --text', narration: 'One sizing/identity question; available context cannot resolve it.' });
    }
    const size = goal.routing.size;
    const light = size === 'T0' || size === 'T0-bugfix';
    if (light && goal.cards.length) {
      // Existing card: plan is the card's plan_ref; go straight to projection validation.
      return Directive.parse({ kind: 'project-cards', ...base, planRef: goal.planRef ?? 'existing card plan_ref', cardsDir: this.config.cardsDir, outputs: goal.cards, narration: `T0 route with resolved card ${goal.cards.join(',')}: validate the card (aidlc cards validate) and report cards-projected.` });
    }
    const allowance = MAX_PLANNING_INVOCATIONS - goal.counters.planningInvocations;
    if (allowance <= 0 && !goal.planRef) {
      const g = this.persistStop(goal, makeStop('checkpoint', 'planning allowance (initial + one corrective invocation) exhausted without an accepted plan', 'a material new requirement or independently evidenced gap may start a linked new episode; cosmetic revisions cannot refund attempts', { at: now, global: false }));
      return Directive.parse({ kind: 'stop', ...this.baseOf(g), stop: g.stop, narration: 'Planning allowance exhausted.' });
    }
    if (goal.planRef) {
      return Directive.parse({ kind: 'project-cards', ...base, planRef: goal.planRef, cardsDir: this.config.cardsDir, outputs: [], narration: 'Plan accepted; project cards into the registry (human sign-off writes the card files), validate them, then report cards-projected with the card ids.' });
    }
    const inputs = [goal.revisions[goal.revisions.length - 1]!.request.text];
    const planInputs = goal.intentRef && !light ? [...inputs, goal.intentRef] : inputs;
    const intake = light ? '' : this.intakeNarration(goal);
    const outputs = light ? ['one coherent card (diagnosis + fix + regression test)'] : size === 'T1' ? ['concise plan points (Files that change / Order of work / Risks / Proof)', '2-5 valid cards with depends_on'] : ['brief', 'plan (10 sections)', 'plan-forge audit ready-to-decompose', 'validated card projection'];
    return Directive.parse({ kind: 'plan', ...base, size, inputs: planInputs, invocationAllowance: allowance, outputs, narration: (light ? 'T0: diagnose and write one card; no planning funnel.' : size === 'T1' ? 'T1: concise plan and cards; no full forge where routing policy permits.' : 'T2: full funnel; one product checkpoint approves plan and projection together.') + intake });
  }

  private nextInCards(goal: Goal, now: string): Directive {
    const base = this.baseOf(goal);
    const registry = this.registryLoader();
    const validation = validateRegistry(registry, this.config.tierPaths);
    const missing = goal.cards.filter((id) => !registry.cards.some((c) => c.card.id === id));
    const blocking = goal.cards.flatMap((id) => (validation.get(id) ?? []).filter((f) => f.severity === 'block').map((f) => `${id}: ${f.sentinel} ${f.message}`));
    if (!goal.cards.length || missing.length || blocking.length) {
      const problems = [...missing.map((m) => `${m}: not in registry`), ...blocking];
      return Directive.parse({ kind: 'project-cards', ...base, planRef: goal.planRef ?? '', cardsDir: this.config.cardsDir, outputs: goal.cards, narration: problems.length ? `Projection invalid: ${problems.slice(0, 5).join('; ')}` : 'No cards registered for this goal; project and report cards-projected.' });
    }
    // Authorization: T2 needs the combined plan+projection checkpoint for this revision.
    if (goal.routing.size === 'T2') {
      const auth = requireAuthority(goal.authorizations, 'plan-checkpoint', { goalRevision: goal.revision }, now);
      if (auth.status === 'missing') {
        const packet = approvalPacket('plan-checkpoint', { goalRevision: goal.revision }, { changes: `plan ${goal.planRef ?? ''} + cards ${goal.cards.join(',')}`, evidence: ['card validation passed'] });
        return Directive.parse({ kind: 'checkpoint', ...base, approvalKind: 'plan-checkpoint', packet, responseRoute: 'aidlc report --result approved|rejected', narration: 'T2 product checkpoint: approve the concrete plan and validated projection together before registration/execution. Carry approval forward; do not ask again for unchanged routine work.' });
      }
    }
    // Derived transition CARDS -> RUN.
    const next = transitionGoal(goal, 'RUN', now, { projectionAuthorized: true });
    this.store.saveGoal(next);
    this.journal(goal.id).append({ type: 'GOAL_STATE', goalId: goal.id, generation: goal.generation, data: { from: 'CARDS', to: 'RUN', cards: goal.cards } });
    return this.nextInRun(next, now);
  }

  private cardOutcomes(goal: Goal, registry: CardRegistry): { cards: Card[]; runs: CardRun[]; outcomes: Record<string, CardOutcome> } {
    const cards = goal.cards.map((id) => registry.cards.find((c) => c.card.id === id)?.card).filter((c): c is Card => Boolean(c));
    const runs = this.store.listCardRuns(goal.id);
    const outcomes: Record<string, CardOutcome> = {};
    for (const c of cards) outcomes[c.id] = outcomeOf(runs.find((r) => r.cardId === c.id), c);
    return { cards, runs, outcomes };
  }

  private nextInRun(goal: Goal, now: string): Directive {
    const base = this.baseOf(goal);
    const registry = this.registryLoader();
    const { cards, runs, outcomes } = this.cardOutcomes(goal, registry);
    const poolBusy = this.queue.pool(goal.reviewPool).maxConcurrent <= 1;
    const arc = selectArc({ cards, outcomes, maxWorkers: goal.maxWorkers, singleReviewerSlot: poolBusy && goal.maxWorkers > 1 ? false : undefined });
    this.writeBoard(goal, cards, runs);
    if (arc.verdict === 'done') {
      // A goal parked in WAIT (polled while its cards were running) resumes to RUN first: the diagram
      // derives VERIFY_ARC from RUN only, never from WAIT.
      if (goal.state === 'WAIT') {
        const resumed = transitionGoal(goal, 'RUN', now);
        this.store.saveGoal(resumed);
        this.journal(goal.id).append({ type: 'GOAL_STATE', goalId: goal.id, generation: goal.generation, data: { from: 'WAIT', to: 'RUN', reason: 'required cards closed' } });
        goal = resumed;
      }
      const next = transitionGoal(goal, 'VERIFY_ARC', now, { requiredCardsClosed: true });
      this.store.saveGoal(next);
      this.journal(goal.id).append({ type: 'GOAL_STATE', goalId: goal.id, generation: goal.generation, data: { from: goal.state, to: 'VERIFY_ARC' } });
      return this.nextInVerifyArc(next, now);
    }
    if (arc.verdict === 'stop') {
      const stopped = runs.filter((r) => r.state === 'STOP');
      const reason: StopReason = stopped.length ? (stopped[0]!.stop?.reason ?? 'card') : 'card';
      const g = this.persistStop(goal, makeStop(reason, `no admissible work: ${arc.reasons.join('; ')}`, stopped.length ? `resolve ${stopped.map((s) => s.cardId).join(',')} (${stopped.map((s) => s.stop?.nextAction ?? '').join(' | ')})` : 'inspect the board and the dependency graph', { at: now, global: false }));
      return Directive.parse({ kind: 'stop', ...this.baseOf(g), stop: g.stop, narration: 'Empty ready set with required gaps is never DONE.' });
    }
    if (arc.verdict === 'wait') {
      if (goal.state !== 'WAIT') {
        const next = transitionGoal(goal, 'WAIT', now);
        this.store.saveGoal(next);
      }
      const running = runs.filter((r) => ['BUILD', 'SHIP', 'REVIEW_FIX', 'WAIT', 'PREPARE', 'CLOSE'].includes(r.state)).map((r) => `${r.cardId}:${r.state}`);
      return Directive.parse({ kind: 'wait', ...base, goalState: 'WAIT', on: running.join(',') || 'dependencies', pollSeconds: 90, narration: `Waiting on ${running.join(', ') || 'dependency closure'}; ${arc.reasons.join('; ')}` });
    }
    if (goal.state === 'WAIT') {
      const next = transitionGoal(goal, 'RUN', now);
      this.store.saveGoal(next);
      goal = next;
    }
    const cardId = arc.wave[0]!;
    const card = cards.find((c) => c.id === cardId)!;
    const run = runs.find((r) => r.cardId === cardId);
    const cardStart = run?.startedAt ?? now;
    const cardDeadline = computeCardDeadline(cardStart, goal.deadlines, this.config.userLimitMs);
    const ladder = goal.roleProfiles.find((p) => p.role === 'implementer')?.supportedEfforts ?? ['low', 'medium', 'high'];
    const effort = run?.effort?.baseline ?? assessTaskEffort({ uncertainty: card.diagnosis ? 'medium' : 'low', scope: card.allow_paths.length > 3 ? 'moderate' : 'narrow', risk: card.tier === 'S' ? 'high' : 'medium', verificationBurden: card.tdd ? 'moderate' : 'light' }, ladder);
    return Directive.parse({
      kind: 'run-card',
      ...this.baseOf(goal),
      cardId,
      cardState: run?.state ?? 'PREPARE',
      worktree: run?.worktree,
      base: this.config.base,
      mode: this.config.mode,
      effort,
      role: 'implementer',
      cardDeadline,
      context: { revision: goal.cardRevisions[cardId] ?? 0, generation: goal.generation, reviewPool: goal.reviewPool, modules: goal.routing.modules, dataImpact: goal.routing.dataImpact, wave: arc.wave, workers: arc.workers, arcReasons: arc.reasons },
      narration: `Run card ${cardId} (${run?.state ?? 'PREPARE'}) via \`aidlc card next ${cardId} --goal ${goal.id}\`. Wave: ${arc.wave.join(',')} (cap ${arc.workers}).`,
    });
  }

  private nextInVerifyArc(goal: Goal, now: string): Directive {
    const base = this.baseOf(goal);
    const repairLeft = MAX_INTEGRATION_REPAIR_CYCLES - goal.counters.integrationRepairCycles;
    const checks = goal.cards.length > 1 ? ['integrated acceptance on the final integrated SHA', 'cross-card user workflows', 'relevant E2E / evals'] : ['requested outcome verified on the integrated candidate'];
    void now;
    return Directive.parse({ kind: 'verify-arc', ...base, cards: goal.cards, integratedChecks: checks, repairCyclesLeft: Math.max(0, repairLeft), narration: 'All required cards closed. Verify the whole goal on the final integrated artifact, then report arc-verified (with evidence) or arc-failed (with the coherent repair cards).' });
  }

  private nextInDeliver(goal: Goal, now: string): Directive {
    const base = this.baseOf(goal);
    let attempt = this.store.listReleases(goal.id).find((a) => !['DONE', 'STOP'].includes(a.state));
    const done = this.store.listReleases(goal.id).find((a) => a.state === 'DONE' && a.disposition === 'delivered');
    if (done) {
      const next = transitionGoal(goal, 'CLOSE', now, { deliveryVerified: true });
      next.stages = { ...next.stages, [goal.target]: 'pass' };
      this.store.saveGoal(next);
      return this.nextInClose(next, now);
    }
    if (!attempt) {
      attempt = ReleaseAttempt.parse({ id: `rel-${goal.id}-${this.store.listReleases(goal.id).length + 1}`, goalId: goal.id, generation: goal.generation, target: goal.target, state: 'PREPARE', startedAt: now, deadline: effectiveGoalDeadline(goal.deadlines), updatedAt: now });
      this.store.saveRelease(attempt);
      this.journal(goal.id).append({ type: 'RELEASE_STATE', goalId: goal.id, generation: goal.generation, data: { attemptId: attempt.id, state: 'PREPARE', target: goal.target } });
    }
    const packet = attempt.state === 'CHECKPOINT' ? approvalPacket('production', { candidateDigest: attempt.candidateDigest, sourceSha: attempt.sourceSha, configDigest: attempt.configDigest, environment: attempt.environment, operations: attempt.operations }, { evidence: attempt.evidence.map((e) => e.id) }) : {};
    return Directive.parse({ kind: 'release', ...base, attemptId: attempt.id, releaseState: attempt.state, target: goal.target, environment: attempt.environment, packet, narration: `Release attempt ${attempt.id} in ${attempt.state} (final state for ${goal.target}: ${finalStateForTarget(goal.target)}). Drive it with \`aidlc release next ${attempt.id}\`; never promote automatically.` });
  }

  private nextInClose(goal: Goal, now: string): Directive {
    const base = this.baseOf(goal);
    const runs = this.store.listCardRuns(goal.id);
    const missing: string[] = [];
    for (const id of goal.cards) {
      const run = runs.find((r) => r.cardId === id);
      if (!run) {
        missing.push(`${id}: no run record`);
        continue;
      }
      if (!run.mergeVerified) missing.push(`${id}: merge not verified`);
      // A run persisted as DONE keeps its closure complete: DONE is derived and never patched, so a record that predates the lessons predicate stays complete.
      for (const [k, v] of Object.entries(run.closure)) if (!v && !(run.state === 'DONE' && k === 'lessons')) missing.push(`${id}: closure.${k}`);
    }
    for (const [stage, status] of Object.entries(goal.stages)) if (status !== 'not_requested' && status !== 'pass') missing.push(`stage ${stage}=${status}`);
    if (missing.length) return Directive.parse({ kind: 'close', ...base, missing, narration: 'Perform only the missing closure steps (status/doc_sync/findings/evidence/cleanup/lessons) through the existing approved procedure; a reminder or exit zero alone is not closure, and the lesson step needs a recorded line or a reason to skip.' });
    const next = transitionGoal(goal, 'DONE', now, { closureComplete: true });
    this.store.saveGoal(next);
    this.journal(goal.id).append({ type: 'GOAL_DONE', goalId: goal.id, generation: goal.generation, data: { cards: goal.cards, stages: goal.stages } });
    this.leases.release(resourceKeys.goal(this.repo.key, goal.id), this.leases.read(resourceKeys.goal(this.repo.key, goal.id))?.generation ?? 0);
    this.writeBoard(next);
    return Directive.parse({ kind: 'done', ...this.baseOf(next), evidence: { stages: next.stages, cards: next.cards }, narration: 'Goal DONE: every mandatory outcome of the accepted revision maps to retained verification.' });
  }

  // ---------------------------------------------------------------------------------------
  // report(): commit externally observed results
  // ---------------------------------------------------------------------------------------

  report(input: ReportInput): { goal: Goal; directive: Directive } {
    let goal = this.mustGoal(input.goalId);
    const now = this.clock();
    if (input.generation !== goal.generation) throw new Error(`stale report: observed generation ${input.generation}, current ${goal.generation}; revalidate before further mutation`);
    if (goal.terminal && input.result === 'revision') throw new Error(`goal ${goal.id} is terminal (${goal.state}); carry the revision into the resume: aidlc goal resume ${goal.id} --text "..." --replace '{"old":"new"}'`);
    if (goal.terminal && input.result !== 'resume') throw new Error(`goal ${goal.id} is terminal (${goal.state}); a fresh user-authorised continuation must link a new generation (aidlc goal resume)`);
    const j = this.journal(goal.id);
    const d = input.data;
    switch (input.result) {
      case 'intent-accepted':
        j.append({ type: 'PLAN_ACCEPTED', goalId: goal.id, generation: goal.generation, data: d });
        break;
      case 'plan-produced': {
        const planRef = typeof d['planRef'] === 'string' ? d['planRef'] : undefined;
        if (!planRef) throw new Error('plan-produced requires data.planRef');
        goal = { ...goal, planRef, counters: { ...goal.counters, planningInvocations: goal.counters.planningInvocations + 1 } };
        if (goal.state === 'PLAN') goal = transitionGoal(goal, 'CARDS', now, { intentAccepted: true });
        j.append({ type: 'PLAN_INVOKED', goalId: goal.id, generation: goal.generation, data: { planRef, invocation: goal.counters.planningInvocations, invocationId: d['invocationId'] } });
        break;
      }
      case 'plan-failed':
        goal = { ...goal, counters: { ...goal.counters, planningInvocations: goal.counters.planningInvocations + 1 } };
        j.append({ type: 'PLAN_INVOKED', goalId: goal.id, generation: goal.generation, data: { failed: true, detail: d['detail'], invocationId: d['invocationId'] } });
        break;
      case 'cards-projected': {
        const cards = Array.isArray(d['cards']) ? (d['cards'] as unknown[]).map(String) : [];
        if (!cards.length) throw new Error('cards-projected requires data.cards (ids)');
        const registry = this.registryLoader();
        const unknown = cards.filter((id) => !registry.cards.some((c) => c.card.id === id));
        if (unknown.length) throw new Error(`cards not found in ${this.config.cardsDir}: ${unknown.join(',')} (human sign-off writes the card files first)`);
        const cardRevisions = { ...goal.cardRevisions };
        for (const id of cards) cardRevisions[id] = cardRevisions[id] ?? 0;
        goal = { ...goal, cards, cardRevisions, projectionRef: typeof d['projectionRef'] === 'string' ? d['projectionRef'] : goal.projectionRef };
        if (goal.state === 'PLAN') goal = transitionGoal(goal, 'CARDS', now, { intentAccepted: true });
        if (goal.state === 'VERIFY_ARC' || goal.state === 'DELIVER') goal = transitionGoal(goal, 'CARDS', now, { repairCycleAvailable: true });
        j.append({ type: 'CARDS_PROJECTED', goalId: goal.id, generation: goal.generation, data: { cards, projectionRef: goal.projectionRef } });
        break;
      }
      case 'approved': {
        const kind = (typeof d['kind'] === 'string' ? d['kind'] : goal.routing.size === 'T2' && goal.state === 'CARDS' ? 'plan-checkpoint' : 'development') as AuthorizationRecord['kind'];
        const record = AuthorizationRecord.parse({
          id: `auth-${kind}-${goal.id}-r${goal.revision}-${randomUUID().slice(0, 4)}`,
          kind,
          grantedBy: typeof d['by'] === 'string' ? d['by'] : 'user',
          grantedAt: now,
          ref: typeof d['ref'] === 'string' ? d['ref'] : undefined,
          goalRevision: goal.revision,
          candidateDigest: typeof d['candidateDigest'] === 'string' ? d['candidateDigest'] : undefined,
          sourceSha: typeof d['sourceSha'] === 'string' ? d['sourceSha'] : undefined,
          configDigest: typeof d['configDigest'] === 'string' ? d['configDigest'] : undefined,
          environment: typeof d['environment'] === 'string' ? d['environment'] : undefined,
          operations: Array.isArray(d['operations']) ? (d['operations'] as unknown[]).map(String) : [],
          migrations: Array.isArray(d['migrations'] as unknown[]) ? (d['migrations'] as unknown[]).map(String) : [],
          evidenceRefs: Array.isArray(d['evidenceRefs']) ? (d['evidenceRefs'] as unknown[]).map(String) : [],
          recoveryTarget: typeof d['recoveryTarget'] === 'string' ? d['recoveryTarget'] : undefined,
          recovery: d['recovery'] as AuthorizationRecord['recovery'],
        });
        goal = { ...goal, authorizations: [...goal.authorizations, record] };
        j.append({ type: 'AUTHORIZATION_GRANTED', goalId: goal.id, generation: goal.generation, data: { id: record.id, kind, environment: record.environment, candidateDigest: record.candidateDigest } });
        break;
      }
      case 'rejected': {
        const detail = typeof d['detail'] === 'string' ? d['detail'] : 'checkpoint rejected';
        if (goal.state === 'CARDS' || goal.state === 'PLAN') {
          goal = this.persistStopValue(goal, makeStop('checkpoint', detail, 'revise the plan/projection under a recorded revision (aidlc goal amend) or close the goal', { at: now, global: false }));
        } else {
          goal = this.persistStopValue(goal, makeStop('release-auth', detail, 'prepare the concrete evidence and request the missing authorization; no automatic retry', { at: now, global: false }));
        }
        break;
      }
      case 'card-result': {
        if (!input.cardId) throw new Error('card-result requires cardId');
        const existing = this.store.getCardRun(goal.id, input.cardId);
        if (!existing) throw new Error(`no run record for ${input.cardId}; start it with aidlc card next`);
        const patch = d['run'] && typeof d['run'] === 'object' ? (d['run'] as Record<string, unknown>) : d;
        for (const owned of ['closure', 'mergeVerified', 'ownerGeneration']) {
          if (Object.prototype.hasOwnProperty.call(patch, owned)) throw new Error(`${owned} is loop-owned evidence (closure predicates come from aidlc card close, the lesson step from --lesson or --skip-lesson), never set by a raw patch`);
        }
        if (patch['state'] === 'DONE' || patch['state'] === 'CLOSE') throw new Error(`${String(patch['state'])} is derived from a verified merge and the closure record, never set by a raw patch`);
        const run = CardRun.parse({ ...existing, ...patch, goalId: goal.id, cardId: input.cardId, updatedAt: now });
        this.store.saveCardRun(run);
        j.append({ type: 'CARD_RESULT', goalId: goal.id, cardId: input.cardId, generation: goal.generation, data: { state: run.state, candidate: run.candidate?.digest, pr: run.pr?.number, mergeVerified: run.mergeVerified, stop: run.stop?.reason, childRef: d['childRef'] ?? `card:${input.cardId}` } });
        break;
      }
      case 'arc-verified': {
        if (goal.state !== 'VERIFY_ARC') throw new GoalTransitionError(goal.state, 'CLOSE', 'arc-verified is only accepted in VERIFY_ARC');
        goal = { ...goal, stages: { ...goal.stages, development: 'pass' } };
        goal = goal.target === 'development' ? transitionGoal(goal, 'CLOSE', now, { integratedAcceptancePassed: true }) : transitionGoal(goal, 'DELIVER', now, { integratedAcceptancePassed: true });
        j.append({ type: 'GOAL_STATE', goalId: goal.id, generation: goal.generation, data: { from: 'VERIFY_ARC', to: goal.state, evidence: d['evidence'] } });
        break;
      }
      case 'arc-failed': {
        if (goal.state !== 'VERIFY_ARC') throw new GoalTransitionError(goal.state, 'CARDS', 'arc-failed is only accepted in VERIFY_ARC');
        const repair = canOpenIntegrationRepair(goal.counters.integrationRepairCycles);
        if (!repair.allowed) {
          goal = this.persistStopValue(goal, makeStop('arc-verify', `integrated acceptance failed again: ${String(d['detail'] ?? '')}`, 'second failure of the bounded repair cycle; hand off with evidence', { at: now, global: false }));
          break;
        }
        const repairCards = Array.isArray(d['repairCards']) ? (d['repairCards'] as unknown[]).map(String) : [];
        if (!repairCards.length) throw new Error('arc-failed requires data.repairCards (coherent repair card ids, one per cause)');
        goal = { ...goal, cards: [...goal.cards, ...repairCards.filter((c) => !goal.cards.includes(c))], counters: { ...goal.counters, integrationRepairCycles: goal.counters.integrationRepairCycles + 1 }, stages: { ...goal.stages, development: 'fail' } };
        goal = transitionGoal(goal, 'CARDS', now, { repairCycleAvailable: true });
        j.append({ type: 'GOAL_STATE', goalId: goal.id, generation: goal.generation, data: { from: 'VERIFY_ARC', to: 'CARDS', repairCards, detail: d['detail'] } });
        break;
      }
      case 'release-result': {
        if (!input.attemptId) throw new Error('release-result requires attemptId');
        const attempt = this.store.getRelease(input.attemptId);
        if (!attempt) throw new Error(`unknown release attempt ${input.attemptId}`);
        const patch = d['attempt'] && typeof d['attempt'] === 'object' ? (d['attempt'] as Record<string, unknown>) : d;
        const next = ReleaseAttempt.parse({ ...attempt, ...patch, id: attempt.id, goalId: goal.id, updatedAt: now });
        this.store.saveRelease(next);
        j.append({ type: 'RELEASE_STATE', goalId: goal.id, generation: goal.generation, data: { attemptId: next.id, state: next.state, disposition: next.disposition, health: next.healthResult } });
        if (next.state === 'STOP') {
          goal = { ...goal, stages: { ...goal.stages, [goal.target]: next.disposition === 'recovered' ? 'fail' : 'fail' } };
          goal = this.persistStopValue(goal, next.stop ?? makeStop('release-config', 'release attempt stopped', 'inspect the release attempt', { at: now, global: false }));
        } else if (next.state === 'DONE' && next.disposition === 'recovered') {
          goal = { ...goal, stages: { ...goal.stages, [goal.target]: 'fail' } };
          goal = this.persistStopValue(goal, makeStop('release-health', 'release recovered; the failed candidate was not delivered', 'diagnose, create a deduplicated repair card within the lifecycle repair allowance, and re-enter release with a new candidate and fresh applicable approval', { at: now, global: false }));
        }
        break;
      }
      case 'revision': {
        goal = this.applyRevision(goal, d, now, j, true);
        break;
      }
      case 'cancel':
        goal = this.persistStopValue(goal, makeStop('cancelled', String(d['detail'] ?? 'cancelled by user'), 'none; evidence retained', { at: now }));
        break;
      case 'resume': {
        // Fresh user-authorised continuation links the old terminal generation and preserves exhausted limits.
        if (!goal.terminal) throw new Error('resume applies only to a terminal goal');
        const generation = goal.generation + 1;
        goal = { ...goal, generation, terminal: false, state: goal.stop?.reason === 'time' ? 'STOP' : goal.state === 'STOP' ? 'WAIT' : goal.state, stop: undefined, linkedFrom: `${goal.id}@${goal.generation}` };
        if (goal.stop === undefined && goal.state === 'STOP') goal = { ...goal, state: 'WAIT' };
        j.append({ type: 'GOAL_TAKEOVER', goalId: goal.id, generation, data: { linkedFrom: goal.linkedFrom, reason: d['reason'] } });
        // A resume may carry the revision that makes the projection admissible again (replacement cards), applied before the projection runs.
        if (typeof d['text'] === 'string' || Array.isArray(d['cards']) || (d['replacements'] && typeof d['replacements'] === 'object')) {
          const last = goal.revisions[goal.revisions.length - 1]!;
          goal = this.applyRevision(goal, { ...d, text: typeof d['text'] === 'string' ? d['text'] : last.request.text }, now, j, false);
        }
        break;
      }
      default:
        throw new Error(`unknown report result ${String(input.result)}`);
    }
    goal = this.store.saveGoal(goal);
    this.writeBoard(goal);
    return { goal, directive: this.next(goal.id) };
  }

  // ---------------------------------------------------------------------------------------
  // Card run records
  // ---------------------------------------------------------------------------------------

  ensureCardRun(goal: Goal, cardId: string): CardRun {
    const existing = this.store.getCardRun(goal.id, cardId);
    if (existing) return existing;
    const now = this.clock();
    const run = CardRun.parse({
      goalId: goal.id,
      cardId,
      cardRevision: goal.cardRevisions[cardId] ?? 0,
      goalGeneration: goal.generation,
      state: 'PREPARE',
      startedAt: now,
      deadline: computeCardDeadline(now, goal.deadlines, this.config.userLimitMs),
      mode: this.config.mode,
      base: { ref: this.config.base },
      updatedAt: now,
    });
    this.store.saveCardRun(run);
    this.journal(goal.id).append({ type: 'CARD_DISPATCHED', goalId: goal.id, cardId, generation: goal.generation, data: { startedAt: run.startedAt, deadline: run.deadline, childRef: `card:${cardId}` } });
    return run;
  }

  // ---------------------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------------------

  mustGoal(goalId: string): Goal {
    const g = this.store.getGoal(goalId);
    if (!g) throw new Error(`unknown goal ${goalId}`);
    return g;
  }

  /** PLAN intake for T1/T2: the grilling skill settles the open questions of the intent before the spec; a missing or unreadable file is narrated, never thrown. */
  private intakeNarration(goal: Goal): string {
    const ref = goal.intentRef;
    if (!ref) return ' Intake: settle any open questions with the grilling skill before writing the spec (record the intent with `aidlc goal new --intent <file>` to have them listed here).';
    const file = path.resolve(this.repo.mainRoot, ref);
    if (!existsSync(file)) return ` Intake: intent file ${ref} not found under the main checkout; record the open questions before the spec and settle them with the grilling skill.`;
    try {
      const parsed = parseIntent(readFileSync(file, 'utf8'));
      const questions = parsed.intent?.openQuestions ?? [];
      const listed = questions.length ? ` Open questions to settle first: ${questions.map((q, i) => `Q${i + 1} ${q}`).join(' | ')}.` : '';
      // Any validation failure is narrated as such: an invalid file is never read as an empty question list.
      if (!parsed.ok || !parsed.intent) return ` Intake: intent file ${ref} does not validate (${parsed.problems.map(sanitizeIntentProblem).join('; ')}); fix the file and settle its open questions with the grilling skill before the spec.${listed}`;
      if (!questions.length) return ` Intake: ${ref} lists no open questions; write the spec.`;
      return ` Intake: ${ref} lists ${questions.length} open question(s); settle them in rounds with the grilling skill before the spec: ${questions.map((q, i) => `Q${i + 1} ${q}`).join(' | ')}.`;
    } catch (err) {
      return ` Intake: intent file ${ref} is unreadable (${err instanceof Error ? err.message : String(err)}); record the open questions before the spec and settle them with the grilling skill.`;
    }
  }

  private baseOf(goal: Goal) {
    return { goalId: goal.id, generation: goal.generation, revision: goal.revision, goalState: goal.state, deadline: effectiveGoalDeadline(goal.deadlines), skills: goal.routing.skills ?? [] };
  }

  private persistStop(goal: Goal, stop: StopRecord): Goal {
    const stopped = this.persistStopValue(goal, stop);
    return this.store.saveGoal(stopped);
  }

  private persistStopValue(goal: Goal, stop: StopRecord): Goal {
    const next = transitionGoal({ ...goal, state: goal.state }, 'STOP', this.clock(), {}, stop);
    this.journal(goal.id).append({ type: 'GOAL_STOPPED', goalId: goal.id, generation: goal.generation, data: { reason: stop.reason, detail: stop.detail, nextAction: stop.nextAction, global: stop.global } });
    this.writeBoard(next);
    return next;
  }

  /** A requirement revision: versions the goal, maps superseded cards and, for an amendment, returns to PLAN; a resume applies it in place. */
  private applyRevision(goal: Goal, d: Record<string, unknown>, now: string, j: Journal, toPlan: boolean): Goal {
    const text = typeof d['text'] === 'string' ? d['text'] : undefined;
    if (!text) throw new Error('revision requires data.text');
    const prev = goal.revisions[goal.revisions.length - 1]!;
    const replacements = (d['replacements'] as Record<string, string> | undefined) ?? {};
    const nextCards = Array.isArray(d['cards']) ? (d['cards'] as unknown[]).map(String) : goal.cards.map((c) => replacements[c] ?? c);
    const mapping = mapRevision(goal.cards, nextCards, replacements);
    const revision = goal.revision + 1;
    let next: Goal = {
      ...goal,
      revision,
      revisions: [...goal.revisions, { revision, at: now, reason: String(d['reason'] ?? 'user amendment'), request: { ...prev.request, text }, supersededCards: mapping.supersededCards, removedCards: mapping.removedCards }],
      cards: nextCards,
      cardRevisions: Object.fromEntries(nextCards.map((c) => [c, (goal.cardRevisions[c] ?? -1) + (mapping.retainedEvidenceFor.includes(c) ? 0 : 1)])),
    };
    if (toPlan && (next.state === 'WAIT' || next.state === 'RUN')) next = transitionGoal({ ...next, state: 'WAIT' }, 'PLAN', now, { revisionAccepted: true });
    j.append({ type: 'GOAL_REVISED', goalId: next.id, generation: next.generation, data: { revision, mapping, text: text.slice(0, 300) } });
    return next;
  }

  extendDeadline(goalId: string, by: string, newDeadline: string, reason: string): Goal {
    const goal = this.mustGoal(goalId);
    const extended = { ...goal, deadlines: { ...goal.deadlines, extensions: [...goal.deadlines.extensions, { at: this.clock(), by, newDeadline, reason }] } };
    if (Date.parse(newDeadline) <= Date.parse(effectiveGoalDeadline(goal.deadlines))) throw new Error('extension must move the deadline later');
    this.journal(goal.id).append({ type: 'NOTE', goalId: goal.id, generation: goal.generation, data: { extension: { by, newDeadline, reason } } });
    // The extension is the explicit authority a time stop asks for: the goal and every card of it stopped for time are
    // re-admitted under the new deadline; a stop for any other reason stays.
    let readmitted: Goal = extended;
    if (goal.terminal && goal.stop?.reason === 'time') {
      readmitted = { ...extended, terminal: false, stop: undefined, state: 'WAIT' };
      this.journal(goal.id).append({ type: 'GOAL_STATE', goalId: goal.id, generation: goal.generation, data: { from: 'STOP', to: 'WAIT', reason: `deadline extension to ${newDeadline} by ${by}` } });
    }
    for (const run of this.store.listCardRuns(goal.id)) {
      if (run.stop?.reason !== 'time') continue;
      this.store.saveCardRun(CardRun.parse({ ...run, stop: undefined, deadline: Date.parse(newDeadline) > Date.parse(run.deadline) ? newDeadline : run.deadline, updatedAt: this.clock() }));
      this.journal(goal.id).append({ type: 'CARD_STATE', goalId: goal.id, cardId: run.cardId, generation: goal.generation, data: { from: 'STOP', to: 'readmitted', reason: `deadline extension to ${newDeadline} by ${by}` } });
    }
    const saved = this.store.saveGoal(readmitted);
    this.writeBoard(saved);
    return saved;
  }

  writeBoard(goal: Goal, cards?: Card[], runs?: CardRun[]): string {
    const registry = cards ? undefined : this.registryLoader();
    const cs = cards ?? goal.cards.map((id) => registry!.cards.find((c) => c.card.id === id)?.card).filter((c): c is Card => Boolean(c));
    const rs = runs ?? this.store.listCardRuns(goal.id);
    const text = renderBoard(goal, cs, rs, this.clock());
    mkdirSync(this.paths.board, { recursive: true });
    writeFileSync(path.join(this.paths.board, `${goal.id}.md`), text, 'utf8');
    if (this.boardMirror) {
      try {
        mkdirSync(path.dirname(this.boardMirror), { recursive: true });
        writeFileSync(this.boardMirror, text, 'utf8');
      } catch {
        /* mirror is best effort */
      }
    }
    return text;
  }

  /** Card deadline relative to the goal (exported for the card runner). */
  cardDeadline(goal: Goal, start: string): string {
    return computeCardDeadline(start, goal.deadlines, this.config.userLimitMs);
  }

  static addMs = addMs;
}
