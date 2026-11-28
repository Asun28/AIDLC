---
id: T0-CARD-SIZE-150
title: "The budget limit of a card that changes src/ goes from 250 lines to 150, in the constant and in the texts that state a card's size"
status: todo
branch: T0-CARD-SIZE-150
worktree: D:\wt\AIDLC\T0-CARD-SIZE-150
allow_paths:
  - src/artifacts/card.ts
  - tests/surface/card.test.ts
  - tests/surface/budget-doc.test.ts
  - docs/OPERATIONS.md
  - specs/tasks/_TEMPLATE.md
  - templates/cards/_TEMPLATE.md
  - .claude/agents/planner.md
  - templates/claude/agents/planner.md
  - specs/tasks/T0-FOREIGN-DISPATCH-NO-WRITE-2.md
  - specs/tasks/T1-R3-PANEL.md
  - specs/tasks/T0-FOREIGN-DISPATCH-NO-WRITE.md
  - specs/tasks/T0-TAKEOVER-DONE-GOAL.md
  - specs/tasks/T1-INIT-HOOK-LOCAL.md
  - specs/tasks/T1-INIT-PROFILE.md
  - specs/tasks/T1-SHIP-PUBLISH.md
  - specs/tasks/T1-SHIP-PUBLISH-WIRE.md
  - specs/tasks/T1-DOD-GATE.md
  - specs/tasks/T1-SHIP-SCAN.md
  - specs/tasks/T1-R3-PANEL-FOLD.md
  - changelog.d/T0-CARD-SIZE-150.md
  - specs/tasks/T0-CARD-SIZE-150.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/surface/card.test.ts tests/surface/budget-doc.test.ts tests/surface/edge-scope.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `MAX_CODE_CARD_BUDGET` in `src/artifacts/card.ts` shall be 150 and its comment shall be text A of the section Exact texts. No other line under `src/` changes, because the `[CARD-SIZE]` message and the `renderCard` default read the constant.
  - R2. The paragraph of `docs/OPERATIONS.md` that starts `Card size (card T0-CARD-SIZE).` shall be text B of the section Exact texts, which differs from the paragraph on main in three places, the limit, the default budget of a rendered draft card and the sentence of records.
  - R3. Both card templates (`specs/tasks/_TEMPLATE.md`, `templates/cards/_TEMPLATE.md`) shall carry the two lines of text C of the section Exact texts in place of their budget example line and their `size_exception` line, and no other change.
  - R4. Both copies of `planner.md` (`.claude/agents/`, `templates/claude/agents/`) shall say `budgets about <= 150 net` in place of `budgets about <= 400 net`, and no other change.
  - R5. Each card that `allow_paths` names under `specs/tasks/`, other than this card and the template, shall carry text D of the section Exact texts on the line after its `budget` line, unless at the start of the run it is merged, is superseded or declares a budget of 150 or less, in which case its file stays as it is. The repository then loads with no blocking `[CARD-SIZE]`.
  - R6. In `tests/surface/card.test.ts` the `[CARD-SIZE]` tests shall use 151 and 150 where they use 251 and 250, in fixtures, in the asserted message parts and in the test titles, their paragraph constant shall be text B and their template line constant the second line of text C, and the `renderCard` fixture of the test `renderCard output re-parses with zero blocking findings` shall declare budget 120 with its budget assertion at 120. In `tests/surface/budget-doc.test.ts` the constant `LINE` shall be the first line of text C. The CHANGELOG entry constant of T0-CARD-SIZE and every other assertion of both files stay as they are.
  - R7. `changelog.d/T0-CARD-SIZE-150.md` shall state the new limit, that the default budget of a rendered draft card follows it, the texts of R2 to R4, the cards of R5, and that in a repository that upgrades, a card still to run that changes `src/` and declares 151 to 250 without a non-blank `size_exception` gets a blocking `[CARD-SIZE]` until it is split, declares 150 or less or records a `size_exception`.
