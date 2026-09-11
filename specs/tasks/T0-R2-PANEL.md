---
id: T0-R2-PANEL
title: R2 as a concurrent three-angle DeepSeek panel (bugs, security, compliance) with an aggregated verdict, plus the five Codex R3 guard findings, on top of the R3 command branch
status: in-progress
branch: T0-R2-PANEL
worktree: C:\wt\T0-R2-PANEL
allow_paths:
  - src/config.ts
  - src/core/types.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - aidlc.config.json
  - templates/aidlc.config.json
  - templates/claude/skills/aidlc-loop/card-loop.md
  - .claude/skills/aidlc-loop/card-loop.md
  - tests/surface/pre-review.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-R3-COMMAND.md
  - specs/tasks/T0-R2-PANEL.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/core/review-policy.test.ts tests/surface/templates.test.ts
dod_exit: 0
acceptance:
  - 1. With `preReview.perspectives` set, one pre-review round runs one reviewer process per perspective concurrently (async runner), each with a perspective section in its prompt, retains per-perspective verdict + log files and one aggregated round verdict; aggregation precedence is quota-hold > block > no-verdict > pass, reasons are unioned and tagged with the perspective, axes merge as the worse verdict (pre-review.test.ts "panel", t0-flow.test.ts "panel"). [dod arm 1]
  - 2. R3 guards from the second Codex decision: no formal review runs once the two-decision allowance is used or the card run is stopped, a verdict naming another branch is stale, a ship-path re-read of a command verdict (pass or advisory block) is never a second decision, and a reviewer exit code other than 0 with a pass document is a tool error, never a pass (pre-review.test.ts, t0-flow.test.ts "guards"). [dod arm 1]
  - 3. Existing single-reviewer R2 behaviour and the R3 ledger rules are unchanged (review-block.test.ts, review-policy.test.ts); skill text stays within its byte cap (templates.test.ts). [dod arm 1]
  - 5. Citation rule enforced in code where the verdict is classified: a block reason without an axis tag and a diff location (`@ file[:line]`) is advisory and never blocks; a block with no cited reason left is a pass with advisory notes retained (pre-review.test.ts "citation rule"). This repository runs R2 as three contract-bound angles (ac-coverage, spec-deviations, edge-cases) and R3 as one exhaustive Codex pass. [dod arm 1]
  - 4. This repository configures the three perspectives; the template ships perspectives empty (single review). Cards no longer pre-set `status: merged`; the previous card file is corrected to `in-progress`. [dod arm 1]
budget: 600
tdd: true
sweep: "grep -rn 'preReview\(|formalReview\(|runPreReview|classifyPreReview|applyShipResult|recordReviewOutcome' src tests: card-runner.ts (R2/R3 entry points, ship handoff), pre-review.ts (shared classify/run), main.ts review pre|r3 actions, t0-flow.test.ts call sites (become async), review-block.test.ts (ship-path verdict semantics kept)"
non_goals: [changing the R3 allowance rules, a new card state, fanning out the formal reviewer, changing the ship paths]
doc_sync: docs/OPERATIONS.md (Pre-review panel), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-R2-PANEL

## Deliverable
The pre-review round becomes a concurrent panel: one DeepSeek V4 Pro process per configured perspective (bugs, security, compliance), each judging the same committed candidate from its angle, aggregated into one round verdict that blocks on any block and passes only when every perspective passes. The five fail-open findings from the second Codex decision on T0-R3-COMMAND are closed in the same change so the combined branch can ship through R2 then R3.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/core/review-policy.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: panel unit + scenario tests pass; guard tests pass; R3 ledger and template caps unchanged and green.
