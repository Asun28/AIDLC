---
id: T1-GOAL-UPDATE
title: "Every write of a goal record is one locked update decided on the record read inside it: the owner's acts recompute there, and a write computed from an older read is refused with GOAL_STALE (issue 300, first of two cards)"
status: todo
branch: T1-GOAL-UPDATE
worktree: D:\wt\AIDLC\T1-GOAL-UPDATE
allow_paths:
  - src/core/types.ts
  - src/state/goal-store.ts
  - src/state/store.ts
  - src/loop/controller.ts
  - tests/infra/goal-update.test.ts
  - tests/scenarios/goal-update.test.ts
  - tests/scenarios/review-rule-goal.test.ts
  - tests/surface/prose.test.ts
  - README.md
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - changelog.d/T1-GOAL-UPDATE.md
  - specs/tasks/T1-GOAL-UPDATE.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/infra/goal-update.test.ts tests/infra/goal-store.test.ts tests/infra/store.test.ts tests/scenarios/goal-update.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/deadline.test.ts tests/scenarios/takeover-done-race.test.ts tests/scenarios/takeover-done-goal.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/arc-reentry.test.ts tests/scenarios/registry-per-call.test.ts tests/scenarios/run-driver.test.ts tests/scenarios/fault-points.test.ts tests/surface/verifier.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `GoalStore.updateGoal(goalId, change, within?)` shall run `change` on the record as stored under the lock of the goal file (`updateJson`) and write what it returns, with `Goal.writes` one above the stored value (0 for a record not stored yet) and `updatedAt` set, and shall write nothing when `change` throws or returns the record it received.
  - R2. `GoalStore.saveGoal(goal)` shall write through `updateGoal`, and shall throw `GOAL_STALE` with no write when a record is stored whose `writes` differs from that of `goal`.
  - R3. `GoalController.report` (each result that writes the goal), `extendDeadline` and the re-admission of `ruleFinding` and `continueCard` shall each read the goal, check its generation and state, decide, append their goal events and write the record in one `updateGoal` section, decided on the record read in it, with the runner's own writes of a ruling or a continuation on a stopped goal inside that section, and `createGoal` shall write the initial record and append `GOAL_CREATED` and `GOAL_ROUTED`, in that order, in one such section.
  - R4. WHEN two of `goal cancel`, `goal resume`, `goal extend` and `review rule` run on one goal at once, THEN the goal record and the goal's events shall be those of the two commands run one after the other, or one of them shall exit non-zero having written no goal record and appended no goal event.
  - R5. WHEN `aidlc next` derives a transition or a stop from a record another command has written since, THEN it shall throw `GOAL_STALE`, leave that record and append no goal event for the derived write.
  - R6. WHEN the goal lock is held past its wait, THEN each writer of R3 and R5 shall be refused with `LOCKED`, with the goal record unchanged and no goal event of that writer appended; the close of a goal keeps its two goal-lease sections (T0-GOAL-CLOSE-LEASE), each under the goal lock before its first effect, so a close refused in the second has recorded the lease takeover of the first, and the next call completes it.
  - R7. A section of the goal lock shall be entered after the goal lease lock and before a card-run, card-lease or journal lock, and no registry loader shall run while it is held: only the registry data the mutation is decided on is loaded before it, after the refusals that come before that load today, and a load for the board stays outside it with its order and its failure handling.
  - R8. No file of `src/` outside `src/state/goal-store.ts` shall write a goal file.
  - R9. `docs/ARCHITECTURE.md` (the `src/state/` paragraph, the lock order) and `docs/OPERATIONS.md` (the re-admission after a ruling, Goal writes) shall state R1 to R7, and shall no longer say that only `aidlc review rule` takes the goal lock; the sentence of `README.md` (Multi-session) and of `docs/OPERATIONS.md` (Sessions) on what the locks cover shall name every goal and card-run write and shall no longer list goal records as last-writer-wins.
