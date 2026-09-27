---
id: T0-EXTEND-RUNNING-CARD
title: A deadline extension also moves the deadline of every card run of the current projection still in progress, and the run-card directive shows the stored card deadline (issue 105)
status: merged
branch: T0-EXTEND-RUNNING-CARD
worktree: D:\wt\AIDLC\T0-EXTEND-RUNNING-CARD
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/extend-running-card.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-EXTEND-RUNNING-CARD.md
dod_command: npm run typecheck && node --test tests/scenarios/extend-running-card.test.ts tests/scenarios/deadline.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc goal extend` records an extension, every card run of the goal's current projection whose state is neither DONE nor STOP shall take the new goal deadline as its deadline when that is later than its own. The run is read and written under the card-run lock (`GoalStore.updateCardRun`), and nothing else on it changes apart from the revision and `updatedAt` the store sets. A `NOTE` is journaled for each moved run with the card id, the old and the new deadline and the author of the extension, after the goal's own extension entries. A DONE run, a run stopped for any reason other than time, a run of a card outside the current projection (a superseded card included) and a run whose deadline is already at or after the new one keep their record unchanged and journal nothing. A deadline is never moved earlier. A run stopped for time is re-admitted exactly as before.
  - R2. The `run-card` directive's `cardDeadline` shall be the stored deadline of the card's run when the card has one; only a card without a run gets the computed deadline (the earlier of its start plus the card limit and the goal deadline).
  - R3. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state the rule. The limit, stated before the first review: the extension takes no card lease, so a card command that read the run before the extension and saves that snapshot afterwards is refused as stale (`CARD_RUN_STALE`) and is run again, as for any concurrent write of a card run.
acceptance:
  - 1. tests/scenarios/extend-running-card.test.ts - the sequence of issue 105: a card in BUILD past its own deadline while its goal is not stopped; after `extendDeadline` the stored deadline is the new goal deadline, the run otherwise deepEquals its record before the extension apart from the revision and `updatedAt`, one `NOTE` names the card, both deadlines and the author and comes after the extension `NOTE`, and the next `card next` continues the card (`build`) instead of stopping it for time. A card whose deadline was capped by the old goal deadline (started less than the card limit before it) is moved as well and is not stopped at the old goal deadline. [R1] [dod arm 1]
  - 2. tests/scenarios/extend-running-card.test.ts - one case per card state stored on a run of the projection: PREPARE, BUILD, SHIP, REVIEW_FIX, WAIT and CLOSE are moved; DONE and STOP (review) deepEqual their record before the extension and journal nothing; a run in BUILD of a card outside the current projection (superseded by a replacement resume) and a run whose stored deadline is after the new one deepEqual their records and journal nothing; a time-stopped run is re-admitted (`CARD_STATE` `readmitted`) and journals no `NOTE`. [R1] [dod arm 1]
  - 3. tests/scenarios/extend-running-card.test.ts - a card at PREPARE with a run: after an extension the goal's `run-card` directive carries `cardDeadline` equal to the stored run deadline (the new goal deadline); a card without a run gets the computed deadline. [R2] [dod arm 1]
  - 4. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R3] [dod arm 1]
  - 5. tests/scenarios/deadline.test.ts passes unchanged: the time-stopped re-admission and the refusals of an earlier or malformed extension behave as before. [R1] [dod arm 1]
depends_on: []
budget: 320
tdd: true
sweep: "grep -n 'stop?.reason !== .time.\\|computeCardDeadline(\\|deadline: ' src/loop/controller.ts: extendDeadline (716-724) re-admits only runs stopped for time and skips every other run, whose deadline stays the one computed at its start; the run-card directive (353) computes cardDeadline from the start and the goal deadlines, ignoring the stored run. ensureCardRun (611) sets the deadline once at creation and is right to. Lines measured on main 9c463a4."
forbid: [weakening or skipping a test to go green, a controller.ts change outside lines 353, 708-709 and 716-724 (measured on main 9c463a4; a hunk there may add lines at its position), an edit of tests/scenarios/deadline.test.ts, src code (controller.ts extendDeadline) changing the state, stop or journal entries of the time-stopped re-admission, src code (controller.ts extendDeadline) moving the deadline of a DONE run, of a run stopped for a reason other than time or of a run outside the current projection, src code (controller.ts extendDeadline) moving any card deadline earlier]
non_goals: [the card limit (3h) and the goal limits, the goal-level time stop, taking or fencing the card lease during an extension, the unused GoalController.cardDeadline helper, runs of other goals]
diagnosis:
  root_cause: "GoalController.extendDeadline (controller.ts:716-724) loops over the goal's card runs and continues past every run that is not stopped for time, so a run still in progress keeps the deadline ensureCardRun stored at its start (computeCardDeadline, the earlier of start + 3h and the goal deadline then). The card machine checks that stored deadline (card-machine.ts, step 6), so the first card next after the extension stops the card for time and a second extension is needed to re-admit it (issue 105, goal g-20260926134615-a88c3e, card T0-PASS-REASONS-WORDING, in SHIP). Separately, the run-card directive (controller.ts:353) recomputes cardDeadline from the run's start and the goal deadlines instead of reading the stored run, so after any extension it shows a deadline the card machine does not use."
  same_class: "Every reader and writer of a card run's deadline: ensureCardRun (611) writes it once at creation, the time-stopped re-admission (722) moves it, the run-card directive (353) recomputes it, the card machine and the review queue (card-runner.ts 529, 944, 1506) read the stored value."
hygiene: "Issue 105, filed by aidlc-37. The controller.ts hunks (353, 708-709, 716-724 on main 9c463a4) were sent to aidlc-37 before the edit and approved by it, clear of aidlc-a6's T1-BOUND-TELEMETRY hunks (34, 208, 217, 260, 522, 737); tests go in a new file so tests/scenarios/deadline.test.ts, which that branch edits, is untouched. Run the mutation sweep over every new branch before the first review; the doc test reads the exact sentences (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS); a record said to be unchanged is compared whole (docs/LESSONS.md 2026-09-26 T0-SHIP-FAILURE-UNSETTLED); every forbid clause names the code it guards (docs/LESSONS.md 2026-09-27 T0-REVIEWER-UTF8); every condition the new branch answers yes on is listed in R1 (docs/LESSONS.md 2026-09-27 T0-DISPUTE-RUNNING-ATTEMPT)."
doc_sync: docs/OPERATIONS.md (goal extend), docs/ARCHITECTURE.md (goal machine), CHANGELOG.md
---

# T0-EXTEND-RUNNING-CARD

## Deliverable
`aidlc goal extend` moves the deadline of every card run of the goal's current projection that is still in progress to the new goal deadline, so the next `aidlc card next` continues the card instead of stopping it for time. The `run-card` directive shows the deadline the card machine uses.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/extend-running-card.test.ts tests/scenarios/deadline.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
