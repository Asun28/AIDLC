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
    const { started_at: _s, ...noStart } = steps[0]!;
    const { completed_at: _c, ...noEnd } = steps[0]!;
    const malformed = [[null], [{ ...steps[0], number: '1' }], [{ ...steps[0], conclusion: 1 }], [{ ...steps[0], started_at: 5 }], [{ ...steps[0], completed_at: 5 }], [{ ...steps[0], name: 7 }], [noStart], [noEnd], 'steps'];
    for (const bad of malformed) {
      const one = new GhProbe(scriptedRunner({ 'gh api repos/Asun28/repo/actions/jobs/90': { stdout: JSON.stringify({ steps: bad }) } }));
      assert.equal(one.jobRecord(REPO, '90'), undefined, `a malformed record is no record: ${JSON.stringify(bad)}`);
    }
    const nulls = new GhProbe(scriptedRunner({ 'gh api repos/Asun28/repo/actions/jobs/91': { stdout: JSON.stringify({ steps: [{ number: 2, conclusion: null, started_at: null, completed_at: null }] }) } }));
    assert.deepEqual(nulls.jobRecord(REPO, '91'), { steps: [{ number: 2, conclusion: null, started_at: null, completed_at: null }] }, 'null times and conclusion, no name: a record');
    assert.equal(probe.jobRecord(REPO, '83'), undefined, 'a command that cannot run is no record');
  });
});

