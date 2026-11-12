---
id: T0-HEALTH-OP-SIGNALS
title: A release runner built without a signal source, as aidlc release next builds it, reads the OBSERVE health signals from the last non-blank stdout line of the bound health operation, run once per evaluation; unsuccessful execution receipts and invalid reports produce unavailable signals, never PASS, and runner exceptions propagate without completing the evaluation
status: todo
branch: T0-HEALTH-OP-SIGNALS
worktree: D:\wt\AIDLC\T0-HEALTH-OP-SIGNALS
size_exception: "approved by the coordinator as planner and approver of the audit changes under the owner's (asun28) instructions of 2026-11-11 and 2026-11-12: raised from 600 to 820 after the Codex review of the draft card; about 45 source lines in src/delivery/ops.ts (the report schema, the last-line reader and the mapping) and about 25 in src/loop/release-runner.ts (the default source and its comment), about 520 lines of tests/scenarios/health-op.test.ts (thirteen tests: a failure table of about 45 rows, the parser and mapper rows, recording wrappers for the runner, the lease store, the journal and the store, and one CLI case), about 34 lines of docs (docs/DELIVERY-OPS.md and its template copy 14 each, docs/OPERATIONS.md 4, docs/ARCHITECTURE.md 2), 2 lines of CHANGELOG and about 190 lines of attempt evidence in this card file (the RED receipts, the mutation table of acceptance 3 and the clause table); raised from 820 to 900 by the coordinator on 2026-11-12 with R9 and the rulings after the pre-review of 9e9eecb2: the candidate is 772 changed lines, and the rows the pre-review asked for (the padded report, name case and padding apart, the direct schema rejections, the controlled target variable), the backward scan, R9 with its row and two document sentences in three files add about 90; raised from 900 to 950 by the coordinator on 2026-11-12 after the second pre-review: the candidate 431236a1 is 864 changed lines, and R9 as restated (two evaluations, a breach at the step's time stands), its three rows and the corrected sentences add about 60; raised from 950 to 990 by the coordinator on 2026-11-12: the candidate 19288418 is 929 changed lines with the planner's rulings on the disclosed deviations, and the severity selection of the third pre-review with its two rows, their evidence and the coordinator's verification block add about 45"
allow_paths:
  - src/delivery/ops.ts
  - src/loop/release-runner.ts
  - tests/scenarios/health-op.test.ts
  - docs/DELIVERY-OPS.md
  - templates/docs/DELIVERY-OPS.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-HEALTH-OP-SIGNALS.md
