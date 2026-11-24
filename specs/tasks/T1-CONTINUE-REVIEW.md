---
id: T1-CONTINUE-REVIEW
title: "The runner lifts a review stop on the same card in one locked update, and the gate, the admission, the assessment and the second pass read the count the continuation admits"
status: todo
branch: T1-CONTINUE-REVIEW
worktree: D:\wt\AIDLC\T1-CONTINUE-REVIEW
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/card-continue.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CONTINUE-REVIEW.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T1-CONTINUE-REVIEW.md
dod_command: npm run typecheck && node --test tests/scenarios/card-continue.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/review-block.test.ts tests/scenarios/fault-points.test.ts tests/surface/templates.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. WHEN `CardRunner.continueStop(goal, card, act)` is called on a run in STOP with stop reason `review`, the runner shall apply `continueReviewStop` to the record read inside the card-run lock and write in that one update the continuation, the lifted ledger, no `stop`, no `blocker` and the state BUILD, from which `selectCardState` selects the next state as it does after `aidlc goal extend`.
  - R2. The update shall leave `review.substantiveDecisions`, `substantiveBlocks`, `noVerdictRetriesUsed` and `scriptCounter`, `findings`, the `outcome` of every invocation, `effort`, `ci`, `candidate`, `dodReceipt`, `redReceipt`, `blockedReceipt` and `deadline` as they were.
  - R3. The update shall owe one `CARD_STATE` event whose persisted data holds `from` STOP, `to` `readmitted` and `continuation` (`by`, `reason`, `stop`, `decisions`, `admits`), which the runner appends after the write and the next `aidlc card next` delivers once when that append failed.
  - R4. WHILE `admittedDecisions` of the run is a number, `formalAllowance`, the `reviewExhausted` evidence, `secondPassDue`, the decision limit that the review directive and the reviewer prompt name, and the count `formalReview` gives `recordReviewOutcome` shall each use it in place of `MAX_R3_DECISIONS` and `MAX_SUBSTANTIVE_REVIEW_DECISIONS`.
  - R5. WHILE `admittedDecisions` of the run is a number, the gate's stop detail and the admission's refusal shall name the continuation and its count where they name the two-decision or the 4-decision allowance.
  - R6. IF `continueReviewStop` throws or the card has no run in the goal, THEN the runner shall write nothing and append nothing.
  - R7. The files `docs/ARCHITECTURE.md` and `changelog.d/T1-CONTINUE-REVIEW.md` shall state R1 to R6 and say that the command arrives with T1-CONTINUE-GOAL.
acceptance:
  - 1. `tests/scenarios/card-continue.test.ts`, a run that a command reviewer stopped with a block on R3 decision 4. `continueStop` with no `decisions` leaves the run with no stop, one continuation with `admits` 5 and `stopLifted` on the stopping decision; each field of R2 is deep-equal to its value before. [R1] [R2] [dod arm 2]
  - 2. Same file. `aidlc card next` then returns `review-fix` with `remainingDecisions` 1; after a repair attempt with a new candidate it returns a `review` directive for decision 5 of 5; a pass ships the candidate through the dry-run path with no second pass while `formalReview.secondPass` is on. [R4] [dod arm 2]
  - 3. Same file, second row. Decision 5 blocks: the run is in STOP for review with a detail that holds `continuation` and `5`, and a formal review of a further candidate is refused with a message that names the continuation. [R4] [R5] [dod arm 2]
  - 4. Same file. A run stopped on decision 2 by the re-raise of a disputed finding and continued with `decisions` 1 is admitted decision 3; a block on decision 3 that re-raises nothing stops the run, and the admission refuses decision 4. [R4] [dod arm 2]
  - 5. Same file. A run the gate stopped with no decision left (decision 1 a block, decision 2 a pass, then a CI code defect and a repaired candidate): after `continueStop` the next `aidlc card next` returns a `review` directive for decision 3 of 3. [R4] [dod arm 2]
  - 6. Same file. The journal gains exactly one `CARD_STATE` event whose data holds `from` STOP, `to` `readmitted` and the continuation. Fault rows: a throw from `fs.renameSync` onto the card-run record leaves the card-run file and the journal byte-identical; a throw from `fs.appendFileSync` onto the goal journal leaves the continuation in the run, and after one `aidlc card next` the journal holds exactly one such event. [R3] [dod arm 2]
  - 7. Same file. A run in BUILD, a run stopped for `ci` and a card with no run each throw with their cause and leave the card-run file, where one exists, and the journal byte-identical. [R6] [dod arm 2]
  - 8. `tests/scenarios/review-rule.test.ts`, `review-rule-ship.test.ts`, `second-pass.test.ts`, `review-block.test.ts` and `fault-points.test.ts` pass with no line changed. The record of `.claude/skills/verify-card-run-writes/SKILL.md` names `CardRunner.continueStop` among the commands the check does not drive, with `tests/scenarios/card-continue.test.ts`, and the file stays within 8000 bytes (`tests/surface/templates.test.ts`). [dod arm 1] [dod arm 2]
  - 9. The docs state R1 to R6 (reviewer-verified against the diff). [R7]
