---
id: T0-DISPUTE-RUNNING-ATTEMPT
title: A dispute that sends the unchanged candidate back to review settles the repair attempt BUILD opened, a later ship takes a running attempt as its repair instead of throwing, and the pre-review round is never numbered past its maximum (issue 106)
status: todo
branch: T0-DISPUTE-RUNNING-ATTEMPT
worktree: D:\wt\AIDLC\T0-DISPUTE-RUNNING-ATTEMPT
allow_paths:
  - src/core/effort.ts
  - src/core/types.ts
  - src/loop/card-runner.ts
  - tests/core/effort.test.ts
  - tests/scenarios/dispute-running-attempt.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-DISPUTE-RUNNING-ATTEMPT.md
dod_command: npm run typecheck && node --test tests/core/effort.test.ts tests/scenarios/dispute-running-attempt.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the card runner reuses the kept DoD receipt because every finding of the block is disputed (the unchanged candidate goes back to review), a running attempt of the effort episode shall be settled as `not-counted` with the new reason `review-disputed`, and the episode shall be `succeeded` again when its last evaluated attempt is a success (the success that bound the candidate); `ATTEMPT_FINISHED` is journaled with the attempt number, `not-counted` and the reason. The attempt is settled, never discarded, so its record stays; it counts nothing.
  - R2. The base-sync merge-conflict repair, the red-missing repair and the pre-review block hand-back shall take a running attempt as the repair, with its number and effort, as `afterShipFailure` already does, instead of calling the ladder, which throws on a running attempt; the merge-conflict repair (`pendingRepair: merge-conflict`) is then recorded after a committed base-sync merge although an attempt is running.
  - R3. The pre-review directive, its narration and the R2 prompt shall never number a round past its maximum (passes count in the number, blocks in the budget): the maximum they show is the larger of `preReview.rounds` and the round number, as the R3 prompt does for decisions. Rounds are counted by decided rounds (a pass counts) while the budget is counted by blocks, so a pass followed by a new candidate (a base-sync merge) runs a further round; the block budget is unchanged.
  - R4. `docs/OPERATIONS.md` and `CHANGELOG.md` shall state the rules and the limit. The limit, stated before the first review: a run persisted before this card still holds the running attempt a dispute left; R2 takes it as the repair at the next ship, and R1 settles none that was left before. The round a pass is followed by shows N/N, not N of the block budget.
acceptance:
  - 1. tests/scenarios/dispute-running-attempt.test.ts - the sequence of issue 106 (an R2 block, BUILD opening the repair attempt, every finding disputed, SHIP on the unchanged candidate): the attempt is `not-counted` with reason `review-disputed`, the episode is `succeeded`, `ATTEMPT_FINISHED` is journaled with that reason, and the ladder's next step (its effort, and the count of evaluated attempts) is what it was before the dispute; a kept receipt reused because the pre-review rounds are exhausted, with the finding still open, settles nothing and journals nothing (R3 decision 1 F1); a terminal episode keeps its running attempt; R2 and R3 then pass, and a ship ending with `[SHIP-BASE-SYNC-MERGED]` returns the card to BUILD with the merge-conflict repair, never throwing. [R1] [R2] [dod arm 1]
  - 2. tests/scenarios/dispute-running-attempt.test.ts - a run that still holds a running attempt at the ship (as one persisted before this card does): a `[SHIP-BASE-SYNC-MERGED]` ship and a red-missing ship each record their repair with that attempt as the repair (its number and effort) and never throw; the pre-review hand-back of a still-blocked candidate with a running attempt names that attempt and never throws; each of the three call sites (the hand-back, the red-missing repair, the base-sync merge-conflict repair) has its own case. [R2] [dod arm 1]
  - 3. tests/core/effort.test.ts - `repairAction` returns a running attempt as the repair, answers a terminal episode as `nextEffortAction` does, and asks the ladder when nothing runs; `settleDisputedRepair` settles a running attempt as `not-counted` `review-disputed`, restores `succeeded` only when the last evaluated attempt is a success, returns an episode with no running attempt unchanged (deepEqual) and never mutates its input. [R1] [R2] [dod arm 1]
  - 4. tests/scenarios/dispute-running-attempt.test.ts - a cycle of block, block and pass followed by a new candidate gives a pre-review directive with round 4 and maxRounds 4, the narration "round 4/4" and an R2 prompt of "round 4 of 4"; a first round still reads "1/3"; a block on round 4 is the third block of the cycle and exhausts the budget as before (onExhausted), so the budget still counts blocks only. [R3] [dod arm 1]
  - 5. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rules under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R4] [dod arm 1]
