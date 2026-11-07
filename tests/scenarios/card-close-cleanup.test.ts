import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards, candidateShaFor, T0, type Fixture } from './_harness.ts';
import { withCardStatus } from '../../src/artifacts/card.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { Journal } from '../../src/state/journal.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { runSync, type SyncRunner } from '../../src/probes/exec.ts';

// T0-CLOSE-CLEANUP-2: `aidlc card close` does the cleanup and metadata steps it records. The card reaches CLOSE on the
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

test('T0-CLOSE-CLEANUP-2 acceptance 1: cleanup copies .review/ into the evidence tree, then removes the worktree and leaves the branch [R1]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    const marked = closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { cleanup: true });
    assert.equal(marked.closure.cleanup, true);
    assert.equal(existsSync(dir), false, 'the directory is gone');
    assert.doesNotMatch(listed(fx), new RegExp(`refs/heads/${CARD}`), 'git lists no worktree of the branch');
    assert.ok(git(fx.tmp, ['rev-parse', '--verify', `refs/heads/${CARD}`]), 'the branch stays');
    const kept = path.join(fx.paths.evidence, goalId, 'review', CARD);
    assert.equal(readFileSync(path.join(kept, 'a.json'), 'utf8'), '{"verdict":"pass"}\n');
    assert.deepEqual(readdirSync(kept), ['a.json'], 'only files directly under .review/ are copied');
  } finally {
    fx.cleanup();
  }
});

