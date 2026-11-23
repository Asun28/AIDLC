---
id: T0-CARD-PHASE-DOC
title: "docs/OPERATIONS.md describes the four scaffold phase commands, `aidlc card start` and `aidlc card cleanup` among them, and a test keeps the description equal to the CLI"
status: todo
branch: T0-CARD-PHASE-DOC
worktree: D:\wt\AIDLC\T0-CARD-PHASE-DOC
allow_paths:
  - docs/OPERATIONS.md
  - tests/surface/card-phase-doc.test.ts
  - changelog.d/T0-CARD-PHASE-DOC.md
  - specs/tasks/T0-CARD-PHASE-DOC.md
dod_command: npm run typecheck && node --test tests/surface/card-phase-doc.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `docs/OPERATIONS.md`, under `### T0 bugfix` as the paragraph after the one that begins `PREPARE and the card worktree`, shall hold one paragraph that begins `Scaffold phase commands (card T0-CARD-PHASE-DOC, issue 419):` and names `aidlc card start <id>`, `aidlc card red <id>`, `aidlc card ship <id>` and `aidlc card cleanup <id>`.
  - R2. The paragraph shall state what the four commands do on the `scaffold` ship path. Each runs `scripts/task.ps1` in the main checkout with `-TaskId <id>` and its own `-Phase`, and exits with the script's exit code; `--base <ref>` reaches the script as `-Base`, which without the option carries the configured `base`; `--local` or the configured `mode: local` reaches it as `-Local`; the start phase is the one a `prepare` directive with action `start` names; no other command runs the cleanup phase, and `aidlc card close --cleanup` removes the worktree with git.
  - R3. The paragraph shall state the refusal on the `github` and `dry-run` ship paths, where each of the four exits 1 with `ship path is <path>; task.ps1 phases apply to the scaffold path only` and runs nothing.
  - R4. A new file `tests/surface/card-phase-doc.test.ts` shall fail when the commands or options the paragraph names differ from the CLI's, and when the CLI differs from the statements of R2 and R3 that acceptance 2 and 3 list.
  - R5. `changelog.d/T0-CARD-PHASE-DOC.md` shall hold the entry under this card id.
acceptance:
  - 1. The paragraph stands where R1 says. The `aidlc card <name> <id>` commands it names are exactly the `card` subcommands whose help line names `task.ps1 -Phase`, read from `aidlc card --help` run in process, and it names `--base <ref>` and `--local`, which the help of each of the four lists. RED on main at a8008e12, where the paragraph is absent. [R1] [R4] [dod arm 2]
  - 2. In a temporary repository with `shipPath: scaffold` and a `scripts/task.ps1` that records its parameters and its directory and exits 7, each of the four commands, run from a subdirectory, gives the script `-TaskId`, its own `-Phase` and `-Base main` without `-Local`, runs it in the main checkout and exits 7. `--base other --local` gives `-Base other` and `-Local`; `mode: local` with no option gives `-Local`. [R2] [R4] [dod arm 2]
  - 3. With `shipPath` `github` and with `dry-run`, each of the four exits 1, its stderr is `aidlc: ship path is <path>; task.ps1 phases apply to the scaffold path only`, its stdout is empty and the script did not run. [R3] [R4] [dod arm 2]
  - 4. The paragraph's remaining statements (the `pwsh` arguments, the start phase and the `prepare` directive, no other command running the cleanup phase, `card close --cleanup` removing the worktree with git) hold of `src/cli/main.ts`, of `prepare` and `reclaimWorktree` in `src/loop/card-runner.ts` and of `src/delivery/ship.ts` (reviewer-verified against the diff). [R2]
  - 5. `changelog.d/T0-CARD-PHASE-DOC.md` holds the entry in the form of `changelog.d/README.md`, the prose test passes, and `git diff --numstat origin/main...HEAD -- src templates` is empty. [R5] [dod arms 3, 4]
