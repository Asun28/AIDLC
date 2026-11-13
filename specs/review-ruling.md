---
slug: review-ruling
title: A recorded ruling settles the findings of a card stopped for review, and the candidate ships
status: draft
created: 2026-11-13T03:10:00Z
skills_applied: []
---

# Spec: a recorded ruling on the findings of a card stopped for review

## Problem
A card stopped for review is final. `selectCardState` returns a persisted stop before anything else, and the runner reads a decision recorded as a stop (`stopReview`) on every call, so nothing ships the stopped candidate. The owner's ruling is written as text into a replacement card, which runs the whole loop again.

Figures from `.aidlc/` on 2026-11-13, card runs started since 2026-11-10 (57 runs, 56 cards with an R3 decision):
- 9 of 57 cards were replaced. 6 of the 10 recorded stops were for review.
- 37 of 56 passed at R3 decision 1. 6 of 56 had three or four blocks.
- All time: 87 of 308 cards replaced, and 81 of 109 recorded stops were for review (`bench/outcome`, `summary_successor_rate` and `summary_stop_reasons`).

The engine already gives each finding an id and records disputes and re-raises (`src/core/review-policy.ts`). It has no record of the owner's decision on a finding.

## Accepted behaviour
1. `aidlc review rule <card> <finding> --reject|--defer --by <who> --reason "<text>"` records the owner's ruling on one merge-blocking finding of the decision that stopped the card. `--reject`: the finding does not hold. `--defer`: it holds and is left to follow-up work, with an optional `--issue <n>`.
2. A ruled finding is settled. It is listed with its ruling and is not open.
3. When every merge-blocking finding of the stopping decision is ruled, the stop is lifted: the card run and a goal stopped for review are in progress again, the candidate the decision reviewed counts as passed by ruling, and it ships with no further R3 decision and no second pass.
4. A finding the owner wants repaired in this card is left unruled. The card stays stopped and the replacement path is unchanged.
5. The ruling is the owner's. A session records one only on the owner's instruction; the stop narration and the installed instructions say so.

`aidlc goal extend` is the precedent: a recorded authority re-admits a goal and its cards stopped for time (`GoalController.extendDeadline`).

## Out of scope
- A ruling that grants a further repair round or resets a counter.
- A stop for review with no finding to rule on: no verdict after the retry, a required review beyond the allowance, exhausted pre-review rounds, a ship-path reviewer's second block.
- A ruling on a card that is not stopped.
- A change to `MAX_R3_DECISIONS`, to `REVIEW.md`, or to what a reviewer receives.
- Creating a GitHub issue for a deferred finding.
- Lifting a `tool` stop (issue 109).
- A check that the person named by `--by` typed the command.

## Check after 20 cards
Compare with the figures above: cards replaced (target under 15%), and cards whose stop for review ended in a ruled ship instead of a replacement.
