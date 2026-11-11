---
id: T0-CHECKPOINT-PACKET-SHARED
title: "The goal's release directive at CHECKPOINT carries the release runner's approval packet, so an authorization written from it matches what release next checks"
status: todo
branch: T0-CHECKPOINT-PACKET-SHARED
worktree: D:\wt\AIDLC\T0-CHECKPOINT-PACKET-SHARED
depends_on: [T0-ASK-RECLASSIFY]
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/checkpoint-packet.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CHECKPOINT-PACKET-SHARED.md
dod_command: npm run typecheck && node --test tests/scenarios/checkpoint-packet.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/run-driver.test.ts
dod_exit: 0
requirements:
  - R1. WHILE the release attempt that `nextInDeliver` selects is at CHECKPOINT and its target is `production` or `migration`, the `release` directive of `GoalController.next` shall carry as `packet` the `packet` of `ReleaseRunner.checkpointPacket(goal, attempt)` (the production environment the ops configuration names, else `production`; the planned operation roles, `migration-apply` beside `deploy` when the attempt names a database; the candidate digest, source sha and config digest of the attempt; the evidence ids, data steps and recovery plan as the runner gives them). In every other release state the packet is `{}` as on main at 92796d4f. An attempt at CHECKPOINT with any other target, which a raw `release-result` patch can store (controller.ts:620-622) and for which `checkpoint()` throws `APPLY is a production step` (src/core/release-machine.ts:89, called at src/loop/release-runner.ts:93), gets packet `{}`: the controller does not call the builder for it, nothing throws, `next` and `report` still return, and no authorization can match an empty packet.
  - R2. `ControllerDeps` shall take an optional `releaseRunner: ReleaseRunner`, which the controller uses for R1 when it is given.
  - R3. WHEN no `releaseRunner` is given, THEN the controller shall build `new ReleaseRunner({ paths, repo, store, ops, leases, now })` from its own deps at each CHECKPOINT read of R1, without caching it, so the ops configuration (`aidlc.ops.json` under the main checkout) is read on each call as `aidlc release next` and `aidlc release packet` read it (`releaseCtx`, src/cli/main.ts:1112-1118).
  - R4. Reading the packet shall write nothing: no release attempt save, journal event or operation, before and after a matching approval is recorded (`checkpointPacket` computes only); `next` writes in DELIVER what main writes.
  - R5. The structured directive and the JSON CLI output shall carry the packet unchanged; the human narration is unchanged. Only JSON output carries `packet` (`out`, src/cli/main.ts:103-106). The directive reaches `aidlc next` (:411), `aidlc run` (:426, `runGoal` returns a `release` directive without a provider call), `aidlc report` (:464), `aidlc authorize` (:482-485), `aidlc plan approve` (:861), `aidlc goal new` (:296), `aidlc release start` (:1126) and the `aidlc goal` subcommands that print a directive. The directive's own `environment` field stays the attempt's recorded environment (`staging` at CHECKPOINT) beside `packet.environment` (`production`).
  - R6. Each document shall state its part of this change: `docs/ARCHITECTURE.md` in the `release` row of the directive table that the packet at CHECKPOINT is `ReleaseRunner.checkpointPacket`'s and `{}` otherwise; `docs/OPERATIONS.md` (Standalone release, production paragraph) that `aidlc next --json` shows the same packet as `aidlc release packet <id>` and that the authority is recorded from the packet's environment and operations, not from the directive's `environment` field; the CHANGELOG entry this card id with R1.
acceptance:
  - 1. `tests/scenarios/checkpoint-packet.test.ts` "the goal's release directive at CHECKPOINT carries the runner's packet, and an authority recorded from it lets release next apply": a production attempt driven to CHECKPOINT with a `ReleaseRunner` on `opsConfigured()`, a `GoalController` built from the fixture deps with that runner: `next` gives `release` whose packet deep-equals `runner.checkpointPacket(...).packet`, environment `production`, operations `["deploy"]`; `approved` reported with kind `production` and the packet's candidate digest, source sha, environment and operations, then `runner.next` issues one deploy operation whose target is `production`. Fails on main: the packet names `staging` and the operation record ids. [R1] [R2] [dod arm 1]
  - 2. Same file "without an injected runner the controller packet equals the CLI's for every ops configuration": attempts saved at CHECKPOINT through the fixture store with a populated `configDigest`, evidence and steps, compared with `new ReleaseRunner({ paths, repo, store }).checkpointPacket(...)`: `aidlc.ops.json` naming the production environment `live`; one with no environment marked production (fallback `production`); the file absent and the file unreadable (environment `production`, recovery plan `NOT CONFIGURED`); an attempt with a database (operations `deploy` and `migration-apply`). The file is changed between two reads and the second packet follows it. Fails on main. [R1] [R3] [dod arm 1]
  - 3. Same file "reading the packet writes nothing": the journal length, the operation count and the stored attempt are the same before and after `next` at CHECKPOINT, both before and after a matching approval is recorded; in PREPARE the packet is `{}`. [R4] [dod arm 1]
  - 4. Same file "an attempt at CHECKPOINT that is not a production step gets an empty packet": a staging attempt stored at CHECKPOINT by a `release-result` patch: `report` and `next` return the `release` directive with packet `{}` and nothing throws. [R1] [dod arm 1]
  - 5. Same file: `runGoal` with a `MockProvider` and the controller of acceptance 1 returns the `release` directive with the same packet and no provider call. [R5] [dod arm 1]
  - 6. `tests/scenarios/release.test.ts` (among them "Q17: a production goal presents the checkpoint packet for the production environment ...", "the approval packet is read without advancing the attempt ..."), `tests/scenarios/release-publication.test.ts` and `tests/scenarios/run-driver.test.ts` pass unchanged. [R1] [R4] [dod arm 1]
  - 7. The docs and the CHANGELOG state R6 (reviewer-verified against the diff). [R6]
