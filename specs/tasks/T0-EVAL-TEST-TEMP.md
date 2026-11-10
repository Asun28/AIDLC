---
id: T0-EVAL-TEST-TEMP
title: "The eval tests remove every temporary directory they create, so a test run leaves no `aidlc-evals-*` directory in the OS temp directory"
status: merged
branch: T0-EVAL-TEST-TEMP
worktree: D:\wt\AIDLC\T0-EVAL-TEST-TEMP
allow_paths:
  - tests/surface/evals.test.ts
  - tests/surface/command-lines.test.ts
  - tests/surface/eval-test-temp.test.ts
  - specs/tasks/T0-EVAL-TEST-TEMP.md
dod_command: npm run typecheck && node --test tests/surface/eval-test-temp.test.ts tests/surface/evals.test.ts tests/surface/command-lines.test.ts
dod_exit: 0
requirements:
  - R1. Every directory that `tests/surface/evals.test.ts` creates under `os.tmpdir()` shall be removed after the file's tests finish, also when a test fails, by one helper of that file that records each directory it creates and an `after` hook that removes the recorded directories with `cleanup` from `tests/infra/helpers.ts`; the file shall call `mkdtempSync` only inside that helper.
  - R2. The directories that the three `T1-EVAL-TRANSCRIPT-2 acceptance 9` tests of `tests/surface/command-lines.test.ts` create under `os.tmpdir()` (prefixes `aidlc-evals-state-`, `aidlc-evals-repo-`, `aidlc-evals-main-` and `aidlc-evals-wt-`) shall be removed the same way, also when a test fails.
  - R3. No assertion of either file shall change, and no test of either file shall be removed or skipped.
acceptance:
  - 1. `tests/surface/eval-test-temp.test.ts`: runs `node --test` on `tests/surface/evals.test.ts` with one `--test-name-pattern` for each of the four tests that reach its `mkdtempSync` sites at 19b0da8 (`loadEvals reads JSON cases with defaults` for `setup()`; `a file or cwd through a link that leaves the working directory` for `aidlc-evals-outside-`; `the CLI refuses --trials 0` and `with neither option, the example case` for `aidlc-evals-state-`), with `TEMP`, `TMP` and `TMPDIR` set to a new empty directory and `NODE_TEST_CONTEXT` removed from the environment: exit 0, 4 tests passed, and no entry of that directory has a name starting with `aidlc-eval`. Fails before the fix. [R1] [dod arm 1]
  - 2. Same file: the same for `tests/surface/command-lines.test.ts` with `--test-name-pattern "T1-EVAL-TRANSCRIPT-2 acceptance 9"`: exit 0, 3 tests passed, and no entry starting with `aidlc-eval` is left. Fails before the fix. [R2] [dod arm 1]
  - 3. Same file: the source of `tests/surface/evals.test.ts` contains `mkdtempSync(` exactly once. Fails before the fix. [R1] [dod arm 1]
  - 4. Same file: each directory it sets as `TEMP` is removed after its test, also when an assertion of that test fails. [R1] [R2] [dod arm 1]
  - 5. `tests/surface/evals.test.ts` and `tests/surface/command-lines.test.ts` pass with every test they have at PREPARE. [R3] [dod arm 2] [dod arm 3]
depends_on: []
budget: 80
tdd: true
diagnosis:
  root_cause: "`setup()` (tests/surface/evals.test.ts:16 at 19b0da8) and the `mkdtempSync` calls at :223, :414 and :436 of that file, and those of the three T1-EVAL-TRANSCRIPT-2 acceptance 9 tests of tests/surface/command-lines.test.ts (:129, :139, :143, :152, :158, :166), create directories under `os.tmpdir()` that no test removes."
  repro: "2026-11-10, with TEMP, TMP and TMPDIR set to a new empty directory: `node --test tests/surface/evals.test.ts` (26 pass, 146 s) left 29 directories (25 `aidlc-evals-`, 1 `aidlc-evals-outside-`, 3 `aidlc-evals-state-`); `node --test --test-name-pattern \"T1-EVAL-TRANSCRIPT-2 acceptance 9\" tests/surface/command-lines.test.ts` (3 pass, 23 s) left 6 more (`main`, `repo`, `wt`, 3 `state`). The OS temp directory of this machine held 2190 `aidlc-evals-`, 395 `aidlc-evals-state-`, 81 `aidlc-evals-repo-`, 80 `aidlc-evals-outside-`, 77 `aidlc-evals-main-` and 77 `aidlc-evals-wt-` directories. No `aidlc-eval-` directory of the runner itself was left."
  same_class: "Other test files leave directories too (OS temp directory on 2026-11-10: `aidlc-hooks-` 19208, `aidlc-audit-` 15874, `aidlc-prereview-` 10119, `aidlc-scn-` 9762, `aidlc-answer-marker-` 5652); they are not in this card. `cleanup` in tests/infra/helpers.ts passes `maxRetries: 3`, which on Node 22.23.1 does not retry an EBUSY removal (T0-EVAL-CHECKOUT-BUSY diagnosis); it is best-effort test cleanup and stays."
