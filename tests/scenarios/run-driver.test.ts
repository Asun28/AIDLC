import test from 'node:test';
import assert from 'node:assert/strict';
import { driveCardToDone, makeFixture, writeCard } from './_harness.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { runGoal } from '../../src/loop/run-driver.ts';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { addMs, CardRun, Goal } from '../../src/core/types.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { hostname } from 'node:os';
import { pathToFileURL } from 'node:url';

function cardGoal(fx: ReturnType<typeof makeFixture>) {
  writeCard(fx, { id: 'T1-ONE', title: 'One card' });
  const goal = fx.controller.createGoal({ text: 'implement T1-ONE', source: 'card', ref: 'T1-ONE', affectedSurfaces: [] }, { cards: ['T1-ONE'] });
  fx.controller.report({ goalId: goal.id, generation: goal.generation, result: 'cards-projected', data: { cards: ['T1-ONE'] } });
  return goal;
}

function stateFileKinds(root: string): string[] {
  const kinds: string[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else kinds.push(`${path.relative(root, path.dirname(full)).replace(/g-\d{14}-[0-9a-f]{6}/g, 'GOAL')}/${path.extname(name)}`);
    }
  };
  visit(root);
  return kinds.sort();
}

test('run dispatches a plan with its goal identity and accepts only the controller report', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const provider = new MockProvider({ planner: [{ outcome: 'ok', text: 'plan complete' }] });
    const result = await runGoal(goal.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(result.kind, 'plan');
    assert.equal(provider.calls.length, 1);
    assert.match(provider.calls[0]!.prompt, new RegExp(goal.id));
    assert.deepEqual(provider.calls[0]!.allowedTools, ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep']);
    assert.equal(fx.goal(goal.id).state, 'PLAN');
  } finally { fx.cleanup(); }
});

test('persisted pre-review and formal review blocks stop before another provider dispatch', async () => {
  for (const [stage, state] of [['pre', 'BUILD'], ['formal', 'REVIEW_FIX']] as const) {
    const fx = makeFixture();
    try {
      const goal = cardGoal(fx);
      const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
      fx.store.saveCardRun(CardRun.parse({ ...run, state, candidate: { digest: 'candidate-a', sha: 'a', dirty: false }, blockedReceipt: { dodReceipt: 'dod', candidateDigest: 'candidate-a', stage } }));
      const provider = new MockProvider();
      const directive = await runGoal(goal.id, 3, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
      assert.equal(directive.kind, 'wait');
      assert.equal(provider.calls.length, 0);
    } finally { fx.cleanup(); }
  }
});

test('a later review pass clears an older quota hold for the same candidate', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    const round = { cycle: 0, reviewer: 'reviewer', candidateDigest: 'candidate-a', requestedAt: fx.now(), outcome: 'quota-hold', holdUntil: addMs(fx.now(), 60_000) };
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'BUILD', candidate: { digest: 'candidate-a', sha: 'a', dirty: false }, preReview: { rounds: [{ ...round, round: 1 }, { ...round, round: 2, outcome: 'pass', holdUntil: undefined }] } }));
    let polls = 0;
    await runGoal(goal.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls += 1; } });
    assert.equal(polls, 1);
  } finally { fx.cleanup(); }
});

test('a current candidate quota hold stops even when the pool has no reset time', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'WAIT', candidate: { digest: 'candidate-a', sha: 'a', dirty: false }, preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'reviewer', candidateDigest: 'candidate-a', requestedAt: fx.now(), outcome: 'quota-hold', holdUntil: addMs(fx.now(), 60_000) }] } }));
    let polls = 0;
    const directive = await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls += 1; } });
    assert.equal(directive.kind, 'wait');
    assert.equal(polls, 0);
  } finally { fx.cleanup(); }
});

