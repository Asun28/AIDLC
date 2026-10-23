---
id: T1-VERIFY-FAULT-POINTS
title: A fault-point test fails each card-run record write and goal journal append of five card-run commands in turn, takes the card's next step and checks six invariants
status: todo
branch: T1-VERIFY-FAULT-POINTS
worktree: D:\wt\AIDLC\T1-VERIFY-FAULT-POINTS
plan_ref: plans/review-verification.md#order-of-work
allow_paths:
  - tests/scenarios/fault-points.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-VERIFY-FAULT-POINTS.md
dod_command: npm run typecheck && node --test tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `tests/scenarios/fault-points.test.ts` runs, it shall run each covered command, (A) `CardRunner.recordAttempt` with a success at BUILD, (B) `preReview` with an R2 pass, (C) `formalReview` with an R3 pass, (D) `next` at SHIP after that pass, where the dry-run ship merges and the card reaches CLOSE, and (E) `next` at SHIP with the fixture clock past the card run's deadline, once without a fault to count its fault points and then once per fault point k on a fresh fixture with fault k injected, followed by the recovery: `next`, the `preReview` or `formalReview` that `next` directs, and `next` again.
  - R2. After each fault-free run, each faulted command and each recovery, the check shall report as a violation: (I1) a card run that `GoalStore.getCardRun` cannot read, a `*.tmp-*` or `*.lock` file under the state directory, or a goal journal whose `Journal.verify()` is not ok; (I2) a recovery `next` that throws; (I3) a `REVIEW_DECIDED` event whose invocation id the persisted run does not hold with outcome `pass`, a `PRE_REVIEW_DECIDED` event whose cycle, round and candidate digest name no persisted round with outcome `pass`, or any other decision event (another outcome, a discard, release, abandonment or supersession, a hand-off), which the covered path does not produce; (I4) an R3 invocation id or an R2 reservation id held twice by the persisted run, two `REVIEW_DECIDED` events naming one invocation, more than one substantive R3 decision or more than one R2 pass; (I5) the R2 reviewer, the R3 reviewer or the ship path run more than once over one faulted command and its recovery; (I6) a recovery of E that ends without the persisted stop reason `time` and a `stop` directive.
  - R3. The test shall inject fault k only by throwing from the k-th call, made while the covered command runs, of `fs.renameSync` onto a card-run record under the state directory's `cards/` or `fs.appendFileSync` onto a goal journal under its `journal/`, patched on the `node:fs` export, with no module under `src/` replaced beyond the side effects `CardRunnerDeps` injects (scripted runner, dry-run ship path, fixed clock).
  - R4. The same enumerator and invariant I3 shall report an in-test component that appends a `REVIEW_DECIDED` event before it writes the card run that event names at exactly its card-run write (k = 2), and its twin that writes the card run first at no fault point.
  - R5. The test shall show each of I1, I2, I4, I5 and I6 reporting a violation for a hand-built observation that breaks that invariant alone and none for the same observation unbroken.
  - R6. IF the check reports a violation on the base the card starts from, THEN the card shall stop and carry the reported counterexample (the command, k of N, the failed call and file, the recovery steps and the violated invariant, in the code's words) to a T0-bugfix card, with R1 to R3 unchanged.
  - R7. The test shall finish within the `timeout: 30_000` of its top-level `describe` on the CI runners, in one process, with no `Date.now()` call.
  - R8. `docs/OPERATIONS.md` shall carry a `Fault-point check` section that names the covered commands, the fault points, the recovery, the invariants I1 to I6, what the check does not cover and the command that runs it.
  - R9. The CHANGELOG Unreleased section shall carry an entry naming T1-VERIFY-FAULT-POINTS, the covered commands, the invariants and the self-test.
acceptance:
  - 1. `tests/scenarios/fault-points.test.ts`: the fault-free run of each of A to E counts at least one card-run record write and at least one goal journal append, prints its fault points with `t.diagnostic`, and shows no violation of I1 to I6. [R1] [R2] [R3] [dod arm 2]
  - 2. Same file: for each of A to E and each k from 1 to its count, the check returns `deepEqual(violations, [])` after the faulted command and after the recovery; each violation message is the counterexample (command, k of N, failed call and file, each recovery step with its directive or refusal, invariant, persisted field), and each refusal of a directed review command is printed with `t.diagnostic`. [R1] [R2] [dod arm 2]
  - 3. Same file: the enumerator and I3 report the out-of-order component at exactly `[2]` and its in-order twin at `[]`. [R4] [dod arm 2]
  - 4. Same file: I1, I2, I4, I5 and I6 each report one violation for its hand-built observation (a `.lock` file beside the card run, a recovery `next` that threw, one R3 invocation id held twice, the ship path run twice, a recovery of E that ends at SHIP) and none for the unbroken one. [R5] [dod arm 2]
  - 5. The only patched functions are `fs.renameSync` and `fs.appendFileSync`, restored in a `finally` with `syncBuiltinESMExports()`; nothing under `src/` changes and no class or prototype of `src/` is replaced or passed to `mock.method` (reviewer-verified against the diff); `npm run typecheck` is clean. [R3] [dod arm 1]
  - 6. The top-level `describe` sets `timeout: 30_000`, and the file spawns no process and calls no `Date.now()` (reviewer-verified against the diff); the DoD run's duration at RED is in the attempt evidence. [R7] [dod arm 2]
  - 7. The test passes on the base the card starts from with R1 to R3 as written; a violation found instead stops the card under R6 (reviewer-verified: the covered commands, invariants and fault-point boundary in the diff are those of R1 to R3). [R6] [dod arm 2]
  - 8. Same file: `docs/OPERATIONS.md` contains the six sentences of the Doc text section verbatim and the CHANGELOG Unreleased section contains its entry sentence verbatim, each asserted on its own so that removing any one fails the test. [R8] [R9] [dod arm 2]
depends_on: []
budget: 560
tdd: true
sweep: "git grep -n of `.append({ type:`, `updateCardRun(`, `saveCardRun(` and `this.save(` in src/loop/card-runner.ts at 597e9a2, read for the five covered commands. Fault points on the covered path: A 874, 899 (871 runs only when no attempt is running, not on the path); B 2095, 1969 via 2169, 2195; C 1522, 1534, 1969 via 1892, 1954; D 951, 960, 973, 1029, 2316, 2394, 2614 (its event type is chosen at run time, so the literal grep misses it), 2617; E 500, 564, 650. Sites of the same commands off the covered path, not reached by this card: 257 and 268 (R2 hand-off), 1119 and 1126 (abandoned R2 round), 1868 and 1874 (released R3 reservation), 2000 (stop saved meanwhile), 2119 (R2 reservation dropped after a panel failure), 2268 and 2289 (ship-path decision), 990, 1012, 2334, 2387 and 2400 (cancelled, history and failed ship results), 480 to 515 (ownership reconciliation, reused receipt), 905 to 969 (ship WAIT and STOP saves). Other durable writes of the covered commands, landed and not failed: LeaseStore claim and update (src/coordination/lease.ts:46), ReviewQueue enqueue, admit, complete and cancel (src/coordination/review-queue.ts:53-201), OperationLedger intent, issue and result (src/coordination/reconcile.ts:71 and 112), and the .review/ files at card-runner.ts:1553, 1633 and 1696 and src/review/pre-review.ts:185, 782 and 791."
forbid: ["weakening an invariant of R2 or dropping a fault point or a covered command to make the test pass", "any change under src/ or outside allow_paths", "replacing, subclassing or passing to mock.method GoalStore, Journal, CardRunner or any other module under src/", "spawning a process or calling Date.now() in the test", "changing or deleting an existing test"]
non_goals: ["fixing a defect the check finds (that is a T0-bugfix card)", "failing lease, review-queue, operation-ledger or .review/ writes, or covering the protocol between two sessions", "modelling a process that dies mid-command (no cleanup, a lock left behind) or a torn journal line", "requiring every card-run change to reach the journal (main has no outbox)", "requiring the recovery to make progress: a refusal of the directed review command is printed, not failed", "the off-path branches of the covered commands and every other command (takeover, closure, disputes, CI reconcile, the goal controller, the release runner)", "the project verify skill and the card-loop rule (T1-VERIFY-SKILL)"]
hygiene: "Line numbers in this card are from main at 597e9a2. The loop-efficiency goal changes src/loop/card-runner.ts, src/core/review-policy.ts and src/review/pre-review.ts before this card starts, so PREPARE re-reads every cited line and the write sites of A to E, and the counting pass, never a pinned count, decides N. Patch node:fs the way tests/infra/update-json.test.ts:37-48 does and restore it in a finally. The fixture uses the fixed ISO clock of makeFixture and borrows the scripted reviewers and git diff answers of tests/scenarios/r3-fallback.test.ts:35-97; every fault run builds and removes its own fixture. The one wall-clock read on a covered command (card-runner.ts:1760-1761, the age of a review log when no result envelope exists) is not reached, since every R3 fault point of C comes before the reviewer runs or after its envelope is published. No existing test changes."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-VERIFY-FAULT-POINTS

## Deliverable
One new test file, `tests/scenarios/fault-points.test.ts`, that fails each card-run record write and each goal journal append of five card-run commands, one write per run, takes the card's next step, and checks six invariants over the persisted card run and the goal journal (spec R1 to R3 of `specs/review-verification.md`); a `Fault-point check` section in `docs/OPERATIONS.md` and a CHANGELOG entry (spec R21 for this card). About 131 of the 330 R3 findings in the loop's history were ordering, crash and lock defects in the card-run write protocol that no DoD test reached. The check runs inside `npm test`, adds no dependency and changes nothing under `src/`.

## Design

### Fixture and covered commands
One fixture path, built with `makeFixture` (`tests/scenarios/_harness.ts:52-104`) the way `atReview` in `tests/scenarios/r3-fallback.test.ts:35-97` builds it: card `T1-FP` (allow path `src/t1-fp.ts`), `preReview` on a scripted `fake-r2` (rounds 1, timeoutMs 1000), `formalReview` on a scripted `fake-p` (timeoutMs 1000), `gateRequired: true`, `DryRunShipPath(['merged'])` without a verdict. After `next` (PREPARE) and `next` (BUILD) the path runs A to E in order (`next` directs `pre-review` before B and `review` before C; E starts from the state after C with the clock moved past `run.deadline`). Each command is driven to its start without faults.

| | Command (CLI) | Card-run writes and journal appends at 597e9a2 (`src/loop/card-runner.ts`) |
|---|---|---|
| A | `recordAttempt` success (`card attempt`) | ATTEMPT_FINISHED 874; record 899 |
| B | `preReview`, R2 pass (`review pre`) | reservation 2095; decision 1969 via 2169; PRE_REVIEW_DECIDED 2195 |
| C | `formalReview`, R3 pass (`review r3`) | REVIEW_ADMITTED 1522; reservation 1534; decision 1969 via 1892; REVIEW_DECIDED 1954 |
| D | `next` at SHIP after the pass (`card next`, the ship result path) | OPERATION_INTENT 951; REVIEW_REQUESTED 960; REVIEW_ADMITTED 973; OPERATION_ISSUED 1029; record 2316; OPERATION_RESULT 2394; LEASE_RENEWED 2614; record 2617 |
| E | `next` at SHIP past the deadline (`card next`, STOP/time) | LEASE_RENEWED 500 (the lease expired with the clock); CARD_STATE 564; record 650 |

The counting pass decides N at run time; the last column is the reading at 597e9a2 for PREPARE to compare with.

### Fault points and fault model
A fault point is one call, made while the covered command runs, of `fs.renameSync` onto a card-run record (`cards/<goal>/<card>.json` under the state directory; the commit of every `updateJson` write, `src/state/store.ts:62` via 183) or of `fs.appendFileSync` onto a goal journal (`journal/<goal>.jsonl`; `src/state/journal.ts:142`). Fault k throws an `EIO` error from the k-th such call before the real call runs. The command's own `catch` and `finally` blocks still run: the temp file is removed (`store.ts:64-76`) and the lock released (`store.ts:188-194`). The patch sits on the `node:fs` export with `syncBuiltinESMExports()`, so no module of `src/` is replaced (the tdd skill's Mocks rule; LESSONS 2026-09-18 T1-REVIEW-INVARIANTS: prove an ordering claim at the boundary every writer passes through). This is how the plan's "fault-injecting GoalStore and a mock of Journal.prototype.append" is built: at the two calls those classes write through. The other durable writes of A to E land unfailed (see `sweep`).

