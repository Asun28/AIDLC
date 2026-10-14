import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, T0, type Fixture } from './_harness.ts';
import { HOUR_MS, addMs } from '../../src/core/types.ts';

// Card T1-SWEEP2-EXTEND-REASON: GoalController.extendDeadline builds the extension with the core extendDeadline rule, so a
// blank reason is refused before the goal, a card run or the journal is written.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every file under the state directory with its bytes: the goal record, the card runs and the journal among them. */
function snapshot(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else files[path.relative(dir, p)] = readFileSync(p).toString('base64');
    }
  };
  walk(dir);
  return files;
}

/** A T1 goal with one card in BUILD, so the extension has a goal record, a card run and a journal to leave alone. */
function goalWithRunningCard(fx: Fixture): string {
  writeCard(fx, { id: 'T1-A', title: 'a' });
  const goal = goalForCards(fx, ['T1-A'], { size: 'T1' });
  const runner = fx.runner();
  let r = runner.next(fx.goal(goal.id), fx.card('T1-A'), fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-A'));
  r = runner.next(fx.goal(goal.id), fx.card('T1-A'), r.run);
  assert.equal(r.directive.kind, 'build', r.directive.narration);
  return goal.id;
}

test('T1-SWEEP2-EXTEND-REASON acceptance 1: a blank or empty reason is refused and the goal, the card runs and the journal stay byte-identical [R1]', () => {
  const fx = makeFixture();
  try {
    const goalId = goalWithRunningCard(fx);
    const until = addMs(T0, 14 * HOUR_MS);
    for (const reason of ['   ', '', '\t\n']) {
      const before = snapshot(fx.paths.root);
      assert.throws(() => fx.controller.extendDeadline(goalId, 'lead', until, reason), { message: 'extension requires a recorded reason' }, JSON.stringify(reason));
      assert.deepEqual(snapshot(fx.paths.root), before, `nothing is written for the reason ${JSON.stringify(reason)}`);
    }
    assert.deepEqual(fx.goal(goalId).deadlines.extensions, []);
  } finally {
    fx.cleanup();
  }
});

test('T1-SWEEP2-EXTEND-REASON acceptance 2: an earlier deadline is still refused, and a valid call records exactly one extension with the given reason [R2]', () => {
  const fx = makeFixture();
  try {
    const goalId = goalWithRunningCard(fx);
    const goalDeadline = fx.goal(goalId).deadlines.goalDeadline;
    assert.throws(() => fx.controller.extendDeadline(goalId, 'lead', addMs(goalDeadline, -HOUR_MS), 'more time'), { message: 'extension must move the deadline later' });
    assert.deepEqual(fx.goal(goalId).deadlines.extensions, []);
    const until = addMs(goalDeadline, 2 * HOUR_MS);
    fx.controller.extendDeadline(goalId, 'lead', until, 'the reviews and the ship remain');
    assert.deepEqual(fx.goal(goalId).deadlines.extensions, [{ at: fx.now(), by: 'lead', newDeadline: until, reason: 'the reviews and the ship remain' }]);
  } finally {
    fx.cleanup();
  }
});

test('T1-SWEEP2-EXTEND-REASON acceptance 4: OPERATIONS states that a blank reason is refused and the CHANGELOG names the card [R3]', () => {
  const ops = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8');
  assert.ok(
    ops.includes('- A blank reason (empty or only whitespace) is refused before anything is written (card T1-SWEEP2-EXTEND-REASON): `aidlc goal extend` exits nonzero with `extension requires a recorded reason`, and the goal, its card runs and its journal stay as they were.'),
    'the Deadline extensions section states the refusal',
  );
  const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(
    unreleased.includes('- T1-SWEEP2-EXTEND-REASON (bugfix): `aidlc goal extend` refuses a blank `--reason` (empty or only whitespace) with `extension requires a recorded reason` before writing anything. `GoalController.extendDeadline` now builds the extension with the core `extendDeadline` (`src/core/deadlines.ts`), whose reason check the controller\'s own copy of the rule lacked.'),
    'the CHANGELOG Unreleased section names the card and the refusal',
  );
});
