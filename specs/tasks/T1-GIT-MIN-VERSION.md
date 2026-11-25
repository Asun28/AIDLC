---
id: T1-GIT-MIN-VERSION
title: The README states git 2.45 or newer as the one supported minimum in place of the 2.38 sentence, and the git line of aidlc doctor keeps the installed version and marks a version older than 2.45 UNSUPPORTED
status: merged
branch: T1-GIT-MIN-VERSION
worktree: D:\wt\AIDLC\T1-GIT-MIN-VERSION
plan_ref: plans/install-portability.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - src/probes/git.ts
  - src/probes/toolchain.ts
  - README.md
  - docs/OPERATIONS.md
  - tests/infra/git-min-version.test.ts
  - tests/infra/github-ship.test.ts
  - tests/infra/toolchain-probe.test.ts
  - changelog.d/T1-GIT-MIN-VERSION.md
  - specs/tasks/T1-GIT-MIN-VERSION.md
dod_command: npm run typecheck && node --test tests/infra/git-min-version.test.ts tests/infra/toolchain-probe.test.ts tests/infra/github-ship.test.ts tests/infra/base-sync.test.ts tests/infra/stray-processes.test.ts tests/infra/git.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
dod_exit: 0
requirements:
  - R1. `src/probes/git.ts` shall export `gitVersionLine(firstLine)`, which returns the value of the row of acceptance detail 1 that `firstLine` (a string, or undefined when git did not run or exited non-zero) matches, reading the major and minor release from the first match of `^git version (\d+)\.(\d+)` as numbers, comparing the major first, and reading no file, environment or process and running nothing.
  - R2. `toolchainReport` (src/probes/toolchain.ts) shall pass the first output line of `git --version` through `gitVersionLine` when git exits 0 and did not time out, and shall leave the `git` value `MISSING` and the `git` value that begins `unknown: ` as on main, and the `gh` and `pwsh` values, the three calls, their bound, every other doctor entry, their order and doctor's exit code as on main.
  - R3. The git bullet of README.md (:17) shall read the text of acceptance detail 2 on one line, with the README row of tests/infra/github-ship.test.ts (:1278) pinning its start with `/^- git 2\.45 or newer \(/m` in place of `/2\.38 or newer for the `github` ship path/`.
  - R5. The paragraph of docs/OPERATIONS.md that begins `Toolchain lines and the repository lookup` shall gain the sentence of acceptance detail 4 directly before `The bound covers a cold start`, with every other byte of the file unchanged.
  - R4. The new changelog.d/T1-GIT-MIN-VERSION.md shall hold the entry of acceptance detail 3 followed by one line feed.
