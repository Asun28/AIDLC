---
id: T1-PS-GUARD-WIRE
title: A PowerShell tool call runs the Bash guard set, and aidlc init moves an existing settings file to the new matcher without running the dispatcher twice
status: merged
branch: T1-PS-GUARD-WIRE
worktree: D:\wt\AIDLC\T1-PS-GUARD-WIRE
plan_ref: plans/powershell-guards.md#order-of-work
allow_paths:
  - .claude/settings.json
  - templates/claude/settings.json
  - src/hooks/entry.ts
  - src/hooks/index.ts
  - src/scaffold/init.ts
  - tests/surface/ps-guard-wire.test.ts
  - tests/surface/command-lines.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-PS-GUARD-WIRE.md
dod_command: npm run typecheck && node --test tests/surface/ps-guard-wire.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/surface/hook-name.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/infra/init.test.ts
dod_exit: 0
requirements:
  - R1. The `PreToolUse` matcher in `.claude/settings.json` and `templates/claude/settings.json` shall be `Bash|PowerShell|Edit|Write|MultiEdit`.
  - R2. WHEN a `PreToolUse` event's `tool_name` is `PowerShell`, `hookNamesFor` (`src/hooks/entry.ts`) shall return the list it returns for `Bash`.
  - R3. WHEN `aidlc init` merges into an existing `.claude/settings.json` whose `PreToolUse` holds an entry with matcher `Bash|Edit|Write|MultiEdit`, `mergeSettings` (`src/scaffold/init.ts`) shall take each aidlc dispatcher command off that entry, drop the entry when no hook is left on it, and leave every foreign hook on it under that matcher.
  - R4. WHEN a config cannot be used and a command reaches `configDenial` (`src/hooks/index.ts`) from a PowerShell event, the denial shall open with `PowerShell is denied while`; the text of a Bash event's denial stays as it is at 00e8a49.
  - R5. `docs/OPERATIONS.md` shall carry the matcher of R1 at the hook wiring paragraph, `PreToolUse Bash, PowerShell` in the `production-gate` row and `PreToolUse Edit, Write, MultiEdit, Bash, PowerShell` in the `protect-paths` and `secrets-guard` rows.
  - R6. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
  - R7. The `production-gate` row that T1-SWEEP2-FLAGS acceptance 5 pins in `tests/surface/command-lines.test.ts` shall read `PreToolUse Bash, PowerShell`, the row R5 requires; no other line of that file changes.
acceptance:
  - 1. `tests/surface/ps-guard-wire.test.ts` - both settings files parse and the single `PreToolUse` entry of each has the matcher of R1. [R1] [dod arm 2]
  - 2. Same file - `hookNamesFor` for a `PreToolUse` event with `tool_name` `PowerShell` deep-equals the list for `Bash`. At 00e8a49 it returns an empty list. [R2] [dod arm 2]
  - 3. Same file - `dispatchHook` on a `PowerShell` event whose command matches a `DEFAULT_HOOK_CONFIG.productionPatterns` entry, with no approval in the env, returns a block; on a `PowerShell` event whose command holds a fake AWS key id it returns a block. At 00e8a49 both pass. [R2] [dod arm 2]
  - 4. Same file - `initProject` over a target whose `PreToolUse` holds one entry with the old matcher and the template dispatcher command alone leaves one entry, with the new matcher. [R3] [dod arm 2]
  - 5. Same file - `initProject` over a target whose old-matcher entry holds the dispatcher command and a foreign hook leaves the old-matcher entry with the foreign hook alone, and one new-matcher entry with the dispatcher. A second `initProject` changes nothing. [R3] [dod arm 2]
  - 6. Same file - with an `aidlc.config.json` that cannot be used, a `PowerShell` event with a command beyond the doctor list is denied with a reason that opens `PowerShell is denied while`, and `aidlc doctor` as a `PowerShell` command passes. The Bash cases in `tests/surface/hooks.test.ts` stay green and unedited. [R4] [dod arm 2]
  - 7. Same file - `docs/OPERATIONS.md` holds the three texts of R5 and `CHANGELOG.md` holds the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R5] [R6] [dod arm 2]
  - 8. `tests/surface/command-lines.test.ts` - T1-SWEEP2-FLAGS acceptance 5 passes on the row of R5, and the file differs from 00e8a49 by that one line. [R7] [dod arm 2]
depends_on: []
budget: 220
tdd: true
freeze: true
sweep: "git grep 'Bash|Edit|Write|MultiEdit' on main 00e8a49: .claude/settings.json:28, templates/claude/settings.json:28, docs/OPERATIONS.md:198, no other tracked file outside docs/plans archives. git grep tool_name over src: src/hooks/index.ts:44 is the type and src/hooks/entry.ts:31 is the only reader, so hookNamesFor is the one selection point. The denial text `Bash is denied while` is built once, src/hooks/index.ts:281. Added in attempt 1: `git grep 'PreToolUse Bash' tests` finds tests/surface/command-lines.test.ts:105, which pins the production-gate row of R5 and failed the full suite; the first sweep searched the matcher text only."
forbid: [weakening or skipping a test to go green, editing any test in tests/surface/hooks.test.ts, changing the decision of a Bash event, an edit of any file under `.aidlc/`, adding a `permissions.deny` rule]
non_goals: [reading PowerShell command shape (T1-PS-GUARD-READ), the `permissions.deny` list, issue 135, a guard for a tool other than PowerShell]
hygiene: "Prove the wiring with a mutant: dropping `PowerShell` from hookNamesFor fails acceptance 2 and 3; removing the migration from mergeSettings fails acceptance 4 and 5. The doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
---

# T1-PS-GUARD-WIRE

## Deliverable
A command run through the PowerShell tool reaches `production-gate`, `protect-paths` and `secrets-guard`, read as a Bash command until T1-PS-GUARD-READ adds the PowerShell shapes. `aidlc init` moves an existing settings file to the new matcher, so the dispatcher runs once per tool call.

## Implementation notes
- `mergeSettings` finds entries by exact matcher text, so without R3 the new entry lands beside the old one and every Bash call runs the dispatcher twice.
- The dispatcher commands are `TEMPLATE_HOOK_COMMAND`, `node node_modules/aidlc/bin/aidlc-hook.js` and `node bin/aidlc-hook.js`. Run the R3 step before the merge loop, next to `stripLegacyHooks`.
- `configDenial` takes `bash: boolean`. Pass the tool name instead, or the event, so the Bash text stays byte for byte.

## Doc text
CHANGELOG entry:

- T1-PS-GUARD-WIRE (bugfix, issue 117): a PowerShell tool call now runs the Bash guard set (`production-gate`, `protect-paths`, `secrets-guard`), through the `PreToolUse` matcher `Bash|PowerShell|Edit|Write|MultiEdit` in both settings files, and `aidlc init` takes the dispatcher off an old-matcher entry, so it runs once per tool call and a foreign hook keeps its matcher.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/ps-guard-wire.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/surface/hook-name.test.ts tests/surface/command-lines.test.ts tests/surface/templates.test.ts tests/surface/mirror.test.ts tests/surface/prose.test.ts tests/infra/init.test.ts
```
- Expected exit code: 0
- Assertion: every listed file passes; the acceptance tests name their acceptance number.
