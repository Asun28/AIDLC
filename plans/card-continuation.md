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
for the count of the intent's outcome 6. Success criteria: the six cards merged, and on main
the tests of "Proof" pass.

## 2. Minimal acceptable loop
Cards 1 to 3 give a continued review stop from the command line. Card 4 adds the ci stop.
Cards 5 and 6 give the amendment. Each card leaves main consistent: until card 3 no command
reaches the runner's act, and until card 6 no run holds an amendment.

## 3. Tech stack
none this version

## 4. Directory structure
- `src/core/continuation.ts` (new): the pure rule of a continuation.
- `src/core/contract.ts` (new): the contract digests, the changed fields, the evidence each field touches, the derived candidate digest.
- Seven new test files, named under "Files that change".

## 4.5 Module design
- `src/core/types.ts`: `Continuation`, `Amendment` and the fields `continuations`, `amendments` and `contract` of `CardRun`.
- `src/core/continuation.ts`: what a continuation requires of a run and what it changes, for a `review` stop (card 1) and a `ci` stop (card 4).
- `src/core/review-policy.ts`: `recordReviewOutcome` and `decideFromLedger` take the admitted count in place of `MAX_R3_DECISIONS`.
- `src/loop/card-runner.ts`: `CardRunner.continueStop` and the four readers of the allowance (card 2), its ci branch (card 4), `CardRunner.amendCard` and the derived digest in `recordAttempt` (card 6).
- `src/loop/controller.ts`: the goal re-admission after a continuation (card 3); `ensureCardRun` records `contract` (card 5).
- `src/core/card-goal.ts`, `src/audit/verifier.ts`, `src/cli/main.ts`: the command on a stopped goal, the audit rule, the command lines (cards 3 and 6).
- `CLAUDE.md`, `templates/CLAUDE.aidlc.md`: the hard limit on a started card (card 6).

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
- tests/core/card-goal.test.ts
- tests/scenarios/card-continue.test.ts (new)
- tests/scenarios/card-continue-goal.test.ts (new)
- tests/scenarios/card-continue-ci.test.ts (new)
- tests/scenarios/card-contract.test.ts (new)
- tests/scenarios/card-amend.test.ts (new)
- tests/surface/verifier.test.ts
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- README.md
- CLAUDE.md
- templates/CLAUDE.aidlc.md
- .claude/skills/verify-card-run-writes/SKILL.md
- changelog.d/T1-CONTINUE-CORE.md (new)
- changelog.d/T1-CONTINUE-REVIEW.md (new)
- changelog.d/T1-CONTINUE-GOAL.md (new)
- changelog.d/T1-CONTINUE-CI.md (new)
- changelog.d/T1-CARD-CONTRACT.md (new)
- changelog.d/T1-CARD-AMEND.md (new)

## Order of work
1. T1-CONTINUE-CORE: the record and the pure rule for a review stop, and the admitted count in the ledger decision.
2. T1-CONTINUE-REVIEW: the runner's act and the four readers of the allowance.
3. T1-CONTINUE-GOAL: the command, the goal re-admission and the audit rule.
4. T1-CONTINUE-CI: the ci stop.
5. T1-CARD-CONTRACT: the contract digests on a new run and the pure rules of an amendment.
6. T1-CARD-AMEND: the act, the derived digest in `recordAttempt`, the command and the rule text.

The cards run one after the other: cards 1, 2, 4 and 6 edit `src/loop/card-runner.ts` or
`src/core/types.ts`, and every card edits `docs/`.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-CONTINUE-CORE | MUST | a card run holds `continuations`; a pure rule says what a continuation of a review stop requires and changes; the ledger decision compares with the admitted count | - | - | - |
| T1-CONTINUE-REVIEW | MUST | `CardRunner.continueStop` lifts a review stop in one locked update, and the gate, the admission, the assessment and the second pass read the admitted count | T1-CONTINUE-CORE | - | - |
| T1-CONTINUE-GOAL | MUST | `aidlc card continue` runs on a goal stopped for review, re-admits it with an event that carries `continuation`, and the audit accepts that event | T1-CONTINUE-REVIEW | - | - |
| T1-CONTINUE-CI | MUST | `aidlc card continue` returns a run stopped for ci to BUILD with a counted repair attempt and re-admits its goal | T1-CONTINUE-GOAL | - | - |
| T1-CARD-CONTRACT | MUST | a new card run holds one digest per contract field; pure rules give the changed fields, the evidence they touch and the derived candidate digest | T1-CONTINUE-CI | - | - |
| T1-CARD-AMEND | MUST | `aidlc card amend` records an amendment, clears the DoD receipt and re-derives the candidate digest by the changed fields; `CLAUDE.md` and its template name both commands | T1-CARD-CONTRACT | - | - |

