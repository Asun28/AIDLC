---
id: T0-R2-BILLING-HOLD
title: A reviewer that answers HTTP 402 Insufficient Balance or Payment Required is held (WAIT, the billing word named, no round or no-verdict retry spent) instead of a tool_error no-verdict round (issue #92)
status: merged
branch: T0-R2-BILLING-HOLD
worktree: D:\wt\AIDLC\T0-R2-BILLING-HOLD
allow_paths:
  - src/core/parse-guard.ts
  - tests/core/parse-guard.test.ts
  - tests/scenarios/r2-billing-hold.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-R2-BILLING-HOLD.md
dod_command: npm run typecheck && node --test tests/core/parse-guard.test.ts tests/scenarios/r2-billing-hold.test.ts
dod_exit: 0
requirements:
  - R1. The word rule of `detectQuotaHold` (`src/core/parse-guard.ts`) shall hold on `insufficient balance` (and `insufficient balances`) and `payment required`, in any letter case and after the separators split the text (`INSUFFICIENT_BALANCE`, `insufficientBalance`, `PaymentRequired`, `payment-required`), under the same whole-word rule as every other quota word, and name the word as matched (`via text: Insufficient Balance`). A bare `402` and a status of 402 do not hold.
  - R2. An R2 round whose reviewer exits non-zero with the DeepSeek CLI's `ERROR 402: {"error":{"message":"Insufficient Balance (request_id: ...)", ...}}` shall be a `quota-hold` with the reason `via text: Insufficient Balance`: the gate parks the card in WAIT on `pre-review-quota`, consumes no round, and leaves the no-verdict retry unspent, so a no-verdict run after the hold still gets its retry. No file outside `src/core/parse-guard.ts` changes.
  - R3. `docs/OPERATIONS.md` (the quota paragraph) and the CHANGELOG Unreleased section shall state R1 and R2.
acceptance:
  - 1. `tests/core/parse-guard.test.ts`: `detectQuotaHold` holds via text on `Insufficient Balance`, `insufficient balance`, `INSUFFICIENT BALANCE`, `INSUFFICIENT_BALANCE`, `insufficientBalance`, `InsufficientBalance`, `insufficient-balance`, `insufficient balances`, `Payment Required`, `payment_required`, `PaymentRequired`, `payment-required` and `HTTP 402 Payment Required`, naming each word as matched after the split; it does not hold on `402`, `Error 402`, `sufficient balance`, `insufficient balancé`, `xinsufficient balance`, `insufficient balance2`, `payment requiredé`, `payments required` or `balance insufficient`, and status 402 is `{ hold: false, via: 'structured', evidence: 'status 402' }`. [R1] [dod arm 1]
  - 2. The same file: the three round-3 receipts of issue #92 (exit 1, stderr the DeepSeek 402 line with its request id) are read by `classifyPreReview` as `quota-hold` / `tool_error` with reasons `['via text: Insufficient Balance']` and no retry delay; before this card they read as `no-verdict` / `tool_error`. [R2] [dod arm 1]
  - 3. `tests/scenarios/r2-billing-hold.test.ts`: a card whose pre-reviewer exits 1 with that stderr records a `quota-hold` round; the next gate is WAIT on `pre-review-quota` with no round consumed; after the hold the gate asks for the same round with no retry note; a no-verdict run then gets the retry (a `pre-review` directive, not a stop), and the run carries no `no-verdict` round from the hold. [R2] [dod arm 1]
  - 4. `tests/core/parse-guard.test.ts` reads the exact sentence this card adds to `docs/OPERATIONS.md` and the exact CHANGELOG Unreleased entry, and fails with either removed. [R3] [dod arm 1]
depends_on: []
budget: 160
tdd: true
sweep: "grep -n 'QUOTA\\|status === 429' src/core/parse-guard.ts; grep -n 'detectQuotaHold' src -r: parse-guard.ts:12 QUOTA holds on rate-limit, quota, usage-limit, 429, retry-after, too-many-requests, capacity and overloaded, and the structured path on 429 and 529; classifyPreReview (src/review/pre-review.ts:703-705) checks the hold before the exit code, so a receipt the word rule holds becomes quota-hold with no pre-review.ts change, and the card-runner gate (:1151, :1983) already parks a held round in WAIT with no round consumed. The other callers of the word rule (review-policy.ts:76 for R3, the claude-code and claude-api providers when no status is given, the ship path) hold on the same words from this card on. Issue #92 round-3 receipts: request ids 1d3badb9-fdf0-4164-998c-5e841344d9ab, 85406a0c-3ea7-43fb-869c-89f032df1c09, e1f8c686-3ba1-4d72-bbba-204d56dbd462."
forbid: [editing src/loop/card-runner.ts or src/core/review-policy.ts (the T1-STORE-CAS line; the existing hold path is enough), editing src/delivery/github-ship.ts, holding on a bare 402 or on status 402, a change to the retry-after rule or to the 429 and 529 status rule]
non_goals: ["a status of 402 from a provider that reports one: the T1-PARSE-GUARD rule that only 429 and 529 hold stays", "other billing phrasings (for example an Anthropic credit-balance message): not seen on a reviewer here yet", "a hold narration or duration of its own for a billing state: the gate keeps the quota wording and the 15-minute default, and the reasons name the billing word", "the preReview fallback reviewer: the next card, T0-R2-FALLBACK"]
hygiene: "Filed from issue #92, card (A) of the ruling by the coordinating session: a billing state becomes a hold through the word rule alone. Mutation sweep and doc-sentence tests before the first review (docs/LESSONS.md 2026-09-24); a self-test case per spelling the rule accepts or refuses (docs/LESSONS.md 2026-09-24 T1-OPUS55-PROMPTS, 2026-09-25 T0-QUOTA-FALSE-HOLD-2)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-R2-BILLING-HOLD

## Deliverable
A reviewer whose account has no balance no longer costs a card its no-verdict retry: the R2 round is a quota hold that names `Insufficient Balance`, the card waits, and the round and the retry are still there once the account answers again.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/parse-guard.test.ts tests/scenarios/r2-billing-hold.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
