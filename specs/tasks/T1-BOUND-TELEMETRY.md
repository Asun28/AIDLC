---
id: T1-BOUND-TELEMETRY
title: Every bound in the Limits table journals BOUND_FIRED when it fires, and the board shows one line with each bound's firing count and the goal outcomes that followed
status: todo
branch: T1-BOUND-TELEMETRY
worktree: D:\wt\AIDLC\T1-BOUND-TELEMETRY
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/loop/controller.ts
  - src/state/board.ts
  - src/cli/main.ts
  - tests/infra/board.test.ts
  - tests/scenarios/deadline.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/t0-flow.test.ts
  - README.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-BOUND-TELEMETRY.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. WHEN a bound of the README Limits table fires, the loop shall journal one `BOUND_FIRED` event whose zod payload names the bound.
  - R2. The board shall render one `Bounds:` line giving, per fired bound, the firing count and the terminal outcome of the goal after each firing (`DONE`, `STOP/<reason>` or `open`).
  - R3. The change shall add no config key and no file under `.aidlc/`.
  - R4. The README Limits table shall state that the lifecycle repair bound is defined and not enforced.
acceptance:
  - 1. Each firing point journals exactly one `BOUND_FIRED` with its bound name: card deadline (including the two `stopWith` paths that journal nothing today), arc deadline, reconciliation grace, review decisions, no-verdict retry, CI rerun allowed and CI rerun denied, attempts (the STOP that journals nothing today), planning invocations and integration repair; a scenario per bound asserts the event (tests/scenarios/deadline.test.ts, tests/scenarios/review-block.test.ts, tests/scenarios/ci-rerun.test.ts, tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 2. A `BOUND_FIRED` event whose payload names no known bound fails to parse (tests/infra/board.test.ts). [R1] [dod arm 1]
  - 3. Over fixture journals of three goals, the board prints one line `Bounds: <bound> <n> (DONE a, STOP/<reason> b, open c); ...` in a fixed bound order, the outcome of a firing being the goal's first terminal event after it, and `Bounds: none fired` when there are none (tests/infra/board.test.ts). [R2] [dod arm 1]
  - 4. No config key is added (`ProjectConfig` keys unchanged) and no path under `.aidlc/` is written by the board beyond what it writes today (tests/infra/board.test.ts). [R3] [dod arm 1]
  - 5. The README Limits table row for repair cycles says the lifecycle repair bound is defined and not enforced; a test reads the exact row (tests/infra/board.test.ts). [R4] [dod arm 1]
  - 6. `git diff --numstat origin/main...HEAD -- src` is at most +50 net; the close-out states it and the W2+W4 running total against +400. [R1]
  - 7. `docs/OPERATIONS.md` names `BOUND_FIRED` and the board line; `CHANGELOG.md` Unreleased carries the entry under this card id; a test reads each exact sentence (tests/infra/board.test.ts). [R1] [R2] [dod arm 1]
depends_on: [T1-AUDIT-FACTS]
budget: 400
tdd: true
sweep: "Survey of main at 5983a1e. Limits constants types.ts:998-1007, MAX_BASELINE_ATTEMPTS effort.ts:14. Firing points: card 3h card-machine.ts:97-103 via card-runner.ts:553-554 (CARD_STATE), card-runner.ts:2336-2337 and 2364-2365 (stopWith, no event); arc 12h controller.ts:209-212 (GOAL_STOPPED time); grace controller.ts:200-203, card-machine.ts:59-68; review decisions review-policy.ts:198-202, card-runner.ts:2262-2264; no-verdict retry review-policy.ts:193-195, card-runner.ts:2283-2286; CI rerun ci-policy.ts:187-204, card-runner.ts:2303-2323 (CI_RERUN only when allowed); attempts effort.ts:81-101, STOP card-runner.ts:803-806 (no event); planning controller.ts:252-256; integration repair controller.ts:514-516, arc.ts:191; lifecycle repair MAX_LIFECYCLE_REPAIR_CYCLES never read, counter types.ts:797 never incremented; workers arc.ts:140-148 is a cap, not a firing. Board: renderBoard board.ts:46-86, hardcoded denominators."
forbid: [a new config key, a new file under .aidlc/, a counter kept outside the journal, a change to any bound's value]
non_goals: [enforcing the lifecycle repair bound, counting the worker cap, a per-bound history view, tuning any default]
hygiene: "Lesson 2026-09-18 T1-REVIEW-STATS: derive the count from the event the loop persists at the firing, never from a counter kept for enforcement."
doc_sync: README.md (Limits), docs/OPERATIONS.md (board), CHANGELOG.md
---

# T1-BOUND-TELEMETRY

## Deliverable
Each bound that fires leaves one `BOUND_FIRED` event in the journal, and `aidlc board` shows, in one line, how often each bound fired and how the goals ended afterwards, so the defaults in the Limits table can be judged from data.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run check
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test passes, with the pass count in the receipt.
