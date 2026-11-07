import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actorA, actorB, candidateShaFor, goalForCards, makeFixture, T0, writeCard, type Fixture } from './_harness.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';
import { makeStop } from '../../src/core/stop.ts';
import { decideWorktree } from '../../src/delivery/worktree.ts';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { sweepWorktrees, type ReclaimDeps, type ReclaimRow } from '../../src/loop/worktree-reclaim.ts';
import { GitProbe } from '../../src/probes/git.ts';
import { runSync, type SyncRunner } from '../../src/probes/exec.ts';
import { hostName } from '../../src/state/paths.ts';

// T0-WORKTREE-RECLAIM: the sweep removes the clean worktrees of finished cards and keeps every branch. Each test runs on a
// real temporary repository, because what is at stake is what git lists, refuses and deletes.

const CARD = 'T0-FINISHED';
const NEXT = 'T0-NEXT';
const TRACKED = 'tracked.txt';
const VERDICT = '{"verdict":"pass"}\n';
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));

type Ending = 'review' | 'cancelled' | 'done';

function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

/** A repository at `fx.tmp` with one branch per card. */
function repository(fx: Fixture, cards: string[] = [CARD]): void {
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\n_local/\nnode_modules/\ndist/\naidlc.config.json\n');
  writeFileSync(path.join(fx.tmp, TRACKED), 'base\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  for (const card of cards) git(fx.tmp, ['branch', card]);
}

/** Git prints long paths and the fixture's temporary directory can be a short one, so the root is canonical. */
function rootOf(fx: Fixture): string {
  mkdirSync(path.join(fx.tmp, 'wt'), { recursive: true });
  return realpathSync.native(path.join(fx.tmp, 'wt'));
}

/** The card's worktree at the expected path, with one verdict under `.review/`. */
function linked(fx: Fixture, card: string = CARD): string {
  const dir = path.join(rootOf(fx), card);
  git(fx.tmp, ['worktree', 'add', '-q', dir, card]);
  mkdirSync(path.join(dir, '.review'));
  writeFileSync(path.join(dir, '.review', 'a.json'), VERDICT);
  return dir;
}

/** A goal holding a run of the card, ended as the test says. */
function ended(fx: Fixture, card: string, ending: Ending): string {
  if (!existsSync(path.join(fx.cardsDir, `${card}.md`))) writeCard(fx, { id: card, title: 'finishes' });
  const goal = goalForCards(fx, [card]);
  fx.controller.ensureCardRun(fx.goal(goal.id), card);
  const current = fx.goal(goal.id);
  fx.store.saveGoal(ending === 'done' ? { ...current, state: 'DONE', terminal: true } : { ...current, state: 'STOP', terminal: true, stop: makeStop(ending, 'ended by the test', 'none', { at: T0 }) });
  return goal.id;
}

function supersede(fx: Fixture, card: string = CARD): void {
  const file = path.join(fx.cardsDir, `${card}.md`);
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^status: todo$/m, `status: todo\nsuperseded_by: ${card}-2`), 'utf8');
}

function deps(fx: Fixture, calls: string[][] = [], over: Partial<ReclaimDeps> = {}): ReclaimDeps {
  const runner: SyncRunner = (command, args, options) => {
    calls.push([command, ...args]);
    return runSync(command, args, options);
  };
  return {
    paths: fx.paths,
    repo: { ...fx.repo, isGit: true },
    config: { ...fx.config, shipPath: 'github', worktreeRoot: rootOf(fx) },
    store: fx.store,
    leases: fx.leases,
    ops: fx.ops,
    git: new GitProbe(runner),
    now: fx.now,
    ...over,
  };
}

function only(rows: ReclaimRow[], card: string = CARD): ReclaimRow {
  const row = rows.find((r) => r.cardId === card);
  assert.ok(row, `a row for ${card} in ${JSON.stringify(rows)}`);
  return row;
}

/** The config file the CLI reads, on a real ship path. */
function cliConfig(fx: Fixture): void {
  writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'github', worktreeRoot: rootOf(fx), cardsDir: 'specs/tasks', base: 'main' }));
}

