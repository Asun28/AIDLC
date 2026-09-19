---
id: T0-LEASE-HEARTBEAT
title: The owner's own `card next` renews the card lease, so a BUILD longer than the 10-minute TTL no longer fences the ship as STOP/ownership
status: merged
branch: T0-LEASE-HEARTBEAT
worktree: D:\wt\AIDLC\T0-LEASE-HEARTBEAT
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-LEASE-HEARTBEAT.md
dod_command: npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/infra/lease.test.ts tests/scenarios/two-windows.test.ts
dod_exit: 0
acceptance:
  - 1. With the fixture clock advanced past the lease TTL between PREPARE and the successful attempt, the owner's `runner.next` returns the `ship` directive, not `stop/ownership` (t0-flow.test.ts "owner heartbeat"). [dod arm 1]
  - 2. A run already stopped with reason `ownership` whose lease is still held by the same session at the same generation is revalidated by `runner.next` and proceeds; a lease held by another session still stops (t0-flow.test.ts, two-windows.test.ts unchanged). [dod arm 1]
  - 3. `docs/OPERATIONS.md` STOP row `ownership` and `CHANGELOG.md` describe the heartbeat and the revalidation. [dod arm 1]
budget: 120
tdd: true
diagnosis:
  root_cause: "CardRunner claims the card lease only in PREPARE (DEFAULT_LEASE_TTL_MS = 10 min) and never heartbeats; ship() then calls fence(), which rejects an expired lease even when the same session still owns it at the same generation. Observed on T0-LOOP-SPEED: PREPARE 19:58Z, attempt 20:11Z, ship 20:12Z -> STOP/ownership 'lease expired; renew or reconcile before mutating'."
  same_class: "GoalController.next already renews the goal lease through claim() on every call (controller.ts:162); the card path lacked the same heartbeat. release() (card-runner.ts:531) checks owner and generation only, so CLOSE was not affected. LeaseStore.claim() treats a same-owner claim as 'renewed', so no lease-store change is needed."
doc_sync: docs/OPERATIONS.md STOP reasons (ownership), CHANGELOG.md
---

# T0-LEASE-HEARTBEAT

## Deliverable
`CardRunner.next` renews (heartbeats) the card lease when the acting session owns it at the run's generation, before selecting the state, and clears a prior `ownership` stop that the renewal revalidates. Expiry alone never proves the owner stopped; only a takeover changes the generation, and that case still stops.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/infra/lease.test.ts tests/scenarios/two-windows.test.ts
```
- Expected exit code: 0
- Assertion: the new t0-flow test ships after an 11-minute BUILD and after a stale same-owner ownership stop; lease and two-window tests unchanged and green.
