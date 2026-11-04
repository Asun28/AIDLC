---
slug: powershell-guards
title: The PreToolUse guards see PowerShell commands (issue 117)
spec: https://github.com/Asun28/AIDLC/issues/117
size: T1
status: draft
created: 2026-11-04T10:30:00Z
---

# Plan: The PreToolUse guards see PowerShell commands (from issue 117)

## 1. Goal and boundaries
A command run through the PowerShell tool passes the same three guards as a Bash command. PowerShell is the
primary shell on the development machine, so today no shell guard runs there. In scope: the hook matcher, the guard
set, `aidlc init` on an existing settings file, and the PowerShell command shapes a guard must read. Cut:
decoding `-EncodedCommand` (the threat is agent mistakes, not an agent hiding a command), a quote-aware parser
(a separator inside quotes splits too, as in Bash, which only adds segments). Deferred: issue 135 (option reading).
Success: both cards merged with DoD, review and CI green, and a guard denies a live PowerShell command on main.

## 2. Minimal acceptable loop
Wire first, then read. Wiring alone gives the guards the Bash reading of a PowerShell command, which is better than
no guard. The reading card then adds what that misses.

## 3. Tech stack
none this version

## 4. Directory structure
none this version

## 4.5 Module design
`src/hooks/entry.ts` selects the guards for a tool name. `src/hooks/index.ts` holds the guards and their command
reading. `src/scaffold/init.ts` merges the matcher into an existing settings file.

## 5. Data model and state machine
none this version

## 6. Contracts and core interfaces
The hook event's `tool_name` is the only signal of the shell. A Bash event decides exactly as it does today.

## Files that change
- .claude/settings.json
- templates/claude/settings.json
- src/hooks/entry.ts
- src/hooks/index.ts
- src/scaffold/init.ts
- tests/surface/ps-guard-wire.test.ts (new)
- tests/surface/ps-guard-read.test.ts (new)
- docs/OPERATIONS.md
- CHANGELOG.md

## Order of work
1. T1-PS-GUARD-WIRE: matcher, guard set, denial text, init migration of the old matcher.
2. T1-PS-GUARD-READ: backtick continuation, script block and subexpression segments, write commands and aliases.

## 7. Task split (dependencies and parallel windows)

| Card | Priority | Output | depends_on | Parallel window | Freeze point |
|---|---|---|---|---|---|
| T1-PS-GUARD-WIRE | MUST | Bash guard set runs for PowerShell, init migrates the old matcher | - | - | yes |
| T1-PS-GUARD-READ | MUST | Guards read PowerShell command shape | T1-PS-GUARD-WIRE | - | - |

## Risks
- `init` matches entries by exact matcher text, so a new matcher beside the old one would run the dispatcher twice per Bash call. The wire card moves our command off the old entry and leaves foreign hooks on it.
- T0-HOOK-GIT-PREFETCH (session aidlc-6c) also edits `src/hooks/entry.ts`, so a base merge is likely.
- Splitting at braces and parentheses can deny a read that quotes a guarded word pair. That direction is safe and the denial names the reason.
- Live settings change: every PowerShell call in this repository gains a hook process, about 0.2 s per call.

## Proof
- Each card's DoD. `tests/surface/mirror.test.ts` keeps the two settings files in step.
- After merge, a PowerShell call that matches a `hooks.productionPatterns` entry is denied on main with no authorization set.
