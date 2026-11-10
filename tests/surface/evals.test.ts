import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvalCase, loadEvals, realPathRule, removeDir, runEval, runSuite, runTrials } from '../../src/evals/runner.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { runSync, scriptedRunner, type SyncRunner } from '../../src/probes/exec.ts';
import type { CompletionRequest, CompletionResult, ModelProvider, ToolCall } from '../../src/providers/types.ts';
import { cleanup } from '../infra/helpers.ts';

const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

const temps: string[] = [];
/** A new directory under the OS temporary directory, removed after the file's tests, also when a test fails. */
function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}
after(() => {
  for (const dir of temps) cleanup(dir);
});

/** A git repository with `note.txt` committed: a model-backed case runs in a temporary checkout of its HEAD. */
function setup() {
  const cwd = tempDir('aidlc-evals-');
  const evalsDir = path.join(cwd, 'evals');
  writeFileSync(path.join(cwd, 'note.txt'), 'hello world', 'utf8');
  git(cwd, 'init', '-q');
  git(cwd, 'add', 'note.txt');
  git(cwd, 'commit', '-q', '-m', 'fixture');
  return { cwd, evalsDir };
}

const runner = scriptedRunner({ 'node -e ok': { exitCode: 0, stdout: 'fine' }, 'node -e fail': { exitCode: 1, stderr: 'boom' } });

test('loadEvals reads JSON cases with defaults', () => {
  const { evalsDir, cwd } = setup();
  writeFileSync(path.join(cwd, 'ignored.txt'), 'x');
  // evals dir does not exist yet
  assert.deepEqual(loadEvals(evalsDir), []);
  mkdirSync(evalsDir, { recursive: true });
  writeFileSync(path.join(evalsDir, 'b.json'), JSON.stringify({ id: 'b', prompt: 'do b', checks: [{ type: 'command', command: ['node', '-e', 'ok'] }] }));
  writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({ id: 'a', prompt: 'do a', dimension: 'security', role: 'reviewer', checks: [{ type: 'output-matches', pattern: 'x' }] }));
  const cases = loadEvals(evalsDir);
  assert.deepEqual(cases.map((c) => c.id), ['a', 'b']);
  assert.equal(cases[1]?.dimension, 'functional');
  assert.equal(cases[1]?.role, 'implementer');
  assert.equal(cases[1]?.effort, 'medium');
  assert.deepEqual(cases[1]?.allowedTools, ['Read', 'Edit', 'Bash(npm test)']);
  assert.equal(cases[0]?.dimension, 'security');
});

test('runSuite evaluates every check type against the mock provider and scripted runner', async () => {
  const { cwd } = setup();
  const provider = new MockProvider({ implementer: ['done {"ok": true, "n": 2}'] });
  const pass = EvalCase.parse({
    id: 'pass',
    prompt: 'do it',
    checks: [
      { type: 'command', command: ['node', '-e', 'ok'] },
      { type: 'json-field', path: 'ok', equals: true },
      { type: 'json-field', path: 'n', equals: 2 },
      { type: 'output-matches', pattern: '^done' },
      { type: 'contains', file: 'note.txt', text: 'hello' },
      { type: 'not-contains', file: 'note.txt', text: 'zzz' },
    ],
  });
  const fail = EvalCase.parse({ id: 'fail', prompt: 'do it', checks: [{ type: 'command', command: ['node', '-e', 'fail'] }, { type: 'contains', file: 'missing.txt', text: 'x' }] });
  const suite = await runSuite([pass, fail], provider, { cwd, runner });
  assert.equal(suite.total, 2);
  assert.equal(suite.passed, 1);
  assert.equal(suite.passRate, 0.5);
  assert.equal(suite.threshold, 0.9);
  assert.equal(suite.gate, 'fail');
  const p = suite.results.find((r) => r.id === 'pass')!;
  assert.equal(p.passed, true, JSON.stringify(p.checks));
  assert.ok(p.invocationId);
  const f = suite.results.find((r) => r.id === 'fail')!;
  assert.equal(f.passed, false);
  assert.equal(f.checks[0]?.detail, 'exit 1');
  assert.equal(f.checks[1]?.detail, 'file missing');
  const relaxed = await runSuite([pass, fail], provider, { cwd, runner, threshold: 0.5 });
  assert.equal(relaxed.gate, 'pass');
  const empty = await runSuite([], provider, { cwd, runner });
  assert.equal(empty.gate, 'fail');
  assert.equal(empty.passRate, 0);
});

test('skipModel runs checks without calling the provider; model failures fail the eval', async () => {
  const { cwd } = setup();
  const provider = new MockProvider({ implementer: [{ text: '', outcome: 'quota', error: 'rate limited' }] });
  const c = EvalCase.parse({ id: 'c', prompt: 'x', checks: [{ type: 'command', command: ['node', '-e', 'ok'] }] });
  const skipped = await runEval(c, provider, { cwd, runner, skipModel: true });
  assert.equal(skipped.passed, true);
  assert.equal(provider.calls.length, 0);
  const quota = await runEval(c, provider, { cwd, runner });
  assert.equal(quota.passed, false);
  assert.equal(quota.checks[0]?.check, 'model');
  assert.ok(quota.checks[0]?.detail.includes('quota'));
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.role, 'implementer');
});

