---
name: verify-card-run-writes
description: >-
  Project verify skill for the card-run write protocol: the CardRunner store
  writes and goal journal appends, checked by failing each write in turn
  (tests/scenarios/fault-points.test.ts). Use when a change touches a file
  the coverage record names, when a card that changes one is about to SHIP
  or CLOSE, when the fault-point test fails, or when a covered command
  gains, loses or reorders a write.
---
# verify-card-run-writes

This repository only; `aidlc init` never installs it.

## Property
Property: after any single failed card-run record write or goal journal append and the card's next step, the stored card run and the goal journal agree and the run reaches the end state of the fault-free run.
Harm: a card the journal reports in one state while the run record holds another, so the loop repeats or skips a ship, a review or an attempt.

## Coverage
- `tests/scenarios/fault-points.test.ts`: `enumerate`, `underFaults`, `recover`, `check`, `drive`, `endState`, `judge`
- `src/loop/card-runner.ts`: `CardRunner.recordAttempt`, `CardRunner.preReview`, `CardRunner.formalReview`, `CardRunner.next`, `CardRunner.ship`, `CardRunner.applyShipResult`, `CardRunner.commitFormalResult`, `CardRunner.commitReviewed`, `CardRunner.save`, `CardRunner.deliverOwed`
- `src/state/goal-store.ts`: `GoalStore.saveCardRun`, `GoalStore.updateCardRun`
- `src/state/store.ts`: `atomicWriteJson`, `atomicWriteText`
- `src/state/journal.ts`: `Journal.append`

The commands driven are `card attempt` (a success at BUILD), `review pre`
(an R2 pass), `review r3` (an R3 pass), `card next` at SHIP after the R3
pass (ship to CLOSE) and `card next` at SHIP past the card deadline
(STOP/time). Invariants I1 to I6 and the liveness comparison are in the
test file and in docs/OPERATIONS.md, Fault-point check.

Sync commit: `04607380062cf9933fe209aa905315f08c62453a`

## Run
```
node --test tests/scenarios/fault-points.test.ts
```
About 11 seconds on Windows at the sync commit (28 tests). CI runs it
in `npm test` on each push.

## Bounds and assumptions
- One fault per run, at each write index of the command as counted by a
  first clean pass, then one recovery step (`card next`, the review it
  directs, `card next`), then a drive to rest of at most 12 `card next`.
- Store writes are atomic (temp file and rename in `src/state/store.ts`):
  a failed write throws and changes nothing.
- A fault is a throw from `fs.renameSync` onto the card-run record or
  from `fs.appendFileSync` onto the goal journal.
- Fixed fixture clock; git, gh and the reviewers are scripted
  (`scriptedRunner`, `DryRunShipPath`).
- Message text: not compared.

## Not covered
Two-session interleavings of the lease and the review queue, more than
one fault per run, the commands the check does not drive, and the fault
points pinned in `KNOWN_VIOLATIONS`. Read `references/not-covered.md`
when deciding whether a change, a command or a write is covered.

## Shown failing
A scratch break of `CardRunner.preReview` in `src/loop/card-runner.ts`
made the check fail on the real code. Read
`references/shown-failing.md` when you doubt that the check can fail, or
when Extending the check asks for a scratch break of your own.

## Bug or modelling error
Replay the counterexample against the real code step by step: the
command, the write that failed, the stored run and the journal after it,
each recovery step. If a step cannot happen in the code (a write or an
order the code never makes, a recovery move no directive names), the
check is wrong: correct the check, show it failing once on a scratch
break, and record the correction under Extending the check. If
every step can happen, it is a bug.

## Findings
Report a bug as a short numbered sequence in the code's words: the
command, the write that failed, the stored run and the journal after it,
the next step, the invariant or end state broken. Open a T0-bugfix card
with it and pin it in `KNOWN_VIOLATIONS` with that counterexample until
the fix removes the pin. Never weaken the property, an invariant or the
model to pass, and never change product code from this skill.

## Extending the check
When a covered command gains, loses or reorders a write:
1. Update the expected writes, the invariants and, for a new end state,
   `FAULT_FREE_CLOSE` or `FAULT_FREE_TIME` in the test file.
2. Show the new write failing once with a scratch break, as above.
3. Update the coverage record (files and functions).
4. Run the check to a pass, then move the sync commit.
A new command is added to `COVERED` with its stage and named end.

## Keeping in sync
Tell whether a change touches covered code:
`git diff --name-only SYNC -- tests/scenarios/fault-points.test.ts src/loop/card-runner.ts src/state/goal-store.ts src/state/store.ts src/state/journal.ts`
(SYNC is the sha on the `Sync commit:` line; the files are the record's).
Then exactly one outcome:
- **in sync**: covered files unchanged, or changed without a change to a
  write or its order, and the check passes; the sync commit may move.
- **updated**: the check and the record were changed to match the code
  (Extending the check); then the sync commit moves.
- **bug**: the check fails on the real code and the replay confirms it;
  go to Findings.
- **blocked**: the check cannot match the code without a decision;
  stop and ask.
The sync commit moves only after confirming the check describes the
code at the new commit, and only to a commit on main, as a squash
merge drops branch commits.
