---
id: T0-REPAIR-CHECK
title: The R3 repair directive asks the repairer to try removing code first and to re-read the repair hunks, in text that reaches whoever makes the repair
status: merged
branch: T0-REPAIR-CHECK
worktree: D:\wt\AIDLC\T0-REPAIR-CHECK
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/repair-check.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REPAIR-CHECK.md
dod_command: npm run typecheck && node --test tests/scenarios/repair-check.test.ts tests/scenarios/review-block.test.ts tests/scenarios/base-sync-review.test.ts
dod_exit: 0
requirements:
  - R1. The `build` directive that `aidlc card next` returns in REVIEW_FIX shall carry the `REPAIR_CHECK` text after the existing repair text and before the defect class list.
  - R2. The directive's `effort` and `attempt`, the effort episode and every persisted record shall stay as they are on main.
  - R3. `docs/OPERATIONS.md` and the CHANGELOG Unreleased section shall state the rule and name this card.
acceptance:
  - 1. `tests/scenarios/repair-check.test.ts`: after an R3 block the directive starts with `Review block to repair: ` and contains `REPAIR_CHECK` once; the test fails on main. [R1] [dod arm 2]
  - 2. The same test: the directive's `effort` and `attempt` equal the values the ladder gives on main. [R2] [dod arm 2]
  - 3. `tests/scenarios/review-block.test.ts` passes unchanged, which keeps the class list last. [R1] [dod arm 2]
  - 4. The OPERATIONS and CHANGELOG text (reviewer-verified against the diff). [R3]
depends_on: []
budget: 100
tdd: true
forbid:
  - changing `src/core/effort.ts`, an effort level or `.claude/agents/implementer.md`
  - a new gate, persisted field or schema change
  - weakening or skipping a test
non_goals:
  - raising repair effort (see Why)
  - the R2 repair narration, since this repository runs no R2
hygiene: "`card-runner.ts` is covered by the verify-card-run-writes skill: run its check before SHIP. This card changes text only, so no write order moves. The text avoids the word class because `tests/scenarios/review-block.test.ts` keeps it out of an untagged repair narration."
---

# T0-REPAIR-CHECK

## Deliverable
One constant in `src/loop/card-runner.ts`, added to the REVIEW_FIX narration:

> Before adding code, check whether removing the code the finding names fixes the defect at every site, and remove it if so. After the repair, read the repair hunks again for what they newly break: most later findings sit on or next to those lines.

## Why
113 repairs of a decision 1 block went back to R3 and 70 were blocked again (62%). 85 of 122 locatable later findings sit on or within 8 lines of the repair hunk. Lessons T1-EFF-HOOK-QUIET-2, T0-REVIEW-RELEASE and T1-INIT-HOOK-PATH-2 each record a removal closing what repeated fixes did not.

Directive text reaches the main thread and the implementer alike.

Raising repair effort was dropped. Attempt records say `medium`, but that value reaches a model only when a coordinator passes it to an implementer: one of 27 implementer calls did. Of 131 repairs, 11 can be traced to an actor, all 11 in the main thread at the session's effort, and 6 of those were blocked again.

## Limits
The traced sample is small and no run varied effort on purpose. No gate checks the sentence. It lands inside the T0-R2-OFF check window, so a change in the rate cannot be credited to this card alone.

## Review after 15 cards
Count decision 1 blocks that went back to R3 and how many were blocked again. Baseline 70 of 113. Target under 45%. If the rate has not fallen, remove the constant.

## Attempt evidence
- RED on c65735d, with the code of main: the first acceptance 1 test fails on the count (expected 2, actual 1) and the order test on `repairText.endsWith`. The acceptance 2 test passes on main, since it pins what main does.
- Seven hand mutants of the narration each fail a test of this file: no text, text after the class list, text before the dispute hint, text twice, no space before the text, attempt plus one, effort raised to high.
