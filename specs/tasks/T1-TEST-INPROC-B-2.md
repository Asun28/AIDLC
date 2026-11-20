---
id: T1-TEST-INPROC-B-2
title: (replaces T1-TEST-INPROC-B) init-base-ci, review-no-run, approver and init-no-package tests start the CLI in-process except where a case asserts what the child process does, and share read-only git fixtures, with every assertion line and test name unchanged
status: todo
branch: T1-TEST-INPROC-B-2
worktree: D:\wt\AIDLC\T1-TEST-INPROC-B-2
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - tests/surface/init-base-ci.test.ts
  - tests/scenarios/review-no-run.test.ts
  - tests/surface/approver.test.ts
  - tests/surface/init-no-package.test.ts
  - changelog.d/T1-TEST-INPROC-B-2.md
  - specs/tasks/T1-TEST-INPROC-B-2.md
dod_command: npm run typecheck && node --test tests/surface/init-base-ci.test.ts tests/scenarios/review-no-run.test.ts tests/surface/approver.test.ts tests/surface/init-no-package.test.ts
dod_exit: 0
requirements:
  - R1. Each case of the four files that starts `bin/aidlc.js` or `src/cli/main.ts` in a child process shall call `runCliInProcess` (`tests/infra/cli-inprocess.ts`) instead, unless the case asserts what the child process itself does: the output `bin/aidlc.js` prints, the child's inherited environment, or a path the child resolves from its own working directory.
  - R2. Each CLI command the four files run shall keep at least one case through `bin/aidlc.js` in a child process.
  - R3. WHERE two or more cases of one describe block only read a git repository, the block shall create it once in `before` instead of once per case, and a case that writes to a repository shall keep its own.
  - R4. No line that contains `assert`, `it(`, `test(` or `describe(` shall be added or removed, and no test or describe name shall change. Such a line may change only by adding `async ` before the callback of an `it(`/`test(` call or `await ` before a call on it: with every `async ` and `await ` token removed it shall equal its line on main. The number of test cases per file shall be unchanged.
  - R5. The changelog entry shall give the junit time of each file before and after on the implementer's machine.
acceptance:
  - 1. The four files pass. [R1] [R2] [R3] [dod arm 1]
  - 2. `git diff origin/main -- <the files>`: no line containing `assert`, `it(`, `test(` or `describe(` is added or removed, and each changed one equals its main version once `async ` and `await ` are removed; test counts per file unchanged (reviewer-verified against the diff). [R3] [R4]
  - 3. Each case left as a child process names in a comment which R1 exception applies; each command has one child-process case; each shared fixture is only read by the cases that share it (reviewer-verified). [R1] [R2] [R3]
  - 4. The changelog entry gives the before and after times. [R5]
depends_on: [T1-TEST-CLI-INPROC-2]
budget: 120
tdd: false
forbid:
  - weakening, skipping or deleting a test, changing a test name, or changing an assertion line other than adding `async `/`await `
  - wrapping a case body in an inner async function to avoid adding `async` to its `it(`/`test(` line
  - a change under src/ or bin/
sweep: "Main at b4661db6. Child-process starts: init-base-ci.test.ts:310 (`bin/aidlc.js init <target> --dry-run`), git at :34; review-no-run.test.ts:78 (`raw`, `bin/aidlc.js -C <repo>`), git at :28, fixture `cliRepo` at :50; approver.test.ts:52 (`cli`, spawning the file in `main`), git at :49; init-no-package.test.ts: 37 spawn sites, helper `initialisedByCli` at :113. `src/cli/main.ts:250` exports `main(argv)`; it calls `process.exit` (:123, :597, :871) and sets `process.exitCode` (:511, :888, :946, :957). Module-level state in src/ is constant sets only (grep of `^(let|const) x = new Map|new Set|[]|{}` on 2026-11-19). 2026-11-19 junit times: init-base-ci 145 s, review-no-run 113 s, approver 96 s, init-no-package 94 s."
non_goals: [the files of T1-TEST-INPROC-A, tests/surface/mutants.test.ts]
hygiene: "Replaces T1-TEST-INPROC-B, which stopped before any commit: runCliInProcess is async, so converting a synchronous case needs async/await on lines its rule forbade. Owner decision 2026-11-20 in the session: allow only that mechanical change. tdd is false: the card changes how existing tests start the CLI and build fixtures and adds no behaviour; the existing assertions are the oracle. Changelog entry in changelog.d/T1-TEST-INPROC-B-2.md."
---

# T1-TEST-INPROC-B-2

## Deliverable
Four slow CLI suites (145, 113, 96 and 94 s on 2026-11-19) run most cases in-process, asserting exactly what they asserted before.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/init-base-ci.test.ts tests/scenarios/review-no-run.test.ts tests/surface/approver.test.ts tests/surface/init-no-package.test.ts
```
- Expected exit code: 0
- Assertion: the four files pass with no assertion line or test name changed.
