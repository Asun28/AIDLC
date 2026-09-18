/**
 * Planning claims (card T0-PLANNING-CLAIMS): which goal owns each planning file drafted on main.
 *
 * Planning artifacts (intent, spec, plan, card files) are written on the main checkout before a
 * goal reaches RUN, so a second session in the same checkout sees them only as untracked files.
 * The claim is derived from two records that already exist: the goal record names its intent, plan
 * and cards, and the goal lease names the session. There is no claims file and no second lock (the
 * T1-LOOP-LESSONS lesson): a released or expired lease is reported as such, never rewritten.
 *
 * Two surfaces read it: `aidlc doctor` (`workingTree`) lists every uncommitted planning file with
 * its claiming goal, session and lease state; the Stop hook (`hooks/index.ts`) reminds a session
 * that holds a goal lease to commit that goal's planning artifacts before it ends.
 */
import path from 'node:path';
import { parsePlanCards } from '../artifacts/plan.ts';
import type { Goal, Lease } from '../core/types.ts';

/** The four planning directories of the main checkout (`ProjectConfig` keys of the same names). */
export interface PlanningDirs {
  intentDir: string;
  specsDir: string;
  plansDir: string;
  cardsDir: string;
}

/** Forward slashes, no leading `./`, no trailing slash: the shape `git status --porcelain` prints. */
function normalise(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

/** The planning files one non-terminal goal claims, derived from its record alone (R1). */
export function planningArtifactsOf(goal: Goal, dirs: PlanningDirs, readPlan: (planRef: string) => string | undefined): string[] {
  if (goal.terminal) return [];
  const files = new Set<string>();
  if (goal.intentRef) {
    const intent = normalise(goal.intentRef);
    files.add(intent);
    const slug = path.posix.basename(intent, '.md');
    files.add(`${normalise(dirs.specsDir)}/${slug}.md`);
    files.add(`${normalise(dirs.plansDir)}/${slug}.md`);
  }
  const cards = new Set(goal.cards);
  if (goal.planRef) {
    const plan = normalise(goal.planRef);
    files.add(plan);
    const text = readPlan(plan);
    if (text !== undefined) for (const row of parsePlanCards(text)) cards.add(row.id);
  }
  for (const id of cards) files.add(`${normalise(dirs.cardsDir)}/${id}.md`);
  return [...files];
}

/**
 * Every claimed path (forward slashes, relative to the main checkout) mapped to the goal that claims
 * it. A terminal goal claims nothing; a path two goals claim keeps the older goal (by `createdAt`,
 * then id), whatever order the goals arrive in.
 */
export function planningClaims(goals: Goal[], dirs: PlanningDirs, readPlan: (planRef: string) => string | undefined): Map<string, string> {
  const claims = new Map<string, string>();
  const ordered = [...goals].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const goal of ordered) {
    for (const file of planningArtifactsOf(goal, dirs, readPlan)) if (!claims.has(file)) claims.set(file, goal.id);
  }
  return claims;
}

/**
 * The path a porcelain v1 entry (`XY path`, or `XY old -> new` for a rename) names: the destination
 * of a rename, unquoted when git quoted it. `GitProbe.status` trims git's output, so the first entry
 * of a status whose X column is a space (` M path`, modified in the worktree only) arrives as
 * `M path`; both shapes are read, and the one-column shape is unambiguous (`M  path` keeps its
 * two columns after the trim). An entry of neither shape names no path.
 */
function entryPath(entry: string): string | undefined {
  const m = /^(?:[ MTADRCU?!]{2}|[MTADRCU?!]) (.+)$/.exec(entry);
  if (!m) return undefined;
  let p = m[1]!;
  const arrow = p.indexOf(' -> ');
  if (arrow >= 0) p = p.slice(arrow + 4);
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p;
}

/**
 * The uncommitted paths under the four planning directories, from a `GitProbe.status` result of the
 * main checkout (R2): untracked, modified, added, renamed or deleted entries alike, in status order,
 * and no path outside those directories.
 */
export function uncommittedPlanningFiles(status: { entries: string[]; dirty?: boolean; untracked?: string[] }, dirs: PlanningDirs): string[] {
  const roots = [dirs.intentDir, dirs.specsDir, dirs.plansDir, dirs.cardsDir].map((d) => normalise(d) + '/');
  const files: string[] = [];
  for (const entry of status.entries) {
    const p = entryPath(entry);
    if (p !== undefined && roots.some((root) => p.startsWith(root)) && !files.includes(p)) files.push(p);
  }
  return files;
}

/** The lease state the doctor prints next to a claim. */
function leaseState(lease: Lease | undefined, now: string): string {
  if (!lease) return 'no lease';
  if (lease.released) return `session ${lease.owner.session}, lease released`;
  const expired = Date.parse(lease.expiresAt) < Date.parse(now);
  return `session ${lease.owner.session}, lease ${expired ? 'expired at' : 'live until'} ${lease.expiresAt}`;
}

/**
 * The doctor's `workingTree` value: `clean`, or one entry per uncommitted planning file with the goal
 * that claims it and that goal's lease owner and expiry, or `unclaimed`.
 */
export function formatWorkingTree(files: string[], claims: Map<string, string>, leaseOf: (goalId: string) => Lease | undefined, now: string): 'clean' | string[] {
  if (!files.length) return 'clean';
  return files.map((file) => {
    const goalId = claims.get(file);
    if (!goalId) return `${file}: unclaimed`;
    return `${file}: claimed by ${goalId} (${leaseState(leaseOf(goalId), now)})`;
  });
}
