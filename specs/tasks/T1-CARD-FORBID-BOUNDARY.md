---
id: T1-CARD-FORBID-BOUNDARY
title: Both card templates and both planner agent copies say that forbid holds hard boundaries only and that a card states each behaviour once, and docs/OPERATIONS.md asks the operator for one coordinator session per card
status: todo
branch: T1-CARD-FORBID-BOUNDARY
worktree: D:\wt\AIDLC\T1-CARD-FORBID-BOUNDARY
plan_ref: plans/card-contract-scope.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - specs/tasks/_TEMPLATE.md
  - templates/cards/_TEMPLATE.md
  - .claude/agents/planner.md
  - templates/claude/agents/planner.md
  - docs/OPERATIONS.md
  - changelog.d/T1-CARD-FORBID-BOUNDARY.md
  - specs/tasks/T1-CARD-FORBID-BOUNDARY.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/card.test.ts tests/surface/budget-doc.test.ts tests/surface/edge-scope.test.ts tests/surface/coordinator-effort.test.ts tests/surface/frontmatter.test.ts tests/surface/init-base-ci.test.ts tests/surface/changelog-fragments.test.ts tests/infra/init.test.ts
dod_exit: 0
requirements:
  - R1. The two card templates and the two planner agent copies shall say that `forbid` holds hard boundaries only - no incidental line, function-body or import-line restriction, a frozen API may be named, and no such restriction is restated in `requirements`, which state observable behaviour.
  - R2. The two card templates and the two planner agent copies shall say that a card states each behaviour once - an acceptance item names its proof and its requirement, unique edge cases and rationale stay, and fixtures and implementation instructions are not repeated.
  - R3. The file `docs/OPERATIONS.md` shall tell the operator to run one interactive coordinator session per card until goal run-attribution attributes the coordinator's spend, to start the new session only when the card before it is closed, and to follow the Sessions section for ownership.
acceptance:
  - 1. The dod_command passes with no test changed. [R1] [R2] [R3] [dod arm 1] [dod arm 2]
  - 2. R1 and R2 hold in both card templates, which still differ only on the `worktree` line, and in both planner copies, which stay byte-identical (reviewer-verified against the diff). [R1] [R2]
  - 3. `docs/OPERATIONS.md` holds one paragraph that states R3 and names this card, and the Coordinator effort paragraph stays where tests/surface/coordinator-effort.test.ts pins it (reviewer-verified against the diff). [R3]
  - 4. `changelog.d/T1-CARD-FORBID-BOUNDARY.md` holds one line in the form of `changelog.d/README.md` that names the three rules (reviewer-verified against the diff). [R1] [R2] [R3]
depends_on: []
budget: 60
tdd: false
sweep: "Main at 83d3a778. `git diff --no-index specs/tasks/_TEMPLATE.md templates/cards/_TEMPLATE.md` shows one differing line, `worktree`. In both templates the comments under `acceptance:` are lines 17 to 19 and the `forbid` comment is line 32. The two planner copies are equal; their ready check on a card's boundaries is line 38. `git grep` of tests/ for `hard boundaries this card`, `A change of 30 src lines` and `states its boundaries` finds nothing. Tests that read these four files - templates, mirror, prose, card, budget-doc and edge-scope (tests/surface) and init (tests/infra), all in the DoD. In `docs/OPERATIONS.md` the Coordinator effort paragraph is line 31; tests/surface/coordinator-effort.test.ts:49-57 pins it two lines after the Claude Code effort paragraph with an empty line after it, and line 33 starts `Card front matter (card T0-FM-COMMENT-CUT-2`, which tests/surface/frontmatter.test.ts reads by content. A new session is a new identity (`docs/OPERATIONS.md:237`). 62 test files read `docs/OPERATIONS.md`; the DoD holds the three that pin lines 19 to 33, and CI runs them all."
forbid:
  - a change to `REVIEW.md`, `templates/REVIEW.md` or `reviewPolicyVersion`
  - a change to a registered card other than this one
non_goals:
  - an `aidlc cards validate` finding, a gate or a test on `forbid` items or on card length
  - the planner's sizing numbers and its other rules
  - the PREPARE narration and the Lessons paragraph of `docs/OPERATIONS.md` (T1-PREPARE-LESSONS-REF)
  - attributing the coordinator's spend (`intent/run-attribution.md`)
hygiene: "Line numbers are from main at 83d3a778; read them again at PREPARE. Card T0-ADOPT-EXTERNAL-MERGE-2 also allows `docs/OPERATIONS.md`; do not run beside it. Put the operator paragraph where no test pins the neighbouring lines; after the Coordinator effort paragraph is one such place. Not verified before the card runs - that no test outside the DoD reads the line after the Coordinator effort paragraph by position."
---

# T1-CARD-FORBID-BOUNDARY

## Deliverable
Guidance text in the two card templates and the two planner copies, and one operator paragraph in `docs/OPERATIONS.md`. No code and no test changes.

## Why
Plan `plans/card-contract-scope.md`; the measurements are in `intent/card-contract-scope.md`, Problem. `REVIEW.md:23` makes each `forbid:` item a must-block hit, and on 2026-11-18, 124 items in 70 cards restricted implementation detail inside an allowed file. The owner approved the three rules that day.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/card.test.ts tests/surface/budget-doc.test.ts tests/surface/edge-scope.test.ts tests/surface/coordinator-effort.test.ts tests/surface/frontmatter.test.ts tests/surface/init-base-ci.test.ts tests/surface/changelog-fragments.test.ts tests/infra/init.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; both pass with no test file changed.
