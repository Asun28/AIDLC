// Card T1-OUTCOME-USAGE: usage rows from Claude Code session logs, Codex session logs and reviewer logs (bench/outcome/usage.ts),
// their attribution and list-price cost, and the cost views. Fixtures are hand-written: the structure of real files, with X in every text field.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, type Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectConfig, resolveWorktreeRoot } from '../../src/config.ts';
import { resolveRepoIdentity } from '../../src/state/paths.ts';
import { writeTables, type Row } from '../../bench/outcome/ingest.ts';
import { attribute, claudeUsage, codexUsage, priceOf, reviewLogUsage, type Prices } from '../../bench/outcome/usage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const X = 'x-private-text';
const temps: string[] = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir(): string {
  const dir = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'aidlc-usage-')));
  temps.push(dir);
  return dir;
}

function put(file: string, lines: string[]): string {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, lines.map((line) => `${line}\n`).join(''));
  return file;
}

type Tokens = [input: number, output: number, cacheRead: number, cacheWrite: number, cacheWrite1h?: number];
/** A Claude Code log line with the keys of a real one. `tokens` undefined gives a line without `message.usage`, and no fifth number a usage without `cache_creation`. */
const claudeLine = (type: string, id: string, tokens: Tokens | undefined, ts = '2026-01-02T01:00:00.000Z', extra: object = {}): string => {
  const usage = tokens && { input_tokens: tokens[0], output_tokens: tokens[1], cache_read_input_tokens: tokens[2], cache_creation_input_tokens: tokens[3], service_tier: X, ...(tokens[4] === undefined ? {} : { cache_creation: { ephemeral_5m_input_tokens: tokens[3] - tokens[4], ephemeral_1h_input_tokens: tokens[4] } }) };
  const message = { id, type: 'message', role: type, model: 'model-a', content: [{ type: 'text', text: X }, { type: 'tool_use', name: X, input: { command: X } }], stop_reason: X, usage };
  return JSON.stringify({ type, uuid: X, parentUuid: X, sessionId: 's1', timestamp: ts, cwd: 'C:\\repo', gitBranch: X, isSidechain: false, version: X, requestId: `req-${id}`, message, toolUseResult: { stdout: X }, ...extra });
};
const codexLine = (type: string, payload: object, ts = '2026-01-02T03:00:00.000Z'): string => JSON.stringify({ timestamp: ts, type, payload });
const tokenCount = (input: number, cached: number, output: number, ts?: string): string => codexLine('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, cache_write_input_tokens: 12, output_tokens: output, reasoning_output_tokens: 7, total_tokens: input + output }, last_token_usage: {}, model_context_window: 1 }, rate_limits: { plan_type: X } }, ts);
const codexSession = (id: string, cwd: string, counts: string[]): string[] => [codexLine('session_meta', { id, cwd, originator: X, instructions: X }), codexLine('turn_context', { model: 'model-old', cwd, summary: X }), codexLine('event_msg', { type: 'user_message', message: X }), ...counts.slice(0, -1), codexLine('turn_context', { model: 'model-b', cwd, summary: X }), codexLine('event_msg', { type: 'agent_message', message: X }), ...counts.slice(-1)];
const reviewLog = (durationMs: number, tail: string[]): string[] => [`# review codex exit=0 timedOut=false durationMs=${durationMs} outputSha256=ab12 outcome=pass runStatus=success`, 'workdir: C:\\wt\\T1-X', 'model: model-b', `session id: ${X}`, X, ...tail, X];

/** A session with two requests (the first streamed over three lines) and two subagents, one with a meta file; a Codex session; a reviewer log with two token counts, one directly under `review` and one without a count. */
function fixture(): { claudeDir: string; codexDir: string; stateDir: string; dir: string } {
  const dir = tempDir();
  const [claudeDir, codexDir, stateDir] = [path.join(dir, 'claude'), path.join(dir, 'codex'), path.join(dir, 'state')];
  put(path.join(claudeDir, 's1.jsonl'), [claudeLine('user', 'u1', undefined), claudeLine('assistant', 'm1', [9, 9, 9, 9]), claudeLine('assistant', 'm1', [8, 8, 8, 8]), JSON.stringify({ type: 'system', content: X, sessionId: 's1', timestamp: '2026-01-02T01:00:00.000Z' }), claudeLine('assistant', 'm1', [1, 2, 3, 4, 0]), claudeLine('assistant', 'm2', [5, 6, 7, 8, 3], '2026-01-02T01:05:00.000Z')]);
  const subagents = path.join(claudeDir, 's1', 'subagents');
  put(path.join(subagents, 'agent-a1.jsonl'), [claudeLine('assistant', 'm3', [1, 2, 3, 4], undefined, { isSidechain: true, agentId: 'a1' })]);
  put(path.join(subagents, 'agent-a1.meta.json'), [JSON.stringify({ agentType: 'implementer', description: `${X} T1-X-2 ${X}`, effort: X, toolUseId: X })]);
  put(path.join(subagents, 'agent-b2.jsonl'), [claudeLine('assistant', 'm4', [1, 2, 3, 4], undefined, { isSidechain: true, agentId: 'b2' })]);
  put(path.join(codexDir, '2026', '01', '02', 'rollout-2026-01-02T03-00-00-cx1.jsonl'), codexSession('cx1', 'C:\\wt\\T1-X', [tokenCount(1000, 500, 5), tokenCount(277568, 234368, 9000, '2026-01-02T03:04:00.000Z')]));
  put(path.join(stateDir, 'evidence', 'g-a', 'review', 'T1-X', 'T1-X.r3.1.abc.log'), reviewLog(55024, ['tokens used', '9', X, 'tokens used', '44,031']));
  put(path.join(stateDir, 'evidence', 'g-a', 'review', 'loose.log'), reviewLog(7, ['tokens used', '7']));
  put(path.join(stateDir, 'evidence', 'g-a', 'review', 'T1-X', 'T1-X.r3.2.def.log'), reviewLog(100, []));
  return { claudeDir, codexDir, stateDir, dir };
}

const claudeRow = (rest: Row): Row => ({ source: 'claude-code', sessionId: 's1', ts: '2026-01-02T01:00:00.000Z', model: 'model-a', cwd: 'C:\\repo', sidechain: false, inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4, cacheWrite1hTokens: 0, agentId: null, agentType: null, agentCard: null, ...rest });
const codexRow: Row = { source: 'codex', sessionId: 'cx1', cwd: 'C:\\wt\\T1-X', ts: '2026-01-02T03:04:00.000Z', model: 'model-b', inputTokens: 43200, cacheReadTokens: 234368, cacheWriteTokens: 12, outputTokens: 9000 };
const logRow: Row = { source: 'review-log', goalId: 'g-a', cardId: 'T1-X', invocation: 'T1-X.r3.1.abc', totalTokens: 44031, durationMs: 55024, model: 'model-b' };
const looseLogRow: Row = { ...logRow, cardId: null, invocation: 'loose', totalTokens: 7, durationMs: 7 };

test('T1-OUTCOME-USAGE acceptance 1: claudeUsage returns one row per (message.id, requestId) with the values of the last line, and reads a subagent file with its meta file [R1]', () => {
  const usage = claudeUsage([fixture().claudeDir], ['T1-X', 'T1-X-2']);
  assert.deepEqual(usage.rows, [
    claudeRow({}),
    claudeRow({ ts: '2026-01-02T01:05:00.000Z', inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheWriteTokens: 8, cacheWrite1hTokens: 3 }),
    claudeRow({ sidechain: true, agentId: 'a1', agentType: 'implementer', agentCard: 'T1-X-2' }),
    claudeRow({ sidechain: true, agentId: 'b2' }),
  ]);
  assert.deepEqual(usage.errors, []);
  // Two lines without a requestId are two requests, even with one message id.
  const bare = claudeLine('assistant', 'm8', [1, 2, 3, 4]).replace('"requestId":"req-m8",', '');
  assert.deepEqual(claudeUsage([path.dirname(put(path.join(tempDir(), 'claude', 's3.jsonl'), [bare, bare]))], []).rows, [claudeRow({}), claudeRow({})]);
});

test('T1-OUTCOME-USAGE acceptance 2: codexUsage returns one row per rollout file from its last token_count line [R2]', () => {
  const f = fixture();
  assert.deepEqual(codexUsage(f.codexDir), { rows: [codexRow], errors: [] });
  // A token_count line without totals, a turn_context without a model and a second session_meta after the valid lines change nothing.
  const session = path.join(f.codexDir, '2026', '01', '02', 'rollout-2026-01-02T03-00-00-cx1.jsonl');
  put(session, [...readFileSync(session, 'utf8').trim().split('\n'), codexLine('event_msg', { type: 'token_count', info: null }), codexLine('turn_context', { cwd: 'C:\\wt' }), codexLine('session_meta', { id: 'cx9', cwd: 'C:\\other' })]);
  assert.deepEqual(codexUsage(f.codexDir), { rows: [codexRow], errors: [] });
});

test('T1-OUTCOME-USAGE acceptance 3: reviewLogUsage reads the number after the last tokens used line, gives a log directly under review a null card, and gives no row and no error for a log without the line [R3]', () => {
  assert.deepEqual(reviewLogUsage(fixture().stateDir), { rows: [logRow, looseLogRow], errors: [] });
  // A marker followed by no number, as a later line or as the last line, leaves the earlier pair in place.
  const stateDir = path.join(tempDir(), 'state');
  put(path.join(stateDir, 'evidence', 'g-a', 'review', 'T1-X', 'a.log'), reviewLog(5, ['tokens used', '42', 'tokens used', 'unfinished']));
  put(path.join(stateDir, 'evidence', 'g-a', 'review', 'T1-X', 'b.log'), [...reviewLog(5, ['tokens used', '43']).slice(0, -1), 'tokens used']);
  assert.deepEqual(reviewLogUsage(stateDir).rows.map((row) => [row['invocation'], row['totalTokens']]), [['a', 42], ['b', 43]]);
});

/** The fixture with a line and a meta file that are not JSON, a usage line without a message id and two Codex files without a usable token count, read with one absent directory per source. */
function withErrors(): { rows: Row[]; errors: Row[]; expected: Row[] } {
  const f = fixture();
  const gone = path.join(f.dir, 'gone');
  const badLine = put(path.join(f.claudeDir, 's2.jsonl'), ['{', claudeLine('assistant', 'm9', [1, 2, 3, 4]).replace('"id":"m9",', ''), claudeLine('assistant', 'm5', [1, 2, 3, 4])]);
  put(path.join(f.claudeDir, 's1', 'subagents', 'agent-c3.jsonl'), [claudeLine('assistant', 'm6', [1, 2, 3, 4], undefined, { isSidechain: true, agentId: 'c3' })]);
  const badMeta = put(path.join(f.claudeDir, 's1', 'subagents', 'agent-c3.meta.json'), ['{']);
  const noInfo = put(path.join(f.codexDir, 'rollout-noinfo.jsonl'), codexSession('cx3', 'C:\\wt', [codexLine('event_msg', { type: 'token_count', info: null, rate_limits: { plan_type: X } })]));
  const noCount = put(path.join(f.codexDir, 'rollout-none.jsonl'), codexSession('cx2', 'C:\\wt', []));
  // A directory with the name of a source file cannot be read as one on any platform, and the file inside it is not a source.
  const [claudeNamedDir, codexNamedDir] = [path.join(f.claudeDir, 's.jsonl'), path.join(f.codexDir, 'rollout-x.jsonl')];
  put(path.join(claudeNamedDir, 'inner.jsonl'), [claudeLine('assistant', 'm7', [1, 2, 3, 4])]);
  put(path.join(codexNamedDir, 'rollout-inner.jsonl'), codexSession('cx4', 'C:\\wt', [tokenCount(10, 5, 1)]));
  const all = [claudeUsage([gone, f.claudeDir], ['T1-X', 'T1-X-2']), codexUsage(gone), codexUsage(f.codexDir), reviewLogUsage(gone), reviewLogUsage(f.stateDir)];
  const expected = [
    { source: 'claude-code', path: gone, problem: 'missing directory' },
    { source: 'claude-code', path: claudeNamedDir, problem: 'unreadable' },
    { source: 'claude-code', path: badMeta, problem: 'not JSON' },
    { source: 'claude-code', path: badLine, problem: 'not JSON (line 1)' },
    { source: 'claude-code', path: badLine, problem: 'usage line without message.id (line 2)' },
    { source: 'codex', path: gone, problem: 'missing directory' },
    { source: 'codex', path: noInfo, problem: 'no token_count line' },
    { source: 'codex', path: noCount, problem: 'no token_count line' },
    { source: 'codex', path: codexNamedDir, problem: 'unreadable' },
    { source: 'review-log', path: path.join(gone, 'evidence'), problem: 'missing directory' },
  ];
  return { rows: all.flatMap((u) => u.rows), errors: all.flatMap((u) => u.errors), expected };
}

test('T1-OUTCOME-USAGE acceptance 4: an absent directory of each source, a line and a meta file that are not JSON, a usage line without a message id, two Codex files without a usable token_count line and a directory named as a file of each log source give ten usage_errors rows beside the valid rows [R4]', () => {
  const { rows, errors, expected } = withErrors();
  assert.deepEqual(errors.map((e) => ({ ...e, problem: String(e['problem']).replace(/^unreadable: .+$/, 'unreadable') })), expected);
  assert.deepEqual(rows.map((r) => `${String(r['source'])} ${String(r['agentId'] ?? r['sessionId'] ?? r['invocation'])}`), ['claude-code s1', 'claude-code s1', 'claude-code a1', 'claude-code b2', 'claude-code c3', 'claude-code s1', 'codex cx1', 'review-log T1-X.r3.1.abc', 'review-log loose']);
  assert.deepEqual(rows[4], claudeRow({ sidechain: true, agentId: 'c3' }), 'the row of a subagent whose meta file is not JSON');
  // A directory that cannot be listed is one error naming it, beside the rows of its sibling file.
  const f = fixture();
  const subagents = path.join(f.claudeDir, 's1', 'subagents');
  const list = (dir: string): Dirent[] => {
    if (dir === subagents) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return readdirSync(dir, { withFileTypes: true });
  };
  const listed = claudeUsage([f.claudeDir], [], list);
  assert.deepEqual([listed.rows.map((row) => row['agentId']), listed.errors], [[null, null], [{ source: 'claude-code', path: subagents, problem: 'unreadable: EACCES' }]]);
  // A meta file that cannot be read (here a directory of its name) is one error naming it, and its subagent keeps its row.
  mkdirSync(path.join(subagents, 'agent-b2.meta.json'));
  const unreadableMeta = claudeUsage([f.claudeDir], ['T1-X-2']);
  assert.deepEqual(unreadableMeta.rows.map((row) => [row['agentId'], row['agentType']]), [[null, null], [null, null], ['a1', 'implementer'], ['b2', null]]);
  assert.deepEqual(unreadableMeta.errors.map((e) => [e['path'], String(e['problem']).split(':')[0]]), [[path.join(subagents, 'agent-b2.meta.json'), 'unreadable']]);
});

test('T1-OUTCOME-USAGE acceptance 5: every row has only the keys the card names, and no row or error holds the text of a fixture [R5]', () => {
  const { rows, errors } = withErrors();
  const keys: Record<string, Row> = { 'claude-code': claudeRow({}), codex: codexRow, 'review-log': logRow };
  assert.deepEqual([rows.length, errors.length], [9, 10]);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), Object.keys(keys[String(row['source'])]!).sort());
  for (const row of errors) assert.deepEqual(Object.keys(row), ['source', 'path', 'problem']);
  assert.equal(readFileSync(path.join(fixture().claudeDir, 's1.jsonl'), 'utf8').includes(X), true, 'the fixture holds the marker');
  assert.equal(JSON.stringify([rows, errors]).includes(X), false);
});

