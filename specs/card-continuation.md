---
slug: card-continuation
title: A stopped card run continues on the same card by the owner's recorded act, and an amendment of a running card keeps its findings
intent: intent/card-continuation.md
status: draft
created: 2026-11-22T00:40:00Z
skills_applied: []
---

# Spec: A stopped card run continues on the same card by the owner's recorded act, and an amendment of a running card keeps its findings
From intent: intent/card-continuation.md. Status: draft. Skills applied: none (the intent lists no open question).

## Requirements (EARS)
- R1. WHEN `aidlc card continue <card> --by <who> --reason <text> [--decisions <n>]` runs on a card run in STOP with stop reason `review` under a command reviewer, the command shall record a continuation on the run, mark each R3 decision that recorded the stop as lifted, and clear the stop.
- R2. WHILE the latest review continuation of a run admits decisions up to a count C (the substantive decisions at the act plus `--decisions`, 1 when it is absent), the R3 allowance rules of that run shall read C in place of the two-decision and the four-decision allowance.
- R3. WHEN a merge-blocking block is the decision that reaches C, the run shall stop for review with a detail that names the continuation and the decisions it admitted.
- R4. The continuation shall leave every counter, finding, invocation outcome, attempt, CI rerun and deadline of the run as it was.
- R5. IF the run is not in STOP for `review` or `ci`, the review stop followed a missing verdict or was made without a command reviewer, `--by` or `--reason` is blank, or `--decisions` is given for a `ci` stop or is not a whole number from 1 to 4, THEN the command shall refuse with no write and name the cause.
- R6. WHEN a continuation lifted the card's stop and the goal is in STOP for the same reason in the same generation, the command shall re-admit the goal with one `GOAL_STATE` event from STOP to CARDS that carries `continuation` with the card id and `by`.
- R7. The command `aidlc audit verify` shall end a goal stop for `review` or `ci` on that event, and on no `GOAL_STATE` event that carries neither a ruling nor a continuation.
- R8. WHEN the command runs on a run in STOP with stop reason `ci`, the command shall return the run to BUILD as a CI code defect does: the success that bound the candidate becomes a counted failure whose cause is the act's reason, the repair is the next attempt of the effort ladder, the DoD receipt is cleared and the CI ledger is unchanged.
- R9. IF the effort ladder admits no repair attempt for a `ci` continuation, THEN the command shall refuse with no write and name the ladder's reason.
- R10. WHEN a card run is created, the loop shall record on it one digest for each contract field of the card: `requirements`, `acceptance`, `allow_paths`, `forbid`, `non_goals`, `dod_command`, `dod_exit`, `budget` and `tdd`.
- R11. WHEN `aidlc card amend <card> --by <who> --reason <text>` runs on a started, unmerged run whose recorded contract differs from the card, the command shall record an amendment with who, when, why, the new card revision, the fields that changed and the evidence invalidated, and store the new digests.
- R12. The amendment shall invalidate only the evidence its changed fields touch: the DoD receipt for `acceptance`, `dod_command`, `dod_exit` and `tdd`; the review decisions of the current candidate for `requirements`, `acceptance`, `allow_paths`, `forbid` and `non_goals`; nothing for `budget`.
- R13. WHEN an amendment invalidates the review decisions, the command shall give the current candidate a new digest derived from its digest, carry the CI reruns of that candidate to the new digest, unset the blocked receipt, and leave the digest of every review invocation as it was.
- R14. WHILE a run holds amendments that invalidated the review decisions, the loop shall record each candidate of that run under the digest that the same derivation gives, applied once for each such amendment.
- R15. The amendment shall leave every finding, decision outcome, counter, attempt outcome and stop of the run as it was.
- R16. IF the run does not exist, is DONE or merged, has an unresolved operation, a review in flight or a pending repair, holds no recorded contract, or its recorded contract equals the card's, THEN the command `aidlc card amend` shall refuse with no write and name the cause.
- R17. The Hard limits of `CLAUDE.md` and of `templates/CLAUDE.aidlc.md` shall say that a session does not change the contract of a started card on its own, that the owner's amendment is recorded with `aidlc card amend` and a stopped run continues with `aidlc card continue`, each only on the owner's instruction in the session or under a delegation the owner gave and the record names, and that a point the card does not cover and the owner does not amend becomes a follow-up issue.
- R18. The file `docs/OPERATIONS.md` shall describe both commands with their refusals and what each keeps, and name `aidlc card continue` in the rows `review` and `ci` of its STOP reasons table.

## Design
Line numbers are those of main at f51534d2.

