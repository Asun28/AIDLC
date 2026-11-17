---
id: T1-XHIGH-COORDINATOR-EFFORT
title: The router skill starts a helper subagent for a search or a fetch as a named agent type at medium, not as a fork, within its 4500-byte cap, and docs/OPERATIONS.md says who sets the coordinator's effort and what xhigh does to a coordinator turn
status: todo
branch: T1-XHIGH-COORDINATOR-EFFORT
worktree: D:\wt\AIDLC\T1-XHIGH-COORDINATOR-EFFORT
plan_ref: plans/coordinator-xhigh.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - templates/claude/skills/aidlc-loop/SKILL.md
  - .claude/skills/aidlc-loop/SKILL.md
  - docs/OPERATIONS.md
  - tests/surface/coordinator-effort.test.ts
  - CHANGELOG.md
  - changelog.d/T1-XHIGH-COORDINATOR-EFFORT.md
  - specs/tasks/T1-XHIGH-COORDINATOR-EFFORT.md
dod_command: npm run typecheck && node --test tests/surface/coordinator-effort.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/command-lines.test.ts tests/surface/removed-surface.test.ts tests/surface/readme.test.ts tests/surface/init-base-ci.test.ts tests/surface/frontmatter.test.ts tests/infra/init.test.ts
dod_exit: 0
requirements:
  - R4. The Effort section of both copies of the `aidlc-loop` router skill shall say that a helper subagent for a search or a fetch is started as a named agent type at `medium` effort, not as a fork.
  - R5. The two copies of the router skill shall stay byte-identical, ASCII and at most 4500 bytes, and lose only a sentence whose rule `card-loop.md` states.
  - R6. The file `docs/OPERATIONS.md` shall state who sets the coordinator's effort, what `xhigh` does to a coordinator turn on Claude Opus 5.5, that lowering the effort shortens a coordinator turn, that the guide reserves `xhigh` and `max` for measured gains, and at which effort helper subagents and implementers run, without recommending a level.
acceptance:
  - 1. tests/surface/coordinator-effort.test.ts (new), the test whose title starts with `acceptance 1` - in both copies of `aidlc-loop/SKILL.md` the text from `## Effort (MA1/MA2)\n` up to, not including, `\n## Output` equals the Effort section of Acceptance detail; the two copies are equal, ASCII and at most 4500 bytes. It fails on main. [R4] [R5] [dod arm 2]
  - 2. Same file, the test whose title starts with `acceptance 2` - neither router skill copy contains `records every attempt`, and both copies of `aidlc-loop/card-loop.md`, read with whitespace folded to one space, contain ``Attempts (MA2): `aidlc card attempt <id>`` and `no fifth from another session or card`. [R5] [dod arm 2]
  - 3. Same file, the test whose title starts with `acceptance 3` - in `docs/OPERATIONS.md`, split on line ends, the line two after the one that starts `Claude Code effort (card T0-CLAUDE-EFFORT-OPT-IN)` equals the paragraph of Acceptance detail, and the lines one before and one after it are empty. It fails on main. [R6] [dod arm 2]
  - 4. tests/surface/templates.test.ts (the caps and every test that reads the router skill), tests/surface/mirror.test.ts, tests/surface/prose.test.ts (with the guard of T1-XHIGH-PROSE-GUARD reading the new text), tests/surface/command-lines.test.ts, tests/surface/removed-surface.test.ts, tests/surface/readme.test.ts, tests/surface/init-base-ci.test.ts (the paragraph two lines after the Agent files paragraph), tests/surface/frontmatter.test.ts (the Card front matter sentences) and tests/infra/init.test.ts pass with no line changed. [R4] [R5] [R6] [dod arm 2]
  - 5. The changelog entry of Acceptance detail is in `CHANGELOG.md` Unreleased, or, when `CLAUDE.md` on main at PREPARE says a card's entry is its own file, in `changelog.d/T1-XHIGH-COORDINATOR-EFFORT.md` followed by one line feed (reviewer-verified against the diff). [R4] [R5] [R6]
  - 6. `npm run typecheck` exits 0. [R4] [dod arm 1]
depends_on: [T1-XHIGH-PROSE-GUARD]
budget: 80
tdd: true
sweep: "Main at 332956a2. Both `aidlc-loop/SKILL.md` copies are equal, 4488 bytes, LF line ends, cap 4500 (`tests/surface/templates.test.ts:20`). The Effort section is `SKILL.md:69-75`, 422 bytes; the section of Acceptance detail is 413 bytes and brings the file to 4479 bytes (measured 2026-11-17 by replacing the section in the template copy). No test pins the Effort section's wording (`git grep` of tests/ for its sentences). `card-loop.md` BUILD (lines 56-61) holds ``Attempts (MA2): `aidlc card attempt <id> --outcome success|fail|not-counted`` and `a fourth failure ends the episode; no fifth from another session or card.` The Agent tool ignores `effort` for a fork, which runs at the session's effort (the tool's description). In `docs/OPERATIONS.md`, line 29 is the paragraph that starts `Claude Code effort (card T0-CLAUDE-EFFORT-OPT-IN)` and line 31 the one that starts `Card front matter (card T0-FM-COMMENT-CUT-2`; no test pins the line after the Claude Code effort paragraph, and `tests/surface/frontmatter.test.ts:111-114` reads the Card front matter sentences by content. The paragraph cannot follow `Agent files name a model and an effort` (:19): `tests/surface/init-base-ci.test.ts:397` requires the T1-INIT-BASE-CI paragraph two lines after it. Tests that read the router skill: templates, mirror, prose, command-lines, removed-surface, readme (tests/surface) and init (tests/infra), all in the DoD."
forbid:
  - a change to a line of either router skill copy outside the Effort section, or to card-loop.md, arc.md, an agent file, CLAUDE.md or templates/CLAUDE.aidlc.md
  - removing or weakening a safety rule, a prohibition or a confirmation step
  - raising a byte cap, or changing an existing test
  - a recommended effort level for the coordinator, or text that asks an unattended coordinator to continue
  - weakening, skipping or deleting a test to go green
