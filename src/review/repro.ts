/**
 * `aidlc review repro` (card T1-FINDING-REPRO-2): run the author's repro argv of a finding twice, each in a temporary
 * detached checkout under the OS temp directory, once at the finding's `candidateSha` with each `--files` path taken from
 * the current candidate and once at the current candidate, and record both exits on the finding.
 *
 * The argv is isolated by its working directory (the temporary checkout) and by its state directory (`AIDLC_STATE_DIR`, a
 * new empty temporary directory per run) and by nothing else: it is the author's command, trusted as the DoD command is,
 * and it runs without a shell. The command writes only those checkouts, those state directories and the finding record.
 */
import { existsSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FindingRepro, nowIso, type CardRun, type ReproRun } from '../core/types.ts';
import { resolveCardGoal } from '../core/card-goal.ts';
import type { GoalStore } from '../state/goal-store.ts';
import { nulList } from '../core/parse-guard.ts';
import { run, runSync, type ExecReceipt } from '../probes/exec.ts';
import { MUTANT_TIMEOUT_DEFAULT_MS } from './mutants.ts';

/** The sentence each formal REVIEW_FIX narration ends with (card T1-FINDING-REPRO-2, R6); it contains no `class`. */
export const REPRO_REQUEST =
  'For each fixed finding of the Bugs or Security pass, record `aidlc review repro <cardId> <findingId> --argv \'<JSON array>\' --files <paths>` with the test that catches it, and attach one to a `wrong` dispute; a repro is evidence for the next decision and changes no gate.';

/** The timeout of each run: the DoD timeout `aidlc review mutants` gives each DoD run. */
export const REPRO_TIMEOUT_MS = MUTANT_TIMEOUT_DEFAULT_MS;

export interface ReproOptions {
  /** The main checkout: the repository the temporary checkouts are added to, and whose `node_modules` they link. */
  root: string;
  store: GoalStore;
  cardId: string;
  findingId: string;
  goalId?: string;
  /** `--argv`: a JSON array of strings. */
  argv: string;
  /** `--files`: comma-separated repository-relative paths. */
  files?: string;
  now?: () => string;
  timeoutMs?: number;
}

export interface ReproResult {
  goalId: string;
  cardId: string;
  findingId: string;
  repro: FindingRepro;
  /** Temporary checkouts, links or state directories the cleanup could not confirm removed. */
  leftOver: string[];
}

const q = (text: string): string => JSON.stringify(text);

/** `--argv` as a non-empty array of strings; anything else is refused. */
export function parseReproArgv(raw: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  if (!Array.isArray(value) || value.length === 0 || !value.every((a) => typeof a === 'string')) throw new Error(`--argv must be a non-empty JSON array of strings, not ${q(raw)}`);
  return value as string[];
}

/**
 * `--files` split on commas, each in git's form (a backslash is a separator on Windows; `.` segments and a trailing slash
 * dropped). Refused: an absolute path, a path that contains `..`, a path whose first segment is `.aidlc`.
 */
export function parseReproFiles(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  return raw.split(',').map((p) => {
    if (path.isAbsolute(p) || path.posix.isAbsolute(p) || path.win32.isAbsolute(p)) throw new Error(`--files path ${q(p)} is absolute; name it relative to the repository root`);
    if (p.includes('..')) throw new Error(`--files path ${q(p)} contains ..`);
    const slashed = process.platform === 'win32' ? p.replace(/\\/g, '/') : p;
    const norm = path.posix.normalize(slashed).replace(/\/+$/, '');
    if (norm.split('/')[0]!.toLowerCase() === '.aidlc') throw new Error(`--files path ${q(p)} is under .aidlc`);
    return norm;
  });
}

const git = (args: string[], cwd: string): ExecReceipt | undefined => {
  try {
    return runSync('git', args, { cwd, shell: false });
  } catch {
    return undefined;
  }
};

/** Each path's entry in the current candidate: refused when it has none or when it is a symbolic link (mode 120000). */
function checkFiles(root: string, sha: string, files: string[]): void {
  for (const file of files) {
    const listed = git(['--literal-pathspecs', 'ls-tree', '-z', sha, '--', file], root);
    if (listed?.exitCode !== 0) throw new Error(`git ls-tree of ${q(file)} at ${q(sha)} failed: ${q(listed?.stderr.trim() ?? 'git did not run')}`);
    const entry = nulList(listed.stdout).find((e) => e.slice(e.indexOf('\t') + 1) === file && e.includes('\t'));
    if (!entry || file === '.') throw new Error(`--files path ${q(file)} is missing from the current candidate ${q(sha)}`);
    if (entry.startsWith('120000 ')) throw new Error(`--files path ${q(file)} is a symbolic link in the current candidate ${q(sha)}`);
  }
}

/**
 * The goal the card commands act on (`resolveCardGoal`, as `review dispute` resolves it): `--goal` when given, else the one
 * active goal that projects the card, else the one terminal goal that does. Only that goal's run is read; a goal without one
 * has no current candidate.
 */
function findRun(store: GoalStore, cardId: string, explicit: string | undefined): { goalId: string; run: CardRun | undefined } {
  const resolved = resolveCardGoal(store.listGoals(), cardId, { explicit, holdsRun: (id) => store.getCardRun(id, cardId) !== undefined });
  if (!resolved.ok) throw new Error(resolved.error);
  return { goalId: resolved.goalId, run: store.getCardRun(resolved.goalId, cardId) };
}

/** What one run created, as far as it got. */
interface Workspace {
  stateDir?: string;
  holder?: string;
  link?: string;
}

const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
};

/**
 * Removes the `node_modules` link first, so a recursive removal never reaches the main checkout's `node_modules`, then the
 * checkout (`git worktree remove --force`, else delete and prune), then the state directory. Returns what is left.
 */
