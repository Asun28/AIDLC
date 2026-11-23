---
id: T0-PREPARE-START-CMD
title: "On the github and dry-run ship paths the PREPARE start narration names the git worktree add command and the node_modules link, in place of scripts/task.ps1"
status: todo
branch: T0-PREPARE-START-CMD
worktree: D:\wt\AIDLC\T0-PREPARE-START-CMD
allow_paths:
  - src/delivery/worktree.ts
  - src/loop/card-runner.ts
  - tests/infra/worktree-start-command.test.ts
  - tests/scenarios/prepare-start-command.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-PREPARE-START-CMD.md
  - specs/tasks/T0-PREPARE-START-CMD.md
dod_command: npm run typecheck && node --test tests/infra/worktree-start-command.test.ts tests/scenarios/prepare-start-command.test.ts tests/scenarios/prepare-worktree.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `src/delivery/worktree.ts` shall export a pure function `worktreeStartCommands` that takes the card id, the worktree path, the main checkout path, the base ref, whether to link `node_modules`, and the platform, and returns a text that begins with `From the main checkout` and names, as code spans, `git worktree add -b <id> "<path>" <ref>`, the form for an existing branch `git worktree add "<path>" <id>`, and, only when the link is asked for, the link command: on `win32` `New-Item -ItemType Junction -Path "<path>\node_modules" -Target "<main>\node_modules"`, on any other platform `ln -s "<main>/node_modules" "<path>/node_modules"`.
  - R2. On the `github` and `dry-run` ship paths, the narration of a `prepare` directive with action `start` shall hold the text of R1 for the card, the directive's worktree path, the main checkout, the ref `origin/<base>` in `remote` mode and `<base>` in `local` mode, the platform of the process, and a link exactly when `<main checkout>/node_modules` exists; it shall not hold `task.ps1`.
  - R3. On the `scaffold` ship path the narration of a `prepare` start shall be as on main at fcc91cd8.
  - R4. The narration of a `prepare` attach, the directive fields, the run state and every store write and journal append of PREPARE shall be as on main at fcc91cd8.
  - R5. `docs/OPERATIONS.md`, the paragraph `PREPARE and the card worktree`, shall say what a start names on each ship path.
  - R6. `changelog.d/T0-PREPARE-START-CMD.md` shall state that the start narration on the github and dry-run ship paths names the `git worktree add` command and the `node_modules` link in place of `scripts/task.ps1`.
acceptance:
  - 1. New file `tests/infra/worktree-start-command.test.ts` calls `worktreeStartCommands` for `win32` and for `linux`, each with and without the link, and asserts by exact string that the result begins with `From the main checkout`, holds the three code spans R1 names with the given id, path, main and ref, that the link span is absent without the link, that the `win32` result holds no `ln -s` and the `linux` result no `New-Item`, and that a path with a space stays inside the double quotes. RED on main at fcc91cd8, where the export does not exist. [R1] [dod arm 2]
  - 2. New file `tests/scenarios/prepare-start-command.test.ts` builds a goal in a real git repository (the setup of `tests/scenarios/prepare-worktree.test.ts`) and asserts, for `github` with a `node_modules` directory in the main checkout, that the first `card next` returns `prepare` start whose narration holds the output of `worktreeStartCommands` for this card, path, main root, `origin/main`, link and `process.platform`, and holds no `task.ps1` in any case; without `node_modules` the narration holds the output with no link and no `node_modules`; in `local` mode the ref is `main`; on `dry-run` the narration holds the same text. RED on main at fcc91cd8, where the narration names `scripts/task.ps1`. [R2] [dod arm 3]
  - 3. The same file runs the `git worktree add -b` argv the narration names in a fixture with an `origin` remote that has the base branch, then asserts that the next `card next` returns `prepare` with action `attach` at the directive's path, so the command named works on the github ship path. [R2] [dod arm 3]
  - 4. The same file asserts that on `scaffold` the start narration holds `(scaffold: pwsh scripts/task.ps1 -TaskId <id> -Phase start from the main checkout)` and no `git worktree add -b`, and that an attach narration on `github` holds no `git worktree add`. [R3] [R4] [dod arm 3]
  - 5. `tests/scenarios/prepare-worktree.test.ts`, `tests/scenarios/t0-flow.test.ts` and `tests/scenarios/fault-points.test.ts` pass with no line changed, the typecheck reports no error, and `docs/OPERATIONS.md` and `changelog.d/T0-PREPARE-START-CMD.md` say what R5 and R6 say (reviewer-verified against the diff). [R4] [R5] [R6] [dod arms 1, 4, 5, 6, 7]
