import type { ProjectConfig } from '../config.ts';
import type { LeaseStore } from '../coordination/lease.ts';
import type { OperationLedger } from '../coordination/reconcile.ts';
import type { GitProbe } from '../probes/git.ts';
import type { GoalStore } from '../state/goal-store.ts';
import type { RepoIdentity, StatePaths } from '../state/paths.ts';

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

export function sweepWorktrees(_deps: ReclaimDeps, _options: { dryRun?: boolean } = {}): ReclaimRow[] {
  return [];
}
