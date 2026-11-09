---
id: T0-CARD-SIZE
title: "`aidlc cards validate` blocks a card that changes src/ with a budget over 250 and tells the author to split it, unless the card records a size_exception"
status: todo
branch: T0-CARD-SIZE
worktree: D:\wt\AIDLC\T0-CARD-SIZE
allow_paths:
  - src/artifacts/card.ts
  - src/core/types.ts
  - tests/surface/card.test.ts
  - specs/tasks/_TEMPLATE.md
  - templates/cards/_TEMPLATE.md
  - specs/tasks/T1-BOUND-TELEMETRY-6.md
  - specs/tasks/T1-RUN-DRIVER-3.md
  - specs/tasks/T1-BOARD-WATCH.md
  - specs/tasks/T0-CARD-TERMINAL-GOAL-2.md
  - specs/tasks/T0-CARD-LEASE-HEARTBEAT.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-CARD-SIZE.md
dod_command: npm run typecheck && node --test tests/surface/card.test.ts tests/surface/budget-doc.test.ts
dod_exit: 0
requirements:
  - R1. WHEN a card's `allow_paths` holds an entry under `src/` (backslashes read as slashes, a leading `./` removed) and its `budget` is above `MAX_CODE_CARD_BUDGET` (250, exported from `src/artifacts/card.ts`), `parseCardText` shall add one `[CARD-SIZE]` finding naming the budget, the limit and the remedy (split the card, or record the approval as `size_exception`); a card with no `src/` entry, with no `budget`, or with a budget of 250 or less gets none. `renderCard` (the drafts of `aidlc cards project`) shall default `budget` to `MAX_CODE_CARD_BUDGET`, so a rendered card passes.
  - R2. The finding shall be blocking on a card that is neither `merged` nor superseded and has no non-blank `size_exception`, and a warning otherwise.
  - R3. The `Card` schema and the card reader shall accept an optional `size_exception` string, read from its own front-matter line as a YAML scalar; a value that does not parse alone or is not a string is no exception (R3 decision 1, F1).
  - R4. In the registry, T1-BOUND-TELEMETRY-6 shall carry `superseded_by: T1-BOUND-STATS` and T1-RUN-DRIVER-3 `superseded_by: T1-BOARD-WATCH` (user rulings of 2026-10-09, plan section 2026-11-09 follow-up cards), and T1-BOARD-WATCH, T0-CARD-TERMINAL-GOAL-2 and T0-CARD-LEASE-HEARTBEAT a `size_exception` stating that their budget predates this rule; the repository then loads with no blocking `[CARD-SIZE]`.
  - R5. `docs/OPERATIONS.md` (a paragraph after the card front matter paragraph) and the CHANGELOG Unreleased section shall each state R1 and R2 under this card id, and each of the two card templates shall carry a commented `size_exception` line after the budget line, which stays byte-identical.
acceptance:
  - 1. `tests/surface/card.test.ts`: a todo card with `src/foo.ts` and budget 251 has exactly one `[CARD-SIZE]`, blocking, whose message names 251, 250, split and `size_exception`; budget 250, no budget, and budget 900 with only `docs/` and `tests/` paths give none, and a `renderCard` card with a `src/` path and no budget gets budget 250 and none. Fails before the fix. [R1] [R2] [dod arm 1]
  - 2. Same file: the budget-251 card gets a warning instead when merged, when superseded and with `size_exception: "approved"`; `size_exception: ""`, `"   "`, a bare comment, an empty `|`, `"	"` and `42` keep the block; `src\foo.ts` and `./src/foo.ts` count as `src/` paths. [R1] [R2] [R3] [dod arm 1]
  - 3. Same file: this repository's registry has no blocking `[CARD-SIZE]`, and the two cards of R4 carry their `superseded_by`. [R4] [dod arm 1]
  - 4. `tests/surface/budget-doc.test.ts` passes unchanged. [R5] [dod arm 1]
  - 5. `tests/surface/card.test.ts` reads the exact sentence the card adds to `docs/OPERATIONS.md` and to the CHANGELOG Unreleased section, and the `size_exception` line in each template; that the sentence states R1 and R2 is reviewer-verified against the diff. [R5] [dod arm 1]
depends_on: []
budget: 200
tdd: true
sweep: "grep -rn \"\\.budget\\b\\|'budget'\\|superseded_by\" src: the only budget readers are src/artifacts/card.ts:80 (reader) and :308 (renderCard default 400: the scenario harness renders src/ cards with it, so the default becomes the limit, found by the full suite); superseded_by is read by card.ts:126 (active), worktree-reclaim.ts:85 and review/stats.ts:384. Neither T1-BOUND-TELEMETRY-6 nor T1-RUN-DRIVER-3 has a worktree, so reclaim removes nothing. Lines are from main at 45be09a."
forbid: [changing the severity or text of another card check, a new config key, changing what `budget` means or how a ship path reads it, changing the template budget line, editing .aidlc state by hand, weakening or skipping a test]
non_goals: [comparing a candidate's diff with its budget on the github or dry-run ship path, a size rule for cards that change no src/ path, counting an entry that names src/ other than as a relative path starting with `src/` after R1's two rewrites (an absolute path, other letter case, `../`, a glob), a limit on the number of allow_paths, a configurable limit or code root, splitting T0-CARD-TERMINAL-GOAL-2 or T0-CARD-LEASE-HEARTBEAT]
diagnosis:
  root_cause: "Nothing limits a card's size before BUILD. Over 256 card runs (bounds and review analysis of 2026-11-10), code cards with a budget of 250 or less stopped on R3 review in 10 to 15 percent of runs and those above 250 in 44 to 60 percent; review stops then account for 30 of the 45 cancelled goals and 7 of the 10 time-stopped goals."
  same_class: "The ship-path budget gate (scaffold only) checks the diff after BUILD; this card checks the declared budget before PREPARE. Both stay."
---

# T0-CARD-SIZE

## Deliverable
A `[CARD-SIZE]` check in `parseCardText` next to the existing `active` rule (`src/artifacts/card.ts:126`), an optional `size_exception` field, the five registry edits of R4, and the docs.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/card.test.ts tests/surface/budget-doc.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and both test files pass.

## Attempt evidence

Attempt 1 (RED 577557e, fix cbce2f7): R3 decision 1 blocked on F1 (blank-size-exception-bypass), and the full suite failed 70 scenario tests because renderCard's default budget 400 blocked every harness card.
Attempt 2 (RED bf77662: the F1 forms and the renderCard default failed before the repair): size_exception is decoded from its own line as a YAML scalar; renderCard defaults budget to MAX_CODE_CARD_BUDGET.

| Item | Proof | Result |
|---|---|---|
| 1 | tests/surface/card.test.ts, "a todo card that changes src/ with budget 251 gets one blocking finding ..." (incl. the renderCard card) | pass |
| 2 | same file, "merged, superseded or a non-blank size_exception makes it a warning ..." (incl. the F1 forms and 42) | pass |
| 3 | same file, "this repository loads with no blocking [CARD-SIZE] ..." (reads the worktree registry; `aidlc cards validate` reads the main checkout's until the merge) | pass |
| 4 | tests/surface/budget-doc.test.ts, unchanged | pass |
| 5 | same card.test.ts file, "docs/OPERATIONS.md, the CHANGELOG Unreleased section and both card templates carry the rule" | pass |

DoD and full suite: see the attempt 2 receipt.
