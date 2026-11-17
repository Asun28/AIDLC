---
id: T1-XHIGH-PROSE-GUARD
title: The prompt guard of prose.test.ts refuses prose that steers thinking depth or suppresses updates, and it reads CLAUDE.md and templates/CLAUDE.aidlc.md beside the agent, skill and review files
status: todo
branch: T1-XHIGH-PROSE-GUARD
worktree: D:\wt\AIDLC\T1-XHIGH-PROSE-GUARD
plan_ref: plans/coordinator-xhigh.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - tests/surface/prose.test.ts
  - CHANGELOG.md
  - changelog.d/T1-XHIGH-PROSE-GUARD.md
  - specs/tasks/T1-XHIGH-PROSE-GUARD.md
dod_command: npm run typecheck && node --test tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. The function `removedInstructions` of `tests/surface/prose.test.ts` shall flag prose that steers thinking depth, under the names `think harder, less or more`, `do not overthink` and `do not think`.
  - R2. The function `removedInstructions` shall flag prose that suppresses updates, under the names `hold the findings`, `do not narrate` and `no interim updates`.
  - R3. The list `PROMPT_FILES` shall hold `CLAUDE.md` and `templates/CLAUDE.aidlc.md` beside the files it holds on main.
acceptance:
  - 1. tests/surface/prose.test.ts, a new describe named `T1-XHIGH-PROSE-GUARD`, the test whose title starts with `acceptance 1` - `removedInstructions` returns exactly `[name]` for each phrasing of the first table of Acceptance detail. It fails on main, where none of the six names exists. [R1] [R2] [dod arm 2]
  - 2. Same describe, the test whose title starts with `acceptance 2` - `removedInstructions` returns `[]` for each phrasing of the second table of Acceptance detail. [R1] [R2] [dod arm 2]
  - 3. Same describe, the test whose title starts with `acceptance 3` - `PROMPT_FILES` includes `path.join(root, 'CLAUDE.md')` and `path.join(root, 'templates', 'CLAUDE.aidlc.md')`. It fails on main. [R3] [dod arm 2]
  - 4. The existing test whose title starts with `acceptance 5: no agent, skill, REVIEW.md or review prompt` (:264) passes with no line changed, now reading the two new files with the six new entries and finding no offender. Every other existing test of the file passes with no line changed. [R1] [R2] [R3] [dod arm 2]
  - 5. The changelog entry of Acceptance detail is in `CHANGELOG.md` Unreleased, or, when `CLAUDE.md` on main at PREPARE says a card's entry is its own file, in `changelog.d/T1-XHIGH-PROSE-GUARD.md` followed by one line feed (reviewer-verified against the diff). [R1] [R2] [R3]
  - 6. `npm run typecheck` exits 0. [R1] [dod arm 1]
depends_on: []
budget: 80
tdd: true
sweep: "Main at 332956a2. `REMOVED_INSTRUCTIONS` is `tests/surface/prose.test.ts:99-108` (seven entries: double-check, re-verify, think carefully, think step by step, use a subagent to verify, be conservative, only report high-severity), `removedInstructions` is :111, `PROMPT_FILES` is :116 (the agent and skill files of `.claude` and `templates/claude`, both `REVIEW.md` copies), and the test that scans them with the review prompts is :264-278. A grep of 2026-11-17 for the phrase families of R1 and R2, case-insensitive, over `.claude`, `templates`, `CLAUDE.md`, `REVIEW.md`, `src/review` and `src/hooks` found nothing, and the seven existing entries find nothing in `CLAUDE.md` or `templates/CLAUDE.aidlc.md`. The existing cases use one sentence per phrasing and `assert.deepEqual(removedInstructions(text), [name], text)` (:163, :220)."
forbid:
  - a change to any file outside allow_paths, a prompt file included
  - removing, narrowing or renaming an existing entry of `REMOVED_INSTRUCTIONS`, or changing an existing case or test
  - scanning `src/hooks` or any other TypeScript source with the guard
  - weakening, skipping or deleting a test to go green
non_goals:
  - the router skill's helper rule and the docs paragraph (T1-XHIGH-COORDINATOR-EFFORT)
  - pressure language in capitals; the files are clean of it and it needs a different check
  - the owner's user-level instruction file, outside the repository
