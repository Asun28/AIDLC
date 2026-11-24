---
slug: coordinator-xhigh
title: A coordinator session on Claude Opus 5.5 at xhigh starts its helper subagents at medium, the docs say what xhigh does to a coordinator turn, and a test refuses prose that steers thinking depth
author: asun28 (owner)
status: accepted
created: 2026-11-16T23:45:00Z
source: human
---

# Intent: A coordinator session on Claude Opus 5.5 at xhigh starts its helper subagents at medium, the docs say what xhigh does to a coordinator turn, and a test refuses prose that steers thinking depth
Author: asun28 (owner). Status: accepted.

## Problem
The owner now runs the coordinator session (the Claude Code session that drives `aidlc next`,
`aidlc card next` and the arc) on Claude Opus 5.5 at `xhigh` effort. Goal
g-20261116225057-912fa3 asks that the coordinator text fit that setting. Facts from main at
332956a2 and the guides read on 2026-11-17:

- The guides. Prompting Claude Opus 5.5, Calibrate effort: "At a given level, Claude Opus 5.5
  tends to think more per turn than Claude Opus 5, especially at `xhigh` and `max`", "To get
  less thinking, lower the effort level first", "Reserve `xhigh` and `max` for work where
  you've measured a quality gain". Effort, Effort levels: `xhigh` is for "Long-running agentic
  and coding tasks (over 30 minutes)", and `low` lists "subagents" as a typical use. Effort,
  Effort with tool use: higher effort can "Make more tool calls", "Explain the plan before
  taking action" and "Provide detailed summaries of changes".
- The coordinator text is clean of the instructions the Opus 5 and 5.5 guides say to remove.
  No hit in `.claude/skills`, `templates/claude`, `CLAUDE.md`, `templates/CLAUDE.aidlc.md`,
  `REVIEW.md`, `src/review` or `src/hooks` for pressure language, double-check, think
  carefully or step by step (the guard of T1-OPUS55-PROMPTS), nor for prose that steers
  thinking depth (think harder or less, do not overthink, do not think) or that suppresses
  updates (hold the findings, do not narrate, no interim updates). The hook messages are
  evidence-bound reminders (DoD receipt, test lock, secrets) and stay.
- The guard does not cover the second group. `tests/surface/prose.test.ts:99-108`
  (`REMOVED_INSTRUCTIONS`) lists seven instructions, none about thinking depth or updates, and
  its file list (`:116`) holds the agent and skill files and `REVIEW.md`, not `CLAUDE.md` or
  `templates/CLAUDE.aidlc.md`, which every session loads.
- Helper subagents take the coordinator's effort. The six agent files set `effort`, and
  `arc.md:27` starts an implementer at the `run-card` directive's effort. A helper the
  coordinator starts for a search or a fetch without such an effort runs at the session's
  effort, now `xhigh`; the Agent tool ignores `effort` for a fork, which always runs at the
  session's effort.
- No document says what the coordinator's effort is or what `xhigh` does to its turns.
  `docs/OPERATIONS.md:19` covers the agent files only.

## Proposed outcome
1. A helper subagent the coordinator starts for a search or a fetch is a named agent type at
   `medium`, not a fork. The rule is in the Effort section of the `aidlc-loop` router skill,
   which every route loads, within the 4500-byte cap.
2. `docs/OPERATIONS.md` says that the owner sets the coordinator's effort with the session,
   what `xhigh` does to a coordinator turn, that turns are shortened by lowering the effort and
   not by prose, and that the guide reserves `xhigh` for measured gains. It recommends no level.
3. The guard refuses prose that steers thinking depth and prose that suppresses updates, and
   it reads `CLAUDE.md` and `templates/CLAUDE.aidlc.md` as well.

## Affected users and systems
Every coordinator session of this repository and of each downstream repository on its next
`aidlc init` (the router skill); `.claude/skills/aidlc-loop/SKILL.md` and its template copy,
`docs/OPERATIONS.md`, `tests/surface/prose.test.ts`, a new surface test, the changelog.

## Constraints
- No change to the implementer, planner or reviewer effort, to an agent file, to
  `aidlc.config.json`, to `src/` or to the effort ladder.
- No skill byte cap rises. SKILL.md is 4488 of 4500 bytes, so the added rule is paid for by
  text whose rule another loaded file states.
- No safety rule, prohibition or confirmation step is removed.
- No line asking for unattended continuation is added: coordinator sessions here are
  interactive, and the guide says to leave that text out of human-in-the-loop sessions.
- Cards of at most 120 changed lines and at most 8 allowed paths.
- Sources: Prompting Claude Opus 5.5 and Effort on platform.claude.com, and the Opus 5.5
  migration guide, read 2026-11-17.
- Owner decisions of 2026-11-17, in the session: helper subagents at `medium`; a docs
  paragraph that describes `xhigh` and recommends no level; no unattended early-stop text; no
  measurement of the coordinator's effort in this goal (recording it belongs to
  `intent/run-attribution.md`).

## Open questions
- (none)
