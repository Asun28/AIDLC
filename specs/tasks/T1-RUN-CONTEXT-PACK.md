---
id: T1-RUN-CONTEXT-PACK
title: Deterministic bounded context pack on run-card directives
status: todo
superseded_by: T1-RUN-CONTEXT-PACK-2
branch: T1-RUN-CONTEXT-PACK
worktree: D:\wt\AIDLC\T1-RUN-CONTEXT-PACK
plan_ref: docs/plans/PLAN-v5.1-hardening.md#context-pack-split
allow_paths:
  - src/loop/context-pack.ts
  - src/loop/controller.ts
  - tests/core/context-pack.test.ts
  - tests/scenarios/context-pack.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - docs/plans/PLAN-v5.1-hardening.md
  - specs/tasks/T1-RUN-CONTEXT-PACK.md
  - specs/tasks/T1-RUN-DRIVER.md
dod_command: npm run typecheck && node --test tests/core/context-pack.test.ts tests/scenarios/context-pack.test.ts
dod_exit: 0
requirements:
  - R1. Each run-card directive shall carry context.pack with deterministic JSON text containing plan reference and section, complete acceptance, allow_paths, non_goals and relevant lessons.
  - R2. A declared 8192 token budget shall use UTF-8 byte length as a conservative token upper bound, remove whole lessons from the end first, then trim plan text; mandatory fields and acceptance shall never be cut and an oversized mandatory core shall be refused explicitly.
  - R3. Lessons shall match literal allowed paths or their src module names or supplied routing modules at word/path boundaries; only explicit directory allow_paths may match descendants. Input order shall be retained. Repository text shall remain JSON data. Missing sources shall be explicit. Plan files and resolved plan targets shall be Markdown under configured plansDir or docs/plans; LESSONS shall resolve to docs/LESSONS.md itself; no read outside the repository.
acceptance:
  - 1. Pure projection tests verify byte-identical repeat output, each named field, complete acceptance and only matching lessons, including boundary false positives and instruction-shaped text. [R1] [R3]
  - 2. Budget tests verify lesson tail removal before plan trimming, UTF-8 byte accounting, complete acceptance, rejection of an invalid budget or oversized mandatory core, and output no larger than the declared budget. [R2]
  - 3. Controller scenario tests read a real plan section and lessons file and verify context.pack on run-card; missing sources are explicit and a reference outside the repository is refused. [R1] [R3]
  - 4. Existing scenario tests and npm run check pass. Operations documents the payload and budget; CHANGELOG names this card. Source delta is recorded as part of W5 against the shared +650 envelope. [R1] [R2]
depends_on: []
budget: 650
tdd: true
sweep: "Split from T1-RUN-DRIVER R3 under user delegation and permission for multiple PRs. Controller nextInRun already constructs context as a record. No persisted schema changes are needed. Card plan_ref, acceptance, allow_paths and non_goals exist in core/types.ts. Keep the run loop and watch view on the original card."
forbid: [new persisted state, changing card selection, changing review or authorization gates, executing repository text]
non_goals: [aidlc run, board watch, provider dispatch, telemetry, exact model-specific tokenization]
hygiene: "User continued on 2026-10-04 with all decisions delegated. This independent portion can ship while telemetry remains owned by another session. Source cost remains charged to W5; no budget exemption."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-RUN-CONTEXT-PACK

Deliver the context-pack portion of T1-RUN-DRIVER independently, keeping its remaining runtime and watch work gated on telemetry.

2026-10-04 authorized review repair: verify the opened file's path and read the same handle on the Windows/Linux CI platforms; refuse other platforms or unavailable handle validation. Reproduce a parent-directory swap after resolution for both plans and lessons. This closes formal-review F1 without a path-read fallback.
