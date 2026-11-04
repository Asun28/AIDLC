/**
 * Shared provider/account review admission queue (plan v5 MS3, MS4, Q24).
 *
 * One active formal review per known account pool across participating windows by default.
 * Requests are persisted outside worktrees and deduplicated by repository + candidate digest
 * + base + policy version + reviewer identity; a matching running request is joined. Admission
 * follows persisted queue order with deadlines; retries cannot jump the queue. Waiting for
 * quota holds no active slot. A lost response must be looked up before its slot is released.
 *
 * Every mutation does its reads and its writes in one section of the pool record's lock (`section`, `sectionOf`), so against
 * every other mutation of that pool the read of a request and the writes that follow it are one step. The lock is not
 * reentrant: only public methods open a section, and a method running in one calls private methods that open none. A
 * read-only method takes no lock.
 */
import path from 'node:path';
import { ActorIdentity, ReviewPool, ReviewRequest, nowIso } from '../core/types.ts';
import { reviewRequestKey } from '../core/review-policy.ts';
import { atomicWriteJson, listJsonFiles, processAlive, readJson, updateJson } from '../state/store.ts';
import { currentActor } from '../state/journal.ts';
import { hostName, shortKey } from '../state/paths.ts';

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

export interface ReleaseOptions {
  now?: string;
  /** Runs in the section, after the check and before any write; a throw writes nothing and is rethrown. It must not call this queue's mutations: the lock is not reentrant. */
  before?: (request: ReviewRequest) => void;
}

