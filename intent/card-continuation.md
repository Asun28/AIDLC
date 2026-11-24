---
slug: card-continuation
title: A stopped card run continues on the same card by the owner's recorded act, and an amendment of a running card keeps its findings
author: asun28 (owner); drafted by the coordinator session
status: accepted
created: 2026-11-21T19:50:00Z
source: human
---

# Intent: a stopped card run continues on the same card by the owner's recorded act, and an amendment of a running card keeps its findings
Author: asun28 (owner); drafted by the coordinator session. Status: accepted.

## Problem
`docs/reliability/baseline.md` (commit e74113d): 93 of 324 card attempts were replaced by a
successor, and 681.21 of 1854.76 USD of attributed list-price spend went to replaced cards.

`docs/reliability/replacement-study.md` (commit d9c83b23) read 15 replaced cards drawn at
random and 5 controls, for `intent/card-preflight.md`:

- A reader of the card would not have prevented a replacement: 0 of 15 against a threshold of
  5. This intent proposes no reader.
- 13 of the 15 runs ended on a recorded stop: review 7, ci 3, risk 2, card 1. The other 2 had
  passed their deadline while they waited for the owner's ruling.
- The successor's candidate descends from the replaced card's last candidate in 10 of 15
  cases, and 12 of the 15 successors merged. By the report's per-card accounts 1 card lost its
  design (T0-HOOK-LAZY) and the other 14 went on with the same work under a new card id. The
  count of 14 is the coordinator's reading of that table, not a label of the study.
- An amendment that kept the card's work would plausibly have avoided the replacement on 6 of
  15 cards, and on none by the card change alone: 2 needed a ci stop lifted, 2 needed further
  review decisions, and 2 needed the deadline extension that `aidlc goal extend` gives.
- 8 of the 15 card files had been changed during the run, in 28 commits, and the cards were
  replaced all the same: 4 of the 8 stopped on review, 2 on ci and 2 on risk.

What a stopped run can do today (`docs/OPERATIONS.md`, "STOP reasons"):

- `time`: `aidlc goal extend` moves the deadline and re-admits the run.
- `review`: `aidlc review rule` rejects or defers each blocking finding, and the reviewed
  candidate ships as it is. No command admits a further R3 decision on a repaired candidate
  once the allowance is used (`MAX_R3_DECISIONS = 4`, `MAX_SUBSTANTIVE_REVIEW_DECISIONS = 2`,
  `src/core/types.ts:1281-1283`).
- `ci`: no way back to BUILD on the same card after a person has diagnosed the failure
  (issue 326, open).
- `tool`: final for the card, a replacement card. Issue 109 asked for a recorded card resume
  and the owner closed it on 2026-11-07 as rare: 6 tool stops in 221 card runs.
- `card` and `risk`: no command lifts them.

So a successor card is how a stopped run goes on. It needs a new card file, the dependents'
`depends_on` repointed, a plan edit and a commit on main (issue 326), and its run starts with
a full review allowance. The registry then records the first card as replaced
(`superseded_by`), and the baseline counts its spend as spend on a replaced card.

The amendment of a running card is practised and has no stated effect:

- 72 commit subjects under `specs/tasks/` since 2026-09-01 name a change after the card's run
  started ("after its start", "from R3 decision", "from attempt", "owner instruction"). This
  is a search of the subjects, not checked against the start of each run.
- Two rule texts disagree. `CLAUDE.md`, Hard limits, and `templates/CLAUDE.aidlc.md`: "After
  a card run starts, do not edit the card's requirements, acceptance or budget. A point the
  card does not cover becomes a follow-up issue, not a ruling in the card."
  `.claude/skills/aidlc-loop/arc.md:36-37`: "Running or reviewed card: reconcile produced
  effects (commits, PR, review), then a recorded contract amendment or a linked successor."
- No command records the amendment. `routeAmendment` in `src/core/amendments.ts` names the
  route and "exists as a pure function the loop does not call"
  (`docs/REQUIREMENTS-TRACEABILITY.md:72`). The run's `cardRevision` is written when the run
  is created and "Nothing in src reads it" (`src/core/types.ts:901`).
- No text says which findings, decisions, counters and receipts of the run stand after its
  contract changed.

## Proposed outcome
1. The owner can amend the contract of a card whose run has started by one recorded act. The
   run keeps its findings, its review decisions and its counters. The act names the evidence
   the amendment touches, and that evidence no longer counts; the rest stands.
2. The owner can continue a stopped run on the same card by one recorded act that names the
   stop it lifts and what it admits, as `aidlc goal extend` does for a deadline. The act lifts
   a `review` stop or a `ci` stop. For a review stop it admits the number of further R3
   decisions it names, 1 when it names none, and a block on the last of them stops the run
   again. The review allowance is not reset.
3. `aidlc card status` and the journal show each such act: who, when, why, and what it
   admitted or invalidated.
4. The rule texts say one thing about a card whose run has started: who may change it, by
   which act, and what a session may not do.
5. A successor card remains the way for a merged card, for a change of scope and for a card
   that lost its design.
6. A count, taken from the run records after delivery: of the stopped runs, how many continued
   on the same card and how many were replaced. No threshold is set before the first count.

## Affected users and systems
The owner, who rules; coordinator sessions, which run cards and today register successors.
`src/core/` (card state selection, review policy), `src/loop/`, `src/cli/`, the journal and
`aidlc audit verify`. `CLAUDE.md` and `templates/CLAUDE.aidlc.md`, the `aidlc-loop` skill
files and their template copies, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`. Downstream
repositories receive the rule text through `aidlc init`.

## Constraints
- The owner's decisions, given in the session on 2026-11-22 at about 00:15Z in answer to the
  five open questions of the draft (commit 934bae07): the ruling on amendments and no trial of
  the reader, which is the decision of `intent/card-preflight.md`, outcome 5; the continuation
  of a stopped run belongs to this intent; the recorded act lifts `review` and `ci` stops and
  no `tool`, `card` or `risk` stop; one continuation of a review stop admits the number of
  further R3 decisions it names, 1 when it names none; a session under the owner's recorded
  delegation records the two acts.
- Authority: both acts carry the owner's authority, recorded with who, when and why. A session
  records one only on the owner's instruction in the session or under a delegation the owner
  gave, and the record names that instruction or delegation. A session's own edit of a started
  card stays forbidden. `aidlc audit verify`
  accepts a re-admission after a stop only from the event that carries the act, as it does for
  a ruled review stop (card T1-REVIEW-RULE-GOAL).
- No gate is bypassed. SHIP still needs a DoD receipt and an R3 pass on the current candidate.
- Nothing on the run record is deleted or reset: findings, decisions, attempts and CI reruns
  stay counted.
- A deadline moves only by `aidlc goal extend`.
- A merged card is never amended.
- The study measured no counterfactual. 6 of 15 is a judgement on each card, with an interval
  of 20% to 64%, and no saving is claimed before the count of outcome 6.
- `CLAUDE.md` and `templates/CLAUDE.aidlc.md` stay identical in the shared section, `.claude/`
  and `templates/claude/` stay identical, and the skill files keep their byte caps
  (`tests/surface/templates.test.ts`).
- Size T1, at most 5 cards. The allowance constants do not change.

## Open questions
- (none)
