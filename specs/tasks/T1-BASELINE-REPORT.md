---
id: T1-BASELINE-REPORT
title: evals/baseline/REPORT.md, generated from the committed build and run records, gives per-task paired differences between Claude Ship and aidlc's review and ship on the same aidlc-built candidates, on resolution, tokens, wall clock and interventions, the end states, the bounds that fired, the minimum detectable difference, and every axis on which aidlc loses
status: todo
branch: T1-BASELINE-REPORT
worktree: D:\wt\AIDLC\T1-BASELINE-REPORT
plan_ref: docs/plans/PLAN-v5.1-hardening.md#2026-11-09-follow-up-cards
allow_paths:
  - evals/baseline/results/
  - evals/baseline/REPORT.md
  - .github/workflows/ci.yml
  - changelog.d/T1-BASELINE-REPORT.md
  - specs/tasks/T1-BASELINE-REPORT.md
dod_command: node evals/baseline/analyze.ts --check
dod_exit: 0
requirements:
  - R1. `evals/baseline/results/` shall hold one record per build and one per arm run, 36 and 72 or the number the spend cap allowed, and REPORT.md shall state the counts and name every build without a candidate, every pair with an arm missing and every run stopped by a cap.
  - R2. REPORT.md shall be the text `analyze.ts` generates from those records, with per-task paired differences for resolved, tokens, cost, wall clock and interventions, the end states by arm, the count of candidates the oracle passed before either arm, the bounds that fired, and the minimum detectable difference per axis.
  - R3. REPORT.md shall state in plain words every axis on which aidlc does worse than Claude Ship.
  - R4. REPORT.md shall name the pinned aidlc SHA, the task repository, the task-list digest the run records carry, the model, the effort, the caps and how Claude Ship was started, and shall state what each arm's cost covers, arm A's by the source its records name and arm B's as its driving session from the candidate, so the review commands arm B starts are outside it.
  - R5. The `ci` workflow shall run `node evals/baseline/analyze.ts --check` in a job of its own on every pull request and every push it builds.
acceptance:
  - 1. `node evals/baseline/analyze.ts --check` exits 0: REPORT.md equals the regeneration from `evals/baseline/results/`. [R2] [dod arm 1]
  - 2. The results directory holds one record per build and one per arm run, each parsing under the harness's schemas; REPORT.md states both counts and names each build without a candidate, each pair with an arm missing and each run whose `boundFired` is a cap. [R1] [dod arm 1]
  - 3. REPORT.md has a table per axis with one row per task (arm A mean, arm B mean, difference) and the across-task mean, SD, 95% interval, permutation p-value and MDE, the end states by arm, and the count of candidates the oracle passed before either arm. [R2] [dod arm 1]
  - 4. REPORT.md has a section `Where aidlc loses` listing each axis whose mean difference favours arm A, or stating that there is none. [R3] [dod arm 1]
  - 5. REPORT.md names the pinned aidlc SHA, the task repository (`Asun28/MyInspection`), the `tasksDigest` the run records share, the model, the effort, the caps ($10 per run, $500 in total) and the count of arm A runs by `shipMode` and by `usageSource`, and states that arm B's review commands are outside the token and cost axes. [R4] [dod arm 1]
  - 6. `changelog.d/T1-BASELINE-REPORT.md` holds the entry under this card id followed by one line feed; `git diff --numstat origin/main...HEAD -- src` is empty. [R2]
  - 7. `.github/workflows/ci.yml` gains one job, `baseline-report`, on `ubuntu-latest`, with the checkout, setup-node and `npm ci` steps of the `bench` job followed by one step that runs `node evals/baseline/analyze.ts --check`; `git diff origin/main...HEAD -- .github/workflows/ci.yml` holds added lines only; the job is green on the card's pull request. [R5]
depends_on: [T1-BASELINE-HARNESS]
budget: 4500
tdd: false
forbid: [any change under src/, editing a build or run record by hand, dropping a build or a run from the results, a claim in REPORT.md not computed from the records, a change to an existing job of `.github/workflows/ci.yml`]
non_goals: [re-running a task to improve a result, a change to analyze.ts (a harness fix is a successor of T1-BASELINE-HARNESS), W5 measurements, a comparison with plain Claude Code, making `baseline-report` a required check (the ruleset `main required checks` and `github.requiredChecks` of aidlc.config.json are the owner's to change)]
hygiene: "Plan decisions D1-D3, decided again by the user on 2026-11-09 and amended on 2026-11-24 (task repository Asun28/MyInspection, private sandbox Asun28/aidlc-baseline-sandbox for the pull requests of both arms, $10 per run and $500 in total; arm A is Claude Ship and both arms start from one aidlc build). Data and generated text only: the analysis is tested in T1-BASELINE-HARNESS; this card commits the records and the regenerated report. The budget covers the result records, one per build and one per arm run. An arm A cost the operator stated when the run was closed is a field of its record, marked by usageSource, and not an edit by hand. tests/surface/ci-shard.test.ts pins the run steps of the `check` and `check-windows-shard` jobs whole, so the report check is a job of its own and no existing job gains a step; tests/surface/bench.test.ts reads the `bench` job only."
doc_sync: changelog.d/T1-BASELINE-REPORT.md
---

# T1-BASELINE-REPORT

Deferred on 2026-09-26 and released on 2026-11-09, when the user decided plan decisions D1-D3 again. It starts after T1-BASELINE-HARNESS merges and the operator has run the measurement pairs within the caps.

Amended on 2026-11-23, before any run, by the owner's decision in the session (`intent/auto-ontology-study.md`, Decisions, Q1). The changelog entry is the card's own file under `changelog.d/`. The report names the task-list digest the run records carry (R4, acceptance 5). A job of the `ci` workflow runs the check that is this card's DoD (R5, acceptance 7), so a report edited by hand, or run records changed without regenerating it, turns that job red. The job is not a required check, as `bench` is not.

Amended on 2026-11-24, before any run, by the owner's instruction in the session (the plan's amendment of that date). The report compares Claude Ship with aidlc's review and ship on the same aidlc-built candidates, not plain Claude Code with aidlc. The results hold a record per build beside the records per arm run (R1), the report gives the end states and the count of candidates that already passed the oracle (R2), and it says how Claude Ship was started and where arm A's cost came from (R4). The budget rises from 3000 to 4500 for the build records.

Deferred again on 2026-11-24 by the owner in the session, with T1-BASELINE-HARNESS: the owner has no Claude organization on a Team or Enterprise plan, which the Claude Ship agents need. The card stays registered as amended, for a later run, and does not run until the owner releases it.

## Deliverable
The first comparison of aidlc's review and ship stage against Claude Ship on the same aidlc-built candidates of real tasks, judged by an external oracle, reported as per-task paired differences with the smallest difference the design could detect, including every axis on which aidlc loses.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
node evals/baseline/analyze.ts --check
```
- Expected exit code: 0
- Assertion: REPORT.md equals the text regenerated from the committed run records.
