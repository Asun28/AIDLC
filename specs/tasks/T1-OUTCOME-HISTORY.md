---
id: T1-OUTCOME-HISTORY
title: "The outcome bench builds the ruling set from git history, classifies each repeat R3 finding by whether its cited code predates decision 1, marks each finding followed by a change to its file, and reports the three"
status: todo
branch: T1-OUTCOME-HISTORY
worktree: D:\wt\AIDLC\T1-OUTCOME-HISTORY
plan_ref: plans/reliability-baseline.md#order-of-work
allow_paths:
  - bench/outcome/history.ts
  - bench/outcome/views/40-history.sql
  - bench/outcome/run.ts
  - bench/outcome/ingest.ts
  - bench/outcome/README.md
  - tests/surface/outcome-history.test.ts
  - tests/surface/outcome-ingest.test.ts
  - tests/surface/outcome-usage.test.ts
  - tests/surface/outcome-github.test.ts
  - specs/tasks/T1-OUTCOME-HISTORY.md
dod_command: npm run typecheck && node --test tests/surface/outcome-history.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-github.test.ts
dod_exit: 0
requirements:
  - R1. `rulings(runner, base)` in `bench/outcome/history.ts` shall return one row per first-parent commit on the base whose message holds `user's ruling` or `user ruling` in any letter case, with `sha`, `date`, `subject`, `cards` (the card ids in the subject, in order), `successor` and `predecessor` (when the subject reads `<A> replaces <B>` with two card ids, else null) and `on` (the subject text after the first `ruling on ` that starts a word, in any letter case, else null).
  - R2. `rulingSet(rulings, tables)` shall return one row per ruling with the ruling's fields plus, for its `predecessor` (else its first card): the stop reason and detail of its last run, the `candidateSha`, `outcome` and `decision` of that run's last formal entry, the findings of that run that have no `resolvedAt` (`id`, `class`, `file`, `reason`; the tables hold no time for an entry, so a finding resolved after the last formal entry is not listed), and `successorMerged`; a ruling whose card has no run keeps null in those fields.
  - R3. `repeatBlocks(runner, tables)` shall return one row per formal finding raised at round 2 or later with `goalId`, `cardId`, `id`, `file`, `line` (from the first `@ <path>:<line>` of its reason when `<path>` is the finding's `file`, else null; the line of a later citation or of another file is never used; the finding's `file` and the cited path are each normalized to a repository-relative path with `.` and `..` segments resolved before any comparison and any git call, and a path that leaves the repository is `unknown` with no git call), `outsideDelta` and `predates`, where `first` is the `candidateSha` of the run's earliest formal entry with outcome `pass` or `block` and `at` the finding's `candidateSha`; earliest here, and next in R5, are by the order in which the run stores its entries, and the entry of a finding is the entry of its stage that records the finding's decision (or round and cycle), the last stored when several do; when no entry of that stage records it, as in records written before entries held a decision, it is the one `block` entry of that stage with the finding's `candidateSha`, and there is none (`unknown`) when no such entry or more than one exists; it is never the first of several entries that have that `candidateSha`.
  - R4. The `predates` value shall be `unknown` when the file, `first` or `at` is missing or either commit is not in the repository; with a line, `true` when the commit `git blame -L <line>,<line> <at> -- <file>` names is `first` or an ancestor of it and `false` otherwise (`unknown` with no error row for a line past the end of the file at `at`, found by counting its lines before the blame; a blame that fails is R6's); with no line, `true` when `git diff --quiet <first> <at> -- <file>` exits 0 and `file-changed` when it exits 1.
  - R5. `findingFixes(runner, tables)` shall return one row per finding that has a `file` and a `candidateSha`, with `changedAfter`: `true` when the file differs between that commit and the `candidateSha` of the next entry of the same run and stage with outcome `pass` or `block` and another `candidateSha`, `false` when it does not differ, and `unknown` when there is no such entry or a commit is not in the repository.
  - R6. A git command that fails in a way R4 and R5 do not name shall add one `history_errors` row with `command`, `exit` and the first line of its stderr, and the row it was computing takes `unknown`; the base is passed to git after `--end-of-options`, a base that is not a revision of the repository gives one `history_errors` row and no other git call by any function of the run (the finding rows are still written, each value `unknown`), and a `candidateSha` that is not 40 hex characters is `unknown` with no git call; hex letters are accepted in either case and compared in lower case; every git call passes the options that fix what it prints and decides against the git configuration of the repository and the user (no colour, the basic pattern type for the line count, no ignored revisions in a blame, no signature lines in a log), so no result changes with that configuration; and every git call runs with lazy fetching disabled, so a missing object is an error row and never a fetch.
  - R7. `run.ts` shall take `--no-history` and write `rulings.jsonl`, `ruling_set.jsonl`, `repeat_blocks.jsonl`, `finding_fixes.jsonl` and `history_errors.jsonl` beside the other tables through `writeTables` with the read-only directories `run.ts` already passes, their columns declared in `bench/outcome/ingest.ts` beside the existing ones; the `run.ts` spawns of `tests/surface/outcome-ingest.test.ts`, `tests/surface/outcome-usage.test.ts` and `tests/surface/outcome-github.test.ts` pass `--no-history`, so those tests read no history of the checkout they run in, and the `run.ts` spawns of `tests/surface/outcome-history.test.ts` pass `--no-usage` and `--no-github`; the one exception is the run of `tests/surface/outcome-github.test.ts` with neither `--no-usage` nor `--no-github` (T1-OUTCOME-GITHUB-2 acceptance 12), which starts in a fixture repository, passes no `--no-history` and is the one run with every stage on.
  - R8. `views/40-history.sql` shall define `summary_repeat_blocks` (the count and share of each `predates` value, and the count where `predates` is `true` and `outsideDelta` is not true or the reverse), `summary_true_defects` (per stage and perspective: findings raised, disputed, re-raised, and those on a card with a `mergeVerified` run that have `resolvedAt` and `changedAfter` `true`) and `summary_rulings` (rulings per calendar month, rulings per `on` value, card attempts per ruling, and the share of cards with `superseded_by` that are the `predecessor` of a ruling); in each view a null `on`, `stage`, `perspective`, `predates` or month is a group of its own, a null `predecessor` matches no card, a null count or flag is not counted, and a share whose denominator is 0 is null; card attempts per ruling is the number of rows of `card_attempts` divided by the number of rulings, one figure.
  - R9. `bench/outcome/README.md` shall state the ruling match, the `predates` rule with its four values, the true-defect proxy and that it cannot show whether a test or another reviewer would have caught the same defect.
acceptance:
  - 1. `tests/surface/outcome-history.test.ts`, in a real temporary git repository: `rulings` returns a commit titled `card: T1-A-2 replaces T1-A by the user's ruling on R3 decision 4` with `successor` `T1-A-2`, `predecessor` `T1-A` and `on` `R3 decision 4`; a commit whose body holds `USER RULING` with one card id and null `successor`; and not a commit that holds only `ruling`, nor one reached only through a merged side branch. [R1] [dod arm 2]
  - 2. Same file: `rulingSet` joins the first ruling to the last run of `T1-A` with its stop detail, the last formal entry, the one finding still open at it and `successorMerged` true, and gives null fields for a ruling whose card has no run. [R2] [dod arm 2]
  - 3. Same file, same repository: for a finding raised at round 2, `predates` is `true` when the cited line was last changed before the first reviewed commit, `false` when the repair changed it, `unknown` for a line past the end of the file, for a `candidateSha` that is not in the repository and for a finding with no `file`; with no line it is `true` for a file the repair did not touch and `file-changed` for one it did. A round 1 finding gives no row. [R3] [R4] [dod arm 2]
  - 4. Same file: `findingFixes` gives `true` for a finding whose file the next reviewed commit changed, `false` for one it left alone, and `unknown` for a finding of the last reviewed commit and for an entry that repeats the same `candidateSha`. [R5] [dod arm 2]
  - 5. Same file: a runner that exits 128 with `fatal: boom` on the blame of an existing line gives one `history_errors` row holding `fatal: boom` and `predates` `unknown` for that finding, with the other findings still classified. [R6] [dod arm 2]
  - 6. Same file, when a DuckDB binary is found, else skipped with the reason `no duckdb binary`: `run.ts` over the fixture prints `summary_repeat_blocks`, `summary_true_defects` and `summary_rulings` with hand-computed values, and `--no-history` writes none of the five files and exits 0. [R7] [R8] [dod arm 2]
  - 7. The README states R1 to R8 (reviewer-verified against the diff). [R9]
  - 8. `tests/surface/outcome-ingest.test.ts`, `tests/surface/outcome-usage.test.ts` and `tests/surface/outcome-github.test.ts` pass unchanged apart from `--no-history` in their `run.ts` spawns and the assertions of item 10, with and without a DuckDB binary. [R7] [dod arm 2]
  - 10. `tests/surface/outcome-github.test.ts`: its run with neither `--no-usage` nor `--no-github` passes no `--no-history`, exits 0 and writes the five history files beside the usage and GitHub files. [R7] [dod arm 2]
  - 11. Same file: with a base that is not a revision and tables that hold findings, the tables of the run hold one `history_errors` row and the runner was called once; for entries with the commits A, B, A in that order, a finding raised at the third has `changedAfter` `unknown`; a reason `x @ a.ts: see @ b.ts:1` with `file` `a.ts` gives a null `line`; a `candidateSha` in upper case and one in mixed case are classified as the same commit in lower case is, in `repeatBlocks` and in `findingFixes`; a finding whose stage has no entry with a decision is classified from the one `block` entry with its `candidateSha`, and is `unknown` when two `block` entries have it; a subject holding `overruling on x` gives a null `on`. [R1] [R3] [R5] [R6] [dod arm 2]
  - 12. Same file, in the real temporary git repository: with `grep.patternType` `fixed`, with `color.grep` `always`, with `color.ui` `always`, with `log.showSignature` `true` and with a `blame.ignoreRevsFile` that names the commit of the cited line, each set in the configuration of that repository, the rulings and the `predates` value of a finding on an existing line are what they are without the setting, with no `history_errors` row; the `log.showSignature` row holds unsigned commits only and is a regression check, not a proof of that option (non-goal). [R6] [dod arm 2]
  - 13. Same file: a finding whose `file` is `bench/../README.md` and that cites line 1 has the `predates` value of the same finding with `file` `README.md`; a `file` of `../x` is `unknown` with no git call; every git call of a run is made with lazy fetching disabled, asserted on the calls the runner received. [R3] [R6] [dod arm 2]
  - 9. Same file as item 1: a base of `--output=x` writes no file and gives one `history_errors` row, and a finding whose `candidateSha` is `--output=x` is `unknown` with no git call. [R6] [dod arm 2]
depends_on: [T1-OUTCOME-INGEST, T1-OUTCOME-GITHUB-2]
budget: 850
sweep: "New files, plus `bench/outcome/run.ts` and the README. `git log -i --grep=\"user's ruling\"` on main at 8156bf5 returns 23 commits, the recent ones titled `card: <A> replaces <B> by the user's ruling on <what>`. `ReviewFinding` (src/core/types.ts:503) holds `file`, `candidateSha`, `round`, `outsideDelta` and `resolvedAt`; the cited line is in `reason` as `@ file:line`. Git runs through the injectable runner, as `src/probes/git.ts` does. Amended on 2026-11-11 before the card started, from T1-OUTCOME-USAGE and T1-OUTCOME-GITHUB: the card runs after both successors merge, so the three stages disable each other in their test spawns; an option-shaped base or commit id was a decision 1 block on T1-OUTCOME-GITHUB, so R6 and acceptance 9 state it here; budget 700, since the three earlier cards came to 660, 760 and 1050 changed lines against plans of 450. Amended again after PR 257: `ingest.ts` is in scope for the column declarations, as it was for the two earlier stages, and R8 states what a missing value does in the views (lesson of T1-OUTCOME-GITHUB-2). Amended from R3 decision 1, which blocked 3817ea0f on four classes: invalid-base-continues-git, finding-entry-sha-alias, citation-line-file-mismatch and uppercase-sha-rejected; R3, R5, R6 and acceptance 11 state each. R3 decision 3 blocked 82b78013 on four findings; by the user's ruling of 2026-11-11 two are repaired (git-path-output-mismatch and lazy-fetch-network: R3, R6 and acceptance 13) and two are non-goals (git-blame-config-leak for a missing ignore file, and unsigned-signature-regression-test)."
forbid: [any change under src/ templates/ or .claude/, a git command that writes (checkout, reset, update-ref, gc, fetch), a dependency added to package.json, a network call]
non_goals: [rulings recorded only in chat or in a card body (not found; the README says so), a line cited as a range (the first line is used), pre-review findings in `repeat_blocks` (formal only), deciding whether a finding was a true defect (the proxy only; the labels are T1-OUTCOME-BASELINE), a `blame.ignoreRevsFile` that names a missing file (the blame fails and the row is `unknown` with an error row; left by the user's ruling of 2026-11-11), a `log.showSignature` test with a signed commit (it needs a signing key in the fixture; same ruling)]
hygiene: "Old candidate commits may be gone from the repository. `unknown` is a result, not a failure, and the views report its count."
doc_sync: bench/outcome/README.md
---

# T1-OUTCOME-HISTORY

## Deliverable
The ruling set, the repeat-block classification against decision 1, the findings followed by a fix, and their three views.

## Why
The stated cause of most replaced cards is R3 raising a new finding at each decision on code that was already there at decision 1. `outsideDelta` records that per file from the review side; `git blame` checks it per line from the repository side. The ruling set is the labelled data any later change to the gate is replayed against.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-history.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-github.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; item 6 is skipped only where no DuckDB binary is found.

## Attempt evidence

Attempt 1. RED commit d2f58ca9 (a seam with the final signatures and empty results): 7 tests, 0 pass, 7 fail, each on its assertion. After RED the ids of the three findings of the second fixture run changed from G1 to G3 to F1 to F3, since `CardRun` accepts only `F<digits>`, and acceptance 9 got one more entry (mutant R6c).

Attempt 2 repairs the four findings of R3 decision 1 on 3817ea0f. RED commit 610a6856: 11 tests, 6 pass, 4 fail (the four of item 11, each on its assertion), 1 skipped. The fixture then got `cycle: 0` on its pre findings and acceptance 9 a `decision` on its entries, since the raising entry is now found by them.

Attempt 3 applies the ruling on entries stored without a decision and the word start of `ruling on `. RED commit 555a8559: 13 tests, 10 pass, 2 fail (`acceptance 11, no decision` and `acceptance 11, on`, each on its assertion), 1 skipped.

Attempt 4 repairs F5 of R3 decision 2 (git-grep-config-leak) for every git call. RED commit 0885dbe5: 18 tests, 13 pass, 4 fail, 1 skipped; `grep.patternType`, `color.grep`, `color.ui` and `blame.ignoreRevsFile` fail on the assertion, and `log.showSignature` passes at once, since no fixture commit is signed, and stays as a regression.

DoD (attempt 4): `npm run typecheck` exit 0; the four test files exit 0 with `DUCKDB_BIN` (50 tests, 50 pass) and exit 0 without it (50 tests, 42 pass, 8 skipped `no duckdb binary`).

| Item | Test or command | Result |
|---|---|---|
| 1 | `outcome-history.test.ts` `acceptance 1: rulings returns the first-parent commits ...` | pass |
| 2 | `acceptance 2: rulingSet joins a ruling to the last run of its predecessor ...` | pass |
| 3 | `acceptance 3: repeatBlocks classifies each formal finding of round 2 or later ...` | pass |
| 4 | `acceptance 4: findingFixes is true for a file the next reviewed commit ... changed ...` | pass |
| 5 | `acceptance 5: a blame that exits 128 on an existing line is one history_errors row ...` | pass |
| 6 | `acceptance 6: run.ts prints the repeat blocks per predates value ...` | pass with DuckDB, else skipped |
| 7 | README sections `History tables (history.ts)` and `Views (views/40-history.sql)` | for the reviewer |
| 8 | the three other test files, changed only in `run.ts` spawn arguments and the assertions of item 10 | pass, both ways |
| 9 | `acceptance 9: a base of --output=x writes no file and is one history_errors row ...` | pass |
| 10 | `outcome-github.test.ts` `T1-OUTCOME-GITHUB-2 acceptance 12`, the run with neither flag | pass with DuckDB, else skipped |
| 11 | `acceptance 11, base ...`, `acceptance 11, entry ...`, `acceptance 11, citation ...`, `acceptance 11, case ...`, `acceptance 11, no decision ...`, `acceptance 11, on ...` | pass |
| 12 | `acceptance 12: with <key> set in the repository ...`, one test per setting, five | pass |

Item 10 changed two assertions of that run, not one: the file list, and the list of printed views, which now holds the three history views.

Mutants (one expression changed, `outcome-history.test.ts` run with DuckDB, the file restored):

| Req | Mutant | Result |
|---|---|---|
| R1 | `log` without `--first-parent` | killed (1, 6) |
| R2 | last run by `<=` on `startedAt` | killed (2) |
| R3 | round `>= 1` | killed (3, 5, 6) |
| R4 | `merge-base --is-ancestor` with its arguments swapped; `first` from the first formal entry of any outcome | killed (3, 5, 6), both |
| R5 | next entry without "another `candidateSha`"; entries of the formal stage for every finding | killed (4), both |
| R6 | no 40-hex check of `at` in `predates`; no error row for exit 128; no 40-hex check of `at` in `findingFixes` | killed (9); killed (5, 9); survived, then killed (9) after an entry with a commit of the repository was added behind the finding's |
| R7 | `40-history.sql` run with `--no-history` | killed (6) |
| R8 | `fixed` without `resolvedAt`; without `mergeVerified`; `outsideDelta IS DISTINCT FROM false`; share by `successor` | killed (6), all four |
| F1 | attempt 2: `historyTables` keeps the runner after a base that does not resolve | killed (11 base) |
| F2 | attempt 2: raising entry found by `candidateSha`; next entry searched from the raising entry, not after it | killed (11 entry); survived, equivalent while an entry and its findings record one commit, since the raising entry then never has "another `candidateSha`" |
| F3 | attempt 2: line taken without the path check; paths compared as written; line count read from any last line of the `grep` output | killed (11 citation), all three |
| F4 | attempt 2: ids not lowered; `first` not lowered; a later entry compared as stored | killed (11 case), all three |
| R3, R5 | attempt 3: fallback entry of any outcome; the first of several block entries taken; the fallback used before the recorded decision | killed (11 no decision), twice; killed (4, 11 entry, 11 case) |
| R1 | attempt 3: `ruling on ` matched inside a word | killed (11 on) |
| R6 | attempt 4, one option removed per key group | killed: the basic pattern type (12 grep.patternType), `--no-color` of grep (12 color.grep, color.ui), `-z` (3, 5, 11), `--ignore-revs-file=` (12 blame.ignoreRevsFile). Survived, with no test here: `--no-recurse-submodules`, `--no-textconv` of blame, the blame diff algorithm, `--no-show-signature` (no fixture commit is signed), `--no-color` and `--encoding` of log, `--no-textconv` and `--ignore-submodules` of diff |

F5 key list, per command (README, `Git configuration (R6)`): `grep`: `grep.patternType`, `grep.extendedRegexp` (`--basic-regexp`), `color.grep`, `color.ui` (`--no-color`), `core.quotePath` (`-z`), `submodule.recurse` (`--no-recurse-submodules`); `grep.fullName` changes nothing in the root of the checkout. `blame`: `blame.ignoreRevsFile`, `blame.markIgnoredLines`, `blame.markUnblamableLines` (`--ignore-revs-file=`), textconv (`--no-textconv`), `diff.algorithm`, `diff.indentHeuristic` (`--diff-algorithm=myers --indent-heuristic`); the porcelain form has no date, email or colour. `log`: `log.showSignature` (`--no-show-signature`), `i18n.logOutputEncoding` (`--encoding=UTF-8`), colour (`--no-color`); `%H %cI %B` do not change with `log.date`, `log.mailmap`, `log.decorate`, `log.abbrevCommit` or `format.pretty`. `diff --quiet`: `diff.external` (`--no-ext-diff`), textconv (`--no-textconv`), `diff.ignoreSubmodules` (`--ignore-submodules=none`). `rev-parse --verify` and `merge-base --is-ancestor`: no key. Not covered, and not stated by the card: a `blame.ignoreRevsFile` naming a missing file (each blame fails: error row, `unknown`), replace refs and grafts, a partial clone.

R3 decision 1 (RED 610a6856, each test `acceptance 11, <name>` in `outcome-history.test.ts`), with the sweep of its class:
- F1 invalid-base-continues-git, test `base`: `historyTables` resolves the base once and gives the readers a git that makes no call when it fails. Sweep: `rulings` already stopped; a `rev-parse` that exits 0 without a commit id stopped with no row and now adds one; `rulingSet` makes no git call; `run.ts` calls only `historyTables`. Work continues after a failed `log` (no ruling, findings still classified) and after any failed per-finding command (that row `unknown`): both are R6's "the row it was computing".
- F2 finding-entry-sha-alias, test `entry`: the raising entry is found by `decision`, or `round` and `cycle`. Sweep: `first` and the entries are per goal and card (`entriesOf`); the last run of a card is chosen over all goals by `startedAt`, then read by goal and card; the last formal entry is by stored order; the view joins `finding_fixes` on goal, card and id (the fixture repeats F1 to F3 in two runs; the real run has 774 findings and 774 such keys); a card that is the predecessor of two rulings counts once (`EXISTS`).
- F3 citation-line-file-mismatch, test `citation`: the first citation is parsed with its optional line, as `findingLocation` of `src/core/review-policy.ts` reads the path, and its path compared with `file` after one normalisation. Sweep: the `grep -c` count was read from the last line of any output and is now read only from the one line of that commit and file (same test, the directory row); the blame sha, the log record and the first stderr line are anchored; `replaces` and `ruling on` take the first match in the subject.
- F4 uppercase-sha-rejected, test `case`: `sha()` lowers a 40-hex id of the state where it is read (`first`, `at`, each later entry, the `candidateSha` of `ruling_set`). Sweep: shas in git output are matched in lower case only, which is what git prints; card ids, goal ids and finding ids are compared as written.

Where the eight review points are applied:
1. Option-shaped values: `rulings` passes the base after `--end-of-options`; `predates` and `findingFixes` test `SHA` before any git call; every file follows `--`, with `--literal-pathspecs` for `grep` and `diff` (acceptance 9).
2. Failures: `gitOn` in `history.ts` never throws and adds the `history_errors` row. Answers by exit code: `rev-parse --verify --quiet` 0 held, 1 not held; `grep -c` 0 with the line count, 1 no line or no file; `merge-base --is-ancestor` 0 ancestor, 1 not; `diff --quiet` 0 same, 1 differs. `blame` has no negative answer: a line past the end is found by `grep -c` first, so any blame failure is an error row.
3. Invocation directory: `run.ts` gives a runner with `cwd` the main checkout; `history.ts` calls no `path` function and reads no file.
5. Mutants: the table above. 6. Fixtures: two runs of T1-A with different stops, read in the other order than they started; rulings in two months (1 and 2) and two `on` groups (2 and 1); `first` differs from the first stored entry; three files with different histories.
7. Determinism: rulings in git log order, the other tables in `tables.findings` order, `writeTables` sorts the lines, each view has an `ORDER BY`; no clock is read; fixture commits set both git dates.
8. README: each sentence was checked against the code; the real run below agrees with it.

4. Null handling in `40-history.sql`:
- `summary_repeat_blocks`: `GROUP BY predates` and `ORDER BY predates NULLS LAST`: a null is its own group, last. `predates IS NOT DISTINCT FROM 'true'`: a null is not `true`. `outsideDelta IS NOT DISTINCT FROM true`: a null is not true. `share`: the denominator is the row count, never 0 in a row that exists.
- `summary_true_defects`: `GROUP BY stage, perspective`, both `NULLS LAST`: a null of either is its own group. `disputes > 0`, `reraises > 0`: a null count is not counted. `resolvedAt IS NOT NULL`. `x.changedAfter = 'true'`: no `finding_fixes` row, or a null, is not fixed. `cardId IN (... WHERE mergeVerified)`: a null `cardId` or `mergeVerified` is not fixed.
- `summary_rulings`: `substr(date, 1, 7)`: a null `date` is its own group with a null key. `GROUP BY "on"`: a null is its own group. `nullif(count, 0)` in both ratios: a 0 denominator gives null. `r.predecessor = c.id`: a null predecessor matches no card. `ORDER BY metric, key NULLS LAST`.
- Not stated by R8, and read as above: a null `perspective`, a null `date`, a null `disputes`, `reraises`, `outsideDelta`, `cardId` or `mergeVerified`; that "card attempts per ruling" is rows of `card_attempts` over rulings; where a null `predecessor` is "a group of its own" (it is only compared here, never grouped).

Real run (read-only, main checkout state, `--no-usage --no-github`, exit 0), attempt 4: rulings 31, repeat_blocks 179 (predates false 89, true 83, unknown 7), finding_fixes 780 (changedAfter true 505, false 32, unknown 243), history_errors 0. The state grew since attempt 3 (779 findings, 500 / 32 / 247 and 89 / 82 / 7): on the same state the code of c74c7e58 and this code write the five tables byte for byte alike.

