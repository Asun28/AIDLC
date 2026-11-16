---
id: T1-DOD-GATE-FIXTURES
title: The three scenario fixtures that record a success in a worktree directory through a scripted runner answer the card's dod_command with exit 0, so their successes carry a loop-run DoD that met dod_exit before T1-DOD-GATE reads it
status: todo
branch: T1-DOD-GATE-FIXTURES
worktree: D:\wt\AIDLC\T1-DOD-GATE-FIXTURES
plan_ref: plans/execution-gate.md#7-task-split-dependencies-and-parallel-windows
allow_paths:
  - tests/scenarios/dirty-success.test.ts
  - tests/scenarios/dod-receipt-required.test.ts
  - tests/scenarios/review-rule-ship.test.ts
  - specs/tasks/T1-DOD-GATE-FIXTURES.md
dod_command: npm run typecheck && node --test tests/scenarios/dirty-success.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/review-rule-ship.test.ts
dod_exit: 0
requirements:
  - R1. The scripted runner of `atBuild` in tests/scenarios/dirty-success.test.ts (:75-83) shall answer the card's dod_command, `node --test tests/t0-ds.test.ts`, with exit code 0 and empty output.
  - R2. The scripted runner of `atBuildGit` in tests/scenarios/dod-receipt-required.test.ts (:113-119) shall answer the card's dod_command, `node --test tests/t0-drg.test.ts`, with exit code 0 and empty output.
  - R3. The scripted runner of the git-backed test in tests/scenarios/review-rule-ship.test.ts (:377) shall answer the card's dod_command, `node --test tests/t1-rs.test.ts`, with exit code 0 and empty output.
  - R4. No assertion that stands in the three files at 35de54fe shall be changed or removed.
