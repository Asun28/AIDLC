/**
 * Preload for tests/scenarios/card-terminal-goal.test.ts (card T0-CARD-TERMINAL-GOAL-2), loaded with
 * `node --import <this file> src/cli/main.ts ...`. It wraps four `GoalStore` methods so the test sees the order of the
 * CLI's goal-store reads and writes:
 * - AIDLC_TEST_CALL_LOG: a file each call of `listGoals`, `getGoal`, `getCardRun` and `saveCardRun` appends its name to.
 * - AIDLC_TEST_CANCEL_AFTER_LIST: a goal id saved as cancelled through the real store right after the first `listGoals`
 *   returns, a stop that lands between the command's one read and its later steps.
 */
import { appendFileSync } from 'node:fs';
import { GoalStore } from '../../src/state/goal-store.ts';
import { makeStop } from '../../src/core/stop.ts';

const log = process.env['AIDLC_TEST_CALL_LOG'];
const cancelId = process.env['AIDLC_TEST_CANCEL_AFTER_LIST'];
const proto = GoalStore.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
const original = { getGoal: GoalStore.prototype.getGoal, saveGoal: GoalStore.prototype.saveGoal };
let listed = false;

for (const name of ['listGoals', 'getGoal', 'getCardRun', 'saveCardRun']) {
  const real = proto[name]!;
  proto[name] = function (this: GoalStore, ...args: unknown[]) {
    if (log) appendFileSync(log, `${name}\n`);
    const result = real.apply(this, args);
    if (name === 'listGoals' && cancelId && !listed) {
      listed = true;
      const goal = original.getGoal.call(this, cancelId);
      if (goal) original.saveGoal.call(this, { ...goal, state: 'STOP', terminal: true, stop: makeStop('cancelled', 'cancelled by the test preload', 'none; evidence retained', { at: '2026-09-11T00:00:00.000Z' }) });
    }
    return result;
  };
}
