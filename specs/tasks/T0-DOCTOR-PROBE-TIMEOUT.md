---
id: T0-DOCTOR-PROBE-TIMEOUT
title: "aidlc doctor reports a git, gh or pwsh version probe that does not exit within 120 s as unknown, and the repository lookup of ctx() ends a git rev-parse that does not exit within 120 s with an error that names it"
status: todo
branch: T0-DOCTOR-PROBE-TIMEOUT
worktree: D:\wt\AIDLC\T0-DOCTOR-PROBE-TIMEOUT
allow_paths:
  - src/probes/toolchain.ts
  - src/cli/main.ts
  - src/state/paths.ts
  - tests/infra/toolchain-probe.test.ts
  - tests/infra/git-lookup-timeout.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-DOCTOR-PROBE-TIMEOUT.md
  - specs/tasks/T0-DOCTOR-PROBE-TIMEOUT.md
dod_command: npm run typecheck && node --test tests/infra/toolchain-probe.test.ts tests/infra/git-lookup-timeout.test.ts tests/infra/paths.test.ts tests/surface/doctor-interrupted-writes.test.ts tests/surface/cli-cwd-paths.test.ts tests/surface/module-map.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `src/probes/toolchain.ts`, a new file, shall export `TOOLCHAIN_PROBE_TIMEOUT_MS = 120_000` and `toolchainReport(runner = run, timeoutMs = TOOLCHAIN_PROBE_TIMEOUT_MS)`, which runs `git --version`, `gh --version` and `pwsh -v` concurrently through `runner`, each with `{ timeoutMs }`, and resolves to `{ git, gh, pwsh }`.
  - R2. Each value shall be, for a receipt with `timedOut` true, `unknown: <command> <args> did not exit within <timeoutMs> ms`; else, for exit code 0, the first line of the trimmed stdout followed by stderr, as doctor prints today; else the MISSING text doctor prints today for that tool (`MISSING`, `MISSING (needed for remote ship)`, `MISSING (needed for scaffold ship path)`).
  - R3. The doctor action of `src/cli/main.ts` shall take its `git`, `gh` and `pwsh` lines from `toolchainReport()` with its defaults, started in the same `Promise.all` as the other probes, and keep no probe of its own.
  - R4. `src/state/paths.ts` shall export `GIT_LOOKUP_TIMEOUT_MS = 120_000` and `gitOut(args, cwd, spawner = spawnSync, timeoutMs = GIT_LOOKUP_TIMEOUT_MS)`, which passes `timeout: timeoutMs` to `spawner` beside the options of main, and throws an `Error` with the message `git <args> did not exit within <timeoutMs> ms in <cwd>` when the result's error has the code `ETIMEDOUT`; every other result is read as on main. `resolveRepoIdentity` shall call it with its defaults.
  - R5. `docs/OPERATIONS.md` (a paragraph beside the doctor lines), `docs/ARCHITECTURE.md` (the `src/probes/` paragraph) and `changelog.d/T0-DOCTOR-PROBE-TIMEOUT.md` shall state both bounds, the unknown line and the error.
acceptance:
  - 1. `tests/infra/toolchain-probe.test.ts`, real process. A runner that hands each call to `run` with the node binary and a script that never exits in place of the tool, and `timeoutMs` 500, resolves within 15 s to the three unknown lines of R2 (`unknown: git --version did not exit within 500 ms`, and so on); the started processes are no longer running afterwards (`process.kill(pid, 0)` throws). RED on main's probe rule moved into the file (no timeout), where the test's own 20 s timeout fails it. [R1] [R2] [dod arm 2]
  - 2. Same file, a scripted async runner. The calls are exactly the three of R1 with `{ timeoutMs }`, the default being `TOOLCHAIN_PROBE_TIMEOUT_MS` (120000); exit 0 with output on stdout, and on stderr only, gives its first line; a non-zero exit and a spawn error give each tool's MISSING text; `timedOut` true gives the unknown line also beside exit code 0. [R1] [R2] [dod arm 2]
  - 3. `tests/infra/git-lookup-timeout.test.ts`, real process. `gitOut` with a spawner that runs the node binary with a script that never exits, with the options it receives, and `timeoutMs` 500, throws within 15 s an `Error` whose message is `git rev-parse --show-toplevel did not exit within 500 ms in <cwd>`. A recording spawner sees `timeout: 120000` by default and the `cwd`, `encoding: 'utf8'` and `windowsHide: true` of main; a result with status 0 returns the trimmed stdout, status 1 and an `ENOENT` error return undefined. RED on main's `gitOut` exported with the seam, where the call does not end and the test's 20 s timeout fails it. [R4] [dod arm 3]
  - 4. The doctor and repository tests pass with no change: `tests/infra/paths.test.ts`, `tests/surface/doctor-interrupted-writes.test.ts`, `tests/surface/cli-cwd-paths.test.ts`; doctor prints the version lines of the real tools. [R3] [R4] [dod arms 4, 5, 6]
  - 5. The wiring of R3 and the call of R4 in `resolveRepoIdentity`, and the text of R5 (reviewer-verified against the diff); the module map names `src/probes/toolchain.ts`; the fragment has the form of `changelog.d/README.md` and the prose test passes. [R3] [R4] [R5] [dod arms 1, 7, 8, 9]
