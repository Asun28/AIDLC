---
id: T0-HOOK-CONFIG-CLOSED
title: A hook guard that reads aidlc.config.json denies the call when the file does not parse or a pattern does not compile, and never blocks the repair (issue 76 item 1)
status: todo
branch: T0-HOOK-CONFIG-CLOSED
worktree: D:\wt\AIDLC\T0-HOOK-CONFIG-CLOSED
allow_paths:
  - src/hooks/index.ts
  - src/hooks/entry.ts
  - tests/surface/hooks.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-HOOK-CONFIG-CLOSED.md
dod_command: npm run typecheck && node --test tests/surface/hooks.test.ts
dod_exit: 0
requirements:
  - R1. `loadHookConfig(cwd)` shall read `aidlc.config.json` through `loadProjectConfig` and return the hook settings, or a config error naming the file and a detail that never quotes the file text; a file that is not JSON is named as such, a schema failure keeps the schema paths and messages, a read failure is named by its error code, and an entry of `hooks.productionPatterns` or `hooks.testPathPatterns` that does not compile as a regular expression is named by its key and index. A missing file keeps the defaults, since `loadProjectConfig` reads a missing file as the defaults too.
  - R2. WHEN the config is an error, `protect-paths` and `protect-tests` (while a fix task is active) shall deny an Edit, Write or MultiEdit whose target is not the config file that failed, and `production-gate` and `protect-paths` shall deny a Bash command that has a mutating segment other than a change of directory or an `aidlc doctor` run, or a write verb once redirects to a stream or the null device are set aside; each denial names the config error and the repair.
  - R3. WHEN the config is an error, an Edit or Write of that config file, a read-only Bash command and an `aidlc doctor` run shall pass, `secrets-guard` shall run as before, the UserPromptSubmit output shall carry the config error, and the Stop output shall stay as it is.
  - R4. WHEN the config parses and its patterns compile, every guard shall decide as before.
  - R5. `docs/OPERATIONS.md` (Hooks) and the CHANGELOG Unreleased section shall state R1 to R3.
acceptance:
  - 1. `tests/surface/hooks.test.ts`: a config that is not JSON, one that fails the schema, and an invalid regular expression in each of `hooks.productionPatterns` and `hooks.testPathPatterns` each make a guarded call deny with the config error and the repair, and the denial never quotes the file text; a missing file gives the defaults. [R1] [R2] [dod arm 1]
  - 2. The same file: an Edit and a Write of `aidlc.config.json`, a read-only Bash command and `aidlc doctor` in each spelling pass under a broken config; a mutating Bash command and a doctor run that writes a file are denied; protect-tests denies only while a fix task is active; a secret in the config edit is still denied. [R2] [R3] [dod arm 1]
  - 3. The same file: the UserPromptSubmit output names the config error, with the routing line still printed for a request; the Stop output under a broken config equals the one under a valid config. [R3] [dod arm 1]
  - 4. The same file: a valid config gives the guard results it gave before this card. [R4] [dod arm 1]
  - 5. The same file reads the sentence this card adds to the Hooks section of `docs/OPERATIONS.md` and its CHANGELOG Unreleased entry. [R5] [dod arm 1]
depends_on: []
budget: 180
tdd: true
diagnosis:
  root_cause: "loadHookConfig (src/hooks/index.ts:85) parsed aidlc.config.json with JSON.parse and no schema, and returned DEFAULT_HOOK_CONFIG from its catch, so a file that does not parse left hooks.frozenPaths empty and protect-paths blocked nothing, while the CLI refuses the same file (aidlc doctor: config ERROR). An entry of hooks.productionPatterns or hooks.testPathPatterns that is not a regular expression throws inside production-gate or protect-tests, and the hook entry (entry.ts main) catches it and exits 0, so the call passed too."
  same_class: "Every hook value read from aidlc.config.json: hooks.frozenPaths (protect-paths), hooks.testPathPatterns (protect-tests) and hooks.productionPatterns (production-gate), all read through loadHookConfig only. An invalid hooks.frozenPaths entry is not an error: protect-paths matches it as a literal substring on purpose, so it never throws. verify-before-done reads the planning directories through loadProjectConfig and already reports a failure by code. Known limit, issue 118: a cwd below the checkout root finds no config and takes the defaults, a discovery change in the same loader. Items 2 and 3 of issue 76 are text-derived decisions in other modules (core/ci-policy.ts with the gh probe, delivery/ship.ts), with a different contract to adopt and no code shared with the hook loader, so they stay open under issue 76."
sweep: "grep -rn 'loadHookConfig\\|aidlc.config.json' src/hooks lists the one reader; grep -rn 'new RegExp' src/hooks lists every pattern compile and which config key feeds it."
forbid: [changing a guard's decision under a config that parses, changing config.ts, changing the hook wiring in settings.json, a config line in the Stop output]
non_goals: ["issue 76 item 2, CI log classes", "issue 76 item 3, exit 0 read as merged", "the PowerShell tool outside the guards: issue 117", "config discovery above cwd: issue 118"]
hygiene: "Issue 76 item 1, decided under the delegation of 2026-09-27T09:20Z: fail closed with the repair open. Stop gets no config line: Stop context re-invokes the model at every turn end, and the DoD note of verify-before-done looped about 12 turns on 2026-09-26 while a session waited for a ruling; the error reaches the session through every PreToolUse denial and every user prompt instead. Ships after T1-BOUND-TELEMETRY and T0-EXTEND-RUNNING-CARD."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
superseded_by: T0-HOOK-CONFIG-CLOSED-2
---

# T0-HOOK-CONFIG-CLOSED

## Deliverable
An `aidlc.config.json` that does not parse no longer turns the hook guards off: each guard that reads it denies what it cannot decide, names the error, and lets the session fix the file.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hooks.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
