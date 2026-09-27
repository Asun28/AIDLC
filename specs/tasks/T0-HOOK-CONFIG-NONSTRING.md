---
id: T0-HOOK-CONFIG-NONSTRING
title: While aidlc.config.json cannot be used, a command value that is present but not a string is denied like any command outside the doctor list (issue 129, residual of issue 76 item 1)
status: todo
branch: T0-HOOK-CONFIG-NONSTRING
worktree: D:\wt\AIDLC\T0-HOOK-CONFIG-NONSTRING
allow_paths:
  - src/hooks/index.ts
  - tests/surface/hooks.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-HOOK-CONFIG-NONSTRING.md
dod_command: npm run typecheck && node --test tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the config is an error, `production-gate` and `protect-paths` shall deny an event whose `tool_input.command` is present and is not a string equal, once trimmed, to one of the sixteen doctor commands, whatever its type (null, a number, a boolean, an object, an array) and whatever file path it carries beside it, with the Bash denial text of T0-HOOK-CONFIG-CLOSED-3; an event without a `command` is decided as before. The decision of the guards before T0-HOOK-CONFIG-CLOSED on the same text still comes first, so a value whose string form is a gated release command keeps that denial and its text.
  - R2. WHEN the config parses, every guard shall decide as before, a command value that is not a string included.
  - R3. The CHANGELOG Unreleased section shall state R1.
acceptance:
  - 1. `tests/surface/hooks.test.ts`, under each broken config that freezes nothing, `null`, `42`, `true`, `{}`, `[]` and `["node mutate.js"]` as the command are each denied by `production-gate` and `protect-paths` alone (as `aidlc hook <name>` runs them) with the exact Bash denial, beside no file path, the config path and another file, and through dispatch as a Bash and as an Edit event; a doctor command still passes, and an event without a command is decided as before. [R1] [dod arm 1]
  - 2. The same file, under a broken config, `["make deploy ENV=production"]` as the command is denied with exit 2 and the release-authorization text of the guard before these cards; the oracle table of T0-HOOK-CONFIG-CLOSED-3 acceptance 2 gains calls whose command is not a string and still finds every cell main blocks blocked. [R1] [dod arm 1]
  - 3. The same file, under a valid config, the same non-string commands give the result they gave before this card (main's result through the unchanged guards). [R2] [dod arm 1]
  - 4. The same file reads the entry this card adds to the CHANGELOG Unreleased section. [R3] [dod arm 1]
depends_on: []
budget: 160
tdd: true
diagnosis:
  root_cause: "unusableConfig (src/hooks/index.ts) compared the command with the doctor list only when it was a string (typeof cmd === 'string'), so a present command of another type passed production-gate and protect-paths under a broken config, beside the config path too; the guards before T0-HOOK-CONFIG-CLOSED pass such values under every config (protectPaths reads only a string, productionGate reads String(command)), so it was a residual main also has, found by R3 decision 2 of T0-HOOK-CONFIG-CLOSED-3 (ec84023) and merged under ruling B."
  same_class: "Every value unusableConfig reads from an event: tool_input.command (this card) and tool_input.file_path. A file_path that is not a string never matches the config path, so protect-paths passes it only when no command is present and the legacy decision passes it; protectPaths, protectTests and secretsGuard read only a string file_path on main too, and an edit tool always sends a string. The valid path's handling of a value that is not a string belongs with the command classifier of issue 120."
sweep: "grep -n \"tool_input?.\\['command'\\]\\|tool_input?.\\['file_path'\\]\" src/hooks/index.ts lists every read of an event value."
forbid: [changing a guard's decision under a config that parses, changing a guard function (productionGate, protectPaths, protectTests, secretsGuard), changing the doctor list or the denial texts of T0-HOOK-CONFIG-CLOSED-3, changing config.ts]
non_goals: ["the PowerShell tool outside the guards: issue 117, held for the user", "config discovery above cwd: issue 118", "the valid path's command classifier: issue 120"]
hygiene: "Issue 129, the residual ruling B of aidlc-37 filed when T0-HOOK-CONFIG-CLOSED-3 merged (PR #130). Order of the coordinating session: this card, then issue 120, then issue 118, serial in src/hooks. A mutation sweep before the first review, the hand-run Codex check (no change under a valid config, no fail-open new relative to main) before R3 decision 1, --goal on every command."
doc_sync: CHANGELOG.md
---

# T0-HOOK-CONFIG-NONSTRING

## Deliverable
Under a config that cannot be used, a command is compared with the doctor list whatever its type, so no hand-written hook event passes on a value that is not a string.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
