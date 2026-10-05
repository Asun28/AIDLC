---
id: T1-BOUND-TELEMETRY-6
title: Validate and integrate the retained bound telemetry repair
status: todo
branch: T1-BOUND-TELEMETRY-6
worktree: D:\wt\AIDLC\T1-BOUND-TELEMETRY-6
plan_ref: docs/plans/PLAN-v5.1-hardening.md#45-module-design
allow_paths:
  - src/core/types.ts
  - src/loop/card-runner.ts
  - src/loop/controller.ts
  - src/review/stats.ts
  - src/audit/verifier.ts
  - src/state/board.ts
  - src/state/journal.ts
  - src/state/store.ts
  - src/state/goal-store.ts
  - src/cli/main.ts
  - tests/infra/board.test.ts
  - tests/infra/journal.test.ts
  - tests/infra/journal-process.test.ts
  - tests/infra/goal-store.test.ts
  - tests/scenarios/deadline.test.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/r2-fallback.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/two-windows.test.ts
  - tests/scenarios/extend-running-card.test.ts
  - tests/scenarios/audit.test.ts
  - tests/scenarios/run-driver.test.ts
  - tests/surface/verifier.test.ts
  - tests/surface/stats.test.ts
  - README.md
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-BOUND-TELEMETRY-2.md
  - specs/tasks/T1-BOUND-TELEMETRY-3.md
  - specs/tasks/T1-BOUND-TELEMETRY-4.md
  - specs/tasks/T1-BOUND-TELEMETRY-5.md
  - specs/tasks/T1-BOUND-TELEMETRY-6.md
  - docs/plans/PLAN-v5.1-hardening.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. Preserve every requirement and acceptance item 1–64 of the immutable predecessor T1-BOUND-TELEMETRY-5 at commit 3f426fe, including all older linked-card requirements, tests and evidence.
  - R2. Preserve the four counted failures and all R2/R3 decisions, while this linked episode permits one full-validation attempt and only the remaining final R3 decision.
  - R3. Integrate the verified remote base without dropping run-driver admission or any telemetry recovery invariant; keep all changed paths and shared budgets in scope.
  - R4. Ship and close only after exact-candidate DoD, build, R2, final R3, CI and verified merge; evidence-generation retention is a separate reviewed card.
acceptance:
  - 1. Read `git show 3f426fe:specs/tasks/T1-BOUND-TELEMETRY-5.md`; its acceptance 1–64 and every exact behavioral test mapping remain mandatory and green, with no bound value, firing key, journal recovery, goal/card lock, review or audit behavior weakened (all predecessor test paths). [R1] [dod arm 1]
  - 2. The repaired second ship block saves STOP, firing and complete notes atomically, and retained formal and ship results retain issue generation, original operation settlement and queue sequence (tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 3. Locked R2, R3 and ship admissions refuse late STOP, resume and outbox recovery before external work; deferred attempt audit, review statistics and malformed-terminal Bounds retain their regression outcomes (tests/scenarios/t0-flow.test.ts, tests/scenarios/review-block.test.ts, tests/surface/verifier.test.ts, tests/surface/stats.test.ts, tests/infra/board.test.ts). [R1] [dod arm 1]
  - 4. The original acceptance-15 test still completes its valid concurrent formal result exactly once, with the issuing generation in its envelope and no unhandled rejection (tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 5. `npm run check` and `npm run build` pass on the exact integrated candidate; independent mutation and scope checks bind their file hashes to it. Failed predecessor checks remain separate receipts (tests/scenarios/t0-flow.test.ts). [R2] [R3] [dod arm 1]
  - 6. The merged base's `allowShip` driver boundary remains intact; ordinary operator shipping uses the existing locked telemetry admission (tests/scenarios/run-driver.test.ts, tests/scenarios/review-block.test.ts). [R3] [dod arm 1]
  - 7. Measured diff against verified remote main stays within 6500 total changed lines, +1100 net source and shared W2+W4+W5 +1350; no unrelated or foreign-session paths enter the feature PR (git diff, scoped precheck). [R3] [dod arm 1]
  - 8. The one remaining R3 Codex decision and normal R2 DeepSeek v4 Pro pass before reviewed feature PR, CI and verified merge; separately reviewed evidence retention and metadata closure complete the goal (review and ship receipts). [R2] [R4] [dod arm 1]
depends_on: [T1-AUDIT-FACTS-2]
budget: 6500
tdd: true
sweep: "R3 F3–F10 were repaired in clean predecessor commit 3f426fe with independent RED, focused GREEN and semantic mutation evidence. This successor changes only integration or a diagnosed final-check regression; rerun exact tests, mutation guards and full DoD before its sole success receipt."
forbid: [a new config key, a new persistent state file under .aidlc/, a counter kept outside the journal, a change to any bound's value, a bound stop that waits on the journal, a firing key read from the clock, a raw card report patch of loop-owned recovery fields, a reset of any prior attempt or review counter]
non_goals: [altering the run-driver design, revising unrelated cards, adding a new R3 cycle, changing bound values, silently extending the deadline]
hygiene: "User approval 2026-10-05T08:28:01Z: carry unverified commit 3f426fe and all -5 STOP/failure/review evidence; exactly one new full-validation attempt and one final R3 decision. The supported goal extension ends 2026-10-05T11:28:01Z. Merge-only integrate remote main, preserve the run-driver, then validate exact SHA within 6500/+1100/shared1350. PR #140 remains draft until replacement integration."
doc_sync: README.md (Limits), docs/OPERATIONS.md (Bound telemetry), docs/ARCHITECTURE.md (pendingFiring and locks), CHANGELOG.md
---

# T1-BOUND-TELEMETRY-6

This compact card inherits the full, unmodified predecessor [T1-BOUND-TELEMETRY-5](T1-BOUND-TELEMETRY-5.md) contract and its test mappings. The previous card exceeded the context-pack mandatory byte limit; copying it here would prevent the supported goal from dispatching the successor. The old card, verdicts and attempt ledger remain intact. The sole permitted new attempt validates the retained repair against the now-integrated remote base. One final R3 decision remains, with no counter reset or extra review cycle. Evidence-generation retention and closure use separate reviewed cards only after a verified feature merge.
