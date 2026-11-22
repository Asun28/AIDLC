---
id: T1-CONTINUE-AUDIT
title: "The stopped-goal refusal lets a continuation through for review and ci, and the audit ends a goal stop on an event that carries the continuation"
status: todo
branch: T1-CONTINUE-AUDIT
worktree: D:\wt\AIDLC\T1-CONTINUE-AUDIT
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/core/card-goal.ts
  - src/audit/verifier.ts
  - tests/core/card-goal.test.ts
  - tests/surface/verifier.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T1-CONTINUE-AUDIT.md
  - specs/tasks/T1-CONTINUE-AUDIT.md
dod_command: npm run typecheck && node --test tests/core/card-goal.test.ts tests/surface/verifier.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/audit.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The function `terminalGoalRefusal` shall take, in the place of its ruling flag, the value `continue`, and for it return no refusal on a goal in STOP whose stop reason is `review` or `ci`.
  - R2. The function `terminalGoalRefusal` shall answer as on main at 212ff184 for the flag `true`, for the flag `false` and for no flag, on every goal.
  - R3. The verifier's terminal accounting shall end a `GOAL_STOPPED` of reason `review` or `ci` on a `GOAL_STATE` event from STOP to CARDS of the same generation whose `continuation` holds a string `cardId` and a string `by`.
  - R4. The verifier's terminal accounting shall keep its rules for a stop for `time`, for an event that carries `ruling` and for a resume, and end no stop of another reason on a `continuation`.
  - R5. The Audit section of `docs/OPERATIONS.md` and the file `changelog.d/T1-CONTINUE-AUDIT.md` shall state R1 to R4 and say that the command arrives with T1-CONTINUE-GOAL.
acceptance:
  - 1. `tests/core/card-goal.test.ts`. With `continue`, `terminalGoalRefusal` returns no refusal for a goal stopped for `review` and for `ci`, and the refusal it returns today for a goal stopped for `time`, `card`, `tool` or `risk`, a cancelled goal and a DONE goal. With `true`, `false` and no flag it returns, for each of those goals, what it returns on main. [R1] [R2] [dod arm 2]
  - 2. `tests/surface/verifier.test.ts`, rows after a `GOAL_STOPPED` for `review` and one for `ci`, each followed by a dispatch. A `GOAL_STATE` from STOP to CARDS with neither `ruling` nor `continuation` leaves `WORK_AFTER_TERMINAL`; so does one whose `continuation` lacks `by`, one whose `cardId` is not a string, and one in another generation; one with a string `cardId` and a string `by` in the same generation ends the stop. After a stop for `card` a `continuation` leaves the finding. After a stop for `ci` a `ruling` leaves the finding. [R3] [R4] [dod arm 2]
  - 3. The typecheck passes, every test `tests/surface/verifier.test.ts` and `tests/core/card-goal.test.ts` hold on main passes with no line of it changed, and `tests/scenarios/review-rule-goal.test.ts` and `tests/scenarios/audit.test.ts` pass with no line changed. [R2] [R4] [dod arm 1] [dod arm 2]
  - 4. The docs state R1 to R4 (reviewer-verified against the diff). [R5]
depends_on: [T1-CONTINUE-REVIEW-2]
budget: 130
sweep: "On main at 212ff184. src/core/card-goal.ts:54-61 is `terminalGoalRefusal(goal, ruling = false)`; its callers pass a boolean and are not changed by this card: src/cli/main.ts:663 (`checkedGoal`) and src/loop/controller.ts:986 (`ruleFinding`). src/audit/verifier.ts:95-98 is `carriesRuling` and :106 the one check that ends a goal stop on a `GOAL_STATE` event; :103-105 is the resume. The Audit section of docs/OPERATIONS.md starts at :600, with `WORK_AFTER_TERMINAL` at :609."
forbid: [weakening or skipping a test to go green, ending a stop of a reason other than review or ci on a continuation, a change to a caller of `terminalGoalRefusal`, editing .aidlc state by hand]
non_goals: [the command and the goal re-admission (T1-CONTINUE-GOAL), the event that carries `continuation` being written by any code of this card, a new journal event type, a check of the owner's delegation]
hygiene: "Line numbers are from main at 212ff184; read them again at PREPARE. Run every test file that reads docs/OPERATIONS.md before the attempt is recorded (git grep -l OPERATIONS.md -- tests): tests/scenarios/review-resolve.test.ts pins a paragraph that ends just before the STOP reasons table, and tests/core/ci-policy.test.ts pins sentences of the file. Run `npm run bench -- --check` after `npm run build` before the first review (docs/OPERATIONS.md, Loop benchmark)."
doc_sync: docs/OPERATIONS.md (Audit)
---

# T1-CONTINUE-AUDIT

## Deliverable
The two rules that let a continuation act on a stopped goal: the refusal of card commands on a stopped goal has an exception for it, and the audit accepts the event that re-admits the goal.

## Why
`specs/card-continuation.md`, R6 and R7. `aidlc next` stops the goal with the stop reason of its stopped card, card commands are refused on a stopped goal, and the audit counts work after a stop as `WORK_AFTER_TERMINAL` unless a recorded authority ended the stop. Split from T1-CONTINUE-GOAL to keep each card within the size limit.

## Rules that decide edge cases
- A continuation ends a goal stop for `review` or `ci` only, in the generation of the stop.
- A ruling still ends a stop for `review` only.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/card-goal.test.ts tests/surface/verifier.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/audit.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck reports no error and every test of the four files passes.
