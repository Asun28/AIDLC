/**
 * Durable goal / card-run / release-attempt repository built on the atomic store.
 */
import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { CardRun, Goal, ReleaseAttempt, nowIso } from '../core/types.ts';
import { atomicWriteJson, findInterruptedWrites, listJsonFiles, readJson, recoverInterruptedWrites } from './store.ts';
import type { StatePaths } from './paths.ts';

export class GoalStore {
  readonly paths: StatePaths;

  constructor(paths: StatePaths) {
    this.paths = paths;
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

  saveCardRun(run: CardRun): CardRun {
    const next = CardRun.parse({ ...run, updatedAt: nowIso() });
    atomicWriteJson(this.cardFile(run.goalId, run.cardId), next);
    return next;
  }

  getCardRun(goalId: string, cardId: string): CardRun | undefined {
    return readJson(this.cardFile(goalId, cardId), CardRun);
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
