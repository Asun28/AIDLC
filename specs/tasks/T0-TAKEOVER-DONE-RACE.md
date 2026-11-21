---
id: T0-TAKEOVER-DONE-RACE
title: "aidlc goal takeover and aidlc card takeover decide DONE inside the goal lease section, and goal close saves DONE inside that section, so a DONE saved by another session after the takeover's goal read leaves no lease and no journal event (issue 387)"
status: merged
branch: T0-TAKEOVER-DONE-RACE
allow_paths:
  - src/loop/controller.ts
  - src/cli/main.ts
  - src/state/store.ts
  - src/coordination/lease.ts
  - tests/scenarios/takeover-done-race.test.ts
  - tests/scenarios/takeover-done-race.preload.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-TAKEOVER-DONE-RACE.md
  - specs/tasks/T0-TAKEOVER-DONE-RACE.md
dod_command: npm run typecheck && node --test tests/scenarios/takeover-done-race.test.ts tests/scenarios/takeover-done-goal.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/two-windows.test.ts
dod_exit: 0
requirements:
  - R1. Goal close (`GoalController`, the CLOSE to DONE step at src/loop/controller.ts, `releaseGoalLease` and the `saveGoal` that follows it) shall save the DONE goal record while it holds the goal lease lock, in the same `LeaseStore.update` section that releases the session's own lease; where the close neither takes nor releases the lease (absent lease, lease already released), it shall still save DONE inside one `LeaseStore.update` section on the goal lease key that returns the record unchanged. `GOAL_DONE` is journaled after that section, as today.
  - R2. `aidlc goal takeover <id>` shall make its one goal read (one `GoalStore.getGoal`, as T0-TAKEOVER-DONE-GOAL-2 R1 counts it) inside one `LeaseStore.update` section on the goal lease key, the section in which goal close saves DONE; on a goal that is not DONE the section writes what `LeaseStore.takeover` writes (the successor after the reconciliation check), and on a DONE goal it writes no lease, appends no journal event, prints the text of `doneGoalTakeover` for that goal and exits 0, as T0-TAKEOVER-DONE-GOAL-2 R1 does.
  - R3. `aidlc card takeover <card>`, with and without `--goal`, shall run `CardRunner.takeover` inside one `LeaseStore.update` section on the resolved goal's lease key that returns the goal lease record unchanged; inside it, before `CardRunner.takeover`, it re-reads the goal record and, if it is `DONE`, writes no card lease, card run or journal event, prints the T0-TAKEOVER-DONE-GOAL-2 R2 output for that goal and exits 0.
  - R4. Every code path that holds the goal lease lock together with the card-run lock or the card lease lock shall take the goal lease lock first; the `updateJson` doc comment in src/state/store.ts states that order.
  - R5. WHEN the goal is in any state other than DONE, `STOP` included, both takeovers shall take over as before this card, leaving the goal lease record byte-identical after a card takeover.
  - R6. `docs/OPERATIONS.md` (the terminal-goal paragraph after the STOP reasons table, which now cites issue 387 as not caught) and `changelog.d/T0-TAKEOVER-DONE-RACE.md` shall state R1 to R3 and R5, and `docs/ARCHITECTURE.md` states R4 where it describes leases if it names a lock order.
acceptance:
  - 1. `tests/scenarios/takeover-done-race.test.ts`, the CLI from the sources with `--import tests/scenarios/takeover-done-race.preload.ts`, on a RUN goal whose goal lease, held by another session, has expired: (a) the preload records, for each `getGoal` and `listGoals`, whether `<goal lease file>.lock` exists, and `goal takeover <id>` makes its one goal read with the lock present; (b) with the preload saving the goal DONE (terminal) through the real `GoalStore` right before that read, the command exits 0 with the JSON report `{ goalId, state: 'DONE', takenOver: false, detail }` and every lease file and goal journal is byte-identical. (a) fails on main at 67a7e760. [R2] [dod arm 1]
  - 2. Same file and preload: `card takeover <card> --goal <id>` and `card takeover <card>` each exit 0 with the JSON report `{ cardId, goalId, state: 'DONE', takenOver: false, detail }`, and every lease file, the card run file and every goal journal is byte-identical. Fails on main at 67a7e760. [R3] [dod arm 1]
  - 3. Same file: goal close on a goal with a held own lease, with an expired foreign lease and with no lease saves the DONE record while `<goal lease file>.lock` exists (a `GoalStore.saveGoal` wrapper records whether the lock file exists when the DONE record is saved); fails on main at 67a7e760 for the held and foreign cases. [R1] [dod arm 1]
  - 4. Same file, without the preload: on a RUN goal both takeovers advance the lease generation as before, and the goal lease file is byte-identical after `card takeover`. [R5] [dod arm 1]
  - 5. `tests/scenarios/takeover-done-goal.test.ts`, `tests/scenarios/card-terminal-goal.test.ts`, `tests/scenarios/t0-flow.test.ts` and `tests/scenarios/two-windows.test.ts` pass unchanged. [R1] [R5] [dod arm 1]
  - 6. The docs, the `updateJson` comment and the changelog fragment state R1 to R6 (reviewer-verified against the diff). [R4] [R6]
