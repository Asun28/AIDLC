/**
 * Safe start-or-attach for card worktrees (plan v5 R14-R16, §5 compatibility observations).
 *
 * The scaffold's `task.ps1 -Phase start` rejects an existing worktree; a generic throw is not
 * a safe resume sentinel. Attach only when branch, canonical path, common git directory and
 * the durable owner record all match; otherwise STOP/ownership.
 */
import path from 'node:path';
import { GitProbe } from '../probes/git.ts';
import type { Lease } from '../core/types.ts';

export interface WorktreeAttachInput {
  mainRoot: string;
  worktreeRoot: string;
  cardId: string;
  /** Existing owner lease for the card resource, if any. */
  lease?: Lease;
  /** Identity of this session (session id) for owner comparison. */
  session: string;
}

export type WorktreeDecision =
  | { action: 'start'; path: string; reason: string }
  | { action: 'attach'; path: string; head: string; reason: string }
  | { action: 'stop'; reason: string; stopReason: 'ownership' | 'tool' };

export function decideWorktree(probe: GitProbe, input: WorktreeAttachInput): WorktreeDecision {
  const expected = path.join(input.worktreeRoot, input.cardId);
  let found: ReturnType<GitProbe['findWorktree']>;
  try {
    found = probe.findWorktree(input.mainRoot, input.cardId, expected);
  } catch (err) {
    return { action: 'stop', reason: `worktree probe failed: ${(err as Error).message}`, stopReason: 'tool' };
  }
  // A mismatch comes first: a branch checked out in two worktrees has a mismatch and no single entry, and is not a missing worktree.
  if (found.mismatch) return { action: 'stop', reason: found.mismatch, stopReason: 'ownership' };
  if (!found.entry) {
    return { action: 'start', path: expected, reason: 'no worktree for this branch; start a new one' };
  }
  // Common dir must be the main checkout's.
  try {
    const common = probe.commonDir(found.entry.path);
    const mainCommon = probe.commonDir(input.mainRoot);
    if (common.toLowerCase() !== mainCommon.toLowerCase()) {
      return { action: 'stop', reason: `worktree ${found.entry.path} belongs to a different repository (${common})`, stopReason: 'ownership' };
    }
  } catch (err) {
    return { action: 'stop', reason: `cannot verify common git directory: ${(err as Error).message}`, stopReason: 'tool' };
  }
  if (input.lease && !input.lease.released && input.lease.owner.session !== input.session) {
    return { action: 'stop', reason: `card ${input.cardId} is owned by session ${input.lease.owner.session} (generation ${input.lease.generation}); attach read-only or take over after reconciliation`, stopReason: 'ownership' };
  }
  return { action: 'attach', path: found.entry.path, head: found.entry.head ?? '', reason: 'branch, path and common directory match; owner record permits attach' };
}

export interface WorktreeStartInput {
  cardId: string;
  /** The worktree path of the `prepare` directive. */
  path: string;
  /** The main checkout, whose `node_modules` the link targets. */
  mainRoot: string;
  /** The ref the new branch starts from: `origin/<base>` in remote mode, `<base>` in local mode. */
  ref: string;
  /** Name the `node_modules` link: the main checkout has one, and the DoD finds its tools there. */
  linkModules: boolean;
  platform: NodeJS.Platform;
}

/**
 * The commands that make a card worktree off the scaffold ship path (card T0-PREPARE-START-CMD, issue 376): `git worktree
 * add` of the card branch at the directive path, the form for a branch that exists, and, when asked, the link of the main
 * checkout's `node_modules` in the syntax of the platform (a PowerShell junction on win32, `ln -s` elsewhere). Pure: paths
 * are joined with the separator of `platform`, not of this process.
 */
export function worktreeStartCommands(input: WorktreeStartInput): string {
  const { cardId, path: dir, mainRoot, ref } = input;
  const commands = `From the main checkout run \`git worktree add -b ${cardId} "${dir}" ${ref}\` (when branch ${cardId} exists: \`git worktree add "${dir}" ${cardId}\`)`;
  if (!input.linkModules) return `${commands}.`;
  const join = input.platform === 'win32' ? path.win32.join : path.posix.join;
  const link = join(dir, 'node_modules');
  const target = join(mainRoot, 'node_modules');
  const command = input.platform === 'win32' ? `New-Item -ItemType Junction -Path "${link}" -Target "${target}"` : `ln -s "${target}" "${link}"`;
  return `${commands}, then link node_modules so the DoD finds its tools: \`${command}\`.`;
}
