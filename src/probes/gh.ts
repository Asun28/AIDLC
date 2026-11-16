/**
 * GitHub CLI probes (plan v5 §5 probe table).
 *
 * PR identity is retained exactly; ambiguous / retargeted / closed-unmerged is never a new
 * start. Result pages are paginated. CI reruns inspect the actual attempt before repeating a
 * lost-response rerun.
 */
import { z } from 'zod';
import { runSync, type ExecReceipt, type SyncRunner } from './exec.ts';
import type { PrInfo } from '../core/types.ts';

export interface PrListEntry {
  number: number;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  headRefOid: string;
  baseRefName: string;
  mergedAt?: string | null;
  url?: string;
}

export interface RunView {
  databaseId: number;
  attempt: number;
  status: string;
  conclusion: string | null;
  headSha: string;
  url?: string;
  jobs: Array<{ name: string; status: string; conclusion: string | null }>;
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  /** For a GitHub Actions job: the job id. */
  id?: number;
  /** For a GitHub Actions job: `github-actions`. */
  app?: { slug?: string } | null;
  /** For a GitHub Actions job: `https://github.com/<repository>/actions/runs/<run>/job/<job>`. */
  details_url?: string | null;
}

/** One step of a GitHub Actions job record. */
export interface JobStep {
  number: number;
  name?: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

function isJobStep(value: unknown): value is JobStep {
  if (value === null || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  // A time is present as a string or null (T0-CI-RED-LOGS-BOUNDS: an absent key is a malformed step).
  const time = (t: unknown) => t === null || typeof t === 'string';
  return typeof s['number'] === 'number' && Number.isFinite(s['number']) && (s['conclusion'] === null || typeof s['conclusion'] === 'string') && time(s['started_at']) && time(s['completed_at']) && (s['name'] === undefined || typeof s['name'] === 'string');
}

/** The values GitHub defines for a PR's `mergeable` and `mergeStateStatus` (T0-SHIP-MERGE-REFUSED). */
export const MERGEABLE = ['MERGEABLE', 'CONFLICTING', 'UNKNOWN'] as const;
export type Mergeable = (typeof MERGEABLE)[number];
export const MERGE_STATE_STATUS = ['BEHIND', 'BLOCKED', 'CLEAN', 'DIRTY', 'DRAFT', 'HAS_HOOKS', 'UNKNOWN', 'UNSTABLE'] as const;
export type MergeStateStatus = (typeof MERGE_STATE_STATUS)[number];

/** One page of `GET /repos/<repo>/issues` (T1-GH-ISSUES, T1-REVIEW-FOLLOWUP-ISSUE): pull requests carry `pull_request`; an empty body is null. */
const IssuePageSchema = z.array(z.object({ number: z.number().int(), body: z.string().nullable(), pull_request: z.unknown().optional() }));
export interface IssueEntry {
  number: number;
  body: string;
}
/** Pages of 100 read before `issuesWithLabel` gives up rather than return a partial list. */
const ISSUE_PAGES_MAX = 1000;

export class GhProbe {
  readonly runner: SyncRunner;

  constructor(runner: SyncRunner = runSync) {
    this.runner = runner;
  }

  private gh(args: string[], cwd?: string): ExecReceipt {
    return this.runner('gh', args, { cwd, timeoutMs: 120_000 });
  }

  private json<T>(args: string[], cwd?: string): T {
    const r = this.gh(args, cwd);
    if (r.exitCode !== 0) throw new GhProbeError(args, r);
    try {
      return JSON.parse(r.stdout) as T;
    } catch (err) {
      throw new GhProbeError(args, r, `malformed JSON: ${(err as Error).message}`);
    }
  }

  /** All PRs for head/base, paginated (limit 100 with a full-page check). */
  prsForBranch(repo: string, head: string, base: string, cwd?: string): PrListEntry[] {
    const limit = 100;
    const list = this.json<PrListEntry[]>(['pr', 'list', '--repo', repo, '--state', 'all', '--head', head, '--base', base, '--json', 'number,state,headRefOid,baseRefName,mergedAt,url', '--limit', String(limit)], cwd);
    if (list.length >= limit) {
      // Full page: use a search-based query to make sure nothing was cut off.
      const more = this.json<PrListEntry[]>(['pr', 'list', '--repo', repo, '--state', 'all', '--search', `head:${head} base:${base}`, '--json', 'number,state,headRefOid,baseRefName,mergedAt,url', '--limit', '500'], cwd);
      const seen = new Set(list.map((p) => p.number));
      for (const p of more) if (!seen.has(p.number)) list.push(p);
    }
    return list;
  }

  /** Resolve the retained PR identity or report why a new start is not allowed. */
  resolvePr(repo: string, head: string, base: string, retainedNumber?: number, cwd?: string): { pr?: PrInfo; problem?: string } {
    const prs = this.prsForBranch(repo, head, base, cwd);
    if (retainedNumber !== undefined) {
      const view = this.prView(repo, retainedNumber, cwd);
      if (view.baseRefName && view.baseRefName !== base) return { pr: view, problem: `retained PR #${retainedNumber} retargeted to ${view.baseRefName}` };
      return { pr: view };
    }
    if (prs.length === 0) return {};
    const open = prs.filter((p) => p.state === 'OPEN');
    const merged = prs.filter((p) => p.state === 'MERGED');
    if (open.length > 1) return { problem: `multiple open PRs for ${head}: ${open.map((p) => p.number).join(',')}` };
    if (open.length === 1) return { pr: toPrInfo(open[0]!) };
    if (merged.length === 1) return { pr: toPrInfo(merged[0]!) };
    if (merged.length > 1) return { problem: `multiple merged PRs for ${head}` };
    return { pr: toPrInfo(prs[0]!), problem: `PR #${prs[0]!.number} for ${head} is closed without merge; not a new start` };
  }

  prView(repo: string, number: number, cwd?: string): PrInfo {
    const v = this.json<{ number: number; state: 'OPEN' | 'MERGED' | 'CLOSED'; mergedAt?: string | null; headRefOid?: string; baseRefName?: string; mergeCommit?: { oid: string } | null; url?: string }>(
      ['pr', 'view', String(number), '--repo', repo, '--json', 'number,state,mergedAt,headRefOid,baseRefName,mergeCommit,url'],
      cwd,
    );
    return { number: v.number, url: v.url, state: v.state, headRefOid: v.headRefOid, baseRefName: v.baseRefName, mergedAt: v.mergedAt ?? undefined, mergeCommit: v.mergeCommit?.oid };
  }

  /**
   * `gh pr view <pr> --json number,state,mergeCommit,headRefOid` as GitHub printed it, no field checked, so an absent field stays
   * apart from an explicit null (card T1-AUDIT-FACTS-2). Throws when gh fails or the JSON is malformed.
   */
  prFacts(repo: string, number: number, cwd?: string): Record<string, unknown> | null {
    return this.json<Record<string, unknown> | null>(['pr', 'view', String(number), '--repo', repo, '--json', 'number,state,mergeCommit,headRefOid'], cwd);
  }

  /**
   * The merge state GitHub reports for a PR (T0-SHIP-MERGE-REFUSED): `mergeable` and `mergeStateStatus` from the JSON
   * only, each kept only when it is a value GitHub defines, else undefined. Throws when gh fails or the JSON is malformed.
   */
  prMergeState(repo: string, number: number, cwd?: string): { mergeable?: Mergeable; mergeStateStatus?: MergeStateStatus } {
    const v = this.json<{ mergeable?: unknown; mergeStateStatus?: unknown } | null>(['pr', 'view', String(number), '--repo', repo, '--json', 'mergeable,mergeStateStatus'], cwd);
    const pick = <T extends string>(allowed: readonly T[], x: unknown): T | undefined => (typeof x === 'string' && (allowed as readonly string[]).includes(x) ? (x as T) : undefined);
    return { mergeable: pick(MERGEABLE, v?.mergeable), mergeStateStatus: pick(MERGE_STATE_STATUS, v?.mergeStateStatus) };
  }

  runView(repo: string, runId: string, cwd?: string): RunView {
    return this.json<RunView>(['run', 'view', runId, '--repo', repo, '--json', 'databaseId,attempt,status,conclusion,headSha,jobs,url'], cwd);
  }

  /** Check runs for a commit (paginated, up to 50 pages like the scaffold's CI gate). */
  checkRuns(repo: string, sha: string, cwd?: string): CheckRun[] {
    const out: CheckRun[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const res = this.json<{ check_runs?: CheckRun[] }>(['api', `repos/${repo}/commits/${sha}/check-runs?per_page=100&page=${page}`], cwd);
      const runs = res.check_runs ?? [];
      out.push(...runs);
      if (runs.length < 100) break;
    }
    return out;
  }

  /**
   * The steps of one GitHub Actions job (numbers, conclusions, times truncated to the second), or undefined when the record
   * cannot be read: the command fails, the output is not JSON, or a step is not an object with a numeric number, a string
   * or null conclusion, string or null times and a string name when it has one.
   */
  jobRecord(repo: string, jobId: string, cwd?: string): { steps: JobStep[] } | undefined {
    const r = this.gh(['api', `repos/${repo}/actions/jobs/${jobId}`], cwd);
    if (r.exitCode !== 0 || r.timedOut) return undefined;
    try {
      const steps = (JSON.parse(r.stdout) as { steps?: unknown }).steps;
      if (steps === undefined) return { steps: [] };
      return Array.isArray(steps) && steps.every(isJobStep) ? { steps } : undefined;
    } catch {
      return undefined;
    }
  }

  /** The raw log of one GitHub Actions job, or undefined when it cannot be read (expired, missing, unfinished, no access). */
  jobLog(repo: string, jobId: string, cwd?: string): string | undefined {
    const r = this.gh(['api', `repos/${repo}/actions/jobs/${jobId}/logs`], cwd);
    return r.exitCode === 0 && !r.timedOut ? r.stdout : undefined;
  }

  /**
   * Every issue that carries `label`, open or closed, read page by page until a short page (listed by label, not by
   * search, so a new issue is seen at once); pull requests are left out. Throws on a failed call, output that does not
   * parse, or more than ISSUE_PAGES_MAX full pages, never returning a partial list.
   */
  issuesWithLabel(repo: string, label: string, cwd?: string): IssueEntry[] {
    const out: IssueEntry[] = [];
    for (let page = 1; page <= ISSUE_PAGES_MAX; page += 1) {
      const args = ['api', `repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=all&per_page=100&page=${page}`];
      const r = this.gh(args, cwd);
      if (r.exitCode !== 0 || r.timedOut) throw new GhProbeError(args, r);
      let raw: unknown;
      try {
        raw = JSON.parse(r.stdout);
      } catch (err) {
        throw new GhProbeError(args, r, `malformed JSON: ${(err as Error).message}`);
      }
      const parsed = IssuePageSchema.safeParse(raw);
      if (!parsed.success) throw new GhProbeError(args, r, `unexpected issue list: ${parsed.error.message}`);
      for (const i of parsed.data) if (i.pull_request === undefined) out.push({ number: i.number, body: i.body ?? '' });
      if (parsed.data.length < 100) return out;
    }
    throw new Error(`gh api repos/${repo}/issues: more than ${ISSUE_PAGES_MAX} pages of issues labelled ${label}; the list would be partial`);
  }

  /**
   * Creates (or updates) `label`, then an issue with that label and `body` on stdin; returns the issue number from the
   * URL gh prints last. Throws, naming the call, on a failed call or stdout whose last line is not an issue URL of `repo`.
   */
  createIssue(repo: string, title: string, body: string, label: string, cwd?: string): number {
    const labelArgs = ['label', 'create', label, '--repo', repo, '--force', '--description', 'aidlc review follow-ups'];
    const l = this.gh(labelArgs, cwd);
    if (l.exitCode !== 0 || l.timedOut) throw new GhProbeError(labelArgs, l);
    const issueArgs = ['issue', 'create', '--repo', repo, '--title', title, '--label', label, '--body-file', '-'];
    const r = this.runner('gh', issueArgs, { cwd, timeoutMs: 120_000, input: body });
    if (r.exitCode !== 0 || r.timedOut) throw new GhProbeError(issueArgs, r);
    const last = r.stdout.trimEnd().split('\n').pop()?.trim() ?? '';
    const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(last);
    if (!m || m[1]!.toLowerCase() !== repo.toLowerCase()) throw new GhProbeError(issueArgs, r, `no issue URL of ${repo} on the last line of stdout`);
    return Number(m[2]);
  }

  rerunFailed(repo: string, runId: string, cwd?: string): ExecReceipt {
    return this.gh(['run', 'rerun', runId, '--repo', repo, '--failed'], cwd);
  }

  login(cwd?: string): string | undefined {
    const r = this.runner('gh', ['api', 'user', '-q', '.login'], { cwd, timeoutMs: 60_000, env: { ...process.env, GH_TOKEN: '', GITHUB_TOKEN: '' } });
    return r.exitCode === 0 ? r.stdout.trim() : undefined;
  }
}

function toPrInfo(p: PrListEntry): PrInfo {
  return { number: p.number, url: p.url, state: p.state, headRefOid: p.headRefOid, baseRefName: p.baseRefName, mergedAt: p.mergedAt ?? undefined };
}

export class GhProbeError extends Error {
  readonly receipt: ExecReceipt;
  constructor(args: string[], receipt: ExecReceipt, extra?: string) {
    super(`gh ${args.join(' ')} failed (exit ${receipt.exitCode}): ${extra ?? receipt.stderr.trim() ?? receipt.stdout.trim()}`);
    this.receipt = receipt;
  }
}
