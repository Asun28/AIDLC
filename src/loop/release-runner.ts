/**
 * Release runner (plan v5 LC3-LC10, Q16-Q22).
 *
 * Drives one ReleaseAttempt through PREPARE -> STAGE -> CHECKPOINT -> APPLY -> OBSERVE ->
 * CLOSE -> DONE using bound provider operations only. Every external mutation records intent
 * first and is reconciled by provider status lookup; health is measured, never inferred; a
 * breach routes to RECOVER only with matching recovery authority and reports `recovered`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { assertReleaseTransition, finalStateForTarget, nextAfterObserve, transitionRelease, type ReleaseGuards } from '../core/release-machine.ts';
import { evaluateHealth, windowElapsed } from '../core/health.ts';
import { makeStop } from '../core/stop.ts';
import { approvalPacket } from '../core/authorization.ts';
import { OperationRecord, ReleaseAttempt, addMs, type Goal, type HealthSignal, type Lease, type ReleaseState } from '../core/types.ts';
import { executeOperation, healthReportOf, healthSignals, loadDeliveryOps, lookupOperation, operationCwd, resolveRoles, type OpsLoad, type OperationBinding } from '../delivery/ops.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import { LeaseStore, resourceKeys } from '../coordination/lease.ts';
import { Journal, currentActor } from '../state/journal.ts';
import { GoalStore } from '../state/goal-store.ts';
import { StoreError } from '../state/store.ts';
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
  /** Health signal source. Without one, OBSERVE runs the first bound `health` operation once per evaluation and reads its last non-blank stdout line (`healthReportOf`, `healthSignals`); unsuccessful execution receipts and invalid reports produce unavailable signals, and runner exceptions propagate. */
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

