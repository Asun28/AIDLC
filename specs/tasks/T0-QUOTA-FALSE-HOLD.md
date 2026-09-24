---
id: T0-QUOTA-FALSE-HOLD
title: A reviewer that exits 0 without a readable verdict is a no-verdict round, not a quota hold, when its own reasoning text happens to contain a quota word, and the quota patterns match whole words only
status: todo
branch: T0-QUOTA-FALSE-HOLD
worktree: D:\wt\AIDLC\T0-QUOTA-FALSE-HOLD
allow_paths:
  - src/core/review-policy.ts
  - src/review/pre-review.ts
  - src/loop/card-runner.ts
  - tests/core/review-policy.test.ts
  - tests/surface/pre-review.test.ts
  - tests/scenarios/t0-flow.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-QUOTA-FALSE-HOLD.md
dod_command: npm run typecheck && node --test tests/core/review-policy.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts
dod_exit: 0
requirements:
  - R1. `detectQuotaHold` shall match each quota pattern as a whole word or phrase, so `Quotation`, `4290` or a hex sha containing `429` never hold, while `quota`, `Quota exceeded`, `429 Too Many Requests`, `rate limit`, `rate-limited`, `usage limit`, `retry after 30 seconds`, `overloaded` and `capacity` still hold (`quotas` included, since a provider may write the plural).
  - R2. WHEN a reviewer process exits 0 without timing out and no verdict is read, `classifyPreReview` shall look for a quota hold in stderr only and otherwise return no-verdict (`malformed` or `no_output`); WHEN the process exits non-zero, it shall scan stdout and stderr as before.
  - R3. WHEN the ship path classifies a verdict (`CardRunner.applyShipResult`), the raw output passed to `classifyVerdict` shall follow the R2 rule: stderr only for a process that exited 0, stdout and stderr otherwise.
acceptance:
  - 1. `detectQuotaHold` returns no hold for `Quotation marks around pass need escape`, `commit 1429abf` and `4290 lines`, and a hold for each holding phrase R1 lists (tests/core/review-policy.test.ts, one table-driven test with a case per phrase). [R1] [dod arm 1]
  - 2. `classifyPreReview(undefined, { exitCode: 0, timedOut: false, stdout, stderr: '' })` where stdout is reviewer reasoning containing `Quotation marks` and `quota hold` followed by a verdict JSON cut before its last brace returns `{ outcome: 'no-verdict', runStatus: 'malformed' }`; the same call with stderr `429 Too Many Requests, retry after 30 seconds` returns `quota-hold` with `retryAfterMs` 30000; an exit 1 with the quota text on stdout still returns `quota-hold` (tests/surface/pre-review.test.ts). [R2] [dod arm 1]
  - 3. A ship result whose receipt exits 0 with no verdict and `quota` in its stdout is classified no-verdict and consumes the no-verdict retry, not a quota hold; the same receipt with the quota text on stderr is held (tests/scenarios/t0-flow.test.ts). [R3] [dod arm 1]
  - 4. `docs/OPERATIONS.md` (the quota hold paragraph) states that a reviewer which exits 0 is held only on a stderr quota message and that the patterns match whole words; CHANGELOG.md Unreleased carries the entry under this card id; a test reads the exact sentences this card adds and fails with any one removed. [R1] [R2] [R3] [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "grep -rn 'detectQuotaHold\\|rawOutput' src/: detectQuotaHold at review-policy.ts:39 with QUOTA_PATTERNS at :37; callers classifyVerdict at review-policy.ts:91 (fed rawOutput only by card-runner.ts:2105, the ship path) and classifyPreReview at pre-review.ts:693, which also serves R3 through runReviewPanel and classifyFormal (card-runner.ts:1640). No test fixture reports a quota message on stdout with exit 0 (grep tests/ for quota, 429, rate limit with exitCode 0)."
forbid: [weakening the fail-closed verdict rule, treating a quota hold as a pass, a round consumed by a real quota hold, changing the retry-after parsing]
non_goals: [provider-specific quota detection, reading quota state from an API, changing QUOTA_PATTERNS beyond word boundaries, the no-verdict retry allowance]
diagnosis:
  root_cause: "classifyPreReview scans stdout and stderr for QUOTA_PATTERNS whenever no verdict is read, whatever the exit code. On T1-REVIEW-LOOP-GUARDS R2 cycle 0 round 1 the edge-cases reviewer (deepseek-v4-pro) exited 0, printed a verdict JSON missing its final brace, and its reasoning line 812 contained 'Quotation marks', which /quota/i matches; the round was recorded as a quota hold and the card waited 15 minutes instead of retrying a no-verdict round (evidence: _local/evidence/T1-REVIEW-LOOP-GUARDS/T1-REVIEW-LOOP-GUARDS.pre.0.1.1.ec9f6177.edge-cases.log)."
  same_class: "classifyVerdict on the ship path receives the same stdout-plus-stderr raw output (card-runner.ts:2105); R3 through runReviewPanel reaches classifyPreReview, so R2 covers it. No other reader of reviewer output looks for quota text (sweep)."
hygiene: "Follow-up from goal g-20260924103834-4b1732. Run the mutation sweep over every added branch and the word-boundary regexes before the first review (docs/LESSONS.md 2026-09-24 and 2026-09-25)."
doc_sync: docs/OPERATIONS.md (quota hold paragraph), CHANGELOG.md
---

# T0-QUOTA-FALSE-HOLD

## Deliverable
A reviewer that exits 0 with no readable verdict is a no-verdict round even when its reasoning mentions a quota word, and the quota patterns match whole words, so `Quotation` or a sha containing `429` never holds a card. A real quota message on stderr, or on any stream of a process that exited non-zero, still holds.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/review-policy.test.ts tests/surface/pre-review.test.ts tests/scenarios/t0-flow.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
