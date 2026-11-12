---
id: T0-OP-TIMESTAMP-NOW-2
title: (replaces T0-OP-TIMESTAMP-NOW) Every operation-ledger write from the card runner and the release runner carries the injected clock, so operation timestamps and ids follow `now`
status: todo
branch: T0-OP-TIMESTAMP-NOW-2
worktree: D:\wt\AIDLC\T0-OP-TIMESTAMP-NOW-2
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: budget raised from 150 to 380 after two reviews of the card (Codex and Fable 5.2) against main at 92796d4f; 22 changed source lines in two files and 2 fixture lines, the rest one behavioural test per changed ledger-write branch, the completeness scan and attempt evidence; raised from 380 to 400 by the coordinator on 2026-11-12 for the third fixture line and its evidence; raised from 400 to 460 by the coordinator on 2026-11-12 for the replacement card: the carried candidate 75657155 is 322 changed lines, and the moved evidence gains a History line, a note of where each figure was measured, the DoD of this card on its own branch and the coordinator's verification block"
allow_paths:
  - src/loop/card-runner.ts
  - src/loop/release-runner.ts
  - tests/scenarios/op-clock.test.ts
  - tests/scenarios/review-admit-foreign.test.ts
  - tests/scenarios/ship-throw.test.ts
  - tests/scenarios/ship-effect-unknown.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-OP-TIMESTAMP-NOW-2.md
