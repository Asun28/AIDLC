---
id: T0-RELEASE-REPORT-STEP
title: aidlc release report records only the manual step the attempt's state asks for, with one of three statuses; a failed verification is final and stops the attempt as a failed operation of that state does
status: todo
branch: T0-RELEASE-REPORT-STEP
worktree: D:\wt\AIDLC\T0-RELEASE-REPORT-STEP
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: budget raised from 240 to 400 after two reviews of the card (Codex and Fable 5.2) against main at 92796d4f; about 60 source lines in two files, the rest the state table, finality, needs and CLI tests the rulings require, docs and attempt evidence; raised from 400 to 600 by the coordinator on the candidate d7081674, which is 556 changed lines: 60 source lines in two files, 377 lines of the seven acceptance tests, 8 lines of docs and 123 lines of attempt evidence (a revert table of 35 rows); raised from 600 to 700 by the coordinator on the repaired candidate d3d2ea65, which is 628 changed lines: 60 of source, 428 of tests, 132 of attempt evidence (a revert table of 39 rows), 8 of docs; raised from 700 to 760 by the coordinator on the candidate 9a2450e8, which is 707 changed lines after the docs were restated sentence by sentence (source 60 lines, unchanged since d3d2ea65)"
allow_paths:
  - src/loop/release-runner.ts
  - src/cli/main.ts
  - tests/scenarios/release-report-step.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-RELEASE-REPORT-STEP.md
dod_command: npm run typecheck && node --test tests/scenarios/release-report-step.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts
dod_exit: 0
requirements:
  - R1. `ReleaseRunner.reportStep` shall accept a step name only when the attempt it is given (the stored attempt `aidlc release report` reads) expects it, comparing the whole name as an exact, case-sensitive string, and the expected names are exactly these three. `package-run-proof` is expected in PREPARE of an attempt whose `target` is `package` when the list of PREPARE needs that `next` builds (release-runner.ts:167-173 on main at 92796d4f: a candidate digest that is present and not empty, a source sha that is present and not empty, every role of the target bound, no roles problem such as an unreadable ops configuration) is empty, which is the condition under which `next` asks for the run proof (:176). `stage-verify` is expected in STAGE when the `stage-deploy` step is `succeeded`. `recover-verify` is expected in RECOVER when the `recover` step is `succeeded`. A step reported `succeeded` stays expected, and may be reported again with any status, until the state advances; a step whose stored status is `failed` is no longer expected, whatever status is reported next (`failed` is final). Every other name is refused: the operation step names `stage-deploy`, `apply-deploy` and `recover`, an empty name, any other name, a name that differs only in letter case or by surrounding whitespace, and each of the three in any other state or condition (every `ReleaseState` other than the one named for it, PREPARE of another target, STAGE with `stage-deploy` absent, `running`, `UNKNOWN` or `failed`, RECOVER with `recover` not `succeeded`).
  - R2. `reportStep` shall accept a status only as one of the exact strings `succeeded`, `failed` and `UNKNOWN`, and refuse every other value: `pending`, `running` and `skipped` (which the step schema would store), another letter case such as `Succeeded`, an empty string and any other text.
  - R3. A refusal of R1 or R2 shall throw before any journal append and before any save, with a message that names the attempt id, its state, the refused name or status, and the step names the state expects or that it expects none; `aidlc release report` (src/cli/main.ts:1141-1153), the only caller of `reportStep`, then writes it to stderr and exits 1 (run as `node src/cli/main.ts`, as the CLI tests do, the line is `aidlc: <message>`), after the `--goal` refusal of `releaseCtx`, which is unchanged. An accepted report keeps the order of main: `EVIDENCE_RETAINED` is appended (:337) before the save (:342), so a save that fails leaves that journal event and no stored step; finality is read from the stored step, so the step is still expected and a repeated report is accepted.
  - R4. WHEN the `stage-verify` step is `failed`, `ReleaseRunner.next` in STAGE shall stop the attempt as it stops a failed `stage-deploy` today (:208-211): saved STOP reason `release-health`, detail `staging verification failed`, next action `diagnose; a repair card re-enters candidate preparation`, `global` false, disposition `failed`. The check is the first of the STAGE case: a stored `failed` `stage-verify` stops whatever the `stage-deploy` step is (absent, or in any status) and before any operation is issued, since main accepted a `stage-verify` report on an attempt with no `stage-deploy` step and such an attempt would otherwise reach `issue`. An attempt that holds both a `failed` `stage-deploy` and a `failed` `stage-verify` therefore stops with `staging verification failed`. (Added by the planner on 2026-11-11 after a pre-review of d7081674.)
  - R5. WHEN the `recover-verify` step is `failed`, `ReleaseRunner.next` in RECOVER shall stop the attempt as it stops a failed `recover` today (:264-267): saved STOP reason `release-health`, detail `recovery verification failed`, next action `escalate to the named owner with environment and data state`, disposition `failed`. The check is the first of the RECOVER case, with the same rule and for the same reason as R4: a stored `failed` `recover-verify` stops whatever the `recover` step is and before any operation is issued, and with both failed the stop names the verification.
  - R6. WHEN the `package-run-proof` step is `failed`, `ReleaseRunner.next` in PREPARE of a `package` attempt shall read that step before it builds the needs list and stop the attempt with saved STOP reason `release-health`, detail `package install/run proof failed`, next action `diagnose; a repair card re-enters candidate preparation`, `global` false, disposition `failed` (planner ruling B of 2026-11-11; PREPARE issues no bound operation, so this is the STAGE handling of R4). `aidlc release candidate` (`setCandidate`, :345-349) does not clear the failed step.
  - R7. The STOPs of R4, R5 and R6 shall be saved and returned as the other STOPs of `ReleaseRunner.next` are on main (the attempt saved in STOP with disposition `failed`, a `stop` directive returned). The release of an attempt's environment leases at a terminal attempt is not this card's: T0-STAGING-LEASE-RELEASE merges after this card (the order changed on 2026-11-11) and covers these STOPs through the exit it adds.
  - R8. WHEN an expected step is reported `UNKNOWN`, the attempt shall keep its state and `next` shall return the directive that asks for that step, as on main.
  - R9. A `succeeded` report of an expected step shall have the effect it has on main: `package-run-proof` moves the attempt to DONE inside `reportStep` (:339-341), `stage-verify` and `recover-verify` are read by the next `next` (:196, :259), and `GoalController.nextInDeliver` (src/loop/controller.ts:426) reads a `succeeded` `stage-verify` of a delivered production attempt.
  - R10. The description of `aidlc release report` (src/cli/main.ts:1143) shall name the three accepted steps and the state of each, without the trailing `...`.
  - R11. Each document shall state the facts named after it: docs/OPERATIONS.md, section Standalone release (package / staging / production), R1, R2, R4, R5 and R6; docs/ARCHITECTURE.md, the paragraph after the release state diagram, R1 and the three failed-verification stops in one sentence, and the edge label `PREPARE --> STOP` at docs/ARCHITECTURE.md:92 gaining `failed run proof (release-health)`; CHANGELOG.md, Unreleased, the card id and R1 to R8.
