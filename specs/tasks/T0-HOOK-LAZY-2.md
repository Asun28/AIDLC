---
id: T0-HOOK-LAZY-2
title: The hook guards load the router, the goal, lease and journal stores and the planning claims on first use, so a hook event that reads no state over a usable config loads no yaml; the config check with zod is unchanged
status: merged
branch: T0-HOOK-LAZY-2
worktree: D:\wt\AIDLC\T0-HOOK-LAZY-2
allow_paths:
  - src/hooks/index.ts
  - src/hooks/lazy.ts
  - tests/surface/hook-lazy.test.ts
  - bench/baseline.json
  - docs/OPERATIONS.md
  - docs/ARCHITECTURE.md
  - CHANGELOG.md
  - specs/tasks/T0-HOOK-LAZY-2.md
  - specs/tasks/T0-HOOK-LAZY.md
dod_command: npm run typecheck && node --test tests/surface/hook-lazy.test.ts tests/surface/hooks.test.ts tests/surface/hook-name.test.ts tests/surface/fix-task-clear.test.ts tests/surface/bench.test.ts tests/surface/prose.test.ts tests/surface/mirror.test.ts && npm run build && node bench/run.ts --check
dod_exit: 0
requirements:
  - R1. src/hooks/index.ts shall import none of `src/core/router.ts`, `src/state/goal-store.ts`, `src/state/journal.ts`, `src/state/claims.ts` and `src/coordination/lease.ts` statically; a guard loads each on first use through `src/hooks/lazy.ts`, which lists them in its exported `LAZY_MODULES` and loads each with `require` from `createRequire` (node:module) and the extension of lazy.ts's own file (`.ts` under src/, `.js` under dist/). The value imports of src/hooks/index.ts and src/hooks/entry.ts, followed through every module they reach, shall reach no `yaml` package import. The texts that name a config that cannot be used (the denials and the prompt line) quote its path with `quotePath` of the planning claims, so such an event loads them and yaml, as every event did on main (R2 cycle 1 advisory, recorded before R3 decision 2).
  - R2. The guards' decisions, outputs and order are unchanged: `loadHookConfig` checks every config text with `ProjectConfig` as on main, no stamp or other state is read or written, and `runHook`, `dispatchHook` and `loadHookConfig` keep main's signatures and stay synchronous. A module of `LAZY_MODULES` that fails to load throws a `LazyLoadError` (src/hooks/lazy.ts) naming it, and every catch in src/hooks/index.ts rethrows it before its own handling, so it reaches the hook entry, which writes `[aidlc hook] cannot load <module>: <cause>` on stderr and exits 0, as for any throw of a guard (R3 decision 1).
  - R3. bench/baseline.json shall hold the ceilings `npm run bench -- --ratchet` lowers after `npm run build` on this card's candidate; no ceiling is raised.
  - R4. docs/OPERATIONS.md Hooks shall carry, after its first paragraph, one paragraph stating which modules load on first use, that the config check with zod runs on every event as before, and the measured times; docs/ARCHITECTURE.md one sentence on `src/hooks/lazy.ts` after the hooks sentence; CHANGELOG.md Unreleased an entry under this card id; specs/tasks/T0-HOOK-LAZY.md `superseded_by: T0-HOOK-LAZY-2`.
