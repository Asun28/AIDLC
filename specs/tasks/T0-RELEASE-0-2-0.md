---
id: T0-RELEASE-0-2-0
title: CHANGELOG.md gets the release section 0.2.0 for every entry written since 0.1.0, the version is 0.2.0 in the five places that carry it, and the 69 test files that pin an entry read the changelog down to the 0.1.0 heading through one helper
status: todo
branch: T0-RELEASE-0-2-0
worktree: D:\wt\AIDLC\T0-RELEASE-0-2-0
size_exception: "approved by the coordinator as planner and approver of the audit changes under the owner's (asun28) instructions of 2026-11-11 and of 2026-11-14 (audit item H12 as a card of its own): the source change is two version literals in src/cli/main.ts; the rest of the budget is one to nine changed lines in each of 69 test files, two new test files and one helper, which cannot be split without leaving the suite red between the parts"
allow_paths:
  - CHANGELOG.md
  - README.md
  - package.json
  - package-lock.json
  - src/cli/main.ts
  - tests/infra/changelog.ts
  - tests/infra/changelog.test.ts
  - tests/surface/release-version.test.ts
  - tests/core/ci-policy.test.ts
  - tests/core/effort.test.ts
  - tests/core/journal-event-types.test.ts
  - tests/core/parse-guard.test.ts
  - tests/core/roles.test.ts
  - tests/infra/build-atomic.test.ts
  - tests/infra/exec-sync-tree.test.ts
  - tests/infra/exec.test.ts
  - tests/infra/github-ship-merge-refused.test.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/init.test.ts
  - tests/infra/ops.test.ts
  - tests/infra/ship.test.ts
  - tests/infra/stray-processes.test.ts
  - tests/scenarios/base-sync-review.test.ts
  - tests/scenarios/candidate-pins.test.ts
  - tests/scenarios/card-close-cleanup.test.ts
  - tests/scenarios/card-goal.test.ts
  - tests/scenarios/dispute-running-attempt.test.ts
  - tests/scenarios/extend-reason.test.ts
  - tests/scenarios/extend-running-card.test.ts
  - tests/scenarios/fault-points.test.ts
  - tests/scenarios/goal-card-count.test.ts
  - tests/scenarios/journal-owed.test.ts
  - tests/scenarios/lesson-dup.test.ts
  - tests/scenarios/merge-unconfirmed.test.ts
  - tests/scenarios/mutants-review.test.ts
  - tests/scenarios/op-intent-dup.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - tests/scenarios/repair-check.test.ts
  - tests/scenarios/review-admit-foreign.test.ts
  - tests/scenarios/review-admit-strand.test.ts
  - tests/scenarios/review-release.test.ts
  - tests/scenarios/review-resolve.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/two-windows.test.ts
  - tests/scenarios/worktree-reclaim.test.ts
  - tests/surface/base-sync-jsdoc.test.ts
  - tests/surface/bench.test.ts
  - tests/surface/card.test.ts
  - tests/surface/claude-md-size.test.ts
  - tests/surface/command-lines.test.ts
  - tests/surface/config.test.ts
  - tests/surface/edge-scope.test.ts
  - tests/surface/fix-task-clear.test.ts
  - tests/surface/hook-git-prefetch.test.ts
  - tests/surface/hook-lazy.test.ts
  - tests/surface/hook-name.test.ts
  - tests/surface/hooks.test.ts
  - tests/surface/init-base-ci.test.ts
  - tests/surface/init-no-package.test.ts
  - tests/surface/lessons.test.ts
  - tests/surface/mutant-gen.test.ts
  - tests/surface/mutants.test.ts
  - tests/surface/pre-review.test.ts
  - tests/surface/prose.test.ts
  - tests/surface/ps-guard-read.test.ts
  - tests/surface/ps-guard-wire.test.ts
  - tests/surface/r2-pass-notes.test.ts
  - tests/surface/readme.test.ts
  - tests/surface/removed-surface.test.ts
  - tests/surface/review-bench-export.test.ts
  - tests/surface/review-bench.test.ts
  - tests/surface/reviewer-env.test.ts
  - tests/surface/templates.test.ts
  - tests/surface/tsconfig-gate.test.ts
  - tests/surface/unattended.test.ts
  - tests/surface/verifier-binding.test.ts
  - tests/surface/verifier.test.ts
  - specs/tasks/T0-RELEASE-0-2-0.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. A new module `tests/infra/changelog.ts` shall export the constant `FIRST_RELEASE_HEADING`, the string `## 0.1.0 - 2026-09-11`, and the function `changelogSince010(text)`. A heading line of a text is a line that equals the heading, at the start of the text or directly after a line feed, and ended by a line feed, by a carriage return and a line feed, or by the end of the text. The function returns `text.slice(start, end)`, where `start` is the index of the heading line `## Unreleased` and `end` is the index of the heading line `FIRST_RELEASE_HEADING` less one, which is the line feed before it. It returns the empty string when either heading line is absent or stands more than once, or when the second does not stand after the first (without that condition a text that begins with the second would give an end of -1). It changes no character of the text.
  - R2. In the test files listed in `allow_paths`, every expression that takes from the text of the repository's CHANGELOG.md the part under `## Unreleased` that ends at the next heading shall take `changelogSince010` of that same text instead. What the test requires or refuses of that part stays as it is, with the same strings, the same comparison and the same messages. Beyond that, a file gains the import of the helper and loses a local constant, guard or function that nothing reads any more; where the old expression stood behind a check or a guard that the heading or the end exists, written for that expression alone or inside a local `section` function that also serves other documents, that check no longer runs for the CHANGELOG text, since the helper returns the empty string for a text without either heading line and every requirement on the part then fails; where a local function took a file path and read the file itself, the test reads CHANGELOG.md the same way (same path, same line-end handling) and gives the text to the helper. Nothing else in those files changes. Acceptance detail 3 names the forms and the places that do not change.
  - R3. CHANGELOG.md shall gain, directly after the line `## Unreleased` and the blank line under it, the line `## 0.2.0 - 2026-11-14`, a blank line, the entry of acceptance detail 5 and a blank line. No other line of the file changes, so every entry that stood under `## Unreleased` stands under the new heading, below this card's entry.
  - R4. The version shall be `0.2.0` in `package.json` (`version`), in `package-lock.json` (the top-level `version` and `packages[""].version`), in the two string literals of `src/cli/main.ts` that hold `0.1.0` (the argument of `.version(` and the `aidlc` member of the `host` object given to the manifest seal) and in the line `Version 0.1.0.` of README.md, which becomes `Version 0.2.0.`. Nothing else in those files changes.
  - R5. A new test file `tests/surface/release-version.test.ts` shall pin the release section of R3 and require that the five places of R4 carry the version of `package.json` (acceptance detail 2).
  - R6. This card shall create no tag and publish nothing, since both need the owner's recorded authority.
