/**
 * Claude API provider via the official `@anthropic-ai/sdk`.
 *
 * - Default model `claude-opus-5-5`; adaptive thinking; `output_config.effort` maps the task's
 *   effort level (MA2) directly to the API effort on every request. Opus 5.5 rejects thinking
 *   disabled or with a budget, a forced `tool_choice`, non-default sampling and an assistant
 *   prefill, so the request sends none of them; text is read from `text` blocks only, since a
 *   response may begin with thinking blocks.
 * - Streaming with `finalMessage()` so long planning/review outputs never hit HTTP timeouts.
 * - Rate limits (429) are reported as `quota` with the provider's retry-after so the caller
 *   WAITs (MS4) instead of treating them as reasoning failures.
 * - `stop_reason: "refusal"` is surfaced as `refusal`, never as an empty success.
 * - The SDK is imported lazily so the CLI works without credentials (mock / dry-run modes).
 */
import type { CompletionRequest, CompletionResult, ModelProvider } from './types.ts';
import { extractJson, newInvocationId } from './types.ts';

export interface ClaudeApiOptions {
  apiKey?: string;
  defaultModel?: string;
  maxRetries?: number;
  timeoutMs?: number;
  /** Return summarized thinking in the result text (debug only). */
  showThinking?: boolean;
  /** Test-only: a messages client to use instead of one built from the SDK, so tests inject a fake with no network. It bypasses `maxRetries` and `timeoutMs`, which configure only the SDK client. */
  client?: ClaudeMessagesClient;
}

type AnthropicModule = typeof import('@anthropic-ai/sdk');
/** The part of the SDK client the provider calls. */
export type ClaudeMessagesClient = Pick<InstanceType<AnthropicModule['default']>, 'messages'>;

export class ClaudeApiProvider implements ModelProvider {
  readonly name = 'claude-api';
  private readonly opts: ClaudeApiOptions;
  private sdk: AnthropicModule | undefined;
  private client: ClaudeMessagesClient | undefined;

  constructor(opts: ClaudeApiOptions = {}) {
    this.opts = opts;
  }

  private async load(): Promise<{ sdk: AnthropicModule; client: ClaudeMessagesClient }> {
    if (!this.sdk || !this.client) {
      const sdk = await import('@anthropic-ai/sdk');
      const Anthropic = sdk.default;
      this.sdk = sdk;
      this.client = this.opts.client ?? new Anthropic({
        apiKey: this.opts.apiKey,
        maxRetries: this.opts.maxRetries ?? 2,
        timeout: this.opts.timeoutMs ?? 10 * 60 * 1000,
      });
    }
    return { sdk: this.sdk, client: this.client };
  }

  async available(): Promise<{ ok: boolean; detail: string }> {
    const hasEnv = Boolean(this.opts.apiKey || process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_AUTH_TOKEN'] || process.env['ANTHROPIC_PROFILE']);
    if (!hasEnv) return { ok: false, detail: 'no ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / ant profile detected (run `ant auth login` or export a key)' };
    try {
      await this.load();
      return { ok: true, detail: 'anthropic sdk loaded' };
    } catch (err) {
      return { ok: false, detail: `sdk unavailable: ${(err as Error).message}` };
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const model = request.model ?? this.opts.defaultModel ?? 'claude-opus-5-5';
    const invocationId = newInvocationId('claude-api');
    const { sdk, client } = await this.load();
    const system = request.jsonSchema
      ? `${request.system}\n\nRespond with a single JSON document that satisfies this JSON schema and nothing else:\n${JSON.stringify(request.jsonSchema)}`
      : request.system;
    try {
      const stream = client.messages.stream({
        model,
        max_tokens: request.maxTokens ?? 64000,
        system,
        thinking: { type: 'adaptive', display: this.opts.showThinking ? 'summarized' : 'omitted' },
        output_config: { effort: request.effort },
        messages: [{ role: 'user', content: request.prompt }],
      });
      const message = await stream.finalMessage();
      const text = message.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      const usage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? undefined,
      };
      const durationMs = Date.now() - started;
      if (message.stop_reason === 'refusal') {
        return { invocationId, provider: this.name, model: message.model, text, usage, stopReason: message.stop_reason, outcome: 'refusal', error: message.stop_details?.explanation ?? 'refused', durationMs };
      }
      const json = request.jsonSchema ? extractJson(text) : undefined;
      return {
        invocationId,
        provider: this.name,
        model: message.model,
        text,
        json,
        usage,
        stopReason: message.stop_reason ?? undefined,
        outcome: request.jsonSchema && json === undefined ? 'malformed' : 'ok',
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - started;
      if (err instanceof sdk.default.RateLimitError) {
        const retry = err.headers?.get?.('retry-after');
        const retryAfterMs = retry ? Number(retry) * 1000 : undefined;
        return { invocationId, provider: this.name, model, text: '', outcome: 'quota', error: err.message, retryAfterMs, durationMs };
      }
      if (err instanceof sdk.default.APIError) {
        const quota = err.status === 529 || err.status === 429;
        return { invocationId, provider: this.name, model, text: '', outcome: quota ? 'quota' : 'error', error: `${err.status ?? 'api'}: ${err.message}`, durationMs };
      }
      return { invocationId, provider: this.name, model, text: '', outcome: 'error', error: (err as Error).message, durationMs };
    }
  }
}
