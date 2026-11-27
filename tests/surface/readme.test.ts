import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { hookNamesFor } from '../../src/hooks/entry.ts';
import { HOOK_NAMES, type HookName } from '../../src/hooks/index.ts';
import { initProject } from '../../src/scaffold/init.ts';
import { tmpDir } from '../infra/helpers.ts';
import { changelogSince010 } from '../infra/changelog.ts';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
/** The text under `## <heading>` of `doc`, from the end of the heading line to the next `## ` heading. */
const section = (doc: string, heading: string): string => doc.split(`\n## ${heading}\n`)[1]?.split('\n## ')[0] ?? '';
const sentence = 'aidlc is not an implementation of the AWS AI-DLC methodology; it is a driver-agnostic bounded-autonomy control plane for coding agents.';

// T1-README-SCOPE pinned the opening paragraph with the sentence above; T0-README-PLAIN supersedes that paragraph.
test('T1-README-SCOPE: docs/ARCHITECTURE.md Patterns borrowed still credits the AWS AI-DLC workflows', () => {
  const patterns = read('docs/ARCHITECTURE.md').split('## Patterns borrowed\n')[1]?.split('\n## ')[0];
  assert.ok(patterns?.includes('- AWS AI-DLC workflows: exactly one typed directive per engine call, the read/write split between `next` and `report`, six-state stage bookkeeping.'));
});

test('T1-README-SCOPE: Unreleased records the clarification in plain prose', () => {
  const unreleased = changelogSince010(read('CHANGELOG.md'));
  const entry = '- T1-README-SCOPE: clarify in the README opening paragraph that aidlc is a driver-agnostic bounded-autonomy control plane for coding agents, not an implementation of the AWS AI-DLC methodology.';
  assert.ok(unreleased?.includes(entry));
  assert.doesNotMatch(sentence + entry, /[\u2014\u300c\u300d]/u);
});

/** Card T0-README-PLAIN: the opening paragraph, verbatim. */
const OPENING =
  'aidlc is a command-line tool and TypeScript library for coordinating AI coding agents in a Git repository. Give it a goal, such as fixing a bug. It tells Claude Code or another agent how to break the work into task cards and what to do next. It sets time and retry limits, tracks test results and reviews, checks the configured gates before shipping, and records the evidence for each card.';
/** The How it works section, whole. */
const HOW_IT_WORKS = [
  '- **Sizing.** A goal is one request, sized T0-bugfix or T0 (one card), T1 (about 2 to 5 cards) or T2 (a new system, planned and approved first). A card is one task: the files it may change, a Definition of Done (DoD) command and an acceptance list.',
  '- **One step at a time.** `aidlc next` returns one directive, the next step as JSON; the agent does it and records the outcome with `aidlc report`.',
  '- **Gates.** A card ships only after a passing run of its DoD command is recorded and, when the project requires it, R3: a review of the exact commit by a separate reviewer.',
  '- **Limits.** By default a card gets 3 hours and a multi-card goal 12; attempts, reviews and CI reruns are capped. A goal that hits a limit stops and names the reason and the next action.',
  '- **Shared sessions.** Leases record which session owns each goal and card. After another session takes over a card, the previous owner cannot start shipping it ([Sessions](docs/OPERATIONS.md#sessions)).',
  '- **Evidence.** A hash-chained journal records each state change and operation; `aidlc audit verify` checks it.',
  '- **Opt-in delivery.** Package, staging, production and migration run only for goals that target them, with commands bound in `aidlc.ops.json`.',
].join('\n');
/** The Status section, whole, with the version of package.json. */
const STATUS = (version: string) =>
  [
    `Version ${version}.`,
    '',
    '- The development loop, from request to merged cards, is implemented and tested. This repository ships its own pull requests with it, through the `github` ship path.',
    '- Ship paths: `github` runs the chain with `git` and `gh` (commit, candidate-bound verdict, base sync, push, PR, CI check runs, squash merge); `scaffold` drives `scripts/task.ps1` from claude-devops-scaffold; `dry-run`, the default after `aidlc init`, records a simulated merge without pushing or merging.',
    '- Development is the default target. Package, staging, production and migration targets need their commands bound in `aidlc.ops.json`; until then a goal for one of them stops with `release-config`.',
    '- `aidlc audit verify --claim-full` reports `verified` only with a sealed manifest, an intact journal, an asserted host capture boundary and, for every shipped card, at least one fact of its merge re-derived from git or GitHub; otherwise it reports `BLOCKED/capability` with the exact prerequisite.',
  ].join('\n');
const version = (JSON.parse(read('package.json')) as { version: string }).version;

/** The pinned parts `readme` does not hold whole: the opening paragraph, How it works, Status. */
function unpinned(readme: string): string[] {
  const missing: string[] = [];
  const paragraphs = readme.trim().split(/\n\s*\n/);
  if (paragraphs[0] !== '# aidlc' || paragraphs[1] !== OPENING) missing.push('opening paragraph');
  if (section(readme, 'How it works') !== `\n${HOW_IT_WORKS}\n`) missing.push('How it works');
  if (section(readme, 'Status') !== `\n${STATUS(version)}\n`) missing.push('Status');
  return missing;
}

