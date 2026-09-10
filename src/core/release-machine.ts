/**
 * Target-specific release state machine (plan v5 LC5-LC7, LC10).
 *
 * PREPARE -> STAGE -> CHECKPOINT -> APPLY -> OBSERVE -> CLOSE -> DONE, with RECOVER/WAIT/STOP.
 * A package-only goal finishes after PREPARE; a staging goal after STAGE. CHECKPOINT and APPLY
 * are production steps and are never entered for a staging-only goal. Recovery is reported as
 * `recovered`, never as successful delivery of the failed candidate.
 */
import { requireAuthority, type Effects } from './authorization.ts';
import { makeStop } from './stop.ts';
import type { AuthorizationRecord, DeliveryTarget, HealthResult, ReleaseAttempt, ReleaseState, StopRecord } from './types.ts';

export const RELEASE_TRANSITIONS: Record<ReleaseState, ReleaseState[]> = {
  PREPARE: ['STAGE', 'DONE', 'WAIT', 'STOP'],
  STAGE: ['CHECKPOINT', 'DONE', 'RECOVER', 'WAIT', 'STOP'],
  CHECKPOINT: ['APPLY', 'WAIT', 'STOP'],
  APPLY: ['OBSERVE', 'RECOVER', 'WAIT', 'STOP'],
  OBSERVE: ['CLOSE', 'RECOVER', 'WAIT', 'STOP'],
  RECOVER: ['CLOSE', 'WAIT', 'STOP'],
  CLOSE: ['DONE', 'STOP'],
  WAIT: ['PREPARE', 'STAGE', 'CHECKPOINT', 'APPLY', 'OBSERVE', 'RECOVER', 'STOP'],
  DONE: [],
  STOP: [],
};

export class ReleaseTransitionError extends Error {
  constructor(from: ReleaseState, to: ReleaseState, reason: string) {
    super(`release transition ${from} -> ${to} refused: ${reason}`);
  }
}

export interface ReleaseGuards {
  /** Immutable candidate selected and required source/package evidence verified. */
  candidateVerified?: boolean;
  /** Package install/run proof (package target). */
  packageRunProof?: boolean;
  /** Staging smoke + health + recovery readiness verified on this candidate. */
  stagingVerified?: boolean;
  /** Required provider operations configured (LC3). */
  providersConfigured?: boolean;
  /** Authorization records to consult at CHECKPOINT/APPLY/RECOVER. */
  authorizations?: AuthorizationRecord[];
  effects?: Effects;
  now?: string;
  /** OBSERVE result. */
  health?: HealthResult;
  /** Recovery health verified after RECOVER. */
  recoveryVerified?: boolean;
  /** Evidence preserved and metadata finished. */
  closureComplete?: boolean;
  /** Recovery procedure applies to the current deployed/data state (LC10). */
  recoveryApplicable?: boolean;
}

export function finalStateForTarget(target: DeliveryTarget): ReleaseState {
  switch (target) {
    case 'package':
      return 'PREPARE';
    case 'staging':
      return 'STAGE';
    case 'production':
    case 'migration':
      return 'OBSERVE';
    default:
      return 'PREPARE';
  }
}

