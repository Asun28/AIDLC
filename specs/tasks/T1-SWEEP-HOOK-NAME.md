---
id: T1-SWEEP-HOOK-NAME
title: An unknown `aidlc hook <name>` fails closed with exit 2 and names the known guards
status: todo
branch: T1-SWEEP-HOOK-NAME
worktree: D:\wt\AIDLC\T1-SWEEP-HOOK-NAME
plan_ref: plans/dead-code-sweep.md#order-of-work
allow_paths:
  - src/hooks/index.ts
  - tests/surface/hook-name.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-SWEEP-HOOK-NAME.md
dod_command: npm run typecheck && node --test tests/surface/hook-name.test.ts tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. IF `runHook` (`src/hooks/index.ts`) receives a name that is not one of `production-gate`, `protect-paths`, `protect-tests`, `secrets-guard`, `verify-before-done` or `route-new-work`, THEN it shall return exit code 2 with the stderr line `aidlc hook: unknown hook name <name as JSON string>; known names: auto, production-gate, protect-paths, protect-tests, secrets-guard, verify-before-done, route-new-work`, before it loads the hook config and without running a guard.
  - R2. `aidlc hook <name>` shall exit 2 with the R1 line on stderr for an unknown name, while `aidlc hook auto` and every known name keep their current decisions.
  - R3. `docs/OPERATIONS.md` (the hooks paragraph) shall state R1 and R2, and the CHANGELOG Unreleased section shall carry an entry naming this card.
acceptance:
  - 1. `tests/surface/hook-name.test.ts`: `runHook('protect-test' as HookName, <PreToolUse Edit event>)` returns exit code 2 and exactly the R1 line with `"protect-test"`; a name holding a double quote and a line break gives a one-line stderr with the JSON-escaped name; with `cwd` at a temporary directory whose `aidlc.config.json` is not JSON, the result is the same unknown-name line (the config is never read). [R1] [dod arm 2]
  - 2. The same file spawns `node bin/aidlc.js hook protect-test` with a PreToolUse event on stdin: exit 2 and the R1 line on stderr; `node bin/aidlc.js hook secrets-guard` with a harmless Read event exits 0. [R2] [dod arm 2]
  - 3. The existing `tests/surface/hooks.test.ts` passes unchanged. [R2] [dod arm 3]
  - 4. The same new file reads the unknown-name sentence (`exit 2`, `unknown hook name`) in `docs/OPERATIONS.md` and a T1-SWEEP-HOOK-NAME entry in the CHANGELOG Unreleased section. [R3] [dod arm 2]
depends_on: []
budget: 140
tdd: true
diagnosis:
  root_cause: "`runHook` ends its switch with `default: return { exitCode: 0 }`, and the CLI passes any `aidlc hook <name>` argument through `name as HookName`, so a mistyped guard name in a settings.json hook command allows every action and prints nothing."
  same_class: "`dispatchHook` (`src/hooks/entry.ts`) only calls `runHook` with names from `hookNamesFor`, and an unknown event there returns no names, which is correct (an event with no guard); the CLI `hook` action is the only path that passes free text."
sweep: "grep -n 'runHook\\|HookName' src/cli/main.ts src/hooks/entry.ts src/hooks/index.ts: the CLI `hook <name>` action (main.ts) is the only caller with a free-text name."
forbid: [changing the decisions of a known guard, changing dispatchHook, exit 0 for an unknown name]
non_goals: ["validating hook commands in settings.json at init or doctor"]
hygiene: "User ruling 2026-10-12: fail closed with exit 2 (not a non-blocking exit 1)."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T1-SWEEP-HOOK-NAME

## Deliverable
`aidlc hook <name>` with a name that is not a guard exits 2 and lists the known names, so a mistyped hook command blocks and says how to fix it instead of silently allowing every action.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hook-name.test.ts tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
