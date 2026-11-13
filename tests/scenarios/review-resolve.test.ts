/**
 * Card T0-REVIEW-RESOLVE-LOST (audit item F9): `aidlc review resolve` settles a review request the queue marked `lost`
 * with the outcome of its lookup, frees the slot of the request's stored key, and journals one NOTE per requester goal
 * inside the queue's section before the queue is written.
 */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, rmdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanup } from '../infra/helpers.ts';
import { actorA, driveCardToDone, goalForCards, makeFixture, writeCard, T0, type Fixture } from './_harness.ts';
import type { EnqueueInput } from '../../src/coordination/review-queue.ts';
import { makeStop } from '../../src/core/stop.ts';
import { Journal } from '../../src/state/journal.ts';
import { shortKey } from '../../src/state/paths.ts';
import { atomicWriteJson } from '../../src/state/store.ts';
import type { Goal, JournalEvent, ReviewRequest } from '../../src/core/types.ts';

/** The CLI from the sources (what `npm run dev` runs), never a compiled build that may be stale. */
const MAIN = fileURLToPath(new URL('../../src/cli/main.ts', import.meta.url));
const POOL = 'default';
const FAR = '2126-01-01T00:00:00.000Z';
const HELD = 'T1-HELD';
const TWO = 'T1-TWO';
const PASS = `{"verdict":"pass","reasons":[],"sha":"${'a'.repeat(40)}"}`;
const LOOKED = ['--reason', 'looked-up'];
const LOST_DETAIL = 'ship timed out; look up the review before releasing the slot';

const M1 = 'review resolve: --verdict and --no-result exclude each other; give one';
const M2 = "review resolve: give --verdict <file> (the lookup found the review's result) or --no-result (it found none)";
const M3 = 'review resolve: --reason must not be blank';
const M4 = (file: string, code: string): string => `review resolve: --verdict ${JSON.stringify(file)}: cannot read the file (${code})`;
const M5 = (file: string): string => `review resolve: --verdict ${JSON.stringify(file)} is not JSON`;
const M6 = (file: string): string => `review resolve: --verdict ${JSON.stringify(file)} is not a review verdict that the verdict-file parser accepts`;
const NO_REASON = "error: required option '--reason <text>' not specified";
const EMPTY_PATH = 'the value is empty; pass a path relative to the -C directory or a fully qualified path';

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');

/** `cwd` is the child's working directory in the form the operating system reports it. */
interface Rig { fx: Fixture; one: Goal; two: Goal; cwd: string }

/** A fixture with the cards T1-HELD and T1-TWO, a goal for each and `verdict.json` holding a pass; removed after the test. */
function rig(t: TestContext): Rig {
  const fx = makeFixture();
  t.after(() => cleanup(fx.tmp));
  writeCard(fx, { id: HELD, title: 'held slot' });
  writeCard(fx, { id: TWO, title: 'second requester' });
  const one = goalForCards(fx, [HELD]);
  const two = goalForCards(fx, [TWO]);
  writeFileSync(path.join(fx.tmp, 'verdict.json'), PASS);
  return { fx, one, two, cwd: realpathSync.native(fx.tmp) };
}

const enqueueInput = (digest: string, requester: string, deadline = FAR): EnqueueInput => ({ pool: POOL, repository: 'o/r', candidateDigest: digest, base: 'main', policyVersion: 'p', reviewer: 'r', requester, deadline });

/** A request admitted and marked lost, as the card runner leaves it after a ship that timed out. */
function lostRequest(fx: Fixture, requesters: string[], options: { digest?: string; deadline?: string } = {}): ReviewRequest {
  const digest = options.digest ?? 'lost';
  const first = fx.queue.enqueue(enqueueInput(digest, requesters[0]!, options.deadline));
  for (const requester of requesters.slice(1)) fx.queue.enqueue(enqueueInput(digest, requester, options.deadline));
  assert.equal(fx.queue.admit(POOL, actorA, fx.now(), first.request.key).status, 'admitted');
  fx.queue.markLost(first.request.key, LOST_DETAIL);
  return fx.queue.get(first.request.key)!;
}

const oneRequester = (r: Rig): string[] => [`${r.one.id}:${HELD}`];
const bothRequesters = (r: Rig): string[] => [`${r.one.id}:${HELD}`, `${r.two.id}:${TWO}`];
/** A request of another candidate, queued behind the lost one. */
const nextRequest = (fx: Fixture, digest = 'next'): ReviewRequest => fx.queue.enqueue(enqueueInput(digest, 'g-next:T1-NEXT')).request;

const requestPath = (r: Rig, key: string): string => path.join(r.fx.paths.reviewQueue, `${shortKey(key)}.json`);
const poolPath = (r: Rig): string => path.join(r.fx.paths.reviewQueue, `_pool-${shortKey(POOL)}.json`);
const active = (fx: Fixture): string[] => fx.queue.pool(POOL).active;
const journalPath = (r: Rig, goal: Goal): string => path.join(r.fx.paths.journal, `${goal.id}.jsonl`);

/** The events of type NOTE and kind `review-lost-resolved` of a goal, and each as the row the card names. */
const resolvedNotes = (fx: Fixture, goalId: string): JournalEvent[] => fx.events(goalId).filter((e) => e.type === 'NOTE' && e.data['kind'] === 'review-lost-resolved');
const noteRows = (fx: Fixture, goalId: string): unknown[][] => resolvedNotes(fx, goalId).map((e) => [e.goalId, e.cardId, e.generation, e.data['key'], e.data['pool'], e.data['seq'], e.data['attempts'], e.data['outcome'], e.data['reason'], e.data['verdictSha256']]);

/** Every file under the state root by relative path with its bytes, lock files excluded; a directory stands for itself. */
function snapshot(fx: Fixture): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of (readdirSync(fx.paths.root, { recursive: true }) as string[]).sort()) {
    if (name.endsWith('.lock')) continue;
    const full = path.join(fx.paths.root, name);
    out[name.split(path.sep).join('/')] = statSync(full).isDirectory() ? '<dir>' : readFileSync(full).toString('base64');
  }
  return out;
}
const changedPaths = (before: Record<string, string>, after: Record<string, string>): string[] => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name] !== after[name]).sort();
const relative = (r: Rig, file: string): string => path.relative(r.fx.paths.root, file).split(path.sep).join('/');

interface Result { status: number | null; stdout: string; stderr: string }
/** `preload` runs the child with the fault module; `session: false` leaves both session variables out of its environment. */
interface RunOptions { preload?: boolean; env?: NodeJS.ProcessEnv; session?: boolean }

/** One module for every fault the rows need, each switched on by its own variable; it replaces `fs` functions and calls `syncBuiltinESMExports()`. */
const PRELOAD = [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  "import { syncBuiltinESMExports } from 'node:module';",
  'const { readFileSync, renameSync, appendFileSync, writeFileSync } = fs;',
  'const env = process.env;',
  'let reads = 0;',
  'let renamed = false;',
  'const same = (a, b) => path.resolve(String(a)) === path.resolve(b);',
  'fs.readFileSync = (file, ...rest) => {',
  "  if (typeof file !== 'number') {",
  '    if (env.COUNT_READS_OF && same(file, env.COUNT_READS_OF)) reads += 1;',
  '    if (env.COUNT_READS_BASE && path.basename(String(file)) === env.COUNT_READS_BASE) reads += 1;',
  "    if (env.FAIL_READ_OF && same(file, env.FAIL_READ_OF)) throw Object.assign(new Error('injected read failure'), env.FAIL_READ_CODE ? { code: env.FAIL_READ_CODE } : {});",
  '  }',
  '  return readFileSync(file, ...rest);',
  '};',
  "fs.renameSync = (from, to) => { if (env.FAIL_RENAME_TO && !renamed && path.basename(String(to)) === env.FAIL_RENAME_TO) { renamed = true; throw new Error('injected write failure'); } return renameSync(from, to); };",
  "fs.appendFileSync = (file, ...rest) => { if (env.FAIL_APPEND_TO && path.basename(String(file)) === env.FAIL_APPEND_TO) throw new Error('injected append failure'); return appendFileSync(file, ...rest); };",
  "if (env.READS_FILE) process.on('exit', () => writeFileSync(env.READS_FILE, String(reads)));",
  'syncBuiltinESMExports();',
  '',
].join('\n');

