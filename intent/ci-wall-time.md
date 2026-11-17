---
slug: ci-wall-time
title: The required checks of a pull request finish in at most 6 minutes at p50 whichever runner host GitHub assigns, and the suite runs once on Ubuntu
author: asun28 (owner); drafted by the coordinator session
status: draft
created: 2026-11-17T03:37:21.731Z
source: human
---

# Intent: The required checks of a pull request finish in at most 6 minutes at p50 whichever runner host GitHub assigns, and the suite runs once on Ubuntu
Author: asun28 (owner); drafted by the coordinator session. Status: draft.

## Problem
Measured 2026-11-17 on main at 0dd31e81, after goal loop-throughput put the Windows suite in
four shards (PR 349). The owner asked in the session why the Ubuntu check was getting slower.

- Three jobs of about the same length now set the wait. On the pull-request runs of PRs 349,
  350 and 352, the Windows path (earliest shard start to the end of
  `check (windows-latest, 22)`) took 448, 395 and 524 s, `check (ubuntu-latest, 22)` 448,
  445 and 448 s, and `build-test` 338, 285 and 297 s; the required checks finished after 448,
  445 and 524 s (p50 448 s). Before the shards, PR 342 took 18 min 23 s.
- The suite runs twice on Ubuntu in every run: `check (ubuntu-latest, 22)`
  (`.github/workflows/ci.yml`) and `build-test` (`.github/workflows/aidlc-ci.yml`) both run
  `npm test`, and both are in `github.requiredChecks`.
- The Ubuntu check is not getting slower; its duration depends on the host GitHub assigns.
  Over the last 58 successful `ci` runs (13 to 17 Nov), the Ubuntu `npm test` step took 270 to
  289 s on the 8 runs placed on AWS and 272 to 439 s on the 50 placed on Azure, with the same
  image name (`ubuntu-26.04`) and the same tests. Between the five fastest and the five
  slowest of these runs, the summed top-level test durations differ by a factor of 1.48, and
  the median factor over the 146 tests of 1 s or more is 1.51, so no single test explains the
  difference. On the AWS hosts the step went from 274 s (14 Nov) to 289 s (17 Nov). The three
  PR runs of goal loop-throughput all landed on slow Azure hosts (412 to 417 s).
- The four Windows shards of one run took 174 to 582 s in their test step. The path waits for
  the slowest of four hosts, and `--test-shard` splits by file index, not by duration.
- Sharding the Ubuntu job alone would have changed the end of 2 of the 9 sharded runs, by 50
  and 83 s; on the other 7 the Windows path ended last.

## Proposed outcome
1. The required checks of a pull-request run finish in at most 6 minutes at p50 over ten
   pull-request runs, against 448 s on the three runs of goal loop-throughput, whichever host
   each job lands on.
2. Each pull-request run executes the suite once on Ubuntu, not twice.
3. The slowest Windows shard of a run takes less time than now (582 s at most over the nine
   sharded runs of 17 Nov).

## Affected users and systems
Every card run (CI wait before the ship); `.github/workflows/ci.yml`,
`.github/workflows/aidlc-ci.yml`; the tests that pin the workflows
(`tests/surface/ci-shard.test.ts`, `tests/surface/bench.test.ts`,
`tests/surface/workflow-permissions.test.ts`, `tests/surface/init-base-ci.test.ts`);
`docs/OPERATIONS.md` where it describes the CI jobs; GitHub Actions (more jobs per run).

## Constraints
- No test file is moved, split, skipped or deleted, `npm test` keeps running the whole suite
  for local use, and every test file still runs on Ubuntu and on Windows in every
  pull-request run.
- The names in `github.requiredChecks` (`aidlc.config.json`) and the GitHub ruleset
  `main required checks` do not change.
- The R3 policy, its allowances and `REVIEW.md` do not change.
- The repository is public, so standard hosted runners cost no minutes; the limit on more
  shards is the account's number of concurrent jobs.
- The saving is an estimate until the first ten pull-request runs after the merge are read:
  about 1.5 to 2 minutes per run (from 448 s to about 6 minutes), against a card lead time
  p50 of 0.85 hours.
- Cards of at most 200 changed lines and at most 8 allowed paths.

## Open questions
- Should `build-test` stop running `npm test` (the suite then runs on Ubuntu only in the `check` job), or should both Ubuntu jobs be sharded? `build-test` is a required check: what must it still prove?
- What is this account's concurrent job limit, and how many jobs run when two pull requests and a push to main run at once? Each added shard is one more job per run.
- Is a saving of about 1.5 to 2 minutes per pull-request run worth a goal now, or should it wait behind work with a larger effect on card lead time, such as R3 time (4.0 minutes per card at p50)?
