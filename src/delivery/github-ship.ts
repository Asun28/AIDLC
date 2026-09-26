/**
 * Native GitHub ship path for repositories without the PowerShell scaffold.
 *
 * Mirrors the scaffold chain: commit -> require a fresh candidate-bound verdict written by the reviewer role at
 * `<worktree>/.review/<branch>.json` -> read-only PR reconciliation (a merged PR for the branch ends the ship here,
 * retained identity is reused later) -> base sync (fetch the base and test the merge; a conflict is left in the
 * worktree for the merge-conflicts skill and fails the ship with git's own diagnostic, published only once
 * `MERGE_HEAD` proves the merge is in progress; local mode first checks that the main checkout has the base checked
 * out) -> push -> PR -> CI check runs green (required names present, every reported check green; the gate lines
 * carry the check runs as JSON with encoded names) -> squash merge matching the head commit -> merge token. Every
 * step prints a scaffold-style sentinel so `classifyShipOutput` can classify the outcome uniformly.
 * Authentication failure never silently becomes local mode.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runSync, type ExecReceipt, type SyncRunner } from '../probes/exec.ts';
import { GitProbe } from '../probes/git.ts';
import { GhProbe, type CheckRun, type JobStep } from '../probes/gh.ts';
import { parseVerdict } from '../core/review-policy.ts';
import { classifyShipOutput, type ShipPath, type ShipRequest, type ShipResult } from './ship.ts';
import { PrInfo, type Verdict } from '../core/types.ts';

export interface GitHubShipOptions {
  mainRoot: string;
  worktreeRoot: string;
  /** owner/repo */
  repository: string;
  runner?: SyncRunner;
  /** Check-run names that must be present and conclude success before the merge; an absent name is pending, never satisfied, and skipped or neutral never satisfies a required name. Every other check that reports on the head must succeed as well. */
  requiredChecks?: string[];
  ciTimeoutMs?: number;
  ciPollMs?: number;
  /** Sleep function for polling (injectable for tests). */
  sleep?: (ms: number) => void;
  /** Whether a verdict is required before merge (default true). False tolerates a missing or stale verdict only; a block verdict for the head always fails the ship. */
  requireVerdict?: boolean;
}

/**
 * Untrusted text on the ship output (check names in the gate lines, git's lines and paths from the base sync) travels
 * with brackets and percent signs encoded, so it can never form a sentinel or a `[SAGA-RESUME]` marker; everything
 * else stays verbatim. `gateChecks` in core/ci-policy decodes the check names.
 */
function encodeUntrusted(text: string): string {
  return text.replace(/%/g, '%25').replace(/\[/g, '%5B').replace(/\]/g, '%5D');
}

/** Git's non-empty output lines, each encoded as untrusted text, so every message keeps its own line on the ship output and none can carry a marker. */
function lines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.trim() !== '').map(encodeUntrusted);
}

