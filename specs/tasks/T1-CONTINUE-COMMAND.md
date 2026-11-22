---
id: T1-CONTINUE-COMMAND
title: "`aidlc card continue` records the owner's continuation of a stopped card from the command line"
status: todo
branch: T1-CONTINUE-COMMAND
worktree: D:\wt\AIDLC\T1-CONTINUE-COMMAND
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/cli/main.ts
  - tests/scenarios/card-continue-command.test.ts
  - docs/OPERATIONS.md
  - README.md
  - changelog.d/T1-CONTINUE-COMMAND.md
  - specs/tasks/T1-CONTINUE-COMMAND.md
dod_command: npm run typecheck && node --test tests/scenarios/card-continue-command.test.ts tests/scenarios/card-continue-goal.test.ts tests/surface/command-lines.test.ts tests/surface/readme.test.ts && npm run build && npm run bench -- --check
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The command `aidlc card continue <cardId> --by <who> --reason <text> [--decisions <n>] [--goal <id>]` shall call `GoalController.continueCard` with the card of the main checkout and start no run.
  - R2. The command shall pass the goal check with the `continue` exception of `terminalGoalRefusal`, so that it runs on a goal that is not stopped and on a goal in STOP for `review` or `ci`.
  - R3. IF `GoalController.continueCard` throws, THEN the command shall exit non-zero with the cause and write nothing itself.
  - R4. The command's output shall hold the run's state, the run's last continuation, whether this call recorded it and whether the goal was re-admitted, and name `aidlc card next <card>` and, when the run's deadline has passed, `aidlc goal extend`.
  - R5. The paragraph on the command in `docs/OPERATIONS.md` shall state R1 to R4 and the controller's rules of T1-CONTINUE-GOAL-2 (its refusals, the re-admission, the rerun, what a failure after the runner's write leaves); the STOP reasons row `review` of that file names the command; the Limits row "Substantive review decisions" of `README.md` says in one sentence that a recorded continuation admits the further decisions it names and names the command; `changelog.d/T1-CONTINUE-COMMAND.md` says in one entry what the command does.
acceptance:
  - 1. `tests/scenarios/card-continue-command.test.ts`, a one-card goal whose card a command reviewer stopped on R3 decision 4 and which `aidlc next` then stopped for review. The command, through the CLI, exits 0; its output holds the run's state, the continuation with `admits` 5, that this call recorded it and that the goal was re-admitted; the goal is in CARDS; `aidlc card next` through the CLI then exits 0 with a directive of kind `build`; no run of another card exists. [R1] [R2] [R4] [dod arm 2]
  - 2. Same file, one row per refusal, each exiting non-zero with its cause and leaving the goal file, the card-run file where one exists and the journal byte-identical: a goal stopped for `time` (the message names `aidlc goal extend`), a DONE goal, a card with no run, `--decisions 0`, a blank `--by`. [R2] [R3] [dod arm 2]
  - 3. Same file. With the run's deadline set in the past the output names `aidlc goal extend`; with it set far in the future the output names `aidlc card next` and not `aidlc goal extend`. [R4] [dod arm 2]
  - 4. Same file. The command run a second time on the continued run, with the goal in progress, exits non-zero with the runner's cause and records no second continuation. [R3] [dod arm 2]
  - 5. `tests/scenarios/card-continue-goal.test.ts`, `tests/surface/command-lines.test.ts` and `tests/surface/readme.test.ts` pass with no line changed, and `npm run build && npm run bench -- --check` exits 0. [dod arm 1] [dod arm 2] [dod arm 3]
  - 6. Each of the four texts holds what R5 assigns to it and no more is required of it (reviewer-verified against the diff). [R5]
