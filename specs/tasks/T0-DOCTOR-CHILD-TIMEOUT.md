---
id: T0-DOCTOR-CHILD-TIMEOUT
title: Every test spawn of the real aidlc doctor that reaches its toolchain probes gives the child 120 s, where init-no-package.test.ts and cli-cwd-paths.test.ts gave 60 s, so the cold first start of the probes on a Windows CI runner no longer fails the test that runs first in its shard (issue 365)
status: merged
branch: T0-DOCTOR-CHILD-TIMEOUT
worktree: D:\wt\AIDLC\T0-DOCTOR-CHILD-TIMEOUT
allow_paths:
  - tests/surface/init-no-package.test.ts
  - tests/surface/cli-cwd-paths.test.ts
  - specs/tasks/T0-DOCTOR-CHILD-TIMEOUT.md
dod_command: npm run typecheck && node --test tests/surface/init-no-package.test.ts tests/surface/cli-cwd-paths.test.ts
dod_exit: 0
requirements:
  - R1. In tests/surface/init-no-package.test.ts, `doctorLine` (line 228) shall spawn `aidlc doctor --json` with `timeout: 120_000` in place of `timeout: 60_000`. Every other option of that call, the other `spawnSync` calls of the file (lines 115 and 127) and every assertion stay as they are.
  - R2. In tests/surface/cli-cwd-paths.test.ts, the `run` helper of each of the two fixtures (line 73 and line 153), which run every CLI command of the file and among them each `doctor` call at lines 284, 621, 662, 671 and 686, and the `doctor` helper of the test "every child starts without the GIT_ variables of the test process, and repository discovery stops at the ceiling" (line 298) shall spawn with `timeout: 120_000` in place of `timeout: 60_000`. The `spec validate` call at line 314, the `goal new` call at line 853, every other option and every assertion stay as they are.
acceptance:
  - 1. `git diff origin/main -- tests` changes exactly four lines, each replacing `timeout: 60_000` with `timeout: 120_000` and nothing else on the line - tests/surface/init-no-package.test.ts:228 and tests/surface/cli-cwd-paths.test.ts:73, :153 and :298; `git diff --name-only origin/main...HEAD` names only the allow_paths; no line under src/, .github/ or docs/ changes (reviewer-verified against the diff). [R1] [R2] [dod arm 1]
  - 2. After the change every `spawnSync` of the real CLI with `doctor` in tests/ that lets doctor reach its toolchain probes gives the child at least 120 000 ms - init-no-package.test.ts:228 and cli-cwd-paths.test.ts:73, :153 and :298 (this card), base-sync.test.ts:181, stray-processes.test.ts:601 and doctor-interrupted-writes.test.ts:427 and :502 (already 120 000) - and tests/surface/config.test.ts:315 and :376 keep 60 000, because each doctor run of that file exits 1 at the configuration check before the probes (src/cli/main.ts:308; the assertions at config.test.ts:318-323 and :401-418 require that exit). Reviewer-verified with `grep -n "'doctor'" tests -r` and the call sites. [R1] [R2] [dod arm 1]
  - 3. Every test of tests/surface/init-no-package.test.ts and tests/surface/cli-cwd-paths.test.ts passes with no assertion changed, and the typecheck is clean (the DoD). [R1] [R2] [dod arm 1]
depends_on: []
budget: 40
tdd: false
sweep: "Main at 0e14f387. `grep -rn \"'doctor'\" tests` finds the spawns of the real `aidlc doctor`: tests/infra/base-sync.test.ts:181 (120_000), tests/infra/stray-processes.test.ts:601 (120_000), tests/surface/doctor-interrupted-writes.test.ts:427 and :502 (120_000), tests/surface/init-no-package.test.ts:228 (60_000), tests/surface/config.test.ts:315 and :376 (60_000), and tests/surface/cli-cwd-paths.test.ts:284, :621, :662, :671 and :686 through the fixture `run` helpers at :73 and :153 (60_000) and :298 (60_000). tests/surface/hooks.test.ts names `doctor` only as a production pattern in configuration text and spawns no doctor. `timeout: 60_000` also appears at init-no-package.test.ts:115 (`aidlc init`) and :127 (the written hook command), and at cli-cwd-paths.test.ts:314 (`spec validate`) and :853 (`goal new`); none of them runs doctor or its probes. The doctor action (src/cli/main.ts:302-350) builds the context first, where a configuration error ends it with exit 1 (:308), then runs `git --version`, `gh --version` and `pwsh -v` through `probe`, which has no timeout (:310-318), beside the provider check and `strayProcessesReport` (:324); `strayProcessesReport` returns `n/a (not a git repository)` before it lists any process when the target is not a git repository (src/probes/processes.ts:305)."
forbid:
  - weakening, skipping or deleting a test to go green, or changing an assertion
  - a change under src/, .github/ or docs/, or to CHANGELOG.md or README.md
  - a change to a timeout other than the four lines of R1 and R2, or to tests/surface/config.test.ts, tests/infra/base-sync.test.ts, tests/infra/stray-processes.test.ts or tests/surface/doctor-interrupted-writes.test.ts
  - a new test file, a new shared helper or constant, or any other refactor of the two files
