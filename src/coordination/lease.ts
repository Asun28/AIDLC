/**
 * Shared atomic claims with ownership generations and fencing (plan v5 MS1, MS2, MS5).
 *
 * A lease is a file created exclusively (`wx`) under the canonical state directory visible to
 * every participating local session. It records owner session/process identity, operation,
 * expiry/heartbeat and a monotonically advancing generation. Takeover after expiry requires
 * the caller to reconcile the old owner's in-flight operations first (MS2); the generation
 * then advances and any later write carrying the stale generation is fenced.
 *
 * This coordinates sessions on one machine sharing one state directory. It does not claim to
 * enforce an account limit across uncoordinated machines (MS5).
 */
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { ActorIdentity, Lease, addMs, nowIso } from '../core/types.ts';
import { atomicWriteJson, createExclusive, readJson, stableStringify } from '../state/store.ts';
import { currentActor } from '../state/journal.ts';
import { shortKey } from '../state/paths.ts';

export const DEFAULT_LEASE_TTL_MS = 10 * 60 * 1000;

export type ClaimResult =
  | { status: 'acquired'; lease: Lease }
  | { status: 'renewed'; lease: Lease }
  | { status: 'held'; lease: Lease; expired: false }
  | { status: 'expired'; lease: Lease; expired: true };

export interface ReconcileReport {
  /** The old owner's operations were verified finished (or explicitly recorded UNKNOWN). */
  reconciled: boolean;
  unresolvedOperations: string[];
  note?: string;
}