depends_on: []
budget: 250
tdd: true
diagnosis:
  root_cause: "Goal close settles the goal lease in `releaseGoalLease` (src/loop/controller.ts:506) and saves DONE afterwards (controller.ts:507), outside any lease section, so between the two the goal lease is released and the record is not DONE. Both takeovers decide DONE from a goal read taken before and outside the goal lease section (src/cli/main.ts:476 for `goal takeover`; main.ts:812-821 for `card takeover`, whose `CardRunner.takeover` takes only the card lease). A DONE saved after that read is never seen, so the takeover acquires the released goal lease (or the card lease) and journals `GOAL_TAKEOVER` (or the card-takeover-intent NOTE and `LEASE_ACQUIRED`) after `GOAL_DONE`."
  repro: "Throwaway loop on main at 67a7e760: a preload that saves the goal DONE right after the CLI's first `getGoal`/`listGoals`, on a RUN goal with expired foreign leases (setup of tests/scenarios/takeover-done-goal.test.ts). `goal takeover`, `card takeover --goal` and `card takeover` each exit 0 and write lease generation 1 plus journal events: tests 3, pass 0, fail 3. Acceptance 1 and 2 turn this loop into the RED."
  same_class: "The close path's own card takeover (src/loop/card-runner.ts:3363) runs only for a goal `markClosure` admits. `controller.next` claims the goal lease (controller.ts:218) after its own terminal guard, from one goal read; a DONE saved after that read is the same class but writes only a lease renewal on a goal this session already coordinates: out of scope here, noted for the reviewer. `goal resume` re-admits a terminal goal on purpose."
sweep: "grep -n \"leases.takeover\\|leases.update\\|leases.claim\\|resourceKeys.goal\" src/cli/main.ts src/loop/controller.ts src/loop/card-runner.ts at 67a7e760: card-runner.ts never takes the goal lease key, so R4 adds no lock cycle there."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, refusing either takeover on a goal in STOP, a goal-record lock or any lock beyond the existing goal lease lock (issue 300), changing `LeaseStore.takeover`'s signature or `CardRunner.takeover`, changing `doneGoalTakeover` text, changing the verifier]
non_goals: ["serializing goal writes in general (issue 300)", "the DONE race in `controller.next`'s goal-lease claim", "`aidlc audit verify` flagging a GOAL_TAKEOVER or LEASE_ACQUIRED after GOAL_DONE", "a guard inside CardRunner.takeover for library callers"]
hygiene: "Owner instruction 2026-11-21 after R3 decision 1: allow_paths adds src/coordination/lease.ts so LeaseStore.update can pass updateJson's within hook (DONE saved after the release write, in the same section). Owner ruling 2026-11-21 in session 5b6d1260 during the run: R2 and acceptance 1 amended to one goal read under the goal lease lock (the first text needed a second read, which T0-TAKEOVER-DONE-GOAL-2 acceptance 5 forbids). Issue 387, raised by R3 decision 2 on T0-TAKEOVER-DONE-GOAL; owner ruling 2026-11-21 in session 5b6d1260: T0-bugfix with an in-lease DONE check, not a goal-record lock. Pass --goal on every card and review command."
doc_sync: docs/OPERATIONS.md, changelog.d/T0-TAKEOVER-DONE-RACE.md
---

# T0-TAKEOVER-DONE-RACE

## Deliverable
A goal saved DONE by another session after a takeover's goal read no longer lets the takeover write a lease or a journal event: goal close saves DONE under the goal lease lock, and both takeovers re-check DONE under that same lock before they write.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/takeover-done-race.test.ts tests/scenarios/takeover-done-goal.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/two-windows.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Risks
- Lock order (R4): `card takeover` now holds the goal lease lock across the card-run and card lease locks. The sweep found no path that takes the goal lease lock inside either; a path the sweep missed shows as a lock timeout, not a hang (`updateJson` waits 2 s).
- Goal close may journal or write more inside `releaseGoalLease` than the save needs; if moving `saveGoal` into the section reorders `GOAL_TAKEOVER` against `GOAL_DONE`, the card stops for an owner ruling rather than widening scope.
