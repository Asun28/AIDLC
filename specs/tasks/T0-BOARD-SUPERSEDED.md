---
id: T0-BOARD-SUPERSEDED
title: "The board row of a card with superseded_by says it is superseded and names the successor, instead of todo"
status: merged
branch: T0-BOARD-SUPERSEDED
allow_paths:
  - src/state/board.ts
  - tests/infra/board-superseded.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T0-BOARD-SUPERSEDED.md
  - specs/tasks/T0-BOARD-SUPERSEDED.md
dod_command: npm run typecheck && node --test tests/infra/board-superseded.test.ts tests/infra/board.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. In `renderBoard` (`src/state/board.ts:49`), the row of a card whose `superseded_by` is set and which is not `status: merged` shall show `SUPERSEDED` in the State column and `[~]` in the first column, and its Blocker column shall read `superseded by <superseded_by>`, when the card has no run. When it has a run, the State column shall show the run state followed by ` (superseded)` and the Blocker column shall prepend `superseded by <superseded_by>; ` to the text it shows on main. A live owner lease row (`owners`) keeps main's box and state text and only gains the Blocker prefix.
  - R2. `outcomeOf` (`src/state/board.ts:25`), the outcomes `renderBoard` passes to `selectArc`, the Arc line, the Arc notes and every row of a card without `superseded_by` shall be byte-identical to main. The controller (`src/loop/controller.ts:381`, :396) shall be unchanged.
  - R3. `docs/OPERATIONS.md`, the Watching a goal section (the board section; amended 2026-11-28 from the Sessions line `aidlc board [goalId]`, whose section `tests/surface/prose.test.ts:354` caps at its base size), shall state R1 in one sentence and that the row does not change the arc, and the Sessions section shall be byte-identical to main; one changelog fragment shall record it.
acceptance:
  - 1. `tests/infra/board-superseded.test.ts`, new file, with `makeCard`, `makeCardRun` and `makeGoal` from `tests/infra/helpers.ts`: a goal of cards A (`superseded_by: B`, no run) and C (no run): A's row holds `| [~] | A | SUPERSEDED |` and `superseded by B`; C's row equals its row from the same render with A's `superseded_by` removed. RED on main (A shows `todo`). [R1] [R2] [dod arm 2]
  - 2. Same file: A with a STOP run shows `STOP (superseded)` and a Blocker that starts `superseded by B; ` followed by main's stop text; A with `status: merged` and `superseded_by` shows main's row. [R1] [dod arm 2]
  - 3. Same file: for the goals of acceptance 1 and 2, `outcomeOf` returns the same value as with `superseded_by` removed, and the `- **Arc**:` line and the `## Arc notes` section are equal between the two renders. `tests/infra/board.test.ts` passes unchanged; `git diff origin/main --stat -- tests/` lists only the new file. [R2] [dod arm 2]
  - 4. R3 holds (reviewer-verified against the diff); `changelog.d/T0-BOARD-SUPERSEDED.md` holds one line in the form of `changelog.d/README.md`. [R3] [dod arm 2]
  - 5. The typecheck is clean. [dod arm 1]
depends_on: []
budget: 80
tdd: true
sweep: "On main at 1f62dbe2. `superseded_by` is parsed in `src/artifacts/card.ts:128` (schema `src/core/types.ts:193`) and read by the validator (`card.ts:150`), worktree reclaim (`src/loop/worktree-reclaim.ts:85`) and review stats (`src/review/stats.ts:395`). `outcomeOf` (`src/state/board.ts:25`) ignores it and is used by the controller's arc (`src/loop/controller.ts:381`, :396) and by `renderBoard` (:52) for `selectArc`; the row state is computed at `board.ts:72`, the box at :74, the blocker at :80-81. Tests of the board: `tests/infra/board.test.ts` only. `aidlc board --watch` (`renderWatch`) has no row per card and is out of scope."
forbid: [network]
non_goals:
  - "counting a superseded card as closed for the arc, `arc-verified` or goal delivery (it would let a goal pass without that card merging)"
  - "a new `CardStatus` value; `superseded_by` stays the one marker"
  - "`aidlc board --watch`, `goal status` and `cards validate` output"
hygiene: "The owner asked in session (2026-11-27) for the board to show superseded cards after T0-REVIEW-DIFF-DELETED was superseded; the owner accepted keeping superseded_by in place of a new status. RED first: acceptance 1 on main."
---

# T0-BOARD-SUPERSEDED

## Why
A card marked `superseded_by` is shown on the board as `todo`, the same as a card still to run. The marker already exists and is read by validation, worktree reclaim and review stats; the board row is the one place a reader sees it and it is not shown.

## Deliverable
The board row says SUPERSEDED and names the successor. The arc, `outcomeOf` and the controller are unchanged, so a superseded card still does not count as delivered. A new test file, one OPERATIONS.md sentence and a changelog line.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/board-superseded.test.ts tests/infra/board.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: a superseded card's row says SUPERSEDED and names its successor; the arc and every other row are unchanged.

## PR summary

### What
The board row of a card with `superseded_by` now shows that it is superseded. The row names the successor card.

### Why / Intent
A superseded card showed as `todo`, the same as a card still to run. The owner asked for the board to show it.

### How / Behaviour
With no run, the row shows `[~] SUPERSEDED` and "superseded by <id>". With a run, the state gets "(superseded)" and the Blocker gets the successor prefix. A live owner row keeps its box and state.

### System impact
Only `renderBoard` changes. `outcomeOf`, the Arc line and the controller do not change, so a superseded card never counts as delivered.

### Security
No security impact. The board is a read-only view.

### Tests and review
A new test file checks the rows, the owner row and the unchanged arc. R3 decision 1 blocked on three findings; the repair passed decision 2.

### Risk
Low. A merged card and a card without the marker render as before.

### Ownership
The owner asked for the card. The owner chose to move the docs sentence to Watching a goal (amendment 1).

### Docs
`docs/OPERATIONS.md` Watching a goal has one paragraph. One changelog fragment records the change.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/board-superseded.test.ts` acceptance 1 | pass; RED on main |
| 2 | `tests/infra/board-superseded.test.ts` acceptance 2 and R3 decision 1 F1 (owner row) | pass; F1 RED on main and on a mutant without `!owner` |
| 3 | `tests/infra/board-superseded.test.ts` acceptance 3 (merged case included); `tests/infra/board.test.ts` unchanged | pass |
| 4 | OPERATIONS.md Watching a goal paragraph; `changelog.d/T0-BOARD-SUPERSEDED.md`; `tests/surface/prose.test.ts`, `tests/surface/changelog-fragments.test.ts` | pass |
| 5 | `npm run typecheck` | exit 0 |