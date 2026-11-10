---
id: T1-OUTCOME-INGEST
title: "`node bench/outcome/run.ts` writes the card, card-run, review, finding, state-span and attempt tables from the state directory and the registry as JSONL and runs the card and review views through the DuckDB CLI"
status: todo
branch: T1-OUTCOME-INGEST
worktree: D:\wt\AIDLC\T1-OUTCOME-INGEST
plan_ref: plans/reliability-baseline.md#order-of-work
allow_paths:
  - bench/outcome/ingest.ts
  - bench/outcome/run.ts
  - bench/outcome/views/10-cards.sql
  - bench/outcome/README.md
  - tests/surface/outcome-ingest.test.ts
  - specs/tasks/T1-OUTCOME-INGEST.md
dod_command: npm run typecheck && node --test tests/surface/outcome-ingest.test.ts
dod_exit: 0
requirements:
  - R1. `ingestState({ stateDir, cardsDir })` in `bench/outcome/ingest.ts` shall return the tables `cards`, `card_runs`, `review_decisions`, `findings`, `state_spans`, `attempts` and `ingest_errors` as arrays of plain rows, reading files only.
  - R2. The `cards` table shall hold one row per card file that `parseCardText` accepts (files starting with `_` left out), with `id`, `status`, `superseded_by`, `depends_on`, `tdd` and `budget`.
  - R3. The `card_runs` table shall hold one row per persisted card run that parses under `CardRun`, with `goalId`, `cardId`, `startedAt`, `state`, `mergeVerified`, `prNumber`, `stopReason`, `stopDetail`, `substantiveDecisions`, `substantiveBlocks` and `updatedAt`.
  - R4. The `review_decisions` table shall hold one row per `review.invocations` entry (`stage` `formal`) and per `preReview.rounds` entry (`stage` `pre`) with `goalId`, `cardId`, `stage`, `outcome`, `mergeBlocking`, `reviewer`, `requestedAt`, `candidateSha`, `secondPass`, `baseSync`, `stopReview` (true when the entry carries one), `decision`, `round`, `cycle`, and `angles` (the `{ angle, outcome }` of each perspective of a pre round, else an empty array).
  - R5. The `findings` table shall hold one row per `findings` entry with `goalId`, `cardId`, `id`, `stage`, `round`, `cycle`, `perspective`, `file`, `class`, `candidateSha`, `raisedAt`, `disposition`, `disputes` (count), `reraises` (count), `resolvedAt`, `advisory`, `outsideDelta` and `reason`.
  - R6. The `state_spans` table shall hold one row per `CARD_STATE` journal event with `goalId`, `cardId`, `state` (its `to`), `startTs` and `endTs` (the timestamp of the next `CARD_STATE` of that goal and card, null for the last), and the `attempts` table one row per `ATTEMPT_FINISHED` event with `goalId`, `cardId`, `outcome`, `endTs` and `startTs` (the nearest earlier `ATTEMPT_STARTED` of that goal and card, null when there is none).
  - R7. A card file `parseCardText` rejects, a card-run file that is not JSON or fails `CardRun`, and a journal line that is not JSON shall each become one `ingest_errors` row with `source`, `path`, `line` (journal only) and `problem`, with every other row still returned.
  - R8. `writeTables(tables, outDir)` shall write `<table>.jsonl` per table with rows in a fixed sort order and keys in a fixed order, so the same rows given in any order write the same bytes, and an empty table writes an empty file.
  - R9. `node bench/outcome/run.ts [--state <dir>] [--cards <dir>] [--out <dir>] [--duckdb <path>]` shall default to the state directory aidlc resolves for the checkout, the configured `cardsDir` and `_local/outcome`, write the tables, run every `bench/outcome/views/*.sql` in name order through the DuckDB binary (`--duckdb`, else `duckdb` on PATH) with the output directory as its working directory, print each view named `summary_*` as JSON, and exit 2 with a message naming `winget install DuckDB.cli` when the binary cannot be started, after the tables are written.
  - R10. `views/10-cards.sql` shall define `card_attempts` (one row per card with at least one run; `merged` when a run has `mergeVerified`; `failed` when `superseded_by` is set), `card_family` (each card with the last card of its `superseded_by` chain), `summary_successor_rate`, `summary_review_convergence`, `summary_lead_time` and `summary_stop_reasons`.
  - R11. `summary_review_convergence` shall report, over cards with at least one formal entry whose outcome is `pass` or `block`, the share with a `pass` and no merge-blocking `block` (first-decision pass), the share with two or more merge-blocking blocks, the mean of merge-blocking blocks plus one among cards with a `pass`, and the share of cards with an entry carrying `stopReview`; a `block` with `mergeBlocking` absent counts as merge-blocking.
  - R12. `summary_lead_time` shall report the p50 and p90 hours from `startedAt` to the start of the first `CLOSE` or `DONE` span for runs with `mergeVerified`, and the total hours per state over all spans with an `endTs`.
  - R13. `bench/outcome/README.md` shall state the command, each table with its columns, each view with its definition, and that the view tests are skipped where no DuckDB binary is found.
