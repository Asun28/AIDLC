---
slug: execution-gate
title: A card is ready for review when the loop's own run of its DoD is green, and CI runs while R3 reviews
author: asun28 (owner)
status: draft
created: 2026-11-16T02:30:00Z
source: human
---

# Intent: a card is ready for review when the loop's own DoD run is green, and CI runs while R3 reviews
Author: asun28 (owner). Status: draft.

## Problem
An outside review of 2026-11-16 (commit 7001e96) found that model review decides whether a card
is done while executed checks gate nothing before it. Checked against main at 35de54fe and the
state directory on 2026-11-16:

- `aidlc card attempt --outcome success` runs the card's `dod_command` and stores the result
  as `loopDod` (card T1-DOD-RECORD-2); nothing reads it. A candidate is ready when the worker's
  own receipt text is present (`src/loop/card-runner.ts:849-850`; issue 124).
- The state directory holds 25 successful attempts with a `loopDod` record: 25 ran, 25 exited
  with the card's `dod_exit`, none timed out; durations p50 58 s, p90 171 s, max 234 s.
- The `github` ship path reads the R3 verdict (`src/delivery/github-ship.ts:299`) before the
  push (`:354`) and the CI gate (`:367-403`). The CI workflow took 14 to 22 minutes on each of
  the last 21 pull-request runs (`gh run list --workflow ci`, 2026-11-16).
- 2 of those 21 runs ended red (T1-REVIEW-SEVERITY-2, T0-R3-POOL-WAIT). Both cards had passed
  R3 and both were replaced by a successor card.
- `docs/reliability/baseline.md` (commit e74113d): 93 of 324 card attempts were replaced; the
  first formal decision passed on 45.2% of cards; 9 of 111 stops were CI stops.
- A test selected by the path it names is not selective here: of 204 test files, 50 name
  `card-runner.ts`, 76 name `OPERATIONS.md` and 85 name `CHANGELOG.md`.
- No outcome view counts defects that reached main: a gate change that raises a pass rate cannot
  be told from one that lets more defects through.

## Proposed outcome
1. A success whose loop-run DoD ran and did not exit with `dod_exit`, timed out or ended
   without an exit code is stored as a counted failed attempt with the DoD result as its
   cause; it binds no candidate and leaves the card in BUILD.
2. On the `github` ship path the card's branch is pushed and a draft pull request is opened
   when R3 is requested, after the scope check and the clean-candidate check, so CI runs while
   R3 reviews. The merge still needs the R3 pass on that head.
3. A report, from the history of red CI runs, of how often a selection of test files by the
   paths a candidate changed would have run the test that failed, and how many files it
   selects. The loop changes only if the report meets the keep rule below.
4. An outcome view counts escaped defects: bugfix cards and reverts merged after a card, per
   merged card and per week.

## Affected users and systems
`src/loop/card-runner.ts`, `src/core/effort.ts`, `src/core/types.ts`, `src/delivery/ship.ts`,
`src/delivery/github-ship.ts`, `src/core/affected.ts` (new), `bench/outcome/`,
`docs/reliability/`, `docs/OPERATIONS.md`, `docs/ARCHITECTURE.md`, `CHANGELOG.md`; GitHub (a
draft pull request exists before the review passes).

## Constraints
- Owner decisions of 2026-11-16: a refuted success is a counted failed attempt; the pull
  request is opened as a draft when R3 is requested.
- The R3 policy, its allowances and `REVIEW.md` do not change. No verdict is read earlier or
  waived, and a draft pull request is never merged before `gh pr ready` after the pass.
- A loop-run DoD that did not run (`ran: false`) keeps today's behaviour.
- Nothing is pushed before the scope check and the clean-candidate check. The `github` ship
  path has no local secret scan today: gitleaks is a CI check that runs after the push.
- Keep rule for the test selection (set before the report runs): it selects the failed test
  file for at least 70% of the red runs caused by a test, and its median selection is at most
  25% of the test files. Below either number the selection is recorded and not wired in.
- Cards of at most 200 changed lines and at most 8 allowed paths.

## Open questions
- (none)
