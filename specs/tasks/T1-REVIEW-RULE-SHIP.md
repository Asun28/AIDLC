---
id: T1-REVIEW-RULE-SHIP
title: "The ruling that settles the last merge-blocking finding of the stopping R3 decision lifts the card's stop, and the candidate that decision reviewed ships as passed by ruling with no further review"
status: todo
branch: T1-REVIEW-RULE-SHIP
worktree: D:\wt\AIDLC\T1-REVIEW-RULE-SHIP
plan_ref: plans/review-ruling.md#order-of-work
allow_paths:
  - src/core/types.ts
  - src/core/review-policy.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/scenarios/review-rule-ship.test.ts
  - tests/scenarios/review-rule.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T1-REVIEW-RULE-SHIP.md
dod_command: npm run typecheck && node --test tests/scenarios/review-rule-ship.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. WHEN a ruling of `aidlc review rule` leaves no unruled finding among the non-advisory, unresolved findings of the stopping decision, THEN the same locked update shall set `stopLifted` (`at`, `by`) on the stopping invocation, append one invocation with `outcome` `pass`, `ruled` true, reviewer `ruling:<by>` and the candidate digest and sha of the stopping invocation, clear the run's `stop` and set its state to SHIP.
  - R2. The lift shall leave `substantiveDecisions`, `substantiveBlocks`, `noVerdictRetriesUsed`, the receipts and the deadline as they were.
  - R3. The runner shall not read an invocation that carries `stopLifted` as a recorded stop.
  - R4. WHEN the last formal decision on the current candidate is a ruled pass, THEN `formalReviewGate` shall admit the ship with no review directive and no second pass.
  - R5. The canonical review document of a ruled pass shall be a `pass` for the candidate sha that lists each ruled finding under `advisory` with its decision, `by` and reason.
  - R6. The lifting update shall record as owed in `journalOwed`, beside the ruling's `FINDING_RULED`, one `REVIEW_DECIDED` event with outcome `pass`, `ruled` true, `by` and the ids of the ruled findings of the stopping decision, and the command shall then append it; a failed append is delivered once by the next `aidlc card next`.
  - R7. The command's output after a lift shall name `aidlc card next <card>` and, when the card deadline has passed, `aidlc goal extend`.
  - R8. `docs/OPERATIONS.md` (Review, STOP reasons), `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state R1 to R7.
acceptance:
  - 1. `tests/scenarios/review-rule-ship.test.ts`, on a run a command reviewer stopped at R3 decision 4 with two findings. The first ruling leaves the run in STOP with no `stopLifted`. The second sets `stopLifted`, appends the ruled pass with the stopping invocation's digest and sha, clears `stop` and sets SHIP; `substantiveDecisions`, `substantiveBlocks`, `noVerdictRetriesUsed`, the DoD receipt, the RED receipt and the deadline equal their values before. [R1] [R2] [dod arm 1]
  - 2. Same file. `aidlc card next` then returns the ship of the unchanged candidate, never a `review` or `stop` directive, with `formalReview.secondPass` on; the dry-run ship merges it. [R3] [R4] [dod arm 1]
  - 3. Same file. The same holds for a run stopped at decision 2 by a re-raise of a disputed finding, where the stopping decision holds one finding. [R1] [R3] [dod arm 1]
  - 4. Same file. The canonical document under `.review/` is a `pass` with the candidate sha, and its `advisory` holds one entry per ruled finding with the decision, `by` and the reason. [R5] [dod arm 1]
  - 5. Same file. The journal gains, after the last `FINDING_RULED`, exactly one `REVIEW_DECIDED` with outcome `pass`, `ruled` true, `by` and both finding ids. Fault rows: a throw from `fs.renameSync` onto the card-run record at the lifting ruling leaves the card-run file and the journal byte-identical; a throw from `fs.appendFileSync` onto the goal journal at each of the two appends leaves the lift in the run, and after two `aidlc card next` calls the journal holds exactly one `FINDING_RULED` for that ruling and exactly one `REVIEW_DECIDED` with `ruled` true. [R6] [dod arm 1]
  - 6. Same file. The CLI reads the real clock, so the run's deadline is set by the test: with a deadline fixed in the past the output of the lifting ruling names `aidlc goal extend`, and `aidlc card next` stops for `time`; with a deadline fixed far in the future the output names `aidlc card next` and not `aidlc goal extend`. [R7] [dod arm 1]
  - 7. Same file. After the lift, a new candidate (a commit on the branch) gets no ship from the ruled pass: `aidlc card next` does not return a ship directive for it. [R4] [dod arm 1]
  - 8. `tests/scenarios/second-pass.test.ts` and `tests/scenarios/fault-points.test.ts` pass unchanged. `tests/scenarios/review-rule.test.ts` passes and changes only where this card changes what it expects: its assertions that the run stays stopped and keeps every other field hold after a ruling that leaves another finding of the stopping decision unruled, and its rows that rule the last finding expect the lift; no other assertion of it is removed. The record of `.claude/skills/verify-card-run-writes/SKILL.md` names the lift's write, its two appends and the test file that holds their fault rows. [dod arm 1] [dod arm 2]
  - 9. The docs and CHANGELOG state R1 to R7 (reviewer-verified against the diff). [R8]
depends_on: [T1-REVIEW-RULE-2]
budget: 400
size_exception: "approved by the owner (asun28) in the session of 2026-11-13, in reply to the stop report of T1-REVIEW-RULE (option a: budgets of 400 for the two unstarted cards of the plan): the predecessor of T1-REVIEW-RULE-2 was planned at 250 and came to 370 changed lines, about 100 in src/ and about 215 of scenario tests with their fault rows; this card has the same shape, about 110 lines in src/ (the lift, the two stop readers, the gate, the canonical document) and about 240 of tests"
sweep: "git grep -n stopReview -- src on main at 3548e757: src/loop/card-runner.ts:667 and :1764 are the two readers R3 changes. git grep -n secondPassDue -- src/loop/card-runner.ts: the definition :1674 changes for R4; the callers :1535, :1557, :1602, :1848 and :1919 are read. `formalReviewGate` :1547 with `lastFormalInvocation` :1682 admits a pass at :1554; `repairCanonical` :2031 and `publishCanonical` :2015 write the document of R5. Not sites of this card: the ship-path reviewer (:2700 to :2900), the gate stop at :1595, the pre-review gate (:1486), `recordReviewOutcome` (src/core/review-policy.ts:126)."
forbid: [weakening or skipping a test to go green, changing a review counter, a new R3 decision or a second pass on a ruled candidate, moving a deadline, a change to REVIEW.md, a change to tests/scenarios/fault-points.test.ts or tests/scenarios/journal-owed.test.ts, editing .aidlc state by hand]
non_goals: [a goal that is in STOP or terminal (T1-REVIEW-RULE-GOAL), a `CARD_STATE` event for the lift (the `REVIEW_DECIDED` of R6 records it), the lift among the commands tests/scenarios/fault-points.test.ts drives (its fault rows are in its own test file, as for `withdrawCandidate`), a ruling that grants a repair round, lifting a stop for review that has no `stopReview` invocation, a ruled pass for a candidate other than the one the stopping decision reviewed (it needs its own R3 and stops by the existing allowance rule), the ship-path reviewer, the stop narration and the instruction line (T1-REVIEW-RULE-GOAL), review statistics, a change to `card-loop.md`]
hygiene: "Line numbers are from main at 3548e757; read them again at PREPARE. tests/scenarios/review-rule.test.ts (card T1-REVIEW-RULE-2) rules both findings of its stopping decision and then asserts the same stop (about :184 and :232 on main at f5deb21b); under R1 the second ruling lifts the stop, so those assertions move to the state after the first ruling, as acceptance 8 says, and R6 of T1-REVIEW-RULE-2 then holds for a ruling that does not lift. Put `ruled` and `by` in the persisted event data, not in `extra`, which is lost on recovery (docs/LESSONS.md, T0-REVIEW-CANDIDATE-PINS). This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (Review, STOP reasons), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-REVIEW-RULE-SHIP

## Deliverable
When the owner has ruled on every merge-blocking finding of the decision that stopped a card, the card is in progress again and its reviewed candidate ships.

## Why
`specs/review-ruling.md`: a stop for review ends in a replacement card today, because the machine returns a persisted stop first and reads `stopReview` on every call. This card makes the rulings of T1-REVIEW-RULE-2 the decision that ends the stop.

## Rules that decide edge cases
- The lift happens in the update that records the last ruling, never on a later call.
- The ruled pass is not a reviewer decision: no counter moves, and it stands only for the candidate digest of the stopping invocation.
- A finding the owner wants repaired stays unruled, so the stop stays.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/review-rule-ship.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: every test of the four files passes and the typecheck reports no error.

## Attempt evidence
Attempt 1. Tests named below are in `tests/scenarios/review-rule-ship.test.ts` unless a file is given; "DoD" is the `dod_command`, exit 0, 54 tests passed and 0 failed (5, 3, 18 and 28 by file).

| Item | Proof | Result |
|---|---|---|
| RED | commit 28c53b4e holds the test file alone; all 5 tests failed on main's behaviour, the first at `:124` with `stopLifted` absent from the stopping invocation, tests 2 and 3 on an output that does not name `aidlc card next`, tests 4 and 5 on state `STOP` where `SHIP` is expected. The file later gained a fault helper and rows for an advisory finding, a resolved finding, `review r3` by hand and the `blocker` field | failed for the missing lift |
| 1 | test "acceptance 1, 2, 4 and 5": decision 4, findings F4 and F5; the first ruling leaves `state`, `stop` and `review` equal; the second is compared field by field | pass |
| 2 | same test and "acceptance 3 and 6": `card next` returns `close` after one dry-run ship of the unchanged sha, 0 reviewer runs after the stop, `formalReview.secondPass` on; `review r3` by hand is refused | pass |
| 3 | test "acceptance 3 and 6": decision 2, re-raise of the disputed F1, one ruling through the CLI | pass |
| 4 | test "acceptance 1, 2, 4 and 5": `.review/T1-RS.json` compared with literal `advisory` entries | pass |
| 5 | test "acceptance 1, 2, 4 and 5" (the event) and test "acceptance 5, fault rows" (`fs.renameSync`, then `fs.appendFileSync` on `FINDING_RULED` and on `REVIEW_DECIDED`, two `card next` each) | pass |
| 6 | tests "acceptance 3 and 6" (deadline 2999) and "acceptance 6" (deadline 2000, CLI `card next` stops for `time`) | pass |
| 7 | test "acceptance 7": the stored candidate is set to sha-3, since the fixture has no git branch to commit on; `card next` stops for review and nothing ships | pass |
| 8 | DoD: `second-pass.test.ts` and `fault-points.test.ts` unchanged and passing; `review-rule.test.ts` passes with the changes listed in the attempt report. The skill record is not changed: see below | not met for the record |
| 9 | `docs/OPERATIONS.md` (Findings and dispositions, STOP reasons), `docs/ARCHITECTURE.md`, `CHANGELOG.md` | reviewer-verified |

Acceptance 8, the record of `.claude/skills/verify-card-run-writes/SKILL.md`: the file is 7999 bytes and `tests/surface/templates.test.ts` caps it at 8000. Naming the lift's write, its two appends and `tests/scenarios/review-rule-ship.test.ts` adds at least 70 bytes to the `CardRunner.ruleFinding` entry, the only text of the file this plan owns, so it cannot be added without removing text about another command or raising the cap in a test file outside `allow_paths`. Left for a ruling. The fault rows themselves exist (item 5), and the check of that skill passes (28 of 28): the lift adds no write to a command the check drives.
