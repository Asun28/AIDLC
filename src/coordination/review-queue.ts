/**
 * Shared provider/account review admission queue (plan v5 MS3, MS4, Q24).
 *
 * One active formal review per known account pool across participating windows by default.
 * Requests are persisted outside worktrees and deduplicated by repository + candidate digest
 * + base + policy version + reviewer identity; a matching running request is joined. Admission
 * follows persisted queue order with deadlines; retries cannot jump the queue. Waiting for
 * quota holds no active slot. A lost response must be looked up before its slot is released.
 */
import path from 'node:path';
import { ActorIdentity, ReviewPool, ReviewRequest, nowIso } from '../core/types.ts';
import { reviewRequestKey } from '../core/review-policy.ts';
import { atomicWriteJson, listJsonFiles, readJson } from '../state/store.ts';
import { currentActor } from '../state/journal.ts';
import { shortKey } from '../state/paths.ts';

export interface EnqueueInput {
  pool: string;
  repository: string;
  candidateDigest: string;
  base: string;
  policyVersion: string;
  reviewer: string;
  requester: string;
  deadline: string;
  now?: string;
}

export type EnqueueResult = { status: 'enqueued'; request: ReviewRequest } | { status: 'joined'; request: ReviewRequest } | { status: 'completed'; request: ReviewRequest };

export type AdmitResult = { status: 'admitted'; request: ReviewRequest } | { status: 'busy'; active: string[] } | { status: 'empty' } | { status: 'reset-pending'; resetAt: string } | { status: 'behind'; ahead: { key: string; requesters: string[] } };

export class ReviewQueue {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private poolFile(pool: string): string {
    return path.join(this.dir, `_pool-${shortKey(pool)}.json`);
  }

  private requestFile(key: string): string {
    return path.join(this.dir, `${shortKey(key)}.json`);
  }

  pool(pool: string, now: string = nowIso()): ReviewPool {
    return readJson(this.poolFile(pool), ReviewPool) ?? { pool, maxConcurrent: 1, active: [], nextSeq: 0, usageKnown: false, updatedAt: now };
  }

  savePool(p: ReviewPool): void {
    atomicWriteJson(this.poolFile(p.pool), p);
  }

  setPoolLimit(pool: string, maxConcurrent: number, evidence: string): ReviewPool {
    if (maxConcurrent > 1 && !evidence.trim()) throw new Error('raising the pool limit above one requires provider/project evidence');
    const p = { ...this.pool(pool), maxConcurrent, updatedAt: nowIso() };
    this.savePool(p);
    return p;
  }

  get(key: string): ReviewRequest | undefined {
    return readJson(this.requestFile(key), ReviewRequest);
  }

  list(pool?: string): ReviewRequest[] {
    const all = listJsonFiles(this.dir)
      .filter((f) => !path.basename(f).startsWith('_pool-'))
      .map((f) => readJson(f, ReviewRequest))
      .filter((r): r is ReviewRequest => Boolean(r));
    return (pool ? all.filter((r) => r.pool === pool) : all).sort((a, b) => a.seq - b.seq);
  }

  enqueue(input: EnqueueInput): EnqueueResult {
    const now = input.now ?? nowIso();
    const key = reviewRequestKey(input);
    const existing = this.get(key);
    if (existing && existing.state !== 'cancelled') {
      if (existing.state === 'completed') return { status: 'completed', request: existing };
      if (!existing.requesters.includes(input.requester)) {
        const joined = { ...existing, requesters: [...existing.requesters, input.requester] };
        atomicWriteJson(this.requestFile(key), joined);
        return { status: 'joined', request: joined };
      }
      return { status: 'joined', request: existing };
    }
    const p = this.pool(input.pool, now);
    const request: ReviewRequest = {
      key,
      pool: input.pool,
      repository: input.repository,
      candidateDigest: input.candidateDigest,
      base: input.base,
      policyVersion: input.policyVersion,
      reviewer: input.reviewer,
      requesters: [input.requester],
      seq: p.nextSeq,
      state: 'queued',
      enqueuedAt: now,
      deadline: input.deadline,
      attempts: 0,
    };
    this.savePool({ ...p, nextSeq: p.nextSeq + 1, updatedAt: now });
    atomicWriteJson(this.requestFile(key), request);
    return { status: 'enqueued', request };
  }

