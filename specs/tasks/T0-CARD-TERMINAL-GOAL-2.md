---
id: T0-CARD-TERMINAL-GOAL-2
title: "Card commands that do card work refuse a stopped or done goal from one read of the goal records, before any card run is read or written, and use that checked record for the rest of the command"
status: todo
branch: T0-CARD-TERMINAL-GOAL-2
worktree: D:\wt\AIDLC\T0-CARD-TERMINAL-GOAL-2
allow_paths:
  - src/core/card-goal.ts
  - src/cli/main.ts
  - tests/core/card-goal.test.ts
  - tests/scenarios/card-terminal-goal.test.ts
  - tests/scenarios/card-terminal-goal.preload.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-CARD-TERMINAL-GOAL.md
  - specs/tasks/T0-CARD-TERMINAL-GOAL-2.md
dod_command: npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-goal.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc card next|attempt|close|report <card>` or `aidlc review pre|r3|dispute|accept <card>` resolves a goal that is terminal or whose state is `STOP` or `DONE` (the predicate of the goal dispatch guard, `src/loop/controller.ts:205`), the command shall exit non-zero before any card run is read, created or saved and before any journal event is appended.
  - R2. The refusal shall name the goal id, its state and, for a stop, the stop reason, and the one command that re-admits the goal: `aidlc goal extend <id> --until <iso> --by <who> --reason "..."` for a stop for time or a goal left in `STOP` by a resume of a time stop, else `aidlc goal resume <id> --reason "..."`.
  - R3. The refusal text shall come from one pure function in `src/core/card-goal.ts` over the goal record (id, state, terminal, stop reason), used by every command of R1.
  - R4. `aidlc card status`, `card takeover`, `card ci-reconcile`, `card withdraw`, `card mutants`, `review findings` and `review repro` shall behave as before T0-CARD-TERMINAL-GOAL on a terminal goal.
  - R5. Each command of R1 shall read the goal records once (one `GoalStore.listGoals`) to resolve the card's goal and decide the refusal, and every later step of the command up to its first card-run read or write shall use that checked record: no `getGoal` or second `listGoals` before it. For an explicit `--goal`, a terminal goal is refused before `holdsRun` reads any card run. Steps after that point that read the goal again for their own checks (`controller.report`, `markClosure`) keep their checks.
  - R6. `card close --all|--cleanup` shall register its exit sweep only after the refusal of R5 has passed and the goal is resolved, so a refusal of R1 never runs the sweep. A refusal raised later in the command (`markClosure` reading the goal as terminal, a closure error) still exits with the sweep, as before this card: the sweep concerns the other cards (comment at src/cli/main.ts, `card close`).
  - R7. `docs/OPERATIONS.md` (STOP reasons), `docs/ARCHITECTURE.md` (module map, `src/core/card-goal.ts`) and the CHANGELOG Unreleased section shall state R1, R2, R4, R5 and the non-goal on concurrent stops under this card id, replacing the T0-CARD-TERMINAL-GOAL text.
acceptance:
  - 1. `tests/core/card-goal.test.ts`: the function of R3 returns nothing for a goal in RUN, WAIT and CLOSE; for a goal stopped for time it names the goal, `STOP`, `time` and `aidlc goal extend`; stopped for ownership or cancelled it names the reason and `aidlc goal resume`; DONE names `DONE` and `aidlc goal resume`; a non-terminal goal in `STOP` names `aidlc goal extend`. [R2] [R3] [dod arm 1]
  - 2. `tests/scenarios/card-terminal-goal.test.ts`, the CLI from the sources against a goal stopped with `cancel`: each command of R1, with `--goal` and without it, exits non-zero with the refusal of R2, no card run file exists afterwards and the goal journal is unchanged; with `--goal` naming a stopped goal that holds a malformed run of a card it no longer projects, `card next` and `card attempt` print the refusal, not a store error; `card close --cleanup` and `--all` print no sweep line and the reclaimable worktree remains. [R1] [R2] [R6] [dod arm 1]
  - 3. Same file: a goal whose card run is in BUILD with a running attempt, then stopped for ownership: `card next` and `card attempt --outcome success` exit non-zero, the stored run is byte-identical and none of `ATTEMPT_STARTED`, `ATTEMPT_FINISHED`, `LEASE_RENEWED`, `CARD_STATE`, `OPERATION_ISSUED` is journaled. [R1] [dod arm 1]
  - 4. Same file: on that stopped goal `card status` exits 0 and prints the run, and `card takeover` and `card ci-reconcile` print no refusal of R2. [R4] [dod arm 1]
  - 5. Same file: after `aidlc goal resume <id> --reason "..."` the same `card next` is not refused by R1. [R1] [dod arm 1]
  - 6. Same file, the CLI run with `node --import tests/scenarios/card-terminal-goal.preload.ts`, a preload that logs each `GoalStore` call of `listGoals`, `getGoal`, `getCardRun` and `saveCardRun` in order to a file the test names: for `card next`, `card attempt`, `card report` and `card close --all` on an active goal, with and without `--goal`, the log before the first `getCardRun` or `saveCardRun` holds exactly one `listGoals` and no `getGoal`. Fails at d770af3 (the reload of `workGoal`). [R5] [dod arm 1]
  - 7. Same file, the same preload with an option that saves the goal as cancelled through the real store right after the first `listGoals` returns: `card close --all` on a run in CLOSE, in the git fixture of acceptance 2, exits non-zero with `markClosure`'s refusal (`closure cannot change`) and no refusal text of R2 on stderr (no guard refuses after the sweep is registered), and the sweep line is present, as R6 states for a refusal raised after the read. [R5] [R6] [dod arm 1]
  - 8. `tests/scenarios/card-goal.test.ts` passes unchanged. [R4] [dod arm 1]
  - 9. The docs and CHANGELOG state R1, R2, R4, R5 and the non-goal on concurrent stops (reviewer-verified against the diff). [R7]
depends_on: []
budget: 400
size_exception: "written before the T0-CARD-SIZE rule; it carries the candidate of T0-CARD-TERMINAL-GOAL under the user ruling on its R3 base-sync decision"
tdd: true
diagnosis:
  root_cause: "At d770af3 (branch T0-CARD-TERMINAL-GOAL) `workGoal` checks the goal from one `listGoals` read (`refuseTerminalGoal`) and then returns a second read (`controller.mustGoal(cardGoalId(...))`) that nothing checks; `card report` reloads the goal again before `ensureCardRun`; and `card close` guards once before registering its exit sweep and again inside `cardCtx` after it, so a stop saved between the reads either reaches `ensureCardRun` as a checked-looking record or refuses after the sweep is registered (R3 base-sync decision on d770af3, findings F1 to F3, class unguarded-goal-reload and refusal-runs-exit-sweep)."
  repro: "R3 reproduced each with successive goal-store reads returning the goal active and then stopped. Acceptance 6 is the deterministic loop: the preload's call log shows a `getGoal` (or a second `listGoals`) before the first card-run access."
  same_class: "Every command of R1 goes through `workGoal`/`cardCtx` or, for `card report`, `workGoal` alone; R5 covers all of them, and acceptance 6 names four that between them cover every path (cardCtx without a sweep, cardCtx with a sweep, the report path, the attempt path)."
sweep: "grep -n \"workGoal\\|refuseTerminalGoal\\|cardCtx\\|mustGoal\\|sweepAfter\" src/cli/main.ts at d770af3."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, changing the verifier or WORK_AFTER_TERMINAL accounting, changing `resolveCardGoal`'s selection rules, refusing `card takeover` or `card ci-reconcile` on a stopped goal, a goal-record lock, changing `controller.report`, `ensureCardRun` or `markClosure`]
non_goals: [a stop saved by another process after the one read of R5 and before the command's first write (goal records are last-writer-wins and no lock spans a goal record and a card-run write; the work then lands after GOAL_STOPPED and `aidlc audit verify` reports it as WORK_AFTER_TERMINAL; closing that window needs a goal-record lock, a separate card), the record of goal g-20261107095106-c08940, guards inside `CardRunner` for library callers]
hygiene: "Continues the branch line of T0-CARD-TERMINAL-GOAL at d770af3 (R3 pass on dd876ac at decision 2, second pass clean, base-sync decision blocked on F1 to F3). Carry its attempt evidence under a History line. Run the mutation sweep before the first review. The full suite runs locally before SHIP. Pass --goal on every card and review command."
doc_sync: docs/OPERATIONS.md (STOP reasons), docs/ARCHITECTURE.md (module map), CHANGELOG.md
---

# T0-CARD-TERMINAL-GOAL-2

Replaces T0-CARD-TERMINAL-GOAL by the user's ruling of 2026-11-10 on its R3 base-sync decision (STOP/review).

## Deliverable
A card command that would do card work on a goal that is stopped or done exits non-zero and writes nothing, decided from one read of the goal records that the rest of the command then uses; its message names the command that re-admits the goal. Read-only commands and the recovery commands (`card takeover`, `card ci-reconcile`) still run.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-goal.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence

History: T0-CARD-TERMINAL-GOAL, RED d85b58c (acceptance 1 to 3) and a720305 (R3 decision 1, F1 and F2); R3 passed dd876ac at decision 2; its base-sync merge d770af3 was blocked (F1 to F3, unguarded-goal-reload, refusal-runs-exit-sweep) and this card replaces it.

RED at 4daa411: acceptance 6 fails at 9b484f0 with `card next T1-HELLO: ... listGoals,listGoals,getGoal,getCardRun,...`; acceptance 7 fails with the R2 refusal printed after the sweep was registered (`worktree removed: T1-HELLO` follows it).

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/core/card-goal.test.ts`, `terminalGoalRefusal (T0-CARD-TERMINAL-GOAL)` | pass |
| 2 | `tests/scenarios/card-terminal-goal.test.ts`, acceptance 2 (three tests: eight commands with and without `--goal`; malformed run of an unprojected card; `card close --cleanup` and `--all` with no sweep) | pass |
| 3 | same file, acceptance 3 | pass |
| 4 | same file, acceptance 4 | pass |
| 5 | same file, acceptance 5 | pass |
| 6 | same file, `T0-CARD-TERMINAL-GOAL-2 acceptance 6`, with `card-terminal-goal.preload.ts` | pass (failed at RED) |
| 7 | same file, `T0-CARD-TERMINAL-GOAL-2 acceptance 7`, preload with `AIDLC_TEST_CANCEL_AFTER_LIST` | pass (failed at RED) |
| 8 | `tests/scenarios/card-goal.test.ts`, unchanged | pass |
| 9 | `CHANGELOG.md` (Unreleased), `docs/OPERATIONS.md` (STOP reasons), `docs/ARCHITECTURE.md` (module map) under T0-CARD-TERMINAL-GOAL-2 | reviewer-verified |

Goal-store calls up to the first card-run access on an active goal, with and without `--goal`, through the preload: `card next`, `card attempt`, `card close --all`, `card report`, `review pre`, `review r3`, `review dispute`, `review accept` each log `listGoals,getCardRun`.
