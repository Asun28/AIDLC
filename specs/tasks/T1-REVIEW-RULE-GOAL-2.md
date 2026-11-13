---
id: T1-REVIEW-RULE-GOAL-2
title: "(replaces T1-REVIEW-RULE-GOAL) `aidlc review rule` runs on a goal stopped for review and re-admits it when the ruling lifts the card's stop; the stop narration, `aidlc review findings` and the installed instructions name the ruling as the owner's"
status: todo
branch: T1-REVIEW-RULE-GOAL-2
worktree: D:\wt\AIDLC\T1-REVIEW-RULE-GOAL-2
plan_ref: plans/review-ruling.md#order-of-work
allow_paths:
  - src/core/card-goal.ts
  - src/loop/controller.ts
  - src/loop/card-runner.ts
  - src/audit/verifier.ts
  - src/cli/main.ts
  - tests/scenarios/review-rule-goal.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - CLAUDE.md
  - templates/CLAUDE.aidlc.md
  - specs/tasks/T1-REVIEW-RULE-GOAL-2.md
dod_command: npm run typecheck && node --test tests/scenarios/review-rule-goal.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/card-terminal-goal.test.ts tests/scenarios/fault-points.test.ts tests/surface/verifier.test.ts tests/surface/claude-md-size.test.ts tests/surface/templates.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `aidlc review rule` shall run when the goal is in STOP with stop reason `review`, and exit non-zero with no write when the goal is DONE or is terminal or stopped for any other reason.
  - R2. WHEN a ruling lifts a card's stop and the goal is in STOP with stop reason `review`, THEN the command shall re-admit the goal (not terminal, no stop, state CARDS) and append one `GOAL_STATE` event from `STOP` to `CARDS` whose data carries `ruling` with the card id and `by`.
  - R3. `aidlc audit verify` shall end the terminal disposition of a `GOAL_STOPPED` for `review` at a `GOAL_STATE` event from `STOP` to `CARDS` of the same generation only when that event carries `ruling`, and shall leave every other case of that accounting as it is.
  - R4. `aidlc review findings` shall show the ruling of a ruled finding (decision, `by`, reason, issue) in its text line and in its JSON output.
  - R5. The `nextAction` of a stop for review that an R3 block decision records shall name `aidlc review rule` with `--reject` and `--defer` and say that the ruling is the owner's.
  - R6. `CLAUDE.md` (the aidlc section, Hard limits) and `templates/CLAUDE.aidlc.md` shall carry the same line, that a review ruling is recorded only on the owner's instruction in the session.
  - R7. `docs/OPERATIONS.md` (STOP reasons, the rule for a goal that takes no card work) and `CHANGELOG.md` shall state R1 to R5.
  - R8. IF the card's stop is lifted, the goal is still in STOP with stop reason `review`, and `aidlc review rule` is run again with well-formed options for a ruled finding of the lifted decision, THEN the command shall complete the re-admission with the `by` of the lift, write no ruling and leave exactly one `GOAL_STATE` event from `STOP` to `CARDS` after the goal's last `GOAL_STOPPED`.
acceptance:
  - 1. `tests/scenarios/review-rule-goal.test.ts`, on a one-card goal whose card stopped at R3 and whose `aidlc next` then stopped the goal for `review`. A ruling that settles one of two findings is recorded and the goal stays in STOP; `review dispute` on the same goal is still refused. [R1] [dod arm 1]
  - 2. Same file. The ruling that lifts the card's stop leaves the goal not terminal, without a stop, in CARDS, with one `GOAL_STATE` event from `STOP` to `CARDS` whose data carries `ruling` with the card id and `by`. `aidlc next` then returns a `wait` on the card in SHIP with the goal out of STOP (the card run is in progress, so nothing is dispatched again), `aidlc card next` is admitted, and the dry-run ship merges the unchanged candidate. [R2] [dod arm 1]
  - 3. Same file. `aidlc review rule` exits non-zero and writes nothing on a DONE goal, a cancelled goal and a goal stopped for `time`. [R1] [dod arm 1]
  - 4. Same file. After the ruled ship `aidlc audit verify` reports no `WORK_AFTER_TERMINAL`. Rows on journals written through the journal API, each a `GOAL_STOPPED`, a `GOAL_STATE` from `STOP` to `CARDS` and a later dispatch: a stop for `review` with `ruling` on the event reports none; a stop for `review` without `ruling` reports one; a stop for `risk` with `ruling` reports one; a stop for `review` in another generation than the event reports one. [R3] [dod arm 1]
  - 5. Same file. `aidlc review findings` prints `ruled rejected by <who>` on the finding's line and carries `ruling` in `--json`. [R4] [dod arm 1]
  - 6. Same file. The stop directive of a card stopped by an R3 block decision carries a `nextAction` that names `aidlc review rule`, `--reject` and `--defer`, and holds the words `the owner's`. [R5] [dod arm 1]
  - 7. `tests/surface/claude-md-size.test.ts` and `tests/surface/templates.test.ts` pass, and the line of R6 is byte-identical in the two files (reviewer-verified against the diff). [R6] [dod arm 3]
  - 8. `tests/scenarios/review-rule-ship.test.ts`, `tests/scenarios/review-rule.test.ts`, `tests/scenarios/card-terminal-goal.test.ts`, `tests/scenarios/fault-points.test.ts` and `tests/surface/verifier.test.ts` pass unchanged. [dod arm 1] [dod arm 2]
  - 9. The docs and CHANGELOG state R1 to R5 (reviewer-verified against the diff). [R7]
  - 10. `tests/scenarios/review-rule-goal.test.ts`, fault rows, driven in process through the method the command calls. With a throw from `fs.appendFileSync` onto the goal journal at the `GOAL_STATE` append, and separately with a throw from the write of the goal record, the call fails with the card's stop lifted and the goal in STOP; the same ruling made again succeeds, writes no ruling, leaves the goal in CARDS and the journal with exactly one `GOAL_STATE` event from `STOP` to `CARDS`. [R8] [dod arm 1]
