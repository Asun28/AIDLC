---
id: T0-PREPARE-START-CMD
title: "On the github and dry-run ship paths the PREPARE start narration names the git worktree add command and the node_modules link, in place of scripts/task.ps1"
status: merged
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
The loop prints the commands, and the session runs them. Each path and ref is quoted for the shell, so a value with `$(...)` or a quote does not run as a command.

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

DoD: `npm run typecheck` exit 0; `node --test` over the six files: 159 tests, 159 pass, 0 fail, exit 0. After the repair of decision 1: exit 0, 162 tests, 162 pass, 0 fail. After the repair of decision 2: exit 0, 165 tests, 165 pass, 0 fail.

Repair after R3 decision 1 (F1 and F2, class shell-interpolation): the worktree path, the main checkout and the ref went into the printed commands as they were, so a configured value with `$(...)`, a backtick or a quote would run when a session followed the command. Every value now goes through `shellArg` (exported from `src/delivery/worktree.ts`) or, for the id and the ref, `shellWord`, for the shell of the platform: PowerShell on win32, a POSIX shell elsewhere. A value with no character the shell expands inside double quotes stays in double quotes, so the R1 spelling holds for every ordinary path; any other value is single-quoted, with `''` for each single quote in PowerShell (typographic ones too) and `'\''` in a POSIX shell. A ref of letters, digits, `.`, `_`, `/` and `-` stays a bare word. The check has one site: all four commands are built from these two helpers.

New tests in `tests/infra/worktree-start-command.test.ts`:

| Test | Proof | Result |
|---|---|---|
| `shellArg keeps an ordinary path in double quotes ...` | exact output for ordinary paths, `$(...)`, single and typographic quotes, a backslash on each platform, `!` on POSIX; for 11 hostile values on both platforms, a double-quoted result holds no character that shell expands | pass |
| `PowerShell and sh read each quoted value back unchanged ...` | runs `pwsh -Command [Console]::Out.Write(<arg>)` and `sh -c "printf '%s' <arg>"` for the 11 values and two ordinary paths, and compares the output with the value; both shells ran here (no skip) | pass |
| `a worktree path, main checkout or ref with metacharacters is quoted literally in every command` | exact spans of the three commands on win32 and linux with `$(...)`, backticks, `;`, `&&` and a single quote in the path, main checkout and ref | pass |

Each value form the repair hunks handle, and the test that covers it:

| Form | Covered by |
|---|---|
| an ordinary path, with spaces or backslashes | `shellArg` exact cases; acceptance 1 tests unchanged; the shell round trip |
| `$` and `$(...)`, `$env:` | `shellArg` exact cases; round trip; the metacharacter command test |
| a backtick | round trip (a command name between backticks); the command test (a main checkout with backticks) |
| an ASCII double quote | round trip (`a"b`) |
| a single quote | `shellArg` exact cases on both platforms; round trip; the command test (`/it's $HOME`) |
| typographic double and single quotes (PowerShell reads them as quotes) | `shellArg` exact cases; round trip on both shells |
| `!` (POSIX history expansion) | `shellArg` exact case; round trip |
| a POSIX backslash | `shellArg` exact case (`'a\b'` on linux, `"a\b"` on win32) |
| `;`, `&&`, `|`, `>` in a ref or path | the command test (`origin/main;calc`, `main && id`); round trip (`a;b && c|d > e`) |
| a ref with `$` | the command test (`origin/$(id)`) |
| a bare ref or card id | acceptance 1 tests unchanged (`origin/main`, `T1-HELLO`) |
| a control character | single-quoted by the `\u0000-\u001f` range; no test, as a path from `resolveWorktreeRoot` or git holds none |

Shown failing: with the worktree path wrapped in plain double quotes again in `worktreeStartCommands` (the quoting of decision 1), the third test fails.

Repair after R3 decision 2 (F3, class markdown-code-delimiter): a backtick in a single-quoted value ended the single-backtick code span early. `codeSpan` (exported from `src/delivery/worktree.ts`) now writes each command with a delimiter one backtick longer than the longest run inside it, and pads with one space when the command begins or ends with a backtick, or begins and ends with a space, as CommonMark strips one such space. Sites fixed: the three commands of `worktreeStartCommands`, and the `git worktree unlock` and `git worktree add` commands of the stale-registration reason in `CardRunner.staleRegistration` on the github path, which follow it in the same narration.

| Test | Proof | Result |
|---|---|---|
| `codeSpan uses a delimiter longer than any backtick run inside ...` (infra) | exact output for no backtick, one, a run of two, a leading and a trailing backtick; eight texts read back whole through a CommonMark code span reader (`spans`) in the test | pass |
| `with backticks in the worktree path, main checkout and ref, every command reads back as one whole code span` (infra) | on win32 and linux, `spans` of the text equals the three commands exactly; a plain text gives the two commands | pass |
| `with a worktree root holding $(...), backticks and a quote ...` (scenario) | a real worktree root `w $(x) \`b\` it's`: the start narration holds the single-quoted path in a whole span; a locked registration with its directory gone gives a reason whose unlock and add commands are the quoted path in whole spans, and no path in plain double quotes | pass |

Shown failing: with the delimiter fixed at one backtick in `codeSpan`, both infra tests fail; with the stale-registration path in plain double quotes again, the scenario test fails.

Each form the decision 2 hunks handle: no backtick (single delimiter, acceptance tests unchanged); one or more runs of backticks inside (longer delimiter, infra tests); a leading or trailing backtick (padding, infra test); a leading and trailing space (padding, infra test `' padded '`); a text of backticks only (infra test); a stale registration on github that is locked (scenario test) or prunable (`prepare-worktree.test.ts`, which checks `git worktree prune` and passes unchanged).

Repair after R3 decision 3 (F4, class unrelated-close-command-change; F5, class scaffold-narration-changed): decision 2's repair also changed the `--file` argument of the CLOSE `aidlc evidence retain` refusal and the stale-registration reason on the scaffold path. Both are reverted: `git diff 1612713b -- src/loop/card-runner.ts` holds no `evidence retain` line, and `staleRegistration` returns the reason of main, byte for byte, when `shipPath` is `scaffold`. The quoting stays on the github path, the only other path that reaches `staleRegistration` (dry-run decides before it). The quoting of the CLOSE refusal is out of scope for this card.

| Test | Proof | Result |
|---|---|---|
| `on scaffold, a stale-registration start under a worktree root holding $(...) and backticks keeps the narration of main ...` (scenario) | a real hostile worktree root, a locked registration with its directory gone: the scaffold narration ends with the start sentence and stale reason of main exactly, path in plain double quotes | pass |

Shown failing: with the scaffold branch of `staleRegistration` disabled, this test fails.

DoD after the repair of decision 3: `npm run typecheck` exit 0; `node --test` over the six files: exit 0, 166 tests, 166 pass, 0 fail.