acceptance:
  - 1. `tests/scenarios/release-report-step.test.ts` "release report accepts only the step the attempt's state asks for" passes and fails on main: a table over every `ReleaseState` (PREPARE of a staging and of a package target, STAGE, CHECKPOINT, APPLY, OBSERVE, RECOVER, CLOSE, WAIT, DONE, STOP), with attempts stored directly as tests/scenarios/release.test.ts:230-248 does, plus STAGE with `stage-deploy` absent, `running`, `UNKNOWN` and `failed`; in each row every name of R1 the row does not expect (each operation step name, `anything`, an empty name, `Stage-Verify`, ` stage-verify`, and each manual name outside its row) throws a message naming the attempt, the state and the expected names, and the stored attempt and the journal length are unchanged; in the three expecting rows the expected name is accepted. [R1] [R3] [dod arm 1]
  - 2. Same file, "a status outside succeeded, failed and UNKNOWN is refused before any write" passes and fails on main (main stores `pending` and appends `EVIDENCE_RETAINED` before an invalid status throws): `pending`, `running`, `skipped`, `Succeeded`, an empty string and `done`. [R2] [R3] [dod arm 1]
  - 3. Same file, "a package run proof is refused through aidlc release report until the PREPARE needs are met, so the attempt never reaches DONE without them" passes and fails on main (main reaches DONE with no candidate and no bound operation): with the candidate digest absent, the digest empty, the source sha absent, the sha empty, the `build` role missing, the `package` role missing, and the ops configuration unreadable (`OpsLoad` status `unreadable`, src/delivery/ops.ts:113), each separately, the report throws and the attempt stays in PREPARE; with every need met it reaches DONE. [R1] [R9] [dod arm 1]
  - 4. Same file, "a failed verification stops the attempt as a failed operation of its state does" passes and fails on main (main asks for the step again): `stage-verify` `failed` gives STOP `release-health` `staging verification failed`, `recover-verify` `failed` gives STOP `release-health` `recovery verification failed`, `package-run-proof` `failed` gives STOP `release-health` `package install/run proof failed` also when the ops configuration became unreadable after the report, each with disposition `failed`. [R4] [R5] [R6] [R7] [dod arm 1]
  - 5. Same file, "a failed manual step is final" passes and fails on main: for each of the three steps, after a `failed` report, reports of `succeeded`, `UNKNOWN` and `failed` each throw with the stored attempt and the journal length unchanged, and then `next` gives the STOP of acceptance 4; after a `failed` `package-run-proof`, `aidlc release candidate` with a new digest leaves the step `failed` and `next` still stops. A `succeeded` `stage-verify` reported again as `failed` before `next` is accepted and `next` stops. [R1] [R3] [R6] [dod arm 1]
  - 6. Same file, "an UNKNOWN verification keeps the state and the step is asked for again" passes, as on main, for each of the three steps. [R8] [dod arm 1]
  - 7. Same file, "aidlc release report refuses an operation step by exit 1 and writes nothing" passes and fails on main: the CLI run with `--step stage-deploy --status succeeded` on a staged attempt exits 1, its stderr holds the message of R3, and the attempt and the journal are unchanged; `aidlc release report --help` names the three steps. [R3] [R10] [dod arm 1]
  - 8. `tests/scenarios/release.test.ts` passes unchanged: each of its `stage-verify`, `recover-verify` and `package-run-proof` reports is made in the state that expects it, and its `--goal` refusal test still sees the goal message first; `tests/scenarios/release-publication.test.ts` and `tests/scenarios/release-reissue.test.ts` pass unchanged. [R1] [R3] [R9] [dod arm 1]
  - 9. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md state the facts R11 names (reviewer-verified against the diff). [R11]
depends_on: [T0-RELEASE-OP-REISSUE]
budget: 760
tdd: true
diagnosis:
  root_cause: "`reportStep` (release-runner.ts:333-343 at 92796d4f) stores whatever name and status it is given, replacing any step of that name (an operation step and its `operationId` included), appends `EVIDENCE_RETAINED` before the status is checked, and moves a package attempt to DONE on `package-run-proof` with only the run-proof guard (release-machine.ts:110-113), never the PREPARE needs that `next` checks before asking for the proof. `next` reads `stage-verify` and `recover-verify` only for `succeeded`, so a `failed` one is asked for again with no end."
  repro: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\9050b3d1-5897-4caa-9057-e38858fcf6bf\\scratchpad\\probe4.test.ts P18 (package attempt DONE delivered with no candidate and no bound operation); C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-release.test.ts case D (a reported `stage-deploy` replaced the operation step, `stage-verify` `failed` left the attempt in STAGE asking for it again, status `pending` was stored, an invalid status appended `EVIDENCE_RETAINED` and then threw)."
  same_class: "Every writer of `ReleaseAttempt.steps`: `issue` (operation steps with an `operationId`) and the step sync of `next` (only steps with an `operationId`) are not affected; `setCandidate` keeps the steps (R6); the controller's `release-result` report writes a whole attempt and is a non-goal. Every reader of a manual step: `next` at :176 (package), :196 (STAGE), :259 (RECOVER), the checkpoint packet's `dataSteps` (:95) and `nextInDeliver` (controller.ts:426), each covered by R4 to R9."
