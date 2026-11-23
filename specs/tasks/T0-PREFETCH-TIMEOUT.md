---
id: T0-PREFETCH-TIMEOUT
title: "The hook entry's early git rev-parse (prefetchRepoIdentity) is ended at the 120 s bound of the synchronous lookup and settles as not answered, so the guards ask git through the bounded synchronous lookup"
status: todo
branch: T0-PREFETCH-TIMEOUT
worktree: D:\wt\AIDLC\T0-PREFETCH-TIMEOUT
allow_paths:
  - src/state/paths.ts
  - tests/infra/git-prefetch-timeout.test.ts
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - changelog.d/T0-PREFETCH-TIMEOUT.md
  - specs/tasks/T0-PREFETCH-TIMEOUT.md
dod_command: npm run typecheck && node --test tests/infra/git-prefetch-timeout.test.ts tests/infra/git-lookup-timeout.test.ts tests/surface/hook-git-prefetch.test.ts tests/infra/cli-inprocess.test.ts tests/infra/paths.test.ts tests/infra/bin-entry.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
dod_exit: 0
review_gate: codex {verdict:pass}
requirements:
  - R1. `prefetchRepoIdentity` in `src/state/paths.ts` shall take `(cwd, spawner = spawn, timeoutMs = GIT_LOOKUP_TIMEOUT_MS)`, start git through `spawner` with the arguments and options of main at 79d91502, and start one timer of `timeoutMs` when the child has output streams. When the timer fires before the lookup has settled, the lookup shall settle as not answered (the outcome a failed spawn has on main, so `settleRepoIdentity` caches nothing and `resolveRepoIdentity` asks git through `gitOut`, bounded at `GIT_LOOKUP_TIMEOUT_MS`), and then the child shall be ended and its streams destroyed through `endChild`, each step in its own try as on main.
  - R2. The timer shall be cleared when the child closes or emits `error`, and when the output passes `MAX_OUTPUT`, and shall not keep the process alive on its own (`unref`). Every other outcome of the lookup (an answer on `close`, output past `MAX_OUTPUT`, a failed spawn, a child without streams) shall be read as on main at 79d91502.
  - R3. `bin/aidlc-hook.js`, `settleRepoIdentity`, `resolveRepoIdentity` and `gitOut` shall be unchanged; the hook entry's call `prefetchRepoIdentity(process.cwd())` takes the defaults.
  - R4. `docs/OPERATIONS.md` (the repository-lookup sentences of the doctor paragraph, whose last sentence says the early lookup has no bound), `docs/ARCHITECTURE.md` (the `paths.ts` sentence of `src/state/`) and `changelog.d/T0-PREFETCH-TIMEOUT.md` shall state the bound of the early lookup and what follows it.
acceptance:
  - 1. New file `tests/infra/git-prefetch-timeout.test.ts`, real process, in a temporary git repository made with `git init`. `prefetchRepoIdentity(dir, spawner, 500)`, with a spawner that runs the node binary with a script that never exits, with the options it receives, and that ends that child itself at 10 s (so a rule without a bound fails the assertions, not the run): `settleRepoIdentity(dir)` resolves in under 9 s, the child exits, and `resolveRepoIdentity(dir)` then gives the identity git gives for the repository (`isGit` true, `mainRoot` and `worktreeRoot` the canonical `dir`). RED on main's `prefetchRepoIdentity` with the seam parameters added and the timer absent: settle takes 10 s and the identity reads `isGit` false. [R1] [dod arm 2]
  - 2. Same file, with `mock.timers` on `setTimeout` and a spawner that runs the never-exiting script: with no `timeoutMs` given, the child is not killed after 119 999 ms and is killed at 120 000 ms (`child.kill` called once, recorded by `mock.method`), and the identity after settling is git's. The spawner receives `git`, `['rev-parse', '--git-common-dir', '--show-toplevel']` and the options `{ cwd, windowsHide: true }` of main. [R1] [R3] [dod arm 2]
  - 3. Same file, `mock.timers` on `setTimeout`: a spawner that runs the real `git` with the options it receives answers, `settleRepoIdentity` caches git's identity, and advancing the mocked clock by 120 000 ms after the answer calls no `child.kill`. [R2] [dod arm 2]
  - 4. `tests/infra/git-lookup-timeout.test.ts`, `tests/surface/hook-git-prefetch.test.ts`, `tests/infra/cli-inprocess.test.ts`, `tests/infra/paths.test.ts` and `tests/infra/bin-entry.test.ts` pass with no line changed. [R2] [R3] [dod arms 3-7]
  - 5. The typecheck is clean; the text of R4 (reviewer-verified against the diff); the fragment has the form of `changelog.d/README.md` and the prose test passes. [R4] [dod arms 1, 8, 9]
