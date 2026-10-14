---
id: T1-SWEEP2-FIX-TASK
title: "`aidlc card fix-task --clear` deletes the fix-task marker so test files unlock, and the uncalled `CardRunner.setFixTaskMarker` goes"
status: merged
branch: T1-SWEEP2-FIX-TASK
worktree: D:\wt\AIDLC\T1-SWEEP2-FIX-TASK
plan_ref: plans/dead-code-sweep-2.md#order-of-work
allow_paths:
  - src/cli/main.ts
  - src/loop/card-runner.ts
  - docs/ARCHITECTURE.md
  - tests/surface/fix-task-clear.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP2-FIX-TASK.md
dod_command: npm run typecheck && node --test tests/surface/fix-task-clear.test.ts tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `aidlc card fix-task --clear` runs, the CLI shall delete the `fix-task` file under the state directory (no error when it is absent), so that `fixTaskMarker` returns undefined and the protect-tests hook admits an edit of a test file; `aidlc card fix-task [<id>]` still writes the marker, and an existing marker file, empty or not, still reads as active.
  - R2. `CardRunner` (`src/loop/card-runner.ts`) shall not define `setFixTaskMarker`, which nothing has called, and the `fix-task` row of the state table in `docs/ARCHITECTURE.md` shall name only the CLI `card fix-task` as its writer.
  - R3. The CHANGELOG Unreleased section shall carry an entry naming this card, the fix, the removed method, and that a stale empty marker left by an earlier `--clear` is removed by running `aidlc card fix-task --clear` once more.
acceptance:
  - 1. `tests/surface/fix-task-clear.test.ts` spawns `node bin/aidlc.js card fix-task T1-X` in a temp repository with `AIDLC_STATE_DIR` set, then `node bin/aidlc.js card fix-task --clear`: both exit 0, the `fix-task` file no longer exists, and `fixTaskMarker(<cwd>, <env>)` returns undefined (before the clear it returns `T1-X`); `protectTests` admits an Edit of a test file after the clear and blocks it before. [R1] [dod arm 2]
  - 2. The same file: `--clear` with no marker present exits 0 and creates no file; an empty `fix-task` file written by hand still makes `fixTaskMarker` return `fix-task`. [R1] [dod arm 2]
  - 3. The same file: `CardRunner.prototype` has no `setFixTaskMarker`; `docs/ARCHITECTURE.md`'s `fix-task` row names `card fix-task` and not `loop/card-runner.ts`; the CHANGELOG Unreleased section has a T1-SWEEP2-FIX-TASK entry. [R2] [R3] [dod arm 2]
  - 4. `tests/surface/hooks.test.ts` passes (dod arm 3); that none of its assertions changed is reviewer-verified against the diff. [R1] [dod arm 3]
depends_on: []
budget: 140
tdd: true
diagnosis:
  root_cause: "`card fix-task --clear` (`src/cli/main.ts:591`) writes an empty string to the marker file instead of deleting it, and `fixTaskMarker` (`src/hooks/index.ts:481`) returns `'fix-task'` for any marker file that exists, so after a clear the protect-tests hook still reads an active fix-task and keeps test files locked."
  same_class: "The uncalled `CardRunner.setFixTaskMarker` (`src/loop/card-runner.ts:2685`) clears the same way; it is removed. `AIDLC_FIX_TASK` is read from the environment and has no clear path in aidlc."
sweep: "grep -rn \"'fix-task'\\|fixTaskMarker\\|setFixTaskMarker\" src tests docs: writers are src/cli/main.ts:591 and the uncalled src/loop/card-runner.ts:2685; the only reader is src/hooks/index.ts:476-485 (used by protect-tests at :308 and :468)."
forbid: [changing fixTaskMarker or protectTests in src/hooks/index.ts, reading an empty marker as cleared, changing an assertion in tests/surface/hooks.test.ts]
non_goals: ["a doctor warning for a stale empty marker"]
hygiene: "Fail closed: the reader keeps 'file present = active', so a hand-made marker still locks; only the writer changes."
doc_sync: docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-SWEEP2-FIX-TASK

## Deliverable
`aidlc card fix-task --clear` deletes the marker file, so the protect-tests hook unlocks test files after a clear. The uncalled `CardRunner.setFixTaskMarker`, which had the same defect, is removed, and the ARCHITECTURE state table names the CLI as the marker's only writer.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/fix-task-clear.test.ts tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
