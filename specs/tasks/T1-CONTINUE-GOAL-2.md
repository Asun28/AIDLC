---
id: T1-CONTINUE-GOAL-2
title: "The controller continues a card on a goal stopped for the card's stop and re-admits the goal with an event that carries the continuation (replaces T1-CONTINUE-GOAL: carries its controller code and states what a failure after the runner's write leaves)"
status: todo
branch: T1-CONTINUE-GOAL-2
worktree: D:\wt\AIDLC\T1-CONTINUE-GOAL-2
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/card-continue-goal.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CONTINUE-GOAL-2.md
  - specs/tasks/T1-CONTINUE-GOAL-2.md
dod_command: npm run typecheck && node --test tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/audit.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The method `GoalController.continueCard(runner, goalId, card, act)` shall refuse, before it reads the card run, a goal for which `terminalGoalRefusal(goal, 'continue')` returns a refusal, a `by` or a `reason` that is blank after trimming, and a `decisions` that is given and is not a whole number from 1 to 4.
  - R2. WHEN no refusal of R1 holds and the call is not the rerun of R5, the method shall call `runner.continueStop(goal, card, act)` once.
  - R3. IF a refusal of R1 holds or `runner.continueStop` throws before its write (the card has no run, or the pure rule refuses the run or the act), THEN the method shall throw with the cause and leave the goal record, the card-run record and the journal as they were.
  - R4. WHEN the act lifted the card's stop and the goal is in STOP, terminal, with the stop reason of the lifted stop and in the generation the method read, the method shall, in one section of the goal lock, append one `GOAL_STATE` event with `from` STOP, `to` CARDS and `continuation` (`cardId`, `by`) and write the goal with `terminal` false, no `stop` and state CARDS.
  - R5. WHEN the method is called on a run that is not in STOP and whose last continuation lifted a stop of the goal's stop reason while the goal is still in STOP for it, the method shall record no second continuation and complete the re-admission with the `by` of the recorded one, appending the event only when none with `continuation` follows the goal's last `GOAL_STOPPED`.
  - R6. WHEN a write or an append fails after the runner's write (the delivery of an event the run owes, the `GOAL_STATE` append or the goal write), the method shall throw with the cause and undo nothing, so that the continuation stays recorded, an event that was not appended stays owed for the next `aidlc card next`, and a later call completes the re-admission by R5.
  - R7. The method shall return the run, the goal, whether this call recorded a continuation and whether the goal was re-admitted.
  - R8. The file `docs/ARCHITECTURE.md` shall state R1 to R7; `changelog.d/T1-CONTINUE-GOAL-2.md` says in one entry what the method does and that the command arrives with T1-CONTINUE-COMMAND.
acceptance:
  - 1. `tests/scenarios/card-continue-goal.test.ts`, a one-card goal whose card a command reviewer stopped on R3 decision 4 and which `aidlc next` then stopped for review. `continueCard` returns with a recorded continuation and a re-admitted goal; the run holds the continuation and no stop; the goal is in CARDS, not terminal, with no stop; the journal holds exactly one `GOAL_STATE` from STOP to CARDS whose `continuation` names the card and `by`; `aidlc next` then returns a `wait` on the card, and `aidlc card next` returns a directive of kind `build`. [R2] [R4] [R7] [dod arm 2]
  - 2. Same file. After `aidlc card next` started the repair attempt, `aidlc audit verify` reports no `WORK_AFTER_TERMINAL`. [R4] [dod arm 2]
  - 3. Same file. With the goal write failing once after the card's stop was lifted, the call throws with the cause, the run holds the continuation and the goal stays in STOP; the next call records no second continuation, leaves exactly one `GOAL_STATE` event with `continuation` in the journal and re-admits the goal. [R5] [R6] [dod arm 2]
  - 4. Same file. With the append of the continuation's `CARD_STATE` event failing once, the call throws with the cause, the run holds the continuation and owes the event, the journal holds no `CARD_STATE` event with `continuation`, and the goal stays in STOP; the next call re-admits the goal and records no second continuation, and one `aidlc card next` then leaves exactly one such event in the journal. [R5] [R6] [dod arm 2]
  - 5. Same file, one row per refusal, each throwing with its cause and leaving the goal file, the card-run file where one exists and the journal byte-identical: a goal stopped for `time`, a DONE goal, a card with no run, a run in BUILD on a goal that is not stopped, a blank `by`, a blank `reason`, `decisions` 0, 5 and 1.5. The rows for a blank `by`, a blank `reason` and `decisions` 0 are repeated on a goal that a failed re-admission left in STOP. [R1] [R3] [dod arm 2]
  - 6. Same file. On a two-card goal that is not stopped the call lifts the card's stop and appends no `GOAL_STATE` event; on a goal stopped for `review` whose card run was continued for a stop of reason `ci` (a record written by the test), the call throws with the runner's cause and re-admits nothing. [R4] [R5] [dod arm 2]
  - 7. `tests/scenarios/card-continue.test.ts`, `review-rule-goal.test.ts` and `audit.test.ts` pass with no line changed, and `npm run build && npm run bench -- --check` exits 0. [dod arm 1] [dod arm 2] [dod arm 3]
  - 8. Each of the two texts holds what R8 assigns to it and no more is required of it (reviewer-verified against the diff). [R8]
