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
import { GhProbe } from '../probes/gh.ts';
import { parseVerdict } from '../core/review-policy.ts';
import { classifyShipOutput, type ShipPath, type ShipRequest, type ShipResult } from './ship.ts';
import type { Verdict } from '../core/types.ts';

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

/** A failure detail on one line: git's output collapsed (each line trimmed and encoded) so the sentinel line stays one line. */
function oneLine(text: string): string {
  return lines(text).map((l) => l.trim()).join(' | ');
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

function checksJson(runs: Array<{ name: string; status?: string; conclusion: string | null }>): string {
  return JSON.stringify(runs.map((r) => ({ name: encodeUntrusted(r.name), conclusion: r.conclusion ?? null, ...(r.status && r.status !== 'completed' ? { status: r.status } : {}) })))
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029'); // a JSON string may carry them literally; escaped, the gate line stays one line for every consumer
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
    // The resume command and the PR identity come from this path's own state, never from the output text: git's
    // lines and paths on the output are encoded, but the classifier's text scan is not the producer of record.
    const fail = (sentinel: string, detail: string, prNumber?: number): ShipResult => {
      log.push(`${sentinel} ${detail}`, '[SAGA-FAIL]', `[SAGA-RESUME] ${resume}`);
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
      const resolved = this.gh.resolvePr(this.options.repository, req.cardId, base, undefined, wt);
      if (resolved.problem && !resolved.pr) return fail('[SHIP-PR-BASE-UNKNOWN]', resolved.problem);
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
      if (failed.length) return fail('[CI-GATE-RED]', checksJson(failed), prNumber);
      if (!pending.length && runs.length > 0) break;
      if (Date.now() > deadline) return fail('[CI-GATE-TIMEOUT]', `${pending.length} pending checks: ${checksJson(pending)}`, prNumber);
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
    if (mode === 'remote') {
      const fetch = git(['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${base}:${ref}`]);
      if (fetch.exitCode !== 0) return failed(`fetch of origin/${base} failed: ${oneLine(fetch.stderr)}`);
    } else {
      const checkout = this.runner('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: this.options.mainRoot, env, timeoutMs: 60_000 });
      const branch = checkout.exitCode === 0 ? checkout.stdout.trim() : '';
      if (branch !== base) return failed(`main checkout has ${branch ? encodeUntrusted(branch) : 'a detached HEAD'} checked out, not ${base}${checkout.stderr.trim() ? `: ${oneLine(checkout.stderr)}` : ''}`);
    }
    const resolve = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    const oid = resolve.stdout.trim();
    if (resolve.exitCode !== 0 || !oid) return failed(`base ${ref} does not resolve to a commit${resolve.stderr.trim() ? `: ${oneLine(resolve.stderr)}` : ''}`);
    const test = git(['merge-tree', '--write-tree', 'HEAD', ref]);
    if (test.exitCode === 0) {
      log.push(`base sync: ${ref} (${oid}) merges cleanly into HEAD ${head}`);
      return undefined;
    }
    if (test.exitCode !== 1) return failed(`merge-tree exit ${test.exitCode}: ${oneLine(test.stderr)}`);
    const paths = conflictedPaths(test.stdout).map(encodeUntrusted).join(', ') || 'unnamed paths';
    const merge = git(['merge', '--no-ff', '--no-commit', ref]);
    if (merge.exitCode === 0) {
      const abort = git(['merge', '--abort']);
      if (abort.exitCode !== 0) return failed(`merge-tree reported a conflict in ${paths} but the merge completed and the abort failed (${oneLine(abort.stderr)}); the index and worktree ${wt} still carry the merge, HEAD ${head} unchanged: run git merge --abort by hand before the next ship`);
      return failed(`merge-tree reported a conflict in ${paths} but the merge completed; aborted, HEAD ${head} unchanged`);
    }
    const inProgress = git(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']).exitCode === 0;
    if (merge.exitCode !== 1 || !inProgress) {
      const flattened = oneLine(`${merge.stdout}\n${merge.stderr}`);
      return failed(`merge exit ${merge.exitCode}: ${flattened}${inProgress ? `; the index and worktree ${wt} still carry the merge, HEAD ${head} unchanged: run git merge --abort by hand before the next ship` : ''}`);
    }
    log.push(...lines(merge.stdout), ...lines(merge.stderr));
    return { sentinel: '[SHIP-BASE-SYNC-CONFLICT]', detail: `${ref} conflicts with HEAD ${head} in ${paths}; the merge is left in ${wt} for the merge-conflicts skill` };
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
