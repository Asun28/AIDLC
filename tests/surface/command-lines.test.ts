// Cards T1-SWEEP-FLAGS-2 (successor of T1-SWEEP-FLAGS) and T1-EVALS-NO-KEY: the eval workflow, the shipped command lines and the env var docs match what the CLI declares and reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => readFileSync(path.join(root, rel), 'utf8');
/** Line breaks and indentation collapsed, so a sentence wrapped across lines reads as one. */
const flat = (rel: string): string => read(rel).replace(/\s+/g, ' ');

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['.claude/agents/release-specialist.md', 'templates/claude/agents/release-specialist.md'],
  ['.claude/skills/aidlc-loop/release.md', 'templates/claude/skills/aidlc-loop/release.md'],
  ['.claude/skills/aidlc-loop/card-loop.md', 'templates/claude/skills/aidlc-loop/card-loop.md'],
];
const FILES = ['CLAUDE.md', 'templates/CLAUDE.aidlc.md', ...PAIRS.flat()];

/** Every inline code span of a Markdown text, fenced blocks removed and whitespace collapsed. */
function spans(text: string): string[] {
  return [...text.replace(/```[\s\S]*?```/g, '').matchAll(/`([^`]+)`/g)].map((m) => m[1]!.replace(/\s+/g, ' ').trim());
}

/** The step of a workflow whose `- name:` (or `- run:`/`- uses:`) line matches `opening`, as its trimmed lines. */
function step(workflow: string, opening: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === `- ${opening}`);
  assert.ok(at >= 0, `step ${opening}`);
  const indent = lines[at]!.indexOf('-');
  const out = [lines[at]!.trim()];
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === '' || l.search(/\S/) <= indent) break;
    out.push(l.trim());
  }
  return out;
}

// T1-EVALS-NO-KEY replaced the T1-SWEEP-FLAGS-2 acceptance 1 test here: the key-gated claude-code steps it pinned are gone (user ruling 2026-10-12).
test('T1-EVALS-NO-KEY acceptance 1: the eval job runs the deterministic checks with no key, no Claude Code install and no skip step [R1]', () => {
  const live = read('.github/workflows/agent-evals.yml');
  assert.equal(read('templates/github/workflows/agent-evals.yml'), live);
  assert.deepEqual(step(live, 'name: Run eval checks'), ['- name: Run eval checks', 'run: npx --no-install aidlc evals run --skip-model --threshold 0.9 --json > evals-result.json']);
  assert.ok(!/^ {4}env:$/m.test(live), 'the evals job sets no env');
  for (const gone of ['ANTHROPIC_API_KEY', 'HAS_ANTHROPIC_KEY', 'claude-code', 'AIDLC_PROVIDER', 'Install Claude Code', 'Evals skipped']) assert.ok(!live.includes(gone), `the workflow names ${gone}`);
  assert.equal(live.split(/\r?\n/).filter((l) => l.includes('npx --no-install aidlc evals run')).length, 1, 'one eval run');
});

test('T1-EVALS-NO-KEY acceptance 2: the evals READMEs and the OPERATIONS Evals section name the CI run with no model and the local run on the Claude Code CLI login [R2]', () => {
  assert.equal(read('templates/evals/README.md'), read('evals/README.md'));
  const ops = flat('docs/OPERATIONS.md');
  const section = ops.slice(ops.indexOf('## Evals '), ops.indexOf('## Audit '));
  for (const [name, text] of [['evals/README.md', flat('evals/README.md')], ['the OPERATIONS Evals section', section]] as const) {
    for (const needle of ['aidlc evals run --skip-model --threshold 0.9', 'aidlc evals run --provider claude-code --threshold 0.9', 'Claude Code CLI login']) assert.ok(text.includes(needle), `${name} names ${needle}`);
  }
});

test('T1-EVALS-NO-KEY acceptance 3: the CHANGELOG Unreleased section names the card and T1-SWEEP-FLAGS-2 [R3]', () => {
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.match(unreleased, /^- T1-EVALS-NO-KEY: .*T1-SWEEP-FLAGS-2/m);
});

test('T1-SWEEP-FLAGS-2 acceptance 2: no shipped command line names an option its command does not declare [R2]', () => {
  for (const [live, template] of PAIRS) assert.equal(read(template), read(live), `${template} is the copy of ${live}`);
  for (const file of FILES) {
    for (const span of spans(read(file))) {
      if (span.startsWith('aidlc release start')) assert.ok(!span.includes('--target'), `${file}: \`${span}\``);
      if (span.startsWith('aidlc card report')) assert.ok(!span.includes('--result'), `${file}: \`${span}\``);
    }
  }
  const release = FILES.filter((f) => read(f).includes('aidlc release start'));
  assert.deepEqual(release, ['CLAUDE.md', 'templates/CLAUDE.aidlc.md', ...PAIRS.slice(0, 2).flat()]);
  for (const file of release) assert.ok(spans(read(file)).includes('aidlc release start --goal <id>'), `${file} names release start --goal <id>`);
  assert.ok(read('CLAUDE.md').includes("- `aidlc release start --goal <id>`     release attempt for the target set by `aidlc goal new --target`\n"));
  assert.ok(read('templates/CLAUDE.aidlc.md').includes("- `aidlc release start --goal <id>`     release attempt for the target set by `aidlc goal new --target`\n"));
  assert.ok(read('.claude/agents/release-specialist.md').includes('1. `aidlc release start --goal <id>` (the target is the one `aidlc goal new --target` set); read the directive.'));
  assert.ok(flat('.claude/skills/aidlc-loop/release.md').includes('Explicit target only (`aidlc goal new --target <package|staging|production>`). `aidlc release start --goal <id>`, then `aidlc release next` / `aidlc release report`.'));
  assert.ok(flat('.claude/skills/aidlc-loop/card-loop.md').includes('`aidlc card next <id>` returns one directive from the precedence below; do that move, then `aidlc card next <id>` again.'));
});