budget: 200
diagnosis:
  root_cause: "`nextInDeliver` (src/loop/controller.ts:436) builds its own packet with `approvalPacket('production', { ..., environment: attempt.environment, operations: attempt.operations })`: at CHECKPOINT the attempt's environment is still the staging one and `operations` holds operation record ids, while `ReleaseRunner.checkpoint` (src/loop/release-runner.ts:89-101) binds the production environment and the planned roles, which `assertReleaseTransition` matches the authority against. An authorization written from the goal directive never matches. Reproduced by audit probe `probe2.test.ts` P14 on main."
  same_class: "Every builder of a production approval packet: `nextInDeliver` (changed), `ReleaseRunner.checkpoint` with its two callers `next` and `checkpointPacket` (the shared builder, unchanged), `aidlc release packet` (src/cli/main.ts:1175, prints `checkpointPacket`, unchanged); the plan-checkpoint packet of `nextInCards` (:295) is another kind and is not affected."
sweep: "git grep -n \"checkpointPacket\\|approvalPacket(\\|new ReleaseRunner(\" -- src tests on main at 92796d4f, then git grep -n \"controller.next(\\|\\.directive\" -- src/cli/main.ts for the readers. controller.ts:436: changed (R1). controller.ts:295 (plan-checkpoint packet): not affected. release-runner.ts:95,104: the shared builder, unchanged; `checkpointPacket` is a public instance method since T0-AUDIT-FIXES, so release-runner.ts needs no export or static form and is not in allow_paths. cli/main.ts:1118 (`releaseCtx`) and :1175 (`release packet`): unchanged, R3 matches them. Readers (R5): :296, :411, :426, :464, :482-485, :861, :1126 print the directive through `out` (:103-106), which writes JSON with --json and the human line otherwise. tests/core/authorization.test.ts:81,86 (`approvalPacket` itself): unchanged. tests/scenarios/release.test.ts:146-151,178-187,527-535 assert the runner's packet: unchanged. No test asserts the packet of the goal's `release` directive."
forbid: [weakening or skipping a test to go green, a change to src/loop/release-runner.ts or src/core/authorization.ts, writing any record while reading the packet, editing .aidlc state by hand]
non_goals: ["the `environment` field of the `release` directive, which stays the attempt's recorded environment", "the controller's release narration and the human CLI output", "the release runner's own checkpoint narration or packet", "a check that the release attempt's candidate is the goal's current integrated candidate"]
hygiene: "Line numbers are from main at 92796d4f; read them again at PREPARE. Depends on T0-ASK-RECLASSIFY, after T0-CARDS-PROJECTED-REENTRY: both change src/loop/controller.ts, docs/ARCHITECTURE.md, docs/OPERATIONS.md and CHANGELOG.md and merge first. The release-runner drafts T0-RELEASE-OP-REISSUE, T0-STAGING-LEASE-RELEASE and T0-RELEASE-REPORT-STEP change src/loop/release-runner.ts (the last two also src/cli/main.ts) and merge before this card; read `checkpoint()`, `checkpointPacket` and `releaseCtx` again after them (T0-OP-TIMESTAMP-NOW also touches release-runner.ts). The tests go in a new file because T0-RELEASE-REPORT-STEP cites line numbers of tests/scenarios/release.test.ts. The controller imports `ReleaseRunner`; release-runner.ts imports nothing from src/loop/controller.ts, so no import cycle forms. The `ReleaseRunner` constructor reads `aidlc.ops.json` and writes nothing. This card changes no file the verify-card-run-writes coverage record names. Before the first R3, revert each source hunk in a scratch copy and run its acceptance test (lesson 2026-11-11 T0-AUDIT-FIXES). Insert the CHANGELOG entry directly above the entry that begins `- T0-PREPARE-WORKTREE (bugfix)`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. T0-CARDS-PROJECTED-REENTRY and T0-ASK-RECLASSIFY use the same anchor; the three cards build one after another, so this entry goes directly above that line, below theirs."
doc_sync: docs/ARCHITECTURE.md (directive table, `release` row), docs/OPERATIONS.md (Standalone release, production), CHANGELOG.md
---

# T0-CHECKPOINT-PACKET-SHARED

## Deliverable
`aidlc next --json` at a production CHECKPOINT shows the approval packet that `aidlc release packet` shows and that `aidlc release next` checks the authority against.

