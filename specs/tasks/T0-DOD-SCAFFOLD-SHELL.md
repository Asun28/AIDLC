---
id: T0-DOD-SCAFFOLD-SHELL
title: On the scaffold ship path the loop-run DoD of `card attempt` and the DoD runs of `card mutants` run the card's dod_command as the scaffold ship's DoD leg does, through `pwsh -NoProfile -Command` with its two preferences, and the loopDod record names the shell that ran it (issue 348)
status: todo
superseded_by: T0-DOD-SCAFFOLD-SHELL-2
branch: T0-DOD-SCAFFOLD-SHELL
worktree: D:\wt\AIDLC\T0-DOD-SCAFFOLD-SHELL
allow_paths:
  - src/review/mutants.ts
  - src/loop/card-runner.ts
  - src/core/types.ts
  - src/cli/main.ts
  - tests/infra/dod-shell.test.ts
  - tests/scenarios/dod-record.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-DOD-SCAFFOLD-SHELL.md
dod_command: npm run typecheck && node --test tests/infra/dod-shell.test.ts tests/scenarios/dod-record.test.ts tests/surface/mutants.test.ts tests/surface/loop-evidence-docs.test.ts
dod_exit: 0
requirements:
  - R1. `dodCall` (src/review/mutants.ts) shall take the configured ship path. WHEN it is `scaffold`, it shall return the program `pwsh` with the arguments `-NoProfile`, `-Command` and the payload `$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; ` followed by the card's `dod_command` (the text `Get-ScaffoldDodPayload` of the scaffold's scripts/_cards.ps1 builds), with the options `cwd` (the worktree) and `timeoutMs` and no `shell` option. For `github` and `dry-run` it shall return the call it returns today: the `dod_command` as one string, no arguments, `shell: true`.
  - R2. The loop-run DoD of `aidlc card attempt --outcome success` (`CardRunner.loopDod`) and the DoD runs of `aidlc card mutants` (`runMutants`, called from src/cli/main.ts) shall both pass the project's configured `shipPath` to `dodCall`, so on the scaffold path both run the program R1 names. Nothing else in either command changes: the tree kill at the timeout, the record's other fields, the sweep's outcome rule and its report.
  - R3. The `loopDod` record of a DoD that ran shall carry `shell`: `pwsh` for the scaffold call of R1 and `platform` for the platform-shell call. The schema keeps the field optional, so a record written before this card still parses and is shown as before; `aidlc card status` prints its `loopDod=` line as before.
  - R4. `docs/OPERATIONS.md` shall state R1 to R3 in a new paragraph right after the "Loop-run DoD record (card T1-DOD-RECORD-2)" paragraph, leaving that paragraph unchanged, and in one sentence added after the sentence of the mutants paragraph (src/review/mutants.ts, card T1-VERIFY-MUTANTS) that says the DoD runs through the platform shell; `CHANGELOG.md` Unreleased shall carry the change under this card id and issue 348.
