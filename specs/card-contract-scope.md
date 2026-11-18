---
slug: card-contract-scope
title: A card's forbid list holds hard boundaries only and a card states each behaviour once, the operator runs one coordinator session per card, and PREPARE no longer tells the implementer to read every lesson
intent: intent/card-contract-scope.md
status: draft
created: 2026-11-18T10:40:00Z
skills_applied: []
---

# Spec: A card's forbid list holds hard boundaries only and a card states each behaviour once, the operator runs one coordinator session per card, and PREPARE no longer tells the implementer to read every lesson
From intent: intent/card-contract-scope.md. Status: draft. Skills applied: none (the intent lists no open question).

## Requirements (EARS)
- R1. The two card templates and the two planner agent copies shall say that `forbid` holds hard boundaries only: no incidental line, function-body or import-line restriction, a frozen API may be named, and no such restriction is restated in `requirements`, which state observable behaviour.
- R2. The two card templates and the two planner agent copies shall say that a card states each behaviour once: an acceptance item names its proof and its requirement, unique edge cases and rationale stay, and fixtures and implementation instructions are not repeated.
- R3. The file `docs/OPERATIONS.md` shall tell the operator to run one interactive coordinator session per card until goal run-attribution attributes the coordinator's spend, to start the new session only when the card before it is closed, and to follow the Sessions section for ownership.
- R4. The narration of the PREPARE directive shall name the lesson count, say that the most recent lessons are in the directive and name `docs/LESSONS.md` for reference, with no instruction to read the file.
- R5. The Lessons paragraph of `docs/OPERATIONS.md` shall say that at PREPARE the loop reads `docs/LESSONS.md` and puts the count and the five most recent lines in the directive, and that the implementer is not asked to read the file.

## Design
Guidance text (R1, R2). `specs/tasks/_TEMPLATE.md` and `templates/cards/_TEMPLATE.md` differ
only on the `worktree` line. The comment of the `forbid` key (line 32 in both) keeps its
definition, "hard boundaries this card may not cross: network, credentials, frozen
contracts", and gains the rule of R1. The comments under `acceptance:` (lines 17 to 19) gain
the rule of R2 beside the existing line on card length. In both planner copies the ready
check line "Every card states its boundaries: allow_paths, non_goals, forbid." (line 38)
gains both rules. `REVIEW.md` keeps a `forbid:` item as a must-block hit of dimension 2
(`REVIEW.md:23`), which is why the guidance narrows what a card lists there and adds no
check: the measure is the count of scope-narrowing items in later cards.

Operator paragraph (R3). One paragraph in the Setup section of `docs/OPERATIONS.md`, after
the Coordinator effort paragraph (line 31), whose topic is the coordinator session's cost.
`tests/surface/coordinator-effort.test.ts:49-57` pins that paragraph two lines after the
Claude Code effort paragraph and an empty line after it, and pins nothing below. The
paragraph names goal run-attribution as the end of the practice and points to the Sessions
section: a new session is a new identity (`docs/OPERATIONS.md:237`), so it starts when no
card lease of the old one is live.

Narration (R4). `src/loop/card-runner.ts:1110` builds the narration from a first sentence
and the worktree sentence. The first sentence becomes: the count, "the most recent are in
this directive", and `docs/LESSONS.md` named as available for reference. `readLessons`
(`src/artifacts/lessons.ts:134`) and the `lessons` field of the directive do not change.
The PREPARE test (`tests/scenarios/t0-flow.test.ts:2087-2110`) keeps its assertions on the
file, the count and the five most recent lines and gains one: the narration holds no
instruction to read the file. No other test, skill, agent file or document holds the old
sentence [SOURCE: grep of 2026-11-18 over `tests`, `docs`, `.claude`, `templates`, `bench`,
`evals` and `README.md` for "lessons so far", "before the first attempt" and "Read
docs/LESSONS"].

Lessons paragraph (R5). `docs/OPERATIONS.md:686` says "PREPARE reads it once per card". It
then says who reads: the loop reads the file and the directive carries the count and the
five most recent lines.

## Interfaces and contracts
- The `narration` string of the `prepare` directive changes its first sentence. The
  directive's fields, the review prompts, the context pack and every persisted record keep
  their shape.
- The two card templates and the planner agent are installed by `aidlc init`; a downstream
  repository gets the new comments on its next init.

## Data model and migration impact
none

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- An `aidlc cards validate` finding on `forbid` items or on card length; a word-count gate.
- A change to `REVIEW.md`, to `reviewPolicyVersion` or to a registered card.
- Lesson matching at PREPARE, or a change to the lessons in the review prompts.
- Implicit `allow_paths` entries, a command that replaces a card, and the label
  "unchanged-code successor" (the replacement study of `intent/card-preflight.md`).
- Attributing the coordinator's spend (`intent/run-attribution.md`).

## Acceptance
- 1. Both card templates and both planner copies hold the rules of R1 and R2, the planner copies are byte-identical, and the tests that read these files pass with no line changed. [R1] [R2]
- 2. `docs/OPERATIONS.md` holds the operator paragraph of R3, and the Coordinator effort paragraph stays where its test pins it. [R3]
- 3. The PREPARE test asserts that the narration holds no instruction to read `docs/LESSONS.md`, fails on main, and keeps its assertions on the file, the count and the five most recent lines. [R4]
- 4. The Lessons paragraph of `docs/OPERATIONS.md` states R5. [R5]
