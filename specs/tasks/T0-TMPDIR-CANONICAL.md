---
id: T0-TMPDIR-CANONICAL
title: "tmpDir of tests/infra/helpers.ts returns the canonical path, and the 32 calls that canonicalized its result by hand stop doing so"
status: todo
branch: T0-TMPDIR-CANONICAL
worktree: D:\wt\AIDLC\T0-TMPDIR-CANONICAL
allow_paths:
  - tests/infra/helpers.ts
  - tests/infra/base-sync.test.ts
  - tests/infra/dod-shell.test.ts
  - tests/infra/git-min-version.test.ts
  - tests/scenarios/board-watch.test.ts
  - tests/scenarios/mutants-review.test.ts
  - tests/scenarios/ship-effect-unknown.test.ts
  - tests/surface/hook-git-prefetch.test.ts
  - tests/surface/hook-lazy.test.ts
  - tests/surface/hooks.test.ts
  - tests/surface/lease-heartbeat.test.ts
  - tests/surface/lesson-match.test.ts
  - tests/surface/mutants.test.ts
  - tests/surface/outcome-duckdb.test.ts
  - tests/surface/outcome-first-decision.test.ts
  - tests/surface/outcome-github.test.ts
  - tests/surface/outcome-ingest.test.ts
  - tests/surface/outcome-summary.test.ts
  - tests/surface/outcome-usage.test.ts
  - tests/surface/review-bench-export.test.ts
  - tests/surface/review-bench-formal-command.test.ts
  - tests/surface/review-bench-order-pre.test.ts
  - tests/surface/review-bench-rounds.test.ts
  - tests/surface/review-bench.test.ts
  - tests/surface/test-temp-cleanup.test.ts
  - specs/tasks/T0-TMPDIR-CANONICAL.md
dod_command: npm run typecheck && npm run check:tree && node --test tests/infra/base-sync.test.ts tests/infra/dod-shell.test.ts tests/infra/git-min-version.test.ts tests/scenarios/ship-effect-unknown.test.ts tests/surface/hook-lazy.test.ts tests/surface/lease-heartbeat.test.ts tests/surface/lesson-match.test.ts tests/surface/outcome-duckdb.test.ts tests/surface/outcome-first-decision.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-summary.test.ts tests/surface/outcome-usage.test.ts tests/surface/test-temp-cleanup.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `tmpDir` of `tests/infra/helpers.ts` shall create its directory under `realpathSync.native` of the parent, the default parent included, and return that path.
  - R2. No test file shall pass a `tmpDir` call directly to `realpathSync.native`.
acceptance:
  - 1. `tests/surface/test-temp-cleanup.test.ts`, one new test through a child process. With a directory link (`symlinkSync`, type `junction`) as the temporary directory, `tmpDir` called without a parent, and called with the link as its parent, each return a path whose directory is `realpathSync.native` of the link's target; after the child exits the directory is gone, the target is empty and the link and the target remain. A parent that does not exist throws `ENOENT`. RED on main, where the returned path lies under the link; the `ENOENT` case passes there too. [R1] [dod arm 3]
  - 2. Each of the 32 calls in the 24 other files of `allow_paths` under `tests/` reads `tmpDir(...)`, an import of `realpathSync` that this leaves unused is removed, and nothing else of those files changes apart from the new test of item 1 and its imports (reviewer-verified against the diff). The tests of the 13 files in the DoD pass; CI runs the other 11. [R2] [dod arm 3]
  - 3. The typecheck is clean and `npm run check:tree` passes. [dod arms 1, 2]
depends_on: []
budget: 170
tdd: true
sweep: "On main at 4c8b16c3 `git grep -F 'realpathSync.native(tmpDir('` finds 32 calls in 24 files, as at 15aa96e4; 21 of the 24 then have an import of `realpathSync` to remove. Suite on Windows in clones of 15aa96e4, 4,272 tests each, with the change and without it, under a temporary directory spelled as a short 8.3 path and under the normal one: 4,239 pass, 0 fail, 33 skipped in all four (with the change under the normal one on its second run; another session reinstalled `node_modules`, which the clones share, during the first, and packages were missing). So the suite does not depend on the wrappers once `tmpDir` changes, and no test that ran depends on the path as given. At 4c8b16c3 the test of item 1 fails without the change and passes with it, the typecheck is clean, `check:tree` passes and the 24 files pass under the short path in 8 minutes on a machine that ran other suites, near the 9 minutes the loop gives a DoD (`LOOP_DOD_TIMEOUT_MS`), so the DoD leaves out the 11 files of the slow tests and takes 1 minute; the whole diff is 137 lines."
forbid: [network]
non_goals:
  - "a `realpathSync.native` of anything other than a direct `tmpDir` call (a path below a fixture, a comparison, a `GIT_CEILING_DIRECTORIES` pair, a helper that keeps the path in a constant first): it stays and returns the same path"
  - "the three other helpers that make a directory (`tempDir` of evals.test.ts and of command-lines.test.ts, `inTemp` of eval-test-temp.test.ts)"
  - "a check that refuses a new wrapped call, which would be redundant and harmless"
  - "lessons T0-WORKTREE-RECLAIM-2, T1-BOARD-WATCH-2 and T0-PREPARE-WORKTREE-2, which stay true for a path that does not come from `tmpDir`; a changelog fragment, since no file of the package changes"
hygiene: "From `intent/codebase-first-study.md`, proposal 3. The parent is made canonical before the directory is created, so no failure leaves a directory that is not recorded for removal. RED first: the test of item 1 alone. The test compares with `realpathSync.native` of the target, not with another result of `tmpDir`. A test that needs an alias makes one itself, as context-pack.test.ts does with the 8.3 name. Run this card beside no card that allows one of these files; T1-OUTCOME-HISTORY, stopped, allows three of them. Not verified before the card runs: Linux and macOS."
---

# T0-TMPDIR-CANONICAL

From `intent/codebase-first-study.md` (proposal 3, accepted on 2026-11-25).

## Why
`tmpDir` returns the temporary directory as the environment spells it. On the Windows CI runner that is a short 8.3 path, so a test that compares it with a path the CLI made canonical passes locally and fails in CI. Three lessons (2026-11-08 to 2026-11-10) each name a missed site, and 32 calls now canonicalize by hand.

## Deliverable
One line of `tmpDir` changes, and the 32 calls lose their wrapper. Tests that forget it behave as those that had it.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && npm run check:tree && node --test tests/infra/base-sync.test.ts tests/infra/dod-shell.test.ts tests/infra/git-min-version.test.ts tests/scenarios/ship-effect-unknown.test.ts tests/surface/hook-lazy.test.ts tests/surface/lease-heartbeat.test.ts tests/surface/lesson-match.test.ts tests/surface/outcome-duckdb.test.ts tests/surface/outcome-first-decision.test.ts tests/surface/outcome-ingest.test.ts tests/surface/outcome-summary.test.ts tests/surface/outcome-usage.test.ts tests/surface/test-temp-cleanup.test.ts
```
- Expected exit code: 0
- Assertion: `tmpDir` returns a canonical path under an aliased parent, and the 13 files of the DoD pass without their wrappers.
