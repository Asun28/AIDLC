---
id: T1-EFF-AGENTS-DOD
title: Give every agent file a model and an effort, start the implementer at the directive's effort, and make card DoDs run the card's own checks while the full suite runs in CI
status: merged
branch: T1-EFF-AGENTS-DOD
worktree: D:\wt\AIDLC\T1-EFF-AGENTS-DOD
plan_ref: plans/loop-efficiency.md#order-of-work
allow_paths:
  - .claude/agents/
  - templates/claude/agents/
  - .claude/skills/aidlc-loop/arc.md
  - templates/claude/skills/aidlc-loop/arc.md
  - templates/cards/_TEMPLATE.md
  - specs/tasks/_TEMPLATE.md
  - CLAUDE.md
  - templates/CLAUDE.aidlc.md
  - tests/surface/templates.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-EFF-AGENTS-DOD.md
dod_command: npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts
dod_exit: 0
requirements:
  - R1. Each agent file under `templates/claude/agents/` and its byte-identical live copy under `.claude/agents/` shall carry a `model:` and an `effort:` front matter line, with these values: planner `opus` and `high`; reviewer `opus` and `medium`; release-specialist `opus` and `medium`; investigator `sonnet` and `medium`; verifier `sonnet` and `medium`; implementer `inherit` and `medium`.
  - R2. The dispatch rules of `arc.md` (both copies, identical and under the byte cap) shall tell the coordinator to start an implementer subagent with the `run-card` directive's `effort` as the subagent's effort.
  - R3. The `Verifying your work` section of `templates/CLAUDE.aidlc.md` and of CLAUDE.md (identical) shall state that the card's `dod_command` runs the typecheck and the card's own tests, that the full suite and the build run in CI on every candidate and run locally only when the change can break them in a way the card's tests cannot show, that the DoD output is pasted before a task is reported complete, and that the card machine refuses SHIP without a DoD receipt; it shall no longer say that a hook blocks done.
  - R4. The planner agent (both copies) shall state that each card's `dod_command` runs only that card's tests and fast static checks, never the full suite, which CI runs; the implementer agent (both copies) shall run the `dod_command`, not "the affected checks"; the `dod_command` comment of both card templates (`templates/cards/_TEMPLATE.md`, `specs/tasks/_TEMPLATE.md`) shall say the same.
  - R5. `docs/OPERATIONS.md` shall state the agent model and effort defaults of R1 with their reason (the Opus 5.5 and Sonnet 5.5 effort guidance) and the implementer effort rule of R2, and the CHANGELOG Unreleased section shall carry an entry naming this card, the agent defaults, the implementer effort rule and the targeted DoD.
acceptance:
  - 1. `tests/surface/templates.test.ts`: for each of the six agent files under `templates/claude/agents/`, the front matter has exactly one `model:` line and one `effort:` line with the R1 values; `tests/surface/mirror.test.ts` passes unchanged, so the live copies are byte-identical. [R1] [dod arms 2, 3]
  - 2. `tests/surface/templates.test.ts`: both `arc.md` copies are identical, stay under the 4500-byte cap and contain the sentence that starts an implementer subagent at the directive's `effort`. [R2] [dod arm 2]
  - 3. `tests/surface/templates.test.ts`: the `Verifying your work` section of `templates/CLAUDE.aidlc.md` names the typecheck and the card's own tests as the DoD, says the full suite runs in CI, says the card machine refuses SHIP without a DoD receipt, and does not contain `A hook blocks`; `tests/surface/mirror.test.ts` passes, so CLAUDE.md ends with the same section. [R3] [dod arms 2, 3]
  - 4. `tests/surface/templates.test.ts`: the planner agent states the targeted DoD rule, the implementer agent's procedure no longer says `the affected checks`, and both card templates' `dod_command` comments name the card's own tests and CI for the full suite. [R4] [dod arm 2]
  - 5. `tests/surface/templates.test.ts`: `docs/OPERATIONS.md` names the six agent defaults and the implementer effort rule, and the CHANGELOG Unreleased section has a T1-EFF-AGENTS-DOD entry. [R5] [dod arm 2]
depends_on: []
budget: 140
tdd: true
sweep: "Agent files (main at 597e9a2): templates/claude/agents/{implementer,investigator,planner,release-specialist,reviewer,verifier}.md, front matter keys name/description/tools only, live copies byte-identical (tests/surface/mirror.test.ts). Byte caps (tests/surface/templates.test.ts:19): arc.md 4500, current 4162. DoD prose: templates/CLAUDE.aidlc.md:26-33 (Verifying your work, 'A hook blocks \"done\"', which the Stop guard never does), templates/claude/agents/implementer.md:19 ('Run `dod_command` and the affected checks'), templates/claude/agents/planner.md (no DoD rule), templates/cards/_TEMPLATE.md:14 and specs/tasks/_TEMPLATE.md:14 (dod_command comment). No test pins the old Verifying text (git grep 'Run all applicable checks|A hook blocks' tests: none)."
forbid: [changing an agent's tools or description, changing card-loop.md or SKILL.md, changing any gate, changing which commands CI runs]
non_goals: ["a model field in the run-card directive (the implementer inherits the session model)", "changing the BUILD narration in src/loop/card-runner.ts", "removing npm run check from the repository or from CI"]
hygiene: "No existing assertion pins the text this card replaces; the new assertions read the template copies and rely on tests/surface/mirror.test.ts for the live copies, so each fact is asserted once."
doc_sync: CLAUDE.md, docs/OPERATIONS.md, CHANGELOG.md
---

# T1-EFF-AGENTS-DOD

## Deliverable
Every agent runs on a named model at a named effort (Opus for planning, review and release, Sonnet for investigation and verification, the session's model for implementation), the coordinator starts an implementer at the directive's effort, and every card's DoD runs the card's own checks while CI runs the full suite.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/templates.test.ts tests/surface/mirror.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
