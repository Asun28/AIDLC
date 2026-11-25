---
id: T1-HOOK-WIRING-LOCAL
title: The hookCommand line of aidlc doctor reads the dispatcher of .claude/settings.local.json as well as that of .claude/settings.json and reports ok when the file of either exists
status: merged
branch: T1-HOOK-WIRING-LOCAL
worktree: D:\wt\AIDLC\T1-HOOK-WIRING-LOCAL
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/probes/hook-wiring.ts
  - tests/surface/hook-wiring-local.test.ts
  - docs/ARCHITECTURE.md
  - changelog.d/T1-HOOK-WIRING-LOCAL.md
  - specs/tasks/T1-HOOK-WIRING-LOCAL.md
dod_command: npm run typecheck && node --test tests/surface/hook-wiring-local.test.ts tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/infra/stray-processes.test.ts tests/surface/templates.test.ts tests/surface/module-map.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. `hookWiringReport(root)` (src/probes/hook-wiring.ts:33) shall take as candidates the first `PreToolUse` dispatcher of `<root>/.claude/settings.json`, read as `wiredDispatcher` reads it today (:15-22), followed by the first `PreToolUse` dispatcher of `<root>/.claude/settings.local.json`, read by the same rules; a file that is absent, cannot be read, does not parse or holds no dispatcher gives no candidate.
  - R2. With no candidate the value shall be `not wired`; otherwise it is `ok: <command>` for the first candidate whose file exists as a regular file, resolved as today (:36-37), and when no candidate's file exists it is `FAILED: every guard is off until this command runs: <command>` for the first candidate.
  - R3. The module shall keep starting no process and importing no `node:child_process`, and read at most the two settings files and check at most two paths per call.
  - R4. The header comment of the file (:1-6) shall name both settings files, and the sentence of docs/ARCHITECTURE.md that begins `hook-wiring.ts` gives (in the `src/probes/` paragraph, :20) reads the text of the acceptance detail, with every other sentence of that paragraph unchanged.
  - R5. The new changelog.d/T1-HOOK-WIRING-LOCAL.md shall hold the entry of the acceptance detail followed by one line feed.
acceptance:
  - 1. `tests/surface/hook-wiring-local.test.ts` (new), "T1-HOOK-WIRING-LOCAL acceptance 1: a dispatcher wired only in settings.local.json is reported ok with its file present and FAILED with it missing or a directory". The absolute spelling, built as tests/surface/init-no-package.test.ts:247 builds it, and `node bin/aidlc-hook.js`. Fails on main by assertion (`not wired`). [R1] [R2] [dod arm 2]
  - 2. Same file, "T1-HOOK-WIRING-LOCAL acceptance 2: with a dispatcher in each file the first whose file exists is reported, the shared one first". Four rows: both files present gives `ok` with the shared command; only the local one present gives `ok` with the local command (fails on main, which reports `FAILED` for the shared one); only the shared one present gives `ok` with the shared command; neither present gives `FAILED` with the shared command. [R1] [R2] [dod arm 2]
  - 3. Same file, "T1-HOOK-WIRING-LOCAL acceptance 3: a settings.local.json that gives no candidate changes nothing". One row per form: absent, a directory in its place, text that is not JSON, `{}`, `hooks` without `PreToolUse`, a hook command that is an array, a number or null, a foreign command, an absolute dispatcher with `&` in its path, and a dispatcher under `Stop` only. Each is run twice: with no shared file the value is `not wired`, and beside a shared dispatcher whose file exists the value is `ok` with the shared command. Passes on main and with this card, since main never reads the file. [R1] [R2] [dod arm 2]
  - 4. Same file, "T1-HOOK-WIRING-LOCAL acceptance 4: the file a local dispatcher names is not run". The local absolute dispatcher names a planted script that would create a marker directory, as tests/surface/init-no-package.test.ts:238-243 plants it; after `hookWiringReport` and after `node bin/aidlc.js doctor --json` in that directory the marker is absent, and the `hookCommand` of the doctor output is `ok` with the local command. Fails on main by assertion (`not wired`). [R2] [R3] [dod arm 2]
  - 5. tests/surface/init-no-package.test.ts (its describe "T1-INIT-HOOK-PATH: aidlc doctor hookCommand", :226-317, every row of which wires the shared file only, and :314, which reads the imports of hook-wiring.ts) and tests/infra/init.test.ts (:251 calls `hookWiringReport`) pass with no line changed. They pass on main and with this card. [R2] [R3] [dod arm 2]
  - 6. tests/infra/stray-processes.test.ts (its :661-673 require the `src/probes/` paragraph of docs/ARCHITECTURE.md to end with the `processes.ts` sentence), tests/surface/templates.test.ts (:271, the `base-sync.ts` sentence of the same paragraph) and tests/surface/module-map.test.ts pass with no line changed. They pass on main and with this card. [R4] [dod arm 2]
  - 7. The header comment names both files, the ARCHITECTURE sentence is the text of the acceptance detail, and changelog.d/T1-HOOK-WIRING-LOCAL.md holds the entry of the acceptance detail followed by one line feed (reviewer-verified against the diff); tests/surface/changelog-fragments.test.ts passes with the new file. [R4] [R5] [dod arm 2]
