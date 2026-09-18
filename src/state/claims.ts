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
 * checkout or points outside all four claims nothing and is never read. Nothing here throws: a
 * record, plan or lease that cannot be read is reported by its error code, never by its contents.
 * Every identifier on an output line (a path, a goal id, a session id) is data: JSON-quoted when it
 * carries anything outside the plain identifier characters, so a name never forms a second line or
 * a second `[aidlc]` instruction.
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

/** How a path string is read: `native` (a record or config value: a backslash is a separator only where the platform's is) or `git` (a status path: slashes only, a backslash is part of the name). */
export type PathOrigin = 'native' | 'git';

const WINDOWS = process.platform === 'win32';

/**
 * The checkout-relative form of a path: forward slashes, dot segments resolved, no leading `./`, no
 * trailing slash. Undefined for an absolute path, a drive-letter path, an empty path or one that
 * escapes the checkout (`..` after normalisation): such a reference is never read or claimed. The
 * absolute and drive checks run after normalisation as well, so `x/../C:/plans` is refused too. A
 * backslash is a separator only in a `native` string on Windows (`windows` overrides the platform
 * for tests); in a `git` string, or on POSIX, it is a character of the name, so a reference and the
 * status path of the same file normalise alike.
 */
export function checkoutRelative(p: string, origin: PathOrigin = 'native', windows: boolean = WINDOWS): string | undefined {
  const slashes = origin === 'native' && windows ? p.replace(/\\/g, '/') : p;
  const absolute = (s: string) => s.startsWith('/') || /^[A-Za-z]:/.test(s);
  if (absolute(slashes)) return undefined;
  const normalised = path.posix.normalize(slashes).replace(/\/+$/, '');
  if (!normalised || normalised === '.' || normalised === '..' || normalised.startsWith('../') || absolute(normalised)) return undefined;
  return normalised;
}

/** A path under a planning directory (never the directory itself). */
function under(p: string, dir: string): boolean {
  return p.startsWith(dir + '/');
}

interface PlanningRoots {
  intent?: string;
  specs?: string;
  plans?: string;
  cards?: string;
  /** The distinct checkout-relative roots; a reference under any of them is a planning file. */
  all: string[];
}

/** The four directories in checkout-relative form; a configured directory that is not one contributes nothing. */
function planningRoots(dirs: PlanningDirs, windows?: boolean): PlanningRoots {
  const roots = { intent: checkoutRelative(dirs.intentDir, 'native', windows), specs: checkoutRelative(dirs.specsDir, 'native', windows), plans: checkoutRelative(dirs.plansDir, 'native', windows), cards: checkoutRelative(dirs.cardsDir, 'native', windows) };
  const all = [...new Set([roots.intent, roots.specs, roots.plans, roots.cards].filter((d): d is string => d !== undefined))];
  return { ...roots, all };
}

/** Options shared by the claim functions; `windows` is for tests only (the platform decides otherwise). */
export interface ClaimOptions {
  windows?: boolean;
}

/**
 * The planning files one non-terminal goal claims, derived from its record alone (R1): its intent
 * reference and its plan reference when each lies under one of the four planning directories, the
 * spec and plan of the intent's slug (under the configured specs and plans directories), and the
 * card file of every card it lists or its plan's task split names (every id whose canonical path
 * stays under the cards directory). A reference outside every planning directory is neither
 * claimed nor read.
 */
