---
slug: dead-code-sweep
title: Remove the dead code, obsolete flags and wrong command lines the 2026-10-12 unused-code audit found
author: asun28 (engineer)
status: accepted
created: 2026-10-11T21:54:00Z
source: human
---

# Intent: Remove the dead code, obsolete flags and wrong command lines the 2026-10-12 unused-code audit found
Author: asun28 (engineer). Status: accepted.

## Problem
An audit of main at df9acd7 (`tsc --noUnusedLocals --noUnusedParameters`,
a TypeScript language-service reference scan of all 664 exports in `src/`,
the import graph, `npm ls`, and a grep of env vars, config fields and CLI
options) found:

1. The agent-evals workflow (`.github/workflows/agent-evals.yml:30` and its
   template) sets `AIDLC_PROVIDER: claude-code`, which nothing reads, so
   `evals run` uses `provider: mock` from `aidlc.config.json` and the eval
   job never calls a model.
2. `MAX_LIFECYCLE_REPAIR_CYCLES` (`src/core/types.ts:1023`) is never read,
   the `lifecycleRepairCycles` counter is never incremented, and
   `README.md:88` and the board (`lifecycle-repair=0/1`) present the bound
   as enforced (finding F2 of `docs/plans/PLAN-v5.1-hardening.md`).
3. Dead or obsolete code: the `cardPolicy` config field (`src/config.ts:128`)
   is parsed and never read; the `targetSelection: 'config'` value of an
   ops binding (`src/delivery/ops.ts:26`) has no branch and passes no
   target; `resetRepoIdentityCache` (`src/state/paths.ts:72`) has never had
   a caller; `scripts/code-unchanged.mjs` serves only the merged card
   T0-BASE-SYNC-JSDOC; `docs/plans/PLAN-aidlc-loop-v5.md` and
   `PLAN-aidlc-loop-v4.md` are byte-identical copies of
   `PLAN-aidlc-loop.md` and `PLAN-aidlc-loop-v4-archive.md`;
   `runPreReview`, `buildPreReviewPrompt` and `extractVerdict`
   (`src/review/pre-review.ts`) are called only by tests since the R2 panel
   replaced the single pass.
4. Shipped docs name options that do not exist: `aidlc release start
   --target` (CLAUDE.md, the release module, the release-specialist agent)
   exits `unknown option`, and the card-loop module says `aidlc card report
   <id> --result`, which requires `--data`. CLAUDE.md names the older
   `CLAUDE_SESSION_ID` only and says the hooks read `AIDLC_TARGET_ENV`,
   which aidlc only sets for an ops child; `AIDLC_RUN_NO_SHIP` is not
   documented.
5. `aidlc hook <name>` with an unknown name exits 0, so a mistyped
   per-guard hook command silently allows every action.
6. One unused parameter in `src/` (`ReviewQueue.markLost`'s `now`) and 14
   unused locals and imports in `tests/`, with no gate that keeps them out.

## Proposed outcome
- The eval workflow runs the suite on the claude-code provider.
- The lifecycle repair bound is stated as directive text that no code
  enforces; the unused constant and the board's `/1` are gone.
- The dead code, the obsolete script and the duplicate plan copies are
  removed; the test-only review wrappers live in the tests.
- Every shipped command line names options the CLI declares, and the env
  var docs match the code.
- An unknown hook name fails closed (exit 2, the known names on stderr).
- `noUnusedLocals` and `noUnusedParameters` gate the typecheck.

## Affected users and systems
`.github/workflows/`, `templates/`, `.claude/`, `CLAUDE.md`, `README.md`,
`docs/`, `scripts/`, `src/config.ts`, `src/delivery/ops.ts`,
`src/state/paths.ts`, `src/state/board.ts`, `src/core/types.ts`,
`src/review/pre-review.ts`, `src/coordination/review-queue.ts`,
`src/hooks/index.ts`, `tsconfig.json`, their tests and `CHANGELOG.md`.

## Constraints
- One card per PR, each in its own worktree; budget 250 or less per card.
- Library exports removed from `src/index.ts` are named in the CHANGELOG.
- No change to review policy, allowances, the verdict schema or the
  persisted goal schema (the `lifecycleRepairCycles` field stays, so old
  goal records still parse).
- User rulings of 2026-10-12: state the lifecycle repair bound rather than
  enforce it; fail an unknown hook name closed with exit 2.

## Open questions
- (none)
