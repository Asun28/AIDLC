---
id: T0-CARD-STATE-STORED
title: "The CARD_STATE of a SHIP or PREPARE selection names the state each card-run write of its branch stores, and is journaled after that write"
status: todo
branch: T0-CARD-STATE-STORED
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/card-state-stored.test.ts
  - tests/scenarios/card-state-owed.test.ts
  - tests/scenarios/ship-effect-unknown.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - bench/outcome/README.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - changelog.d/T0-CARD-STATE-STORED.md
  - specs/tasks/T0-CARD-STATE-STORED.md
dod_command: npm run typecheck && node --test tests/scenarios/card-state-stored.test.ts tests/scenarios/card-state-owed.test.ts tests/scenarios/ship-effect-unknown.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/foreign-dispatch.test.ts tests/scenarios/card-contract-gate.test.ts tests/scenarios/deadline.test.ts tests/scenarios/extend-running-card.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-ci.test.ts tests/core/owed-event.test.ts tests/surface/outcome-ingest.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. When `card next` selects SHIP or PREPARE, no `CARD_STATE` of that selection shall be appended before the branch's first card-run write. The append at the start of `ship` (`src/loop/card-runner.ts:1727`) is removed.
  - R2. Each card-run write the SHIP or PREPARE branch makes after the selection (the list in `sweep`, including writes through `updateCardRun` outside `saveOwing`, such as the review gates and `applyShipResult`) that stores a state other than the state the record held before that write shall carry one `CARD_STATE` event in the run's `journalOwed`, with `from` the state the record held before the write, `to` the state the write stores, `reason` the selection reason when `to` is the selected state and otherwise the reason of the directive the branch returns (the stop detail for a STOP), and `eventKey`. It is appended to the goal journal by the same command only after that write lands, under the dispatch writer while there is one (as T0-CARD-STATE-OWED R4). A write that leaves the stored state unchanged (the ship's locked re-read at :1835) carries none.
  - R3. When a write of R2 is refused (`CARD_RUN_STALE`, `ForeignLeaseError`, `LOCKED`, or any other throw of the save), the command shall leave no `CARD_STATE` of that write in the goal journal.
  - R4. When the append of R2 fails after its write landed, the event shall stay owed on the run and the next `card next`, `card attempt`, `review pre` or `review r3` appends it once, marked `completed: true` (`deliverOwed`). After the ship's merge intent is recorded, a failed append of R2 shall not throw: the command returns the directive of the landed write, and the merge intent, the operation result and the review pool request are settled as they are when the append succeeds.
  - R5. In a run with no fault and no refusal, the goal journal shall hold one `CARD_STATE` per change of the stored state made by the SHIP and PREPARE branches, and none for a selected state the record never held. Examples: a ship that merges journals BUILD to CLOSE (main: BUILD to SHIP); a PREPARE whose worktree is attached journals X to BUILD (main: X to PREPARE); a PREPARE stopped on an expired lease journals X to STOP; a ship stopped at the driver boundary journals BUILD to SHIP as on main.
  - R6. `docs/OPERATIONS.md` (Audit, the T0-JOURNAL-FAULT-EVENTS paragraph) and `docs/ARCHITECTURE.md` (the sentence T0-CARD-STATE-OWED added) shall state R2 and R5 for the SHIP and PREPARE branches; `bench/outcome/README.md` (the `state_spans` limit paragraph) shall state that from this card on a SHIP span exists only where a write stored SHIP.
