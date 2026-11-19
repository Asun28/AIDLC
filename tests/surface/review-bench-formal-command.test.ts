import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as bench from '../../src/review/bench.ts';
import { renderCard } from '../../src/artifacts/card.ts';
import { runSync, scriptedRunner, type ExecReceipt, type Runner } from '../../src/probes/exec.ts';
import { tmpDir } from '../infra/helpers.ts';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const FIXED = '2026-11-19T01:00:00Z';
const CARD_ID = 'T1-FORMAL-FIX';
const CARD_PATH = `specs/tasks/${CARD_ID}.md`;

function git(cwd: string, args: string[]): string {
  const r = runSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, env: { ...process.env, GIT_AUTHOR_DATE: FIXED, GIT_COMMITTER_DATE: FIXED } });
  assert.equal(r.exitCode, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

const calc = (change: Record<number, string> = {}) => Array.from({ length: 30 }, (_, i) => change[i + 1] ?? `export const v${i + 1} = ${i + 1};`).join('\n') + '\n';
const cardText = renderCard({ id: CARD_ID, title: 'fix calc', allowPaths: ['src/calc.ts', CARD_PATH], dodCommand: 'npm test', acceptance: ['1. calc returns the right values'], deliverable: 'calc' });

/** The configured formal reviewer, with a fallback and a base-sync reviewer the bench must never run under --formal-command. */
const FORMAL = {
  command: ['cfg-codex', '{head}', '--effort', '{effort}', '--schema', '{schema}'],
  reviewer: 'cfg-codex',
  shell: false,
  timeoutMs: 9999,
  effort: { default: 'medium' },
  fallback: { command: ['cfg-opus', '{head}'], reviewer: 'cfg-opus', shell: false },
  baseSync: { command: ['cfg-base-sync', '{head}'], reviewer: 'cfg-base-sync', shell: false },
};
const PRE = { command: ['cfg-r2', '{head}'], reviewer: 'cfg-r2', shell: false };

interface Fixture {
  root: string;
  tmpRoot: string;
  dir: string;
  cleanup: () => void;
}

/** One base commit and one candidate changing line 13 of src/calc.ts, with one confirmed bug case at that line. */
function fixture(): Fixture {
  const tmp = realpathSync.native(tmpDir('aidlc-formal-command-'));
  const root = path.join(tmp, 'repo');
  const tmpRoot = path.join(tmp, 'tmp');
  mkdirSync(path.join(root, 'src'), { recursive: true });
  mkdirSync(tmpRoot);
  git(root, ['init', '-q', '-b', 'main']);
  writeFileSync(path.join(root, 'src', 'calc.ts'), calc());
  writeFileSync(path.join(root, 'REVIEW.md'), '# Review policy\n\nBlock on wrong values.\n');
  writeFileSync(path.join(root, 'aidlc.config.json'), JSON.stringify({ formalReview: FORMAL, preReview: PRE }, null, 2) + '\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', '--detach', base]);
  writeFileSync(path.join(root, 'src', 'calc.ts'), calc({ 13: 'export const v13 = 14;' }));
  mkdirSync(path.join(root, 'specs', 'tasks'), { recursive: true });
  writeFileSync(path.join(root, CARD_PATH), cardText);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change line 13']);
  const candidate = git(root, ['rev-parse', 'HEAD']);
  git(root, ['checkout', '-q', 'main']);
  const dir = path.join('evals', 'cases');
  mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, dir, 'a-bug.json'), JSON.stringify({ kind: 'bug', id: 'a-bug', candidate, base, card: { id: CARD_ID, path: CARD_PATH }, confirmed: true, confirmedBy: 't', origin: 'fixture', expected: [{ file: 'src/calc.ts', line: 13, window: 0, class: 'dim-2' }] }));
  mkdirSync(path.join(root, 'bench'));
  return { root, tmpRoot, dir, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

const HIT = '[spec] [P0] 2 wrong value @ src/calc.ts:13: v13 is 14 -> restore 13';
const BLOCK_JSON = JSON.stringify({ verdict: 'block', reasons: [HIT], axes: { spec: { verdict: 'block', reasons: [] }, standards: { verdict: 'pass', reasons: [] } } });

interface Call {
  command: string;
  args: string[];
  timeoutMs?: number;
}

/** Every call gets the same reply; each call's argv is recorded. */
function replying(reply: Partial<ExecReceipt>, calls: Call[]): Runner {
  return async (command, args, options = {}) => {
    calls.push({ command, args, timeoutMs: options.timeoutMs });
    return scriptedRunner({ [command]: reply })(command, args, options);
  };
}

async function runBench(fx: Fixture, stage: 'pre' | 'formal', extra: Record<string, unknown>, reply: Partial<ExecReceipt> = { stdout: `${BLOCK_JSON}\n` }) {
  const calls: Call[] = [];
  const report = await bench.runReviewBench({ root: fx.root, stage, dir: fx.dir, runner: replying(reply, calls), tmpRoot: fx.tmpRoot, ...extra } as bench.ReviewBenchOptions);
  return { report, calls };
}

const FABLE = { command: ['fable', '{head}', '--effort', '{effort}', '--schema', '{schema}'], reviewer: 'fable-r3', timeoutMs: 4321, effort: { default: 'high' } };
const optionsOf = (r: unknown) => (r as { options: Record<string, unknown> }).options;
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('T1-BENCH-FORMAL-COMMAND acceptance 1: the file\'s command and reviewer review a formal case and the report names them', async () => {
  const fx = fixture();
  try {
    const given = path.join('bench', 'fable.json');
    writeFileSync(path.join(fx.root, given), JSON.stringify(FABLE, null, 2) + '\n');
    const configBytes = readFileSync(path.join(fx.root, 'aidlc.config.json'));

    const own = await runBench(fx, 'formal', { formalCommand: given });
    assert.equal(own.calls.length, 1);
    const call = own.calls[0]!;
    assert.equal(call.command, 'fable');
    assert.deepEqual([call.args[1], call.args[2], call.args[3]], ['--effort', 'high', '--schema'], 'the file\'s argv with the file\'s effort');
    assert.equal(call.timeoutMs, 4321);
    assert.equal(own.report.cases[0]!.outcome, 'hit');
    assert.equal(own.report.reviewer, 'fable-r3');
    assert.deepEqual(optionsOf(own.report).formalCommand, { path: given, sha256: sha256(path.join(fx.root, given)) });
    assert.deepEqual(readFileSync(path.join(fx.root, 'aidlc.config.json')), configBytes, 'no configuration is written');

    // Without the option the configured reviewer runs and the report has no formalCommand.
    const plain = await runBench(fx, 'formal', {});
    assert.equal(plain.calls[0]!.command, 'cfg-codex');
    assert.equal(plain.report.reviewer, 'cfg-codex');
    assert.equal('formalCommand' in optionsOf(plain.report), false);

    // The CLI passes --formal-command through: a run that selects no case still reports its options and reviewer.
    mkdirSync(path.join(fx.root, 'evals', 'empty'));
    const cli = spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), '-C', fx.root, 'review', 'bench', 'run', '--dir', path.join('evals', 'empty'), '--stage', 'formal', '--formal-command', given, '--json'], { encoding: 'utf8', windowsHide: true });
    assert.equal(cli.status, 0, cli.stderr);
    const cliReport = JSON.parse(cli.stdout) as { reviewer: string };
    assert.equal(cliReport.reviewer, 'fable-r3');
    assert.deepEqual(optionsOf(cliReport).formalCommand, { path: given, sha256: sha256(path.join(fx.root, given)) });
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-FORMAL-COMMAND acceptance 2: a quota hold under --formal-command is no-verdict and no fallback argv runs', async () => {
  const fx = fixture();
  try {
    const given = path.join('bench', 'fable.json');
    writeFileSync(path.join(fx.root, given), JSON.stringify(FABLE));
    const held = await runBench(fx, 'formal', { formalCommand: given, trials: 2 }, { exitCode: 1, stderr: 'usage limit reached\n' });
    assert.deepEqual(held.calls.map((c) => c.command), ['fable'], 'one review by the file\'s reviewer, none by another');
    assert.deepEqual(held.report.trialResults.map((t) => t.cases.map((c) => c.outcome)), [['no-verdict'], ['no-verdict']]);
    assert.equal(held.report.reviewer, 'fable-r3');
  } finally {
    fx.cleanup();
  }
});

