import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Journal } from '../../src/state/journal.ts';
import { tmpDir } from '../infra/helpers.ts';
import { runCliInProcess } from '../infra/cli-inprocess.ts';

// Card T0-APPROVER-IDENTITY: an approval recorded without --by names the git identity of the repository.
const root = path.resolve(import.meta.dirname, '..', '..');
const bin = path.join(root, 'bin', 'aidlc.js');

interface Authorization {
  kind: string;
  grantedBy: string;
}

interface Fixture {
  tmp: string;
  repo: string;
  cli: (args: string[], cwd?: string) => ReturnType<typeof spawnSync>;
  run: (args: string[], cwd?: string) => Promise<{ status: number; stdout: string; stderr: string }>;
  git: (args: string[]) => void;
  lastAuthorizations: (goalId: string, n: number) => Promise<Authorization[]>;
  journal: (goalId: string) => Journal;
  cleanup: () => void;
}

/**
 * A temporary repository whose git identity comes from its local config only: the child environment is built
 * from scratch per call, with every GIT_ and AIDLC_ variable of this process dropped in any letter case, the
 * global config pointed at an empty file and the system config switched off.
 */
function fixture(): Fixture {
  const tmp = tmpDir('aidlc-approver-');
  const repo = path.join(tmp, 'repo');
  const stateDir = path.join(tmp, 'state');
  const emptyGlobal = path.join(tmp, 'empty.gitconfig');
  writeFileSync(emptyGlobal, '', 'utf8');
  const env = (): NodeJS.ProcessEnv => {
    const e: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      const upper = k.toUpperCase();
      if (upper.startsWith('GIT_') || upper.startsWith('AIDLC_')) continue;
      e[k] = v;
    }
    return { ...e, GIT_CONFIG_GLOBAL: emptyGlobal, GIT_CONFIG_NOSYSTEM: '1', AIDLC_STATE_DIR: stateDir, AIDLC_SESSION: 'approver-test' };
  };
  const git = (args: string[], cwd = repo): void => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env(), windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  };
  const cli = (args: string[], cwd = repo) => spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: env(), windowsHide: true });
  const run = (args: string[], cwd = repo) => runCliInProcess(args, { cwd, env: env() });
  let statusCalls = 0;
  const lastAuthorizations = async (goalId: string, n: number): Promise<Authorization[]> => {
    // In-process (T1-TEST-INPROC-REST): the owner's follow-up of the T1-TEST-INPROC-A-2/B-2 exception. Child process (R2): the
    // first call of each fixture runs through bin/aidlc.js, the child-process case of goal status.
    const r = statusCalls++ === 0 ? cli(['goal', 'status', goalId]) : await run(['goal', 'status', goalId]);
    assert.equal(r.status, 0, String(r.stderr));
    return (JSON.parse(String(r.stdout)) as { authorizations: Authorization[] }).authorizations.slice(-n);
  };
  git(['init', '-q', '-b', 'main', repo], tmp);
  return { tmp, repo, cli, run, git, lastAuthorizations, journal: (goalId) => Journal.forGoal(path.join(stateDir, 'journal'), goalId), cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** Runs plan approve, authorize and report --result approved in that order, each with the extra args. */
async function approveThreeWays(f: Fixture, goalId: string, extra: string[]): Promise<void> {
  for (const args of [
    ['plan', 'approve', goalId, ...extra],
    ['authorize', 'development', '--goal', goalId, ...extra],
    ['report', '--goal', goalId, '--result', 'approved', ...extra],
  ]) {
    const r = await f.run(args);
    assert.equal(r.status, 0, `aidlc ${args.join(' ')}: ${String(r.stderr)}`);
  }
}

describe('approver identity (T0-APPROVER-IDENTITY)', () => {
  it('an approval without --by records the git identity: user.email, else user.name, else user; an explicit --by is recorded as given (acceptance 2, 3)', async () => {
    const f = fixture();
    try {
      f.git(['config', 'user.email', 'approver@example.com']);
      f.git(['config', 'user.name', 'Approver Name']);
      // Child process (R2): the bin/aidlc.js case of goal new in this file (T1-TEST-INPROC-REST R3 decision 1).
      const created = f.cli(['goal', 'new', 'approve a change', '--size', 'T0']);
      assert.equal(created.status, 0, String(created.stderr));
      const goalId = (JSON.parse(String(created.stdout)) as { goal: string }).goal;

      // A report of any other result carries no approver: its data is journaled as given.
      const accepted = await f.run(['report', '--goal', goalId, '--result', 'intent-accepted']);
      assert.equal(accepted.status, 0, String(accepted.stderr));
      const planAccepted = f.journal(goalId).readAll().filter((e) => e.type === 'PLAN_ACCEPTED');
      assert.deepEqual(planAccepted.map((e) => e.data), [{}], 'intent-accepted records no by');

      await approveThreeWays(f, goalId, []);
      assert.deepEqual((await f.lastAuthorizations(goalId, 3)).map((a) => ({ kind: a.kind, grantedBy: a.grantedBy })), [
        { kind: 'plan-checkpoint', grantedBy: 'approver@example.com' },
        { kind: 'development', grantedBy: 'approver@example.com' },
        { kind: 'development', grantedBy: 'approver@example.com' },
      ]);

      // Run from outside the repository with -C: the identity is the one of the repository named, not of the cwd.
      const outside = await f.run(['-C', f.repo, 'authorize', 'development', '--goal', goalId], f.tmp);
      assert.equal(outside.status, 0, String(outside.stderr));
      assert.deepEqual((await f.lastAuthorizations(goalId, 1)).map((a) => a.grantedBy), ['approver@example.com'], '-C names the repository');

      await approveThreeWays(f, goalId, ['--by', 'release manager']);
      assert.deepEqual((await f.lastAuthorizations(goalId, 3)).map((a) => a.grantedBy), ['release manager', 'release manager', 'release manager']);
      const viaData = await f.run(['report', '--goal', goalId, '--result', 'approved', '--data', '{"by":"data approver"}']);
      assert.equal(viaData.status, 0, String(viaData.stderr));
      assert.deepEqual((await f.lastAuthorizations(goalId, 1)).map((a) => a.grantedBy), ['data approver'], 'a by in --data is recorded as given');
      const nullData = await f.run(['report', '--goal', goalId, '--result', 'approved', '--data', '{"by":null}']);
      assert.equal(nullData.status, 0, String(nullData.stderr));
      assert.deepEqual((await f.lastAuthorizations(goalId, 1)).map((a) => a.grantedBy), ['user'], 'a by key in --data is given, so the git identity is not read');

      // An empty --by is given too: each command passes it on and the empty approver is refused, never replaced.
      const before = (await f.lastAuthorizations(goalId, 100)).length;
      // Child process (R2): the child-process cases of plan approve, authorize and report; the owner's exception of T1-TEST-INPROC-A-2/B-2
      // is followed up in-process in lastAuthorizations (T1-TEST-INPROC-REST), and these three rows are each command's only child case.
      for (const args of [
        ['plan', 'approve', goalId, '--by', ''],
        ['authorize', 'development', '--goal', goalId, '--by', ''],
        ['report', '--goal', goalId, '--result', 'approved', '--by', ''],
      ]) assert.notEqual(f.cli(args).status, 0, `aidlc ${args.join(' ')} refuses the empty approver`);
      assert.equal((await f.lastAuthorizations(goalId, 100)).length, before, 'no authorization recorded for an empty --by');

      f.git(['config', '--unset', 'user.email']);
      await approveThreeWays(f, goalId, []);
      assert.deepEqual((await f.lastAuthorizations(goalId, 3)).map((a) => a.grantedBy), ['Approver Name', 'Approver Name', 'Approver Name']);

      f.git(['config', '--unset', 'user.name']);
      await approveThreeWays(f, goalId, []);
      assert.deepEqual((await f.lastAuthorizations(goalId, 3)).map((a) => a.grantedBy), ['user', 'user', 'user']);
    } finally {
      f.cleanup();
    }
  });

  it('docs/OPERATIONS.md states the default approver (acceptance 4)', () => {
    const operations = readFileSync(path.join(root, 'docs', 'OPERATIONS.md'), 'utf8').replace(/\r\n/g, '\n');
    assert.ok(
      operations.includes(
        'Without `--by`, `aidlc authorize`, `aidlc plan approve` and `aidlc report --result approved` record the git identity of the repository as the approver (`git config user.email`, else `user.name`), and `user` when neither is set; no other command reads the git identity.',
      ),
    );
  });
});
