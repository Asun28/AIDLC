---
id: T0-LOOP-SPEED
title: Cut aidlc loop latency: one-process hook dispatch, single repo/session resolution per CLI call, parallel doctor probes, single-pass typecheck
status: merged
branch: T0-LOOP-SPEED
worktree: D:\wt\AIDLC\T0-LOOP-SPEED
allow_paths:
  - bin/aidlc-hook.js
  - src/hooks/index.ts
  - src/hooks/entry.ts
  - src/state/paths.ts
  - src/cli/main.ts
  - src/scaffold/init.ts
  - templates/claude/settings.json
  - .claude/settings.json
  - package.json
  - tests/surface/hooks.test.ts
  - tests/surface/templates.test.ts
  - tests/infra/init.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - progress.md
  - specs/tasks/T0-LOOP-SPEED.md
dod_command: npm run typecheck && node --test tests/surface/hooks.test.ts tests/surface/templates.test.ts tests/infra/init.test.ts tests/infra/paths.test.ts tests/infra/journal.test.ts
dod_exit: 0
acceptance:
  - 1. `dispatchHook(event)` in `src/hooks/entry.ts` runs every guard that applies to the event's `hook_event_name` + `tool_name` in one process and returns the first deny/exit-2, else the merged advisory output (hooks.test.ts "dispatchHook ..."). [dod arm 1]
  - 2. `bin/aidlc-hook.js` and `aidlc hook auto` both invoke the dispatcher; `.claude/settings.json` and `templates/claude/settings.json` wire one command per event (PreToolUse, Stop, UserPromptSubmit) instead of three `npx` processes per tool call (templates.test.ts, init.test.ts). [dod arm 1]
  - 3. `resolveRepoIdentity` issues one `git rev-parse` per process per cwd (memoised, both refs in one call); existing paths/journal tests stay green (paths.test.ts, journal.test.ts). [dod arm 1]
  - 4. `npm run typecheck` is a single `tsc` pass over src + tests; `aidlc doctor` runs its toolchain probes concurrently. [dod arm 1]
budget: 400
sweep: "grep -rn npx--no-install-aidlc and resolveRepoIdentity/resolveStatePaths call sites: src/hooks/index.ts, src/cli/main.ts (ctx, doctor), src/state/journal.ts (resolveSessionId), src/scaffold/init.ts (mergeSettings), templates/claude/settings.json, .claude/settings.json, docs/OPERATIONS.md:135; wiring tests templates.test.ts:66 and init.test.ts:36"
tdd: true
non_goals: [new self-test surface beyond the dispatcher contract, changing the one-directive-per-call contract, changing skill files]
doc_sync: docs/OPERATIONS.md hooks section, docs/ARCHITECTURE.md hooks sentence, CHANGELOG.md
---

# T0-LOOP-SPEED

## Deliverable
The agent loop spends less wall time per tool call and per CLI call. Measured before: each Bash/Edit tool call ran three `npx --no-install aidlc hook <name>` processes (~1.4 s each, ~4.5 s per tool call); every CLI call spawned `git rev-parse` six times (~0.6 s); `aidlc doctor` took ~1.2 s; `npm run typecheck` ran two tsc passes (~6.7 s). After: one hook process per tool call (~0.15 s), one git spawn per CLI call, doctor probes in parallel, one tsc pass.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hooks.test.ts tests/surface/templates.test.ts tests/infra/init.test.ts tests/infra/paths.test.ts tests/infra/journal.test.ts
```
- Expected exit code: 0
- Assertion: dispatcher test passes; template/init tests assert the single-command wiring; paths/journal tests unchanged and green.
