---
slug: review-convergence
title: Fewer R3 repair rounds per card
spec: specs/review-convergence.md
size: T1
status: draft
created: 2026-11-11T02:25:00Z
---

# Plan: fewer R3 repair rounds per card (from specs/review-convergence.md)

## 1. Goal and boundaries
Two rules change what a later R3 review may block on. Success: both cards merged with DoD, review and CI green; this repository's `aidlc.config.json` has `formalReview.missAdvisory` on; the successor of T1-OUTCOME-HISTORY has run under both rules; and the check after 15 cards is written in `docs/OPERATIONS.md` with the figures to compare against.

Not in this plan: a change to `MAX_R3_DECISIONS`, to decision 1, to R2, to the ship-path reviewer, or a way to ship a ruled candidate without a successor card.

## 2. Minimal acceptable loop
The smaller rule first. T0-R3-SECOND-PASS-ROOM is one condition and its tests, so it shows the review path of this goal working before the larger card starts.

## Files that change
- src/loop/card-runner.ts
- tests/scenarios/second-pass.test.ts
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md
- src/config.ts
- src/review/pre-review.ts
- src/review/stats.ts
- aidlc.config.json
- templates/aidlc.config.json
- REVIEW.md
- templates/REVIEW.md
- tests/scenarios/miss-advisory.test.ts (new)
- tests/surface/pre-review.test.ts
- tests/surface/stats.test.ts
- tests/surface/config.test.ts
- tests/surface/templates.test.ts
- .claude/skills/verify-card-run-writes/SKILL.md

## Order of work
1. T0-R3-SECOND-PASS-ROOM: no second pass after a first pass at decision 3. It changes the first five files above and, at CLOSE, the verify skill.
2. T1-R3-MISS-ADVISORY: a first-round miss on dimensions 6 to 17 is advisory from decision 2, behind `formalReview.missAdvisory`, on in this repository in the same card. It changes every file above except `tests/scenarios/second-pass.test.ts`. Depends on 1: both change `src/loop/card-runner.ts`.
3. The successor of T1-OUTCOME-HISTORY, in the reliability baseline goal, carrying commit 4d3d691d with `--no-lazy-fetch` passed on every git call and the minimum git version in the README. Its card is written when card 2 has merged, by the successor pattern of earlier rulings. It is the first card to run under both rules.

One worker: the two cards share a file.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T0-R3-SECOND-PASS-ROOM | MUST | no second pass after a first pass at decision 3 | - | - | - |
| T1-R3-MISS-ADVISORY | MUST | a first-round miss on dimensions 6 to 17 is advisory from decision 2, behind `formalReview.missAdvisory` | T0-R3-SECOND-PASS-ROOM | - | - |

## Risks
- Another session holds uncommitted edits to `src/review/pre-review.ts` and `src/loop/card-runner.ts` in the worktree `_audit-20261111`. Card 1 starts after that work has merged or been dropped; otherwise both cards meet its changes at base sync.
- Rule 1 and the second pass work against each other: a decision that passes because its only findings are advisory misses goes to the second pass, which reads the whole diff and may block on the same lines. The second pass stays exempt by the owner's decision, so the effect of rule 1 on cards that reach a second pass may be smaller than 12 of 57.
- The 12 of 57 comes from line blame in an unmerged script; the rule uses the hunks of the delta. The two can differ on moved lines.
- Both cards change files the verify-card-run-writes coverage record names. No new write kind is added; the fault-point test runs in each DoD and the skill's sync step runs at CLOSE.
- `REVIEW.md` changes, so the policy version moves to 7 and stored policy hashes change. Reviews in flight at the merge are dispatched again by the loop's existing rule.
- Net lines under `src/` rise (card 1 by about 3, card 2 by at most 90). The task's "flat or falling" is not met by this goal.
- Rule 1 does nothing for the 29 later blocks that come from the repair itself, which is what stopped T1-OUTCOME-HISTORY (decisions 3 and 4). Step 3 may still take more than one decision.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: a scenario run with `missAdvisory` on shows a decision 2 whose only reason is a dimension 9 finding on an unchanged line recorded as a pass with one advisory reason marked as a first-round miss, and the same reason on dimension 2 recorded as a block.
- Arc: a scenario run shows a first pass at decision 3 going to the ship with no second pass, and a first pass at decision 2 getting its second pass.
- Arc: `aidlc review stats` on this repository prints the advisory first-round misses of step 3's card run.
- After 15 cards: the table in `specs/review-convergence.md`, Check after 15 cards.
