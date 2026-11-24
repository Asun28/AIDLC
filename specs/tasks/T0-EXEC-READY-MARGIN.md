---
id: T0-EXEC-READY-MARGIN
title: The six process-tree tests of tests/infra/exec.test.ts that pass a timeout to the fixture wait three calibration units before it (2250 ms times the scale, was 1500) and move each bound counted from the call by the same 750 ms times the scale, so what a bound allows after the timeout and every assertion about the kill stay as on main (issue 341)
status: merged
branch: T0-EXEC-READY-MARGIN
worktree: D:\wt\AIDLC\T0-EXEC-READY-MARGIN
allow_paths:
  - tests/infra/exec.test.ts
  - specs/tasks/T0-EXEC-READY-MARGIN.md
dod_command: npm run typecheck && node --test tests/infra/exec.test.ts
dod_exit: 0
requirements:
  - R1. `boundsAt(scale)` (tests/infra/exec.test.ts:300-312) shall return `timeoutMs` as (1500 + `READY_MARGIN_MS`) times the scale, with `READY_MARGIN_MS` a new constant equal to `CALIBRATION_BASE_MS` (750), so 2250 times the scale, and each bound counted from the call as that `timeoutMs` plus what main allows after its own timeout at the same scale - `stayBoundMs` plus 4500 times the scale, `exitCloseMs` plus `TIMEOUT_GRACE_MS`, `noKillBoundMs` plus 1000 times the scale plus `TIMEOUT_GRACE_MS`, `slowKillBoundMs` plus 1000 times the scale plus `SLOW_KILL_MS` plus `TIMEOUT_GRACE_MS`, `syncBoundMs` plus the smaller of 4500 times the scale and `TIMEOUT_GRACE_MS + TREE_HELPER_BACKSTOP_MS`; `goneWithinMs` (3000 times the scale, counted from the receipt) and `runnerExitBoundMs` (`TIMEOUT_MS + TIMEOUT_GRACE_MS` plus 3000 times the scale, counted from the start of the runner process) keep main's values.
  - R2. Every other line the calibrated tests run shall stay as on main - `calibrate`, `scaleFor`, `calibratedBounds`, `CALIBRATION_BASE_MS` (750), `SCALE_MAX` (8), `CALIBRATION_LIMIT_MS`, `SLOW_KILL_MS`, `SLEEPER_LIFE_MS`, `TIMEOUT_MS` (1500), `raceFixture`, the preconditions `assertSleeperExisted`, `assertRootGone` and `assertKilledBeforeNaturalEnd` with their messages, and each assertion of the seven tests that start with `calibratedBounds(t)` (the receipt, `timedOut`, `ok`, the exit code and the signal, the tree-kill calls, the death check, the helper-error check and the lower bound `waited >= 2000 - 50`).
  - R3. The four test titles that state the timeout or a bound counted from the call, and the comment above `boundsAt`, shall state the numbers and the rule of this card as Acceptance detail 3 gives them.
  - R4. The Attempt evidence shall hold the runs of Acceptance detail 4, alone and under load, on the base commit and on the candidate.
acceptance:
  - 1. tests/infra/exec.test.ts, describe `T0-EXEC-TEST-LOAD the calibrated scale`, new test "T0-EXEC-READY-MARGIN acceptance 1 - what each bound allows after the timeout is main's at scales 1, 4 and 8" - with `b = boundsAt(scale)`, the list `[b.stayBoundMs - b.timeoutMs, b.exitCloseMs - b.timeoutMs, b.noKillBoundMs - b.timeoutMs, b.slowKillBoundMs - b.timeoutMs, b.syncBoundMs - b.timeoutMs, b.goneWithinMs, b.runnerExitBoundMs]` deep-equals `[4500, 2000, 3000, 4500, 4500, 3000, 6500]` at scale 1, `[18000, 2000, 6000, 7500, 17000, 12000, 15500]` at scale 4 and `[36000, 2000, 10000, 11500, 17000, 24000, 27500]` at scale 8. It passes on the seam commit against main's `boundsAt` and on the candidate with no line of it changed between the two, which shows that no bound allows more after the timeout than main does. [R1] [R2] [dod arm 1]
  - 2. Same describe, new test "T0-EXEC-READY-MARGIN acceptance 2 - the timeout is three calibration units and the two starts of issue 341 are inside it" - the rows of Acceptance detail 2. Fails on the seam commit (the timeouts are 1500, 3000, 6000 and 12000, and both reported starts throw against `boundsAt(2).timeoutMs`). [R1] [dod arm 1]
  - 3. Same describe, test "the calibrated scale and the scaled bounds on each input class" - its three `boundsAt` rows hold the values of Acceptance detail 1 and no other row of the test changes. Fails on the seam commit. [R1] [R2] [dod arm 1]
  - 4. Same file - the seven calibrated tests pass under the titles of Acceptance detail 3, and the diff of the candidate against its base changes no line of them but those four titles, and no line of `calibrate`, `scaleFor`, `calibratedBounds`, `raceFixture`, the three preconditions or the runner-handle test (reviewer-verified against the diff). [R2] [R3] [dod arm 1]
  - 5. The Attempt evidence holds the runs of Acceptance detail 4 with their counts, failing titles and `calibration <m> ms, scale <s>` diagnostics (reviewer-verified). [R4]
