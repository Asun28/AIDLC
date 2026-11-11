---
id: T0-EXEC-TEST-LOAD
title: The process-tree tests of tests/infra/exec.test.ts calibrate a scale from the fixture's start-up and multiply main's timeout and bounds by it, equal to main at scale 1, and fail with a named precondition when the fixture was not ready before the timeout
status: todo
branch: T0-EXEC-TEST-LOAD
worktree: D:\wt\AIDLC\T0-EXEC-TEST-LOAD
size_exception: "approved by the coordinator as planner and approver of the audit changes under the owner's (asun28) instructions of 2026-11-11 and 2026-11-12: the planner's redesign of 2026-11-12 (a calibrated scale in place of the retry design of the first draft, which reached about 1100 lines); about 225 changed lines in tests/infra/exec.test.ts (about 105 of the calibration, scale, bounds, preconditions and child environment, 70 of the six changed tests and their titles, 50 of the two new tests), 2 in CHANGELOG.md and about 60 of attempt evidence: about 290; raised from 290 to 370 by the coordinator on 2026-11-12: the candidate cbf6c338 is 288 changed lines before the loaded-run evidence, the coordinator's verification block and the rows the planner asked for after the build report (calibrate's exit-code, signal, spawn-error and time-limit clauses each get a row through optional parameters of calibrate)"
allow_paths:
  - tests/infra/exec.test.ts
  - CHANGELOG.md
  - specs/tasks/T0-EXEC-TEST-LOAD.md
