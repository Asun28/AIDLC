---
id: T1-GOAL-OWED
title: "A goal write and its event survive a failure of either: a stop and every other change owe their event on the record, a re-admission journals first and its rerun appends no second event (issue 300, second of two cards)"
status: todo
branch: T1-GOAL-OWED
worktree: D:\wt\AIDLC\T1-GOAL-OWED
allow_paths:
  - src/core/types.ts
  - src/loop/controller.ts
  - tests/scenarios/goal-owed.test.ts
  - tests/scenarios/side-write-faults.test.ts
  - tests/surface/approver.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - changelog.d/T1-GOAL-OWED.md
  - specs/tasks/T1-GOAL-OWED.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/scenarios/goal-owed.test.ts tests/scenarios/goal-update.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/deadline.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/takeover-done-race.test.ts tests/scenarios/fault-points.test.ts tests/surface/verifier.test.ts tests/surface/changelog-fragments.test.ts tests/scenarios/side-write-faults.test.ts tests/surface/approver.test.ts tests/scenarios/extend-running-card.test.ts tests/core/owed-event.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. A goal write that is not a re-admission shall store the events it owes in `Goal.journalOwed`, each with a key, and append them, with that key as `eventKey`, in the same section after the record is written.
  - R2. A re-admission (a resume, an extension of a time stop, a ruling, a continuation) shall append its event before the record is written, and shall append none when the journal holds that event after the last `GOAL_STOPPED` or `GOAL_DONE`.
  - R3. WHEN a record owes an event the journal does not hold, THEN the next goal command that writes the goal, or `aidlc next` on it, shall append it once with `completed` true before any event of its own.
  - R4. WHEN one append or one write of the goal record fails in a command of R1 or R2, THEN the command shall exit non-zero, and the recovery shall leave the record and the goal events of the command run once with no failure, each event once: `aidlc next` once the requested change is in the record, whether or not an event is still owed and also when a later transition of the `next` that the command runs by itself fails, or when the failed command is `aidlc next`; otherwise the same command with its original input. When the recovery is `aidlc next`, its own derived writes count with the run with no failure: the record and the events are those of the command run once with no failure followed by that `aidlc next`.
  - R5. `aidlc audit verify` shall report no `WORK_AFTER_TERMINAL` and an intact chain after each failure and recovery of R4, where a failure is a throw before the append or the rename takes effect.
  - R6. `docs/ARCHITECTURE.md` (the goal record row, the goal writes) and `docs/OPERATIONS.md` (Goal writes) shall state R1 to R4.
acceptance:
  - 1. `tests/scenarios/goal-owed.test.ts`, the faults of `review-rule-goal.test.ts`: a throw from `fs.appendFileSync` onto the goal journal and, separately, from `fs.renameSync` onto the goal record, at each such call of: a cancellation, an extension of a running goal (also of a goal in WAIT whose card is merged), an extension of a time stop, a resume, a resume that carries a revision, a revision, an approval, a rejection, intent-accepted, plan-produced, plan-failed, cards-projected, card-result, arc-verified, arc-failed with a repair left and with none, release-result that leaves the goal, stops it and recovers it, and in `aidlc next` the transitions of T1-GOAL-UPDATE acceptance 3. A row with a resume that landed and whose derived stop then fails to be written (the case of tests/scenarios/deadline.test.ts:230) recovers by `aidlc next`, with one generation step and one `GOAL_TAKEOVER`. Each row names its recovery by R4. The command exits non-zero, and after the recovery the record and the events of types `GOAL_*`, `PLAN_*`, `CARDS_PROJECTED` and `AUTHORIZATION_GRANTED`, and the `NOTE` of an extension, with their data apart from `eventKey`, `completed` and times, equal those of a run with no fault (followed by `aidlc next` when the recovery is `aidlc next`, as R4 states), and no event of these occurs twice; `CARD_RESULT`, `CARD_STATE` and `RELEASE_STATE` events are not compared. RED on main, where a failed write after the append leaves the event and the rerun appends a second one. [R1] [R2] [R3] [R4] [dod arm 3]
  - 2. Same file. After each row the chain verifies and `aidlc audit verify` reports no `WORK_AFTER_TERMINAL`, also when a card is dispatched after the recovery. [R5] [dod arm 3]
  - 3. Same file. A record stored with no `journalOwed`, as main writes it, is read and written, and the first write over it appends only its own events. [R1] [dod arm 3]
  - 4. Every other file of the DoD passes with no line changed, apart from the two tests of acceptance 6. [R2] [dod arm 3]
  - 5. `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md` and the fragment state R6 (reviewer-verified against the diff). [R6] [dod arm 2]
  - "6. Two tests of main change, and no other line of their files. `tests/scenarios/side-write-faults.test.ts`, the test of acceptance 6a whose GOAL_STOPPED append fails: `aidlc next` still throws, the goal stays stopped for time, and a second `aidlc next` appends one GOAL_STOPPED with `completed` true; its title says so. `tests/surface/approver.test.ts`, the PLAN_ACCEPTED data of intent-accepted is compared without `eventKey`. [R1] [R3] [dod arm 3]"
