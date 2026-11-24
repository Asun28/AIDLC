---
slug: lesson-delivery
title: The lessons of docs/LESSONS.md reach whoever writes a card, and the context pack keeps the newest matching lessons
intent: intent/lesson-delivery.md
status: draft
created: 2026-11-23T01:35:00Z
skills_applied: []
---

# Spec: The lessons of docs/LESSONS.md reach whoever writes a card, and the context pack keeps the newest matching lessons
From intent: intent/lesson-delivery.md. Status: draft. Skills applied: none (the intent lists no open question).

## Requirements (EARS)
- R1. The `plan` directive and the `project-cards` directive shall each carry a `lessons` field that holds the path of `docs/LESSONS.md`, the count of its valid lesson lines and its ten most recent lesson lines in file order.
- R2. The narration of the `plan` directive and of the `project-cards` directive shall name the lesson count and `docs/LESSONS.md` and say that every card is checked against the lessons of the `lessons` field before it is registered.
- R3. The two card templates and the two planner agent copies shall say that the directive that asks for cards carries the most recent lessons of `docs/LESSONS.md` and that a card is checked against them before it is registered.
- R4. The Lessons paragraph of `docs/OPERATIONS.md` and the directive table of `docs/ARCHITECTURE.md` shall say that the `plan` and `project-cards` directives carry the count and the ten most recent lesson lines.
- R5. WHEN the serialized context pack exceeds its budget, the context pack shall remove the earliest matching lesson line first and keep the remaining lines in file order.
- R6. The context pack paragraph of `docs/OPERATIONS.md` shall say that whole lessons are removed from the start first, the oldest matching line before a newer one.

## Design
Directive field (R1). `src/loop/directive.ts:23-24` defines the `plan` and `project-cards`
kinds. Each gains an optional `lessons` object with `file`, `count` and `recent`, the shape
`readLessons` returns (`LessonsContext`, `src/artifacts/lessons.ts:32-36`) and the PREPARE
directive already carries (`src/loop/card-runner.ts:1352-1367`). The field is optional in the
schema, so a directive built without it still parses, and the controller always sets it.
`GoalController` builds these directives at four places: `src/loop/controller.ts:304`,
`:312` and `:318` in `nextInPlan` (a T0 goal with an existing card, a goal in PLAN with an
accepted plan, and a goal with neither) and `:329` in `nextInCards` (a goal in CARDS with no
valid projection, which a T1 goal reaches after `plan-produced`). Each reads `readLessons(lessonsPath(this.repo.mainRoot), 10)`. A missing file
gives a count of 0 and no lines; a file that exists and cannot be read fails the command, as
at PREPARE.

Narration (R2). Each narration of those four places keeps the text it has and gains one sentence
with the count, the file name and the instruction. Lesson text is repository data: it goes in
the `lessons` field and never into the narration, where card T0-NARRATION-QUOTE requires
repository text to be quoted.

Guidance text (R3). Both card templates gain one comment line under `acceptance:`, beside the
lines on card length and on stating each behaviour once. Both planner copies gain one line
under their inputs. The planner copies stay byte-identical and the templates differ only on
their `worktree` line.

Documents (R4). The Lessons paragraph of `docs/OPERATIONS.md:739` gains one clause after the
PREPARE clause and before `CLOSE appends at most one dated`; `tests/scenarios/lesson-dup.test.ts:105-106`
pins the end of that paragraph, which stays. The rows of `plan` and `project-cards` in the
directive table of `docs/ARCHITECTURE.md:159-160` name `lessons`.

Removal order (R5). `src/loop/context-pack.ts:77` removes a line with `pop()`. It removes the
first line of the list in its place; the kept lines stay in file order, which requirement R3
of T1-RUN-CONTEXT-PACK-2 asks for, and `truncated.lessons` counts as before. The test at
`tests/core/context-pack.test.ts:30-36` follows the old order and changes with it: at its
budget of 285 bytes the pack is 297 bytes with both lessons, 278 with the first only and 281
with the second only, so the second lesson fits where the first did.

Pack paragraph (R6). `docs/OPERATIONS.md:63` says "whole lessons are removed from the end
first". It then says from the start, the oldest matching line before a newer one.

## Interfaces and contracts
- The `plan` and `project-cards` directives gain an optional `lessons` field. Every other
  field, the PREPARE directive, the review prompts and every persisted record keep their
  shape. `aidlc next`, `aidlc goal new` and `aidlc report` print the field in JSON, the
  default when stdout is not a terminal.
- The fields of the context pack and its budget do not change; only which lessons a
  truncated pack keeps.
- The two card templates and the planner agent are installed by `aidlc init`; a downstream
  repository gets the new lines on its next init.

## Data model and migration impact
none

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- An audience mark, a keyword selector or a new lesson kind; choosing lessons by score.
- The human line of `aidlc next`, `aidlc goal new` and `aidlc report`, which prints the
  narration and not the lesson lines.
- A change to which lessons match a card, to the PREPARE directive or to a review prompt.
- An edit to the merged card T1-RUN-CONTEXT-PACK-2.
- The additions to `intent/run-attribution.md`, the issue on checked lesson sources and the
  hand read of sessions (`intent/lesson-delivery.md`, Proposed outcome).

## Acceptance
- 1. With a lessons file of 12 valid lines, the `plan` directive and the `project-cards` directive of each place that builds one carry the count 12 and the last 10 lines in file order, and with no file the count 0 and no lines. [R1]
- 2. The narration of each of those directives names the count and `docs/LESSONS.md`, says to check each card before it is registered, and keeps the text it has on main. [R2]
- 3. Both card templates and both planner copies hold the line of R3, the planner copies are byte-identical, and the tests that read these files pass with no line of them changed. [R3]
- 4. The Lessons paragraph of `docs/OPERATIONS.md` and the directive table of `docs/ARCHITECTURE.md` state R4. [R4]
- 5. A truncated context pack keeps the last matching lessons in file order, the changed assertion of `tests/core/context-pack.test.ts:30` fails on main, and no other assertion of that file changes. [R5]
- 6. The context pack paragraph of `docs/OPERATIONS.md` states R6. [R6]
