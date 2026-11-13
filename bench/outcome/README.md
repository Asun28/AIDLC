# bench/outcome: outcome tables and views

Dev-only measurement scripts (plan `plans/reliability-baseline.md`). They read the state directory, the card registry, Claude Code session logs and Codex session logs and, unless `--no-github` is given, GitHub and the git history of the main checkout, and write only under `--out`. Table and view names may change with the scripts.

## Command

```bash
node bench/outcome/run.ts [--state <dir>] [--cards <dir>] [--out <dir>] [--duckdb <path>] [--claude-dir <dir>]... [--codex-dir <dir>] [--no-usage] [--no-github]
```

- `--state`: the state directory. Default: the one aidlc resolves for the checkout (`AIDLC_STATE_DIR`, else `<main checkout>/.aidlc`).
- `--cards`: the card registry. Default: the configured `cardsDir` under the main checkout.
- `--out`: where the tables are written. Default: `_local/outcome` under the main checkout. A path that is the state directory, the registry, a Claude directory or the Codex directory, or under one of them, is refused before anything is created (exit 1, `refusing to write`).
- `--duckdb`: the DuckDB binary. Default: `duckdb` on PATH. A value that is absolute or holds a path separator is resolved against the invocation directory. A bare name is left to the operating system's lookup, which on Windows tries the child's working directory (`--out`) before PATH.
- `--claude-dir` (repeatable): a Claude Code project directory. Default: `~/.claude/projects/<name>` for the main checkout, where `<name>` is its absolute path with every character but letters and digits replaced by `-`. The project directories of worktrees are not read by default: a subagent's requests are stored under the session that started it.
- `--codex-dir`: the Codex session directory. Default: `~/.codex/sessions`.
- `--no-usage`: reads no session or reviewer log, writes no usage table and leaves out `views/20-cost.sql`.
- `--no-github`: no `gh` or git call is made, the six GitHub tables are not written and `views/30-github.sql` is not run. Files of those names that an earlier run left in `--out` stay as they are.
- `--no-usage` and `--no-github` together: only the tables of `ingest.ts` are written and only `views/10-cards.sql` is run.

`--state`, `--cards`, `--out`, `--claude-dir` and `--codex-dir` are resolved against the invocation directory too, before the DuckDB child starts in `--out`.

The run writes `<table>.jsonl` per table, prints the row counts on stderr, runs every `bench/outcome/views/*.sql` in name order through the DuckDB binary with `--out` as its working directory (an in-memory database, so nothing else is written), and prints each view named `summary_*` on stdout as one line `{"view": "<name>", "rows": [...]}`, in name order. Exit codes: 0; 1 when an argument, a read or a view fails; 2 when the DuckDB binary cannot be started, after the tables are written. The message of exit 2 names `winget install DuckDB.cli`.

## Tables (`ingest.ts`)

`ingestState({ stateDir, cardsDir })` returns the tables as arrays of plain rows and reads files only. A field the record does not carry is null. `writeTables(tables, outDir)` writes the keys in the column order below and sorts the lines by UTF-16 code unit, so the same rows given in any order write the same bytes; an empty table writes an empty file.

