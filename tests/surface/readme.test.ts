import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hookNamesFor } from '../../src/hooks/entry.ts';
import { HOOK_NAMES, type HookName } from '../../src/hooks/index.ts';
import { initProject } from '../../src/scaffold/init.ts';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const sentence = 'aidlc is not an implementation of the AWS AI-DLC methodology; it is a driver-agnostic bounded-autonomy control plane for coding agents.';
const original = 'AI-native SDLC orchestrator in TypeScript. It implements the Anthropic AI-native SDLC playbook loop, intent -> spec -> plan -> cards -> diff -> review -> release -> incident, with the bounded autonomy of the v5 plan in `docs/plans/PLAN-aidlc-loop.md`: sized routing (T0-bugfix/T0/T1/T2), one coordinator per goal, shared-session leases and review admission, hard admission deadlines, bounded review/CI/effort retries, opt-in release and migration stages, and a hash-chained evidence journal that an independent verifier can check. Every `aidlc next` call returns exactly one typed directive; the agent (Claude Code or any other driver) performs that move and reports the result.';

test('T1-README-SCOPE: the opening paragraph adds the scope sentence and preserves its existing text', () => {
  const paragraphs = read('README.md').trim().split(/\n\s*\n/);
  assert.equal(paragraphs[0], '# aidlc');
  assert.equal(paragraphs[1], `${original} ${sentence}`);
  const patterns = read('docs/ARCHITECTURE.md').split('## Patterns borrowed\n')[1]?.split('\n## ')[0];
  assert.ok(patterns?.includes('- AWS AI-DLC workflows: exactly one typed directive per engine call, the read/write split between `next` and `report`, six-state stage bookkeeping.'));
});

test('T1-README-SCOPE: Unreleased records the clarification in plain prose', () => {
  const unreleased = read('CHANGELOG.md').split('## Unreleased\n')[1]?.split('\n## ')[0];
  const entry = '- T1-README-SCOPE: clarify in the README opening paragraph that aidlc is a driver-agnostic bounded-autonomy control plane for coding agents, not an implementation of the AWS AI-DLC methodology.';
  assert.ok(unreleased?.includes(entry));
  assert.doesNotMatch(sentence + entry, /[\u2014\u300c\u300d]/u);
});

const initSection = () => read('README.md').split('## What aidlc init writes\n')[1]?.split('\n## ')[0] ?? '';

const TOOLS = ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit'];

/** The event cell of a guard's line, taken from the dispatch table. */
function eventCell(name: HookName): string {
  const tools = TOOLS.filter((tool_name) => hookNamesFor({ hook_event_name: 'PreToolUse', tool_name }).includes(name));
  const events = tools.length ? [`\`PreToolUse\`: ${tools.join(', ')}`] : [];
  for (const event of ['Stop', 'UserPromptSubmit']) if (hookNamesFor({ hook_event_name: event }).includes(name)) events.push(`\`${event}\``);
  return events.join('; ');
}

const GUARD_CELLS: Record<HookName, [reads: string, blocks: string]> = {
  'production-gate': ['the command, `hooks.productionPatterns`, `RELEASE_APPROVAL` or `AIDLC_RELEASE_APPROVAL`, the production authorizations on goals with each goal\'s state and generation', 'a command that writes matches a production pattern and no goal that is not terminal and not in `DONE` or `STOP` has, as its first current-generation record whose id or ref equals the approval reference, a production authorization that has not expired; with no `goals/` directory in the resolved state directory, any non-empty selected approval reference passes this lookup'],
  'protect-paths': ['the file path, the command, `hooks.frozenPaths`', 'a file path matches a frozen path, or a command that names one writes files'],
  'protect-tests': ['the file path, `AIDLC_FIX_TASK`, `.aidlc/fix-task`, `hooks.testPathPatterns`', 'a fix task is active and the file path matches a test pattern'],
  'secrets-guard': ['the file path, `content`, `new_string`, `command`', 'the file is a `.env`, `.pem`, `.key`, `id_rsa` or `.secrets/` file, or the text holds a credential pattern'],
  'verify-before-done': ['goals, card runs, leases, the git status of planning files', 'never: it adds a reminder of a missing DoD receipt or of uncommitted planning files'],
  'route-new-work': ['the prompt, the `aidlc.config.json` error', 'never: it prints the routing line'],
};

