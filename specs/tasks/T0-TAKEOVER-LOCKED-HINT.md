---
id: T0-TAKEOVER-LOCKED-HINT
title: A card takeover that meets a held lock after its lease write names the generation it took and the command that goes on from there, instead of a bare LOCKED (issue 87 item 3)
status: todo
branch: T0-TAKEOVER-LOCKED-HINT
worktree: D:\wt\AIDLC\T0-TAKEOVER-LOCKED-HINT
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/two-windows.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-TAKEOVER-LOCKED-HINT.md
dod_command: npm run typecheck && node --test tests/scenarios/two-windows.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the run update of `CardRunner.takeover` (the `updateCardRun` after the lease write) refuses with `LOCKED`, the takeover shall throw a `StoreError` with the code `LOCKED` whose message names the card, the lease generation the takeover acquired, the refusal it met, and that running `aidlc card takeover <card> --goal <goal>` again completes it.
  - R2. WHEN the takeover's assessment, after the run update landed (its lease renewal and its saves), refuses with `LOCKED`, the takeover shall throw a `StoreError` with the code `LOCKED` whose message says the run carries the acquired generation, gives the refusal it met, and names `aidlc card next <card> --goal <goal>`.
  - R3. `docs/OPERATIONS.md` (the Sessions section) and the CHANGELOG Unreleased section shall state R1 and R2.
acceptance:
  - 1. `tests/scenarios/two-windows.test.ts`: with the lease lock held by another live writer when the takeover's run update takes it, the takeover throws a `StoreError` with the code `LOCKED` whose message names the card, the acquired generation, the refusal and `aidlc card takeover <card> --goal <goal>`; the lease carries the new generation and the run does not; once the lock is gone, the same command completes the takeover (completed, the run carries the generation, one `LEASE_ACQUIRED` for it). [R1] [dod arm 1]
  - 2. The same file: with the lease lock held by another live writer when the assessment first takes it (its lease renewal) and, in a second run, when it takes it next (a save), the takeover throws a `StoreError` with the code `LOCKED` whose message names the generation the run carries, the refusal and `aidlc card next <card> --goal <goal>`; the run carries the generation in both. [R2] [dod arm 1]
  - 3. The same file reads the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section, and fails with either removed; `tests/surface/prose.test.ts` still passes (the Sessions section stays under its byte limit). [R3] [dod arm 1]
depends_on: []
budget: 140
tdd: true
sweep: "grep -n 'updateCardRun|saveHolding' src/loop/card-runner.ts gives the takeover's run update (about line 710) and the assessment (about lines 718-720: its lease renewal and its saves), the only lock takers after the lease write. The lease section's own LOCKED (before the lease write) writes nothing and keeps its plain message."
forbid: [editing src/loop/card-runner.ts outside lines 690-730 and its store import at line 36, changing any lock or lease behaviour, turning an error other than LOCKED into these messages, editing the LOCK_SESSIONS or RECOVERY sentences of docs/OPERATIONS.md or tests/surface/prose.test.ts]
non_goals: ["the stack trace the CLI prints for an uncaught error (src/cli/main.ts): the message is what changes", "a LOCKED in the lease section before the lease write: nothing is written, and the store's own message (run the command again) is right", "retrying the run update automatically"]
hygiene: "Issue 87 item 3, second half; items 1, 2 and the first half of 3 are T1-STORE-CAS-2 acceptance 14, 15 and 11 (comment on issue 87). Coordination: aidlc-a6's T1-AUDIT-FACTS edits card-runner.ts lines 21, 464, 551, 570, 625, 2308, 2312 and 2509; this card's hunks are lines 690-730, clear of 615-640, and the store import at line 36 (StoreError, to keep the LOCKED code). The Sessions section must stay under 13701 bytes (prose acceptance 8 of T1-STORE-CAS-2): it is 13581 on main, so the added sentence is short. Mutation sweep before the first review (docs/LESSONS.md 2026-09-24); every property of an acceptance item asserted on every case (docs/LESSONS.md 2026-09-26 T0-SHIP-MERGE-REFUSED)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-TAKEOVER-LOCKED-HINT

## Deliverable
A takeover that meets a held lock after its lease write tells the actor where it stands: the generation it took, and whether running the takeover again or `card next` goes on from there.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/two-windows.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
