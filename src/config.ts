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
export const FormalReviewConfig = z.object({
  command: z.array(z.string()).default([]),
  reviewer: z.string().default('codex'),
  timeoutMs: z.number().int().positive().default(20 * 60 * 1000),
  shell: z.boolean().optional(),
  maxDiffBytes: z.number().int().positive().default(300_000),
});
export type FormalReviewConfig = z.infer<typeof FormalReviewConfig>;

/** GitHub ship path: required check-run names, the verdict rule and the CI polling limits. */
export const GitHubShipConfig = z.object({
  /** Check-run names that must be present and green before the merge; an absent name is pending, never satisfied. Every other check that reports on the head must succeed as well. */
  requiredChecks: z.array(z.string()).default([]),
  /** A fresh candidate-bound R3 verdict is required before any remote effect. */
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
});
export type ProjectConfig = z.infer<typeof ProjectConfig>;

export const CONFIG_FILE = 'aidlc.config.json';

export function loadProjectConfig(root: string): { config: ProjectConfig; file: string; found: boolean } {
  const file = path.join(root, CONFIG_FILE);
  if (!existsSync(file)) return { config: ProjectConfig.parse({}), file, found: false };
  const parsed = ProjectConfig.parse(JSON.parse(readFileSync(file, 'utf8')));
  return { config: parsed, file, found: true };
}

export function resolveWorktreeRoot(config: ProjectConfig, env: NodeJS.ProcessEnv = process.env): string {
  if (config.worktreeRoot) return config.worktreeRoot;
  if (process.platform === 'win32') return path.join(env['SystemDrive'] ?? 'C:', 'wt');
  return path.join(env['HOME'] ?? '/tmp', '.wt');
}
