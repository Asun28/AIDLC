---
id: T0-ENV-CASE-2
title: (replaces T0-ENV-CASE and carries its candidate) killProcessTree, listProcesses and resolveWorktreeRoot read SystemRoot, windir and SystemDrive through one helper that ignores the letter case of a variable name on win32, so an environment object copied from a process started in Git Bash (SYSTEMROOT, WINDIR, SYSTEMDRIVE) finds the system root and drive instead of falling back to C:\Windows and C: (issue 307)
status: todo
branch: T0-ENV-CASE-2
worktree: D:\wt\AIDLC\T0-ENV-CASE-2
allow_paths:
  - src/core/env-name.ts
  - src/probes/exec.ts
  - src/probes/processes.ts
  - src/config.ts
  - tests/infra/env-name.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T0-ENV-CASE-2.md
  - specs/tasks/T0-ENV-CASE-2.md
dod_command: npm run typecheck && node --test tests/infra/env-name.test.ts tests/infra/stray-processes.test.ts tests/surface/config.test.ts tests/surface/changelog-fragments.test.ts tests/surface/module-map.test.ts
dod_exit: 0
requirements:
  - R1. A new module src/core/env-name.ts (pure, no I/O) shall export one function that takes an environment object, a variable name and a platform and returns the variable's value or undefined. On `win32` it shall consider every own key of the object whose upper-case form equals the upper-case name, the exact spelling first and then the others in the object's key order, and return the first non-empty value; on any other platform it shall return the value of the exact name when it is non-empty. An empty value counts as missing on every platform, as the `||` chains it replaces treat it.
  - R2. `killProcessTree` (src/probes/exec.ts) and `listProcesses` (src/probes/processes.ts) shall read `SystemRoot`, then `windir`, through that function with the platform they are given, keeping the fallback `C:\Windows` and the removal of trailing separators; `resolveWorktreeRoot` (src/config.ts) shall read `SystemDrive` through it on win32, keeping the fallback `C:`. The `HOME` read of `resolveWorktreeRoot` on other platforms, every other line of the three functions and their signatures stay as they are.
  - R3. The change shall be recorded in the fragment `changelog.d/T0-ENV-CASE-2.md` (the form of changelog.d/README.md) under this card id and issue 307. `docs/ARCHITECTURE.md` shall name the new module in one new paragraph, directly after the paragraph that starts "`src/core/trial-compare.ts` is the pure verdict" and before the `bench/` paragraph, that starts "`src/core/env-name.ts`" and says what it reads, so tests/surface/module-map.test.ts finds it; no other line of docs/ARCHITECTURE.md changes. `CHANGELOG.md` and `docs/OPERATIONS.md` shall not change (OPERATIONS names `%SystemDrive%` in Windows notation, which already reads the variable in any case).
acceptance:
  - 1. tests/infra/env-name.test.ts - a table for the function of R1: on win32 `{ SYSTEMROOT: 'D:\\Win' }` read as `SystemRoot` gives `D:\Win`; `{ SystemRoot: 'D:\\A', SYSTEMROOT: 'E:\\B' }` gives `D:\A` (exact spelling first); `{ SystemRoot: '', SYSTEMROOT: 'E:\\B' }` gives `E:\B` (empty is missing); `{ systemroot: 'F:\\C', SYSTEMROOT: 'E:\\B' }` gives `F:\C` (key order); `{}` gives undefined; on linux `{ SYSTEMROOT: 'D:\\Win' }` read as `SystemRoot` gives undefined and `{ HOME: '' }` read as `HOME` gives undefined. [R1] [dod arm 1]
  - 2. tests/infra/env-name.test.ts - one row per function with an environment object whose names are upper case, the reproduction of the issue: `killProcessTree` on win32 with `{ SYSTEMROOT: 'D:\\Windows' }` and a scripted runner runs `D:\Windows\System32\taskkill.exe`, and with `{ WINDIR: 'E:\\W' }` runs `E:\W\System32\taskkill.exe`; `listProcesses` on win32 with `{ SYSTEMROOT: 'D:\\Windows\\' }` runs `D:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`; `resolveWorktreeRoot` on win32 with an empty `worktreeRoot` and `{ SYSTEMDRIVE: 'E:' }` gives `E:\wt\<name>`; on main each of these gives the `C:\Windows` or `C:` fallback. [R2] [dod arm 1]
  - 3. tests/infra/stray-processes.test.ts and tests/surface/config.test.ts pass unchanged; tests/infra/exec.test.ts is unchanged and passes in CI (left out of the DoD while issue 341 makes it flaky under local load). [R2] [dod arm 1]
  - 4. The fragment carries the entry; a test reads it with `fragmentEntry` of tests/infra/changelog.ts and fails with it removed; tests/surface/changelog-fragments.test.ts passes; tests/surface/module-map.test.ts passes and fails with the new ARCHITECTURE paragraph removed; `git diff origin/main -- CHANGELOG.md docs/OPERATIONS.md specs/tasks/T0-ENV-CASE.md` is empty and `git diff origin/main -- docs/ARCHITECTURE.md` adds only that paragraph and its blank line. [R3] [dod arm 1]
