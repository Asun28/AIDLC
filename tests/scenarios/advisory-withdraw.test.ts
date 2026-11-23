/**
 * T0-ADVISORY-WITHDRAW (issue 449): a candidate whose last R3 decision is an advisory (non-merge-blocking) block can be
 * withdrawn, so a fix of the advisory finding goes back through the DoD and its own R3 decision; and `card next` at SHIP
 * ships nothing while the review checkout HEAD is not the bound candidate. Real git in a temporary repository, a scripted
 * reviewer and the dry-run ship path, which merges whatever it is handed, so a ship on main is observable as a merge.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import type { CardRun } from '../../src/core/types.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';

const CARD = 'T0-AW';
const FILE = 'src/t0-aw.ts';
const FINDING = 'the value is unchecked, an introduced defect';
const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
const STANDARDS = `[standards] 9 error handling @ ${FILE}:1: the value is unchecked -> check it`;
const ADVISORY = `${JSON.stringify({ verdict: 'block', reasons: [STANDARDS], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'block', reasons: [STANDARDS] } } })}\n`;
const SPEC = `[spec] 6 tests missing @ ${FILE}:1: no test covers the value -> add one`;
const BLOCKING = `${JSON.stringify({ verdict: 'block', reasons: [SPEC], axes: { spec: { verdict: 'block', reasons: [SPEC] }, standards: { verdict: 'pass', reasons: [] } } })}\n`;
const CONFIG = {
  gateRequired: false,
  formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false },
};

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** The next commit of the card branch. */
function commit(fx: Fixture, n: number): string {
  mkdirSync(path.join(fx.tmp, 'src'), { recursive: true });
  writeFileSync(path.join(fx.tmp, FILE), `export const v = ${n};\n`);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', `candidate ${n}`]);
  return git(fx.tmp, ['rev-parse', 'HEAD']);
}

/** A card with R3 on a real repository at `fx.tmp`, on the card branch; `verdicts` feed the reviewer in order, the last repeating. */
function setup(verdicts: string[]) {
  const fx = makeFixture({ config: CONFIG });
  writeCard(fx, { id: CARD, title: 'advisory withdrawal', allowPaths: [FILE] });
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  git(fx.tmp, ['checkout', '-q', '-b', CARD]);
  const queue = [...verdicts];
  const reviewer = scriptedRunner({ 'fake-r3': () => ({ stdout: queue.length > 1 ? queue.shift()! : queue[0]! }) });
  const runner: SyncRunner = (command, args, options) => (command === 'git' ? runSync(command, args, options) : reviewer(command, args, options));
  const ship = new DryRunShipPath(['merged', 'merged']);
  const cardRunner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner });
  const goal = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [] }, { cards: [CARD] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [CARD] } });
  const card = fx.card(CARD);
  const g = () => fx.goal(goal.id);
  const stored = (): CardRun => fx.store.getCardRun(goal.id, CARD)!;
  const first = cardRunner.next(g(), card, fx.controller.ensureCardRun(g(), CARD));
  cardRunner.next(g(), card, first.run);
  const next = () => cardRunner.next(g(), card, stored());
  const bind = (sha: string, n: number): CardRun => cardRunner.recordAttempt(g(), card, stored(), { outcome: 'success', dodReceipt: `dod:${n}`, redReceipt: 'red:1', candidateSha: sha });
  const review = () => cardRunner.formalReview(g(), card, stored());
  const withdraw = (): CardRun => cardRunner.withdrawCandidate(g(), card, stored(), FINDING);
  const dispute = (): CardRun => cardRunner.disputeFinding(g(), card, stored(), 'F1', 'tests/t0-aw.test.ts covers the value');
  const merges = () => fx.ops.list({ goalId: goal.id, cardId: CARD, kind: 'merge' });
  const events = () => fx.events(goal.id).length;
  return { fx, goalId: goal.id, stored, next, bind, review, withdraw, dispute, merges, events };
}

async function withSetup(verdicts: string[], body: (s: ReturnType<typeof setup>) => Promise<void>): Promise<void> {
  const s = setup(verdicts);
  try {
    await body(s);
  } finally {
    s.fx.cleanup();
  }
}

/** Bind `c1`, take it to its first R3 decision and return the outcome. */
async function decideFirst(s: ReturnType<typeof setup>, c1: string): Promise<string> {
  s.bind(c1, 1);
  const directive = s.next().directive;
  assert.equal(directive.kind, 'review', directive.narration);
  return (await s.review()).classified.outcome;
}

