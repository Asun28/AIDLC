---
id: T0-R3-COMMAND
title: Formal review (R3) as a configured command before the ship (Codex exec with a verdict schema); a block is REVIEW_FIX and restarts the pre-review cycle; a pass opens the ship
status: merged
branch: T0-R3-COMMAND
worktree: D:\wt\AIDLC\T0-R3-COMMAND
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
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/core/review-policy.test.ts tests/surface/templates.test.ts
dod_exit: 0
acceptance:
  - 1. `aidlc review r3 <card>` runs `formalReview.command` (argv with `{instructions}`, `{base}`, `{head}`, `{card}`, `{schema}` placeholders; the prompt goes to stdin when `{instructions}` is absent), materialises the verdict JSON schema, takes the last JSON line as the verdict, writes `.review/<card>.json` (sha + branch bound) and records the decision through the existing R3 ledger (`recordReviewOutcome`, `REVIEW_DECIDED`), consuming the two-decision allowance (pre-review.test.ts, t0-flow.test.ts "formal review"). [dod arm 1]
  - 2. With `formalReview.command` configured, SHIP requires a fresh R3 pass for the current candidate after the R2 pass: `card next` returns a `review` directive; a merge-blocking block moves the card to REVIEW_FIX (counted repair, DoD receipt cleared) and the repaired candidate needs a fresh pre-review cycle before R3 runs again; an advisory block proceeds with the findings retained; a second substantive block is STOP/review (t0-flow.test.ts). [dod arm 1]
  - 3. `review r3` refuses to run before the pre-review pass when `preReview.command` is set; no-verdict gets the single retry; a quota hold is WAIT with `holdUntil` (t0-flow.test.ts). [dod arm 1]
  - 4. This repository configures Codex (`codex exec --sandbox read-only --output-schema {schema} {instructions}`) with `gateRequired: true` so a Codex block returns the card to fix; the template ships the block disabled; docs and skill text updated within caps (templates.test.ts). [dod arm 1]
budget: 500
tdd: true
sweep: "grep -rn 'readVerdict|recordReviewOutcome|classifyVerdict|REVIEW_DECIDED|review-fix' src tests: card-runner.ts applyShipResult (ship-path verdicts, unchanged; a pass re-read by a ship path is not a second substantive decision per recordReviewOutcome repeatedPass), github-ship.ts/ship.ts readVerdict (.review/<card>.json contract reused), review-policy.ts (classifyVerdict/recordReviewOutcome reused), review-block.test.ts (R3 semantics kept), templates.test.ts caps (card-loop.md 6500)"
non_goals: [changing the ship paths, changing the R3 allowance rules, a new card state, sending anything but the configured command]
doc_sync: docs/OPERATIONS.md (Formal review command), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-R3-COMMAND

## Deliverable
The formal review (R3) runs as a configured command before the ship, with the same receipts and retention as R2, and feeds the existing R3 ledger. In this repository that command is Codex (`codex exec` with the verdict schema); a Codex block returns the card to fix, and the repaired candidate goes back through the DeepSeek pre-review cycle before R3 runs again. A pass hands the candidate to the ship.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts tests/core/review-policy.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the formal-review scenario passes (review directive, block -> REVIEW_FIX -> fix -> R2 cycle restart -> R3 pass -> ship), the unit tests for argv/stdin modes pass, R3 ledger and template caps unchanged and green.
