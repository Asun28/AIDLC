import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, candidateShaFor, T0, type Fixture } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { runSync, type SyncRunner } from '../../src/probes/exec.ts';

// T0-CLOSE-CLEANUP: `aidlc card close` does the cleanup and metadata steps it records. The card reaches CLOSE on the
// dry-run path of the harness; the closing runner is on a real path over a real repository, so git does the refusing.

const CARD = 'T0-CLOSING';
const TRACKED = 'tracked.txt';

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** The card driven to CLOSE: merge verified, all six closure steps missing. */
function atClose(fx: Fixture) {
  writeCard(fx, { id: CARD, title: 'closes for real' });
  const goal = goalForCards(fx, [CARD]);
  const runner = fx.runner();
  const card = fx.card(CARD);
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  r = runner.next(fx.goal(goal.id), card, r.run);
  assert.equal(r.directive.kind, 'build');
  const built = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: candidateShaFor(CARD) });
  r = runner.next(fx.goal(goal.id), card, built);
  assert.equal(r.directive.kind, 'close', r.directive.narration);
  return { goalId: goal.id, card, run: r.run };
}

/** A real repository at `fx.tmp` holding the card file, with the card branch off `main`. */
function repository(fx: Fixture): void {
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\nelsewhere/\n');
  writeFileSync(path.join(fx.tmp, TRACKED), 'base\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  git(fx.tmp, ['branch', CARD]);
}

/** Git prints long paths and the fixture's temporary directory can be a short one, so the root the runner holds is canonical. */
function worktreeRootOf(fx: Fixture): string {
  mkdirSync(path.join(fx.tmp, 'wt'), { recursive: true });
  return realpathSync.native(path.join(fx.tmp, 'wt'));
}

/** The card's worktree with one verdict under `.review/`. */
function worktree(fx: Fixture): string {
  const dir = path.join(worktreeRootOf(fx), CARD);
  git(fx.tmp, ['worktree', 'add', '-q', dir, CARD]);
  mkdirSync(path.join(dir, '.review', 'nested'), { recursive: true });
  writeFileSync(path.join(dir, '.review', 'a.json'), '{"verdict":"pass"}\n');
  writeFileSync(path.join(dir, '.review', 'nested', 'skipped.json'), '{}\n');
  return dir;
}

/** The closing runner, on a real ship path unless the test says otherwise, recording each command. */
function closingRunner(fx: Fixture, calls: string[][], shipPath: 'github' | 'dry-run' = 'github'): CardRunner {
  const runner: SyncRunner = (command, args, options) => {
    calls.push([command, ...args]);
    return runSync(command, args, options);
  };
  return new CardRunner({
    paths: fx.paths,
    repo: { ...fx.repo, isGit: true },
    config: { ...fx.config, shipPath, worktreeRoot: shipPath === 'github' ? worktreeRootOf(fx) : fx.config.worktreeRoot },
    store: fx.store,
    leases: fx.leases,
    queue: fx.queue,
    ops: fx.ops,
    shipPath: new DryRunShipPath(['merged']),
    runner,
    now: fx.now,
  });
}

function stored(fx: Fixture, goalId: string) {
  const run = fx.store.getCardRun(goalId, CARD);
  assert.ok(run, 'the run is stored');
  return run;
}

function listed(fx: Fixture): string {
  return git(fx.tmp, ['worktree', 'list', '--porcelain']);
}

function flat(file: string): string {
  return readFileSync(path.resolve(file), 'utf8').replace(/\s+/g, ' ');
}

test('T0-CLOSE-CLEANUP acceptance 1: cleanup copies .review/ into the evidence tree, then removes the worktree and leaves the branch [R1]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    writeFileSync(path.join(dir, '.review', 'manifest.json'), 'not the manifest\n');
    const marked = closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { cleanup: true });
    assert.equal(marked.closure.cleanup, true);
    assert.equal(existsSync(dir), false, 'the directory is gone');
    assert.doesNotMatch(listed(fx), new RegExp(`refs/heads/${CARD}`), 'git lists no worktree of the branch');
    assert.ok(git(fx.tmp, ['rev-parse', '--verify', `refs/heads/${CARD}`]), 'the branch stays');
    const evidence = new EvidenceStore(fx.paths.evidence, goalId);
    const manifest = evidence.load(goalId, 1, 1, T0);
    const entry = manifest.entries.find((e) => e.id === `${CARD}.a.json`);
    assert.ok(entry, 'the manifest names the copy');
    assert.equal(readFileSync(path.join(evidence.dir, entry.path), 'utf8'), '{"verdict":"pass"}\n');
    assert.deepEqual(manifest.entries.map((e) => e.id).sort(), [`${CARD}.a.json`, `${CARD}.manifest.json`], 'only files directly under .review/ are copied, and none takes the path of the manifest');
  } finally {
    fx.cleanup();
  }
});

