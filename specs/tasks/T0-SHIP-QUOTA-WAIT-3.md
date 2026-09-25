---
id: T0-SHIP-QUOTA-WAIT-3
title: A quota hold the ship path reads on a review-no-verdict ship outcome is WAIT until the hold passes, not STOP/review, and spends no retry or decision (second replacement of T0-SHIP-QUOTA-WAIT: the R2 no-verdict allowance of T0-SHIP-QUOTA-WAIT and T0-SHIP-QUOTA-WAIT-2 was each spent on reviewer outputs whose verdict line sat inside an unclosed code fence, which T0-R2-ANSWER-MARKER fixes)
status: merged
branch: T0-SHIP-QUOTA-WAIT-3
worktree: D:\wt\AIDLC\T0-SHIP-QUOTA-WAIT-3
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/review-block.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-SHIP-QUOTA-WAIT-3.md
dod_command: npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts
dod_exit: 0
requirements:
  - R1. WHEN `CardRunner.applyShipResult` records a quota-hold decision (`wait-quota`) for a `review-no-verdict` ship outcome, it shall return a `wait` directive on `review-quota` until the review-pool hold it set passes, keep the card out of STOP, and spend neither the no-verdict retry nor a substantive decision.
  - R2. WHEN that hold has passed, `aidlc card next` shall issue the ship again for the same candidate, within the card deadline.
acceptance:
  - 1. A ship result `review-no-verdict` whose receipt exits 0 with `429 Too Many Requests` on stderr returns `wait` on `review-quota`, the run is not STOP, `noVerdictRetriesUsed` and `substantiveDecisions` stay 0, and a `REVIEW_HOLD` is journaled (tests/scenarios/t0-flow.test.ts). [R1] [dod arm 1]
  - 2. After the clock passes the hold, `card next` issues the ship again for the same candidate, observed at the ship path's dispatch (candidate sha, no stop, no retry or decision spent), since `card next` dispatches the ship within that call and returns the directive of its result, not a `ship` directive; a second ship that merges closes the card (tests/scenarios/t0-flow.test.ts). [R2] [dod arm 1]
  - 3. A `review-no-verdict` ship outcome with no quota message still takes the single retry and then STOP/review, as in review-block.test.ts Q6 (unchanged). [R1] [dod arm 1]
  - 4. `docs/OPERATIONS.md` states that a ship-path quota hold is WAIT on `review-quota`; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [dod arm 1]
depends_on: [T0-QUOTA-FALSE-HOLD-2, T0-R2-ANSWER-MARKER]
budget: 150
tdd: true
sweep: "grep -n \"review-no-verdict\\|wait-quota\" src/loop/card-runner.ts src/delivery/ship.ts: ship.ts:73 maps the R3 sentinels ([R3-REVIEWER-TIMEOUT], [R3-NO-OUTPUT], [R3-BAD-VERDICT-JSON], ...) to review-no-verdict; card-runner.ts:2143 records the ship-path decision (classifyVerdict with quotaOutput); card-runner.ts:2176 holds the review pool for 15 minutes on quota-hold; card-runner.ts:2273-2277 the review-no-verdict case returns ship only on retry-review and STOP/review ('missing/malformed/stale verdict after the single retry') on any other decision, wait-quota included. The command-run R3 path (card-runner.ts:1197) already waits on review-quota."
forbid: [treating a quota hold as a pass, a decision or a retry consumed by a quota hold, extending the card deadline]
non_goals: [the command-run R3 and R2 quota paths, quota detection (T0-QUOTA-FALSE-HOLD-2), the 15-minute default hold]
diagnosis:
  root_cause: "applyShipResult switches on the ship outcome, not on the ledger decision: a review-no-verdict outcome goes to STOP/review unless the decision is retry-review, so a verified quota hold (decision wait-quota) stops the card with a no-verdict message, although the review policy makes a quota hold WAIT (evidence: T0-QUOTA-FALSE-HOLD acceptance 3, the stderr exit-0 case returned stop 'missing/malformed/stale verdict after the single retry')."
  same_class: "review-blocked with a quota-hold decision cannot occur (a hold carries no verdict). The command-run R3 (card-runner.ts:1197) and R2 (card-runner.ts:1140) paths already wait."
hygiene: "Found while running T0-QUOTA-FALSE-HOLD; the ship path is the scaffold/GitHub R3 reviewer path used when formalReview.command is empty. Run the mutation sweep over the new branch before the first review (docs/LESSONS.md 2026-09-24). Replacement of T0-SHIP-QUOTA-WAIT (goal g-20260925101837-61f56b): R2 cycle 0 round 1 (edge-cases) and round 2 (ac-coverage) each ended on a pass verdict line inside a code fence the reviewer reasoning left open, which the reader takes as malformed, and the retry of round 1 blocked on the acceptance 2 wording amended in PR #47. The candidate carries over, merged with main. Second replacement: T0-SHIP-QUOTA-WAIT-2 R2 cycle 0 round 1 (ac-coverage) and its retry (spec-deviations) each lost an angle the same way on f9e262a, while every angle returned pass on that candidate in one of the two runs; its R2 runs after T0-R2-ANSWER-MARKER, which reads the DeepSeek answer after `=== answer ===`."
doc_sync: docs/OPERATIONS.md (quota hold paragraph), CHANGELOG.md
---

# T0-SHIP-QUOTA-WAIT-3

## Deliverable
A verified quota hold on the ship path parks the card in WAIT on `review-quota` until the review-pool hold passes, then ships again; it no longer stops the card for review with a no-verdict message.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/t0-flow.test.ts tests/scenarios/review-block.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