test('T0-README-PLAIN acceptance 1: the opening paragraph, How it works and Status are pinned whole, and removing any sentence fails [R1]', () => {
  const readme = read('README.md');
  assert.deepEqual(unpinned(readme), []);
  const sentences = [OPENING, HOW_IT_WORKS, STATUS(version)].flatMap((text) => text.split(/(?<=[.;:])\s+/)).filter((s) => s.trim() !== '');
  assert.ok(sentences.length >= 20, `the pinned parts resolve to ${sentences.length} sentences`);
  for (const s of sentences) {
    assert.ok(readme.includes(s), `README.md holds: ${s}`);
    assert.notDeepEqual(unpinned(readme.replace(s, '')), [], `removing "${s}" fails the pin`);
  }
});

/** Card T0-README-PLAIN, Removed: README.md text at 359fbd14 whose only job was to guard against an objection. */
const REMOVED = [
  'aidlc is not an implementation of the AWS AI-DLC methodology',
  'need qualification against a real repository before the loop is advertised as run-verified',
  'a development-only goal never needs them',
  '"Fully audited" is never assumed.',
  'read git with `--no-lazy-fetch`, which an older git refuses',
  'and writes nothing',
  'A hook already in the file stays as it is and keeps running, so a repository with no hooks wired runs no guard.',
  'with no `goals/` directory in the resolved state directory, any non-empty selected approval reference passes this lookup',
  '`aidlc next` is read-only apart from derived transitions',
  'Lease records are never rewritten for an identity change',
  'A mutation is fenced against its generation; a stale writer cannot commit.',
  'lease expiry alone does not prove the owner stopped',
  'Quota holds are WAIT, not defects',
  'A time STOP that `aidlc goal extend` lifted is not counted.',
  'Records are read one at a time with no snapshot across files',
];

test('T0-README-PLAIN acceptance 2: the Removed list holds the 15 excerpts of the card [R2]', () => {
  assert.equal(REMOVED.length, 15);
  assert.equal(new Set(REMOVED).size, 15);
});

// One test per excerpt (R3 decision 1, F1): each fails on its own on README.md at 359fbd14.
for (const [i, excerpt] of REMOVED.entries()) {
  test(`T0-README-PLAIN acceptance 2.${i + 1}: README.md no longer holds ${JSON.stringify(excerpt)} [R2]`, () => {
    assert.ok(!read('README.md').includes(excerpt), `README.md still holds: ${excerpt}`);
  });
}

const initSection = () => section(read('README.md'), 'What aidlc init writes');
const setupSection = () => section(read('docs/OPERATIONS.md'), 'Setup');

const TOOLS = ['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit'];

/** The event cell of a guard's line, taken from the dispatch table. */
function eventCell(name: HookName): string {
  const tools = TOOLS.filter((tool_name) => hookNamesFor({ hook_event_name: 'PreToolUse', tool_name }).includes(name));
  const events = tools.length ? [`\`PreToolUse\`: ${tools.join(', ')}`] : [];
  for (const event of ['Stop', 'UserPromptSubmit']) if (hookNamesFor({ hook_event_name: event }).includes(name)) events.push(`\`${event}\``);
  return events.join('; ');
}

/** What each guard blocks, in plain words (card T0-README-PLAIN); the exact conditions are in docs/OPERATIONS.md Hooks. */
const GUARD_BLOCKS: Record<HookName, string> = {
  'production-gate': 'a command that writes and matches a production pattern, unless the approval reference in `RELEASE_APPROVAL` names a current production authorization',
  'protect-paths': 'an edit of a frozen path (`hooks.frozenPaths`), or a command that writes one',
  'protect-tests': 'an edit of a test file while a fix task is active',
  'secrets-guard': 'a write to a secret file such as `.env` or a `.pem` key, or text that holds a credential',
  'stdin-script': 'a command that starts an interpreter on a script read from standard input',
  'protect-git': 'a git command that force-pushes, runs `reset --hard` or `clean -f`, discards changes with `checkout`, or skips the git hooks',
  'verify-before-done': 'nothing; it reminds the agent of a missing DoD receipt or of uncommitted planning files',
  'route-new-work': 'nothing; it prints the routing line for a new request',
};

