# bench/outcome: outcome tables and views

Dev-only measurement scripts (plan `plans/reliability-baseline.md`). They read the state directory and the card registry and write only under `--out`. Table and view names may change with the scripts.

## Command

```bash
node bench/outcome/run.ts [--state <dir>] [--cards <dir>] [--out <dir>] [--duckdb <path>]
```

- `--state`: the state directory. Default: the one aidlc resolves for the checkout (`AIDLC_STATE_DIR`, else `<main checkout>/.aidlc`).
- `--cards`: the card registry. Default: the configured `cardsDir` under the main checkout.
- `--out`: where the tables are written. Default: `_local/outcome` under the main checkout. A path inside the state directory or the registry is refused (exit 1); the check compares canonical paths where the path exists and resolved paths where not.
- `--duckdb`: the DuckDB binary. Default: `duckdb` on PATH.

The run writes `<table>.jsonl` per table, prints the row counts on stderr, runs every `bench/outcome/views/*.sql` in name order through the DuckDB binary with `--out` as its working directory (an in-memory database, so nothing else is written), and prints each view named `summary_*` on stdout as one line `{"view": "<name>", "rows": [...]}`, in name order. Exit codes: 0; 1 when an argument, a read or a view fails; 2 when the DuckDB binary cannot be started, after the tables are written. The message of exit 2 names `winget install DuckDB.cli`.

## Tables (`ingest.ts`)

`ingestState({ stateDir, cardsDir })` returns the tables as arrays of plain rows and reads files only. A field the record does not carry is null. `writeTables(tables, outDir)` writes the keys in the column order below and sorts the lines by UTF-16 code unit, so the same rows given in any order write the same bytes; an empty table writes an empty file.

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
- `card_family`: each card (`id`) with the last card of its `superseded_by` chain (`last_card`, itself when it has none) and the `steps` to it. A name the registry does not hold ends the chain; 50 steps end a chain that loops.
- `summary_successor_rate`: `card_attempts`, `failed`, `merged` (row counts of `card_attempts`) and `successor_rate` = `failed` / `card_attempts`.
- `summary_review_convergence`: over cards with at least one formal entry whose outcome is `pass` or `block` (`cards`): `first_decision_pass_share`, the share with a `pass` and no merge-blocking `block`; `two_or_more_blocks_share`, the share with two or more merge-blocking blocks; `mean_decisions_to_pass`, the mean of merge-blocking blocks plus one among cards with a `pass`; `stop_review_share`, the share of cards with a formal entry carrying `stopReview`. A `block` with `mergeBlocking` absent counts as merge-blocking. Entries are counted per card over all of its runs.
- `summary_lead_time`: rows `lead_p50` and `lead_p90`, the hours from `startedAt` to the start of the first `CLOSE` or `DONE` span for runs with `mergeVerified` (`n` runs that have such a span); and one row `state_total` per `state`, the total hours over all spans with an `endTs` (`n` spans).
- `summary_stop_reasons`: `stopReason` and `runs`, the card runs that carry a stop record, per reason.

## Tests

`tests/surface/outcome-ingest.test.ts` covers the tables, the writer and the exit 2 path everywhere. The view tests are skipped with the reason `no duckdb binary` where no DuckDB binary is found (`DUCKDB_BIN`, else `duckdb` on PATH), which includes CI; run them locally with `DUCKDB_BIN` set.