depends_on: []
budget: 200
tdd: true
sweep: "On main at fcc91cd8. `git grep -n 'Phase start' -- src tests docs README.md .claude templates` finds the narration at src/loop/card-runner.ts:1376, the comment at src/delivery/worktree.ts:4, docs/REQUIREMENTS-TRACEABILITY.md:16 (the real task.ps1 start is not exercised, still true) and the archived plan docs/plans/PLAN-aidlc-loop-v3-archive.md. `git grep -n -e 'Start a new worktree' -e 'task.ps1 -TaskId' -- tests` finds no test that pins the start sentence; tests/scenarios/t0-flow.test.ts:2106-2107 and tests/scenarios/card-writer-lessons.test.ts pin only the lessons sentence before it, which this card keeps. The prepare start is reached on every ship path through CardRunner.next, which the verify skill verify-card-run-writes covers; the card changes no write, so its check runs in the DoD and the sync commit stays. The dry-run start opens BUILD at the directive path (docs/OPERATIONS.md:96), so the commands are named there too. `origin` is the remote the merge check at src/loop/card-runner.ts:3651 already reads."
forbid:
  - a change to scripts/ or to the scaffold ship path
  - weakening or skipping a test to go green
non_goals:
  - "making `aidlc card start` or `card next` create the worktree on the github path"
  - "a `git fetch` before the start, or base-sync behaviour"
  - "editing the NOTE of 2026-11-18 in docs/LESSONS.md"
hygiene: "Issue 376. T1-PREPARE-LESSONS-REF, which the issue says should go first, is merged (its lessons sentence is at the start of the narration on main). RED is the two new test files, which fail on main on the missing export and on `task.ps1` in the narration."
doc_sync: changelog.d/T0-PREPARE-START-CMD.md
---

# T0-PREPARE-START-CMD

From issue 376.

## Deliverable
The `prepare` directive with action `start` names only the scaffold start
command, `pwsh scripts/task.ps1 -TaskId <id> -Phase start`. On the github
ship path (this repository) that script does not exist, so a session runs a
command that fails and then makes the worktree by hand, and without a
`node_modules` link the DoD fails on `'tsc' is not recognized`. On the
github and dry-run ship paths the narration now names `git worktree add`
with the card branch, the directive path and the base ref, the form for a
branch that exists, and the link of the main checkout's `node_modules` when
it has one, in the syntax of the platform. The scaffold narration stays.

## Rules that decide edge cases
- The ref is `origin/<base>` in remote mode and `<base>` in local mode.
- The link is named only when `<main checkout>/node_modules` exists, so a project without one gets no link command.
- On `win32` the link is a PowerShell junction, elsewhere `ln -s`.
- A stale-registration start keeps its reason text; the commands follow it.

## PR summary
### What
The PREPARE start text now names commands that work on the github and dry-run ship paths. Before, it named `scripts/task.ps1`, which exists on the scaffold path only.

### Why / Intent
Issue 376. On this repository a session ran the named script, got an error, and made the worktree by hand. Without a `node_modules` link the DoD then failed on `'tsc' is not recognized`.

### How / Behaviour
- A new pure function `worktreeStartCommands` writes the text: `git worktree add -b <id> "<path>" <ref>`, the form for a branch that exists, and the `node_modules` link.
- The ref is `origin/<base>` in remote mode and `<base>` in local mode.
- The link is named only when the main checkout has `node_modules`: a PowerShell junction on Windows, `ln -s` elsewhere.
- The scaffold text does not change.

