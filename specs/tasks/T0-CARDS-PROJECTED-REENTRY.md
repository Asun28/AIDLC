---
id: T0-CARDS-PROJECTED-REENTRY
title: "After VERIFY_ARC a new card enters a goal only through the repair cycle or a recorded user revision, and arc-verified is refused while a listed card is not merged"
status: todo
branch: T0-CARDS-PROJECTED-REENTRY
worktree: D:\wt\AIDLC\T0-CARDS-PROJECTED-REENTRY
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: about 45 source lines (src/loop/controller.ts about 42, src/core/goal-machine.ts 3); the rest is about 255 test lines (the merge-predicate table, the per-state refusals, the T2 re-approval, the run-driver regression), about 20 doc lines and about 25 lines of attempt evidence in this card"
allow_paths:
  - src/loop/controller.ts
  - src/core/goal-machine.ts
  - tests/scenarios/arc-reentry.test.ts
  - tests/core/goal-machine.test.ts
  - .claude/skills/aidlc-loop/arc.md
  - templates/claude/skills/aidlc-loop/arc.md
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CARDS-PROJECTED-REENTRY.md
dod_command: npm run typecheck && node --test tests/scenarios/arc-reentry.test.ts tests/core/goal-machine.test.ts tests/scenarios/amendment.test.ts tests/scenarios/t1-arc.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/audit.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/intake-target.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/run-driver.test.ts tests/scenarios/two-windows.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `GoalController.report` receives `cards-projected` while the goal state is VERIFY_ARC, DELIVER or CLOSE, THEN it shall throw before any registry load, journal append or goal write, whatever `data.cards` holds (the state refusal comes before the empty-list check of controller.ts:537 and the unknown-id check of :540), with a message that names the state and its routes. VERIFY_ARC names `aidlc goal repair <goalId> --cards <new ids>` (only the new cards; a second failure after the cycle is spent is STOP/arc-verify, :604-607) and `aidlc goal amend <goalId> --text "<request>" --cards <ids>` (the whole revised list). DELIVER and CLOSE name `aidlc goal cancel <goalId>`, then `aidlc goal resume <goalId> --text "<request>" --cards <ids>` (the whole revised list).
  - R2. In PLAN (to CARDS), CARDS, RUN and WAIT the controller shall accept `cards-projected` as main does at 92796d4f; the `goalForCards` harness (tests/scenarios/_harness.ts:171) reports it in RUN.
  - R3. The controller shall count a card as merged only when the loaded card registry records it with status `merged` or this goal's run of it has `mergeVerified: true` (whatever the run state, CLOSE included); a card with neither (no registry entry or an entry not `merged`, and no run or a run whose `mergeVerified` is false) is not merged. Only the ids of the current `goal.cards` are checked: cards a revision superseded or removed, and their kept runs, take no part, and an empty `goal.cards` passes as on main. One private method decides this for R4, R5, R6 and R7.
  - R4. WHEN `arc-verified` is reported in VERIFY_ARC and a listed card is not merged (R3), THEN the controller shall throw before any journal append or goal write, naming every such card id, so the goal stays in VERIFY_ARC; outside VERIFY_ARC the refusal of main stands.
  - R5. WHILE the goal is in VERIFY_ARC and a listed card is not merged, the `verify-arc` directive shall carry a narration that names every such card id and says that `arc-verified` is refused until the card merges or a revision removes it; with every listed card merged the narration is the string of main.
  - R6. WHEN a `revision` is reported in VERIFY_ARC and the revised `goal.cards` hold a card that is not merged, THEN the controller shall move the goal to PLAN by the new edge `VERIFY_ARC -> PLAN` of `GOAL_TRANSITIONS` (src/core/goal-machine.ts:16), which `assertGoalTransition` admits only with `revisionAccepted` (the PLAN case of :75-76 extended from WAIT to VERIFY_ARC), with `counters.integrationRepairCycles` unchanged; a revision in VERIFY_ARC whose cards are all merged leaves the state as main does. The edge is needed: VERIFY_ARC has no PLAN edge, and the `{ ...goal, state: 'WAIT' }` form of controller.ts:636 is two legal edges only from RUN.
  - R7. WHEN a `revision` is reported in DELIVER or CLOSE and the revised `goal.cards` hold a card that is not merged, THEN the controller shall throw before any journal append or goal write, with a message that names `aidlc goal cancel <goalId>`, then `aidlc goal resume <goalId> --text "<request>" --cards <ids>` (the whole revised list), and the reason of its case: in DELIVER, the release attempt of this generation would be continued or reused (`nextInDeliver` selects attempts by generation, :421-422); in CLOSE with a target other than development, the delivered release of this generation would close the goal; in CLOSE with the development target (no release attempt, :598), `GOAL_TRANSITIONS.CLOSE` leads only to DONE and STOP. A revision whose cards are all merged is accepted and leaves the state as main does.
  - R8. `arc-failed` (`aidlc goal repair`, VERIFY_ARC only, one cycle), the carried revision of `aidlc goal resume` (re-entry through CARDS) and a revision in PLAN, CARDS, RUN or WAIT shall behave as main does.
  - R9. WHEN `aidlc run` (`runGoal`) dispatches the `verify-arc` directive of R5 and the provider's `arc-verified` is refused, THEN the run shall end without a delivery: the refused report changes no goal or run record, so `runGoal` returns the current directive, after a provider error as `provider error: ...`, or after a provider result with no persisted change as `provider returned with no state transition` (src/loop/run-driver.ts:96-105); the goal stays in VERIFY_ARC and no release attempt is created.
  - R10. `.claude/skills/aidlc-loop/arc.md` and `templates/claude/skills/aidlc-loop/arc.md` shall end the Amendments list with the identical three-line item "- After VERIFY-ARC a new card enters only by `aidlc goal repair` or a" / "  user revision (back to PLAN); in DELIVER or CLOSE, cancel, then resume" / "  with it." (154 bytes with the line breaks; each file stays ASCII and at most 4500 bytes, 4285 on main).
  - R11. Each document shall state its part of this change. `docs/ARCHITECTURE.md`: the table of this card's body after its `ReportResult` sentence; in the state diagram the edge `VERIFY_ARC --> PLAN: accepted revision that adds an unmerged card`; :71 `DELIVER --> CARDS: authorized repair` relabelled `DELIVER --> CARDS: in GOAL_TRANSITIONS; no report result takes it`, and the same in the Guards paragraph. `docs/OPERATIONS.md`: after the `aidlc goal repair` sentence of T1 feature (:112), R1, R4, R6 and R7 in one paragraph; in T2 system (:116), "records a revision and returns to PLAN" qualified as "records a revision; the goal state table in docs/ARCHITECTURE.md says when it returns to PLAN". The CHANGELOG entry: this card id with R1, R4, R6 and R7. `docs/plans/PLAN-aidlc-loop.md:265` (`DELIVER --> CARDS: bounded authorized repair`) stays: the plan records the design, and ARCHITECTURE.md states the current behaviour.
