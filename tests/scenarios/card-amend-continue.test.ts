// Card T0-AMEND-CONTINUE-TEST (issue 417): `aidlc card amend` and `aidlc card continue` on one run stopped for review.
// The sequence docs/OPERATIONS.md (Amendments) names: four R3 blocks stop the card, the owner changes the card,
// the amendment is recorded, the stop is lifted, the amended candidate is reviewed and ships, and the audit is clean.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, T0, type CardSpec } from './_harness.ts';
import { hostName } from '../../src/state/paths.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { amendedDigest } from '../../src/core/contract.ts';

type Stored = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const [CARD, FILE, BY, SESSION] = ['T1-ARC', 'src/t1-arc.ts', 'the owner', 'card-amend-continue'];
const FAR = '2099-01-01T00:00:00.000Z';
const SPEC: CardSpec = { id: CARD, title: 'amend then continue', allowPaths: [FILE], requirements: ['R1. The change shall hold.'], acceptance: ['1. change holds. [R1]'], budget: 80 };
const REWORDED = { requirements: ['R1. The change shall hold twice.'] };
const CONFIG = { gateRequired: true, formalReview: { command: ['fake-r3', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false, secondPass: false } };
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const block = (text: string) => { const reasons = [`[spec] 6 tests @ ${FILE}:1: ${text} -> add one`]; return JSON.stringify({ verdict: 'block', reasons, axes: { spec: { verdict: 'block', reasons }, standards: { verdict: 'pass', reasons: [] } } }) + '\n'; };

/** A one-card goal under a command reviewer, the loop's moves on it and the CLI on its state directory. */
function setup(fx: ReturnType<typeof makeFixture>) {
  const verdicts: string[] = [];
  const ship = new DryRunShipPath(['merged']);
  const script = scriptedRunner({ 'git diff --name-only': () => ({ stdout: `${FILE}\u0000` }), 'git diff': () => ({ stdout: `diff --git a/${FILE} b/${FILE}\n+export const x = 1;\n` }), 'fake-r3': () => ({ stdout: verdicts.shift()! }) });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: script });
  writeCard(fx, SPEC);
  const goal = goalForCards(fx, [CARD]);
  writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ cardsDir: 'specs/tasks', shipPath: 'dry-run', worktreeRoot: path.join(fx.tmp, 'wt'), ...CONFIG }));
  const g = () => fx.goal(goal.id);
  const card = () => fx.card(CARD);
  const run = () => fx.store.getCardRun(goal.id, CARD)!;
  const next = () => runner.next(g(), card(), run()).directive as Stored;
  const attempt = (sha: string) => runner.recordAttempt(g(), card(), run(), { outcome: 'success', dodReceipt: `dod:${sha}`, redReceipt: 'red:1', candidateSha: sha });
  const review = () => runner.formalReview(g(), card(), run());
  const env = { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: SESSION };
  const cli = (...args: string[]) => spawnSync(process.execPath, [MAIN, ...args, '--goal', goal.id], { cwd: fx.tmp, env, encoding: 'utf8', timeout: 120_000, windowsHide: true });
  const events = () => readFileSync(path.join(fx.paths.journal, `${goal.id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Stored);
  /** Four R3 blocks, each with a new finding: the fourth stops the card for review, and `aidlc next` stops the goal for it. */
  const stoppedForReview = async () => {
    runner.next(g(), card(), fx.controller.ensureCardRun(g(), CARD));
    assert.equal(next()['kind'], 'build');
    fx.store.updateCardRun(goal.id, CARD, (r) => ({ ...r!, deadline: FAR }));
    verdicts.push(...['no RED', 'no boundary row', 'no error row', 'no fault row'].map(block));
    for (const n of [1, 2, 3, 4]) { attempt(`sha-${n}`); next(); await review(); }
    assert.deepEqual([next()['kind'], run().stop?.reason, run().state, run().review.substantiveDecisions], ['stop', 'review', 'STOP', 4]);
    assert.deepEqual([(fx.controller.next(goal.id) as Stored)['stop']?.reason, g().state], ['review', 'STOP']);
  };
  const withdraw = (cause: string) => runner.withdrawCandidate(g(), card(), run(), cause);
  const changeCard = (delta: Partial<CardSpec>) => writeCard(fx, { ...SPEC, ...delta });
  return { goal, g, run, next, attempt, review, withdraw, verdicts, ship, cli, events, stoppedForReview, changeCard };
}

async function workflow(candidateAfter: string) {
  const fx = makeFixture({ config: CONFIG, actor: { session: SESSION, pid: 1, processStart: T0, host: hostName() } });
  try {
    const s = setup(fx);
    await s.stoppedForReview();
    const before = s.run();

    // 1. The owner changes the card; the amendment is recorded on the stopped goal and names the next command.
    s.changeCard(REWORDED);
    const amend = s.cli('card', 'amend', CARD, '--by', BY, '--reason', 'requirement reworded after the fourth block');
    assert.equal(amend.status, 0, amend.stderr);
    const amended = JSON.parse(amend.stdout) as Stored;
    assert.deepEqual([amended['state'], amended['amendment'].revision, amended['amendment'].changed, amended['amendment'].invalidated], ['STOP', 1, ['requirements'], ['review']]);
    assert.ok(String(amended['next']).includes(`aidlc card continue ${CARD}`), amended['next']);
    assert.deepEqual([s.run().state, s.run().stop, s.g().state, s.run().review.substantiveDecisions], ['STOP', before.stop, 'STOP', 4]);
    // The amendment leaves the four decisions exactly as they were before it.
    assert.equal(before.review.invocations.length, 4);
    assert.deepEqual(s.run().review.invocations, before.review.invocations);

    // 2. The stop is lifted: one further decision, the goal re-admitted.
    const cont = s.cli('card', 'continue', CARD, '--by', BY, '--reason', 'the amended card gets one more decision');
    assert.equal(cont.status, 0, cont.stderr);
    const continuations = s.run().continuations ?? [];
    assert.deepEqual([s.run().stop, continuations.length, continuations[0]?.admits, s.g().state === 'STOP'], [undefined, 1, 5, false]);
    assert.equal((s.run().amendments ?? []).length, 1);

    // The continuation adds `stopLifted`, by the owner, to the stopping decision (the fourth) and changes nothing else of the four.
    const lifted = s.run().review.invocations;
    const liftedBy = lifted[3]?.stopLifted;
    assert.equal(liftedBy?.by, BY);
    assert.ok(before.review.invocations[3]?.stopReview && !before.review.invocations[3]?.stopLifted);
    assert.deepEqual(lifted, before.review.invocations.map((i, n) => (n === 3 ? { ...i, stopLifted: liftedBy } : i)));

    // 3. The amended candidate is the blocked commit under a new digest, with its DoD receipt: the loop asks for its review, decision 5 of 5.
    const first = s.next();
    assert.deepEqual([first['kind'], String(first['narration']).includes('decision 5/5'), s.run().candidate?.sha, s.run().candidate?.digest], ['review', true, 'sha-4', amendedDigest('sha-4', 1)]);
    if (candidateAfter !== 'sha-4') {
      // The amended card needs a code change: a new attempt is refused while the success stands, and the refusal names the withdrawal.
      assert.throws(() => s.attempt(candidateAfter), /episode already succeeded; ship the candidate instead, or, while no R3 decision has decided it, withdraw it first with `aidlc card withdraw T1-ARC/);
      s.withdraw('the amended requirement needs a code change');
      assert.deepEqual([s.next()['kind'], s.run().review.substantiveDecisions], ['build', 4]);
      s.attempt(candidateAfter);
      assert.equal(s.run().candidate?.digest, amendedDigest(candidateAfter, 1));
    }
    s.verdicts.push(PASS);
    assert.equal(s.next()['kind'], 'review');
    const reviewed = await s.review();
    const invocations = reviewed.run.review.invocations;
    assert.deepEqual([reviewed.run.review.substantiveDecisions, invocations.at(-1)?.outcome, invocations.at(-1)?.candidateDigest], [5, 'pass', amendedDigest(candidateAfter, 1)]);
    // The four earlier decisions are as they were after the continuation: the pre-amend records with the stop lifted on the fourth.
    assert.deepEqual(invocations.slice(0, 4), lifted);

    // 4. The pass ships and the merge is verified.
    assert.deepEqual([s.next()['kind'], s.run().mergeVerified, s.ship.requests.map((q) => q.candidateSha)], ['close', true, [candidateAfter]]);

    // 5. The journal holds the amendment note, the card's re-admission and the goal's, and the audit reports no work after a terminal state.
    const ev = s.events();
    assert.equal(ev.filter((e) => e['type'] === 'NOTE' && e['data']?.amendment).length, 1);
    assert.equal(ev.filter((e) => e['type'] === 'CARD_STATE' && e['data']?.continuation).length, 1);
    assert.equal(ev.filter((e) => e['type'] === 'GOAL_STATE' && e['data']?.continuation).length, 1);
    const audit = s.cli('audit', 'verify', '--json');
    assert.deepEqual([audit.status, audit.signal], [0, null], `${audit.stdout}${audit.stderr}`);
    const reports = JSON.parse(audit.stdout) as Stored[];
    assert.deepEqual(reports.map((x) => [x['goalId'], x['journal'].ok, x['journal'].events > 0, (x['findings'] as Stored[]).filter((f) => f['code'] === 'WORK_AFTER_TERMINAL')]), [[s.goal.id, true, true, []]]);
  } finally {
    fx.cleanup();
  }
}

test('T0-AMEND-CONTINUE-TEST: amend at a review stop, continue, the same blocked commit: the loop asks for decision 5 on the amended candidate; a pass ships; audit clean', () => workflow('sha-4'));
test('T0-AMEND-CONTINUE-TEST: amend at a review stop, continue, the amended card needs a code change: withdraw, build, decision 5 on the new commit passes, ships; audit clean', () => workflow('sha-5'));
