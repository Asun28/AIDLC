---
id: T1-BENCH-TRIALS
title: The reviewer bench runs each case `--trials <n>` times and reports median and range, and `aidlc review bench compare` gives one verdict on two reports
status: todo
branch: T1-BENCH-TRIALS
worktree: D:\wt\AIDLC\T1-BENCH-TRIALS
plan_ref: plans/pstack-study.md#order-of-work
allow_paths:
  - src/core/trial-compare.ts
  - src/review/bench.ts
  - src/cli/main.ts
  - tests/core/trial-compare.test.ts
  - tests/surface/review-bench.test.ts
  - tests/surface/command-lines.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - evals/review/README.md
  - CHANGELOG.md
  - specs/tasks/T1-BENCH-TRIALS.md
dod_command: npm run typecheck && node --test tests/core/trial-compare.test.ts tests/surface/review-bench.test.ts tests/surface/command-lines.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review bench run` shall accept `--trials <n>` (an integer from 1 to 20, default 1) and review every selected case n times; any other value shall be refused before a review.
  - R2. The report shall keep the per-case results of every trial, the totals of every trial, and a `summary` with the median, minimum and maximum of recall and of false-block rate over the trials, the trial count, and the sum of no-verdict and error counts over the trials. With `--trials 1` the existing fields keep their values.
  - R3. `src/core/trial-compare.ts` shall export a pure function that takes two summaries and the case ids of each report and returns `better`, `worse`, `no-measurable-difference` or `inconclusive` with a one-line reason.
  - R4. The verdict shall be `inconclusive` when the case id sets differ, when either side has fewer than 3 trials, or when either side has a no-verdict or an error in any trial; each cause named in the reason.
  - R5. Otherwise the verdict shall be decided by recall when the two recall ranges do not overlap (higher is better), else by false-block rate when those ranges do not overlap (lower is better), else `no-measurable-difference`.
  - R6. `aidlc review bench compare <before.json> <after.json>` shall read two saved bench reports, print the verdict and its reason as a line, or as JSON with `--json` or when stdout is not a TTY, and exit 0 for any verdict and 1 when a file is missing or is not a bench report.
  - R7. `docs/OPERATIONS.md` (Reviewer bench) shall replace the sentence that a REVIEW.md change is kept "only when recall does not drop" with the two commands and the verdict that keeps a change: `better` or `no-measurable-difference`.
acceptance:
  - 1. `tests/core/trial-compare.test.ts`: the median of an even and an odd trial count; each of the four verdicts on built summaries; each inconclusive cause named in the reason. [R3] [R4] [R5] [dod arm 1]
  - 2. `tests/surface/review-bench.test.ts`: `--trials 3` on a scripted reviewer that hits a case in 2 of 3 trials reports recall median, minimum and maximum, and calls the reviewer 3 times per case; `--trials 0` and `--trials 21` are refused before any review. [R1] [R2] [dod arm 2]
  - 3. Same file: a `--trials 1` report keeps every field and value a report had before this card. [R2] [dod arm 2]
  - 4. Same file: `bench compare` on two saved reports prints the verdict; a missing file and a JSON file that is not a bench report exit 1. [R6] [dod arm 2]
  - 5. `tests/surface/command-lines.test.ts` pins the new option and command. [R1] [R6] [dod arm 3]
  - 6. The docs and CHANGELOG state R1 to R7 (reviewer-verified against the diff). [R7]
depends_on: []
budget: 260
sweep: "Sites on main at 01dd308: `runReviewBench` src/review/bench.ts:135 (the case loop), the totals :314 to :323, `formatBenchReport` :547; the `bench run` command src/cli/main.ts:884. Not a site: `bench export` src/cli/main.ts:902, which reviews nothing."
forbid: [weakening or skipping a test to go green, a gate in CI or in the loop on a bench verdict, a model call in a test, editing .aidlc state by hand]
non_goals: [running trials in parallel, a statistical test beyond range overlap, trials for `bench export`, a judge model, changing which cases a run selects]
hygiene: "Line numbers are from main at 01dd308; read them again at PREPARE. The pure verdict lives in src/core and takes no I/O, so T1-EVAL-VARIANT can reuse it with pass rates in place of recall. Reason text is built from the reports' own fields; a case id from a file is outside text and is printed as a JSON string (T0-NARRATION-QUOTE)."
doc_sync: docs/OPERATIONS.md (Reviewer bench), docs/ARCHITECTURE.md (module map), evals/review/README.md, CHANGELOG.md
---

# T1-BENCH-TRIALS

## Deliverable
`aidlc review bench run --trials 3` reports recall and false-block rate with their range, and `aidlc review bench compare before.json after.json` says `better`, `worse`, `no-measurable-difference` or `inconclusive`.

## Why
pstack's `principle-explain-the-number` and `benchmark-checklist`: a number is reported with its run count and spread, a gap smaller than the run-to-run spread is no measurable difference, and a run where the work did not happen (here, a no-verdict) makes the result inconclusive. On 20 confirmed cases a repeat with identical rules changed the result on 5 (`specs/second-r3-pass.md`), and the bench reports one run with no spread. `docs/OPERATIONS.md` asks for a REVIEW.md change to be kept only when recall does not drop, and no command decides that.

## Rules that decide edge cases
- Trials run one after another, case by case, so a quota hold stops the run where it is, as today.
- A trial's recall of `null` (no bug case selected) makes the summary's recall `null` and the verdict on recall skipped, not inconclusive by itself.
- Three trials is the minimum for a verdict. pstack's checklist asks for five; five formal trials over the 30 confirmed cases take 2.5 to 5 hours at 1 to 2 minutes per review (the figure in T1-R3-SECOND-PASS), so three is the floor and the reason names it when it applies.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/trial-compare.test.ts tests/surface/review-bench.test.ts tests/surface/command-lines.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