acceptance:
  - 1. tests/infra/dod-shell.test.ts - `dodCall` for `scaffold` returns exactly `['pwsh', ['-NoProfile', '-Command', "$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; " + dod], { cwd, timeoutMs }]` with no `shell` key; for `github` and `dry-run` it returns `[dod, [], { cwd, shell: true, timeoutMs }]`. [R1] [dod arm 1]
  - 2. tests/infra/dod-shell.test.ts, a real pwsh process through `runSync` in a temporary directory - the issue 348 DoD shape (a dod_command that starts `$ErrorActionPreference = 'Stop';`, holds double-quoted and single-quoted strings, a `$` variable, a `foreach` block, `;` separators, prints `[DOD-PASS]` and ends `exit 0`) run through the scaffold call exits 0 and prints `[DOD-PASS]`; a dod that runs a native command exiting 3 (`node -e "process.exit(3)"`) and then `exit 0` exits nonzero through the scaffold call (the native-command preference is applied); a dod that ends `exit 4` exits 4. On win32 the issue 348 DoD shape through the platform call does not exit 0 (the reported symptom). [R1] [dod arm 1]
  - 3. tests/infra/dod-shell.test.ts, through the card runner with a project config whose `shipPath` is `scaffold` and a scripted runner - a success records `loopDod` with `shell: 'pwsh'` and the runner was called once with the scaffold call of acceptance 1 plus `killTree: true`; tests/scenarios/dod-record.test.ts - the record of its first test also holds `shell: 'platform'` (the one literal this card changes there) and its call assertion is unchanged; a stored attempt whose `loopDod` has no `shell` parses and `card status` prints the same `loopDod=` line as before. [R2] [R3] [dod arm 1]
  - 4. tests/infra/dod-shell.test.ts - `runMutants` given `scaffold` calls its `dod` dependency with the scaffold call of acceptance 1 on the unmutated candidate and on each mutant; given `github` with the platform call; tests/surface/mutants.test.ts passes unchanged. [R2] [dod arm 1]
  - 5. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds and fails with any one removed; tests/surface/loop-evidence-docs.test.ts passes unchanged. [R4] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "grep -rn 'dodCall' src: one definition (src/review/mutants.ts:161, `[card.dod_command, [], { cwd, shell: true, timeoutMs }]`) and two callers, CardRunner.loopDod (src/loop/card-runner.ts:302) and runMutants (src/review/mutants.ts:184, called from src/cli/main.ts:800 `card mutants`). grep -rn 'shell: true' tests: tests/scenarios/dod-record.test.ts:92 and tests/surface/mutants.test.ts:225 pin the platform call under the default dry-run config and stay as they are. grep -n 'Get-ScaffoldDodPayload' D:/Projects/MyInspection/scripts/_cards.ps1 D:/Projects/MyInspection/scripts/task.ps1: the scaffold ship runs `& pwsh -NoProfile -Command (Get-ScaffoldDodPayload -Dod $dod)` in the worktree, the payload prefix being the two preferences of R1."
