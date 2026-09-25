/**
 * Git evidence probes (plan v5 §5 probe table).
 *
 * - Worktree/owner: `git worktree list --porcelain`; a directory name alone never establishes
 *   ownership.
 * - Candidate: HEAD + `git status --porcelain=v1 --untracked-files=all`; dirty/untracked inputs
 *   require more than a commit SHA.
 * - Base: explicit refresh and `git rev-list --left-right --count <base>...HEAD`.
 */
import { createHash } from 'node:crypto';
import path from 'node:path';
import { runSync, type ExecReceipt, type SyncRunner } from './exec.ts';

export interface WorktreeEntry {
  path: string;
  head?: string;
  branch?: string;
  bare?: boolean;
  detached?: boolean;
  locked?: boolean;
  prunable?: boolean;
}

export class GitProbe {
  readonly runner: SyncRunner;

  constructor(runner: SyncRunner = runSync) {
    this.runner = runner;
  }

  private git(cwd: string, args: string[]): ExecReceipt {
    return this.runner('git', args, { cwd, timeoutMs: 60_000 });
  }

  private must(cwd: string, args: string[]): string {
    const r = this.git(cwd, args);
    if (r.exitCode !== 0) throw new GitProbeError(args, r);
    return r.stdout.trim();
  }

  worktrees(cwd: string): WorktreeEntry[] {
    const out = this.must(cwd, ['worktree', 'list', '--porcelain']);
    const entries: WorktreeEntry[] = [];
    let current: WorktreeEntry | undefined;
    for (const line of out.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) {
        current = { path: path.resolve(line.slice(9).trim()) };
        entries.push(current);
      } else if (!current) continue;
      else if (line.startsWith('HEAD ')) current.head = line.slice(5).trim();
      else if (line.startsWith('branch ')) current.branch = line.slice(7).trim().replace(/^refs\/heads\//, '');
      else if (line === 'bare') current.bare = true;
      else if (line === 'detached') current.detached = true;
      else if (line.startsWith('locked')) current.locked = true;
      else if (line.startsWith('prunable')) current.prunable = true;
    }
    return entries;
  }

  /** Exact branch-ref and canonical path match; common dir must match the main checkout. */
  findWorktree(mainRoot: string, branch: string, expectedPath?: string): { entry?: WorktreeEntry; mismatch?: string } {
    const entries = this.worktrees(mainRoot);
    const byBranch = entries.filter((e) => e.branch === branch);
    if (byBranch.length === 0) return {};
    if (byBranch.length > 1) return { mismatch: `branch ${branch} is checked out in ${byBranch.length} worktrees` };
    const entry = byBranch[0]!;
    if (expectedPath && path.resolve(expectedPath).toLowerCase() !== entry.path.toLowerCase()) {
      return { entry, mismatch: `worktree for ${branch} is at ${entry.path}, expected ${path.resolve(expectedPath)}` };
    }
    return { entry };
  }

  head(cwd: string): string {
    return this.must(cwd, ['rev-parse', '--verify', 'HEAD']);
  }

  currentBranch(cwd: string): string | undefined {
    const r = this.git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    return r.exitCode === 0 ? r.stdout.trim() : undefined;
  }

  /** The git identity of the repository (card T0-APPROVER-IDENTITY): `user.email`, else `user.name`; a failed or blank read is unset. */
  userIdentity(cwd: string): string | undefined {
    for (const key of ['user.email', 'user.name']) {
      const r = this.git(cwd, ['config', key]);
      const value = r.exitCode === 0 ? r.stdout.trim() : '';
      if (value) return value;
    }
    return undefined;
  }

  status(cwd: string): { dirty: boolean; entries: string[]; untracked: string[] } {
    const out = this.must(cwd, ['status', '--porcelain=v1', '--untracked-files=all']);
    const entries = out.split(/\r?\n/).filter((l) => l.length > 0);
    const untracked = entries.filter((l) => l.startsWith('??')).map((l) => l.slice(3));
    return { dirty: entries.length > 0, entries, untracked };
  }

