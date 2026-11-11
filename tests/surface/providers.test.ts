import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, newInvocationId } from '../../src/providers/types.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { ClaudeCodeProvider } from '../../src/providers/claude-code.ts';
import { ClaudeApiProvider, type ClaudeMessagesClient } from '../../src/providers/claude-api.ts';
import type { CompletionRequest } from '../../src/providers/types.ts';
import type { ExecReceipt, Runner } from '../../src/probes/exec.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ProjectConfig } from '../../src/config.ts';
import { setActorForTests } from '../../src/state/journal.ts';
import { actor, cleanup, tmpDir } from '../infra/helpers.ts';

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
  const now = '2026-11-12T00:00:00.000Z';
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

/** The `--output-format stream-json --verbose` lines of one claude -p run: three tool calls across two assistant events, a line that is not JSON, and the result event. */
const STREAM_LINES = [
  { type: 'system', subtype: 'init', session_id: 'sess-7' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'Reading first.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.md' } }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'aidlc next' } }] } },
  'not json at all',
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x' }] } },
  { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: 'b.ts', old_string: 'a', new_string: 'b' } }] } },
  { type: 'result', subtype: 'success', is_error: false, result: 'all done', session_id: 'sess-7', usage: { input_tokens: 12, output_tokens: 3 }, total_cost_usd: 0.02 },
];
const streamOf = (lines: ReadonlyArray<string | Record<string, unknown>>): string => lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n');

test('T1-EVAL-TRANSCRIPT-2 acceptance 1: recordToolCalls runs stream-json --verbose and returns the tool calls in order with the result text [R1]', async () => {
  const { runner, calls } = scripted(() => ({ stdout: streamOf(STREAM_LINES) }));
  const r = await new ClaudeCodeProvider({ runner }).complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low', recordToolCalls: true });
  assert.deepEqual(calls[0], ['claude', '-p', 'p', '--output-format', 'stream-json', '--verbose']);
  assert.equal(r.outcome, 'ok');
  assert.equal(r.text, 'all done');
  assert.equal(r.invocationId, 'claude-code:sess-7');
  assert.deepEqual(r.usage, { inputTokens: 12, outputTokens: 3, costUsd: 0.02 });
  assert.deepEqual(r.toolCalls, [
    { name: 'Read', input: { file_path: 'a.md' } },
    { name: 'Bash', input: { command: 'aidlc next' } },
    { name: 'Edit', input: { file_path: 'b.ts', old_string: 'a', new_string: 'b' } },
  ]);
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 1: without recordToolCalls the argv is the json one and the result carries no tool calls [R1]', async () => {
  for (const recordToolCalls of [undefined, false]) {
    const { runner, calls } = scripted(() => ({ stdout: JSON.stringify({ result: 'done', session_id: 's' }) }));
    const r = await new ClaudeCodeProvider({ runner }).complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low', ...(recordToolCalls === undefined ? {} : { recordToolCalls }) });
    assert.deepEqual(calls[0], ['claude', '-p', 'p', '--output-format', 'json'], `recordToolCalls ${recordToolCalls}`);
    assert.equal(r.text, 'done');
    assert.equal('toolCalls' in r, false, `recordToolCalls ${recordToolCalls}`);
  }
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 1: a stream whose result event is is_error with status 429 is a quota outcome; a stream with no result event is an error [R2]', async () => {
  const streamRun = async (lines: ReadonlyArray<string | Record<string, unknown>>, exitCode: number) => new ClaudeCodeProvider({ runner: scripted(() => ({ exitCode, stdout: streamOf(lines) })).runner }).complete({ role: 'implementer', system: '', prompt: 'p', effort: 'low', recordToolCalls: true });
  for (const exitCode of [0, 1]) {
    const quota = await streamRun([STREAM_LINES[0]!, { type: 'result', is_error: true, api_error_status: 429, result: 'API Error: 429' }], exitCode);
    assert.equal(quota.outcome, 'quota', `exit ${exitCode}`);
  }
  const noResult = await streamRun(STREAM_LINES.slice(0, 5), 0);
  assert.equal(noResult.outcome, 'error');
  assert.equal(noResult.error, 'no result event in the stream');
});

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const JSON_ARGV = ['claude', '-p', 'p', '--output-format', 'json'];
const STREAM_ARGV = ['claude', '-p', 'p', '--output-format', 'stream-json', '--verbose'];
const REFUSAL = 'CLAUDE_CODE_EFFORT_LEVEL is set in the environment of the claude process, where it outranks --effort; unset it or turn off claudeCode.forwardEffort';
const isEffortKey = (k: string) => k.toUpperCase() === 'CLAUDE_CODE_EFFORT_LEVEL';

