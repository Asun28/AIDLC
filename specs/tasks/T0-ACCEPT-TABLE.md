---
id: T0-ACCEPT-TABLE
title: The build and repair directives ask for a table in the card's Attempt evidence section, one row per acceptance item, which no code reads
status: merged
branch: T0-ACCEPT-TABLE
worktree: D:\wt\AIDLC\T0-ACCEPT-TABLE
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/accept-table.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-ACCEPT-TABLE.md
dod_command: npm run typecheck && node --test tests/scenarios/accept-table.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts
dod_exit: 0
requirements:
  - R1. Both narrations of `CardRunner.build` and the REVIEW_FIX narration shall carry the `ACCEPTANCE_TABLE` text.
  - R2. No code shall read the table: no parser, gate, schema field or persisted record.
  - R3. `docs/OPERATIONS.md` and the CHANGELOG Unreleased section shall state the rule and name this card.
acceptance:
  - 1. `tests/scenarios/accept-table.test.ts`: the directive of a build before RED, of a build with a RED receipt and of an R3 repair each contains `ACCEPTANCE_TABLE` once; the test fails on main. [R1] [dod arm 2]
  - 2. `tests/scenarios/t0-flow.test.ts` and `tests/scenarios/review-block.test.ts` pass unchanged. [R1] [dod arm 2]
  - 3. `src/loop/card-runner.ts` is the only changed file under `src/`, and its diff reads no card section (reviewer-verified against the diff). [R2]
  - 4. The OPERATIONS and CHANGELOG text (reviewer-verified against the diff). [R3]
depends_on: [T0-REPAIR-CHECK]
budget: 100
tdd: true
forbid:
  - a parser, gate, schema field or persisted record for the table
  - weakening or skipping a test
non_goals:
  - JUnit or test-report parsing
  - backfilling the table into merged cards
hygiene: "`card-runner.ts` is covered by the verify-card-run-writes skill: run its check before SHIP. Put `ACCEPTANCE_TABLE` before the defect class list, which `tests/scenarios/review-block.test.ts` keeps last."
---

# T0-ACCEPT-TABLE

## Deliverable
One constant in `src/loop/card-runner.ts`, added to the narrations of R1:

> When allow_paths lists this card file, write a table in its `## Attempt evidence` section before the final DoD run, one row per acceptance item: the item number, the test or command that proves it, and its result. A row with no proof is unfinished work. Correct the table on every repair.

## Why
Findings citing an acceptance item or requirement are 24% of 483 R3 findings, and 20% of 93 since 2026-10-24. In a sample of 10 from October on, about 4 were catchable by the author walking the list and about 6 were real edge bugs, so the expected reach is 8 to 10% of R3 findings.

Lesson T1-VERIFY-FAULT-POINTS puts this evidence in the card file because R3 reads the diff. 34 cards already have the section, and the last 60 cards all list their own file in `allow_paths`.

## Limits
The table is self-attested. A wrong row is a real finding, and a reviewer may trust a row it should check. It lands inside the T0-R2-OFF check window, so a change cannot be credited to this card alone.

## Review after 15 cards
Share of R3 findings citing an acceptance item or requirement. Baseline 20%. Keep the text if the share falls below 15%; otherwise remove it.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/accept-table.test.ts`, one test per directive. RED on 139f78f: 3 of 3 failed on the count of the text (expected 2 parts, actual 1) | pass |
| 2 | `tests/scenarios/t0-flow.test.ts`, `tests/scenarios/review-block.test.ts`, neither file changed | pass |
| 3 | `git diff --stat origin/main...HEAD -- src` lists `src/loop/card-runner.ts` only: one constant and three interpolations | reviewer reads the diff |
| 4 | `docs/OPERATIONS.md`, paragraph "Acceptance table"; `CHANGELOG.md`, entry T0-ACCEPT-TABLE | reviewer reads the diff |

Placement: `tests/scenarios/repair-check.test.ts` pins the text on both sides of `REPAIR_CHECK`, so in the repair narration the table text sits before `Rerun the DoD`. That test passes.

Other checks: `node --test tests/scenarios/fault-points.test.ts` (the verify-card-run-writes check) passes. `npm test` gave 2362 passed, 1 failed, 10 skipped: `tests/surface/templates.test.ts` slices the Unreleased section at the next `## `, and the first CHANGELOG wording held one. The entry was reworded, no test changed, and that file now passes.
