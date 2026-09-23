/**
 * Project configuration (`aidlc.config.json`), kept deliberately small: paths, base/mode,
 * the single ship path (with its GitHub gate options), review pool, worker cap, model family and hook settings.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Pre-review (R2): a second-model review before the ship. An empty command disables the stage. */
export const PreReviewConfig = z.object({
  /** argv of the reviewer; the prompt arrives on stdin and the verdict JSON must be the last stdout line. */
  command: z.array(z.string()).default([]),
  reviewer: z.string().default('deepseek-v4-pro'),
  /** Concurrent angles per round (bugs, security, compliance); empty = one full pass. */
  perspectives: z.array(z.string()).default([]),
  /** Blocks allowed per R3 cycle before onExhausted applies. */
  rounds: z.number().int().min(1).max(3).default(2),
  /** Acceptance coverage from the `ac-coverage` angle: `off` asks for nothing; `shadow` asks for one entry per acceptance item and records the join without changing any outcome. */
  coverage: z.enum(['off', 'shadow']).default('off'),
  timeoutMs: z.number().int().positive().default(10 * 60 * 1000),
  onExhausted: z.enum(['stop', 'ship']).default('stop'),
  /** Run through a shell (script wrappers on Windows); default: win32 only. */
  shell: z.boolean().optional(),
  maxDiffBytes: z.number().int().positive().default(300_000),
});
export type PreReviewConfig = z.infer<typeof PreReviewConfig>;

/**
 * Formal review (R3) as a command before the ship. Placeholders in argv: {instructions} {base} {head}
 * {card} {schema} {cwd}; without {instructions} the prompt goes to stdin. Empty command = the R3
 * verdict comes from the ship path (scaffold ReviewGate) or nowhere.
 */
const FormalReviewerConfig = z.object({
  command: z.array(z.string()).default([]),
  reviewer: z.string().default('codex'),
  timeoutMs: z.number().int().positive().default(20 * 60 * 1000),
  shell: z.boolean().optional(),
  maxDiffBytes: z.number().int().positive().default(300_000),
});
/**
 * The reviewer R3 dispatches while the primary holds an unexpired quota hold; it shares the primary's allowance. No
 * argument may be empty: a reviewer runs through a shell on Windows, which drops an empty argument (write `--flag=`).
 */
export const FormalReviewFallback = FormalReviewerConfig.extend({
  command: z.array(z.string()).min(1).refine((argv) => argv.every((a) => a.length > 0), 'formalReview.fallback.command must not carry an empty argument: the Windows shell drops it (write --flag= instead)'),
  reviewer: z.string().min(1),
});
export type FormalReviewFallback = z.infer<typeof FormalReviewFallback>;
export const FormalReviewConfig = FormalReviewerConfig.extend({ fallback: FormalReviewFallback.optional() });
export type FormalReviewConfig = z.infer<typeof FormalReviewConfig>;

