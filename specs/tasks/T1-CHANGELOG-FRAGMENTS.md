---
id: T1-CHANGELOG-FRAGMENTS
title: A card records its behaviour change in its own new file changelog.d/<card id>.md, not in CHANGELOG.md; CLAUDE.md states the rule, changelog.d/README.md the form, and a surface test refuses a file in changelog.d whose name is not a registered card id or whose text is not one entry line
status: todo
branch: T1-CHANGELOG-FRAGMENTS
worktree: D:\wt\AIDLC\T1-CHANGELOG-FRAGMENTS
plan_ref: plans/loop-throughput.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - CLAUDE.md
  - changelog.d/README.md
  - changelog.d/T1-CHANGELOG-FRAGMENTS.md
  - tests/infra/changelog.ts
  - tests/surface/changelog-fragments.test.ts
  - tests/surface/prose.test.ts
  - specs/tasks/T1-CHANGELOG-FRAGMENTS.md
dod_command: npm run typecheck && node --test tests/surface/changelog-fragments.test.ts tests/infra/changelog.test.ts tests/surface/prose.test.ts tests/surface/claude-md-size.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/config.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/bench.test.ts tests/infra/build-atomic.test.ts tests/infra/stray-processes.test.ts
dod_exit: 0
requirements:
  - R1. CLAUDE.md (Conventions) shall carry the line of Acceptance detail 1 in place of its line that says to record behaviour changes in `CHANGELOG.md` (Unreleased) (:113-114).
  - R2. The new `changelog.d/README.md` shall state the form of Acceptance detail 2, that `tests/surface/changelog-fragments.test.ts` refuses any other file in `changelog.d/` except the README, that a card's own test reads its line with `fragmentEntry`, and that the changes not yet released are the Unreleased section of `CHANGELOG.md` and the files in `changelog.d/`.
  - R3. `fragmentProblems(name, text, cardIds)` (new, exported from tests/infra/changelog.ts; `cardIds` a `ReadonlySet<string>`) shall return the empty array when `name` and `text` have the form of Acceptance detail 2 and the id of `name` is in `cardIds`, and otherwise the problems of Acceptance detail 2 in their order.
  - R4. `fragmentEntry(root, cardId)` (new, exported from the same file) shall return the text of `<root>/changelog.d/<cardId>.md` without its final line feed.
  - R5. tests/surface/changelog-fragments.test.ts shall fail when `changelog.d/` does not hold `README.md` and this card's fragment, or when `fragmentProblems` returns a problem for any other entry of `changelog.d/`, with `cardIds` the ids of the cards that `loadCardRegistry` (src/artifacts/card.ts:224) reads from `specs/tasks` and `specs/archive/tasks`.
  - R6. The new `changelog.d/T1-CHANGELOG-FRAGMENTS.md` shall hold the entry of Acceptance detail 3 followed by one line feed.
  - R7. tests/surface/prose.test.ts shall add the Markdown files of `changelog.d/` to its `SCOPE` (:39-49), so that a fragment or the README that holds an em dash or a corner bracket fails as such a line in `CHANGELOG.md` does.