/** The largest pid `process.kill` accepts; above it a signal throws, which would read as a process that is gone. */
const MAX_PID = 2 ** 31 - 1;

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

  /**
   * One section of the pool record's lock around `body`, which refuses with `LOCKED` after the default wait of `updateJson`.
   * The change returns the record it received, so the lock itself writes nothing and every write is `body`'s.
   */
  private section<T>(pool: string, body: () => T): T {
    let result: T;
    updateJson(this.poolFile(pool), ReviewPool, (current) => {
      result = body();
      return current;
    });
    return result!;
  }

  /**
   * The section of the pool `home` names. `enqueue` replaces a cancelled request in the pool its caller names, so a request
   * can change pool after an unlocked read: `home` is read again in the section, and after a move `body` runs in the section
   * of the new pool, never under the lock of the old one.
   */
  private sectionOf<T>(home: () => string, body: () => T): T {
    for (;;) {
      const pool = home();
      let result: { value: T } | undefined;
      this.section(pool, () => {
        if (home() === pool) result = { value: body() };
      });
      if (result) return result.value;
    }
  }

  private requestSection<T>(key: string, body: (request: ReviewRequest) => T): T {
    return this.sectionOf(() => this.mustGet(key).pool, () => body(this.mustGet(key)));
  }

  pool(pool: string, now: string = nowIso()): ReviewPool {
    return readJson(this.poolFile(pool), ReviewPool) ?? { pool, maxConcurrent: 1, active: [], nextSeq: 0, usageKnown: false, updatedAt: now };
  }

  savePool(p: ReviewPool): void {
    this.section(p.pool, () => this.writePool(p));
  }

  private writePool(p: ReviewPool): void {
    atomicWriteJson(this.poolFile(p.pool), p);
  }

  setPoolLimit(pool: string, maxConcurrent: number, evidence: string): ReviewPool {
    if (maxConcurrent > 1 && !evidence.trim()) throw new Error('raising the pool limit above one requires provider/project evidence');
    return this.section(pool, () => {
      const p = { ...this.pool(pool), maxConcurrent, updatedAt: nowIso() };
      this.writePool(p);
      return p;
    });
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
    // A stored request that is not cancelled keeps its pool, which may not be the one named here.
    const home = (): string => {
      const stored = this.get(key);
      return stored && stored.state !== 'cancelled' ? stored.pool : input.pool;
    };
    return this.sectionOf(home, () => this.enqueueInSection(input, key, now));
  }

  private enqueueInSection(input: EnqueueInput, key: string, now: string): EnqueueResult {
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
    this.writePool({ ...p, nextSeq: p.nextSeq + 1, updatedAt: now });
    atomicWriteJson(this.requestFile(key), request);
    return { status: 'enqueued', request };
  }

  /** Requeue a completed request for the same candidate (retry/rerun); it takes a new seq and waits its turn. */
  requeue(key: string, now: string = nowIso()): ReviewRequest {
    return this.requestSection(key, (r) => {
      if (r.state !== 'completed' && r.state !== 'cancelled') return r;
      const p = this.pool(r.pool, now);
      const requeued: ReviewRequest = { ...r, state: 'queued', seq: p.nextSeq, enqueuedAt: now, startedAt: undefined, finishedAt: undefined, slotOwner: undefined, retryAfter: undefined, verdictRef: undefined, lastError: `requeued after ${r.state} (${r.verdictRef ?? 'no verdict'})` };
      this.writePool({ ...p, nextSeq: p.nextSeq + 1, updatedAt: now });
      atomicWriteJson(this.requestFile(key), requeued);
      return requeued;
    });
  }

  /**
   * Admit the next eligible request in persisted order if the pool has a free slot. With `key` (card
   * T0-REVIEW-ADMIT-FOREIGN) only that request is admitted, and only while fewer eligible requests stand ahead of it
   * than the pool has free slots; otherwise `behind` names the first request ahead. Deadline rule: a keyed call cancels
   * each request past its deadline that its scan passes, as keyless calls draining the queue to the same point do, except
   * that on `behind` it writes only those before the first eligible request, what one keyless call writes (R3 decisions
   * 1 and 2), and leaves the pool file unwritten, a stale slot included (the next admitting call cleans it). A key no
   * queued or retry-after request carries is treated as the last request of the queue.
   */
  admit(pool: string, actor: ActorIdentity = currentActor(), now: string = nowIso(), key?: string): AdmitResult {
    return this.section(pool, () => this.admitInSection(pool, actor, now, key));
  }

  private admitInSection(pool: string, actor: ActorIdentity, now: string, key: string | undefined): AdmitResult {
    const p = this.pool(pool, now);
    if (p.resetAt && Date.parse(p.resetAt) > Date.parse(now)) return { status: 'reset-pending', resetAt: p.resetAt };
    // Drop active entries that are no longer running (completed/cancelled) but keep 'lost' ones: a lost
    // response must be looked up before its slot is released.
    const active = p.active.filter((k) => {
      const r = this.get(k);
      return r && (r.state === 'running' || r.state === 'lost');
    });
    if (active.length >= p.maxConcurrent) {
      if (active.length !== p.active.length) this.writePool({ ...p, active, updatedAt: now });
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
        // Past the first eligible request (keyed calls only) the cancellation is held: written on `admitted` and `empty`,
        // dropped on `behind`.
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
      this.writePool({ ...p, active: [...active, r.key], updatedAt: now });
      return { status: 'admitted', request: admitted };
    }
    // The scan passed the whole queue: every held cancellation is written, as keyless calls draining the queue write them.
    expired.forEach(cancelExpired);
    if (active.length !== p.active.length) this.writePool({ ...p, active, updatedAt: now });
    return { status: 'empty' };
  }

  complete(key: string, verdictRef: string, now: string = nowIso()): ReviewRequest {
    return this.requestSection(key, (r) => this.completeInSection(r, verdictRef, now));
  }

  private completeInSection(r: ReviewRequest, verdictRef: string, now: string): ReviewRequest {
    const done: ReviewRequest = { ...r, state: 'completed', finishedAt: now, verdictRef };
    atomicWriteJson(this.requestFile(r.key), done);
    this.releaseSlot(r.pool, r.key, now);
    return done;
  }

  /** Mark a lost response; the slot stays occupied until `resolveLost` records the looked-up outcome. */
  markLost(key: string, detail: string): ReviewRequest {
    return this.requestSection(key, (r) => {
      const lost: ReviewRequest = { ...r, state: 'lost', lastError: detail };
      atomicWriteJson(this.requestFile(key), lost);
      return lost;
    });
  }

  resolveLost(key: string, outcome: { found: true; verdictRef: string } | { found: false }, now: string = nowIso()): ReviewRequest {
    return this.requestSection(key, (r) => {
      if (r.state !== 'lost') throw new Error(`request ${key} is not lost`);
      if (outcome.found) return this.completeInSection(r, outcome.verdictRef, now);
      const requeued: ReviewRequest = { ...r, state: 'queued', startedAt: undefined, slotOwner: undefined, lastError: 'lost response; looked up, no result; requeued in order' };
      atomicWriteJson(this.requestFile(key), requeued);
      this.releaseSlot(r.pool, key, now);
      return requeued;
    });
  }

  /** MS4: a confirmed quota/rate limit queues the request with the provider's retry-after evidence. */
  hold(key: string, retryAfter: string, evidence: string, now: string = nowIso()): ReviewRequest {
    return this.requestSection(key, (r) => {
      const held: ReviewRequest = { ...r, state: 'retry-after', retryAfter, lastError: `quota/admission hold: ${evidence}`, startedAt: undefined, slotOwner: undefined };
      atomicWriteJson(this.requestFile(key), held);
      this.releaseSlot(r.pool, key, now);
      const p = this.pool(r.pool, now);
      const resetAt = p.resetAt && Date.parse(p.resetAt) > Date.parse(retryAfter) ? p.resetAt : retryAfter;
      this.writePool({ ...p, resetAt, notificationOwner: p.notificationOwner ?? currentActor(), updatedAt: now });
      return held;
    });
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
    if (!this.get(key)) return undefined;
    return this.requestSection(key, (r) => this.cancelInSection(r, reason, now));
  }

  private cancelInSection(r: ReviewRequest, reason: string, now: string): ReviewRequest {
    const cancelled: ReviewRequest = { ...r, state: 'cancelled', finishedAt: now, lastError: reason };
    atomicWriteJson(this.requestFile(r.key), cancelled);
    this.releaseSlot(r.pool, r.key, now);
    return cancelled;
  }

  /** Why `release` refuses this request as stored, undefined when it may free the slot. */
  private releaseRefusal(r: ReviewRequest): string | undefined {
    if (r.state !== 'running') return `review request ${r.key} is ${r.state}, not running; there is no slot to release`;
    const owner = r.slotOwner;
    if (!owner || owner.pid <= 0 || owner.pid > MAX_PID) return `review request ${r.key} names no usable pid, so nothing proves its owner is gone`;
    if (owner.host !== hostName()) return `review request ${r.key} is held on host ${owner.host}; release it there`;
    if (processAlive(owner.pid)) return `review request ${r.key} is still running as pid ${owner.pid}`;
    return undefined;
  }

  /**
   * Free the slot of a running request whose owner process is gone from this host (card T0-REVIEW-RELEASE): a process killed
   * between its admission and the settlement of its request leaves a running request that `admit` keeps and no call settles.
   * The check, `options.before`, the `cancelled` write and the slot removal are one section, so no mutation of the pool lands
   * between them: a release can never cancel a later admission of the same key, and `before` sees the requesters the release
   * cancels. Anything but a proved dead owner of this host refuses, writing nothing.
   */
  release(key: string, reason: string, options: ReleaseOptions = {}): ReviewRequest {
    return this.requestSection(key, (r) => {
      const refusal = this.releaseRefusal(r);
      if (refusal) throw new Error(refusal);
      options.before?.(r);
      return this.cancelInSection(r, reason, options.now ?? nowIso());
    });
  }

  /** The single registered reset/status notification owner for a pool (MS4). */
  notificationOwner(pool: string): ActorIdentity | undefined {
    return this.pool(pool).notificationOwner;
  }

  /** Runs in a section only. */
  private releaseSlot(pool: string, key: string, now: string): void {
    const p = this.pool(pool, now);
    this.writePool({ ...p, active: p.active.filter((k) => k !== key), updatedAt: now });
  }

  private mustGet(key: string): ReviewRequest {
    const r = this.get(key);
    if (!r) throw new Error(`unknown review request ${key}`);
    return r;
  }
}
