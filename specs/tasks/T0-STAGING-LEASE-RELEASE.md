---
id: T0-STAGING-LEASE-RELEASE
title: A release attempt that ends with no unresolved operation releases every environment lease it claimed, checked and released in one lease section; one that leaves an unresolved operation keeps them
status: todo
branch: T0-STAGING-LEASE-RELEASE
worktree: D:\wt\AIDLC\T0-STAGING-LEASE-RELEASE
size_exception: "approved by the coordinator as planner and approver of the 18 audit changes under the owner's (asun28) instruction of 2026-11-11: budget raised from 230 to 420 after two reviews of the card (Codex and Fable 5.2) against main at 92796d4f; about 55 source lines in two files, the rest the class, race, failure and CLI tests the rulings require, docs and attempt evidence; raised from 420 to 610 by the coordinator on the candidate 02120801, which is 578 changed lines: 67 source lines in two files, 420 lines of the acceptance tests, 85 lines of attempt evidence with its 16-row revert table, the rest docs"
allow_paths:
  - src/loop/release-runner.ts
  - src/cli/main.ts
  - tests/scenarios/release-lease.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-STAGING-LEASE-RELEASE.md
dod_command: npm run typecheck && node --test tests/scenarios/release-lease.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts tests/infra/lease.test.ts
dod_exit: 0
requirements:
  - R1. `ReleaseRunner.next` shall have one exit through which every return passes, and that exit applies R2 to R5 when the attempt it is about to return is in `DONE` or `STOP`; the public `next` runs the step logic and the exit, and the recursive calls inside the step logic (release-runner.ts:190, :206, :220, :232, :298, :328 on main at 92796d4f) call the step logic, not the exit. So no terminal return is edited one by one, and the exit covers every terminal path: an attempt already terminal when `next` is called (:125-126), the STOPs saved at :150, :160 (`ownership`), :181, :209, :252, :265, :305 and :309, the transitions that can save STOP or DONE at :187, :199, :217, :271 and :294, and the terminal returns that T0-RELEASE-OP-REISSUE (STOP `time` and STOP `audit` of `issue`) and T0-RELEASE-REPORT-STEP (three STOPs `release-health`) add.
  - R2. WHEN the exit of R1 sees a terminal attempt and the goal's operation ledger holds no record that belongs to the attempt by the association predicate of T0-RELEASE-OP-REISSUE R3 (its `releaseAttempt` is the attempt id, or its `idempotencyKey` is exactly one of the attempt's three release-step keys) with status `intended`, `issued`, `running` or `UNKNOWN`, THE runner shall release each environment lease of the attempt by R3 before `next` returns.
  - R3. For each key `resourceKeys.environment(<name>)` (`env:` and the lower-cased name) built from the attempt's `environment` and from the `target` of every record that belongs to the attempt (R2's predicate), THE runner shall decide and write in one `LeaseStore.update(key, change)` section (lease.ts:45-47, the public lease section every lease write goes through; no change to src/coordination/lease.ts): the change marks the record it holds `released` and keeps its generation and every other field only when the record is present, not released, its `operation` is exactly `release:<attemptId>`, and its owner has the session and host of `currentActor()` (an expired lease of this session included); otherwise it returns the record unchanged, which writes nothing. `LeaseStore.release` is not used, since it checks owner and generation but not `operation` (lease.ts:115-120), so a renewal by this session for another attempt that lands before the section takes the lock (`claim` renews in place and rewrites `operation`, lease.ts:71-72) leaves that lease held. An absent lease, a released one, one with no `operation` or another attempt's, and one of another session or of this session on another host are left unchanged.
  - R4. WHEN a record that belongs to the attempt (R2's predicate) has status `intended`, `issued`, `running` or `UNKNOWN`, THE runner shall leave every lease of the attempt unchanged; this covers the STOP `time` after the reconciliation grace (:149-151), the STOPs of T0-RELEASE-OP-REISSUE R5, and any terminal attempt `next` is called on while such a record exists.
  - R5. WHEN the section of R3 throws for a key (its lock is not acquired, or the lease file is unreadable, malformed or fails the `Lease` schema, which `updateJson` reports through `readJson`, src/state/store.ts:83-101), THE runner shall go on with the other keys and return the terminal attempt as saved with its directive, whose narration gains, for each key that failed, the key, the error message and the command `aidlc release next <attemptId>`, which runs R1 to R5 again on the terminal attempt. An operation ledger that cannot be read at this point is handled the same way: every lease of the attempt is kept (the unresolved check of R2 cannot be made), nothing throws out of `next` for the terminal attempt, and the narration names the operation ledger, the store error and that command.
  - R6. The CLOSE branch's own release (:274-281, which releases the lease of `attempt.environment` whatever its `operation`) shall be removed in favour of R1 to R3, so a lease this session renewed for another attempt is no longer released when this attempt closes.
  - R7. `aidlc release next` shall report `release-result` to the goal (src/cli/main.ts:1136-1138) only when the goal record it loaded is not terminal (`Goal.terminal` false), because `GoalController.report` throws for a terminal goal (src/loop/controller.ts:516); so the retry command of R5, run on an attempt whose STOP has already stopped its goal, exits 0 and still applies R1 to R5. With a goal that is not terminal the report is made as on main.
  - R8. `ReleaseRunner.reportStep` shall stay without a lease release: the only attempt it saves in `DONE` is a `package` attempt in PREPARE, and an attempt claims environment leases only in STAGE, APPLY and RECOVER (:156-163); a later `aidlc release next` on that attempt applies R1. `aidlc release next` is the CLI entry point of R1 to R7; `aidlc release packet` and `aidlc release candidate` write no lease; `GoalController` reads no environment lease.
  - R9. Each document shall state the facts named after it: docs/OPERATIONS.md, section Standalone release (package / staging / production), R2 to R5 and R7 and that no command takes over an environment lease of another session; docs/ARCHITECTURE.md, the paragraph after the release state diagram, R1, R2 and R4 in one sentence; CHANGELOG.md, Unreleased, the card id and R1 to R7.
acceptance:
  - 1. `tests/scenarios/release-lease.test.ts` "a staging attempt that ends in DONE releases env:staging, and another session then acquires it" passes and fails on main (main leaves the lease unreleased; after its TTL the other session's claim is `expired`). [R1] [R2] [R3] [dod arm 1]
  - 2. Same file, "a delivered production attempt releases the staging and the production lease it claimed" passes and fails on main (main leaves `env:staging`). [R2] [R3] [R6] [dod arm 1]
  - 3. Same file, "every terminal path passes the one exit": a failed staging deploy (STOP `release-health`), a publishing deploy without production authority (STOP `release-auth` from `issue`), a production attempt stopped for `ownership` at APPLY by another session's expired `env:production` lease (its own `env:staging` released, the other session's lease unchanged), and a terminal attempt stored directly in `STOP` and in `DONE` (as tests/scenarios/release.test.ts:230-248 stores attempts) each leave this attempt's leases released; passes and fails on main. [R1] [R2] [dod arm 1]
  - 4. Same file, "an attempt with an unresolved operation keeps its leases": terminal attempts stored directly with one record each in `intended`, `issued`, `running` and `UNKNOWN`, once with `releaseAttempt` the attempt id and once with `releaseAttempt` absent or another attempt's and the attempt's exact `stage-deploy` key, leave `env:staging` held; an `UNKNOWN` deploy past the reconciliation grace gives STOP `time` with the lease held, and a further `next` leaves it so. A terminal attempt with no ledger record at all releases. On main every unresolved case passes (main releases nothing at a terminal attempt) and the last case, the release with no ledger record, fails. [R2] [R4] [dod arm 1]
  - 5. Same file, "only the attempt's own lease of this session and host is released": a lease with no `operation`, one with `release:<other attempt>` (fails on main at CLOSE, which releases it), one of another session, one of this session's id on another host, a released one and an absent one are left as they are; an expired lease of this session is released; an attempt whose `environment` is `Staging` releases the lease under `env:staging`; the `target` of a record that belongs to the attempt only by its key adds its environment's lease. [R3] [R6] [dod arm 1]
  - 6. Same file, "a renewal for another attempt that lands before the cleanup takes the lock keeps the lease": a lease store wrapper whose `update` for `env:staging` first renews the lease by this session with `operation` `release:<other attempt>` and then runs the real section; after DONE the lease is held with that operation and its generation unchanged. It fails on main, where no lease section runs after DONE, so the injected renewal never happens and the test's own check that it landed fails; it passes with this card, and it fails against a cleanup that reads the lease and then calls `LeaseStore.release` (the revert check of `hygiene` runs that variant). [R3] [dod arm 1]
  - 7. Same file, "a lease cleanup that fails leaves the attempt terminal, releases the other leases and names the command that retries it": with `env:staging` and `env:production` both held by a delivered production attempt, a lease store whose `update` throws once for `env:staging` gives the `done` directive with a narration holding `env:staging`, the error message and `aidlc release next <attemptId>`, `env:production` released and the stored attempt `DONE`; the next `next` releases `env:staging`. A malformed `env:staging` lease file gives the same narration with the store error and leaves the attempt terminal. Passes and fails on main. [R5] [dod arm 1]
  - 8. Same file, "aidlc release next run twice on a stopped attempt exits 0 both times": the CLI, run as `node src/cli/main.ts` with `AIDLC_SESSION` set and a lease written for that session and this host, on an attempt stored in STOP: the first run reports `release-result` and stops the goal, the second skips the report, both exit 0, and the lease is released. Fails on main (the second run exits 1 with `goal ... is terminal`). [R5] [R7] [dod arm 1]
  - 9. `tests/scenarios/release.test.ts`, `tests/scenarios/release-publication.test.ts`, `tests/scenarios/release-reissue.test.ts` and `tests/infra/lease.test.ts` pass unchanged (lease.test.ts:28-33 pins that `claim` renews in place with a new `operation`, :40 the expired report, :101 release and re-acquisition, :122 the locked refusals). [R3] [R8] [dod arm 1]
  - 10. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md state the facts R9 names (reviewer-verified against the diff). [R9]
depends_on: [T0-RELEASE-OP-REISSUE]
budget: 610
tdd: true
diagnosis:
  root_cause: "The environment lease is released in one place, the CLOSE branch of `ReleaseRunner.next` (release-runner.ts:270-281 at 92796d4f), and only for the environment the attempt names at that moment. Every other terminal path returns without a release: STAGE to DONE of a staging target (:198-202) and every STOP. A production attempt claims `env:staging` in STAGE and then switches its `environment` to production at CHECKPOINT, so CLOSE never releases the staging lease either. The lease then expires unreleased; `LeaseStore.claim` answers `expired` to any other session, `next` turns that into STOP `ownership` (:159-161), and no command takes over an environment lease. The one release that exists reads nothing about which attempt holds the lease, and `aidlc release next` on an attempt whose goal is already stopped exits 1, so it cannot serve as a retry."
  repro: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\9050b3d1-5897-4caa-9057-e38858fcf6bf\\scratchpad\\probe4.test.ts P19 (after a production STOP: staging released=false, production released=false); C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-release.test.ts case C (staging DONE: lease released=false; another session's claim after the TTL: expired)."
  same_class: "Every resource lease a runner claims and must give back: the goal lease (`GoalController.releaseGoalLease` at DONE) and card leases (card close and takeover) have their own release paths and cards; the review pool slot is released by the queue. Every terminal return of `ReleaseRunner.next` passes the exit of R1, including those the two sibling cards add."
sweep: "git grep -n \"leases\\.\\|resourceKeys.environment\\|state: 'STOP'\\|transitionRelease(\\|this\\.next(\" -- src/loop/release-runner.ts on main at 92796d4f: :157 the only claim (STAGE, APPLY, RECOVER; operation `release:<id>`): unchanged; :276-277 the only release, in CLOSE: removed (R6); STOP saves at :150 (grace, unresolved: R4), :160 (`ownership`; another session's lease, left by R3), :181, :209, :252, :265, :305, :309 (R1); transitions that can save STOP or DONE at :187, :199, :217, :271, :294 (R1); recursive calls at :190, :206, :220, :232, :298, :328 (step logic, R1); :340 `reportStep` to DONE (R8). src/cli/main.ts:1136-1138 the `release-result` report (R7). git grep -n \"resourceKeys.environment\\|env:\" -- src: lease.ts:183 (the key) and release-runner.ts only. Tests that pin the current behaviour: no release test asserts a lease (git grep -n \"env:staging\\|env:production\\|resourceKeys.environment\" -- tests finds only tests/infra/lease.test.ts:193, the key's lower-casing); tests/infra/lease.test.ts:28-33, :40, :101 and :122 pin the `LeaseStore` methods this card uses through `update` and stay green, since src/coordination/lease.ts is not changed."
forbid: [weakening or skipping a test to go green, releasing a lease while a record that belongs to the attempt is intended, issued, running or UNKNOWN, releasing a lease of another session or host or whose operation names another attempt, deciding a release outside the lease's own update section, a change to src/coordination/lease.ts, editing .aidlc state by hand]
non_goals: [a command that takes over an expired environment lease of another session, releasing the staging lease when a production attempt leaves STAGE for CHECKPOINT (it stays held until the attempt is terminal), renewing environment leases while an attempt waits at CHECKPOINT or OBSERVE, a `release-result` reported by hand with `aidlc report`, the `disposition` `pending` that the ownership STOP (:160) and the publication STOP (:309) leave, leases left by attempts that were terminal before this card (their owner session releases them with `aidlc release next <attemptId>`), `.claude/skills/aidlc-loop/release.md` (4494 of its 4500 bytes)]
hygiene: "Line numbers are from main at 92796d4f; read them again at PREPARE. Insert the CHANGELOG entry directly above the entry that begins `- T0-SCAN-SETUP-STEP-2`, followed by a blank line, not at the top of Unreleased: cards running in parallel insert at other anchors so that their merges do not conflict. T0-RELEASE-OP-REISSUE, the earlier card of this list, merges first into the same files (src/loop/release-runner.ts, docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md); R2 reuses its association predicate, so call the same function rather than restating it. The lease section of R3 uses the existing public `LeaseStore.update`, so src/coordination/lease.ts and tests/infra/lease.test.ts stay out of allow_paths. Act as another session in a test with `LeaseStore.claim(key, { actor: actorB, now })` from tests/scenarios/_harness.ts, never by changing the process session; the CLI test of acceptance 8 sets `AIDLC_SESSION` for its child process and writes the lease for that session and `os.hostname()`. Give fabricated ledger records distinct `intentRecordedAt` values. Before the first R3, revert each source hunk in a scratch copy and run the tests of its requirement (lesson 2026-11-11 T0-AUDIT-FIXES). Neither changed source file is in the verify-card-run-writes coverage record."
doc_sync: docs/OPERATIONS.md (Standalone release), docs/ARCHITECTURE.md (release state machine), CHANGELOG.md
---

# T0-STAGING-LEASE-RELEASE

## Deliverable
`aidlc release next` releases the environment leases an attempt claimed when the attempt ends (`DONE` or `STOP`) with no operation of it intended, issued, running or UNKNOWN, checking in the lease's own lock section that the lease is still this session's lease for this attempt. A STOP that leaves such an operation keeps the leases, so no other session deploys to an environment whose last change is not known. A failed release is named with the command that retries it, and that command exits 0 on a stopped goal.

## Why
Audit of 2026-11-11, item F5, confirmed by two models; card reviewed by two more on 2026-11-11 and amended to the planner's rulings. A staging goal that ends STAGE to DONE keeps `env:staging`, and so does every STOP and every production attempt. After the 10-minute TTL every other session's release of that environment stops with `ownership`, and no command takes the lease over. A blanket release on STOP is unsafe: a STOP for time after the reconciliation grace leaves an operation whose outcome is not known.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/release-lease.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts tests/infra/lease.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; the four existing files pass unchanged.

## Attempt evidence

Attempt 1 (effort high), base `6b506343`.

RED commit `76133640` (the test file alone, sources of main): 8 tests, 0 pass, 8 fail. First failing assertion per test:

| Test | First failing assertion on main |
|---|---|
| 1 staging DONE | `fx.leases.claim(env:staging, actorB)` after the TTL: `'expired' !== 'acquired'` (main leaves the lease unreleased) |
| 2 production delivered | `{ staging: false, production: true }` vs `{ staging: true, production: true }` (main releases only `env:production` at CLOSE) |
| 3 every terminal path | `failed staging deploy`: `false !== true` (STOP release-health leaves `env:staging` held) |
| 4 unresolved keeps | `a terminal attempt with no ledger record`: `false !== true`; every unresolved case before it passes on main |
| 5 own lease only | `no operation`: `released: true` vs `released: false` (main's CLOSE releases it) |
| 6 renewal race | `the renewal for another attempt landed after the attempt was saved DONE` (no lease section runs after DONE on main) |
| 7 cleanup fails | narration `Release delivered to production; final state for production is OBSERVE.` lacks `env:staging` |
| 8 CLI twice | second run: `aidlc: goal ... is terminal (STOP); ...`, `1 !== 0` |

Commit `5535c09d` corrects the test helper `hold` to return the lease as read from the store: `claim` returns `operation: undefined` as a key, which the stored record omits, so test 5 compared unequal for that reason too; after the correction test 5 still fails on main at `released: true` vs `released: false` (checked by running it against the sources of main). The GREEN commit adds the cases the revert check asked for (below) and the input-class cases.

Two statements of the card that the tests cannot meet as written, reported, not worked around:
- Acceptance 4 says "Passes" (on main), but it also requires "A terminal attempt with no ledger record at all releases", which main does not do; every other case of item 4 passes on main.
- Acceptance 6 says it "passes on main only because main releases nothing at DONE". The renewal is made by the lease store wrapper inside the first `env:staging` section that runs after the attempt is saved terminal; main runs no lease section after DONE, so the renewal never happens and the assertion that it landed (and the `operation` assertion after it) fails on main. The test does fail against the read-then-`LeaseStore.release` variant (revert row M12).

Reading of the card: R5 names a lease section that throws. A ledger that cannot be read (a malformed record under `operations/`) is read before any lease section; the exit then keeps every lease (R2 cannot show that no unresolved record exists, and `forbid` bars releasing while one may) and gives the narration of R5 with `operation ledger`, the store error and `aidlc release next <attemptId>`, instead of throwing out of `next` for an attempt that is already terminal. Test 7, last case.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/release-lease.test.ts` "a staging attempt that ends in DONE releases env:staging, and another session then acquires it" | pass; fails on main |
| 2 | same file, "a delivered production attempt releases the staging and the production lease it claimed" (also: `env:staging` held at CHECKPOINT, both held at OBSERVE) | pass; fails on main |
| 3 | same file, "every terminal path passes the one exit": failed staging deploy, publishing deploy without production authority, ownership STOP at APPLY (own `env:staging` released, other session's `env:production` deep-equal to before), stored STOP, stored DONE | pass; fails on main |
| 4 | same file, "an attempt with an unresolved operation keeps its leases": 4 statuses x 3 associations (`releaseAttempt`, key only, key with another attempt's `releaseAttempt`) x stored STOP and DONE; UNKNOWN past the grace gives STOP `time` with the lease held, twice; no record releases | pass; the no-record case fails on main |
| 5 | same file, "only the attempt's own lease of this session and host is released": stored CLOSE production attempt with each lease class; unchanged leases are not written (file modification time kept); `Staging`; key-only record target | pass; fails on main |
| 6 | same file, "a renewal for another attempt that lands before the cleanup takes the lock keeps the lease" | pass; fails on main (see above) |
| 7 | same file, "a lease cleanup that fails leaves the attempt terminal, releases the other leases and names the command that retries it": throw once for `env:staging`, then retry; a nested STOP named once; malformed file; file that is not a lease; held lock (`LOCKED`, `timeoutMs` 50) then retry; unreadable ledger | pass; fails on main |
| 8 | same file, "aidlc release next run twice on a stopped attempt exits 0 both times" | pass; fails on main |
| 9 | `tests/scenarios/release.test.ts`, `release-publication.test.ts`, `release-reissue.test.ts`, `tests/infra/lease.test.ts`, unchanged | pass (DoD) |
| 10 | docs/OPERATIONS.md (Standalone release, paragraph after the `aidlc ops reconcile` paragraph), docs/ARCHITECTURE.md (paragraph after the `finalStateForTarget` paragraph below the release diagram), CHANGELOG.md (Unreleased, directly above `- T0-SCAN-SETUP-STEP-2`) | for the reviewer |

Per-hunk revert check (each hunk reverted alone in the worktree, `node --test tests/scenarios/release-lease.test.ts`, restored):

| Hunk (requirement) | Reverted to | Test and first failing assertion | Result |
|---|---|---|---|
| M1 exit in public `next` (R1) | `return this.step(goal, attempt)` | all 8 tests, e.g. test 1 `'expired' !== 'acquired'` | red, 8 of 8 |
| M2 nested steps call the step logic (R1) | the seven nested calls go through `next` | test 7 `a nested STOP is cleaned up at the exit alone` (the inner exit's failure was retried by the outer one) | red |
| M3 exit acts on DONE or STOP only (R1, R2) | the state check removed | test 2 `env:staging stays held while the attempt waits at CHECKPOINT` | red |
| M4 unreadable ledger keeps the leases (R4 reading) | the error rethrown | test 7 `MALFORMED_JSON ... op-unreadable.json` thrown | red |
| M5 unresolved record keeps the leases (R2, R4) | the check removed | test 4 `intended, releaseAttempt, STOP` | red |
| M6a lease not released (R3) | condition removed | test 5 `released: not written` (modification time changed) | red |
| M6b `operation` is `release:<attemptId>` (R3) | condition removed | test 5 `no operation`; test 6 deep-equal (lease released) | red |
| M6c owner session (R3) | condition removed | test 5 `another session` | red |
| M6d owner host (R3) | condition removed | test 5 `this session on another host` | red |
| M7 keys from the records' `target` (R3) | attempt environment only | tests 2, 3 (`ownership stop at APPLY: own env:staging`), 5 (`the target of a record that belongs by its key`), 7 | red |
| M7b key by `resourceKeys.environment` (R3) | `` `env:${name}` `` | test 5 `environment Staging is named by the key env:staging` (the lease file name is case-insensitive, so the key text is the observable) | red |
| M8 a failed section does not stop the other keys (R5) | the error rethrown | tests 5 and 7 (`lease section unavailable` thrown) | red |
| M9 failure named with the retry command (R5) | `return out` | tests 5 and 7 (narration without `env:staging`) | red |
| M10 CLOSE release removed (R6) | the main CLOSE block restored | test 5 `no operation` (`released: true`) | red |
| M11 report only for a goal that is not terminal (R7) | condition removed | test 8, second run `goal ... is terminal (STOP)`, `1 !== 0` | red |
| M12 variant: read the lease, then `LeaseStore.release` (R3, acceptance 6) | the section replaced by `read` + `release(key, generation)` | test 6 deep-equal (the renewed lease was released) | red |

Every row is red. The input-class cases added after this run (a `succeeded`, `failed` or `cancelled` record releases, an unresolved record that does not belong releases, an `operation` of the attempt id with a suffix is kept, no environment and no record names nothing) guard against a widened predicate (a terminal status in the unresolved list, an association without `releaseOperationOf`, a prefix match on `operation`), not against a removed hunk.

Input classes of the new predicates:

| Predicate | Class | Test |
|---|---|---|
| exit applies (state) | DONE, STOP | 3 (stored STOP and DONE, nested STOPs), 1, 2 |
| | a non-terminal return (CHECKPOINT, OBSERVE) | 2 (leases held) |
| unresolved record | `intended`, `issued`, `running`, `UNKNOWN` | 4 |
| | `succeeded`, `failed`, `cancelled` | 4 (terminal statuses release) |
| | belongs by `releaseAttempt`; by key with `releaseAttempt` absent; by key with another attempt's | 4 |
| | an unresolved record that does not belong (another attempt, no key) | 4 (releases) |
| | no record | 4 |
| | ledger unreadable | 7 |
| lease is the attempt's own (`mine`) | absent; released; no `operation`; `release:<other attempt>`; `release:<attemptId>` plus a suffix | 5 |
| | another session; this session on another host; expired of this session | 5 |
| keys | attempt environment; record target by `releaseAttempt`; record target by key only; `Staging` lower-cased; duplicate key once | 2, 3, 5, 7 |
| | no environment and no record | 5 |
| report to the goal (R7) | goal not terminal; goal terminal | 8 |

Doc-reading run (Windows): the 78 test files that `grep -rlE "ARCHITECTURE\.md|OPERATIONS\.md|CHANGELOG\.md" tests --include=*.test.ts` lists, in one `node --test` call on the final docs: 1863 tests, 1851 pass, 0 fail, 12 skipped, exit 0. The ARCHITECTURE.md sentence is a paragraph of its own after the `finalStateForTarget` paragraph, outside the `src/coordination/` paragraph that tests/scenarios/op-intent-dup.test.ts:355 pins.

DoD (`npm run typecheck && node --test tests/scenarios/release-lease.test.ts tests/scenarios/release.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/release-reissue.test.ts tests/infra/lease.test.ts`, Windows): exit 0; `tsc -p tsconfig.test.json --noEmit` clean; `# tests 49`, `# pass 49`, `# fail 0`, `# skipped 0` (8 tests in the new file, 41 in the four existing files).

Coordinator verification:
- At 5342036f, before the review, run by the coordinator. Linux (WSL Ubuntu, Node v22.23.4), the test files this branch adds or changes (tests/scenarios/release-lease.test.ts): tests 8, pass 8, fail 0, skipped 0.
- Windows, docpins: 78 test files reading 3 changed documents: # tests 1863 # pass 1850 # fail 1 docpins: tests/infra/exec.test.ts failed in the parallel run and passes alone (# pass 61): load
- The `dod_command` is rerun by the coordinator on the commit that adds these lines; its receipt is recorded on the attempt.
