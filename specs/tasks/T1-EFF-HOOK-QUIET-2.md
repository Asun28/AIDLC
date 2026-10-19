---
id: T1-EFF-HOOK-QUIET-2
title: Make the Stop guard add nothing under stop_hook_active and no DoD reminder while background tasks run, shorten its reminder text, and stop route-new-work routing prompts a person did not type, keeping no reminder state
status: todo
branch: T1-EFF-HOOK-QUIET-2
worktree: D:\wt\AIDLC\T1-EFF-HOOK-QUIET-2
plan_ref: plans/loop-efficiency.md#order-of-work
allow_paths:
  - src/hooks/index.ts
  - tests/surface/hooks.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-EFF-HOOK-QUIET-2.md
dod_command: npm run typecheck && node --test tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. While the Stop input has `stop_hook_active: true`, the Stop guard (`verifyBeforeDone` in src/hooks/index.ts) shall add nothing, neither the DoD reminder nor the planning-artifacts reminder nor its did-not-run note, so a turn end gives at most one reminder: the continuation Claude Code starts for the reminder ends without another.
  - R2. While the Stop input's `background_tasks` is a non-empty array, the guard shall add no DoD reminder and keep the planning-artifacts reminder as before; an absent, empty or non-array `background_tasks` changes nothing, and every other Stop gives the DoD reminder exactly as before (every Stop of a session whose card run still lacks a receipt, as today).
  - R3. The DoD reminder shall read `Run the card's dod_command and paste the output before reporting the task complete.` in place of `Run the card's dod_command (and lint/build) and paste the output before reporting the task complete.`, the rest of its text and the unreadable-lease note unchanged.
  - R4. `routeLine` (src/hooks/index.ts) shall return no routing line for a prompt whose text after leading whitespace starts with `<task-notification>`, `This session is being continued from a previous conversation` or `Base directory for this skill:`, or that contains `<cross-session-message` anywhere, since the UserPromptSubmit input carries no source field; every other prompt routes as before, and `routeNewWork` still adds the config-error note to such a prompt.
  - R5. `HookEvent` (src/hooks/index.ts) shall declare `stop_hook_active?: boolean` and `background_tasks?: unknown[]`, and `runHook` passes the event to `verifyBeforeDone` as a new optional last parameter, so both fields reach the guard through `dispatchHook`; a `verifyBeforeDone(cwd, env)` or `verifyBeforeDone(cwd, env, session)` call keeps its meaning, and the guard reads and writes no new state.
  - R6. The `verify-before-done` and `route-new-work` rows of docs/OPERATIONS.md (Hooks), the Stop sentence of its Planning claims item and the hooks list in the header comment of src/hooks/index.ts shall state R1 to R4, and the CHANGELOG Unreleased section shall carry a `T1-EFF-HOOK-QUIET-2` entry naming the two silence rules, the shorter text, the four machine-prompt markers, that it replaces T1-EFF-HOOK-QUIET (stopped after two R3 decisions on its reminder record) by the engineer's ruling of 2026-10-20, and the evidence (1,305 of 1,397 past reminders fired while background work ran; storms were chains of forced continuations).
