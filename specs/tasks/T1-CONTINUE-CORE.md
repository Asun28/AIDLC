---
id: T1-CONTINUE-CORE
title: "A card run holds its continuations, a pure rule says what a continuation of a review stop requires and changes, and the ledger decision compares with the admitted count"
status: todo
branch: T1-CONTINUE-CORE
worktree: D:\wt\AIDLC\T1-CONTINUE-CORE
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/core/types.ts
  - src/core/continuation.ts
  - src/core/review-policy.ts
  - tests/core/continuation.test.ts
  - tests/core/review-policy.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T1-CONTINUE-CORE.md
  - specs/tasks/T1-CONTINUE-CORE.md
dod_command: npm run typecheck && node --test tests/core/continuation.test.ts tests/core/review-policy.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The `CardRun` schema shall hold `continuations`, an array that defaults to empty, of entries with `at`, `by`, `reason`, `stop` (the `reason`, `detail` and `at` of the lifted stop, the reason being `review` or `ci`) and the optional whole numbers `decisions` and `admits`.
  - R2. The function `continueReviewStop` of `src/core/continuation.ts` shall return, for a run in STOP with stop reason `review` and an act with `at`, `by`, `reason` and an optional `decisions`, the continuation entry and the review ledger in which each invocation that has `stopReview` and no `stopLifted` carries `stopLifted` (`at`, `by`), with `decisions` 1 when absent and `admits` equal to `review.substantiveDecisions` plus `decisions`.
  - R3. IF the run is not in STOP, its stop reason is not `review`, the caller states that the formal reviewer is not a command, `review.noVerdictRetriesUsed` is above `MAX_NO_VERDICT_RETRIES`, `by` or `reason` is blank after trimming, or `decisions` is not a whole number from 1 to 4, THEN the function shall throw an error that names the cause and leave its arguments as they were.
  - R4. The function `admittedDecisions` shall return the `admits` of the last entry of `continuations` whose stop reason is `review`, and undefined when there is none.
  - R5. WHEN `recordReviewOutcome` is given an admitted count and records a command reviewer's merge-blocking block, the decision shall be `stop-review` with a detail that holds the word `continuation` and the count when `substantiveDecisions` is at or above the count, and `review-fix` with `remainingDecisions` equal to the count minus `substantiveDecisions` otherwise.
  - R6. The re-raise rule of a command reviewer and every decision of a ship-path reviewer shall be the same with an admitted count as without one.
  - R7. WHEN no admitted count is given, `recordReviewOutcome` shall decide as it does on main at f51534d2.
  - R8. The files `docs/ARCHITECTURE.md` and `changelog.d/T1-CONTINUE-CORE.md` shall state R1 to R6.
acceptance:
  - 1. `tests/core/continuation.test.ts`, three runs built with `cardRun`. (a) STOP for review with a block on decision 4 that carries `stopReview`. (b) STOP for review with a re-raise stop on decision 2 and an earlier invocation whose stop a ruling lifted. (c) STOP for review made by the gate, with no `stopReview` on any invocation. In each the entry holds the act, the lifted stop and `admits`; in (a) and (b) each unlifted `stopReview` invocation gains `stopLifted` and the lifted one keeps its own; in (c) the ledger is deep-equal to the input's. `decisions` absent gives `admits` one above the decisions, `decisions` 3 gives three above. [R2] [dod arm 2]
  - 2. Same file. One row per cause of R3 (state BUILD; stop reasons `ci`, `time` and `card`; not a command reviewer; `noVerdictRetriesUsed` 2; blank `by`; blank `reason`; `decisions` 0, 5, 1.5 and NaN): each throws a message that names its cause, and the run passed in is deep-equal to its copy taken before the call. [R3] [dod arm 2]
  - 3. Same file. `CardRun.parse` of a record without `continuations` gives an empty array and a record with one entry round-trips. `admittedDecisions` returns the `admits` of the later of two review entries when an entry with stop reason `ci` follows them, and undefined for an empty array and for an array with only a `ci` entry. [R1] [R4] [dod arm 2]
  - 4. `tests/core/review-policy.test.ts`. With an admitted count of 5 and four decisions recorded, a command reviewer's block on decision 5 is `stop-review`, its detail holds `continuation` and `5`, and the recorded invocation carries that detail as `stopReview`. With a count of 6 the same block is `review-fix` with `remainingDecisions` 1. With a count of 3 a block on decision 3 is `stop-review`. [R5] [dod arm 2]
  - 5. Same file. With an admitted count, a block on decision 2 that re-raises a disputed finding is `stop-review` with the re-raise detail, and a ship-path block (no `repeated`) decides as without the count. Every test the file holds on main passes with no line of it changed. [R6] [R7] [dod arm 2]
  - 6. The typecheck passes, and `tests/scenarios/review-rule-ship.test.ts` and `tests/scenarios/fault-points.test.ts` pass unchanged. [R7] [dod arm 1] [dod arm 2]
  - 7. The docs state R1 to R6 (reviewer-verified against the diff). [R8]
depends_on: []
budget: 150
sweep: "git grep -n MAX_R3_DECISIONS -- src/core on main at f51534d2: src/core/review-policy.ts:202, :203 and :205 are the command reviewer's cap that R5 changes; :207 to :211 are the ship-path branch, unchanged. git grep -n 'recordReviewOutcome(' -- src: the definition at src/core/review-policy.ts:127 and two callers, src/loop/card-runner.ts:2593 and :3018, which pass no admitted count in this card. git grep -n stopLifted -- src: src/core/review-policy.ts:646 to :666 (the ruling's lift, unchanged) and the schema at src/core/types.ts:346."
forbid: [weakening or skipping a test to go green, changing an allowance constant, editing .aidlc state by hand]
non_goals: [the runner's act and every reader of the allowance under src/loop (T1-CONTINUE-REVIEW), a command (T1-CONTINUE-GOAL), the rule for a ci stop (T1-CONTINUE-CI), a journal event, the `amendments` and `contract` fields (T1-CARD-CONTRACT)]
hygiene: "Line numbers are from main at f51534d2; read them again at PREPARE. The schema gains a field with a default, so every parsed run holds it: run `npm test` once before the attempt is recorded, because a test outside the DoD may compare a whole run record."
doc_sync: docs/ARCHITECTURE.md
---

# T1-CONTINUE-CORE

## Deliverable
The record and the pure rule of a continuation of a review stop, and a ledger decision that compares with the count the continuation admits. No caller uses them yet.

## Why
`specs/card-continuation.md`, R1 to R5: a run stopped for review goes on today only by a ruling that ships the candidate as it is, or by a successor card. The owner decided on 2026-11-22 that a recorded act admits a stated number of further R3 decisions on the same card.

## Rules that decide edge cases
- The admitted count replaces the four-decision cap in both directions: a count of 3 stops a block on decision 3.
- The function changes no counter and no finding. It returns values and the caller writes them.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/continuation.test.ts tests/core/review-policy.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck reports no error and every test of the four files passes.