depends_on: [T1-CONTINUE-GOAL-2]
budget: 190
sweep: "On main at 74831913. src/cli/main.ts:660-672 is `checkedGoal`, which passes its guard to `terminalGoalRefusal`; :1196-1221 is `review rule`, the command line this one follows; :719-750 (`withdraw`, `adopt-merge`) show a command that reads an existing run and starts none. README.md:145 is the Limits row. The branch T1-CONTINUE-GOAL at 3c6a1a2b holds a command line and CLI tests for this command, written for the replaced card: the command line carries over without its `eventOwed` output, and its tests are the source for this card's test file."
forbid: [weakening or skipping a test to go green, a write to a goal, card-run or journal record from the command itself, a change to `GoalController.continueCard`, moving a deadline, editing .aidlc state by hand]
non_goals: [the controller's method (T1-CONTINUE-GOAL-2), the runner's act for a ci stop (T1-CONTINUE-CI; until it merges the runner refuses a ci stop and the goal stays stopped), a check of the owner's delegation, a change to `aidlc review rule`]
hygiene: "Line numbers are from main at 74831913; read them again at PREPARE. The CLI reads the real clock, so the test sets the run's deadline (docs/LESSONS.md, T1-REVIEW-RULE-SHIP), and it reads the reviewer command from aidlc.config.json, so the setup writes that file. Run every test file that reads docs/OPERATIONS.md or README.md before the attempt is recorded. The DoD runs the loop benchmark: a new import in src/cli/main.ts adds to the `cli.start` module count."
doc_sync: docs/OPERATIONS.md (the command, STOP reasons), README.md (Limits)
---

# T1-CONTINUE-COMMAND

## Deliverable
The command line of the continuation.

## Why
`specs/card-continuation.md`, R1 and R5 to R7. Split from the replaced T1-CONTINUE-GOAL, which came to 381 changed lines, to keep each card within the size limit.

## Rules that decide edge cases
- The command writes nothing itself: every write is the runner's or the controller's.
- No deadline moves: a run past its deadline is stopped for time by the next `aidlc card next`, and `aidlc goal extend` is the way on.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/card-continue-command.test.ts tests/scenarios/card-continue-goal.test.ts tests/surface/command-lines.test.ts tests/surface/readme.test.ts && npm run build && npm run bench -- --check
```
- Expected exit code: 0
- Assertion: the typecheck reports no error, every test of the four files passes, the build succeeds and every benchmark count is within its ceiling.

## Attempt evidence
Attempts 1 and 2. RED `6fb8b7cc` (`acceptance 1: ...`: `error: unknown command 'continue'`, all 4 tests).

| Item | Proof in `tests/scenarios/card-continue-command.test.ts` | Result |
|---|---|---|
| 1 | `acceptance 1`: exit 0; `state` BUILD, `continuation` equal to the stored one (`by`, `admits` 5), `continued` and `readmitted` true, `next` by value; goal CARDS; `card next` exit 0, kind `build`; runs `[T1-CC]` | pass |
| 2 | `acceptance 2`: 5 rows (time names `aidlc goal extend`, DONE, no run, `--decisions 0`, blank `--by`), exit 1, cause, three files byte-identical | pass |
| 3 | `acceptance 3`: PAST names `aidlc goal extend` and `aidlc card next`; FAR names `aidlc card next` only; deadline unchanged | pass |
| 4 | `acceptance 4`: second call on a CARDS goal exits 1 with `the card run is in BUILD, not in STOP`, one continuation | pass |
| 1, 3 | `R3 decision 1, F1`: `--no-json` line holds state, continued, readmitted (true, and false on a two-card goal not stopped), `at`, `by`, `reason`, the stop, decisions and admits, `aidlc card next` | pass |
| 5 | DoD: the three files unchanged, build and bench exit 0 | pass |
| 6 | docs/OPERATIONS.md Continuations paragraph and `review` row, README Limits row, `changelog.d/T1-CONTINUE-COMMAND.md` | reviewer |

Guard sweep (each loosened in `src/cli/main.ts`, this file run, restored):
- G1 `continue` exception dropped from `checkedGoal` (`guard === 'rule'` only): acceptance 1 to 4 and F1 fail.
- G2 `late` forced false: acceptance 3 fails. G3 `--decisions` passed when absent (`Number(undefined)`): acceptance 1 to 4 and F1 fail. G5 the `decisions` clause of the human line dropped: F1 fails.
- equivalent: G2b `<=` to `<`: differs only when the deadline equals the real clock to the millisecond. G4 `checkedGoal` guard `false`: `continueCard` makes the same `terminalGoalRefusal(goal, 'continue')` check with the same message before any read. G5b that clause printed always: every continuation the runner records lifts a review stop and carries `decisions`.

R3 decision 1 (candidate eee70721, block), repair attempt 2. RED: commit 2ea2774e; test "R3 decision 1, F1" failed on `continued=true` absent from the human line.
- F1 (incomplete-human-continuation-output): the human line states the state, `continued` and `readmitted` as true or false, the whole continuation and `next`.
- F2 (recovery-assumes-stopped-goal): the failure bullet of Continuations states the stopped and the not-stopped goal apart; the two sentences that called `aidlc review rule` the one command on a stopped goal name `aidlc card continue` beside it.
