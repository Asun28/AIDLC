/**
 * The effort level a formal (R3) reviewer runs at, chosen per candidate from that reviewer's `effort` policy.
 * Pure: the glob matcher is passed in (the loop passes the scope gate's `pathAllowed`), since core imports no outer layer.
 */
import type { ReviewEffortLevel, ReviewEffortPolicy } from './types.ts';

export interface ReviewEffortInput {
  /** Added plus deleted lines of the candidate against the base the decision is bound to. */
  changedLines: number;
  changedPaths: string[];
}

/** Whether a changed path matches one of the globs. */
export type PathMatcher = (changedPath: string, globs: string[]) => boolean;

/** `medium` without a policy; `high` when the changed lines reach `high.minChangedLines` or a changed path matches `high.paths`; the policy's `default` otherwise. */
export function selectReviewEffort(policy: ReviewEffortPolicy | undefined, input: ReviewEffortInput, matches: PathMatcher): ReviewEffortLevel {
  if (!policy) return 'medium';
  const high = policy.high;
  if (high && (input.changedLines >= high.minChangedLines || input.changedPaths.some((p) => matches(p, high.paths)))) return 'high';
  return policy.default;
}

/**
 * Added plus deleted lines of a unified diff, counted from the pinned --text diff collected for the review: inside a hunk (from an
 * `@@ ` line to the next `diff --git ` line) every line starting with `+` or `-`, so an added line whose content begins
 * with `++` counts; the file headers before a section's first hunk (`---`, `+++`, rename, mode, `Binary files`) and
 * `\ No newline at end of file` never do.
 */
export function countDiffLines(diff: string): number {
  let inHunk = false;
  let lines = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) inHunk = false;
    else if (line.startsWith('@@ ')) inHunk = true;
    else if (inHunk && (line.startsWith('+') || line.startsWith('-'))) lines += 1;
  }
  return lines;
}

/**
 * The source paths of the renames in a unified diff (`rename from <path>` header lines; a hunk line always starts with a
 * space, `+`, `-` or `\`, so none is one). A path git C-quotes is returned with its quotes removed and its escapes as written.
 */
export function renameSources(diff: string): string[] {
  const sources: string[] = [];
  for (const line of diff.split(/\r?\n/)) {
    if (!line.startsWith('rename from ')) continue;
    const p = line.slice('rename from '.length);
    sources.push(p.length >= 2 && p.startsWith('"') && p.endsWith('"') ? p.slice(1, -1) : p);
  }
  return sources;
}

/**
 * The level for the collected candidate diff: its hunk lines counted, and the path rule matched against the changed paths
 * and the rename sources. Fail closed: a non-empty diff with no `diff --git ` section (coloured, or written by an external
 * driver) is not a count of zero and selects `high`, or the policy's `xhigh` or `max` default when that is higher.
 */
export function selectReviewEffortFromDiff(policy: ReviewEffortPolicy | undefined, diff: string, changedPaths: string[], matches: PathMatcher): ReviewEffortLevel {
  const lines = diff.split(/\r?\n/);
  if (diff.trim() && !lines.some((l) => l.startsWith('diff --git '))) return policy?.default === 'xhigh' || policy?.default === 'max' ? policy.default : 'high';
  return selectReviewEffort(policy, { changedLines: countDiffLines(diff), changedPaths: [...changedPaths, ...renameSources(diff)] }, matches);
}