  /** Requeue a completed request for the same candidate (retry/rerun); it takes a new seq and waits its turn. */
  requeue(key: string, now: string = nowIso()): ReviewRequest {
    const r = this.mustGet(key);
    if (r.state !== 'completed' && r.state !== 'cancelled') return r;
    const p = this.pool(r.pool, now);
    const requeued: ReviewRequest = { ...r, state: 'queued', seq: p.nextSeq, enqueuedAt: now, startedAt: undefined, finishedAt: undefined, slotOwner: undefined, retryAfter: undefined, verdictRef: undefined, lastError: `requeued after ${r.state} (${r.verdictRef ?? 'no verdict'})` };
    this.savePool({ ...p, nextSeq: p.nextSeq + 1, updatedAt: now });
    atomicWriteJson(this.requestFile(key), requeued);
    return requeued;
  }

  /**
   * Admit the next eligible request in persisted order if the pool has a free slot. With `key` (card
   * T0-REVIEW-ADMIT-FOREIGN) only that request is admitted, and only while fewer eligible requests stand ahead of it
   * than the pool has free slots; otherwise `behind` names the first request ahead. A request past its deadline met
   * after the first eligible request is cancelled only once the caller's request is admitted, so `behind` writes no
   * more than the keyless call writes on its way to the request it admits (R3 decision 1 F1) and leaves the pool file
   * unwritten, a stale slot included (the next admitting call cleans it).
   */
  admit(pool: string, actor: ActorIdentity = currentActor(), now: string = nowIso(), key?: string): AdmitResult {
    const p = this.pool(pool, now);
    if (p.resetAt && Date.parse(p.resetAt) > Date.parse(now)) return { status: 'reset-pending', resetAt: p.resetAt };
    // Drop active entries that are no longer running (completed/cancelled) but keep 'lost' ones: a lost
    // response must be looked up before its slot is released.
    const active = p.active.filter((k) => {
      const r = this.get(k);
      return r && (r.state === 'running' || r.state === 'lost');
    });
    if (active.length >= p.maxConcurrent) {
      if (active.length !== p.active.length) this.savePool({ ...p, active, updatedAt: now });
      return { status: 'busy', active };
    }
    const candidates = this.list(pool).filter((r) => r.state === 'queued' || r.state === 'retry-after');
    const ahead: ReviewRequest[] = [];
    const expired: ReviewRequest[] = [];
    const cancelExpired = (r: ReviewRequest): void => {
      atomicWriteJson(this.requestFile(r.key), { ...r, state: 'cancelled', finishedAt: now, lastError: 'deadline passed before admission' });
    };
    for (const r of candidates) {
      if (Date.parse(r.deadline) <= Date.parse(now)) {
        // Past the first eligible request (keyed calls only) the cancellation waits for this call to admit.
        if (ahead.length) expired.push(r);
        else cancelExpired(r);
        continue;
      }
      if (r.state === 'retry-after' && r.retryAfter && Date.parse(r.retryAfter) > Date.parse(now)) continue;
      if (key !== undefined && r.key !== key) {
        // Another eligible request ahead of the caller's takes a free slot first; once they fill them all, the caller waits.
        ahead.push(r);
        if (ahead.length < p.maxConcurrent - active.length) continue;
        // No pool write here: the cleaned slots count only in memory, and the next admitting call writes them.
        return { status: 'behind', ahead: { key: ahead[0]!.key, requesters: ahead[0]!.requesters } };
      }
      expired.forEach(cancelExpired);
      const admitted: ReviewRequest = { ...r, state: 'running', startedAt: now, slotOwner: actor, attempts: r.attempts + 1 };
      atomicWriteJson(this.requestFile(r.key), admitted);
      this.savePool({ ...p, active: [...active, r.key], updatedAt: now });
      return { status: 'admitted', request: admitted };
    }
    if (active.length !== p.active.length) this.savePool({ ...p, active, updatedAt: now });
    return { status: 'empty' };
  }

