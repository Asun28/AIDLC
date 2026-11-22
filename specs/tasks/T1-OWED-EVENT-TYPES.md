---
id: T1-OWED-EVENT-TYPES
title: "A card-run write can owe a CARD_STATE and a NOTE event to the goal journal"
status: merged
branch: T1-OWED-EVENT-TYPES
worktree: D:\wt\AIDLC\T1-OWED-EVENT-TYPES
plan_ref: plans/card-continuation.md#order-of-work
allow_paths:
  - src/core/types.ts
  - tests/core/owed-event.test.ts
  - changelog.d/T1-OWED-EVENT-TYPES.md
  - specs/tasks/T1-OWED-EVENT-TYPES.md
dod_command: npm run typecheck && node --test tests/core/owed-event.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. The `OwedEvent` schema shall accept the types `CARD_STATE` and `NOTE` beside the eight it accepts on main at 30d52466.
  - R2. The `CardRun` schema shall parse a run whose `journalOwed` holds an entry of each of the two types and refuse an entry whose type is none of the ten.
  - R3. The comment of `OwedEvent` in `src/core/types.ts` and the file `changelog.d/T1-OWED-EVENT-TYPES.md` shall name the two types and the writes that owe them: the continuation of a stopped run (`CARD_STATE`, card T1-CONTINUE-REVIEW) and the amendment of a started card (`NOTE`, card T1-CARD-AMEND).
acceptance:
  - 1. `tests/core/owed-event.test.ts`. `OwedEvent.parse` accepts one entry of each of the ten types and throws for the type `GOAL_STATE` and for an empty type. [R1] [dod arm 2]
  - 2. Same file. `CardRun.parse` of a run built with `cardRun` whose `journalOwed` holds a `CARD_STATE` entry and a `NOTE` entry returns both entries deep-equal to the input, and throws when a third entry has the type `GOAL_STATE`. [R2] [dod arm 2]
  - 3. The typecheck passes, and `tests/scenarios/journal-owed.test.ts` and `tests/scenarios/fault-points.test.ts` pass with no line changed. [dod arm 1] [dod arm 2]
  - 4. The comment and the changelog fragment state R3 (reviewer-verified against the diff). [R3]
depends_on: []
budget: 40
forbid: [weakening or skipping a test to go green, a change to how an owed event is delivered or matched, editing .aidlc state by hand]
non_goals: [a write that owes either event (T1-CONTINUE-REVIEW, T1-CONTINUE-CI and T1-CARD-AMEND), a new journal event type, a change to `journalHolds`, `owedDue` or `deliverOwed` in src/loop/card-runner.ts, which match and append an owed event by its type and key whatever the type is]
hygiene: "Line numbers are from main at 30d52466: the schema is at src/core/types.ts:870-876 and `CardRun.journalOwed` at :962. Found at the first dispatch of T1-CONTINUE-REVIEW: its R3 has the runner owe a `CARD_STATE` event, the store checks every card-run write against the schema (src/state/goal-store.ts:84), and the enum refused the type."
---

# T1-OWED-EVENT-TYPES

## Deliverable
The list of events a card-run write may owe to the goal journal gains `CARD_STATE` and `NOTE`.

## Why
`specs/card-continuation.md`, "Record and journal": a continuation journals a `CARD_STATE` event and an amendment a `NOTE` event, each owed by the write that records the act, so that an append that failed is made once by the next command on the card. The owed list is a closed enum, and neither type is in it. T1-CONTINUE-REVIEW and T1-CARD-AMEND may not change `src/core/types.ts`.

## Rules that decide edge cases
- The enum grows by exactly two values. Delivery and matching are generic and do not change.
- A point this card does not cover is a follow-up issue, not a change to this card.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/owed-event.test.ts tests/scenarios/journal-owed.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck reports no error and every test of the three files passes.

## Attempt evidence
| Item | Evidence |
|---|---|
| 1 [R1] | `tests/core/owed-event.test.ts`, suite "OwedEvent type": one test per type for the ten types, plus "refuses the type GOAL_STATE" and "refuses an empty type". RED at 071a67f9: "accepts an owed CARD_STATE event" and "accepts an owed NOTE event" failed with a zod `invalid_value` listing the eight types of main. |
| 2 [R2] | Same file, suite "CardRun journalOwed": "a run owing a CARD_STATE and a NOTE event parses with both entries unchanged" (failed at RED for the same cause) and "a run owing an event of type GOAL_STATE is refused". |
| 3 | DoD command: typecheck clean; `journal-owed.test.ts` and `fault-points.test.ts` pass, neither file changed (`git diff --stat origin/main` lists neither). |
| 4 [R3] | Comment above `OwedEvent` in `src/core/types.ts` and `changelog.d/T1-OWED-EVENT-TYPES.md` name `CARD_STATE` (continuation of a stopped run, T1-CONTINUE-REVIEW) and `NOTE` (amendment of a started card, T1-CARD-AMEND). |
| Guard sweep | Guard added: the two enum values. Without `NOTE`: "accepts an owed NOTE event" and the CardRun parse test fail. Without `CARD_STATE`: "accepts an owed CARD_STATE event" and the CardRun parse test fail. Both restored. |