acceptance:
  - 1. `tests/scenarios/card-state-stored.test.ts`, new file. A built candidate (the `builtCandidate` fixture of `tests/scenarios/card-state-owed.test.ts:192`) shipped with `DryRunShipPath(['merged'])`: the journal holds no BUILD to SHIP and exactly one BUILD to CLOSE, after the write that stored CLOSE (the `wrapSaves` `landed` form of that file, extended to `updateCardRun`), with `from`, `to`, `reason`, `eventKey` and no `completed`. Same with `['auth-failed']`: one `CARD_STATE` per stored state change of that path, each `to` equal to the state its write stored, and none to SHIP unless a write stored SHIP. RED on main. [R1] [R2] [R5] [dod arm 2]
  - 2. Same file. A SHIP selection whose first ship write (the WAIT save of an unreconciled CI rerun, :1729) is refused as stale by the `wrapSaves` `before` hook: the journal holds no `CARD_STATE` from that call; a second `card next` journals exactly one for its own landed write. RED on main (BUILD to SHIP from the refused call). [R2] [R3] [dod arm 2]
  - 3. Same file. PREPARE on an expired foreign lease (the fixture of `tests/scenarios/foreign-dispatch.test.ts:323`): the stored run is STOP and the journal holds one `CARD_STATE` to STOP and none to PREPARE. A PREPARE whose worktree is attached (dry-run ship path) journals one to BUILD and none to PREPARE. A PREPARE that starts a worktree journals one to PREPARE. RED on main for the first two. [R2] [R5] [dod arm 2]
  - 4. Same file. `fs.appendFileSync` throws once on a `CARD_STATE` line (the fault form of `tests/scenarios/fault-points.test.ts`) after the merged ship's result write landed: `card next` returns the CLOSE directive without throwing, the operation is `succeeded`, the pool request is completed, the event is owed; the next `card next` appends it once with `completed: true` and a third appends none. [R4] [dod arm 2]
  - 5. `tests/scenarios/card-state-owed.test.ts`: the two tests `R3 decision 1 F1, issue 511` (:203-221), which pin the append of main, assert R5 instead (no BUILD to SHIP; one `CARD_STATE` per stored change, after its write). `tests/scenarios/ship-effect-unknown.test.ts:118-120` (owner amendment, 2026-11-27): its `held` also counts an owed `CARD_STATE` whose `eventKey` the journal holds, since the ship's WAIT write now owes one, journaled and left on the record as a delivered `OPERATION_RESULT` is. No other existing test changes: `git diff origin/main --stat -- tests/` lists only the new file, `card-state-owed.test.ts` and `ship-effect-unknown.test.ts`. `foreign-dispatch.test.ts` (its lease section counts included), `card-contract-gate.test.ts` (test 5 DONE row included) and the other DoD files pass. [R5] [dod arm 2]
  - 6. `tests/scenarios/fault-points.test.ts` passes; when a method named in the coverage record of `.claude/skills/verify-card-run-writes/SKILL.md` gains or loses a write or a fault point, that record and its `Sync commit:` line follow its Keeping in sync section. [R2] [R4] [dod arm 2]
  - 7. R6 holds in the three docs (reviewer-verified against the diff); `changelog.d/T0-CARD-STATE-STORED.md` holds one line in the form of `changelog.d/README.md`. [R6] [dod arm 2]
  - 8. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "On main at c5eee64f. `dispatch` (:1170) sets `stateOwed` from `assess` (:1123) and `act` (:1216) runs the branch. PREPARE (`prepare`, :1400) writes through `write.save` (`saveOwing`, which carries the owed event today): STOP on an expired lease (:1414), STOP on a worktree stop (:1435), PREPARE on a start or BUILD on an attach (:1443); the claim at :1407 and the LEASE append are not card-run writes. SHIP (`ship`, :1721) takes the owed event and appends it first (:1725-1727), then may write: WAIT on an unreconciled rerun (:1729, `this.save`); the pre-review gate (`preReviewGate`, :1990, `updateCardRun` at :2014 and its callees); the formal review gate (`formalReviewGate`, :2123, reservations and decisions through `updateCardRun` at :2525, :2867, :3012, :3140, :3165); SHIP at the driver boundary (:1749); STOP when fenced (:1785); WAIT on a duplicate (:1789), a joined running request (:1807) or a pool refusal (:1814); the locked re-read (:1835, state unchanged); after the effect `applyShipResult` (:3284, `updateCardRun` at :3345 and :3393, `finish` storing CLOSE, WAIT or the failure state) or `settleThrownShip` (:1902, owed result only, state unchanged). `deliverOwed` (:957) appends inside `updateCardRun` and throws on a failed append. Tests grepped for CARD_STATE order or data (lessons T1-GOAL-OWED, T0-HOOK-FAIL-CLOSED): only `card-state-owed.test.ts:203-221` pins BUILD to SHIP before OPERATION_INTENT; `foreign-dispatch.test.ts:318-325` counts lease sections (the PREPARE STOP row keeps its one CARD_STATE in the STOP save); `card-contract-gate.test.ts:146-148` counts CARD_STATE on refused calls (no write, none); `outcome-ingest.test.ts` and `verifier.test.ts` write synthetic events. Consumers of `to`: `bench/outcome/ingest.ts:108` (state spans); no `src/` reader outside the runner and `controller.ts:1133` (readmitted, untouched)."
forbid: [network]
non_goals:
  - "saving the selected state before the bounded action (issue 511 option 2) and the contract gate DONE exemption (`contractChanged`)"
  - "the CARD_STATE of selections whose branch is WAIT, DONE, STOP, CLOSE, BUILD or REVIEW_FIX (T0-CARD-STATE-OWED), of `takeover`, and of the ownership-stop reconciliation"
  - "the `readmitted` CARD_STATE of `goal extend` and `continueStop`, and those at :3019 (stop during a review commit) and :3717 (CLOSE to DONE)"
  - "rewriting CARD_STATE events already in existing journals, and changing `bench/outcome/ingest.ts`"
hygiene: "From issue 511 (R3 finding F2 of T0-CARD-STATE-OWED). The owner chose in session (2026-11-27) to journal the stored state over saving the selection first and over documenting main's behaviour. RED first: acceptance 1, 2 and 3 on main. Interleavings are injected by wrapping `GoalStore.saveCardRun` and `updateCardRun` in the test, never by timing. Before BUILD, list every write of each branch again against the sweep (lesson T0-CARD-STATE-OWED)."
---

# T0-CARD-STATE-STORED

From issue 511.

## Why
T0-CARD-STATE-OWED made the `CARD_STATE` of a selection ride the write that stores it, except at two sites. `ship` still appends BUILD to SHIP before any write, so a refused early ship write leaves the event and a retry journals it twice. `prepare` stores STOP (or BUILD on an attach) with an event that says PREPARE. In both cases the journal names a state the record never held.

## Deliverable
For a SHIP or PREPARE selection, each card-run write of the branch that changes the stored state carries a `CARD_STATE` naming that change and appends it after the write lands. No append before the action. A new test file, the two `issue 511` tests of `card-state-owed.test.ts` moved to the new rule, docs, the bench README note and a changelog line.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-state-stored.test.ts tests/scenarios/card-state-owed.test.ts tests/scenarios/ship-effect-unknown.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/foreign-dispatch.test.ts tests/scenarios/card-contract-gate.test.ts tests/scenarios/deadline.test.ts tests/scenarios/extend-running-card.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-ci.test.ts tests/core/owed-event.test.ts tests/surface/outcome-ingest.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: each `CARD_STATE` of a SHIP or PREPARE branch names a state its write stored and follows that write; a refused write leaves none; a lost append after the merge is completed once and does not throw.
