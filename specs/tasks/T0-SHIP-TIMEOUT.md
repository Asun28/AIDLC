---
id: T0-SHIP-TIMEOUT
title: Every subprocess call of the GitHub ship path has a timeout, and a push, PR create or merge that timed out leaves its operation UNKNOWN to be reconciled, never repeated as a failure
status: todo
branch: T0-SHIP-TIMEOUT
worktree: D:\wt\AIDLC\T0-SHIP-TIMEOUT
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: about 70 source lines in src/delivery/github-ship.ts, src/delivery/ship.ts and src/loop/card-runner.ts; the rest is the receipt matrix of the seven calls, the classifier precedence table, the reconcile rows for five statuses on the remote and local paths, the failed-step rows of the owed result on a current, a superseded and a stopped run, the reader rows, docs and about 25 lines of attempt evidence"
allow_paths:
  - src/delivery/github-ship.ts
  - src/delivery/ship.ts
  - src/loop/card-runner.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/ship.test.ts
  - tests/scenarios/ship-effect-unknown.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-TIMEOUT.md
dod_command: npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/infra/ship.test.ts tests/scenarios/ship-effect-unknown.test.ts tests/scenarios/ship-throw.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. `GitHubShipPath.ship` (src/delivery/github-ship.ts) shall pass `timeoutMs` and `killTree: true` to each of its seven direct runner calls, with these bounds. `git add -A`, `git diff --cached --quiet`, `git commit` and the local-mode `git merge --no-ff --no-edit` get 60,000 ms, the bound of every base-sync git call (github-ship.ts:439, 449) and of the git helper of `GitProbe` (src/probes/git.ts:55). `git push -u origin <card>` gets 300,000 ms, the longest git bound in src/probes/git.ts (`removeWorktree`, :92). `gh pr create` and `gh pr merge` get 120,000 ms, the bound of every `GhProbe` call (src/probes/gh.ts:73). WHEN `ShipRequest.timeoutMs` is a whole number from 1 to 2,147,483,647, each of the seven calls gets the smaller of its bound and that value; any other value (absent, 0, negative, fractional, NaN, 2,147,483,648 or more) leaves the bound. The request value caps each call and is never a deadline of the whole ship, since such a deadline would cut the CI wait that `github.ciTimeoutMs` sets.
  - R2. IF `git push`, `gh pr create`, `gh pr merge` or the local-mode `git merge` returns a receipt with `timedOut` true, whatever its exit code (with `killTree` a timed-out command on Windows returns exit code 1, signal null, `timedOut` true, because the tree kill ends it with taskkill, src/probes/exec.ts:254 and :378-383), or with no exit code (a signal, a tree helper failure), THEN `GitHubShipPath.ship` shall end the ship with `[SHIP-EFFECT-UNKNOWN] <the command> timed out after <n> ms; it may have taken effect` (or `ended without an exit code` in place of the timeout clause), the PR number when one is known, and no later step: no PR create, CI poll, merge, merge-state read, base sync, PR view or merge token write. A numeric non-zero exit with `timedOut` false keeps its sentinel as on main (`[SHIP-PUSH-FAIL]`, `[SHIP-PR-NUMBER-FAIL]`, the merge refusal path, `[SHIP-LOCAL-MERGE-FAIL]`), and so does a numeric spawn-error code (exit -4058 with `[spawn error]` on Windows for a command that never started).
  - R3. IF `git add`, `git diff --cached --quiet` or `git commit` returns a receipt with `timedOut` true, whatever its exit code, or with no exit code, or `git diff --cached --quiet` exits with a code other than 0 or 1, THEN `GitHubShipPath.ship` shall end the ship with `[SHIP-COMMIT-FAIL]` naming the command and the timeout, the missing exit code or the exit code, before any commit, verdict read or remote call; exit 1 of the diff with `timedOut` false still commits and exit 0 still skips the commit, as on main.
  - R4. `classifyShipOutput` (src/delivery/ship.ts:213-237) shall read a receipt whose stdout or stderr holds `[SHIP-EFFECT-UNKNOWN]` as `ShipOutcomeClass` `effect-unknown`, checked before the exit-zero contract (:222-228), before the whole-receipt timeout (:229) and before `SENTINEL_MAP`, so the class is `effect-unknown` for every exit code (0, non-zero, null), with or without a whole-receipt timeout, and with or without `[SAGA-DONE]`, `[SAGA-FAIL]` or any other sentinel beside it; its `detail` is the first `[SHIP-EFFECT-UNKNOWN]` line as printed (already encoded by the ship path), so the operation error keeps the command and the clause. A receipt without the sentinel is classified exactly as on main, a whole-receipt timeout (the scaffold path) staying `unclassified`.
  - R5. WHEN `CardRunner.applyShipResult` (src/loop/card-runner.ts) receives `effect-unknown`, it shall complete the review pool request (the branch at :2717 that every outcome but a quota hold and a timed-out receipt takes), then in this order: write the run through `finish` as `WAIT` with an owed `OPERATION_RESULT` (status `UNKNOWN`, outcome `effect-unknown`, the `detail` of R4) in `journalOwed`, the transaction `settleThrownShip` uses (:1320-1335); mark the merge operation `UNKNOWN` with that `detail` as its error and the injected `now` as its finish time; deliver the owed result (`deliverOwed`); count no attempt; and return a `wait` directive on `operation:<opId>` whose narration names `aidlc ops reconcile <opId> --status succeeded|failed|cancelled` and then `aidlc card next <card>`. When the run was superseded or stopped while the ship ran, `finish` keeps the newer candidate or the stop, and the operation is marked `UNKNOWN` (not `failed`, :2746) and its result journaled, as for a merge.
  - R6. After `aidlc ops reconcile` records `succeeded`, `failed` or `cancelled` for that operation, the next `aidlc card next` shall ship again under a new operation (tests/scenarios/op-intent-dup.test.ts:239-246 pins a new intent after a settled one); on the remote path that ship ends at the PR lookup as `merged` when the PR is merged (github-ship.ts:310-313) and reuses an open PR (no `gh pr create`), so no second PR and no second merge is made; in local mode a re-ship after a local merge that did take place runs `git merge --no-ff --no-edit` again, which git answers `Already up to date.` with exit 0 and no new commit, so it ends `merged` with no second merge commit (probed with git on 2026-11-11). `running` and `UNKNOWN` keep the card in WAIT (`selectCardState`, unknown or running operation; the directive of :792-795 with `reconciling unknown operations` or `attached to running operation`).
  - R7. `docs/OPERATIONS.md` (Ship gates, beside the sentence on a ship that throws) and `CHANGELOG.md` Unreleased shall each state R1 to R6, that a timed-out call of the GitHub path completes its pool request, and, as a known limitation, that a scaffold ship that timed out as a whole is `unclassified`, marks its pool request lost and records its operation `failed` although task.ps1 may have merged (a follow-up card for the scaffold path); `docs/ARCHITECTURE.md` adds `[SHIP-EFFECT-UNKNOWN]` to the `SENTINEL_MAP` list (line 209 at 6c1a6cfd), the timeouts to the GitHub ship path bullet (:210) and `effect-unknown -> WAIT on the operation` to the outcome mapping (:214).
