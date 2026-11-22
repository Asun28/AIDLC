---
slug: card-continuation
title: A stopped card run continues on the same card by the owner's recorded act, and an amendment of a running card keeps its findings
spec: specs/card-continuation.md
size: T1
status: draft
created: 2026-11-22T00:55:00Z
---

# Plan: A stopped card run continues on the same card by the owner's recorded act, and an amendment of a running card keeps its findings (from specs/card-continuation.md)

## 1. Goal and boundaries
Two recorded acts on a card run that exists. `aidlc card continue` lifts a `review` or a
`ci` stop on the same card and, for a review stop, admits a stated number of further R3
decisions. `aidlc card amend` records a change of a started card's contract, clears the
evidence the changed fields touch and keeps the findings, decisions and counters. The rule
text in `CLAUDE.md` and its template names both. Cut: every other stop reason, a review stop
after a missing verdict or under a ship-path reviewer, any counter reset, any deadline
change, a gate on an unrecorded card change, a record of the owner's delegation, a command
for the count of the intent's outcome 6. Success criteria: every card of the task split merged, and on
main the tests of "Proof" pass.

## 2. Minimal acceptable loop
T1-CONTINUE-CORE, T1-OWED-EVENT-TYPES, T1-CONTINUE-REVIEW-2, T1-CONTINUE-AUDIT,
T1-CONTINUE-GOAL-2 and T1-CONTINUE-COMMAND give a continued review stop from the command line. T1-CONTINUE-CI adds
the ci stop. T1-CARD-CONTRACT, T1-CARD-AMEND and T1-AMEND-COMMAND give the amendment. Each
card leaves main consistent: until T1-CONTINUE-COMMAND no command reaches the runner's act, and
until T1-AMEND-COMMAND no command records an amendment.

## 3. Tech stack
none this version

## 4. Directory structure
- `src/core/continuation.ts` (new): the pure rule of a continuation.
- `src/core/contract.ts` (new): the contract digests, the changed fields, the evidence each field touches, the derived candidate digest.
- Ten new test files, named under "Files that change".

## 4.5 Module design
- `src/core/types.ts`: `Continuation`, `Amendment`, the fields `continuations`, `amendments` and `contract` of `CardRun`, and the two owed event types `CARD_STATE` and `NOTE` (T1-OWED-EVENT-TYPES).
- `src/core/continuation.ts`: what a continuation requires of a run and what it changes, for a `review` stop (T1-CONTINUE-CORE) and a `ci` stop (T1-CONTINUE-CI).
- `src/core/review-policy.ts`: `recordReviewOutcome` and `decideFromLedger` take the admitted count in place of `MAX_R3_DECISIONS`.
- `src/loop/card-runner.ts`: `CardRunner.continueStop` and the readers of the allowance (T1-CONTINUE-REVIEW-2), its ci branch (T1-CONTINUE-CI), `CardRunner.amendCard` and the derived digest in `recordAttempt` (T1-CARD-AMEND).
- `src/loop/controller.ts`: the goal re-admission after a continuation (T1-CONTINUE-GOAL-2); `ensureCardRun` records `contract` (T1-CARD-CONTRACT).
- `src/core/card-goal.ts`, `src/audit/verifier.ts`: the refusal's exception for a continuation and the audit rule (T1-CONTINUE-AUDIT).
- `src/cli/main.ts`: the two command lines (T1-CONTINUE-COMMAND and T1-AMEND-COMMAND).
- `bench/baseline.json`: the `modules` ceiling of the journey `cli.start` (T1-CONTINUE-REVIEW-2).
- `CLAUDE.md`, `templates/CLAUDE.aidlc.md`: the hard limit on a started card (T1-AMEND-COMMAND).

## 5. Data model and state machine
`CardRun` gains `continuations` and `amendments`, both empty by default, and an optional
`contract`. No state is added to the card machine: a continuation clears a persisted stop
and `selectCardState` selects the next state from the evidence, and an amendment changes
the evidence (the DoD receipt, the candidate digest).

