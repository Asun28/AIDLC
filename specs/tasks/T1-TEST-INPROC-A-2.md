---
id: T1-TEST-INPROC-A-2
title: (replaces T1-TEST-INPROC-A) cli-cwd-paths, review-resolve and review-r3-wait tests start the CLI in-process except where a case asserts what the child process does, with every assertion line and test name unchanged
status: merged
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

## Attempt evidence

| # | Proof | Result |
|---|---|---|
| 1 | DoD: `npm run typecheck && node --test` over the three files | exit 0 (counts in the attempt receipt) |
| 2 | Script outside the worktree: for each hunk of `git diff -U0 622dda7c -- <file>`, every removed or added line containing the substring `assert`, `it(`, `test(` or `describe(` is paired in order and compared with every `async ` and `await ` removed; it(/test(/t.test( counts per file | 66 pairs equal, 0 unpaired, 0 different; counts 25 -> 25, 61 -> 61, 7 -> 7 |
| 3 | Comments `// Child process (...)` at each kept child case; command coverage below | every command has a bin/aidlc.js child case |
| 4 | `changelog.d/T1-TEST-INPROC-A-2.md`, junit times from `node --test --test-reporter=junit` | 146.2 -> 59.4 s, 123.0 -> 66.2 s, 18.4 -> 18.7 s |

Command -> bin/aidlc.js child-process case (R2):
- init, cards project, intent validate, spec validate, plan check, review bench compare, ci classify, migrate assess, evidence retain, monitor check -> cli-cwd-paths "supplied values: a value under a regular file fails with the error of main naming the resolved path [R6]"; spec validate also "every child starts without the NODE_ variables of the test process: a refusal prints the same stderr with NODE_DEBUG set".
- review bench run, hook auto, hook protect-paths -> cli-cwd-paths "an invalid -C is refused for every command [R2] [R6]" (through `assertCwdRefused`); review bench run also "-C selects the same repository and state directory in every form of the same directory [R1]"; both hooks also "-C selects the same repository and state directory in every form: a hook runs its guards in the -C directory [R1]".
- doctor -> cli-cwd-paths "every child starts without the GIT_ variables of the test process, and repository discovery stops at the ceiling" and "-C leaves the process directory and the environment as they are [R1] [R8]".
- goal new -> cli-cwd-paths "-C leaves the process directory and the environment as they are [R1] [R8]"; review-r3-wait `cliRepo` setup.
- review resolve -> review-resolve "every refusal of review resolve writes nothing and journals nothing" (through `assertRefused`), every `preload` call, and "two commands resolving the same lost request, one settles and the other is refused" (`cliAsync`).
- report, card next, card attempt, review r3 -> review-r3-wait "acceptance 2 and 3: ..." and "F1: ..." (`cliRepo` and `toReview` setup, every `review r3` call); report also "F2: ...".

`resolve()` in review-resolve returns the promise of the run with one added property, `status`, a promise of the run's exit status. It exists because 15 protected lines read `assert.equal(resolve(...).status, 0)`: `await` binds looser than the property access, so `(await resolve(...)).status` would need parentheses, which R3 does not allow. With the property, each such line changes by `await ` alone. The status promise has a no-op rejection handler so that a run whose status is never read does not raise an unhandled rejection; a failed run still rejects where its result or status is awaited.

`assertCwdRefused` and `assertRefused` keep their declarations as on main (synchronous, return type `void`), so their bodies start the CLI through bin/aidlc.js in a child process and their call sites are unchanged.

Guard sweep: the change adds no guard to product code; the one branch it adds to the tests, `cli()` in review-resolve starting a child process when `preload` is set, is taken by every row that passes `preload: true`.
