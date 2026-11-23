---
slug: lesson-delivery
title: The lessons of docs/LESSONS.md reach whoever writes a card, and the context pack keeps the newest matching lessons
author: asun28 (owner); drafted by the coordinator session
status: accepted
created: 2026-11-23T01:30:00Z
source: human
---

# Intent: The lessons of docs/LESSONS.md reach whoever writes a card, and the context pack keeps the newest matching lessons
Author: asun28 (owner); drafted by the coordinator session. Status: accepted.

## Problem
The owner asked on 2026-11-23 what this repository can take from
`github.com/markrussinovich/agent-session-insights` (commit 735792d8; read, not run) for what
it already has, the learn loop first, and asked for a discussion with Codex gpt-6-astra. The
coordinator and Codex discussed it in three rounds and agreed; the owner approved the result
in the session. Measured on 2026-11-23 by read-only scripts, main at d62dccd7 to ad088ed0:

- Lessons are written faster than they are delivered. `docs/LESSONS.md` holds 210 lesson
  lines and 39 of them are dated 2026-11-16 to 2026-11-23. PREPARE gives the implementer the
  five most recent (`src/artifacts/lessons.ts:134`), so a lesson is among them for about a
  day. The first R3 pass gets 6 of 198 rules under its cap of 3,000 bytes.
- Most of the newest rules are for whoever writes a card, and no step that writes a card
  reads the file. Codex labelled the 30 newest rules by who can act on them: the card writer
  17, the implementer 11, the operator 2, the reviewer 0. `.claude/agents/planner.md` and
  `specs/tasks/_TEMPLATE.md` name no lessons input, and the `plan` and `project-cards`
  directives, which ask for cards (`src/loop/controller.ts:302-329`), carry none.
- About half of the card runs are blocked at the first formal decision on the card's own
  text. Of 393 card runs, 177 pass their first substantive formal decision and 196 are
  blocked with a reason on dimension 1, 2, 6 or 14 of `REVIEW.md`, the dimensions that
  compare the candidate with the card. Of the newest 60 runs, 26 pass and 32 are blocked on
  those dimensions.
- The context pack removes the newest matching lesson first. `src/loop/context-pack.ts:77`
  removes lines from the end when the pack exceeds 8,192 bytes, as requirement R2 of card
  T1-RUN-CONTEXT-PACK-2 says. Over the 60 merged cards with the newest first decision, 20
  packs are truncated, each of those 20 matches at least one of the 20 newest lessons, and
  18 of the 20 keep none of them.

No record shows that a lesson changed an outcome. The class slug a reviewer gives a finding
is shared by two card families once in 408 slugs, so a repeat cannot be counted by it, and the
one comparison of rule selection found no gain (`specs/second-r3-pass.md:13`). The measures
below are therefore stated before the cards run.

## Proposed outcome
1. The `plan` directive and the `project-cards` directive carry the count and the ten most
   recent lesson lines, and their narration says to check every card against them before it
   is registered. The two card templates and the two planner agent copies name the file.
   Card T1-CARD-WRITER-LESSONS.
2. When the context pack exceeds its budget it removes the earliest matching lesson line
   first and keeps the survivors in file order. Card T1-PACK-KEEP-NEWEST, after card 1.
3. Measure of outcome 1: the share of card runs whose first substantive formal decision is a
   block naming dimension 1, 2, 6 or 14, over the next 30 registered cards, against 32 of the
   newest 60 (53.3%). Registered cards and reviewed runs are counted apart and pending cards
   are reported separately. The dimensions are a proxy: they do not prove that drafting
   caused a block. A sample of 30 shows only a large change.
4. Measure of outcome 2, on the frozen cohort of `plans/lesson-delivery.md`, Proof: of the 20
   newest lessons, the median number a pack keeps, over all packs and over the truncated
   packs that match at least one of those 20, against 0 today. No outcome claim is made.

Agreed in the same discussion and not carded here; each waits for the owner's instruction:

- Four additions to the draft `intent/run-attribution.md`, part A: cost sums named observed
  priced subtotals with the observed coverage of each source; usage extracts kept under a
  dated name with their price card and a request identity; a counts-only table of human
  inputs; a comparison of the session rule with attribution rule 4 on hand-labelled requests.
- One issue that defers checking a lesson's source against a recorded finding, with the
  counts of the discussion and what reopens it.
- A hand read of ten sessions by the owner before any lesson is drawn from a session.

## Affected users and systems
`src/loop/directive.ts`, `src/loop/controller.ts`, `src/loop/context-pack.ts`, the two card
templates (`specs/tasks/_TEMPLATE.md`, `templates/cards/_TEMPLATE.md`), the two planner agent
copies (`.claude/agents/planner.md`, `templates/claude/agents/planner.md`),
`docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and the tests of the two cards. The templates
and the planner agent are installed by `aidlc init`, so a downstream repository gets the text
on its next init. Whoever writes a card, a session or the planner agent, reads ten more lines
at the step that asks for cards.

## Constraints
- Outside figures are leads, never evidence; every number above was measured here.
- No test is weakened or removed. Card 2 changes one assertion together with the
  requirement it follows, which the owner approved.
- No change to the lesson line format, to `readLessons`, to the PREPARE directive, to a
  review prompt, to `REVIEW.md` or to the allowance constants.
- A merged card keeps its text: T1-RUN-CONTEXT-PACK-2 is not edited.
- No item of Plan A or Plan B is reopened (`intent/card-contract-scope.md`,
  `intent/run-attribution.md`).

## Cut or deferred
- An audience mark, a keyword selector or a new lesson kind: the line format is frozen, and
  a keyword rule matched 14 of 17 card-writer lines and 5 of 11 implementer lines.
- A larger PREPARE window or reviewer cap: the benefit is unmeasured.
- An annotation stage in the loop, per-turn attribution, cost ranges for missing cache
  counters, and the report and player of the outside repository.
- More reviewers and a gate per lesson (Plan B).
- The human line of `aidlc next`, which prints the narration and not the lesson lines, as it
  does for PREPARE; `--json` prints them.

## Decisions (owner, 2026-11-23, in the session)
- The owner replied "approve to aidlc create cards and commit" to the agreed plan.
- Three points were put to the owner with the plan and were not answered one by one, so the
  coordinator's stated suggestion stands for each until the owner says otherwise. The keep
  rule of measure 3: at most 12 of the next 30 registered cards blocked on those dimensions
  at the first formal decision. The removal order of requirement R2 of T1-RUN-CONTEXT-PACK-2
  changes with card 2. The text of card 1 applies to `templates/` too.
- The ten most recent lines are sent, whatever they are about.
- No goal is opened by this commit: the request was to create the cards and commit them,
  and the deadlines of a goal start when it is created.

## Open questions
- (none)
