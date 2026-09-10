/**
 * Canonical state location.
 *
 * Runtime state must live outside feature worktrees and be visible to every session that
 * works on the same repository (plan v5 MS1/MS5). For a git repository that means the main
 * checkout's directory (the parent of `git rev-parse --git-common-dir`), so every linked
 * worktree resolves to the same `.aidlc/` directory. `AIDLC_STATE_DIR` overrides it.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';

export interface StatePaths {
  root: string;
  goals: string;
  cards: string;
  journal: string;
  leases: string;
  reviewQueue: string;
  operations: string;
  evidence: string;
  board: string;
  releases: string;
  incidents: string;
}

export interface RepoIdentity {
  /** Canonical main checkout path (git common dir parent), or cwd when not a repository. */
  mainRoot: string;
  /** Worktree root for the current working directory. */
  worktreeRoot: string;
  isGit: boolean;
  /** Short stable key derived from the canonical path. */
  key: string;
}

function gitOut(args: string[], cwd: string): string | undefined {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) return undefined;
  return res.stdout.trim();
}

/**
 * Repository identity is asked for several times per CLI call (context, state paths, session id, hooks);
 * it costs one `git rev-parse` per process and cwd. The cache is per process, so a long-lived test can
 * reset it after creating a repository in a directory it already resolved.
 */
const identityCache = new Map<string, RepoIdentity>();

export function resolveRepoIdentity(cwd: string = process.cwd()): RepoIdentity {
  const key = path.resolve(cwd);
  const cached = identityCache.get(key);
  if (cached) return cached;
  // One spawn for both refs: git prints them in argument order.
  const out = gitOut(['rev-parse', '--git-common-dir', '--show-toplevel'], cwd);
  const [common, top] = out ? out.split(/\r?\n/).map((line) => line.trim()) : [];
  let identity: RepoIdentity;
  if (!common || !top) {
    identity = { mainRoot: key, worktreeRoot: key, isGit: false, key: shortKey(key) };
  } else {
    const commonAbs = canonical(path.resolve(cwd, common));
    const mainRoot = canonical(path.resolve(commonAbs, '..'));
    const worktreeRoot = canonical(path.resolve(top));
    identity = { mainRoot, worktreeRoot, isGit: true, key: shortKey(mainRoot) };
  }
  identityCache.set(key, identity);
  return identity;
}

export function resetRepoIdentityCache(): void {
  identityCache.clear();
}

/** Canonical filesystem path (resolves 8.3 short names, symlinks and drive-letter case) when it exists. */
export function canonical(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

export function shortKey(input: string): string {
  const normalised = input.replace(/\\/g, '/').toLowerCase();
  return createHash('sha256').update(normalised).digest('hex').slice(0, 16);
}

export function resolveStatePaths(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): StatePaths {
  const override = env['AIDLC_STATE_DIR'];
  const root = override ? path.resolve(override) : path.join(resolveRepoIdentity(cwd).mainRoot, '.aidlc');
  return statePathsFromRoot(root);
}

export function statePathsFromRoot(root: string): StatePaths {
  return {
    root,
    goals: path.join(root, 'goals'),
    cards: path.join(root, 'cards'),
    journal: path.join(root, 'journal'),
    leases: path.join(root, 'leases'),
    reviewQueue: path.join(root, 'review-queue'),
    operations: path.join(root, 'operations'),
    evidence: path.join(root, 'evidence'),
    board: path.join(root, 'board'),
    releases: path.join(root, 'releases'),
    incidents: path.join(root, 'incidents'),
  };
}

export function ensureStatePaths(paths: StatePaths): StatePaths {
  for (const dir of Object.values(paths)) mkdirSync(dir, { recursive: true });
  return paths;
}

export function hostName(): string {
  try {
    return hostname();
  } catch {
    return 'unknown-host';
  }
}
