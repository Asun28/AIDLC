---
slug: review-verification
title: Verify the card-run write protocol and measure the reviewers, from the code-review study
author: asun28 (engineer)
status: accepted
created: 2026-10-19T09:40:00Z
source: human
---

# Intent: Verify the card-run write protocol and measure the reviewers, from the code-review study
Author: asun28 (engineer). Status: accepted.

## Problem
The engineer asked for the loop's review and validation to be compared with
two sources and for every finding to become a card: the Claude Code team's
account of how it does code review (claude.dev, "How the Claude Code team
does code review") and the cursor `create-formal-verification-skill` and
`maintain-formal-verification-skill` skills.

The loop's own records (`aidlc review stats`, 145 reviewed cards, and the
464 findings on the card runs under `.aidlc/cards/`) show:

1. R3 passes 35% of first decisions (47 of 134 cards). 52 card runs stopped
   on review and 49 successor cards were written; T1-BOUND-TELEMETRY took
   six cards.
2. About 131 of the 330 R3 findings are ordering, crash and lock defects
   in the card-run write protocol (a journal append before the state it
   reports is saved, an append failure that leaves a stopped run without
   its pending firing, a record reloaded without its guard). R2 raised 29
   findings of that class. The DoD tests did not reach them, and
   `docs/LESSONS.md` records that "every review round on a lock protocol
   found a new corner". Nothing checks every failure point of a command.
3. Nothing measures a reviewer. `evals/` holds one example case and no
   reviewer case, so a change to REVIEW.md, a review perspective or a
   reviewer model is never scored against known bugs. All 160 candidate
   commits that drew a finding are still in the local object store.
4. In 25 of the 28 cards whose two R3 decisions both blocked, the second
   block named a REVIEW.md dimension the first block had already named:
   the repair fixed the cited site and not the other sites of the same
   class.
5. Precision is unknown: 1 of 464 findings is disputed, and a dispute
   is the only response the ledger records. A finding in code the card
   did not change blocks the card like a defect the card introduced.
6. `docs/LESSONS.md` says "ALWAYS run a mutation sweep over every branch a
   card adds ... before the first R3 decision", and no command runs one;
   65 R3 findings were dimension 6 (tests missing or unable to fail).

## Proposed outcome
- A test in the existing suite fails a chosen card-run command at each of
  its store writes and journal appends in turn, recovers, and checks that
  the run and the journal agree; it is shown to fail on a variant of the
  code with the write order broken.
- A project-local skill tells the next agent which files that check
  covers, the commit it was last confirmed against, how to run it, how to
  tell a modelling error from a bug, and how to extend it.
- A command replays the configured reviewers against recorded candidates
  with known bugs and against clean candidates, and reports recall and
  false blocks; a second command drafts those cases from the ledgers for
  a person to confirm.
- A block reason may name its defect class; the repair directive lists
  each class and asks for every site of it, and the next review checks
  the sweep.
- The author records why a finding was not fixed (wrong, intentional, not
  worth fixing); a finding tagged pre-existing whose cited line the
  candidate did not change is advisory; the statistics report both.
- A command mutates the changed lines of a card's candidate, runs the DoD
  per mutant and reports the survivors, which R3 receives as advisory
  evidence.

## Affected users and systems
`src/review/`, `src/core/review-policy.ts`, `src/core/types.ts`,
`src/loop/card-runner.ts`, `src/cli/main.ts`, `tests/`, `evals/`,
REVIEW.md and `templates/REVIEW.md`, `.claude/agents/reviewer.md`,
`.claude/skills/` and their `templates/` mirrors, `docs/`, `CHANGELOG.md`;
every downstream repository on its next `aidlc init` for the generic parts
(the bench, the class sweep, the response labels, the mutant report).

## Constraints
- Start after the loop-efficiency goal is DONE (it was, at cc97b99): its cards change the R2
  rounds, the R3 stop rule and the same files (`src/loop/card-runner.ts`,
  `src/core/review-policy.ts`, `src/review/pre-review.ts`).
- No new blocking gate: a new check runs inside `npm test` (so CI runs it)
  or reaches a reviewer as advisory evidence. The reviewer bench calls
  models and never runs in CI.
- No new runtime or dev dependency, and no Java: the fault-point check runs
  the real code through the injected stores; the mutator is in-house.
- No change to the verdict JSON schema: a defect class and the
  pre-existing tag travel inside the reason text, like `re:F<n>` and
  `[question]`.
- One card per PR, each in its own worktree; the cards run one at a time
  because every card edits `CHANGELOG.md`.
- A property that fails on the current code is a finding: it is never
  weakened to pass; the failing case goes to a T0-bugfix card.

## Open questions
- (none)
