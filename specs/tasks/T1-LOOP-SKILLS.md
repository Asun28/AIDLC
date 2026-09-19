---
id: T1-LOOP-SKILLS
title: Every routing result and directive names its companion skills; PLAN names grilling with the open questions; a merge conflict returns the card to BUILD naming merge-conflicts
status: merged
superseded_by: T1-LOOP-SKILLS-2
branch: T1-LOOP-SKILLS
worktree: D:\wt\AIDLC\T1-LOOP-SKILLS
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
plan_ref: plans/loop-integration.md#7
budget: 600
tdd: true
sweep: "grep -rn 'Directive.parse\|formatRouting\|applyShipResult\|kind: .build.\|routing.modules' src tests: controller.ts baseOf plus the inline base, card-runner.ts CardDirective sites, router.test.ts anchored [route] regex, hooks.test.ts route line, _fixtures.ts RoutingResult literal"
non_goals: [a hard PLAN gate that refuses to advance on open questions, a new directive kind, scaffold ship path changes, the lessons closure predicate, the security CI class]
doc_sync: docs/ARCHITECTURE.md (directive contract, ship outcome map), docs/OPERATIONS.md (goal new --intent), CHANGELOG.md
---

# T1-LOOP-SKILLS

## Deliverable
The router computes `skills` next to `modules` and the list travels with the routing result into the goal, the journal, the route line and every directive. The plan directive for T1 and T2 goals names `grilling` and lists the open questions of the intent file recorded on the goal. The build directive names `tdd` and, on bugfix evidence, `diagnose`; the prepare directive points at `docs/LESSONS.md`. A merge conflict reported by the ship path returns the card to BUILD naming `merge-conflicts`, with the DoD receipt cleared and the effort episode reopened; other merge failures keep the tool stop.
Budget raised to 600 after R3 decision 1 (seven findings, each fixed with a failing test first); earlier from 300 to 400 after R2 round 1: the reviewers asked for tests of the incident route, the CLI `--intent` wiring, the unreadable-intent branch, the repair-path build directives and a bugfix goal (69 net lines).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/core/router.test.ts tests/core/types.test.ts tests/scenarios/t0-flow.test.ts tests/scenarios/t1-plan.test.ts tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: the router, types, scenario and hook tests named above pass, including the new assertions for `skills`, the plan directive, the build and prepare directives, and the merge-conflict return.