depends_on: []
budget: 120
tdd: true
sweep: "Main at aea950c0; the file is unchanged since 6660c30f. Users of the bounds - :583-592 acceptance 3; :596-603 and :607-620 the two cases of acceptance 4; :624-640 and :644-658 the two `raceFixture` cases of acceptance 5; :741-761 the sync test; :664-668 the runner-handle test, which reads `b.runnerExitBoundMs` only (its 1500 ms timeout is the runner mode of tests/infra/exec-tree.child.ts). Pins of the numbers - only the table test at :345-357 (`boundsAt(1)` :352, `boundsAt(4)` :353, `boundsAt(8)` :354, the cap rows :355-356); the precondition rows at :358-360 pass their own numbers and stay. Titles - `git grep -n 'times the calibrated scale'` finds the four titles in this file and the text of the merged card T0-EXEC-TEST-LOAD only; no test, document, workflow or script reads a title of this file. Each calibrated test already calibrates at its own start (`calibratedBounds(t)` is its first statement), so the first direction issue 341 names is in place and only the margin is left. Measured on 2026-11-17 on scratch copies outside the repository with a prototype of this card (48 changed lines, never committed) - on the seam acceptance 1 passed and acceptance 2 and the table test failed; with `boundsAt` changed 72 of 72 tests passed in 62 s on Windows (main 70 of 70 in 58 s) and in 57 s on Linux (WSL), and in 206 s under 24 CPU-bound processes at scales 3 to 7."
forbid:
  - a repeated run, a retry loop or a skip of any test
  - any change to `calibrate`, `scaleFor`, `calibratedBounds`, `CALIBRATION_BASE_MS`, `SCALE_MAX`, `raceFixture` or the three preconditions and their messages
  - scaling or changing `TIMEOUT_GRACE_MS`, `TREE_HELPER_BACKSTOP_MS`, `SLOW_KILL_MS`, `SLEEPER_LIFE_MS`, `TIMEOUT_MS` or the lower bound `waited >= 2000 - 50`
  - a bound that allows more after the timeout than main allows at the same scale
  - any change to an assertion of the seven calibrated tests, or any change to the runner-handle test
  - any change under src/ or to tests/infra/exec-tree.child.ts
  - a new test file
  - a changelog fragment, or a change to CHANGELOG.md or to any document
non_goals:
  - a guarantee against a burst longer than three calibration units; the test then still fails with the named precondition
  - the runner-handle test, whose 1500 ms timeout is fixed in tests/infra/exec-tree.child.ts and which asserts no precondition
  - tests/scenarios/mutants-review.test.ts and tests/surface/review-bench.test.ts, which T0-EXEC-TEST-LOAD names as failing under load
  - a shorter run of the file; it grows by about 4 s without load
  - the order or the balance of the CI shards
diagnosis:
  root_cause: "Each calibrated test times the fixture's exit mode right before its own timed case and takes a scale of that time in units of 750 ms, rounded up. The timeout is 1500 ms times the scale, so the fixture is promised twice its calibrated start-up and no more. When the load rises between the calibration and the timed case, which are seconds apart inside one test, the timed start is slower than the calibration said. Twice on 2026-11-16, during a local `npm run check` beside bench runs, at scale 2, the sleeper wrote its pid file 3556 ms and 3722 ms after the call against the 3000 ms timeout, and the precondition `assertSleeperExisted` failed the test with its named message (issue 341). T0-EXEC-TEST-LOAD listed this case as a non-goal; two units are too little margin for it."
  same_class: "The six tests that pass `b.timeoutMs` to the fixture - T0-EXEC-TREE-KILL acceptance 3, both cases of acceptance 4 and the no-kill and slow-kill cases of acceptance 5 through `raceFixture`, and acceptance 1 of T0-EXEC-SYNC-TREE-KILL through `runSync`. All six take the timeout from `boundsAt`, so one change covers them."