/** A provider that answers every request with `toolCalls`. */
const withCalls = (toolCalls: ToolCall[]) => new MockProvider({ implementer: [{ text: 'done', toolCalls }] });

test('T1-EVAL-TRANSCRIPT-2 acceptance 2: each tool-call check passes on tool calls that satisfy it and fails on calls that do not; the request asks for tool calls [R3] [R4]', async () => {
  const { cwd } = setup();
  const cases: Array<[EvalCase['checks'][number], ToolCall[], ToolCall[]]> = [
    [{ type: 'read-file', path: '.claude/skills/tdd/SKILL.md' }, [{ name: 'Read', input: { file_path: '.claude/skills/tdd/SKILL.md' } }], [{ name: 'Grep', input: { pattern: 'x', path: '.claude/skills/tdd/SKILL.md' } }, { name: 'Bash', input: { command: 'cat .claude/skills/tdd/SKILL.md' } }]],
    [{ type: 'ran-command', pattern: '\\baidlc next\\b' }, [{ name: 'PowerShell', input: { command: 'aidlc next --goal g-1' } }], [{ name: 'Bash', input: { command: 'aidlc board' } }, { name: 'Read', input: { file_path: 'aidlc next' } }]],
    [{ type: 'not-ran-command', pattern: 'rm -rf' }, [{ name: 'Bash', input: { command: 'ls' } }], [{ name: 'Bash', input: { command: 'rm -rf .aidlc' } }]],
    [{ type: 'not-wrote-path', pattern: '(^|[\\\\/])\\.aidlc[\\\\/]' }, [{ name: 'Write', input: { file_path: 'src/a.ts' } }, { name: 'Read', input: { file_path: '.aidlc/cards.json' } }], [{ name: 'NotebookEdit', input: { notebook_path: '.aidlc/x.ipynb' } }]],
  ];
  for (const [check, good, bad] of cases) {
    const c = EvalCase.parse({ id: check.type, prompt: 'do it', checks: [check] });
    const goodProvider = withCalls(good);
    const pass = await runEval(c, goodProvider, { cwd, runner });
    assert.equal(pass.passed, true, `${check.type} passes: ${JSON.stringify(pass.checks)}`);
    assert.equal(goodProvider.calls[0]?.recordToolCalls, true, `${check.type} asks for tool calls`);
    const fail = await runEval(c, withCalls(bad), { cwd, runner });
    assert.equal(fail.passed, false, `${check.type} fails: ${JSON.stringify(fail.checks)}`);
  }
  const plain = new MockProvider({ implementer: ['done'] });
  await runEval(EvalCase.parse({ id: 'plain', prompt: 'do it', checks: [{ type: 'output-matches', pattern: 'done' }] }), plain, { cwd, runner });
  assert.equal(plain.calls[0]?.recordToolCalls, undefined, 'a case with no tool-call check does not ask for tool calls');
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 2: under skipModel each tool-call check fails with the detail no model run [R3]', async () => {
  const { cwd } = setup();
  const checks = [{ type: 'read-file', path: 'note.txt' }, { type: 'ran-command', pattern: 'x' }, { type: 'not-ran-command', pattern: 'x' }, { type: 'not-wrote-path', pattern: 'x' }];
  const r = await runEval(EvalCase.parse({ id: 'skip', prompt: 'do it', checks }), new MockProvider(), { cwd, runner, skipModel: true });
  assert.equal(r.passed, false);
  assert.deepEqual(r.checks.map((x) => [x.ok, x.detail]), checks.map(() => [false, 'no model run']));
});

/** Paths compared as the OS compares them: resolved, and without letter case on Windows. */
const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
};

/** A provider that records what one request saw while it ran, then answers or throws. */
function observingProvider(then: 'answer' | 'throw') {
  const seen: { cwd?: string; stateDir?: string; stateEntries?: string[]; noteInCwd?: boolean; nodeModules?: boolean } = {};
  const provider: ModelProvider = {
    name: 'observing',
    available: async () => ({ ok: true, detail: '' }),
    complete: async (request: CompletionRequest): Promise<CompletionResult> => {
      seen.cwd = request.cwd;
      seen.stateDir = request.env?.['AIDLC_STATE_DIR'];
      seen.stateEntries = seen.stateDir ? readdirSync(seen.stateDir) : undefined;
      seen.noteInCwd = !!request.cwd && existsSync(path.join(request.cwd, 'note.txt'));
      seen.nodeModules = !!request.cwd && existsSync(path.join(request.cwd, 'node_modules', 'marker.txt'));
      if (then === 'throw') throw new Error('provider failed');
      return { invocationId: 'i', provider: 'observing', model: 'm', text: 'done', outcome: 'ok', durationMs: 0, toolCalls: [] };
    },
  };
  return { provider, seen };
}

