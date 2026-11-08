---
id: T1-BENCH-TRIALS-2
title: The reviewer bench runs each case `--trials <n>` times and reports median and range, and `aidlc review bench compare` gives one verdict on two reports
status: todo
branch: T1-BENCH-TRIALS-2
worktree: D:\wt\AIDLC\T1-BENCH-TRIALS-2
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
  - specs/tasks/T1-BENCH-TRIALS-2.md
dod_command: npm run typecheck && node --test tests/core/trial-compare.test.ts tests/surface/review-bench.test.ts tests/surface/command-lines.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc review bench run` shall accept `--trials <n>` (an integer from 1 to 20, default 1) and review every selected case n times; any other value shall be refused before a review.
  - R2. The report shall keep the per-case results of every trial, the totals of every trial, and a `summary` with the median, minimum and maximum of recall and of false-block rate over the trials, the trial count, and the sum of no-verdict and error counts over the trials. With `--trials 1` and no quota hold the existing fields keep their values.
  - R3. `src/core/trial-compare.ts` shall export a pure function that takes two summaries and the case ids of each report and returns `better`, `worse`, `no-measurable-difference` or `inconclusive` with a one-line reason.
  - R4. The verdict shall be `inconclusive` when the case id sets differ, when either side has fewer than 3 trials, or when either side has a no-verdict or an error in any trial; each cause named in the reason.
  - R5. Otherwise the verdict shall be decided by recall when the two recall ranges do not overlap (higher is better), else by false-block rate when those ranges do not overlap (lower is better), else `no-measurable-difference`.
  - R6. `aidlc review bench compare <before.json> <after.json>` shall read two saved bench reports, print the verdict and its reason as a line, or as JSON with `--json` or when stdout is not a TTY, and exit 0 for any verdict. It shall exit 1, naming the file and the rule, when a file is missing or is not JSON, or when a report breaks one of these rules, and for no other cause. The rules: (a) a report field (`stage`, `reviewer`, `rules`, `policyHash`, `leftCheckouts`, `cases`, `totals`, `trialResults` with 1 to 20 trials, `summary`) or a case field is missing or of the wrong type, a rate is outside 0 to 1, or a count is negative; (b) a case id appears twice in one list; (c) a bug case has outcome `pass` or `false-block`, or a clean case has `hit` or `miss`; (d) a `hit`, `miss`, `pass` or `false-block` has a `runStatus` other than `success`; (e) a `pass`, `no-verdict` or `error` cites a reason; (f) a case other than a `hit` has `matched`, a `hit` has none, or its `matched.reason` is not one of its `cited` or cites a file other than `matched.file`; (g) a trial lists other case ids than `cases`, or gives a case another `kind` or `confirmed` than `cases` does; (h) a trial's totals differ from the totals the bench computes from its cases; (i) `cases` and `totals` differ from those of the first trial; (j) `summary` differs from the one its `trialResults` give.
  - R7. `docs/OPERATIONS.md` (Reviewer bench) shall replace the sentence that a REVIEW.md change is kept "only when recall does not drop" with the two commands and the verdict that keeps a change: `better` or `no-measurable-difference`; it shall list the rules of R6 and state that they do not authenticate a report.
  - R8. A review that ends on a quota hold shall stop the run: no later review runs in any trial, and every case of every trial not yet reviewed shall be `no-verdict` with the detail `not reviewed: a quota hold stopped the run`, also with `--trials 1`.
acceptance:
  - 1. `tests/core/trial-compare.test.ts`: the median of an even and an odd trial count; each of the four verdicts on built summaries; each inconclusive cause named in the reason. [R3] [R4] [R5] [dod arm 1]
  - 2. `tests/surface/review-bench.test.ts`: `--trials 3` on a scripted reviewer that hits a case in 2 of 3 trials reports recall median, minimum and maximum, and calls the reviewer 3 times per case; `--trials 0` and `--trials 21` are refused before any review. [R1] [R2] [dod arm 2]
  - 3. Same file: a `--trials 1` report keeps every field and value a report had before this card. [R2] [dod arm 2]
  - 4. Same file: `bench compare` on two saved reports prints the verdict; a missing file and a JSON file that is not a bench report exit 1. [R6] [dod arm 2]
  - 5. `tests/surface/command-lines.test.ts` pins the new option and command. [R1] [R6] [dod arm 3]
  - 6. The docs and CHANGELOG state R1 to R8 (reviewer-verified against the diff). [R7]
  - 7. `tests/surface/review-bench.test.ts`: a scripted reviewer whose first review is a quota hold, two case groups and `--trials 3`: the reviewer is called once, and every other case of every trial is `no-verdict` with the R8 detail and counted in `summary.noVerdict`. [R8] [dod arm 2]
  - 8. Same file: one report per rule (a) to (j) of R6, each made from a real saved report by one change, exits 1 with the rule in stderr; a real report whose first review is a quota hold compares with exit 0 and verdict `inconclusive`. [R6] [dod arm 2]
depends_on: []
budget: 540
sweep: "Sites on main at 01dd308: `runReviewBench` src/review/bench.ts:135 (the case loop), the totals :314 to :323, `formatBenchReport` :547; the `bench run` command src/cli/main.ts:884. Not a site: `bench export` src/cli/main.ts:902, which reviews nothing. The candidate it continues is branch T1-BENCH-TRIALS at 4d78243."
forbid: [weakening or skipping a test to go green, a gate in CI or in the loop on a bench verdict, a model call in a test, editing .aidlc state by hand]
non_goals: [running trials in parallel, a statistical test beyond range overlap, trials for `bench export`, a judge model, changing which cases a run selects, authenticating a saved report (a signature, a digest or a stored copy), a compare check outside the R6 list]
hygiene: "This card replaces T1-BENCH-TRIALS by the user's ruling of 2026-11-08 on its R3 decision 4. R3 blocked all four decisions: decision 1 F1 (a quota hold did not stop the run) was fixed and is R8 here; F2 came back on decisions 2, 3 and 4, each time with a new hand-built report that `bench compare` accepted, because R6 said only 'is not a bench report' and the reviewer read it as any report the bench could not have produced. R6 now lists every rule compare checks, and a finding that asks for a check outside that list is outside this card. The branch continues T1-BENCH-TRIALS at 4d78243 (DoD 37/37); it adds rule (f)'s file check and rule (g)'s kind and confirmed check from decision 4, moves the Attempt evidence table here, and renames the card in test titles, the CHANGELOG and the docs. The pure verdict lives in src/core and takes no I/O, so T1-EVAL-VARIANT can reuse it with pass rates in place of recall. Reason text is built from the reports' own fields; a case id from a file is outside text and is printed as a JSON string (T0-NARRATION-QUOTE)."
doc_sync: docs/OPERATIONS.md (Reviewer bench), docs/ARCHITECTURE.md (module map), evals/review/README.md, CHANGELOG.md
---

# T1-BENCH-TRIALS-2

## Deliverable
`aidlc review bench run --trials 3` reports recall and false-block rate with their range, and `aidlc review bench compare before.json after.json` says `better`, `worse`, `no-measurable-difference` or `inconclusive`.

## Why
pstack's `principle-explain-the-number` and `benchmark-checklist`: a number is reported with its run count and spread, a gap smaller than the run-to-run spread is no measurable difference, and a run where the work did not happen (here, a no-verdict) makes the result inconclusive. On 20 confirmed cases a repeat with identical rules changed the result on 5 (`specs/second-r3-pass.md`), and the bench reports one run with no spread. `docs/OPERATIONS.md` asks for a REVIEW.md change to be kept only when recall does not drop, and no command decides that.

## Rules that decide edge cases
- Trials run one after another, case by case. A quota hold stops the run where it is (R8); before this card the bench scored a hold as `no-verdict` and went on to the next review.
- A trial's recall of `null` (no bug case selected) makes the summary's recall `null` and the verdict on recall skipped, not inconclusive by itself.
- Three trials is the minimum for a verdict. pstack's checklist asks for five; five formal trials over the 30 confirmed cases take 2.5 to 5 hours at 1 to 2 minutes per review (the figure in T1-R3-SECOND-PASS), so three is the floor and the reason names it when it applies.
- `bench compare` checks that a saved report is complete and consistent with its own cases, by the rules of R6 and no others. It does not authenticate a report: a hand-edited report that keeps every rule of R6 is compared as given.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/trial-compare.test.ts tests/surface/review-bench.test.ts tests/surface/command-lines.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
| 1 | `tests/core/trial-compare.test.ts`, three T1-BENCH-TRIALS-2 acceptance 1 tests | pass |
| 2 | `tests/surface/review-bench.test.ts`, T1-BENCH-TRIALS-2 acceptance 2 | pass |
| 3 | `tests/surface/review-bench.test.ts`, T1-BENCH-TRIALS-2 acceptance 3 | pass |
| 4 | `tests/surface/review-bench.test.ts`, T1-BENCH-TRIALS-2 acceptance 4 | pass |
| 5 | `tests/surface/command-lines.test.ts`, T1-BENCH-TRIALS-2 acceptance 5 | pass |
| 6 | docs/OPERATIONS.md (Reviewer bench: the trials paragraph with the R6 rules (a) to (j) and the R7 sentence, the R8 quota stop, the keep rule), docs/ARCHITECTURE.md, evals/review/README.md, CHANGELOG.md; pinned by T1-REVIEW-BENCH acceptance 9 | pass; reviewer-verified at R3 |
| 7 | `tests/surface/review-bench.test.ts`, T1-BENCH-TRIALS-2 acceptance 7 (a quota hold on the first review: one reviewer call, five stopped pairs, `summary.noVerdict` 6) | pass |
| 8 | `tests/surface/review-bench.test.ts`, T1-BENCH-TRIALS-2 acceptance 8: the refusal table, rows `a-*` to `j-*`, each exits 1 with `rule (x)` in stderr, and a quota-held run compares with exit 0, `inconclusive`; and the acceptance 8 test that accepts a run's saved report and refuses a partial report, recall 2 and a mismatched summary | pass |

RED receipt: ad503c0:1 (the refusal table names no rule letter, and rules (f) file and (g) kind and confirmed are unchecked).

History (T1-BENCH-TRIALS, branch T1-BENCH-TRIALS): 0d5e6cd:1 (attempt 1), 42a2fb7:1 (R3 decision 1 repair), 41b43fb:1 (R3 decision 2 repair), af54e41:1 (R3 decision 3 repair); its last candidate 4d78243 was blocked by R3 decision 4.
