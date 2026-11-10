---
id: T1-OUTCOME-USAGE
title: "The outcome bench writes one usage row per model request from Claude Code session logs, Codex session logs and reviewer logs, prices it at list price, attributes it to a card and stage, and reports cost per stage and the cache-read share"
status: todo
branch: T1-OUTCOME-USAGE
worktree: D:\wt\AIDLC\T1-OUTCOME-USAGE
plan_ref: plans/reliability-baseline.md#order-of-work
allow_paths:
  - bench/outcome/usage.ts
  - bench/outcome/prices.json
  - bench/outcome/views/20-cost.sql
  - bench/outcome/run.ts
  - bench/outcome/README.md
  - tests/surface/outcome-usage.test.ts
  - specs/tasks/T1-OUTCOME-USAGE.md
dod_command: npm run typecheck && node --test tests/surface/outcome-usage.test.ts tests/surface/outcome-ingest.test.ts
dod_exit: 0
requirements:
  - R1. `claudeUsage(dirs, cardIds)` in `bench/outcome/usage.ts` shall read every `*.jsonl` at any depth under the given Claude Code project directories (a session file `<session>.jsonl`, and a subagent file `<session>/subagents/agent-<id>.jsonl`) and return one row per distinct (`message.id`, `requestId`) of the lines with `type` `assistant` and a `message.usage`, with `source` `claude-code`, `sessionId`, `ts` (`timestamp`), `model` (`message.model`), `cwd`, `sidechain` (`isSidechain`), `inputTokens` (`input_tokens`), `outputTokens` (`output_tokens`), `cacheReadTokens` (`cache_read_input_tokens`), `cacheWriteTokens` (`cache_creation_input_tokens`), `agentId` (the `<id>` of a subagent file name, null for a session file), and `agentType` and `agentCard` (the `agentType` of the sibling `agent-<id>.meta.json`, and the first id of `cardIds` that its `description` holds as a whole token; each null when the file, the field or such an id is absent), keeping the last line of each pair.
  - R2. `codexUsage(dir)` shall read every `rollout-*.jsonl` under the given directory and return one row per file from its last `event_msg` line whose `payload.type` is `token_count`, with `source` `codex`, `sessionId` and `cwd` (`session_meta.payload.id` and `.cwd`), `ts` (that line's `timestamp`), `model` (the last `turn_context.payload.model`), `inputTokens` (`total_token_usage.input_tokens` minus `cached_input_tokens`), `cacheReadTokens` (`cached_input_tokens`), `cacheWriteTokens` (`cache_write_input_tokens`) and `outputTokens` (`output_tokens`).
  - R3. `reviewLogUsage(stateDir)` shall return one row per `*.log` under `evidence/*/review/` that holds a `tokens used` line followed by a number line, with `source` `review-log`, the goal and card from its path, `invocation` (the file stem), `totalTokens` (the number with its thousands separators removed), `durationMs` from the header line and `model` from the `model:` line.
  - R4. A source directory that is absent or not a directory (`problem` `missing directory`), a file that cannot be read, a line that is not JSON, a meta file that is not JSON and a Codex file with no `token_count` line shall each be counted in a `usage_errors` table with `source`, `path` and `problem`, with the rows of every other source still returned.
  - R5. No function of this module shall return or write any field other than those named in R1 to R4 and R6, so no message text, prompt, tool input or tool output leaves the session logs.
  - R6. `attribute(rows, tables, worktreeRoot)` shall set `cardId`, `goalId` and `stage` on each row by the first rule that applies. (a) A `review-log` row takes the goal and card of its path, `stage` `review`. (b) A `codex` row whose `cwd` is `<worktreeRoot>/<cardId>` or below takes that card, `stage` `review`. (c) A `claude-code` row with an `agentId` takes its `agentCard`, else the card of the one attempt (`attempts` table, `startTs` to `endTs`) that holds its `ts` when exactly one attempt of any card does, `stage` `implement` when `agentType` is `implementer` and `subagent` otherwise. (d) A `claude-code` row with no `agentId` takes the card whose state span holds its `ts` when exactly one span of any card does, `stage` `coordinate`. Every other row has null `cardId` and `stage` `unattributed`. For (b), (c) and (d) the `goalId` is that of the card run whose `startedAt` to `updatedAt` window holds the `ts`, else of the nearest earlier run of that card, else null.
  - R7. `priceOf(row, prices)` shall return the list-price cost in USD from `bench/outcome/prices.json` (per million input, cache-read, cache-write and output tokens, keyed by model id, each entry with its source URL and the date read), and null for a model with no entry or a row with only `totalTokens`.
  - R8. `run.ts` shall take `--claude-dir <dir>` (repeatable; default the Claude Code project directories of the checkout and of each directory under `worktreeRoot`), `--codex-dir <dir>` (default `~/.codex/sessions`) and `--no-usage`, and write `usage.jsonl` and `usage_errors.jsonl` beside the other tables through `writeTables`, with every Claude directory and the Codex directory added to its read-only directories.
  - R9. `views/20-cost.sql` shall define `summary_cost_by_stage` (tokens by kind and list-price cost per stage, for cards that merged and for cards with `superseded_by`), `summary_superseded_spend` (total tokens and cost on cards with `superseded_by`), `summary_cache_share` (`cacheReadTokens` / (`inputTokens` + `cacheReadTokens` + `cacheWriteTokens`) per source and model), `summary_cost_per_card` (p50, p90 and max cost per card family) and `summary_unattributed` (the share of tokens and of rows with `stage` `unattributed`, the unpriced rows per model, and the Codex sessions that overlap a `review-log` row of the same card within its duration, which are the same request counted twice).
  - R10. `bench/outcome/README.md` shall state the sources, the fields read, the attribution rule, that cost is a list-price estimate and not a bill, and the double count that `summary_unattributed` reports.
acceptance:
  - 1. `tests/surface/outcome-usage.test.ts`: over fixture lines that keep the structure of real files with every text field replaced by `x`, `claudeUsage` returns one row for three lines sharing a (`message.id`, `requestId`) with the values of the last, skips `user` and `system` lines, and maps the four token fields as R1 states; a row of `<session>/subagents/agent-a1.jsonl` whose meta file holds `agentType` `implementer` and a description naming `T1-X-2` has `agentId` `a1`, `agentType` `implementer` and `agentCard` `T1-X-2` (not `T1-X`, which is also in `cardIds`), and a subagent file with no meta file has null `agentType` and `agentCard` and no error row. [R1] [dod arm 2]
  - 2. Same file: `codexUsage` over a fixture with two `token_count` lines returns one row from the second, with `inputTokens` 43200 for `input_tokens` 277568 and `cached_input_tokens` 234368, and the session id, cwd and model of the fixture. [R2] [dod arm 2]
  - 3. Same file: `reviewLogUsage` reads `tokens used` then `44,031` as 44031 with the goal, card, invocation, duration and model of the fixture path and header; a log with no such line gives no row and no error. [R3] [dod arm 2]
  - 4. Same file: an absent Claude directory, an absent Codex directory, an absent state `evidence` directory, a line holding `{`, a meta file holding `{` and a Codex file with no `token_count` line give six `usage_errors` rows (the first three with `missing directory`), and the valid rows of the other directories are still returned. [R4] [dod arm 2]
  - 5. Same file: every row of items 1 to 4 has only the keys R1 to R4 and R6 name, and the serialized rows do not contain the marker string the fixtures put in each text field. [R5] [dod arm 2]
  - 6. Same file: `attribute` gives a `review-log` row the goal and card of its path; a `codex` row in `<worktreeRoot>/T1-X` the card `T1-X` with `review` and the goal of the run whose window holds it, and one in `<worktreeRoot>/T1-X-2` not the card `T1-X`; a subagent row its `agentCard` with `implement`; a subagent row with no `agentCard` inside exactly one attempt that card, and inside two overlapping attempts `unattributed`; a session row inside exactly one state span that card with `coordinate`, and inside two spans or outside every span `unattributed`. [R6] [dod arm 2]
  - 7. Same file: `priceOf` computes a hand-checked cost from a two-model price table, returns null for an unknown model and for a `review-log` row, and `prices.json` parses with a source URL and date on every entry. [R7] [dod arm 2]
  - 8. Same file, when a DuckDB binary is found, else skipped with the reason `no duckdb binary`: `run.ts` over fixture directories prints the five views with hand-computed values, `--no-usage` writes no usage table and still exits 0, and `--out` under a given `--claude-dir` exits 1 with `refusing to write` and creates nothing. [R8] [R9] [dod arm 2]
  - 9. The README states R1 to R9 (reviewer-verified against the diff). [R10]
depends_on: [T1-OUTCOME-INGEST]
budget: 480
sweep: "New files, plus `bench/outcome/run.ts` and the README from T1-OUTCOME-INGEST. Field names read from one real Claude Code session log, one real Codex rollout file and one reviewer log on 2026-11-10 (structure only): `message.usage.*`, `message.id`, `requestId`, `isSidechain`; `event_msg` `token_count` with `info.total_token_usage`; `tokens used` then `44,031`. Amended on 2026-11-10 before the card started, from T1-OUTCOME-INGEST (PR 255): a subagent's requests are in `<session>/subagents/agent-<id>.jsonl` with the session's `cwd`, not the worktree's, and `agent-<id>.meta.json` holds `agentType` and a `description` that names the card, so attribution reads those; absent directories and the output rule are stated as that card's R14 and R15 state them. No stored result carries `costUsd` or `cacheReadTokens`: `git grep -c costUsd -- src` shows the provider type only."
forbid: [any change under src/ templates/ or .claude/, a write outside the output directory, reading or writing any text field of a session log, a dependency added to package.json, a network call]
non_goals: [billing reconciliation (the reviewer runs on a subscription), the `description` text of a meta file (only a card id found in it is kept), subagent transcripts stored outside the project directories given (not read; their tokens show as missing in the README's gap list), Codex rows per turn (one row per session), a price for a model with no public list price (null and listed)]
hygiene: "Fixtures hold structure only. Do not copy a real session line into the repository, even shortened."
doc_sync: bench/outcome/README.md
---

# T1-OUTCOME-USAGE

## Deliverable
Usage rows with list-price cost, attributed to cards and stages, and the cost views.

## Why
No stored result carries cost or cache tokens: the reviewer's count is one `tokens used` line per log and the implementer's usage exists only in session logs. Without it the cost of the 82 superseded cards and the cache-read share cannot be stated.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-usage.test.ts tests/surface/outcome-ingest.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; item 8 is skipped only where no DuckDB binary is found.

## Attempt evidence
RED, attempt 1: commit 18c8e9b (the test against a seam module that returns no rows): 7 failed and 1 skipped without `DUCKDB_BIN`, 8 failed with it.

| Item | Proof | Result |
|---|---|---|
| 1 to 7 | `node --test tests/surface/outcome-usage.test.ts`, tests `acceptance 1` to `acceptance 7` | pass |
| 8 | same file, test `acceptance 8`, with `DUCKDB_BIN` set to the local duckdb.exe: `# tests 8`, `# pass 8`; without it: `# pass 7`, `# skipped 1` (`no duckdb binary`) | pass |
| 9 | `bench/outcome/README.md`: Command (R8), Usage tables (R1 to R7), Cost views (R9) | reviewer-verified against the diff |

Input forms and what each becomes (README, Usage tables). Named by R4 and tested by `acceptance 4`: an absent directory of each source, a line that is not JSON, a meta file that is not JSON, a Codex file without a `token_count` line. Tested by `acceptance 1` and `acceptance 3`: an absent meta file and a log without a `tokens used` number give no error. Not named by the card, handled and not tested (no acceptance item names them):
- A directory or file that cannot be read: one `unreadable: <code>` row. The real run has one, a Codex file over the string limit of Node.
- A usage line without a `message.id`: an error row, not a row merged with others. A usage line without a `requestId` (two real lines, model `<synthetic>`): a row keyed by its `message.id`.
- A `token_count` line without `info.total_token_usage`: not counted as one. Several `session_meta` lines: the first.
- A log directly under `review`: a row with a null `cardId`. Several `tokens used` lines: the last. A goal without a `review` directory: no row.
- A span or attempt without both ends holds no `ts`; an end is exclusive.

Points where the card and the code differ or the card is silent:
- R8 asks for the usage tables "through `writeTables`", which writes only the tables of `COLUMNS` in `bench/outcome/ingest.ts`, a file outside `allow_paths`. `run.ts` adds the two usage tables to `COLUMNS` at run time (`Object.assign`). Declaring them in `ingest.ts` would need that file in `allow_paths`.
- R5 names the fields of R1 to R4 and R6; the views of R9 need the cost of R7, so `run.ts` writes it as `costUsd`. The readers return only the named fields (`acceptance 5`).
- R9 "overlap a `review-log` row of the same card within its duration": R3 gives that row no timestamp. The view takes the start from `review_decisions.requestedAt` of the decision the log name carries. On the real run 42 sessions match; the last line of a session lies a median 0.3 s after `requestedAt` plus `durationMs`, so the count is a lower bound. Every one of 120 logs checked has a Codex session of the same card with `inputTokens` plus `outputTokens` equal to its `totalTokens`, which would be an exact rule.
- `prices.json` holds no entry: no list price is cited in this repository and this run had no web access. Every row is unpriced, and `acceptance 8` checks the cost sums over rows it prices itself.
- Open, DoD with `DUCKDB_BIN`: exit 1, 17 passed and 1 failed. The failing test is `T1-OUTCOME-INGEST acceptance 5` in `tests/surface/outcome-ingest.test.ts`, which is outside `allow_paths`: it runs `run.ts` without `--no-usage` and asserts that exactly the four views of `10-cards.sql` are printed, and R8 makes usage the default, so the five cost views are printed too. Without `DUCKDB_BIN` (the CI case) that test is skipped and the DoD exits 0 with 15 passed and 3 skipped. The `run.ts` calls of that file also read the default Claude and Codex directories of the machine now. Passing `--no-usage` in its two spawn helpers would fix both and needs that file in `allow_paths`.
- Size: 596 lines added and 17 removed against the budget of 480: test 233, `usage.ts` 193, `20-cost.sql` 62, README 57, `run.ts` 42, this section 26.

Real run on 2026-11-10 (`--state D:\Projects\AIDLC\.aidlc --cards D:\Projects\AIDLC\specs\tasks`, default Claude and Codex directories, `--out` outside the repository and every source), exit 0 in 10 s: usage 12086 rows (claude-code 11624, codex 322, review-log 140), usage_errors 25 (24 `missing directory` for worktrees without a Claude project directory, 1 `unreadable: ERR_STRING_TOO_LONG`). `summary_unattributed`: 6141 rows, 50.8% of rows and 56.1% of tokens. `summary_superseded_spend`: 33 cards, 2097 requests, 450867383 tokens. `summary_cost_per_card`: 91 families, 0 priced. `summary_cache_share`: claude-opus-5-5 0.982 over 11324 requests, gpt-6-astra 0.855 over 316. `usage.jsonl` holds the 20 columns of `USAGE_COLUMNS`; its longest string is a 68-character `cwd`.