for (const then of ['answer', 'throw'] as const) {
  test(`T1-EVAL-TRANSCRIPT-2 acceptance 3: a model-backed case runs in a temporary checkout with an empty state directory, both removed after the run (provider ${then === 'answer' ? 'answers' : 'throws'}) [R5]`, async () => {
    const { cwd } = setup();
    mkdirSync(path.join(cwd, 'node_modules'));
    writeFileSync(path.join(cwd, 'node_modules', 'marker.txt'), 'm');
    const { provider, seen } = observingProvider(then);
    const c = EvalCase.parse({ id: 'iso', prompt: 'do it', checks: [{ type: 'contains', file: 'note.txt', text: 'hello' }] });
    if (then === 'throw') await assert.rejects(runEval(c, provider, { cwd, runner }), /provider failed/);
    else assert.equal((await runEval(c, provider, { cwd, runner })).passed, true);
    assert.ok(seen.cwd, 'the provider got a working directory');
    assert.equal(samePath(seen.cwd, realpathSync.native(cwd)), false, 'not the repository root');
    assert.equal(seen.noteInCwd, true, 'the working directory is a checkout of HEAD');
    assert.equal(seen.nodeModules, true, "the main checkout's node_modules is linked in");
    assert.ok(seen.stateDir, 'AIDLC_STATE_DIR is set');
    assert.deepEqual(seen.stateEntries, [], 'AIDLC_STATE_DIR names an empty directory');
    assert.equal(existsSync(seen.cwd), false, 'the checkout is removed');
    assert.equal(existsSync(seen.stateDir), false, 'the state directory is removed');
    assert.equal(existsSync(path.join(cwd, 'node_modules', 'marker.txt')), true, "the main checkout's node_modules survives the cleanup");
    const listed = git(cwd, 'worktree', 'list', '--porcelain');
    assert.equal(listed.status, 0);
    const named = listed.stdout.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
    assert.equal(named.length, 1, `only the repository itself is listed: ${named.join(', ')}`);
    assert.equal(named.some((p) => samePath(p, seen.cwd!)), false, 'git worktree list does not name the checkout');
  });
}