test('T0-ADVISORY-WITHDRAW acceptance 1: after an advisory R3 block a moved HEAD is not shipped, and card next names the withdrawal [R3]', () =>
  withSetup([ADVISORY], async (s) => {
    const c1 = commit(s.fx, 1);
    assert.equal(await decideFirst(s, c1), 'block-advisory');
    const c2 = commit(s.fx, 2);
    const before = JSON.stringify(s.stored());
    const { directive } = s.next();
    assert.equal(directive.kind, 'wait', directive.narration);
    if (directive.kind === 'wait') {
      assert.equal(directive.on, 'candidate-moved');
      assert.equal(directive.pollSeconds, 0);
    }
    for (const text of [c1.slice(0, 12), c2.slice(0, 12), `aidlc card withdraw ${CARD} --cause`]) assert.ok(directive.narration.includes(text), `${text} in ${directive.narration}`);
    assert.deepEqual(s.merges(), [], 'no merge operation is recorded');
    assert.equal(s.stored().review.noVerdictRetriesUsed, 0);
    assert.equal(s.stored().mergeVerified, false);
    assert.equal(JSON.stringify(s.stored()), before, 'the stored run is unchanged');
  }));

test('T0-ADVISORY-WITHDRAW acceptance 2: an advisory block admits the withdrawal, and the fix gets its own R3 decision before the ship [R1] [R2]', () =>
  withSetup([ADVISORY, PASS], async (s) => {
    const c1 = commit(s.fx, 1);
    assert.equal(await decideFirst(s, c1), 'block-advisory');
    const c2 = commit(s.fx, 2);
    const withdrawn = s.withdraw();
    assert.equal(withdrawn.state, 'BUILD');
    assert.deepEqual([withdrawn.pendingRepair?.kind, withdrawn.pendingRepair?.detail], ['withdrawn', FINDING]);
    assert.equal(withdrawn.effort?.attempts.at(-1)?.cause, `withdrawn: ${FINDING}`);
    const repair = s.next().directive;
    assert.equal(repair.kind, 'build', repair.narration);
    s.bind(c2, 2);
    const review = s.next().directive;
    assert.equal(review.kind, 'review', review.narration);
    if (review.kind === 'review') assert.equal(review.decision, 2);
    assert.equal((await s.review()).classified.outcome, 'pass');
    s.next();
    assert.equal(s.stored().mergeVerified, true, 'the reviewed fix ships');
    assert.equal(s.merges().length, 1);
    assert.equal(s.merges()[0]?.candidateDigest, s.stored().candidate?.digest);
    assert.equal(s.stored().candidate?.sha, c2);
  }));

for (const [name, verdict, outcome] of [
  ['a merge-blocking spec block', BLOCKING, 'block-defect'],
  ['a pass', PASS, 'pass'],
] as const) {
  test(`T0-ADVISORY-WITHDRAW acceptance 3: ${name} still refuses the withdrawal with nothing written [R1]`, () =>
    withSetup([verdict], async (s) => {
      const c1 = commit(s.fx, 1);
      assert.equal(await decideFirst(s, c1), outcome);
      if (outcome === 'block-defect') {
        // The block reopens the episode; a dispute of its one finding settles the repair, so the success binds the candidate again.
        s.next();
        s.dispute();
        s.next();
        assert.equal(s.stored().effort?.terminal, 'succeeded');
      }
      const run = JSON.stringify(s.stored());
      const events = s.events();
      assert.throws(() => s.withdraw(), /R3 decided candidate/);
      assert.equal(JSON.stringify(s.stored()), run, 'the stored run is unchanged');
      assert.equal(s.events(), events, 'the journal is unchanged');
    }));
}

for (const moved of [false, true]) {
  test(`T0-ADVISORY-WITHDRAW acceptance 3: with HEAD ${moved ? 'moved past' : 'at'} the candidate after a pass, card next ships as on main [R3]`, () =>
    withSetup([PASS], async (s) => {
      const c1 = commit(s.fx, 1);
      assert.equal(await decideFirst(s, c1), 'pass');
      if (moved) commit(s.fx, 2);
      const { directive } = s.next();
      assert.ok(directive.kind !== 'wait' || directive.on !== 'candidate-moved', directive.narration);
      assert.equal(s.stored().mergeVerified, true);
      assert.equal(s.merges().length, 1);
    }));
}
