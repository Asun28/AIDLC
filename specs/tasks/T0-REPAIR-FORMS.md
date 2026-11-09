---
id: T0-REPAIR-FORMS
title: "The repair check on a formal REVIEW_FIX directive also asks the repairer to list each input form and failure path the repair hunks handle, each with its test, in the attempt evidence"
status: todo
branch: T0-REPAIR-FORMS
worktree: D:\wt\AIDLC\T0-REPAIR-FORMS
allow_paths:
  - src/loop/card-runner.ts
  - tests/scenarios/repair-check.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-REPAIR-FORMS.md
dod_command: npm run typecheck && node --test tests/scenarios/repair-check.test.ts tests/scenarios/review-block.test.ts tests/scenarios/finding-repro.test.ts tests/scenarios/base-sync-review.test.ts
dod_exit: 0
requirements:
  - R1. The `REPAIR_CHECK` text of `src/loop/card-runner.ts` shall end with the sentence `List in the attempt evidence each input form and failure path the repair hunks handle (for a parser, each kind of value it can be given; for I/O, each error it can raise), each with the test that covers it.`, so every narration that carries the repair check carries the sentence once, at the same place.
  - R2. No other directive text, directive field, effort level, attempt count, persisted record or gate shall change; no gate reads the sentence.
  - R3. The Repair check paragraph of `docs/OPERATIONS.md` shall quote the whole new text and state the measurement of the diagnosis with the rule to repeat it after 15 repaired cards; the CHANGELOG Unreleased section shall state R1 under this card id.
acceptance:
  - 1. `tests/scenarios/repair-check.test.ts` pins the new full `REPAIR_CHECK` text, and its existing tests (the repair check once; after the whole repair text; followed only by the class list and the repro sentence; kept by no card run or journal) pass with it. Fails before the fix. [R1] [R2] [dod arm 1]
  - 2. `tests/scenarios/review-block.test.ts`, `tests/scenarios/finding-repro.test.ts` and `tests/scenarios/base-sync-review.test.ts` pass unchanged. [R2] [dod arm 1]
  - 3. Same repair-check file: `docs/OPERATIONS.md` holds the Repair check paragraph and the CHANGELOG Unreleased section the entry, each as exact text. [R3] [dod arm 1]
depends_on: []
budget: 80
tdd: true
diagnosis:
  root_cause: "Repairs are written against the cited case. Measured on 2026-11-10 from the card runs: of the findings R3 raised at decision 2 or later, 40 of 61 since the class sweep merged (2026-10-23) and 11 of 20 since the current repair check merged (2026-11-07) were a new defect class in a file an earlier decision had flagged and not marked `outsideDelta`, so inside the changes since that decision. In T0-CARD-SIZE, F2 (an alias size_exception threw) sat in sizeExceptionOf, the function written to repair F1 (blank size_exception forms)."
  same_class: "The pre-review (R2) repair directive does not carry REPAIR_CHECK and stays so; this repository runs no R2."
forbid: [weakening or deleting a test assertion, a new directive field, a change to effort levels or attempt counts, a gate that reads attempt evidence]
non_goals: [checking that the attempt evidence holds the list, the R2 repair directive, the class list or repro sentence, the aidlc-loop skill files]
---

# T0-REPAIR-FORMS

## Deliverable
One sentence appended to `REPAIR_CHECK` (`src/loop/card-runner.ts:148` at main 4c75989), its pinned copy in `tests/scenarios/repair-check.test.ts:11`, the Repair check paragraph (`docs/OPERATIONS.md:303`) and a CHANGELOG entry.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/repair-check.test.ts tests/scenarios/review-block.test.ts tests/scenarios/finding-repro.test.ts tests/scenarios/base-sync-review.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and the four test files pass.
