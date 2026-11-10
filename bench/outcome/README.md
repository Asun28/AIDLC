# bench/outcome: outcome tables and views

Dev-only measurement scripts (plan `plans/reliability-baseline.md`). They read the state directory, the card registry, Claude Code session logs and Codex session logs, and write only under `--out`. Table and view names may change with the scripts.

## Command

```bash
node bench/outcome/run.ts [--state <dir>] [--cards <dir>] [--out <dir>] [--duckdb <path>] [--claude-dir <dir>]... [--codex-dir <dir>] [--no-usage]
```

- `--state`: the state directory. Default: the one aidlc resolves for the checkout (`AIDLC_STATE_DIR`, else `<main checkout>/.aidlc`).
- `--cards`: the card registry. Default: the configured `cardsDir` under the main checkout.
- `--out`: where the tables are written. Default: `_local/outcome` under the main checkout. A path that is the state directory, the registry, a Claude directory or the Codex directory, or under one of them, is refused before anything is created (exit 1, `refusing to write`).
- `--duckdb`: the DuckDB binary. Default: `duckdb` on PATH. A value that is absolute or holds a path separator is resolved against the invocation directory. A bare name is left to the operating system's lookup, which on Windows tries the child's working directory (`--out`) before PATH.
- `--claude-dir` (repeatable): a Claude Code project directory. Default: `~/.claude/projects/<name>` for the main checkout and for each directory under the configured worktree root, where `<name>` is the absolute path with every character but letters and digits replaced by `-`. A default that does not exist is a `missing directory` row like any other.
- `--codex-dir`: the Codex session directory. Default: `~/.codex/sessions`.
- `--no-usage`: reads no session or reviewer log, writes no usage table and leaves out `views/20-cost.sql`.

`--state`, `--cards`, `--out`, `--claude-dir` and `--codex-dir` are resolved against the invocation directory too, before the DuckDB child starts in `--out`.

The run writes `<table>.jsonl` per table, prints the row counts on stderr, runs every `bench/outcome/views/*.sql` in name order through the DuckDB binary with `--out` as its working directory (an in-memory database, so nothing else is written), and prints each view named `summary_*` on stdout as one line `{"view": "<name>", "rows": [...]}`, in name order. Exit codes: 0; 1 when an argument, a read or a view fails; 2 when the DuckDB binary cannot be started, after the tables are written. The message of exit 2 names `winget install DuckDB.cli`.

## Tables (`ingest.ts`)

`ingestState({ stateDir, cardsDir })` returns the tables as arrays of plain rows and reads files only. A field the record does not carry is null. `writeTables(tables, outDir)` writes the keys in the column order below and sorts the lines by UTF-16 code unit, so the same rows given in any order write the same bytes; an empty table writes an empty file.

Where output may be written is decided in one place, `writeTables(tables, outDir, readOnly)`, the only write these scripts make (`run.ts` passes the state directory, the registry, every Claude directory and the Codex directory as `readOnly`):
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

## Usage tables (`usage.ts`)

One `usage` row per model request. Only the fields below leave a log: no message text, prompt, tool input or tool output is returned, written or printed. Each reader returns `{ rows, errors }`; `run.ts` writes the rows after `attribute` and `priceOf`, and the errors as `usage_errors` (`source`, `path`, `problem`).

| `source` | Read from | One row per | Fields |
|---|---|---|---|
| `claude-code` | every `*.jsonl` at any depth under each Claude directory: `<session>.jsonl` and `<session>/subagents/agent-<id>.jsonl` | distinct (`message.id`, `requestId`) over all lines with `type` `assistant` and a `message.usage`, keeping the last line (a response is logged several times while it streams) | `sessionId`, `ts` (`timestamp`), `model` (`message.model`), `cwd`, `sidechain` (`isSidechain`), `inputTokens`, `outputTokens`, `cacheReadTokens` (`cache_read_input_tokens`), `cacheWriteTokens` (`cache_creation_input_tokens`), `agentId` (from the file name, null for a session file), `agentType` and `agentCard` (from the sibling `agent-<id>.meta.json`: its `agentType`, and the first registry id its `description` holds with no letter, digit, `_` or `-` directly before or after; nothing else of the description is kept) |
| `codex` | every `rollout-*.jsonl` at any depth under the Codex directory | file, from its last `event_msg` line with `payload.type` `token_count` that carries `info.total_token_usage` (one row per session, not per turn) | `sessionId`, `cwd` (the first `session_meta` line: `payload.id`, `payload.cwd`), `ts` (that line), `model` (the last `turn_context`), `inputTokens` (`input_tokens` minus `cached_input_tokens`), `cacheReadTokens` (`cached_input_tokens`), `cacheWriteTokens` (`cache_write_input_tokens`), `outputTokens` |
| `review-log` | every `*.log` under `<state>/evidence/<goal>/review/` | log whose last `tokens used` line is followed by a number line | `goalId`, `cardId` (the two directories of its path; `cardId` is null for a log directly under `review`), `invocation` (file stem), `totalTokens` (thousands separators removed), `durationMs` (header line), `model` (first `model:` line) |