acceptance:
  - 1. `tests/infra/goal-update.test.ts`. `updateGoal` counts `writes` from 0 over a creating write and two changes; a change that throws and one that returns its record leave the bytes as they were; a stored record with no `writes` key reads as 0. `saveGoal` with the stored `writes` succeeds, and with an older or a newer one throws `GOAL_STALE` with the bytes unchanged, also when both records carry one `updatedAt`. Two child processes that each make 50 updates of one goal leave `writes` 100 above its start and every one of the 100 entries. [R1] [R2] [dod arm 3]
  - 2. `tests/scenarios/goal-update.test.ts`, with the nth-read hook of `review-rule-goal.test.ts`, the second command landing after the first one's read outside its section. Each ordered pair of {cancel, extend} and of {resume, ruling that lifts the stop}, and cancel landing in a revision and an approval in a revision, gives the record and the event types of the two run one after the other, or a refusal that leaves the bytes of the goal record and journal as the second command left them. The extension that lands after a cancellation keeps the stop `cancelled`; the resume that lands in a cancellation refuses it as a stale report. RED on main, where the extension removes the cancellation. [R3] [R4] [dod arm 3]
  - 3. Same file. A cancellation that lands after the read of `aidlc next` and before each of its writes (CARDS to RUN, RUN to WAIT, WAIT to RUN, RUN to VERIFY_ARC, DELIVER to CLOSE, CLOSE to DONE, the time stop, the reconciliation stop, the planning stop, the stop of an empty ready set) makes `next` throw `GOAL_STALE`; the goal record keeps the bytes of the cancellation and the journal has no goal event after its `GOAL_STOPPED`, except that the close row may hold the lease events `releaseGoalLease` appends. [R5] [dod arm 3]
  - 4. Same file. With the lock file of the goal present and naming a live process, `report` with each result that writes the goal, `extendDeadline`, the re-admission and one derived write of `next` throw `LOCKED`, and the bytes of the goal record and of the goal journal are unchanged, for a close under an expired lease of another session too. With the lock taken between the two sections of that close, `next` throws `LOCKED`, the goal record is unchanged, the journal gains the takeover intent alone, and the next call reaches `DONE` with one `GOAL_TAKEOVER`. A command run inside the runner of a ruling and of a continuation is refused with `LOCKED`, and the act completes. [R3] [R6] [dod arm 3]
  - 5. Same file. A log of lock creations over an extension with two card runs, a close to DONE and a cards-projected report shows the order of R7; a registry loader that records whether the goal lock exists when it runs records that it does not, for `cards-projected`, `revision`, `arc-verified`, a resume that carries a revision, `plan-produced` and a rejection, the last two of which load it for the board alone. A command that lands between the record write of `createGoal` and its first append waits on the goal lock and is refused with `LOCKED`, and the journal of the goal starts with `GOAL_CREATED` and `GOAL_ROUTED`. [R3] [R7] [dod arm 3]
  - 6. `tests/infra/goal-update.test.ts`. A scan of `src/` finds `goalFile(` in an argument of `updateJson` or `atomicWriteJson` in `src/state/goal-store.ts` alone. [R8] [dod arm 3]
  - 7. `tests/scenarios/review-rule-goal.test.ts` changes in three tests only. The whole-record comparison of the test at line 127 gains `writes` one above the record before. In the test at line 306 the other command, run between the ruling's card-run write and the re-admission, is refused with `LOCKED` at each of the four rows, and the goal is re-admitted from the record before the ruling, with `writes` one above it and one `GOAL_STATE` from STOP to CARDS. In the test at line 379 the other command, run inside the section, is refused with `LOCKED` at each of the four rows, the re-admission completes, the rerun is refused, and one `GOAL_STATE` from STOP to CARDS is journaled. Its other tests, and every other file of the DoD that exists on main apart from that of acceptance 9, pass with no line changed. [R3] [R6] [dod arm 3]
  - 8. `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md` and the fragment state R9 (reviewer-verified against the diff). [R9] [dod arm 2]
  - 9. `tests/surface/prose.test.ts`, suite T1-STORE-CAS-2. In `LOCK` and `LOCK_SESSIONS` "every card-run write" becomes "every goal and card-run write" and "goal, release and review-pool records" becomes "release and review-pool records", as does the latter in the list of line 363; nothing else of the file changes, its byte limits included. [R9] [dod arm 2]