acceptance:
  - 1. tests/surface/hook-lazy.test.ts runs `bin/aidlc-hook.js` with `bench/counter.ts` in the repository root over a fresh state directory for a PreToolUse Bash event (`git status`), a PreToolUse Edit event and a Stop event: each exits 0 with no output, and the dependencies it loads are exactly zod. [R1] [R2] [dod arm 2]
  - 2. tests/surface/hook-lazy.test.ts: every `LAZY_MODULES` entry names a file under src/ with the `.ts` extension; each loader of lazy.ts returns the namespace object `import()` of that file returns; the static value imports of src/hooks/index.ts and src/hooks/entry.ts name none of `LAZY_MODULES`, and the packages their value imports reach, followed from the source text, are exactly `zod`. [R1] [dod arm 2]
  - 3. tests/surface/hooks.test.ts, hook-name.test.ts and fix-task-clear.test.ts pass [dod arm 2], and the diff changes no line of them (reviewer-verified); the diff changes no line of `loadHookConfig`, `runHook` or `dispatchHook` and no file under src/ other than src/hooks/index.ts and src/hooks/lazy.ts (reviewer-verified). [R2]
  - 4. `npm run build && node bench/run.ts --check` exits 0 on the candidate [dod arms 3, 4]; tests/surface/hook-lazy.test.ts reads bench/baseline.json and finds `depBytes` of `hook.pre-bash`, `hook.pre-edit`, `hook.prompt` and `hook.stop` at most 853346 (zod's source bytes, yaml's 287635 gone); the diff raises no ceiling (reviewer-verified). [R3] [dod arm 2]
  - 5. tests/surface/hook-lazy.test.ts reads the new docs/OPERATIONS.md Hooks paragraph whole, the docs/ARCHITECTURE.md sentence, the CHANGELOG.md entry beginning `- T0-HOOK-LAZY-2:` and the `superseded_by` line of specs/tasks/T0-HOOK-LAZY.md, and each assertion fails with any one sentence removed. [R4] [dod arm 2]
  - 6. `npm run typecheck` is clean [dod arm 1]; tests/surface/bench.test.ts, prose.test.ts and mirror.test.ts pass [dod arm 2]. [R1] [R3]
  - 7. tests/surface/hook-lazy.test.ts (R3 decision 1) runs the hook entry of a copy of src/ and bin/ over a git repository whose goal has a BUILD run without a DoD receipt and a goal lease the session holds: intact, the Stop event prints the DoD reminder and a production command with an approval that names no authorization exits 2; with `src/state/goal-store.ts` made to throw, the Stop event, the production command, and the production command under a config the schema rejects (the legacy decision) each exit 0 with no stdout and stderr beginning `[aidlc hook] cannot load ../state/goal-store: `; with `src/state/journal.ts` made to throw, the Stop event names `../coordination/lease`; with `src/state/claims.ts` made to throw, the Stop event names `../state/claims` and prints no reminder. [R2] [dod arm 2]