const FAULT_SWITCHES = new Set(['READS_FILE', 'COUNT_READS_OF', 'COUNT_READS_BASE', 'FAIL_READ_OF', 'FAIL_READ_CODE', 'FAIL_RENAME_TO', 'FAIL_APPEND_TO']);

/**
 * The child's environment: no inherited variable whose upper-cased name starts with NODE_, GIT_ or AIDLC_, none of the fault
 * switches of the preload and no CLAUDE_CODE_SESSION_ID, git discovery capped at the parents of the fixture, the fixture's state directory and a fixed session.
 */
function childEnv(r: Rig, extra: NodeJS.ProcessEnv = {}, session = true): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) {
    const upper = name.toUpperCase();
    if (FAULT_SWITCHES.has(upper) || upper.startsWith('NODE_') || upper.startsWith('GIT_') || upper.startsWith('AIDLC_') || upper === 'CLAUDE_CODE_SESSION_ID') continue;
    env[name] = value;
  }
  return { ...env, GIT_CEILING_DIRECTORIES: [path.dirname(r.fx.tmp), path.dirname(r.cwd)].join(path.delimiter), AIDLC_STATE_DIR: r.fx.paths.root, ...(session ? { AIDLC_SESSION: 'resolve-test' } : {}), ...extra };
}

function preloadArgs(r: Rig): string[] {
  const file = path.join(r.fx.tmp, 'faults.mjs');
  if (!existsSync(file)) writeFileSync(file, PRELOAD);
  return ['--import', pathToFileURL(file).href];
}

function cli(r: Rig, args: string[], options: RunOptions = {}): Result {
  const res = spawnSync(process.execPath, [...(options.preload ? preloadArgs(r) : []), MAIN, ...args], { cwd: r.cwd, env: childEnv(r, options.env, options.session), encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const resolve = (r: Rig, key: string, flags: string[], options: RunOptions = {}): Result => cli(r, ['review', 'resolve', key, ...flags], options);

function cliAsync(r: Rig, args: string[]): Promise<Result> {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [MAIN, ...args], { cwd: r.cwd, env: childEnv(r), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 60_000 });
    const chunks = { out: '', err: '' };
    child.stdout.on('data', (chunk: Buffer) => (chunks.out += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (chunks.err += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (status) => done({ status, stdout: chunks.out, stderr: chunks.err }));
  });
}

const reads = (r: Rig): number => Number(readFileSync(path.join(r.fx.tmp, 'reads.txt'), 'utf8'));
const countingEnv = (r: Rig, extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({ READS_FILE: path.join(r.fx.tmp, 'reads.txt'), ...extra });

const upper = (key: string): string => key.toUpperCase();
const slashed = (key: string): string => key.replace('/', '\\');

test('review resolve --verdict completes a lost request and frees its slot', async (t) => {
  await t.test('two requesters, the next request admitted, one NOTE per goal', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, bothRequesters(r));
    const next = nextRequest(r.fx);
    assert.deepEqual(r.fx.queue.admit(POOL, actorA, r.fx.now(), next.key), { status: 'busy', active: [lost.key] }, 'control: the lost key holds the slot');
    const res = resolve(r, lost.key, ['--verdict', 'verdict.json', '--reason', '  looked up  ']);
    assert.equal(res.status, 0, res.stderr);
    const stored = r.fx.queue.get(lost.key)!;
    assert.deepEqual(JSON.parse(res.stdout), JSON.parse(JSON.stringify(stored)));
    assert.equal(stored.state, 'completed');
    assert.equal(stored.verdictRef, path.join(r.cwd, 'verdict.json'));
    assert.ok(stored.finishedAt);
    assert.deepEqual(active(r.fx), []);
    assert.equal(r.fx.queue.admit(POOL, actorA, r.fx.now(), next.key).status, 'admitted');
    assert.deepEqual(noteRows(r.fx, r.one.id), [[r.one.id, HELD, 0, lost.key, POOL, lost.seq, 1, 'found', '  looked up  ', sha256(PASS)]]);
    assert.deepEqual(noteRows(r.fx, r.two.id), [[r.two.id, TWO, 0, lost.key, POOL, lost.seq, 1, 'found', '  looked up  ', sha256(PASS)]]);
    for (const goal of [r.one, r.two]) assert.deepEqual(Journal.forGoal(r.fx.paths.journal, goal.id).verify().problems, []);
  });

  await t.test('--no-json prints the one line', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const res = cli(r, ['--no-json', 'review', 'resolve', lost.key, '--verdict', 'verdict.json', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, `resolved ${lost.key}: completed\n`);
  });

  for (const [name, alias] of [['upper-case', upper], ['slash', slashed]] as const) {
    await t.test(`the ${name} alias of the key settles the stored request`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, oneRequester(r));
      const res = resolve(r, alias(lost.key), ['--verdict', 'verdict.json', ...LOOKED]);
      assert.equal(res.status, 0, res.stderr);
      assert.deepEqual(active(r.fx), []);
      assert.equal(JSON.parse(res.stdout).key, lost.key);
      assert.equal(r.fx.queue.get(lost.key)?.state, 'completed');
      assert.deepEqual(resolvedNotes(r.fx, r.one.id).map((e) => e.data['key']), [lost.key]);
    });
    await t.test(`the ${name} alias prints the stored key with --no-json`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, oneRequester(r));
      const res = cli(r, ['--no-json', 'review', 'resolve', alias(lost.key), '--verdict', 'verdict.json', ...LOOKED]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, `resolved ${lost.key}: completed\n`);
    });
  }
});

