---
slug: loop-efficiency
title: Cut the measured cost of running the loop and fit it to Claude Opus 5.5 and Sonnet 5.5
intent: intent/loop-efficiency.md
status: accepted
created: 2026-10-19T09:45:00Z
skills_applied: []
---

# Spec: Cut the measured cost of running the loop and fit it to Claude Opus 5.5 and Sonnet 5.5
From intent: intent/loop-efficiency.md. Status: accepted. Skills applied: (none).

## Requirements (EARS)
- R1. The pre-review configuration of this repository shall run one R2 round per R3 cycle with coverage off and name `claude-sonnet-5-5` for its R2 fallback, and the Claude role defaults name it for the investigator (card T1-EFF-REVIEW-CONFIG).
- R2. WHEN a Stop event finds pending runs without a DoD receipt, the Stop guard shall remind the acting session once per card run and state, adding nothing while the event carries `stop_hook_active: true` and no DoD reminder while it lists running background tasks (card T1-EFF-HOOK-QUIET).
- R3. The routing guard shall print no routing line for a prompt that is a task notification, a cross-session message, a compaction summary or a skill body (card T1-EFF-HOOK-QUIET).
- R4. WHEN a command reviewer blocks on R3 decision 2 or later, the card runner shall stop the card for a ruling only if the block re-raises an unresolved finding that the author disputed or an earlier R3 decision raised, or the decision is the fourth, and otherwise return the card to REVIEW_FIX so that its repaired candidate gets the next decision (card T1-EFF-R3-PROGRESS).
- R5. The ship-path reviewer, the base-sync decision and a review needed after two decisions whose last passed shall keep the two-decision rule (card T1-EFF-R3-PROGRESS).
- R6. WHEN an angle of a primary R2 round ends without a verdict (malformed, empty, tool error or timeout) and no angle reported a quota hold, the panel shall rerun that angle once, alone, on the configured fallback, keeping the angles that returned a verdict, deciding the round over the merged angles and recording which reviewer produced each angle (card T1-EFF-R2-ANGLE-FALLBACK).
- R7. The agent files shall each name a model and an effort, and the arc rules start an implementer subagent at the `run-card` directive's effort (card T1-EFF-AGENTS-DOD).
- R8. The CLAUDE.md verification section, the planner and implementer agents and the card templates shall make a card's DoD the typecheck and the card's own tests, with the full suite and the build in CI (card T1-EFF-AGENTS-DOD).

## Design
R1 is configuration: `aidlc.config.json` `preReview.rounds` 1, no
`coverage` key (default `off`), the fallback's model and reviewer name
`claude-sonnet-5-5`; `src/core/roles.ts` investigator default. R2 adds a
per-session record under the state directory (`stop-reminders/`, a zod
`StopReminderRecord`) holding the runs already reminded in their current
state; `stop_hook_active` returns before any I/O; a non-empty
`background_tasks` skips only the DoD reminder; a write failure only
repeats a reminder. R3 matches text markers, because the UserPromptSubmit
input has no source field. R4 adds `MAX_R3_DECISIONS = 4` and a
`repeatedFindings` check over the snapshot the reviewer received, read
before the findings are recorded; `MAX_SUBSTANTIVE_REVIEW_DECISIONS` keeps
its name and value for the ship path and the base-sync trigger. R6 extends
`runReviewPanel` with a `fallback` option the card runner passes for a
primary round whose diff fits the fallback's cap; rerun files use the stem
`<stem>.<angle>+fallback`; the round records `fallbackTimeoutMs` so its
expiry covers the rerun. R7 and R8 are front matter and prose.

## Interfaces and contracts
- `aidlc.config.json` values of this repository (R1).
- New persisted record: one JSON file per session under
  `stop-reminders/` in the state directory (`StopReminderRecord`); `HookEvent` gains `stop_hook_active` and
  `background_tasks` (R2).
- `MAX_R3_DECISIONS` and `repeatedFindings` exported from `src/core/`;
  STOP/review keeps its reason, next action and ruling flow (R4).
- `PerspectiveRecord.fallback`, `PreReviewRound.fallbackTimeoutMs` and
  `PRE_REVIEW_DECIDED.fallbackAngles` (R6).
- Agent front matter `model` and `effort` (R7).

## Data model and migration impact
The new fields and the reminder record are optional or new files; records
written before parse unchanged. No migration step.

## Flagged concerns (route to policy owners)
- R4 relaxes the two-decision R3 stop. The engineer approved it on
  2026-10-19; the maker/checker deadlock rule of CLAUDE.md still holds,
  since a re-raised disputed finding stops.
- R6 changes how an R2 verdict can be produced (a fallback angle in a
  primary round), the case `src/core/roles.ts` says needs a policy
  decision; the engineer approved it on 2026-10-19.

## Non-goals
- Hook latency, PreToolUse `if` narrowing and a cwd-independent live hook
  command.
- The production gate's false positives.
- Structured lessons with a cue, and content-addressed review reuse.
- Removing a required CI check (a branch protection change).
- A model field in the `run-card` directive.

## Acceptance
- 1. The live R2 configuration and the role defaults name the values of R1. [R1]
- 2. A second Stop of the same session and card state adds no reminder; `stop_hook_active` and running background tasks add none. [R2]
- 3. Task notifications, cross-session messages, compaction summaries and skill bodies get no routing line; a typed request still routes. [R3]
- 4. A second R3 block of new findings returns to REVIEW_FIX; a re-raised unresolved finding or the fourth decision stops for review; the ship path keeps its rule. [R4] [R5]
- 5. A failed R2 angle reruns alone on the fallback and the round decides on the merged verdicts; a second failure is a no-verdict; a quota hold is unchanged. [R6]
- 6. Every agent file names a model and an effort; the arc rule and the DoD texts say what R7 and R8 require. [R7] [R8]
