---
id: T0-CARD-TAKEOVER
title: The card takeover command takes the expired card lease of another session once its operations are reconciled, fences the old owner, records the new generation on the run (a run interrupted inside PREPARE included) and selects the card state again, so a card of an ended session continues in the new session instead of under the old identity (the follow-up T0-SESSION-IDENTITY-3 deferred)
status: todo
branch: T0-CARD-TAKEOVER
worktree: C:\wt\T0-CARD-TAKEOVER
allow_paths:
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/two-windows.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - docs/REQUIREMENTS-TRACEABILITY.md
  - README.md
  - CHANGELOG.md
  - specs/tasks/T0-CARD-TAKEOVER.md
dod_command: npm run typecheck && node --test tests/scenarios/two-windows.test.ts tests/scenarios/t0-flow.test.ts tests/infra/lease.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the card lease of another session has expired and no delivery operation of the card is unresolved, `aidlc card takeover <card>` shall take the lease at the next generation and shall record that generation on the card run.
  - R2. WHEN the lease record is missing, released or owned by the acting session, WHEN the lease of another session is live, or WHEN an operation of the card is unresolved, the takeover shall refuse and shall write nothing.
  - R3. After a takeover, a write of the previous owner at the previous generation shall be fenced.
  - R4. After a takeover, the card run shall carry the state selected from the persisted evidence, with an ownership stop cleared and any other stop kept as the owner's own `card next` keeps it.
  - R5. The changed documents shall describe the takeover with its preconditions, its refusals and the goal-level resume that follows when the goal stopped on the card's ownership stop.
