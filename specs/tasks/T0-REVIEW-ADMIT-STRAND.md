---
id: T0-REVIEW-ADMIT-STRAND
title: A REVIEW_ADMITTED append that fails after the review pool admitted the request cancels that request in review r3 and in the ship, so the slot is freed and the card is reviewed and shipped again instead of waiting for good on a request nobody runs
status: merged
branch: T0-REVIEW-ADMIT-STRAND
worktree: D:\wt\AIDLC\T0-REVIEW-ADMIT-STRAND
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/review-admit-strand.test.ts
  - tests/scenarios/fault-points.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-REVIEW-ADMIT-STRAND.md
dod_command: npm run typecheck && node --test tests/scenarios/review-admit-strand.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/base-sync-review.test.ts tests/scenarios/base-sync-committed.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/review-block.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/run-driver.test.ts tests/surface/pre-review.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `review r3` (`CardRunner.formalReview`) has had its pool request admitted (`admitReview`) and the `REVIEW_ADMITTED` append throws, the command shall cancel that request (`ReviewQueue.cancel`, which frees its slot) and write no reservation, as it does for a refused reservation.
  - R2. WHEN the ship of `card next` (`CardRunner.ship`) has had its pool request admitted and the `REVIEW_ADMITTED` append throws, the command shall cancel that request and dispatch nothing, leaving the merge intent `intended` and writing nothing to the operation ledger.
  - R3. IF the cancellation of R1 or R2, or the cancellation that follows a refused `review r3` reservation, throws in turn, THEN the command shall rethrow the error that led to the cancellation (the append's or the reservation's), never the cancellation's.
  - R4. The `KNOWN_VIOLATIONS` list of `tests/scenarios/fault-points.test.ts` shall hold no pin for `C/append REVIEW_ADMITTED` (H1) and pin `D/append REVIEW_ADMITTED` (H2) with the difference left once the request is cancelled, an extra `['merge', 'intended', true]` operation beside the shipped one, which is the second-intent class of T0-OP-INTENT-DUP.
  - R5. `docs/OPERATIONS.md`, in the same-candidate paragraph of the Pre-review (R2) section, right after the sentence that ends with `a refused R3 reservation cancels its review-pool request.`, shall carry the OPERATIONS sentence of the Doc text section.
  - R6. `docs/ARCHITECTURE.md`, right after the `review-queue.ts` sentence of the `src/coordination/` paragraph, shall carry the ARCHITECTURE sentence of the Doc text section.
  - R7. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/scenarios/review-admit-strand.test.ts`, the R3 path, after the R2 pass when `card next` directs `review`: with `fs.appendFileSync` throwing for the `REVIEW_ADMITTED` line only (patched on the `node:fs` export), `formalReview` rejects with the injected error; the formal request (reviewer `primary`) is `cancelled`, pool `default` has no active slot, `review.invocations` is empty and the reviewer did not run; a second `formalReview` with no fault runs the reviewer once and its outcome is `pass`. At 794624a the request stays `running` with one active slot and the second call rejects with `a matching formal review is already running in pool`. [R1] [dod arm 2]
  - 2. Same file, the ship path, at SHIP after the R3 pass: `card next` with the `REVIEW_ADMITTED` append throwing rejects with the injected error; the ship's request (reviewer `codex-review`) is `cancelled`, pool `default` has no active slot, the card's one merge operation is `intended` and `DryRunShipPath.requests` is empty; the next `card next` returns `close`. At 794624a the request stays `running` with its slot and the next `card next` returns `wait` on `review:<key>`. [R2] [dod arm 2]
  - 3. Same file: with the `REVIEW_ADMITTED` append throwing and the cancellation's write throwing too (`fs.renameSync` onto the request file), `formalReview` and `card next` each reject with the append's error message, the request left `running`; with the reservation write throwing (`fs.renameSync` onto the card-run record) and the cancellation's write throwing, `formalReview` rejects with the reservation's error message. [R3] [dod arm 2]
  - 4. `tests/scenarios/fault-points.test.ts`: `KNOWN_VIOLATIONS` holds no `C/append REVIEW_ADMITTED` entry; the `D/append REVIEW_ADMITTED` entry keeps hypothesis H2, its difference is exactly `{ operations: [[SHIPPED], [['merge', 'intended', true], SHIPPED]] }` and its counterexample names `ops.findDuplicate` and the second intent; the judge test passes, and no other entry changes (reviewer-verified against the diff). The RED commit (both entries edited, no src change) fails the judge test naming both fault points; its first failing line and the DoD duration are in the card file's `## Attempt evidence` section. [R4] [dod arm 2]
  - 5. `tests/scenarios/review-admit-strand.test.ts` reads each sentence of the Doc text section in docs/OPERATIONS.md, docs/ARCHITECTURE.md and the CHANGELOG Unreleased section, one assertion per sentence, so removing any one fails the test. [R5] [R6] [R7] [dod arm 2]
  - 6. `npm run typecheck` is clean [dod arm 1]; the other files of the dod_command pass with no existing assertion changed apart from the two entries of acceptance 4 (reviewer-verified against the diff). [R1] [R2] [dod arm 2]
