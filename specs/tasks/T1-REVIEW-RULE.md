---
id: T1-REVIEW-RULE
title: "`aidlc review rule` records the owner's ruling (rejected or deferred) on a merge-blocking finding of the R3 decision that stopped a card, and changes nothing else"
status: todo
branch: T1-REVIEW-RULE
worktree: D:\wt\AIDLC\T1-REVIEW-RULE
plan_ref: plans/review-ruling.md#order-of-work
allow_paths:
  - src/core/types.ts
  - src/core/review-policy.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/review-rule.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T1-REVIEW-RULE.md
dod_command: npm run typecheck && node --test tests/scenarios/review-rule.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `aidlc review rule <cardId> <findingId>` shall take exactly one of `--reject` and `--defer`, a non-blank `--by <who>`, a non-blank `--reason <text>`, an optional `--goal <id>`, and `--issue <n>` (digits only, above 0) only with `--defer`.
  - R2. WHEN the card run is in STOP with stop reason `review`, a formal invocation of the run carries `stopReview`, the run's candidate digest equals that of the latest such invocation, and the finding is one that decision raised or re-raised (`findingsOfCandidate`) that is not advisory, not resolved and not ruled, THEN the command shall set the finding's `ruling` to `at`, `by`, `decision` (`rejected` for `--reject`, `deferred` for `--defer`), `reason` and, when given, `issue`, and raise the finding's `revision` by 1, in one locked update of the card run.
  - R3. After that update the command shall append one `FINDING_RULED` journal event carrying the card id, the finding id and the ruling.
  - R4. IF a condition of R1 or R2 does not hold, THEN the command shall exit non-zero with a message that names the condition and write neither the card run nor the journal.
  - R5. A ruling shall leave every other field of the card run as it was (state, stop, review ledger, receipts, deadline, the finding's disposition).
  - R6. `docs/OPERATIONS.md` and `CHANGELOG.md` shall state the command, its conditions and that it lifts no stop.
acceptance:
  - 1. `tests/scenarios/review-rule.test.ts`, on a run a command reviewer stopped at R3 with two findings in the stopping decision. `--reject` on the first sets `ruling.decision` to `rejected` with `by`, `reason` and the fixed clock's `at`, and raises `revision` by 1; `--defer --issue 12` on the second sets `deferred` and `issue` 12; the finding id is accepted in lower case. [R1] [R2] [dod arm 1]
  - 2. Same file. After each ruling the journal holds one more event, of type `FINDING_RULED`, with the card id, the finding id and the ruling. [R3] [dod arm 1]
  - 3. Same file, one table. Each row exits non-zero, names its condition and leaves the card-run file and the journal byte-identical. Rows are neither flag; both flags; blank `--by`; blank `--reason`; `--issue` with `--reject`; `--issue 0`; `--issue 1.5`; an unknown finding id; a finding already ruled; a resolved finding; an advisory finding; a finding of an earlier decision that the stopping decision did not re-raise; a run in REVIEW_FIX; a run stopped for `time`; a run whose candidate digest differs from the stopping decision's. [R1] [R2] [R4] [dod arm 1]
  - 4. Same file. After both rulings the card run equals the run before them except for the two findings' `ruling` and `revision`, and `aidlc card next` returns the same stop. [R5] [dod arm 1]
  - 5. `tests/scenarios/fault-points.test.ts` passes, with the new write and the new journal append in its coverage as the verify-card-run-writes skill requires. [dod arm 2]
  - 6. The docs and CHANGELOG state R1 to R5 (reviewer-verified against the diff). [R6]
depends_on: []
budget: 250
sweep: "git grep -n stopReview -- src on main at 3548e757: src/core/review-policy.ts:137, :169, :170 (written, not changed here), src/core/types.ts:340 (the field), src/loop/card-runner.ts:667 and :1764 (read by the machine, not changed here). The finding record is `ReviewFinding` at src/core/types.ts:503; `disputeFinding` (src/core/review-policy.ts:527) and its runner and CLI wiring (src/cli/main.ts:998) are the pattern for the new function, method and command. `FINDING_DISPUTED` at src/core/types.ts:1039 is the pattern for the event type."
forbid: [weakening or skipping a test to go green, clearing or changing a stop, changing a review counter or an invocation, a change to REVIEW.md, editing .aidlc state by hand]
non_goals: [lifting the stop or shipping the candidate (T1-REVIEW-RULE-SHIP), a goal that is in STOP or terminal (refused by the existing rule for card commands until T1-REVIEW-RULE-GOAL), a ruling on a run that is not stopped for review (refused), a ruling on a stop for review without `stopReview` such as no verdict after the retry (refused), withdrawing or changing a ruling (refused as already ruled), printing the ruling in `aidlc review findings` (T1-REVIEW-RULE-GOAL), creating a GitHub issue, a check of who typed the command, a change to `card-loop.md`]
hygiene: "Line numbers are from main at 3548e757; read them again at PREPARE. This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (Review), CHANGELOG.md
---

# T1-REVIEW-RULE

## Deliverable
The owner's decision on a finding is a record on that finding, written by one command, for a card that R3 stopped.

## Why
`specs/review-ruling.md`: 81 of 109 recorded stops are for review, and a ruling today is text in a replacement card. This card adds the record and nothing else, so it cannot ship anything. T1-REVIEW-RULE-SHIP lifts the stop.

## Rules that decide edge cases
- The stopping decision is the latest formal invocation with `stopReview`. Its findings are those `findingsOfCandidate(findings, 'formal', <its candidateSha>)` returns.
- `--reject` means the finding does not hold. `--defer` means it holds and is left to follow-up work.
- A ruling does not change `disposition`: a disputed finding that is ruled stays disputed, with its ruling.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-rule.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every test of both files passes and the typecheck reports no error.
## Attempt evidence
| Item | Proof | Result |
|---|---|---|
| 1 | `node --test tests/scenarios/review-rule.test.ts`: the CLI rules `f2 --defer --issue 12`; `CardRunner.ruleFinding` rules `f1` as rejected, with `at` equal to the fixture clock. The CLI has no clock to inject, so its `at` is checked for ISO form only. | pass |
| 2 | Same test: one more journal event after each ruling, `FINDING_RULED` with the card id, the finding id and the ruling. | pass |
| 3 | Same test, one table of 16 rows through the CLI: the 15 rows of the item and a run with no `stopReview`; each exits 1, names its condition and leaves both files byte-identical. | pass |
| 4 | Same test: the stored run after both rulings deep-equals the run before, apart from the two findings' `ruling` and `revision` and the run's own `revision` and `updatedAt`, which every store write moves; `aidlc card next` returns the same stop directive. | pass |
| 5 | `node --test tests/scenarios/fault-points.test.ts` passes. `allow_paths` does not list that file, so the check does not drive the command; the skill's coverage record names `CardRunner.ruleFinding`, its write and its append under Not covered. | pass, with that limit |
| 6 | `docs/OPERATIONS.md`, Findings and dispositions, paragraph Rulings; `CHANGELOG.md`, entry T1-REVIEW-RULE (reviewer-verified against the diff). | written |
