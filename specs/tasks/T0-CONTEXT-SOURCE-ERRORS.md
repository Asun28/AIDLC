---
id: T0-CONTEXT-SOURCE-ERRORS
title: Distinguish unavailable handle validation from missing context sources
status: todo
superseded_by: T1-RUN-CONTEXT-PACK-2
branch: T0-CONTEXT-SOURCE-ERRORS
worktree: D:\wt\AIDLC\T0-CONTEXT-SOURCE-ERRORS
plan_ref: docs/plans/PLAN-v5.1-hardening.md#context-pack-split
allow_paths:
  - src/loop/context-pack.ts
  - tests/scenarios/context-pack.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CONTEXT-SOURCE-ERRORS.md
  - specs/tasks/T1-RUN-CONTEXT-PACK.md
  - docs/plans/PLAN-v5.1-hardening.md
dod_command: npm run check
dod_exit: 0
requirements:
  - R1. Only an ENOENT from resolving the requested source shall be classified as missing; a failure of opened-handle verification shall refuse loading.
  - R2. Windows shall report a native path mismatch distinctly from helper failure without exposing helper stdout or source text in diagnostics; the parent-swap regression shall assert that specific mismatch.
acceptance:
  - 1. An existing plan with unavailable Linux handle-path lookup throws instead of becoming missingSources; the regression fails before the repair. [R1]
  - 2. Both plan and lesson parent-directory swaps produce a path-mismatch error on Windows and Linux; ordinary reads still pass and helper failure retains a safe diagnostic classification. [R2]
  - 3. npm run check and npm run build pass; OPERATIONS and CHANGELOG describe the error semantics; the combined context-pack source delta is retained under the W5 budget. [R1] [R2]
depends_on: []
budget: 250
tdd: true
diagnosis: "R2 and R3 on 2ff6099 passed the opened-handle security repair but identified an ENOENT catch covering both requested-source resolution and Linux fd lookup. Windows currently collapses native mismatch and all helper failures into one message. These are mandatory follow-up corrections within the user's multi-PR completion request, not deferred optional work."
sweep: "Implement only after T1-RUN-CONTEXT-PACK has a verified feature merge on main. Use a separate worktree based on that merged remote main; do not carry other sessions' local planning commits."
forbid: [unchecked path reads, weakening tests, review counter resets, changes to review or authorization gates]
non_goals: [new context fields, macOS support, other driver work]
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

Mandatory completion work from T1-RUN-CONTEXT-PACK formal review r3.3.e64202fa under the user's 2026-10-04 continue-unblock and multiple-PR authorization. Keep the first card's complete review history and receipts; this card reviews only the new error-reporting correction after the already-passed security repair merges.
