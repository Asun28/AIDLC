---
id: T1-REPLAY-CLEAN
title: The reviewer bench holds 15 confirmed clean cases under evals/review/clean/, chosen by a fixed seeded rule from card runs whose first R3 decision passed, whose card merged and has no successor
status: merged
branch: T1-REPLAY-CLEAN
worktree: D:\wt\AIDLC\T1-REPLAY-CLEAN
plan_ref: plans/review-recall.md#order-of-work
allow_paths:
  - bench/outcome/clean.ts
  - evals/review/clean/*.json
  - evals/review/README.md
  - tests/surface/outcome-clean.test.ts
  - tests/surface/review-bench.test.ts
  - specs/tasks/T1-REPLAY-CLEAN.md
dod_command: npm run typecheck && node --test tests/surface/outcome-clean.test.ts tests/surface/outcome-replay.test.ts tests/surface/review-bench-export.test.ts
dod_exit: 0
requirements:
  - R1. `selectClean(drafts, facts)` (new, exported from bench/outcome/clean.ts) shall take clean drafts of the `ReviewBenchCase` shape and, per draft, the facts `cardStatus`, `supersededBy`, `scorable` and whether its candidate is the candidate of a case under evals/review/replay/, and return the confirmed cases: drafts whose card file has `status: merged`, no `superseded_by`, are scorable and share no candidate with a replay case; one per card (the draft with the smallest id); ordered by the sha256 of the id, hex ascending; the first 15 with distinct candidates. Each returned case has `confirmed: true` and `confirmedBy` equal to the constant `CLEAN_RULE` (the rule of this requirement in one sentence ending `no person checked this case`). Fewer than 15 eligible drafts returns them all and a `shortBy` count.
  - R2. `node bench/outcome/clean.ts` shall read the drafts of `aidlc review bench export --clean --dir _local/clean-drafts` (run first by the implementer; the directory is gitignored), compute the facts (card file from specs/tasks/<id>.md through `parseCardText`; scorable as `bench/outcome/replay.ts` `scorable` decides it, with `formalReview.maxDiffBytes`), write each selected case to `evals/review/clean/<id>.json` through `ReviewBenchCase.parse`, and print the counts of drafts, eligible drafts and written cases. It refuses (exit 2, nothing written) when evals/review/clean/ already holds a file.
  - R3. evals/review/clean/ shall hold exactly 15 case files written by R2, each a confirmed `kind: clean` case.
  - R4. evals/review/README.md shall name evals/review/clean/, the rule of R1 and the command of R2. `CASES_README` of tests/surface/review-bench.test.ts (:453), which pins that file's paragraphs exactly, shall gain the R4 paragraph as added element(s) at its place in the list; no other line of that test changes.
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
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than the `CASES_README` addition of R4
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

## Attempt evidence

Attempt 1 (base main c1583bb6).

RED: commit 8f511a9e, `node --test tests/surface/outcome-clean.test.ts`, pass 0, fail 3:
- `not ok 1 - T1-REPLAY-CLEAN acceptance 1: ...`: `ERR_MODULE_NOT_FOUND` for bench/outcome/clean.ts.
- `not ok 2 - T1-REPLAY-CLEAN acceptance 2: ...`: `ERR_MODULE_NOT_FOUND` for bench/outcome/clean.ts.
- `not ok 3 - T1-REPLAY-CLEAN acceptance 3: ...`: `ENOENT: no such file or directory, scandir '...\evals\review\clean'`.

Export: `aidlc review bench export --clean --dir _local/clean-drafts` wrote 140 drafts.
Selection: `node bench/outcome/clean.ts` printed `drafts 140, eligible drafts 130, written cases 15` (exit 0); a second run printed `clean: evals\review\clean already holds a file; nothing written` (exit 2).

| Item | Proof | Result |
|---|---|---|
| 1 | tests/surface/outcome-clean.test.ts, acceptance 1 | pass |
| 2 | tests/surface/outcome-clean.test.ts, acceptance 2 | pass |
| 3 | tests/surface/outcome-clean.test.ts, acceptance 3 | pass |
| 4 | tests/surface/outcome-replay.test.ts and tests/surface/review-bench-export.test.ts, unchanged | pass |
| 5 | printed counts above; evals/review/README.md last paragraph | reviewer-verified |
| R4 (`CASES_README`) | tests/surface/review-bench.test.ts, "T1-REVIEW-BENCH acceptance 9"; `git diff main -- tests/surface/review-bench.test.ts` is one added line, the README's R4 paragraph as the last element of `CASES_README` (after the `evals/review/replay/` element), and no other line | pass |

First full suite (`npm run check`, before the amendment): tests 3722, pass 3693, fail 1, skipped 28. The failure was tests/surface/review-bench.test.ts:497, "T1-REVIEW-BENCH acceptance 9": it pins the paragraphs of evals/review/README.md exactly, so the R4 paragraph broke it. Resolved by the amendment ba044b07 (merged as 0977737a): `CASES_README` gains the R4 paragraph.

`scorable` fact: clean.ts first skipped the git check for a draft already excluded by its card status, successor or replay candidate, and recorded it as `false`. It now computes `scorable` for every draft, so each fact is true as R1 states it. A rerun of `node bench/outcome/clean.ts` on an empty evals/review/clean/ printed `drafts 140, eligible drafts 130, written cases 15` and wrote the same 15 files byte for byte (`diff -r` empty).

DoD (final, after the amendment): `npm run typecheck && node --test tests/surface/outcome-clean.test.ts tests/surface/outcome-replay.test.ts tests/surface/review-bench-export.test.ts`: exit 0, tests 48, pass 48, fail 0.

Full suite (final, `npm run check`): tests 3722, pass 3693, fail 1, skipped 28. Review-bench acceptance 9 passes. The one failure is tests/infra/exec.test.ts:623, "T0-EXEC-TREE-KILL ... acceptance 5", a timing fixture: "fixture not ready before the timeout at scale 2: the machine got slower after calibration (the sleeper's pid file was written 3556 ms after the call, the timeout was 3000 ms)". This diff changes nothing under src/ or tests/infra/; `node --test --test-name-pattern "T0-EXEC-TREE-KILL" tests/infra/exec.test.ts` alone: tests 25, pass 25, fail 0.

### Repair of R3 decision 1 (finding F1, masked-card-dedup-coverage)

Acceptance 1 gains a fixture below the 15 limit: five eligible drafts, two drafts of card T1-TWO on distinct candidates (`T1-TWO.g-1.clean` and `T1-TWO.g-2.clean`), a draft T1-DUP on the candidate of T1-FEW-0, a `kind: bug` draft, and the five excluded drafts. It is run in two input orders, and each run asserts the exact ids (the smaller T1-TWO draft, the first of T1-DUP and T1-FEW-0 by sha256, in sha256 order) and `shortBy`. Only tests/surface/outcome-clean.test.ts changes; bench/outcome/clean.ts and the 15 case files are unchanged.

Hand mutants of `selectClean` (each edits bench/outcome/clean.ts, runs `node --test --test-name-pattern "acceptance [12]:" tests/surface/outcome-clean.test.ts` and restores the file; none committed):

| Mutant | Killed by |
|---|---|
| M1 kind check removed | acceptance 1 |
| M2 card status check removed | acceptance 1, 2 |
| M3 successor check removed | acceptance 1 |
| M4 scorable check removed | acceptance 1 |
| M5 replay-candidate check removed | acceptance 1 |
| M6 per-card choice removed | acceptance 1 |
| M7 per-card choice reversed (largest id) | acceptance 1 |
| M8 sha256 order reversed | acceptance 1, 2 |
| M9 ordered by id instead of its sha256 | acceptance 1, 2 |
| M10 candidate dedup removed | acceptance 1 |
| M11 15 cap removed | acceptance 1 |
| M12 shortBy never set | acceptance 1, 2 |
| M13 shortBy off by one | acceptance 1, 2 |
| M14 `confirmed` false | acceptance 1 |

DoD (after the repair): exit 0, tests 48, pass 48, fail 0. Full suite (`npm run check`, after the repair): exit 0, tests 3722, pass 3694, fail 0, skipped 28; the exec.test.ts:623 timing failure did not recur.
