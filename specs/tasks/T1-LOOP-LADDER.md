---
id: T1-LOOP-LADDER
title: Review blocks reopen the effort episode instead of consuming a build attempt; the ladder counts DoD failures only
status: todo
branch: T1-LOOP-LADDER
worktree: C:\wt\T1-LOOP-LADDER
allow_paths:
  - src/core/effort.ts
  - src/loop/card-runner.ts
  - tests/core/effort.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/review-block.test.ts
  - templates/claude/skills/aidlc-loop/card-loop.md
  - .claude/skills/aidlc-loop/card-loop.md
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - docs/LESSONS.md
  - CHANGELOG.md
  - specs/tasks/T1-LOOP-LADDER.md
dod_command: npm run typecheck && node --test tests/core/effort.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts
dod_exit: 0
requirements:
  - R10. WHEN a pre-review block returns a card to BUILD, the loop shall reopen the effort episode without converting the blocked attempt into a counted failure.
  - R11. WHEN a formal review block returns a card to REVIEW_FIX, the loop shall reopen the effort episode the same way, so the two-decision allowance is the only budget the formal review consumes.
  - R12. The loop shall count only DoD failures toward the effort ladder.
acceptance:
  - 1. A pre-review block reopens the episode: the blocked attempt keeps its success outcome, the episode terminal is cleared, and the repair attempt is admitted at the same effort; the R2 rounds cap remains the only budget a pre-review round consumes (t0-flow.test.ts "pre-review gate"). [R10] [dod arm 1]
  - 2. A formal review block, by command or by the ship path, reopens the episode the same way; the two-decision allowance remains the only budget R3 consumes (t0-flow.test.ts "formal review", review-block.test.ts). [R11] [dod arm 1]
  - 3. `countedAttempts` counts DoD failures only: a card whose DoD passed and that was review-blocked four times still has three baseline attempts and one justified escalation for real failures, while three DoD failures without progress still stop it and the same-cause rule is unchanged (effort.test.ts). [R12] [dod arm 1]
  - 4. Both `card-loop.md` copies stay within the byte cap and no longer call a review block a counted repair; `docs/ARCHITECTURE.md`, `docs/OPERATIONS.md` and CHANGELOG.md record the policy; `docs/LESSONS.md` carries the first lesson line in the frozen format (templates.test.ts, mirror.test.ts). [dod arm 1]
plan_ref: plans/loop-integration.md#7
budget: 200
tdd: true
sweep: "grep -rn 'markReviewFailure\|countedAttempts\|counted repair\|becomes a counted failure' src tests templates .claude docs: card-runner.ts three call sites (R3 command, pre-review, ship-path block), effort.ts counting, t0-flow.test.ts pre-review gate and formal review assertions, review-block.test.ts, card-loop.md SHIP paragraph"
non_goals: [changing the R2 rounds cap or the R3 decision allowance, changing MAX_BASELINE_ATTEMPTS, changing what counts as a DoD failure, the lessons closure predicate]
doc_sync: docs/ARCHITECTURE.md (effort policy), docs/OPERATIONS.md (attempts and review budgets), docs/LESSONS.md, CHANGELOG.md
---

# T1-LOOP-LADDER

## Deliverable
Two cards in this goal ended by the effort ladder while every review finding was accepted and fixed: each review block converted the preceding successful attempt into a counted failure, and the ladder allows four attempts while one R2 cycle plus R3 can block five times. This card makes review budgets and the build ladder independent: a review block reopens the episode without a counted failure, and the ladder counts DoD failures only. Reviews keep their own limits (R2 rounds per cycle, two R3 decisions).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/effort.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts
```
- Expected exit code: 0
- Assertion: the effort, scenario, template and mirror tests named above pass, including the new assertions that review blocks do not consume attempts and that only DoD failures count.