## 6. Contracts and core interfaces
- `aidlc card continue <cardId> --by <who> --reason <text> [--decisions <n>] [--goal <id>]`.
- `aidlc card amend <cardId> --by <who> --reason <text> [--goal <id>]`.
- `CARD_STATE` (STOP to `readmitted`) and `GOAL_STATE` (STOP to CARDS) events may carry `continuation`; a `NOTE` event carries `amendment`.
- A candidate digest of a run with no review-invalidating amendment is computed as today.

## Files that change
- src/core/types.ts
- src/core/continuation.ts (new)
- src/core/contract.ts (new)
- src/core/review-policy.ts
- src/core/card-goal.ts
- src/loop/card-runner.ts
- src/loop/controller.ts
- src/audit/verifier.ts
- src/cli/main.ts
- tests/core/continuation.test.ts (new)
- tests/core/contract.test.ts (new)
- tests/core/owed-event.test.ts (new)
- tests/core/card-goal.test.ts
- tests/scenarios/card-continue.test.ts (new)
- tests/scenarios/card-continue-goal.test.ts (new)
- tests/scenarios/card-continue-command.test.ts (new)
- tests/scenarios/card-continue-ci.test.ts (new)
- tests/scenarios/card-contract.test.ts (new)
- tests/scenarios/card-amend.test.ts (new)
- tests/scenarios/card-amend-command.test.ts (new)
- tests/surface/verifier.test.ts
- bench/baseline.json
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- README.md
- CLAUDE.md
- templates/CLAUDE.aidlc.md
- .claude/skills/verify-card-run-writes/SKILL.md
- changelog.d/T1-CONTINUE-CORE.md (new)
- changelog.d/T1-OWED-EVENT-TYPES.md (new)
- changelog.d/T1-CONTINUE-REVIEW-2.md (new)
- changelog.d/T1-CONTINUE-AUDIT.md (new)
- changelog.d/T1-CONTINUE-GOAL-2.md (new)
- changelog.d/T1-CONTINUE-COMMAND.md (new)
- changelog.d/T1-CONTINUE-CI.md (new)
- changelog.d/T1-CARD-CONTRACT.md (new)
- changelog.d/T1-CARD-AMEND.md (new)
- changelog.d/T1-AMEND-COMMAND.md (new)

## Order of work
1. T1-CONTINUE-CORE: the record and the pure rule for a review stop, and the admitted count in the ledger decision.
2. T1-OWED-EVENT-TYPES: the owed event list admits `CARD_STATE` and `NOTE`. Added on 2026-11-22 after T1-CONTINUE-CORE merged: the first dispatch of T1-CONTINUE-REVIEW found that its owed `CARD_STATE` event is refused by the schema, in a file that card may not change. Its run has started, so its card is not edited; this card merges first and the work on T1-CONTINUE-REVIEW resumes on a branch that holds it.
3. T1-CONTINUE-REVIEW-2: the runner's act and the readers of the allowance. It replaces T1-CONTINUE-REVIEW, which stopped for ci on 2026-11-22 after R3 had passed its repaired candidate: the `bench` job failed on `cli.start modules 254`, one above what the ceiling of `bench/baseline.json` admits, in a file the card could not change, and no command lifts a ci stop on the same card until T1-CONTINUE-CI. The successor carries the first candidate (e28b2aef), raises that ceiling to the measured count, and states what `aidlc card next` returns in REVIEW_FIX, where acceptance 2 of the replaced card named a directive the loop does not return (R3 decision 1, F1).
4. T1-CONTINUE-AUDIT: the refusal's exception for a continuation on a stopped goal, and the audit rule.
5. T1-CONTINUE-GOAL-2: the controller's method and the goal re-admission. It replaces T1-CONTINUE-GOAL, whose R3 said that a throw of the runner leaves every record as it was. The runner writes the run first and appends its journal events after, so a failed append comes after the write. R3 blocked three candidates on it: one that let the error through, one that exited 0 with the event owed, and one that restored the run record (older owed events stay appended, a concurrent command's record can be mistaken for this call's, and the old revision is reused). No code meets that requirement, so the successor states the two cases apart: a refusal writes nothing, and a failure after the write keeps what was written and is completed by the next command.
6. T1-CONTINUE-COMMAND: the command line. Split from the replaced card, which came to 381 changed lines.
7. T1-CONTINUE-CI: the ci stop.
8. T1-CARD-CONTRACT: the contract digests on a new run and the pure rules of an amendment.
9. T1-CARD-AMEND: the runner's act and the derived digest in `recordAttempt`.
10. T1-AMEND-COMMAND: the command and the rule text.

