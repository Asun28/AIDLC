---
id: T0-EVAL-CHECKOUT-BUSY-2
title: "A model-backed eval removes its temporary checkout and state directory once a process that still holds them exits, waiting up to 10 seconds on an awaited timer, instead of leaving them on Windows"
status: todo
branch: T0-EVAL-CHECKOUT-BUSY-2
worktree: D:\wt\AIDLC\T0-EVAL-CHECKOUT-BUSY-2
allow_paths:
  - src/evals/runner.ts
  - tests/surface/evals.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-EVAL-CHECKOUT-BUSY.md
  - specs/tasks/T0-EVAL-CHECKOUT-BUSY-2.md
dod_command: npm run typecheck && node --test tests/surface/evals.test.ts tests/infra/update-json.test.ts
dod_exit: 0
requirements:
  - R1. `src/evals/runner.ts` shall export an async function that removes one directory. It calls the remove (default `rmSync` with `recursive` and `force`); when the remove throws an error whose code is `EBUSY`, `EPERM` or `ENOTEMPTY`, it awaits the wait of 200 ms and calls the remove again, until a call succeeds or 10000 ms have passed on the clock since the first call. An error with any other code, or a busy error at or after 10000 ms, ends the calls. It resolves to whether a remove call returned without throwing. The remove, the clock and the wait are parameters with defaults (`rmSync`, `Date.now`, and a wait that resolves after a `setTimeout` of the given milliseconds); a first call that succeeds makes no wait. `src/evals/runner.ts` shall contain neither `Atomics.wait` nor `sleepSync`, which T1-STORE-CAS-2 acceptance 2 (tests/infra/update-json.test.ts:192) allows only in src/state/store.ts and the ship's CI poll.
  - R2. `closeWorkspace` shall be async and shall remove the checkout's holder directory and the state directory with the R1 function, each with its own 10000 ms, and report what is left in the result's `detail` as before this card; `runEval` shall await it on every path that calls it today.
  - R3. `docs/OPERATIONS.md` (the paragraph on the temporary checkout in the Evals section) and the CHANGELOG Unreleased section shall state R1 and R2.
acceptance:
  - 1. `tests/surface/evals.test.ts`: the R1 function with a remove that throws `EBUSY` twice and then succeeds, a fixed clock and a recording wait resolves to true after three calls and two waits of 200 ms. [R1] [dod arm 1]
  - 2. Same file: with a remove that always throws `EBUSY` and a clock that advances 200 ms per wait, it resolves to false and its last call is the first at or after 10000 ms; with a remove that throws `EACCES`, it resolves to false after one call and no wait; with a remove that succeeds, one call and no wait. [R1] [dod arm 1]
  - 3. Same file: a model-backed case whose provider starts a detached process with its working directory in the temporary checkout, exiting 1500 ms after the provider returns: after `runEval` the holder directory does not exist, `git worktree list` does not name the checkout, and the result's `detail` names nothing left. On Windows, where the working directory of a running process cannot be removed (EBUSY), it fails without the retry; on other platforms it passes without it. [R2] [dod arm 1]
  - 4. `tests/infra/update-json.test.ts` passes: `Atomics.wait` and `sleepSync` appear in src only where T1-STORE-CAS-2 acceptance 2 allows them. Fails at the carried candidate 6f16f88 of T0-EVAL-CHECKOUT-BUSY. [R1] [dod arm 2]
  - 5. The docs and the CHANGELOG state R1 and R2 (reviewer-verified against the diff). [R3]
depends_on: []
budget: 140
tdd: true
diagnosis:
  root_cause: "`closeWorkspace` (src/evals/runner.ts:321 at 19b0da8) removes the holder with one `rmSync(w.holder, { recursive: true, force: true })` (:338) and the state directory with another (:352), and swallows the error. On Windows a directory that is a running process's working directory cannot be removed (EBUSY), so a process the provider started that outlives the provider call, or another open handle, leaves the directory, reported as `checkout ... not removed`. `rmSync`'s own `maxRetries` does not help: on Node 22.23.1, `rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })` threw EBUSY after 1 ms. The predecessor T0-EVAL-CHECKOUT-BUSY waited with `Atomics.wait` (candidate 6f16f88, PR 251), which passed its DoD and R3 but failed CI on Linux and Windows in T1-STORE-CAS-2 acceptance 2 (tests/infra/update-json.test.ts:200): `Atomics.wait` may appear only in src/state/store.ts and src/delivery/github-ship.ts. The card stopped with STOP/ci."
  repro: "VERIFY-ARC of goal g-20261107095106-c08940 on 2026-11-09 (main 81c9a48): `aidlc evals run --dir evals/agent --provider claude-code` left C:\\Users\\Admin\\AppData\\Local\\Temp\\aidlc-eval-PlSffg\\checkout as an empty directory (files and worktree entry removed), case agent-add-test-reads-tdd-skill. Probe on 2026-11-10 (Node 22.23.1, Windows 11): a detached `node -e \"setTimeout(()=>{}, 1500)\"` with its cwd in a temporary directory; one `rmSync` of the directory 300 ms later threw EBUSY and removed nothing; a loop of `rmSync` with a 200 ms wait removed it at the 8th try, 1447 ms later. PR 251 CI (run 42761883327): acceptance 3 passed on windows-latest with the retry."
  same_class: "`unlinkSync` of the node_modules link (:326) and `git worktree remove --force` (:335) are not retried: the link is removed before the holder and a failed `git worktree remove` is followed by the R1 removal and `git worktree prune`. `cleanup` in tests/infra/helpers.ts (maxRetries: 3) has the same limit; it is best-effort test cleanup and stays. The other synchronous waits in src are `sleepSync` in src/state/store.ts (lock retry) and the CI poll sleep in src/delivery/github-ship.ts; neither changes."
sweep: "grep -n 'rmSync\\|closeWorkspace\\|removeDir' src/evals/runner.ts; grep -rn 'Atomics.wait\\|sleepSync' src tests. The branch carries T0-EVAL-CHECKOUT-BUSY from 6f16f88 (RED 79511eb:1). Lines are from main at 19b0da8; read them again at PREPARE."
forbid: [weakening or skipping a test, an exception added to T1-STORE-CAS-2 acceptance 2, `Atomics.wait` or a busy loop as the wait, a wait that runs when the first removal succeeds, removing anything outside the holder or the state directory, editing .aidlc state by hand]
non_goals: [ending processes the provider left, a retry for the node_modules link or `git worktree add`, the eval tests' own temporary directories (T0-EVAL-TEST-TEMP), the evals README wording]
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-EVAL-CHECKOUT-BUSY-2

## Deliverable
A model-backed eval case on Windows leaves no empty `aidlc-eval-*\checkout` directory when a process the provider started exits within 10 seconds of the provider call, and the wait is an awaited timer.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/evals.test.ts tests/infra/update-json.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.