function cli(fx: Fixture, ...args: string[]) {
  return spawnSync(process.execPath, [MAIN, ...args, '--json'], { cwd: fx.tmp, env: { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: actorA.session }, encoding: 'utf8', timeout: 120_000 });
}

test('T0-WORKTREE-RECLAIM acceptance 1: a superseded card loses its worktree and keeps its branch and its verdicts [R1] [R2] [R4]', () => {
  const fx = makeFixture();
  try {
    const goalId = ended(fx, CARD, 'review');
    supersede(fx);
    repository(fx);
    const dir = linked(fx);
    const row = only(sweepWorktrees(deps(fx)));
    assert.equal(row.action, 'removed', row.reason);
    assert.match(row.reason, /superseded by T0-FINISHED-2/);
    assert.equal(existsSync(dir), false);
    assert.equal(git(fx.tmp, ['worktree', 'list', '--porcelain']).includes(CARD), false);
    git(fx.tmp, ['rev-parse', '--verify', CARD]);
    assert.equal(readFileSync(path.join(fx.paths.evidence, goalId, 'review', CARD, 'a.json'), 'utf8'), VERDICT);
  } finally {
    fx.cleanup();
  }
});

const finishedWays: Array<[string, (fx: Fixture) => void]> = [
  ['a card file that says merged', (fx) => {
    ended(fx, CARD, 'review');
    const file = path.join(fx.cardsDir, `${CARD}.md`);
    writeFileSync(file, readFileSync(file, 'utf8').replace(/^status: todo$/m, 'status: merged'), 'utf8');
  }],
  ['a DONE run in its latest goal', (fx) => {
    const goalId = ended(fx, CARD, 'done');
    const run = fx.store.getCardRun(goalId, CARD);
    assert.ok(run);
    fx.store.saveCardRun({ ...run, state: 'DONE' });
  }],
  ['a latest goal that was cancelled', (fx) => {
    ended(fx, CARD, 'cancelled');
  }],
];

for (const [name, finish] of finishedWays) {
  test(`T0-WORKTREE-RECLAIM acceptance 2: ${name} is finished [R2]`, () => {
    const fx = makeFixture();
    try {
      finish(fx);
      repository(fx);
      const dir = linked(fx);
      assert.equal(only(sweepWorktrees(deps(fx))).action, 'removed');
      assert.equal(existsSync(dir), false);
    } finally {
      fx.cleanup();
    }
  });
}

const notFinished: Array<[string, (fx: Fixture) => void, RegExp]> = [
  ['a goal that is not terminal', (fx) => {
    writeCard(fx, { id: CARD, title: 'still running' });
    const goal = goalForCards(fx, [CARD]);
    fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
  }, /goal g-\S+ is not terminal/],
  ['an older goal that is not terminal', (fx) => {
    writeCard(fx, { id: CARD, title: 'still running' });
    const older = goalForCards(fx, [CARD]);
    fx.controller.ensureCardRun(fx.goal(older.id), CARD);
    fx.advance(60_000);
    ended(fx, CARD, 'cancelled');
  }, /goal g-\S+ is not terminal/],
  ['a card stopped for a ruling', (fx) => {
    ended(fx, CARD, 'review');
  }, /not merged, superseded or cancelled/],
  ['no card file', (fx) => {
    ended(fx, CARD, 'cancelled');
    rmSync(path.join(fx.cardsDir, `${CARD}.md`));
  }, /no card file/],
  ['no run', (fx) => {
    writeCard(fx, { id: CARD, title: 'never ran' });
  }, /no run/],
];

for (const [name, arrange, reason] of notFinished) {
  test(`T0-WORKTREE-RECLAIM acceptance 3: ${name} is skipped and stays [R1] [R2]`, () => {
    const fx = makeFixture();
    try {
      arrange(fx);
      repository(fx);
      const dir = linked(fx);
      const rows = sweepWorktrees(deps(fx));
      assert.equal(only(rows).action, 'skipped');
      assert.match(only(rows).reason, reason);
      assert.equal(existsSync(path.join(dir, TRACKED)), true);
      assert.equal(rows.length, 1, 'the main checkout has no row');
    } finally {
      fx.cleanup();
    }
  });
}

