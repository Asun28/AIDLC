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
  - R6. After the lift the command shall append a `REVIEW_DECIDED` event with outcome `pass`, `ruled` true, `by` and the ruled finding ids, and a `CARD_STATE` event from `STOP` to `readmitted` whose reason names the ruling and `by`.
  - R7. The command's output after a lift shall name `aidlc card next <card>` and, when the card deadline has passed, `aidlc goal extend`.
  - R8. `docs/OPERATIONS.md` (Review, STOP reasons), `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state R1 to R7.
acceptance:
  - 1. `tests/scenarios/review-rule-ship.test.ts`, on a run a command reviewer stopped at R3 decision 4 with two findings. The first ruling leaves the run in STOP with no `stopLifted`. The second sets `stopLifted`, appends the ruled pass with the stopping invocation's digest and sha, clears `stop` and sets SHIP; the three counters, the DoD receipt and the deadline are unchanged. [R1] [R2] [dod arm 1]
  - 2. Same file. `aidlc card next` then returns the ship of the unchanged candidate, never a `review` or `stop` directive, with `formalReview.secondPass` on; the dry-run ship merges it. [R3] [R4] [dod arm 1]
  - 3. Same file. The same holds for a run stopped at decision 2 by a re-raise of a disputed finding, where the stopping decision holds one finding. [R1] [R3] [dod arm 1]
  - 4. Same file. The canonical document under `.review/` is a `pass` with the candidate sha, and its `advisory` holds one entry per ruled finding with the decision, `by` and the reason. [R5] [dod arm 1]
  - 5. Same file. The journal gains, after the last `FINDING_RULED`, one `REVIEW_DECIDED` with `ruled` true and both finding ids, and one `CARD_STATE` from `STOP` to `readmitted`. [R6] [dod arm 1]
  - 6. Same file. With the fixed clock past the card deadline the output names `aidlc goal extend`, and `aidlc card next` stops for `time`; with the clock before it the output names only `aidlc card next`. [R7] [dod arm 1]
  - 7. Same file. After the lift, a new candidate (a commit on the branch) gets no ship from the ruled pass: `aidlc card next` does not return a ship directive for it. [R4] [dod arm 1]
  - 8. `tests/scenarios/review-rule.test.ts` and `tests/scenarios/second-pass.test.ts` pass unchanged, and `tests/scenarios/fault-points.test.ts` passes with the lift's writes in its coverage. [dod arm 1] [dod arm 2]
  - 9. The docs and CHANGELOG state R1 to R7 (reviewer-verified against the diff). [R8]
depends_on: [T1-REVIEW-RULE]
budget: 250
sweep: "git grep -n stopReview -- src on main at 3548e757: src/loop/card-runner.ts:667 and :1764 are the two readers R3 changes. git grep -n secondPassDue -- src/loop/card-runner.ts: the definition :1674 changes for R4; the callers :1535, :1557, :1602, :1848 and :1919 are read. `formalReviewGate` :1547 with `lastFormalInvocation` :1682 admits a pass at :1554; `repairCanonical` :2031 and `publishCanonical` :2015 write the document of R5. Not sites of this card: the ship-path reviewer (:2700 to :2900), the gate stop at :1595, the pre-review gate (:1486), `recordReviewOutcome` (src/core/review-policy.ts:126)."
forbid: [weakening or skipping a test to go green, changing a review counter, a new R3 decision or a second pass on a ruled candidate, moving a deadline, a change to REVIEW.md, editing .aidlc state by hand]
non_goals: [a goal that is in STOP or terminal (T1-REVIEW-RULE-GOAL), a ruling that grants a repair round, lifting a stop for review that has no `stopReview` invocation, a ruled pass for a candidate other than the one the stopping decision reviewed (it needs its own R3 and stops by the existing allowance rule), the ship-path reviewer, the stop narration and the instruction line (T1-REVIEW-RULE-GOAL), review statistics, a change to `card-loop.md`]
hygiene: "Line numbers are from main at 3548e757; read them again at PREPARE. Put `ruled` and `by` in the persisted event data, not in `extra`, which is lost on recovery (docs/LESSONS.md, T0-REVIEW-CANDIDATE-PINS). This card changes a file the verify-card-run-writes coverage record names, so run that skill before SHIP and at CLOSE."
doc_sync: docs/OPERATIONS.md (Review, STOP reasons), docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-REVIEW-RULE-SHIP

## Deliverable
When the owner has ruled on every merge-blocking finding of the decision that stopped a card, the card is in progress again and its reviewed candidate ships.

## Why
`specs/review-ruling.md`: a stop for review ends in a replacement card today, because the machine returns a persisted stop first and reads `stopReview` on every call. This card makes the rulings of T1-REVIEW-RULE the decision that ends the stop.

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
