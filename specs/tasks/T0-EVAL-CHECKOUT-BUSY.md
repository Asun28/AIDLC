---
id: T0-EVAL-CHECKOUT-BUSY
title: "A model-backed eval removes its temporary checkout and state directory once a process that still holds them exits, waiting up to 10 seconds, instead of leaving them on Windows"
status: todo
superseded_by: T0-EVAL-CHECKOUT-BUSY-2
branch: T0-EVAL-CHECKOUT-BUSY
worktree: D:\wt\AIDLC\T0-EVAL-CHECKOUT-BUSY
allow_paths:
  - src/evals/runner.ts
  - tests/surface/evals.test.ts
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-EVAL-CHECKOUT-BUSY.md
dod_command: npm run typecheck && node --test tests/surface/evals.test.ts
dod_exit: 0
requirements:
  - R1. `src/evals/runner.ts` shall export a function that removes one directory. It calls the remove (default `rmSync` with `recursive` and `force`); when the remove throws an error whose code is `EBUSY`, `EPERM` or `ENOTEMPTY`, it waits 200 ms and calls the remove again, until a call succeeds or 10000 ms have passed on the clock since the first call. An error with any other code, or a busy error at or after 10000 ms, ends the calls. It returns whether the directory is gone. The remove, the clock and the wait are parameters with defaults (`rmSync`, `Date.now`, a synchronous wait); a first call that succeeds makes no wait.
  - R2. `closeWorkspace` shall remove the checkout's holder directory and the state directory with the R1 function, each with its own 10000 ms, and report what is left in the result's `detail` as before this card.
  - R3. `docs/OPERATIONS.md` (the paragraph on the temporary checkout in the Evals section) and the CHANGELOG Unreleased section shall state R1 and R2.
acceptance:
  - 1. `tests/surface/evals.test.ts`: the R1 function with a remove that throws `EBUSY` twice and then succeeds, a fixed clock and a recording wait returns true after three calls and two waits of 200 ms. Fails before the fix. [R1] [dod arm 1]
  - 2. Same file: with a remove that always throws `EBUSY` and a clock that advances 200 ms per wait, it returns false and its last call is the first at or after 10000 ms; with a remove that throws `EACCES`, it returns false after one call and no wait; with a remove that succeeds, one call and no wait. [R1] [dod arm 1]
  - 3. Same file: a model-backed case whose provider starts a detached process with its working directory in the temporary checkout, exiting 1500 ms after the provider returns: after `runEval` the holder directory does not exist, `git worktree list` does not name the checkout, and the result's `detail` names nothing left. Fails before the fix on Windows, where the working directory of a running process cannot be removed (EBUSY); on other platforms it passes before the fix too. [R2] [dod arm 1]
  - 4. The docs and the CHANGELOG state R1 and R2 (reviewer-verified against the diff). [R3]
depends_on: []
budget: 120
tdd: true
diagnosis:
  root_cause: "`closeWorkspace` (src/evals/runner.ts:321 at 19b0da8) removes the holder with one `rmSync(w.holder, { recursive: true, force: true })` (:338) and the state directory with another (:352), and swallows the error. On Windows a directory that is a running process's working directory cannot be removed (EBUSY), so a process the provider started that outlives the provider call, or another open handle, leaves the directory, reported as `checkout ... not removed`. `rmSync`'s own `maxRetries` does not help: on Node 22.23.1, `rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })` threw EBUSY after 1 ms."
  repro: "VERIFY-ARC of goal g-20261107095106-c08940 on 2026-11-09 (main 81c9a48): `aidlc evals run --dir evals/agent --provider claude-code` left C:\\Users\\Admin\\AppData\\Local\\Temp\\aidlc-eval-PlSffg\\checkout as an empty directory (files and worktree entry removed), case agent-add-test-reads-tdd-skill. Probe on 2026-11-10 (Node 22.23.1, Windows 11): a detached `node -e \"setTimeout(()=>{}, 1500)\"` with its cwd in a temporary directory; one `rmSync` of the directory 300 ms later threw EBUSY and removed nothing; a loop of `rmSync` with a 200 ms wait removed it at the 8th try, 1447 ms later."
  same_class: "`unlinkSync` of the node_modules link (:326) and `git worktree remove --force` (:335) are not retried: the link is removed before the holder and a failed `git worktree remove` is followed by the R1 removal and `git worktree prune`. `cleanup` in tests/infra/helpers.ts (maxRetries: 3) has the same limit; it is best-effort test cleanup and stays."
