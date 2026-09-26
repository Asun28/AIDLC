---
id: T1-BASELINE-REPORT
title: evals/baseline/REPORT.md, generated from the committed run records, gives per-task paired differences between plain Claude Code and aidlc on resolution, tokens, wall clock and interventions, the bounds that fired, the minimum detectable difference, and every axis on which aidlc loses
status: todo
branch: T1-BASELINE-REPORT
worktree: D:\wt\AIDLC\T1-BASELINE-REPORT
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - evals/baseline/results/
  - evals/baseline/REPORT.md
  - CHANGELOG.md
  - specs/tasks/T1-BASELINE-REPORT.md
dod_command: node evals/baseline/analyze.ts --check
dod_exit: 0
requirements:
  - R1. `evals/baseline/results/` shall hold one record per run, 72 or the number the spend cap allowed, and REPORT.md shall state the count and name every run stopped by a cap.
  - R2. REPORT.md shall be the text `analyze.ts` generates from those records, with per-task paired differences for resolved, tokens, cost, wall clock and interventions, the bounds that fired, and the minimum detectable difference per axis.
  - R3. REPORT.md shall state in plain words every axis on which aidlc does worse than plain Claude Code.
  - R4. REPORT.md shall name the pinned aidlc SHA, the task repository, the model, the effort and the caps.
acceptance:
  - 1. `node evals/baseline/analyze.ts --check` exits 0: REPORT.md equals the regeneration from `evals/baseline/results/`. [R2] [dod arm 1]
  - 2. The results directory holds one record per run that parses under the harness's run schema; REPORT.md states the record count and names each run whose `boundFired` is a cap. [R1] [dod arm 1]
  - 3. REPORT.md has a table per axis with one row per task (arm A mean, arm B mean, difference) and the across-task mean, SD, 95% interval, permutation p-value and MDE. [R2] [dod arm 1]
  - 4. REPORT.md has a section `Where aidlc loses` listing each axis whose mean difference favours arm A, or stating that there is none. [R3] [dod arm 1]
  - 5. REPORT.md names the pinned aidlc SHA, the task repository, the model, the effort and the per-run and total caps. [R4] [dod arm 1]
  - 6. `CHANGELOG.md` Unreleased carries the entry under this card id; `git diff --numstat origin/main...HEAD -- src` is empty. [R2]
depends_on: [T1-BASELINE-HARNESS]
budget: 3000
tdd: false
forbid: [any change under src/, editing a run record by hand, dropping a run from the results, a claim in REPORT.md not computed from the records]
non_goals: [re-running a task to improve a result, a change to analyze.ts (a harness fix is a successor of T1-BASELINE-HARNESS), W5 measurements]
hygiene: "Data and generated text only: the analysis is tested in T1-BASELINE-HARNESS; this card commits the records and the regenerated report. The budget covers the result records."
doc_sync: CHANGELOG.md
---

# T1-BASELINE-REPORT

## Deliverable
The first comparison of aidlc against plain Claude Code on real tasks, judged by an external oracle, reported as per-task paired differences with the smallest difference the design could detect, including every axis on which aidlc loses.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
node evals/baseline/analyze.ts --check
```
- Expected exit code: 0
- Assertion: REPORT.md equals the text regenerated from the committed run records.
