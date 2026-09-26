import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, newInvocationId } from '../../src/providers/types.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { ClaudeCodeProvider } from '../../src/providers/claude-code.ts';
import { ClaudeApiProvider, type ClaudeMessagesClient } from '../../src/providers/claude-api.ts';
import type { CompletionRequest } from '../../src/providers/types.ts';
import type { ExecReceipt, Runner } from '../../src/probes/exec.ts';

test('extractJson handles fenced, bare, embedded and absent JSON', () => {
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('[1, 2]'), [1, 2]);
  assert.deepEqual(extractJson('result: {"a": [1, 2]} done'), { a: [1, 2] });
  assert.deepEqual(extractJson('prefix {"a": {"b": "}"}} suffix'), { a: { b: '}' } });
  assert.equal(extractJson('no json here'), undefined);
  assert.equal(extractJson(''), undefined);
  assert.ok(newInvocationId('x').startsWith('x-'));
  assert.notEqual(newInvocationId('x'), newInvocationId('x'));
});

test('MockProvider consumes its script per role in order and records calls', async () => {
  const p = new MockProvider({ planner: ['{"x": 1}', 'second'], implementer: [{ text: 'impl', outcome: 'quota', error: 'limited' }] });
  assert.equal((await p.available()).ok, true);
  const a = await p.complete({ role: 'planner', system: 's', prompt: 'p', effort: 'medium' });
  assert.deepEqual(a.json, { x: 1 });
  assert.equal(a.outcome, 'ok');
  assert.equal(a.provider, 'mock');
  const b = await p.complete({ role: 'planner', system: 's', prompt: 'p', effort: 'medium', model: 'm-1' });
  assert.equal(b.text, 'second');
  assert.equal(b.model, 'm-1');
  const c = await p.complete({ role: 'planner', system: 's', prompt: 'p', effort: 'medium' });
  assert.equal(c.text, 'second'); // clamped to the last entry
  const d = await p.complete({ role: 'implementer', system: 's', prompt: 'p', effort: 'low' });
  assert.equal(d.outcome, 'quota');
  assert.equal(d.error, 'limited');
  const e = await p.complete({ role: 'reviewer', system: 's', prompt: 'p', effort: 'high' });
  assert.deepEqual(e.json, {});
  assert.equal(p.calls.length, 5);
  assert.equal(p.calls[3]?.role, 'implementer');
});

