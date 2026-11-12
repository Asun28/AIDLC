import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeFixture, writeCard, goalForCards, candidateShaFor, T0, type Fixture } from './_harness.ts';
import { withCardStatus } from '../../src/artifacts/card.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { Journal } from '../../src/state/journal.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { runSync, type SyncRunner } from '../../src/probes/exec.ts';
import { cleanup } from '../infra/helpers.ts';

// T0-CLOSE-CLEANUP-2: `aidlc card close` does the cleanup and metadata steps it records. The card reaches CLOSE on the
// dry-run path of the harness; the closing runner is on a real path over a real repository, so git does the refusing.

const CARD = 'T0-CLOSING';
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
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
    retained(fx, goalId, { cardId: CARD });
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

/** One file retained in the goal manifest; the path returned is the stored copy. */
function retained(fx: Fixture, goalId: string, input: { cardId?: string; kind?: string; id?: string } = {}): string {
  const evidence = new EvidenceStore(fx.paths.evidence, goalId);
  const id = input.id ?? 'verdict.json';
  evidence.retain(evidence.load(goalId, 1, 1, T0), { id, kind: input.kind ?? 'review-verdict', content: '{"verdict":"pass"}\n', cardId: input.cardId });
  return path.join(evidence.dir, id);
}

/** The message of the throw the action must make. */
function refusal(action: () => unknown): string {
  try {
    action();
  } catch (err) {
    return (err as Error).message;
  }
  return assert.fail('the call throws');
}

/** Every file under the directory with its bytes, so a read-only step is checked by content. */
function snapshot(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .sort()
    .map((name) => (statSync(path.join(dir, name)).isFile() ? name + ':' + readFileSync(path.join(dir, name), 'hex') : name));
}

/** The stored run with one passing decision that names the verdict file. */
function withVerdict(fx: Fixture, goalId: string, verdictRef: string) {
  const run = stored(fx, goalId);
  return fx.store.saveCardRun({ ...run, review: { ...run.review, invocations: [{ invocationId: 'r3:one', candidateDigest: 'digest', base: 'main', policyVersion: 'REVIEW.md@2', reviewer: 'codex', requestedAt: T0, outcome: 'pass', verdictRef }] } });
}

test('T0-CLOSE-EVIDENCE-CHECK acceptance 1: evidence retain stores the card of --card, and no card without it [R1]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: CARD, title: 'closes for real' });
    const goal = goalForCards(fx, [CARD]);
    const retain = (...args: string[]) => spawnSync(process.execPath, [MAIN, 'evidence', 'retain', '--goal', goal.id, '--kind', 'other', '--content', 'kept', ...args, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root }, encoding: 'utf8', timeout: 60_000 });
    const bound = retain('--id', 'bound', '--card', CARD);
    assert.equal(bound.status, 0, bound.stderr);
    const free = retain('--id', 'free');
    assert.equal(free.status, 0, free.stderr);
    const entries = new EvidenceStore(fx.paths.evidence, goal.id).load(goal.id, 1, 1, T0).entries;
    assert.equal(entries.find((e) => e.id === 'bound')?.cardId, CARD);
    assert.equal(entries.find((e) => e.id === 'free')?.cardId, undefined);
  } finally {
    fx.cleanup();
  }
});

for (const kind of ['review-verdict', 'other']) {
  test('T0-CLOSE-EVIDENCE-CHECK acceptance 2: an intact entry of kind ' + kind + ' retained for the card records the flag [R2]', () => {
    const fx = makeFixture();
    try {
      const { goalId, card, run } = atClose(fx);
      repository(fx);
      retained(fx, goalId, { cardId: CARD, kind });
      assert.equal(closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { evidence: true }).closure.evidence, true);
    } finally {
      fx.cleanup();
    }
  });
}

const nothingForTheCard: Array<[string, (fx: Fixture, goalId: string) => unknown]> = [
  ['no manifest', () => undefined],
  ['an entry for another card', (fx, goalId) => retained(fx, goalId, { cardId: 'T0-OTHER' })],
  ['an entry for a card whose id has this one as a prefix', (fx, goalId) => retained(fx, goalId, { cardId: CARD + '-2' })],
  ['an entry with no card', (fx, goalId) => retained(fx, goalId)],
];