for (const [kind, change, undo] of [
  ['a modified tracked file', (dir: string) => writeFileSync(path.join(dir, TRACKED), 'changed\n'), (dir: string) => git(dir, ['checkout', '--', TRACKED])],
  ['an untracked file', (dir: string) => writeFileSync(path.join(dir, 'new.txt'), 'new\n'), (dir: string) => rmSync(path.join(dir, 'new.txt'))],
] as const) {
  test(`T0-CLOSE-CLEANUP acceptance 2: ${kind} refuses the removal, the other flags stay recorded, and the same call completes once it is gone [R2]`, () => {
    const fx = makeFixture();
    try {
      const { goalId, card, run } = atClose(fx);
      repository(fx);
      const dir = worktree(fx);
      change(dir);
      const runner = closingRunner(fx, []);
      assert.throws(() => runner.markClosure(fx.goal(goalId), card, run, { cleanup: true, docSync: true }), /worktree remove[\s\S]*modified or untracked/);
      assert.equal(stored(fx, goalId).closure.cleanup, false);
      assert.equal(stored(fx, goalId).closure.docSync, true, 'the other flag is recorded');
      assert.equal(existsSync(path.join(dir, TRACKED)), true, 'the worktree stays');
      const refused = fx.events(goalId).filter((e) => e.type === 'EVIDENCE_RETAINED' && e.cardId === CARD).at(-1);
      assert.match(String(refused?.data['closureFailures']), /cleanup: /, 'the journal names the failed step');
      undo(dir);
      const marked = runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { cleanup: true });
      assert.equal(marked.closure.cleanup, true);
      assert.equal(existsSync(dir), false);
    } finally {
      fx.cleanup();
    }
  });
}