### Recovery
`next` once with no fault; when it directs `pre-review` or `review`, the directed `preReview` or `formalReview` once, then `next` once more. The review command is part of the step because the R3 recovery of a result whose commit did not land runs only there (`card-runner.ts:1445-1460`). A refusal (throw) of that review command is printed with `t.diagnostic`, and the invariants still run on the state it leaves (whether that move must succeed is T1-VERIFY-LIVENESS's question).

### Where the code promises each invariant
- I1: `src/state/store.ts:1-7`, 49-77 and 150-161 (atomic rename, temp file removed, lock released by its writer, a throwing change writes nothing); `src/state/goal-store.ts:75-86`; `src/state/journal.ts:1-7`.
- I2: CLAUDE.md, "One directive per call"; `card-runner.ts:568-569`.
- I3: `card-runner.ts:1618-1619` and 1879-1881 (R3: envelope, then commit, then the event at 1954); 2194-2195 (R2: the event after `commitReviewed`); 1958-1965 (the commit order). The hand-off (255), the abandoned round (1116-1117), the released reservation (1865-1866) and the ship-path decision (2261-2263) keep the same order and are off the covered path.
- I4: `card-runner.ts:1889-1890` (a decision recorded meanwhile is counted, never overwritten), 1900 (a committed decision keeps its counters), 2262-2263 (the same artifact is never a second decision).
- I5: `card-runner.ts:9` (every external mutation records intent first), 927-928 and 947-949 (ship intent, duplicate wait), 1387-1388 and 2035-2036 (one round or decision in flight), 1445-1448 (a retained result commits without running the reviewer again).
- I6: CLAUDE.md, "Card state is selected, not stored"; `src/core/card-machine.ts:96-101` (the deadline stop).

### Self-tests and RED
- Broken order (R4): an in-test `decideOutOfOrder` appends a `REVIEW_DECIDED` (invocation `r3:selftest`, outcome `pass`, decision `proceed-merge`) to the fixture's goal journal, then writes the card run holding that invocation through `GoalStore.updateCardRun`; its twin `decideInOrder` writes the record first. The enumerator (with no recovery step) and I3 report `[2]` and `[]`.
- Each invariant (R5): one hand-built observation per invariant that breaks only it, and the same observation unbroken.
- RED: commit the broken-order self-test first, with the I3 check returning no violation; the test fails on `deepEqual(reported, [2])` with `[]`. The RED receipt names that commit and test.

## Not covered (the start of the T1-VERIFY-SKILL list)
Lease, review-queue, operation-ledger and `.review/` writes as fault points; two sessions; a process that dies mid-command (no cleanup, a lock left behind and removed by hand as `docs/OPERATIONS.md` Sessions states); a torn journal line; a journal behind the record (main has no outbox); R2 rounds abandoned after the timeout and the grace (the recovery runs at the faulted run's clock); the off-path sites listed in `sweep`; every other command (`takeover`, `markClosure`, disputes, `ciReconcile`, the goal controller, the release runner).

## Pre-check against main (597e9a2, by reading the code)
For every fault point of A to E the reading predicts no violation of I1 to I6. It predicts these outcomes outside them:
- C, the `REVIEW_ADMITTED` append (1522) failing: the pool request stays `running` (the append sits outside the try at 1533-1559 that cancels it); the recovery's `formalReview` refuses at 1518 (a matching formal review is already running) and `next` directs `review` again on every call.
- D, the `REVIEW_ADMITTED` append (973) failing: the ship's pool request stays `running`; every later `next` records a new intent, cancels it at 962 and waits on `review:<key>`.
- D, the `OPERATION_INTENT` (951) or `REVIEW_REQUESTED` (960) append failing: the first intent stays `intended`; `findDuplicate` (`src/coordination/reconcile.ts:103-107`) returns it, a second intent is recorded, and `aidlc audit verify` blocks on the first with `OP_UNRESOLVED`, plus `OP_INTENT_MISSING` after 951 (`src/audit/verifier.ts:63-69`).
- A, the record write (899) failing: the journal holds `ATTEMPT_FINISHED` (874) for an attempt the record still shows running; the agent's next `card attempt` journals a second one.
- C, the `REVIEW_DECIDED` append (1954) failing after the commit: the decision is never journaled.

## Open questions
- (none) The pre-check outcomes above are outside I1 to I6 and belong to T1-VERIFY-LIVENESS, which checks them as hypotheses and pins each confirmed one for its own T0-bugfix card. The spec Design and plan section 4.5 name the `node:fs` boundary this card injects at.

## Doc text (pinned by acceptance 8)
`docs/OPERATIONS.md`, a new section `## Fault-point check` after `## Evals`, containing these six sentences:
1. `tests/scenarios/fault-points.test.ts` (card T1-VERIFY-FAULT-POINTS) fails each card-run record write and each goal journal append of five card-run commands, one write per run, then takes the card's next step and checks the persisted card run and the goal journal.
2. The covered commands are `card attempt` (a success at BUILD), `review pre` (an R2 pass), `review r3` (an R3 pass), `card next` at SHIP after the R3 pass (the dry-run ship merges and the card reaches CLOSE) and `card next` at SHIP once the card deadline has passed (STOP/time).
3. A write fails by a throw from `fs.renameSync` onto the card-run record or from `fs.appendFileSync` onto the goal journal; the next step is `card next`, the `review pre` or `review r3` it directs, and `card next` again, and a refusal of that review command is printed, not failed.
4. After the faulted command and after the next step the test checks six invariants: the records and the journal chain are intact (I1), every `card next` returns a directive (I2), every `REVIEW_DECIDED` and `PRE_REVIEW_DECIDED` event names a decision the card run holds (I3), no decision is recorded twice (I4), no reviewer or ship runs twice (I5), and a deadline stop is kept (I6).
5. It does not fail lease, review-queue, operation-ledger or `.review/` writes, does not model a process that dies mid-command or a torn journal line, and does not require every card-run change to reach the journal.
6. Run it with `node --test tests/scenarios/fault-points.test.ts`; `npm test` runs it, so CI runs it on every push.

`CHANGELOG.md`, Unreleased, the entry sentence:
- T1-VERIFY-FAULT-POINTS: `tests/scenarios/fault-points.test.ts` fails each card-run record write and goal journal append of `card attempt`, `review pre`, `review r3` and two `card next` steps (the ship to CLOSE and the deadline stop) one at a time, takes the card's next step, and checks six invariants over the card run and the goal journal; a self-test shows that it reports a component that journals a decision before it writes the record.

## Risks
- A covered write that bypasses the two patched calls (a write path the loop-efficiency goal adds) makes acceptance 1's count fail; the card then stops and asks instead of adding a seam under `src/`.
- A violation at RED stops the card under R6; the pre-check predicts none for I1 to I6.
- Size and time: one test file of about 500 lines and two doc edits, about 20 fault runs in one process. It fits the 3 h card deadline when RED finds no violation and the fixture reuses the `atReview` setup.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test in the file passes: no violation of I1 to I6 at k = 0 or at any fault point of A to E, the broken-order component reported at exactly k = 2 and its twin at none, each invariant's hand-built violation reported, and the doc and CHANGELOG sentences present.

## Attempt evidence (acceptance 6; the reviewers see the diff, not the attempt record)
- RED at `de3743a`: `npm run typecheck && node --test tests/scenarios/fault-points.test.ts` exit 1, 14 tests, 6 pass, 8 fail, `duration_ms 5832.0962` (5.8 s). The first failure is the R4 test (actual `[]`, expected `[2]`); the other 7 are the doc and CHANGELOG assertions written before the docs.
- GREEN at `9db1d7d` (attempt 1): exit 0, 14 pass, `duration_ms 5977.6955`.
- GREEN at `d5e0257` (attempt 2, R3 decision 1 repair): exit 0, 15 pass, `duration_ms 6726.6839`; `npm test` 1422 pass, 0 fail, 6 skipped.
