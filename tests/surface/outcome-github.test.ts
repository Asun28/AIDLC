// Card T1-OUTCOME-GITHUB: pull requests, check runs, reverts and branch commits read through gh and git (bench/outcome/github.ts), and their views.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { branchCommits, checkRuns, githubTables, pullRequests, reverts } from '../../bench/outcome/github.ts';
import type { Row } from '../../bench/outcome/ingest.ts';
import { runSync, scriptedRunner, type ExecReceipt, type SyncRunner } from '../../src/probes/exec.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const temps: string[] = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temporary directory by its canonical path (the Windows runner's temp directory is an 8.3 short path), removed after the tests. */
function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'aidlc-outcome-gh-')));
  temps.push(dir);
  return dir;
}

function put(file: string, text: string): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

const REPO = 'o/r';
const PULLS = `repos/${REPO}/pulls?state=all&per_page=100`;
const checksOf = (sha: string): string => `repos/${REPO}/commits/${sha}/check-runs?filter=all&per_page=100`;
const runsOf = (sha: string): string => `repos/${REPO}/actions/runs?head_sha=${sha}&per_page=100`;
const jobsOf = (run: number, attempt: number): string => `repos/${REPO}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`;
const gh = (endpoint: string): string => `gh api --paginate --slurp ${endpoint}`;
/** `2026-01-<day>T<hh:mm>:00Z`. */
const at = (day: number, time = '00:00'): string => `2026-01-${String(day).padStart(2, '0')}T${time}:00Z`;

/** A scripted runner whose keys are whole command lines, and every command line it was given. */
function recording(script: Record<string, Partial<ExecReceipt>>): { runner: SyncRunner; calls: string[] } {
  const calls: string[] = [];
  const scripted = scriptedRunner(script);
  return { calls, runner: (command, args, options) => (calls.push([command, ...args].join(' ')), scripted(command, args, options)) };
}

/** A pull request as the REST API returns it, and the row it becomes. */
const pr = (number: number, ref: string, sha: string | null, merged_at: string | null, merge_commit_sha: string | null, rest: object = {}): object => ({ number, state: 'closed', created_at: at(1), merged_at, closed_at: merged_at ?? at(6), merge_commit_sha, head: { ref, sha }, base: { ref: 'main' }, ...rest });
const prRow = (number: number, headRef: string, headSha: string | null, mergedAt: string | null, mergeCommitSha: string | null, rest: Row = {}): Row => ({ number, headRef, baseRef: 'main', state: 'closed', createdAt: at(1), mergedAt, closedAt: mergedAt ?? at(6), mergeCommitSha, headSha, ...rest });
/** A check run as the REST API returns it: of workflow run `run` (its id is the id of its job), or of no workflow run. A null conclusion is a check still running. */
const check = (name: string, conclusion: string | null, started_at: string, run?: number, id = 7): object => ({ id, name, status: conclusion === null ? 'in_progress' : 'completed', conclusion, started_at, completed_at: conclusion === null ? null : started_at.replace(':00Z', ':59Z'), details_url: run === undefined ? 'https://ci.example/x' : `https://github.com/${REPO}/actions/runs/${run}/job/${id}` });
const checkPage = (...check_runs: object[]): object => ({ total_count: check_runs.length, check_runs });

test('T1-OUTCOME-GITHUB acceptance 1: pullRequests returns the rows of both pages with the nine fields, a pull request with a null merged_at included [R1]', () => {
  const [a, b, c, d, e] = ['a', 'b', 'c', 'd', 'e'].map((ch) => ch.repeat(40)) as [string, string, string, string, string];
  const pages = [[pr(1, 'T1-A', a, at(1, '02:00'), b), pr(2, 'T1-B', c, null, null, { state: 'open', closed_at: null })], [pr(3, 'x', d, at(3), e, { base: { ref: 'release' } })]];
  const { runner, calls } = recording({ [gh(PULLS)]: { stdout: JSON.stringify(pages) } });
  assert.deepEqual(pullRequests(runner, REPO), { rows: [prRow(1, 'T1-A', a, at(1, '02:00'), b), prRow(2, 'T1-B', c, null, null, { state: 'open', closedAt: null }), prRow(3, 'x', d, at(3), e, { baseRef: 'release' })], errors: [] });
  assert.deepEqual(calls, [gh(PULLS)]);
});