sweep: "git grep -n \"stage-verify\\|recover-verify\\|package-run-proof\\|reportStep\\|release report\" -- src docs README.md .claude templates on main at 92796d4f: release-runner.ts:176 and :197 narrations (unchanged), :196, :259 readers (R4, R5), :333-343 `reportStep` (R1, R2, R3), :339 package DONE (R9); cli/main.ts:1143 description (R10), :1151 the one caller (R3); controller.ts:426 (R9, unchanged); docs/OPERATIONS.md:127, :130, :139 and docs/ARCHITECTURE.md:92 (R11). Tests that pin the current behaviour: tests/scenarios/release.test.ts:86, :141, :173, :206, :336, :357, :435, :452, :476, :509 report an expected step in its state and stay green; :403 refuses a foreign `--goal` before the step check and stays green; no test reports an unexpected name or status or a step after a failed one. .claude/skills/aidlc-loop/release.md names `aidlc release report` only (4494 of its 4500 bytes): not changed."
forbid: [weakening or skipping a test to go green, changing the release state diagram (`RELEASE_TRANSITIONS`) or the guards of `src/core/release-machine.ts`, moving the STOP of R4 to R6 into `reportStep`, accepting any report of a step whose stored status is `failed`, editing .aidlc state by hand]
non_goals: [another process that saves the same attempt between the read of `aidlc release report` and its save (`reportStep` decides on the attempt it is given, R1; `GoalStore.saveRelease` has no compare-and-swap and src/state/ is outside this card; one session drives a release attempt), the raw attempt patch `aidlc report --result release-result --attempt <id> --data <json>` (src/cli/main.ts:434-462), which writes a whole attempt without these checks, a `release-result` report to the goal from `aidlc release report` when the package attempt reaches DONE (the goal reads the stored attempt as on main), new manual step names, a retry of a failed verification within the same attempt, moving the `EVIDENCE_RETAINED` append after the save, the narration of the stage and recover directives, `.claude/skills/aidlc-loop/release.md`]
hygiene: "Line numbers are from main at 92796d4f; read them again at PREPARE. Insert the CHANGELOG entry directly above the entry that begins `- T1-VERIFY-MUTANT-GEN:`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. T0-RELEASE-OP-REISSUE merged first into the same files (src/loop/release-runner.ts, docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md); T0-STAGING-LEASE-RELEASE and T0-OPS-CWD are in flight on src/loop/release-runner.ts and src/cli/main.ts and merge after this card, so keep the edits to the lines the requirements name and do not reorder the returns of `next`. Read the PREPARE needs through one helper that `next` and `reportStep` both call, so the condition of the run-proof directive and of its acceptance cannot differ. Before the first R3, revert each source hunk in a scratch copy and run the tests of its requirement (lesson 2026-11-11 T0-AUDIT-FIXES). Neither changed source file is in the verify-card-run-writes coverage record."
doc_sync: docs/OPERATIONS.md (Standalone release), docs/ARCHITECTURE.md (release state machine and the edge label at :92), CHANGELOG.md
---

# T0-RELEASE-REPORT-STEP

## Deliverable
`aidlc release report` records only `package-run-proof`, `stage-verify` or `recover-verify`, each only in the state and condition in which `aidlc release next` asks for it, and only with `succeeded`, `failed` or `UNKNOWN`; anything else is refused before any write. A failed verification is final and stops the attempt with `release-health`, as a failed deployment or recovery of that state does.

## Why
Audit of 2026-11-11, item F12, confirmed by two models; card reviewed by two more on 2026-11-11 and amended to the planner's rulings. `release report --step package-run-proof` delivered a package attempt with no candidate and no bound operation, any step name was accepted and could replace an operation step, and a failed staging verification left the attempt asking for the same verification with no end.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/release-report-step.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; the four existing release files pass unchanged.

## Attempt evidence

Attempt 1 (effort high). RED commit `1d88c7a3` (the test file alone, sources of main at e4ec94af): 6 of 7 tests failed and acceptance 6 passed, as the card says. First failing assertion per test: acceptance 1 `Missing expected exception: PREPARE "stage-deploy" "succeeded"` (main stores an operation step name); acceptance 2 `Missing expected exception: PREPARE "package-run-proof" "pending"` (main stores `pending`); acceptance 3 `Missing expected exception: PREPARE "package-run-proof" "succeeded"` with the candidate digest absent; acceptance 4 `expected: 'stop'`, `actual: 'prepare'` (main asks for the failed run proof again); acceptance 5 `Missing expected exception: PREPARE "package-run-proof" "succeeded"` after a `failed` report; acceptance 7 `expected: 1`, `actual: 0` (the CLI stored `stage-deploy`). After the RED commit the test file gained two blocks and nothing else: the refusals after the state advances (acceptance 1) and the staging attempt that carries a stored failed `package-run-proof` (acceptance 4); no test file of main is changed.

Source: `src/loop/release-runner.ts` gains `prepareNeeds` (the needs list `next` built inline, now read by `next` and by `expectedSteps`), `expectedSteps`, `isReportStatus`, the two refusals at the top of `reportStep` and three STOPs in `next`, each the first statement of its case: PREPARE before the needs, STAGE before the `stage-deploy` check, RECOVER before the `recover` check. `src/cli/main.ts` changes the description of `release report` only. The returns of `next` keep their order; each STOP is a new early return.

