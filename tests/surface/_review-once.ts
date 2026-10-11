// The single-pass reviewer entry points the tests use (card T1-SWEEP-REVIEW-WRAPPERS). The loop runs every reviewer
// through runReviewPanel since the R2 panel (a7bbcae); these compose the same building blocks for one synchronous pass,
// with the signatures they had in src/review/pre-review.ts.
import { buildReviewPrompt, expandCommand, finalizeReview, readVerdict, reviewerEnv, type PreReviewPromptInput, type PreReviewResult, type ReviewRetentionOptions } from '../../src/review/pre-review.ts';
import type { Verdict } from '../../src/core/types.ts';
import type { SyncRunner } from '../../src/probes/exec.ts';

export interface RunPreReviewOptions extends ReviewRetentionOptions {
  runner: SyncRunner;
  /** argv, with optional `{name}` placeholders; the prompt goes to stdin unless `{instructions}` is present. */
  command: string[];
  /** Placeholder values; `instructions` defaults to the prompt. */
  vars?: Record<string, string>;
  cwd: string;
  prompt: string;
  timeoutMs: number;
  /** Run through a shell (script wrappers on Windows); default: win32 only. */
  shell?: boolean;
}

export function buildPreReviewPrompt(i: PreReviewPromptInput): string {
  return buildReviewPrompt({ ...i, stage: 'pre', includeDiff: true });
}

/** The verdict document of an output: `readVerdict` without the rejected coverage entries. */
export function extractVerdict(output: string): Verdict | undefined {
  return readVerdict(output).verdict;
}

/** Run one reviewer process synchronously (single full pass). */
export function runPreReview(o: RunPreReviewOptions): PreReviewResult {
  const { argv, promptInArgv } = expandCommand(o.command, { ...(o.vars ?? {}), instructions: o.vars?.['instructions'] ?? o.prompt });
  const [cmd, ...args] = argv;
  if (!cmd) throw new Error('review command is empty');
  // Dynamic text never goes through a shell: argv instructions force a direct spawn.
  const receipt = o.runner(cmd, args, { cwd: o.cwd, env: reviewerEnv(), input: promptInArgv ? '' : o.prompt, timeoutMs: o.timeoutMs, shell: promptInArgv ? false : (o.shell ?? process.platform === 'win32') });
  return finalizeReview(receipt, o);
}
