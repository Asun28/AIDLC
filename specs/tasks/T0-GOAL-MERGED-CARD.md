---
id: T0-GOAL-MERGED-CARD
title: aidlc goal new refuses a request whose card is already merged, since that goal has no work to do and can close as DONE
status: todo
branch: T0-GOAL-MERGED-CARD
worktree: D:\wt\AIDLC\T0-GOAL-MERGED-CARD
allow_paths:
  - src/loop/controller.ts
  - tests/scenarios/goal-merged-card.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-GOAL-MERGED-CARD.md
dod_command: npm run typecheck && node --test tests/scenarios/goal-merged-card.test.ts tests/scenarios/t1-arc.test.ts tests/scenarios/card-goal.test.ts
dod_exit: 0
requirements:
  - R1. When the goal's card list holds a card whose registry status is `merged` and the routing kind is not `card-amendment`, `createGoal` shall throw before it writes a goal, lease or journal record.
  - R2. The R1 message shall name each merged card and state that a new requirement goes on a successor card passed with `--card`.
  - R3. A request routed as `card-amendment` on a merged card shall still create its goal.
  - R4. `docs/OPERATIONS.md` and the CHANGELOG Unreleased section shall state the rule and name this card.
acceptance:
  - 1. `tests/scenarios/goal-merged-card.test.ts`: with `T0-OLD` merged, `createGoal` throws a message containing `T0-OLD` and `successor`, and `listGoals()` stays empty, both for `cards: ['T0-OLD']` with a text naming no card and for the text `implement T0-OLD` alone; the test fails on main. [R1] [R2] [dod arm 2]
  - 2. Same file: the text `reword the card text of T0-OLD` creates a goal whose routing kind is `card-amendment` and whose cards are `['T0-OLD']`. [R3] [dod arm 2]
  - 3. `tests/scenarios/t1-arc.test.ts` and `tests/scenarios/card-goal.test.ts` pass unchanged, so a merged prerequisite of the goal's card is not refused. [R1] [dod arm 2]
  - 4. The OPERATIONS and CHANGELOG text (reviewer-verified against the diff). [R4]
depends_on: []
budget: 90
tdd: true
sweep: "With a two-line trial guard in `createGoal`, `npm test` on main at adea32d gave 2393 tests, 2382 pass, 0 fail, 11 skipped, so no test pins a goal on a merged card."
diagnosis:
  root_cause: "`createGoal` reads the registry for card ids only, never for status, and the arc counts a merged card as closed, so `next` goes from `project-cards` to `verify-arc` with nothing to run."
  same_class: "Only `aidlc goal new` calls `createGoal` (`src/cli/main.ts:256`)."
forbid:
  - a flag or environment variable that skips the refusal
  - refusing because the request text names a merged card while `--card` names another card
  - deleting or weakening an existing test
non_goals:
  - a card whose PR merged but whose close has not yet written `status: merged`
  - goal amend, goal repair and goal resume
  - a second goal on a card that another open goal runs
---

# T0-GOAL-MERGED-CARD

## Deliverable
A check in `createGoal` (`src/loop/controller.ts`), after `explicitCards` is computed, for R1 to R3, and the R4 text.

## Why
On 2026-11-07 a session working from an old context opened goal `g-20261107073341-d8975a` with `--card T0-CARD-SHORT`, merged in PR 223 hours earlier; it was cancelled by hand. On a test fixture the same request goes from `project-cards` straight to `verify-arc` ("All required cards closed"), and `arc-verified` closes it, so a goal can report a request delivered with no change made.

## Limits
The registry status is written at card close, so a card whose PR merged and whose close has not run yet still passes the check.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/scenarios/goal-merged-card.test.ts`, the two acceptance 1 tests: each checks the message, `listGoals()`, the journal and the lease directories. RED on 2d3468f: both fail with `Missing expected exception` | pass |
| 2 | Same file, acceptance 2 test; it passes on main by design, since R3 keeps today's behaviour | pass |
| 3 | `tests/scenarios/t1-arc.test.ts`, `tests/scenarios/card-goal.test.ts`, neither file changed | pass |
| 4 | `docs/OPERATIONS.md`, the paragraph before the T0 bugfix heading; `CHANGELOG.md`, entry T0-GOAL-MERGED-CARD | reviewer reads the diff |

Other checks: `npm test` gave 2774 tests, 2762 pass, 1 fail, 11 skipped. The failure was `tests/surface/prose.test.ts` acceptance 8, which caps the OPERATIONS Sessions section at 13701 bytes; the paragraph first sat there and took it to 14094. It now sits in Running a goal, no test changed, and `prose.test.ts` and `templates.test.ts` pass.