test('review resolve --no-result requeues a lost request in its place and frees its slot', async (t) => {
  await t.test('the request is queued at its own seq and the slot is free', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const next = nextRequest(r.fx);
    assert.equal(lost.seq, 0);
    assert.equal(next.seq, 1);
    const res = resolve(r, lost.key, ['--no-result', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    const stored = r.fx.queue.get(lost.key)!;
    assert.deepEqual(JSON.parse(res.stdout), JSON.parse(JSON.stringify(stored)));
    assert.equal(stored.state, 'queued');
    assert.equal(stored.seq, 0);
    assert.equal(stored.startedAt, undefined);
    assert.equal(stored.slotOwner, undefined);
    assert.equal(stored.lastError, 'lost response; looked up, no result; requeued in order');
    assert.deepEqual(active(r.fx), []);
    assert.deepEqual(noteRows(r.fx, r.one.id), [[r.one.id, HELD, 0, lost.key, POOL, 0, 1, 'not-found', 'looked-up', undefined]]);
  });

  await t.test('--no-json prints the one line', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const res = cli(r, ['--no-json', 'review', 'resolve', lost.key, '--no-result', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, `resolved ${lost.key}: queued\n`);
  });

  for (const [name, alias] of [['upper-case', upper], ['slash', slashed]] as const) {
    await t.test(`the ${name} alias of the key frees the stored key`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, oneRequester(r));
      const res = cli(r, ['--no-json', 'review', 'resolve', alias(lost.key), '--no-result', ...LOOKED]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, `resolved ${lost.key}: queued\n`);
      assert.deepEqual(active(r.fx), []);
      assert.deepEqual(resolvedNotes(r.fx, r.one.id).map((e) => e.data['key']), [lost.key]);
    });
    await t.test(`the ${name} alias gives the stored key in the JSON output`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, oneRequester(r));
      const res = resolve(r, alias(lost.key), ['--no-result', ...LOOKED]);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(JSON.parse(res.stdout).key, lost.key);
    });
  }

  await t.test('queue order: behind, a different base is new, the normalized parts join', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const next = nextRequest(r.fx);
    assert.equal(resolve(r, lost.key, ['--no-result', ...LOOKED]).status, 0);
    const behind = r.fx.queue.admit(POOL, actorA, r.fx.now(), next.key);
    assert.equal(behind.status === 'behind' && behind.ahead.key, lost.key);
    const other = r.fx.queue.enqueue({ ...enqueueInput('lost', `${r.two.id}:${TWO}`), base: 'next' });
    assert.equal(other.status, 'enqueued');
    assert.notEqual(other.request.key, lost.key);
    const joined = r.fx.queue.enqueue({ pool: POOL, repository: ' O\\R ', candidateDigest: 'LOST', base: 'MAIN ', policyVersion: ' P', reviewer: 'R', requester: `${r.two.id}:${TWO}`, deadline: FAR });
    assert.equal(joined.status, 'joined');
    assert.equal(joined.request.key, lost.key);
    const admitted = r.fx.queue.admit(POOL, actorA, r.fx.now(), lost.key);
    assert.equal(admitted.status, 'admitted');
  });

  await t.test('an admission at the request deadline cancels it as any queued request', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r), { deadline: '2026-09-11T01:00:00.000Z' });
    const next = nextRequest(r.fx);
    assert.equal(r.fx.now(), T0);
    assert.equal(resolve(r, lost.key, ['--no-result', ...LOOKED]).status, 0);
    const at = '2026-09-11T01:00:00.000Z';
    const admitted = r.fx.queue.admit(POOL, actorA, at, next.key);
    assert.equal(admitted.status, 'admitted');
    const cancelled = r.fx.queue.get(lost.key)!;
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(cancelled.finishedAt, at);
    assert.equal(cancelled.lastError, 'deadline passed before admission');
  });
});

/** A row of the refusal table: the arguments, the whole stderr the child writes and what its run needs. */
interface Row { name: string; args: string[]; stderr: string; preload?: boolean; env?: NodeJS.ProcessEnv }
const aidlc = (message: string): string => `aidlc: ${message}\n`;

/** One refusal: exit 1, the whole message on stderr, nothing written or journaled. */
function assertRefused(r: Rig, row: Row): void {
  const before = snapshot(r.fx);
  const res = cli(r, row.args, { preload: row.preload, env: row.env });
  assert.equal(res.status, 1, `${row.name}: ${res.stderr}`);
  assert.equal(res.stderr, row.stderr, row.name);
  assert.deepEqual(snapshot(r.fx), before, `${row.name}: the state changed`);
}

/** The rows that refuse before `ctx()` is built, on a lost request `key` (R1, R8). */
function optionRows(r: Rig, key: string, queuedKey: string): Row[] {
  const resolveArgs = (...flags: string[]): string[] => ['review', 'resolve', key, ...flags];
  const rows: Row[] = [
    { name: 'both options', args: resolveArgs('--verdict', 'verdict.json', '--no-result', ...LOOKED), stderr: aidlc(M1) },
    { name: 'neither option', args: resolveArgs(...LOOKED), stderr: aidlc(M2) },
    { name: 'no reason', args: resolveArgs('--no-result'), stderr: `${NO_REASON}\n` },
    ...['', ' \t ', '\u00a0', '\u3000', '\ufeff'].map((reason) => ({ name: `blank reason ${JSON.stringify(reason)}`, args: resolveArgs('--no-result', '--reason', reason), stderr: aidlc(M3) })),
    { name: '-C naming nothing', args: ['-C', 'nothing', ...resolveArgs('--verdict', '', '--no-result', ...LOOKED)], stderr: aidlc(`--cwd "nothing": no directory at ${path.join(r.cwd, 'nothing')} (ENOENT); pass an existing directory`) },
    ...['', ' ', '\u00a0', '\u3000'].map((value) => ({ name: `empty path ${JSON.stringify(value)}`, args: resolveArgs('--verdict', value, ...LOOKED), stderr: aidlc(`--verdict ${JSON.stringify(value)}: ${EMPTY_PATH}`) })),
    { name: 'missing file', args: resolveArgs('--verdict', 'missing.json', ...LOOKED), stderr: aidlc(M4('missing.json', 'ENOENT')) },
    { name: 'a directory', args: resolveArgs('--verdict', path.join(r.cwd, 'a-directory'), ...LOOKED), stderr: aidlc(M4(path.join(r.cwd, 'a-directory'), 'EISDIR')) },
    { name: 'read error with a code', args: resolveArgs('--verdict', 'verdict.json', ...LOOKED), stderr: aidlc(M4('verdict.json', 'EINJECTED')), preload: true, env: { FAIL_READ_OF: path.join(r.cwd, 'verdict.json'), FAIL_READ_CODE: 'EINJECTED' } },
    { name: 'read error without a code', args: resolveArgs('--verdict', 'verdict.json', ...LOOKED), stderr: aidlc(M4('verdict.json', 'UNREADABLE')), preload: true, env: { FAIL_READ_OF: path.join(r.cwd, 'verdict.json') } },
  ];
  const documents: Array<[string, string, (file: string) => string]> = [
    ['nothing', '', M5],
    ['an open brace', '{', M5],
    ['an empty array', '[]', M6],
    ['null', 'null', M6],
    ['a string', '"pass"', M6],
    ['an empty object', '{}', M6],
    ['an upper-case verdict', '{"verdict":"PASS"}', M6],
    ['a numeric verdict', '{"verdict":1}', M6],
    ['an array verdict', '{"verdict":["pass"]}', M6],
    ['a routed_skip the parser cannot read', '{"verdict":"pass","routed_skip":{"predicate":{"toString":null}}}', M6],
  ];
  documents.forEach(([name, text, message], index) => {
    const file = `bad-${index}.json`;
    writeFileSync(path.join(r.cwd, file), text);
    rows.push({ name: `file holding ${name}`, args: resolveArgs('--verdict', file, ...LOOKED), stderr: aidlc(message(file)) });
  });
  rows.push(
    { name: 'precedence: both options with an empty path', args: resolveArgs('--verdict', '', '--no-result', ...LOOKED), stderr: aidlc(M1) },
    { name: 'precedence: neither option with a blank reason', args: resolveArgs('--reason', ''), stderr: aidlc(M2) },
    { name: 'precedence: a blank reason before a missing file', args: resolveArgs('--verdict', 'missing.json', '--reason', ' '), stderr: aidlc(M3) },
    { name: 'precedence: a blank reason before an empty path', args: resolveArgs('--verdict', '', '--reason', ' '), stderr: aidlc(M3) },
    { name: 'precedence: no reason before -C', args: ['-C', 'nothing', ...resolveArgs('--no-result')], stderr: `${NO_REASON}\n` },
    { name: 'precedence: a missing file on an unknown key', args: ['review', 'resolve', 'o/r|none|main|p|r', '--verdict', 'missing.json', ...LOOKED], stderr: aidlc(M4('missing.json', 'ENOENT')) },
    { name: 'precedence: a file that is not JSON on a queued request', args: ['review', 'resolve', queuedKey, '--verdict', 'bad-1.json', ...LOOKED], stderr: aidlc(M5('bad-1.json')) },
  );
  return rows;
}