acceptance:
  - 1. `tests/surface/outcome-ingest.test.ts`: over a temporary state directory and registry holding a merged run (one formal pass), a stopped run (two merge-blocking formal blocks, the second with `stopReview`, three findings of which one disputed and one re-raised) and a run with one pre round of three angles, `ingestState` returns the rows of R2 to R6, asserted field by field. [R1] [R2] [R3] [R4] [R5] [R6] [dod arm 2]
  - 2. Same file: a card file with no `id`, a card-run file holding `{`, a card-run file holding `{}` and a journal file whose second line is `not json` give four `ingest_errors` rows naming each path (and line 2), and the valid rows of the same directories are still returned. [R7] [dod arm 2]
  - 3. Same file: `writeTables` writes identical bytes for the same rows in reversed order, and a zero-byte file for an empty table. [R8] [dod arm 2]
  - 4. Same file: `run.ts --duckdb <missing path>` exits 2, its stderr names `winget install DuckDB.cli`, and `cards.jsonl` exists under `--out`. [R9] [dod arm 2]
  - 5. Same file, when a DuckDB binary is found (`DUCKDB_BIN`, else `duckdb` on PATH), else skipped with the reason `no duckdb binary`: `run.ts` over the fixture of item 1, with the stopped card superseded by the merged one, prints a successor rate of 1 of 2, a first-decision pass share of 0.5, a two-or-more-blocks share of 0.5, a mean of 1 decision among passed cards, a `stopReview` share of 0.5, and the lead time the fixture timestamps give. [R9] [R10] [R11] [R12] [dod arm 2]
  - 6. The README states R1 to R12 (reviewer-verified against the diff). [R13]
depends_on: []
budget: 450
sweep: "New files only: `git ls-files bench/outcome` is empty on main at 8156bf5. Readers reused, not copied: `parseCardText` (src/artifacts/card.ts:83), the `CardRun` schema (src/core/types.ts:847), the state-directory resolution the CLI uses. `tsconfig.test.json` already includes `bench/**/*.ts`, so the typecheck covers the new files."
forbid: [any change under src/ templates/ or .claude/, a write under the state directory or the registry, a dependency added to package.json, a network call]
non_goals: [usage and cost (T1-OUTCOME-USAGE), GitHub data (T1-OUTCOME-GITHUB), git history (T1-OUTCOME-HISTORY), migrating a card run written by an older version (it parses through the schema defaults or becomes an error row), journal event types other than CARD_STATE ATTEMPT_STARTED and ATTEMPT_FINISHED (ignored)]
hygiene: "The view test is skipped in CI, which has no DuckDB. Run it once locally with `DUCKDB_BIN` set and paste the output in the attempt evidence."
doc_sync: bench/outcome/README.md
---

# T1-OUTCOME-INGEST

## Deliverable
The state and registry tables as JSONL, the runner, and the card and review views. No usage, GitHub or git data yet.

## Why
82 of 263 cards carry `superseded_by` and nothing reports the rate, the review decisions behind it or the time spent per state. The persisted card runs already hold every decision and finding (`aidlc review stats` reads them); this card puts them in tables that SQL can join with the later sources.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-ingest.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; item 5 is skipped only where no DuckDB binary is found.
