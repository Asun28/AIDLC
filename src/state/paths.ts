/**
 * Canonical state location.
 *
 * Runtime state must live outside feature worktrees and be visible to every session that
 * works on the same repository (plan v5 MS1/MS5). For a git repository that means the main
 * checkout's directory (the parent of `git rev-parse --git-common-dir`), so every linked
 * worktree resolves to the same `.aidlc/` directory. `AIDLC_STATE_DIR` overrides it.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
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

/** One spawn for both refs: git prints them in argument order. */
const IDENTITY_ARGS = ['rev-parse', '--git-common-dir', '--show-toplevel'];

/** The identity of `cwd` from the output of `git rev-parse` (`IDENTITY_ARGS`); `out` is undefined when git failed. */
function identityFrom(cwd: string, out: string | undefined): RepoIdentity {
  const key = path.resolve(cwd);
  const [common, top] = out ? out.split(/\r?\n/).map((line) => line.trim()) : [];
  if (!common || !top) return { mainRoot: key, worktreeRoot: key, isGit: false, key: shortKey(key) };
  const commonAbs = canonical(path.resolve(cwd, common));
  const mainRoot = canonical(path.resolve(commonAbs, '..'));
  const worktreeRoot = canonical(path.resolve(top));
  return { mainRoot, worktreeRoot, isGit: true, key: shortKey(mainRoot) };
}

export function resolveRepoIdentity(cwd: string = process.cwd()): RepoIdentity {
  const key = path.resolve(cwd);
  const cached = identityCache.get(key);
  if (cached) return cached;
  const identity = identityFrom(cwd, gitOut(IDENTITY_ARGS, cwd));
  identityCache.set(key, identity);
  return identity;
}

/** `spawnSync`'s default `maxBuffer`: more output than this on stdout or on stderr ends the child, and the call reads none. */
const MAX_OUTPUT = 1024 * 1024;

/**
 * A finished lookup: `answered` when git ran, with its output read as `gitOut` reads it; not answered when the spawn itself
 * failed (a throw, an `error` event, no output streams), which caches nothing (R3 decision 1).
 */
type Lookup = { answered: true; out: string | undefined } | { answered: false };

/** The lookup `prefetchRepoIdentity` started, for the one cwd it was started in. */
let prefetch: { key: string; lookup: Promise<Lookup> } | undefined;

/**
 * Starts the `git rev-parse` of `resolveRepoIdentity` for `cwd` without waiting for it, so git runs while the caller loads
 * its modules (the hook entry, card T0-HOOK-GIT-PREFETCH). The same arguments, environment and window flag as the
 * synchronous call, and its output read as that call reads it: exit status 0 and stdout trimmed, and no output when stdout
 * or stderr passes `MAX_OUTPUT` (the child is ended, as `spawnSync` ends it). A spawn that fails in any way is no lookup,
 * so the identity is then asked of git synchronously as before.
 */
export function prefetchRepoIdentity(cwd: string): void {
  if (prefetch) return;
  const lookup = new Promise<Lookup>((resolve) => {
    const unanswered = () => resolve({ answered: false });
    try {
      const child = spawn('git', IDENTITY_ARGS, { cwd, windowsHide: true });
      child.on('error', unanswered);
      const { stdout, stderr, stdin } = child;
      if (!stdout || !stderr || !stdin) {
        child.kill();
        unanswered();
        return;
      }
      const chunks: Buffer[] = [];
      let outBytes = 0;
      let errBytes = 0;
      const overflow = () => {
        child.kill();
        resolve({ answered: true, out: undefined });
      };
      stdout.on('error', unanswered);
      stderr.on('error', unanswered);
      stdin.on('error', () => {
        /* git reads no input; a closed pipe changes nothing */
      });
      stdout.on('data', (d: Buffer) => {
        outBytes += d.length;
        if (outBytes > MAX_OUTPUT) overflow();
        else chunks.push(d);
      });
      stderr.on('data', (d: Buffer) => {
        errBytes += d.length;
        if (errBytes > MAX_OUTPUT) overflow();
      });
      child.on('close', (code) => resolve({ answered: true, out: code === 0 ? Buffer.concat(chunks).toString('utf8').trim() : undefined }));
      stdin.end();
    } catch {
      unanswered();
    }
  });
  prefetch = { key: path.resolve(cwd), lookup };
}

/**
 * Waits for the lookup `prefetchRepoIdentity` started and caches its identity when `cwd` resolves to the directory it ran
 * in and git answered, so `resolveRepoIdentity(cwd)` spawns nothing; for any other cwd, a spawn that failed, or with no
 * lookup started, nothing changes and the identity is asked of git synchronously as before.
 */
export async function settleRepoIdentity(cwd: string): Promise<void> {
  if (!prefetch || prefetch.key !== path.resolve(cwd) || identityCache.has(prefetch.key)) return;
  const lookup = await prefetch.lookup;
  if (lookup.answered) identityCache.set(prefetch.key, identityFrom(cwd, lookup.out));
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

export function hostName(): string {
  try {
    return hostname();
  } catch {
    return 'unknown-host';
  }
}
