---
id: T0-EVAL-WORDING
title: "The trials total line counts case runs, and the evals docs say that a recorded empty tool-call list passes the negative tool-call checks"
status: todo
branch: T0-EVAL-WORDING
worktree: D:\wt\AIDLC\T0-EVAL-WORDING
allow_paths:
  - src/evals/runner.ts
  - tests/surface/evals.test.ts
  - docs/OPERATIONS.md
  - evals/README.md
  - templates/evals/README.md
  - CHANGELOG.md
  - specs/tasks/T0-EVAL-WORDING.md
dod_command: npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/command-lines.test.ts
dod_exit: 0
requirements:
  - R1. `formatTrials` (`src/evals/runner.ts`) shall print each side of the `total over <n> trials:` line as `<passed> of <runs> case runs`, where `<runs>` is the sum of that side's per-case `trials` in the report, in place of `<passed>/<trials>`. The per-case lines, the verdict line, the `stopped:` and `left:` lines and the JSON report shall be what they are before this card.
  - R2. The Evals section of `docs/OPERATIONS.md`, the comment above the tool-call checks in `runEval`, and `evals/README.md` with its copy `templates/evals/README.md` shall state that with no model run every tool-call check fails with `no model run`, that after a provider whose result has no `toolCalls` every one fails with `no tool calls recorded`, and that a recorded empty list of tool calls passes `not-ran-command` and `not-wrote-path` and fails `read-file` and `ran-command`. The OPERATIONS sentence `A tool-call check never passes without tool calls` shall be removed.
  - R3. The CHANGELOG Unreleased section shall state R1 under this card id.
acceptance:
  - 1. `tests/surface/evals.test.ts`: `formatTrials` of a report of two cases over three trials with the variant `main`, every run passing on HEAD and none on `main`, prints the total line `total over 3 trials: HEAD 6 of 6 case runs (median 1.00, 1.00 to 1.00), 0 model errors, 0 quota holds; "main" 0 of 6 case runs (median 0.00, 0.00 to 0.00), 0 model errors, 0 quota holds`, and the case lines keep `3/3` and `0/3`. Fails before the fix. [R1] [dod arm 1]
  - 2. Same file: a report without a variant whose two cases ran 3 and 2 trials, all passing, prints `HEAD 5 of 5 case runs` on its total line. Fails before the fix. [R1] [dod arm 1]
  - 3. Same file: a scripted provider whose result has `toolCalls: []` passes `not-ran-command` and `not-wrote-path` and fails `read-file` and `ran-command`; one whose result has no `toolCalls` fails all four with `no tool calls recorded`. [R2] [dod arm 1]
  - 4. `tests/surface/command-lines.test.ts` passes: the two evals READMEs stay identical. [R2] [dod arm 2]
  - 5. The docs, the comment and the CHANGELOG state R2 and R3 (reviewer-verified against the diff). [R2] [R3]
depends_on: []
budget: 80
tdd: true
sweep: "grep -rn 'never passes without\\|no tool calls recorded' docs evals templates src; `formatTrials` src/evals/runner.ts:513 (total line :519), the tool-call check comment :259. Lines are from main at 19b0da8; read them again at PREPARE. Both items are R3 advisories: PR 235 (T1-EVAL-TRANSCRIPT-2, second pass) and T1-EVAL-VARIANT decision 2 at b9d4ced."
forbid: [weakening or skipping a test, a change to the JSON trials report or to the result of any check, editing .aidlc state by hand]
non_goals: [making an empty tool-call list fail the negative checks, the per-case line format, the verdict wording]
doc_sync: docs/OPERATIONS.md, evals/README.md, templates/evals/README.md, CHANGELOG.md
---

# T0-EVAL-WORDING

## Deliverable
`aidlc evals run --variant <ref> --trials 3` prints `HEAD 6 of 6 case runs` on its total line where it printed `HEAD 6/3`, and the evals docs state what an empty tool-call list does.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/evals.test.ts tests/surface/command-lines.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
