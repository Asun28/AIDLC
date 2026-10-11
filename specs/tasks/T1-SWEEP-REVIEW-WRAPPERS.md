---
id: T1-SWEEP-REVIEW-WRAPPERS
title: The three review wrappers only tests call (runPreReview, buildPreReviewPrompt, extractVerdict) move from src/review/pre-review.ts into a test helper
status: merged
branch: T1-SWEEP-REVIEW-WRAPPERS
worktree: D:\wt\AIDLC\T1-SWEEP-REVIEW-WRAPPERS
plan_ref: plans/dead-code-sweep.md#order-of-work
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/_review-once.ts
  - tests/surface/pre-review.test.ts
  - tests/surface/reviewer-env.test.ts
  - tests/surface/reviewer-env.child.ts
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP-REVIEW-WRAPPERS.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/reviewer-env.test.ts
dod_exit: 0
requirements:
  - R1. `src/review/pre-review.ts` shall not export `runPreReview`, `RunPreReviewOptions`, `buildPreReviewPrompt` or `extractVerdict`, which no code in `src/` has called since the R2 panel (`runReviewPanel`, a7bbcae) replaced the single pass; `buildReviewPrompt`, `readVerdict`, `finalizeReview`, `expandCommand`, `reviewerEnv` and `runReviewPanel` are unchanged.
  - R2. `tests/surface/_review-once.ts` shall define `runPreReview` (expandCommand, then the runner with `reviewerEnv()` and the same stdin, shell and timeout rules, then `finalizeReview`), `buildPreReviewPrompt` (`buildReviewPrompt` with `stage: 'pre'` and `includeDiff: true`) and `extractVerdict` (`readVerdict(output).verdict`) with the signatures they had, and the three test files shall import them from it; no test or assertion is added, removed or changed apart from R3's.
  - R3. `tests/surface/pre-review.test.ts` shall assert that the module `src/review/pre-review.ts` exports none of the four R1 names.
  - R4. The CHANGELOG Unreleased section shall carry an entry naming this card.
acceptance:
  - 1. `tests/surface/pre-review.test.ts`: a dynamic import of `src/review/pre-review.ts` has no `runPreReview`, `buildPreReviewPrompt` or `extractVerdict` property. [R1] [R3] [dod arm 2]
  - 2. `tests/surface/pre-review.test.ts` and `tests/surface/reviewer-env.test.ts` (with `reviewer-env.child.ts`) pass, with the same test names as on main plus the one R3 test. [R2] [dod arms 2, 3]
  - 3. The typecheck is clean, so no file in `src/` or `tests/` still imports a removed name from `src/review/pre-review.ts`. [R1] [R2] [dod arm 1]
  - 4. `tests/surface/pre-review.test.ts` reads a T1-SWEEP-REVIEW-WRAPPERS entry in the CHANGELOG Unreleased section. [R4] [dod arm 2]
depends_on: []
budget: 160
tdd: true
sweep: "Reference scan of every export in src/ (main at df9acd7): runPreReview, buildPreReviewPrompt and extractVerdict are referenced only from tests/surface/pre-review.test.ts, tests/surface/reviewer-env.test.ts and tests/surface/reviewer-env.child.ts; src/loop/card-runner.ts calls runReviewPanel and buildReviewPrompt. src/review/pre-review.ts is not re-exported by src/index.ts, so no library export changes. grep -rn 'runPreReview\\|buildPreReviewPrompt\\|extractVerdict' docs README.md CLAUDE.md: none."
forbid: [changing runReviewPanel, finalizeReview, readVerdict or buildReviewPrompt, changing an existing assertion, porting the tests to runReviewPanel]
non_goals: ["moving the existing tests onto the async panel path"]
doc_sync: CHANGELOG.md
---

# T1-SWEEP-REVIEW-WRAPPERS

## Deliverable
`src/review/pre-review.ts` carries only code the loop runs; the three wrappers that only tests call live in a test helper with the same names, so the test call sites keep their text.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/surface/reviewer-env.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
