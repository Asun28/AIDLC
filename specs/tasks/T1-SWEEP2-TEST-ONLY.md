---
id: T1-SWEEP2-TEST-ONLY
title: Remove the exports only tests call, move the four test fixtures into the tests, and make the traceability rows of uncalled pure checks say so
status: todo
branch: T1-SWEEP2-TEST-ONLY
worktree: D:\wt\AIDLC\T1-SWEEP2-TEST-ONLY
plan_ref: plans/dead-code-sweep-2.md#order-of-work
allow_paths:
  - src/core/deadlines.ts
  - src/core/stop.ts
  - src/core/ci-policy.ts
  - src/core/effort.ts
  - src/evals/runner.ts
  - src/state/paths.ts
  - src/artifacts/spec.ts
  - src/artifacts/plan.ts
  - src/providers/claude-api.ts
  - src/delivery/ship.ts
  - tests/core/deadlines.test.ts
  - tests/core/stop.test.ts
  - tests/core/ci-policy.test.ts
  - tests/infra/helpers.ts
  - tests/infra/goal-store.test.ts
  - tests/infra/paths.test.ts
  - tests/scenarios/_harness.ts
  - tests/scenarios/ci-rerun.test.ts
  - tests/scenarios/review-block.test.ts
  - tests/scenarios/ship-failing-line.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/surface/evals.test.ts
  - tests/surface/spec.test.ts
  - tests/surface/plan.test.ts
  - tests/surface/_artifacts.ts
  - tests/surface/removed-surface.test.ts
  - docs/REQUIREMENTS-TRACEABILITY.md
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP2-TEST-ONLY.md
dod_command: npm run typecheck && node --test tests/surface/removed-surface.test.ts tests/core/deadlines.test.ts tests/core/stop.test.ts tests/core/ci-policy.test.ts tests/infra/goal-store.test.ts tests/infra/paths.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/review-block.test.ts tests/scenarios/ship-failing-line.test.ts tests/scenarios/t0-flow.test.ts tests/surface/evals.test.ts tests/surface/spec.test.ts tests/surface/plan.test.ts tests/surface/providers.test.ts
dod_exit: 0
requirements:
  - R1. The library (`src/index.ts`) shall export none of `fitsBeforeDeadline`, `isGlobalStop`, `gateChecks`, `evalFromIncident`, `countedFailures`, `ensureStatePaths`, `renderSpec` or `renderPlan`, and `ClaudeApiOptions` (`src/providers/claude-api.ts`) has no `showThinking`, so the provider always requests thinking display `omitted`.
  - R2. The fixtures `countedFailures` (moved to `tests/scenarios/_harness.ts`), `ensureStatePaths` (moved to `tests/infra/helpers.ts`), `renderSpec` and `renderPlan` (moved to `tests/surface/_artifacts.ts`) shall keep their names and bodies, so their test call sites change only imports.
  - R3. The tests of `gateChecks` (`tests/core/ci-policy.test.ts`) shall keep each assertion about the decoded check names by running the same gate text through `classifyCiFailure`, the production reader of the gate line; the tests of `fitsBeforeDeadline`, `isGlobalStop` and `evalFromIncident` go with them.
  - R4. The traceability matrix shall say, in the rows that cite `reviewerIndependent` (MA3), `binaryRollbackCompatible` (LC9) or `findingMarker` (R25-R27), and in the rows that cite the modules of `routeAmendment` (Q5) and `unattendedMutationAllowed` (LC4), that the check exists as a pure function the loop does not call, and no such row says `implemented` for that check.
  - R5. The comment at `src/delivery/ship.ts:98` shall name the function that decodes the check names after `gateChecks` goes, and the CHANGELOG Unreleased section shall carry an entry naming this card, the eight removed exports and the removed option.
acceptance:
  - 1. `tests/surface/removed-surface.test.ts`: `src/index.ts` exports none of the eight R1 names and still exports `effectiveGoalDeadline`, `formatStop`, `classifyCiFailure`, `parseSpec` and `parsePlan`; the source of `src/providers/claude-api.ts` holds no `showThinking` and requests `display: 'omitted'`. [R1] [dod arm 2]
  - 2. `tests/scenarios/ci-rerun.test.ts`, `tests/scenarios/review-block.test.ts`, `tests/scenarios/ship-failing-line.test.ts`, `tests/scenarios/t0-flow.test.ts`, `tests/infra/goal-store.test.ts`, `tests/infra/paths.test.ts`, `tests/surface/spec.test.ts` and `tests/surface/plan.test.ts` pass with only their imports changed. [R2] [dod arms 6-14]
  - 3. `tests/core/ci-policy.test.ts`: every former `gateChecks` assertion holds through `classifyCiFailure` on the same gate text; `tests/core/deadlines.test.ts`, `tests/core/stop.test.ts` and `tests/surface/evals.test.ts` pass with only the tests of removed names taken out. [R3] [dod arms 3, 4, 5, 13]
  - 4. The same removed-surface file reads the rows MA3, LC9, R25-R27, Q5 and LC4 of `docs/REQUIREMENTS-TRACEABILITY.md`: each names its uncalled check and says the loop does not call it; `src/delivery/ship.ts` does not name `gateChecks`; the CHANGELOG Unreleased section has a T1-SWEEP2-TEST-ONLY entry. [R4] [R5] [dod arm 2]
  - 5. `tests/surface/providers.test.ts` passes unchanged. [R1] [dod arm 15]
depends_on: [T1-SWEEP2-DUPLICATES]
budget: 450
tdd: true
sweep: "Reference scan with the TypeScript language service over src/ and tests/ (main at 7bdaee2): the eight R1 names are referenced only by their declarations and tests; showThinking is set by no caller or test. Test users: countedFailures in four scenario files, ensureStatePaths in tests/scenarios/_harness.ts, tests/infra/goal-store.test.ts and tests/infra/paths.test.ts, renderSpec and renderPlan in tests/surface/spec.test.ts and plan.test.ts, gateChecks in tests/core/ci-policy.test.ts. grep of docs: no doc names the R1 names; src/delivery/ship.ts:98 names gateChecks in a comment."
forbid: [deleting a pure check cited by a requirement row (reviewerIndependent, binaryRollbackCompatible, findingMarker, routeAmendment, unattendedMutationAllowed), changing classifyCiFailure, changing an assertion other than its import or its gateChecks call]
non_goals: ["wiring the uncalled pure checks into the loop", "the roles options crossFamilyReviewer and configured", "the test seams scriptedRunner, ok and setActorForTests"]
hygiene: "Budget 450: about half is the four fixtures moving from src/ to tests/ (counted on both sides)."
doc_sync: docs/REQUIREMENTS-TRACEABILITY.md, CHANGELOG.md
---

# T1-SWEEP2-TEST-ONLY

## Deliverable
No library export is called only by tests: four wrappers and one provider option go, four fixtures move into the tests under the same names, and the traceability matrix stops calling the uncalled pure checks implemented.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/removed-surface.test.ts tests/core/deadlines.test.ts tests/core/stop.test.ts tests/core/ci-policy.test.ts tests/infra/goal-store.test.ts tests/infra/paths.test.ts tests/scenarios/ci-rerun.test.ts tests/scenarios/review-block.test.ts tests/scenarios/ship-failing-line.test.ts tests/scenarios/t0-flow.test.ts tests/surface/evals.test.ts tests/surface/spec.test.ts tests/surface/plan.test.ts tests/surface/providers.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
