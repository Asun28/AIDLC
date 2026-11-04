---
id: T1-PS-GUARD-READ
title: On a PowerShell event the guards read backtick continuations, script blocks, subexpressions and PowerShell write commands, and a Bash event decides as before
status: merged
branch: T1-PS-GUARD-READ
worktree: D:\wt\AIDLC\T1-PS-GUARD-READ
plan_ref: plans/powershell-guards.md#order-of-work
allow_paths:
  - src/hooks/index.ts
  - tests/surface/ps-guard-read.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T1-PS-GUARD-READ.md
dod_command: npm run typecheck && node --test tests/surface/ps-guard-read.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/surface/prose.test.ts
dod_exit: 0
requirements:
  - R1. WHEN an event's `tool_name` is `PowerShell`, the second pass of `productionGate` (`classic` false) shall test the mutating segments of the command after joining each backtick followed by a line break into a space and splitting at every separator `commandSegments` splits at and at `{`, `}`, `(` and `)`.
  - R2. WHEN an event's `tool_name` is `PowerShell`, the second pass of `protectPaths` (`classic` false) shall treat a command as writing when `writesFiles` holds, when a segment read as in R1 has a first word in the list of the Doc text section, or when the command holds `-OutFile` or `[IO.File]::` followed by `Write`, `Append`, `Delete`, `Move` or `Copy`, in any case.
  - R3. An event whose `tool_name` is not `PowerShell` shall decide as it does at the merge of T1-PS-GUARD-WIRE; `mutatingSegments`, `commandSegments`, `WRITE_VERBS` and `READ_ONLY_TOOLS` keep their text.
  - R4. `docs/OPERATIONS.md`, after the guards table, shall carry the OPERATIONS sentence of the Doc text section.
  - R5. The CHANGELOG Unreleased section shall carry the entry of the Doc text section.
acceptance:
  - 1. `tests/surface/ps-guard-read.test.ts` - with no approval set, each of these `PowerShell` commands, built with a pattern-matching word pair from `DEFAULT_HOOK_CONFIG.productionPatterns`, is blocked by `dispatchHook`: the pair split across a backtick line continuation; inside `Write-Output { ... }`; inside `Write-Output ( ... )`; inside `Write-Output $( ... )`; inside `& { ... }` after a read-only command; inside `Get-Content a.txt | ForEach-Object { ... }`; in `pwsh -Command "..."` after a read-only command. At the merge of T1-PS-GUARD-WIRE the first four are not blocked; the last three already are, and the test names them as pins. [R1] [dod arm 2]
  - 2. Same file - with a `hooks.frozenPaths` entry, each of `sc`, `ac`, `ni`, `cpi`, `mi`, `rni`, `ren`, `rd`, `rmdir`, `erase`, `clc`, `si`, `copy`, `move`, `epcsv`, `Rename-Item`, `Clear-Content`, `Set-Item`, `Export-Csv` and `Export-Clixml` on that path is denied on a `PowerShell` event, also inside a pipeline and a script block; so are `Invoke-WebRequest -OutFile` and `[IO.File]::WriteAllText` on it. [R2] [dod arm 2]
  - 3. Same file - `Get-Content` of the frozen path on a `PowerShell` event is deferred with the note, and a path segment spelled `ni` in a read is not a write. [R2] [dod arm 2]
  - 4. Same file - the same strings on a `Bash` event return the decisions they return at the merge of T1-PS-GUARD-WIRE, and `sc` on a frozen path on a `Bash` event is deferred, so no PowerShell reading reaches a Bash event. `tests/surface/hooks.test.ts` stays green and unedited. [R3] [dod arm 2]
  - 5. Same file - `docs/OPERATIONS.md` holds the OPERATIONS sentence and `CHANGELOG.md` the Unreleased entry of the Doc text section; a test reads each exact text and fails with it removed. [R4] [R5] [dod arm 2]
depends_on: [T1-PS-GUARD-WIRE]
budget: 180
tdd: true
sweep: "git grep -n 'commandSegments\\|writesFiles\\|mutatingSegments' src on main 00e8a49: every reader is in src/hooks/index.ts (productionGate at 410, protectPaths at 451), and `dispatchHook` runs each classified guard with `classic` true and then false, so the PowerShell reading belongs in the second pass only. Added before dispatch: a probe of acceptance 1 on main 6dcdab7 blocked the `& { ... }`, `ForEach-Object { ... }` and `-Command` cases already and passed the other three, because a segment is exempt only when its first word is read-only; no case proved the brace split alone, so `Write-Output { ... }` was added. tests/surface/hooks.test.ts:1100 pins the `Which Bash segments` paragraph of OPERATIONS; the new sentence is its own paragraph and leaves that one unchanged."
forbid: [weakening or skipping a test to go green, editing any test in tests/surface/hooks.test.ts, changing the decision of a Bash event, adding a word to `WRITE_VERBS` or `READ_ONLY_TOOLS`, reading PowerShell shape in the `classic` pass, a quote-aware parser]
non_goals: [decoding `-EncodedCommand`, a quote-aware reading (a separator inside quotes splits too, which only adds segments), issue 135, `permissions.deny`]
hygiene: "Prove each arm with a mutant: dropping the backtick join fails the continuation case of acceptance 1; dropping the brace split fails the `Write-Output { ... }` case; dropping the parenthesis split fails the `Write-Output ( ... )` and `$( ... )` cases; matching aliases anywhere in the text instead of on the first word fails acceptance 3. The doc test reads the exact line (docs/LESSONS.md 2026-09-24 T1-OPUS55-MODELS)."
doc_sync: CHANGELOG.md, docs/OPERATIONS.md
---

# T1-PS-GUARD-READ

## Deliverable
The guards read what a PowerShell command does: a backtick continuation does not split a matched line, a script block or subexpression is its own segment, and PowerShell's write commands and aliases count as writes. A Bash event decides as before.

## Implementation notes
- `commandOf` already lower-cases the first word and drops a path and `.exe`, so the list is matched on `commandOf(segment).name`. Matching the first word, not the text, is what keeps `Get-Content .../ni/file` a read.
- `WRITE_VERBS` already covers `set-content`, `out-file`, `add-content`, `new-item`, `tee-object`, `tee`, `cp`, `copy-item`, `mv`, `move-item`, `remove-item`, `rm`, `del`, `ri` and every `>` form (`*>`, `2>&1`).
- `pwsh -Command "..."` has a first word off the read-only list, so `mutatingSegments` already tests that segment whole.

## Doc text
Write commands of R2:

`sc`, `ac`, `ni`, `cpi`, `mi`, `rni`, `ren`, `rd`, `rmdir`, `erase`, `clc`, `si`, `copy`, `move`, `epcsv`, `rename-item`, `clear-content`, `set-item`, `export-csv`, `export-clixml`

OPERATIONS sentence:

On a PowerShell event the guards also join a backtick line continuation, split at braces and parentheses, and count PowerShell's write commands and aliases as writes (card T1-PS-GUARD-READ); quotes are not read, so a separator inside quotes adds a segment, and `-EncodedCommand` is not decoded.

CHANGELOG entry:

- T1-PS-GUARD-READ (bugfix, issue 117): on a PowerShell event `production-gate` joins backtick continuations and tests script blocks and subexpressions as segments, and `protect-paths` counts PowerShell's write commands, aliases, `-OutFile` and `[IO.File]` writes; a Bash event decides as before.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/ps-guard-read.test.ts tests/surface/ps-guard-wire.test.ts tests/surface/hooks.test.ts tests/surface/hook-lazy.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: every listed file passes; the acceptance tests name their acceptance number.