depends_on: []
budget: 260
tdd: true
diagnosis:
  root_cause: "`admitReview` (src/loop/card-runner.ts:2256-2264) makes the pool request `running` and puts its key in the pool's active slots (`ReviewQueue.admit`, src/coordination/review-queue.ts:141-143) before the command appends `REVIEW_ADMITTED`, at :1555 in `formalReview` and at :986 in `ship`. Each append sits outside the handler that cancels the request when the command does not go on: in `formalReview` the try whose catch calls `this.queue.cancel` spans :1568-1596, after the append; in `ship` the cleanups that cancel the intent and the request start at :991. A throw from the append leaves the request `running` with its slot and no reservation, envelope or failure marker, so neither `releaseFailedReservation` nor `retainedFormalResult` settles it, and no command cancels a running request (`aidlc review status` only lists it). Every later `formalReview` of the candidate refuses at :1551 (`a matching formal review is already running in pool ...; join it, do not dispatch another`), the ship's next call joins the running request and waits on `review:<key>` at :974-978, and with `maxConcurrent` 1 every other request of the pool is refused admission while the slot is held. The card cannot finish without editing `.aidlc/review-queue/` by hand. Pinned at 794624a by `C/append REVIEW_ADMITTED` (H1) and `D/append REVIEW_ADMITTED` (H2) in tests/scenarios/fault-points.test.ts."
  same_class: "Every place a card-run command holds an admission it may not use (sweep): (1) :1555, the `formalReview` append: fixed here, moved into the reservation try. (2) :986, the `ship` append: fixed here, a handler that cancels the request. (3) the catch at :1593-1596: its cancel can throw and replace the reservation error; made best effort here (R3), as the ship cleanups at :997-1011 already are. (4) `admitReview` when the head of the pool is another requester's request: `queue.admit` makes that request `running` on the caller's behalf and the caller then waits (:980-985) or refuses (:1553), so the other card's request holds the slot with nobody to run it; reproduced on the queue at 794624a (scratch script, see Pre-check), not by the fault-point test: not fixed here, card T0-REVIEW-ADMIT-FOREIGN (non_goals). (5) a process that dies between the admission and the reservation or the dispatch: no in-process handler covers it (non_goals). (6) the two writes inside `admit` (:142-143) and `cancel` (:201-202): review-queue writes are not fault points and stay as they are."