depends_on: []
budget: 130
tdd: true
sweep: "On main at a8008e12. `git grep -n -o -E '\\bcard (start|cleanup|red|ship)\\b' -- README.md CLAUDE.md REVIEW.md docs/OPERATIONS.md docs/ARCHITECTURE.md docs/DELIVERY-OPS.md docs/PROJECT-STATE.md docs/REQUIREMENTS-TRACEABILITY.md .claude/skills` finds `card ship` in docs/OPERATIONS.md (lines 49 and 51, the `aidlc run` guard) and in two skill files, `card red` in two skill files, and neither `card start` nor `card cleanup`. `src/cli/main.ts:950` defines the four commands in one loop. In `src/`, `ScaffoldShipPath.phase` is called for `ship` only (`src/delivery/ship.ts:314`), and `reclaimWorktree` (`src/loop/card-runner.ts`) removes the worktree through git on the scaffold and github paths. `tests/infra/cli-inprocess.test.ts` runs `card start` and `card red` against a `scripts/task.ps1` of its own to compare output capture, and asserts none of the statements of R2 or R3."
forbid: [a change under src/ or templates/, a change to an existing test file]
non_goals:
  - the PREPARE narration that names `scripts/task.ps1` on the github ship path (issue 376)
  - a doc claims test over every command of the CLI (issue 420, not built by the owner's decision)
  - what the scaffold's `task.ps1` does inside a phase, which the scaffold repository defines
  - the `AIDLC_RUN_NO_SHIP` refusal of `card ship`, which docs/OPERATIONS.md states under `aidlc run` and tests/scenarios/run-driver.test.ts pins
hygiene: "Issue 419, taken as the docs option (a sentence for each command where the scaffold ship path is described). Acceptance 2 and 3 pin behaviour main already has; acceptance 1 is the RED. The tests run `pwsh`, as tests/infra/cli-inprocess.test.ts does. No behaviour of aidlc changes; the fragment records the new operating-guide text, as T0-BUDGET-DOC-TRUTH did."
doc_sync: changelog.d/T0-CARD-PHASE-DOC.md
---

# T0-CARD-PHASE-DOC

From issue 419.

## Deliverable
One paragraph in `docs/OPERATIONS.md` that describes `aidlc card start`, `aidlc card red`, `aidlc card ship` and `aidlc card cleanup`: what each runs on the scaffold ship path, its two options, and its refusal on the other ship paths. `card start` and `card cleanup` are named in no document today. `tests/surface/card-phase-doc.test.ts` reads the paragraph and runs the commands, so a phase command added, removed or changed later fails it until the paragraph follows.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/card-phase-doc.test.ts tests/surface/prose.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: the three tests of the new file pass, the prose test passes and the changelog fragment is well formed.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
| 1 | `tests/surface/card-phase-doc.test.ts`, test `acceptance 1: the paragraph follows the PREPARE paragraph and names exactly the phase commands and the options of the CLI help`; RED at 95775d0e: `the paragraph after the one that begins "PREPARE and the card worktree" begins "Scaffold phase commands (card T0-CARD-PHASE-DOC, issue 419):"` | pass after the paragraph |
| 2 | Same file, test `acceptance 2: on the scaffold ship path each command runs task.ps1 in the main checkout ...`: 12 runs of the recording `scripts/task.ps1`, each of the four commands with no option, with `--base other --local` and under `mode: local` | pass |
| 3 | Same file, tests `acceptance 3: on the github ship path ...` and `acceptance 3: on the dry-run ship path ...`: each of the four commands, with and without the options | pass |
| 4 | Read against the source: `src/cli/main.ts:950-966` (the `pwsh` arguments, `cwd`, `stdio: 'inherit'`, the exit code, the `AIDLC_RUN_NO_SHIP` guard), `src/loop/card-runner.ts:1367` (the `prepare` narration names `-Phase start`), `src/delivery/ship.ts:303-316` (`phase` is called for `ship` only), `src/loop/card-runner.ts` `reclaimWorktree` and `src/loop/worktree-reclaim.ts:43` (`git.removeWorktree`) | reviewer-verified |
| 5 | `tests/surface/changelog-fragments.test.ts`, `tests/surface/prose.test.ts`; `git diff --numstat origin/main...HEAD -- src templates` | pass; empty |

Each clause of R1 to R3 and the assertion that fails without it (the mutant named was applied, the test file run, and the file restored):

| Clause | Mutant | Failing test |
|---|---|---|
| R1 place | the paragraph moved before the PREPARE paragraph | acceptance 1 |
| R1 the four commands | `aidlc card cleanup <id>` left out; `aidlc card verify <id>` added | acceptance 1 |
| R4 commands equal the CLI's | a fifth phase in `src/cli/main.ts`; `cleanup` removed there | acceptance 1 |
| R4 options equal the CLI's | `--local` left out of the paragraph; `--force` added to it; `--force` added to the commands | acceptance 1 |
| R2 `-TaskId`, own `-Phase` | `-Phase` always `start`; an extra argument; `-TaskId <id>` left out of the paragraph | acceptance 2 |
| R2 main checkout | `cwd: process.cwd()` | acceptance 2 |
| R2 exit code | exit 1 for every non-zero script exit | acceptance 2 |
| R2 `-Base` | the configured base not passed; `--base` ignored | acceptance 2 |
| R2 `-Local` | `--local` ignored; `mode: local` ignored; `mode: local` left out of the paragraph | acceptance 2 |
| R3 message, exit 1, nothing run | another message in the CLI or in the paragraph; exit 2; `dry-run` not refused | acceptance 3 |
