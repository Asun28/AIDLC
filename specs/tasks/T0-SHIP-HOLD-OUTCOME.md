---
id: T0-SHIP-HOLD-OUTCOME
title: Only a review-no-verdict ship outcome holds the review pool; a merged or CI-red ship settles its pool request whatever quota words its receipt carries
status: todo
branch: T0-SHIP-HOLD-OUTCOME
worktree: D:\wt\AIDLC\T0-SHIP-HOLD-OUTCOME
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-HOLD-OUTCOME.md
dod_command: npm run typecheck && node --test tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `CardRunner.applyShipResult` applies a ship outcome other than `review-no-verdict`, it shall settle the review pool request without a hold (complete it, or mark it lost when the ship timed out), set no pool `resetAt` and journal no `REVIEW_HOLD`, whatever quota message the ship receipt carries.
  - R2. WHEN a `review-no-verdict` ship outcome carries a quota message, the pool hold and the `wait` on `review-quota` of T0-SHIP-QUOTA-WAIT-3 shall stay unchanged.
acceptance:
  - 1. A `merged` ship whose receipt exits 0 with `warning: 429 Too Many Requests` on stderr closes the card, leaves its pool request `completed` and the pool without `resetAt`, journals no `REVIEW_HOLD`, and a second card in the same pool ships on its next `card next`, also after the clock passes 15 minutes (tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 2. A `ci-red` ship whose receipt carries `[CI-GATE-RED]` and `API rate limit exceeded` in the CI log leaves its pool request `completed` and the pool without `resetAt`, and journals no `REVIEW_HOLD` (tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 3. The T0-SHIP-QUOTA-WAIT-3 acceptance 1 and 2 tests pass unchanged: a `review-no-verdict` ship outcome with `429 Too Many Requests` on stderr still holds the pool and waits on `review-quota` (tests/scenarios/t0-flow.test.ts). [R2] [dod arm 1]
  - 4. `docs/OPERATIONS.md` states that only a `review-no-verdict` ship outcome holds the review pool; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [dod arm 1]
depends_on: [T0-SHIP-QUOTA-WAIT-3]
budget: 120
tdd: true
sweep: "grep -n \"quota-hold\\|queue.hold\\|REVIEW_HOLD\" src/loop/card-runner.ts; grep -n \"exitCode === 0\" src/delivery/ship.ts: card-runner.ts applyShipResult classifies the whole ship receipt (classifyVerdict with rawOutput quotaOutput(result.receipt)) and, on quota-hold, calls queue.hold and journals REVIEW_HOLD before the switch on result.outcome, for every outcome (card-runner.ts:2175-2177 on main 35c67b7); ship.ts classifyShipOutput maps every exit-0 receipt without a saga failure to merged, so a real review-no-verdict exits non-zero and a merged receipt's stderr is read alone."
forbid: [treating a quota hold as a pass, dropping or shortening the review-no-verdict hold, a retry or decision consumed by a quota hold, changing quota detection]
non_goals: [the quota patterns and the stream rule (T0-QUOTA-FALSE-HOLD-2), the 15-minute default hold, the review-no-verdict WAIT (T0-SHIP-QUOTA-WAIT-3), recovering a pool that already holds a running request of a closed card, the command-run R2 and R3 paths]
diagnosis:
  root_cause: "applyShipResult holds the review pool whenever the ship receipt classifies as quota-hold, whatever the ship outcome, and the receipt is the output of the whole ship command (git, gh, the CI gate log), not only the reviewer's. A merged ship with a quota word on stderr leaves its pool request in retry-after and the pool resetAt 15 minutes ahead; once the hold passes, the pool admits that request of a closed card as running and nothing completes it. Evidence (scratch run on the T0-SHIP-QUOTA-WAIT candidate 484571e, maxConcurrent 1): card A merged with 'warning: 429 Too Many Requests from api.github.com, retried' on stderr; card B in the same pool waited on review-pool:default:reset-pending, at +16 min on review-pool:default:admitted with A's request running, and at +76 min on review-pool:default:busy, with no ship issued."
  same_class: "A ci-red receipt whose CI log names 'API rate limit exceeded' holds the pool and journals REVIEW_HOLD the same way (same scratch run). The command-run R2 and R3 paths classify the reviewer's own receipt and are not affected."
hygiene: "Found while running T0-SHIP-QUOTA-WAIT. Run the mutation sweep over the new branch before the first review (docs/LESSONS.md 2026-09-24)."
doc_sync: docs/OPERATIONS.md (quota hold paragraph), CHANGELOG.md
---

# T0-SHIP-HOLD-OUTCOME

## Deliverable
A quota word in the receipt of a ship that merged, or whose CI gate failed, no longer holds the shared review pool; only a `review-no-verdict` ship outcome does, so a closed card's request can never occupy the pool slot.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