function closeWorkspace(w: Workspace, root: string): string[] {
  const left: string[] = [];
  let linkRemoved = true;
  if (w.link) {
    try {
      unlinkSync(w.link);
    } catch {
      linkRemoved = false;
      left.push(`link ${w.link}`);
    }
  }
  if (w.holder) {
    const checkout = path.join(w.holder, 'checkout');
    if (linkRemoved) {
      const removed = git(['worktree', 'remove', '--force', checkout], root);
      try {
        rmSync(w.holder, { recursive: true, force: true });
      } catch {
        // reported below
      }
      const pruned = removed?.exitCode === 0 || git(['worktree', 'prune'], root)?.exitCode === 0;
      const listed = git(['worktree', 'list', '--porcelain'], root);
      const named = !listed || listed.exitCode !== 0 || listed.stdout.split(/\r?\n/).some((l) => l.startsWith('worktree ') && samePath(l.slice('worktree '.length), checkout));
      if (existsSync(w.holder) || !pruned || named) left.push(`checkout ${checkout}`);
    } else {
      left.push(`checkout ${checkout}`);
    }
  }
  if (w.stateDir) {
    try {
      rmSync(w.stateDir, { recursive: true, force: true });
    } catch {
      // reported below
    }
    if (existsSync(w.stateDir)) left.push(`state directory ${w.stateDir}`);
  }
  return left;
}

/** One run of the argv in a temporary checkout of `sha`, with `files` taken from `overlaySha`; everything it created is removed on every exit path. */
async function runAt(root: string, sha: string, overlay: { sha: string; files: string[] }, argv: string[], timeoutMs: number, leftOver: string[]): Promise<ReproRun> {
  const w: Workspace = {};
  try {
    // The long, canonical forms, so the path git records compares equal to the one the cleanup looks for.
    w.stateDir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-repro-state-')));
    w.holder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-repro-')));
    const checkout = path.join(w.holder, 'checkout');
    const add = git(['worktree', 'add', '--detach', checkout, sha], root);
    if (add?.exitCode !== 0) throw new Error(`no temporary checkout of ${q(sha)}: ${q(add?.stderr.trim() || `git worktree add exit ${add?.exitCode}`)}`);
    if (overlay.files.length) {
      const taken = git(['--literal-pathspecs', 'checkout', overlay.sha, '--', ...overlay.files], checkout);
      if (taken?.exitCode !== 0) throw new Error(`the --files paths could not be taken from ${q(overlay.sha)}: ${q(taken?.stderr.trim() ?? 'git did not run')}`);
    }
    const modules = path.join(root, 'node_modules');
    if (existsSync(modules)) {
      const link = path.join(checkout, 'node_modules');
      symlinkSync(modules, link, 'junction');
      w.link = link;
    }
    const receipt = await run(argv[0]!, argv.slice(1), { cwd: checkout, env: { ...process.env, AIDLC_STATE_DIR: w.stateDir }, timeoutMs, shell: false });
    return { sha, exitCode: receipt.exitCode, timedOut: receipt.timedOut };
  } finally {
    leftOver.push(...closeWorkspace(w, root));
  }
}

/** Run the repro and record it on the finding; every refusal of R1 throws before the first run. */
export async function runRepro(o: ReproOptions): Promise<ReproResult> {
  const argv = parseReproArgv(o.argv);
  const files = parseReproFiles(o.files);
  const { goalId, run: found } = findRun(o.store, o.cardId, o.goalId);
  if (!found) throw new Error(`card ${q(o.cardId)} has no card run in goal ${q(goalId)}, so no current candidate: record an attempt first`);
  const findingId = o.findingId.toUpperCase();
  const finding = found.findings.find((f) => f.id === findingId);
  if (!finding) throw new Error(`card ${q(o.cardId)} has no finding ${q(o.findingId)}`);
  if (!finding.candidateSha) throw new Error(`finding ${findingId} records no candidateSha: there is no reviewed candidate to run at`);
  const currentSha = found.candidate?.sha;
  if (!currentSha) throw new Error(`card ${q(o.cardId)} has no current candidate: record an attempt first`);
  checkFiles(o.root, currentSha, files);

  const timeoutMs = o.timeoutMs ?? REPRO_TIMEOUT_MS;
  const leftOver: string[] = [];
  const reviewed = await runAt(o.root, finding.candidateSha, { sha: currentSha, files }, argv, timeoutMs, leftOver);
  const current = await runAt(o.root, currentSha, { sha: currentSha, files: [] }, argv, timeoutMs, leftOver);
  const exited = (r: ReproRun, code: (n: number) => boolean) => !r.timedOut && r.exitCode !== null && code(r.exitCode);
  const repro = FindingRepro.parse({ argv, files, reviewed, current, at: (o.now ?? nowIso)(), reproduced: exited(reviewed, (n) => n !== 0) && exited(current, (n) => n === 0) });

  // Under the card-run lock, as `review dispute` writes: the record is read inside it, and only this finding's repro changes.
  o.store.updateCardRun(found.goalId, found.cardId, (persisted) => {
    if (!persisted) throw new Error(`card ${q(o.cardId)} has no card run any more`);
    if (!persisted.findings.some((f) => f.id === findingId)) throw new Error(`card ${q(o.cardId)} has no finding ${q(findingId)} any more`);
    // The finding's `revision` is not bumped: a round compares it with the revision it received and neither resolves nor
    // reopens a finding whose revision moved, so a bump would change a review decision, which a repro must not (R7).
    return { ...persisted, findings: persisted.findings.map((f) => (f.id === findingId ? { ...f, repro } : f)) };
  });
  return { goalId: found.goalId, cardId: found.cardId, findingId, repro, leftOver };
}
