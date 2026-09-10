/**
 * Scripted provider for qualification fixtures (plan §8: "use deterministic fixtures for
 * dangerous/expensive failures"). Responses are keyed by role and consumed in order.
 */
import type { CompletionRequest, CompletionResult, ModelProvider } from './types.ts';
import { extractJson, newInvocationId } from './types.ts';

export type MockScript = Partial<Record<CompletionRequest['role'], Array<string | Partial<CompletionResult>>>>;

export class MockProvider implements ModelProvider {
  readonly name = 'mock';
  readonly calls: CompletionRequest[] = [];
  private readonly script: MockScript;
  private readonly cursors = new Map<string, number>();

  constructor(script: MockScript = {}) {
    this.script = script;
  }

  async available(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: 'mock provider' };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(request);
    const list = this.script[request.role] ?? [];
    const i = this.cursors.get(request.role) ?? 0;
    this.cursors.set(request.role, i + 1);
    const entry = list[Math.min(i, list.length - 1)];
    const base: CompletionResult = {
      invocationId: newInvocationId('mock'),
      provider: 'mock',
      model: request.model ?? 'mock-model',
      text: '',
      outcome: 'ok',
      durationMs: 0,
    };
    if (entry === undefined) return { ...base, text: '{}', json: {}, outcome: 'ok' };
    if (typeof entry === 'string') return { ...base, text: entry, json: extractJson(entry) };
    const merged = { ...base, ...entry };
    if (merged.json === undefined && merged.text) merged.json = extractJson(merged.text);
    return merged;
  }
}