test('T0-CLOSE-CLEANUP acceptance 3: a sealed manifest fails the copy, and the worktree stays [R1] [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    const evidence = new EvidenceStore(fx.paths.evidence, goalId);
    evidence.seal(evidence.load(goalId, 1, 1, T0), { journalHead: 'head', journalEvents: 1, now: T0 });
    const calls: string[][] = [];
    assert.throws(() => closingRunner(fx, calls).markClosure(fx.goal(goalId), card, run, { cleanup: true }), /sealed/);
    assert.equal(stored(fx, goalId).closure.cleanup, false);
    assert.equal(existsSync(path.join(dir, '.review', 'a.json')), true, 'the verdict stays with its worktree');
    assert.equal(calls.some((c) => c.includes('remove')), false, 'nothing is removed before the copy holds');
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP acceptance 4: a branch without a worktree records the step and removes nothing, twice [R3]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const calls: string[][] = [];
    const runner = closingRunner(fx, calls);
    assert.equal(runner.markClosure(fx.goal(goalId), card, run, { cleanup: true }).closure.cleanup, true);
    assert.equal(runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { cleanup: true }).closure.cleanup, true);
    assert.equal(calls.some((c) => c.includes('remove')), false);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP acceptance 5: a worktree of the branch at another path is refused and stays [R4]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const elsewhere = path.join(fx.tmp, 'elsewhere', CARD);
    git(fx.tmp, ['worktree', 'add', '-q', elsewhere, CARD]);
    assert.throws(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { cleanup: true }), /expected/);
    assert.equal(stored(fx, goalId).closure.cleanup, false);
    assert.equal(existsSync(path.join(elsewhere, TRACKED)), true);
    assert.match(listed(fx), new RegExp(`refs/heads/${CARD}`));
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP acceptance 6: metadata sets the status value and no other byte [R5]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const file = path.join(fx.cardsDir, `${CARD}.md`);
    const before = readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n').replace(/^status: todo\r$/m, 'status:  todo   # todo | merged\r');
    writeFileSync(file, before, 'utf8');
    const marked = closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { metadata: true });
    assert.equal(marked.closure.metadata, true);
    assert.equal(readFileSync(file, 'utf8'), before.replace('status:  todo   #', 'status:  merged   #'));
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP acceptance 6: a file already merged is not written [R5]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const file = path.join(fx.cardsDir, `${CARD}.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^status: .*$/m, 'status: merged'), 'utf8');
    const old = new Date('2020-01-02T03:04:05Z');
    utimesSync(file, old, old);
    closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { metadata: true });
    assert.equal(statSync(file).mtime.toISOString(), old.toISOString());
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP acceptance 6: a missing card file leaves the flag false and names the path [R5] [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    rmSync(path.join(fx.cardsDir, `${CARD}.md`));
    assert.throws(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { metadata: true, findings: true }), new RegExp(`metadata: .*${CARD}\\.md`));
    assert.equal(stored(fx, goalId).closure.metadata, false);
    assert.equal(stored(fx, goalId).closure.findings, true);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP acceptance 7: the dry-run path runs no git and writes no file [R6]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    const file = path.join(fx.cardsDir, `${CARD}.md`);
    const before = readFileSync(file, 'utf8');
    const calls: string[][] = [];
    const marked = closingRunner(fx, calls, 'dry-run').markClosure(fx.goal(goalId), card, run, { metadata: true, cleanup: true });
    assert.equal(marked.closure.metadata, true);
    assert.equal(marked.closure.cleanup, true);
    assert.equal(calls.filter((c) => c[0] === 'git').length, 0);
    assert.equal(readFileSync(file, 'utf8'), before);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP acceptance 8: the guide, the architecture note, both card-loop copies, the close directive and the changelog say what the steps do [R7]', () => {
  const sentence = '`card close --cleanup` and `--metadata` do the step and record it: cleanup copies `.review/` into the evidence tree and removes the worktree, metadata writes `status: merged` in the main checkout, and the session commits that file on main.';
  for (const doc of ['docs/OPERATIONS.md', 'docs/ARCHITECTURE.md']) assert.ok(flat(doc).includes(sentence), `${doc} holds the sentence`);
  for (const copy of ['.claude/skills/aidlc-loop/card-loop.md', 'templates/claude/skills/aidlc-loop/card-loop.md']) {
    assert.ok(flat(copy).includes('card close --all'), `${copy} names the command`);
    assert.ok(Buffer.byteLength(readFileSync(path.resolve(copy), 'utf8'), 'utf8') <= 6500, `${copy} stays under the cap`);
  }
  const unreleased = readFileSync(path.resolve('CHANGELOG.md'), 'utf8').split(/^## /m).find((s) => s.startsWith('[Unreleased]') || s.startsWith('Unreleased'));
  assert.match(unreleased ?? '', /T0-CLOSE-CLEANUP/);
  const fx = makeFixture();
  try {
    const { goalId, run } = atClose(fx);
    const directive = closingRunner(fx, [], 'dry-run').next(fx.goal(goalId), fx.card(CARD), run).directive;
    assert.match(directive.narration, /`--cleanup` and `--metadata` do their step/);
  } finally {
    fx.cleanup();
  }
});
