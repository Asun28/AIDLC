---
slug: reliability-baseline-2
title: Corrected outcome views, a committed baseline and a labelled replay set, in cards of about 200 lines
spec: specs/reliability-baseline-2.md
size: T1
status: draft
created: 2026-11-14T08:55:00Z
---

# Plan: corrected outcome views, baseline and replay set (from specs/reliability-baseline-2.md)

## 1. Goal and boundaries
The owner can read `docs/reliability/baseline.md` for the loop's numbers from a corrected run of
`bench/outcome`, and the reviewer bench holds a labelled replay set with a baseline arm that the
next goal (plans/loop-evidence.md) compares a review-text change against. No behaviour change:
nothing under `src/`, `templates/`, `.claude/`, `REVIEW.md` or `package.json`.
Budget: shared with plans/loop-evidence.md, $300 of model spend for both goals (owner,
2026-11-14). This goal's share: about $150, most of it the bench run of card 4.

## 2. Minimal acceptable loop
The view fix first, since the snapshot and the report read it. The labels need only the state
directory, so they start beside the view fix. The replay cases need the final labels; the report
needs all four.

## 4.5 Module design
- `bench/outcome/views/10-cards.sql`: the corrected first-decision columns.
- `bench/outcome/summary.json`: the committed snapshot of the `summary_*` views.
- `bench/outcome/labels.ts`: the fixed selection, the two model calls, the merge with rulings.
- `bench/outcome/labels.jsonl`: one row per labelled finding.
- `evals/review/*.json`: confirmed cases made from the final labels.
- `bench/outcome/replay-main.json`: the baseline arm of the bench on main's reviewer.
- `docs/reliability/baseline.md`: the report.

## Files that change
- bench/outcome/views/10-cards.sql
- bench/outcome/README.md
- bench/outcome/run.ts
- bench/outcome/ingest.ts
- tests/surface/outcome-first-decision.test.ts (new)
- tests/surface/outcome-ingest.test.ts
- bench/outcome/summary.json (new)
- tests/surface/outcome-summary.test.ts (new)
- bench/outcome/labels.ts (new)
- bench/outcome/labels.jsonl (new)
- bench/outcome/labels-rulings.jsonl (new)
- tests/surface/outcome-labels.test.ts (new)
- bench/outcome/replay.ts (new)
- bench/outcome/replay-main.json (new)
- evals/review/README.md
- tests/surface/review-bench.test.ts
- tests/surface/outcome-replay.test.ts (new)
- docs/reliability/baseline.md (new)
- tests/surface/outcome-baseline.test.ts (new)
- CHANGELOG.md
- specs/tasks/T1-OUTCOME-BASELINE.md (superseded_by only, by the coordinator on main)


## Order of work
T1-OUTCOME-REPLAY writes the confirmed replay cases as new files under evals/review/replay/.

1. T1-OUTCOME-FIRST-DECISION: the view fix and its fixture test.
2. T1-OUTCOME-LABELS: the selection, the two model labels, the owner's rulings. Starts beside 1
   (disjoint paths); waits for the owner's rulings before SHIP.
3. T1-OUTCOME-SUMMARY: the snapshot on the corrected views. Depends on 1.
4. T1-OUTCOME-REPLAY: the confirmed cases and the baseline arm. Depends on 2.
5. T1-OUTCOME-REPORT: the report and the goal's one CHANGELOG entry. Depends on 3 and 4.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-OUTCOME-FIRST-DECISION | MUST | first-decision pass rate and decisions to a pass counted by date order | - | W1 | - |
| T1-OUTCOME-LABELS | MUST | two-model labels with owner rulings for 30 replaced, 15 clean cards and the second-pass blocks | - | W1 | - |
| T1-OUTCOME-SUMMARY | MUST | committed snapshot of every summary view | T1-OUTCOME-FIRST-DECISION | - | - |
| T1-OUTCOME-REPLAY | MUST | confirmed bench cases from the labels and the baseline arm | T1-OUTCOME-LABELS | - | yes |
| T1-OUTCOME-REPORT | MUST | docs/reliability/baseline.md and the CHANGELOG entry | T1-OUTCOME-SUMMARY, T1-OUTCOME-REPLAY | - | - |

T1-OUTCOME-REPLAY is a freeze point: T1-R3-SUPPORTED-FINDINGS (plans/loop-evidence.md) compares
against its baseline arm.

## Risks
- The owner's rulings on label disagreements can take longer than the 12 h arc deadline. The
  labels card stops with the disagreement sheet prepared; `aidlc goal extend` is the recorded
  way on.
- DuckDB is not on CI. Tests that run a view skip by name when no `duckdb` binary is found; the
  arc proof runs every view on the real state.
- The bench run of card 4 is the largest spend of the goal (about $1.4 per formal review at list
  price). It runs once; a rerun needs the owner's word.
- Old candidate commits may be gone. A finding whose candidate cannot be read is counted and left
  out of the cases, never guessed.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `node bench/outcome/run.ts` on the main checkout exits 0 and its `summary_*` output equals
  `bench/outcome/summary.json` apart from rows added after the snapshot's commit.
- Arc: `aidlc review bench run --stage formal` loads every confirmed case without error.
- Arc: `git diff --numstat <goal base>...main -- src templates .claude REVIEW.md package.json` is
  empty.

## 10. After merge
none this version (development-only target)
