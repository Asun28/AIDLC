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
import { mkdirSync } from 'node:fs';
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

export function resolveRepoIdentity(cwd: string = process.cwd()): RepoIdentity {
  const common = gitOut(['rev-parse', '--git-common-dir'], cwd);
  const top = gitOut(['rev-parse', '--show-toplevel'], cwd);
  if (!common || !top) {
    const abs = path.resolve(cwd);
    return { mainRoot: abs, worktreeRoot: abs, isGit: false, key: shortKey(abs) };
  }
  const commonAbs = path.resolve(cwd, common);
  const mainRoot = path.resolve(commonAbs, '..');
  const worktreeRoot = path.resolve(top);
  return { mainRoot, worktreeRoot, isGit: true, key: shortKey(mainRoot) };
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
