/**
 * Non-interactive Claude Code provider (`claude -p ... --output-format json`, or `stream-json --verbose` when the request records tool calls), the shape the
 * playbook uses in CI ("Continuous evals", "CI/CD integration"). Tools are restricted with
 * `--allowedTools`; execution stays inside the caller's sandbox and permissions.
 */
import { detectQuotaHold } from '../core/parse-guard.ts';
import { run, type Runner } from '../probes/exec.ts';
import type { CompletionRequest, CompletionResult, ModelProvider, ToolCall } from './types.ts';
import { extractJson, newInvocationId } from './types.ts';

export interface ClaudeCodeOptions {
  binary?: string;
  runner?: Runner;
  defaultModel?: string;
  /** Extra CLI flags appended to every invocation. */
  extraArgs?: string[];
  /** Pass `--effort <request.effort>` after the model (card T0-CLAUDE-EFFORT-OPT-IN). Off unless `true`. */
  forwardEffort?: boolean;
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
    const stream = request.recordToolCalls === true;
    const args = ['-p', request.prompt, '--output-format', stream ? 'stream-json' : 'json'];
    if (stream) args.push('--verbose');
    if (request.system) args.push('--append-system-prompt', request.system);
    const model = request.model ?? this.opts.defaultModel;
    if (model) args.push('--model', model);
    if (this.opts.forwardEffort === true) {
      if (Object.keys(request.env ? { ...process.env, ...request.env } : process.env).some((k) => k.toUpperCase() === 'CLAUDE_CODE_EFFORT_LEVEL')) {
        return { invocationId: newInvocationId('claude-code'), provider: this.name, model: model ?? 'claude', text: '', outcome: 'error', error: 'CLAUDE_CODE_EFFORT_LEVEL is set in the environment of the claude process, where it outranks --effort; unset it or turn off claudeCode.forwardEffort', durationMs: 0 };
      }
      args.push('--effort', request.effort);
    }
    if (request.allowedTools?.length) args.push('--allowedTools', request.allowedTools.join(','));
    if (this.opts.extraArgs?.length) args.push(...this.opts.extraArgs);
    const r = await this.runner(this.opts.binary ?? 'claude', args, { cwd: request.cwd, timeoutMs: request.timeoutMs ?? 30 * 60 * 1000, ...(request.env ? { env: { ...process.env, ...request.env } } : {}) });
    const invocationId = newInvocationId('claude-code');
    const durationMs = Date.now() - started;
    const read = stream ? readStream(r.stdout) : undefined;
    const recorded = read ? { toolCalls: read.toolCalls } : {};
    if (r.timedOut) return { invocationId, provider: this.name, model: model ?? 'claude', text: r.stdout, outcome: 'error', error: 'timeout', durationMs, ...recorded };
    if (read && !read.result) return { invocationId, provider: this.name, model: model ?? 'claude', text: '', outcome: 'error', error: 'no result event in the stream', durationMs, ...recorded };
    // In a stream the result event is the payload: the JSON document `--output-format json` prints.
    let payload: Record<string, unknown> | undefined = read?.result;
    if (!read) {
      try {
        payload = JSON.parse(r.stdout) as Record<string, unknown>;
      } catch {
        payload = undefined;
      }
    }
    const raw = read ? JSON.stringify(read.result) : r.stdout;
    const text = typeof payload?.['result'] === 'string' ? (payload['result'] as string) : read ? '' : r.stdout;
    // An `is_error` payload is a failed run whatever the exit code; its `api_error_status` decides a quota hold before any text.
    if (r.exitCode !== 0 || payload?.['is_error'] === true) {
      const status = payload?.['is_error'] === true && typeof payload['api_error_status'] === 'number' ? payload['api_error_status'] : undefined;
      const quota = detectQuotaHold(`${raw}\n${r.stderr}`, status).hold;
      return { invocationId, provider: this.name, model: model ?? 'claude', text, outcome: quota ? 'quota' : 'error', error: r.stderr.trim() || (r.exitCode === 0 ? `is_error: ${text}` : `exit ${r.exitCode}`), durationMs, ...recorded };
    }
    const usage = payload && typeof payload['usage'] === 'object' && payload['usage'] ? (payload['usage'] as Record<string, number>) : undefined;
    return {
      ...recorded,
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

/**
 * Reads `--output-format stream-json` output: one JSON object per line; a line that does not parse is skipped. The
 * `tool_use` blocks of the assistant events are the tool calls, in order; the last `result` event is the payload.
 */
function readStream(stdout: string): { toolCalls: ToolCall[]; result?: Record<string, unknown> } {
  const toolCalls: ToolCall[] = [];
  let result: Record<string, unknown> | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) continue;
    const e = event as Record<string, unknown>;
    if (e['type'] === 'result') result = e;
    if (e['type'] !== 'assistant') continue;
    const content = (e['message'] as { content?: unknown } | undefined)?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content as Array<Record<string, unknown> | null>) {
      if (block?.['type'] !== 'tool_use') continue;
      const input = block['input'];
      toolCalls.push({ name: String(block['name']), input: input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {} });
    }
  }
  return { toolCalls, result };
}