test('invalid current-candidate review hold time fails closed before polling', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'WAIT', candidate: { digest: 'candidate-a', sha: 'a', dirty: false }, preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'pre', candidateDigest: 'candidate-a', requestedAt: fx.now(), outcome: 'quota-hold', holdUntil: '2026-99-99T00:00:00.000Z' }] } }));
    const failures: string[] = [];
    let polls = 0;
    await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls++; }, onFailure: (reason) => failures.push(reason) });
    assert.equal(polls, 0);
    assert.match(failures[0] ?? '', /invalid.*holdUntil/);
  } finally { fx.cleanup(); }
});

test('goal review pool reset holds a waiting card without any queue request', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'WAIT' }));
    fx.queue.savePool({ ...fx.queue.pool(goal.reviewPool, fx.now()), resetAt: addMs(fx.now(), 60_000) });
    let polls = 0;
    await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls++; } });
    assert.equal(fx.queue.list().length, 0);
    assert.equal(polls, 0);
  } finally { fx.cleanup(); }
});

test('invalid saved review pool reset fails closed before polling', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'WAIT' }));
    fx.queue.savePool({ ...fx.queue.pool(goal.reviewPool, fx.now()), resetAt: '2026-99-99T00:00:00.000Z' });
    const failures: string[] = [];
    let polls = 0;
    await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls++; }, onFailure: (reason) => failures.push(reason) });
    assert.equal(polls, 0);
    assert.match(failures[0] ?? '', /invalid.*resetAt/);
  } finally { fx.cleanup(); }
});

test('an old candidate request in another pool does not block the current card', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'WAIT', candidate: { digest: 'new-candidate', sha: 'b', dirty: false } }));
    const pool = `${goal.reviewPool}/formal`;
    fx.queue.savePool({ ...fx.queue.pool(pool, fx.now()), resetAt: addMs(fx.now(), 60_000) });
    fx.queue.enqueue({ pool, repository: fx.repo.key, candidateDigest: 'old-candidate', base: 'main', policyVersion: 'v1', reviewer: 'formal', requester: `${goal.id}:T1-ONE`, deadline: addMs(fx.now(), 120_000), now: fx.now() });
    let polls = 0;
    await runGoal(goal.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls++; } });
    assert.equal(polls, 1);
  } finally { fx.cleanup(); }
});

test('invalid current clock fails before dispatch', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const failures: string[] = [];
    const provider = new MockProvider();
    await runGoal(goal.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: () => '2026-99-99T00:00:00.000Z', onFailure: (reason) => failures.push(reason) });
    assert.equal(provider.calls.length, 0);
    assert.match(failures[0] ?? '', /invalid current timestamp/);
  } finally { fx.cleanup(); }
});

test('ship-stage pool hold survives an earlier pre-review pass', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'WAIT', candidate: { digest: 'candidate-a', sha: 'a', dirty: false }, preReview: { rounds: [{ round: 1, cycle: 0, reviewer: 'pre', candidateDigest: 'candidate-a', requestedAt: fx.now(), outcome: 'pass' }] } }));
    const pool = `${goal.reviewPool}/formal`;
    fx.queue.savePool({ ...fx.queue.pool(pool, fx.now()), resetAt: addMs(fx.now(), 60_000) });
    fx.queue.enqueue({ pool, repository: fx.repo.key, candidateDigest: 'candidate-a', base: 'main', policyVersion: 'v1', reviewer: 'formal', requester: `${goal.id}:T1-ONE`, deadline: addMs(fx.now(), 120_000), now: fx.now() });
    let polls = 0;
    await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls++; } });
    assert.equal(polls, 0);
  } finally { fx.cleanup(); }
});

test('a driver-scoped card runner refuses shipping before the adapter and merge intent', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const card = fx.card('T1-ONE');
    const shipPath = new DryRunShipPath(['merged']);
    let ships = 0;
    const original = shipPath.ship.bind(shipPath);
    shipPath.ship = (...args) => { ships++; return original(...args); };
    const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath, now: fx.now, allowShip: false });
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), card.id));
    r = runner.next(fx.goal(goal.id), card, r.run);
    const ready = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod', redReceipt: 'red', candidateSha: 'a' });
    r = runner.next(fx.goal(goal.id), card, ready);
    assert.equal(r.directive.kind, 'wait');
    assert.equal(r.run.blocker, 'driver-ship-boundary');
    assert.equal(ships, 0);
    assert.equal(fx.ops.list({ goalId: goal.id }).length, 0);
    const provider = new MockProvider();
    await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(provider.calls.length, 0);
  } finally { fx.cleanup(); }
});

