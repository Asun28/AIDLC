---
slug: dead-code-sweep
title: Remove the dead code, obsolete flags and wrong command lines the 2026-10-12 unused-code audit found
intent: intent/dead-code-sweep.md
status: accepted
created: 2026-10-11T21:54:00Z
skills_applied: []
---

# Spec: Remove the dead code, obsolete flags and wrong command lines the 2026-10-12 audit found
From intent: intent/dead-code-sweep.md. Status: accepted. Skills applied: (none).

## Requirements (EARS)
- R1. IF `runHook` receives a name that is not one of the six guard names, THEN the hook entry shall return exit code 2 with a stderr line naming the JSON-quoted name and the known names, before it reads the hook config.
- R2. The agent-evals workflow and its template shall run `aidlc evals run` with `--provider claude-code` and set no `AIDLC_PROVIDER`.
- R3. The shipped `aidlc release start` and card-loop command lines and the env var paragraphs of CLAUDE.md and docs/OPERATIONS.md shall name only options the CLI declares and variables the code reads or sets.
- R4. The library and its docs shall present the lifecycle repair bound as directive text that no code enforces, with no `MAX_LIFECYCLE_REPAIR_CYCLES` export and no lifecycle item on the board.
- R5. IF an ops binding carries `targetSelection: 'config'`, THEN the ops config parser shall refuse it.
- R6. The repository shall carry neither `resetRepoIdentityCache` nor `scripts/code-unchanged.mjs`, `docs/plans/PLAN-aidlc-loop-v5.md` or `docs/plans/PLAN-aidlc-loop-v4.md`.
- R7. The module `src/review/pre-review.ts` shall export none of `runPreReview`, `buildPreReviewPrompt`, `extractVerdict` or `RunPreReviewOptions`, whose test callers use a test helper with the same composition.
- R8. The typecheck and the build shall refuse an unused local, import or parameter (`noUnusedLocals`, `noUnusedParameters`).
- R9. The `ProjectConfig` schema shall have no `cardPolicy` field.

## Design
R1: a guard at the top of `runHook` (`src/hooks/index.ts:669`) before the
config load; the known names become one exported list. R2, R3: text in the
workflows, CLAUDE.md, the template section, the release and card-loop
modules, the release-specialist agent and OPERATIONS. R4: delete the
constant (`src/core/types.ts:1023`) and the board fragment
(`src/state/board.ts:60`); the persisted counter stays. R5: delete the
field (`src/config.ts:128`) and the enum value (`src/delivery/ops.ts:26`).
R6: delete the function (`src/state/paths.ts:72`) and the three files. R7:
move the three wrappers into `tests/surface/_review-once.ts` under the same
names, so the test call sites keep their text and only imports change. R8:
two compiler options in `tsconfig.json` (inherited by `tsconfig.test.json`),
`markLost` loses its unread `now`, and the unused test locals go.

## Interfaces and contracts
- Library exports removed: `MAX_LIFECYCLE_REPAIR_CYCLES`,
  `resetRepoIdentityCache`. `ProjectConfig` loses `cardPolicy` (an existing
  key is dropped, not refused). `OperationBinding.targetSelection` loses
  `config` (refused). `ReviewQueue.markLost(key, detail)`.
- `aidlc hook <unknown>` exits 2 instead of 0.

## Data model and migration impact
None. The persisted goal field `counters.lifecycleRepairCycles` stays, so
goal records written before still parse.

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- Enforcing the lifecycle repair bound (user ruling of 2026-10-12).
- Removing the `LEGACY_LINE` CI parser: the scaffold ship path runs a
  target repository's own `task.ps1`, whose output this repository cannot
  see.
- Removing the `export` keyword from symbols used only in their own module,
  or the unused `z.infer` type aliases of used schemas (public types).
- A generic checker of every command line in the docs.
- Editing `docs/migration/file-transfer-manifest.json`, the record of a past
  transfer.

## Acceptance
- 1. An unknown hook name exits 2 with the known names on stderr; known names behave as before. [R1]
- 2. The eval workflow runs on the claude-code provider. [R2]
- 3. No shipped command line names an undeclared option; the env var docs match the code. [R3]
- 4. The lifecycle bound is stated as not enforced; the constant and the board fragment are gone. [R4]
- 5. `cardPolicy` is dropped and `targetSelection: 'config'` is refused. [R5] [R9]
- 6. `resetRepoIdentityCache` and the three files are gone. [R6]
- 7. The test-only review wrappers live in the tests; no assertion changed. [R7]
- 8. `npm run typecheck` and `npm run build` pass with both unused checks on. [R8]