depends_on: []
budget: 220
tdd: true
sweep: "On main at fcc91cd8. `git grep -n -E 'spawnSync\\(|spawn\\(' -- src/cli/main.ts src/state/paths.ts`: the doctor probe (main.ts:329), the `script` command's `pwsh` (main.ts:963, inherits stdio, interactive, non_goals), `gitOut` (paths.ts:40) and `prefetchRepoIdentity` (paths.ts:122, non_goals). `git grep -n -E 'MISSING \\(needed|probe\\(' -- src tests docs`: the three MISSING texts stand only in main.ts:346-348; no test or doc pins them. `git grep -n resolveRepoIdentity -- src`: ctx(), resolveStatePaths, evals/runner.ts, hooks/index.ts (184, 653, 726) and main.ts:1327, all through `gitOut`. Doctor lines are documented in docs/OPERATIONS.md:41-45; `src/probes/` in docs/ARCHITECTURE.md:20."
forbid: [network, a change to an existing test file]
non_goals:
  - "`prefetchRepoIdentity` (the hook entry's asynchronous `git rev-parse`, awaited by `settleRepoIdentity`), which keeps no bound; a follow-up issue"
  - "the `pwsh` of the scaffold `script` command (main.ts:963), which inherits the terminal and runs as long as the operator lets it"
  - "a doctor exit code for an unknown line: no toolchain line changes doctor's exit code, as on main"
diagnosis:
  root_cause: "The doctor probe (src/cli/main.ts:326-334; 310-318 in the issue) spawns each tool and waits for `close` with no timer, and `gitOut` (src/state/paths.ts:40) calls `spawnSync` with no `timeout`, so a tool that starts and never exits holds doctor, and every command that resolves the repository, forever. Issue 371 reproduced it under `timeout 30` with a stub of each tool first on PATH: exit 124 for `pwsh`, `gh` and `git`, the `git` row inside ctx() before the probes."
  same_class: "The process listing beside the probes is bounded (`PROCESS_LIST_TIMEOUT_MS`, through `run`). `baseSyncReport` and `doctorWorkingTree` run git through their own runners; out of scope here. The two unbounded calls left are in non_goals."
hygiene: "Issue 371, found under issue 365. The bound is 120 s because the first doctor of a Windows CI job takes 17-32 s, once past 60 s (lesson of T0-DOCTOR-CHILD-TIMEOUT); a shorter bound would turn a cold start into an unknown line. The tests pass 500 ms through the seams; the never-exiting child makes the RED independent of scheduling."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, changelog.d/T0-DOCTOR-PROBE-TIMEOUT.md
---

# T0-DOCTOR-PROBE-TIMEOUT

From issue 371.

## Diagnosis
Doctor's three version probes and the `git rev-parse` of the repository lookup wait for the child with no bound. A tool that starts and never exits holds the session with no message.

## Deliverable
The probes move to `toolchainReport` in `src/probes/toolchain.ts` and run through `run`, which ends the tool's process tree at 120 s and reports it as unknown, not as MISSING. `gitOut` passes a 120 s timeout to `spawnSync` and throws an error that names the command, the bound and the directory, which the CLI prints as it prints any error.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/toolchain-probe.test.ts tests/infra/git-lookup-timeout.test.ts tests/infra/paths.test.ts tests/surface/doctor-interrupted-writes.test.ts tests/surface/cli-cwd-paths.test.ts tests/surface/module-map.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the new tests pass, the doctor and repository tests pass unchanged, and the changelog fragment is well formed.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/toolchain-probe.test.ts`, test `acceptance 1: ...`. RED at 52f69504, where the probe runs with no bound and reads no `timedOut`: the three lines read MISSING. The test's runner ends the child at 10 s when the probe passes no bound, so main's rule fails the assertion inside the 20 s test timeout instead of leaving three processes running | pass after the fix |
| 2 | Same file, test `acceptance 2: ...`: the three calls and their options, the default bound, stdout and stderr-only output, three failures, `timedOut` beside exit 0, 1 and null. RED at 52f69504: the options were undefined | pass |
| 3 | `tests/infra/git-lookup-timeout.test.ts`, both tests. RED at 52f69504: no exception (main returns undefined), and the options had no `timeout`. The spawner ends the child at 10 s when `gitOut` passes no bound, for the reason of item 1 (a synchronous call cannot be ended by the test timeout) | pass |
| 4 | The DoD: `paths`, `doctor-interrupted-writes`, `cli-cwd-paths`; `node bin/aidlc.js doctor` in the worktree prints the git, gh and pwsh versions | pass |
| 5 | `src/cli/main.ts` doctor action, `resolveRepoIdentity`, the docs and the fragment; `module-map`, `changelog-fragments`, `prose` | reviewer-verified; pass |