test('a review block for a replaced candidate does not stop an ordinary wait', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'BUILD', candidate: { digest: 'new-candidate', sha: 'b', dirty: false }, blockedReceipt: { dodReceipt: 'dod', candidateDigest: 'old-candidate', stage: 'pre' } }));
    let polls = 0;
    await runGoal(goal.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls += 1; } });
    assert.equal(polls, 1);
  } finally { fx.cleanup(); }
});

test('a held review pool stops a waiting card but does not stop unrelated planning', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'WAIT', candidate: { digest: 'candidate-a', sha: 'a', dirty: false } }));
    fx.queue.savePool({ ...fx.queue.pool(goal.reviewPool, fx.now()), resetAt: addMs(fx.now(), 60_000) });
    fx.queue.enqueue({ pool: goal.reviewPool, repository: fx.repo.key, candidateDigest: 'candidate-a', base: 'main', policyVersion: 'v1', reviewer: 'pre', requester: `${goal.id}:T1-ONE`, deadline: addMs(fx.now(), 120_000), now: fx.now() });
    const provider = new MockProvider();
    const directive = await runGoal(goal.id, 3, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(directive.kind, 'wait');
    assert.equal(provider.calls.length, 0);
    const other = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
    await runGoal(other.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(provider.calls.length, 1);
  } finally { fx.cleanup(); }
});

test('provider timeout uses the earlier card deadline', async () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-ONE', title: 'One card' });
    const goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', explicitSize: 'T1', affectedSurfaces: [] });
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-ONE'] } });
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, deadline: addMs(fx.now(), 1000) }));
    const provider = new MockProvider();
    const deadline = fx.controller.next(goal.id);
    assert.equal(deadline.kind, 'run-card');
    if (deadline.kind !== 'run-card') return;
    assert.ok(Date.parse(deadline.cardDeadline) < Date.parse(deadline.deadline));
    const directive = await runGoal(goal.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(directive.kind, 'run-card');
    assert.equal(provider.calls[0]?.timeoutMs, 1000);
  } finally { fx.cleanup(); }
});

test('an expired goal deadline prevents dispatch even when the controller clock is still open', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const provider = new MockProvider();
    const directive = await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: () => addMs(goal.deadlines.goalDeadline, 1) });
    assert.equal(directive.kind, 'plan');
    assert.equal(provider.calls.length, 0);
  } finally { fx.cleanup(); }
});

test('an expired goal returns STOP without provider dispatch', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', affectedSurfaces: [] });
    fx.clock.now = addMs(goal.deadlines.goalDeadline, 1);
    const provider = new MockProvider();
    const directive = await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(directive.kind, 'stop');
    assert.equal(provider.calls.length, 0);
  } finally { fx.cleanup(); }
});

test('max-steps stops after two advancing provider dispatches', async () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: 'T1-ONE', title: 'One card' });
    const goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', explicitSize: 'T1', affectedSurfaces: [] });
    const provider = new MockProvider();
    const complete = provider.complete.bind(provider);
    provider.complete = async (request) => {
      const kind = JSON.parse(request.prompt.slice(request.prompt.indexOf('{'), request.prompt.lastIndexOf('}') + 1)).kind as string;
      if (kind === 'plan') fx.controller.report({ goalId: goal.id, generation: 0, result: 'plan-produced', data: { planRef: 'plans/feature.md' } });
      if (kind === 'project-cards') fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-ONE'] } });
      return complete(request);
    };
    const directive = await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(directive.kind, 'run-card');
    assert.equal(provider.calls.length, 2);
  } finally { fx.cleanup(); }
});

test('an expired card deadline prevents dispatch while the goal waits', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'BUILD', deadline: fx.now() }));
    const provider = new MockProvider();
    let polls = 0;
    const directive = await runGoal(goal.id, 3, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now, sleep: async () => { polls += 1; } });
    assert.equal(directive.kind, 'wait');
    assert.equal(polls, 0);
    assert.equal(provider.calls.length, 0);
  } finally { fx.cleanup(); }
});