acceptance:
  - 1. tests/scenarios/dirty-success.test.ts, new test "T1-DOD-GATE-FIXTURES acceptance 1 - a clean success of the github fixture carries a loop-run DoD that ran and exited 0". `atBuild('github')`, `recordAttempt` with the file's `SUCCESS` input; the last attempt's `loopDod` has `ran` true, `exitCode` 0, `expectedExit` 0 and `timedOut` false. Fails on main by assertion (`exitCode` 127, the scripted runner's answer for a command with no entry, src/probes/exec.ts:400). [R1] [dod arm 2]
  - 2. tests/scenarios/dod-receipt-required.test.ts, new test "T1-DOD-GATE-FIXTURES acceptance 2 - a clean success of the git fixture carries a loop-run DoD that ran and exited 0". `atBuildGit(t, 'github')`, a success with a receipt; the same four values. Fails on main by assertion (127). [R2] [dod arm 2]
  - 3. tests/scenarios/review-rule-ship.test.ts, the existing test "acceptance 7, git-backed (R3 decision 2, re:F1)" gains one assertion directly after each of its two recorded successes (the loop at :398-405, the `recordAttempt` at :402) - the last attempt's `loopDod` has `ran` true and `exitCode` 0. Fails on main by assertion (127). [R3] [dod arm 2]
  - 4. Every other test of the three files passes, and `git diff --numstat` against the base shows only added lines in each of the three files. Passes on main and with this card (reviewer-verified against the diff). [R4] [dod arm 2]
  - 5. The Attempt evidence section of this card file holds the list of the probe run of the hygiene - every test file in which a recorded success carried a `loopDod` that ran and did not meet `dod_exit`, with the command and the exit code (reviewer-verified against the diff). [R1] [R2] [R3]
depends_on: []
budget: 60
tdd: true
sweep: "Main at 35de54fe. Measured, not read - a scratch copy of the tree (never committed) got a line in `recordAttempt` after card-runner.ts:1268 that logs every success whose `loopDod` has `ran` true and `timedOut` true or an `exitCode` other than `expectedExit`, and the whole suite was run on it (3737 tests, 857 s on Windows). It logged 29 such successes in four files - tests/scenarios/dirty-success.test.ts 24 (`node --test tests/t0-ds.test.ts`, exit 127), tests/scenarios/dod-receipt-required.test.ts 2 (`node --test tests/t0-drg.test.ts`, exit 127), tests/scenarios/review-rule-ship.test.ts 1, the first of two in a flow that then went red (`node --test tests/t1-rs.test.ts`, exit 127), and tests/scenarios/dod-record.test.ts 2 (its own failing and timed-out DoD, which T1-DOD-GATE changes). The dod_command of each fixture card is the harness default `node --test tests/<id in lower case>.test.ts` (tests/scenarios/_harness.ts:120). `scriptedRunner` matches a command by prefix and answers one with no entry with exit 127 (src/probes/exec.ts:397-400). The three fixtures have a worktree directory (`mkdirSync` at dirty-success.test.ts:73 and dod-receipt-required.test.ts:111, `git worktree add` at review-rule-ship.test.ts:395) and build the `CardRunner` with the scripted runner, so `loopDod` runs the command through it (card-runner.ts:298-303). Every other scenario records its successes on a run whose worktree is no directory, where `loopDod` gives `ran: false` and starts nothing (`makeFixture` makes no worktree, _harness.ts:51-57); none of the other test files that call `recordAttempt` (49 files call it) logged one. With a prototype of the T1-DOD-GATE change on the same copy, the failing tests were in these four files and nowhere else (plus two tests of tests/surface/outcome-summary.test.ts that need a git repository the scratch copy is not)."
forbid:
  - a change to src, to docs or to any test file other than the three named
  - changing, weakening, skipping or deleting an assertion that stands in the three files; the card adds one scripted entry per fixture and the assertions of acceptance 1 to 3
  - a scripted answer for the DoD other than exit code 0 with empty output, or an entry keyed by a shorter prefix than the whole dod_command
  - a change to the R3 policy, REVIEW.md, the review allowances or the card state precedence in src/core/card-machine.ts
non_goals:
  - the gate itself (T1-DOD-GATE), and tests/scenarios/dod-record.test.ts, which that card changes
  - a default DoD answer in `scriptedRunner` or in tests/scenarios/_harness.ts; a command with no entry keeps exit 127
  - fixtures whose run has no worktree directory; their successes record `ran: false`, which T1-DOD-GATE leaves as today
hygiene: "Line numbers are from main at 35de54fe; read them again at PREPARE. Main has moved since (other cards add scenario tests), so repeat the probe at PREPARE before the first edit - in a scratch copy outside the worktree, or as an uncommitted line restored afterwards, log every success whose `loopDod` ran and did not meet `dod_exit` and run every test file that calls `recordAttempt` or starts `aidlc card attempt` (`git grep -l -e 'recordAttempt(' -e \"'attempt'\" -- tests`). If a file other than the four above logs one, stop and ask for an amendment of allow_paths before starting; do not skip it. The scripted entry answers the DoD the loop already runs today, so no call count changes - dirty-success.test.ts counts `git status` probes only (`git.probes`)."
---

# T1-DOD-GATE-FIXTURES

## Deliverable
One scripted runner entry in each of three scenario fixtures, answering the fixture card's `dod_command` with exit 0, and one assertion per fixture that a recorded success carries a loop-run DoD that met `dod_exit`.

## Why
T1-DOD-GATE turns a success whose loop-run DoD did not meet `dod_exit` into a failed attempt. Three scenario fixtures record successes in a real worktree directory through a scripted runner that has no entry for the DoD command, so the loop-run DoD of those successes exits 127 today and the record is ignored. With the gate, 27 successes of these fixtures would become failures and their tests would go red for a reason the tests are not about. This card is split from T1-DOD-GATE because the gate card already needs eight paths; done first, it changes no behaviour and leaves every existing assertion as it is.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/scenarios/dirty-success.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/review-rule-ship.test.ts
```
- Expected exit code: 0
- Assertion: dod arm 1 is `npm run typecheck`, dod arm 2 is the `node --test` command; every test of the three files passes, the new assertions included.

## Attempt evidence

Hygiene probe at PREPARE (base 332956a2): an uncommitted line after card-runner.ts:1268 appended every success whose `loopDod` had `ran` true and `timedOut` true or `exitCode` other than `expectedExit` to a log; the 54 files of `git grep -l -e 'recordAttempt(' -e "'attempt'" -- tests` were run with it (run exit 0), then the line was restored. Logged successes, by file:

| File | Count | Command | Exit code |
|---|---|---|---|
| tests/scenarios/dirty-success.test.ts | 24 | `node --test tests/t0-ds.test.ts` | 127 |
| tests/scenarios/dod-receipt-required.test.ts | 2 | `node --test tests/t0-drg.test.ts` | 127 |
| tests/scenarios/review-rule-ship.test.ts | 2 | `node --test tests/t1-rs.test.ts` | 127 |
| tests/scenarios/dod-record.test.ts | 1 | `node dod.mjs 3` | 3 |
| tests/scenarios/dod-record.test.ts | 1 | `node "<worktree>\tests\infra\exec-tree.child.ts" stay tree.pid` | null (timed out) |

No file outside the four of the sweep logged one. review-rule-ship.test.ts logged both of its successes (the sweep had one).

| Item | Proof | Result |
|---|---|---|
| 1 | dirty-success.test.ts "T1-DOD-GATE-FIXTURES acceptance 1 - ..." | RED at 27d77737 (exitCode 127), passes with the entry |
| 2 | dod-receipt-required.test.ts "T1-DOD-GATE-FIXTURES acceptance 2 - ..." | RED at 27d77737 (exitCode 127), passes with the entry |
| 3 | review-rule-ship.test.ts "acceptance 7, git-backed (R3 decision 2, re:F1)", assertion after each success | RED at 27d77737 (127), passes with the entry |
| 4 | DoD: 70 tests, 69 pass, 0 fail, 1 skipped (existing Windows skip, EACCES); `git diff --numstat 332956a2 -- tests`: `12 0 dirty-success.test.ts`, `9 0 dod-receipt-required.test.ts`, `5 0 review-rule-ship.test.ts` | added lines only in all three files (attempt 2, R3 F1: the DoD entry of review-rule-ship.test.ts is added by a block-scoped wrapper that shadows `scriptedRunner` inside that test, so line 377 is as on main); no assertion changed |
| 5 | the probe table above | 4 files, as listed |

Platform runs of the three changed test files:

| Platform | Command | Node | Tested SHA | Tests / pass / fail / skipped | Exit |
|---|---|---|---|---|---|
| Windows 11 | `npm run typecheck && node --test tests/scenarios/dirty-success.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/review-rule-ship.test.ts` (in the card worktree) | v22.23.1 | baf1e5097917cf148391ae3cc3709980905a038a | 70 / 69 / 0 / 1 (EACCES test, skipped on Windows) | 0 |
| Linux (WSL Ubuntu, git 2.43.0) | fresh `git clone --no-checkout` of the main checkout into a `mktemp -d` directory, `git checkout <sha>`, `npm ci`, then `node --test --test-reporter=tap tests/scenarios/dirty-success.test.ts tests/scenarios/dod-receipt-required.test.ts tests/scenarios/review-rule-ship.test.ts` | v24.3.0 (the WSL host has no node 22 at or above 22.18) | baf1e5097917cf148391ae3cc3709980905a038a | 70 / 70 / 0 / 0 | 0 |

The Linux run was on baf1e509; the candidate that carries this table differs from it only in specs/tasks/T1-DOD-GATE-FIXTURES.md : `git diff --stat baf1e509 <candidate>` gives `specs/tasks/T1-DOD-GATE-FIXTURES.md | 1 file changed, insertions only`; the exact count is in the attempt receipt.
