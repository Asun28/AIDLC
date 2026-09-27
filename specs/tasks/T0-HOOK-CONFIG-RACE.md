---
id: T0-HOOK-CONFIG-RACE
title: A hook config that becomes unreachable between the access probe and the read is a read failure, not the defaults, and the real-filesystem cases assert their denials (issue 125, residual of issue 76 item 1)
status: todo
branch: T0-HOOK-CONFIG-RACE
worktree: D:\wt\AIDLC\T0-HOOK-CONFIG-RACE
allow_paths:
  - src/hooks/index.ts
  - tests/surface/hooks.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-HOOK-CONFIG-RACE.md
dod_command: npm run typecheck && node --test tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. WHEN the access probe of `loadHookConfig` finds the config present and `loadProjectConfig` then reports it absent (`found` false), because the file was unlinked or made unreachable between the two lookups, `loadHookConfig` shall return a config error with the detail `cannot be read, changed during the read`, so the guards deny as for any read failure; it shall never return the defaults after a probe that found the file.
  - R2. The tests shall assert, on the real filesystem where the platform can make each case, the exact Bash and Edit denials for a link to nothing, a directory without search permission and a loop of links (ELOOP), besides the loader result.
  - R3. `docs/OPERATIONS.md` (Hooks) and the CHANGELOG Unreleased section shall state R1.
acceptance:
  - 1. `tests/surface/hooks.test.ts` with an injected probe that finds the file and then unlinks it, and one that finds it and then makes its directory unreachable, before `loadProjectConfig` reads; each gives the config error of R1 and the exact Bash and Edit denials, and a probe that finds the file and leaves it in place gives the config it holds. [R1] [dod arm 1]
  - 2. The same file, on the real filesystem where the platform allows each case, a link to nothing, a directory without search permission and a loop of links each give the loader result and the exact Bash denial of `production-gate` and Edit denial of `protect-paths`; a case the platform cannot make is skipped by name, not passed. [R2] [dod arm 1]
  - 3. The same file reads the sentence this card adds to the Hooks section of `docs/OPERATIONS.md` and its CHANGELOG Unreleased entry. [R3] [dod arm 1]
depends_on: [T0-HOOK-CONFIG-CLOSED-2]
budget: 160
tdd: true
diagnosis:
  root_cause: "T0-HOOK-CONFIG-CLOSED-2 made loadHookConfig look the config up itself (configAccess, stat then lstat) so a failed lookup is a read failure, then called loadProjectConfig, which checks the file again with existsSync and returns the defaults with found false when that answers false. A file unlinked or made unreachable between the two lookups therefore reads as absent and gives the defaults (R3 decision 2 of T0-HOOK-CONFIG-CLOSED-2, F1); main took the defaults on every such config before that card."
  same_class: "Every place loadHookConfig decides between the defaults and an error: configAccess (absent only when neither stat nor lstat finds the path) and the loadProjectConfig result (found false after a probe that found the file, this card). No other hook reads aidlc.config.json; verify-before-done reads the planning directories through loadProjectConfig and reports a failure by code. The real-filesystem denials are F2 of the same decision, test completeness for logic the stubbed cases pin with exact denials."
sweep: "grep -rn 'loadProjectConfig\\|configAccess\\|found' src/hooks/index.ts lists every decision between the defaults and an error."
forbid: [changing config.ts, changing a guard's decision under a config that parses, changing the doctor commands or the denial texts of T0-HOOK-CONFIG-CLOSED-2]
non_goals: ["the PowerShell tool outside the guards: issue 117", "config discovery above cwd: issue 118", "the valid path's command classifier: issue 120"]
hygiene: "Carries F1 and F2 of R3 decision 2 of T0-HOOK-CONFIG-CLOSED-2 (6dc2148), which merged under the ruling of aidlc-37 (delegation of 2026-09-27T09:20Z, pre-set ruling B). Starts after T0-HOOK-CONFIG-CLOSED-2 merges; the next card of the same session is issue 117."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-HOOK-CONFIG-RACE

## Deliverable
A config that the probe found is never read as absent afterwards: a change between the two lookups is a read failure, and the real-filesystem cases prove their denials.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
