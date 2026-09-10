/**
 * Model provider abstraction (plan v5 MA1-MA3, LC12).
 *
 * Every invocation returns an invocation id, the actual model/version and usage so that the
 * journal can retain actor/model/host versions and accessible invocation ids for delegated
 * work. Providers never receive credentials from the journal and never log secrets.
 */
import type { EffortLevel, Role } from '../core/types.ts';

export interface CompletionRequest {
  role: Role;
  system: string;
  prompt: string;
  effort: EffortLevel;
  model?: string;
  maxTokens?: number;
  /** JSON schema the answer must satisfy; providers that support structured output enforce it. */
  jsonSchema?: Record<string, unknown>;
  /** Tools the provider may allow (Claude Code CLI `--allowedTools`). */
  allowedTools?: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface CompletionResult {
  invocationId: string;
  provider: string;
  model: string;
  modelVersion?: string;
  text: string;
  /** Parsed JSON when a schema was requested and the output parsed. */
  json?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costUsd?: number };
  stopReason?: string;
  /** 'quota' when the provider reported a rate limit / usage window; callers WAIT rather than retry. */
  outcome: 'ok' | 'refusal' | 'quota' | 'error' | 'malformed';
  error?: string;
  retryAfterMs?: number;
  durationMs: number;
}

export interface ModelProvider {
  readonly name: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
  /** Whether the provider is usable in this environment (credentials, binary on PATH). */
  available(): Promise<{ ok: boolean; detail: string }>;
}

export function newInvocationId(provider: string): string {
  const t = Date.now().toString(36);
  const r = Math.random().toString(36).slice(2, 8);
  return `${provider}-${t}-${r}`;
}

/** Extract the first JSON object/array from free text (fenced or bare). */
export function extractJson(text: string): unknown | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], text];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      /* try to locate braces */
    }
    const start = trimmed.search(/[{[]/);
    if (start < 0) continue;
    for (let end = trimmed.length; end > start; end -= 1) {
      const ch = trimmed[end - 1];
      if (ch !== '}' && ch !== ']') continue;
      try {
        return JSON.parse(trimmed.slice(start, end));
      } catch {
        /* keep shrinking */
      }
    }
  }
  return undefined;
}
