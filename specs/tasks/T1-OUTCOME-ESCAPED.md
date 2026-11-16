---
id: T1-OUTCOME-ESCAPED
title: The outcome cards table gains the column diagnosis, bench/outcome/views/30-github.sql gains summary_escaped (per UTC week the merged cards, the merged cards with a diagnosis block and the reverts), and bench/outcome/escaped.json holds its rows from one run; summary.json is not regenerated
status: todo
branch: T1-OUTCOME-ESCAPED
worktree: D:\wt\AIDLC\T1-OUTCOME-ESCAPED
plan_ref: plans/execution-gate.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - bench/outcome/ingest.ts
  - bench/outcome/views/10-cards.sql
  - bench/outcome/views/30-github.sql
  - bench/outcome/README.md
  - bench/outcome/escaped.json
  - tests/surface/outcome-ingest.test.ts
  - tests/surface/outcome-github.test.ts
  - specs/tasks/T1-OUTCOME-ESCAPED.md
dod_command: npm run typecheck && node --test tests/surface/outcome-ingest.test.ts tests/surface/outcome-github.test.ts tests/surface/outcome-summary.test.ts tests/surface/outcome-baseline.test.ts tests/surface/outcome-first-decision.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-labels.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. `ingestState` (bench/outcome/ingest.ts) shall give every `cards` row the boolean `diagnosis`, true when `parseCardText` gives the card a `diagnosis` (a `diagnosis` block with a non-empty `root_cause`, src/artifacts/card.ts:141-142) and false otherwise, as the last column of `COLUMNS.cards` and of the `cards` view of bench/outcome/views/10-cards.sql.
  - R2. bench/outcome/views/30-github.sql shall define, after `summary_reconcile`, the view `summary_escaped` with one row per week that holds a merged card or a revert, ordered by `week`, with the columns `week` (the date `YYYY-MM-DD` of the Monday of that week in UTC), `merged_cards` (the rows of `card_merge` whose `mergedAt` falls in the week), `bugfix_cards` (those of them whose card has `diagnosis` true in `cards`; a card the registry does not hold counts as false) and `reverts` (the rows of `reverts` whose `date` falls in the week), each count an integer, 0 when the week has none.
  - R3. The week of a time shall be computed from its UTC date, whatever time zone the DuckDB session runs in, with Monday as the first day.
  - R4. bench/outcome/escaped.json shall hold `{ commit, ranAt, rows }` in the layout of Acceptance detail 3, where `commit` and `ranAt` are those of the `--summary` file of one `node bench/outcome/run.ts --no-usage --summary <scratch file> --out <scratch directory>` run from the card worktree at the candidate, and `rows` are its `views.summary_escaped`, unchanged.
  - R5. bench/outcome/summary.json shall stay byte-identical.
  - R6. bench/outcome/README.md shall state the column (the `cards` row of the table under Tables), the view (a bullet after `summary_reconcile` under Views of `views/30-github.sql`), what `escaped.json` is and that `summary.json` predates the view, and the two tests (under Tests).
acceptance:
  - 1. tests/surface/outcome-ingest.test.ts - the fixture card `T1-STOPPED` (:39) gains a `diagnosis` block with a `root_cause`, and the expected rows of :65-66, the expected bytes of `cards.jsonl` at :132 and the `cardRow` helper of :253 carry `diagnosis` (false for `T1-MERGED`, true for `T1-STOPPED`, false in `cardRow`), as the last key. The tests that hold those lines fail on main by assertion (no `diagnosis` key) and pass with this card; no other line of the file changes. [R1] [dod arm 2]
  - 2. tests/surface/outcome-github.test.ts, new test "T1-OUTCOME-ESCAPED acceptance 2 - summary_escaped counts per UTC week the merged cards, the cards among them with a diagnosis and the reverts", skipped with `no duckdb binary` as the file's view tests are. Hand-written rows (Acceptance detail 1) written with `writeTables`, the view files 10-cards.sql and 30-github.sql run through the DuckDB binary in that directory; the rows of `summary_escaped` deep-equal the rows of detail 1. Fails on main (no such view). [R2] [R3] [dod arm 2]
  - 3. Same file - `GITHUB_VIEWS` (:532) gains `summary_escaped`, so "T1-OUTCOME-GITHUB-2 acceptance 12" expects it among the views of a run without `--no-github` and still expects the four card views alone with `--no-github`. With the view and without this line that test fails; with both it passes. [R2] [dod arm 2]
  - 4. Same file, new test "T1-OUTCOME-ESCAPED acceptance 4 - bench/outcome/escaped.json has the commit, the run time and the rows of summary_escaped in the stated layout", not skipped. The checks of Acceptance detail 3. Fails on main (no file). [R4] [dod arm 2]
  - 5. tests/surface/outcome-summary.test.ts (its acceptance 1 pins the 13 view names of bench/outcome/summary.json at :73-76, its acceptance 2 the four views of a `--no-usage --no-github` run at :102) and tests/surface/outcome-baseline.test.ts (every table value of docs/reliability/baseline.md against summary.json, :132) pass unchanged, and `git diff --stat` against the base lists no change to bench/outcome/summary.json or docs/reliability/baseline.md. [R5] [dod arm 2]
  - 6. tests/surface/outcome-first-decision.test.ts, outcome-usage.test.ts and outcome-labels.test.ts, which write or read `cards` rows without the new key, and tests/surface/prose.test.ts pass unchanged. [R1] [dod arm 2]
  - 7. bench/outcome/README.md carries the four statements of R6 (reviewer-verified against the diff). [R6]
  - 8. The Attempt evidence section of this card file holds the command line of the run of R4, its exit code, the stderr line of row counts, and the stdout line of `summary_escaped` (reviewer-verified against the diff). [R4]
