/**
 * Preload for tests/scenarios/takeover-done-race.test.ts (card T0-TAKEOVER-DONE-RACE, issue 387), loaded with
 * `node --import <this file> src/cli/main.ts ...`. It wraps the two goal reads of `GoalStore`, `getGoal` and `listGoals`:
 * - AIDLC_TEST_DONE_AFTER_READ: a goal saved as DONE (terminal) through the real store right after the command's first goal
 *   read returns, a goal close by another session that lands between that read and the takeover's lease write.
 * - AIDLC_TEST_DONE_BEFORE_READ: the same, saved right before the command's first goal read runs.
 * - AIDLC_TEST_LOCK_FILE with AIDLC_TEST_READ_LOG: each read appends `<name> <true|false>` to the log, whether the lock file
 *   (the goal lease lock) exists when the read runs.
 */
import { appendFileSync, existsSync } from 'node:fs';
import { GoalStore } from '../../src/state/goal-store.ts';

const after = process.env['AIDLC_TEST_DONE_AFTER_READ'];
const before = process.env['AIDLC_TEST_DONE_BEFORE_READ'];
const lockFile = process.env['AIDLC_TEST_LOCK_FILE'];
const log = process.env['AIDLC_TEST_READ_LOG'];
const proto = GoalStore.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
const original = { getGoal: GoalStore.prototype.getGoal, saveGoal: GoalStore.prototype.saveGoal };
let saved = false;

function saveDone(store: GoalStore, goalId: string): void {
  saved = true;
  const goal = original.getGoal.call(store, goalId);
  if (goal) original.saveGoal.call(store, { ...goal, state: 'DONE', terminal: true });
}

for (const name of ['getGoal', 'listGoals']) {
  const real = proto[name]!;
  proto[name] = function (this: GoalStore, ...args: unknown[]) {
    if (before && !saved) saveDone(this, before);
    if (log && lockFile) appendFileSync(log, `${name} ${existsSync(lockFile)}\n`);
    const result = real.apply(this, args);
    if (after && !saved) saveDone(this, after);
    return result;
  };
}