test('provider failure prints the same directive without fabricating a report or retrying', async () => {
  for (const outcome of ['quota', 'refusal', 'error', 'malformed'] as const) {
    const fx = makeFixture();
    try {
      const goal = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
      const provider = new MockProvider({ planner: [{ outcome, error: 'unavailable' }] });
      const failures: string[] = [];
      const directive = await runGoal(goal.id, 4, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now, onFailure: (reason) => failures.push(reason) });
      assert.equal(directive.kind, 'plan');
      assert.equal(fx.goal(goal.id).state, 'PLAN');
      assert.equal(provider.calls.length, 1);
      assert.match(failures[0] ?? '', new RegExp(outcome));
    } finally { fx.cleanup(); }
  }
});

test('a provider exception returns the pending directive and records one failure', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const provider = new MockProvider();
    provider.complete = async () => { throw new Error('provider unavailable'); };
    const failures: string[] = [];
    const directive = await runGoal(goal.id, 4, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now, onFailure: (reason) => failures.push(reason) });
    assert.equal(directive.kind, 'plan');
    assert.match(failures[0] ?? '', /provider unavailable/);
    assert.equal(fx.goal(goal.id).state, 'PLAN');
  } finally { fx.cleanup(); }
});

test('null, undefined and malformed provider results fail once without retrying', async () => {
  for (const value of [null, undefined, {}, { outcome: 'unexpected' }]) {
    const fx = makeFixture();
    try {
      const goal = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
      const provider = new MockProvider();
      let calls = 0;
      provider.complete = async () => { calls++; return value as Awaited<ReturnType<typeof provider.complete>>; };
      const failures: string[] = [];
      let thrown: unknown;
      const directive = await runGoal(goal.id, 3, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now, onFailure: (reason) => failures.push(reason) }).catch((error: unknown) => { thrown = error; return undefined; });
      assert.equal(thrown, undefined);
      assert.equal(directive?.kind, 'plan');
      assert.equal(calls, 1);
      assert.equal(failures.length, 1);
      assert.match(failures[0] ?? '', /malformed provider result/);
      assert.equal(fx.goal(goal.id).state, 'PLAN');
    } finally { fx.cleanup(); }
  }
});

test('provider text without a reported transition is an unsuccessful run', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const failures: string[] = [];
    const directive = await runGoal(goal.id, 4, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider({ planner: ['I finished the plan'] }), cwd: fx.tmp, now: fx.now, onFailure: (reason) => failures.push(reason) });
    assert.equal(directive.kind, 'plan');
    assert.match(failures[0] ?? '', /no state transition/);
  } finally { fx.cleanup(); }
});

test('an ordinary wait polls at most max-steps without a provider call', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'BUILD' }));
    const provider = new MockProvider();
    let polls = 0;
    const directive = await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now, sleep: async () => { polls += 1; } });
    assert.equal(directive.kind, 'wait');
    assert.equal(polls, 2);
    assert.equal(provider.calls.length, 0);
  } finally { fx.cleanup(); }
});

test('a wait sleeps only until the earliest active card deadline', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'BUILD', deadline: addMs(fx.now(), 1000) }));
    const delays: number[] = [];
    await runGoal(goal.id, 1, { controller: fx.controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async (ms) => { delays.push(ms); fx.advance(ms); } });
    assert.deepEqual(delays, [1000]);
  } finally { fx.cleanup(); }
});

