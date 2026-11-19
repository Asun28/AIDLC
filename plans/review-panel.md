---
slug: review-panel
title: Score Fable 5.2 as a formal reviewer against the saved Codex pair, a larger clean set, the panel report, then an opt-in R3 panel and a pinned review policy
spec: specs/review-panel.md
size: T1
status: draft
created: 2026-11-18T23:10:00Z
---

# Plan: a two-reviewer R3 panel, measured first (from intent/review-panel.md)

## 1. Goal and boundaries
The owner reads in `docs/reliability/panel.md` whether a panel of two formal
reviewers (Codex+Codex or Codex+Fable 5.2) beats one Codex pass on the
reviewer bench by the keep rule of the intent. If it does, the panel runs on
R3 in this repository with `secondPass` off. The review policy a decision
applies comes from the run's base commit.
Not in this plan: a per-finding verification call, suppression by past
rejections, shuffled diff order (intent, Not in this goal).

## 2. Minimal acceptable loop
Measure first, and reuse what is measured. The 2026-11-16 arms left a matched Codex pair (policy aa7f80bac1a3, which REVIEW.md still hashes to) on 64 bug and 15 clean cases, so Codex+Codex needs no new review. T1-BENCH-FORMAL-COMMAND lets the bench run Fable 5.2; stage 1 runs Fable once on the same cases (about 40 reviews); stage 2 (about 580 reviews) runs only when stage 1 passes the gate of the intent. Cards 5 and 6 build the panel off by default; T1-R3-PANEL-ON switches it on only on a keep verdict. T1-REVIEW-POLICY-PIN is independent.

## Files that change
- T1-BENCH-FORMAL-COMMAND: `src/review/bench.ts`, `src/cli/main.ts`, tests, docs.
- T1-BENCH-CLEAN-40: `bench/outcome/clean.ts`, `evals/review/clean/`, `evals/review/README.md`, tests.
- T1-PANEL-ARMS-REPORT: `bench/outcome/panel.ts` (new, with the union scoring), `bench/outcome/panel.json`, `docs/reliability/panel.md`, tests.
- T1-R3-PANEL: `src/config.ts`, `src/core/types.ts`, `src/review/pre-review.ts`, `src/loop/card-runner.ts`, tests, docs.
- T1-R3-PANEL-FOLD: `src/core/review-policy.ts`, `src/loop/card-runner.ts`, tests, docs.
- T1-R3-PANEL-ON: `aidlc.config.json`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`.
- T1-REVIEW-POLICY-PIN: `src/loop/card-runner.ts`, `src/probes/git.ts`, tests, docs.

## Order of work
1. T1-BENCH-FORMAL-COMMAND, then T1-REVIEW-POLICY-PIN (both touch `docs/OPERATIONS.md`); T1-BENCH-CLEAN-40 in parallel with each.
2. Stage 1 (coordinator, after T1-BENCH-FORMAL-COMMAND merges): Fable 5.2 once on `_local/arms/miss25` and the 15 clean cases, reports under `_local/panel-arms/`, compared with the saved Codex pair. Stage 2 only when the gate holds: Codex and Fable at `--trials 3` on `evals/review/replay` and `evals/review/clean` (after T1-BENCH-CLEAN-40 and T1-ARMS-REPORT merge). Spend as the owner approves in the intent.
3. T1-PANEL-ARMS-REPORT.
4. T1-R3-PANEL, then T1-R3-PANEL-FOLD.
5. T1-R3-PANEL-ON, only with a keep verdict in `bench/outcome/panel.json`; with a drop verdict the card is closed unmerged with the verdict as its reason.

## Risks
- Ledger semantics (both panelists): two samplers per decision raise the
  chance that one re-raises a disputed finding, which stops the card from
  decision 2. Mitigation: the composition is fixed at reservation, the
  member is recorded on every raise and re-raise, and the STOP/review rate
  is a keep measure.
- A quota hold of one member outranks a block of the other in
  `aggregateVerdicts`. T1-R3-PANEL replaces a held member once with a
  second run of the other member and never passes on fewer verdicts than
  members.
- Selection bias: stage 1 reuses cases chosen for a baseline miss, and the
  second Codex run there used analysis-first field order. Stage 1 is a
  screen; only stage 2, on all 124 bug cases, can keep the panel.
- Policy drift: a REVIEW.md change before stage 1 breaks the pairing with
  the saved Codex runs (T1-PANEL-ARMS-REPORT refuses differing hashes);
  run stage 1 before T1-REVIEW-POLICY-PIN or any REVIEW.md edit merges.

## Proof
Each card's DoD; the arm reports retained under `_local/panel-arms/` and reduced
into `bench/outcome/panel.json`; after T1-R3-PANEL-ON, `aidlc review stats`
over the next 30 cards against the intent's loop measures.
