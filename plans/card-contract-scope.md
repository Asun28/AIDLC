---
slug: card-contract-scope
title: A card's forbid list holds hard boundaries only and a card states each behaviour once, the operator runs one coordinator session per card, and PREPARE no longer tells the implementer to read every lesson
spec: specs/card-contract-scope.md
size: T1
status: draft
created: 2026-11-18T10:45:00Z
---

# Plan: A card's forbid list holds hard boundaries only and a card states each behaviour once, the operator runs one coordinator session per card, and PREPARE no longer tells the implementer to read every lesson (from specs/card-contract-scope.md)

## 1. Goal and boundaries
The card templates and the planner agent narrow what a card lists under `forbid` and say
that a card states each behaviour once; `docs/OPERATIONS.md` asks the operator for one
coordinator session per card; the PREPARE narration stops telling the implementer to read
all of `docs/LESSONS.md`. Cut: any validator finding or gate, `REVIEW.md`, registered
cards, lesson matching, the review prompts, the context pack. Success criteria: both cards
merged, and on main the PREPARE test passes with its new assertion and the four guidance
files hold the two rules.

## 2. Minimal acceptable loop
T1-CARD-FORBID-BOUNDARY alone gives the guidance for the next drafted card.

## 3. Tech stack
none this version

## 4. Directory structure
none this version (no new source or test file)

## 4.5 Module design
- Both card templates: the comment of the `forbid` key and one comment line under `acceptance:`.
- Both planner copies: the ready check line on a card's boundaries.
- `docs/OPERATIONS.md`: one operator paragraph after the Coordinator effort paragraph (card 1); the Lessons paragraph (card 2).
- `src/loop/card-runner.ts`: the first sentence of the PREPARE narration.
- `tests/scenarios/t0-flow.test.ts`: one assertion in the existing PREPARE test.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
The `narration` string of the `prepare` directive changes its first sentence; the
directive's `lessons` field and `readLessons` keep their shape.

## Files that change
- specs/tasks/_TEMPLATE.md
- templates/cards/_TEMPLATE.md
- .claude/agents/planner.md
- templates/claude/agents/planner.md
- docs/OPERATIONS.md
- src/loop/card-runner.ts
- tests/scenarios/t0-flow.test.ts
- changelog.d/T1-CARD-FORBID-BOUNDARY.md (new)
- changelog.d/T1-PREPARE-LESSONS-REF.md (new)

## Order of work
1. T1-CARD-FORBID-BOUNDARY (text only).
2. T1-PREPARE-LESSONS-REF, after it has merged: both edit `docs/OPERATIONS.md`.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-CARD-FORBID-BOUNDARY | MUST | both card templates and both planner copies say that `forbid` holds hard boundaries only and that a card states each behaviour once; `docs/OPERATIONS.md` asks for one coordinator session per card | - | - | - |
| T1-PREPARE-LESSONS-REF | MUST | the PREPARE narration names `docs/LESSONS.md` for reference with no instruction to read it; the Lessons paragraph of `docs/OPERATIONS.md` says who reads the file | T1-CARD-FORBID-BOUNDARY | - | - |

Budgets: 60 and 40 changed lines, 100 in total. The cards run one after the other.

## Risks
- Card T0-ADOPT-EXTERNAL-MERGE-2 (goal g-20261118090038-9544d2, running in another session on
  2026-11-18) allows `src/loop/card-runner.ts` and `docs/OPERATIONS.md` and runs
  `tests/scenarios/t0-flow.test.ts` in its DoD. Neither card of this goal runs beside it; each
  reads its line numbers again at PREPARE.
- The guidance of card 1 is prose. A measured one-line rule in an instruction file was
  followed on 60 to 68% of cases in one outside study, so the count of scope-narrowing
  `forbid` items in the next 30 registered cards decides whether prose is enough, against
  124 items in 70 of the 109 cards that carry a list. A validator finding is a later card
  only if the count does not fall.
- An implementer that no longer reads every lesson may repeat a defect that an old lesson
  names. The measure is repeat blocks of a lesson's class over the next 30 reviewed cards,
  cards that never merge included; a lesson read by the implementer already recurred
  (`docs/LESSONS.md:187`).
- One session per card is the operator's practice and no code enforces it. Its saving is an
  estimate until a ten-card trial compares coordinator spend, family spend with failed
  predecessors and reconstruction delays with the ten preceding comparable cards.
- Both card templates and the planner agent are installed by `aidlc init`, so downstream
  repositories get the guidance on their next init.
- Not verified before the cards run: that no test outside the DoD of card 1 pins the line
  after the Coordinator effort paragraph of `docs/OPERATIONS.md`; CI runs the whole suite.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: on main, `node --test tests/scenarios/t0-flow.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/coordinator-effort.test.ts` passes.
- Arc: `git grep -n "Read docs/LESSONS.md once" -- src` prints nothing, and `git grep -n "import-line" -- specs/tasks/_TEMPLATE.md templates/cards/_TEMPLATE.md .claude/agents/planner.md templates/claude/agents/planner.md` prints the rule in all four files.

## 10. After merge
none this version (development-only target)