depends_on: []
budget: 150
tdd: true
sweep: "grep -rn \"SystemRoot\\|windir\\|SystemDrive\" src: src/probes/exec.ts:253 (killProcessTree), src/probes/processes.ts:134 (listProcesses), src/config.ts:227 (resolveWorktreeRoot) read a caller-supplied `env` by the mixed-case name; src/loop/context-pack.ts:48 reads `process.env` itself, which Windows already reads in any case, and stays as it is. src/review/pre-review.ts `reviewerEnv` already compares names in upper case on win32 for the reviewer variables and stays as it is. Tests that pin these reads: tests/infra/stray-processes.test.ts:131 (SystemRoot, windir and empty values for listProcesses), tests/infra/exec.test.ts:101-120 (taskkill under the default C:\\Windows), tests/surface/config.test.ts (resolveWorktreeRoot)."
forbid: [weakening or skipping a test to go green, a change to the fallback values, a change to `reviewerEnv` or to src/loop/context-pack.ts, a change to the signature of any of the three functions, a change to CHANGELOG.md or docs/OPERATIONS.md, any change to docs/ARCHITECTURE.md beyond the paragraph of R3]
non_goals: [any other environment variable, a caller that passes a copy of the environment (none does today), the timing tests of tests/infra/exec.test.ts (issue 341)]
diagnosis:
  root_cause: "On Windows `process.env` finds a variable whatever the letter case of its name, but a plain copy (`{ ...process.env }`) has one member per name as the environment block spells it, and a process started from Git Bash spells SYSTEMROOT, WINDIR and SYSTEMDRIVE in upper case. killProcessTree, listProcesses and resolveWorktreeRoot read `env['SystemRoot']`, `env['windir']` and `env['SystemDrive']` from a caller-supplied object, so such a copy reads undefined and falls back to C:\\Windows and C:. Every caller passes process.env or the default today, so nothing is wrong yet; the first card of T0-DOCTOR-STRAY-PROCESSES asked for a copy as the default and failed its own test under Git Bash."
  same_class: "The three reads of the sweep; context-pack.ts and reviewerEnv are already correct (process.env itself, and an upper-case comparison)."
hygiene: "Issue 307. Replaces T0-ENV-CASE, which forbade any docs change while adding src/core/env-name.ts; tests/surface/module-map.test.ts requires every file under src/ to be named in docs/ARCHITECTURE.md, so CI on PR 357 failed (ubuntu and Windows shard 4) and its attempt was counted. Carries candidate 00e7fc8a (R3 decision 2 and its second pass passed on it); restores specs/tasks/T0-ENV-CASE.md to its text on main and renames the fragment to this card id. The coordinating session checked the placement: the trial-compare paragraph is pinned by no test, and tests/surface/bench.test.ts pins the `bench/` paragraph only as a whole line. Ship only after issue 359's fix is on main: env-name.test.ts moves stray-processes.test.ts into CI shard 3. Decided by the coordinating session working the open issues through the loop. Give each read and each rule of the helper (exact first, key order, empty is missing, win32 only) its own failing-when-removed row before the first R3 (docs/LESSONS.md 2026-11-17 T1-OUTCOME-ESCAPED and the T0-SHIP-SAGA-LEG lesson: a row holds only its own trigger). No doc sentence: the coordinating session checked that docs/OPERATIONS.md line 27 needs none."
doc_sync: docs/ARCHITECTURE.md, changelog.d/T0-ENV-CASE-2.md
---

# T0-ENV-CASE

## Deliverable
The three functions that take an environment object read SystemRoot, windir and SystemDrive in any letter case on win32 through one pure helper, so a copied environment finds the real system root and drive.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/env-name.test.ts tests/infra/stray-processes.test.ts tests/surface/config.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