/** An error as fs raises it, with `code` set. */
const fsError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: test`), { code });

/** A clock that advances only inside the recording wait, and a remove that records the clock at each call. */
function fakeRemoval(outcome: (call: number) => NodeJS.ErrnoException | undefined) {
  let clock = 0;
  const callTimes: number[] = [];
  const waits: number[] = [];
  const remove = (_dir: string): void => {
    callTimes.push(clock);
    const err = outcome(callTimes.length);
    if (err) throw err;
  };
  const now = (): number => clock;
  const wait = (ms: number): void => {
    waits.push(ms);
    clock += ms;
  };
  return { deps: { remove, now, wait }, callTimes, waits };
}

test('T0-EVAL-CHECKOUT-BUSY-2 acceptance 1: a remove that throws EBUSY twice and then succeeds is called three times with two waits of 200 ms, and the directory counts as removed [R1]', async () => {
  let calls = 0;
  const waits: number[] = [];
  const removed = await removeDir('/no/such/dir', {
    remove: () => {
      calls += 1;
      if (calls <= 2) throw fsError('EBUSY');
    },
    now: () => 0,
    wait: (ms) => {
      waits.push(ms);
    },
  });
  assert.deepEqual({ removed, calls, waits }, { removed: true, calls: 3, waits: [200, 200] });
});

test('T0-EVAL-CHECKOUT-BUSY-2 acceptance 2: a remove that always throws EBUSY is called every 200 ms until the first call at or after 10000 ms, and the directory counts as not removed [R1]', async () => {
  const f = fakeRemoval(() => fsError('EBUSY'));
  const removed = await removeDir('/no/such/dir', f.deps);
  // Calls at t = 0, 200, ..., 10000: 51 calls, 50 waits of 200 ms.
  const expectedTimes = Array.from({ length: 51 }, (_, i) => i * 200);
  assert.deepEqual({ removed, callTimes: f.callTimes, waits: f.waits }, { removed: false, callTimes: expectedTimes, waits: expectedTimes.slice(1).map(() => 200) });
});

test('T0-EVAL-CHECKOUT-BUSY-2 acceptance 2: a remove that throws EACCES is called once with no wait, and the directory counts as not removed [R1]', async () => {
  const f = fakeRemoval(() => fsError('EACCES'));
  const removed = await removeDir('/no/such/dir', f.deps);
  assert.deepEqual({ removed, callTimes: f.callTimes, waits: f.waits }, { removed: false, callTimes: [0], waits: [] });
});

test('T0-EVAL-CHECKOUT-BUSY-2 acceptance 2: a remove that succeeds is called once with no wait, and the directory counts as removed [R1]', async () => {
  const f = fakeRemoval(() => undefined);
  const removed = await removeDir('/no/such/dir', f.deps);
  assert.deepEqual({ removed, callTimes: f.callTimes, waits: f.waits }, { removed: true, callTimes: [0], waits: [] });
});

/** Waits until no process has the id, polling every 100 ms, at most `polls` times. */
async function processGone(pid: number, polls: number): Promise<void> {
  for (let i = 0; i < polls; i += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

test('T0-EVAL-CHECKOUT-BUSY-2 acceptance 3: a process the provider started with its working directory in the temporary checkout, exiting 1500 ms later, leaves no holder directory, no worktree entry and nothing named in detail [R2]', async () => {
  const { cwd } = setup();
  const seen: { cwd?: string; pid?: number } = {};
  const provider: ModelProvider = {
    name: 'busy',
    available: async () => ({ ok: true, detail: '' }),
    complete: async (request: CompletionRequest): Promise<CompletionResult> => {
      seen.cwd = request.cwd;
      const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},1500)'], { cwd: request.cwd, detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      seen.pid = child.pid;
      return { invocationId: 'i', provider: 'busy', model: 'm', text: 'done', outcome: 'ok', durationMs: 0, toolCalls: [] };
    },
  };
  const c = EvalCase.parse({ id: 'busy', prompt: 'do it', checks: [{ type: 'contains', file: 'note.txt', text: 'hello' }] });
  try {
    const r = await runEval(c, provider, { cwd, runner });
    assert.ok(seen.cwd, 'the provider got a working directory');
    const holder = path.dirname(seen.cwd);
    temps.push(holder);
    const listed = git(cwd, 'worktree', 'list', '--porcelain');
    assert.equal(listed.status, 0);
    const named = listed.stdout.split(/\r?\n/).filter((l) => l.startsWith('worktree ')).map((l) => l.slice('worktree '.length));
    assert.deepEqual(
      { passed: r.passed, holderExists: existsSync(holder), checkoutNamed: named.some((p) => samePath(p, seen.cwd!)), detailNamesLeft: /not removed/.test(r.detail ?? '') },
      { passed: true, holderExists: false, checkoutNamed: false, detailNamesLeft: false },
      `detail: ${r.detail ?? ''}`,
    );
  } finally {
    if (seen.pid !== undefined) await processGone(seen.pid, 50);
  }
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 4: a prompt with a measurement word is refused naming the case and the word; whole words only; the system prompt names none [R4] [R6]', async () => {
  const { evalsDir, cwd } = setup();
  mkdirSync(evalsDir, { recursive: true });
  writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({ id: 'case-r', prompt: 'Follow the Rubric and fix the bug.', checks: [{ type: 'output-matches', pattern: 'x' }] }));
  assert.throws(() => loadEvals(evalsDir), (err: Error) => err.message.includes('case-r') && err.message.includes('Rubric'));
  writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({ id: 'case-s', prompt: 'The tests scored well; keep them green.', checks: [{ type: 'output-matches', pattern: 'x' }] }));
  assert.deepEqual(loadEvals(evalsDir).map((c) => c.id), ['case-s']);
  const provider = new MockProvider({ implementer: ['done'] });
  await runEval(EvalCase.parse({ id: 'sys', prompt: 'do it', checks: [{ type: 'output-matches', pattern: 'done' }] }), provider, { cwd, runner });
  assert.ok(provider.calls[0]?.system, 'a system prompt is sent');
  assert.doesNotMatch(provider.calls[0]!.system, /\b(eval|evals|judge|rubric|grader|benchmark|experiment|score)\b/i);
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 5: every case under evals/agent parses, has a tool-call check and an origin naming CLAUDE.md, and loadEvals of evals/ reads none of them [R7]', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const agent = loadEvals(path.join(root, 'evals', 'agent'));
  assert.ok(agent.length >= 3, `${agent.length} agent cases`);
  for (const c of agent) {
    assert.ok(c.checks.some((x) => ['read-file', 'ran-command', 'not-ran-command', 'not-wrote-path'].includes(x.type)), `${c.id} has a tool-call check`);
    assert.match(c.origin ?? '', /CLAUDE\.md/, `${c.id} origin names a CLAUDE.md rule`);
  }
  const top = loadEvals(path.join(root, 'evals')).map((c) => c.id);
  for (const c of agent) assert.equal(top.includes(c.id), false, `${c.id} is not read from evals/`);
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 8: loadEvals refuses an absolute cwd, a ../ file and an .aidlc/ file, naming the case and the field', () => {
  const { evalsDir } = setup();
  mkdirSync(evalsDir, { recursive: true });
  const refused: Array<[string, Record<string, unknown>, string]> = [
    ['abs-cwd', { type: 'command', command: ['node', '-e', 'ok'], cwd: path.resolve(tmpdir()) }, 'cwd'],
    ['up-file', { type: 'contains', file: '../note.txt', text: 'x' }, 'file'],
    ['state-file', { type: 'not-contains', file: '.aidlc/x', text: 'x' }, 'file'],
  ];
  for (const [id, check, field] of refused) {
    writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({ id, prompt: 'do it', checks: [check] }));
    assert.throws(() => loadEvals(evalsDir), (err: Error) => err.message.includes(id) && err.message.includes(`\`${field}\``), `${id} is refused naming the case and \`${field}\``);
  }
  writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({ id: 'inside', prompt: 'do it', checks: [{ type: 'contains', file: 'sub/note.txt', text: 'x' }, { type: 'command', command: ['node', '-e', 'ok'], cwd: 'sub' }] }));
  assert.deepEqual(loadEvals(evalsDir).map((c) => c.id), ['inside'], 'relative paths inside the checkout load');
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 8: a file or cwd through a link that leaves the working directory is refused without reading or running; a path inside still works', async () => {
  const { cwd } = setup();
  const outside = tempDir('aidlc-evals-outside-');
  writeFileSync(path.join(outside, 'secret.txt'), 'hello secret', 'utf8');
  // A junction needs no privilege on Windows and a symlink always works on Linux: a creation error fails the test.
  symlinkSync(outside, path.join(cwd, 'out'), 'junction');
  const ran: string[][] = [];
  const counting = scriptedRunner({ 'node -e ok': (args) => (ran.push(args), { exitCode: 0 }) });
  const c = EvalCase.parse({ id: 'escape', prompt: 'do it', checks: [{ type: 'contains', file: 'out/secret.txt', text: 'hello' }, { type: 'command', command: ['node', '-e', 'ok'], cwd: 'out' }, { type: 'contains', file: 'note.txt', text: 'hello' }] });
  const r = await runEval(c, new MockProvider(), { cwd, runner: counting, skipModel: true });
  assert.deepEqual(r.checks.map((x) => x.ok), [false, false, true], JSON.stringify(r.checks));
  assert.match(r.checks[0]!.detail, /outside the working directory/);
  assert.match(r.checks[1]!.detail, /outside the working directory/);
  assert.deepEqual(ran, [], 'the command did not run');
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 8: a file or cwd through a link inside the working directory that points at its .aidlc/ is refused without reading or running', async () => {
  const { cwd } = setup();
  mkdirSync(path.join(cwd, '.aidlc'));
  writeFileSync(path.join(cwd, '.aidlc', 'x'), 'hello state', 'utf8');
  symlinkSync(path.join(cwd, '.aidlc'), path.join(cwd, 'alias'), 'junction');
  const ran: string[][] = [];
  const counting = scriptedRunner({ 'node -e ok': (args) => (ran.push(args), { exitCode: 0 }) });
  const c = EvalCase.parse({ id: 'alias', prompt: 'do it', checks: [{ type: 'contains', file: 'alias/x', text: 'hello' }, { type: 'command', command: ['node', '-e', 'ok'], cwd: 'alias' }] });
  const r = await runEval(c, new MockProvider(), { cwd, runner: counting, skipModel: true });
  assert.deepEqual(r.checks.map((x) => x.ok), [false, false], JSON.stringify(r.checks));
  for (const x of r.checks) assert.match(x.detail, /^refused: .*\.aidlc/, x.check);
  assert.deepEqual(ran, [], 'the command did not run');
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 8: realPathRule refuses a real target outside the working directory or with .aidlc as its first segment below it, on both path rules', () => {
  const outside = 'resolves outside the working directory';
  const state = 'resolves into the `.aidlc` of the working directory';
  const posix: Array<[string, string | undefined]> = [
    ['/w', undefined],
    ['/w/note.txt', undefined],
    ['/w/.aidlc', state],
    ['/w/.aidlc/x', state],
    ['/w/x/.aidlc', undefined],
    ['/w/.AIDLC', undefined],
    ['/w/..aidlc', undefined],
    ['/', outside],
    ['/other/w', outside],
  ];
  for (const [target, want] of posix) assert.equal(realPathRule('/w', target, 'linux'), want, `linux ${target}`);
  const win32: Array<[string, string | undefined]> = [
    ['C:\\w\\note.txt', undefined],
    ['C:\\w\\.AIDLC', state],
    ['c:\\W\\.aidlc\\x', state],
    ['C:\\w\\x\\.aidlc', undefined],
    ['C:\\', outside],
    ['D:\\w\\note.txt', outside],
  ];
  for (const [target, want] of win32) assert.equal(realPathRule('C:\\w', target, 'win32'), want, `win32 ${target}`);
});