  /** Candidate digest binds HEAD to the working-tree status and any relevant input manifest. */
  candidate(cwd: string, inputManifest: string[] = []): { sha: string; dirty: boolean; untracked: string[]; digest: string } {
    const sha = this.head(cwd);
    const st = this.status(cwd);
    const h = createHash('sha256').update(sha);
    for (const e of st.entries) h.update('\n' + e);
    for (const m of inputManifest) h.update('\nin:' + m);
    return { sha, dirty: st.dirty, untracked: st.untracked, digest: h.digest('hex') };
  }

  /** Resolve a fully-qualified base ref (remote first, then local), verified as a commit. */
  resolveBase(cwd: string, baseName: string, preferLocal = false): { ref: string; oid: string } | undefined {
    const name = baseName.replace(/^origin\//, '');
    const candidates = baseName.startsWith('origin/')
      ? [`refs/remotes/origin/${name}`]
      : preferLocal
        ? [`refs/heads/${name}`, `refs/remotes/origin/${name}`]
        : [`refs/remotes/origin/${name}`, `refs/heads/${name}`];
    for (const ref of candidates) {
      const r = this.git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
      if (r.exitCode === 0 && r.stdout.trim()) return { ref, oid: r.stdout.trim() };
    }
    return undefined;
  }

  fetchBase(cwd: string, baseName: string): ExecReceipt {
    const name = baseName.replace(/^origin\//, '');
    return this.git(cwd, ['fetch', '--quiet', '--no-tags', 'origin', `+refs/heads/${name}:refs/remotes/origin/${name}`]);
  }

  /** `git rev-list --left-right --count <base>...HEAD` -> [behind, ahead]. */
  divergence(cwd: string, baseRef: string): { behind: number; ahead: number } {
    const out = this.must(cwd, ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`]);
    const [behind, ahead] = out.split(/\s+/).map((n) => Number(n));
    return { behind: behind ?? 0, ahead: ahead ?? 0 };
  }

  /** Whether `base` contains `sha` (merge verification on the intended base). */
  contains(cwd: string, baseRef: string, sha: string): boolean {
    const r = this.git(cwd, ['merge-base', '--is-ancestor', sha, baseRef]);
    return r.exitCode === 0;
  }

  commonDir(cwd: string): string {
    return path.resolve(cwd, this.must(cwd, ['rev-parse', '--git-common-dir']));
  }

  /**
   * The paths HEAD changes against the base. `-z`: git never quotes or escapes a name; `--no-renames`: a renamed file is
   * listed by its source and its destination. The output is split on NUL and never trimmed, since a name may start with a space.
   */
  changedPaths(cwd: string, baseOid: string): string[] {
    const args = ['diff', '--name-only', '-z', `${baseOid}...HEAD`, '--no-renames'];
    const r = this.git(cwd, args);
    if (r.exitCode !== 0) throw new GitProbeError(args, r);
    return r.stdout.split('\u0000').filter((l) => l.length > 0);
  }

  numstat(cwd: string, baseOid: string): { added: number; deleted: number; files: number } {
    const out = this.must(cwd, ['diff', '--numstat', `${baseOid}...HEAD`]);
    let added = 0;
    let deleted = 0;
    let files = 0;
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^(\d+|-)\s+(\d+|-)\s+/);
      if (!m) continue;
      files += 1;
      if (m[1] !== '-') added += Number(m[1]);
      if (m[2] !== '-') deleted += Number(m[2]);
    }
    return { added, deleted, files };
  }
}

export class GitProbeError extends Error {
  readonly receipt: ExecReceipt;
  constructor(args: string[], receipt: ExecReceipt) {
    super(`git ${args.join(' ')} failed (exit ${receipt.exitCode}): ${receipt.stderr.trim() || receipt.stdout.trim()}`);
    this.receipt = receipt;
  }
}
