/**
 * Mutant runner (card T1-VERIFY-MUTANTS, spec review-verification R18 and R19).
 *
 * `runMutants` takes the generator's mutants of a card's committed candidate, applies them one at a
 * time, runs the card's DoD on each and restores each file from the bytes it read; no git command it
 * runs writes. While a mutant is on disk the marker holds the file's original bytes, so an interrupted
 * run is repaired by `restoreMutants`. The report is advisory evidence bound to the candidate commit:
 * no gate reads it and nothing here touches a card run, a goal or the journal.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { nulList } from '../core/parse-guard.ts';
import { MUTATION_OPERATORS, MutantReport, MutantPending, type Card, type MutantOutcome, type MutantResult } from '../core/types.ts';
import type { ExecReceipt, Runner, SyncRunner } from '../probes/exec.ts';
import { GitProbe } from '../probes/git.ts';
import { atomicWriteJson, createExclusive, readJson } from '../state/store.ts';
import { applyMutant, changedSourceLines, mutantsFor, type Mutant } from './mutant-gen.ts';

export const MUTANT_MAX_DEFAULT = 30;
/** About 2.5 times the slowest targeted DoD measured on the development machine, so only a hung mutant reaches it. */
export const MUTANT_TIMEOUT_DEFAULT_MS = 120_000;
/** The largest delay a Node timer keeps; a longer one fires after 1 ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;
const REFUSAL_ENTRIES = 5;

/**
 * The plain `--unified=0` text `changedSourceLines` reads, under any user git configuration: the
 * explicit prefixes answer `diff.noprefix` and `diff.mnemonicPrefix`, `--inter-hunk-context=0`
 * answers `diff.interHunkContext` (which would merge hunks with context lines the reader refuses),
 * `--find-renames` answers `diff.renames`, `core.quotePath=false` keeps a non-ASCII path unquoted,
 * and `--text` keeps a file with a `-diff` attribute or a NUL byte in the diff.
 */
const DIFF = ['-c', 'core.quotePath=false', 'diff', '--text', '--unified=0', '--inter-hunk-context=0', '--find-renames', '--src-prefix=a/', '--dst-prefix=b/', '--no-color', '--no-ext-diff', '--no-textconv'];
/** Before every git command: `git status` writes no index and starts no fsmonitor program. */
const GIT_READ_ONLY = ['--no-optional-locks', '-c', 'core.fsmonitor=false'];

export const mutantsReportPath = (worktree: string, card: string): string => path.join(worktree, '.review', `${card}.mutants.json`);
export const mutantsMarkerPath = (worktree: string, card: string): string => path.join(worktree, '.review', `${card}.mutants.pending.json`);

export interface RunMutantsInput {
  card: Pick<Card, 'id' | 'dod_command' | 'dod_exit'>;
  worktree: string;
  /** The run's base oid, else the configured base. */
  base: string;
  max?: number;
  timeoutMs?: number;
}

export interface MutantsDeps {
  git: SyncRunner;
  dod: Runner;
  now: () => string;
  progress?: (line: string) => void;
}

export interface MutantRestore {
  outcome: 'nothing' | 'restored' | 'original' | 'idle';
  message: string;
}

interface Target {
  file: string;
  full: string;
  bytes: Buffer;
  source: string;
  mutant: Mutant;
}

/**
 * The environment of every git command. No inherited `GIT_*` variable reaches it: `GIT_DIFF_OPTS` overrides `--unified=0` and
 * `GIT_DIR` points git at another repository. `GIT_NO_LAZY_FETCH` stops a lazy fetch on git 2.45 and later, and an empty
 * `GIT_ALLOW_PROTOCOL` allows no transport on any version, so a missing object is an error and nothing reaches the object store.
 */
function gitEnv(): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_'));
  return { ...Object.fromEntries(inherited), GIT_NO_LAZY_FETCH: '1', GIT_ALLOW_PROTOCOL: '' };
}

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const positive = (n: number): boolean => Number.isSafeInteger(n) && n > 0;
const interrupted = (marker: string, card: string): string => `a mutant run was interrupted: ${marker} exists, so a source file may hold a mutant; run \`aidlc card mutants ${card} --restore\``;

