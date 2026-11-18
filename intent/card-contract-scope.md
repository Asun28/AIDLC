---
slug: card-contract-scope
title: A card's forbid list holds hard boundaries only and a card states each behaviour once, the operator runs one coordinator session per card, and PREPARE no longer tells the implementer to read every lesson
author: asun28 (owner); drafted by the coordinator session
status: accepted
created: 2026-11-18T10:35:00Z
source: human
---

# Intent: A card's forbid list holds hard boundaries only and a card states each behaviour once, the operator runs one coordinator session per card, and PREPARE no longer tells the implementer to read every lesson
Author: asun28 (owner); drafted by the coordinator session. Status: accepted.

## Problem
The owner asked on 2026-11-18 what this loop can take from two outside ideas without adding
complexity: a talk that puts each rule in the cheapest layer that can hold it (code structure,
static checks, verification, prose, review, in that order), and "replace human review with a
validation matrix". The coordinator and Codex gpt-6-astra discussed both in three rounds and
agreed; the owner approved the result in the session. Measured on 2026-11-18, main at 8e198fb5
and 62dc0a50:

- A `forbid` list restricts implementation detail, and R3 must block on it.
  `specs/tasks/_TEMPLATE.md:32` defines `forbid` as hard boundaries (network, credentials,
  frozen contracts). `REVIEW.md:23` makes a `forbid:` item a must-block hit of dimension 2
  and `REVIEW.md:49` makes that `[P0]`. Of the 391 card files, 109 carry a `forbid` list with
  1,259 items in all, and 124 items in 70 of those cards narrow the scope inside an allowed
  file (the item says `outside`, `import line`, `other than`, `except the` or `except for`).
  Two successors merged the code of their predecessor unchanged after such a block or a
  contract correction (`docs/LESSONS.md:165`, `:194`). 28.7% of card attempts are replaced,
  and 681.21 of 1,854.76 USD at list price went to replaced cards
  (`docs/reliability/baseline.md:34`, `:62`, `:14`); how much of that these items cause is
  not measured.
- Cards repeat themselves. The median T0 card file holds 1,477 words and 6 of 235 are at or
  under the 400 words that `specs/tasks/_TEMPLATE.md:17` asks for on a change of 30 src lines
  or fewer. Length does not predict replacement (within a budget band the longer half of the
  cards is replaced no more often than the shorter half), so the cost is drafting and input
  tokens, not replacements.
- The coordinator's context is the largest per-request cost that no card owns. A coordinator
  request reads 337,715 cached tokens, about 11.5 requests per merged card, and 49.1% of
  tokens are attributed to no card (`docs/reliability/baseline.md:12`). One interactive
  session often runs several cards in a row.
- Every implementer is told to read all lessons. The narration of the PREPARE directive
  (`src/loop/card-runner.ts:1110`) says "Read docs/LESSONS.md once before the first attempt".
  The file holds 182 lesson lines in 84,045 bytes, about 21,000 tokens at 4 bytes per token,
  against 147,571 cached tokens per implement request. The directive already carries the
  newest five lines (`src/artifacts/lessons.ts:134`). A lesson the implementer had read
  still recurred across two R3 decisions (`docs/LESSONS.md:187`).

## Proposed outcome
1. The card templates and the planner agent say that `forbid` holds hard boundaries only: no
   incidental line, function-body or import-line restriction; a frozen API may be named; such
   a restriction is not moved into `requirements`, which state observable behaviour.
2. The same files say that a card states each behaviour once: an acceptance item names its
   proof and its requirement, unique edge cases and rationale stay, and fixtures and
   implementation instructions are not repeated.
3. `docs/OPERATIONS.md` tells the operator to run one interactive coordinator session per
   card, started at a completed-card boundary, until goal run-attribution attributes the
   coordinator's spend.
4. The PREPARE narration names the lesson count, says the newest lessons are in the
   directive and names `docs/LESSONS.md` for reference, with no instruction to read it;
   `docs/OPERATIONS.md` says which reading is the operator's and which is the loop's.

## Affected users and systems
Every card drafted after the merge (the planner agent, the coordinator that drafts cards);
every implementer at PREPARE; the operator of an interactive coordinator session; every
downstream repository on its next `aidlc init` (`templates/cards/_TEMPLATE.md`,
`templates/claude/agents/planner.md`). Files: `specs/tasks/_TEMPLATE.md`,
`templates/cards/_TEMPLATE.md`, `.claude/agents/planner.md`,
`templates/claude/agents/planner.md`, `docs/OPERATIONS.md`, `src/loop/card-runner.ts`,
`tests/scenarios/t0-flow.test.ts`.

## Constraints
- A change of this goal removes text, steps or spend. It adds no subsystem, no dependency,
  no gate and no `aidlc cards validate` finding.
- `REVIEW.md` does not change, so `reviewPolicyVersion` does not move. Registered cards stay
  as they are.
- The directive keeps the newest five lesson lines; no lesson matching is added at PREPARE
  and the review prompts do not change.
- Both planner files stay byte-identical and both card templates keep the lines other tests
  pin.
- Every effect is an estimate until measured: scope-narrowing `forbid` items over the next
  30 registered cards against 124 in 70 of 109; cached tokens per implement request against
  147,571, and repeat blocks of a lesson's class over the next 30 reviewed cards; a ten-card
  trial of one session per card against the ten preceding comparable cards.
- Cards of at most 200 changed lines and at most 8 allowed paths.

## Cut or deferred
Read and not carded, with the reason:
- A word-count gate on cards: length does not predict replacement.
- Splitting cards by budget: the budget marks risk (`docs/OPERATIONS.md`, Card size), and
  three small cards cost about as much in expected replacement as one large card.
- Implicit `allow_paths` entries for a card's own files: the parallel-window checks read the
  declared paths (`src/core/arc.ts:97`, `src/artifacts/card.ts:269`).
- Leaving zero-score lessons out of the review prompt: about 750 tokens per review.
- A comment ban, a model checker or a proof assistant, more reviewers, a gate per lesson and
  an automated loop of fix pull requests: each adds machinery or spend, and
  `intent/pstack-study.md` already deferred the first three.
- A command that replaces a card, and the label "unchanged-code successor": they belong to
  the replacement study of `intent/card-preflight.md`.

## Open questions
- (none)
