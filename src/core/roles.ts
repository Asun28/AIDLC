/**
 * Role/model profiles (plan v5 MA1, MA3).
 *
 * Assign by role and supported capability. Model names, prices and numeric effort labels do
 * not establish equivalence; a role check records what actually worked. A formal reviewer is
 * read-only with independent context and must satisfy the installed review contract; a
 * fallback that changes independence or evidence validity needs a new policy decision.
 */
import { EFFORT_LADDERS } from './effort.ts';
import type { EffortLevel, Role, RoleProfile } from './types.ts';

export interface ProfileRequest {
  role: Role;
  /** 'gpt' or 'claude' main workflow family; the counterpart rule is symmetric. */
  family: 'gpt' | 'claude';
  /** Configured models per family, if the host exposes them. */
  configured?: Partial<Record<Role, { provider: string; model: string; pool?: string; tools?: string[]; contextLimit?: number }>>;
  /** Independence requirement for reviewers (cross-family reviewer required). */
  crossFamilyReviewer?: boolean;
}

export const DEFAULT_MODELS: Record<'gpt' | 'claude', Record<Role, { provider: string; model: string }>> = {
  claude: {
    // Opus 5.5 is the default for consequential roles; a project may pin `claude-fable-5-1` for the
    // planner/reviewer seats once its availability and retention requirements are verified (MA1).
    planner: { provider: 'anthropic', model: 'claude-opus-5-5' },
    implementer: { provider: 'anthropic', model: 'claude-opus-5-5' },
    investigator: { provider: 'anthropic', model: 'claude-sonnet-5' },
    reviewer: { provider: 'anthropic', model: 'claude-opus-5-5' },
    'release-specialist': { provider: 'anthropic', model: 'claude-opus-5-5' },
  },
  gpt: {
    planner: { provider: 'openai', model: 'gpt-5.6-sol' },
    implementer: { provider: 'openai', model: 'gpt-5.6-sol' },
    investigator: { provider: 'openai', model: 'gpt-5.6-sol' },
    reviewer: { provider: 'openai', model: 'gpt-5.6-sol' },
    'release-specialist': { provider: 'openai', model: 'gpt-5.6-sol' },
  },
};

export function resolveRoleProfile(req: ProfileRequest): RoleProfile {
  const family = req.role === 'reviewer' && req.crossFamilyReviewer ? (req.family === 'gpt' ? 'claude' : 'gpt') : req.family;
  const configured = req.configured?.[req.role];
  const base = configured ?? DEFAULT_MODELS[family][req.role];
  const ladder: EffortLevel[] = EFFORT_LADDERS[family] ?? ['low', 'medium', 'high'];
  return {
    role: req.role,
    provider: base.provider,
    model: base.model,
    supportedEfforts: ladder,
    tools: configured?.tools ?? defaultTools(req.role),
    contextLimit: configured?.contextLimit,
    pool: configured?.pool ?? `${base.provider}:default`,
    readOnly: req.role === 'reviewer' || req.role === 'investigator',
    roleCheck: 'not-run',
  };
}

function defaultTools(role: Role): string[] {
  switch (role) {
    case 'reviewer':
      return ['Read', 'Grep', 'Glob'];
    case 'investigator':
      return ['Read', 'Grep', 'Glob', 'Bash(git *)', 'Bash(gh run view *)'];
    case 'planner':
      return ['Read', 'Grep', 'Glob'];
    case 'implementer':
      return ['Read', 'Edit', 'Write', 'Bash'];
    case 'release-specialist':
      return ['Read', 'Bash'];
    default:
      return ['Read'];
  }
}

/** Assess a task's baseline effort from its own uncertainty/scope/risk, never from the coordinator's. */
export function assessTaskEffort(task: { uncertainty: 'low' | 'medium' | 'high'; scope: 'narrow' | 'moderate' | 'wide'; risk: 'low' | 'medium' | 'high'; verificationBurden: 'light' | 'moderate' | 'heavy' }, ladder: EffortLevel[]): EffortLevel {
  const score = ['low', 'medium', 'high'].indexOf(task.uncertainty) + ['narrow', 'moderate', 'wide'].indexOf(task.scope) + ['low', 'medium', 'high'].indexOf(task.risk) + ['light', 'moderate', 'heavy'].indexOf(task.verificationBurden);
  // score 0..8 -> pick from ladder excluding the top (escalation headroom) when possible
  const usable = ladder.length > 1 ? ladder.slice(0, ladder.length - 1) : ladder;
  const idx = Math.min(usable.length - 1, Math.floor((score / 8) * usable.length));
  return usable[Math.max(0, idx)] ?? ladder[0]!;
}

/** MA3: reviewer independence check. */
export function reviewerIndependent(author: RoleProfile, reviewer: RoleProfile, requireCrossFamily: boolean): { ok: boolean; detail: string } {
  if (!reviewer.readOnly) return { ok: false, detail: 'formal reviewer must be read-only' };
  if (author.model === reviewer.model && author.pool === reviewer.pool) return { ok: false, detail: 'reviewer shares the author model and pool; no author self-approval' };
  if (requireCrossFamily && author.provider === reviewer.provider) return { ok: false, detail: 'cross-family reviewer required' };
  return { ok: true, detail: 'independent reviewer' };
}
