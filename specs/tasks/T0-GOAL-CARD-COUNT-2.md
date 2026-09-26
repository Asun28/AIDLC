---
id: T0-GOAL-CARD-COUNT-2
title: The router takes ref= from the first known card id, counts every card id token when no known card list is passed, and a text naming several cards keeps the arc limit when --card names one of them
status: todo
branch: T0-GOAL-CARD-COUNT-2
worktree: D:\wt\AIDLC\T0-GOAL-CARD-COUNT-2
allow_paths:
  - src/core/router.ts
  - src/loop/controller.ts
  - tests/core/router.test.ts
  - tests/scenarios/goal-card-count.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-GOAL-CARD-COUNT-2.md
dod_command: npm run typecheck && node --test tests/core/router.test.ts tests/scenarios/goal-card-count.test.ts
dod_exit: 0
requirements:
  - R1. `classifyRequest` shall take `ref=` from the first known card id of the text in text order, so an unknown card id that comes before it ('implement T9-UNKNOWN then T3-API') is never the request's card.
  - R2. WHEN the caller passes no known card list, `classifyRequest` shall count every distinct card id token of the text: more than one routes with `cardCount` `unknown`, the `arc` module and a reason saying the registry was not consulted, never a silent one-card count.
  - R3. WHEN a request's text names several cards, `GoalController.createGoal` shall give the goal the arc limit also when `--card` names one of them; `--card` sets the goal's cards, not its deadline.
  - R4. The request kinds that reach the several-named-cards branch shall be pinned: a named card sets the kind to card-execute or card-amendment before release or migration is considered, and a card-amendment text naming two known ids routes with `cardCount` `unknown`.
  - R5. `docs/OPERATIONS.md` (the goal deadline bullet of T0-GOAL-CARD-COUNT) and `CHANGELOG.md` shall state R1 to R3.
acceptance:
  - 1. `tests/core/router.test.ts`: one known and one unknown card id in either order route with `cardCount` 1 and `ref=` the known id for a T0 size. [R1] [dod arm 1]
  - 2. `tests/core/router.test.ts`: with no known card list, one card id token keeps `cardCount` 1, and two tokens route with `cardCount` `unknown`, the `arc` module and the registry reason. [R2] [dod arm 1]
  - 3. `tests/scenarios/goal-card-count.test.ts`: the issue #73 request with `--card` one of its two cards keeps that card and gets the 12 h arc deadline; `--card` alone on a one-card text keeps 3 h. [R3] [dod arm 1]
  - 4. `tests/core/router.test.ts`: a release text and a migration text that name two known ids route as card-execute with `cardCount` `unknown`, and a card-amendment text naming two known ids routes as card-amendment with `cardCount` `unknown`. [R4] [dod arm 1]
  - 5. `tests/scenarios/goal-card-count.test.ts` reads the exact sentences this card adds to `docs/OPERATIONS.md` and the CHANGELOG Unreleased section and fails with any one removed. [R5] [dod arm 1]
depends_on: [T0-GOAL-CARD-COUNT]
budget: 160
tdd: true
sweep: "Starts from the merged T0-GOAL-CARD-COUNT: router.ts computes namedCards from the known card list only (an absent list names none) and keeps the first card id token of the text as ref= (cardMatch), known or not; controller.ts derives the deadline count from --card (options.cards) whatever the router counted from the text, and forces the arc only for an explicit T1 or T2."
forbid: [weakening or skipping a test to go green, editing src/state/goal-store.ts or src/loop/card-runner.ts, making the known card list a required router input (the UserPromptSubmit route preview runs without the registry)]
non_goals: [reading card ids from an issue body, inferring the size from the number of named cards]
hygiene: "Follow-up of T0-GOAL-CARD-COUNT (issue #73): the four R2 edge-cases questions of that card (logs .review/T0-GOAL-CARD-COUNT.pre.0.1.1.3e172325.edge-cases.log and .pre.1.1.1.e111e31b.edge-cases.log), ruled by the coordinating session into this card because that card's candidate was bound when R2 passed. If T0-GOAL-CARD-COUNT stops at its second R3 decision instead of merging, this card becomes its replacement and also carries whatever that decision names. Every acceptance item has a DoD-run test (docs/LESSONS.md 2026-09-26 T0-BASE-SYNC-JSDOC); run the mutation sweep before the first review."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-GOAL-CARD-COUNT-2

## Deliverable
The router's card reference and count no longer depend on where an unknown id sits in the text or on whether the caller passed the registry, and a request that names several cards keeps the arc deadline even when `--card` picks one of them.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/router.test.ts tests/scenarios/goal-card-count.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
