---
id: T1-REPLAY-CLEAN
title: The reviewer bench holds 15 confirmed clean cases under evals/review/clean/, chosen by a fixed seeded rule from card runs whose first R3 decision passed, whose card merged and has no successor
status: todo
branch: T1-REPLAY-CLEAN
worktree: D:\wt\AIDLC\T1-REPLAY-CLEAN
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - bench/outcome/clean.ts
  - evals/review/clean/*.json
  - evals/review/README.md
  - tests/surface/outcome-clean.test.ts
  - specs/tasks/T1-REPLAY-CLEAN.md
dod_command: npm run typecheck && node --test tests/surface/outcome-clean.test.ts tests/surface/outcome-replay.test.ts tests/surface/review-bench-export.test.ts
dod_exit: 0
requirements:
  - R1. `selectClean(drafts, facts)` (new, exported from bench/outcome/clean.ts) shall take clean drafts of the `ReviewBenchCase` shape and, per draft, the facts `cardStatus`, `supersededBy`, `scorable` and whether its candidate is the candidate of a case under evals/review/replay/, and return the confirmed cases: drafts whose card file has `status: merged`, no `superseded_by`, are scorable and share no candidate with a replay case; one per card (the draft with the smallest id); ordered by the sha256 of the id, hex ascending; the first 15 with distinct candidates. Each returned case has `confirmed: true` and `confirmedBy` equal to the constant `CLEAN_RULE` (the rule of this requirement in one sentence ending `no person checked this case`). Fewer than 15 eligible drafts returns them all and a `shortBy` count.
  - R2. `node bench/outcome/clean.ts` shall read the drafts of `aidlc review bench export --clean --dir _local/clean-drafts` (run first by the implementer; the directory is gitignored), compute the facts (card file from specs/tasks/<id>.md through `parseCardText`; scorable as `bench/outcome/replay.ts` `scorable` decides it, with `formalReview.maxDiffBytes`), write each selected case to `evals/review/clean/<id>.json` through `ReviewBenchCase.parse`, and print the counts of drafts, eligible drafts and written cases. It refuses (exit 2, nothing written) when evals/review/clean/ already holds a file.
  - R3. evals/review/clean/ shall hold exactly 15 case files written by R2, each a confirmed `kind: clean` case.
  - R4. evals/review/README.md shall name evals/review/clean/, the rule of R1 and the command of R2.
acceptance:
  - 1. `tests/surface/outcome-clean.test.ts` (new), "T1-REPLAY-CLEAN acceptance 1: selectClean keeps merged cards with no successor, one per card, ordered by the sha256 of the id, with distinct candidates". Fixture drafts cover each exclusion of R1 (status not merged, a successor, not scorable, a replay candidate, a second draft of one card, a repeated candidate) and more than 15 eligible drafts. Fails on main (no module). [R1] [dod arm 1]
  - 2. Same file, "T1-REPLAY-CLEAN acceptance 2: selectClean reports how many it is short of 15". Fails on main. [R1] [dod arm 1]
  - 3. Same file, "T1-REPLAY-CLEAN acceptance 3: evals/review/clean holds 15 confirmed clean cases on 15 distinct candidates, none a replay candidate, each card merged with no successor". Reads the committed files, specs/tasks and evals/review/replay/, and needs no commit object. Fails on main (no directory). [R3] [dod arm 1]
  - 4. tests/surface/outcome-replay.test.ts and tests/surface/review-bench-export.test.ts pass with no line changed. [dod arm 1]
  - 5. The README text and the printed counts are as R2 and R4 state; the attempt evidence holds the printed counts (reviewer-verified). [R2] [R4]
depends_on: []
budget: 200
tdd: true
sweep: "Main at 0f28b51e. `aidlc review bench export --clean` drafts one clean case per card run whose first R3 decision passed and pins each candidate under refs/aidlc/bench/ (src/cli/main.ts, `review bench export`); it never overwrites a case and writes no state. `ReviewBenchCase` src/core/types.ts:870-886: the `clean` variant has no `expected`, and `confirmed: true` needs `confirmedBy`. bench/outcome/replay.ts `scorable` (:96-100 region) checks the card id at the candidate and the diff size; it is not exported, so clean.ts calls the same functions (`parseCardText`, `collectCandidateDiff`). evals/review/replay/ holds 124 bug cases on 57 triples. `loadBenchCases` reads one directory and does not descend, so a new subdirectory changes no run over evals/review/replay/."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - editing a file under evals/review/replay/ or bench/outcome/*.json
  - a case confirmed by any rule other than R1, or a case chosen by hand
  - editing .aidlc state by hand
non_goals: [running the bench on the clean cases (the arms run does), a false-block figure, a change under src/, a change to CHANGELOG.md]
hygiene: "Line numbers are from main at 0f28b51e; read them again at PREPARE. Run the export from the main checkout's state; `--dir` resolves against the checkout root."
---

# T1-REPLAY-CLEAN

## Deliverable
Fifteen confirmed clean cases the bench can score, so each arm of this goal reports a false-block rate.

## Why
The replay set of the recall baseline holds no clean case, so no arm can show that it blocks a good candidate (docs/reliability/baseline.md, What these numbers do not show). An R2 prefilter that false-blocks costs a repair round before R3. The owner chose 15 clean cases on 2026-11-16 (intent/review-recall.md).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/outcome-clean.test.ts tests/surface/outcome-replay.test.ts tests/surface/review-bench-export.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes.