sweep: "grep -n 'rmSync\\|closeWorkspace' src/evals/runner.ts. A synchronous wait already exists as `sleepSync` in src/state/store.ts:209 (`Atomics.wait`). Lines are from main at 19b0da8; read them again at PREPARE."
forbid: [weakening or skipping a test, a wait that runs when the first removal succeeds, removing anything outside the holder or the state directory, editing .aidlc state by hand]
non_goals: [ending processes the provider left, a retry for the node_modules link or `git worktree add`, the eval tests' own temporary directories (T0-EVAL-TEST-TEMP), the evals README wording]
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-EVAL-CHECKOUT-BUSY

## Deliverable
A model-backed eval case on Windows leaves no empty `aidlc-eval-*\checkout` directory when a process the provider started exits within 10 seconds of the provider call.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/evals.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
RED receipt: `79511eb:1`. At 79511eb, where `removeDir` makes one remove call with no retry, `node --test tests/surface/evals.test.ts` runs 31 tests, 28 pass, 3 fail, each on its assertion: acceptance 1 got 1 call, no wait and false (expected 3 calls, waits [200, 200], true), acceptance 2 with an always-EBUSY remove got 1 call at t=0 (expected 51 calls at t=0, 200, ..., 10000), and acceptance 3 on Windows got the holder directory present and `detail` `checkout ...\aidlc-eval-uMUNIh\checkout not removed`; the EACCES and succeeding-remove cases of acceptance 2 pass there, since they pin behaviour the stub already has.

| Item | Proof | Result |
| --- | --- | --- |
| 1 | tests/surface/evals.test.ts `T0-EVAL-CHECKOUT-BUSY acceptance 1`: a remove throwing EBUSY twice then returning, a clock fixed at 0 and a recording wait: `removeDir` returns true after 3 calls and waits [200, 200] | pass |
| 2 | Same file, three `acceptance 2` tests: always EBUSY with a clock advancing 200 ms per wait returns false with calls at t=0, 200, ..., 10000 (51 calls, the last the first at or after 10000) and 50 waits of 200 ms; EACCES returns false after 1 call and no wait; a succeeding remove returns true after 1 call and no wait | pass |
| 3 | Same file, `acceptance 3`: a model-backed case whose provider spawns a detached `node -e "setTimeout(()=>{},1500)"` with its cwd in the temporary checkout: after `runEval` the case passes, the holder directory does not exist, `git worktree list --porcelain` does not name the checkout and `detail` has no `not removed` (test duration 2150 ms on Windows, so the removal waited for the child) | pass |
| 4 | docs/OPERATIONS.md, Evals, the temporary-checkout paragraph: the retry on EBUSY, EPERM or ENOTEMPTY every 200 ms for up to 10 s per directory, the Windows cause, and that only a directory still present after that is named in `detail`; CHANGELOG.md Unreleased entry `T0-EVAL-CHECKOUT-BUSY (bugfix)` states R1 and R2 | reviewer |
| DoD | `npm run typecheck && node --test tests/surface/evals.test.ts`: exit 0, `# tests 31`, `# pass 31`, `# fail 0`; also `node --test tests/surface/eval-test-temp.test.ts tests/surface/command-lines.test.ts`: exit 0, 16 pass, 0 fail, and tests/surface/templates.test.ts with claude-md-size.test.ts: 42 pass, 0 fail | pass |