export function planningArtifactsOf(goal: Goal, dirs: PlanningDirs, readPlan: (planRef: string) => string | undefined, onPlanError?: (code: string) => void, options: ClaimOptions = {}): string[] {
  if (goal.terminal) return [];
  const roots = planningRoots(dirs, options.windows);
  const planning = (p: string | undefined): p is string => p !== undefined && roots.all.some((root) => under(p, root));
  const files = new Set<string>();
  const intent = goal.intentRef ? checkoutRelative(goal.intentRef, 'native', options.windows) : undefined;
  if (planning(intent)) {
    files.add(intent);
    const slug = path.posix.basename(intent, '.md');
    if (roots.specs) files.add(`${roots.specs}/${slug}.md`);
    if (roots.plans) files.add(`${roots.plans}/${slug}.md`);
  }
  const cards = new Set(goal.cards);
  const plan = goal.planRef ? checkoutRelative(goal.planRef, 'native', options.windows) : undefined;
  if (planning(plan)) {
    files.add(plan);
    for (const row of planRows(plan, readPlan, onPlanError)) cards.add(row.id);
  }
  if (roots.cards) {
    // every id maps to `<cardsDir>/<id>.md`; the canonical path must stay under the cards directory
    for (const id of cards) {
      const file = checkoutRelative(`${roots.cards}/${id}.md`, 'git');
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
export function planningClaims(goals: Goal[], dirs: PlanningDirs, readPlan: (planRef: string) => string | undefined, planErrors?: Map<string, string>, options: ClaimOptions = {}): Map<string, string> {
  const claims = new Map<string, string>();
  for (const goal of [...goals].sort(byAge)) {
    const files = planningArtifactsOf(goal, dirs, readPlan, (code) => planErrors?.set(goal.id, code), options);
    for (const file of files) if (!claims.has(file)) claims.set(file, goal.id);
  }
  return claims;
}

/**
 * One pathname at the start of a porcelain v1 field: a C-quoted name up to its closing quote (an
 * escaped character never closes it), decoded, else the text up to the separator (or the end).
 */
function readPathname(field: string, separator: string): { name: string; rest: string } {
  if (field.startsWith('"')) {
    let i = 1;
    while (i < field.length && field[i] !== '"') i += field[i] === '\\' ? 2 : 1;
    return { name: unquoteC(field.slice(1, i)), rest: field.slice(i + 1) };
  }
  const at = field.indexOf(separator);
  return at < 0 ? { name: field, rest: '' } : { name: field.slice(0, at), rest: field.slice(at) };
}

/**
 * The paths a porcelain v1 entry (`XY path`, or `XY old -> new` for a rename or copy) names.
 * `GitProbe.status` trims git's output, so the first entry of a status whose X column is a space
 * (` M path`, modified in the worktree only) arrives as `M path`; both shapes are read, and the
 * one-column shape is unambiguous (`M  path` keeps its two columns after the trim). Only an R or C
 * status column carries the arrow; each pathname is read on its own (quoted or not), so a quoted
 * source with an unquoted destination and a name containing ` -> ` (when quoted) both read whole.
 * A rename names both endpoints (its source is a staged deletion); a copy names its destination.
 * An entry of neither shape names nothing.
 */
function entryPaths(entry: string): string[] {
  const m = /^([ MTADRCU?!]{2}|[MTADRCU?!]) (.+)$/.exec(entry);
  if (!m) return [];
  const status = m[1]!;
  const field = m[2]!;
  if (!/[RC]/.test(status)) return [readPathname(field, '\u0000').name];
  const source = readPathname(field, ' -> ');
  if (!source.rest.startsWith(' -> ')) return [source.name];
  const destination = readPathname(source.rest.slice(4), '\u0000').name;
  return /R/.test(status) ? [source.name, destination] : [destination];
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
 * main checkout (R2): every porcelain entry (untracked, modified, added, renamed with both endpoints,
 * copied, deleted) whose path lies under one of the directories, in status order, and no path
 * outside them.
 */
export function uncommittedPlanningFiles(status: { entries: string[]; dirty?: boolean; untracked?: string[] }, dirs: PlanningDirs, options: ClaimOptions = {}): string[] {
  const roots = planningRoots(dirs, options.windows).all;
  const files: string[] = [];
  for (const entry of status.entries) {
    for (const raw of entryPaths(entry)) {
      const p = checkoutRelative(raw, 'git');
      if (p !== undefined && roots.some((root) => under(p, root)) && !files.includes(p)) files.push(p);
    }
  }
  return files;
}

/** A path as data on an output line: JSON-quoted, so a newline, a quote or a `[aidlc]` inside a name stays inside the quotes. */
export function quotePath(p: string): string {
  return JSON.stringify(p);
}

/** Characters an identifier (goal id, session id) may carry raw on an output line; anything else gets the identifier JSON-quoted. */
const PLAIN_ID = /^[A-Za-z0-9._:-]+$/;

/** An identifier as data on an output line: raw when plain, JSON-quoted otherwise (a newline, a space, a bracket never reach the line raw). */
export function quoteId(id: string): string {
  return PLAIN_ID.test(id) ? id : JSON.stringify(id);
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
  if (lease.released) return `session ${quoteId(lease.owner.session)}, lease released`;
  const expired = Date.parse(lease.expiresAt) < Date.parse(now);
  return `session ${quoteId(lease.owner.session)}, lease ${expired ? 'expired at' : 'live until'} ${lease.expiresAt}`;
}

/**
 * The doctor's `workingTree` value: `clean`, or one entry per uncommitted planning file (the path
 * JSON-quoted; a goal or session id JSON-quoted when it is not a plain identifier) with the goal
 * that claims it and that goal's lease owner and expiry (and, when the goal's plan could not be
 * read, `plan unreadable: <code>`), or `unclaimed`. When some goal's plan could not be read, an
 * unclaimed file under the cards directory may be a card that plan names, so its claim is unknown
 * and the entry says which goal's plan, by code (`cardsRoot` is the checkout-relative cards directory).
 */
export function formatWorkingTree(files: string[], claims: Map<string, string>, leaseOf: (goalId: string) => Lease | undefined, now: string, planErrors: Map<string, string> = new Map(), cardsRoot?: string): 'clean' | string[] {
  if (!files.length) return 'clean';
  const cards = cardsRoot;
  const unresolved = [...planErrors.entries()].map(([goalId, code]) => `plan of ${quoteId(goalId)} unreadable: ${code}`).join(', ');
  return files.map((file) => {
    const goalId = claims.get(file);
    if (!goalId) {
      if (unresolved && cards && under(file, cards)) return `${quotePath(file)}: claim unknown (${unresolved})`;
      return `${quotePath(file)}: unclaimed`;
    }
    const planError = planErrors.get(goalId);
    return `${quotePath(file)}: claimed by ${quoteId(goalId)} (${leaseState(leaseOf, goalId, now)}${planError ? `; plan unreadable: ${planError}` : ''})`;
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
  /** Tests only: read native paths as Windows paths (the platform decides otherwise). */
  windows?: boolean;
}

/**
 * The doctor's `workingTree` line (R2): `n/a` outside a git repository; `UNREADABLE: git status
 * failed (exit <n>|UNREADABLE)` when the status cannot be read; else `formatWorkingTree` over the
 * uncommitted planning files and the claims. Doctor is the entry check, so nothing here throws.
 * Goal records that cannot be read (a malformed goal file after an interrupted write) leave every
 * entry `claim unknown` with the store's error code, never the record's contents; a plan that
 * cannot be read names no extra cards, its goal's entries say `plan unreadable: <code>`, and an
 * unclaimed card file is reported as a claim unknown rather than unclaimed; a lease that cannot be
 * read is reported on its entry by code.
 */
export function workingTreeReport(input: WorkingTreeInputs): 'clean' | 'n/a' | string | string[] {
  if (!input.isGit) return 'n/a';
  let status: { entries: string[] };
  try {
    status = input.status();
  } catch (err) {
    return `UNREADABLE: git status failed (${gitErrorCode(err)})`;
  }
  const options = { windows: input.windows };
  const files = uncommittedPlanningFiles(status, input.dirs, options);
  if (!files.length) return 'clean';
  let goals: Goal[];
  try {
    goals = input.goals();
  } catch (err) {
    const code = readErrorCode(err);
    return files.map((file) => `${quotePath(file)}: claim unknown (goal records unreadable: ${code})`);
  }
  const planErrors = new Map<string, string>();
  const claims = planningClaims(goals, input.dirs, input.readPlan, planErrors, options);
  return formatWorkingTree(files, claims, input.leaseOf, input.now, planErrors, planningRoots(input.dirs, input.windows).cards);
}

/** A git status failure by code: `exit <n>` from the probe's receipt when it has a numeric exit code (a signal or timeout has none), else `UNREADABLE`; git's text never reaches the line. */
function gitErrorCode(err: unknown): string {
  return err instanceof GitProbeError && typeof err.receipt.exitCode === 'number' ? `exit ${err.receipt.exitCode}` : 'UNREADABLE';
}
