---
id: T0-CLAUDE-MD-TRIM
title: CLAUDE.md stays within 200 lines, held by a test, with the text that docs and skills already state removed
status: todo
branch: T0-CLAUDE-MD-TRIM
worktree: D:\wt\AIDLC\T0-CLAUDE-MD-TRIM
allow_paths:
  - CLAUDE.md
  - templates/CLAUDE.aidlc.md
  - tests/surface/claude-md-size.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-CLAUDE-MD-TRIM.md
dod_command: npm run typecheck && node --test tests/surface/claude-md-size.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/config.test.ts tests/surface/bench.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/prose.test.ts tests/infra/build-atomic.test.ts tests/infra/init.test.ts
dod_exit: 0
requirements:
  - R1. `CLAUDE.md` shall hold at most 200 lines.
  - R2. The Conventions section of `CLAUDE.md` shall carry the sentence of the Doc text section, which states the limit, its reason and the test that holds it.
  - R3. `CLAUDE.md` shall no longer carry the text the Removed text section lists, and each listed item shall stay stated in the home that section names.
  - R4. `templates/CLAUDE.aidlc.md` shall stay the verbatim end of `CLAUDE.md`, so a repository that `aidlc init` writes gets the shorter section.
  - R5. The CHANGELOG Unreleased section shall carry an entry naming this card.
acceptance:
  - 1. `tests/surface/claude-md-size.test.ts`: `CLAUDE.md`, read with LF line ends, holds at most 200 lines, and the same counting function reports 201 for a text of 201 lines. [R1] [dod arm 2]
  - 2. Same file: the Conventions section holds the sentence of the Doc text section, and the check that reads it fails with the sentence removed. [R2] [dod arm 2]
  - 3. Reviewer-verified from the diff: every removed sentence is an item of the Removed text section and is stated in the home that section names; no fact leaves with no home. [R3]
  - 4. `tests/surface/mirror.test.ts` passes with no assertion changed. [R4] [dod arm 2]
  - 5. Every other test of the dod_command passes with no assertion changed, so each sentence those tests pin stays where it is. [R3] [dod arm 2]
  - 6. `tests/surface/claude-md-size.test.ts` reads a T0-CLAUDE-MD-TRIM entry in the CHANGELOG Unreleased section. [R5] [dod arm 2]
depends_on: []
budget: 300
tdd: true
sweep: "git grep CLAUDE on main at c93f77f over tests, src and .claude/agents: bench.test.ts, build-atomic.test.ts, command-lines.test.ts, config.test.ts, templates.test.ts and tsconfig-gate.test.ts pin sentences that stay; mirror.test.ts holds the template as the end of the file; .claude/agents/verifier.md names the Commands section, and mirror.test.ts and prose.test.ts comments name the Conventions and Writing density headings, so those headings stay. No test pins a removed phrase."
forbid: [weakening or skipping a test to go green, changing an existing assertion, removing a fact that has no stated home, unwrapping lines to lower the count]
non_goals: ["the 80-line limit, replaced by 200 in this session", "moving the environment variable sentences out of CLAUDE.md", "path-scoped .claude/rules/ files", "changing a section an existing repository already has (aidlc init leaves it)", "changes to src/, hooks, skills, REVIEW.md or docs/"]
doc_sync: CHANGELOG.md
---

# T0-CLAUDE-MD-TRIM

## Deliverable
`CLAUDE.md` drops from 215 lines to well under 200 by removing text stated elsewhere, and a test holds the 200-line limit. Anthropic's Claude Code memory documentation targets under 200 lines per file because longer files use more context and reduce adherence. Nothing recorded a limit in this repository, which is how the file reached 215.

## Removed text
| Removed from CLAUDE.md | Home |
|---|---|
| The sentence "This file provides guidance to Claude Code" | Nothing to keep: it states no fact |
| The per-directory `src/` layer descriptions | `docs/ARCHITECTURE.md`, Module map; a one-line layer order stays |
| The detail of `aidlc report`, `aidlc card attempt` and "nothing else is the next step" | `.claude/skills/aidlc-loop/SKILL.md`, Contract; `docs/ARCHITECTURE.md`, Directive contract |
| The review allowances (block, effort episode, ruling, quota hold, malformed verdict) | `docs/OPERATIONS.md`, Pre-review (R2), which the paragraph now names |
| The repeat of "`npm run dev -- <cmd>` always runs the sources" | The Commands block of the same file |
| The Lessons bullet | `docs/LESSONS.md` header; the `prepare` directive narration; `docs/OPERATIONS.md`, Companion skills |
| The Companion skills bullet | `.claude/skills/aidlc-loop/SKILL.md`, Modules; `docs/OPERATIONS.md`, Companion skills |
| The Deadlines bullet | `.claude/skills/aidlc-loop/SKILL.md`, Entry checks 4 and Effort |
| The heading words "(no exceptions)" and "(all text, at all times)" | Nothing to keep: emphasis only |
| The longer reasoning of Writing density | One sentence of it stays |

## Doc text
Conventions sentence:

This file stays within 200 lines (`tests/surface/claude-md-size.test.ts`): every session loads it, and a longer file costs context and adherence, so detail goes in `docs/`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/claude-md-size.test.ts tests/surface/mirror.test.ts tests/surface/templates.test.ts tests/surface/command-lines.test.ts tests/surface/config.test.ts tests/surface/bench.test.ts tests/surface/tsconfig-gate.test.ts tests/surface/prose.test.ts tests/infra/build-atomic.test.ts tests/infra/init.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every listed test passes.
