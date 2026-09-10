/**
 * Release runner (plan v5 LC3-LC10, Q16-Q22).
 *
 * Drives one ReleaseAttempt through PREPARE -> STAGE -> CHECKPOINT -> APPLY -> OBSERVE ->
 * CLOSE -> DONE using bound provider operations only. Every external mutation records intent
 * first and is reconciled by provider status lookup; health is measured, never inferred; a
 * breach routes to RECOVER only with matching recovery authority and reports `recovered`.
 */
import { existsSync } from 'node:fs';
import { assertReleaseTransition, finalStateForTarget, nextAfterObserve, transitionRelease, type ReleaseGuards } from '../core/release-machine.ts';
import { evaluateHealth, windowElapsed } from '../core/health.ts';
import { makeStop } from '../core/stop.ts';
import { approvalPacket } from '../core/authorization.ts';
import { ReleaseAttempt, addMs, type Goal, type HealthSignal, type ReleaseState } from '../core/types.ts';
import { executeOperation, loadDeliveryOps, lookupOperation, resolveRoles, type OpsLoad, type OperationBinding } from '../delivery/ops.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import { LeaseStore, resourceKeys } from '../coordination/lease.ts';
import { Journal } from '../state/journal.ts';
import { GoalStore } from '../state/goal-store.ts';
import type { StatePaths, RepoIdentity } from '../state/paths.ts';
import type { SyncRunner } from '../probes/exec.ts';
import { runSync } from '../probes/exec.ts';

export interface ReleaseRunnerDeps {
  paths: StatePaths;
  repo: RepoIdentity;
  store?: GoalStore;
  ops?: OperationLedger;
  leases?: LeaseStore;
  runner?: SyncRunner;
  opsLoad?: OpsLoad;
  now?: () => string;
  /** Health signal source; defaults to reading bound health operations (none => INSUFFICIENT_DATA). */
  signals?: (attempt: ReleaseAttempt) => HealthSignal[];
}

export type ReleaseDirective =
  | { kind: 'prepare'; attemptId: string; needs: string[]; narration: string }
  | { kind: 'stage'; attemptId: string; environment: string; operations: string[]; narration: string }
  | { kind: 'checkpoint'; attemptId: string; packet: Record<string, unknown>; narration: string }
  | { kind: 'apply'; attemptId: string; environment: string; operations: string[]; narration: string }
  | { kind: 'observe'; attemptId: string; window: { from: string; to: string }; result?: string; narration: string }
  | { kind: 'recover'; attemptId: string; narration: string }
  | { kind: 'wait'; attemptId: string; on: string; until?: string; narration: string }
  | { kind: 'close'; attemptId: string; narration: string }
  | { kind: 'done'; attemptId: string; disposition: string; narration: string }
  | { kind: 'stop'; attemptId: string; stop: NonNullable<ReleaseAttempt['stop']>; narration: string };

export class ReleaseRunner {
  readonly paths: StatePaths;
  readonly repo: RepoIdentity;
  readonly store: GoalStore;
  readonly ops: OperationLedger;
  readonly leases: LeaseStore;
  readonly runner: SyncRunner;
  private readonly opsLoad: OpsLoad;
  private readonly clock: () => string;
  private readonly signals: (attempt: ReleaseAttempt) => HealthSignal[];

  constructor(deps: ReleaseRunnerDeps) {
    this.paths = deps.paths;
    this.repo = deps.repo;
    this.store = deps.store ?? new GoalStore(deps.paths);
    this.ops = deps.ops ?? new OperationLedger(deps.paths.operations);
    this.leases = deps.leases ?? new LeaseStore(deps.paths.leases);
    this.runner = deps.runner ?? runSync;
    this.opsLoad = deps.opsLoad ?? loadDeliveryOps(deps.repo.mainRoot);
    this.clock = deps.now ?? (() => new Date().toISOString());
    this.signals = deps.signals ?? (() => []);
  }

  private journal(goalId: string): Journal {
    return Journal.forGoal(this.paths.journal, goalId);
  }