acceptance:
  - 1. `tests/infra/changelog.test.ts` "changelogSince010 on each input class". New helper with no RED on main; each clause removed fails a row. [R1] [dod arm 1] Detail in the body section Acceptance detail, item 1.
  - 2. `tests/surface/release-version.test.ts`, three tests on the release section, the version places and the printed version. Each fails on main by assertion. [R3] [R4] [R5] [dod arm 1] Detail item 2.
  - 3. With R3 and without R2, each of the 69 listed test files has at least one failing test, by assertion (119 failing tests were measured on main at d4c878fc with the heading alone); with R2 every test of those files passes. The other test files that name CHANGELOG pass in both states. [R2] [R3] [dod arm 1] Detail item 3.
  - 4. With this card whole and the section 0.2.0 of CHANGELOG.md moved below the section 0.1.0 in a scratch change, each of the 69 listed test files has at least one failing test, and every test that failed in item 3 fails. [R1] [R2] Detail item 4.
  - 5. The CHANGELOG entry is the text of detail item 5 and is the first entry of the section 0.2.0 (required by the release test of item 2). [R3] [dod arm 1]
  - 6. `npm run check` passes (the typecheck and the whole suite). [R1] [R2] [R3] [R4] [R5] [dod arm 1]
depends_on: []
budget: 950
tdd: true
diagnosis:
  root_cause: "CHANGELOG.md has had no release section since `## 0.1.0 - 2026-09-11`: on main at be63a7e4 the section `## Unreleased` holds 226 lines that start with `- ` (audit of 2026-11-11, hygiene item H12; the owner ordered a card of its own on 2026-11-14). A release heading could not simply be inserted, because 69 test files require their card's entry in the part of the file between `## Unreleased` and the next heading, so the heading alone makes 119 tests fail."
  repro: "On a detached checkout of main at d4c878fc, with the two lines `## 0.2.0 - 2026-11-14` and a blank line inserted under `## Unreleased` and nothing else changed, each of the 77 test files that name CHANGELOG was run alone with `node --test`. 69 files had a failing test, 119 tests in all; the 8 others passed. The 69 are the test files of `allow_paths`."
  same_class: "The version stands as a literal in five places with no test that keeps them equal; the test of R5 covers them. A test written after this card that ends its slice at the next heading passes while its entry stands under `## Unreleased` and fails at the next release cut; this card adds no check against that form, which is a non-goal."
