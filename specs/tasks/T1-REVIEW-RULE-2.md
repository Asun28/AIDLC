---
id: T1-REVIEW-RULE-2
title: "(replaces T1-REVIEW-RULE) `aidlc review rule` records the owner's ruling (rejected or deferred) on a merge-blocking finding of the R3 decision that stopped a card, and lifts no stop"
status: todo
branch: T1-REVIEW-RULE-2
worktree: D:\wt\AIDLC\T1-REVIEW-RULE-2
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
  - specs/tasks/T1-REVIEW-RULE-2.md
dod_command: npm run typecheck && node --test tests/scenarios/review-rule.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `aidlc review rule <cardId> <findingId>` shall take exactly one of `--reject` and `--defer`, a non-blank `--by <who>`, a non-blank `--reason <text>`, an optional `--goal <id>`, and `--issue <n>` (digits only, above 0) only with `--defer`.
  - R2. WHEN the card run is in STOP with stop reason `review`, a formal invocation of the run carries `stopReview`, the run's candidate digest equals that of the latest such invocation, and the finding is one that decision raised or re-raised (`findingsOfCandidate`) that is not advisory, not resolved and not ruled, THEN the command shall set the finding's `ruling` to `at`, `by`, `decision` (`rejected` for `--reject`, `deferred` for `--defer`), `reason` and, when given, `issue`, and raise the finding's `revision` by 1, in one locked update of the card run.
  - R3. That update shall record one `FINDING_RULED` event (the card id, the finding id, the ruling) as owed in the run's `journalOwed`, and the command shall then append it to the goal journal.
  - R4. IF that append fails, THEN the ruling shall stand and the next `aidlc card next` of the card shall append the owed event, so the journal holds exactly one `FINDING_RULED` per ruling.
  - R5. IF a condition of R1 or R2 does not hold, THEN the command shall exit non-zero with a message that names the condition and write neither the card run nor the journal.
  - R6. A ruling shall change, in the card run, only the ruled finding's `ruling` and `revision` and the run's `revision`, `updatedAt` and `journalOwed`.
  - R7. `docs/OPERATIONS.md` and `CHANGELOG.md` shall state the command, its conditions, the owed event and that it lifts no stop.
acceptance:
  - 1. `tests/scenarios/review-rule.test.ts`, on a run a command reviewer stopped at R3 with two findings in the stopping decision. Through the CLI, `--reject` on one persists `ruling.decision` `rejected` with `by`, `reason` and an ISO `at`, and `--defer --issue 12` on the other persists `deferred` and `issue` 12; each raises the finding's `revision` by 1; a finding id in lower case is accepted. Through `CardRunner.ruleFinding`, `at` equals the fixture's fixed clock. [R1] [R2] [dod arm 1]
  - 2. Same file. After each ruling the journal holds one more event, of type `FINDING_RULED`, with the card id, the finding id and the ruling. [R3] [dod arm 1]
  - 3. Same file, one table. Each row exits non-zero, names its condition and leaves the card-run file and the journal byte-identical. Rows are neither flag; both flags; blank `--by`; blank `--reason`; `--issue` with `--reject`; `--issue 0`; `--issue 1.5`; an unknown finding id; a finding already ruled; a resolved finding; an advisory finding; a finding of an earlier decision that the stopping decision did not re-raise; a run in REVIEW_FIX; a run stopped for `time`; a run stopped for `review` with no invocation that carries `stopReview`; a run whose candidate digest differs from the stopping decision's. [R1] [R2] [R5] [dod arm 1]
  - 4. Same file. On a run record with `stopReview` on two invocations of different candidates with different findings, and a later invocation without it, the finding of the later stopping invocation is ruled and the finding of the earlier one is refused. [R2] [dod arm 1]
  - 5. Same file. After two rulings the run's `revision` is 2 higher, its `updatedAt` is an ISO timestamp later than before, its `journalOwed` holds the latest ruling's event, each ruled finding differs only in `ruling` and `revision`, and every other field of the run equals its value before; `aidlc card next` returns the same stop. [R6] [dod arm 1]
  - 6. Same file, fault rows. A throw from `fs.renameSync` onto the card-run record leaves the card-run file and the journal byte-identical. A throw from `fs.appendFileSync` onto the goal journal leaves the ruling in the run with its event owed, and after two `aidlc card next` calls the journal holds exactly one `FINDING_RULED` for it. [R3] [R4] [dod arm 1]
  - 7. `tests/scenarios/fault-points.test.ts` passes unchanged, and the record of `.claude/skills/verify-card-run-writes/SKILL.md` names `CardRunner.ruleFinding`, its write, its append and the test file that holds its fault rows. [dod arm 2]
  - 8. The docs and CHANGELOG state R1 to R6 (reviewer-verified against the diff). [R7]