depends_on: []
budget: 480
size_exception: "approved by the owner (asun28) in the session of 2026-11-25 (the words approve and start), told the budget and the estimate of each part, with the changes to three tests of tests/scenarios/review-rule-goal.test.ts named in acceptance 7. About 150 lines in src/ (the store 30, the sections of the controller 100, the refusals of next 20) and about 300 of tests; the sections of report, extendDeadline and the re-admission share one lock and cannot land apart, since a writer left without it undoes the others"
tdd: true
sweep: "Main at 935a8ee8. `saveGoal` has 11 call sites, all in src/loop/controller.ts (229, 359, 414, 419, 435, 442, 491, 528, 772, 874, 986); src/loop/controller.ts:1067 is the one `updateJson` on the goal file; bench/journeys.ts:69 and 24 test files call `saveGoal`. A prototype in a throwaway clone (`Goal.writes`, `updateGoal`, `saveGoal` as the compare-and-set of R2, and the controller taking the record `saveGoal` returns where it dropped it; the sections of R3 not built) ran the full suite: 4292 tests, 4255 pass, 34 skipped, 3 fail, the three tests of acceptance 7. The line numbers of tests/scenarios/review-rule-goal.test.ts are those of main at 935a8ee8. docs/OPERATIONS.md line 464 holds the sentence R9 removes; no test pins it. Amended on 2026-11-25: README.md:135 and docs/OPERATIONS.md:265 also say that goal records stay last-writer-wins, and tests/surface/prose.test.ts:346, 349 and 363 pin it."
forbid: [a change to src/audit/verifier.ts, a change of a deadline or an allowance, a lock file removed by a process that did not create it, weakening or skipping a test]
non_goals:
  - "an append that succeeded before a write that failed, and a write that succeeded before an append that failed: each site keeps the order it has today (the order inside a section is the one the site has on main), and T1-GOAL-OWED recovers them"
  - "a retry inside `aidlc next` after `GOAL_STALE`: the command is run again, as after `CARD_RUN_STALE`"
  - "a dispatch of `card next` serialized against a second session (the four interleavings T0-FOREIGN-DISPATCH-NO-WRITE-3 left to issue 300)"
  - "release attempts and operations: `saveRelease` stays a plain write"
  - "a lock left by a process that died: it is refused with its process named, as for a card run"
  - "a session of an older aidlc on the same state directory, which takes no lock"
hygiene: "RED first: the rows of acceptance 2 that fail on main. The lock is not reentrant and sections are synchronous, so no section may call `next`, `saveGoal` or another section on the same goal; `persistStopValue` renders the board, which reads the registry, so the board is rendered outside a section; tests/scenarios/registry-per-call.test.ts:246 and 323 pin that a failed board load keeps the stop and that `plan-produced` journals and saves before its first registry load. The default wait is 2 s: an extension that waits on card-run locks holds the goal lock meanwhile and another writer may be refused. Checked against the newest lessons of docs/LESSONS.md on 2026-11-25: the lines cited here were compared with main today (T1-GIT-MIN-VERSION), the sweep ran with the changed writer in place and each failure was read (T0-REVIEW-REPORT-SCRIPTS), every reader of the goal lock sentence was listed (T0-ARC-EXTERN-DEP-2), and the requirements name the writers they cover instead of claiming every interleaving (T0-SMALL-ISSUES-463-428-ZOD). New fixtures use `tmpDir` or `makeFixture`."
doc_sync: docs/ARCHITECTURE.md, docs/OPERATIONS.md, changelog.d/T1-GOAL-UPDATE.md
---

# T1-GOAL-UPDATE

From `intent/codebase-first-study.md`, proposal 1 (accepted 2026-11-25), and issue 300.

## Why
A goal command reads the record and later saves its snapshot with no lock, so an extension can remove a cancellation that landed between. T1-REVIEW-RULE-GOAL-2 locked the save alone and reverted it: a command that had journaled its transition and then failed to get the lock left an event with no update. Here the lock is taken before the read and the append.