export class LeaseStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  file(resourceKey: string): string {
    return path.join(this.dir, `${shortKey(resourceKey)}.json`);
  }

  read(resourceKey: string): Lease | undefined {
    return readJson(this.file(resourceKey), Lease);
  }

  /** Ownership is per session on a host; pid/processStart identify the process instance for reconciliation only. */
  private sameOwner(a: ActorIdentity, b: ActorIdentity): boolean {
    return a.session === b.session && a.host === b.host;
  }

  /** Try to claim or renew. Never takes over silently. */
  claim(resourceKey: string, options: { ttlMs?: number; operation?: string; actor?: ActorIdentity; now?: string } = {}): ClaimResult {
    const actor = options.actor ?? currentActor();
    const now = options.now ?? nowIso();
    const ttl = options.ttlMs ?? DEFAULT_LEASE_TTL_MS;
    const file = this.file(resourceKey);
    const existing = this.read(resourceKey);
    if (!existing || existing.released) {
      const generation = existing ? existing.generation + 1 : 0;
      const lease: Lease = { resourceKey, generation, owner: actor, operation: options.operation, acquiredAt: now, heartbeatAt: now, expiresAt: addMs(now, ttl), released: false };
      if (existing) {
        // released lease file exists: replace atomically
        atomicWriteJson(file, lease);
        return { status: 'acquired', lease };
      }
      if (createExclusive(file, stableStringify(lease) + '\n')) return { status: 'acquired', lease };
      // Lost the race: read what won.
      const won = this.read(resourceKey);
      if (!won) throw new Error(`lease race on ${resourceKey}: file vanished`);
      return this.sameOwner(won.owner, actor) ? { status: 'renewed', lease: won } : { status: 'held', lease: won, expired: false };
    }
    if (this.sameOwner(existing.owner, actor)) {
      const lease: Lease = { ...existing, operation: options.operation ?? existing.operation, heartbeatAt: now, expiresAt: addMs(now, ttl) };
      atomicWriteJson(file, lease);
      return { status: 'renewed', lease };
    }
    const expired = Date.parse(existing.expiresAt) < Date.parse(now);
    return expired ? { status: 'expired', lease: existing, expired: true } : { status: 'held', lease: existing, expired: false };
  }

  /** MS2: take over an expired lease only after reconciliation of the old owner's effects. */
  takeover(resourceKey: string, reconcile: (old: Lease) => ReconcileReport, options: { ttlMs?: number; operation?: string; actor?: ActorIdentity; now?: string } = {}): { lease: Lease; report: ReconcileReport } {
    const actor = options.actor ?? currentActor();
    const now = options.now ?? nowIso();
    const existing = this.read(resourceKey);
    if (!existing) throw new Error(`no lease to take over for ${resourceKey}`);
    if (!existing.released && Date.parse(existing.expiresAt) >= Date.parse(now) && !this.sameOwner(existing.owner, actor)) {
      throw new Error(`lease for ${resourceKey} is still held by ${existing.owner.session} until ${existing.expiresAt}; expiry alone does not prove the owner stopped`);
    }
    const report = reconcile(existing);
    if (!report.reconciled) {
      throw new Error(`takeover refused: old owner effects not reconciled (${report.unresolvedOperations.join(',') || report.note || 'unknown'})`);
    }
    const lease: Lease = {
      resourceKey,
      generation: existing.generation + 1,
      owner: actor,
      operation: options.operation,
      acquiredAt: now,
      heartbeatAt: now,
      expiresAt: addMs(now, options.ttlMs ?? DEFAULT_LEASE_TTL_MS),
      released: false,
    };
    atomicWriteJson(this.file(resourceKey), lease);
    return { lease, report };
  }

  heartbeat(resourceKey: string, generation: number, options: { ttlMs?: number; actor?: ActorIdentity; now?: string } = {}): Lease {
    const actor = options.actor ?? currentActor();
    const now = options.now ?? nowIso();
    const existing = this.read(resourceKey);
    if (!existing) throw new FencedError(resourceKey, generation, 'lease missing');
    if (existing.generation !== generation || !this.sameOwner(existing.owner, actor)) throw new FencedError(resourceKey, generation, `current generation ${existing.generation} owned by ${existing.owner.session}`);
    const lease: Lease = { ...existing, heartbeatAt: now, expiresAt: addMs(now, options.ttlMs ?? DEFAULT_LEASE_TTL_MS) };
    atomicWriteJson(this.file(resourceKey), lease);
    return lease;
  }

  release(resourceKey: string, generation: number, actor: ActorIdentity = currentActor()): void {
    const existing = this.read(resourceKey);
    if (!existing) return;
    if (existing.generation !== generation || !this.sameOwner(existing.owner, actor)) throw new FencedError(resourceKey, generation, 'cannot release a lease you do not own');
    atomicWriteJson(this.file(resourceKey), { ...existing, released: true });
  }

  /** Fence check: a mutation may commit only under the current generation of a live lease. */
  fence(resourceKey: string, generation: number, actor: ActorIdentity = currentActor(), now: string = nowIso()): void {
    const existing = this.read(resourceKey);
    if (!existing || existing.released) throw new FencedError(resourceKey, generation, 'no live lease');
    if (existing.generation !== generation) throw new FencedError(resourceKey, generation, `stale generation; current is ${existing.generation}`);
    if (!this.sameOwner(existing.owner, actor)) throw new FencedError(resourceKey, generation, `owned by ${existing.owner.session}`);
    if (Date.parse(existing.expiresAt) < Date.parse(now)) throw new FencedError(resourceKey, generation, 'lease expired; renew or reconcile before mutating');
  }

  isCurrent(resourceKey: string, generation: number): boolean {
    const existing = this.read(resourceKey);
    return Boolean(existing && !existing.released && existing.generation === generation);
  }

  list(): Lease[] {
    if (!existsSync(this.dir)) return [];
    const out: Lease[] = [];
    for (const name of readdirSyncSafe(this.dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = Lease.safeParse(JSON.parse(readFileSync(path.join(this.dir, name), 'utf8')));
        if (parsed.success) out.push(parsed.data);
      } catch {
        /* skip malformed */
      }
    }
    return out;
  }

  /** Remove a released lease file (housekeeping only). */
  purgeReleased(resourceKey: string): void {
    const existing = this.read(resourceKey);
    if (existing?.released) unlinkSync(this.file(resourceKey));
  }
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export class FencedError extends Error {
  readonly resourceKey: string;
  readonly generation: number;
  constructor(resourceKey: string, generation: number, detail: string) {
    super(`fenced: ${resourceKey}@${generation}: ${detail}`);
    this.resourceKey = resourceKey;
    this.generation = generation;
  }
}

/** Resource keys are scoped by canonical repository/resource identity (MS1), never by window path. */
export const resourceKeys = {
  goal: (repoKey: string, goalId: string) => `goal:${repoKey}:${goalId}`,
  card: (repoKey: string, cardId: string) => `card:${repoKey}:${cardId.toLowerCase()}`,
  integration: (repoKey: string, base: string) => `integration:${repoKey}:${base.toLowerCase()}`,
  environment: (env: string) => `env:${env.toLowerCase()}`,
  database: (db: string) => `db:${db.toLowerCase()}`,
  reviewPool: (pool: string) => `review-pool:${pool.toLowerCase()}`,
  writerCap: (hostKey: string) => `writers:${hostKey}`,
};
