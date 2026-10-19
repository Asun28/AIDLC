---
id: T1-EFF-REVIEW-CONFIG
title: Run one R2 round per R3 cycle with coverage off, move the R2 fallback and the investigator default to Claude Sonnet 5.5, and say so in the docs
status: todo
branch: T1-EFF-REVIEW-CONFIG
worktree: D:\wt\AIDLC\T1-EFF-REVIEW-CONFIG
plan_ref: plans/loop-efficiency.md#order-of-work
allow_paths:
  - aidlc.config.json
  - src/core/roles.ts
  - tests/surface/config.test.ts
  - tests/core/config.test.ts
  - tests/core/roles.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T1-EFF-REVIEW-CONFIG.md
dod_command: npm run typecheck && node --test tests/surface/config.test.ts tests/core/config.test.ts tests/core/roles.test.ts
dod_exit: 0
requirements:
  - R1. This repository's `preReview` in `aidlc.config.json` shall set `rounds` to 1 and carry no `coverage` key (so the schema default `off` applies), with its `command`, `reviewer`, `perspectives`, `onExhausted`, `timeoutMs`, `maxDiffBytes` and `answerMarker` unchanged.
  - R2. This repository's `preReview.fallback` shall run `claude -p --model claude-sonnet-5-5` under the reviewer name `claude-sonnet-5-5`, with every other argument and field of the fallback (tools, setting sources, MCP and session flags, `timeoutMs`, `maxDiffBytes`, `answerMarker`, `effort`) unchanged.
  - R3. The Claude role defaults (`DEFAULT_MODELS.claude` in `src/core/roles.ts`) shall name `claude-sonnet-5-5` for the investigator and keep `claude-opus-5-5` for the planner, implementer, reviewer and release-specialist.
  - R4. `docs/OPERATIONS.md` shall state that this repository runs one R2 round per R3 cycle, with coverage off, and Claude Sonnet 5.5 (`claude -p --model claude-sonnet-5-5`, reviewer `claude-sonnet-5-5`) as the R2 fallback, and both `docs/OPERATIONS.md` and `docs/ARCHITECTURE.md` shall name `claude-sonnet-5-5` as the investigator default.
  - R5. The CHANGELOG Unreleased section shall carry an entry naming this card, the rounds and coverage change with its reason (R3 blocked 129 of the 215 candidates R2 had passed; the shadow coverage request never changed an outcome), the fallback model and the investigator default.
acceptance:
  - 1. `tests/surface/config.test.ts`: the raw and the parsed `preReview` of `aidlc.config.json` have `rounds` 1, the parsed `coverage` is `off`, the raw object has no `coverage` key, and the command, reviewer, perspectives, `onExhausted` and answer marker are unchanged; the fallback deep-equals the pinned `SONNET` object, whose command names `claude-sonnet-5-5` and whose reviewer is `claude-sonnet-5-5`. [R1] [R2] [dod arm 2]
  - 2. `tests/core/config.test.ts`: the repository's parsed `preReview.coverage` is `off` and the template's stays `off`. [R1] [dod arm 3]
  - 3. `tests/core/roles.test.ts`: `resolveRoleProfile({ role: 'investigator', family: 'claude' }).model` is `claude-sonnet-5-5`, and `DEFAULT_MODELS.claude` deep-equals the five-role map with `claude-sonnet-5-5` for the investigator and `claude-opus-5-5` for the other four. [R3] [dod arm 4]
  - 4. `tests/surface/config.test.ts`: `docs/OPERATIONS.md` contains the sentence for this repository's R2 setup naming one round per R3 cycle, coverage off and `claude-sonnet-5-5`, and the coverage paragraph says this repository runs `off`; the CHANGELOG Unreleased section has a T1-EFF-REVIEW-CONFIG entry. That ARCHITECTURE names `claude-sonnet-5-5` for the investigator is reviewer-verified against the diff. [R4] [R5] [dod arm 2]
depends_on: []
budget: 80
tdd: true
sweep: "git grep claude-sonnet-5 (main at 597e9a2, tracked files, archives excluded): aidlc.config.json:70,79; src/core/roles.ts:28; docs/OPERATIONS.md:15,233; docs/ARCHITECTURE.md:12; tests/core/roles.test.ts:17,72,74; tests/surface/config.test.ts:437,438,461,495; tests/surface/providers.test.ts:169,170 (a request-model passthrough fixture, not a default: untouched). git grep rounds/coverage pins: aidlc.config.json:54,55; docs/OPERATIONS.md:222 (a generic example snippet: untouched),245; tests/surface/config.test.ts:474,477; tests/core/config.test.ts:61-63. Scenario fixtures that set rounds 3 in their own config (tests/scenarios/*) do not read aidlc.config.json: untouched."
forbid: [changing the R2 primary command or reviewer, changing the fallback's tools or effort policy, changing any formalReview setting, changing the schema defaults in src/config.ts]
non_goals: ["any code change to how R2 runs (the per-angle fallback is T1-EFF-R2-ANGLE-FALLBACK)", "removing the coverage feature or its schema", "changing the R3 reviewer or its fallback"]
hygiene: "Five existing assertions pin the values this card changes as the spec requires: tests/surface/config.test.ts:436-443 (SONNET), 474 (rounds 3), 477 (coverage shadow) and the OPERATIONS sentence at 495; tests/core/config.test.ts:63; tests/core/roles.test.ts:17 and 74. Each is changed to the new value, and the test titles that name Claude Sonnet 5 name Sonnet 5.5. The historical T0-R2-FALLBACK-3 CHANGELOG entry pinned at tests/surface/config.test.ts:501 stays: it records what that card shipped."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T1-EFF-REVIEW-CONFIG

## Deliverable
This repository's R2 runs one round per R3 cycle with coverage off, its fallback and the Claude investigator default name Claude Sonnet 5.5, and the docs and the CHANGELOG say so.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/config.test.ts tests/core/config.test.ts tests/core/roles.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
