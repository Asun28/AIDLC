---
id: T0-SIDE-WRITE-FAULTS
title: A failed journal append or board write beside a saved record loses neither the dispatch event nor the goal stop
status: todo
branch: T0-SIDE-WRITE-FAULTS
worktree: D:\wt\AIDLC\T0-SIDE-WRITE-FAULTS
allow_paths:
  - src/loop/controller.ts
  - src/core/types.ts
  - src/audit/verifier.ts
  - tests/scenarios/side-write-faults.test.ts
  - tests/scenarios/journal-owed.test.ts
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-SIDE-WRITE-FAULTS.md
dod_command: npm run typecheck && node --test tests/scenarios/side-write-faults.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/audit.test.ts tests/scenarios/deadline.test.ts
dod_exit: 0
requirements:
  - R1. `GoalController.ensureCardRun` shall persist a new card run with its `CARD_DISPATCHED` event in `journalOwed`, keyed by `eventKey`, and shall append that event inside the card-run lock section that saves the run.
  - R2. When that append fails, the saved run shall keep the owed event, and the next `aidlc card next` or `aidlc card attempt` shall append exactly one `CARD_DISPATCHED` with `completed` true through `CardRunner.deliverOwed`, on the same run.
  - R3. `verifyAudit` shall count a `CARD_DISPATCHED` with `completed` true at its `startedAt` against the last disposition of its generation, as it counts `ATTEMPT_STARTED`.
  - R4. When `writeBoard` throws in `persistStopValue`, the controller shall return the stopped goal so its caller saves the stop, and shall journal a NOTE naming the error code.
  - R5. `docs/ARCHITECTURE.md` shall state R2 and R4, and the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/side-write-faults.test.ts`: a fault-free `ensureCardRun` journals one `CARD_DISPATCHED` that carries `eventKey` and no `completed`, and a following `card next` adds none. [R1] [dod arm 2]
  - 2. `tests/scenarios/side-write-faults.test.ts`: with only the `CARD_DISPATCHED` append failing, `ensureCardRun` throws, the saved run holds one owed `CARD_DISPATCHED`, and the journal holds none. [R1] [R2] [dod arm 2]
  - 3. `tests/scenarios/side-write-faults.test.ts`: after that failure, a retry of `ensureCardRun` returns the same run with the same `startedAt`, and `CardRunner.next` leaves exactly one `CARD_DISPATCHED` with `completed` true; a second `next` adds none. [R2] [dod arm 2]
  - 4. `tests/scenarios/side-write-faults.test.ts`: after that failure, `CardRunner.recordAttempt` as the first step leaves exactly one `CARD_DISPATCHED`. [R2] [dod arm 2]
  - 5. `tests/scenarios/side-write-faults.test.ts`: a recovered `CARD_DISPATCHED` whose `startedAt` is before a `GOAL_STOPPED` gives no `WORK_AFTER_TERMINAL`, one with `startedAt` after it does, and one without `completed` does. [R3] [dod arm 2]
  - 6. `tests/scenarios/side-write-faults.test.ts`: with `paths.board` replaced by a file, `controller.next` on a goal past its deadline returns `stop`, a fresh controller reads the goal as stopped for `time`, and the journal holds one `GOAL_STOPPED` and one NOTE with the error code. [R4] [dod arm 2]
  - 7. The existing tests of `journal-owed`, `fault-points`, `audit` and `deadline` pass with no change, apart from two rows of `tests/scenarios/journal-owed.test.ts`. The row `a marked CARD_DISPATCHED is not an attempt` pinned the type filter R3 widens, so it moves to `OPERATION_ISSUED` with the same expected count of 1. The test `a card run without journalOwed parses unchanged` read a fresh run as the legacy record, which R1 changes, so it deletes `journalOwed` from the record it reads and keeps every assertion. [R2] [R3] [R4] [dod arms 3 to 6]
  - 8. `docs/ARCHITECTURE.md` and the CHANGELOG hold the text R5 asks for. [R5] Reviewer-verified.
depends_on: []
budget: 170
tdd: true
sweep: "On main at bbbdb10: `CARD_DISPATCHED` has one writer, `src/loop/controller.ts:662`; `ensureCardRun` has two CLI callers, `card next` and `card report`, and `card next` and `card attempt` reach `deliverOwed`. `OwedEvent.type` in `src/core/types.ts:796` needs the new member. `src/audit/verifier.ts:86` `committedBefore` names `ATTEMPT_STARTED` only, and line 99 counts `CARD_DISPATCHED` as work, so R3 is needed by lesson T0-JOURNAL-FAULT-EVENTS. `writeBoard` is reached from `persistStopValue` at controller.ts:707, and every trigger issue 127 names passes through that call."
diagnosis:
  root_cause: "Both defects write a record and a side effect as two unrelated steps. `ensureCardRun` saves the run and then appends, and a retry returns the saved run before it journals, so a lost append is never recovered (issue 143). `persistStopValue` journals `GOAL_STOPPED` and calls `writeBoard` before its caller saves the goal, so a failure of the view loses the stop (issue 127)."
  same_class: "T0-JOURNAL-FAULT-EVENTS gave card-run events an owed entry, which `CARD_DISPATCHED` joins. `boundsOfJournals`, the trigger issue 127 was filed for, is not on main because PR 140 closed unmerged. Catching at the one call in `persistStopValue` covers `listJsonFiles`, `readFileSync` and dangling links on that path at once, so no per-site sweep is needed: a board is a view, never the truth."
forbid:
  - changing `CardRunner.deliverOwed`, `writeBoard`, `listJsonFiles` or `renderBoard`
  - catching a failure of `saveGoal` or of the `GOAL_STOPPED` append
  - weakening or skipping a test to go green
non_goals:
  - making every other `writeBoard` caller tolerate a failure
  - telling an absent journal directory from an unreachable one, which served the Bounds line that never merged
hygiene: "Issues 143 and 127, grouped because each is a side write beside a saved record and the fix for each is in `src/loop/controller.ts`. Who the boundary holds against: a failed write, not a hostile process. The R3 rule is the one lesson T0-JOURNAL-FAULT-EVENTS asks for, since an owed `CARD_DISPATCHED` lands later than its decision. Line numbers checked on main at bbbdb10."
---

# T0-SIDE-WRITE-FAULTS

## Deliverable
A lost `CARD_DISPATCHED` append is recovered once, and a failed board write never loses a goal stop. Closes issues 143 and 127.

## Acceptance
```powershell
npm run typecheck && node --test tests/scenarios/side-write-faults.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/audit.test.ts tests/scenarios/deadline.test.ts
```
- Expected exit code: 0
- Assertion: the acceptance list above.