Where output may be written is decided in one place, `writeTables(tables, outDir, readOnly)`, the only write these scripts make (`run.ts` passes the state directory, the registry, every Claude directory and the Codex directory as `readOnly`):
- `outDir` and each `readOnly` directory are compared by canonical path: the nearest ancestor that resolves through every link, then the remainder. An entry that is absent or cannot be resolved for another reason (EACCES on it or on an ancestor) is part of the remainder, so a source directory that cannot be reached still refuses an `outDir` inside it and does not stop the tables, `usage_errors` included, from being written elsewhere; with no ancestor that resolves, the path is compared as given. `writeTables` takes the resolving function as its last parameter (default `realpathSync.native`) for the test of that case. `outDir` equal to a `readOnly` directory or under one throws before anything is created. A name that only begins with `..` (`<state>/..out`) is inside; only the segment `..` leads outside.
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
- `summary_review_convergence`: over the cards with at least one formal entry whose outcome is `pass` or `block` (`cards`). A decision is a formal entry with outcome `pass` or `block` that is not a second pass (`secondPass` true) and not a base-sync decision (`baseSync` true); an absent `secondPass` or `baseSync` reads as false. A pass by ruling (reviewer `ruling:<by>`) is a decision, and so is a block whose `mergeBlocking` is false or absent; any other outcome (`no-verdict`, `quota-hold`, `pending`) and a pre-review entry are not. The decisions of a card, over all of its runs, are ordered by `requestedAt` read as a timestamp, then by `decision` with an absent number last, then by `goalId`, then by `outcome`. `first_decision_pass_share`: the share of `cards` whose first decision in that order is a `pass` (a card with no decision counts as not passing). `two_or_more_blocks_share`: the share with two or more merge-blocking blocks. `mean_decisions_to_pass`: the mean, over the cards with a `pass` among their decisions, of the place of the first such `pass` in that order (1 when the first decision passes), null when no card has one. `stop_review_share`: the share of cards with a formal entry carrying `stopReview`. A `block` with `mergeBlocking` absent counts as merge-blocking, and `two_or_more_blocks_share` and `stop_review_share` count every formal entry, second passes and base-sync decisions included.
- `summary_lead_time`: rows `lead_p50` and `lead_p90`, the hours from `startedAt` to the start of the first `CLOSE` or `DONE` span for runs with `mergeVerified` (`n` runs that have such a span); and one row `state_total` per `state`, the total hours over all spans with an `endTs` (`n` spans).
- `summary_stop_reasons`: `stopReason` and `runs`, the card runs that carry a stop record, per reason.

## Usage tables (`usage.ts`)

One `usage` row per model request. Only the fields below leave a log: no message text, prompt, tool input or tool output is returned, written or printed. Each reader returns `{ rows, errors }`; `run.ts` writes the rows after `attribute` and with `costUsd` (`priceOf`), and the errors as `usage_errors` (`source`, `path`, `problem`). The columns of both tables are declared as `USAGE_COLUMNS` in `ingest.ts`, and `writeTables` writes each of the two it is given.

| `source` | Read from | One row per | Fields |
|---|---|---|---|
| `claude-code` | every `*.jsonl` at any depth under each Claude directory: `<session>.jsonl` and `<session>/subagents/agent-<id>.jsonl` | distinct (`message.id`, `requestId`) over all lines with `type` `assistant` and a `message.usage`, keeping the last line (a response is logged several times while it streams); a line without a `requestId` is a row of its own | `sessionId`, `ts` (`timestamp`), `model` (`message.model`), `cwd`, `sidechain` (`isSidechain`), `inputTokens`, `outputTokens`, `cacheReadTokens` (`cache_read_input_tokens`), `cacheWriteTokens` (`cache_creation_input_tokens`), `cacheWrite1hTokens` (the part of it kept for one hour, `cache_creation.ephemeral_1h_input_tokens`, 0 when absent), `agentId` (from the file name, null for a session file), `agentType` and `agentCard` (from the sibling `agent-<id>.meta.json`: its `agentType`, and the first registry id its `description` holds with no letter, digit, `_` or `-` directly before or after; nothing else of the description is kept) |
| `codex` | every `rollout-*.jsonl` at any depth under the Codex directory | file, from its last `event_msg` line with `payload.type` `token_count` that carries `info.total_token_usage` (one row per session, not per turn) | `sessionId`, `cwd` (the first `session_meta` line: `payload.id`, `payload.cwd`), `ts` (that line), `model` (the last `turn_context` that names one), `inputTokens` (`input_tokens` minus `cached_input_tokens`), `cacheReadTokens` (`cached_input_tokens`), `cacheWriteTokens` (`cache_write_input_tokens`), `outputTokens` |
| `review-log` | every `*.log` under `<state>/evidence/<goal>/review/` | log with a `tokens used` line followed by a number line (the last such pair; a later `tokens used` line without a number is ignored) | `goalId`, `cardId` (the two directories of its path; `cardId` is null for a log directly under `review`), `invocation` (file stem), `totalTokens` (thousands separators removed), `durationMs` (header line), `model` (first `model:` line) |

