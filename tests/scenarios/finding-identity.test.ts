/**
 * Card T1-FINDING-IDENTITY: an R3 block records on each new formal finding the identity of the lines it cites, read from
 * the candidate commit. These runs use real git in a temporary repository and a scripted reviewer.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { makeFixture, writeCard, type Fixture } from './_harness.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';

const CARD = 'T1-FI';
const FILE = 'src/t1-fi.ts';
const GONE = 'src/t1-gone.ts';
const HERE = `[spec] [P1] 1 correctness @ ${FILE}:2-3: the sum is wrong -> fix it`;
const MISSING = `[spec] 1 correctness @ ${GONE}:1: the file was deleted -> restore it`;
const BLOCK = `${JSON.stringify({ verdict: 'block', reasons: [HERE, MISSING], axes: { spec: { verdict: 'block', reasons: [HERE, MISSING] }, standards: { verdict: 'pass', reasons: [] } } })}\n`;

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

test('T1-FINDING-IDENTITY acceptance 4: an R3 block records an identity read from the candidate commit, and an unreadable path records none', async () => {
  const fx: Fixture = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  try {
    writeCard(fx, { id: CARD, title: 'identity', allowPaths: [FILE, GONE] });
    mkdirSync(path.join(fx.tmp, 'src'), { recursive: true });
    writeFileSync(path.join(fx.tmp, FILE), 'export const a = 1;\n');
    writeFileSync(path.join(fx.tmp, GONE), 'export const gone = 1;\n');
    writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\n');
    git(fx.tmp, ['init', '-q', '-b', 'main']);
    git(fx.tmp, ['add', '-A']);
    git(fx.tmp, ['commit', '-q', '-m', 'base']);
    git(fx.tmp, ['checkout', '-q', '-b', CARD]);
    // The candidate changes FILE and deletes GONE.
    writeFileSync(path.join(fx.tmp, FILE), 'export const a = 1;\n    export const b   = a + 1;\n\texport const c = b;\n');
    rmSync(path.join(fx.tmp, GONE));
    git(fx.tmp, ['add', '-A']);
    git(fx.tmp, ['commit', '-q', '-m', 'candidate']);
    const candidate = git(fx.tmp, ['rev-parse', 'HEAD']);

    const reviewers = scriptedRunner({ 'fake-r3': () => ({ stdout: BLOCK }) });
    const runner: SyncRunner = (command, args, options) => (command === 'git' ? runSync(command, args, options) : reviewers(command, args, options));
    const cards = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner });
    const goal = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [] }, { cards: [CARD] });
    fx.controller.next(goal.id);
    fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [CARD] } });
    const card = fx.card(CARD);
    const first = cards.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
    const built = cards.next(fx.goal(goal.id), card, first.run).run;
    const recorded = cards.recordAttempt(fx.goal(goal.id), card, built, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidate });
    const ready = cards.next(fx.goal(goal.id), card, recorded);
    assert.equal(ready.directive.kind, 'review', ready.directive.narration);
    await cards.formalReview(fx.goal(goal.id), card, ready.run);

    const findings = fx.store.getCardRun(goal.id, CARD)!.findings;
    assert.deepEqual(findings.map((f) => [f.id, f.reason]), [['F1', HERE], ['F2', MISSING]], 'the block recorded both cited reasons');
    // The expected identity from R1 by hand: file, dimension 1, and lines 2 and 3 of the candidate commit, trimmed and collapsed.
    const expected = createHash('sha256').update(`${FILE}\n1\nexport const b = a + 1;\nexport const c = b;`).digest('hex').slice(0, 16);
    assert.equal((findings[0] as { identity?: string }).identity, expected, 'the identity of the lines at the candidate commit');
    assert.ok(!('identity' in findings[1]!), 'a file the candidate commit does not hold gives no identity');
    assert.equal(fx.store.getCardRun(goal.id, CARD)!.state, 'REVIEW_FIX', 'the decision is a block as without identities');
  } finally {
    fx.cleanup();
  }
});
