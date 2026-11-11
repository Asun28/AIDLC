---
id: T0-TEST-TEMP-CLEANUP
title: The test helper tmpDir registers each directory at creation for removal at process exit, and the fixtures that left 91 percent of the leaked temporary directories use it
status: todo
branch: T0-TEST-TEMP-CLEANUP
worktree: D:\wt\AIDLC\T0-TEST-TEMP-CLEANUP
allow_paths:
  - tests/infra/helpers.ts
  - tests/scenarios/_harness.ts
  - tests/surface/hooks.test.ts
  - tests/surface/verifier.test.ts
  - tests/surface/pre-review.test.ts
  - tests/surface/test-temp-cleanup.test.ts
  - specs/tasks/T0-TEST-TEMP-CLEANUP.md
dod_command: npm run typecheck && node --test tests/surface/test-temp-cleanup.test.ts tests/surface/hooks.test.ts tests/surface/verifier.test.ts tests/surface/pre-review.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/review-admit-strand.test.ts tests/surface/eval-test-temp.test.ts
dod_exit: 0
requirements:
  - R1. `tmpDir(prefix = 'aidlc-', parent = os.tmpdir())` in tests/infra/helpers.ts shall create the directory with `mkdtempSync(path.join(parent, prefix))`, record it in a module-level set at that moment, and register once per process a `process.once('exit')` handler that removes every recorded directory with `removeTempDirs`; an existing call `tmpDir()` keeps its prefix `aidlc-` and its `os.tmpdir()` parent, and `cleanup` stays as it is.
  - R2. `removeTempDirs(remove?)` (new, tests/infra/helpers.ts) shall remove each recorded directory synchronously with `rmSync(dir, { recursive: true, force: true, maxRetries: 3 })` (or the `remove` it is given, for its own test) and drop it from the set; IF a removal throws (on Windows EBUSY or EPERM while a process or an open handle still holds the directory, after the three retries), THEN it writes one line `aidlc tests: could not remove <dir> (<code>)` to stderr, leaves that directory, goes on with the others, returns the directories it left, and never throws, sets `process.exitCode` or fails a test.
  - R3. Ownership rule: the process that creates a directory through `tmpDir` owns its removal, and a process it starts with that directory as its working directory or argument shall be done with it before the owner exits; a child process never creates through `tmpDir` a directory its parent reads after the child exits. The helper's JSDoc states this rule.
  - R4. `makeFixture` (tests/scenarios/_harness.ts:53) and every `mkdtempSync` call of tests/surface/hooks.test.ts (:19 `envWithState`, :126, :646, :808 module scope, :855, :1312 `repoWithWorktree`), tests/surface/verifier.test.ts (:17 `fixture`) and tests/surface/pre-review.test.ts (:22 `fixtureCard`, :493, :1343 `readAngle`) shall create their directory with `tmpDir(<the same prefix>)`; a `realpathSync.native` around the call and the site's own removal (`cleanup`, `rmSync`, `fx.cleanup()`) stay, and the imports the change leaves unused are removed. The three scenario files that never call `fx.cleanup()` (tests/scenarios/op-intent-dup.test.ts, review-admit-foreign.test.ts, review-admit-strand.test.ts) are covered through `makeFixture` without a change.
