---
id: T1-R3-PANEL-FOLD
title: One defect cited by both members of an R3 panel decision is recorded as one finding, folded by file, overlapping cited lines and class before finding ids are given, with both members named
status: todo
branch: T1-R3-PANEL-FOLD
worktree: D:\wt\AIDLC\T1-R3-PANEL-FOLD
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - src/core/review-policy.ts
  - src/core/types.ts
  - src/loop/card-runner.ts
  - tests/core/panel-fold.test.ts
  - tests/scenarios/r3-panel.test.ts
  - docs/OPERATIONS.md
  - changelog.d/T1-R3-PANEL-FOLD.md
  - .claude/skills/verify-card-run-writes/SKILL.md
  - specs/tasks/T1-R3-PANEL-FOLD.md
dod_command: npm run typecheck && node --test tests/core/panel-fold.test.ts tests/scenarios/r3-panel.test.ts tests/core/review-policy.test.ts tests/scenarios/fault-points.test.ts
dod_exit: 0
requirements:
  - R1. `foldPanelReasons(reasons)` (new, exported from src/core/review-policy.ts, pure) shall take the cited block reasons of one panel decision with their member and return groups: two reasons of different members join one group when `findingLocation` names the same file, their cited line ranges overlap (a reason with no line joins none), and their class (`findingClass`, else the dimension number) is equal. A reason joins at most one group; the group keeps the first member's reason as its text, in member order primary first.
  - R2. A panel decision (T1-R3-PANEL) shall record one finding per group, with `perspective` the member of the kept text and `alsoRaisedBy` (new optional field) the other member and its reason text; a reason that re-raises `re:F<n>` is never folded and is recorded as on T1-R3-PANEL.
  - R3. The finding count of the decision and `aidlc review stats` shall count a folded group once.
  - R4. docs/OPERATIONS.md (Findings and dispositions) shall state R1 to R3; changelog.d/T1-R3-PANEL-FOLD.md records the change.
acceptance:
  - 1. `tests/core/panel-fold.test.ts` (new), "T1-R3-PANEL-FOLD acceptance 1: folds on same file, overlapping lines and class; keeps apart on another class, disjoint lines, a reason with no line, or the same member". Fails on main (no export). [R1] [dod arm 1]
  - 2. tests/scenarios/r3-panel.test.ts, new test "T1-R3-PANEL-FOLD acceptance 2: one defect cited by both members is one finding with alsoRaisedBy; a re:F<n> is not folded". Fails on main. [R2] [R3] [dod arm 1]
  - 3. tests/core/review-policy.test.ts, the tests of T1-R3-PANEL and fault-points.test.ts pass with no line changed; the record of .claude/skills/verify-card-run-writes/SKILL.md describes the code after the change within the byte cap of tests/surface/templates.test.ts. [R1] [dod arm 1]
  - 4. The OPERATIONS.md and changelog text are as R4 states (reviewer-verified against the diff). [R4]
depends_on: [T1-R3-PANEL]
budget: 160
tdd: true
sweep: "Main at ff925160. review-policy.ts: findingLocation :249, findingClass :281, findingIdentity :299 (hashes the cited lines, so one defect at two lines gets two identities: Fable 5.2, panel of 2026-11-19). ReviewFinding src/core/types.ts:510-560."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than a record shape this card's requirements add to
  - dropping a reason: every cited reason is in exactly one finding or one re-raise
non_goals: [folding across decisions (finding identity reports that), folding at R2]
---

# T1-R3-PANEL-FOLD

## Deliverable
The author repairs one finding per defect, not one per member, and the stats do not count a defect twice because two reviewers saw it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/panel-fold.test.ts tests/scenarios/r3-panel.test.ts tests/core/review-policy.test.ts tests/scenarios/fault-points.test.ts
```
- Expected exit code: 0
- Assertion: the two new tests pass and the existing tests pass unchanged.
