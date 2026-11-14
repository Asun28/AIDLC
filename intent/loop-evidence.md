---
slug: loop-evidence
title: Decide a card's outcome from recorded execution and supported findings, measured against a corrected baseline
author: asun28 (owner)
status: accepted
created: 2026-11-14T08:50:00Z
source: human
---

# Intent: decide a card's outcome from recorded execution and supported findings
Author: asun28 (owner). Status: accepted.

## Problem
An outside audit of 2026-11-13 (commit 8f8a951) found that whether a card is done is decided by
model opinion, not by execution. A two-member panel (Codex gpt-6-astra and Claude Opus 5.5) checked
its claims against HEAD d4c878fc and the state under `.aidlc/` on 2026-11-14
(`_local/panel/`, not committed). Figures both panelists reproduced:

- 93 of 322 cards were replaced by a successor (28.9%). By budget: 15% at 200 lines or less, 44%
  above 800. By allowed paths: 15% at 5 or fewer, 44% at 16 or more.
- The first formal R3 decision blocked 161 of 292 card runs (55%).
- The loop never runs a card's `dod_command`; only the advisory mutant sweep does
  (`src/review/mutants.ts`). A successful attempt needs a non-blank worker-written receipt
  (`src/loop/card-runner.ts`, `recordAttempt`).
- The R3 prompt tells the reviewer to "actively try to disprove", that "when uncertain, block",
  and to "be exhaustive" (`src/review/pre-review.ts`).
- `bench/outcome/views/10-cards.sql` reports a first-decision pass rate of 42.8% and 1.625
  decisions to a pass; counted by date order the figures are 44.5% and 1.54, because the view
  counts second-pass and base-sync blocks as first-decision blocks.
- The second pass ran 74 times and blocked 8 times; 9 of its 16 findings cite a stated
  requirement or acceptance item that the first decision missed, and 3 catch a worker editing
  its own card.
- At list price, about $3,311 of model spend from 2026-10-14 to 2026-11-13, of which $680 (37% of
  the spend attributed to cards) went to cards that were later replaced. Not reconciled with
  billing.

## Proposed outcome
1. The outcome views count first decisions and decisions to a pass correctly, and a committed
   baseline report gives the numbers later changes are judged against.
2. A labelled replay set: the blocking findings of 30 replaced cards, 15 clean cards and the 8
   second-pass blocks, each labelled by two models of different vendors, with the owner's ruling
   where they disagree, turned into confirmed reviewer bench cases.
3. `aidlc card attempt --outcome success` runs the card's `dod_command` itself and records the
   exit code, duration, output digest and output tail at the candidate commit. In this goal the
   record changes no state; a SHIP gate on it comes in a later goal, with the data.
4. The R3 prompt and REVIEW.md require supported findings in place of the three phrases above,
   keep the hard boundaries, and pass a bench comparison against main before SHIP.

## Affected users and systems
The owner (labels, rulings, approval of the review text); `bench/outcome/`, `docs/reliability/`,
`evals/review/`, `src/loop/card-runner.ts`, `src/core/types.ts`, `src/review/pre-review.ts`,
`REVIEW.md` and its template, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`.

## Constraints
- Owner decisions of 2026-11-14: the loop-run DoD is record-only in this program's first step;
  two models draft the labels and the owner rules where they disagree; $300 of model spend for
  the two goals (stop and report at the ceiling); the baseline and the replay are delivered as
  loop cards.
- Cards of about 200 changed lines (added, modified and deleted), at most 250, at most 8 allowed
  paths. Generated data files are listed and do not count against the budget.
- A card that changes the review gate is delivered with every aidlc command run from the clean
  main checkout, so main's code, configuration and REVIEW.md review it until it merges. The owner
  approves the exact review text before that card's run starts.
- Only one card per goal edits CHANGELOG.md, docs/OPERATIONS.md and docs/ARCHITECTURE.md,
  unless a surface test requires a line in the same commit.
- Not in this program's first step (later goals, decided on this program's data): the SHIP gate
  on the loop-run DoD, the card contract pin, an `[unstated]` advisory tag, the delta rule,
  removing the second pass, a dimension filter, a two-decision cap, `card resume`, journal fsync,
  deletions, qualification on other repositories, a release.

## Decisions at the checkpoint (owner, 2026-11-14)
- Plans plans/reliability-baseline-2.md and plans/loop-evidence.md and their eight cards
  approved for registration.
- Goal g-20261110081857-67a4dc (Reliability Phase 0) is cancelled; T1-OUTCOME-BASELINE is
  superseded by the five cards of reliability-baseline-2; T1-OUTCOME-HISTORY stays unstarted for
  a later goal.
- T1-R3-SUPPORTED-FINDINGS: its review text (Acceptance detail 1 to 5) approved word for word;
  10 allowed paths approved as an exception to the 8-path rule.
- T1-OUTCOME-LABELS: the second labeller is Codex gpt-5.6-sol (about $22), not the R3 reviewer
  gpt-6-astra.
- Bench qualification: with a baseline false-block rate of 0 the candidate must be 0; a baseline
  of null goes to the owner.

## Decisions during the run (owner, 2026-11-14, evening)
- Both goals extended by 24 h (card deadlines ran out while decisions were pending).
- T1-DOD-RECORD-2 replaces T1-DOD-RECORD and carries its candidate (budget 320; the no-directory
  record drops the worktree path, which broke tests/scenarios/t0-flow.test.ts:3726).
- T1-OUTCOME-LABELS-2 replaces T1-OUTCOME-LABELS and carries its candidate (budget 400, spend
  ceiling $40): the pilot projected $37 and the built work was 374 lines.
- In the pilot Codex gpt-5.6-sol labelled all 10 findings `true-defect` and agreed with Claude on 3,
  so about 166 disagreements were expected. They are settled by an adjudicator (Claude Opus 5.5,
  high effort; card T1-OUTCOME-ADJUDICATE, ceiling $35); the owner rules a blind sample of 20 and
  the report states the agreement.
- T1-OUTCOME-LABELS-2, after its start: ceiling amended from $40 to $48 by a recorded amendment
  (the run cost $18.81 for 105 of 243 findings, projected $43.50); the owner chose this over a
  successor card.
- Program ceiling raised from $300 to $450 at list price (projection on 2026-11-14: about $420,
  about $190 of it Codex usage on the owner's subscription).

## Open questions
- (none)