## Deliverable
One locked update for the goal record, used by every writer.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/infra/goal-update.test.ts tests/infra/goal-store.test.ts tests/infra/store.test.ts tests/scenarios/goal-update.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/deadline.test.ts tests/scenarios/takeover-done-race.test.ts tests/scenarios/takeover-done-goal.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/arc-reentry.test.ts tests/scenarios/registry-per-call.test.ts tests/scenarios/run-driver.test.ts tests/scenarios/fault-points.test.ts tests/surface/verifier.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the rows of acceptance 1 to 7 hold, and the typecheck, the tree checks and the other files pass.

## PR summary
### What
Every write of a goal record is one update under the lock of the goal file. The record counts its writes in `writes`.

### Why / Intent
A goal command read the record and later saved its snapshot with no lock. A deadline extension could remove a cancellation. This is the first of two cards for issue 300.

### How / Behaviour
An owner's act decides on the record that it reads inside the lock, and appends its events there. `aidlc next` refuses a derived write over a newer record with `GOAL_STALE`. A command that waits more than 2 seconds is refused with `LOCKED`.

### System impact
`GoalStore`, `GoalController` and the goal record change. An older record reads as `writes` 0.

### Security
No new input, command or credential. The lock file names a process, as the card-run lock does.

### Tests and review
Two new test files cover the store, overlapping acts, stale derived writes, held locks and lock order. Three tests of `review-rule-goal.test.ts` and the pinned sentences of `prose.test.ts` change, as the card states. R3 reviews the candidate.

### Risk
Medium. A command can now be refused and must run again. A lock of a dead process must be removed by hand.

### Ownership
The aidlc loop maintainers.

### Docs
`docs/ARCHITECTURE.md`, `docs/OPERATIONS.md` (Goal writes, Sessions), `README.md` and `changelog.d/T1-GOAL-UPDATE.md` state the change.

## Attempt evidence
RED commit 44fc63c96e03d46558950800113b55d7be0b1ebf: 22 tests of three files, 14 fail.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/goal-update.test.ts`, the four "acceptance 1" tests | RED, then pass |
| 2 | `tests/scenarios/goal-update.test.ts`, "acceptance 2": 11 rows, and a goal stopped again after the ruling was written. RED on its first row, where the extension removes the cancellation | pass |
| 3 | Same file, the two "acceptance 3" tests: 12 derived writes, one a close under an expired lease of another session, each with and without a cancellation that lands | RED, then pass |
| 4 | Same file, "acceptance 4": 13 report results, the extension, a real ruling and a real continuation, and the 12 derived writes under a held lock; goal record, journal, goal lease and card run are compared | RED, then pass |
| 5 | Same file, the three "acceptance 5" tests: lock order, registry loads, a command inside `createGoal`. The registry test passes on main, where no goal lock is held | pass |
| 6 | `tests/infra/goal-update.test.ts`, "acceptance 6" | RED, then pass |
| 7 | `tests/scenarios/review-rule-goal.test.ts`, three tests changed; every other file of the DoD apart from that of item 9 has no line changed | RED, then pass |
| 8 | the documents and the fragment | reviewer-verified |
| 9 | `tests/surface/prose.test.ts`, suite T1-STORE-CAS-2, "acceptance 8" of that suite, RED before the two sentences changed | pass |

Guards: 16 loosened forms of the new conditions were run one at a time against four test files. 14 were caught. "A result that changes no field is a write" led to the last assertion of acceptance 4, which catches it. The other, a derived stop whose event is appended after the write, is not pinned: the card keeps the order of main, T1-GOAL-OWED reverses it, and that card may change no test of main.

R4, found by a row at BUILD: a goal that was resumed and stopped again for review in a later generation made the ruling exit 0 and stay stopped. The re-admission now refuses it and asks for the command again.

R3 decision 1, RED at 00babc03abbbc90db28274a663ffce7600085d84: F1, a close refused by the goal lock had changed the goal lease and the journal, and a row of acceptance 4 exempted it; both sections of the close now take the goal lock before their first append and lease write, and the exemption is gone. F2, the ruling of the tests was a stub that journaled nothing; the rows now run the real runner, and a ruling or a continuation on a stopped goal checks the goal under the lock before the runner writes.
