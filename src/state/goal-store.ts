/**
 * Durable goal / card-run / release-attempt repository built on the atomic store.
 */
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { CardRun, Goal, ReleaseAttempt, nowIso } from '../core/types.ts';
import { staleLedger } from '../core/review-policy.ts';
import { StoreError, atomicWriteJson, findInterruptedWrites, listJsonFiles, readJson, recoverInterruptedWrites, updateJson } from './store.ts';
import type { StatePaths } from './paths.ts';

export interface GoalStoreOptions {
  /** How long `updateCardRun` and `updateGoal` wait for the record's lock before they refuse (default 2 s). */
  lockTimeoutMs?: number;
}

export class GoalStore {
  readonly paths: StatePaths;
  private readonly lock: { timeoutMs?: number };

  constructor(paths: StatePaths, options: GoalStoreOptions = {}) {
    this.paths = paths;
    this.lock = { timeoutMs: options.lockTimeoutMs };
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

  /** Compare-and-set a goal snapshot; only the outbox flush clears pending events. */
  saveGoal(goal: Goal): Goal {
    return this.updateGoal(goal.id, (persisted) => {
      if (persisted && goal.storeRevision !== persisted.storeRevision) throw new StoreError('GOAL_STALE', this.goalFile(goal.id), `goal ${goal.id} changed since it was read; run the command again`);
      if (persisted?.pendingExtension) throw new StoreError('GOAL_EXTENSION_PENDING', this.goalFile(goal.id), `goal ${goal.id} has an unfinished deadline extension; retry aidlc goal extend`);
      return { ...goal, pendingFiring: persisted?.pendingFiring ?? goal.pendingFiring, pendingEvents: persisted?.pendingEvents?.length ? persisted.pendingEvents : goal.pendingEvents };
    });
  }

  /** Read-modify-write of one goal record under `<file>.lock` (`updateJson`), refused with `LOCKED` like a card run's; a change that returns the record it received, or nothing, writes nothing. */
  updateGoal(goalId: string, change: (current: Goal | undefined) => Goal | undefined, within?: (write: () => void) => void): Goal {
    return updateJson(this.goalFile(goalId), Goal, (persisted) => {
      const next = change(persisted);
      return next === persisted || !next ? next : Goal.parse({ ...next, storeRevision: persisted ? persisted.storeRevision + 1 : 0, updatedAt: nowIso() });
    }, { ...this.lock, within })!;
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

  /**
   * A plain write of a card run, serialized through the card-run lock like every other write (see `updateCardRun`),
   * as a compare-and-set on the run revision: a snapshot that does not carry the persisted revision was read before
   * another write landed and is refused whatever it changes (a candidate, a receipt, a stop, a ledger entry), so the
   * caller re-runs its command on the current record. The ledgers name the entry when they can (`staleLedger`). `within`
   * is `updateCardRun`'s.
   */
  saveCardRun(run: CardRun, within?: (write: () => void) => void): CardRun {
    return this.updateCardRun(run.goalId, run.cardId, (persisted) => {
      if (persisted && run.revision !== persisted.revision) {
        const why = staleLedger(persisted, run);
        throw new StoreError('CARD_RUN_STALE', this.cardFile(run.goalId, run.cardId), `card run ${run.cardId} changed since it was read (revision ${persisted.revision} persisted, ${run.revision} read${why ? `: ${why} was recorded meanwhile` : ''}); run the command again`);
      }
      return run;
    }, within);
  }

  getCardRun(goalId: string, cardId: string): CardRun | undefined {
    return readJson(this.cardFile(goalId, cardId), CardRun);
  }

  /**
   * Read-modify-write of one card run under the card-run lock (`updateJson`): `change` receives the record as persisted
   * at that moment and returns the record to write, so two writers never work from the same snapshot. Every write over a
   * persisted record takes the next revision, so a later snapshot write must carry it (`saveCardRun`); the creating write
   * keeps revision 0, the value its caller holds. A change that returns the record it received writes nothing; `within`
   * runs the write inside another lock section (`updateJson`).
   */
  updateCardRun(goalId: string, cardId: string, change: (current: CardRun | undefined) => CardRun, within?: (write: () => void) => void): CardRun {
    return updateJson(this.cardFile(goalId, cardId), CardRun, (persisted) => {
      const next = change(persisted);
      return next === persisted ? next : CardRun.parse({ ...next, revision: persisted ? persisted.revision + 1 : 0, updatedAt: nowIso() });
    }, { ...this.lock, within })!;
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