test('scripted provider drives plan, projection, card, verification and closure through existing commands', async () => {
  const fx = makeFixture();
  const manual = makeFixture();
  try {
    writeCard(fx, { id: 'T1-ONE', title: 'One card' });
    const goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', explicitSize: 'T1', affectedSurfaces: [] });
    const provider = new MockProvider();
    const complete = provider.complete.bind(provider);
    let workerShips = 0;
    provider.complete = async (request) => {
      const directive = JSON.parse(request.prompt.slice(request.prompt.indexOf('{'), request.prompt.lastIndexOf('}') + 1)) as { kind: string };
      if (directive.kind === 'plan') fx.controller.report({ goalId: goal.id, generation: 0, result: 'plan-produced', data: { planRef: 'plans/feature.md' } });
      if (directive.kind === 'project-cards') fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-ONE'] } });
      if (directive.kind === 'run-card') {
        const shipPath = new DryRunShipPath(['merged']);
        shipPath.ship = (...args) => { workerShips++; return new DryRunShipPath(['merged']).ship(...args); };
        const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath, now: fx.now, allowShip: false });
        const card = fx.card('T1-ONE');
        let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), card.id));
        r = runner.next(fx.goal(goal.id), card, r.run);
        const ready = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:T1-ONE', redReceipt: 'red:T1-ONE', candidateSha: 'a' });
        r = runner.next(fx.goal(goal.id), card, ready);
        assert.equal(r.directive.kind, 'wait');
      }
      if (directive.kind === 'verify-arc') fx.controller.report({ goalId: goal.id, generation: 0, result: 'arc-verified', data: { evidence: 'integrated check passed' } });
      return complete(request);
    };
    const boundary = await runGoal(goal.id, 8, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(boundary.kind, 'wait');
    assert.equal(workerShips, 0);
    const operator = fx.runner();
    const card = fx.card('T1-ONE');
    let shipped = operator.next(fx.goal(goal.id), card, fx.store.getCardRun(goal.id, card.id)!);
    assert.equal(shipped.directive.kind, 'close');
    const closed = operator.markClosure(fx.goal(goal.id), card, shipped.run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true }, { skipped: 'fixture: no rule learned' });
    shipped = operator.next(fx.goal(goal.id), card, closed);
    assert.equal(shipped.directive.kind, 'done');
    const directive = await runGoal(goal.id, 8, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(directive.kind, 'done');
    assert.deepEqual(provider.calls.map((call) => JSON.parse(call.prompt.slice(call.prompt.indexOf('{'), call.prompt.lastIndexOf('}') + 1)).kind), ['plan', 'project-cards', 'run-card', 'verify-arc']);
    const cardPrompt = provider.calls[2]!.prompt;
    assert.match(cardPrompt, /context/);
    assert.match(cardPrompt, /pack/);
    assert.match(cardPrompt, new RegExp(goal.id));
    writeCard(manual, { id: 'T1-ONE', title: 'One card' });
    const manualGoal = manual.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', explicitSize: 'T1', affectedSurfaces: [] });
    manual.controller.next(manualGoal.id);
    manual.controller.report({ goalId: manualGoal.id, generation: 0, result: 'plan-produced', data: { planRef: 'plans/feature.md' } });
    manual.controller.next(manualGoal.id);
    manual.controller.report({ goalId: manualGoal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-ONE'] } });
    manual.controller.next(manualGoal.id);
    driveCardToDone(manual, manualGoal.id, 'T1-ONE');
    manual.controller.next(manualGoal.id);
    manual.controller.report({ goalId: manualGoal.id, generation: 0, result: 'arc-verified', data: { evidence: 'integrated check passed' } });
    manual.controller.next(manualGoal.id);
    assert.deepEqual(stateFileKinds(fx.paths.root), stateFileKinds(manual.paths.root));
  } finally { fx.cleanup(); manual.cleanup(); }
});

// AC1: healthy closure is derived; this recovery case exercises the explicit close directive separately.
test('a recoverable close directive delegates missing closure work to the existing card command', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const lease = fx.leases.claim(resourceKeys.card(fx.repo.key, 'T1-ONE'), { operation: 'card:T1-ONE:close', now: fx.now() });
    assert.notEqual(lease.status, 'held');
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'CLOSE', deadline: addMs(fx.now(), 1000), mergeVerified: true, ownerGeneration: lease.lease.generation, closure: { metadata: false, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true } }));
    fx.store.saveGoal(Goal.parse({ ...fx.goal(goal.id), state: 'CLOSE', stages: { ...fx.goal(goal.id).stages, development: 'pass' } }));
    const provider = new MockProvider();
    const complete = provider.complete.bind(provider);
    provider.complete = async (request) => {
      fx.runner().markClosure(fx.goal(goal.id), fx.card('T1-ONE'), fx.store.getCardRun(goal.id, 'T1-ONE')!, { metadata: true });
      return complete(request);
    };
    const directive = await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(directive.kind, 'done');
    assert.equal(provider.calls.length, 1);
    assert.equal(provider.calls[0]?.timeoutMs, 1000);
  } finally { fx.cleanup(); }
});

