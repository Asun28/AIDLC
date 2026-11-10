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
  - R2. `checkRuns(runner, repository, shas)` shall return one row per check run of each given commit with `sha`, `name`, `status`, `conclusion`, `startedAt`, `completedAt` and `runAttempt` (the attempt of its workflow run, null when the check run names none).
  - R3. `reverts(runner, base)` shall return one row per first-parent commit on the base whose message holds `This reverts commit <40 hex>`, with `sha`, `date`, `revertedSha` and `daysAfter` (commit date difference in days, null when the reverted commit is not on the base).
  - R4. `branchCommits(runner, base, pulls)` shall return one row per commit of each merged pull request's head that is not on the base before its merge, with `number`, `sha`, `date`, `merge` (true when the commit has more than one parent) and `modelCoAuthor` (true when a `Co-Authored-By:` trailer names Claude, Codex or GPT, case-insensitive).
  - R5. A `gh` or git command that exits non-zero, times out or prints output that is not the expected JSON shall add one `github_errors` row with `command`, `exit` and the first line of its stderr, and the function shall return the rows it has; a rate-limit response (HTTP 403 or 429) is reported the same way and not retried.
  - R6. `run.ts` shall take `--no-github`, call these functions for the configured repository and base, and write `prs.jsonl`, `checks.jsonl`, `reverts.jsonl`, `branch_commits.jsonl`, `github_errors.jsonl` and `required_checks.jsonl` (one row per name in the configured `github.requiredChecks`) through `writeTables` with the read-only directories `run.ts` already passes, their columns declared in `bench/outcome/ingest.ts` beside the existing ones and never added to another module's constant at run time; check runs are read for each merged pull request's head and merge commit; the `run.ts` spawns of `tests/surface/outcome-ingest.test.ts` pass `--no-github`, so that test makes no `gh` call.
  - R7. `views/30-github.sql` shall define `accepted_changes` (one row per card attempt with the booleans `merged`, `checksGreen` (every check named in `required_checks` concluded `success` on the merge commit), `notReverted` (no revert of the merge commit within 14 days), `noHumanCommit` (true when every branch commit that is not a `merge` has `modelCoAuthor`, false when one does not, null when the branch commits of the pull request could not be read), `noRuling` (no run of the card carries `stopReview` and the card is not the direct successor of one that does), `accepted` (the first three and `noRuling` true and `noHumanCommit` not false) and `acceptedStrict` (all five true)), joined to card runs by `prNumber`, else by `headRef` equal to the card id.
  - R8. The same file shall define `summary_pr_success` (accepted / card attempts and acceptedStrict / card attempts, with the count failing each boolean and the count whose `noHumanCommit` is null), `summary_lead_time_pr` (the p50 and p90 hours from the `startedAt` of the earliest run of the card to the `mergedAt` of its merged pull request, with the count of merged cards that have no such pull request), `summary_ci` (the share of merged pull requests whose head had a check run with `runAttempt` above 1, and the share whose first attempt of a required check did not conclude `success`) and `summary_reconcile` (card runs with `mergeVerified` and no merged pull request, merged pull requests whose `headRef` is a card id with no `mergeVerified` run, and pull requests closed unmerged per card).
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
  - 8. `tests/surface/outcome-ingest.test.ts` passes unchanged apart from `--no-github` in its `run.ts` spawns, with and without a DuckDB binary. [R6] [dod arm 2]
depends_on: [T1-OUTCOME-INGEST]
budget: 900
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

DoD, real `gh` on PATH, no stand-in: exit 0 without `DUCKDB_BIN` (17 tests, 14 pass, 3 skipped `no duckdb binary`) and exit 0 with it (17 tests, 17 pass).

### Acceptance
| Item | Test | Result |
|---|---|---|
| 1 | `outcome-github.test.ts`, `acceptance 1: pullRequests returns the rows of both pages ...` | pass |
| 2 | `acceptance 2: checkRuns gives a check run of a workflow run on attempt 2 runAttempt 2 ...` | pass |
| 3 | `acceptance 3: reverts finds a revert made 3 days after its target ...` (real git) | pass |
| 4 | `acceptance 4: branchCommits lists the commits of each merged branch ...` (real git) | pass |
| 5 | `acceptance 5: a runner exit of 1, a timeout, output that is not JSON and a 429 body ...` and `acceptance 5 through run.ts: a failing gh call is a row of github_errors.jsonl ...` | pass |
| 6 | `acceptance 6: run.ts prints the PR success rate, the PR lead time, the CI shares and the reconciliation ...` | pass with `DUCKDB_BIN`, skipped without |
| 7 | README sections "GitHub tables (`github.ts`)" and "Views (`views/30-github.sql`)" | reviewer-verified against the diff |
| 8 | `outcome-ingest.test.ts`, changed only by `'--no-github'` in `runOutcome` and `spawnRun` | 10 pass with `DUCKDB_BIN`; 8 pass, 2 skipped without |

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
| a failing git call for one pull request | one row, the others read | acceptance 4 (22), 6 (the fourth variant) |
| no `repository` in the configuration | one row, no `gh` call, `reverts` still read | acceptance 5 through run.ts (`unconfigured`) |
| the pull-request call fails | one row in `github_errors.jsonl`, the ingest tables and `reverts.jsonl` written | acceptance 5 through run.ts (`noPulls`) |
| an `aidlc.config.json` that does not parse | `run.ts` exits 1 before any write | not tested |

