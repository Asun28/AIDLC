---
id: T1-FINDING-REPRO
title: "`aidlc review repro` runs the author's repro of a finding on the reviewed candidate and on the current one, records both exits on the finding, and the next R3 prompt and `review stats` show it"
status: todo
branch: T1-FINDING-REPRO
worktree: D:\wt\AIDLC\T1-FINDING-REPRO
plan_ref: plans/pstack-study.md#order-of-work
allow_paths:
  - src/review/repro.ts
  - src/review/bench.ts
  - src/core/types.ts
  - src/review/pre-review.ts
  - src/review/stats.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/finding-repro.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/repair-check.test.ts
  - tests/surface/stats.test.ts
  - tests/surface/command-lines.test.ts
  - tests/scenarios/fault-points.test.ts
  - .claude/skills/verify-card-run-writes/SKILL.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-FINDING-REPRO.md
dod_command: npm run typecheck && node --test tests/scenarios/finding-repro.test.ts tests/surface/stats.test.ts tests/surface/command-lines.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/review-block.test.ts tests/scenarios/repair-check.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review repro <cardId> <findingId> --argv <json> [--files <paths>] [--goal <id>]` shall accept a JSON array of strings as the argv (never a shell string) and a comma-separated list of repository-relative paths, and refuse before any run a finding that does not exist, a finding with no `candidateSha`, a card run with no current candidate, an argv that is not a non-empty string array, a path that is absolute, contains `..`, has `.aidlc` as its first segment, or is missing from the current candidate, and a path that is a symbolic link in the current candidate.
  - R2. The command shall run the argv twice, each in a temporary detached checkout under the OS temp directory that it removes afterwards: once at the finding's `candidateSha` with each `--files` path taken from the current candidate, once at the current candidate. Each checkout links the main checkout's `node_modules` when it exists, as card worktrees do, and the link is removed before the checkout. Each run uses the process environment with `AIDLC_STATE_DIR` set to a new empty temporary directory, removed afterwards, and the DoD timeout. The command itself writes only its temporary checkouts, that state directory and the finding record, and never runs the argv with the main checkout or the card worktree as its working directory.
  - R3. The finding shall gain an optional `repro` record: argv, files, the two shas, the two exit codes (a timeout recorded as such), the time, and `reproduced`, true only when the run at the reviewed candidate exits non-zero and the run at the current candidate exits 0. A later repro of the same finding replaces it. Records written before this card parse unchanged.
  - R4. The `## Prior findings` section of the R2 and R3 prompts shall add, for a finding with a repro, one line naming the argv as a JSON string, both exits and whether it reproduced, as quoted evidence.
  - R5. `aidlc review stats` shall count per card and in the totals: fixed findings with a repro, of them reproduced, and findings answered `wrong` with a repro whose run at the reviewed candidate exited 0.
  - R6. Each REVIEW_FIX narration of a formal block (the REVIEW_FIX build directive, the review-fix of a pending block and the review-fix the ship path returns) shall end with one sentence, which does not contain the word `class`, asking the author to record `aidlc review repro` for each fixed finding of the Bugs or Security pass, and to attach one to a `wrong` dispute, as evidence that changes no gate.
  - R7. A repro shall change no state, decision, counter, allowance or gate of the card run; a failed write of the finding shall be reported with exit 1 and nothing else changed.
