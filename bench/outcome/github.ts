// Card T1-OUTCOME-GITHUB: the outcome tables read through `gh` and git on an injected runner. Read-only: every gh call is
// `gh api --paginate --slurp <GET endpoint>`, every git call is `rev-parse`, `log`, `rev-list` or `show`, and every
// revision or sha handed to git follows `--end-of-options`. Each command runs once; one that fails, or
// whose output is not the expected shape, becomes one `github_errors` row, and the rows of every other command are kept.
import type { SyncRunner } from '../../src/probes/exec.ts';
import type { GithubTable, Row } from './ingest.ts';

/** The rows a reader returns and one `github_errors` row per command that failed. */
export type Read = { rows: Row[]; errors: Row[] };

const TIMEOUT_MS = 120_000;
const SHA = /^[0-9a-f]{40}$/;
/** A `Co-Authored-By` trailer value that names Claude, Codex or GPT, in any letter case. */
const MODEL = /claude|codex|gpt/i;
/**
 * One `git log` record: the sha and the strict ISO commit date on the first line, the parent shas on the second, the values of
 * the `Co-Authored-By` trailers as git parses the trailer block on the third (joined by commas), then the message, then a NUL.
 */
const LOG_FORMAT = '--format=%H %cI%n%P%n%(trailers:key=Co-Authored-By,valueonly,unfold,separator=%x2C)%n%B%x00';

type Json = Record<string, unknown>;
const object = (value: unknown): Json | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined);
/** A field that is absent or not a string is null. */
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
/** A sha as it enters from GitHub, a caller or a commit message: in lower case, the form git prints and every join compares. */
const lower = (sha: string | null): string | null => (sha === null ? null : sha.toLowerCase());

/** One command, run once. `problems` collects what is wrong with it; `close` adds one `github_errors` row when there is any. */
interface Command { out: string | undefined; problems: string[]; close: (errors: Row[]) => void }

function start(runner: SyncRunner, command: string, args: string[]): Command {
  const r = runner(command, args, { timeoutMs: TIMEOUT_MS });
  const problems: string[] = r.timedOut ? ['timeout'] : r.exitCode !== 0 ? ['did not exit 0'] : [];
  const close = (errors: Row[]): void => {
    if (problems.length > 0) errors.push({ command: [command, ...args].join(' '), exit: r.exitCode, stderr: r.stderr.trim().split(/\r?\n/)[0] ?? '', problem: problems.join('; ') });
  };
  // The output of a command that failed is not read.
  return { out: problems.length === 0 ? r.stdout : undefined, problems, close };
}

/** `gh api --paginate --slurp <endpoint>`: the pages, with their numbers counted from 1. Output that is not a JSON array of at least one page is a problem and no page. */
function ghPages(runner: SyncRunner, endpoint: string): { pages: [number, unknown][]; problems: string[]; close: Command['close'] } {
  const c = start(runner, 'gh', ['api', '--paginate', '--slurp', endpoint]);
  let pages: unknown[] = [];
  if (c.out !== undefined) {
    try {
      const doc: unknown = JSON.parse(c.out);
      if (Array.isArray(doc) && doc.length > 0) pages = doc;
      else c.problems.push('not an array of pages');
    } catch {
      c.problems.push('not JSON');
    }
  }
  return { pages: pages.map((page, index) => [index + 1, page]), problems: c.problems, close: c.close };
}

/** R1: every pull request of the repository, in any state. An entry without a number is a problem and no row. */
export function pullRequests(runner: SyncRunner, repository: string): Read {
  const read: Read = { rows: [], errors: [] };
  const c = ghPages(runner, `repos/${repository}/pulls?state=all&per_page=100`);
  for (const [n, page] of c.pages) {
    if (!Array.isArray(page)) {
      c.problems.push(`page ${n} is not an array`);
      continue;
    }
    for (const entry of page) {
      const p = object(entry) ?? {};
      const [head, base] = [object(p['head']), object(p['base'])];
      if (typeof p['number'] !== 'number') c.problems.push(`page ${n} holds a pull request without a number`);
      else read.rows.push({ number: p['number'], headRef: text(head?.['ref']), baseRef: text(base?.['ref']), state: text(p['state']), createdAt: text(p['created_at']), mergedAt: text(p['merged_at']), closedAt: text(p['closed_at']), mergeCommitSha: lower(text(p['merge_commit_sha'])), headSha: lower(text(head?.['sha'])) });
    }
  }
  c.close(read.errors);
  return read;
}

/**
 * R2: every check run of each commit, each commit read once (`filter=all`, so the runs of earlier attempts are listed).
 * `runAttempt` is the `run_attempt` of the workflow run the check run's `details_url` names, read from the workflow runs
 * of the commit (one more call, made only when a check run names one). It is null for a check run that names no
 * workflow run, and for one whose workflow run could not be read, which is a problem of that call. For a workflow run
 * with more than one attempt the jobs of each attempt are read (one call per attempt): a check run has the id of its
 * job, so it gets the attempt whose jobs hold it. One that no attempt read holds is null, never the run's latest
 * attempt: the failed jobs call has its error row, and when every attempt was read the check run has one of its own.
 */