depends_on: [T1-CONTINUE-CORE]
superseded_by: T1-CONTINUE-REVIEW-2
budget: 240
sweep: "git grep -n 'MAX_R3_DECISIONS\\|MAX_SUBSTANTIVE_REVIEW_DECISIONS' -- src on main at f51534d2. Readers this card changes, all in src/loop/card-runner.ts: :857 (the reviewExhausted evidence), :1797 to :1801 (formalAllowance), :1864 (the gate's stop detail), :1944 (secondPassDue), :2086 (the admission's refusal), :2201 (the decision limit of the reviewer prompt). Callers of recordReviewOutcome: :2593 (formalReview) takes the count; :3018 (the ship-path reviewer) does not. Not sites of this card: :1933 (baseSyncDue: the one base-sync decision stays outside the allowance), :3032 (the ship-path reviewer), src/state/bounds.ts:46, src/review/bench.ts:28 and :383."
forbid: [weakening or skipping a test to go green, changing a review counter or an allowance constant, moving a deadline, a change to tests/scenarios/fault-points.test.ts or tests/scenarios/journal-owed.test.ts, a change to REVIEW.md, editing .aidlc state by hand]
non_goals: [a command and a goal that is stopped (T1-CONTINUE-GOAL), a ci stop (T1-CONTINUE-CI), a review stop after a missing verdict or under a ship-path reviewer (the pure rule refuses them), a second pass or a base-sync decision outside the count, the continuation among the commands tests/scenarios/fault-points.test.ts drives (its fault rows are in its own test file, as for `ruleFinding`), a change to `card-loop.md`]
hygiene: "Line numbers are from main at f51534d2; read them again at PREPARE. Follow `CardRunner.ruleFinding` (src/loop/card-runner.ts:661-676) for the locked update and the owed event, and put the continuation in the persisted event data, not in `extra`, which is lost on recovery (docs/LESSONS.md, T0-REVIEW-CANDIDATE-PINS). The skill record has 6 bytes of room: shorten other words of its list to fit the new name. This card changes a file the verify-card-run-writes coverage record names, so that skill runs before SHIP and at CLOSE."
doc_sync: docs/ARCHITECTURE.md
---

# T1-CONTINUE-REVIEW

## Deliverable
`CardRunner.continueStop` puts a run that R3 stopped back in progress on the same card, and every rule that reads the review allowance reads the count the continuation admits.

## Why
`specs/card-continuation.md`, R1 to R5. After a lift by ruling the run admits no further decision: the gate and the admission both read `formalAllowance`. The continuation changes what they compare with, and nothing else.

## Rules that decide edge cases
- The count replaces both allowances from the act on, also when it is below 4.
- The re-raise stop and the one base-sync decision are as before.
- The act writes no state of its own choice: after it `selectCardState` selects REVIEW_FIX, BUILD or SHIP from the evidence.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-continue.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/review-block.test.ts tests/scenarios/fault-points.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck reports no error and every test of the seven files passes.