  private save(attempt: ReleaseAttempt): ReleaseAttempt {
    return this.store.saveRelease(ReleaseAttempt.parse({ ...attempt, updatedAt: this.clock() }));
  }

  private binding(role: OperationBinding['role']): OperationBinding | undefined {
    return this.opsLoad.status === 'configured' ? this.opsLoad.config.operations.find((o) => o.role === role) : undefined;
  }

  private guards(goal: Goal, attempt: ReleaseAttempt, extra: Partial<ReleaseGuards> = {}): ReleaseGuards {
    const target = attempt.target === 'development' || attempt.target === 'operations' ? 'package' : attempt.target;
    const roles = resolveRoles(this.opsLoad, target);
    return {
      candidateVerified: Boolean(attempt.candidateDigest && attempt.sourceSha),
      providersConfigured: roles.ok,
      authorizations: goal.authorizations,
      effects: { candidateDigest: attempt.candidateDigest, sourceSha: attempt.sourceSha, configDigest: attempt.configDigest, environment: attempt.environment, operations: this.plannedRoles(attempt) },
      now: this.clock(),
      ...extra,
    };
  }

  /** One bounded step for the attempt. */
  next(goal: Goal, attempt: ReleaseAttempt): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    const now = this.clock();
    const stopOut = (a: ReleaseAttempt): { attempt: ReleaseAttempt; directive: ReleaseDirective } => ({ attempt: a, directive: { kind: 'stop', attemptId: a.id, stop: a.stop!, narration: a.stop!.detail } });
    if (attempt.state === 'STOP') return stopOut(attempt);
    if (attempt.state === 'DONE') return { attempt, directive: { kind: 'done', attemptId: attempt.id, disposition: attempt.disposition, narration: `Release attempt ${attempt.disposition}.` } };