depends_on: []
budget: 160
tdd: true
sweep: "On main at 79d91502. `git grep -n -E 'spawn\\(|spawnSync\\(' -- src/state/paths.ts`: `gitOut` (bounded by T0-DOCTOR-PROBE-TIMEOUT) and the `spawn` of `prefetchRepoIdentity` (paths.ts:131), the one unbounded call. `git grep -n prefetchRepoIdentity -- src bin tests`: bin/aidlc-hook.js:19 (defaults), tests/infra/cli-inprocess.test.ts:305 and tests/surface/hook-git-prefetch.test.ts:216, 258 (one argument each, unchanged by optional parameters). `git grep -n 'has no bound' -- docs tests`: docs/OPERATIONS.md:41 only; no test pins it. docs/ARCHITECTURE.md:14 states the 120 s bound of the synchronous lookup."
forbid: [network, a change to an existing test file]
non_goals:
  - "a bound on the whole hook process, or on any spawn outside `src/state/paths.ts`"
  - "a shorter bound for the early lookup than `GIT_LOOKUP_TIMEOUT_MS`"
  - "a tree kill of git's descendants: the child is ended as the overflow path of main ends it"
diagnosis:
  root_cause: "`prefetchRepoIdentity` (src/state/paths.ts:125-162) spawns `git rev-parse` and settles only on `close`, `error` or output past `MAX_OUTPUT`; no timer. `settleRepoIdentity`, awaited by `main` in src/hooks/entry.ts:101 for every guarded event, then waits for a git that starts and does not exit until Claude Code's hook timeout ends the hook."
  same_class: "The synchronous lookup `gitOut` has had the 120 s bound since T0-DOCTOR-PROBE-TIMEOUT (PR 454), whose non_goals left this call to a follow-up (issue 456). No other spawn in src/state/."
hygiene: "Issue 456, follow-up of issue 371. Settling as not answered, not as an answer with no output: an answer with no output would cache the identity of a directory outside git, while not answered leaves the guards to `gitOut`, which has its own 120 s bound and throws an error that names the command. RED first: the seam parameters (`spawner`, `timeoutMs`) added to main's function with no timer, committed with the new test before the RED run. The test seam ends its child at 10 s (lesson of T0-DOCTOR-PROBE-TIMEOUT), uses a fresh mkdtemp directory removed in a finally block, and reads elapsed time from `performance.now()`."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, changelog.d/T0-PREFETCH-TIMEOUT.md
---

# T0-PREFETCH-TIMEOUT

From issue 456.

## Diagnosis
The hook entry starts `prefetchRepoIdentity`, an asynchronous `git rev-parse` with no time bound, and `settleRepoIdentity` waits for it before the guards run. A git that starts and does not exit holds the hook until Claude Code's hook timeout ends it.

## Deliverable
The early lookup gets the bound of the synchronous lookup, `GIT_LOOKUP_TIMEOUT_MS` (120 s). At the bound it settles as not answered and ends the child, so the guards ask git through `gitOut`, which has the same bound and throws an error that names the command, the bound and the directory.

## PR summary
### What
The hook entry's early `git rev-parse` now stops after 120 seconds, the bound the synchronous repository lookup already has.

### Why / Intent
Issue 456, follow-up of issue 371. A git that started and did not exit held every guarded hook until Claude Code's hook timeout.

### How / Behaviour
- `prefetchRepoIdentity` starts a 120 s timer beside the git child.
- At the bound the lookup settles as not answered and the child is ended, so the guards call the synchronous lookup, bounded at 120 s.
- The timer is cleared when git closes, errors or overflows, and does not keep the process alive.

### System impact
Only the hook entry's early lookup changes. Its answer, when git answers in time, is the same.

### Security
No new input or command. The child is the same `git rev-parse`.

### Tests and review
- A new test runs a child that never exits and checks that the lookup settles at the bound and the guards' identity comes from git.
- Mocked timers check the default bound and that an answered lookup is never killed.
- The existing prefetch, lookup and hook tests pass unchanged.

### Risk
Low. The bound only acts on a git that runs for 120 seconds.

### Ownership
Card `T0-PREFETCH-TIMEOUT`, issue 456.

### Docs
`docs/OPERATIONS.md` (doctor paragraph), `docs/ARCHITECTURE.md` (`src/state/`) and `changelog.d/T0-PREFETCH-TIMEOUT.md`.

## Acceptance (DoD = command + exit code + assertion; paired with the closed `acceptance:` list)
```powershell
npm run typecheck && node --test tests/infra/git-prefetch-timeout.test.ts tests/infra/git-lookup-timeout.test.ts tests/surface/hook-git-prefetch.test.ts tests/infra/cli-inprocess.test.ts tests/infra/paths.test.ts tests/infra/bin-entry.test.ts tests/surface/changelog-fragments.test.ts tests/surface/prose.test.ts
```
- Expected exit code: 0
- Assertion: the new test passes, and the prefetch, lookup, hook entry and changelog tests pass unchanged.

## Attempt evidence
| Item | Proof | Result |
|---|---|---|
