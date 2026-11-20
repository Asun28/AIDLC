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

## Attempt evidence

| Item | Proof | Result |
|---|---|---|
| 1 | `tests/infra/cli-inprocess.test.ts`, the four T1-TEST-CLI-INPROC tests, no line changed (`git diff e9562d53 -- tests/infra/cli-inprocess.test.ts` adds imports and a second `describe` only) | pass |
| 2 | "T1-TEST-CLI-INPROC-2 acceptance 2": `intent new` authors equal the session of each call, as two children; two `GIT_DIR`/`GIT_WORK_TREE` calls from one cwd write into their own repository, as two children; an identity the caller cached is not seen by a call and a call's identity is not seen by the caller; the caller's actor is restored (a set actor stays, with none the cache stays empty). RED on 283328ab: author `default-1debdfbf` for `inproc-a` | pass |
| 3 | "T1-TEST-CLI-INPROC-2 acceptance 3": `card close --cleanup` refused at load (status 1) and `card close --all` (status 0) each report `worktree removed: T0-FINISHED` in the call's stderr, the worktree is gone when the call returns, `process.rawListeners('exit')` equals its value before, a listener present before is not called. RED on 283328ab: stderr held only the refusal line | pass |
| 4 | "T1-TEST-CLI-INPROC-2 acceptance 4": both paths captured, none refused. Scaffold `card start` (pwsh with `stdio: 'inherit'`, input fed) equals the child; `card red` writes 1,100,000 bytes whole; `card close` refused at load equals the child's status, stdout and stderr (the `writeSync(2)` sweep note) with temp paths, goal ids and times normalized; `fs.writeSync` and `spawnSync` are the originals after the calls. RED on 283328ab: stdout and stderr empty for `card start` | pass |
| 5 | `tests/infra/paths.test.ts`, `tests/surface/hook-git-prefetch.test.ts`, `tests/surface/hook-lazy.test.ts`, unchanged, in the DoD | pass |

R2: `src/state/paths.ts` gains `resetRepoIdentityForTests` (empties `identityCache`, drops `prefetch`) and the comment above `identityCache` now names it; no other line of `src/` changes and `src/` never calls it. R3 without a change to `journal.ts`: the caller's cached actor is read as `currentActor({ AIDLC_SESSION: <probe> })`, which returns a cached actor unchanged and otherwise returns the probe session without I/O; the probe is dropped by the reset before the call.

Not covered: an async `spawn` with inherited stdio is neither captured nor refused; no path in `src/` uses one (the only `stdio: 'inherit'` is `src/cli/main.ts:870`, a `spawnSync`).

Guard sweep (each guard loosened, the test file run, then restored):

| Guard | Loosened form | Failed |
|---|---|---|
| actor reset before the call | dropped | INPROC acceptance 1, INPROC-2 acceptance 2 |
| identity reset before the call | dropped | INPROC-2 acceptance 2 |
| caller actor restored | not restored / restored as none | INPROC-2 acceptance 2 (each) |
| identity reset after the call | dropped | INPROC-2 acceptance 2 |
| probe: no cached actor when the probe session comes back | always the returned actor | INPROC-2 acceptance 2 |
| exit listeners: only those added in the call | all listeners | INPROC acceptance 1, INPROC-2 acceptance 3 |
| added exit listeners removed | not removed | equivalent: `main` adds its listener with `process.once`, whose wrapper removes itself when called; a `process.on` listener would stay, and `src/` adds none |
| added exit listeners run | not run | INPROC-2 acceptance 3, 4 |
| listeners run inside the call context | run outside | INPROC-2 acceptance 3, 4 |
| writeSync: fd 1 captured | fd 2 only | equivalent: `src/` has no `writeSync(1, ...)` |
| writeSync: fd 2 captured | fd 1 only | INPROC-2 acceptance 3, 4 |
| writeSync: only writes inside the call | all fd 1/2 writes | equivalent: nothing outside a call writes to fd 1 or 2 with `writeSync` while one runs |
| spawnSync: only inside the call | all | equivalent: no `spawnSync` with inherited stdio runs outside a call while one runs |
| spawnSync: unchanged when nothing is inherited | early return dropped | equivalent: the call then only adds `maxBuffer: Infinity` to a piped spawn, and no spawn in the tests passes 1 MiB |
| spawnSync: inherited stdin fed `input` | not fed | INPROC-2 acceptance 4 |
| spawnSync: `maxBuffer` raised | default | INPROC-2 acceptance 4 |
| spawnSync: child stdout / stderr forwarded | each dropped | INPROC-2 acceptance 4 (each) |
| wrappers synced into ESM bindings | not synced | the run did not finish: pwsh inherited the test runner's stdin and waited; the sweep's 400 s timeout ended it (no pwsh left, checked by command line) |
| wrappers restored | not restored | INPROC-2 acceptance 4 |

### Repair after R3 decision 1 (candidate 2a2341d6)

RED on 7a453d5b: the probe-collision test failed (the caller's actor with session `runCliInProcess-no-cached-actor` came back as a fresh actor) and the win32 case test failed (`lower-session`, child `upper-session`). The prefetch test passed on that commit and failed with `prefetch = undefined;` removed from `resetRepoIdentityForTests` (the later lookup took the pending prefetch's repository).