T1-CONTINUE-AUDIT and T1-AMEND-COMMAND were split from T1-CONTINUE-GOAL and T1-CARD-AMEND
on 2026-11-22, before either started: the three cards built by then came to 214, 64 and 313
changed lines against budgets of 150, 40 and 240, so the two would have passed the 250-line
limit.

The cards run one after the other: most of them edit `src/loop/card-runner.ts`,
`src/cli/main.ts` or `docs/`.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-CONTINUE-CORE | MUST | a card run holds `continuations`; a pure rule says what a continuation of a review stop requires and changes; the ledger decision compares with the admitted count | - | - | - |
| T1-OWED-EVENT-TYPES | MUST | a card-run write can owe a `CARD_STATE` and a `NOTE` event to the goal journal | - | - | - |
| T1-CONTINUE-REVIEW-2 | MUST | `CardRunner.continueStop` lifts a review stop in one locked update, the gate, the admission, the assessment and the second pass read the admitted count, and the `cli.start` module ceiling of the loop benchmark is the measured count | T1-CONTINUE-CORE, T1-OWED-EVENT-TYPES | - | - |
| T1-CONTINUE-AUDIT | MUST | the stopped-goal refusal lets a continuation through for review and ci, and the audit ends a goal stop on an event that carries `continuation` | T1-CONTINUE-REVIEW-2 | - | - |
| T1-CONTINUE-GOAL-2 | MUST | `GoalController.continueCard` continues a card on a goal stopped for the card's stop and re-admits the goal with an event that carries `continuation` | T1-CONTINUE-REVIEW-2, T1-CONTINUE-AUDIT | - | - |
| T1-CONTINUE-COMMAND | MUST | `aidlc card continue` records the continuation from the command line | T1-CONTINUE-GOAL-2 | - | - |
| T1-CONTINUE-CI | MUST | `aidlc card continue` returns a run stopped for ci to BUILD with a counted repair attempt and re-admits its goal | T1-CONTINUE-COMMAND | - | - |
| T1-CARD-CONTRACT | MUST | a new card run holds one digest per contract field; pure rules give the changed fields, the evidence they touch and the derived candidate digest | T1-CONTINUE-CI | - | - |
| T1-CARD-AMEND | MUST | `CardRunner.amendCard` records an amendment, clears the DoD receipt and re-derives the candidate digest by the changed fields | T1-CARD-CONTRACT | - | - |
| T1-AMEND-COMMAND | MUST | `aidlc card amend` records the amendment from the command line; `CLAUDE.md` and its template name both commands | T1-CARD-AMEND | - | - |

Budgets of the six cards still to run: 240, 190, 240, 200, 240 and 160 changed lines, tests
and each card's evidence table included. Each is at or under 250, the limit for a card that
changes `src/` (card T0-CARD-SIZE). Merged: T1-CONTINUE-CORE at 214 against 150,
T1-OWED-EVENT-TYPES at 64 against 40, T1-CONTINUE-REVIEW-2 at 280 against 250,
T1-CONTINUE-AUDIT at 90 against 130. Replaced: T1-CONTINUE-REVIEW at 313 against 240 and
T1-CONTINUE-GOAL at 381 against 240.