test('every refusal of review resolve writes nothing and journals nothing', async (t) => {
  await t.test('an unknown key and a request that is not lost', (t) => {
    const r = rig(t);
    const queued = r.fx.queue.enqueue(enqueueInput('queued', `${r.one.id}:${HELD}`)).request;
    assertRefused(r, { name: 'unknown key', args: ['review', 'resolve', 'o/r|none|main|p|r', '--no-result', ...LOOKED], stderr: aidlc('unknown review request o/r|none|main|p|r') });
    assertRefused(r, { name: 'queued, upper-case alias', args: ['review', 'resolve', upper(queued.key), '--no-result', ...LOOKED], stderr: aidlc(`request ${upper(queued.key)} is not lost`) });
  });

  const states: Array<[string, (r: Rig, key: string) => void]> = [
    ['queued', () => undefined],
    ['running', (r, key) => void r.fx.queue.admit(POOL, actorA, r.fx.now(), key)],
    ['retry-after', (r, key) => void (r.fx.queue.admit(POOL, actorA, r.fx.now(), key), r.fx.queue.hold(key, FAR, 'quota', r.fx.now()))],
    ['completed', (r, key) => void (r.fx.queue.admit(POOL, actorA, r.fx.now(), key), r.fx.queue.complete(key, 'verdict.json', r.fx.now()))],
    ['cancelled', (r, key) => void r.fx.queue.cancel(key, 'cancelled by the test', r.fx.now())],
  ];
  for (const [state, setup] of states) {
    await t.test(`a ${state} request`, (t) => {
      const r = rig(t);
      const key = r.fx.queue.enqueue(enqueueInput(state, `${r.one.id}:${HELD}`)).request.key;
      setup(r, key);
      assert.equal(r.fx.queue.get(key)?.state, state);
      assertRefused(r, { name: state, args: ['review', 'resolve', key, '--no-result', ...LOOKED], stderr: aidlc(`request ${key} is not lost`) });
    });
  }

  await t.test('a request or goal record that cannot be read', async (t) => {
    const breakers: Array<[string, string, (file: string) => void]> = [
      ['MALFORMED_JSON', 'a file holding {', (file) => writeFileSync(file, '{')],
      ['SCHEMA_VIOLATION', 'a file holding {}', (file) => writeFileSync(file, '{}')],
      ['READ_FAILED', 'a directory', (file) => mkdirSync(file)],
    ];
    for (const [code, what, replace] of breakers) {
      for (const record of ['request', 'goal']) {
        await t.test(`${record} replaced by ${what}`, (t) => {
          const r = rig(t);
          const lost = lostRequest(r.fx, bothRequesters(r));
          const file = record === 'request' ? requestPath(r, lost.key) : r.fx.store.goalFile(r.one.id);
          rmSync(file);
          replace(file);
          const before = snapshot(r.fx);
          const res = resolve(r, lost.key, ['--no-result', ...LOOKED]);
          assert.equal(res.status, 1, res.stderr);
          assert.ok(res.stderr.startsWith(`aidlc: ${code}: `), res.stderr);
          assert.ok(res.stderr.endsWith(` (${file})\n`), res.stderr);
          assert.deepEqual(snapshot(r.fx), before);
          if (record === 'goal') {
            assert.equal(r.fx.queue.get(lost.key)?.state, 'lost');
            assert.deepEqual(active(r.fx), [lost.key]);
            for (const goal of [r.one, r.two]) assert.deepEqual(resolvedNotes(r.fx, goal.id), []);
          }
        });
      }
    }
  });

  await t.test('every option, path and file row, then again under a configuration ctx() refuses', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const queued = r.fx.queue.enqueue(enqueueInput('queued', `${r.one.id}:${HELD}`)).request;
    mkdirSync(path.join(r.cwd, 'a-directory'));
    const rows = optionRows(r, lost.key, queued.key);
    for (const row of rows) assertRefused(r, row);
    writeFileSync(path.join(r.cwd, 'aidlc.config.json'), '{ not json');
    const control = resolve(r, lost.key, ['--no-result', ...LOOKED]);
    assert.equal(control.status, 1);
    assert.ok(control.stderr.startsWith('aidlc: ') && !control.stderr.includes('--verdict'), control.stderr);
    assert.ok(!control.stderr.includes('review resolve:'), `the configuration error is none of M1 to M6: ${control.stderr}`);
    for (const row of rows) assertRefused(r, { ...row, name: `${row.name}, bad configuration` });
  });
});

test('every document the verdict-file parser accepts is a found result, read once and digested as bytes', async (t) => {
  await t.test('every accepted shape completes the request', (t) => {
    const r = rig(t);
    const sha = 'b'.repeat(40);
    const documents: Array<[string, string]> = [
      ['block with reasons', '{"verdict":"block","reasons":["x"]}'],
      ...['success', 'timeout', 'no_output', 'malformed', 'tool_error', 'weird'].map((status): [string, string] => [`run_status ${status}`, `{"verdict":"pass","run_status":"${status}"}`]),
      ['run_status 7', '{"verdict":"pass","run_status":7}'],
      ['no sha and no branch', '{"verdict":"pass","reasons":[]}'],
      ['sha 7', '{"verdict":"pass","sha":7}'],
      ['branch other', `{"verdict":"pass","sha":"${sha}","branch":"other"}`],
      ['branch 7', '{"verdict":"pass","branch":7}'],
      ['branch null', '{"verdict":"pass","branch":null}'],
      ['reasons a string', '{"verdict":"pass","reasons":"x"}'],
    ];
    documents.forEach(([name, text], index) => {
      const lost = lostRequest(r.fx, oneRequester(r), { digest: `doc-${index}` });
      writeFileSync(path.join(r.cwd, 'doc.json'), text);
      const res = resolve(r, lost.key, ['--verdict', 'doc.json', ...LOOKED]);
      assert.equal(res.status, 0, `${name}: ${res.stderr}`);
      assert.equal(r.fx.queue.get(lost.key)?.state, 'completed', name);
      assert.equal(r.fx.queue.get(lost.key)?.verdictRef, path.join(r.cwd, 'doc.json'), name);
    });
  });

  await t.test('the file is read once and its bytes are digested', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const bytes = Buffer.concat([Buffer.from('{"verdict":"pass","reasons":["'), Buffer.from([0xff]), Buffer.from('"]}')]);
    writeFileSync(path.join(r.cwd, 'bytes.json'), bytes);
    const res = resolve(r, lost.key, ['--verdict', 'bytes.json', ...LOOKED], { preload: true, env: countingEnv(r, { COUNT_READS_OF: path.join(r.cwd, 'bytes.json') }) });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(reads(r), 1);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'completed');
    const digest = resolvedNotes(r.fx, r.one.id)[0]?.data['verdictSha256'];
    assert.equal(digest, sha256(bytes));
    assert.notEqual(digest, sha256(Buffer.from(bytes.toString('utf8'))));
  });
});