acceptance:
  - 1. `tests/surface/test-temp-cleanup.test.ts` "a directory from tmpDir is removed when its process exits": a child `node` process that imports tests/infra/helpers.ts, creates a `tmpDir('aidlc-tt-')`, writes a file in it, prints the path and exits 0 leaves no directory at that path, and exits 0. Fails on main (main's `tmpDir` only creates, helpers.ts:7-9, so the directory is still there: a behavioural RED). [R1] [dod arm 1]
  - 2. Same file, "the owner removes a directory its child used once the child is done": a child process P creates a `tmpDir`, starts a grandchild with that directory as its working directory, waits for it to exit, then exits; the directory is gone. Fails on main. [R1] [R3] [dod arm 1]
  - 3. Same file, "a removal that fails is reported and left, and the others are removed": in a child process, `removeTempDirs` with a remover that throws an EBUSY error for one of three recorded directories returns that one, removes the two others, writes the line of R2 naming it to stderr, throws nothing, and the child exits 0. On main the export does not exist; the behavioural RED of this card is acceptance 1, 2 and 4. [R2] [dod arm 1]
  - 4. Same file, "the fixtures that leaked leave nothing in the temporary directory": a child `node --test` with `TEMP`, `TMP` and `TMPDIR` set to a new empty directory and `NODE_TEST_CONTEXT` removed, run on tests/surface/hooks.test.ts with the name patterns "production-gate: non-production commands pass" and "T0-HOOK-CONFIG-DISCOVERY acceptance 1", on tests/surface/verifier.test.ts with "Q12: intact journal", on tests/surface/pre-review.test.ts with "buildPreReviewPrompt carries the policy", "T1-REVIEW-FINDINGS-4 R3 decision 2" and "T0-R2-ANSWER-MARKER acceptance 1", and on tests/scenarios/op-intent-dup.test.ts with "acceptance 1: a failed OPERATION_INTENT append", exits 0 with every selected test passed and leaves no entry whose name starts with `aidlc-` in that directory. Fails on main (the prefixes `aidlc-hooks-`, `aidlc-discovery-`, `aidlc-audit-`, `aidlc-prereview-`, `aidlc-panel-join-`, `aidlc-answer-marker-` and `aidlc-scn-` are left). [R1] [R4] [dod arm 1]
  - 5. Regression controls: tests/surface/hooks.test.ts, tests/surface/verifier.test.ts, tests/surface/pre-review.test.ts, tests/scenarios/op-intent-dup.test.ts, review-admit-foreign.test.ts, review-admit-strand.test.ts and tests/surface/eval-test-temp.test.ts pass, and no assertion, test name or test count of any file in allow_paths changes. [R4] [dod arm 1]
depends_on: []
budget: 260
tdd: true
diagnosis:
  root_cause: "Fixtures create directories with `mkdtempSync` under the OS temporary directory and remove them only when the test reaches its own `cleanup`: `envWithState` (tests/surface/hooks.test.ts:19), `repoWithWorktree` (:1312), `fixture` (tests/surface/verifier.test.ts:17), `fixtureCard`, the panel-join test and `readAngle` (tests/surface/pre-review.test.ts:22, 493, 1343) remove nothing, and `makeFixture` (tests/scenarios/_harness.ts:53) is never cleaned up by tests/scenarios/op-intent-dup.test.ts, review-admit-foreign.test.ts, review-admit-strand.test.ts and two of the three fixtures of journal-owed.test.ts."
  repro: "On 2026-11-11 the OS temporary directory of this machine held 71,508 aidlc- directories; the prefixes of this card: aidlc-hooks- 17,845, aidlc-audit- 16,796, aidlc-prereview- 11,826, aidlc-scn- 10,639, aidlc-answer-marker- 6,480, aidlc-discovery- 945, aidlc-panel-join- 359 (64,890, 91 percent). The rest is card T0-TEST-TEMP-SWEEP."
  same_class: "Every other mkdtempSync site of tests/ is card T0-TEST-TEMP-SWEEP, which also adds the check. tests/infra/exec.test.ts:359-382 already ends its processes before it removes its directory, the order R3 states."
sweep: "git grep -n 'mkdtemp' -- tests/infra/helpers.ts tests/scenarios/_harness.ts tests/surface/hooks.test.ts tests/surface/verifier.test.ts tests/surface/pre-review.test.ts at 6c1a6cfd, each call located with the TypeScript AST. Changed: helpers.ts:8 [tmpDir] (R1); _harness.ts:53 [makeFixture]; hooks.test.ts:19 [envWithState], 126, 646, 808 [module scope], 855, 1312 [repoWithWorktree]; verifier.test.ts:17 [fixture]; pre-review.test.ts:22 [fixtureCard], 493, 1343 [readAngle]. git grep -n 'makeFixture(' -- tests lists the users of `_harness.ts`; those that call `fx.cleanup()` keep calling it. Tests that pin behaviour touched: tests/surface/eval-test-temp.test.ts acceptance 1, 2 and 4 (children leave no aidlc-eval entry, which the exit handler keeps true). No test asserts that a temporary directory survives its test."
forbid:
  - changing, removing or skipping an assertion or a test, or changing a test name
  - a removal of a directory the helper did not create, or of the temporary directory itself
  - failing a test, or changing the exit code of a test process, because a directory could not be removed
  - any change under src/
  - deleting the directories earlier runs left in the OS temporary directory
  - editing .aidlc state by hand
non_goals:
  - the other mkdtempSync sites of tests/ and the check that refuses a new one (card T0-TEST-TEMP-SWEEP)
  - deleting the 71,508 directories already in the OS temporary directory
  - temporary files the product code creates (the eval runner checkouts, the exec tree helper)
  - a removal at the end of each test instead of at normal process exit
  - a process that is killed (SIGKILL, a timeout of the test runner) before its exit handler runs; its directories are left
hygiene: "Line numbers are from main at 6c1a6cfd; run the sweep again at PREPARE. The child runs of acceptance 4 follow tests/surface/eval-test-temp.test.ts: `--test-reporter=tap`, one `--test-name-pattern` per pattern, `NODE_TEST_CONTEXT` removed, all three temporary-directory variables set, since `os.tmpdir()` reads TEMP or TMP on Windows and TMPDIR elsewhere. A test-only card adds no CHANGELOG entry, as T0-EVAL-TEST-TEMP did not."
doc_sync: none (test only)
---

# T0-TEST-TEMP-CLEANUP

## Deliverable
Every migrated test directory is registered at creation for best-effort synchronous removal at normal process exit. A removal that fails is reported on stderr and the test is not failed. A process that is killed can leave directories. This card migrates `makeFixture` and the fixtures of hooks, verifier and pre-review, which left 91 percent of the leaked directories.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/surface/test-temp-cleanup.test.ts tests/surface/hooks.test.ts tests/surface/verifier.test.ts tests/surface/pre-review.test.ts tests/scenarios/op-intent-dup.test.ts tests/scenarios/review-admit-foreign.test.ts tests/scenarios/review-admit-strand.test.ts tests/surface/eval-test-temp.test.ts
```
- Expected exit code: 0
- Assertion: every acceptance test above passes.

## Attempt evidence
| item | test or command | result |
|---|---|---|
| 1 | test-temp-cleanup.test.ts "a directory from tmpDir is removed when its process exits" | pass (fails on main: directory left) |
| 2 | same file, "the owner removes a directory its child used once the child is done" | pass (fails on main) |
| 3 | same file, "a removal that fails is reported and left, and the others are removed" | pass (fails on main: no export removeTempDirs) |
| 4 | same file, "the fixtures that leaked leave nothing in the temporary directory" | pass (fails on main: aidlc-hooks-, -discovery-, -audit-, -prereview-, -panel-join-, -answer-marker-, -scn- left) |
| 5 | dod_command, exit 0: tests 196, pass 192, fail 0, skipped 4 (the skips exist on main) | pass |