test('T1-SWEEP-FLAGS-2 acceptance 4: CLAUDE.md and OPERATIONS name the env vars the code reads and sets; the CHANGELOG names the card [R3] [R4]', () => {
  const claude = flat('CLAUDE.md');
  // T1-SWEEP2-FLAGS acceptance 5 updated both sentences: no CLAUDE_SESSION_ID, and both release approval variables.
  assert.ok(claude.includes('`AIDLC_SESSION` (else `CLAUDE_CODE_SESSION_ID`) identifies the session for leases and the journal.'));
  assert.ok(claude.includes('The hooks read `AIDLC_FIX_TASK` and `RELEASE_APPROVAL` (else `AIDLC_RELEASE_APPROVAL`); aidlc sets `AIDLC_TARGET_ENV` for an ops command whose binding has `targetSelection: env`, and `aidlc run` sets `AIDLC_RUN_NO_SHIP=1` for its provider.'));
  assert.ok(!claude.includes('`AIDLC_TARGET_ENV` are read by the hooks'), 'aidlc never reads AIDLC_TARGET_ENV');
  assert.ok(
    flat('docs/OPERATIONS.md').includes('The driver runs the provider with `AIDLC_RUN_NO_SHIP=1`, under which the CLI does not ship: `aidlc card next` returns a `wait` on `driver-ship-boundary` where it would ship, and `aidlc card ship` fails (`tests/scenarios/run-driver.test.ts` runs both).'),
  );
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.match(unreleased, /^- T1-SWEEP-FLAGS-2 \(supersedes T1-SWEEP-FLAGS\): the agent-evals workflow passes `--provider claude-code` /m);
});

