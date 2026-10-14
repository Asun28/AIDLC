---
id: T1-SWEEP2-DUPLICATES
title: Remove the test-only copies of rules production enforces another way (card transition table, tag authority, counted-attempt constant, goal DONE evidence, default bands text, two uncalled CardRunner statics) and test the production paths instead
status: merged
branch: T1-SWEEP2-DUPLICATES
worktree: D:\wt\AIDLC\T1-SWEEP2-DUPLICATES
plan_ref: plans/dead-code-sweep-2.md#order-of-work
allow_paths:
  - src/core/card-machine.ts
  - src/core/release-machine.ts
  - src/core/effort.ts
  - src/core/goal-machine.ts
  - src/maintain/bands.ts
  - src/loop/card-runner.ts
  - tests/core/card-machine.test.ts
  - tests/core/release-machine.test.ts
  - tests/core/effort.test.ts
  - tests/core/goal-machine.test.ts
  - tests/surface/bands.test.ts
  - tests/surface/templates.test.ts
  - tests/surface/removed-surface.test.ts
  - tests/scenarios/release-publication.test.ts
  - tests/scenarios/goal-close-stages.test.ts
  - docs/REQUIREMENTS-TRACEABILITY.md
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP2-DUPLICATES.md
dod_command: npm run typecheck && node --test tests/surface/removed-surface.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/goal-close-stages.test.ts tests/core/card-machine.test.ts tests/core/release-machine.test.ts tests/core/effort.test.ts tests/core/goal-machine.test.ts tests/surface/bands.test.ts tests/surface/templates.test.ts
dod_exit: 0
requirements:
  - R1. The library (`src/index.ts`) shall export none of `CARD_TRANSITIONS`, `isCardTransitionAllowed`, `applyCardDecision` (card state is selected by `selectCardState`, never stepped through a table), `tagActionRequiresAuthority` (the release runner checks `binding.triggersPublication`), `MAX_COUNTED_ATTEMPTS` (the effort ladder enforces `MAX_BASELINE_ATTEMPTS` and one escalation), `goalDoneEvidence` (`GoalController.nextInClose` checks the stages) or `DEFAULT_BANDS_YAML` (a copy of `templates/bands.yaml`).
  - R2. `CardRunner` shall define neither the static `classify` nor the static `newId`, which nothing calls.
  - R3. A scenario test shall run each production rule that a removed name copied and that no test ran before through its production path: the release runner stops a deploy whose ops binding has `triggersPublication: true` with `release-auth` when no production authorization names the environment, and issues it when one does; `aidlc next` in CLOSE lists `stage <name>=<status>` for a requested stage that is not `pass` and skips a `not_requested` one.
  - R4. The tests that pinned a removed name shall assert the same rule through the production code: the four-attempt bound through `nextEffortAction` (`tests/core/effort.test.ts`), and the bands defaults by parsing `templates/bands.yaml` (`tests/surface/bands.test.ts`, `tests/surface/templates.test.ts`); the tests of the card transition table, `goalDoneEvidence` and `tagActionRequiresAuthority` go with them.
  - R5. The rows of `docs/REQUIREMENTS-TRACEABILITY.md` that cite `goalDoneEvidence` (LC11, Q11) or `tagActionRequiresAuthority` (Q17) shall cite the production code (`src/loop/controller.ts` `nextInClose`, `src/loop/release-runner.ts` `issue`) and the new tests instead, and the CHANGELOG Unreleased section shall carry an entry naming this card and the nine removed names.
acceptance:
  - 1. `tests/surface/removed-surface.test.ts`: `src/index.ts` exports none of the seven R1 names and still exports `selectCardState`, `MAX_BASELINE_ATTEMPTS`, `stagesForTarget` and `parseBandsYaml`; `CardRunner` has no own property `classify` or `newId`. [R1] [R2] [dod arm 2]
  - 2. `tests/scenarios/release-publication.test.ts`: a staging release whose `deploy` binding has `triggersPublication: true` stops `release-auth` with no operation issued when the goal has no production authorization for the environment, and issues the deploy when it has one. [R3] [dod arm 3]
  - 3. `tests/scenarios/goal-close-stages.test.ts`: a goal in CLOSE whose cards are closed and whose `staging` stage is `pending` gets a `close` directive whose `missing` holds `stage staging=pending` and no `not_requested` stage; with the stage `pass` it reaches DONE. [R3] [dod arm 4]
  - 4. `tests/core/effort.test.ts` asserts that the ladder admits four counted attempts and refuses a fifth through `nextEffortAction`, with no import of a removed name; `tests/surface/bands.test.ts` and `tests/surface/templates.test.ts` parse `templates/bands.yaml` in place of `DEFAULT_BANDS_YAML`. [R4] [dod arms 7, 9, 10]
  - 5. `tests/core/card-machine.test.ts`, `tests/core/release-machine.test.ts` and `tests/core/goal-machine.test.ts` pass (dod arms 5, 6, 8); that only the tests of the removed names were taken out is reviewer-verified against the diff. [R4] [dod arms 5, 6, 8]
  - 6. The same removed-surface file reads no `goalDoneEvidence` or `tagActionRequiresAuthority` in `docs/REQUIREMENTS-TRACEABILITY.md` and a T1-SWEEP2-DUPLICATES entry in the CHANGELOG Unreleased section. [R5] [dod arm 2]
depends_on: [T1-SWEEP2-FIX-TASK]
budget: 300
tdd: true
sweep: "Reference scan with the TypeScript language service over src/ and tests/ (main at 7bdaee2): each R1 name is referenced only by its declaration and tests; CardRunner.classify and CardRunner.newId have no reference. grep -rln triggersPublication tests: none. No scenario test asserts the stage lines of a CLOSE directive. grep of docs for the R1 names: only docs/REQUIREMENTS-TRACEABILITY.md rows LC11, Q11 and Q17."
forbid: [changing selectCardState, nextEffortAction, nextInClose or the release runner, changing GOAL_TRANSITIONS or RELEASE_TRANSITIONS, editing templates/bands.yaml]
non_goals: ["wiring a removed function into production", "removing GOAL_TRANSITIONS or RELEASE_TRANSITIONS, which production uses"]
hygiene: "The two new scenario tests replace unit tests of copies with tests of the code that runs, so LC11 and Q17 keep coverage."
doc_sync: docs/REQUIREMENTS-TRACEABILITY.md, CHANGELOG.md
---

# T1-SWEEP2-DUPLICATES

## Deliverable
Each rule has one implementation, the one production runs. The test-only copies go, and the two rules no test ran through production (tag publication authority and the CLOSE stage gate) get scenario tests.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/removed-surface.test.ts tests/scenarios/release-publication.test.ts tests/scenarios/goal-close-stages.test.ts tests/core/card-machine.test.ts tests/core/release-machine.test.ts tests/core/effort.test.ts tests/core/goal-machine.test.ts tests/surface/bands.test.ts tests/surface/templates.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
