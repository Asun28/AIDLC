---
id: T1-TEST-CLI-INPROC-2
title: (replaces T1-TEST-CLI-INPROC and carries its candidate) The in-process CLI helper resets the session and repository caches before each call, runs and removes the exit handlers a call adds, and captures output written past the stream methods
status: todo
branch: T1-TEST-CLI-INPROC-2
worktree: D:\wt\AIDLC\T1-TEST-CLI-INPROC-2
plan_ref: plans/test-time.md#order-of-work
allow_paths:
  - tests/infra/cli-inprocess.ts
  - tests/infra/cli-inprocess.test.ts
  - src/state/paths.ts
  - changelog.d/T1-TEST-CLI-INPROC-2.md
  - specs/tasks/T1-TEST-CLI-INPROC-2.md
  - specs/tasks/T1-TEST-CLI-INPROC.md
  - changelog.d/T1-TEST-CLI-INPROC.md
dod_command: npm run typecheck && node --test tests/infra/cli-inprocess.test.ts tests/infra/paths.test.ts tests/surface/hook-git-prefetch.test.ts tests/surface/hook-lazy.test.ts
dod_exit: 0
requirements:
  - R1. The requirements R1 to R4 of T1-TEST-CLI-INPROC shall hold, on the carried candidate e9562d53 merged with main.
  - R2. `src/state/paths.ts` shall export one function for tests that empties the repository identity cache (`identityCache`) and drops a pending `prefetch`; no other line of `src/` shall change, and the CLI shall never call it.
  - R3. Before each call the helper shall reset the session actor (`setActorForTests(undefined)` of `src/state/journal.ts`) and the repository identity cache (R2), and after the call it shall restore the actor the caller had, so that two calls in one process with different `AIDLC_SESSION` values, or with different `GIT_DIR`/`GIT_WORK_TREE` in the same working directory, each see their own session and repository.
  - R4. The helper shall run, in registration order, each `process.on('exit')` listener that `main` adds during the call, then remove it, before restoring the caller's state; listeners present before the call shall be left as they were.
  - R5. Output a call writes past `process.stdout.write`/`process.stderr.write` (a child process started with `stdio: 'inherit'`, a synchronous write to file descriptor 1 or 2) shall be captured into the call's stdout or stderr, or the helper shall reject such a call with an error saying the case must stay a child process; the test names which of the two it does for each path.
acceptance:
  - 1. `tests/infra/cli-inprocess.test.ts`, the four T1-TEST-CLI-INPROC acceptance tests pass with no line of them changed. [R1] [dod arm 1]
  - 2. Same file, "T1-TEST-CLI-INPROC-2 acceptance 2: two calls with different AIDLC_SESSION record different authors, and two calls with different GIT_DIR in one cwd resolve different repositories, as two bin/aidlc.js children do". Fails on the carried candidate. [R2] [R3] [dod arm 1]
  - 3. Same file, "T1-TEST-CLI-INPROC-2 acceptance 3: an exit listener added by card close --cleanup runs inside the call on refusal and on success, and listeners present before the call stay". Fails on the carried candidate. [R4] [dod arm 1]
  - 4. Same file, "T1-TEST-CLI-INPROC-2 acceptance 4: output written through stdio inherit and a synchronous write to fd 2 is captured or the call is refused". Fails on the carried candidate. [R5] [dod arm 1]
  - 5. `tests/infra/paths.test.ts`, `tests/surface/hook-git-prefetch.test.ts` and `tests/surface/hook-lazy.test.ts` pass with no line changed. [R2] [dod arm 1]
depends_on: []
budget: 120
tdd: true
sweep: "Main at 1a757adb plus the carried candidate e9562d53 (branch T1-TEST-CLI-INPROC, commits 07a56be7 RED and e9562d53). Module-level state in src/: src/state/journal.ts:23 `cachedActor` (reset exists: `setActorForTests` at :67), src/state/paths.ts:50 `identityCache` keyed by `path.resolve(cwd)` only (no reset; comment at :45-48 says so) and :85 `prefetch`. Tests reading the identity cache or prefetch: tests/infra/paths.test.ts, tests/surface/hook-git-prefetch.test.ts, tests/surface/hook-lazy.test.ts, tests/surface/hooks.test.ts, tests/surface/outcome-summary.test.ts, tests/surface/outcome-usage.test.ts. Exit listener: src/cli/main.ts:740 (`card close --cleanup/--all`). Inherited stdio: src/cli/main.ts:870 (scaffold `card start/red/ship/cleanup` runs pwsh with `stdio: 'inherit'`). R3 decision 1 of T1-TEST-CLI-INPROC: .review/T1-TEST-CLI-INPROC.r3.1.40705c9a.json in its worktree."
forbid:
  - a change under src/ other than the export of R2 and the comment above `identityCache` that says the cache has no reset
  - weakening, skipping or deleting a test to go green, or changing a line of an existing test outside tests/infra/cli-inprocess.test.ts
non_goals: [converting any existing test file (T1-TEST-INPROC-A, T1-TEST-INPROC-B), running `watch` in-process]
hygiene: "Replaces T1-TEST-CLI-INPROC, which R3 decision 1 blocked on four findings (two caches in src/ shared across calls, an exit listener left behind, output past the stream methods); fixing the cache of src/state/paths.ts needs a src change its forbid list rules out. Owner decision 2026-11-20 in the session: a successor card with the smallest src reset. Start the branch from T1-TEST-CLI-INPROC (carries e9562d53), merge main, and set specs/tasks/T1-TEST-CLI-INPROC.md to `superseded_by: T1-TEST-CLI-INPROC-2`. Changelog entry in changelog.d/T1-TEST-CLI-INPROC-2.md; the carried changelog.d/T1-TEST-CLI-INPROC.md is renamed into it."
---

# T1-TEST-CLI-INPROC-2

## Deliverable
Tests can run several CLI commands in one process, each with its own session and repository, with the same result as through `bin/aidlc.js` and no exit handler or output escaping the call.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/cli-inprocess.test.ts tests/infra/paths.test.ts tests/surface/hook-git-prefetch.test.ts tests/surface/hook-lazy.test.ts
```
- Expected exit code: 0
- Assertion: the carried and new acceptance tests pass; the three paths tests pass unchanged.