## Why
On main the goal directive names the staging environment and operation record ids, the release runner the production environment and operation roles, so an authorization written from `aidlc next` never matches (audit F18 and N2, probe P14). T0-AUDIT-FIXES added the read-only builder `ReleaseRunner.checkpointPacket`; this card points the controller at it, builds the runner on each read so the ops configuration is current, and gives a non-production attempt at CHECKPOINT an empty packet instead of the builder's throw.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/checkpoint-packet.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/run-driver.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; acceptance 1 and 2 fail on main.

## Attempt evidence

RED commit 5efcf942 (tests only). On main every test failed at its first assertion: tests 1, 2, 3 (migration), 4 (reading writes nothing, packet environment `staging` not `production`) and 6 (packet differs from the runner's) on a packet deep-equal or environment assertion; test 5 (staging attempt at CHECKPOINT) on a non-empty packet. One correction after RED, before GREEN: test 1 asserted directive kind `apply` after `runner.next`, but a synchronous bound deploy moves the attempt to OBSERVE; it now asserts `applied.attempt.state === 'OBSERVE'` (a wrong expectation in my own new test, not a weakening).

| Acceptance | Test or command | Result |
|---|---|---|
| 1 | checkpoint-packet.test.ts "the goal's release directive at CHECKPOINT carries the runner's packet, and an authority recorded from it lets release next apply" | pass; fails on main (staging, record ids) |
| 2 | "without an injected runner the controller packet equals the CLI's for every ops configuration" (plus "a migration attempt at CHECKPOINT carries the runner's packet") | pass; fails on main |
| 3 | "reading the packet writes nothing" | pass |
| 4 | "an attempt at CHECKPOINT that is not a production step gets an empty packet" | pass; fails on main (non-empty packet) |
| 5 | "run returns the release directive with the same packet and no provider call" | pass; fails on main |
| 6 | release.test.ts, release-publication.test.ts, run-driver.test.ts unchanged | pass (DoD: 65 tests, 65 pass, 0 fail) |
| 7 | docs and CHANGELOG, reviewer-verified | ARCHITECTURE.md release row, OPERATIONS.md Standalone release (paragraph after the production example), CHANGELOG entry above `- T0-PREPARE-WORKTREE (bugfix)` |

Per-hunk revert (each hunk undone alone, checkpoint-packet.test.ts run, then restored):

| Hunk | Fails | Result |
|---|---|---|
| target condition `production` or `migration` replaced by true | test 5, "release transition CHECKPOINT -> APPLY refused: APPLY is a production step" thrown | red |
| `migration` removed from the condition | test 3 (migration), packet `{}` not equal to the runner's | red |
| injected runner ignored (`this.releaseRunner ??` removed) | tests 1 and 6, deep-equal of the packet (runner on `opsConfigured()` against an absent ops file: `recoveryPlan`) | red |
| runner cached across reads | test 2, the second packet after the file changes (`live2`) | red |
| packet fixed to `{}` | tests 1, 2, 3, 4, 6 | red |
| `attempt.state === 'CHECKPOINT'` clause removed | test "the packet builder is consulted only for a production or migration attempt at CHECKPOINT, once per next": spy `checkpointPacket` called 4 times (PREPARE, STAGE, APPLY, OBSERVE), "no builder call outside CHECKPOINT", `4 !== 0` | red |

The CHECKPOINT clause is proved through an injected spy runner (`checkpointPacket` called 0 times in PREPARE, STAGE, APPLY, OBSERVE and for a staging attempt at CHECKPOINT, packet `{}`; once per `next` at CHECKPOINT). Without an injected runner the non-CHECKPOINT case cannot be observed by a test (the packet is `{}` either way, and building the runner writes nothing), so that spy test is the proof of the condition both paths share.

Input classes against tests (all in checkpoint-packet.test.ts, test 2 unless noted):

| Class | Result asserted |
|---|---|
| production environment named `live` | packet environment `live`, operations `["deploy"]`, recoveryPlan matches `recover-cmd`, configDigest `cfg9`, evidence `["ev-1"]`, dataSteps from the steps |
| file changed between two reads | second packet `live2` |
| no environment marked production | environment `production` |
| ops file unreadable (text `this is { not json`, same on every platform) | environment `production`, recoveryPlan `NOT CONFIGURED`, nothing throws |
| ops file absent | environment `production`, recoveryPlan `NOT CONFIGURED` |
| attempt with a database | operations `["deploy","migration-apply"]` |
| migration target | packet equals the runner's (own test) |
| non-production target at CHECKPOINT (staging, release-result patch) | packet `{}` from `report` and `next`, nothing throws (test 4) |
| PREPARE | packet `{}` (test 3) |

Doc-reading run: 78 files, `node --test` in one call: 1863 tests, 1851 pass, 0 fail, 12 skipped, 0 cancelled. Linux run of the new file is the coordinator's.

DoD: `npm run typecheck && node --test tests/scenarios/checkpoint-packet.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/run-driver.test.ts` exit 0, 65 tests, 65 pass, 0 fail. Each new test (seven in the file) removes its temp directory through `fx.cleanup()` in a `finally`; the ops file lives inside it.

Coordinator verification:
