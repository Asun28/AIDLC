---
id: T1-STORE-CAS
title: One locked read-modify-write primitive in the state store carries every lease and card-run write and the takeover's ledger check, replacing the card-run store's own lock and the takeover's re-read workarounds, with fewer src lines and a shorter Sessions section
status: todo
branch: T1-STORE-CAS
worktree: D:\wt\AIDLC\T1-STORE-CAS
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/state/store.ts
  - src/state/goal-store.ts
  - src/coordination/lease.ts
  - src/coordination/reconcile.ts
  - src/loop/card-runner.ts
  - src/core/review-policy.ts
  - src/state/journal.ts
  - tests/infra/update-json.test.ts
  - tests/infra/store.test.ts
  - tests/infra/goal-store.test.ts
  - tests/infra/lease.test.ts
  - tests/infra/journal.test.ts
  - tests/infra/reconcile.test.ts
  - tests/scenarios/two-windows.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/r3-fallback.test.ts
  - tests/surface/prose.test.ts
  - tests/surface/templates.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - README.md
  - CHANGELOG.md
  - specs/tasks/T1-STORE-CAS.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. `src/state/store.ts` shall provide one primitive, `updateJson`, that hands a change function the stored record under an exclusive-create lock and writes nothing when the function returns the record unchanged or throws.
  - R2. Every lease write (claim, takeover, heartbeat, release) and every card-run write shall go through `updateJson`.
  - R3. WHILE a takeover holds a card's lease lock, a ship intent for that card shall be refused.
  - R4. Lease claim statuses, generation rules and `FencedError` messages shall stay as callers see them today.
  - R5. The candidate shall remove more src/ lines than it adds, tests excluded, and shall leave the Sessions section of `docs/OPERATIONS.md` and the README Multi-session paragraph shorter in bytes.
acceptance:
  - 1. `updateJson` on a record held by a live `<file>.lock` refuses with `StoreError` `LOCKED` and leaves the record byte-identical; a change function that throws or returns the record unchanged writes nothing; a stale lock whose owner process is gone is taken over as today (tests/infra/update-json.test.ts). [R1] [dod arm 1]
  - 2. A test reads every src/ file and finds exclusive create (`'wx'`), `sleepSync` and `Atomics.wait` only in `src/state/store.ts` (the ship's CI poll sleep excepted by name), and no `mergeFindings` (tests/infra/update-json.test.ts). [R1] [R2] [dod arm 1]
  - 3. With a live lease lock, claim, takeover, heartbeat and release each refuse with a `locked` message and leave the lease record byte-identical (tests/infra/lease.test.ts). [R2] [dod arm 1]
  - 4. A ship intent attempted while a takeover holds the lease lock is refused; an intent recorded before the takeover makes the takeover refuse and name its id; a ship after the takeover is fenced and records no intent (tests/scenarios/two-windows.test.ts). [R3] [dod arm 1]
  - 5. A stop saved between the takeover's run read and its run update survives the takeover, and an old owner's review commit after the takeover is fenced (tests/scenarios/two-windows.test.ts). [R2] [dod arm 1]
  - 6. Two completions of one takeover generation journal exactly one `LEASE_ACQUIRED` (tests/scenarios/two-windows.test.ts). [R2] [dod arm 1]
  - 7. Every existing lease test passes with its assertions unchanged: claim statuses, generation advance and `FencedError` messages (tests/infra/lease.test.ts). [R4] [dod arm 1]
  - 8. The Sessions section of `docs/OPERATIONS.md` and the README Multi-session paragraph are shorter in bytes than on the base, contain neither `compare-and-set` nor `four windows`, and state in one sentence each what the lock covers and what stays unfenced (`recordAttempt`, a raw `card report` patch, goal, release and review-pool records, a crash between the lease write and the run update); a test reads each sentence and compares the byte counts with the base recorded in the test (tests/surface/prose.test.ts). [R5] [dod arm 1]
  - 9. `git diff --numstat origin/main...HEAD -- src` sums to fewer added than deleted lines; the close-out states the delta and the Sessions byte counts before and after. [R5]
  - 10. `CHANGELOG.md` Unreleased carries the entry under this card id; `docs/ARCHITECTURE.md` keeps the phrase `written under \`<file>.lock\`` that templates.test.ts reads; a test reads the entry (tests/surface/prose.test.ts). [R1] [dod arm 1]
depends_on: [T1-PARSE-GUARD]
budget: 800
tdd: true
sweep: "Survey of main at 5983a1e. Temp file + rename store.ts:45-81; interrupted-write cleanup store.ts:105-124 and goal-store.ts:175-185; createExclusive store.ts:126-147; the card-run lock (timeout loop, sleepSync, owner check on write and release, .takeover marker, pid liveness) goal-store.ts:11-32, 84-149, 188-227, about 110 lines; revision compare-and-set goal-store.ts:63-78; mergeFindings review-policy.ts:472-485 (dead under the revision check); lease claim, takeover, heartbeat, release lease.ts:56-128 (read then blind write, wx only on first acquire 70-74), fence lease.ts:131-137; takeover workarounds card-runner.ts:154-160, 674-680, 689-737, 710-715, 728-732; fences inside the run lock card-runner.ts:1452-1461, 1885-1904, 1983-1993; ship fence outside any lock card-runner.ts:905-919; journal append journal.ts:127-145 (no lock); op records reconcile.ts:109-114. Interleaving tests that model windows the lock removes: two-windows.test.ts:587 and :731. Estimated src net about -45."
forbid: [git update-ref or any git object as state, SQLite, a new store or state directory, a lease or fencing behaviour change seen by callers, a new Node file lock over a file whose writer a lease already fences (docs/LESSONS.md 2026-09-14 T1-LOOP-LESSONS), shipping a candidate whose src/ net is 0 or above]
non_goals: [fencing recordAttempt or card report, locking goal, release or review-pool records, locking across hosts, deleting staleLedger (its entry naming in CARD_RUN_STALE is a feature)]
hygiene: "Lesson 2026-09-15 T0-CARD-TAKEOVER-2: state every remaining window and its recovery in the first candidate, never one window per review round. Lock order is run, then lease; no run lock is taken inside a lease section. On Windows an exclusive create can fail with EPERM while a lock is being deleted; treat it as busy."
doc_sync: docs/OPERATIONS.md (Sessions), README.md (Multi-session), docs/ARCHITECTURE.md (state paragraph), CHANGELOG.md
---

# T1-STORE-CAS

## Deliverable
`updateJson` in `src/state/store.ts` is the one read-modify-write primitive: an exclusive-create lock per record, the change function sees the stored record, nothing is written on refusal. Lease writes, card-run writes and the takeover's operation check go through it; the card-run store's own lock code, the takeover's double read and late-operation check and `mergeFindings` are deleted. The Sessions text loses the windows the lock closes and states in one sentence what stays unfenced.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.