acceptance:
  - 1. `tests/surface/card.test.ts`, the test of a todo card that changes `src/` with budget 151, passes with one blocking `[CARD-SIZE]` whose message names 151, 150, split and `size_exception`, and budget 150, no budget and a card with no `src/` path give none. RED first, on main the test fails because budget 151 gets no finding. [R1] [R6] [dod arm 3]
  - 2. Same file, the budget 151 card gets a warning when merged, when superseded and with a non-blank `size_exception`, and every blank or non-scalar `size_exception` form of the test keeps the block. [R1] [R6] [dod arm 3]
  - 3. Same file, the test `this repository loads with no blocking [CARD-SIZE], and the two dropped cards are superseded` passes unchanged. RED first, with the constant at 150 and no card edited it lists the cards of R5. [R5] [dod arm 3]
  - 4. Same file, the test of the docs and templates passes with the paragraph of R2 and the template line of R3, and `tests/surface/edge-scope.test.ts` passes unchanged. [R2] [R3] [R6] [dod arm 3]
  - 5. `tests/surface/budget-doc.test.ts` passes with `LINE` at the first line of text C. [R3] [R6] [dod arm 3]
  - 6. Same `card.test.ts` file, the test `renderCard output re-parses with zero blocking findings` passes with its fixture at budget 120. [R6] [dod arm 3]
  - 7. `npm run check:tree` passes, so `tests/surface/mirror.test.ts` holds the two `planner.md` copies equal, and each copy says `budgets about <= 150 net` once (reviewer-verified against the diff). [R4] [dod arm 2]
  - 8. `changelog.d/T0-CARD-SIZE-150.md` follows `changelog.d/README.md` (`tests/surface/changelog-fragments.test.ts` passes) and states the facts of R7 (reviewer-verified against the diff). [R7] [dod arm 3]
  - 9. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 130
tdd: true
sweep: "On main at a5806b2a. The limit is the constant at `src/artifacts/card.ts:35`, read by the `[CARD-SIZE]` check (`:162-163`) and by the `renderCard` default (`:355`); no other file under `src/` or `bin/` names it. The figure 250 as the limit stands in `docs/OPERATIONS.md:83`, in the `size_exception` line of both card templates and in `tests/surface/card.test.ts:389-449`. The figure 400 as a card size stands in the budget example line of both card templates, pinned by `tests/surface/budget-doc.test.ts:13`, and in line 22 of both `planner.md` copies, which no test pins. A grep for a budget of 151 to 250 over `tests`, `bench`, `evals`, `src`, `templates`, `scripts` and `bin` finds one fixture that declares a `src/` path, `tests/surface/card.test.ts:228` (budget 200, asserted at `:241`); the scenario harness renders its cards with the default, which follows the constant. Two CI workflows run `aidlc cards validate` (`.github/workflows/aidlc-ci.yml:32`, `.github/workflows/docs-check.yml:32`), so a blocking finding in the registry fails CI. Including this card, 24 todo cards are not superseded; 14 change `src/` and 11 of those declare more than 150, the 11 of `allow_paths`, none with a `size_exception`. The texts that state 250 as history stay, `intent/agent-quality-study.md:30`, `plans/review-recall.md`, the CHANGELOG entry of T0-CARD-SIZE and the merged cards."
forbid: [changing the severity or the text of another card check, a new configuration key, changing what `budget` means or how a ship path reads it, editing .aidlc state by hand, weakening or skipping a test, network]
non_goals:
  - "comparing a candidate's diff with its budget on the github or dry-run ship path, a non-goal of T0-CARD-SIZE that stays one"
  - "a size rule for a card that changes no `src/` path, and a limit a project can configure"
  - "splitting or re-planning the cards of R5, which the owner decides card by card"
  - "the stop-and-ask line of `implementer.md` and `card-loop.md`, which card T0-CARD-CAP-150 changes"
  - "the texts that state 250 as history, named at the end of `sweep`"
doc_sync: docs/OPERATIONS.md
hygiene: "Owner's instruction of 2026-11-28, the budget maximum goes to 150. It settles issue 569 (three card size figures with no stated relation). Claude measured the records and Codex checked the counts and this contract before the card was logged. RED first: acceptance 1 and 3 on main. Existing prose pins follow the changed texts and no new pin is added (issue 516)."
---

# T0-CARD-SIZE-150

`aidlc cards validate` blocks a card that changes `src/` and declares a budget over 150. The limit was 250. The planner text and the card templates state the same figure.

## Why
The owner asks for cards of 150 lines or fewer, because larger cards pass their first R3 decision less often.

Measured on 2026-11-28 over the 452 card runs that hold a first R3 decision (a pass or a block, not a ruling), using the budget in the last main commit before the decision's requestedAt; five runs without that historical file use today's file. 359 of the runs are of cards that change `src/`:

| Budget declared | Runs | First decision passed | Two or more blocks | Run merged | Unruled pass/block invocations per 100 merged lines |
|---|---|---|---|---|---|
| 150 or less | 73 | 51 (69.9%) | 8 (11.0%) | 89.0% | 1.73 |
| 151 to 250 | 108 | 50 (46.3%) | 27 (25.0%) | 75.0% | 1.21 |
| over 250 | 178 | 62 (34.8%) | 80 (44.9%) | 52.2% | 0.72 |

