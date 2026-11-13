---
id: T1-OUTCOME-FIRST-DECISION
title: summary_review_convergence counts a card's first formal decision and its decisions to a pass in date order, leaving out second passes and base-sync decisions, so neither column counts those blocks as first-decision blocks any more
status: todo
branch: T1-OUTCOME-FIRST-DECISION
worktree: D:\wt\AIDLC\T1-OUTCOME-FIRST-DECISION
plan_ref: plans/reliability-baseline-2.md#order-of-work
allow_paths:
  - bench/outcome/views/10-cards.sql
  - bench/outcome/README.md
  - tests/surface/outcome-first-decision.test.ts
  - tests/surface/outcome-ingest.test.ts
dod_command: npm run typecheck && node --test tests/surface/outcome-first-decision.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-github.test.ts
dod_exit: 0
requirements:
  - R1. In `bench/outcome/views/10-cards.sql`, `summary_review_convergence` shall call a decision every row of `review_decisions` with `stage` `formal` and `outcome` `pass` or `block` that is not a second pass (`secondPass` true) and not a base-sync decision (`baseSync` true); an absent `secondPass` or `baseSync` reads as false. A pass by ruling (reviewer `ruling:<by>`) is a decision, and so is a block whose `mergeBlocking` is false or absent. A row with another outcome (`no-verdict`, `quota-hold`, `pending`) and a pre-review row are not decisions.
  - R2. The decisions of a card, over all of its runs, shall be ordered by `requestedAt` read as a timestamp (`requestedAt::TIMESTAMPTZ`, so `2026-01-05T00:00:00Z` comes before `2026-01-05T00:00:00.5Z`, which a text comparison reverses), then by `decision` with an absent number last, then by `goalId`, then by `outcome`.
  - R3. `first_decision_pass_share` shall be the share of the cards counted in `cards` whose first decision in that order is a `pass`; a card counted in `cards` that has no decision counts as not passing. `mean_decisions_to_pass` shall be the mean, over the cards counted in `cards` that have a `pass` among their decisions, of the place of the first such `pass` in that order (1 when the first decision passes), and null when no card has one.
  - R4. `cards`, `two_or_more_blocks_share` and `stop_review_share` shall give what they give on main at e6566c68 (`cards`, the cards with at least one formal row whose outcome is `pass` or `block`; the other two count every merge-blocking block and every `stopReview` of those rows, second passes and base-sync decisions included), and the view keeps its five columns in their order. No other view and no table changes.
  - R5. The expected row of the test "T1-OUTCOME-INGEST acceptance 5" in `tests/surface/outcome-ingest.test.ts` (:161 at e6566c68) shall change in two values and in nothing else: `first_decision_pass_share` 0 (was 0.5) and `mean_decisions_to_pass` null (was 1). Its fixture card T1-MERGED has only a second-pass `pass`, so it has no decision, and the first decision of T1-STOPPED blocks.
  - R6. `bench/outcome/README.md` shall describe `summary_review_convergence` by R1 to R4 in place of its bullet (:58 at e6566c68), and its Tests section shall name `tests/surface/outcome-first-decision.test.ts` and its skip rule.
  - R7. On the state of the main checkout, the corrected view shall give the same cards, first-decision passes and decisions up to the first pass as the independent query of body section Acceptance detail, item 3.