for (const [name, arrange] of nothingForTheCard) {
  test('T0-CLOSE-EVIDENCE-CHECK acceptance 3: ' + name + ' fails the check with the retain command [R2] [R3]', () => {
    const fx = makeFixture();
    try {
      const { goalId, card, run } = atClose(fx);
      repository(fx);
      arrange(fx, goalId);
      const message = refusal(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { evidence: true }));
      assert.match(message, /^evidence: /);
      assert.ok(message.includes('aidlc evidence retain --goal ' + goalId + ' --card ' + CARD), message);
      assert.equal(stored(fx, goalId).closure.evidence, false);
    } finally {
      fx.cleanup();
    }
  });
}

const damaged: Array<[string, (file: string, manifest: string) => void, RegExp]> = [
  ['a retained file that is gone', (file) => rmSync(file), /missing or altered/],
  ['a retained file that changed', (file) => writeFileSync(file, 'changed\n'), /missing or altered/],
];

for (const [name, damage, expected] of damaged) {
  test('T0-CLOSE-EVIDENCE-CHECK acceptance 4: ' + name + ' fails the check [R2] [R3]', () => {
    const fx = makeFixture();
    try {
      const { goalId, card, run } = atClose(fx);
      repository(fx);
      const file = retained(fx, goalId, { cardId: CARD });
      damage(file, new EvidenceStore(fx.paths.evidence, goalId).manifestFile());
      assert.match(refusal(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { evidence: true })), expected);
      assert.equal(stored(fx, goalId).closure.evidence, false);
    } finally {
      fx.cleanup();
    }
  });
}

