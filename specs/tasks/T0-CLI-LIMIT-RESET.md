---
id: T0-CLI-LIMIT-RESET
title: A review held on the Claude CLI limit message waits until the reset time it names ("resets 1pm (Pacific/Auckland)"), where it waited the 15-minute default (issue 394)
status: todo
branch: T0-CLI-LIMIT-RESET
worktree: D:\wt\AIDLC\T0-CLI-LIMIT-RESET
allow_paths:
  - src/core/limit-reset.ts
  - src/review/pre-review.ts
  - tests/core/limit-reset.test.ts
  - tests/surface/pre-review-limit-reset.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-CLI-LIMIT-RESET.md
  - specs/tasks/T0-CLI-LIMIT-RESET.md
dod_command: npm run typecheck && node --test tests/core/limit-reset.test.ts tests/surface/pre-review-limit-reset.test.ts tests/core/parse-guard.test.ts tests/core/review-policy.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. A new pure module src/core/limit-reset.ts shall export `limitResetMs(text: string, nowIso: string): number | undefined`. It reads the first `resets <h>[:<mm>]<am|pm> (<zone>)` in `text`, in any letter case, where `<h>` is 1 to 12, `<mm>` is two digits 00 to 59, and `<zone>` is an IANA time zone name, and returns the milliseconds from `nowIso` to the first instant after `nowIso` at which the wall clock of `<zone>` reads that time. `12am` is midnight and `12pm` is noon. When that wall time does not occur on the day (a daylight-saving gap), the instant is the end of the gap. It reads no clock of its own and does no I/O.
  - R2. `limitResetMs` shall return `undefined` when `text` has no such phrase, when the zone is not a time zone the runtime knows, when the phrase has no zone in parentheses, or when the hour or minutes are out of range (`13pm`, `0am`, `1:60pm`). It never throws.
  - R3. `finalizeReview` (src/review/pre-review.ts) shall set `retryAfterMs` of a `quota-hold` classification that has none to `limitResetMs(quotaOutput(receipt), receipt.finishedAt)`. A delay already read from `retry after <n>` stays as it is, and a receipt that is not a quota hold gets no delay. `detectQuotaHold`, `classifyPreReview` and src/core/parse-guard.ts stay as on main.
  - R4. docs/OPERATIONS.md, in the paragraph that lists the quota patterns, shall replace the sentence saying the reset time is not read with one that names the `resets <time> (<zone>)` form, the 15-minute default when it is absent or unreadable, and issue 394, and docs/ARCHITECTURE.md, Module map, names src/core/limit-reset.ts.
acceptance:
  - "1. tests/core/limit-reset.test.ts: `resets 1pm (Pacific/Auckland)` at 2026-11-20T09:56:00.000Z returns 50640000 (next day 13:00 NZDT is 2026-11-21T00:00:00Z); at 2026-11-20T23:30:00.000Z returns 1800000; `RESETS 1:30PM (Pacific/Auckland)` at 2026-11-20T23:30:00.000Z returns 3600000; `resets 12am (UTC)` at 2026-11-20T23:00:00.000Z returns 3600000 and `resets 12pm (UTC)` at the same instant returns 46800000; at exactly the reset instant the next day's reset is returned (86400000 for a zone with no change that day) [R1]."
  - "2. tests/core/limit-reset.test.ts: across the Pacific/Auckland daylight-saving start (2026-09-27 02:00 NZST to 03:00 NZDT), `resets 4am` at 2026-09-26T12:00:00.000Z returns 10800000 and `resets 2am` at the same instant returns 7200000 (the end of the gap) [R1]."
  - "3. tests/core/limit-reset.test.ts: `resets 1pm` with no zone, `resets 1pm (Mars/Olympus)`, `resets 13pm (UTC)`, `resets 0am (UTC)`, `resets 1:60pm (UTC)`, `resets Nov 25` and a text with no `resets` return `undefined` and do not throw [R2]."
  - "4. tests/surface/pre-review-limit-reset.test.ts: `finalizeReview` on the exact issue 385 stdout, exit code 1, empty stderr and finishedAt 2026-11-20T09:56:00.000Z returns outcome `quota-hold` with `retryAfterMs` 50640000; the same text with `retry after 30 seconds` appended keeps 30000; a quota hold with no reset phrase keeps no delay; the issue 385 stdout from a process that exited 0 is not a hold and has no delay [R3]."
  - "5. tests/surface/pre-review-limit-reset.test.ts: docs/OPERATIONS.md names `resets <time> (<zone>)` and issue 394 in the quota paragraph and no longer says the reset time is not read; docs/ARCHITECTURE.md names `limit-reset.ts` [R4]. The existing parse-guard and review-policy tests stay green unchanged [R3]."