acceptance:
  - 1. `tests/surface/outcome-first-decision.test.ts` "T1-OUTCOME-FIRST-DECISION acceptance 1: summary_review_convergence gives each fixture card alone its row by date order": ten rows, each card's entries alone through the view. Fails on main by assertion (six rows differ: T1-SECOND, T1-SECOND-ONLY, T1-SYNC, T1-SYNC-PASS, T1-ADVISORY, T1-TIE). Skipped with the reason `no duckdb binary` where no DuckDB binary is found. [R1] [R2] [R3] [R4] [dod arm 1] Detail in the body section Acceptance detail, item 1.
  - 2. Same file, "T1-OUTCOME-FIRST-DECISION acceptance 2: summary_review_convergence over the ten fixture cards together". Fails on main by assertion (main gives 0.3 and 2). Skipped in the same way. [R3] [R4] [dod arm 1] Detail item 2.
  - 3. `tests/surface/outcome-ingest.test.ts` "T1-OUTCOME-INGEST acceptance 5" passes with the row of R5; with that row and the view of main it fails by assertion, and with the new view and the row of main it fails by assertion. [R5] [dod arm 1]
  - 4. tests/surface/outcome-usage.test.ts and tests/surface/outcome-github.test.ts pass unchanged, with and without a DuckDB binary. They pass on main and with this card. [R4] [dod arm 1]
  - 5. The README bullet and the Tests sentence state R1 to R4 and the skip rule (reviewer-verified against the diff). [R6]
  - 6. The view and the independent query, run on the main checkout's state, print the same numbers; both outputs and the commit are recorded in the attempt evidence (reviewer-verified from the receipt). [R7] Detail item 3.
depends_on: []
budget: 180
tdd: true
sweep: "On main at e6566c68. `git grep -n \"first_decision_pass_share\\|mean_decisions_to_pass\\|summary_review_convergence\" -- bench tests docs README.md`: bench/outcome/views/10-cards.sql:36-48 (the view; the two columns at :44 and :46), bench/outcome/README.md:58, tests/surface/outcome-ingest.test.ts:159 and :161 (only :161 pins values), tests/surface/outcome-github.test.ts:481 and :531 and tests/surface/outcome-usage.test.ts:319 (view names only, unchanged). No file under docs/ names the view. `review_decisions` carries `secondPass`, `baseSync`, `decision` and `requestedAt` from `ReviewInvocation` (src/core/types.ts:309-349; `requestedAt` is `IsoTimestamp`, :18-20, always UTC with an optional fraction of one to three digits). On the panel's snapshot of 2026-11-14 (state at d4c878fc): formal rows 699, of which 8 second-pass blocks, 66 second-pass passes, 5 base-sync blocks, 11 base-sync passes, 1 pass by ruling, 3 no-verdict, 12 quota-hold; no block has `mergeBlocking` false; no two decisions of a card share a `requestedAt`."
forbid:
  - weakening, skipping or deleting a test to go green
  - a change to tests/surface/outcome-ingest.test.ts other than the two values of R5
  - a change to a view other than `summary_review_convergence`, to its columns `cards`, `two_or_more_blocks_share` or `stop_review_share`, or to the column list of a table view
  - a change to bench/outcome/ingest.ts, bench/outcome/run.ts or any other script
  - a change under src, templates or .claude, to REVIEW.md or package.json, or to CHANGELOG.md, docs/OPERATIONS.md or docs/ARCHITECTURE.md
  - a new dependency, or reading the real state directory from a test