depends_on: [T1-REVIEW-RULE-SHIP]
budget: 400
size_exception: "approved by the owner (asun28) in the session of 2026-11-13, in reply to the stop report of T1-REVIEW-RULE (option a: budgets of 400 for the two unstarted cards of the plan), given for T1-REVIEW-RULE-GOAL and carried to this card, which replaces it with the same scope: the predecessor of T1-REVIEW-RULE-2 was planned at 250 and came to 370 changed lines, most of them scenario tests with their fault rows; this card has about 90 lines in src/ (the exception to the goal refusal, the re-admission and its rerun, the audit rule, the findings line, the narration) and about 250 of tests"
sweep: "On main at 3548e757. The goal stop: src/loop/controller.ts:401 to :405 stops the goal with the reason of its first stopped card. The re-admission pattern: `extendDeadline` src/loop/controller.ts:901, the goal part at :914 to :919. The audit rule: src/audit/verifier.ts, the `GOAL_STATE` branch of the terminal accounting loop (about :99), which today requires reason `time`. The refusal of card commands on a goal in STOP is the rule of card T0-CARD-TERMINAL-GOAL-2 (docs/OPERATIONS.md, the paragraph that starts `A goal that is terminal`); `review rule` becomes its one exception. The stop text: src/loop/card-runner.ts:2316 (the decision) and src/core/card-machine.ts:110 (not in allow_paths, not changed: the narration is built in the runner). `findingLine` in src/cli/main.ts prints a finding."
forbid: [weakening or skipping a test to go green, a change to tests/surface/verifier.test.ts or tests/scenarios/card-terminal-goal.test.ts, a change to tests/scenarios/fault-points.test.ts or tests/scenarios/journal-owed.test.ts, re-admitting a goal stopped for another reason, letting another card command run on a stopped goal, moving a deadline, a change to REVIEW.md, editing .aidlc state by hand]
non_goals: [an entry in the verify-card-run-writes record (the file is at its 8000-byte cap; this card adds no card-run write, and its goal write and `GOAL_STATE` append have the fault rows of acceptance 10), a re-admission after a review stop by a `GOAL_STATE` event without `ruling` (the audit keeps counting work after it, as tests/surface/verifier.test.ts pins), a hook that refuses the command, a check of who typed it, review statistics of rulings, a change to `card-loop.md` or `SKILL.md` (both within 12 bytes of their caps), a goal with a second card stopped for review (it is re-admitted and `aidlc next` stops it again on that card), creating a GitHub issue]
hygiene: "This card replaces T1-REVIEW-RULE-GOAL, whose run started on 2026-11-13 and built nothing: before writing a test the implementer found that acceptance 2 said `aidlc next` dispatches the card after the lift, while the controller waits on a run that is in progress (`outcomeOf` in src/state/board.ts reads SHIP as running and `selectArc` skips it, as after `aidlc goal extend`). A started card is not edited, so this card restates acceptance 2, names `nextAction` in R5 and acceptance 6 (the directive narration is the stop detail), and states the rerun of R8 by the state it finds. Nothing else differs. Line numbers are from main at 3548e757; read them again at PREPARE. Checked on main at afe4fc92 before the start: the refusal of card commands on a stopped goal is `terminalGoalRefusal` in src/core/card-goal.ts:51, with its rows in tests/scenarios/card-terminal-goal.test.ts; tests/surface/verifier.test.ts:194 pins that a plain `GOAL_STATE` from STOP to CARDS after a stop for review re-admits nothing, which R3 keeps by requiring `ruling` on the event; tests/surface/verifier.test.ts:212 and tests/scenarios/journal-owed.test.ts pin whole sentences of docs/OPERATIONS.md, so add sentences and edit none that a test pins. Drive acceptance 2 through `aidlc next` of the controller, not through the runner alone (the lesson of T1-REVIEW-RULE-SHIP). `CLAUDE.md` stays within 200 lines (178 now). This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (STOP reasons), CHANGELOG.md
---