depends_on: [T0-BASE-SYNC-CHANGELOG-2]
budget: 520
tdd: true
sweep: "grep -n 'nextEffortAction(\\|reusableReceipt(run)\\|decided.length + 1\\|maxRounds: cfg.rounds' src/loop/card-runner.ts: the reuse of the kept receipt (501-502) moves the card to SHIP and leaves the attempt BUILD opened running; the pre-review hand-back (1147), the red-missing repair (2457) and the base-sync merge-conflict repair (2485) call nextEffortAction, which throws on a running attempt; the round is decided rounds + 1 and the maximum shown is preReview.rounds (1170, 1174, 2110). Lines measured on main cc471ed."
forbid: [weakening or skipping a test to go green, a card-runner.ts change outside lines 17, 501-502, 1147, 1149, 1174, 2110, 2343, 2457 and 2485 (measured on main cc471ed), discarding an attempt record, a change to the pre-review block budget or to how an R2 cycle is counted, src code (effort.ts, card-runner.ts) calling nextEffortAction on an episode with a running attempt]
non_goals: [settling an attempt a dispute left running before this card, the R3 decision count, the effort ladder's rules, disputes of R3 blocks on the ship-path reviewer]
diagnosis:
  root_cause: "A dispute that answers an R2 block makes reusableReceipt return the kept DoD receipt (card-runner.ts:501-502), so the card goes back to SHIP on the unchanged candidate, but the repair attempt BUILD opened after the block stays running. A later ship whose base sync commits a CHANGELOG merge takes the merge-conflict branch of applyShipResult, which reopens the episode and calls nextEffortAction (2485); that throws on the running attempt, so the committed merge's repair is never recorded (issue 106, goal g-20260926134615-a88c3e). The red-missing repair (2457) and the pre-review hand-back (1147) call it the same way. Separately, the pre-review round is decided rounds + 1 (a pass counts) over preReview.rounds (1170-1174), while the budget counts blocks, so a pass followed by a new candidate shows round 4/3."
  same_class: "Every unguarded nextEffortAction call on an episode that can hold a running attempt (1147, 2457, 2485; 585, 795 and 852 already guard), and every place the round and its maximum are shown (the directive, its narration, the R2 prompt)."
hygiene: "Issue 106, filed by aidlc-b7. The card-runner.ts hunks (17, 501-502, 1147, 1149, 1174, 2110, 2343, 2457, 2485 on main cc471ed; 17 is the effort import, 1149 and 2343 name a running attempt in the build directive) were sent to aidlc-37 before the edit and approved by it, clear of aidlc-b7's 1166, 1211, 2272-2276 and 2500 and aidlc-a6's 21 and 2309-2322. Run the mutation sweep over every new branch before the first review; the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); a new helper gets a seam before the RED (docs/LESSONS.md 2026-09-26 T1-PARSE-GUARD); every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8)."
doc_sync: docs/OPERATIONS.md (effort and pre-review), CHANGELOG.md
---

# T0-DISPUTE-RUNNING-ATTEMPT

## Deliverable
A dispute that answers a block no longer leaves a repair attempt running: the attempt is settled as not counted and the candidate's success stands. A ship that meets a running attempt anyway (a run from before this card) takes it as the repair, so a committed base-sync merge always records its repair. The pre-review counter shows round N of at least N.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/effort.test.ts tests/scenarios/dispute-running-attempt.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