Inputs that cannot be read (each is one `usage_errors` row, and every other row is still returned):
- A Claude directory, the Codex directory or `<state>/evidence` that is absent or not a directory: `missing directory`.
- A directory or file that cannot be read: `unreadable: <error code>`, with the `path` of that entry. The files and directories beside it are still read, and no filesystem error leaves a reader. A meta file that exists and cannot be read is one of these, and the rows of its subagent keep null `agentType` and `agentCard`. A file over the string limit of Node (about 512 MB) is one of these, and so is a directory with the name of a source file (`s.jsonl`, `rollout-x.jsonl`, `x.log`), which is not walked into.
- A line that is not JSON: `not JSON (line <n>)`. A meta file that is not JSON: `not JSON`, and the rows of its subagent keep null `agentType` and `agentCard`.
- A usage line without a `message.id`: `usage line without message.id (line <n>)`.
- A Codex file with no `token_count` line that carries `info.total_token_usage`: `no token_count line`.

Normal results that give no row: an absent meta file (null `agentType` and `agentCard`), a goal without a `review` directory, a log without a `tokens used` number, a field a line does not carry (null), blank lines, and links, which are not followed.

`attribute(rows, tables, worktreeRoot)` returns rows built from the usage columns each given row carries (any other field of a row it is given is dropped) and sets `cardId`, `goalId` and `stage` by the first rule that applies:
1. A `review-log` row keeps the goal and card of its path; `stage` `review`.
2. A `codex` row whose `cwd` is `<worktreeRoot>/<cardId>` or below takes that card; `stage` `review`. The `cwd` must be a fully qualified path: an empty one, a relative one and, on Windows, one with a root but no drive are not resolved against the invocation directory and the row is `unattributed`.
3. A `claude-code` row with an `agentId` takes its `agentCard`, else the card of the one attempt that holds its `ts` when exactly one attempt of any card does; `stage` `implement` when `agentType` is `implementer`, else `subagent`. The lines of a subagent carry the `cwd` of the session, not of the worktree, so the `cwd` is not used.
4. A `claude-code` row without an `agentId` takes the card of the one state span that holds its `ts` when exactly one span of any card does; `stage` `coordinate`.
5. Every other row has a null `cardId` and `stage` `unattributed`.

An attempt or a span holds a `ts` when `startTs <= ts < endTs`; one without both ends, such as the open last span of a card, holds nothing. For rules 2 to 4 the `goalId` is that of the card run whose `startedAt` to `updatedAt` window holds the `ts` (the latest such run), else of the nearest earlier run of that card, else null.

`priceOf(row, prices)` is the list-price cost in USD: each token kind times its price per million tokens in `prices.json` (keyed by model id; `input`, `cacheRead`, `cacheWrite` for the shorter cache-write tier, `cacheWriteLong` for the long one, `output`, with the duration of the two tiers as `cacheWriteTier` and `cacheWriteLongTier`, the `source` URL, the `date` read and a `note`). The tiers are 5 minutes and 1 hour for the Claude models and 30 minutes and 12 hours for the OpenAI models. `cacheWrite1hTokens` are priced at `cacheWriteLong` and the rest of `cacheWriteTokens` at `cacheWrite`; a Codex log names no duration, so every cache-write token of a Codex row takes `cacheWrite`. It is null for a model without an entry and for a row without `inputTokens` (every `review-log` row); a kind the row lacks counts as 0. The cost is an estimate at list price, not a bill: the reviewer runs on a subscription and nothing here is reconciled with an invoice.

