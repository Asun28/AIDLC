---
id: T0-WAIT-VERIFY
title: A goal parked in WAIT resumes to RUN before VERIFY_ARC once its required cards are closed, instead of throwing an illegal WAIT -> VERIFY_ARC transition
status: merged
branch: T0-WAIT-VERIFY
worktree: C:\wt\T0-WAIT-VERIFY
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-WAIT-VERIFY.md
dod_command: npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/scenarios/deadline.test.ts tests/scenarios/t1-arc.test.ts tests/core/goal-machine.test.ts
dod_exit: 0
acceptance:
  - 1. With the goal in WAIT (its only card stopped), after the card recovers and closes, `controller.next` returns `verify-arc` and journals WAIT -> RUN -> VERIFY_ARC; it no longer throws GoalTransitionError (t0-flow.test.ts "WAIT resumes"). [dod arm 1]
  - 2. `report --result card-result` on a WAIT goal whose cards are closed no longer crashes for the same reason (same code path, covered by acceptance 1). [dod arm 1]
  - 3. Existing arc, deadline and goal-machine tests unchanged and green; the state diagram is not widened. [dod arm 1]
budget: 80
tdd: true
diagnosis:
  root_cause: "GoalController.nextInRun checks 'required cards closed -> VERIFY_ARC' before it resumes a WAIT goal to RUN. The diagram allows RUN -> VERIFY_ARC and WAIT -> RUN, never WAIT -> VERIFY_ARC, so a goal parked in WAIT while its only card was stopped can never finish after the card recovers: `aidlc next`, `aidlc report` and `aidlc card report` all throw. Observed on g-20260910195706-5444ca after T0-LOOP-SPEED recovered from STOP/ownership."
  same_class: "The WAIT -> RUN resumption for dispatchable work already exists later in nextInRun; only the closed-cards branch lacked it. VERIFY_ARC -> CLOSE/DELIVER and CLOSE -> DONE are derived transitions and unaffected."
doc_sync: docs/ARCHITECTURE.md goal state machine note, CHANGELOG.md
---

# T0-WAIT-VERIFY

## Deliverable
`nextInRun` resumes a WAIT goal to RUN (journaled) before deriving VERIFY_ARC when every required card is closed. No new edge in the diagram.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/scenarios/deadline.test.ts tests/scenarios/t1-arc.test.ts tests/core/goal-machine.test.ts
```
- Expected exit code: 0
- Assertion: the new t0-flow test reaches verify-arc from WAIT; arc, deadline and goal-machine suites unchanged and green.