depends_on: [T1-CONTINUE-REVIEW-2, T1-CONTINUE-AUDIT]
budget: 240
sweep: "On main at 74831913. src/loop/controller.ts:984-1017 (`ruleFinding`) holds the goal re-admission this card follows; its goal-lock section is the one to share, as the branch T1-CONTINUE-GOAL does with a private `readmitAfterLift` that takes the stop reason and the event key. :405-408 is where `aidlc next` stops the goal with the reason of its stopped card. `CardRunner.continueStop` (src/loop/card-runner.ts) writes the run in one locked update and then delivers the events the run owes, so it throws either before its write or after it. `terminalGoalRefusal(goal, 'continue')` is src/core/card-goal.ts. The audit rule for `continuation` is src/audit/verifier.ts."
forbid: [weakening or skipping a test to go green, a re-admission of a goal stopped for a reason other than that of the lifted stop, restoring or rewriting a card-run record after the runner's write, moving a deadline, a change to `CardRunner.continueStop`, to `terminalGoalRefusal` or to the verifier, editing .aidlc state by hand]
non_goals: [the command line and its output (T1-CONTINUE-COMMAND), the runner's act for a ci stop (T1-CONTINUE-CI), a rollback of a recorded continuation, a check that the continuation came after the goal's current stop (a follow-up issue, the same as for `ruleFinding`), a new journal event type, a check of the owner's delegation]
hygiene: "Carries the controller code of the branch T1-CONTINUE-GOAL at 3c6a1a2b (`continueCard`, the shared goal-lock section, the act checks before the rerun), without its `catch` around `runner.continueStop`: this card neither swallows nor rolls back a failure after the runner's write. Why the card was replaced: its R3 said that a throw of the runner leaves every record as it was. R3 decision 1 found the rerun skipping the act checks (repaired) and the throw after the write (F2). Decision 2 refused an exit 0 with the event owed. Decision 3 refused the restore of the run record: older owed events stay appended, a concurrent command's record can be mistaken for this call's, and the old revision is reused. No code meets that R3, so R3 and R6 of this card say what the protocol does. Line numbers are from main at 74831913; read them again at PREPARE. Run every test file that reads docs/ARCHITECTURE.md before the attempt is recorded."
doc_sync: docs/ARCHITECTURE.md
---

# T1-CONTINUE-GOAL-2

## Deliverable
`GoalController.continueCard`: the continuation of a card on a goal that `aidlc next` stopped for the card's stop, with the goal back in progress under the same recorded authority.

## Why
`specs/card-continuation.md`, R5 and R6. `aidlc next` stops the goal with the stop reason of its stopped card, so the act that lifts the card's stop must put the goal back in progress.

This card replaces T1-CONTINUE-GOAL for a defect of that card's contract. It promised that a failure of the runner leaves every record as it was. The runner writes the run first and appends its journal events after, as every card-run write does, so a failed append comes after the write, and neither an append nor a concurrent reader can be undone. This card states the two cases apart: a refusal writes nothing, and a failure after the write keeps what was written and is completed by the next command.

## Rules that decide edge cases
- A refusal is decided before the runner's write and leaves every record as it was.
- After the runner's write nothing is undone: the next `aidlc card next` delivers an owed event, and the next call of the method completes the re-admission.
- The goal is re-admitted only for the stop reason of the stop the act lifted, in the same generation.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/audit.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the four files passes, the build succeeds and every benchmark count is within its ceiling.

## Attempt evidence
Build attempt 1. RED `b819dac2` (`acceptance 1 and 2: ...`: `fx.controller.continueCard is not a function`, all 5 tests).

| Item | Proof in `tests/scenarios/card-continue-goal.test.ts` | Result |
|---|---|---|
| 1 | `acceptance 1 and 2`: returned flags, run, goal, the one `GOAL_STATE` data, `wait` on `T1-CG:BUILD`, `card next` `build` | pass |
| 2 | same test: `verifyAudit` `WORK_AFTER_TERMINAL` is `[]` after the repair attempt | pass |
| 3 | `acceptance 3`: append and goal-write rows, `EIO: injected`, then `continued: false`, one continuation event | pass |
| 4 | `acceptance 4`: `EIO: injected`, owed data, no `CARD_STATE` with continuation, goal STOP; rerun; `card next` leaves one | pass |
| 5 | `acceptance 5`: 9 rows plus 5 after a failed re-admission (decisions 5 and 1.5 added for G4c, G4a) | pass |
| 6 | `acceptance 6`: two-card goal; review goal with a ci continuation throws the runner's cause; ci goal not re-admitted | pass |
| 7 | DoD: the three files unchanged, build and bench exit 0 | pass |
| 8 | docs/ARCHITECTURE.md `GoalController.continueCard` entry (R1 to R7), `changelog.d/T1-CONTINUE-GOAL-2.md` | reviewer |

Guard sweep (each loosened, this file and `review-rule-goal` run, restored):
- G1 `terminalGoalRefusal` throw removed, G2 blank `by`, G3 blank `reason`, G4a `Number.isInteger`, G4b `>= 1`, G4c `<= MAX_R3_DECISIONS` dropped: acceptance 5 fails.
- G5 `before.state !== 'STOP'` dropped: acceptance 1 (second continuation) fails. G6 `last.stop.reason === reason` dropped: acceptance 6 fails.
- G8 section `current.stop?.reason !== reason` dropped: acceptance 6 and `review-rule-goal` fail. G9 scan `e.data[key]` to `true`: acceptance 3 fails.
- equivalent: G7 `if (!reason) return` removed: on a goal not in STOP the section returns the goal unchanged and `readmitted` false, the same records and flags.