acceptance:
  - 1. `CardRunner.takeover(goal, card, run)` takes the card lease through `LeaseStore.takeover` once the lease of another session has expired and `ops.unresolved(goal, card)` is empty: the generation advances by one, the owner is the acting session, the operation is `card:<id>`, the run is saved with `ownerGeneration` equal to the new generation, and the journal carries `LEASE_ACQUIRED` with `takeover: true`, `previousOwner` and `previousGeneration`; the previous owner's `fence` at the old generation throws `FencedError`, its `next` stops for ownership and leaves the lease with the new owner, and the new owner's following `next` revalidates that stop and continues (two-windows.test.ts "prepared"). [R1] [R3] [dod arm 1]
  - 2. Each refusal throws, names its cause and writes nothing (the run record and the lease record are equal before and after): no lease record; a released lease; a lease this session owns; a live lease of another session (the store's message: expiry alone does not prove the owner stopped); an unresolved operation of the card, named by id (two-windows.test.ts "prepared", "refusals"). [R2] [dod arm 1]
  - 3. After the takeover the run carries the state that `card next` selects from the persisted evidence, through the evidence gathering `next` and `takeover` share: a run PREPARE completed resumes at its state with the ownership stop cleared by the same renewal that revalidates an owner's expired lease (journal `LEASE_RENEWED` with `revalidated`), and the new owner's `next` continues it; a run interrupted between the lease claim and the PREPARE save (no `ownerGeneration`, no worktree) is owned at the new generation, selected as PREPARE, and the new owner's `next` returns the `prepare` directive with the lease renewed at that generation, not re-acquired (two-windows.test.ts "prepared", "unprepared"). [R4] [dod arm 1]
  - 4. `aidlc card takeover <card> [--goal <id>]` runs the takeover on the stored run (no run record is created) and prints the new lease generation, the previous owner and the run state; a refusal exits non-zero with the cause on stderr and leaves both records unchanged (two-windows.test.ts "command"). [R1] [R2] [dod arm 1]
  - 5. A goal that the goal-level `next` stopped on the card's ownership stop dispatches the card again after the card takeover and a resume; the scenario pins that order (two-windows.test.ts "goal stopped"), and `docs/OPERATIONS.md` (Sessions; the STOP reasons row `ownership`), `README.md` (Multi-session), `docs/ARCHITECTURE.md` (state layer), `docs/REQUIREMENTS-TRACEABILITY.md` (MS2, Q23) and the CHANGELOG entry describe the takeover, its preconditions (an expired lease of another session, no unresolved operation of the card, the goal lease untouched), its refusals, the `AIDLC_SESSION` continuation that remains the path while the lease of an ended session is live, and the resume that follows a goal stop; no document still names the command as a follow-up (the sweep grep and the sentences quoted in the ship evidence; prose.test.ts green). [R5] [dod arm 1]
budget: 340
tdd: true
sweep: "grep -rn 'card takeover' src tests docs README.md CHANGELOG.md specs: card-runner.ts:324 (the PREPARE expired-lease stop, now naming the card id), two-windows.test.ts:215 (the unprepared comment, updated), docs/OPERATIONS.md:97, README.md:66, docs/ARCHITECTURE.md:12 and CHANGELOG.md:5 (the follow-up promise, rewritten), specs/tasks/T0-SESSION-IDENTITY-2.md and -3.md (history; unchanged); grep -rn '\.takeover(' src: lease.ts (the primitive), main.ts:288 (goal takeover, the CLI precedent), card-runner.ts:1056 (the CLOSE claim's own takeover, unchanged); grep -n 'ownerGeneration' src/loop/card-runner.ts: claimed at 317, saved at 338 and 342, required equal to the lease generation by the renewal at 199 and by every fence"
non_goals: [taking over the goal lease (aidlc goal takeover does that), changing the lease TTL or LeaseStore.takeover semantics, rewriting or migrating lease records, changing the generic stale-generation stop text of core/card-machine.ts, the CLOSE claim's own takeover path (card-runner.ts:1056; unchanged), a takeover of a live lease (expiry alone never proves the owner stopped), a hook or an automatic takeover]
forbid: [editing .aidlc state by hand, changing LeaseStore fencing or takeover semantics, taking over without reconciliation, copying any part of a lease file into hook output]
hygiene: "The takeover reuses the evidence gathering of `next` (extracted into one method, not duplicated) and the renewal that already revalidates an owner's expired lease, so an ownership stop is cleared by one mechanism. Fixture leases in the CLI-level test expire in 2020 and live until 2126 because the CLI runs on the wall clock. Recovery text is derived from the runner's conditions (session, host, generation, unresolved operations, goal state), per the T0-SESSION-IDENTITY-3 lesson."
doc_sync: docs/OPERATIONS.md (Sessions; STOP reasons row ownership), docs/ARCHITECTURE.md (state layer; coordination), docs/REQUIREMENTS-TRACEABILITY.md (MS2, Q23), README.md (Multi-session), CHANGELOG.md
---

# T0-CARD-TAKEOVER

## Deliverable
The follow-up T0-SESSION-IDENTITY-3 deferred. `CardRunner.takeover(goal, card, run)` takes the card lease of another session once that lease has expired and no delivery operation of the card is unresolved (`LeaseStore.takeover`: the generation advances, the old owner's later writes are fenced), saves the run with the new `ownerGeneration` (a run interrupted between the lease claim and the PREPARE save, which has none, included) and selects the card state again from the persisted evidence through the evidence gathering it shares with `next`, so the ownership stop is cleared by the renewal that already revalidates an owner's expired lease and any other stop stays. A missing, released or own lease, a live lease of another session and an unresolved operation refuse the takeover before anything is written. `aidlc card takeover <card> [--goal <id>]` exposes it; the PREPARE expired-lease stop names the command with the card id. The goal lease is not touched; `aidlc goal takeover` does that.

## Operator procedure (derived from the runner's conditions)
1. `aidlc card status <card> --goal <id>` prints the lease (owner session and host, generation, expiry) and the run's `ownerGeneration`.
2. While the lease is live, the only continuation is the owner identity: `AIDLC_SESSION=<lease.owner.session>` on the same host, when `ownerGeneration` equals `lease.generation`.
3. Once the lease has expired and `aidlc ops list --goal <id>` shows no unresolved operation of the card: `aidlc card takeover <card> --goal <id>`.
4. If the goal-level `aidlc next` stopped the goal on the card's ownership stop meanwhile: `aidlc goal resume <id> --reason "<why>"`.
5. `aidlc card next <card>`: a run PREPARE completed resumes at its state; a run without a worktree starts at PREPARE.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/two-windows.test.ts tests/scenarios/t0-flow.test.ts tests/infra/lease.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts
```
- Expected exit code: 0
- Assertion: the prepared, unprepared, refusals, command and goal-stopped takeover tests pass; the existing two-window, heartbeat, lease, prose and mirror tests stay green.