Repair after the Codex pre-review of `d7081674` (card amended at 25efcd24: budget 600, the concurrent writer of the attempt a non-goal). (1) R4 and R5: main accepted a verification report in any state, so an attempt can be stored in STAGE with a `failed` `stage-verify` and no `stage-deploy` step, or in RECOVER with a `failed` `recover-verify` and no `recover` step; on `d7081674` `next` issued the operation for those. Each verification check now comes before its operation-step check, so a stored `failed` verification stops whatever the operation step is; no existing return moved. New test "a failed verification stored with any operation step stops before any operation is issued": attempts written to the store directly with the operation step absent or in each of the six step statuses, each giving the STOP of acceptance 4, with no runner call, no ledger record and no `OPERATION_INTENT`. (2) Order tests that could not fail: the R6 check of acceptance 4 now also asserts zero reads of the ops configuration (a counting `Proxy` around the `OpsLoad`, which `prepareNeeds` reads through `resolveRoles`), and every refusal checked by `assertRefused` asserts zero reads of the runner's clock (a counting clock). (3) The CLI child of the tests gets no variable whose upper-cased name is `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` or `GIT_CEILING_DIRECTORIES` from the caller, and `GIT_CEILING_DIRECTORIES` set to the fixture's parent directory, as given and as `realpathSync.native` returns it (a short 8.3 temporary path and its long form): git then stops discovery at the fixture, so a temporary directory inside a checkout does not resolve to that repository. The fixture is not made a repository because the CLI then takes its identity from git (`isGit` true, a canonical main root) and the scenario fixtures and release.test.ts run it as a plain directory. (4) The "Read once" sentence now names the non-goal. (5) docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md now say that the run proof is expected once the candidate and configuration prerequisites are met (which is when `release next` asks for the install/run proof, not when it lists no need) and say what main did with a status (stored any the step schema accepts; for any other, appended `EVIDENCE_RETAINED` and then failed the schema validation of the save).