/** Registers the restore first, then removes every key named CLAUDE_CODE_EFFORT_LEVEL (any letter case) from process.env, saving the pairs. */
function isolateEnv(t: TestContext): void {
  const saved: Array<[string, string]> = [];
  t.after(() => {
    for (const k of Object.keys(process.env)) if (isEffortKey(k)) delete process.env[k];
    for (const [k, v] of saved) process.env[k] = v;
  });
  for (const k of Object.keys(process.env)) {
    if (!isEffortKey(k)) continue;
    saved.push([k, process.env[k]!]);
    delete process.env[k];
  }
}

/** A scripted runner that also records the options of each call. */
function recording(fn: (args: string[]) => Partial<ExecReceipt> = () => ({ stdout: JSON.stringify({ result: 'done', session_id: 's' }) })): { runner: Runner; calls: string[][]; options: Array<Record<string, unknown> | undefined> } {
  const calls: string[][] = [];
  const options: Array<Record<string, unknown> | undefined> = [];
  const runner: Runner = async (command, args, opts) => {
    calls.push([command, ...args]);
    options.push(opts as Record<string, unknown> | undefined);
    return receipt(fn(args));
  };
  return { runner, calls, options };
}
const req = (extra: Partial<CompletionRequest> = {}): CompletionRequest => ({ role: 'implementer', system: '', prompt: 'p', effort: 'low', ...extra });

test("T0-CLAUDE-EFFORT-OPT-IN: with forwardEffort the request's effort is passed after the model, in both modes", async (t) => {
  isolateEnv(t);
  for (const effort of EFFORTS) {
    const json = recording();
    await new ClaudeCodeProvider({ runner: json.runner, forwardEffort: true }).complete(req({ effort }));
    assert.deepEqual(json.calls[0], [...JSON_ARGV, '--effort', effort]);
    const stream = recording(() => ({ stdout: streamOf(STREAM_LINES) }));
    await new ClaudeCodeProvider({ runner: stream.runner, forwardEffort: true }).complete(req({ effort, recordToolCalls: true }));
    assert.deepEqual(stream.calls[0], [...STREAM_ARGV, '--effort', effort]);
  }
});

test("T0-CLAUDE-EFFORT-OPT-IN: with forwardEffort false or absent the argv and the runner options are today's", async (t) => {
  isolateEnv(t);
  for (const effort of EFFORTS) {
    for (const opts of [{}, { forwardEffort: false }, { forwardEffort: 'yes' as unknown as boolean }]) {
      const json = recording();
      await new ClaudeCodeProvider({ runner: json.runner, ...opts }).complete(req({ effort }));
      assert.deepEqual(json.calls[0], JSON_ARGV, `${effort} ${JSON.stringify(opts)}`);
      const stream = recording(() => ({ stdout: streamOf(STREAM_LINES) }));
      await new ClaudeCodeProvider({ runner: stream.runner, ...opts }).complete(req({ effort, recordToolCalls: true }));
      assert.deepEqual(stream.calls[0], STREAM_ARGV, `${effort} ${JSON.stringify(opts)}`);
    }
  }
  for (const opts of [{}, { forwardEffort: true }]) {
    const bare = recording();
    await new ClaudeCodeProvider({ runner: bare.runner, ...opts }).complete(req());
    assert.equal('env' in bare.options[0]!, false, `no env without request env ${JSON.stringify(opts)}`);
    const withEnv = recording();
    await new ClaudeCodeProvider({ runner: withEnv.runner, ...opts }).complete(req({ env: { A: '1' } }));
    assert.deepEqual(withEnv.options[0]!['env'], { ...process.env, A: '1' }, JSON.stringify(opts));
  }
});