  complete(key: string, verdictRef: string, now: string = nowIso()): ReviewRequest {
    const r = this.mustGet(key);
    const done: ReviewRequest = { ...r, state: 'completed', finishedAt: now, verdictRef };
    atomicWriteJson(this.requestFile(key), done);
    this.releaseSlot(r.pool, key, now);
    return done;
  }

  /** Mark a lost response; the slot stays occupied until `resolveLost` records the looked-up outcome. */
  markLost(key: string, detail: string): ReviewRequest {
    const r = this.mustGet(key);
    const lost: ReviewRequest = { ...r, state: 'lost', lastError: detail };
    atomicWriteJson(this.requestFile(key), lost);
    return lost;
  }

  resolveLost(key: string, outcome: { found: true; verdictRef: string } | { found: false }, now: string = nowIso()): ReviewRequest {
    const r = this.mustGet(key);
    if (r.state !== 'lost') throw new Error(`request ${key} is not lost`);
    if (outcome.found) return this.complete(key, outcome.verdictRef, now);
    const requeued: ReviewRequest = { ...r, state: 'queued', startedAt: undefined, slotOwner: undefined, lastError: 'lost response; looked up, no result; requeued in order' };
    atomicWriteJson(this.requestFile(key), requeued);
    this.releaseSlot(r.pool, key, now);
    return requeued;
  }

  /** MS4: a confirmed quota/rate limit queues the request with the provider's retry-after evidence. */
  hold(key: string, retryAfter: string, evidence: string, now: string = nowIso()): ReviewRequest {
    const r = this.mustGet(key);
    const held: ReviewRequest = { ...r, state: 'retry-after', retryAfter, lastError: `quota/admission hold: ${evidence}`, startedAt: undefined, slotOwner: undefined };
    atomicWriteJson(this.requestFile(key), held);
    this.releaseSlot(r.pool, key, now);
    const p = this.pool(r.pool, now);
    const resetAt = p.resetAt && Date.parse(p.resetAt) > Date.parse(retryAfter) ? p.resetAt : retryAfter;
    this.savePool({ ...p, resetAt, notificationOwner: p.notificationOwner ?? currentActor(), updatedAt: now });
    return held;
  }

  /**
   * How long a hold on `pool` lasts (card T0-SHIP-QUOTA-RESET, issue 54): `hold` keeps the later of the pool's reset and a
   * new hold, so a wait names the later of `hold` and the reset the pool keeps; a pool with no reset leaves `hold`.
   */
  heldUntil(pool: string, hold: string, now: string = nowIso()): string {
    const resetAt = this.pool(pool, now).resetAt;
    return resetAt && Date.parse(resetAt) > Date.parse(hold) ? resetAt : hold;
  }

  cancel(key: string, reason: string, now: string = nowIso()): ReviewRequest | undefined {
    const r = this.get(key);
    if (!r) return undefined;
    const cancelled: ReviewRequest = { ...r, state: 'cancelled', finishedAt: now, lastError: reason };
    atomicWriteJson(this.requestFile(key), cancelled);
    this.releaseSlot(r.pool, key, now);
    return cancelled;
  }

  /** The single registered reset/status notification owner for a pool (MS4). */
  notificationOwner(pool: string): ActorIdentity | undefined {
    return this.pool(pool).notificationOwner;
  }

  private releaseSlot(pool: string, key: string, now: string): void {
    const p = this.pool(pool, now);
    this.savePool({ ...p, active: p.active.filter((k) => k !== key), updatedAt: now });
  }

  private mustGet(key: string): ReviewRequest {
    const r = this.get(key);
    if (!r) throw new Error(`unknown review request ${key}`);
    return r;
  }
}
