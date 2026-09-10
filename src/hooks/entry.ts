/**
 * One-process hook entry (`bin/aidlc-hook.js`, `aidlc hook auto`).
 *
 * Claude Code runs one hook command per event; this module runs every guard that applies to the
 * event (by `hook_event_name` + `tool_name`) inside that single process, so a tool call costs one
 * node start instead of one `npx` start per guard. Guard semantics are unchanged (`./index.ts`).
 *
 * Merge rule: the first block wins (exit 2, or `permissionDecision: "deny"`); otherwise the first
 * advisory output (frozen-path note, Stop context, routing line) is returned unchanged; otherwise
 * exit 0 with no output. One JSON document per process keeps the hook protocol intact.
 */
import { loadHookConfig, readStdinJson, runHook, type HookEvent, type HookName, type HookResult } from './index.ts';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/** Guards that apply to an event, in the order the per-guard wiring used to run them. */
export function hookNamesFor(event: HookEvent): HookName[] {
  switch (event.hook_event_name) {
    case 'PreToolUse': {
      const tool = String(event.tool_name ?? '');
      if (tool === 'Bash') return ['production-gate', 'protect-paths', 'secrets-guard'];
      if (EDIT_TOOLS.has(tool)) return ['protect-paths', 'secrets-guard', 'protect-tests'];
      return [];
    }
    case 'Stop':
      return ['verify-before-done'];
    case 'UserPromptSubmit':
      return ['route-new-work'];
    default:
      return [];
  }
}

function isBlock(r: HookResult): boolean {
  if (r.exitCode === 2) return true;
  if (!r.stdout) return false;
  try {
    return (JSON.parse(r.stdout) as { hookSpecificOutput?: { permissionDecision?: string } }).hookSpecificOutput?.permissionDecision === 'deny';
  } catch {
    return false;
  }
}

export function dispatchHook(event: HookEvent, options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): HookResult {
  const names = hookNamesFor(event);
  if (!names.length) return { exitCode: 0 };
  const cwd = options.cwd ?? event.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const config = loadHookConfig(cwd);
  let advisory: HookResult | undefined;
  for (const name of names) {
    const r = runHook(name, event, { cwd, env, config });
    if (isBlock(r)) return r;
    if (!advisory && (r.stdout || r.stderr)) advisory = r;
  }
  return advisory ?? { exitCode: 0 };
}

/** Read the whole hook event from stdin; an interactive terminal or a stalled pipe yields `{}`. */
export function readStdin(timeoutMs = 2000): Promise<string> {
  return new Promise<string>((resolve) => {
    if (process.stdin.isTTY) return resolve('{}');
    const chunks: Buffer[] = [];
    process.stdin.on('data', (d: Buffer) => chunks.push(d));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve('{}'));
    setTimeout(() => resolve(Buffer.concat(chunks).toString('utf8') || '{}'), timeoutMs).unref();
  });
}

/** Process entry used by `bin/aidlc-hook.js`: never throws, exit code carries the decision. */
export async function main(): Promise<void> {
  let result: HookResult;
  try {
    result = dispatchHook(readStdinJson(await readStdin()));
  } catch (err) {
    process.stderr.write(`[aidlc hook] ${(err as Error).message}\n`);
    result = { exitCode: 0 };
  }
  if (result.stdout) process.stdout.write(result.stdout + '\n');
  if (result.stderr) process.stderr.write(result.stderr + '\n');
  process.exit(result.exitCode);
}
