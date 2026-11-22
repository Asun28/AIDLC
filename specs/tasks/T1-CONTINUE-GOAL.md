---
id: T1-CONTINUE-GOAL
title: "`aidlc card continue` runs on a goal stopped for the card's stop and re-admits it with an event that carries the continuation"
status: todo
branch: T1-CONTINUE-GOAL
worktree: D:\wt\AIDLC\T1-CONTINUE-GOAL
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/cli/main.ts
  - src/loop/controller.ts
  - tests/scenarios/card-continue-goal.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - README.md
  - changelog.d/T1-CONTINUE-GOAL.md
  - specs/tasks/T1-CONTINUE-GOAL.md
dod_command: npm run typecheck && node --test tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/audit.test.ts tests/surface/command-lines.test.ts tests/surface/readme.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The command `aidlc card continue <cardId> --by <who> --reason <text> [--decisions <n>] [--goal <id>]` shall call `GoalController.continueCard` on the existing run of the card and start no run.
  - R2. The command shall pass the goal check with the `continue` exception of `terminalGoalRefusal`, so that it runs on a goal that is not stopped and on a goal in STOP for `review` or `ci`.
  - R3. IF the goal is DONE, cancelled or stopped for any other reason, the card has no run in the goal, or the runner's act throws, THEN the command shall exit non-zero with the cause and leave the goal record, the card-run record and the journal as they were.
  - R4. WHEN the act lifted the card's stop and the goal is in STOP, terminal, with the stop reason of the lifted stop and in the generation the command read, `continueCard` shall, in one section of the goal lock, append one `GOAL_STATE` event with `from` STOP, `to` CARDS and `continuation` (`cardId`, `by`) and write the goal with `terminal` false, no `stop` and state CARDS.
  - R5. WHEN the command runs again on a run whose last continuation lifted a stop of the goal's stop reason while the goal is still in STOP for it, `continueCard` shall record no second continuation and complete the re-admission with the `by` of the recorded one, appending the event only when none with `continuation` follows the goal's last `GOAL_STOPPED`.
  - R6. The command's output shall hold the run's state, the continuation and whether the goal was re-admitted, and name `aidlc card next <card>` and, when the run's deadline has passed, `aidlc goal extend`.
  - R7. The files `docs/OPERATIONS.md` (a paragraph on the command and the STOP reasons row `review`), `docs/ARCHITECTURE.md`, the Limits row "Substantive review decisions" of `README.md` and `changelog.d/T1-CONTINUE-GOAL.md` shall state R1 to R6 and the runner's act of T1-CONTINUE-REVIEW-2.
acceptance:
  - 1. `tests/scenarios/card-continue-goal.test.ts`, a one-card goal whose card a command reviewer stopped on R3 decision 4 and which `aidlc next` then stopped for review. The command, through the CLI, exits 0; the run holds the continuation and no stop; the goal is in CARDS, not terminal, with no stop; the journal holds exactly one `GOAL_STATE` from STOP to CARDS with `continuation` naming the card and `by`; `aidlc next` then waits on the card, and `aidlc card next` through the CLI exits 0 with the card's own directive of kind `build`, not the goal refusal. [R1] [R2] [R4] [dod arm 2]
  - 2. Same file. After a repair attempt is dispatched on that goal, `aidlc audit verify` reports no `WORK_AFTER_TERMINAL`. [R4] [dod arm 2]
  - 3. Same file. With the goal write failing once after the card's stop was lifted, the goal stays in STOP; the command run again records no second continuation, leaves one `GOAL_STATE` event with `continuation` in the journal and re-admits the goal. [R5] [dod arm 2]
  - 4. Same file. Each refusal exits non-zero, names its cause and leaves the goal file, the card-run file and the journal byte-identical: a goal stopped for `time` (the message names `aidlc goal extend`), a DONE goal, a card with no run, `--decisions 0`, a blank `--by`. [R3] [dod arm 2]
  - 5. Same file. With the run's deadline set in the past the output names `aidlc goal extend`; with it set far in the future the output names `aidlc card next` and not `aidlc goal extend`. On a two-card goal that is not stopped the command lifts the card's stop and appends no `GOAL_STATE` event. [R4] [R6] [dod arm 2]
  - 6. `tests/scenarios/card-continue.test.ts`, `review-rule-goal.test.ts`, `audit.test.ts`, `tests/surface/command-lines.test.ts` and `tests/surface/readme.test.ts` pass with no line changed, and `npm run build && npm run bench -- --check` exits 0. [dod arm 1] [dod arm 2] [dod arm 3]
  - 7. The docs and the README row state R1 to R6 (reviewer-verified against the diff). [R7]
depends_on: [T1-CONTINUE-REVIEW-2, T1-CONTINUE-AUDIT]
budget: 240
sweep: "On main at 212ff184. src/loop/controller.ts:984-1017 (`ruleFinding`) holds the goal re-admission this card follows, and its goal-lock section is the one to share; :405-408 is where `aidlc next` stops the goal with the reason of its stopped card. src/cli/main.ts:660-672 is `checkedGoal`, which passes its guard to `terminalGoalRefusal`; :1196-1221 is `review rule`, the command line this one follows; :719-750 (`withdraw`, `adopt-merge`) show a command that reads an existing run and starts none. README.md:145 is the Limits row. `terminalGoalRefusal` takes `continue` from T1-CONTINUE-AUDIT, and the audit rule comes from it too."
forbid: [weakening or skipping a test to go green, a re-admission of a goal stopped for a reason other than that of the lifted stop, moving a deadline, a change to `CardRunner.continueStop`, to `terminalGoalRefusal` or to the verifier, editing .aidlc state by hand]
non_goals: [the runner's act for a ci stop (T1-CONTINUE-CI; until it merges the runner refuses a ci stop and the goal stays stopped), the refusal exception and the audit rule (T1-CONTINUE-AUDIT), a new journal event type, a change to `aidlc review rule`, a check of the owner's delegation]
hygiene: "Line numbers are from main at 212ff184; read them again at PREPARE. The goal read, its checks, the journal scan, the append and the goal write are one section of the goal lock, as in `ruleFinding`; the append comes before the write, so a failure of either leaves the goal in STOP with the card's stop lifted, which R5 completes. The CLI reads the real clock, so the test sets the run's deadline (docs/LESSONS.md, T1-REVIEW-RULE-SHIP). Run every test file that reads docs/OPERATIONS.md, docs/ARCHITECTURE.md or README.md before the attempt is recorded. The DoD runs the loop benchmark: a new import in src/cli/main.ts or src/loop/controller.ts adds to the `cli.start` module count."
doc_sync: docs/OPERATIONS.md (the command, STOP reasons), docs/ARCHITECTURE.md, README.md (Limits)
---

# T1-CONTINUE-GOAL

## Deliverable
The command line of the continuation, on a goal that `aidlc next` stopped for the card's stop, with the goal back in progress.

## Why
`specs/card-continuation.md`, R5 and R6. `aidlc next` stops the goal with the stop reason of its stopped card, so the act that lifts the card's stop must put the goal back in progress under the same recorded authority.

## Rules that decide edge cases
- The goal is re-admitted only for the stop reason of the stop the act lifted, in the same generation.
- No deadline moves: a goal past its deadline is stopped for time by the next `aidlc next`, and `aidlc goal extend` is the way on.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/audit.test.ts tests/surface/command-lines.test.ts tests/surface/readme.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the six files passes, the build succeeds and every benchmark count is within its ceiling.
