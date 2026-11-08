---
id: T1-EVAL-VARIANT
title: "`aidlc evals run --variant <ref> --trials <n>` runs the same cases on HEAD and on a checkout of the ref and gives the trial verdict on their pass rates"
status: todo
branch: T1-EVAL-VARIANT
worktree: D:\wt\AIDLC\T1-EVAL-VARIANT
plan_ref: plans/pstack-study.md#order-of-work
allow_paths:
  - src/evals/runner.ts
  - src/core/trial-compare.ts
  - src/cli/main.ts
  - tests/surface/evals.test.ts
  - tests/core/trial-compare.test.ts
  - tests/surface/command-lines.test.ts
  - evals/README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-EVAL-VARIANT.md
dod_command: npm run typecheck && node --test tests/surface/evals.test.ts tests/core/trial-compare.test.ts tests/surface/command-lines.test.ts
dod_exit: 0
requirements:
  - R1. `aidlc evals run` shall accept `--variant <ref>` and `--trials <n>` (an integer from 1 to 20, default 1); `--variant` with `--skip-model` shall be refused, and a ref that does not name a commit shall be refused before any model call.
  - R2. WITH `--variant`, the runner shall run each selected case n times on a temporary checkout of HEAD and n times on a temporary checkout of the ref, alternating sides case by case (HEAD, ref, HEAD, ref), each run under the checkout and state-directory rules of T1-EVAL-TRANSCRIPT-2.
  - R3. The report shall give, per case and in total, each side's pass count, trial count, and the median, minimum and maximum of the pass rate over trials, and the count of model errors and quota holds per side.
  - R4. The report shall carry one verdict from the pure function of T1-BENCH-TRIALS-2, with the pass rate in the place of recall and no second metric: `better` or `worse` for the variant when the two pass-rate ranges do not overlap, `no-measurable-difference` when they do, and `inconclusive` when either side has fewer than 3 trials or a model error or quota hold in any trial.
  - R5. Without `--variant`, `--trials` shall run HEAD alone n times and report the figures of requirement R3 with no verdict; without either option, the output and the gate shall be what they are before this card.
  - R6. The exit code with `--variant` shall be 0 for any verdict and 1 when a checkout cannot be created; the threshold gate shall not apply to a variant run.
  - R7. `evals/README.md` and `docs/OPERATIONS.md` shall state the commands and that a change to `.claude/**`, CLAUDE.md or REVIEW.md is kept when the variant run on the agent cases gives `better` or `no-measurable-difference`, as a documented practice and not a gate.
acceptance:
  - 1. `tests/surface/evals.test.ts`: on a fixture repository with two commits whose case passes on one and fails on the other under a scripted provider, `--variant <other> --trials 3` reports pass rates 3/3 and 0/3 and the verdict `worse` or `better` by side; the scripted provider saw the sides alternate. [R2] [R3] [R4] [dod arm 1]
  - 2. Same file: one model error on either side makes the verdict `inconclusive` naming it; `--trials 2` is `inconclusive` naming the trial count. [R4] [dod arm 1]
  - 3. Same file: `--variant` with `--skip-model` and a ref that names no commit are refused before any provider call; `--trials 0` and `--trials 21` are refused. [R1] [dod arm 1]
  - 4. Same file: a run with neither option gives the same result object and exit code as before this card on the existing example case. [R5] [R6] [dod arm 1]
  - 5. `tests/core/trial-compare.test.ts`: the verdict with one metric and no second metric. [R4] [dod arm 2]
  - 6. `tests/surface/command-lines.test.ts` pins the options. [R1] [dod arm 3]
  - 7. The docs state R1 to R7 (reviewer-verified against the diff). [R7]
depends_on: [T1-BENCH-TRIALS-2, T1-EVAL-TRANSCRIPT-2]
budget: 300
sweep: "Sites on main after T1-BENCH-TRIALS-2 and T1-EVAL-TRANSCRIPT-2 merge: `runSuite` and `runEval` in src/evals/runner.ts, the temporary checkout T1-EVAL-TRANSCRIPT-2 adds, the verdict function in src/core/trial-compare.ts, and the `evals run` command in src/cli/main.ts. Read their lines at PREPARE."
forbid: [weakening or skipping a test to go green, a model call in a test, a gate on the variant verdict in CI or in the loop, a judge model, running a side in the main checkout, editing .aidlc state by hand]
non_goals: [more than two sides, a statistical test beyond range overlap, a variant run for the reviewer bench (T1-BENCH-TRIALS-2 covers it), running variant evals in CI, writing the report to a file (stdout as JSON, as today)]
hygiene: "The case prompt is the same on both sides and names neither side, so the agent cannot tell which version it runs (pstack eval playbook: candidates are not told other candidates exist). Alternating the sides keeps drift and quota timing from favouring one side (benchmark-checklist question 5). A ref is outside text: printed as a JSON string in any narration or error (T0-NARRATION-QUOTE)."
doc_sync: evals/README.md, docs/OPERATIONS.md (Continuous evals), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-EVAL-VARIANT

## Deliverable
Before merging a change to a skill, CLAUDE.md or REVIEW.md: `aidlc evals run --dir evals/agent --provider claude-code --variant main --trials 3` runs the agent cases on the change and on main, three times each, and says whether the change is better, worse, no measurable difference, or inconclusive.

## Why
pstack's eval playbook tests a skill or prompt change against the version before it, with the same organic prompt to each side and the result read from what each side did. Here a change to `.claude/**` is checked in CI by the `--skip-model` command checks only; nothing runs the two versions on the same prompts. The reviewer side has this since T1-BENCH-TRIALS-2; this card gives the agent side the same.

## Rules that decide edge cases
- A case whose prompt or checks differ between the two checkouts is run from the HEAD copy on both sides, so both sides answer the same prompt; the report notes it.
- A quota hold mid-run stops the run and reports the trials completed, with the verdict `inconclusive`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/evals.test.ts tests/core/trial-compare.test.ts tests/surface/command-lines.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
