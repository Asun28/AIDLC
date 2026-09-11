/**
 * Pre-review (R2): a bounded second-model review of the committed candidate before the ship, so the
 * formal PR review (R3, two substantive decisions) sees candidates that already survived a cheaper
 * independent pass.
 *
 * The reviewer is any command that reads the prompt on stdin and prints the REVIEW.md verdict JSON
 * as its last line (DeepSeek V4 Pro through the local `deepseek` CLI in this repository). Every run
 * is receipted (exit, output digest, duration); the verdict and the raw output are retained next to
 * the candidate under `.review/`. Missing, malformed or stale output is never a pass.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { detectQuotaHold, parseVerdict } from '../core/review-policy.ts';
import type { Card, PreReviewOutcome, RunStatus, Verdict } from '../core/types.ts';
import type { ExecReceipt, SyncRunner } from '../probes/exec.ts';

export interface PreReviewPromptInput {
  reviewPolicy: string;
  card: Card;
  base: string;
  head: string;
  changedPaths: string[];
  diff: string;
  truncated: boolean;
  /** Findings the reviewer must verify as resolved: the previous round's block, or the R3 reasons. */
  priorFindings: string[];
  round: number;
  maxRounds: number;
}

export const VERDICT_CONTRACT =
  '{"verdict":"pass|block","reasons":["[spec|standards] <dimension> @ <file:line>: <why> -> <fix>"],"axes":{"spec":{"verdict":"pass|block","reasons":[]},"standards":{"verdict":"pass|block","reasons":[]}}}';

export function buildPreReviewPrompt(i: PreReviewPromptInput): string {
  const c = i.card;
  const lines: string[] = [];
  lines.push(
    `You are the independent pre-reviewer (R2) for card ${c.id}, round ${i.round} of ${i.maxRounds}. You did not write this change and you cannot edit it. Judge only this diff against this card and the review policy below. The formal reviewer (R3) runs after you, so block only on a must-block dimension (1-6) or an Important finding that would break behaviour, leak data or breach a policy; style and naming are nits and never block. Do not report generated files or anything CI already enforces. Cap nits at five.`,
  );
  lines.push('', 'Think briefly, then output exactly one JSON document as the LAST line of your answer, nothing after it:', VERDICT_CONTRACT, '`verdict` is the worse of the two axes; `reasons` is empty on pass.');
  lines.push('', '## Review policy (REVIEW.md)', i.reviewPolicy.trim());
  lines.push('', '## Card contract', `- id: ${c.id}`, `- title: ${c.title}`, `- tier: ${c.tier ?? 'computed from allow_paths'}`, `- allow_paths: ${c.allow_paths.join(', ')}`);
  if (c.non_goals?.length) lines.push(`- non_goals: ${c.non_goals.join('; ')}`);
  if (c.forbid?.length) lines.push(`- forbid: ${c.forbid.join('; ')}`);
  if (c.diagnosis) lines.push(`- diagnosis.root_cause: ${c.diagnosis.root_cause}`);
  lines.push(`- tdd: ${c.tdd}`, `- dod_command: ${c.dod_command}`, '- acceptance (closed list):', ...c.acceptance.map((a) => `  ${a}`));
  lines.push('', '## Findings to verify', ...(i.priorFindings.length ? i.priorFindings.map((f) => `- ${f}`) : ['- none (first round of this cycle)']));
  lines.push('', '## Candidate', `- base: ${i.base}`, `- head: ${i.head}`, `- changed paths (${i.changedPaths.length}): ${i.changedPaths.join(', ') || 'none'}`);
  if (i.truncated) lines.push('- note: the diff was truncated to the configured byte cap; judge what is shown and say so in reasons if it matters.');
  lines.push('', '## Diff', '```diff', i.diff.trimEnd(), '```', '', 'Remember: the last line of your answer must be the JSON verdict document.');
  return lines.join('\n') + '\n';
}

/** The last line of the output that parses as a verdict document; reasoning and prose before it are ignored. */
export function extractVerdict(output: string): Verdict | undefined {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const start = line.indexOf('{');
    const end = line.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    try {
      const v = parseVerdict(JSON.parse(line.slice(start, end + 1)));
      if (v) return v;
    } catch {
      /* not this line */
    }
  }
  return undefined;
}

export interface PreReviewClassification {
  outcome: PreReviewOutcome;
  runStatus: RunStatus;
  reasons: string[];
}