forbid: [weakening or skipping a test to go green, a change to the DoD call on the github or dry-run path, a change to the scaffold ship path's own DoD leg or to task.ps1, a gate that reads loopDod, editing the T1-DOD-RECORD-2 paragraph of docs/OPERATIONS.md or its CHANGELOG entry, editing a released CHANGELOG section]
non_goals: [a config field that names the DoD shell, making loopDod a gate (card T1-DOD-GATE), the DoD of the scaffold's `-Phase red`, the case of environment names on Windows (issue 307)]
diagnosis:
  root_cause: "dodCall (src/review/mutants.ts:161) returns `[card.dod_command, [], { shell: true }]`, so Node runs the DoD through cmd.exe on Windows whatever the project's ship path. A scaffold repository writes dod_command in PowerShell and its ship runs it as `pwsh -NoProfile -Command (Get-ScaffoldDodPayload -Dod $dod)`. On MyInspection card T0-SCRIPTS-ORPHAN-FUNCS both successful attempts (2026-11-15 and 2026-11-17) recorded loopDod exitCode 255 with `'$ErrorActionPreference' is not recognized as an internal or external command`, while the same command printed [DOD-PASS] and exited 0 under pwsh -NoProfile -Command."
  same_class: "Every caller of dodCall: CardRunner.loopDod and runMutants (`card mutants`). No gate reads loopDod today; card T1-DOD-GATE (todo) will refute a success whose loop-run DoD does not meet dod_exit, which on a scaffold repository on Windows would refute every success until this card lands."
hygiene: "Issue 348. The pwsh process tests need pwsh on the PATH, which aidlc doctor requires and both CI runners carry. Pins named by the sweep stay unchanged except the one literal of acceptance 3 (docs/LESSONS.md 2026-11-15 T1-REPLAY-CLEAN). Run every test file that reads docs/OPERATIONS.md or CHANGELOG.md before the first R3 (docs/LESSONS.md 2026-11-11 T0-RELEASE-OP-REISSUE); give each guard its own failing-when-removed test (docs/LESSONS.md 2026-11-17 T1-OUTCOME-ESCAPED)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-DOD-SCAFFOLD-SHELL

## Deliverable
On a repository whose ship path is `scaffold`, `aidlc card attempt` and `aidlc card mutants` run the card's DoD through `pwsh -NoProfile -Command` with the scaffold's two preferences, the program the scaffold ship's DoD leg runs, and the loopDod record says which shell ran it. The github and dry-run paths keep the platform shell.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/dod-shell.test.ts tests/scenarios/dod-record.test.ts tests/surface/mutants.test.ts tests/surface/loop-evidence-docs.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence

Attempt 1, effort medium. RED commit 8f83d6c6 (tests only): 9 of 19 tests in tests/infra/dod-shell.test.ts and tests/scenarios/dod-record.test.ts failed on the old code. The scaffold call returned the platform call, so cmd.exe printed `'$ErrorActionPreference' is not recognized` (exit 1), the record carried no `shell`, and the doc sentences did not exist yet. GREEN commit 2c9ad8c0.

| Item | Test | Result |
| --- | --- | --- |
| 1 | dod-shell.test.ts "dodCall by ship path [R1]": scaffold exact call with no shell key; github and dry-run platform call | pass; scaffold case fails on main |
| 2 | dod-shell.test.ts "a real pwsh through the scaffold call [R1]": issue 348 shape exits 0 and prints [DOD-PASS]; `node -e "process.exit(3)"; exit 0` exits nonzero; `exit 4` exits 4; on win32 the issue 348 shape through the platform call does not exit 0 | pass; first and third fail on main |
| 3 | dod-shell.test.ts "the loop-run DoD on the scaffold path [R2] [R3]": one call `pwsh -NoProfile -Command <prefix+dod>` with `killTree: true` and `shell: 'pwsh'`; a stored record without `shell` parses and `card status` prints the same `loopDod=` line. dod-record.test.ts first test: `shell: 'platform'` added to the record literal, call assertion unchanged | pass; all three fail on main |
| 4 | dod-shell.test.ts "runMutants passes the ship path to the DoD call [R2]": scaffold call on the baseline and on 3 mutants; github platform call. tests/surface/mutants.test.ts unchanged | pass; scaffold case fails on main |
| 5 | dod-shell.test.ts "docs carry the rule [R4]": each of the 4 paragraph sentences, the mutants sentence after the platform-shell sentence, the CHANGELOG entry under Unreleased. tests/surface/loop-evidence-docs.test.ts unchanged | pass; fails on main |

Revert check (each guard reverted alone, the two test files run, the file restored from HEAD): scaffold branch removed fails 6; native-command preference removed fails 4, including the real-pwsh native-exit test; `ErrorActionPreference='Stop'` removed fails 4, including the same test; loopDod passing `dry-run` instead of `config.shipPath` fails 2; the `shell` field removed fails 3, including dod-record test 1; the schema field made required fails 1 (the old-record test); runMutants passing `dry-run` fails 1; each of an OPERATIONS sentence, the mutants sentence and the CHANGELOG entry removed fails 1. Not covered by a test: `card mutants` in src/cli/main.ts passing `c.config.shipPath`, since no acceptance item names that seam.

Placement: R4 asks for the new OPERATIONS paragraph right after the T1-DOD-RECORD-2 paragraph, but tests/surface/loop-evidence-docs.test.ts (which must pass unchanged) asserts that the line after that paragraph is empty and the line after that is `### T1 feature`, and that the paragraph before it is the DoD receipt paragraph. The new paragraph therefore stands directly before the DoD receipt paragraph, in the same `### T0 bugfix` section, two paragraphs above the T1-DOD-RECORD-2 paragraph.

Doc-reading tests: every test file under tests/ that names OPERATIONS.md or CHANGELOG.md was run, plus tests/surface/prose.test.ts. 2049 of 2066 passed, 15 were skipped, and 2 files were ended by a 580 s timeout while other worktrees ran tests on the same machine. Those 2 files, run alone afterwards (review-bench-export and review-bench), passed 66 of 66; prose and changelog passed 38 of 38.