test('T1-OUTCOME-GITHUB acceptance 2: checkRuns gives a check run of a workflow run on attempt 2 runAttempt 2 and a check run of no workflow run null, each commit read once [R2]', () => {
  const { runner, calls } = recording({
    [gh(checksOf('s1'))]: { stdout: JSON.stringify([checkPage(check('ci', 'failure', at(1, '01:00'), 900, 11), check('ci', 'success', at(1, '01:20'), 900, 12)), checkPage(check('ext', null, at(1, '01:05')), check('lint', 'success', at(1, '01:00'), 901, 13))]) },
    [gh(jobsOf(900, 1))]: { stdout: JSON.stringify([{ total_count: 1, jobs: [{ id: 11, run_attempt: 1 }] }]) },
    [gh(jobsOf(900, 2))]: { stdout: JSON.stringify([{ total_count: 1, jobs: [{ id: 12, run_attempt: 2 }] }]) },
    [gh(runsOf('s1'))]: { stdout: JSON.stringify([{ total_count: 2, workflow_runs: [{ id: 901, run_attempt: 1 }, { id: 900, run_attempt: 2 }] }]) },
    [gh(checksOf('s2'))]: { stdout: JSON.stringify([checkPage(check('ext', 'success', at(2)))]) },
  });
  assert.deepEqual(checkRuns(runner, REPO, ['s1', 's2', 's1']), {
    rows: [
      { sha: 's1', name: 'ci', status: 'completed', conclusion: 'failure', startedAt: at(1, '01:00'), completedAt: '2026-01-01T01:00:59Z', runAttempt: 1 },
      { sha: 's1', name: 'ci', status: 'completed', conclusion: 'success', startedAt: at(1, '01:20'), completedAt: '2026-01-01T01:20:59Z', runAttempt: 2 },
      { sha: 's1', name: 'ext', status: 'in_progress', conclusion: null, startedAt: at(1, '01:05'), completedAt: null, runAttempt: null },
      { sha: 's1', name: 'lint', status: 'completed', conclusion: 'success', startedAt: at(1, '01:00'), completedAt: '2026-01-01T01:00:59Z', runAttempt: 1 },
      { sha: 's2', name: 'ext', status: 'completed', conclusion: 'success', startedAt: at(2), completedAt: '2026-01-02T00:00:59Z', runAttempt: null },
    ],
    errors: [],
  });
  assert.deepEqual(calls, [gh(checksOf('s1')), gh(runsOf('s1')), gh(jobsOf(900, 1)), gh(jobsOf(900, 2)), gh(checksOf('s2'))], 'the jobs are read for the run with two attempts only');

  // A jobs call that fails, and a check run that is in no attempt's jobs: the run's attempt, and one error row each.
  const partial = recording({
    [gh(checksOf('s3'))]: { stdout: JSON.stringify([checkPage(check('a', 'success', at(1), 900, 11), check('b', 'success', at(1), 902, 21), check('c', 'success', at(1), 902, 22))]) },
    [gh(runsOf('s3'))]: { stdout: JSON.stringify([{ workflow_runs: [{ id: 900, run_attempt: 2 }, { id: 902, run_attempt: 2 }] }]) },
    [gh(jobsOf(900, 1))]: { stdout: JSON.stringify([{ jobs: [{ id: 11 }] }]) },
    [gh(jobsOf(900, 2))]: { exitCode: 1, stderr: 'gh: Not Found (HTTP 404)' },
    [gh(jobsOf(902, 1))]: { stdout: JSON.stringify([{ jobs: [{ id: 21 }] }]) },
    [gh(jobsOf(902, 2))]: { stdout: JSON.stringify([{ jobs: [{ id: 99 }] }]) },
  });
  const fallback = checkRuns(partial.runner, REPO, ['s3']);
  assert.deepEqual(fallback.rows.map((r) => [r['name'], r['runAttempt']]), [['a', 1], ['b', 1], ['c', 2]]);
  assert.deepEqual(fallback.errors, [
    { command: gh(jobsOf(900, 2)), exit: 1, stderr: 'gh: Not Found (HTTP 404)', problem: 'did not exit 0' },
    { command: gh(runsOf('s3')), exit: 0, stderr: '', problem: 'check run 22 is in no attempt of workflow run 902' },
  ]);
});

/** Real git in `dir`, through the runner the readers take. */
const LOG = 'git log --format=%H %cI%n%P%n%(trailers:key=Co-Authored-By,valueonly,unfold,separator=%x2C)%n%B%x00';
const gitIn = (dir: string): SyncRunner => (command, args, options) => runSync(command, args, { ...options, cwd: dir });
const recordingGit = (dir: string): { runner: SyncRunner; calls: string[] } => {
  const calls: string[] = [];
  return { calls, runner: (command, args, options) => (calls.push([command, ...args].join(' ')), runSync(command, args, { ...options, cwd: dir })) };
};
let built: { dir: string; sha: Record<string, string> } | undefined;

/**
 * A real repository, built once. main: `c0`, then per branch its squash commit (`mA`, `mR`, `mV`, `mF`), then reverts of `mV`
 * after 2 days, `mA` after 15 days, `c0` after 3 days and `f1` (not on main), a commit whose subject starts with Revert and
 * whose body holds a sha without the reverts line, a merge of branch side, whose one commit reverts `mR`, and a revert of
 * that commit, which reached main through the merge's second parent, after 3 days. `f2` quotes a Co-Authored-By line in prose.
 * Branches from main: T1-A (`a1`, then `n1` lands on main and `aM` merges main into the branch), T1-RED (`r1`), T1-REV (`v1`), feature-x (`f1`, `f2`). It also holds the configuration
 * and the stand-in for `gh` that run.ts reads when started there.
 */
function repo(): { dir: string; sha: Record<string, string> } {
  if (built) return built;
  const dir = tempDir();
  const sha: Record<string, string> = {};
  const git = (args: string[], date = at(1)): string => {
    const r = spawnSync('git', args, { cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (name: string, date: string, message: string): void => {
    git(['commit', '-q', '--allow-empty', '-m', message], date);
    sha[name] = git(['rev-parse', 'HEAD']);
  };
  const branch = (name: string, commits: [name: string, message: string][], squash: string, mergedAt: string, baseMerge?: string): void => {
    git(['checkout', '-q', '-b', name]);
    for (const [commitName, message] of commits) commit(commitName, at(1, '00:30'), message);
    git(['checkout', '-q', 'main']);
    if (baseMerge !== undefined) {
      commit('n1', at(1, '00:40'), 'on main while the branch is open');
      git(['checkout', '-q', name]);
      git(['merge', '-q', '--no-ff', '-m', 'Merge main into the branch', 'main'], at(1, '00:45'));
      sha[baseMerge] = git(['rev-parse', 'HEAD']);
      git(['checkout', '-q', 'main']);
    }
    commit(squash, mergedAt, `squash ${name}`);
  };
  git(['init', '-q', '-b', 'main']);
  for (const [key, value] of [['user.name', 'Test'], ['user.email', 'test@example.com'], ['commit.gpgsign', 'false']]) git(['config', key!, value!]);
  commit('c0', at(1), 'init');
  branch('T1-A', [['a1', 'a1\n\nCo-Authored-By: Claude Fable <noreply@anthropic.com>']], 'mA', at(1, '02:00'), 'aM');
  branch('T1-RED', [['r1', 'r1\n\nCo-Authored-By: Codex <codex@example.com>']], 'mR', at(2, '10:00'));
  branch('T1-REV', [['v1', 'v1\n\nCo-authored-by: GPT-6 <gpt@example.com>']], 'mV', at(4, '06:00'));
  branch('feature-x', [['f1', 'f1\n\nco-authored-by: CLAUDE <c@example.com>'], ['f2', 'f2\n\nCo-Authored-By: Claude <c@example.com>\nis the trailer the loop writes; this commit has none.']], 'mF', at(5));
  commit('revV', at(6, '06:00'), `Revert "squash T1-REV"\n\nThis reverts commit ${sha['mV']}.`);
  commit('revA', at(16, '02:00'), `Revert "squash T1-A"\n\nThis reverts commit ${sha['mA']}.`);
  commit('rev0', at(4), `Revert "init"\n\nThis reverts commit ${sha['c0']}.`);
  commit('revGone', at(7), `Revert "f1"\n\nThis reverts commit ${sha['f1']}.`);
  commit('plain', at(8), `Revert the plan\n\nSee ${sha['c0']}.`);
  git(['checkout', '-q', '-b', 'side']);
  commit('sideRevert', at(9), `Revert "squash T1-RED"\n\nThis reverts commit ${sha['mR']}.`);
  git(['checkout', '-q', 'main']);
  git(['merge', '-q', '--no-ff', '-m', 'Merge side', 'side'], at(9));
  commit('revSide', at(12), `Revert "side"\n\nThis reverts commit ${sha['sideRevert']}.`);
  put(path.join(dir, 'aidlc.config.json'), JSON.stringify({ repository: REPO, base: 'main', github: { requiredChecks: ['ci', 'scan'] } }));
  // The stand-in for gh: a copy of node named gh, which run.ts starts in this directory as `gh api ...`, so node runs api.js.
  // It answers an endpoint from the JSON file FAKE_GH names, else as gh does for HTTP 404, and logs each call.
  put(path.join(dir, 'api.js'), "const fs = require('node:fs');\nconst endpoint = process.argv[process.argv.length - 1];\nfs.appendFileSync(process.env.FAKE_GH + '.log', process.argv.slice(2).join(' ') + '\\n');\nconst answer = JSON.parse(fs.readFileSync(process.env.FAKE_GH, 'utf8'))[endpoint];\nif (answer === undefined) {\n  process.stderr.write('gh: Not Found (HTTP 404)\\n');\n  process.exit(1);\n}\nprocess.stdout.write(JSON.stringify(answer));\n");
  for (const name of ['bin', 'sub']) mkdirSync(path.join(dir, name));
  copyFileSync(process.execPath, path.join(dir, 'bin', process.platform === 'win32' ? 'gh.exe' : 'gh'));
  return (built = { dir, sha });
}

test('T1-OUTCOME-GITHUB acceptance 3: reverts finds a revert made 3 days after its target, ignores a subject that starts with Revert and has no reverts line, and gives null daysAfter for a sha that is not on the base [R3] [R5]', () => {
  const { dir, sha } = repo();
  const row = (name: string, date: string, target: string, daysAfter: number | null): Row => ({ sha: sha[name], date, revertedSha: sha[target], daysAfter });
  assert.deepEqual(reverts(gitIn(dir), 'main'), {
    rows: [row('revSide', '2026-01-12T00:00:00.000Z', 'sideRevert', 3), row('revGone', '2026-01-07T00:00:00.000Z', 'f1', null), row('rev0', '2026-01-04T00:00:00.000Z', 'c0', 3), row('revA', '2026-01-16T02:00:00.000Z', 'mA', 15), row('revV', '2026-01-06T06:00:00.000Z', 'mV', 2)],
    errors: [],
  });
  const missing = reverts(gitIn(dir), 'no-such-branch');
  assert.deepEqual(missing.rows, []);
  assert.deepEqual(missing.errors.map((e) => [e['command'], e['exit'], e['problem']]), [['git rev-parse --verify --end-of-options no-such-branch^{commit}', 128, 'did not exit 0']]);
  assert.match(String(missing.errors[0]!['stderr']), /^fatal: /);
  // A base that git could read as an option: no file is written, no log is read, one error row.
  const option = recordingGit(dir);
  const injected = reverts(option.runner, '--output=x');
  assert.deepEqual([injected.rows, injected.errors.map((e) => e['command']), option.calls.length], [[], ['git rev-parse --verify --end-of-options --output=x^{commit}'], 1]);
  assert.equal(existsSync(path.join(dir, 'x')), false, 'git wrote the file the base names');
});

test('T1-OUTCOME-GITHUB acceptance 4: branchCommits lists the commits of each merged branch that were not on the base before the merge, merge true for a merge of the base into the branch, modelCoAuthor by the Co-Authored-By trailer in any letter case [R4] [R5]', () => {
  const { dir, sha } = repo();
  const s = (name: string): string => sha[name]!;
  const pulls = [
    prRow(11, 'T1-RED', s('aM'), at(1, '02:00'), s('mA')),
    prRow(20, 'still-open', s('f2'), null, null, { state: 'open' }),
    prRow(21, 'merged-elsewhere', s('f2'), at(5), s('mF'), { baseRef: 'release' }),
    prRow(22, 'head-gone', '0'.repeat(40), at(5), s('mF')),
    prRow(23, 'no-head', null, at(5), s('mF')),
    prRow(12, 'T1-RED', s('r1'), at(2, '10:00'), s('mR')),
    prRow(13, 'T1-REV', s('v1'), at(4, '06:00'), s('mV')),
    prRow(15, 'feature-x', s('f2'), at(5), s('mF')),
  ];
  const got = branchCommits(gitIn(dir), 'main', pulls);
  const row = (number: number, name: string, modelCoAuthor: boolean, merge = false): Row => ({ number, sha: s(name), date: merge ? '2026-01-01T00:45:00.000Z' : '2026-01-01T00:30:00.000Z', merge, modelCoAuthor });
  assert.deepEqual(got.rows, [row(11, 'aM', false, true), row(11, 'a1', true), row(12, 'r1', true), row(13, 'v1', true), row(15, 'f2', false), row(15, 'f1', true)]);
  assert.deepEqual(got.errors.map((e) => [e['command'], e['exit'], e['problem']]), [
    [`${LOG} --end-of-options ${'0'.repeat(40)} ^${s('mF')}^1 --`, 128, 'did not exit 0'],
    ['git log', null, 'merged pull request 23 has no 40-hex headSha and mergeCommitSha'],
  ]);
  assert.match(String(got.errors[0]!['stderr']), /^fatal: /);
});

test('T1-OUTCOME-GITHUB acceptance 5: a runner exit of 1, a timeout, output that is not JSON and a 429 body each give one github_errors row beside the rows of the other commands, each command run once [R5]', () => {
  const ok = JSON.stringify([checkPage(check('ci', 'success', at(1)))]);
  const shas = ['s1', 's2', 's3', 's4', 's5', 's6'];
  const { runner, calls } = recording({
    [gh(checksOf('s1'))]: { stdout: ok },
    [gh(checksOf('s2'))]: { exitCode: 1, stdout: ok, stderr: '\ngh: Server Error (HTTP 502)\nsecond line\n' },
    [gh(checksOf('s3'))]: { exitCode: null, timedOut: true, stdout: ok },
    [gh(checksOf('s4'))]: { stdout: 'not json' },
    [gh(checksOf('s5'))]: { exitCode: 1, stdout: '{"message":"API rate limit exceeded","status":"429"}', stderr: 'gh: API rate limit exceeded (HTTP 429)' },
    [gh(checksOf('s6'))]: { stdout: ok },
  });
  const got = checkRuns(runner, REPO, shas);
  const error = (endpoint: string, exit: number | null, stderr: string, problem: string): Row => ({ command: gh(endpoint), exit, stderr, problem });
  assert.deepEqual(got.rows.map((r) => r['sha']), ['s1', 's6']);
  assert.deepEqual(got.errors, [error(checksOf('s2'), 1, 'gh: Server Error (HTTP 502)', 'did not exit 0'), error(checksOf('s3'), null, '', 'timeout'), error(checksOf('s4'), 0, '', 'not JSON'), error(checksOf('s5'), 1, 'gh: API rate limit exceeded (HTTP 429)', 'did not exit 0')]);
  assert.deepEqual(calls, shas.map((sha) => gh(checksOf(sha))));

  // Output of an exit 0 that is not the expected shape: one row per command, naming each part that was left out.
  const rateLimited = { message: 'API rate limit exceeded' };
  const shapes: [stdout: string, numbers: number[], problem: string][] = [
    ['', [], 'not JSON'],
    ['[]', [], 'not an array of pages'],
    [JSON.stringify(rateLimited), [], 'not an array of pages'],
    [JSON.stringify([[pr(1, 'a', null, null, null)], rateLimited, [{ title: 'no number' }, pr(2, 'b', null, null, null)]]), [1, 2], 'page 2 is not an array; page 3 holds a pull request without a number'],
  ];
  for (const [stdout, numbers, problem] of shapes) {
    const one = recording({ [gh(PULLS)]: { stdout } });
    const pulls = pullRequests(one.runner, REPO);
    assert.deepEqual([pulls.rows.map((r) => r['number']), pulls.errors, one.calls], [numbers, [error(PULLS, 0, '', problem)], [gh(PULLS)]], stdout);
  }
  const partial = recording({
    [gh(checksOf('s1'))]: { stdout: JSON.stringify([rateLimited, checkPage({ status: 'queued' }, check('ci', 'success', at(1), 900), check('lint', 'success', at(1), 901))]) },
    [gh(runsOf('s1'))]: { stdout: JSON.stringify([{ workflow_runs: [{ id: 901, run_attempt: 1 }, { id: 'x' }] }]) },
  });
  const checks = checkRuns(partial.runner, REPO, ['s1']);
  assert.deepEqual(checks.rows.map((r) => [r['name'], r['runAttempt']]), [['ci', null], ['lint', 1]]);
  assert.deepEqual(checks.errors, [
    error(checksOf('s1'), 0, '', 'page 1 has no check_runs array; page 2 holds a check run without a name'),
    error(runsOf('s1'), 0, '', 'page 1 holds a workflow run without id or run_attempt; workflow run 900 is not listed'),
  ]);
});

// run.ts over a fixture of four cards: T1-A (accepted, joined by prNumber to a pull request whose headRef names T1-RED,
// its only branch commit without a trailer a merge of the base),
// T1-RED (merged, required check ci red on the merge commit and green on the head), T1-REV (merged, joined by headRef, reverted
// after 2 days, two runs) and T1-D (a stopReview, a mergeVerified run, its pull request closed unmerged, superseded).
const cardText = (id: string, extra = ''): string => `---\nid: ${id}\ntitle: ${id}\nstatus: todo\nallow_paths:\n  - src/x.ts\ndod_command: npm test\n${extra}---\n\n# ${id}\n`;

function cards(successorOfD = 'T1-NEXT'): string {
  const dir = path.join(tempDir(), 'tasks');
  for (const id of ['T1-A', 'T1-RED', 'T1-REV', 'T1-NEXT']) put(path.join(dir, `${id}.md`), cardText(id));
  put(path.join(dir, 'T1-D.md'), cardText('T1-D', `superseded_by: ${successorOfD}\n`));
  return dir;
}

function state(prOfA = 11, verifiedD = true): string {
  const dir = path.join(tempDir(), 'state');
  const run = (goalId: string, cardId: string, startedAt: string, extra: object = {}): string => put(path.join(dir, 'cards', goalId, `${cardId}.json`), JSON.stringify({ goalId, cardId, cardRevision: 0, goalGeneration: 0, state: 'DONE', startedAt, deadline: at(30), updatedAt: at(9), ...extra }));
  const formal = { invocationId: 'i1', candidateDigest: 'd1', base: 'main', policyVersion: '1', reviewer: 'codex', requestedAt: at(5, '01:00'), outcome: 'pass' };
  run('g-a', 'T1-A', at(1), { mergeVerified: true, pr: { number: prOfA, state: 'MERGED' }, review: { substantiveDecisions: 1, invocations: [formal] } });
  run('g-r', 'T1-RED', at(2), { mergeVerified: true, pr: { number: 12, state: 'MERGED' } });
  run('g-r0', 'T1-RED', at(2, '05:00'), { pr: { number: 20, state: 'CLOSED' } });
  run('g-v0', 'T1-REV', at(3));
  run('g-v1', 'T1-REV', at(4));
  run('g-d', 'T1-D', at(5), { mergeVerified: verifiedD, pr: { number: 14, state: 'CLOSED' }, review: { substantiveDecisions: 1, substantiveBlocks: 1, invocations: [{ ...formal, outcome: 'block', stopReview: 'F1 raised again' }] } });
  mkdirSync(path.join(dir, 'journal'));
  return dir;
}

/** What the stand-in gh answers per endpoint: seven pull requests on two pages (17 is a second, later merged one of T1-REV), and the check runs of seven of the eight commits. */
function answers(s: Record<string, string>, scanOnA: object[] = [check('scan', 'success', at(1, '02:01'))], headOfA = s['aM']!): Record<string, unknown> {
  const green = [check('ci', 'success', at(5)), check('scan', 'success', at(5))];
  return {
    [PULLS]: [
      [pr(11, 'T1-RED', headOfA, at(1, '02:00'), s['mA']!), pr(12, 'T1-RED', s['r1']!, at(2, '10:00'), s['mR']!), pr(13, 'T1-REV', s['v1']!, at(4, '06:00'), s['mV']!)],
      [pr(14, 'T1-D', s['c0']!, null, null), pr(15, 'feature-x', s['f2']!, at(5), s['mF']!), pr(16, 'T1-D', s['c0']!, null, null, { state: 'open', closed_at: null }), pr(17, 'T1-REV', s['f2']!, at(6), s['mF']!), pr(18, 'T1-RED', s['c0']!, null, null), pr(19, 'T1-NEXT', s['c0']!, null, null), pr(20, 'retry-branch', s['c0']!, null, null)],
    ],
    [checksOf(s['aM']!)]: [checkPage(check('ci', 'failure', at(1, '01:10'), 900, 1), check('ci', 'success', at(1, '01:30'), 900, 2), check('scan', 'success', at(1, '01:10')))],
    [runsOf(s['aM']!)]: [{ total_count: 1, workflow_runs: [{ id: 900, run_attempt: 2 }] }],
    [jobsOf(900, 1)]: [{ total_count: 1, jobs: [{ id: 1 }] }],
    [jobsOf(900, 2)]: [{ total_count: 1, jobs: [{ id: 2 }] }],
    [checksOf(s['mA']!)]: [checkPage(check('ci', 'failure', at(1, '02:01')), check('ci', 'success', at(1, '02:05')), check('docs', 'failure', at(1, '02:01')), ...scanOnA)],
    [checksOf(s['r1']!)]: [checkPage(...green, check('docs', 'failure', at(2)), check('lint', 'success', at(2), 901))],
    [runsOf(s['r1']!)]: [{ total_count: 1, workflow_runs: [{ id: 901, run_attempt: 1 }] }],
    [checksOf(s['mR']!)]: [checkPage(check('ci', 'success', at(2, '10:01')), check('ci', 'failure', at(2, '10:05')), check('scan', 'success', at(2, '10:01')))],
    [checksOf(s['v1']!)]: [checkPage(check('ci', 'success', at(3)), check('scan', 'failure', at(3)))],
    [checksOf(s['mV']!)]: [checkPage(...green)],
    [checksOf(s['mF']!)]: [checkPage(...green)],
  };
}

/** `node bench/outcome/run.ts` started in a subdirectory of the fixture repository, with the stand-in gh first on PATH and no variable aidlc reads. */
function outcome(args: string[], over: { state?: string; cards?: string; answers?: Record<string, unknown> } = {}): { status: number | null; stdout: string; stderr: string; out: string; ghCalls: string[] } {
  const { dir, sha } = repo();
  const out = path.join(tempDir(), 'out');
  const map = put(path.join(tempDir(), 'gh.json'), JSON.stringify(over.answers ?? answers(sha)));
  const kept = Object.entries(process.env).filter(([k]) => !/^(AIDLC_.*|NODE_OPTIONS|PATH)$/i.test(k));
  const env = { ...Object.fromEntries(kept), PATH: `${path.join(dir, 'bin')}${path.delimiter}${process.env['PATH'] ?? ''}`, FAKE_GH: map };
  const r = spawnSync(process.execPath, [path.join(root, 'bench', 'outcome', 'run.ts'), '--state', over.state ?? state(), '--cards', over.cards ?? cards(), '--out', out, ...args], { cwd: path.join(dir, 'sub'), env, encoding: 'utf8', windowsHide: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out, ghCalls: existsSync(`${map}.log`) ? readFileSync(`${map}.log`, 'utf8').trim().split('\n') : [] };
}

const GITHUB_FILES = ['prs', 'checks', 'reverts', 'branch_commits', 'github_errors', 'required_checks'].map((name) => `${name}.jsonl`);
const lines = (out: string, name: string): string[] => readFileSync(path.join(out, name), 'utf8').split('\n').filter((line) => line !== '');
const missingBin = (): string => path.join(tempDir(), 'missing-duckdb.exe');

test('T1-OUTCOME-GITHUB acceptance 5 through run.ts: a failing gh call is a row of github_errors.jsonl, and every other table is still written [R5] [R6]', () => {
  const { sha } = repo();
  const r = outcome(['--duckdb', missingBin()]);
  assert.equal(r.status, 2, r.stderr);
  assert.deepEqual(GITHUB_FILES.filter((name) => !existsSync(path.join(r.out, name))), [], 'the six files are written before DuckDB is started');
  const failed =`repos/${REPO}/commits/${sha['f2']}/check-runs?filter=all&per_page=100`;
  assert.deepEqual(lines(r.out, 'github_errors.jsonl'), [JSON.stringify({ command: gh(failed), exit: 1, stderr: 'gh: Not Found (HTTP 404)', problem: 'did not exit 0' })]);
  assert.deepEqual(GITHUB_FILES.map((name) => lines(r.out, name).length), [10, 20, 5, 8, 1, 2]);
  assert.deepEqual(lines(r.out, 'required_checks.jsonl'), ['{"name":"ci"}', '{"name":"scan"}']);
  assert.equal(lines(r.out, 'card_runs.jsonl').length, 6);
  assert.deepEqual([r.ghCalls.length, new Set(r.ghCalls).size], [13, 13], 'one pulls call, one check-runs call per commit of a merged pull request, one workflow-run call per commit with a workflow check, one jobs call per attempt of the rerun');

  const noPulls = outcome(['--duckdb', missingBin()], { answers: {} });
  assert.equal(noPulls.status, 2, noPulls.stderr);
  assert.deepEqual(lines(noPulls.out, 'github_errors.jsonl'), [JSON.stringify({ command: gh(PULLS), exit: 1, stderr: 'gh: Not Found (HTTP 404)', problem: 'did not exit 0' })]);
  assert.deepEqual(GITHUB_FILES.map((name) => lines(noPulls.out, name).length), [0, 0, 5, 0, 1, 2]);
  assert.equal(lines(noPulls.out, 'cards.jsonl').length, 5);

  const unconfigured = githubTables(gitIn(repo().dir), undefined, 'main', ['ci']);
  assert.deepEqual([unconfigured.prs, unconfigured.checks, unconfigured.reverts.length, unconfigured.required_checks], [[], [], 5, [{ name: 'ci' }]]);
  assert.deepEqual(unconfigured.github_errors, [{ command: 'gh api', exit: null, stderr: '', problem: 'no repository in aidlc.config.json: pull requests and check runs are not read' }]);
});

const duckdb = process.env['DUCKDB_BIN'] ?? (spawnSync('duckdb', ['--version'], { windowsHide: true }).status === 0 ? 'duckdb' : undefined);
const views = (stdout: string): Map<string, Row[]> => new Map(stdout.trim().split('\n').map((line) => JSON.parse(line) as { view: string; rows: Row[] }).map((v) => [v.view, v.rows]));

test('T1-OUTCOME-GITHUB acceptance 6, 9 and 10: run.ts prints the PR success rate, the PR lead time, the CI shares and the reconciliation of the four-card fixture, noHumanCommit true, null and false, and --no-github writes none of the six files [R6] [R7] [R8]', { skip: duckdb === undefined ? 'no duckdb binary' : false }, () => {
  const { sha } = repo();
  const r = outcome(['--duckdb', duckdb!]);
  assert.equal(r.status, 0, r.stderr);
  const got = views(r.stdout);
  const success = (rest: Row): Row[] => [{ card_attempts: 4, accepted: 0, pr_success_rate: 0, accepted_strict: 0, pr_success_rate_strict: 0, failing_merged: 1, failing_checksGreen: 1, failing_notReverted: 1, failing_noHumanCommit: 0, failing_noRuling: 1, unknown_noHumanCommit: 0, ...rest }];
  // Acceptance 9, first case: the merge of the base on T1-A's branch has no trailer and T1-A is accepted under both rates.
  assert.deepEqual(got.get('summary_pr_success'), success({ accepted: 1, pr_success_rate: 0.25, accepted_strict: 1, pr_success_rate_strict: 0.25 }));
  // Hours from the earliest run to mergedAt: T1-A 2, T1-RED 10, T1-REV 30 (6 from its later run). T1-D has a mergeVerified run and no merged pull request.
  assert.deepEqual(got.get('summary_lead_time_pr'), [{ p50_hours: 10, p90_hours: 26, n: 3, merged_cards_without_pr: 1 }]);
  // Of the five merged pull requests, 11 has a head check on attempt 2 and 12 one on attempt 1, and 11 (ci) and 13 (scan) a required check whose first run failed.
  assert.deepEqual(got.get('summary_ci'), [{ merged_prs: 5, rerun_share: 0.2, first_attempt_failed_share: 0.4 }]);
  assert.deepEqual(got.get('summary_reconcile'), [
    // Closed unmerged: 14 of T1-D by its run's prNumber and by headRef, counted once; 19 of T1-NEXT, a registry card with no
    // run; 18 of T1-RED by headRef, its merged run naming 12, and 20 by the prNumber of its other run, its headRef no card id.
    { kind: 'closed_unmerged', cardId: 'T1-D', n: 1 },
    { kind: 'closed_unmerged', cardId: 'T1-NEXT', n: 1 },
    { kind: 'closed_unmerged', cardId: 'T1-RED', n: 2 },
    { kind: 'mergeVerified_without_merged_pr', cardId: 'T1-D', n: 1 },
    { kind: 'merged_pr_without_mergeVerified', cardId: 'T1-REV', n: 2 },
  ]);

  // One change each to T1-A: it succeeds a card with a stopReview; its pull request is the one with a commit that is
  // no merge and has no model co-author (acceptance 9: neither accepted nor acceptedStrict); its merge commit has no run
  // of the required check scan; the head of its pull request is a commit the repository does not hold, so its branch
  // commits cannot be read (acceptance 9: noHumanCommit null, accepted, not acceptedStrict, in the null count).
  const variant = (over: Parameters<typeof outcome>[1], view = 'summary_pr_success'): Row[] | undefined => {
    const v = outcome(['--duckdb', duckdb!], over);
    assert.equal(v.status, 0, v.stderr);
    return views(v.stdout).get(view);
  };
  assert.deepEqual(variant({ cards: cards('T1-A') }), success({ failing_noRuling: 2 }));
  assert.deepEqual(variant({ state: state(15) }), success({ failing_noHumanCommit: 1 }));
  assert.deepEqual(variant({ answers: answers(sha, []) }), success({ failing_checksGreen: 2 }));
  // Acceptance 10: an earlier success of scan and a queued rerun of it, which has no startedAt, is not green.
  const queued = { name: 'scan', status: 'queued', conclusion: null, started_at: null, completed_at: null, details_url: null };
  assert.deepEqual(variant({ answers: answers(sha, [check('scan', 'success', at(1, '02:01')), queued]) }), success({ failing_checksGreen: 2 }));
  // The same for a queued run that carries a startedAt earlier than the success: its status alone makes it the latest.
  assert.deepEqual(variant({ answers: answers(sha, [check('scan', 'success', at(1, '02:01')), { ...queued, started_at: at(1, '01:00') }]) }), success({ failing_checksGreen: 2 }));
  assert.deepEqual(variant({ answers: answers(sha, undefined, '0'.repeat(40)) }), success({ accepted: 1, pr_success_rate: 0.25, unknown_noHumanCommit: 1 }));
  // Without a mergeVerified run T1-D is not a merged card, so no merged card lacks a pull request.
  assert.deepEqual(variant({ state: state(11, false) }, 'summary_lead_time_pr'), [{ p50_hours: 10, p90_hours: 26, n: 3, merged_cards_without_pr: 0 }]);

  const off = outcome(['--duckdb', duckdb!, '--no-github']);
  assert.equal(off.status, 0, off.stderr);
  assert.deepEqual(GITHUB_FILES.filter((name) => existsSync(path.join(off.out, name))), []);
  assert.deepEqual([...views(off.stdout).keys()], ['summary_lead_time', 'summary_review_convergence', 'summary_stop_reasons', 'summary_successor_rate']);
  assert.deepEqual(off.ghCalls, []);
});
