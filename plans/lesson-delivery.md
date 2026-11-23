---
slug: lesson-delivery
title: The lessons of docs/LESSONS.md reach whoever writes a card, and the context pack keeps the newest matching lessons
spec: specs/lesson-delivery.md
size: T1
status: draft
created: 2026-11-23T01:40:00Z
---

# Plan: The lessons of docs/LESSONS.md reach whoever writes a card, and the context pack keeps the newest matching lessons (from specs/lesson-delivery.md)

## 1. Goal and boundaries
The two directives that ask for cards carry the ten most recent lessons, the card templates
and the planner agent name the file, and a truncated context pack keeps the newest matching
lessons. Cut: an audience mark, lesson selection by score, the human line of `aidlc next`,
the PREPARE directive, the review prompts, `REVIEW.md` and registered cards. Success
criteria: both cards merged, and on main the new test of card 1 and the changed assertion of
card 2 pass.

## 2. Minimal acceptable loop
T1-CARD-WRITER-LESSONS alone delivers lessons to the writer of the next card.

## 3. Tech stack
none this version

## 4. Directory structure
One new test file, `tests/scenarios/card-writer-lessons.test.ts`.

## 4.5 Module design
- `src/loop/directive.ts`: an optional `lessons` object on the `plan` and `project-cards` kinds.
- `src/loop/controller.ts`: the four places that build those directives read the lessons and extend their narration.
- Both card templates: one comment line under `acceptance:`. Both planner copies: one line under their inputs.
- `docs/OPERATIONS.md`: one clause in the Lessons paragraph (card 1); one sentence in the context pack paragraph (card 2).
- `docs/ARCHITECTURE.md`: the rows of `plan` and `project-cards` in the directive table.
- `src/loop/context-pack.ts`: the line that removes a lesson on overflow.
- `tests/core/context-pack.test.ts`: the assertion of the truncation test, and one new assertion.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
The `plan` and `project-cards` directives gain an optional `lessons` field of the shape
`readLessons` returns. The context pack keeps its fields and its budget; a truncated pack
keeps the last matching lessons in place of the first.

## Files that change
- src/loop/directive.ts
- src/loop/controller.ts
- tests/scenarios/card-writer-lessons.test.ts (new)
- specs/tasks/_TEMPLATE.md
- templates/cards/_TEMPLATE.md
- .claude/agents/planner.md
- templates/claude/agents/planner.md
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- src/loop/context-pack.ts
- tests/core/context-pack.test.ts
- changelog.d/T1-CARD-WRITER-LESSONS.md (new)
- changelog.d/T1-PACK-KEEP-NEWEST.md (new)

## Order of work
1. T1-CARD-WRITER-LESSONS.
2. T1-PACK-KEEP-NEWEST, after it has merged: both edit `docs/OPERATIONS.md`.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-CARD-WRITER-LESSONS | MUST | the `plan` and `project-cards` directives carry the count and the ten most recent lessons and say to check each card against them; both card templates and both planner copies name `docs/LESSONS.md` | - | - | - |
| T1-PACK-KEEP-NEWEST | MUST | a context pack over its budget removes the earliest matching lesson first and keeps the rest in file order | T1-CARD-WRITER-LESSONS | - | - |

Budgets: 130 and 60 changed lines, 190 in total. The cards run one after the other.

## Risks
- Cards T0-PR-SUMMARY and T0-AMEND-DELTA were registered by another session on 2026-11-23.
  T0-PR-SUMMARY allows `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md`. Neither card of this
  plan runs beside a card that allows one of its paths; each reads its line numbers again at
  PREPARE.
- The lessons a card writer receives are prose. One outside study measured a one-line rule
  in an instruction file as followed on 60 to 68% of cases, so the measure below decides
  whether the delivery is kept, not the merge.
- The ten most recent lines are not all for the card writer: 17 of the newest 30 were, by
  hand labels. A selector is a later card only if the measure shows an effect worth refining.
- A person at a terminal sees the narration and not the lesson lines, as at PREPARE; the
  narration names the field and `--json` prints it.
- Card 2 changes an assertion that follows a requirement of a merged card. The owner
  approved the change of that requirement (`intent/lesson-delivery.md`, Decisions); the
  count of assertions in the file does not fall.
- Both card templates and the planner agent are installed by `aidlc init`, so downstream
  repositories get the text on their next init.
- Not verified before the cards run: that no test outside the DoD of card 1 reads the two
  rows of the directive table of `docs/ARCHITECTURE.md`; CI runs the whole suite.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: on main, `node --test tests/scenarios/card-writer-lessons.test.ts tests/core/context-pack.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/scenarios/lesson-dup.test.ts` passes.
- Arc: `git grep -n "lessons.pop" -- src` prints nothing, and `git grep -n "LESSONS" -- specs/tasks/_TEMPLATE.md templates/cards/_TEMPLATE.md .claude/agents/planner.md templates/claude/agents/planner.md` prints the line in all four files.
- Baseline, frozen on 2026-11-23T01:02:18Z at main ad088ed0 with `docs/LESSONS.md` at commit 6f8b1b9d (210 lesson lines). The rule: the first substantive formal decision of a card run (goal id and card id) is its earliest `REVIEW_DECIDED` event that is a pass or a block; second passes, base-sync reviews, rulings, quota holds and no-verdict attempts are left out; a block is on the card's text when a reason names dimension 1, 2, 6 or 14.
- Baseline of card 1: the 60 runs with the newest such decision, from 2026-11-17T02:58:02.477Z to 2026-11-23T00:28:40.763Z, hold 26 passes and 32 blocks on the card's text (53.3%); all 393 runs hold 177 and 196. Keep rule (`intent/lesson-delivery.md`, Decisions): at most 12 of the next 30 registered cards blocked on the card's text at the first formal decision; registered cards and reviewed runs counted apart, pending cards reported separately.
- Baseline of card 2: the 60 cards with status merged at ad088ed0 whose first substantive formal decision is newest, packed with an empty plan section. 20 packs are truncated, each of those 20 matches at least one of the 20 newest lesson lines, and the median number of those lines a pack keeps is 0 over all 60 and 0 over the 20 (18 keep none, 2 keep one). After the merge the same cohort and lessons file are packed again.

## 10. After merge
none this version (development-only target)