acceptance:
  - 1. `tests/scenarios/finding-repro.test.ts`: on a fixture repository with a reviewed candidate holding a bug and a repair commit adding a test file that catches it, `review repro` with `--files` naming that test records exit non-zero at the reviewed sha, 0 at the repair, `reproduced: true`, and leaves no temporary checkout listed by `git worktree list`. [R2] [R3] [dod arm 1]
  - 2. Same file: each refusal of R1 exits 1 and writes nothing to the card run. [R1] [R7] [dod arm 1]
  - 3. Same file: the next formal prompt holds the repro line inside `## Prior findings`, with the argv quoted, and a finding without a repro has no such line. [R4] [dod arm 1]
  - 4. Same file: the REVIEW_FIX directive after a formal block ends with the R6 sentence; `tests/scenarios/review-block.test.ts` expects each of the three formal REVIEW_FIX narrations to be its text before this card followed by the R6 sentence, and `tests/scenarios/repair-check.test.ts` (T0-REPAIR-CHECK acceptance 1) expects the class list and then the R6 sentence after the repair check, with every assertion still exact. [R6] [dod arms 1, 5 and 6]
  - 5. Same file: the run's state, `substantiveDecisions`, attempts and receipts are equal before and after a repro. [R7] [dod arm 1]
  - 6. `tests/surface/stats.test.ts`: two fixed findings, one reproduced, and one `wrong` finding whose repro exited 0 at the reviewed sha give the R5 counts; a run with none shows 0. [R5] [dod arm 2]
  - 7. `tests/surface/command-lines.test.ts` pins the command. [R1] [dod arm 3]
  - 8. `tests/scenarios/fault-points.test.ts` passes; a repro write is a card-run store write, so it is added to the covered commands or recorded as not covered in the verify skill's coverage record, and the sync commit moves at CLOSE on main. [R7] [dod arm 4]
  - 9. The docs and CHANGELOG state R1 to R7 (reviewer-verified against the diff). [R3] [R5]
  - 10. `tests/scenarios/finding-repro.test.ts`: each run of the argv sees `AIDLC_STATE_DIR` naming an empty directory that no longer exists after the repro, also when the argv fails or times out; a `--files` path that starts with `.aidlc` or is a symbolic link in the current candidate is refused before any run. [R1] [R2] [dod arm 1]
