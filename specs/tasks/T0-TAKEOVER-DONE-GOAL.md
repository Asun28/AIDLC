---
id: T0-TAKEOVER-DONE-GOAL
title: "aidlc goal takeover and aidlc card takeover on a goal that is DONE take no lease, append no journal event, report the DONE state and exit 0 (issue 379)"
status: todo
allow_paths:
  - src/core/card-goal.ts
  - src/cli/main.ts
  - tests/core/card-goal.test.ts
  - tests/scenarios/takeover-done-goal.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-TAKEOVER-DONE-GOAL.md
  - specs/tasks/T0-TAKEOVER-DONE-GOAL.md
dod_command: npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/takeover-done-goal.test.ts tests/scenarios/card-terminal-goal.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc goal takeover <id>` names a goal whose state is `DONE`, the command shall take no lease (the goal lease record is unchanged or still absent), append no journal event to any goal, print that the goal is DONE and that there is nothing to take over, and exit 0.
  - R2. WHEN `aidlc card takeover <card>` resolves (with or without `--goal`) a goal whose state is `DONE`, the command shall do the same as R1 before any card run or card lease is read or written; its output names the card, the goal and the DONE state and prints no `next:` hint.
  - R3. The text of R1 and R2 shall come from one pure function in `src/core/card-goal.ts` over the goal id and state, returning nothing for any state other than `DONE`.
  - R4. On a goal in any other state, including `STOP`, both commands shall behave as before this card.
  - R5. `docs/OPERATIONS.md` (the takeover text) and `changelog.d/T0-TAKEOVER-DONE-GOAL.md` shall state R1, R2 and R4.
acceptance:
  - 1. `tests/core/card-goal.test.ts`: the function of R3 returns a text naming the goal id and `DONE` for a DONE goal, and nothing for PLAN, RUN, CLOSE and STOP. [R3] [dod arm 1]
  - 2. `tests/scenarios/takeover-done-goal.test.ts`, the CLI from the sources: on a goal saved as DONE (terminal) whose goal lease, held by another session, has expired, `goal takeover <id>` exits 0, prints the text of R3, and the lease file and the goal journal are byte-identical before and after. Fails on main (the takeover writes generation 2 and appends `GOAL_TAKEOVER`). [R1] [dod arm 1]
  - 3. Same file: on a DONE goal holding a card run whose card lease, held by another session, has expired, `card takeover <card>` with and without `--goal` exits 0, prints the text of R3 and no `next:` line, and the card lease file, the card run file and every goal journal are byte-identical. Fails on main. [R2] [dod arm 1]
  - 4. Same file: on the same fixtures with the goal in RUN, `goal takeover` and `card takeover` take the lease (generation advances) as before. [R4] [dod arm 1]
  - 5. `tests/scenarios/card-terminal-goal.test.ts` passes unchanged (its acceptance 4 keeps `card takeover` free of the terminal-goal refusal on a stopped goal). [R4] [dod arm 1]
  - 6. The doc and changelog fragment state R1, R2 and R4 (reviewer-verified against the diff). [R5]
depends_on: []
budget: 200
tdd: true
diagnosis:
  root_cause: "`goal takeover` (src/cli/main.ts:470) checks only that the lease expired and the goal's operations are reconciled; it never reads the goal record before `leases.takeover` and the `GOAL_TAKEOVER` append. `card takeover` (src/cli/main.ts:798) resolves the goal with `cardGoalId`, which applies no state guard (T0-CARD-TERMINAL-GOAL-2 R4 left it unguarded on purpose so it stays a recovery command on a stopped goal), and `CardRunner.takeover` reads no goal state either. A DONE goal has no work left to own, so both write ownership events after `GOAL_DONE` (goal g-20261118102948-c1d226, seq 62 and 64)."
  repro: "Acceptance 2 and 3: the CLI on a fixture goal saved as DONE with an expired foreign lease; on main the lease generation advances and the journal gains GOAL_TAKEOVER (goal) or a card-takeover-intent NOTE and LEASE_ACQUIRED (card)."
  same_class: "Other lease-taking commands on a DONE goal: `card next` and `card close` go through `checkedGoal`, which refuses DONE (T0-CARD-TERMINAL-GOAL-2); `goal resume` re-admits a terminal goal on purpose; the close path's own takeover (card-runner.ts:3363) runs only for a goal `markClosure` admits."
sweep: "grep -n \"leases.takeover\\|\\.takeover(\\|cardGoalId\\|checkedGoal\" src/cli/main.ts src/loop/card-runner.ts at c7a7ce14."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, refusing either takeover on a goal in STOP, changing `terminalGoalRefusal` or `resolveCardGoal`, changing `LeaseStore.takeover` or `CardRunner.takeover`, changing the verifier]
non_goals: ["acceptance 3 of issue 379, `aidlc audit verify` flagging a GOAL_TAKEOVER or LEASE_ACQUIRED after GOAL_DONE: a change to the verifier's terminal accounting, left for a follow-up issue", "takeover on a goal in STOP: T0-CARD-TERMINAL-GOAL-2 R4 keeps card takeover a recovery command there, and a goal stopped for time is re-admitted by goal extend", "a guard inside CardRunner.takeover for library callers", "the journal of goal g-20261118102948-c1d226"]
hygiene: "Issue 379. RED first: commit acceptance 1 to 3 against src/ as on main, then the fix. Pass --goal on every card and review command."
doc_sync: docs/OPERATIONS.md, changelog.d/T0-TAKEOVER-DONE-GOAL.md
---

# T0-TAKEOVER-DONE-GOAL

## Deliverable
`aidlc goal takeover` and `aidlc card takeover` on a goal that is DONE write nothing: no lease, no journal event. They print that the goal is DONE and exit 0, since there is nothing to take over.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/takeover-done-goal.test.ts tests/scenarios/card-terminal-goal.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence

RED at ff84f3e6: `node --test tests/core/card-goal.test.ts tests/scenarios/takeover-done-goal.test.ts`, exit 1, tests 4, pass 1, fail 3: card-goal.test.ts does not load (`doneGoalTakeover` not exported); acceptance 2 and 3 fail on `names the goal and DONE` / `names DONE`, the output being the lease the takeover took.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/core/card-goal.test.ts`, `doneGoalTakeover (T0-TAKEOVER-DONE-GOAL)` (two tests) | pass |
| 2 | `tests/scenarios/takeover-done-goal.test.ts`, acceptance 2: JSON report equals the text of R3, human line equals it | pass (failed at RED) |
| 3 | same file, acceptance 3: card run and card lease files unreadable, three cases (with and without `--goal`, and `--goal` naming the DONE goal for a run of a card it does not project); JSON and human report, no `next:` | pass (failed at RED; fails with the explicit-goal precheck removed) |
| 4 | same file, acceptance 4 | pass |
| 5 | `tests/scenarios/card-terminal-goal.test.ts`, unchanged | pass |
| 6 | `docs/OPERATIONS.md` (the terminal-goal paragraph after the STOP reasons table), `changelog.d/T0-TAKEOVER-DONE-GOAL.md` | reviewer-verified |

R3 decision 1 (verdict .review/T0-TAKEOVER-DONE-GOAL.r3.1.cdbb2183.json) blocked on four findings: F1 a non-goal added after the run started (removed; the card's requirements are as committed on main), F2 no assertion that nothing is read before the DONE check, F3 and F4 the text of R3 not asserted in JSON and human output (acceptance 2 and 3 now assert both).