`prices.json` holds the prices read from the vendors' pricing pages on 2026-11-10 for `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-2` (the Anthropic page lists display names; the ids are those of the session logs), `gpt-6-astra` and `gpt-5.6-sol`. The standard tier is used for every row: no long-context, batch or fast-mode price is applied, Haiku is priced at its tier for prompts up to 100,000 tokens, `gpt-6-astra` at its short-context tier (up to 272K input tokens), and `gpt-5.6-sol` at a price the page marks as promotional until 2026-11-30. A model without an entry (`codex-auto-review`, `<synthetic>`) is unpriced and `summary_unattributed` lists it.

Gaps: subagent transcripts stored outside the directories given are not read, so their tokens are missing; a Codex session counts once with its final totals; an unreadable file, such as a Codex file over the string limit of Node, contributes no tokens; a reviewer log without a matching Codex row is kept as its own request with `totalTokens` only and no cost.

## Cost views (`views/20-cost.sql`)

The file defines `usage` and `usage_errors` over their JSONL files. `usage` adds `tokens` (`totalTokens`, else the sum of input, cache-read, cache-write and output tokens) and `same_as_codex`, the double count: a reviewer run is logged twice, as a Codex session and as a reviewer log, and both are `usage` rows. `same_as_codex` is true for a `review-log` row with a `codex` row of the same card whose `inputTokens` + `outputTokens` equals its `totalTokens` (the log counts the input that was not cached, and the output). The four views below leave such a row out of every count and sum. The file also defines and `cost_groups`: `merged`, the cards with a run that has `mergeVerified`, and `superseded`, the cards with `superseded_by`. Sums of `costUsd` leave unpriced rows out and each view counts them; a share with a zero denominator is null.

- `summary_cost_by_stage`: per group (`cards`) and `stage`: `requests`, the four token kinds, `totalTokens` (reviewer logs), `cost_usd`, `unpriced_requests`.
- `summary_superseded_spend`: over rows attributed to a card with `superseded_by`: `cards`, `requests`, `tokens`, `cost_usd`, `unpriced_requests`.
- `summary_cache_share`: per `source` and `model`, over rows with `inputTokens`: `requests` and `cache_read_share` = `cacheReadTokens` / (`inputTokens` + `cacheReadTokens` + `cacheWriteTokens`).
- `summary_cost_per_card`: the cost of a card family (`card_family.last_card`; a card the registry does not hold is its own family) is the sum over its attributed rows; `families`, `priced_families`, and `p50_usd`, `p90_usd`, `max_usd` over the priced ones.
- `summary_unattributed`: row `unattributed` (`requests`, `tokens`, `request_share`, `token_share` of the rows with `stage` `unattributed`); one row `unpriced` per model (`key`) with its `requests` and `tokens`; and row `review_log_same_as_codex`, the `requests` and `tokens` of the rows with `same_as_codex`. This view is over every row, those included.

## GitHub tables (`github.ts`)

Without `--no-github`, `run.ts` reads `repository`, `base` and `github.requiredChecks` from the `aidlc.config.json` of the main checkout, which it resolves in the invocation directory before any child starts, and runs every `gh` and git child in the main checkout. The calls only read:

- `gh api --paginate --slurp "repos/<repository>/pulls?state=all&per_page=100"`, once.
- `gh api --paginate --slurp "repos/<repository>/commits/<sha>/check-runs?filter=all&per_page=100"`, once per distinct head sha and merge commit sha of a merged pull request. `filter=all` lists the check runs of earlier attempts too.
- `gh api --paginate --slurp "repos/<repository>/actions/runs?head_sha=<sha>&per_page=100"`, once per such commit that has a check run whose `details_url` names a workflow run (`/actions/runs/<id>`).
- `gh api --paginate --slurp "repos/<repository>/actions/runs/<id>/attempts/<n>/jobs?per_page=100"`, once per attempt of a workflow run of such a commit whose `run_attempt` is above 1.
- `git rev-parse --verify --end-of-options <base>^{commit}`, once; then `git log <format> --first-parent --end-of-options <base commit> --`, once; per revert found, `git rev-list --max-count=1 --end-of-options <revertedSha> ^<base commit>` and, when that prints nothing, `git show -s --format=%cI --end-of-options <revertedSha>`; and `git log <format> --end-of-options <headSha> ^<mergeCommitSha>^1 --`, once per pull request merged into `base`. `<format>` is `--format=%H %cI%n%P%n%(trailers:key=Co-Authored-By,valueonly,unfold,separator=%x2C)%n%B%x00`. Every revision and sha handed to git follows `--end-of-options`, so git reads none of them as an option.

