// Card T0-AMEND-DELTA (issue 415): a decision recorded before an amendment that invalidates review is no delta base, so the next decision on the amended candidate is judged as a first decision.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeFixture, writeCard, goalForCards, InjectedShipPath, type CardSpec } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { summarizeReviews } from '../../src/review/stats.ts';

const [CARD, FILE, OTHER] = ['T0-AD', 'src/t0-ad.ts', 'src/t0-ad2.ts'];
const SPEC: CardSpec = { id: CARD, title: 'amend delta', allowPaths: [FILE, OTHER], requirements: ['R1. The delta shall hold.'], acceptance: ['1. delta holds. [R1]'], budget: 80 };
const REQUIREMENTS: Partial<CardSpec> = { requirements: ['R1. The delta shall hold twice.'] };
const DOD: Partial<CardSpec> = { dodCommand: 'node --test tests/other.test.ts' };
const DELTA = '## Delta since the last reviewed candidate';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const r3Block = (reason: string) => JSON.stringify({ verdict: 'block', reasons: [reason], axes: { spec: { verdict: 'block', reasons: [reason] }, standards: { verdict: 'pass', reasons: [] } } }) + '\n';
const r2Block = (reason: string) => JSON.stringify({ verdict: 'block', reasons: [reason] }) + '\n';
const [FIRST, SECOND, THIRD] = [`[spec] 6 tests @ ${FILE}:1: no RED -> add one`, `[spec] 14 scope fidelity @ ${FILE}:5: the amended R1 is not met -> meet it`, `[standards] 9 error handling @ ${FILE}:9: swallowed error -> rethrow`];

/** `body` on a one-card goal whose R3 reviewer answers `r3` in order, and whose R2 reviewer answers `r2` when given (R2 configured). */
async function scenario(r3: string[], body: (s: ReturnType<typeof setup>) => Promise<void> | void, r2?: string[]) {
  const preReview = r2 ? { preReview: { command: ['fake-r2', '{instructions}'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false } } : {};
  const fx = makeFixture({ config: { gateRequired: true, ...preReview, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } } });
  try { await body(setup(fx, [...r3], [...(r2 ?? [])])); } finally { fx.cleanup(); }
}