test('resolveLost runs before after the lost check, then frees the slot of the stored key, then writes the request', async (t) => {
  const outcomes: Array<[string, { found: true; verdictRef: string } | { found: false }]> = [['found', { found: true, verdictRef: 'verdict.json' }], ['not found', { found: false }]];
  /** A `before` that records what it sees: the request it receives and the pool and stored request at that moment. */
  const recorder = (fx: Fixture, key: string) => {
    const calls: Array<{ request: ReviewRequest; active: string[]; stored: ReviewRequest | undefined }> = [];
    return { calls, before: (request: ReviewRequest): void => void calls.push({ request, active: [...active(fx)], stored: fx.queue.get(key) }) };
  };
  const queueFiles = (fx: Fixture): Record<string, string> => Object.fromEntries(readdirSync(fx.paths.reviewQueue).sort().map((name) => [name, readFileSync(path.join(fx.paths.reviewQueue, name), 'utf8')]));

  await t.test('an unknown key and a queued request throw with no call', (t) => {
    const r = rig(t);
    const queued = r.fx.queue.enqueue(enqueueInput('queued', 'g-x:T1-X')).request;
    for (const key of ['nope', queued.key]) {
      const { calls, before } = recorder(r.fx, key);
      const files = queueFiles(r.fx);
      assert.throws(() => r.fx.queue.resolveLost(key, { found: false }, T0, before), key === 'nope' ? /unknown review request nope/ : new RegExp('is not lost'));
      assert.equal(calls.length, 0);
      assert.deepEqual(queueFiles(r.fx), files);
    }
  });

  for (const [name, outcome] of outcomes) {
    await t.test(`${name}: one call with the request as stored and the slot still held`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, ['g-x:T1-X']);
      const { calls, before } = recorder(r.fx, lost.key);
      r.fx.queue.resolveLost(lost.key, outcome, T0, before);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0]!.request, lost);
      assert.deepEqual(calls[0]!.active, [lost.key]);
      assert.deepEqual(calls[0]!.stored, lost);
      assert.deepEqual(active(r.fx), []);
    });
    await t.test(`${name}: a before that throws writes nothing and its error is rethrown`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, ['g-x:T1-X']);
      const files = queueFiles(r.fx);
      const failure = new Error('journal failed');
      assert.throws(() => r.fx.queue.resolveLost(lost.key, outcome, T0, () => {
        throw failure;
      }), (err) => err === failure);
      assert.deepEqual(queueFiles(r.fx), files);
      assert.equal(r.fx.queue.get(lost.key)?.state, 'lost');
      assert.deepEqual(active(r.fx), [lost.key]);
    });
  }

  await t.test('a call with three arguments and the stored key leaves the records of main', (t) => {
    const r = rig(t);
    const found = lostRequest(r.fx, ['g-x:T1-X']);
    r.fx.queue.resolveLost(found.key, { found: true, verdictRef: 'verdict.json' }, T0);
    assert.deepEqual(r.fx.queue.get(found.key), { ...found, state: 'completed', finishedAt: T0, verdictRef: 'verdict.json' });
    assert.deepEqual(active(r.fx), []);
    const missing = lostRequest(r.fx, ['g-x:T1-X'], { digest: 'second' });
    r.fx.queue.resolveLost(missing.key, { found: false }, T0);
    const { startedAt, slotOwner, ...kept } = missing;
    assert.ok(startedAt && slotOwner, 'the lost request was running');
    assert.deepEqual(r.fx.queue.get(missing.key), { ...kept, state: 'queued', lastError: 'lost response; looked up, no result; requeued in order' });
    assert.deepEqual(active(r.fx), []);
  });

  for (const [aliasName, alias] of [['upper-case', upper], ['slash', slashed]] as const) {
    for (const [name, outcome] of outcomes) {
      for (const withBefore of [false, true]) {
        await t.test(`${aliasName} alias, ${name}, ${withBefore ? 'four' : 'three'} arguments: the stored record is written and the slot is free`, (t) => {
          const r = rig(t);
          const lost = lostRequest(r.fx, ['g-x:T1-X']);
          if (withBefore) r.fx.queue.resolveLost(alias(lost.key), outcome, T0, () => undefined);
          else r.fx.queue.resolveLost(alias(lost.key), outcome, T0);
          assert.equal(r.fx.queue.get(lost.key)?.key, lost.key);
          assert.equal(r.fx.queue.get(lost.key)?.state, outcome.found ? 'completed' : 'queued');
          assert.deepEqual(active(r.fx), []);
        });
      }
    }
  }
});

test('a failed queue write leaves the request lost and running the command again finishes it', async (t) => {
  const modes: Array<[string, string[], 'completed' | 'queued']> = [['--verdict', ['--verdict', 'verdict.json'], 'completed'], ['--no-result', ['--no-result'], 'queued']];
  for (const [mode, flags, final] of modes) {
    await t.test(`${mode}: a failed write of the pool leaves the slot held`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, oneRequester(r));
      const failed = resolve(r, lost.key, [...flags, ...LOOKED], { preload: true, env: { FAIL_RENAME_TO: path.basename(poolPath(r)) } });
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /injected write failure/);
      assert.equal(r.fx.queue.get(lost.key)?.state, 'lost');
      assert.deepEqual(active(r.fx), [lost.key]);
      assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
      const again = resolve(r, lost.key, [...flags, ...LOOKED]);
      assert.equal(again.status, 0, again.stderr);
      assert.equal(r.fx.queue.get(lost.key)?.state, final);
      assert.deepEqual(active(r.fx), []);
      assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
    });
    await t.test(`${mode}: a failed write of the request leaves the slot free, and the next run keeps another key there`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, oneRequester(r));
      const next = nextRequest(r.fx);
      const failed = resolve(r, lost.key, [...flags, ...LOOKED], { preload: true, env: { FAIL_RENAME_TO: path.basename(requestPath(r, lost.key)) } });
      assert.equal(failed.status, 1);
      assert.match(failed.stderr, /injected write failure/);
      assert.equal(r.fx.queue.get(lost.key)?.state, 'lost');
      assert.deepEqual(active(r.fx), []);
      assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
      assert.equal(r.fx.queue.admit(POOL, actorA, r.fx.now(), next.key).status, 'admitted');
      const again = resolve(r, upper(lost.key), [...flags, ...LOOKED]);
      assert.equal(again.status, 0, again.stderr);
      assert.equal(r.fx.queue.get(lost.key)?.state, final);
      assert.deepEqual(active(r.fx), [next.key]);
      assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
    });
  }

  await t.test('a journal failure after the slot was freed leaves the request and the pool as they were, and the run again finishes', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, bothRequesters(r));
    const next = nextRequest(r.fx);
    const failed = resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED], { preload: true, env: { FAIL_RENAME_TO: path.basename(requestPath(r, lost.key)) } });
    assert.equal(failed.status, 1);
    assert.equal(r.fx.queue.admit(POOL, actorA, r.fx.now(), next.key).status, 'admitted');
    const journal = journalPath(r, r.two);
    const kept = readFileSync(journal, 'utf8');
    rmSync(journal);
    mkdirSync(journal);
    const request = readFileSync(requestPath(r, lost.key), 'utf8');
    const pool = readFileSync(poolPath(r), 'utf8');
    const blocked = resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED]);
    assert.equal(blocked.status, 1);
    assert.equal(readFileSync(requestPath(r, lost.key), 'utf8'), request);
    assert.equal(readFileSync(poolPath(r), 'utf8'), pool);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'lost');
    assert.deepEqual(active(r.fx), [next.key]);
    rmdirSync(journal);
    writeFileSync(journal, kept);
    const again = resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'completed');
    assert.deepEqual(active(r.fx), [next.key]);
    assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
    assert.equal(resolvedNotes(r.fx, r.two.id).length, 1);
  });
});

