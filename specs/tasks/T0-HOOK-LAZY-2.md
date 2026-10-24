---
id: T0-HOOK-LAZY-2
title: The hook guards load the router, the goal, lease and journal stores and the planning claims on first use, so a hook event that reads no state loads no yaml; the config check with zod is unchanged
status: todo
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
  - R1. src/hooks/index.ts shall import none of `src/core/router.ts`, `src/state/goal-store.ts`, `src/state/journal.ts`, `src/state/claims.ts` and `src/coordination/lease.ts` statically; a guard loads each on first use through `src/hooks/lazy.ts`, which lists them in its exported `LAZY_MODULES` and loads each with `require` from `createRequire` (node:module) and the extension of lazy.ts's own file (`.ts` under src/, `.js` under dist/). The value imports of src/hooks/index.ts and src/hooks/entry.ts, followed through every module they reach, shall reach no `yaml` package import.
  - R2. The guards' decisions, outputs and order are unchanged: `loadHookConfig` checks every config text with `ProjectConfig` as on main, no stamp or other state is read or written, and `runHook`, `dispatchHook` and `loadHookConfig` keep main's signatures and stay synchronous.
  - R3. bench/baseline.json shall hold the ceilings `npm run bench -- --ratchet` lowers after `npm run build` on this card's candidate; no ceiling is raised.
  - R4. docs/OPERATIONS.md Hooks shall carry, after its first paragraph, one paragraph stating which modules load on first use, that the config check with zod runs on every event as before, and the measured times; docs/ARCHITECTURE.md one sentence on `src/hooks/lazy.ts` after the hooks sentence; CHANGELOG.md Unreleased an entry under this card id; specs/tasks/T0-HOOK-LAZY.md `superseded_by: T0-HOOK-LAZY-2`.
acceptance:
  - 1. tests/surface/hook-lazy.test.ts runs `bin/aidlc-hook.js` with `bench/counter.ts` in the repository root over a fresh state directory for a PreToolUse Bash event (`git status`), a PreToolUse Edit event and a Stop event: each exits 0 with no output, and the dependencies it loads are exactly zod. [R1] [R2] [dod arm 2]
  - 2. tests/surface/hook-lazy.test.ts: every `LAZY_MODULES` entry names a file under src/ with the `.ts` extension; each loader of lazy.ts returns the namespace object `import()` of that file returns; the static value imports of src/hooks/index.ts and src/hooks/entry.ts name none of `LAZY_MODULES`, and the packages their value imports reach, followed from the source text, are exactly `zod`. [R1] [dod arm 2]
  - 3. tests/surface/hooks.test.ts, hook-name.test.ts and fix-task-clear.test.ts pass [dod arm 2], and the diff changes no line of them (reviewer-verified); the diff changes no line of `loadHookConfig`, `runHook` or `dispatchHook` and no file under src/ other than src/hooks/index.ts and src/hooks/lazy.ts (reviewer-verified). [R2]
  - 4. `npm run build && node bench/run.ts --check` exits 0 on the candidate [dod arms 3, 4]; tests/surface/hook-lazy.test.ts reads bench/baseline.json and finds `depBytes` of `hook.pre-bash`, `hook.pre-edit`, `hook.prompt` and `hook.stop` at most 853346 (zod's source bytes, yaml's 287635 gone); the diff raises no ceiling (reviewer-verified). [R3] [dod arm 2]
  - 5. tests/surface/hook-lazy.test.ts reads the new docs/OPERATIONS.md Hooks paragraph whole, the docs/ARCHITECTURE.md sentence, the CHANGELOG.md entry beginning `- T0-HOOK-LAZY-2:` and the `superseded_by` line of specs/tasks/T0-HOOK-LAZY.md, and each assertion fails with any one sentence removed. [R4] [dod arm 2]
  - 6. `npm run typecheck` is clean [dod arm 1]; tests/surface/bench.test.ts, prose.test.ts and mirror.test.ts pass [dod arm 2]. [R1] [R3]
depends_on: []
budget: 100
tdd: true
sweep: "Successor of T0-HOOK-LAZY (ruling 2026-10-24 on its STOP/review: R3 decision 3 re-raised F3 and F4, the provenance of a config stamp; the engineer ruled to ship the lazy loading without the stamp, and the stamp returns later as its own card). Measured on T0-HOOK-LAZY at main 794624a, Windows, Node 22.23.1: zod loads 95 files (about 60 ms), yaml 72 (about 39 ms); yaml reaches the hooks only through src/state/claims.ts (src/artifacts/plan.ts, frontmatter.ts); with the stamp gone every event still loads zod for the config check, so the saving is yaml and the state modules: UserPromptSubmit 252 to 206 ms and Stop 242 to 200 ms in that card's A/B, which is the expected PreToolUse saving too. Pinned docs: tests/surface/bench.test.ts reads the Loop benchmark paragraphs, which this card leaves unchanged."
forbid:
  - a change to a guard decision, output or order, or to loadHookConfig, runHook or dispatchHook (src/hooks/index.ts, src/hooks/entry.ts)
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
- A module that fails to load through `require` throws inside the guard, and the hook entry reports it on stderr and exits 0 (`main` in src/hooks/entry.ts); on main the same failure was a failed static import that ended the hook process with exit 1 before any guard ran. Claude Code treats both exits as a non-blocking error.