Budgets: 150, 240, 230, 190, 185 and 230 changed lines, 1225 in total, tests included.
Each is at or under 250, the limit for a card that changes `src/` (card T0-CARD-SIZE).

## Risks
- Six cards, where `intent/card-continuation.md` says at most five. The continuation of a
  review stop is about 360 changed lines with its scenario tests, and one card of that size
  needs a size exception that only the owner gives. It is split into a core card and a
  runner card. The owner is told in the session report.
- The six cards run one after the other, and the arc deadline is 12 hours from intake. A
  card in this area took three R3 blocks before (T1-REVIEW-RULE-SHIP). When the deadline
  comes first the goal stops for time and the owner decides on `aidlc goal extend`.
- The allowance is read in more places than the four of the spec if one was missed. The
  sweep of card 2 names every reader of `MAX_R3_DECISIONS` and
  `MAX_SUBSTANTIVE_REVIEW_DECISIONS` in `src/` and says for each whether it reads the
  admitted count. `baseSyncDue` and `src/state/bounds.ts` do not.
- The derived candidate digest is correct only while `recordAttempt` is the one place that
  computes a candidate digest. The sweep of card 6 repeats the search
  (`git grep -n "\.candidate(" -- src`: one caller on main at f51534d2).
- An amendment that invalidates the review gives the same commit a new digest. The act
  carries the candidate's CI reruns to it and unsets the blocked receipt, so an unchanged
  blocked candidate runs its DoD once more. A run with a pending repair is refused.
- `.claude/skills/verify-card-run-writes/SKILL.md` is 7994 of 8000 bytes. Cards 2 and 6 add
  a runner method to its list of commands the check does not drive and must shorten other
  words of that list to fit.
- `CLAUDE.md` is 192 of 200 lines; card 6 may add two.
- The table of which evidence each contract field touches is the coordinator's reading and
  is flagged in the spec for the owner.
- Nothing refuses a card change that nobody records. The rule text tells a session to
  record it, and the count after delivery shows whether amendments are recorded.
- A session that runs this goal changes the review machinery it is reviewed by. Each card's
  DoD runs the existing review scenarios unchanged, and CI runs the whole suite.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: on main, `npm run typecheck` passes and `node --test tests/core/continuation.test.ts tests/core/contract.test.ts tests/core/review-policy.test.ts tests/core/card-goal.test.ts tests/scenarios/card-continue.test.ts tests/scenarios/card-continue-goal.test.ts tests/scenarios/card-continue-ci.test.ts tests/scenarios/card-amend.test.ts tests/scenarios/review-rule.test.ts tests/scenarios/review-rule-ship.test.ts tests/scenarios/review-rule-goal.test.ts tests/scenarios/second-pass.test.ts tests/scenarios/fault-points.test.ts tests/surface/verifier.test.ts tests/surface/command-lines.test.ts tests/surface/claude-md-size.test.ts` passes.
- Arc: `node bin/aidlc.js card continue --help` and `node bin/aidlc.js card amend --help` print their options, and `git grep -n "aidlc card continue" -- CLAUDE.md templates/CLAUDE.aidlc.md docs/OPERATIONS.md` prints a line in each file.

## 10. After merge
The count of the intent's outcome 6, taken once 30 card runs have stopped for `review` or
`ci` after the merge of card 4: of those runs, how many hold a continuation and how many
cards carry `superseded_by`; and how many runs hold an amendment. It is read from the run
records and the registry with a query kept under `_local/`, and reported beside the
replaced share of `docs/reliability/baseline.md`. No threshold is set before the first
count.