sweep: "grep -n mkdtempSync tests/surface/evals.test.ts tests/surface/command-lines.test.ts. Lines are from main at 19b0da8; read them again at PREPARE."
forbid: [weakening, removing or skipping a test, changing an assertion, running the whole of tests/surface/evals.test.ts from the new test (146 s), a cleanup that removes a directory the test did not create, editing .aidlc state by hand]
non_goals: [temporary directories of other test files, the eval runner's own temporary checkouts (src/evals/runner.ts), removing directories that earlier runs left, changing tests/infra/helpers.ts]
hygiene: "A child `node --test` started from a test inherits `NODE_TEST_CONTEXT` and then reports in the parent's protocol; remove it from the child's environment as tests/scenarios/finding-repro.test.ts:98 does. `os.tmpdir()` reads TEMP or TMP on Windows and TMPDIR elsewhere, so set all three."
doc_sync: none (test only)
---

# T0-EVAL-TEST-TEMP

## Deliverable
A run of the eval tests leaves no `aidlc-evals-*` directory in the OS temp directory.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/eval-test-temp.test.ts tests/surface/evals.test.ts tests/surface/command-lines.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
RED receipt: `dfe040f:1`. At dfe040f, `tests/surface/eval-test-temp.test.ts` runs 4 tests, 1 pass, 3 fail, each on its leak assertion: acceptance 1 matched exit 0, pass 4 and fail 0 but left 9 entries (5 `aidlc-evals-`, 1 `aidlc-evals-outside-`, 3 `aidlc-evals-state-`), acceptance 2 left 6 (`main`, `repo`, `wt`, 3 `state`), and acceptance 3 counted `mkdtempSync(` 4 times, not 1; acceptance 4 passes there, since it tests the new file's own TEMP helper.

| Item | Proof | Result |
| --- | --- | --- |
| 1 | tests/surface/eval-test-temp.test.ts `T0-EVAL-TEST-TEMP acceptance 1`: child `node --test --test-reporter=tap` on tests/surface/evals.test.ts with the four patterns named in the card (all four names match the file as it is), TEMP, TMP and TMPDIR set to a new `aidlc-evtemp-` directory (realpathSync.native), NODE_TEST_CONTEXT removed: exit 0, `# pass 4`, `# fail 0`, no `aidlc-eval*` entry left | pass |
| 2 | Same file, `acceptance 2`: the same for tests/surface/command-lines.test.ts with `T1-EVAL-TRANSCRIPT-2 acceptance 9`: exit 0, `# pass 3`, `# fail 0`, no `aidlc-eval*` entry left (the `main` repo and the `aidlc-evals-wt-` holder are both recorded) | pass |
| 3 | Same file, `acceptance 3`: the source of tests/surface/evals.test.ts contains `mkdtempSync(` once, inside `tempDir`, which records each directory for the module-level `after` hook that removes it with `cleanup` | pass |
| 4 | Same file, `acceptance 4`: the `inTemp` helper that sets TEMP removes its directory in a `finally`; a run whose assertion fails and a run that passes both leave their directory removed | pass |
| 5 | DoD: tests/surface/evals.test.ts 26 tests before and after, tests/surface/command-lines.test.ts 12 before and after, all pass; the diff changes no `test(` line and no assertion | pass |
