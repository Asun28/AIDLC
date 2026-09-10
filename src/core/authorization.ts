/**
 * Authorization binding (plan v5 §1, LC6).
 *
 * Approval is carried forward for unchanged routine work and never re-asked. Production
 * approval identifies the prepared artifact/configuration, environment, intended operations,
 * applicable migrations, evidence and recovery target. A changed candidate or material change
 * in effects requires fresh authority. A yes for development, the board or an earlier failed
 * candidate is insufficient. Recovery pre-authorization must be a real record naming
 * environment, eligible baseline, health trigger, procedure, migration compatibility, window
 * and owner; plain prose naming rollback is not such a record.
 */
import type { AuthorizationKind, AuthorizationRecord } from './types.ts';

export interface Effects {
  candidateDigest?: string;
  sourceSha?: string;
  configDigest?: string;
  environment?: string;
  operations?: string[];
  migrations?: string[];
  goalRevision?: number;
}

export interface AuthorityMatch {
  matched: boolean;
  record?: AuthorizationRecord;
  mismatches: string[];
}

function subset(required: string[] | undefined, granted: string[]): string[] {
  return (required ?? []).filter((r) => !granted.includes(r));
}

/** Check whether one record covers the requested effects. */
export function matchesAuthorization(record: AuthorizationRecord, kind: AuthorizationKind, effects: Effects, now: string): AuthorityMatch {
  const mismatches: string[] = [];
  if (record.kind !== kind) mismatches.push(`kind ${record.kind} != ${kind}`);
  if (record.expiresAt && Date.parse(record.expiresAt) < Date.parse(now)) mismatches.push('expired');
  if (kind === 'production' || kind === 'recovery') {
    if (effects.candidateDigest && record.candidateDigest !== effects.candidateDigest) mismatches.push('candidate digest differs');
    if (effects.environment && record.environment !== effects.environment) mismatches.push('environment differs');
    if (effects.configDigest && record.configDigest && record.configDigest !== effects.configDigest) mismatches.push('configuration digest differs');
    // A recovery record names its allowed procedure in `recovery.procedure`; an explicit operations list narrows it further.
    if (!(kind === 'recovery' && record.operations.length === 0 && record.recovery)) {
      const missingOps = subset(effects.operations, record.operations);
      if (missingOps.length) mismatches.push(`operations not covered: ${missingOps.join(',')}`);
    }
    const missingMig = subset(effects.migrations, record.migrations);
    if (missingMig.length) mismatches.push(`migrations not covered: ${missingMig.join(',')}`);
  }
  if (kind === 'staging') {
    // Staging runs within the already requested staging scope: a record may be scope-level (no candidate /
    // environment named) or bound; whatever it names must match.
    if (record.candidateDigest && effects.candidateDigest && record.candidateDigest !== effects.candidateDigest) mismatches.push('candidate digest differs');
    if (record.environment && effects.environment && record.environment !== effects.environment) mismatches.push('environment differs');
    if (record.operations.length) {
      const missingOps = subset(effects.operations, record.operations);
      if (missingOps.length) mismatches.push(`operations not covered: ${missingOps.join(',')}`);
    }
  }
  if (kind === 'plan-checkpoint' && effects.goalRevision !== undefined && record.goalRevision !== undefined && record.goalRevision !== effects.goalRevision) {
    mismatches.push(`plan approval is for revision ${record.goalRevision}, current is ${effects.goalRevision}`);
  }
  if (kind === 'recovery' && !record.recovery) mismatches.push('recovery record lacks the required specifics (baseline, trigger, procedure, compatibility, window, owner)');
  return { matched: mismatches.length === 0, record, mismatches };
}

export type AuthorityDecision =
  | { status: 'authorized'; record: AuthorizationRecord }
  | { status: 'missing'; stopReason: 'release-auth' | 'rollback-auth' | 'checkpoint' | 'auth'; detail: string; nearest?: AuthorityMatch };

/** Find matching authority among the goal's records; report the nearest mismatch otherwise. */
export function requireAuthority(records: AuthorizationRecord[], kind: AuthorizationKind, effects: Effects, now: string): AuthorityDecision {
  let nearest: AuthorityMatch | undefined;
  for (const record of records) {
    const m = matchesAuthorization(record, kind, effects, now);
    if (m.matched) return { status: 'authorized', record };
    if (record.kind === kind && (!nearest || m.mismatches.length < nearest.mismatches.length)) nearest = m;
  }
  const stopReason = kind === 'recovery' ? 'rollback-auth' : kind === 'production' || kind === 'staging' ? 'release-auth' : kind === 'plan-checkpoint' ? 'checkpoint' : 'auth';
  const detail = nearest
    ? `no ${kind} authority matches the prepared effects; nearest record ${nearest.record?.id} mismatches: ${nearest.mismatches.join('; ')}`
    : `no ${kind} authority recorded for these effects`;
  return { status: 'missing', stopReason, detail, nearest };
}

/** Compose the approval packet presented at a checkpoint (LC5 CHECKPOINT). */
export function approvalPacket(kind: AuthorizationKind, effects: Effects, extras: { changes?: string; evidence?: string[]; dataSteps?: string[]; recoveryPlan?: string }) {
  return {
    kind,
    candidateDigest: effects.candidateDigest,
    sourceSha: effects.sourceSha,
    configDigest: effects.configDigest,
    environment: effects.environment,
    operations: effects.operations ?? [],
    migrations: effects.migrations ?? [],
    changes: extras.changes ?? '',
    evidence: extras.evidence ?? [],
    dataSteps: extras.dataSteps ?? [],
    recoveryPlan: extras.recoveryPlan ?? '',
  };
}