for (const [kind, change, undo] of [
  ['a modified tracked file', (dir: string) => writeFileSync(path.join(dir, TRACKED), 'changed\n'), (dir: string) => git(dir, ['checkout', '--', TRACKED])],
  ['an untracked file', (dir: string) => writeFileSync(path.join(dir, 'new.txt'), 'new\n'), (dir: string) => rmSync(path.join(dir, 'new.txt'))],
] as const) {
  test(`T0-CLOSE-CLEANUP-2 acceptance 2: ${kind} refuses the removal, the other flags stay recorded, and the same call completes once it is gone [R2]`, () => {
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

test('T0-CLOSE-CLEANUP-2 acceptance 3: a copy that fails leaves the worktree, and a sealed manifest is no failure [R1] [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    const evidence = new EvidenceStore(fx.paths.evidence, goalId);
    evidence.seal(evidence.load(goalId, 1, 1, T0), { journalHead: 'head', journalEvents: 1, now: T0 });
    const sealed = readFileSync(evidence.manifestFile(), 'utf8');
    const taken = path.join(evidence.dir, 'review');
    writeFileSync(taken, 'a file where the copies go\n');
    const calls: string[][] = [];
    const runner = closingRunner(fx, calls);
    assert.throws(() => runner.markClosure(fx.goal(goalId), card, run, { cleanup: true }), /cleanup: /);
    assert.equal(stored(fx, goalId).closure.cleanup, false);
    assert.equal(existsSync(path.join(dir, '.review', 'a.json')), true, 'the verdict stays with its worktree');
    assert.equal(calls.some((c) => c.includes('remove')), false, 'nothing is removed before the copy holds');
    rmSync(taken);
    assert.equal(runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { cleanup: true }).closure.cleanup, true);
    assert.equal(readFileSync(evidence.manifestFile(), 'utf8'), sealed, 'the step leaves the manifest alone');
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 4: a branch without a worktree records the step and removes nothing, twice [R3]', () => {
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

test('T0-CLOSE-CLEANUP-2 acceptance 5: a worktree of the branch at another path is refused and stays [R4]', () => {
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

test('T0-CLOSE-CLEANUP-2 acceptance 6: metadata sets the status value and no other byte [R5]', () => {
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

test('T0-CLOSE-CLEANUP-2 acceptance 6: a file already merged is not written [R5]', () => {
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

test('T0-CLOSE-CLEANUP-2 acceptance 6: a missing card file leaves the flag false and names the path [R5] [R2]', () => {
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

test('T0-CLOSE-CLEANUP-2 acceptance 9: a detached checkout at the expected path is refused, and stays [R4]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    git(dir, ['checkout', '-q', '--detach']);
    assert.throws(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { cleanup: true }), /git lists no worktree/);
    assert.equal(stored(fx, goalId).closure.cleanup, false);
    assert.equal(existsSync(path.join(dir, TRACKED)), true);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 9: a status key with a space before its colon is written as the parser reads it [R5]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const file = path.join(fx.cardsDir, `${CARD}.md`);
    const before = readFileSync(file, 'utf8').replace(/^status: todo$/m, 'status : todo');
    writeFileSync(file, before, 'utf8');
    closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { metadata: true });
    assert.equal(readFileSync(file, 'utf8'), before.replace('status : todo', 'status : merged'));
  } finally {
    fx.cleanup();
  }
});

/** Whether the directory tells two names apart by case, which the mount decides and the platform does not. */
function caseSensitive(dir: string): boolean {
  const probe = path.join(dir, 'CaseProbe');
  writeFileSync(probe, '');
  const sensitive = !existsSync(path.join(dir, 'caseprobe'));
  rmSync(probe);
  return sensitive;
}

test('T0-CLOSE-CLEANUP-2 acceptance 9: a nonbreaking space the parser trims around the value stays, and a value that says merged is not written [R5]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const file = path.join(fx.cardsDir, `${CARD}.md`);
    const before = readFileSync(file, 'utf8').replace(/^status: todo$/m, 'status:\u00a0todo\u00a0 # held');
    writeFileSync(file, before, 'utf8');
    const runner = closingRunner(fx, []);
    const marked = runner.markClosure(fx.goal(goalId), card, run, { metadata: true });
    const after = before.replace('\u00a0todo', '\u00a0merged');
    assert.equal(readFileSync(file, 'utf8'), after);
    const old = new Date('2020-01-02T03:04:05Z');
    utimesSync(file, old, old);
    runner.markClosure(fx.goal(goalId), card, marked, { metadata: true });
    assert.equal(statSync(file).mtime.toISOString(), old.toISOString());
    assert.equal(readFileSync(file, 'utf8'), after);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 13: a card whose step removed the worktree reaches DONE [R1]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    const runner = closingRunner(fx, []);
    const marked = runner.markClosure(fx.goal(goalId), card, run, { metadata: true, docSync: true, findings: true, evidence: true, cleanup: true });
    assert.equal(existsSync(dir), false);
    const recorded = runner.markClosure(fx.goal(goalId), card, marked, { lessons: true }, { skipped: 'nothing to record' });
    assert.equal(runner.next(fx.goal(goalId), card, recorded).directive.kind, 'done');
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 10: a worktree whose path differs from the expected one by case alone is refused [R4]', (t) => {
  const fx = makeFixture();
  try {
    if (!caseSensitive(fx.tmp)) return t.skip('this filesystem folds case');
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const other = path.join(fx.tmp, 'WT', CARD);
    git(fx.tmp, ['worktree', 'add', '-q', other, CARD]);
    assert.throws(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { cleanup: true }), /expected/);
    assert.equal(stored(fx, goalId).closure.cleanup, false);
    assert.equal(existsSync(path.join(other, TRACKED)), true);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 11: a step that succeeded earlier and fails now records false [R2] [R5]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const runner = closingRunner(fx, []);
    const marked = runner.markClosure(fx.goal(goalId), card, run, { metadata: true, cleanup: true });
    assert.equal(marked.closure.metadata, true);
    assert.equal(marked.closure.cleanup, true);
    rmSync(path.join(fx.cardsDir, `${CARD}.md`));
    mkdirSync(path.join(worktreeRootOf(fx), CARD));
    assert.throws(() => runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { metadata: true, cleanup: true }), /cleanup: [\s\S]*metadata: /);
    assert.equal(stored(fx, goalId).closure.metadata, false);
    assert.equal(stored(fx, goalId).closure.cleanup, false);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 12: two files whose copies reach one destination are refused, and both stay [R1] [R2]', (t) => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    const kept = path.join(fx.paths.evidence, goalId, 'review', CARD);
    mkdirSync(kept, { recursive: true });
    writeFileSync(path.join(kept, 'first.json'), '');
    try {
      symlinkSync(path.join(kept, 'first.json'), path.join(kept, 'second.json'));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(code)) return t.skip(`no symbolic link here: ${code}`);
      throw err;
    }
    writeFileSync(path.join(dir, '.review', 'first.json'), 'first\n');
    writeFileSync(path.join(dir, '.review', 'second.json'), 'second\n');
    assert.throws(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { cleanup: true }), /differs/);
    assert.equal(stored(fx, goalId).closure.cleanup, false);
    assert.equal(readFileSync(path.join(dir, '.review', 'first.json'), 'utf8'), 'first\n');
    assert.equal(readFileSync(path.join(dir, '.review', 'second.json'), 'utf8'), 'second\n');
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 6: a card file with no status in its front matter fails the step and stays as it is [R5] [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const file = path.join(fx.cardsDir, `${CARD}.md`);
    const before = `${readFileSync(file, 'utf8').replace(/^status: .*\n/m, '')}\nstatus: body text, not the key\n`;
    writeFileSync(file, before, 'utf8');
    assert.throws(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { metadata: true }), /metadata: the card has no status/);
    assert.equal(stored(fx, goalId).closure.metadata, false);
    assert.equal(readFileSync(file, 'utf8'), before);
    assert.throws(() => withCardStatus('---\nid: x\nstatus:\n---\n', 'merged'), /no status/, 'an empty value is no status');
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 14: a failed step lowers its flag when the journal fails too, and the message names both causes [R2]', (t) => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const runner = closingRunner(fx, []);
    assert.equal(runner.markClosure(fx.goal(goalId), card, run, { cleanup: true }).closure.cleanup, true);
    mkdirSync(path.join(worktreeRootOf(fx), CARD));
    const append = t.mock.method(Journal.prototype, 'append', () => {
      throw new Error('EIO: injected');
    });
    assert.throws(() => runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { cleanup: true, docSync: true }), /cleanup: [\s\S]*journal: EIO: injected/);
    append.mock.restore();
    assert.equal(stored(fx, goalId).closure.cleanup, false);
    assert.equal(stored(fx, goalId).closure.docSync, false, 'no flag rises without its journal event');
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-CLEANUP-2 acceptance 7: the dry-run path runs no git and writes no file [R6]', () => {
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

test('T0-CLOSE-CLEANUP-2 acceptance 8: the guide, the architecture note, both card-loop copies, the close directive and the changelog say what the steps do [R7]', () => {
  const sentence = '`card close --cleanup` and `--metadata` do the step and record it: cleanup copies `.review/` into the evidence tree and removes the worktree, metadata writes `status: merged` in the main checkout, and the session commits that file on main.';
  for (const doc of ['docs/OPERATIONS.md', 'docs/ARCHITECTURE.md']) assert.ok(flat(doc).includes(sentence), `${doc} holds the sentence`);
  const order = 'un `--cleanup` or `--all` after the doc_sync, findings and evidence steps, because it removes the worktree that holds `.review/`.';
  assert.ok(flat('docs/OPERATIONS.md').includes(order), 'the guide states the order');
  assert.ok(flat('docs/OPERATIONS.md').includes('A card file in neither card directory stops `card close` at load, like every `card` command, so no step runs and the flags stay as recorded; restore the file and run the step again.'), 'the guide states the limit');
  for (const copy of ['.claude/skills/aidlc-loop/card-loop.md', 'templates/claude/skills/aidlc-loop/card-loop.md']) {
    const retain = flat(copy).indexOf('aidlc evidence retain');
    assert.ok(retain >= 0, `${copy} names the evidence step`);
    assert.ok(flat(copy).indexOf('card close --all') > retain, `${copy} puts the removal after the evidence step`);
    assert.ok(Buffer.byteLength(readFileSync(path.resolve(copy), 'utf8'), 'utf8') <= 6500, `${copy} stays under the cap`);
  }
  const unreleased = readFileSync(path.resolve('CHANGELOG.md'), 'utf8').split(/^## /m).find((s) => s.startsWith('[Unreleased]') || s.startsWith('Unreleased'));
  assert.match(unreleased ?? '', /T0-CLOSE-CLEANUP-2/);
  const fx = makeFixture();
  try {
    const { goalId, run } = atClose(fx);
    const directive = closingRunner(fx, [], 'dry-run').next(fx.goal(goalId), fx.card(CARD), run).directive;
    assert.match(directive.narration, /`--cleanup` and `--metadata` do their step/);
    assert.ok(directive.narration.includes(order), 'the directive states the order');
  } finally {
    fx.cleanup();
  }
});
