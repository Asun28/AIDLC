/**
 * Durable goal / card-run / release-attempt repository built on the atomic store.
 */
import path from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { CardRun, Goal, ReleaseAttempt, nowIso } from '../core/types.ts';
import { StoreError, atomicWriteJson, createExclusive, findInterruptedWrites, listJsonFiles, readJson, recoverInterruptedWrites } from './store.ts';
import type { StatePaths } from './paths.ts';

export interface GoalStoreOptions {
  /** How long `updateCardRun` waits for the card-run lock before it refuses (default 2 s). */
  lockTimeoutMs?: number;
  /** A lock file older than this is a crashed writer's and is taken over (default 30 s). */
  staleLockMs?: number;
}

/** Block the thread for `ms` (a lock retry between two synchronous file operations). */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export class GoalStore {
  readonly paths: StatePaths;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  constructor(paths: StatePaths, options: GoalStoreOptions = {}) {
    this.paths = paths;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 2_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
  }

  goalFile(goalId: string): string {
    return path.join(this.paths.goals, `${goalId}.json`);
  }

  cardFile(goalId: string, cardId: string): string {
    return path.join(this.paths.cards, goalId, `${cardId}.json`);
  }

  releaseFile(attemptId: string): string {
    return path.join(this.paths.releases, `${attemptId}.json`);
  }

  saveGoal(goal: Goal): Goal {
    const next = Goal.parse({ ...goal, updatedAt: nowIso() });
    atomicWriteJson(this.goalFile(goal.id), next);
    return next;
  }

  getGoal(goalId: string): Goal | undefined {
    return readJson(this.goalFile(goalId), Goal);
  }

  listGoals(): Goal[] {
    return listJsonFiles(this.paths.goals)
      .map((f) => readJson(f, Goal))
      .filter((g): g is Goal => Boolean(g))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** A plain write of a card run, serialized through the card-run lock like every other write (see `updateCardRun`). */
  saveCardRun(run: CardRun): CardRun {
    return this.updateCardRun(run.goalId, run.cardId, () => run);
  }

  getCardRun(goalId: string, cardId: string): CardRun | undefined {
    return readJson(this.cardFile(goalId, cardId), CardRun);
  }

  /**
   * Read-modify-write of one card run under an exclusive lock file (`<file>.lock`, created with `wx`):
   * `change` receives the record as persisted at that moment and returns the record to write, so two
   * writers never work from the same snapshot and neither overwrites the other's change. The write and the
   * release are ownership-checked: a writer whose lock changed hands meanwhile (a stale takeover after a
   * long suspension) refuses instead of writing over the new owner and never removes that owner's lock.
   * A waiter that cannot take the lock before the deadline refuses; a lock older than the stale age belongs
   * to a crashed writer and is taken over through a serialized marker. A throwing `change` leaves the record.
   */
  updateCardRun(goalId: string, cardId: string, change: (current: CardRun | undefined) => CardRun): CardRun {
    const file = this.cardFile(goalId, cardId);
    const lock = `${file}.lock`;
    const owner = `pid=${process.pid} at=${nowIso()} nonce=${Math.random().toString(36).slice(2, 10)}`;
    const deadline = Date.now() + this.lockTimeoutMs;
    for (;;) {
      if (createExclusive(lock, owner)) break;
      if (Date.now() >= deadline) throw new StoreError('CARD_RUN_LOCKED', file, `card run ${goalId}/${cardId} is locked by another writer (${readLockOwner(lock)}); run the command again`);
      const age = ageMs(lock);
      if (age !== undefined && age > this.staleLockMs) this.takeOverStaleLock(lock, owner);
      else sleepSync(10);
    }
    try {
      const next = CardRun.parse({ ...change(readJson(file, CardRun)), updatedAt: nowIso() });
      // Fencing: the lock must still be this writer's right before the write.
      if (readLockOwner(lock) !== owner) throw new StoreError('CARD_RUN_LOCK_LOST', file, `card run ${goalId}/${cardId}: the lock changed hands during the update (${readLockOwner(lock)}); nothing written, run the command again`);
      atomicWriteJson(file, next);
      return next;
    } finally {
      // Ownership-checked release: never remove a lock that belongs to another writer.
      if (readLockOwner(lock) === owner) removeIfPresent(lock);
    }
  }

  /**
   * Stale-lock takeover, serialized among waiters by a second exclusive marker (`<lock>.takeover`): the one
   * waiter holding the marker re-checks the lock's age and removes it only while it is still stale. A live
   * writer cannot create a lock while the stale file exists, so nothing but the stale file is ever removed;
   * a marker left by a crashed taker-over ages out the same way. Removal errors other than a vanished file
   * propagate: a lock this process cannot remove is not silently retried.
   */
  private takeOverStaleLock(lock: string, owner: string): void {
    const marker = `${lock}.takeover`;
    if (!createExclusive(marker, owner)) {
      const markerAge = ageMs(marker);
      if (markerAge !== undefined && markerAge > this.staleLockMs) removeIfPresent(marker);
      else sleepSync(10);
      return;
    }
    try {
      const age = ageMs(lock);
      if (age !== undefined && age > this.staleLockMs) removeIfPresent(lock);
    } finally {
      removeIfPresent(marker);
    }
  }

  listCardRuns(goalId: string): CardRun[] {
    const dir = path.join(this.paths.cards, goalId);
    return listJsonFiles(dir)
      .map((f) => readJson(f, CardRun))
      .filter((r): r is CardRun => Boolean(r));
  }

  saveRelease(attempt: ReleaseAttempt): ReleaseAttempt {
    const next = ReleaseAttempt.parse({ ...attempt, updatedAt: nowIso() });
    atomicWriteJson(this.releaseFile(attempt.id), next);
    return next;
  }

  getRelease(attemptId: string): ReleaseAttempt | undefined {
    return readJson(this.releaseFile(attemptId), ReleaseAttempt);
  }

  listReleases(goalId?: string): ReleaseAttempt[] {
    return listJsonFiles(this.paths.releases)
      .map((f) => readJson(f, ReleaseAttempt))
      .filter((r): r is ReleaseAttempt => Boolean(r))
      .filter((r) => (goalId ? r.goalId === goalId : true));
  }

  /** Detect and clean interrupted writes across the state tree; returns what was found. */
  recover(): { interrupted: string[] } {
    const dirs = [this.paths.goals, this.paths.releases, this.paths.leases, this.paths.reviewQueue, this.paths.operations];
    if (existsSync(this.paths.cards)) for (const d of readdirSync(this.paths.cards)) dirs.push(path.join(this.paths.cards, d));
    const interrupted: string[] = [];
    for (const d of dirs) {
      const found = findInterruptedWrites(d);
      if (found.length) interrupted.push(...recoverInterruptedWrites(d));
    }
    return { interrupted };
  }
}

/** Remove a file; a file already gone is not an error, anything else propagates. */
function removeIfPresent(file: string): void {
  try {
    unlinkSync(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}

/** Age of a file by its mtime, undefined when it is gone. */
function ageMs(file: string): number | undefined {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
}

function readLockOwner(lock: string): string {
  try {
    return readFileSync(lock, 'utf8').trim() || 'unknown owner';
  } catch {
    return 'unknown owner';
  }
}
