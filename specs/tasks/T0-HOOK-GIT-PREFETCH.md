---
id: T0-HOOK-GIT-PREFETCH
title: The hook entry starts the git rev-parse of the repository identity before it loads its modules and uses the answer when the event's working directory is the one git ran in, so git runs while the modules load instead of blocking the hook
status: todo
branch: T0-HOOK-GIT-PREFETCH
worktree: D:\wt\AIDLC\T0-HOOK-GIT-PREFETCH
allow_paths:
  - src/state/paths.ts
  - src/hooks/entry.ts
  - bin/aidlc-hook.js
  - tests/surface/hook-git-prefetch.test.ts
  - bench/baseline.json
  - docs/OPERATIONS.md
  - CHANGELOG.md
  - specs/tasks/T0-HOOK-GIT-PREFETCH.md
dod_command: npm run typecheck && node --test tests/surface/hook-git-prefetch.test.ts tests/infra/paths.test.ts tests/infra/bin-entry.test.ts tests/surface/hooks.test.ts tests/surface/hook-name.test.ts tests/surface/hook-lazy.test.ts tests/surface/bench.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts && npm run build && node bench/run.ts --check
dod_exit: 0
requirements:
  - R1. src/state/paths.ts shall read the output of `git rev-parse --git-common-dir --show-toplevel` in one function that `resolveRepoIdentity` and the new `settleRepoIdentity` both use, so both give the same identity for the same output. `prefetchRepoIdentity(cwd)` shall start that git command asynchronously with the arguments, environment, working directory and window flag `resolveRepoIdentity` uses, at most once per process, and read its output as the synchronous call reads it (exit status 0, stdout decoded as UTF-8 and trimmed; any other exit is no output, and so is more than 1 MiB on stdout or on stderr, `spawnSync`'s default `maxBuffer`, after which the child is ended). A spawn that fails (a throw, an `error` event, a child without output streams) is no lookup: `settleRepoIdentity` caches nothing for it, its promise never rejects, and `resolveRepoIdentity` asks git synchronously as on main (R3 decision 1). `settleRepoIdentity(cwd)` shall wait for that lookup and put its identity in the identity cache only when `path.resolve(cwd)` equals the resolved directory the lookup ran in and the cache holds no identity for it; in every other case it changes nothing, and `resolveRepoIdentity` asks git synchronously as on main.
  - R2. bin/aidlc-hook.js shall, after choosing the entry and before importing it, import `state/paths` beside the chosen entry (`.js` under dist/, `.ts` under src/) and call `prefetchRepoIdentity(process.cwd())`; when that module cannot be imported it starts nothing and goes on as on main. `main` in src/hooks/entry.ts shall, after reading the event and only when `hookNamesFor` names a guard for it, await `settleRepoIdentity(event.cwd ?? process.cwd())` before `dispatchHook`. No other caller (`aidlc hook <name>`, `aidlc hook auto`, the CLI, tests) starts or settles a lookup.
  - R3. The guards' decisions, outputs and order are unchanged for every event: the identity a guard reads is the one main's synchronous call gives for the same repository state, the git command still runs once per hook process for a guarded event in the directory the entry starts in, and `resolveRepoIdentity`, `dispatchHook`, `runHook` and `loadHookConfig` keep main's signatures and stay synchronous.
  - R4. bench/baseline.json shall hold the ceilings `npm run bench -- --ratchet` lowers after `npm run build` on this card's candidate; no ceiling is raised.
  - R5. docs/OPERATIONS.md Hooks shall carry, right after the paragraph on which `aidlc.config.json` the guards read, one paragraph stating what the entry starts, when its answer is used and the measured times, and leave that paragraph unchanged (tests/surface/hooks.test.ts pins it whole, its sentence on the cost of finding the root included); CHANGELOG.md Unreleased an entry beginning `- T0-HOOK-GIT-PREFETCH:`.
acceptance:
  - 1. tests/surface/hook-git-prefetch.test.ts runs `bin/aidlc-hook.js` under a preload that counts the `spawn` and `spawnSync` calls of `git` and records whether the first `spawn` came before the entry module loaded, in a git fixture whose `aidlc.config.json` freezes `contracts/`: an Edit of `contracts/a.yaml` with the event cwd equal to the process cwd is denied with the FROZEN reason, with 1 `spawn`, 0 `spawnSync` and the spawn before the entry; the same event from a subdirectory cwd is denied the same way with 1 `spawn` and 1 `spawnSync`; the same event in a linked worktree of the fixture, cwd equal to the process cwd, reads the main checkout's config (denied, while the worktree's own copy freezes nothing), with 1 `spawn` and 0 `spawnSync`; a PreToolUse Bash `git status` in the repository root exits 0 with no output, with 1 `spawn` and 0 `spawnSync`; a PreToolUse Read event (no guard) exits 0 with no output. [R1] [R2] [R3] [dod arm 2]
  - 2. tests/surface/hook-git-prefetch.test.ts, in a child process per case started in the case's directory with the same preload: `prefetchRepoIdentity` then `settleRepoIdentity` then `resolveRepoIdentity` for the fixture's main checkout, a subdirectory of it (settled from the subdirectory), its linked worktree and a directory outside git each give the literal identity the test states (main root and worktree root as the fixture's canonical paths, `isGit`, and `key` as the first 16 hex characters of the sha256 of the main root lower-cased with forward slashes), with 0 `spawnSync`; `settleRepoIdentity` for another directory than the one the lookup ran in leaves `resolveRepoIdentity` to make 1 `spawnSync` and give that directory's literal identity. [R1] [dod arm 2]
  - 3. tests/infra/paths.test.ts, tests/infra/bin-entry.test.ts, tests/surface/hooks.test.ts, hook-name.test.ts and hook-lazy.test.ts pass [dod arm 2], and the diff changes no line of them (reviewer-verified). [R1] [R2] [R3]
  - 4. `npm run build && node bench/run.ts --check` exits 0 on the candidate [dod arms 3, 4], with `spawns` 1 for every hook journey; the diff raises no ceiling (reviewer-verified). [R4]
  - 5. tests/surface/hook-git-prefetch.test.ts reads the new docs/OPERATIONS.md paragraph right after the config-discovery paragraph of Hooks and the CHANGELOG.md Unreleased entry beginning `- T0-HOOK-GIT-PREFETCH:`, and each assertion fails with any one sentence removed. [R5] [dod arm 2]
  - 6. `npm run typecheck` is clean [dod arm 1]; tests/surface/prose.test.ts and mirror.test.ts pass [dod arm 2]. [R5]
  - 7. tests/surface/hook-git-prefetch.test.ts (R3 decision 1), with the preload injecting faults into the `git` calls: when `spawn` throws (E2BIG) or returns a child without output streams that reports EMFILE, the hook entry still denies the frozen Edit with 1 `spawn` and 1 `spawnSync`, and the identity of the main checkout is its literal one with 1 `spawnSync`; when a git stand-in prints the two refs followed by more than 1 MiB on stdout, or on stderr, the identity is the literal one of a directory outside git, both settled from the lookup (0 `spawnSync`) and asked synchronously (1 `spawnSync`). [R1] [R3] [dod arm 2]
depends_on: []
budget: 100
tdd: true
sweep: "Measured at main 1664331 on Windows with Node 22.23.1 and git 2.56.0.windows.2, median of 25: `spawnSync('git', ['rev-parse', '--git-common-dir', '--show-toplevel'])` blocks for 41 ms, while `spawn` of the same command returns in 2.9 ms and git exits 41.6 ms later. A prototype of this card against main, three interleaved A/B runs of 15 over the compiled entry: PreToolUse Bash 216 to 191, 196 to 175 ms; Edit 207 to 182, 187 to 165; UserPromptSubmit 207 to 184, 198 to 167; Stop 201 to 184, 195 to 170. Callers of resolveRepoIdentity in a hook process: configDir in loadHookConfig (every guarded event), resolveStatePaths without AIDLC_STATE_DIR, verifyBeforeDone and planningArtifactsContexts; all take the event cwd. Pinned files: tests/infra/bin-entry.test.ts copies bin/aidlc-hook.js into a package with only stub entries (no state/paths), so the prefetch import must be optional; tests/infra/paths.test.ts tests resolveRepoIdentity."
forbid:
  - a guard decision, output or order that differs from main for any event (src/hooks/index.ts, src/hooks/entry.ts)
  - a second git spawn per guarded hook event in the directory the entry starts in, or a lookup started or settled by any caller but bin/aidlc-hook.js and main in src/hooks/entry.ts
  - an asynchronous resolveRepoIdentity, dispatchHook, runHook or loadHookConfig
  - a changed line in tests/infra/paths.test.ts, tests/infra/bin-entry.test.ts, tests/surface/hooks.test.ts, hook-name.test.ts or hook-lazy.test.ts
  - a ceiling in bench/baseline.json raised
non_goals:
  - a git-free reading of the repository layout (.git files, commondir); git stays the one source of the identity
  - the config stamp (zod out of the hook path), the src/ walk of bin/resolve-entry.js, the Stop hook reading every goal
  - the CLI start (bin/aidlc.js)
hygiene: "RED first: seam exports prefetchRepoIdentity and settleRepoIdentity in src/state/paths.ts that do nothing, committed before the RED run, so the tests fail on their assertions. Tests build git fixtures under a fresh mkdtemp directory removed in a finally block, build child environments without AIDLC_* variables, read no clock, and take every expected value from a literal or a requirement line."
doc_sync: docs/OPERATIONS.md, CHANGELOG.md
---

# T0-HOOK-GIT-PREFETCH

## Deliverable
Every guarded hook event asks git for the repository identity (`git rev-parse --git-common-dir --show-toplevel`) to find the config and the state directory, and on main that `spawnSync` blocks the hook for about 40 ms on Windows. After this card the hook entry starts the same command asynchronously before it loads its modules, and its answer is waiting when the guards ask, so git runs while the modules load. The answer is used only when the event's working directory is the one git ran in; any other directory, and every caller but the hook entry, asks git as before.

## The rule against main
For every hook event, the identity a guard reads equals the one main's synchronous call gives for the same repository state: the same command with the same arguments, environment and directory, read by the same function. Only the moment git runs moves, from the first guard's call to the process start, a few tens of milliseconds earlier in the same process; a repository change inside that window could be seen by either version of the hook, as it can by main between its git call and its guards.

## Decisions
- The prefetch lives in bin/aidlc-hook.js because the entry module loads only after its whole import graph has loaded, which is the work git should overlap; the bin imports `state/paths` alone first (it imports node builtins only) and the entry's graph shares that instance.
- The import is optional: tests/infra/bin-entry.test.ts runs the shipped bin over stub entries without `state/paths`, and a package where it fails to load runs as on main (the entry then fails on the same module, as before).
- `main` settles only for an event with a guard, so an event no guard handles never waits for git. `main` ends with `process.exit(result.exitCode)`, so a process that does not settle (no guard, or an event in another directory) exits without waiting on the git child, which finishes on its own; the child is not unreferenced, since the exit already ends the process (R2 cycle 0 advisory, recorded before R3).
- A failed spawn is no lookup rather than a lookup that found no repository: a transient failure (EMFILE) of the early spawn must not decide for the synchronous call main makes later, which may succeed. Output past 1 MiB is an answer, the one `spawnSync` gives for the same command (R3 decision 1).
- A git that never exits blocks the hook as on main: every guarded event reaches `resolveRepoIdentity` through `loadHookConfig` before any guard runs (`dispatchHook`), and main's `spawnSync` has no timeout either; the prefetch only moves the wait to the settle (R2 cycle 1 question, recorded before R3 decision 2).
- The overflow handler ends the child with `child.kill()` (SIGTERM), which throws only for EINVAL or ENOSYS, an invalid or unsupported signal; any other failure to deliver it arrives as an `error` event, which reads as no lookup, and the synchronous call that follows overflows the same way (R2 cycle 1 suggestion, recorded before R3 decision 2).
- Directories are compared with `path.resolve`, as the identity cache keys them; a different spelling of the same directory only costs the synchronous call main makes.