depends_on: []
budget: 400
size_exception: "approved by the owner (asun28) in the session of 2026-11-13, in reply to the stop report of T1-REVIEW-RULE (option a: a replacement card with the same code, the two acceptance items restated, budget 400): the carried candidate 5caa0970 is 370 changed lines, about 100 of them in src/ (types, the pure rule, the runner method, the command) and about 215 in tests/scenarios/review-rule.test.ts (the refusal table of 16 rows, the stopping-decision row and the two fault rows that R3 decision 1 of the predecessor asked for); the first budget of 250 was the planner's underestimate of the tests"
sweep: "git grep -n stopReview -- src on main at 3548e757: src/core/review-policy.ts:137, :169, :170 (written, not changed here), src/core/types.ts:340 (the field), src/loop/card-runner.ts:667 and :1764 (read by the machine, not changed here). The finding record is `ReviewFinding` at src/core/types.ts:503; `disputeFinding` (src/core/review-policy.ts:527) and its runner and CLI wiring (src/cli/main.ts:998) are the pattern for the function, method and command. `FINDING_DISPUTED` at src/core/types.ts:1039 is the pattern for the event type; `OwedEvent` at src/core/types.ts:825 and `deliverOwed` in src/loop/card-runner.ts are the owed-event pattern of card T0-JOURNAL-FAULT-EVENTS."
forbid: [weakening or skipping a test to go green, clearing or changing a stop, changing a review counter or an invocation, a change to REVIEW.md, a change to tests/scenarios/fault-points.test.ts or tests/scenarios/journal-owed.test.ts, editing .aidlc state by hand]
non_goals: [lifting the stop or shipping the candidate (T1-REVIEW-RULE-SHIP), a goal that is in STOP or terminal (refused by the existing rule for card commands until T1-REVIEW-RULE-GOAL), a ruling on a run that is not stopped for review (refused), withdrawing or changing a ruling (refused as already ruled), a rerun of the command delivering an owed event (`aidlc card next` does), `ruleFinding` among the commands tests/scenarios/fault-points.test.ts drives (its fault rows are in its own test file, as for `withdrawCandidate`), `FINDING_RULED` inside the list sentence of docs/OPERATIONS.md that tests/scenarios/journal-owed.test.ts pins whole (a sentence after it names the event), a lease fence on the command (a stopped card's lease has usually expired), printing the ruling in `aidlc review findings` (T1-REVIEW-RULE-GOAL), creating a GitHub issue, a check of who typed the command, a change to `card-loop.md`]
hygiene: "This card replaces T1-REVIEW-RULE by the owner's ruling of 2026-11-13 and carries its candidate 5caa0970 unchanged. The predecessor stopped at R3 decision 2: the three code findings of decision 1 were repaired and not re-raised, and the two re-raised findings (F1, F4) were contradictions in its card, which this card restates as acceptance 5 to 7, R3, R4 and R6. Against the predecessor's diff only the card files differ: the Attempt evidence moves to this file and specs/tasks/T1-REVIEW-RULE.md returns to its text on main. The RED receipt is the predecessor's commit 6c9cf72a, which the branch holds. This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (Review), CHANGELOG.md
---

# T1-REVIEW-RULE-2

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
The three tests of `tests/scenarios/review-rule.test.ts` are named here by their first words: test A "acceptance 1, 2, 3 and 5", test B "acceptance 1, 2 and 6", test C "acceptance 4".

| Item | Proof | Result |
|---|---|---|
| 1 | `node --test tests/scenarios/review-rule.test.ts`. Through the CLI: test B rules `F1 --reject` (persisted `decision` `rejected`, `by`, `reason`, no `issue`, an ISO `at`, `revision` 1 higher); test A rules `f2 --defer --issue 12`, the id in lower case (persisted `deferred`, `issue` 12, an ISO `at`, `revision` 1 higher). Through `CardRunner.ruleFinding`: test A rules `f1` as rejected with `at` equal to the fixture clock, `2026-09-11T01:00:00.000Z`. | pass |
| 2 | Tests A and B: one more journal event after each ruling, `FINDING_RULED` with the card id, the finding id, the ruling and the `eventKey` of its owed entry. | pass |
| 3 | Test A, one table of 16 rows through the CLI, the rows of the item in its order; each exits 1, names its condition and leaves the card-run file and the journal byte-identical. | pass |
| 4 | Test C, on a run record with `stopReview` on the invocations of `sha-a` and `sha-b` and a later invocation on `sha-c` without it: F2 of `sha-b` is ruled, F1 of `sha-a` and F3 of `sha-c` are refused, and a candidate digest other than that of `sha-b` is refused. | pass |
| 5 | Test A, nothing substituted before the comparison: the run's `revision` is 2 higher, `updatedAt` is an ISO timestamp later than before, `journalOwed` holds the delivered event of the latest ruling, every other field of the run is equal, each ruled finding differs only in `ruling` and `revision`, and the unruled F3 is equal; `aidlc card next` returns the same stop directive. | pass |
| 6 | Test B, fault rows. A throw from `fs.renameSync` onto the card-run record: `ruleFinding` throws and both files are byte-identical. A throw from `fs.appendFileSync` onto the `FINDING_RULED` line of the goal journal: the ruling is in the run with its event in `journalOwed`, a rerun is refused as already ruled, and after each of two `card next` calls (`CardRunner.next`) the journal holds exactly one `FINDING_RULED` for it, marked `completed: true`. | pass |
| 7 | `node --test tests/scenarios/fault-points.test.ts` passes (1 suite, 28 subtests); `git diff main -- tests/scenarios/fault-points.test.ts` prints nothing. `.claude/skills/verify-card-run-writes/SKILL.md`, under the card-run commands the check does not drive, names `CardRunner.ruleFinding`, the write, the owed `FINDING_RULED` append and `tests/scenarios/review-rule.test.ts`. | pass |
| 8 | `docs/OPERATIONS.md`, Findings and dispositions, paragraph Rulings, and the sentence after the list of owed events in Audit; `CHANGELOG.md`, entry T1-REVIEW-RULE-2 (reviewer-verified against the diff). | written |
| RED receipt | Commit 6c9cf72a of the predecessor T1-REVIEW-RULE, which this branch holds (corrected by fac78152). | held |
| DoD | `npm run typecheck && node --test tests/scenarios/review-rule.test.ts tests/scenarios/fault-points.test.ts`: exit 0, tests 31, pass 31, fail 0. | pass |

Changes of this card against the predecessor's candidate 5caa0970: two assertions on the CLI `--reject` ruling of test B (an ISO `at`, `revision` 1 higher), the test names and comments renumbered to this card, the card name in the docs, the CHANGELOG entry and the source comments, and the card files.

Findings of the predecessor's R3 decision 1, by this card's numbering:
- F1: fault rows for the write and the append are in `tests/scenarios/review-rule.test.ts` (test B, item 6); the skill record points to them (item 7).
- F2: a successful `--reject` through the CLI, asserting the persisted decision and the event (test B, item 1).
- F3: a hand-built run with stops on two candidates and a later invocation without one (test C, item 4); taking the first stop or the last invocation each fails it.
- F4: was disputed; R6 and acceptance 5 of this card now state the fields a ruling changes, and test A compares the rest with nothing substituted.
- F5: the update owes `FINDING_RULED` in `journalOwed` and `deliverOwed` appends it; `card next` delivers one a failed append left (R3, R4, item 6).