for (const then of ['answer', 'throw'] as const) {
  test(`T1-EVAL-TRANSCRIPT-2 acceptance 7: under skipModel a command check sees AIDLC_STATE_DIR naming a new empty directory, removed after the run (runner ${then === 'answer' ? 'answers' : 'throws'})`, async () => {
    const { cwd } = setup();
    mkdirSync(path.join(cwd, '.aidlc'));
    const seen: { cwd?: string; stateDir?: string; entries?: string[] } = {};
    const observing: SyncRunner = (command, args, options = {}) => {
      seen.cwd = options.cwd;
      seen.stateDir = options.env?.['AIDLC_STATE_DIR'];
      seen.entries = seen.stateDir ? readdirSync(seen.stateDir) : undefined;
      if (then === 'throw') throw new Error('runner failed');
      return { command, args, cwd: options.cwd ?? '', exitCode: 0, signal: null, timedOut: false, stdout: '', stderr: '', startedAt: '2026-11-08T00:00:00.000Z', finishedAt: '2026-11-08T00:00:01.000Z', durationMs: 1000, outputSha256: '' };
    };
    const c = EvalCase.parse({ id: 'state', prompt: 'do it', checks: [{ type: 'command', command: ['node', 'bin/aidlc.js', 'board'] }] });
    if (then === 'throw') await assert.rejects(runEval(c, new MockProvider(), { cwd, runner: observing, skipModel: true }), /runner failed/);
    else assert.equal((await runEval(c, new MockProvider(), { cwd, runner: observing, skipModel: true })).passed, true);
    assert.ok(seen.cwd && samePath(seen.cwd, cwd), 'the check still runs in options.cwd');
    assert.ok(seen.stateDir, 'AIDLC_STATE_DIR is set');
    assert.deepEqual(seen.entries, [], 'AIDLC_STATE_DIR names an empty directory');
    assert.equal(samePath(seen.stateDir, path.join(cwd, '.aidlc')), false, "not the repository's .aidlc");
    assert.equal(existsSync(seen.stateDir), false, 'the state directory is removed');
    assert.deepEqual(readdirSync(path.join(cwd, '.aidlc')), [], "the repository's .aidlc is untouched");
  });
}

