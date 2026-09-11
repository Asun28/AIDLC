import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPreReviewPrompt, buildReviewPrompt, classifyPreReview, collectCandidateDiff, expandCommand, extractVerdict, materialiseVerdictSchema, runPreReview } from '../../src/review/pre-review.ts';
import { scriptedRunner } from '../../src/probes/exec.ts';
import { loadCardRegistry, renderCard } from '../../src/artifacts/card.ts';

function fixtureCard() {
  const dir = mkdtempSync(path.join(tmpdir(), 'aidlc-prereview-'));
  const cards = path.join(dir, 'specs', 'tasks');
  mkdirSync(cards, { recursive: true });
  writeFileSync(path.join(cards, 'T1-GATE.md'), renderCard({ id: 'T1-GATE', title: 'gate the ship', allowPaths: ['src/gate.ts'], dodCommand: 'node --test tests/gate.test.ts', acceptance: ['1. the gate holds. [dod arm 1]'], deliverable: 'gate', worktreeRoot: path.join(dir, 'wt') }));
  const card = loadCardRegistry(cards).cards[0]!.card;
  return { dir, card };
}

const REASONING = '=== reasoning ===\r\nThe diff adds a gate. Checking dimensions 1-6...\r\n=== answer ===\r\nFindings: none.\r\n';

test('extractVerdict takes the last JSON verdict line and ignores reasoning noise', () => {
  const pass = extractVerdict(REASONING + '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\r\n');
  assert.equal(pass?.verdict, 'pass');
  const block = extractVerdict('prose {"verdict":"pass"} earlier\n```json\n{"verdict":"block","reasons":["[spec] 6 tests @ src/gate.ts:1: no RED -> add a failing test first"]}\n```\n');
  assert.equal(block?.verdict, 'block');
  assert.equal(block?.reasons.length, 1);
  assert.equal(extractVerdict('no json here\n{"verdict":"maybe"}'), undefined);
  assert.equal(extractVerdict(''), undefined);
});

test('buildPreReviewPrompt carries the policy, the card contract, the findings to verify and the diff, and demands one JSON last line', () => {
  const { card } = fixtureCard();
  const prompt = buildPreReviewPrompt({ reviewPolicy: '# Review instructions\nMust-block 1-6.', card, base: 'main@abc', head: 'def456', changedPaths: ['src/gate.ts'], diff: 'diff --git a/src/gate.ts b/src/gate.ts\n+export const gate = 1;\n', truncated: false, priorFindings: ['[spec] 6 tests @ src/gate.ts:1: no RED -> add a failing test first'], round: 2, maxRounds: 3 });
  for (const needle of ['Must-block 1-6.', 'T1-GATE', 'src/gate.ts', '1. the gate holds.', 'no RED -> add a failing test first', '+export const gate = 1;', 'round 2 of 3', '"verdict":"pass|block"']) {
    assert.ok(prompt.includes(needle), `prompt must include ${needle}`);
  }
  assert.ok(prompt.indexOf('## Diff') > prompt.indexOf('## Findings to verify'), 'the diff comes after the findings to verify');
});

test('runPreReview classifies pass, block, malformed and quota output and writes verdict + log files', () => {
  const { dir } = fixtureCard();
  const reviewDir = path.join(dir, '.review');
  const cases: Array<[string, string, string]> = [
    ['pass', REASONING + '{"verdict":"pass","reasons":[]}\n', 'pass'],
    ['block', '{"verdict":"block","reasons":["[spec] 1 out of scope @ src/other.ts:3: outside allow_paths -> revert"]}\n', 'block'],
    ['malformed', 'I could not decide.\n', 'no-verdict'],
    ['quota', 'Error: 429 Too Many Requests, retry after 30 seconds\n', 'quota-hold'],
  ];
  for (const [name, stdout, expected] of cases) {
    const runner = scriptedRunner({ 'fake-reviewer': { stdout, exitCode: name === 'quota' ? 1 : 0 } });
    const r = runPreReview({ runner, command: ['fake-reviewer', '--model', 'x'], cwd: dir, prompt: 'PROMPT', timeoutMs: 1000, shell: false, reviewDir, fileStem: `T1-GATE.pre.0.${name}`, head: 'def456', reviewer: 'fake' });
    assert.equal(r.outcome, expected, name);
    assert.ok(existsSync(r.logRef), `${name}: log written`);
    if (expected === 'pass' || expected === 'block') {
      assert.ok(r.verdictRef && existsSync(r.verdictRef), `${name}: verdict written`);
      const saved = JSON.parse(readFileSync(r.verdictRef!, 'utf8')) as { sha: string; verdict: string };
      assert.equal(saved.sha, 'def456');
      assert.equal(saved.verdict, expected);
      assert.equal(r.runStatus, 'success');
    } else {
      assert.equal(r.verdict, undefined);
    }
  }
  assert.equal(classifyPreReview(undefined, { exitCode: 0, timedOut: true, stdout: '', stderr: '' }).runStatus, 'timeout');
  assert.equal(classifyPreReview(undefined, { exitCode: 1, timedOut: false, stdout: 'Error: 429 Too Many Requests, retry after 30 seconds', stderr: '' }).retryAfterMs, 30_000);
  const diff = collectCandidateDiff(scriptedRunner({ 'git diff --name-only': { stdout: 'src/gate.ts\nsrc/x.ts\n' }, 'git diff': { stdout: 'x'.repeat(50) } }), dir, 'main', 20);
  assert.deepEqual(diff.changedPaths, ['src/gate.ts', 'src/x.ts']);
  assert.equal(diff.truncated, true);
  assert.ok(diff.diff.length < 60);
});

