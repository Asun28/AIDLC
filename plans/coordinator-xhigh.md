---
slug: coordinator-xhigh
title: A coordinator session on Claude Opus 5.5 at xhigh starts its helper subagents at medium, the docs say what xhigh does to a coordinator turn, and a test refuses prose that steers thinking depth
spec: specs/coordinator-xhigh.md
size: T1
status: draft
created: 2026-11-17T00:05:00Z
---

# Plan: A coordinator session on Claude Opus 5.5 at xhigh starts its helper subagents at medium, the docs say what xhigh does to a coordinator turn, and a test refuses prose that steers thinking depth (from specs/coordinator-xhigh.md)

## 1. Goal and boundaries
The prompt guard refuses prose that steers thinking depth or suppresses updates and reads both
copies of the CLAUDE instructions; the router skill starts helper subagents at `medium` as
named agent types; `docs/OPERATIONS.md` describes the coordinator's effort. Cut: any agent
file, `src/`, configuration, the effort ladder, a recommended coordinator level, unattended
continuation text, recording the coordinator's effort. Success criteria: both cards merged,
and on main the guard test passes over every prompt file with the new phrases, the router
skill is at most 4500 bytes with the helper rule, and the paragraph is in place.

## 2. Minimal acceptable loop
T1-XHIGH-PROSE-GUARD alone gives the guard.

## 3. Tech stack
none this version

## 4. Directory structure
- `tests/surface/coordinator-effort.test.ts` (new)

## 4.5 Module design
- `tests/surface/prose.test.ts`: six entries in `REMOVED_INSTRUCTIONS`, two files in `PROMPT_FILES`, the cases of the new phrases in the existing describe.
- Both `aidlc-loop/SKILL.md` copies: the Effort section only.
- `docs/OPERATIONS.md`: one paragraph after the Claude Code effort paragraph.
- `tests/surface/coordinator-effort.test.ts`: pins the Effort section, the moved rule's place in `card-loop.md` and the paragraph.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
`removedInstructions(text)` keeps its signature. The router skill's Effort section text is
fixed by T1-XHIGH-COORDINATOR-EFFORT; the guard of T1-XHIGH-PROSE-GUARD reads it.

## Files that change
- tests/surface/prose.test.ts
- templates/claude/skills/aidlc-loop/SKILL.md
- .claude/skills/aidlc-loop/SKILL.md
- docs/OPERATIONS.md
- tests/surface/coordinator-effort.test.ts (new)
- CHANGELOG.md
- changelog.d/T1-XHIGH-PROSE-GUARD.md (new), in place of the CHANGELOG.md entry once T1-CHANGELOG-FRAGMENTS has merged
- changelog.d/T1-XHIGH-COORDINATOR-EFFORT.md (new), likewise

## Order of work
1. T1-XHIGH-PROSE-GUARD.
2. T1-XHIGH-COORDINATOR-EFFORT, after it has merged, so the guard reads the new skill text.

## 7. Task split (dependencies and parallel windows)
| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-XHIGH-PROSE-GUARD | MUST | the guard refuses prose that steers thinking depth or suppresses updates and reads `CLAUDE.md` and `templates/CLAUDE.aidlc.md` | - | - | - |
| T1-XHIGH-COORDINATOR-EFFORT | MUST | the router skill starts helper subagents at `medium` as named agent types; `docs/OPERATIONS.md` describes the coordinator's effort | T1-XHIGH-PROSE-GUARD | - | - |

Budgets: 80 and 80 changed lines, 160 in total. The cards run one after the other.

## Risks
- The router skill has 21 bytes left after the change (4479 of 4500). A later card that adds
  to it has to pay for its bytes, as this one does.
- The removed sentence of the Effort section is stated in `card-loop.md` BUILD, which every
  card route loads, but not in a file a goal-level step of a T1 or T2 route loads before a
  card runs. The limits it states are enforced by `aidlc card attempt` and the effort ladder
  in `src/core/effort.ts`, not by the text.
- The guard matches phrases, not intent: a file that describes the effect of effort in the
  imperative ("think less" quoted from a guide) is refused. The fix is to quote it as a
  description; the guard is not narrowed.
- Shared files with cards of goal loop-throughput, not yet registered: T1-CHANGELOG-FRAGMENTS
  and T1-CI-SHARD edit `tests/surface/prose.test.ts`, T1-IMPLEMENTER-MODEL and T1-CI-SHARD
  edit `docs/OPERATIONS.md`, T1-CHANGELOG-FRAGMENTS changes where a changelog entry goes. The
  cards of this goal do not run beside them; each card writes its entry where `CLAUDE.md`
  says on main at its PREPARE and reads its line numbers again there.
- The owner's coordinator runs at `xhigh`, so this goal's own coordinator turns are longer and
  cost more than at `medium`; nothing in the goal depends on that level.
- Not verified before the cards run: that Claude Code honours the Agent tool's `effort` for a
  named agent type without an `effort` in its definition (the tool's own description says so),
  and which effort a built-in search agent runs at when none is passed.

## Proof
- Card DoDs, R3 and CI on each card.
- Arc: on main, `node --test tests/surface/prose.test.ts tests/surface/coordinator-effort.test.ts tests/surface/templates.test.ts` passes.
- Arc: `git grep -n "named agent types\|start helpers" -- .claude/skills/aidlc-loop/SKILL.md templates/claude/skills/aidlc-loop/SKILL.md` prints the helper rule in both copies.

## 10. After merge
none this version (development-only target)