non_goals:
  - a per-run first decision (the intent's 161 of 292 runs is a per-run figure); the view stays per card over all of its runs
  - counting second-pass and base-sync blocks out of `two_or_more_blocks_share`, which keeps its definition
  - a `requestedAt` that is not an ISO timestamp, which `CardRun` refuses at ingest (an `ingest_errors` row), so the view never reads one
  - DuckDB on CI, where every view test skips by name as before
  - the CHANGELOG entry, which T1-OUTCOME-REPORT writes for the whole goal
hygiene: "Line numbers are from main at e6566c68; find each place by its content. A DuckDB binary must be found (`DUCKDB_BIN`, else `duckdb` on PATH) when RED and the DoD are recorded; record `duckdb --version`, and a receipt in which a test of acceptance 1 or 2 was skipped is not evidence. Tests first, in two commits. Commit 1 holds tests/surface/outcome-first-decision.test.ts whole and the two values of R5, with the view and the README unchanged, and records acceptance 1 (the six rows), 2 and 3 failing by assertion. Commit 2 changes the view and the README. The new test builds its rows with a helper in the style of `decision` (tests/surface/outcome-ingest.test.ts:58), writes them with `writeTables` into a directory from `tmpDir` (tests/infra/helpers.ts) removed with `cleanup` in an `after` hook, and runs the view file through the DuckDB binary as acceptance 11 of that file does (:251-268): `-json -bail`, the SQL text on standard input, the temporary directory as working directory. Revert table before the first review, each row a scratch change restored afterwards: `requestedAt` compared as text (fails T1-MS); second passes kept (fails T1-SECOND-ONLY); base-sync decisions kept (fails T1-SYNC-PASS); every outcome kept (fails T1-RETRY); pre-review rows kept (fails T1-RETRY); the pass by ruling left out (fails T1-RULED); a block with `mergeBlocking` false left out (fails T1-ADVISORY); the tie on `decision` dropped (fails T1-TIE); `goalId` ordered before the time (fails T1-RUNS); the old two columns restored (fails acceptance 1 and 2). Each of these was run on a scratch copy of the fixture by the drafter on 2026-11-14 and failed the named row."
doc_sync: bench/outcome/README.md
---

# T1-OUTCOME-FIRST-DECISION

## Deliverable
`summary_review_convergence` reports the first-decision pass share and the mean decisions to a pass from a card's decisions in date order, with second passes and base-sync decisions left out. On the panel's snapshot of 2026-11-14 that is 133 of 299 cards and 1.54 decisions, where the view gave 128 and 1.625. The other three columns do not change.

## Why
Both panelists confirmed the defect (`_local/panel/claude-r2.md` D4, `_local/panel/codex-r1.md` "Additional measurement defect"). At e6566c68 the view computes `avg((passed AND blocks = 0)::INT)` (:44) and `avg(blocks + 1) FILTER (WHERE passed)` (:46), where `blocks` counts every merge-blocking block of the card, second-pass and base-sync blocks included. A card whose first decision passed and whose second pass then blocked counts as a first-decision failure; 5 such cards are on the snapshot. Run by the drafter on the state at e6566c68, the view gives 129 of 300 and 1.622, and the corrected view and the independent query both give 134 of 300 and 346 decisions over 225 cards (1.538). The pass by ruling counts as a decision, as the view counts it today; the spec's 1.54 includes it (1 card; without it the snapshot gives 1.529). The snapshot and the report of this goal read this view, so it is corrected first.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-first-decision.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-github.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes, with no test skipped on the machine that records the receipt.

## Acceptance detail

### 1
Every entry is a `review_decisions` row with `stage` `formal`, `reviewer` `codex`, `mergeBlocking` true on a block and false on a pass, `stopReview` false, `angles` an empty array, and null `candidateSha`, `secondPass`, `baseSync`, `decision`, `round` and `cycle`, unless the table says otherwise. `d<n>` is `decision` n. Each row of the table is the expected output, `{ cards: 1, first_decision_pass_share, two_or_more_blocks_share, mean_decisions_to_pass, stop_review_share }`, of the view over that card's entries alone; the other tables are empty.

| Card | Entries (goal, outcome, requestedAt, other fields) | first | two+ | mean | stop |
|---|---|---|---|---|---|
| T1-SECOND | g-s pass `2026-01-01T01:00:00Z` d1; g-s block `2026-01-01T02:00:00Z` d2 `secondPass` true; g-s pass `2026-01-01T02:30:00Z` d3 | 1 | 0 | 1 | 0 |
| T1-SECOND-ONLY | g-o pass `2026-01-08T00:00:00Z` d1 `secondPass` true | 0 | 0 | null | 0 |
| T1-SYNC | g-s pass `2026-01-01T03:00:00Z` d1; g-s block `2026-01-01T04:00:00Z` d2 `baseSync` true; g-s pass `2026-01-01T05:00:00Z` d3 `baseSync` true | 1 | 0 | 1 | 0 |
| T1-SYNC-PASS | g-y block `2026-01-08T01:00:00Z` d1; g-y pass `2026-01-08T02:00:00Z` d2 `baseSync` true | 0 | 0 | null | 0 |
| T1-RUNS | g-b block `2026-01-02T00:00:00Z` d1 `mergeBlocking` null; g-b block `2026-01-02T01:00:00Z` d2 `stopReview` true; g-a pass `2026-01-03T00:00:00Z` d1 | 0 | 1 | 3 | 1 |
| T1-RETRY | g-r pre-review row: `stage` `pre`, block, `2026-01-03T23:00:00Z`, `reviewer` `deepseek`, `mergeBlocking` null, `round` 1, `cycle` 0; g-r quota-hold `2026-01-04T00:00:00Z` d1 `mergeBlocking` null; g-r no-verdict `2026-01-04T01:00:00Z` d1 `mergeBlocking` null; g-r pass `2026-01-04T02:00:00Z` d1 | 1 | 0 | 1 | 0 |
| T1-MS | g-m block `2026-01-05T00:00:00Z` `mergeBlocking` null; g-m pass `2026-01-05T00:00:00.5Z` `mergeBlocking` null (no `decision` on either) | 0 | 0 | 2 | 0 |
| T1-RULED | g-u block `2026-01-06T00:00:00Z` d1; g-u block `2026-01-06T01:00:00Z` d2; g-u block `2026-01-06T02:00:00Z` d3 `stopReview` true; g-u pass `2026-01-06T03:00:00Z` `reviewer` `ruling:owner`, `mergeBlocking` null | 0 | 1 | 4 | 1 |
| T1-ADVISORY | g-v block `2026-01-07T00:00:00Z` d1 `mergeBlocking` false; g-v pass `2026-01-07T01:00:00Z` d2 | 0 | 0 | 2 | 0 |
| T1-TIE | g-t pass `2026-01-09T00:00:00Z` d1; g-t block `2026-01-09T00:00:00Z` d2 | 1 | 0 | 1 | 0 |

On main the six rows named in acceptance 1 give `first` 0 and `mean` 2 for T1-SECOND, T1-SYNC, T1-SYNC-PASS and T1-TIE, and `first` 1 and `mean` 1 for T1-SECOND-ONLY and T1-ADVISORY. `writeTables` sorts lines, so the block of T1-TIE and the entries of goal g-a come first in the file; only the order of R2 gives the rows above.

### 2
The view over all entries of item 1 together gives exactly `{ cards: 10, first_decision_pass_share: 0.4, two_or_more_blocks_share: 0.2, mean_decisions_to_pass: 1.875, stop_review_share: 0.2 }`: first passes T1-SECOND, T1-SYNC, T1-RETRY and T1-TIE; mean (1 + 1 + 3 + 1 + 2 + 4 + 2 + 1) / 8; two or more blocks and a stop on T1-RUNS and T1-RULED. Main gives `first_decision_pass_share` 0.3 and `mean_decisions_to_pass` 2.

### 3
The independent query, written to a scratch file and run with `duckdb -f` in the `--out` directory of `node bench/outcome/run.ts --no-usage --no-github --out <scratch>` started from the card worktree (state and registry of the main checkout); the same run prints the view. `cards` equals the view's `cards`, `first_passes / cards` its `first_decision_pass_share`, and `decisions_up_to_first_pass / cards_with_pass` its `mean_decisions_to_pass`. Record both outputs and `git -C <main checkout> rev-parse HEAD`.

```sql
.read bench/outcome/views/10-cards.sql
.mode json
WITH d AS (SELECT cardId, outcome, requestedAt::TIMESTAMPTZ AS t FROM review_decisions
  WHERE stage = 'formal' AND outcome IN ('pass', 'block') AND secondPass IS NOT TRUE AND baseSync IS NOT TRUE),
firstpass AS (SELECT cardId, min(t) AS t FROM d WHERE outcome = 'pass' GROUP BY cardId),
cards AS (SELECT DISTINCT cardId FROM review_decisions WHERE stage = 'formal' AND outcome IN ('pass', 'block'))
SELECT (SELECT count(*) FROM cards) AS cards,
  (SELECT count(*) FROM (SELECT cardId, arg_min(outcome, t) AS o FROM d GROUP BY cardId) WHERE o = 'pass') AS first_passes,
  (SELECT count(*) FROM firstpass) AS cards_with_pass,
  (SELECT count(*) FROM d JOIN firstpass f USING (cardId) WHERE d.t <= f.t) AS decisions_up_to_first_pass;
```

The `.read` path is the worktree's view file, given absolute. On the panel's snapshot it printed 299, 133, 224, 345; on the state at e6566c68, 300, 134, 225, 346.
