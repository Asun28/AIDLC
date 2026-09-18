---
id: T0-R2-PANEL
title: R2 as a concurrent three-angle DeepSeek panel with an aggregated verdict and a citation rule, R3 as one exhaustive pass, a deterministic scope gate, and the review guards from the Codex decisions, on top of the R3 command branch
status: merged
branch: T0-R2-PANEL
worktree: C:\wt\T0-R2-PANEL
allow_paths:
  - src/config.ts
  - src/core/types.ts
  - src/review/pre-review.ts
  - src/probes/exec.ts
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
  - 1. With `preReview.perspectives` set, one pre-review round runs one reviewer process per perspective concurrently (async runner, proven by a start barrier), each with a perspective section in its prompt and a filename-safe unique name, retains per-perspective verdict + log files and always one aggregated round document (also on hold or no-verdict); aggregation precedence is quota-hold > block > no-verdict > pass, reasons are unioned and tagged with the perspective, axes merge as the worse verdict. The formal review (R3) is never fanned out (pre-review.test.ts "panel", t0-flow.test.ts "panel"). [dod arm 1]
  - 2. Review guards: no formal review runs once the two-decision allowance is used, the card run is stopped, a formal review for the candidate is already pending, the shared review pool does not admit it, or the checkout HEAD is not the pinned candidate; a verdict naming another branch or sha is stale; a document that reports its own failure keeps it; a reviewer exit code other than 0 never passes; the canonical `.review/<card>.json` is published only for a successful, non-stale decision and an advisory block is published as a pass with the findings retained; a ship-path re-read of that same document is never a second decision while a different ship outcome still is; persisted state is re-read after the review and a STOP saved meanwhile is never overwritten; dynamic instructions never pass through a shell (pre-review.test.ts, t0-flow.test.ts "guards"). [dod arm 1]
  - 3. Existing single-reviewer R2 behaviour and the R3 ledger rules are unchanged (review-block.test.ts, review-policy.test.ts); skill text stays within its byte cap (templates.test.ts). [dod arm 1]
  - 5. Citation rule enforced in code where the verdict is classified: a block reason (top level or axis) without an axis tag and a location naming a changed path is advisory and never blocks; a block with no cited reason left is a pass with advisory notes retained; a document whose verdict contradicts its axes is malformed (pre-review.test.ts "citation rule"). This repository runs R2 as three contract-bound angles (ac-coverage, spec-deviations, edge-cases) and R3 as one exhaustive Codex pass. [dod arm 1]
  - 6. Deterministic scope gate before any model call: changed paths (collected NUL-separated, so quoted names are exact) outside `allow_paths` (exact, directory prefix, or glob with `*`, `**`, `?`) block the R2 round or refuse the R3 dispatch with no tokens spent (pre-review.test.ts "scope gate"). [dod arm 1]
  - 7. A quota hold is timed from the clock after the review returns; retention filenames of a retried round never overwrite an earlier attempt; the async runner survives a reviewer that exits before reading the prompt; source files contain no NUL bytes, so git diffs them as text (t0-flow.test.ts, tests/infra/exec.test.ts unchanged). [dod arm 1]
  - 4. This repository configures the three perspectives; the template ships perspectives empty (single review). Cards no longer pre-set `status: merged`; the previous card file is corrected to `in-progress`. [dod arm 1]
budget: 600
tdd: true
sweep: "grep -rn 'preReview\(|formalReview\(|runPreReview|classifyPreReview|applyShipResult|recordReviewOutcome' src tests: card-runner.ts (R2/R3 entry points, ship handoff), pre-review.ts (shared classify/run), main.ts review pre|r3 actions, t0-flow.test.ts call sites (become async), review-block.test.ts (ship-path verdict semantics kept)"
non_goals: [changing the R3 allowance rules, a new card state, fanning out the formal reviewer, changing the ship paths, tracking repair-introduced findings, a confidence field]
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