test('T1-EVAL-TRANSCRIPT-2 acceptance 9: loadEvals refuses a case file that is a link into a protected directory before reading it; a case file in a normal directory loads [R10]', () => {
  const { cwd, evalsDir } = setup();
  const state = path.join(cwd, '.aidlc');
  mkdirSync(path.join(state, 'goals'), { recursive: true });
  writeFileSync(path.join(state, 'x.json'), 'not json: reading it would throw a parse error', 'utf8');
  mkdirSync(evalsDir);
  writeFileSync(path.join(evalsDir, 'a.json'), JSON.stringify({ id: 'a', prompt: 'do it', checks: [{ type: 'output-matches', pattern: 'x' }] }));
  assert.deepEqual(loadEvals(evalsDir, { protectedDirs: [state] }).map((c) => c.id), ['a'], 'a case file in a normal directory loads');
  const link = path.join(evalsDir, 'x.json');
  try {
    symlinkSync(path.join(state, 'x.json'), link, 'file');
  } catch {
    // A file symlink needs a privilege on Windows; a directory junction named like a case file is a link into .aidlc too.
    symlinkSync(path.join(state, 'goals'), link, 'junction');
  }
  assert.throws(() => loadEvals(evalsDir, { protectedDirs: [state] }), (err: Error) => err.message.includes(JSON.stringify(link)) && /inside a protected directory/.test(err.message), 'refused naming the quoted path, before any read');
  assert.throws(() => loadEvals(evalsDir), (err: Error) => err.message.includes(JSON.stringify(link)) && /inside a protected directory/.test(err.message), "with no options loadEvals derives the repository's .aidlc itself");
});

// Card T1-EVAL-VARIANT: `--variant <ref> --trials <n>` runs the same cases on HEAD and on the ref and gives the trial verdict.

/** A repository whose first commit has `note.txt` reading "hello world" and whose second (HEAD) has it reading "bye". */
function twoCommits() {
  const { cwd } = setup();
  const first = git(cwd, 'rev-parse', 'HEAD').stdout.trim();
  writeFileSync(path.join(cwd, 'note.txt'), 'bye', 'utf8');
  git(cwd, 'commit', '-q', '-am', 'second');
  return { cwd, first };
}

const hello = EvalCase.parse({ id: 'hello', prompt: 'do it', checks: [{ type: 'contains', file: 'note.txt', text: 'hello' }] });

/** A scripted provider that records the note each request's checkout held, and answers call k (1-based) with `outcomes[k]`. */
function sidesProvider(outcomes: Record<number, CompletionResult['outcome']> = {}) {
  const notes: string[] = [];
  const cwds: string[] = [];
  const provider: ModelProvider = {
    name: 'sides',
    available: async () => ({ ok: true, detail: '' }),
    complete: async (request: CompletionRequest): Promise<CompletionResult> => {
      cwds.push(request.cwd!);
      notes.push(readFileSync(path.join(request.cwd!, 'note.txt'), 'utf8'));
      const outcome = outcomes[notes.length] ?? 'ok';
      return { invocationId: `i${notes.length}`, provider: 'sides', model: 'm', text: 'done', outcome, ...(outcome === 'ok' ? {} : { error: 'scripted' }), durationMs: 0 };
    },
  };
  return { provider, notes, cwds };
}

const cliMain = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'cli', 'main.ts');

test('T1-EVAL-VARIANT acceptance 1: HEAD passing where the ref fails, --trials 3, reports 3/3 on HEAD and 0/3 on the ref, the verdict better for HEAD, and the sides alternate [R2] [R3] [R4]', async () => {
  const { cwd, first } = twoCommits();
  const second = git(cwd, 'rev-parse', 'HEAD').stdout.trim();
  git(cwd, 'checkout', '-q', '--detach', first);
  const { provider, notes, cwds } = sidesProvider();
  const report = await runTrials([hello], provider, { cwd, trials: 3, variant: second, runner });
  assert.deepEqual(notes, ['hello world', 'bye', 'hello world', 'bye', 'hello world', 'bye'], 'HEAD, ref, HEAD, ref, HEAD, ref');
  for (const c of cwds) assert.equal(existsSync(c), false, `the checkout ${c} is removed`);
  for (const c of cwds) assert.equal(samePath(c, cwd), false, 'no side runs in the repository itself');
  const head = { passed: 3, trials: 3, passRate: { median: 1, min: 1, max: 1 }, modelErrors: 0, quotaHolds: 0 };
  const variant = { passed: 0, trials: 3, passRate: { median: 0, min: 0, max: 0 }, modelErrors: 0, quotaHolds: 0 };
  assert.deepEqual(report.cases, [{ id: 'hello', head, variant }]);
  assert.deepEqual(report.total, { head, variant });
  assert.deepEqual(report.variant, { ref: second, commit: second, head: first });
  assert.equal(report.verdict, 'better');
  assert.equal(report.reason, `pass rate 1.00 to 1.00 HEAD, 0.00 to 0.00 ${JSON.stringify(second)}: the ranges do not overlap`);
  assert.equal(report.checkoutError, undefined);
});

