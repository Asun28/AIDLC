---
id: T1-SWEEP-DEAD-CODE
title: Remove the unread lifecycle constant, the unread cardPolicy field, the target-less targetSelection config value, the uncalled resetRepoIdentityCache, the obsolete code-unchanged script and the two duplicate plan copies
status: todo
branch: T1-SWEEP-DEAD-CODE
worktree: D:\wt\AIDLC\T1-SWEEP-DEAD-CODE
plan_ref: plans/dead-code-sweep.md#order-of-work
allow_paths:
  - src/core/types.ts
  - src/config.ts
  - src/delivery/ops.ts
  - src/state/paths.ts
  - src/state/board.ts
  - README.md
  - scripts/code-unchanged.mjs
  - docs/plans/PLAN-aidlc-loop-v5.md
  - docs/plans/PLAN-aidlc-loop-v4.md
  - tests/infra/board.test.ts
  - tests/surface/removed-surface.test.ts
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP-DEAD-CODE.md
dod_command: npm run typecheck && node --test tests/surface/removed-surface.test.ts tests/infra/board.test.ts tests/infra/ops.test.ts tests/surface/config.test.ts tests/surface/readme.test.ts
dod_exit: 0
requirements:
  - R1. `src/core/types.ts` shall not define `MAX_LIFECYCLE_REPAIR_CYCLES`, which nothing reads; the README Limits table shall list integration repair (1, `src/core/arc.ts`, `src/loop/controller.ts`) and lifecycle repair (1, stated in the release-health stop directive and not enforced in code, `src/loop/controller.ts`) as separate rows; the board's Counters line shall end at `integration-repair=<n>/1` with no `lifecycle-repair` item. The persisted `counters.lifecycleRepairCycles` field stays.
  - R2. `ProjectConfig` (`src/config.ts`) shall have no `cardPolicy` field, which nothing reads; a config that still carries `cardPolicy` parses, and the parsed value has no `cardPolicy` key.
  - R3. IF an ops binding carries `targetSelection: 'config'`, which no code branch handles (the command ran with no target), THEN `OperationBinding` parsing shall fail; `arg`, `env` and `none` parse as before.
  - R4. `src/state/paths.ts` shall not define `resetRepoIdentityCache`, which nothing has called since it was added in 139d02b.
  - R5. `scripts/code-unchanged.mjs` (written for the merged card T0-BASE-SYNC-JSDOC only), `docs/plans/PLAN-aidlc-loop-v5.md` (byte-identical to `PLAN-aidlc-loop.md`) and `docs/plans/PLAN-aidlc-loop-v4.md` (byte-identical to `PLAN-aidlc-loop-v4-archive.md`) shall be deleted; `docs/migration/file-transfer-manifest.json` stays as the record of the transfer.
  - R6. The CHANGELOG Unreleased section shall carry an entry naming this card, the two removed library exports, the dropped config field, the refused enum value and the deleted files.
acceptance:
  - 1. `tests/surface/removed-surface.test.ts`: the library entry (`src/index.ts`) exports neither `MAX_LIFECYCLE_REPAIR_CYCLES` nor `resetRepoIdentityCache`, and still exports `MAX_INTEGRATION_REPAIR_CYCLES`. [R1] [R4] [dod arm 2]
  - 2. `tests/infra/board.test.ts`: the Counters line of a fresh goal is `planning=0/2 integration-repair=0/1` and the board has no `lifecycle-repair` text. [R1] [dod arm 3]
  - 3. `tests/surface/removed-surface.test.ts`: the README Limits table has an integration repair row and a lifecycle repair row, the second saying `not enforced in code`; no row says `Integration / lifecycle`. [R1] [dod arm 2]
  - 4. The same file: `ProjectConfig.parse({ cardPolicy: 'advisory' })` succeeds and has no `cardPolicy` key. [R2] [dod arm 2]
  - 5. The same file: `OperationBinding.parse` of a deploy binding with `targetSelection: 'config'` throws; with `arg`, `env` and `none` it parses. [R3] [dod arm 2]
  - 6. The same file: the three R5 files do not exist and `docs/migration/file-transfer-manifest.json` does. [R5] [dod arm 2]
  - 7. The same file reads a T1-SWEEP-DEAD-CODE entry in the CHANGELOG Unreleased section naming `MAX_LIFECYCLE_REPAIR_CYCLES`, `resetRepoIdentityCache`, `cardPolicy` and `targetSelection`. [R6] [dod arm 2]
  - 8. `tests/infra/ops.test.ts`, `tests/surface/config.test.ts` and `tests/surface/readme.test.ts` pass unchanged. [R2] [R3] [dod arms 4, 5, 6]
depends_on: []
budget: 1100
tdd: true
sweep: "Reference scan of every export in src/ with the TypeScript language service (main at df9acd7): MAX_LIFECYCLE_REPAIR_CYCLES and resetRepoIdentityCache have no reference in src/ or tests/. grep -rn cardPolicy src tests templates aidlc.config.json docs: only src/config.ts:128. grep -rn targetSelection src tests docs templates: the branches at src/delivery/ops.ts:117 (arg) and :120 (env), none for config; tests and docs use arg only. grep -rn lifecycle-repair tests src: src/state/board.ts:60 and its pin at tests/infra/board.test.ts:43. grep -rn code-unchanged (outside .aidlc): the script and specs/tasks/T0-BASE-SYNC-JSDOC.md (status merged). cmp of the plan pairs: identical; the only references to the two copies are in the migration manifest."
forbid: [removing the persisted lifecycleRepairCycles field, enforcing the lifecycle bound, editing the migration manifest, editing a surviving plan file]
non_goals: ["enforcing the lifecycle repair bound (user ruling 2026-10-12)", "the LEGACY_LINE CI parser", "removing export keywords or z.infer type aliases"]
hygiene: "Budget 1100: about 940 lines are the three deleted files (539 + 358 + 39); the code and test change is about 150."
doc_sync: README.md, CHANGELOG.md
---

# T1-SWEEP-DEAD-CODE

## Deliverable
The code, config and docs stop carrying things nothing uses: a limit constant nobody reads (and the README and board claims built on it), a config field nobody reads, an ops enum value that silently dropped the target, an uncalled function, a one-card script and two duplicate plan copies.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/removed-surface.test.ts tests/infra/board.test.ts tests/infra/ops.test.ts tests/surface/config.test.ts tests/surface/readme.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