sweep: "On main at be63a7e4. `git grep -n Unreleased -- tests src docs README.md CLAUDE.md templates` and `git grep -n -F 0.1.0 -- src tests bin scripts templates docs README.md package.json package-lock.json`. Tests, 128 lines in 67 files hold the literal `## Unreleased` and two more files (tests/scenarios/card-close-cleanup.test.ts, tests/scenarios/worktree-reclaim.test.ts) split the file at its headings; 114 places in the 69 listed files read the part under the heading, and acceptance detail 3 lists them by form. No converted function is called with a text the test built: each gets the repository file, in removal loops with one sentence taken out, which leaves both heading lines single and in order. Source, `unionUnreleasedInsertions` of src/delivery/github-ship.ts resolves a base-sync conflict whose hunks both sides added to the section `## Unreleased`; it reads the section by that name and is unchanged. A branch cut before this card that added its entry at the top of `## Unreleased` meets a CHANGELOG conflict at its base sync that the function refuses, because the base side adds a heading line, so the sync ends `[SHIP-BASE-SYNC-CONFLICT]` for the merge-conflicts skill, which must keep the entry above the 0.2.0 heading; an entry added lower merges with no conflict into the 0.2.0 section, and the release test then fails on that branch until the entry is moved up (measured in scratch repositories on 2026-11-14). At the drafting of this card no open branch changes CHANGELOG.md (T1-OUTCOME-GITHUB, T1-OUTCOME-HISTORY and T1-OUTCOME-USAGE do not). Documents, CLAUDE.md:113 says that a behaviour change is recorded in CHANGELOG.md (Unreleased), which stays true; docs/OPERATIONS.md:612 states the base-sync rule (a hunk that adds a heading is not resolved), which this card leaves true; docs/LESSONS.md:113 describes the slice of tests/surface/templates.test.ts:113, which this card converts, and is left as it is. Version, `0.1.0` stands in package.json:3, package-lock.json:3 and :9, src/cli/main.ts:233 and :1450 and README.md:7; the other hits are comments of src/scaffold/init.ts and one sentence of docs/OPERATIONS.md about the hook wiring of 0.1.0, the seven slice ends `## 0.1.0` of tests/surface/templates.test.ts (:190, :213, :228, :248, :272, :288, :302) and fixture values of tests (tests/scenarios/manifest-lock.test.ts:109, tests/surface/manifest.test.ts:40, three changelog fixtures of the base-sync tests), none of which names the current version. No test reads the `version` of package.json or of package-lock.json."
forbid:
  - weakening, skipping or deleting a test to go green
  - a change to what a converted test requires or refuses of the changelog part (its strings, its comparison, its messages), or to any test line that R2 does not name
  - a change to any line of CHANGELOG.md other than the lines R3 adds, or an entry moved, reworded or removed
  - a tag, a release on GitHub, `npm publish` or `npm version`
  - a change to `unionUnreleasedInsertions` or to any other source line than the two literals of R4
  - a new dependency, or `npm install` changing package-lock.json beyond the two version fields
non_goals:
  - renaming test titles and assertion messages that say Unreleased
  - a check that refuses a new test ending its slice at the next heading
  - the places that already end at the 0.1.0 heading (seven in tests/surface/templates.test.ts, one in tests/surface/bench-drafts-ignore.test.ts) and the fixtures of the base-sync conflict tests
  - one constant for the version in src
  - release notes other than the entries as they stand
