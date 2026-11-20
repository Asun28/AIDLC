---
slug: test-time
title: The full suite runs in less time with every assertion kept, by calling the CLI in-process in the slowest suites, and the owner gets a list of tests that no longer match the code
author: asun28 (owner); drafted by the coordinator session
status: accepted
created: 2026-11-19T09:48:33.094Z
source: human
---

# Intent: The full suite runs in less time with every assertion kept, and the owner gets a list of tests that no longer match the code
Author: asun28 (owner); drafted by the coordinator session. Status: accepted (owner decisions of 2026-11-19 in the session).

## Problem
Measured 2026-11-19 on main at b4661db6. The owner asked in the session why the loop feels slow.

- Median minutes per merged card rose from 16 to 21 (weeks of 5 and 12 Oct) to 66 (week of
  9 Nov) and 42 (week of 16 Nov). Implement time (coding and the local DoD) went from 3 to 6
  minutes to 14 to 26; CI from 4 to 5 to 8 to 16. R3 went from about 1 to 2.4 minutes; R2 is
  off since 6 Nov.
- The suite grew from 64 test files and about 730 tests (21 Sep) to 216 files and about 2,920
  tests (19 Nov); 75 files were added in the last 10 days.
- The full local suite (`node --test "tests/**/*.test.ts"`, Windows, this machine) took 666 s
  wall, 3,847 test cases, 0 failures. The summed test-case time is 7,081 s; the 355 tests of
  more than 5 s take 5,486 s of it (77%).
- The slowest top-level suites: `T0-CLI-CWD-FILE-ARGS-2` (`tests/surface/cli-cwd-paths.test.ts`,
  319 s), review resolve refusals (`tests/scenarios/review-resolve.test.ts`, 168 s),
  `T1-INIT-BASE-CI` (`tests/surface/init-base-ci.test.ts`, 145 s), `runMutants`
  (`tests/surface/mutants.test.ts`, 142 s), `T0-REVIEW-NO-RUN-2`
  (`tests/scenarios/review-no-run.test.ts`, 113 s), approver identity
  (`tests/surface/approver.test.ts`, 96 s), `T1-INIT-HOOK-PATH`
  (`tests/surface/init-no-package.test.ts`, 94 s), `T0-R3-POOL-WAIT`
  (`tests/scenarios/review-r3-wait.test.ts`, 68 s). Most of their time is starting
  `bin/aidlc.js` in a child process per case (each start loads and type-strips the sources) and
  creating a git repository per case.
- `main(argv)` in `src/cli/main.ts` is exported, but it reads `process.cwd()` and
  `process.env`, writes to `process.stdout`/`process.stderr` and calls `process.exit`, so no
  test calls it in-process today.

## Proposed outcome
1. The summed test time of the seven converted files (the list above without
   `tests/surface/mutants.test.ts`) falls, with a target of half, measured with the junit
   reporter on this machine before and after; the full local suite wall time is recorded
   before and after. A case that asserts what the child process itself does (the output
   `bin/aidlc.js` prints for a thrown error, a module preloaded with `--import` for fault
   injection, the child's own working directory or inherited environment) stays a child
   process, so the target is reported, not a pass condition of a card.
2. Every assertion of the converted files is kept, and each CLI command those files exercise
   keeps at least one test that runs it through `bin/aidlc.js` in a child process.
3. The owner receives a list of tests that no longer match the code, each with its evidence;
   nothing on the list is changed or removed in this goal.

## Owner decisions (2026-11-19, in the session)
- Removals: the audit only produces a list with evidence per test (why it no longer matches,
  which test covers it); the owner approves the list, and a later card changes or removes
  exactly the approved entries.
- End-to-end tests: each CLI command keeps one test through `bin/aidlc.js`; its other cases
  may run in-process.

## Affected users and systems
Every card run (local DoD and CI). `tests/infra/` (a new in-process helper), the seven test
files above, `docs/reliability/` (the audit list), `docs/OPERATIONS.md` if it describes how
tests call the CLI.

## Constraints
- The typecheck, the verify skills (`verify-card-run-writes`, the mutant runner of
  `tests/surface/mutants.test.ts`), the CI workflows and `github.requiredChecks` stay as they
  are. `tests/surface/mutants.test.ts` is not converted: its time is the mutant runs it
  verifies.
- No test is skipped or deleted in this goal, and no assertion line of a converted file
  changes; only how a case starts the CLI and builds its fixture changes.
- No change under `src/` unless the in-process helper cannot be built without one; then the
  change is the smallest that keeps the child-process behaviour byte for byte.
- Cards of at most 200 changed lines and at most 8 allowed paths.

## Open questions
(none; settled by the owner decisions above)

## Not in this goal
- Running the suite once on Ubuntu instead of twice (`intent/ci-wall-time.md`, draft).
- Changing or removing any test on the audit list (a later card, after the owner approves).
