import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCliInProcess } from './cli-inprocess.ts';
import { tmpDir } from './helpers.ts';
import fs, { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import { actorA, candidateShaFor, goalForCards, makeFixture, T0, writeCard, type Fixture } from '../scenarios/_harness.ts';
import { resourceKeys } from '../../src/coordination/lease.ts';
import { makeStop } from '../../src/core/stop.ts';
import { EvidenceStore } from '../../src/audit/manifest.ts';
import { currentActor, setActorForTests } from '../../src/state/journal.ts';
import { hostName, prefetchRepoIdentity, resetRepoIdentityForTests, resolveRepoIdentity, settleRepoIdentity, shortKey } from '../../src/state/paths.ts';

const BIN = path.join(import.meta.dirname, '..', '..', 'bin', 'aidlc.js');

function fixture(): { repo: string; env: NodeJS.ProcessEnv } {
  const repo = tmpDir('aidlc-inproc-repo-');
  const init = spawnSync('git', ['init', '-q'], { cwd: repo, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: tmpDir('aidlc-inproc-state-'), AIDLC_SESSION: 'inproc-session' };
  delete env['AIDLC_ENTRY_DEBUG'];
  delete env['AIDLC_RUN_NO_SHIP'];
  return { repo, env };
}

function child(argv: string[], options: { cwd: string; env: NodeJS.ProcessEnv; input?: string }): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [BIN, ...argv], { cwd: options.cwd, env: options.env, encoding: 'utf8', input: options.input ?? '' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

function processState(): unknown[] {
  return [process.cwd(), JSON.stringify(Object.entries(process.env).sort(([a], [b]) => (a < b ? -1 : 1))), process.exitCode, process.exit, process.stdout.write, process.stderr.write, Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'), Object.getOwnPropertyDescriptor(process, 'stdin')];
}

// Before any call: acceptance 2 also checks that the calls of acceptance 1 left nothing behind.
const atLoad = processState();

describe('runCliInProcess', () => {
  it('T1-TEST-CLI-INPROC acceptance 1: in-process and bin/aidlc.js give the same status, stdout and stderr', async () => {
    const { repo, env } = fixture();
    const calls: Array<{ argv: string[]; status: number }> = [
      { argv: ['--help'], status: 0 },
      { argv: ['frobnicate'], status: 1 },
      { argv: ['cards', 'validate'], status: 0 },
      { argv: ['-C', 'nowhere', 'cards', 'validate'], status: 1 },
      { argv: ['ops', 'intent', '--goal', 'g-x', '--kind', 'bogus', '--target', 't'], status: 1 },
      { argv: ['next', '--goal', 'g-nope\n\n  second  '], status: 1 },
    ];
    for (const { argv, status } of calls) {
      const expected = child(argv, { cwd: repo, env });
      assert.equal(expected.status, status, `child ${argv.join(' ')}: ${expected.stderr}`);
      const actual = await runCliInProcess(argv, { cwd: repo, env });
      assert.deepEqual(actual, expected, argv.join(' '));
    }
    // A key given as undefined is left out of the call's environment, as spawnSync leaves it out of the child's.
    const unset = { ...env, AIDLC_SESSION: undefined, CLAUDE_CODE_SESSION_ID: undefined };
    const sessionLine = (stdout: string): string | undefined => stdout.split('\n').find((l) => l.startsWith('session '));
    const expected = child(['doctor', '--no-json'], { cwd: repo, env: unset });
    assert.match(sessionLine(expected.stdout) ?? '', /^session +default-/);
    assert.equal(sessionLine((await runCliInProcess(['doctor', '--no-json'], { cwd: repo, env: unset })).stdout), sessionLine(expected.stdout));
  });

  it('T1-TEST-CLI-INPROC acceptance 2: cwd, env, exitCode, exit and the streams are restored after a passing, an exiting and a throwing call', async () => {
    const { repo, env } = fixture();
    const before = processState();
    assert.deepEqual(before, atLoad);
    const calls: Array<{ argv: string[]; status: number }> = [
      { argv: ['cards', 'validate'], status: 0 },
      { argv: ['security', 'check'], status: 2 },
      { argv: ['-C', 'nowhere', 'cards', 'validate'], status: 1 },
      { argv: ['ops', 'intent', '--goal', 'g-x', '--kind', 'bogus', '--target', 't'], status: 1 },
    ];
    for (const { argv, status } of calls) {
      const r = await runCliInProcess(argv, { cwd: repo, env: { ...env, AIDLC_INPROC_PROBE: '1' } });
      assert.equal(r.status, status, argv.join(' '));
      assert.deepEqual(processState(), before, argv.join(' '));
    }
  });

  it('T1-TEST-CLI-INPROC acceptance 3: a nested call rejects naming the helper', async () => {
    const { repo, env } = fixture();
    const before = processState();
    const first = runCliInProcess(['cards', 'validate'], { cwd: repo, env });
    await assert.rejects(runCliInProcess(['--help'], { cwd: repo, env }), /runCliInProcess/);
    assert.equal((await first).status, 0);
    assert.deepEqual(processState(), before);
  });

  it('T1-TEST-CLI-INPROC acceptance 4: input', async () => {
    const { repo, env } = fixture();
    const argv = ['hook', 'auto'];
    const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: 'add a new feature to build X' });
    const expected = child(argv, { cwd: repo, env, input });
    assert.match(expected.stdout, /\[route\]/);
    assert.deepEqual(await runCliInProcess(argv, { cwd: repo, env, input }), expected);
  });
});

// T1-TEST-CLI-INPROC-2: a card close whose cleanup sweep removes the worktree of a card of a cancelled goal, as in
// tests/scenarios/worktree-reclaim.test.ts. The sweep runs from an exit listener and reports through writeSync(2).
const FINISHED = 'T0-FINISHED';
const CLOSING = 'T0-NEXT';

function gitIn(cwd: string, args: string[]): void {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
}

/** A cancelled goal holding FINISHED with its clean worktree, and a goal at CLOSE for CLOSING; `loads: false` removes the card file of CLOSING, so card close stops at load. */
function closeFixture(loads: boolean): { fx: Fixture; goalId: string; finished: string; env: NodeJS.ProcessEnv } {
  const fx = makeFixture({ actor: { ...actorA, host: hostName() } });
  writeCard(fx, { id: FINISHED, title: 'finishes' });
  const ended = goalForCards(fx, [FINISHED]);
  fx.controller.ensureCardRun(fx.goal(ended.id), FINISHED);
  fx.store.saveGoal({ ...fx.goal(ended.id), state: 'STOP', terminal: true, stop: makeStop('cancelled', 'ended by the test', 'none', { at: T0 }) });
  fx.advance(60_000);
  writeCard(fx, { id: CLOSING, title: 'closes' });
  const goal = goalForCards(fx, [CLOSING]);
  const runner = fx.runner();
  const card = fx.card(CLOSING);
  let r = runner.next(fx.goal(goal.id), card, fx.controller.ensureCardRun(fx.goal(goal.id), CLOSING));
  r = runner.next(fx.goal(goal.id), card, r.run);
  const built = runner.recordAttempt(fx.goal(goal.id), card, r.run, { outcome: 'success', dodReceipt: 'dod:ok', redReceipt: 'red:ok', candidateSha: candidateShaFor(CLOSING) });
  r = runner.next(fx.goal(goal.id), card, built);
  assert.equal(r.directive.kind, 'close', r.directive.narration);
  const lease = fx.leases.heartbeat(resourceKeys.card(fx.repo.key, CLOSING), r.run.ownerGeneration as number, { now: '2099-01-01T00:00:00.000Z' });
  const cliKey = resourceKeys.card(shortKey(realpathSync.native(fx.tmp)), CLOSING);
  if (cliKey !== lease.resourceKey) fx.leases.update(cliKey, () => ({ ...lease, resourceKey: cliKey }));
  writeFileSync(path.join(fx.tmp, '.gitignore'), '.aidlc/\n.review/\nwt/\naidlc.config.json\n');
  writeFileSync(path.join(fx.tmp, 'tracked.txt'), 'base\n');
  gitIn(fx.tmp, ['init', '-q', '-b', 'main']);
  gitIn(fx.tmp, ['add', '-A']);
  gitIn(fx.tmp, ['commit', '-q', '-m', 'base']);
  mkdirSync(path.join(fx.tmp, 'wt'), { recursive: true });
  const root = realpathSync.native(path.join(fx.tmp, 'wt'));
  for (const id of [FINISHED, CLOSING]) {
    gitIn(fx.tmp, ['branch', id]);
    gitIn(fx.tmp, ['worktree', 'add', '-q', path.join(root, id), id]);
  }
  const evidence = new EvidenceStore(fx.paths.evidence, goal.id);
  evidence.retain(evidence.load(goal.id, 1, 1, T0), { id: 'verdict.json', kind: 'review-verdict', content: '{"verdict":"pass"}\n', cardId: CLOSING });
  if (!loads) rmSync(path.join(fx.cardsDir, `${CLOSING}.md`));
  writeFileSync(path.join(fx.tmp, 'aidlc.config.json'), JSON.stringify({ shipPath: 'github', worktreeRoot: root, cardsDir: 'specs/tasks', base: 'main' }));
  const env: NodeJS.ProcessEnv = { ...process.env, AIDLC_STATE_DIR: fx.paths.root, AIDLC_SESSION: actorA.session };
  delete env['AIDLC_ENTRY_DEBUG'];
  delete env['AIDLC_RUN_NO_SHIP'];
  return { fx, goalId: goal.id, finished: path.join(root, FINISHED), env };
}

/** The output with what differs between two fixtures taken out: the temporary directory, goal ids and times. */
function stable(fx: Fixture, text: string): string {
  return text.split(realpathSync.native(fx.tmp)).join('<tmp>').split(fx.tmp).join('<tmp>').replace(/g-\d{14}-[0-9a-f]{6}/g, '<goal>').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<time>');
}

function intentFile(stdout: string): string {
  return (JSON.parse(stdout) as { file: string }).file;
}

function authorOf(stdout: string): string | undefined {
  return /^author: (.*)$/m.exec(readFileSync(intentFile(stdout), 'utf8'))?.[1];
}

describe('runCliInProcess, per-call state and output', () => {
  it('T1-TEST-CLI-INPROC-2 acceptance 2: two calls with different AIDLC_SESSION record different authors, and two calls with different GIT_DIR in one cwd resolve different repositories, as two bin/aidlc.js children do', async () => {
    const { repo, env } = fixture();
    const sessions = ['inproc-a', 'inproc-b'];
    for (const [n, session] of sessions.entries()) {
      const expected = child(['intent', 'new', '--title', `child ${n}`], { cwd: repo, env: { ...env, AIDLC_SESSION: session } });
      assert.equal(authorOf(expected.stdout), session, expected.stderr);
      const actual = await runCliInProcess(['intent', 'new', '--title', `inproc ${n}`], { cwd: repo, env: { ...env, AIDLC_SESSION: session } });
      assert.equal(actual.status, 0, actual.stderr);
      assert.equal(authorOf(actual.stdout), session);
    }

    const work = tmpDir('aidlc-inproc-work-');
    // An identity the caller cached for this cwd before the calls does not reach them.
    const callers = resolveRepoIdentity(work);
    for (const [n, name] of ['one', 'two'].entries()) {
      const other = tmpDir(`aidlc-inproc-${name}-`);
      gitIn(other, ['init', '-q']);
      const gitEnv = { ...env, GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other };
      const expected = child(['intent', 'new', '--title', `child ${n}`], { cwd: work, env: gitEnv });
      assert.equal(expected.status, 0, expected.stderr);
      const actual = await runCliInProcess(['intent', 'new', '--title', `inproc ${n}`], { cwd: work, env: gitEnv });
      assert.equal(actual.status, 0, actual.stderr);
      assert.equal(path.dirname(intentFile(actual.stdout)), path.dirname(intentFile(expected.stdout)));
      assert.equal(path.dirname(intentFile(actual.stdout)), path.join(realpathSync.native(other), 'intent'));
      // The identity the call resolved does not reach the caller either.
      assert.deepEqual(resolveRepoIdentity(work), callers);
    }

    // The caller's actor is restored: a set one stays, and with none set the cache stays empty.
    const mine = { ...actorA, session: 'caller-session' };
    try {
      setActorForTests(mine);
      await runCliInProcess(['intent', 'new', '--title', 'restored set'], { cwd: repo, env: { ...env, AIDLC_SESSION: 'inproc-c' } });
      assert.deepEqual(currentActor(), mine);
      setActorForTests(undefined);
      await runCliInProcess(['intent', 'new', '--title', 'restored none'], { cwd: repo, env: { ...env, AIDLC_SESSION: 'inproc-d' } });
      assert.equal(currentActor({ AIDLC_SESSION: 'computed-after' }).session, 'computed-after');
    } finally {
      setActorForTests(undefined);
    }
  });

  it('T1-TEST-CLI-INPROC-2 acceptance 3: an exit listener added by card close --cleanup runs inside the call on refusal and on success, and listeners present before the call stay', async () => {
    const seen: unknown[] = [];
    const present = (code: unknown) => void seen.push(code);
    process.on('exit', present);
    const fixtures: Fixture[] = [];
    try {
      const before = process.rawListeners('exit');
      const refused = closeFixture(false);
      fixtures.push(refused.fx);
      const r1 = await runCliInProcess(['card', 'close', CLOSING, '--goal', refused.goalId, '--cleanup', '--json'], { cwd: refused.fx.tmp, env: refused.env });
      assert.equal(r1.status, 1, r1.stderr);
      assert.match(r1.stderr, new RegExp(`aidlc: card ${CLOSING} not found`));
      assert.match(r1.stderr, new RegExp(`worktree removed: ${FINISHED}`));
      assert.equal(existsSync(refused.finished), false, 'the sweep ran before the call returned');
      assert.deepEqual(process.rawListeners('exit'), before);

      const closed = closeFixture(true);
      fixtures.push(closed.fx);
      const r2 = await runCliInProcess(['card', 'close', CLOSING, '--goal', closed.goalId, '--all', '--json'], { cwd: closed.fx.tmp, env: closed.env });
      assert.equal(r2.status, 0, r2.stderr);
      assert.match(r2.stderr, new RegExp(`worktree removed: ${FINISHED}`));
      assert.equal(existsSync(closed.finished), false, 'the sweep ran before the call returned');
      assert.deepEqual(process.rawListeners('exit'), before);
      assert.deepEqual(seen, []);
    } finally {
      process.removeListener('exit', present);
      for (const fx of fixtures) fx.cleanup();
      setActorForTests(undefined);
    }
  });

  it('T1-TEST-CLI-INPROC-2 acceptance 4: output written through stdio inherit and a synchronous write to fd 2 is captured or the call is refused', async () => {
    // stdio inherit (scaffold `card start` runs pwsh with stdio: 'inherit'): captured, equal to the child.
    const writeSyncBefore = fs.writeSync;
    const spawnSyncBefore = childProcess.spawnSync;
    const { repo, env } = fixture();
    mkdirSync(path.join(repo, 'scripts'));
    writeFileSync(path.join(repo, 'scripts', 'task.ps1'), 'param([string]$TaskId, [string]$Phase, [string]$Base, [switch]$Local)\nif ($Phase -eq "red") { [Console]::Out.Write("x" * 1100000); exit 0 }\nWrite-Output "task out $TaskId $Phase"\nWrite-Output "task in $([Console]::In.ReadToEnd())"\n[Console]::Error.WriteLine("task err $Base")\nexit 3\n');
    writeFileSync(path.join(repo, 'aidlc.config.json'), JSON.stringify({ shipPath: 'scaffold', base: 'main' }));
    const argv = ['card', 'start', 'T1-FOO'];
    const input = 'fed to the task';
    const expected = child(argv, { cwd: repo, env, input });
    assert.equal(expected.status, 3, expected.stderr);
    assert.match(expected.stdout, /task out T1-FOO start/);
    assert.match(expected.stdout, /task in fed to the task/);
    assert.match(expected.stderr, /task err main/);
    assert.deepEqual(await runCliInProcess(argv, { cwd: repo, env, input }), expected);
    // Inherited output has no size limit in the child: more than spawnSync's default 1 MiB buffer arrives whole.
    const large = await runCliInProcess(['card', 'red', 'T1-FOO'], { cwd: repo, env });
    assert.deepEqual({ status: large.status, length: large.stdout.length }, { status: 0, length: 1_100_000 });
    // The wrappers are gone after the calls.
    assert.equal(fs.writeSync, writeSyncBefore);
    assert.equal(childProcess.spawnSync, spawnSyncBefore);

    // writeSync(2) (the sweep note of card close): captured, equal to the child's stderr.
    const viaChild = closeFixture(false);
    const viaCall = closeFixture(false);
    try {
      const close = (goalId: string) => ['card', 'close', CLOSING, '--goal', goalId, '--cleanup', '--json'];
      const c = child(close(viaChild.goalId), { cwd: viaChild.fx.tmp, env: viaChild.env });
      assert.match(c.stderr, new RegExp(`worktree removed: ${FINISHED}`));
      const a = await runCliInProcess(close(viaCall.goalId), { cwd: viaCall.fx.tmp, env: viaCall.env });
      assert.deepEqual({ status: a.status, stdout: stable(viaCall.fx, a.stdout), stderr: stable(viaCall.fx, a.stderr) }, { status: c.status, stdout: stable(viaChild.fx, c.stdout), stderr: stable(viaChild.fx, c.stderr) });
    } finally {
      viaChild.fx.cleanup();
      viaCall.fx.cleanup();
      setActorForTests(undefined);
    }
  });
});

describe('runCliInProcess, R3 decision 1 repairs', () => {
  it('T1-TEST-CLI-INPROC-2 acceptance 2: a caller keeps its cached actor whatever its session, the former probe value included', async () => {
    const { repo, env } = fixture();
    try {
      for (const session of ['runCliInProcess-no-cached-actor', 'caller-any']) {
        const mine = { ...actorA, session };
        setActorForTests(mine);
        const r = await runCliInProcess(['--help'], { cwd: repo, env });
        assert.equal(r.status, 0, r.stderr);
        assert.deepEqual(currentActor(), mine, session);
      }
    } finally {
      setActorForTests(undefined);
    }
  });

  it('T1-TEST-CLI-INPROC-2 acceptance 2: resetRepoIdentityForTests drops a pending prefetch, so a later lookup does not take its answer', async () => {
    // The prefetch runs git with the environment it starts under: here GIT_DIR names another repository.
    const work = tmpDir('aidlc-inproc-prefetch-');
    const other = tmpDir('aidlc-inproc-prefetch-repo-');
    gitIn(other, ['init', '-q']);
    const saved = { dir: process.env['GIT_DIR'], tree: process.env['GIT_WORK_TREE'] };
    resetRepoIdentityForTests();
    try {
      process.env['GIT_DIR'] = path.join(other, '.git');
      process.env['GIT_WORK_TREE'] = other;
      prefetchRepoIdentity(work);
    } finally {
      for (const [key, value] of [['GIT_DIR', saved.dir], ['GIT_WORK_TREE', saved.tree]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    try {
      resetRepoIdentityForTests();
      await settleRepoIdentity(work);
      assert.notEqual(resolveRepoIdentity(work).mainRoot, realpathSync.native(other));
    } finally {
      resetRepoIdentityForTests();
    }
  });

  it('T1-TEST-CLI-INPROC-2 acceptance 2: env keys that differ only in case resolve as in a bin/aidlc.js child on win32', { skip: process.platform !== 'win32' && 'win32 only: elsewhere env keys are case-sensitive' }, async () => {
    const { repo, env } = fixture();
    // Both orders: Node keeps the first key in sorted order, not the first or the last given.
    for (const [n, order] of [['AIDLC_SESSION', 'aidlc_session'], ['aidlc_session', 'AIDLC_SESSION']].entries()) {
      const colliding: NodeJS.ProcessEnv = { ...env };
      delete colliding['AIDLC_SESSION'];
      for (const key of order) colliding[key] = key === 'AIDLC_SESSION' ? 'upper-session' : 'lower-session';
      const expected = child(['intent', 'new', '--title', `case child ${n}`], { cwd: repo, env: colliding });
      assert.equal(authorOf(expected.stdout), 'upper-session', expected.stderr);
      const actual = await runCliInProcess(['intent', 'new', '--title', `case inproc ${n}`], { cwd: repo, env: colliding });
      assert.equal(actual.status, 0, actual.stderr);
      assert.equal(authorOf(actual.stdout), authorOf(expected.stdout), order.join(' then '));
    }
  });

  it('T1-TEST-CLI-INPROC-2 acceptance 2: an env key inherited from the prototype of the env object reaches the call as it reaches a bin/aidlc.js child', async () => {
    const { repo, env } = fixture();
    const own: NodeJS.ProcessEnv = { ...env };
    delete own['AIDLC_SESSION'];
    const inherited = Object.assign(Object.create({ AIDLC_SESSION: 'inherited-session' }) as NodeJS.ProcessEnv, own);
    const expected = child(['intent', 'new', '--title', 'inherited child'], { cwd: repo, env: inherited });
    assert.equal(authorOf(expected.stdout), 'inherited-session', expected.stderr);
    const actual = await runCliInProcess(['intent', 'new', '--title', 'inherited inproc'], { cwd: repo, env: inherited });
    assert.equal(authorOf(actual.stdout), 'inherited-session', actual.stderr);
  });
});
