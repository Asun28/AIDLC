import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeFixture, writeCard, goalForCards } from './_harness.ts';
import { CardRunner } from '../../src/loop/card-runner.ts';
import { DryRunShipPath } from '../../src/delivery/ship.ts';
import { codeSpan, shellArg, worktreeStartCommands } from '../../src/delivery/worktree.ts';

const CARD = 'T1-HELLO';

function git(cwd: string, args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

interface Options {
  shipPath: 'github' | 'dry-run' | 'scaffold';
  mode?: 'local' | 'remote';
  nodeModules?: boolean;
  origin?: boolean;
  /** The name of the worktree root directory under the fixture, `wt` by default. */
  rootName?: string;
}

/** A goal that projects T1-HELLO in a real git repository (the setup of prepare-worktree.test.ts), with canonical roots. */
function setup(options: Options) {
  const fx = makeFixture();
  writeCard(fx, { id: CARD, title: 'say hello' });
  const goal = goalForCards(fx, [CARD]);
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\nwt/\nnode_modules/\norigin.git/\n');
  git(fx.tmp, ['init', '-q', '-b', 'main']);
  git(fx.tmp, ['add', '-A']);
  git(fx.tmp, ['commit', '-q', '-m', 'base']);
  if (options.nodeModules) mkdirSync(path.join(fx.tmp, 'node_modules'), { recursive: true });
  if (options.origin) {
    git(fx.tmp, ['init', '-q', '--bare', '-b', 'main', path.join(fx.tmp, 'origin.git')]);
    git(fx.tmp, ['remote', 'add', 'origin', path.join(fx.tmp, 'origin.git')]);
    git(fx.tmp, ['push', '-q', 'origin', 'main']);
    git(fx.tmp, ['fetch', '-q', 'origin']);
  }
  const rootName = options.rootName ?? 'wt';
  mkdirSync(path.join(fx.tmp, rootName), { recursive: true });
  const root = realpathSync.native(path.join(fx.tmp, rootName));
  const mainRoot = realpathSync.native(fx.tmp);
  // The scaffold path refuses a remote card under an advisory ReviewGate before PREPARE, so its fixture makes the gate required.
  const config = { ...fx.config, shipPath: options.shipPath, mode: options.mode ?? 'remote', worktreeRoot: root, gateRequired: options.shipPath === 'scaffold' };
  const runner = new CardRunner({ paths: fx.paths, repo: { ...fx.repo, mainRoot, worktreeRoot: mainRoot }, config, store: fx.store, leases: fx.leases, queue: fx.queue, ops: fx.ops, shipPath: new DryRunShipPath(['merged']), now: fx.now });
  const next = () => runner.next(fx.goal(goal.id), fx.card(CARD), fx.store.getCardRun(goal.id, CARD) ?? fx.controller.ensureCardRun(fx.goal(goal.id), CARD));
  return { fx, mainRoot, worktree: path.join(root, CARD), next };
}

function startNarration(next: ReturnType<typeof setup>['next'], worktree: string): string {
  const first = next();
  assert.equal(first.directive.kind, 'prepare', first.directive.narration);
  if (first.directive.kind === 'prepare') {
    assert.equal(first.directive.action, 'start');
    assert.equal(first.directive.worktree, worktree);
  }
  return first.directive.narration;
}

test('T0-PREPARE-START-CMD acceptance 2: on github with node_modules in the main checkout the start narration names git worktree add from origin/<base> and the node_modules link, and no task.ps1 [R2]', () => {
  const { fx, mainRoot, worktree, next } = setup({ shipPath: 'github', nodeModules: true });
  try {
    const n = startNarration(next, worktree);
    const expected = worktreeStartCommands({ cardId: CARD, path: worktree, mainRoot, ref: 'origin/main', linkModules: true, platform: process.platform });
    assert.ok(n.includes(expected), `narration holds ${expected}: ${n}`);
    assert.ok(n.includes('node_modules'), n);
    assert.ok(!/task\.ps1/i.test(n), n);
  } finally {
    fx.cleanup();
  }
});

test('T0-PREPARE-START-CMD acceptance 2: on github without node_modules the narration names no link; in local mode the ref is the base itself [R2]', () => {
  for (const mode of ['remote', 'local'] as const) {
    const { fx, mainRoot, worktree, next } = setup({ shipPath: 'github', mode });
    try {
      const n = startNarration(next, worktree);
      const expected = worktreeStartCommands({ cardId: CARD, path: worktree, mainRoot, ref: mode === 'remote' ? 'origin/main' : 'main', linkModules: false, platform: process.platform });
      assert.ok(n.includes(expected), `${mode}: narration holds ${expected}: ${n}`);
      assert.ok(!n.includes('node_modules'), `${mode}: ${n}`);
      assert.ok(!/task\.ps1/i.test(n), `${mode}: ${n}`);
      if (mode === 'local') assert.ok(!n.includes('origin/'), n);
    } finally {
      fx.cleanup();
    }
  }
});

test('T0-PREPARE-START-CMD acceptance 2: on dry-run the start narration holds the same commands and no task.ps1 [R2]', () => {
  const { fx, mainRoot, worktree, next } = setup({ shipPath: 'dry-run', nodeModules: true });
  try {
    const n = startNarration(next, worktree);
    const expected = worktreeStartCommands({ cardId: CARD, path: worktree, mainRoot, ref: 'origin/main', linkModules: true, platform: process.platform });
    assert.ok(n.includes(expected), `narration holds ${expected}: ${n}`);
    assert.ok(!/task\.ps1/i.test(n), n);
  } finally {
    fx.cleanup();
  }
});

test('T0-PREPARE-START-CMD acceptance 3: the git worktree add -b command the github narration names makes a worktree the next card next attaches to [R2]', () => {
  const { fx, mainRoot, worktree, next } = setup({ shipPath: 'github', origin: true });
  try {
    const n = startNarration(next, worktree);
    const span = `git worktree add -b ${CARD} "${worktree}" origin/main`;
    assert.ok(n.includes(`\`${span}\``), n);
    git(mainRoot, ['worktree', 'add', '-q', '-b', CARD, worktree, 'origin/main']);
    const attach = next();
    assert.equal(attach.directive.kind, 'prepare', attach.directive.narration);
    if (attach.directive.kind === 'prepare') {
      assert.equal(attach.directive.action, 'attach');
      assert.equal(attach.directive.worktree.toLowerCase(), worktree.toLowerCase());
      assert.ok(!attach.directive.narration.includes('git worktree add'), `an attach names no start command: ${attach.directive.narration}`);
    }
  } finally {
    fx.cleanup();
  }
});

test('T0-PREPARE-START-CMD acceptance 4: on scaffold the start narration names task.ps1 -Phase start as before and no git worktree add -b [R3]', () => {
  const { fx, worktree, next } = setup({ shipPath: 'scaffold', nodeModules: true });
  try {
    const n = startNarration(next, worktree);
    assert.ok(n.endsWith(`Start a new worktree for ${CARD} at ${worktree} (scaffold: pwsh scripts/task.ps1 -TaskId ${CARD} -Phase start from the main checkout). no worktree for this branch; start a new one`), `the start sentence as on main: ${n}`);
    assert.ok(!n.includes('git worktree add -b'), n);
  } finally {
    fx.cleanup();
  }
});

// R3 decisions 1 and 2: a worktree root with shell metacharacters and backticks, made by git itself.
const HOSTILE_ROOT = 'w $(x) `b` it\'s';

test('T0-PREPARE-START-CMD R3 decisions 1 and 2: with a worktree root holding $(...), backticks and a quote, the start narration and a stale-registration start quote the path for the shell, each command one whole code span [R1] [R2]', () => {
  const { fx, mainRoot, worktree, next } = setup({ shipPath: 'github', rootName: HOSTILE_ROOT });
  try {
    const n = startNarration(next, worktree);
    const quoted = shellArg(worktree, process.platform);
    assert.ok(!quoted.startsWith('"'), `the hostile path is single-quoted: ${quoted}`);
    assert.ok(n.includes(worktreeStartCommands({ cardId: CARD, path: worktree, mainRoot, ref: 'origin/main', linkModules: false, platform: process.platform })), n);
    assert.ok(n.includes(codeSpan(`git worktree add -b ${CARD} ${quoted} origin/main`)), n);
    git(fx.tmp, ['worktree', 'add', '-q', '-b', CARD, worktree]);
    next();
    assert.equal(next().directive.kind, 'build');
    git(fx.tmp, ['worktree', 'lock', worktree]);
    rmSync(worktree, { recursive: true, force: true });
    const stale = next();
    assert.equal(stale.directive.kind, 'prepare', stale.directive.narration);
    const s = stale.directive.narration;
    assert.ok(s.includes(codeSpan(`git worktree unlock ${quoted}`)), `the unlock command is quoted and whole: ${s}`);
    assert.ok(s.includes(codeSpan(`git worktree add ${quoted} ${CARD}`)), `the add command of the reason is quoted and whole: ${s}`);
    assert.ok(!s.includes(`"${worktree}"`), `no path in plain double quotes: ${s}`);
    git(fx.tmp, ['worktree', 'unlock', worktree]);
    git(fx.tmp, ['worktree', 'prune']);
  } finally {
    fx.cleanup();
  }
});

test('T0-PREPARE-START-CMD R3 decision 3: on scaffold, a stale-registration start under a worktree root holding $(...) and backticks keeps the narration of main, with the path in plain double quotes [R3]', () => {
  const { fx, worktree, next } = setup({ shipPath: 'scaffold', rootName: HOSTILE_ROOT });
  try {
    startNarration(next, worktree);
    git(fx.tmp, ['worktree', 'add', '-q', '-b', CARD, worktree]);
    next();
    assert.equal(next().directive.kind, 'build');
    git(fx.tmp, ['worktree', 'lock', worktree]);
    rmSync(worktree, { recursive: true, force: true });
    const stale = next();
    assert.equal(stale.directive.kind, 'prepare', stale.directive.narration);
    const asOnMain = `Start a new worktree for ${CARD} at ${worktree} (scaffold: pwsh scripts/task.ps1 -TaskId ${CARD} -Phase start from the main checkout). git still registers a worktree of branch ${CARD} at this path, but no directory is there: make the locked worktree's directory available again, or run \`git worktree unlock "${worktree}"\` and \`git worktree prune\` from the main checkout, then make the worktree with \`git worktree add "${worktree}" ${CARD}\`, since the branch exists`;
    assert.ok(stale.directive.narration.endsWith(asOnMain), `the scaffold narration as on main: ${stale.directive.narration}`);
    git(fx.tmp, ['worktree', 'unlock', worktree]);
    git(fx.tmp, ['worktree', 'prune']);
  } finally {
    fx.cleanup();
  }
});