/** The README init section around the guard table (card T0-README-PLAIN). */
const README_INIT = [
  '`aidlc init` adds the configuration (`aidlc.config.json`), Claude Code skills, agents and hook settings, the review policy (`REVIEW.md`), CI workflows and planning templates; [Setup](docs/OPERATIONS.md#setup) lists every path. It skips a file that exists unless `--force` is set, and merges `.claude/settings.json`, `.gitignore` and its `CLAUDE.md` section into files that exist.',
  'The hook settings run these guards on Claude Code tool calls; [Hooks](docs/OPERATIONS.md#hooks) gives the exact conditions.',
];
/** The init and hook facts T1-INIT-SURFACE put in the README, in the docs/OPERATIONS.md sections that state them since T0-README-PLAIN. */
const OPERATIONS_SENTENCES: Array<[heading: string, text: string]> = [
  ['Setup', '`aidlc init` writes these paths into the repository, with the default `--cards-dir`. It skips a file that exists unless `--force` is set, and it merges `.claude/settings.json`, `.gitignore` and the `CLAUDE.md` section into a file that exists. In a repository with content and no `package.json` it skips `.github/workflows/aidlc-ci.yml` and `.github/workflows/agent-evals.yml`.'],
  ['Hooks', 'One hook process per event.'],
  ['Hooks', '`templates/claude/settings.json` (merged by `init`) wires a single command for `PreToolUse` (matcher `Bash|PowerShell|Edit|Write|MultiEdit`), `Stop` and `UserPromptSubmit`; that process runs every guard that applies to the event (`src/hooks/entry.ts`, `dispatchHook`) and returns the first block, else the first advisory output.'],
  ['Hooks', 'Each guard prints repository content and environment values as JSON strings, apart from an id that is one plain word (`[A-Za-z0-9._:-]+`).'],
  ['Hooks', 'Beyond that, `production-gate` and `protect-paths` deny every Bash command except exactly `aidlc doctor`, `npx --no-install aidlc doctor`, `node bin/aidlc.js doctor` or `node node_modules/aidlc/bin/aidlc.js doctor`, each alone or followed by ` --json`, ` 2>&1` or ` --json 2>&1`, and `protect-paths`, like `protect-tests` while a fix task is active, denies every edit of a file other than the config.'],
];
const SETUP_USAGE = 'node bin/aidlc.js init [dir] [--cards-dir specs/tasks] [--ship-path scaffold|github|dry-run] [--force] [--dry-run] [--no-hooks]';
const SETUP_SENTENCE = '`--no-hooks` writes the same files and the same `permissions.deny` list and merges no hook entry into `.claude/settings.json`; a hook already in the file stays as it is and keeps running, so a repository with no hooks wired runs no guard, and `aidlc doctor` prints `not wired` on its `hookCommand` line when the file wires no dispatcher.';
const CHANGELOG_ENTRY = '- T1-INIT-SURFACE: `aidlc init --no-hooks` writes the same files and the same `permissions.deny` list, merges no hook entry into `.claude/settings.json` and leaves a hook already in the file as it is. The README section `What aidlc init writes` lists every path init writes and, for each guard, the event, what it reads and when it blocks. `production-gate`, `protect-tests` and `secrets-guard` print the approval reference, the fix task marker and the file path as JSON strings.';

test('T1-INIT-SURFACE acceptance 2: docs/OPERATIONS.md Setup lists every path aidlc init writes and no other [R2] [T0-README-PLAIN R3]', () => {
  const target = tmpDir('aidlc-readme-');
  try {
    const report = initProject({ target });
    const listed = setupSection().split('```text\n')[1]?.split('\n```')[0]?.split('\n') ?? [];
    assert.deepEqual([...listed].sort(), [...report.created, ...report.merged].sort());
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

test('T1-INIT-SURFACE acceptance 3: the README has one line per guard of HOOK_NAMES, naming its event and, in plain words, what it blocks [R2] [T0-README-PLAIN R1]', () => {
  const rows = initSection().split('\n').filter((line) => line.startsWith('| `'));
  assert.equal(rows.length, HOOK_NAMES.length, 'one line per guard and no other');
  for (const name of HOOK_NAMES) {
    assert.deepEqual(rows.filter((row) => row.startsWith(`| \`${name}\` |`)), [`| \`${name}\` | ${eventCell(name)} | ${GUARD_BLOCKS[name]} |`]);
  }
});

test('T1-INIT-SURFACE acceptance 6: the README section, OPERATIONS Setup and Hooks, and Unreleased carry the exact text [R1] [T0-README-PLAIN R3]', () => {
  for (const s of README_INIT) assert.ok(initSection().includes(s), s);
  const ops = read('docs/OPERATIONS.md');
  for (const [heading, s] of OPERATIONS_SENTENCES) assert.ok(section(ops, heading).includes(s), `docs/OPERATIONS.md ${heading}: ${s}`);
  const setup = setupSection();
  assert.ok(setup.includes(SETUP_USAGE), SETUP_USAGE);
  assert.ok(setup.includes(SETUP_SENTENCE), SETUP_SENTENCE);
  assert.ok(!initSection().includes('so no guard runs') && !setup.includes('so no guard runs'), 'a hook already in the file keeps running, so the text cannot say no guard runs');
  const unreleased = changelogSince010(read('CHANGELOG.md'));
  assert.ok(unreleased?.split('\n').includes(CHANGELOG_ENTRY), CHANGELOG_ENTRY);
});
