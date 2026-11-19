---
id: T1-R3-PANEL-ON
title: This repository runs the R3 panel that docs/reliability/panel.md kept, with secondPass off, and the docs give the measure that turns it off after 30 cards
status: todo
branch: T1-R3-PANEL-ON
worktree: D:\wt\AIDLC\T1-R3-PANEL-ON
plan_ref: plans/review-panel.md#order-of-work
allow_paths:
  - aidlc.config.json
  - docs/OPERATIONS.md
  - changelog.d/T1-R3-PANEL-ON.md
  - tests/surface/config-repo.test.ts
  - specs/tasks/T1-R3-PANEL-ON.md
dod_command: npm run typecheck && node --test tests/surface/config-repo.test.ts tests/surface/config.test.ts
dod_exit: 0
requirements:
  - R1. aidlc.config.json shall set `formalReview.panel` to the member `keep.member2` of bench/outcome/panel.json names (`fable`: the argv of bench/outcome/fable-r3.json; `codex`: the primary's argv with reviewer `codex-panel`), and remove `formalReview.secondPass`. templates/aidlc.config.json is unchanged.
  - R2. docs/OPERATIONS.md (Formal review (R3) as a command) shall name the setting, the panel.md measures it rests on, and the loop measures of intent/review-panel.md read after 30 cards with `aidlc review stats` (cards with two or more R3 blocks below 33.3%, STOP/review rate not higher), and how to turn it off (remove `panel`, restore `secondPass: true`).
acceptance:
  - 1. `tests/surface/config-repo.test.ts` (new or extended), "T1-R3-PANEL-ON acceptance 1: this repository's config parses, sets formalReview.panel to the kept member and sets no secondPass". Fails on main. [R1] [dod arm 1]
  - 2. config.test.ts passes with no line changed. [R1] [dod arm 1]
  - 3. The OPERATIONS.md text and changelog entry are as R2 states (reviewer-verified against the diff). [R2]
depends_on: [T1-R3-PANEL-FOLD, T1-PANEL-ARMS-REPORT]
budget: 60
tdd: true
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test
  - starting this card when bench/outcome/panel.json `keep.panel` is not `keep`
non_goals: [the panel in templates/aidlc.config.json (downstream repos opt in), a change under src/]
hygiene: "With `keep.panel` = `drop`, close the card unmerged and record the verdict as its reason (plans/review-panel.md Order of work 5)."
---

# T1-R3-PANEL-ON

## Deliverable
Every R3 decision in this repository runs both panel members, on the evidence of panel.md, with a written exit rule.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config-repo.test.ts tests/surface/config.test.ts
```
- Expected exit code: 0
- Assertion: the new test passes and config.test.ts passes unchanged.
