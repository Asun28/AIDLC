/**
 * Removing card worktrees: the copy of `.review/` and `git worktree remove` the cleanup step of `card close` uses, and the
 * sweep over every linked worktree (card T0-WORKTREE-RECLAIM). The sweep writes no record. The goals, runs, leases,
 * operations and git decide what may go, and every branch stays, so `git worktree add` undoes a removal.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { loadCardRegistry } from '../artifacts/card.ts';
import { resolveWorktreeRoot, type ProjectConfig } from '../config.ts';
import { LeaseStore, resourceKeys } from '../coordination/lease.ts';
import { OperationLedger } from '../coordination/reconcile.ts';
import type { CardRun, Goal } from '../core/types.ts';
import { runSync } from '../probes/exec.ts';
import { GitProbe, oneLine, type WorktreeEntry } from '../probes/git.ts';
import type { GoalStore } from '../state/goal-store.ts';
import { currentActor } from '../state/journal.ts';
import type { RepoIdentity, StatePaths } from '../state/paths.ts';

/** Ignored paths a removal may take: `.review/` is copied first and a command rebuilds the other two. */
const REPLACEABLE = new Set(['.review/', 'node_modules/', 'dist/']);

/** `findWorktree` folds case, which on a case-sensitive filesystem joins two directories; their real paths stay apart. */
export function sameDirectory(a: string, b: string): boolean {
  try {
    return realpathSync.native(a) === realpathSync.native(b);
  } catch {
    return false;
  }
}

/** The files directly under `.review/` go to `kept` under their own names, outside the manifest, then git removes the worktree. */
export function retireWorktree(git: GitProbe, mainRoot: string, worktree: string, kept: string): void {
  const reviewDir = path.join(worktree, '.review');
  if (existsSync(reviewDir)) {
    mkdirSync(kept, { recursive: true });
    const files = readdirSync(reviewDir, { withFileTypes: true }).filter((f) => f.isFile()).map((f) => f.name);
    for (const name of files) copyFileSync(path.join(reviewDir, name), path.join(kept, name));
    // Two names the worktree keeps apart can reach one file here, so each copy is read back before the removal.
    for (const name of files) {
      if (!readFileSync(path.join(reviewDir, name)).equals(readFileSync(path.join(kept, name)))) throw new Error(`the copy of .review/${name} in ${kept} differs from the file; another name may have reached it`);
    }
  }
  git.removeWorktree(mainRoot, worktree);
}

export interface ReclaimDeps {
  paths: StatePaths;
  repo: RepoIdentity;
  config: ProjectConfig;
  store: GoalStore;
  leases?: LeaseStore;
  ops?: OperationLedger;
  git?: GitProbe;
  now?: () => string;
}

export interface ReclaimRow {
  cardId: string;
  path: string;
  action: 'removed' | 'would remove' | 'skipped' | 'failed';
  reason: string;
}

/** A goal holding a run of the card, the latest goal first. */
interface Held {
  goal: Goal;
  run: CardRun;
}

type Decision = { skip: string } | { finished: string; goalId: string };

/** The conditions of card R2, then R3, with git last because it is the slowest; the first that fails names the skip. */
function decide(deps: Required<Pick<ReclaimDeps, 'leases' | 'ops' | 'git' | 'now'>> & ReclaimDeps, entry: WorktreeEntry, root: string, cards: Map<string, { status: string; superseded_by?: string }>, held: Held[]): Decision {
  const cardId = entry.branch;
  if (!cardId || !sameDirectory(entry.path, path.join(root, cardId))) return { skip: `not a card worktree at ${root}` };
  const card = cards.get(cardId);
  if (!card) return { skip: `no card file for ${cardId}` };
  const latest = held[0];
  if (!latest) return { skip: `no run of ${cardId}` };
  const live = held.find((h) => !h.goal.terminal);
  if (live) return { skip: `goal ${live.goal.id} is not terminal` };
  const finished = card.superseded_by ? `superseded by ${card.superseded_by}` : card.status === 'merged' || latest.run.state === 'DONE' ? 'merged' : latest.goal.stop?.reason === 'cancelled' ? `goal ${latest.goal.id} was cancelled` : undefined;
  if (!finished) return { skip: `not merged, superseded or cancelled: goal ${latest.goal.id} is ${latest.goal.state}, a ruling may resume it` };
  const lease = deps.leases.read(resourceKeys.card(deps.repo.key, cardId));
  const me = currentActor();
  if (lease && !lease.released && Date.parse(lease.expiresAt) >= Date.parse(deps.now()) && !(lease.owner.session === me.session && lease.owner.host === me.host)) return { skip: `lease held by ${lease.owner.session} until ${lease.expiresAt}` };
  const open = held.flatMap((h) => deps.ops.unresolved(h.goal.id, cardId));
  if (open[0]) return { skip: `unresolved operation ${open[0].id}` };
  if (entry.locked) return { skip: 'locked worktree' };
  if (deps.git.status(entry.path).dirty) return { skip: 'modified or untracked files' };
  const lost = deps.git.ignored(entry.path).filter((p) => !REPLACEABLE.has(p));
  const reviewDir = path.join(entry.path, '.review');
  if (existsSync(reviewDir)) lost.push(...readdirSync(reviewDir, { withFileTypes: true }).filter((f) => !f.isFile()).map((f) => `.review/${f.name}`));
  if (lost.length) return { skip: `ignored paths the removal would delete: ${lost.join(', ')}` };
  return { finished, goalId: latest.goal.id };
}

/**
 * One row for each linked worktree, the main checkout left out. A failure on one worktree is its row and the sweep goes
 * on. No lock spans the check and the removal: a stopped card often holds an expired lease only a takeover could claim.
 */
export function sweepWorktrees(deps: ReclaimDeps, options: { dryRun?: boolean } = {}): ReclaimRow[] {
  const { repo, config, paths, store } = deps;
  if (config.shipPath === 'dry-run' || !repo.isGit) return [];
  const git = deps.git ?? new GitProbe(runSync);
  const linked = git.worktrees(repo.mainRoot).filter((e) => !e.bare && !sameDirectory(e.path, repo.mainRoot));
  if (linked.length === 0) return [];
  const full = { ...deps, git, leases: deps.leases ?? new LeaseStore(paths.leases), ops: deps.ops ?? new OperationLedger(paths.operations), now: deps.now ?? (() => new Date().toISOString()) };
  const root = resolveWorktreeRoot(config, repo.mainRoot);
  const cards = new Map(loadCardRegistry(path.join(repo.mainRoot, config.cardsDir), path.join(repo.mainRoot, config.archiveDir)).cards.map((p) => [p.card.id, p.card]));
  const held = new Map<string, Held[]>();
  for (const goal of store.listGoals()) {
    for (const run of store.listCardRuns(goal.id)) held.set(run.cardId, [...(held.get(run.cardId) ?? []), { goal, run }]);
  }
  return linked.map((entry) => {
    const cardId = entry.branch ?? path.basename(entry.path);
    const row = (action: ReclaimRow['action'], reason: string): ReclaimRow => ({ cardId, path: entry.path, action, reason });
    try {
      const decision = decide(full, entry, root, cards, held.get(cardId) ?? []);
      if ('skip' in decision) return row('skipped', decision.skip);
      if (options.dryRun) return row('would remove', decision.finished);
      retireWorktree(git, repo.mainRoot, entry.path, path.join(paths.evidence, decision.goalId, 'review', cardId));
      return row('removed', decision.finished);
    } catch (err) {
      return row('failed', oneLine((err as Error).message));
    }
  });
}
