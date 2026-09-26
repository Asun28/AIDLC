---
id: T1-BASELINE-HARNESS
title: A paired baseline harness outside src/ that runs 12 real tasks under plain Claude Code and under aidlc, records oracle result, tokens, wall clock, interventions and fired bounds, and computes paired differences with the minimum detectable difference
status: todo
branch: T1-BASELINE-HARNESS
worktree: D:\wt\AIDLC\T1-BASELINE-HARNESS
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - evals/baseline/
  - tsconfig.test.json
  - tests/surface/baseline.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-BASELINE-HARNESS.md
dod_command: npm run typecheck && node --test tests/surface/baseline.test.ts
dod_exit: 0
requirements:
  - R1. The harness shall prepare every trial in a fresh checkout at the task's base SHA with no later commit reachable, and give both arms the same model, effort, turn cap, wall-clock cap and task text.
  - R2. The harness shall record per run the oracle result, the input and output tokens and cost from the provider's usage, the wall clock, the count of directives or stops that needed a human, and the bound that fired.
  - R3. The analysis shall report per task and per axis the paired difference (arm B mean minus arm A mean over the runs), and across tasks the mean, SD, a 95% interval, a sign-flip permutation p-value and the minimum detectable difference at alpha 0.05 and power 0.8.
  - R4. The task list shall hold 12 real tasks taken in reverse merge order by the selection rule written in `evals/baseline/README.md`, with no task skipped except by that rule.
  - R5. WHEN a run reaches its token or wall-clock cap, the harness shall stop it and record the cap as the bound that fired.
acceptance:
  - 1. `analyze.ts` on a fixture of 12 tasks x 2 arms x 3 runs returns the per-task differences computed by hand, the MDE as 0.888 x SD of the paired differences ((2.201 + 0.876) / sqrt(12)), and the same permutation p-value on two calls with one seed (tests/surface/baseline.test.ts). [R3] [dod arm 1]
  - 2. The prepare step, driven by a scripted runner, checks out the base SHA with `git rev-list --count HEAD` equal to 1; for arm A it removes the target's `.claude/` hooks and aidlc sections and writes exactly one Stop hook that runs the repository's check command; for arm B it runs `aidlc init --ship-path github` from the pinned aidlc SHA with the sandbox repository as remote (tests/surface/baseline.test.ts). [R1] [dod arm 1]
  - 3. The run record has a zod schema requiring `resolved`, `usage` (input, output, cost), `wallClockMs`, `interventions` and `boundFired` (null when none); a record missing any one fails to parse (tests/surface/baseline.test.ts). [R2] [dod arm 1]
  - 4. A scripted run whose usage passes the per-run token cap is stopped and recorded with `boundFired: "token-cap"`, and one that passes the wall-clock cap with `"wall-clock-cap"` (tests/surface/baseline.test.ts). [R5] [dod arm 1]
  - 5. `evals/baseline/tasks.json` holds 12 tasks with unique ids, each naming repository, base SHA, PR number, task text, hidden oracle files and oracle command; `evals/baseline/README.md` states the selection rule, the per-run and total caps (plan decision D3) and how to run a trial; a test reads both and fails with a task or a field removed (tests/surface/baseline.test.ts). [R4] [dod arm 1]
  - 6. `analyze.ts --check` exits 0 when `evals/baseline/REPORT.md` equals the text it regenerates from `evals/baseline/results/`, and 1 otherwise, on fixture directories (tests/surface/baseline.test.ts). [R3] [dod arm 1]
  - 7. A pilot of one task, one run per arm, completes end to end; both run records are retained with `aidlc evidence retain` and named in the close-out. [R1] [R2]
  - 8. `git diff --numstat origin/main...HEAD -- src` is empty, and `CHANGELOG.md` Unreleased carries the entry under this card id; a test reads the entry (tests/surface/baseline.test.ts). [R1] [dod arm 1]
depends_on: []
budget: 900
tdd: true
forbid: [any change under src/, choosing or dropping a task after seeing a result of either arm, network access from a test, a PR opened on any repository other than the sandbox of plan decision D2]
non_goals: [the 72 measurement runs (an operator step between this card and T1-BASELINE-REPORT), REPORT.md, a change to src/evals/runner.ts, a new CLI command]
hygiene: "Deferred on 2026-09-26 by the user (no eval now): the card stays registered and does not start until plan decisions D1-D3 (task repository, sandbox repository, spend caps) are decided again. Reuses src/ exports only: ClaudeCodeProvider for the model call and its usage, the evals runner's command check for the oracle. Run the mutation sweep over analyze.ts before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: CHANGELOG.md
---

# T1-BASELINE-HARNESS

Deferred on 2026-09-26: do not start or ship this card. The user deferred the W0 evaluation; it waits for plan decisions D1-D3 (task repository, sandbox repository, spend caps) to be decided again.

## Deliverable
`evals/baseline/` holds a task list of 12 real tasks, a harness that runs one trial per arm in a fresh checkout and records oracle result, tokens, cost, wall clock, human interventions and the bound that fired, and an analysis that reports per-task paired differences and the minimum detectable difference. A one-task pilot proves the harness end to end. src/ is unchanged.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/baseline.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
