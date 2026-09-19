---
id: T0-PRE-REVIEW
title: Bounded DeepSeek V4 Pro pre-review (R2) before the ship: block => fix => next round, pass => PR review (R3); an R3 block returns to fix and restarts the pre-review cycle
status: merged
branch: T0-PRE-REVIEW
worktree: D:\wt\AIDLC\T0-PRE-REVIEW
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
  - .gitignore
  - tests/surface/pre-review.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-PRE-REVIEW.md
dod_command: npm run typecheck && node --test tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/core/review-policy.test.ts tests/surface/templates.test.ts
dod_exit: 0
acceptance:
  - 1. `aidlc review pre <card>` sends REVIEW.md + the card + the committed diff (base...HEAD) + prior findings to the configured pre-reviewer command (stdin), parses the last JSON verdict line, writes `.review/<card>.pre.<cycle>.<round>.json` + `.log`, records the round in `run.preReview` and journals `PRE_REVIEW_DECIDED` (pre-review.test.ts). [dod arm 1]
  - 2. With `preReview.command` configured, `card next` in SHIP returns a `pre-review` directive until a `pass` exists for the current candidate; a `block` moves the run to BUILD as a counted repair (DoD receipt cleared, reasons carried); rounds are capped per R3 cycle by `preReview.rounds`; exhaustion is STOP/review unless `onExhausted` is `ship` (t0-flow.test.ts "pre-review gate"). [dod arm 1]
  - 3. An R3 block starts a new pre-review cycle: the repaired candidate needs a fresh pass and the prompt carries the R3 reasons to verify; no-verdict gets one retry; a quota hold is WAIT, never a decision (pre-review.test.ts, t0-flow.test.ts). [dod arm 1]
  - 4. Card-loop skill text names the R2 step within its byte cap; OPERATIONS/ARCHITECTURE/CHANGELOG describe the gate and config keys (templates.test.ts). [dod arm 1]
budget: 600
tdd: true
sweep: "grep -rn 'readVerdict|classifyVerdict|recordReviewOutcome|review-fix|REVIEW_DECIDED' src tests: card-runner.ts ship()/applyShipResult() (R3 wiring, untouched), review-policy.ts (parseVerdict/detectQuotaHold reused), types.ts (Verdict/ReviewLedger/JournalEventType extended), main.ts review group (status; pre added), templates.test.ts caps (card-loop.md 6500)"
non_goals: [replacing or re-wiring the R3 reviewer (Codex/PR review stays as configured), a new card state (the gate lives inside SHIP), a UI, sending diffs anywhere but the configured command]
doc_sync: docs/OPERATIONS.md (Pre-review section + config keys), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-PRE-REVIEW

## Deliverable
A bounded pre-review stage (R2) in front of the ship: `aidlc review pre <card>` runs the configured command (DeepSeek V4 Pro here) on the committed candidate against REVIEW.md, receipted and journaled. The ship step requires a fresh pass for the current candidate; a block is a counted repair; rounds are capped per R3 cycle (3 in this repository); an R3 block restarts the cycle with the R3 reasons carried into the next pre-review prompt.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts tests/core/review-policy.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: pre-review unit tests (prompt, verdict extraction, runner outcomes, files) and the t0-flow gate scenario pass; review-policy and template caps unchanged and green.
