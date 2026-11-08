/**
 * Continuous evals (playbook Stage 4 "Continuous evals in CI"; scaffold EVAL.md).
 *
 * Each eval is a prompt plus deterministic checks (exit 0/1). The suite runs non-interactively
 * whenever agent configuration (CLAUDE.md, .claude/**) changes and on a schedule; a pass-rate
 * threshold gates the configuration change. Every production incident becomes an eval.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { runSync, type SyncRunner } from '../probes/exec.ts';
import type { CompletionResult, ModelProvider, ToolCall } from '../providers/types.ts';

export const EvalCheck = z.discriminatedUnion('type', [
  z.object({ type: z.literal('command'), command: z.array(z.string()).min(1), expectExit: z.number().int().default(0), cwd: z.string().optional(), timeoutMs: z.number().int().positive().default(10 * 60 * 1000) }),
  z.object({ type: z.literal('contains'), file: z.string(), text: z.string() }),
  z.object({ type: z.literal('not-contains'), file: z.string(), text: z.string() }),
  z.object({ type: z.literal('output-matches'), pattern: z.string() }),
  z.object({ type: z.literal('json-field'), path: z.string(), equals: z.unknown() }),
  /** A `Read` tool call whose `file_path` resolves to this repository-relative path. */
  z.object({ type: z.literal('read-file'), path: z.string().min(1) }),
  /** A `Bash` or `PowerShell` tool call whose `command` matches the regex. */
  z.object({ type: z.literal('ran-command'), pattern: z.string() }),
  /** No `Bash` or `PowerShell` tool call whose `command` matches the regex. */
  z.object({ type: z.literal('not-ran-command'), pattern: z.string() }),
  /** No `Edit`, `Write` or `NotebookEdit` tool call whose path matches the regex. */
  z.object({ type: z.literal('not-wrote-path'), pattern: z.string() }),
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
  /** A temporary checkout or state directory the run could not remove. */
  detail?: string;
}

export interface EvalSuiteResult {
  total: number;
  passed: number;
  passRate: number;
  threshold: number;
  gate: 'pass' | 'fail';
  results: EvalResult[];
}

/** Words that name the measurement; a case prompt carrying one as a whole word, in any letter case, is refused. */
export const MEASUREMENT_WORDS = ['eval', 'evals', 'judge', 'rubric', 'grader', 'benchmark', 'experiment', 'score'] as const;
const MEASUREMENT_WORD = new RegExp(`\\b(${MEASUREMENT_WORDS.join('|')})\\b`, 'i');

/** The system prompt of a model-backed case; it names no measurement word. */
export const EVAL_SYSTEM_PROMPT = 'Complete the task exactly as instructed.';

const TOOL_CALL_CHECKS: ReadonlySet<EvalCheck['type']> = new Set(['read-file', 'ran-command', 'not-ran-command', 'not-wrote-path']);

export function loadEvals(dir: string): EvalCase[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => {
      const c = EvalCase.parse(JSON.parse(readFileSync(path.join(dir, n), 'utf8')));
      const word = MEASUREMENT_WORD.exec(c.prompt)?.[1];
      if (word !== undefined) throw new Error(`eval case ${c.id}: the prompt contains the word "${word}", which names the measurement`);
      for (const check of c.checks) {
        const [field, value] = check.type === 'command' ? ['cwd', check.cwd] : check.type === 'contains' || check.type === 'not-contains' ? ['file', check.file] : [];
        const rule = value === undefined ? undefined : casePathRule(value);
        if (rule) throw new Error(`eval case ${c.id}: the \`${field}\` ${JSON.stringify(value)} ${rule}`);
      }
      return c;
    });
}