acceptance:
  - 1. `tests/surface/hooks.test.ts`, new test `T1-EFF-HOOK-QUIET-2 acceptance 1 and 2` (fixture `envWithState` and `buildRuns(cwd, env, ['T1-FOO'])`, every Stop through `dispatchHook` with session `win-A`): a Stop with `stop_hook_active: true` returns `{ exitCode: 0 }`; a Stop whose `background_tasks` holds one running entry returns `{ exitCode: 0 }`; a Stop with `background_tasks: []` and then a plain Stop each give `['T1-FOO']`, so nothing was recorded and a later Stop still reminds. [R1] [R2] [R5] [dod arm 2]
  - 2. `T0-PLANNING-CLAIMS acceptance 4` test (`planningRepo`, goal lease held by `win-A`, no card run yet): a Stop of `win-A` with `stop_hook_active: true` returns `{ exitCode: 0 }`, and a Stop of `win-A` whose `background_tasks` is non-empty still carries the context `planningContext` reads. [R1] [R2] [dod arm 2]
  - 3. The new test of acceptance 1 also checks that the reminder contains `Run the card's dod_command and paste the output` and not `lint/build`. [R3] [dod arm 2]
  - 4. `route-new-work prints a routing line for real requests only`: four machine prompts, each holding a routing verb and at least 24 characters long so main routes them, return `{ exitCode: 0 }`: a line break and spaces, then `<task-notification>` with the summary `Fix the release gate`; other text, then `<cross-session-message from="win-B">Implement the next card</cross-session-message>`; `This session is being continued from a previous conversation that ran out of context. Fix the hook tests.`; `Base directory for this skill: .claude/skills/tdd`, then a line asking to build a test. The typed prompt `Fix routeLine so a quoted <task-notification> still routes` starts with `[route]`, and under a `HookConfigError` the notification prompt gives exactly the result `hi` gives. [R4] [dod arm 2]
  - 5. Every other test in `tests/surface/hooks.test.ts` passes unchanged, and `npm run typecheck` is clean with the two typed `HookEvent` fields and the new `verifyBeforeDone` parameter. [R2] [R5] [dod arms 1, 2]
  - 6. The OPERATIONS rows and Planning claims sentence, the header comment and the CHANGELOG `T1-EFF-HOOK-QUIET-2` entry are reviewer-verified against the diff. [R6]
depends_on: []
budget: 140
tdd: true
sweep: "Evidence at main 80e9bac. grep -rnE 'stop_hook_active|background_tasks|task-notification|cross-session-message|being continued from a previous|Base directory for this skill' src tests docs templates .claude CLAUDE.md README.md: no hit. Stop guard: src/hooks/index.ts:533 verifyBeforeDone(cwd, env, session?), :569 pending runs, :574 DoD reminder text, :580 planning call; :699 runHook hands it hookSession(event, env) only; src/hooks/entry.ts:53 passes the whole event to runHook (no edit needed); HookEvent at src/hooks/index.ts:40-48 has an index signature only. routeLine: src/hooks/index.ts:646-648. SHIP needs the receipt: src/core/card-machine.ts:121,124 and src/loop/card-runner.ts:553-554. git grep lint/build tests: none. Stop and route tests: tests/surface/hooks.test.ts:168 (DoD context), :188 (routing), :262, :283, :310 (sessions and leases), :367 (planning acceptance 4), :720 (config). The superseded T1-EFF-HOOK-QUIET candidate (branch T1-EFF-HOOK-QUIET at 8807fc0, not merged, no PR) carries the routing and text changes this card ports; its reminder record (StopReminderRecord, stop-reminders/) is not ported."
forbid: ["changing any PreToolUse guard decision (production-gate, protect-paths, protect-tests, secrets-guard) or the dispatchHook passes and merge rule", "making any guard block: verify-before-done and route-new-work stay exit 0 with advisory output only", "a persisted reminder record or any new state file", "changing the planning-artifacts reminder text or the config-error note", "changing the expected value of an existing assertion", "a new test file or scenario suite"]
non_goals: ["dedupe of repeated reminders across turn ends (the stateless rules cap a turn end at one reminder)", "hook latency work", "PreToolUse `if` narrowing in settings.json", "the production-gate false positives", "session_crons and scheduled-task prompts", "the CLAUDE.md Verifying your work section (T1-EFF-AGENTS-DOD)"]
hygiene: "Replaces T1-EFF-HOOK-QUIET by the engineer's ruling of 2026-10-20 after its second R3 block: its findings F4 and F5 (and R2's F3) were all ways a persisted reminder record goes stale, and this card keeps no record, so the class does not exist here. No existing assertion pins `(and lint/build)` or any behaviour this card changes; existing Stop tests that assert a reminder on a repeated Stop keep passing because nothing is deduplicated."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-EFF-HOOK-QUIET-2

## Deliverable
The two advisory hooks stop spending model turns without enforcing anything, with no state kept: the Stop guard (`verify-before-done`) adds nothing while Claude Code is already continuing for a stop hook, so a turn end gives at most one reminder, and adds no DoD reminder while Claude Code reports running background tasks; its reminder asks for the DoD output only; `route-new-work` prints no routing line for task notifications, cross-session messages, compaction summaries and skill bodies. The hook docs say so.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