acceptance:
  - 1. `tests/infra/github-ship.test.ts` "every subprocess call of the ship carries a timeout": a runner that records the options of each call; a remote ship that merges and a local ship that merges record no call without a positive `timeoutMs`; the seven direct calls carry `killTree: true` and the bounds of R1; with request `timeoutMs` 1 each of the seven gets 1, with 5000 each gets 5000, and with 2147483647, 0, -1, 1.5, NaN and 2147483648 each gets its bound. Fails on main. [R1] [dod arm 1]
  - 2. Same file, "a push, PR create or merge that timed out or ended without an exit code is an effect of unknown outcome": for each of `git push`, `gh pr create`, `gh pr merge` and the local `git merge`, the receipts `{ timedOut: true, exitCode: null }`, `{ timedOut: true, exitCode: 1, signal: null }` and `{ timedOut: false, exitCode: null, signal: 'SIGTERM' }` each give outcome `effect-unknown`, the `[SHIP-EFFECT-UNKNOWN]` line naming the command, the PR number when known, and none of the later calls R2 lists; no merge token is written. Regression controls (green on main): `{ timedOut: false, exitCode: 1 }` and `{ timedOut: false, exitCode: -4058, stderr: '[spawn error] ...' }` keep the sentinel of main for each call. Fails on main for the first three receipts. [R2] [R4] [dod arm 1]
  - 3. Same file, "a staged-diff read that timed out or failed never commits": `git add` and `git commit` with `{ timedOut: true, exitCode: null }`, `{ timedOut: true, exitCode: 1, signal: null }` and `{ exitCode: null }`, and `git diff --cached --quiet` with those three and with exit 128, each give `[SHIP-COMMIT-FAIL]` naming the command, with no `git commit` after a failed diff read and no remote call. Regression controls: diff exit 1 commits, diff exit 0 does not. Fails on main for the diff rows and the `timedOut` exit 1 rows. [R3] [dod arm 1]
  - 4. `tests/infra/ship.test.ts` "effect-unknown precedence": a table over exit 0, 1 and null, `timedOut` true and false, and each of none, `[SAGA-DONE]`, `[SAGA-FAIL]`, `[SHIP-PUSH-FAIL]`, `[CI-GATE-RED]` and `[SHIP-MERGE-FAIL]` beside it: with `[SHIP-EFFECT-UNKNOWN]` every row is `effect-unknown` with `detail` equal to that line; without it every row equals the class main gives (a frozen copy of main's rule, as T0-SHIP-FAILURE-ORACLE does). "captures the resume command and PR number; timeouts and unknown exits are unclassified" passes unchanged. [R4] [dod arm 1]
  - 5. `tests/scenarios/ship-effect-unknown.test.ts` (a `DryRunShipPath` whose first ship returns `effect-unknown`): `card next` at SHIP returns `wait` on `operation:<opId>` naming `aidlc ops reconcile`; the operation is `UNKNOWN` with the ship line as its error and `finishedAt` equal to the fixture time; the journal holds one `OPERATION_RESULT` with status `UNKNOWN` and outcome `effect-unknown` and `journalOwed` is empty; the pool request is completed, not lost; the effort attempts are unchanged; a second `card next` returns `wait` with `reconciling unknown operations` and ships nothing. Fails on main (STOP/tool and a `failed` operation). [R5] [R6] [dod arm 1]
  - 6. Same file, "each persistence step of the owed result can fail and the next step recovers with no further effect": with the `finish` write failing, then the `markResult` write failing, then the `OPERATION_RESULT` append failing (one per run), the command throws; `card next` afterwards ships nothing and returns `wait` (attached to the running operation while the operation is still `issued`, reconciling the unknown operation once it is `UNKNOWN`), and the owed result is appended once, marked `completed: true`, when the ledger shows `UNKNOWN`. The same with a new candidate recorded during the ship (superseded) and with a stop saved during it: the newer candidate or the stop stays, the operation is `UNKNOWN`, never `failed`. [R5] [dod arm 1]
  - 7. Same file, "after a reconcile the card ships again without a second effect": for `succeeded`, `failed` and `cancelled` the next `card next` records a new merge intent and ships once; for `running` (with a provider id) and `UNKNOWN` it ships nothing and returns `wait`. On the remote path (a `GitHubShipPath` with a scripted runner) a PR reported `MERGED` ends the re-ship as `merged` with no push, `gh pr create` or `gh pr merge`, and an open PR is reused with no `gh pr create`. In local mode, with real git in a temporary repository, a re-ship after the local merge took place ends `merged` and `git rev-list --count` of the base is unchanged. [R6] [dod arm 1]
  - 8. Same file, "readers of the waiting card": the board shows the card as WAIT; `aidlc bounds` counts for the card are unchanged; `aidlc audit verify` reports `OP_UNKNOWN` naming the operation; after `succeeded` and the re-ship, audit verify reports no `OP_UNKNOWN` and the same fact warnings as a fault-free dry-run ship of the card. [R5] [R6] [dod arm 1]
  - 9. Regression controls, passing unchanged: `tests/infra/github-ship-merge-refused.test.ts`, `tests/scenarios/ship-throw.test.ts`, `tests/scenarios/op-intent-dup.test.ts` (:239-246), `tests/scenarios/merge-unconfirmed.test.ts` (:230, :388), `tests/scenarios/t0-flow.test.ts` (:4234, a scaffold timeout marks its request lost) and `tests/scenarios/fault-points.test.ts` with no pin added. [R2] [R4] [R5] [dod arm 1]
  - 10. The three documents and the CHANGELOG state R7 (reviewer-verified against the diff). [R7]
depends_on: []
budget: 560
tdd: true
diagnosis:
  root_cause: "`ShipRequest.timeoutMs` (src/delivery/ship.ts:52) is read only by `ScaffoldShipPath`; `GitHubShipPath.ship` calls its runner for `git add` (github-ship.ts:263), `git diff --cached --quiet` (265), `git commit` (267), the local `git merge` (319), `git push` (326), `gh pr create` (329) and `gh pr merge` (372) with no `timeoutMs`, so `runSync` waits without bound. A receipt with no exit code is read as a numeric failure: a push or merge that timed out becomes `push-failed` or a merge refusal and its operation `failed`, although it may have taken effect, and a timed-out `git diff --cached --quiet` (exit null, not 0) is read as staged changes and commits."
  repro: "Both reviews of 2026-11-11 reproduced C9 on 92796d4f; acceptance 1 to 3 fail there with a scripted runner (no timeoutMs on the seven calls; a timed-out push gives [SHIP-PUSH-FAIL]; a timed-out diff read is followed by git commit). github-ship.ts, ship.ts and card-runner.ts are unchanged at 6c1a6cfd."
  same_class: "Every subprocess call the GitHub ship path makes, with its disposition, is in sweep. The scaffold path reads `timeoutMs` as the bound of its whole ship phase under killTree (ship.ts:261-273); its timeout is `unclassified`, marks the pool request lost, stops the card with STOP/tool and records the operation failed although task.ps1 may have merged: a known limitation for a follow-up card, stated in the docs (R7). The dry-run path runs no subprocess and only records the request."
sweep: "git grep -n 'this.runner(\|this.gh\.\|this.git\.\|git(\[' -- src/delivery/github-ship.ts at 6c1a6cfd, and the probe methods it calls (src/probes/gh.ts, src/probes/git.ts). Changed (R1 to R3): add :263, diff :265, commit :267, local merge :319, push :326, pr create :329, pr merge :372. Already bounded and unchanged: `gh.login` :259 (60 s; a failure is [SHIP-AUTH]); `git.head` :271 (60 s; a failure throws, the ship throws and the runner leaves the operation UNKNOWN, card T0-SHIP-THROW-SLOT); `gh.resolvePr` :293 (120 s per gh call; a throw or a problem is [SHIP-PR-BASE-UNKNOWN] before any effect); every git call of `baseSync` and `mergeChangelog` :439-544 (60 s; local to the worktree, a failure or timeout is [SHIP-BASE-SYNC-FAIL]); `gh.checkRuns` :343 (120 s; a throw is pending until the CI deadline); `gh.jobRecord` and `gh.jobLog` :569-570 (120 s; a timeout is log unavailable); `gh.prMergeState` :407 (120 s; a throw is an unreadable state, no sync); `gh.prView` :389 after the merge (120 s; a throw makes the ship throw, operation UNKNOWN). Readers of `ShipRequest.timeoutMs`: ScaffoldShipPath.ship (ship.ts:272), DryRunShipPath.ship (records it), GitHubShipPath.ship (this card); its one writer is CardRunner.ship (card-runner.ts:1304, 60 min). Readers of `ShipOutcomeClass`: classifyShipOutput, SENTINEL_MAP and FAILING_LINE_AT (ship.ts), the queue settlement (card-runner.ts:2714-2717), the superseded status in `finish` (:2746), the failure mark (:2814-2815), the outcome switch of `applyShipResult`, and DryRunShipPath. Readers of the waiting card: selectCardState (src/core/card-machine.ts:59-73, 93), the WAIT directive (card-runner.ts:792-795), the board (src/state/board.ts:19, 25-33), the audit verifier OP_UNKNOWN (src/audit/verifier.ts:66), `aidlc bounds`. Entry point: `aidlc card next <card>` at SHIP (`aidlc run` never ships, AIDLC_RUN_NO_SHIP). Tests that pin current behaviour: tests/infra/ship.test.ts:66-77 (a whole-receipt timeout is unclassified), tests/scenarios/t0-flow.test.ts:4221-4265 (such a ship marks its pool request lost; the T0-SHIP-HOLD-OUTCOME sentences, not edited), tests/scenarios/op-intent-dup.test.ts:239-246 (a settled operation is not taken over), tests/scenarios/merge-unconfirmed.test.ts:230 and :388, tests/infra/github-ship.test.ts:176 (a numeric merge failure is [SHIP-MERGE-FAIL]) and :1188 (a push failure); all stay as they are."
forbid:
  - weakening or skipping a test to go green
  - a whole-ship deadline that shortens the CI wait set by `github.ciTimeoutMs`
  - a change to the scaffold or dry-run ship paths, to `ScaffoldShipPath.phase`, or to the OPERATIONS and CHANGELOG sentences of T0-SHIP-HOLD-OUTCOME that tests/scenarios/t0-flow.test.ts pins
  - a retry of a call that timed out inside the same ship
  - a new `mkdtempSync` call in a test; use the `fixture` helper of tests/infra/github-ship.test.ts, `makeFixture`, or `tmpDir` of tests/infra/helpers.ts with `cleanup` in an `after` hook
  - editing .aidlc state by hand
non_goals:
  - the scaffold path's timed-out ship (known limitation stated in R7, for a follow-up card)
  - an automatic lookup of whether a timed-out push or merge took effect; the operator reconciles it
  - new bounds for the probe calls, which keep the bounds listed in sweep
hygiene: "Line numbers are from main at 6c1a6cfd; read them again at PREPARE. This card changes src/loop/card-runner.ts (`CardRunner.applyShipResult`), which the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE and move its sync commit at CLOSE. Order of the new branch: unlike the failure branch, which marks the operation and journals before `finish` (:2814-2815), the effect-unknown branch writes the run with the owed result first, then marks the operation, then delivers the owed result, the order of the merged branch (:2803-2807) and of `settleThrownShip`; the skill's coverage gains no new command. Insert the CHANGELOG entry directly above the entry that begins `- T0-REMOVED-CARD-RUNS (bugfix)`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict."
doc_sync: docs/OPERATIONS.md (Ship gates), docs/ARCHITECTURE.md (SENTINEL_MAP list, GitHub ship path, outcome mapping), CHANGELOG.md, .claude/skills/verify-card-run-writes/SKILL.md (sync commit at CLOSE)
---

# T0-SHIP-TIMEOUT

## Deliverable
No call of the GitHub ship path waits without bound. A push, PR create or merge that timed out stops the ship as an effect of unknown outcome: its operation is `UNKNOWN`, its result is owed and delivered, and the card waits for `aidlc ops reconcile` before it ships again, which then makes no second PR and no second merge.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/github-ship.test.ts tests/infra/github-ship-merge-refused.test.ts tests/infra/ship.test.ts tests/scenarios/ship-effect-unknown.test.ts tests/scenarios/ship-throw.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/merge-unconfirmed.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the fault-point check adds no pin.

## Attempt evidence

Attempt 1 (effort high). RED commit 21d4e25e (tests only, run against the c29c594a source). Files: `tests/infra/github-ship.test.ts` (GH), `tests/infra/ship.test.ts` (SHIP), `tests/scenarios/ship-effect-unknown.test.ts` (SCN).

| Acceptance item | Test or command | Result |
|---|---|---|
| 1 [R1] | GH "every subprocess call of the ship carries a timeout [R1]" | pass; failed on c29c594a: the six remote direct calls carried no timeoutMs |
| 2 [R2] [R4] | GH "a push, PR create or merge that timed out or ended without an exit code is an effect of unknown outcome [R2] [R4]" | pass; failed on c29c594a: `'push-failed' !== 'effect-unknown'`; the exit 1 and spawn-error controls held there |
| 3 [R3] | GH "a staged-diff read that timed out or failed never commits [R3]" | pass; failed on c29c594a: `git add -A, timed out, no exit code` gave `[SHIP-COMMIT-FAIL]` with an empty detail (no command named) |
| 4 [R4] | SHIP "effect-unknown precedence [R4]"; "captures the resume command and PR number; timeouts and unknown exits are unclassified" unchanged | pass; failed on c29c594a at the first row with the line (`unclassified`), after the 36 rows without it matched the frozen copy of main's rule |
| 5 [R5] [R6] | SCN "a ship whose effect is unknown waits on its operation for aidlc ops reconcile [R5] [R6]" | pass; failed on c29c594a: `'stop' !== 'wait'` (unclassified, STOP/tool) |
| 6 [R5] | SCN "each persistence step of the owed result can fail and the next step recovers with no further effect [R5]" | pass; failed on c29c594a: `finish: 'failed' !== 'issued'` |
| 7 [R6] | SCN "after a reconcile the card ships again without a second effect [R6]" | pass; failed on c29c594a: `succeeded: 'stop' !== 'close'` |
| 8 [R5] [R6] | SCN "readers of the waiting card [R5] [R6]" | pass; failed on c29c594a: the board did not show the card as WAIT |
| 9 [R2] [R4] [R5] | the regression files of the DoD, unchanged; fault-points.test.ts with no pin added | pass (DoD below) |
| 10 [R7] | docs/OPERATIONS.md (Ship gates, paragraph after the ship-that-throws sentence), docs/ARCHITECTURE.md (SENTINEL_MAP list, GitHub ship path bullet, outcome mapping), CHANGELOG.md (entry above T0-REMOVED-CARD-RUNS) | reviewer to verify |

Readings of the card:
- Acceptance 5 "journalOwed is empty": `deliverOwed` writes nothing (its lock section only appends), so a delivered entry stays on the record until the next write prunes it through `owedWith`, as for a merge. The test asserts that nothing is still owed: every `journalOwed` entry is a result the journal holds.
- Acceptance 6 "appended once, marked completed: true, when the ledger shows UNKNOWN": holds for the append failure, where the runner's own `markResult` set UNKNOWN. When the `finish` write fails nothing is owed; when `markResult` fails the operation stays `issued` and only the operator's `aidlc ops reconcile` sets UNKNOWN, and its `OPERATION_RECONCILED` event then holds the owed result (`journalHolds`, as in ship-throw acceptance 8), so nothing more is appended. Both rows assert the wait on the running operation, then the wait on the unknown one, no second ship and no `failed` operation.
- Acceptance 6 superseded and stopped rows run without a persistence fault: their result is journaled directly by `finish`, not owed.
- The `.claude/skills/verify-card-run-writes/SKILL.md` record is unchanged: a Not-covered line for the new branch took the file to 8374 bytes, over the 8000-byte cap of tests/surface/templates.test.ts (T1-VERIFY-SKILL acceptance 1), so it was dropped.

Verify skill (verify-card-run-writes): covered files changed since the sync commit: `src/loop/card-runner.ts` only. No covered command gained, lost or reordered a write: the new branch runs only for `effect-unknown`, which none of the five driven commands reaches (their ship is a dry-run merge). fault-points.test.ts: 28 of 28 pass, no pin added. Outcome: in sync; the sync commit may move at CLOSE.

Error handling (lstatSync or statSync with throwIfNoEntry false): the change adds none and relies on none. GitHubShipPath keeps its `existsSync` worktree and verdict checks as on main.

Per-hunk revert check (each mutation applied alone to the candidate source, its test file run, the source restored; no row green):

| Hunk (file) | Mutation | Failing test: first failing assertion | Result |
|---|---|---|---|
| H1 github-ship `limit` | request value ignored | GH carries a timeout: `request 1: git add -A` | red |
| H1a github-ship `limit` | whole-number check dropped | GH carries a timeout: `request 1.5: git add -A` | red |
| H1b github-ship `limit` | lower bound dropped | GH carries a timeout: `request 0: git add -A` | red |
| H2 github-ship `unfinished` | timedOut not read | GH effect unknown: push line reads `ended without an exit code` | red |
| H2a github-ship `unfinished` | null exit not read | GH effect unknown: `git push, no exit code after a signal` outcome | red |
| H3 github-ship `effectUnknown` | PR number dropped from the line | GH effect unknown: `the known PR` | red |
| H3a github-ship push | prNumber not passed to `fail` | GH effect unknown: `git push, timed out, no exit code` prNumber | red |
| H3b github-ship gh pr merge | prNumber not passed to `fail` | GH effect unknown: `gh pr merge, timed out, no exit code` prNumber | red |
| H4 github-ship `commitFailure` | detail is stderr as on main | GH never commits: `git add -A, timed out, no exit code` names no command | red |
| H5 github-ship git add | no bound | GH carries a timeout: `no call without a positive timeoutMs` | red |
| H5a github-ship git add | timedOut not read | GH never commits: `git add -A, timed out, exit 0` | red |
| H6 github-ship diff | no bound | GH carries a timeout: `no call without a positive timeoutMs` | red |
| H6a github-ship diff guard | guard removed | GH never commits: `git diff --cached --quiet, timed out, no exit code` | red |
| H6b github-ship diff guard | timedOut not read | GH never commits: `git diff --cached --quiet, timed out, exit 1` | red |
| H6c github-ship diff guard | exit 1 not excluded | GH happy path: outcome not merged | red |
| H7 github-ship git commit | no bound | GH carries a timeout: `no call without a positive timeoutMs` | red |
| H7a github-ship git commit | timedOut not read | GH never commits: `git commit, timed out, exit 0` | red |
| H8 github-ship local merge | no bound | GH carries a timeout: `no call without a positive timeoutMs` | red |
| H8a github-ship local merge | no effect check | GH effect unknown: `git merge, timed out, no exit code` | red |
| H9 github-ship push | no bound | GH carries a timeout: `no call without a positive timeoutMs` | red |
| H9a github-ship push | no effect check | GH effect unknown: `git push, timed out, no exit code` | red |
| H10 github-ship gh pr create | no bound | GH carries a timeout: `no call without a positive timeoutMs` | red |
| H10a github-ship gh pr create | no effect check | GH effect unknown: `gh pr create, timed out, no exit code` | red |
| H11 github-ship gh pr merge | no bound | GH carries a timeout: `no call without a positive timeoutMs` | red |
| H11a github-ship gh pr merge | no effect check | GH effect unknown: `gh pr merge, timed out, no exit code` | red |
| S1 ship.ts classifier | rule removed | SHIP precedence: row `{"exitCode":0,"timedOut":true,"beside":""}` | red |
| S1a ship.ts classifier | stdout only | SHIP precedence: the stderr row | red |
| S1b ship.ts classifier | fixed detail text | SHIP precedence: first row detail | red |
| S1c ship.ts classifier | last line, not first | SHIP precedence: the two-line row detail | red |
| S1d ship.ts classifier | no resume command | SHIP precedence: the two-line row resumeCommand | red |
| S1e ship.ts classifier | no PR number | SHIP precedence: the two-line row prNumber | red |
| C1 card-runner `finish` status | superseded or stopped marked failed | SCN persistence steps: `superseded` operation status | red |
| C2 card-runner branch | removed | SCN waits on its operation: `'stop' !== 'wait'` | red |
| C2a card-runner branch | owed detail dropped | SCN waits on its operation: OPERATION_RESULT data | red |
| C2b card-runner branch | run not written as WAIT | SCN waits on its operation: stored state | red |
| C2c card-runner branch | result not owed | SCN waits on its operation: OPERATION_RESULT list | red |
| C2d card-runner branch | `markResult` without the injected clock | SCN waits on its operation: finishedAt | red |
| C2e card-runner branch | no evidenceRef | SCN waits on its operation: evidenceRef | red |
| C2f card-runner branch | owed result not delivered | SCN waits on its operation: OPERATION_RESULT list | red |
| C2g card-runner branch | delivered as an earlier command's (`completed: true`) | SCN waits on its operation: `completed` | red |
| C2h card-runner branch | wait on another resource | SCN waits on its operation: `on` | red |
| C2i card-runner branch | narration without the reconcile command | SCN waits on its operation: narration | red |

Not mutated: the header comment and the `GIT_MS`, `PUSH_MS` and `GH_MS` constants (no behaviour of their own; every bound is asserted through H5 to H11), the `effect-unknown` union member and `requested !== undefined` (a revert fails `npm run typecheck`, the first DoD arm). Two hunks of the first draft had no observable effect and were removed instead of tested: `staged.exitCode === 1` (after the guard only 0 and 1 remain, so main's `!== 0` is kept) and the upper cap `requested <= 2147483647` (every bound is below it). A first revert run found H10a green: `effectUnknown` wrote the line to the log through `fail` even when its caller ignored the result; it now returns the detail and each call site returns `fail`, and H8a to H11a are red.

Classifier precedence (R4, SHIP "effect-unknown precedence [R4]"): 36 rows, exit 0, 1 and null by `timedOut` true and false by none, `[SAGA-DONE]`, `[SAGA-FAIL]`, `[SHIP-PUSH-FAIL]`, `[CI-GATE-RED]`, `[SHIP-MERGE-FAIL]`: every row with `[SHIP-EFFECT-UNKNOWN]` is `effect-unknown` with the line as detail; every row without it equals the frozen copy of main's rule. Extra rows: the line on stderr with CRLF ends, and two such lines (the first is the detail; PR number, resume command and sentinels asserted).

Card state precedence for the waiting card (`selectCardState`): unknown operation -> WAIT `reconciling unknown operations` (SCN waits on its operation, second `card next`; persistence steps after the reconcile; reconcile `UNKNOWN`); running or issued operation -> WAIT `attached to running operation` (persistence steps `finish` and `markResult`; reconcile `running`); a settled operation admits SHIP again (reconcile `succeeded`, `failed`, `cancelled`).

Reconcile statuses (SCN "after a reconcile the card ships again without a second effect [R6]"): `succeeded` -> new merge intent, one ship, close; `failed` -> same; `cancelled` -> same; `running` (provider id `gh-run-1`) -> wait, nothing shipped; `UNKNOWN` -> wait, nothing shipped. Remote re-ship: PR `MERGED` -> merged with no push, `gh pr create` or `gh pr merge`; PR `OPEN` -> reused, no `gh pr create`. Local re-ship with real git: `effect-unknown`, then `merged` with `git rev-list --count trunk` unchanged.

Doc-reading run (`grep -rlE "ARCHITECTURE\.md|OPERATIONS\.md|CHANGELOG\.md" tests --include=*.test.ts`, one `node --test` call): 1833 tests, 1821 pass, 1 fail, 11 skipped. The failure was tests/surface/templates.test.ts T1-VERIFY-SKILL acceptance 1 (SKILL.md 8374 bytes > 8000), caused by this card's SKILL.md line, not by load; the line was removed and templates.test.ts passes alone (39 of 39). No file failed from machine load.

DoD receipt (`dod_command` as the card gives it, Windows, run on the final source and tests): exit 0; `npm run typecheck` clean; `# tests 304`, `# suites 19`, `# pass 304`, `# fail 0`, `# cancelled 0`, `# skipped 0`, `# todo 0`, `# duration_ms 92713.9043`.

Coordinator verification:
