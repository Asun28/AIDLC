---
id: T1-LOOP-SKILLS-2
title: Every routing result and directive names its companion skills; PLAN names grilling with the open questions; a merge conflict returns the card to BUILD naming merge-conflicts
status: merged
branch: T1-LOOP-SKILLS-2
worktree: D:\wt\AIDLC\T1-LOOP-SKILLS-2
allow_paths:
  - src/core/types.ts
  - src/core/router.ts
  - src/loop/directive.ts
  - src/loop/controller.ts
  - src/loop/card-runner.ts
  - src/cli/main.ts
  - tests/core/_fixtures.ts
  - tests/core/router.test.ts
  - tests/core/types.test.ts
  - tests/scenarios/t0-flow.test.ts
  - tests/scenarios/t1-plan.test.ts
  - tests/surface/hooks.test.ts
  - docs/ARCHITECTURE.md
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-LOOP-SKILLS.md
  - specs/tasks/T1-LOOP-SKILLS-2.md
dod_command: npm run typecheck && node --test tests/core/router.test.ts tests/core/types.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/t1-plan.test.ts tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. The loop shall include a skills list in every routing result and every directive, computed from size, kind and card evidence.
  - R2. WHEN a T1 or T2 goal enters PLAN, the loop shall name grilling and list the open questions of the known intent file.
  - R3. WHEN a card enters BUILD, the loop shall name tdd, and diagnose as well for a bugfix goal or a card with a diagnosis field.
  - R4. WHEN the ship path reports a merge conflict, the loop shall return the card to BUILD naming merge-conflicts with the effort episode reopened and the DoD receipt cleared.
acceptance:
  - 1. `classifyRequest` returns `skills` (`diagnose` and `tdd` for T0-bugfix and incident, `tdd` for T0, `grilling` and `tdd` for T1 and T2, none for a release-only route), `formatRouting` appends `skills=` after `next=` so the existing anchored assertions hold, and the route hook prints it (router.test.ts, hooks.test.ts). [R1] [dod arm 1]
  - 2. Every `Directive` carries `skills` (default empty, supplied from the goal routing by the shared base); the plan directive for a T1 or T2 goal names `grilling`, lists the open questions read from `goal.intentRef` (set by `aidlc goal new --intent <file>`), and narrates a missing or unreadable intent file instead of throwing (t1-plan.test.ts, types.test.ts). [R2] [dod arm 1]
  - 3. The build directive names `tdd`, and `diagnose` as well when the goal kind is bugfix or incident or the card carries `diagnosis:`; the prepare directive narration names `docs/LESSONS.md` (t0-flow.test.ts). [R3] [dod arm 1]
  - 4. A `merge-failed` ship outcome whose receipt reports a conflict returns the card to BUILD with a build directive naming `merge-conflicts`, the DoD receipt cleared and the effort episode reopened so a following `recordAttempt` is accepted; a merge failure without a conflict stays STOP/tool; the existing `red-missing` return reopens the episode the same way (t0-flow.test.ts). [R4] [dod arm 1]
  - 5. `docs/ARCHITECTURE.md` states that the directive base carries `skills` and lists `merge-failed` in the ship outcome map; `docs/OPERATIONS.md` documents `--intent`; CHANGELOG.md Unreleased carries the entry. [dod arm 1]
  - 6. From R3 decision 1 on T1-LOOP-SKILLS: conflict detection needs an affirmative diagnostic in the ship output (a card id or resume text never matches); the pending repair is persisted on the run until the next successful attempt (a failed repair keeps it and the rejected receipt) so a second `next()` still names `merge-conflicts`; reopening an episode that cannot admit another attempt stops the card with reason `card`; `red-missing` clears the rejected RED receipt (t0-flow.test.ts). [R4] [dod arm 1]
  - 7. From R3 decision 1 on T1-LOOP-SKILLS: skills follow the finalized size as well as the kind (explicit T0-bugfix card routes name `diagnose`, explicit T1/T2 card routes name `grilling`); the review-fix build directive names the skills; an intent file that does not validate is narrated as such, never as an empty question list (router.test.ts, t0-flow.test.ts, t1-plan.test.ts). [R1] [R2] [R3] [dod arm 1]
plan_ref: plans/loop-integration.md#7
budget: 700
tdd: true
sweep: "grep -rn 'Directive.parse\|formatRouting\|applyShipResult\|kind: .build.\|routing.modules' src tests: controller.ts baseOf plus the inline base, card-runner.ts CardDirective sites, router.test.ts anchored [route] regex, hooks.test.ts route line, _fixtures.ts RoutingResult literal"
non_goals: [a hard PLAN gate that refuses to advance on open questions, a new directive kind, scaffold ship path changes, the lessons closure predicate, the security CI class]
doc_sync: docs/ARCHITECTURE.md (directive contract, ship outcome map), docs/OPERATIONS.md (goal new --intent), CHANGELOG.md
---

# T1-LOOP-SKILLS-2

## Deliverable
Replacement for T1-LOOP-SKILLS after its effort episode ended (three R2 blocks and one R3 block, each repaired with failing tests first); the branch carries every repair and this card adds the R3 findings as acceptance items 6 and 7.
Budget 700: raised from 600 after R3 decision 1 on this card (six findings: sanitized validation narration, line-anchored conflict diagnostics, rejected RED receipt never reloaded, admissibility with the justification BUILD grants, deadline stop, release-only exclusion on diagnose), each fixed with a failing test first.

The router computes `skills` next to `modules` and the list travels with the routing result into the goal, the journal, the route line and every directive. The plan directive for T1 and T2 goals names `grilling` and lists the open questions of the intent file recorded on the goal. The build directive names `tdd` and, on bugfix evidence, `diagnose`; the prepare directive points at `docs/LESSONS.md`. A merge conflict reported by the ship path returns the card to BUILD naming `merge-conflicts`, with the DoD receipt cleared and the effort episode reopened; other merge failures keep the tool stop.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/router.test.ts tests/core/types.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/t1-plan.test.ts tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: the router, types, scenario and hook tests named above pass, including the new assertions for `skills`, the plan directive, the build and prepare directives, and the merge-conflict return.