test('T1-SWEEP2-FLAGS acceptance 5: no doc says CLAUDE_SESSION_ID is read, OPERATIONS states the approval precedence and the no-goal-records admission, and the CHANGELOG names the card [R1] [R4] [R5]', () => {
  for (const file of ['CLAUDE.md', 'docs/ARCHITECTURE.md', 'docs/OPERATIONS.md']) assert.ok(!read(file).includes('CLAUDE_SESSION_ID'), `${file} names CLAUDE_SESSION_ID`);
  assert.ok(flat('docs/ARCHITECTURE.md').includes("the session id comes from `AIDLC_SESSION`, then the Claude Code session (`CLAUDE_CODE_SESSION_ID`, exported to Claude Code's subprocesses), then a per-repository default token in `.aidlc/session-default`"));
  assert.ok(flat('docs/OPERATIONS.md').includes('else the Claude Code session, which Claude Code exports to its Bash and PowerShell subprocesses as `CLAUDE_CODE_SESSION_ID`, else the default token in `.aidlc/session-default`'));
  const row = read('docs/OPERATIONS.md').split(/\r?\n/).find((l) => l.startsWith('| `production-gate` |'));
  assert.equal(
    row,
    '| `production-gate` | PreToolUse Bash, PowerShell | the command matches a deploy/release verb together with `prod|production|live` and `RELEASE_APPROVAL` (or `AIDLC_RELEASE_APPROVAL`) is unset or does not name a recorded production authorization; exit 2 with the reason. `RELEASE_APPROVAL` wins when both are set, and a repository with no goal records (no `goals/` directory in the state directory) admits any non-empty value |',
  );
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.ok(
    unreleased.includes(
      "- T1-SWEEP2-FLAGS: the session resolution (`resolveSessionId` and the `aidlc doctor` session line) no longer reads `CLAUDE_SESSION_ID`, which Claude Code never exported; it reads `AIDLC_SESSION`, then `CLAUDE_CODE_SESSION_ID`, then the default token. A process that set only `CLAUDE_SESSION_ID` by hand now resolves to `CLAUDE_CODE_SESSION_ID` or the default token; set `AIDLC_SESSION` instead. `GoalCounters` drops `lifecycleRepairCycles`, `providerWaitMs` and `planningMs`, which nothing read: a goal record that carries them still parses and loses them on its next save. `aidlc security check` still exits 2 with `NOT CONFIGURED`; its detail now reads `aidlc binds no security scanner; run the project's own scanner or a CI security job; a missing scanner is never a pass` and no longer names an `aidlc.config.json` binding that does not exist. The production gate's deny text for an unset approval names both `RELEASE_APPROVAL` and `AIDLC_RELEASE_APPROVAL`; the gate admits and blocks the same commands, and `docs/OPERATIONS.md` states that `RELEASE_APPROVAL` wins when both are set and that a repository with no goal records admits any non-empty value.",
    ),
    'the CHANGELOG Unreleased section names the card, the dropped fallback with AIDLC_SESSION as the override, the three counters, the security check detail and the deny text',
  );
});