depends_on: []
budget: 170
tdd: true
sweep: "Main at 35de54fe. The ingest holds no bugfix marker today - `COLUMNS.cards` is `id, status, superseded_by, depends_on, tdd, budget` (bench/outcome/ingest.ts:10, written at :69) and there is no goals table, so the routing size `T0-bugfix` is not in any table; `parseCardText` already reads the `diagnosis` block (src/artifacts/card.ts:141-142), and 165 of the 348 cards of the registry carry one, so the column is the smaller change. `git grep -n superseded_by -- tests/surface` and `git grep -n 'COLUMNS' -- tests` - the `cards` rows are pinned at tests/surface/outcome-ingest.test.ts:65-66 (deep-equal rows), :132 (the bytes of cards.jsonl) and :253 (`cardRow`); outcome-labels.test.ts:22 hands hand-written card objects to a function and reads no column list; outcome-summary.test.ts:71 pins the table names, not their columns. The views read each table with an explicit column map (10-cards.sql:3), so a fixture without the key reads it as null. View names - run.ts prints every view named `summary_*` (:87-93) and leaves out only `30-github.sql` under `--no-github` (:19, :78); a new file `40-escaped.sql` that reads `reverts` and `card_merge` would run under `--no-github`, where those tables are not written, so the view goes at the end of 30-github.sql and run.ts does not change. `git grep -n GITHUB_VIEWS -- tests` - outcome-github.test.ts:532 lists the four GitHub view names and :541 and :555 deep-equal the printed names (DuckDB only). bench/outcome/summary.json is pinned by outcome-summary.test.ts:73-76 (exactly 13 view names) and is the source of every `summary.json` row of docs/reliability/baseline.md, which outcome-baseline.test.ts:132-150 recomputes together with its commit and date; a regenerated summary.json would move those numbers, so the rows of the new view go to a file of their own. `reverts.date` is `new Date(time).toISOString()` (github.ts:167) and `prs.mergedAt` is GitHub's ISO time, both UTC. `summary_successor_rate` fails on a division of 0 by 0 (outcome-summary.test.ts:109), so the new view holds counts only. DuckDB v1.5.6 is on this machine; CI has none, and the view tests are skipped there (README.md, Tests)."
forbid:
  - regenerating or editing bench/outcome/summary.json, or a change to docs/reliability/baseline.md
  - a change to bench/outcome/run.ts, github.ts or usage.ts, or a new file under bench/outcome/views
  - a ratio, a share or any division in `summary_escaped`
  - a week computed in the session time zone (`date_trunc` on a `TIMESTAMPTZ`), or a week that starts on Sunday
  - editing a row of bench/outcome/escaped.json after the run, or rows taken from a run made before the candidate's view text was final
  - changing an assertion of the two test files other than the lines acceptance 1 and 3 name
  - a change to the R3 policy, REVIEW.md, the review allowances or the card state precedence in src/core/card-machine.ts
non_goals:
  - identifying a bugfix by the goal's routing size `T0-bugfix`; the ingest reads no goal record, and a goals table is a later card
  - an escaped-defect rate per merged card; the view gives the three counts per week, and a reader divides them
  - a revert made without a `This reverts commit` line, which the `reverts` table does not hold (README.md, GitHub tables, Not detected)
  - attributing a bugfix card or a revert to the card whose defect it repairs
  - the view in bench/outcome/summary.json; the next run that regenerates that file will hold it, and the card that does so updates the pinned list of outcome-summary.test.ts:73-76 and baseline.md
  - a CHANGELOG.md entry; bench/outcome is a dev-only measurement whose table and view names may change with the scripts (README.md:3), and no behaviour of the loop changes
  - a card whose file `parseCardText` rejects; it has no `cards` row (one `ingest_errors` row, as today), so it counts as no bugfix
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. The run of R4 needs the DuckDB binary and `gh` on the worker's machine and reads GitHub (read-only calls, bench/outcome/README.md, GitHub tables); it is made once, after the view text is final, with `--out` and `--summary` under a scratch directory outside the worktree, and takes several minutes (one `gh api` call per merged pull request commit). If DuckDB or `gh` is not available, stop and ask; do not write the rows by hand. The scratch summary file is not committed. Revert table before the first review, each a scratch change restored afterwards - the week taken from a `TIMESTAMPTZ` in a session zone east of UTC (2 red on the Sunday row); `bugfix_cards` counted without the `diagnosis` filter (2 red); the `reverts` side dropped (2 red on the week with a revert alone); the `diagnosis` column dropped from 10-cards.sql (2 red)."
---