Repair after the second Codex pre-review of `d3d2ea65` (card amended at cb5329a0: R4 and R5 stop whatever the operation step is, budget 700; main merged into the worktree at 459dda31). (1) The STOP sentences of docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md, and the `UNKNOWN` sentence of CHANGELOG.md, now say that they apply once `release next` reaches the case of the attempt's state, after the reconciliation of unresolved operations and the environment ownership checks it already makes, which keep their precedence; the source order is unchanged. Acc 4b gains the row that pins it: a `failed` `stage-verify` in STAGE whose environment lease another session holds gives `wait` on `environment:staging-held` and leaves the stored attempt unchanged; the revert row "R4 failed-verification STOP ahead of the reconcile and ownership checks" fails it. (2) The figures below are rerun on the final source commit, after the merge of main. (3) The test comment and the input-class row on a failed run proof stored on a staging attempt now name main's `release report` as a writer of such records as well as the raw patch.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/release-report-step.test.ts` "release report accepts only the step the attempt's state asks for" | pass; fails on main |
| 2 | same file, "a status outside succeeded, failed and UNKNOWN is refused before any write" | pass; fails on main |
| 3 | same file, "a package run proof is refused through aidlc release report until the PREPARE needs are met, so the attempt never reaches DONE without them" (the runner and the CLI for each of the seven needs) | pass; fails on main |
| 4 | same file, "a failed verification stops the attempt as a failed operation of its state does", and "a failed verification stored with any operation step stops before any operation is issued" (repair) | pass; both fail on main |
| 5 | same file, "a failed manual step is final" | pass; fails on main |
| 6 | same file, "an UNKNOWN verification keeps the state and the step is asked for again" | pass; passes on main |
| 7 | same file, "aidlc release report refuses an operation step by exit 1 and writes nothing" | pass; fails on main |
| 8 | `tests/scenarios/release.test.ts`, `release-publication.test.ts`, `release-reissue.test.ts`, unchanged (`git diff --stat origin/main...HEAD -- tests` lists only the new file) | pass (DoD below) |
| 9 | docs/OPERATIONS.md, Standalone release, the paragraph after "Staging:"; docs/ARCHITECTURE.md, the paragraph after the release state diagram and the `PREPARE --> STOP` label; CHANGELOG.md, the entry above `- T1-VERIFY-MUTANT-GEN:` | reviewer-verified |

Clause table (A). "Revert" names the row of the revert table below that removes or changes the code.

| Clause | Code | Test that fails without it |
|---|---|---|
| R1 accept a name only when the given attempt expects it | `reportStep`: `if (!expected.includes(stepName)) throw` | acc 1, 3, 5, 7 (revert "R1 name check removed") |
| R1 exact, case-sensitive whole-name comparison | `Array.prototype.includes` (strict equality), no trim or case fold | acc 1 name variants (revert "R1 name compared case-insensitively and trimmed") |
| R1 `package-run-proof` in PREPARE of a `package` attempt when the needs list is empty | `expectedSteps` first branch with `prepareNeeds`, the helper `next` calls | acc 1 rows of other targets and states, acc 3 each need (reverts "R1 package needs/target/state condition") |
| R1 `stage-verify` in STAGE when `stage-deploy` is `succeeded` | `expectedSteps` second branch | acc 1 rows (reverts "R1 STAGE state condition", "R1 stage-deploy succeeded condition") |
| R1 `recover-verify` in RECOVER when `recover` is `succeeded` | `expectedSteps` third branch | acc 1 rows (reverts "R1 RECOVER state condition", "R1 recover succeeded condition") |
| R1 a `succeeded` step stays expected and may be reported again with any status until the state advances | `expectedSteps` reads only `failed` as final | acc 5 (succeeded, succeeded, UNKNOWN, succeeded, failed before `next`); acc 1 refusals after DONE and CLOSE (revert "R1 succeeded stays expected") |
| R1 a stored `failed` step is no longer expected | `expectedSteps`: `status(name) !== 'failed'` | acc 5 (revert "R1 failed is final") |
| R1 every other name, and each of the three in another state or condition, is refused | as above | acc 1 table |
| R2 status only `succeeded`, `failed`, `UNKNOWN`, exact | `isReportStatus`; the second refusal of `reportStep` | acc 2 (revert "R2 status check removed"); each literal: reverts "R2 succeeded/failed/UNKNOWN not accepted" |
| R3 refusal before any journal append and any save | both refusals precede `this.clock()`, the append and `this.save` | every refusal in acc 1, 2, 3, 5, 7 asserts the stored attempt and the journal length unchanged and zero clock reads (reverts "R3 checks after the journal append", "R3 clock read before the report validation") |
| R3 message names the attempt id, the state, the refused name or status, the expected step or none | `refuse` in `reportStep` | acc 1, 2, 3, 5, 7 (reverts "R3 message names ...") |
| R3 CLI writes `aidlc: <message>` to stderr and exits 1, after the unchanged `--goal` refusal | the existing catch of `main()` (the `invokedDirectly` block of src/cli/main.ts) and `releaseCtx`, both unchanged | acc 7 (message line, exit 1, `--goal` message first), acc 3 CLI rows; release.test.ts "a release command refuses a --goal that does not own the attempt, and writes nothing" |
| R3 an accepted report appends `EVIDENCE_RETAINED` before the save; a failed save leaves the event and no step; the step stays expected and a repeat is accepted | `reportStep` body after the refusals, unchanged | acc 5 lost-save block for each of the three steps (revert "R3 accepted report journals before the save") |
| R4 failed `stage-verify` stops STAGE: `release-health`, `staging verification failed`, the next action, `global` false, disposition `failed` | `next` STAGE, first statement, before the `stage-deploy` check | acc 4 (staging and production attempts; stored with `stage-deploy` absent or in any status), acc 5 (reverts "R4 ...", "R4 verification check after the operation-step check") |
| R5 failed `recover-verify` stops RECOVER: `release-health`, `recovery verification failed`, the next action, disposition `failed`, as the failed `recover` STOP | `next` RECOVER, first statement, before the `recover` check, with the `makeStop` options of the failed `recover` STOP (`{ at: now }`) | acc 4 (also stored with `recover` absent or in any status), acc 5 (revert "R5 verification check after the operation-step check"); `global` is compared with the failed `recover` STOP of the same fixture (reverts "R5 ...") |
| R6 failed `package-run-proof` stops PREPARE of a `package` attempt, read before the needs | `next` PREPARE, first statement of the case | acc 4 (ops unreadable after the report; zero reads of the ops configuration; a staging attempt carrying the step is not stopped), acc 5 (reverts "R6 package failed stop", "R6 stop read after the needs", "R6 prepareNeeds called before the failed-proof check", "R6 stop only for a package attempt") |
| R6 `aidlc release candidate` does not clear the failed step | `setCandidate` unchanged | acc 5 (CLI `release candidate --digest c2`; the step stays `failed` and `next` stops) |
| R7 the STOPs are saved and returned as the other STOPs of `next` | `this.save(...)` then `stopOut` | acc 4 and 5: the stored attempt equals the returned one and the `stop` directive carries the same record (reverts "R4/R5/R6 stop saved") |
| R8 `UNKNOWN` keeps the state and `next` asks for the step | no change | acc 6 (passes on main, as the card says) |
| R9 a `succeeded` report has its effect on main | no change to the `succeeded` paths | release.test.ts "Q16: a staging goal with a synchronous bound deploy ..." (stage-verify), "Q22: ..." (recover-verify), "a package attempt asks for its run proof ..." and acc 3 (package DONE), "T0-PROD-GOAL-STAGES acceptance 1 ..." (`nextInDeliver`) |
| R10 the description names the three steps and their states, no `...` | src/cli/main.ts, `release report` description | acc 7 help (revert "R10 CLI description") |
| R11 documents | the three documents | acceptance 9 |

Input classes (C).

| Class | Result | Test |
|---|---|---|
| `package-run-proof` in each `ReleaseState` | expected only in PREPARE of a `package` attempt with no need; refused in PREPARE of `staging`, `production`, `migration`, `development` and `operations` (needs met), in every other state, and in WAIT, DONE and STOP of a package attempt | acc 1 |
| `stage-verify` in each `ReleaseState` | expected only in STAGE with `stage-deploy` `succeeded` (staging and production targets); refused in STAGE with `stage-deploy` absent, `pending`, `running`, `failed`, `UNKNOWN` or `skipped`, and in every other state | acc 1 |
| `recover-verify` in each `ReleaseState` | expected only in RECOVER with `recover` `succeeded`; refused in RECOVER with `recover` absent, `pending`, `running`, `failed`, `UNKNOWN` or `skipped`, and in every other state | acc 1 |
| status values | `succeeded`, `failed`, `UNKNOWN` accepted; `pending`, `running`, `skipped`, `Succeeded`, `""`, `done`, `SUCCEEDED`, `Failed`, `unknown`, `Unknown`, `" succeeded"`, `"succeeded "`, `cancelled` refused with nothing written | acc 1, 5, 6 (accepted); acc 2 (refused) |
| other step names | `stage-deploy`, `apply-deploy`, `recover`, `anything`, `""`, `Stage-Verify`, `" stage-verify"`, and for each of the three names its upper case, capitalised form, leading space, trailing space, trailing tab and leading newline: refused in every row with each of the three statuses | acc 1 |
| a report repeated before and after `next` | `succeeded` or `UNKNOWN` before `next`: accepted; `UNKNOWN` after `next` (state kept): accepted; after the state advanced (package DONE, staging DONE, RECOVER to CLOSE): refused; `failed` before `next` and after `next` (STOP): refused | acc 5, acc 6, acc 1 |
| the operation step of the state absent, `UNKNOWN`, `running`, `failed`, `succeeded` | only `succeeded` makes the verification expected | acc 1 STAGE and RECOVER rows |
| a `failed` `stage-verify` stored in STAGE, or `recover-verify` in RECOVER, with the operation step absent, `pending`, `running`, `succeeded`, `failed`, `UNKNOWN` or `skipped` (main accepted such reports) | STOP of R4 or R5 before any operation is issued | acc 4 (repair test) |
| a `failed` `stage-verify` stored in STAGE with `stage-deploy` `succeeded` while another session owns the environment lease | `next` waits on `environment:<env>` and the attempt is not stopped: the reconciliation and ownership checks before the case keep their precedence | acc 4b |
| a failed run proof stored on an attempt that is not `package` (the raw `release-result` patch writes one, and main's `release report` stored one in any state, so legacy records hold it) | not read: `next` returns what it returns for the same attempt without that step | acc 4 |

Read once (E). `reportStep` decides on the attempt it is given and writes that attempt plus the step: R1 names "the attempt it is given (the stored attempt `aidlc release report` reads)", and the CLI reads it from the store in `releaseCtx` right before the call. A second writer that saves the attempt between that read and the save (a concurrent `release report` or `release next` in another process) is not seen: `GoalStore.saveRelease` has no compare-and-swap, and `src/state/` is outside `allow_paths`. The card's `non_goals` name this window (amended at 25efcd24); no test covers it.

Revert table ("acc N" is the test of acceptance N in tests/scenarios/release-report-step.test.ts; "acc 4b" is the repair test "a failed verification stored with any operation step stops before any operation is issued"). Each row changes one source hunk on its own in the worktree, runs `tests/scenarios/release-report-step.test.ts` and `tests/scenarios/release.test.ts`, and restores the file. Run once more, all rows, after the last source change of the repair.

| Hunk changed | Result |
|---|---|
| R2 status check removed | fails: acc 2 |
| R2 succeeded not accepted | fails: acc 1, acc 3, acc 5, and 11 tests of release.test.ts |
| R2 failed not accepted | fails: acc 4, acc 5 |
| R2 UNKNOWN not accepted | fails: acc 1, acc 2, acc 5, acc 6 |
| R1 name check removed | fails: acc 1, acc 3, acc 5, acc 7 |
| R1 name compared case-insensitively and trimmed | fails: acc 1 |
| R1 package needs condition | fails: acc 3 |
| R1 package target condition | fails: acc 1 |
| R1 package state condition | fails: acc 1 |
| R1 STAGE state condition | fails: acc 1, acc 2, acc 4, acc 5, acc 6 |
| R1 stage-deploy succeeded condition | fails: acc 1 |
| R1 RECOVER state condition | fails: acc 1 |
| R1 recover succeeded condition | fails: acc 1 |
| R1 failed is final | fails: acc 5 |
| R1 succeeded stays expected (refused once succeeded) | fails: acc 5 |
| R3 accepted report journals before the save (append moved after) | fails: acc 5 |
| R3 checks after the journal append | fails: acc 1, acc 2, acc 3, acc 5, acc 7 |
| R3 message names expected | fails: acc 1, acc 2, acc 7 |
| R3 message names no expected step | fails: acc 1, acc 3, acc 5 |
| R3 message names state | fails: acc 1, acc 2, acc 3, acc 5, acc 7 |
| R3 message names attempt | fails: acc 1, acc 2, acc 3, acc 5, acc 7 |
| R3 message names refused name | fails: acc 1, acc 3, acc 5, acc 7 |
| R3 message names refused status | fails: acc 2 |
| R6 package failed stop | fails: acc 4, acc 5 |
| R6 stop only for a package attempt | fails: acc 4 |
| R6 stop read after the needs | fails: acc 4 |
| R6 stop global | fails: acc 4, acc 5 |
| R6 stop saved | fails: acc 4, acc 5 |
| R4 stage-verify failed stop | fails: acc 4, acc 4b, acc 5 |
| R4 stop global | fails: acc 4, acc 4b, acc 5 |
| R4 stop saved | fails: acc 4, acc 4b, acc 5 |
| R5 recover-verify failed stop | fails: acc 4, acc 4b, acc 5 |
| R5 stop global | fails: acc 4, acc 4b, acc 5 |
| R5 stop saved | fails: acc 4, acc 4b, acc 5 |
| R4 verification check after the operation-step check (as d7081674) | fails: acc 4b |
| R5 verification check after the operation-step check (as d7081674) | fails: acc 4b |
| R6 prepareNeeds called before the failed-proof check | fails: acc 4 |
| R3 clock read before the report validation (moved to the top) | fails: acc 1, acc 2, acc 3, acc 5 |
| R4 failed-verification STOP ahead of the reconcile and ownership checks (second repair) | fails: acc 4b |
| R10 CLI description | fails: acc 7 |

All 40 rows fail at least one test; no row stays green. After the second repair (test and docs only, no source change), the 9 R4 and R5 rows were run again with the new row: the same tests fail as above.

Forbid and non-goals:
- weakening or skipping a test: no test file of main is changed (`git diff --stat origin/main...HEAD -- tests` lists only `tests/scenarios/release-report-step.test.ts`).
- changing `RELEASE_TRANSITIONS` or the guards of `src/core/release-machine.ts`: that file is not in the diff; docs/ARCHITECTURE.md changes the edge label R11 asks for, and `PREPARE --> STOP` is already in `RELEASE_TRANSITIONS`.
- moving the STOP of R4 to R6 into `reportStep`: `reportStep` writes the step and, for a `succeeded` run proof, the package DONE as on main; the three STOPs are in `next` (acc 4 and 5 report `failed`, then `next` stops).
- accepting any report of a step whose stored status is `failed`: `expectedSteps` returns no step then (acc 5); the window of a concurrent writer is under "Read once" above.
- editing .aidlc state by hand: none; every test uses a `makeFixture` state directory, removed by `cleanup(fx.tmp)` in a `t.after` hook.
- non-goal, the raw `aidlc report --result release-result` patch: that command in src/cli/main.ts is not in the diff.
- non-goal, a `release-result` report to the goal when `release report` delivers a package attempt: the CLI action is unchanged apart from its description.
- non-goal, new manual step names and a retry of a failed verification within the attempt: none added; a failed step is final.
- non-goal, moving the `EVIDENCE_RETAINED` append after the save: it stays before (acc 5 lost-save block).
- non-goal, the narration of the stage and recover directives: unchanged strings.
- non-goal, `.claude/skills/aidlc-loop/release.md`: not in the diff.

Hygiene: no `mkdtempSync` in the new file (directories come from `makeFixture`, removed by `t.after(() => cleanup(fx.tmp))` with `cleanup` of tests/infra/helpers.ts; table below); the CLI runs with `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR` and `GIT_CEILING_DIRECTORIES` removed in any letter case, `GIT_CEILING_DIRECTORIES` set to the fixture's parent (repair item 3) and `AIDLC_STATE_DIR` set to the fixture; no test reads the wall clock or sleeps; no assertion reads an OS error message or a path separator.

Documents pinned by other tests: the 78 test files that name docs/ARCHITECTURE.md, docs/OPERATIONS.md, CHANGELOG.md or release.md (`grep -rlE "ARCHITECTURE\.md|OPERATIONS\.md|CHANGELOG\.md|release\.md" tests --include=*.test.ts`) were run in one `node --test` call after the doc edits: 1867 tests, 1855 pass, 0 fail, 12 skipped, exit 0. After the repair (docs, tests and source changed), the same 78 files in one call: 1867 tests, 1855 pass, 0 fail, 12 skipped, exit 0; no file needed a rerun alone.

DoD: `npm run typecheck && node --test tests/scenarios/release-report-step.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts`, run as the card gives it on the GREEN sources: exit 0; `tsc -p tsconfig.test.json --noEmit` printed nothing; `# tests 37`, `# pass 37`, `# fail 0`, `# cancelled 0`, `# skipped 0` (the 7 tests of the new file are `ok 13` to `ok 19`).