non_goals:
  - the effort or model of an agent file, of the run-card directive or of the R3 fallback
  - recording the coordinator's effort (intent/run-attribution.md)
  - the guard itself (T1-XHIGH-PROSE-GUARD)
hygiene: "Line numbers are from main at 332956a2; read them again at PREPARE, and measure the router skill again: if a card merged since then changed it, the section of Acceptance detail must still fit under 4500 bytes, else STOP and ask, since the cap does not rise. Keep the OPERATIONS paragraph one line. Not verified before the card runs: that Claude Code honours the Agent tool's `effort` for a named agent type without an `effort` in its definition, and which effort a built-in search agent runs at when none is passed; the card states the rule, not that behaviour."
---

# T1-XHIGH-COORDINATOR-EFFORT

## Deliverable
The router skill's Effort section tells the coordinator to start a helper subagent for a search or a fetch as a named agent type at `medium`, not as a fork, and drops a sentence that `card-loop.md` BUILD already states, so the file stays under its 4500-byte cap. `docs/OPERATIONS.md` gains one paragraph on the coordinator's effort.

## Why
Plan `plans/coordinator-xhigh.md`. The owner runs the coordinator on Claude Opus 5.5 at `xhigh`. The agent files name their effort and an implementer runs at the `run-card` directive's effort, but a helper the coordinator starts for a search or a fetch without an effort runs at the session's effort, and a fork always does; at `xhigh` that is the most thinking per turn short of `max`, for work the Effort guide lists under `low` ("subagents"). The owner chose `medium`, the Opus 5.5 default and the level of every agent file except the planner. No document says what the coordinator's effort is or what `xhigh` does to its turns; the owner chose a paragraph that describes it and recommends no level.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/coordinator-effort.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/surface/command-lines.test.ts tests/surface/removed-surface.test.ts tests/surface/readme.test.ts tests/surface/init-base-ci.test.ts tests/surface/frontmatter.test.ts tests/infra/init.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every acceptance test above passes.

## Acceptance detail
Effort section of both router skill copies (acceptance 1), from its heading to the line before the blank line that precedes `## Output`, LF line ends:

```
## Effort (MA1/MA2)
Assess each task alone (uncertainty, scope, risk, verification burden),
never by the coordinator's effort; start helpers (search, fetch) as named
agents at `medium`, not as forks. At most 4 counted attempts: baseline + 2
repairs + 1 justified escalation to the next supported level. Same cause
twice with no progress => stop early. Quota, expected RED, tool outage and
env setup do not count.
```

`docs/OPERATIONS.md`, a new paragraph two lines after the paragraph that starts `Claude Code effort (card T0-CLAUDE-EFFORT-OPT-IN)`, one line (acceptance 3):

"Coordinator effort (card T1-XHIGH-COORDINATOR-EFFORT). The coordinator's effort is the effort of the Claude Code session that runs the loop: the owner sets it with the session, and aidlc neither sets nor records it. On Claude Opus 5.5 a higher level means more thinking per turn, and the Effort guide says it can also mean more tool calls, a plan stated before acting and longer summaries, so at `xhigh` a coordinator turn takes longer and costs more than at `medium`, the model's default. The Opus 5.5 guides list `xhigh` for agentic work of over 30 minutes and reserve `xhigh` and `max` for work where a quality gain was measured; this repository has measured none for the coordinator and recommends no level. To shorten coordinator turns, lower the session's effort: that reduces thinking more reliably than prose does, and the loop's agent, skill and instruction files carry no line that asks the model to think more or less or to hold back its updates (`tests/surface/prose.test.ts`). A helper subagent the coordinator starts for a search or a fetch is a named agent type at `medium` (the router skill, Effort), since a fork runs at the session's effort; an implementer runs at the `run-card` directive's effort, and the other agent files name their own."

Changelog entry (acceptance 5), one line:

"- T1-XHIGH-COORDINATOR-EFFORT: the router skill starts a helper subagent for a search or a fetch as a named agent type at `medium`, not as a fork, which runs at the coordinator session's effort. Its Effort section no longer repeats that `aidlc card attempt` records every attempt and that limits persist across sessions; `card-loop.md` BUILD states both. `docs/OPERATIONS.md` says who sets the coordinator's effort and what `xhigh` does to a coordinator turn on Claude Opus 5.5, and recommends no level."

## Attempt evidence
Build attempt 1. RED receipt `19cc0561:1` (acceptance 1 failed: old Effort section; acceptance 2 failed: `records every attempt` still present; acceptance 3 failed: line i+2 was the Card front matter paragraph).

| Item | Proof | Result |
|---|---|---|
| 1 | `acceptance 1` in `tests/surface/coordinator-effort.test.ts`; both SKILL.md copies 4479 bytes, `cmp` identical | pass (failed at RED) |
| 2 | `acceptance 2` in `tests/surface/coordinator-effort.test.ts` | pass (failed at RED) |
| 3 | `acceptance 3` in `tests/surface/coordinator-effort.test.ts` | pass (failed at RED) |
| 4 | templates, mirror, prose, command-lines, removed-surface, readme, init-base-ci, frontmatter (tests/surface) and tests/infra/init.test.ts, no line changed | pass, DoD 175 of 175 |
| 5 | `CHANGELOG.md` Unreleased, first entry, the card's text (CLAUDE.md Conventions still names `CHANGELOG.md` (Unreleased)) | present |
| 6 | `npm run typecheck` | exit 0 |
