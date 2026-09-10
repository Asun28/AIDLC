/**
 * Claude Code hooks (playbook "Hooks as build-time guardrails" and "Hooks as approval gates";
 * scaffold guard-frozen / route-new-work / card-budget-meter conventions).
 *
 * Protocol: read the event JSON from stdin, never crash the tool (exit 0 fail-open for
 * advisory hooks), and block with either `hookSpecificOutput.permissionDecision: "deny"` or
 * exit code 2 with the reason on stderr. Blocks explain themselves.
 *
 * Hooks:
 *  - production-gate   (PreToolUse Bash): deploy+production needs a matching release authorization.
 *  - protect-paths     (PreToolUse Edit|Write|Bash): frozen paths cannot be edited in place.
 *  - protect-tests     (PreToolUse Edit|Write): test files are locked while a fix task is active.
 *  - secrets-guard     (PreToolUse Write|Edit|Bash): credential-looking content never enters a diff.
 *  - verify-before-done(Stop): an active card without a fresh DoD receipt is not done.
 *  - route-new-work    (UserPromptSubmit): print the routing result for a new request.
 *
 * `./entry.ts` runs every guard for an event in one process (`bin/aidlc-hook.js`, `aidlc hook auto`).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { classifyRequest, formatRouting } from '../core/router.ts';
import { requireAuthority } from '../core/authorization.ts';
import { AuthorizationRecord } from '../core/types.ts';
import { resolveStatePaths } from '../state/paths.ts';
import { GoalStore } from '../state/goal-store.ts';

export interface HookEvent {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt?: string;
  [key: string]: unknown;
}

export interface HookResult {
  exitCode: 0 | 2;
  stdout?: string;
  stderr?: string;
}

export function deny(event: string, reason: string): HookResult {
  return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason } }) };
}

export function defer(event: string, context: string): HookResult {
  return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'defer', additionalContext: context } }) };
}

export function stopContext(context: string): HookResult {
  return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: context } }) };
}

export interface HookConfig {
  frozenPaths?: string[];
  testPathPatterns?: string[];
  productionPatterns?: string[];
}

export const DEFAULT_HOOK_CONFIG: Required<HookConfig> = {
  frozenPaths: [],
  testPathPatterns: ['(^|/)tests?/', '\\.test\\.[cm]?[jt]sx?$', '\\.spec\\.[cm]?[jt]sx?$', '_test\\.(py|go|kt)$', '(^|/)src/test/'],
  productionPatterns: ['\\b(deploy|release|rollout|promote|apply)\\b[^\\n]*\\b(prod|production|live)\\b', '\\b(prod|production)\\b[^\\n]*\\b(deploy|release|rollout|promote|apply)\\b'],
};

const WRITE_VERBS = /set-content|out-file|add-content|new-item|tee-object|\btee\b|\bcp\b|copy-item|\bmv\b|move-item|remove-item|\brm\b|\bdel\b|\bri\b|sed\s+-i|perl\s+-i|awk\s+-i|git\s+apply|git\s+checkout|git\s+restore|\bpatch\b|>>|>/i;

function normalise(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

export function loadHookConfig(cwd: string): Required<HookConfig> {
  const file = path.join(cwd, 'aidlc.config.json');
  if (!existsSync(file)) return DEFAULT_HOOK_CONFIG;
  try {
    const cfg = JSON.parse(readFileSync(file, 'utf8')) as { hooks?: HookConfig };
    return { ...DEFAULT_HOOK_CONFIG, ...(cfg.hooks ?? {}) };
  } catch {
    return DEFAULT_HOOK_CONFIG;
  }
}

/** Commands that only read; a deploy word inside their arguments (grep for "production") is not a deploy. */
const READ_ONLY_TOOLS = new Set(['grep', 'rg', 'egrep', 'fgrep', 'findstr', 'cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'wc', 'ls', 'dir', 'find', 'echo', 'printf', 'type', 'diff', 'sort', 'uniq', 'cut', 'tr', 'jq', 'yq', 'stat', 'file', 'which', 'where', 'pwd', 'tree', 'select-string', 'get-content', 'get-childitem', 'test-path', 'write-output', 'write-host']);
const READ_ONLY_GIT = new Set(['log', 'diff', 'show', 'status', 'blame', 'grep', 'ls-files', 'rev-parse', 'branch', 'remote', 'worktree']);

/** Split a shell command into pipeline/sequence segments and drop read-only ones. */
export function mutatingSegments(cmd: string): string[] {
  return cmd
    .split(/\|\||&&|;|\|/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const tokens = s.replace(/^\s*(?:sudo|time|env(?:\s+\w+=\S+)*)\s+/i, '').split(/\s+/);
      const first = (tokens[0] ?? '').toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
      if (READ_ONLY_TOOLS.has(first)) return false;
      if (first === 'git' && READ_ONLY_GIT.has((tokens[1] ?? '').toLowerCase())) return false;
      return true;
    });
}

export function productionGate(event: HookEvent, env: NodeJS.ProcessEnv, config: Required<HookConfig>, cwd: string): HookResult {
  const cmd = String(event.tool_input?.['command'] ?? '');
  if (!cmd) return { exitCode: 0 };
  const segments = mutatingSegments(cmd);
  const hit = segments.some((seg) => config.productionPatterns.some((p) => new RegExp(p, 'i').test(seg)));
  if (!hit) return { exitCode: 0 };
  // 1. Explicit release approval reference in the environment (playbook RELEASE_APPROVAL).
  const approvalRef = env['RELEASE_APPROVAL'] ?? env['AIDLC_RELEASE_APPROVAL'];
  // 2. A matching production authorization record on an active goal.
  let matched = false;
  if (approvalRef) {
    try {
      const paths = resolveStatePaths(cwd, env);
      const store = new GoalStore(paths);
      for (const goal of store.listGoals()) {
        const records = goal.authorizations.map((a) => AuthorizationRecord.parse(a));
        const hitRecord = records.find((r) => r.id === approvalRef || r.ref === approvalRef);
        if (hitRecord) {
          const decision = requireAuthority([hitRecord], 'production', { environment: hitRecord.environment, candidateDigest: hitRecord.candidateDigest, operations: hitRecord.operations }, new Date().toISOString());
          matched = decision.status === 'authorized';
          if (matched) break;
        }
      }
      if (!matched && !existsSync(paths.goals)) matched = true; // no aidlc state: honour the plain env approval like the playbook hook
    } catch {
      matched = false;
    }
  }
  if (matched) return { exitCode: 0 };
  const reason = approvalRef
    ? `Production deploys need a release authorization that matches this candidate/environment; "${approvalRef}" does not match any recorded production authorization. Record it with \`aidlc authorize production ...\` first.`
    : 'Production deploys need a named release authorization (RELEASE_APPROVAL=<authorization id>). The agent prepares the release; the release manager authorizes it.';
  return { exitCode: 2, stderr: reason };
}

export function protectPaths(event: HookEvent, config: Required<HookConfig>): HookResult {
  if (!config.frozenPaths.length) return { exitCode: 0 };
  const file = event.tool_input?.['file_path'];
  const cmd = event.tool_input?.['command'];
  const matches = (target: string) => config.frozenPaths.some((f) => {
    try {
      return new RegExp(f, 'i').test(normalise(target));
    } catch {
      return normalise(target).includes(normalise(f));
    }
  });
  const reason = 'FROZEN: this path is a frozen contract/schema (aidlc.config.json hooks.frozenPaths). Changes go through version review, not in-place edits. Stop and ask the user how to proceed.';
  if (typeof file === 'string' && matches(file)) return deny('PreToolUse', reason);
  if (typeof cmd === 'string' && matches(cmd)) {
    if (WRITE_VERBS.test(cmd)) return deny('PreToolUse', reason);
    return defer('PreToolUse', 'Note: this command references a frozen path. Read-only use may continue; any write must go through version review.');
  }
  return { exitCode: 0 };
}

export function protectTests(event: HookEvent, cwd: string, env: NodeJS.ProcessEnv, config: Required<HookConfig>): HookResult {
  const file = event.tool_input?.['file_path'];
  if (typeof file !== 'string') return { exitCode: 0 };
  const marker = fixTaskMarker(cwd, env);
  if (!marker) return { exitCode: 0 };
  if (config.testPathPatterns.some((p) => new RegExp(p, 'i').test(normalise(file)))) {
    return deny('PreToolUse', `A fix task is active (${marker}); test files are locked. Fix the code, not the test. If the test itself is wrong, record the evidence and clear the fix-task marker explicitly.`);
  }
  return { exitCode: 0 };
}

export function fixTaskMarker(cwd: string, env: NodeJS.ProcessEnv): string | undefined {
  if (env['AIDLC_FIX_TASK']) return env['AIDLC_FIX_TASK'];
  try {
    const paths = resolveStatePaths(cwd, env);
    const f = path.join(paths.root, 'fix-task');
    if (existsSync(f)) return readFileSync(f, 'utf8').trim() || 'fix-task';
  } catch {
    /* no state */
  }
  return undefined;
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(?:sk|rk)-ant-[A-Za-z0-9_-]{20,}/, 'Anthropic API key'],
  [/sk-[A-Za-z0-9]{32,}/, 'OpenAI-style secret key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,}/, 'GitHub token'],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'private key'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/(?:password|passwd|secret|api[_-]?key|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i, 'inline credential assignment'],
];

export function secretsGuard(event: HookEvent): HookResult {
  const texts: string[] = [];
  for (const k of ['content', 'new_string', 'command']) {
    const v = event.tool_input?.[k];
    if (typeof v === 'string') texts.push(v);
  }
  const file = event.tool_input?.['file_path'];
  if (typeof file === 'string' && /(^|\/)\.env(\.(?!example$|sample$|template$)|$)|\.pem$|\.key$|id_rsa|\.secrets\//i.test(normalise(file))) {
    return deny('PreToolUse', `Writing to ${file} is blocked: secret-bearing files are never edited by the agent. Use .env.example placeholders.`);
  }
  for (const t of texts) {
    for (const [re, name] of SECRET_PATTERNS) {
      if (re.test(t) && !/example|placeholder|xxxx|<your|\$\{/i.test(t.match(re)?.[0] ?? '')) return deny('PreToolUse', `Blocked: content looks like a ${name}. Credentials never enter a diff; use environment variables or a placeholder.`);
    }
  }
  return { exitCode: 0 };
}

export function verifyBeforeDone(cwd: string, env: NodeJS.ProcessEnv): HookResult {
  try {
    const paths = resolveStatePaths(cwd, env);
    const store = new GoalStore(paths);
    const active = store.listGoals().filter((g) => !g.terminal);
    const pending: string[] = [];
    for (const goal of active) {
      for (const run of store.listCardRuns(goal.id)) {
        if (['BUILD', 'SHIP', 'REVIEW_FIX'].includes(run.state) && !run.dodReceipt) pending.push(`${run.cardId} (${run.state})`);
      }
    }
    if (!pending.length) return { exitCode: 0 };
    return stopContext(`[aidlc] Verification is part of done: ${pending.join(', ')} have no fresh DoD receipt. Run the card's dod_command (and lint/build) and paste the output before reporting the task complete. If a test fails, fix the code, not the test.`);
  } catch {
    return { exitCode: 0 };
  }
}

export function routeNewWork(event: HookEvent): HookResult {
  const prompt = String(event.prompt ?? '');
  if (!/\b(build|implement|fix|add|create|deploy|release|migrate|ship|refactor|investigate)\b/i.test(prompt) || prompt.length < 24) return { exitCode: 0 };
  const routing = classifyRequest({ text: prompt });
  const guidance = routing.size === 'T2'
    ? 'T2: brief -> plan -> plan-forge audit -> card projection; one product checkpoint approves plan + projection together before execution.'
    : routing.size === 'T1'
      ? 'T1: concise plan points -> valid cards -> arc; no full forge where routing policy permits.'
      : 'T0: one coherent card via card-loop; no planning funnel.';
  return { exitCode: 0, stdout: `${formatRouting(routing)}\n[aidlc] ${guidance} Confirm the size only if this routing is materially wrong; otherwise proceed under it.` };
}

export function readStdinJson(text: string): HookEvent {
  try {
    return JSON.parse(text) as HookEvent;
  } catch {
    return {};
  }
}

export type HookName = 'production-gate' | 'protect-paths' | 'protect-tests' | 'secrets-guard' | 'verify-before-done' | 'route-new-work';

export function runHook(name: HookName, event: HookEvent, options: { cwd?: string; env?: NodeJS.ProcessEnv; config?: Required<HookConfig> } = {}): HookResult {
  const cwd = options.cwd ?? event.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const config = options.config ?? loadHookConfig(cwd);
  switch (name) {
    case 'production-gate':
      return productionGate(event, env, config, cwd);
    case 'protect-paths':
      return protectPaths(event, config);
    case 'protect-tests':
      return protectTests(event, cwd, env, config);
    case 'secrets-guard':
      return secretsGuard(event);
    case 'verify-before-done':
      return verifyBeforeDone(cwd, env);
    case 'route-new-work':
      return routeNewWork(event);
    default:
      return { exitCode: 0 };
  }
}