/** Whether `directory` is an existing directory; a path that is absent, a file or under a file (ENOTDIR on POSIX) is not, and none throws. */
function isDirectory(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

/** The release steps `issue` records an operation for, and the kind of that operation. */
const RELEASE_STEP_KINDS = { 'stage-deploy': 'deploy', 'apply-deploy': 'deploy', recover: 'rollback' } as const;
type ReleaseStep = keyof typeof RELEASE_STEP_KINDS;

/** The idempotency key `issue` gives the operation of a release step; `na` stands for an absent candidate digest. */
function releaseStepKey(attempt: ReleaseAttempt, step: ReleaseStep): string {
  return `${attempt.id}:${step}:${attempt.candidateDigest ?? 'na'}`;
}

/**
 * The association of a ledger record with a release attempt. Without `step`: the record belongs to the attempt when it is of
 * the attempt's goal and names the attempt as its `releaseAttempt` or carries one of the attempt's release-step keys. With
 * `step`: the record matches that step when it is of the attempt's goal and carries that step's key, whatever its
 * `releaseAttempt`. Keys compare as exact strings; the provider id is never read (an `intended` record has none).
 */
export function releaseOperationOf(record: OperationRecord, attempt: ReleaseAttempt, step?: ReleaseStep): boolean {
  if (record.goalId !== attempt.goalId) return false;
  if (step) return record.idempotencyKey === releaseStepKey(attempt, step);
  return record.releaseAttempt === attempt.id || (Object.keys(RELEASE_STEP_KINDS) as ReleaseStep[]).some((s) => record.idempotencyKey === releaseStepKey(attempt, s));
}

/** The statuses `aidlc release report` records, as exact strings. */
function isReportStatus(status: string): status is 'succeeded' | 'failed' | 'UNKNOWN' {
  return status === 'succeeded' || status === 'failed' || status === 'UNKNOWN';
}

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
    this.signals = deps.signals ?? ((attempt) => this.observedSignals(attempt));
  }

  /**
   * The default signal source (card T0-HEALTH-OP-SIGNALS). With declared signals, a `health` binding, an attempt environment and
   * an existing binding directory, runs the first `health` binding once, with no idempotency key and no ledger record, lease or
   * journal event, and reads the report of a succeeded run that names the attempt's environment (by its lease file) and
   * candidate; otherwise every declared signal is unavailable. With no declared signal: none, and no command. Catches nothing.
   */
  private observedSignals(attempt: ReleaseAttempt): HealthSignal[] {
    if (this.opsLoad.status !== 'configured' || !this.opsLoad.config.health.length) return [];
    const declared = this.opsLoad.config.health;
    const binding = this.binding('health');
    if (!binding || !attempt.environment || !isDirectory(operationCwd(binding, this.repo.mainRoot))) return healthSignals(declared, undefined);
    const exec = executeOperation(binding, attempt.environment, { root: this.repo.mainRoot, runner: this.runner });
    const report = exec.status === 'succeeded' ? healthReportOf(exec.receipt.stdout) : undefined;
    const leaseOf = (name: string) => this.leases.file(resourceKeys.environment(name));
    const accepted = report && leaseOf(report.environment) === leaseOf(attempt.environment) && report.candidate === attempt.candidateDigest;
    return healthSignals(declared, accepted ? report : undefined);
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

  /**
   * The production checkpoint of an attempt, computed and nothing else: no save, no journal event, no operation. It binds
   * to the PRODUCTION environment, never to the staging one used so far. `stopRec` is absent once a recorded authority
   * matches the packet; `next` is the one caller that then applies.
   */
  private checkpoint(goal: Goal, attempt: ReleaseAttempt) {
    const prodEnv = this.defaultEnvironment('production');
    const prodAttempt = { ...attempt, environment: prodEnv };
    const guard = this.guards(goal, prodAttempt, { stagingVerified: true });
    const stopRec = assertReleaseTransition(prodAttempt, 'APPLY', guard);
    const recover = this.binding('recover');
    const packet = approvalPacket('production', guard.effects ?? {}, { evidence: attempt.evidence.map((e) => e.id), dataSteps: attempt.steps.map((s) => `${s.name}:${s.status}`), recoveryPlan: recover ? `bound operation ${recover.command.join(' ')}` : 'NOT CONFIGURED' });
    const narration = stopRec
      ? `Present the exact candidate, environment (${prodEnv}), changes, evidence, data steps and recovery plan; wait for matching explicit production authority (aidlc authorize production --env ${prodEnv} --candidate <digest> --ops ${this.plannedRoles(prodAttempt).join(',')}). ${stopRec.detail}`
      : `Matching production authority is recorded for this candidate, environment (${prodEnv}) and operations; \`aidlc release next ${attempt.id}\` applies it.`;
    const directive: ReleaseDirective & { kind: 'checkpoint' } = { kind: 'checkpoint', attemptId: attempt.id, packet, narration };
    return { prodEnv, prodAttempt, guard, stopRec, directive };
  }

  /** The approval packet of an attempt at CHECKPOINT, read only (`aidlc release packet`); undefined in every other state. */
  checkpointPacket(goal: Goal, attempt: ReleaseAttempt): (ReleaseDirective & { kind: 'checkpoint' }) | undefined {
    return attempt.state === 'CHECKPOINT' ? this.checkpoint(goal, attempt).directive : undefined;
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

  /** One bounded step for the attempt; every return passes the lease cleanup of a terminal attempt. */
  next(goal: Goal, attempt: ReleaseAttempt): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    return this.releaseLeases(this.step(goal, attempt));
  }

  /** Whether `lease` is this session's and host's unreleased lease for this attempt (`release:<attemptId>`), expired or not. */
  private ownLease(lease: Lease | undefined, attempt: ReleaseAttempt): lease is Lease {
    const actor = currentActor();
    return Boolean(lease && !lease.released && lease.operation === `release:${attempt.id}` && lease.owner.session === actor.session && lease.owner.host === actor.host);
  }

  /** Runs `body` inside the section of the attempt (`release-attempt:<attemptId>`), whose record is never written. */
  private attemptSection(attempt: ReleaseAttempt, body: () => void): void {
    this.leases.update(`release-attempt:${attempt.id}`, (current) => {
      body();
      return current;
    });
  }

  /**
   * Every record of the operation ledger, read strictly: each listed `.json` entry is read and parsed, and one that cannot be
   * fails the read with a store error (`OperationLedger.list` drops an entry `existsSync` cannot see). A directory that does not
   * exist (ENOENT) is an empty ledger; any other listing error (ENOTDIR, EACCES) fails the read.
   */
  private strictLedger(): OperationRecord[] {
    const dir = this.ops.dir;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new StoreError('READ_FAILED', dir, (err as Error).message);
    }
    const records = names
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const file = path.join(dir, name);
        let parsed: unknown;
        try {
          parsed = JSON.parse(readFileSync(file, 'utf8'));
        } catch (err) {
          throw new StoreError(err instanceof SyntaxError ? 'MALFORMED_JSON' : 'READ_FAILED', file, (err as Error).message);
        }
        const result = OperationRecord.safeParse(parsed);
        if (!result.success) throw new StoreError('SCHEMA_VIOLATION', file, result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
        return result.data;
      });
    return records.sort((a, b) => a.intentRecordedAt.localeCompare(b.intentRecordedAt) || a.id.localeCompare(b.id));
  }

  /**
   * The exit of `next`. A terminal attempt releases each environment lease it claimed (its environment and the target of each of
   * its records). Inside the attempt section, for one key at a time, the key's lease section reads the ledger again and releases
   * the lease only when it is the attempt's own (`ownLease`) and no record of the attempt, and no record targeting that
   * environment, is intended, issued, running or UNKNOWN. `issue` admits a step under the same two sections. A section that throws
   * is named with the command that retries; a ledger that cannot be read keeps the leases not yet released.
   */
  private releaseLeases(out: { attempt: ReleaseAttempt; directive: ReleaseDirective }): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    const { attempt, directive } = out;
    if (attempt.state !== 'DONE' && attempt.state !== 'STOP') return out;
    const retry = `\`aidlc release next ${attempt.id}\``;
    const failed: string[] = [];
    const kept: string[] = [];
    let ledgerNote: string | undefined;
    const ledgerFailure = (err: unknown, leases: string) => `The operation ledger could not be read (${(err as Error).message}); ${leases} kept; ${retry} retries the release.`;
    const finish = () => {
      const notes = [
        ...(failed.length ? [`Environment lease release failed for ${failed.join(', ')}; ${retry} retries it.`] : []),
        ...(kept.length ? [`Environment leases kept while an operation of the attempt or on that environment is unresolved: ${kept.join('; ')}; ${retry} releases them once those operations are settled.`] : []),
        ...(ledgerNote ? [ledgerNote] : []),
      ];
      return notes.length ? { attempt, directive: { ...directive, narration: [directive.narration, ...notes].join(' ') } } : out;
    };
    let records: OperationRecord[];
    try {
      records = this.strictLedger().filter((o) => releaseOperationOf(o, attempt));
    } catch (err) {
      ledgerNote = ledgerFailure(err, 'every environment lease of the attempt');
      return finish();
    }
    // The keys come from this read; a record recorded later carries the key of a lease its `issue` held, which this loop leaves alone.
    // Two names of one lease file (letter case, `\` against `/`) are one lease, decided once under the first name.
    const leaseOf = (key: string) => this.leases.file(key);
    const byFile = new Map<string, string>();
    for (const name of [attempt.environment, ...records.map((o) => o.target)]) {
      const key = name ? resourceKeys.environment(name) : undefined;
      if (key && !byFile.has(leaseOf(key))) byFile.set(leaseOf(key), key);
    }
    const keys = [...byFile.values()];
    const releaseEach = (): void => {
      for (const [i, key] of keys.entries()) {
        let ledgerError: unknown;
        let open: OperationRecord[] = [];
        try {
          this.leases.update(key, (lease) => {
            if (!this.ownLease(lease, attempt)) return lease;
            try {
              open = this.strictLedger().filter((o) => ['intended', 'issued', 'running', 'UNKNOWN'].includes(o.status) && (releaseOperationOf(o, attempt) || leaseOf(resourceKeys.environment(o.target)) === leaseOf(key)));
            } catch (err) {
              ledgerError = err;
              return lease;
            }
            return open.length ? lease : { ...lease, released: true };
          });
        } catch (err) {
          failed.push(`${key} (${(err as Error).message})`);
        }
        if (ledgerError) {
          ledgerNote = ledgerFailure(ledgerError, `environment leases ${keys.slice(i).join(', ')}`);
          return;
        }
        if (open.length) kept.push(`${key} (${open.map((o) => `${o.id} ${o.status}`).join(', ')})`);
      }
    };
    if (!attempt.environment) releaseEach();
    else {
      try {
        this.attemptSection(attempt, releaseEach);
      } catch (err) {
        failed.push(`release-attempt:${attempt.id} (${(err as Error).message})`);
      }
    }
    return finish();
  }

  private step(goal: Goal, attempt: ReleaseAttempt): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    const now = this.clock();
    const stopOut = (a: ReleaseAttempt): { attempt: ReleaseAttempt; directive: ReleaseDirective } => ({ attempt: a, directive: { kind: 'stop', attemptId: a.id, stop: a.stop!, narration: a.stop!.detail } });
    if (attempt.state === 'STOP') return stopOut(attempt);
    if (attempt.state === 'DONE') return { attempt, directive: { kind: 'done', attemptId: attempt.id, disposition: attempt.disposition, narration: `Release attempt ${attempt.disposition}.` } };

    // Reconcile first.
    const unresolved = this.ops.list({ goalId: goal.id }).filter((o) => o.releaseAttempt === attempt.id && ['issued', 'running', 'UNKNOWN'].includes(o.status));
    for (const op of unresolved) {
      const binding = this.binding(op.kind === 'deploy' ? 'deploy' : op.kind === 'rollback' ? 'recover' : op.kind === 'migrate' ? 'migration-apply' : 'status');
      if (!binding || !op.providerOperationId) continue;
      const looked = lookupOperation(binding, op.providerOperationId, this.repo.mainRoot, this.runner);
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
    // An `intended` operation is one of unknown outcome: its command may have run before the process ended.
    const unknown = this.ops.list({ goalId: goal.id }).filter((o) => o.releaseAttempt === attempt.id && ['intended', 'UNKNOWN'].includes(o.status));
    if (unknown.length) return this.unknownOutcome(attempt, unknown, now);

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
        if (attempt.target === 'package' && attempt.steps.find((s) => s.name === 'package-run-proof')?.status === 'failed') {
          const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-health', 'package install/run proof failed', 'diagnose; a repair card re-enters candidate preparation', { at: now, global: false }), disposition: 'failed' });
          return stopOut(stopped);
        }
        const needs = this.prepareNeeds(attempt);
        if (attempt.target === 'package') {
          if (needs.length) return { attempt, directive: { kind: 'prepare', attemptId: attempt.id, needs, narration: 'Package target: build/package operations and an identified package are required; report with aidlc release report.' } };
          return { attempt, directive: { kind: 'prepare', attemptId: attempt.id, needs: ['install/run proof'], narration: `Run the package install/run proof and report it (aidlc release report ${attempt.id} --step package-run-proof --status succeeded).` } };
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
        return saved.state === 'STOP' ? stopOut(saved) : this.step(goal, saved);
      }
      case 'STAGE': {
        if (attempt.steps.find((s) => s.name === 'stage-verify')?.status === 'failed') {
          const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-health', 'staging verification failed', 'diagnose; a repair card re-enters candidate preparation', { at: now, global: false }), disposition: 'failed' });
          return stopOut(stopped);
        }
        const done = attempt.steps.find((s) => s.name === 'stage-deploy');
        if (!done) return this.issue(goal, attempt, 'deploy', 'stage-deploy', attempt.environment!, 'stage');
        if (done.status === 'succeeded') {
          const verified = attempt.steps.find((s) => s.name === 'stage-verify')?.status === 'succeeded';
          if (!verified) return { attempt, directive: { kind: 'stage', attemptId: attempt.id, environment: attempt.environment!, operations: ['smoke', 'health', 'recovery-readiness'], narration: `Staging deployed. Verify smoke, applicable health and recovery readiness on THIS candidate, then report stage-verify succeeded (aidlc release report ${attempt.id} --step stage-verify --status succeeded).` } };
          if (attempt.target === 'staging') {
            const finished = transitionRelease(attempt, 'DONE', now, this.guards(goal, attempt, { stagingVerified: true }));
            const saved = this.save(finished);
            this.journal(goal.id).append({ type: 'RELEASE_STATE', goalId: goal.id, generation: goal.generation, data: { attemptId: saved.id, state: saved.state, disposition: saved.disposition } });
            return { attempt: saved, directive: { kind: 'done', attemptId: saved.id, disposition: saved.disposition, narration: 'Staging goal finished after staging verification; CHECKPOINT/APPLY are never entered automatically.' } };
          }
          const cp = transitionRelease(attempt, 'CHECKPOINT', now, this.guards(goal, attempt, { stagingVerified: true }));
          const saved = this.save(cp);
          return saved.state === 'STOP' ? stopOut(saved) : this.step(goal, saved);
        }
        if (done.status === 'failed') {
          const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-health', 'staging deployment failed', 'diagnose; a repair card re-enters candidate preparation', { at: now, global: false }), disposition: 'failed' });
          return stopOut(stopped);
        }
        return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: 'stage-deploy', narration: 'Staging deployment issued; awaiting provider status.' } };
      }
      case 'CHECKPOINT': {
        const { prodEnv, prodAttempt, guard, stopRec, directive } = this.checkpoint(goal, attempt);
        if (!stopRec) {
          const applied = transitionRelease(prodAttempt, 'APPLY', now, guard);
          const saved = this.save(applied);
          this.journal(goal.id).append({ type: 'AUTHORIZATION_CHECKED', goalId: goal.id, generation: goal.generation, data: { attemptId: saved.id, kind: 'production', environment: prodEnv, matched: true } });
          return this.step(goal, saved);
        }
        this.journal(goal.id).append({ type: 'AUTHORIZATION_CHECKED', goalId: goal.id, generation: goal.generation, data: { attemptId: attempt.id, kind: 'production', environment: prodEnv, matched: false, detail: stopRec.detail } });
        return { attempt, directive };
      }
      case 'APPLY': {
        const done = attempt.steps.find((s) => s.name === 'apply-deploy');
        if (!done) return this.issue(goal, attempt, 'deploy', 'apply-deploy', attempt.environment!, 'apply');
        if (done.status === 'succeeded') {
          const windowMs = this.healthWindowMs();
          const observing = transitionRelease({ ...attempt, healthWindow: { from: now, to: addMs(now, windowMs) } }, 'OBSERVE', now, this.guards(goal, attempt));
          const saved = this.save(observing);
          return this.step(goal, saved);
        }
        if (done.status === 'failed') return this.recoverOrStop(goal, attempt, 'production apply failed');
        return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: 'apply-deploy', narration: 'Production deployment issued; awaiting provider status.' } };
      }
      case 'OBSERVE': {
        const window = attempt.healthWindow ?? { from: now, to: addMs(now, this.healthWindowMs()) };
        const signals = this.signals(attempt).map((s) => ({ ...s }));
        // Evaluated at the step's `now` and when the source has returned (the health command may have run for minutes); the
        // worse result of the two is kept, whichever way the clock moved. The window, the maximum wait, the transition and the STOP keep `now`.
        const returnedAt = this.clock();
        const bound = { candidate: attempt.candidateDigest, environment: attempt.environment };
        const early = evaluateHealth(signals, window, now, bound);
        const late = evaluateHealth(signals, window, returnedAt, bound);
        const severity = { PASS: 0, INSUFFICIENT_DATA: 1, BREACH: 2 } as const;
        const health = severity[early.result] > severity[late.result] ? early : late;
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
        if (attempt.steps.find((s) => s.name === 'recover-verify')?.status === 'failed') {
          const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-health', 'recovery verification failed', 'escalate to the named owner with environment and data state', { at: now }), disposition: 'failed' });
          return stopOut(stopped);
        }
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
    return this.step(goal, saved);
  }

  /**
   * Operations of the attempt whose outcome is not recorded: a wait naming the commands that record it until the
   * reconciliation grace (the attempt deadline plus 5 minutes) ends, then a saved STOP for time listing them.
   */
  private unknownOutcome(attempt: ReleaseAttempt, ops: OperationRecord[], now: string): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    const until = addMs(attempt.deadline, 5 * 60 * 1000);
    if (Date.parse(now) > Date.parse(until)) {
      const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('time', 'reconciliation grace expired with UNKNOWN release operations', 'hand off environment and operation ids to the named owner', { at: now, unresolvedOperations: ops.map((o) => o.id) }), disposition: 'failed' });
      return { attempt: stopped, directive: { kind: 'stop', attemptId: stopped.id, stop: stopped.stop!, narration: stopped.stop!.detail } };
    }
    const commands = ops.map((o) => `\`aidlc ops reconcile ${o.id} --status <succeeded|failed|cancelled|UNKNOWN>\` (or \`--status running --provider-id <id>\`)`).join('; ');
    const narration = `The outcome of release operation(s) ${ops.map((o) => o.id).join(', ')} is not recorded: the command of the step may still be running, and the step is not issued again until its outcome is recorded. Look the outcome up at the provider and record it with ${commands}, then run \`aidlc release next ${attempt.id}\`.`;
    return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: `unknown:${ops.map((o) => o.id).join(',')}`, until, narration } };
  }

  /**
   * A step whose operation the ledger already holds is never issued again: a record of another kind stops the attempt for
   * audit, a record without a recorded outcome waits, and otherwise the last terminal record becomes the step as `issue`
   * records an operation it ran.
   */
  private settleStep(goal: Goal, attempt: ReleaseAttempt, stepName: ReleaseStep, matches: OperationRecord[], now: string): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    const foreign = matches.find((o) => o.kind !== RELEASE_STEP_KINDS[stepName]);
    if (foreign) {
      const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('audit', `ledger operation ${foreign.id} of kind ${foreign.kind} carries the key of release step ${stepName}, whose operation is of kind ${RELEASE_STEP_KINDS[stepName]}`, 'reconcile the ledger record by hand; the release step is not issued again', { at: now, global: false }), disposition: 'failed' });
      return { attempt: stopped, directive: { kind: 'stop', attemptId: stopped.id, stop: stopped.stop!, narration: stopped.stop!.detail } };
    }
    const open = matches.filter((o) => ['intended', 'issued', 'running', 'UNKNOWN'].includes(o.status));
    if (open.length) return this.unknownOutcome(attempt, open, now);
    const op = matches[matches.length - 1]!;
    const steps = [...attempt.steps.filter((s) => s.name !== stepName), { name: stepName, status: op.status === 'succeeded' ? ('succeeded' as const) : ('failed' as const), operationId: op.id }];
    const operations = attempt.operations.includes(op.id) ? attempt.operations : [...attempt.operations, op.id];
    const evidence = attempt.evidence.some((e) => e.id === `op-${op.id}`) ? attempt.evidence : [...attempt.evidence, { id: `op-${op.id}`, kind: op.kind === 'deploy' ? ('deploy' as const) : ('recovery' as const), createdAt: now, candidateDigest: attempt.candidateDigest, environment: op.target, note: op.error }];
    return this.step(goal, this.save({ ...attempt, steps, operations, evidence }));
  }

  private issue(goal: Goal, attempt: ReleaseAttempt, role: 'deploy' | 'recover', stepName: ReleaseStep, environment: string, phase: string): { attempt: ReleaseAttempt; directive: ReleaseDirective } {
    const now = this.clock();
    const binding = this.binding(role);
    const unauthorizedPublication = binding?.triggersPublication && !goal.authorizations.some((a) => a.kind === 'production' && a.environment === environment);
    const idempotencyKey = releaseStepKey(attempt, stepName);
    const directory = binding ? operationCwd(binding, this.repo.mainRoot) : undefined;
    const directoryExists = directory !== undefined && isDirectory(directory);
    // Read the step's ledger records and, only when there is none, record the intent, in one section of the environment lease
    // lock taken inside the attempt section, and only while the attempt holds that lease (the exit of `next` releases it under
    // the same two sections); the sections write nothing, and the command runs only after them.
    let matches: OperationRecord[] = [];
    let recorded: OperationRecord | undefined;
    let held = false;
    const admit = (): void => {
      matches = this.ops.list().filter((o) => releaseOperationOf(o, attempt, stepName));
      if (!matches.length && binding && !unauthorizedPublication && directoryExists) recorded = this.ops.recordIntent({ kind: RELEASE_STEP_KINDS[stepName], goalId: goal.id, releaseAttempt: attempt.id, target: environment, candidateDigest: attempt.candidateDigest, idempotencyKey, ownerGeneration: attempt.ownerGeneration ?? 0, timeoutMs: binding.timeoutMs, effects: binding.effects, externallyVisible: binding.externallyVisible }, now);
    };
    if (!environment) {
      // No environment: the section and the intent as before this card (an absent name throws in `resourceKeys.environment`, an
      // empty one fails the record's `target` schema), with no attempt section and no ownership check.
      held = true;
      this.leases.update(resourceKeys.environment(environment), (lease) => {
        admit();
        return lease;
      });
    } else {
      this.attemptSection(attempt, () => {
        this.leases.update(resourceKeys.environment(environment), (lease) => {
          held = this.ownLease(lease, attempt);
          if (held) admit();
          return lease;
        });
      });
    }
    if (!held) return { attempt, directive: { kind: 'wait', attemptId: attempt.id, on: `environment:${environment}`, narration: `The environment lease of attempt ${attempt.id} on ${environment} was released before ${stepName} was recorded, so nothing was issued; run \`aidlc release next ${attempt.id}\`.` } };
    if (matches.length) return this.settleStep(goal, attempt, stepName, matches, now);
    if (!binding) {
      const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-config', `operation ${role} is NOT CONFIGURED`, 'bind it in aidlc.ops.json', { at: now, global: false }), disposition: 'failed' });
      return { attempt: stopped, directive: { kind: 'stop', attemptId: stopped.id, stop: stopped.stop!, narration: stopped.stop!.detail } };
    }
    if (unauthorizedPublication) {
      const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-auth', `${role} triggers external publication and no production authority names ${environment}`, 'authorize before any tag/release action that publishes', { at: now, global: false }) });
      return { attempt: stopped, directive: { kind: 'stop', attemptId: stopped.id, stop: stopped.stop!, narration: stopped.stop!.detail } };
    }
    if (!directoryExists) {
      const stopped = this.save({ ...attempt, state: 'STOP', stop: makeStop('release-config', `operation ${role} runs in ${directory}, which is not an existing directory`, 'create the directory or correct cwd in aidlc.ops.json', { at: now, global: false }), disposition: 'failed' });
      return { attempt: stopped, directive: { kind: 'stop', attemptId: stopped.id, stop: stopped.stop!, narration: stopped.stop!.detail } };
    }
    const intent = recorded!;
    this.journal(goal.id).append({ type: 'OPERATION_INTENT', goalId: goal.id, generation: goal.generation, data: { operationId: intent.id, kind: intent.kind, target: environment, step: stepName } });
    const exec = executeOperation(binding, environment, { root: this.repo.mainRoot, runner: this.runner, idempotencyKey });
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
    if (status === 'succeeded' || status === 'failed') return this.step(goal, saved);
    return { attempt: saved, directive: { kind: 'wait', attemptId: saved.id, on: `${phase}:${intent.id}`, narration: `${role} issued (${exec.detail}); exit zero is not completion. Reconcile via provider status lookup.` } };
  }

  /** What PREPARE still lacks: `next` asks for these, and for the package run proof only when the list is empty. */
  private prepareNeeds(attempt: ReleaseAttempt): string[] {
    const needs: string[] = [];
    if (!attempt.candidateDigest) needs.push('immutable candidate digest (aidlc release candidate)');
    if (!attempt.sourceSha) needs.push('source sha bound to the verified goal candidate');
    const target = attempt.target === 'development' || attempt.target === 'operations' ? 'package' : attempt.target;
    const roles = resolveRoles(this.opsLoad, target);
    for (const r of roles.roles) if (r.status === 'NOT CONFIGURED') needs.push(`operation ${r.role}: NOT CONFIGURED`);
    if (roles.problem) needs.push(roles.problem);
    return needs;
  }

  /** The manual step the attempt's state asks for, as `next` asks for it; a step stored as `failed` is final and no longer asked for. */
  private expectedSteps(attempt: ReleaseAttempt): string[] {
    const status = (name: string) => attempt.steps.find((s) => s.name === name)?.status;
    let name: string | undefined;
    if (attempt.state === 'PREPARE' && attempt.target === 'package' && this.prepareNeeds(attempt).length === 0) name = 'package-run-proof';
    else if (attempt.state === 'STAGE' && status('stage-deploy') === 'succeeded') name = 'stage-verify';
    else if (attempt.state === 'RECOVER' && status('recover') === 'succeeded') name = 'recover-verify';
    return name && status(name) !== 'failed' ? [name] : [];
  }

  /**
   * Record an externally observed manual step: only the step the attempt's state asks for, only as `succeeded`, `failed` or
   * `UNKNOWN`. A refusal throws before any journal event or save.
   */
  reportStep(goal: Goal, attempt: ReleaseAttempt, stepName: string, status: string, evidence?: string): ReleaseAttempt {
    const expected = this.expectedSteps(attempt);
    const refuse = (what: string) => new Error(`release attempt ${attempt.id} is in ${attempt.state} and ${expected.length ? `expects a report of ${expected.join(', ')}` : 'expects no step report'}: ${what}`);
    if (!expected.includes(stepName)) throw refuse(`step ${JSON.stringify(stepName)} is refused`);
    if (!isReportStatus(status)) throw refuse(`status ${JSON.stringify(status)} is refused; a step is reported succeeded, failed or UNKNOWN`);
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
