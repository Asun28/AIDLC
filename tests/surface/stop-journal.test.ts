// Card T0-STOP-JOURNAL, issue 499: each Stop journals the listed card runs of its session, with the freshness of their receipts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runHook, type HookEvent, type HookResult } from '../../src/hooks/index.ts';
import { CardRun, Goal, type ActorIdentity } from '../../src/core/types.ts';
import { classifyRequest } from '../../src/core/router.ts';
import { stagesForTarget } from '../../src/core/goal-machine.ts';
import { computeGoalDeadlines } from '../../src/core/deadlines.ts';
import { amendedDigest } from '../../src/core/contract.ts';
import { hostName, resolveRepoIdentity, resolveStatePaths } from '../../src/state/paths.ts';
import { GoalStore } from '../../src/state/goal-store.ts';
import { Journal } from '../../src/state/journal.ts';
import { LeaseStore, resourceKeys } from '../../src/coordination/lease.ts';
import { GitProbe } from '../../src/probes/git.ts';
import { tmpDir } from '../infra/helpers.ts';

const NOW = '2026-11-26T10:00:00.000Z';
const LATER = '2026-11-26T13:00:00.000Z';

function goal(id: string): Goal {
  return Goal.parse({
    schemaVersion: 1,
    id,
    generation: 0,
    revision: 0,
    revisions: [{ revision: 0, at: NOW, reason: 'created', request: { text: 'fix the login bug', source: 'natural-language' } }],
    repository: 'repo',
    routing: classifyRequest({ text: 'fix the login bug' }),
    target: 'development',
    stages: stagesForTarget('development'),
    state: 'RUN',
    deadlines: computeGoalDeadlines(NOW, { cardCount: 1 }),
    authorizations: [],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function run(goalId: string, cardId: string, extra: Record<string, unknown> = {}): CardRun {
  return CardRun.parse({ goalId, cardId, cardRevision: 0, goalGeneration: 0, state: 'BUILD', startedAt: NOW, deadline: LATER, updatedAt: NOW, ...extra });
}

function setup(): { cwd: string; env: NodeJS.ProcessEnv; store: GoalStore; journalDir: string } {
  const cwd = tmpDir('aidlc-stop-journal-');
  const env: NodeJS.ProcessEnv = { PATH: process.env['PATH'], AIDLC_STATE_DIR: path.join(cwd, 'state') };
  const paths = resolveStatePaths(cwd, env);
  const store = new GoalStore(paths);
  store.saveGoal(goal('g1'));
  return { cwd, env, store, journalDir: paths.journal };
}

const stop = (extra: Partial<HookEvent> = {}): HookEvent => ({ hook_event_name: 'Stop', session_id: 'win-A', ...extra });
const events = (journalDir: string, goalId: string) => Journal.forGoal(journalDir, goalId).readAll().filter((e) => e.type === ('SESSION_STOPPED' as never));
const context = (r: HookResult): string => (r.stdout ? (JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext : '');

/** A git repository with one commit, as a card worktree. */
function repo(): string {
  const dir = tmpDir('aidlc-stop-wt-');
  const git = (...args: string[]) => assert.equal(spawnSync('git', args, { cwd: dir, encoding: 'utf8' }).status, 0, `git ${args.join(' ')}`);
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(path.join(dir, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  git('commit', '-q', '-m', 'one');
  return dir;
}

test('T0-STOP-JOURNAL acceptance 1: a Stop journals the listed runs of each goal, one event per goal [R1] [R2] [R4]', () => {
  const { cwd, env, store, journalDir } = setup();
  store.saveCardRun(run('g1', 'T1-FOO'));
  store.saveGoal(goal('g2'));
  store.saveCardRun(run('g2', 'T1-BAR'));
  const paths = resolveStatePaths(cwd, env);
  mkdirSync(paths.leases, { recursive: true });
  const other: ActorIdentity = { session: 'win-B', pid: 4242, processStart: NOW, host: hostName() };
  new LeaseStore(paths.leases).claim(resourceKeys.card(resolveRepoIdentity(cwd).key, 'T1-BAR'), { actor: other });
  const r = runHook('verify-before-done', stop(), { cwd, env });
  assert.equal(r.exitCode, 0);
  assert.ok(context(r).includes('T1-FOO (BUILD)'), context(r));
  assert.ok(!context(r).includes('T1-BAR'));
  const [event, ...more] = events(journalDir, 'g1');
  assert.deepEqual(more, []);
  assert.equal(event?.goalId, 'g1');
  assert.equal(event?.actor.session, 'win-A', 'the event is the acting session\'s, as its data says');
  assert.deepEqual(event?.data, { session: 'win-A', waiting: false, reminded: true, runs: [{ cardId: 'T1-FOO', state: 'BUILD', receipt: 'none' }] });
  assert.deepEqual(events(journalDir, 'g2'), [], 'a run of another session is not listed, and its goal gets no event');
});

test('T0-STOP-JOURNAL acceptance 2: a receipt of an earlier candidate is named in the reminder [R3] [R4]', () => {
  const { cwd, env, store } = setup();
  const worktree = repo();
  const probe = new GitProbe().candidate(worktree);
  store.saveCardRun(run('g1', 'T1-FOO', { dodReceipt: 'npm test: exit 0', worktree, candidate: { sha: probe.sha, dirty: probe.dirty, untracked: probe.untracked, digest: probe.digest } }));
  writeFileSync(path.join(worktree, 'b.txt'), 'b\n');
  const r = runHook('verify-before-done', stop(), { cwd, env });
  assert.equal(r.exitCode, 0);
  assert.ok(context(r).includes('T1-FOO (BUILD, DoD receipt of an earlier candidate)'), context(r));
});

test('T0-STOP-JOURNAL acceptance 2: a receipt reads fresh, stale or unknown against the worktree candidate [R3] [R4]', () => {
  const { cwd, env, store, journalDir } = setup();
  const worktree = repo();
  const probe = new GitProbe().candidate(worktree);
  const candidate = { sha: probe.sha, dirty: probe.dirty, untracked: probe.untracked, digest: probe.digest };
  const receiptOf = () => (events(journalDir, 'g1').at(-1)?.data['runs'] as Array<{ receipt: string }>)[0]?.receipt;
  // A save carries the persisted revision (the store compares and sets it).
  const revision = () => store.listCardRuns('g1').find((r) => r.cardId === 'T1-FOO')?.revision ?? 0;
  const withReceipt = (extra: Record<string, unknown>) => store.saveCardRun(run('g1', 'T1-FOO', { dodReceipt: 'npm test: exit 0', worktree, candidate, revision: revision(), ...extra }));

  withReceipt({});
  assert.equal(context(runHook('verify-before-done', stop(), { cwd, env })), '');
  assert.equal(receiptOf(), 'fresh');

  writeFileSync(path.join(worktree, 'b.txt'), 'b\n');
  assert.ok(context(runHook('verify-before-done', stop(), { cwd, env })).includes('T1-FOO (BUILD, DoD receipt of an earlier candidate)'));
  assert.equal(receiptOf(), 'stale');
  rmSync(path.join(worktree, 'b.txt'));

  const amendment = { at: NOW, by: 'owner', reason: 'r', revision: 1, changed: ['acceptance'], invalidated: ['review'] };
  withReceipt({ candidate: { ...candidate, digest: amendedDigest(probe.digest, 1) }, amendments: [amendment] });
  assert.equal(context(runHook('verify-before-done', stop(), { cwd, env })), '');
  assert.equal(receiptOf(), 'fresh');

  withReceipt({ candidate: undefined });
  assert.equal(context(runHook('verify-before-done', stop(), { cwd, env })), '');
  assert.equal(receiptOf(), 'unknown');

  rmSync(worktree, { recursive: true, force: true });
  withReceipt({});
  assert.equal(context(runHook('verify-before-done', stop(), { cwd, env })), '');
  assert.equal(receiptOf(), 'unknown');
});

test('T0-STOP-JOURNAL acceptance 3: a repeated Stop, waiting work, no listed run and a failed append [R2] [R4] [R5]', () => {
  const { cwd, env, store, journalDir } = setup();
  store.saveCardRun(run('g1', 'T1-FOO'));
  assert.deepEqual(runHook('verify-before-done', stop({ stop_hook_active: true }), { cwd, env }), { exitCode: 0 });
  assert.deepEqual(events(journalDir, 'g1'), [], 'a Stop already continuing for a stop hook appends nothing');

  const waiting = runHook('verify-before-done', stop({ background_tasks: [{ id: 'task-1', type: 'subagent', status: 'running' }] }), { cwd, env });
  assert.equal(context(waiting), '');
  assert.deepEqual(events(journalDir, 'g1').at(-1)?.data, { session: 'win-A', waiting: true, reminded: false, runs: [{ cardId: 'T1-FOO', state: 'BUILD', receipt: 'none' }] });

  const done = setup();
  done.store.saveCardRun(run('g1', 'T1-FOO', { state: 'DONE' }));
  assert.deepEqual(runHook('verify-before-done', stop(), { cwd: done.cwd, env: done.env }), { exitCode: 0 });
  assert.deepEqual(events(done.journalDir, 'g1'), [], 'no listed run, no event');

  const broken = setup();
  broken.store.saveCardRun(run('g1', 'T1-FOO'));
  const expected = runHook('verify-before-done', stop(), { cwd, env });
  mkdirSync(path.join(broken.journalDir, 'g1.jsonl'), { recursive: true });
  assert.deepEqual(runHook('verify-before-done', stop(), { cwd: broken.cwd, env: broken.env }), expected, 'a failed append leaves the result as it is');
});
