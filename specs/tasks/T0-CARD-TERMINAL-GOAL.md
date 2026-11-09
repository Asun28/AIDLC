---
id: T0-CARD-TERMINAL-GOAL
title: "Card commands that do card work refuse a stopped or done goal before any card run is read or written, so no dispatch, attempt or ship lands after GOAL_STOPPED"
status: todo
branch: T0-CARD-TERMINAL-GOAL
worktree: D:\wt\AIDLC\T0-CARD-TERMINAL-GOAL
allow_paths:
  - src/core/card-goal.ts
  - src/cli/main.ts
  - tests/core/card-goal.test.ts
  - tests/scenarios/card-terminal-goal.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-CARD-TERMINAL-GOAL.md
dod_command: npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-goal.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc card next|attempt|close|report <card>` or `aidlc review pre|r3|dispute|accept <card>` resolves a goal that is terminal or whose state is `STOP` or `DONE` (the predicate of the goal dispatch guard, `src/loop/controller.ts:205` at bfd37c6), the command shall exit non-zero before any card run is read, created or saved and before any journal event is appended.
  - R2. The refusal shall name the goal id, its state and, for a stop, the stop reason, and the one command that re-admits the goal: `aidlc goal extend <id> --until <iso> --by <who> --reason "..."` for a stop for time or a goal left in `STOP` by a resume of a time stop, else `aidlc goal resume <id> --reason "..."`.
  - R3. The refusal shall be one pure function in `src/core/card-goal.ts` over the goal record (id, state, terminal, stop reason), returning the refusal text or nothing, used by every command of R1.
  - R4. `aidlc card status`, `card takeover` (the documented order is takeover, then `goal resume`), `card ci-reconcile` (it records an observed CI rerun), `card withdraw` (it keeps its own terminal refusal), `card mutants`, `review findings` and `review repro` shall behave as before this card on a terminal goal.
  - R5. `docs/OPERATIONS.md` (STOP reasons, not Sessions: tests/surface/prose.test.ts caps Sessions at 13701 bytes and it holds 13493 at a125546), `docs/ARCHITECTURE.md` (module map, `src/core/card-goal.ts`) and the CHANGELOG Unreleased section shall state R1, R2 and R4 under this card id.
acceptance:
  - 1. `tests/core/card-goal.test.ts`: the function of R3 returns nothing for a goal in RUN, WAIT and CLOSE; for a goal stopped for time it returns text naming the goal, `STOP`, `time` and `aidlc goal extend`; for a goal stopped for ownership or cancelled it names the reason and `aidlc goal resume`; for a DONE goal it names `DONE` and `aidlc goal resume`; for a non-terminal goal in `STOP` (a resumed time stop) it names `aidlc goal extend`. [R2] [R3] [dod arm 1]
  - 2. `tests/scenarios/card-terminal-goal.test.ts` runs the CLI from the sources against a goal stopped with `cancel` that projects a card with no run: each command of R1, with `--goal` and without it, exits non-zero with the refusal of R2 on stderr, no card run file exists afterwards, and the goal journal has the same events as before the command. Fails before the fix (`card next` exits 0 and journals `CARD_DISPATCHED`). [R1] [R2] [dod arm 1]
  - 3. Same file: a goal whose card run exists in BUILD with a running attempt, then stopped for ownership: `card next` and `card attempt --outcome success` exit non-zero, the stored run is byte-identical and no `ATTEMPT_STARTED`, `ATTEMPT_FINISHED`, `LEASE_RENEWED`, `CARD_STATE` or `OPERATION_ISSUED` is journaled. Fails before the fix. [R1] [dod arm 1]
  - 4. Same file: on the stopped goal of acceptance 3, `card status` exits 0 and prints the run, and `card takeover` and `card ci-reconcile` print no refusal of R2 (their own outcome stands). [R4] [dod arm 1]
  - 5. Same file: after `aidlc goal resume <id> --reason "..."` the same `card next` is not refused by R1. [R1] [dod arm 1]
  - 6. `tests/scenarios/card-goal.test.ts` passes unchanged. [R4] [dod arm 1]
  - 7. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and the CHANGELOG Unreleased section carry R1, R2 and R4 under this card id (reviewer-verified against the diff). [R5]
depends_on: []
budget: 220
tdd: true
diagnosis:
  root_cause: "`cardCtx` (src/cli/main.ts:488 at bfd37c6) resolves the card's goal and calls `controller.ensureCardRun`, and `card report` (:580) does the same, with no check of the goal's state; `CardRunner.next` and `recordAttempt` never read the goal's state either (the card machine's `terminal` evidence is the card run's own stop, card-runner.ts:664). Only `withdrawCandidate` (:1062) and `markClosure` (:3013) refuse a terminal goal. `resolveCardGoal` resolves to the one terminal goal that projects a card by design (read-only commands need it), so every card command reaches a stopped goal and does its work there."
  repro: "Goal g-20261107095106-c08940: GOAL_STOPPED (time) at 2026-11-08T00:54:56Z, then five `card next` calls journaled CARD_DISPATCHED from 00:55:12Z; GOAL_STOPPED (ownership) at 2026-11-09T00:18:00Z after T1-EVAL-VARIANT's card lease lapsed while its implementer worked, then `card attempt` (00:35Z), `card next` renewing the expired lease and moving STOP to SHIP, ATTEMPT_STARTED at 00:55:50Z and the merge OPERATION_ISSUED at 01:04:59Z, all before the resume at 01:52Z. `aidlc audit verify` counts the seven as WORK_AFTER_TERMINAL and stays at `recorded`; that goal's record stays as it is. Minimal loop: makeFixture, goalForCards, `report cancel`, then `aidlc card next <card> --goal <id>` exits 0 and journals CARD_DISPATCHED, CARD_STATE."
  same_class: "Every CLI command that takes a <cardId> and writes the card run or the journal: the commands of R1 refuse; the commands of R4 are kept with their reason. The goal-level `aidlc next` and `aidlc report` already refuse a terminal goal (controller.ts:205, :487)."
sweep: "grep -n \"cardCtx\\|ensureCardRun\\|cardGoalId\" src/cli/main.ts. Lines are from main at bfd37c6; read them again at PREPARE, since T1-BOUND-STATS also edits src/cli/main.ts."
forbid: [weakening or skipping a test to go green, editing .aidlc state by hand, changing the verifier or WORK_AFTER_TERMINAL accounting, changing goal resolution (`resolveCardGoal`), refusing `card takeover` or `card ci-reconcile` on a stopped goal]
non_goals: [rewriting the record of goal g-20261107095106-c08940 (its finding stays as recorded), stopping the goal less often when a card lease lapses while its owner works, guards inside `CardRunner` for library callers (only the CLI calls `next` and `recordAttempt`)]
hygiene: "The full suite runs locally before SHIP: the guard can break a scenario test that drives a card command on a stopped goal, which the DoD files cannot show. Pass --goal on every card and review command while this card runs (docs/LESSONS.md 2026-09-26 T0-BASE-SYNC-HOLD-NARRATION). Run the mutation sweep over the new branch before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (STOP reasons), docs/ARCHITECTURE.md (module map), CHANGELOG.md
---

# T0-CARD-TERMINAL-GOAL

## Deliverable
A card command that would do card work on a goal that is stopped or done exits non-zero and writes nothing, and its message names the command that re-admits the goal. Read-only commands and the recovery commands (`card takeover`, `card ci-reconcile`) still run.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/card-goal.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/card-goal.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence

RED at d85b58c: `tests/core/card-goal.test.ts` fails to load (no export `terminalGoalRefusal`); acceptance 2 and 3 fail with `card next` exiting 0.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/core/card-goal.test.ts`, `terminalGoalRefusal (T0-CARD-TERMINAL-GOAL)`: five tests | pass |
| 2 | `tests/scenarios/card-terminal-goal.test.ts`, acceptance 2: eight commands, with and without `--goal` | pass (failed at RED) |
| 3 | same file, acceptance 3: `card next` and `card attempt` on a goal stopped for ownership with the run in BUILD | pass (failed at RED) |
| 4 | same file, acceptance 4: `card status` exits 0 with the run; `card takeover` and `card ci-reconcile` print no refusal | pass |
| 5 | same file, acceptance 5: `card next` after `goal resume` exits 0, no refusal | pass |
| 6 | `tests/scenarios/card-goal.test.ts`, unchanged | pass |
| 7 | `docs/OPERATIONS.md` (STOP reasons), `docs/ARCHITECTURE.md` (module map, `src/core/card-goal.ts`), `CHANGELOG.md` (Unreleased) | reviewer-verified |