/** The repository, run and job a GitHub Actions check run's details URL names (T0-CI-RED-LOGS). */
const ACTIONS_JOB = /^https:\/\/github\.com\/([^/\s]+\/[^/\s?#]+)\/actions\/runs\/(\d+)\/job\/(\d+)(?:[?#]\S*)?$/;
const CI_LOG_JOBS = 3;
const CI_LOG_LINES = 60;
const CI_LOG_WIDTH = 240;

/** The start of the second an ISO time falls in, in milliseconds; undefined when it is not a time. */
function secondOf(iso: string | null | undefined): number | undefined {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000) * 1000;
}

/**
 * The failed step of an Actions job log as ship output lines (T0-CI-RED-LOGS-2), bounded by the job record and never by
 * a group title of the log: the first step whose conclusion is `failure` gives the window from the start of its
 * `started_at` second to the end of its `completed_at` second (a line without a timestamp takes the time of the line
 * before it); the step starts at its own header, the one line in its first second that reads `##[group]<step name>`,
 * which only a step named after its command (`Run <command>`) prints, or at the window start for step 1 (`Set up job`,
 * which prints none); it ends before the last `##[error]Process completed with exit code N.` line in the window, or at
 * the window end. The lines lose the byte order mark, the timestamps and the colour codes, every other
 * control character (tab, C1 and the Unicode line and paragraph separators included) becomes a space, and the last 60
 * non-empty ones are capped at 240 characters and then encoded, so no log line can carry a sentinel. Undefined when the
 * record names no failed step with a start time, or when the start is not placed that way: a start that whole-second
 * record times and one header per step cannot place is never guessed (T0-CI-RED-LOGS-2 R1, the stated limit).
 */
export function failedStepLines(log: string, steps: JobStep[]): string[] | undefined {
  const failed = steps.find((s) => s.conclusion === 'failure' && secondOf(s.started_at) !== undefined);
  if (!failed) return undefined;
  const start = secondOf(failed.started_at)!;
  const end = secondOf(failed.completed_at);
  let time = Number.NEGATIVE_INFINITY;
  const window = log
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((raw) => {
      const stamp = raw.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?/);
      if (stamp) time = Date.parse(stamp[1]!);
      return { time, text: raw.slice(stamp?.[0].length ?? 0).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ') };
    })
    .filter((l) => l.time >= start && (end === undefined || l.time < end + 1000));
  const headers = window.flatMap((l, i) => (l.time < start + 1000 && l.text.startsWith('##[group]Run ') ? [i] : []));
  const own = headers.filter((i) => window[i]!.text.trimEnd() === `##[group]${(failed.name ?? '').trimEnd()}`);
  const from = failed.number === 1 ? 0 : own.length === 1 ? own[0] : undefined;
  if (from === undefined) return undefined;
  const exit = window.findLastIndex((l) => /^##\[error\]Process completed with exit code \d+\.?\s*$/.test(l.text));
  return window
    .slice(from, exit >= from ? exit : window.length)
    .map((l) => l.text)
    .filter((l) => l.trim() !== '')
    .slice(-CI_LOG_LINES)
    .map((l) => encodeUntrusted(l.slice(0, CI_LOG_WIDTH)));
}

/** Git's non-empty output lines trimmed and joined on one line, not encoded: `fail` encodes every detail exactly once. */
function flat(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')
    .join(' | ');
}

/**
 * The conflicted paths from `git merge-tree --write-tree` output on a conflict: after the tree oid, one
 * `<mode> <object> <stage>\t<path>` line per stage up to the first blank line. Unique, in order.
 */
function conflictedPaths(stdout: string): string[] {
  const out: string[] = [];
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    if (line.trim() === '') break;
    const m = line.match(/^\d{6} [0-9a-f]{40,64} [123]\t(.+)$/);
    if (m && m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** A conflict marker line of `git checkout --conflict=diff3` output: the seven characters alone or before a space and a label. */
function isMarker(line: string, marker: '<<<<<<<' | '|||||||' | '=======' | '>>>>>>>'): boolean {
  const l = line.replace(/\r$/, '');
  return l === marker || l.startsWith(`${marker} `);
}

/**
 * The resolution of a CHANGELOG.md written by `git checkout --conflict=diff3` (card T0-BASE-SYNC-CHANGELOG), or undefined:
 * every hunk must sit in the `## Unreleased` section, have an empty base part (both sides only added lines there) and add
 * no `## ` heading; each hunk is replaced by the card's lines, then the base's, both byte for byte. Any other shape, a
 * marker out of order or outside a hunk, or a file with no hunk, resolves nothing and stays with the merge-conflicts skill.
 */
export function unionUnreleasedInsertions(text: string): string | undefined {
  const lines = text.split('\n');
  const out: string[] = [];
  const markers = ['<<<<<<<', '|||||||', '=======', '>>>>>>>'] as const;
  const anyMarker = (line: string) => markers.some((m) => isMarker(line, m));
  const heading = (line: string) => /^## /.test(line);
  let section: string | undefined;
  let hunks = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!isMarker(line, '<<<<<<<')) {
      if (anyMarker(line)) return undefined;
      if (heading(line)) section = line.trimEnd();
      out.push(line);
      continue;
    }
    if (section !== '## Unreleased') return undefined;
    // The card's side, up to the base part.
    const ours: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !isMarker(lines[j]!, '|||||||'); j += 1) {
      if (anyMarker(lines[j]!)) return undefined;
      ours.push(lines[j]!);
    }
    // The base part must be empty: the separator follows its marker at once.
    if (j + 1 >= lines.length || !isMarker(lines[j + 1]!, '=======')) return undefined;
    const theirs: string[] = [];
    for (j += 2; j < lines.length && !isMarker(lines[j]!, '>>>>>>>'); j += 1) {
      if (anyMarker(lines[j]!)) return undefined;
      theirs.push(lines[j]!);
    }
    if (j >= lines.length) return undefined;
    if ([...ours, ...theirs].some(heading)) return undefined;
    out.push(...ours, ...theirs);
    hunks += 1;
    i = j;
  }
  return hunks > 0 ? out.join('\n') : undefined;
}

function checksJson(runs: Array<{ name: string; status?: string; conclusion: string | null }>): string {
  return JSON.stringify(runs.map((r) => ({ name: encodeUntrusted(r.name), conclusion: r.conclusion ?? null, ...(r.status && r.status !== 'completed' ? { status: r.status } : {}) })))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029') // a JSON string may carry them literally; escaped, the gate line stays one line for every consumer
    .replace(/\//g, '\\/'); // escaped, a check name never forms the `runs/<id>` the card runner reads as a rerun's run (T0-CI-RED-LOGS)
}

export class GitHubShipPath implements ShipPath {
  readonly name = 'github';
  readonly options: GitHubShipOptions;
  private readonly runner: SyncRunner;
  private readonly git: GitProbe;
  private readonly gh: GhProbe;

  constructor(opts: GitHubShipOptions) {
    this.options = opts;
    this.runner = opts.runner ?? runSync;
    this.git = new GitProbe(this.runner);
    this.gh = new GhProbe(this.runner);
  }

  worktreePath(cardId: string): string {
    return path.join(this.options.worktreeRoot, cardId);
  }

  private receipt(lines: string[], exitCode: number, started: Date): ExecReceipt {
    const finished = new Date();
    return { command: 'github-ship', args: [], cwd: this.options.mainRoot, exitCode, signal: null, timedOut: false, stdout: lines.join('\n'), stderr: '', startedAt: started.toISOString(), finishedAt: finished.toISOString(), durationMs: finished.getTime() - started.getTime(), outputSha256: '' };
  }

  ship(req: ShipRequest): ShipResult {
    const started = new Date();
    const log: string[] = [];
    const wt = this.worktreePath(req.cardId);
    const resume = `aidlc card next ${req.cardId}`;
    // Every failure detail (verdict reasons, git and gh output, paths, the base name) is flattened to one line and
    // encoded exactly once here, so no detail can form a sentinel, a resume marker or a merge diagnostic; the CI gate
    // lines are the one verbatim detail (their JSON already carries encoded names and is decoded by the runner). The
    // resume command and the PR identity come from this path's own state, never from the output text.
    const fail = (sentinel: string, detail: string, prNumber?: number, opts: { verbatim?: boolean; lines?: string[] } = {}): ShipResult => {
      log.push(`${sentinel} ${opts.verbatim ? detail : encodeUntrusted(flat(detail))}`, ...(opts.lines ?? []), '[SAGA-FAIL]', `[SAGA-RESUME] ${resume}`);
      return { ...classifyShipOutput(this.receipt(log, 1, started)), resumeCommand: resume, prNumber };
    };
    if (!existsSync(wt)) return fail('[SHIP-SCOPE-CARD-ABSENT]', `worktree ${wt} missing`);
    // auth guard
    const login = this.gh.login(wt);
    if (!login) return fail('[SHIP-AUTH]', 'gh auth login required (无法确认 GitHub 账号)');
    log.push(`账号校验通过：个人账号 ${login} ✓`);
    // commit
    const add = this.runner('git', ['add', '-A'], { cwd: wt });
    if (add.exitCode !== 0) return fail('[SHIP-COMMIT-FAIL]', add.stderr);
    const staged = this.runner('git', ['diff', '--cached', '--quiet'], { cwd: wt });
    if (staged.exitCode !== 0) {
      const commit = this.runner('git', ['commit', '-m', `feat(${req.cardId}): implement to DoD green\n\nSee specs/tasks/${req.cardId}.md`], { cwd: wt });
      if (commit.exitCode !== 0) return fail('[SHIP-COMMIT-FAIL]', commit.stderr);
      log.push('[SHIP-TIME] commit');
    }
    const head = this.git.head(wt);
    // verdict (fresh, candidate-bound) before any remote effect
    const v = this.readVerdict(req.cardId);
    // A block verdict is never waived: requireVerdict false only tolerates a missing or stale verdict, not a blocking one.
    if (v.verdict?.verdict === 'block' && (!v.verdict.sha || v.verdict.sha === head)) return fail('[R3-SPEC-BLOCK]', v.verdict.reasons.join('; '));
    if (this.options.requireVerdict !== false) {
      if (!v.verdict) return fail('[R3-NO-VERDICT-JSON]', `no verdict at ${v.file}`);
      if (v.verdict.sha && v.verdict.sha !== head) return fail('[R3-STALE-VERDICT-SHA]', `verdict sha ${v.verdict.sha} != HEAD ${head}`);
    }
    // The base name, normalised exactly once: the branch the PR targets and the ref the sync fetches and tests.
    const base = req.base.replace(/^origin\//, '');
    // Read-only PR reconciliation before the sync: a branch whose PR is already merged ends here (the runner verifies
    // the merge against the PR head), so a retried candidate never starts a merge against a base that moved since.
    let prNumber: number | undefined;
    if (req.mode === 'remote') {
      let resolved: ReturnType<GhProbe['resolvePr']>;
      try {
        resolved = this.gh.resolvePr(this.options.repository, req.cardId, base, undefined, wt);
      } catch (err) {
        // A transport failure or a malformed listing is a reconciliation problem the runner records like any other
        // ship failure; an exception here would skip the operation result and the review slot.
        return fail('[SHIP-PR-BASE-UNKNOWN]', (err as Error).message);
      }
      if (resolved.problem && !resolved.pr) return fail('[SHIP-PR-BASE-UNKNOWN]', resolved.problem);
      if (resolved.pr) {
        // A syntactically valid listing can still carry an entry without a number or a state: it is trusted only once
        // it parses as a PR record, otherwise nothing is reused, synced or pushed on its account.
        const parsed = PrInfo.safeParse(resolved.pr);
        if (!parsed.success) return fail('[SHIP-PR-BASE-UNKNOWN]', `malformed PR listing entry: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'entry'} ${i.message}`).join('; ')}`);
      }
      prNumber = resolved.pr?.number;
      if (prNumber && resolved.pr?.state === 'MERGED') {
        log.push(`PR #${prNumber} already MERGED`, '[SAGA-DONE]');
        return { ...classifyShipOutput(this.receipt(log, 0, started)), resumeCommand: undefined, prNumber };
      }
    }
    // Base sync before any remote effect or local merge: the reviewed head must merge cleanly into the base it targets.
    const sync = this.baseSync(req.mode, base, wt, head, log);
    if (sync) return fail(sync.sentinel, sync.detail, prNumber);
    if (req.mode === 'local') {
      const merge = this.runner('git', ['merge', '--no-ff', '--no-edit', req.cardId], { cwd: this.options.mainRoot });
      if (merge.exitCode !== 0) return fail('[SHIP-LOCAL-MERGE-FAIL]', merge.stderr);
      this.writeToken(req.cardId, `tip=${head}\nmerged=${this.git.head(this.options.mainRoot)}\nutc=${new Date().toISOString()}`);
      log.push('[SAGA-DONE] local merge');
      return { ...classifyShipOutput(this.receipt(log, 0, started)), resumeCommand: undefined, prNumber: undefined };
    }
    // push + PR
    const push = this.runner('git', ['push', '-u', 'origin', req.cardId], { cwd: wt });
    if (push.exitCode !== 0) return fail('[SHIP-PUSH-FAIL]', push.stderr, prNumber);
    if (!prNumber) {
      const create = this.runner('gh', ['pr', 'create', '--repo', this.options.repository, '--base', base, '--head', req.cardId, '--title', `feat: [${req.cardId}]`, '--body', `Closed loop: worktree + TDD + independent review. DoD in specs/tasks/${req.cardId}.md.`], { cwd: wt });
      if (create.exitCode !== 0) return fail('[SHIP-PR-NUMBER-FAIL]', create.stderr);
      prNumber = Number(create.stdout.match(/\/pull\/(\d+)/)?.[1]);
      if (!prNumber) return fail('[SHIP-PR-NUMBER-FAIL]', create.stdout);
    }
    log.push(`PR #${prNumber}`);
    // CI gate
    const timeout = this.options.ciTimeoutMs ?? 30 * 60 * 1000;
    const poll = this.options.ciPollMs ?? 20_000;
    const sleep = this.options.sleep ?? ((ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms));
    const deadline = Date.now() + timeout;
    for (;;) {
      const runs = this.gh.checkRuns(this.options.repository, head, wt);
      // Required names must be present and green: an absent one is pending until the timeout. Every reported check must succeed.
      const required = this.options.requiredChecks ?? [];
      const absent = required.filter((name) => !runs.some((r) => r.name === name));
      const pending = [...runs.filter((r) => r.status !== 'completed'), ...absent.map((name) => ({ name, status: 'absent', conclusion: null }))];
      // A required name must conclude success: skipped or neutral never satisfies it. Any other reported check may be neutral or skipped.
      const green = (r: { name: string; conclusion: string | null }): boolean => {
        const c = (r.conclusion ?? '').toLowerCase();
        return required.includes(r.name) ? c === 'success' : ['success', 'neutral', 'skipped'].includes(c);
      };
      const failed = runs.filter((r) => r.status === 'completed' && !green(r));
      if (failed.length) return fail('[CI-GATE-RED]', checksJson(failed), prNumber, { verbatim: true, lines: this.ciLogLines(failed, wt) });
      if (!pending.length && runs.length > 0) break;
      if (Date.now() > deadline) return fail('[CI-GATE-TIMEOUT]', `${pending.length} pending checks: ${checksJson(pending)}`, prNumber, { verbatim: true });
      log.push(`[CI-GATE-WAIT] ${pending.length} pending: ${checksJson(pending)}`);
      sleep(poll);
    }
    log.push('[CI-GATE-PASS]');
    const merge = this.runner('gh', ['pr', 'merge', String(prNumber), '--repo', this.options.repository, '--squash', '--match-head-commit', head], { cwd: wt });
    if (merge.exitCode !== 0) return fail('[SHIP-MERGE-FAIL]', merge.stderr, prNumber);
    const view = this.gh.prView(this.options.repository, prNumber, wt);
    if (view.state !== 'MERGED') return fail('[SHIP-MERGE-FAIL]', `PR #${prNumber} state ${view.state} after merge`, prNumber);
    this.writeToken(req.cardId, `tip=${head}\nmerged_pr=#${prNumber}\nutc=${new Date().toISOString()}`);
    log.push('[SAGA-DONE]');
    return { ...classifyShipOutput(this.receipt(log, 0, started)), prNumber };
  }

  /**
   * Base sync (T0-SHIP-BASE-SYNC). `base` is the branch name normalised once by the caller (the PR target). Remote
   * mode fetches it into `refs/remotes/origin/<base>`; local mode takes `refs/heads/<base>`, the branch the local
   * merge targets. `git merge-tree --write-tree HEAD <ref>` (git 2.38+) then tests the merge without touching a ref or
   * the worktree: exit 0 is clean and the head stays the reviewed candidate, exit 1 is a conflict, anything else a
   * failure. On a conflict the same merge is started in the worktree without a commit, so the markers are there for
   * the merge-conflicts skill and the branch head cannot move here, and every line git printed goes on the ship
   * output (encoded, see `encodeUntrusted`): the card runner matches git's own diagnostic (`CONFLICT (...)`) to
   * return the card to BUILD. Those lines are published only once `MERGE_HEAD` proves the merge is in progress: a
   * conflict is a state git left behind, never a line of text, so an operational failure that happens to name a
   * file such as `CONFLICT (content).txt` is flattened on the failure line instead. A merge that completes although
   * merge-tree reported a conflict is aborted, and the abort receipt decides what the failure line says: restored, or
   * still mid-merge. Local mode first checks that the main checkout has `<base>` checked out, since that checkout is
   * what the local merge targets. Every failed git receipt keeps its stderr on the failure line. Git runs with
   * `LC_ALL=C` so the diagnostic is the English line the runner matches. Returns the failure to report, or undefined
   * when the chain may continue.
   */
  private baseSync(mode: 'local' | 'remote', base: string, wt: string, head: string, log: string[]): { sentinel: string; detail: string } | undefined {
    const env = { ...process.env, LC_ALL: 'C' };
    const git = (args: string[]): ExecReceipt => this.runner('git', args, { cwd: wt, env, timeoutMs: 60_000 });
    const failed = (detail: string) => ({ sentinel: '[SHIP-BASE-SYNC-FAIL]', detail });
    const ref = mode === 'remote' ? `refs/remotes/origin/${base}` : `refs/heads/${base}`;
    // Every detail returned here is flattened by `flat` and encoded once by `fail`; a configured base name or a
    // worktree path never places git's diagnostic at the start of a line. The command arguments stay raw.
    if (mode === 'remote') {
      const fetch = git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${base}:${ref}`]);
      if (fetch.exitCode !== 0) return failed(`fetch of origin/${base} failed: ${flat(fetch.stderr)}`);
    } else {
      // The full symbolic ref, never the short name: under a tag named like the branch the short form is ambiguous.
      const checkout = this.runner('git', ['symbolic-ref', '--quiet', 'HEAD'], { cwd: this.options.mainRoot, env, timeoutMs: 60_000 });
      const current = checkout.exitCode === 0 ? checkout.stdout.trim() : '';
      if (current !== ref) return failed(`main checkout has ${current || 'a detached HEAD'} checked out, not ${ref}${checkout.stderr.trim() ? `: ${flat(checkout.stderr)}` : ''}`);
    }
    const resolve = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    const oid = resolve.stdout.trim();
    if (resolve.exitCode !== 0 || !oid) return failed(`base ${ref} does not resolve to a commit${resolve.stderr.trim() ? `: ${flat(resolve.stderr)}` : ''}`);
    const test = git(['merge-tree', '--write-tree', 'HEAD', ref]);
    if (test.exitCode === 0) {
      log.push(encodeUntrusted(flat(`base sync: ${ref} (${oid}) merges cleanly into HEAD ${head}`)));
      return undefined;
    }
    if (test.exitCode !== 1) return failed(`merge-tree exit ${test.exitCode}: ${flat(test.stderr)}`);
    const paths = conflictedPaths(test.stdout).map(flat).join(', ') || 'unnamed paths';
    const merge = git(['merge', '--no-ff', '--no-commit', ref]);
    if (merge.exitCode === 0) {
      const abort = git(['merge', '--abort']);
      if (abort.exitCode !== 0) return failed(`merge-tree reported a conflict in ${paths} but the merge completed and the abort failed (${flat(abort.stderr)}); the index and worktree ${wt} still carry the merge, HEAD ${head} unchanged: run git merge --abort by hand before the next ship`);
      return failed(`merge-tree reported a conflict in ${paths} but the merge completed; aborted, HEAD ${head} unchanged`);
    }
    const inProgress = git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).exitCode === 0;
    if (merge.exitCode !== 1 || !inProgress) {
      return failed(`merge exit ${merge.exitCode}: ${flat(`${merge.stdout}\n${merge.stderr}`)}${inProgress ? `; the index and worktree ${wt} still carry the merge, HEAD ${head} unchanged: run git merge --abort by hand before the next ship` : ''}`);
    }
    log.push(...lines(merge.stdout), ...lines(merge.stderr));
    const merged = this.mergeChangelog(git, wt, ref, head, log);
    if (merged) return merged;
    return { sentinel: '[SHIP-BASE-SYNC-CONFLICT]', detail: `${ref} conflicts with HEAD ${head} in ${paths}; the merge is left in ${wt} for the merge-conflicts skill` };
  }

  /**
   * A conflict whose only unmerged path is CHANGELOG.md and whose every hunk is lines both sides added to `## Unreleased`
   * (card T0-BASE-SYNC-CHANGELOG): the file is rewritten with the diff3 base part, resolved by keeping both sides, staged
   * and committed as the merge, and the ship ends there with `[SHIP-BASE-SYNC-MERGED]`: the merge is a new candidate that
   * the DoD, R2 and R3 judge anew, never shipped on the reviews of the head it replaces. Undefined leaves the merge, and
   * the file as git wrote it, to the merge-conflicts skill.
   */
  private mergeChangelog(git: (args: string[]) => ExecReceipt, wt: string, ref: string, head: string, log: string[]): { sentinel: string; detail: string } | undefined {
    const unmerged = git(['diff', '--name-only', '--diff-filter=U', '-z']);
    if (unmerged.exitCode !== 0) return undefined;
    const paths = unmerged.stdout.split('\u0000').filter((p) => p.length > 0);
    if (paths.length !== 1 || paths[0] !== 'CHANGELOG.md') return undefined;
    const file = path.join(wt, 'CHANGELOG.md');
    let before: string;
    try {
      before = readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
    if (git(['checkout', '--conflict=diff3', '--', 'CHANGELOG.md']).exitCode !== 0) return undefined;
    let resolved: string | undefined;
    try {
      resolved = unionUnreleasedInsertions(readFileSync(file, 'utf8'));
    } catch {
      resolved = undefined;
    }
    // A write that throws (a locked file, EACCES, a full disk) must end as a failure the runner records: `ship` is called
    // without a catch, and an exception would leave the ship operation without a result.
    const write = (text: string): string | undefined => {
      try {
        writeFileSync(file, text, 'utf8');
        return undefined;
      } catch (err) {
        return (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
      }
    };
    if (resolved === undefined) {
      // Not this shape: the file goes back to the markers the merge wrote, for the skill.
      const code = write(before);
      if (code) return { sentinel: '[SHIP-BASE-SYNC-FAIL]', detail: `restoring CHANGELOG.md as the merge wrote it failed in ${wt} (${code}): the file may carry the diff3 markers instead; the merge is still in progress, HEAD ${head} unchanged` };
      return undefined;
    }
    const code = write(resolved);
    if (code) return { sentinel: '[SHIP-BASE-SYNC-FAIL]', detail: `writing the CHANGELOG.md resolution failed in ${wt} (${code}); the merge is still in progress with its conflict, HEAD ${head} unchanged` };
    const failed = (step: string, r: ExecReceipt) => ({ sentinel: '[SHIP-BASE-SYNC-FAIL]', detail: `${step} of the CHANGELOG.md merge failed in ${wt} (exit ${r.exitCode}): ${flat(r.stderr || r.stdout)}; the resolution is written and the merge is still in progress, HEAD ${head} unchanged` });
    const add = git(['add', '--', 'CHANGELOG.md']);
    if (add.exitCode !== 0) return failed('git add', add);
    const message = `Merge ${ref} into HEAD ${head}: CHANGELOG.md Unreleased keeps the entries both sides added, the card's first (base sync, card T0-BASE-SYNC-CHANGELOG)`;
    const commit = git(['commit', '-m', message]);
    if (commit.exitCode !== 0) return failed('git commit', commit);
    const sha = git(['rev-parse', '--verify', 'HEAD']);
    const mergeSha = sha.exitCode === 0 ? sha.stdout.trim() : '';
    if (!mergeSha) return { sentinel: '[SHIP-BASE-SYNC-FAIL]', detail: `the CHANGELOG.md merge is committed in ${wt} but the merge commit could not be read back (exit ${sha.exitCode}): ${flat(sha.stderr) || 'no output'}; record the worktree HEAD by hand` };
    log.push(encodeUntrusted(flat(`base sync: CHANGELOG.md resolved by keeping the entries both sides added to Unreleased; merge ${mergeSha}`)));
    return { sentinel: '[SHIP-BASE-SYNC-MERGED]', detail: `${ref} conflicted with HEAD ${head} only in entries both sides added to the Unreleased section of CHANGELOG.md; merged by keeping both, the card's first, as ${mergeSha}: a new candidate, not shipped; run the DoD on it and record it as the next attempt` };
  }

  /**
   * The `[CI-GATE-LOG]` lines of a red gate (T0-CI-RED-LOGS-2): for each red check run that is an Actions job of the
   * configured repository (app `github-actions`, a details URL naming this repository's run and job, the job id being the
   * check run's own), at most three in gate order, a header built from the run and job ids alone (so the first
   * `runs/<id>` on the output is the job's run), then the failed step of its log as the job record bounds it; `log
   * unavailable` when the record or the log cannot be read, `step unknown` when the record places no failed step. Neither
   * note holds a word the CI classifier reads as evidence. Any other red check run gets no line and nothing read.
   */
  private ciLogLines(failed: CheckRun[], wt: string): string[] {
    const repository = this.options.repository.toLowerCase();
    const jobs = failed.flatMap((r) => {
      const m = (r.details_url ?? '').match(ACTIONS_JOB);
      if (!m || r.app?.slug !== 'github-actions' || m[1]!.toLowerCase() !== repository || String(r.id) !== m[3]) return [];
      return [{ run: m[2]!, job: m[3]! }];
    });
    return jobs.slice(0, CI_LOG_JOBS).flatMap(({ run, job }) => {
      const header = `[CI-GATE-LOG] actions/runs/${run}/job/${job}`;
      const record = this.gh.jobRecord(this.options.repository, job, wt);
      const text = this.gh.jobLog(this.options.repository, job, wt);
      if (!record || text === undefined) return [`${header} log unavailable`];
      const step = failedStepLines(text, record.steps);
      return step ? [header, ...step] : [`${header} step unknown`];
    });
  }

  private tokenFile(cardId: string): string {
    return path.join(this.options.mainRoot, '.git', 'scaffold-merged', cardId);
  }

  private writeToken(cardId: string, content: string): void {
    const f = this.tokenFile(cardId);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, content, 'utf8');
  }

  readVerdict(cardId: string): { verdict?: Verdict; raw?: string; file?: string; rounds?: number } {
    const file = path.join(this.worktreePath(cardId), '.review', `${cardId.replace(/[\\/]/g, '-')}.json`);
    if (!existsSync(file)) return { file };
    const raw = readFileSync(file, 'utf8');
    try {
      return { verdict: parseVerdict(JSON.parse(raw)), raw, file };
    } catch {
      return { raw, file };
    }
  }

  readMergeToken(cardId: string): { tip?: string; mergedPr?: number; merged?: string; utc?: string } | undefined {
    const f = this.tokenFile(cardId);
    if (!existsSync(f)) return undefined;
    const out: { tip?: string; mergedPr?: number; merged?: string; utc?: string } = {};
    for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
      const [k, v] = line.split('=', 2);
      if (!k || v === undefined) continue;
      if (k === 'tip') out.tip = v.trim();
      else if (k === 'merged_pr') out.mergedPr = Number(v.replace('#', '').trim());
      else if (k === 'merged') out.merged = v.trim();
      else if (k === 'utc') out.utc = v.trim();
    }
    return out;
  }
}