test('each requester goal journals inside the queue section before the queue is written', async (t) => {
  await t.test('(a) under a held section, and on a refusal of the queue, no journal is read', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const queued = r.fx.queue.enqueue(enqueueInput('queued', `${r.one.id}:${HELD}`)).request;
    const env = countingEnv(r, { COUNT_READS_BASE: `${r.one.id}.jsonl` });
    let held: Result | undefined;
    r.fx.queue.updatePool('other', (pool) => {
      held = resolve(r, lost.key, ['--no-result', ...LOOKED], { preload: true, env });
      return pool;
    });
    assert.equal(held?.status, 1);
    assert.match(held?.stderr ?? '', /LOCKED/);
    assert.equal(reads(r), 0);
    assert.deepEqual(resolvedNotes(r.fx, r.one.id), []);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'lost');
    for (const [key, message] of [['o/r|none|main|p|r', 'unknown review request o/r|none|main|p|r'], [queued.key, `request ${queued.key} is not lost`]] as const) {
      const res = resolve(r, key, ['--no-result', ...LOOKED], { preload: true, env });
      assert.equal(res.stderr, aidlc(message));
      assert.equal(reads(r), 0, message);
    }
  });

  await t.test('(b) a journal that cannot be read leaves the request and the pool as they were', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, bothRequesters(r));
    const journal = journalPath(r, r.two);
    const kept = readFileSync(journal, 'utf8');
    rmSync(journal);
    mkdirSync(journal);
    const failed = resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED]);
    assert.equal(failed.status, 1);
    assert.deepEqual(r.fx.queue.get(lost.key), lost);
    assert.deepEqual(active(r.fx), [lost.key]);
    assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
    rmdirSync(journal);
    writeFileSync(journal, kept);
    const again = resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'completed');
    assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
    assert.equal(resolvedNotes(r.fx, r.two.id).length, 1);
  });

  await t.test('(c) a journal append that fails leaves the request and the pool as they were', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, bothRequesters(r));
    const failed = resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED], { preload: true, env: { FAIL_APPEND_TO: `${r.two.id}.jsonl` } });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /injected append failure/);
    assert.deepEqual(r.fx.queue.get(lost.key), lost);
    assert.deepEqual(active(r.fx), [lost.key]);
    assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
    assert.equal(resolvedNotes(r.fx, r.two.id).length, 0);
    const again = resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'completed');
    assert.equal(resolvedNotes(r.fx, r.one.id).length, 1);
    assert.equal(resolvedNotes(r.fx, r.two.id).length, 1);
  });
});

test('a NOTE counts only for its type, kind, key, pool, seq, attempts, outcome and verdict digest', async (t) => {
  const seeded = (lost: ReviewRequest, change: Record<string, unknown>): Record<string, unknown> => ({ kind: 'review-lost-resolved', key: lost.key, pool: lost.pool, seq: lost.seq, attempts: lost.attempts, outcome: 'found', reason: 'seeded', verdictSha256: sha256(PASS), ...change });
  const rows: Array<[string, 'NOTE' | 'REVIEW_REQUESTED', Record<string, unknown>]> = [
    ['type', 'REVIEW_REQUESTED', {}],
    ['kind', 'NOTE', { kind: 'review-slot-released' }],
    ['key', 'NOTE', { key: 'o/r|other|main|p|r' }],
    ['pool', 'NOTE', { pool: 'other' }],
    ['seq', 'NOTE', { seq: 7 }],
    ['attempts', 'NOTE', { attempts: 9 }],
    ['outcome', 'NOTE', { outcome: 'not-found' }],
    ['verdict digest', 'NOTE', { verdictSha256: sha256('other bytes') }],
  ];
  for (const [component, type, change] of rows) {
    await t.test(`a seeded event that differs only in its ${component} does not count`, (t) => {
      const r = rig(t);
      const lost = lostRequest(r.fx, oneRequester(r));
      Journal.forGoal(r.fx.paths.journal, r.one.id).append({ type, goalId: r.one.id, cardId: HELD, generation: 0, data: seeded(lost, change) });
      const before = r.fx.events(r.one.id).length;
      assert.equal(resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED]).status, 0);
      const after = r.fx.events(r.one.id);
      assert.equal(after.length, before + 1);
      const last = after.at(-1)!;
      assert.equal(last.type, 'NOTE');
      assert.deepEqual(last.data, { kind: 'review-lost-resolved', key: lost.key, pool: POOL, seq: lost.seq, attempts: 1, outcome: 'found', reason: 'looked-up', verdictSha256: sha256(PASS) });
    });
  }

  await t.test('a seeded event that matches in every component is reused and keeps its reason', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    Journal.forGoal(r.fx.paths.journal, r.one.id).append({ type: 'NOTE', goalId: r.one.id, cardId: HELD, generation: 0, data: seeded(lost, {}) });
    const before = r.fx.events(r.one.id).length;
    assert.equal(resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED]).status, 0);
    assert.equal(r.fx.events(r.one.id).length, before);
    assert.deepEqual(resolvedNotes(r.fx, r.one.id).map((e) => e.data['reason']), ['seeded']);
  });

  await t.test('a failed run followed by another outcome, or by other bytes, appends another NOTE', (t) => {
    const outcomeRig = rig(t);
    const lost = lostRequest(outcomeRig.fx, bothRequesters(outcomeRig));
    const failed = resolve(outcomeRig, lost.key, ['--verdict', 'verdict.json', ...LOOKED], { preload: true, env: { FAIL_APPEND_TO: `${outcomeRig.two.id}.jsonl` } });
    assert.equal(failed.status, 1);
    assert.equal(resolve(outcomeRig, lost.key, ['--no-result', ...LOOKED]).status, 0);
    assert.deepEqual(resolvedNotes(outcomeRig.fx, outcomeRig.one.id).map((e) => e.data['outcome']), ['found', 'not-found']);
    const bytesRig = rig(t);
    const second = lostRequest(bytesRig.fx, bothRequesters(bytesRig));
    const failedAgain = resolve(bytesRig, second.key, ['--verdict', 'verdict.json', ...LOOKED], { preload: true, env: { FAIL_APPEND_TO: `${bytesRig.two.id}.jsonl` } });
    assert.equal(failedAgain.status, 1);
    const other = '{"verdict":"block","reasons":["other bytes"]}';
    writeFileSync(path.join(bytesRig.cwd, 'verdict.json'), other);
    assert.equal(resolve(bytesRig, second.key, ['--verdict', 'verdict.json', ...LOOKED]).status, 0);
    assert.deepEqual(resolvedNotes(bytesRig.fx, bytesRig.one.id).map((e) => [e.data['outcome'], e.data['verdictSha256']]), [['found', sha256(PASS)], ['found', sha256(other)]]);
  });

  await t.test('a request admitted again and resolved again gets a NOTE with the next attempts at one seq', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    assert.equal(resolve(r, lost.key, ['--no-result', ...LOOKED]).status, 0);
    assert.equal(r.fx.queue.admit(POOL, actorA, r.fx.now(), lost.key).status, 'admitted');
    r.fx.queue.markLost(lost.key, LOST_DETAIL);
    assert.equal(resolve(r, lost.key, ['--no-result', ...LOOKED]).status, 0);
    assert.deepEqual(resolvedNotes(r.fx, r.one.id).map((e) => [e.data['attempts'], e.data['seq']]), [[1, lost.seq], [2, lost.seq]]);
  });

  await t.test('a goal requesting through two cards gets one NOTE with the first card', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, [`${r.one.id}:${HELD}`, `${r.one.id}:T1-OTHER`]);
    assert.equal(resolve(r, lost.key, ['--no-result', ...LOOKED]).status, 0);
    assert.deepEqual(noteRows(r.fx, r.one.id).map((row) => row[1]), [HELD]);
  });

  await t.test('a requester naming a goal the store does not hold gets none and the resolution succeeds', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, ['g-gone:T1-GONE']);
    assert.equal(resolve(r, lost.key, ['--no-result', ...LOOKED]).status, 0);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'queued');
    assert.equal(existsSync(path.join(r.fx.paths.journal, 'g-gone.jsonl')), false);
  });

  await t.test('the NOTE carries the generation of the stored goal', (t) => {
    const r = rig(t);
    r.fx.store.saveGoal({ ...r.fx.goal(r.one.id), generation: 3 });
    const lost = lostRequest(r.fx, oneRequester(r));
    assert.equal(resolve(r, lost.key, ['--no-result', ...LOOKED]).status, 0);
    assert.deepEqual(noteRows(r.fx, r.one.id).map((row) => row[2]), [3]);
  });

  await t.test('a legacy lost request without attempts gives a NOTE with attempts 0 and resolves', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    atomicWriteJson(requestPath(r, lost.key), { ...lost, attempts: undefined });
    assert.equal(readFileSync(requestPath(r, lost.key), 'utf8').includes('attempts'), false);
    const res = resolve(r, lost.key, ['--no-result', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(noteRows(r.fx, r.one.id).map((row) => row[6]), [0]);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'queued');
  });
});