- F1: the probe session is a fresh `randomUUID()` per call, so no session a caller can hold is reserved. Test: "a caller keeps its cached actor whatever its session, the former probe value included".
- F2: "resetRepoIdentityForTests drops a pending prefetch, so a later lookup does not take its answer": a prefetch started with `GIT_DIR`/`GIT_WORK_TREE` naming another repository, then the reset, then `settleRepoIdentity` and `resolveRepoIdentity` resolve without that repository.
- F3: the call's environment is built as Node's `normalizeSpawnArguments` builds a child's (read in the installed Node 22.23.1 binary): every enumerable key including inherited ones; on win32 keys sorted and only the first of those equal apart from case kept; then undefined values dropped. Tests: "env keys that differ only in case resolve as in a bin/aidlc.js child on win32" (skipped elsewhere by platform; both insertion orders) and "an env key inherited from the prototype of the env object reaches the call as it reaches a bin/aidlc.js child".

Input forms and the tests that cover them:

| Input form | Test |
|---|---|
| caller actor: none / set / set with the former probe session | INPROC-2 acceptance 2 (restored set, restored none), "a caller keeps its cached actor whatever its session" |
| env key with an undefined value | INPROC acceptance 1 (doctor session line) |
| env key added for the call | INPROC acceptance 2 (`AIDLC_INPROC_PROBE`) |
| env keys equal apart from case, both orders (win32) | "env keys that differ only in case" |
| env key inherited from the env object's prototype | "an env key inherited from the prototype" |
| `GIT_DIR`/`GIT_WORK_TREE` per call, caller-cached identity | INPROC-2 acceptance 2 |
| pending prefetch at reset | "resetRepoIdentityForTests drops a pending prefetch" |

Guard sweep of the repair (each loosened, the test file run, then restored):

| Guard | Loosened form | Failed |
|---|---|---|
| probe: uncached when the probe session comes back | always uncached | INPROC-2 acceptance 2, "a caller keeps its cached actor" |
| same | always cached | INPROC-2 acceptance 2 |
| probe value random | fixed `runCliInProcess-no-cached-actor` | "a caller keeps its cached actor" |
| win32 branch | off | "env keys that differ only in case" |
| win32: keys sorted | not sorted | same |
| win32: dedupe ignores case | case-sensitive | same |
| undefined values dropped | kept as `"undefined"` | INPROC acceptance 1 |
| inherited keys included | own keys only | "an env key inherited from the prototype" |
| keys absent from the call deleted | not deleted | INPROC acceptance 1, 2; INPROC-2 acceptance 2, 3, 4 |
| `resetRepoIdentityForTests`: `prefetch = undefined` | dropped | "drops a pending prefetch" |
| `resetRepoIdentityForTests`: `identityCache.clear()` | dropped | INPROC-2 acceptance 2 |

### Repair after R3 decision 2 (candidate 8a353cf6)

RED on 5354c8f3: the `__proto__` test failed (pwsh printed `proto=` in the call, `proto=call-marker` in the child) and the setup test failed (the call after a throwing env getter rejected with "a call is already running").

- F1: Node passes an own `__proto__` env entry to a child (checked with a probe on Node 22.23.1: an own `__proto__` of a plain, null-prototype, spread or `JSON.parse` object, and `process.env.__proto__`, all reach the child). `childEnv` now builds a null-prototype dictionary, so the entry is an ordinary key in the call's environment and in the saved caller environment that is restored; `replaceEnv` writes `process.env[key]`, which sets the variable.
- F2: `running` is released in an outer `finally` around everything after it is taken; the work moved into `runOnce`.

Setup steps and the tests for a failure in each:

| Step | Where | Test |
|---|---|---|
| nested-call refusal | before the guard is taken, takes nothing | INPROC acceptance 3 |
| reading `options.env` (`childEnv`, getters run) | inside the outer `try` | "a call whose setup throws": rejects, state equal, next call succeeds |
| snapshot of the caller (`saved`: cwd, env, exitCode, exit, writers, stdin and isTTY descriptors, actor probe, exit listeners, writeSync, spawnSync) | inside the outer `try`; reads only, the actor probe's cache is reset in the inner `finally` | same test (state equal after) |
| env swap, `chdir` to a missing directory | first steps of the inner `try`, restored by its `finally` | "a call whose setup throws" (`no-such-dir`: rejects ENOENT, state equal, next call succeeds) |
| exit, writers, isTTY, stdin, writeSync, spawnSync, actor and identity resets | inside the inner `try` | INPROC acceptance 2, INPROC-2 acceptance 4 (originals after the calls) |

Guard sweep of this repair:

| Guard | Loosened form | Failed |
|---|---|---|
| null-prototype env dictionary | `{}` | "an env entry named __proto__" |
| `options.env` read inside the released region | read before the outer `try` | "a call whose setup throws" |
| `running = false` in the outer `finally` | dropped | 12 of 13 tests |
| env swap and `chdir` inside the restoring `try` | before it | "a call whose setup throws" |