export function classifyPreReview(verdict: Verdict | undefined, receipt: Pick<ExecReceipt, 'exitCode' | 'timedOut' | 'stdout' | 'stderr'>): PreReviewClassification {
  if (receipt.timedOut) return { outcome: 'no-verdict', runStatus: 'timeout', reasons: [] };
  if (verdict) {
    const reasons = verdict.reasons.length ? verdict.reasons : [...(verdict.axes?.spec?.reasons ?? []), ...(verdict.axes?.standards?.reasons ?? [])];
    return { outcome: verdict.verdict, runStatus: 'success', reasons };
  }
  if (detectQuotaHold(`${receipt.stdout}\n${receipt.stderr}`).hold) return { outcome: 'quota-hold', runStatus: 'tool_error', reasons: [] };
  if (receipt.exitCode !== 0) return { outcome: 'no-verdict', runStatus: 'tool_error', reasons: [] };
  return { outcome: 'no-verdict', runStatus: receipt.stdout.trim() ? 'malformed' : 'no_output', reasons: [] };
}

export interface CandidateDiff {
  changedPaths: string[];
  diff: string;
  truncated: boolean;
}

/** `git diff <base>...HEAD` of the committed candidate, capped so the prompt stays within budget. */
export function collectCandidateDiff(runner: SyncRunner, cwd: string, baseRef: string, maxBytes: number): CandidateDiff {
  const range = `${baseRef}...HEAD`;
  const names = runner('git', ['diff', '--name-only', range], { cwd });
  if (names.exitCode !== 0) throw new Error(`git diff --name-only ${range} failed in ${cwd}: ${names.stderr.trim() || `exit ${names.exitCode}`}`);
  const full = runner('git', ['diff', range], { cwd });
  if (full.exitCode !== 0) throw new Error(`git diff ${range} failed in ${cwd}: ${full.stderr.trim() || `exit ${full.exitCode}`}`);
  const changedPaths = names.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const truncated = Buffer.byteLength(full.stdout, 'utf8') > maxBytes;
  const diff = truncated ? `${Buffer.from(full.stdout, 'utf8').subarray(0, maxBytes).toString('utf8')}\n[... diff truncated at ${maxBytes} bytes ...]\n` : full.stdout;
  return { changedPaths, diff, truncated };
}

export interface RunPreReviewOptions {
  runner: SyncRunner;
  /** argv; the prompt arrives on stdin. */
  command: string[];
  cwd: string;
  prompt: string;
  timeoutMs: number;
  /** Run through a shell (script wrappers on Windows); default: win32 only. */
  shell?: boolean;
  reviewDir: string;
  fileStem: string;
  head: string;
  reviewer: string;
}

export interface PreReviewResult extends PreReviewClassification {
  verdict?: Verdict;
  receipt: ExecReceipt;
  verdictRef?: string;
  logRef: string;
}

/** Run the pre-reviewer once, classify the output and retain verdict + raw output next to the candidate. */
export function runPreReview(o: RunPreReviewOptions): PreReviewResult {
  const [cmd, ...args] = o.command;
  if (!cmd) throw new Error('preReview.command is empty');
  const receipt = o.runner(cmd, args, { cwd: o.cwd, input: o.prompt, timeoutMs: o.timeoutMs, shell: o.shell ?? process.platform === 'win32' });
  const verdict = extractVerdict(receipt.stdout);
  const cls = classifyPreReview(verdict, receipt);
  mkdirSync(o.reviewDir, { recursive: true });
  const logRef = path.join(o.reviewDir, `${o.fileStem}.log`);
  writeFileSync(
    logRef,
    [`# pre-review ${o.reviewer} exit=${receipt.exitCode} timedOut=${receipt.timedOut} durationMs=${receipt.durationMs} outputSha256=${receipt.outputSha256} outcome=${cls.outcome} runStatus=${cls.runStatus}`, '## stdout', receipt.stdout, '## stderr', receipt.stderr].join('\n'),
    'utf8',
  );
  let verdictRef: string | undefined;
  if (verdict) {
    verdictRef = path.join(o.reviewDir, `${o.fileStem}.json`);
    const doc = { ...verdict, sha: o.head, reviewer: o.reviewer, stage: 'pre', outcome: cls.outcome, run_status: cls.runStatus, requestedAt: receipt.startedAt, durationMs: receipt.durationMs, receiptSha256: receipt.outputSha256 };
    writeFileSync(verdictRef, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  }
  return { ...cls, verdict, receipt, verdictRef, logRef };
}
