/**
 * Continuous evals (playbook Stage 4 "Continuous evals in CI"; scaffold EVAL.md).
 *
 * Each eval is a prompt plus deterministic checks (exit 0/1). The suite runs non-interactively
 * whenever agent configuration (CLAUDE.md, .claude/**) changes and on a schedule; a pass-rate
 * threshold gates the configuration change. Every production incident becomes an eval.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { runSync, type SyncRunner } from '../probes/exec.ts';
import type { ModelProvider } from '../providers/types.ts';

export const EvalCheck = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), command: z.array(z.string()).min(1), expectExit: z.number().int().default(0), cwd: z.string().optional(), timeoutMs: z.number().int().positive().default(10 * 60 * 1000) }),
  z.object({ type: z.literal('contains'), file: z.string(), text: z.string() }),
  z.object({ type: z.literal('not-contains'), file: z.string(), text: z.string() }),
  z.object({ type: z.literal('output-matches'), pattern: z.string() }),
  z.object({ type: z.literal('json-field'), path: z.string(), equals: z.unknown() }),
]);
export type EvalCheck = z.infer<typeof EvalCheck>;

export const EvalCase = z.object({
  id: z.string().min(1),
  dimension: z.enum(['functional', 'security', 'frontend-behavior', 'backend-mcp', 'policy', 'regression']).default('functional'),
  prompt: z.string().min(1),
  allowedTools: z.array(z.string()).default(['Read', 'Edit', 'Bash(npm test)']),
  role: z.enum(['planner', 'implementer', 'investigator', 'reviewer', 'release-specialist']).default('implementer'),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  checks: z.array(EvalCheck).min(1),
  /** Incident or finding this eval was created from. */
  origin: z.string().optional(),
});
export type EvalCase = z.infer<typeof EvalCase>;

export interface EvalResult {
  id: string;
  dimension: EvalCase['dimension'];
  passed: boolean;
  checks: Array<{ check: string; ok: boolean; detail: string }>;
  invocationId?: string;
  model?: string;
  durationMs: number;
}

export interface EvalSuiteResult {
  total: number;
  passed: number;
  passRate: number;
  threshold: number;
  gate: 'pass' | 'fail';
  results: EvalResult[];
}

export function loadEvals(dir: string): EvalCase[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => EvalCase.parse(JSON.parse(readFileSync(path.join(dir, n), 'utf8'))));
}

function getPath(obj: unknown, p: string): unknown {
  return p.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

export async function runEval(evalCase: EvalCase, provider: ModelProvider, options: { cwd: string; runner?: SyncRunner; skipModel?: boolean } = { cwd: process.cwd() }): Promise<EvalResult> {
  const started = Date.now();
  const runner = options.runner ?? runSync;
  let text = '';
  let json: unknown;
  let invocationId: string | undefined;
  let model: string | undefined;
  if (!options.skipModel) {
    const r = await provider.complete({ role: evalCase.role, system: 'You are running a deterministic eval. Complete the task exactly as instructed.', prompt: evalCase.prompt, effort: evalCase.effort, allowedTools: evalCase.allowedTools, cwd: options.cwd });
    text = r.text;
    json = r.json;
    invocationId = r.invocationId;
    model = r.model;
    if (r.outcome !== 'ok') {
      return { id: evalCase.id, dimension: evalCase.dimension, passed: false, checks: [{ check: 'model', ok: false, detail: `${r.outcome}: ${r.error ?? ''}` }], invocationId, model, durationMs: Date.now() - started };
    }
  }
  const checks: EvalResult['checks'] = [];
  for (const check of evalCase.checks) {
    switch (check.type) {
      case 'command': {
        const [cmd, ...args] = check.command;
        const rec = runner(cmd!, args, { cwd: check.cwd ?? options.cwd, timeoutMs: check.timeoutMs });
        checks.push({ check: `command ${check.command.join(' ')}`, ok: rec.exitCode === check.expectExit && !rec.timedOut, detail: `exit ${rec.exitCode}${rec.timedOut ? ' (timeout)' : ''}` });
        break;
      }
      case 'contains':
      case 'not-contains': {
        const file = path.resolve(options.cwd, check.file);
        const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
        const has = content.includes(check.text);
        checks.push({ check: `${check.type} ${check.file}`, ok: check.type === 'contains' ? has : !has, detail: existsSync(file) ? (has ? 'found' : 'not found') : 'file missing' });
        break;
      }
      case 'output-matches':
        checks.push({ check: `output-matches /${check.pattern}/`, ok: new RegExp(check.pattern, 'm').test(text), detail: text.slice(0, 120) });
        break;
      case 'json-field': {
        const v = getPath(json, check.path);
        checks.push({ check: `json ${check.path}`, ok: JSON.stringify(v) === JSON.stringify(check.equals), detail: JSON.stringify(v) });
        break;
      }
      default:
        break;
    }
  }
  return { id: evalCase.id, dimension: evalCase.dimension, passed: checks.every((c) => c.ok), checks, invocationId, model, durationMs: Date.now() - started };
}

export async function runSuite(cases: EvalCase[], provider: ModelProvider, options: { cwd: string; threshold?: number; runner?: SyncRunner; skipModel?: boolean }): Promise<EvalSuiteResult> {
  const results: EvalResult[] = [];
  for (const c of cases) results.push(await runEval(c, provider, options));
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  const passRate = total === 0 ? 0 : passed / total;
  const threshold = options.threshold ?? 0.9;
  return { total, passed, passRate, threshold, gate: total > 0 && passRate >= threshold ? 'pass' : 'fail', results };
}

/** Render an eval JSON skeleton from an incident/finding (playbook: every incident becomes an eval). */
export function evalFromIncident(id: string, prompt: string, regressionCommand: string[], origin: string): EvalCase {
  return EvalCase.parse({ id, dimension: 'regression', prompt, checks: [{ type: 'command', command: regressionCommand, expectExit: 0 }], origin });
}