Each command runs once with a 120 s timeout. Nothing is retried, a rate limit (HTTP 403 or 429) included, and nothing is cached.

| Table | One row per | Columns |
|---|---|---|
| `prs` | pull request of the repository, in any state | `number`, `headRef` (`head.ref`), `baseRef` (`base.ref`), `state`, `createdAt`, `mergedAt`, `closedAt`, `mergeCommitSha`, `headSha` (`head.sha`) |
| `checks` | check run of a head or merge commit of a merged pull request | `sha`, `name`, `status`, `conclusion`, `startedAt`, `completedAt`, `runAttempt` |
| `reverts` | first-parent commit of `base` whose message holds `This reverts commit <40 hex>` | `sha`, `date` (commit date, UTC), `revertedSha` (the first such line of the message), `daysAfter` |
| `branch_commits` | commit reachable from the head of a pull request merged into `base` and not from the first parent of its merge commit | `number`, `sha`, `date`, `merge`, `modelCoAuthor` |
| `github_errors` | command that failed, or input that could not be read | `command`, `exit`, `stderr` (its first line), `problem` |
| `required_checks` | name in `github.requiredChecks` | `name` |

- `runAttempt` is the attempt of the workflow run in which the check run's job ran. For a workflow run with one attempt that is 1 and no jobs call is made. For one with more, the jobs of each attempt are read, and a check run, which has the id of its job, gets the attempt whose jobs hold it. A check run that no attempt read holds is null, never the run's latest attempt: when a jobs call failed, that call has its `github_errors` row; when every attempt was read, the row of the workflow-run call names the check run. It is also null for a check run that names no workflow run, and for one whose workflow run could not be read, which `github_errors` names.
- `daysAfter` is the commit-date difference in days, as a fraction, to the reverted commit; null when that sha is not an ancestor of `base` (a commit merged through a second parent is an ancestor), which is no error: `git rev-list --max-count=1 --end-of-options <revertedSha> ^<base commit>` exits 0 for both answers. A sha the repository does not hold makes that call fail, which is null and one `github_errors` row.
- Shas are in lower case in every table: the 40 hex of a `This reverts commit` line are matched in either case, and the shas GitHub gives and the shas given to `checkRuns` are lowered where they enter, so the joins on sha compare one form.
- `merge` is true for a commit with more than one parent, which a merge of the base into the branch is.
- `modelCoAuthor` is true when a `Co-Authored-By` trailer, as git parses the trailer block of the message, names Claude, Codex or GPT, in any letter case. A `Co-Authored-By:` line in the body that git does not read as a trailer does not count.
- A field GitHub gives as null or leaves out is null.

Failures (`github_errors`), each beside the rows of every other command:
- A command that times out (`problem` `timeout`) or does not exit 0 (`did not exit 0`: what `gh` gives for HTTP 403, 429 and every other error status, and what a `gh` that cannot be started gives, with `exit` null). Its output is not read.
- `gh` output that is not JSON (`not JSON`, an empty output included) or not an array of at least one page (`not an array of pages`); a page that is not an array of pull requests, or has no `check_runs` or `workflow_runs` array; a pull request without a number, a check run without a name, a workflow run without `id` or `run_attempt`; a workflow run a check run names that the list does not hold; a jobs page without a `jobs` array, a job without an id; a `git log` record that is not a sha, a date, a line of parents and a message. The page or entry is left out, the others are kept, and the command has one row whose `problem` joins what was left out with `; `.
- A merged pull request of `base` without a 40-hex `headSha` and `mergeCommitSha`: one row with `command` `git log` and `exit` null, and no git call.
- A merged pull request of `base` whose `headSha` equals its `mergeCommitSha`, compared in lower case (a fast-forward or an indirect merge): the same kind of row, naming the pull request, and no git call. The first parent of that commit is the branch commit before it, so git does not give the base before the merge; the pull request has no `branch_commits` row and its `noHumanCommit` is null, never true.
- A `base` that does not resolve to a commit, a name that starts with `-` included: one row for the `git rev-parse` call and no further git call for `reverts`.
- No `repository` in `aidlc.config.json`: one row with `command` `gh api`, no `gh` call, and `reverts` is still read.