function setup(fx: ReturnType<typeof makeFixture>, r3: string[], r2: string[]) {
  const prompts: Array<{ stage: 'pre' | 'formal'; text: string }> = [];
  const script = scriptedRunner({
    // The delta since sha-1 is its own range (it names OTHER); the generic keys serve the full diff against the base.
    'git diff --name-only -z sha-1...HEAD': { stdout: `${OTHER}\u0000` },
    'git diff --text sha-1...HEAD': { stdout: `diff --git a/${OTHER} b/${OTHER}\n+export const y = 1;\n` },
    'git diff --name-only': { stdout: `${FILE}\u0000${OTHER}\u0000` },
    'git diff': { stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` },
    'fake-r3': (args) => { prompts.push({ stage: 'formal', text: args[0] ?? '' }); return { stdout: r3.shift() ?? PASS }; },
    'fake-r2': (args) => { prompts.push({ stage: 'pre', text: args[0] ?? '' }); return { stdout: r2.shift() ?? '{"verdict":"pass","reasons":[]}\n' }; },
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new InjectedShipPath(['merged'], ''), now: fx.now, runner: script });
  writeCard(fx, SPEC);
  const goal = goalForCards(fx, [CARD]);
  let card = fx.card(CARD);
  const g = () => fx.goal(goal.id);
  const persisted = () => fx.store.getCardRun(goal.id, CARD)!;
  runner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  const kind = () => runner.next(g(), card, persisted()).directive.kind;
  return {
    fx, runner, persisted, kind,
    /** A success with candidate `sha`, one minute after the last step. */
    attempt: (sha: string) => { fx.advance(60_000); runner.recordAttempt(g(), card, persisted(), { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha }); },
    review: async () => { fx.advance(60_000); assert.equal(kind(), 'review'); return runner.formalReview(g(), card, persisted()); },
    pre: async () => { fx.advance(60_000); assert.equal(kind(), 'pre-review'); return runner.preReview(g(), card, persisted()); },
    /** The card file committed with `delta` and amended on the run, `stepMs` (one minute) after the last step. */
    amend: (delta: Partial<CardSpec>, stepMs = 60_000) => { fx.advance(stepMs); writeCard(fx, { ...SPEC, ...delta }); card = fx.card(CARD); return runner.amendCard(g(), card, { by: 'the owner', reason: 'requirement reworded' }); },
    prompt: (stage: 'pre' | 'formal') => [...prompts].reverse().find((p) => p.stage === stage)!.text,
  };
}

/** The new findings of the run with their outsideDelta mark, by id. */
const marks = (run: { findings: Array<{ id: string; outsideDelta?: boolean }> }) => run.findings.map((f) => [f.id, f.outsideDelta ?? false]);

test('issue 415 - R3 on the amended candidate of the same commit marks no first-round miss', () => scenario([r3Block(FIRST), r3Block(SECOND)], async (s) => {
  s.attempt('sha-1');
  await s.review();
  assert.equal(s.persisted().findings.length, 1);
  assert.deepEqual(s.amend(REQUIREMENTS).amendments.map((a) => a.invalidated), [['review']]);
  s.attempt('sha-1');
  await s.review();
  assert.deepEqual(marks(s.persisted()), [['F1', false], ['F2', false]], 'the finding the amended contract raises is no first-round miss');
  assert.ok(!s.prompt('formal').includes(DELTA), 'the decision after the amendment receives no delta');
  assert.equal(summarizeReviews([s.persisted()], [])[0]!.findings.firstRoundMiss, 0);
}));

test('R2 on the amended candidate of the same commit marks no first-round miss', () => scenario([], async (s) => {
  s.attempt('sha-1');
  await s.pre();
  assert.equal(s.persisted().findings.length, 1);
  s.amend(REQUIREMENTS);
  s.attempt('sha-1');
  await s.pre();
  assert.deepEqual(marks(s.persisted()), [['F1', false], ['F2', false]], 'the finding the amended contract raises is no first-round miss');
  assert.ok(!s.prompt('pre').includes(DELTA), 'the round after the amendment receives no delta');
}, [r2Block(FIRST), r2Block(SECOND)]));

test('a ship-path decision after an amendment is bound to no delta', async () => {
  await scenario([PASS], async (s) => {
    s.attempt('sha-1');
    await s.review();
    s.amend(REQUIREMENTS);
    assert.equal(s.runner.shipBindings(s.persisted()).deltaPaths, undefined, 'an amendment invalidating review leaves no delta base');
  });
  await scenario([PASS], async (s) => {
    s.attempt('sha-1');
    await s.review();
    s.amend(REQUIREMENTS, 0);
    assert.equal(s.runner.shipBindings(s.persisted()).deltaPaths, undefined, 'a decision requested at the instant of the amendment is no delta base');
  });
  await scenario([PASS], async (s) => {
    s.attempt('sha-1');
    await s.review();
    assert.deepEqual(s.amend(DOD).amendments.map((a) => a.invalidated), [['dod']]);
    assert.deepEqual(s.runner.shipBindings(s.persisted()).deltaPaths, [], 'an amendment invalidating only dod keeps the decision a delta base');
  });
});

test('an amendment followed by a repair commit gives no delta either', () => scenario([r3Block(FIRST), r3Block(SECOND)], async (s) => {
  s.attempt('sha-1');
  await s.review();
  s.amend(REQUIREMENTS);
  s.attempt('sha-2');
  await s.review();
  assert.ok(!s.prompt('formal').includes(DELTA), 'the decision on the repair commit receives no delta');
  assert.deepEqual(marks(s.persisted()), [['F1', false], ['F2', false]], 'no finding is marked outside a delta');
}));

test('a decision after the amendment is the delta base again', () => scenario([r3Block(FIRST), r3Block(SECOND), r3Block(THIRD)], async (s) => {
  s.attempt('sha-1');
  await s.review();
  s.amend(REQUIREMENTS);
  s.attempt('sha-1');
  await s.review();
  const run = s.runner.disputeFinding(s.fx.goal(s.persisted().goalId), s.fx.card(CARD), s.persisted(), 'F2', 'the amended R1 is met at src/t0-ad.ts:5');
  assert.equal(run.findings.find((f) => f.id === 'F2')?.disposition, 'disputed');
  await s.review();
  assert.match(s.prompt('formal'), /## Delta since the last reviewed candidate\n[^\n]*no change since the last reviewed candidate/i, 'decision 3 receives the no-change note');
  assert.equal(s.persisted().findings.find((f) => f.id === 'F3')?.outsideDelta, true, 'its new finding is a first-round miss');
}));
