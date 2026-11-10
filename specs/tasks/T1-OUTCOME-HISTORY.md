---
id: T1-OUTCOME-HISTORY
title: "The outcome bench builds the ruling set from git history, classifies each repeat R3 finding by whether its cited code predates decision 1, marks each finding followed by a change to its file, and reports the three"
status: todo
branch: T1-OUTCOME-HISTORY
worktree: D:\wt\AIDLC\T1-OUTCOME-HISTORY
plan_ref: plans/reliability-baseline.md#order-of-work
allow_paths:
  - bench/outcome/history.ts
  - bench/outcome/views/40-history.sql
  - bench/outcome/run.ts
  - bench/outcome/ingest.ts
  - bench/outcome/README.md
  - tests/surface/outcome-history.test.ts
  - tests/surface/outcome-ingest.test.ts
  - tests/surface/outcome-usage.test.ts
  - tests/surface/outcome-github.test.ts
  - specs/tasks/T1-OUTCOME-HISTORY.md
dod_command: npm run typecheck && node --test tests/surface/outcome-history.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-github.test.ts
dod_exit: 0
requirements:
  - R1. `rulings(runner, base)` in `bench/outcome/history.ts` shall return one row per first-parent commit on the base whose message holds `user's ruling` or `user ruling` in any letter case, with `sha`, `date`, `subject`, `cards` (the card ids in the subject, in order), `successor` and `predecessor` (when the subject reads `<A> replaces <B>`, else null) and `on` (the subject text after `ruling on `, else null).
  - R2. `rulingSet(rulings, tables)` shall return one row per ruling with the ruling's fields plus, for its `predecessor` (else its first card): the stop reason and detail of its last run, the `candidateSha`, `outcome` and `decision` of that run's last formal entry, the findings of that run not resolved at that entry (`id`, `class`, `file`, `reason`), and `successorMerged`; a ruling whose card has no run keeps null in those fields.
  - R3. `repeatBlocks(runner, tables)` shall return one row per formal finding raised at round 2 or later with `goalId`, `cardId`, `id`, `file`, `line` (from `@ <file>:<line>` in its reason, else null), `outsideDelta` and `predates`, where `first` is the `candidateSha` of the run's earliest formal entry with outcome `pass` or `block` and `at` the finding's `candidateSha`.
  - R4. The `predates` value shall be `unknown` when the file, `first` or `at` is missing or either commit is not in the repository; with a line, `true` when the commit `git blame -L <line>,<line> <at> -- <file>` names is `first` or an ancestor of it and `false` otherwise (`unknown` when the blame fails, as for a line past the end of the file); with no line, `true` when `git diff --quiet <first> <at> -- <file>` exits 0 and `file-changed` when it exits 1.
  - R5. `findingFixes(runner, tables)` shall return one row per finding that has a `file` and a `candidateSha`, with `changedAfter`: `true` when the file differs between that commit and the `candidateSha` of the next entry of the same run and stage with outcome `pass` or `block` and another `candidateSha`, `false` when it does not differ, and `unknown` when there is no such entry or a commit is not in the repository.
  - R6. A git command that fails in a way R4 and R5 do not name shall add one `history_errors` row with `command`, `exit` and the first line of its stderr, and the row it was computing takes `unknown`; the base is passed to git after `--end-of-options`, a base that is not a revision of the repository gives one `history_errors` row and no other git call, and a `candidateSha` that is not 40 hex characters is `unknown` with no git call.
  - R7. `run.ts` shall take `--no-history` and write `rulings.jsonl`, `ruling_set.jsonl`, `repeat_blocks.jsonl`, `finding_fixes.jsonl` and `history_errors.jsonl` beside the other tables through `writeTables` with the read-only directories `run.ts` already passes, their columns declared in `bench/outcome/ingest.ts` beside the existing ones; the `run.ts` spawns of `tests/surface/outcome-ingest.test.ts`, `tests/surface/outcome-usage.test.ts` and `tests/surface/outcome-github.test.ts` pass `--no-history`, so those tests read no history of the checkout they run in, and the `run.ts` spawns of `tests/surface/outcome-history.test.ts` pass `--no-usage` and `--no-github`.
  - R8. `views/40-history.sql` shall define `summary_repeat_blocks` (the count and share of each `predates` value, and the count where `predates` is `true` and `outsideDelta` is not true or the reverse), `summary_true_defects` (per stage and perspective: findings raised, disputed, re-raised, and those on a card with a `mergeVerified` run that have `resolvedAt` and `changedAfter` `true`) and `summary_rulings` (rulings per calendar month, rulings per `on` value, card attempts per ruling, and the share of cards with `superseded_by` that are the `predecessor` of a ruling); in each view a null `on`, `predecessor`, `stage` or `predates` is a group of its own, and a share whose denominator is 0 is null.
  - R9. `bench/outcome/README.md` shall state the ruling match, the `predates` rule with its four values, the true-defect proxy and that it cannot show whether a test or another reviewer would have caught the same defect.
