---
id: T1-AFFECTED-SELECT
title: affectedTests(changedPaths, testFiles) in new src/core/affected.ts returns the test files whose path is a changed path or whose text holds the last two segments of a changed path (the whole path for a root file); pure, called by nothing in src
status: todo
branch: T1-AFFECTED-SELECT
worktree: D:\wt\AIDLC\T1-AFFECTED-SELECT
plan_ref: plans/execution-gate.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/core/affected.ts
  - tests/core/affected.test.ts
  - specs/tasks/T1-AFFECTED-SELECT.md
dod_command: npm run typecheck && node --test tests/core/affected.test.ts
dod_exit: 0
requirements:
  - R1. `affectedTests(changedPaths, testFiles)` (new, exported from new src/core/affected.ts; `changedPaths` a `readonly string[]`, `testFiles` a `readonly { path: string; text: string }[]`) shall return the `path` of each entry of `testFiles` that is selected, in the order of `testFiles`, each path once.
  - R2. An entry shall be selected when its `path` equals a changed path, or when its `text` contains the needle of a changed path as a substring, compared by code unit with the letter case kept; the needle (exported as `needleOf(changedPath)`) is the last two `/`-separated segments joined by `/` for a path with two or more segments, and the path itself for a path with one segment.
  - R3. A changed path that is the empty string or holds only white space shall be ignored, so it selects nothing; with no changed path left, the result is the empty array.
  - R4. src/core/affected.ts shall import nothing (no `node:` module, no other source file) and read no file, clock, environment variable or process state.
acceptance:
  - 1. tests/core/affected.test.ts, new test "T1-AFFECTED-SELECT acceptance 1 - a test file is selected by the last two segments of a changed path, by the whole path of a root file, or by being the changed path itself, and by nothing else". The fixture of Acceptance detail 1; the result deep-equals the listed paths in `testFiles` order. Fails on main (no module). [R1] [R2] [dod arm 2]
  - 2. Same file, new test "T1-AFFECTED-SELECT acceptance 2 - needleOf gives the last two segments, or the path of a root file". `needleOf` of `src/loop/card-runner.ts`, `docs/OPERATIONS.md`, `CHANGELOG.md`, `bench/outcome/views/10-cards.sql` and `a/b` is `loop/card-runner.ts`, `docs/OPERATIONS.md`, `CHANGELOG.md`, `views/10-cards.sql` and `a/b`. Fails on main. [R2] [dod arm 2]
  - 3. Same file, new test "T1-AFFECTED-SELECT acceptance 3 - an empty or blank changed path selects nothing, a test file named by two changed paths is returned once, and no input is changed". `affectedTests([], files)`, `affectedTests([''], files)` and `affectedTests(['  '], files)` are `[]`; two changed paths that both select one file return it once; the two input arrays, frozen with `Object.freeze` together with each entry, are accepted and deep-equal their copies afterwards. Fails on main. [R1] [R3] [dod arm 2]
  - 4. Same file, new test "T1-AFFECTED-SELECT acceptance 4 - the comparison keeps the letter case and reads no separator but the slash". A text holding `LOOP/CARD-RUNNER.TS` and a text holding the changed path written with backslashes are not selected for `src/loop/card-runner.ts`. Fails on main. [R2] [dod arm 2]
  - 5. Same file, new test "T1-AFFECTED-SELECT acceptance 5 - src/core/affected.ts imports nothing". The source text of src/core/affected.ts, read by the test, has no line that starts with `import ` and holds no `require(` and no `import(`. Fails on main (no file). [R4] [dod arm 2]
  - 6. `npm run typecheck` exits 0 with the new module and test. [R1] [dod arm 1]
depends_on: []
budget: 110
tdd: true
sweep: "Main at 35de54fe. `git grep -n -i affected -- src tests bench` finds no function, file or test named `affected`, so the module and the test file are new and no existing test pins them. `git grep -l \"'src', 'core'\" -- tests` and `git grep -n readdirSync -- tests/surface` find no test that lists the files of src/core, so a new file there fails none. docs/ARCHITECTURE.md describes src/core as pure decision engines with no I/O (CLAUDE.md, Layers), which R4 keeps. Measured on the 204 `tests/**/*.test.ts` files of 35de54fe with a scratch script (not committed) for the rule of R2 against a base-name rule: `src/loop/card-runner.ts` 47 files (base name 48), `docs/OPERATIONS.md` 72 (76), `CHANGELOG.md` 84 (84), `src/core/types.ts` 89 (92), `src/delivery/github-ship.ts` 8 (8), `src/core/effort.ts` 6 (8), `tests/scenarios/_harness.ts` 5 (84, since a scenario test imports it as `./_harness.ts`), `tests/infra/helpers.ts` 76 (99)."
forbid:
  - an import in src/core/affected.ts, or any file, clock, environment or process read there
  - a call of `affectedTests` or `needleOf` from src, bin or bench in this card (T1-AFFECTED-REPORT calls them from bench)
  - a second matching rule, an option or a parameter that changes the rule
  - a change to the R3 policy, REVIEW.md, the review allowances or the card state precedence in src/core/card-machine.ts
  - weakening, skipping or deleting a test to go green
non_goals:
  - the report over the red CI runs and the keep-rule numbers (T1-AFFECTED-REPORT)
  - wiring the selection into the loop, a gate on it, or a `dod_command` built from it
  - following imports; a test that reaches a changed file only through another file (for example through `./_harness.ts`) is not selected, and the report counts what that costs
  - a path written with backslashes, a leading `./`, an absolute path or a path in another letter case; each is compared as given and so selects only a text that holds its needle in that same form
  - a CHANGELOG.md entry and doc text; nothing in src calls the function, so no behaviour of the loop changes
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE."
---

# T1-AFFECTED-SELECT

## Deliverable
One pure function, `affectedTests`, and its needle rule `needleOf`, in a new file of `src/core/`. Given the paths a candidate changed and the path and text of each test file, it returns the test files that name a changed path.

## Why
Intent `intent/execution-gate.md`, proposed outcome 3, and spec `specs/execution-gate.md` R10: before the loop runs a test selection, a report has to show how often a selection by named path would have run the test that failed in CI, and how many files it selects. The rule is fixed here, in a function with no I/O, so the report card measures exactly this rule. The owner's keep rule (hit rate at least 70%, median selection at most 25% of the test files) is judged by T1-AFFECTED-REPORT, not here.

The last two segments are used, not the base name, because a base name such as `types.ts` or `helpers.ts` is shared by unrelated files; the sweep gives both counts on the tree of 35de54fe.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/affected.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every acceptance test above passes.

## Acceptance detail

### 1. The fixture of acceptance 1
`changedPaths`: `['src/loop/card-runner.ts', 'CHANGELOG.md', 'tests/core/x.test.ts']`.

`testFiles`, in this order:

| path | text | selected |
|---|---|---|
| `tests/scenarios/a.test.ts` | `import { CardRunner } from '../../src/loop/card-runner.ts';` | yes, by `loop/card-runner.ts` |
| `tests/surface/b.test.ts` | `const text = read('CHANGELOG.md');` | yes, by `CHANGELOG.md` |
| `tests/core/x.test.ts` | `// names nothing` | yes, its path is a changed path |
| `tests/core/c.test.ts` | `import { x } from './card-runner.ts';` | no, the text holds the base name only |
| `tests/core/d.test.ts` | `// card-runner and loop, apart` | no |

The result deep-equals `['tests/scenarios/a.test.ts', 'tests/surface/b.test.ts', 'tests/core/x.test.ts']`.
