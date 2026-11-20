---
id: T0-TEST-AUDIT-UPDATE
title: The four tests of the owner-approved audit list check the code the loop runs (runReviewPanel, templates/plans/_TEMPLATE.md) instead of the test copies runPreReview and renderPlan
status: todo
branch: T0-TEST-AUDIT-UPDATE
worktree: D:\wt\AIDLC\T0-TEST-AUDIT-UPDATE
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - tests/surface/pre-review.test.ts
  - tests/surface/reviewer-env.test.ts
  - tests/surface/plan.test.ts
  - changelog.d/T0-TEST-AUDIT-UPDATE.md
  - specs/tasks/T0-TEST-AUDIT-UPDATE.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/reviewer-env.test.ts tests/surface/plan.test.ts
dod_exit: 0
requirements:
  - R1. In `tests/surface/pre-review.test.ts`, test "formal review (R3) command: placeholders expand…", the argv-mode and stdin-mode arms shall call `runReviewPanel` of `src/review/pre-review.ts` (one angle, `perspectives: []`) instead of `runPreReview` of `tests/surface/_review-once.ts`, and keep their assertions: argv mode passes the instructions as an argument and an empty stdin, stdin mode passes the prompt on stdin, and the argv-mode round passes.
  - R2. In the same file, test "panel: perspectives run concurrently…", the shell arm shall call `runReviewPanel` with `shell: true` and a command holding `{instructions}`, and assert that the runner received `shell: false`.
  - R3. In `tests/surface/reviewer-env.test.ts`, test "T0-REVIEWER-UTF8 acceptance 2", the two `runPreReview` calls shall become one-angle `runReviewPanel` calls with the same commands (`--stdin` and `{instructions}`), so every recorded spawn is a `runReviewPanel` spawn; the expected keys and the `reviewerEnv()` assertion stay; the test name drops `runPreReview`.
  - R4. In `tests/surface/plan.test.ts`, test "renderPlan light omits the ten-section skeleton; full includes it" shall read `templates/plans/_TEMPLATE.md` (the plan skeleton `aidlc init` installs) and assert it holds `## 1. Goal and boundaries`, `none this version`, `## Files that change`, `## Order of work`, `## 7. Task split (dependencies and parallel windows)`, `## Risks`, `## Proof` and `## 10. After merge`; the test name says it checks the installed template. The light-plan assertions leave: no light plan exists outside the fixture `renderPlan` (`tests/surface/_artifacts.ts`), and the readiness tests still run the light fixture.
acceptance:
  - 1. The DoD passes, and `grep -n runPreReview` over the four named tests finds no call. [R1] [R2] [R3] [R4] [dod arm 1]
  - 2. Mutation sweep, each applied to `src/review/pre-review.ts` `runAngle` alone and reverted: `input: promptInArgv ? '' : prompt` changed to `input: prompt` fails R1's argv arm; changed to `input: ''` fails R1's stdin arm; `shell: promptInArgv ? false : …` changed to `shell: r.shell ?? …` fails R2's arm; `env: reviewerEnv()` changed to `env: process.env` fails R3's test. On main each mutation leaves the R1 to R3 arms passing (they call the test copy). [R1] [R2] [R3]
  - 3. Removing `## 10. After merge` from `templates/plans/_TEMPLATE.md` fails R4's test; on main it passes. [R4]
depends_on: []
budget: 45
tdd: false
forbid:
  - a change under src/ or templates/
  - changing any test other than the four named in R1 to R4, or an assertion of those four beyond what R1 to R4 name
  - removing runPreReview or renderPlan from the test helpers (other tests still call them)
non_goals: [editing docs/reliability/test-audit.json or its table, converting other runPreReview callers]
hygiene: "Acts on the four rows of docs/reliability/test-audit.json that the owner approved in session on 2026-11-20 (all four `update`). tdd is false: the product code is correct, so no test goes RED by a code change; the oracle is the mutation sweep in acceptance 2 and 3, which fails the updated tests and passes on main. Changelog entry in changelog.d/T0-TEST-AUDIT-UPDATE.md (form: changelog.d/README.md)."
---

# T0-TEST-AUDIT-UPDATE

## Deliverable
The four tests the audit marked as checking test copies check the reviewer spawn and the plan template the product uses.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/reviewer-env.test.ts tests/surface/plan.test.ts
```
- Expected exit code: 0
- Assertion: the three files pass; each mutation in acceptance 2 and 3 fails its test and passes on main.

## Attempt evidence
