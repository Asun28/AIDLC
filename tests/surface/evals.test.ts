import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EvalCase, evalFromIncident, loadEvals, runEval, runSuite } from '../../src/evals/runner.ts';
import { MockProvider } from '../../src/providers/mock.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';

function setup() {
  const cwd = mkdtempSync(path.join(tmpdir(), 'aidlc-evals-'));
  const evalsDir = path.join(cwd, 'evals');
  writeFileSync(path.join(cwd, 'note.txt'), 'hello world', 'utf8');
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

test('evalFromIncident produces a regression eval with a command check', () => {
  const e = evalFromIncident('inc-42', 'reproduce the 500 on /claims', ['npm', 'test', '--', 'claims'], 'incident:2026-09-11');
  assert.equal(e.dimension, 'regression');
  assert.equal(e.origin, 'incident:2026-09-11');
  assert.equal(e.checks[0]?.type, 'command');
  assert.equal(e.checks[0]?.type === 'command' ? e.checks[0].expectExit : -1, 0);
});
