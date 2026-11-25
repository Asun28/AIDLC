/**
 * Durable goal / card-run / release-attempt repository built on the atomic store.
 */
import path from 'node:path';
import { CardRun, Goal, ReleaseAttempt, nowIso } from '../core/types.ts';
import { staleLedger } from '../core/review-policy.ts';
import { StoreError, atomicWriteJson, findInterruptedWrites, listJsonFiles, readDirNames, readJson, recoverInterruptedWrites, updateJson } from './store.ts';
import type { StatePaths } from './paths.ts';

export interface GoalStoreOptions {
  /** How long `updateCardRun` and `updateGoal` wait for the lock of their record before they refuse (default 2 s). */
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

  /**
   * A plain write of a goal, as a compare-and-set on `Goal.writes`: a snapshot read before another write landed is refused
   * with `GOAL_STALE` before `within` runs, so the caller runs its command again on the current record. `within` is
   * `updateGoal`'s. Returns the record as stored, which a further write of the caller must carry.
   */
  saveGoal(goal: Goal, within?: (write: () => void) => void): Goal {
    return this.updateGoal(goal.id, (persisted) => {
      this.refuseStale(persisted, goal);
      return goal;
    }, within);
  }

  /**
   * Runs `section` under the goal lock on the record `goal` was read from, returns its result and writes no goal: a record another write changed
   * since is refused with `GOAL_STALE`, and a lock that is held with `LOCKED`, before `section` runs.
   */
  withGoal<T>(goal: Goal, section: () => T): T {
    let out: T | undefined;
    this.updateGoal(goal.id, (persisted) => {
      this.refuseStale(persisted, goal);
      out = section();
      return persisted!;
    });
    return out as T;
  }

  /** Refuses, with `GOAL_STALE`, a record `persisted` that another write changed since `goal` was read. */
  refuseStale(persisted: Goal | undefined, goal: Goal): void {
    if (persisted && persisted.writes !== goal.writes) throw new StoreError('GOAL_STALE', this.goalFile(goal.id), `goal ${goal.id} changed since it was read (write ${persisted.writes} persisted, ${goal.writes} read); run the command again`);
  }

  /**
   * The one read-modify-write of a goal record, under the lock of the goal file (`updateJson`, card T1-GOAL-UPDATE): `change`
   * receives the record as stored and returns the one to write, which takes the next count of `writes`. A change that returns
   * the record it received writes nothing. Not reentrant: no change calls another write of the same goal. It nests inside the
   * goal lease lock and outside the card-run, card-lease and journal locks.
   */
  updateGoal(goalId: string, change: (current: Goal | undefined) => Goal, within?: (write: () => void) => void): Goal {
    return updateJson(this.goalFile(goalId), Goal, (persisted) => {
      const next = change(persisted);
      return next === persisted ? next : Goal.parse({ ...next, writes: persisted ? persisted.writes + 1 : 0, updatedAt: nowIso() });
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
    for (const d of readDirNames(this.paths.cards)) dirs.push(path.join(this.paths.cards, d));
    const interrupted: string[] = [];
    for (const d of dirs) {
      const found = findInterruptedWrites(d);
      if (found.length) interrupted.push(...recoverInterruptedWrites(d));
    }
    return { interrupted };
  }
}