/**
 * `full`, refused when it leaves the worktree or when a parent below the worktree is anything but a real directory. A path
 * inside a checkout is chosen by the candidate and a DoD run can put a link there at any time, so each read and write calls
 * this in the same synchronous step, and a missing parent is one a later write creates as a directory.
 */
function contained(worktree: string, full: string): string {
  const relative = path.relative(worktree, full);
  const parts = relative.split(path.sep);
  if (relative === '' || parts[0] === '..' || path.isAbsolute(relative)) throw new Error(`${JSON.stringify(full)} is outside the worktree ${worktree}`);
  let at = worktree;
  for (const part of parts.slice(0, -1)) {
    at = path.join(at, part);
    const stat = lstatSync(at, { throwIfNoEntry: false });
    if (stat && !stat.isDirectory()) throw new Error(`${at} is not a directory: a link there can lead out of the worktree, so the sweep stops`);
  }
  return full;
}

/**
 * The bytes of a regular file inside the worktree; a symlink, a directory or a missing path has none, so no read follows a
 * link. A file with a second hard link is refused: an in-place write would change that other name, which can be outside.
 */
function bytesOf(worktree: string, full: string): Buffer | undefined {
  const stat = lstatSync(contained(worktree, full), { throwIfNoEntry: false });
  if (!stat?.isFile()) return undefined;
  if (stat.nlink > 1) throw new Error(`${full} has ${stat.nlink} hard links: a write to it can change a file outside the worktree, so the sweep stops`);
  return readFileSync(full);
}

/** The marker path, refused when anything but a regular file with one name is there, since the marker's bytes decide what a restore writes. */
function markerOf(worktree: string, card: string): string {
  const marker = contained(worktree, mutantsMarkerPath(worktree, card));
  const stat = lstatSync(marker, { throwIfNoEntry: false });
  if (stat && (!stat.isFile() || stat.nlink > 1)) throw new Error(`${marker} is not a regular file with one name, so it is not read`);
  return marker;
}

function diffOf(runner: SyncRunner, worktree: string, range: string): string {
  const diff = runner('git', [...DIFF, range], { cwd: worktree });
  if (diff.exitCode !== 0) throw new Error(`git diff ${range} failed in ${worktree}: ${diff.stderr.trim() || `exit ${diff.exitCode}`}`);
  return diff.stdout;
}

/**
 * The regular files of the candidate's tree under `src`. The tree mode says what an entry is: `core.symlinks=false` checks a
 * symlink out as a regular file, which `lstat` cannot tell apart. An entry reads `<mode> <type> <oid>\t<path>`, and the modes
 * of a regular file start with 100, a symlink is 120000 and a submodule 160000.
 */
function regularFiles(runner: SyncRunner, worktree: string, candidate: string): Set<string> {
  const tree = runner('git', ['ls-tree', '-r', '-z', candidate, '--', 'src'], { cwd: worktree });
  if (tree.exitCode !== 0) throw new Error(`git ls-tree ${candidate} failed in ${worktree}: ${tree.stderr.trim() || `exit ${tree.exitCode}`}`);
  return new Set(nulList(tree.stdout).filter((entry) => entry.startsWith('100')).map((entry) => entry.slice(entry.indexOf('\t') + 1)));
}

/** Every mutant of the changed regular source files: files in path order, each file's mutants in the generator's order. */
function targetsOf(worktree: string, diff: string, regular: Set<string>): Target[] {
  const targets: Target[] = [];
  const changed = changedSourceLines(diff).sort((a, b) => (a.file < b.file ? -1 : 1));
  for (const { file, lines } of changed) {
    if (!regular.has(file)) continue;
    const full = path.join(worktree, file);
    const bytes = bytesOf(worktree, full);
    if (!bytes) continue;
    const source = bytes.toString('utf8');
    // Text that does not round trip is not valid UTF-8, and a mutant written from it would change more than the mutant.
    if (!Buffer.from(source, 'utf8').equals(bytes)) continue;
    for (const mutant of mutantsFor(source, lines)) targets.push({ file, full, bytes, source, mutant });
  }
  return targets;
}

