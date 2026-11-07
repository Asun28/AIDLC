---
id: T0-CANDIDATE-WITHDRAW
title: A bound candidate no R3 decision has decided can be withdrawn with a recorded finding, so a defect found before R3 takes the ordinary repair path
status: merged
branch: T0-CANDIDATE-WITHDRAW
worktree: D:\wt\AIDLC\T0-CANDIDATE-WITHDRAW
allow_paths:
  - src/loop/card-runner.ts
  - src/core/types.ts
  - src/cli/main.ts
  - tests/scenarios/candidate-withdraw.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - CHANGELOG.md
  - specs/tasks/T0-CANDIDATE-WITHDRAW.md
dod_command: npm run typecheck && node --test tests/scenarios/candidate-withdraw.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/core/effort.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. When `aidlc card withdraw <id> --cause <finding>` is admitted, the card runner shall in one write turn the success that bound the candidate into a counted failure with the cause `withdrawn: <finding>`, reopen the episode, clear the DoD and blocked receipts, record a pending repair of kind `withdrawn` holding the finding and the candidate digest, and owe an `ATTEMPT_FINISHED` event with `refutedBy` `withdrawn`.
  - R2. After a withdrawal, `aidlc card next` shall return the ladder's next attempt with the finding in its narration, with no R3 decision spent.
  - R3. The card runner shall refuse a withdrawal with nothing written, an owed event of an earlier command included, on a card with no run, an empty cause, a terminal goal, a stopped or merged run, an episode that is not `succeeded`, a run with no candidate, a pending repair, an R2 round or R3 decision in flight, an R3 pass or block recorded on the bound candidate, an unresolved operation of the card, a lease held by another session, a card deadline that has passed, and a ladder that admits no repair attempt.
  - R4. While a `withdrawn` repair is pending, `aidlc card attempt --outcome success` shall refuse a candidate whose digest equals the withdrawn digest.
  - R5. While a `withdrawn` repair is pending, `aidlc review pre` and `aidlc review r3` shall refuse to run.
  - R6. A success on another candidate shall bind that candidate and clear the pending repair, and the new candidate shall need its own R2 pass when R2 is configured and its own R3 decision.
  - R7. When the `ATTEMPT_FINISHED` append of a withdrawal fails, the saved run shall keep the owed event, and the next `aidlc card next` shall append exactly one with `completed` true.
  - R8. The refusal of `aidlc card attempt` on a succeeded episode shall name `aidlc card withdraw`.
  - R9. `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` shall state the command and its limits, `verify-card-run-writes` shall list `CardRunner.withdrawCandidate` under Not covered, and the CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/scenarios/candidate-withdraw.test.ts`: a candidate at SHIP with no review is withdrawn. The attempt reads `fail` with cause `withdrawn: <finding>` and its evidence keeps the DoD text, the episode has no terminal, `dodReceipt` and `blockedReceipt` are gone, the state is BUILD, the pending repair holds the finding and the digest, and the journal holds one `ATTEMPT_FINISHED` with `refutedBy` `withdrawn`. [R1] [dod arm 2]
  - 2. `tests/scenarios/candidate-withdraw.test.ts`: `card next` after a withdrawal returns `build` for attempt 2 with the finding in the narration, and `substantiveDecisions` stays 0. [R2] [dod arm 2]
  - 3. `tests/scenarios/candidate-withdraw.test.ts`: each refusal of R3 throws, names its cause, and leaves the stored run and the journal length unchanged. One row per refusal, with an R3 pass, an R3 block, a pending R3 invocation and a pending R2 round each set up by the review commands or the reservation record, and the ladder refusal reached both by a third baseline failure with no progress and by a second withdrawal with the same cause. The attempt's evidence in acceptance 1 is seeded by the success, so the check reads a real DoD text. [R1] [R3] [dod arm 2]
  - 4. `tests/scenarios/candidate-withdraw.test.ts`: an R3 block on candidate A followed by a repaired candidate B leaves B withdrawable, since no decision is recorded on B, and an R3 no-verdict on the bound candidate does not refuse. [R3] [dod arm 2]
  - 5. `tests/scenarios/candidate-withdraw.test.ts`: `recordAttempt` with the withdrawn candidate's sha throws and leaves attempt 2 running and the pending repair in place; a `fail` outcome on it is recorded. [R4] [dod arm 2]
  - 6. `tests/scenarios/candidate-withdraw.test.ts`: `preReview` and `formalReview` reject on a withdrawn candidate, with no round and no invocation recorded. A withdrawal landing while `formalReview` collects its diff refuses that dispatch at its reservation, and the review pool holds no active slot after it. [R5] [dod arm 2]
  - 7. `tests/scenarios/candidate-withdraw.test.ts`: withdrawal, repair on another sha, then `card next` returns the R2 `pre-review` directive though R2 passed the withdrawn candidate; after that the R3 `review` directive; and the pending repair is gone. With R2 rounds spent under `onExhausted: ship`, the block has already reopened the episode and restored the receipt for R3, so the withdrawal refuses and names the open episode, and a success on another sha binds the repair. The repair of a withdrawn base-sync candidate is still a base-sync candidate. [R3] [R6] [dod arm 2]
  - 8. `tests/scenarios/candidate-withdraw.test.ts`: with the `ATTEMPT_FINISHED` append failing, `withdrawCandidate` throws, the stored run holds the owed event and the withdrawal, and one `card next` leaves exactly one `ATTEMPT_FINISHED` with `refutedBy` `withdrawn` and `completed` true; a second adds none. A refused withdrawal with that event owed leaves the journal unchanged, and the next `card next` still delivers it. [R3] [R7] [dod arm 2]
  - 9. `tests/scenarios/candidate-withdraw.test.ts`: with the card-run record write failing, `withdrawCandidate` throws and the stored run, the journal length and the episode are unchanged, and a retry succeeds. [R1] [dod arm 2]
  - 10. `tests/scenarios/candidate-withdraw.test.ts`: `recordAttempt` on a succeeded episode throws a message holding both `episode already succeeded` and `aidlc card withdraw`. [R8] [dod arm 2]
  - 11. `tests/scenarios/candidate-withdraw.test.ts`, spawning the CLI: on a card with no run `aidlc card withdraw <id> --cause <finding>` exits nonzero, creates no run and journals no `CARD_DISPATCHED`. With a bound candidate `aidlc card withdraw <id>` without `--cause` exits nonzero and names the option, with `--cause` it exits 0 and prints the pending repair, and `aidlc card next` then returns `build`. [R1] [R2] [dod arm 2]
  - 12. The tests of `fault-points`, `journal-owed`, `dispute-running-attempt`, `effort` and `templates` pass with no change. [R1] [R3] [dod arms 3 to 7]
  - 13. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, the skill and the CHANGELOG hold the text R9 asks for. [R9] Reviewer-verified.
depends_on: []
budget: 520
tdd: true
sweep: "On main at 6f1cb58. The refusal stands at `src/loop/card-runner.ts:998`. `afterShipFailure` at `src/core/effort.ts:147` already refutes a success and steps the ladder, for the ship outcomes at card-runner.ts:2691, and it is the only refuting path. `pendingRepair` has one schema at `src/core/types.ts:866`, is read at card-runner.ts:951, 953, 967, 1023 and 2994, and `clearsPendingRepair` clears any kind but `red-missing` on a success, so a new kind needs no change there. `pinnedCandidate` has three callers, 1590, 1681 and 2312, all review dispatch, so one guard covers `review pre` and `review r3`. `inFlight` at card-runner.ts:1595 is the existing test for a reservation. The review pass check for a candidate reads `review.invocations` as at lines 1020 and 1523. `verify-card-run-writes` names `recordAttempt`, which gains a refusal and no write; `withdrawCandidate` joins Not covered and gets its own fault rows in the new test file, as `disputeFinding` has none in `COVERED`. A docs sentence in `docs/OPERATIONS.md` quotes the phrase `episode already succeeded`, which R8 keeps."
diagnosis:
  root_cause: "`recordAttempt` admits a new attempt only on an open episode, and only a review block or a ship failure reopens a succeeded one. A finding made after the bind and before R3 has neither, so it costs an R3 decision on a known defect or a successor card."
  same_class: "Issue 128 lists five instances: an R2 advisory or no-verdict on T1-BOUND-TELEMETRY, T0-HOOK-CONFIG-CLOSED-2, a hand-run check on T0-HOOK-CLASSIFIER twice, and T0-CI-RERUN-STRUCTURED before any review. Each is a finding on a bound candidate with no R3 decision on it, which R1 covers. The comment on T0-HOOK-CLASSIFIER says a last-round block under `onExhausted: ship` leaves the episode closed; on main that block reopens the episode and `reusableReceipt` restores the receipt for R3, so `card attempt` already admits a repair there and acceptance 7 pins it."
forbid:
  - changing `afterShipFailure`, `selectCardState`, `MAX_R3_DECISIONS` or any review allowance
  - a withdrawal that resets a counter or spends no ladder attempt
  - admitting a withdrawal after an R3 decision on the bound candidate
  - weakening or skipping a test to go green
non_goals:
  - withdrawing a candidate R3 passed, which keeps the ship path, with a later defect going to a follow-up card as today
  - a new success that replaces a candidate with no withdrawal, since that would leave the replaced success uncounted and the repeat unbounded
  - adding the command to `COVERED` in `tests/scenarios/fault-points.test.ts`, whose five commands are the card's own
  - the `A command that names a card` list in `docs/OPERATIONS.md`, a pinned list that already omits other card commands
  - `card-loop.md`, which is 19 bytes under its cap, so naming the command there would mean cutting another rule; the refusal of `card attempt` (R8) names it at the step where an agent needs it, as R3 decision 1 F1 and F2 found
hygiene: "Issue 128, using the shape its comments ask for: a recorded withdrawal that reopens the episode with the finding as the cause. The withdrawal is a counted failure on purpose: a review block is paid for by the review allowance, and a withdrawal has no allowance of its own, so the effort ladder bounds it, and the same-cause rule stops a repeat. A ladder that admits no repair refuses the withdrawal rather than stopping the card, so a candidate that could still be reviewed stays bound. Who the boundary holds against: an agent spending the loop's allowances by accident, not a hostile process. `refuseChangedCheckout` re-reads the same guard through `pinnedCandidate` under the lock, so a dispatch racing a withdrawal refuses at its reservation. Unlike `card attempt`, this command delivers no owed event before it refuses (R3 decision 1 F4): a refusal writes nothing, and `card next` recovers the event. The command reads the existing run and never calls `ensureCardRun`, so a refusal on an unstarted card starts no deadline (R3 decision 1 F5). Line numbers checked on main at 6f1cb58."
---

# T0-CANDIDATE-WITHDRAW

## Deliverable
`aidlc card withdraw <id> --cause "<finding>"` reopens a bound candidate no R3 decision has decided. Closes issue 128.

## Attempt evidence
RED, commit 70b2bc1: `node --test tests/scenarios/candidate-withdraw.test.ts` exits 1, tests 25, pass 0, fail 25. Acceptance 10 fails on its assertion, since the refusal names no `aidlc card withdraw`; the others fail because the command does not exist on main, which is the defect of issue 128.

That RED cannot show that each refusal test can fail, so each guard was removed in turn, by hand, and the test file run. On the first candidate 24 changes gave 23 failures. The one that passed, dropping `state: 'BUILD'`, was a weak test: the run was already BUILD. Acceptance 1 now withdraws from SHIP, and the change fails it.

RED for repair 1, commit 44c43f9 (R3 decision 1 F3, F4, F5): tests 29, pass 27, fail 2.
- Acceptance 8: `the journal is unchanged`, since a refusal delivered the owed event.
- Acceptance 11: the output did not match `/no run/`, since `cardCtx` created a run before the refusal.
- Acceptance 1 passes at that commit, since F3 is a gap in the test and the code kept the evidence. Replacing the evidence with the cause in `afterShipFailure`, by hand and not committed, fails it.

On the repaired candidate the guards removed in turn give 23 changes and 23 failures. The change that dropped the first `deliverOwed` is gone with that line.

## Acceptance
```powershell
npm run typecheck && node --test tests/scenarios/candidate-withdraw.test.ts tests/scenarios/fault-points.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/dispute-running-attempt.test.ts tests/core/effort.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: the acceptance list above.