acceptance:
  - 1. `tests/infra/git-min-version.test.ts` (new), "T1-GIT-MIN-VERSION acceptance 1: gitVersionLine keeps a version of 2.45 or newer, marks an older one and names a line with no version". One row per line of acceptance detail 1, each compared with `assert.equal`. Fails on main (no export; with the seam of the hygiene by assertion). [R1] [dod arm 2]
  - 2. Same file, "T1-GIT-MIN-VERSION acceptance 2: aidlc doctor --json prints the marked git line second, after node, and exits 0 when git reports 2.43.0", skipped on a win32 host. A directory put first on PATH holds an executable `git` that prints `git version 2.43.0` and exits 0 when its first argument is `--version` and otherwise runs the real git with that directory taken off PATH; `node bin/aidlc.js doctor --json` in a temporary directory that is no git repository exits 0, its `git` value is `git version 2.43.0 (UNSUPPORTED: aidlc needs git 2.45 or newer)`, and its first three keys are `node`, `git` and `gh`. Fails on main by assertion on a POSIX host (main prints `git version 2.43.0`). [R2] [dod arm 2]
  - 3. `tests/infra/github-ship.test.ts`, test "T0-SHIP-BASE-SYNC-2 acceptance 8: the docs and the header comment state the chain with the reconciliation and the sync, the sentinels, the git 2.38 requirement and the three conditions" (:1272): in its README row (:1278) the second pattern is the one of R3, and no other line of the file changes; its ARCHITECTURE and OPERATIONS rows keep `git 2\.38 or newer`, the need of `git merge-tree --write-tree`. Fails on main for the new pattern. [R3] [dod arm 2]
  - 4. tests/infra/base-sync.test.ts (:264-271 require docs/OPERATIONS.md, src/probes/base-sync.ts and that test file to name 2.45 and never the release before it, and :179-190 run doctor), tests/infra/stray-processes.test.ts (:600-616 run doctor with `--json` and `--no-json` and require exit 0), tests/infra/git.test.ts, tests/surface/prose.test.ts and tests/surface/templates.test.ts pass with no line changed. They pass on main and with this card. [R1] [R2] [R4] [dod arm 2]
  - 5. README.md:17 is the text of acceptance detail 2, src/probes/toolchain.ts changes only its imports, the `git` value of `toolchainReport` and the comment that states it, src/cli/main.ts is unchanged, docs/OPERATIONS.md gains the sentence of acceptance detail 4 and nothing else, and changelog.d/T1-GIT-MIN-VERSION.md holds the entry of acceptance detail 3 followed by one line feed (reviewer-verified against the diff); tests/surface/changelog-fragments.test.ts passes with the new file. [R2] [R3] [R4] [dod arm 2]
  - 6. `tests/infra/toolchain-probe.test.ts`, one new test "T1-GIT-MIN-VERSION acceptance 6: the git line is marked on exit 0 only" and no other line of the file changed. Through `toolchainReport` with the scripted runner: `git version 2.44.2` on exit 0 gives the `UNSUPPORTED` value of acceptance detail 1, an empty output on exit 0 gives its `UNREADABLE` value, and `git version 2.44.2` with exit 1 gives `MISSING` and with a timeout gives `unknown: git --version did not exit within 700 ms`. Fails on main by assertion. [R2] [dod arm 2]
depends_on: [T1-CHANGELOG-FRAGMENTS]
budget: 90
tdd: true
sweep: "On main at 2ef2bbf4. `git grep -nE '2\\.38|2\\.45|git version|merge-tree --write-tree' -- . ':!specs/tasks' ':!bench/outcome'` and `git grep -nE 'gitVersion|MISSING|doctor' -- tests`. README.md:17 is the one statement of a supported git release, pinned by tests/infra/github-ship.test.ts:1278 (test :1272), whose other rows pin `git 2\\.38 or newer` at docs/ARCHITECTURE.md:218 and docs/OPERATIONS.md:624 as the need of `git merge-tree --write-tree`, which stays true. No other test reads the README Requirements section. tests/infra/base-sync.test.ts:264-271 requires docs/OPERATIONS.md, src/probes/base-sync.ts and that test file to name 2.45 and never the release before it; this card changes none of the three. The option is used at src/probes/base-sync.ts:29 and src/loop/card-runner.ts:356 (a git without it gives a finding no identity, :343-345). Doctor: src/cli/main.ts:324 runs `git --version` through `probe` (:310-318, the first output line on exit 0, else undefined) and :330 prints `gitVersion ?? 'MISSING'`. Doctor sets no exit code for a check: only a configuration that does not parse ends it, through `fail` (:308); `git: MISSING` leaves it 0, and docs/OPERATIONS.md:37, :39 and :41 say of three other lines that the line never changes doctor's exit code, so an older git does not change it either. main.ts already imports from src/probes/git.ts (:16), so a new export there loads no new module at CLI start. Tests that run doctor read other keys, never `git`: tests/infra/stray-processes.test.ts:600-616, tests/infra/base-sync.test.ts:179-190, tests/surface/init-no-package.test.ts:226-231, tests/surface/doctor-interrupted-writes.test.ts:427, tests/surface/cli-cwd-paths.test.ts:284, tests/surface/config.test.ts:315 and :376. Measured on Windows on 2026-11-17: a `git.cmd` first on PATH is not run by a `spawn` of `git` without a shell (git.exe 2.56.0 answered), so acceptance 2 needs a POSIX host."
forbid:
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test other than the README pattern of acceptance 3
  - a change to src/probes/base-sync.ts, src/loop/card-runner.ts, docs/ARCHITECTURE.md or, beyond R5, docs/OPERATIONS.md, or any probe of `--no-lazy-fetch` support
  - a git call that doctor does not run on main; the version comes from the `git --version` line doctor already reads
  - a version comparison anywhere but `gitVersionLine`, or a use of its result other than the `git` value of `toolchainReport`; nothing decides from it (lesson 2026-10-07 T0-DOCTOR-BASE-SYNC-2)
  - a change to doctor's exit code, to another doctor entry or to the order of the entries
  - the text of the release before 2.45, written with its two numbers, in docs/OPERATIONS.md, src/probes/base-sync.ts or tests/infra/base-sync.test.ts (tests/infra/base-sync.test.ts:264-271)
  - a temporary directory in the new test made other than through `tmpDir` of tests/infra/helpers.ts (tests/surface/test-temp.test.ts)
  - a new file under src, or a new dependency
  - the sequence of two hash signs and a space in the entry
