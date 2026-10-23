---
id: T1-VERIFY-LIVENESS
title: The fault-point test continues each fault run to rest and fails when the card does not reach the fault-free end state, apart from violations pinned with their counterexamples
status: todo
branch: T1-VERIFY-LIVENESS
worktree: D:\wt\AIDLC\T1-VERIFY-LIVENESS
plan_ref: plans/review-verification.md#order-of-work
allow_paths:
  - tests/scenarios/fault-points.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-VERIFY-LIVENESS.md
dod_command: npm run typecheck && node --test tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `tests/scenarios/fault-points.test.ts` has run the recovery of T1-VERIFY-FAULT-POINTS after the fault-free run or a fault run of a covered command (A to E), it shall continue that run under the step rules of R2 until `next` returns `close`, `done` or `stop` or until 12 `next` calls in all (the recovery's included), and then compare the run's end state with the end state of the same command's fault-free run.
  - R2. After each `next`, the driver shall take the one move the directive names: `build`, `recordAttempt` with the fault-free run's outcome, DoD receipt, RED receipt and candidate sha; `pre-review`, `preReview`; `review`, `formalReview`; `wait`, the fixture clock moved forward by the directive's `pollSeconds`; every other kind ends the drive, and a move that throws is logged and followed by the next `next`.
  - R3. The end state of a run shall be one record compared with `deepEqual`: the drive's last directive kind; the card run's `state`, `stop.reason` and `mergeVerified`; its attempts as `[n, outcome]` and the episode's `terminal`; its R2 rounds as `[cycle, round, outcome]`; its R3 invocations as `[reviewer, outcome]` with `substantiveDecisions`, `substantiveBlocks` and `noVerdictRetriesUsed`; the goal's review-pool requests as a sorted list of `[reviewer, state]` and each pool's count of active slots; the card's operations as a sorted list of `[kind, status, whether an OPERATION_INTENT event names the operation]`; and the counts per type and outcome or status of the goal journal's ATTEMPT_STARTED, ATTEMPT_FINISHED, PRE_REVIEW_DECIDED, REVIEW_DECIDED, OPERATION_RESULT and OPERATION_RECONCILED events, without the decision events whose `decision` names a discard, release, abandonment or supersession; no timestamp, id, hash, revision, evidence entry or lease field takes part.
  - R4. The fault-free end state of each of A to D shall deep-equal the literal `FAULT_FREE_CLOSE` and that of E the literal `FAULT_FREE_TIME`, both written in the test from the fixture's design and both reached inside the bound of R1.
  - R5. The test shall fail for every fault point whose end state differs from its command's fault-free end state unless `KNOWN_VIOLATIONS` pins that fault point with exactly that difference (each differing path with its fault-free and observed value), a counterexample in the code's words and, where `docs/OPERATIONS.md` assigns the recovery to a person, that documented step.
  - R6. WHEN a pinned fault point reaches the fault-free end state, ends with a difference other than the pinned one, or is not counted by the counting pass, the test shall fail and name that pin.
  - R7. The test shall name each fault point by its command and call so that the name survives a change of k (`A/append ATTEMPT_FINISHED`, `C/record 2`: the event type for a journal append, the ordinal among the command's card-run record writes for a record write, and an ordinal after the event type only when one command appends that type twice).
  - R8. The test shall show, on hand-built end states and pins, the judge reporting an unpinned difference, a pin whose fault point now reaches the fault-free end state, a pin whose difference changed, a pin whose fault point is not counted, and nothing for a pin that matches.
  - R9. The `Fault-point check` section of `docs/OPERATIONS.md` shall state the liveness check: the continuation and its bound, the end-state record, the pin list and that a fix removes its pin.
  - R10. The CHANGELOG Unreleased section shall carry an entry naming T1-VERIFY-LIVENESS, the end-state comparison, the pinned known violations and the failure on a pin that no longer reproduces.
acceptance:
  - 1. `tests/scenarios/fault-points.test.ts`: the fault-free continuation of A, B, C and D ends at `close` with an end state deep-equal to `FAULT_FREE_CLOSE`, and that of E at `stop` with an end state deep-equal to `FAULT_FREE_TIME`, each inside 12 `next` calls. [R1] [R3] [R4] [dod arm 2]
  - 2. Same file: over every fault point of A to E, `deepEqual(judge(observed, KNOWN_VIOLATIONS), { unpinned: [], stale: [] })`; a failure message names the fault point, each differing path with its fault-free and observed value, and the drive's steps with their directives, moves and refusals. [R5] [R6] [dod arm 2]
  - 3. Same file: every `KNOWN_VIOLATIONS` entry names a fault point, the exact difference, the hypothesis (H1 to H10) it confirms or `new`, a counterexample that names the functions and the refusal, directive or record field in the code's words, and `docRecovery` where docs/OPERATIONS.md assigns the step to a person; every hypothesis the RED refuted is listed with its observed end state in the card file's `## Attempt evidence` section on the card branch, which the reviewers see in the diff (reviewer-verified against the diff). [R5] [dod arm 2]
  - 4. Same file: the judge reports the four hand-built cases of R8 (one unpinned difference, one pin now at the fault-free end state, one pin with a changed difference, one pin on an uncounted fault point) with the fault point or pin named, and reports nothing for the matching pin. [R8] [dod arm 2]
  - 5. Same file: the fault-point names of each command's counting pass follow R7 and are unique within the command, and the drive logs show a `build` move after `A/record 1` and `wait` moves that advance the clock after `B/record 2`, so both step rules run on the base. [R2] [R7] [dod arm 2]
  - 6. Nothing under `src/` changes, no assertion of T1-VERIFY-FAULT-POINTS changes, the six sentences that card pinned in docs/OPERATIONS.md stay verbatim, and the end-state record, the step rules and the bound in the diff are those of R1 to R3 (reviewer-verified against the diff); `npm run typecheck` is clean. [R1] [R2] [R3] [dod arm 1]
  - 7. The file still finishes inside the `timeout: 30_000` of its top-level `describe`, spawns no process and calls no `Date.now()` (reviewer-verified); the DoD run's duration at RED is in the card file's `## Attempt evidence` section on the card branch (the reviewers see the diff, not the attempt record). [R1] [dod arm 2]
  - 8. Same file: `docs/OPERATIONS.md` contains the three sentences of the Doc text section verbatim and the CHANGELOG Unreleased section contains its entry sentence verbatim, each asserted on its own so that removing any one fails the test. [R9] [R10] [dod arm 2]
depends_on: [T1-VERIFY-FAULT-POINTS]
budget: 360
tdd: true
forbid: ["any change under src/ or outside allow_paths (a confirmed violation is pinned, never fixed here)", "weakening a check of T1-VERIFY-FAULT-POINTS or of this card, or dropping a fault point or a covered command", "pinning a difference without its counterexample, or pinning one the run does not reproduce", "changing the end-state record, the step rules or the bound after the RED commit", "modelling a person's step (aidlc ops reconcile, a lock removed by hand) inside the drive", "spawning a process or calling Date.now() in the test"]
non_goals: ["fixing any violation the check finds (each is its own T0-bugfix card)", "fault points or covered commands beyond those of T1-VERIFY-FAULT-POINTS", "a process that dies mid-command, a torn journal line, or two sessions", "reviewer runs after recovery (a cost, not state) and the CARD_STATE, LEASE_*, NOTE, REVIEW_REQUESTED and REVIEW_ADMITTED events as part of the end state", "the project verify skill (T1-VERIFY-SKILL)"]
hygiene: "Line numbers in this card are from main at 597e9a2 and are re-read at PREPARE, after the loop-efficiency goal and T1-VERIFY-FAULT-POINTS have merged; the helper names (fixture, fault boundary, counting pass, recovery) are the ones that card wrote, and this card extends them without changing an assertion of it. Waits move the fixed fixture clock only (fx.advance); the lease TTL (10 min, src/coordination/lease.ts:20) is renewed by every next and RECONCILE_GRACE_MS is 5 min (src/core/types.ts:1014). The hypotheses H1 to H10 were written from the code before any run, and FAULT_FREE_CLOSE and FAULT_FREE_TIME from the fixture's design, so the pins are checked against an independent prediction; a pin copied from the RED log without its hypothesis or a reading is the tautology the tdd skill forbids. No existing test changes."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-VERIFY-LIVENESS

## Deliverable
The fault-point test of T1-VERIFY-FAULT-POINTS gains a liveness check (spec R22, R23, and R21 for its docs): each fault run, after the recovery that card checks, is driven on to rest, and its end state must equal the end state of the fault-free run of the same command. Every fault point that ends elsewhere on the base is pinned in `KNOWN_VIOLATIONS` with its counterexample, so the suite stays green, a fix must remove its pin (a pin that stops reproducing fails the test), and each pin is filed as its own T0-bugfix card at CLOSE. The card changes nothing under `src/`.

## Design

### Drive to rest
The run continues from where the recovery of T1-VERIFY-FAULT-POINTS left it, with the same fixture, card run, clock and effect counters. Each step is `next`, then the move its directive names (R2). The drive ends at `close`, `done` or `stop`, at any other kind it has no move for, or after 12 `next` calls in all. The bound: the fault-free continuation from A needs 3 `next` calls (`pre-review`, `review`, the ship to `close`); the longest designed recovery, an R2 round whose result was lost after its reviewer ran (`B/record 2`), needs 7 `next` calls of 60 s waits to pass the round's 1 s timeout and the 5 min grace (card-runner.ts:1111) and then 2 more, 9 in all. 12 leaves 3 spare. A move that throws (a refusal) does not end the drive: the run's inability to move on is what the end state records.

### End state
R3 is the whole record. The fault-free values (R4), from the fixture's design:
- `FAULT_FREE_CLOSE` (A to D): last directive `close`; state `CLOSE`, no stop, `mergeVerified` true; attempts `[[1, 'success']]`, no terminal; R2 rounds `[[0, 1, 'pass']]`; R3 invocations `[['fake-p', 'pass']]` with 1 substantive decision, 0 blocks, 0 no-verdict retries; the formal and the ship's pool requests `completed`, 0 active slots; operations `[['merge', 'succeeded', true]]`; journal counts ATTEMPT_STARTED 1, ATTEMPT_FINISHED success 1, PRE_REVIEW_DECIDED pass 1, REVIEW_DECIDED pass 1, OPERATION_RESULT succeeded 1.
- `FAULT_FREE_TIME` (E): last directive `stop`; state `STOP`, stop reason `time`, `mergeVerified` false; the same attempt, R2 and R3 entries; the formal request `completed`, 0 active slots; no operation; the same journal counts without OPERATION_RESULT.

The decision events left out of the counts (discard, release, abandonment, supersession) record a result that did not take effect; the persisted ledgers in the same record show what did.

### Judge and pins
`judge(observed, pins)` returns `{ unpinned, stale }`: `unpinned` holds every fault point whose difference from the fault-free end state is not empty and not pinned exactly; `stale` holds every pin whose fault point has an empty difference, another difference, or was not counted. A pin is `{ faultPoint, difference, hypothesis, counterexample, docRecovery? }`.

### RED
Commit the check with `KNOWN_VIOLATIONS` empty: the test fails on each hypothesis that reproduces, and the RED log is the source of the pins. If no hypothesis reproduces, the RED is the judge self-test of R8 committed with `judge` returning nothing. GREEN adds one pin per reproduced difference, each checked against its hypothesis or explained by reading the code.

## Hypotheses (reading of 597e9a2; the RED confirms or refutes each)
| H | Fault point | Predicted end state, where it differs from the fault-free one |
|---|---|---|
| H1 | `C/append REVIEW_ADMITTED` (1522) | No rest: each `next` directs `review` and each `formalReview` refuses at 1518 (a matching formal review is already running), since the append sits outside the try (1533-1559) that cancels the pool request. Last directive `review`, state `SHIP`, no R3 invocation, the formal request `running` with 1 active slot, no operation, no REVIEW_DECIDED or OPERATION_RESULT. |
| H2 | `D/append REVIEW_ADMITTED` (973) | No rest: each `next` records an intent, cancels it at 962 and waits on `review:<key>`. Last directive `wait`, state `WAIT`, the ship's request `running` with 1 active slot, operations one `intended` and one `cancelled` per `next`, no OPERATION_RESULT. |
| H3 | `D/append OPERATION_INTENT` (951) | CLOSE reached; an extra `['merge', 'intended', false]`: `findDuplicate` (src/coordination/reconcile.ts:103-107) returns the stranded intent and a second one is recorded. |
| H4 | `D/append REVIEW_REQUESTED` (960) | CLOSE reached; an extra `['merge', 'intended', true]`. |
| H5 | `A/record 1` (899, after ATTEMPT_FINISHED at 874) | CLOSE reached; ATTEMPT_FINISHED success counted 2: the record still shows the attempt running and the `build` move records it again. |
| H6 | `C/append REVIEW_DECIDED` (1954) | CLOSE reached; REVIEW_DECIDED pass counted 0. |
| H7 | `B/append PRE_REVIEW_DECIDED` (2195) | CLOSE reached; PRE_REVIEW_DECIDED pass counted 0. |
| H8 | `D/append OPERATION_RESULT` (2394) | CLOSE reached; OPERATION_RESULT succeeded counted 0. |
| H9 | `D/append OPERATION_ISSUED` (1029) | No rest: the operation is `issued` (1028) but the ship never ran; each `next` waits on it (src/core/card-machine.ts:90-91). The ship's request `running` with 1 active slot, operations `[['merge', 'issued', true]]`. docRecovery: `aidlc ops reconcile` (docs/OPERATIONS.md, Sessions). |
| H10 | `D/record 1` (2316, after the dry-run merge) | No rest: the merge ran, its record write was lost; the operation stays `issued` and each `next` waits on it; `mergeVerified` false. docRecovery: `aidlc ops reconcile`. |

Predicted to reach the fault-free end state (no pin): `A/append ATTEMPT_FINISHED`; `B/record 1`; `B/record 2` (the lost round is abandoned after the grace and run again); `C/record 1` (the reservation's catch cancels the pool request); `C/record 2` (the retained result commits under the same invocation); `D/append LEASE_RENEWED`; `D/record 2`; every fault point of E.

H1 to H8 are the four classes the coordinator named (a pool slot left `running`, an operation left `intended`, an attempt journaled before its record, a decision event lost). H9 and H10 follow the explicit-UNKNOWN design, whose recovery is a person's `aidlc ops reconcile`; they are pinned with that `docRecovery` so the user decides whether they are defects.

## Doc text (pinned by acceptance 8)
`docs/OPERATIONS.md`, appended to the `## Fault-point check` section after its six sentences:
1. The liveness check (card T1-VERIFY-LIVENESS) continues each fault run until `card next` returns `close`, `done` or `stop`, or for 12 `card next` calls, taking the move each directive names (`card attempt`, `review pre`, `review r3`, or a wait of `pollSeconds` on the fixture clock), and compares the end state with the fault-free run's: the card state and stop, the attempts, both review ledgers, the review-pool requests and slots, the card's operations and the decision events of the journal.
2. A fault point whose end state differs fails the test unless `KNOWN_VIOLATIONS` in the test file pins it with that difference and its counterexample; a pin that no longer reproduces fails the test too, so a fix removes its pin in the same change.
3. Each pin is a defect to file as a T0-bugfix card, except where the pin names a recovery these docs assign to a person, such as `aidlc ops reconcile` for an operation left `issued`.

`CHANGELOG.md`, Unreleased, the entry sentence:
- T1-VERIFY-LIVENESS: the fault-point test continues each fault run to rest and fails when the card does not reach the fault-free end state (card state, attempts, review ledgers, review-pool slots, operations, journal decisions), apart from the violations pinned in `KNOWN_VIOLATIONS` with their counterexamples; a pin that no longer reproduces fails the test.

## Close
At CLOSE this file gains a `## Known violations` section: one line per pin (fault point, difference, counterexample, `docRecovery` when set), each for the planner to file as its own T0-bugfix card. The card files none itself and fixes none.

## Risks
- More differences than H1 to H10 at RED: each needs a reading before it is pinned (`new` in acceptance 3), which is the main time risk.
- The drive changes no state outside the fixture, but a wait moves the fixture clock; a bound that is too short shows as a fault-free run that does not rest (acceptance 1), never as a pin.
- Size and time: about 300 added test lines on the infrastructure T1-VERIFY-FAULT-POINTS builds, and two doc edits. It fits the 3 h card deadline when the RED differences are close to H1 to H10.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test in the file passes: the fault-free end states equal their literals, every fault point reaches the fault-free end state or matches its pin exactly, no pin is stale, the judge self-test reports its four cases, and the doc and CHANGELOG sentences are present.