test('T1-OUTCOME-USAGE acceptance 6: attribute sets the card, goal and stage of each row by the first rule that applies [R6]', () => {
  const wt = path.join(tempDir(), 'wt');
  const day = (d: number, time: string): string => `2026-01-0${d}T${time}:00Z`;
  const tables = {
    card_runs: [{ goalId: 'g-1', cardId: 'T1-X', startedAt: day(2, '00:00'), updatedAt: day(2, '12:00') }, { goalId: 'g-2', cardId: 'T1-X', startedAt: day(3, '00:00'), updatedAt: day(3, '12:00') },
      // Two runs of T1-W: the window of the first holds day 3, the later one ended before it.
      { goalId: 'g-5', cardId: 'T1-W', startedAt: day(2, '00:00'), updatedAt: day(4, '00:00') }, { goalId: 'g-6', cardId: 'T1-W', startedAt: day(2, '06:00'), updatedAt: day(2, '07:00') }],
    attempts: [{ goalId: 'g-1', cardId: 'T1-X', startTs: day(2, '01:00'), endTs: day(2, '02:00') }, { goalId: 'g-1', cardId: 'T1-Y', startTs: day(2, '01:30'), endTs: day(2, '03:00') }, { goalId: 'g-1', cardId: 'T1-Y', startTs: null, endTs: day(2, '01:20') }],
    state_spans: [{ goalId: 'g-1', cardId: 'T1-X', state: 'BUILD', startTs: day(2, '04:00'), endTs: day(2, '05:00') }, { goalId: 'g-1', cardId: 'T1-Y', state: 'BUILD', startTs: day(2, '04:30'), endTs: day(2, '06:00') }, { goalId: 'g-1', cardId: 'T1-Y', state: 'DONE', startTs: day(2, '06:00'), endTs: null }],
  };
  const codex = (cwd: string, ts: string): Row => ({ ...codexRow, cwd, ts });
  const cases: [row: Row, cardId: string | null, goalId: string | null, stage: string][] = [
    [logRow, 'T1-X', 'g-a', 'review'],
    [codex(path.join(wt, 'T1-X', 'src'), day(3, '01:00')), 'T1-X', 'g-2', 'review'],
    [codex(path.join(wt, 'T1-X'), day(2, '20:00')), 'T1-X', 'g-1', 'review'],
    [codex(path.join(wt, 'T1-X-2'), day(3, '01:00')), 'T1-X-2', null, 'review'],
    [codex(path.join(wt, 'T1-W'), day(3, '01:00')), 'T1-W', 'g-5', 'review'],
    [codex(wt, day(3, '01:00')), null, null, 'unattributed'],
    [codex(path.join(wt, '..', 'T1-X'), day(3, '01:00')), null, null, 'unattributed'],
    [claudeRow({ agentId: 'a1', agentType: 'implementer', agentCard: 'T1-X-2', ts: day(2, '01:10') }), 'T1-X-2', null, 'implement'],
    [claudeRow({ agentId: 'b2', agentType: 'Explore', ts: day(2, '01:10') }), 'T1-X', 'g-1', 'subagent'],
    [claudeRow({ agentId: 'b2', ts: day(2, '01:45') }), null, null, 'unattributed'],
    [claudeRow({ ts: day(2, '04:10') }), 'T1-X', 'g-1', 'coordinate'],
    [claudeRow({ ts: day(2, '04:45') }), null, null, 'unattributed'],
    [claudeRow({ ts: day(2, '05:30') }), 'T1-Y', null, 'coordinate'],
    [claudeRow({ ts: day(2, '07:00') }), null, null, 'unattributed'],
  ];
  const attributed = attribute(cases.map(([row]) => ({ ...row, text: X })), tables, wt);
  assert.deepEqual(attributed, cases.map(([row, cardId, goalId, stage]) => ({ ...row, cardId, goalId, stage })));
});

