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
  - bench/outcome/ingest.ts
  - bench/outcome/README.md
  - tests/surface/outcome-usage.test.ts
  - tests/surface/outcome-ingest.test.ts
  - specs/tasks/T1-OUTCOME-USAGE.md
dod_command: npm run typecheck && node --test tests/surface/outcome-usage.test.ts tests/surface/outcome-ingest.test.ts
dod_exit: 0
requirements:
  - R1. `claudeUsage(dirs, cardIds)` in `bench/outcome/usage.ts` shall read every `*.jsonl` at any depth under the given Claude Code project directories (a session file `<session>.jsonl`, and a subagent file `<session>/subagents/agent-<id>.jsonl`) and return one row per distinct (`message.id`, `requestId`) of the lines with `type` `assistant` and a `message.usage`, with `source` `claude-code`, `sessionId`, `ts` (`timestamp`), `model` (`message.model`), `cwd`, `sidechain` (`isSidechain`), `inputTokens` (`input_tokens`), `outputTokens` (`output_tokens`), `cacheReadTokens` (`cache_read_input_tokens`), `cacheWriteTokens` (`cache_creation_input_tokens`), `cacheWrite1hTokens` (`cache_creation.ephemeral_1h_input_tokens`, 0 when absent), `agentId` (the `<id>` of a subagent file name, null for a session file), and `agentType` and `agentCard` (the `agentType` of the sibling `agent-<id>.meta.json`, and the first id of `cardIds` that its `description` holds as a whole token; each null when the file, the field or such an id is absent), keeping the last line of each pair.
  - R2. `codexUsage(dir)` shall read every `rollout-*.jsonl` under the given directory and return one row per file from its last `event_msg` line whose `payload.type` is `token_count`, with `source` `codex`, `sessionId` and `cwd` (`payload.id` and `.cwd` of the first `session_meta` line), `ts` (that line's `timestamp`), `model` (the last `turn_context.payload.model`), `inputTokens` (`total_token_usage.input_tokens` minus `cached_input_tokens`), `cacheReadTokens` (`cached_input_tokens`), `cacheWriteTokens` (`cache_write_input_tokens`) and `outputTokens` (`output_tokens`).
  - R3. `reviewLogUsage(stateDir)` shall return one row per `*.log` under `evidence/*/review/` that holds a `tokens used` line followed by a number line (the last such pair when there are several), with `source` `review-log`, the goal and card from its path (a null card for a log directly under `review`), `invocation` (the file stem), `totalTokens` (the number with its thousands separators removed), `durationMs` from the header line and `model` from the `model:` line.
  - R4. A source directory that is absent or not a directory (`problem` `missing directory`), a directory or file that cannot be read (a file over Node's string limit included), a line that is not JSON, a usage line with no `message.id`, a meta file that is not JSON or cannot be read and a Codex file with no `token_count` line that holds `info.total_token_usage` shall each be counted in a `usage_errors` table with `source`, `path` (the entry that failed, not the directory given) and `problem`, with the rows of every other file, sibling directory and source still returned.
  - R5. No function of this module shall return or write any field other than those named in R1 to R4, R6 and R7 (`costUsd`), so no message text, prompt, tool input or tool output leaves the session logs.
  - R6. `attribute(rows, tables, worktreeRoot)` shall set `cardId`, `goalId` and `stage` on each row by the first rule that applies. (a) A `review-log` row takes the goal and card of its path, `stage` `review`. (b) A `codex` row whose `cwd` is `<worktreeRoot>/<cardId>` or below takes that card, `stage` `review`. (c) A `claude-code` row with an `agentId` takes its `agentCard`, else the card of the one attempt (`attempts` table, `startTs` to `endTs`) that holds its `ts` when exactly one attempt of any card does, `stage` `implement` when `agentType` is `implementer` and `subagent` otherwise. (d) A `claude-code` row with no `agentId` takes the card whose state span holds its `ts` when exactly one span of any card does, `stage` `coordinate`. Every other row has null `cardId` and `stage` `unattributed`. For (b), (c) and (d) the `goalId` is that of the card run whose `startedAt` to `updatedAt` window holds the `ts`, else of the nearest earlier run of that card, else null.
  - R7. `priceOf(row, prices)` shall return the list-price cost in USD from `bench/outcome/prices.json` (per million input, cache-read, cache-write, long cache-write and output tokens, keyed by model id, each entry with its source URL, the date read and the duration of its two cache-write tiers: 5 minutes and 1 hour for the Claude models, 30 minutes and 12 hours for the OpenAI models; `cacheWrite1hTokens` at the long price and the rest of `cacheWriteTokens` at the shorter one, which a Codex row always takes since its log names no duration), and null for a model with no entry or a row with only `totalTokens`; `prices.json` holds the standard-tier prices of `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`, `gpt-6-astra` and `gpt-5.6-sol` read from the vendors' pricing pages on 2026-11-10.
  - R8. `run.ts` shall take `--claude-dir <dir>` (repeatable; default the Claude Code project directory of the checkout), `--codex-dir <dir>` (default `~/.codex/sessions`) and `--no-usage`, and write `usage.jsonl` (with `costUsd`) and `usage_errors.jsonl` beside the other tables through `writeTables`, whose column declarations in `ingest.ts` gain these two tables, with every Claude directory and the Codex directory added to its read-only directories; the spawns of `tests/surface/outcome-ingest.test.ts` pass `--no-usage`, so that test reads no session log of the machine.
  - R9. `views/20-cost.sql` shall define `summary_cost_by_stage` (tokens by kind and list-price cost per stage, for cards that merged and for cards with `superseded_by`), `summary_superseded_spend` (total tokens and cost on cards with `superseded_by`), `summary_cache_share` (`cacheReadTokens` / (`inputTokens` + `cacheReadTokens` + `cacheWriteTokens`) per source and model), `summary_cost_per_card` (p50, p90 and max cost per card family) and `summary_unattributed` (the share of tokens and of rows with `stage` `unattributed`, the unpriced rows per model, and the count and tokens of `review-log` rows that have a `codex` row of the same card whose `inputTokens + outputTokens` equals their `totalTokens`, since a reviewer log counts no cached input); such a `review-log` row is the same request as that Codex session, so the request, token and cost sums of the other four views leave it out.
  - R11. `writeTables` shall compare a read-only directory whose path cannot be resolved (absent, or any other error such as EACCES on it or on an ancestor) by the canonical path of its nearest resolvable ancestor plus the remainder, as it already does for the output directory, so that an inaccessible source directory still refuses an output directory inside it and does not stop the tables, `usage_errors` included, from being written elsewhere.
  - R10. `bench/outcome/README.md` shall state the sources, the fields read, the attribution rule, that cost is a list-price estimate and not a bill, and the double count that `summary_unattributed` reports.
acceptance:
  - 1. `tests/surface/outcome-usage.test.ts`: over fixture lines that keep the structure of real files with every text field replaced by `x`, `claudeUsage` returns one row for three lines sharing a (`message.id`, `requestId`) with the values of the last, skips `user` and `system` lines, and maps the four token fields as R1 states; a row of `<session>/subagents/agent-a1.jsonl` whose meta file holds `agentType` `implementer` and a description naming `T1-X-2` has `agentId` `a1`, `agentType` `implementer` and `agentCard` `T1-X-2` (not `T1-X`, which is also in `cardIds`), and a subagent file with no meta file has null `agentType` and `agentCard` and no error row. [R1] [dod arm 2]
  - 2. Same file: `codexUsage` over a fixture with two `token_count` lines returns one row from the second, with `inputTokens` 43200 for `input_tokens` 277568 and `cached_input_tokens` 234368, and the session id, cwd and model of the fixture. [R2] [dod arm 2]
  - 3. Same file: `reviewLogUsage` reads `tokens used` then `44,031` as 44031 with the goal, card, invocation, duration and model of the fixture path and header; a log with two such pairs gives the second; a log directly under `review` gives a row with a null card; a log with no such line gives no row and no error. [R3] [dod arm 2]
  - 4. Same file: an absent Claude directory, an absent Codex directory, an absent state `evidence` directory, a line holding `{`, a usage line with no `message.id`, a meta file holding `{`, a Codex file with no `token_count` line, a Codex file whose only `token_count` line has no `info.total_token_usage`, a directory named `s.jsonl` under a Claude directory and a directory named `rollout-x.jsonl` under the Codex directory (each cannot be read as a file) give ten `usage_errors` rows (the first three with `missing directory`, the last two with a `problem` starting `unreadable`), and the valid rows of the other directories are still returned. [R4] [dod arm 2]
  - 5. Same file: every row of items 1 to 4 has only the keys R1 to R4 and R6 name, and the serialized rows do not contain the marker string the fixtures put in each text field. [R5] [dod arm 2]
  - 6. Same file: `attribute` gives a `review-log` row the goal and card of its path; a `codex` row in `<worktreeRoot>/T1-X` the card `T1-X` with `review` and the goal of the run whose window holds it, and one in `<worktreeRoot>/T1-X-2` not the card `T1-X`; a subagent row its `agentCard` with `implement`; a subagent row with no `agentCard` inside exactly one attempt that card, and inside two overlapping attempts `unattributed`; a session row inside exactly one state span that card with `coordinate`, and inside two spans or outside every span `unattributed`. [R6] [dod arm 2]
  - 7. Same file: `priceOf` computes a hand-checked cost from a two-model price table for a row with both 5-minute and 1-hour cache writes, returns null for an unknown model and for a `review-log` row, prices a Codex row's cache writes at the shorter tier, and `prices.json` parses with the six models of R7, each with five prices that are all above zero, the two tier durations, a source URL and the date 2026-11-10. [R7] [dod arm 2]
  - 8. Same file, when a DuckDB binary is found, else skipped with the reason `no duckdb binary`: `run.ts` over fixture directories prints the five views with hand-computed values, `--no-usage` writes no usage table and still exits 0, and `--out` under a given `--claude-dir` exits 1 with `refusing to write` and creates nothing. [R8] [R9] [dod arm 2]
  - 9. The README states R1 to R9 (reviewer-verified against the diff). [R10]
  - 11. Same file: the fixture of item 8 holds rows of a model that `prices.json` prices, and their hand-computed `costUsd` is asserted in the `usage.jsonl` that `run.ts` wrote, before the test changes any output, and in the cost views. [R7] [R8] [R9] [dod arm 2]
  - 12. Same file: with a path-resolving function that throws EACCES for a given Claude directory, `writeTables` still writes `usage.jsonl` and `usage_errors.jsonl` (which names that directory) to a separate output directory, and refuses an output directory inside that Claude directory. [R4] [R11] [dod arm 2]
  - 10. `tests/surface/outcome-ingest.test.ts` passes unchanged apart from `--no-usage` in its `run.ts` spawns, with and without a DuckDB binary, and the fixture of item 8 holds a `review-log` row matched by a `codex` row that the sums leave out and one unmatched that they keep. [R8] [R9] [dod arm 2]
depends_on: [T1-OUTCOME-INGEST]
budget: 800
sweep: "New files, plus `bench/outcome/run.ts` and the README from T1-OUTCOME-INGEST. Field names read from one real Claude Code session log, one real Codex rollout file and one reviewer log on 2026-11-10 (structure only): `message.usage.*`, `message.id`, `requestId`, `isSidechain`; `event_msg` `token_count` with `info.total_token_usage`; `tokens used` then `44,031`. Amended on 2026-11-10 before the card started, from T1-OUTCOME-INGEST (PR 255): a subagent's requests are in `<session>/subagents/agent-<id>.jsonl` with the session's `cwd`, not the worktree's, and `agent-<id>.meta.json` holds `agentType` and a `description` that names the card, so attribution reads those; absent directories and the output rule are stated as that card's R14 and R15 state them. No stored result carries `costUsd` or `cacheReadTokens`: `git grep -c costUsd -- src` shows the provider type only."
forbid: [any change under src/ templates/ or .claude/, a write outside the output directory, reading or writing any text field of a session log, a dependency added to package.json, a network call]
non_goals: [billing reconciliation (the reviewer runs on a subscription), merging usage lines that have no `requestId` (each is a row of its own), the `description` text of a meta file (only a card id found in it is kept), subagent transcripts stored outside the project directories given (not read; their tokens show as missing in the README's gap list), Codex rows per turn (one row per session), a price for a model with no public list price (null and listed), long-context, batch and fast-mode price tiers (the standard tier is used for every row; the README says so), reading a Codex file larger than Node's string limit by stream (it is an error row)]
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
Attempt 1 (candidate 9c22c4f): failed with the cause "card conflict"; RED 18c8e9b. Attempt 2 (candidate d1a2fa78): RED ea564ff4 and d873eb1f; R3 decision 1 blocked it on six classes. Attempt 3 (candidate cc7bbea1): RED a69f7ac4; R3 decision 2 did not raise those six again and blocked on two new classes.
Attempt 4 (repair of R3 decision 2, after the amendment 221ca993): RED 7df7815a, the new assertions against candidate cc7bbea1 with the resolving function passed through `writeTables` unchanged in behaviour: over both DoD test files, `acceptance 12` failed with the EACCES of the resolver (the defect itself) and 15 passed, 3 skipped without `DUCKDB_BIN`; 1 failed and 18 passed with it. `acceptance 8, 10 and 11` passed at RED because the pricing line of `run.ts` already existed; mutant M11 below proves it now fails without that line.

| Item | Proof | Result |
|---|---|---|
| 1 to 7 | `node --test tests/surface/outcome-usage.test.ts`, tests `acceptance 1` to `acceptance 7` (ten error rows in `acceptance 4`) | pass |
| 8 | same file, test `acceptance 8, 10 and 11`, with `DUCKDB_BIN` set to the local duckdb.exe; skipped with `no duckdb binary` without it | pass |
| 9 | `bench/outcome/README.md`: Command (R8), Tables (the output rule, R11), Usage tables (R1 to R7), Cost views (R9) | reviewer-verified against the diff |
| 10 | the DoD: 19 tests, 19 passed with `DUCKDB_BIN`; 16 passed and 3 skipped without it. The ingest test differs from main by `--no-usage` in its two spawn helpers. The fixture of item 8 holds two logs matched by a Codex row (250 = 200 + 50 on the merged card, 330 = 300 + 30 on the superseded one) and one of 999 that matches none | pass |
| 11 | same test: the fixture rows carry `claude-opus-5-5` and `gpt-5.6-sol`; the `costUsd` of each of the eight row kinds is read from the `usage.jsonl` `run.ts` wrote, before any other step, and compared with the cost worked out in the comment above it; the three cost views are asserted from the same values. The test no longer rewrites `usage.jsonl` | pass |
| 12 | same file, test `acceptance 12` (runs without DuckDB) | pass |

Findings of R3 decision 2 and the test that proves each repair:
- `persisted-pricing-untested`: test `acceptance 8, 10 and 11` as item 11 states; mutant M11.
- `source-guard-aborts-export`: test `acceptance 12`. With a resolving function that throws EACCES for the Claude directory, `usage.jsonl` and `usage_errors.jsonl` (one row naming that directory) are written to a separate directory and an output directory inside the Claude directory is refused with nothing created. With one that throws for every path, the same two results hold. The ingest tests `acceptance 8` and `9` pass unchanged.

Mutants, one production expression changed at a time, `tests/surface/outcome-usage.test.ts` run with `DUCKDB_BIN`, the file written back after each:

| Mutant | Requirement | Change | Result |
|---|---|---|---|
| M1 | R1 | `cache_read_input_tokens` read from another key | killed by acceptance 1, 4, 8 |
| M2 | R1 | every line a row of its own (no pair key) | killed by 1, 4, 5 |
| M3 | R2 | `input - cached` to `input` | killed by 2, 8 |
| M4 | R3 | thousands separators kept | killed by 3 |
| M5 | R4 | no error row for a directory that cannot be listed | killed by 4, 12 |
| M6 | R4 | no `no token_count line` row | killed by 4, 5 |
| M7 | R5 | `attribute` returns every key of the row | killed by 6 |
| M8 | R6 | a span holds every `ts` after its start | survived without DuckDB (killed only by 8); case added (a session row inside one span after another ended); killed by 6 |
| M9 | R6 | the goal of the latest earlier run, not of the run whose window holds the `ts` | survived; case added (two runs of T1-W); killed by 6 |
| M10 | R7 | the 1-hour part not taken off the shorter tier | killed by 7, 8 |
| M11 | R8 | `costUsd` not set in `run.ts` | killed by 8 |
| M12 | R8 | the log directories not added to the read-only list | killed by 8 |
| M13 | R8 | `--no-usage` still runs `20-cost.sql` | killed by 8 |
| M14 | R9 | a matched log kept in `summary_superseded_spend` | killed by 8 |
| M15 | R9 | a matched log kept in `summary_cost_by_stage` | killed by 8 |
| M16 | R9 | the matching sum with `cacheReadTokens` added | killed by 8 |
| M17 | R11 | a resolve error other than ENOENT thrown; and, separately, a throw when no ancestor resolves | each killed by 12 |

R10 is prose (item 9). The same filter in `summary_cost_per_card` has no mutant that a test can kill: a reviewer-log row never has a cost.

Errors that reach disk, traced from each reader through `run.ts` to `writeTables`:
- Every kind of `usage_errors` row (`missing directory`, `unreadable`, `not JSON`, `usage line without message.id`, `no token_count line`) is returned by its reader, none of which throws (the sweep of attempt 3).
- The read-only list: `canonicalPath` no longer throws for any path, resolvable or not (`acceptance 12`, both resolvers). Found here and repaired: a path with no resolvable ancestor, such as a drive that is gone, still threw.
- `attribute` and `priceOf` read fields of rows only (`Date.parse`, `path.relative`, `Object.hasOwn`, arithmetic) and call no filesystem function.
- `prices.json`, the configuration and the git call that give the worktree root are read before or apart from the source directories, so they fail or succeed the same for any source input.
- `writeTables` then throws only for the output directory itself: inside a read-only directory, or not creatable.

Earlier repairs and decisions stand as the evidence of attempt 3 stated them: the six classes of decision 1 have their tests in `acceptance 1`, `2`, `3`, `4`, `6` and `7`; `usage.ts` has three filesystem calls, each inside a try; the only dedup key is the (`message.id`, `requestId`) map; rows are built from named fields. Without a fixture: a file over the string limit of Node (the real run has one) and a failing `statSync` of a source directory.

Real run on 2026-11-10 after this repair (`--state D:\Projects\AIDLC\.aidlc --cards D:\Projects\AIDLC\specs\tasks`, default Claude and Codex directories, `--out` outside the repository and every source), exit 0 in 11 s: usage 12201 rows (claude-code 11737, codex 324, review-log 140), usage_errors 1 (`unreadable: ERR_STRING_TOO_LONG`, a Codex file). List-price cost in USD by stage, merged cards: coordinate 202.37, implement 117.51, review 152.42, subagent 34.63; superseded cards: coordinate 72.62, implement 86.42, review 83.55, subagent 20.95. `summary_superseded_spend`: 33 cards, 2050 requests, 447305397 tokens, 263.54 USD, 15 unpriced requests. `summary_cost_per_card`: 91 families, 90 priced, p50 4.93, p90 21.53, max 71.54 USD. `summary_unattributed`: 6122 rows, 50.2% of rows and 55.6% of tokens; `review_log_same_as_codex` 125 rows, 8683264 tokens. Against the run of attempt 3, `summary_cost_by_stage` and `summary_superseded_spend` are equal to six decimals; p90 moved from 20.73 to 21.53 because this card's own family grew from 18.15 to 26.62 USD with the sessions of this attempt. `usage.jsonl` holds the 21 columns of `USAGE_COLUMNS`; its longest string is a 68-character `cwd`.