acceptance:
  - 1. `tests/scenarios/arc-reentry.test.ts` "cards-projected is refused in VERIFY_ARC, DELIVER and CLOSE before the registry is loaded, whatever data.cards holds": one call per state with an empty list, one with an id the registry does not hold, one with a registered card; a `GoalController` built from the fixture deps with a counting `cards` loader shows zero loads during each refused call; the goal record (JSON), the journal length and `integrationRepairCycles` are unchanged; the message names the routes of R1. CLOSE is reached as tests/scenarios/t0-flow.test.ts:126-128 does (a run in CLOSE with `closure.lessons` false, then `arc-verified`). Fails on main: VERIFY_ARC moves to CARDS. [R1] [dod arm 1]
  - 2. Same file "arc-verified is decided by the merge predicate over the listed cards": a table over registry entry (absent, present and not `merged`, present and `merged`) and run (absent, `mergeVerified` false, `mergeVerified` true), the VERIFY_ARC goal record saved through the fixture store with one listed card per row; rows with neither a `merged` entry nor a verified run are refused, the refusal names every failing id at once, journal length and state are unchanged, and the `verify-arc` narration names them; an absent entry with a verified run and a `merged` entry with no run are accepted; with every listed card merged the `verify-arc` narration equals main's string; a card the revision removed whose kept run is not merged does not block. Fails on main. [R3] [R4] [R5] [dod arm 1]
  - 3. Same file "a revision in VERIFY_ARC that adds a card returns the goal to PLAN, and the card runs before the arc is verified again": state PLAN, `GOAL_REVISED` journaled, `integrationRepairCycles` 0, directive `project-cards`; `cards-projected` in PLAN gives `run-card` for the added card; after it is driven to DONE, `verify-arc`, then `arc-verified` is accepted; a revision in VERIFY_ARC that drops a card leaves the state VERIFY_ARC. For a T2 goal the revision goes through PLAN and CARDS and `next` returns `checkpoint` for the new revision, with no `run-card` until `approved` with kind `plan-checkpoint` is recorded for it. Fails on main. [R2] [R6] [dod arm 1]
  - 4. Same file "a revision in DELIVER or CLOSE that adds a card is refused before any write; cancel, then resume with it, runs the card in a new generation": the refusal names the routes and the reason of each case of R7 (DELIVER; CLOSE of a staging goal; CLOSE of a development goal), with revision, journal length and state unchanged; a text-only revision in DELIVER is accepted with the state unchanged; after `cancel` and `resume` with text and the whole card list the goal has generation 1 and `next` is `run-card` for the added card. Fails on main: the revisions are accepted. [R7] [R8] [dod arm 1]
  - 5. Same file: `runGoal` with a provider whose `complete` reports `arc-verified` for the R5 goal (the refusal caught) and returns `ok` ends with `provider returned with no state transition`, the goal in VERIFY_ARC and no release attempt. [R9] [dod arm 1]
  - 6. `tests/core/goal-machine.test.ts` "VERIFY_ARC -> PLAN only on an accepted revision" passes, and the file's other tests pass unchanged. [R6] [dod arm 1]
  - 7. The files that report `arc-verified` (24 sites in 9 files: amendment, audit, goal-close-stages, intake-target, release, release-publication, run-driver, t0-flow, two-windows) and `tests/scenarios/t1-arc.test.ts` ("Q10: integrated acceptance failure opens one bounded repair cycle ...", `arc-failed`) pass unchanged; among them t0-flow.test.ts "Q1/Q8/Q10/Q15: a T0 card flows ..." reports `arc-verified` with a run in CLOSE that has `mergeVerified`. [R2] [R3] [R8] [dod arm 1]
  - 8. `tests/surface/templates.test.ts` passes (both arc.md copies identical, ASCII, under 4500 bytes); the item text is reviewer-verified against the diff. [R10] [dod arm 1]
  - 9. The docs and the CHANGELOG state R11 (reviewer-verified against the diff). [R11]