hygiene: "Issue 341. Line numbers are from main at aea950c0; read them again at PREPARE. This card reverses, on purpose, one clause of the merged card T0-EXEC-TEST-LOAD - its forbid said that at scale 1 every number of the seven tests is main's, and its non_goals left a burst after the calibration to the named precondition. That forbid bound that card's candidate; this card changes the timeout and the bounds counted from the call and keeps every other limit of that card (no repeated run, no retry, no default scale, the product's constants not scaled). Tests first, in two commits - the seam commit adds the tests of acceptance 1 and 2 and changes the three `boundsAt` rows of acceptance 3 while `boundsAt` is main's, and RED is acceptance 2 and the table test failing while acceptance 1 passes; the second commit changes `boundsAt`, adds the constant and changes the comment and the four titles. Revert table before the first review, each a scratch change run alone and restored afterwards - the margin dropped from `timeoutMs`, the margin not multiplied by the scale, and the margin doubled (acceptance 2 and 3 red each; the doubled one also fails the row `boundsAt(8).stayBoundMs < 60_000`); `stayBoundMs` left at 6000 times the scale, the margin left out of `noKillBoundMs`, of `slowKillBoundMs` and of the first arm of `syncBoundMs`, and the margin added to `goneWithinMs` and to `runnerExitBoundMs`, one at a time (acceptance 1 and 3 red each). Run the file on Linux as well as Windows before the first R3 (docs/LESSONS.md 2026-11-11 T0-DIRTY-SUCCESS-2); this machine has WSL (distribution Ubuntu, Node 24.3.0 under ~/.nvm/versions/node/v24.3.0/bin, which is not on the login PATH). The load of Acceptance detail 4 is started from a script file outside the worktree, never from standard input; record the 24 process ids, and after the runs find each one gone or stop it by its id and name it in the report. No changelog fragment - the change is test-only (precedent T0-STRAY-LISTING-LOAD), and the CHANGELOG entry of T0-EXEC-TEST-LOAD under release 0.2.0 describes that card as it merged and stays. The card adds no test file, so it moves no file between the CI shards (`--test-shard=<k>/4` over the sorted list of tests/**/*.test.ts); on main at aea950c0 that list has 215 files and tests/infra/exec.test.ts is its file 36 counted from 0, in shard 1. The DoD is the file this card repairs; it takes about 62 s alone and about 206 s under the load of the evidence, against the 540 s limit of a loop-run DoD."
doc_sync: none
---

# T0-EXEC-READY-MARGIN

## Deliverable
The six process-tree tests that pass a timeout to the fixture give the fixture three calibration units to be ready (2250 ms times the calibrated scale) where they gave two (1500 ms times the scale). Each bound that is counted from the call moves later by the same 750 ms times the scale, so the time a test allows between the timeout and the receipt, and between the receipt and the death of the sleeper, is what it is on main. No test is repeated, retried or skipped, and the named precondition still fails a test whose fixture was not ready before the timeout.

## Why
Issue 341: T0-EXEC-TREE-KILL acceptance 5 and acceptance 3 failed twice on 2026-11-16 during a local `npm run check` beside bench runs, with `fixture not ready before the timeout at scale 2: the machine got slower after calibration (the sleeper's pid file was written 3556 ms after the call, the timeout was 3000 ms)` and the same with 3722 ms. Each passed when the file ran alone. Of the two directions the issue names, a calibration right before each timed case is already what the file does; this card widens the margin.

The timeout is a parameter of the test, not a constant of the product. `run` starts its timer when it spawns the fixture's root, and the tests assert what happens at and after that timer: the tree is killed, the receipt resolves, the sleeper is gone. A later timer gives the fixture more time to be ready and changes nothing the test asserts after it fires.

Each bound counted from the call is the timeout plus an allowance for what follows it. This card moves each such bound by exactly the time the timeout moved, so every allowance is main's at every scale. Acceptance 1 pins the allowances as literals and passes, unchanged, on main's `boundsAt` and on the candidate's.