test('formal review (R3) command: placeholders expand, the prompt rides in argv when {instructions} is present and on stdin otherwise, the verdict schema is materialised', () => {
  const { dir, card } = fixtureCard();
  const reviewDir = path.join(dir, '.review');
  const schema = materialiseVerdictSchema(reviewDir);
  assert.ok(existsSync(schema) && schema.endsWith('verdict.schema.json'));
  const parsed = JSON.parse(readFileSync(schema, 'utf8')) as { required: string[]; properties: { verdict: { enum: string[] } } };
  assert.deepEqual(parsed.properties.verdict.enum, ['pass', 'block']);
  assert.ok(parsed.required.includes('axes'));

  const expanded = expandCommand(['codex', 'exec', '--output-schema', '{schema}', '-C', '{cwd}', '{instructions}'], { schema, cwd: dir, instructions: 'REVIEW THIS', base: 'main', head: 'abc', card: 'T1-GATE' });
  assert.deepEqual(expanded.argv, ['codex', 'exec', '--output-schema', schema, '-C', dir, 'REVIEW THIS']);
  assert.equal(expanded.promptInArgv, true);
  assert.equal(expandCommand(['deepseek', '--model', 'x'], { instructions: 'p' }).promptInArgv, false);

  // argv mode: the scripted reviewer sees the instructions as an argument and an empty stdin
  const seen: Array<{ args: string[]; input?: string }> = [];
  const argvRunner: typeof scriptedRunner extends (s: infer S) => infer R ? R : never = (command, args, options = {}) => {
    seen.push({ args, input: options.input });
    const base = scriptedRunner({ [command]: { stdout: '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n' } });
    return base(command, args, options);
  };
  const r = runPreReview({ runner: argvRunner, command: ['fake-r3', '--output-schema', '{schema}', '{instructions}'], vars: { schema, instructions: 'INSTRUCTIONS' }, cwd: dir, prompt: 'INSTRUCTIONS', timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.r3.0.1', head: 'def456', reviewer: 'fake-r3' });
  assert.equal(r.outcome, 'pass');
  assert.deepEqual(seen[0]?.args, ['--output-schema', schema, 'INSTRUCTIONS']);
  assert.equal(seen[0]?.input, '', 'argv mode closes stdin');
  // stdin mode: no {instructions} placeholder, the prompt arrives on stdin
  runPreReview({ runner: argvRunner, command: ['fake-r3', '--model', 'x'], cwd: dir, prompt: 'STDIN PROMPT', timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.r3.0.2', head: 'def456', reviewer: 'fake-r3' });
  assert.equal(seen[1]?.input, 'STDIN PROMPT');

  // the formal prompt without an embedded diff tells the reviewer where to look instead
  const formal = buildReviewPrompt({ stage: 'formal', includeDiff: false, reviewPolicy: 'policy', card, base: 'main', head: 'def456', changedPaths: ['src/gate.ts'], diff: 'SHOULD NOT APPEAR', truncated: false, priorFindings: [], round: 1, maxRounds: 2 });
  assert.ok(formal.includes('formal reviewer (R3)'));
  assert.ok(formal.includes('git diff main...HEAD'));
  assert.ok(!formal.includes('SHOULD NOT APPEAR'));
});
