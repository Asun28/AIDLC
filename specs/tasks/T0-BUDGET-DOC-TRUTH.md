---
id: T0-BUDGET-DOC-TRUTH
title: The card templates and the operating guide say the budget is a merge gate only on the scaffold ship path
status: merged
branch: T0-BUDGET-DOC-TRUTH
worktree: D:\wt\AIDLC\T0-BUDGET-DOC-TRUTH
allow_paths:
  - specs/tasks/_TEMPLATE.md
  - templates/cards/_TEMPLATE.md
  - docs/OPERATIONS.md
  - tests/surface/budget-doc.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-BUDGET-DOC-TRUTH.md
dod_command: npm run typecheck && node --test tests/surface/budget-doc.test.ts tests/surface/templates.test.ts tests/surface/card.test.ts
dod_exit: 0
requirements:
  - R1. The `budget` line of `specs/tasks/_TEMPLATE.md` and of `templates/cards/_TEMPLATE.md` shall say that the budget is a merge gate only on the scaffold ship path and is advisory on the github and dry-run paths.
  - R2. `docs/OPERATIONS.md`, beside the text on ship failures, shall state that the `budget-over` outcome comes only from sentinels the scaffold prints, and that the github and dry-run paths compare no diff with the budget.
  - R3. The CHANGELOG Unreleased section shall have an entry naming this card.
acceptance:
  - 1. `tests/surface/budget-doc.test.ts`: both templates hold the corrected `budget` line exactly, and neither holds `once declared it is a merge gate`. [R1] [dod arm 2]
  - 2. `tests/surface/budget-doc.test.ts`: `docs/OPERATIONS.md` holds the sentence of R2 exactly. [R2] [dod arm 2]
  - 3. `tests/surface/budget-doc.test.ts`: `src/delivery/github-ship.ts` holds no budget sentinel, so the sentence of R2 stays true of the code. [R2] [dod arm 2]
  - 4. The existing tests of `templates` and `card` pass with no change. [R1] [dod arms 3, 4]
  - 5. The CHANGELOG entry exists. [R3] Reviewer-verified.
depends_on: []
budget: 40
tdd: true
sweep: "On main at 6f1cb58: `CARD-BUDGET` and `R3-DIFF-TOO-LARGE` appear in `src/` only in `SENTINEL_MAP` at `src/delivery/ship.ts:84`, which reads them, and no adapter under `src/delivery/` prints one. `merge gate` as a budget claim stands only in the two templates, line 25 of each. `docs/ARCHITECTURE.md` lists the sentinel and claims nothing about a path. `templates/claude/agents/implementer.md` tells the implementer to stay within the budget, which holds on every path."
forbid:
  - measuring churn in any ship path
  - changing `classifyShipOutput` or the `budget-over` handling in `src/loop/card-runner.ts`
  - changing a `budget` value on any card
non_goals:
  - enforcing the budget on the github path, which issue 122 leaves as the other option; on the last 24 merged cards 17 went over budget by a count of insertions plus deletions with tests included, so a gate by that count would stop most ships
hygiene: "Issue 122, decided as the docs option. The test reads `src/delivery/github-ship.ts` so a later gate on the github path fails it and forces the docs to move in the same change."
---

# T0-BUDGET-DOC-TRUTH

## Deliverable
The templates and `docs/OPERATIONS.md` stop saying the budget gates a merge on the github path. Closes issue 122.

## Acceptance
```powershell
npm run typecheck && node --test tests/surface/budget-doc.test.ts tests/surface/templates.test.ts tests/surface/card.test.ts
```
- Expected exit code: 0
- Assertion: the acceptance list above.