test('T1-EVAL-VARIANT acceptance 1: the mirror, HEAD failing where --variant HEAD~1 passes, gives worse for HEAD [R2] [R4]', async () => {
  const { cwd } = twoCommits();
  const { provider, notes } = sidesProvider();
  const report = await runTrials([hello], provider, { cwd, trials: 3, variant: 'HEAD~1', runner });
  assert.deepEqual(notes, ['bye', 'hello world', 'bye', 'hello world', 'bye', 'hello world']);
  assert.deepEqual([report.total.head.passed, report.total.variant?.passed], [0, 3]);
  assert.equal(report.verdict, 'worse');
  assert.equal(report.reason, 'pass rate 0.00 to 0.00 HEAD, 1.00 to 1.00 "HEAD~1": the ranges do not overlap');
});

test('T1-EVAL-VARIANT acceptance 2: one model error on either side makes the verdict inconclusive naming it; a quota hold stops the run and is named [R4]', async () => {
  const { cwd } = twoCommits();
  for (const [call, side] of [[1, 'HEAD'], [4, '"HEAD~1"']] as const) {
    const report = await runTrials([hello], sidesProvider({ [call]: 'error' }).provider, { cwd, trials: 3, variant: 'HEAD~1', runner });
    assert.equal(report.verdict, 'inconclusive');
    assert.equal(report.reason, `${side} has 0 quota holds and 1 model errors over its trials`);
  }
  const quota = sidesProvider({ 3: 'quota' });
  const held = await runTrials([hello], quota.provider, { cwd, trials: 3, variant: 'HEAD~1', runner });
  assert.equal(quota.notes.length, 3, 'the run stopped at the quota hold');
  assert.deepEqual([held.total.head.trials, held.total.head.quotaHolds, held.total.variant?.trials], [2, 1, 1]);
  assert.equal(held.verdict, 'inconclusive');
  assert.equal(held.reason, '"HEAD~1" has 1 trials, fewer than the 3 a verdict needs; HEAD has 2 trials, fewer than the 3 a verdict needs; HEAD has 1 quota holds and 0 model errors over its trials');
});

test('T1-EVAL-VARIANT acceptance 2: --trials 2 is inconclusive naming the trial count [R4]', async () => {
  const { cwd } = twoCommits();
  const report = await runTrials([hello], sidesProvider().provider, { cwd, trials: 2, variant: 'HEAD~1', runner });
  assert.equal(report.verdict, 'inconclusive');
  assert.equal(report.reason, '"HEAD~1" has 2 trials, fewer than the 3 a verdict needs; HEAD has 2 trials, fewer than the 3 a verdict needs');
});

test('T1-EVAL-VARIANT acceptance 3: --variant with --skip-model and a ref that names no commit are refused before any provider call; --trials 0 and 21 are refused [R1]', async () => {
  const { cwd, first } = twoCommits();
  const blob = git(cwd, 'rev-parse', 'HEAD:note.txt').stdout.trim();
  const { provider, notes } = sidesProvider();
  await assert.rejects(runTrials([hello], provider, { cwd, trials: 3, variant: first, skipModel: true, runner }), /--variant cannot be used with --skip-model/);
  for (const ref of ['no-such-ref"', blob, '--all']) await assert.rejects(runTrials([hello], provider, { cwd, trials: 3, variant: ref, runner }), (err: Error) => err.message === `--variant ${JSON.stringify(ref)} names no commit`, ref);
  for (const trials of [0, 21, 1.5]) await assert.rejects(runTrials([hello], provider, { cwd, trials, variant: first, runner }), (err: Error) => err.message === `--trials must be an integer from 1 to 20, not ${trials}`, String(trials));
  assert.deepEqual(notes, [], 'the provider was never called');
});

test('T1-EVAL-VARIANT acceptance 3: the CLI refuses --trials 0, --trials 21 and --variant with --skip-model, running no case [R1]', () => {
  const state = tempDir('aidlc-evals-state-');
  const { cwd } = twoCommits();
  const refused: Array<[string[], string]> = [
    [['--trials', '0'], '--trials must be an integer from 1 to 20, not "0"'],
    [['--trials', '21'], '--trials must be an integer from 1 to 20, not "21"'],
    [['--variant', 'HEAD', '--skip-model'], '--variant cannot be used with --skip-model'],
  ];
  for (const [args, message] of refused) {
    const r = spawnSync(process.execPath, [cliMain, 'evals', 'run', ...args], { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, AIDLC_STATE_DIR: state } });
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stderr}`);
    assert.ok(r.stderr.includes(message), `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '', 'no case was run');
  }
});