const README_SENTENCES = [
  '`aidlc init` writes these paths into the repository, with the default `--cards-dir`. It skips a file that exists unless `--force` is set, and it merges `.claude/settings.json`, `.gitignore` and the `CLAUDE.md` section into a file that exists. In a repository with content and no `package.json` it skips `.github/workflows/aidlc-ci.yml` and `.github/workflows/agent-evals.yml`.',
  '`.claude/settings.json` holds a `permissions.deny` list and the hook entries. `aidlc init --no-hooks` writes the same files and the same deny list and merges no hook entry. A hook already in the file stays as it is and keeps running, so a repository with no hooks wired runs no guard. With no dispatcher wired, `aidlc doctor` prints `not wired` on its `hookCommand` line.',
  'The hook entries start one process per event, which runs the guards below and returns the first block. Each guard prints repository content and environment values as JSON strings, apart from an id that is one plain word (`[A-Za-z0-9._:-]+`).',
  'While `aidlc.config.json` cannot be used, `production-gate` and `protect-paths` deny every shell command but `aidlc doctor`, `protect-paths` denies every edit of another file, and `protect-tests` denies the same edits while a fix task is active.',
];
const SETUP_USAGE = 'node bin/aidlc.js init [dir] [--cards-dir specs/tasks] [--ship-path scaffold|github|dry-run] [--force] [--dry-run] [--no-hooks]';
const SETUP_SENTENCE = '`--no-hooks` writes the same files and the same `permissions.deny` list and merges no hook entry into `.claude/settings.json`; a hook already in the file stays as it is and keeps running, so a repository with no hooks wired runs no guard, and `aidlc doctor` prints `not wired` on its `hookCommand` line when the file wires no dispatcher.';
const CHANGELOG_ENTRY = '- T1-INIT-SURFACE: `aidlc init --no-hooks` writes the same files and the same `permissions.deny` list, merges no hook entry into `.claude/settings.json` and leaves a hook already in the file as it is. The README section `What aidlc init writes` lists every path init writes and, for each guard, the event, what it reads and when it blocks. `production-gate`, `protect-tests` and `secrets-guard` print the approval reference, the fix task marker and the file path as JSON strings.';

test('T1-INIT-SURFACE acceptance 2: the README lists every path aidlc init writes and no other [R2]', () => {
  const target = mkdtempSync(path.join(tmpdir(), 'aidlc-readme-'));
  try {
    const report = initProject({ target });
    const listed = initSection().split('```text\n')[1]?.split('\n```')[0]?.split('\n') ?? [];
    assert.deepEqual([...listed].sort(), [...report.created, ...report.merged].sort());
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('T1-INIT-SURFACE acceptance 3: the README has one line per guard of HOOK_NAMES, naming its event, input and blocking condition [R2]', () => {
  const rows = initSection().split('\n').filter((line) => line.startsWith('| `'));
  assert.equal(rows.length, HOOK_NAMES.length, 'one line per guard and no other');
  for (const name of HOOK_NAMES) {
    const [reads, blocks] = GUARD_CELLS[name];
    assert.deepEqual(rows.filter((row) => row.startsWith(`| \`${name}\` |`)), [`| \`${name}\` | ${eventCell(name)} | ${reads} | ${blocks} |`]);
  }
});

test('T1-INIT-SURFACE acceptance 6: the README section, OPERATIONS Setup and Unreleased carry the exact text [R1]', () => {
  for (const s of README_SENTENCES) assert.ok(initSection().includes(s), s);
  const setup = read('docs/OPERATIONS.md').split('## Setup\n')[1]?.split('\n## ')[0];
  assert.ok(setup?.includes(SETUP_USAGE), SETUP_USAGE);
  assert.ok(setup?.includes(SETUP_SENTENCE), SETUP_SENTENCE);
  assert.ok(!initSection().includes('so no guard runs') && !setup?.includes('so no guard runs'), 'a hook already in the file keeps running, so the text cannot say no guard runs');
  const unreleased = read('CHANGELOG.md').split('## Unreleased\n')[1]?.split('\n## ')[0];
  assert.ok(unreleased?.split('\n').includes(CHANGELOG_ENTRY), CHANGELOG_ENTRY);
});
