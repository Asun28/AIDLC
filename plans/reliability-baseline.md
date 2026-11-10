---
slug: reliability-baseline
title: Reliability baseline (Phase 0)
spec: specs/reliability-baseline.md
size: T1
status: draft
created: 2026-11-10T08:30:00Z
---

# Plan: reliability baseline, Phase 0 (from specs/reliability-baseline.md)

## 1. Goal and boundaries
The owner can rerun `node bench/outcome/run.ts` and read `docs/reliability/baseline.md` to get the loop's PR success rate, cost per accepted change, lead time and review convergence, computed from raw data. No behaviour changes: nothing under `src/`, `templates/`, `.claude/` or `REVIEW.md`, and `package.json` and CI stay as they are. Budget: 50 USD of model spend and 2 working days.

## 2. Minimal acceptable loop
The state ingest and the card and review views first. They need only the state directory and the registry, and they already answer the successor rate and review convergence. Usage, GitHub and git history each add tables beside them.

## Files that change
- bench/outcome/ingest.ts (new)
- bench/outcome/run.ts (new)
- bench/outcome/views/10-cards.sql (new)
- bench/outcome/README.md (new)
- tests/surface/outcome-ingest.test.ts (new)
- bench/outcome/usage.ts (new)
- bench/outcome/prices.json (new)
- bench/outcome/views/20-cost.sql (new)
- tests/surface/outcome-usage.test.ts (new)
- bench/outcome/github.ts (new)
- bench/outcome/views/30-github.sql (new)
- tests/surface/outcome-github.test.ts (new)
- bench/outcome/history.ts (new)
- bench/outcome/views/40-history.sql (new)
- tests/surface/outcome-history.test.ts (new)
- docs/reliability/baseline.md (new)
- bench/outcome/rulings.jsonl (new)
- bench/outcome/labels.jsonl (new)
- bench/outcome/instability.json (new)
- CHANGELOG.md

## Order of work
1. T1-OUTCOME-INGEST: tables from the state directory and the registry, the runner, the card and review views.
2. T1-OUTCOME-USAGE: usage rows from session logs and reviewer logs, list-price cost, attribution to cards. Depends on 1.
3. T1-OUTCOME-GITHUB: pull requests, checks, reverts, the accepted-change view and the journal reconciliation. Depends on 1.
4. T1-OUTCOME-HISTORY: rulings, repeat blocks against decision 1, findings followed by a fix. Depends on 1.
5. T1-OUTCOME-BASELINE: the run on real data, the 30 reviewer reruns, the labels and the report. Depends on 2, 3 and 4.

One worker: cards 2 to 4 each add a line to `run.ts` and a section to the README, and there is one reviewer slot.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-OUTCOME-INGEST | MUST | state and registry tables, the runner, the card and review views | - | - | - |
| T1-OUTCOME-USAGE | MUST | usage rows, list-price cost, attribution, the cost views | T1-OUTCOME-INGEST | - | - |
| T1-OUTCOME-GITHUB | MUST | pull requests, checks, reverts, the accepted-change view | T1-OUTCOME-INGEST | - | - |
| T1-OUTCOME-HISTORY | MUST | rulings, repeat blocks against decision 1, findings followed by a fix | T1-OUTCOME-INGEST | - | - |
| T1-OUTCOME-BASELINE | MUST | the run on real data, reruns, labels and `docs/reliability/baseline.md` | T1-OUTCOME-USAGE, T1-OUTCOME-GITHUB, T1-OUTCOME-HISTORY | - | - |

## Risks
- The SQL views cannot run in CI, which has no DuckDB. Each view test runs when a `duckdb` binary is found and is skipped by name otherwise; the arc proof runs every view on the real state.
- The session log formats of Claude Code and Codex are not a documented contract. The usage card reads real files first, keeps structure-only fixtures, and counts every line it cannot read.
- 107 of 137 evidence goals have no review folder and old candidate commits may be gone from the repository. Each analysis has an `unknown` value and reports its count.
- Attribution of usage to a card by time window and working directory can be wrong when two sessions overlap. The unattributed share and the overlap count are reported.
- The reviewer may block these cards repeatedly, the problem this goal measures. Each card stays under about 450 changed lines and names its inputs and failure paths.
- The 12 hour arc deadline is shorter than the owner's wait on label disagreements. The baseline card stops with the label sheet prepared if the owner has not ruled by then.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: `node bench/outcome/run.ts` on this checkout's state exits 0, every view returns rows, and the card count and superseded count equal `aidlc cards validate` (263 and 82 on 2026-11-10, or the counts at the merge).
- Arc: review decisions per card in `review_decisions` equal `aidlc review stats` for five cards picked by a fixed rule (the five most recent merged cards).
- Arc: `git diff --numstat <goal base>...main -- src templates .claude REVIEW.md package.json` is empty.
