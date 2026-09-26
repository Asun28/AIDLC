---
id: T1-RUN-DRIVER
title: aidlc run drives a goal through next, provider dispatch and report until a directive needs a human, aidlc board --watch shows goal, cards, leases, bounds and the next directive on one screen, and run-card carries a deterministic per-card context pack measured against the baseline
status: todo
branch: T1-RUN-DRIVER
worktree: D:\wt\AIDLC\T1-RUN-DRIVER
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/loop/run-driver.ts
  - src/loop/context-pack.ts
  - src/loop/controller.ts
  - src/loop/directive.ts
  - src/state/board.ts
  - src/cli/main.ts
  - tests/scenarios/run-driver.test.ts
  - tests/core/context-pack.test.ts
  - tests/infra/board.test.ts
  - evals/baseline/REPORT.md
  - evals/baseline/results/
  - docs/OPERATIONS.md
  - README.md
  - CHANGELOG.md
  - specs/tasks/T1-RUN-DRIVER.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. `aidlc run --goal <id>` shall loop `next`, provider dispatch and `report` until a directive of kind `checkpoint`, `stop`, `ask`, `release` or `done`, a review block or a `wait` on review quota, print that directive and exit, writing no file of its own.
  - R2. `aidlc board --watch` shall re-render one screen with the goal state, the card states, the live leases with owner and generation, the bound line and the next directive until interrupted, persisting no transition.
  - R3. The `run-card` directive shall carry a context pack projected deterministically from the card's plan section, acceptance list, allow_paths, non_goals and the LESSONS lines that name its paths or modules, capped at a declared token budget.
  - R4. The src/ net of this card plus T1-AUDIT-FACTS and T1-BOUND-TELEMETRY shall be at most +400 lines, tests excluded.
  - R5. The tokens per card with the context pack shall be measured on the baseline task set and reported against the arm B baseline in REPORT.md.
acceptance:
  - 1. With a scripted provider, `aidlc run` performs `plan`, `project-cards`, `run-card` and `close` directives in sequence and exits on each of `checkpoint`, `stop`, `ask`, `release`, `done`, a review block and a review-quota `wait`, printing that directive; a `wait` on any other signal is not an exit; the driver writes no file itself (a test compares the state directory with what the CLI commands alone write) (tests/scenarios/run-driver.test.ts). [R1] [dod arm 1]
  - 2. `aidlc run` stops at `--max-steps` and at the goal deadline, whichever comes first (tests/scenarios/run-driver.test.ts). [R1] [dod arm 1]
  - 3. `renderWatch` over a fixture state returns one screen naming goal state, each card state, each live lease with owner session and generation, the `Bounds:` line and the next directive; two renders of one state are identical, and a watch tick writes nothing under `.aidlc/` (tests/infra/board.test.ts). [R2] [dod arm 1]
  - 4. `contextPack` returns the same bytes for the same inputs, includes each named part, keeps LESSONS lines that name the card's paths or modules and no other, and cuts at the declared budget from the LESSONS end first, never cutting the acceptance list (tests/core/context-pack.test.ts). [R3] [dod arm 1]
  - 5. `git diff --numstat origin/main...HEAD -- src` plus the recorded W2 and W4 deltas is at most +400; the close-out states the three and the total. [R4]
  - 6. REPORT.md gains a section with arm B tokens per card with the context pack on the 12 baseline tasks, one run each, against the baseline arm B mean, per task; `analyze.ts --check` still exits 0. [R5]
  - 7. `docs/OPERATIONS.md` documents `aidlc run`, `board --watch` and the context pack, and states how `aidlc run` relates to the `/goal` recipe of T0-UNATTENDED-RUNS; `CHANGELOG.md` Unreleased carries the entry under this card id; a test reads each exact sentence (tests/scenarios/run-driver.test.ts). [R1] [R2] [R3] [dod arm 1]
depends_on: [T1-BASELINE-REPORT, T1-BOUND-TELEMETRY]
budget: 900
tdd: true
sweep: "Survey of main at 5983a1e. No command loops next, act and report: next (main.ts:334-342) and report (344-376) are single-shot; the only loop is the CI poll in github-ship.ts:245. Providers (providers/types.ts:25-40) return CompletionResult with optional usage; claude-api.ts:90-93 and claude-code.ts:63 fill it; the loop never calls a provider (evals main.ts:933 and doctor 185 only). aidlc board has no watch mode; renderBoard board.ts:46-86. The run-card context (controller.ts:360) carries revision, generation, reviewPool, modules, dataImpact, wave, workers and arcReasons. T0-UNATTENDED-RUNS (merged, PR #61) documents /goal as the outer driver and names the directive kinds done, stop, ask, checkpoint and wait."
forbid: [state owned by the driver, a model deciding which card runs next, approving a checkpoint, merging, or reporting a done, stop, ask, checkpoint or wait directive from the driver, a web view, a new top-level src/ directory]
non_goals: [cloud or remote execution, running several goals at once, a TUI library, changing the directive contract beyond carrying the context pack]
hygiene: "Projected in wave 4 after REPORT.md exists; amend this card in place before it starts if the report changes the design (an unstarted card takes a formal amendment). If the three parts do not fit the remaining budget, stop and ask which part to drop."
doc_sync: docs/OPERATIONS.md (Running a goal), README.md (Quick start), CHANGELOG.md
---

# T1-RUN-DRIVER

## Deliverable
A goal can be stated and left to run until it needs a person, through a thin driver over the controller and the providers; one screen shows where it stands; and each worker starts from a bounded, deterministic context pack instead of re-reading the repository, with the token effect measured against the baseline.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.