describe('probes/gh (review follow-up issues)', () => {
  type Call = { args: string[]; input?: string };
  function recording(script: Parameters<typeof scriptedRunner>[0]): { probe: GhProbe; calls: Call[] } {
    const inner = scriptedRunner(script);
    const calls: Call[] = [];
    const probe = new GhProbe((command, args, options = {}) => {
      calls.push({ args, input: options.input });
      return inner(command, args, options);
    });
    return { probe, calls };
  }
  const LABEL_ARGS = ['label', 'create', 'review-followup', '--repo', REPO, '--force', '--description', 'aidlc review follow-ups'];
  const ISSUE_ARGS = ['issue', 'create', '--repo', REPO, '--title', 'Review follow-ups', '--label', 'review-followup', '--body-file', '-'];

  it('T1-GH-ISSUES acceptance 1: issuesWithLabel passes the argv of R1 and parses number and body', () => {
    const { probe, calls } = recording({ 'gh api repos/Asun28/repo/issues?': { stdout: JSON.stringify([{ number: 12, body: 'first' }, { number: 3, body: null }]) } });
    assert.deepEqual(probe.issuesWithLabel(REPO, 'review-followup'), [
      { number: 12, body: 'first' },
      { number: 3, body: '' },
    ]);
    assert.deepEqual(calls, [{ args: ['api', 'repos/Asun28/repo/issues?labels=review-followup&state=all&per_page=100&page=1'], input: undefined }]);
  });

  it('T1-GH-ISSUES acceptance 2: createIssue creates the label, then the issue with the body on stdin, and returns the number from the URL', () => {
    const { probe, calls } = recording({
      'gh label create': { stdout: '' },
      'gh issue create': { stdout: `Creating issue in ${REPO}\n\nhttps://github.com/${REPO}/issues/41\n` },
    });
    assert.equal(probe.createIssue(REPO, 'Review follow-ups', 'line one\n--title not a flag', 'review-followup'), 41);
    assert.deepEqual(calls, [
      { args: LABEL_ARGS, input: undefined },
      { args: ISSUE_ARGS, input: 'line one\n--title not a flag' },
    ]);
  });

  it('T1-GH-ISSUES acceptance 3: a failed label call, a failed issue call, unparsable list output and a missing or foreign URL each throw GhProbeError and stop further calls', () => {
    const labelFails = recording({ 'gh label create': { exitCode: 1, stderr: 'HTTP 403' }, 'gh issue create': { stdout: `https://github.com/${REPO}/issues/41\n` } });
    assert.throws(() => labelFails.probe.createIssue(REPO, 'Review follow-ups', 'b', 'review-followup'), (e: unknown) => e instanceof GhProbeError && /label create/.test(e.message));
    assert.deepEqual(labelFails.calls.map((c) => c.args), [LABEL_ARGS], 'no issue call after a failed label call');

    const issueFails = recording({ 'gh label create': { stdout: '' }, 'gh issue create': { exitCode: 1, stderr: 'HTTP 422' } });
    assert.throws(() => issueFails.probe.createIssue(REPO, 'Review follow-ups', 'b', 'review-followup'), (e: unknown) => e instanceof GhProbeError && /issue create/.test(e.message));

    for (const stdout of ['', 'created\n', `https://github.com/other/repo/issues/41\n`, `https://github.com/${REPO}/issues/41\nnot a url\n`, `https://github.com/${REPO}/pull/41\n`]) {
      const { probe } = recording({ 'gh label create': { stdout: '' }, 'gh issue create': { stdout } });
      assert.throws(() => probe.createIssue(REPO, 'Review follow-ups', 'b', 'review-followup'), (e: unknown) => e instanceof GhProbeError && /issue create/.test(e.message), `no issue URL of the repo: ${JSON.stringify(stdout)}`);
    }

    for (const stdout of ['not json', JSON.stringify({ number: 1, body: 'x' }), JSON.stringify([{ number: '1', body: 'x' }]), JSON.stringify([{ number: 1 }])]) {
      const { probe } = recording({ 'gh api repos/Asun28/repo/issues?': { stdout } });
      assert.throws(() => probe.issuesWithLabel(REPO, 'review-followup'), GhProbeError, `unparsable list output: ${stdout}`);
    }
    const listFails = recording({ 'gh api repos/Asun28/repo/issues?': { exitCode: 1, stderr: 'HTTP 404', stdout: '[]' } });
    assert.throws(() => listFails.probe.issuesWithLabel(REPO, 'review-followup'), GhProbeError, 'a failed list call is an error, not an empty list');
  });

  const PAGE = 'gh api repos/Asun28/repo/issues?labels=review-followup&state=all&per_page=100&page=';
  const PAGE_ARGS = (page: number) => ['api', `repos/Asun28/repo/issues?labels=review-followup&state=all&per_page=100&page=${page}`];
  const issues = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ number: from + i, body: `issue ${from + i}` }));

  it('T1-REVIEW-FOLLOWUP-CORE acceptance 2: issuesWithLabel reads pages until one has fewer than 100 entries, pull requests counted and left out', () => {
    const two = recording({ [`${PAGE}1`]: { stdout: JSON.stringify(issues(1, 100)) }, [`${PAGE}2`]: { stdout: JSON.stringify(issues(101, 1)) } });
    assert.deepEqual(two.probe.issuesWithLabel(REPO, 'review-followup'), issues(1, 101));
    assert.deepEqual(two.calls.map((c) => c.args), [PAGE_ARGS(1), PAGE_ARGS(2)]);

    const full = recording({ [`${PAGE}1`]: { stdout: JSON.stringify(issues(1, 100)) }, [`${PAGE}2`]: { stdout: '[]' } });
    assert.deepEqual(full.probe.issuesWithLabel(REPO, 'review-followup'), issues(1, 100));
    assert.deepEqual(full.calls.map((c) => c.args), [PAGE_ARGS(1), PAGE_ARGS(2)]);

    const short = recording({ [`${PAGE}1`]: { stdout: JSON.stringify(issues(1, 99)) } });
    assert.deepEqual(short.probe.issuesWithLabel(REPO, 'review-followup'), issues(1, 99));
    assert.deepEqual(short.calls.map((c) => c.args), [PAGE_ARGS(1)]);

    const pulls = issues(1, 40).map((i) => ({ ...i, pull_request: { url: 'u' } }));
    const mixed = recording({ [`${PAGE}1`]: { stdout: JSON.stringify([...pulls, ...issues(41, 60)]) }, [`${PAGE}2`]: { stdout: JSON.stringify([...issues(101, 1), ...pulls.slice(0, 1)]) } });
    assert.deepEqual(mixed.probe.issuesWithLabel(REPO, 'review-followup'), issues(41, 61));
    assert.deepEqual(mixed.calls.map((c) => c.args), [PAGE_ARGS(1), PAGE_ARGS(2)]);

    const encoded = recording({ 'gh api': { stdout: '[]' } });
    assert.deepEqual(encoded.probe.issuesWithLabel(REPO, 'a b&c'), []);
    assert.deepEqual(encoded.calls.map((c) => c.args), [['api', 'repos/Asun28/repo/issues?labels=a%20b%26c&state=all&per_page=100&page=1']]);
  });

  it('T1-REVIEW-FOLLOWUP-CORE acceptance 2: a second page that fails or is malformed throws GhProbeError naming the call, and no partial list is returned', () => {
    const bad: Array<{ exitCode?: number; timedOut?: boolean; stdout: string }> = [
      { exitCode: 1, stdout: '[]' },
      { exitCode: 0, timedOut: true, stdout: '[]' },
      { stdout: '' },
      { stdout: 'not json' },
      { stdout: JSON.stringify({ number: 101, body: 'x' }) },
      { stdout: JSON.stringify([{ number: 101 }]) },
      { stdout: JSON.stringify([{ number: 101, body: 7 }]) },
      ...[0, -1, 1.5].map((number) => ({ stdout: JSON.stringify([{ number, body: 'x' }]) })),
      { stdout: '[{"number":9007199254740992,"body":"x"}]' },
      { stdout: JSON.stringify([{ number: 0, body: 'x', pull_request: { url: 'u' } }]) },
    ];
    for (const second of bad) {
      const { probe, calls } = recording({ [`${PAGE}1`]: { stdout: JSON.stringify(issues(1, 100)) }, [`${PAGE}2`]: second });
      assert.throws(() => probe.issuesWithLabel(REPO, 'review-followup'), (e: unknown) => e instanceof GhProbeError && e.message.includes(`${PAGE}2`), JSON.stringify(second));
      assert.deepEqual(calls.map((c) => c.args), [PAGE_ARGS(1), PAGE_ARGS(2)]);
    }
  });

  it('T1-REVIEW-FOLLOWUP-CORE acceptance 2: 1,000 full pages in a row throw after call 1,000, naming the repository and the label', () => {
    const { probe, calls } = recording({ [PAGE]: { stdout: JSON.stringify(issues(1, 100)) } });
    assert.throws(() => probe.issuesWithLabel(REPO, 'review-followup'), (e: unknown) => e instanceof Error && e.message.includes(REPO) && e.message.includes('review-followup'));
    assert.equal(calls.length, 1000);
    assert.deepEqual(calls.at(-1)!.args, PAGE_ARGS(1000));
    const last = recording({ [PAGE]: (args) => ({ stdout: JSON.stringify(args[1]!.endsWith('&page=1000') ? [] : issues(1, 100)) }) });
    assert.equal(last.probe.issuesWithLabel(REPO, 'review-followup').length, 99_900, 'a short page 1,000 ends the list');
  });

  it('T1-REVIEW-FOLLOWUP-CORE acceptance 3: ensureLabel makes the label call only and submitIssue the issue call only, each with the errors of createIssue', () => {
    const label = recording({ 'gh label create': { stdout: '' } });
    label.probe.ensureLabel(REPO, 'review-followup');
    assert.deepEqual(label.calls, [{ args: LABEL_ARGS, input: undefined }]);

    const submit = recording({ 'gh issue create': { stdout: `Creating issue in ${REPO}\n\nhttps://github.com/${REPO}/issues/41\n` } });
    assert.equal(submit.probe.submitIssue(REPO, 'Review follow-ups', 'line one\n--title not a flag', 'review-followup'), 41);
    assert.deepEqual(submit.calls, [{ args: ISSUE_ARGS, input: 'line one\n--title not a flag' }]);

    for (const failed of [{ exitCode: 1, stderr: 'HTTP 403' }, { exitCode: 0, timedOut: true }]) {
      const { probe } = recording({ 'gh label create': failed });
      assert.throws(() => probe.ensureLabel(REPO, 'review-followup'), (e: unknown) => e instanceof GhProbeError && /label create/.test(e.message));
    }
    const url = `https://github.com/${REPO}/issues/41\n`;
    for (const failed of [{ exitCode: 1, stdout: url }, { timedOut: true, stdout: url }, { stdout: '' }, { stdout: 'created\n' }, { stdout: `${url}not a url\n` }, { stdout: 'https://github.com/other/repo/issues/41\n' }]) {
      const { probe } = recording({ 'gh issue create': failed });
      assert.throws(() => probe.submitIssue(REPO, 'Review follow-ups', 'b', 'review-followup'), (e: unknown) => e instanceof GhProbeError && /issue create/.test(e.message), JSON.stringify(failed));
    }
  });
});
