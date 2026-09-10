/**
 * Project configuration (`aidlc.config.json`), kept deliberately small: paths, base/mode,
 * the single ship path, review pool, worker cap, model family and hook settings.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

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
