---
slug: coordinator-xhigh
title: A coordinator session on Claude Opus 5.5 at xhigh starts its helper subagents at medium, the docs say what xhigh does to a coordinator turn, and a test refuses prose that steers thinking depth
intent: intent/coordinator-xhigh.md
status: draft
created: 2026-11-16T23:55:00Z
skills_applied: [grilling]
---

# Spec: A coordinator session on Claude Opus 5.5 at xhigh starts its helper subagents at medium, the docs say what xhigh does to a coordinator turn, and a test refuses prose that steers thinking depth
From intent: intent/coordinator-xhigh.md. Status: draft. Skills applied: grilling.

## Requirements (EARS)
- R1. The function `removedInstructions` of `tests/surface/prose.test.ts` shall flag prose that steers thinking depth: think harder, think less or think more, do not overthink, and do not think.
- R2. The function `removedInstructions` shall flag prose that suppresses updates: hold the findings or the results, do not narrate, and no interim updates.
- R3. The prompt-file check of `tests/surface/prose.test.ts` shall read `CLAUDE.md` and `templates/CLAUDE.aidlc.md` beside the agent files, the skill files and `REVIEW.md`.
- R4. The Effort section of both copies of the `aidlc-loop` router skill shall say that a helper subagent for a search or a fetch is started as a named agent type at `medium` effort, not as a fork.
- R5. The two copies of the router skill shall stay byte-identical, ASCII and at most 4500 bytes, and lose only a sentence whose rule `card-loop.md` states.
- R6. The file `docs/OPERATIONS.md` shall state who sets the coordinator's effort, what `xhigh` does to a coordinator turn on Claude Opus 5.5, that lowering the effort shortens a coordinator turn, that the guide reserves `xhigh` and `max` for measured gains, and at which effort helper subagents and implementers run, without recommending a level.

## Design
Guard. `REMOVED_INSTRUCTIONS` (`tests/surface/prose.test.ts:99-108`) gains six entries, one
per phrase family of R1 and R2, each matched case-insensitively across line breaks as the
existing entries are. A name is the phrase the test reports. `PROMPT_FILES` (`:116`) gains
`CLAUDE.md` and `templates/CLAUDE.aidlc.md`. The test `acceptance 5` (`:264`) then reads both
and finds no offender: on main at 332956a2 none of the scanned files, nor the review prompts,
carries a phrase of R1 or R2 [SOURCE: grep of 2026-11-17 over `.claude`, `templates`,
`CLAUDE.md`, `REVIEW.md`, `src/review` and `src/hooks`]. Why these phrases: on Claude Opus 5.5
thinking cannot be turned off and the effort level controls it ("To get less thinking, lower
the effort level first", Prompting Claude Opus 5.5, Calibrate effort), and Opus 5.5 is named
among the models that under-narrate when an update suppressor is present (Claude API skill,
prompt audit, group 1d, read 2026-11-17).

Router skill. The Effort section (`SKILL.md:69-75`, 422 bytes, file 4488 of 4500 bytes)
becomes the text of the card's acceptance detail (413 bytes, file 4479 bytes [SOURCE:
measured 2026-11-17 by replacing the section in the template copy]). Its first sentence keeps
the rule that a task's effort is assessed alone and adds the helper rule; the Agent tool
ignores `effort` for a fork, so the rule names the agent type. The section's last sentence,
"`aidlc card attempt` records every attempt; limits persist across session changes.", leaves
it: `card-loop.md` BUILD states both (`Attempts (MA2): \`aidlc card attempt <id> ...`` and "no
fifth from another session or card"), and every card route loads `card-loop.md`. No other
line of the file changes. No test pins the Effort section's wording [SOURCE: grep of `tests/`
on 2026-11-17].

Docs. One paragraph after the paragraph that starts `Claude Code effort (card
T0-CLAUDE-EFFORT-OPT-IN)` (`docs/OPERATIONS.md:29`), whose topic is effort. It cannot follow
the paragraph that starts `Agent files name a model and an effort` (`:19`), because
`tests/surface/init-base-ci.test.ts:397` requires the T1-INIT-BASE-CI paragraph two lines
after that one.

## Interfaces and contracts
- `removedInstructions(text)` keeps its signature and returns the new names as well.
- The router skill's Effort section text; no directive, state record, configuration key or
  CLI output changes.

## Data model and migration impact
none

## Flagged concerns (route to policy owners)
- (none)

## Non-goals
- The implementer, planner, reviewer, investigator, verifier or release-specialist effort or
  model; `aidlc.config.json`; the effort ladder in `src/core/effort.ts`.
- A recommended effort level for the coordinator.
- Text that asks an unattended coordinator to continue instead of ending its turn.
- Recording the coordinator's effort in the usage record (`intent/run-attribution.md`).
- Scanning `src/hooks` message strings with the guard; their messages are evidence-bound
  reminders and hold no phrase of R1 or R2.
- The owner's user-level instruction file, which is outside the repository.

## Acceptance
- 1. `removedInstructions` returns the right name for each phrasing of R1 and R2 and nothing for the look-alike phrasings, and fails on main for the first set. [R1] [R2]
- 2. The prompt-file test reads `CLAUDE.md` and `templates/CLAUDE.aidlc.md` and finds no offender. [R3]
- 3. Both router skill copies hold the new Effort section exactly, are identical, ASCII and at most 4500 bytes, and `card-loop.md` still states the moved rule. [R4] [R5]
- 4. `docs/OPERATIONS.md` holds the new paragraph exactly, two lines after the Claude Code effort paragraph. [R6]
