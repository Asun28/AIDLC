---
id: T0-R3-SECOND-PASS-ROOM
title: No second R3 pass is due after a first pass at decision 3, where its block could only stop the card
status: merged
branch: T0-R3-SECOND-PASS-ROOM
worktree: D:\wt\AIDLC\T0-R3-SECOND-PASS-ROOM
plan_ref: plans/review-convergence.md#order-of-work
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/second-pass.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-R3-SECOND-PASS-ROOM.md
dod_command: npm run typecheck && node --test tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `formalReview.secondPass` is true, the last decided R3 invocation on the current candidate is a first pass and the run has `MAX_R3_DECISIONS - 1` or more decisions recorded, THEN `secondPassDue` shall return false and `formalReviewGate` shall admit the ship.
  - R2. WHEN fewer than `MAX_R3_DECISIONS - 1` decisions are recorded, the second pass shall be due and shall block as it does on main at bcdc0665.
  - R3. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state R1 and its reason with the figures of `specs/review-convergence.md` (7 second passes ran after a first pass at decision 3; 3 blocked and each stopped the card).
acceptance:
  - 1. `tests/scenarios/second-pass.test.ts`: with the option on, a run that blocks at decisions 1 and 2 and passes at decision 3 gets a ship directive from `card next`, no invocation of the run has `secondPass`, and `substantiveDecisions` is 3. [R1] [dod arm 1]
  - 2. Same file: a run that blocks at decision 1 and passes at decision 2 gets the second-pass directive; a block from that second pass is decision 3, returns REVIEW_FIX, and a pass at decision 4 ships. [R2] [dod arm 1]
  - 3. Same file: the tests of T1-R3-SECOND-PASS for a first pass at decision 1, at decision 2 and at decision 4 pass unchanged. [R2] [dod arm 1]
  - 4. `tests/scenarios/fault-points.test.ts` passes with no pin added. At CLOSE, `.claude/skills/verify-card-run-writes/SKILL.md` moves its sync commit to the merge commit on main. [dod arm 2]
  - 5. The three documents state R1 with the figures (reviewer-verified against the diff). [R3]
budget: 80
sweep: "git grep -n 'secondPassDue\\|MAX_R3_DECISIONS' -- src/loop/card-runner.ts on main at bcdc0665: the condition is `secondPassDue` :1647; its callers :1509 (`formalAllowance`), :1531, :1576, :1820 and :1891 read the result and need no change, since a second pass that is not due is the case they already handle after a first pass at decision 4."
forbid: [weakening or skipping a test to go green, a change to `src/core/review-policy.ts` or to `MAX_R3_DECISIONS`, editing .aidlc state by hand]
non_goals: [an advisory second pass, a second pass on the ship-path reviewer, a change to what the second pass sends, a change to the configuration files (the option keeps its values), a rerun of the replay]
hygiene: "Line numbers are from main at bcdc0665; read them again at PREPARE. This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE. The existing test of a first pass at decision 4 already holds, so the RED is acceptance 1 alone."
doc_sync: docs/OPERATIONS.md (Second pass), docs/ARCHITECTURE.md (`CardRunner.secondPassDue`), CHANGELOG.md
---

# T0-R3-SECOND-PASS-ROOM

## Deliverable
A candidate that first passes R3 at decision 3 goes to the ship. The second pass runs only where a block from it leaves a decision for the repaired candidate.

## Why
A second-pass block spends a decision. After a first pass at decision 3 that block is decision 4, and a block at decision 4 stops the card for a ruling. Between 2026-10-22 and 2026-11-11, 7 second passes ran in that position: 4 passed and 3 blocked (T0-CARD-LEASE-HEARTBEAT, T1-OUTCOME-USAGE, T1-OUTCOME-GITHUB). Each of the 3 needed the owner's ruling and a successor card. The loop already skips the second pass after a first pass at decision 4 for the same reason. Owner's decision of 2026-11-11: `intent/review-convergence.md`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the fault-point check adds no pin.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/second-pass.test.ts`, "T0-R3-SECOND-PASS-ROOM acceptance 1: a first pass at decision 3 ships with no second pass [R1]" | pass (failed at RED) |
| 2 | Same file, "T0-R3-SECOND-PASS-ROOM acceptance 2: a first pass at decision 2 gets its second pass, whose block is decision 3 and returns REVIEW_FIX, and a pass at decision 4 ships [R2]" | pass (passed at RED too: the rule it states is unchanged) |
| 3 | Same file, the 16 T1-R3-SECOND-PASS tests, with no line of them changed (`git diff main -- tests/scenarios/second-pass.test.ts` only adds the two tests above) | pass; first pass at decision 1, at decision 2 and at decision 4 included |
| 4 | `node --test tests/scenarios/fault-points.test.ts`, no pin added (the file is unchanged) | pass; the sync commit of `.claude/skills/verify-card-run-writes/SKILL.md` moves at CLOSE |
| 5 | `docs/OPERATIONS.md` (Second pass), `docs/ARCHITECTURE.md` (`CardRunner.secondPassDue`), `CHANGELOG.md` (Unreleased): each states the rule, its reason and the figures (7 ran, 4 passed, 3 blocked and stopped their cards) | for the reviewer to verify against the diff |

DoD: `npm run typecheck && node --test tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts` exits 0: 46 tests, 46 pass, 0 fail, 0 skipped.

RED: commit afb0ffad. The acceptance 1 test failed on its assertion "the candidate goes to the ship": expected `'close'`, actual `'review'` (`card next` directed the second pass). 17 of 18 tests passed, the acceptance 2 test among them.

Mutants, each run in the working tree and restored, none committed:
- `>= MAX_R3_DECISIONS` (the rule before this card): the acceptance 1 test of this card fails.
- `>= MAX_R3_DECISIONS - 2`: three tests fail: "T1-R3-SECOND-PASS acceptance 4: a first pass at decision 2 gets its second pass and no STOP", "T1-R3-SECOND-PASS acceptance 2: the second pass sends no delta, though the pass before it did" and the acceptance 2 test of this card.

Callers read again (`formalAllowance`, `formalReviewGate`, `formalAdmission`, the two reads in `formalReview`): none needed a change. After a first pass at decision 3 that is not due, each takes the branch it takes after a first pass at decision 4.

No existing test was changed. The doc sentences changed are pinned by no test; 9 files under `tests/surface/` that read the documents pass (97 tests).