acceptance:
  - 1. `tests/surface/outcome-history.test.ts`, in a real temporary git repository: `rulings` returns a commit titled `card: T1-A-2 replaces T1-A by the user's ruling on R3 decision 4` with `successor` `T1-A-2`, `predecessor` `T1-A` and `on` `R3 decision 4`; a commit whose body holds `USER RULING` with one card id and null `successor`; and not a commit that holds only `ruling`, nor one reached only through a merged side branch. [R1] [dod arm 2]
  - 2. Same file: `rulingSet` joins the first ruling to the last run of `T1-A` with its stop detail, the last formal entry, the one finding still open at it and `successorMerged` true, and gives null fields for a ruling whose card has no run. [R2] [dod arm 2]
  - 3. Same file, same repository: for a finding raised at round 2, `predates` is `true` when the cited line was last changed before the first reviewed commit, `false` when the repair changed it, `unknown` for a line past the end of the file, for a `candidateSha` that is not in the repository and for a finding with no `file`; with no line it is `true` for a file the repair did not touch and `file-changed` for one it did. A round 1 finding gives no row. [R3] [R4] [dod arm 2]
  - 4. Same file: `findingFixes` gives `true` for a finding whose file the next reviewed commit changed, `false` for one it left alone, and `unknown` for a finding of the last reviewed commit and for an entry that repeats the same `candidateSha`. [R5] [dod arm 2]
  - 5. Same file: a runner that exits 128 with `fatal: boom` on the blame of an existing line gives one `history_errors` row holding `fatal: boom` and `predates` `unknown` for that finding, with the other findings still classified. [R6] [dod arm 2]
  - 6. Same file, when a DuckDB binary is found, else skipped with the reason `no duckdb binary`: `run.ts` over the fixture prints `summary_repeat_blocks`, `summary_true_defects` and `summary_rulings` with hand-computed values, and `--no-history` writes none of the five files and exits 0. [R7] [R8] [dod arm 2]
  - 7. The README states R1 to R8 (reviewer-verified against the diff). [R9]
  - 8. `tests/surface/outcome-ingest.test.ts`, `tests/surface/outcome-usage.test.ts` and `tests/surface/outcome-github.test.ts` pass unchanged apart from `--no-history` in their `run.ts` spawns, with and without a DuckDB binary. [R7] [dod arm 2]
  - 9. Same file as item 1: a base of `--output=x` writes no file and gives one `history_errors` row, and a finding whose `candidateSha` is `--output=x` is `unknown` with no git call. [R6] [dod arm 2]
depends_on: [T1-OUTCOME-INGEST, T1-OUTCOME-GITHUB-2]
budget: 700
sweep: "New files, plus `bench/outcome/run.ts` and the README. `git log -i --grep=\"user's ruling\"` on main at 8156bf5 returns 23 commits, the recent ones titled `card: <A> replaces <B> by the user's ruling on <what>`. `ReviewFinding` (src/core/types.ts:503) holds `file`, `candidateSha`, `round`, `outsideDelta` and `resolvedAt`; the cited line is in `reason` as `@ file:line`. Git runs through the injectable runner, as `src/probes/git.ts` does. Amended on 2026-11-11 before the card started, from T1-OUTCOME-USAGE and T1-OUTCOME-GITHUB: the card runs after both successors merge, so the three stages disable each other in their test spawns; an option-shaped base or commit id was a decision 1 block on T1-OUTCOME-GITHUB, so R6 and acceptance 9 state it here; budget 700, since the three earlier cards came to 660, 760 and 1050 changed lines against plans of 450. Amended again after PR 257: `ingest.ts` is in scope for the column declarations, as it was for the two earlier stages, and R8 states what a missing value does in the views (lesson of T1-OUTCOME-GITHUB-2)."
forbid: [any change under src/ templates/ or .claude/, a git command that writes (checkout, reset, update-ref, gc, fetch), a dependency added to package.json, a network call]
non_goals: [rulings recorded only in chat or in a card body (not found; the README says so), a line cited as a range (the first line is used), pre-review findings in `repeat_blocks` (formal only), deciding whether a finding was a true defect (the proxy only; the labels are T1-OUTCOME-BASELINE)]
hygiene: "Old candidate commits may be gone from the repository. `unknown` is a result, not a failure, and the views report its count."
doc_sync: bench/outcome/README.md
---

# T1-OUTCOME-HISTORY

## Deliverable
The ruling set, the repeat-block classification against decision 1, the findings followed by a fix, and their three views.

## Why
The stated cause of most replaced cards is R3 raising a new finding at each decision on code that was already there at decision 1. `outsideDelta` records that per file from the review side; `git blame` checks it per line from the repository side. The ruling set is the labelled data any later change to the gate is replayed against.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-history.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-usage.test.ts tests/surface/outcome-github.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; item 6 is skipped only where no DuckDB binary is found.