DoD after the repair, run as the card gives it: exit 0; `tsc -p tsconfig.test.json --noEmit` printed nothing; `# tests 38`, `# pass 38`, `# fail 0`, `# cancelled 0`, `# skipped 0` (the 8 tests of the new file are `ok 13` to `ok 20`).

Final verification, after the second repair and the fixture-cleanup change (class `fixture-cleanup-bypasses-helper`), on commit `4d8b739e` (sources, tests and docs; the card commit after it changes only this file):

| Pattern in tests/scenarios/release-report-step.test.ts at `4d8b739e` | Count | Where |
|---|---|---|
| `makeFixture(` | 1 | line 47, in `setup`, the only helper that creates a fixture; `makeFixture` (tests/scenarios/_harness.ts:52) creates the directory with `tmpDir('aidlc-scn-')` of tests/infra/helpers.ts |
| `cleanup(fx.tmp)` | 1 | line 48, `t.after(() => cleanup(fx.tmp))`, registered in `setup` right after the fixture is created; `cleanup` is imported from tests/infra/helpers.ts |
| `setup(t)` | 8 | the first statement of each of the 8 tests |
| `fx.cleanup` | 0 | |
| `mkdtempSync` | 0 | |
| `tmpDir(` | 0 | |
| `rmSync` | 0 | |
| `finally` | 0 | |