depends_on: [T1-GOAL-UPDATE]
budget: 700
size_exception: "approved by the owner (asun28) in the session of 2026-11-25 (the words approve and start), told the budget and the estimate of each part. About 110 lines in src/ and about 270 of fault rows. Amended on 2026-11-26 by the owner in the session: budget 700, measured at BUILD as 153 lines added and 52 removed in src/ and 491 in tests/scenarios/goal-owed.test.ts (33 commands and transitions, each call failed in turn, and five checks of R2 to R4 beside the table)"
tdd: true
sweep: "Main at 935a8ee8. The pattern is `journalOwed` of a card run (src/core/types.ts:874 and 989; src/loop/card-runner.ts:897 to 932 and `journalHolds` at 211). Why two orders: the audit counts work after the latest journaled stop (src/audit/verifier.ts, terminal accounting), so a stop saved before its event admits no work meanwhile, and a re-admission journaled before its record admits none either; tests/scenarios/review-rule-goal.test.ts:235 pins the second order for a ruling. The suite run of the first card's sweep did not cover this card: run its sweep at PREPARE on the merged first card. Amended on 2026-11-26 by the owner (asun28) in the session: the PREPARE sweep (full suite with the change in place, 4318 tests) found two tests of main that R1 reverses, tests/scenarios/side-write-faults.test.ts:174 (a failed GOAL_STOPPED append in aidlc next stops nothing) and tests/surface/approver.test.ts:95 (PLAN_ACCEPTED data is exactly {}); acceptance 6 changes them, and the DoD runs them with the two other files the sweep showed pin the order of goal events. Amended again on 2026-11-26 by the owner (asun28) in the session, after R3 decision 1 F1: a recovery by `aidlc next` is compared with the run with no failure followed by that `aidlc next`, since every `next` makes its derived writes."
forbid: [a change to src/audit/verifier.ts, a change to a test that exists on main other than the two of acceptance 6, a second journal or a second lock]
non_goals:
  - "an append that writes part of a line before it fails: the chain is malformed and refused as today"
  - "an owner's act of which nothing landed: nothing records what was asked, so `aidlc next` does not reconstruct it and the command is given again"
  - "two failures in one command, and a process that dies inside a section: the lock it leaves is refused with its process named"
  - "the board, a card run or a release attempt written by the same command: `extendDeadline` and `card-result` keep their own writes, which a rerun makes again"
  - "the events of `GOAL_CREATED` and `GOAL_ROUTED`: `aidlc goal new` run again makes another goal, as today"
  - "lease events (`goal-close-takeover-intent` and its `GOAL_TAKEOVER`), which `releaseGoalLease` already completes"
  - "a card command that runs between the failure and the recovery: it appends no goal event and is not asked to deliver one"
hygiene: "Started only after T1-GOAL-UPDATE is merged; read the line numbers again at PREPARE. Compare each row with a fault-free twin, not with expected literals the code produced. Keep the retry of an extension free of a second `deadlines.extensions` entry: the record decides, not the journal. New fixtures use `makeFixture`."
doc_sync: docs/ARCHITECTURE.md, docs/OPERATIONS.md, changelog.d/T1-GOAL-OWED.md
---

# T1-GOAL-OWED

From `intent/codebase-first-study.md`, proposal 1 (accepted 2026-11-25), and issue 300.

## Why
Under T1-GOAL-UPDATE a goal command no longer overwrites another. A command whose append or record write fails still leaves one without the other, and its rerun can journal the transition twice.

## Deliverable
Each goal write and its event both land, once, after one failure and one rerun.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/scenarios/goal-owed.test.ts tests/scenarios/goal-update.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/deadline.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/takeover-done-race.test.ts tests/scenarios/fault-points.test.ts tests/surface/verifier.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every fault row recovers to its fault-free twin with each event once, and the typecheck, the tree checks and the other files pass.
