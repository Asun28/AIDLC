---
id: T1-LOOP-LESSONS
title: Lessons are read at PREPARE and become a closure predicate with an explicit disposition recorded by aidlc card close
status: todo
branch: T1-LOOP-LESSONS
worktree: C:\wt\T1-LOOP-LESSONS
allow_paths:
  - src/artifacts/lessons.ts
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/loop/controller.ts
  - src/cli/main.ts
  - tests/surface/lessons.test.ts
  - tests/core/types.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/_harness.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-LOOP-LESSONS.md
dod_command: npm run typecheck && node --test tests/surface/lessons.test.ts tests/core/types.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/t1-arc.test.ts
dod_exit: 0
requirements:
  - R5. WHEN a card enters PREPARE, the loop shall provide the lessons file reference and its recent entries.
  - R6. WHILE a card has no lesson disposition, the loop shall keep lessons among the missing closure steps.
acceptance:
  - 1. `src/artifacts/lessons.ts` validates the frozen line format (`- YYYY-MM-DD <ref>: NEVER|ALWAYS|NOTE <rule> (source: <ref>)`), appends one line per call without rewriting past lines, creates the file from an embedded header when it is missing, and reads the count and recent entries (lessons.test.ts). [R6] [dod arm 1]
  - 2. The prepare directive carries `lessons` with the file path, the count and the recent entries read from `<mainRoot>/docs/LESSONS.md` (t0-flow.test.ts). [R5] [dod arm 1]
  - 3. `CardRun.closure.lessons` defaults to false; the close directive lists `lessons` until `markClosure` records a lesson (one appended line) or a skip reason, both journaled as `EVIDENCE_RETAINED`; `aidlc card close --lesson <text>` and `--skip-lesson <why>` drive it (commander reserves the `--no-` prefix for boolean negation, so the skip flag is `--skip-lesson`) and `--all` leaves it untouched (types.test.ts, t0-flow.test.ts). [R6] [dod arm 1]
  - 4. The goal-level CLOSE narration names `lessons`; `docs/ARCHITECTURE.md` closure description and `docs/OPERATIONS.md` card close usage are updated; CHANGELOG.md Unreleased carries the entry. [dod arm 1]
plan_ref: plans/loop-integration.md#7
budget: 600
tdd: true
sweep: "grep -rn 'closure' src tests docs: types.ts closure object, card-runner.ts close and markClosure, controller.ts goal CLOSE, main.ts card close flags, _harness.ts driveCardToDone, t0-flow.test.ts closure literals, card-machine.test.ts closureComplete, ARCHITECTURE.md closure text"
non_goals: [editing card-loop.md, rewriting or deleting past lesson lines, a dedicated lessons journal event type, lessons for release attempts]
doc_sync: docs/ARCHITECTURE.md (closure), docs/OPERATIONS.md (card close), CHANGELOG.md
---

# T1-LOOP-LESSONS

## Deliverable
A lessons artifact module owns the frozen line format and the append-only file. PREPARE hands the card the file reference with its recent entries. `lessons` becomes the sixth closure predicate: the card cannot reach DONE until `aidlc card close` records either a lesson line or a reason to skip, and `--all` never clears it silently.

Budget raised from 300 to 450 at R3 decision 1: the reviewer asked for append-only bytes with exclusive creation, shared strict validation, fenced CLOSE-only closure writes, journal-before-write with an idempotent retry, and the CLI-level tests R2 asked for; the reviewed change is 417 net lines. Raised again to 600 after the second R3 decision under the fresh goal (580 net lines): the raw-patch guard, the stored-run close, the ownership stop reconciliation, the legacy goal closure and the lease-serialised disposition, with the file lock removed.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/lessons.test.ts tests/core/types.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/t1-arc.test.ts
```
- Expected exit code: 0
- Assertion: the lessons, types and scenario tests named above pass, including the new assertions for the prepare context, the sixth closure predicate and the two dispositions.