test('T1-OUTCOME-USAGE acceptance 6: a codex row with an empty or a relative cwd is unattributed when the process runs in a directory under <worktreeRoot>/T1-X [R6]', () => {
  const wt = path.join(tempDir(), 'wt');
  const inCard = path.join(wt, 'T1-X', 'src');
  mkdirSync(inCard, { recursive: true });
  const card = path.join(wt, 'T1-X');
  const cases: [cwd: string, cardId: string | null][] = [['', null], ['.', null], ['src', null], [card + path.sep, 'T1-X']];
  // Only a Windows path has a drive: without it the path has a root and takes the drive of the invocation directory.
  if (process.platform === 'win32') {
    const drive = card[0]!;
    cases.push([card.slice(2), null], [(drive === drive.toLowerCase() ? drive.toUpperCase() : drive.toLowerCase()) + card.slice(1), 'T1-X']);
  }
  const rows = cases.map(([cwd]): Row => ({ ...codexRow, cwd }));
  const before = process.cwd();
  process.chdir(inCard);
  try {
    assert.deepEqual(attribute(rows, { card_runs: [], attempts: [], state_spans: [] }, wt), rows.map((row, i) => ({ ...row, cardId: cases[i]![1], goalId: null, stage: cases[i]![1] === null ? 'unattributed' : 'review' })));
  } finally {
    process.chdir(before);
  }
});