The two acts follow the two that exist. `aidlc goal extend` lifts a time stop
(`GoalController.extendDeadline`, `src/loop/controller.ts:917-964`): it clears the stop of
each time-stopped run under the card-run lock, journals `CARD_STATE` from STOP to
`readmitted`, and re-admits the goal with `GOAL_STATE` from STOP to CARDS. `aidlc review
rule` lifts a review stop by ruling its findings (`CardRunner.ruleFinding`,
`src/loop/card-runner.ts:661-676`; `GoalController.ruleFinding`,
`src/loop/controller.ts:984-1017`): it sets `stopLifted` on the stopping decision, appends a
ruled pass, and re-admits the goal inside the goal lock with an event that carries `ruling`.

Continuation of a review stop (R1 to R5). A review stop is either recorded by an R3 block
decision (`stopReview` on the invocation, `src/core/review-policy.ts:169-171`) or made by the
gate when a further review is required and the allowance is used
(`src/loop/card-runner.ts:1863-1866`). After a lift by ruling the run admits no further
decision: `formalAdmission` (`:2084-2086`) and the gate both read `formalAllowance`
(`:1796-1802`), and no counter is reset. The continuation is the one thing that changes what
those rules compare with. It records `admits`, the count C of R2, and five places read it:

- `formalAllowance` returns C.
- `decideFromLedger` (`src/core/review-policy.ts:179-216`) compares `substantiveDecisions`
  with C where it compares with `MAX_R3_DECISIONS`, and its stop detail names the
  continuation. Its re-raise rule is unchanged: from decision 2 on, a block that re-raises a
  disputed finding stops the run whatever C is.
- The assessment's `reviewExhausted` (`src/loop/card-runner.ts:855-858`) compares with C.
- `secondPassDue` (`:1943-1949`) compares with C - 1, so a pass on the last admitted decision
  gets no second pass, as a pass on decision 3 of 4 gets none today.
- The texts that name "the 4-decision allowance" in the gate stop and the admission refusal
  name the continuation.

C replaces both allowances from the act on, also when it is below 4: a run stopped on a
re-raised finding at decision 2 and continued with one decision takes decision 3 and no
more. A later continuation replaces C. The act writes `stopLifted` on every decision with an
unlifted `stopReview`, appends no pass, and leaves the run to `selectCardState`: REVIEW_FIX
while the blocking decision is on the current candidate, SHIP when the candidate has no
decision. A blocked candidate that the author leaves unchanged gets its next decision
through the existing dispute of each finding (`aidlc review dispute`).

The act is refused for a review stop after a missing verdict (`noVerdictRetriesUsed` above
`MAX_NO_VERDICT_RETRIES`) and for a run whose formal reviewer is not a configured command,
where the reviewer runs inside the ship script and `formalAdmission` is not on the path. It
moves no deadline: when the run's deadline has passed, the output names `aidlc goal extend`,
and the next `aidlc card next` stops the run for time as it does today.

Goal and audit (R6, R7). `aidlc next` stops the goal with the stop reason of its stopped
card (`src/loop/controller.ts:405-408`). The re-admission is that of `ruleFinding`: one
section of the goal lock, the event appended once after the goal's last `GOAL_STOPPED`, the
goal written without its stop, and a second run of the command completing a re-admission
that failed part way. `terminalGoalRefusal` (`src/core/card-goal.ts:54-61`) lets this command
through on a goal stopped for `review` or `ci`. The verifier's terminal accounting
(`src/audit/verifier.ts:95-106`) accepts `continuation` with a card id and `by` beside
`ruling`, for a `GOAL_STOPPED` of reason `review` or `ci`.

Continuation of a ci stop (R8, R9). A ci stop is made when a CI failure is unclassified or
the rerun allowance is used (`src/loop/card-runner.ts:3238-3255`), and `card ci-reconcile`
keeps it (issue 326). The act does what the ship result does for class `code-defect`:
`refutePatch` (`:3167-3172`) through `afterShipFailure`, with the act's reason as the cause.
The run is in BUILD, the repair is a counted attempt, and a new candidate goes through the
DoD, R3 and the ship again. When the ladder admits no attempt the act refuses, where the
ship path makes a `card` stop: the act makes no stop.

