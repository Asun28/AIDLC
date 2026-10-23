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

This repository only; `aidlc init` never installs it. The check is the
fault-point test; this file says what it proves, what it leaves out and
how to keep it matched to the code.

## Property
Property: after any single failed card-run record write or goal journal append and the card's next step, the stored card run and the goal journal agree and the run reaches the end state of the fault-free run.
Harm: a card that the journal reports in one state while the run record holds another, so the loop repeats or skips a ship, a review or an attempt.

## Coverage
- `tests/scenarios/fault-points.test.ts`: `enumerate`, `underFaults`, `recover`, `check`, `drive`, `endState`, `judge`
- `src/loop/card-runner.ts`: `CardRunner.recordAttempt`, `CardRunner.preReview`, `CardRunner.formalReview`, `CardRunner.next`, `CardRunner.ship`, `CardRunner.applyShipResult`, `CardRunner.commitFormalResult`, `CardRunner.commitReviewed`, `CardRunner.save`
- `src/state/goal-store.ts`: `GoalStore.saveCardRun`, `GoalStore.updateCardRun`
- `src/state/store.ts`: `atomicWriteJson`, `atomicWriteText`
- `src/state/journal.ts`: `Journal.append`

The commands driven are `card attempt` (a success at BUILD), `review pre`
(an R2 pass), `review r3` (an R3 pass), `card next` at SHIP after the R3
pass (ship to CLOSE) and `card next` at SHIP past the card deadline
(STOP/time). Invariants I1 to I6 and the liveness comparison are in the
test file and in docs/OPERATIONS.md, Fault-point check.

Sync commit: `de34902e0a074a2508901875edfd2f33b1493396`

## Run
```
node --test tests/scenarios/fault-points.test.ts
```
About 11 seconds on Windows at the sync commit (28 tests). `npm test`
runs it, so CI runs it on every push.

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

## Not covered
- Two-session interleavings of the lease and the review queue, and
  writes to the lease, review-queue, operation-ledger and `.review/` files.
- More than one fault per run, a crash inside a single write, a process
  that dies mid-command, a torn journal line.
- Card-run commands the check does not drive: `CardRunner.takeover`,
  `CardRunner.disputeFinding`, `CardRunner.acceptFinding`, failed and
  not-counted attempts, R2 and R3 blocks and no-verdict results, PREPARE,
  BUILD and CLOSE steps of `card next`.
- A confirmed violation the current code shows is not a pass: it is
  pinned in `KNOWN_VIOLATIONS` with its counterexample and filed as a
  T0-bugfix card, so those fault points are known defects, not covered
  behaviour.

## Shown failing
Scratch break, never committed: in `src/loop/card-runner.ts`,
`CardRunner.preReview`, the `PRE_REVIEW_DECIDED` journal append was moved
from after `this.commitReviewed` (the store write that saves the R2 pass
round) to before it. `git diff --name-only` against the sync commit listed
`src/loop/card-runner.ts`; the check then failed (exit 1, 2 of 28 failed):
the record write after the early append failed, and the journal reported
a pass the run did not hold. `git restore` dropped the change and the
check passed (28 of 28). From
`node --test --test-reporter=tap tests/scenarios/fault-points.test.ts`:

```
    not ok 3 - B preReview R2 pass (review pre): the fault-free run has fault points and no violation, and every fault point and its recovery keep I1 to I6 [R1] [R2] [R3]
      location: 'D:\\wt\\AIDLC\\T1-VERIFY-SKILL\\tests\\scenarios\\fault-points.test.ts:786:5'
      error: |-
        Expected values to be strictly deep-equal:
        +   'B preReview R2 pass (review pre) k=3 of 3, failed renameSync cards\\g-20260911000000-af8e3f\\T1-FP.json; the command threw: EIO: injected fault 3, renameSync cards\\g-20260911000000-af8e3f\\T1-FP.json; recovery: next -> wait, next -> wait; after the command: I3: PRE_REVIEW_DECIDED seq 9 (cycle 0, round 1, outcome pass, decision undefined) names no pass round the card run holds (preReview.rounds)',
    not ok 11 - every fault point of A to E reaches its command's fault-free end state or matches its pin exactly, and no pin is stale [R5] [R6]
```

The broken-order self-test proves the enumerator can fail; this section
proves the check fails on the real code.

## Bug or modelling error
Replay the counterexample against the real code step by step: the
command, the write that failed, the stored run and the journal after it,
each recovery step. If a step cannot happen in the code (a write the code
never makes, an order the code never uses, a recovery move no directive
names), the check is wrong: correct the check, show it failing once on a
scratch break, and record the correction under Extending the check. If
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
`git diff --name-only de34902e0a074a2508901875edfd2f33b1493396 -- tests/scenarios/fault-points.test.ts src/loop/card-runner.ts src/state/goal-store.ts src/state/store.ts src/state/journal.ts`
(the sync commit and the record's files). Then exactly one outcome:
- **in sync**: covered files unchanged, or changed without a change to a
  write or its order, and the check passes; the sync commit may move.
- **updated**: the check and the record were changed to match the code
  (Extending the check); then the sync commit moves.
- **bug**: the check fails on the real code and the replay confirms it;
  go to Findings.
- **blocked**: the check cannot be brought in line without a decision;
  stop and ask.
The sync commit moves only after confirming that the check describes the
code at the new commit, and only to a commit on main, since a squash
merge drops branch commits.
