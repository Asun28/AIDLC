import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EvalCase, loadEvals, realPathRule, runEval, runSuite } from '../../src/evals/runner.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import type { CompletionRequest, CompletionResult, ModelProvider, ToolCall } from '../../src/providers/types.ts';

const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });

/** A git repository with `note.txt` committed: a model-backed case runs in a temporary checkout of its HEAD. */
function setup() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aidlc-evals-'));
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

test('T1-EVAL-TRANSCRIPT acceptance 2: each tool-call check passes on tool calls that satisfy it and fails on calls that do not; the request asks for tool calls [R3] [R4]', async () => {
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

test('T1-EVAL-TRANSCRIPT acceptance 2: under skipModel each tool-call check fails with the detail no model run [R3]', async () => {
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
  test(`T1-EVAL-TRANSCRIPT acceptance 3: a model-backed case runs in a temporary checkout with an empty state directory, both removed after the run (provider ${then === 'answer' ? 'answers' : 'throws'}) [R5]`, async () => {
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

test('T1-EVAL-TRANSCRIPT acceptance 4: a prompt with a measurement word is refused naming the case and the word; whole words only; the system prompt names none [R4] [R6]', async () => {
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

test('T1-EVAL-TRANSCRIPT acceptance 5: every case under evals/agent parses, has a tool-call check and an origin naming CLAUDE.md, and loadEvals of evals/ reads none of them [R7]', () => {
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

test('T1-EVAL-TRANSCRIPT R3 decision 1 (unchecked-check-path): loadEvals refuses an absolute cwd, a ../ file and an .aidlc/ file, naming the case and the field', () => {
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

test('T1-EVAL-TRANSCRIPT R3 decision 1 (unchecked-check-path): a file or cwd through a link that leaves the working directory is refused without reading or running; a path inside still works', async () => {
  const { cwd } = setup();
  const outside = mkdtempSync(path.join(tmpdir(), 'aidlc-evals-outside-'));
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

test('T1-EVAL-TRANSCRIPT R3 decision 2 (unchecked-check-path): a file or cwd through a link inside the working directory that points at its .aidlc/ is refused without reading or running', async () => {
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

test('T1-EVAL-TRANSCRIPT R3 decision 2: realPathRule refuses a real target outside the working directory or with .aidlc as its first segment below it, on both path rules', () => {
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