test('T0-CLOSE-EVIDENCE-CHECK acceptance 4: a manifest that does not parse names its cause, the restore and the retain command [R2] [R3]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const manifest = new EvidenceStore(fx.paths.evidence, goalId);
    mkdirSync(manifest.dir, { recursive: true });
    writeFileSync(manifest.manifestFile(), '{');
    const message = refusal(() => closingRunner(fx, []).markClosure(fx.goal(goalId), card, run, { evidence: true }));
    assert.match(message, /^evidence: the manifest of .* cannot be read, so restore it first \(.*JSON.*\); run aidlc evidence retain /);
    assert.ok(message.includes('--goal ' + goalId + ' --card ' + CARD), message);
    assert.equal(stored(fx, goalId).closure.evidence, false);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 4: an entry whose path cannot be read is not intact, and an intact entry beside it passes [R2]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const unreadable = retained(fx, goalId, { cardId: CARD, id: 'first.json' });
    rmSync(unreadable);
    mkdirSync(unreadable);
    const runner = closingRunner(fx, []);
    assert.match(refusal(() => runner.markClosure(fx.goal(goalId), card, run, { evidence: true })), /missing or altered/);
    assert.equal(stored(fx, goalId).closure.evidence, false);
    retained(fx, goalId, { cardId: CARD, id: 'second.json' });
    assert.equal(runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { evidence: true }).closure.evidence, true);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 5: a flag recorded true goes false when the retained file is lost [R3]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const file = retained(fx, goalId, { cardId: CARD });
    const runner = closingRunner(fx, []);
    assert.equal(runner.markClosure(fx.goal(goalId), card, run, { evidence: true }).closure.evidence, true);
    rmSync(file);
    assert.match(refusal(() => runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { evidence: true })), /^evidence: /);
    assert.equal(stored(fx, goalId).closure.evidence, false);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 6: the message names the verdict where it exists, and <file> where it does not [R3]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    const verdict = path.join(dir, '.review', 'a.json');
    const runner = closingRunner(fx, []);
    const inWorktree = refusal(() => runner.markClosure(fx.goal(goalId), card, withVerdict(fx, goalId, verdict), { evidence: true }));
    assert.ok(inWorktree.includes('--file "' + verdict + '"'), inWorktree);
    runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { cleanup: true });
    const copy = path.join(fx.paths.evidence, goalId, 'review', CARD, 'a.json');
    const inEvidence = refusal(() => runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { evidence: true }));
    assert.ok(inEvidence.includes('--file "' + copy + '"'), inEvidence);
    rmSync(copy);
    assert.ok(refusal(() => runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { evidence: true })).includes('--file <file>'));
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 7: a failed check keeps the other flags, and the same call completes once a file is retained [R3]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const runner = closingRunner(fx, []);
    assert.match(refusal(() => runner.markClosure(fx.goal(goalId), card, run, { evidence: true, docSync: true })), /^evidence: /);
    assert.equal(stored(fx, goalId).closure.docSync, true);
    assert.equal(stored(fx, goalId).closure.evidence, false);
    retained(fx, goalId, { cardId: CARD });
    assert.equal(runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { evidence: true, docSync: true }).closure.evidence, true);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 8: a failed check leaves the worktree and the recorded cleanup flag [R4]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const dir = worktree(fx);
    const calls: string[][] = [];
    assert.match(refusal(() => closingRunner(fx, calls).markClosure(fx.goal(goalId), card, run, { evidence: true, cleanup: true })), /^evidence: /);
    assert.equal(existsSync(path.join(dir, TRACKED)), true);
    assert.equal(calls.some((c) => c.includes('remove')), false, 'the removal waits for the evidence step');
    assert.equal(stored(fx, goalId).closure.cleanup, false);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 8: a failed check leaves an earlier true cleanup flag, because the step did not run [R4]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    const runner = closingRunner(fx, []);
    assert.equal(runner.markClosure(fx.goal(goalId), card, run, { cleanup: true }).closure.cleanup, true);
    mkdirSync(path.join(worktreeRootOf(fx), CARD));
    assert.match(refusal(() => runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { evidence: true, cleanup: true })), /^evidence: [^;]*; run /);
    assert.equal(stored(fx, goalId).closure.cleanup, true);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 9: the check writes nothing, passing or failing, and passes with the worktree gone [R5]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    repository(fx);
    worktree(fx);
    const runner = closingRunner(fx, []);
    const cleaned = runner.markClosure(fx.goal(goalId), card, run, { cleanup: true });
    retained(fx, goalId, { cardId: 'T0-OTHER' });
    const evidence = new EvidenceStore(fx.paths.evidence, goalId).dir;
    const before = snapshot(evidence);
    refusal(() => runner.markClosure(fx.goal(goalId), card, cleaned, { evidence: true }));
    assert.deepEqual(snapshot(evidence), before, 'a failing check writes nothing');
    retained(fx, goalId, { cardId: CARD, id: 'second.json' });
    const held = snapshot(evidence);
    assert.equal(runner.markClosure(fx.goal(goalId), card, stored(fx, goalId), { evidence: true }).closure.evidence, true);
    assert.deepEqual(snapshot(evidence), held, 'a passing check writes nothing');
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 10: the dry-run path records the flag with no manifest [R6]', () => {
  const fx = makeFixture();
  try {
    const { goalId, card, run } = atClose(fx);
    assert.equal(closingRunner(fx, [], 'dry-run').markClosure(fx.goal(goalId), card, run, { evidence: true }).closure.evidence, true);
  } finally {
    fx.cleanup();
  }
});