function outcomeOf(receipt: ExecReceipt, dodExit: number): MutantOutcome {
  if (receipt.timedOut) return 'timeout';
  return receipt.exitCode === dodExit ? 'survived' : 'killed';
}

/** The one call of a card's DoD, shared by the sweep and `card attempt` (card T1-DOD-RECORD): through the platform shell in the worktree. */
export function dodCall(card: Pick<Card, 'dod_command'>, worktree: string, timeoutMs: number): [string, string[], { cwd: string; shell: true; timeoutMs: number }] {
  return [card.dod_command, [], { cwd: worktree, shell: true, timeoutMs }];
}

/** Apply the mutants of a committed candidate one at a time under the card's DoD and write the report bound to that commit. */
export async function runMutants(input: RunMutantsInput, deps: MutantsDeps): Promise<{ report: MutantReport; path: string }> {
  const { card, worktree, base, max = MUTANT_MAX_DEFAULT, timeoutMs = MUTANT_TIMEOUT_DEFAULT_MS } = input;
  if (!positive(max)) throw new Error(`--max must be a positive integer, got ${max}`);
  if (!positive(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) throw new Error(`--timeout-ms must be a positive integer of at most ${MAX_TIMEOUT_MS}, got ${timeoutMs}`);
  if (base.startsWith('-')) throw new Error(`the base ${JSON.stringify(base)} starts with -, which git would read as an option`);
  const marker = markerOf(worktree, card.id);
  if (existsSync(marker)) throw new Error(interrupted(marker, card.id));
  const startedAt = deps.now();
  const read: SyncRunner = (command, args, options) => deps.git(command, [...GIT_READ_ONLY, ...args], { ...options, env: gitEnv() });
  const git = new GitProbe(read);
  const { entries } = git.status(worktree);
  if (entries.length > 0) {
    const more = entries.length > REFUSAL_ENTRIES ? ` and ${entries.length - REFUSAL_ENTRIES} more` : '';
    throw new Error(`${worktree} has uncommitted or untracked changes: ${entries.slice(0, REFUSAL_ENTRIES).join(', ')}${more}; commit or remove them first`);
  }
  const candidate = git.head(worktree);
  const targets = targetsOf(worktree, diffOf(read, worktree, `${base}...${candidate}`), regularFiles(read, worktree, candidate));
  const chosen = targets.slice(0, max);
  const dod = () => deps.dod(...dodCall(card, worktree, timeoutMs));

  const baseline = await dod();
  if (baseline.timedOut) throw new Error(`the DoD timed out after ${timeoutMs} ms on the unmutated candidate; raise --timeout-ms`);
  if (baseline.exitCode !== card.dod_exit) throw new Error(`the DoD ended with exit code ${baseline.exitCode} on the unmutated candidate, not ${card.dod_exit}; no mutant can be judged`);

  const idle: MutantPending = { schemaVersion: 1, cardId: card.id, candidateSha: candidate };
  if (!createExclusive(contained(worktree, marker), JSON.stringify(idle))) throw new Error(interrupted(marker, card.id));
  const mutants: MutantResult[] = [];
  // True from the marker write that names a file until its original bytes are back: the marker then outlives any stop.
  let applied = false;
  let stop: { error: unknown } | undefined;
  try {
    for (const [index, { file, full, bytes, source, mutant }] of chosen.entries()) {
      if (!bytesOf(worktree, full)?.equals(bytes)) throw new Error(`${file} changed during the sweep: it no longer holds the bytes this run read, so no mutant was written over it`);
      const mutantBytes = Buffer.from(applyMutant(source, mutant), 'utf8');
      applied = true;
      atomicWriteJson(contained(worktree, marker), { ...idle, applied: { file, originalBase64: bytes.toString('base64'), originalSha256: sha256(bytes), mutantSha256: sha256(mutantBytes) } } satisfies MutantPending);
      writeFileSync(full, mutantBytes);
      let receipt: ExecReceipt | undefined;
      let failure: { error: unknown } | undefined;
      try {
        receipt = await dod();
      } catch (error) {
        failure = { error };
      }
      if (!bytesOf(worktree, full)?.equals(mutantBytes)) throw new Error(`${file} no longer holds the mutant after its DoD run: the file and ${marker} stay as they are; compare them by hand`);
      writeFileSync(full, bytes);
      applied = false;
      if (!receipt) throw failure?.error;
      atomicWriteJson(contained(worktree, marker), idle);
      const outcome = outcomeOf(receipt, card.dod_exit);
      const { line, column, operator, original, mutated } = mutant;
      mutants.push({ file, line, column, operator, original, mutated, outcome, exitCode: receipt.exitCode, durationMs: receipt.durationMs });
      deps.progress?.(`mutant ${index + 1}/${chosen.length} ${file}:${line}:${column} ${operator}: ${outcome} (exit ${receipt.exitCode}, ${receipt.durationMs} ms)`);
    }
  } catch (error) {
    stop = { error };
  }
  if (!applied) {
    try {
      rmSync(contained(worktree, marker));
    } catch (error) {
      stop ??= { error };
    }
  }
  if (stop) throw stop.error;

  const head = git.head(worktree);
  if (head !== candidate) throw new Error(`the worktree HEAD moved from ${candidate} to ${head} during the sweep; no report is written`);
  const count = (outcome: MutantOutcome) => mutants.filter((m) => m.outcome === outcome).length;
  const report = MutantReport.parse({
    schemaVersion: 1,
    cardId: card.id,
    candidateSha: candidate,
    base,
    dodCommand: card.dod_command,
    operators: [...MUTATION_OPERATORS],
    max,
    timeoutMs,
    baselineDurationMs: baseline.durationMs,
    generated: targets.length,
    skipped: targets.length - chosen.length,
    totals: { killed: count('killed'), survived: count('survived'), timeout: count('timeout') },
    startedAt,
    finishedAt: deps.now(),
    mutants,
  });
  const reportPath = mutantsReportPath(worktree, card.id);
  atomicWriteJson(contained(worktree, reportPath), report);
  return { report, path: reportPath };
}

/** Repair an interrupted run from its marker: write the original bytes back over the mutant, or refuse a file that holds anything else. */
export function restoreMutants(worktree: string, card: string): MutantRestore {
  const marker = markerOf(worktree, card);
  const pending = readJson(marker, MutantPending);
  if (!pending) return { outcome: 'nothing', message: `${card}: nothing needs restoring` };
  const { applied } = pending;
  if (!applied) {
    rmSync(marker);
    return { outcome: 'idle', message: `${card}: no mutant was applied; deleted ${marker}` };
  }
  const { file } = applied;
  const full = path.resolve(worktree, file);
  const original = Buffer.from(applied.originalBase64, 'base64');
  if (sha256(original) !== applied.originalSha256) throw new Error(`the original bytes in ${marker} do not match their sha256, so ${file} is left as it is`);
  const current = bytesOf(worktree, full);
  const digest = current && sha256(current);
  if (digest === applied.originalSha256) {
    rmSync(marker);
    return { outcome: 'original', message: `${card}: ${file} already holds the original; deleted ${marker}` };
  }
  if (digest !== applied.mutantSha256) throw new Error(`${file} holds neither the mutant nor the original; ${marker} holds the original bytes and stays, so resolve the file by hand`);
  writeFileSync(full, original);
  rmSync(marker);
  return { outcome: 'restored', message: `${card}: restored ${file} and deleted ${marker}` };
}

/** The totals of a report and each survivor as `file:line:column operator`. */
export function mutantSummaryText(report: MutantReport, reportPath: string): string {
  const { totals, mutants } = report;
  const survivors = mutants.filter((m) => m.outcome === 'survived').map((m) => `  ${m.file}:${m.line}:${m.column} ${m.operator}`);
  return [
    `${report.cardId} mutants on ${report.candidateSha}: ${mutants.length} of ${report.generated} run, ${report.skipped} skipped: ${totals.killed} killed, ${totals.survived} survived, ${totals.timeout} timeout`,
    ...(survivors.length > 0 ? ['survived:', ...survivors] : []),
    `report: ${reportPath}`,
  ].join('\n');
}