A pull request that is not merged, or merged into another branch than `base`, has no `branch_commits` rows and is no error. The tables are written through `writeTables` with the same read-only directories. Their columns are `GITHUB_COLUMNS` in `ingest.ts`, beside `COLUMNS` and `USAGE_COLUMNS`, and `writeTables` writes each of these tables that it is given and touches no file of the others.

Not detected: a revert made by a pull request that edits files without the `This reverts commit` line; a second `This reverts commit` line in one message.

Branch commits by merge shape: a squash merge, a merge commit and a rebase merge each list every branch commit (after a rebase merge the commits on `base` have new shas, so the original commits of the head are the ones listed). A fast-forward or indirect merge, where `headSha` equals `mergeCommitSha`, is one `github_errors` row and a null `noHumanCommit`, as stated under Failures. A head that `base` already held before the merge lists no commit and has no error row, so its `noHumanCommit` is null too.

## Views (`views/30-github.sql`)

The file first defines each GitHub table as a view over its JSONL file with explicit columns.

- `run_prs`: the pull requests of a card run. A run with a `prNumber` has the pull request of that number and no other; a run without one has every pull request whose `headRef` equals the card id.
- `card_merge`: per card, the pull request merged first among those of its runs, with the `mergedAt` and `mergeCommitSha` of that one pull request.
- `commit_checks`: per commit with a run of a required check (a check has several runs on a commit after a rerun). A run is pending when its `status` is not `completed`, whatever its `startedAt`, and a pending run is not a success; a completed run is a success by its `conclusion` alone, so one cancelled before it started (no `startedAt`) is a completed run that is no success. The last runs of a name are its pending ones when it has any; else its completed runs with the highest `runAttempt`; else, when no run of the name has a `runAttempt`, those with the latest `startedAt`, a run without a `startedAt` being earlier than any that has one. Runs of one `runAttempt` are ordered by `startedAt` in the same way. `green`: every required name has a run, and each name's last runs are all a success. `first_failed`: a first run of a name is no success. The first runs are those with the lowest `runAttempt`; when no run of the name has a `runAttempt`, those without a `startedAt` before any that has one, else those with the earliest `startedAt`. A run with a null `runAttempt` comes after every run that has one, so a first attempt whose attempt could not be read is not seen as the first.
- `accepted_changes`: one row per card attempt (a row of `card_attempts`: a card with at least one run), with `prNumber` and the booleans below. There are two definitions of an accepted change. `accepted`: `merged`, `checksGreen`, `notReverted` and `noRuling` are true and `noHumanCommit` is not false. `acceptedStrict`: all five are true. They differ only for a card whose `noHumanCommit` is null.
  - `merged`: the card has a merged pull request (`card_merge`). This is GitHub's answer, not `mergeVerified`; `summary_reconcile` lists where the two differ.
  - `checksGreen`: every check named in `required_checks` is `green` on the merge commit, which is: its latest run there concluded `success`. The latest run is one whose `status` is not `completed` when there is one (not a success), else the completed run with the highest `runAttempt`, else, among completed runs with no `runAttempt`, the one with the latest `startedAt`, where a run with no `startedAt` is earlier than any that has one. So a check cancelled before it started on attempt 1 and green on attempt 2 is green, and an earlier success with a queued rerun is not. A required check without a run there is not green.
  - `notReverted`: no `reverts` row names the merge commit with `daysAfter` of 14 or less. For a merge younger than 14 days the window is still open, so a true value can become false later.
  - `noHumanCommit`: true when every `branch_commits` row of the pull request is a `merge` or has `modelCoAuthor`; false when a row that is not a `merge` has none; null when the pull request has no `branch_commits` row, which is the case when its branch commits could not be read (the head commit is gone from the local repository, see `github_errors`). This is a trailer check and not proof of authorship: a person can write the trailer, and a commit the loop made without it counts as a human commit.
  - `noRuling`: no formal review entry of any run of the card carries `stopReview`, and the card is not the direct successor of a card that has one (a card that names this card in `superseded_by`).
  - `checksGreen`, `notReverted` and `noHumanCommit` are null for a card attempt without a merged pull request, which is neither `accepted` nor `acceptedStrict`.