The margin is one more calibration unit and not two: with two more, the stay bound at the cap is 3000 times 8 plus 4500 times 8, which is 60 000 ms, the life of the sleeper, and the existing row `boundsAt(8).stayBoundMs < 60_000` fails. With one more unit `scaleFor` and `SCALE_MAX` stay as they are, and the two reported starts are inside the timeout of scale 2 (4500 ms) with 944 ms and 778 ms to spare. A burst beyond three units still fails the test with the same named message.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/exec.test.ts
```
- Expected exit code: 0
- Assertion: the typecheck is clean and every test of the file passes (72 tests: main's 70 and the two new ones). dod arm 1 is the whole command.

## Acceptance detail

### 1. The rows of the table test that change (acceptance 3)
Test "the calibrated scale and the scaled bounds on each input class" (main :345). The keys are in the order `timeoutMs`, `stayBoundMs`, `exitCloseMs`, `noKillBoundMs`, `slowKillBoundMs`, `goneWithinMs`, `syncBoundMs`, `runnerExitBoundMs`.

| Row (main line) | On main | With this card |
|---|---|---|
| `boundsAt(1)`, deep-equal to the object (:352) | 1500, 6000, 3500, 4500, 6000, 3000, 6000, 6500 | 2250, 6750, 4250, 5250, 6750, 3000, 6750, 6500 |
| `Object.values(boundsAt(4))` (:353) | 6000, 24000, 8000, 12000, 13500, 12000, 23000, 15500 | 9000, 27000, 11000, 15000, 16500, 12000, 26000, 15500 |
| `Object.values(boundsAt(8))` (:354) | 12000, 48000, 14000, 22000, 23500, 24000, 29000, 27500 | 18000, 54000, 20000, 28000, 29500, 24000, 35000, 27500 |

Every other row stays byte for byte: the eleven `scaleFor` values and its five throwing inputs (:346-351), `boundsAt(8).stayBoundMs < 60_000` and `boundsAt(8).runnerExitBoundMs < 60_000` (:355-356, still true with 54000 and 27500), the rows of the three preconditions and the `fixtureEnv` row.

### 2. The margin rows (acceptance 2)
New test in the same describe; no process is started, and messages are compared whole with `notReadyMessage` of that describe.
- `[1, 2, 4, 8].map((scale) => boundsAt(scale).timeoutMs)` deep-equals `[2250, 4500, 9000, 18000]`, and for every scale from 1 to 8 `boundsAt(scale).timeoutMs` equals `3 * CALIBRATION_BASE_MS * scale`.
- The two starts the issue reports, with `startedMs` 1000 at scale 2 - `assertSleeperExisted({ sleeperWrittenMs: 4556, startedMs: 1000 }, 3000, 2)` throws the message of Why with `3556 ms` and `the timeout was 3000 ms`, and with 4722 the same with `3722 ms`. These two rows pass their own timeout, so they hold on main too and tie the test to the text of the issue.
- The same two starts against `boundsAt(2).timeoutMs` pass.
- The precondition is still enforced at the new timeout - `sleeperWrittenMs` 5500 passes against `boundsAt(2).timeoutMs`, and 5501 throws the message with `4501 ms` and `the timeout was 4500 ms`.

### 3. The four titles and the comment (acceptance 4)
| Test (main line) | Words on main | Words with this card |
|---|---|---|
| acceptance 3, `run` (:582) | `with timeoutMs 1500 times the calibrated scale resolves within 6 s times that scale` | `with timeoutMs 2250 times the calibrated scale resolves within 6750 ms times that scale` |
| acceptance 4, exit mode (:606) | `the receipt resolves within 6 s times the calibrated scale, timed out` | `the receipt resolves within 6750 ms times the calibrated scale, timed out` |
| acceptance 5, no kill (:623) | `resolves by (1500 + 1000) ms times the calibrated scale + TIMEOUT_GRACE_MS (2000)` | `resolves by (2250 + 1000) ms times the calibrated scale + TIMEOUT_GRACE_MS (2000)` |
| sync acceptance 1 (:740) | `with timeoutMs 1500 times the calibrated scale returns within 6 s times that scale` | `with timeoutMs 2250 times the calibrated scale returns within 6750 ms times that scale` |

The rest of each title stays. The stay case of acceptance 4, the slow-kill case of acceptance 5 (its 1500 ms is `SLOW_KILL_MS`) and the runner-handle test state none of the changed numbers and keep their titles.

The comment above `boundsAt` (main :299) says that the timeout is three calibration units per scale and that each bound counted from the call is that timeout plus what main allows after its own, and keeps its sentence that `TIMEOUT_GRACE_MS`, the helper's backstop and the slow kill's duration are the product's and stay. The wording is the implementer's (reviewer-verified against the diff).

### 4. Evidence, not a test (acceptance 5)
Three runs of `node --test tests/infra/exec.test.ts` alone and three under load, on the base commit (the commit the branch starts from) and on the candidate, twelve runs in all, each recorded with its pass and fail counts, the titles that failed and every `calibration <m> ms, scale <s>` diagnostic. The load is 24 node processes, each running `const end = Date.now() + 200000; while (Date.now() < end) {}`, started directly before the test run; they end on their own after 200 s.

A run of the candidate alone that fails is a defect. A run of the candidate under load that fails is either the named precondition, quoted with its milliseconds (a burst beyond the new margin, a non-goal), or a defect to report. The burst of the issue cannot be produced on demand, since a steady load raises the calibration with it; these runs show that the bounds hold at scales above 1 and that the file stays inside the time of the DoD, and acceptance 2 holds the two reported starts.

## Attempt evidence

Base 44d859a2 (origin/main). Seam commit 7930c0cc (RED), GREEN commit 49f65996. Windows 11, Node v22.23.1, 16 logical CPUs; Linux run through WSL Ubuntu, Node v24.3.0.

### Acceptance items
| Item | Evidence | Result |
|---|---|---|
| 1 | On the seam 7930c0cc (main's `boundsAt`): `node --test --test-name-pattern "T0-EXEC-TEST-LOAD the calibrated scale" tests/infra/exec.test.ts` -> `ok 2 - T0-EXEC-READY-MARGIN acceptance 1 ...`; on 49f65996 passes with no line of the test changed between the two commits (`git diff 7930c0cc 49f65996` touches `boundsAt`, its comment, the constant and four titles only) | pass on both |
| 2 | Seam: `not ok 3 - T0-EXEC-READY-MARGIN acceptance 2 ...`, first failing assertion actual `[1500, 3000, 6000, 12000]` expected `[2250, 4500, 9000, 18000]`; candidate: pass | RED then green |
| 3 | Seam: `not ok 1 - the calibrated scale and the scaled bounds on each input class`, `boundsAt(1)` actual timeoutMs 1500, stayBoundMs 6000, exitCloseMs 3500, noKillBoundMs 4500, slowKillBoundMs 6000, syncBoundMs 6000 against the new row; candidate: pass. Only the three `boundsAt` rows of that test change | RED then green |
| 4 | Candidate runs below: the seven calibrated tests pass under the titles of Acceptance detail 3; diff of the candidate against 44d859a2 changes four titles and no other line of the seven tests, `calibrate`, `scaleFor`, `calibratedBounds`, `raceFixture`, the three preconditions or the runner-handle test (reviewer-verified) | pass |
| 5 | The twelve runs below | recorded |
| DoD | `npm run typecheck && node --test tests/infra/exec.test.ts` on 49f65996: exit 0, tsc clean, tests 72, suites 15, pass 72, fail 0, cancelled 0, skipped 0, duration_ms 75510; calibrations 1321/2, 517/1, 529/1, 1261/2, 363/1, 486/1, 334/1 (ms/scale) | exit 0 |

RED receipt: 7930c0cc:tests/infra/exec.test.ts (seam describe run: tests 11, pass 9, fail 2; failing: the table test and acceptance 2; acceptance 1 passes).

### Revert table (guard sweep)
Each row a scratch change to `boundsAt` on 49f65996, run alone with `node --test --test-name-pattern "T0-EXEC-TEST-LOAD the calibrated scale" tests/infra/exec.test.ts`, then restored with `git checkout -- tests/infra/exec.test.ts` (worktree clean after the table).

| Row | Change | Red tests |
|---|---|---|
| r1 | margin dropped: `timeoutMs = 1500 * scale` | table test, acceptance 2 |
| r2 | margin not multiplied: `1500 * scale + READY_MARGIN_MS` | table test, acceptance 2 |
| r3 | margin doubled: `(1500 + 2 * READY_MARGIN_MS) * scale` | table test, acceptance 2; the table test stops at the `boundsAt(1)` row, before `boundsAt(8).stayBoundMs < 60_000`, which this change makes 3000 x 8 + 4500 x 8 = 60 000 and so false |
| r4 | `stayBoundMs: 6000 * scale` | table test, acceptance 1 |
| r5 | margin out of `noKillBoundMs`: `(1500 + 1000) * scale + TIMEOUT_GRACE_MS` | table test, acceptance 1 |
| r6 | margin out of `slowKillBoundMs`: `(1500 + 1000) * scale + SLOW_KILL_MS + TIMEOUT_GRACE_MS` | table test, acceptance 1 |
| r7 | margin out of the first arm of `syncBoundMs` (main's form `Math.min(6000 * scale, timeoutMs + TIMEOUT_GRACE_MS + TREE_HELPER_BACKSTOP_MS)`) | table test, acceptance 1 |
| r8 | margin added to `goneWithinMs` | table test, acceptance 1 |
| r9 | margin added to `runnerExitBoundMs` | table test, acceptance 1 |
| g1 | margin out of `exitCloseMs`: `1500 * scale + TIMEOUT_GRACE_MS` | table test, acceptance 1 |
| g2 | `Math.min` in `syncBoundMs` loosened to `Math.max` | table test, acceptance 1 |
| g3 | `READY_MARGIN_MS = CALIBRATION_BASE_MS - 1` | table test, acceptance 2 |

Each row: exit 1, pass 9, fail 2. No guard is left `equivalent:`.

### Runs of Acceptance detail 4
`node --test tests/infra/exec.test.ts` in the worktree. Load: 24 detached node processes each running `const end = Date.now() + 200000; while (Date.now() < end) {}`, started from a script file outside the worktree directly before the run; after each load run every one of the 24 pids was polled until `process.kill(pid, 0)` threw ESRCH (24 of 24 gone after each run, none stopped by hand). Calibrations are ms/scale in test order.

| Run | Commit | Tests | Pass | Fail | Time | Failing titles | Calibrations |
|---|---|---|---|---|---|---|---|
| alone 1 | base 44d859a2 | 70 | 70 | 0 | 56 s | - | 209/1, 423/1, 190/1, 199/1, 230/1, 199/1, 208/1 |
| alone 2 | base | 70 | 70 | 0 | 58 s | - | 457/1, 205/1, 441/1, 262/1, 219/1, 249/1, 210/1 |
| alone 3 | base | 70 | 70 | 0 | 59 s | - | 208/1, 228/1, 471/1, 232/1, 325/1, 230/1, 241/1 |
| load 1 | base | 70 | 70 | 0 | 106 s | - | 1171/2, 707/1, 1130/2, 728/1, 1190/2, 2263/4, 840/2 |
| load 2 | base | 70 | 69 | 1 | 104 s | `acceptance 5: with a tree kill that kills nothing, the receipt resolves by (1500 + 1000) ms times the calibrated scale + TIMEOUT_GRACE_MS (2000), ...` with `fixture not ready before the timeout at scale 1: the machine got slower after calibration (the sleeper's pid file was written 3062 ms after the call, the timeout was 1500 ms)` | 1154/2, 776/2, 672/1, 669/1, 661/1, 981/2, 722/1 |
| load 3 | base | 70 | 70 | 0 | 100 s | - | 877/2, 715/1, 720/1, 1588/3, 731/1, 851/2, 802/2 |
| alone 1 | candidate 49f65996 | 72 | 72 | 0 | 61 s | - | 207/1, 205/1, 206/1, 232/1, 442/1, 231/1, 478/1 |
| alone 2 | candidate | 72 | 72 | 0 | 64 s | - | 240/1, 277/1, 515/1, 260/1, 216/1, 231/1, 203/1 |
| alone 3 | candidate | 72 | 72 | 0 | 64 s | - | 238/1, 230/1, 231/1, 490/1, 714/1, 443/1, 452/1 |
| load 1 | candidate | 72 | 72 | 0 | 201 s | - | 1964/3, 1960/3, 1320/2, 2193/3, 2713/4, 4581/7, 2274/4 |
| load 2 | candidate | 72 | 72 | 0 | 217 s | - | 3102/5, 3284/5, 3066/5, 2019/3, 2159/3, 1839/3, 1527/3 |
| load 3 | candidate | 72 | 72 | 0 | 209 s | - | 2770/4, 1986/3, 3026/5, 3153/5, 2975/4, 2802/4, 1810/3 |

Base load 2 reproduces the class of issue 341 (a start of 3062 ms against the 1500 ms timeout of scale 1). The candidate's load runs ran at scales 2 to 7 and took up to 217 s, inside the 540 s limit of a loop-run DoD. The machine also carried other sessions' work during these runs, so the base and candidate load runs are not equal loads (base calibrations 661 to 2263 ms, candidate 1320 to 4581 ms).

Linux (WSL Ubuntu, Node v24.3.0, worktree at 49f65996 through /mnt/d): tests 72, pass 72, fail 0, 59 s; calibrations 231/1, 208/1, 224/1, 188/1, 184/1, 163/1, 194/1.