budget: 350
diagnosis:
  root_cause: "Two causes. `report('cards-projected')` (src/loop/controller.ts:545) calls `transitionGoal(goal, 'CARDS', now, { repairCycleAvailable: true })` for VERIFY_ARC and DELIVER without reading or spending `counters.integrationRepairCycles`, so the guard that bounds the repair cycle (src/core/goal-machine.ts:55) is told the cycle is available every time. `report('revision')` (:633-638) moves only RUN and WAIT back to PLAN, and `arc-verified` (:595-600) checks only the goal state, so a card a revision adds in VERIFY_ARC is never dispatched and the arc is verified without it. Reproduced by audit probe `probe2.test.ts` P4 and P12 on main."
  same_class: "Every report result that changes `goal.cards` (cards-projected, arc-failed, revision, the carried revision of resume), every write of state CARDS or PLAN (cards-projected, arc-failed, resume, extendDeadline, the revision), and every decision that cards are finished (`cardOutcomes` and `selectArc` for RUN -> VERIFY_ARC, `nextInClose` reading `mergeVerified`, the R3 predicate). Each is listed in the attempt evidence as covered, not affected or out of scope."
sweep: "git grep -n \"cards-projected\\|arc-verified\\|repairCycleAvailable\\|'revision'\\|mergeVerified\\|revisionAccepted\" -- src on main at 92796d4f (controller.ts, goal-machine.ts and run-driver.ts are unchanged since 84c7f30a). controller.ts:535-548 (cards-projected): changed (R1). :595-600 (arc-verified): changed (R4). :612 (arc-failed passes repairCycleAvailable after `canOpenIntegrationRepair`): not affected (R8). :633-638 (revision): changed (R6, R7). :410-416 (`nextInVerifyArc`): changed (R5). :450 (`nextInClose` reads `mergeVerified`): not affected, same field as R3. goal-machine.ts:16 (VERIFY_ARC edges) and :75-76 (PLAN guard): changed (R6); :43,55 (repair guard): unchanged. cli/main.ts:355 (`goal amend`), :365 (`goal repair`), :442-454 (`report --cards`): callers, unchanged; the refusals reach them as a thrown error. run-driver.ts:96-105: unchanged, R9 states its effect. amendments.ts:39 and card-machine.ts:27,90,96 read `mergeVerified` of a card run, not of the goal: not affected. Pins in tests: git grep -c \"result: 'arc-verified'\" -- tests gives 24 sites in 9 files; measured on 2026-11-11 with a scratch copy of the sources that logged the goal state of each `cards-projected` and the R3 result of each `arc-verified` over those files plus t1-arc: `cards-projected` ran in PLAN, CARDS and RUN only (RUN from the harness, because the `next` that `plan-produced` returns already moved CARDS to RUN), and all 42 `arc-verified` calls had every listed card merged, t0-flow.test.ts:127-128 (a run in CLOSE with `mergeVerified`) included. tests/core/goal-machine.test.ts:7-15 asserts edges of the table that do not change. No test pins the two bypasses."
forbid: [weakening or skipping a test to go green, a change to `MAX_INTEGRATION_REPAIR_CYCLES` or to what spends the repair cycle, a goal-machine change beyond the VERIFY_ARC -> PLAN edge and its guard, editing .aidlc state by hand]
non_goals: ["`cards-projected` in RUN with every card merged and `aidlc next` not yet called adds a card and spends nothing (controller.ts:543-546), also after `arc-failed`", "after cancel then resume the generation-0 release attempt stays non-terminal and `aidlc release next <old id>` still drives it (cli/main.ts:1112-1118), so its environment lease is not freed by T0-STAGING-LEASE-RELEASE", "who may run `aidlc goal amend`: the CLI does not authenticate the user, and a revision does not spend the repair cycle", "a revision in DELIVER or CLOSE whose cards are all merged (dropped cards, text only): accepted as on main", "the board's Arc line, which leaves out a card the registry does not hold, as on main", "a card re-listed after an earlier revision removed it: its earlier run counts, as in `cardOutcomes`", "removing the DELIVER -> CARDS edge from GOAL_TRANSITIONS", "a goal in CLOSE that lists a card merged under another goal with no run of this goal (`nextInClose` wants a run record), as on main"]
hygiene: "Line numbers are from main at 92796d4f; read them again at PREPARE. This card changes no file the verify-card-run-writes coverage record names, so the fault-point check is not in the DoD. The R7 route was checked by reading: `cancel` stops the goal, `resume` with text and cards links generation 1 and enters CARDS, and `nextInDeliver` selects release attempts of the current generation only. Before the first R3, revert each source hunk in a scratch copy and run its acceptance test (lesson 2026-11-11 T0-AUDIT-FIXES). Insert the CHANGELOG entry directly above the entry that begins `- T0-PREPARE-WORKTREE (bugfix)`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. T0-ASK-RECLASSIFY and T0-CHECKPOINT-PACKET-SHARED use the same anchor; the three cards build one after another, this one first, so each later one inserts its entry directly above the same line, below the entry of the card before it."
doc_sync: docs/ARCHITECTURE.md (ReportResult paragraph, state diagram, Guards), docs/OPERATIONS.md (T1 feature, T2 system), .claude/skills/aidlc-loop/arc.md and templates/claude/skills/aidlc-loop/arc.md (Amendments), CHANGELOG.md
---