test('T1-BENCH-FORMAL-COMMAND acceptance 3: each refusal of R1 and R2 happens before any review and names the option or the file', async () => {
  const fx = fixture();
  try {
    const good = path.join('bench', 'good.json');
    writeFileSync(path.join(fx.root, good), JSON.stringify({ command: ['fable', '{head}'], reviewer: 'fable-r3' }));
    const malformed: Record<string, string> = {
      'not-json.json': '{"command": [',
      'array.json': JSON.stringify([]),
      'no-command.json': JSON.stringify({ reviewer: 'f' }),
      'empty-command.json': JSON.stringify({ command: [], reviewer: 'f' }),
      'blank-arg.json': JSON.stringify({ command: ['fable', ' '], reviewer: 'f' }),
      'no-reviewer.json': JSON.stringify({ command: ['fable'] }),
      'blank-reviewer.json': JSON.stringify({ command: ['fable'], reviewer: '  ' }),
      'bad-timeout.json': JSON.stringify({ command: ['fable'], reviewer: 'f', timeoutMs: 0 }),
      'bad-diff.json': JSON.stringify({ command: ['fable'], reviewer: 'f', maxDiffBytes: 1.5 }),
      'bad-effort.json': JSON.stringify({ command: ['fable'], reviewer: 'f', effort: { default: 'extreme' } }),
      'unknown-key.json': JSON.stringify({ command: ['fable'], reviewer: 'f', fallback: { command: ['opus'], reviewer: 'opus' } }),
    };
    for (const [name, text] of Object.entries(malformed)) writeFileSync(path.join(fx.root, 'bench', name), text);

    const refused = async (stage: 'pre' | 'formal', extra: Record<string, unknown>, pattern: RegExp) => {
      const calls: Call[] = [];
      await assert.rejects(bench.runReviewBench({ root: fx.root, stage, dir: fx.dir, runner: replying({ stdout: `${BLOCK_JSON}\n` }, calls), tmpRoot: fx.tmpRoot, ...extra } as bench.ReviewBenchOptions), pattern, JSON.stringify(extra));
      assert.equal(calls.length, 0, `no review: ${JSON.stringify(extra)}`);
    };
    await refused('pre', { formalCommand: good }, /--formal-command needs --stage formal/);
    await refused('formal', { preCommand: good }, /--pre-command needs --stage pre/);
    await refused('formal', { formalCommand: path.join('bench', 'absent.json') }, /--formal-command .*absent\.json: no such file/);
    for (const name of Object.keys(malformed)) await refused('formal', { formalCommand: path.join('bench', name) }, new RegExp(`--formal-command .*${name.replace('.', '\\.')}`));

    const cli = (...args: string[]) => spawnSync(process.execPath, [path.join(repoRoot, 'src', 'cli', 'main.ts'), '-C', fx.root, 'review', 'bench', 'run', '--dir', fx.dir, ...args], { encoding: 'utf8', windowsHide: true });
    const pre = cli('--stage', 'pre', '--formal-command', good);
    assert.notEqual(pre.status, 0);
    assert.match(pre.stderr, /--formal-command needs --stage formal/);
    const absent = cli('--stage', 'formal', '--formal-command', path.join('bench', 'absent.json'));
    assert.notEqual(absent.status, 0);
    assert.match(absent.stderr, /--formal-command .*absent\.json/);
  } finally {
    fx.cleanup();
  }
});
