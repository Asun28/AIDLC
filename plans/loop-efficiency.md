---
slug: loop-efficiency
title: Cut the measured cost of running the loop and fit it to Claude Opus 5.5 and Sonnet 5.5
spec: specs/loop-efficiency.md
size: T1
status: draft
created: 2026-10-19T09:40:00Z
---

# Plan: Cut the measured cost of running the loop and fit it to Claude Opus 5.5 and Sonnet 5.5 (from specs/loop-efficiency.md)

## 1. Goal and boundaries
Five cards, one PR each, that remove the costs the journal and the session
transcripts measured: R2 rounds and coverage, the Stop guard's repeated
reminder, machine prompts routed as work, the R3 stop at the second block,
a failed R2 angle discarding its round, and full-suite DoDs; plus the
Claude Sonnet 5.5 move and agent model/effort defaults. Cut: hook latency
and PreToolUse `if` narrowing, the production gate's false positives, a
cwd-independent live hook command, structured lessons with a cue,
content-addressed review reuse, CI job deduplication (needs a branch
protection change). Success: each card merged with its DoD green, CI green
and its review passed; the goal's integrated checks pass on the final SHA.

## 2. Minimal acceptable loop
Each card merges on its own PR. Every card edits `CHANGELOG.md`, so the
cards run one at a time. The config card goes first so that every later
card is reviewed under one R2 round per cycle, and the hooks card second so
that the coordinator's waits stop drawing repeated Stop reminders.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
- `aidlc.config.json`: R2 rounds 1, coverage off, Sonnet 5.5 fallback.
- `src/core/roles.ts`: Sonnet 5.5 investigator default.
- `src/hooks/`: the Stop guard reminds once per card state and stays quiet
  under `stop_hook_active` or running background tasks; the routing guard
  skips machine prompts.
- `src/core/review-policy.ts`, `src/core/types.ts`, `src/loop/card-runner.ts`:
  the R3 stop rule (repeated unresolved finding, or the fourth decision).
- `src/review/pre-review.ts`, `src/loop/card-runner.ts`: a failed R2 angle
  is rerun alone on the fallback.
- `.claude/agents/`, `.claude/skills/aidlc-loop/arc.md` and their
  templates, the card templates, CLAUDE.md and `templates/CLAUDE.aidlc.md`:
  agent model/effort, the implementer effort rule, the targeted DoD.

## 5. Data model and state machine
No schema change to persisted records unless a card states one. The card
machine keeps its precedence; only the review-allowance predicate that
selects STOP/review changes.

## 6. Contracts and core interfaces
`aidlc.config.json` values for this repository; `MAX_SUBSTANTIVE_REVIEW_DECISIONS`
semantics and a fourth-decision cap; the R2 round record names the
reviewer of each angle; agent front matter `model`/`effort`.

## Files that change
- aidlc.config.json
- src/core/roles.ts
- src/hooks/index.ts
- src/hooks/entry.ts
- src/core/review-policy.ts
- src/core/types.ts
- src/loop/card-runner.ts
- src/review/pre-review.ts
- src/review/stats.ts
- .claude/agents/implementer.md
- .claude/agents/investigator.md
- .claude/agents/planner.md
- .claude/agents/release-specialist.md
- .claude/agents/reviewer.md
- .claude/agents/verifier.md
- templates/claude/agents/implementer.md
- templates/claude/agents/investigator.md
- templates/claude/agents/planner.md
- templates/claude/agents/release-specialist.md
- templates/claude/agents/reviewer.md
- templates/claude/agents/verifier.md
- .claude/skills/aidlc-loop/arc.md
- templates/claude/skills/aidlc-loop/arc.md
- .claude/skills/aidlc-loop/card-loop.md
- templates/claude/skills/aidlc-loop/card-loop.md
- templates/cards/_TEMPLATE.md
- specs/tasks/_TEMPLATE.md
- CLAUDE.md
- templates/CLAUDE.aidlc.md
- docs/OPERATIONS.md
- docs/ARCHITECTURE.md
- CHANGELOG.md
- tests/surface/config.test.ts
- tests/core/config.test.ts
- tests/core/roles.test.ts
- tests/surface/hooks.test.ts
- tests/core/review-policy.test.ts
- tests/scenarios/review-block.test.ts
- tests/surface/pre-review.test.ts
- tests/scenarios/r2-fallback.test.ts
- tests/surface/templates.test.ts

## Order of work
1. T1-EFF-REVIEW-CONFIG: one R2 round per R3 cycle, coverage off, Sonnet 5.5 for the R2 fallback and the investigator default.
2. T1-EFF-HOOK-QUIET: the Stop guard reminds once per card state and stays quiet while background work runs; the routing guard skips machine prompts.
3. T1-EFF-R3-PROGRESS: R3 stops for a ruling on a repeated unresolved finding or at its fourth decision; a block of only new findings gets another repair round.
4. T1-EFF-R2-ANGLE-FALLBACK: a failed R2 angle is rerun alone on the fallback; the angles with verdicts are kept.
5. T1-EFF-AGENTS-DOD: agent model and effort defaults, the implementer started at the directive's effort, targeted DoDs with the full suite in CI.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-EFF-REVIEW-CONFIG | MUST | R2 one round, coverage off, Sonnet 5.5 fallback and investigator | - | W1 | - |
| T1-EFF-HOOK-QUIET | MUST | Stop reminder once per card state; no routing of machine prompts | - | W2 | - |
| T1-EFF-R3-PROGRESS | MUST | R3 stops on a repeated unresolved finding or the fourth decision | - | W3 | - |
| T1-EFF-R2-ANGLE-FALLBACK | SHOULD | a failed R2 angle reruns alone on the fallback | T1-EFF-REVIEW-CONFIG | W4 | - |
| T1-EFF-AGENTS-DOD | SHOULD | agent model/effort, implementer effort rule, targeted DoD | - | W5 | - |

The cards share `CHANGELOG.md`, so they run one at a time in the order above.

## Risks
- Fewer R2 rounds let more defects reach R3; R3 then spends decisions on
  them. The R3 card raises the stop to a repeated finding or a fourth
  decision, and R3 sees the open R2 findings as today.
- Allowing a third and fourth R3 decision lengthens a card that keeps
  drawing new findings; the 3h card deadline still stops it, and a
  re-raised disputed finding still stops for a ruling.
- The Stop guard's dedupe record lives in the state directory and is
  written by a hook; a write failure must leave the guard advisory and
  silent, never blocking.
- A routing marker that a person types (a prompt pasted from a task
  notification) is not routed; the person can run `aidlc goal new`.
- An agent pinned to `opus` costs more than one inheriting a Sonnet
  session; the pins follow the existing role defaults in `src/core/roles.ts`.

## Proof
- tests/surface/config.test.ts and tests/core/config.test.ts: the live R2 config and the Sonnet 5.5 fallback.
- tests/core/roles.test.ts: the Sonnet 5.5 investigator default.
- tests/surface/hooks.test.ts: one reminder per card state, none under stop_hook_active or background tasks, no routing of machine prompts.
- tests/core/review-policy.test.ts: new findings continue, a repeated unresolved finding stops, the fourth decision stops.
- tests/surface/pre-review.test.ts: a failed angle reruns alone on the fallback; a second failure is a no-verdict.
- tests/surface/templates.test.ts: agent model/effort lines, the arc rule, the targeted DoD text.