### System impact
Only the narration of a `prepare` start changes. The directive fields, the run state and the store writes stay the same.

### Security
No new input, permission or command that the loop runs. The loop prints the commands, and the session runs them.

### Tests and review
- Two new test files: one for the function on both platforms, one for the narration on each ship path.
- One test runs the named `git worktree add` command and checks that the next `card next` attaches.
- The PREPARE, T0 flow and fault-point tests pass unchanged.

### Risk
Low. The change is text in one directive. A wrong command fails visibly when the session runs it.

### Ownership
Card `T0-PREPARE-START-CMD`, goal `g-20261123100508-50a5a4`, issue 376.

### Docs
`docs/OPERATIONS.md`, paragraph PREPARE and the card worktree, says what a start names on each ship path. `changelog.d/T0-PREPARE-START-CMD.md` holds the entry.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/worktree-start-command.test.ts tests/scenarios/prepare-start-command.test.ts tests/scenarios/prepare-worktree.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/fault-points.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the new tests and the existing PREPARE, T0 flow and fault-point tests pass.

## Attempt evidence
RED commit ce519a5a holds the two new test files alone. There both fail on the missing export `worktreeStartCommands`. With the new `src/delivery/worktree.ts` and `src/loop/card-runner.ts` as on main, the scenario file fails its four github and dry-run tests on the narration, and the scaffold test passes.

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/worktree-start-command.test.ts`, four tests: win32 and linux with the link, both without, a path with a space; exact code spans, the leading `From the main checkout`, no `ln -s` on win32, no `New-Item` on linux | pass |
| 2 | `tests/scenarios/prepare-start-command.test.ts`, acceptance 2 tests: github with `node_modules`, github without it in remote and local mode, dry-run; the narration holds the function output for `process.platform` and no `task.ps1` in any case | pass |
| 3 | The same file, acceptance 3: runs `git worktree add -q -b T1-HELLO <worktree> origin/main` against a fixture with a bare `origin`, then `card next` returns `prepare` attach at that path, and its narration holds no `git worktree add` | pass |
| 4 | The same file, acceptance 4: the scaffold narration ends with the start sentence and reason as on main, and holds no `git worktree add -b`; the attach check is in item 3 | pass |
| 5 | DoD arm 1 exit 0; `prepare-worktree.test.ts`, `t0-flow.test.ts`, `fault-points.test.ts` not in the diff and pass; the changelog fragment test passes; `prose.test.ts` passes with the OPERATIONS sentence | pass; doc text is for the reviewer |

Each requirement clause and the assertion that fails without it:

| Clause | Assertion |
|---|---|
| R1, begins with `From the main checkout` | item 1, `startsWith` |
| R1, `git worktree add -b` span | item 1, exact span per platform |
| R1, existing-branch span | item 1, exact span |
| R1, link only when asked | item 1, `node_modules` absent without the link |
| R1, junction on win32, `ln -s` elsewhere | item 1, exact spans and the cross-platform absences |
| R2, the function text in the narration | item 2, `includes(expected)` |
| R2, ref per mode | item 2, local mode with `main` and no `origin/` |
| R2, link exactly when `node_modules` exists | item 2, with and without the directory |
| R2, no `task.ps1` | item 2, `/task\.ps1/i` |
| R2, dry-run as github | item 2, dry-run test |
| R3 | item 4, `endsWith` the sentence of main |
| R4 | item 3 for the attach; `prepare-worktree.test.ts` for the fields and state; `fault-points.test.ts` for the writes |
| R5, R6 | item 5 (reviewer-verified) and the fragment test |

The scaffold fixture sets `gateRequired: true`: the scaffold path stops a remote card under an advisory ReviewGate before PREPARE. That line changed after the RED commit; the assertion did not.

Verify skill `verify-card-run-writes`: the card changes `CardRunner.next`'s PREPARE narration only, no write; `tests/scenarios/fault-points.test.ts` runs in the DoD and passes, so the sync commit stays.

DoD: `npm run typecheck` exit 0; `node --test` over the six files: 159 tests, 159 pass, 0 fail, exit 0.
