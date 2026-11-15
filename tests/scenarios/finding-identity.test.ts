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
import type { CardRun, ReviewFinding } from '../../src/core/types.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { runSync, scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';

const CARD = 'T1-FI';
const FILE = 'src/t1-fi.ts';
const GONE = 'src/t1-gone.ts';
const HERE = `[spec] [P1] 1 correctness @ ${FILE}:2-3: the sum is wrong -> fix it`;
const MISSING = `[spec] 1 correctness @ ${GONE}:1: the file was deleted -> restore it`;
/** The identity of HERE from R1 by hand: file, dimension 1, and lines 2 and 3 of the candidate commit, trimmed and collapsed. */
const HERE_ID = createHash('sha256').update(`${FILE}\n1\nexport const b = a + 1;\nexport const c = b;`).digest('hex').slice(0, 16);
const blockOf = (reasons: string[]) => ({ verdict: 'block' as const, reasons, axes: { spec: { verdict: 'block' as const, reasons }, standards: { verdict: 'pass' as const, reasons: [] } } });

/** Git calls go to real git, except that `git show` throws when `throwOnShow` is set (a runner that throws). */
const realGit = (throwOnShow = false): SyncRunner => (command, args, options) => {
  if (command !== 'git') return scriptedRunner({})(command, args, options);
  if (throwOnShow && args[0] === 'show') throw new Error('injected runner failure');
  return runSync(command, args, options);
};

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A repository whose candidate commit changes FILE and deletes GONE; returns the candidate sha. */
function repoWithCandidate(fx: Fixture, tier?: 'S'): string {
  writeCard(fx, { id: CARD, title: 'identity', allowPaths: [FILE, GONE], ...(tier ? { tier, reviewGate: 'codex {verdict:pass}' } : {}) });
  mkdirSync(path.join(fx.tmp, 'src'), { recursive: true });
  writeFileSync(path.join(fx.tmp, FILE), 'export const a = 1;\n');
  writeFileSync(path.join(fx.tmp, GONE), 'export const gone = 1;\n');
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  git(fx.tmp, ['checkout', '-q', '-b', CARD]);
  writeFileSync(path.join(fx.tmp, FILE), 'export const a = 1;\n    export const b   = a + 1;\n\texport const c = b;\n');
  rmSync(path.join(fx.tmp, GONE));
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'candidate']);
  return git(fx.tmp, ['rev-parse', 'HEAD']);
}

/** Start the card and record a successful attempt on the candidate; returns the goal id and the `card next` after it. */
function attempt(fx: Fixture, cards: CardRunner, candidate: string) {
  const goal = fx.controller.createGoal({ text: `implement ${CARD}`, source: 'card', ref: CARD, affectedSurfaces: [] }, { cards: [CARD] });
  fx.controller.next(goal.id);
  fx.controller.report({ goalId: goal.id, generation: 0, result: 'cards-projected', data: { cards: [CARD] } });
  const card = fx.card(CARD);
  const first = cards.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  const built = cards.next(fx.goal(goal.id), card, first.run).run;
  const recorded = cards.recordAttempt(fx.goal(goal.id), card, built, { outcome: 'success', dodReceipt: 'dod:1', redReceipt: 'red:1', candidateSha: candidate });
  return { goalId: goal.id, card, after: cards.next(fx.goal(goal.id), card, recorded) };
}

/** One R3 decision on the candidate with the scripted reviewer answering a block of `reasons`; returns the stored run. */
async function r3Block(reasons: string[], throwOnShow = false): Promise<{ run: CardRun; fx: Fixture }> {
  const fx = makeFixture({ config: { gateRequired: true, formalReview: { command: ['fake-r3', '--schema', '{schema}', '{instructions}'], reviewer: 'fake-r3', timeoutMs: 1000, shell: false } } });
  const candidate = repoWithCandidate(fx);
  const reviewer = scriptedRunner({ 'fake-r3': () => ({ stdout: `${JSON.stringify(blockOf(reasons))}\n` }) });
  const git = realGit(throwOnShow);
  const runner: SyncRunner = (command, args, options) => (command === 'git' ? git(command, args, options) : reviewer(command, args, options));
  const cards = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, isGit: true }, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now, runner });
  const { goalId, card, after } = attempt(fx, cards, candidate);
  assert.equal(after.directive.kind, 'review', after.directive.narration);
  await cards.formalReview(fx.goal(goalId), card, after.run);
  return { run: fx.store.getCardRun(goalId, CARD)!, fx };
}

