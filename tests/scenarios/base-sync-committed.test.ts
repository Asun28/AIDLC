import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyShipOutput, DryRunShipPath, type ShipRequest, type ShipResult } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { makeFixture, writeCard } from './_harness.ts';

const WT = 'D:/wt/AIDLC/T0-BSC';
/** The base-sync lines the GitHub path prints for each outcome of the CHANGELOG merge, after git's own conflict lines. */
const SENTINEL_LINE = {
  committed: `[SHIP-BASE-SYNC-COMMITTED] the CHANGELOG.md merge is committed in ${WT} but its commit could not be read back (exit 128): fatal: bad HEAD; read the merge from HEAD in ${WT}`,
  merged: `[SHIP-BASE-SYNC-MERGED] refs/remotes/origin/main conflicted with HEAD sha-1 only in entries both sides added to the Unreleased section of CHANGELOG.md; merged by keeping both, the card's first, as ${'c'.repeat(40)}`,
  conflict: `[SHIP-BASE-SYNC-CONFLICT] refs/remotes/origin/main conflicts with HEAD sha-1 in CHANGELOG.md, src/x.ts; the merge is left in ${WT} for the merge-conflicts skill`,
} as const;

/** A ship path whose base sync ends with the given base-sync line (card T0-BASE-SYNC-CHANGELOG-EDGES). */
class BaseSyncShipPath extends DryRunShipPath {
  private readonly line: string;
  constructor(line: string) {
    super(['merged']);
    this.line = line;
  }
  override ship(req: ShipRequest): ShipResult {
    this.requests.push(req);
    const now = new Date().toISOString();
    const stdout = ['Auto-merging CHANGELOG.md', 'CONFLICT (content): Merge conflict in CHANGELOG.md', 'Automatic merge failed; fix conflicts and then commit the result.', this.line, '[SAGA-FAIL]'].join('\n');
    return classifyShipOutput({ command: 'dry-run', args: [req.cardId], cwd: '', exitCode: 1, signal: null, timedOut: false, stdout, stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '' });
  }
}

/** A card whose R2 and R3 pass on sha-1, then shipped once through a base sync that ends with `line`. */
async function shipOnce(line: string) {
  const fx = makeFixture({ config: { gateRequired: true, preReview: { command: ['fake-r2'], reviewer: 'fake-r2', rounds: 3, timeoutMs: 1000, onExhausted: 'stop', shell: false }, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  const PASS = '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n';
  const script = scriptedRunner({
    'git diff --name-only': { stdout: 'src/t0-bsc.ts\u0000' },
    'git diff': { stdout: 'diff --git a/src/t0-bsc.ts b/src/t0-bsc.ts\n+export const bsc = 1;\n' },
    'fake-r2': { stdout: PASS },
    'fake-r3': { stdout: PASS },
  });
  const runner = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new BaseSyncShipPath(line), now: fx.now, runner: script });
  writeCard(fx, { id: 'T0-BSC', title: 'base-sync committed', allowPaths: ['src/t0-bsc.ts'] });
  const goal = fx.controller.createGoal({ text: 'implement T0-BSC', source: 'card', ref: 'T0-BSC', affectedSurfaces: [] }, { cards: ['T0-BSC'] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: ['T0-BSC'] } });
  const card = fx.card('T0-BSC');
  const g = () => fx.goal(goal.id);
  let r = runner.next(g(), card, fx.controller.ensureCardRun(g(), 'T0-BSC'));
  let run = runner.recordAttempt(g(), card, r.run, { outcome: 'success', dodReceipt: 'dod:sha-1', redReceipt: 'red:1', candidateSha: 'sha-1' });
  r = runner.next(g(), card, run);
  assert.equal(r.directive.kind, 'pre-review', r.directive.narration);
  run = (await runner.preReview(g(), card, r.run)).run;
  r = runner.next(g(), card, run);
  assert.equal(r.directive.kind, 'review', r.directive.narration);
  r = runner.next(g(), card, (await runner.formalReview(g(), card, r.run)).run);
  return { fx, goalId: goal.id, r };
}

test('T0-BASE-SYNC-CHANGELOG-EDGES acceptance 2: a [SHIP-BASE-SYNC-COMMITTED] ship returns the card to BUILD to record the worktree HEAD, never to resolve a hunk, and nothing treats it as merged [R1]', async () => {
  const { fx, goalId, r } = await shipOnce(SENTINEL_LINE.committed);
  try {
    assert.equal(r.directive.kind, 'build', r.directive.narration);
    assert.match(r.directive.narration, /the ship path committed the CHANGELOG\.md merge but could not read its commit back; check that the worktree HEAD is that merge, rerun the DoD on it and record it as the attempt/);
    assert.doesNotMatch(r.directive.narration, /resolve every hunk/);
    assert.doesNotMatch(r.directive.narration, /merged the entries both sides added/);
    assert.equal(r.run.pendingRepair?.kind, 'merge-conflict');
    assert.equal(r.run.dodReceipt, undefined, 'no DoD receipt carries over');
    assert.equal(r.run.blockedReceipt, undefined, 'no retained receipt carries over');
    // Nothing treats it as merged: the candidate stays the shipped one, no merge operation succeeds, no merge sha is named.
    assert.equal(r.run.candidate?.sha, 'sha-1');
    assert.equal(fx.ops.list({ goalId, kind: 'merge' }).filter((o) => o.status === 'succeeded').length, 0);
    assert.doesNotMatch(r.directive.narration, /\b[0-9a-f]{40}\b/);
    assert.doesNotMatch(r.run.pendingRepair?.detail ?? '', /\b[0-9a-f]{40}\b/);
    assert.match(r.run.pendingRepair?.detail ?? '', /SHIP-BASE-SYNC-COMMITTED/, 'the repair names the sentinel it came from');
  } finally {
    fx.cleanup();
  }
});

test('T0-BASE-SYNC-CHANGELOG-EDGES acceptance 2: [SHIP-BASE-SYNC-MERGED] and [SHIP-BASE-SYNC-CONFLICT] keep their narrations [R1]', async () => {
  for (const [name, line, step] of [['merged', SENTINEL_LINE.merged, /the ship path merged the entries both sides added to CHANGELOG\.md Unreleased and committed the merge; check it, rerun the DoD on it and record it as the attempt/], ['conflict', SENTINEL_LINE.conflict, /resolve every hunk by intent with the merge-conflicts skill \(merge only, never rebase\), rerun the DoD and record the attempt/]] as const) {
    const { fx, r } = await shipOnce(line);
    try {
      assert.equal(r.directive.kind, 'build', `${name}: ${r.directive.narration}`);
      assert.match(r.directive.narration, step, name);
      assert.doesNotMatch(r.directive.narration, /could not read its commit back/, name);
      assert.equal(r.run.pendingRepair?.kind, 'merge-conflict', name);
    } finally {
      fx.cleanup();
    }
  }
});
