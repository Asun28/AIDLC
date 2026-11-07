---
id: T1-R3-SECOND-PASS
title: After the first R3 pass of a card run, `formalReview.secondPass` runs one more R3 on the same candidate with matched rules, and a block from it is an R3 block
status: todo
branch: T1-R3-SECOND-PASS
worktree: D:\wt\AIDLC\T1-R3-SECOND-PASS
plan_ref: plans/second-r3-pass.md#order-of-work
allow_paths:
  - src/config.ts
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/review/stats.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - tests/scenarios/second-pass.test.ts
  - tests/surface/stats.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-R3-SECOND-PASS.md
dod_command: npm run typecheck && node --test tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts tests/surface/stats.test.ts
dod_exit: 0
requirements:
  - R1. `formalReview.secondPass` shall default to false in `src/config.ts`, be false in `templates/aidlc.config.json` and be true in this repository's `aidlc.config.json`.
  - R2. WHEN `secondPass` is true, `formalReview.command` is set, the last formal decision on the current candidate is `pass`, no decided invocation of the run has `secondPass`, and fewer than `MAX_R3_DECISIONS` decisions are recorded, THEN `formalReviewGate` shall return a `review` directive that names the second pass instead of admitting the ship.
  - R3. The dispatch of a second pass shall set `secondPass: true` on its invocation and in the persisted `REVIEW_DECIDED` data, shall send `matchedLessons` rules selected with `commitFiles` at the base, and shall send no delta and no advisory notes; the rest is the R3 dispatch.
  - R4. A pass of a second pass shall spend no decision and admit the ship; a block shall go through `recordReviewOutcome` as any R3 block; a run shall get at most one decided second pass, so a repaired candidate needs one R3 pass.
  - R5. While a second pass is due, `formalAllowance` shall return `MAX_R3_DECISIONS`; a no-verdict and a quota hold shall behave as on any R3 decision and leave the second pass due.
  - R6. `aidlc review stats` shall report second-pass decisions and blocks per card and in the totals.
  - R7. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state the option, the numbers of `specs/second-r3-pass.md` and a check after 15 cards; the existing Review after 15 cards check shall read second-pass findings separately.
acceptance:
  - 1. `tests/scenarios/second-pass.test.ts`: with the option off a first pass admits the ship and no invocation has `secondPass`; with it on the same pass returns a `review` directive, and the ship follows the second pass. [R1] [R2] [R4] [dod arm 1]
  - 2. Same file: the reviewer's prompt on the second pass holds the matched rule and the matched sentence, no delta section and no advisory notes, and the first pass holds the newest rules. [R3] [dod arm 1]
  - 3. Same file: a second-pass pass leaves `substantiveDecisions` unchanged; a blocking second pass raises `substantiveDecisions` and `substantiveBlocks`, returns REVIEW_FIX, and after a repair one R3 pass admits the ship with no third review. [R4] [dod arm 1]
  - 4. Same file: a first pass at decision 2 gets its second pass and no STOP; a first pass at decision 4 ships with no second pass. [R2] [R5] [dod arm 1]
  - 5. Same file: a no-verdict and a quota hold on the second pass leave it due, and the retry runs it. [R5] [dod arm 1]
  - 6. Same file: a failed `REVIEW_DECIDED` append on a second pass is made by the next `card next` with `secondPass: true`. [R3] [dod arm 1]
  - 7. Same file: `aidlc review stats` counts two second-pass decisions and one block on two runs, and a run with none shows 0. [R6] [dod arm 1]
  - 8. `tests/scenarios/fault-points.test.ts` passes with no pin added, and `.claude/skills/verify-card-run-writes/SKILL.md` moves its sync commit under its own rules. [dod arm 2]
  - 9. The docs and CHANGELOG state R1 to R6 (reviewer-verified against the diff). [R7]
depends_on: [T1-LESSON-MATCH]
budget: 420
sweep: "git grep -n \"outcome === 'pass'\" -- src/loop/card-runner.ts on main at 5f66da0: the gate :1475, the allowance :1457 and the same-candidate rule :1687 change or are read here. `shipDrift` :1321 needs no change: the gate admits a pass only when no second pass is due, and nothing makes one due afterwards on the same candidate. Not sites of this card: R2 :316, :390, :403, :1389, :1392 and :2350; withdraw :1089; base sync :1037 and :1583; the ship-path reviewer :2570 to :2774. `recordReviewOutcome` (src/core/review-policy.ts:146) already treats a repeated pass on a candidate as no new decision."
forbid: [weakening or skipping a test to go green, a change to `src/core/review-policy.ts`, changing what a first pass receives, editing .aidlc state by hand]
non_goals: [a second pass on the ship-path reviewer, a second pass by another model, skipping by card size, a third pass, the first pass using matched rules, a rerun of the replay, a change to `card-loop.md` (6488 of 6500 bytes), since the directive's narration carries the step]
hygiene: "Line numbers are from main at 5f66da0; read them again at PREPARE. `secondPass` goes in the persisted `event(...)` data of `commitFormalResult`, not in `extra`, which is lost on recovery (docs/LESSONS.md, T0-REVIEW-CANDIDATE-PINS). This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (Review, Review after 15 cards), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-R3-SECOND-PASS

## Deliverable
With the option on, a candidate that passes R3 for the first time in a run gets one more R3, with matched rules, before the ship.

## Why
The numbers are in `specs/second-r3-pass.md`. R2 is off, so R3 is the only review. A block already leads to a further R3 on the repair, so the second pass matters most for candidates that pass first time. A run gets one, so a card costs at most one extra review, about 1 to 2 minutes.

## Rules that decide edge cases
- The second pass runs on the candidate that passed, by the reviewer R3 resolves at that moment.
- It sees the whole diff with no delta and no advisory notes. Prior findings stay in the prompt, so a re-raise of a disputed finding is still detected.
- A first pass at decision 4 has no decision left for a block, so it ships with no second pass.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts tests/surface/stats.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the fault-point check adds no pin.
