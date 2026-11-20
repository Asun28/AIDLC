---
slug: test-time
title: The slowest suites call the CLI in-process with every assertion kept, and the owner gets a list of tests that no longer match the code
intent: intent/test-time.md
status: accepted
created: 2026-11-19T10:05:00Z
skills_applied: [grilling]
---

# Spec: The slowest suites call the CLI in-process with every assertion kept, and the owner gets a list of tests that no longer match the code
From intent: intent/test-time.md. Status: accepted (owner decisions of 2026-11-19). Skills applied: grilling (two questions: removal approval, one end-to-end test per command).

## Requirements (EARS)
- R1. WHEN a test calls the in-process helper with argv, a working directory, an environment and optional standard input, the helper shall return the exit code, standard output and standard error that the same call through `bin/aidlc.js` returns and leave `process.cwd()`, `process.env`, `process.exitCode`, `process.exit` and the standard streams as they were (T1-TEST-CLI-INPROC).
- R2. WHEN a case of `tests/surface/cli-cwd-paths.test.ts`, `tests/scenarios/review-resolve.test.ts` or `tests/scenarios/review-r3-wait.test.ts` starts the CLI and asserts nothing the child process itself does, the case shall start it through the in-process helper with its assertion lines and test name unchanged and one child-process case kept per command (T1-TEST-INPROC-A).
- R3. WHEN a case of `tests/surface/init-base-ci.test.ts`, `tests/scenarios/review-no-run.test.ts`, `tests/surface/approver.test.ts` or `tests/surface/init-no-package.test.ts` starts the CLI and asserts nothing the child process itself does, the case shall start it through the in-process helper with its assertion lines and test name unchanged, one child-process case kept per command, and a git fixture that several cases only read created once per block (T1-TEST-INPROC-B).
- R4. The repository shall hold `docs/reliability/test-audit.md`, a table of tests that no longer match the code, each row giving the file, the exact test name, the class (`removed-behaviour`, `duplicate`, `removed-path`, `superseded-card`), checkable evidence, the covering test and a proposed action (`update`, `remove`), with no test file changed (T1-TEST-AUDIT-LIST).

## Acceptance
- 1. The in-process helper and `bin/aidlc.js` give the same status, stdout and stderr on at least five calls, and a passing, an exiting and a throwing call leave the process state as it was. [R1]
- 2. The seven converted files pass with no added or removed line containing `assert`, `it(`, `test(` or `describe(`, and each command they run keeps a child-process case. [R2] [R3]
- 3. The audit list exists, and a test checks that each row names an existing test with a valid class and action and that no row proposes `remove` without a covering test. [R4]
- 4. The closing note gives the junit time of the seven files and the full suite wall time before (666 s) and after. [R2] [R3]

## Design
plans/test-time.md. The helper replaces `process.exit` with a function that throws a private
sentinel, sets `process.exitCode` to undefined, swaps `process.stdout.write` and
`process.stderr.write` for collectors, sets cwd and env for the call, awaits `main(['node',
'aidlc', ...argv])` and restores everything in `finally`. `main` keeps only constants at module
level (checked 2026-11-19: no module-level Map, Set, cache or listener in `src/` beyond
constant sets), so calls do not leak state into each other. `node:test` runs the tests of one
file in sequence, so the process-wide swap is safe inside one file; the helper refuses a
nested call.

## Interfaces and contracts
- Test helper: `runCliInProcess(argv: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; input?: string }): Promise<{ status: number; stdout: string; stderr: string }>` in `tests/infra/cli-inprocess.ts`.
- Audit list: `docs/reliability/test-audit.md`, one Markdown table.

## Data model and migration impact
None. No persisted record changes.

## Flagged concerns (route to policy owners)
- Hard limit "never weaken, skip or delete tests": no card of this goal deletes or skips a
  test, and no assertion line changes. Removals happen only in a later card, for entries the
  owner approves from the audit list.

## Non-goals
- `tests/surface/mutants.test.ts` and the verify skills; the CI workflows and required checks
  (`intent/ci-wall-time.md`); changing or removing any test on the audit list.