# T1-OUTCOME-ESCAPED

## Deliverable
A view that counts, per week of merge, the merged cards, the merged bugfix cards and the reverts, the one table column it needs, and a committed file with its rows from one run on the main checkout's records.

## Why
Intent `intent/execution-gate.md`, proposed outcome 4: no outcome view counts defects that reached main, so a gate change that raises a pass rate cannot be told from one that lets more defects through. The counts before the gate change have to exist first (plan `plans/execution-gate.md`, Order of work, item 1). A bugfix card is a card with a `diagnosis` block (`specs/tasks/_TEMPLATE.md`: bugfix cards only); 165 of the 348 cards carry one.

Two differences from the plan, both from the code. The plan names a new file `bench/outcome/views/40-escaped.sql`; `run.ts` leaves out only `30-github.sql` under `--no-github`, so the view stands at the end of that file. The spec's acceptance 9 has the view in a regenerated `summary.json`; that file is the pinned source of `docs/reliability/baseline.md`, so its rows go to `bench/outcome/escaped.json` and `summary.json` stays as it is.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-ingest.test.ts tests/surface/outcome-github.test.ts tests/surface/outcome-summary.test.ts tests/surface/outcome-baseline.test.ts tests/surface/outcome-first-decision.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-labels.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every test passes, the DuckDB view tests included where the binary is found (`DUCKDB_BIN`, else `duckdb` on PATH).

## Acceptance detail

### 1. The rows of acceptance 2
Tables written with `writeTables` (every other table of the three column maps as an empty array):

- `cards`: `T1-A` (`diagnosis` false), `T0-B` (`diagnosis` true), `T0-C` (`diagnosis` true), `T1-D` (`diagnosis` false). `T1-E` has a run and no `cards` row.
- `card_runs`: one run per card `T1-A`, `T0-B`, `T0-C`, `T1-D`, `T1-E`, each with `prNumber` 1 to 5 in that order.
- `prs`: number 1 `mergedAt` `2026-01-04T23:59:59Z`; number 2 `mergedAt` `2026-01-05T00:00:00Z`; number 3 `mergedAt` `2026-01-07T12:00:00Z`; number 4 `mergedAt` null (open); number 5 `mergedAt` `2026-01-11T23:59:59Z`. Each has `headRef` its card id and a 40-hex `mergeCommitSha`.
- `reverts`: one row with `date` `2026-01-06T00:00:00.000Z`, one with `date` `2026-01-20T10:00:00.000Z`.

Expected rows of `summary_escaped`, in this order:

| week | merged_cards | bugfix_cards | reverts |
|---|---|---|---|
| `2025-12-29` | 1 | 0 | 0 |
| `2026-01-05` | 3 | 2 | 1 |
| `2026-01-19` | 0 | 0 | 1 |

2026-01-04 is a Sunday and 2026-01-05 a Monday, so pull request 1 is alone in the week of 2025-12-29; `T1-E`, merged on Sunday 2026-01-11, is in the week of 2026-01-05 and is no bugfix; the open pull request 4 counts nowhere; the week of 2026-01-12 has neither and has no row.

### 2. The run of R4
From the card worktree, at the candidate commit:

```powershell
node bench/outcome/run.ts --no-usage --summary <scratch>\summary.json --out <scratch>\out
```

It exits 0 and prints the line `{"view":"summary_escaped","rows":[...]}` on stdout. The state directory, the registry and GitHub are those of the main checkout (bench/outcome/README.md, Command).

### 3. bench/outcome/escaped.json and its test
Layout: line 1 `{`; line 2 `  "commit": "<40 hex>",`; line 3 `  "ranAt": "<ISO 8601 UTC with milliseconds>",`; line 4 `  "rows": [`; then one row per line, each `    {"week":"YYYY-MM-DD","merged_cards":n,"bugfix_cards":n,"reverts":n}` with a comma after every row but the last; then `  ]` and `}` and one line feed at the end.

The test of acceptance 4 parses the file and checks: the keys are `commit`, `ranAt`, `rows` in that order; `commit` is 40 lower-case hex; `ranAt` equals `new Date(ranAt).toISOString()`; `rows` has at least one row; every row has exactly the keys `week`, `merged_cards`, `bugfix_cards`, `reverts` in that order; `week` matches `YYYY-MM-DD` and `new Date(week + 'T00:00:00Z').getUTCDay()` is 1; the weeks are strictly ascending; the three counts are integers of 0 or more; `bugfix_cards` is at most `merged_cards`; no row has `merged_cards` 0 and `reverts` 0; and every line between line 4 and the closing `  ]` holds one row.