non_goals:
  - "doctor's `git`, `gh` and `pwsh` probes and the `git` calls of `ctx()` have no time bound, so a tool that never exits holds doctor without end (reproduced on WSL with a stub that never exits; exit 124 at a 30 s guard for each of the three); a product defect, issue 371"
  - a CI step that starts `gh` before the tests; it hides the cost on CI only and changes .github/workflows
  - the cold start itself (the first start of a binary on a new runner); it is outside aidlc
  - rebalancing the CI shards
  - tests/surface/config.test.ts, whose doctor runs end before the probes
diagnosis:
  root_cause: "On a Windows CI runner the first `aidlc doctor` of the job that reaches its toolchain probes takes 17-32 s, and every later one about 1 s. Over the 11 latest ci runs the first acceptance 6 row of init-no-package.test.ts took 0.8, 16.8, 17.1, 17.9, 18.2, 21.1, 23.0, 23.0 and 32.5 s, and the full 60 s in run 44074492771 (attempt 1, shard 4), while each later doctor row of the same runs took 0.7-4.5 s. In shard 4 the only earlier doctor run (config.test.ts) exits at the configuration check before the probes, so that row is the first probe run of the job. The cost is paid once per runner by a binary that nothing earlier in the job starts; `gh` is the likely one, since the job's own steps run in pwsh and no step or earlier test starts `gh`. `doctorLine` gave the child 60 s, less than twice that cost, and contention in the shard pushed one first run past it. The process listing named in the issue does not run in that row: the target is not a git repository."
  same_class: "Any test spawn of the real doctor that reaches the probes pays the cost when the shard split makes it the first such run of its job. tests/surface/cli-cwd-paths.test.ts (fixture `run` helpers at :73 and :153 and the `doctor` helper at :298, 60 s) is fixed here; in shard 2 of runs 44270781001 and 44074492771 its doctor tests took 3.1-16.4 s, after earlier doctor runs of that shard. base-sync.test.ts:181, stray-processes.test.ts:601 and doctor-interrupted-writes.test.ts:427 and :502 already give 120 s. config.test.ts:315 and :376 stop before the probes."
hygiene: "Issue 365. tdd false: the failure is a cold start under shard contention, which no deterministic RED reproduces (precedent T0-STRAY-LISTING-LOAD, issue 359); acceptance 2 pins the rule over every doctor spawn. Measured locally (Windows 11, a loaded machine): one doctor in the row 1 target took 4-11 s (context 1.1-3.8 s, probes 1.3-4.9 s, exit 1.6-4.3 s), and the linked-worktree row of acceptance 6, two doctor runs in git repositories, took 68 s. 120 000 is the value the three other doctor-spawning files use. No behaviour of aidlc changes, so no changelog fragment."
doc_sync: none
---

# T0-DOCTOR-CHILD-TIMEOUT

## Deliverable
The tests that spawn the real `aidlc doctor` and let it reach its toolchain probes give the child 120 s, as three other doctor-spawning test files already do, so the first doctor run of a Windows CI job, which pays a one-time 17-32 s cold start, does not fail on a 60 s limit.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/init-no-package.test.ts tests/surface/cli-cwd-paths.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Evidence for the diagnosis
| Item | Source | Result |
|---|---|---|
| First acceptance 6 doctor row per run | Windows shard logs, attempt 1, 11 latest ci runs | 0.8, 16.8, 17.1, 17.9, 18.2, 21.1, 23.0, 23.0, 32.5 s and 60.0 s (run 44074492771); later rows 0.7-4.5 s |
| Earlier doctor runs in shard 4 | runs 44270781001 and 44074492771 | config.test.ts only (0.9 s and 1.5 s), which exits before the probes |
| Process listing in the failing row | src/probes/processes.ts:305 | not run: the target is not a git repository |
| A tool that never exits | WSL, stub first on PATH, `timeout 30` | doctor still running at 30 s for `pwsh`, `gh` and `git` (issue 371) |
