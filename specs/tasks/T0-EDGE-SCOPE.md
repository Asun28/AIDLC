---
id: T0-EDGE-SCOPE
title: "The review prompt's card contract carries the card's requirements, and both card templates ask a card that reads input or adds I/O to name the input forms and failure paths it handles and the ones it leaves out"
status: todo
branch: T0-EDGE-SCOPE
worktree: D:\wt\AIDLC\T0-EDGE-SCOPE
allow_paths:
  - src/review/pre-review.ts
  - tests/surface/edge-scope.test.ts
  - specs/tasks/_TEMPLATE.md
  - templates/cards/_TEMPLATE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-EDGE-SCOPE.md
dod_command: npm run typecheck && node --test tests/surface/edge-scope.test.ts tests/surface/pre-review.test.ts tests/surface/templates.test.ts tests/surface/budget-doc.test.ts tests/surface/card.test.ts
dod_exit: 0
requirements:
  - R1. `buildReviewPrompt` (`src/review/pre-review.ts`) shall list a card's requirements in the Card contract section of both stages, as a `- requirements:` line followed by each requirement on its own line indented two spaces, directly after the `allow_paths` line; a card whose requirements are absent or an empty list gets no requirements line, and no other line of the prompt changes.
  - R2. Both card templates shall carry the template line of the Deliverable section once, as a comment of the `acceptance:` block directly after the `Doc text is proved with` comment line.
  - R3. The `aidlc review pre` sentence of `docs/OPERATIONS.md` shall list requirements among the card fields of the prompt, and an Edge scope paragraph after the Card size paragraph shall state R1, R2, the measurement of the diagnosis and the rule to repeat it after 15 reviewed cards that change src/; the CHANGELOG Unreleased section shall state R1 and R2 under this card id.
acceptance:
  - 1. `tests/surface/edge-scope.test.ts`: for a card with two requirements, the pre and the formal prompt each carry `- requirements:` and both requirements, indented two spaces, directly after the `allow_paths` line; removing those three lines gives the prompt of the same card without requirements, byte for byte; a card with no `requirements` key and one with `requirements: []` get no `- requirements:` line. Fails before the fix. [R1] [dod arm 1]
  - 2. Same file: each template carries the template line exactly once, directly after the `Doc text is proved with` comment line, and still parses once its id is real. [R2] [dod arm 1]
  - 3. Same file: `docs/OPERATIONS.md` holds the Edge scope paragraph and the CHANGELOG Unreleased section the entry, each as exact text, and the `aidlc review pre` sentence lists requirements. [R3] [dod arm 1]
  - 4. `tests/surface/pre-review.test.ts`, `tests/surface/templates.test.ts`, `tests/surface/budget-doc.test.ts` and `tests/surface/card.test.ts` pass unchanged. [R1] [R2] [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "grep -rnE 'acceptance, allow_paths, non_goals|non_goals, forbid|allow_paths, non_goals' src docs README.md REVIEW.md templates .claude, and grep buildReviewPrompt( src: the prompt is built only by buildReviewPrompt, called by card-runner.ts:1869 (R3), :2466 (R2) and review/bench.ts:285 and :291, each with the card, so all four get the line (a bench report saved earlier was built without it). docs/OPERATIONS.md:289 lists the prompt's card fields (updated). pre-review.ts:383 and :388 (R2 perspective texts), context-pack.ts:75 (the implementer pack) and the planner and reviewer agent files name card fields for other readers and stay. Lines are from main at 3139f03."
forbid: [weakening or deleting a test assertion, a change to REVIEW.md or the review policy, a new card field or registry check, a gate that reads the template line]
non_goals: [quoting or escaping card contract lines (acceptance lines are printed the same way), requirements in the run-card context pack, the planner or reviewer agent files, the R2 perspective texts, checking that a card follows the template line]
diagnosis:
  root_cause: "The card format asks for acceptance items but not for the input forms and failure paths a change handles or leaves out, and the review prompt carries no requirements, although the REVIEW.md impact bar makes a finding a block when the card's requirements name it; the reviewer sees them only if it opens the card file. Measured on 2026-11-10 from the card runs: of 80 cards that change src/ and reached R3 since 2026-10-23, 46 were blocked at the first decision, with 141 findings (1.76 per card); 53 of the 79 most recent first-decision findings on any card, read by hand, named an input form, an environment setting or a failure path, such as the blank size_exception forms of T0-CARD-SIZE."
  same_class: "non_goals is on 253 of 255 cards and already reaches the prompt. The run-card context pack also lacks requirements; the implementer reads the card file itself."
---

# T0-EDGE-SCOPE

## Deliverable
A `- requirements:` block in the Card contract of `buildReviewPrompt` (`src/review/pre-review.ts:443` at 3139f03), the template line below in both card templates, the docs and a CHANGELOG entry.

Template line (R2), exact, two leading spaces:
```
  # A card that reads input or adds I/O names in these items each input form and failure path it handles; non_goals names each form it leaves out and what the code does with it (refuse, ignore or fail closed).
```

Input forms of R1: requirements absent, an empty list, one or more single-line items (`blockList` reads one line per item). Failure paths: none; the change builds a string and does no I/O.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/edge-scope.test.ts tests/surface/pre-review.test.ts tests/surface/templates.test.ts tests/surface/budget-doc.test.ts tests/surface/card.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and the five test files pass.