test('T1-OUTCOME-USAGE acceptance 7: priceOf returns the list-price cost of a row with 5-minute and 1-hour cache writes, null for an unknown model and for a review-log row, and prices.json holds the six models with five prices, a source and the date read [R7]', () => {
  const prices: Prices = {
    'model-a': { input: 3, cacheRead: 0.5, cacheWrite: 4, cacheWriteLong: 6, output: 15, cacheWriteTier: '5 minutes', cacheWriteLongTier: '1 hour', source: 'https://example.com/a', date: '2026-01-01' },
    'model-b': { input: 1, cacheRead: 0.25, cacheWrite: 2, cacheWriteLong: 3, output: 8, cacheWriteTier: '30 minutes', cacheWriteLongTier: '12 hours', source: 'https://example.com/b', date: '2026-01-01' },
  };
  // 1 M input at 3, 2 M cache read at 0.5, 0.5 M cache write (0.3 M 5-minute at 4, 0.2 M 1-hour at 6), 0.1 M output at 15: 3 + 1 + 1.2 + 1.2 + 1.5.
  assert.equal(priceOf(claudeRow({ inputTokens: 1_000_000, cacheReadTokens: 2_000_000, cacheWriteTokens: 500_000, cacheWrite1hTokens: 200_000, outputTokens: 100_000 }), prices), 7.9);
  // A Codex row names no duration: 2 M input at 1, 4 M cache read at 0.25, 1 M cache write at the shorter tier 2, 0.25 M output at 8: 2 + 1 + 2 + 2.
  assert.equal(priceOf({ ...codexRow, inputTokens: 2_000_000, cacheReadTokens: 4_000_000, cacheWriteTokens: 1_000_000, outputTokens: 250_000 }, prices), 7);
  assert.equal(priceOf(claudeRow({ model: 'model-c' }), prices), null);
  assert.equal(priceOf(claudeRow({ model: 'constructor' }), prices), null);
  assert.equal(priceOf({ ...logRow, model: 'model-a' }, prices), null);
  const stored = JSON.parse(readFileSync(path.join(root, 'bench', 'outcome', 'prices.json'), 'utf8')) as Prices;
  assert.deepEqual(Object.keys(stored).sort(), ['claude-fable-5-2', 'claude-haiku-5-5', 'claude-opus-5-5', 'claude-sonnet-5-5', 'gpt-5.6-sol', 'gpt-6-astra']);
  for (const [model, entry] of Object.entries(stored)) {
    assert.deepEqual([entry.input, entry.cacheRead, entry.cacheWrite, entry.cacheWriteLong, entry.output].map((price) => typeof price === 'number' && price > 0), [true, true, true, true, true], model);
    assert.deepEqual([entry.cacheWriteTier, entry.cacheWriteLongTier], model.startsWith('claude-') ? ['5 minutes', '1 hour'] : ['30 minutes', '12 hours'], model);
    assert.match(entry.source, /^https:\/\/\S+$/, model);
    assert.equal(entry.date, '2026-11-10', model);
  }
});

