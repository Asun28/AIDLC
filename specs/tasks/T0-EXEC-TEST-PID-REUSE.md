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
| 1 | exec.test.ts, "T0-EXEC-TEST-PID-REUSE acceptance 1" | RED at 842bb7f4: "the cleanup ended a process it did not start", after 13.1 s; passes on the candidate |
| 2 | exec.test.ts, "T0-EXEC-TEST-PID-REUSE acceptance 2", two tests | the first fails at 842bb7f4; both pass on the candidate |
| 3 | base-sync.test.ts, "the message of a doctor child that did not exit 0", three rows | all three fail at 842bb7f4 and pass on the candidate; the doctor helper passes the same text to its assertion (read) |
| 4 | `git diff origin/main -- tests`, read line by line | the wait and the cleanup of the root change in the two tests of R1, and calibrate ends its root through the ChildProcess; no other assertion, timeout or bound changes |

Both files before the two last corrections, Windows 11: 98 pass, 0 fail, 1 skipped. Candidate, WSL Ubuntu, Node 24.3.0: 89 pass, 0 fail, 1 skipped.

Guards: 11 mutants run one at a time with the card's tests, all red. They cover the skip in `end`, what `probe` records (two), the clear between tests, the wait (three), the cleanup, the end of the root at the limit, and the signal and error code of the message.

Diagnosis probes on Windows 11: a child ended by another process gave status 1, signal null and empty output; a process started in the next 8 s received the pid of an ended process in 2 of 8 trials with four parallel starters, and in 0 of 8 trials of 60 sequential starts.

The test files change by 99 lines added and 37 deleted, 136 against the declared budget of 130, which is advisory on this ship path.

## PR summary

### What
The process tests no longer signal a pid that they saw gone. The doctor test reports how its child ended.

### Why / Intent
Issue 488 reports a doctor exit of 1 with an empty stderr. A test cleanup could end another process through a reused pid.

### How / Behaviour
The calibrate tests wait for and end their root through its ChildProcess. The `end` helper skips each pid that the same test saw gone.

### System impact
Only two test files change. The product code does not change.

### Security
The change has no security effect. Tests send fewer signals to processes that they did not start.

### Tests and review
A new test gives the cleanup the pid of a live process. It fails on main and passes here.

### Risk
Low. A pid can still change owner between the last check and the signal.

### Ownership
The owner asked for issue 488 on 2026-11-25. The cause of the one CI failure is inferred and not proven.

### Docs
No document changes.