depends_on: [T1-CHANGELOG-FRAGMENTS]
budget: 110
tdd: true
sweep: "On main at 35de54fe. `grep -rnE 'hook-wiring|hookWiringReport|hookCommand|not wired' src tests docs README.md CHANGELOG.md`. Code: src/probes/hook-wiring.ts:15-22 (`wiredDispatcher` reads `.claude/settings.json` only and returns its first `PreToolUse` dispatcher), :33-38 (`hookWiringReport`), src/cli/main.ts:347 (the one caller in src, with the worktree root). Tests that pin the line: tests/surface/init-no-package.test.ts:226-317 (ok and FAILED for each spelling, a linked worktree, not wired for no file, a file that does not parse, a command that is not a string, a foreign hook and an absolute path with `&`; every fixture writes `.claude/settings.json` only, through `wired` at :233-235), :314 (no `child_process` import), tests/infra/init.test.ts:251 (`not wired` after `--no-hooks`). Doc sentences that name the line: docs/OPERATIONS.md:15 and :325 and README.md:95, pinned by tests/surface/readme.test.ts:52 and :57 and tests/surface/init-no-package.test.ts:320; each speaks of `.claude/settings.json` and stays true for a repository whose local file wires nothing, which is every repository until T1-INIT-HOOK-LOCAL merges, and T1-INIT-HOOK-LOCAL-DOCS rewrites them. `isDispatcherCommand` (src/scaffold/init.ts:209-211) decides what a dispatcher is and does not change. docs/ARCHITECTURE.md:20, the `src/probes/` paragraph, says the line checks the dispatcher in `.claude/settings.json`; no test pins that sentence, tests/infra/stray-processes.test.ts:661-673 pins the last sentence of the paragraph and tests/surface/templates.test.ts:271 its `base-sync.ts` sentence, and both stay."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of a test file that exists on main
  - starting a process, or importing `node:child_process`, in src/probes/hook-wiring.ts
  - a change to src/scaffold/init.ts, src/cli/main.ts, README.md or docs/OPERATIONS.md, or to a sentence of docs/ARCHITECTURE.md other than the one of R4
  - a third settings file (the user settings in the home directory, a managed settings file)
  - the sequence of two hash signs and a space in the entry
non_goals:
  - writing `.claude/settings.local.json`, which T1-INIT-HOOK-LOCAL does
  - the README and OPERATIONS text, which T1-INIT-HOOK-LOCAL-DOCS writes
  - a second or later `PreToolUse` dispatcher of one file; as on main, only the first of each file is a candidate
  - a dispatcher wired under `Stop` or `UserPromptSubmit` only; as on main, the line reads `PreToolUse`
  - whether Claude Code runs the hooks of both files; the line reports the files, and a hook file that exists and fails to start is not detected, as on main
  - the user-level and managed settings files of Claude Code; they are not read
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. Tests first, in two commits: the first adds tests/surface/hook-wiring-local.test.ts and records acceptance 1, 2 (its second row) and 4 failing on main by assertion while acceptance 3 passes; the second changes hook-wiring.ts. The new test file makes its directories through `tmpDir` of tests/infra/helpers.ts and removes them in an `after` hook, as tests/surface/init-no-package.test.ts:26-35 does. Revert table, each row a scratch change restored afterwards: the local file not read (1 and 4 red); the local candidate put first (2 red, first row); `FAILED` reported for the first candidate without trying the second (2 red, second row); `FAILED` naming the local command when both are missing (2 red, fourth row); a parse error of the local file allowed to throw (3 red)."
---

# T1-HOOK-WIRING-LOCAL

## Deliverable
`aidlc doctor` reports on its `hookCommand` line a dispatcher that is wired in `.claude/settings.local.json`, alone or beside one in `.claude/settings.json`.

## Why
Owner decision of 2026-11-16 (intent/install-portability.md): a machine-specific hook command goes to `.claude/settings.local.json`. `hookWiringReport` reads `.claude/settings.json` only (src/probes/hook-wiring.ts:17), so after T1-INIT-HOOK-LOCAL a working local dispatcher would read `not wired`. This card comes first so that card can assert the line. Spec specs/install-portability.md R6.

With a dispatcher in each file both run in Claude Code, so the guards are on when either file exists; the line therefore reports `ok` for the first candidate whose file exists and `FAILED` only when none does. For one file the result is what main gives.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/hook-wiring-local.test.ts tests/surface/init-no-package.test.ts tests/infra/init.test.ts tests/infra/stray-processes.test.ts tests/surface/templates.test.ts tests/surface/module-map.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes; no existing test line changes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail
The ARCHITECTURE sentence, in place of the sentence that begins `` `hook-wiring.ts` gives `` and ends `checked without starting a process.`:

`` `hook-wiring.ts` gives `aidlc doctor` its `hookCommand` line (`hookWiringReport`): whether the file that the hook dispatcher in `.claude/settings.json` or in `.claude/settings.local.json` starts exists, checked without starting a process. ``

changelog.d/T1-HOOK-WIRING-LOCAL.md (new), this one line and one line feed:

"- T1-HOOK-WIRING-LOCAL: the `hookCommand` line of `aidlc doctor` reads the first `PreToolUse` dispatcher of `.claude/settings.local.json` as well as that of `.claude/settings.json`. It prints `ok` with the first of the two whose file exists, the one of `.claude/settings.json` first, `FAILED` with the first when the file of neither exists, and `not wired` when neither file wires a dispatcher. For a repository that wires `.claude/settings.json` alone the line is as before, and the check still starts no process."