export function checkRuns(runner: SyncRunner, repository: string, shas: string[]): Read {
  const read: Read = { rows: [], errors: [] };
  for (const sha of new Set(shas.map((given) => given.toLowerCase()))) {
    const found: { run: Json; workflowRun: string | undefined }[] = [];
    const c = ghPages(runner, `repos/${repository}/commits/${sha}/check-runs?filter=all&per_page=100`);
    for (const [n, page] of c.pages) {
      const list = object(page)?.['check_runs'];
      if (!Array.isArray(list)) {
        c.problems.push(`page ${n} has no check_runs array`);
        continue;
      }
      for (const entry of list) {
        const run = object(entry) ?? {};
        if (typeof run['name'] !== 'string') c.problems.push(`page ${n} holds a check run without a name`);
        else found.push({ run, workflowRun: /\/actions\/runs\/(\d+)/.exec(text(run['details_url']) ?? '')?.[1] });
      }
    }
    c.close(read.errors);

    const attempts = new Map<string, number>();
    /** Check run (job) id to the attempt whose jobs hold it, for workflow runs with more than one attempt. */
    const jobAttempt = new Map<string, number>();
    const named = new Set(found.flatMap((f) => (f.workflowRun === undefined ? [] : [f.workflowRun])));
    if (named.size > 0) {
      const w = ghPages(runner, `repos/${repository}/actions/runs?head_sha=${sha}&per_page=100`);
      for (const [n, page] of w.pages) {
        const list = object(page)?.['workflow_runs'];
        if (!Array.isArray(list)) {
          w.problems.push(`page ${n} has no workflow_runs array`);
          continue;
        }
        for (const entry of list) {
          const run = object(entry) ?? {};
          if (typeof run['id'] === 'number' && typeof run['run_attempt'] === 'number') attempts.set(String(run['id']), run['run_attempt']);
          else w.problems.push(`page ${n} holds a workflow run without id or run_attempt`);
        }
      }
      for (const id of named) if (!attempts.has(id)) w.problems.push(`workflow run ${id} is not listed`);
      for (const id of named) {
        const last = attempts.get(id) ?? 1;
        let allRead = last > 1;
        for (let attempt = 1; last > 1 && attempt <= last; attempt++) {
          const j = ghPages(runner, `repos/${repository}/actions/runs/${id}/attempts/${attempt}/jobs?per_page=100`);
          for (const [n, page] of j.pages) {
            const list = object(page)?.['jobs'];
            if (!Array.isArray(list)) {
              j.problems.push(`page ${n} has no jobs array`);
              continue;
            }
            for (const entry of list) {
              const job = object(entry) ?? {};
              if (typeof job['id'] === 'number') jobAttempt.set(String(job['id']), attempt);
              else j.problems.push(`page ${n} holds a job without an id`);
            }
          }
          if (j.problems.length > 0) allRead = false;
          j.close(read.errors);
        }
        // Only when every attempt was read is a check run that none holds a problem of its own.
        for (const f of found) if (allRead && f.workflowRun === id && !jobAttempt.has(String(f.run['id']))) w.problems.push(`check run ${String(f.run['id'])} is in no attempt of workflow run ${id}`);
      }
      w.close(read.errors);
    }
    for (const { run, workflowRun } of found) {
      read.rows.push({ sha, name: run['name'], status: text(run['status']), conclusion: text(run['conclusion']), startedAt: text(run['started_at']), completedAt: text(run['completed_at']), runAttempt: workflowRun === undefined ? null : attempts.get(workflowRun) === 1 ? 1 : (jobAttempt.get(String(run['id'])) ?? null) });
    }
  }
  return read;
}

interface Commit { sha: string; date: string; time: number; parents: number; coAuthors: string; message: string }

/** The commits of one `git log` call, in the order git lists them, the date as UTC ISO. A record that is not a sha, a date, a line of parents, a line of trailer values and a message is a problem and no commit. */
function gitLog(runner: SyncRunner, args: string[]): { commits: Commit[]; close: Command['close'] } {
  const c = start(runner, 'git', ['log', LOG_FORMAT, ...args]);
  const commits: Commit[] = [];
  for (const record of (c.out ?? '').split('\0')) {
    if (record.trim() === '') continue;
    const m = /^\n?([0-9a-f]{40}) (\S+)\n([0-9a-f ]*)\n([^\n]*)\n([\s\S]*)$/.exec(record);
    const time = m ? Date.parse(m[2]!) : Number.NaN;
    if (!m || Number.isNaN(time)) c.problems.push('a record is not "<sha> <date>", a line of parents, a line of trailer values and a message');
    else commits.push({ sha: m[1]!, date: new Date(time).toISOString(), time, parents: m[3]!.split(' ').filter((parent) => parent !== '').length, coAuthors: m[4]!, message: m[5]! });
  }
  return { commits, close: c.close };
}