/** One ship-path decision on the candidate whose verdict document blocks with `reasons`; returns the stored run and the directive. */
function shipBlock(reasons: string[], throwOnShow = false): { run: CardRun; directive: string; fx: Fixture } {
  const fx = makeFixture();
  const candidate = repoWithCandidate(fx, 'S');
  const ship = new DryRunShipPath(['review-blocked'], { ...blockOf(reasons), sha: candidate, run_status: 'success' });
  const cards = new CardRunner({ paths: fx.paths, repo: fx.repo, config: fx.config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: ship, now: fx.now, runner: realGit(throwOnShow) });
  const { goalId, after } = attempt(fx, cards, candidate);
  return { run: fx.store.getCardRun(goalId, CARD)!, directive: after.directive.kind, fx };
}

const identities = (findings: ReviewFinding[]) => findings.map((f) => [f.reason, f.identity]);

test('T1-FINDING-IDENTITY acceptance 4: an R3 block records an identity read from the candidate commit, and an unreadable path records none', async () => {
  const { run, fx } = await r3Block([HERE, MISSING]);
  try {
    assert.deepEqual(run.findings.map((f) => [f.id, f.reason]), [['F1', HERE], ['F2', MISSING]], 'the block recorded both cited reasons');
    assert.equal(run.findings[0]!.identity, HERE_ID, 'the identity of the lines at the candidate commit');
    assert.ok(!('identity' in run.findings[1]!), 'a file the candidate commit does not hold gives no identity');
    assert.equal(run.state, 'REVIEW_FIX', 'the decision is a block as without identities');
  } finally {
    fx.cleanup();
  }
});

test('T1-FINDING-IDENTITY acceptance 4: a ship-path block records an identity read from the candidate commit, and an unreadable path records none', () => {
  const { run, directive, fx } = shipBlock([HERE, MISSING]);
  try {
    assert.equal(directive, 'review-fix');
    assert.deepEqual(run.findings.map((f) => [f.id, f.reason]), [['F1', HERE], ['F2', MISSING]], 'the ship-path block recorded both cited reasons');
    assert.equal(run.findings[0]!.identity, HERE_ID, 'the identity of the lines at the candidate commit');
    assert.ok(!('identity' in run.findings[1]!), 'a file the candidate commit does not hold gives no identity');
  } finally {
    fx.cleanup();
  }
});

/**
 * Every form of cited path and range a ship-path reviewer can send reaches the reader (the ship path checks no changed
 * paths): each is recorded as a finding, and only a readable range of a file the candidate commit holds gets an identity.
 */
const FORMS: Array<[string, string, string | undefined]> = [
  ['a NUL byte in the path (the runner throws)', `[spec] 1 correctness @ src/t1\u0000fi.ts:2: x -> y`, undefined],
  ['a path that leaves the repository', '[spec] 1 correctness @ ../outside.ts:1: x -> y', undefined],
  ['a .. segment that leaves the repository', '[spec] 1 correctness @ src/../../outside.ts:1: x -> y', undefined],
  ['an absolute path', '[spec] 1 correctness @ /etc/hosts:1: x -> y', undefined],
  ['a line past the end of the file', `[spec] 1 correctness @ ${FILE}:99999999999999999999: x -> y`, undefined],
  ['a range past 40 lines, cut to the lines the file holds', `[spec] 1 correctness @ ${FILE}:2-100000: x -> y`, HERE_ID],
];

test('T1-FINDING-IDENTITY repair F1: a ship-path block citing every reviewer path form records its decision and findings, and no read throws out of the reader', () => {
  const { run, directive, fx } = shipBlock([...FORMS.map(([, reason]) => reason)]);
  try {
    assert.equal(directive, 'review-fix', 'the decision is recorded and directs the repair');
    assert.equal(run.state, 'REVIEW_FIX');
    assert.equal(run.review.substantiveDecisions, 1);
    assert.deepEqual(identities(run.findings), FORMS.map(([, reason, id]) => [reason, id]), FORMS.map(([what]) => what).join('; '));
  } finally {
    fx.cleanup();
  }
});

test('T1-FINDING-IDENTITY repair F1: a runner that throws on the read gives no identity and leaves the ship-path decision as without it', () => {
  const shipped = shipBlock([HERE, MISSING], true);
  try {
    assert.equal(shipped.directive, 'review-fix');
    assert.deepEqual(identities(shipped.run.findings), [[HERE, undefined], [MISSING, undefined]]);
  } finally {
    shipped.fx.cleanup();
  }
});

test('T1-FINDING-IDENTITY repair F1: a runner that throws on the read gives no identity and leaves the R3 decision as without it', async () => {
  const NUL = `[spec] 1 correctness @ src/t1\u0000fi.ts:2: x -> y`;
  const reviewed = await r3Block([HERE, MISSING, NUL], true);
  try {
    assert.equal(reviewed.run.state, 'REVIEW_FIX', 'the R3 decision is a block as without identities');
    assert.deepEqual(identities(reviewed.run.findings), [[HERE, undefined], [MISSING, undefined]], 'the R3 path records the cited reasons (the NUL path is no changed path, so it is not cited) with no identity');
  } finally {
    reviewed.fx.cleanup();
  }
});
