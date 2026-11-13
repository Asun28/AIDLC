---
slug: reliability-baseline-2
title: Corrected outcome views, a committed baseline and a labelled replay set, in cards of about 200 lines
intent: intent/loop-evidence.md
status: draft
created: 2026-11-14T08:55:00Z
skills_applied: []
---

# Spec: corrected outcome views, a committed baseline and a labelled replay set
From intent: intent/loop-evidence.md. Status: draft. Skills applied: (none).

This goal finishes Phase 0 of plans/reliability-baseline.md. Its two unstarted cards,
T1-OUTCOME-HISTORY (budget 850) and T1-OUTCOME-BASELINE (budget 1500), are larger than the
owner's card size of 2026-11-14. T1-OUTCOME-BASELINE is replaced by the five cards below;
T1-OUTCOME-HISTORY is left for a later goal. No behaviour of the loop changes.

## Requirements (EARS)
- R1. The view `summary_review_convergence` (bench/outcome/views/10-cards.sql) shall count a
  card's first formal decision by date order, leaving out second passes and base-sync reviews,
  and shall count decisions to a pass the same way.
- R2. The repository shall hold one committed snapshot of every `summary_*` view of one run of
  `node bench/outcome/run.ts` on the main checkout, with the commit, the timestamp and the row
  counts of every table and error table.
- R3. The repository shall hold one label row per merge-blocking formal finding of a fixed
  selection: 30 replaced cards, 15 clean cards and every second-pass block. Each row carries a
  label from Claude and one from a model of another vendor, from a closed set, and a final label
  that is their common value or the owner's ruling.
- R4. The finally labelled findings shall become confirmed reviewer bench cases under
  `evals/review/`, and one bench run of the formal stage on main's reviewer shall be committed as
  the baseline arm, with three trials on ten cases for verdict instability.
- R5. `docs/reliability/baseline.md` shall report the numbers of R2 to R4, each traced to its
  source file, with the gaps measured and no target for a later phase.

## Design
The merged scripts of `bench/outcome/` stay the only producers of numbers. Each card adds one
data file or one view change and a surface test that checks the file's shape and its agreement
with its source. Model labels come from argv commands (`claude -p`, `codex exec`) run by a
script, never from a shell string. The bench uses the existing `aidlc review bench export`,
confirm and `run` commands.

## Interfaces and contracts
- `bench/outcome/summary.json`, `bench/outcome/labels.jsonl`, `bench/outcome/replay-main.json`:
  new committed data files; their fields are fixed by the card that adds them.
- Label set (closed): `true-defect`, `out-of-card-scope`, `speculative`, `reviewer-misread`,
  `ambiguous-card`.

## Data model and migration impact
none (no persisted record of `.aidlc/` changes)

## Flagged concerns (route to policy owners)
- The owner rules on every label disagreement; the labels card waits for those rulings.

## Non-goals
- Any change under `src/`, `templates/`, `.claude/`, `REVIEW.md` or `package.json`.
- T1-OUTCOME-HISTORY (repeat blocks, findings followed by a fix).
- Reconciling cost with invoices: the report states it as a gap with its size.
- Targets for later goals.

## Acceptance
- 1. The corrected view returns 133 first-decision passes of 299 cards on the snapshot of
  2026-11-14, or the count at the run's commit, equal to an independent date-order count. [R1]
- 2. `summary.json`, `labels.jsonl`, the new bench cases and `replay-main.json` pass their
  surface tests. [R2] [R3] [R4]
- 3. `baseline.md` passes its surface test and every number in it names its source. [R5]
