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
 *
 * Every path here is checkout-relative with forward slashes and no dot segments, and a claim is only
 * ever a path under one of the four planning directories: a reference that is absolute, escapes the
 * checkout or points elsewhere claims nothing and is never read. Nothing here throws: a record, plan
 * or lease that cannot be read is reported by its error code, never by its contents.
 */
import path from 'node:path';
import { parsePlanCards } from '../artifacts/plan.ts';
import type { Goal, Lease } from '../core/types.ts';
import { StoreError } from './store.ts';
import { GitProbeError } from '../probes/git.ts';

/** The four planning directories of the main checkout (`ProjectConfig` keys of the same names). */
export interface PlanningDirs {
  intentDir: string;
  specsDir: string;
  plansDir: string;
  cardsDir: string;
}

/**
 * The checkout-relative form of a path: forward slashes, dot segments resolved, no leading `./`, no
 * trailing slash. Undefined for an absolute path, a drive-letter path, an empty path or one that
 * escapes the checkout (`..` after normalisation): such a reference is never read or claimed. A
 * record or config value may carry Windows separators, which become slashes; a path git printed
 * (`gitSlashes`) already has slashes, and a backslash in it is part of the name.
 */
export function checkoutRelative(p: string, gitSlashes = false): string | undefined {
  const slashes = gitSlashes ? p : p.replace(/\\/g, '/');
  if (slashes.startsWith('/') || /^[A-Za-z]:/.test(slashes)) return undefined;
  const normalised = path.posix.normalize(slashes).replace(/\/+$/, '');
  if (!normalised || normalised === '.' || normalised === '..' || normalised.startsWith('../')) return undefined;
  return normalised;
}

/** A path under a planning directory (never the directory itself). */
function under(p: string, dir: string): boolean {
  return p.startsWith(dir + '/');
}

/** The four directories in checkout-relative form; a directory that is not one claims nothing under it. */
function planningRoots(dirs: PlanningDirs): { intent?: string; specs?: string; plans?: string; cards?: string } {
  return { intent: checkoutRelative(dirs.intentDir), specs: checkoutRelative(dirs.specsDir), plans: checkoutRelative(dirs.plansDir), cards: checkoutRelative(dirs.cardsDir) };
}

/**
 * The planning files one non-terminal goal claims, derived from its record alone (R1): its intent
 * (when it lies under the intent directory), the spec and plan of the intent's slug, its plan
 * reference (when it lies under the plans directory), and the card file of every card it lists or
 * its plan's task split names (every id whose canonical path stays under the cards directory). A
 * reference outside its directory is neither claimed nor read.
 */
export function planningArtifactsOf(goal: Goal, dirs: PlanningDirs, readPlan: (planRef: string) => string | undefined, onPlanError?: (code: string) => void): string[] {
  if (goal.terminal) return [];
  const roots = planningRoots(dirs);
  const files = new Set<string>();
  const intent = goal.intentRef ? checkoutRelative(goal.intentRef) : undefined;
  if (intent && roots.intent && under(intent, roots.intent)) {
    files.add(intent);
    const slug = path.posix.basename(intent, '.md');
    if (roots.specs) files.add(`${roots.specs}/${slug}.md`);
    if (roots.plans) files.add(`${roots.plans}/${slug}.md`);
  }
  const cards = new Set(goal.cards);
  const plan = goal.planRef ? checkoutRelative(goal.planRef) : undefined;
  if (plan && roots.plans && under(plan, roots.plans)) {
    files.add(plan);
    for (const row of planRows(plan, readPlan, onPlanError)) cards.add(row.id);
  }
  if (roots.cards) {
    // every id maps to `<cardsDir>/<id>.md`; the canonical path must stay under the cards directory
    for (const id of cards) {
      const file = checkoutRelative(`${roots.cards}/${id}.md`);
      if (file && under(file, roots.cards)) files.add(file);
    }
  }
  return [...files];
}

/**
 * The task-split rows of a goal's plan. A plan that cannot be read or parsed names no extra cards and
 * the failure is reported to `onPlanError` by its store error code (`UNREADABLE` for any other error),
 * never by the error text; the claim itself never throws.
 */
function planRows(planRef: string, readPlan: (planRef: string) => string | undefined, onPlanError?: (code: string) => void): ReturnType<typeof parsePlanCards> {
  try {
    const text = readPlan(planRef);
    return text === undefined ? [] : parsePlanCards(text);
  } catch (err) {
    onPlanError?.(readErrorCode(err));
    return [];
  }
}