Record and journal. Each continuation is one entry of `continuations` on the run and one
`CARD_STATE` event from STOP to `readmitted` that carries `continuation` (by, reason, the
lifted stop's reason, and for a review stop `decisions` and `admits`), delivered as the
runner delivers the events it owes. `aidlc card status` prints the run record, so it shows
them.

Contract (R10). Today nothing binds a run to its card text: the loop loads the card from
the main checkout on every command (`src/cli/main.ts:214-225`,
`src/loop/controller.ts:131`), and the run's `cardRevision` is written once
(`src/loop/controller.ts:770`). `ensureCardRun` records `contract`: for each field of R10
the SHA-256 of `JSON.stringify` of its value, an absent `requirements`, `forbid` or
`non_goals` as an empty list and an absent `budget` as `null`. A run is created only for a
card the registry holds. A run created before this version holds no `contract`.

Amendment (R11 to R16). The act compares the recorded digests with the card of the main
checkout. The fields that differ are `changed`, and the table of R12 gives `invalidated`:

| Changed field | DoD receipt | Review decisions of the current candidate |
|---|---|---|
| `requirements`, `allow_paths`, `forbid`, `non_goals` | stands | no longer count |
| `acceptance` | cleared | no longer count |
| `dod_command`, `dod_exit`, `tdd` | cleared | stand |
| `budget` | stands | stands |

Clearing the DoD receipt unsets `dodReceipt` and `blockedReceipt` and reopens the effort
episode as a review block does (`reopenAfterReviewBlock`, `src/core/effort.ts:39`): the
success that bound the candidate stays a success, no failure is counted, and the next
attempt is admitted, so the run builds again.

The review decisions stop counting through the candidate's digest. Most review rules ask
whether a decision is one of the current candidate by comparing digests
(`lastFormalInvocation`, `ruledPass`, `secondPassDue`, the pending-block evidence, the
repeated-pass rule of `recordReviewOutcome`, the review request key) and do not change. The
digest is computed in one place, `recordAttempt` (`src/loop/card-runner.ts:1348-1349` from
the checkout, `:1359` on the dry-run path). A pure function derives the digest of an
amended candidate: SHA-256 of the digest and a fixed suffix, applied once for each amendment
of the run that invalidated the review decisions. The act applies it to `candidate.digest`
and to the CI reruns of that candidate, so the rerun allowance the candidate used stays
used. It unsets the blocked receipt, which is bound to the old digest: a blocked candidate
that the author leaves unchanged runs its DoD once more. It refuses a run with a pending
repair, whose record names a digest too. `recordAttempt` applies the function to each
digest it computes, so the same commit recorded again after the amendment has the amended
digest. The invocations keep their digests, so each pass, ruled pass and block is a
decision of an earlier candidate: the gate asks for a decision or stops for review when the
allowance is used, as for any further required review, and the new decision counts. The
same-candidate block check of `formalAdmission` and `preReviewAdmission` compared commits:
for a run that holds an amendment that invalidated the review decisions they compare
digests, so an amended candidate on the same commit gets its new round and its new
decision. Findings stay keyed by commit, and the new decision re-raises or resolves them by
the existing rules.

The act lifts no stop: a stopped run is amended first and continued second. It refuses a
run with no `contract`, and a run whose contract equals the card's, so it records nothing
when nothing changed.

Rule texts (R17, R18). `CLAUDE.md` has 192 of its 200 lines. The hard limit "After a card run
starts, do not edit the card's requirements, acceptance or budget. A point the card does not
cover becomes a follow-up issue, not a ruling in the card." is replaced in both files by the
text of R17 in at most the same number of lines plus two. `.claude/skills/aidlc-loop/arc.md`
already says "a recorded contract amendment or a linked successor" and is not changed: its
byte cap leaves 6 bytes. Each command's card writes its own paragraphs of
`docs/OPERATIONS.md` and `docs/ARCHITECTURE.md`.

The count of the intent's outcome 6 needs no command: `continuations` and `amendments` are
on the run records and `superseded_by` is in the registry. It is taken after delivery, as
the plan says.

## Corrections made while the cards ran
The first form of this design was wrong in six places. Each was found by a card's build or
by R3, and the text above is the corrected form.

- A card-run write owes its journal events through a closed list of types; `CARD_STATE` and
  `NOTE` were added to it (T1-OWED-EVENT-TYPES).
- After a continuation `aidlc card next` returns what it returns for any run in REVIEW_FIX,
  the `build` directive of the repair attempt, not a `review-fix` directive
  (T1-CONTINUE-REVIEW-2).
- A refusal is decided before the runner's write and leaves every record as it was. A
  failure after that write is not undone: the act stays recorded, an event that was not
  appended stays owed for the next `aidlc card next`, and the command run again completes a
  goal re-admission. A restore of the run record was tried and refused by R3: earlier owed
  events stay appended and a concurrent record can be mistaken for the call's own
  (T1-CONTINUE-GOAL-2).
- On a ci stop, a running repair that the ladder promotes keeps its `ATTEMPT_STARTED` owed
  until the next `aidlc card next`, so the audit sees it after the goal's re-admission
  (T1-CONTINUE-CI).
- A contract digest is over the parsed value, and the parser reads the first line of a list
  item; no run is created for a card the registry lacks (T1-CARD-CONTRACT-2).
- Two admission checks compared commits and compare digests after an amendment that
  invalidated the review decisions (T1-CARD-AMEND).

The work took ten cards and three replaced cards, where the intent says at most five;
`plans/card-continuation.md`, Risks, gives the causes.

## Interfaces and contracts
- New commands: `aidlc card continue <cardId> --by <who> --reason <text> [--decisions <n>] [--goal <id>]` and `aidlc card amend <cardId> --by <who> --reason <text> [--goal <id>]`. Both act on an existing run only and start none.
- `CardRun` gains `continuations` (default empty), `amendments` (default empty) and `contract` (optional). Records written before this version parse unchanged.
- `CARD_STATE` events from STOP to `readmitted` may carry `continuation`; `GOAL_STATE` events from STOP to CARDS may carry `continuation`. A `NOTE` event carries `amendment`. No journal event type is added.
- A candidate digest of a run with no review-invalidating amendment is computed as today.
- `MAX_R3_DECISIONS`, `MAX_SUBSTANTIVE_REVIEW_DECISIONS`, `MAX_NO_VERDICT_RETRIES` and `MAX_CI_TRANSIENT_RERUNS` keep their values.

## Data model and migration impact
Additive fields on the card-run record, each optional or with a default. No migration: a record without them reads as a run with no continuation, no amendment and no recorded contract.

## Flagged concerns (route to policy owners)
- The delegation is named in the free text of `--by` and `--reason`. No command checks that the owner gave one. The owner decides whether a recorded delegation needs a record of its own. Ruled by the owner in the session on 2026-11-22 at about 09:55Z: it stays as built.
- The table of R12 is the coordinator's reading of "invalidate only the evidence they touch". The owner may rule a field otherwise. Ruled by the owner at the same time: the table stands.
- A contract change that nobody records is detected by no gate in this version. `aidlc card amend` is how a session finds it: the command refuses when nothing changed. Ruled by the owner at the same time: this changes. Card T0-CONTRACT-GATE, in a goal of its own, makes the loop refuse new work on a run whose card differs from its recorded contract.

## Non-goals
- Lifting a `tool`, `card`, `risk`, `time` or any other stop with `aidlc card continue`; a review stop after a missing verdict; a review stop under a ship-path reviewer.
- Resetting a counter, moving a deadline, or changing an allowance constant.
- A gate that refuses a review or a ship while the card differs from the recorded contract, and a report of that difference in `aidlc card status`.
- A record or a check of the owner's delegation.
- Amending a merged card, and editing the card file: the act records a change that a commit already made.
- A command that prints the count of the intent's outcome 6.
- A reader of draft cards (`intent/card-preflight.md`, outcome 3).
- A change to `.claude/skills/aidlc-loop/` or to `REVIEW.md`.

## Acceptance
- 1. A run stopped by an R3 block on decision 4 and continued with `--decisions 1` takes decision 5 on a repaired candidate: a pass ships it, and a block stops the run for review with a detail that names the continuation. [R1] [R2] [R3]
- 2. A run stopped on a re-raised finding at decision 2 and continued with one decision takes decision 3 and is refused decision 4. [R2]
- 3. After a continuation the run's counters, findings, invocation outcomes, CI ledger and deadline equal those before it. [R4]
- 4. Each refusal of `aidlc card continue` leaves the run file and the journal byte-identical and names its cause. [R5] [R9]
- 5. A goal stopped for `review` or `ci` is re-admitted by the continuation, `aidlc audit verify` reports no `WORK_AFTER_TERMINAL` for the work that follows, and reports it when the event carries no continuation. [R6] [R7]
- 6. A run stopped for `ci` and continued is in BUILD with the bound success counted as a failure under the act's reason, no DoD receipt, and the CI ledger unchanged. [R8]
- 7. A new run holds the nine digests, and each row of the table of R12 gives its two columns from the changed fields. [R10] [R12]
- 8. `aidlc card amend` after a change of `acceptance` records the amendment, raises the revision, clears the DoD receipt, gives the candidate a new digest and carries its CI reruns to it; after a change of `budget` alone it clears nothing and keeps the digest. [R11] [R12] [R13]
- 9. After an amendment that invalidated the review decisions, the same commit recorded again has the amended digest, `aidlc card next` returns a review directive and no ship for a candidate that had passed, the new decision raises `substantiveDecisions` by one, and with the allowance used the run stops for review. [R13] [R14]
- 10. After an amendment the findings, decision outcomes, counters, attempt outcomes and stop of the run equal those before it, and the digest of every review invocation is unchanged. [R13] [R15]
- 11. Each refusal of `aidlc card amend` leaves the run file and the journal byte-identical and names its cause. [R16]
- 12. Both rule files hold the text of R17, `CLAUDE.md` stays within 200 lines, and the shared section of the two files stays identical. [R17]
- 13. `docs/OPERATIONS.md` describes both commands and its STOP reasons table names `aidlc card continue` for `review` and `ci`. [R18]