## Risks
- Ten cards and two replaced cards, where `intent/card-continuation.md` says at most five.
  Four causes, all in the first plan. One requirement promised what the write protocol
  cannot give: that a failure of the runner leaves every record as it was (T1-CONTINUE-GOAL
  replaced by T1-CONTINUE-GOAL-2 after three R3 blocks). It did not check that the owed event list is a
  closed enum (T1-OWED-EVENT-TYPES). It did not run the loop benchmark, whose `cli.start`
  module ceiling main had already used up, and it gave one acceptance item a directive the
  loop does not return (T1-CONTINUE-REVIEW replaced by T1-CONTINUE-REVIEW-2). Its line
  estimates were 30 to 40 percent low, so the continuation and the amendment are each cut
  into more cards to stay within the 250-line limit, where a larger card needs a size
  exception that only the owner gives. The owner is told in the session report.
- The cards run one after the other, and the arc deadline is 12 hours from intake. A
  card in this area took three R3 blocks before (T1-REVIEW-RULE-SHIP). When the deadline
  comes first the goal stops for time and the owner decides on `aidlc goal extend`.
- The allowance is read in more places than the four of the spec if one was missed. The
  sweep of T1-CONTINUE-REVIEW-2 names every reader of `MAX_R3_DECISIONS` and
  `MAX_SUBSTANTIVE_REVIEW_DECISIONS` in `src/` and says for each whether it reads the
  admitted count. `baseSyncDue` and `src/state/bounds.ts` do not.
- The derived candidate digest is correct only while `recordAttempt` is the one place that
  computes a candidate digest. The sweep of T1-CARD-AMEND repeats the search
  (`git grep -n "\.candidate(" -- src`: one caller on main at f51534d2).
- An amendment that invalidates the review gives the same commit a new digest. The act
  carries the candidate's CI reruns to it and unsets the blocked receipt, so an unchanged
  blocked candidate runs its DoD once more. A run with a pending repair is refused.
- `.claude/skills/verify-card-run-writes/SKILL.md` is 7994 of 8000 bytes.
  T1-CONTINUE-REVIEW-2 and T1-CARD-AMEND add a runner method to its list of commands the check does not drive and must shorten other
  words of that list to fit.
- `CLAUDE.md` is 192 of 200 lines; T1-AMEND-COMMAND may add two.
- The table of which evidence each contract field touches is the coordinator's reading and
  is flagged in the spec for the owner.
- Nothing refuses a card change that nobody records. The rule text tells a session to
  record it, and the count after delivery shows whether amendments are recorded.
- A session that runs this goal changes the review machinery it is reviewed by. Each card's
  DoD runs the existing review scenarios unchanged, and CI runs the whole suite.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: on main, `npm run typecheck` passes and `node --test tests/core/continuation.test.ts tests/core/owed-event.test.ts tests/core/contract.test.ts tests/core/review-policy.test.ts tests/core/card-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-ci.test.ts tests/scenarios/card-amend.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts tests/surface/verifier.test.ts tests/surface/command-lines.test.ts tests/surface/claude-md-size.test.ts` passes.
- Arc: `node bin/aidlc.js card continue --help` and `node bin/aidlc.js card amend --help` print their options, and `git grep -n "aidlc card continue" -- CLAUDE.md templates/CLAUDE.aidlc.md docs/OPERATIONS.md` prints a line in each file.

## 10. After merge
The count of the intent's outcome 6, taken once 30 card runs have stopped for `review` or
`ci` after the merge of T1-CONTINUE-CI: of those runs, how many hold a continuation and how many
cards carry `superseded_by`; and how many runs hold an amendment. It is read from the run
records and the registry with a query kept under `_local/`, and reported beside the
replaced share of `docs/reliability/baseline.md`. No threshold is set before the first
count.