test('two commands resolving the same lost request, one settles and the other is refused', async (t) => {
  const r = rig(t);
  const lost = lostRequest(r.fx, bothRequesters(r));
  for (let round = 0; round < 3; round += 1) {
    if (round > 0) {
      assert.equal(r.fx.queue.admit(POOL, actorA, r.fx.now(), lost.key).status, 'admitted');
      r.fx.queue.markLost(lost.key, LOST_DETAIL);
    }
    const args = ['review', 'resolve', lost.key, '--no-result', ...LOOKED];
    const results = await Promise.all([cliAsync(r, args), cliAsync(r, args)]);
    assert.equal(results.filter((res) => res.status === 0).length, 1, JSON.stringify(results));
    const loser = results.find((res) => res.status !== 0)!;
    assert.match(loser.stderr, /is not lost|LOCKED/);
    assert.deepEqual(active(r.fx), []);
    assert.equal(resolvedNotes(r.fx, r.one.id).length, round + 1);
    assert.equal(resolvedNotes(r.fx, r.two.id).length, round + 1);
    for (const goal of [r.one, r.two]) assert.deepEqual(Journal.forGoal(r.fx.paths.journal, goal.id).verify().problems, []);
  }
});

test('review resolve settles the queue request only', async (t) => {
  /** A goal whose card is stopped for `tool`, and a lost request of another candidate that it requested. */
  const stopped = (t: TestContext) => {
    const r = rig(t);
    driveCardToDone(r.fx, r.one.id, HELD);
    const run = r.fx.store.getCardRun(r.one.id, HELD)!;
    const stop = makeStop('tool', 'unclassified ship outcome (exit null)', 'inspect the ship output and the retained receipt', { at: T0, global: false, finalFor: { goalId: r.one.id, cardId: HELD } });
    r.fx.store.saveCardRun({ ...run, state: 'STOP', stop });
    const lost = lostRequest(r.fx, oneRequester(r), { digest: 'another-candidate' });
    return { r, lost };
  };
  const touched = (r: Rig, lost: ReviewRequest): string[] => [relative(r, requestPath(r, lost.key)), relative(r, poolPath(r)), relative(r, journalPath(r, r.one))].sort();

  await t.test('--verdict changes the request, the pool and the journal of the requester', (t) => {
    const { r, lost } = stopped(t);
    writeFileSync(path.join(r.cwd, 'block.json'), '{"verdict":"block","reasons":["x"]}');
    const before = snapshot(r.fx);
    const res = resolve(r, lost.key, ['--verdict', 'block.json', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.state, 'completed');
    assert.deepEqual(changedPaths(before, snapshot(r.fx)), touched(r, lost));
  });

  await t.test('--no-result changes the request, the pool and the journal of the requester', (t) => {
    const { r, lost } = stopped(t);
    const before = snapshot(r.fx);
    assert.equal(resolve(r, lost.key, ['--no-result', ...LOOKED]).status, 0);
    assert.deepEqual(changedPaths(before, snapshot(r.fx)), touched(r, lost));
  });

  await t.test('without a session in the environment the first journal append adds session-default', (t) => {
    const { r, lost } = stopped(t);
    assert.equal(existsSync(path.join(r.fx.paths.root, 'session-default')), false);
    const before = snapshot(r.fx);
    const res = resolve(r, lost.key, ['--no-result', ...LOOKED], { session: false });
    assert.equal(res.status, 0, res.stderr);
    assert.deepEqual(changedPaths(before, snapshot(r.fx)), [...touched(r, lost), 'session-default'].sort());
  });
});

test('--verdict is read as T0-CLI-CWD-FILE-ARGS-2 reads a file argument, and verdictRef names the file read', async (t) => {
  const posix = process.platform === 'win32' ? 'POSIX only: Windows resolves .. lexically when it opens a path' : false;
  const windows = process.platform === 'win32' ? false : 'Windows only: drive-relative and network values are refused only there';

  await t.test('a fully qualified value is read and recorded as given', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    mkdirSync(path.join(r.cwd, 'abs'));
    writeFileSync(path.join(r.cwd, 'abs', 'verdict.json'), PASS);
    const value = path.join(r.cwd, 'abs', 'verdict.json');
    const res = resolve(r, lost.key, ['--verdict', value, ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.verdictRef, value);
  });

  await t.test('with -C a fully qualified value is normalized lexically, not read as given', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    mkdirSync(path.join(r.cwd, 'abs'));
    const res = cli(r, ['-C', r.cwd, 'review', 'resolve', lost.key, '--verdict', `${r.cwd}${path.sep}abs${path.sep}..${path.sep}verdict.json`, ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.verdictRef, path.join(r.cwd, 'verdict.json'));
  });

  await t.test('with -C a relative value resolves against the -C directory; without it the value is read against the process directory', (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    rmSync(path.join(r.cwd, 'verdict.json'));
    mkdirSync(path.join(r.cwd, 'lookup'));
    writeFileSync(path.join(r.cwd, 'lookup', 'verdict.json'), PASS);
    const before = snapshot(r.fx);
    const plain = resolve(r, lost.key, ['--verdict', 'verdict.json', ...LOOKED]);
    assert.equal(plain.status, 1);
    assert.equal(plain.stderr, aidlc(M4('verdict.json', 'ENOENT')));
    assert.deepEqual(snapshot(r.fx), before);
    const res = cli(r, ['-C', path.join(r.cwd, 'lookup'), 'review', 'resolve', lost.key, '--verdict', 'verdict.json', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.verdictRef, path.resolve(r.cwd, 'lookup', 'verdict.json'));
  });

  await t.test('POSIX: a .. after a missing directory fails without -C and is read lexically with it', { skip: posix }, (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const before = snapshot(r.fx);
    const plain = resolve(r, lost.key, ['--verdict', 'missing/../verdict.json', ...LOOKED]);
    assert.equal(plain.status, 1);
    assert.equal(plain.stderr, aidlc(M4('missing/../verdict.json', 'ENOENT')));
    assert.deepEqual(snapshot(r.fx), before);
    const res = cli(r, ['-C', r.cwd, 'review', 'resolve', lost.key, '--verdict', 'missing/../verdict.json', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.verdictRef, `${r.cwd}/verdict.json`);
  });

  await t.test('POSIX: a .. after a directory link is read as the file system reads it, and verdictRef names that file', { skip: posix }, (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    mkdirSync(path.join(r.cwd, 'target', 'inner'), { recursive: true });
    symlinkSync(path.join(r.cwd, 'target', 'inner'), path.join(r.cwd, 'link'), 'dir');
    const linked = '{"verdict":"block","reasons":["link"]}';
    writeFileSync(path.join(r.cwd, 'target', 'verdict.json'), linked);
    const res = resolve(r, lost.key, ['--verdict', 'link/../verdict.json', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    const ref = r.fx.queue.get(lost.key)?.verdictRef;
    assert.equal(ref, `${r.cwd}/link/../verdict.json`);
    assert.equal(readFileSync(ref!, 'utf8'), linked);
    assert.deepEqual(resolvedNotes(r.fx, r.one.id).map((e) => e.data['verdictSha256']), [sha256(linked)]);
    assert.notEqual(sha256(linked), sha256(PASS));

    const second = lostRequest(r.fx, oneRequester(r), { digest: 'second' });
    const qualified = cli(r, ['-C', r.cwd, 'review', 'resolve', second.key, '--verdict', `${r.cwd}/link/../verdict.json`, ...LOOKED]);
    assert.equal(qualified.status, 0, qualified.stderr);
    assert.equal(r.fx.queue.get(second.key)?.verdictRef, `${r.cwd}/verdict.json`);
    assert.deepEqual(resolvedNotes(r.fx, r.one.id).filter((e) => e.data['key'] === second.key).map((e) => e.data['verdictSha256']), [sha256(PASS)]);
  });

  await t.test('Windows: a .. after a missing directory is read lexically', { skip: windows }, (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const res = resolve(r, lost.key, ['--verdict', 'missing\\..\\verdict.json', ...LOOKED]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(r.fx.queue.get(lost.key)?.verdictRef, path.join(r.cwd, 'verdict.json'));
  });

  await t.test('Windows: a drive-relative and a network value are refused', { skip: windows }, (t) => {
    const r = rig(t);
    const lost = lostRequest(r.fx, oneRequester(r));
    const rows: Array<[string, string]> = [
      ['C:verdict.json', '--verdict "C:verdict.json": a drive letter without a separator names the current directory of that drive; pass C:\\ and the full path, or a path relative to the -C directory'],
      ['\\\\x', '--verdict "\\\\\\\\x": a network path needs a server and a share; pass \\\\server\\share\\path, or a path relative to the -C directory'],
    ];
    for (const [value, message] of rows) assertRefused(r, { name: value, args: ['review', 'resolve', lost.key, '--verdict', value, ...LOOKED], stderr: aidlc(message) });
  });
});

const read = (file: string): string => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');

/** The text of a `## ` section of a Markdown file, from its heading to the next one, without the heading. */
function section(text: string, heading: string): string {
  const at = text.indexOf(`\n${heading}\n`);
  assert.ok(at >= 0, heading);
  const body = text.slice(at + heading.length + 2);
  const end = body.indexOf('\n## ');
  return (end < 0 ? body : body.slice(0, end)).trim();
}
const occurrences = (text: string, part: string): number => text.split(part).length - 1;

const RELEASE_SENTENCE = '`aidlc review release <key> --reason <text>` frees the slot of a `running` request whose owner process is gone from this host, which is how a process killed outside any catch leaves the pool; it refuses while that process is alive or when the owner is on another host, and journals a `review-slot-released` NOTE in each requester goal before it frees the slot, so running it again finishes a release that failed part way.';
const PARAGRAPH_S = "`aidlc review resolve <key> (--verdict <file> | --no-result) --reason <text>` settles a `lost` review request (card T0-REVIEW-RESOLVE-LOST-2). Only the scaffold ship path leaves one, when a whole ship times out and its output carries no `[SHIP-EFFECT-UNKNOWN]` line; the request keeps its pool slot until this command frees it, and `aidlc review release` refuses it. Look the review up first. `--verdict <file>` names the verdict document the lookup found, which the verdict-file parser of the ship paths must accept (at least a JSON object whose `verdict` is `pass` or `block`; the scaffold path reads `.review/<card>.json` in the card's worktree), and completes the request with a reference to the file that was read; `--no-result` records that the lookup found none and requeues the request at its own place in the queue; either frees the slot of the request's stored key, also when `<key>` is given in another letter case. The command refuses, with no write, a request that is not `lost`, an unknown key, both options or neither, a blank reason, and a file that cannot be read, is not JSON or is not accepted; the verdict is not compared with the request, which holds no field a verdict carries. Before the queue is written, each existing requester goal journals a `review-lost-resolved` NOTE with the request's stored key, the outcome, the reason and, for a verdict, the SHA-256 of the file's bytes; a retry reuses a NOTE only when its key, pool, seq, attempts, outcome and verdict digest all match, and that NOTE keeps its original reason. A failed journal read or append leaves the request and its pool as they were. The slot is freed before the request is written, so a failed pool write leaves the request `lost` with its slot held, and a failed write of the request leaves it `lost` with its slot already free, which another request may take meanwhile; in each case running the command again finishes it once the cause of the failure is gone. The command settles the queue request only and never touches the card run: a card that the timed-out ship stopped for `tool` stays stopped, with its review allowance and verdicts as they were, and goes on as the STOP reasons table says for `tool`. A requeued request keeps its place under the queue's rules: until it is completed or cancelled, a ship joins it when `shortKey` of its request key equals `shortKey` of the request's (the key is its repository, candidate digest, base, policy version and reviewer, each trimmed and lower-cased, and `shortKey` hashes the key in lower case with `\\` read as `/`), and a ship whose key has another `shortKey` does not join it; before the request's deadline, while it is the first eligible request of its pool, with no pending pool reset and the one slot of a default pool free, the admission of another request behind it answers `behind`; at or after its deadline it is cancelled as any queued request is, by an admission that finds no pending pool reset and a free slot and whose scan passes it, except that a keyed admission that answers `behind` cancels only the requests before the first eligible one; the same-card supersession is unchanged.";
const SETUP_SENTENCE = 'With `-C`, these file arguments resolve against the `-C` directory: `init [dir]`, `cards project --plan`, the `<file>` of `intent validate`, `spec validate` and `plan check`, `review bench compare <before.json> <after.json>`, `review resolve --verdict`, `ci classify --log`, `migrate assess --diff`, `evidence retain --file`, and `monitor check --bands` and `--data`.';
const QUALIFIED_SENTENCE = 'A relative value resolves lexically against it, and a fully qualified one is not joined to it and is normalized lexically as well (`/a/link/../f` names `/a/f`, whatever `link` is);';
const ENTRY_C ="- T0-REVIEW-RESOLVE-LOST-2 (replaces T0-REVIEW-RESOLVE-LOST, audit item F9): `aidlc review resolve <key> (--verdict <file> | --no-result) --reason <text>` settles a `lost` review request, which the scaffold ship path leaves when a whole ship times out without a `[SHIP-EFFECT-UNKNOWN]` line and which until now kept its pool slot with no command to free it (`aidlc review release` refuses it, and still does). `--verdict` names the verdict document the lookup found, accepted by the verdict-file parser of the ship paths, and completes the request with a reference to the file read; `--no-result` requeues it at its own place in the queue; either frees the slot through `ReviewQueue.resolveLost`, which gains an optional `before` step run in its section after the `lost` check and now frees the slot of the request's stored key, before it writes the request, so a failed queue write leaves the request `lost` (after a failed write of the request, with its slot already free). Before any queue write, each existing requester goal journals a `review-lost-resolved` NOTE with the key, the outcome, the reason and, for a verdict, the SHA-256 of the file's bytes; a failed journal read or append leaves the request and its pool as they were, and running the same command again finishes it once the cause of the failure is gone, reusing a NOTE of the same identity. Any other state, an unknown key, both options or neither, a blank reason, and a file that cannot be read, is not JSON or is not accepted are refused with no write. The command settles the queue request only; the card run, its review allowance and its verdicts are not touched. With `-C`, a relative `--verdict` resolves against the `-C` directory.";

test('docs/OPERATIONS.md Ship gates carries paragraph S directly above the review release paragraph', () => {
  const operations = read('docs/OPERATIONS.md');
  assert.ok(section(operations, '## Ship gates (GitHub ship path)').endsWith(`\n\n${PARAGRAPH_S}\n\n${RELEASE_SENTENCE}`));
  assert.equal(occurrences(operations, PARAGRAPH_S), 1);
});

test('docs/OPERATIONS.md Setup lists review resolve --verdict among the -C file arguments', () => {
  const operations = read('docs/OPERATIONS.md');
  assert.equal(occurrences(section(operations, '## Setup'), SETUP_SENTENCE), 1);
  assert.equal(occurrences(section(operations, '## Setup'), QUALIFIED_SENTENCE), 1);
});

test('CHANGELOG.md carries entry C directly above the T0-UNRESOLVED-NARRATION entry', () => {
  const unreleased = section(read('CHANGELOG.md'), '## Unreleased');
  assert.ok(unreleased.includes(`${ENTRY_C}\n\n- T0-UNRESOLVED-NARRATION`));
  assert.equal(occurrences(unreleased, ENTRY_C), 1);
});
