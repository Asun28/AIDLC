---
id: T1-CONTINUE-REVIEW-2
title: "The runner lifts a review stop on the same card in one locked update, and the gate, the admission, the assessment and the second pass read the count the continuation admits (replaces T1-CONTINUE-REVIEW: carries its first candidate e28b2aef, states what `card next` returns in REVIEW_FIX, and raises the cli.start module ceiling of the loop benchmark)"
status: todo
branch: T1-CONTINUE-REVIEW-2
worktree: D:\wt\AIDLC\T1-CONTINUE-REVIEW-2
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/card-continue.test.ts
  - bench/baseline.json
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CONTINUE-REVIEW.md
  - changelog.d/T1-CONTINUE-REVIEW-2.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T1-CONTINUE-REVIEW-2.md
dod_command: npm run typecheck && node --test tests/scenarios/card-continue.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/review-block.test.ts tests/scenarios/fault-points.test.ts tests/surface/templates.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. WHEN `CardRunner.continueStop(goal, card, act)` is called on a run in STOP with stop reason `review`, the runner shall apply `continueReviewStop` to the record read inside the card-run lock and write in that one update the continuation, the lifted ledger, no `stop`, no `blocker` and the state BUILD, from which `selectCardState` selects the next state as it does after `aidlc goal extend`.
  - R2. The update shall leave `review.substantiveDecisions`, `substantiveBlocks`, `noVerdictRetriesUsed` and `scriptCounter`, `findings`, the `outcome` of every invocation, `effort`, `ci`, `candidate`, `dodReceipt`, `redReceipt`, `blockedReceipt` and `deadline` as they were.
  - R3. The update shall owe one `CARD_STATE` event whose persisted data holds `from` STOP, `to` `readmitted` and `continuation` (`by`, `reason`, `stop`, `decisions`, `admits`), which the runner appends after the write and the next `aidlc card next` delivers once when that append failed.
  - R4. WHILE `admittedDecisions` of the run is a number, `formalAllowance`, the `reviewExhausted` evidence, `secondPassDue`, the decision limit that the review directive and the reviewer prompt name, and the count `formalReview` gives `recordReviewOutcome` shall each use it in place of `MAX_R3_DECISIONS` and `MAX_SUBSTANTIVE_REVIEW_DECISIONS`.
  - R5. WHILE `admittedDecisions` of the run is a number, the gate's stop detail and the admission's refusal shall name the continuation and its count where they name the two-decision or the 4-decision allowance.
  - R6. IF `continueReviewStop` throws or the card has no run in the goal, THEN the runner shall write nothing and append nothing.
  - R7. WHEN `aidlc card next` runs on a continued run whose blocking decision is on the current candidate, the runner shall return what it returns for any run in REVIEW_FIX, the `build` directive of the repair attempt, with a narration that names the decisions left under the admitted count.
  - R8. The file `bench/baseline.json` shall hold, as the `modules` ceiling of the journey `cli.start`, the count the built CLI loads with this card, with no other number of the file changed.
  - R9. The files `docs/ARCHITECTURE.md` and `changelog.d/T1-CONTINUE-REVIEW-2.md` shall state R1 to R7, say that the command arrives with T1-CONTINUE-GOAL, and give the reason for the ceiling of R8.
acceptance:
  - 1. `tests/scenarios/card-continue.test.ts`, a run that a command reviewer stopped with a block on R3 decision 4. `continueStop` with no `decisions` leaves the run with no stop, one continuation with `admits` 5 and `stopLifted` on the stopping decision; each field of R2 is deep-equal to its value before. [R1] [R2] [dod arm 2]
  - 2. Same file. `aidlc card next` then selects REVIEW_FIX and returns the `build` directive of the repair attempt, whose narration names 1 substantive decision left; after a repair attempt with a new candidate it returns a `review` directive for decision 5 of 5; a pass ships the candidate through the dry-run path with no second pass while `formalReview.secondPass` is on. [R4] [R7] [dod arm 2]
  - 3. Same file, second row. Decision 5 blocks: the run is in STOP for review with a detail that holds `continuation` and `5`. On a run whose last admitted decision passed, a formal review of a further candidate is refused with a message that names the continuation's admitted count. [R4] [R5] [dod arm 2]
  - 4. Same file. A run stopped on decision 2 by the re-raise of a disputed finding and continued with `decisions` 1 is admitted decision 3, and a block on decision 3 that re-raises nothing stops the run for review. [R4] [dod arm 2]
  - 5. Same file. A run the gate stopped with no decision left (decision 1 a block, decision 2 a pass, then a CI code defect and a repaired candidate): the gate's stop detail before the act names the two-decision allowance, and after `continueStop` the next `aidlc card next` returns a `review` directive for decision 3 of 3. [R4] [R5] [dod arm 2]
  - 6. Same file. The journal gains exactly one `CARD_STATE` event whose data holds `from` STOP, `to` `readmitted` and the continuation. Fault rows: a throw from `fs.renameSync` onto the card-run record leaves the card-run file and the journal byte-identical; a throw from `fs.appendFileSync` onto the goal journal leaves the continuation in the run, and after one `aidlc card next` the journal holds exactly one such event. [R3] [dod arm 2]
  - 7. Same file. A run in BUILD, a run stopped for `ci`, a run under a ship-path reviewer and a card with no run each throw with their cause and leave the card-run file, where one exists, and the journal byte-identical. [R6] [dod arm 2]
  - 8. `tests/scenarios/review-rule.test.ts`, `review-rule-ship.test.ts`, `second-pass.test.ts`, `review-block.test.ts` and `fault-points.test.ts` pass with no line changed. The record of `.claude/skills/verify-card-run-writes/SKILL.md` names `CardRunner.continueStop` among the commands the check does not drive, with `tests/scenarios/card-continue.test.ts`, and the file stays within 8000 bytes (`tests/surface/templates.test.ts`). [dod arm 1] [dod arm 2]
  - 9. `npm run build && npm run bench -- --check` exits 0 with every count within its ceiling, and `git diff origin/main -- bench/baseline.json` changes the `modules` ceiling of `cli.start` and nothing else. [R8] [dod arm 3]
  - 10. The docs and the changelog fragment state R1 to R7 and the reason of R8 (reviewer-verified against the diff). [R9]