test('expired CLOSE card deadline prevents provider work', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'CLOSE', deadline: fx.now(), mergeVerified: true, closure: { metadata: false, docSync: true, findings: true, evidence: true, cleanup: true, lessons: true } }));
    fx.store.saveGoal(Goal.parse({ ...fx.goal(goal.id), state: 'CLOSE', stages: { ...fx.goal(goal.id).stages, development: 'pass' } }));
    const provider = new MockProvider();
    const directive = await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(directive.kind, 'close');
    assert.equal(provider.calls.length, 0);
  } finally { fx.cleanup(); }
});

test('invalid ISO-shaped goal deadline fails closed before provider dispatch', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const controller = Object.create(fx.controller) as typeof fx.controller;
    controller.next = () => ({ ...fx.controller.next(goal.id), deadline: '2026-99-99T00:00:00.000Z' });
    const failures: string[] = [];
    const provider = new MockProvider();
    await runGoal(goal.id, 2, { controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now, onFailure: (reason) => failures.push(reason) });
    assert.equal(provider.calls.length, 0);
    assert.match(failures[0] ?? '', /invalid.*timestamp/);
  } finally { fx.cleanup(); }
});

test('invalid wait-until timestamp fails before polling', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, state: 'BUILD' }));
    const controller = Object.create(fx.controller) as typeof fx.controller;
    controller.next = () => ({ ...fx.controller.next(goal.id), kind: 'wait' as const, on: 'test', until: '2026-99-99T00:00:00.000Z' });
    const failures: string[] = [];
    let polls = 0;
    await runGoal(goal.id, 2, { controller, store: fx.store, queue: fx.queue, provider: new MockProvider(), cwd: fx.tmp, now: fx.now, sleep: async () => { polls++; }, onFailure: (reason) => failures.push(reason) });
    assert.equal(polls, 0);
    assert.match(failures[0] ?? '', /invalid.*timestamp/);
  } finally { fx.cleanup(); }
});

test('invalid card deadline fails before dispatch', async () => {
  const fx = makeFixture();
  try {
    const goal = cardGoal(fx);
    const run = fx.controller.ensureCardRun(fx.goal(goal.id), 'T1-ONE');
    fx.store.saveCardRun(CardRun.parse({ ...run, deadline: '2026-99-99T00:00:00.000Z' }));
    const failures: string[] = [];
    const provider = new MockProvider();
    const directive = await runGoal(goal.id, 2, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now, onFailure: (reason) => failures.push(reason) });
    assert.equal(directive.kind, 'run-card');
    assert.equal(provider.calls.length, 0);
    assert.match(failures[0] ?? '', /invalid.*timestamp/);
  } finally { fx.cleanup(); }
});