hygiene: "Line numbers are from main at 332956a2; read them again at PREPARE. Each new entry matches case-insensitively and across any whitespace, a line break included, as the existing entries do. `think harder, less or more` must not match `thinks more` or `rethink`; `do not think` must not match `do not overthink`, which has its own name. If T1-CHANGELOG-FRAGMENTS or T1-CI-SHARD has changed `PROMPT_FILES` or this file before PREPARE, keep their change and add to it."
---

# T1-XHIGH-PROSE-GUARD

## Deliverable
The prompt guard of `tests/surface/prose.test.ts` refuses two more families of prompt text and reads two more files. Thinking-depth prose ("think harder", "think less", "do not overthink", "do not think") and update suppressors ("hold all findings for the final response", "do not narrate", "no interim updates") become entries of `REMOVED_INSTRUCTIONS`, and `PROMPT_FILES` gains `CLAUDE.md` and `templates/CLAUDE.aidlc.md`, which every session loads.

## Why
Plan `plans/coordinator-xhigh.md`. The owner runs the coordinator on Claude Opus 5.5 at `xhigh`. On Opus 5.5 thinking cannot be turned off, and the guide says "To get less thinking, lower the effort level first" (Prompting Claude Opus 5.5, Calibrate effort); a prose line that steers thinking is the instruction the effort level replaces. The prompt audit of the Claude API skill names Opus 5.5 among the models that under-narrate when an update suppressor is present (group 1d, read 2026-11-17). No prompt file carries either family today; the guard keeps it so.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every acceptance test above passes.

## Acceptance detail
Phrasings that `removedInstructions` flags, one case each (acceptance 1):

| Text | Name |
|---|---|
| `Think harder about the edge cases.` | `think harder, less or more` |
| `Think less and act.` | `think harder, less or more` |
| `Think more before you answer.` | `think harder, less or more` |
| `think\n  harder about it` | `think harder, less or more` |
| `Don't overthink it.` | `do not overthink` |
| `Do not over-think the plan.` | `do not overthink` |
| `Never overthink a T0 card.` | `do not overthink` |
| `Do not think before a simple command.` | `do not think` |
| `Don't think, run the command.` | `do not think` |
| `Hold all findings for the final response.` | `hold the findings` |
| `Hold your results until the end.` | `hold the findings` |
| `Do not narrate your tool calls.` | `do not narrate` |
| `Don't narrate.` | `do not narrate` |
| `Send no interim updates.` | `no interim updates` |
| `No interim messages.` | `no interim updates` |

Look-alike phrasings that stay clean (acceptance 2):

| Text |
|---|
| `Think about what the failing test shows.` |
| `The model thinks more per turn at xhigh.` |
| `Rethink the plan when the base moved.` |
| `Hold the lock until the write ends.` |
| `The narrative of the incident is in the journal.` |
| `An interim result is kept on the attempt.` |
| `Report each finding as it arrives.` |

Changelog entry (acceptance 5), one line:

"- T1-XHIGH-PROSE-GUARD: the prompt guard of `tests/surface/prose.test.ts` also refuses prose that steers thinking depth (think harder, less or more; do not overthink; do not think) and prose that suppresses updates (hold the findings; do not narrate; no interim updates), and it reads `CLAUDE.md` and `templates/CLAUDE.aidlc.md` beside the agent, skill and review files. On Claude Opus 5.5 the effort level sets how much the model thinks, and a line that suppresses updates makes it report less while it works."

## Attempt evidence
Build attempt 1. RED receipt `59f6ecb1:1` (acceptance 1 and 3 failed: names missing, `CLAUDE.md is scanned` false).

| Item | Proof | Result |
|---|---|---|
| 1 | `T1-XHIGH-PROSE-GUARD` > `acceptance 1` in `tests/surface/prose.test.ts` | pass (failed at RED) |
| 2 | `T1-XHIGH-PROSE-GUARD` > `acceptance 2` | pass |
| 3 | `T1-XHIGH-PROSE-GUARD` > `acceptance 3` | pass (failed at RED) |
| 4 | existing `acceptance 5: no agent, skill, REVIEW.md or review prompt ...` and every other test of the file, no line changed | pass, 21 of 21 |
| 5 | `CHANGELOG.md` Unreleased, first entry, the card's text | present |
| 6 | `npm run typecheck` | exit 0 |