test('T1-EVAL-VARIANT acceptance 4: with neither option, the example case gives the result object and exit code it gave before the card [R5] [R6]', () => {
  const example = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'evals', 'example-regression.json'), 'utf8');
  for (const [exit, gate] of [[0, 'pass'], [1, 'fail']] as const) {
    const { cwd } = setup();
    mkdirSync(path.join(cwd, 'evals'));
    writeFileSync(path.join(cwd, 'evals', 'example-regression.json'), example);
    writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { test: `node -e "process.exit(${exit})"` } }));
    const state = tempDir('aidlc-evals-state-');
    const r = spawnSync(process.execPath, [cliMain, 'evals', 'run', '--skip-model', '--threshold', '0.9', '--json'], { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, AIDLC_STATE_DIR: state } });
    assert.equal(r.status, exit, r.stderr);
    const suite = JSON.parse(r.stdout) as { results: Array<Record<string, unknown>> };
    for (const x of suite.results) delete x['durationMs'];
    assert.deepEqual(suite, { total: 1, passed: 1 - exit, passRate: 1 - exit, threshold: 0.9, gate, results: [{ id: 'example-regression-tests-stay-green', dimension: 'regression', passed: exit === 0, checks: [{ check: 'command npm test', ok: exit === 0, detail: `exit ${exit}` }] }] });
  }
});

test('T1-EVAL-VARIANT R5: --trials without --variant runs HEAD alone n times and reports the figures with no verdict', async () => {
  const { cwd } = twoCommits();
  const { provider, notes } = sidesProvider();
  const report = await runTrials([hello], provider, { cwd, trials: 2, runner });
  assert.deepEqual(notes, ['bye', 'bye']);
  assert.deepEqual(report.total, { head: { passed: 0, trials: 2, passRate: { median: 0, min: 0, max: 0 }, modelErrors: 0, quotaHolds: 0 } });
  assert.equal(report.verdict, undefined);
  assert.equal(report.variant, undefined);
});

test('T1-EVAL-VARIANT card rule: a case whose prompt or checks differ at the variant runs from the HEAD copy on both sides, and the report notes it', async () => {
  const { cwd, first } = twoCommits();
  const evalsDir = path.join(cwd, 'evals');
  mkdirSync(evalsDir);
  writeFileSync(path.join(evalsDir, 'hello.json'), JSON.stringify({ id: 'hello', prompt: 'do it', checks: [{ type: 'contains', file: 'note.txt', text: 'hello' }] }));
  git(cwd, 'add', 'evals');
  git(cwd, 'commit', '-q', '-m', 'cases');
  const third = git(cwd, 'rev-parse', 'HEAD').stdout.trim();
  const cases = loadEvals(evalsDir);
  const differs = sidesProvider();
  const noted = await runTrials(cases, differs.provider, { cwd, trials: 1, variant: first, runner, dir: evalsDir });
  assert.deepEqual(noted.cases.map((c) => c.note), ['the prompt or checks differ at the ref; both sides ran the HEAD copy']);
  assert.equal(differs.notes.length, 2, 'the case still ran on both sides');
  const same = await runTrials(cases, sidesProvider().provider, { cwd, trials: 1, variant: third, runner, dir: evalsDir });
  assert.deepEqual(same.cases.map((c) => c.note), [undefined]);
});

test('T1-EVAL-VARIANT R5 (R3 decision 1, trials-in-main-checkout): --trials 2 --skip-model runs each check in a temporary checkout of HEAD, removed after the run, and a command check that writes a file leaves the working tree unchanged', async () => {
  const { cwd } = twoCommits();
  const seen: Array<{ cwd: string; stateDir?: string }> = [];
  const recording: SyncRunner = (command, args, options = {}) => {
    seen.push({ cwd: options.cwd ?? '', stateDir: options.env?.['AIDLC_STATE_DIR'] });
    return runSync(command, args, options);
  };
  const writes = EvalCase.parse({ id: 'writes', prompt: 'do it', checks: [{ type: 'command', command: [process.execPath, '-e', "require('fs').writeFileSync('written.txt', 'x')"] }, { type: 'contains', file: 'note.txt', text: 'bye' }] });
  const provider = new MockProvider();
  const report = await runTrials([writes], provider, { cwd, trials: 2, skipModel: true, runner: recording });
  assert.equal(provider.calls.length, 0, 'no model call');
  assert.deepEqual(report.total.head, { passed: 2, trials: 2, passRate: { median: 1, min: 1, max: 1 }, modelErrors: 0, quotaHolds: 0 });
  assert.equal(seen.length, 2, 'the command check ran once per trial');
  for (const s of seen) {
    assert.equal(samePath(s.cwd, cwd), false, `the check ran in ${s.cwd}, not the repository root`);
    assert.equal(existsSync(s.cwd), false, `the checkout ${s.cwd} is removed`);
    assert.ok(s.stateDir && !existsSync(s.stateDir), 'AIDLC_STATE_DIR was set and is removed');
  }
  const status = git(cwd, 'status', '--porcelain');
  assert.equal(status.status, 0);
  assert.equal(status.stdout, '', 'the working tree is unchanged');
  const listed = git(cwd, 'worktree', 'list', '--porcelain').stdout.split(/\r?\n/).filter((l) => l.startsWith('worktree '));
  assert.equal(listed.length, 1, 'no temporary checkout is left registered');
});
