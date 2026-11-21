/**
 * Preload for tests/scenarios/takeover-done-race.test.ts (card T0-TAKEOVER-DONE-RACE, issue 387), loaded with
 * `node --import <this file> src/cli/main.ts ...`. AIDLC_TEST_DONE_AFTER_READ names a goal that is saved as DONE (terminal)
 * through the real `GoalStore` right after the command's first goal read (`getGoal` or `listGoals`) returns: a goal close
 * by another session that lands between the takeover's goal read and its lease write.
 */
import { GoalStore } from '../../src/state/goal-store.ts';

const goalId = process.env['AIDLC_TEST_DONE_AFTER_READ'];
const proto = GoalStore.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
const original = { getGoal: GoalStore.prototype.getGoal, saveGoal: GoalStore.prototype.saveGoal };
let saved = false;

for (const name of ['getGoal', 'listGoals']) {
  const real = proto[name]!;
  proto[name] = function (this: GoalStore, ...args: unknown[]) {
    const result = real.apply(this, args);
    if (goalId && !saved) {
      saved = true;
      const goal = original.getGoal.call(this, goalId);
      if (goal) original.saveGoal.call(this, { ...goal, state: 'DONE', terminal: true });
    }
    return result;
  };
}