test('T0-CLOSE-EVIDENCE-CHECK acceptance 11: the guide, the architecture note, both card-loop copies, the close directive and the changelog state the check [R7]', () => {
  const check = '`card close --evidence` checks that the goal manifest holds an intact file retained with `aidlc evidence retain --card <id>`, and any kind counts.';
  for (const doc of ['docs/OPERATIONS.md', 'docs/ARCHITECTURE.md']) assert.ok(flat(doc).includes(check), doc + ' holds the sentence');
  assert.ok(flat('docs/OPERATIONS.md').includes('a manifest sealed before the card closes refuses a new entry, so a card with nothing retained keeps `closure.evidence` false; `aidlc goal cancel` ends the goal and the merge stands.'), 'the guide states the limit');
  assert.equal(flat('docs/OPERATIONS.md').includes('and `--evidence` record a step done by hand'), false);
  for (const copy of ['.claude/skills/aidlc-loop/card-loop.md', 'templates/claude/skills/aidlc-loop/card-loop.md']) {
    const retain = flat(copy).indexOf('aidlc evidence retain --card');
    assert.ok(retain >= 0, copy + ' names the option');
    assert.ok(flat(copy).indexOf('card close --all') > retain, copy + ' puts the removal after the evidence step');
    assert.ok(Buffer.byteLength(readFileSync(path.resolve(copy), 'utf8'), 'utf8') <= 6500, copy + ' stays under the cap');
  }
  const unreleased = readFileSync(path.resolve('CHANGELOG.md'), 'utf8').split(/^## /m).find((s) => s.startsWith('[Unreleased]') || s.startsWith('Unreleased'));
  assert.match(unreleased ?? '', /T0-CLOSE-EVIDENCE-CHECK/);
  const fx = makeFixture();
  try {
    const { goalId, run } = atClose(fx);
    const directive = closingRunner(fx, [], 'dry-run').next(fx.goal(goalId), fx.card(CARD), run).directive;
    assert.ok(directive.narration.includes('aidlc evidence retain --card ' + CARD), directive.narration);
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

test('T0-AUDIT-BINDING: the closure failure names --candidate with the digest of the last passing decision, else <digest>', (t) => {
  const invocation = (outcome: 'pass' | 'block', candidateDigest: string, n: number) => ({ invocationId: `r3:${n}`, candidateDigest, base: 'main', policyVersion: 'REVIEW.md@2', reviewer: 'codex', requestedAt: T0, outcome });
  const rows: Array<[string, Array<['pass' | 'block', string]>, string]> = [
    ['one pass', [['pass', 'd1']], 'd1'],
    ['a pass, then a block', [['pass', 'd1'], ['block', 'd2']], 'd1'],
    ['two passes', [['pass', 'd1'], ['pass', 'd2']], 'd2'],
    ['one block', [['block', 'd2']], '<digest>'],
    ['no decision', [], '<digest>'],
  ];
  for (const [name, decisions, candidate] of rows) {
    const fx = makeFixture();
    t.after(() => cleanup(fx.tmp));
    const { goalId, card } = atClose(fx);
    const run = stored(fx, goalId);
    const saved = fx.store.saveCardRun({ ...run, review: { ...run.review, invocations: decisions.map(([outcome, digest], i) => invocation(outcome, digest, i)) } });
    const message = refusal(() => closingRunner(fx, [], 'github').markClosure(fx.goal(goalId), card, saved, { evidence: true }));
    assert.ok(message.endsWith(` --candidate ${candidate}`), `${name}: ${message}`);
    const retain = `run aidlc evidence retain --goal ${goalId} --card ${CARD} --id ${CARD}.verdict --kind review-verdict --file `;
    assert.ok(message.includes(retain) && message.indexOf(retain) < message.lastIndexOf(' --candidate '), `${name}: ${message}`);
  }
});

test('T0-AUDIT-BINDING: the close narration and both card-loop copies name --candidate <digest>', (t) => {
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  const { goalId, run } = atClose(fx);
  const directive = closingRunner(fx, [], 'dry-run').next(fx.goal(goalId), fx.card(CARD), run).directive;
  const sentence = `\`--evidence\` checks that the goal manifest holds an intact file retained with \`aidlc evidence retain --card ${CARD}\`; \`aidlc audit seal\` also needs \`--candidate <digest>\` on each retained \`dod-receipt\`, \`review-verdict\`, \`ci-run\`, \`test-output\` or \`health\` file.`;
  assert.ok(directive.narration.includes(sentence), directive.narration);
  const close = [
    '## CLOSE',
    'Verify the merge on the intended base; do only missing steps:',
    'doc_sync, finding dispositions replayed idempotently from all verdicts,',
    'evidence (`aidlc evidence retain --card <id> --candidate <digest>`),',
    'base contents; last, `card close --all` writes status (commit on main),',
    'removes the worktree. A reminder or exit 0 is not closure. Persistence',
    'failure after merge => merge_verified + STOP/audit; never merge again.',
    'Lessons only under repository policy; no unrelated staging, sweeps or',
    'base pushes.',
    '',
  ].join('\n');
  const copies = ['.claude/skills/aidlc-loop/card-loop.md', 'templates/claude/skills/aidlc-loop/card-loop.md'].map((copy) => readFileSync(path.resolve(copy)));
  for (const text of copies) {
    assert.ok(text.toString('utf8').replace(/\r\n/g, '\n').includes(`\n${close}`), 'the CLOSE section holds the eight lines');
    assert.ok(text.every((b) => b < 0x80), 'ASCII');
    assert.ok(text.length <= 6500, `${text.length} bytes`);
  }
  assert.ok(copies[0]!.equals(copies[1]!), 'the copies are byte-identical');
});
