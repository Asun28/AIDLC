---
id: T0-EXEC-TEST-PID-REUSE
title: The process tests of tests/infra/exec.test.ts never signal a pid they have seen gone, and the doctor assertion of tests/infra/base-sync.test.ts names how its child ended (issue 488)
status: todo
branch: T0-EXEC-TEST-PID-REUSE
worktree: D:\wt\AIDLC\T0-EXEC-TEST-PID-REUSE
allow_paths:
  - tests/infra/exec.test.ts
  - tests/infra/base-sync.test.ts
  - specs/tasks/T0-EXEC-TEST-PID-REUSE.md
dod_command: npm run typecheck && node --test tests/infra/exec.test.ts tests/infra/base-sync.test.ts
dod_exit: 0
requirements:
  - R1. The two calibrate tests that end a root at the time limit shall wait for that root, and end it in their cleanup, through the ChildProcess that started it and never through the pid in `<pidFile>.root`.
  - R2. The `end` helper shall send no signal to a pid that `probe` has reported as ESRCH earlier in the same test.
  - R3. The `doctor` helper of tests/infra/base-sync.test.ts shall fail with a message that holds the exit status, the signal, the spawn error code, stdout and stderr of its child.
acceptance:
  - 1. exec.test.ts, new test - a root that writes the pid of a live bystander process to `<pidFile>.root` is ended at the limit, the wait for the root passes, and the bystander is alive after the cleanup. Fails before the fix (the wait times out on the bystander and the cleanup ends it). [R1] [dod arm 2]
  - 2. exec.test.ts, new test - after `probe` reports ESRCH for a pid through an injected kill, `end` with a recording kill records no call for it, and records one SIGKILL for a pid not reported gone; a new test starts with no pid recorded as gone. [R2] [dod arm 2]
  - 3. base-sync.test.ts, new test - the message for a child ended by another process (status 1, signal null, empty output), for one ended by the spawn timeout and for one that cannot start holds each field of R3. [R3] [dod arm 2]
  - 4. No existing assertion, timeout or bound of either file changes except the wait for the root in the two tests of R1, and no test is skipped, retried or deleted (reviewer-verified against the diff). [R1] [R2] [R3]
depends_on: []
budget: 130
tdd: true
forbid:
  - a change under src/, .github/ or docs/, or to tests/infra/exec-tree.child.ts
  - weakening, skipping, retrying or deleting a test, or raising a timeout
non_goals:
  - a pid reused between the last look at it and the signal, which no pid-only check can exclude
  - the messages of the other tests that spawn doctor, and the pid cleanup of tests/scenarios/dod-record.test.ts
  - a claim that this pid reuse is proven to be the cause of the one CI failure of issue 488
diagnosis:
  root_cause: "Inferred, not proven. The cleanup of `a child that writes its own pid to <pidFile>.root` sends SIGKILL to the pid in a file about 8 s after calibrate ended that root. A child ended by another process gives spawnSync status 1, signal null and empty output (probed on Windows), which is what the doctor child of run 45558139815 shows. Both files were in shard 4. In that job pid 10144 was alive through the 3 s wait after the root was ended, which fits a reused pid, and the cleanup then signalled it. Reconstructed from durations, that signal and the end of doctor are within about 2 s. Windows gave the pid of an ended process to a new one within 8 s in 2 of 8 trials under parallel starts. Run 44988608692 has the same exec failure (pid 8444) with no other failed test."
  same_class: "Cleanups of exec.test.ts that signal a pid read from a file - calibrate, both calibrate root tests, raceFixture, the runner-handle test, the sync tree test and the 64 MiB test; R2 covers those that saw the pid gone."
hygiene: "Issue 488. Test-only, so no changelog fragment (precedent T0-EXEC-READY-MARGIN). Stop any bystander process in the test's own finally, through its ChildProcess."
doc_sync: none
---

# T0-EXEC-TEST-PID-REUSE

## Deliverable
Tests in `tests/infra/exec.test.ts` do not end a process of another test through a reused pid, and the next doctor failure in `tests/infra/base-sync.test.ts` names how its child ended.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/exec.test.ts tests/infra/base-sync.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence
| Item | Check | Result |
|---|---|---|