test('T1-BENCH-TRIALS-2 acceptance 5: the CLI declares `bench run --trials <n>` and `bench compare <before.json> <after.json>`, and OPERATIONS names both [R1] [R6]', () => {
  const help = (...args: string[]) => spawnSync(process.execPath, [path.join(root, 'src', 'cli', 'main.ts'), 'review', 'bench', ...args, '--help'], { encoding: 'utf8', windowsHide: true }).stdout;
  assert.match(help('run'), /--trials <n>/);
  assert.match(help('compare'), /^Usage: aidlc review bench compare \[options\] <before\.json> <after\.json>$/m);
  const ops = flat('docs/OPERATIONS.md');
  for (const line of ['aidlc review bench run --stage <pre|formal> --trials 3 --json', 'aidlc review bench compare <before.json> <after.json>']) assert.ok(ops.includes(line), line);
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 9: aidlc evals run refuses a --dir inside the state directory before reading a case [R10]', () => {
  const state = mkdtempSync(path.join(tmpdir(), 'aidlc-evals-state-'));
  mkdirSync(path.join(state, 'cases'));
  writeFileSync(path.join(state, 'cases', 'a.json'), JSON.stringify({ id: 'a', prompt: 'do it', checks: [{ type: 'output-matches', pattern: 'x' }] }));
  const r = spawnSync(process.execPath, [path.join(root, 'src', 'cli', 'main.ts'), 'evals', 'run', '--skip-model', '--dir', path.join(state, 'cases')], { cwd: root, encoding: 'utf8', windowsHide: true, env: { ...process.env, AIDLC_STATE_DIR: state } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /is inside the state directory/);
  assert.equal(r.stdout, '', 'no case was run');
});

test("T1-EVAL-TRANSCRIPT-2 acceptance 9: aidlc evals run refuses --dir .aidlc while AIDLC_STATE_DIR names another directory [R10]", () => {
  const repo = mkdtempSync(path.join(tmpdir(), 'aidlc-evals-repo-'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  mkdirSync(path.join(repo, '.aidlc'));
  writeFileSync(path.join(repo, '.aidlc', 'a.json'), JSON.stringify({ id: 'a', prompt: 'do it', checks: [{ type: 'output-matches', pattern: 'x' }] }));
  const other = mkdtempSync(path.join(tmpdir(), 'aidlc-evals-state-'));
  const r = spawnSync(process.execPath, [path.join(root, 'src', 'cli', 'main.ts'), 'evals', 'run', '--skip-model', '--dir', '.aidlc'], { cwd: repo, encoding: 'utf8', windowsHide: true, env: { ...process.env, AIDLC_STATE_DIR: other } });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /is inside the repository's \.aidlc/);
  assert.ok(r.stderr.includes('.aidlc'), 'the refusal names the path');
  assert.equal(r.stdout, '', 'no case was run');
});

test('T1-EVAL-TRANSCRIPT-2 acceptance 9: aidlc evals run from a linked worktree reads its cases from the worktree, runs --skip-model checks there and checks out its HEAD for a model-backed case', () => {
  const main = mkdtempSync(path.join(tmpdir(), 'aidlc-evals-main-'));
  const git = (cwd: string, ...args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
  writeFileSync(path.join(main, 'base.txt'), 'base');
  git(main, 'init', '-q');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'main');
  const wt = path.join(mkdtempSync(path.join(tmpdir(), 'aidlc-evals-wt-')), 'wt');
  assert.equal(git(main, 'worktree', 'add', '-q', '-b', 'wt', wt).status, 0);
  mkdirSync(path.join(wt, 'evals'));
  writeFileSync(path.join(wt, 'only-in-wt.txt'), 'wt');
  const probe = ['node', '-e', "process.exit(require('fs').existsSync('only-in-wt.txt') ? 0 : 1)"];
  writeFileSync(path.join(wt, 'evals', 'a.json'), JSON.stringify({ id: 'wt-head', prompt: 'do it', checks: [{ type: 'command', command: probe }] }));
  git(wt, 'add', '.');
  git(wt, 'commit', '-q', '-m', 'worktree only');
  const state = mkdtempSync(path.join(tmpdir(), 'aidlc-evals-state-'));
  for (const mode of [['--skip-model'], ['--provider', 'mock']]) {
    const r = spawnSync(process.execPath, [path.join(root, 'src', 'cli', 'main.ts'), 'evals', 'run', ...mode], { cwd: wt, encoding: 'utf8', windowsHide: true, env: { ...process.env, AIDLC_STATE_DIR: state } });
    assert.equal(r.status, 0, `${mode.join(' ')}: ${r.stdout}${r.stderr}`);
    const suite = JSON.parse(r.stdout) as { total: number; passed: number };
    assert.deepEqual([suite.total, suite.passed], [1, 1], `${mode.join(' ')}: the worktree case ran and saw the worktree's file`);
  }
});

test('T1-FINDING-REPRO acceptance 7: the CLI declares `review repro <cardId> <findingId>` with a required --argv <json>, --files <paths> and --goal <id>, and OPERATIONS.md documents that command line [R1]', () => {
  const main = path.join(root, 'src', 'cli', 'main.ts');
  const help = spawnSync(process.execPath, [main, 'review', 'repro', '--help'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(help.status, 0, help.stderr);
  const text = help.stdout.replace(/\s+/g, ' ');
  for (const needle of ['Usage: aidlc review repro [options] <cardId> <findingId>', '--argv <json>', '--files <paths>', '--goal <id>']) assert.ok(text.includes(needle), `help names ${needle}: ${text}`);
  const missing = spawnSync(process.execPath, [main, 'review', 'repro', 'T1-X', 'F1'], { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.notEqual(missing.status, 0, 'a missing --argv is refused');
  assert.match(missing.stderr, /--argv <json>/);
  assert.ok(flat('docs/OPERATIONS.md').includes('aidlc review repro <cardId> <findingId> --argv <json> [--files <paths>] [--goal <id>]'), 'OPERATIONS.md documents the command line');
});
