---
slug: dead-code-sweep-2
title: Fix the fix-task clear defect and remove the dead code and obsolete flags the 2026-10-14 unused-code audit found
spec: specs/dead-code-sweep-2.md
size: T1
status: draft
created: 2026-10-14T09:00:00Z
---

# Plan: Fix the fix-task clear defect and remove the dead code and obsolete flags (from specs/dead-code-sweep-2.md)

## 1. Goal and boundaries
Five cards, one PR each, closing the findings of the 2026-10-14 unused-code
audit. Cut: the hook's two-pass dispatch, removing `RELEASE_APPROVAL` or the
no-state approval, wiring the uncalled pure checks into the loop, the roles
options, export-keyword cosmetics.

## 2. Minimal acceptable loop
Each card merges on its own PR. Every card edits `CHANGELOG.md`, and two
pairs share a source file (`src/loop/card-runner.ts`, `src/cli/main.ts`), so
the cards run one at a time. The defect goes first.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- `src/cli/main.ts`: `card fix-task --clear` deletes the marker; the
  security check detail; the doctor session line.
- `src/loop/card-runner.ts`: three uncalled members go.
- `src/loop/controller.ts`: `extendDeadline` runs the core rule.
- `src/core/` card-machine, release-machine, effort, goal-machine,
  deadlines, stop, ci-policy, types: deletions.
- `src/maintain/bands.ts`, `src/evals/runner.ts`, `src/state/paths.ts`,
  `src/artifacts/spec.ts`, `src/artifacts/plan.ts`,
  `src/providers/claude-api.ts`: deletions; four fixtures move into tests.
- `src/state/journal.ts`: the session fallback goes.
- `src/hooks/index.ts`: the production gate deny text.
- Docs: ARCHITECTURE, OPERATIONS, REQUIREMENTS-TRACEABILITY, CLAUDE.md and
  its template section.

## 5. Data model and state machine
`GoalCounters` loses `lifecycleRepairCycles`, `providerWaitMs` and
`planningMs`; old goal records parse (zod drops unknown keys). No state
machine change.

## 6. Contracts and core interfaces
`aidlc card fix-task --clear` deletes the marker; `aidlc goal extend`
refuses a blank reason; `CLAUDE_SESSION_ID` is not read; the library
exports named in the spec are removed and listed in the CHANGELOG.

## Files that change
- src/cli/main.ts
- src/loop/card-runner.ts
- src/loop/controller.ts
- src/core/card-machine.ts
- src/core/release-machine.ts
- src/core/effort.ts
- src/core/goal-machine.ts
- src/core/deadlines.ts
- src/core/stop.ts
- src/core/ci-policy.ts
- src/core/types.ts
- src/maintain/bands.ts
- src/evals/runner.ts
- src/state/paths.ts
- src/state/journal.ts
- src/artifacts/spec.ts
- src/artifacts/plan.ts
- src/providers/claude-api.ts
- src/delivery/ship.ts
- src/hooks/index.ts
- docs/ARCHITECTURE.md
- docs/OPERATIONS.md
- docs/REQUIREMENTS-TRACEABILITY.md
- CLAUDE.md
- templates/CLAUDE.aidlc.md
- CHANGELOG.md
- tests/surface/fix-task-clear.test.ts (new)
- tests/scenarios/extend-reason.test.ts (new)
- tests/surface/security-check.test.ts (new)
- tests/surface/_artifacts.ts (new)
- tests/surface/removed-surface.test.ts
- tests/core/card-machine.test.ts
- tests/core/release-machine.test.ts
- tests/core/effort.test.ts
- tests/core/goal-machine.test.ts
- tests/core/deadlines.test.ts
- tests/core/stop.test.ts
- tests/core/ci-policy.test.ts
- tests/core/types.test.ts
- tests/core/_fixtures.ts
- tests/infra/helpers.ts
- tests/infra/journal.test.ts
- tests/infra/paths.test.ts
- tests/infra/goal-store.test.ts
- tests/scenarios/_harness.ts
- tests/scenarios/ci-rerun.test.ts
- tests/scenarios/review-block.test.ts
- tests/scenarios/ship-failing-line.test.ts
- tests/scenarios/t0-flow.test.ts
- tests/surface/bands.test.ts
- tests/surface/templates.test.ts
- tests/surface/evals.test.ts
- tests/surface/spec.test.ts
- tests/surface/plan.test.ts
- tests/surface/hooks.test.ts
- tests/surface/command-lines.test.ts

## Order of work
1. T1-SWEEP2-FIX-TASK: `card fix-task --clear` deletes the marker; the uncalled `setFixTaskMarker` goes.
2. T1-SWEEP2-EXTEND-REASON: `GoalController.extendDeadline` runs the core rule, so a blank reason is refused.
3. T1-SWEEP2-DUPLICATES: the test-only copies of rules production enforces another way go.
4. T1-SWEEP2-TEST-ONLY: test-only exports go or move into the tests; the traceability rows of uncalled checks are corrected.
5. T1-SWEEP2-FLAGS: the session fallback, the unread counters, the security check text and the release approval docs.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-SWEEP2-FIX-TASK | MUST | `card fix-task --clear` unlocks test files; `setFixTaskMarker` gone | - | W1 | - |
| T1-SWEEP2-EXTEND-REASON | MUST | a blank extension reason is refused by the core rule | - | W2 | - |
| T1-SWEEP2-DUPLICATES | SHOULD | one implementation per rule, the one production runs | T1-SWEEP2-FIX-TASK | W3 | - |
| T1-SWEEP2-TEST-ONLY | SHOULD | no export only tests call; honest traceability rows | T1-SWEEP2-DUPLICATES | W4 | - |
| T1-SWEEP2-FLAGS | SHOULD | session, counters, security check and approval docs match the code | T1-SWEEP2-FIX-TASK | W5 | - |

The cards share `CHANGELOG.md`, so they run one at a time.

## Risks
- Removing library exports breaks a consumer of 0.1.0 that imported them;
  no tag or publish of the package exists, and the CHANGELOG names each.
- Dropping the `CLAUDE_SESSION_ID` fallback changes the session of a
  process that set only that variable by hand; the CHANGELOG names
  `AIDLC_SESSION`.
- A stale empty marker from an earlier `--clear` keeps locking until
  `--clear` runs once more; the CHANGELOG says so.
- Removing a wrapper can drop the only test of the production code under
  it; each card keeps those assertions against the production entry point.

## Proof
- tests/surface/fix-task-clear.test.ts: clear deletes the marker; an empty marker still reads as active.
- tests/scenarios/extend-reason.test.ts: a blank reason is refused and nothing is written.
- tests/surface/removed-surface.test.ts: every removed export and member is gone.
- tests/surface/security-check.test.ts: exit 2, NOT CONFIGURED, no config binding named.
- tests/core/types.test.ts: a goal record with the three counters parses without them.