dod_command: npm run typecheck && node --test tests/scenarios/op-clock.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/release.test.ts tests/scenarios/release-reissue.test.ts tests/scenarios/release-lease.test.ts tests/scenarios/release-report-step.test.ts tests/scenarios/ship-throw.test.ts tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/ship-effect-unknown.test.ts
dod_exit: 0
requirements:
  - R1. Every call in `src/loop/` of the `OperationLedger` methods `recordIntent`, `markIssued`, `markRunning`, `markResult` and `reconcile` shall pass, as its last argument, the time from the runner's injected clock (the `now` the method already read from `this.clock()`, or `this.clock()` where the method has none), so that `intentRecordedAt`, `issuedAt`, `finishedAt` and `reconciledAt` of a record a runner writes, and the `op-<YYYYMMDDhhmmss>-` prefix of the id `recordIntent` derives from its time, come from `CardRunnerDeps.now` or `ReleaseRunnerDeps.now`. The calls that leave it out on main at 92796d4f are card-runner.ts:1192 (`recordIntent` of the merge), :1222, :1229, :1257, :1279 (`markResult` cancelled), :1330 (`markResult` UNKNOWN in `settleThrownShip`), :2747, :2799, :2808, :2814 (`markResult` in `applyShipResult`) and release-runner.ts:313 (`recordIntent` of a deploy or recovery, which T0-RELEASE-OP-REISSUE moves into a lease section); the five calls that already pass it (card-runner.ts:1300, release-runner.ts:134, :316, :323, :324) are unchanged.
  - R2. The other clock reads of `src/loop/` shall stay as they are, each for the reason the sweep gives: card-runner.ts:239, release-runner.ts:68, run-driver.ts:23, worktree-reclaim.ts:114 and controller.ts:104 (the default clock when no `now` is injected), card-runner.ts:2121 (the age of a reviewer log, measured from the file's modification time, which is wall-clock time), card-runner.ts:2708 (derived from the injected `now`) and controller.ts:806 (a calendar check of a given deadline, no clock read).
  - R3. The two fixtures that relied on wall-clock order shall each gain exactly one line, `fx.advance(1)` (1 ms of the fixture clock) between two ships of one card, with every assertion unchanged: tests/scenarios/review-admit-foreign.test.ts, between Z's ship that waits `busy` (:132) and Z's ship that waits `behind` (:135), for the order asserted at :140-144; tests/scenarios/ship-throw.test.ts, between the reconcile at :229 and the ship at :230, for the order asserted at :232. A third fixture has the same dependence (found by the implementer on 2026-11-12, when the full suite was run with R1 applied: 6 failures in 8 runs with R1, 0 in 8 on main): tests/scenarios/ship-effect-unknown.test.ts, "after a reconcile the card ships again without a second effect", gains the same one line, `fx.advance(1)`, between its reconcile (:273 on main at 93ca9a7d) and the ship that follows (:274), for the order asserted at :284; no assertion changes.
  - R4. CHANGELOG.md, Unreleased, shall name the card and state R1 and R3, including that a test fixture's fixed clock now decides the times of an operation record, the time prefix of its id and so the first sort key of the ledger; two records written at one fixture instant keep the random suffix of their ids and no fixed order between them (wording of 2026-11-12 after the pre-review of c2599307; the first wording said "ids and the ledger order").
acceptance:
  - 1. `tests/scenarios/op-clock.test.ts` "every changed ledger write records the injected clock" passes and fails on main: one test per branch, each with the fixture clock first advanced to a time of its own, asserting that the persisted field equals that fixture time (so a time argument left out, which falls back to the wall clock, or one that is `undefined` fails it): the merge intent of a ship, `intentRecordedAt` and an id starting with the fixture's `op-<YYYYMMDDhhmmss>` (:1192); a ship that joins a running review request (:1222), a ship whose review is not admitted (:1229), a ship whose arming read of the card run throws (:1257), a ship whose card run changed after the gate (:1279), each `finishedAt` of the `cancelled` record; a ship path that throws, `finishedAt` of the `UNKNOWN` record (:1330); a ship result applied after the candidate changed in flight (:2747); a `merge-unconfirmed` ship that gh reads as not merged (:2799); a merged ship and an unverified one (:2808, `succeeded` and `UNKNOWN`); a ship with the outcome `dod-failed` (:2814); each `finishedAt`; a release deploy, `intentRecordedAt` and the id prefix (release-runner.ts:313). The fixtures follow tests/scenarios/op-intent-dup.test.ts, review-admit-foreign.test.ts, ship-throw.test.ts and merge-unconfirmed.test.ts, and use store or ship-path wrappers for :1257 and :1279. [R1] [dod arm 1]
  - 2. Same file, "every operation-ledger write in src/loop names its time" passes and fails on main, listing the eleven calls of R1: it parses each `src/loop/*.ts` file with the TypeScript compiler API (as tests/core/parse-guard.test.ts does), finds every call whose callee is a property access named `recordIntent`, `markIssued`, `markRunning`, `markResult` or `reconcile` on an expression that ends in `ops`, and asserts that its last argument is the identifier `now` or the call `this.clock()`; it also asserts it found at least 16 such calls, so a scan that finds none fails. It is a completeness check only; acceptance 1 is the behavioural proof. [R1] [dod arm 1]
  - 3. tests/scenarios/review-admit-foreign.test.ts and tests/scenarios/ship-throw.test.ts and tests/scenarios/ship-effect-unknown.test.ts pass with the one line of R3 each and no assertion changed; without that line and with R1 applied, the first fails in about 7 of 12 runs (0 of 12 on main, as measured in review). [R3] [dod arm 1]
  - 4. tests/scenarios/fault-points.test.ts, op-intent-dup.test.ts, release.test.ts, release-reissue.test.ts, release-lease.test.ts, release-report-step.test.ts and merge-unconfirmed.test.ts pass unchanged; the fault-point check adds no pin. [R1] [R2] [dod arm 1]
  - 5. The CHANGELOG entry states R4 (reviewer-verified against the diff). [R4]
depends_on: [T0-RELEASE-REPORT-STEP, T0-GITLEAKS-LESSON-FP]
budget: 460
tdd: true
diagnosis:
  root_cause: "`OperationLedger` takes the time of each write as an optional last argument that defaults to `nowIso()` (src/coordination/reconcile.ts:54, :76, :80, :84, :89), and eleven calls in the card runner and the release runner leave it out, so those fields and the record id come from the wall clock while every other record of the run uses the injected `now`. Under a fixed test clock the merge record's `intentRecordedAt` and `finishedAt` were 2026-11-11 while the run was at 2026-09-11. Two tests passed only because a later ship's intent got a later wall-clock time; under the fixture clock both intents share one instant and their order falls to the random id suffix."
  repro: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-release.test.ts case E: with the fixture clock at 2026-09-11T00:00:00.000Z, `merge` printed intentRecordedAt 2026-11-11T04:52:24.789Z, issuedAt 2026-09-11T00:00:00.000Z, finishedAt 2026-11-11T04:52:24.833Z, and `deploy` intentRecordedAt 2026-11-11T04:52:24.956Z."
  same_class: "Every function with a time parameter that defaults to the wall clock and is called from src/loop: the lease calls (`claim`, `fence`, `takeover`) and the review-queue calls of src/loop all pass `now` except controller.ts:348 (`this.queue.pool(goal.reviewPool)` in `poolBusy`, which no production code calls, audit item F25): out of scope. `makeStop` callers in src/loop all pass `at`. Journal `ts` (src/state/journal.ts:131) and the `updatedAt` that `GoalStore` writes (src/state/goal-store.ts:38, :85, :97) take the wall clock for every caller and are non-goals."
sweep: "git grep -n \"new Date(\\|Date\\.now(\\|nowIso(\" -- src/loop on main at 92796d4f: card-runner.ts:239, release-runner.ts:68, run-driver.ts:23, worktree-reclaim.ts:114 (default clock of the deps object: keep); card-runner.ts:2121 (`Date.now() - since`, since being the reviewer log's mtime: keep, a file time is wall-clock time and an injected time would compare a fixture date with a real one); card-runner.ts:2708 (`new Date(Date.parse(now) + 15 min)`, from the injected `now`: keep); controller.ts:806 (`new Date(deadlineMs)` checks that a given deadline is a calendar time: keep); controller.ts:104 (`deps.now ?? nowIso`: keep). git grep -n \"ops\\.\\(recordIntent\\|markIssued\\|markRunning\\|markResult\\|reconcile\\)(\" -- src/loop: the eleven calls of R1 (fixed) and the five that pass the time (unchanged). cli/main.ts:380, :1085, :1105 call the ledger with the CLI's wall clock, which is the clock of a CLI run: not affected. src/delivery/ship.ts:341 (`DryRunShipPath` receipt times): out of src/loop, not affected. Ledger timestamp contracts are pinned by tests/infra/reconcile.test.ts:31,41,47,57,66; runner clock propagation has no assertion on main. Ledger order: `OperationLedger.list` sorts by `intentRecordedAt` and then by file name, whose suffix is random, so records written at one fixture instant have no fixed order; tests/scenarios/review-admit-foreign.test.ts:140-144 and tests/scenarios/ship-throw.test.ts:232 assert the order of two merge records made with no clock advance (R3); tests/scenarios/op-intent-dup.test.ts:204 records its two intents at distinct earlier times and is not affected."
forbid: [weakening or skipping a test to go green, changing an assertion of review-admit-foreign.test.ts, ship-throw.test.ts or ship-effect-unknown.test.ts, any change to those three files beyond the one line each of R3, a change to the `OperationLedger` signatures or defaults, a change to which record a ledger read returns, editing .aidlc state by hand]
non_goals: [journal event `ts` and `GoalStore` `updatedAt` on the wall clock, the `DryRunShipPath` receipt times, the board's fixed review limits (the other half of audit item F21), the CLI's ledger calls, a tie order for ledger records of one instant]
hygiene: "This card replaces T0-OP-TIMESTAMP-NOW, which stopped for risk: its candidate 75657155 passed R3 at decision 1 and the second pass, and at SHIP the loop stopped it with STOP risk, detail `security gate red` naming the check Gitleaks (committed history) of PR 285 (2026-11-11T23:34:04Z). The finding is not in the candidate: it is a lesson line of docs/LESSONS.md that the close of T0-CLAUDE-EFFORT-OPT-IN committed to main (7265d106), which the history scan reported on every pull request until T0-GITLEAKS-LESSON-FP listed it by its fingerprint; the other four checks of PR 285 are green, the commits of the branch alone scan clean, and the loop has no command that clears a risk stop. The branch T0-OP-TIMESTAMP-NOW-2 starts from main after T0-GITLEAKS-LESSON-FP has merged, and the diff of 75657155 against main (`git diff origin/main...75657155`, merge base 3ec989af; the commits of main after that base change none of its files) is applied to it as the candidate, with these changes only. (1) Every place of the diff that names T0-OP-TIMESTAMP-NOW as the card of the change names T0-OP-TIMESTAMP-NOW-2: the CHANGELOG entry begins `- T0-OP-TIMESTAMP-NOW-2 (bugfix, replaces T0-OP-TIMESTAMP-NOW, audit item F21, the timestamp half)`, and in tests/scenarios/op-clock.test.ts the header comment (:2) says `Card T0-OP-TIMESTAMP-NOW-2:` and the titles at :95 and :215 begin `T0-OP-TIMESTAMP-NOW-2 acceptance`. At 75657155 these are the four places that name it (CHANGELOG.md:25 and those three; none in src). (2) The hunk of specs/tasks/T0-OP-TIMESTAMP-NOW.md, its Attempt evidence, is not applied to that file: the evidence moves into a section `## Attempt evidence` of this file under a History line that names the predecessor, with a note at each figure of where it was measured (the commit of the branch T0-OP-TIMESTAMP-NOW it was run on, and the run: the Windows DoD, the coordinator's Linux run, the revert rows, the full-suite run), followed by the DoD of this card on its own branch. The old card file stays as it is on main. R1 to R4 and acceptance 1 to 5 are those of the predecessor and are met by the carried candidate, so the work of this card is the carry, the renaming of (1), the moved evidence and the DoD. RED: commit tests/scenarios/op-clock.test.ts alone first, on the sources of main, run it (it fails on main, as the predecessor's RED commit 18c22766 did) and record that commit as the RED receipt; then commit the rest of the diff. The coordinator closes PR 285 in favour of this card's pull request and scans the branch with gitleaks before the review. What follows is the predecessor's hygiene, which still holds. Line numbers are from main at 92796d4f (card-runner.ts lines after :1641 moved by 2 when PR 260 merged); read them again at PREPARE. Insert the CHANGELOG entry directly above the entry that begins `- T0-SCAN-SETUP-STEP-2`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. T0-RELEASE-OP-REISSUE, T0-STAGING-LEASE-RELEASE and T0-RELEASE-REPORT-STEP, the earlier cards of this list, merge first into src/loop/release-runner.ts and CHANGELOG.md; re-run the scan of acceptance 2 after they merge, since a ledger call in their code must pass the time too. The one line added to each of review-admit-foreign.test.ts and ship-throw.test.ts fixes a fixture that relied on wall-clock order between two ships; it weakens no assertion. If another test turns out to depend on that order, stop and amend this card rather than adding an advance outside allow_paths. This card changes src/loop/card-runner.ts, a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE; the change adds, removes and reorders no write, so the expected outcome is in sync. Tests assert the fixture time (`fx.now()`), never the wall clock (CLAUDE.md: nothing in tests/ calls Date.now())."
doc_sync: CHANGELOG.md, .claude/skills/verify-card-run-writes/SKILL.md (sync commit at CLOSE, by the coordinator on main)
---

# T0-OP-TIMESTAMP-NOW-2

## Deliverable
The operation records that the card runner and the release runner write take every timestamp, and their id, from the injected clock, as the rest of each run's records already do. Two fixtures that depended on wall-clock order between two ships advance the fixture clock by 1 ms instead.

## Why
Audit of 2026-11-11, item F21 (the timestamp half), confirmed by two models; card reviewed by two more on 2026-11-11 and amended to the planner's rulings. Eleven ledger writes in src/loop leave out the time argument, so under a fixed test clock an operation's intent and result times are the wall clock while its issue time and the run around it are the fixture time, and the ledger's order by `intentRecordedAt` mixes the two clocks.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/op-clock.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/release.test.ts tests/scenarios/release-reissue.test.ts tests/scenarios/release-lease.test.ts tests/scenarios/release-report-step.test.ts tests/scenarios/ship-throw.test.ts tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/ship-effect-unknown.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the fault-point check adds no pin.

## Planner note of 2026-11-12 (before the start)

Since this card was written, the cards it follows have merged: T0-RELEASE-OP-REISSUE (PR 263), T0-RELEASE-REPORT-STEP (PR 276), T0-OPS-CWD (PR 275) and T0-STAGING-LEASE-RELEASE as its replacement T0-STAGING-LEASE-RELEASE-2 (PR 282), which created tests/scenarios/release-lease.test.ts and moved the release intent into the attempt and environment lease sections. The line numbers of R1 and R2 are those of main at 92796d4f: find each call by content. The count of calls may differ now: R1 holds for every call of the five ledger methods in src/loop as it is on main today, the scan of acceptance 2 is the completeness check, and the Attempt evidence lists each call found with its file and line. If a ledger call exists today that no branch test of acceptance 1 can reach with the fixtures the card names, stop and report it before writing a test for it.

At CLOSE the coordinator moves both references of the sync commit in .claude/skills/verify-card-run-writes/SKILL.md to the merge commit; the implementer does not edit that file. Fixtures follow the rules of the current cards: temporary directories from tests/infra/helpers.ts or the scenario harness, removed with `cleanup` in an `after` hook; no new `mkdtempSync`; fixed times only.

## Replacement note of 2026-11-12

T0-OP-TIMESTAMP-NOW-2 carries the reviewed candidate of T0-OP-TIMESTAMP-NOW (75657155, PR 285). That card passed its formal review and stopped at SHIP because the history secret scan was red on main for a cause outside its diff (card T0-GITLEAKS-LESSON-FP). A risk stop has no clearing command, so the candidate ships under this card, as T0-DIRTY-SUCCESS-2 and T0-STAGING-LEASE-RELEASE-2 did. The front-matter field `hygiene` states exactly what differs from the predecessor's diff: four renamed places and the moved evidence.

## Attempt evidence

History: this card carries the candidate 75657155 of T0-OP-TIMESTAMP-NOW (branch T0-OP-TIMESTAMP-NOW, PR 285), which passed R3 and stopped at SHIP for risk on a history scan finding outside its diff. The figures under "Predecessor" were measured on commits of the branch T0-OP-TIMESTAMP-NOW, each named at its figure; the figures under "This card" were measured on this branch.

### This card
- RED `f98c8d95` (tests/scenarios/op-clock.test.ts alone, renamed in its three places, on the sources of main at 19a47a85), `node --test tests/scenarios/op-clock.test.ts`, Windows: exit 1, tests 13, pass 0, fail 13, each an AssertionError (the 12 branch tests on the wall-clock time against the fixture time, the scan listing the 11 calls without a time).
- Carry `db68ad66`: the diff of `origin/main...75657155` for src/loop/card-runner.ts, src/loop/release-runner.ts and the three fixture lines applied unchanged with `git apply`; the CHANGELOG entry inserted directly above `- T0-SCAN-SETUP-STEP-2` with its first words renamed. The card's own delta (`git diff origin/main...75657155` against `git diff origin/main...HEAD` for src, tests and CHANGELOG.md) differs in the four renamed places only; a two-dot `git diff 75657155 HEAD` also shows what main gained since (T0-GITLEAKS-LESSON-FP and T0-CI-PERMISSIONS: two CHANGELOG entries, tests/surface/gitleaks-ignore.test.ts, tests/surface/workflow-permissions.test.ts).
- Ledger calls on this branch at db68ad66: the same 17 at the same lines as the table below (`git grep` of the five methods in src/loop).
- DoD on db68ad66, Windows: `dod_command` exit 0; typecheck clean; tests 172, pass 169, fail 0, skipped 3; fault-points.test.ts unchanged and passing, no new pin.
- Size: `git diff --shortstat origin/main...HEAD` at db68ad66: 7 files, 235 insertions, 11 deletions (246) against the budget of 460, before this section.

### Predecessor (branch T0-OP-TIMESTAMP-NOW)
Commits there: RED `18c22766` (on base 93ca9a7d), GREEN `a239a530`, merge `933988f1`, third fixture line `6cfc93e0`, documents `438b4def`, merge `d182ccfd`, evidence `75657155`.

Ledger calls in src/loop (17; `git grep` and the scan of acceptance 2 agree; read at 6cfc93e0):
| Call | Time on main | Now |
|---|---|---|
| card-runner.ts:1205 `recordIntent` (merge) | none | `now` |
| card-runner.ts:1235 `markResult` cancelled (joined) | none | `now` |
| card-runner.ts:1242 `markResult` cancelled (not admitted) | none | `now` |
| card-runner.ts:1270 `markResult` cancelled (arming read throws) | none | `now` |
| card-runner.ts:1292 `markResult` cancelled (drift) | none | `now` |
| card-runner.ts:1313 `markIssued` | `now` | unchanged |
| card-runner.ts:1343 `markResult` UNKNOWN (`settleThrownShip`) | none | `this.clock()` |
| card-runner.ts:2760 `markResult` (in flight) | none | `now` |
| card-runner.ts:2812 `markResult` failed (merge-unconfirmed) | none | `now` |
| card-runner.ts:2821 `markResult` succeeded / UNKNOWN | none | `now` |
| card-runner.ts:2832 `markResult` UNKNOWN (effect-unknown) | `now` | unchanged |
| card-runner.ts:2838 `markResult` failed | none | `now` |
| release-runner.ts:295 `reconcile` | `now` | unchanged |
| release-runner.ts:507 `recordIntent` (deploy/recovery) | none | `now` |
| release-runner.ts:543 `markIssued` | `now` | unchanged |
| release-runner.ts:550 `markRunning` | `now` | unchanged |
| release-runner.ts:551 `markResult` | `now` | unchanged |

R2: the branch changes no other line of src/loop (`git diff origin/main...HEAD -- src/loop`, against the merge base, is the 11 lines above).

RED (on 18c22766, Windows: 13 tests, 0 pass, 13 fail). Each acceptance 1 test failed on its time assertion, the wall clock (2026-11-11T22:45Z) against the fixture time: merge intent (`intentRecordedAt` and `op-20261111224509-` against `op-20260911000100-`), joined, not admitted, arming read throws, drift, ship throws, in flight, merge-unconfirmed not merged, merged succeeded, merged UNKNOWN, dod-failed (each `finishedAt`), release deploy (`intentRecordedAt` and `op-20261111224511-` against `op-20260911001200-`). Acceptance 2 failed listing the 11 calls marked "none" above.

Revert table (on 6cfc93e0, Windows, the implementer's revert runs; 15 rows, 15 red; each piece reverted alone, then restored, `git status` clean afterwards):
| Reverted | Branch test | Scan (acceptance 2) |
|---|---|---|
| card-runner.ts:1205 time argument | merge intent: red | red |
| :1235 | joined: red | red |
| :1242 | not admitted: red | red |
| :1270 | arming read throws: red | red |
| :1292 | drift: red | red |
| :1343 | ship throws: red | red |
| :2760 | in flight: red | red |
| :2812 | merge-unconfirmed not merged: red | red |
| :2821 | merged succeeded: red | red |
| :2821 | merged UNKNOWN: red | red |
| :2838 | dod-failed: red | red |
| release-runner.ts:507 | release deploy: red | red |
| review-admit-foreign.test.ts `c.fx.advance(1)` removed | acceptance 4: red in 4 of 8 runs | n/a |
| ship-throw.test.ts `fx.advance(1)` removed | acceptance 4: red in 6 of 8 runs | n/a |
| ship-effect-unknown.test.ts `fx.advance(1)` removed | "after a reconcile ...": red in 8 of 8 runs | n/a |

ship-effect-unknown "after a reconcile the card ships again" alone, 8 runs each (Windows): R1 without the line 6 fail (at a239a530, before the amendment), base source 0 fail (sources of 93ca9a7d), R1 with the line 0 fail (6cfc93e0).

Full suite (`npm test` on 6cfc93e0, Windows, the implementer's run): exit 0, 3321 tests, 3299 pass, 0 fail, 22 skipped. No other ordering-related failure was observed in this run (tests such as tests/scenarios/op-intent-dup.test.ts:204 and tests/scenarios/release-reissue.test.ts:283 read ledger order on purpose and pass). tests/infra/exec.test.ts passed in this run and alone (61/61); in an earlier full run (at a239a530, before the third line) its acceptance 4 failed once on load timing.

DoD (on 6cfc93e0, Windows): `dod_command` exit 0; typecheck clean; 172 tests, 169 pass, 0 fail, 3 skipped; fault-points.test.ts unchanged and passing, no new pin.

Coordinator runs on the predecessor branch (at d182ccfd, before the review): Linux (WSL Ubuntu, Node v22.23.4), the test files the branch adds or changes (op-clock, review-admit-foreign, ship-effect-unknown, ship-throw): tests 35, pass 35, fail 0, skipped 0. Windows doc-pin run, 73 test files reading 1 changed document: tests 1803, pass 1791, fail 1; the failure was tests/infra/exec.test.ts in the parallel run, which passes alone (61 pass), a load failure.

After the pre-review of c2599307 (coordinator edits at 438b4def, documents and evidence only): a Codex pre-review found all seventeen ledger calls passing the injected clock, no write added, removed or reordered, the three fixture lines honest (they establish the order their assertions need; the order of two records of one instant stays out of scope) and four sentences to correct; the planner changed R4 on main and the coordinator edited the rest. No source or test changes. (1) CHANGELOG.md and the sentence table: the clock decides the record times, the time prefix of the id and the first sort key of the ledger; two records of one instant keep a random id suffix and no fixed order. (2) The R2 evidence cites the three-dot diff against the merge base. (3) The full-suite sentence says what was observed. (4) The scan of acceptance 2 is a completeness check over calls written as a property access on an expression that ends in `ops`, as the card defines it; a call through an alias of the ledger or a computed member name is outside it, and acceptance 1 stays the behavioural proof. In production the clock is the wall clock read once at the entry of the method, so a record now carries that time where it carried a later read; no gate reads the difference.

### Document sentences
| CHANGELOG sentence | Made true by |
|---|---|
| every ledger write of the card runner and release runner passes the injected clock; times and id prefix come from `now` | the 11 lines above; op-clock.test.ts acceptance 1 and 2 |
| before, eleven calls left the time out | the RED runs (18c22766 and f98c8d95) listing 11 calls |
| a fixture's fixed clock decides the record times, the time prefix of the ids and the first sort key of the ledger, not the order of two records of one instant; three tests advance 1 ms, no assertion changed | the three `advance(1)` lines; revert rows 13-15 |
