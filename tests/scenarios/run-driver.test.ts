import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture } from './_harness.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { runGoal } from '../../src/loop/run-driver.ts';

test('run dispatches a plan with its goal identity and accepts only the controller report', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const provider = new MockProvider({ planner: [{ outcome: 'ok', text: 'plan complete' }] });
    const result = await runGoal(goal.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(result.kind, 'plan');
    assert.equal(provider.calls.length, 1);
    assert.match(provider.calls[0]!.prompt, new RegExp(goal.id));
    assert.equal(fx.goal(goal.id).state, 'PLAN');
  } finally { fx.cleanup(); }
});