`bench/outcome/ingest.ts` is outside `allow_paths` and `writeTables` writes only the tables `COLUMNS` names, so `run.ts` adds the six tables to `COLUMNS` at run time (`Object.assign(COLUMNS, GITHUB_COLUMNS)`).

### Mutants
52 single replacements, each run against `tests/surface/outcome-github.test.ts` with `DUCKDB_BIN`; 51 killed.

| Requirement | Mutants (all killed unless noted) |
|---|---|
| R1 | `mergedAt` from `closed_at`; `headSha` from `base.sha`; only the first page read |
| R2 | 1 for a check run of no workflow run; no dedup of shas; the workflow-run call made for every commit |
| R3 | no `--first-parent`; days as hours; any 40 hex as the reverted sha; 0 for a sha not on the base |
| R4 | no `--not <merge>^1`; trailer without `Co-Authored-By:`; without the `i` flag; without GPT; no `baseRef` filter |
| R5 | output of a failed command read; no timeout branch; the whole stderr; the first problem only; `break` after a bad page |
| R6 | `30-github.sql` run with `--no-github`; no `cwd` on the children; checks of heads only; checks of unmerged pull requests; no required checks |
| R7 | join by `headRef` only; by `prNumber` or `headRef`; no 14-day bound; first run for `green`; no every-name count; no required filter; any success; `noHumanCommit` true without commits; no successor clause; no `stopReview` filter; checks of the head; `accepted` without each of `checksGreen`, `notReverted`, `noHumanCommit`, `noRuling`; `accepted` without `merged` survived |
| R8 | latest run for the lead time; p90 as p50; latest merged pull request; no `mergeVerified` in the missing-pull-request count; `>= 1` for a rerun; last run for `first_failed`; unmerged pull requests in `summary_ci`; open pull requests as closed; no card-id filter; no `mergedAt` or `mergeVerified` condition in the reconciliation |

The survivor is equivalent: without a merged pull request `checksGreen`, `notReverted` and `noHumanCommit` are null, so the conjunction is never true. Four mutants survived the first sweep (no `stopReview` filter, the missing-pull-request count, `>= 1`, latest merged pull request); the fixture gained a formal pass on T1-A, a head check on attempt 1, a variant where T1-D has no `mergeVerified` run, and a second merged pull request of T1-REV, and all four are killed.

### Real run
`node bench/outcome/run.ts --duckdb <path> --state D:\Projects\AIDLC\.aidlc --cards D:\Projects\AIDLC\specs\tasks --out <temp>` from this worktree on 2026-11-10, exit 0 in 9 min 8 s. 773 `gh` calls (1 for pull requests, 386 for check runs, 386 for workflow runs; derived from the tables) and 194 `git log` calls.

- Rows: `prs` 208 (193 merged), `checks` 1882, `reverts` 1, `branch_commits` 979, `required_checks` 4, `github_errors` 52.
- `github_errors`: all 52 are `git log <headSha> --not <mergeCommitSha>^1 --`, exit 128, `fatal: bad object <sha>`: the head commit of a merged pull request is no longer in the local repository. Those cards count under `failing_noHumanCommit`.
- `summary_pr_success`: 263 card attempts, 59 accepted, rate 0.224; failing `merged` 85, `checksGreen` 7, `notReverted` 0, `noHumanCommit` 114, `noRuling` 36.
- `summary_lead_time_pr`: p50 0.65 h, p90 6.55 h, n 178, `merged_cards_without_pr` 0.
- `summary_ci`: 193 merged pull requests, `rerun_share` 0.0052, `first_attempt_failed_share` 0.0052.
- `summary_reconcile`: `merged_pr_without_mergeVerified` 24 cards, `closed_unmerged` 15 cards, `mergeVerified_without_merged_pr` none.