hygiene: "Line numbers are from main at be63a7e4; find the code by content. Three commits in this order, so that the RED of the conversion is recorded. Commit 1 adds tests/infra/changelog.ts, tests/infra/changelog.test.ts and tests/surface/release-version.test.ts; the helper rows pass except the row on the repository's CHANGELOG.md, and the three release tests fail by assertion; record both. Commit 2 adds R3 and R4 (the heading, the entry, the five version places); the helper and release tests pass, and each of the 69 listed files run alone has a failing test; record the count per file and that the other test files that name CHANGELOG pass. Commit 3 is the conversion of R2; `npm run check` passes. Convert nothing before commit 2 exists. package-lock.json is edited by hand in its two version fields; run no npm command that writes it. The suite takes about ten minutes, so run `npm run check` with a timeout of at least twenty minutes; a run of the 69 files one by one takes about fifteen. A script that edits many files is written to a file in the scratchpad and run from there, and the diff of every file it touched is read afterwards. Revert table before the first review, each row a scratch change restored afterwards: the revert lists of acceptance detail 1 and 2; the move of detail 4, run against the 69 files; and the helper made to return the part that ends at the next heading (the old reading), run against the 69 files, each of which then has a failing test. Insert nothing in CHANGELOG.md but the lines of R3. Before the first review the coordinator runs the changed test files on Linux as well."
doc_sync: CHANGELOG.md, README.md
---

# T0-RELEASE-0-2-0

## Deliverable
CHANGELOG.md has the release section `## 0.2.0 - 2026-11-14`, which holds every entry written since release 0.1.0; `## Unreleased` above it is empty and takes new entries as before. The version is 0.2.0 in the five places that carry it. The 69 test files that pin a changelog entry read the file through one helper, from `## Unreleased` down to the 0.1.0 heading, so they hold across this cut and the next. No tag, no publish.

## Why
Audit of 2026-11-11, hygiene item H12: `## Unreleased` had grown to 226 lines that start with `- `, with no release since 0.1.0 on 2026-09-11. The owner ordered it as a card of its own on 2026-11-14. The coordinator chose the version 0.2.0 (many additions, no stable public interface yet) and told the owner before the start.

The tests are the reason the card is large. A card's test requires its entry "under Unreleased" by cutting the file at the next heading. Today the next heading is the 0.1.0 heading, so `changelogSince010` returns, for the file as it stands before this card, the same text as most of those expressions; where a form starts one character earlier, leaves out the heading line, trims, or keeps the line feed before the 0.1.0 heading (acceptance detail 3), no assertion of that file depends on the difference (each was read on 2026-11-14: they are `includes`, a line among the lines, a pattern match on a card id, adjacency of two entries, or a count of one entry). After the cut the converted tests require the entry above the 0.1.0 heading, in `## Unreleased` or in a release section after 0.1.0, which is where a released entry stands.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck passes and every test of the suite passes. The whole suite is the DoD because the card changes 69 test files.

## Acceptance detail

### 1
`tests/infra/changelog.test.ts`, test "changelogSince010 on each input class". `U` is `## Unreleased` and `F` is `FIRST_RELEASE_HEADING`. Rows, text and exact result.
- `'# Changelog\n\n' + U + '\n\n- a\n\n' + F + '\n\n- old\n'` gives `U + '\n\n- a\n'`.
- a release heading between the two, `U + '\n\n- n\n\n## 0.2.0 - 2026-11-14\n\n- a\n\n' + F + '\n'`, gives everything before the line feed that precedes `F`: `U + '\n\n- n\n\n## 0.2.0 - 2026-11-14\n\n- a\n'`.
- carriage returns, `U + '\r\n\r\n- a\r\n\r\n' + F + '\r\n'`, gives `U + '\r\n\r\n- a\r\n\r'` (no character changes; the slice ends at the line feed).
- `U` at index 0 and `F` as the last line with no line end, `U + '\n- a\n' + F`, gives `U + '\n- a'`.
- a mention inside a line is no heading line: `U + '\n\n- see `' + U + '` and `' + F + '`\n\n' + F + '\n'` gives `U + '\n\n- see `' + U + '` and `' + F + '`\n'`.
- the empty string for each of: no `U` line (`'# Changelog\n\n' + F + '\n'`); no `F` line (`U + '\n\n- a\n'`); `U` twice as a line; `F` twice as a line; `F` before `U`; `U + ' (next)'` in place of `U`; `F + ' (final)'` in place of `F`; `' ' + U` (a leading blank) in place of `U`; `' ' + F` (a leading blank) in place of `F`; `'## 0.1.0'` alone in place of `F`. The row with `F` before `U` is `F + '\n\n' + U + '\n\n- a\n'`, where `F` stands at index 0.
- the repository's CHANGELOG.md: the result starts with `U` and a line feed, holds the line `## 0.2.0 - 2026-11-14`, holds no line equal to `F`, and in the file it is directly followed by a line feed and `F`.
Revert list, each clause removed alone and failing a row: the line-start condition of `U`; the line-end condition of `U`; the line-start condition of `F`; the line-end condition of `F`; the refusal of a second `U` line; the refusal of a second `F` line; the order condition (the row with `F` at index 0 then gives `U + '\n\n- a'`); the end at the line feed before `F` (an end at the next heading fails the release-heading row; an end at `F` itself fails the first row).

