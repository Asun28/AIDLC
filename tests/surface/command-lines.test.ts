// Card T1-SWEEP-FLAGS-2 (successor of T1-SWEEP-FLAGS): the eval workflow, the shipped command lines and the env var docs match what the CLI declares and reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

test('T1-SWEEP-FLAGS-2 acceptance 1: the eval job runs on claude-code only with the key and warns that it skipped otherwise [R1]', () => {
  const live = read('.github/workflows/agent-evals.yml');
  assert.equal(read('templates/github/workflows/agent-evals.yml'), live);
  assert.ok(live.includes("\n    env:\n      HAS_ANTHROPIC_KEY: ${{ secrets.ANTHROPIC_API_KEY != '' }}\n    steps:\n"), 'the evals job sets HAS_ANTHROPIC_KEY');
  assert.deepEqual(step(live, 'name: Install Claude Code'), ['- name: Install Claude Code', "if: env.HAS_ANTHROPIC_KEY == 'true'", 'run: npm install -g @anthropic-ai/claude-code']);
  assert.deepEqual(step(live, 'name: Run eval suite'), [
    '- name: Run eval suite',
    "if: env.HAS_ANTHROPIC_KEY == 'true'",
    'env:',
    'ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}',
    'run: npx aidlc evals run --provider claude-code --threshold 0.9 --json > evals-result.json',
  ]);
  assert.deepEqual(step(live, 'name: Evals skipped'), [
    '- name: Evals skipped',
    "if: env.HAS_ANTHROPIC_KEY != 'true'",
    'run: echo "::warning title=Evals skipped::ANTHROPIC_API_KEY is not set, so the eval suite did not run"',
  ]);
  assert.equal(live.split(/\r?\n/).filter((l) => /npm install -g @anthropic-ai\/claude-code|npx aidlc evals run/.test(l)).length, 2, 'no ungated install or eval run');
  assert.ok(!live.includes('AIDLC_PROVIDER'), 'nothing reads AIDLC_PROVIDER');
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
  assert.ok(claude.includes('`AIDLC_SESSION` (else `CLAUDE_CODE_SESSION_ID`, else the older `CLAUDE_SESSION_ID`) identifies the session for leases and the journal.'));
  assert.ok(claude.includes('The hooks read `AIDLC_FIX_TASK` and `AIDLC_RELEASE_APPROVAL`; aidlc sets `AIDLC_TARGET_ENV` for an ops command whose binding has `targetSelection: env`, and `aidlc run` sets `AIDLC_RUN_NO_SHIP=1` for its provider.'));
  assert.ok(!claude.includes('`AIDLC_TARGET_ENV` are read by the hooks'), 'aidlc never reads AIDLC_TARGET_ENV');
  assert.ok(
    flat('docs/OPERATIONS.md').includes('The driver runs the provider with `AIDLC_RUN_NO_SHIP=1`, under which the CLI does not ship: `aidlc card next` returns a `wait` on `driver-ship-boundary` where it would ship, and `aidlc card ship` fails (`tests/scenarios/run-driver.test.ts` runs both).'),
  );
  const changelog = read('CHANGELOG.md');
  const start = changelog.indexOf('## Unreleased');
  const unreleased = changelog.slice(start, changelog.indexOf('\n## ', start + 1));
  assert.match(unreleased, /^- T1-SWEEP-FLAGS-2 \(supersedes T1-SWEEP-FLAGS\): the agent-evals workflow passes `--provider claude-code` /m);
});
