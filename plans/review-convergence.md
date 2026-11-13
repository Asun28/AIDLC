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
One rule changes when the second R3 pass runs. Success: T0-R3-SECOND-PASS-ROOM merged with DoD, review and CI green, and the check after 15 cards read against the figures of the spec. The plan's second rule, a first-round miss made advisory behind `formalReview.missAdvisory`, was dropped with its card T1-R3-MISS-ADVISORY on 2026-11-14 by the owner's decision, before any run of the card started: `intent/review-convergence.md`, Decisions (owner, 2026-11-14).

Not in this plan: a change to `MAX_R3_DECISIONS`, to decision 1, to R2, to the ship-path reviewer, or a way to ship a ruled candidate without a successor card (built since by `plans/review-ruling.md`).

## 2. Minimal acceptable loop
T0-R3-SECOND-PASS-ROOM is one condition and its tests. It is the plan's one card.

## Files that change
- src/loop/card-runner.ts
- tests/scenarios/second-pass.test.ts
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md
- .claude/skills/verify-card-run-writes/SKILL.md

## Order of work
1. T0-R3-SECOND-PASS-ROOM: no second pass after a first pass at decision 3. It changes the first five files above and, at CLOSE, the verify skill.
2. The successor of T1-OUTCOME-HISTORY, in the reliability baseline goal, carrying commit 4d3d691d with `--no-lazy-fetch` passed on every git call and the minimum git version in the README. Its card is written in that goal, by the successor pattern of earlier rulings. It no longer waits for a card of this plan.

One worker.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T0-R3-SECOND-PASS-ROOM | MUST | no second pass after a first pass at decision 3 | - | - | - |

## Risks
- Another session holds uncommitted edits to `src/review/pre-review.ts` and `src/loop/card-runner.ts` in the worktree `_audit-20261111`. Card 1 starts after that work has merged or been dropped; otherwise the card meets its changes at base sync.
- The card changes files the verify-card-run-writes coverage record names. No new write kind is added; the fault-point test runs in the DoD and the skill's sync step runs at CLOSE.
- Net lines under `src/` rise (by about 3). The task's "flat or falling" is not met by this goal.

## Proof
- The card DoD, R3 and CI.
- Arc: a scenario run shows a first pass at decision 3 going to the ship with no second pass, and a first pass at decision 2 getting its second pass.
- After 15 cards: the table in `specs/review-convergence.md`, Check after 15 cards.
