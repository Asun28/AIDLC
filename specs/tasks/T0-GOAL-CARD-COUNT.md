---
id: T0-GOAL-CARD-COUNT
title: A goal request that names several known card ids, or carries an explicit T1 or T2 size, gets the arc deadline, and its card count is left to the projection instead of the first card id in the text
status: todo
branch: T0-GOAL-CARD-COUNT
worktree: D:\wt\AIDLC\T0-GOAL-CARD-COUNT
allow_paths:
  - src/core/router.ts
  - src/loop/controller.ts
  - tests/core/router.test.ts
  - tests/scenarios/goal-card-count.test.ts
  - tests/scenarios/deadline.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-GOAL-CARD-COUNT.md
dod_command: npm run typecheck && node --test tests/core/router.test.ts tests/scenarios/goal-card-count.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a request's text names more than one distinct known card id, `classifyRequest` shall route it with `cardCount` `unknown` and the `arc` module, and name every such id in a reason; a request naming one known card id keeps its count.
  - R2. `GoalController.createGoal` shall take the goal's card from the text's `ref=` only when the routed `cardCount` is 1; otherwise the goal starts with no card, and the projection (`aidlc report --result cards-projected --cards ...`) names them.
  - R3. A goal whose size is an explicit T1 or T2 shall get the arc limit, also when `--card` names one card and also for a release goal (whose one-card limit applies only without an explicit T1 or T2); the goal's cards stay as given, and a tighter user limit still wins.
  - R4. `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and `CHANGELOG.md` shall state how the goal deadline's card count is decided.
acceptance:
  - 1. `tests/core/router.test.ts`: a text naming two known card ids routes with `cardCount` `unknown`, the `arc` module and a reason naming both, with or without an explicit size; a text naming one known card id, or one known and one unknown id, keeps `cardCount` 1 for a T0 size. [R1] [dod arm 1]
  - 2. `tests/scenarios/goal-card-count.test.ts`: a goal from the issue #73 request (two known card ids, explicit T1) and the same request with no size start with no card and the 12 h arc deadline; a goal with `--card` one card and an explicit T1 or T2 keeps that card and gets 12 h; a goal naming one known card id with no size or an explicit T0 keeps that card and gets 3 h, and so does `--card` one card with a T1 the router inferred from impact words (only an explicit T1 or T2 forces the arc); a release goal with an explicit T1 or T2 gets 12 h while a release with no explicit size keeps the one-card 3 h, and a tighter `--limit-hours` still wins over the arc limit. [R2] [R3] [dod arm 1]
  - 3. `tests/scenarios/goal-card-count.test.ts` reads the exact sentences this card adds to `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md` and the CHANGELOG Unreleased section and fails with any one removed. [R4] [dod arm 1]
depends_on: []
budget: 180
tdd: true
sweep: "grep -n 'ref=\\|explicitCards\\|cardCount' src/core/router.ts src/loop/controller.ts src/core/deadlines.ts: router.ts:59 matches the first card id of the text only, :80-:89 keep it as the single ref, :164-:178 set cardCount (1 for T0 and T0-bugfix and card-amendment, unknown for T1 and T2), :204 emits ref=; controller.ts:125 builds explicitCards from options.cards or that single ref, :126 lets it override routing.cardCount, :127 passes the count to computeGoalDeadlines, :161-:162 store the cards; deadlines.ts:31 picks the arc limit for unknown or more than one card and is not changed. The CLI goal new passes --card as options.cards (main.ts:235). Existing pins: router.test.ts:30, :76, :87, :146; deadline.test.ts:15 (one card, 3 h) and :164 (two cards T1, 12 h); deadline.test.ts:193-:224 builds an explicit T2 goal with one card and extends it to 6 h after the card's time stop, which assumed the 3 h goal deadline R3 removes: its extension target moves past the 12 h arc deadline, and its assertions stay."
forbid: [weakening or skipping a test to go green, editing src/state/goal-store.ts or src/loop/card-runner.ts, changing the 3 h and 12 h limits or computeGoalDeadlines, a deadline set from a guessed card list]
non_goals: [inferring the size from the number of named cards, reading card ids from an issue body, changing an existing goal's deadline (aidlc goal extend stays the only way)]
diagnosis:
  root_cause: "classifyRequest keeps only the first card id of the text as ref=, and createGoal turns a card-execute routing into explicitCards from that ref whatever the routed count is, so a request naming two cards, or carrying an explicit T1 whose routed count is unknown, gets cardCount 1 and the 3 h one-card limit (issue #73: goal g-20260926084928-7dd932)."
  same_class: "The count reaches computeGoalDeadlines only through createGoal; the --card option is the other source of a one-card count, covered by R3."
hygiene: "Filed from issue #73. Option chosen: leave the count unknown so the projection decides (not list every named id). A request can name a card without asking to run it ('after T1-A, do T1-B'), the projection is the authority for the card list, and an unknown count selects the arc limit without guessing; each card keeps its own 3 h limit. Every acceptance item has a DoD-run test from the first candidate (docs/LESSONS.md 2026-09-26 T0-BASE-SYNC-JSDOC); run the mutation sweep before the first review."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-GOAL-CARD-COUNT

## Deliverable
`aidlc goal new` no longer gives a multi-card or explicitly T1 or T2 request the 3 h one-card deadline. A text that names several known card ids leaves the count to the projection, an explicit T1 or T2 always gets the 12 h arc limit, and a request for one card keeps the 3 h limit it has today.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/router.test.ts tests/scenarios/goal-card-count.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