test('T0-CLAUDE-EFFORT-OPT-IN: CLAUDE_CODE_EFFORT_LEVEL in the launch environment refuses the call and starts no process', async (t) => {
  const rows: Array<[string, Partial<CompletionRequest>, string | undefined]> = [
    ['upper case key', { env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' } }, undefined],
    ['lower case key', { env: { claude_code_effort_level: 'max' } }, undefined],
    ['empty value', { env: { CLAUDE_CODE_EFFORT_LEVEL: '' } }, undefined],
    ['inherited from process.env', {}, 'low'],
  ];
  for (const stream of [false, true]) {
    const mode = stream ? 'stream' : 'json';
    const stdout = stream ? streamOf(STREAM_LINES) : JSON.stringify({ result: 'done' });
    for (const [name, extra, inherited] of rows) {
      await t.test(`${name}, ${mode}`, async (st) => {
        isolateEnv(st);
        if (inherited !== undefined) process.env['CLAUDE_CODE_EFFORT_LEVEL'] = inherited;
        const { runner, calls } = recording(() => ({ stdout }));
        const r = await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req({ ...extra, ...(stream ? { recordToolCalls: true } : {}) }));
        assert.equal(r.outcome, 'error');
        assert.equal(r.error, REFUSAL);
        assert.equal(r.text, '');
        assert.equal(r.provider, 'claude-code');
        assert.equal('toolCalls' in r, false);
        assert.equal(calls.length, 0);
      });
    }
    await t.test(`control: option absent with the variable, ${mode}`, async (st) => {
      isolateEnv(st);
      const { runner, calls } = recording(() => ({ stdout }));
      await new ClaudeCodeProvider({ runner }).complete(req({ env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' }, ...(stream ? { recordToolCalls: true } : {}) }));
      assert.deepEqual(calls, [stream ? STREAM_ARGV : JSON_ARGV]);
    });
    await t.test(`control: option true without the variable, ${mode}`, async (st) => {
      isolateEnv(st);
      const { runner, calls } = recording(() => ({ stdout }));
      await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req(stream ? { recordToolCalls: true } : {}));
      assert.deepEqual(calls, [[...(stream ? STREAM_ARGV : JSON_ARGV), '--effort', 'low']]);
    });
  }
});

test('T0-CLAUDE-EFFORT-OPT-IN: providerFor and runProviderFor pass claudeCode.forwardEffort to the claude-code provider', async (t) => {
  t.after(() => setActorForTests(undefined));
  setActorForTests(actor('effort-test', 4242));
  isolateEnv(t);
  const root = tmpDir();
  t.after(() => cleanup(root));
  const cli = (await import('../../src/cli/main.ts')) as unknown as { providerFor: (name: string | undefined, config: ProjectConfig, runner?: Runner) => ClaudeCodeProvider; runProviderFor: (root: string, runner?: Runner, forwardEffort?: boolean) => ClaudeCodeProvider };
  const sent = async (make: (runner: Runner) => ClaudeCodeProvider) => {
    const { runner, calls } = recording();
    await make(runner).complete(req({ effort: 'xhigh' }));
    return calls[0];
  };
  const on = [...JSON_ARGV, '--effort', 'xhigh'];
  assert.deepEqual(await sent((r) => cli.providerFor('claude-code', ProjectConfig.parse({ claudeCode: { forwardEffort: true } }), r)), on);
  assert.deepEqual(await sent((r) => cli.providerFor(undefined, ProjectConfig.parse({ provider: 'claude-code', claudeCode: { forwardEffort: true } }), r)), on);
  assert.deepEqual(await sent((r) => cli.providerFor('claude-code', ProjectConfig.parse({}), r)), JSON_ARGV);
  assert.deepEqual(await sent((r) => cli.runProviderFor(root, r, true)), on);
  assert.deepEqual(await sent((r) => cli.runProviderFor(root, r)), JSON_ARGV);
  assert.deepEqual(await sent((r) => cli.runProviderFor(root, r, false)), JSON_ARGV);
});

test('T0-CLAUDE-EFFORT-OPT-IN: the aidlc run and evals run actions pass the configured value', () => {
  const file = path.join(import.meta.dirname, '..', '..', 'src', 'cli', 'main.ts');
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const calls: Record<string, ts.CallExpression[]> = { runProviderFor: [], providerFor: [] };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text in calls) calls[node.expression.text]!.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  assert.ok(calls['runProviderFor']!.length >= 1);
  for (const c of calls['runProviderFor']!) {
    assert.equal(c.arguments.length, 3);
    assert.equal(c.arguments[2]!.getText(sf), 'c.config.claudeCode.forwardEffort');
  }
  assert.ok(calls['providerFor']!.length >= 1);
  for (const c of calls['providerFor']!) assert.equal(c.arguments[1]?.getText(sf), 'c.config');
});

test('T0-CLAUDE-EFFORT-OPT-IN: the rows of the acceptance 7 table', async (t) => {
  const base = { forwardEffort: true, defaultModel: 'claude-opus-5-5', extraArgs: ['--no-color'] };
  const full = (extra: Partial<CompletionRequest> = {}): CompletionRequest => ({ role: 'implementer', system: 'sys', prompt: 'p', effort: 'high', allowedTools: ['Read'], ...extra });
  const order = (mode: string[], model: string) => [...mode, '--append-system-prompt', 'sys', '--model', model, '--effort', 'high', '--allowedTools', 'Read', '--no-color'];
  const orderRows: Array<[string, Partial<CompletionRequest>, string[], string]> = [
    ['T1 order, JSON', {}, JSON_ARGV, 'claude-opus-5-5'],
    ['T2 order, JSON, request model', { model: 'm' }, JSON_ARGV, 'm'],
    ['T3 order, stream', { recordToolCalls: true }, STREAM_ARGV, 'claude-opus-5-5'],
    ['T4 order, stream, request model', { recordToolCalls: true, model: 'm' }, STREAM_ARGV, 'm'],
  ];
  for (const [name, extra, mode, model] of orderRows) {
    await t.test(name, async (st) => {
      isolateEnv(st);
      const { runner, calls } = recording(() => ({ stdout: streamOf(STREAM_LINES) }));
      await new ClaudeCodeProvider({ ...base, runner }).complete(full(extra));
      assert.deepEqual(calls[0], order(mode, model));
    });
  }
  await t.test('T5 success, JSON', async (st) => {
    isolateEnv(st);
    const { runner, calls } = recording(() => ({ stdout: '{"result":"done","session_id":"s"}' }));
    const r = await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req());
    assert.equal(r.outcome, 'ok');
    assert.equal(r.text, 'done');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.slice(-2), ['--effort', 'low']);
  });
  await t.test('T6 success, stream', async (st) => {
    isolateEnv(st);
    const { runner, calls } = recording(() => ({ stdout: streamOf(STREAM_LINES) }));
    const r = await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req({ recordToolCalls: true }));
    assert.equal(r.outcome, 'ok');
    assert.equal(r.text, 'all done');
    assert.deepEqual(r.toolCalls, [
      { name: 'Read', input: { file_path: 'a.md' } },
      { name: 'Bash', input: { command: 'aidlc next' } },
      { name: 'Edit', input: { file_path: 'b.ts', old_string: 'a', new_string: 'b' } },
    ]);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.slice(-2), ['--effort', 'low']);
  });
  await t.test('T7 CLI rejection, JSON', async (st) => {
    isolateEnv(st);
    const { runner, calls } = recording(() => ({ exitCode: 1, stderr: 'error: invalid effort level' }));
    const r = await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req({ effort: 'max' }));
    assert.equal(r.outcome, 'error');
    assert.equal(r.error, 'error: invalid effort level');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.slice(-2), ['--effort', 'max']);
  });
  await t.test('T8 CLI rejection, stream', async (st) => {
    isolateEnv(st);
    const { runner, calls } = recording(() => ({ exitCode: 1, stdout: '', stderr: 'error: invalid effort level' }));
    const r = await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req({ effort: 'max', recordToolCalls: true }));
    assert.equal(r.outcome, 'error');
    assert.equal(r.error, 'no result event in the stream');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.slice(-2), ['--effort', 'max']);
  });
  await t.test('T9 refusal fields', async (st) => {
    isolateEnv(st);
    const env = { CLAUDE_CODE_EFFORT_LEVEL: 'high' };
    const { runner, calls } = recording();
    const results = [
      await new ClaudeCodeProvider({ runner, forwardEffort: true, defaultModel: 'd' }).complete(req({ env, model: 'm' })),
      await new ClaudeCodeProvider({ runner, forwardEffort: true, defaultModel: 'd' }).complete(req({ env })),
      await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req({ env })),
    ];
    assert.deepEqual(results.map((r) => r.model), ['m', 'd', 'claude']);
    for (const r of results) {
      assert.match(r.invocationId, /^claude-code-[0-9a-z]+-[0-9a-z]+$/);
      assert.equal(r.durationMs, 0);
      assert.equal(r.outcome, 'error');
      assert.equal(r.error, REFUSAL);
    }
    assert.equal(new Set(results.map((r) => r.invocationId)).size, 3);
    assert.equal(calls.length, 0);
  });
  await t.test('T10 inherited variable plus env', async (st) => {
    isolateEnv(st);
    process.env['CLAUDE_CODE_EFFORT_LEVEL'] = 'low';
    const { runner, calls } = recording();
    const r = await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req({ env: { A: '1' } }));
    assert.equal(r.outcome, 'error');
    assert.equal(r.error, REFUSAL);
    assert.equal(calls.length, 0);
  });
  await t.test('T11 explicit false with variable', async (st) => {
    isolateEnv(st);
    const { runner, calls } = recording();
    await new ClaudeCodeProvider({ runner, forwardEffort: false }).complete(req({ env: { CLAUDE_CODE_EFFORT_LEVEL: 'high' } }));
    assert.deepEqual(calls, [JSON_ARGV]);
  });
  await t.test('T12 unrelated variables', async (st) => {
    isolateEnv(st);
    const { runner, calls } = recording();
    await new ClaudeCodeProvider({ runner, forwardEffort: true }).complete(req({ env: { CLAUDE_CODE_EFFORT_LEVELS: 'high', CLAUDE_EFFORT: 'xhigh', EFFORT_LEVEL: 'max' } }));
    assert.deepEqual(calls, [[...JSON_ARGV, '--effort', 'low']]);
  });
});
