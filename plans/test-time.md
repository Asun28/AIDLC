---
slug: test-time
title: An in-process CLI helper, the seven slowest CLI suites converted with every assertion kept, and an audit list for the owner
spec: specs/test-time.md
size: T1
status: draft
created: 2026-11-19T10:05:00Z
---

# Plan: cut test time without losing coverage (from intent/test-time.md)

## 1. Goal and boundaries
The seven slowest CLI suites (488 s of the 666 s local suite is in the top eight suites;
`mutants.test.ts` excluded) run most cases in-process, with every assertion and test name kept
and one child-process case per command. The owner gets `docs/reliability/test-audit.md` to
approve. Not in this plan: the mutant runner, the CI workflows, changing or removing a listed
test.

## 2. Minimal acceptable loop
One helper card with an equivalence test against `bin/aidlc.js`, then two conversion cards in
parallel (different files), and the audit list in parallel with all of them (it changes no
test file).

## Files that change
- T1-TEST-CLI-INPROC: `tests/infra/cli-inprocess.ts` (new), `tests/infra/cli-inprocess.test.ts` (new), changelog.
- T1-TEST-INPROC-A: `tests/surface/cli-cwd-paths.test.ts`, `tests/scenarios/review-resolve.test.ts`, `tests/scenarios/review-r3-wait.test.ts`, changelog.
- T1-TEST-INPROC-B: `tests/surface/init-base-ci.test.ts`, `tests/scenarios/review-no-run.test.ts`, `tests/surface/approver.test.ts`, `tests/surface/init-no-package.test.ts`, changelog.
- T1-TEST-AUDIT-LIST: `docs/reliability/test-audit.md` (new), `tests/surface/test-audit.test.ts` (new), changelog.

## Order of work
1. T1-TEST-CLI-INPROC and T1-TEST-AUDIT-LIST in parallel.
2. T1-TEST-INPROC-A and T1-TEST-INPROC-B in parallel, after T1-TEST-CLI-INPROC merges.
3. Coordinator: the junit timing of the seven files and the full suite wall time on this
   machine, before (2026-11-19 baseline: 666 s wall) and after, in the goal's closing note.
4. The owner reads the audit list; approved entries become a new card in a later goal.

## Risks
- A case that only looks like a CLI call asserts child-process behaviour (preload, the
  printing of `bin/aidlc.js`, inherited env, the child's cwd). Mitigation: R2/R3 keep those as
  child processes; R3 review reads each converted case against that rule.
- Process-wide swaps (cwd, env, streams, exit) leak on a thrown error or an awaited timer.
  Mitigation: restore in `finally`, refuse a nested call, and an acceptance test that a
  throwing command leaves all five as they were.
- `main` may keep the event loop busy after it resolves (the `watch` interval). Mitigation:
  the conversions do not run `watch` in-process.
- The audit list is a judgement. Mitigation: every row needs evidence a reader can check (a
  removed symbol, a superseded card id, the covering test name), and a test checks that each
  named test exists in the named file.

## Proof
Each card's DoD; the before/after timing in the closing note; the audit list with a test that
each row names an existing test.