test('run worker binds the relative parent override as an absolute root in a real child', () => {
  const fx = makeFixture();
  try {
    const nested = path.join(fx.tmp, 'nested');
    mkdirSync(nested);
    const cliUrl = pathToFileURL(path.resolve('src/cli/main.ts')).href;
    const pathsUrl = pathToFileURL(path.resolve('src/state/paths.ts')).href;
    const execUrl = pathToFileURL(path.resolve('src/probes/exec.ts')).href;
    const script = `const {runProviderFor}=await import(${JSON.stringify(cliUrl)}); const {resolveStatePaths}=await import(${JSON.stringify(pathsUrl)}); const {run}=await import(${JSON.stringify(execUrl)}); const root=resolveStatePaths().root; const provider=runProviderFor(root,(_c,_a,opts)=>run(process.execPath,['-e','process.stdout.write(JSON.stringify({result:process.env.AIDLC_STATE_DIR+"|"+process.env.AIDLC_RUN_NO_SHIP}))'],opts)); const result=await provider.complete({role:'planner',prompt:'inspect',system:'',effort:'medium',cwd:${JSON.stringify(fx.tmp)}}); process.stdout.write(JSON.stringify({root,text:result.text}));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: nested, env: { ...process.env, AIDLC_STATE_DIR: '../.aidlc' }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), { root: fx.paths.root, text: `${fx.paths.root}|1` });
  } finally { fx.cleanup(); }
});

test('run worker carries the driver session into a child that replaces Claude identity', () => {
  const fx = makeFixture();
  try {
    const nested = path.join(fx.tmp, 'nested');
    mkdirSync(nested);
    const cliUrl = pathToFileURL(path.resolve('src/cli/main.ts')).href;
    const journalUrl = pathToFileURL(path.resolve('src/state/journal.ts')).href;
    const execUrl = pathToFileURL(path.resolve('src/probes/exec.ts')).href;
    const script = `const {runProviderFor}=await import(${JSON.stringify(cliUrl)}); const {resolveSessionId}=await import(${JSON.stringify(journalUrl)}); const {run}=await import(${JSON.stringify(execUrl)}); const owner=resolveSessionId().session; const provider=runProviderFor(${JSON.stringify(fx.paths.root)},(_c,_a,opts)=>run(process.execPath,['-e','process.stdout.write(JSON.stringify({result:process.env.AIDLC_SESSION+"|"+process.env.CLAUDE_CODE_SESSION_ID}))'],{...opts,env:{...opts.env,CLAUDE_CODE_SESSION_ID:'child-claude'}})); process.env.CLAUDE_CODE_SESSION_ID='mutated-parent'; const result=await provider.complete({role:'planner',prompt:'inspect',system:'',effort:'medium',cwd:${JSON.stringify(fx.tmp)}}); process.stdout.write(JSON.stringify({owner,text:result.text}));`;
    for (const claude of ['parent-claude', undefined]) {
      const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: '../.aidlc' };
      delete env.AIDLC_SESSION;
      delete env.CLAUDE_SESSION_ID;
      if (claude) env.CLAUDE_CODE_SESSION_ID = claude;
      else delete env.CLAUDE_CODE_SESSION_ID;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: nested, env, encoding: 'utf8', timeout: 30_000 });
      assert.equal(child.status, 0, child.stderr);
      const result = JSON.parse(child.stdout) as { owner: string; text: string };
      if (claude) assert.equal(result.owner, claude);
      else assert.match(result.owner, /^default-/);
      assert.equal(result.text, `${result.owner}|child-claude`);
    }
  } finally { fx.cleanup(); }
});

test('driver worker refuses explicit scaffold ship before task execution', () => {
  const fx = makeFixture({ config: { shipPath: 'scaffold' } });
  try {
    writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'scaffold' }));
    const output = spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'card', 'ship', 'T1-ONE'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_RUN_NO_SHIP: '1' }, encoding: 'utf8', timeout: 30_000 });
    assert.notEqual(output.status, 0);
    assert.match(output.stderr, /separate operator invocation/);
  } finally { fx.cleanup(); }
});

test('driver child card next stops at ship boundary without invoking merge', () => {
  const fx = makeFixture({ actor: { session: 'win-A', host: hostname(), pid: 1, processStart: new Date().toISOString() } });
  try {
    fx.clock.now = new Date().toISOString();
    writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'dry-run', cardsDir: 'specs/tasks' }));
    const goal = cardGoal(fx);
    const card = fx.card('T1-ONE');
    const runner = fx.runner();
    let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), card.id));
    r = runner.next(fx.goal(goal.id), card, r.run);
    runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod', redReceipt: 'red', candidateSha: 'a' });
    const output = spawnSync(process.execPath, [path.resolve('src/cli/main.ts'), 'card', 'next', 'T1-ONE', '--goal', goal.id, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_RUN_NO_SHIP: '1', AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 30_000 });
    assert.equal(output.status, 0, output.stderr);
    assert.equal(JSON.parse(output.stdout).directive.kind, 'wait');
    assert.equal(fx.store.getCardRun(goal.id, card.id)?.blocker, 'driver-ship-boundary');
    assert.equal(fx.ops.list({ goalId: goal.id }).length, 0);
  } finally { fx.cleanup(); }
});

test('run CLI rejects invalid limits and text-only providers before dispatch', () => {
  const fx = makeFixture({ config: { provider: 'mock' } });
  try {
    const goal = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const main = path.resolve('src/cli/main.ts');
    const invoke = (limit: string) => spawnSync(process.execPath, [main, 'run', '--goal', goal.id, '--max-steps', limit, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' }, encoding: 'utf8', timeout: 30_000 });
    assert.match(invoke('0').stderr, /positive integer/);
    assert.match(invoke('NaN').stderr, /positive integer/);
    assert.match(invoke('1.5').stderr, /positive integer/);
    assert.match(invoke('9007199254740992').stderr, /positive integer/);
    assert.match(invoke('2').stderr, /command-capable/);
  } finally { fx.cleanup(); }
});

test('run help and a terminal goal print the directive without starting a provider', () => {
  const fx = makeFixture({ config: { provider: 'claude-code' } });
  try {
    writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ provider: 'claude-code', cardsDir: 'specs/tasks' }));
    const main = path.resolve('src/cli/main.ts');
    const env = { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: 'win-A' };
    const help = spawnSync(process.execPath, [main, 'run', '--help'], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(help.status, 0);
    assert.match(help.stdout, /--max-steps/);
    const goal = fx.controller.createGoal({ text: 'Create a useful feature', source: 'natural-language', affectedSurfaces: [] });
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'cancelled' } });
    const output = spawnSync(process.execPath, [main, 'run', '--goal', goal.id, '--json'], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(output.status, 0);
    assert.equal(JSON.parse(output.stdout).kind, 'stop');
  } finally { fx.cleanup(); }
});

test('ask, checkpoint, release, done and stop return without provider dispatch', async () => {
  for (const kind of ['ask', 'checkpoint', 'release', 'done', 'stop'] as const) {
    const fx = makeFixture();
    try {
      let goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', explicitSize: kind === 'checkpoint' ? 'T2' : 'T1', affectedSurfaces: [] });
      if (kind === 'ask') fx.store.saveGoal(Goal.parse({ ...goal, routing: { ...goal.routing, ambiguity: 'Choose a scope' } }));
      if (kind === 'checkpoint') {
        writeCard(fx, { id: 'T1-ONE', title: 'One card' });
        fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T1-ONE'] } });
      }
      if (kind === 'release') fx.store.saveGoal(Goal.parse({ ...goal, state: 'DELIVER', target: 'package' }));
      if (kind === 'done') fx.store.saveGoal(Goal.parse({ ...goal, state: 'DONE', terminal: true }));
      if (kind === 'stop') fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'cancelled' } });
      const provider = new MockProvider();
      const directive = await runGoal(goal.id, 4, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
      assert.equal(directive.kind, kind);
      assert.equal(provider.calls.length, 0);
    } finally { fx.cleanup(); }
  }
});

test('a changed goal generation returns the new directive without another provider call', async () => {
  const fx = makeFixture();
  try {
    const goal = fx.controller.createGoal({ text: 'Add a useful feature', source: 'natural-language', affectedSurfaces: [] });
    const provider = new MockProvider();
    const complete = provider.complete.bind(provider);
    provider.complete = async (request) => {
      fx.controller.report({ goalId: goal.id, generation: 0, result: 'cancel', data: { detail: 'replaced' } });
      fx.controller.report({ goalId: goal.id, generation: 0, result: 'resume', data: { reason: 'new generation' } });
      return complete(request);
    };
    const directive = await runGoal(goal.id, 4, { controller: fx.controller, store: fx.store, queue: fx.queue, provider, cwd: fx.tmp, now: fx.now });
    assert.equal(directive.generation, 1);
    assert.equal(provider.calls.length, 1);
  } finally { fx.cleanup(); }
});