sweep: "git grep -n -E 'admitReview[(]|queue[.]admit[(]|REVIEW_ADMITTED' -- src (main at 794624a): card-runner.ts:979 and :986 (ship), :1552 and :1555 (formalReview), :2256-2262 (admitReview, the two queue.admit calls), types.ts:889 (the event type). git grep -n 'queue.cancel' -- src/loop/card-runner.ts: :1008 and :1030 (ship cleanups, both after :986), :1318 (R7 reviewer switch), :1594 (refused reservation, after :1555), :1629 (dispatch that failed before a receipt), :1894 (release of a failed reservation). src/cli/main.ts has no command that cancels a pool request. git grep -n -E 'REVIEW_ADMITTED|already running in pool' -- tests: tests/scenarios/t0-flow.test.ts:3340 counts REVIEW_ADMITTED on the cap refusal, which happens before the pool request and is unchanged; tests/core/journal-event-types.test.ts lists the type. docs/OPERATIONS.md:269 carries the refused-reservation sentence and docs/ARCHITECTURE.md:16 the review-queue.ts sentence."
forbid: ["a change to src/coordination/review-queue.ts (`enqueue`, `admit`, `cancel`) or to src/coordination/reconcile.ts", "marking the merge intent `cancelled` or writing the operation ledger in the new handler of `ship` (the intent stays `intended`, T0-OP-INTENT-DUP owns it)", "swallowing the `REVIEW_ADMITTED` error: both commands still fail with it", "moving the `REVIEW_ADMITTED` append after the reservation write in `formalReview` or after the dispatch in `ship`", "a new command, CLI flag or journal event type", "changing an assertion of an existing test other than the two `KNOWN_VIOLATIONS` entries of R4"]
non_goals: ["an admission that makes another requester's request `running` (`admitReview` at the head of a shared pool): card T0-REVIEW-ADMIT-FOREIGN", "a process that dies between the admission and the reservation or the dispatch, and a cancellation that fails (acceptance 3): the request stays `running` and no command releases it", "requests left `running` in existing state before this card (no migration, no state edited by hand)", "the merge intent the ship leaves `intended`, and the second intent the next ship records for it (T0-OP-INTENT-DUP)", "the order of the two writes inside `ReviewQueue.admit` and `ReviewQueue.cancel`"]
hygiene: "Line numbers are from main at 794624a and are re-read at PREPARE. The RED commit adds tests/scenarios/review-admit-strand.test.ts and makes the two `KNOWN_VIOLATIONS` edits of R4, with no src change; the src change follows. The new file builds its fixture on `makeFixture`, `writeCard` and `goalForCards` (tests/scenarios/_harness.ts) with the config of the fault-point test (gateRequired, `fake-r2` with one round, `fake-p` as the formal reviewer `primary`, the dry-run ship), and injects faults by patching `fs.appendFileSync` and `fs.renameSync` on the `node:fs` export with `syncBuiltinESMExports`, restored in a finally, so the ordering is proven at the boundary every writer passes through (docs/LESSONS.md 2026-09-18 T1-REVIEW-INVARIANTS). Doc tests read the exact sentences (2026-09-24 T1-OPUS55-MODELS). Run the mutation sweep before the first review (2026-09-24 T1-OPUS55-R3-3): the append left outside the try, the ship's cancel dropped, the merge intent cancelled as well, the cancellation's error rethrown, the cancel run before the append. Every receipt an acceptance item asks for goes into `## Attempt evidence` of this file (2026-10-23 T1-VERIFY-FAULT-POINTS). Lock and ordering work has drawn many R3 findings (2026-09-15 T0-CARD-TAKEOVER-2): the limits are stated in the Design section from the first candidate."
doc_sync: docs/OPERATIONS.md (Pre-review (R2), same-candidate paragraph), docs/ARCHITECTURE.md (`src/coordination/` paragraph), CHANGELOG.md
---

# T0-REVIEW-ADMIT-STRAND

## Deliverable
`CardRunner.formalReview` and `CardRunner.ship` (src/loop/card-runner.ts) cancel the pool request they were admitted under when the `REVIEW_ADMITTED` append that follows the admission throws, and fail with the append's error. The slot is freed, so the next `review r3` admits a new request for the same key and the next `card next` ships. Today the request stays `running` with its slot, the card waits for good, and the held slot keeps every other review of the pool waiting. The ship leaves its merge intent `intended`, the class T0-OP-INTENT-DUP removes. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md state the rule.

## Design

