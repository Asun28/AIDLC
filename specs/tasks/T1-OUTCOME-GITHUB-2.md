---
id: T1-OUTCOME-GITHUB-2
title: "The outcome bench reads pull requests, check runs and reverts through `gh` and git, and reports accepted changes, the PR success rate and every mismatch between card runs and GitHub"
status: todo
branch: T1-OUTCOME-GITHUB-2
worktree: D:\wt\AIDLC\T1-OUTCOME-GITHUB-2
plan_ref: plans/reliability-baseline.md#order-of-work
allow_paths:
  - bench/outcome/github.ts
  - bench/outcome/views/30-github.sql
  - bench/outcome/run.ts
  - bench/outcome/ingest.ts
  - bench/outcome/README.md
  - tests/surface/outcome-github.test.ts
  - tests/surface/outcome-ingest.test.ts
  - tests/surface/outcome-usage.test.ts
  - specs/tasks/T1-OUTCOME-GITHUB.md
  - specs/tasks/T1-OUTCOME-GITHUB-2.md
dod_command: npm run typecheck && node --test tests/surface/outcome-github.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts
dod_exit: 0
requirements:
  - R1. `pullRequests(runner, repository)` in `bench/outcome/github.ts` shall return one row per pull request of the repository in any state, read through `gh api --paginate` on the injected runner, with `number`, `headRef`, `baseRef`, `state`, `createdAt`, `mergedAt`, `closedAt`, `mergeCommitSha` and `headSha`.
  - R2. `checkRuns(runner, repository, shas)` shall return one row per check run of each given commit with `sha`, `name`, `status`, `conclusion`, `startedAt`, `completedAt` and `runAttempt` (the attempt of the workflow run in which the check run's job ran, read from the jobs of each attempt when the run has more than one, so the checks of attempt 1 and of attempt 2 keep their own number; null when the check run names no workflow run, and null with one `github_errors` row when the jobs of an attempt could not be read and no attempt read holds the check run).
  - R3. `reverts(runner, base)` shall return one row per first-parent commit on the base whose message holds `This reverts commit <40 hex>` (hex letters in either case), with `sha`, `date`, `revertedSha` (in lower case) and `daysAfter` (commit date difference in days, null when the reverted commit is not an ancestor of the base, a commit merged through a second parent included as an ancestor); the base is passed to git after `--end-of-options`, and a base that is not a revision of the repository gives one `github_errors` row and no git output.
  - R4. `branchCommits(runner, base, pulls)` shall return one row per commit of each merged pull request's head that is not on the base before its merge, with `number`, `sha`, `date`, `merge` (true when the commit has more than one parent) and `modelCoAuthor` (true when a `Co-Authored-By:` trailer, as git parses the trailer block of the message and not a line of its body, names Claude, Codex or GPT, case-insensitive); a merged pull request whose `headSha` equals its `mergeCommitSha` (a fast-forward or indirect merge, for which git does not give the base before the merge) gives one `github_errors` row and no rows, so its `noHumanCommit` is null and never true.
  - R5. A `gh` or git command that exits non-zero, times out or prints output that is not the expected JSON shall add one `github_errors` row with `command`, `exit` and the first line of its stderr, and the function shall return the rows it has; a rate-limit response (HTTP 403 or 429) is reported the same way and not retried.
  - R6. `run.ts` shall take `--no-github`, call these functions for the configured repository and base, and write `prs.jsonl`, `checks.jsonl`, `reverts.jsonl`, `branch_commits.jsonl`, `github_errors.jsonl` and `required_checks.jsonl` (one row per name in the configured `github.requiredChecks`) through `writeTables` with the read-only directories `run.ts` already passes, their columns declared in `bench/outcome/ingest.ts` beside the existing ones and never added to another module's constant at run time; check runs are read for each merged pull request's head and merge commit; the `run.ts` spawns of `tests/surface/outcome-ingest.test.ts` and `tests/surface/outcome-usage.test.ts` pass `--no-github`, so those tests make no `gh` call; the `run.ts` spawns of `tests/surface/outcome-github.test.ts` pass `--no-usage` or fixture directories as `--claude-dir` and `--codex-dir`, so that test reads no session log of the machine; `--no-usage` and `--no-github` given together write neither set of tables and exit 0.
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
  - 12. Same file as item 6, same skip: with `--no-usage` alone `run.ts` writes the six GitHub files and no usage table, with `--no-usage --no-github` it writes neither set and exits 0, and with neither flag, over fixture `--claude-dir` and `--codex-dir` directories, it writes both sets and exits 0. [R6] [dod arm 2]
  - 13. Same file, in the real temporary git repository: for a merged pull request whose `headSha` equals its `mergeCommitSha`, on a branch of two commits whose first has no trailer and whose last has a model trailer, `branchCommits` gives one `github_errors` row and no rows; and when a DuckDB binary is found, such a card has `noHumanCommit` null, is `accepted`, is not `acceptedStrict` and is in the null count of `summary_pr_success`. [R4] [R7] [R8] [dod arm 2]
  - 8. `tests/surface/outcome-ingest.test.ts` and `tests/surface/outcome-usage.test.ts` pass unchanged apart from `--no-github` in their `run.ts` spawns, with and without a DuckDB binary. [R6] [dod arm 2]
depends_on: [T1-OUTCOME-INGEST, T1-OUTCOME-USAGE-2]
budget: 1200
sweep: "New files, plus `bench/outcome/run.ts` and the README. The runner is the existing injectable one: `scriptedRunner` in src/probes/exec.ts is what tests/ use; `aidlc.config.json` holds `repository` (Asun28/AIDLC), `base` (main) and `github.requiredChecks` (four names), which `run.ts` writes as `required_checks.jsonl`. Amended on 2026-11-10 before the card started, from T1-OUTCOME-INGEST (PR 255): the journal holds no `CARD_STATE` to `CLOSE`, so 41 of 153 merged runs are missing from `summary_lead_time`, and the merge time comes from the pull request here; output goes through `writeTables`, which holds the one output rule (that card's R15)."
forbid: [any change under src/ templates/ or .claude/, a write to GitHub (no POST PATCH PUT or DELETE and no `gh pr` subcommand that mutates), a retry loop on a rate limit, a dependency added to package.json]
non_goals: [reverts made by a pull request that edits files without the `This reverts commit` line (not detected; the README says so), check runs of commits that are neither a merged head nor a merge commit, GitHub Enterprise hosts, pull requests of forks, a commit with more than 1000 check suites and a workflow-run list past the 1000 results GitHub returns (the two endpoints stop there; about 10 checks per commit here; left by the user's ruling of 2026-11-11)]
hygiene: "Tests never call the real `gh`. The one real call is the arc proof on this repository. Continues the branch line of T1-OUTCOME-GITHUB at 42b211cc by the user's ruling of 2026-11-11 on its R3 decision 4. Decision 1 blocked on 6 findings and decision 2 on 4, each repaired. Decision 3 passed 42b211cc. The second pass, decision 4, blocked the same commit on api-history-truncation at bench/outcome/github.ts:90 and :110, which the ruling leaves out of scope and the non-goals name. The work of this card is the merge with main after T1-OUTCOME-USAGE-2 (both cards change `run.ts`, `ingest.ts`, the README and the ingest test), the `--no-usage` and `--no-github` flags in each other's test spawns, and acceptance 12; beyond that `github.ts` and `30-github.sql` change only where an R3 decision of this card requires it. R3 decision 1 blocked 8139384b on premerge-base-misidentified at bench/outcome/github.ts:221 (a fast-forwarded branch lost its first commits, so `noHumanCommit` could be wrongly true); 0 of the 193 merged pull requests of this repository have that shape, so R4 and acceptance 13 make it an error row with a null result and do not add a call for the commits of the pull request."
doc_sync: bench/outcome/README.md
---

# T1-OUTCOME-GITHUB-2

## Deliverable
Pull request, check, revert and branch-commit tables, the accepted-change view, the PR success rate and the reconciliation of card runs with GitHub.

## Why
A merged card is not an accepted change: the definition also needs green checks on the merge commit, no revert in 14 days, no human commit and no ruling. Only GitHub and git hold the first three.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-github.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; item 6 is skipped only where no DuckDB binary is found.

## Attempt evidence

Attempt 1. Merge commit a669e7b1 (main at 93f7d494 into 42b211cc), then e21e49d4 (the amendment 6488e748). No RED commit; proved by mutants (the third run of item 12 by mutant e): a correct merge already has the behaviour of item 12, so its test passed when written. Items 1 to 11 are carried from 42b211cc; their detailed evidence and mutant table are in `specs/tasks/T1-OUTCOME-GITHUB.md`.

DoD: `npm run typecheck` exit 0; the three test files exit 0 with `DUCKDB_BIN` (31 tests, 31 pass) and exit 0 without it (31 tests, 25 pass, 6 skipped `no duckdb binary`).

| Item | Test (`outcome-github.test.ts` unless named) | Result |
|---|---|---|
| 1 | `acceptance 1: pullRequests returns the rows of both pages ...` | pass |
| 2 | `acceptance 2: checkRuns gives a check run of a workflow run on attempt 2 ...` | pass |
| 3 | `acceptance 3: reverts finds a revert made 3 days after its target ...` | pass |
| 4 | `acceptance 4: branchCommits lists the commits of each merged branch ...` | pass |
| 5 | `acceptance 5: a runner exit of 1, a timeout ...`, `acceptance 5 and 10 ...`, `acceptance 5 through run.ts ...` | pass |
| 6 | `acceptance 6, 9 and 10: run.ts prints the PR success rate ...` | pass with `DUCKDB_BIN`, else skipped |
| 7 | `bench/outcome/README.md`, sections GitHub tables and Views (`views/30-github.sql`) | reviewer-verified |
| 9 | same test as item 6 | pass with `DUCKDB_BIN`, else skipped |
| 10 | tests of items 2, 3, 4, 5 and 6 | pass (item 6 part with `DUCKDB_BIN`) |
| 11 | tests of items 2, 3, 5 and 6 | pass (item 6 part with `DUCKDB_BIN`) |
| 12 | `T1-OUTCOME-GITHUB-2 acceptance 12: with --no-usage alone ...`, three runs: `--no-usage`; both flags; neither flag with empty `--claude-dir` and `--codex-dir` | pass with `DUCKDB_BIN`, else skipped |
| 13 | `T1-OUTCOME-GITHUB-2 acceptance 13: branchCommits gives a merged pull request whose headSha equals its mergeCommitSha ...` and `acceptance 13 through run.ts ...` | pass; the second with `DUCKDB_BIN`, else skipped |
| 8 | `outcome-ingest.test.ts` (both flags) and `outcome-usage.test.ts` (`--no-github`), spawn arguments only | pass, view tests skipped without `DUCKDB_BIN` |

Mutants of `run.ts` against the test of item 12, one expression each, file restored after each:

| Mutant | Result |
|---|---|
| a. `--no-github` ignored when `--no-usage` is given | killed: the six GitHub files exist in the run with both flags |
| b. the view filter keeps `20-cost.sql` under `--no-usage` | killed: exit 1 |
| c. empty `usage` and `usage_errors` tables written under `--no-usage` | killed: both files exist |
| d. the view filter keeps `30-github.sql` when both flags are given | killed: exit 1 |
| e. usage read only when `--no-github` is also given | killed by the run with neither flag: no usage file (survived before the amendment 6488e748 added that run) |
| f. GitHub read only when `--no-usage` is given | killed by the run with neither flag |
| g. `20-cost.sql` left out when both stages run | killed by the run with neither flag: no cost view |

Findings left by the owner's ruling of 2026-11-11: api-history-truncation at `bench/outcome/github.ts:90` (the check runs of a commit with more than 1000 check suites) and at `:110` (a workflow-run list past the 1000 results GitHub returns). Both are in `non_goals`; that code is unchanged from 42b211cc.

Attempt 2, R3 decision 1, finding F1 (premerge-base-misidentified at `bench/outcome/github.ts:221`). RED: commit 731b4b17 (test only), both tests of item 13 failed on their assertions: `branchCommits` returned `ff2` alone with `modelCoAuthor` true and no error row, and `summary_pr_success` had `accepted_strict` 1 and `unknown_noHumanCommit` 0. Fix: `branchCommits` gives a merged pull request whose `headSha` is its `mergeCommitSha` (both in lower case) one `github_errors` row and makes no git call. `30-github.sql` is unchanged: `noHumanCommit` is `bool_and` over the rows of the pull request, which is null over no rows, never true. Mutants of the fix: the check removed, killed by both tests; the shas compared as given, killed by the upper-case pull request of the first test; the error row left out, killed by both.

Class sweep, what `git log <head> ^<merge>^1` lists per merge shape: a squash merge and a merge commit have the base before the merge as first parent, so every branch commit is listed; a rebase merge has new shas on the base, so the original commits of the head are all listed (checked in a scratch repository); a head that is an ancestor of `<merge>^1` lists nothing, which is null and not true; a head merged through another branch's merge commit lists more commits, never fewer. Only the equal shape drops a commit, so nothing else changed.
