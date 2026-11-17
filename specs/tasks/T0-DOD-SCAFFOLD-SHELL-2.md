---
id: T0-DOD-SCAFFOLD-SHELL-2
title: (replaces T0-DOD-SCAFFOLD-SHELL and carries its candidate) On the scaffold ship path the loop-run DoD of `card attempt` and the DoD runs of `card mutants` run the card's dod_command as the scaffold ship's DoD leg does, through `pwsh -NoProfile -Command` with its two preferences, and the loopDod record names the shell that ran it (issue 348)
status: todo
superseded_by: T0-DOD-SCAFFOLD-SHELL-3
branch: T0-DOD-SCAFFOLD-SHELL-2
worktree: D:\wt\AIDLC\T0-DOD-SCAFFOLD-SHELL-2
allow_paths:
  - src/review/mutants.ts
  - src/loop/card-runner.ts
  - src/core/types.ts
  - src/cli/main.ts
  - tests/infra/dod-shell.test.ts
  - tests/scenarios/dod-record.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-DOD-SCAFFOLD-SHELL-2.md
dod_command: npm run typecheck && node --test tests/infra/dod-shell.test.ts tests/scenarios/dod-record.test.ts tests/surface/mutants.test.ts tests/surface/loop-evidence-docs.test.ts
dod_exit: 0
requirements:
  - R1. `dodCall` (src/review/mutants.ts) shall take the configured ship path. WHEN it is `scaffold`, it shall return the program `pwsh` with the arguments `-NoProfile`, `-Command` and the payload `$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; ` followed by the card's `dod_command` (the text `Get-ScaffoldDodPayload` of the scaffold's scripts/_cards.ps1 builds), with the options `cwd` (the worktree) and `timeoutMs` and no `shell` option. For `github` and `dry-run` it shall return the call it returns today: the `dod_command` as one string, no arguments, `shell: true`.
  - R2. The loop-run DoD of `aidlc card attempt --outcome success` (`CardRunner.loopDod`) and the DoD runs of `aidlc card mutants` (`runMutants`, called from src/cli/main.ts) shall both pass the project's configured `shipPath` to `dodCall`, so on the scaffold path both run the program R1 names. Nothing else in either command changes: the tree kill at the timeout, the record's other fields, the sweep's outcome rule and its report.
  - R3. The `loopDod` record of a DoD that ran shall carry `shell`: `pwsh` for the scaffold call of R1 and `platform` for the platform-shell call. The schema keeps the field optional, so a record written before this card still parses and is shown as before; `aidlc card status` prints its `loopDod=` line as before.
  - R4. `docs/OPERATIONS.md` shall state R1 to R3 in a new paragraph directly before the "Loop-run DoD record (card T1-DOD-RECORD-2)" paragraph, leaving that paragraph unchanged and still the last paragraph before the `### T1 feature` heading (tests/surface/loop-evidence-docs.test.ts pins that adjacency), and in one sentence added after the sentence of the mutants paragraph (src/review/mutants.ts, card T1-VERIFY-MUTANTS) that says the DoD runs through the platform shell; `CHANGELOG.md` Unreleased shall carry the change under this card id and issue 348.
acceptance:
  - 1. tests/infra/dod-shell.test.ts - `dodCall` for `scaffold` returns exactly `['pwsh', ['-NoProfile', '-Command', "$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; " + dod], { cwd, timeoutMs }]` with no `shell` key; for `github` and `dry-run` it returns `[dod, [], { cwd, shell: true, timeoutMs }]`. [R1] [dod arm 1]
  - 2. tests/infra/dod-shell.test.ts, a real pwsh process through `runSync` in a temporary directory - the issue 348 DoD shape (a dod_command that starts `$ErrorActionPreference = 'Stop';`, holds double-quoted and single-quoted strings, a `$` variable, a `foreach` block, `;` separators, prints `[DOD-PASS]` and ends `exit 0`) run through the scaffold call exits 0 and prints `[DOD-PASS]`; a dod that runs a native command exiting 3 (`node -e "process.exit(3)"`) and then `exit 0` exits nonzero through the scaffold call (the native-command preference is applied); a dod that ends `exit 4` exits 4. On win32 the issue 348 DoD shape through the platform call does not exit 0 (the reported symptom). [R1] [dod arm 1]
  - 3. tests/infra/dod-shell.test.ts, through the card runner with a project config whose `shipPath` is `scaffold` and a scripted runner - a success records `loopDod` with `shell: 'pwsh'` and the runner was called once with the scaffold call of acceptance 1 plus `killTree: true`; tests/scenarios/dod-record.test.ts - the record of its first test also holds `shell: 'platform'` (the one literal this card changes there) and its call assertion is unchanged; a stored attempt whose `loopDod` has no `shell` parses and `card status` prints the same `loopDod=` line as before. [R2] [R3] [dod arm 1]
  - 4. tests/infra/dod-shell.test.ts - `runMutants` given `scaffold` calls its `dod` dependency with the scaffold call of acceptance 1 on the unmutated candidate and on each mutant; given `github` with the platform call; tests/surface/mutants.test.ts passes unchanged. tests/infra/dod-shell.test.ts, through the CLI - `aidlc card mutants <card>` in a temporary repository whose config sets `shipPath: scaffold`, on a card run whose worktree holds a committed candidate with at least one mutant and whose `dod_command` is PowerShell that neither cmd.exe nor /bin/sh runs to `dod_exit`, exits 0 and writes its report (its unmutated run met `dod_exit` through pwsh); with the configured `shipPath` no longer passed to `runMutants` the same call refuses on the unmutated run (the revert check records it). [R2] [dod arm 1]
  - 5. docs/OPERATIONS.md and CHANGELOG.md Unreleased carry the rule under this card id; a test reads the exact sentences this card adds, fails with any one removed and asserts that the new paragraph is the one directly before the T1-DOD-RECORD-2 paragraph; tests/surface/loop-evidence-docs.test.ts passes unchanged. [R4] [dod arm 1]
