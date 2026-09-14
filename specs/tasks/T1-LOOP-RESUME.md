---
id: T1-LOOP-RESUME
title: A recorded extension re-admits the goal and its time-stopped cards; goal resume carries a projection revision so a stopped goal continues with replacement cards
status: merged
branch: T1-LOOP-RESUME
worktree: C:\wt\T1-LOOP-RESUME
allow_paths:
  - src/loop/controller.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - src/core/deadlines.ts
  - tests/scenarios/deadline.test.ts
  - tests/scenarios/amendment.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/core/deadlines.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-LOOP-RESUME.md
dod_command: npm run typecheck && node --test tests/scenarios/deadline.test.ts tests/scenarios/amendment.test.ts tests/core/deadlines.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a goal deadline is extended to a later time, the loop shall re-admit the goal (its time stop and terminal flag cleared, re-entering through CARDS so the projection is re-validated and, for T2, re-authorized before any dispatch) and every card run of its current projection stopped for time, moving each such card's deadline to the new goal deadline and journaling the re-admission; a card stopped for any other reason, or outside the current projection, stays stopped.
  - R2. WHEN a terminal goal is resumed with a revision (text, cards or replacements), the loop shall apply the revision inside the resume, before the projection, so the replacement cards run in the resumed generation.
  - R3. The loop shall refuse an amendment on a terminal goal with a message that names the resume with a revision.
acceptance:
  - 1. `aidlc goal extend --until <later>` (an ISO-8601 UTC timestamp) on a goal stopped for time clears the goal stop and terminal flag and re-enters the goal through CARDS, so the projection check and the T2 checkpoint apply before any dispatch and the controller waits on the re-admitted cards instead of re-stopping; each card run of the current projection whose stop reason is `time` gets `stop` cleared, its state in progress again and `deadline` set to the new goal deadline, with a `CARD_STATE` event naming the extension; a card stopped for another reason, or outside the current projection, keeps its stop; the extension itself stays recorded and refuses an earlier date, an unparsable one or an offset form (deadline.test.ts, deadlines.test.ts). [R1] [dod arm 1]
  - 2. `aidlc goal resume <id> --text <text> [--cards <ids>] [--replace <map>] [--reason <text>]` applies the revision inside the resume (validated in full, replacement ids checked against the registry, a `GOAL_REVISED` event follows `GOAL_TAKEOVER`), re-enters through CARDS with the completion evidence of the old projection reset, and the resumed goal's first directive dispatches the replacement card, for a DONE goal too; delivery evidence of an earlier generation is never reused; a resume without a revision behaves as before (amendment.test.ts). [R2] [dod arm 1]
  - 3. `aidlc goal amend` and `aidlc report --result revision` on a terminal goal fail with a message that names `goal resume --text ... --replace ...` (amendment.test.ts). [R3] [dod arm 1]
  - 4. `docs/OPERATIONS.md` (extend, resume) and `docs/ARCHITECTURE.md` (deadline extension and resume semantics) are updated; CHANGELOG.md Unreleased carries the entry. [dod arm 1]
plan_ref: plans/loop-integration.md#7
budget: 400
tdd: true
sweep: "grep -rn 'extendDeadline\|result: .resume.\|case .resume.\|GOAL_TAKEOVER\|makeStop(.time.' src tests docs: controller.ts extendDeadline and the resume and revision cases, card-runner.ts time stops, main.ts extend and resume commands, deadline.test.ts, amendment.test.ts, OPERATIONS.md deadlines and STOP table, ARCHITECTURE.md goal machine"
non_goals: [changing the 3h card limit or the 12h arc, automatic extensions, session identity across concurrent sessions, clearing stops of any other reason]
doc_sync: docs/OPERATIONS.md (extend and resume), docs/ARCHITECTURE.md (deadline extension, resume), CHANGELOG.md
---

# T1-LOOP-RESUME

## Deliverable
Two recovery gaps found while running the loop on itself. A recorded `goal extend` moves the goal deadline but leaves the goal's time stop and every card's persisted time stop in place, so the extension the STOP narration asks for changes nothing; the fix re-admits the goal and its time-stopped cards under the new deadline. `goal resume` re-projects the goal at once and stops again when a card is stopped, while `goal amend` is refused on a terminal goal, so a stopped goal cannot be re-planned; the fix lets the resume carry the revision (text, cards, replacements) and applies it before the projection.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/deadline.test.ts tests/scenarios/amendment.test.ts tests/core/deadlines.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: the deadline, amendment and flow scenario tests pass, including the new assertions that an extension re-admits the goal and its time-stopped cards, that a resume applies its revision before the projection, and that an amendment on a terminal goal names the resume.
