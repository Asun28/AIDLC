---
id: T0-CARD-STATE-OWED
title: "The CARD_STATE of a card next selection is owed with the record and journaled only after that write lands"
status: todo
branch: T0-CARD-STATE-OWED
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/card-state-owed.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - changelog.d/T0-CARD-STATE-OWED.md
  - specs/tasks/T0-CARD-STATE-OWED.md
dod_command: npm run typecheck && node --test tests/scenarios/card-state-owed.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/foreign-dispatch.test.ts tests/scenarios/deadline.test.ts tests/scenarios/extend-running-card.test.ts tests/scenarios/card-contract-gate.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-ci.test.ts tests/core/owed-event.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. A `CARD_STATE` event that `CardRunner.assess` records for a state change (the selection change at `src/loop/card-runner.ts:1082` and the ownership-stop reconciliation `STOP` to `CLOSE` at `:978`) shall be added to the run's `journalOwed` (`owe`, `owedWith`), stored by the card-run write that persists that state, and appended to the goal journal by the same command only after that write lands. Its data is the data it has on main (`from`, `to`, `reason`) plus `eventKey`, without `completed`. This holds for every branch of `dispatch` (`card next`) and for `takeover` (`card takeover`), the two callers of `assess` that write.
  - R2. When the write that would persist the selected state is refused (`CARD_RUN_STALE`, `ForeignLeaseError`, `LOCKED`, or any other throw of the save), the command shall leave no `CARD_STATE` of that transition in the goal journal. A later call that selects the transition again journals it once, after its own write lands.
  - R3. When the append of R1 fails after the write landed, the event shall stay owed on the run, and the next `card next`, `card attempt`, `review pre` or `review r3` on the card appends it once, marked `completed: true` (the existing `deliverOwed` behaviour).
  - R4. While the dispatch holds no live card lease of its own, the append of R1 shall be made under the card lease's lock like every other dispatch write (`dispatchWriter`), so a lease another session takes before it ends the dispatch with nothing more appended (card T0-FOREIGN-DISPATCH-NO-WRITE-2).
  - R5. In a run with no fault and no refusal, the goal journal shall hold the same `CARD_STATE` events as on main: same `from`, `to` and `reason`, one per transition. Their position may change only in that each follows the card-run write of its transition.
  - R6. `docs/OPERATIONS.md` shall name the `CARD_STATE` of a `card next` or `card takeover` selection among the owed events in the T0-JOURNAL-FAULT-EVENTS paragraph (Audit), and the Deadline extensions bullet on `CARD_RUN_STALE` shall add that the refused command leaves no `CARD_STATE` event.