function getPath(obj: unknown, p: string): unknown {
  return p.split('.').reduce<unknown>((acc, key) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

/**
 * Runs one case. Under `skipModel` the checks run in `options.cwd` and no model is called. Otherwise the model and every
 * check run in a detached temporary checkout of HEAD with `AIDLC_STATE_DIR` set to a new empty directory, and both are
 * removed afterwards, also when the model or a check throws; what could not be removed is reported in `detail`.
 */
export async function runEval(evalCase: EvalCase, provider: ModelProvider, options: { cwd: string; runner?: SyncRunner; skipModel?: boolean } = { cwd: process.cwd() }): Promise<EvalResult> {
  const started = Date.now();
  const runner = options.runner ?? runSync;
  const done = (checks: EvalResult['checks'], r?: CompletionResult): EvalResult => ({ id: evalCase.id, dimension: evalCase.dimension, passed: checks.every((c) => c.ok), checks, invocationId: r?.invocationId, model: r?.model, durationMs: Date.now() - started });
  if (options.skipModel) return done(runChecks(evalCase, runner, options.cwd));
  const ws: Workspace = {};
  let result: EvalResult;
  try {
    result = await runInWorkspace(ws, options.cwd);
  } catch (err) {
    const left = closeWorkspace(ws, options.cwd);
    throw left ? new Error(`${(err as Error).message}; ${left}`, { cause: err }) : err;
  }
  const left = closeWorkspace(ws, options.cwd);
  return left ? { ...result, detail: left } : result;

  async function runInWorkspace(w: Workspace, root: string): Promise<EvalResult> {
    try {
      openWorkspace(w, root);
    } catch (err) {
      return done([{ check: 'checkout', ok: false, detail: (err as Error).message }]);
    }
    const env = { AIDLC_STATE_DIR: w.stateDir! };
    const recordToolCalls = evalCase.checks.some((c) => TOOL_CALL_CHECKS.has(c.type));
    const r = await provider.complete({ role: evalCase.role, system: EVAL_SYSTEM_PROMPT, prompt: evalCase.prompt, effort: evalCase.effort, allowedTools: evalCase.allowedTools, cwd: w.checkout, env, ...(recordToolCalls ? { recordToolCalls } : {}) });
    if (r.outcome !== 'ok') return done([{ check: 'model', ok: false, detail: `${r.outcome}: ${r.error ?? ''}` }], r);
    return done(runChecks(evalCase, runner, w.checkout!, r, env), r);
  }
}

/** Paths compared as the OS compares them: resolved, and without letter case on Windows. */
const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
};

const stringField = (call: ToolCall, key: string): string | undefined => (typeof call.input[key] === 'string' ? (call.input[key] as string) : undefined);

/** Why a case-supplied `cwd` or `file` is refused before anything runs: it is absolute, has a `..` segment, or starts with `.aidlc`. */
function casePathRule(p: string): string | undefined {
  if (path.posix.isAbsolute(p) || path.win32.isAbsolute(p)) return 'is absolute';
  const segments = p.split(/[\\/]/).filter((s) => s !== '' && s !== '.');
  if (segments.includes('..')) return 'has a `..` segment';
  const first = segments[0];
  if (first !== undefined && (process.platform === 'win32' ? first.toLowerCase() : first) === '.aidlc') return 'has `.aidlc` as its first segment';
  return undefined;
}

/**
 * Why `rel`, resolved against `workdir`, may not be read or run in: the rule of `casePathRule`, or a real path (of the
 * target, else of its nearest existing parent) outside the real path of `workdir`, as a link that leaves it gives.
 */
function refusedPath(workdir: string, field: string, rel: string): string | undefined {
  const rule = casePathRule(rel);
  if (rule) return `\`${field}\` ${rule}`;
  try {
    let probe = path.resolve(workdir, rel);
    const rest: string[] = [];
    while (!existsSync(probe) && path.dirname(probe) !== probe) {
      rest.unshift(path.basename(probe));
      probe = path.dirname(probe);
    }
    const inside = path.relative(realpathSync.native(workdir), path.join(realpathSync.native(probe), ...rest));
    if (!(inside === '..' || inside.startsWith(`..${path.sep}`) || path.isAbsolute(inside))) return undefined;
  } catch {
    // a path whose real path cannot be read is refused
  }
  return `\`${field}\` resolves outside the working directory`;
}

/** The checks of one case against the working directory and, when the model ran, its result. */
function runChecks(evalCase: EvalCase, runner: SyncRunner, workdir: string, r?: CompletionResult, env?: Record<string, string>): EvalResult['checks'] {
  const checks: EvalResult['checks'] = [];
  const commands = (r?.toolCalls ?? []).filter((c) => c.name === 'Bash' || c.name === 'PowerShell').map((c) => stringField(c, 'command')).filter((c): c is string => c !== undefined);
  for (const check of evalCase.checks) {
    switch (check.type) {
      case 'command': {
        const [cmd, ...args] = check.command;
        const refused = check.cwd === undefined ? undefined : refusedPath(workdir, 'cwd', check.cwd);
        if (refused) {
          checks.push({ check: `command ${check.command.join(' ')}`, ok: false, detail: `refused: ${refused}` });
          break;
        }
        const rec = runner(cmd!, args, { cwd: path.resolve(workdir, check.cwd ?? '.'), timeoutMs: check.timeoutMs, killTree: true, ...(env ? { env: { ...process.env, ...env } } : {}) });
        checks.push({ check: `command ${check.command.join(' ')}`, ok: rec.exitCode === check.expectExit && !rec.timedOut, detail: `exit ${rec.exitCode}${rec.timedOut ? ' (timeout)' : ''}` });
        break;
      }
      case 'contains':
      case 'not-contains': {
        const refused = refusedPath(workdir, 'file', check.file);
        if (refused) {
          checks.push({ check: `${check.type} ${check.file}`, ok: false, detail: `refused: ${refused}` });
          break;
        }
        const file = path.resolve(workdir, check.file);
        const content = existsSync(file) ? readFileSync(file, 'utf8') : '';
        const has = content.includes(check.text);
        checks.push({ check: `${check.type} ${check.file}`, ok: check.type === 'contains' ? has : !has, detail: existsSync(file) ? (has ? 'found' : 'not found') : 'file missing' });
        break;
      }
      case 'output-matches':
        checks.push({ check: `output-matches /${check.pattern}/`, ok: !!r && new RegExp(check.pattern, 'm').test(r.text), detail: r ? r.text.slice(0, 120) : 'no model run' });
        break;
      case 'json-field': {
        const v = getPath(r?.json, check.path);
        checks.push({ check: `json ${check.path}`, ok: JSON.stringify(v) === JSON.stringify(check.equals), detail: JSON.stringify(v) });
        break;
      }
      default: {
        const name = `${check.type} ${'path' in check ? check.path : `/${check.pattern}/`}`;
        // A tool-call check never passes vacuously: no model run, or a run that recorded no tool calls, fails it.
        if (!r || !r.toolCalls) {
          checks.push({ check: name, ok: false, detail: r ? 'no tool calls recorded' : 'no model run' });
          break;
        }
        if (check.type === 'read-file') {
          const want = path.resolve(workdir, check.path);
          const hit = r.toolCalls.some((c) => c.name === 'Read' && stringField(c, 'file_path') !== undefined && samePath(path.resolve(workdir, stringField(c, 'file_path')!), want));
          checks.push({ check: name, ok: hit, detail: hit ? 'read' : 'no Read tool call of the file' });
        } else if (check.type === 'not-wrote-path') {
          const re = new RegExp(check.pattern, process.platform === 'win32' ? 'i' : '');
          const written = r.toolCalls.filter((c) => c.name === 'Edit' || c.name === 'Write' || c.name === 'NotebookEdit').map((c) => stringField(c, c.name === 'NotebookEdit' ? 'notebook_path' : 'file_path')).filter((p): p is string => p !== undefined);
          const hit = written.find((p) => re.test(p));
          checks.push({ check: name, ok: hit === undefined, detail: hit === undefined ? 'no matching path written' : `wrote ${hit}` });
        } else {
          const re = new RegExp(check.pattern, 'm');
          const hit = commands.find((c) => re.test(c));
          const ok = check.type === 'ran-command' ? hit !== undefined : hit === undefined;
          checks.push({ check: name, ok, detail: hit === undefined ? 'no matching command' : `ran ${hit.slice(0, 120)}` });
        }
      }
    }
  }
  return checks;
}

/** The temporary checkout, its `node_modules` link and the state directory of one model-backed case, as far as they were created. */
interface Workspace {
  holder?: string;
  checkout?: string;
  link?: string;
  stateDir?: string;
}

const git = (args: string[], cwd: string): ReturnType<SyncRunner> | undefined => {
  try {
    return runSync('git', args, { cwd });
  } catch {
    return undefined;
  }
};

function openWorkspace(w: Workspace, root: string): void {
  // The long, canonical forms, so the path git records compares equal to the one the cleanup looks for.
  w.stateDir = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-eval-state-')));
  w.holder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-eval-')));
  const checkout = path.join(w.holder, 'checkout');
  const add = git(['worktree', 'add', '--detach', checkout, 'HEAD'], root);
  if (add?.exitCode !== 0) throw new Error(`no temporary checkout of HEAD: ${add?.stderr.trim() || `git worktree add exit ${add?.exitCode}`}`);
  w.checkout = checkout;
  const common = git(['rev-parse', '--git-common-dir'], root);
  if (common?.exitCode !== 0) throw new Error(`git rev-parse --git-common-dir failed: ${common?.stderr.trim() ?? ''}`);
  const modules = path.join(path.dirname(path.resolve(root, common.stdout.trim())), 'node_modules');
  if (!existsSync(modules)) return;
  const link = path.join(checkout, 'node_modules');
  symlinkSync(modules, link, 'junction');
  w.link = link;
}

/** Removes the link, the checkout (pruning when the remove fails) and the state directory; returns what is left, if anything. */
function closeWorkspace(w: Workspace, root: string): string | undefined {
  const left: string[] = [];
  let linkRemoved = true;
  if (w.link) {
    try {
      unlinkSync(w.link);
    } catch {
      linkRemoved = false;
      left.push(`link ${w.link} not removed`);
    }
  }
  if (w.holder) {
    const checkout = path.join(w.holder, 'checkout');
    // A link that is still there would let a recursive removal reach the main checkout's node_modules.
    if (linkRemoved) {
      const removed = git(['worktree', 'remove', '--force', checkout], root);
      try {
        rmSync(w.holder, { recursive: true, force: true });
      } catch {
        // reported below
      }
      const pruned = removed?.exitCode === 0 || git(['worktree', 'prune'], root)?.exitCode === 0;
      const listed = git(['worktree', 'list', '--porcelain'], root);
      const named = !listed || listed.exitCode !== 0 || listed.stdout.split(/\r?\n/).some((l) => l.startsWith('worktree ') && samePath(l.slice('worktree '.length), checkout));
      if (existsSync(w.holder) || !pruned || named) left.push(`checkout ${checkout} not removed`);
    } else {
      left.push(`checkout ${checkout} not removed`);
    }
  }
  if (w.stateDir) {
    try {
      rmSync(w.stateDir, { recursive: true, force: true });
    } catch {
      // reported below
    }
    if (existsSync(w.stateDir)) left.push(`state directory ${w.stateDir} not removed`);
  }
  return left.length ? left.join('; ') : undefined;
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