depends_on: []
budget: 100
tdd: true
sweep: "Successor of T0-HOOK-LAZY (ruling 2026-10-24 on its STOP/review: R3 decision 3 re-raised F3 and F4, the provenance of a config stamp; the engineer ruled to ship the lazy loading without the stamp, and the stamp returns later as its own card). Measured on T0-HOOK-LAZY at main 794624a, Windows, Node 22.23.1: zod loads 95 files (about 60 ms), yaml 72 (about 39 ms); yaml reaches the hooks only through src/state/claims.ts (src/artifacts/plan.ts, frontmatter.ts); with the stamp gone every event still loads zod for the config check, so the saving is yaml and the state modules: UserPromptSubmit 252 to 206 ms and Stop 242 to 200 ms in that card's A/B, which is the expected PreToolUse saving too. Pinned docs: tests/surface/bench.test.ts reads the Loop benchmark paragraphs, which this card leaves unchanged."
forbid:
  - a change to a guard decision, output or order, or to loadHookConfig, runHook or dispatchHook (src/hooks/index.ts, src/hooks/entry.ts), in an installation whose modules load; a module that fails to load is the failure path the Decisions section states (stderr and exit 0 from the hook entry, where main's failed static import exited 1), which this forbid does not cover
  - any state read or written by a hook that main does not read or write (a stamp, a cache)
  - a changed line in tests/surface/hooks.test.ts, hook-name.test.ts or fix-task-clear.test.ts
  - a ceiling in bench/baseline.json raised
non_goals:
  - zod out of the hook path (the config stamp of T0-HOOK-LAZY, its own card after this ruling)
  - the git rev-parse spawn per hook, the src/ walk of bin/resolve-entry.js, the Stop hook reading every goal
hygiene: "Starts from main; T0-HOOK-LAZY's branch stays as the reference for the later stamp card and its worktree is removed at this card's CLOSE. RED first: a seam src/hooks/lazy.ts exporting LAZY_MODULES and loaders over static imports is committed before the RED run, so tests fail on assertions. Tests build fixtures under a fresh mkdtemp directory removed in a finally block, build child environments without AIDLC_* variables, and take every expected value from a literal or a requirement line."
doc_sync: docs/OPERATIONS.md, docs/ARCHITECTURE.md, CHANGELOG.md
---

# T0-HOOK-LAZY-2

## Deliverable
The hook guards load the router, the goal, lease and journal stores and the planning claims only on the branches that use them, so a hook event that reads no state loads no yaml (72 files) and none of those modules. The config check is untouched: every event still loads zod and checks `aidlc.config.json` with `ProjectConfig`, as on main. No hook reads or writes any new state.

## Decisions
- `require`, since the guards decide synchronously and `runHook` has 162 synchronous callers in tests/surface/hooks.test.ts. tsc rewrites the extension of import paths and never of `require` paths, so lazy.ts takes the extension of its own file. Node loads an ES module through `require` from 22.12 (engines: 22.18 and later) without a warning from 22.13; a module imported statically and one loaded through `require` are one instance, so `StoreError` stays one class.
- `src/core/types.ts` and `src/config.ts` stay static imports: the config check loads both on every event, so loading them later saves nothing.
- A module that fails to load through `require` throws a `LazyLoadError`; every catch in the guards rethrows it before its own handling (a production gate that read it as an authorization mismatch would deny, and the Stop hook would go silent), so the hook entry reports it on stderr and exits 0 (`main` in src/hooks/entry.ts). On main the same failure was a failed static import that ended the hook process with exit 1 before any guard ran; Claude Code treats both exits as a non-blocking error. The catches whose try reaches only modules loaded before it (the lease reads) rethrow it as well, so a later load inside them is never swallowed.

## Attempt evidence
- RED (76ffd0a, tests over the seam 0d22c81): the four tests of tests/surface/hook-lazy.test.ts fail on their assertions (yaml among the loaded dependencies, a lazy module imported statically by src/hooks/index.ts, `depBytes` 1140981 in the baseline, the missing doc texts); none fails on an import.
- Bench on the candidate, compiled entry, Windows, Node 22.23.1: the hook journeys load 109 to 113 modules (189 on main) and 853,346 dependency bytes, zod only (1,140,981 on main, yaml's 287,635 gone); fs calls, bytes read, spawns and output unchanged; `--ratchet` lowered 10 ceilings and raised none.
- Mutation sweep: 5 mutants (a static import of the claims, a fixed `.js` extension, a module missing from `LAZY_MODULES`, the Stop hook loading the claims eagerly, the router taken from the wrong loader), 5 killed.
- Wall time against main, two interleaved runs of 15 (median): PreToolUse Bash 217 to 180 ms and 208 to 174 ms, Edit 210 to 177 and 243 to 201, Stop 206 to 177 and 235 to 199.
- R3 decision 1 (f534553) blocked on F1, a CHANGELOG entry that began `- T0-HOOK-LAZY-2 (` (now `- T0-HOOK-LAZY-2:`), and F2 to F5, a module that failed to load being caught as an authorization mismatch by the production gate (exit 2) and silenced by the Stop hook's catches. Repair: `LazyLoadError`, rethrown by every catch in src/hooks/index.ts, and acceptance 7 in a package copy; 4 mutants that drop a rethrow or the wrapping, 4 killed. The card amendment went to main (51c9024) before R3 decision 2, and this branch merged main.