/** GitHub ship path: required check-run names, the verdict rule and the CI polling limits. */
export const GitHubShipConfig = z.object({
  /** Check-run names that must be present and conclude success before the merge; an absent name is pending, never satisfied, and skipped or neutral never satisfies a required name. Every other check that reports on the head must succeed as well. */
  requiredChecks: z.array(z.string()).default([]),
  /** A fresh candidate-bound R3 verdict is required before any remote effect. False (only without gateRequired) tolerates a missing or stale verdict; a block verdict for the head always fails the ship. */
  requireVerdict: z.boolean().default(true),
  /** Defaults in the ship path: 30 minutes, polled every 20 seconds. */
  ciTimeoutMs: z.number().int().positive().optional(),
  ciPollMs: z.number().int().positive().optional(),
});
export type GitHubShipConfig = z.infer<typeof GitHubShipConfig>;
export const ProjectConfig = z.object({
  schemaVersion: z.literal(1).default(1),
  cardsDir: z.string().default('specs/tasks'),
  archiveDir: z.string().default('specs/archive/tasks'),
  intentDir: z.string().default('intent'),
  specsDir: z.string().default('specs'),
  plansDir: z.string().default('plans'),
  evalsDir: z.string().default('evals'),
  worktreeRoot: z.string().default(''),
  base: z.string().default('main'),
  mode: z.enum(['local', 'remote']).default('remote'),
  shipPath: z.enum(['scaffold', 'github', 'dry-run']).default('dry-run'),
  reviewPool: z.string().default('default'),
  reviewPolicyVersion: z.string().default('review-v1'),
  reviewer: z.string().default('codex-review'),
  gateRequired: z.boolean().default(false),
  /** 'strict' = upstream scaffold rules (acceptance and sweep block); 'advisory' = downstream contract (they warn). */
  cardPolicy: z.enum(['strict', 'advisory']).default('strict'),
  maxWorkers: z.number().int().min(1).max(2).default(2),
  family: z.enum(['claude', 'gpt']).default('claude'),
  provider: z.enum(['claude-api', 'claude-code', 'mock']).default('claude-api'),
  repository: z.string().optional(),
  userLimitMs: z.number().int().positive().optional(),
  hooks: z
    .object({
      frozenPaths: z.array(z.string()).default([]),
      testPathPatterns: z.array(z.string()).optional(),
      productionPatterns: z.array(z.string()).optional(),
    })
    .default({ frozenPaths: [] }),
  tierPaths: z.object({ tierS: z.array(z.string()).default([]), tier0: z.array(z.string()).default([]), frozen: z.array(z.string()).default([]) }).default({ tierS: [], tier0: [], frozen: [] }),
  preReview: PreReviewConfig.prefault({}),
  formalReview: FormalReviewConfig.prefault({}),
  github: GitHubShipConfig.prefault({}),
})
  .superRefine((config, ctx) => {
    // A required review cannot be waived at the ship: the two settings would let a blocked candidate merge.
    if (config.gateRequired && config.github.requireVerdict === false) {
      ctx.addIssue({ code: 'custom', path: ['github', 'requireVerdict'], message: 'github.requireVerdict false conflicts with gateRequired true: a required review is never waived at the ship' });
    }
    // The coverage request lives in the prompt contract only: a reviewer whose output is pinned to VERDICT_SCHEMA (the
    // `{schema}` placeholder) rejects the extra field, so the two settings would ask for a document the reviewer cannot emit.
    if (config.preReview.coverage === 'shadow' && config.preReview.command.some((a) => a.includes('{schema}'))) {
      ctx.addIssue({ code: 'custom', path: ['preReview', 'coverage'], message: 'preReview.coverage shadow conflicts with a {schema} pre-review command: the frozen verdict schema forbids the coverage field' });
    }
    // Invocations are told apart by reviewer name: a fallback under the primary's name could never be dispatched.
    if (config.formalReview.fallback && config.formalReview.fallback.reviewer === config.formalReview.reviewer) {
      ctx.addIssue({ code: 'custom', path: ['formalReview', 'fallback', 'reviewer'], message: 'formalReview.fallback.reviewer must differ from formalReview.reviewer: the ledger tells the two reviewers apart by name' });
    }
  });
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export const CONFIG_FILE = 'aidlc.config.json';

export function loadProjectConfig(root: string): { config: ProjectConfig; file: string; found: boolean } {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file)) return { config: ProjectConfig.parse({}), file, found: false };
  const parsed = ProjectConfig.parse(JSON.parse(readFileSync(file, 'utf8')));
  return { config: parsed, file, found: true };
}

/**
 * The directory card worktrees are created under, joined with the card id by every caller.
 * An explicit `worktreeRoot` wins; an empty one resolves to the platform root scoped to this
 * repository, `%SystemDrive%\wt\<name>` on Windows and `$HOME/.wt/<name>` elsewhere, where
 * `<name>` is the base name of the main checkout, so two repositories with a card of the same
 * id never share one directory. A repository whose worktrees already sit under the unscoped root
 * sets `worktreeRoot` to that root; the loop does not look there (docs/OPERATIONS.md). The
 * platform's own path rules apply whatever host runs this, so the result is testable anywhere.
 * A checkout at a filesystem root has no name to scope by and is refused rather than resolved
 * to the unscoped root; an empty `SystemDrive` or `HOME` counts as missing, since `path.join`
 * would otherwise turn it into a relative root.
 */
export function resolveWorktreeRoot(config: ProjectConfig, mainRoot: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (config.worktreeRoot) return config.worktreeRoot;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const name = p.basename(mainRoot);
  if (!name) throw new Error(`the main checkout '${mainRoot}' has no directory name to scope the worktree root by; set worktreeRoot in ${CONFIG_FILE}`);
  if (platform === 'win32') return p.join(env['SystemDrive'] || 'C:', 'wt', name);
  return p.join(env['HOME'] || '/tmp', '.wt', name);
}