depends_on: []
budget: 120
tdd: true
sweep: "Main at db5f9499. The quota hold delay is set in two places: `detectQuotaHold` (src/core/parse-guard.ts, reads only `retry after <n>`, no clock, file capped at 30 lines by tests/core/parse-guard.test.ts) and the provider SDK status path (src/providers/claude-api.ts, not a CLI). Every command review (R2 panel angles, R3, the bench) reaches a hold through `finalizeReview` (src/review/pre-review.ts:1052), which has the full `ExecReceipt` with `finishedAt`; card-runner.ts:2297, 2456 and 2869 turn `retryAfterMs` into `holdUntil` with the 15-minute default. `classifyVerdict` (src/core/review-policy.ts:93) carries no delay and is not changed."
forbid:
  - a quota word pattern in src/core/limit-reset.ts (the one-module test of tests/core/parse-guard.test.ts)
  - changing src/core/parse-guard.ts, `classifyPreReview` or the 15-minute default in src/loop/card-runner.ts
  - reading the process clock (`Date.now()`, `new Date()` with no argument) in src/core/limit-reset.ts
non_goals:
  - "Date forms such as `resets Nov 25` or `resets Nov 25, 1pm (zone)`: no receipt with one is captured in this repository (the only captured form, in .review/ logs and D:\\wt\\AIDLC, is `resets 1pm (Pacific/Auckland)`), so no text is invented for a test. Follow-up issue when one is captured."
  - "24-hour forms (`resets 13:00`) and a reset with no zone read in the host's zone: not captured, and the host zone is not the CLI's."
  - "A ceiling on the delay: a time-only reset is at most 24 hours away by construction."
  - "The `claude-code` provider path (src/providers/claude-code.ts) reports only a boolean hold and no delay; unchanged."
diagnosis:
  root_cause: "After T0-CLI-LIMIT-HOLD, `You've hit your Fable limit · resets 1pm (Pacific/Auckland). ...` is a quota hold, but `detectQuotaHold` reads a delay only from `retry after <n> <unit>` (src/core/parse-guard.ts, `RETRY`) and takes no clock, so `classifyPreReview` returns `retryAfterMs: undefined` (asserted by tests/core/parse-guard.test.ts:253) and card-runner.ts:2297/2869 hold for `15 * 60 * 1000`. A limit that resets hours later re-dispatches the review every 15 minutes until then, each run spending a reviewer invocation."
  same_class: "Any reviewer that names its reset as a wall-clock time rather than a delay. Captured: Claude CLI (this card). Codex: none captured."
hygiene: "Issue 394, follow-up of issue 385. Tests first: one commit adds tests/core/limit-reset.test.ts and tests/surface/pre-review-limit-reset.test.ts with src/ as on main (RED: the module does not exist, and the finalizeReview delay row reads undefined), then the module, the one-line wiring in `finalizeReview`, the doc sentences and the fragment. Revert table before the first review: the DST handling replaced by a fixed offset (acceptance 2 red); the strict-after rule changed to at-or-after (the exact-instant row red); the `retry after` precedence dropped (the 30000 row red)."
doc_sync: changelog.d/T0-CLI-LIMIT-RESET.md
---

# T0-CLI-LIMIT-RESET

## Deliverable
A review held on the Claude CLI limit message waits until the reset time the message names, read in the named IANA zone against the receipt's `finishedAt`, where it waited 15 minutes and re-dispatched the review every 15 minutes until the limit reset.