- `summary_pr_success`: `card_attempts`; `accepted` and `pr_success_rate` = `accepted` / `card_attempts`; `accepted_strict` and `pr_success_rate_strict` = `accepted_strict` / `card_attempts`; `failing_merged`, `failing_checksGreen`, `failing_notReverted`, `failing_noHumanCommit`, `failing_noRuling`, the card attempts for which that boolean is false; `unknown_noHumanCommit`, the card attempts with a merged pull request whose `noHumanCommit` is null.
- `summary_lead_time_pr`: `p50_hours` and `p90_hours` from the `startedAt` of the earliest run of a card to the `mergedAt` of its merged pull request, over the `n` cards that have one; `merged_cards_without_pr`, the cards with a `mergeVerified` run and no merged pull request.
- `summary_ci`: over the `merged_prs` merged pull requests, `rerun_share`, the share whose head has a check run with `runAttempt` above 1 (a null `runAttempt` is no rerun), and `first_attempt_failed_share`, the share whose head has a required check with `first_failed`. A head without check runs counts in neither.
- `summary_reconcile`: rows `kind`, `cardId`, `n`. `mergeVerified_without_merged_pr`: the runs of the card with `mergeVerified` and no merged pull request in `run_prs`. `merged_pr_without_mergeVerified`: the merged pull requests whose `headRef` is the id of a card (in the registry or with a run) that has no `mergeVerified` run. `closed_unmerged`: the closed, unmerged pull requests that a run of the card names by `prNumber` or whose `headRef` is the id of a registry card, each card and pull request pair once; this covers a card whose run names a replacement pull request and a registry card with no run. The other two kinds and `accepted_changes` use `run_prs`, as R7 states the join.

Every boolean is computed from the tables as read: when `github_errors` has rows, the pull requests, commits or checks they name are missing from the views, which makes `checksGreen` false and `noHumanCommit` null, and can leave `notReverted` true.

## Tests

`tests/surface/outcome-usage.test.ts` covers the readers, the error rows, the returned keys, attribution and `priceOf` everywhere, over hand-written fixtures that keep the structure of real files with a marker in every text field; its view test (acceptance 8, 10 and 11) is skipped as below, and every `run.ts` it starts is given `--no-github`. `tests/surface/outcome-ingest.test.ts` covers the tables, the writer, the output rule, the `--duckdb` path and the exit 2 path everywhere. `tests/surface/outcome-first-decision.test.ts` covers `summary_review_convergence` over hand-written `review_decisions` rows, one card at a time and all together (acceptance 1 and 2). These view tests, acceptance 5 and 11 of `outcome-ingest.test.ts` and acceptance 1 and 2 of `outcome-first-decision.test.ts`, are skipped with the reason `no duckdb binary` where no DuckDB binary is found (`DUCKDB_BIN`, else `duckdb` on PATH), which includes CI; run them locally with `DUCKDB_BIN` set.

`tests/surface/outcome-github.test.ts` covers the four readers with a scripted runner and a real temporary git repository, and `run.ts` started in that repository with a stand-in for `gh` first on PATH; no test calls the real `gh`, and every `run.ts` it starts is given `--no-usage`, or `--claude-dir` and `--codex-dir` with empty directories of the test, so it reads no session log of the machine. Its view tests (acceptance 6 and 12) are skipped in the same way.
