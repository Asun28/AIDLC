---
slug: review-convergence
title: Fewer R3 repair rounds per card, by two changes to what a later review may block on
author: asun28 (owner)
status: accepted
created: 2026-11-11T02:15:00Z
source: human
---

# Intent: Fewer R3 repair rounds per card, by two changes to what a later review may block on
Author: asun28 (owner). Status: accepted.

## Problem
A card that does not pass R3 at decision 1 often does not pass at decision 2
either, and each block costs a repair round by the implementer and one more
review. The figures below are from this repository's own records: every card
run with a numbered R3 decision between 2026-10-22 and 2026-11-11, read with
`aidlc review stats` and the scripts under `bench/outcome/`. The line-level
figures come from the history stage on the unmerged branch
`T1-OUTCOME-HISTORY` (commit 4d3d691d), one run, so they are leads.

- 110 card runs, 267 R3 decisions, 124 blocks. 48 runs (44%) passed at
  decision 1. 10 runs blocked at decision 4 or later and stopped for a ruling.
- The block rate does not fall with the decision number: 62 of 110 at
  decision 1, 37 of 75 at decision 2, 13 of 33 at decision 3, 6 of 15 at
  decision 4 (second passes not counted).
- 57 blocks came at decision 2 or later, second passes not counted. By where
  their new findings sit: 17 hold only findings on lines the repair did not
  change (the earlier review could have raised them), 18 hold only findings
  on lines the repair changed, 11 hold no new finding (a re-raise of an
  earlier one), 11 are mixed or could not be placed.
- Of the 17, 12 hold no finding on dimensions 1 to 5 of `REVIEW.md`.
- The second pass ran 32 times and blocked 5. 7 of the 32 ran after a first
  pass at decision 3, where a block is decision 4 and stops the card with no
  repair: 3 blocked (T0-CARD-LEASE-HEARTBEAT, T1-OUTCOME-USAGE,
  T1-OUTCOME-GITHUB) and each needed the owner's ruling and a successor card.
- 32 rulings are recorded in the history of main, 24 of them in 2026-11.

The cost is in the repair rounds. In the reliability baseline goal the
implementers cost 63.39 USD against 16.38 USD for 11 reviews.

## Proposed outcome
1. From R3 decision 2 of a card run, a new finding on lines the repair did
   not change does not block the card unless it is on dimensions 1 to 5. It
   is recorded and shown as a first-round miss.
2. The second R3 pass does not run after a first pass at decision 3, where
   its block could only stop the card.
3. The owner can compare the 15 cards after the change with the figures
   above and turn either rule off.

## Affected users and systems
The R3 formal review of the card loop (`src/loop/card-runner.ts`,
`src/review/pre-review.ts`, `src/core/review-policy.ts`), `REVIEW.md` and its
template copy, `aidlc review stats`, `aidlc.config.json` and its template.
R2 and the ship-path reviewer are not touched.

## Constraints
- No new command, provider or stage. No extra review, retry, reviewer or
  model. `MAX_R3_DECISIONS` stays 4.
- Rule 1 is behind a configuration key, off in the template and on in this
  repository, as `formalReview.secondPass` is.
- A finding on dimensions 1 to 5 (scope, hard boundaries, frozen contracts,
  licence, attribution) blocks at every decision, as today.
- The second pass keeps blocking wherever a repair round is left (owner,
  2026-11-11: it stays on).
- Net added lines under `src/` are stated per card and kept small; this goal
  does not meet "flat or falling" by itself and says so.
- Figures from published papers are leads and are not cited as evidence.

## Decisions (owner, 2026-11-11)
- T1-OUTCOME-HISTORY stays stopped at R3 decision 4. Its candidate 4d3d691d
  stays on its branch, unmerged. A successor runs as the first card after
  the two rules land.
- Rule 1: a first-round miss on dimensions 1 to 5 still blocks.
- Rule 2: no second pass after a first pass at decision 3.
- Shipping a ruled, unchanged candidate without a successor card is not part
  of this goal.

## Decisions (owner, 2026-11-14)
- Rule 1 (Proposed outcome 1) is dropped with its card T1-R3-MISS-ADVISORY,
  before any run of the card started. Rule 2 stays as merged
  (T0-R3-SECOND-PASS-ROOM).
- Reason 1: `aidlc review rule` (`plans/review-ruling.md`, merged
  2026-11-13) lets the owner reject or defer one finding of the decision that
  stopped a card, and the candidate ships. A first-round miss is then settled
  by a recorded decision on that finding; rule 1 would make every such
  finding advisory with no one reading it.
- Reason 2: the cost the spec states. Of the 40 new findings on unchanged
  lines in later blocks, the cited file changed afterwards for 26.
- Reach since this intent, read from the card-run records on 2026-11-14: 65
  card runs since 2026-11-10, 32 formal findings raised after decision 1, 4
  of them with the engine's `outsideDelta` mark. The mark is by file, so it
  leaves out a finding on an unchanged line of a file the repair changed: 4
  of 32 is a lower bound of what rule 1 would have covered. No line-level
  figure exists for this period; the figure above (12 of 57 later blocks) is
  the only one, from one run of an unmerged script.
- The successor of T1-OUTCOME-HISTORY no longer waits for rule 1.

## Open questions
- (none)
