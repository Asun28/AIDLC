---
slug: review-convergence
title: Fewer R3 repair rounds per card, by two changes to what a later review may block on
intent: intent/review-convergence.md
status: draft
created: 2026-11-11T02:20:00Z
skills_applied: []
---

# Spec: Fewer R3 repair rounds per card
From intent: intent/review-convergence.md. Status: draft. Skills applied: (none).

## Requirements (EARS)
- R1. `formalReview.missAdvisory` shall default to false in `src/config.ts`, be false in `templates/aidlc.config.json` and be true in this repository's `aidlc.config.json`.
- R2. WHEN `missAdvisory` is true and an R3 decision of a card run is decision 2 or later, is not a second pass and is not a base-sync decision, THEN a block reason shall be advisory when it holds all four: it references no prior finding with `re:F<n>`; it cites a file with a line or a line range; no cited line is inside a changed hunk of the delta since the last reviewed candidate, context lines included; and its dimension number is 6 or higher.
- R3. IF the delta cannot be read, or the reason has no line, no dimension number, or cites a file the delta deletes or renames, THEN the reason shall be classified as it is with `missAdvisory` false.
- R4. WHEN the same commit is reviewed again outside a second pass, the delta shall be read as empty, so R2 applies to every new reason of that decision.
- R5. A decision whose blocking reasons are all advisory under R2 shall be a pass that spends a decision as a pass does, and the candidate shall go on as after any pass (to the second pass when one is due).
- R6. Each reason made advisory under R2 shall be retained on the decision as an advisory reason marked as a first-round miss, as a `[pre-existing]` reason on an unchanged line is retained, and shall be counted per card and in the totals of `aidlc review stats`.
- R7. The delta section of the R3 prompt shall state the rule of R2 in one sentence when `missAdvisory` is true, and shall be unchanged when it is false.
- R8. WHEN the last decided R3 invocation on the current candidate is a first pass and the run has `MAX_R3_DECISIONS - 1` decisions recorded, THEN no second pass shall be due and the candidate shall go to the ship.
- R9. `REVIEW.md` and `templates/REVIEW.md` shall state R2 next to the `[pre-existing]` rule, `reviewPolicyVersion` shall move to `REVIEW.md@7` in both configuration files, and `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state R1 to R8, the figures of the intent and a check after 15 cards.

## Design
R2 to R5 reuse the changed-line rule that makes a `[pre-existing]` reason
advisory (`changedLineRanges` and `enforceCitations` in
`src/review/pre-review.ts`), with the delta in place of the whole diff and
with no tag required from the reviewer. The card run already collects the delta for a decision
after the first (`collectDelta`, `src/loop/card-runner.ts`) and already marks
a finding outside the delta's paths (`outsideDelta`,
`src/core/review-policy.ts:411`). R2 uses lines where that mark uses paths;
the mark and its count in `aidlc review stats` stay as they are for a run
with the key off.

R8 is one condition in `secondPassDue` (`src/loop/card-runner.ts:1646`): the
existing test `substantiveDecisions >= MAX_R3_DECISIONS` becomes
`>= MAX_R3_DECISIONS - 1`.

## Interfaces and contracts
One new configuration key, `formalReview.missAdvisory` (boolean). No new
command, flag, event type or verdict field. The review policy version moves
from 6 to 7.

## Data model and migration impact
None. A review invocation already carries its advisory reasons.

## What the change is expected to do, and what it gives up
On the 57 later blocks of the period, R2 would have turned 12 into passes
(21%). On the 7 second passes that ran after a first pass at decision 3, R8
would have skipped all 7: 3 stops avoided, 4 passes not run.

R2 lets a defect merge that today is repaired before the merge. Of the 40
new findings on unchanged lines in later blocks, the cited file changed
afterwards for 26, which is the only measure of "was repaired" the records
hold. Those reasons stay on the decision record of the card run; this goal adds no step
that turns them into cards.

R8 gives up the second pass on about 1 card in 5 that reaches it (7 of 32).

## Check after 15 cards
With both rules on, read `aidlc review stats` for the 15 cards that follow
and compare with the period above:

| Measure | Period before | Turn the rule off when |
|---|---|---|
| Runs passing at decision 1 | 48 of 110 | not a target of these rules |
| R3 decisions per run | 267 of 110 (2.4) | no lower |
| Runs blocked at decision 4 or later | 10 of 110 | no lower |
| Advisory first-round misses | 0 (rule off) | 2 or more needed a fix card or a revert after the merge |

## Flagged concerns (route to policy owners)
- R2 changes what the merge gate lets through. The owner ruled on its scope
  on 2026-11-11 (intent, Decisions).

## Non-goals
- A change to `MAX_R3_DECISIONS`, to decision 1, to R2 (the pre-review) or to the ship-path reviewer.
- A second pass that is advisory, or one that runs after a first pass at decision 3.
- Shipping a ruled candidate without a successor card.
- A step that turns advisory findings into cards.
- A replay of stored verdicts under the new rule.
- The 29 later blocks that come from the repair itself (18 on changed lines, 11 re-raises): they are measured here and not addressed.