dod_command: npm run typecheck && node --test tests/scenarios/health-op.test.ts tests/infra/ops.test.ts tests/core/health.test.ts tests/scenarios/release.test.ts tests/scenarios/release-reissue.test.ts tests/scenarios/release-lease.test.ts tests/scenarios/release-report-step.test.ts tests/scenarios/checkpoint-packet.test.ts tests/scenarios/ops-cwd.test.ts tests/scenarios/journal-lock-refusal.test.ts tests/scenarios/op-clock.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `ReleaseRunnerDeps.signals` is absent, the runner's signal source (src/loop/release-runner.ts:106 on main at e2ca57fd, `() => []`) shall be a default that, at the one call of the source in an OBSERVE evaluation (:399, in `step`, which `next` runs before its lease exit, :159-161, an exit that returns a result neither DONE nor STOP unchanged, :215-217; the call is reached only after the reconciliation and unknown-outcome checks of `step`, :289-311, so an unresolved record of the attempt returns its wait with no health call), runs the first `health` binding (`binding('health')`, :117-119; a second binding of that role never runs) at most once through `executeOperation(binding, attempt.environment, { root: this.repo.mainRoot, runner: this.runner })` (src/delivery/ops.ts:150-167): no idempotency key, also for a binding with `idempotencyKeyArg`, and the binding's `timeoutMs` with `killTree: true` (:158). It runs exactly when all of these hold, all checked before dispatch: the ops load is `configured` and its `health` list (:80-93) is not empty; a `health` binding exists; the attempt's `environment` is present and not empty; `isDirectory(operationCwd(binding, this.repo.mainRoot))` (:52-58) is true, which it is not for a directory that is missing, is a file, or cannot be checked as a directory. An absent or empty `candidateDigest` does not prevent dispatch; R2 then rejects the report. An ops load that is `not-configured` or `unreadable`, or an empty `health` list, gives `[]` with no command, as main gives for every attempt; such an attempt evaluates INSUFFICIENT_DATA on every call, and the first `next` that reaches OBSERVE at or after the end of the window plus the maximum wait (with no declared signal the maximum wait is 30 minutes and a newly constructed fallback window is 10 minutes, :390, :398, :632-640) saves STOP/release-health (:412), which this card does not change.
  - R2. The default shall read a report only from an execution whose `status` is `succeeded` (ops.ts:161-166; its patterns are matched on stdout and stderr together, :159) and only from `receipt.stdout`: the text split at `\n`, the last line whose `trim()` is not empty, trimmed, then `JSON.parse` (a throw reads as no report), then a new exported zod schema `HealthReport` of src/delivery/ops.ts with `environment` and `candidate` strings of at least 1 character and `signals` an array of `{ name: string, empty allowed; samples: a safe integer, 0 or more (zod 4 `.int()`); observed: optional finite number (zod 4 refuses NaN and infinite values); lastSampleAt: optional `IsoTimestamp` (src/core/types.ts:18-20) that `Date.parse` reads as a number }`, unknown keys stripped at both levels. A failed parse reads as no report, a malformed entry with an undeclared name included. A parsed report is accepted only when `this.leases.file(resourceKeys.environment(report.environment))` equals the same of `attempt.environment` (one lease file, src/coordination/lease.ts:49-51, :183, and `shortKey`, src/state/paths.ts:169-172: names that differ only in letter case or in `\` against `/` are one environment, the rule R12 of T0-STAGING-LEASE-RELEASE-2 applies to a record's target) and `report.candidate` equals `attempt.candidateDigest` as an exact, case-sensitive string with no trimming (an absent or empty digest accepts no report).
  - R3. Each entry of `health` shall become one `HealthSignal`, in declaration order whatever the report's order, through a new exported `healthSignals(declared, report)` of src/delivery/ops.ts that builds typed objects without parsing them through the `HealthSignal` schema (whose `name` and `source` need a character, src/core/types.ts:1131-1132), so every declaration string is kept verbatim, an empty one included: `name`, `source`, `threshold`, `minSamples` and `maxStalenessMs` from the entry, `synthetic` false; WHEN a report was accepted and exactly one of its entries has a `name` equal to the entry's as the same string (a re-cased or padded name does not match), `observed`, `samples` and `lastSampleAt` from that one and `probeAvailable` true; otherwise `samples` 0, no `observed`, no `lastSampleAt`, `probeAvailable` false (`evaluateSignal` reads it as INSUFFICIENT_DATA, src/core/health.ts:45). Schema-valid entries with undeclared names are ignored; no field of the report other than those named here is read (a source, threshold, minimum or staleness in the output changes nothing); two declarations of one name each read that one entry with their own threshold, minimum and staleness.
  - R4. Unsuccessful execution receipts and invalid reports shall produce unavailable signals, INSUFFICIENT_DATA and never PASS, for every declared signal in each class: no `health` binding; an attempt `environment` absent or empty; `isDirectory` false; an execution that is `failed` (a failure pattern, or an exit other than 0, `null` included, of a binding that is not `async`), `UNKNOWN` (a timeout, a success pattern not seen, or an exit other than 0 of an `async` binding) or `issued` (an `async` binding that exits 0); a stdout with no line that is not blank; a last such line that is not JSON, a JSON value that is not an object, or an object that fails `HealthReport`; an `environment` of another lease file; a `candidate` other than the attempt's digest. One signal shall be unavailable when an accepted report does not name it or names it twice. The attempt's result follows `evaluateHealth` unchanged (src/core/health.ts:65-72): INSUFFICIENT_DATA, or BREACH when another signal breaches. Runner exceptions shall propagate without completing the evaluation: a throw of the runner leaves `next` before this evaluation's `HEALTH_EVALUATED` append and subsequent save; earlier reconciliation and transition writes of the same call remain (:290-306, :389-392).
  - R5. Running the health command shall record no operation-ledger record (no `this.ops.` call is added to src/loop/release-runner.ts, so the scan of acceptance 2 of T0-OP-TIMESTAMP-NOW-2 finds the same calls), call no `LeaseStore` method that takes a section, claims, renews, releases, fences or purges (`update`, `claim`, `takeover`, `heartbeat`, `release`, `fence`, `purgeReleased`; `file` only computes a path), and append no journal event. The evaluation's `HEALTH_EVALUATED` (:401, data unchanged) and the attempt's save (:406-413) are as on main; a failure of that append or of that save propagates as on main, the health run leaves no record, and the next call runs the command again.
  - R6. WHEN `ReleaseRunnerDeps.signals` is given, it shall stay the only source, as on main, and no health command shall run. Every test that drives OBSERVE injects a source (release.test.ts:202, :260, :284, :304, :326, :353; release-reissue.test.ts:45; checkpoint-packet.test.ts:28; release-report-step.test.ts:62; ops-cwd.test.ts:45; journal-lock-refusal.test.ts:167; release-lease.test.ts:41), and the runners built without one never reach OBSERVE (release.test.ts:40, :70, :109, :136, :428; release-publication.test.ts:28; checkpoint-packet.test.ts:108, :166, which read the checkpoint packet only); each passes unchanged.
  - R7. These shall not change: `evaluateSignal`, `evaluateHealth` and `windowElapsed` (src/core/health.ts), `nextAfterObserve` and the release transitions (src/core/release-machine.ts), the window and maximum wait (:632-640), the OBSERVE narrations and STOP (:406, :412), `HealthSignal` and `DeliveryOpsConfig`, src/cli/main.ts (it still builds the runner without a source, :1119) and src/loop/controller.ts (its runner reads the checkpoint packet only, :451).
  - R8. The documents shall carry the text of section Exact text: docs/DELIVERY-OPS.md and templates/docs/DELIVERY-OPS.md, which stay identical (line endings aside, tests/infra/ops.test.ts:232-236), gain Q1 in the opening paragraph (:3-7), Q2 in Asynchronous operations (:46-51), Q3 in Tags and publication (:53-57), and H1, the example report and H2 in Health (:65-70); docs/OPERATIONS.md gains Q4 at the end of the Rules paragraph (:286), paragraph O after the paragraph that begins `A BREACH routes to RECOVER` (:165) and `"timeoutMs": 120000` on its example `health` binding (:276); docs/ARCHITECTURE.md gains sentence A at the end of the paragraph that begins `` `finalStateForTarget` fixes `` (:130); the comment on `signals` (release-runner.ts:35) is the one of Exact text; CHANGELOG.md, Unreleased, gains entry C.
  - R9. (added 2026-11-12 after the pre-review of 9e9eecb2 and restated after that of 431236a1, body sections Planner rulings) In OBSERVE the signals shall be evaluated twice with the unchanged `evaluateHealth`: once with the step's `now` and once with the runner clock read directly after the signal source returned (`this.clock()` after `this.signals(attempt)`). The result used is the more severe of the two, BREACH over INSUFFICIENT_DATA over PASS, and the second when they are equally severe (ruling after the third pre-review; the first wording took the first evaluation only when it was BREACH, which let a clock that went backward during the command give PASS). So a PASS needs both evaluations to pass: every sample inside its staleness bound when the evaluation began and when the health command has returned, whichever way the clock moved between them; a breach whose sample was inside its bound at either time routes to RECOVER; and with a clock that does not move during the source, every existing test included, the two evaluations are equal. What keeps the step's `now`, as on main: the fallback window, `windowElapsed`, the maximum-wait check, the `CLOSE` transition and the `at` of the STOP for insufficient data. What does not, also as on main and unchanged by this card: the journal writes the timestamp of `HEALTH_EVALUATED` itself, the store writes `updatedAt` itself, and `recoverOrStop` reads the runner clock itself. `evaluateHealth` and `evaluateSignal` are unchanged (R7).
acceptance:
  - 1. `tests/scenarios/health-op.test.ts` "a runner built without signals closes on a health PASS over the elapsed window": PASS while the window is open, CLOSE after it, DONE delivered. Fails on main. [R1] [R2] [R3] [dod arm 1] Detail: body section Acceptance detail, item 1.
  - 2. Same file, "a health BREACH read from the bound command goes to RECOVER, or stops without recovery authority". Fails on main. [R3] [dod arm 1] Detail: body section Acceptance detail, item 2.
  - 3. Same file, "unsuccessful execution receipts and invalid reports produce unavailable signals, never PASS": one row per class of R1 and R4; control rows give PASS. Fails on main, which journals no signal. [R1] [R2] [R4] [dod arm 1] Detail: body section Acceptance detail, item 3.
  - 4. Same file, "the report names the attempt's environment by its lease and its candidate exactly", with one dispatch for an absent or empty digest. Fails on main. [R1] [R2] [R4] [dod arm 1] Detail: body section Acceptance detail, item 4.
  - 5. Same file, "a signal the report does not name, or names twice, is INSUFFICIENT_DATA; an undeclared one is ignored". Fails on main. [R3] [R4] [dod arm 1] Detail: body section Acceptance detail, item 5.
  - 6. Same file, "aidlc.ops.json, not the command, gives each signal its source, threshold, minimum samples and staleness": parser and mapper rows through an `ops` namespace. Fails on main inside its own body. [R2] [R3] [dod arm 1] Detail: body section Acceptance detail, item 6.
  - 7. Same file, "the health command runs once per call with the attempt's environment, and touches no operation, lease or other event": counted runner, lease and ledger effects. Fails on main. [R1] [R5] [dod arm 1] Detail: body section Acceptance detail, item 7.
  - 8. Same file, "reconciliation comes before the health command": an unresolved record waits with no health call; a lookup runs before it. Fails on main. [R1] [dod arm 1] Detail: body section Acceptance detail, item 8.
  - 9. Same file, "a runner, journal or save failure leaves the evaluation incomplete and the next call runs the command again". Fails on main. [R4] [R5] [dod arm 1] Detail: body section Acceptance detail, item 9.
  - 10. Same file, "an injected signals source runs no health command". Passes on main and with this card. [R6] [dod arm 1] Detail: body section Acceptance detail, item 10.
  - 11. Same file, "aidlc release next closes an observed attempt from the bound health command": a CLI child saves CLOSE from a real health process. Fails on main. [R1] [R2] [dod arm 1] Detail: body section Acceptance detail, item 11.
  - 12. The other files of `dod_command` pass unchanged; this passes once T0-OP-TIMESTAMP-NOW-2 has merged (T0-STAGING-LEASE-RELEASE-2 merged as PR 282). [R6] [R7] [dod arm 1] Detail: body section Acceptance detail, item 12.
  - 13. The documents and the comment carry the text of R8 (reviewer-verified against the diff); tests/infra/ops.test.ts "the template copy of DELIVERY-OPS.md is the repository's" passes. [R8] Detail: body section Acceptance detail, item 13.
  - 14. tests/scenarios/health-op.test.ts "the staleness of a sample is judged when the health command has returned": a scripted health command during which the fixture clock advances past the staleness bound of a sample that was inside it at the start gives INSUFFICIENT_DATA (PASS at the candidate 9e9eecb2), and one during which it advances less than the bound gives PASS; a breaching sample inside its bound at the start and past it at the return gives BREACH and RECOVER; a PASS whose command starts before the end of the window and returns after it stays in OBSERVE, and insufficient data whose command starts before the end of the maximum wait and returns after it stays in OBSERVE; a passing sample 301 s old at the start with a bound of 300 s and a clock that goes back 2 s during the command gives INSUFFICIENT_DATA; plus the rows of the rulings (a report line padded with a byte order mark and with no-break spaces is read; a name that differs only in case, and one that differs only in padding, each alone, is unavailable, and a single entry ` A ` for a declared `A` is unavailable; `HealthReport` refuses an empty `environment` and an empty `candidate`; an output of many blank lines before the report is read). [R2] [R3] [R9] [dod arm 1] Detail: body section Planner rulings.
depends_on: [T0-STAGING-LEASE-RELEASE-2, T0-OP-TIMESTAMP-NOW-2]
budget: 990
tdd: true
diagnosis:
  root_cause: "The signal source of `ReleaseRunner` defaults to `() => []` (src/loop/release-runner.ts:106 on main at e2ca57fd), although the comment on the option says it reads bound health operations (:35), and `aidlc release next` builds the runner without a source (src/cli/main.ts:1119). `evaluateHealth([])` is INSUFFICIENT_DATA (src/core/health.ts:65-67), so OBSERVE answers `observe` (:406) until the window plus the maximum wait and then saves STOP/release-health with disposition `failed` (:412): a production attempt deployed from the CLI reaches neither CLOSE nor RECOVER. No code runs the `health` role that `REQUIRED_ROLES` requires for staging and production (src/delivery/ops.ts:113-114)."
  repro: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-drafts-8\\probe-health.mts on main at c2634574 (ops.ts and health.ts are unchanged at e2ca57fd, and T0-STAGING-LEASE-RELEASE-2 moved the OBSERVE case of release-runner.ts into `step` without changing it): a runner built without `signals`, an attempt in OBSERVE (production, candidate c1, window T0 to T0+10 min), a bound `health` command that prints a valid report and one declared signal: call 1 at 2026-09-11T00:00:00.000Z `observe` INSUFFICIENT_DATA with 0 health calls; call 2 at 00:11 `observe` INSUFFICIENT_DATA; call 3 at 00:41 `stop` STOP release-health `insufficient health data within the maximum wait`, disposition failed; HEALTH_EVALUATED three times with signals []; the runner was never called."
  same_class: "Other required roles no code runs: `status` and `environment` (staging and production, ops.ts:113-114; `status` is only the lookup binding of unresolved operations of other kinds, release-runner.ts:292), `build` and `package` (the package target asks for a manual run proof), and the migration roles: out of scope. The other defaults of `ReleaseRunnerDeps` (store, ledger, leases, runner, ops load, clock, :100-105) are the real implementations. `GoalController` builds a runner without a source too (controller.ts:451) and reads only the checkpoint packet from it."
sweep: "On main at e2ca57fd: git grep -n \"'health'\\|config.health\\|this.signals\\|signals?\\|HealthSignal\" -- src finds release-runner.ts:35-36 and :95 (the option, its comment and field: comment changed by R8), :106 (the default: R1), :399 (the one call: unchanged), :633 and :638 (window and maximum wait: unchanged), ops.ts:17 and :113-114 (the role: unchanged), core/health.ts (unchanged, R7), types.ts:763 (the `health` evidence kind, not read here) and :1130-1142 (`HealthSignal`, unchanged). git grep -n \"binding('\" -- src: :131 and :450 (`recover`) only. git grep -n \"new ReleaseRunner\" -- src tests: main.ts:1119 and controller.ts:451 (no source: R1 applies; controller reads the packet only) and the test constructions of R6. git grep -n \"OBSERVE\\|HEALTH_EVALUATED\\|healthResult\" -- tests: release.test.ts, release-reissue.test.ts:362, checkpoint-packet.test.ts:96 and :244, release-report-step.test.ts:146 (stored states), release-machine.test.ts and journal-event-types.test.ts: none runs OBSERVE without a source. git grep -n \"Nothing in this file deploys\\|Exactly-once requires\\|Mark such bindings\\|puts the operation behind production authority\" -- tests: none (Q1 to Q4 qualify unpinned sentences). git grep -n \"DELIVERY-OPS\" -- tests: ops.test.ts:232-255 (template equality and the `cwd` clauses of DELIVERY-OPS and of the OPERATIONS Rules paragraph: Q4 is appended after them, so they pass) and init.test.ts (the file is installed). git grep -n \"scripts/health.sh\\|observe (health window)\\|reading bound health\\|Insufficient telemetry\" -- docs README.md templates .claude tests src: docs/OPERATIONS.md:156 and :276, release-runner.ts:35 and :406; no test pins them."
forbid:
  - weakening or skipping a test to go green
  - a change to src/core/health.ts, src/core/release-machine.ts, src/core/types.ts, src/cli/main.ts or src/loop/controller.ts
  - reading a threshold, source, minimum samples or staleness from the command's output, or parsing signals through the `HealthSignal` schema
  - reading observations from an execution that is not `succeeded`, from stderr, from a line other than the last non-blank stdout line, or from a report whose environment or candidate is not the attempt's
  - recording the health execution in the operation ledger, calling a lease method other than `file` for it, or appending a journal event for it
  - catching a runner exception, or a new STOP, wait or directive kind, or a change to the window, the maximum wait or the OBSERVE narrations
  - running the health command when `signals` is injected
  - a named import of the new ops exports in the test (they are read through a namespace inside the test bodies)
  - a new `mkdtempSync`, a removal of a temporary directory in `finally`, `fx.cleanup()` or a direct `rmSync` of a temporary directory in the new test; fixtures come from `makeFixture` and are removed with `cleanup` of tests/infra/helpers.ts in a `t.after` hook
  - editing .aidlc state by hand
non_goals:
  - an attempt whose `health` list is empty, which still stops with STOP/release-health after the window and the maximum wait
  - running the `health` operation in STAGE, where `stage-verify` stays a manual report
  - a `lastSampleAt` later than the evaluation time, which `evaluateSignal` reads as fresh for every source
  - a reason for an unavailable probe in the narration or in `HEALTH_EVALUATED`
  - two `release next` calls on one attempt at once (each runs the command; the last save wins)
  - refusing a health binding for its `triggersPublication`, `effects` or `externallyVisible`
  - an observation window or interval in the report
  - .claude/skills/aidlc-loop/release.md and .claude/agents/release-specialist.md
hygiene: "T0-STAGING-LEASE-RELEASE-2 merged as PR 282 (main e2ca57fd): `next` runs `step` and then one lease exit for terminal attempts (:159-161, :215-217), the OBSERVE case is in `step`, and its terminal results, the STOP of :412 and a STOP of `recoverOrStop` after a BREACH, pass that exit as every terminal return does. This card merges after T0-OP-TIMESTAMP-NOW-2, which passes the injected clock to every ledger call of src/loop and changes src/loop/release-runner.ts. Line numbers are from main at e2ca57fd; read every reference again by its content at PREPARE and do not renumber the card. This card adds no `this.ops.` call, so tests/scenarios/op-clock.test.ts counts the same calls; if the design changes so that it adds one, that call passes the injected clock. Insert the CHANGELOG entry directly above the entry that begins `- T0-ASK-RECLASSIFY`, followed by a blank line, not at the top of Unreleased (T0-DOCTOR-INTERRUPTED-WRITES has merged, so the entry lands below that card's entry; no test pins the adjacency of either). Before the first review the coordinator runs every test file that reads a document this card changes (docs/DELIVERY-OPS.md and its template copy, docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md; for example tests/infra/init.test.ts, tests/surface/templates.test.ts, tests/surface/module-map.test.ts, tests/core/journal-event-types.test.ts, tests/scenarios/op-intent-dup.test.ts and tests/scenarios/fault-points.test.ts) and records the counts in the Attempt evidence; the full suite runs in CI. The test imports the new exports of src/delivery/ops.ts through a namespace (`import * as ops from '../../src/delivery/ops.ts'`) and reads them inside the test bodies, so on main only acceptance 6 fails on a missing function and every default-runner and CLI case reaches its behavioural assertion. Before the first R3, apply each mutation of the clause table in a scratch copy and run the tests of its requirement, and record in the Attempt evidence the mutation and the assertion that failed; a guard whose removal no row detects (because another guard rejects the same input first) is listed with that reason, not claimed (lesson 2026-11-11 T0-AUDIT-FIXES). Run the new test file on Linux as well as Windows (lesson T0-DIRTY-SUCCESS-2). The CLI test of acceptance 11 runs `node src/cli/main.ts` through `process.execPath` with its own environment: every variable whose upper-cased name starts with `GIT_` removed, `NODE_OPTIONS` removed, `GIT_CEILING_DIRECTORIES` set to the parents of the fixture directory and of its `realpathSync.native` form joined with `path.delimiter`, `AIDLC_STATE_DIR` set to the fixture's state directory and `AIDLC_SESSION` set to a fixed value; the CLI runs on the wall clock, so its health child prints its own current time as `lastSampleAt` and the stored window lies in 2026-09, which keeps the result independent of the run date. The test file name avoids the word pairs the hook refuses on one command line. Neither changed source file is in the verify-card-run-writes coverage record. Implementer: Opus 5.5 at high effort."
doc_sync: docs/DELIVERY-OPS.md (opening paragraph, Asynchronous operations, Tags and publication, Health) and its template copy templates/docs/DELIVERY-OPS.md, docs/OPERATIONS.md (Standalone release, paragraph O; Provider operation bindings, the example health binding and the Rules paragraph), docs/ARCHITECTURE.md (release state machine paragraph, sentence A), CHANGELOG.md
---

# T0-HEALTH-OP-SIGNALS

## Deliverable
`aidlc release next` in OBSERVE runs the first bound `health` operation once per evaluation, when `aidlc.ops.json` declares at least one health signal, and reads the observations from the last non-blank stdout line; thresholds, minimum samples and staleness stay those of `aidlc.ops.json`. Unsuccessful execution receipts and invalid reports, and a report for another environment or candidate, produce unavailable signals, INSUFFICIENT_DATA and never PASS; runner exceptions propagate without completing the evaluation. The health dispatch checks neither publication or effect flags nor authority, records no operation and performs no asynchronous reconciliation, and the documents that promise those for every operation say so. A caller that injects `signals` keeps its source.

## Why
Audit item F6, analysed by two consultants and ruled by the coordinator on 2026-11-12; draft reviewed by Codex and amended to the coordinator's rulings. The CLI builds `ReleaseRunner` with no signal source and the default source is empty, so every OBSERVE evaluation of an attempt run from the CLI is INSUFFICIENT_DATA: a production attempt, once deployed, stops as failed after the window plus the maximum wait and reaches neither CLOSE nor RECOVER. The `health` role the delivery configuration already requires is the source the option's comment announces.

## Design
- src/delivery/ops.ts: `HealthReport` (R2), `healthReportOf(stdout)` (the last non-blank stdout line, `JSON.parse` in a `try`, `HealthReport.safeParse`; `undefined` for every failure) and `healthSignals(declared, report)` (R3), all exported, so src/index.ts:39 exports them too.
- src/loop/release-runner.ts: `this.signals = deps.signals ?? ((attempt) => this.observedSignals(attempt))`, where the private `observedSignals` checks the conditions of R1 before dispatch, runs `executeOperation` once, keeps the report only for a `succeeded` execution with an accepted environment and candidate (R2), and returns `healthSignals(declared, report)`. It catches nothing.

## Exact text

Q1, docs/DELIVERY-OPS.md and its template copy, appended to the opening paragraph after `CD is downstream opt-in.`, wrapped as that paragraph is wrapped:

```text
The `health` operation that `aidlc release next` runs in OBSERVE is the exception: health dispatch checks neither publication or effect flags nor authority, records no operation and performs no asynchronous reconciliation (see Health).
```

Q2, the same two files, appended to the paragraph of Asynchronous operations: exit zero is not done, wrapped the same way:

```text
This applies to the operations `release next` issues; health dispatch performs no asynchronous reconciliation, and an `async: true` health binding gives unavailable signals (see Health).
```

Q3, the same two files, appended to the paragraph of Tags and publication, wrapped the same way:

```text
Health dispatch checks neither publication or effect flags nor authority: bind a read-only, repeatable synchronous probe as `health`, never a command with such an effect.
```

H1, the same two files, section Health, a paragraph after its present one:

```text
For `aidlc release next` the declared signals come from the bound `health` operation (card T0-HEALTH-OP-SIGNALS). Once `release next` reaches OBSERVE (the reconciliation of unresolved operations comes first), and when this file declares at least one signal under `health`, binds the `health` role and the attempt names its environment, it checks that the first `health` binding's directory is an existing directory and then runs that binding once per call, in that directory, with the attempt's environment as its target by `targetSelection`, under the binding's timeout and patterns and with no idempotency key. Health dispatch checks neither publication or effect flags nor authority, records no operation, takes no lease, appends no journal event and performs no asynchronous reconciliation; the evaluation journals `HEALTH_EVALUATED` as before. Bind a read-only, repeatable synchronous probe. The last non-blank line of the command's standard output must be one JSON object:
```

The example report, a fenced `json` block after H1:

```json
{"environment":"production","candidate":"<candidate digest>","signals":[{"name":"http_5xx_rate","observed":0.004,"samples":42,"lastSampleAt":"2026-09-11T00:09:30.000Z"}]}
```

H2, the same two files, after the example:

```text
`environment` names the attempt's environment, letter case and `\` against `/` aside, as its lease does; `candidate` is the attempt's candidate digest, exactly. Each entry of `signals` gives a signal's `name` and `samples` (a safe integer, 0 or more) and, when there is data, `observed` (a finite number) and `lastSampleAt` (a UTC timestamp in the form above that names a real time). The source, threshold, minimum samples and staleness of a signal come from `health` here, never from the output; a declared signal reads the one entry whose `name` is exactly its own, and other keys are dropped. Only schema-valid entries with undeclared names are ignored; any malformed entry invalidates the report. Unsuccessful execution receipts and invalid reports produce unavailable signals, which are INSUFFICIENT_DATA and never PASS: every declared signal is unavailable when the operation is not bound, the attempt names no environment, the binding's directory is missing, is a file, or cannot be checked as a directory, the command does not succeed (a failure pattern or an exit other than 0, a timeout, a success pattern not seen, or `async: true`, whose exit zero only means issued; the patterns read standard output and standard error), or the last non-blank stdout line is not such an object or names another environment or candidate; one signal is unavailable when that line does not name it or names it twice. Runner exceptions propagate without completing the evaluation. Set a `timeoutMs` of a few minutes on the binding: `release next` waits for the command, and the default timeout is 30 minutes. A sample counts toward PASS only while it is inside its staleness bound at the time the command returned; a breach found with the time at which the evaluation began still counts. With no declared signals, `release next` runs no health command and OBSERVE stays INSUFFICIENT_DATA; the maximum wait is then 30 minutes and a newly constructed fallback window is 10 minutes, and the first `release next` that reaches OBSERVE at or after the end of the window plus the maximum wait stops the attempt with STOP/release-health.
```

`release next` in H1 and H2 stands for the command; a library caller that passes `signals` to `ReleaseRunner` keeps its source (R6), which H1 and H2 do not describe.

Q4, docs/OPERATIONS.md, Provider operation bindings, appended to the Rules paragraph after its last sentence (`A status lookup whose directory does not exist fails to start and reads as UNKNOWN.`):

```text
The `health` operation that `release next` runs in OBSERVE is outside the publication and asynchronous rules above: health dispatch checks neither publication or effect flags nor authority, records no operation and performs no asynchronous reconciliation, so bind a read-only, repeatable synchronous probe (docs/DELIVERY-OPS.md, Health).
```

Paragraph O, docs/OPERATIONS.md, Standalone release, its own paragraph after the paragraph that begins `A BREACH routes to RECOVER`:

```text
OBSERVE reads its health from the bound `health` operation (card T0-HEALTH-OP-SIGNALS): once `release next` reaches OBSERVE, and when `aidlc.ops.json` declares a `health` signal and binds the role, the attempt names its environment and the binding's directory is an existing directory, each call runs that operation once and reads the last non-blank stdout line, as docs/DELIVERY-OPS.md (Health) states. PASS after the window has elapsed moves the attempt to CLOSE, BREACH is handled as above, and INSUFFICIENT_DATA, which unsuccessful execution receipts and invalid reports produce, keeps the attempt in OBSERVE until the first call at or after the end of the window plus the maximum wait, which stops it with STOP/release-health. Runner exceptions propagate without completing the evaluation.
```

The example binding, docs/OPERATIONS.md, Provider operation bindings, the `health` line in place of the present one:

```text
    { "role": "health", "command": ["./scripts/health.sh"], "targetSelection": "arg", "targetArg": "--env", "timeoutMs": 120000, "externallyVisible": false },
```

Sentence A, docs/ARCHITECTURE.md, appended to the paragraph that begins `` `finalStateForTarget` fixes `` after its last sentence, separated by one space:

```text
In OBSERVE a runner built without `signals`, as `aidlc release next` builds it, runs the first bound `health` operation once per evaluation when `aidlc.ops.json` declares a `health` signal and binds the role, the attempt names its environment and the binding's directory is an existing directory, with no ledger record, no lease and no publication, effect or authority check, and maps each declared signal to one `HealthSignal` whose observation comes from the last non-blank stdout line of a succeeded run that names the attempt's environment (by its lease file) and candidate; unsuccessful execution receipts and invalid reports produce unavailable signals, and runner exceptions propagate without completing the evaluation (card T0-HEALTH-OP-SIGNALS).
```

The comment on `signals` (release-runner.ts:33), in place of the present one:

```text
  /** Health signal source. Without one, OBSERVE runs the first bound `health` operation once per evaluation and reads its last non-blank stdout line (`healthReportOf`, `healthSignals`); unsuccessful execution receipts and invalid reports produce unavailable signals, and runner exceptions propagate. */
```

Entry C, CHANGELOG.md, Unreleased, one line directly above the entry that begins `- T0-ASK-RECLASSIFY`:

```text
- T0-HEALTH-OP-SIGNALS (bugfix, audit item F6): `aidlc release next` in OBSERVE now reads the declared health signals from the bound `health` operation. Before, the runner the CLI builds had no signal source, so every OBSERVE evaluation of an attempt run from the CLI was INSUFFICIENT_DATA and the first `release next` that reached OBSERVE at or after the end of the window plus the maximum wait stopped a deployed production attempt with STOP/release-health, never CLOSE or RECOVER. When `aidlc.ops.json` declares a `health` signal and binds the role, the attempt names its environment and the binding's directory is an existing directory, each OBSERVE evaluation runs the first `health` binding once through the execution every bound operation uses (its directory, target selection, timeout and patterns, no idempotency key) and reads the last non-blank stdout line as `{ environment, candidate, signals: [{ name, observed, samples, lastSampleAt }] }`; source, threshold, minimum samples and staleness stay those of `aidlc.ops.json`. Unsuccessful execution receipts and invalid reports, an environment or candidate other than the attempt's, and a signal the line does not name or names twice produce unavailable signals, never PASS; runner exceptions propagate without completing the evaluation. A sample counts toward PASS only while it is inside its staleness bound at the clock read after the command returned, so a slow command cannot have an old sample accepted, and a breach found with the time at which the evaluation began still counts. Health dispatch checks neither publication or effect flags nor authority, records no operation, takes no lease and performs no asynchronous reconciliation; docs/DELIVERY-OPS.md and docs/OPERATIONS.md say so where they describe those rules. The library exports `HealthReport`, `healthReportOf` and `healthSignals`; a caller that passes `signals` to `ReleaseRunner` keeps that source and no health command runs.
```

## Unchanged text
- docs/OPERATIONS.md:156, `aidlc release next <attemptId>              # apply -> observe (health window) -> close -> done`: true as worded once a declared signal passes; before this card it could not be reached from the CLI.
- docs/OPERATIONS.md:617, the `release-health` row (`insufficient telemetry past max wait`): true.
- docs/DELIVERY-OPS.md:18, `health | smoke/health signals bound to environment + candidate | staging, production`: true; the report binds both.
- The OBSERVE narration `Insufficient telemetry: gather allowed evidence within the bound; missing data never becomes PASS.` (:406): true; the next `release next` runs the command again. Not changed (R7).
- .claude/skills/aidlc-loop/release.md (OBSERVE: evaluate the declared signals; missing telemetry never PASS) and .claude/agents/release-specialist.md (report health exactly as evaluated): true; not changed.
- README.md:160 names `health` among the core modules: true.
- CHANGELOG entries under Unreleased: none states the empty default (`git grep -n -i "insufficient\|signals" -- CHANGELOG.md` before `## 0.1.0`).

## Acceptance detail
Each subsection is the full text of the acceptance item of the same number. Fixture of items 1 to 10, one per test unless a row says otherwise: `makeFixture()` of tests/scenarios/_harness.ts, removed by `t.after(() => cleanup(fx.tmp))` with `cleanup` of tests/infra/helpers.ts; card T1-HELLO written with `writeCard`; `goalForCards(fx, ['T1-HELLO'], { target: 'production' })`. Ops load `healthOps(change?)`: `DeliveryOpsConfig.parse` of the environments `staging` (not production) and `production` (production), the bindings `deploy`, `status` and `environment` of `opsConfigured()` (tests/scenarios/_harness.ts:189-202; of `opsConfigured({ asyncDeploy: true })` where a row says so), `{ role: 'health', command: ['health-cmd'], targetSelection: 'arg', targetArg: '--env', timeoutMs: 60000 }` and `{ role: 'recover', command: ['recover-cmd'], targetSelection: 'arg', successPattern: 'ok' }`, and `health` `[{ name: 'http_5xx_rate', source: 'prometheus', threshold: { op: '<', value: 1 }, minSamples: 5 }, { name: 'p95_latency_ms', source: 'prometheus', threshold: { op: '<=', value: 800 }, minSamples: 5 }]` (window 10 minutes, maximum wait 30 minutes, staleness 5 minutes by the schema defaults), with `change` applied to the health binding or the list. Runner: a `SyncRunner` that records each call (command, args, `options.cwd`, `options.env?.AIDLC_TARGET_ENV`, `options.timeoutMs`, `options.killTree`) and answers `health-cmd` with the row's receipt and every other command with `opsRunner`. The row's receipt is built inside each call of the runner, so `fx.now()` is read at that call. Attempt: stored in OBSERVE as tests/scenarios/release.test.ts:230-248 stores one (environment `production`, candidate `c1`, window T0 to T0 plus 10 minutes), with a new id per row. Base report, built at each call: stdout `probe start\n` followed by `JSON.stringify({ environment: 'production', candidate: 'c1', signals: [{ name: 'http_5xx_rate', observed: 0.1, samples: 20, lastSampleAt: fx.now() }, { name: 'p95_latency_ms', observed: 300, samples: 20, lastSampleAt: fx.now() }] })` and `\n`, exit 0. The release runner is `new ReleaseRunner({ paths, repo, store, ops, leases, runner, opsLoad, now: fx.now })`, with no `signals`. "Signals of a row" are the `signals` of the `HEALTH_EVALUATED` events of the row's attempt; "both unavailable" means `['http_5xx_rate=INSUFFICIENT_DATA', 'p95_latency_ms=INSUFFICIENT_DATA']` with `healthResult` INSUFFICIENT_DATA and the directive `observe`. Main journals `signals: []` for every OBSERVE evaluation without a source, so every assertion on the signals of a row fails on main.

### 1
`tests/scenarios/health-op.test.ts` "a runner built without signals closes on a health PASS over the elapsed window" passes and fails on main. With the base report: `next` at T0 returns `observe`, the attempt stays OBSERVE with `healthResult` PASS, and the signals are `['http_5xx_rate=PASS', 'p95_latency_ms=PASS']`; after `fx.advance(11 * MINUTE_MS)` the next call (its report built at T0 plus 11 minutes) returns `close` with the attempt in CLOSE and `healthResult` PASS; the next returns `done` with disposition `delivered`. [R1] [R2] [R3] [dod arm 1]

### 2
Same file, "a health BREACH read from the bound command goes to RECOVER, or stops without recovery authority" passes and fails on main. The base report with `http_5xx_rate` observed 7.5. (a) With the recovery authorization recorded as tests/scenarios/release.test.ts:319-324 records it: `next` returns `recover`, the attempt is in RECOVER with disposition `recovered`, the goal's ledger holds one `rollback` record, `succeeded`, and the signals are `['http_5xx_rate=BREACH', 'p95_latency_ms=PASS']`. (b) In its own fixture without that authorization: STOP `rollback-auth` and no `rollback` record. [R3] [dod arm 1]

### 3
Same file, "unsuccessful execution receipts and invalid reports produce unavailable signals, never PASS" passes and fails on main. Every table row runs at T0 on its own attempt and gives both unavailable; a row marked "no call" also asserts that the runner saw no `health-cmd` call, every other row exactly one. Rows, each changing one thing of the base fixture:

| Class (R1, R4) | Row |
|---|---|
| no binding | `healthOps` without the `health` binding (no call) |
| environment | attempt without `environment`; attempt with `environment: ''` (no call, each) |
| directory | binding `cwd: 'missing'`, absent under `fx.tmp`; `cwd` naming a file written in `fx.tmp` (no call, each) |
| execution, sync binding | exit 1 with the base report; `exitCode: null` and `timedOut: false` with the base report; `timedOut: true` with the base report; `failurePattern: 'DEGRADED'` and a `DEGRADED` line before the base report; `failurePattern: 'DEGRADED'` with `DEGRADED` on stderr only and the base report on stdout; `successPattern: 'probe ok'` absent from both streams |
| execution, async binding | `async: true`, exit 0, with the base report (issued); `async: true`, exit 1, with the base report (UNKNOWN) |
| stream | the base report on stderr and an empty stdout; stdout `` (empty); stdout `\n  \n\t\n` |
| last line | the base report followed by the line `done`; last line `{`; last line `[]`; `null`; `"text"` |
| schema | `environment` absent, `7`, `''`; `candidate` absent, `''`; `signals` absent, `{}`; an entry without `name`; `samples` `-1`, `1.5`, `"20"`, `9007199254740992`; `observed` `"0.1"`, `null`, written as `1e400`; `lastSampleAt` `"2026-09-11 00:00:00Z"`, `"2026-13-01T00:00:00.000Z"`, `0`; a third entry `{ name: 'cpu', samples: -1 }` (an undeclared name, malformed) |

Control rows, each giving PASS with signals `=PASS` for both and one call: the base report; with `\r\n` line ends; with two blank lines after the report line; with spaces before and after the report line; with `successPattern: 'probe ok'` and a `probe ok` line on stdout; with `successPattern: 'probe ok'` and `probe ok` on stderr only (the patterns read both streams, the report only stdout); with `samples` `9007199254740991`. After every table and control row has run at T0, the clock advances once by 41 minutes, and `next` on the attempt of the no-binding row returns STOP `release-health` with detail `insufficient health data within the maximum wait`. The Attempt evidence records, for each check of R1, R2 and R4, the mutation applied and the assertion of this table that failed; a check whose removal no row detects, because another check rejects the same input first, is listed with that reason. [R1] [R2] [R4] [dod arm 1]

### 4
Same file, "the report names the attempt's environment by its lease and its candidate exactly" passes and fails on main. PASS rows: report `environment` `Production`; an attempt whose `environment` is `ops/prod`, whose command receives `--env ops/prod`, with report `environment` `OPS\prod`. Both-unavailable rows: report `environment` `staging`; `production ` (a trailing space); report `candidate` `C1`; ` c1` (a leading space); `c2`. Rows with the attempt's `candidateDigest` absent and `''`, each with a report naming `c1`: both unavailable and exactly one `health-cmd` call (the digest does not prevent dispatch). The PASS rows fail against a comparison of exact strings (the case row) or of lower-cased strings (the slash row). [R1] [R2] [R4] [dod arm 1]

### 5
Same file, "a signal the report does not name, or names twice, is INSUFFICIENT_DATA; an undeclared one is ignored" passes and fails on main. Rows: (a) the report names `http_5xx_rate` only: signals `['http_5xx_rate=PASS', 'p95_latency_ms=INSUFFICIENT_DATA']`, result INSUFFICIENT_DATA; (b) `p95_latency_ms` twice with passing values: `p95_latency_ms=INSUFFICIENT_DATA`, result INSUFFICIENT_DATA; (c) both declared entries and a third entry `{ name: 'cpu', observed: 1000000, samples: 20, lastSampleAt: fx.now() }`: result PASS and the signals name exactly the two declared ones; (d) `p95_latency_ms` not named and `http_5xx_rate` observed 7.5: result BREACH; (e) `http_5xx_rate` without `observed`, without `lastSampleAt`, with `samples` 0, and with a `lastSampleAt` six minutes before the fixture time, each in its own row: `http_5xx_rate=INSUFFICIENT_DATA`. [R3] [R4] [dod arm 1]

### 6
Same file, "aidlc.ops.json, not the command, gives each signal its source, threshold, minimum samples and staleness" passes, and fails on main inside its own body (`ops.healthReportOf` and `ops.healthSignals` are read through `import * as ops` and are undefined there). With the declared list `D = [{ name: 'a', source: 's1', threshold: { op: '<', value: 1 }, minSamples: 5, maxStalenessMs: 120000, windowMs: 600000, maxWaitMs: 1800000 }, { name: 'b', source: 's2', threshold: { op: '>=', value: 2 }, minSamples: 1, maxStalenessMs: 300000, windowMs: 600000, maxWaitMs: 1800000 }]`: (a) `ops.healthReportOf` of a line holding extra keys at the top (`window`) and in an entry (`unit`) returns an object deep-equal to the report without those keys; (b) `ops.healthSignals(D, report)` with a report that lists `b` (observed 3, samples 4, lastSampleAt T0) before `a` (observed 0.5, samples 9, lastSampleAt T0, and `source: 'other'`): the signals are in the order `a`, `b`; `a` has `name` `a`, `source` `s1`, `threshold`, `minSamples` and `maxStalenessMs` of its declaration, `observed` 0.5, `samples` 9, `lastSampleAt` T0, `synthetic` false, `probeAvailable` true; `b` has `source` `s2` and the other fields of its declaration, `observed` 3, `samples` 4, `probeAvailable` true; (c) `ops.healthSignals(D, undefined)`: both `probeAvailable` false, `samples` 0, the fields of their declarations; (d) two declarations named `a` with thresholds `<` 1 and `<` 0.1 and a report naming `a` once with observed 0.5: two signals, both `probeAvailable` true with observed 0.5, and through the runner the results `a=PASS` and `a=BREACH`; (e) report names `A` and ` a` (re-cased and padded): `a` is unavailable; (f) a declaration with `name: ''` and `source: ''` and a report entry named `''`: one signal with `name` `''` and `source` `''`, `probeAvailable` true, and no throw from `healthSignals` or from the runner's evaluation; (g) through the runner, an `http_5xx_rate` entry with observed 5 carrying `threshold: { op: '<', value: 10 }` gives `http_5xx_rate=BREACH`; one with samples 3 carrying `minSamples: 1` gives INSUFFICIENT_DATA (the list says 5); with `maxStalenessMs: 60000` on the declaration, a `lastSampleAt` three minutes old carrying `maxStalenessMs: 3600000` gives INSUFFICIENT_DATA. [R2] [R3] [dod arm 1]

### 7
Same file, "the health command runs once per call with the attempt's environment, and touches no operation, lease or other event" passes and fails on main. (a) Binding with `cwd: 'ops'` (a directory made in `fx.tmp`) and `idempotencyKeyArg: '--idempotency-key'`: three `next` calls at T0, T0 plus 1 and plus 2 minutes give exactly three runner calls, each `health-cmd` with args `['--env', 'production']` (no `--idempotency-key`), `cwd` `path.resolve(fx.tmp, 'ops')`, `timeoutMs` 60000 and `killTree` true. (b) Binding with `targetSelection: 'env'`: args `[]` and `AIDLC_TARGET_ENV` `production`. (c) Two `health` bindings, `health-a` then `health-b`: only `health-a` is called. (d) Over the three calls of (a), with `leases` a `LeaseStore` subclass whose `update`, `claim`, `takeover`, `heartbeat`, `release`, `fence` and `purgeReleased` count their calls, and a lease of `env:production` held by another session (`claim` with `actorB` before the calls, through the fixture's own store): the counts are zero, the bytes of that lease file are unchanged, `fx.ops.list({ goalId })` is the same before and after, the events added to the goal journal are exactly three, each `HEALTH_EVALUATED`, and the stored attempt is the one saved by the last call (its `healthResult` PASS). (e) `healthOps` with `health: []`, `opsNotConfigured` and an `unreadable` ops load (`{ status: 'unreadable', file: 'memory', error: 'x' }`): no `health-cmd` call and `healthResult` INSUFFICIENT_DATA, each. [R1] [R5] [dod arm 1]

### 8
Same file, "reconciliation comes before the health command" passes and fails on main. (a) A `deploy` record of the attempt written with `fx.ops.recordIntent` (`releaseAttempt` the attempt id, target `production`) and left `intended`: `next` returns the wait on `unknown:<id>`, with no `health-cmd` call and no `HEALTH_EVALUATED`; after `fx.ops.markResult(<id>, 'succeeded', {}, fx.now())` the next `next` makes one `health-cmd` call and evaluates. (b) With the deploy binding of `opsConfigured({ asyncDeploy: true })`, a record of the attempt marked issued with provider id `dep1`: one `next` calls `status-cmd dep1` and then `health-cmd`, in that order, and evaluates PASS. [R1] [dod arm 1]

### 9
Same file, "a runner, journal or save failure leaves the evaluation incomplete and the next call runs the command again" passes and fails on main. (a) A runner whose `health-cmd` call throws an `Error`: `next` throws that error, the stored attempt is the one stored before, no `HEALTH_EVALUATED` is added; the same row on an APPLY attempt whose `apply-deploy` step succeeded keeps the OBSERVE save made before the evaluation (the transition write remains). (b) `Journal.prototype.append` replaced by a wrapper that throws for the first `HEALTH_EVALUATED` and calls the original otherwise, and restored after the row (the seam tests/scenarios/journal-lock-refusal.test.ts:33-44 uses): `next` throws after one `health-cmd` call, the stored attempt is unchanged, the ledger holds no record; the next `next` makes a second call and appends `HEALTH_EVALUATED`. (c) A `GoalStore` whose `saveRelease` throws once (as tests/scenarios/release-reissue.test.ts:186-190): `next` throws after one call and one `HEALTH_EVALUATED`, the stored attempt is unchanged, and the next `next` makes a second call. On main no call happens, so each row fails. [R4] [R5] [dod arm 1]

### 10
Same file, "an injected signals source runs no health command" passes on main and with this card. `healthOps()` and the recording runner, with `signals: () => [signal]` where `signal` has the shape of tests/scenarios/release.test.ts:250-252 (observed 0.1): `healthResult` PASS and no `health-cmd` call; with `signals: () => []`: INSUFFICIENT_DATA and no `health-cmd` call. [R6] [dod arm 1]

### 11
Same file, "aidlc release next closes an observed attempt from the bound health command" passes and fails on main. Fixture: `makeFixture()` with the goal and an attempt stored in OBSERVE (production, candidate `c1`, window T0 to T0 plus 10 minutes, so it has elapsed and its maximum wait has passed by the wall clock); `aidlc.ops.json` written in `fx.tmp` with the `health` binding `{ role: 'health', command: [process.execPath, '-e', <script>], targetSelection: 'env', timeoutMs: 60000 }` and one declared signal `http_5xx_rate` (`<` 1, minSamples 1), where the script prints `probe start` and then the report with `environment` from `process.env.AIDLC_TARGET_ENV`, candidate `c1`, observed 0.1, samples 20 and `lastSampleAt` its own current time (`new Date().toISOString()` inside the child). The CLI, run as the hygiene sentence gives it, `release next <attemptId>` from `fx.tmp`: exit 0, the stored attempt is in CLOSE with `healthResult` PASS, and the JSON on stdout names state `CLOSE`. On main the attempt is saved STOP `release-health`. [R1] [R2] [dod arm 1]

### 12
tests/infra/ops.test.ts, tests/core/health.test.ts, tests/scenarios/release.test.ts, release-reissue.test.ts, release-lease.test.ts, release-report-step.test.ts, checkpoint-packet.test.ts, ops-cwd.test.ts, journal-lock-refusal.test.ts and op-clock.test.ts pass unchanged: each runner that reaches OBSERVE injects a source, each runner built without one never reaches OBSERVE (R6), op-clock.test.ts finds the ledger calls it found before, and ops.test.ts finds its `cwd` clauses in DELIVERY-OPS and in the OPERATIONS Rules paragraph. This passes on main and with this card once T0-OP-TIMESTAMP-NOW-2 has merged; op-clock.test.ts comes with it and is absent at e2ca57fd, and release-lease.test.ts came with T0-STAGING-LEASE-RELEASE-2 (PR 282). [R6] [R7] [dod arm 1]

### 13
docs/DELIVERY-OPS.md and templates/docs/DELIVERY-OPS.md carry Q1, Q2, Q3, H1, the example and H2 and are equal with line endings normalised; docs/OPERATIONS.md carries Q4 at the end of the Rules paragraph, paragraph O after the paragraph that begins `A BREACH routes to RECOVER`, and the example `health` binding with `"timeoutMs": 120000`; docs/ARCHITECTURE.md ends the paragraph that begins `` `finalStateForTarget` fixes `` with sentence A; the comment on `signals` is the one of Exact text; CHANGELOG.md carries entry C directly above the entry that begins `- T0-ASK-RECLASSIFY` (reviewer-verified against the diff). tests/infra/ops.test.ts "the template copy of DELIVERY-OPS.md is the repository's" passes. [R8]

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/health-op.test.ts tests/infra/ops.test.ts tests/core/health.test.ts tests/scenarios/release.test.ts tests/scenarios/release-reissue.test.ts tests/scenarios/release-lease.test.ts tests/scenarios/release-report-step.test.ts tests/scenarios/checkpoint-packet.test.ts tests/scenarios/ops-cwd.test.ts tests/scenarios/journal-lock-refusal.test.ts tests/scenarios/op-clock.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; every existing file listed passes unchanged. The document readers are the coordinator's run before the first review (hygiene); the full suite runs in CI.

## Planner rulings of 2026-11-12 after the pre-review of 9e9eecb2

A Codex pre-review of 9e9eecb2 found the failure classes closed (no input gave PASS without a valid report of the attempt's environment and candidate), no added ledger call or lease mutation, reconciliation first, the documents matching and the template copy equal. It raised three blocks on test coverage and three risks. Rulings:

| Point | Ruling |
|---|---|
| Revert 18 (the `trim()` of the chosen line) is not detected: ASCII padding passes `JSON.parse` either way | Accepted. Add a control whose report line begins with a byte order mark (U+FEFF) and one padded with no-break spaces (U+00A0): both are read with `trim()` and fail without it |
| Revert 46 (letter case and padding ignored together) passes for the wrong reason: both names then match and the exactly-one rule hides it | Accepted. Three rows, each with one report entry for the declared name `A`: `a` alone, ` A` alone, and ` A `; each leaves the signal unavailable |
| An assertion expects `target: undefined` and fails when the caller's environment has `AIDLC_TARGET_ENV` set | Accepted. The test sets the variable to a known state for the row and restores it in a `finally` |
| Reverts 20 and 21 (`min(1)` on `environment` and `candidate`) are masked in the runner but change what the exported schema accepts | Accepted. Two direct assertions: `HealthReport.safeParse` fails for an empty `environment` and for an empty `candidate` |
| The evaluation uses the clock read before the command ran, so a command that runs long can have a sample accepted that is stale when it returns | Accepted, in this card and not as a follow-up: before this card OBSERVE could not pass from the CLI, so this card is what makes the time of the evaluation matter, and the later time can only turn a PASS into INSUFFICIENT_DATA. R9, acceptance 14, one sentence in H2 (both DELIVERY-OPS.md copies) and one in entry C |
| `healthReportOf` splits the whole stdout into lines; an output of many newlines under the runner's 64 MiB limit makes tens of millions of array entries | Accepted. Find the last line whose `trim()` is not empty by scanning backward from the end, without building the array; the result is the one R2 states. One row: 200 000 blank lines before the report, the report is read |

Rows of acceptance 14, R9. Declared signal with `maxStalenessMs` 300 000; fixture clock at T; report with `lastSampleAt` T minus 200 000 ms. (a) the scripted runner advances the fixture clock by 150 000 ms while the health command runs: the sample is 350 000 ms old when the command returns, result INSUFFICIENT_DATA with the detail of `evaluateSignal` (`last sample 350s old exceeds 300s`). (b) it advances by 50 000 ms: PASS. Revert that must fail (a): `now` in place of the later clock read. The journal event of the evaluation and the saved attempt carry the step's time as before, which a row asserts.

## Planner rulings of 2026-11-12 after the second pre-review (of 431236a1)

The second Codex pre-review confirmed the backward scan against 37 449 generated inputs, the new rows and the document sentences. It raised two blocks and one risk, all on R9 as the planner had written it. Rulings:

| Point | Ruling |
|---|---|
| R9 said the journal event and the STOP keep the step's time. The journal writes its own timestamp, the store its own `updatedAt`, and `recoverOrStop` reads the clock itself | The planner's sentence was wrong. R9 now lists what keeps the step's `now` and what never did. The row that asserted "the event keeps the step's time" asserts the fields R9 names instead: the saved window, and `stop.at` of the insufficient-data STOP |
| No row tells the later clock from the step's `now` in `windowElapsed` and in the maximum-wait check | Two rows, as the review gives them: a PASS whose command starts 25 s before the end of the window and returns 50 s later stays in OBSERVE (`observe` directive, no CLOSE); insufficient data whose command starts 75 s before the end of the maximum wait and returns 150 s later stays in OBSERVE (no STOP) |
| The rationale said the later time can only turn PASS into INSUFFICIENT_DATA. It also turns a BREACH into INSUFFICIENT_DATA when the breaching sample passes its bound while the command runs, which holds back RECOVER for that evaluation | Accepted as a defect of R9, not only of its rationale: a rule added to stop a stale PASS must not delay a recovery. R9 now evaluates twice and keeps a BREACH found with the step's time. One row: a breaching sample 200 s old at the start, a command of 150 s, a bound of 300 s gives BREACH and the `recover` path, where 431236a1 gives INSUFFICIENT_DATA |

Code, as ruled: `const early = evaluateHealth(signals, window, now, binding); const late = evaluateHealth(signals, window, this.clock(), binding); const health = early.result === 'BREACH' ? early : late;` with the clock read placed directly after the source returned. A BREACH in the later evaluation implies one in the earlier (its sample was younger then and the comparison is the same), so the choice is the worse of the two for every input. Reverts that must each fail a row: `late` always (the BREACH row), `early` always (R9 row (a)), `PASS` taken from `early` (R9 row (a)), the later clock in `windowElapsed` (the window row), the later clock in the maximum-wait check (the maximum-wait row).

## Planner ruling of 2026-11-12 after the third pre-review (of 19288418)

The third Codex pre-review confirmed the forward-clock cases, the kept step times, the event data, the document sentences and the rulings on the deviations, and found one input the selection of the second round got wrong: a clock that moves backward while the command runs. A passing sample 301 s old at the start, bound 300 s, clock back by 2 s: the first evaluation is INSUFFICIENT_DATA, the second PASS, and `early.result === 'BREACH' ? early : late` took the PASS. The runner's default clock is the wall clock, which a time correction can set back.

Ruling: the stricter of the two fixes the review names. The selection is by severity, so the statement "the worse of the two for every input" holds without a condition on the clock:

`const severity = { PASS: 0, INSUFFICIENT_DATA: 1, BREACH: 2 } as const; const health = severity[early.result] > severity[late.result] ? early : late;`

Row (acceptance 14): the case above gives INSUFFICIENT_DATA and the attempt stays in OBSERVE; the scripted runner moves the fixture clock back by 2 000 ms while the health command runs (the fixture's clock is set, not advanced, for this row, and set forward again after it if the fixture is used further). A second row for the other direction of the same rule: a breaching sample 301 s old at the start, bound 300 s, clock back by 2 s gives BREACH. Reverts that must each fail a row: the second round's selection (`early.result === 'BREACH' ? early : late`) fails the first row; `late` always fails the first row; `early` always fails the second row and the stale-PASS row. The sentences of H2 and entry C stay as they are: both remain true.

## Attempt evidence

Commits: RED `1f7630df` (tests only, on 2f38fc4f), GREEN `92ffb803` (source, docs and two test edits: `lines` lost its unused `fx` parameter for `noUnusedParameters`, and the control row "two blank lines after the report" now writes a line of spaces and a line holding a tab, so the blank-line rule of R2 has a row that detects it; no assertion changed).

### RED (`node --test tests/scenarios/health-op.test.ts` on 1f7630df, sources of 2f38fc4f: 1 pass, 10 fail)
| Item | Result on main | First failing assertion |
|---|---|---|
| 1 | fail | `healthResult` INSUFFICIENT_DATA, expected PASS |
| 2 | fail | directive `observe` (Insufficient telemetry), expected `recover` |
| 3 | fail | row "no binding": signals `[[]]`, expected both INSUFFICIENT_DATA |
| 4 | fail | row "environment Production": signals `[[]]` |
| 5 | fail | row "http_5xx_rate only": evaluations without signals |
| 6 | fail | TypeError `ops.healthReportOf is not a function` (inside the body, as the card states) |
| 7 | fail | runner calls `[]`, expected three `health-cmd` calls |
| 8 | fail | `health-cmd` calls 0 !== 1 after the record is marked succeeded |
| 9 | fail | row (a): Missing expected exception (no runner call on main) |
| 10 | pass | passes on main, as the card states |
| 11 | fail | saved STOP / INSUFFICIENT_DATA, detail `insufficient health data within the maximum wait`, expected CLOSE / PASS |
| 12 | not run on main | green on 92ffb803 (DoD below) |
| 13 | not run on main | document text; template equality green on 92ffb803 |

### Revert table (actual revert runs on the 92ffb803 sources)
Each row: one mutation applied in the worktree, `node --test tests/scenarios/health-op.test.ts` run, the file restored with `git checkout`; `git diff --stat` empty after the last row. "Red" names the failing tests by acceptance item and the first assertion.

| # | Clause | Mutation | Red | Assertion |
|---|---|---|---|---|
| 1 | R1 list not empty | drop the `health.length` check | 7 | `an empty health list` health calls |
| 2 | R1 binding exists | drop `!binding` | 3 | TypeError reading `cwd` (no-binding row throws) |
| 3 | R1 environment present, not empty | drop `!attempt.environment` | 3 | TypeError reading `toLowerCase` (environment rows throw) |
| 4 | R1 isDirectory before dispatch | drop the isDirectory check | 3 | `cwd missing` health calls |
| 5 | R1 first binding | last `health` binding instead | 7 | calls `health-b` |
| 6 | R1 at most once | a second `executeOperation` | 3, 4, 7, 8, 9 | `exit 1: health calls` |
| 7 | R1 no idempotency key | the attempt id passed as the idempotency key | 7 | call deep-equal (args) |
| 8 | R1 binding timeout | timeout 30 minutes | 7 | call deep-equal |
| 9 | R1 root is the main checkout | `process.cwd()` as root | 7 | call deep-equal (cwd) |
| 10 | R1 attempt environment as target | target `undefined` | 4, 7, 8, 11 | args deep-equal |
| 11 | ORDER R1 reconciliation first | signals read before the reconciliation | 8 | health calls while the record is unresolved |
| 12 | R2 only `succeeded` | read every execution | 3 | row `exit 1` |
| 13 | R2 only `succeeded` | read all but `failed` | 3 | row `timed out` |
| 14 | R2 only stdout | stdout and stderr | 3 | row `report on stderr, stdout empty` |
| 15 | R2 last non-blank line | first non-blank line | 1-8, 11 | PASS rows |
| 16 | R2 last non-blank line | last line that parses as JSON | 3 | row `report then a line done` |
| 17 | R2 blank is `trim()` empty | blank is the empty string only | 3 | control `two blank lines after the report` |
| 18 | R2 the line trimmed | no `trim()` of the chosen line | 12 (repair) | at 92ffb803 not detected (`JSON.parse` skips ASCII whitespace); now red: `a line that begins with U+FEFF` (repair row R2) |
| 19 | R2 parse throw is no report | no `try` | 3 | `"done" is not valid JSON` thrown |
| 20 | R2 environment min 1 | `z.string()` | 12 (repair) | at 92ffb803 masked by the lease check; now red on the direct `HealthReport.safeParse` row (repair row R7) |
| 21 | R2 candidate min 1 | `z.string()` | 12 (repair) | at 92ffb803 masked by the candidate comparison; now red on the direct `HealthReport.safeParse` row (repair row R8) |
| 22 | R2 samples integer | drop `.int()` | 3 | row `samples 1.5` |
| 23 | R2 samples safe | integer check without the safe range | 3 | row `samples 9007199254740992` |
| 24 | R2 samples 0 or more | drop `.nonnegative()` | 3 | row `samples -1` |
| 25 | R2 observed finite | any number, infinite included | 3 | row `observed 1e400` |
| 26 | R2 observed not null | `.nullable()` | 3 | row `observed null` |
| 27 | R2 lastSampleAt a real time | drop the `Date.parse` refine | 3 | row `lastSampleAt month 13` |
| 28 | R2 lastSampleAt IsoTimestamp | `z.string()` with the refine | 3 | row `lastSampleAt with a space` |
| 29 | R2 strip, top level | `z.looseObject` | 6 | (a) deep-equal (`window` kept) |
| 30 | R2 strip, entry | `z.looseObject` | 6 | (a) deep-equal (`unit` kept) |
| 31 | R2 malformed entry fails the report | keep only valid entries | 3 | row `an entry without name` |
| 32 | R2 environment by lease file | exact string comparison | 4 | `environment Production` |
| 33 | R2 environment by lease file | lower-cased comparison | 4 | `environment OPS\prod for ops/prod` |
| 34 | R2 environment checked | no environment check | 4 | `environment staging` |
| 35 | R2 candidate case-sensitive | lower-cased comparison | 4 | `candidate C1` |
| 36 | R2 candidate not trimmed | trimmed report candidate | 4 | `candidate with a leading space` |
| 37 | R2 candidate checked | no candidate check | 4 | `candidate C1` |
| 38 | R2 absent digest accepts nothing | an absent or empty digest accepts any | 4 | `attempt without a digest` |
| 39 | R3 declaration order | sorted by report order | 5, 6 | `http_5xx_rate only`; (b) |
| 40 | R3 not parsed through `HealthSignal` | `HealthSignal.parse` per signal | 6 | (f) throws on the empty name |
| 41 | R3 exactly one entry | first of two read | 5 | `p95_latency_ms twice` |
| 42 | R3 no other report field read | the entry spread over the signal | 6 | (b) deep-equal (`source` `other`) |
| 43 | R3 threshold from the list | schema and mapper read `threshold` | 6 | (g) threshold row |
| 44 | R3 minSamples from the list | schema and mapper read `minSamples` | 6 | (g) minSamples row |
| 45 | R3 staleness from the list | schema and mapper read `maxStalenessMs` | 6 | (g) staleness row |
| 46 | R3 name as the same string | case and padding ignored together | 12 (repair) | at 92ffb803 masked by the exactly-one rule in row 6(e); now red on the single entry `a` for a declared `A` (repair row R11) |
| 47 | R3 name as the same string | letter case ignored | 6 | (e) `probeAvailable` |
| 48 | R3 name as the same string | padding ignored | 6 | (e) `probeAvailable` |
| 49 | R3 unavailable signal | `probeAvailable` true | 6 | (c) deep-equal |
| 50 | R3 synthetic false | `synthetic` true | 6 | (b) deep-equal |
| 51 | R4 runner exceptions propagate | catch and return unavailable | 9 | (a) Missing expected exception |
| 52 | ORDER R4 transition write remains | APPLY steps into OBSERVE without its save | 9 | (a) APPLY row stored state |
| 53 | R5 no ledger record | `recordIntent` before the run | 1, 2, 7, 9 | 7 ledger list; the next call waits on `unknown:` |
| 54 | R5 no lease method | `claim` before the run | 7 | lease counts |
| 55 | R5 no journal event | a `NOTE` append before the run | 7 | added events |
| 56 | R6 injected source runs nothing | the command run, then the injected source | 10 | health calls |
| 57 | R1 default source | `() => []` (main) | 1-9, 11 | every behavioural row |
| D1 | R8 template copy | H1 removed from templates/docs/DELIVERY-OPS.md only | ops.test.ts | "the template copy of DELIVERY-OPS.md is the repository's" |

At 92ffb803: red 53 of 57 source rows. After the repair round all four rows that were not detected (18, 20, 21, 46) are red; see the repair section. D1 (actual run) is the only document row a test reads; the other texts of R8 are reviewer-verified against the diff.

### DoD (`dod_command` on 92ffb803, worktree clean)
`npm run typecheck`: exit 0. `node --test` of the eleven files: tests 119, pass 116, fail 0, skipped 3 (tests/scenarios/release-lease.test.ts, POSIX permission rows, skipped on Windows); exit 0.

Other runs on 92ffb803: tests/scenarios/health-op.test.ts on Linux (WSL Ubuntu, node v24.3.0): 11 pass, 0 fail. Document readers tests/infra/init.test.ts, tests/surface/templates.test.ts, tests/surface/module-map.test.ts, tests/core/journal-event-types.test.ts, tests/scenarios/op-intent-dup.test.ts and tests/scenarios/fault-points.test.ts: 111 pass, 0 fail; tests/surface/prose, budget-doc, removed-surface, command-lines, readme, edge-scope and claude-md-size: 54 pass, 0 fail.

### Document text against code and test
| Text | Code | Test |
|---|---|---|
| Q1, Q3, Q4 (no publication, effect or authority check; no operation recorded) | `observedSignals` reads no `triggersPublication`, `effects` or authorization and calls no ledger method | 7 (d) ledger unchanged; row 53 |
| Q2 and H2, `async: true` gives unavailable signals | `executeOperation` returns `issued` or `UNKNOWN`; only `succeeded` is read | 3 async rows; rows 12, 13 |
| H1 conditions, first binding, once per call, directory, target, timeout, no idempotency key | `observedSignals` checks and its `executeOperation` call | 3, 7 (a)-(c), (e); rows 1-10 |
| H1 reconciliation first | the OBSERVE case follows the reconciliation in `step` | 8; row 11 |
| H1 no lease, no journal event; `HEALTH_EVALUATED` as before | no `LeaseStore` or `Journal` call in `observedSignals` | 7 (d); rows 54, 55 |
| H2 environment by lease, candidate exactly | the `leaseOf` comparison and `===` | 4; rows 32-38 |
| H2 entry fields, other keys dropped, a malformed entry invalidates | `HealthReport`, `healthReportOf` | 3 schema rows, 6 (a); rows 22-31 |
| H2 source, threshold, minimum, staleness from `health`; exact name | `healthSignals` | 5, 6; rows 39-50 |
| H2 failure classes, one-signal rule; runner exceptions propagate | `observedSignals`, `healthSignals` | 3, 5, 9; rows 12-19, 41, 51 |
| H2 last sentence and O (no declared signal, window, maximum wait, STOP) | `return []`; `healthWindowMs`, `maxWaitMs` and the OBSERVE STOP unchanged | 3 final STOP check; 7 (e) |
| A, C and the comment on `signals` | as above; exports of src/delivery/ops.ts (src/index.ts re-exports the module) | 1-11 |
| OPERATIONS example `"timeoutMs": 120000` | `OperationBinding.timeoutMs` | none (example) |

### Size
`git diff --shortstat origin/main...HEAD` on 92ffb803: 8 files, 649 insertions, 12 deletions (661 changed lines). With this section the count is given in the coordinator report; budget 820.

### Repair round after the pre-review of 9e9eecb2
Commits: merge of origin/main `3dd7f9f7` (conflict in this card only), RED `a1e8f0f9` (tests only), GREEN `50b027db` (R9, the backward scan of `healthReportOf`, the H2 sentence in both DELIVERY-OPS.md copies, the entry C sentence).

RED on a1e8f0f9 (sources of 3dd7f9f7), test "the staleness of a sample is judged when the health command has returned", each assertion run on its own in a scratch copy of the test file (removed): R9 (a) result FAIL (PASS at the old time); the STOP row FAIL (the attempt closed instead) and its `stop.at` FAIL; the rows that the window and the directive window keep the step's time: pass already (a third assertion, on the keys of the event data, was removed in the second repair round: the event's timestamp never carried the step's time); R9 (b) PASS row: passes already; U+FEFF and U+00A0 rows, 200 000 blank lines, `a` / ` A` / ` A ` for a declared `A`, both `safeParse` rows: pass already (they pin behaviour the old source has). Row (f): the test of acceptance 7 now unsets `AIDLC_TARGET_ENV` for its calls and restores it in a `finally`; observation: the 9e9eecb2 version of that test fails with `AIDLC_TARGET_ENV=staging` (`target: 'staging'`), the new one passes with it set.

Revert rows, actual runs on the 50b027db sources (`git diff --stat` empty after the last):
| # | Mutation | Red | Assertion |
|---|---|---|---|
| R1 | `now` in place of the clock read after the source returned (R9) | 12 | R9 (a) result deep-equal |
| R2 | chosen line not trimmed (blank test still by `trim()`) | 12 | `a line that begins with U+FEFF` (the U+00A0 row is after it; `JSON.parse` throws on both padded lines, checked with `node -e`) |
| R3 | blank means the empty string (chosen line still trimmed) | 3 | control `two blank lines after the report` |
| R4 | first non-blank line in place of the backward scan | 1-9, 11, 12 | every PASS row |
| R5 | last line that parses as JSON | 3 | row `report then a line done` |
| R6 | no `try` around `JSON.parse` | 3 | `"done" is not valid JSON` thrown |
| R7 | `environment` without `min(1)` | 12 | `HealthReport.safeParse` empty environment |
| R8 | `candidate` without `min(1)` | 12 | `HealthReport.safeParse` empty candidate |
| R9 | letter case ignored alone (both sides lower-cased) | 6, 12 | 6(e); entry `a` |
| R10 | padding ignored alone (both sides trimmed) | 6, 12 | 6(e); entry ` A` |
| R11 | case and padding ignored together (old row 46) | 12 | entry `a` |

Red 11 of 11. DoD on 50b027db, worktree clean: `npm run typecheck` exit 0; `node --test` of the eleven files: tests 120, pass 117, fail 0, skipped 3 (the POSIX permission rows of release-lease.test.ts on Windows); exit 0; tests/scenarios/op-clock.test.ts green, unchanged. Linux (WSL Ubuntu, node v24.3.0): health-op.test.ts 12 pass, 0 fail.

Document text added in this round: H2 and entry C sentences on staleness, replaced in the second repair round (below).

Size: `git diff --shortstat origin/main...HEAD` before this section: 9 files, 825 insertions, 13 deletions; the count with it is in the coordinator report; budget 900.

### Second repair round after the pre-review of 431236a1
Commits: merge of origin/main `26347bac` (conflict in this card only; its message keeps git's `# Conflicts:` lines after the Co-Authored-By line), RED `e59ac2b9` (tests only), GREEN `b6842cfe` (two evaluations, the H2 sentence in both DELIVERY-OPS.md copies, the entry C sentence, the code comment).

Test changes in e59ac2b9: the comment and the assertion that said the journal event keeps the step's time are gone (the journal, the store and `recoverOrStop` read their own clock); the row asserts the saved fallback window and `stop.at` of the insufficient-data STOP instead. RED on e59ac2b9 (sources of 431236a1): row (a), a breaching sample 200 s old at the start, a 150 s command and a 300 s bound: FAIL (`INSUFFICIENT_DATA` where BREACH is expected; the `recover` assertion follows it); row (b), PASS with the command starting 25 s before the end of the window and returning 50 s later, stays in OBSERVE: passes already; row (c), insufficient data with the command starting 75 s before the end of the maximum wait and returning 150 s later, no STOP: passes already; row (d), the saved window and `stop.at`: pass already.

Revert rows, actual runs on the b6842cfe sources (`git diff --stat` empty after the last):
| # | Mutation | Red (line of tests/scenarios/health-op.test.ts) |
|---|---|---|
| S1 | `late` always | the BREACH row (:593) |
| S2 | `early` always | R9 row (a), the stale PASS (:559) |
| S3 | PASS taken from `early` | R9 row (a) (:559) |
| S4 | later clock in `windowElapsed` | row (b), the window (:572) |
| S5 | later clock in the maximum-wait check | row (c), the maximum wait (:576) |
| S6 | later clock in `at` of the insufficient-data STOP | `stop.at` (:567) |

Red 6 of 6. DoD on b6842cfe, worktree clean: `npm run typecheck` exit 0; `node --test` of the eleven files: tests 120, pass 117, fail 0, skipped 3 (the POSIX permission rows of release-lease.test.ts on Windows); exit 0; op-clock.test.ts green, unchanged. Linux (WSL Ubuntu, node v24.3.0): health-op.test.ts 12 pass, 0 fail.

Document text: H2 `A sample counts toward PASS only while ...; a breach found with the time at which the evaluation began still counts.` and the entry C sentence, word for word from Exact text: code `early` / `late` and `health = early.result === 'BREACH' ? early : late` in the OBSERVE case; tests R9 (a), (b), the BREACH row; reverts S1-S3.

Size: `git diff --shortstat origin/main...HEAD` before this section: 9 files, 881 insertions, 13 deletions; budget 950.

### Third repair round after the pre-review of 19288418
Commits: merge of origin/main `d90ee69e` (conflict in this card only; the merge was concluded with `git commit --no-edit`, so git's `# Conflicts:` lines again follow the Co-Authored-By line), RED `2567e5e0` (tests only), GREEN `d8d9dbdb` (the `severity` selection of the ruling and the code comment; H2 and entry C unchanged).

RED on 2567e5e0 (sources of 19288418): row 1, a passing sample 301 s old, bound 300 s, the fixture clock set back 2 000 ms during the command: FAIL (`PASS` where INSUFFICIENT_DATA is expected); row 2, the same with a breaching sample: passes already (observation: run alone in a scratch copy of the test, removed). The fixture clock is set back to the step's start after each row.

Revert rows, actual runs on the d8d9dbdb sources, each also run on a scratch copy of the test with every assertion of acceptance 14 reported on its own (removed; `git status` clean after):
| # | Mutation | Red |
|---|---|---|
| T1 | the second round's selection (`early.result === 'BREACH' ? early : late`) | row 1 (observed 0.1) |
| T2 | `late` always | row 1; also the BREACH row of the second round |
| T3 | `early` always | row 2 (observed 7.5) and the stale-PASS row R9 (a); also the STOP rows |

Red 3 of 3. DoD on d8d9dbdb, worktree clean: `npm run typecheck` exit 0; `node --test` of the eleven files: tests 120, pass 117, fail 0, skipped 3 (the POSIX permission rows of release-lease.test.ts on Windows); exit 0; op-clock.test.ts green, unchanged. Linux (WSL Ubuntu, node v24.3.0): health-op.test.ts 12 pass, 0 fail. `git diff --shortstat origin/main...HEAD` before this section: 9 files, 932 insertions, 13 deletions; budget 990.

## Planner rulings on the disclosed deviations (coordinator, before R3)

The implementer disclosed these points where the card gave no rule or where it chose a form. The planner rules on each before the formal review; none is an edit the card forbids.

| Disclosed point | Ruling |
|---|---|
| In both DELIVERY-OPS.md copies H1 and H2 are single unwrapped lines, while Q1 to Q3 are wrapped at 77 columns like the paragraphs they extend | Accepted. The card gives a wrapping rule for Q1 to Q3 only ("wrapped as that paragraph is wrapped"); H1 and H2 are new paragraphs, and the two copies are equal |
| The control row "two blank lines after the report" uses lines of spaces and a tab, not empty lines | Accepted. With empty lines no row could tell `trim()` from a comparison with the empty string; the row is stricter than the card's wording |
| Acceptance 2 runs its cases (a) and (b) as two `makeFixture` fixtures inside one test, both removed by `t.after(cleanup)` | Accepted. The fixtures and their removal are the ones the card names |
| Acceptance 9 (b) restores `Journal.prototype.append` in a `finally` directly after the row | Accepted. The card asks for the restore after the row; the forbid on `finally` concerns the removal of temporary directories |
| Two test edits went into the source commit after the RED commit: an unused parameter removed for the typecheck, and the whitespace of the control row above | Accepted. No assertion changed; the RED results are those of the RED commit |
| Repair rounds: the row on `stop.at` of the insufficient-data STOP and one revert row beyond the four asked for | Accepted. The row is (d) of the second round's rulings; the extra revert adds evidence and no code |
| The merge commits 3dd7f9f7 and 26347bac carry git's default text (the first without the attribution line, the second with conflict comment lines after it) | Noted. They are merge commits of main into the branch and are squashed at the ship; published history is not rewritten for a message |