depends_on: []
budget: 250
tdd: true
sweep: "As T0-DOD-SCAFFOLD-SHELL. In addition: grep -n '### T1 feature' tests/surface/loop-evidence-docs.test.ts: it asserts that an empty line and the `### T1 feature` heading follow the T1-DOD-RECORD-2 paragraph, so T0-DOD-SCAFFOLD-SHELL's R4 (a paragraph right after it) could not be met while its acceptance 5 kept that test unchanged. The paragraph that starts 'A ship is `merged` only on its adapter's merge contract' is where card T0-SHIP-SAGA-LEG adds its paragraph; keep this card's paragraph away from it."
forbid: [weakening or skipping a test to go green, a change to the DoD call on the github or dry-run path, a change to the scaffold ship path's own DoD leg or to task.ps1, a gate that reads loopDod, editing the T1-DOD-RECORD-2 paragraph of docs/OPERATIONS.md or its CHANGELOG entry, editing a released CHANGELOG section]
non_goals: [a config field that names the DoD shell, making loopDod a gate (card T1-DOD-GATE), the DoD of the scaffold's `-Phase red`, the case of environment names on Windows (issue 307)]
diagnosis:
  root_cause: "As T0-DOD-SCAFFOLD-SHELL: dodCall (src/review/mutants.ts:161) returns `[card.dod_command, [], { shell: true }]`, so Node runs the DoD through cmd.exe on Windows whatever the project's ship path, while a scaffold repository writes dod_command in PowerShell and runs it as `pwsh -NoProfile -Command (Get-ScaffoldDodPayload -Dod $dod)`. T0-DOD-SCAFFOLD-SHELL's candidate affb085a fixed it; its R3 decision 1 blocked on F1 (no test of the `card mutants` CLI passing the configured shipPath) and F2 (the paragraph was not right after the T1-DOD-RECORD-2 paragraph as R4 said, which the pinned adjacency in loop-evidence-docs.test.ts made impossible)."
  same_class: "As T0-DOD-SCAFFOLD-SHELL."
hygiene: "Issue 348. Decided by the coordinating session on 2026-11-17 while working the open issues through the loop at the owner's (asun28) request: R4 of T0-DOD-SCAFFOLD-SHELL, which the same session wrote, contradicted its own acceptance 5, so the successor moves the paragraph to directly before the T1-DOD-RECORD-2 paragraph and adds the CLI test of R3 decision 1 F1; it carries candidate affb085a. The carried candidate is 277 changed lines (tests/infra/dod-shell.test.ts 224); on the github path the budget is advisory (docs/OPERATIONS.md, card T0-BUDGET-DOC-TRUTH), so compact the test file toward the budget with shared helpers and table rows, never by dropping an assertion. Run every test file that reads docs/OPERATIONS.md or CHANGELOG.md before the first R3 (docs/LESSONS.md 2026-11-11 T0-RELEASE-OP-REISSUE); give each guard its own failing-when-removed test (docs/LESSONS.md 2026-11-17 T1-OUTCOME-ESCAPED)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-DOD-SCAFFOLD-SHELL-2

## Deliverable
On a repository whose ship path is `scaffold`, `aidlc card attempt` and `aidlc card mutants` run the card's DoD through `pwsh -NoProfile -Command` with the scaffold's two preferences, the program the scaffold ship's DoD leg runs, and the loopDod record says which shell ran it. The github and dry-run paths keep the platform shell.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/dod-shell.test.ts tests/scenarios/dod-record.test.ts tests/surface/mutants.test.ts tests/surface/loop-evidence-docs.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
