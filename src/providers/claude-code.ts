/**
 * Non-interactive Claude Code provider (`claude -p ... --output-format json`), the shape the
 * playbook uses in CI ("Continuous evals", "CI/CD integration"). Tools are restricted with
 * `--allowedTools`; execution stays inside the caller's sandbox and permissions.
 */
import { detectQuotaHold } from '../core/parse-guard.ts';
import { run, type Runner } from '../probes/exec.ts';
import type { CompletionRequest, CompletionResult, ModelProvider } from './types.ts';
import { extractJson, newInvocationId } from './types.ts';

export interface ClaudeCodeOptions {
  binary?: string;
  runner?: Runner;
  defaultModel?: string;
  /** Extra CLI flags appended to every invocation. */
  extraArgs?: string[];
}

export class ClaudeCodeProvider implements ModelProvider {
  readonly name = 'claude-code';
  private readonly opts: ClaudeCodeOptions;
  private readonly runner: Runner;

  constructor(opts: ClaudeCodeOptions = {}) {
    this.opts = opts;
    this.runner = opts.runner ?? run;
  }

  async available(): Promise<{ ok: boolean; detail: string }> {
    const r = await this.runner(this.opts.binary ?? 'claude', ['--version'], { timeoutMs: 20_000 });
    return r.exitCode === 0 ? { ok: true, detail: r.stdout.trim() } : { ok: false, detail: `claude CLI unavailable: ${r.stderr.trim() || 'not on PATH'}` };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const args = ['-p', request.prompt, '--output-format', 'json'];
    if (request.system) args.push('--append-system-prompt', request.system);
    const model = request.model ?? this.opts.defaultModel;
    if (model) args.push('--model', model);
    if (request.allowedTools?.length) args.push('--allowedTools', request.allowedTools.join(','));
    if (this.opts.extraArgs?.length) args.push(...this.opts.extraArgs);
    const r = await this.runner(this.opts.binary ?? 'claude', args, { cwd: request.cwd, timeoutMs: request.timeoutMs ?? 30 * 60 * 1000 });
    const invocationId = newInvocationId('claude-code');
    const durationMs = Date.now() - started;
    if (r.timedOut) return { invocationId, provider: this.name, model: model ?? 'claude', text: r.stdout, outcome: 'error', error: 'timeout', durationMs };
    let payload: Record<string, unknown> | undefined;
    try {
      payload = JSON.parse(r.stdout) as Record<string, unknown>;
    } catch {
      payload = undefined;
    }
    const text = typeof payload?.['result'] === 'string' ? (payload['result'] as string) : r.stdout;
    // An `is_error` payload is a failed run whatever the exit code; its `api_error_status` decides a quota hold before any text.
    if (r.exitCode !== 0 || payload?.['is_error'] === true) {
      const status = payload?.['is_error'] === true && typeof payload['api_error_status'] === 'number' ? payload['api_error_status'] : undefined;
      const quota = detectQuotaHold(`${r.stdout}\n${r.stderr}`, status).hold;
      return { invocationId, provider: this.name, model: model ?? 'claude', text, outcome: quota ? 'quota' : 'error', error: r.stderr.trim() || (r.exitCode === 0 ? `is_error: ${text}` : `exit ${r.exitCode}`), durationMs };
    }
    const usage = payload && typeof payload['usage'] === 'object' && payload['usage'] ? (payload['usage'] as Record<string, number>) : undefined;
    return {
      invocationId: typeof payload?.['session_id'] === 'string' ? `claude-code:${payload['session_id']}` : invocationId,
      provider: this.name,
      model: model ?? 'claude',
      text,
      json: request.jsonSchema ? extractJson(text) : undefined,
      usage: usage ? { inputTokens: usage['input_tokens'], outputTokens: usage['output_tokens'], costUsd: typeof payload?.['total_cost_usd'] === 'number' ? (payload['total_cost_usd'] as number) : undefined } : undefined,
      outcome: request.jsonSchema && extractJson(text) === undefined ? 'malformed' : 'ok',
      durationMs,
    };
  }
}