# T0-CARDS-PROJECTED-REENTRY

## Deliverable
A goal past VERIFY_ARC takes a new card only through `aidlc goal repair` (one cycle, VERIFY_ARC only) or a recorded user revision, which returns it to PLAN from VERIFY_ARC and is refused in DELIVER and CLOSE in favour of cancel and resume. `arc-verified` is refused while a listed card is not merged.

## Why
On main, `cards-projected` re-enters CARDS from VERIFY_ARC or DELIVER as often as it is reported, without spending the one integration repair cycle, and a revision in VERIFY_ARC adds a card that never runs before `arc-verified` closes the goal. Planner decision of 2026-11-11 (audit F11), with the rulings of the second review: the refusals stand, PLAN is the target, merged means registry `merged` or the run's `mergeVerified`. DELIVER has no repair cycle (`arc-failed` is VERIFY_ARC only), and a revision there cannot re-enter in the same generation, because `nextInDeliver` would continue or reuse the release attempt of that generation, bound to the old candidate.

## Report results by goal state after this card
| Result | PLAN | CARDS | RUN, WAIT | VERIFY_ARC | DELIVER | CLOSE |
|---|---|---|---|---|---|---|
| `cards-projected` | accepted, to CARDS | accepted | accepted | refused (R1) | refused (R1) | refused (R1) |
| `arc-verified` | refused | refused | refused | accepted only when every listed card is merged (R4) | refused | refused |
| `arc-failed` | refused | refused | refused | accepted, one cycle | refused | refused |
| `revision`, every listed card merged | accepted, stays | accepted, stays | accepted, to PLAN | accepted, stays | accepted, stays | accepted, stays |
| `revision`, a listed card not merged | accepted, stays | accepted, stays | accepted, to PLAN | accepted, to PLAN (R6) | refused (R7) | refused (R7) |