# T1-REVIEW-RULE-GOAL-2

## Deliverable
The ruling works on a real stopped goal from end to end, and every place a session reads about a stop for review says whose decision it is.

## Why
`specs/review-ruling.md`. `aidlc next` stops the goal with the reason of its stopped card, and card commands refuse a goal in STOP, so without this card the ruling of T1-REVIEW-RULE-SHIP cannot be recorded once the goal has stopped. The audit counts work after a stop as a blocking finding unless a recorded re-admission ends it.

## Rules that decide edge cases
- The goal is re-admitted only by the ruling that lifts a card's stop, in the same command.
- Re-entry runs through CARDS, as after `aidlc goal extend`.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-rule-goal.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/fault-points.test.ts tests/surface/claude-md-size.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every test of the five files passes and the typecheck reports no error.

## Attempt evidence
Attempt 1. Tests are in `tests/scenarios/review-rule-goal.test.ts`; "DoD" is the `dod_command`, exit 0, 116 tests passed and 0 failed. No row sets a stored field by hand. 18 source mutants, one per condition of the new code, each fail a test.

| Item | Proof | Result |
|---|---|---|
| RED | commit 41945d72 holds the test file alone; all 5 tests failed on main: test 1 at `:122` (`the nextAction names aidlc review rule`), test 2 on `1 mutation event(s) after terminal disposition` for the review stop with `ruling`, tests 3 to 5 on `fx.controller.ruleFinding is not a function` | failed as required |
| 1 | test "acceptance 1, 2, 4, 5 and 6": the goal is stopped by `GoalController.next`; CLI `review dispute` exits 1 and the goal record, journal and card run keep their bytes; the CLI ruling of F1 leaves the goal record byte-identical and appends no `GOAL_STATE` | pass |
| 2 | same test: the CLI ruling of F2; the goal record compared whole (`stop` gone, `terminal` false, `CARDS`, `updatedAt` later, `revision` equal); one event with `ruling: { cardId, by }`; `GoalController.next` returns `wait` on `T1-RG:SHIP` with the goal in `WAIT` and one `CARD_DISPATCHED`; `CardRunner.next` ships `T1-RG-sha-2`; CLI `card next` exits 0 | pass |
| 3 | test "acceptance 3": the CLI and the controller method on a DONE goal (reached by the loop, no reviewer), a cancelled goal and a goal `aidlc next` stopped for time; the three files keep their bytes | pass |
| 4 | test "acceptance 1, 2, 4, 5 and 6": after the ship, `verifyAudit` (the function `aidlc audit verify` calls) on the goal's journal and operations, with an `OPERATION_ISSUED` after the `GOAL_STOPPED`; test "acceptance 4, journal rows": six rows through `Journal.append` | pass |
| 5 | test "acceptance 1, 2, 4, 5 and 6": `ruling` in the JSON of CLI `review findings`; the text line through the exported `findingLine`, which the command prints with (the CLI prints JSON when stdout is not a terminal) | pass |
| 6 | same test: `stop.nextAction` of the card's stop directive | pass |
| 7 | DoD (`claude-md-size.test.ts`, `templates.test.ts`); the line is one physical line, the same in both files | pass |
| 8 | DoD; none of the five files is changed | pass |
| 9 | `docs/OPERATIONS.md` (Rulings, Audit, STOP reasons, the paragraph "A goal that is terminal") and `CHANGELOG.md` (Unreleased) | for the reviewer |
| 10 | test "acceptance 10": `GoalController.ruleFinding` with the fixture clock, each fault, the rerun, then `aidlc next` and the ship (append row) or CLI `card next` (record row); test "R8, the goal's last GOAL_STOPPED": two cards, two stops, two events | pass |