acceptance:
  - 1. `tests/scenarios/card-state-owed.test.ts`, new file, issue case 1. A card run in SHIP past its deadline; a `GoalStore` wrapper runs `aidlc goal extend` (the controller's extension, a later deadline) once, right before the first `saveCardRun` of `card next`. `card next` throws `CARD_RUN_STALE`; the goal journal holds no `CARD_STATE` with `from` `SHIP` and `to` `STOP`; the stored run is in SHIP with the new deadline and no owed `CARD_STATE`. The next `card next` does not stop for time. RED on main (one such event). [R1] [R2] [dod arm 2]
  - 2. Same file, issue case 2. Two `card next` calls on the same SHIP run past its deadline, the second reading the run before the first saves (the same wrapper runs the second call before the first call's first `saveCardRun`). One save lands and one is refused; the journal holds exactly one `CARD_STATE` `SHIP` to `STOP`, with an `eventKey` and without `completed`. RED on main (two). [R1] [R2] [dod arm 2]
  - 3. Same file. `fs.appendFileSync` throws once on a `CARD_STATE` line (the fault form of `tests/scenarios/fault-points.test.ts`) during the `card next` of acceptance 1 with no extension: the run is stored in STOP with the event owed and the journal holds none; the next `card next` appends one `CARD_STATE` `SHIP` to `STOP` marked `completed: true`, and a third `card next` appends none. [R3] [dod arm 2]
  - 4. Same file. A merged card stopped for ownership whose blocking lease is released (the fixture of `tests/scenarios/foreign-dispatch.test.ts:235`), with its first `saveCardRun` refused as stale by the same wrapper: the journal holds no `CARD_STATE` `STOP` to `CLOSE`. Without the refusal it holds exactly one, after the write that stores CLOSE (its journal `seq` is read after the record shows CLOSE, through a `saveCardRun` wrapper that records the journal length at each landed save). RED on main for the refused case. [R1] [R2] [dod arm 2]
  - 5. `tests/scenarios/fault-points.test.ts`, `tests/scenarios/foreign-dispatch.test.ts` (its `GATED` section counts included) and the other test files of the dod_command pass unchanged; `git diff origin/main --stat -- tests/` lists only the new file. [R4] [R5] [dod arm 2]
  - 6. `docs/OPERATIONS.md` states R6 (reviewer-verified against the diff). `changelog.d/T0-CARD-STATE-OWED.md` holds one line in the form of `changelog.d/README.md`. When `src/loop/card-runner.ts` methods named in the coverage record of `.claude/skills/verify-card-run-writes/SKILL.md` gain or lose a write, that record and its `Sync commit:` line follow its Keeping in sync section. [R6] [dod arm 2]
  - 7. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "On main at e403800a, `assess` (`src/loop/card-runner.ts:948`) appends `CARD_STATE` at :1082 through `append` (the dispatch writer's gated append for `card next`, the plain journal for `takeover`) before any save of the selected state; the saves come later, per branch of `dispatch` (:1157-1229): WAIT, DONE and STOP save at :1215-1226, REVIEW_FIX at :1176/:1186, BUILD in `build` (:1454, :1473), SHIP in `ship` (:1658, :1678), PREPARE in `prepare` (:1348, :1369, :1377), CLOSE in `close` (:3606); `takeover` saves `assessed.next` at :1323. The ownership-stop reconciliation appends `STOP` to `CLOSE` at :978 before its save at :979. `saveCardRun` refuses a stale read with `CARD_RUN_STALE` (`src/state/goal-store.ts:102`). The owed-event mechanism already exists: `owe` (:897), `owedWith` (:903), `deliverOwed` (:920), used for ATTEMPT_STARTED at :1182-1187 and :1473; `deliverOwed` marks every due entry not named in `own.keys` `completed: true`, so the transition's own key must be passed by the command whose write stored it. Tests grepped for CARD_STATE order or data (lesson T1-GOAL-OWED): `foreign-dispatch.test.ts:318-325` counts lease sections per dispatch (the gated append stays one section, after the save instead of before); `card-continue*.test.ts` and `deadline.test.ts`/`extend-running-card.test.ts` read the `readmitted` CARD_STATE of `continueStop` and `goal extend`, which this card does not touch; `fault-points.test.ts` `endState` does not count CARD_STATE (`COUNTED_EVENTS`), and its stage E (SHIP past the deadline) changes only the order of its two fault points; `outcome-*.test.ts` and `verifier.test.ts` write synthetic events. No test asserts `CARD_STATE` data with `deepEqual` without stripping `eventKey`, apart from the continuation events this card does not change."
forbid: [network]
non_goals:
  - "the CARD_STATE of a SHIP selection, which `ship` appends at its start before any write, as on main, and a selection whose branch saves another state (`prepare` saving STOP): issue 511, owner ruling on R3 finding F2 (2026-11-26)"
  - "the `readmitted` CARD_STATE of `goal extend` (`src/loop/controller.ts:1133`) and of `continueStop` (already owed)"
  - "the CARD_STATE at `src/loop/card-runner.ts:2948` (stop during a review commit) and `:3646` (CLOSE to DONE)"
  - "the other appends of `assess` (`NOTE` ownership-stop-reconciled, `LEASE_RENEWED`, `ATTEMPT_FINISHED` review-disputed); a defect found there becomes a follow-up issue"
  - "the `REVIEW_ADMITTED` ordering of issue 418"
  - "removing the extra CARD_STATE events already in existing journals"
hygiene: "From issue 502. The owner chose the owed-event design in session (2026-11-26) over moving the append after the save and over documenting the event. RED first: acceptance 1, 2 and 4 on main. Interleavings are injected by wrapping `GoalStore.saveCardRun` in the test, never by timing."
---

# T0-CARD-STATE-OWED

From issue 502.

## Why
`card next` journals the `CARD_STATE` of its selection before it saves the selected state. When that save is refused as stale, the event stays: the journal says the card stopped while the run is still in progress (an extension landed), or holds two stops for one (two `card next` calls).

## Deliverable
The selection's `CARD_STATE` rides in the run's `journalOwed` in the write that stores the state and is appended after that write lands, through the existing owed-event path. A test of both issue cases, a lost append and the ownership reconciliation; a docs sentence and a changelog line.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-state-owed.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/foreign-dispatch.test.ts tests/scenarios/deadline.test.ts tests/scenarios/extend-running-card.test.ts tests/scenarios/card-contract-gate.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-ci.test.ts tests/core/owed-event.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: a refused save leaves no CARD_STATE; a landed save journals exactly one; a lost append is completed once by the next call.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| 6 | | |
| 7 | | |
