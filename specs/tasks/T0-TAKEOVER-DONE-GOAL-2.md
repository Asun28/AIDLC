---
id: T0-TAKEOVER-DONE-GOAL-2
title: "(replaces T0-TAKEOVER-DONE-GOAL and carries its candidate; R1 and R2 scoped to the command's one goal read) aidlc goal takeover and aidlc card takeover on a goal that is DONE take no lease, append no journal event, report the DONE state and exit 0 (issue 379)"
status: todo
branch: T0-TAKEOVER-DONE-GOAL-2
allow_paths:
  - src/core/card-goal.ts
  - src/cli/main.ts
  - tests/core/card-goal.test.ts
  - tests/scenarios/takeover-done-goal.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-TAKEOVER-DONE-GOAL.md
  - changelog.d/T0-TAKEOVER-DONE-GOAL-2.md
  - specs/tasks/T0-TAKEOVER-DONE-GOAL.md
  - specs/tasks/T0-TAKEOVER-DONE-GOAL-2.md
dod_command: npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/takeover-done-goal.test.ts tests/scenarios/card-terminal-goal.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc goal takeover <id>` reads the goal record (one `GoalStore.getGoal`, the command's only goal read, before any lease read or write) and its state is `DONE`, the command shall take no lease (the goal lease record is unchanged or still absent), append no journal event to any goal, print the text of R3 and exit 0.
  - R2. WHEN `aidlc card takeover <card>` reads the goal records (one `GoalStore.listGoals`, the command's only goal read) and the goal it resolves, with or without `--goal`, is `DONE`, the command shall do the same as R1 before any card run or card lease is read or written; with `--goal` naming a DONE goal this holds before the resolution's `holdsRun` reads a card run. Its output names the card, the goal and the DONE state and prints no `next:` hint. On a goal that is not DONE, every later step up to the first card-run read uses the record of that read: no `getGoal` and no second `listGoals` before it.
  - R3. The text of R1 and R2 shall come from one pure function in `src/core/card-goal.ts` over the goal id and state, naming the goal id and `DONE` and stating that there is nothing to take over, that no lease was taken and that no event was journaled; it returns nothing for any state other than `DONE`.
  - R4. On a goal in any other state, including `STOP`, both commands shall take over as before this card.
  - R5. A goal saved DONE by another session after the read of R1 or R2 is not caught: the takeover then proceeds as on a goal that is not DONE (issue 387).
  - R6. `docs/OPERATIONS.md` (the terminal-goal paragraph after the STOP reasons table) and `changelog.d/T0-TAKEOVER-DONE-GOAL-2.md` shall state R1, R2, R4 and R5; the fragment `changelog.d/T0-TAKEOVER-DONE-GOAL.md` moves to the new id.
acceptance:
  - 1. `tests/core/card-goal.test.ts`: the function of R3 returns, for a DONE goal, a text naming the goal id, `DONE`, `nothing to take over`, `no lease was taken` and `no event was journaled`, and nothing for PLAN, RUN, CLOSE and STOP. [R3] [dod arm 1]
  - 2. `tests/scenarios/takeover-done-goal.test.ts`, the CLI from the sources: on a goal saved as DONE (terminal) whose goal lease, held by another session, has expired, `goal takeover <id>` exits 0, its JSON report is `{ goalId, state: 'DONE', takenOver: false, detail }` with `detail` the text of R3, its human line (`--no-json`) is that text, and every lease file and goal journal is byte-identical before and after. [R1] [dod arm 1]
  - 3. Same file: on that DONE goal, with the card run file and the card lease file unparseable, `card takeover <card>` with `--goal` and without, and `card takeover <other> --goal <id>` for a card the goal does not project whose run file is unparseable, each exit 0 with the JSON report `{ cardId, goalId, state: 'DONE', takenOver: false, detail }` and the human line `<card>: <text of R3>` with no `next:`, and every lease file, card run file and goal journal is byte-identical. [R2] [dod arm 1]
  - 4. Same file: with the goal in RUN, `goal takeover` and `card takeover` advance the lease generation as before. [R4] [dod arm 1]
  - 5. Same file, the CLI run with `--import tests/scenarios/card-terminal-goal.preload.ts` (the goal-store call log): `card takeover`, with `--goal` and without, logs only `listGoals` on a DONE goal and exactly one `listGoals` before its first `getCardRun` on a RUN goal; `goal takeover` logs one `getGoal` and no `listGoals` on a DONE and on a RUN goal. Fails at ee3cb5e3. [R1] [R2] [dod arm 1]
  - 6. `tests/scenarios/card-terminal-goal.test.ts` passes unchanged. [R4] [dod arm 1]
  - 7. The doc and the changelog fragment state R1, R2, R4 and R5 (reviewer-verified against the diff). [R6]
depends_on: []
budget: 250
tdd: true
diagnosis:
  root_cause: "`goal takeover` (src/cli/main.ts:470) checks only that the lease expired and the goal's operations are reconciled; it never reads the goal record before `leases.takeover` and the `GOAL_TAKEOVER` append. `card takeover` (src/cli/main.ts:798) resolves the goal with `cardGoalId`, which applies no state guard (T0-CARD-TERMINAL-GOAL-2 R4 left it unguarded so it stays a recovery command on a stopped goal), and `CardRunner.takeover` reads no goal state either. A DONE goal has no work left to own, so both write ownership events after `GOAL_DONE` (goal g-20261118102948-c1d226, seq 62 and 64)."
  repro: "Acceptance 2 and 3: the CLI on a fixture goal saved as DONE with an expired foreign lease; on main the lease generation advances and the journal gains GOAL_TAKEOVER (goal) or a card-takeover-intent NOTE and LEASE_ACQUIRED (card). RED at ff84f3e6 on branch T0-TAKEOVER-DONE-GOAL."
  same_class: "Other lease-taking commands on a DONE goal: `card next` and `card close` go through `checkedGoal`, which refuses DONE (T0-CARD-TERMINAL-GOAL-2); `goal resume` re-admits a terminal goal on purpose; the close path's own takeover (card-runner.ts:3363) runs only for a goal `markClosure` admits."
sweep: "grep -n \"leases.takeover\\|\\.takeover(\\|cardGoalId\\|checkedGoal\" src/cli/main.ts src/loop/card-runner.ts at c7a7ce14."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, refusing either takeover on a goal in STOP, changing `terminalGoalRefusal` or `resolveCardGoal`, changing `LeaseStore.takeover` or `CardRunner.takeover`, changing the verifier, a goal-record lock]
non_goals: ["a goal saved DONE by another session after the read of R1 or R2 (issue 387: closing it needs the DONE decision serialized with goal completion)", "acceptance 3 of issue 379, `aidlc audit verify` flagging a GOAL_TAKEOVER or LEASE_ACQUIRED after GOAL_DONE: a change to the verifier's terminal accounting", "takeover on a goal in STOP: T0-CARD-TERMINAL-GOAL-2 R4 keeps card takeover a recovery command there", "a guard inside CardRunner.takeover for library callers", "the journal of goal g-20261118102948-c1d226"]
hygiene: "Issue 379. Replaces T0-TAKEOVER-DONE-GOAL and carries its candidate ee3cb5e3 (start the branch there). Its R3 decision 1 (.review/T0-TAKEOVER-DONE-GOAL.r3.1.cdbb2183.json) blocked on test assertions and a non-goal added after the run started, repaired in ee3cb5e3; decision 2 (.review/T0-TAKEOVER-DONE-GOAL.r3.2.5a211dee.json) blocked on stale-done-check (a DONE saved after the goal read, for both commands, and the separate goal reads of card takeover) and on the helper-text assertion. Owner ruling 2026-11-20 in session 1e427e90: a successor card that scopes R1 and R2 to the command's one goal read and moves the race to issue 387. Carry the attempt evidence of T0-TAKEOVER-DONE-GOAL under a History line. Pass --goal on every card and review command."
doc_sync: docs/OPERATIONS.md, changelog.d/T0-TAKEOVER-DONE-GOAL-2.md
---

# T0-TAKEOVER-DONE-GOAL-2

Replaces T0-TAKEOVER-DONE-GOAL by the owner's ruling of 2026-11-20 on its R3 decision 2.

## Deliverable
`aidlc goal takeover` and `aidlc card takeover` on a goal that is DONE, as the command's one read of the goal records shows it, write nothing: no lease, no journal event. They print that the goal is DONE and exit 0. A DONE saved by another session after that read is issue 387.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/takeover-done-goal.test.ts tests/scenarios/card-terminal-goal.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
