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
import { resolveRepoIdentity, resolveStatePaths } from '../state/paths.ts';
import { compareTrials, trialRange, type TrialNames, type TrialRange, type TrialVerdict } from '../core/trial-compare.ts';

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

/** Whether `target`, links followed, is `dir` or lies under it; false when either does not exist. */
export function resolvesInside(dir: string, target: string): boolean {
  if (!existsSync(dir) || !existsSync(target)) return false;
  const rel = path.relative(realpathSync.native(dir), realpathSync.native(target));
  return !(rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel));
}

/**
 * The directories no eval reads: the configured state directory (`AIDLC_STATE_DIR`, else the default) and the main
 * checkout's `.aidlc`, both found from `dir` as `src/state/paths.ts` finds them; outside a git repository the main
 * checkout is `dir` itself.
 */
export function protectedDirsFor(dir: string): string[] {
  return [resolveStatePaths(dir).root, path.join(resolveRepoIdentity(dir).mainRoot, '.aidlc')];
}

/**
 * Reads the cases of `dir`; a case file whose real path is inside one of `protectedDirs` (default: `protectedDirsFor(dir)`)
 * is refused before it is read.
 */
export function loadEvals(dir: string, options: { protectedDirs?: readonly string[] } = {}): EvalCase[] {
  if (!existsSync(dir)) return [];
  const protectedDirs = options.protectedDirs ?? protectedDirsFor(dir);
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .sort()
    .map((n) => {
      const file = path.join(dir, n);
      const guard = protectedDirs.find((p) => resolvesInside(p, file));
      if (guard !== undefined) throw new Error(`eval case file ${JSON.stringify(file)} is inside a protected directory ${JSON.stringify(guard)}`);
      const c = EvalCase.parse(JSON.parse(readFileSync(file, 'utf8')));
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
 * Runs one case with `AIDLC_STATE_DIR` set to a new empty temporary directory, so no eval reaches the repository's
 * `.aidlc/`. Under `skipModel` no model is called and the checks run in `options.cwd`, or, with `checkout` (every trial
 * run of `runTrials`), in a detached temporary checkout of HEAD. Otherwise the model and every check run in a detached
 * temporary checkout of HEAD (of `options.ref` when given). The state directory and the checkout are removed
 * afterwards, also when the model, a check or the runner throws; what could not be removed is reported in `detail`.
 */
export async function runEval(evalCase: EvalCase, provider: ModelProvider, options: { cwd: string; runner?: SyncRunner; skipModel?: boolean; ref?: string; checkout?: boolean } = { cwd: process.cwd() }): Promise<EvalResult> {
  const started = Date.now();
  const runner = options.runner ?? runSync;
  const done = (checks: EvalResult['checks'], r?: CompletionResult): EvalResult => ({ id: evalCase.id, dimension: evalCase.dimension, passed: checks.every((c) => c.ok), checks, invocationId: r?.invocationId, model: r?.model, durationMs: Date.now() - started });
  const ws: Workspace = {};
  let result: EvalResult;
  try {
    if (options.skipModel && !options.checkout) {
      ws.stateDir = newStateDir();
      result = done(runChecks(evalCase, runner, options.cwd, undefined, { AIDLC_STATE_DIR: ws.stateDir }));
    } else {
      result = await runInWorkspace(ws, options.cwd);
    }
  } catch (err) {
    const left = await closeWorkspace(ws, options.cwd);
    throw left ? new Error(`${(err as Error).message}; ${left}`, { cause: err }) : err;
  }
  const left = await closeWorkspace(ws, options.cwd);
  return left ? { ...result, detail: left } : result;

  async function runInWorkspace(w: Workspace, root: string): Promise<EvalResult> {
    try {
      openWorkspace(w, root, options.ref ?? 'HEAD');
    } catch (err) {
      return done([{ check: 'checkout', ok: false, detail: (err as Error).message }]);
    }
    const env = { AIDLC_STATE_DIR: w.stateDir! };
    if (options.skipModel) return done(runChecks(evalCase, runner, w.checkout!, undefined, env));
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
 * The rule for a check target, given the real path of the working directory and of the target: refused when the target
 * is outside the working directory, or when its first segment below it is `.aidlc` (letter case ignored on Windows).
 */
export function realPathRule(realWorkdir: string, realTarget: string, platform: NodeJS.Platform = process.platform): string | undefined {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const rel = p.relative(realWorkdir, realTarget);
  if (rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return 'resolves outside the working directory';
  const first = rel.split(p.sep)[0]!;
  if ((platform === 'win32' ? first.toLowerCase() : first) === '.aidlc') return 'resolves into the `.aidlc` of the working directory';
  return undefined;
}

/**
 * Why `rel`, resolved against `workdir`, may not be read or run in: the rule of `casePathRule`, or `realPathRule` on the
 * real path of the target (else of its nearest existing parent), so a link cannot lead out of it or into its `.aidlc`.
 */
function refusedPath(workdir: string, field: string, rel: string): string | undefined {
  const rule = casePathRule(rel);
  if (rule) return `\`${field}\` ${rule}`;
  let reason: string | undefined;
  try {
    let probe = path.resolve(workdir, rel);
    const rest: string[] = [];
    while (!existsSync(probe) && path.dirname(probe) !== probe) {
      rest.unshift(path.basename(probe));
      probe = path.dirname(probe);
    }
    reason = realPathRule(realpathSync.native(workdir), path.join(realpathSync.native(probe), ...rest));
    if (reason === undefined) return undefined;
  } catch {
    // a path whose real path cannot be read is refused
  }
  return `\`${field}\` ${reason ?? 'resolves outside the working directory'}`;
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
        // No model run fails every tool-call check with `no model run`, and a result with no `toolCalls` fails every one with
        // `no tool calls recorded`. A recorded empty list (`toolCalls: []`) passes not-ran-command and not-wrote-path, since no
        // call matches, and fails read-file and ran-command.
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

const newStateDir = (): string => realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-eval-state-')));

function openWorkspace(w: Workspace, root: string, ref: string): void {
  // The long, canonical forms, so the path git records compares equal to the one the cleanup looks for.
  w.stateDir = newStateDir();
  w.holder = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'aidlc-eval-')));
  const checkout = path.join(w.holder, 'checkout');
  const add = git(['worktree', 'add', '--detach', checkout, ref], root);
  if (add?.exitCode !== 0) throw new Error(`no temporary checkout of ${ref}: ${add?.stderr.trim() || `git worktree add exit ${add?.exitCode}`}`);
  w.checkout = checkout;
  const common = git(['rev-parse', '--git-common-dir'], root);
  if (common?.exitCode !== 0) throw new Error(`git rev-parse --git-common-dir failed: ${common?.stderr.trim() ?? ''}`);
  const modules = path.join(path.dirname(path.resolve(root, common.stdout.trim())), 'node_modules');
  if (!existsSync(modules)) return;
  const link = path.join(checkout, 'node_modules');
  symlinkSync(modules, link, 'junction');
  w.link = link;
}

/** The removal, clock and wait `removeDir` uses; each defaults to the real one. */
export interface RemoveDirDeps {
  remove?: (dir: string) => void;
  now?: () => number;
  wait?: (ms: number) => void | Promise<void>;
}

/** Error codes of a removal that can succeed once another process lets go of the directory (on Windows, a process whose working directory is inside it). */
const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);
const REMOVE_RETRY_MS = 200;
const REMOVE_LIMIT_MS = 10_000;

/**
 * Removes one directory. A call that throws EBUSY, EPERM or ENOTEMPTY is followed, 200 ms later, by another, until a
 * call succeeds or a busy call ends at or after 10000 ms on the clock since the first call; any other error ends the
 * calls at once. The default wait is a timer it awaits. Resolves to whether a remove call returned without throwing.
 */
export async function removeDir(dir: string, deps: RemoveDirDeps = {}): Promise<boolean> {
  const remove = deps.remove ?? ((d: string) => rmSync(d, { recursive: true, force: true }));
  const now = deps.now ?? Date.now;
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const start = now();
  for (;;) {
    try {
      remove(dir);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (!code || !BUSY_CODES.has(code) || now() - start >= REMOVE_LIMIT_MS) return false;
    }
    await wait(REMOVE_RETRY_MS);
  }
}

/** Removes the link, the checkout (pruning when the remove fails) and the state directory, the holder and the state directory through `removeDir`, each with its own 10 s; returns what is left, if anything. */
async function closeWorkspace(w: Workspace, root: string): Promise<string | undefined> {
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
      await removeDir(w.holder); // reported below
      const pruned = removed?.exitCode === 0 || git(['worktree', 'prune'], root)?.exitCode === 0;
      const listed = git(['worktree', 'list', '--porcelain'], root);
      const named = !listed || listed.exitCode !== 0 || listed.stdout.split(/\r?\n/).some((l) => l.startsWith('worktree ') && samePath(l.slice('worktree '.length), checkout));
      if (existsSync(w.holder) || !pruned || named) left.push(`checkout ${checkout} not removed`);
    } else {
      left.push(`checkout ${checkout} not removed`);
    }
  }
  if (w.stateDir) {
    await removeDir(w.stateDir); // reported below
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

/** The most trials one run takes. */
export const MAX_TRIALS = 20;

/** One side's figures over its trials (card T1-EVAL-VARIANT). */
export interface TrialFigures {
  passed: number;
  trials: number;
  /** The median, minimum and maximum of the pass rate over trials; null with no trial. */
  passRate: TrialRange | null;
  modelErrors: number;
  quotaHolds: number;
}

export interface EvalTrialsReport {
  trials: number;
  /** The ref as given and the commits of both sides; absent without a variant. */
  variant?: { ref: string; commit: string; head: string };
  cases: Array<{ id: string; head: TrialFigures; variant?: TrialFigures; note?: string }>;
  total: { head: TrialFigures; variant?: TrialFigures };
  verdict?: TrialVerdict;
  reason?: string;
  /** Why a temporary checkout could not be created; the run stopped there. */
  checkoutError?: string;
  /** What a run could not remove (`EvalResult.detail`). */
  left?: string[];
}

/** The words of the verdict on HEAD (after) against the ref (before, quoted as a JSON string). */
const variantNames = (ref: string): TrialNames => ({ before: JSON.stringify(ref), after: 'HEAD', first: 'pass rate', noVerdict: 'quota holds', errors: 'model errors' });
const DIFFERS_NOTE = 'the prompt or checks differ at the ref; both sides ran the HEAD copy';

/** The commit `ref` names in `cwd`, or undefined when it names none. */
function commitOf(ref: string, cwd: string): string | undefined {
  const r = git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`], cwd);
  return r?.exitCode === 0 ? r.stdout.trim() : undefined;
}

/**
 * The ids of `cases` with no copy of the same id among the files of `dir` (names as listed now) at `commit`, or whose
 * copy there has another prompt or other checks.
 */
function differsAt(cases: EvalCase[], dir: string, commit: string, cwd: string): Set<string> {
  const rel = path.relative(cwd, dir).split(path.sep).join('/');
  const there = new Map<string, EvalCase>();
  for (const name of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.json')) : []) {
    const shown = git(['show', `${commit}:./${rel ? `${rel}/` : ''}${name}`], cwd);
    if (shown?.exitCode !== 0) continue;
    try {
      const c = EvalCase.safeParse(JSON.parse(shown.stdout));
      if (c.success) there.set(c.data.id, c.data);
    } catch {
      // a copy that is not JSON is no copy
    }
  }
  const key = (c: EvalCase) => JSON.stringify({ prompt: c.prompt, checks: c.checks });
  return new Set(cases.filter((c) => !there.has(c.id) || key(there.get(c.id)!) !== key(c)).map((c) => c.id));
}

type TrialRun = { passed: boolean; modelError: boolean; quota: boolean };

/** Per case and in total: a trial's pass rate in total is over the runs that trial made on the side. */
function figures(runsByCase: TrialRun[][]): { perCase: TrialFigures[]; total: TrialFigures } {
  const count = (rs: TrialRun[], f: (r: TrialRun) => boolean) => rs.filter(f).length;
  const of = (rs: TrialRun[], trials: number, rates: number[]): TrialFigures => ({ passed: count(rs, (r) => r.passed), trials, passRate: trialRange(rates), modelErrors: count(rs, (r) => r.modelError), quotaHolds: count(rs, (r) => r.quota) });
  const perCase = runsByCase.map((rs) => of(rs, rs.length, rs.map((r) => (r.passed ? 1 : 0))));
  const trials = Math.max(0, ...runsByCase.map((rs) => rs.length));
  const rates = Array.from({ length: trials }, (_, t) => {
    const inTrial = runsByCase.flatMap((rs) => (rs[t] ? [rs[t]] : []));
    return count(inTrial, (r) => r.passed) / inTrial.length;
  });
  return { perCase, total: of(runsByCase.flat(), trials, rates) };
}

/**
 * Runs each case `trials` times (card T1-EVAL-VARIANT), each run through `runEval` in a temporary checkout of HEAD,
 * under `skipModel` too. With `variant`, each run of a case on HEAD is followed by one on a temporary checkout of the
 * variant commit, and the report carries the `compareTrials` verdict for HEAD against the ref on the pass rate. A quota
 * hold or a checkout that cannot be created stops the run. Refused before any model call: a trial count outside 1 to 20, `variant` with `skipModel`, and a variant that
 * names no commit.
 */
export async function runTrials(cases: EvalCase[], provider: ModelProvider, options: { cwd: string; trials: number; variant?: string; skipModel?: boolean; runner?: SyncRunner; dir?: string }): Promise<EvalTrialsReport> {
  const { trials, variant, cwd } = options;
  if (!Number.isInteger(trials) || trials < 1 || trials > MAX_TRIALS) throw new Error(`--trials must be an integer from 1 to ${MAX_TRIALS}, not ${trials}`);
  if (variant !== undefined && options.skipModel) throw new Error('--variant cannot be used with --skip-model');
  let sides = ['HEAD'];
  let named: EvalTrialsReport['variant'];
  let differs = new Set<string>();
  if (variant !== undefined) {
    const commit = commitOf(variant, cwd);
    if (commit === undefined) throw new Error(`--variant ${JSON.stringify(variant)} names no commit`);
    const head = commitOf('HEAD', cwd);
    if (head === undefined) throw new Error('HEAD names no commit');
    named = { ref: variant, commit, head };
    sides = [head, commit];
    if (options.dir !== undefined) differs = differsAt(cases, options.dir, commit, cwd);
  }
  let outcome: CompletionResult['outcome'] | undefined;
  const watched: ModelProvider = {
    name: provider.name,
    available: () => provider.available(),
    complete: async (request) => {
      const r = await provider.complete(request);
      outcome = r.outcome;
      return r;
    },
  };
  const runs: TrialRun[][][] = sides.map(() => cases.map(() => []));
  const left: string[] = [];
  let checkoutError: string | undefined;
  run: for (let t = 0; t < trials; t++) {
    for (const [i, c] of cases.entries()) {
      for (const [s, ref] of sides.entries()) {
        outcome = undefined;
        // Every trial run, with or without skipModel, runs in a temporary checkout, never in `cwd` itself.
        const r = await runEval(c, watched, { cwd, runner: options.runner, skipModel: options.skipModel, ref, checkout: true });
        if (r.detail) left.push(r.detail);
        const checkout = r.checks.find((x) => x.check === 'checkout' && !x.ok);
        if (checkout) {
          checkoutError = checkout.detail;
          break run;
        }
        runs[s]![i]!.push({ passed: r.passed, modelError: outcome !== undefined && outcome !== 'ok' && outcome !== 'quota', quota: outcome === 'quota' });
        if (outcome === 'quota') break run;
      }
    }
  }
  const [head, other] = runs.map(figures);
  const report: EvalTrialsReport = {
    trials,
    ...(named ? { variant: named } : {}),
    cases: cases.map((c, i) => ({ id: c.id, head: head!.perCase[i]!, ...(other ? { variant: other.perCase[i]! } : {}), ...(differs.has(c.id) ? { note: DIFFERS_NOTE } : {}) })),
    total: { head: head!.total, ...(other ? { variant: other.total } : {}) },
  };
  if (other) {
    const side = (f: TrialFigures) => ({ summary: { trials: f.trials, recall: f.passRate, falseBlockRate: null, noVerdict: f.quotaHolds, errors: f.modelErrors }, caseIds: cases.map((c) => c.id) });
    Object.assign(report, compareTrials(side(other.total), side(head!.total), variantNames(named!.ref)));
  }
  if (checkoutError !== undefined) report.checkoutError = checkoutError;
  if (left.length) report.left = left;
  return report;
}

/** The human lines of a trials report; the ref is printed as a JSON string. */
export function formatTrials(report: EvalTrialsReport): string {
  const rest = (f: TrialFigures) => `${f.passRate ? ` (median ${f.passRate.median.toFixed(2)}, ${f.passRate.min.toFixed(2)} to ${f.passRate.max.toFixed(2)})` : ''}, ${f.modelErrors} model errors, ${f.quotaHolds} quota holds`;
  const ref = report.variant ? JSON.stringify(report.variant.ref) : '';
  const lines = report.cases.map((c) => `${c.id}: HEAD ${c.head.passed}/${c.head.trials}${rest(c.head)}${c.variant ? `; ${ref} ${c.variant.passed}/${c.variant.trials}${rest(c.variant)}` : ''}${c.note ? ` [${c.note}]` : ''}`);
  // The total counts case runs (card T0-EVAL-WORDING): a side's runs are the sum of its per-case trials.
  const runs = (side: 'head' | 'variant') => report.cases.reduce((n, c) => n + (c[side]?.trials ?? 0), 0);
  const { head, variant } = report.total;
  lines.push(`total over ${report.trials} trials: HEAD ${head.passed} of ${runs('head')} case runs${rest(head)}${variant ? `; ${ref} ${variant.passed} of ${runs('variant')} case runs${rest(variant)}` : ''}`);
  if (report.variant) lines.push(`HEAD (${report.variant.head.slice(0, 12)}) against ${ref} (${report.variant.commit.slice(0, 12)}): ${report.verdict}: ${report.reason}`);
  if (report.checkoutError) lines.push(`stopped: ${report.checkoutError}`);
  for (const l of report.left ?? []) lines.push(`left: ${l}`);
  return lines.join('\n');
}
