---
id: T0-CLI-LIMIT-HOLD
title: The quota word rule holds on the Claude CLI model-limit message "You've hit your <name> limit", so a reviewer at its limit is a quota hold where it was a tool_error no-verdict round (issue 385)
status: todo
branch: T0-CLI-LIMIT-HOLD
worktree: D:\wt\AIDLC\T0-CLI-LIMIT-HOLD
allow_paths:
  - src/core/parse-guard.ts
  - tests/core/parse-guard.test.ts
  - tests/core/review-policy.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-CLI-LIMIT-HOLD.md
  - specs/tasks/T0-CLI-LIMIT-HOLD.md
dod_command: npm run typecheck && node --test tests/core/parse-guard.test.ts tests/core/review-policy.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. The `QUOTA` pattern of src/core/parse-guard.ts shall also match the phrase `hit your` followed by one to three words and then `limit` or `limits`, in any letter case, as a whole phrase under the boundary rule the other words keep (no letter or digit of any script directly before `hit` or after `limit`/`limits`). A word here is a run of letters, digits, `.` or `-`. So `You've hit your Fable limit`, `You've hit your Opus limit`, `you've hit your weekly limit`, `You have hit your session limit` and `You've hit your Claude Opus 5.5 limit` hold, and the evidence is the matched phrase (for the first: `hit your Fable limit`).
  - R2. The phrase shall not hold when more than three words stand between `hit your` and `limit`, when `limit` is joined to a following letter or digit (`limitless`), or when the text has `hit` without `your` before the words (`hit the limit`). `detectQuotaHold` with a numeric status still decides from the status alone.
  - R3. The receipt of issue 385 - exit code 1, the exact stdout `You've hit your Fable limit · resets 1pm (Pacific/Auckland). Switch to another model, or manage usage credits at https://claude.ai/settings/usage?from=cc_cli_limit_message, to continue.` and an empty stderr - shall read through `detectQuotaHold(quotaOutput(receipt))` as `{ hold: true, via: 'text', evidence: 'hit your Fable limit' }` with no `retryAfterMs`, and `classifyReviewOutcome` given that receipt and no verdict shall return outcome `quota-hold` with `via text: hit your Fable limit` in its reasons. The same stdout from a process that exited 0 does not hold (the stream rule of `quotaOutput` stays as on main).
  - R4. src/core/parse-guard.ts shall stay at most 30 lines (the existing test), and docs/OPERATIONS.md, in the paragraph that lists the quota patterns, names the new phrase and the issue 385 receipt.
acceptance:
  - "1. tests/core/parse-guard.test.ts: the five R1 messages hold with the matched phrase as evidence [R1]; the three R2 texts do not hold [R2]."
  - "2. tests/core/parse-guard.test.ts: the exact issue 385 receipt holds via text with evidence `hit your Fable limit` and no retry delay; the same stdout with exit code 0 and empty stderr does not hold [R3]."
  - "3. tests/core/review-policy.test.ts: `classifyReviewOutcome` with no verdict and the issue 385 receipt returns `quota-hold`, `tool_error`, and the reason `via text: hit your Fable limit` [R3]."
  - "4. tests/core/parse-guard.test.ts: docs/OPERATIONS.md names `hit your <name> limit` and issue 385 [R4]; the existing 30-line test stays green [R4]."
depends_on: []
budget: 120
tdd: true
sweep: "Main at cca9b399. `detectQuotaHold` is called from src/core/review-policy.ts:93 (R3 and ship classification) and src/review/pre-review.ts:973 (R2/R3 command reviews and the bench panel); both pass `quotaOutput(receipt)`, so one change to `QUOTA` covers both. The one-module test (tests/core/parse-guard.test.ts, acceptance 8 of T1-PARSE-GUARD) forbids a quota pattern elsewhere in src/."
forbid:
  - a quota pattern in any src/ file other than src/core/parse-guard.ts
  - changing `quotaOutput`, the status rule or the `RETRY` pattern
non_goals:
  - "Reading the reset time of the message (`resets 1pm (Pacific/Auckland)`) as a retry delay. It is a wall-clock time in a named zone, not a delay, and `detectQuotaHold` takes no clock; the hold waits the pool's default hold. Follow-up issue."
  - "Codex CLI limit messages: none is captured in this repository's review logs, so no text is invented for a test. The `usage limit` word already in `QUOTA` is the form to check when one is captured."
  - "DeepSeek: `ERROR 402: ... Insufficient Balance` already holds (T0-R2-BILLING-HOLD, issue 92)."
diagnosis:
  root_cause: "`QUOTA` (src/core/parse-guard.ts:15) lists rate limit, quota, usage limit, 429, retry after, too many requests, capacity, overloaded and two billing phrases. The Claude CLI prints `You've hit your <model> limit · resets ...` on stdout with exit 1 when a model limit is reached, which contains none of them (`usage` appears only inside the URL, not followed by `limit`). `detectQuotaHold` therefore returned `hold: false`, and the review was recorded as a `tool_error` no-verdict, spending the cycle's one no-verdict retry instead of waiting through the review pool. Reproduced at cca9b399 with a scratch script calling `detectQuotaHold(quotaOutput({ exitCode: 1, stdout, stderr: '' }))` on the exact issue text: `{\"hold\":false,\"via\":\"text\"}`; the Opus, session and weekly forms gave the same."
  same_class: "Every reviewer and provider that reports a limit in prose without a listed word. Captured receipts: Claude CLI (this card), DeepSeek (already held, issue 92). Codex: none captured (non_goals)."
hygiene: "Issue 385. Tests first: one commit adds the acceptance 1 to 3 tests with src/ as on main (RED: the five R1 rows, the acceptance 2 hold row and acceptance 3 fail; the R2 rows and the exit-0 row pass), then the change to `QUOTA`, the OPERATIONS.md sentence, the acceptance 4 test and the fragment. Revert table before the first review: the new alternative removed (acceptance 1 hold rows, 2 and 3 red); the word count unbounded (the four-word R2 row red); the trailing boundary dropped (`limitless` row red). Two receipts with this text are in the main checkout under .review/bench/ (T0-BENCH-DRAFTS-IGNORE-2 and T0-BOARD-OWNER-WAIT bench-formal logs)."
doc_sync: changelog.d/T0-CLI-LIMIT-HOLD.md
---

# T0-CLI-LIMIT-HOLD

## Deliverable
The quota word rule holds on `hit your <one to three words> limit`, so a Claude CLI reviewer that prints "You've hit your Fable limit" (or Opus, session, weekly) with a non-zero exit is a quota hold that waits through the review pool, where it was a `tool_error` no-verdict round that spent the no-verdict retry.

## Why
Issue 385: 18 reviews of a bench panel run ended on this message as `no-verdict` / `tool_error`. The R3 fallback of this repository is `claude -p --model claude-opus-5-5`, so an Opus limit on the fallback has the same effect on a card's review cycle.