depends_on: [T1-CONTINUE-CORE, T1-OWED-EVENT-TYPES]
budget: 250
sweep: "On main at 212ff184, git grep -n 'MAX_R3_DECISIONS\\|MAX_SUBSTANTIVE_REVIEW_DECISIONS' -- src. Readers this card changes, all in src/loop/card-runner.ts: :857 (the reviewExhausted evidence), :1797 to :1801 (formalAllowance), :1864 (the gate's stop detail), :1944 (secondPassDue), :2086 (the admission's refusal); :2201 (the decision limit of the reviewer prompt) is overwritten by formalAllowance inside the lock before the prompt is built. Callers of recordReviewOutcome: :2593 (formalReview) gives the count; :3018 (the ship-path reviewer) does not. Not sites of this card: :1933 (baseSyncDue), :3032 (the ship-path reviewer), src/state/bounds.ts:46, src/review/bench.ts. The REVIEW_FIX case of `CardRunner.next` (:993 to :1042) returns the `build` directive and is not changed. `npm run bench -- --check` on main: cli.start modules 253 against the ceiling 241, whose slack and allowance admit 253; card-runner.ts importing src/core/continuation.ts makes 254."
forbid: [weakening or skipping a test to go green, changing a review counter or an allowance constant, moving a deadline, a change to any number of bench/baseline.json other than the `modules` ceiling of `cli.start`, a change to tests/scenarios/fault-points.test.ts or tests/scenarios/journal-owed.test.ts, a change to REVIEW.md, editing .aidlc state by hand]
non_goals: [a command and a goal that is stopped (T1-CONTINUE-GOAL), a ci stop (T1-CONTINUE-CI), a review stop after a missing verdict or under a ship-path reviewer (the pure rule refuses them), a `review-fix` directive from `aidlc card next` after a continuation (the candidate b6101a18 of T1-CONTINUE-REVIEW added one to meet a wrong acceptance item and it is not carried), a second pass or a base-sync decision outside the count, the continuation among the commands tests/scenarios/fault-points.test.ts drives, a change to `card-loop.md`]
hygiene: "Carries commit e28b2aef, the first candidate of T1-CONTINUE-REVIEW, which holds the RED commit 048dbb5f. Why the card was replaced: its acceptance 2 named a `review-fix` directive that the REVIEW_FIX case does not return (R3 decision 1, F1), and after R3 passed the repaired candidate the `bench` job of CI failed on `cli.start modules 254` in a file the card could not change, which stopped the run for ci (PR 405, closed). Restore specs/tasks/T1-CONTINUE-REVIEW.md to its text on main, so the diff does not carry the old card's evidence table, and move the changelog fragment to this card's name. Keep the edit of the skill record to the lines it must change: the carried one rewraps 11 lines. The carried diff is about 245 changed lines. Run `npm run bench -- --check` before the first review (docs/OPERATIONS.md, Loop benchmark). This card changes a file the verify-card-run-writes coverage record names, so that skill runs before SHIP and at CLOSE."
doc_sync: docs/ARCHITECTURE.md
---

# T1-CONTINUE-REVIEW-2

## Deliverable
`CardRunner.continueStop` puts a run that R3 stopped back in progress on the same card, and every rule that reads the review allowance reads the count the continuation admits.

## Why
`specs/card-continuation.md`, R1 to R5. After a lift by ruling the run admits no further decision: the gate and the admission both read `formalAllowance`. The continuation changes what they compare with, and nothing else.

This card replaces T1-CONTINUE-REVIEW for two defects of that card, not of its code. Its acceptance 2 named a directive kind the loop does not return in REVIEW_FIX. Its allow_paths left out `bench/baseline.json`, and main already used the whole allowance of the `cli.start` module ceiling, so one more imported module failed the `bench` job after R3 had passed. No command lifts a ci stop on the same card until T1-CONTINUE-CI of this goal.

## Rules that decide edge cases
- The count replaces both allowances from the act on, also when it is below 4.
- The re-raise stop and the one base-sync decision are as before.
- The act writes no state of its own choice: after it `selectCardState` selects REVIEW_FIX, BUILD or SHIP from the evidence, and each state returns the directive it returns today.
- The ceiling moves to the measured count and no further.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-continue.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/review-block.test.ts tests/scenarios/fault-points.test.ts tests/surface/templates.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the seven files passes, the build succeeds and every benchmark count is within its ceiling.
