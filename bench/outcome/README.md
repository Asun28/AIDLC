# bench/outcome: outcome tables and views

Dev-only measurement scripts (plan `plans/reliability-baseline.md`). They read the state directory, the card registry and, unless `--no-github` is given, GitHub and the git history of the main checkout, and write only under `--out`. Table and view names may change with the scripts.

## Command

```bash
node bench/outcome/run.ts [--state <dir>] [--cards <dir>] [--out <dir>] [--duckdb <path>] [--no-github]
```

- `--state`: the state directory. Default: the one aidlc resolves for the checkout (`AIDLC_STATE_DIR`, else `<main checkout>/.aidlc`).
- `--cards`: the card registry. Default: the configured `cardsDir` under the main checkout.
- `--out`: where the tables are written. Default: `_local/outcome` under the main checkout. A path that is the state directory or the registry, or under one of them, is refused before anything is created (exit 1, `refusing to write`).
- `--duckdb`: the DuckDB binary. Default: `duckdb` on PATH. A value that is absolute or holds a path separator is resolved against the invocation directory. A bare name is left to the operating system's lookup, which on Windows tries the child's working directory (`--out`) before PATH.
- `--no-github`: no `gh` or git call is made, the six GitHub tables are not written and `views/30-github.sql` is not run. Files of those names that an earlier run left in `--out` stay as they are.

`--state`, `--cards` and `--out` are resolved against the invocation directory too, before the DuckDB child starts in `--out`.

The run writes `<table>.jsonl` per table, prints the row counts on stderr, runs every `bench/outcome/views/*.sql` in name order through the DuckDB binary with `--out` as its working directory (an in-memory database, so nothing else is written), and prints each view named `summary_*` on stdout as one line `{"view": "<name>", "rows": [...]}`, in name order. Exit codes: 0; 1 when an argument, a read or a view fails; 2 when the DuckDB binary cannot be started, after the tables are written. The message of exit 2 names `winget install DuckDB.cli`.

## Tables (`ingest.ts`)

`ingestState({ stateDir, cardsDir })` returns the tables as arrays of plain rows and reads files only. A field the record does not carry is null. `writeTables(tables, outDir)` writes the keys in the column order below and sorts the lines by UTF-16 code unit, so the same rows given in any order write the same bytes; an empty table writes an empty file.

Where output may be written is decided in one place, `writeTables(tables, outDir, readOnly)`, the only write these scripts make (`run.ts` passes the state directory and the registry as `readOnly`):
- `outDir` and each `readOnly` directory are compared by canonical path: the nearest existing ancestor resolved through every link, then the missing remainder. `outDir` equal to a `readOnly` directory or under one throws before anything is created. A name that only begins with `..` (`<state>/..out`) is inside; only the segment `..` leads outside.
- Each `<table>.jsonl` replaces the entry of its name: the entry is removed and the file is created exclusively, so a symbolic or hard link at that name is removed and never written through.

Absent inputs:
- The registry directory, `<state>/cards` and `<state>/journal`: each one that is absent or not a directory is one `ingest_errors` row (`source` `card`, `card_run`, `journal`; `path` the directory; `problem` `missing directory`), and the rows of the others are still returned. An absent state directory therefore gives two rows.
- A goal directory under `<state>/cards` without card-run files, a card run without review entries or findings, and a journal without the three event types are normal empty results and give no row.