non_goals:
  - running a git older than 2.45; the base-sync check and the finding identity read keep `--no-lazy-fetch`, so baseSync stays `UNREADABLE` and a finding gets no identity there (the compatibility probe of T1-GIT-LAZY-FETCH-PROBE and T1-IDENTITY-READ-OLD-GIT is deferred by the owner's decision of 2026-11-17)
  - the 2.38 sentences of docs/ARCHITECTURE.md:218 and docs/OPERATIONS.md:624, which state the need of `git merge-tree --write-tree` and stay true under a 2.45 minimum
  - the doctor value `MISSING` when git does not run or exits non-zero, which stays as on main
  - a `git --version` line in another letter case or with text before `git version`; it reads as `UNREADABLE`
  - the dated statements of intent/reliability-baseline.md:108 and of CHANGELOG entries that name 2.38; the card changes no byte of CHANGELOG.md
hygiene: "Line numbers are from main at 2ef2bbf4; read them again at PREPARE. Owner decision of 2026-11-17 (intent/install-portability.md, Proposed outcome 4 and Constraints): git 2.45 is the one supported minimum, and no code that runs git changes; this card takes the README and doctor part of the deferred T1-GIT-LAZY-FETCH-PROBE. The doctor note decides nothing; the tests still find whether git accepts the option by running it (tests/infra/base-sync.test.ts:12-14). The row `git version 2.44.2` is an input of the new test file, which base-sync.test.ts:264-271 does not read. Acceptance 2 builds its child environment at call time as tests/infra/stray-processes.test.ts:595-600 does and takes its directory from `tmpDir` through `realpathSync.native` (lesson 2026-11-09 T1-BOARD-WATCH-2). Tests first, in two commits: the first adds the new test file, the pattern of acceptance 3 and a seam whose `gitVersionLine` returns `firstLine ?? 'MISSING'`, so acceptance 1 and 2 fail by assertion (2 on a POSIX host) and 3 on the README of main; the second adds the rule, the wiring, the README line and the fragment. Run acceptance 2 on Linux before the first review and record where in the Attempt evidence (lesson 2026-11-11 T0-DIRTY-SUCCESS-2). Revert table, each row a scratch change restored afterwards: versions compared as text (1 red on `2.5.0`, `2.100.1`); the minor compared without the major (1 red on `1.99.0`, `3.0.0`); `<` made `<=` (1 red on `2.45.0`); the unreadable branch dropped (1 red); the wiring in `toolchainReport` dropped (6 red); the README line put back (3 red). Run `npm test` once before the first review."
---

# T1-GIT-MIN-VERSION

## Deliverable
The README names one supported git release, 2.45 or newer, in place of the sentence that names 2.38 for the `github` ship path. The `git` line of `aidlc doctor` keeps the first line of `git --version` and says `UNSUPPORTED` when that line names a version older than 2.45.

## Why
Outside review of 2026-11-16 on git 2.43, confirmed on main at 2ef2bbf4: README.md:17 names 2.38, while the base-sync check of doctor (src/probes/base-sync.ts:29) and the identity read of an R3 finding (src/loop/card-runner.ts:356) run `git --no-lazy-fetch`, which git first accepts in 2.45 (docs/OPERATIONS.md:37, lesson 2026-10-07 T0-DOCTOR-BASE-SYNC-2). The two documented versions disagree, and doctor prints the installed version without saying it is too old. Owner decision of 2026-11-17: state 2.45 as the one minimum in the README and in doctor, and build no support for an older git now (intent/install-portability.md, Proposed outcome 4).

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/git-min-version.test.ts tests/infra/toolchain-probe.test.ts tests/infra/github-ship.test.ts tests/infra/base-sync.test.ts tests/infra/stray-processes.test.ts tests/infra/git.test.ts tests/surface/prose.test.ts tests/surface/templates.test.ts tests/surface/changelog-fragments.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. Arm 1 is the typecheck, arm 2 the test files.

## Acceptance detail

### 1. The rows of gitVersionLine
| `firstLine` | value |
|---|---|
| undefined | `MISSING` |
| `git version 2.56.0.windows.4` | the line as given |
| `git version 2.45.0` | the line as given |
| `git version 2.100.1` | the line as given |
| `git version 3.0.0` | the line as given |
| `git version 2.44.2` | `git version 2.44.2 (UNSUPPORTED: aidlc needs git 2.45 or newer)` |
| `git version 2.39.5 (Apple Git-154)` | `git version 2.39.5 (Apple Git-154) (UNSUPPORTED: aidlc needs git 2.45 or newer)` |
| `git version 2.5.0` | `git version 2.5.0 (UNSUPPORTED: aidlc needs git 2.45 or newer)` |
| `git version 1.99.0` | `git version 1.99.0 (UNSUPPORTED: aidlc needs git 2.45 or newer)` |
| the empty string | `UNREADABLE: "" names no git version; aidlc needs git 2.45 or newer` |
| `hub version 2.14.2` | `UNREADABLE: "hub version 2.14.2" names no git version; aidlc needs git 2.45 or newer` |
| `git version 2` | `UNREADABLE: "git version 2" names no git version; aidlc needs git 2.45 or newer` |

In the `UNREADABLE` value the line is written as `JSON.stringify` writes it.

### 2. The README bullet
`- git 2.45 or newer (state lives in the main checkout's `.aidlc/` so all worktrees share it). The `baseSync` line of `aidlc doctor` and the identity of an R3 finding read git with `--no-lazy-fetch`, which an older git refuses, so there `baseSync` is `UNREADABLE` and a finding gets no identity; the `github` ship path tests the merge with `git merge-tree --write-tree`. The `git` line of `aidlc doctor` prints the installed version and marks one older than 2.45 `UNSUPPORTED`.`

### 3. The entry
changelog.d/T1-GIT-MIN-VERSION.md (new), this one line and one line feed:

"- T1-GIT-MIN-VERSION: the README states git 2.45 or newer as the one supported minimum, where it stated 2.38 for the `github` ship path, since the base-sync check of `aidlc doctor` and the identity read of an R3 finding run `git --no-lazy-fetch`, which git first accepts in 2.45. The `git` line of `aidlc doctor` keeps the first line of `git --version`, appends `(UNSUPPORTED: aidlc needs git 2.45 or newer)` when that line names a version older than 2.45, and reads `UNREADABLE: <the line as a JSON string> names no git version; aidlc needs git 2.45 or newer` when it names none; the line never changes doctor's exit code. No code that runs git changes: on an older git `baseSync` still reads `UNREADABLE` and a finding still gets no identity."

### 4. The OPERATIONS sentence
`On exit 0 the `git` value is the line as `gitVersionLine` (`src/probes/git.ts`) reads it: as printed for 2.45 or newer, followed by `(UNSUPPORTED: aidlc needs git 2.45 or newer)` for an older version, and `UNREADABLE: <the line as a JSON string> names no git version; aidlc needs git 2.45 or newer` for a line that names none (card T1-GIT-MIN-VERSION).`

## Amendment (owner, 2026-11-25)
PR 454 (T0-DOCTOR-PROBE-TIMEOUT) moved the doctor `git` line from src/cli/main.ts to `toolchainReport` (src/probes/toolchain.ts), which also gives `unknown: git --version did not exit within <n> ms`. The owner chose in the session of 2026-11-25 to apply `gitVersionLine` there, on exit 0 only, with `MISSING` and the `unknown: ` text as on main. Changed: allow_paths, the DoD command, R2, acceptance 5, acceptance 6 (new), one forbid entry and one row of the revert table. The sweep describes main at 2ef2bbf4.

Second amendment, same day and session: the OPERATIONS paragraph that PR 454 added says each value is the first output line on exit 0, which this card changes for `git`. The owner allowed one added sentence (R5, acceptance detail 4). Changed: allow_paths, R5 (new), acceptance 5 and one forbid entry.

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | tests/infra/git-min-version.test.ts, acceptance 1 (12 rows) | RED at ca392875, passes |
| 2 | Same file, acceptance 2, on WSL Ubuntu with Node 22.23.1; skipped on Windows | passes before the repair of F1 and again after it |
| 3 | tests/infra/github-ship.test.ts, T0-SHIP-BASE-SYNC-2 acceptance 8 | RED at ca392875, passes |
| 4 | base-sync, stray-processes, git, prose and templates test files, no line changed | pass |
| 5 | git diff origin/main: README.md one line, toolchain.ts imports, the git value and its comment, OPERATIONS.md one sentence, the fragment; src/cli/main.ts unchanged | read |
| 6 | tests/infra/toolchain-probe.test.ts, T1-GIT-MIN-VERSION acceptance 6 | RED at ca392875, passes |

The WSL git is 2.43.0, the version the substitute git prints, so acceptance 2 there does not show that the substitute answered.

Revert table: versions compared as text (1 red); minor without major (1 red); `>=` made `>` (1 red); unreadable branch dropped (1 and 6 red); wiring dropped (6 red); README line put back (3 red).

Repair of F1 (R3 decision 1): `line` and `probe` are as on main, and the git value alone calls `gitVersionLine`. Receipts the repair handles: exit 0 (acceptance 6, rows 1 and 2); another exit code (row 3); a timeout with exit 0 (row 4). A runner that throws rejects the report, as on main. Dropping the exit check or the timeout check turns acceptance 6 red.

Full suite on Windows before the OPERATIONS sentence and the repair: 4255 tests, 4222 pass, 0 fail, 33 skipped.

## PR summary

### What
The README states git 2.45 as the one supported minimum. The git line of `aidlc doctor` marks an older version.

### Why / Intent
The README named 2.38, but two reads use an option that git first accepts in 2.45. The owner chose one minimum on 2026-11-17.

### How / Behaviour
`gitVersionLine` keeps a supported line and adds `UNSUPPORTED` to an older one. A line that names no version reads `UNREADABLE`. The `MISSING` and `unknown` values stay as they were.

### System impact
Only the text of one doctor line changes. No code that runs git changes.

### Security
The change reads one line of text and starts no new process.

### Tests and review
One new test file and one new test cover each row of the rule. R3 blocked decision 1 on scope, and the repair restores the shared helpers.

### Risk
Low. A version line in an unusual form reads `UNREADABLE` and changes no exit code.

### Ownership
The owner approved two amendments of this card on 2026-11-25.

### Docs
The README, one OPERATIONS sentence and a changelog fragment state the change.