## Why
Issue 394: `resets 1pm (Pacific/Auckland)` printed at 22:56 local means a 14-hour wait; with the 15-minute default that is about 56 reviewer invocations, each a no-op hold, before the review can run.

## Attempt evidence

Attempt 1, base main at 69ef6b6f. RED commit 55971fe3 (tests only, src/ as on main): tests/core/limit-reset.test.ts fails to load (no src/core/limit-reset.ts); in tests/surface/pre-review-limit-reset.test.ts the finalizeReview row reads `retryAfterMs: undefined` for 50640000 and the docs row finds no `resets <time> (<zone>)`.

| Item | Proof | Result |
|---|---|---|
| 1 | tests/core/limit-reset.test.ts "the next instant the named zone reads the reset time, strictly after now; ..." | pass |
| 2 | tests/core/limit-reset.test.ts "across the Pacific/Auckland daylight-saving start ..." (4am, 2am, 2:30am in the gap, 1am before it) | pass |
| 3 | tests/core/limit-reset.test.ts "no zone, an unknown zone, an hour or minutes out of range, a date form or no phrase ..." | pass |
| 4 | tests/surface/pre-review-limit-reset.test.ts "finalizeReview reads the reset time against the receipt finishedAt; ..." | pass |
| 5 | tests/surface/pre-review-limit-reset.test.ts "docs/OPERATIONS.md names the reset form ..."; tests/core/parse-guard.test.ts and tests/core/review-policy.test.ts unchanged and green | pass |

Revert table, each run on the two new files and restored: offsets a day either side replaced by the day-before offset alone (a fixed offset): 1 test red (acceptance 2); `at > now` changed to `at >= now`: 1 test red (the exact-instant row); the `retryAfterMs === undefined` condition dropped from `finalizeReview`: 1 test red (the 30000 row).

Other suites that run `finalizeReview` or carry quota holds, run once on Windows: pre-review, r2-pass-notes, review-bench (5 files), r2-billing-hold, r2-fallback: 189 tests, 189 pass.

DoD (Windows): `npm run typecheck` clean; `node --test tests/core/limit-reset.test.ts tests/surface/pre-review-limit-reset.test.ts tests/core/parse-guard.test.ts tests/core/review-policy.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts`: 113 tests, 113 pass, 0 fail.

Attempt 2 (repair of R3 decision 1, F1 class skipped-fold-occurrence, F2 class non-iana-reset-zone). F1: a time a daylight-saving end repeats has two exact candidates; the earliest strictly after now decides, and when both have passed the next day does, where attempt 1 took the first exact candidate and, when it had passed, skipped to the next day. A time with no exact candidate is still the end of the gap. F2: the zone in `RESET` must open with a letter and has no `:` (`[A-Za-z][\w+-]*(?:/[\w+-]+)*`), so a numeric offset Intl accepts (`+05:00`, `-0800`, `+05`) reads no delay.

Input forms the repair handles, in tests/core/limit-reset.test.ts: `resets 2:30am (Pacific/Auckland)` across the 2026-04-05 fall-back with the first occurrence ahead (30 min), between the two (45 min, F1) and at the second (24 h); `resets 1pm (<zone>)` for `+05:00`, `-0800`, `+05`, `05:00`, `UTC+5`, `GMT+05:00` (no delay, F2) and `Etc/GMT-5` (8 h, an IANA name). On the attempt 1 code (8d7c5e5e) the between-occurrences row and the numeric-offset rows fail; all pass now.

| Item | Proof | Result |
|---|---|---|
| 1 | as attempt 1, plus "across the Pacific/Auckland daylight-saving end a time that occurs twice ..." | pass |
| 2 | as attempt 1 | pass |
| 3 | as attempt 1, plus "a numeric offset or other non-IANA zone text reads no delay ..." | pass |
| 4 | as attempt 1 | pass |
| 5 | as attempt 1 | pass |

DoD (Windows): typecheck clean; 115 tests, 115 pass, 0 fail.