acceptance:
  - 1. tests/surface/changelog-fragments.test.ts (new), test "T1-CHANGELOG-FRAGMENTS acceptance 1 - every file in changelog.d is the README or a well-formed fragment of a registered card" - `changelog.d/` holds `README.md` and `T1-CHANGELOG-FRAGMENTS.md`, and `fragmentProblems` gives no problem for any entry but the README. Fails on main (the import of `fragmentEntry` fails; with the helper alone, `ENOENT` on `changelog.d`). [R5] [R6] [dod arm 2]
  - 2. Same file, test "T1-CHANGELOG-FRAGMENTS acceptance 2 - fragmentProblems refuses each malformed name and text and passes the two entry forms" - each row of Acceptance detail 2 compared with `deepEqual`. Fails on main (no export). [R3] [dod arm 2]
  - 3. Same file, test "T1-CHANGELOG-FRAGMENTS acceptance 3 - the fragment of this card holds its entry" - `fragmentEntry(root, 'T1-CHANGELOG-FRAGMENTS')` equals the entry of Acceptance detail 3, compared whole. Fails on main (no file). [R4] [R6] [dod arm 2]
  - 4. tests/surface/prose.test.ts - the `SCOPE` line of R7 is its only change, and "tracked prose carries no em dash and no corner brackets" passes with both files of `changelog.d/` in scope. It also passes on main, where `markdownFiles` returns no file for a missing directory (:27), so the row of the hygiene revert table that drops the line is reviewer-verified. [R7] [dod arm 2]
  - 5. CLAUDE.md carries the line of Acceptance detail 1 in place of :113-114 and no other change (reviewer-verified against the diff); tests/surface/claude-md-size.test.ts (at most 200 lines, the limit sentence in Conventions) and tests/surface/mirror.test.ts (CLAUDE.md ends with templates/CLAUDE.aidlc.md) pass with no line changed. [R1] [dod arm 2]
  - 6. changelog.d/README.md states what R2 lists (reviewer-verified against the diff). [R2]
  - 7. tests/infra/changelog.test.ts, tests/surface/templates.test.ts, command-lines.test.ts, config.test.ts, tsconfig-gate.test.ts, bench.test.ts, tests/infra/build-atomic.test.ts and stray-processes.test.ts, which read CLAUDE.md or import tests/infra/changelog.ts, pass with no line changed. They pass on main and with this card. [R1] [R3] [dod arm 2]
  - 8. The diff changes no byte of `CHANGELOG.md`, `templates/`, `.claude/`, `src/` or `.github/` (reviewer-verified against the diff; `CHANGELOG.md` is outside allow_paths, so the ship scope gate refuses a change to it). [R1]
  - 9. `npm run typecheck` exits 0 with the new helper and test. [R3] [R4] [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "Main at 2ef2bbf4. Readers and writers of CHANGELOG.md outside tests (`git grep -n CHANGELOG -- src bin scripts templates .claude docs README.md REVIEW.md .github`) - the base-sync merge `mergeChangelog` (src/delivery/github-ship.ts:514-580) acts only when CHANGELOG.md is the one unmerged path (:530) and every hunk adds entry lines to the Unreleased section; src/delivery/ship.ts:71-74 and src/loop/card-runner.ts:3199-3204 carry its repair text; `NO_CODE_PATH` (src/probes/git.ts:45) leaves CHANGELOG.md out of the paths of a lesson; the push `paths-ignore` of .github/workflows/ci.yml:11 and aidlc-ci.yml:11, the push `paths` of docs-check.yml:14 and templates/github/workflows/aidlc-ci.yml:11 name it. No code or script turns Unreleased into a version - the 0.2.0 section (CHANGELOG.md:15) and the version in package.json were written by hand in card T0-RELEASE-0-2-0. REVIEW.md has no dimension on a changelog entry. docs/OPERATIONS.md names CHANGELOG.md only in the base-sync paragraphs (:624, :626) and the matched-rules paragraph (:363). The one instruction to record an entry there is CLAUDE.md:113-114 - `git grep -n -i changelog` finds none in .claude/, templates/claude/, specs/tasks/_TEMPLATE.md or templates/cards/_TEMPLATE.md, and in templates/CLAUDE.aidlc.md only the words changelog entries in Writing density (:68), so the downstream template gains no rule. CLAUDE.md is 191 lines. Tests - `git grep -n 'Record behaviour' -- tests` finds no pin of the changed line; the test files that read CLAUDE.md are claude-md-size, mirror, prose, templates, command-lines, config, tsconfig-gate and bench (tests/surface), build-atomic and stray-processes (tests/infra), each on another line or on the line count and the template suffix, and tests/infra/init.test.ts reads the CLAUDE.md of its fixture; 71 test files import tests/infra/changelog.ts, all for `changelogSince010` (one also `FIRST_RELEASE_HEADING`), which stay as they are; `git grep -n changelog.d -- tests src docs` finds nothing; no test lists the files of the repository root. Form - of the 142 entries since 0.1.0 that start with a card id, 139 have the form of Acceptance detail 2, the 4 in Unreleased among them; the 3 others are T0-AUDIT-FIXES (a heading line over sub-items), T0-EXEC-SYNC-TREE-KILL and T0-CI-RERUN-STRUCTURED review repairs. CHANGELOG.md holds no carriage return and .gitattributes sets text=auto eol=lf for every file, so a fragment keeps LF in a Windows checkout. The card id pattern is `CARD_ID_REGEX` (src/core/types.ts:24); `loadCardRegistry` reads specs/tasks and specs/archive/tasks, the cardsDir and archiveDir of aidlc.config.json, and `[CARD-ID-FILENAME]` (src/artifacts/card.ts:155) blocks a card whose id is not its file name. The prose `SCOPE` (tests/surface/prose.test.ts:39-49) does not reach changelog.d/. Measured on a scratch copy of 2ef2bbf4 with a prototype of this card (not committed) - every DoD file passes; hygiene gives the RED and the revert table."
forbid:
  - a change to CHANGELOG.md, an entry moved out of it, or a note added to it
  - a change under src/, bin/, scripts/ or .github/, the base-sync merge `mergeChangelog` of src/delivery/github-ship.ts included
  - a change to templates/CLAUDE.aidlc.md or any other file under templates/ or .claude/
  - a fragment rule in `aidlc cards validate` or any other code under src/
  - a rule or test that refuses a new entry in CHANGELOG.md
  - changing an assertion of an existing test, or a test file outside allow_paths
non_goals:
  - the release assembly, follow-up card T1-CHANGELOG-ASSEMBLE - at a release it writes each fragment into the new release section of CHANGELOG.md in a stated order and makes `fragmentEntry` read an entry from that section once its file is removed, so the tests that pin fragments pass without each being edited (T0-RELEASE-0-2-0 changed 69 test files for the same reason)
  - switching the registered cards that name CHANGELOG.md in allow_paths to fragments; until a card is switched its entry goes to CHANGELOG.md and the base-sync merge of T0-BASE-SYNC-CHANGELOG-2 handles a conflict as it does today
  - adding changelog.d/** to the push paths-ignore of ci.yml and aidlc-ci.yml; a push whose only change is a fragment runs the full test matrix, which runs the fragment check, and leaving such a push out would need docs-check.yml paths too (ci.yml is also a path of T1-CI-SHARD)
  - a change made without a card, such as a rule the owner orders; it has no card id, so it adds its entry to CHANGELOG.md as before, and the check reads only changelog.d/
  - an entry for several cards; it is the fragment of one of them and names the others in its qualifier
  - the lesson path filter NO_CODE_PATH (src/probes/git.ts:45); a fragment becomes a path of its own card's lessons, and no other card's candidate changes that path, so it adds no score to matched rules
  - a multi-line entry or sub-items; a fragment is one line, as 139 of the 142 card entries since 0.1.0 are
hygiene: "Line numbers are from main at 2ef2bbf4; read them again at PREPARE. RED, measured on the scratch copy - with only the new test file added, it fails at load (SyntaxError, the requested module ../infra/changelog.ts does not provide an export named fragmentEntry); with the helper added, acceptance 2 passes and acceptance 1 and 3 fail with ENOENT on changelog.d. Revert table, measured on the scratch copy, each change restored afterwards - README.md removed (1 red); the fragment removed (1 and 3 red); a carriage return before its line feed (1 and 3 red); a second entry line in it (1 and 3 red); the registry check dropped from fragmentProblems (2 red); with the SCOPE line of R7, an em dash in the fragment (prose and 3 red); without that line (3 red, prose green, the reviewer row of acceptance 4). The DoD passed on the scratch copy in 188 s for the node --test arm (189 tests, 1 skipped as POSIX only) and 30 s for the typecheck, on Windows 11; tests/infra/build-atomic.test.ts and tests/surface/bench.test.ts take most of it and are listed because they read CLAUDE.md. Order - no card of plans/execution-gate.md or plans/install-portability.md lists CLAUDE.md, tests/infra/changelog.ts, tests/surface/prose.test.ts or changelog.d/ in allow_paths, so the card can run beside any of them; a card switched to fragments depends on this card. Not verified before the card runs - the time of the DoD on the CI runners."
---

# T1-CHANGELOG-FRAGMENTS

## Deliverable
From this card on, a card writes its changelog entry to its own new file `changelog.d/<card id>.md` instead of inserting it into `CHANGELOG.md`. `CHANGELOG.md` keeps every byte, and every test that reads it stays as it is. `CLAUDE.md` states the rule, `changelog.d/README.md` the form, and a surface test refuses a malformed fragment. A card's own test pins its fragment through `fragmentEntry`.

## Why
Nearly every card adds an entry at the top of the Unreleased section of `CHANGELOG.md`, so two cards that run at the same time conflict in that file. The base sync merges such a conflict (card T0-BASE-SYNC-CHANGELOG-2), and the merge is a new candidate that runs the DoD and R3 again (docs/OPERATIONS.md:624); docs/LESSONS.md:156 records one such cycle and :102 the strict order adopted to avoid them. `plans/install-portability.md:64` runs its cards one at a time for this reason (and for docs/OPERATIONS.md), although `maxWorkers` is 2. Two cards that both write fragments add two different files and have no entry line in common.

The check is a surface test, not code in `aidlc cards validate`: CI runs it on every candidate, the DoD of this card runs it, and it adds no line to `src/`. It reads the card ids from the same registry reader the CLI uses.

## Acceptance (DoD = command + exit code + assertion; paired with the closed acceptance: list)
```powershell
npm run typecheck && node --test tests/surface/changelog-fragments.test.ts tests/infra/changelog.test.ts tests/surface/prose.test.ts tests/surface/claude-md-size.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/config.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/bench.test.ts tests/infra/build-atomic.test.ts tests/infra/stray-processes.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every acceptance test above passes.

## Acceptance detail

### 1. The CLAUDE.md line
Conventions, in place of the two lines at :113-114, three lines wrapped as the file wraps (CLAUDE.md goes from 191 to 192 lines):

```
- Record a behaviour change in a new file `changelog.d/<card id>.md`, not
  in `CHANGELOG.md` (the form: `changelog.d/README.md`), and, where it
  touches the loop, in `docs/ARCHITECTURE.md` and `docs/OPERATIONS.md`.
```

### 2. The fragment form and the problems
A fragment is the file `changelog.d/<id>.md` where `<id>` matches `CARD_ID_REGEX` and is the id of a registered card, and whose text is one line followed by one line feed (no other line feed, no carriage return) that matches `^- <id>( \([^()\n]+\))?: \S`: `- <id>: <text>` or `- <id> (<qualifier>): <text>`, with no parenthesis inside the qualifier.

`fragmentProblems` returns, in this order:

| When | Problem |
|---|---|
| the name is not `<id>.md` with `<id>` matching `CARD_ID_REGEX` | `<name>: the file name is not <card id>.md`, and no other problem |
| `<id>` is not in `cardIds` | `<name>: no card <id> in specs/tasks or specs/archive/tasks` |
| the text is not one line ended by one line feed | `<name>: the text is not one line ended by one line feed` |
| otherwise, the line does not match | `<name>: the line does not start with "- <id>: " or "- <id> (<qualifier>): "` |

Rows of acceptance 2, with `cardIds` = {`T1-X`, `T0-Y`} and the name `T1-X.md` unless the row gives one:

| Text (name) | Result |
|---|---|
| `- T1-X: a change.\n`; `- T1-X (bugfix, issue 1): a change.\n` | `[]` each |
| empty; `- T1-X: a change.` (no line feed); `- T1-X: a change.\r\n`; `- T1-X: a.\n\n- T1-X: b.\n`; `- T1-X: a change.\n\n` | the one-line problem |
| `\n`; `- T0-Y: a change.\n`; `T1-X: a change.\n`; `* T1-X: a change.\n`; `- T1-X a change.\n`; `- T1-X: \n`; a byte order mark before `- T1-X: a change.\n` | the start problem |
| names `t1-x.md`, `T1-X.txt`, `T1_X.md`, `notes.md` | the name problem only |
| name `T9-NONE.md`, text `- T9-NONE: a change.\n` | the registry problem only |

### 3. The entry of this card
`changelog.d/T1-CHANGELOG-FRAGMENTS.md`, one line and a line feed:

- T1-CHANGELOG-FRAGMENTS: a card records its behaviour change in its own new file `changelog.d/<card id>.md` and leaves `CHANGELOG.md` as it is, so two cards that run at the same time and both write fragments change no file in common for their entries. The file holds one line ended by one line feed, `- <card id>: <text>` or `- <card id> (<qualifier>): <text>`, and its name is the id of a card in `specs/tasks/` or `specs/archive/tasks/`; `tests/surface/changelog-fragments.test.ts` refuses any other file in `changelog.d/` except its README. The changes not yet released are the Unreleased section of `CHANGELOG.md` and the files in `changelog.d/`; `CLAUDE.md` (Conventions) states the rule and `changelog.d/README.md` the form. The base-sync merge of `CHANGELOG.md` entries (card T0-BASE-SYNC-CHANGELOG-2) is unchanged for the cards that still add an entry there.

## Attempt evidence

RED commit 913eb73d (tests only): `node --test tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts` - tests 22, pass 21, fail 1; the new file fails at load with `SyntaxError: The requested module '../infra/changelog.ts' does not provide an export named 'fragmentEntry'`, prose passes.

| Item | Proving test or command | Result |
|---|---|---|
| 1 | tests/surface/changelog-fragments.test.ts, acceptance 1 | pass |
| 2 | tests/surface/changelog-fragments.test.ts, acceptance 2 | pass |
| 3 | tests/surface/changelog-fragments.test.ts, acceptance 3 | pass |
| 4 | tests/surface/prose.test.ts, "tracked prose carries no em dash and no corner brackets"; SCOPE line reviewer-verified | pass |
| 5 | tests/surface/claude-md-size.test.ts, tests/surface/mirror.test.ts; CLAUDE.md 191 to 192 lines, diff reviewer-verified | pass |
| 6 | changelog.d/README.md, reviewer-verified against the diff | written |
| 7 | the eight listed test files in the dod_command | pass |
| 8 | `git diff --stat main` names no path under CHANGELOG.md, templates/, .claude/, src/ or .github/ | reviewer-verified |
| 9 | `npm run typecheck` (dod arm 1) | exit 0 |
