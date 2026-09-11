import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { aggregateVerdicts, enforceCitations, pathAllowed, buildPreReviewPrompt, buildReviewPrompt, classifyPreReview, collectCandidateDiff, expandCommand, extractVerdict, materialiseVerdictSchema, runPreReview, runReviewPanel } from '../../src/review/pre-review.ts';
import { run, scriptedRunner } from '../../src/probes/exec.ts';
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

test('formal review (R3) command: placeholders expand, the prompt is passed in argv when {instructions} is present and on stdin otherwise, the verdict schema is materialised', () => {
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

test('panel: perspectives run concurrently with their own prompt section and files, the round verdict aggregates quota > block > no-verdict > pass, and a non-zero exit never passes', async () => {
  const { dir, card } = fixtureCard();
  const reviewDir = path.join(dir, '.review');
  const base = { reviewPolicy: 'policy', card, base: 'main', head: 'h', changedPaths: [] as string[], diff: 'd', truncated: false, priorFindings: [] as string[] };
  const secPrompt = buildReviewPrompt({ ...base, stage: 'pre', includeDiff: true, perspective: 'security', round: 1, maxRounds: 3 });
  assert.ok(secPrompt.includes('## This pass: security'), 'perspective section');
  assert.ok(/injection|credential|PII/i.test(secPrompt), 'security guidance');
  const formal = buildReviewPrompt({ ...base, stage: 'formal', includeDiff: false, round: 1, maxRounds: 2 });
  assert.ok(/every material finding/i.test(formal) && /do not stop/i.test(formal), 'the formal pass demands exhaustiveness');
  assert.ok(!/Think briefly/.test(formal));

  const v = (verdict: 'pass' | 'block', reasons: string[] = [], axis: 'spec' | 'standards' = 'spec') => ({ verdict, reasons, axes: { spec: { verdict: verdict === 'block' && axis === 'spec' ? ('block' as const) : ('pass' as const), reasons: axis === 'spec' ? reasons : [] }, standards: { verdict: verdict === 'block' && axis === 'standards' ? ('block' as const) : ('pass' as const), reasons: axis === 'standards' ? reasons : [] } } });
  const agg = aggregateVerdicts([
    { perspective: 'bugs', outcome: 'pass', runStatus: 'success', reasons: [], verdict: v('pass') },
    { perspective: 'security', outcome: 'block', runStatus: 'success', reasons: ['[spec] 2 boundary @ a:1: leak -> fix'], verdict: v('block', ['[spec] 2 boundary @ a:1: leak -> fix']) },
    { perspective: 'compliance', outcome: 'no-verdict', runStatus: 'malformed', reasons: [] },
  ]);
  assert.equal(agg.outcome, 'block', 'a block outranks a missing verdict');
  assert.deepEqual(agg.reasons, ['[spec] 2 boundary @ a:1: leak -> fix (security)']);
  assert.equal(agg.verdict?.axes?.spec?.verdict, 'block');
  assert.equal(agg.verdict?.axes?.standards?.verdict, 'pass');
  assert.equal(aggregateVerdicts([{ perspective: 'a', outcome: 'pass', runStatus: 'success', reasons: [], verdict: v('pass') }, { perspective: 'b', outcome: 'quota-hold', runStatus: 'tool_error', reasons: [], retryAfterMs: 5000 }]).outcome, 'quota-hold');
  assert.equal(aggregateVerdicts([{ perspective: 'a', outcome: 'pass', runStatus: 'success', reasons: [], verdict: v('pass') }, { perspective: 'b', outcome: 'no-verdict', runStatus: 'malformed', reasons: [] }]).outcome, 'no-verdict');
  const allPass = aggregateVerdicts([{ perspective: 'a', outcome: 'pass', runStatus: 'success', reasons: [], verdict: v('pass') }, { perspective: 'b', outcome: 'pass', runStatus: 'success', reasons: [], verdict: v('pass') }]);
  assert.equal(allPass.outcome, 'pass');
  assert.equal(allPass.verdict?.verdict, 'pass');
  const inconsistent = aggregateVerdicts([{ perspective: 'a', outcome: 'pass', runStatus: 'success', reasons: [], verdict: { ...v('pass'), sha: 'x' } }, { perspective: 'b', outcome: 'pass', runStatus: 'success', reasons: [], verdict: { ...v('pass'), sha: 'y' } }]);
  assert.equal(inconsistent.outcome, 'no-verdict', 'perspectives that bind different candidates never pass');

  // one process per perspective, per-perspective files plus the aggregated round file; every angle
  // must have started before any angle is released, so a sequential dispatch never finishes
  const seen: string[][] = [];
  const sync = scriptedRunner({
    'fake-panel --focus security': { stdout: '{"verdict":"block","reasons":["[spec] 2 boundary @ src/gate.ts:1: token in log -> redact"],"axes":{"spec":{"verdict":"block","reasons":["token"]},"standards":{"verdict":"pass","reasons":[]}}}\n' },
    'fake-panel': { stdout: '{"verdict":"pass","reasons":[],"axes":{"spec":{"verdict":"pass","reasons":[]},"standards":{"verdict":"pass","reasons":[]}}}\n' },
  });
  const barrier = { started: 0, release: [] as Array<() => void> };
  const concurrent = async (c: string, a: string[], o: Parameters<typeof sync>[2] = {}) => {
    seen.push(a);
    barrier.started += 1;
    await new Promise<void>((resolve) => {
      barrier.release.push(resolve);
      if (barrier.started === 3) barrier.release.forEach((f) => f());
    });
    return sync(c, a, o);
  };
  const panel = await Promise.race([
    runReviewPanel({ runner: concurrent, command: ['fake-panel', '--focus', '{perspective}'], perspectives: ['bugs', 'security', 'compliance'], promptFor: (p) => `PROMPT ${p ?? 'single'}`, vars: {}, cwd: dir, timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.pre.0.1', head: 'def456', reviewer: 'fake', changedPaths: ['src/gate.ts'] }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('the three perspectives were not dispatched concurrently')), 1000)),
  ]);
  assert.equal(panel.outcome, 'block');
  assert.equal(panel.perspectives.length, 3);
  assert.deepEqual(seen.map((a) => a[1]).sort(), ['bugs', 'compliance', 'security']);
  assert.ok(panel.reasons[0]?.endsWith('(security)'), panel.reasons.join(' | '));
  for (const p of ['bugs', 'security', 'compliance']) assert.ok(existsSync(path.join(reviewDir, `T1-GATE.pre.0.1.${p}.log`)), `${p} log retained`);
  for (const p of panel.perspectives) assert.ok(p.verdictRef && existsSync(p.verdictRef), `${p.perspective} verdict retained`);
  // a quota hold on one angle holds the round; the aggregate document is still written
  const heldPanel = await runReviewPanel({ runner: async (c, a, o) => (a.includes('security') ? scriptedRunner({ 'fake-panel': { stdout: '429 Too Many Requests, retry after 30 seconds\n', exitCode: 1 } })(c, a, o) : sync(c, a, o)), command: ['fake-panel', '--focus', '{perspective}'], perspectives: ['bugs', 'security'], promptFor: () => 'P', vars: {}, cwd: dir, timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.pre.0.8', head: 'def456', reviewer: 'fake' });
  assert.equal(heldPanel.outcome, 'quota-hold');
  assert.equal(heldPanel.retryAfterMs, 30_000);
  assert.ok(heldPanel.verdictRef && existsSync(heldPanel.verdictRef), 'held round document retained');
  assert.equal((JSON.parse(readFileSync(heldPanel.verdictRef!, 'utf8')) as { outcome: string }).outcome, 'quota-hold');
  assert.ok(panel.verdictRef && existsSync(panel.verdictRef), 'aggregated round verdict written');
  const round = JSON.parse(readFileSync(panel.verdictRef!, 'utf8')) as { verdict: string; perspectives: Array<{ name: string; outcome: string }> };
  assert.equal(round.verdict, 'block');
  assert.equal(round.perspectives.find((p) => p.name === 'security')?.outcome, 'block');
  // single mode is a panel of one
  const single = await runReviewPanel({ runner: async (c, a, o) => sync(c, a, o), command: ['fake-panel'], perspectives: [], promptFor: () => 'P', vars: {}, cwd: dir, timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.pre.0.2', head: 'def456', reviewer: 'fake' });
  assert.equal(single.outcome, 'pass');
  assert.equal(single.perspectives.length, 1);

  // a panel that ends without a verdict still retains an aggregate round document
  const silent = await runReviewPanel({ runner: async (c, a, o) => scriptedRunner({ 'fake-panel': { stdout: 'no answer\n' } })(c, a, o), command: ['fake-panel', '--focus', '{perspective}'], perspectives: ['bugs', 'security'], promptFor: () => 'P', vars: {}, cwd: dir, timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.pre.0.3', head: 'def456', reviewer: 'fake' });
  assert.equal(silent.outcome, 'no-verdict');
  assert.ok(silent.verdictRef && existsSync(silent.verdictRef), 'aggregate document retained on failure too');
  assert.equal((JSON.parse(readFileSync(silent.verdictRef!, 'utf8')) as { outcome: string }).outcome, 'no-verdict');

  // perspective names are filenames: unsafe or duplicate names are refused before anything runs
  await assert.rejects(() => runReviewPanel({ runner: async (c, a, o) => sync(c, a, o), command: ['fake-panel'], perspectives: ['bugs', '../escape'], promptFor: () => 'P', vars: {}, cwd: dir, timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.pre.0.4', head: 'def456', reviewer: 'fake' }), /perspective/);
  await assert.rejects(() => runReviewPanel({ runner: async (c, a, o) => sync(c, a, o), command: ['fake-panel'], perspectives: ['bugs', 'bugs'], promptFor: () => 'P', vars: {}, cwd: dir, timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.pre.0.5', head: 'def456', reviewer: 'fake' }), /perspective/);

  // dynamic instructions never go through a shell, even when a shell was requested for the command
  const shells: Array<boolean | undefined> = [];
  runPreReview({ runner: (c, a, o = {}) => { shells.push(o.shell); return sync(c, a, o); }, command: ['fake-panel', '{instructions}'], cwd: dir, prompt: 'P `rm -rf` $(x)', timeoutMs: 1000, shell: true, reviewDir, fileStem: 'T1-GATE.pre.0.6', head: 'def456', reviewer: 'fake' });
  assert.equal(shells[0], false, 'argv instructions force shell=false');

  // a reviewer that fails to spawn or dies on stdin is a failed receipt for that angle; the round still aggregates
  const crashing = async (c: string, a: string[], o: Parameters<typeof sync>[2] = {}) => {
    if (a.includes('security')) throw new Error('spawn EPIPE');
    return sync(c, a, o);
  };
  const partial = await runReviewPanel({ runner: crashing, command: ['fake-panel', '--focus', '{perspective}'], perspectives: ['bugs', 'security'], promptFor: () => 'P', vars: {}, cwd: dir, timeoutMs: 1000, shell: false, reviewDir, fileStem: 'T1-GATE.pre.0.7', head: 'def456', reviewer: 'fake' });
  assert.equal(partial.outcome, 'no-verdict');
  const crashed = partial.perspectives.find((p) => p.perspective === 'security');
  assert.equal(crashed?.runStatus, 'tool_error');
  assert.ok(crashed?.logRef && existsSync(crashed.logRef), 'the failed angle still has a retained receipt');
  assert.equal(partial.perspectives.find((p) => p.perspective === 'bugs')?.outcome, 'pass');

  // the candidate diff is collected as text so a file that was binary on the base still shows its hunks
  const diffArgs: string[][] = [];
  collectCandidateDiff((c, a, o = {}) => { diffArgs.push(a); return scriptedRunner({ 'git diff --name-only': { stdout: 'src/a.ts' }, 'git diff': { stdout: 'x' } })(c, a, o); }, dir, 'main', 100);
  assert.ok(diffArgs.some((a) => a.includes('--text')), 'git diff runs with --text');

  // fail-closed: a reviewer that exits non-zero never passes, even with a pass document on stdout
  const bad = classifyPreReview({ verdict: 'pass', reasons: [] }, { exitCode: 1, timedOut: false, stdout: '{"verdict":"pass","reasons":[]}', stderr: 'boom' });
  assert.equal(bad.outcome, 'no-verdict');
  assert.equal(bad.runStatus, 'tool_error');
  // a document that reports its own failure keeps that status, even from a process that exited 0
  const selfReported = classifyPreReview({ verdict: 'pass', reasons: [], run_status: 'tool_error' }, { exitCode: 0, timedOut: false, stdout: '{}', stderr: '' });
  assert.equal(selfReported.outcome, 'no-verdict');
  assert.equal(selfReported.runStatus, 'tool_error');
});

test('scope gate: allow_paths match exact paths, directory prefixes and globs, nothing else', () => {
  assert.equal(pathAllowed('src/a.ts', ['src/a.ts']), true);
  assert.equal(pathAllowed('src/b.ts', ['src/a.ts']), false);
  assert.equal(pathAllowed('docs/adr/0001.md', ['docs/']), true);
  assert.equal(pathAllowed('docs/adr/0001.md', ['docs/...']), true);
  assert.equal(pathAllowed('tests/x/y.test.ts', ['tests/**/*.test.ts']), true);
  assert.equal(pathAllowed('tests/x/y.ts', ['tests/**/*.test.ts']), false);
  assert.equal(pathAllowed('src/loop/a.ts', ['src/*.ts']), false);
  assert.equal(pathAllowed('src/a.ts', ['src/**']), true, 'a terminal ** matches a direct child');
  assert.equal(pathAllowed('src/x/a.ts', ['src/**']), true, 'a terminal ** matches nested paths');
  assert.equal(pathAllowed('docs/a.md', ['src/**']), false);
  assert.equal(pathAllowed(String.raw`src\loop\a.ts`, ['src/loop/a.ts']), true);
});

test('citation rule: a block reason without an axis tag and a diff location is advisory and never blocks', () => {
  const cited = '[spec] 6 tests @ src/a.ts:1: no RED -> add a failing test first';
  const mixed = enforceCitations({ verdict: 'block', reasons: [cited, 'this feels risky', '[standards] vague concern without a location'], axes: { spec: { verdict: 'block', reasons: ['tests'] }, standards: { verdict: 'block', reasons: ['vague'] } } });
  assert.equal(mixed.verdict.verdict, 'block');
  assert.deepEqual(mixed.verdict.reasons, [cited]);
  assert.equal(mixed.verdict.axes?.spec?.verdict, 'block');
  assert.equal(mixed.verdict.axes?.standards?.verdict, 'pass', 'an axis with no cited reason left does not block');
  assert.deepEqual(mixed.advisory, ['this feels risky', '[standards] vague concern without a location', 'tests', 'vague'], 'uncited root and axis reasons are all advisory');
  const downgraded = enforceCitations({ verdict: 'block', reasons: ['the design could be cleaner'], axes: { spec: { verdict: 'block', reasons: [] }, standards: { verdict: 'pass', reasons: [] } } });
  assert.equal(downgraded.verdict.verdict, 'pass');
  assert.deepEqual(downgraded.advisory, ['the design could be cleaner']);
  assert.deepEqual(enforceCitations({ verdict: 'pass', reasons: [] }).advisory, []);
  // punctuation is not a location; a location must name a changed path when the paths are known
  assert.equal(enforceCitations({ verdict: 'block', reasons: ['[spec] 6 missing test @ -> add test'] }).verdict.verdict, 'pass');
  assert.equal(enforceCitations({ verdict: 'block', reasons: ['[spec] 6 tests @ src/other.ts:1: no test -> add'] }, ['src/a.ts']).verdict.verdict, 'pass', 'a path outside the diff is advisory');
  assert.equal(enforceCitations({ verdict: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: no test -> add'] }, ['src/a.ts']).verdict.verdict, 'block');
  // a cited reason on an axis keeps the block even when the top-level list is empty
  const axisOnly = enforceCitations({ verdict: 'block', reasons: [], axes: { spec: { verdict: 'block', reasons: ['[spec] 6 tests @ src/a.ts:1: no test -> add'] }, standards: { verdict: 'pass', reasons: [] } } });
  assert.equal(axisOnly.verdict.verdict, 'block');
  assert.equal(axisOnly.verdict.reasons.length, 1);
  // a document whose top-level verdict contradicts its axes is malformed, never merged
  assert.equal(enforceCitations({ verdict: 'pass', reasons: [], axes: { spec: { verdict: 'block', reasons: ['[spec] 1 scope @ src/a.ts:1: x -> y'] }, standards: { verdict: 'pass', reasons: [] } } }).inconsistent, true);
  // a block whose axes both pass contradicts itself too
  assert.equal(enforceCitations({ verdict: 'block', reasons: ['[spec] 1 scope @ src/a.ts:1: x -> y'], axes: { spec: { verdict: 'pass', reasons: [] }, standards: { verdict: 'pass', reasons: [] } } }).inconsistent, true);
  // dot-leading and non-ASCII paths are locations too; bare punctuation is not
  assert.equal(enforceCitations({ verdict: 'block', reasons: ['[spec] 14 scope @ .claude/skills/aidlc-loop/card-loop.md:70: x -> y'] }, ['.claude/skills/aidlc-loop/card-loop.md']).verdict.verdict, 'block');
  assert.equal(enforceCitations({ verdict: 'block', reasons: ['[spec] 1 scope @ src/测试.ts:3: x -> y'] }, ['src/测试.ts']).verdict.verdict, 'block');
  assert.equal(enforceCitations({ verdict: 'block', reasons: ['[spec] 6 tests @ -> add'] }).verdict.verdict, 'pass');
  // enforced where the verdict is classified, not in the prompt
  const r = runPreReview({ runner: scriptedRunner({ 'fake-reviewer': { stdout: '{"verdict":"block","reasons":["I would refactor this module"]}\n' } }), command: ['fake-reviewer'], cwd: fixtureCard().dir, prompt: 'P', timeoutMs: 1000, shell: false, reviewDir: path.join(fixtureCard().dir, '.review'), fileStem: 'T1-GATE.pre.0.9', head: 'def456', reviewer: 'fake' });
  assert.equal(r.outcome, 'pass');
  assert.deepEqual(r.advisory, ['I would refactor this module']);
});

test('the async runner survives a child that exits before reading its input, and this repository configures the review stages as the card states', async () => {
  const receipt = await run(process.execPath, ['-e', 'process.exit(3)'], { input: 'x'.repeat(2_000_000), timeoutMs: 20_000 });
  assert.equal(receipt.exitCode, 3, 'the receipt carries the exit code instead of an uncaught EPIPE');
  assert.equal(receipt.timedOut, false);
  const cfg = JSON.parse(readFileSync(path.resolve('aidlc.config.json'), 'utf8')) as { preReview: { perspectives: string[] }; formalReview: Record<string, unknown>; gateRequired: boolean };
  assert.deepEqual(cfg.preReview.perspectives, ['ac-coverage', 'spec-deviations', 'edge-cases']);
  assert.equal('perspectives' in cfg.formalReview, false, 'the formal review is never fanned out');
  assert.equal(cfg.gateRequired, true);
  const tpl = JSON.parse(readFileSync(path.resolve('templates/aidlc.config.json'), 'utf8')) as { preReview: { perspectives: string[]; command: string[] }; formalReview: { command: string[] } };
  assert.deepEqual(tpl.preReview.perspectives, []);
  assert.deepEqual(tpl.preReview.command, []);
  assert.deepEqual(tpl.formalReview.command, []);
  for (const id of ['T0-R3-COMMAND', 'T0-R2-PANEL']) assert.match(readFileSync(path.resolve(`specs/tasks/${id}.md`), 'utf8'), /^status: in-progress$/m, `${id} is not pre-set to merged`);
});
