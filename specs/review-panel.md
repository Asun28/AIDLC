---
slug: review-panel
title: A two-reviewer R3 panel, measured on the reviewer bench before the loop runs it
intent: intent/review-panel.md
status: accepted
created: 2026-11-19T00:25:00Z
skills_applied: []
---

# Spec: A two-reviewer R3 panel, measured on the reviewer bench before the loop runs it
From intent: intent/review-panel.md. Status: accepted (owner decisions of 2026-11-19). Skills applied: (none; the intent has no open questions).

## Requirements (EARS)
- R1. WHEN `aidlc review bench run --stage formal --formal-command <file>` runs, the reviewer bench shall review every selected case with the file's reviewer alone and name it in the report. (T1-BENCH-FORMAL-COMMAND)
- R2. The reviewer bench shall hold at least 40 confirmed clean cases, the 15 of main unchanged. (T1-BENCH-CLEAN-40)
- R3. The panel report shall give union, intersection and unique hits of Codex+Codex and Codex+Fable 5.2 from saved reports only, and keep verdicts by the accepted keep rule. (T1-PANEL-ARMS-REPORT)
- R4. WHERE `formalReview.panel` is set, the card runner shall run both members on each R3 decision under one reservation and one findings snapshot, block when either member cites a block, and pass only on two passes. (T1-R3-PANEL)
- R5. WHERE `formalReview.panel` is set, the card runner shall record one finding per defect that both members cite at overlapping lines of one file with one class. (T1-R3-PANEL-FOLD)
- R6. IF `bench/outcome/panel.json` gives `keep.panel` = `keep`, THEN this repository's configuration shall set the kept panel and no `secondPass`. (T1-R3-PANEL-ON)
- R7. The card runner shall apply the REVIEW.md of the run's base commit, never the main checkout's working-tree file. (T1-REVIEW-POLICY-PIN)

## Design
plans/review-panel.md. Measurement first: stage 1 (one Fable trial on the
cases of the saved 2026-11-16 Codex pair, policy aa7f80bac1a3) needs only R1;
stage 2 (3 trials, all cases) needs R1 and R2 and a separate owner approval.
The panel reuses `runReviewPanel` with a command per perspective.

## Interfaces and contracts
- CLI: `aidlc review bench run --formal-command <file>`.
- Config: `formalReview.panel` `{ reviewer, command, timeoutMs?, shell?, maxDiffBytes?, effort? }`, refused together with `secondPass: true`.
- Records: `ReviewFinding.alsoRaisedBy` (optional); bench report `options.formalCommand`.

## Data model and migration impact
Optional fields only; records written before this goal parse unchanged.

## Flagged concerns (route to policy owners)
- The deadlock rule of CLAUDE.md stands: a panel is fixed in configuration and never widened after a dispute.

## Non-goals
- A per-finding verification call, an agreement filter, sequential rounds in the loop, a panel at R2.

## Acceptance
- 1. Each card of plans/review-panel.md merged with DoD, R3 and CI green, or T1-R3-PANEL-ON closed unmerged on a drop verdict. [R1] [R2] [R3] [R4] [R5] [R6] [R7]
- 2. docs/reliability/panel.md states the stage 1 gate value and, if stage 2 ran, the keep verdicts. [R3]