/** Older first by the parsed `createdAt` instant, then by id: the same order whatever the timestamp precision. */
function byAge(a: Goal, b: Goal): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
}

/**
 * Every claimed path (checkout-relative, forward slashes) mapped to the goal that claims it. A
 * terminal goal claims nothing; a path two goals claim keeps the older goal (by the `createdAt`
 * instant, then id), whatever order the goals arrive in. One goal's unreadable plan affects that
 * goal's plan rows only, and is recorded by store error code in `planErrors` (goal id to code) when
 * the caller passes one.
 */
export function planningClaims(goals: Goal[], dirs: PlanningDirs, readPlan: (planRef: string) => string | undefined, planErrors?: Map<string, string>): Map<string, string> {
  const claims = new Map<string, string>();
  for (const goal of [...goals].sort(byAge)) {
    const files = planningArtifactsOf(goal, dirs, readPlan, (code) => planErrors?.set(goal.id, code));
    for (const file of files) if (!claims.has(file)) claims.set(file, goal.id);
  }
  return claims;
}

/**
 * The path a porcelain v1 entry (`XY path`, or `XY old -> new` for a rename or copy) names: the
 * destination of a rename, unquoted when git quoted it. `GitProbe.status` trims git's output, so the
 * first entry of a status whose X column is a space (` M path`, modified in the worktree only)
 * arrives as `M path`; both shapes are read, and the one-column shape is unambiguous (`M  path`
 * keeps its two columns after the trim). Only an R or C status column carries the arrow, and between
 * two quoted names the separator is `" -> "`, so a name containing ` -> ` stays whole. An entry of
 * neither shape names no path.
 */
function entryPath(entry: string): string | undefined {
  const m = /^([ MTADRCU?!]{2}|[MTADRCU?!]) (.+)$/.exec(entry);
  if (!m) return undefined;
  let p = m[2]!;
  if (/[RC]/.test(m[1]!)) {
    const quoted = p.startsWith('"');
    const separator = quoted ? '" -> "' : ' -> ';
    const arrow = p.indexOf(separator);
    if (arrow >= 0) p = p.slice(arrow + separator.length - (quoted ? 1 : 0));
  }
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = unquoteC(p.slice(1, -1));
  return p;
}

const C_ESCAPES: Record<string, number> = { a: 0x07, b: 0x08, f: 0x0c, n: 0x0a, r: 0x0d, t: 0x09, v: 0x0b, '\\': 0x5c, '"': 0x22 };

/**
 * The bytes of a path git C-quoted (`"..."`): the named escapes and octal `\NNN` bytes, decoded as
 * UTF-8. Unescaped text is copied by code point, so a character outside the BMP (raw, under
 * `core.quotePath=false`) survives whole.
 */