    // Reconcile first.
    const unresolved = this.ops.list({ goalId: goal.id }).filter((o) => o.releaseAttempt === attempt.id && ['issued', 'running', 'UNKNOWN'].includes(o.status));
    for (const op of unresolved) {
      const binding = this.binding(op.kind === 'deploy' ? 'deploy' : op.kind === 'rollback' ? 'recover' : op.kind === 'migrate' ? 'migration-apply' : 'status');
      if (!binding || !op.providerOperationId) continue;
      const looked = lookupOperation(binding, op.providerOperationId, this.runner);
      this.ops.reconcile(op.id, () => (looked.status === 'UNKNOWN' ? { status: 'UNKNOWN', detail: looked.detail } : { status: looked.status, providerOperationId: op.providerOperationId }), now);
      this.journal(goal.id).append({ type: 'OPERATION_RECONCILED', goalId: goal.id, generation: goal.generation, data: { operationId: op.id, status: looked.status } });
    }
    // Sync step statuses from the (possibly reconciled) operation ledger.
    const syncedSteps = attempt.steps.map((s) => {
      if (!s.operationId) return s;
      const op = this.ops.get(s.operationId);
      if (!op) return s;
      const st: (typeof s)['status'] = op.status === 'succeeded' ? 'succeeded' : op.status === 'failed' || op.status === 'cancelled' ? 'failed' : op.status === 'UNKNOWN' ? 'UNKNOWN' : 'running';
      return st === s.status ? s : { ...s, status: st };
    });
    if (JSON.stringify(syncedSteps) !== JSON.stringify(attempt.steps)) attempt = this.save({ ...attempt, steps: syncedSteps });
    const still = this.ops.list({ goalId: goal.id }).filter((o) => o.releaseAttempt === attempt.id && ['issued', 'running'].includes(o.status));
    if (still.length) return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: `operations:${still.map((o) => o.id).join(',')}`, narration: 'Provider operations still running; wait on the known operation ids.' } };
    const unknown = this.ops.list({ goalId: goal.id }).filter((o) => o.releaseAttempt === attempt.id && o.status === 'UNKNOWN');
    if (unknown.length && Date.parse(now) > Date.parse(addMs(attempt.deadline, 5 * 60 * 1000))) {
      const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('time', 'reconciliation grace expired with UNKNOWN release operations', 'hand off environment and operation ids to the named owner', { at: now, unresolvedOperations: unknown.map((o) => o.id) }), disposition: 'failed' });
      return stopOut(stopped);
    }
    if (unknown.length) return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: `unknown:${unknown.map((o) => o.id).join(',')}`, until: addMs(attempt.deadline, 5 * 60 * 1000), narration: 'Operations with UNKNOWN outcome block dependent steps until reconciled.' } };

    // Environment ownership for external mutation states.
    if (['STAGE', 'APPLY', 'RECOVER'].includes(attempt.state) && attempt.environment) {
      const claim = this.leases.claim(resourceKeys.environment(attempt.environment), { operation: `release:${attempt.id}`, now });
      if (claim.status === 'held') return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: `environment:${attempt.environment}`, until: claim.lease.expiresAt, narration: `Environment ${attempt.environment} is owned by ${claim.lease.owner.session}; deployment serialises by environment.` } };
      if (claim.status === 'expired') {
        const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('ownership', `environment ${attempt.environment} has an expired lease from ${claim.lease.owner.session}`, 'reconcile the previous controller before taking over', { at: now, global: false }) });
        return stopOut(stopped);
      }
    }

    switch (attempt.state) {
      case 'PREPARE': {
        const needs: string[] = [];
        if (!attempt.candidateDigest) needs.push('immutable candidate digest (aidlc release candidate)');
        if (!attempt.sourceSha) needs.push('source sha bound to the verified goal candidate');
        const target = attempt.target === 'development' || attempt.target === 'operations' ? 'package' : attempt.target;
        const roles = resolveRoles(this.opsLoad, target);
        for (const r of roles.roles) if (r.status === 'NOT CONFIGURED') needs.push(`operation ${r.role}: NOT CONFIGURED`);
        if (roles.problem) needs.push(roles.problem);
        if (attempt.target === 'package') {
          if (needs.length) return { attempt, directive: { kind: 'prepare', attemptId: attempt.id, needs, narration: 'Package target: build/package operations and an identified package are required; report with aidlc release report.' } };
          return { attempt, directive: { kind: 'prepare', attemptId: attempt.id, needs: ['install/run proof'], narration: 'Run the package install/run proof and report it (aidlc release report --package-run-proof).' } };
        }
        if (needs.length) {
          const cfgMissing = needs.some((n) => n.includes('NOT CONFIGURED') || n.includes('unreadable'));
          if (cfgMissing && attempt.candidateDigest) {
            const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-config', needs.join('; '), 'bind the required operations in aidlc.ops.json (see docs/DELIVERY-OPS.md); an inactive optional target does not require them', { at: now, global: false }), disposition: 'failed' });
            return stopOut(stopped);
          }
          return { attempt, directive: { kind: 'prepare', attemptId: attempt.id, needs, narration: 'Resolve scope/owner/providers and select an immutable candidate; verify required source/package evidence and release checklist items.' } };
        }
        const env = attempt.environment ?? this.defaultEnvironment('staging');
        const stagedAttempt = transitionRelease({ ...attempt, environment: env }, 'STAGE', now, this.guards(goal, { ...attempt, environment: env }));
        const saved = this.save(stagedAttempt);
        this.journal(goal.id).append({ type: 'RELEASE_STATE', goalId: goal.id, generation: goal.generation, data: { attemptId: saved.id, state: saved.state } });
        return saved.state === 'STOP' ? stopOut(saved) : this.next(goal, saved);
      }
      case 'STAGE': {
        const done = attempt.steps.find((s) => s.name === 'stage-deploy');
        if (!done) return this.issue(goal, attempt, 'deploy', 'stage-deploy', attempt.environment!, 'stage');
        if (done.status === 'succeeded') {
          const verified = attempt.steps.find((s) => s.name === 'stage-verify')?.status === 'succeeded';
          if (!verified) return { attempt, directive: { kind: 'stage', attemptId: attempt.id, environment: attempt.environment!, operations: ['smoke', 'health', 'recovery-readiness'], narration: 'Staging deployed. Verify smoke, applicable health and recovery readiness on THIS candidate, then report stage-verify succeeded (aidlc release report --step stage-verify --status succeeded).' } };
          if (attempt.target === 'staging') {
            const finished = transitionRelease(attempt, 'DONE', now, this.guards(goal, attempt, { stagingVerified: true }));
            const saved = this.save(finished);
            this.journal(goal.id).append({ type: 'RELEASE_STATE', goalId: goal.id, generation: goal.generation, data: { attemptId: saved.id, state: saved.state, disposition: saved.disposition } });
            return { attempt: saved, directive: { kind: 'done', attemptId: saved.id, disposition: saved.disposition, narration: 'Staging goal finished after staging verification; CHECKPOINT/APPLY are never entered automatically.' } };
          }
          const cp = transitionRelease(attempt, 'CHECKPOINT', now, this.guards(goal, attempt, { stagingVerified: true }));
          const saved = this.save(cp);
          return saved.state === 'STOP' ? stopOut(saved) : this.next(goal, saved);
        }
        if (done.status === 'failed') {
          const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-health', 'staging deployment failed', 'diagnose; a repair card re-enters candidate preparation', { at: now, global: false }), disposition: 'failed' });
          return stopOut(stopped);
        }
        return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: 'stage-deploy', narration: 'Staging deployment issued; awaiting provider status.' } };
      }
      case 'CHECKPOINT': {
        // The checkpoint binds to the PRODUCTION environment, never to the staging one used so far.
        const prodEnv = this.defaultEnvironment('production');
        const prodAttempt = { ...attempt, environment: prodEnv };
        const guard = this.guards(goal, prodAttempt, { stagingVerified: true });
        const stopRec = assertReleaseTransition(prodAttempt, 'APPLY', guard);
        if (!stopRec) {
          const applied = transitionRelease(prodAttempt, 'APPLY', now, guard);
          const saved = this.save(applied);
          this.journal(goal.id).append({ type: 'AUTHORIZATION_CHECKED', goalId: goal.id, generation: goal.generation, data: { attemptId: saved.id, kind: 'production', environment: prodEnv, matched: true } });
          return this.next(goal, saved);
        }
        const packet = approvalPacket('production', guard.effects ?? {}, { evidence: attempt.evidence.map((e) => e.id), dataSteps: attempt.steps.map((s) => `${s.name}:${s.status}`), recoveryPlan: this.binding('recover') ? `bound operation ${this.binding('recover')!.command.join(' ')}` : 'NOT CONFIGURED' });
        this.journal(goal.id).append({ type: 'AUTHORIZATION_CHECKED', goalId: goal.id, generation: goal.generation, data: { attemptId: attempt.id, kind: 'production', environment: prodEnv, matched: false, detail: stopRec.detail } });
        return { attempt, directive: { kind: 'checkpoint', attemptId: attempt.id, packet, narration: `Present the exact candidate, environment (${prodEnv}), changes, evidence, data steps and recovery plan; wait for matching explicit production authority (aidlc authorize production --env ${prodEnv} --candidate <digest> --ops ${this.plannedRoles(prodAttempt).join(',')}). ${stopRec.detail}` } };
      }
      case 'APPLY': {
        const done = attempt.steps.find((s) => s.name === 'apply-deploy');
        if (!done) return this.issue(goal, attempt, 'deploy', 'apply-deploy', attempt.environment!, 'apply');
        if (done.status === 'succeeded') {
          const windowMs = this.healthWindowMs();
          const observing = transitionRelease({ ...attempt, healthWindow: { from: now, to: addMs(now, windowMs) } }, 'OBSERVE', now, this.guards(goal, attempt));
          const saved = this.save(observing);
          return this.next(goal, saved);
        }
        if (done.status === 'failed') return this.recoverOrStop(goal, attempt, 'production apply failed');
        return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: 'apply-deploy', narration: 'Production deployment issued; awaiting provider status.' } };
      }
      case 'OBSERVE': {
        const window = attempt.healthWindow ?? { from: now, to: addMs(now, this.healthWindowMs()) };
        const signals = this.signals(attempt).map((s) => ({ ...s }));
        const health = evaluateHealth(signals, window, now, { candidate: attempt.candidateDigest, environment: attempt.environment });
        this.journal(goal.id).append({ type: 'HEALTH_EVALUATED', goalId: goal.id, generation: goal.generation, data: { attemptId: attempt.id, result: health.result, signals: health.signals.map((s) => `${s.name}=${s.result}`) } });
        const elapsed = windowElapsed(window, now);
        const withinMaxWait = Date.parse(now) < Date.parse(addMs(window.to, this.maxWaitMs()));
        const nextState = nextAfterObserve(health.result, elapsed, withinMaxWait);
        const withHealth = { ...attempt, healthResult: health.result, healthWindow: window };
        if (nextState === 'WAIT') return { attempt: this.save(withHealth), directive: { kind: 'observe', attemptId: attempt.id, window, result: health.result, narration: health.result === 'INSUFFICIENT_DATA' ? 'Insufficient telemetry: gather allowed evidence within the bound; missing data never becomes PASS.' : 'Observation window still open.' } };
        if (nextState === 'CLOSE') {
          const closed = transitionRelease(withHealth, 'CLOSE', now, this.guards(goal, attempt, { health: 'PASS' }));
          return { attempt: this.save(closed), directive: { kind: 'close', attemptId: attempt.id, narration: 'Health PASS over the declared window; preserve candidate/operation/health/authorization evidence and finish release metadata.' } };
        }
        if (nextState === 'RECOVER') return this.recoverOrStop(goal, withHealth, 'health BREACH');
        const stopped = this.save({ ...withHealth, state: 'STOP', stop: makeStop('release-health', 'insufficient health data within the maximum wait', 'the live environment may be stable but is unproven; hand off with the telemetry gap', { at: now, global: false }), disposition: 'failed' });
        return stopOut(stopped);
      }
      case 'RECOVER': {
        const done = attempt.steps.find((s) => s.name === 'recover');
        if (!done) return this.issue(goal, attempt, 'recover', 'recover', attempt.environment!, 'recover');
        if (done.status === 'succeeded') {
          const verified = attempt.steps.find((s) => s.name === 'recover-verify')?.status === 'succeeded';
          if (!verified) return { attempt, directive: { kind: 'recover', attemptId: attempt.id, narration: 'Recovery issued and completed; verify recovered environment/data health and report recover-verify succeeded.' } };
          const closed = transitionRelease(attempt, 'CLOSE', now, this.guards(goal, attempt, { recoveryVerified: true }));
          return { attempt: this.save({ ...closed, disposition: 'recovered' }), directive: { kind: 'close', attemptId: attempt.id, narration: 'Recovered (not delivered). Record the failed release disposition and close.' } };
        }
        if (done.status === 'failed') {
          const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-health', 'recovery procedure failed', 'escalate to the named owner with environment and data state', { at: now }), disposition: 'failed' });
          return stopOut(stopped);
        }
        return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: 'recover', narration: 'Recovery issued; awaiting provider status.' } };
      }
      case 'CLOSE': {
        const finished = transitionRelease(attempt, 'DONE', now, this.guards(goal, attempt, { closureComplete: true }));
        const saved = this.save(finished);
        this.journal(goal.id).append({ type: 'RELEASE_STATE', goalId: goal.id, generation: goal.generation, data: { attemptId: saved.id, state: 'DONE', disposition: saved.disposition } });
        if (attempt.environment) {
          try {
            const lease = this.leases.read(resourceKeys.environment(attempt.environment));
            if (lease) this.leases.release(resourceKeys.environment(attempt.environment), lease.generation);
          } catch {
            /* not ours */
          }
        }
        return { attempt: saved, directive: { kind: 'done', attemptId: saved.id, disposition: saved.disposition, narration: saved.disposition === 'recovered' ? 'Release attempt closed as recovered; the failed candidate was not delivered.' : `Release delivered to ${attempt.environment}; final state for ${attempt.target} is ${finalStateForTarget(attempt.target)}.` } };
      }
      case 'WAIT':
      default:
        return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: 'provider', narration: 'Waiting on one known operation.' } };
    }
  }

  private recoverOrStop(goal: Goal, attempt: ReleaseAttempt, cause: string): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    const now = this.clock();
    // Recovery authority covers the recovery procedure roles, not the deploy roles that failed.
    const base = this.guards(goal, attempt);
    const rec = transitionRelease(attempt, 'RECOVER', now, { ...base, recoveryApplicable: Boolean(this.binding('recover')), effects: { ...base.effects, operations: ['recover'] } });
    const saved = this.save(rec);
    this.journal(goal.id).append({ type: 'RELEASE_STATE', goalId: goal.id, generation: goal.generation, data: { attemptId: saved.id, state: saved.state, cause } });
    if (saved.state === 'STOP') return { attempt: saved, directive: { kind: 'stop', attemptId: saved.id, stop: saved.stop!, narration: `${cause}: ${saved.stop!.detail}` } };
    return this.next(goal, saved);
  }

  private issue(goal: Goal, attempt: ReleaseAttempt, role: 'deploy' | 'recover', stepName: string, environment: string, phase: string): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    const now = this.clock();
    const binding = this.binding(role);
    if (!binding) {
      const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-config', `operation ${role} is NOT CONFIGURED`, 'bind it in aidlc.ops.json', { at: now, global: false }), disposition: 'failed' });
      return { attempt: stopped, directive: { kind: 'stop', attemptId: stopped.id, stop: stopped.stop!, narration: stopped.stop!.detail } };
    }
    if (binding.triggersPublication && !goal.authorizations.some((a) => a.kind === 'production' && a.environment === environment)) {
      const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-auth', `${role} triggers external publication and no production authority names ${environment}`, 'authorize before any tag/release action that publishes', { at: now, global: false }) });
      return { attempt: stopped, directive: { kind: 'stop', attemptId: stopped.id, stop: stopped.stop!, narration: stopped.stop!.detail } };
    }
    const idempotencyKey = `${attempt.id}:${stepName}:${attempt.candidateDigest ?? 'na'}`;
    const intent = this.ops.recordIntent({ kind: role === 'deploy' ? 'deploy' : 'rollback', goalId: goal.id, releaseAttempt: attempt.id, target: environment, candidateDigest: attempt.candidateDigest, idempotencyKey, ownerGeneration: attempt.ownerGeneration ?? 0, timeoutMs: binding.timeoutMs, effects: binding.effects, externallyVisible: binding.externallyVisible });
    this.journal(goal.id).append({ type: 'OPERATION_INTENT', goalId: goal.id, generation: goal.generation, data: { operationId: intent.id, kind: intent.kind, target: environment, step: stepName } });
    const exec = executeOperation(binding, environment, { runner: this.runner, idempotencyKey, cwd: this.repo.mainRoot });
    this.ops.markIssued(intent.id, exec.providerOperationId, now);
    this.journal(goal.id).append({ type: 'OPERATION_ISSUED', goalId: goal.id, generation: goal.generation, data: { operationId: intent.id, providerOperationId: exec.providerOperationId, status: exec.status } });
    let status: 'succeeded' | 'failed' | 'UNKNOWN' | 'running';
    if (exec.status === 'succeeded') status = 'succeeded';
    else if (exec.status === 'failed') status = 'failed';
    else if (exec.status === 'issued') status = 'running';
    else status = 'UNKNOWN';
    if (status === 'running') this.ops.markRunning(intent.id, now);
    else this.ops.markResult(intent.id, status, { error: exec.detail }, now);
    this.journal(goal.id).append({ type: 'OPERATION_RESULT', goalId: goal.id, generation: goal.generation, data: { operationId: intent.id, status } });
    const steps = [...attempt.steps.filter((s) => s.name !== stepName), { name: stepName, status, operationId: intent.id }];
    const saved = this.save({ ...attempt, steps, operations: [...attempt.operations, intent.id], evidence: [...attempt.evidence, { id: `op-${intent.id}`, kind: role === 'deploy' ? ('deploy' as const) : ('recovery' as const), createdAt: now, candidateDigest: attempt.candidateDigest, environment, note: exec.detail }] });
    if (status === 'succeeded' || status === 'failed') return this.next(goal, saved);
    return { attempt: saved, directive: { kind: 'wait', attemptId: saved.id, on: `${phase}:${intent.id}`, narration: `${role} issued (${exec.detail}); exit zero is not completion. Reconcile via provider status lookup.` } };
  }

  /** Record an externally observed step result (e.g. stage-verify, recover-verify, package proof). */
  reportStep(goal: Goal, attempt: ReleaseAttempt, stepName: string, status: 'succeeded' | 'failed' | 'UNKNOWN', evidence?: string): ReleaseAttempt {
    const now = this.clock();
    const steps = [...attempt.steps.filter((s) => s.name !== stepName), { name: stepName, status }];
    const ev = evidence ? [...attempt.evidence, { id: `${stepName}-${now}`, kind: 'artifact' as const, createdAt: now, candidateDigest: attempt.candidateDigest, environment: attempt.environment, note: evidence }] : attempt.evidence;
    this.journal(goal.id).append({ type: 'EVIDENCE_RETAINED', goalId: goal.id, generation: goal.generation, data: { attemptId: attempt.id, step: stepName, status } });
    let next: ReleaseAttempt = { ...attempt, steps, evidence: ev };
    if (attempt.target === 'package' && stepName === 'package-run-proof' && status === 'succeeded') {
      next = transitionRelease(next, 'DONE', now, this.guards(goal, next, { packageRunProof: true }));
    }
    return this.save(next);
  }

  setCandidate(goal: Goal, attempt: ReleaseAttempt, candidate: { candidateDigest: string; sourceSha: string; configDigest?: string; environment?: string; database?: string }): ReleaseAttempt {
    if (attempt.state !== 'PREPARE') throw new Error('candidate can only be set in PREPARE; a changed candidate requires a new attempt and fresh authority');
    this.journal(goal.id).append({ type: 'NOTE', goalId: goal.id, generation: goal.generation, data: { attemptId: attempt.id, candidate } });
    return this.save({ ...attempt, ...candidate });
  }

  /** Operation ROLES the attempt will exercise in its next mutating state (what an authorization must cover). */
  private plannedRoles(attempt: ReleaseAttempt): string[] {
    switch (attempt.target) {
      case 'package':
        return ['build', 'package'];
      case 'staging':
        return ['deploy'];
      case 'production':
      case 'migration':
        return attempt.database ? ['deploy', 'migration-apply'] : ['deploy'];
      default:
        return [];
    }
  }

  private defaultEnvironment(kind: 'staging' | 'production', fallback?: string): string {
    if (fallback) return fallback;
    if (this.opsLoad.status === 'configured') {
      const envs = Object.entries(this.opsLoad.config.environments);
      const hit = envs.find(([, e]) => (kind === 'production' ? e.production : !e.production));
      if (hit) return hit[0];
    }
    return kind;
  }

  private healthWindowMs(): number {
    if (this.opsLoad.status === 'configured' && this.opsLoad.config.health.length) return Math.max(...this.opsLoad.config.health.map((h) => h.windowMs));
    return 10 * 60 * 1000;
  }

  private maxWaitMs(): number {
    if (this.opsLoad.status === 'configured' && this.opsLoad.config.health.length) return Math.max(...this.opsLoad.config.health.map((h) => h.maxWaitMs));
    return 30 * 60 * 1000;
  }

  opsConfigured(): boolean {
    return this.opsLoad.status === 'configured' && existsSync(this.opsLoad.file);
  }

  static nextState(attempt: ReleaseAttempt): ReleaseState {
    return attempt.state;
  }
}
