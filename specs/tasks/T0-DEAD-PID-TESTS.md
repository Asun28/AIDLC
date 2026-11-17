---
id: T0-DEAD-PID-TESTS
title: The tests that need the pid of a gone process take one that no process can hold, from one shared helper, instead of the pid of an exited child that Windows can hand to another process before the code under test looks it up (issue 312)
status: todo
superseded_by: T0-DEAD-PID-TESTS-2
branch: T0-DEAD-PID-TESTS
worktree: D:\wt\AIDLC\T0-DEAD-PID-TESTS
allow_paths:
  - tests/infra/dead-pid.ts
  - tests/infra/dead-pid.test.ts
  - tests/scenarios/review-release.test.ts
  - tests/scenarios/journal-lock-refusal.test.ts
  - specs/tasks/T0-DEAD-PID-TESTS.md
dod_command: npm run typecheck && node --test tests/infra/dead-pid.test.ts tests/scenarios/review-release.test.ts tests/scenarios/journal-lock-refusal.test.ts
dod_exit: 0
requirements:
  - R1. A new module tests/infra/dead-pid.ts shall export one function that returns a process id no process can hold on the platforms this repository supports: a positive integer at most 2**31-1 (the `MAX_PID` of src/coordination/review-queue.ts, so `review release` reads it as a usable pid) and above every pid those platforms hand out (Linux `pid_max` is at most 2**22, macOS hands out pids below 100000, and Windows pids stay far below 2**31). Its comment shall state those bounds and why the value cannot name a live process.
  - R2. tests/scenarios/review-release.test.ts (its `deadPid` helper) and tests/scenarios/journal-lock-refusal.test.ts (the `gone` pid of test (b)) shall take their dead pid from that function and no longer spawn a child for it. No assertion of either file changes, and no other line of either file changes beyond the import and the helper.
acceptance:
  - 1. tests/infra/dead-pid.test.ts - the returned pid is an integer above 2**22 and at most 2**31-1; `processAlive` (src/state/store.ts) reports it dead; `process.kill(pid, 0)` throws with code `ESRCH`; two calls return a pid with the same properties. [R1] [dod arm 1]
  - 2. tests/scenarios/review-release.test.ts and tests/scenarios/journal-lock-refusal.test.ts pass, each run three times in a row in one DoD-like loop recorded in the attempt evidence; `git grep -n "spawnSync(process.execPath, \['-e', ''\])" -- tests` returns nothing; `git diff origin/main -- tests/scenarios/review-release.test.ts tests/scenarios/journal-lock-refusal.test.ts` changes only the import and the helper or variable that produced the pid. [R2] [dod arm 1]
depends_on: []
budget: 80
tdd: false
sweep: "git grep -n \"spawnSync(process.execPath, \\['-e', ''\\])\" -- tests: tests/scenarios/review-release.test.ts:28 (deadPid, used by every release row) and tests/scenarios/journal-lock-refusal.test.ts:120 (test (b)). grep -rn 'processAlive' src: the readers of a pid's liveness are review-queue.ts:307 (release refusal) and store.ts:218, 320, 325 (stale lock and temp detection); the helper's pid must read as dead to each."
forbid: [weakening or skipping a test to go green, a change to src/, a liveness seam in production code, a change to any assertion of the two test files]
non_goals: [the case of the key in ReviewQueue (issue 304), the timing tests of tests/infra/exec.test.ts (issue 341)]
diagnosis:
  root_cause: "`deadPid()` (tests/scenarios/review-release.test.ts:27) returns the pid of a child that has just exited, and journal-lock-refusal.test.ts:120 does the same. Windows reuses process ids quickly, so by the time the CLI child of the test checks the pid with `process.kill(pid, 0)`, another process can hold it, the owner reads as alive and `review release` refuses: acceptance 6 of review-release failed once on 2026-11-14 on a run of that file alone and passed on every other run of the same commit."
  same_class: "Every test that names a gone process by the pid of an exited child: the two sites of the sweep."
hygiene: "Issue 312, found during card T0-RELEASE-0-2-0. tdd false: a test-only change to how two tests name a gone process; the failure it removes is a pid reuse race on Windows that no deterministic RED reproduces, so acceptance 1 pins the helper's properties instead. No behaviour of aidlc changes, so no changelog fragment."
doc_sync: none
---

# T0-DEAD-PID-TESTS

## Deliverable
The two tests that need a gone process name it by a pid no process can hold, from one helper, so a fast pid reuse on Windows can no longer make the owner read as alive.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/dead-pid.test.ts tests/scenarios/review-release.test.ts tests/scenarios/journal-lock-refusal.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.