The CLI tests write `aidlc.ops.json` inside `fx.tmp` only, so the same hook removes it.

- Doc-pin files: the 79 test files that name docs/ARCHITECTURE.md, docs/OPERATIONS.md, CHANGELOG.md or release.md, in one `node --test` call on `4d8b739e`: 1870 tests, 1857 pass, 1 fail, 12 skipped. The failure is `tests/infra/exec.test.ts` "T0-EXEC-TREE-KILL run on real processes (a node root, a shell, a node sleeper) [R1] [R2] [R3] [R4]", which the brief names as machine load: run alone on the same commit it passes 61 of 61, and this card changes no file it executes. The same 79 files on `1bf9b726` (the docs commit, before the cleanup change to the new test file, which none of the 79 reads) gave 1870 tests, 1858 pass, 0 fail, 12 skipped, exit 0.
- DoD on `4d8b739e`, run exactly as the card gives it: exit 0; `tsc -p tsconfig.test.json --noEmit` printed nothing; `# tests 38`, `# pass 38`, `# fail 0`, `# cancelled 0`, `# skipped 0` (the 8 tests of the new file are `ok 13` to `ok 20`).
- Revert rows touched by the second repair: the 9 R4 and R5 rows and the new ownership row, run with the test file of `1bf9b726`; each fails a test (table above). The cleanup change alters no assertion.

Third repair, after the Codex pre-review of `2be1b6fb` (docs only; no source or test change): each sentence of the three documents now carries its own state and condition. The package stop is stated for PREPARE of an attempt whose target is `package` (a staging attempt in PREPARE carrying a failed `package-run-proof` is not stopped, acc 4). The report-again and `UNKNOWN` sentences hold only while the step is still the one the attempt expects (a ready package attempt whose ops configuration is removed after an `UNKNOWN` report no longer expects the run proof, acc 3). The CLI sentence says only that the command exits 1 with the message: the `aidlc: ` prefix comes from the catch of src/cli/main.ts when that file is run directly, while `bin/aidlc.js` awaits `main` and Node reports the thrown error itself (bin/aidlc.js:14-17). Finality is stated for a step stored as `failed`, since a `failed` report whose save failed leaves the step expected (acc 5).

Each added sentence and what pins it:

| Document, sentence | Pin |
|---|---|
| OPERATIONS: `release report` records a manual step only when the state asks for it, with the three cases | acc 1 (every state and condition), acc 3 (each package prerequisite); R1 |
| OPERATIONS: the name matches exactly, the status is exactly `succeeded`, `failed` or `UNKNOWN` | acc 1 (name variants), acc 2 (statuses); R1, R2 |
| OPERATIONS: any other report is refused before anything is written and the command exits 1; once the attempt exists and any `--goal` names its goal, the message names the attempt, its state and the expected step or none | acc 1, 2, 3, 5 (unchanged attempt and journal, message), acc 3 and 7 (CLI exit 1, message, `--goal` message first), release.test.ts "a release command refuses a --goal that does not own the attempt, and writes nothing"; R3; through `bin/aidlc.js` the exit 1 and message come from Node's report of the rejected `main` (bin/aidlc.js:14-17) |
| OPERATIONS: a step reported `succeeded` or `UNKNOWN` may be reported again while it is still the step the attempt expects | acc 5 (succeeded, succeeded, UNKNOWN, succeeded, failed before `next`), acc 6 (UNKNOWN again after `next`); R1 |
| OPERATIONS: a step stored as `failed` is final, no longer expected, every later report refused | acc 5, including the lost-save block; R1, R3 |
| OPERATIONS and CHANGELOG: after an `UNKNOWN` report the state does not change; once `next` reaches the case it asks for the step again while the stored status is still `UNKNOWN` and the step is still expected | acc 6; R8 |
| OPERATIONS: the three stops apply once `next` reaches the case of the state; reconciliation and ownership checks come first | acc 4b (environment owned by another session: `wait`, attempt unchanged; revert "R4 failed-verification STOP ahead of the reconcile and ownership checks"); R4, R5, R6 |
| OPERATIONS: STAGE, stored failed `stage-verify`, `staging verification failed`, whatever the `stage-deploy` status | acc 4, acc 4b; R4, R7 |
| OPERATIONS: RECOVER, stored failed `recover-verify`, `recovery verification failed`, whatever the `recover` status | acc 4, acc 4b; R5, R7 |
| OPERATIONS: PREPARE of a `package` attempt, stored failed `package-run-proof`, `package install/run proof failed`, before the prerequisites are checked | acc 4 (ops unreadable after the report; zero reads of the ops configuration; a staging attempt carrying the step is not stopped); R6, R7 |
| OPERATIONS: `aidlc release candidate` does not clear that step | acc 5 (CLI `release candidate --digest c2`); R6 |
| ARCHITECTURE: the one sentence (steps and states, statuses, none once stored as `failed`, refusal before any write, the three stops once `next` reaches the case) | as the OPERATIONS rows above; R1 to R6, R11 |
| ARCHITECTURE: edge label `PREPARE --> STOP: ... / failed run proof (release-health)` | acc 4; R6, R11 |
| CHANGELOG: the steps, prerequisites and states (one helper with `next`) | acc 1, acc 3; revert "R1 package needs condition"; R1 |
| CHANGELOG: exact name and status | acc 1, acc 2; R1, R2 |
| CHANGELOG: refusal before any journal event or save, after the unchanged `--goal` refusal; exit 1 with the message | acc 1, 2, 3, 5, 7; release.test.ts `--goal` test; R3 |
| CHANGELOG: an accepted report journals `EVIDENCE_RETAINED` before the save | acc 5 lost-save block; revert "R3 accepted report journals before the save"; R3 |
| CHANGELOG: report again while expected; a step stored as `failed` is final | acc 5, acc 6; R1 |
| CHANGELOG: `UNKNOWN` keeps the state; `next` asks again once it reaches the case while the step is expected | acc 6; R8 |
| CHANGELOG: the three stops with their states and conditions; `release candidate` does not clear the run proof | acc 4, acc 4b, acc 5; R4 to R7 |
| CHANGELOG: what main did (stored any schema status, replaced an operation step, appended `EVIDENCE_RETAINED` then failed validation on another status, delivered a package attempt without candidate or operation, never stopped on a failed verification) | RED receipts of `1d88c7a3` (acc 2 stored `pending`, acc 3 accepted the run proof without the prerequisites, acc 4 asked for the failed proof again, acc 7 stored `stage-deploy`); the card's `diagnosis` (probe case D for the invalid status) |
| CHANGELOG: the help names the three steps and their states | acc 7; R10 |

Final verification on ``f42d78f1`` (the last commit with code, tests or docs; the card commit after it changes only this file):

- Doc-pin files: the 79 test files that name docs/ARCHITECTURE.md, docs/OPERATIONS.md, CHANGELOG.md or release.md, in one `node --test` call: 1870 tests, 1857 pass, 1 fail, 12 skipped. The failure is `tests/infra/exec.test.ts` "T0-EXEC-TREE-KILL run on real processes (a node root, a shell, a node sleeper) [R1] [R2] [R3] [R4]", the machine-load case the brief names: run alone on the same commit it passes 61 of 61, and this card changes no file it executes.
- DoD, run exactly as the card gives it: exit 0; `tsc -p tsconfig.test.json --noEmit` printed nothing; `# tests 38`, `# pass 38`, `# fail 0`, `# cancelled 0`, `# skipped 0` (the 8 tests of the new file are `ok 13` to `ok 20`).
- No source or test file changed after `4d8b739e`, so the revert table above stands.

### After the fourth pre-review of 9a2450e8 (coordinator edit)

A fourth, wording-only Codex pre-review found the source correct, no contradiction between the three documents, and one sentence too wide, in docs/OPERATIONS.md and CHANGELOG.md: "it asks for the step again while that step is still the one the attempt expects". Sequence: STAGE with `stage-deploy` succeeded, report `stage-verify` `UNKNOWN`, then `succeeded`, then `release next`: the step is still expected before `next`, and `next` returns DONE, not another request (RECOVER closes in the same way). The coordinator added the condition "while the stored status of the step is still `UNKNOWN`" to both sentences and to the row of the sentence table above. No source, test or other sentence changes; acceptance 6 pins the request after a stored `UNKNOWN`.

Coordinator verification:
- At 649e103b, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/scenarios/release-report-step.test.ts): tests 8, pass 8, fail 0, skipped 0.
- Windows, docpins: 79 test files reading 3 changed documents: # tests 1870 # pass 1858 # fail 0
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.
