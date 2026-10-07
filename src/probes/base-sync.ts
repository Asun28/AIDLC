/**
 * Doctor's `baseSync` (card T0-DOCTOR-BASE-SYNC): the local base branch against `origin/<base>` in the main
 * checkout, read from the refs as they are (never a fetch), with the git command that brings the two together.
 * Planning commits left only on local main are invisible to card branches cut from origin, so a card PR that
 * edits the same text conflicts with them at the next sync; this line makes that drift visible at every entry.
 * Every git call runs as `git --no-lazy-fetch <command>`, so a partial clone never fetches a missing object from
 * its promisor remote (T0-DOCTOR-BASE-SYNC R3 decision 1); a git older than 2.45, the first release with the option,
 * refuses it (exit 129) and the value is UNREADABLE (T0-DOCTOR-BASE-SYNC-2).
 */
import { runSync, type SyncRunner } from './exec.ts';
import { GitProbe, GitProbeError } from './git.ts';

export interface BaseSyncInputs {
  /** Whether the main checkout is a git repository. */
  isGit: boolean;
  /** The main checkout. */
  cwd: string;
  /** The configured base (`base` in aidlc.config.json), with or without an `origin/` prefix. */
  base: string;
  /** Runs git; `runSync` when absent. The check puts `--no-lazy-fetch` before every git command it runs through it. */
  runner?: SyncRunner;
}

/** A branch name safe to print in a command line: ASCII letters and digits, `.`, `_`, `/`, `-`, not empty and not led by `-`. */
const PLAIN_BRANCH = /^(?!-)[A-Za-z0-9._/-]+$/;

/** The runner with `--no-lazy-fetch` before every git command: a missing object is an error, never a fetch from a promisor remote. */
function noLazyFetch(runner: SyncRunner): SyncRunner {
  return (command, args, options) => runner(command, command === 'git' ? ['--no-lazy-fetch', ...args] : args, options);
}

/** The `baseSync` value; never throws, and git's own text never reaches it. */
export function baseSyncReport(input: BaseSyncInputs): string {
  if (!input.isGit) return 'n/a';
  const name = input.base.replace(/^origin\//, '');
  if (!PLAIN_BRANCH.test(name)) return 'n/a (base is not a plain branch name)';
  const local = `refs/heads/${name}`;
  const remote = `refs/remotes/origin/${name}`;
  const git = new GitProbe(noLazyFetch(input.runner ?? runSync));
  let localOid: string | undefined;
  let remoteOid: string | undefined;
  try {
    localOid = git.commitOf(input.cwd, local);
    remoteOid = git.commitOf(input.cwd, remote);
  } catch (err) {
    return unreadable('rev-parse', err);
  }
  if (localOid === undefined) return `n/a (no ${name} branch)`;
  if (remoteOid === undefined) return `n/a (no origin/${name})`;
  let counts: { behind: number; ahead: number };
  try {
    counts = git.divergence(input.cwd, remote, local);
  } catch (err) {
    return unreadable('rev-list', err);
  }
  const { ahead, behind } = counts;
  const origin = `origin/${name}`;
  if (ahead === 0 && behind === 0) return `in sync with ${origin}`;
  if (behind === 0) return `ahead ${ahead} of ${origin}: unpublished commits on ${name}; push them (git push origin ${name})`;
  if (ahead === 0) return `behind ${behind} of ${origin}: on ${name}, git merge --ff-only ${origin}`;
  return `diverged from ${origin} (ahead ${ahead}, behind ${behind}): on ${name}, git merge ${origin}, resolve, then git push origin ${name}`;
}

/** A failed git step by its exit code from the probe's receipt, `UNREADABLE` when there is none; git's text never appears. */
function unreadable(command: 'rev-parse' | 'rev-list', err: unknown): string {
  const code = err instanceof GitProbeError && typeof err.receipt.exitCode === 'number' ? `exit ${err.receipt.exitCode}` : 'UNREADABLE';
  return `UNREADABLE: git ${command} failed (${code})`;
}
