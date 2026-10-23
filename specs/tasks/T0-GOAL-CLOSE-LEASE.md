---
id: T0-GOAL-CLOSE-LEASE
title: The session that closes a goal settles the goal lease before DONE is saved, releasing its own lease or taking over and releasing a lease another session left to expire, so goal close never throws FencedError after DONE and always writes the board and returns the done directive
status: todo
branch: T0-GOAL-CLOSE-LEASE
worktree: D:\wt\AIDLC\T0-GOAL-CLOSE-LEASE
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/two-windows.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-GOAL-CLOSE-LEASE.md
dod_command: npm run typecheck && node --test tests/scenarios/two-windows.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/amendment.test.ts tests/scenarios/audit.test.ts tests/surface/verifier.test.ts tests/infra/lease.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc next` (or a `report` that ends in it) closes a goal whose goal lease is held by another session and has expired, the controller shall take the lease over, only while no operation of the goal is unresolved, journal one `GOAL_TAKEOVER` naming the new lease generation and the previous owner, and release the lease, all before the goal is saved DONE; the goal then reaches DONE, the board is written and the directive is `done`.
  - R2. WHEN the closing session owns the goal lease, the controller shall release it at its generation with no takeover and no `GOAL_TAKEOVER`, as before.
  - R3. WHEN the goal lease is absent or already released at close, the controller shall write no lease record and journal no lease event.
  - R4. IF settling the goal lease fails (a takeover refused), THEN the goal shall stay in CLOSE with nothing saved, journaled or released for DONE, so no DONE goal is left without its board and directive.
acceptance:
  - 1. In tests/scenarios/two-windows.test.ts, a goal created by win-A whose card is DONE, with the clock past the lease TTL, closed by win-B through `GoalController.report` with result `arc-verified` (the controller call `aidlc report` makes): the directive is `done`, the goal is DONE, the board file says `**State**: DONE`, the goal lease is owned by win-B at generation 1 and released, and the journal holds one `GOAL_TAKEOVER` with `previousOwner` win-A, before `GOAL_DONE`. At main this test throws `fenced: ...: cannot release a lease you do not own`. [R1] [dod arm 2]
  - 2. The same flow closed by win-A, the intake session: the lease stays win-A's at generation 0 and is released, and no `GOAL_TAKEOVER` is journaled. [R2] [dod arm 2]
  - 3. A goal whose lease record was released before close reaches DONE with the lease record unchanged and no `GOAL_TAKEOVER`. [R3] [dod arm 2]
  - 4. A goal in CLOSE whose expired foreign lease cannot be taken over (an operation of the goal recorded after the closing `next` passed its reconcile check: the test records its intent from a wrapped `LeaseStore.takeover` just before the real takeover reads the ledger) throws, and the goal stays CLOSE with no `GOAL_DONE` and the lease unchanged. [R4] [dod arm 2]
  - 5. `npm run typecheck` is clean [dod arm 1], and tests/scenarios/goal-close-stages, t0-flow, amendment and audit, tests/surface/verifier and tests/infra/lease pass [dod arm 2]; reviewer-verified from the diff: none of those six files changes. [R1] [R2]
  - 6. docs/OPERATIONS.md (Sessions, the second-window paragraph) and docs/ARCHITECTURE.md (`src/state/` paragraph, the goal takeover sentence) state that the closing session settles the goal lease before DONE; CHANGELOG.md Unreleased carries the entry under this card id. [R1] [R2]
depends_on: []
budget: 60
tdd: true
sweep: "grep -rn 'leases.release' src/: controller.ts nextInClose is the only release that is not guarded; card-runner.ts (card close) and release-runner.ts (environment lease) already catch a release of a lease they do not own"
forbid: [a change to LeaseStore (release, takeover, fence or the owner check), a catch that hides a release failure after DONE is saved, a heartbeat or renewal of the goal lease during the goal, a change to the ownership wait in next()]
non_goals: [renewing the goal lease while a goal runs, the expired lease already left on g-20261019092137-6fcee2 (terminal; no state is edited by hand), the R2 advisory on recordReviewOutcome, the base-sync R3 prompt maxRounds]
diagnosis:
  root_cause: "`nextInClose` saves DONE and appends `GOAL_DONE`, then calls `LeaseStore.release` for the goal lease with whatever generation it reads, as whichever session is closing. `release` refuses a lease the caller does not own (FencedError). Only `createGoal` claims the goal lease and nothing renews it, so it expires 10 minutes after intake, and `next()` admits any session once it has expired (the ownership step waits only on a live foreign lease). A goal finished by a session other than the intake session therefore threw after DONE was saved: the board write and the `done` directive were skipped and the lease stayed unreleased. Seen on g-20261019092137-6fcee2 (intake session d6f00256, closed by 04aaedc9)."
  same_class: "The other two `leases.release` calls in src/ (card-runner.ts card close, release-runner.ts environment lease) wrap the release in a try/catch for a lease they do not own; the card close also takes over an expired card lease first. No other site releases a lease it did not claim unguarded (sweep)."
doc_sync: docs/OPERATIONS.md (Sessions), docs/ARCHITECTURE.md (src/state/ paragraph), CHANGELOG.md
---

# T0-GOAL-CLOSE-LEASE

## Deliverable
`GoalController.nextInClose` (src/loop/controller.ts) settles the goal lease before the goal is saved DONE. The closing session's own lease is released at its generation, as before. A lease another session left to expire, the only foreign lease `next()` lets a session close under, is taken over after the goal's operations are reconciled, journaled as `GOAL_TAKEOVER` with the previous owner, and released. An absent or released lease is left as it is. A refused takeover throws before anything is saved, so the goal stays CLOSE. DONE, `GOAL_DONE`, the board and the `done` directive therefore always come together. Until now a goal closed by a session other than the intake session threw FencedError after DONE was saved. docs/OPERATIONS.md, docs/ARCHITECTURE.md and CHANGELOG.md state the rule.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/two-windows.test.ts tests/scenarios/goal-close-stages.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/amendment.test.ts tests/scenarios/audit.test.ts tests/surface/verifier.test.ts tests/infra/lease.test.ts
```
- Expected exit code: 0
- Assertion: typecheck is clean; the four close cases pass (foreign expired lease taken over and released, own lease released, released lease untouched, refused takeover leaves the goal CLOSE), and the existing goal-close, T0 flow, amendment, audit, verifier and lease tests pass.