/**
 * R3: the first-parent commits of `base` whose message holds `This reverts commit <40 hex>` (the first such line of a
 * message). `base` is first resolved to a commit; one that does not resolve is one error row and no further git call.
 * The 40 hex are matched in either case and `revertedSha` is in lower case. `daysAfter` is the commit-date difference
 * in days to the reverted commit, read with `git show` when it is an ancestor of the base (a commit merged through a
 * second parent included), else null. Ancestry is `git rev-list --max-count=1 <target> ^<base>`, which exits 0 for both
 * answers: no output for an ancestor, one sha for a commit that is none. Any failure of it is an error row and null.
 */
export function reverts(runner: SyncRunner, base: string): Read {
  const read: Read = { rows: [], errors: [] };
  const resolved = start(runner, 'git', ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]);
  const tip = (resolved.out ?? '').trim();
  if (resolved.out !== undefined && !SHA.test(tip)) resolved.problems.push('not a commit sha');
  resolved.close(read.errors);
  if (!SHA.test(tip)) return read;
  const log = gitLog(runner, ['--first-parent', '--end-of-options', tip, '--']);
  log.close(read.errors);
  for (const c of log.commits) {
    const revertedSha = /This reverts commit ([0-9a-fA-F]{40})\b/.exec(c.message)?.[1]?.toLowerCase();
    if (revertedSha === undefined) continue;
    let daysAfter: number | null = null;
    const outside = start(runner, 'git', ['rev-list', '--max-count=1', '--end-of-options', revertedSha, `^${tip}`]);
    outside.close(read.errors);
    if (outside.out !== undefined && outside.out.trim() === '') {
      const shown = start(runner, 'git', ['show', '-s', '--format=%cI', '--end-of-options', revertedSha]);
      const time = Date.parse((shown.out ?? '').trim());
      if (shown.out !== undefined && Number.isNaN(time)) shown.problems.push('not a date');
      shown.close(read.errors);
      if (!Number.isNaN(time)) daysAfter = (c.time - time) / 86_400_000;
    }
    read.rows.push({ sha: c.sha, date: c.date, revertedSha, daysAfter });
  }
  return read;
}

/**
 * R4: for each pull request merged into `base`, the commits reachable from its head and not from the first parent of
 * its merge commit, which is the base before the merge; `merge` is true for a commit with more than one parent. A pull request that is not merged, or merged into another
 * branch, is not read. A merged one without a 40-hex `headSha` and `mergeCommitSha` is an error row and no git call.
 * So is one whose `headSha` is its `mergeCommitSha`, compared in lower case: the first parent of that commit is the branch
 * commit before it and not the base, so every branch commit but the last would be left out.
 */
export function branchCommits(runner: SyncRunner, base: string, pulls: Row[]): Read {
  const read: Read = { rows: [], errors: [] };
  for (const p of pulls) {
    if (typeof p['mergedAt'] !== 'string' || p['baseRef'] !== base) continue;
    const [head, merge] = [lower(text(p['headSha'])) ?? '', lower(text(p['mergeCommitSha'])) ?? ''];
    if (!SHA.test(head) || !SHA.test(merge)) {
      read.errors.push({ command: 'git log', exit: null, stderr: '', problem: `merged pull request ${String(p['number'])} has no 40-hex headSha and mergeCommitSha` });
      continue;
    }
    if (head === merge) {
      read.errors.push({ command: 'git log', exit: null, stderr: '', problem: `merged pull request ${String(p['number'])} has the same headSha and mergeCommitSha (a fast-forward or indirect merge): the base before the merge cannot be read from git` });
      continue;
    }
    const log = gitLog(runner, ['--end-of-options', head, `^${merge}^1`, '--']);
    log.close(read.errors);
    for (const c of log.commits) read.rows.push({ number: p['number'], sha: c.sha, date: c.date, merge: c.parents > 1, modelCoAuthor: MODEL.test(c.coAuthors) });
  }
  return read;
}

/**
 * R6: the six tables for one repository and base. Check runs are read for the head and the merge commit of each merged
 * pull request. Without a configured repository no gh call is made, which is one error row; git is still read.
 */
export function githubTables(runner: SyncRunner, repository: string | undefined, base: string, requiredChecks: string[]): Record<GithubTable, Row[]> {
  const unconfigured: Row = { command: 'gh api', exit: null, stderr: '', problem: 'no repository in aidlc.config.json: pull requests and check runs are not read' };
  const prs = repository === undefined ? { rows: [], errors: [unconfigured] } : pullRequests(runner, repository);
  const shas = prs.rows.filter((p) => typeof p['mergedAt'] === 'string').flatMap((p) => [p['headSha'], p['mergeCommitSha']]).filter((sha) => typeof sha === 'string');
  const checks = repository === undefined ? { rows: [], errors: [] } : checkRuns(runner, repository, shas);
  const reverted = reverts(runner, base);
  const commits = branchCommits(runner, base, prs.rows);
  return {
    prs: prs.rows,
    checks: checks.rows,
    reverts: reverted.rows,
    branch_commits: commits.rows,
    github_errors: [...prs.errors, ...checks.errors, ...reverted.errors, ...commits.errors],
    required_checks: requiredChecks.map((name) => ({ name })),
  };
}
