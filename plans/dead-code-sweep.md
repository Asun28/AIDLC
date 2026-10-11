---
slug: dead-code-sweep
title: Remove the dead code, obsolete flags and wrong command lines the 2026-10-12 unused-code audit found
spec: specs/dead-code-sweep.md
size: T1
status: draft
created: 2026-10-11T21:54:00Z
---

# Plan: Remove the dead code, obsolete flags and wrong command lines (from specs/dead-code-sweep.md)

## 1. Goal and boundaries
Five small cards, one PR each, closing the findings of the 2026-10-12
unused-code audit. Cut: enforcing the lifecycle bound, the `LEGACY_LINE`
parser, export-keyword cosmetics, a generic doc command checker.

## 2. Minimal acceptable loop
Each card merges on its own PR. All five edit `CHANGELOG.md` and three edit
`docs/OPERATIONS.md`, so they run one at a time. The unused-code gate runs
last, after the two cards that change code it checks.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- `src/hooks/index.ts`: unknown-name guard in `runHook`.
- `src/core/types.ts`, `src/config.ts`, `src/delivery/ops.ts`, `src/state/paths.ts`, `src/state/board.ts`: deletions.
- `src/review/pre-review.ts`: the three test-only wrappers move to `tests/surface/_review-once.ts`.
- `tsconfig.json`, `src/coordination/review-queue.ts`, `src/loop/card-runner.ts`: the unused-code gate and `markLost(key, detail)`.
- Workflows, CLAUDE.md, `templates/`, `.claude/`, README, OPERATIONS: text.

## 5. Data model and state machine
none this version (the persisted `lifecycleRepairCycles` field stays)

## 6. Contracts and core interfaces
`aidlc hook <unknown>` exits 2; library exports `MAX_LIFECYCLE_REPAIR_CYCLES`
and `resetRepoIdentityCache` removed; `cardPolicy` dropped;
`targetSelection: 'config'` refused; `ReviewQueue.markLost(key, detail)`.

## Files that change
- src/hooks/index.ts
- src/core/types.ts
- src/config.ts
- src/delivery/ops.ts
- src/state/paths.ts
- src/state/board.ts
- src/review/pre-review.ts
- src/coordination/review-queue.ts
- src/loop/card-runner.ts
- tsconfig.json
- .github/workflows/agent-evals.yml
- templates/github/workflows/agent-evals.yml
- CLAUDE.md
- templates/CLAUDE.aidlc.md
- .claude/agents/release-specialist.md
- templates/claude/agents/release-specialist.md
- .claude/skills/aidlc-loop/release.md
- templates/claude/skills/aidlc-loop/release.md
- .claude/skills/aidlc-loop/card-loop.md
- templates/claude/skills/aidlc-loop/card-loop.md
- README.md
- docs/OPERATIONS.md
- scripts/code-unchanged.mjs
- docs/plans/PLAN-aidlc-loop-v5.md
- docs/plans/PLAN-aidlc-loop-v4.md
- tests/surface/hook-name.test.ts (new)
- tests/surface/command-lines.test.ts (new)
- tests/surface/removed-surface.test.ts (new)
- tests/surface/_review-once.ts (new)
- tests/surface/tsconfig-gate.test.ts (new)
- tests/infra/board.test.ts
- tests/surface/pre-review.test.ts
- tests/surface/reviewer-env.test.ts
- tests/surface/reviewer-env.child.ts
- tests/infra/review-queue.test.ts
- tests/infra/github-ship-merge-refused.test.ts
- tests/infra/github-ship.test.ts
- tests/infra/goal-store.test.ts
- tests/infra/lease.test.ts
- tests/scenarios/r2-fallback.test.ts
- CHANGELOG.md

## Order of work
1. T1-SWEEP-HOOK-NAME: an unknown hook name fails closed.
2. T1-SWEEP-FLAGS-2 (successor of T1-SWEEP-FLAGS, stopped for ci on PR #153): eval workflow provider, run only when ANTHROPIC_API_KEY is set; shipped command lines; env var docs.
3. T1-SWEEP-DEAD-CODE: lifecycle constant and board fragment, `cardPolicy`, `targetSelection: 'config'`, `resetRepoIdentityCache`, the obsolete script and plan copies.
4. T1-SWEEP-REVIEW-WRAPPERS: the test-only review wrappers move to the tests.
5. T1-SWEEP-UNUSED-GATE: `noUnusedLocals` and `noUnusedParameters`, `markLost`, the unused test locals.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-SWEEP-HOOK-NAME | MUST | `aidlc hook <unknown>` exits 2 naming the known names | - | W1 | - |
| T1-SWEEP-FLAGS-2 | MUST | eval job on claude-code when the key is set, a skip warning otherwise; no undeclared option in shipped command lines; env docs match | - | W2 | - |
| T1-SWEEP-DEAD-CODE | SHOULD | dead constant, field, enum value, function, script and plan copies removed; lifecycle bound stated | - | W3 | - |
| T1-SWEEP-REVIEW-WRAPPERS | SHOULD | test-only review wrappers live in the tests | - | W4 | - |
| T1-SWEEP-UNUSED-GATE | SHOULD | typecheck and build refuse unused locals and parameters | T1-SWEEP-DEAD-CODE, T1-SWEEP-REVIEW-WRAPPERS | W5 | - |

The cards share `CHANGELOG.md`, so they run one at a time.

## Risks
- `aidlc hook <unknown>` exiting 2 blocks every tool call of a repository
  whose settings carry a mistyped guard name; that is the intended failure,
  and the stderr line names the fix.
- Dropping `targetSelection: 'config'` refuses an `aidlc.ops.json` that uses
  it; such a binding passed no target before, so the refusal replaces a
  silent wrong target.
- Removing two library exports is a breaking change for a consumer of
  0.1.0 that imported them; the CHANGELOG names both.
- The gate may surface unused code the earlier cards leave; the gate card
  runs last and removes it.

## Proof
- tests/surface/hook-name.test.ts: the unknown-name exit and the CLI exit.
- tests/surface/command-lines.test.ts: workflow provider, command lines, env docs.
- tests/surface/removed-surface.test.ts, tests/infra/board.test.ts: removed exports, field, enum value, files; board line; README row.
- tests/surface/pre-review.test.ts, tests/surface/reviewer-env.test.ts: the wrappers are gone from src and every test still passes.
- tests/surface/tsconfig-gate.test.ts plus `npm run typecheck` and `npm run build`: the gate.

## 10. After merge
none this version (development-only target)