test('T0-WORKTREE-RECLAIM acceptance 3: a detached worktree is not a card worktree, and stays [R1] [R2]', () => {
  const fx = makeFixture();
  try {
    repository(fx, []);
    const dir = path.join(rootOf(fx), '_precheck');
    git(fx.tmp, ['worktree', 'add', '-q', '--detach', dir, 'main']);
    const rows = sweepWorktrees(deps(fx));
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.action, 'skipped');
    assert.match(rows[0]?.reason ?? '', /not a card worktree/);
    assert.equal(existsSync(path.join(dir, TRACKED)), true);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 3: a card branch at another path is skipped, and stays [R2]', () => {
  const fx = makeFixture();
  try {
    ended(fx, CARD, 'cancelled');
    repository(fx);
    const elsewhere = path.join(rootOf(fx), 'elsewhere');
    git(fx.tmp, ['worktree', 'add', '-q', elsewhere, CARD]);
    const row = only(sweepWorktrees(deps(fx)));
    assert.equal(row.action, 'skipped');
    assert.match(row.reason, /not a card worktree/);
    assert.equal(existsSync(path.join(elsewhere, TRACKED)), true);
  } finally {
    fx.cleanup();
  }
});

const keptBack: Array<[string, (fx: Fixture, dir: string, goalId: string) => void, RegExp]> = [
  ['a live lease of another session', (fx) => {
    fx.leases.claim(resourceKeys.card(fx.repo.key, CARD), { actor: actorB, now: T0 });
  }, /lease held by win-B/],
  ['an unresolved operation', (fx, _dir, goalId) => {
    fx.ops.recordIntent({ kind: 'deploy', goalId, cardId: CARD, target: 'staging', ownerGeneration: 0, timeoutMs: 1000 }, T0);
  }, /unresolved operation/],
  ['a modified tracked file', (_fx, dir) => {
    writeFileSync(path.join(dir, TRACKED), 'changed\n');
  }, /modified or untracked/],
  ['an untracked file', (_fx, dir) => {
    writeFileSync(path.join(dir, 'new.txt'), 'new\n');
  }, /modified or untracked/],
  ['an ignored directory the removal would delete', (_fx, dir) => {
    mkdirSync(path.join(dir, '_local'));
    writeFileSync(path.join(dir, '_local', 'build.log'), 'log\n');
  }, /ignored paths .*_local\//],
  ['a directory inside .review/', (_fx, dir) => {
    mkdirSync(path.join(dir, '.review', 'nested'));
    writeFileSync(path.join(dir, '.review', 'nested', 'b.json'), '{}\n');
  }, /\.review\/nested/],
];

for (const [name, arrange, reason] of keptBack) {
  test(`T0-WORKTREE-RECLAIM acceptance 4: ${name} keeps the worktree [R3]`, () => {
    const fx = makeFixture();
    try {
      const goalId = ended(fx, CARD, 'cancelled');
      repository(fx);
      const dir = linked(fx);
      arrange(fx, dir, goalId);
      const row = only(sweepWorktrees(deps(fx)));
      assert.equal(row.action, 'skipped', row.reason);
      assert.match(row.reason, reason);
      assert.equal(existsSync(path.join(dir, TRACKED)), true);
      assert.equal(existsSync(path.join(fx.paths.evidence, goalId, 'review')), false, 'a skip copies nothing');
    } finally {
      fx.cleanup();
    }
  });
}

test('T0-WORKTREE-RECLAIM acceptance 4: rebuilt ignored paths do not block, and go with the worktree [R3]', () => {
  const fx = makeFixture();
  try {
    ended(fx, CARD, 'cancelled');
    repository(fx);
    const dir = linked(fx);
    mkdirSync(path.join(dir, 'node_modules'));
    writeFileSync(path.join(dir, 'node_modules', 'a.js'), '');
    mkdirSync(path.join(dir, 'dist'));
    writeFileSync(path.join(dir, 'dist', 'a.js'), '');
    assert.equal(only(sweepWorktrees(deps(fx))).action, 'removed');
  } finally {
    fx.cleanup();
  }
});

const openLeases: Array<[string, (fx: Fixture) => void]> = [
  ['a released lease', (fx) => {
    const key = resourceKeys.card(fx.repo.key, CARD);
    const claimed = fx.leases.claim(key, { actor: actorB, now: T0 });
    fx.leases.release(key, claimed.lease.generation, actorB);
  }],
  ['an expired lease', (fx) => {
    fx.leases.claim(resourceKeys.card(fx.repo.key, CARD), { actor: actorB, now: T0 });
    fx.advance(11 * 60_000);
  }],
  ['a live lease of this session', (fx) => {
    fx.leases.claim(resourceKeys.card(fx.repo.key, CARD), { actor: actorA, now: T0 });
  }],
];

for (const [name, arrange] of openLeases) {
  test(`T0-WORKTREE-RECLAIM acceptance 4: ${name} does not block [R3]`, () => {
    const fx = makeFixture();
    try {
      ended(fx, CARD, 'cancelled');
      repository(fx);
      linked(fx);
      arrange(fx);
      assert.equal(only(sweepWorktrees(deps(fx))).action, 'removed');
    } finally {
      fx.cleanup();
    }
  });
}

test('T0-WORKTREE-RECLAIM acceptance 5: a card with runs in two goals keeps its copies under the latest goal [R4]', () => {
  const fx = makeFixture();
  try {
    const older = ended(fx, CARD, 'cancelled');
    fx.advance(60_000);
    const latest = ended(fx, CARD, 'cancelled');
    repository(fx);
    linked(fx);
    assert.equal(only(sweepWorktrees(deps(fx))).action, 'removed');
    assert.equal(existsSync(path.join(fx.paths.evidence, latest, 'review', CARD, 'a.json')), true);
    assert.equal(existsSync(path.join(fx.paths.evidence, older, 'review')), false);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 6: --dry-run prints what would go and changes nothing [R1]', () => {
  const fx = makeFixture();
  try {
    const goalId = ended(fx, CARD, 'cancelled');
    repository(fx);
    const dir = linked(fx);
    cliConfig(fx);
    const before = readFileSync(path.join(fx.cardsDir, `${CARD}.md`), 'utf8');
    const out = cli(fx, 'worktree', 'reclaim', '--dry-run');
    assert.equal(out.status, 0, out.stderr);
    const rows = JSON.parse(out.stdout) as ReclaimRow[];
    assert.equal(only(rows).action, 'would remove');
    assert.equal(existsSync(path.join(dir, TRACKED)), true);
    assert.equal(existsSync(path.join(fx.paths.evidence, goalId, 'review')), false);
    assert.equal(readFileSync(path.join(fx.cardsDir, `${CARD}.md`), 'utf8'), before);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 7: a failed worktree is a row, the next one goes, and the command exits nonzero [R5]', () => {
  const fx = makeFixture();
  try {
    const failing = ended(fx, CARD, 'cancelled');
    fx.advance(60_000);
    ended(fx, NEXT, 'cancelled');
    repository(fx, [CARD, NEXT]);
    const dir = linked(fx);
    const next = linked(fx, NEXT);
    mkdirSync(path.join(fx.paths.evidence, failing), { recursive: true });
    writeFileSync(path.join(fx.paths.evidence, failing, 'review'), 'a file where the copies go\n');
    cliConfig(fx);
    const out = cli(fx, 'worktree', 'reclaim');
    assert.equal(out.status, 1, out.stderr);
    const rows = JSON.parse(out.stdout) as ReclaimRow[];
    assert.equal(only(rows).action, 'failed');
    assert.notEqual(only(rows).reason, '');
    assert.equal(only(rows, NEXT).action, 'removed');
    assert.equal(existsSync(path.join(dir, TRACKED)), true);
    assert.equal(existsSync(next), false);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 7: rows that are only skipped exit zero [R5]', () => {
  const fx = makeFixture();
  try {
    ended(fx, CARD, 'review');
    repository(fx);
    linked(fx);
    cliConfig(fx);
    const out = cli(fx, 'worktree', 'reclaim');
    assert.equal(out.status, 0, out.stderr);
    assert.equal(only(JSON.parse(out.stdout) as ReclaimRow[]).action, 'skipped');
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 8: goal cancel removes the worktree of its card and says so on stderr [R6]', () => {
  const fx = makeFixture();
  try {
    writeCard(fx, { id: CARD, title: 'cancelled' });
    const goal = goalForCards(fx, [CARD]);
    fx.controller.ensureCardRun(fx.goal(goal.id), CARD);
    repository(fx);
    const dir = linked(fx);
    cliConfig(fx);
    const out = cli(fx, 'goal', 'cancel', goal.id);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(fx.goal(goal.id).stop?.reason, 'cancelled');
    assert.match(out.stderr, new RegExp(`removed.*${CARD}`));
    assert.equal(existsSync(dir), false);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 8: a sweep that throws changes neither the stdout nor the exit code of goal cancel [R6]', () => {
  const clean = makeFixture();
  const broken = makeFixture();
  try {
    const run = (fx: Fixture, arrange: () => void) => {
      writeCard(fx, { id: CARD, title: 'cancelled' });
      const goal = goalForCards(fx, [CARD]);
      repository(fx);
      cliConfig(fx);
      arrange();
      const out = cli(fx, 'goal', 'cancel', goal.id);
      return { status: out.status, keys: Object.keys(JSON.parse(out.stdout) as object).sort(), stderr: out.stderr };
    };
    const plain = run(clean, () => undefined);
    const thrown = run(broken, () => writeFileSync(path.join(broken.paths.goals, 'g-broken.json'), '{'));
    assert.equal(thrown.status, 0, thrown.stderr);
    assert.equal(thrown.status, plain.status);
    assert.deepEqual(thrown.keys, plain.keys);
    assert.match(thrown.stderr, /worktree sweep did not finish/);
  } finally {
    clean.cleanup();
    broken.cleanup();
  }
});

/** A run at CLOSE whose lease the CLI of this host and session holds far ahead of the fixed clock, with its worktree. */
function closingAtCli(fx: Fixture): { goalId: string; dir: string } {
  writeCard(fx, { id: NEXT, title: 'closes' });
  const goal = goalForCards(fx, [NEXT]);
  const runner = fx.runner();
  const card = fx.card(NEXT);
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), NEXT));
  r = runner.next(fx.goal(goal.id), card, r.run);
  const built = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: candidateShaFor(NEXT) });
  r = runner.next(fx.goal(goal.id), card, built);
  assert.equal(r.directive.kind, 'close', r.directive.narration);
  const generation = r.run.ownerGeneration;
  assert.notEqual(generation, undefined);
  fx.leases.heartbeat(resourceKeys.card(fx.repo.key, NEXT), generation as number, { now: '2099-01-01T00:00:00.000Z' });
  return { goalId: goal.id, dir: path.join(rootOf(fx), NEXT) };
}

test('T0-WORKTREE-RECLAIM acceptance 8: card close --all removes a finished card beside its own [R6]', () => {
  const fx = makeFixture({ actor: { ...actorA, host: hostName() } });
  try {
    ended(fx, CARD, 'cancelled');
    fx.advance(60_000);
    const { goalId, dir } = closingAtCli(fx);
    repository(fx, [CARD, NEXT]);
    const finished = linked(fx);
    linked(fx, NEXT);
    const evidence = new EvidenceStore(fx.paths.evidence, goalId);
    evidence.retain(evidence.load(goalId, 1, 1, T0), { id: 'verdict.json', kind: 'review-verdict', content: VERDICT, cardId: NEXT });
    cliConfig(fx);
    const out = cli(fx, 'card', 'close', NEXT, '--goal', goalId, '--all');
    assert.equal(out.status, 0, out.stderr);
    assert.equal((JSON.parse(out.stdout) as { cleanup: boolean }).cleanup, true);
    assert.match(out.stderr, new RegExp(`removed.*${CARD}`));
    assert.equal(existsSync(dir), false);
    assert.equal(existsSync(finished), false);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 9: card close without the cleanup step runs no sweep [R6]', () => {
  const fx = makeFixture({ actor: { ...actorA, host: hostName() } });
  try {
    ended(fx, CARD, 'cancelled');
    fx.advance(60_000);
    const { goalId } = closingAtCli(fx);
    repository(fx, [CARD, NEXT]);
    const finished = linked(fx);
    cliConfig(fx);
    const out = cli(fx, 'card', 'close', NEXT, '--goal', goalId, '--doc-sync');
    assert.equal(out.status, 0, out.stderr);
    assert.equal(existsSync(path.join(finished, TRACKED)), true);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 10: the dry-run path and a repository that is not git run no git and report no row [R7]', () => {
  const fx = makeFixture();
  try {
    ended(fx, CARD, 'cancelled');
    repository(fx);
    const dir = linked(fx);
    const calls: string[][] = [];
    assert.deepEqual(sweepWorktrees(deps(fx, calls, { config: { ...fx.config, shipPath: 'dry-run' } })), []);
    assert.deepEqual(sweepWorktrees(deps(fx, calls, { repo: { ...fx.repo, isGit: false } })), []);
    assert.deepEqual(calls, []);
    assert.equal(existsSync(path.join(dir, TRACKED)), true);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 11: after a removal PREPARE starts the worktree again on the branch, which keeps its commit [R4]', () => {
  const fx = makeFixture();
  try {
    ended(fx, CARD, 'cancelled');
    repository(fx);
    const dir = linked(fx);
    writeFileSync(path.join(dir, 'work.txt'), 'committed work\n');
    git(dir, ['add', 'work.txt']);
    git(dir, ['commit', '-q', '-m', 'work']);
    const head = git(dir, ['rev-parse', 'HEAD']);
    assert.equal(only(sweepWorktrees(deps(fx))).action, 'removed');
    assert.equal(git(fx.tmp, ['rev-parse', CARD]), head);
    const decision = decideWorktree(new GitProbe(runSync), { mainRoot: fx.tmp, worktreeRoot: rootOf(fx), cardId: CARD, session: actorA.session });
    assert.equal(decision.action, 'start');
    assert.equal(decision.action === 'start' ? decision.path : '', dir);
  } finally {
    fx.cleanup();
  }
});

test('T0-WORKTREE-RECLAIM acceptance 12: the guide, the architecture note and the changelog state the sweep [R8]', () => {
  const flat = (file: string) => readFileSync(path.resolve(file), 'utf8').replace(/\s+/g, ' ');
  const sentence = '`aidlc worktree reclaim` removes the clean worktrees of merged, superseded and cancelled cards, and `card close --cleanup`, `card close --all` and `goal cancel` run it; the branch stays and `.review/` goes to the evidence tree.';
  for (const doc of ['docs/OPERATIONS.md', 'docs/ARCHITECTURE.md']) assert.ok(flat(doc).includes(sentence), `${doc} holds the sentence`);
  assert.ok(flat('docs/OPERATIONS.md').includes('no lock spans the check and the removal, so a `goal resume` and `card next` in another session in that window can lose a clean worktree, and `card next` then starts it again on the branch.'), 'the guide states the limit');
  assert.ok(flat('docs/OPERATIONS.md').includes('ignored path'), 'the guide states the rule on ignored paths');
  const unreleased = readFileSync(path.resolve('CHANGELOG.md'), 'utf8').split(/^## /m).find((s) => s.startsWith('[Unreleased]') || s.startsWith('Unreleased'));
  assert.match(unreleased ?? '', /T0-WORKTREE-RECLAIM/);
  assert.deepEqual(readdirSync(path.resolve('tests/scenarios')).filter((f) => f === 'worktree-reclaim.test.ts'), ['worktree-reclaim.test.ts']);
});
