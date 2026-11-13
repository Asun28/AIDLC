---
slug: review-ruling
title: A recorded ruling settles the findings of a card stopped for review, and the candidate ships
spec: specs/review-ruling.md
size: T1
status: draft
created: 2026-11-13T03:10:00Z
---

# Plan: a recorded ruling on the findings of a card stopped for review (from specs/review-ruling.md)

## 1. Goal and boundaries
The owner rules on each finding of the decision that stopped a card, and the stopped candidate ships without a replacement card. Success: the three cards merged with DoD, R3 and CI green, and a scenario run shows a goal stopped for review shipping its card's unchanged candidate after the rulings.

Not in this plan: every item under Out of scope in the spec.

## 2. Minimal acceptable loop
The record first. T1-REVIEW-RULE writes a ruling on a finding and changes no state, so it cannot ship anything. T1-REVIEW-RULE-SHIP then lifts the card's stop when the last finding is ruled. T1-REVIEW-RULE-GOAL makes both work on a goal that has stopped. Three cards, because each stays within the 250-line budget of a card that changes `src/`.

## 6. Contracts and core interfaces
- `ReviewFinding.ruling` (optional): `at`, `by`, `decision` (`rejected` or `deferred`), `reason`, `issue` (optional). Records written before this plan have none.
- Journal event `FINDING_RULED`.
- A ruled pass: a review invocation with `outcome: 'pass'` and `ruled: true` on the candidate of the stopping decision; the stopping invocation keeps `stopReview` and gains `stopLifted`.

## Files that change
- src/core/types.ts
- src/core/review-policy.ts
- src/loop/card-runner.ts
- src/loop/controller.ts
- src/audit/verifier.ts
- src/cli/main.ts
- tests/scenarios/review-rule.test.ts (new)
- tests/scenarios/review-rule-ship.test.ts (new)
- tests/scenarios/review-rule-goal.test.ts (new)
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md
- CLAUDE.md
- templates/CLAUDE.aidlc.md
- .claude/skills/verify-card-run-writes/SKILL.md

## Order of work
1. T1-REVIEW-RULE: the `ruling` field, `ruleFinding` in `src/core/review-policy.ts`, the runner method, the command and `FINDING_RULED`.
2. T1-REVIEW-RULE-SHIP: the lift, the ruled pass, the gate and the canonical document. Depends on 1: it reads the `ruling` field and both change `src/loop/card-runner.ts`.
3. T1-REVIEW-RULE-GOAL: the command on a goal stopped for review, the goal re-admission, the audit rule, the ruling in `aidlc review findings`, the stop narration and the instruction line. Depends on 2: it re-admits the goal at the lift.

One worker: the three cards share files.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-REVIEW-RULE | MUST | `aidlc review rule` records a ruling on a finding of a card stopped for review | - | - | - |
| T1-REVIEW-RULE-SHIP | MUST | the last ruling lifts the card's stop and the candidate ships by ruling | T1-REVIEW-RULE | - | - |
| T1-REVIEW-RULE-GOAL | MUST | the ruling runs on a stopped goal and re-admits it; narration, findings list and instructions name it | T1-REVIEW-RULE-SHIP | - | - |

## Risks
- T0-REVIEW-RESOLVE-LOST is running and changes `src/cli/main.ts`; card 1 meets it at base sync.
- The card deadline (3 h from the start) has usually passed when the owner rules. After the lift `card next` stops for time, and `aidlc goal extend` is the existing way on. Card 2 states this in the command's output and does not move a deadline.
- A session could rule on its own findings. `--by` is a recorded name, as with `aidlc goal extend`, and no check proves who typed the command. Card 3 adds the instruction line and the stop narration; a hook that refuses the command is not built.
- `src/audit/verifier.ts` ends a terminal disposition on a re-admission only for a stop for time. Card 3 adds the stop for review, for the re-admission a ruling writes.
- Until card 3 merges the command is refused on a goal that has stopped, so the feature is usable from end to end only after all three.
- The three cards change files the verify-card-run-writes coverage record names. The fault-point test runs in each DoD and the skill's sync step runs at CLOSE.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: a scenario run with a command reviewer stops a card at R3 and its goal for review, rules on every finding of the stopping decision, and shows `aidlc next` dispatching the card, the ship of the unchanged candidate with no review directive, and `aidlc audit verify` without `WORK_AFTER_TERMINAL`.
- After 20 cards: the check in `specs/review-ruling.md`.

## 10. After merge
none this version (development-only target)