export function assertReleaseTransition(attempt: ReleaseAttempt, to: ReleaseState, guards: ReleaseGuards = {}): StopRecord | undefined {
  const from = attempt.state;
  if (from === 'DONE' || from === 'STOP') throw new ReleaseTransitionError(from, to, 'attempt is terminal');
  if (from !== to && !RELEASE_TRANSITIONS[from].includes(to)) throw new ReleaseTransitionError(from, to, 'not in the release diagram');
  const now = guards.now ?? attempt.updatedAt;
  switch (to) {
    case 'STAGE':
      if (!guards.candidateVerified) throw new ReleaseTransitionError(from, to, 'candidate not verified');
      if (attempt.target === 'package') throw new ReleaseTransitionError(from, to, 'package goal has no staging stage');
      if (!guards.providersConfigured) return makeStop('release-config', 'required staging provider operations are NOT CONFIGURED', 'bind deployment submission/status/health operations in docs/DELIVERY-OPS.md and aidlc ops config', { at: now, global: false });
      {
        const auth = requireAuthority(guards.authorizations ?? [], 'staging', guards.effects ?? {}, now);
        if (auth.status === 'missing') return makeStop('release-auth', auth.detail, 'staging runs only within the already requested staging scope; record the staging authorization', { at: now, global: false });
      }
      break;
    case 'CHECKPOINT':
      if (attempt.target !== 'production' && attempt.target !== 'migration') throw new ReleaseTransitionError(from, to, `CHECKPOINT is a production step; target is ${attempt.target}`);
      if (!guards.stagingVerified) throw new ReleaseTransitionError(from, to, 'staging verification and recovery readiness must precede the production checkpoint');
      break;
    case 'APPLY': {
      if (attempt.target !== 'production' && attempt.target !== 'migration') throw new ReleaseTransitionError(from, to, 'APPLY is a production step');
      const auth = requireAuthority(guards.authorizations ?? [], 'production', guards.effects ?? {}, now);
      if (auth.status === 'missing') return makeStop('release-auth', auth.detail, 'present the exact candidate/environment/operations/migrations/evidence/recovery packet and wait for matching explicit authority', { at: now, global: false });
      if (!guards.providersConfigured) return makeStop('release-config', 'required production provider operations are NOT CONFIGURED', 'bind the operations before unattended use', { at: now, global: false });
      break;
    }
    case 'OBSERVE':
      break;
    case 'CLOSE':
      if (from === 'OBSERVE') {
        if (guards.health !== 'PASS') throw new ReleaseTransitionError(from, to, `health ${guards.health ?? 'unknown'} is not PASS; BREACH -> RECOVER, INSUFFICIENT_DATA -> gather or STOP/release-health`);
      }
      if (from === 'RECOVER' && !guards.recoveryVerified) throw new ReleaseTransitionError(from, to, 'recovered environment/data state not verified');
      break;
    case 'RECOVER': {
      if (!guards.recoveryApplicable) return makeStop('rollback-auth', 'known recovery procedure does not apply to the current deployed/data state', 'establish deployed/data state and hand off with the exact condition', { at: now, global: false });
      const auth = requireAuthority(guards.authorizations ?? [], 'recovery', guards.effects ?? {}, now);
      if (auth.status === 'missing') return makeStop('rollback-auth', auth.detail, 'recovery needs a real pre-authorization record naming environment, baseline, trigger, procedure, compatibility, window and owner', { at: now, global: false });
      break;
    }
    case 'DONE':
      if (from === 'PREPARE') {
        if (attempt.target !== 'package') throw new ReleaseTransitionError(from, to, `only a package-only goal finishes after PREPARE (target ${attempt.target})`);
        if (!guards.packageRunProof) throw new ReleaseTransitionError(from, to, 'package install/run proof missing');
      }
      if (from === 'STAGE') {
        if (attempt.target !== 'staging') throw new ReleaseTransitionError(from, to, `only a staging goal finishes after STAGE (target ${attempt.target}); no automatic promotion`);
        if (!guards.stagingVerified) throw new ReleaseTransitionError(from, to, 'staging verification incomplete');
      }
      if (from === 'CLOSE' && !guards.closureComplete) throw new ReleaseTransitionError(from, to, 'release closure incomplete');
      break;
    default:
      break;
  }
  return undefined;
}

export function transitionRelease(attempt: ReleaseAttempt, to: ReleaseState, now: string, guards: ReleaseGuards = {}, stop?: StopRecord): ReleaseAttempt {
  const guardStop = assertReleaseTransition(attempt, to, { ...guards, now });
  if (guardStop) {
    return { ...attempt, state: 'STOP', stop: guardStop, disposition: attempt.disposition === 'pending' ? 'failed' : attempt.disposition, updatedAt: now };
  }
  const next: ReleaseAttempt = { ...attempt, state: to, updatedAt: now };
  if (to === 'STOP') {
    if (!stop) throw new ReleaseTransitionError(attempt.state, to, 'STOP requires a recorded reason');
    next.stop = stop;
    if (next.disposition === 'pending') next.disposition = 'failed';
  }
  if (to === 'RECOVER') next.disposition = 'recovered';
  if (to === 'DONE') {
    if (attempt.state === 'RECOVER' || attempt.disposition === 'recovered') next.disposition = 'recovered';
    else next.disposition = 'delivered';
  }
  if (to === 'CLOSE' && attempt.state === 'RECOVER') next.disposition = 'recovered';
  return next;
}

/** Health evaluation outcome to the next release state. */
export function nextAfterObserve(health: HealthResult, windowElapsed: boolean, withinMaxWait: boolean): ReleaseState {
  if (health === 'BREACH') return 'RECOVER';
  if (health === 'PASS' && windowElapsed) return 'CLOSE';
  if (health === 'INSUFFICIENT_DATA' && !withinMaxWait) return 'STOP';
  return 'WAIT';
}

/** Whether a tag/release action publishes externally and therefore belongs behind authorization. */
export function tagActionRequiresAuthority(action: { pushesTag?: boolean; createsRelease?: boolean; workflowTriggeredByTag?: boolean }): boolean {
  return Boolean(action.pushesTag || action.createsRelease || action.workflowTriggeredByTag);
}