dod_command: npm run typecheck && node --test tests/infra/exec.test.ts
dod_exit: 0
requirements:
  - R1. `calibrate(t, fixture = FIXTURE, ended: number[] = [])` (new, tests/infra/exec.test.ts) shall start `process.execPath` on `[fixture, 'exit', pidFile]` (the fixture's existing exit mode) with `stdio: 'ignore'`, `windowsHide: true` and `env: fixtureEnv(dir)`, `dir` from `tmpDir('aidlc-exec-calibrate-')` of tests/infra/helpers.ts removed by `cleanup` in a `t.after` hook, and no tree kill; it returns the milliseconds from the `Date.now()` taken just before the spawn to the root's `exit` event. It returns undefined when the spawn emits `error`, the root exits with a code other than 0 or with a signal, no exit comes within `CALIBRATION_LIMIT_MS` (30 000 ms; the root is then ended), or the sleeper's pid file is missing at the exit. Before it returns, in every case, it ends the sleeper whose pid file exists with `end`, verifies it with `assertGoneWithin(sleeper, 3000)` and pushes its pid to `ended`.
  - R2. `CALIBRATION_BASE_MS` shall be 750 and `SCALE_MAX` 8, and `scaleFor(measured)` (new) shall return `Math.min(SCALE_MAX, Math.max(1, Math.ceil(measured / CALIBRATION_BASE_MS)))` for a finite number at or above 0 (so 0 to 750 give 1, 751 gives 2, 4325 gives 6, 5250 gives 7, every value above 5250 gives 8), and throw `calibration failed: <String(measured)>` for undefined, NaN, a negative number and both infinities, so a failed or missing measurement fails the test and never defaults to 1.
  - R3. `boundsAt(scale)` (new) shall return the numbers of the six tests: `timeoutMs` 1500 times the scale; `stayBoundMs` 6000 times the scale; `exitCloseMs` 1500 times the scale plus `TIMEOUT_GRACE_MS`; `noKillBoundMs` (1500 + 1000) times the scale plus `TIMEOUT_GRACE_MS`; `slowKillBoundMs` (1500 + 1000) times the scale plus `SLOW_KILL_MS` (1500, main's `slowMs`) plus `TIMEOUT_GRACE_MS`; `goneWithinMs` 3000 times the scale; `syncBoundMs` the smaller of 6000 times the scale and `timeoutMs + TIMEOUT_GRACE_MS + TREE_HELPER_BACKSTOP_MS`. At scale 1 these are main's literals (exec.test.ts :229 and :442 1500; :286, :297, :307 6000; :314 3500; :323 4500; :348 6000; :291 and :452 3000; :444 6000). `TIMEOUT_GRACE_MS`, `TREE_HELPER_BACKSTOP_MS`, `SLOW_KILL_MS` and the lower bound `waited >= 2000 - 50` (:352) are not scaled. What each number bounds and why scaling it keeps the proof: body section Acceptance detail, item 3.
  - R4. Two preconditions (new) shall each be the first assertion of the check that depends on it, each throwing `fixture not ready before the timeout at scale <scale>: the machine got slower after calibration (<detail>)`. `assertSleeperExisted({ sleeperWrittenMs, startedMs }, timeoutMs, scale)` passes when the modification time of the sleeper's pid file is a number at most `startedMs + timeoutMs`, the earliest time the timer can fire, and else throws with the detail `no sleeper pid file` or `the sleeper's pid file was written <n> ms after the call, the timeout was <timeoutMs> ms`; the file is written by the sleeper itself, so a time before the deadline shows that the sleeper process existed, and so was in the tree, before the timeout fired; it is asserted by acceptance 3, the no-kill case of acceptance 5 and the runSync test. `assertRootGone(aliveAtCall, scale)` passes when no call of the recording tree kill found the root alive (`probe(pid) === 'alive'` at the call) and else throws with the detail `the tree kill found the root still running`; it is asserted by the exit case of acceptance 4 before `assert.deepEqual(calls, [])`, which the recorded failures hit. The stay case of acceptance 4 and the slow-kill case assert neither: their assertions do not depend on the sleeper. No run is repeated.
  - R5. The six tests (T0-EXEC-TREE-KILL acceptance 3, both cases of acceptance 4, both cases of acceptance 5 at :285-354, and acceptance 1 of T0-EXEC-SYNC-TREE-KILL-2 at :434-458, which supersedes T0-EXEC-SYNC-TREE-KILL) shall each start with `calibratedBounds(t)` (new: `calibrate`, `scaleFor`, `t.diagnostic('calibration <m> ms, scale <s>')`, `boundsAt`) and use its numbers in place of main's literals; every other assertion of main stays as it is. `raceFixture` (:218-243) gains a fifth parameter `timeoutMs` (default `TIMEOUT_MS`, so its self-test at :270-283 is unchanged) passed to the runner in place of `TIMEOUT_MS`, and `FixtureRun` gains `startedMs` (the `started` it already takes) and `sleeperWrittenMs` (the pid file's modification time, undefined when missing); `delegatingTreeKill` (:246-249) also records `aliveAtCall`; the slow-kill test's `slowMs` (:339) becomes `SLOW_KILL_MS`. The titles that state a number change as the detail table of item 3 gives.
  - R6. `fixtureEnv(dir, from = process.env)` (new) shall return `from` without every variable whose upper-cased name starts with `GIT_` or is `NODE_OPTIONS` or `AIDLC_STATE_DIR`, plus `GIT_CEILING_DIRECTORIES` (the parent of `dir` and the parent of `realpathSync.native(dir)` joined with `path.delimiter`) and `AIDLC_STATE_DIR` (`<dir>/state`); the spawn of R1, the one spawn this card adds, uses it. The six tests' fixture runs keep main's environment: their spawn changes only its timeout. These tests launch Node fixtures, shells and platform kill helpers; no git or aidlc command.
  - R7. Nothing else shall change: no file under src/; tests/infra/exec-tree.child.ts unchanged (the exit mode serves the calibration); the runner-handle test (:357-385), which keeps `TIMEOUT_MS` and the fixture's own 1500 ms, the overflow test (:663-689), the timeout refusal tests (:694-730), the doc test acceptance 7 (:415-428) and every other test of the file unchanged; the existing temporary-directory sites keep main's form.
  - R8. CHANGELOG.md, Unreleased, shall carry the entry of acceptance detail 5.
acceptance:
  - 1. `tests/infra/exec.test.ts` "the calibrated scale and the scaled bounds on each input class": scaleFor, boundsAt (scale 1 equal to main's literals, scales 4 and 8), both preconditions and fixtureEnv, each row with its exact result or message. Fails on the seam of hygiene. [R2] [R3] [R4] [R6] [dod arm 1] Detail: body section Acceptance detail, item 1.
  - 2. Same file, "calibrate times the exit fixture and ends its sleeper, and returns undefined when the fixture cannot start". Fails on the seam. [R1] [R2] [R6] [dod arm 1] Detail: body section Acceptance detail, item 2.
  - 3. Same file: the six changed tests pass under the titles of the detail, each calibrating first, with main's assertions against the numbers of `boundsAt` and the preconditions of R4 first. Passes on main (at scale 1 every number is main's) and with this card. [R3] [R4] [R5] [R7] [dod arm 1] Detail: body section Acceptance detail, item 3.
  - 4. The attempt evidence holds the runs of the detail alone and under load, on main and on the candidate, with their counts and the reported scales (reviewer-verified). [R5] Detail: body section Acceptance detail, item 4.
  - 5. The CHANGELOG entry is the text of the detail (reviewer-verified against the diff). [R8]
depends_on: []
budget: 370
tdd: true
diagnosis:
  root_cause: "The process-tree tests of tests/infra/exec.test.ts give the command a fixed `timeoutMs` of 1500 (:167), whose timer starts when the runner spawns the fixture's root, and fixed bounds counted from the call, and assume the fixture is ready before the timer fires: in stay mode the sleeper exists, in exit mode the root has exited. The T0-EXEC-TREE-KILL hygiene says the fixture polls for the pid file 'so the timeout never fires before the tree exists', which holds only while node, the shell and the sleeper start within 1.5 s. Under CPU load they do not: the exit-mode root exited 4.0 to 4.3 s after its spawn, so at 1500 ms `exited` was false and `createRun` called the tree kill with the root's pid, as R1 of T0-EXEC-TREE-KILL requires, and the exit test failed at `assert.deepEqual(calls, [])` (:311), the assertion of every recorded failure of that test. The runSync test's 6000 ms (:444) includes the start of the tree helper (2.0 s under load) and of the fixture, and the no-kill test's 4500 ms (:323) the spawn and the lateness of two timers. No product race: in every probe run the root was alive at the tree-kill call and each receipt resolved by the bound R3 of T0-EXEC-TREE-KILL states."
  repro: "C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-drafts-9\\timing.ts with load.sh 24 55 (24 CPU-bound node processes, Windows 11, 16 logical CPUs, Node 22.23.1): exit mode with 1500 ms called the tree kill at 1631 and 1770 ms with the root alive, the runSync test returned after 7772 and 6197 ms; a copy of the file under load.sh 16 45 failed only the exit test, with `calls` [49540]. Numbers in the body section Measurements."
  same_class: "Every test of the file that starts the fixture with a timer: acceptance 3, both cases of 4 and both cases of 5 of T0-EXEC-TREE-KILL and acceptance 1 of T0-EXEC-SYNC-TREE-KILL-2, fixed here; the stay cases passed under load only while taskkill.exe was slow enough for a late sleeper to write its pid before it was killed, and with 24 processes one stay run had no sleeper pid at all. The runner-handle test (:357-385) counts its 6500 ms from the start of its own runner process, which includes a node start, and its fixture mode keeps 1500 ms: a non-goal. The 64 MiB overflow test (:663-689) floods only after the sleeper's pid file exists and has a 15 s bound against a 20 s timeout, and the other real-process tests (:12-50, :460-530, :694-713) time a 300 ms timeout or a command's own end: not this class. Two other files failed under load in the coordinator's runs of 2026-11-12, tests/scenarios/mutants-review.test.ts and tests/surface/review-bench.test.ts: a follow-up, not this card."
sweep: "On main at 37ce711f (no file this card reads or changes but CHANGELOG.md changed since 46eb7980). git grep -n 'raceFixture(\\|TIMEOUT_MS\\b\\|6000\\|3000\\|4500\\|boundMs\\|slowMs' -- tests/infra/exec.test.ts: :167 TIMEOUT_MS (kept: the default of raceFixture and the runner-handle test); :218-243 raceFixture (R5); :229 the runner's timeout (R5); :282 its self-test (unchanged); :286-354 the five tests through raceFixture and their numbers (R3, R5); :359-384 the runner-handle test (unchanged); :434-458 the sync test (R3, R5); :663-730 the overflow and refusal tests (unchanged). git grep -n 'exec-tree.child' -- tests src: only exec.test.ts:166 starts the fixture, whose exit mode (:46-56) the calibration uses. Timing sentences of earlier cards this card restates as scaled test bounds: T0-EXEC-TREE-KILL acceptance 3 and 4 ('within 6 s of the call'), acceptance 5 ('no later than 1500 ms plus TIMEOUT_GRACE_MS (2000) plus 1000 ms of test slack after the call') and its hygiene ('so the timeout never fires before the tree exists'); T0-EXEC-SYNC-TREE-KILL-2 acceptance 1 ('returns within 6 s of the call'). No document states a bound of these tests: the OPERATIONS, ARCHITECTURE and CHANGELOG sentences of T0-EXEC-TREE-KILL and T0-EXEC-SYNC-TREE-KILL describe the runner and stay true."
forbid:
  - weakening, skipping or deleting a test or an assertion of main to go green; at scale 1 every number and assertion of the six tests is main's
  - scaling `TIMEOUT_GRACE_MS`, `TREE_HELPER_BACKSTOP_MS`, the slow kill's duration or the lower bound of the slow-kill case
  - a run repeated, a retry loop, or a default scale when the calibration failed
  - any change under src/ or to tests/infra/exec-tree.child.ts
  - a new mkdtempSync call
  - editing the runner-handle test, the overflow test, the timeout refusal tests or the doc test acceptance 7 of the file
  - editing .aidlc state by hand
non_goals:
  - the runner-handle test of T0-EXEC-TREE-KILL acceptance 5 (:357-385)
  - a guarantee against a burst of load after the calibration (the precondition then names it)
  - tests/scenarios/mutants-review.test.ts and tests/surface/review-bench.test.ts, which also failed under load on 2026-11-12 (a follow-up)
  - moving the file's temporary directories to tmpDir (card T0-TEST-TEMP-SWEEP)
  - a bound free of the tree kill's own run time (the stay and sync bounds keep it inside their slack, a known limit)
hygiene: "Line numbers are from main at 37ce711f; read them again at PREPARE. Tests first, in two commits: the seam commit adds the tests of acceptance 1 and 2 and the helpers they call with main's behaviour (`calibrate` returns 0 without spawning, `scaleFor` returns 1, `boundsAt` returns main's literals for every scale, the preconditions pass), and RED is their rows failing; the second commit gives the helpers their behaviour and moves the six tests onto them. Evidence (acceptance 4), each run of `node --test tests/infra/exec.test.ts` recorded with its pass and fail counts, the failing titles and, on the candidate, the `calibration <m> ms, scale <s>` diagnostics: five runs alone and three under load, on main and on the candidate; each loaded run starts `bash C:\\Users\\Admin\\AppData\\Local\\Temp\\claude\\ba6303180ca8049b\\eb02f3fb-6d6a-4a44-870b-34d780644c33\\scratchpad\\probe-drafts-9\\load.sh 24 150` (24 node processes, each looping on `Date.now()` for 150 s and ending on its own) and the test run together. Run the changed file on Linux as well as Windows before the first R3 (lesson 2026-11-11 T0-DIRTY-SUCCESS-2). The calibration adds about 0.4 s per changed test without load; under 24 processes a test takes about 4 s more for the calibration and waits a timeout up to six times longer. Insert the CHANGELOG entry directly above the entry that begins `- T0-BOARD-OWNER-WAIT`, followed by a blank line; T0-UNRESOLVED-NARRATION uses the same anchor and its acceptance 8 asserts that its entry is directly above `- T0-BOARD-OWNER-WAIT`: when it has merged first, insert this entry directly above the T0-UNRESOLVED-NARRATION entry instead, so that adjacency holds; when this card merges first, its entry ends up above theirs. T0-TEST-TEMP-SWEEP (todo) edits the same file and migrates its mkdtempSync sites to tmpDir; the later of the two merges main first. The dod_command is the targeted DoD: the typecheck and the changed test file; before the first review the coordinator runs every test file that reads CHANGELOG.md and records the counts in the Attempt evidence; the full suite runs in CI. No file of the verify-card-run-writes coverage changes. Implementer: Sonnet 5.5 at medium effort. If a run shows the runner itself breaking R1 to R3 of T0-EXEC-TREE-KILL (a tree kill by the pid of a root whose exit was observed, a receipt past its bound), stop and report: that is a product race and a different card."
doc_sync: CHANGELOG.md
---

# T0-EXEC-TEST-LOAD

## Deliverable
Each process-tree test of tests/infra/exec.test.ts first times the fixture's exit mode from spawn to exit and turns that time into a scale from 1 to 8; the fixture timeout and the test's bounds are main's values times that scale, with the product's own constants unchanged. On a machine that is not slow the scale is 1 and every number is main's. When the fixture was still not ready before the timeout, the test fails with a message that says so instead of the kill-call assertion.

## Why
Audit of 2026-11-11, hygiene item H6, the first of the two fixes it named ("make the bound scale or wait on the root's exit"); the coordinator decides and plans. The first draft (a retry design) was reviewed by Codex on 2026-11-12 and replaced by this design at about a quarter of its size; its workflow part is card T0-CI-PERMISSIONS. Three coordinator runs of about 80 test files in parallel on 2026-11-12 each failed tests/infra/exec.test.ts, which passed 61 of 61 alone; the logs of 14 such runs since 2026-11-11 hold 13 failures of the exit case of acceptance 4, two of the sync acceptance 1 and one of the no-kill case of acceptance 5.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/exec.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes. This is the targeted DoD; every test file that reads CHANGELOG.md runs at the coordinator's checkpoint before the first review.

## Measurements
Windows 11, 16 logical CPUs, Node 22.23.1, main at 46eb7980, probes in the scratchpad directory probe-drafts-9 (copies of src/probes/exec.ts, the helper, the fixture and the test file; nothing written in the repository). Load: `load.sh <n> <s>`, n node processes each running `while (Date.now() < end) {}` for s seconds.

| Measure | Alone | 24 processes |
|---|---|---|
| exit mode, spawned without a runner timeout: root's first write, sleeper ready, root's exit event (ms after spawn; the calibration measures the last) | 168-248, 360-396, 393-432 | 1704-1997, 3702-3750, 3969-4325 |
| exit mode with timeout 1500: tree-kill calls | none | at 1631 and 1770 ms, root alive both times |
| stay mode with timeout 1500: sleeper ready, tree kill call, taskkill.exe run time | 291-420, 1518-1624, 988-1054 ms | one run no pid file (kill at 1520 ms), one at 3270 ms after the kill call at 1638 ms (taskkill 3670 ms) |
| no-kill: kill call after `startedAt`, receipt after the kill | 1526-1553, 2003-2015 ms | 1522-1732, 2118-2146 ms |
| runSync killTree: elapsed, helper start, root's first write, sleeper ready, taskkill (ms from the call) | 2938-3038, 137-243, 368-772, 620-1356, 990-1267 | 6197-7772, 1974-2007, 4052-4093, 5607-6194, 2516-3700 |

Recorded failures (coordinator logs in the scratchpad directory): the exit case of acceptance 4 at `assert.deepEqual(calls, [])` with one root pid in 13 logs (for example docpins-T0-DOCTOR-INTERRUPTED-WRITES.txt:1773-1800, `[101728]`); the sync acceptance 1 `runSync returned after 6940 ms` and `7190 ms, past the 6000 ms bound` (docpins-T0-DOCTOR-INTERRUPTED-WRITES.txt:1857, docpins-T0-JOURNAL-APPEND-LOCK.txt:1857); the no-kill case `receipt after 4578 ms, past the 4500 ms bound` (T0-CLI-CWD-FILE-ARGS.docpins.txt:1785). A copy of the file under 16 processes: the exit case failed with `calls` [49540], acceptance 3 took 4965 ms and the sync test 5526 ms.

Constants from these figures. `CALIBRATION_BASE_MS` 750: the slowest quiet calibration (432 ms) gives scale 1, and a quiet calibration may grow to 750 ms (1.74 times) before scale 2. Under 24 processes the calibrations of 3969 and 4325 ms give scale 6, a timeout of 9000 ms: 2.1 times the exit-mode root's exit (4325 ms), 2.4 times the stay sleeper's readiness (3750 ms) and 1.45 times the latest sync sleeper readiness counted from the call (6194 ms); the stay bound leaves 4500 ms times 6 (27 000 ms) after the timeout for the tree kill, whose slowest run was 3700 ms, and the sync bound at scale 6 is 26 000 ms (the helper's backstop) against about 14 700 ms (2.0 s helper start, 9 s timeout, 3.7 s taskkill). In general the timeout is at least twice the calibration (1500 times `ceil(m / 750)` is at least `2m`). `SCALE_MAX` 8: the stay bound at the cap, 48 000 ms, stays below the sleeper's 60 000 ms life (exec-tree.child.ts:24), so a receipt that waited for the sleeper still fails at every scale; the cap is reached from a calibration above 5250 ms, 1.2 times the heaviest measured.

## Acceptance detail

### 1
`describe('T0-EXEC-TEST-LOAD the calibrated scale [R2] [R3] [R4] [R6]')`, test "the calibrated scale and the scaled bounds on each input class". No process; messages compared whole (`assert.throws(f, { message: '<exact>' })`).
- `scaleFor`: 0, 432, 750 give 1; 751 gives 2; 3969 and 4325 give 6; 5250 gives 7; 5251, 6000, 6001 and 60000 give 8; undefined, NaN, -1, Infinity and -Infinity throw `calibration failed: undefined`, `calibration failed: NaN`, `calibration failed: -1`, `calibration failed: Infinity`, `calibration failed: -Infinity`.
- `boundsAt(1)` deep-equals `{ timeoutMs: 1500, stayBoundMs: 6000, exitCloseMs: 3500, noKillBoundMs: 4500, slowKillBoundMs: 6000, goneWithinMs: 3000, syncBoundMs: 6000 }`, main's literals; `boundsAt(4)` gives, key by key in that order, 6000, 24000, 8000, 12000, 13500, 12000 and 23000 (the sync bound is the backstop from scale 4); `boundsAt(8)` gives 12000, 48000, 14000, 22000, 23500, 24000 and 29000, and its `stayBoundMs` is below 60000.
- `assertSleeperExisted` with `startedMs` 1000 and `timeoutMs` 3000 at scale 2: `sleeperWrittenMs` undefined throws `fixture not ready before the timeout at scale 2: the machine got slower after calibration (no sleeper pid file)`; 4000 passes; 4001 throws `fixture not ready before the timeout at scale 2: the machine got slower after calibration (the sleeper's pid file was written 3001 ms after the call, the timeout was 3000 ms)`.
- `assertRootGone` at scale 3: `[]` and `[false]` pass; `[true]` and `[false, true]` throw `fixture not ready before the timeout at scale 3: the machine got slower after calibration (the tree kill found the root still running)`.
- `fixtureEnv(dir, from)` with `dir` from `tmpDir` (removed by `cleanup` in an `after` hook) and `from` = `{ GIT_DIR: 'a', git_work_tree: 'b', Git_Config_Global: 'c', GIT_CEILING_DIRECTORIES: 'd', NODE_OPTIONS: 'e', node_options: 'f', AIDLC_STATE_DIR: 'g', aidlc_state_dir: 'h', PATH: 'p', KEEP: 'k' }` deep-equals `{ PATH: 'p', KEEP: 'k', GIT_CEILING_DIRECTORIES: [dirname(dir), dirname(realpathSync.native(dir))].join(delimiter), AIDLC_STATE_DIR: join(dir, 'state') }`.
Each clause removed fails a row: `round` or `floor` for `ceil` (751, 5251), no lower clamp (0), no cap (6001, 60000), the cap above 8 (60000), a default for a failed measurement (each throwing row), the grace or the backstop scaled (`boundsAt(4)`), the sync `min` removed (`boundsAt(4)`, `boundsAt(8)`), `<` for `<=` in the sleeper precondition (4000), `some` for `every` in the root precondition (`[false, true]`), a case-sensitive environment filter (the lower-case rows).

### 2
Same describe, test "calibrate times the exit fixture and ends its sleeper, and returns undefined when the fixture cannot start" with `(t)`: `calibrate(t, FIXTURE, ended)` returns a finite number above 0, `ended` holds one pid, and `probe` of that pid gives `ESRCH` afterwards; `calibrate(t, join(<a tmpDir>, 'missing.ts'))` returns undefined (node exits 1), and `scaleFor` of that value throws `calibration failed: undefined`. On the seam the first call returns 0, so the row asking for a number above 0 fails.

### 3
The six changed tests. Each starts with `const b = await calibratedBounds(t)`; `b.scale` goes into the preconditions. Every assertion of main stays; the numbers below replace main's literals.

| Test (main line) | Title with this card | Numbers | Precondition first |
|---|---|---|---|
| acceptance 3, `run` (:285) | `acceptance 3: run on the stay fixture with timeoutMs 1500 times the calibrated scale resolves within 6 s times that scale, timed out and not ok, and the sleeper is gone` | timeout `b.timeoutMs`; bound and message `b.stayBoundMs`; `assertGoneWithin(sleeper, b.goneWithinMs)` | `assertSleeperExisted` |
| acceptance 4 stay (:295) | unchanged | timeout `b.timeoutMs`; bound and message `b.stayBoundMs` | none |
| acceptance 4 exit (:305) | `acceptance 4: in exit mode (the root gone, the sleeper holding its output) the tree kill is never called and the receipt resolves within 6 s times the calibrated scale, timed out` | timeout `b.timeoutMs`; bound `b.stayBoundMs`; `elapsedMs < b.exitCloseMs` (main `TIMEOUT_MS + 2000`) | `assertRootGone(aliveAtCall)` before `deepEqual(calls, [])` |
| acceptance 5 no kill (:320) | `acceptance 5: with a tree kill that kills nothing, the receipt resolves by (1500 + 1000) ms times the calibrated scale + TIMEOUT_GRACE_MS (2000), timed out, exitCode and signal null, root and sleeper still alive` | timeout `b.timeoutMs`; bound `b.noKillBoundMs`; `assert.equal(TIMEOUT_GRACE_MS, 2000)` stays | `assertSleeperExisted` |
| acceptance 5 slow kill (:338) | unchanged | timeout `b.timeoutMs`; bound `b.slowKillBoundMs`; `slowMs` 1500 and `waited >= 2000 - 50` unchanged | none |
| sync acceptance 1 (:435) | `acceptance 1: on the stay fixture with timeoutMs 1500 times the calibrated scale returns within 6 s times that scale and before the helper's backstop, timed out and not ok, with the caller's command, args and cwd, and the sleeper is gone` | `timeoutMs: b.timeoutMs`; `elapsedMs <= b.syncBoundMs` and its message; `assertGoneWithin(sleeper, b.goneWithinMs)` | `assertSleeperExisted` (with `started` of the test) |

What each scaled number bounds and why scaling keeps the proof:
- `timeoutMs`: when the runner (or the tree helper's runner) times the command out. The kill still happens after the timeout the test set; the scale makes it at least twice the calibrated readiness, and the precondition checks that the fixture was ready before it.
- `stayBoundMs`: the receipt does not wait for the sleeper that holds the output. It stays 4 times the timeout, and below the sleeper's 60 000 ms life at every scale up to the cap, so a receipt that waited for the sleeper still fails.
- `exitCloseMs`: the receipt resolves on the close event right after the timeout, not at the grace bound. Only the timeout scales; `TIMEOUT_GRACE_MS` does not, so a runner that waited for the grace bound (the stdio-destroy mutant) still fails at every scale.
- `noKillBoundMs`: with a tree kill that kills nothing, the receipt resolves at the grace bound and never waits for the root or the sleeper. The timeout and the 1000 ms of slack for spawn and timer lateness scale, the grace does not; at the cap it is 22 000 ms, far below the 60 000 ms the root and the sleeper live, so a runner without the grace timer still fails.
- `slowKillBoundMs`: the same with a tree kill that blocks for 1500 ms; the kill's duration is the scenario, a wall-clock wait that load does not lengthen, and the lower bound `waited >= 2000 - 50` counts from the kill's return with the product's grace, so the mutant that arms the bound before the kill returns (waited about 500 ms) still fails.
- `goneWithinMs`: how long the killed sleeper may take to answer ESRCH. At the cap it is 24 000 ms; a sleeper that was not killed lives 60 000 ms from its start, past the end of the poll.
- `syncBoundMs`: runSync returns at the inner run's bound, not at the helper's backstop or the sleeper's exit. It is 6000 times the scale up to scale 3 and the helper's backstop from scale 4, so a receipt from the backstop still fails at every scale.
At scale 1 every number is main's (acceptance 1, `boundsAt(1)`), so on a machine whose calibration is at most 750 ms every product mutant main's tests kill is still killed; the attempt evidence need not repeat the mutant sweeps of T0-EXEC-TREE-KILL and T0-EXEC-SYNC-TREE-KILL-2.

### 4
Evidence, not a test, recorded in the Attempt evidence: five runs of `node --test tests/infra/exec.test.ts` alone and three under `load.sh 24 150` (hygiene), on main (the commit the branch starts from) and on the candidate, each with its pass and fail counts and failing titles, and for the candidate the `calibration <m> ms, scale <s>` diagnostic of each changed test. A failure on the candidate under load is either a precondition message (a burst after the calibration, a non-goal) or a defect to report.

### 5
The CHANGELOG entry, one line, directly above `- T0-BOARD-OWNER-WAIT` (or above the T0-UNRESOLVED-NARRATION entry when that card merged first, hygiene):

"- T0-EXEC-TEST-LOAD (tests, audit item H6): the six process-tree tests of `tests/infra/exec.test.ts` that time out the fixture (T0-EXEC-TREE-KILL acceptance 3, both cases of acceptance 4 and both cases of acceptance 5 but the runner-handle test, and T0-EXEC-SYNC-TREE-KILL-2 acceptance 1) first time the fixture's root in exit mode from its spawn to its exit and take a scale of that time in units of 750 ms, rounded up, from 1 to 8; a calibration that fails fails the test. The fixture timeout and each test's bounds are main's values times the scale, while `TIMEOUT_GRACE_MS`, the tree helper's backstop, the slow tree kill's 1500 ms and the slow-kill lower bound stay as they were; at scale 1 every value is main's, and the `runSync` bound is never above the helper's backstop. When the fixture was not ready before the timeout could fire, the test fails first with `fixture not ready before the timeout at scale <n>`: the exit case when the tree kill found the root still running, acceptance 3, the no-kill case and the `runSync` case when the sleeper's pid file was not written by then. Before, the timeout was a fixed 1500 ms, which the fixture's start under CPU load outlasted: with 24 CPU-bound processes on 16 logical CPUs the exit-mode root exited 4.0 to 4.3 s after its spawn (0.39 to 0.43 s without load), so the exit test saw the tree kill called with the root's pid and the `runSync` test returned after 6.2 to 7.8 s, past its 6000 ms bound; that load gives scale 6."

## Attempt evidence

Seam commit 2d2b9ece (tests only), candidate code 76388b27 (feat 76b15d02, then 92430066 and 76388b27 for the calibrate failure rows; merged origin/main at f1cf1347). Measured on Windows 11 with other verifications running on the machine (no load script was started). Linux run and the loaded runs (3 on main, 3 on the candidate under `load.sh 24 150`): pending (coordinator).

### RED (seam 2d2b9ece, `node --test --test-name-pattern "T0-EXEC-TEST-LOAD|calibrat" tests/infra/exec.test.ts`: 2 tests, 0 pass, 2 fail)
- Acceptance 1 fails at `scaleFor(751)`: `AssertionError expected: 2 actual: 1`.
- Acceptance 2 fails at the row asking for a number above 0: `expected: true actual: false` (calibrate returned 0).

### Scale 1 against main (7ebc37ad), asserted by `deepEqual(boundsAt(1), ...)` in acceptance 1
| Bound | main literal (line) | `boundsAt(1)` |
|---|---|---|
| timeoutMs | 1500 (`TIMEOUT_MS`, :229) | 1500 |
| stayBoundMs | 6000 (:286, :297, :307) | 6000 |
| exitCloseMs | `TIMEOUT_MS + 2000` = 3500 (:314) | 3500 |
| noKillBoundMs | `TIMEOUT_MS + 2000 + 1000` = 4500 (:323) | 4500 |
| slowKillBoundMs | `TIMEOUT_MS + 1500 + 2000 + 1000` = 6000 (:348) | 6000 |
| goneWithinMs | 3000 (:291, :452) | 3000 |
| syncBoundMs | 6000 (:444) | 6000 |

### Revert table (acceptance 1 and 2 tests and the calibrate failure rows, code SHA 76388b27, each mutation restored, `git diff --stat` empty after): 32 of 35 red
| Mutation | Rows | Result |
|---|---|---|
| scaleFor: `floor`; `round`; no lower clamp; no cap; cap 9; default 1 for a failed measurement; NaN/Infinity accepted; negative accepted | 8 | red x8 |
| boundsAt: grace scaled; backstop scaled; slow-kill duration scaled; sync `min` removed; timeout, stay bound, goneWithin, no-kill slack not scaled | 8 | red x8 |
| preconditions: sleeper `>=` for `>`; missing pid file passes; root `every` for `some` | 3 | red x3 |
| fixtureEnv: case-sensitive filter; GIT_ kept; NODE_OPTIONS kept; ceiling without the realpath parent; state dir unset | 5 | red x5 |
| calibrate: exit code not checked (row: exits 3); exit code and signal both unchecked (rows: exits 3, kills itself); pid file not required (row: exits 0 without it); spawn error not handled (row: no such command); time limit ignored (row: limit 5 s); sleeper not ended; ended not recorded; returns 0 for the measure | 8 | red x8 |
| calibrate: signal unchecked alone | 1 | GREEN, by logic: `code === 0` already implies no signal (a child ended by a signal reports a null code) |
| calibrate: the limit does not resolve | 1 | GREEN: the root ended at the limit then exits non-zero, which gives undefined |
| calibrate: the root not ended at the limit | 1 | GREEN: the inline child's pid file holds the child's own pid, so ending the sleeper ends it |
The wiring of the six tests to `boundsAt` stays reviewer-verified. The DoD run on a busy machine (SHA 92430066 run: scales 2, 2, 2, 3, 3, 2; an earlier run on 76b15d02: 6, 2, 2, 4, 4, 2, all 63 tests passing) exercised it above scale 1.
Platform results of the failure rows (Windows 11, Node 22): a child ending itself with `process.kill(process.pid, 'SIGKILL')` reports exit code 1 and signal null; the child exiting 3 reports code 3; the missing command emits `error` (ENOENT); calibrate returned undefined in every row. Row (d) uses a 5 s limit and a 30 s sleep, not 200 ms: at 200 ms a loaded machine had not yet started the child, so no pid file existed to verify (one DoD run failed on `ended.length`).

### Runs alone (`node --test tests/infra/exec.test.ts`)
| Version | Run | tests / pass / fail | Failing title | Scales |
|---|---|---|---|---|
| main 7ebc37ad | 1, 2, 4, 5 | 61 / 61 / 0 | none | none |
| main 7ebc37ad | 3 | 61 / 60 / 1 | acceptance 4: in exit mode (the root gone, the sleeper holding its output) ... | none |
| candidate 76b15d02 | 1-5 | 63 / 63 / 0 each | none | all 6 diagnostics at scale 1 (221-512 ms) |
| candidate 76b15d02 (the DoD run, machine busy) | DoD | 63 / 63 / 0 | none | 4180 ms scale 6; 1132 ms scale 2; 1228 ms scale 2; 2695 ms scale 4; 2586 ms scale 4; 1226 ms scale 2 |

### DoD (`npm run typecheck && node --test tests/infra/exec.test.ts` on 76388b27): exit 0, tests 68, suites 15, pass 68, fail 0, cancelled 0, skipped 0; diagnostics 269, 299, 680, 348, 318, 439 ms, scale 1. The runs alone above were measured on 76b15d02 (63 tests).

### CHANGELOG sentence against the code
| Sentence | Code and test |
|---|---|
| scale in units of 750 ms, rounded up, 1 to 8; a failed calibration fails the test | `scaleFor`, acceptance 1 rows |
| timeout and bounds main's times the scale; grace, backstop, 1500 ms kill, lower bound unchanged; sync bound never above the backstop | `boundsAt`, acceptance 1 `boundsAt(1)`, `(4)`, `(8)` |
| `fixture not ready before the timeout at scale <n>` for exit (root alive at the kill call) and for acceptance 3, no-kill, runSync (sleeper pid file late) | `assertRootGone`, `assertSleeperExisted`, acceptance 1 message rows |