### Attempt 2 (R3 decision 1: F1 run-read-before-terminal-guard, F2 refusal-runs-exit-sweep)

RED at a720305: both tests below fail at 87ac4ae (F1: `aidlc: MALFORMED_JSON ... T1-GONE.json` instead of the refusal; F2: `worktree removed: T1-HELLO: goal ... was cancelled` after the refusal).

The guard (`refuseTerminalGoal`, src/cli/main.ts) reads goal records only: the `--goal` record when one is named, else the goal `resolveCardGoal` resolves without `holdsRun` (implicit resolution never calls it), so no card run is read before the refusal. A goal that does not resolve there falls through to `cardGoalId`'s own error, unchanged.

| Item | Proof | Result |
|---|---|---|
| 2 (F1) | `tests/scenarios/card-terminal-goal.test.ts`, acceptance 2: `--goal` naming a stopped goal that holds a malformed run of a card it no longer projects; `card next`, `card attempt` | pass (failed at RED) |
| 2 (F2) | same file, acceptance 2: `card close --cleanup` and `--all` on a stopped goal in a git repository with a reclaimable worktree; no sweep line, worktree kept, no evidence copied | pass (failed at RED) |

What runs before the guard, per R1 command:

| Command | Before the guard | Side effect or card-run read |
|---|---|---|
| card next | `ctx()`: repo identity, config, state paths, store and controller constructors | none |
| card attempt | `ctx()` | none |
| card close | `ctx()`; the guard now precedes the `--all`/`--cleanup` exit sweep | none (was: the sweep, F2) |
| card report | `ctx()` | none |
| review pre | `ctx()` | none |
| review r3 | `ctx()` | none |
| review dispute | `parseDisputeKind(--kind)` (pure, may refuse), `ctx()` | none |
| review accept | `ctx()` | none |