Inputs that cannot be read (each is one `usage_errors` row, and every other row is still returned):
- A Claude directory, the Codex directory or `<state>/evidence` that is absent or not a directory: `missing directory`.
- A directory or file that cannot be read: `unreadable: <error code>`. A file over the string limit of Node (about 512 MB) is one of these.
- A line that is not JSON: `not JSON (line <n>)`. A meta file that is not JSON: `not JSON`, and the rows of its subagent keep null `agentType` and `agentCard`.
- A usage line without a `message.id`: `usage line without message.id (line <n>)`. A line without a `requestId` is a row.
- A Codex file with no `token_count` line that carries `info.total_token_usage`: `no token_count line`.

Normal results that give no row: an absent meta file (null `agentType` and `agentCard`), a goal without a `review` directory, a log without a `tokens used` number, a field a line does not carry (null), blank lines, and links, which are not followed.

`attribute(rows, tables, worktreeRoot)` sets `cardId`, `goalId` and `stage` by the first rule that applies:
1. A `review-log` row keeps the goal and card of its path; `stage` `review`.
2. A `codex` row whose `cwd` is `<worktreeRoot>/<cardId>` or below takes that card; `stage` `review`.
3. A `claude-code` row with an `agentId` takes its `agentCard`, else the card of the one attempt that holds its `ts` when exactly one attempt of any card does; `stage` `implement` when `agentType` is `implementer`, else `subagent`. The lines of a subagent carry the `cwd` of the session, not of the worktree, so the `cwd` is not used.
4. A `claude-code` row without an `agentId` takes the card of the one state span that holds its `ts` when exactly one span of any card does; `stage` `coordinate`.
5. Every other row has a null `cardId` and `stage` `unattributed`.

An attempt or a span holds a `ts` when `startTs <= ts < endTs`; one without both ends, such as the open last span of a card, holds nothing. For rules 2 to 4 the `goalId` is that of the card run whose `startedAt` to `updatedAt` window holds the `ts` (the latest such run), else of the nearest earlier run of that card, else null.

`priceOf(row, prices)` is the list-price cost in USD: each token kind times its price per million tokens in `prices.json` (keyed by model id; `input`, `cacheRead`, `cacheWrite`, `output`, with the `source` URL and the `date` read). It is null for a model without an entry and for a row without `inputTokens` (every `review-log` row); a kind the row lacks counts as 0. `run.ts` writes it as `costUsd`. The cost is an estimate at list price, not a bill: the reviewer runs on a subscription and nothing here is reconciled with an invoice. `prices.json` holds no entry yet, so every row is unpriced and `summary_unattributed` lists the models.

Gaps: subagent transcripts stored outside the directories given are not read, so their tokens are missing; a Codex session counts once with its final totals; an unreadable file contributes no tokens.

## Cost views (`views/20-cost.sql`)

The file defines `usage` (with `tokens`: `totalTokens`, else the sum of the four kinds) and `usage_errors` over their JSONL files, and `cost_groups`: `merged`, the cards with a run that has `mergeVerified`, and `superseded`, the cards with `superseded_by`. Sums of `costUsd` leave unpriced rows out and each view counts them; a share with a zero denominator is null.

- `summary_cost_by_stage`: per group (`cards`) and `stage`: `requests`, the four token kinds, `totalTokens` (reviewer logs), `cost_usd`, `unpriced_requests`.
- `summary_superseded_spend`: over rows attributed to a card with `superseded_by`: `cards`, `requests`, `tokens`, `cost_usd`, `unpriced_requests`.
- `summary_cache_share`: per `source` and `model`, over rows with `inputTokens`: `requests` and `cache_read_share` = `cacheReadTokens` / (`inputTokens` + `cacheReadTokens` + `cacheWriteTokens`).
- `summary_cost_per_card`: the cost of a card family (`card_family.last_card`; a card the registry does not hold is its own family) is the sum over its attributed rows; `families`, `priced_families`, and `p50_usd`, `p90_usd`, `max_usd` over the priced ones.
- `summary_unattributed`: row `unattributed` (`requests`, `tokens`, `request_share`, `token_share` of the rows with `stage` `unattributed`); one row `unpriced` per model (`key`) with its `requests` and `tokens`; and row `codex_sessions_in_review_log`, the double count: a reviewer run is logged twice, as a Codex session and as a reviewer log, and both are `usage` rows. The row counts the Codex sessions attributed to a card whose `ts` lies between the `requestedAt` of a formal review of that card and `requestedAt` plus the `durationMs` of the log of that review (the log named `<card>.r3.<decision>.<suffix>`), with their `tokens`. A reviewer-log row carries no timestamp of its own, and the last line of a session is often written just after that window ends, so the row is a lower bound.

## Tests

`tests/surface/outcome-usage.test.ts` covers the readers, the error rows, the returned keys, attribution and `priceOf` everywhere, over hand-written fixtures that keep the structure of real files with a marker in every text field; its view test (acceptance 8) is skipped as below. `tests/surface/outcome-ingest.test.ts` covers the tables, the writer, the output rule, the `--duckdb` path and the exit 2 path everywhere. The view tests (acceptance 5 and 11) are skipped with the reason `no duckdb binary` where no DuckDB binary is found (`DUCKDB_BIN`, else `duckdb` on PATH), which includes CI; run them locally with `DUCKDB_BIN` set.
