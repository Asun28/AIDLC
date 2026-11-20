---
id: T1-TEST-INPROC-A-2
title: (replaces T1-TEST-INPROC-A) cli-cwd-paths, review-resolve and review-r3-wait tests start the CLI in-process except where a case asserts what the child process does, with every assertion line and test name unchanged
status: todo
branch: T1-TEST-INPROC-A-2
worktree: D:\wt\AIDLC\T1-TEST-INPROC-A-2
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - tests/surface/cli-cwd-paths.test.ts
  - tests/scenarios/review-resolve.test.ts
  - tests/scenarios/review-r3-wait.test.ts
  - changelog.d/T1-TEST-INPROC-A-2.md
  - specs/tasks/T1-TEST-INPROC-A-2.md
dod_command: npm run typecheck && node --test tests/surface/cli-cwd-paths.test.ts tests/scenarios/review-resolve.test.ts tests/scenarios/review-r3-wait.test.ts
dod_exit: 0
requirements:
  - R1. Each case of the three files that starts `bin/aidlc.js` or `src/cli/main.ts` in a child process shall call `runCliInProcess` (`tests/infra/cli-inprocess.ts`) instead, unless the case asserts what the child process itself does: a module preloaded with `--import` (the `preload` option of review-resolve), a concurrent child (`cliAsync`), the output `bin/aidlc.js` prints (review-r3-wait F2 and the cases its comments tie to `bin/aidlc.js`), the direct `src/cli/main.ts` entry, the child's inherited environment, or a path the child resolves from its own working directory that the in-process helper cannot reproduce.
  - R2. Each CLI command the three files run shall keep at least one case through `bin/aidlc.js` in a child process.
  - R3. No line that contains `assert`, `it(`, `test(` or `describe(` shall be added or removed, and no test or describe name shall change. Such a line may change only by adding `async ` before the callback of an `it(`/`test(` call or `await ` before a call on it: with every `async ` and `await ` token removed it shall equal its line on main. The number of test cases per file shall be unchanged.
  - R4. The changelog entry shall give the junit time of each file before and after on the implementer's machine, from `node --test --test-reporter=junit`.
acceptance:
  - 1. The three files pass. [R1] [R2] [dod arm 1]
  - 2. `git diff origin/main -- <the files>`: no line containing `assert`, `it(`, `test(` or `describe(` is added or removed, and each changed one equals its main version once `async ` and `await ` are removed; test counts per file unchanged (reviewer-verified against the diff). [R3] [R4]
  - 3. Each case left as a child process names in a comment which R1 exception applies, and each command run by the files has one child-process case (reviewer-verified). [R1] [R2]
  - 4. The changelog entry gives the before and after times. [R4]
depends_on: [T1-TEST-CLI-INPROC-2]
budget: 120
tdd: false
forbid:
  - weakening, skipping or deleting a test, changing a test name, or changing an assertion line other than adding `async `/`await `
  - wrapping a case body in an inner async function to avoid adding `async` to its `it(`/`test(` line
  - a change under src/ or bin/
non_goals: [other test files (T1-TEST-INPROC-B), tests/surface/mutants.test.ts]
hygiene: "Replaces T1-TEST-INPROC-A, which stopped before any commit: runCliInProcess is async, so converting a synchronous case needs async/await on lines its rule forbade. Owner decision 2026-11-20 in the session: allow only that mechanical change. tdd is false: the card changes how existing tests start the CLI and adds no behaviour; the existing assertions are the oracle. Changelog entry in changelog.d/T1-TEST-INPROC-A-2.md."
---

# T1-TEST-INPROC-A-2

## Deliverable
Three slow CLI suites (319, 168 and 68 s on 2026-11-19) run most cases in-process, asserting exactly what they asserted before.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/cli-cwd-paths.test.ts tests/scenarios/review-resolve.test.ts tests/scenarios/review-r3-wait.test.ts
```
- Expected exit code: 0
- Assertion: the three files pass with no assertion line or test name changed.
