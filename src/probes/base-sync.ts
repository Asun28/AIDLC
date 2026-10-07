/**
 * Doctor's `baseSync` (card T0-DOCTOR-BASE-SYNC): the local base branch against `origin/<base>`.
 * Seam for the RED receipt: reports nothing yet.
 */
import type { GitProbe } from './git.ts';

export interface BaseSyncInputs {
  /** Whether the main checkout is a git repository. */
  isGit: boolean;
  /** The main checkout. */
  cwd: string;
  /** The configured base (`base` in aidlc.config.json), with or without an `origin/` prefix. */
  base: string;
  git: GitProbe;
}

export function baseSyncReport(input: BaseSyncInputs): string {
  return input.isGit ? 'n/a' : 'n/a';
}