### Write order
`review r3` (`formalReview`), at 794624a: enqueue (:1549), admission (:1552, the request `running`, its key in the pool's active slots), `REVIEW_ADMITTED` append (:1555), then the try (:1568) holding the reservation write under the card-run lock, whose catch cancels the request. New: the append moves to the first statement of that try, so the order is admission, then inside the try the append and the reservation write; the catch cancels the request as before. Its cancel runs in a nested try, so the command rethrows the append's or the reservation's error (R3).

The ship of `card next`, at 794624a: intent (:951), `OPERATION_INTENT` (:964), enqueue (:967), `REVIEW_REQUESTED` (:973), admission (:979), `REVIEW_ADMITTED` (:986), the record re-read whose cleanups cancel the intent and the request (:991-1040), `markIssued` (:1041). New: the append at :986 runs in a try whose catch cancels the request in a nested try and rethrows the append's error. The catch writes nothing else: no intent status, no journal event, no card-run write.

### What each failure leaves, and its recovery
- `REVIEW_ADMITTED` append throws in `review r3`: the request is `cancelled` and its slot free, no reservation exists; the next `review r3` enqueues the same key again (a cancelled request is replaced, review-queue.ts:79), is admitted and runs the reviewer once.
- The same in the ship: the request is `cancelled`, the intent `intended`, nothing dispatched. The next `card next` ships. Until T0-OP-INTENT-DUP lands it records a second intent beside the first (the H4 state, pinned as the new H2 difference).
- The cancellation throws as well (acceptance 3), or the process dies between the admission and the cancellation: the request stays `running`, as at 794624a; the command still reports the append's error. No command releases it (non_goals).
- The reservation write throws (unchanged path): the request is cancelled; a cancellation that throws no longer hides the reservation's error.

## Doc text (pinned by acceptance 5)
`docs/OPERATIONS.md`, after `a refused R3 reservation cancels its review-pool request.`:
- When the `REVIEW_ADMITTED` append fails after the review pool admitted the request, `review r3` and the ship of `card next` cancel that request, which frees its slot, and fail with the append's error (card T0-REVIEW-ADMIT-STRAND): `review r3` writes no reservation, the ship dispatches nothing and leaves its merge intent `intended`, and a cancellation that fails in turn leaves the request `running` while the command still reports the append's error.

`docs/ARCHITECTURE.md`, after the `review-queue.ts` sentence:
- A card-run command whose `REVIEW_ADMITTED` append fails after the queue admitted its request cancels that request, freeing the slot (card T0-REVIEW-ADMIT-STRAND).

`CHANGELOG.md`, Unreleased:
- T0-REVIEW-ADMIT-STRAND (bugfix): a `REVIEW_ADMITTED` append that fails after the review pool admitted the request no longer leaves the request `running` with its slot: `review r3` and the ship of `card next` cancel it and fail with the append's error. Before, every later `review r3` of the candidate refused with "a matching formal review is already running", the ship waited on `review:<key>` for good, and the held slot kept every other review of the pool waiting.

## Pre-check (drafting, scratch clone of 794624a outside the repository)
- R1 and R2 applied by hand, `node --test tests/scenarios/fault-points.test.ts`: the judge reported `pin C/append REVIEW_ADMITTED (H1): the fault point reaches the fault-free end state` (drive `next -> review, formalReview -> done, next -> close`) and, for `D/append REVIEW_ADMITTED`, the changed difference `operations fault-free [["merge","succeeded",true]], observed [["merge","intended",true],["merge","succeeded",true]]` (drive `next -> close, next -> close`); no other pin changed and no fault point became unpinned.
- With the change of T0-OP-INTENT-DUP added, `D/append REVIEW_ADMITTED` reached the fault-free end state, and `npm test` passed with both changes and their pins removed: 1441 tests, 0 failures.
- With T0-OP-INTENT-DUP alone (this card absent), `D/append REVIEW_ADMITTED` stayed at WAIT with the request `running` and the stranded intent `intended`: this card has to land first (T0-OP-INTENT-DUP depends on it).
- `ReviewQueue` alone (scratch script): request X `running`, Y and Z queued, X completed, then Z's `admit` admitted Y, and Y's next `enqueue` returned `joined` with Y `running` and one active slot: the case of non_goal T0-REVIEW-ADMIT-FOREIGN.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-admit-strand.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/r3-fallback.test.ts tests/scenarios/base-sync-review.test.ts tests/scenarios/base-sync-committed.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/scenarios/review-block.test.ts tests/scenarios/two-windows.test.ts tests/scenarios/run-driver.test.ts tests/surface/pre-review.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean; the new tests pass (the request cancelled and the slot free on both paths, the append's error kept when the cancellation fails, the doc and CHANGELOG sentences present); the fault-point judge passes with no `C/append REVIEW_ADMITTED` pin and the residual `D/append REVIEW_ADMITTED` pin; the other listed files pass.

## Attempt evidence
BUILD attempt 1, base 423bc26 (origin/main), Windows 11, Node 22.

### Reproduction
At 423bc26 the pins `C/append REVIEW_ADMITTED` (H1) and `D/append REVIEW_ADMITTED` (H2) of tests/scenarios/fault-points.test.ts reproduce the defect: the formal request stays `running` with one active slot and `card next` directs `review` for all 12 calls (H1); the ship's request stays `running` and every `card next` waits on `review:<key>` (H2). The new tests/scenarios/review-admit-strand.test.ts reproduces both at the command boundary (acceptance 1 and 2 fail on `actual: 'running'`, `expected: 'cancelled'`).

### RED (commit 673e90c, tests and the two `KNOWN_VIOLATIONS` edits, no src change)
Command: the dod_command. Exit code 1; 386 tests, 378 pass, 8 fail; `duration_ms 39446.7863`.
First failing line (TAP):
```
    not ok 11 - every fault point of A to E reaches its command's fault-free end state or matches its pin exactly, and no pin is stale [R5] [R6]
```
The judge names both fault points:
```
+   stale: [
+     'pin D/append REVIEW_ADMITTED (H2): the difference changed: pinned operations fault-free [["merge","succeeded",true]], observed [["merge","intended",true],["merge","succeeded",true]]; observed directive fault-free "close", observed "wait"; ...
+   unpinned: [
+     'C/append REVIEW_ADMITTED: directive fault-free "close", observed "review"; state fault-free "CLOSE", observed "SHIP"; ...
```
The other 7 failures are acceptance 1, 2 and 3 (the third case: the cancellation's error replaced the reservation's) and the four acceptance 5 sentence checks.

### GREEN (commits 8442f65 fix, 8fcf482 docs)
Command: the dod_command. Exit code 0; 386 tests, 386 pass, 0 fail; `duration_ms 39742.8415`. `npm test` (CLAUDE_CODE_SESSION_ID and AIDLC_SESSION unset): exit 0, 1522 tests, 1516 pass, 0 fail, 6 skipped.

### Write order and recovery of the fix
- `review r3` (`formalReview`): enqueue, admission (`admitReview`: the request `running`, its key in the pool's active slots), then one try: the `REVIEW_ADMITTED` append (card-runner.ts:1588), then the reservation write under the card-run lock. The catch cancels the request (`ReviewQueue.cancel`: request file `cancelled`, then the slot released) in a nested try and rethrows the error that entered the catch.
- Ship of `card next`: intent, `OPERATION_INTENT`, enqueue, `REVIEW_REQUESTED`, admission, then the `REVIEW_ADMITTED` append (card-runner.ts:993) in a try whose catch cancels the request in a nested try (:998) and rethrows the append's error; the catch writes no intent status, no journal event and no card-run record. The record re-read, `markIssued`, `OPERATION_ISSUED` and the dispatch follow unchanged.
- Append fails, cancellation lands: the request is `cancelled` and its slot free; `review r3` has written no reservation and the next `review r3` admits a new request for the key; the ship has dispatched nothing, the intent stays `intended`, and the next `card next` records a second intent and ships (pinned as the new H2 difference, T0-OP-INTENT-DUP).
- Append fails, cancellation fails too: the request stays `running` with its slot, as at 423bc26; the command reports the append's error (acceptance 3). No command releases it (non_goals).
- Reservation write fails, cancellation fails too: the command reports the reservation's error, the request stays `running` (acceptance 3).
- The process dies between the admission and the cancellation: the request stays `running` (non_goals).
- The journal and card-run writes counted by the fault-point check are unchanged in number and order (the append still precedes the reservation write; the ship's writes are untouched); only review-queue writes, which are not fault points, were added on the failure paths.

### Sweep (every admission followed by a write before the cancelling handler)
`git grep -n -E 'admitReview[(]|queue[.]admit[(]|REVIEW_ADMITTED' -- src` at 423bc26: `admitReview` has two callers, `ship` (append then at :992) and `formalReview` (append then at :1563); `preReview` does not admit. Both fixed. The refused-reservation catch (:1602 at 423bc26) is made best effort (R3). The ship cleanups after the append (:1013-1036 at 423bc26) were already best effort.

### Mutation sweep (run on 8fcf482 against review-admit-strand.test.ts and fault-points.test.ts; each restored, none committed)
| Mutant | Result |
|---|---|
| M1 formalReview append left before the try | killed: acceptance 1, fault-point judge |
| M2 ship cancel dropped | killed: acceptance 2, judge |
| M3 ship handler also marks the intent `cancelled` | killed: acceptance 2, judge |
| M4 formalReview cancellation error rethrown | killed: acceptance 3 |
| M5 ship cancellation error rethrown | killed: acceptance 3 |
| M6 formalReview catch cancel dropped (slot not released) | killed: acceptance 1, judge |
| M7 ship handler swallows the append error | killed: acceptance 2, 3 |
| M8 ship cancel run before the append | killed: acceptance 3, judge |
| M9 formalReview append moved after the reservation write | killed: acceptance 1, judge |
| M10 formalReview cancel run before the append | killed: acceptance 3, judge, five fault-free runs |
| P1 `C/append REVIEW_ADMITTED` pin restored | killed: judge (stale pin) |
| P2 `D/append REVIEW_ADMITTED` difference changed | killed: judge |
| P3 `D/append REVIEW_ADMITTED` pin removed | killed: judge (unpinned) |

No survivors.

### verify-card-run-writes
`git diff --name-only 794624a0d26cbb5ee8eec2a363b7a578590abef9 -- <record files>` lists src/loop/card-runner.ts and tests/scenarios/fault-points.test.ts. The counted writes of the covered commands keep their number and order; the check's pins were changed to match the code (H1 removed, H2 rewritten) and the check passes (fault-points.test.ts inside the GREEN DoD). The coverage record (files and functions) needs no change; the sync commit moves on main after the merge.