STOP and DONE accept `resume` only, as on main. Changed from main: the three `cards-projected` refusals (main moved VERIFY_ARC and DELIVER to CARDS and kept CLOSE), the `arc-verified` condition, and the `revision` cells of VERIFY_ARC, DELIVER and CLOSE (main kept the state).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/arc-reentry.test.ts tests/core/goal-machine.test.ts tests/scenarios/amendment.test.ts tests/scenarios/t1-arc.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/audit.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/intake-target.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/run-driver.test.ts tests/scenarios/two-windows.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; the tests of acceptance 1 to 4 fail on main.

## Attempt evidence
Attempt 1 at effort high. RED commit e2653750 (tests only): on the main sources each test of acceptance 1 to 5 and the goal-machine test failed at its first assertion for the stated reason (cards-projected accepted in VERIFY_ARC, the goal then in RUN; arc-verified accepted with T1-NOENTRY-NORUN not merged; the VERIFY_ARC revision left the state VERIFY_ARC; the DELIVER revision accepted at revision 1; the provider's arc-verified not refused; VERIFY_ARC -> PLAN "not in the accepted state diagram").

| Item | Test or command | Result |
|---|---|---|
| 1 | arc-reentry.test.ts "cards-projected is refused in VERIFY_ARC, DELIVER and CLOSE before the registry is loaded, whatever data.cards holds" | pass; failed on main |
| 2 | arc-reentry.test.ts "arc-verified is decided by the merge predicate over the listed cards" (9-row table, all rows on one goal, all merged, empty list, removed card with an open kept run) | pass; failed on main |
| 3 | arc-reentry.test.ts "a revision in VERIFY_ARC that adds a card returns the goal to PLAN, and the card runs before the arc is verified again" (T1 and T2) | pass; failed on main |
| 4 | arc-reentry.test.ts "a revision in DELIVER or CLOSE that adds a card is refused before any write; cancel, then resume with it, runs the card in a new generation" (DELIVER, CLOSE staging, CLOSE development; text-only revision in DELIVER; the same revision accepted in PLAN and CARDS) | pass; failed on main |
| 5 | arc-reentry.test.ts "aidlc run ends without a delivery when the provider reports arc-verified for a goal whose listed card is not merged" | pass; failed on main |
| 6 | goal-machine.test.ts "VERIFY_ARC -> PLAN only on an accepted revision"; the other ten tests unchanged | pass; failed on main |
| 7 | amendment, audit, goal-close-stages, intake-target, release, release-publication, run-driver, t0-flow, two-windows, t1-arc (unchanged) | pass (DoD) |
| 8 | tests/surface/templates.test.ts; both arc.md copies identical, ASCII, 4439 bytes (4285 + 154) | pass |
| 9 | docs/ARCHITECTURE.md (table after the ReportResult sentence, VERIFY_ARC --> PLAN edge, DELIVER --> CARDS relabelled, Guards), docs/OPERATIONS.md (T1 feature paragraph, T2 system sentence), CHANGELOG.md entry above T0-PREPARE-WORKTREE | reviewer-verified |

Same class (diagnosis.same_class):
| Site | Disposition |
|---|---|
| `cards-projected` (controller report) | covered: R1, acceptance 1; PLAN, CARDS and RUN acceptance 3 and 7 |
| `arc-failed` | not affected: t1-arc Q10 and amendment "a resume that retains a repair card added by arc-failed ..." pass |
| `revision` | covered: acceptance 2, 3, 4 (VERIFY_ARC, DELIVER, CLOSE, PLAN, CARDS); RUN in amendment Q5 and T0-REMOVED-CARD-RUNS |
| carried revision of `resume` | not affected: acceptance 4 (cancel, then resume, generation 1, run-card) and the amendment R2 resume tests |
| writes of CARDS or PLAN: `cards-projected`, `arc-failed`, `resume`, `extendDeadline`, `revision` | `cards-projected` and `revision` covered as above; `arc-failed`, `resume` and `extendDeadline` (STOP for time to CARDS) not affected |
| `cardOutcomes` and `selectArc` (RUN -> VERIFY_ARC) | not affected: acceptance 3 shows the added card dispatched and driven to DONE before `verify-arc` |
| `nextInClose` reading `mergeVerified` | not affected: same field as the R3 predicate |
| R3 predicate (`unmergedCards`) | covered: acceptance 2; used by R4 (arc-verified), R5 (narration), R6 and R7 (revision) |

Revert check (each source hunk reverted alone, then arc-reentry, goal-machine, amendment and t1-arc run):
| Hunk | Failing test | Result |
|---|---|---|
| goal-machine.ts: PLAN in GOAL_TRANSITIONS.VERIFY_ARC | goal-machine "VERIFY_ARC -> PLAN ...", acceptance 3 | red |
| goal-machine.ts: PLAN guard extended to VERIFY_ARC | goal-machine "VERIFY_ARC -> PLAN ..." | red |
| controller.ts: verify-arc narration | acceptance 2 | red |
| controller.ts: cards-projected refusal in VERIFY_ARC | acceptance 1 | red |
| controller.ts: cards-projected refusal in DELIVER and CLOSE (and CLOSE alone) | acceptance 1 | red |
| controller.ts: removed `VERIFY_ARC or DELIVER -> CARDS` line restored | none | green: unreachable after the R1 refusals |
| controller.ts: arc-verified refusal | acceptance 2, 5 | red |
| controller.ts: revision refusal in DELIVER and CLOSE (and CLOSE alone, and extended to VERIFY_ARC, and the CLOSE reasons swapped) | acceptance 4 (acceptance 3 for the VERIFY_ARC case) | red |
| controller.ts: revision in VERIFY_ARC to PLAN | acceptance 3 | red |
| controller.ts: revision predicate also in PLAN and CARDS | acceptance 4 | red |
| controller.ts: revision predicate on the old cards | acceptance 2, 3, 4 | red |
| controller.ts: predicate without the registry `merged` clause | acceptance 2 | red |
| controller.ts: predicate without the `mergeVerified` clause | acceptance 1 to 4, amendment R2 | red |
| controller.ts: predicate reading runs of removed cards | acceptance 2 | red |