function receipt(partial: Partial<ExecReceipt>): ExecReceipt {
  const now = new Date().toISOString();
  return { command: 'claude', args: [], cwd: '', exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', startedAt: now, finishedAt: now, durationMs: 1, outputSha256: '', ...partial };
}

function scripted(fn: (args: string[]) => Partial<ExecReceipt>): { runner: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: Runner = async (command, args) => {
    calls.push([command, ...args]);
    return receipt(fn(args));
  };
  return { runner, calls };
}

test('ClaudeCodeProvider parses the JSON envelope and passes the expected flags', async () => {
  const stdout = JSON.stringify({ result: 'done {"ok": true}', session_id: 'sess-1', usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 });
  const { runner, calls } = scripted(() => ({ stdout }));
  const p = new ClaudeCodeProvider({ runner, defaultModel: 'claude-opus-5', extraArgs: ['--no-color'] });
  const r = await p.complete({ role: 'implementer', system: 'sys', prompt: 'do it', effort: 'medium', allowedTools: ['Read', 'Bash(npm test)'], jsonSchema: { type: 'object' }, cwd: 'D:/x' });
  assert.equal(r.outcome, 'ok');
  assert.equal(r.invocationId, 'claude-code:sess-1');
  assert.equal(r.text, 'done {"ok": true}');
  assert.deepEqual(r.json, { ok: true });
  assert.equal(r.usage?.inputTokens, 10);
  assert.equal(r.usage?.costUsd, 0.01);
  assert.equal(r.model, 'claude-opus-5');
  const args = calls[0]!;
  assert.equal(args[0], 'claude');
  assert.ok(args.includes('-p') && args.includes('do it'));
  assert.ok(args.includes('--output-format') && args.includes('json'));
  assert.ok(args.includes('--append-system-prompt'));
  assert.ok(args.includes('--model') && args.includes('claude-opus-5'));
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Bash(npm test)');
  assert.ok(args.includes('--no-color'));
});

test('ClaudeCodeProvider maps quota, timeout, errors and malformed JSON', async () => {
  const quota = new ClaudeCodeProvider({ runner: scripted(() => ({ exitCode: 1, stderr: 'Error: rate limit reached, retry later' })).runner });
  assert.equal((await quota.complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low' })).outcome, 'quota');
  const timeout = new ClaudeCodeProvider({ runner: scripted(() => ({ timedOut: true, exitCode: null })).runner });
  const t = await timeout.complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low', timeoutMs: 5 });
  assert.equal(t.outcome, 'error');
  assert.equal(t.error, 'timeout');
  const err = new ClaudeCodeProvider({ runner: scripted(() => ({ exitCode: 2, stderr: 'boom' })).runner });
  const e = await err.complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low' });
  assert.equal(e.outcome, 'error');
  assert.equal(e.error, 'boom');
  const malformed = new ClaudeCodeProvider({ runner: scripted(() => ({ stdout: JSON.stringify({ result: 'no json here' }) })).runner });
  const m = await malformed.complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low', jsonSchema: { type: 'object' } });
  assert.equal(m.outcome, 'malformed');
  assert.equal(m.invocationId.startsWith('claude-code-'), true);
  // non-JSON stdout is passed through as text
  const plain = new ClaudeCodeProvider({ runner: scripted(() => ({ stdout: 'plain text' })).runner });
  assert.equal((await plain.complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low' })).text, 'plain text');
});

test('ClaudeCodeProvider.available reports the CLI version or its absence', async () => {
  const ok = new ClaudeCodeProvider({ runner: scripted(() => ({ stdout: '2.1.0 (Claude Code)\n' })).runner });
  assert.deepEqual(await ok.available(), { ok: true, detail: '2.1.0 (Claude Code)' });
  const missing = new ClaudeCodeProvider({ runner: scripted(() => ({ exitCode: 127, stderr: 'not found' })).runner });
  assert.equal((await missing.available()).ok, false);
});

test('ClaudeApiProvider.available is false without credentials', async () => {
  const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE'] as const;
  const saved: Partial<Record<(typeof keys)[number], string | undefined>> = {};
  for (const k of keys) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  try {
    const r = await new ClaudeApiProvider().available();
    assert.equal(r.ok, false);
    assert.ok(r.detail.includes('ANTHROPIC_API_KEY'));
  } finally {
    for (const k of keys) if (saved[k] !== undefined) process.env[k] = saved[k];
  }
});

/** A messages client that records each request it is sent and answers with one fixed message; no network. */
function fakeClaudeClient(message: Record<string, unknown>): { sent: Record<string, unknown>[]; client: ClaudeMessagesClient } {
  const sent: Record<string, unknown>[] = [];
  const client = { messages: { stream: (params: Record<string, unknown>) => { sent.push(params); return { finalMessage: async () => message }; } } };
  return { sent, client: client as unknown as ClaudeMessagesClient };
}
const claudeMessage = (content: unknown[], stopReason = 'end_turn') => ({ model: 'claude-opus-5-5', content, stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 5 } });
const REQUEST: CompletionRequest = { role: 'planner', system: 'sys', prompt: 'plan it', effort: 'xhigh' };

test('T1-OPUS55-MODELS acceptance 3: with no model and no defaultModel the provider sends claude-opus-5-5 [R5]', async () => {
  const { sent, client } = fakeClaudeClient(claudeMessage([{ type: 'text', text: 'ok' }]));
  await new ClaudeApiProvider({ client }).complete(REQUEST);
  assert.equal(sent[0]!['model'], 'claude-opus-5-5');
});

test('T1-OPUS55-MODELS acceptance 3: the request carries the effort and no setting Opus 5.5 rejects [R6]', async () => {
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
    const { sent, client } = fakeClaudeClient(claudeMessage([{ type: 'text', text: 'ok' }]));
    await new ClaudeApiProvider({ client }).complete({ ...REQUEST, effort });
    const params = sent[0]!;
    assert.deepEqual(params['output_config'], { effort }, `output_config.effort is the request's effort (${effort})`);
    const thinking = params['thinking'] as { type?: string } | undefined;
    assert.ok(thinking === undefined || thinking.type === 'adaptive', `thinking absent or adaptive: ${JSON.stringify(thinking)}`);
    assert.ok(thinking === undefined || !('budget_tokens' in thinking), 'no thinking budget');
    for (const rejected of ['temperature', 'top_p', 'top_k', 'tool_choice']) assert.equal(rejected in params, false, `no ${rejected}`);
    const messages = params['messages'] as Array<{ role: string }>;
    assert.equal(messages.at(-1)?.role, 'user', 'no assistant prefill');
  }
});

test('T1-OPUS55-MODELS acceptance 4: an empty thinking block before the text yields the text only [R6]', async () => {
  const { client } = fakeClaudeClient(claudeMessage([{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'the answer' }]));
  const r = await new ClaudeApiProvider({ client }).complete(REQUEST);
  assert.equal(r.text, 'the answer');
  assert.equal(r.outcome, 'ok');
});

test('T1-OPUS55-MODELS acceptance 4: stop_reason refusal yields outcome refusal [R6]', async () => {
  const { client } = fakeClaudeClient(claudeMessage([{ type: 'text', text: '' }], 'refusal'));
  const r = await new ClaudeApiProvider({ client }).complete(REQUEST);
  assert.equal(r.outcome, 'refusal');
});

test('T1-OPUS55-MODELS acceptance 3: a request model wins over defaultModel, and defaultModel over the built-in default [R5]', async () => {
  const withDefault = fakeClaudeClient(claudeMessage([{ type: 'text', text: 'ok' }]));
  await new ClaudeApiProvider({ client: withDefault.client, defaultModel: 'claude-opus-5' }).complete(REQUEST);
  assert.equal(withDefault.sent[0]!['model'], 'claude-opus-5', 'an explicit defaultModel passes through');
  const withBoth = fakeClaudeClient(claudeMessage([{ type: 'text', text: 'ok' }]));
  await new ClaudeApiProvider({ client: withBoth.client, defaultModel: 'claude-opus-5' }).complete({ ...REQUEST, model: 'claude-sonnet-5' });
  assert.equal(withBoth.sent[0]!['model'], 'claude-sonnet-5', 'the request model wins');
});

/** A claude -p run that prints `payload` as its `--output-format json` document and exits `exitCode`. */
const claudeCodeRun = (payload: Record<string, unknown>, exitCode: number) => new ClaudeCodeProvider({ runner: scripted(() => ({ exitCode, stdout: JSON.stringify(payload) })).runner }).complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low' });

test('T1-PARSE-GUARD acceptance 5: ClaudeCodeProvider decides a quota hold from api_error_status of an is_error payload whatever the exit code, and never reads an is_error payload as ok [R4]', async () => {
  for (const exitCode of [0, 1]) {
    assert.equal((await claudeCodeRun({ type: 'result', is_error: true, api_error_status: 429, result: 'API Error: 429' }, exitCode)).outcome, 'quota', `status 429, exit ${exitCode}`);
    assert.equal((await claudeCodeRun({ type: 'result', is_error: true, api_error_status: 529, result: 'API Error: 529' }, exitCode)).outcome, 'quota', `status 529, exit ${exitCode}`);
    assert.equal((await claudeCodeRun({ type: 'result', is_error: true, api_error_status: 500, result: 'quota exceeded, rate limit, overloaded' }, exitCode)).outcome, 'error', `status 500 with quota words, exit ${exitCode}: the status decides alone`);
  }
  const failed = await claudeCodeRun({ type: 'result', is_error: true, result: 'Execution error' }, 0);
  assert.equal(failed.outcome, 'error', 'an is_error payload that exited 0 is never ok');
  assert.match(failed.error ?? '', /Execution error/, 'the error names what the payload reported');
  assert.equal((await claudeCodeRun({ type: 'result', is_error: true, result: 'Claude AI usage limit reached' }, 0)).outcome, 'quota', 'without a status the word rule reads the payload');
  assert.equal((await claudeCodeRun({ type: 'result', is_error: true, api_error_status: '500', result: 'quota exceeded' }, 1)).outcome, 'quota', 'a status that is not a number is no status: the word rule decides');
  assert.equal((await claudeCodeRun({ type: 'result', is_error: false, api_error_status: 429, result: 'done' }, 0)).outcome, 'ok', 'a status outside an is_error payload decides nothing');
  assert.equal((await claudeCodeRun({ type: 'result', is_error: false, api_error_status: 500, result: 'quota exceeded' }, 1)).outcome, 'quota', 'a failed run whose payload is not is_error: the word rule decides, not the status');
});

test('T1-PARSE-GUARD: ClaudeCodeProvider reads a failed run with the merged word rule, not the old substring rule [R5]', async () => {
  const failedWith = async (stderr: string) => (await new ClaudeCodeProvider({ runner: scripted(() => ({ exitCode: 1, stderr })).runner }).complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low' })).outcome;
  for (const stderr of ['Error: overloaded_error', 'server at capacity', '429 Too Many Requests', 'usageLimitReached', 'retry after 30 seconds']) assert.equal(await failedWith(stderr), 'quota', stderr);
  for (const stderr of ['Quotation marks unbalanced', 'HTTP429', 'rate.limit.ts not found', 'commit 1429abf']) assert.equal(await failedWith(stderr), 'error', stderr);
});

/** A messages client whose stream throws `err` before any message; no network. */
const throwingClaudeClient = (err: unknown) => ({ messages: { stream: () => { throw err; } } }) as unknown as ClaudeMessagesClient;

test('T1-PARSE-GUARD acceptance 5: ClaudeApiProvider decides quota from the SDK error status alone: 429 and 529 are quota with the retry-after delay, 500 is an error [R4]', async () => {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const apiError = (status: number, message: string) => Anthropic.APIError.generate(status, { type: 'error', error: { type: 'api_error', message } }, message, new Headers({ 'retry-after': '30' }));
  const run = (err: unknown) => new ClaudeApiProvider({ client: throwingClaudeClient(err) }).complete(REQUEST);
  const limited = await run(apiError(429, 'rate limited'));
  assert.equal(limited.outcome, 'quota');
  assert.equal(limited.retryAfterMs, 30_000);
  const unnamed = await run(Anthropic.APIError.generate(429, { type: 'error', error: { type: 'rate_limit_error', message: 'x' } }, 'x', new Headers()));
  assert.equal(unnamed.outcome, 'quota');
  assert.equal(unnamed.retryAfterMs, undefined, 'no retry-after header: no delay, never 0');
  const overloaded = await run(apiError(529, 'Overloaded'));
  assert.equal(overloaded.outcome, 'quota');
  assert.equal(overloaded.retryAfterMs, 30_000, 'a 529 carries the retry-after delay too');
  const server = await run(apiError(500, 'quota exceeded, overloaded'));
  assert.equal(server.outcome, 'error', 'status 500 is an error whatever its message says');
  assert.equal(server.retryAfterMs, undefined, 'an error carries no retry delay');
  assert.equal((await run(new Anthropic.APIConnectionError({ message: 'Connection error.' }))).outcome, 'error', 'no status: the word rule reads the message');
  assert.equal((await run(new Anthropic.APIConnectionError({ message: 'upstream overloaded' }))).outcome, 'quota', 'no status: the word rule reads the message');
  assert.equal((await run(new Error('rate limit'))).outcome, 'error', 'an error that is not an SDK error is never a hold');
});