function unquoteC(quoted: string): string {
  const bytes: number[] = [];
  let i = 0;
  while (i < quoted.length) {
    const code = quoted.codePointAt(i)!;
    const ch = String.fromCodePoint(code);
    if (ch !== '\\' || i + 1 >= quoted.length) {
      bytes.push(...Buffer.from(ch, 'utf8'));
      i += ch.length;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(quoted.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(parseInt(octal[0], 8) & 0xff);
      i += 1 + octal[0].length;
      continue;
    }
    const next = String.fromCodePoint(quoted.codePointAt(i + 1)!);
    const named = C_ESCAPES[next];
    if (named !== undefined) bytes.push(named);
    else bytes.push(...Buffer.from(next, 'utf8'));
    i += 1 + next.length;
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * The uncommitted paths under the four planning directories, from a `GitProbe.status` result of the
 * main checkout (R2): every porcelain entry (untracked, modified, added, renamed or deleted) whose
 * path lies under one of the directories, in status order, and no path outside them.
 */
export function uncommittedPlanningFiles(status: { entries: string[]; dirty?: boolean; untracked?: string[] }, dirs: PlanningDirs): string[] {
  const roots = Object.values(planningRoots(dirs)).filter((d): d is string => d !== undefined);
  const files: string[] = [];
  for (const entry of status.entries) {
    const raw = entryPath(entry);
    const p = raw === undefined ? undefined : checkoutRelative(raw, true);
    if (p !== undefined && roots.some((root) => under(p, root)) && !files.includes(p)) files.push(p);
  }
  return files;
}

/** A path as data on an output line: JSON-quoted, so a newline, a quote or a `[aidlc]` inside a name stays inside the quotes. */
export function quotePath(p: string): string {
  return JSON.stringify(p);
}

/** The codes a store read fails with; anything else is UNREADABLE, so no error text (which may quote a record) is printed. */
const STORE_READ_CODES = new Set(['READ_FAILED', 'MALFORMED_JSON', 'SCHEMA_VIOLATION']);

export function readErrorCode(err: unknown): string {
  return err instanceof StoreError && STORE_READ_CODES.has(err.code) ? err.code : 'UNREADABLE';
}

/** The lease state the doctor prints next to a claim; a lease record that cannot be read is named by its error code, never quoted. */
function leaseState(leaseOf: (goalId: string) => Lease | undefined, goalId: string, now: string): string {
  let lease: Lease | undefined;
  try {
    lease = leaseOf(goalId);
  } catch (err) {
    return `lease unreadable: ${readErrorCode(err)}`;
  }
  if (!lease) return 'no lease';
  if (lease.released) return `session ${lease.owner.session}, lease released`;
  const expired = Date.parse(lease.expiresAt) < Date.parse(now);
  return `session ${lease.owner.session}, lease ${expired ? 'expired at' : 'live until'} ${lease.expiresAt}`;
}

/**
 * The doctor's `workingTree` value: `clean`, or one entry per uncommitted planning file (the path
 * JSON-quoted) with the goal that claims it and that goal's lease owner and expiry (and, when the
 * goal's plan could not be read, `plan unreadable: <code>`), or `unclaimed`.
 */
export function formatWorkingTree(files: string[], claims: Map<string, string>, leaseOf: (goalId: string) => Lease | undefined, now: string, planErrors: Map<string, string> = new Map()): 'clean' | string[] {
  if (!files.length) return 'clean';
  return files.map((file) => {
    const goalId = claims.get(file);
    if (!goalId) return `${quotePath(file)}: unclaimed`;
    const planError = planErrors.get(goalId);
    return `${quotePath(file)}: claimed by ${goalId} (${leaseState(leaseOf, goalId, now)}${planError ? `; plan unreadable: ${planError}` : ''})`;
  });
}

/** What `aidlc doctor` reads to print `workingTree`; every read is injected so the report is testable on fixtures. */
export interface WorkingTreeInputs {
  /** Whether the checkout is a git repository (`RepoIdentity.isGit`). */
  isGit: boolean;
  /** `GitProbe.status` of the main checkout; may throw. */
  status: () => { entries: string[] };
  dirs: PlanningDirs;
  /** The goal records, read only once a planning file is uncommitted; may throw a `StoreError`. */
  goals: () => Goal[];
  /** The plan text by its checkout-relative reference, or undefined; may throw. */
  readPlan: (planRef: string) => string | undefined;
  /** The goal lease record; may throw. */
  leaseOf: (goalId: string) => Lease | undefined;
  now: string;
}

/**
 * The doctor's `workingTree` line (R2): `n/a` outside a git repository; `UNREADABLE: git status
 * failed (exit <n>|UNREADABLE)` when the status cannot be read; else `formatWorkingTree`
 * over the uncommitted planning files and the claims. Doctor is the entry check, so nothing here
 * throws. Goal records that cannot be read (a malformed goal file after an interrupted write) leave
 * every entry `claim unknown` with the store's error code, never the record's contents; a plan that
 * cannot be read names no extra cards and its goal's entries say `plan unreadable: <code>`; a lease
 * that cannot be read is reported on its entry by code.
 */
export function workingTreeReport(input: WorkingTreeInputs): 'clean' | 'n/a' | string | string[] {
  if (!input.isGit) return 'n/a';
  let status: { entries: string[] };
  try {
    status = input.status();
  } catch (err) {
    return `UNREADABLE: git status failed (${gitErrorCode(err)})`;
  }
  const files = uncommittedPlanningFiles(status, input.dirs);
  if (!files.length) return 'clean';
  let goals: Goal[];
  try {
    goals = input.goals();
  } catch (err) {
    const code = readErrorCode(err);
    return files.map((file) => `${quotePath(file)}: claim unknown (goal records unreadable: ${code})`);
  }
  const planErrors = new Map<string, string>();
  const claims = planningClaims(goals, input.dirs, input.readPlan, planErrors);
  return formatWorkingTree(files, claims, input.leaseOf, input.now, planErrors);
}

/** A git status failure by code: `exit <n>` from the probe's receipt, else `UNREADABLE`; git's text never reaches the line. */
function gitErrorCode(err: unknown): string {
  return err instanceof GitProbeError ? `exit ${err.receipt.exitCode}` : 'UNREADABLE';
}