test('T1-OUTCOME-USAGE acceptance 12: writeTables writes the tables and the error of a Claude directory whose path cannot be resolved, and still refuses an output directory inside it [R4] [R11]', () => {
  const f = fixture();
  const denied = (): never => {
    throw Object.assign(new Error('denied'), { code: 'EACCES' });
  };
  const claude = claudeUsage([f.claudeDir], [], (dir) => (dir === f.claudeDir ? denied() : readdirSync(dir, { withFileTypes: true })));
  const tables = { cards: [], card_runs: [], review_decisions: [], findings: [], state_spans: [], attempts: [], ingest_errors: [], usage: codexUsage(f.codexDir).rows, usage_errors: claude.errors };
  const resolve = (p: string): string => (p === f.claudeDir ? denied() : realpathSync.native(p));
  const out = path.join(f.dir, 'out');
  writeTables(tables, out, [f.stateDir, f.claudeDir, f.codexDir], resolve);
  assert.deepEqual(readFileSync(path.join(out, 'usage_errors.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Row), [{ source: 'claude-code', path: f.claudeDir, problem: 'unreadable: EACCES' }]);
  assert.match(readFileSync(path.join(out, 'usage.jsonl'), 'utf8'), /^\{"source":"codex","sessionId":"cx1"/);
  assert.throws(() => writeTables(tables, path.join(f.claudeDir, 'new', 'out'), [f.stateDir, f.claudeDir, f.codexDir], resolve), /refusing to write/);
  assert.equal(existsSync(path.join(f.claudeDir, 'new')), false);
  // With no ancestor that resolves, as on a drive that is gone, the paths are compared as given.
  writeTables(tables, path.join(f.dir, 'out-2'), [f.claudeDir], denied);
  assert.equal(existsSync(path.join(f.dir, 'out-2', 'usage_errors.jsonl')), true);
  assert.throws(() => writeTables(tables, path.join(f.claudeDir, 'new'), [f.claudeDir], denied), /refusing to write/);
});

const duckdb = process.env['DUCKDB_BIN'] ?? (spawnSync('duckdb', ['--version'], { windowsHide: true }).status === 0 ? 'duckdb' : undefined);

test('T1-OUTCOME-USAGE acceptance 8, 10 and 11: run.ts writes the list-price cost of each row and prints the five cost views of the fixture without the reviewer logs that are a Codex session, writes no usage table with --no-usage, and refuses an --out under a --claude-dir [R8] [R9]', { skip: duckdb === undefined ? 'no duckdb binary' : false }, () => {
  const dir = tempDir();
  const [stateDir, cardsDir, claudeDir, codexDir] = ['state', 'tasks', 'claude', 'codex'].map((name) => path.join(dir, name)) as [string, string, string, string];
  const mainRoot = resolveRepoIdentity(root).mainRoot;
  const worktreeRoot = resolveWorktreeRoot(loadProjectConfig(mainRoot).config, mainRoot);
  // The models prices.json prices, USD per million tokens: claude-opus-5-5 at 4 input, 0.2 cache read, 5 and 8 cache write, 20 output; gpt-5.6-sol at 4, 0.4, 5 and 20.
  const opus = (line: string): string => line.replace('"model-a"', '"claude-opus-5-5"');
  const sol = (lines: string[]): string[] => lines.map((line) => line.replace('"model-b"', '"gpt-5.6-sol"'));
  // A merged card and the card it supersedes; one formal review of the merged card at 03:00 on day 2.
  const card = (id: string, extra: string): string[] => ['---', `id: ${id}`, `title: ${id}`, 'status: todo', 'allow_paths:', '  - src/x.ts', 'dod_command: npm test', ...(extra ? [extra] : []), '---', '', `# ${id}`];
  put(path.join(cardsDir, 'T1-MERGED.md'), card('T1-MERGED', ''));
  put(path.join(cardsDir, 'T1-STOPPED.md'), card('T1-STOPPED', 'superseded_by: T1-MERGED'));
  const run = (goalId: string, cardId: string, extra: object): string => JSON.stringify({ goalId, cardId, cardRevision: 0, goalGeneration: 0, state: 'DONE', startedAt: '2026-01-02T00:00:00Z', deadline: '2026-02-01T00:00:00Z', updatedAt: '2026-01-04T00:00:00Z', ...extra });
  const formal = { invocationId: 'i1', candidateDigest: 'd1', base: 'main', policyVersion: '1', reviewer: 'codex', requestedAt: '2026-01-02T03:00:00Z', outcome: 'pass', decision: 1 };
  put(path.join(stateDir, 'cards', 'g-b', 'T1-MERGED.json'), [run('g-b', 'T1-MERGED', { mergeVerified: true, review: { substantiveDecisions: 1, invocations: [formal] } })]);
  put(path.join(stateDir, 'cards', 'g-c', 'T1-STOPPED.json'), [run('g-c', 'T1-STOPPED', { state: 'STOP' })]);
  const state = (ts: string, goalId: string, cardId: string, to: string): string => JSON.stringify({ seq: 0, ts, type: 'CARD_STATE', goalId, cardId, generation: 0, data: { to } });
  put(path.join(stateDir, 'journal', 'g.jsonl'), [state('2026-01-02T00:30:00Z', 'g-b', 'T1-MERGED', 'BUILD'), state('2026-01-02T02:30:00Z', 'g-b', 'T1-MERGED', 'DONE'), state('2026-01-03T00:00:00Z', 'g-c', 'T1-STOPPED', 'BUILD'), state('2026-01-03T01:00:00Z', 'g-c', 'T1-STOPPED', 'STOP')]);
  // Coordinator requests inside the BUILD span of each card (one of them with no tokens, as a synthetic reply has) and one outside every span; an implementer subagent of the superseded card.
  put(path.join(claudeDir, 's1.jsonl'), [opus(claudeLine('assistant', 'm1', [100, 10, 300, 100, 40])), opus(claudeLine('assistant', 'm2', [200, 5, 0, 0], '2026-01-03T00:30:00.000Z')), opus(claudeLine('assistant', 'm3', [20, 5, 60, 20], '2026-01-05T00:00:00.000Z')), claudeLine('assistant', 'm5', [0, 0, 0, 0]).replace('"model-a"', '"model-zero"')]);
  put(path.join(claudeDir, 's1', 'subagents', 'agent-a1.jsonl'), [opus(claudeLine('assistant', 'm4', [200, 40, 600, 0], '2026-01-03T00:20:00.000Z', { isSidechain: true }))]);
  put(path.join(claudeDir, 's1', 'subagents', 'agent-a1.meta.json'), [JSON.stringify({ agentType: 'implementer', description: `${X} T1-STOPPED ${X}` })]);
  // The Codex session of a review of each card (200 input after 800 cached and 50 output; 300 after 100 and 30) and the log of the same review, which counts 200 + 50 and 300 + 30 tokens; a third log matches no session.
  put(path.join(codexDir, 'rollout-cx1.jsonl'), sol(codexSession('cx1', path.join(worktreeRoot, 'T1-MERGED'), [tokenCount(1000, 800, 50, '2026-01-02T03:01:00.000Z')])));
  put(path.join(codexDir, 'rollout-cx2.jsonl'), sol(codexSession('cx2', path.join(worktreeRoot, 'T1-STOPPED'), [tokenCount(400, 100, 30, '2026-01-03T00:40:00.000Z')])));
  put(path.join(stateDir, 'evidence', 'g-c', 'review', 'T1-STOPPED', 'T1-STOPPED.r3.1.abc.log'), reviewLog(120000, ['tokens used', '330']));
  put(path.join(stateDir, 'evidence', 'g-b', 'review', 'T1-MERGED', 'T1-MERGED.r3.1.abc.log'), reviewLog(120000, ['tokens used', '250']));
  put(path.join(stateDir, 'evidence', 'g-b', 'review', 'T1-MERGED', 'T1-MERGED.r3.2.def.log'), reviewLog(120000, ['tokens used', '999']));

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.toUpperCase().startsWith('AIDLC_') && k.toUpperCase() !== 'NODE_OPTIONS'));
  const spawnRun = (out: string, ...more: string[]): { status: number | null; stderr: string; views: Map<string, Row[]> } => {
    const r = spawnSync(process.execPath, [path.join(root, 'bench', 'outcome', 'run.ts'), '--state', stateDir, '--cards', cardsDir, '--claude-dir', claudeDir, '--codex-dir', codexDir, '--out', out, '--duckdb', duckdb!, '--no-github', ...more], { cwd: root, env, encoding: 'utf8', windowsHide: true });
    return { status: r.status, stderr: r.stderr, views: new Map(r.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as { view: string; rows: Row[] }).map((v) => [v.view, v.rows])) };
  };
  const out = path.join(dir, 'out');
  const r = spawnRun(out);
  assert.equal(r.status, 0, r.stderr);
  /** `rows` with the given cost columns rounded to 9 decimals, since a price such as 0.2 is not a binary fraction. */
  const usd = (rows: Row[] | undefined, ...keys: string[]): Row[] | undefined => rows?.map((row) => ({ ...row, ...Object.fromEntries(keys.map((key) => [key, typeof row[key] === 'number' ? Number(row[key].toFixed(9)) : row[key]])) }));
  // The cost run.ts wrote, read before anything else touches the output. m1: (100 x 4 + 300 x 0.2 + 60 x 5 + 40 x 8 + 10 x 20) / 1e6; m2: (200 x 4 + 5 x 20) / 1e6;
  // m3: (20 x 4 + 60 x 0.2 + 20 x 5 + 5 x 20) / 1e6; m4: (200 x 4 + 600 x 0.2 + 40 x 20) / 1e6; cx1: (200 x 4 + 800 x 0.4 + 12 x 5 + 50 x 20) / 1e6; cx2: (300 x 4 + 100 x 0.4 + 12 x 5 + 30 x 20) / 1e6.
  const usage = readFileSync(path.join(out, 'usage.jsonl'), 'utf8');
  const written = usd(usage.trim().split('\n').map((line) => JSON.parse(line) as Row), 'costUsd')!;
  assert.deepEqual(Object.fromEntries(written.map((row) => [`${String(row['source'])} ${String(row['stage'])} ${String(row['inputTokens'])}`, row['costUsd']])), {
    'claude-code coordinate 100': 0.00128, 'claude-code coordinate 200': 0.0009, 'claude-code unattributed 20': 0.000292, 'claude-code implement 200': 0.00172, 'claude-code coordinate 0': null,
    'codex review 200': 0.00218, 'codex review 300': 0.0019, 'review-log review null': null,
  });
  const stage = (cards: string, name: string, requests: number, [inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens]: Tokens, totalTokens: number | null, cost_usd: number, unpriced_requests: number): Row => ({ cards, stage: name, requests, inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, totalTokens, cost_usd, unpriced_requests });
  assert.deepEqual(usd(r.views.get('summary_cost_by_stage'), 'cost_usd'), [stage('merged', 'coordinate', 2, [100, 10, 300, 100], null, 0.00128, 1), stage('merged', 'review', 2, [200, 50, 800, 12], 999, 0.00218, 1), stage('superseded', 'coordinate', 1, [200, 5, 0, 0], null, 0.0009, 0), stage('superseded', 'implement', 1, [200, 40, 600, 0], null, 0.00172, 0), stage('superseded', 'review', 1, [300, 30, 100, 12], null, 0.0019, 0)]);
  // The superseded card: 205 tokens of its coordinator request, 840 of its subagent and 442 of its Codex session, without the 330 of the log of that session; 0.0009 + 0.00172 + 0.0019.
  assert.deepEqual(usd(r.views.get('summary_superseded_spend'), 'cost_usd'), [{ cards: 1, requests: 3, tokens: 1487, cost_usd: 0.00452, unpriced_requests: 0 }]);
  // Claude Code: 300 + 0 + 60 + 600 cache-read tokens of 500 + 200 + 100 + 800 input-side tokens. Codex: 800 + 100 of (200 + 800 + 12) + (300 + 100 + 12).
  assert.deepEqual(r.views.get('summary_cache_share'), [{ source: 'claude-code', model: 'claude-opus-5-5', requests: 4, cache_read_share: 0.6 }, { source: 'claude-code', model: 'model-zero', requests: 1, cache_read_share: null }, { source: 'codex', model: 'gpt-5.6-sol', requests: 2, cache_read_share: 900 / 1424 }]);
  // Both cards are one family: 0.00128 + 0.00218 (merged) + 0.0009 + 0.00172 + 0.0019 (superseded).
  assert.deepEqual(usd(r.views.get('summary_cost_per_card'), 'p50_usd', 'p90_usd', 'max_usd'), [{ families: 1, priced_families: 1, p50_usd: 0.00798, p90_usd: 0.00798, max_usd: 0.00798 }]);
  // Ten rows of 510, 205, 105, 840, 0, 1062, 442, 250, 330 and 999 tokens; the request outside every span is the unattributed one, and the logs of 250 and 330 are Codex sessions.
  assert.deepEqual(r.views.get('summary_unattributed'), [
    { measure: 'review_log_same_as_codex', key: null, requests: 2, tokens: 580, request_share: null, token_share: null },
    { measure: 'unattributed', key: null, requests: 1, tokens: 105, request_share: 1 / 10, token_share: 105 / 4743 },
    { measure: 'unpriced', key: 'model-b', requests: 3, tokens: 1579, request_share: null, token_share: null },
    { measure: 'unpriced', key: 'model-zero', requests: 1, tokens: 0, request_share: null, token_share: null },
  ]);
  assert.equal(usage.includes(X) || readFileSync(path.join(out, 'usage_errors.jsonl'), 'utf8') !== '', false, 'no fixture text and no error row is written');

  const noUsage = spawnRun(path.join(dir, 'out-no-usage'), '--no-usage');
  assert.equal(noUsage.status, 0, noUsage.stderr);
  assert.deepEqual([...noUsage.views.keys()], ['summary_lead_time', 'summary_review_convergence', 'summary_stop_reasons', 'summary_successor_rate']);
  assert.deepEqual(['cards.jsonl', 'usage.jsonl', 'usage_errors.jsonl'].map((name) => existsSync(path.join(dir, 'out-no-usage', name))), [true, false, false]);
  const refused = spawnRun(path.join(claudeDir, 'out'));
  assert.equal(refused.status, 1, refused.stderr);
  assert.match(refused.stderr, /refusing to write/);
  assert.equal(existsSync(path.join(claudeDir, 'out')), false);
});