- Since 2026-11-12 the first decision passed in 19 of 29 runs at 150 or less, in 23 of 59 from 151 to 250 and in 13 of 22 above.
- In finer bands the first decision passed in 22 of 30 runs at 100 or less, 29 of 43 from 101 to 150, 26 of 45 from 151 to 200 and 24 of 63 from 201 to 250.
- The declared budget does not bind the diff. The first reviewed candidate was over 250 changed lines in 7% of the runs that declared 101 to 150, in 27% of those that declared 151 to 200 and in 61% of those that declared 201 to 250. Declared budgets of 101 to 150 were associated with less overshoot than 151 to 200; these records cannot show the effect of splitting equal scope.
- Unruled pass/block invocations, including second passes, total 1.73 against 1.21 per 100 merged lines; failed and quota-held invocations are excluded.
- 53 runs had their budget raised after a first decision that blocked. The table reads the budget of the time, so those raises do not move a run to another row.

`intent/agent-quality-study.md` (row Small steps) recorded no change on first-decision rates of 76.0%, 65.8% and 35.6% and named the evidence it lacked, total delivery time and family spend for equal scope. These ratios do not measure total delivery time or family spend for equal scope; that evidence remains missing.

Claude and Codex accept 150 as a planning default that can be moved again, with explicit exceptions. The records establish no best threshold, and a limit of 200 also kept most first candidates under 250 lines.

## Exact texts

Text A, the comment and the constant in `src/artifacts/card.ts`:
```ts
/**
 * The largest budget a card that changes `src/` may declare without a `size_exception` (card T0-CARD-SIZE; 250 until
 * card T0-CARD-SIZE-150). On the records of 2026-11-28, such cards passed their first R3 decision in 51 of 73 runs at a
 * budget of 150 or less, in 50 of 108 from 151 to 250 and in 62 of 178 above.
 */
export const MAX_CODE_CARD_BUDGET = 150;
```

Text B, the paragraph of `docs/OPERATIONS.md`, one line:
```text
Card size (card T0-CARD-SIZE). `aidlc cards validate` reports `[CARD-SIZE]` for a card whose `allow_paths` holds an entry under `src/` (backslashes read as slashes, a leading `./` removed) and whose `budget` is above 150 (`MAX_CODE_CARD_BUDGET` in `src/artifacts/card.ts`): blocking on a card that is neither `merged` nor superseded and has no non-blank `size_exception`, a warning otherwise. `size_exception` is a front-matter line that records who approved the larger card and why, read from its own line as a YAML scalar (quote it): a value that does not parse alone or is not a non-blank string, such as a bare comment, an empty block scalar or a number, is no exception. Split the card instead where you can; the draft cards that `aidlc cards project` renders get `budget: 150` when none is given. The limit was 250 until card T0-CARD-SIZE-150. On the records of 2026-11-28, code cards with a budget of 150 or less passed their first R3 decision in 51 of 73 runs, those with 151 to 250 in 50 of 108 and those above 250 in 62 of 178. A card with no `src/` entry or no `budget` is not checked, and the ship paths read `budget` as before.
```

Text C, the two lines of each card template:
```text
# budget: 150          # declared net changed lines (added+deleted); a merge gate only on the scaffold ship path, advisory on github and dry-run
# size_exception: "<who approved, why>"   # [CARD-SIZE] blocks a card that changes src/ with a budget over 150 unless this records the approval; split the card instead where you can
```

Text D, the line each card of R5 gets after its `budget` line:
```text
size_exception: "approved by Claude and Codex on accepting R5 of T0-CARD-SIZE-150; preserves this pre-existing budget during the limit change"
```

## Deliverable
The constant at 150 with its comment, the paragraph of `docs/OPERATIONS.md`, the two lines of both card templates, the planner line in both copies, a `size_exception` on the cards of R5, the tests that pin these texts at the new figure, and a changelog fragment.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/surface/card.test.ts tests/surface/budget-doc.test.ts tests/surface/edge-scope.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: a card that changes `src/` blocks at budget 151 and passes at 150, the repository's registry has no blocking `[CARD-SIZE]`, and the docs, the templates and the planner state 150.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|

## PR summary

### What
The `[CARD-SIZE]` limit goes from 250 to 150. The planner text and the card templates state 150 in place of 400 and 250.

### Why / Intent
The owner's instruction of 2026-11-28, on the records in the section Why.

### How / Behaviour
One constant. `aidlc cards validate` blocks a card still to run that changes `src/` and declares more than 150, unless it records a `size_exception`. A draft card that `aidlc cards project` renders with no budget gets 150.

### System impact
A repository that upgrades sees a blocking `[CARD-SIZE]` on each card still to run that changes `src/` and declares 151 to 250 without a non-blank `size_exception`. Merged and superseded cards get a warning, as before.

### Security
No change.

### Tests and review
The `[CARD-SIZE]` tests move from 251 and 250 to 151 and 150. The registry test proves the exceptions of R5.

### Risk
Low for the code, one constant. The cards of R5 keep their budgets through an exception; other active code cards block above 150 unless they carry an exception.

### Ownership
`src/artifacts/card.ts`, the card templates, `planner.md` and the registry.

### Docs
`docs/OPERATIONS.md`, Card size, and a changelog fragment.