### 2
`tests/surface/release-version.test.ts`. `VERSION` is `0.2.0` and `DATE` is `2026-11-14`.
- "CHANGELOG.md holds the release section between Unreleased and 0.1.0". The lines of CHANGELOG.md that start with `## ` deep-equal `## Unreleased`, `## 0.2.0 - 2026-11-14`, `## 0.1.0 - 2026-09-11`. No line that starts with `- ` stands between the first two at the commit of this card (the test does not require that, since later cards add entries there). Of the lines between the second and the third heading, those that start with `- ` number 227; the first equals the entry of detail 5; the second starts with `- T0-BENCH-DRAFTS-IGNORE-2 (replaces`; the last starts with `- T0-LESSONS-TEST-RUN-ENV:`. On main the heading list has two elements.
- "the version of package.json stands in every place that carries it". `package.json` has `version` equal to `VERSION`; `package-lock.json` has `version` and `packages[""].version` equal to it; README.md has exactly one line `Version 0.2.0.` and no line `Version 0.1.0.`; the text of `src/cli/main.ts` holds `.version('0.2.0')` exactly once and `aidlc: '0.2.0'` exactly once and holds `'0.1.0'` nowhere. On main `package.json` gives `0.1.0`.
- "aidlc --version prints the version". A child process, `process.execPath` with the absolute path of `src/cli/main.ts` and `--version`, exits 0 and prints `0.2.0` and a line feed (probed on main at d4c878fc: it prints `0.1.0` and exits 0, reading no state). The child follows the implementer brief's rules for a child process.
Revert list: each of the five places set back to `0.1.0` alone (six scratch changes, the lock file's two fields apart) fails the second test, and the `.version(` literal also the third; the release heading with another date, the heading removed, and this card's entry moved below the next entry each fail the first.

### 3
The conversion of R2. The 69 test files are those of `allow_paths`; each failed with the heading alone. The forms found on main at d4c878fc, with the count of places, and what each becomes. `X` is the variable holding the changelog text.

| Form | Places | Becomes |
|---|---|---|
| `X.slice(X.indexOf('## Unreleased'), X.indexOf('\n## ', X.indexOf('## Unreleased') + 1))` assigned to a constant | 53 | `changelogSince010(X)` |
| the same expression as the body of a local function `unreleasedOf` | 4 in tests/surface/templates.test.ts, 1 in tests/surface/mutant-gen.test.ts | the body becomes `changelogSince010(<parameter>)` |
| `const start = X.indexOf('## Unreleased')` (4 places with `'\n## Unreleased\n'`, 1 on `docs.changelog`) and a later `X.slice(start, X.indexOf('\n## ', start + 1))`, in some files with a guard for a missing heading or a missing end | 45 | the slice expression, guard included, becomes `changelogSince010(X)`, and `start` and an `end` constant go when nothing else reads them; in tests/infra/ops.test.ts and tests/infra/stray-processes.test.ts an assertion or a condition still reads `start`, so it stays with that reader. The constant has another name in tests/scenarios/candidate-pins.test.ts, tests/core/ci-policy.test.ts slices twice from one `start`, and tests/surface/review-bench.test.ts and tests/surface/review-bench-export.test.ts slice inside an assertion or a condition |
| `X.slice(X.indexOf('## Unreleased'), X.indexOf('## ', X.indexOf('## Unreleased') + 1))` (no line feed) | 1, tests/surface/templates.test.ts:113 | `changelogSince010(X)` |
| `read('CHANGELOG.md').split('## Unreleased\n')[1]?.split('\n## ')[0]` | 2, tests/surface/readme.test.ts | `changelogSince010(read('CHANGELOG.md'))` |
| `.split(/^## /m).find((s) => s.startsWith('[Unreleased]') \|\| s.startsWith('Unreleased'))` | 3, tests/scenarios/card-close-cleanup.test.ts and tests/scenarios/worktree-reclaim.test.ts | `changelogSince010(<the text read>)` |
| a local `section(<text or file>, '## Unreleased')` that ends at the next heading and also serves other documents | 4, tests/scenarios/journal-owed.test.ts, review-release.test.ts, review-resolve.test.ts and tests/surface/verifier-binding.test.ts | the call for CHANGELOG.md becomes `changelogSince010(<the CHANGELOG text that call read>)`; `section` stays for the other documents. In tests/surface/verifier-binding.test.ts `section` takes a path and reads the file, so the test reads CHANGELOG.md as that function does and gives the text to the helper. The heading check inside `section` of review-release.test.ts and review-resolve.test.ts no longer runs for the CHANGELOG call (R2) |
| a table row `[['CHANGELOG.md'], '## Unreleased', <sentences>]` read by a local `section` | 1, tests/surface/verifier.test.ts | the smallest change by which the text checked for that row is `changelogSince010` of the file's text, read as the local `section` reads it; the other rows are read as before, and the heading check of `section` no longer runs for that row (R2) |

The table holds 114 places (counted on main at 340101e4). A place in a listed file that fits no row of the table is converted by the rule of R2 and named in the Attempt evidence with its form.

Not changed:
- the fixtures and expectations of the base-sync conflict tests, texts the tests build, in tests/infra/github-ship.test.ts (the `HEAD_OF` and `withEntry` builders, the hunk rows, the document sentences that quote `## Unreleased`) and tests/infra/github-ship-merge-refused.test.ts (`top`), and the sentinel texts of tests/scenarios/base-sync-committed.test.ts and tests/scenarios/dispute-running-attempt.test.ts;
- the pattern `/## Unreleased[\s\S]*T0-SHIP-BASE-SYNC completed as T0-SHIP-BASE-SYNC-2/` of tests/infra/github-ship.test.ts, which reads the whole file and holds after the cut;
- the seven places of tests/surface/templates.test.ts that end at `'## 0.1.0'`, and tests/surface/bench-drafts-ignore.test.ts;
- titles and messages that say Unreleased (a non-goal).

RED of the conversion: at the commit that holds R3, R4 and the new tests and no conversion, each of the 69 files run alone has at least one failing test and the other test files that name CHANGELOG pass (the 8 measured on main, tests/surface/bench-drafts-ignore.test.ts and the two new test files of this card); the Attempt evidence lists the count per file. Measured for this card on main at d4c878fc with the heading alone: 119 failing tests in the 69 files.

### 4
A scratch script moves the lines of CHANGELOG.md from `## 0.2.0 - 2026-11-14` to the blank line before `## 0.1.0 - 2026-09-11` to the end of the file, so the headings stand in the order Unreleased, 0.1.0, 0.2.0. Each of the 69 files run alone then has at least one failing test, and every test that failed in the RED of detail 3 fails; the release test fails as well. The file is restored afterwards (`git diff --stat` empty). This shows that every converted test still requires its entry above the 0.1.0 heading.

### 5
The CHANGELOG entry, one line, the first entry under `## 0.2.0 - 2026-11-14`. It holds no two hashes followed by a blank, since seven places of tests/surface/templates.test.ts end their slice at the first `## 0.1.0` of the file (lesson of T0-ACCEPT-TABLE).

"- T0-RELEASE-0-2-0 (audit item H12): release section 0.2.0, dated 2026-11-14. Every entry written since release 0.1.0 stands under it, and a new entry goes under the Unreleased heading above it, as before. The version is 0.2.0 in `package.json`, `package-lock.json`, the output of `aidlc --version`, the `aidlc` member of the host a manifest is sealed with, and README.md; no tag was created and nothing was published. The 69 test files that cut the changelog at the heading after Unreleased now read it with `changelogSince010` (`tests/infra/changelog.ts`), from the Unreleased heading down to the heading of release 0.1.0, so an entry stays pinned when a release heading is put above it. `tests/surface/release-version.test.ts` pins the section and requires the same version in the five places."
