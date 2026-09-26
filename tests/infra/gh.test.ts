import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GhProbe, GhProbeError } from '../../src/probes/gh.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

const REPO = 'Asun28/repo';

function prList(entries: unknown[]): Record<string, { stdout: string }> {
  return { 'gh pr list --repo': { stdout: JSON.stringify(entries) } };
}

describe('probes/gh (PR identity, CI runs, pagination)', () => {
  it('prsForBranch parses the list output', () => {
    const probe = new GhProbe(scriptedRunner(prList([{ number: 7, state: 'OPEN', headRefOid: 'h1', baseRefName: 'main', mergedAt: null, url: 'u' }])));
    const prs = probe.prsForBranch(REPO, 'T1-FOO', 'main');
    assert.equal(prs.length, 1);
    assert.equal(prs[0]!.number, 7);
    assert.equal(prs[0]!.state, 'OPEN');
  });

  it('resolvePr: a single open PR is retained as identity', () => {
    const probe = new GhProbe(scriptedRunner(prList([{ number: 7, state: 'OPEN', headRefOid: 'h1', baseRefName: 'main', mergedAt: null, url: 'u' }])));
    const r = probe.resolvePr(REPO, 'T1-FOO', 'main');
    assert.equal(r.problem, undefined);
    assert.deepEqual(r.pr, { number: 7, url: 'u', state: 'OPEN', headRefOid: 'h1', baseRefName: 'main', mergedAt: undefined });
  });

  it('resolvePr: nothing found is an empty result, not an error', () => {
    const probe = new GhProbe(scriptedRunner(prList([])));
    assert.deepEqual(probe.resolvePr(REPO, 'T1-FOO', 'main'), {});
  });

  it('resolvePr: multiple open PRs are a problem, never a silent pick', () => {
    const probe = new GhProbe(
      scriptedRunner(
        prList([
          { number: 7, state: 'OPEN', headRefOid: 'h1', baseRefName: 'main' },
          { number: 9, state: 'OPEN', headRefOid: 'h2', baseRefName: 'main' },
        ]),
      ),
    );
    const r = probe.resolvePr(REPO, 'T1-FOO', 'main');
    assert.equal(r.pr, undefined);
    assert.match(r.problem ?? '', /multiple open PRs for T1-FOO: 7,9/);
  });

  it('resolvePr: a single merged PR is reused; multiple merged is a problem', () => {
    const merged = new GhProbe(scriptedRunner(prList([{ number: 5, state: 'MERGED', headRefOid: 'h', baseRefName: 'main', mergedAt: '2026-09-11T00:00:00Z' }])));
    const r = merged.resolvePr(REPO, 'T1-FOO', 'main');
    assert.equal(r.pr?.state, 'MERGED');
    assert.equal(r.pr?.mergedAt, '2026-09-11T00:00:00Z');
    const twice = new GhProbe(
      scriptedRunner(
        prList([
          { number: 5, state: 'MERGED', headRefOid: 'h', baseRefName: 'main' },
          { number: 6, state: 'MERGED', headRefOid: 'h2', baseRefName: 'main' },
        ]),
      ),
    );
    assert.match(twice.resolvePr(REPO, 'T1-FOO', 'main').problem ?? '', /multiple merged PRs/);
  });

  it('resolvePr: closed-unmerged is retained with a problem and is not a new start', () => {
    const probe = new GhProbe(scriptedRunner(prList([{ number: 3, state: 'CLOSED', headRefOid: 'h', baseRefName: 'main' }])));
    const r = probe.resolvePr(REPO, 'T1-FOO', 'main');
    assert.equal(r.pr?.number, 3);
    assert.match(r.problem ?? '', /closed without merge; not a new start/);
  });

  it('resolvePr: a retained PR number is looked up exactly and a retarget is reported', () => {
    const probe = new GhProbe(
      scriptedRunner({
        ...prList([{ number: 12, state: 'OPEN', headRefOid: 'h', baseRefName: 'main' }]),
        'gh pr view 12 --repo': { stdout: JSON.stringify({ number: 12, state: 'OPEN', mergedAt: null, headRefOid: 'h9', baseRefName: 'develop', mergeCommit: null, url: 'u12' }) },
      }),
    );
    const r = probe.resolvePr(REPO, 'T1-FOO', 'main', 12);
    assert.equal(r.pr?.number, 12);
    assert.equal(r.pr?.headRefOid, 'h9');
    assert.match(r.problem ?? '', /retained PR #12 retargeted to develop/);
    const same = new GhProbe(
      scriptedRunner({
        ...prList([]),
        'gh pr view 12 --repo': { stdout: JSON.stringify({ number: 12, state: 'MERGED', mergedAt: '2026-09-11T01:00:00Z', headRefOid: 'h9', baseRefName: 'main', mergeCommit: { oid: 'm1' } }) },
      }),
    );
    const ok = same.resolvePr(REPO, 'T1-FOO', 'main', 12);
    assert.equal(ok.problem, undefined);
    assert.equal(ok.pr?.mergeCommit, 'm1');
  });

  it('runView returns the run identity fields; failures throw GhProbeError with the receipt', () => {
    const probe = new GhProbe(
      scriptedRunner({
        'gh run view 99 --repo': { stdout: JSON.stringify({ databaseId: 99, attempt: 2, status: 'completed', conclusion: 'failure', headSha: 'abc', url: 'u', jobs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] }) },
        'gh run view 100 --repo': { exitCode: 1, stderr: 'not found' },
        'gh run view 101 --repo': { stdout: 'not json' },
      }),
    );
    const v = probe.runView(REPO, '99');
    assert.equal(v.attempt, 2);
    assert.equal(v.jobs[0]!.conclusion, 'failure');
    assert.throws(() => probe.runView(REPO, '100'), (e: unknown) => e instanceof GhProbeError && /not found/.test(e.message) && e.receipt.exitCode === 1);
    assert.throws(() => probe.runView(REPO, '101'), (e: unknown) => e instanceof GhProbeError && /malformed JSON/.test(e.message));
  });

  it('checkRuns paginates until a page is smaller than 100 and stops requesting further pages', () => {
    const requested: string[] = [];
    const probe = new GhProbe(
      scriptedRunner({
        'gh api repos/': (args) => {
          const url = args[1]!;
          requested.push(url);
          const page = Number(url.match(/&page=(\d+)/)![1]);
          const count = page === 1 ? 100 : 3;
          return { stdout: JSON.stringify({ check_runs: Array.from({ length: count }, (_, i) => ({ name: `p${page}-${i}`, status: 'completed', conclusion: 'success' })) }) };
        },
      }),
    );
    const runs = probe.checkRuns(REPO, 'deadbeef');
    assert.equal(runs.length, 103);
    assert.deepEqual(requested, ['repos/Asun28/repo/commits/deadbeef/check-runs?per_page=100&page=1', 'repos/Asun28/repo/commits/deadbeef/check-runs?per_page=100&page=2']);
  });

  it('rerunFailed and login route through the runner without inheriting tokens', () => {
    const seen: Array<{ args: string[]; env?: NodeJS.ProcessEnv }> = [];
    const probe = new GhProbe((cmd, args, options) => {
      seen.push({ args, env: options?.env });
      const now = new Date().toISOString();
      const stdout = args[0] === 'api' ? 'octocat\n' : '';
      return { command: cmd, args, cwd: '', exitCode: 0, signal: null, timedOut: false, stdout, stderr: '', startedAt: now, finishedAt: now, durationMs: 0, outputSha256: '' };
    });
    assert.equal(probe.rerunFailed(REPO, '42').exitCode, 0);
    assert.deepEqual(seen[0]!.args, ['run', 'rerun', '42', '--repo', REPO, '--failed']);
    assert.equal(probe.login(), 'octocat');
    assert.equal(seen[1]!.env?.['GH_TOKEN'], '');
    assert.equal(seen[1]!.env?.['GITHUB_TOKEN'], '');
  });

  it('T0-CI-RED-LOGS acceptance 2: jobLog reads one Actions job log through the jobs API and returns nothing when the command fails', () => {
    const asked: string[][] = [];
    const probe = new GhProbe(
      scriptedRunner({
        'gh api repos/Asun28/repo/actions/jobs/77/logs': (args) => {
          asked.push(args);
          return { stdout: '2026-09-26T04:12:10.9854830Z line\n' };
        },
        'gh api repos/Asun28/repo/actions/jobs/78/logs': { exitCode: 1, stdout: 'partial', stderr: 'HTTP 410: Gone' },
        'gh api repos/Asun28/repo/actions/jobs/80/logs': { exitCode: 0, timedOut: true, stdout: 'cut short' },
      }),
    );
    assert.equal(probe.jobLog(REPO, '77'), '2026-09-26T04:12:10.9854830Z line\n');
    assert.deepEqual(asked, [['api', 'repos/Asun28/repo/actions/jobs/77/logs']]);
    assert.equal(probe.jobLog(REPO, '78'), undefined, 'a refused log is no log, whatever its stdout');
    assert.equal(probe.jobLog(REPO, '79'), undefined, 'a command that cannot run is no log');
    assert.equal(probe.jobLog(REPO, '80'), undefined, 'a read that timed out is no log');
  });

  it('T0-CI-RED-LOGS-2 acceptance 2: jobRecord reads the steps of one Actions job and returns nothing when the command fails, times out or prints no JSON', () => {
    const steps = [{ number: 1, name: 'Set up job', conclusion: 'success', started_at: '2026-09-26T04:12:10Z', completed_at: '2026-09-26T04:12:11Z' }];
    const asked: string[][] = [];
    const probe = new GhProbe(
      scriptedRunner({
        'gh api repos/Asun28/repo/actions/jobs/77': (args) => {
          asked.push(args);
          return { stdout: JSON.stringify({ id: 77, steps }) };
        },
        'gh api repos/Asun28/repo/actions/jobs/78': { exitCode: 1, stdout: JSON.stringify({ steps }), stderr: 'HTTP 404' },
        'gh api repos/Asun28/repo/actions/jobs/80': { exitCode: 0, timedOut: true, stdout: JSON.stringify({ steps }) },
        'gh api repos/Asun28/repo/actions/jobs/81': { stdout: 'not json' },
        'gh api repos/Asun28/repo/actions/jobs/82': { stdout: JSON.stringify({ id: 82 }) },
      }),
    );
    assert.deepEqual(probe.jobRecord(REPO, '77'), { steps });
    assert.deepEqual(asked, [['api', 'repos/Asun28/repo/actions/jobs/77']]);
    assert.equal(probe.jobRecord(REPO, '78'), undefined, 'a refused record is no record');
    assert.equal(probe.jobRecord(REPO, '80'), undefined, 'a read that timed out is no record');
    assert.equal(probe.jobRecord(REPO, '81'), undefined, 'output that is not JSON is no record');
    assert.deepEqual(probe.jobRecord(REPO, '82'), { steps: [] }, 'a record without steps has no steps');
    assert.equal(probe.jobRecord(REPO, '83'), undefined, 'a command that cannot run is no record');
  });
});