| Table | One row per | Columns |
|---|---|---|
| `cards` | card file under `--cards` that `parseCardText` accepts (names starting with `_` left out) | `id`, `status`, `superseded_by`, `depends_on`, `tdd`, `budget` |
| `card_runs` | file `<state>/cards/<goal>/<card>.json` that parses under `CardRun` | `goalId`, `cardId`, `startedAt`, `state`, `mergeVerified`, `prNumber` (`pr.number`), `stopReason`, `stopDetail` (`stop.reason`, `stop.detail`), `substantiveDecisions`, `substantiveBlocks` (from `review`), `updatedAt` |
| `review_decisions` | `review.invocations` entry (`stage` `formal`) and `preReview.rounds` entry (`stage` `pre`) | `goalId`, `cardId`, `stage`, `outcome`, `mergeBlocking`, `reviewer`, `requestedAt`, `candidateSha`, `secondPass`, `baseSync`, `stopReview` (true when the entry carries one), `decision` (formal), `round`, `cycle` (pre), `angles` (the `{ angle, outcome }` of each perspective of a pre round, else an empty array) |
| `findings` | `findings` entry of a card run | `goalId`, `cardId`, `id`, `stage`, `round`, `cycle`, `perspective`, `file`, `class`, `candidateSha`, `raisedAt`, `disposition`, `disputes` (count), `reraises` (count), `resolvedAt`, `advisory`, `outsideDelta`, `reason` |
| `state_spans` | `CARD_STATE` event of `<state>/journal/*.jsonl` | `goalId`, `cardId`, `state` (the event's `to`), `startTs` (the event's `ts`), `endTs` (the `ts` of the next `CARD_STATE` of that goal and card, null for the last) |
| `attempts` | `ATTEMPT_FINISHED` event | `goalId`, `cardId`, `outcome`, `endTs` (the event's `ts`), `startTs` (the `ts` of the nearest earlier `ATTEMPT_STARTED` of that goal and card, null when there is none) |
| `ingest_errors` | card file `parseCardText` rejects (`source` `card`), card-run file that is not JSON or fails `CardRun` (`card_run`), journal line that is not JSON (`journal`) | `source`, `path`, `line` (journal only, counted from 1), `problem` |

Every other row is still returned beside an error row. Other journal event types and blank journal lines are ignored. "Earlier" and "next" in the journal mean position in the file.

Limit seen on the records of 2026-11-10: the journal holds a `CARD_STATE` event only where a command observed the change, and the 918 events have no `to` of `CLOSE` and three of `BUILD` (420 are `BUILD` to `SHIP`). A span therefore runs to the next journaled change, not to the next state change, and 41 of 153 runs with `mergeVerified` have no `CLOSE` or `DONE` span.

## Views (`views/10-cards.sql`)

The file first defines each table as a view over its JSONL file with explicit columns.

- `card_attempts`: one row per card with at least one run (`cardId`, `runs`); `merged` when a run has `mergeVerified`; `failed` when the card's `superseded_by` is set.
- `card_family`: each card (`id`) with the last card of its `superseded_by` chain (`last_card`, itself when it has none) and the `steps` to it. The walk has no step limit. A name the registry does not hold is the last card. The walk stops before an id it has already visited, so a chain that loops ends on the card before the repeat.
- `summary_successor_rate`: `card_attempts`, `failed`, `merged` (row counts of `card_attempts`) and `successor_rate` = `failed` / `card_attempts`.
- `summary_review_convergence`: over cards with at least one formal entry whose outcome is `pass` or `block` (`cards`): `first_decision_pass_share`, the share with a `pass` and no merge-blocking `block`; `two_or_more_blocks_share`, the share with two or more merge-blocking blocks; `mean_decisions_to_pass`, the mean of merge-blocking blocks plus one among cards with a `pass`; `stop_review_share`, the share of cards with a formal entry carrying `stopReview`. A `block` with `mergeBlocking` absent counts as merge-blocking. Entries are counted per card over all of its runs.
- `summary_lead_time`: rows `lead_p50` and `lead_p90`, the hours from `startedAt` to the start of the first `CLOSE` or `DONE` span for runs with `mergeVerified` (`n` runs that have such a span); and one row `state_total` per `state`, the total hours over all spans with an `endTs` (`n` spans).
- `summary_stop_reasons`: `stopReason` and `runs`, the card runs that carry a stop record, per reason.

## GitHub tables (`github.ts`)

Without `--no-github`, `run.ts` reads `repository`, `base` and `github.requiredChecks` from the `aidlc.config.json` of the main checkout, which it resolves in the invocation directory before any child starts, and runs every `gh` and git child in the main checkout. The calls only read:

- `gh api --paginate --slurp "repos/<repository>/pulls?state=all&per_page=100"`, once.
- `gh api --paginate --slurp "repos/<repository>/commits/<sha>/check-runs?filter=all&per_page=100"`, once per distinct head sha and merge commit sha of a merged pull request. `filter=all` lists the check runs of earlier attempts too.
- `gh api --paginate --slurp "repos/<repository>/actions/runs?head_sha=<sha>&per_page=100"`, once per such commit that has a check run whose `details_url` names a workflow run (`/actions/runs/<id>`).
- `git log --format=%H %cI%n%P%n%B%x00 --first-parent <base> --`, once, and `git log --format=%H %cI%n%P%n%B%x00 <headSha> --not <mergeCommitSha>^1 --`, once per pull request merged into `base`.

Each command runs once with a 120 s timeout. Nothing is retried, a rate limit (HTTP 403 or 429) included, and nothing is cached.

| Table | One row per | Columns |
|---|---|---|
| `prs` | pull request of the repository, in any state | `number`, `headRef` (`head.ref`), `baseRef` (`base.ref`), `state`, `createdAt`, `mergedAt`, `closedAt`, `mergeCommitSha`, `headSha` (`head.sha`) |
| `checks` | check run of a head or merge commit of a merged pull request | `sha`, `name`, `status`, `conclusion`, `startedAt`, `completedAt`, `runAttempt` |
| `reverts` | first-parent commit of `base` whose message holds `This reverts commit <40 hex>` | `sha`, `date` (commit date, UTC), `revertedSha` (the first such line of the message), `daysAfter` |
| `branch_commits` | commit reachable from the head of a pull request merged into `base` and not from the first parent of its merge commit | `number`, `sha`, `date`, `merge`, `modelCoAuthor` |
| `github_errors` | command that failed, or input that could not be read | `command`, `exit`, `stderr` (its first line), `problem` |
| `required_checks` | name in `github.requiredChecks` | `name` |

- `runAttempt` is the `run_attempt` of the workflow run the check run names. GitHub reports one number per workflow run, its latest attempt, so the check runs of an earlier attempt of a rerun carry the same number. It is null for a check run that names no workflow run, and for one whose workflow run could not be read, which `github_errors` names.
- `daysAfter` is the commit-date difference in days, as a fraction; null when the reverted sha is not a first-parent commit of `base`.
- `merge` is true for a commit with more than one parent, which a merge of the base into the branch is.
- `modelCoAuthor` is true when a line of the message starts with `Co-Authored-By:` and names Claude, Codex or GPT, in any letter case.
- A field GitHub gives as null or leaves out is null.

Failures (`github_errors`), each beside the rows of every other command:
- A command that times out (`problem` `timeout`) or does not exit 0 (`did not exit 0`: what `gh` gives for HTTP 403, 429 and every other error status, and what a `gh` that cannot be started gives, with `exit` null). Its output is not read.
- `gh` output that is not JSON (`not JSON`, an empty output included) or not an array of at least one page (`not an array of pages`); a page that is not an array of pull requests, or has no `check_runs` or `workflow_runs` array; a pull request without a number, a check run without a name, a workflow run without `id` or `run_attempt`; a workflow run a check run names that the list does not hold; a `git log` record that is not a sha, a date, a line of parents and a message. The page or entry is left out, the others are kept, and the command has one row whose `problem` joins what was left out with `; `.
- A merged pull request of `base` without a 40-hex `headSha` and `mergeCommitSha`: one row with `command` `git log` and `exit` null, and no git call.
- No `repository` in `aidlc.config.json`: one row with `command` `gh api`, no `gh` call, and `reverts` is still read.

A pull request that is not merged, or merged into another branch than `base`, has no `branch_commits` rows and is no error. The tables are written through `writeTables` with the same read-only directories. Their columns are `GITHUB_COLUMNS` in `ingest.ts`, beside `COLUMNS`, and `writeTables` writes each of these tables that it is given and touches no file of the others.

Not detected: a revert made by a pull request that edits files without the `This reverts commit` line; a second `This reverts commit` line in one message; for a rebase merge of several commits, every branch commit but the last (the first parent of the merge commit is then the commit before it).

## Views (`views/30-github.sql`)

The file first defines each GitHub table as a view over its JSONL file with explicit columns.

- `run_prs`: the pull requests of a card run. A run with a `prNumber` has the pull request of that number and no other; a run without one has every pull request whose `headRef` equals the card id.
- `card_merge`: per card, the pull request merged first among those of its runs.
- `commit_checks`: per commit with a run of a required check (a check has several runs on a commit after a rerun). `green`: every required name has a run, and each name's runs with its latest `startedAt` all concluded `success`. `first_failed`: a run with the earliest `startedAt` of its name did not conclude `success`.
- `accepted_changes`: one row per card attempt (a row of `card_attempts`: a card with at least one run), with `prNumber` and the booleans below. There are two definitions of an accepted change. `accepted`: `merged`, `checksGreen`, `notReverted` and `noRuling` are true and `noHumanCommit` is not false. `acceptedStrict`: all five are true. They differ only for a card whose `noHumanCommit` is null.
  - `merged`: the card has a merged pull request (`card_merge`). This is GitHub's answer, not `mergeVerified`; `summary_reconcile` lists where the two differ.
  - `checksGreen`: every check named in `required_checks` is `green` on the merge commit. A required check without a run there is not green.
  - `notReverted`: no `reverts` row names the merge commit with `daysAfter` of 14 or less. For a merge younger than 14 days the window is still open, so a true value can become false later.
  - `noHumanCommit`: true when every `branch_commits` row of the pull request is a `merge` or has `modelCoAuthor`; false when a row that is not a `merge` has none; null when the pull request has no `branch_commits` row, which is the case when its branch commits could not be read (the head commit is gone from the local repository, see `github_errors`). This is a trailer check and not proof of authorship: a person can write the trailer, and a commit the loop made without it counts as a human commit.
  - `noRuling`: no formal review entry of any run of the card carries `stopReview`, and the card is not the direct successor of a card that has one (a card that names this card in `superseded_by`).
  - `checksGreen`, `notReverted` and `noHumanCommit` are null for a card attempt without a merged pull request, which is neither `accepted` nor `acceptedStrict`.
- `summary_pr_success`: `card_attempts`; `accepted` and `pr_success_rate` = `accepted` / `card_attempts`; `accepted_strict` and `pr_success_rate_strict` = `accepted_strict` / `card_attempts`; `failing_merged`, `failing_checksGreen`, `failing_notReverted`, `failing_noHumanCommit`, `failing_noRuling`, the card attempts for which that boolean is false; `unknown_noHumanCommit`, the card attempts with a merged pull request whose `noHumanCommit` is null.
- `summary_lead_time_pr`: `p50_hours` and `p90_hours` from the `startedAt` of the earliest run of a card to the `mergedAt` of its merged pull request, over the `n` cards that have one; `merged_cards_without_pr`, the cards with a `mergeVerified` run and no merged pull request.
- `summary_ci`: over the `merged_prs` merged pull requests, `rerun_share`, the share whose head has a check run with `runAttempt` above 1, and `first_attempt_failed_share`, the share whose head has a required check with `first_failed`. A head without check runs counts in neither.
- `summary_reconcile`: rows `kind`, `cardId`, `n`. `mergeVerified_without_merged_pr`: the runs of the card with `mergeVerified` and no merged pull request in `run_prs`. `merged_pr_without_mergeVerified`: the merged pull requests whose `headRef` is the id of a card (in the registry or with a run) that has no `mergeVerified` run. `closed_unmerged`: the pull requests of the card's runs that are closed and not merged.

Every boolean is computed from the tables as read: when `github_errors` has rows, the pull requests, commits or checks they name are missing from the views, which makes `checksGreen` false and `noHumanCommit` null, and can leave `notReverted` true.

## Tests

`tests/surface/outcome-ingest.test.ts` covers the tables, the writer, the output rule, the `--duckdb` path and the exit 2 path everywhere. The view tests (acceptance 5 and 11) are skipped with the reason `no duckdb binary` where no DuckDB binary is found (`DUCKDB_BIN`, else `duckdb` on PATH), which includes CI; run them locally with `DUCKDB_BIN` set.

`tests/surface/outcome-github.test.ts` covers the four readers with a scripted runner and a real temporary git repository, and `run.ts` started in that repository with a stand-in for `gh` first on PATH; no test calls the real `gh`. Its view test (acceptance 6) is skipped in the same way.
