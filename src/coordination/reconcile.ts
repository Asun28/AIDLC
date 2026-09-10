/**
 * Operation reconciliation (plan v5 LC4, MS2, Q18).
 *
 * Before an external mutation its intent is recorded durably. After interruption or a lost
 * response the recorded operation and the actual target are queried before deciding what
 * remains. An exactly-once outcome cannot be assumed from an exit code: use a provider
 * idempotency key or unambiguous reconciliation; otherwise the unattended path stops.
 */
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { OperationRecord, nowIso, type OperationKind, type OperationStatus } from '../core/types.ts';
import { atomicWriteJson, listJsonFiles, readJson } from '../state/store.ts';

export interface OperationIntent {
  kind: OperationKind;
  goalId: string;
  cardId?: string;
  releaseAttempt?: string;
  target: string;
  candidateDigest?: string;
  idempotencyKey?: string;
  ownerGeneration: number;
  timeoutMs: number;
  effects?: string[];
  externallyVisible?: boolean;
}

export type LookupResult = { status: 'succeeded' | 'failed' | 'running' | 'cancelled'; providerOperationId?: string; evidenceRef?: string; error?: string } | { status: 'UNKNOWN'; detail: string };

export class OperationLedger {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  get(id: string): OperationRecord | undefined {
    return readJson(this.file(id), OperationRecord);
  }

  list(filter: Partial<Pick<OperationRecord, 'goalId' | 'cardId' | 'status' | 'kind'>> = {}): OperationRecord[] {
    return listJsonFiles(this.dir)
      .map((f) => readJson(f, OperationRecord))
      .filter((r): r is OperationRecord => Boolean(r))
      .filter((r) => Object.entries(filter).every(([k, v]) => v === undefined || (r as Record<string, unknown>)[k] === v))
      .sort((a, b) => a.intentRecordedAt.localeCompare(b.intentRecordedAt));
  }

  /** LC4: durably record intent BEFORE issuing. Returns the record whose id is the fencing token. */
  recordIntent(intent: OperationIntent, now: string = nowIso()): OperationRecord {
    const record: OperationRecord = {
      id: `op-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`,
      kind: intent.kind,
      goalId: intent.goalId,
      cardId: intent.cardId,
      releaseAttempt: intent.releaseAttempt,
      target: intent.target,
      candidateDigest: intent.candidateDigest,
      idempotencyKey: intent.idempotencyKey,
      ownerGeneration: intent.ownerGeneration,
      intentRecordedAt: now,
      status: 'intended',
      timeoutMs: intent.timeoutMs,
      effects: intent.effects ?? [],
      externallyVisible: intent.externallyVisible ?? true,
    };
    atomicWriteJson(this.file(record.id), record);
    return record;
  }

  markIssued(id: string, providerOperationId: string | undefined, now: string = nowIso()): OperationRecord {
    return this.update(id, { status: 'issued', issuedAt: now, providerOperationId });
  }

  markRunning(id: string, now: string = nowIso()): OperationRecord {
    return this.update(id, { status: 'running', issuedAt: this.get(id)?.issuedAt ?? now });
  }

  markResult(id: string, status: Exclude<OperationStatus, 'intended' | 'issued' | 'running'>, extra: { evidenceRef?: string; error?: string } = {}, now: string = nowIso()): OperationRecord {
    return this.update(id, { status, finishedAt: now, evidenceRef: extra.evidenceRef, error: extra.error });
  }

  /** Query recorded operation + actual target; UNKNOWN stays explicit when the provider cannot resolve it. */
  reconcile(id: string, lookup: (record: OperationRecord) => LookupResult, now: string = nowIso()): OperationRecord {
    const record = this.mustGet(id);
    if (['succeeded', 'failed', 'cancelled'].includes(record.status)) return record;
    const result = lookup(record);
    if (result.status === 'UNKNOWN') return this.update(id, { status: 'UNKNOWN', reconciledAt: now, error: result.detail });
    if (result.status === 'running') return this.update(id, { status: 'running', reconciledAt: now, providerOperationId: result.providerOperationId ?? record.providerOperationId });
    return this.update(id, { status: result.status, reconciledAt: now, finishedAt: now, providerOperationId: result.providerOperationId ?? record.providerOperationId, evidenceRef: result.evidenceRef, error: result.error });
  }

  /** Operations that must be reconciled before any new mutation is admitted. */
  unresolved(goalId: string, cardId?: string): OperationRecord[] {
    return this.list({ goalId }).filter((r) => (cardId ? r.cardId === cardId : true) && ['intended', 'issued', 'running', 'UNKNOWN'].includes(r.status));
  }

  /** Whether an equivalent externally visible operation already exists (idempotency guard). */
  findDuplicate(intent: OperationIntent): OperationRecord | undefined {
    return this.list({ goalId: intent.goalId, kind: intent.kind }).find(
      (r) => r.target === intent.target && r.candidateDigest === intent.candidateDigest && !['failed', 'cancelled'].includes(r.status) && (intent.idempotencyKey ? r.idempotencyKey === intent.idempotencyKey : true),
    );
  }

  private update(id: string, patch: Partial<OperationRecord>): OperationRecord {
    const record = this.mustGet(id);
    const next = OperationRecord.parse({ ...record, ...patch });
    atomicWriteJson(this.file(id), next);
    return next;
  }

  private mustGet(id: string): OperationRecord {
    const r = this.get(id);
    if (!r) throw new Error(`unknown operation ${id}`);
    return r;
  }
}

/** Decide whether an unattended external mutation may proceed (LC4). */
export function unattendedMutationAllowed(intent: OperationIntent, providerSupports: { idempotencyKey: boolean; statusLookup: boolean }): { allowed: boolean; detail: string } {
  // Fail closed: an intent that does not say it is internal is treated as externally visible.
  if (intent.externallyVisible === false) return { allowed: true, detail: 'no external effect' };
  if (providerSupports.idempotencyKey && intent.idempotencyKey) return { allowed: true, detail: 'provider idempotency key present' };
  if (providerSupports.statusLookup) return { allowed: true, detail: 'provider status lookup permits unambiguous reconciliation' };
  return { allowed: false, detail: 'neither idempotency key nor status lookup: exactly-once cannot be established; stop the unattended path' };
}
