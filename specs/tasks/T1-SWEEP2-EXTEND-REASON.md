---
id: T1-SWEEP2-EXTEND-REASON
title: "`GoalController.extendDeadline` builds the extension with the core `extendDeadline` rule, so a blank reason is refused before anything is written"
status: merged
branch: T1-SWEEP2-EXTEND-REASON
worktree: D:\wt\AIDLC\T1-SWEEP2-EXTEND-REASON
plan_ref: plans/dead-code-sweep-2.md#order-of-work
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/extend-reason.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP2-EXTEND-REASON.md
dod_command: npm run typecheck && node --test tests/scenarios/extend-reason.test.ts tests/scenarios/extend-running-card.test.ts tests/scenarios/deadline.test.ts tests/core/deadlines.test.ts
dod_exit: 0
requirements:
  - R1. IF the reason passed to `GoalController.extendDeadline` (`src/loop/controller.ts`) is empty or only whitespace, THEN it shall throw `extension requires a recorded reason` before it writes the goal, a card run or a journal entry.
  - R2. `GoalController.extendDeadline` shall build the extended deadlines with the core `extendDeadline` (`src/core/deadlines.ts`), so the later-deadline and reason checks have one implementation; the controller keeps its own ISO-shape and calendar checks, which run first, and its re-admission of time-stopped goals and cards is unchanged.
  - R3. The Deadline extensions section of `docs/OPERATIONS.md` shall state that a blank reason is refused, and the CHANGELOG Unreleased section shall carry an entry naming this card.
acceptance:
  - 1. `tests/scenarios/extend-reason.test.ts`: with the scenario harness, `controller.extendDeadline(goal, 'lead', <later ISO>, '   ')` and with `''` throw `extension requires a recorded reason`; afterwards the goal record, every card run and the journal are byte-identical to before the call. [R1] [dod arm 2]
  - 2. The same file: an earlier deadline still throws `extension must move the deadline later`, and a valid call records exactly one extension whose `reason` is the given text. [R2] [dod arm 2]
  - 3. `tests/scenarios/extend-running-card.test.ts`, `tests/scenarios/deadline.test.ts` and `tests/core/deadlines.test.ts` pass (dod arms 3, 4, 5); that none of their assertions changed is reviewer-verified against the diff. [R2] [dod arms 3, 4, 5]
  - 4. The same new file reads the blank-reason sentence in `docs/OPERATIONS.md` and a T1-SWEEP2-EXTEND-REASON entry in the CHANGELOG Unreleased section. [R3] [dod arm 2]
depends_on: []
budget: 120
tdd: true
diagnosis:
  root_cause: "`GoalController.extendDeadline` (`src/loop/controller.ts:699`) builds the extension record itself and repeats only the later-deadline check of the core `extendDeadline` (`src/core/deadlines.ts:74`), which nothing in src/ calls; the core function's blank-reason check never runs, and commander's `requiredOption('--reason')` accepts a whitespace value."
  same_class: "No other caller writes `deadlines.extensions`: grep -rn 'extensions' src shows the controller and the core function only."
sweep: "grep -rn 'extendDeadline' src: the core function (src/core/deadlines.ts:74, no src caller), the controller method (src/loop/controller.ts:699) and its CLI caller (src/cli/main.ts:274)."
forbid: [changing the core extendDeadline rules, changing the re-admission of stopped goals or cards, changing an assertion of an existing test]
non_goals: ["trimming or rewriting a valid reason"]
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-SWEEP2-EXTEND-REASON

## Deliverable
`aidlc goal extend` refuses a blank `--reason` before writing anything, because the controller now builds the extension with the core `extendDeadline` rule instead of a copy that lacked the reason check.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/extend-reason.test.ts tests/scenarios/extend-running-card.test.ts tests/scenarios/deadline.test.ts tests/core/deadlines.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