depends_on: []
budget: 780
sweep: "Sites on main at 01dd308: the temporary checkout in src/review/bench.ts:180 (`worktree add --detach`, reused or moved to src/review/repro.ts); `ReviewFinding` src/core/types.ts:482; `renderPriorFindings` src/review/pre-review.ts:250 and the section :433; the responses in src/review/stats.ts:50 to :69 and the empty record :155; the formal REVIEW_FIX narrations, at f0b58e6 src/loop/card-runner.ts:766 (the REVIEW_FIX build directive), :1491 (a pending block) and :2808 (the ship path), all ending with `classRepairNote`; tests/scenarios/review-block.test.ts pins them at :901, :904, :912, :920 and :941, and :922 asserts that an untagged repair narration does not contain the word class; tests/scenarios/repair-check.test.ts:55 pins the tail after the repair check to the class list; the `dispute` command src/cli/main.ts:838. Not sites: the R2 REVIEW_FIX narration :1428 (R2 is off in this repository; it gets the sentence only if it shares the helper)."
forbid: [weakening or skipping a test to go green, a gate or decision on a repro result, running the argv through a shell, running the argv with the main checkout or the card worktree as its working directory, editing .aidlc state by hand]
non_goals: [the reviewer writing or running a repro, a repro on an R2 finding (allowed by the command, not asked by the narration), checking that the repro tests what the finding says, a repro for findings answered intentional or not-worth-fixing, sandboxing the argv (it is the author's own command, trusted as the DoD command is; it can name any absolute path, and it is reviewed with the repair)]
hygiene: "Line numbers are from main at 01dd308; read them again at PREPARE. The argv, the paths and the output are outside text: in a narration, a stop detail or a prompt they appear as JSON strings (T0-NARRATION-QUOTE). The finding write goes through the card-run store with the same lock as `review dispute`, so read docs/LESSONS.md on read-then-write windows (T0-CARD-TAKEOVER-2) before the first candidate. This card writes a card-run record from a new command, so run the verify-card-run-writes skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (Review, Findings and dispositions), docs/ARCHITECTURE.md (module map), CHANGELOG.md
---

# T1-FINDING-REPRO

## Deliverable
After a formal block, the author fixes a finding, adds a test that catches it, and runs `aidlc review repro <card> F2 --argv '["node","--test","tests/x.test.ts"]' --files tests/x.test.ts`. The finding records that the test fails on the reviewed candidate and passes on the repair. R3 decision 2 and `aidlc review stats` see it.

## Why
pstack's `interrogate` keeps a finding only when a run proves it, `blast-radius` ranks a claim by how it was checked (said, pointed at, walked, ran, reproduced), and the `babysit` playbook fixes a review finding red-first. Here, of 678 findings over 232 card records (`aidlc review stats`, 2026-11-07), 438 are answered fixed and 59 wrong, and no record shows either was checked by a run: the RED receipt is a string the loop never executes. The record gives R3 decision 2 a checked fact instead of a claim, and gives the deferred false-positive patterns (`intent/pstack-study.md`) the data they need.

## Rules that decide edge cases
- `--files` overlays only paths that exist in the current candidate; the overlay is what lets a test added by the repair run against the reviewed code.
- `reproduced` needs both runs: a test that fails on both commits or passes on both is recorded with its exits and `reproduced: false`.
- For a `wrong` dispute the useful result is exit 0 at the reviewed candidate: the author's check of the claimed failure did not fail. The stats count it; nothing is decided from it.
- The command isolates the argv by its working directory (a temporary checkout) and its state directory (new, empty, temporary), and by nothing else: the argv is the author's command and is trusted as the DoD command is.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/finding-repro.test.ts tests/surface/stats.test.ts tests/surface/command-lines.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/review-block.test.ts tests/scenarios/repair-check.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes and the fault-point check covers or records the new write.

## Attempt evidence
Attempt 1 (effort medium). RED receipt: `8c145dd:1`. DoD: `npm run typecheck && node --test tests/scenarios/finding-repro.test.ts tests/surface/stats.test.ts tests/surface/command-lines.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/review-block.test.ts tests/scenarios/repair-check.test.ts`.

| # | Requirement | Implementation | Test |
|---|---|---|---|
| 1 | R2 R3 | `src/review/repro.ts` `runRepro`, `runAt`, `closeWorkspace`; `src/core/types.ts` `FindingRepro` | `tests/scenarios/finding-repro.test.ts` "acceptance 1" |
| 2 | R1 R7 | `src/review/repro.ts` `parseReproArgv`, `parseReproFiles`, `checkFiles`, the refusals in `runRepro` | `tests/scenarios/finding-repro.test.ts` "acceptance 2 and 10" |
| 3 | R4 | `src/review/pre-review.ts` `reproLine`; `src/loop/card-runner.ts` `priorFindingsFor` | `tests/scenarios/finding-repro.test.ts` "acceptance 3" |
| 4 | R6 | `REPRO_REQUEST` in `src/review/repro.ts`, at the three formal REVIEW_FIX narrations in `src/loop/card-runner.ts` | `tests/scenarios/finding-repro.test.ts` "acceptance 4"; `tests/scenarios/review-block.test.ts` T1-REVIEW-CLASS-SWEEP acceptance 5 (two tests), 6, 7; `tests/scenarios/repair-check.test.ts` T0-REPAIR-CHECK acceptance 1 (the class list and the repro sentence follow the repair check) |
| 5 | R7 | `runRepro` writes only the finding's `repro` under `GoalStore.updateCardRun`, no revision bump, no journal | `tests/scenarios/finding-repro.test.ts` "acceptance 5" |
| 6 | R5 | `src/review/stats.ts` `ReproStats`, `countRepro`, `totalsOf`, `reproText` | `tests/surface/stats.test.ts` "acceptance 6" (two tests) |
| 7 | R1 | `src/cli/main.ts` `review repro` | `tests/surface/command-lines.test.ts` "T1-FINDING-REPRO acceptance 7" |
| 8 | R7 | not covered: recorded under Not covered in `.claude/skills/verify-card-run-writes/SKILL.md` (one `updateCardRun` write, no journal append); the sync commit moves at CLOSE on main | `tests/scenarios/fault-points.test.ts` passes unchanged |
| 9 | R3 R5 | `docs/OPERATIONS.md` (Findings and dispositions: Repros; Review statistics: Repros), `docs/ARCHITECTURE.md` module map, `CHANGELOG.md` Unreleased | reviewer-verified |
| 10 | R1 R2 | `runAt` (new `AIDLC_STATE_DIR` per run, removed in `finally`), `parseReproFiles` (`.aidlc`), `checkFiles` (mode 120000) | `tests/scenarios/finding-repro.test.ts` "acceptance 10" and "acceptance 2 and 10" |
