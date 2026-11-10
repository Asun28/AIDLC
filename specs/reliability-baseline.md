---
slug: reliability-baseline
title: Reliability baseline (Phase 0) measured from raw data, with no behaviour change
intent: intent/reliability-baseline.md
status: accepted
created: 2026-11-10T08:30:00Z
skills_applied: [tdd]
---

# Spec: Reliability baseline (Phase 0) measured from raw data, with no behaviour change
From intent: intent/reliability-baseline.md. Status: accepted. Skills applied: tdd.

82 of 263 cards (31%) were replaced by a successor card, most often after R3 blocked again with a new finding at each decision until a user ruling ended it. `aidlc review stats` reports rounds, decisions and findings per card, but nothing joins them to merges, CI, reverts, rulings or model usage. Phase 0 measures the baseline and changes no behaviour.

## Requirements (EARS)
- R1. The command `node bench/outcome/run.ts` shall read the state directory, the card registry, git history, the GitHub API and the local session logs without writing to any of them, write one JSONL file per table under `_local/outcome/`, run the SQL views under `bench/outcome/views/` with the DuckDB CLI and print each summary view.
- R2. The views shall compute the card-attempt count, the successor-card rate, the PR success rate, review convergence and lead time with the definitions in this spec.
- R3. The views shall compute tokens and list-price cost per stage for merged and for superseded cards, the total spent on superseded cards, and the cache-read share of input tokens per provider.
- R4. The views shall compute the share of repeat R3 blocks whose cited code predates decision 1, and per stage and angle the findings that match the true-defect proxy.
- R5. IF a source is missing, fails to parse or does not reconcile, THEN the ingest shall count it and name it in a table instead of dropping it.
- R6. The file `bench/outcome/rulings.jsonl` shall hold every past user ruling with its card, candidate, findings and outcome.
- R7. The document `docs/reliability/baseline.md` shall report every number of R2 to R4, the verdict-instability result of 30 reviewer reruns, the finding labels on 30 superseded and 15 clean cards with the two-model agreement rate, and every gap of R5.
- R8. The change set shall leave `src/`, `templates/`, `.claude/`, `REVIEW.md` and `package.json` unchanged.

## Design
One ingest module per source under `bench/outcome/` (state and registry, usage, GitHub, git history), each exporting pure functions over injected readers and a runner, and each writing JSONL in a fixed row order. `run.ts` calls them in order, then runs the `.sql` files in name order through the `duckdb` binary. Aggregation lives in SQL; extraction and normalisation live in TypeScript, where CI tests them.

Definitions:
- Card attempt: a card with at least one persisted card run. A card with `superseded_by` counts as a failure of that attempt.
- Accepted change: merged; the required checks green on the merge commit; not reverted within 14 days; no commit on the branch without a model co-author trailer; no user ruling.
- PR success rate: accepted changes / card attempts.
- Cost per accepted change: list-price cost of every invocation attributed to the card and its predecessors / accepted changes. [SOURCE: owner, 2026-11-10: R3 runs on a subscription, so cost is a list-price estimate]
- Lead time: card `startedAt` to merge, p50 and p90, split by time in each card state.
- Review convergence: share of cards passing R3 at decision 1; share needing 3 or more decisions; mean decisions to pass; share of blocks followed by a ruling.
- True-defect proxy: a finding on a card that merged, resolved by a later decided round after a candidate change to the file it cites.

## Interfaces and contracts
No public interface. The table and view names are documented in `bench/outcome/README.md` and may change with the scripts. Persisted records are read through their zod schemas in `src/core/types.ts`.

## Data model and migration impact
none: every source is read-only and the output under `_local/outcome/` is gitignored working state.

## Flagged concerns (route to policy owners)
- Session logs under the user's home directory hold private text. The usage ingest reads token counts, model names, timestamps, session ids and working directories only, and writes no message text.

## Non-goals
- Any change to review rules, allowances, prompts or the loop.
- Phases 1 to 4 of the reliability task, and the cards `T1-BASELINE-HARNESS` and `T1-BASELINE-REPORT` (the control arm against plain Claude Code), which stay as they are.
- Billing reconciliation for subscription usage.
- External labelled data sets (AACR-Bench, CRJudgeBench, c-CRAB).

## Acceptance
- 1. `node bench/outcome/run.ts` on this checkout exits 0 and every view returns rows. [R1]
- 2. The card and superseded counts equal those of `aidlc cards validate`, and the review decisions of the five most recent merged cards equal `aidlc review stats`. [R2]
- 3. The cost views report an unattributed share and the cache-read share per provider. [R3]
- 4. The repeat-block view reports true, false and unknown counts that sum to the repeat blocks. [R4]
- 5. The error table lists each unreadable or unreconciled source with a count. [R5]
- 6. `bench/outcome/rulings.jsonl` holds a row for each of the commits on main that cite a user ruling. [R6]
- 7. `docs/reliability/baseline.md` carries each number with the view that produced it. [R7]
- 8. `git diff --numstat <goal base>...main -- src templates .claude REVIEW.md package.json` is empty. [R8]
