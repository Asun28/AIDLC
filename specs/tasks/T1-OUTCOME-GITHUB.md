---
id: T1-OUTCOME-GITHUB
title: "The outcome bench reads pull requests, check runs and reverts through `gh` and git, and reports accepted changes, the PR success rate and every mismatch between card runs and GitHub"
status: todo
branch: T1-OUTCOME-GITHUB
worktree: D:\wt\AIDLC\T1-OUTCOME-GITHUB
plan_ref: plans/reliability-baseline.md#order-of-work
allow_paths:
  - bench/outcome/github.ts
  - bench/outcome/views/30-github.sql
  - bench/outcome/run.ts
  - bench/outcome/ingest.ts
  - bench/outcome/README.md
  - tests/surface/outcome-github.test.ts
  - tests/surface/outcome-ingest.test.ts
  - specs/tasks/T1-OUTCOME-GITHUB.md
dod_command: npm run typecheck && node --test tests/surface/outcome-github.test.ts tests/surface/outcome-ingest.test.ts
dod_exit: 0
requirements:
  - R1. `pullRequests(runner, repository)` in `bench/outcome/github.ts` shall return one row per pull request of the repository in any state, read through `gh api --paginate` on the injected runner, with `number`, `headRef`, `baseRef`, `state`, `createdAt`, `mergedAt`, `closedAt`, `mergeCommitSha` and `headSha`.
  - R2. `checkRuns(runner, repository, shas)` shall return one row per check run of each given commit with `sha`, `name`, `status`, `conclusion`, `startedAt`, `completedAt` and `runAttempt` (the attempt of the workflow run in which the check run's job ran, read from the jobs of each attempt when the run has more than one, so the checks of attempt 1 and of attempt 2 keep their own number; null when the check run names no workflow run, and null with one `github_errors` row when the jobs of an attempt could not be read and no attempt read holds the check run).
  - R3. `reverts(runner, base)` shall return one row per first-parent commit on the base whose message holds `This reverts commit <40 hex>` (hex letters in either case), with `sha`, `date`, `revertedSha` (in lower case) and `daysAfter` (commit date difference in days, null when the reverted commit is not an ancestor of the base, a commit merged through a second parent included as an ancestor); the base is passed to git after `--end-of-options`, and a base that is not a revision of the repository gives one `github_errors` row and no git output.
  - R4. `branchCommits(runner, base, pulls)` shall return one row per commit of each merged pull request's head that is not on the base before its merge, with `number`, `sha`, `date`, `merge` (true when the commit has more than one parent) and `modelCoAuthor` (true when a `Co-Authored-By:` trailer, as git parses the trailer block of the message and not a line of its body, names Claude, Codex or GPT, case-insensitive).
  - R5. A `gh` or git command that exits non-zero, times out or prints output that is not the expected JSON shall add one `github_errors` row with `command`, `exit` and the first line of its stderr, and the function shall return the rows it has; a rate-limit response (HTTP 403 or 429) is reported the same way and not retried.
  - R6. `run.ts` shall take `--no-github`, call these functions for the configured repository and base, and write `prs.jsonl`, `checks.jsonl`, `reverts.jsonl`, `branch_commits.jsonl`, `github_errors.jsonl` and `required_checks.jsonl` (one row per name in the configured `github.requiredChecks`) through `writeTables` with the read-only directories `run.ts` already passes, their columns declared in `bench/outcome/ingest.ts` beside the existing ones and never added to another module's constant at run time; check runs are read for each merged pull request's head and merge commit; the `run.ts` spawns of `tests/surface/outcome-ingest.test.ts` pass `--no-github`, so that test makes no `gh` call.
  - R7. `views/30-github.sql` shall define `accepted_changes` (one row per card attempt with the booleans `merged`, `checksGreen` (for every check named in `required_checks`, its latest run on the merge commit concluded `success`, where a run that has not completed, a null `startedAt` included, is later than any completed one and is not a success), `notReverted` (no revert of the merge commit within 14 days), `noHumanCommit` (true when every branch commit that is not a `merge` has `modelCoAuthor`, false when one does not, null when the branch commits of the pull request could not be read), `noRuling` (no run of the card carries `stopReview` and the card is not the direct successor of one that does), `accepted` (the first three and `noRuling` true and `noHumanCommit` not false) and `acceptedStrict` (all five true)), joined to card runs by `prNumber`, else by `headRef` equal to the card id.
  - R8. The same file shall define `summary_pr_success` (accepted / card attempts and acceptedStrict / card attempts, with the count failing each boolean and the count of cards with a merged pull request whose `noHumanCommit` is null), `summary_lead_time_pr` (the p50 and p90 hours from the `startedAt` of the earliest run of the card to the `mergedAt` of its merged pull request, with the count of merged cards that have no such pull request), `summary_ci` (the share of merged pull requests whose head had a check run with `runAttempt` above 1, and the share whose first attempt of a required check did not conclude `success`, the first attempt being the run with the lowest `runAttempt`, else, among runs with no `runAttempt`, one with no `startedAt` before any that has one, else the earliest `startedAt`) and `summary_reconcile` (card runs with `mergeVerified` and no merged pull request, merged pull requests whose `headRef` is a card id with no `mergeVerified` run, and pull requests closed unmerged per card, a pull request belonging to a card by a run's `prNumber` or by a `headRef` equal to a card id of the registry, each card and pull request pair once).
  - R9. `bench/outcome/README.md` shall state the `gh` calls made, the accepted-change definition, that `noHumanCommit` is a trailer check and not proof of authorship, and that the 14-day revert window is still open for merges younger than 14 days.
acceptance:
  - 1. `tests/surface/outcome-github.test.ts`: with `scriptedRunner` returning two pages of pull requests, `pullRequests` returns the rows of both pages with the fields of R1, a pull request with a null `merged_at` included. [R1] [dod arm 2]
  - 2. Same file: `checkRuns` maps a check run of a workflow run on attempt 2 to `runAttempt` 2 and a check run with no workflow run to null. [R2] [dod arm 2]
  - 3. Same file, in a real temporary git repository: `reverts` finds a revert made 3 days after its target, ignores a commit whose subject starts with `Revert` and has no `This reverts commit` line, and reports null `daysAfter` for a sha that is not on the base. [R3] [dod arm 2]
  - 4. Same file, same repository: `branchCommits` lists the two commits of a merged branch, `modelCoAuthor` true for a `Co-Authored-By: Claude` trailer in any letter case and false for a commit with none, `merge` true for a merge of the base into the branch and false for the others, and lists no commit that was on the base before the merge. [R4] [dod arm 2]
  - 5. Same file: a runner exit of 1, a timeout, output `not json` and a 429 body each give one `github_errors` row and the rows read before it; the runner is called once per command. [R5] [dod arm 2]
  - 6. Same file, when a DuckDB binary is found, else skipped with the reason `no duckdb binary`: `run.ts` over a fixture of four cards (accepted; merged with a red required check; merged and reverted after 2 days; superseded after a `stopReview`) prints `summary_pr_success` 1 of 4 with one failure under each of `checksGreen`, `notReverted`, and `merged`, the `summary_lead_time_pr` the fixture timestamps give, the `summary_ci` shares and one row of each `summary_reconcile` kind; `--no-github` writes none of the six files and exits 0. [R6] [R7] [R8] [dod arm 2]
  - 7. The README states R1 to R8 (reviewer-verified against the diff). [R9]
  - 9. Same file as item 6, same skip: a card whose only branch commit without a trailer is a `merge` has `noHumanCommit` true; a card whose branch commits could not be read has `noHumanCommit` null, is `accepted`, is not `acceptedStrict` and is in the null count of `summary_pr_success`; a card with a non-merge commit without a trailer is neither. [R7] [R8] [dod arm 2]
  - 10. Same file: a workflow run with two attempts gives the check run of attempt 1 `runAttempt` 1 and that of attempt 2 `runAttempt` 2; a revert of a commit that reached the base through a merge's second parent has a `daysAfter`; a commit whose body quotes `Co-Authored-By: Claude` followed by prose has `modelCoAuthor` false; a base of `--output=x` writes no file and gives one error row; a required check with an earlier success and a queued rerun is not green; a closed unmerged pull request is listed for a card whose run names its replacement and for a registry card with no run. [R2] [R3] [R4] [R5] [R7] [R8] [dod arm 2]
  - 11. Same file: when the jobs call of attempt 1 fails (HTTP 429) and attempt 2 does not hold the check run, its `runAttempt` is null with one error row; a required check cancelled with no `startedAt` on attempt 1 and green on attempt 2 counts as a first-attempt failure in `summary_ci`; a revert message with an upper-case sha gives a row with the sha in lower case; a revert whose target is not an ancestor of the base gives null `daysAfter` and no `github_errors` row, through a git call that exits 0 for that answer. [R2] [R3] [R5] [R8] [dod arm 2]
  - 8. `tests/surface/outcome-ingest.test.ts` passes unchanged apart from `--no-github` in its `run.ts` spawns, with and without a DuckDB binary. [R6] [dod arm 2]
depends_on: [T1-OUTCOME-INGEST]
budget: 1100
sweep: "New files, plus `bench/outcome/run.ts` and the README. The runner is the existing injectable one: `scriptedRunner` in src/probes/exec.ts is what tests/ use; `aidlc.config.json` holds `repository` (Asun28/AIDLC), `base` (main) and `github.requiredChecks` (four names), which `run.ts` writes as `required_checks.jsonl`. Amended on 2026-11-10 before the card started, from T1-OUTCOME-INGEST (PR 255): the journal holds no `CARD_STATE` to `CLOSE`, so 41 of 153 merged runs are missing from `summary_lead_time`, and the merge time comes from the pull request here; output goes through `writeTables`, which holds the one output rule (that card's R15)."
forbid: [any change under src/ templates/ or .claude/, a write to GitHub (no POST PATCH PUT or DELETE and no `gh pr` subcommand that mutates), a retry loop on a rate limit, a dependency added to package.json]
non_goals: [reverts made by a pull request that edits files without the `This reverts commit` line (not detected; the README says so), check runs of commits that are neither a merged head nor a merge commit, GitHub Enterprise hosts, pull requests of forks]
hygiene: "Tests never call the real `gh`. The one real call is the arc proof on this repository."
doc_sync: bench/outcome/README.md
---

# T1-OUTCOME-GITHUB

## Deliverable
Pull request, check, revert and branch-commit tables, the accepted-change view, the PR success rate and the reconciliation of card runs with GitHub.

## Why
A merged card is not an accepted change: the definition also needs green checks on the merge commit, no revert in 14 days, no human commit and no ruling. Only GitHub and git hold the first three.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-github.test.ts tests/surface/outcome-ingest.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; item 6 is skipped only where no DuckDB binary is found.

## Attempt evidence

Attempt 1. RED: commit a889e3bb (the test file and a seam `github.ts` whose readers return empty results); `node --test tests/surface/outcome-github.test.ts` failed 7 of 7 on assertions with `DUCKDB_BIN` set, and 6 of 7 with 1 skipped without it. The first GREEN state failed the DoD with DuckDB on `T1-OUTCOME-INGEST acceptance 5` (four more `summary_*` views than it lists) and its ingest spawns reached `gh`; the card was amended on main (8e4b5fd5, R6 and acceptance 8), main was merged into the branch, and the two spawn helpers of the ingest test now pass `--no-github`.

Second amendment (82cf8069: `merge`, the null `noHumanCommit`, `acceptedStrict`, the null count, the columns in `ingest.ts`). RED: commit 469e23c1 (test changes only); 3 of 7 failed on assertions with `DUCKDB_BIN` (acceptance 3 and 4 on the `git log` format and the `merge` field, acceptance 6 and 9 on the summary columns), 2 failed and 1 was skipped without it.

DoD on the final candidate, real `gh` on PATH, no stand-in: exit 0 without `DUCKDB_BIN` (17 tests, 14 pass, 3 skipped `no duckdb binary`) and exit 0 with it (17 tests, 17 pass).

### Acceptance
| Item | Test | Result |
|---|---|---|
| 1 | `outcome-github.test.ts`, `acceptance 1: pullRequests returns the rows of both pages ...` | pass |
| 2 | `acceptance 2: checkRuns gives a check run of a workflow run on attempt 2 runAttempt 2 ...` | pass |
| 3 | `acceptance 3: reverts finds a revert made 3 days after its target ...` (real git) | pass |
| 4 | `acceptance 4: branchCommits lists the commits of each merged branch ...` (real git): pull request 11 lists `aM`, a merge of main into the branch, with `merge` true, and `n1`, on main before the merge, is not listed | pass |
| 5 | `acceptance 5: a runner exit of 1, a timeout, output that is not JSON and a 429 body ...` and `acceptance 5 through run.ts: a failing gh call is a row of github_errors.jsonl ...` | pass |
| 6 | `acceptance 6 and 9: run.ts prints the PR success rate, the PR lead time, the CI shares and the reconciliation ...` | pass with `DUCKDB_BIN`, skipped without |
| 7 | README sections "GitHub tables (`github.ts`)" and "Views (`views/30-github.sql`)" | reviewer-verified against the diff |
| 8 | `outcome-ingest.test.ts`, changed only by `'--no-github'` in `runOutcome` and `spawnRun` | 10 pass with `DUCKDB_BIN`; 8 pass, 2 skipped without |
| 10 | `acceptance 2` (attempts 1 and 2 of one workflow run), `acceptance 3` (the second-parent target, the base `--output=x`), `acceptance 4` (`f2`, a quoted `Co-Authored-By: Claude` line followed by prose), `acceptance 6, 9 and 10` (the queued rerun, the closed pull requests of T1-RED and T1-NEXT) | pass; the last with `DUCKDB_BIN`, skipped without |
| 11 | `acceptance 2` (`d`: attempt 1 answers HTTP 429 and attempt 2 does not hold it, null with one error row), `acceptance 6, 9 and 10` (`summary_ci`: pull request 12, ci cancelled with no `startedAt` on attempt 1 and green on attempt 2), `acceptance 3` (`revUpper`, an upper-case sha, row in lower case; `f1`, no ancestor, null and no error row), `acceptance 5 and 10` (target 6, the ancestry call exits 0) | pass; `summary_ci` with `DUCKDB_BIN`, skipped without |
| 9 | the same test as item 6. T1-A's only branch commit without a trailer is the merge `aM`: accepted and acceptedStrict 1 of 4. Head of its pull request not in the repository: `accepted` 1, `accepted_strict` 0, `unknown_noHumanCommit` 1, `failing_noHumanCommit` 0. Its pull request holding `f2`, no merge and no trailer: `accepted` 0, `accepted_strict` 0, `failing_noHumanCommit` 1, `unknown_noHumanCommit` 0 | pass with `DUCKDB_BIN`, skipped without |

### Inputs and failure paths
| Input | Decision | Test |
|---|---|---|
| a command that exits non-zero, or cannot be started | one row, `did not exit 0`; its output is not read | acceptance 5 (`s2`, `s5`), 3 (unknown base), 4 (pull request 22), 5 through run.ts |
| a timeout | one row, `timeout`; its output is not read | acceptance 5 (`s3`) |
| HTTP 429 or 403 | `gh` exits 1: the same row, no second call | acceptance 5 (`s5`, the call list) |
| output that is not JSON, or empty | one row, `not JSON` | acceptance 5 (`s4`, shape 1) |
| JSON that is not an array of at least one page | one row, `not an array of pages` | acceptance 5 (shapes 2, 3) |
| a page of the wrong shape among good pages | left out, the others read, one row for the command | acceptance 5 (shape 4, `partial`) |
| a pull request without a number, a check run without a name, a workflow run without `id` or `run_attempt` | left out, named in the row of its command | acceptance 5 (shape 4, `partial`) |
| a field that is null or missing | null | acceptance 1, 2, 5 |
| a check run that names no workflow run | `runAttempt` null, no workflow-run call | acceptance 2 (`s2`, the call list) |
| a workflow run a check run names that the list does not hold | `runAttempt` null and one row | acceptance 5 (`partial`) |
| the same sha given twice | read once | acceptance 2 |
| a reverted sha that is not a first-parent commit of the base | `daysAfter` null | acceptance 3 |
| a revert line on a commit that is not first-parent; a `Revert` subject with a sha and no reverts line | no row | acceptance 3 |
| a pull request that is open, or merged into another branch | no git call, no row, no error | acceptance 4 (20, 21) |
| a merged pull request without a 40-hex `headSha` and `mergeCommitSha` | one row, no git call, the others read | acceptance 4 (23) |
| a failing git call for one pull request | one row, the others read; `noHumanCommit` null for its card | acceptance 4 (22), 9 |
| a branch commit with more than one parent | `merge` true; not counted by `noHumanCommit` | acceptance 4, 9 |
| no `repository` in the configuration | one row, no `gh` call, `reverts` still read | acceptance 5 through run.ts (`unconfigured`) |
| the pull-request call fails | one row in `github_errors.jsonl`, the ingest tables and `reverts.jsonl` written | acceptance 5 through run.ts (`noPulls`) |
| an `aidlc.config.json` that does not parse | `run.ts` exits 1 before any write | not tested |

The six tables' columns are `GITHUB_COLUMNS` in `bench/outcome/ingest.ts`; `writeTables` writes each of those tables it is given, and `run.ts` adds nothing to a constant. `ingestState`, `Tables` and `assertWritable` are unchanged.

### Mutants
First sweep (before the second amendment): 52 single replacements, each run against `tests/surface/outcome-github.test.ts` with `DUCKDB_BIN`; 51 killed after four fixture cases were added for first-sweep survivors (no `stopReview` filter, the missing-pull-request count, `>= 1` for a rerun, latest merged pull request). Second sweep (after it): the 49 below that touch R4, R7 and R8; 47 killed. R1, R2, R3, R5 and R6 mutants are from the first sweep.

| Requirement | Mutants (killed unless noted) |
|---|---|
| R1 | `mergedAt` from `closed_at`; `headSha` from `base.sha`; only the first page read |
| R2 | 1 for a check run of no workflow run; no dedup of shas; the workflow-run call made for every commit |
| R3 | no `--first-parent`; days as hours; any 40 hex as the reverted sha; 0 for a sha not on the base |
| R4 | no `--not <merge>^1`; trailer without `Co-Authored-By:`; without the `i` flag; without GPT; no `baseRef` filter; `merge` for one parent or more; `merge` for three parents or more |
| R5 | output of a failed command read; no timeout branch; the whole stderr; the first problem only; `break` after a bad page |
| R6 | `30-github.sql` run with `--no-github`; no `cwd` on the children; checks of heads only; checks of unmerged pull requests; no required checks |
| R7 | join by `headRef` only; by `prNumber` or `headRef`; no 14-day bound; first run for `green`; no every-name count; no required filter; any success; no successor clause; no `stopReview` filter; checks of the head; `noHumanCommit` counting merges; `bool_or`; null as false; null as true; `accepted` with null failing; `accepted` without `noHumanCommit`, `checksGreen`, `notReverted`, `noRuling`; `acceptedStrict` with null passing; `acceptedStrict` without `noHumanCommit`, `checksGreen`, `notReverted`, `noRuling`; `accepted` without `merged` and `acceptedStrict` without `merged` survived |
| R8 | the null count without `merged`; the null count counting false; the strict rate and the strict count from `accepted`; `failing_noHumanCommit` counting null; latest run for the lead time; p90 as p50; latest merged pull request; no `mergeVerified` in the missing-pull-request count; `>= 1` for a rerun; last run for `first_failed`; unmerged pull requests in `summary_ci`; open pull requests as closed; no card-id filter; no `mergedAt` or `mergeVerified` condition in the reconciliation |

The two survivors are equivalent: without a merged pull request `checksGreen` and `notReverted` are null, so neither conjunction is ever true.

### Repair of R3 decision 1 (attempt 2)
RED: commit 36613b9f (test changes only); 5 of 7 failed on assertions with `DUCKDB_BIN` (acceptance 2, 3, 4, 5 through run.ts, and 6, 9 and 10), 4 failed and 1 was skipped without it. One fixture line of acceptance 5 changed with the fix (a listed workflow run on attempt 3 became attempt 1, since attempt 3 now means three jobs calls the script does not hold).

| Class | Repair | Test | Mutants |
|---|---|---|---|
| git-revision-option-injection | the base is resolved first with `git rev-parse --verify --end-of-options <base>^{commit}`; one that does not resolve is one error row and no further git call; the log reads the resolved sha; every sha follows `--end-of-options` | acceptance 3: base `--output=x` gives no file `x`, one error row, one git call | no early return: killed; `--end-of-options` dropped from the branch log: killed (the command line is asserted); the log given the base instead of the resolved sha: survived, equivalent once the base has resolved |
| workflow-attempt-misattribution | for a workflow run with `run_attempt` above 1, the jobs of each attempt are read and a check run gets the attempt whose jobs hold its id | acceptance 2: ids 11 and 12 of run 900 give 1 and 2; a run with one attempt makes no jobs call; superseded by decision 2 below for a check run that no attempt read holds | job map ignored; `allRead` dropped; `allRead` true for a failed call; every job mapped to the last attempt: killed |
| revert-target-ancestry-truncated | the target's ancestry is tested against the resolved base (the call was replaced in decision 2 below) and its date read with `git show` | acceptance 3: `revSide` reverts a commit that reached main through the merge's second parent, `daysAfter` 3; `f1`, no ancestor, stays null without an error row | arguments swapped; the date read for a non-ancestor: killed |
| body-text-treated-as-trailer | `modelCoAuthor` tests the values of `%(trailers:key=Co-Authored-By,valueonly,unfold)` of the same `git log` call | acceptance 4: `f2` quotes `Co-Authored-By: Claude <...>` followed by a line of prose and is false; `a1`, `r1`, `v1`, `f1` have real trailers and are true | the message tested instead: killed |
| queued-check-hidden-by-success | a run is pending when its status is not completed or it has no `startedAt`; a name's last runs are its pending ones when it has any; a pending run is no success | acceptance 6, 9 and 10: scan success plus a queued rerun without `startedAt` on T1-A's merge commit gives `failing_checksGreen` 2 and `accepted` 0 | pending rule dropped; `OR` to `AND` in pending: killed |
| closed-pr-reconciliation-omission | closed unmerged pull requests belong to a card by a run's `prNumber` or by `headRef` equal to a registry card id, pairs deduplicated | acceptance 6, 9 and 10: 18 for T1-RED by `headRef` (its merged run names 12) and 20 by the `prNumber` of its other run, 19 for T1-NEXT (no run), 14 for T1-D once (named by its run and by `headRef`) | `UNION ALL`; no `headRef` branch; no `prNumber` branch: killed |

16 mutants, each run against the test file with `DUCKDB_BIN`: 15 killed, 1 equivalent (named in the table). Two survived a first run (`OR` to `AND` in pending; no `prNumber` branch) and the fixture gained a queued run with an earlier `startedAt` and pull request 20, named by a second run of T1-RED with a `headRef` that is no card id; both are killed.

Tests added after the repair for its four untested failure paths (they passed on the repaired code, so they are additions, not a RED), each with a mutant that removes the production branch: no error row for a failing ancestry call (killed); no `not a date` problem (killed); no problem for a job without an id (killed); no problem for a page without a `jobs` array (killed). For the run in progress that started after the success, a view where every run is a success is killed; that case is rejected by three conditions at once (pending, latest `startedAt`, null conclusion), so no narrower mutant fails on it alone.

Sweeps:
- git argv carrying an outside value: `rev-parse` (base, from the configuration), the first-parent `log` (the resolved sha), `rev-list` and `show` (the reverted sha, 40 hex from a commit message, and the resolved sha), the branch `log` (head and merge commit sha from GitHub, each checked as 40 hex). All five follow `--end-of-options`. No other git call exists in `github.ts`.
- ordering by `startedAt` and `runAttempt` in the views: `green` and `first_failed` are in `commit_checks` and now place a run without `startedAt`; `rerun_share` takes `max(runAttempt) > 1`, where a null `runAttempt` (no workflow run) is no rerun, which is intended.
- the pull-request join: `accepted_changes`, `card_merge` and `mergeVerified_without_merged_pr` use `run_prs` (a run's `prNumber`, else `headRef` equal to the card id), as R7 states; `merged_pr_without_mergeVerified` uses `headRef` equal to a card id of the registry or of a run; `closed_unmerged` uses `prNumber` or `headRef` equal to a registry card id.

Inputs and failure paths of the repair hunks:
| Input | Decision | Test |
|---|---|---|
| a base that is not a revision, or starts with `-` | one row, no further git call | acceptance 3 |
| a reverted sha that is no ancestor (`rev-list` exits 0 and prints one sha) | null, no row, no `git show` | acceptance 3 (`f1`), acceptance 5 and 10 (target 6) |
| the ancestry call (`rev-list`) exiting 128, and timing out | null and one row each, the other reverts returned | acceptance 5 and 10 (`a failing ancestry or date call of a revert target, and a malformed jobs page ...`, scripted runner) |
| `git show` exiting non-zero, and printing an empty line | null and one row each | acceptance 5 and 10 (`a failing ancestry or date call of a revert target, and a malformed jobs page ...`, scripted runner) |
| a jobs call that fails | one row; a check run held by an attempt that was read gets that attempt, one held by none is null | acceptance 2 (`a`, `d`) |
| a check run in no attempt's jobs when every attempt was read | null, one row on the workflow-run call | acceptance 2 (`c`) |
| a jobs page without a `jobs` array, a job without an id | left out, one row for the call, the check runs' attempt null | acceptance 5 and 10 (`a failing ancestry or date call of a revert target, and a malformed jobs page ...`, scripted runner) |
| a message without a `Co-Authored-By` trailer | an empty trailer line, `modelCoAuthor` false | acceptance 4 |
| a check run with a status other than completed, or without `startedAt` | pending: last of its name, no success | acceptance 6, 9 and 10: a queued run without `startedAt`, a queued run with an earlier `startedAt`, and a run in progress that started after the success, each not green |

### Repair of R3 decision 2 (attempt 3)
RED: commit cde088e7 (test changes only); 6 of 8 failed on assertions with `DUCKDB_BIN` (acceptance 1, 2, 3, 5 and 10, 5 through run.ts, and 6, 9 and 10). After RED the fixture gained two cases for mutants that survived or were not yet separable: the head of pull request 13 (scan cancelled with no `startedAt` and no attempt, then green) and pull request 21 (ci green on attempt 1, cancelled with no `startedAt` on attempt 2). No real run was made after this repair.

| Class | Repair | Test | Mutant |
|---|---|---|---|
| workflow-attempt-misattribution | a check run of a run with more than one attempt gets the attempt whose jobs hold it, else null; the run's latest attempt is never used as a guess; a run with exactly one attempt is 1 with no jobs call | acceptance 2 (`a` 1, `c` null, `d` null under HTTP 429), acceptance 5 and 10 (`a`, `b` null) | the run's attempt as fallback: killed |
| null-first-attempt-omitted | the first runs of a name: lowest `runAttempt`, nulls last; then no `startedAt` first; then earliest `startedAt` (`rank() = 1`) | acceptance 6, 9 and 10: `summary_ci` 0.5 and 0.5 over six merged pull requests (12 and 13 count, 21 does not) | order by `startedAt` only: killed by 21; `startedAt` nulls last: killed by 13 |
| uppercase-revert-omitted | the 40 hex match in either case and `revertedSha` is lowered; shas from GitHub and those given to `checkRuns` are lowered where they enter | acceptance 3 (`revUpper`), acceptance 1 (upper-case head and merge commit sha), acceptance 2 (`S1` and `s1` read once) | no lowering of `revertedSha`: killed; no lowering of the pull-request shas: killed |
| ancestry-nonzero-error-omitted | `git rev-list --max-count=1 --end-of-options <target> ^<base commit>`: exit 0 for both answers, empty for an ancestor; every failure is an error row. `--not` after `--end-of-options` is refused by git 2.56 (`option '--not' must come before non-option arguments`), so the exclusion is written `^<sha>` | acceptance 3 (`f1` null, `errors` empty), acceptance 5 and 10 (exit 128, timeout, target 6) | output ignored (date read for a non-ancestor): killed; no error row for a failing call: killed |

Sweep of `MIN`, `MAX`, `ORDER BY`, `arg_min`, `arg_max` and `quantile` in `30-github.sql`:
- `card_merge`: `arg_min(number, mergedAt)` over rows with a `mergedAt`, `number` never null. Fixed: `mergedAt` and `mergeCommitSha` were separate aggregates, and `arg_min(mergeCommitSha, mergedAt)` skips a null `mergeCommitSha` and would take another pull request's; both are now read from the one pull request by number. Test: acceptance 6, 9 and 10, the case where pull request 13 of T1-REV has no `mergeCommitSha` and 17, merged later, has one: `failing_checksGreen` 2, `failing_notReverted` 0, `unknown_noHumanCommit` 1, `accepted` 1, lead time unchanged. Mutant: the three separate aggregates restored: killed.
- `commit_checks` `first_run`: fixed as above; a null `runAttempt` sorts last, a null `startedAt` first.
- `commit_checks` `last_run`: `max(startedAt)` is reached only when no run of the name is pending, so no `startedAt` there is null.
- `summary_lead_time_pr`: `min(startedAt)` of card runs, which the `CardRun` schema requires; `quantile_cont` over hours that are never null.
- `summary_ci` `max(runAttempt) > 1`: a null `runAttempt` is skipped, so a check run whose attempt is unknown does not make a rerun by itself; the other check runs of the same workflow run carry the attempt.
- `summary_reconcile` `ORDER BY kind, cardId`: neither is null.

Sweep of sha matching and comparison: the revert line (either case, lowered); `head.sha` and `merge_commit_sha` in `pullRequests` (lowered); the shas given to `checkRuns` (lowered, then deduplicated); the 40-hex check in `branchCommits` (lowers its input first); shas printed by git (`rev-parse`, `log`) are lower case already and the record pattern requires it. The views join `checks.sha`, `reverts.revertedSha`, `prs.headSha` and `prs.mergeCommitSha`, all lower case.

Read again for what the hunks newly break: a null `runAttempt` does not enter `checksGreen` (it orders by status and `startedAt`); in `rerun_share` it is skipped; in the first-attempt rule it sorts after every run with an attempt, so when attempt 1 of a name is the unresolved one, a later attempt is taken as the first. That case always has a `github_errors` row. The README states it.

Inputs and failure paths of these hunks: a check run no read attempt holds (null; acceptance 2); a workflow run the list does not hold (null, a row; acceptance 5); the ancestry call failing or timing out (null, a row; acceptance 5 and 10); a non-ancestor (null, no row; acceptance 3, 5 and 10); an upper-case sha in a revert line, in a pull request, in the `checkRuns` argument (lower case; acceptance 3, 1, 2); a required check with no `runAttempt` and no `startedAt` (first; acceptance 6, 9 and 10).

### Real run
`node bench/outcome/run.ts --duckdb <path> --state D:\Projects\AIDLC\.aidlc --cards D:\Projects\AIDLC\specs\tasks --out <temp>` from this worktree on 2026-11-10, twice: before the second amendment (exit 0 in 9 min 8 s) and after it (exit 0 in 8 min 57 s). Each run made 773 `gh` calls (1 for pull requests, 386 for check runs, 386 for workflow runs; derived from the tables) and 194 `git log` calls. The numbers below are from the second run; `summary_lead_time_pr`, `summary_ci` and `summary_reconcile` printed the same bytes in both.

- Rows: `prs` 208 (193 merged), `checks` 1882, `reverts` 1, `branch_commits` 979 (226 with `merge`), `required_checks` 4, `github_errors` 52.
- `github_errors`: all 52 are `git log <headSha> --not <mergeCommitSha>^1 --`, exit 128, `fatal: bad object <sha>`: the head commit of a merged pull request is no longer in the local repository.
- `summary_pr_success`: 263 card attempts; `accepted` 151, rate 0.574; `accepted_strict` 110, rate 0.418; failing `merged` 85, `checksGreen` 7, `notReverted` 0, `noHumanCommit` 7, `noRuling` 36; `unknown_noHumanCommit` 42. Before the amendment, with a merge counted as a human commit and an unreadable branch as false, the one rate was 59 of 263 (0.224) with `noHumanCommit` failing 114.
- `summary_lead_time_pr`: p50 0.65 h, p90 6.55 h, n 178, `merged_cards_without_pr` 0.
- `summary_ci`: 193 merged pull requests, `rerun_share` 0.0052, `first_attempt_failed_share` 0.0052.
- `summary_reconcile`: `merged_pr_without_mergeVerified` 24 cards, `closed_unmerged` 15 cards, `mergeVerified_without_merged_pr` none.
- Third run, after the repair of R3 decision 1 (exit 0 in 9 min 3 s, 775 `gh` calls: two more, the jobs of attempts 1 and 2 of the one workflow run that was rerun): `summary_pr_success`, `summary_ci`, `summary_lead_time_pr` and `summary_reconcile` print the same values as the second run. In `checks` one check run of the rerun workflow moved from `runAttempt` 2 to 1 (1881 rows on attempt 1, 1 on attempt 2); the head still has a check on attempt 2, so `rerun_share` is unchanged. The one revert targets a first-parent commit, no required check on a merge commit was pending, no body line was read as a trailer before (708 `modelCoAuthor` rows in both runs), and the 15 closed unmerged pull requests were already found through their runs. `github_errors`: the same 52.
