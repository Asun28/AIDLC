---
slug: review-convergence
title: Fewer R3 repair rounds per card, by two changes to what a later review may block on
intent: intent/review-convergence.md
status: accepted
created: 2026-11-11T02:20:00Z
skills_applied: []
---

# Spec: Fewer R3 repair rounds per card
From intent: intent/review-convergence.md. Status: accepted. Skills applied: (none).

## Requirements (EARS)
- R1 to R7. Dropped on 2026-11-14 with card T1-R3-MISS-ADVISORY, before any run of the card started (owner's decision; `intent/review-convergence.md`, Decisions of 2026-11-14; Non-goals).
- R8. WHEN the last decided R3 invocation on the current candidate is a first pass and the run has `MAX_R3_DECISIONS - 1` decisions recorded, THEN no second pass shall be due and the candidate shall go to the ship.
- R9. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state R8, the figures of the intent and a check after 15 cards. The parts of R9 on `REVIEW.md`, `templates/REVIEW.md` and `reviewPolicyVersion` were dropped with R1 to R7; the policy version stays `REVIEW.md@6`.

## Design
R8 is one condition in `secondPassDue` (`src/loop/card-runner.ts:1646`): the
existing test `substantiveDecisions >= MAX_R3_DECISIONS` becomes
`>= MAX_R3_DECISIONS - 1`.

## Interfaces and contracts
No new configuration key, command, flag, event type or verdict field. The
review policy version stays 6.

## Data model and migration impact
None.

## What the change is expected to do, and what it gives up
On the 7 second passes that ran after a first pass at decision 3, R8 would
have skipped all 7: 3 stops avoided, 4 passes not run. R8 gives up the second
pass on about 1 card in 5 that reaches it (7 of 32).

R2, dropped, would have turned 12 of the 57 later blocks of the period into
passes (21%), and would have let a defect merge that today is repaired before
the merge: of the 40 new findings on unchanged lines in later blocks, the
cited file changed afterwards for 26.

## Check after 15 cards
With R8 on, read `aidlc review stats` for the 15 cards that follow
and compare with the period above:

| Measure | Period before | Turn the rule off when |
|---|---|---|
| Runs passing at decision 1 | 48 of 110 | not a target of these rules |
| R3 decisions per run | 267 of 110 (2.4) | no lower |
| Runs blocked at decision 4 or later | 10 of 110 | no lower |

## Flagged concerns (route to policy owners)
- (none) R2, the one change to what the merge gate lets through, was dropped
  on 2026-11-14.

## Non-goals
- R1 to R7, a first-round miss made advisory from decision 2 (card T1-R3-MISS-ADVISORY, dropped 2026-11-14): the reasons are in the intent, Decisions of 2026-11-14.
- A change to `MAX_R3_DECISIONS`, to decision 1, to R2 (the pre-review) or to the ship-path reviewer.
- A second pass that is advisory, or one that runs after a first pass at decision 3.
- Shipping a ruled candidate without a successor card (built since by `plans/review-ruling.md`).
- A step that turns advisory findings into cards.
- A replay of stored verdicts under the new rule.
- The 29 later blocks that come from the repair itself (18 on changed lines, 11 re-raises): they are measured here and not addressed.
