---
id: T0-STRAY-LISTING-LOAD
title: The real-listing test of stray-processes.test.ts runs the real process listing with a 60 s timeout while asserting that listProcesses asked for the production 10 s budget, so contention in a CI shard no longer fails it (issue 359)
status: todo
branch: T0-STRAY-LISTING-LOAD
worktree: D:\wt\AIDLC\T0-STRAY-LISTING-LOAD
allow_paths:
  - tests/infra/stray-processes.test.ts
  - specs/tasks/T0-STRAY-LISTING-LOAD.md
dod_command: npm run typecheck && node --test tests/infra/stray-processes.test.ts
dod_exit: 0
requirements:
  - R1. In tests/infra/stray-processes.test.ts, the runner of the test "the real listing shows this process and leaves it out of the report" shall pass the call to the real `run` with `timeoutMs` set to 60 000 and every other option unchanged, and shall assert that the `timeoutMs` `listProcesses` passed to it equals `PROCESS_LIST_TIMEOUT_MS` (src/probes/processes.ts). Every other assertion and line of that test, and every other test of the file, stay as they are.
acceptance:
  - 1. tests/infra/stray-processes.test.ts - the real-listing test passes; its runner records the `timeoutMs` it received and the test asserts it equals `PROCESS_LIST_TIMEOUT_MS`; with the override removed the test still passes on an idle machine (the override changes no assertion), and with the `PROCESS_LIST_TIMEOUT_MS` assertion changed to another value the test fails. [R1] [dod arm 1]
  - 2. `git diff origin/main -- tests/infra/stray-processes.test.ts` changes only lines inside the runner of that test and adds the one assertion and its import; no line under `src/` changes. [R1] [dod arm 1]
depends_on: []
budget: 40
tdd: false
sweep: "grep -n \"the real listing shows this process\" tests/infra/stray-processes.test.ts: the test (line 562) wraps the real `run` and calls `listProcesses`, which passes `PROCESS_LIST_TIMEOUT_MS` (10 000, src/probes/processes.ts:12) as `timeoutMs`. grep -n 'test-shard' .github/workflows/ci.yml: the Windows suite is split by `--test-shard=<k>/4` over `tests/**/*.test.ts`; on main the file is in shard 2 of 210 files, and one more file sorting before it moves it to shard 3, where PRs 355 and 356 timed out at 10072 ms and 10181 ms. The scripted rows of the same file pin the budget and the timeout text."
forbid: [weakening or skipping a test to go green, a change under src/, a change to the production budget, a change to any other test of the file, a change to .github/workflows]
non_goals: [the time budget of `aidlc doctor` on a loaded machine, rebalancing the CI shards, the timing tests of tests/infra/exec.test.ts (issue 341)]
diagnosis:
  root_cause: "The real-listing test runs PowerShell's CIM listing under the production budget of 10 s. In the CI shard a PR moves it into by adding one earlier test file, the listing ran past that budget, so `listProcesses` returned `unknown: the process listing timed out after 10000 ms` and the test failed on code it does not change. The test asserts the listing's shape, not its time, which the scripted rows already pin."
  same_class: "Every test that runs a real external helper under a production timeout inside a CI shard: tests/infra/exec.test.ts tree-kill rows (issue 341, calibrated, out of scope)."
hygiene: "Issue 359. tdd false: the failure is CPU contention in a CI shard, which no deterministic RED reproduces locally; acceptance 1 pins the budget the code asks for. Blocks the CI of cards T0-DEAD-PID-TESTS, T0-REVIEW-QUEUE-KEY-2 and T0-ENV-CASE, each of which adds a test file that moves this file to shard 3. No behaviour of aidlc changes, so no changelog fragment."
doc_sync: none
---

# T0-STRAY-LISTING-LOAD

## Deliverable
The real-listing test gives the real PowerShell listing 60 s, while still asserting that the code asked for the 10 s production budget, so a busy CI shard cannot fail it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/stray-processes.test.ts
```
- Expected exit code: 0
- Assertion: every listed test passes and the typecheck is clean.

## Attempt evidence
| Item | Check | Result |
|---|---|---|
| 1 | Attempt 2 (R3 decision 1 F1: the assertion moved inside the runner, no declaration outside it). `node --test --test-name-pattern "the real listing shows" tests/infra/stray-processes.test.ts` as committed; then with the runner's `assert.equal(options?.timeoutMs, ...)` expected value changed to `60_000`; then with the runner calling `run(command, args, options)` (override removed); each change restored | pass 1/1 (listing 4436 ms); with 60_000: fail 1/1, the runner throws, `listProcesses` returns `unknown: the process listing failed (no exit code)` and `assert.ok(Array.isArray(rows), String(rows))` fails (that string is not the early-return string, so no platform skips the failure); override removed: pass 1/1 (1878 ms) on an idle machine |
| 2 | `git diff origin/main -- tests/infra/stray-processes.test.ts`; `git diff --name-only origin/main...HEAD` | test file: the import gains `PROCESS_LIST_TIMEOUT_MS`; inside the runner, `assert.equal(options?.timeoutMs, PROCESS_LIST_TIMEOUT_MS)` before the call and `run` called with `{ ...options, timeoutMs: 60_000 }`; no other line changes; names: only the two allow_paths; no change under `src/` |
| DoD | `npm run typecheck && node --test tests/infra/stray-processes.test.ts` | exit 0; tsc clean; tests 22, pass 21, fail 0, skipped 1 (pre-existing POSIX-only row) |
